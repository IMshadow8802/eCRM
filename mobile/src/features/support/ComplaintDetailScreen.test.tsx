import { Linking, ScrollView } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchCalls } from "../../api/callQueries";
import { fetchCustomerDetail } from "../../api/customerQueries";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { deleteTicket, fetchEscalationTargets, fetchTicketDetail, setTicketStatus, transferTicket } from "../../api/ticketQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { BarAction } from "../../ui";
import type { Call, Lookup, Ticket, TicketActivityEntry, TicketDetail } from "../../types/api";
import { customer, envelope, serverError, ticket } from "../../test/fixtures";
import { spySheets } from "../../test/sheets";
import { flat } from "../../test/style";
import { PHONE, setWindow } from "../../test/window";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { colors } from "../../theme";
import ComplaintDetailScreen from "./ComplaintDetailScreen";

jest.mock("../../api/ticketQueries");
jest.mock("../../api/callQueries");
jest.mock("../../api/customerQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/attachmentQueries");

// The record publishes its actions to the Shell (useActionBar); this records
// what it published and answers phone (bar) or rail (band).
const mockBar = jest.fn((_actions: BarAction[]) => ({ inBand: false }));
jest.mock("../../navigation/Shell", () => ({ useActionBar: (a: BarAction[]) => mockBar(a) }));
const published = () => mockBar.mock.calls.at(-1)![0];
const labels = () => published().map((a) => `${a.label}${a.main ? "*" : ""}`);

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
  [LOOKUP_KIND.callOutcome]: [lookup(40, LOOKUP_KIND.callOutcome, "Reached")],
};

// The server's per-record answers default to "yes"; a test overrides them on the row.
const detail = (row: Ticket | null = ticket(), extra: Partial<TicketDetail> = {}): TicketDetail => ({
  ticket: row && { CanEdit: true, CanReassign: true, CanReopen: true, ...row },
  fields: [], activity: [], assignments: [], linkedLead: null, ...extra,
});
const act_ = (Id: number, Type: string, Summary: string, CreatedAt = "2026-11-01T11:00:00"): TicketActivityEntry => ({
  Id, TicketId: 7, UserId: 1, UserName: "Ravi Kumar", UserAvatar: null, Type, Summary, MetaJSON: null, CreatedAt,
});
const call = (over: Partial<Call> = {}): Call => ({
  Id: 1, CompId: 1, LeadId: null, TicketId: 7, UserId: 42, Direction: "out", OutcomeId: null, Notes: "Unit trips after 10 min",
  Duration: 4, CalledAt: "2026-11-01T13:40:00", CreatedBy: 42, CreatedAt: "2026-11-01T13:40:00", ...over,
});

const mount = (navigation = makeNavigation<"ComplaintDetail">()) =>
  renderWithProviders(<ComplaintDetailScreen navigation={navigation} route={makeRoute("ComplaintDetail", { ticketId: 7 })} />);
const loaded = async () => {
  await screen.findByRole("header", { name: "T-7" });
  await waitFor(() => expect(labels()).toContain("Resolve*"));
};

beforeEach(() => {
  setWindow(...PHONE);
  mockBar.mockImplementation(() => ({ inBand: false }));
  seedAuth({ UserId: 42, access: { modules: { complaints: FULL, customers: FULL } } });
  jest.mocked(fetchAttachments).mockResolvedValue([]);
  jest.mocked(fetchTicketDetail).mockResolvedValue(detail());
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => LOOKUPS[Kind] ?? []);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([]);
  jest.mocked(fetchCalls).mockResolvedValue([]);
  jest.mocked(fetchEscalationTargets).mockResolvedValue([{ Id: 5, FullName: "Neha Kapoor", JobTitle: null, Depth: 1 } as never]);
  jest.mocked(deleteTicket).mockResolvedValue(envelope(null));
  jest.mocked(setTicketStatus).mockResolvedValue(envelope(null));
});

