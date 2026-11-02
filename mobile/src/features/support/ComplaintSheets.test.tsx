import { createRef } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { logCall } from "../../api/callQueries";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { escalateTicket, fetchEscalationTargets, setTicketStatus, transferTicket } from "../../api/ticketQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { AssignableUser, Lookup, Ticket } from "../../types/api";
import { envelope, serverError, ticket } from "../../test/fixtures";
import { renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { spySheets } from "../../test/sheets";
import { ComplaintSheets, type ComplaintAction, type ComplaintSheetsHandle } from "./ComplaintSheets";

jest.mock("../../api/ticketQueries");
jest.mock("../../api/callQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");

const lookup = (Id: number, Kind: string, Value: string, Code: string | null = null): Lookup => ({
  Id, CompId: 1, Kind, Value, Code, SortOrder: Id, IsActive: true,
});
const STATUSES = [
  lookup(1, LOOKUP_KIND.ticketStatus, "Open", "open"),
  lookup(2, LOOKUP_KIND.ticketStatus, "On hold", "onhold"),
  lookup(3, LOOKUP_KIND.ticketStatus, "Resolved", "resolved"),
  lookup(4, LOOKUP_KIND.ticketStatus, "Closed", "closed"),
  lookup(5, LOOKUP_KIND.ticketStatus, "Rejected", "rejected"),
];
let lookups: Record<string, Lookup[]>;
const priya: AssignableUser = {
  Id: 9, FullName: "Priya Shah", Avatar: null, JobTitle: "Technician", BranchId: 1, BranchName: "Head Office", ReportsTo: null,
};
const vikram: AssignableUser = { ...priya, Id: 11, FullName: "Vikram Singh", JobTitle: "AC Technician", BranchName: "Karol Bagh" };

const mount = async () => {
  const ref = createRef<ComplaintSheetsHandle>();
  await renderWithProviders(<ComplaintSheets ref={ref} />);
  await screen.findByText("Fixed on site");
  await screen.findByText("Priya Shah");
  return (action: ComplaintAction, row: Ticket = ticket()) => act(() => ref.current!.open(action, row));
};

beforeEach(() => {
  seedAuth({ UserId: 42 });
  lookups = {
    [LOOKUP_KIND.ticketStatus]: STATUSES,
    [LOOKUP_KIND.resolution]: [lookup(20, LOOKUP_KIND.resolution, "Fixed on site")],
    [LOOKUP_KIND.transferReason]: [lookup(30, LOOKUP_KIND.transferReason, "Specialist needed")],
    [LOOKUP_KIND.callOutcome]: [lookup(40, LOOKUP_KIND.callOutcome, "No answer")],
  };
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => lookups[Kind] ?? []);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([priya, vikram]);
  jest.mocked(fetchEscalationTargets).mockResolvedValue([
    { Id: 5, FullName: "Neha Kapoor", JobTitle: "Support Head", Depth: 1 } as never,
  ]);
  const ok = envelope(null);
  jest.mocked(setTicketStatus).mockResolvedValue(ok);
  jest.mocked(transferTicket).mockResolvedValue(ok);
  jest.mocked(escalateTicket).mockResolvedValue(ok);
  jest.mocked(logCall).mockResolvedValue(envelope({ Id: 1 }));
});

describe("Resolve (13)", () => {
  it("needs a resolution and remarks, then moves to the company's resolved status", async () => {
    const { present, dismiss } = spySheets();
    const open = await mount();
    await open("resolve");
    expect(present).toHaveBeenCalled();
    expect(screen.getByText("Resolve complaint")).toBeOnTheScreen();
    expect(screen.getAllByText("T-7 · Inverter keeps tripping")[0]).toBeOnTheScreen();
    expect(screen.getByText("Required. Shows in the complaint history.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
    expect(screen.getByText("Pick a resolution.")).toBeOnTheScreen();
    expect(screen.getByText("Remarks are required to resolve.")).toBeOnTheScreen();
    expect(setTicketStatus).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("radio", { name: "Fixed on site" }));
    await fireEvent.changeText(screen.getByTestId("resolve-remarks"), "  Gas topped up  ");
    await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 3, ResolutionId: 20, Remarks: "Gas topped up" }),
    );
    expect(await screen.findByText("Status changed to Resolved")).toBeOnTheScreen();
    expect(dismiss).toHaveBeenCalled();
  });
});

