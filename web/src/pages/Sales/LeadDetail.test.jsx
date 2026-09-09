import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Routes, Route } from "react-router-dom";

// MUI X 9's date field renders contenteditable sections jsdom cannot type
// into; the schedule test needs a real date, so swap in the native stub.
vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

import LeadDetail from "./LeadDetail";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

vi.mock("./LogFollowUpModal", () => ({ __esModule: true, default: ({ open, followUp }) => (open ? <div data-testid="log-modal">{followUp?.Id}</div> : null) }));
vi.mock("./TransferLeadModal", () => ({ __esModule: true, default: ({ open, leadIds }) => (open ? <div data-testid="transfer-modal">{leadIds.join(",")}</div> : null) }));
vi.mock("./LeadCreateModal", () => ({ __esModule: true, default: ({ open, lead }) => (open ? <div data-testid="edit-modal">{lead?.Id}</div> : null) }));

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const LEAD = { Id: 9, Name: "Sharma", Company: "Sharma Traders", MobileNo: "98200", AltMobile: "98201", Email: "sharma@traders.in",
  Address: "12 MG Road", City: "Pune", State: "MH", Pincode: "411001",
  StatusId: 12, StatusName: "Contacted", StatusCode: "open", ProductId: 7, ProductName: "TV 43in", OwnerName: "Bob",
  SourceId: 3, SourceName: "Website",
  EstValue: 50000, Remarks: "Walk-in", NextFollowupDate: "2026-09-10", BranchName: "Pune", OwnerId: 2, CreatedBy: 2 };
const DETAIL = {
  lead: LEAD, fields: [],
  activity: [{ Id: 1, Type: "created", Summary: "Lead created", CreatedAt: "2026-09-01T10:00:00Z" }],
  followups: [{ Id: 21, Type: "call", DueAt: "2026-09-10T00:00:00Z", Status: "open", AssignedToName: "Bob" },
              { Id: 20, Type: "call", DueAt: "2026-09-08T00:00:00Z", Status: "done", DoneByName: "Bob", Outcome: "Connected", Remarks: "Wants a quote", DoneAt: "2026-09-08T11:00:00Z" }],
  assignments: [{ Id: 31, FromUserName: null, ToUserName: "Bob", Reason: null, Remarks: "Assigned on creation", AssignedByName: "Alice", AssignedAt: "2026-09-01T10:00:00Z" }],
};

const mocks = (cap = {}) => server.use(
  http.post("*/api/leads/fetchLeadDetail", async () => json(DETAIL)),
  http.post("*/api/config/fetchCustomFields", async () => json({ customFields: [] })),
  http.post("*/api/config/fetchLookups", async ({ request }) => {
    const { Kind } = await request.json();
    return json({ lookups: Kind === "lead_status"
      ? [{ Id: 11, Value: "New", Code: "open" }, { Id: 12, Value: "Contacted", Code: "open" },
         { Id: 15, Value: "Lost", Code: "lost" }, { Id: 16, Value: "Converted", Code: "converted" }]
      : [{ Id: 1, Value: "Price" }] });
  }),
  http.post("*/api/leads/setLeadStatus", async ({ request }) => { cap.status = await request.json(); return json({ Id: 9, ResponseCode: 200 }); }),
);

const renderDetail = () => renderWithProviders(
  <Routes><Route path="/sales/leads/:leadId" element={<LeadDetail />} /></Routes>, { route: "/sales/leads/9" },
);

