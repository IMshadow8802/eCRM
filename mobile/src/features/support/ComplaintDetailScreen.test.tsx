import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";

import { fetchCalls, logCall } from "../../api/callQueries";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import {
  deleteTicket,
  escalateTicket,
  fetchEscalationTargets,
  fetchTicketDetail,
  setTicketStatus,
  transferTicket,
} from "../../api/ticketQueries";
import { fetchAssignableUsers, fetchUserDirectory } from "../../api/userQueries";
import type { AssignableUser, Lookup, Ticket, TicketDetail } from "../../types/api";
import { envelope, ticket } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import ComplaintDetailScreen from "./ComplaintDetailScreen";

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
const LOOKUPS: Record<string, Lookup[]> = {
  [LOOKUP_KIND.ticketStatus]: STATUSES,
  [LOOKUP_KIND.resolution]: [lookup(20, LOOKUP_KIND.resolution, "Fixed on site")],
  [LOOKUP_KIND.transferReason]: [lookup(30, LOOKUP_KIND.transferReason, "On leave")],
  [LOOKUP_KIND.callOutcome]: [lookup(40, LOOKUP_KIND.callOutcome, "Reached")],
};

const priya: AssignableUser = {
  Id: 9, FullName: "Priya Shah", Avatar: null, JobTitle: "Technician",
  BranchId: 1, BranchName: "Head Office", ReportsTo: null,
};

const detail = (row: Ticket | null = ticket(), extra: Partial<TicketDetail> = {}): TicketDetail => ({
  ticket: row, fields: [], activity: [], assignments: [], linkedLead: null, ...extra,
});

/** A rejected request the way the client's interceptor hands it on. */
const httpError = (status: number, message?: string) =>
  new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { message },
  } as AxiosResponse);

const mount = (navigation = makeNavigation<"ComplaintDetail">()) =>
  renderWithProviders(
    <ComplaintDetailScreen navigation={navigation} route={makeRoute("ComplaintDetail", { ticketId: 7 })} />,
  );

/**
 * Waits for the row and the pickers. The bottom-sheet mock renders every
 * sheet's content, so a sheet's rows are pressable without presenting it.
 */
const loaded = async () => {
  expect(await screen.findByText("Inverter keeps tripping")).toBeOnTheScreen();
  // The sheets are built from the lookups, which land separately.
  await screen.findByText("Rejected");
  await screen.findByText("Reached");
  await screen.findAllByText("Priya Shah");
};

beforeEach(() => {
  seedAuth({ UserId: 42 });
  jest.mocked(fetchTicketDetail).mockResolvedValue(detail());
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => LOOKUPS[Kind] ?? []);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([priya]);
  jest.mocked(fetchUserDirectory).mockResolvedValue([
    { Id: 42, FullName: "Test User", Username: null, Avatar: null, JobTitle: null },
  ]);
  jest.mocked(fetchCalls).mockResolvedValue([]);
  jest.mocked(fetchEscalationTargets).mockResolvedValue([]);
  const ok = envelope(null);
  jest.mocked(setTicketStatus).mockResolvedValue(ok);
  jest.mocked(transferTicket).mockResolvedValue(ok);
  jest.mocked(escalateTicket).mockResolvedValue(ok);
  jest.mocked(logCall).mockResolvedValue(envelope({ Id: 1 }));
  jest.mocked(deleteTicket).mockResolvedValue(ok);
});

describe("when the complaint cannot be shown", () => {
  it("a 404 says it is not available, not to check the connection", async () => {
    jest.mocked(fetchTicketDetail).mockRejectedValue(httpError(404));
    await mount();
    expect(await screen.findByText("Complaint not available")).toBeOnTheScreen();
    expect(screen.queryByText(/Check your connection/)).toBeNull();
  });

  it("a resolved detail with no ticket row is treated the same way", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(null));
    await mount();
    expect(await screen.findByText("Complaint not available")).toBeOnTheScreen();
  });

  it("a server fault offers a retry", async () => {
    jest.mocked(fetchTicketDetail).mockRejectedValue(httpError(500));
    await mount();
    expect(
      await screen.findByText("The complaint could not be loaded. Check your connection and try again."),
    ).toBeOnTheScreen();
  });
});

