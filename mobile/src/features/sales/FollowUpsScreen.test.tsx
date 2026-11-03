import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchLookups } from "../../api/configQueries";
import { completeFollowUp, fetchFollowUps, scheduleFollowUp, skipFollowUp, type FetchFollowUpsParams } from "../../api/followupQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { FollowUp } from "../../types/api";
import { colors } from "../../theme";
import { envelope, followUp, localDay, pagination, serverError } from "../../test/fixtures";
import { spySheets } from "../../test/sheets";
import { flat } from "../../test/style";
import { PHONE, setWindow } from "../../test/window";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import FollowUpsScreen from "./FollowUpsScreen";

jest.mock("../../api/followupQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/productQueries");

// FlatList schedules a batched render on a timer; fake timers park it (RNTL's
// waitFor/findBy advance them), and the search debounce runs on them too.
jest.useFakeTimers();

const reply = (followups: FollowUp[], total = followups.length) => envelope({ followups, pagination: pagination(total) });
const today = localDay();
const tomorrow = localDay(1);

type Reply = ReturnType<typeof reply>;
/** Counts (PageSize 1) answer 4 / 2; Done today answers `done`; the list answers `list`. */
function answer(list: (p: FetchFollowUpsParams) => Promise<Reply>, done: () => Promise<Reply> = () => Promise.resolve(reply([]))) {
  jest.mocked(fetchFollowUps).mockImplementation((p = {}) => {
    if (p.PageSize === 1) return Promise.resolve(reply([], p.Overdue ? 2 : 4));
    if (p.DoneFrom) return done();
    return list(p);
  });
}
/** The list's own requests. */
const listCalls = () =>
  jest.mocked(fetchFollowUps).mock.calls.map(([p]) => p as FetchFollowUpsParams).filter((p) => p.PageSize === 50 && !p.DoneFrom);
const lastList = () => listCalls().at(-1);

const grant = (edit: boolean) => ({ modules: { leads: { view: true, add: false, edit, delete: false, reach: "Own" as const } } });

const mount = (navigation = makeNavigation<"FollowUps">(), params?: { view: "overdue" | "all" | "today" }) =>
  renderWithProviders(<FollowUpsScreen navigation={navigation} route={makeRoute("FollowUps", params)} />);

const openSearch = () => fireEvent.press(screen.getByRole("button", { name: "Search follow-ups" }));

// ReanimatedSwipeable under the reanimated jest mock reports its JS callbacks
// as "not worklets" — library noise in tests only (ui/SwipeRow.test does the same).
const realError = console.error;
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation((msg: unknown, ...rest: unknown[]) => {
    if (!String(msg).includes("Some of the callbacks in the gesture are worklets")) realError(msg, ...rest);
  });
});
afterEach(() => jest.mocked(console.error).mockRestore());

beforeEach(() => {
  setWindow(...PHONE);
  seedAuth({ UserId: 42, access: grant(true) });
  answer(() => Promise.resolve(reply([followUp()])));
  jest.mocked(fetchLookups).mockResolvedValue([]);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([]);
  jest.mocked(fetchProducts).mockResolvedValue([]);
  jest.mocked(completeFollowUp).mockResolvedValue(envelope({ Id: 11, NextId: null }));
  jest.mocked(skipFollowUp).mockResolvedValue(envelope({ Id: 11 }));
  jest.mocked(scheduleFollowUp).mockResolvedValue(envelope({ Id: 12 }));
});

it("opens on Today: open follow-ups due today, page 1 of 50", async () => {
  await mount();
  expect(await screen.findByText("Ramesh Patel")).toBeOnTheScreen();
  expect(lastList()).toEqual(expect.objectContaining({ Status: "open", DueFrom: today, DueTo: today, PageNumber: 1, SearchTerm: null }));
  expect(screen.getByRole("header", { name: "Follow-ups" })).toBeOnTheScreen();
});

it("E 17: the band says how many are left today; the views carry Today and Overdue counts; All stays fourth (7.3)", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  expect(await screen.findByText(/· 4 calls and visits left today$/)).toBeOnTheScreen();
  await waitFor(() =>
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual(["Today, 4", "Overdue, 2", "Upcoming", "All"]),
  );
});

it("one left reads singular", async () => {
  jest.mocked(fetchFollowUps).mockImplementation((p = {}) => Promise.resolve(reply([], p.PageSize === 1 ? 1 : 0)));
  await mount();
  expect(await screen.findByText(/· 1 call or visit left today$/)).toBeOnTheScreen();
});