it("a dismissed Resolve or Transfer sheet forgets what was typed", async () => {
  const open = await mount();
  await open("resolve");
  await fireEvent.changeText(screen.getByTestId("resolve-remarks"), "half typed");
  await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
  await fireEvent(screen.getByText("Resolve complaint"), "dismiss");
  expect(screen.getByTestId("resolve-remarks").props.value).toBe("");
  expect(screen.queryByText("Pick a resolution.")).toBeNull();

  await open("transfer");
  await fireEvent.changeText(screen.getByTestId("transfer-search"), "pri");
  await fireEvent.changeText(screen.getByTestId("transfer-remarks"), "half typed");
  await fireEvent(screen.getByText("Transfer complaint"), "dismiss");
  expect(screen.getByTestId("transfer-remarks").props.value).toBe("");
  expect(screen.getByTestId("transfer-search").props.value).toBe("");
});

describe("status moves", () => {
  it("On hold opens its sheet preselected; remarks are optional; nothing is sent until submit", async () => {
    const { present } = spySheets();
    const open = await mount();
    await open("hold");
    expect(present).toHaveBeenCalledTimes(1);
    expect(setTicketStatus).not.toHaveBeenCalled();
    expect(screen.getAllByText("Put on hold").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole("button", { name: "Put on hold" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 2, ResolutionId: null, Remarks: null }),
    );
  });

  it("Close from an active status asks for a resolution and remarks", async () => {
    const open = await mount();
    await open("close");
    expect(screen.getByRole("button", { name: "Close complaint" })).toBeDisabled();
    const pills = screen.getAllByRole("radio", { name: "Fixed on site" });
    await fireEvent.press(pills[pills.length - 1]!);
    await fireEvent.changeText(screen.getByTestId("compose-remarks"), "Customer confirmed");
    await fireEvent.press(screen.getByRole("button", { name: "Close complaint" }));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 4, ResolutionId: 20, Remarks: "Customer confirmed" }),
    );
  });

  it("Reopen needs remarks and shows the server's refusal, never pre-empts it", async () => {
    jest.mocked(setTicketStatus).mockRejectedValue(serverError(403, "Reopening requires a manager"));
    const open = await mount();
    await open("reopen", ticket({ StatusCode: "resolved", StatusId: 3 }));
    expect(screen.getByText("Reopen complaint")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId("compose-remarks"), "Came back");
    await fireEvent.press(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByText("Reopening requires a manager")).toBeOnTheScreen();
    expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 1, ResolutionId: null, Remarks: "Came back" });
  });

  it("Reject needs remarks; a status the company lacks is named, not sent", async () => {
    lookups[LOOKUP_KIND.ticketStatus] = STATUSES.filter((s) => s.Code !== "onhold");
    const open = await mount();
    await open("reject");
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    await open("hold");
    expect(await screen.findByText("That status is not set up for your company. Add it on the web first.")).toBeOnTheScreen();
  });
});

