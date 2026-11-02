import { useState } from "react";
import { Linking, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchCalls } from "../../api/callQueries";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchEscalationTargets, fetchTicketDetail, fetchTickets, setTicketStatus, type FetchTicketsParams } from "../../api/ticketQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import { fetchAttachments } from "../../api/attachmentQueries";
import type { Lookup, Ticket } from "../../types/api";
import { envelope, pagination, ticket } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { spySheets } from "../../test/sheets";
import { flat } from "../../test/style";
import { PHONE, TABLET, setWindow } from "../../test/window";
import { chipTones, colors } from "../../theme";
import ComplaintsScreen, { SWIPE_HINT_KEY } from "./ComplaintsScreen";
import { complaintQueueParams } from "./ticketHelpers";

jest.mock("../../api/ticketQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/callQueries");
jest.mock("../../api/attachmentQueries");
// The record pane publishes its actions to the Shell; here there is no Shell.
jest.mock("../../navigation/Shell", () => ({ useActionBar: jest.fn(() => ({ inBand: true })) }));

// FlatList schedules its batches on timers; real ones leak past the test.
jest.useFakeTimers();

// ReanimatedSwipeable under the reanimated jest mock reports its callbacks as
// "not worklets" — library noise in tests only. Swallow exactly that line.
const realError = console.error;
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation((msg: unknown, ...rest: unknown[]) => {
    if (!String(msg).includes("Some of the callbacks in the gesture are worklets")) realError(msg, ...rest);
  });
});
afterEach(() => jest.mocked(console.error).mockRestore());

const lookup = (Id: number, Value: string, Code: string): Lookup => ({
  Id, CompId: 1, Kind: LOOKUP_KIND.ticketStatus, Value, Code, SortOrder: Id, IsActive: true,
});
const STATUSES = [
  lookup(1, "Open", "open"),
  lookup(2, "On hold", "onhold"),
  lookup(3, "Resolved", "resolved"),
  lookup(4, "Closed", "closed"),
  lookup(5, "Rejected", "rejected"),
];

/** Preset counts (active-only) and pill counts, as the server would answer them. */
const PRESET: Record<string, number> = { mine: 7, team: 18, unassigned: 3, overdue: 2, escalated: 1 };
const PILL: Record<number, number> = { 1: 6, 2: 1, 3: 1, 4: 1, 5: 0 };
const queueOf = (p: FetchTicketsParams) =>
  p.Overdue ? "overdue" : p.Escalated ? "escalated" : p.Unassigned ? "unassigned" : p.AssignedTo ? "mine" : "team";

let rows: Ticket[];
const serve = () =>
  jest.mocked(fetchTickets).mockImplementation(async (p = {}) => {
    if (p.PageSize !== 1) return envelope({ tickets: rows, pagination: pagination(rows.length) });
    const n = p.StatusCode === "active" ? PRESET[queueOf(p)]! : p.StatusId ? PILL[p.StatusId]! : 9;
    return envelope({ tickets: [], pagination: pagination(n) });
  });
/** The list requests only — the PageSize-1 counts are their own. */
const listCalls = () => jest.mocked(fetchTickets).mock.calls.map((c) => c[0]!).filter((p) => p.PageSize !== 1);
const lastList = () => listCalls().at(-1);

const mount = (navigation = makeNavigation<"Complaints">(), params?: { queue?: "overdue"; term?: string }) =>
  renderWithProviders(<ComplaintsScreen navigation={navigation} route={makeRoute("Complaints", params)} />);

const FULL = { view: true, add: true, edit: true, delete: true, reach: "Company" as const };

beforeEach(async () => {
  setWindow(...PHONE);
  rows = [ticket()];
  serve();
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => (Kind === LOOKUP_KIND.ticketStatus ? STATUSES : []));
  jest.mocked(fetchAssignableUsers).mockResolvedValue([]);
  jest.mocked(fetchEscalationTargets).mockResolvedValue([]);
  jest.mocked(fetchCalls).mockResolvedValue([]);
  jest.mocked(fetchAttachments).mockResolvedValue([]);
  await AsyncStorage.clear();
  seedAuth({ UserId: 42, access: { modules: { complaints: FULL } } });
});

