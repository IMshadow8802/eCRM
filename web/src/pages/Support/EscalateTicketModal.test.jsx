import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import EscalateTicketModal from "./EscalateTicketModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { json, refuse, mockSupportRefData, mockTicketEndpoints, ticketRow } from "../../test/supportMocks";

const renderModal = (props = {}) =>
  renderWithProviders(
    <EscalateTicketModal open onClose={vi.fn()} ticket={ticketRow()} onDone={vi.fn()} {...props} />,
    { router: false },
  );

describe("EscalateTicketModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
  });

  // The chain is the holder's, answered by the server for this complaint.
  it("lists the complaint's chain, nearest first, and posts the escalation", async () => {
    const cap = mockTicketEndpoints();
    let askedFor;
    server.use(http.post("*/api/tickets/fetchEscalationTargets", async ({ request }) => {
      askedFor = await request.json();
      return json({ users: [
        { Id: 16, FullName: "Neha Verma", JobTitle: "Team Lead", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 1 },
        { Id: 15, FullName: "Rahul Mehta", JobTitle: "Branch Manager", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 2 },
      ] });
    }));
    const onDone = vi.fn();
    renderModal({ onDone });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("escalate-target-input"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Neha Verma · Team Lead", "Rahul Mehta · Branch Manager"]);
    expect(askedFor).toEqual({ TicketId: 7 });

    await user.click(options[0]);
    await user.type(screen.getByTestId("escalate-remarks"), "Customer is threatening to cancel");
    await user.click(screen.getByTestId("escalate-submit"));

    await waitFor(() => expect(cap.escalate).toBeTruthy());
    expect(cap.escalate).toEqual({ TicketId: 7, ToUserId: 16, Remarks: "Customer is threatening to cancel" });
    expect(onDone).toHaveBeenCalled();
  });

  // Review N3: an empty chain is a sentence, not an empty select.
  it("says nobody above the holder can open complaints when the chain is empty", async () => {
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/fetchEscalationTargets", () => json({ users: [] })));
    renderModal();
    expect(await screen.findByTestId("escalate-nobody"))
      .toHaveTextContent("Nobody above Amit Singh can open complaints. Reassign it or tell a manager.");
    expect(screen.queryByTestId("escalate-target")).toBeNull();
    expect(screen.getByTestId("escalate-submit")).toBeDisabled();
  });

  it("an unheld complaint asks by ticket too, and the empty sentence speaks to the caller", async () => {
    mockTicketEndpoints();
    let askedFor;
    server.use(http.post("*/api/tickets/fetchEscalationTargets", async ({ request }) => {
      askedFor = await request.json();
      return json({ users: [] });
    }));
    renderModal({ ticket: ticketRow({ AssignedTo: null, AssigneeName: null }) });
    expect(await screen.findByTestId("escalate-nobody")).toHaveTextContent("Nobody above you can open complaints.");
    expect(askedFor).toEqual({ TicketId: 7 });
  });

  it("hands a refusal to onError when given", async () => {
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/escalateTicket", () => refuse("Complaint not found", 404)));
    const onError = vi.fn();
    renderModal({ onError });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("escalate-target-input"));
    await user.click(await screen.findByRole("option", { name: /Neha Verma/ }));
    await user.type(screen.getByTestId("escalate-remarks"), "Please look");
    await user.click(screen.getByTestId("escalate-submit"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(screen.queryByText("Complaint not found")).toBeNull();
  });

  it("refuses without a target and without remarks, and surfaces the SP's refusal", async () => {
    const cap = mockTicketEndpoints();
    renderModal();
    const user = userEvent.setup();

    expect(screen.getByTestId("escalate-submit")).toBeDisabled();
    await user.click(screen.getByTestId("escalate-target-input"));
    await user.click(await screen.findByRole("option", { name: /Neha Verma/ }));
    expect(screen.getByTestId("escalate-submit")).toBeDisabled();   // remarks still missing
    expect(cap.escalate).toBeUndefined();

    server.use(http.post("*/api/tickets/escalateTicket", () => refuse("Only open complaints can be escalated", 400)));
    await user.type(screen.getByTestId("escalate-remarks"), "Please look at this");
    await user.click(screen.getByTestId("escalate-submit"));
    expect(await screen.findByText("Only open complaints can be escalated")).toBeInTheDocument();
  });
});