it("a follow-up booked for a day with no time reads Today, not 12:00 am (device)", async () => {
  answer(() => Promise.resolve(reply([followUp({ DueAt: `${today}T00:00:00` })])));
  await mount();
  const row = within(await screen.findByTestId("followup-row-11"));
  expect(row.getByText("Today")).toBeOnTheScreen();
  expect(row.queryByText("12:00 am")).toBeNull();
});

it("E 17 row: the type badge, the name and time, type · company · remarks, a green Done pill", async () => {
  answer(() => Promise.resolve(reply([followUp({ DueAt: `${today}T15:00:00`, Remarks: "10 kW quote" })])));
  await mount();
  const row = within(await screen.findByTestId("followup-row-11"));
  expect(row.getByText("3:00 pm")).toBeOnTheScreen();
  expect(row.getByText("Call · Patel Solar · 10 kW quote")).toBeOnTheScreen();
  expect(row.getByRole("button", { name: "Mark Ramesh Patel done" })).toBeOnTheScreen();
  // One rounded group cut per cell (ListGroupCell): whisper outside, clip inside.
  const [cell] = screen.getAllByTestId("list-cell");
  expect(flat(cell!)).toMatchObject({ boxShadow: "0 1px 2px #DCE0EC", borderTopLeftRadius: 16, borderBottomLeftRadius: 16 });
  expect(flat(cell!.children[0] as never)).toMatchObject({ overflow: "hidden" });
});

it("an overdue row: red badge and red day", async () => {
  answer(() => Promise.resolve(reply([followUp({ IsOverdue: true, Type: "visit", DueAt: "2026-11-01T17:00:00" })])));
  await mount();
  const time = await screen.findByText("Sun, 1 Nov 5:00 pm");
  expect(flat(time).color).toBe(colors.dangerText);
});

it("closed rows in All carry Done / Skipped and no Done pill", async () => {
  answer(() =>
    Promise.resolve(
      reply([
        followUp({ Id: 1, Status: "done", LeadName: "Done lead", DoneAt: "2026-10-30T09:00:00", DueAt: "2026-10-30" }),
        followUp({ Id: 2, Status: "skipped", LeadName: "Skipped lead", DueAt: "2026-10-30" }),
        followUp({ Id: 3, Status: "cancelled", LeadName: "Won lead", DueAt: "2026-10-31" }),
      ]),
    ),
  );
  await mount(makeNavigation<"FollowUps">(), { view: "all" });
  await screen.findByText("Done lead");
  expect(within(screen.getByTestId("followup-row-1")).getByText("Done")).toBeOnTheScreen();
  expect(within(screen.getByTestId("followup-row-2")).getByText("Skipped")).toBeOnTheScreen();
  // 119: cancelled by a won/lost lead.
  expect(within(screen.getByTestId("followup-row-3")).getByText("Cancelled")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /^Mark .+ done$/ })).toBeNull();
  expect(screen.getByText("Fri, 30 Oct 9:00 am")).toBeOnTheScreen();
});

it("the Done pill opens the done sheet; logging it sends the remarks", async () => {
  const { present } = spySheets();
  await mount();
  await screen.findByText("Ramesh Patel");
  present.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Mark Ramesh Patel done" }));
  expect(present).toHaveBeenCalledTimes(1);
  await fireEvent.changeText(screen.getByPlaceholderText("What was discussed — the next person reads this"), "Booked a visit");
  await fireEvent.press(screen.getByText("Mark done"));
  await waitFor(() => expect(completeFollowUp).toHaveBeenCalledWith(expect.objectContaining({ Id: 11, Remarks: "Booked a visit", Direction: "out" }), expect.anything()));
});

it("swipe right reveals Done, swipe left Reschedule; each opens its sheet, nothing is written by the swipe", async () => {
  const { present } = spySheets();
  await mount();
  await screen.findByText("Ramesh Patel");
  present.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await fireEvent.press(screen.getAllByRole("button", { name: "Reschedule" })[0]!);
  expect(present).toHaveBeenCalledTimes(2);
  expect(completeFollowUp).not.toHaveBeenCalled();
  expect(skipFollowUp).not.toHaveBeenCalled();
  // The reschedule sheet then books the new day.
  await fireEvent.press(screen.getAllByRole("radio", { name: "Tomorrow" })[1]!);
  await fireEvent.changeText(screen.getByPlaceholderText("Why it is moving"), "Asked for Friday");
  // [0] the swipe block, [1] the sheet's title, [2] its submit.
  await fireEvent.press(screen.getAllByText("Reschedule")[2]!);
  await waitFor(() => expect(skipFollowUp).toHaveBeenCalled());
  expect(scheduleFollowUp).toHaveBeenCalledWith({ LeadId: 21, Type: "call", DueAt: `${tomorrow}T10:00`, AssignedTo: null });
  expect(screen.getByText("Swipe a row right to mark it done, left to reschedule.")).toBeOnTheScreen();
});