describe("an open complaint", () => {
  it("renders the status chips and the facts off the row", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(
        ticket({
          PriorityName: "High",
          DueAt: "2099-01-01T00:00:00",
          EscalatedTo: 50,
          EscalatedToName: "Ravi Mehta",
          AssigneeName: "Priya Shah",
          AssignedTo: 9,
          CategoryName: "Wiring",
          ContactPerson: "Mr Sharma",
          Contact: "9825012345",
          PreviousTickets: 2,
          ResolutionName: "Fixed on site",
          Description: "Trips every evening",
        }),
        {
          fields: [
            { FieldId: 1, Label: "Serial", Type: "text", ValueText: "SN-1", ValueNumber: null, ValueDate: null },
            { FieldId: 2, Label: "Warranty", Type: "checkbox", ValueText: "true", ValueNumber: null, ValueDate: null },
            { FieldId: 3, Label: "Units", Type: "number", ValueText: null, ValueNumber: 4, ValueDate: null },
            { FieldId: 4, Label: "Installed", Type: "date", ValueText: null, ValueNumber: null, ValueDate: "2026-01-05T00:00:00" },
          ] as TicketDetail["fields"],
          linkedLead: { Id: 11, Name: "Sharma lead", MobileNo: null, Email: "s@x.in" } as TicketDetail["linkedLead"],
        },
      ),
    );
    await mount();
    expect(await screen.findByText("Inverter keeps tripping")).toBeOnTheScreen();
    expect(screen.getByText("T-7 · Open")).toBeOnTheScreen();
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Due in/).length).toBeGreaterThan(0);
    // The chip, and the menu's Escalate sublabel.
    expect(screen.getAllByText("Escalated to Ravi Mehta")).toHaveLength(2);
    expect(screen.getByText("Sharma Traders")).toBeOnTheScreen();
    expect(screen.getByText("9825012345 · 2 previous")).toBeOnTheScreen();
    expect(screen.getByText("Mr Sharma · 9825012345")).toBeOnTheScreen();
    expect(screen.getByText("Wiring")).toBeOnTheScreen();
    expect(screen.getByText("Trips every evening")).toBeOnTheScreen();
    expect(screen.getByText("SN-1")).toBeOnTheScreen();
    expect(screen.getByText("Yes")).toBeOnTheScreen();
    expect(screen.getByText("4")).toBeOnTheScreen();
    expect(screen.getByText("2026-01-05")).toBeOnTheScreen();
    expect(screen.getByText("Sharma lead")).toBeOnTheScreen();
    expect(screen.getByText("s@x.in")).toBeOnTheScreen();
  });

  it("picking an active status moves it straight away", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("On hold"));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith(
        { TicketId: 7, StatusId: 2 },
        expect.anything(),
      ),
    );
  });

  it("picking Resolved asks for a resolution and remarks, then sends both", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Resolved"));
    expect(await screen.findByText("Mark as Resolved")).toBeOnTheScreen();
    expect(setTicketStatus).not.toHaveBeenCalled();

    await fireEvent.press(screen.getAllByText("Fixed on site")[0]!);
    await fireEvent.changeText(screen.getByPlaceholderText("Why — this goes on the history"), " replaced relay ");
    await fireEvent.press(screen.getByText("Update status"));

    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith(
        { TicketId: 7, StatusId: 3, ResolutionId: 20, Remarks: "replaced relay" },
        expect.anything(),
      ),
    );
  });

  it("Closed straight from open also needs a resolution", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Closed"));
    expect(await screen.findByText("Mark as Closed")).toBeOnTheScreen();
    // Without the resolution chip the submit is held back.
    await fireEvent.changeText(screen.getByPlaceholderText("Why — this goes on the history"), "done");
    await fireEvent.press(screen.getByText("Update status"));
    expect(setTicketStatus).not.toHaveBeenCalled();
  });

  it("a rejected status move shows the server's own message", async () => {
    jest.mocked(setTicketStatus).mockRejectedValue(httpError(400, "Resolution is required"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("On hold"));
    expect(await screen.findByLabelText("Resolution is required")).toBeOnTheScreen();
  });

  it("transfer sends the reason and remarks", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Priya Shah"));
    expect(await screen.findByText("Transfer to Priya Shah")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("On leave"));
    await fireEvent.changeText(screen.getByPlaceholderText("Anything the next person should know"), "covering");
    await fireEvent.press(screen.getAllByText("Transfer").at(-1)!);
    // parity: CMP-01 — same-office assignee only; the cross-office auto-ToBranchId is a known bug, not pinned.
    await waitFor(() =>
      expect(transferTicket).toHaveBeenCalledWith(
        { TicketId: 7, ToUserId: 9, ToBranchId: null, ReasonId: 30, Remarks: "covering" },
        expect.anything(),
      ),
    );
  });

  it("a failed transfer says why", async () => {
    jest.mocked(transferTicket).mockRejectedValue(httpError(403, "Not in your team"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Priya Shah"));
    await fireEvent.press(screen.getByText("On leave"));
    await fireEvent.changeText(screen.getByPlaceholderText("Anything the next person should know"), "x");
    await fireEvent.press(screen.getAllByText("Transfer").at(-1)!);
    expect(await screen.findByLabelText("Not in your team")).toBeOnTheScreen();
  });

  it("escalate goes to a senior from the assignee's chain with a reason", async () => {
    jest.mocked(fetchEscalationTargets).mockResolvedValue([
      { Id: 50, FullName: "Ravi Mehta", JobTitle: "Lead", BranchId: 1, BranchName: null, Depth: 1 },
    ]);
    await mount();
    expect(await screen.findByText("Ravi Mehta")).toBeOnTheScreen();
    expect(screen.getByText("Direct manager · Lead")).toBeOnTheScreen();
    expect(fetchEscalationTargets).toHaveBeenCalledWith(42);
    await fireEvent.press(screen.getByText("Ravi Mehta"));
    await fireEvent.changeText(
      screen.getByPlaceholderText("What they need to know — they get a notification"),
      "two days late",
    );
    await fireEvent.press(screen.getAllByText("Escalate").at(-1)!);
    await waitFor(() =>
      expect(escalateTicket).toHaveBeenCalledWith(
        { TicketId: 7, ToUserId: 50, Remarks: "two days late" },
        expect.anything(),
      ),
    );
  });

  it("a failed escalation says why", async () => {
    jest.mocked(fetchEscalationTargets).mockResolvedValue([
      { Id: 50, FullName: "Ravi Mehta", JobTitle: null, BranchId: 1, BranchName: null, Depth: 2 },
    ]);
    jest.mocked(escalateTicket).mockRejectedValue(httpError(400, "Already escalated"));
    await mount();
    await fireEvent.press(await screen.findByText("Ravi Mehta"));
    expect(screen.getByText("2 levels up")).toBeOnTheScreen();
    await fireEvent.changeText(
      screen.getByPlaceholderText("What they need to know — they get a notification"),
      "x",
    );
    await fireEvent.press(screen.getAllByText("Escalate").at(-1)!);
    expect(await screen.findByLabelText("Already escalated")).toBeOnTheScreen();
  });

  it("logs a call with direction, outcome, notes and minutes", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Outgoing"));
    await fireEvent.press(screen.getByText("Reached"));
    await fireEvent.changeText(screen.getByPlaceholderText("What was said"), "will visit");
    await fireEvent.changeText(screen.getByPlaceholderText("0"), "5");
    await fireEvent.press(screen.getByText("Log call"));
    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith(
        { TicketId: 7, Direction: "out", OutcomeId: 40, Notes: "will visit", Duration: 5 },
        expect.anything(),
      ),
    );
  });

  it("a failed call log shows the reason inside the sheet", async () => {
    jest.mocked(logCall).mockRejectedValue(httpError(500, "Call log failed"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Incoming"));
    await fireEvent.press(screen.getByText("Log call"));
    expect(await screen.findByText("Call log failed")).toBeOnTheScreen();
    expect(logCall).toHaveBeenCalledWith(
      { TicketId: 7, Direction: "in", OutcomeId: null, Notes: null, Duration: null },
      expect.anything(),
    );
  });

  it("Delete asks first, then deletes and goes back", async () => {
    const navigation = makeNavigation<"ComplaintDetail">();
    await mount(navigation);
    await loaded();
    expect(screen.queryByText("Delete this complaint?")).toBeNull();
    await fireEvent.press(screen.getByText("Delete complaint"));
    expect(await screen.findByText("Delete this complaint?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Delete"));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(deleteTicket).toHaveBeenCalledWith({ Id: 7 }, expect.anything());
  });

  it("a failed delete stays on screen and says why", async () => {
    jest.mocked(deleteTicket).mockRejectedValue(httpError(409, "It has open calls"));
    const navigation = makeNavigation<"ComplaintDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.press(screen.getByText("Delete complaint"));
    await fireEvent.press(screen.getByText("Delete"));
    expect(await screen.findByLabelText("It has open calls")).toBeOnTheScreen();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("Edit opens the form for this complaint", async () => {
    const navigation = makeNavigation<"ComplaintDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.press(screen.getByText("Edit complaint"));
    expect(navigation.navigate).toHaveBeenCalledWith("ComplaintForm", { ticketId: 7 });
  });

  it("History weaves activity and calls together, dropping the duplicate call row", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket(), {
        activity: [
          { Id: 1, TicketId: 7, UserId: 42, UserName: "Test User", UserAvatar: null, Type: "created", Summary: "Complaint raised", MetaJSON: null, CreatedAt: "2026-11-01T10:00:00" },
          { Id: 2, TicketId: 7, UserId: 42, UserName: null, UserAvatar: null, Type: "call", Summary: "Outbound call logged", MetaJSON: null, CreatedAt: "2026-11-01T11:00:00" },
          { Id: 3, TicketId: 7, UserId: null, UserName: null, UserAvatar: null, Type: "something_new", Summary: null, MetaJSON: null, CreatedAt: "2026-11-01T12:00:00" },
        ],
      }),
    );
    jest.mocked(fetchCalls).mockResolvedValue([
      { Id: 5, CompId: 1, LeadId: null, TicketId: 7, UserId: 42, Direction: "out", OutcomeId: 40, Notes: "Spoke to owner", Duration: 3, CalledAt: "2026-11-01T11:00:00", CreatedBy: 42, CreatedAt: "2026-11-01T11:00:00" },
      { Id: 6, CompId: 1, LeadId: null, TicketId: 7, UserId: 77, Direction: "in", OutcomeId: null, Notes: null, Duration: null, CalledAt: "2026-11-01T13:00:00", CreatedBy: 77, CreatedAt: "2026-11-01T13:00:00" },
    ]);
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("History"));
    expect(await screen.findByText("Complaint raised")).toBeOnTheScreen();
    expect(screen.getByText("Spoke to owner")).toBeOnTheScreen();
    expect(screen.getByText("Incoming call")).toBeOnTheScreen();
    // An unknown activity type still gets a node, titled by its type.
    expect(screen.getByText("something_new")).toBeOnTheScreen();
    expect(screen.queryByText("Outbound call logged")).toBeNull();
    expect(screen.getByText(/^Test User · Reached · 3 min/)).toBeOnTheScreen();
    // An activity row with no author, and a call by someone not in the directory.
    expect(screen.getAllByText(/^System ·/)).toHaveLength(2);
  });

  it("History with nothing on it says so", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("History"));
    expect(await screen.findByText("Nothing has happened yet.")).toBeOnTheScreen();
  });
});

