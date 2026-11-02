import { StyleSheet } from "react-native";
import { useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchCalls } from "../../api/callQueries";
import { fetchLookups } from "../../api/configQueries";
import { fetchLeadDetail, fetchLeads, type FetchLeadsParams } from "../../api/leadQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers, fetchUserDirectory } from "../../api/userQueries";
import useAuthStore from "../../stores/useAuthStore";
import type { Access, Lead, Lookup } from "../../types/api";
import { envelope, lead, pagination } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { flat } from "../../test/style";
import { PHONE, setWindow, TABLET } from "../../test/window";
import { leadQueueParams } from "./leadHelpers";
import LeadsScreen from "./LeadsScreen";

jest.mock("../../api/leadQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/productQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/callQueries");

// Lists arm VirtualizedList's batch timer on every data change; fake timers
// park it (RNTL's waitFor/findBy advance them).
jest.useFakeTimers();

const row = lead();
const leadsReply = (leads: Lead[], total = leads.length) => envelope({ leads, pagination: pagination(total) });

const status = (Id: number, Value: string, Code: string, SortOrder: number): Lookup =>
  ({ Id, CompId: 1, Kind: "lead_status", Value, SortOrder, IsActive: true, Code }) as Lookup;
const STATUSES = [status(1, "New", "open", 1), status(5, "Qualified", "qualified", 2)];

const leadsGrant = (add: boolean): Partial<Access> => ({
  modules: { leads: { view: true, add, edit: true, delete: false, reach: "Own" } },
});

/** The list's own requests (pages of 50) — counts ask for 1 row, the open value for 200. */
const listCalls = () =>
  jest.mocked(fetchLeads).mock.calls.map(([p]) => p as FetchLeadsParams).filter((p) => p.PageSize === 50);
const lastList = () => listCalls().at(-1);
/**
 * Each count answers its own total (G13), so a count asked with the wrong
 * params shows the wrong number: Mine 12 · All 48 · Overdue 3 · New 5 ·
 * Unassigned 7; a status pill adds its StatusId × 100.
 */
function countFor(p: FetchLeadsParams): number {
  if (p.Overdue) return 3;
  if (p.Unassigned) return 7;
  if (p.OwnerId === 42) return 12 + (p.StatusId ?? 0) * 100;
  if (p.StatusId === 1) return 5; // the New preset
  return 48 + (p.StatusId ?? 0) * 100;
}
const answer = (list: (p: FetchLeadsParams) => Promise<ReturnType<typeof leadsReply>>) =>
  jest.mocked(fetchLeads).mockImplementation((p = {}) => (p.PageSize === 1 ? Promise.resolve(leadsReply([], countFor(p))) : list(p)));

const mount = (navigation = makeNavigation<"Leads">(), params?: { queue?: "overdue" | "all"; term?: string }) =>
  renderWithProviders(<LeadsScreen navigation={navigation} route={makeRoute("Leads", params)} />);

beforeEach(() => {
  setWindow(...PHONE);
  answer(() => Promise.resolve(leadsReply([row], 3)));
  jest.mocked(fetchLookups).mockImplementation(({ Kind }) => Promise.resolve(Kind === "lead_status" ? STATUSES : []));
  jest.mocked(fetchProducts).mockResolvedValue([]);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([]);
  jest.mocked(fetchUserDirectory).mockResolvedValue([]);
  jest.mocked(fetchCalls).mockResolvedValue([]);
  seedAuth({ UserId: 42, access: leadsGrant(true) });
});

it("opens on Mine: the caller's own leads, counted in the band", async () => {
  await mount();
  expect(await screen.findByText("Ravi Patel")).toBeOnTheScreen();
  expect(screen.getByText("Leads")).toBeOnTheScreen();
  expect(screen.getByText("3 yours")).toBeOnTheScreen();
  expect(lastList()).toEqual(expect.objectContaining({ OwnerId: 42, Overdue: false, StatusId: null, SearchTerm: null, PageNumber: 1 }));
});

it("E 14: the five presets carry counts (G13), Overdue in red; the GH is By next follow-up", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  const tabs = screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel);
  await waitFor(() => expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual(["Mine, 12", "All, 48", "Overdue, 3", "New, 5", "Unassigned, 7"]));
  expect(tabs).toHaveLength(5);
  expect(screen.getByText("By next follow-up")).toBeOnTheScreen();
  // The New preset counts the first open-coded status, across the reach.
  expect(fetchLeads).toHaveBeenCalledWith({ ...leadQueueParams("new", "all", 42, "", 1), PageSize: 1, PageNumber: 1 });
});

