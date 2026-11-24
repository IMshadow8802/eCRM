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
import { pickTime } from "../../test/pickTime";
import renderWithProviders from "../../test/renderWithProviders";

vi.mock("./LogFollowUpModal", () => ({ __esModule: true, default: ({ open, followUp }) => (open ? <div data-testid="log-modal">{followUp?.Id}</div> : null) }));
vi.mock("./RescheduleFollowUpModal", () => ({ __esModule: true, default: ({ open, followUp }) => (open ? <div data-testid="reschedule-modal">{followUp?.Id}</div> : null) }));
vi.mock("./TransferLeadModal", () => ({ __esModule: true, default: ({ open, leadIds, sendBackTo, onDone, onFailed, onError }) => (open ? (
  <div data-testid="transfer-modal">
    {leadIds.join(",")}{sendBackTo ? ` back:${sendBackTo.id}:${sendBackTo.name}` : ""}
    <button type="button" onClick={() => onDone?.({ ToName: "Vivek Shah" })}>mock-done</button>
    <button type="button" onClick={() => onFailed?.()}>mock-failed</button>
    <button type="button" onClick={() => onError?.({ response: { status: 404, data: { code: "NOT_FOUND" } } })}>mock-gone</button>
  </div>
) : null) }));
vi.mock("./LeadCreateModal", () => ({ __esModule: true, default: ({ open, lead }) => (open ? <div data-testid="edit-modal">{lead?.Id}</div> : null) }));

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const LEAD = { Id: 9, Name: "Sharma", Company: "Sharma Traders", MobileNo: "98200", AltMobile: "98201", Email: "sharma@traders.in",
  Address: "12 MG Road", City: "Pune", State: "MH", Pincode: "411001",
  StatusId: 12, StatusName: "Contacted", StatusCode: "open", ProductId: 7, ProductName: "TV 43in", OwnerName: "Bob",
  SourceId: 3, SourceName: "Website",
  EstValue: 50000, Remarks: "Walk-in", NextFollowupDate: "2026-09-10", BranchName: "Pune", OwnerId: 2, CreatedBy: 2, CanEdit: 1 };
const DETAIL = {
  lead: LEAD, fields: [],
  activity: [{ Id: 1, Type: "created", Summary: "Lead created", CreatedAt: "2026-09-01T10:00:00Z" }],
  followups: [{ Id: 21, Type: "call", DueAt: "2026-09-10T00:00:00", Status: "open", AssignedToName: "Bob" },
              { Id: 20, Type: "call", DueAt: "2026-09-08T00:00:00", Status: "done", DoneByName: "Bob", Outcome: "Connected", Remarks: "Wants a quote", DoneAt: "2026-09-08T11:00:00Z" }],
  assignments: [{ Id: 31, FromUserName: null, ToUserName: "Bob", Reason: null, Remarks: "Assigned on creation", AssignedByName: "Alice", AssignedAt: "2026-09-01T10:00:00Z" }],
};