describe("E 10 · the band", () => {
  it("title, + New to a blank form, the search placeholder", async () => {
    const navigation = makeNavigation<"Complaints">();
    await mount(navigation);
    await screen.findByText("Inverter keeps tripping");
    expect(screen.getByRole("header", { name: "Complaints" })).toBeOnTheScreen();
    expect(screen.getByPlaceholderText("Search number, customer, mobile")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "New complaint" }));
    expect(navigation.navigate).toHaveBeenCalledWith("ComplaintForm", {});
  });

  it("no add grant, no + New", async () => {
    seedAuth({ UserId: 42, access: { modules: { complaints: { ...FULL, add: false } } } });
    await mount();
    await screen.findByText("Inverter keeps tripping");
    expect(screen.queryByRole("button", { name: "New complaint" })).toBeNull();
  });

  it("five presets (§7.1 keeps Unassigned) with Home's active-only counts", async () => {
    await mount();
    for (const [name, n] of [["Mine", 7], ["Team", 18], ["Unassigned", 3], ["Overdue", 2], ["Escalated", 1]] as const) {
      expect(await screen.findByRole("tab", { name: `${name}, ${n}` })).toBeOnTheScreen();
    }
    for (const q of ["mine", "team", "unassigned", "overdue", "escalated"] as const) {
      expect(fetchTickets).toHaveBeenCalledWith({ ...complaintQueueParams(q, "active", 42, ""), PageSize: 1 });
    }
    expect(screen.getByRole("tab", { name: "Mine, 7" })).toBeSelected();
  });

  it("a preset is WHICH complaints; the band stays live", async () => {
    await mount();
    await screen.findByText("Inverter keeps tripping");
    await fireEvent.press(screen.getByRole("tab", { name: "Team, 18" }));
    await waitFor(() => expect(lastList()).toMatchObject({ AssignedTo: null, Unassigned: false }));
    await fireEvent.press(screen.getByRole("tab", { name: "Unassigned, 3" }));
    await waitFor(() => expect(lastList()).toMatchObject({ Unassigned: true, StatusCode: "active" }));
  });
});

describe("E 10 · status pills", () => {
  it("opens on Active — the set the preset counted — then each status's count; none shows no number", async () => {
    await mount();
    // The tab and the default list agree: Mine 7 opens Active 7.
    expect(await screen.findByRole("radio", { name: "Active, 7" })).toBeSelected();
    expect(screen.getByRole("tab", { name: "Mine, 7" })).toBeSelected();
    expect(screen.queryByRole("radio", { name: /^All/ })).toBeNull();
    expect(screen.getByRole("radio", { name: "Open, 6" })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "On hold, 1" })).toBeOnTheScreen();
    expect(await screen.findByRole("radio", { name: "Rejected" })).toBeOnTheScreen();
    expect(lastList()).toMatchObject({ AssignedTo: 42, StatusCode: "active", StatusId: null });
  });

  it("a pill narrows within the preset by status id; its tone is the status's", async () => {
    await mount();
    await fireEvent.press(await screen.findByRole("radio", { name: "On hold, 1" }));
    await waitFor(() => expect(lastList()).toMatchObject({ AssignedTo: 42, StatusId: 2, StatusCode: null }));
    expect(flat(screen.getByRole("radio", { name: "Open, 6" })).backgroundColor).toBe(chipTones.sky.fill);
    expect(flat(screen.getByRole("radio", { name: "On hold, 1" })).backgroundColor).toBe(colors.primary);
  });
});