describe("when the complaint cannot be shown", () => {
  it("a 404 says it is not available, never to check the connection", async () => {
    jest.mocked(fetchTicketDetail).mockRejectedValue(serverError(404, "Not found"));
    await mount();
    expect(await screen.findByText("Complaint not available")).toBeOnTheScreen();
    expect(screen.queryByText(/Check your connection/)).toBeNull();
    expect(published()).toEqual([]);
  });

  // X404: 404 alone means gone; a 403 is a refusal and offers a retry.
  it("a 403 is not 'not available'", async () => {
    jest.mocked(fetchTicketDetail).mockRejectedValue(serverError(403, "No"));
    await mount();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeOnTheScreen();
    expect(screen.queryByText("Complaint not available")).toBeNull();
  });

  it("a resolved detail with no ticket row is the same", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(null));
    await mount();
    expect(await screen.findByText("Complaint not available")).toBeOnTheScreen();
  });

  it("a server fault offers a retry that asks again", async () => {
    jest.mocked(fetchTicketDetail).mockRejectedValueOnce(serverError(500, "Server error"));
    const navigation = makeNavigation<"ComplaintDetail">();
    await mount(navigation);
    await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("header", { name: "T-7" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("loading shows skeleton rows under the band", async () => {
    jest.mocked(fetchTicketDetail).mockReturnValue(new Promise(() => {}));
    await mount();
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(4);
  });
});

describe("E 11 · the band", () => {
  it("number, opened, subject, status chip and the escalated chip", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ EscalatedTo: 5, EscalatedToName: "Neha Kapoor" })));
    await mount();
    await loaded();
    expect(screen.getByText("Opened Sun, 1 Nov · 10:00 am")).toBeOnTheScreen();
    expect(screen.getByText("Inverter keeps tripping")).toBeOnTheScreen();
    expect(screen.getByText("Open")).toBeOnTheScreen();
    expect(screen.getByText("Escalated to Neha Kapoor")).toBeOnTheScreen();
  });

  it("the customer card calls the mobile", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ ContactPerson: "Rakesh Sharma" })));
    await mount();
    await loaded();
    expect(screen.getByText("Sharma Traders")).toBeOnTheScreen();
    expect(screen.getByText("Rakesh Sharma · 9825012345")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Call 9825012345" }));
    expect(open).toHaveBeenCalledWith("tel:9825012345");
  });

  it("no mobile, no call button", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ CustomerMobile: null })));
    await mount();
    await loaded();
    expect(screen.getByText("No contact details")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Call / })).toBeNull();
  });
});