const mocks = (cap = {}, leadOver = {}) => server.use(
  http.post("*/api/leads/fetchLeadDetail", async () => json({ ...DETAIL, lead: { ...LEAD, ...leadOver } })),
  http.post("*/api/config/fetchCustomFields", async () => json({ customFields: [] })),
  http.post("*/api/config/fetchLookups", async ({ request }) => {
    const { Kind } = await request.json();
    return json({ lookups: Kind === "lead_status"
      ? [{ Id: 11, Value: "New", Code: "open" }, { Id: 12, Value: "Contacted", Code: "open" },
         { Id: 15, Value: "Lost", Code: "lost" }, { Id: 16, Value: "Converted", Code: "converted" }]
      : [{ Id: 1, Value: "Price" }] });
  }),
  http.post("*/api/leads/setLeadStatus", async ({ request }) => { cap.status = await request.json(); return json({ Id: 9, ResponseCode: 200 }); }),
  http.post("*/api/leads/convertLead", async ({ request }) => { cap.convert = await request.json(); return json({ Id: 9, CustomerId: 31, WonValue: 50000 }); }),
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

  it("an open follow-up has Reschedule, a closed one does not", async () => {
    mocks();
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByText(/Follow-ups/));
    expect(screen.queryByTestId("reschedule-followup-20")).toBeNull();
    await user.click(screen.getByTestId("reschedule-followup-21"));
    expect(screen.getByTestId("reschedule-modal")).toHaveTextContent("21");
  });

  it("history tab shows the assignment trail and Reassign opens the modal", async () => {
    mocks({}, { CanReassign: 1 });
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByText(/History/));
    expect(screen.getByText(/Assigned on creation/)).toBeInTheDocument();
    await user.click(screen.getByTestId("reassign-lead-btn"));
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("9");
    expect(screen.getByTestId("transfer-modal")).not.toHaveTextContent("back:");
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
    fireEvent.change(screen.getByTestId("schedule-date"), { target: { value: "2027-09-14" } });
    await pickTime(user, "schedule-time", "12:30");
    await user.click(screen.getByTestId("schedule-submit"));
    await waitFor(() => expect(cap.schedule).toEqual({ LeadId: 9, Type: "call", DueAt: "2027-09-14T12:30" }));
    await waitFor(() => expect(screen.queryByTestId("schedule-modal")).not.toBeInTheDocument());
    // date only, and time needs a date
    await user.click(screen.getByTestId("schedule-followup-btn"));
    expect(screen.getByTestId("schedule-time")).toBeDisabled();
    expect(screen.getByTestId("schedule-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("schedule-date"), { target: { value: "2027-09-15" } });
    await user.click(screen.getByTestId("schedule-submit"));
    await waitFor(() => expect(cap.schedule).toEqual({ LeadId: 9, Type: "call", DueAt: "2027-09-15" }));
  });

  // A picked-but-not-applied status must not linger in the input: the header
  // would then contradict the chip beside it. `converted` (Won) IS offered
  // now — the owner wanted it as an ordinary choice — but it never reaches
  // setLeadStatus (which refuses it); picking it opens WonDialog instead
  // (see the "offers Won…" regression guard below).
  it("offers Converted and re-shows the real status when the lost prompt is dismissed", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    expect(await screen.findByRole("option", { name: "Lost" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Converted" })).toBeInTheDocument();

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
        followups: [{ Id: 22, Type: "email", DueAt: "2026-09-02T00:00:00", Status: "open", IsOverdue: 1 },
                    { Id: 23, Type: "call", DueAt: "2026-09-01T00:00:00", Status: "skipped" }],
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

  // 119: a won/lost lead's open follow-ups become 'cancelled' (no DoneBy).
  it("a cancelled follow-up reads Cancelled with its date and no 'by'", async () => {
    mocks();
    server.use(
      http.post("*/api/leads/fetchLeadDetail", async () => json({
        lead: { Id: 9, Name: "Won one", StatusId: 5, StatusName: "Won", StatusCode: "converted" },
        fields: [], activity: [], assignments: [],
        followups: [{ Id: 24, Type: "visit", DueAt: "2026-11-05T00:00:00", Status: "cancelled",
                      DoneAt: "2026-11-03T10:00:00", Remarks: "Lead won" }],
      })),
    );
    renderDetail();
    await screen.findByTestId("lead-detail");
    await userEvent.setup().click(screen.getByText(/Follow-ups/));
    const item = screen.getByTestId("followup-item");
    expect(item).toHaveTextContent("Visit · cancelled 03-11-2026 10:00");
    expect(item).toHaveTextContent("Cancelled");
    expect(item).not.toHaveTextContent("by —");
    expect(item).not.toHaveTextContent("Skipped");
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
    // A string, not 5000: NumberInput stopped being <input type="number"> on
    // 2026-09-19 (the native spinner sat beside its own +/- buttons and ate
    // the tap target on a phone). type="text" + inputMode="decimal" keeps the
    // numeric keypad and reports the raw string.
    expect(screen.getByLabelText("Budget")).toHaveValue("5000");
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

  // REGRESSION GUARD for the rule, not a bug: Won is offered like any status,
  // and must NEVER reach setLeadStatus (which refuses it) — it goes to convert.
  it("offers Won in the dropdown, and routes it to convertLead instead of setLeadStatus", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "Converted" }));
    expect(await screen.findByTestId("won-dialog")).toBeInTheDocument();
    expect(cap.status).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(cap.convert).toMatchObject({ LeadId: 9, WonValue: 50000, QuotationId: null }));
  });

  it("shows what a won lead was won for", async () => {
    mocks();
    server.use(http.post("*/api/leads/fetchLeadDetail", async () => json({ ...DETAIL, lead: { ...LEAD, StatusCode: "converted", StatusName: "Won", WonValue: 270000, WonAt: "2026-09-18T10:00:00Z", CustomerName: "Ramesh Patel" } })));
    renderDetail();
    // formatCurrency groups Indian-style: 270000 -> "2,70,000.00", not "270,000".
    expect(await screen.findByTestId("won-banner")).toHaveTextContent("2,70,000");
  });

  it("has a Quotations tab", async () => {
    mocks();
    renderDetail();
    await screen.findByTestId("lead-detail");
    fireEvent.click(screen.getByRole("tab", { name: /quotations/i }));
    expect(await screen.findByTestId("lead-quotations")).toBeVisible();
  });

  it("shows who sent the lead from the detail response, with no extra request", async () => {
    mocks();
    server.use(http.post("*/api/leads/fetchLeadDetail", async () =>
      json({ ...DETAIL, lead: { ...LEAD, PartnerId: 3, PartnerName: "Sharma Traders" }, commissions: [] })));
    renderDetail();
    expect(await screen.findByText("Sent by Sharma Traders")).toBeInTheDocument();
  });
});