describe("Transfer (23)", () => {
  it("person, reason and remarks are required, each said inline after a submit", async () => {
    const open = await mount();
    await open("transfer", ticket({ AssignedTo: 42, AssigneeName: "Ayush Mishra", DueAt: "2026-11-02T12:40:00" }));
    expect(screen.getByText("T-7 · now with Ayush Mishra")).toBeOnTheScreen();
    expect(screen.getByText(/^Due stays .*A transfer never moves the TAT clock\.$/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Transfer" }));
    expect(screen.getByText("Pick who it goes to.")).toBeOnTheScreen();
    expect(screen.getByText("Pick a reason.")).toBeOnTheScreen();
    expect(screen.getByText("Remarks are required for a transfer.")).toBeOnTheScreen();
    expect(transferTicket).not.toHaveBeenCalled();
  });

  it("filters people in reach, then sends the controller's payload", async () => {
    const open = await mount();
    await open("transfer");
    expect(screen.getByText("Technician · Head Office")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("transfer-search"), "karol");
    expect(screen.queryByText("Priya Shah")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("transfer-search"), "zzz");
    expect(screen.getByText("Nobody matches.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("transfer-search"), "");
    await fireEvent.press(screen.getByRole("radio", { name: "Priya Shah" }));
    expect(screen.getByPlaceholderText("Tell Priya what has been tried")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "Specialist needed" }));
    await fireEvent.changeText(screen.getByTestId("transfer-remarks"), "Tried a reset");
    await fireEvent.press(screen.getByRole("button", { name: "Transfer to Priya Shah" }));
    await waitFor(() =>
      expect(transferTicket).toHaveBeenCalledWith({ TicketId: 7, ToUserId: 9, ToBranchId: null, ReasonId: 30, Remarks: "Tried a reset" }),
    );
    expect(await screen.findByText("Transferred to Priya Shah")).toBeOnTheScreen();
  });

  it("a failed transfer says why", async () => {
    jest.mocked(transferTicket).mockRejectedValue(serverError(403, "Not in your reach"));
    const open = await mount();
    await open("transfer");
    await fireEvent.press(screen.getByRole("radio", { name: "Vikram Singh" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Specialist needed" }));
    await fireEvent.changeText(screen.getByTestId("transfer-remarks"), "x");
    await fireEvent.press(screen.getByRole("button", { name: "Transfer to Vikram Singh" }));
    expect(await screen.findByText("Not in your reach")).toBeOnTheScreen();
  });
});

describe("Escalate", () => {
  it("lists the chain above the assignee and sends who and why", async () => {
    const open = await mount();
    await open("escalate", ticket({ AssignedTo: 42, AssigneeName: "Ayush Mishra" }));
    expect(await screen.findByText("Direct manager · Support Head")).toBeOnTheScreen();
    expect(fetchEscalationTargets).toHaveBeenCalledWith(42);
    await fireEvent.press(screen.getByRole("radio", { name: "Neha Kapoor" }));
    await fireEvent.press(screen.getByRole("button", { name: "Escalate to Neha Kapoor" }));
    expect(screen.getByText("Say why it needs a senior.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("escalate-remarks"), "Customer called twice");
    await fireEvent.press(screen.getByRole("button", { name: "Escalate to Neha Kapoor" }));
    await waitFor(() =>
      expect(escalateTicket).toHaveBeenCalledWith({ TicketId: 7, ToUserId: 5, Remarks: "Customer called twice" }),
    );
    expect(await screen.findByText("Escalated to Neha Kapoor")).toBeOnTheScreen();
  });

  it("a failed escalation says why; nobody above says so", async () => {
    jest.mocked(escalateTicket).mockRejectedValue(serverError(400, "Not an ancestor"));
    jest.mocked(fetchEscalationTargets).mockResolvedValueOnce([]);
    const open = await mount();
    await open("escalate");
    expect(await screen.findByText("You have nobody above you in the reporting chain.")).toBeOnTheScreen();
  });
});

describe("Log call (24)", () => {
  const fill = async (notes = "Unit trips after 10 min") => {
    await fireEvent.changeText(screen.getByTestId("logcall-notes"), notes);
  };

  it("logs the call, then chains On hold through setTicketStatus", async () => {
    const open = await mount();
    await open("call", ticket({ ContactPerson: "Rakesh Sharma", Contact: "98250 12345" }));
    expect(screen.getByText("Rakesh Sharma · 98250 12345")).toBeOnTheScreen();
    await fill();
    await fireEvent.press(screen.getByRole("radio", { name: "Put on hold" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith({ TicketId: 7, Direction: "out", OutcomeId: null, Notes: "Unit trips after 10 min", Duration: 1 }),
    );
    await waitFor(() => expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 2 }));
  });

  it("Then Resolve opens the Resolve sheet; Keep open just logs it", async () => {
    const { present } = spySheets();
    const open = await mount();
    await open("call");
    await fill();
    await fireEvent.press(screen.getByRole("radio", { name: "Resolve" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    await waitFor(() => expect(present).toHaveBeenCalledTimes(2));
    expect(setTicketStatus).not.toHaveBeenCalled();

    await open("call");
    await fill("Called back");
    await fireEvent.press(screen.getByRole("radio", { name: "Keep open" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    expect(await screen.findByText("Call logged")).toBeOnTheScreen();
  });

  it("No answer is out + the outcome with no duration; a failure stays in the sheet", async () => {
    jest.mocked(logCall).mockRejectedValue(serverError(403, "No write access"));
    const open = await mount();
    await open("call", ticket({ StatusCode: "onhold" }));
    expect(screen.queryByRole("radio", { name: "Put on hold" })).toBeNull();
    await fireEvent.press(screen.getByRole("tab", { name: "No answer" }));
    await fill("Rang out");
    await fireEvent.press(screen.getByRole("button", { name: "Save call" }));
    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith({ TicketId: 7, Direction: "out", OutcomeId: 40, Notes: "Rang out", Duration: null }),
    );
    expect(await screen.findByText("No write access")).toBeOnTheScreen();
  });

  it("no Then on a terminal complaint", async () => {
    const open = await mount();
    await open("call", ticket({ StatusCode: "closed" }));
    expect(screen.queryByText("Then")).toBeNull();
  });
});