describe("E 11 · facts and activity", () => {
  it("facts in E's order; an overdue due reads '· n over' in danger", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket({ CategoryName: "AC Service", PriorityName: "High", AssigneeName: "Ayush Mishra", AssignedTo: 42, DueAt: "2026-11-01T12:40:00", IsOverdue: true })),
    );
    await mount();
    await loaded();
    const order = screen.getAllByText(/^(Category|Priority|Assigned to|Due)$/).map((t) => t.props.children);
    expect(order).toEqual(["Category", "Priority", "Assigned to", "Due"]);
    expect(screen.getByText("AC Service")).toBeOnTheScreen();
    expect(screen.getByText("High")).toBeOnTheScreen();
    expect(screen.getByText("Ayush Mishra")).toBeOnTheScreen();
    const due = screen.getByText(/^Sun, 1 Nov, 12:40 pm · \d+ [mhd] over$/);
    expect(flat(due).color).toBe(colors.dangerText);
  });

  it("activity shows four, 'All n' shows the rest; the call rows carry what was said", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket(), {
        activity: [
          act_(1, "created", "Created by Ravi Kumar", "2026-11-01T10:30:00"),
          act_(2, "assigned", "Assigned to Ayush Mishra", "2026-11-01T11:20:00"),
          act_(3, "call", "Outbound call logged", "2026-11-01T13:40:00"),
          act_(4, "escalated", "Escalated to Neha Kapoor", "2026-11-01T14:05:00"),
          act_(5, "status", "Moved to On hold", "2026-11-01T14:10:00"),
          act_(6, "updated", "Subject edited", "2026-11-01T14:20:00"),
        ],
      }),
    );
    jest.mocked(fetchCalls).mockResolvedValue([call(), call({ Id: 2, Direction: "in", Duration: null, OutcomeId: 40, Notes: null, CalledAt: "2026-11-01T09:00:00" })]);
    await mount();
    await loaded();
    expect(await screen.findByRole("link", { name: "All 7" })).toBeOnTheScreen();
    // E 11: "ACTIVITY" is an overline; so are the sections under it.
    for (const h of ["Activity", "Details"]) expect(flat(screen.getByText(h))).toMatchObject({ textTransform: "uppercase", fontSize: 12 });
    expect(screen.getByText("Subject edited")).toBeOnTheScreen();
    // E 11: the verb bold, the rest regular.
    expect(flat(screen.getByText("Escalated"))).toMatchObject({ fontFamily: "Inter_600SemiBold" });
    expect(flat(screen.getByText("Escalated to Neha Kapoor"))).toMatchObject({ fontFamily: "Inter_400Regular" });
    expect(flat(screen.getByText("Call logged"))).toMatchObject({ fontFamily: "Inter_600SemiBold" });
    expect(screen.queryByText("Created by Ravi Kumar")).toBeNull();
    // The activity's own 'call' row gives way to the richer call row.
    expect(screen.queryByText("Outbound call logged")).toBeNull();
    await fireEvent.press(screen.getByRole("link", { name: "All 7" }));
    expect(screen.getByText("Call logged · 4 min")).toBeOnTheScreen();
    expect(screen.getByText("Unit trips after 10 min")).toBeOnTheScreen();
    expect(screen.getByText("Call logged · Reached")).toBeOnTheScreen();
    expect(screen.getByText("Created by Ravi Kumar")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "Fewer" }));
    expect(screen.queryByText("Created by Ravi Kumar")).toBeNull();
  });

  it("only a known leading verb is bold; the SP's other summaries read plain; legacy lowercase is capitalised", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket(), {
        activity: [
          act_(1, "created", "Complaint created", "2026-11-01T10:30:00"),
          act_(2, "status", "Status: Open → Resolved", "2026-11-01T11:20:00"),
          act_(3, "resolved", "resolved", "2026-11-01T12:00:00"),
        ],
      }),
    );
    await mount();
    await loaded();
    const plain = { fontFamily: "Inter_600SemiBold" };
    expect(await screen.findByText("Complaint created")).toBeOnTheScreen();
    expect(screen.queryByText("Complaint")).toBeNull();
    expect(flat(screen.getByText("Complaint created"))).toMatchObject(plain);
    expect(screen.queryByText("Status:")).toBeNull();
    expect(flat(screen.getByText("Status: Open → Resolved"))).toMatchObject(plain);
    // "resolved" → a bold "Resolved", the whole title.
    expect(screen.queryByText("resolved")).toBeNull();
    // ("Resolved" is also a status label elsewhere; the activity one sits in a rich title.)
    const verb = screen.getAllByText("Resolved").find((n) => n.parent && flat(n.parent).fontFamily === "Inter_400Regular");
    expect(verb).toBeDefined();
    expect(flat(verb!)).toMatchObject({ fontFamily: "Inter_600SemiBold" });
    expect(verb!.parent).toHaveTextContent(/^Resolved$/);
  });

  it("a legacy 'Transferred to' row reads 'Reassigned to' (stored text, reworded on display)", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket(), { activity: [act_(1, "assigned", "Transferred to Vinod Kumar — Wrong branch")] }),
    );
    await mount();
    await loaded();
    const verb = await screen.findByText("Reassigned");
    expect(verb.parent).toHaveTextContent(/^Reassigned to Vinod Kumar — Wrong branch$/);
    expect(screen.queryByText(/Transferred/)).toBeNull();
  });

  it("nothing yet says so", async () => {
    await mount();
    await loaded();
    expect(screen.getByText("Nothing has happened yet.")).toBeOnTheScreen();
  });

  it("details, custom fields, the lead, hand-overs and the customer's other complaints", async () => {
    const navigation = makeNavigation<"ComplaintDetail">();
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket({ Description: "Trips every evening", ResolutionName: "Fixed", EscalatedToName: "Neha", PreviousTickets: 2 }), {
        fields: [{ FieldId: 1, FieldKey: "roof", Label: "Roof type", Type: "text", ValueText: "Tin", ValueNumber: null, ValueDate: null }],
        linkedLead: { Id: 3, Name: "Sharma lead" } as never,
        assignments: [
          {
            Id: 1, FromUserId: 1, FromUserName: "Ravi Kumar", ToUserId: 42, ToUserName: "Ayush Mishra", FromBranchId: 1, FromBranchName: null,
            ToBranchId: 1, ToBranchName: null, ReasonId: 30, Reason: "Specialist needed", Remarks: "AC specialist", AssignedBy: 1,
            AssignedByName: "Ravi Kumar", AssignedAt: "2026-11-01T11:20:00",
          },
        ],
      }),
    );
    jest.mocked(fetchCustomerDetail).mockResolvedValue(
      envelope({ customer: customer(), tickets: [{ ...ticket(), Id: 7 }, { ...ticket(), Id: 8, TicketNo: "T-8", Subject: "Old one" }] }),
    );
    await mount(navigation);
    await loaded();
    expect(screen.getByText("Trips every evening")).toBeOnTheScreen();
    expect(screen.getByText("Tin")).toBeOnTheScreen();
    expect(screen.getByText("Sharma lead")).toBeOnTheScreen();
    expect(screen.getByText("Ravi Kumar → Ayush Mishra")).toBeOnTheScreen();
    expect(screen.getByText("Specialist needed · AC specialist · by Ravi Kumar")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "Show 2 previous complaints" }));
    await fireEvent.press(await screen.findByRole("menuitem", { name: "T-8 · Old one" }));
    expect(navigation.push).toHaveBeenCalledWith("ComplaintDetail", { ticketId: 8 });
    expect(screen.queryByRole("menuitem", { name: "T-7 · Inverter keeps tripping" })).toBeNull();
  });

  it("without customers view the history is a count, not a link", async () => {
    seedAuth({ UserId: 42, access: { modules: { complaints: FULL } } });
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ PreviousTickets: 2 })));
    await mount();
    await loaded();
    expect(screen.getByText("2 previous")).toBeOnTheScreen();
    expect(screen.queryByRole("link", { name: "Show 2 previous complaints" })).toBeNull();
  });
});

