import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

// The four modals have their own test files; here they are stubs that report
// what TicketDetail handed them and let a test fire their callbacks. Each
// also exposes its onClose/onLogged so a coverage test can exercise the
// close handlers TicketDetail wires into them — the brief's own stubs never
// call `onClose`, which left every one of those closures un-invoked.
vi.mock("./ResolveTicketModal", () => ({
  __esModule: true,
  default: ({ open, status, onClose, onError }) => (open ? (
    <div data-testid="resolve-modal">
      status:{status?.value}
      <button type="button" onClick={onClose}>close-resolve</button>
      <button type="button" onClick={() => onError({ response: { status: 404, data: { message: "Complaint not found", code: "NOT_FOUND" } } })}>resolve-404</button>
    </div>
  ) : null),
}));
vi.mock("./RemarksModal", () => ({
  __esModule: true,
  default: ({ open, title, submitLabel, onSubmit, busy, onClose }) =>
    (open ? (
      <div data-testid="remarks-modal">
        <span>{title}</span><span>{submitLabel}</span>{busy ? <span>busy</span> : null}
        <button type="button" onClick={() => onSubmit("Customer called back")}>remarks-submit</button>
        <button type="button" onClick={onClose}>close-remarks</button>
      </div>
    ) : null),
}));
vi.mock("./TransferTicketModal", () => ({
  __esModule: true,
  default: ({ open, ticketIds, onClose, onDone }) => (open ? (
    <div data-testid="transfer-modal">{ticketIds.join(",")}
      <button type="button" onClick={onClose}>close-transfer</button>
      <button type="button" onClick={() => onDone()}>reassigned</button>
    </div>
  ) : null),
}));
vi.mock("./EscalateTicketModal", () => ({
  __esModule: true,
  default: ({ open, ticket, onClose }) => (open ? (
    <div data-testid="escalate-modal">ticket:{ticket?.Id}<button type="button" onClick={onClose}>close-escalate</button></div>
  ) : null),
}));
vi.mock("./TicketCreateModal", () => ({
  __esModule: true,
  default: ({ open, ticket, onClose }) => (open ? (
    <div data-testid="ticket-form-modal">{ticket?.Id}<button type="button" onClick={onClose}>close-edit</button></div>
  ) : null),
}));
vi.mock("../Sales/LogCallModal", () => ({
  __esModule: true,
  default: ({ open, ticketId, onClose, onLogged }) => (open ? (
    <div data-testid="log-call-modal">
      ticket:{ticketId}
      <button type="button" onClick={onLogged}>logged-call</button>
      <button type="button" onClick={onClose}>close-call</button>
    </div>
  ) : null),
}));

import TicketDetail from "./TicketDetail";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { json, refuse, ticketRow, ticketDetail, mockSupportRefData, mockTicketEndpoints } from "../../test/supportMocks";

const renderDetail = () => renderWithProviders(<TicketDetail ticketId={7} />);
const pickStatus = async (user, name) => {
  await user.click(screen.getByTestId("ticket-status-select-input"));
  await user.click(await screen.findByRole("option", { name }));
};