it("a view-only role sees no Done pill, no swipes and no footnote", async () => {
  seedAuth({ UserId: 42, access: grant(false) });
  await mount();
  await screen.findByText("Ramesh Patel");
  expect(screen.queryByRole("button", { name: /^Mark .+ done$/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reschedule" })).toBeNull();
  expect(screen.queryByText(/^Swipe a row/)).toBeNull();
});

describe("Done today (G20, SQL 118)", () => {
  it("asks for done follow-ups with DoneAt today — Status done, tomorrow as the exclusive end — and lists them", async () => {
    answer(
      () => Promise.resolve(reply([followUp()])),
      () => Promise.resolve(reply([followUp({ Id: 99, Status: "done", LeadName: "Sunita Agarwal", DoneAt: `${today}T11:00:00` })])),
    );
    await mount();
    expect(await screen.findByText("Done today · 1")).toBeOnTheScreen();
    // E 17: an overline, like every E group label but Home's.
    expect(flat(screen.getByText("Done today · 1"))).toMatchObject({ textTransform: "uppercase", fontSize: 12 });
    expect(fetchFollowUps).toHaveBeenCalledWith({ Status: "done", DoneFrom: today, DoneTo: tomorrow, PageSize: 50 });
    const name = screen.getByText("Sunita Agarwal");
    expect(flat(name).color).toBe(colors.textSecondary);
    expect(screen.getByText("11:00 am")).toBeOnTheScreen();
  });

  it("a server without 118 refuses the filter: the group reads — and nothing crashes", async () => {
    answer(() => Promise.resolve(reply([followUp()])), () => Promise.reject(serverError(500, "Procedure has too many arguments")));
    // Retrying a call that cannot succeed only delays the "—": a client that retries by default must not here.
    await renderWithProviders(<FollowUpsScreen navigation={makeNavigation<"FollowUps">()} route={makeRoute("FollowUps", undefined)} />, {
      queryClient: new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0, gcTime: 0 } } }),
    });
    expect(await screen.findByText("Done today · —")).toBeOnTheScreen();
    expect(jest.mocked(fetchFollowUps).mock.calls.filter(([p]) => p?.DoneFrom)).toHaveLength(1);
    expect(screen.getByText("Ramesh Patel")).toBeOnTheScreen();
  });

  it("is only on Today", async () => {
    await mount(makeNavigation<"FollowUps">(), { view: "overdue" });
    await screen.findByText("Ramesh Patel");
    expect(screen.queryByText(/^Done today/)).toBeNull();
    expect(jest.mocked(fetchFollowUps).mock.calls.some(([p]) => p?.DoneFrom)).toBe(false);
  });
});

it("the band's calendar picks a day: every follow-up due that day; a view tab goes back", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  await fireEvent.press(screen.getByRole("button", { name: "Pick a day" }));
  expect(screen.getByText("Due on")).toBeOnTheScreen();
  // The date picker is a plain View in jest: open it, then fire its pick.
  await fireEvent.press(screen.getByText("Pick a day"));
  await fireEvent(screen.getByTestId("date-picker"), "valueChange", { type: "set" }, new Date(2026, 10, 9));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ DueFrom: "2026-11-09", DueTo: "2026-11-09" })));
  expect(lastList()?.Status).toBeUndefined();
  await fireEvent.press(screen.getByRole("tab", { name: /^Overdue/ }));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ Overdue: true })));
});

describe("paging", () => {
  const list = () => screen.getByTestId("followups-list");
  const pageCalls = (n: number) => listCalls().filter((p) => p.PageNumber === n);

  it("reaching the end asks for the next page and shows it", async () => {
    answer((p) =>
      Promise.resolve(p.PageNumber === 2 ? reply([followUp({ Id: 12, LeadName: "Meera Joshi" })], 120) : reply([followUp()], 120)),
    );
    await mount();
    await screen.findByText("Ramesh Patel");
    await fireEvent(list(), "onEndReached");
    expect(await screen.findByText("Meera Joshi")).toBeOnTheScreen();
    expect(pageCalls(2)).toHaveLength(1);
  });

  it("never asks past the last page", async () => {
    await mount();
    await screen.findByText("Ramesh Patel");
    await fireEvent(list(), "onEndReached");
    await act(() => jest.advanceTimersByTime(1000));
    expect(pageCalls(2)).toHaveLength(0);
  });

  it("a row that shifts onto the next page while scrolling shows once", async () => {
    answer((p) =>
      Promise.resolve(
        p.PageNumber === 2
          ? reply([followUp({ Id: 12, LeadName: "Meera Joshi (moved)" }), followUp({ Id: 13, LeadName: "Arjun Rao" })], 120)
          : reply([followUp(), followUp({ Id: 12, LeadName: "Meera Joshi" })], 120),
      ),
    );
    await mount();
    await screen.findByText("Meera Joshi");
    await fireEvent(list(), "onEndReached");
    expect(await screen.findByText("Arjun Rao")).toBeOnTheScreen();
    expect(screen.getAllByText(/^Meera Joshi/)).toHaveLength(1);
  });
});