describe("E 11 · the action bar", () => {
  it("open: Log call · On hold · Resolve (main) · Reassign · Escalate; each opens a sheet, none writes", async () => {
    const { present } = spySheets();
    await mount();
    await loaded();
    await waitFor(() => expect(labels()).toEqual(["Log call", "On hold", "Resolve*", "Reassign", "Escalate"]));
    for (const a of published()) await act(async () => a.onPress());
    expect(present).toHaveBeenCalledTimes(5);
    expect(setTicketStatus).not.toHaveBeenCalled();
  });

  it("on hold: Resume in place of On hold", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ StatusCode: "onhold", StatusId: 2 })));
    await mount();
    await loaded();
    await waitFor(() => expect(labels()).toEqual(["Log call", "Resume", "Resolve*", "Reassign", "Escalate"]));
  });

  it("terminal: Reopen is the main action; On hold, Resolve and Escalate go", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ StatusCode: "resolved", StatusId: 3 })));
    await mount();
    await screen.findByRole("header", { name: "T-7" });
    await waitFor(() => expect(labels()).toEqual(["Log call", "Reopen*", "Reassign"]));
  });

  it("nobody above in the chain: Escalate stays, and its sheet says why (N3)", async () => {
    jest.mocked(fetchEscalationTargets).mockResolvedValue([]);
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ AssignedTo: 9, AssigneeName: "Priya Shah" })));
    await mount();
    await loaded();
    await waitFor(() => expect(labels()).toEqual(["Log call", "On hold", "Resolve*", "Reassign", "Escalate"]));
    await act(async () => published().find((a) => a.key === "escalate")!.onPress());
    expect(await screen.findByText("Nobody above Priya Shah can open complaints. Reassign it or tell a manager.")).toBeOnTheScreen();
  });

  it("the server's CanReassign / CanReopen / CanEdit decide: no Reassign, no Reopen, no actions", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket({ StatusCode: "resolved", StatusId: 3, CanReassign: false, CanReopen: false })),
    );
    await mount();
    await screen.findByRole("header", { name: "T-7" });
    await waitFor(() => expect(labels()).toEqual(["Log call"]));
    expect(screen.queryByRole("menuitem", { name: "Reopen" })).toBeNull();
    // No reopen through Change status either.
    expect(screen.queryByRole("menuitem", { name: "Move to Open" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Move to Closed" })).toBeOnTheScreen();
  });

  it("CanEdit false on the record: no actions, whatever the module grant", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ CanEdit: false })));
    await mount();
    await screen.findByRole("header", { name: "T-7" });
    expect(published()).toEqual([]);
  });

  it("no edit grant: no actions at all — every one is a write the server refuses", async () => {
    seedAuth({ UserId: 42, access: { modules: { complaints: { ...FULL, edit: false, delete: false } } } });
    await mount();
    await screen.findByRole("header", { name: "T-7" });
    expect(published()).toEqual([]);
    expect(screen.queryByRole("menuitem", { name: "Edit complaint" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Files" })).toBeOnTheScreen();
  });
});

describe("E 11 · the ⋮ menu", () => {
  it("Edit, Close, Reject, Files, Delete on an open complaint", async () => {
    const navigation = makeNavigation<"ComplaintDetail">();
    const scroll = jest.spyOn(ScrollView.prototype, "scrollTo");
    await mount(navigation);
    await loaded();
    const items = screen.getAllByRole("menuitem").map((m) => m.props.accessibilityLabel).filter((l: string) => !l.startsWith("Move to"));
    expect(items).toEqual(["Edit complaint", "Change status", "Close", "Reject", "Files", "Delete complaint"]);
    await fireEvent.press(screen.getByRole("menuitem", { name: "Edit complaint" }));
    expect(navigation.navigate).toHaveBeenCalledWith("ComplaintForm", { ticketId: 7 });
    await fireEvent.press(screen.getByRole("menuitem", { name: "Files" }));
    expect(scroll).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("menuitem", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Close complaint" })).toBeOnTheScreen();
  });

  it("Change status lists every company status but the current one; an active→active move needs nothing", async () => {
    const { present } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("menuitem", { name: "Change status" }));
    expect(present).toHaveBeenCalled();
    const moves = screen.getAllByRole("menuitem").map((m) => m.props.accessibilityLabel).filter((l: string) => l.startsWith("Move to"));
    expect(moves).toEqual(["Move to On hold", "Move to Resolved", "Move to Closed", "Move to Rejected"]);
    await fireEvent.press(screen.getByRole("menuitem", { name: "Move to On hold" }));
    await waitFor(() => expect(setTicketStatus).toHaveBeenCalledWith({ TicketId: 7, StatusId: 2 }));
  });

  it("a terminal one offers Reopen and no Reject", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ StatusCode: "closed", StatusId: 4 })));
    await mount();
    await screen.findByRole("header", { name: "T-7" });
    const items = screen.getAllByRole("menuitem").map((m) => m.props.accessibilityLabel).filter((l: string) => !l.startsWith("Move to"));
    expect(items).toEqual(["Edit complaint", "Change status", "Reopen", "Files", "Delete complaint"]);
  });

  it("Delete asks first, then deletes and goes back; a refusal says why", async () => {
    const navigation = makeNavigation<"ComplaintDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.press(screen.getByRole("menuitem", { name: "Delete complaint" }));
    expect(screen.getByText("Delete this complaint?")).toBeOnTheScreen();
    jest.mocked(deleteTicket).mockRejectedValueOnce(serverError(400, "Only admins delete"));
    await fireEvent.press(screen.getByText("Delete"));
    expect(await screen.findByText("Only admins delete")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Delete"));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(deleteTicket).toHaveBeenLastCalledWith({ Id: 7 });
  });
});