describe("TicketDetail (spec 2)", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
  });

  it("shows the labels the SP returned — number, subject, status, priority, due", async () => {
    mockTicketEndpoints();
    renderDetail();
    expect(screen.getByTestId("ticket-detail-loading")).toBeInTheDocument();

    expect(await screen.findByText("TKT-0007")).toBeInTheDocument();
    expect(screen.getByText("Screen flickers on boot")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-status-chip")).toHaveTextContent("In Progress");
    expect(screen.getByTestId("ticket-priority-chip")).toHaveTextContent("High");
    expect(screen.getByTestId("ticket-due-chip")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-escalated-chip")).toBeNull();
    // Nothing on this page resolves an id into a name any more.
    expect(screen.getByTestId("ticket-core-info")).toHaveTextContent("Billing");
    expect(screen.getByTestId("ticket-core-info")).toHaveTextContent("Phone");
    expect(screen.getByTestId("ticket-core-info")).toHaveTextContent("Amit Singh");
  });

  it("a marked customer number shows the warning banner", async () => {
    mockTicketEndpoints({}, { detail: ticketDetail({ ticket: ticketRow({ CanEdit: 1, PhoneMark: "caution", PhoneMarkNote: "Speaks only Punjabi", PhoneMarkBy: "Priya Verma", PhoneMarkAt: "2026-11-20T18:40:00" }) }) });
    renderDetail();
    expect(await screen.findByTestId("phone-mark-banner")).toHaveTextContent("Call with caution — Speaks only Punjabi · marked by Priya Verma, 20-11-2026");
  });

  it("an overdue, escalated complaint says so in the header", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({ ticket: ticketRow({ CanEdit: 1, IsOverdue: 1, EscalatedTo: 16, EscalatedToName: "Neha Verma", PreviousTickets: 2 }) }),
    });
    renderDetail();
    expect(await screen.findByTestId("ticket-due-chip")).toHaveTextContent("overdue");
    expect(screen.getByTestId("ticket-escalated-chip")).toHaveTextContent("Neha Verma");
  });

  it("the customer card links to that customer's other complaints", async () => {
    mockTicketEndpoints({}, { detail: ticketDetail({ ticket: ticketRow({ CanEdit: 1, PreviousTickets: 2, CustomerEmail: "acme@example.com", CustomerCity: "Pune" }) }) });
    renderDetail();
    const card = await screen.findByTestId("ticket-customer-card");
    expect(card).toHaveTextContent("Acme Corp");
    expect(card).toHaveTextContent("9990001111");
    expect(card).toHaveTextContent("acme@example.com");

    await userEvent.setup().click(screen.getByTestId("ticket-previous-complaints"));
    expect(mockNavigate).toHaveBeenCalledWith("/support/customers?customerId=3");
  });

  // Spec §2: open/onhold moves are free. One endpoint, always.
  it("moving between active statuses posts setTicketStatus straight away", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "On Hold");
    await waitFor(() => expect(cap.status).toEqual({ TicketId: 7, StatusId: 63, Remarks: null }));
  });

  it("re-picking the status it already has does nothing", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "In Progress");
    expect(cap.status).toBeUndefined();
  });

  it("the Resolve button opens the resolve prompt with the resolved status", async () => {
    mockTicketEndpoints();
    renderDetail();
    await userEvent.setup().click(await screen.findByTestId("resolve-ticket-btn"));
    expect(await screen.findByTestId("resolve-modal")).toHaveTextContent("status:64");
  });

  it("a finished complaint has no Resolve button", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({ ticket: ticketRow({ CanEdit: 1, StatusId: 65, StatusName: "Closed", StatusCode: "closed" }) }),
    });
    renderDetail();
    expect(await screen.findByTestId("ticket-status-chip")).toHaveTextContent("Closed");
    expect(screen.queryByTestId("resolve-ticket-btn")).toBeNull();
  });

  it("a resolved status opens the resolve prompt with THAT status id", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "Resolved");
    expect(await screen.findByTestId("resolve-modal")).toHaveTextContent("status:64");
    expect(cap.status).toBeUndefined();
  });

  // Straight-to-closed needs a resolution too (spec §2), so it reuses the
  // same prompt; resolved -> closed needs neither and posts directly.
  it("closing an ACTIVE complaint asks for a resolution first", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "Closed");
    expect(await screen.findByTestId("resolve-modal")).toHaveTextContent("status:65");
    expect(cap.status).toBeUndefined();
  });

  it("closing a RESOLVED complaint posts straight away — the customer confirmed", async () => {
    const cap = mockTicketEndpoints({}, {
      detail: ticketDetail({ ticket: ticketRow({ CanEdit: 1, StatusId: 64, StatusName: "Resolved", StatusCode: "resolved", ResolvedAt: "2026-09-16T09:00:00Z", ResolutionId: 8, ResolutionName: "Fixed" }) }),
    });
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "Closed");
    await waitFor(() => expect(cap.status).toEqual({ TicketId: 7, StatusId: 65, Remarks: null }));
    expect(screen.queryByTestId("resolve-modal")).toBeNull();
  });

  it("a rejected status asks for remarks and posts them with the move", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();
    await pickStatus(user, "Rejected");

    const modal = await screen.findByTestId("remarks-modal");
    expect(modal).toHaveTextContent("Reject complaint");
    expect(cap.status).toBeUndefined();

    await user.click(screen.getByText("remarks-submit"));
    await waitFor(() => expect(cap.status).toEqual({ TicketId: 7, StatusId: 66, Remarks: "Customer called back" }));
  });

  // Spec §2 + §6: reopening is a manager's act. The client always asks for
  // remarks; the server decides whether the caller may.
  it("reopening a closed complaint asks for remarks, and a 400 keeps the prompt open with the server's words", async () => {
    mockTicketEndpoints({}, { detail: ticketDetail({ ticket: ticketRow({ CanEdit: 1, StatusId: 65, StatusName: "Closed", StatusCode: "closed", ClosedAt: "2026-09-16T12:00:00Z" }) }) });
    server.use(http.post("*/api/tickets/setTicketStatus", () => refuse("Reopening requires a manager", 400)));
    renderDetail();
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();

    await pickStatus(user, "In Progress");
    const modal = await screen.findByTestId("remarks-modal");
    expect(modal).toHaveTextContent("Reopen complaint");

    await user.click(screen.getByText("remarks-submit"));
    expect(await screen.findByText("Reopening requires a manager")).toBeInTheDocument();
    expect(screen.getByTestId("remarks-modal")).toBeInTheDocument();
  });

  it("the buttons open the call log, the transfer, the escalation and the editor", async () => {
    mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("log-call-btn"));
    expect(screen.getByTestId("log-call-modal")).toHaveTextContent("ticket:7");
    await user.click(screen.getByTestId("reassign-ticket-btn"));
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("7");
    await user.click(screen.getByTestId("escalate-ticket-btn"));
    expect(screen.getByTestId("escalate-modal")).toHaveTextContent("ticket:7");
    await user.click(screen.getByTestId("edit-ticket-btn"));
    expect(screen.getByTestId("ticket-form-modal")).toHaveTextContent("7");
  });

  it("the timeline tab shows the activity, the call and the assignment trail", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({
        activity: [
          { Id: 1, Type: "created", Summary: "Complaint created", CreatedAt: "2026-09-15T10:00:00Z", UserName: "Amit Singh" },
          { Id: 2, Type: "escalated", Summary: "Escalated to Neha Verma — customer is angry", CreatedAt: "2026-09-16T09:00:00Z", UserName: "Amit Singh" },
          { Id: 3, Type: "call", Summary: "Outbound call logged", CreatedAt: "2026-09-16T11:00:00Z", UserName: "Amit Singh" },
        ],
      }),
    });
    server.use(http.post("*/api/calls/fetchCalls", () => json({ calls: [{ Id: 31, Direction: "out", Notes: "Promised a visit Friday", OutcomeId: 50, Duration: 4, CalledAt: "2026-09-16T11:00:00Z" }] })));
    renderDetail();
    await screen.findByTestId("ticket-detail");

    // 3 activity rows + 1 real call, but the 'call' activity row is replaced
    // by (not added to) the real call — the badge must count what renders
    // (3), not activity.length + calls.length (4).
    expect(await screen.findByTestId("ticket-detail-tabs-timeline")).toHaveTextContent("Timeline3");

    await userEvent.setup().click(screen.getByRole("tab", { name: /Timeline/ }));
    const items = await screen.findAllByTestId("timeline-item");
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveTextContent("Escalated");
    // The thin "a call happened" row is replaced by what was actually said.
    expect(screen.getByText("Outgoing call")).toBeInTheDocument();
    expect(screen.getByText(/Promised a visit Friday/)).toBeInTheDocument();
    expect(screen.getByText(/Answered/)).toBeInTheDocument();
    expect(screen.getByTestId("assignment-item")).toHaveTextContent("Amit Singh");
    expect(screen.getByTestId("assignment-item")).toHaveTextContent("Assigned on creation");
  });

  it("renders the stored custom fields read-only, from the detail's own recordset", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({ fields: [
        { FieldId: 1, FieldKey: "sev", Label: "Severity", Type: "number", ValueText: null, ValueNumber: 3, ValueDate: null },
        { FieldId: 2, FieldKey: "mod", Label: "Module", Type: "text", ValueText: "Auth", ValueNumber: null, ValueDate: null },
      ] }),
    });
    renderDetail();
    expect(await screen.findByTestId("ticket-custom-fields")).toHaveTextContent("Severity");
    expect(screen.getByTestId("ticket-custom-fields")).toHaveTextContent("Module");
    expect(screen.getByTestId("ticket-custom-fields")).toHaveTextContent("Auth");
    // Editing moved into the create/edit modal — no draft, no save button here.
    expect(screen.queryByTestId("save-custom-fields-btn")).toBeNull();
  });

  it("hides the custom-field card when the company has configured none", async () => {
    mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    expect(screen.queryByTestId("ticket-custom-fields")).toBeNull();
  });

  it("shows the linked lead link when the complaint tracks one", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({ ticket: ticketRow({ CanEdit: 1, LinkedLeadId: 11 }), linkedLead: { Id: 11, Name: "Acme Corp Lead" } }),
    });
    renderDetail();
    const link = await screen.findByTestId("linked-lead-link");
    expect(link).toHaveAttribute("href", "/sales/leads/11");
  });

  // Regression: a raw <a href> ignores the app's router basename ("/prdcrm/"
  // in prod — App.jsx) and 404s. Rendering under a basename here proves the
  // link goes through router navigation (react-router's Link), not a plain
  // anchor — a raw <a href="/sales/leads/11"> would render that literal path
  // with no basename prefix and fail this assertion.
  it("the linked-lead link goes through router navigation, so it keeps the app's basename", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({ ticket: ticketRow({ CanEdit: 1, LinkedLeadId: 11 }), linkedLead: { Id: 11, Name: "Acme Corp Lead" } }),
    });
    renderWithProviders(
      <MemoryRouter basename="/prdcrm" initialEntries={["/prdcrm/support/tickets/7"]}>
        <TicketDetail ticketId={7} />
      </MemoryRouter>,
      { router: false },
    );
    const link = await screen.findByTestId("linked-lead-link");
    expect(link).toHaveAttribute("href", "/prdcrm/sales/leads/11");
  });

  it("says 'Never assigned' when the complaint has no assignment history", async () => {
    mockTicketEndpoints({}, { detail: ticketDetail({ assignments: [] }) });
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await userEvent.setup().click(screen.getByRole("tab", { name: /Timeline/ }));
    expect(await screen.findByText("Never assigned.")).toBeInTheDocument();
  });

  it("closing the log-call, transfer, escalate and edit modals clears them, and a logged call refetches", async () => {
    mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("log-call-btn"));
    await user.click(screen.getByText("logged-call"));
    await user.click(screen.getByText("close-call"));
    expect(screen.queryByTestId("log-call-modal")).toBeNull();

    await user.click(screen.getByTestId("reassign-ticket-btn"));
    await user.click(screen.getByText("close-transfer"));
    expect(screen.queryByTestId("transfer-modal")).toBeNull();

    await user.click(screen.getByTestId("escalate-ticket-btn"));
    await user.click(screen.getByText("close-escalate"));
    expect(screen.queryByTestId("escalate-modal")).toBeNull();

    await user.click(screen.getByTestId("edit-ticket-btn"));
    await user.click(screen.getByText("close-edit"));
    expect(screen.queryByTestId("ticket-form-modal")).toBeNull();
  });

  it("closing the resolve and remarks prompts clears them without posting a status", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();

    await pickStatus(user, "Resolved");
    await user.click(await screen.findByText("close-resolve"));
    expect(screen.queryByTestId("resolve-modal")).toBeNull();

    await pickStatus(user, "Rejected");
    await user.click(await screen.findByText("close-remarks"));
    expect(screen.queryByTestId("remarks-modal")).toBeNull();
    expect(cap.status).toBeUndefined();
  });

  describe("access model: Reassign, Send back, Reopen, stale screens", () => {
    const withTicket = (over) => ticketDetail({ ticket: { ...ticketDetail().ticket, ...over } });

    it("labels the holder 'Assigned to' and the office 'Office'", async () => {
      mockTicketEndpoints();
      renderDetail();
      const info = await screen.findByTestId("ticket-core-info");
      expect(info).toHaveTextContent("Assigned to");
      expect(info).toHaveTextContent("Office");
      expect(screen.getByTestId("ticket-detail").textContent).not.toMatch(/transfer|branch|assignee/i);
    });

    it("hides Reassign when the server says CanReassign 0", async () => {
      mockTicketEndpoints({}, { detail: withTicket({ CanReassign: 0 }) });
      renderDetail();
      await screen.findByTestId("ticket-detail");
      expect(screen.queryByTestId("reassign-ticket-btn")).toBeNull();
    });

    it("has no Send back button when SendBackToId is null", async () => {
      mockTicketEndpoints();
      renderDetail();
      await screen.findByTestId("ticket-detail");
      expect(screen.queryByTestId("send-back-ticket-btn")).toBeNull();
    });

    // Final review m2: a send back is a reassign (gate 3 runs first), so it is
    // never offered where the server would answer "Only a manager can reassign".
    it("no Send back on a record the caller may not reassign, even with a SendBackToId", async () => {
      mockTicketEndpoints({}, { detail: withTicket({ CanReassign: 0, SendBackToId: 16, SendBackToName: "Nitin" }) });
      renderDetail();
      await screen.findByTestId("ticket-detail");
      expect(screen.queryByTestId("send-back-ticket-btn")).toBeNull();
    });

    it("Send back is labelled with the server's name and posts SendBack with remarks only", async () => {
      const cap = mockTicketEndpoints({}, { detail: withTicket({ SendBackToId: 16, SendBackToName: "Nitin" }) });
      renderDetail();
      const user = userEvent.setup();
      const btn = await screen.findByTestId("send-back-ticket-btn");
      expect(btn).toHaveTextContent("Send back to Nitin");

      await user.click(btn);
      expect(screen.getByTestId("remarks-modal")).toHaveTextContent("Send back to Nitin");
      await user.click(screen.getByText("remarks-submit"));
      await waitFor(() => expect(cap.transfer).toEqual({ TicketId: 7, SendBack: true, Remarks: "Customer called back" }));
      expect(cap.transfer).not.toHaveProperty("ReasonId");
      expect(await screen.findByText("Sent back to Nitin")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByTestId("remarks-modal")).toBeNull());
    });

    it("a send back that takes it away drops the cache and returns to the list", async () => {
      let calls = 0;
      mockTicketEndpoints({}, { detail: withTicket({ SendBackToId: 16, SendBackToName: "Nitin" }) });
      server.use(http.post("*/api/tickets/fetchTicketDetail", () => {
        calls += 1;
        return calls === 1 ? json(withTicket({ SendBackToId: 16, SendBackToName: "Nitin" })) : refuse("Complaint not found", 404);
      }));
      renderDetail();
      const user = userEvent.setup();
      await user.click(await screen.findByTestId("send-back-ticket-btn"));
      await user.click(screen.getByText("remarks-submit"));
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/support/tickets"));
      expect(await screen.findByText("Sent back to Nitin")).toBeInTheDocument();
      expect(screen.queryByText("This record is no longer with you")).toBeNull();
    });

    // Review Focus 3: the giver lost the module between load and tap.
    it("a refused send back shows the server's sentence and refetches, so the button goes", async () => {
      let calls = 0;
      mockTicketEndpoints();
      server.use(
        http.post("*/api/tickets/fetchTicketDetail", () => {
          calls += 1;
          return json(calls === 1 ? withTicket({ SendBackToId: 16, SendBackToName: "Nitin" }) : withTicket({}));
        }),
        http.post("*/api/tickets/transferTicket", () => refuse("Nitin can no longer take this. Reassign it instead.", 400)),
      );
      renderDetail();
      const user = userEvent.setup();
      await user.click(await screen.findByTestId("send-back-ticket-btn"));
      await user.click(screen.getByText("remarks-submit"));

      expect(await screen.findByText("Nitin can no longer take this. Reassign it instead.")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByTestId("send-back-ticket-btn")).toBeNull());
      expect(calls).toBeGreaterThan(1);
      expect(mockNavigate).not.toHaveBeenCalledWith("/support/tickets");
    });

    it("Reopen shows when CanReopen and asks for remarks onto the open status", async () => {
      const cap = mockTicketEndpoints({}, { detail: withTicket({ StatusId: 65, StatusName: "Closed", StatusCode: "closed", CanReopen: 1 }) });
      renderDetail();
      const user = userEvent.setup();
      await user.click(await screen.findByTestId("reopen-ticket-btn"));
      expect(screen.getByTestId("remarks-modal")).toHaveTextContent("Reopen complaint");
      await user.click(screen.getByText("remarks-submit"));
      await waitFor(() => expect(cap.status).toEqual({ TicketId: 7, StatusId: 61, Remarks: "Customer called back" }));
    });

    it("hides Edit, Resolve, Escalate and the status select when CanEdit is 0", async () => {
      mockTicketEndpoints({}, { detail: withTicket({ CanEdit: 0 }) });
      renderDetail();
      await screen.findByTestId("ticket-detail");
      for (const id of ["edit-ticket-btn", "resolve-ticket-btn", "escalate-ticket-btn", "ticket-status-select"]) {
        expect(screen.queryByTestId(id)).toBeNull();
      }
    });

    it("shows Edit, Resolve, Escalate and the status select when CanEdit is 1", async () => {
      mockTicketEndpoints({}, { detail: withTicket({ CanEdit: 1 }) });
      renderDetail();
      for (const id of ["edit-ticket-btn", "resolve-ticket-btn", "escalate-ticket-btn", "ticket-status-select"]) {
        expect(await screen.findByTestId(id)).toBeInTheDocument();
      }
    });

    it("no Reopen button without CanReopen", async () => {
      mockTicketEndpoints({}, { detail: withTicket({ StatusId: 65, StatusName: "Closed", StatusCode: "closed", CanReopen: 0 }) });
      renderDetail();
      await screen.findByTestId("ticket-detail");
      expect(screen.queryByTestId("reopen-ticket-btn")).toBeNull();
    });

    // Review Focus 4: someone else moved it while the page was open.
    it("a 404 on a status move from a stale page returns to the list with the record-gone message", async () => {
      mockTicketEndpoints();
      server.use(http.post("*/api/tickets/setTicketStatus", () => refuse("Complaint not found", 404)));
      renderDetail();
      await screen.findByTestId("ticket-detail");
      await pickStatus(userEvent.setup(), "On Hold");
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/support/tickets"));
      expect(await screen.findByText("This record is no longer with you")).toBeInTheDocument();
    });

    it("a 404 on Resolve (from the resolve dialog) does the same", async () => {
      mockTicketEndpoints();
      renderDetail();
      const user = userEvent.setup();
      await user.click(await screen.findByTestId("resolve-ticket-btn"));
      await user.click(screen.getByText("resolve-404"));
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/support/tickets"));
      expect(await screen.findByText("This record is no longer with you")).toBeInTheDocument();
    });

    // 403 = still visible, this action refused: say so and stay.
    it("a 403 on a status move shows the server's message and stays on the complaint", async () => {
      mockTicketEndpoints();
      server.use(http.post("*/api/tickets/setTicketStatus", () => refuse("You cannot change this complaint", 403)));
      renderDetail();
      await screen.findByTestId("ticket-detail");
      await pickStatus(userEvent.setup(), "On Hold");
      expect(await screen.findByText("You cannot change this complaint")).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalledWith("/support/tickets");
      expect(screen.queryByText("This record is no longer with you")).toBeNull();
      expect(screen.getByTestId("ticket-detail")).toBeInTheDocument();
    });

    it("a complaint that is gone on load returns to the list", async () => {
      mockTicketEndpoints();
      server.use(http.post("*/api/tickets/fetchTicketDetail", () => refuse("Complaint not found", 404)));
      renderDetail();
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/support/tickets"));
      expect(await screen.findByText("This record is no longer with you")).toBeInTheDocument();
    });

    it("a reassign that keeps it visible stays on the page", async () => {
      mockTicketEndpoints();
      renderDetail();
      const user = userEvent.setup();
      await user.click(await screen.findByTestId("reassign-ticket-btn"));
      await user.click(screen.getByText("reassigned"));
      await waitFor(() => expect(screen.getByTestId("ticket-detail")).toBeInTheDocument());
      expect(mockNavigate).not.toHaveBeenCalledWith("/support/tickets");
    });

    it("a reassign that takes it away leaves without the record-gone message", async () => {
      let calls = 0;
      mockTicketEndpoints();
      server.use(http.post("*/api/tickets/fetchTicketDetail", () => {
        calls += 1;
        return calls === 1 ? json(ticketDetail()) : refuse("Complaint not found", 404);
      }));
      renderDetail();
      const user = userEvent.setup();
      await user.click(await screen.findByTestId("reassign-ticket-btn"));
      await user.click(screen.getByText("reassigned"));
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/support/tickets"));
      expect(screen.queryByText("This record is no longer with you")).toBeNull();
    });
  });
});
