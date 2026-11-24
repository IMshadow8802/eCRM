import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import TransferTicketModal from "./TransferTicketModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { mockSupportRefData, mockTicketEndpoints, refuse, json } from "../../test/supportMocks";

const pick = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name: new RegExp(`^${name}`) }));
};
const signIn = (reach) => useAuthStore.setState({
  isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM",
  access: { isAdmin: false, modules: { complaints: { view: true, edit: true, reach, assignReach: "Team" } } },
});
const fill = async (user, who = "Sara Khan") => {
  await pick(user, "ticket-reassign-person", who);
  await pick(user, "ticket-reassign-reason", "Absent");
  await user.type(screen.getByTestId("ticket-reassign-remarks"), "Covering");
};
const FORBIDDEN = /transfer|branch|assignee/i;

describe("TransferTicketModal (Reassign)", () => {
  beforeEach(() => { signIn("Own"); mockSupportRefData(); });

  it("asks for the complaint's Can-assign-to list with the ticket id", async () => {
    let body;
    server.use(http.post("*/api/users/fetchAssignableUsers", async ({ request }) => { body = await request.json(); return json({ users: [] }); }));
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    await waitFor(() => expect(body).toEqual({ Module: "complaints", RecordId: 7 }));
  });

  it("reads 'Reassign to Sara' once she is picked, and posts person, reason and remarks", async () => {
    const cap = mockTicketEndpoints();
    const onDone = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={onClose} onDone={onDone} />, { router: false });
    const user = userEvent.setup();

    expect(screen.getByText("Reassign complaint")).toBeInTheDocument();
    expect(screen.getByText("Assigned to")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-reassign-submit")).toBeDisabled();
    expect(screen.getByTestId("ticket-reassign-submit")).toHaveTextContent("Reassign");

    await fill(user);
    expect(screen.getByTestId("ticket-reassign-submit")).toHaveTextContent("Reassign to Sara");
    await user.click(screen.getByTestId("ticket-reassign-submit"));

    await waitFor(() => expect(cap.transfer).toEqual({ TicketId: 7, ToUserId: 18, ToBranchId: null, ReasonId: 36, Remarks: "Covering" }));
    expect(await screen.findByText("Reassigned to Sara Khan")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("never offers Sent back as a reason (only the Send back action writes it)", async () => {
    server.use(http.post("*/api/config/fetchLookups", () => json({ lookups: [
      { Id: 36, Value: "Absent", Code: "absent" }, { Id: 39, Value: "Sent back", Code: "sent_back" },
    ] })));
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("ticket-reassign-reason-input"));
    expect(await screen.findByRole("option", { name: /^Absent/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Sent back/ })).toBeNull();
  });

  it("never says Transfer, Branch or Assignee", async () => {
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    await screen.findByText("Reassign complaint");
    expect(within(screen.getByTestId("reassign-ticket-modal")).queryByText(FORBIDDEN)).toBeNull();
    expect(screen.getByTestId("reassign-ticket-modal").textContent).not.toMatch(FORBIDDEN);
  });

  it("refuses to submit without a reason and without remarks", async () => {
    const cap = mockTicketEndpoints();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-reassign-person", "Amit Singh");
    expect(screen.getByTestId("ticket-reassign-submit")).toBeDisabled();
    await pick(user, "ticket-reassign-reason", "Absent");
    expect(screen.getByTestId("ticket-reassign-submit")).toBeDisabled();
    await user.type(screen.getByTestId("ticket-reassign-remarks"), "   ");
    expect(screen.getByTestId("ticket-reassign-submit")).toBeDisabled();
    expect(cap.transfer).toBeUndefined();
  });

  it("an Own-reach caller gets no Unassigned and no Move to another office", async () => {
    let asked = false;
    server.use(http.post("*/api/users/fetchBranches", () => { asked = true; return json({ branches: [] }); }));
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    await screen.findByText("Reassign complaint");
    expect(screen.queryByText("Move to another office")).toBeNull();
    expect(screen.queryByTestId("ticket-reassign-unassigned")).toBeNull();
    expect(asked).toBe(false);
  });

  it("an Office-reach caller may move it to another office", async () => {
    signIn("Office");
    const cap = mockTicketEndpoints();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    const user = userEvent.setup();
    expect(screen.getByText("Move to another office")).toBeInTheDocument();

    await pick(user, "ticket-reassign-office", "SOUTH EXTENSION");
    await fill(user, "Amit Singh");
    await user.click(screen.getByTestId("ticket-reassign-submit"));
    await waitFor(() => expect(cap.transfer).toMatchObject({ TicketId: 7, ToUserId: 17, ToBranchId: 2 }));
  });

  it("an Office-reach caller may leave it Unassigned", async () => {
    signIn("Company");
    const cap = mockTicketEndpoints();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    fireEvent.click(screen.getByTestId("ticket-reassign-unassigned"));
    await pick(user, "ticket-reassign-reason", "Absent");
    await user.type(screen.getByTestId("ticket-reassign-remarks"), "Back to the queue");
    expect(screen.getByTestId("ticket-reassign-submit")).toHaveTextContent("Leave unassigned");
    await user.click(screen.getByTestId("ticket-reassign-submit"));
    await waitFor(() => expect(cap.transfer).toEqual({ TicketId: 7, ToUserId: null, ToBranchId: null, ReasonId: 36, Remarks: "Back to the queue" }));
    await waitFor(() => expect(screen.getAllByText("Unassigned")).toHaveLength(2));   // the checkbox + the toast
  });

  it("several ids → bulkTransferTickets, titled with the count, worded by the server", async () => {
    const cap = mockTicketEndpoints();
    server.use(http.post("*/api/tickets/bulkTransferTickets", async ({ request }) => {
      cap.bulk = await request.json();
      return json({ Transferred: 2, Skipped: 0, ResponseCode: 200, ResponseMess: "2 complaints reassigned" });
    }));
    const onDone = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7, 8]} onClose={vi.fn()} onDone={onDone} />, { router: false });
    const user = userEvent.setup();

    expect(screen.getByText("Reassign 2 complaints")).toBeInTheDocument();
    await fill(user, "Amit Singh");
    await user.click(screen.getByTestId("ticket-reassign-submit"));

    await waitFor(() => expect(cap.bulk).toEqual({ TicketIds: [7, 8], ToUserId: 17, ToBranchId: null, ReasonId: 36, Remarks: "Covering" }));
    expect(cap.transfer).toBeUndefined();
    expect(await screen.findByText("2 complaints reassigned")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it("asks the bulk Can-assign-to list without a record id", async () => {
    let body;
    server.use(http.post("*/api/users/fetchAssignableUsers", async ({ request }) => { body = await request.json(); return json({ users: [] }); }));
    renderWithProviders(<TransferTicketModal open ticketIds={[7, 8]} onClose={vi.fn()} />, { router: false });
    await waitFor(() => expect(body).toEqual({ Module: "complaints" }));
  });

  // Review Focus 2: all-or-nothing — the refusal with its count reaches the user.
  it("a refused bulk keeps the dialog open and shows the count", async () => {
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/bulkTransferTickets", () => refuse("You cannot reassign some of these complaints (2 of 3 refused)", 403)));
    const onClose = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7, 8, 9]} onClose={onClose} />, { router: false });
    const user = userEvent.setup();
    await fill(user, "Amit Singh");
    await user.click(screen.getByTestId("ticket-reassign-submit"));
    expect(await screen.findByText("You cannot reassign some of these complaints (2 of 3 refused)")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hands a refusal to onError when given, instead of the toast", async () => {
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/transferTicket", () => refuse("Complaint not found", 404)));
    const onError = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} onError={onError} />, { router: false });
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByTestId("ticket-reassign-submit"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0].response.status).toBe(404);
    expect(screen.queryByText("Complaint not found")).toBeNull();
  });

  it("cancel clears the draft", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={onClose} />, { router: false });
    const user = userEvent.setup();
    await pick(user, "ticket-reassign-person", "Sara Khan");
    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId("ticket-reassign-submit")).toHaveTextContent(/^Reassign$/);
  });
});