describe("LeadDetail — Assigned to, Reassign, Send back, record gone", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" }));

  const renderWithList = () => renderWithProviders(
    <Routes>
      <Route path="/sales/leads/:leadId" element={<LeadDetail />} />
      <Route path="/sales/leads" element={<div data-testid="leads-list" />} />
    </Routes>, { route: "/sales/leads/9" },
  );
  const gone = (status = 404) => HttpResponse.json({ success: false, message: "Lead not found", code: status === 404 ? "NOT_FOUND" : "FORBIDDEN", responseCode: status }, { status });

  it("labels the holder 'Assigned to' and the office 'Office' — no Owner or Branch", async () => {
    mocks();
    renderDetail();
    const info = await screen.findByTestId("lead-core-info");
    expect(within(info).getByText("Assigned to")).toBeInTheDocument();
    expect(within(info).getByText("Office")).toBeInTheDocument();
    expect(screen.getByTestId("lead-detail").textContent).not.toMatch(/owner|branch|transfer/i);
  });

  it("no Reassign without CanReassign, no Send back without SendBackToId", async () => {
    mocks({}, { CanReassign: 0, SendBackToId: null, SendBackToName: null });
    renderDetail();
    await screen.findByTestId("lead-detail");
    expect(screen.queryByTestId("reassign-lead-btn")).toBeNull();
    expect(screen.queryByTestId("send-back-btn")).toBeNull();
  });

  // A lead the caller may see but not change: every control that could only
  // earn a 403 is gone. Follow-up rows answer for themselves (CanAct).
  it("CanEdit 0: no Edit, status select, Schedule, custom-field Save or Reassign; follow-up rows keep Log by CanAct", async () => {
    mocks({}, { CanEdit: 0, CanReassign: 0 });
    server.use(
      http.post("*/api/config/fetchCustomFields", async () => json({ customFields: [{ Id: 1, Label: "GST", Type: "text" }] })),
      http.post("*/api/leads/fetchLeadDetail", async () => json({
        ...DETAIL, lead: { ...LEAD, CanEdit: 0, CanReassign: 0 },
        followups: [{ Id: 21, Type: "call", DueAt: "2026-09-10T00:00:00", Status: "open", CanAct: 1 },
                    { Id: 22, Type: "call", DueAt: "2026-09-11T00:00:00", Status: "open", CanAct: 0 }],
      })),
    );
    renderDetail();
    await screen.findByTestId("lead-detail");
    for (const id of ["edit-lead-btn", "lead-status-select", "schedule-followup-btn", "reassign-lead-btn", "save-custom-fields-btn"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.getByTestId("log-followup-btn")).toBeInTheDocument();   // the first open one can act
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /follow-ups/i }));
    expect(screen.getByTestId("log-followup-21")).toBeInTheDocument();
    expect(screen.queryByTestId("log-followup-22")).toBeNull();
    expect(screen.queryByTestId("reschedule-followup-22")).toBeNull();
  });

  it("CanEdit 0 with no open follow-up: no Schedule button either", async () => {
    mocks({}, { CanEdit: 0 });
    server.use(http.post("*/api/leads/fetchLeadDetail", async () => json({ ...DETAIL, lead: { ...LEAD, CanEdit: 0 }, followups: [] })));
    renderDetail();
    await screen.findByTestId("lead-detail");
    expect(screen.queryByTestId("schedule-followup-btn")).toBeNull();
    expect(screen.queryByTestId("log-followup-btn")).toBeNull();
  });

  // Final review m2: Send back is a reassign; never offered when the server
  // would refuse the reassign ("Only a manager can reassign a closed record").
  it("no Send back without CanReassign, even with a SendBackToId", async () => {
    mocks({}, { CanReassign: 0, SendBackToId: 5, SendBackToName: "Nitin Kale" });
    renderDetail();
    await screen.findByTestId("lead-detail");
    expect(screen.queryByTestId("send-back-btn")).toBeNull();
  });

  it("Send back is labelled from the server's name and opens the dialog for that person", async () => {
    mocks({}, { CanReassign: 1, SendBackToId: 5, SendBackToName: "Nitin Kale" });
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    expect(screen.getByTestId("send-back-btn")).toHaveTextContent("Send back to Nitin Kale");
    await user.click(screen.getByTestId("send-back-btn"));
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("9 back:5:Nitin Kale");
  });

  it("a refused send back refetches the detail, which drops the button", async () => {
    let calls = 0;
    mocks();
    server.use(http.post("*/api/leads/fetchLeadDetail", async () => {
      calls += 1;
      return json({ ...DETAIL, lead: { ...LEAD, CanReassign: 1, ...(calls === 1 ? { SendBackToId: 5, SendBackToName: "Nitin Kale" } : { SendBackToId: null }) } });
    }));
    renderDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("send-back-btn"));
    await user.click(screen.getByText("mock-failed"));
    await waitFor(() => expect(screen.queryByTestId("send-back-btn")).toBeNull());
    expect(screen.getByTestId("reassign-lead-btn")).toBeInTheDocument();
  });

  it("after a reassign that takes the lead away: drops the cache and returns to the list without the gone message", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const removeSpy = vi.spyOn(QueryClient.prototype, "removeQueries");
    let calls = 0;
    mocks();
    server.use(http.post("*/api/leads/fetchLeadDetail", async () => {
      calls += 1;
      return calls === 1 ? json({ ...DETAIL, lead: { ...LEAD, CanReassign: 1 } }) : gone();
    }));
    renderWithList();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("reassign-lead-btn"));
    await user.click(screen.getByText("mock-done"));
    expect(await screen.findByTestId("leads-list")).toBeInTheDocument();
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ["lead-detail", 9] });
    expect(screen.queryByText("This record is no longer with you")).toBeNull();
    removeSpy.mockRestore();
  });

  it("a 404 from the reassign dialog leaves for the list with the gone message", async () => {
    mocks({}, { CanReassign: 1 });
    renderWithList();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("reassign-lead-btn"));
    await user.click(screen.getByText("mock-gone"));
    expect(await screen.findByTestId("leads-list")).toBeInTheDocument();
    expect(await screen.findByText("This record is no longer with you")).toBeInTheDocument();
  });

  it("a reassign that leaves the lead visible stays on the page", async () => {
    mocks({}, { CanReassign: 1 });
    renderWithList();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("reassign-lead-btn"));
    await user.click(screen.getByText("mock-done"));
    await waitFor(() => expect(screen.getByTestId("lead-detail")).toBeInTheDocument());
    expect(screen.queryByTestId("leads-list")).toBeNull();
  });

  it("a 404 on a status change from a stale page goes to the list and says the record is gone", async () => {
    mocks();
    server.use(http.post("*/api/leads/setLeadStatus", async () => gone(404)));
    renderWithList();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "New" }));
    expect(await screen.findByTestId("leads-list")).toBeInTheDocument();
    expect(await screen.findByText("This record is no longer with you")).toBeInTheDocument();
  });

  it("opening a lead that is no longer visible goes to the list with the gone message", async () => {
    mocks();
    server.use(http.post("*/api/leads/fetchLeadDetail", async () => gone(404)));
    renderWithList();
    expect(await screen.findByTestId("leads-list")).toBeInTheDocument();
    expect(await screen.findByText("This record is no longer with you")).toBeInTheDocument();
  });

  // Final review I2 (FR-I2): a closed lead goes back to an active status only
  // with the server's CanReopen (the complaint rule). REGRESSION: staff could
  // move a lost lead back to open and then pass it on.
  describe("reopening a closed lead", () => {
    const LOST = { StatusId: 15, StatusName: "Lost", StatusCode: "lost" };
    const optionNames = async (user) => {
      await user.click(screen.getByTestId("lead-status-select-input"));
      await screen.findAllByRole("option");
      return screen.getAllByRole("option").map((o) => o.textContent);
    };

    it("without CanReopen the active statuses are not offered", async () => {
      mocks({}, { ...LOST, CanReopen: 0 });
      renderDetail();
      await screen.findByTestId("lead-detail");
      expect(await optionNames(userEvent.setup())).toEqual(["Lost", "Converted"]);
    });

    it("with CanReopen they are, and picking one posts the move", async () => {
      const cap = {};
      mocks(cap, { ...LOST, CanReopen: 1 });
      renderDetail();
      await screen.findByTestId("lead-detail");
      const user = userEvent.setup();
      expect(await optionNames(user)).toEqual(["New", "Contacted", "Lost", "Converted"]);
      await user.click(screen.getByRole("option", { name: "New" }));
      await waitFor(() => expect(cap.status).toEqual({ LeadId: 9, StatusId: 11, LostReasonId: null }));
    });

    it("an open lead offers everything whatever CanReopen says", async () => {
      mocks({}, { CanReopen: 0 });
      renderDetail();
      await screen.findByTestId("lead-detail");
      expect(await optionNames(userEvent.setup())).toEqual(["New", "Contacted", "Lost", "Converted"]);
    });

    it("the server's refusal (stale page) shows its sentence and stays", async () => {
      mocks({}, { ...LOST, CanReopen: 1 });
      server.use(http.post("*/api/leads/setLeadStatus", async () => HttpResponse.json(
        { success: false, message: "Only a manager can reopen a closed lead", code: "SP_ERROR", responseCode: 403 }, { status: 403 })));
      renderWithList();
      await screen.findByTestId("lead-detail");
      const user = userEvent.setup();
      await user.click(screen.getByTestId("lead-status-select-input"));
      await user.click(await screen.findByRole("option", { name: "New" }));
      expect(await screen.findByText("Only a manager can reopen a closed lead")).toBeInTheDocument();
      expect(screen.queryByTestId("leads-list")).toBeNull();
    });
  });

  // Final review m1: a 404 that is not the lead's own not-found (here a stale
  // status list: 'Status not found', which 139 answers 400 — but even a 404
  // without NOT_FOUND) must not throw the user out of a lead they still see.
  it("a 404 without NOT_FOUND on a status change stays on the lead", async () => {
    mocks();
    server.use(http.post("*/api/leads/setLeadStatus", async () => HttpResponse.json(
      { success: false, message: "Status not found", code: "SP_ERROR", responseCode: 404 }, { status: 404 })));
    renderWithList();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "New" }));
    expect(await screen.findByText("Status not found")).toBeInTheDocument();
    expect(screen.queryByTestId("leads-list")).toBeNull();
  });

  it.each([[400, "Use convert to win a lead"], [403, "You do not have permission for this action"]])(
    "a %i on an action stays on the lead and shows the server's sentence", async (status, message) => {
    mocks();
    server.use(http.post("*/api/leads/setLeadStatus", async () =>
      HttpResponse.json({ success: false, message, responseCode: status }, { status })));
    renderWithList();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "New" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByTestId("lead-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("leads-list")).toBeNull();
  });

  describe("calling lists and number marks (149)", () => {
    it("shows the do-not-call banner, even when the mark sits on the alternate number", async () => {
      mocks({}, { MobileNo: "9825012345", AltMobile: "9898011111", PhoneMark: "dnc", PhoneMarkNote: "Asked never to be called", PhoneMarkBy: "Priya Verma", PhoneMarkAt: "2026-11-22T17:22:00" });
      renderDetail();
      expect(await screen.findByTestId("phone-mark-banner")).toHaveTextContent("Do not call — Asked never to be called · marked by Priya Verma, 22-11-2026");
    });

    it("names the calling list as text, or as a link for a list manager", async () => {
      mocks({}, { CallListId: 5, CallListName: "MLSS Delhi" });
      renderDetail();
      expect(await screen.findByText("MLSS Delhi")).toBeInTheDocument();
      expect(screen.queryByTestId("lead-call-list")).toBeNull();
      expect(screen.queryByTestId("mark-number-btn")).toBeNull();
    });

    it("a list manager gets the link and Mark number, which opens the mark dialog for the lead's mobile", async () => {
      useAuthStore.setState({ access: { isAdmin: false, modules: { calling: { view: true, edit: true } } } });
      mocks({}, { CallListId: 5, CallListName: "MLSS Delhi" });
      renderDetail();
      expect(await screen.findByTestId("lead-call-list")).toHaveAttribute("href", "/sales/calling-lists/5");
      fireEvent.click(screen.getByTestId("mark-number-btn"));
      expect(await screen.findByText("Mark 98200")).toBeInTheDocument();
      useAuthStore.setState({ access: null });
    });

    it("no Mark number when the lead has no mobile", async () => {
      useAuthStore.setState({ access: { isAdmin: true, modules: {} } });
      mocks({}, { MobileNo: null });
      renderDetail();
      await screen.findByTestId("lead-detail");
      expect(screen.queryByTestId("mark-number-btn")).toBeNull();
      useAuthStore.setState({ access: null });
    });
  });
});
