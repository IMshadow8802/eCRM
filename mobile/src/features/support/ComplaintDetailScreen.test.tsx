import { Linking } from "react-native";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchCalls, logCall } from "../../api/callQueries";
import { fetchCustomerDetail } from "../../api/customerQueries";
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
import { customer, envelope, serverError, ticket } from "../../test/fixtures";
import { spySheets } from "../../test/sheets";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import ComplaintDetailScreen from "./ComplaintDetailScreen";

jest.mock("../../api/ticketQueries");
jest.mock("../../api/callQueries");
jest.mock("../../api/customerQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/attachmentQueries");

/** A role that may do everything to complaints — the default for these tests. */
const FULL = { view: true, add: true, edit: true, delete: true, reach: "Company" as const };

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
  seedAuth({ UserId: 42, access: { modules: { complaints: FULL } } });
  jest.mocked(fetchAttachments).mockResolvedValue([]);
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
    jest.mocked(fetchTicketDetail).mockRejectedValue(serverError(404, "Not found"));
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
    jest.mocked(fetchTicketDetail).mockRejectedValue(serverError(500, "Server error"));
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
            { FieldId: 1, FieldKey: "serial", Label: "Serial", Type: "text", ValueText: "SN-1", ValueNumber: null, ValueDate: null },
            { FieldId: 2, FieldKey: "warranty", Label: "Warranty", Type: "checkbox", ValueText: "true", ValueNumber: null, ValueDate: null },
            { FieldId: 3, FieldKey: "units", Label: "Units", Type: "number", ValueText: null, ValueNumber: 4, ValueDate: null },
            { FieldId: 4, FieldKey: "installed", Label: "Installed", Type: "date", ValueText: null, ValueNumber: null, ValueDate: "2026-01-05T00:00:00" },
          ],
          linkedLead: { Id: 11, Name: "Sharma lead", MobileNo: null, Email: "s@x.in", StatusId: null },
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
    expect(screen.getByText("2 previous")).toBeOnTheScreen();
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

  it("shows the customer's own contact facts, and a tap calls or mails them", async () => {
    // CMP-03: web's customer card + core facts.
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(
        ticket({
          CustomerContactPerson: "Mr Sharma",
          CustomerEmail: "sharma@traders.in",
          CustomerAddress: "Ring Road",
          CustomerCity: "Surat",
          BranchName: "Surat Office",
          AssignedTo: 9,
          AssigneeName: "Priya Shah",
          AssignedAt: "2026-11-01T11:15:00",
          DueAt: "2026-11-02T18:00:00",
        }),
      ),
    );
    await mount();
    expect(await screen.findByText("Mr Sharma")).toBeOnTheScreen();
    expect(screen.getByText("Ring Road, Surat")).toBeOnTheScreen();
    expect(screen.getByText("Surat Office")).toBeOnTheScreen();
    expect(screen.getByText("since 01-11-2026 11:15")).toBeOnTheScreen();
    expect(screen.getByText("02-11-2026 18:00")).toBeOnTheScreen();
    expect(screen.getByText("01-11-2026 10:00")).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText("Call 9825012345"));
    expect(openURL).toHaveBeenCalledWith("tel:9825012345");
    await fireEvent.press(screen.getByLabelText("Email sharma@traders.in"));
    expect(openURL).toHaveBeenCalledWith("mailto:sharma@traders.in");
    openURL.mockRestore();
  });

  it("transfer never sends an office, even when the assignee sits in another one", async () => {
    // CMP-01: assertCanAssign 403s a non-wide caller that sends ToBranchId,
    // and a wide one would silently move the complaint's office.
    jest.mocked(fetchAssignableUsers).mockResolvedValue([
      { ...priya, BranchId: 2, BranchName: "Surat Office" },
    ]);
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Priya Shah"));
    await fireEvent.press(screen.getByText("On leave"));
    await fireEvent.changeText(screen.getByPlaceholderText("Anything the next person should know"), "covering");
    await fireEvent.press(screen.getAllByText("Transfer").at(-1)!);
    await waitFor(() =>
      expect(transferTicket).toHaveBeenCalledWith(
        expect.objectContaining({ ToUserId: 9, ToBranchId: null }),
        expect.anything(),
      ),
    );
    // CMP-09: and says it worked.
    expect(await screen.findByLabelText("Transferred to Priya Shah")).toBeOnTheScreen();
  });

  it("a status move and an escalation each say they worked", async () => {
    // CMP-09
    jest.mocked(fetchEscalationTargets).mockResolvedValue([
      { Id: 50, FullName: "Ravi Mehta", JobTitle: null, BranchId: 1, BranchName: null, Depth: 1 },
    ]);
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("On hold"));
    expect(await screen.findByLabelText("Status changed to On hold")).toBeOnTheScreen();
    await fireEvent.press(await screen.findByText("Ravi Mehta"));
    await fireEvent.changeText(
      screen.getByPlaceholderText("What they need to know — they get a notification"),
      "late",
    );
    await fireEvent.press(screen.getAllByText("Escalate").at(-1)!);
    expect(await screen.findByLabelText("Escalated to Ravi Mehta")).toBeOnTheScreen();
  });

  it("Resolve is the first action and opens the resolve sheet on the resolved status", async () => {
    // CMP-10: web shows Resolve as the primary button on an active complaint.
    await mount();
    await loaded();
    expect(screen.getAllByText(/^(Resolve|Change status)$/)[0]).toHaveTextContent("Resolve");
    await fireEvent.press(screen.getByText("Resolve"));
    expect(await screen.findByText("Mark as Resolved")).toBeOnTheScreen();
  });

  it("History lists who handed it to whom, with the reason and remarks", async () => {
    // CMP-02: sp_FetchTicketDetail RS4, rendered like the web's Assignments card.
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket(), {
        assignments: [
          {
            Id: 1, FromUserId: null, FromUserName: null, ToUserId: 9, ToUserName: "Priya Shah",
            FromBranchId: 1, FromBranchName: "Head Office", ToBranchId: 2, ToBranchName: "Surat Office",
            ReasonId: 30, Reason: "On leave", Remarks: "covering", AssignedBy: 42,
            AssignedByName: "Test User", AssignedAt: "2026-11-01T11:00:00",
          },
        ],
      }),
    );
    await mount();
    await loaded();
    // The tab's badge counts the hand-over, not just activity rows.
    expect(within(screen.getByRole("tab", { name: /History/ })).getByText("1")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("History"));
    expect(await screen.findByText("Unassigned → Priya Shah (Surat Office)")).toBeOnTheScreen();
    expect(screen.getByText(/^On leave · covering · by Test User · /)).toBeOnTheScreen();
    expect(screen.queryByText("Nothing has happened yet.")).toBeNull();
  });

  describe("by role (CMP-12)", () => {
    it("a view-only role sees no status, escalate, transfer, edit, delete or upload", async () => {
      // Every one of these routes needs the edit (or delete) grant.
      seedAuth({ UserId: 42, access: { modules: { complaints: { ...FULL, edit: false, delete: false } } } });
      jest.mocked(fetchEscalationTargets).mockResolvedValue([
        { Id: 50, FullName: "Ravi Mehta", JobTitle: null, BranchId: 1, BranchName: null, Depth: 1 },
      ]);
      await mount();
      // Not `loaded()`: it waits on sheets a view-only role no longer gets.
      // Waiting on the fetches instead means a hidden row is hidden by the
      // grant, not merely because its lookups had not landed yet.
      await screen.findByText("Inverter keeps tripping");
      await waitFor(() => expect(fetchLookups).toHaveBeenCalledWith(expect.objectContaining({ Kind: LOOKUP_KIND.ticketStatus })));
      await waitFor(() => expect(fetchAssignableUsers).toHaveBeenCalled());
      // Nothing left on the menu, so no ⋮ either.
      expect(screen.queryByLabelText("Complaint actions")).toBeNull();
      expect(screen.queryByText("Resolve")).toBeNull();
      expect(screen.queryByText("Change status")).toBeNull();
      expect(screen.queryByText("Rejected")).toBeNull();
      expect(screen.queryByText("Escalate")).toBeNull();
      expect(screen.queryByText("Ravi Mehta")).toBeNull();
      expect(fetchEscalationTargets).not.toHaveBeenCalled();
      // logCall on a ticket runs assertRecordAccess(..., "write") — edit too.
      expect(screen.queryByText("Goes straight onto the history")).toBeNull();
      expect(screen.queryByText("Log call")).toBeNull();
      expect(screen.queryByText("Edit complaint")).toBeNull();
      expect(screen.queryByText("Delete complaint")).toBeNull();
      expect(screen.queryByText("Transfer")).toBeNull();
      expect(screen.queryByText("Transfer to…")).toBeNull();
      await fireEvent.press(screen.getByText("Files"));
      await waitFor(() => expect(fetchAttachments).toHaveBeenCalled());
      expect(screen.queryByLabelText("Add a file")).toBeNull();
    });

    it("edit without delete keeps Edit, Transfer and uploads, hides Delete", async () => {
      seedAuth({ UserId: 42, access: { modules: { complaints: { ...FULL, delete: false } } } });
      await mount();
      await loaded();
      expect(screen.getByText("Edit complaint")).toBeOnTheScreen();
      expect(screen.getByText("Transfer to…")).toBeOnTheScreen();
      expect(screen.queryByText("Delete complaint")).toBeNull();
      await fireEvent.press(screen.getByText("Files"));
      expect(await screen.findByLabelText("Add a file")).toBeOnTheScreen();
    });
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
    jest.mocked(setTicketStatus).mockRejectedValue(serverError(400, "Resolution is required"));
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
    await waitFor(() =>
      expect(transferTicket).toHaveBeenCalledWith(
        { TicketId: 7, ToUserId: 9, ToBranchId: null, ReasonId: 30, Remarks: "covering" },
        expect.anything(),
      ),
    );
  });

  it("a failed transfer says why", async () => {
    jest.mocked(transferTicket).mockRejectedValue(serverError(403, "Not in your team"));
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
    jest.mocked(escalateTicket).mockRejectedValue(serverError(400, "Already escalated"));
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
    jest.mocked(logCall).mockRejectedValue(serverError(500, "Call log failed"));
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
    jest.mocked(deleteTicket).mockRejectedValue(serverError(409, "It has open calls"));
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
    jest.mocked(setTicketStatus).mockRejectedValue(serverError(403, "Reopening requires a manager"));
    await mount();
    await loaded();
    // No escalate entry once terminal; the SP refuses it anyway.
    expect(screen.queryByText("Flag a senior — it stays with the assignee")).toBeNull();
    expect(fetchEscalationTargets).not.toHaveBeenCalled();

    // CMP-11: the web's words — what a reopen does, and who may.
    expect(
      screen.getAllByText("The due date restarts from now. Only a manager may do this.").length,
    ).toBeGreaterThan(0);
    // No Resolve shortcut on a terminal complaint.
    expect(screen.queryByText("Resolve")).toBeNull();
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

describe("the customer's history (CUST-04)", () => {
  const CUSTOMERS = { view: true, add: false, edit: false, delete: false, reach: "Company" as const };
  const history = envelope({
    customer: customer(),
    tickets: [
      ticket(),
      ticket({ Id: 4, TicketNo: "T-4", Subject: "Battery swelling", StatusName: "Resolved", StatusCode: "resolved", AssigneeName: "Priya Shah", CreatedAt: "2026-10-02T09:15:00" }),
    ],
  });

  beforeEach(() => {
    seedAuth({ UserId: 42, access: { modules: { complaints: FULL, customers: CUSTOMERS } } });
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ PreviousTickets: 2 })));
    jest.mocked(fetchCustomerDetail).mockResolvedValue(history);
  });

  it("'N previous' lists that customer's other complaints and opens one", async () => {
    const navigation = makeNavigation<"ComplaintDetail">();
    const { present } = spySheets();
    await mount(navigation);
    await loaded();
    expect(fetchCustomerDetail).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Show 2 previous complaints"));
    expect(present).toHaveBeenCalled();
    expect(fetchCustomerDetail).toHaveBeenCalledWith({ CustomerId: 3 });
    expect(await screen.findByText("T-4 · Battery swelling")).toBeOnTheScreen();
    // The complaint already on screen is not its own history.
    expect(screen.queryByText("T-7 · Inverter keeps tripping")).toBeNull();
    await fireEvent.press(screen.getByText("T-4 · Battery swelling"));
    expect(navigation.push).toHaveBeenCalledWith("ComplaintDetail", { ticketId: 4 });
  });

  it("a failed history fetch says so in the sheet", async () => {
    jest.mocked(fetchCustomerDetail).mockRejectedValue(serverError(403, "You do not have access to this customer"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByLabelText("Show 2 previous complaints"));
    expect(await screen.findByText("You do not have access to this customer")).toBeOnTheScreen();
  });

  it("without the customers grant the count is plain text", async () => {
    seedAuth({ UserId: 42, access: { modules: { complaints: FULL } } });
    await mount();
    await loaded();
    expect(screen.getByText("2 previous")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Show 2 previous complaints")).toBeNull();
  });
});