const spinning = () => screen.getByTestId("followups-list").props.refreshControl.props.refreshing;

it("switching view does not spin pull-to-refresh, and shows no empty flash while in flight", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  answer(() => new Promise(() => {}));
  await fireEvent.press(screen.getByRole("tab", { name: /^Overdue/ }));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ Overdue: true })));
  expect(spinning()).toBe(false);
  expect(screen.queryByText("Nothing overdue")).toBeNull();
});

it("a pull spins pull-to-refresh", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  answer(() => new Promise(() => {}));
  await act(() => {
    void screen.getByTestId("followups-list").props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(spinning()).toBe(true));
});

it("search hides behind the band button, waits for typing to pause, and says when nothing matches", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  expect(screen.queryByPlaceholderText("Lead name, company or mobile")).toBeNull();
  await openSearch();
  answer((p) => Promise.resolve(p.SearchTerm ? reply([]) : reply([followUp()])));
  await fireEvent.changeText(screen.getByPlaceholderText("Lead name, company or mobile"), "pat");
  expect(listCalls().some((p) => p.SearchTerm === "pat")).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(await screen.findByText("Nothing matches")).toBeOnTheScreen();
  // Closing the search clears it.
  await fireEvent.press(screen.getByRole("button", { name: "Close search" }));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ SearchTerm: null })));
});

it("tapping a row opens its lead", async () => {
  const navigation = makeNavigation<"FollowUps">();
  answer(() => Promise.resolve(reply([followUp({ LeadId: 55 })])));
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Ramesh Patel"));
  expect(navigation.navigate).toHaveBeenCalledWith("LeadDetail", { leadId: 55 });
});

it("an empty Today says nothing is due", async () => {
  answer(() => Promise.resolve(reply([])));
  await mount();
  expect(await screen.findByText("Nothing due today")).toBeOnTheScreen();
});

it("a failed fetch shows the error card; Try again refetches", async () => {
  answer(() => Promise.reject(new Error("boom")));
  await mount();
  expect(await screen.findByText("Could not load. Try again")).toBeOnTheScreen();
  answer(() => Promise.resolve(reply([followUp()])));
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Ramesh Patel")).toBeOnTheScreen();
});

it("loading shows skeleton rows", async () => {
  answer(() => new Promise(() => {}));
  await mount();
  expect(screen.getByLabelText("Loading")).toBeOnTheScreen();
});

describe("tab or pushed", () => {
  it("opens on the view a navigate() asks for", async () => {
    await mount(makeNavigation<"FollowUps">(), { view: "overdue" });
    await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ Overdue: true })));
    expect(listCalls().some((p) => p.DueTo === today)).toBe(false);
  });

  it("as a tab it has no back button; pushed, back goes back", async () => {
    await mount();
    await screen.findByText("Ramesh Patel");
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
  });

  it("pushed, its back button goes back", async () => {
    const navigation = makeNavigation<"FollowUps">();
    await renderWithProviders(<FollowUpsScreen navigation={navigation} route={makeRoute("FollowUps", undefined)} pushed />);
    await fireEvent.press(await screen.findByRole("button", { name: "Go back" }));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

// A mounted tab keeps its search; Home's navigate must land on exactly the list its number counted.
it("a navigate() with a view clears the search the user left", async () => {
  const navigation = makeNavigation<"FollowUps">();
  let navigateTo: (params: { view: "today" }) => void = () => {};
  function Harness() {
    const [route, setRoute] = useState(makeRoute("FollowUps", { view: "all" }));
    navigateTo = (params) => setRoute(makeRoute("FollowUps", params));
    return <FollowUpsScreen navigation={navigation} route={route} />;
  }
  await renderWithProviders(<Harness />);
  await screen.findByText("Ramesh Patel");
  await openSearch();
  await fireEvent.changeText(screen.getByPlaceholderText("Lead name, company or mobile"), "patel");
  await act(async () => { jest.advanceTimersByTime(300); });
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ SearchTerm: "patel" })));
  await act(async () => navigateTo({ view: "today" }));
  await waitFor(() => expect(lastList()).toEqual(expect.objectContaining({ Status: "open", DueFrom: today, DueTo: today, SearchTerm: null })));
  expect(screen.getByPlaceholderText("Lead name, company or mobile").props.value).toBe("");
});