describe("E 10 · the row", () => {
  it("badge, subject, due, number · customer, status pill and priority flag", async () => {
    rows = [ticket({ PriorityName: "High", DueAt: "2026-11-02T10:00:00", IsOverdue: true, StatusName: "Open" })];
    await mount();
    const row = await screen.findByTestId("complaint-7");
    expect(within(row).getByText("Inverter keeps tripping")).toBeOnTheScreen();
    expect(within(row).getByText(/^Overdue \d+ [mhd]$/)).toBeOnTheScreen();
    expect(within(row).getByText("T-7 · ")).toBeOnTheScreen();
    expect(within(row).getByText(/Sharma Traders/)).toBeOnTheScreen();
    expect(within(row).getByText("Open")).toBeOnTheScreen();
    expect(within(row).getByLabelText("High priority")).toBeOnTheScreen();
    expect(within(row).queryByTestId("escalated-dot")).toBeNull();
  });

  it("the violet corner dot only when escalated; a closed one reads quieter", async () => {
    rows = [
      ticket({ Id: 1, EscalatedTo: 5 }),
      ticket({ Id: 2, Subject: "Geyser thermostat failure", StatusCode: "closed", StatusName: "Closed", ClosedAt: "2026-10-31T10:00:00" }),
    ];
    await mount();
    expect(within(await screen.findByTestId("complaint-1")).getByTestId("escalated-dot")).toBeOnTheScreen();
    expect(within(screen.getByTestId("complaint-2")).queryByTestId("escalated-dot")).toBeNull();
    expect(flat(screen.getByText("Geyser thermostat failure")).color).toBe(colors.textSecondary);
    expect(within(screen.getByTestId("complaint-2")).getByText("Sat, 31 Oct")).toBeOnTheScreen();
  });

  it("a tap opens the record on a phone", async () => {
    const navigation = makeNavigation<"Complaints">();
    await mount(navigation);
    await fireEvent.press(await screen.findByTestId("complaint-7"));
    expect(navigation.navigate).toHaveBeenCalledWith("ComplaintDetail", { ticketId: 7 });
  });
});