const valueCalls = () => jest.mocked(fetchLeads).mock.calls.map(([p]) => p as FetchLeadsParams).filter((p) => p.PageSize === 200);

it("G3: the open value of Mine, from one 200-row page — not refetched per preset, pill or search", async () => {
  answer((p) =>
    Promise.resolve(
      p.PageSize === 200
        ? leadsReply([lead({ EstValue: 1000000 }), lead({ Id: 2, EstValue: 123000 }), lead({ Id: 3, StatusCode: "lost", EstValue: 5 })], 3)
        : leadsReply([row], 3),
    ),
  );
  await mount();
  expect(await screen.findByText("Open value ₹11,23,000")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", { name: /^All/ }));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ OwnerId: null })));
  await fireEvent.press(await screen.findByRole("radio", { name: /^Qualified/ }));
  await fireEvent.changeText(screen.getByPlaceholderText("Search name, company, mobile"), "patel");
  await act(() => jest.advanceTimersByTime(300));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ SearchTerm: "patel", StatusId: 5 })));
  expect(valueCalls()).toEqual([{ ...leadQueueParams("mine", "all", 42, ""), PageSize: 200, PageNumber: 1 }]);
  expect(screen.getByText("Open value ₹11,23,000")).toBeOnTheScreen();
});

it("G3: hidden when Mine is longer than one 200-row page", async () => {
  answer(() => Promise.resolve(leadsReply([row], 201)));
  await mount();
  await screen.findByText("Ravi Patel");
  await waitFor(() => expect(valueCalls()).toHaveLength(1));
  expect(screen.queryByText(/Open value/)).toBeNull();
});

it("while a search is set the pills drop their counts (no count storm per term); the presets' counts follow the term", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  await waitFor(() => expect(screen.getByRole("radio", { name: "Qualified, 512" })).toBeOnTheScreen());
  const pillCounts = () => jest.mocked(fetchLeads).mock.calls.filter(([p]) => p?.PageSize === 1 && p.StatusId != null && p.SearchTerm).length;
  await fireEvent.changeText(screen.getByPlaceholderText("Search name, company, mobile"), "patel");
  await act(() => jest.advanceTimersByTime(300));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Qualified" })).toBeOnTheScreen());
  expect(pillCounts()).toBe(1); // only the New preset's own count carries a StatusId
  expect(fetchLeads).toHaveBeenCalledWith({ ...leadQueueParams("overdue", "all", 42, "patel"), PageSize: 1, PageNumber: 1 });
});

it("the status pills (7.2) narrow by StatusId and carry counts; New hides them", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  await waitFor(() =>
    expect(screen.getAllByRole("radio").map((r) => r.props.accessibilityLabel)).toEqual(["All, 12", "New, 112", "Qualified, 512"]),
  );
  await fireEvent.press(screen.getByRole("radio", { name: "Qualified, 512" }));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ StatusId: 5, OwnerId: 42 })));

  await fireEvent.press(screen.getByRole("tab", { name: /^New/ }));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ StatusId: 1, OwnerId: null })));
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
});

it("New waits for the statuses: no request that would list every status", async () => {
  jest.mocked(fetchLookups).mockImplementation(() => new Promise(() => {}));
  await mount();
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  await fireEvent.press(screen.getByRole("tab", { name: /^New/ }));
  const before = listCalls().length;
  await act(() => jest.advanceTimersByTime(1000));
  expect(listCalls()).toHaveLength(before);
  expect(screen.getByLabelText("Loading")).toBeOnTheScreen();
});