describe("T2 · at the rail", () => {
  beforeEach(() => mockBar.mockImplementation(() => ({ inBand: true })));

  // T2 decision (2026-11-03): Escalate folds into ⋮ so the ticket number has
  // room; Resolve stays the filled main action. The phone bar keeps it.
  it("the actions sit in the band, the main one last, Escalate in the ⋮ menu; the customer card has a Call button", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket({ ContactPerson: "Rakesh Sharma", PriorityName: "High" })),
    );
    jest.mocked(fetchCalls).mockResolvedValue([call()]);
    await mount();
    await loaded();
    const band = screen.getAllByRole("button").map((b) => b.props.accessibilityLabel).filter((l) =>
      ["Log call", "On hold", "Reassign", "Escalate", "Resolve"].includes(l),
    );
    // The band comes first in the tree; the sheets (kept mounted by the mock) follow.
    expect(band.slice(0, 4)).toEqual(["Log call", "On hold", "Reassign", "Resolve"]);
    expect(screen.getByRole("menuitem", { name: "Escalate" })).toBeOnTheScreen();
    expect(screen.getByText("Contact: Rakesh Sharma")).toBeOnTheScreen();
    // T2 keeps the direction on a call row; the phone (11) drops it.
    expect(await screen.findByText("Call logged · 4 min · outgoing")).toBeOnTheScreen();
    expect(screen.getByRole("menuitem", { name: "Change status" })).toBeOnTheScreen();
    expect(screen.getByText("Opened Sun, 1 Nov · 10:00 am")).toBeOnTheScreen();
    expect(screen.getAllByText("High").length).toBe(2);
    await fireEvent.press(screen.getByRole("button", { name: "Call 9825012345" }));
    expect(open).toHaveBeenCalledWith("tel:9825012345");
    const { present } = spySheets();
    await fireEvent.press(within(screen.getByRole("button", { name: "Resolve" })).getByText("Resolve"));
    expect(present).toHaveBeenCalled();
  });
});