describe("E 22 · swipe", () => {
  it("Call · On hold · Resolve and Escalate; each opens its sheet, none writes", async () => {
    const { present } = spySheets();
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await mount();
    await screen.findByText("Inverter keeps tripping");
    for (const name of ["Call", "On hold", "Resolve"]) expect(screen.getByRole("button", { name })).toBeOnTheScreen();
    // The block, then the Escalate sheet's own submit (the mock keeps every sheet mounted).
    expect(screen.getAllByRole("button", { name: "Escalate" })).toHaveLength(2);
    await fireEvent.press(screen.getByRole("button", { name: "Resolve" }));
    await fireEvent.press(screen.getByRole("button", { name: "On hold" }));
    await fireEvent.press(screen.getAllByRole("button", { name: "Escalate" })[0]!);
    expect(present).toHaveBeenCalledTimes(3);
    await fireEvent.press(screen.getByRole("button", { name: "Call" }));
    expect(open).toHaveBeenCalledWith("tel:9825012345");
    expect(setTicketStatus).not.toHaveBeenCalled();
  });

  it("a terminal row keeps only Call; no mobile, no Call; no edit grant, Call only", async () => {
    rows = [ticket({ StatusCode: "resolved", ResolvedAt: "2026-11-01T10:00:00" })];
    await mount();
    await screen.findByText("Inverter keeps tripping");
    expect(screen.getByRole("button", { name: "Call" })).toBeOnTheScreen();
    for (const name of ["On hold", "Resolve"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Escalate" })).toHaveLength(1);
  });

  it("an on-hold row offers no second On hold; a row with no mobile has no Call", async () => {
    rows = [ticket({ StatusCode: "onhold", CustomerMobile: null })];
    await mount();
    await screen.findByText("Inverter keeps tripping");
    expect(screen.queryByRole("button", { name: "On hold" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Call" })).toBeNull();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeOnTheScreen();
  });

  it("without the edit grant a row offers only Call", async () => {
    seedAuth({ UserId: 42, access: { modules: { complaints: { ...FULL, edit: false } } } });
    await mount();
    await screen.findByText("Inverter keeps tripping");
    expect(screen.getByRole("button", { name: "Call" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
  });

  it("the hint shows until the first swipe action, then never again", async () => {
    await mount();
    expect(await screen.findByText(/Swipe left: Call · On hold · Resolve/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Resolve" }));
    expect(screen.queryByText(/Swipe left:/)).toBeNull();
    expect(await AsyncStorage.getItem(SWIPE_HINT_KEY)).toBe("1");
  });

  it("a hint already seen stays hidden", async () => {
    await AsyncStorage.setItem(SWIPE_HINT_KEY, "1");
    await mount();
    await screen.findByText("Inverter keeps tripping");
    await act(async () => { jest.advanceTimersByTime(10); });
    expect(screen.queryByText(/Swipe left:/)).toBeNull();
  });
});

describe("20a–c · states", () => {
  it("20b: skeleton rows and pills while the first page loads", async () => {
    jest.mocked(fetchTickets).mockReturnValue(new Promise(() => {}));
    await mount();
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(6);
    expect(screen.getByTestId("pills-skeleton")).toBeOnTheScreen();
  });

  it("20c: one card, one retry; the band stays live", async () => {
    jest.mocked(fetchTickets).mockRejectedValue(new Error("boom"));
    await mount();
    expect(await screen.findByText("Could not load. Try again")).toBeOnTheScreen();
    const before = listCalls().length;
    serve();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Inverter keeps tripping")).toBeOnTheScreen();
    expect(listCalls().length).toBeGreaterThan(before);
  });

  it("20a: Escalated's copy, and Show all of mine goes back to Mine", async () => {
    rows = [];
    await mount();
    await fireEvent.press(await screen.findByRole("tab", { name: "Escalated, 1" }));
    expect(await screen.findByText("No complaints here")).toBeOnTheScreen();
    expect(screen.getByText("Nothing is escalated to you right now. New escalations appear here and in your Inbox.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Show all of mine" }));
    expect(screen.getByRole("tab", { name: "Mine, 7" })).toBeSelected();
    expect(await screen.findByText("Nothing assigned to you")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Show all of mine" })).toBeNull();
  });

  it.each([
    ["Team, 18", "No complaints here"],
    ["Unassigned, 3", "Nobody is waiting"],
    ["Overdue, 2", "Nothing past its due time"],
  ])("20a: %s has its own empty line", async (tab, title) => {
    rows = [];
    await mount();
    await fireEvent.press(await screen.findByRole("tab", { name: tab }));
    expect(await screen.findByText(title)).toBeOnTheScreen();
  });

  it("a narrowed list that is empty says so", async () => {
    rows = [];
    await mount();
    await fireEvent.press(await screen.findByRole("radio", { name: "Open, 6" }));
    expect(await screen.findByText("Nothing matches")).toBeOnTheScreen();
  });
});

describe("paging and search", () => {
  const many = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ticket({ Id: from + i, Subject: `Complaint ${from + i}` }));

  it("asks for 50 at a time and loads the next page at the end of the list", async () => {
    jest.mocked(fetchTickets).mockImplementation(async (p = {}) =>
      p.PageSize === 1
        ? envelope({ tickets: [], pagination: pagination(1) })
        : envelope({ tickets: many((p.PageNumber! - 1) * 50 + 1, 50), pagination: pagination(120, { totalPages: 3 }) }),
    );
    await mount();
    await screen.findByText("Complaint 1");
    expect(lastList()).toMatchObject({ PageNumber: 1, PageSize: 50 });
    await fireEvent(screen.getByTestId("complaints-list"), "onEndReached");
    await waitFor(() => expect(lastList()).toMatchObject({ PageNumber: 2, PageSize: 50 }));
  });

  it("does not ask past the last page", async () => {
    await mount();
    await screen.findByText("Inverter keeps tripping");
    await fireEvent(screen.getByTestId("complaints-list"), "onEndReached");
    expect(listCalls()).toHaveLength(1);
  });

  it("fast typing sends one request, for the final term", async () => {
    await mount();
    await screen.findByText("Inverter keeps tripping");
    const box = screen.getByPlaceholderText("Search number, customer, mobile");
    const before = listCalls().length;
    await fireEvent.changeText(box, "s");
    await fireEvent.changeText(box, "sha");
    await act(async () => { jest.advanceTimersByTime(299); });
    expect(listCalls()).toHaveLength(before);
    await act(async () => { jest.advanceTimersByTime(1); });
    await waitFor(() => expect(listCalls()).toHaveLength(before + 1));
    expect(lastList()).toMatchObject({ SearchTerm: "sha", PageNumber: 1 });
  });
});

describe("count equality", () => {
  it("Home → Mine: the number Home showed is the rows the list shows", async () => {
    // The server answers the list with exactly the active Mine set.
    rows = Array.from({ length: 7 }, (_, i) => ticket({ Id: 100 + i, Subject: `Complaint ${i}` }));
    await mount(undefined, { queue: "mine" } as never);
    expect(await screen.findByRole("tab", { name: "Mine, 7" })).toBeOnTheScreen();
    await screen.findByText("Complaint 0");
    expect(screen.getAllByTestId(/^complaint-\d+$/)).toHaveLength(7);
    // Same filters as the count Home made, but for the page size.
    const count = complaintQueueParams("mine", "active", 42, "");
    expect(fetchTickets).toHaveBeenCalledWith({ ...count, PageSize: 1 });
    expect(lastList()).toEqual({ ...count, PageNumber: 1 });
  });
});

describe("route params", () => {
  it("Home's queue and Search's term land on exactly that list", async () => {
    await mount(undefined, { queue: "overdue", term: "sharma" });
    await waitFor(() => expect(lastList()).toMatchObject({ Overdue: true, SearchTerm: "sharma", StatusCode: "active" }));
    expect(screen.getByPlaceholderText("Search number, customer, mobile").props.value).toBe("sharma");
    expect(screen.getByRole("tab", { name: "Overdue, 2" })).toBeSelected();
  });

  it("a later navigate() with a queue drops the pill and the search left behind", async () => {
    const navigation = makeNavigation<"Complaints">();
    let navigateTo: (params: { queue: "overdue" }) => void = () => {};
    function Harness() {
      const [route, setRoute] = useState(makeRoute("Complaints", undefined));
      navigateTo = (params) => setRoute(makeRoute("Complaints", params));
      return <ComplaintsScreen navigation={navigation} route={route} />;
    }
    await renderWithProviders(<Harness />);
    await fireEvent.press(await screen.findByRole("radio", { name: "Resolved, 1" }));
    await fireEvent.changeText(screen.getByPlaceholderText("Search number, customer, mobile"), "sharma");
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(lastList()).toMatchObject({ StatusId: 3, SearchTerm: "sharma" }));
    await act(async () => navigateTo({ queue: "overdue" }));
    await waitFor(() => expect(lastList()).toEqual({ ...complaintQueueParams("overdue", "active", 42, ""), PageNumber: 1 }));
    expect(screen.getByPlaceholderText("Search number, customer, mobile").props.value).toBe("");
  });
});

describe("T2 · two panes", () => {
  beforeEach(() => {
    setWindow(...TABLET);
    jest.mocked(fetchTicketDetail).mockResolvedValue({ ticket: ticket(), fields: [], activity: [], assignments: [], linkedLead: null });
  });

  it("starts on 'Pick a complaint'; a tap selects instead of pushing, and tints the row", async () => {
    const navigation = makeNavigation<"Complaints">();
    await mount(navigation);
    expect(await screen.findByText("Pick a complaint")).toBeOnTheScreen();
    await fireEvent.press(await screen.findByTestId("complaint-7"));
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(await screen.findByRole("header", { name: "T-7" })).toBeOnTheScreen();
    expect(screen.getByTestId("complaint-7")).toBeSelected();
    expect(screen.queryByText("Pick a complaint")).toBeNull();
  });

  it("E's pane gutters: the list 16, the record 24", async () => {
    await mount();
    expect(flat(await screen.findByTestId("list-body")).paddingHorizontal).toBe(16);
    await fireEvent.press(await screen.findByTestId("complaint-7"));
    await screen.findByRole("header", { name: "T-7" });
    const scroll = screen.getByTestId("record-scroll");
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingHorizontal).toBe(24);
  });

  it("deleting the selected complaint empties the pane; Edit opens the form", async () => {
    const navigation = makeNavigation<"Complaints">();
    jest.mocked(require("../../api/ticketQueries").deleteTicket).mockResolvedValue(envelope(null));
    await mount(navigation);
    await fireEvent.press(await screen.findByTestId("complaint-7"));
    await screen.findByRole("header", { name: "T-7" });
    await fireEvent.press(screen.getByRole("menuitem", { name: "Edit complaint" }));
    expect(navigation.navigate).toHaveBeenCalledWith("ComplaintForm", { ticketId: 7 });
    await fireEvent.press(screen.getByRole("menuitem", { name: "Delete complaint" }));
    await fireEvent.press(screen.getByText("Delete"));
    expect(await screen.findByText("Pick a complaint")).toBeOnTheScreen();
  });
});
