import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import LeadCreateModal from "./LeadCreateModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const USERS = [
  { Id: 1, Username: "alice", FullName: "Alice" },
  { Id: 2, Username: "bob", FullName: "Bob" },
];
const SOURCES = [
  { Id: 5, Value: "Website" },
  { Id: 6, Value: "Referral" },
];
const PIPELINES = [{ Id: 9, Name: "Sales", IsDefault: true }];
const STAGES = [
  { Id: 3, PipelineId: 9, Name: "Qualified" },
  { Id: 4, PipelineId: 9, Name: "Won" },
];

const json = (data) =>
  HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const mockReads = (customFields = []) =>
  server.use(
    http.post("*/api/users/fetchUsers", async () => json({ users: USERS })),
    http.post("*/api/config/fetchLookups", async () => json({ lookups: SOURCES })),
    http.post("*/api/config/fetchPipelines", async () =>
      json({ pipelines: PIPELINES, stages: STAGES }),
    ),
    http.post("*/api/config/fetchCustomFields", async () =>
      json({ customFields }),
    ),
  );

const mockSave = (capture) =>
  server.use(
    http.post("*/api/leads/saveLeads", async ({ request }) => {
      capture?.(await request.json());
      return json({ Id: 55, ResponseCode: 200, ResponseMess: "Lead created" });
    }),
  );

const pick = async (user, testId, optionName) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name: optionName }));
};

describe("LeadCreateModal", () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    mockReads();
  });

  it("creates a lead: posts saveLeads with Id:0 and the picked core fields", async () => {
    let captured;
    mockSave((body) => {
      captured = body;
    });
    const onClose = vi.fn();
    renderWithProviders(<LeadCreateModal open onClose={onClose} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("lead-name"), "Acme Corp");
    await user.type(screen.getByTestId("lead-mobile"), "9990001111");
    await pick(user, "lead-owner", "Alice");
    // Pipeline auto-defaults to the IsDefault pipeline, so stage options load.
    await waitFor(() => expect(screen.getByTestId("lead-pipeline-input")).toBeInTheDocument());
    await pick(user, "lead-stage", "Qualified");

    await user.click(screen.getByTestId("lead-create-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toMatchObject({
      Id: 0,
      Name: "Acme Corp",
      MobileNo: "9990001111",
      OwnerId: 1,
      PipelineId: 9,
      StageId: 3,
      Email: null,
      AltMobile: null,
    });
    expect(captured.CustomJSON).toBe("[]");
    expect(onClose).toHaveBeenCalled();
  }, 15000);

  it("serialises configured custom fields into CustomJSON", async () => {
    let captured;
    mockReads([{ Id: 71, Label: "Region", Type: "text", IsRequired: false }]);
    mockSave((body) => {
      captured = body;
    });
    renderWithProviders(<LeadCreateModal open onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("lead-name"), "Beta");
    await user.type(screen.getByTestId("lead-mobile"), "8887776665");
    await pick(user, "lead-owner", "Bob");
    await pick(user, "lead-stage", "Won");
    await user.type(screen.getByLabelText("Region"), "West");

    await user.click(screen.getByTestId("lead-create-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(JSON.parse(captured.CustomJSON)).toEqual([
      { fieldId: 71, type: "text", value: "West" },
    ]);
    expect(captured).toMatchObject({ OwnerId: 2, StageId: 4 });
  }, 15000);

  it("edit mode: prefills the form from the lead and posts its Id with null CustomJSON", async () => {
    const LEAD = {
      Id: 55,
      Name: "Acme Corp",
      MobileNo: "9990001111",
      AltMobile: "8880002222",
      Email: "acme@example.com",
      SourceId: 5,
      PipelineId: 9,
      StageId: 3,
      OwnerId: 1,
      EstValue: 15000,
      NextFollowupDate: "2026-07-10T00:00:00.000Z",
    };
    let captured;
    // Custom fields ARE configured — edit mode must still not touch them.
    mockReads([{ Id: 71, Label: "Region", Type: "text", IsRequired: false }]);
    mockSave((body) => {
      captured = body;
    });
    const onClose = vi.fn();
    renderWithProviders(<LeadCreateModal open lead={LEAD} onClose={onClose} />, {
      router: false,
    });
    const user = userEvent.setup();

    expect(screen.getByText("Edit Lead")).toBeInTheDocument();
    expect(screen.getByTestId("lead-name")).toHaveValue("Acme Corp");
    expect(screen.getByTestId("lead-mobile")).toHaveValue("9990001111");
    expect(screen.getByTestId("lead-alt-mobile")).toHaveValue("8880002222");
    expect(screen.getByTestId("lead-email")).toHaveValue("acme@example.com");
    // Custom fields and attachments belong to the detail page in edit mode.
    expect(screen.queryByText("Custom fields")).not.toBeInTheDocument();
    expect(screen.queryByText("Attachments")).not.toBeInTheDocument();

    await user.clear(screen.getByTestId("lead-name"));
    await user.type(screen.getByTestId("lead-name"), "Acme Renamed");
    await user.click(screen.getByTestId("lead-create-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toMatchObject({
      Id: 55,
      Name: "Acme Renamed",
      MobileNo: "9990001111",
      OwnerId: 1,
      PipelineId: 9,
      StageId: 3,
      EstValue: 15000,
    });
    // null CustomJSON = sp_SaveLead skips the merge, stored values survive.
    expect(captured.CustomJSON).toBeNull();
    expect(onClose).toHaveBeenCalled();
  }, 15000);

  it("blocks submit and skips saveLeads when required fields are empty", async () => {
    const saveSpy = vi.fn();
    mockSave(saveSpy);
    renderWithProviders(<LeadCreateModal open onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("lead-create-submit"));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