describe("paging", () => {
  const list = () => screen.getByTestId("leads-list");
  const pageCalls = (n: number) => listCalls().filter((p) => p.PageNumber === n);

  it("reaching the end asks for the next page and shows it; the band keeps the server total", async () => {
    answer((p) =>
      Promise.resolve(p.PageNumber === 2 ? leadsReply([lead({ Id: 12, Name: "Meera Joshi" })], 120) : leadsReply([row], 120)),
    );
    await mount();
    await screen.findByText("Ravi Patel");
    expect(screen.getByText("120 yours")).toBeOnTheScreen();
    await fireEvent(list(), "onEndReached");
    expect(await screen.findByText("Meera Joshi")).toBeOnTheScreen();
    expect(pageCalls(2)).toHaveLength(1);
    expect(screen.getByText("Ravi Patel")).toBeOnTheScreen();
  });

  it("never asks past the last page", async () => {
    await mount();
    await screen.findByText("Ravi Patel");
    await fireEvent(list(), "onEndReached");
    await act(() => jest.advanceTimersByTime(1000));
    expect(pageCalls(2)).toHaveLength(0);
  });

  it("a row that shifts onto the next page while scrolling shows once", async () => {
    answer((p) =>
      Promise.resolve(
        p.PageNumber === 2
          ? leadsReply([lead({ Id: 12, Name: "Meera Joshi (moved)" }), lead({ Id: 13, Name: "Arjun Rao" })], 120)
          : leadsReply([row, lead({ Id: 12, Name: "Meera Joshi" })], 120),
      ),
    );
    await mount();
    await screen.findByText("Meera Joshi");
    await fireEvent(list(), "onEndReached");
    expect(await screen.findByText("Arjun Rao")).toBeOnTheScreen();
    expect(screen.getAllByText(/^Meera Joshi/)).toHaveLength(1);
  });

  it("does not page while a new search is still loading over the old rows", async () => {
    await mount();
    await screen.findByText("Ravi Patel");
    answer((p) => (p.SearchTerm ? new Promise(() => {}) : Promise.resolve(leadsReply([row], 120))));
    await fireEvent.changeText(screen.getByPlaceholderText("Search name, company, mobile"), "zz");
    await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ SearchTerm: "zz" })));
    const before = listCalls().length;
    await fireEvent(list(), "onEndReached");
    await act(() => jest.advanceTimersByTime(1000));
    expect(listCalls()).toHaveLength(before);
    // The old rows stay up meanwhile.
    expect(screen.getByText("Ravi Patel")).toBeOnTheScreen();
  });
});

const spinning = () => screen.getByTestId("leads-list").props.refreshControl.props.refreshing;

it("switching preset does not spin pull-to-refresh", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  answer(() => new Promise(() => {}));
  await fireEvent.press(screen.getByRole("tab", { name: /^Overdue/ }));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ Overdue: true, OwnerId: null })));
  expect(spinning()).toBe(false);
});

it("a pull spins pull-to-refresh", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  answer(() => new Promise(() => {}));
  await act(() => {
    void screen.getByTestId("leads-list").props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(spinning()).toBe(true));
});

it("does not fetch until the signed-in user is known", async () => {
  // A null OwnerId would turn Mine into the caller's whole reach.
  useAuthStore.setState({ UserId: null });
  await mount();
  await screen.findByText("Qualified");
  expect(fetchLeads).not.toHaveBeenCalled();
});

it("fast typing sends one request, for the final term", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  const before = listCalls().length;
  const input = screen.getByPlaceholderText("Search name, company, mobile");
  await fireEvent.changeText(input, "p");
  await fireEvent.changeText(input, "pa");
  await fireEvent.changeText(input, " pat ");
  await act(() => jest.advanceTimersByTime(299));
  expect(listCalls()).toHaveLength(before);
  await act(() => jest.advanceTimersByTime(1));
  await waitFor(() => expect(listCalls()).toHaveLength(before + 1));
  expect(lastList()).toEqual(expect.objectContaining({ SearchTerm: "pat" }));
});

it("a failed list shows the error card, and Try again refetches", async () => {
  answer(() => Promise.reject(new Error("boom")));
  await mount();
  expect(await screen.findByText("Could not load. Try again")).toBeOnTheScreen();
  answer(() => Promise.resolve(leadsReply([row], 3)));
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Ravi Patel")).toBeOnTheScreen();
});

it("an empty Mine says so; an empty search says nothing matches", async () => {
  answer(() => Promise.resolve(leadsReply([])));
  await mount();
  expect(await screen.findByText("No leads yet")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByPlaceholderText("Search name, company, mobile"), "zz");
  expect(await screen.findByText("Nothing matches")).toBeOnTheScreen();
});

it("tapping a row opens the lead", async () => {
  const navigation = makeNavigation<"Leads">();
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Ravi Patel"));
  expect(navigation.navigate).toHaveBeenCalledWith("LeadDetail", { leadId: 11 });
});

it("New in the band opens a blank lead form; no add grant, no New", async () => {
  const navigation = makeNavigation<"Leads">();
  await mount(navigation);
  await screen.findByText("Ravi Patel");
  await fireEvent.press(screen.getByRole("button", { name: "New" }));
  expect(navigation.navigate).toHaveBeenCalledWith("LeadForm", {});
});

it("no add grant, no New — the server would refuse the create", async () => {
  seedAuth({ UserId: 42, access: leadsGrant(false) });
  await mount();
  await screen.findByText("Ravi Patel");
  expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
});