describe("access model on the record", () => {
  it("no giver, no Send back", async () => {
    await mount();
    await loaded();
    expect(screen.queryByRole("menuitem", { name: /^Send back/ })).toBeNull();
  });

  it("Send back is in the ⋮ menu when the server names the giver", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ SendBackToId: 30, SendBackToName: "Nitin Verma" })));
    const { present } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("menuitem", { name: "Send back to Nitin Verma" }));
    expect(present).toHaveBeenCalled();
  });

  // Final review m2: Send back is a reassign; gate 3 refuses it on a closed
  // complaint for an Own agent, so the menu must not offer it.
  it("no Send back without CanReassign, even when the server names the giver", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue(
      detail(ticket({ CanReassign: false, SendBackToId: 30, SendBackToName: "Nitin Verma" })),
    );
    await mount();
    await loaded();
    expect(screen.queryByRole("menuitem", { name: /^Send back/ })).toBeNull();
  });

  it("nothing on the record or its sheets says transfer", async () => {
    await mount();
    await loaded();
    expect(screen.queryByText(/transfer/i)).toBeNull();
    expect(screen.getByText("Reassign complaint")).toBeOnTheScreen();
  });

  it("after a reassign the record goes back to the list with its cached detail gone", async () => {
    jest.mocked(fetchAssignableUsers).mockResolvedValue([
      { Id: 21, FullName: "Vivek Rao", Avatar: null, JobTitle: null, BranchId: 1, BranchName: null, ReportsTo: null, GroupRank: 1 },
    ]);
    jest.mocked(transferTicket).mockResolvedValue(envelope(null));
    LOOKUPS[LOOKUP_KIND.transferReason] = [lookup(30, LOOKUP_KIND.transferReason, "Specialist needed")];
    const navigation = makeNavigation<"ComplaintDetail">();
    const view = await mount(navigation);
    await loaded();
    const removed = jest.spyOn(view.queryClient, "removeQueries");
    await act(async () => published().find((a) => a.key === "reassign")!.onPress());
    await fireEvent.press(await screen.findByRole("radio", { name: "Vivek Rao" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Specialist needed" }));
    await fireEvent.changeText(screen.getByTestId("reassign-remarks"), "Your area");
    await fireEvent.press(screen.getByRole("button", { name: "Reassign to Vivek" }));
    expect(await screen.findByText("Reassigned to Vivek Rao")).toBeOnTheScreen();
    expect(navigation.goBack).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith({ queryKey: ["ticket", 7] });
    delete LOOKUPS[LOOKUP_KIND.transferReason];
  });

  // Review Focus 4.
  it("a 404 on Resolve from a stale screen goes back and says the record is no longer with you", async () => {
    jest.mocked(setTicketStatus).mockRejectedValue(serverError(404, "Complaint not found"));
    const navigation = makeNavigation<"ComplaintDetail">();
    await mount(navigation);
    await loaded();
    await act(async () => published().find((a) => a.key === "resolve")!.onPress());
    await fireEvent.press(screen.getByRole("radio", { name: "Fixed on site" }));
    await fireEvent.changeText(screen.getByTestId("resolve-remarks"), "Done");
    await fireEvent.press(screen.getByRole("button", { name: "Save · mark resolved" }));
    expect(await screen.findByText("This record is no longer with you")).toBeOnTheScreen();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  // 403 = still visible, the delete refused: say why and stay.
  it("a 403 on delete shows the server's message and stays on the complaint", async () => {
    jest.mocked(deleteTicket).mockRejectedValue(serverError(403, "You do not have permission for this action"));
    const navigation = makeNavigation<"ComplaintDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.press(screen.getByRole("menuitem", { name: "Delete complaint" }));
    await fireEvent.press(screen.getByText("Delete"));
    expect(await screen.findByText("You do not have permission for this action")).toBeOnTheScreen();
    expect(screen.queryByText("This record is no longer with you")).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("a 404 on delete is the same", async () => {
    jest.mocked(deleteTicket).mockRejectedValue(serverError(404, "Record not found"));
    const navigation = makeNavigation<"ComplaintDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.press(screen.getByRole("menuitem", { name: "Delete complaint" }));
    await fireEvent.press(screen.getByText("Delete"));
    expect(await screen.findByText("This record is no longer with you")).toBeOnTheScreen();
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe("149 · number marks", () => {
  it("shows the banner and asks before calling a do-not-call number", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ PhoneMark: "dnc", PhoneMarkNote: "Said stop calling", PhoneMarkBy: "Priya Verma", PhoneMarkAt: "2026-11-20T10:15:00" })));
    await mount();
    await loaded();
    expect(screen.getByText("Do not call — Said stop calling · marked by Priya Verma, 20 Nov")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Call 9825012345" }));
    expect(open).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(open).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Call 9825012345" }));
    await fireEvent.press(screen.getByRole("button", { name: "Call anyway" }));
    expect(open).toHaveBeenCalledWith("tel:9825012345");
  });

  it("under caution the dialler opens at once", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest.mocked(fetchTicketDetail).mockResolvedValue(detail(ticket({ PhoneMark: "caution", PhoneMarkNote: "Evenings only" })));
    await mount();
    await loaded();
    expect(screen.getByText("Call with caution — Evenings only")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Call 9825012345" }));
    expect(open).toHaveBeenCalledWith("tel:9825012345");
  });
});
