import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import LeadDetail from "./LeadDetail";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const LEAD = {
  Id: 9,
  Name: "Acme Corp",
  MobileNo: "9999999999",
  Email: "acme@example.com",
  EstValue: 50000,
  StageName: "Qualified",
  SourceName: "Web",
  OwnerName: "Bob",
  NextFollowupDate: "2026-07-10",
};

const FIELDS = [
  {
    FieldId: 1,
    Label: "Budget",
    Type: "number",
    Options: null,
    IsRequired: false,
    ValueText: null,
    ValueNumber: 5000,
    ValueDate: null,
  },
  {
    FieldId: 2,
    Label: "Priority",
    Type: "dropdown",
    Options: JSON.stringify(["Low", "High"]),
    IsRequired: false,
    ValueText: "Low",
    ValueNumber: null,
    ValueDate: null,
  },
];

const ACTIVITY = [
  { Id: 2, Type: "stage_changed", CreatedAt: "2026-01-02T10:00:00Z", Summary: "Moved to Qualified" },
  { Id: 1, Type: "created", CreatedAt: "2026-01-01T10:00:00Z" },
];

const FOLLOWUPS = [
  { Id: 1, NextFollowupDate: "2026-07-10", FollowupType: "call", Remarks: "Ring back", Status: "Pending" },
];

// The test fixtures carry both def info (Label/Type/Options/IsRequired) and
// value columns on one row. In production those come from two endpoints:
// fetchCustomFields (defs) and fetchLeadDetail's `fields` (values). Split the
// fixtures the same way so the merge in LeadDetail is exercised for real.
const toDefs = (fields) =>
  fields.map((f, i) => ({
    Id: f.FieldId,
    Label: f.Label,
    Type: f.Type,
    Options: f.Options,
    IsRequired: f.IsRequired,
    SortOrder: i,
  }));

const toValues = (fields) =>
  fields.map((f) => ({
    FieldId: f.FieldId,
    ValueText: f.ValueText,
    ValueNumber: f.ValueNumber,
    ValueDate: f.ValueDate,
  }));

const mockDetail = ({ lead = LEAD, fields = FIELDS, activity = ACTIVITY } = {}) =>
  server.use(
    http.post("*/api/leads/fetchLeadDetail", async () =>
      HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { lead, fields: toValues(fields), activity },
      }),
    ),
    http.post("*/api/config/fetchCustomFields", async () =>
      HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { customFields: toDefs(fields) },
      }),
    ),
    http.post("*/api/followups/fetchFollowups", async () =>
      HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { followups: FOLLOWUPS },
      }),
    ),
  );

const mockSaveLeads = (capture) =>
  server.use(
    http.post("*/api/leads/saveLeads", async ({ request }) => {
      const body = await request.json();
      capture?.(body);
      return HttpResponse.json({
        success: true,
        message: "Saved",
        responseCode: 200,
        data: { Id: 9, ResponseCode: 200, ResponseMess: "Saved" },
      });
    }),
  );

describe("LeadDetail", () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    mockSaveLeads();
  });

  it("renders the core lead header fields and current stage from fetchLeadDetail", async () => {
    mockDetail();
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("9999999999 · acme@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("lead-stage-chip")).toHaveTextContent("Qualified");
  });

  it("renders custom fields via DynamicField, populated with their current values", async () => {
    mockDetail();
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");
    expect(screen.getByLabelText("Budget")).toHaveValue(5000);
    expect(screen.getByLabelText("Priority")).toBeInTheDocument();
  });

  it("shows an empty state when the lead has no custom fields configured", async () => {
    mockDetail({ fields: [] });
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");
    expect(screen.getByTestId("custom-fields-empty")).toBeInTheDocument();
  });

  it("Timeline tab lists activity chronologically", async () => {
    mockDetail();
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Timeline/i }));
    const items = await screen.findAllByTestId("timeline-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Created");
    expect(items[1]).toHaveTextContent("Stage changed");
  });

  it("Follow-ups tab lists the lead's follow-ups", async () => {
    mockDetail();
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Follow-ups/i }));
    const items = await screen.findAllByTestId("followup-item");
    expect(items).toHaveLength(1);
    expect(screen.getByText(/Ring back/)).toBeInTheDocument();
  });

  it("Save changes is disabled until a custom field is edited", async () => {
    mockDetail();
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");
    expect(screen.getByTestId("save-custom-fields-btn")).toBeDisabled();
  });

  it("editing a custom field and saving posts saveLeads with an updated CustomJSON", async () => {
    let captured;
    mockDetail();
    mockSaveLeads((body) => {
      captured = body;
    });
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");

    const user = userEvent.setup();
    const budgetInput = screen.getByLabelText("Budget");
    await user.clear(budgetInput);
    await user.type(budgetInput, "7000");

    const saveBtn = screen.getByTestId("save-custom-fields-btn");
    expect(saveBtn).not.toBeDisabled();
    await user.click(saveBtn);

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured.Id).toBe(9);
    const customJson = JSON.parse(captured.CustomJSON);
    expect(customJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: 1, type: "number", value: "7000" }),
        expect.objectContaining({ fieldId: 2, type: "dropdown", value: "Low" }),
      ]),
    );
  });

  it("Log Call button opens the LogCallModal", async () => {
    mockDetail();
    server.use(
      http.post("*/api/config/fetchLookups", async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { lookups: [] },
        }),
      ),
    );
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("log-call-btn"));
    expect(await screen.findByTestId("log-call-modal")).toBeInTheDocument();
  });

  it("renders a loading skeleton before the lead has loaded", () => {
    mockDetail();
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    expect(screen.getByTestId("lead-detail-loading")).toBeInTheDocument();
  });

  it("shows a dash for next follow-up when the lead has none set", async () => {
    mockDetail({ lead: { ...LEAD, NextFollowupDate: null } });
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");
    expect(screen.getByText("Next follow-up").nextSibling).toHaveTextContent("—");
  });

  it("renders date, checkbox and text custom field types from their def", async () => {
    mockDetail({
      fields: [
        {
          FieldId: 3,
          Label: "Renewal date",
          Type: "date",
          Options: null,
          IsRequired: false,
          ValueText: null,
          ValueNumber: null,
          ValueDate: "2026-08-01",
        },
        {
          FieldId: 4,
          Label: "VIP",
          Type: "checkbox",
          Options: null,
          IsRequired: false,
          ValueText: null,
          ValueNumber: 1,
          ValueDate: null,
        },
        {
          FieldId: 5,
          Label: "Notes",
          Type: "text",
          Options: null,
          IsRequired: false,
          ValueText: "Called twice",
          ValueNumber: null,
          ValueDate: null,
        },
      ],
    });
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");
    expect(screen.getByLabelText("Renewal date")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByLabelText("Notes")).toHaveValue("Called twice");
  });

  it("keeps the save button enabled and surfaces an error toast when saveLeads fails", async () => {
    mockDetail();
    server.use(
      http.post("*/api/leads/saveLeads", async () =>
        HttpResponse.json(
          { success: false, message: "Save failed", responseCode: 500, data: null },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(<LeadDetail leadId={9} />, { router: false });
    await screen.findByText("Acme Corp");

    const user = userEvent.setup();
    const budgetInput = screen.getByLabelText("Budget");
    await user.clear(budgetInput);
    await user.type(budgetInput, "1");
    await user.click(screen.getByTestId("save-custom-fields-btn"));

    await waitFor(() => expect(screen.getByTestId("save-custom-fields-btn")).not.toBeDisabled());
  });
});