describe("as a tab", () => {
  it("opens on the queue a navigate() asks for", async () => {
    await mount(makeNavigation<"Leads">(), { queue: "overdue" });
    await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ Overdue: true, OwnerId: null })));
    expect(listCalls().some((p) => p.OwnerId === 42)).toBe(false);
  });

  it("Search's See all lands on All with its term, so the list is what Search showed", async () => {
    await mount(makeNavigation<"Leads">(), { queue: "all", term: "patel" });
    await waitFor(() => expect(lastList()).toEqual({ ...leadQueueParams("all", "all", 42, "patel"), PageNumber: 1 }));
    expect(screen.getByPlaceholderText("Search name, company, mobile").props.value).toBe("patel");
  });

  // A mounted tab keeps its chip and search; Home's navigate must still land on
  // exactly the list its number counted.
  it("a navigate() with a queue drops the status pill and search the user left", async () => {
    const navigation = makeNavigation<"Leads">();
    let navigateTo: (params: { queue: "mine" }) => void = () => {};
    function Harness() {
      const [route, setRoute] = useState(makeRoute("Leads", { queue: "all" }));
      navigateTo = (params) => setRoute(makeRoute("Leads", params));
      return <LeadsScreen navigation={navigation} route={route} />;
    }
    await renderWithProviders(<Harness />);
    await fireEvent.press(await screen.findByRole("radio", { name: /^Qualified/ }));
    await fireEvent.changeText(screen.getByPlaceholderText("Search name, company, mobile"), "patel");
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ StatusId: 5, SearchTerm: "patel" })));
    await act(async () => navigateTo({ queue: "mine" }));
    await waitFor(() => expect(lastList()).toEqual({ ...leadQueueParams("mine", "all", 42, ""), PageNumber: 1 }));
    expect(screen.getByPlaceholderText("Search name, company, mobile").props.value).toBe("");
  });
});

describe("T3: tablet two-pane", () => {
  beforeEach(() => {
    setWindow(...TABLET);
    answer(() => Promise.resolve(leadsReply([row, lead({ Id: 12, Name: "Meera Joshi", Company: "Joshi Mills" })], 2)));
    jest.mocked(fetchLeadDetail).mockImplementation(({ LeadId }) =>
      Promise.resolve({
        lead: LeadId === 12 ? lead({ Id: 12, Name: "Meera Joshi", Company: "Joshi Mills" }) : row,
        fields: [],
        activity: [],
        followups: [],
        assignments: [],
      }),
    );
  });

  it("the first lead opens beside the list; a row tap selects instead of pushing", async () => {
    const navigation = makeNavigation<"Leads">();
    await mount(navigation);
    // The pane's band names it.
    expect(await screen.findByRole("header", { name: "Ravi Patel" })).toBeOnTheScreen();
    expect(fetchLeadDetail).toHaveBeenCalledWith({ LeadId: 11 });
    // T3's pane has no GH; the actions sit in the band.
    expect(screen.queryByText("By next follow-up")).toBeNull();
    expect(screen.getByRole("button", { name: "Log follow-up" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Meera Joshi"));
    expect(await screen.findByRole("header", { name: "Meera Joshi" })).toBeOnTheScreen();
    expect(navigation.navigate).not.toHaveBeenCalledWith("LeadDetail", expect.anything());
    expect(screen.getByTestId("lead-row-12").props.accessibilityState).toEqual({ selected: true });
  });

  it("E T3 gutters: list band 20 / sheet 16; record band 28; rows in ListGroupCells", async () => {
    await mount();
    await screen.findByRole("header", { name: "Ravi Patel" });
    const bandOf = (n: ReturnType<typeof screen.getByText>) => {
      let b: typeof n | null = n;
      while (b && !flat(b).paddingBottom) b = b.parent;
      return flat(b!);
    };
    expect(bandOf(screen.getByRole("header", { name: "Leads" })).paddingHorizontal).toBe(20);
    expect(bandOf(screen.getByRole("header", { name: "Ravi Patel" })).paddingHorizontal).toBe(28);
    const list = screen.getByTestId("leads-list");
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingHorizontal).toBe(16);
    const cells = screen.getAllByTestId("list-cell");
    expect(cells).toHaveLength(2);
    expect(flat(cells[0]!)).toMatchObject({ borderTopLeftRadius: 16 });
    expect(flat(cells[0]!).boxShadow).toBeUndefined();
    expect(flat(cells[1]!)).toMatchObject({ borderBottomLeftRadius: 16, boxShadow: "0 1px 2px #DCE0EC" });
  });

  it("an empty list leaves the pane saying nothing is selected", async () => {
    answer(() => Promise.resolve(leadsReply([])));
    await mount();
    expect(await screen.findByText("No lead selected")).toBeOnTheScreen();
  });
});