describe("a terminal complaint", () => {
  const resolved = ticket({ StatusId: 3, StatusName: "Resolved", StatusCode: "resolved", AssignedTo: 9, AssigneeName: "Priya Shah" });

  it("offers a reopen, and sends remarks — the reopen gate is the server's", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(resolved));
    jest.mocked(setTicketStatus).mockRejectedValue(httpError(403, "Reopening requires a manager"));
    await mount();
    await loaded();
    // No escalate entry once terminal; the SP refuses it anyway.
    expect(screen.queryByText("Flag a senior — it stays with the assignee")).toBeNull();
    expect(fetchEscalationTargets).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("Open"));
    expect(await screen.findByText("Reopen as Open")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByPlaceholderText("Why — this goes on the history"), "back again");
    await fireEvent.press(screen.getByText("Reopen"));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith(
        { TicketId: 7, StatusId: 1, ResolutionId: null, Remarks: "back again" },
        expect.anything(),
      ),
    );
    expect(await screen.findByLabelText("Reopening requires a manager")).toBeOnTheScreen();
  });

  it("closing a resolved complaint makes remarks optional", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(resolved));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Closed"));
    expect(await screen.findByPlaceholderText("Optional note for the history")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Update status"));
    await waitFor(() =>
      expect(setTicketStatus).toHaveBeenCalledWith(
        { TicketId: 7, StatusId: 4, ResolutionId: null, Remarks: null },
        expect.anything(),
      ),
    );
  });
});
