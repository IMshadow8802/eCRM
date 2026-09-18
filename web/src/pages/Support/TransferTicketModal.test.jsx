import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import TransferTicketModal from "./TransferTicketModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { mockSupportRefData, mockTicketEndpoints, refuse, json } from "../../test/supportMocks";

const pick = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name }));
};

describe("TransferTicketModal", () => {
  beforeEach(() => {
    // Braces, not a bare arrow: vitest treats a hook's RETURN value as its
    // cleanup function, and setState returns undefined — but mockReset()
    // returns the mock, which vitest would then call after every test.
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
  });

  it("posts transferTicket with the person, the reason and the remarks", async () => {
    mockSupportRefData();
    const cap = mockTicketEndpoints();
    const onDone = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={onClose} onDone={onDone} />, { router: false });
    const user = userEvent.setup();

    expect(screen.getByText("Transfer complaint")).toBeInTheDocument();
    await pick(user, "ticket-transfer-assignee", "Sara Khan");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "On leave this week");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    await waitFor(() => expect(cap.transfer).toBeTruthy());
    expect(cap.transfer).toEqual({ TicketId: 7, ToUserId: 18, ToBranchId: null, ReasonId: 36, Remarks: "On leave this week" });
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // Spec §6 regression: the assignment history is only readable by whoever
  // inherits the complaint if BOTH are there. The SP refuses too; this saves
  // the round-trip and says so before the click.
  it("refuses to submit without a reason and without remarks", async () => {
    mockSupportRefData();
    const cap = mockTicketEndpoints();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-assignee", "Amit Singh");
    expect(screen.getByTestId("ticket-transfer-submit")).toBeDisabled();

    await pick(user, "ticket-transfer-reason", "Absent");
    expect(screen.getByTestId("ticket-transfer-submit")).toBeDisabled();   // remarks still missing

    await user.type(screen.getByTestId("ticket-transfer-remarks"), "   ");
    expect(screen.getByTestId("ticket-transfer-submit")).toBeDisabled();   // whitespace is not remarks

    await user.click(screen.getByTestId("ticket-transfer-submit"));
    expect(cap.transfer).toBeUndefined();
  });

  it("cross-branch: picking a branch reloads that branch's roster and sends ToBranchId", async () => {
    mockSupportRefData();
    const cap = mockTicketEndpoints();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-branch", "SOUTH EXTENSION");
    await pick(user, "ticket-transfer-assignee", "Vikram Rao");
    await pick(user, "ticket-transfer-reason", "Wrong branch");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Customer is in Kalkaji");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    await waitFor(() => expect(cap.transfer).toBeTruthy());
    expect(cap.transfer).toMatchObject({ TicketId: 7, ToUserId: 20, ToBranchId: 2, ReasonId: 38 });
  });

  it("several ids → bulkTransferTickets with the id list", async () => {
    mockSupportRefData();
    const cap = mockTicketEndpoints();
    const onDone = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7, 8]} onClose={vi.fn()} onDone={onDone} />, { router: false });
    const user = userEvent.setup();

    expect(screen.getByText("Reassign 2 complaints")).toBeInTheDocument();
    await pick(user, "ticket-transfer-assignee", "Amit Singh");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Covering");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    await waitFor(() => expect(cap.bulk).toBeTruthy());
    expect(cap.bulk).toEqual({ TicketIds: [7, 8], ToUserId: 17, ToBranchId: null, ReasonId: 36, Remarks: "Covering" });
    expect(cap.transfer).toBeUndefined();
    expect(onDone).toHaveBeenCalled();
  });

  // Fix round 1: sp_BulkTransferTickets legitimately skips a complaint
  // already sitting with the target user/branch — that is a 200, not a
  // failure, and must not read as "it moved" when nothing did.
  it("bulk transfer that skipped everyone tells the user nothing moved, not that it succeeded", async () => {
    mockSupportRefData();
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/bulkTransferTickets", () =>
      json({ Transferred: 0, Skipped: 2, ResponseCode: 200, ResponseMess: "0 complaint(s) transferred — already with that person" })));
    const onDone = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7, 8]} onClose={vi.fn()} onDone={onDone} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-assignee", "Amit Singh");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Just checking");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    expect(await screen.findByText("0 complaint(s) transferred — already with that person")).toBeInTheDocument();
    expect(screen.queryByText("Complaints transferred")).not.toBeInTheDocument();
    expect(screen.queryByText("Complaint transferred")).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it("bulk transfer that partially moved tells the user both counts", async () => {
    mockSupportRefData();
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/bulkTransferTickets", () =>
      json({ Transferred: 1, Skipped: 1, ResponseCode: 200, ResponseMess: "1 complaint transferred, 1 already with that person" })));
    renderWithProviders(<TransferTicketModal open ticketIds={[7, 8]} onClose={vi.fn()} onDone={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-assignee", "Amit Singh");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Covering");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    expect(await screen.findByText("1 complaint transferred, 1 already with that person")).toBeInTheDocument();
  });

  // Happy path pinned: everyone moved, the server's own success wording reaches the user.
  it("bulk transfer where everyone moved reports the server's success message", async () => {
    mockSupportRefData();
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/bulkTransferTickets", () =>
      json({ Transferred: 2, Skipped: 0, ResponseCode: 200, ResponseMess: "2 complaint(s) transferred" })));
    const onDone = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7, 8]} onClose={vi.fn()} onDone={onDone} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-assignee", "Amit Singh");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Covering");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    expect(await screen.findByText("2 complaint(s) transferred")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it("keeps the modal open and shows the server's refusal", async () => {
    mockSupportRefData();
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/transferTicket", () => refuse("You cannot assign records to that user", 403)));
    const onClose = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={onClose} onDone={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-assignee", "Sara Khan");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Please take this");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    expect(await screen.findByText("You cannot assign records to that user")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("transfer-ticket-modal")).toBeInTheDocument();
  });
});