describe("LeadDetail (spec 1)", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" }));

  it("shows the labels the SP returned, no client-side lookups", async () => {
    mocks();
    renderDetail();
    expect(await screen.findByTestId("lead-detail")).toBeInTheDocument();
    expect(screen.getByTestId("lead-status-chip")).toHaveTextContent("Contacted");
    expect(screen.getByText("TV 43in")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/411001/)).toBeInTheDocument();
  });

  it("changing status to a non-lost value posts setLeadStatus immediately", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "New" }));
    await waitFor(() => expect(cap.status).toEqual({ LeadId: 9, StatusId: 11, LostReasonId: null }));
  });

  it("Lost prompts for a reason before posting", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "Lost" }));
    expect(cap.status).toBeUndefined();
    await user.click(screen.getByTestId("lost-reason-input"));
    await user.click(await screen.findByRole("option", { name: "Price" }));
    await user.click(screen.getByTestId("lost-reason-submit"));
    await waitFor(() => expect(cap.status).toEqual({ LeadId: 9, StatusId: 15, LostReasonId: 1 }));
  });

  it("follow-ups tab lists open above done and Log opens the modal for the open one", async () => {
    mocks();
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByText(/Follow-ups/));   // the tab label carries a badge
    const items = screen.getAllByTestId("followup-item");
    expect(items[0]).toHaveTextContent("Open");
    expect(items[1]).toHaveTextContent("Wants a quote");
    await user.click(screen.getByTestId("log-followup-21"));
    expect(screen.getByTestId("log-modal")).toHaveTextContent("21");
  });

  it("history tab shows the assignment trail and Transfer opens the modal", async () => {
    mocks();
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByText(/History/));
    expect(screen.getByText(/Assigned on creation/)).toBeInTheDocument();
    await user.click(screen.getByTestId("transfer-lead-btn"));
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("9");
  });

  // With nothing open there is nothing to log, so the header offers the other
  // half of the loop instead — scheduling the next one.
  it("with no open follow-up the header schedules one", async () => {
    const cap = {};
    mocks();
    server.use(
      http.post("*/api/leads/fetchLeadDetail", async () => json({ ...DETAIL, followups: [], assignments: [] })),
      http.post("*/api/followups/scheduleFollowUp", async ({ request }) => { cap.schedule = await request.json(); return json({ Id: 40, ResponseCode: 200 }); }),
    );
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByText(/Follow-ups/));
    expect(screen.getByTestId("followups-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("log-followup-btn")).not.toBeInTheDocument();
    await user.click(screen.getByText(/History/));
    expect(screen.getByText("Never assigned.")).toBeInTheDocument();
    await user.click(screen.getByText(/Follow-ups/));

    await user.click(screen.getByTestId("schedule-followup-btn"));
    expect(screen.getByTestId("schedule-submit")).toBeDisabled();
    // Type has no clear button: a null type would throw inside submitSchedule.
    expect(screen.getByTestId("schedule-type-input")).toHaveValue("Call");
    expect(within(screen.getByTestId("schedule-modal")).queryByTitle("Clear")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("schedule-date"), { target: { value: "2026-09-14" } });
    await user.click(screen.getByTestId("schedule-submit"));
    await waitFor(() => expect(cap.schedule).toEqual({ LeadId: 9, Type: "call", DueAt: "2026-09-14" }));
    await waitFor(() => expect(screen.queryByTestId("schedule-modal")).not.toBeInTheDocument());
  });

  // A picked-but-not-applied status must not linger in the input: the header
  // would then contradict the chip beside it. `converted` is the conversion
  // flow's outcome, not a status you pick — setLeadStatus refuses it.
  it("hides Converted and re-shows the real status when the lost prompt is dismissed", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    expect(await screen.findByRole("option", { name: "Lost" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Converted" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Lost" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("lost-reason-modal")).not.toBeInTheDocument());
    expect(screen.getByTestId("lead-status-select-input")).toHaveValue("Contacted");
    expect(cap.status).toBeUndefined();
  });

  // The SP left-joins everything, so half these columns arrive null on a real
  // lead — the page must read as sentences, not as a row of em-dashes.
  it("falls back readably when the SP returns nulls", async () => {
    mocks();
    server.use(
      http.post("*/api/leads/fetchLeadDetail", async () => json({
        lead: { Id: 9, Name: "Nameless", StatusId: 99, StatusName: null, StatusCode: "lost", OwnerName: null, LostReason: "Price too high" },
        fields: [], activity: [],
        followups: [{ Id: 22, Type: "email", DueAt: "2026-09-02T00:00:00Z", Status: "open", IsOverdue: 1 },
                    { Id: 23, Type: "call", DueAt: "2026-09-01T00:00:00Z", Status: "skipped" }],
        assignments: [{ Id: 32, FromUserName: "Bob", ToUserName: "Carol", FromBranchName: "Pune", ToBranchName: "Mumbai",
                        Reason: "Territory change", Remarks: "Moved to west", AssignedByName: "Alice", AssignedAt: "2026-09-05T09:00:00Z" }],
      })),
    );
    renderDetail();
    await screen.findByTestId("lead-detail");
    expect(screen.getByTestId("lead-status-chip")).toHaveTextContent("—");
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Price too high")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText(/Follow-ups/));
    const items = screen.getAllByTestId("followup-item");
    expect(items[0]).toHaveTextContent("email · due 02-09-2026 · overdue");
    expect(items[1]).toHaveTextContent("Skipped");
    expect(items[1]).toHaveTextContent("by —");

    await user.click(screen.getByText(/History/));
    expect(screen.getByTestId("assignment-item")).toHaveTextContent(
      "Bob → Carol (Mumbai) · Territory change — Moved to west",
    );
  });

  it("the header logs the open follow-up and opens the editor", async () => {
    mocks();
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("log-followup-btn"));
    expect(screen.getByTestId("log-modal")).toHaveTextContent("21");
    await user.click(screen.getByTestId("edit-lead-btn"));
    expect(screen.getByTestId("edit-modal")).toHaveTextContent("9");
  });

  it("cancelling the lost prompt leaves the status alone", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "Lost" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("lost-reason-modal")).not.toBeInTheDocument());
    expect(cap.status).toBeUndefined();
  });

  // Custom fields come from two endpoints — definitions (Options/IsRequired)
  // and the lead's stored values, merged by FieldId — so the card only exists
  // once the company defines one, and Save posts the merged CustomJSON.
  it("renders every configured custom-field type and saves an edited value", async () => {
    let captured;
    mocks();
    server.use(
      http.post("*/api/config/fetchCustomFields", async () =>
        json({ customFields: [
          { Id: 1, Label: "Budget", Type: "number", Options: null, IsRequired: false, SortOrder: 1 },
          { Id: 2, Label: "Renewal date", Type: "date", Options: null, IsRequired: false, SortOrder: 2 },
          { Id: 3, Label: "VIP", Type: "checkbox", Options: null, IsRequired: false, SortOrder: 3 },
          { Id: 4, Label: "Priority", Type: "dropdown", Options: JSON.stringify(["Low", "High"]), IsRequired: false, SortOrder: 4 },
          { Id: 5, Label: "Notes", Type: "text", Options: null, IsRequired: false, SortOrder: 5 },
          { Id: 6, Label: "Competitor", Type: "text", Options: null, IsRequired: false, SortOrder: 6 },
        ] })),
      http.post("*/api/leads/fetchLeadDetail", async () =>
        json({ ...DETAIL, fields: [
          { FieldId: 1, ValueText: null, ValueNumber: 5000, ValueDate: null },
          { FieldId: 2, ValueText: null, ValueNumber: null, ValueDate: "2026-08-01" },
          { FieldId: 3, ValueText: null, ValueNumber: 1, ValueDate: null },
          { FieldId: 4, ValueText: "Low", ValueNumber: null, ValueDate: null },
          { FieldId: 5, ValueText: "Called twice", ValueNumber: null, ValueDate: null },
          // FieldId 6 has no stored value — the def still renders, blank.
        ] })),
      http.post("*/api/leads/saveLeads", async ({ request }) => { captured = await request.json(); return json({ Id: 9, ResponseCode: 200 }); }),
    );
    renderDetail();
    await screen.findByTestId("lead-detail");
    expect(screen.getByLabelText("Budget")).toHaveValue(5000);
    expect(screen.getByLabelText(/Renewal date/)).toHaveValue("2026-08-01");
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByLabelText("Priority")).toHaveValue("Low");
    expect(screen.getByLabelText("Notes")).toHaveValue("Called twice");
    expect(screen.getByLabelText("Competitor")).toHaveValue("");
    expect(screen.getByTestId("save-custom-fields-btn")).toBeDisabled();

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Budget"));
    await user.type(screen.getByLabelText("Budget"), "7000");
    await user.click(screen.getByTestId("save-custom-fields-btn"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured.Id).toBe(9);
    // Regression: the body used to carry only half the record, and the SP's
    // UPDATE writes every base column — so saving a custom field blanked
    // Company/Address/City/State/Pincode/ProductId/Remarks.
    expect(captured).toMatchObject({
      Name: LEAD.Name, MobileNo: LEAD.MobileNo, AltMobile: LEAD.AltMobile, Email: LEAD.Email,
      Company: LEAD.Company, Address: LEAD.Address, City: LEAD.City, State: LEAD.State, Pincode: LEAD.Pincode,
      SourceId: LEAD.SourceId, ProductId: LEAD.ProductId, EstValue: LEAD.EstValue, Remarks: LEAD.Remarks,
    });
    expect(captured).not.toHaveProperty("PipelineId");
    expect(captured).not.toHaveProperty("StageId");
    expect(JSON.parse(captured.CustomJSON)).toEqual([
      { fieldId: 1, type: "number", value: "7000" },
      { fieldId: 2, type: "date", value: "2026-08-01" },
      { fieldId: 3, type: "checkbox", value: true },
      { fieldId: 4, type: "dropdown", value: "Low" },
      { fieldId: 5, type: "text", value: "Called twice" },
      { fieldId: 6, type: "text", value: "" },
    ]);
  }, 15000);
});
