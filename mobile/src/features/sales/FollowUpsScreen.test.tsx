import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchFollowUps } from "../../api/followupQueries";
import type { FollowUp } from "../../types/api";
import { chipTones } from "../../theme";
import { envelope, followUp, localDay, pagination } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders } from "../../test/renderWithProviders";
import FollowUpsScreen from "./FollowUpsScreen";

jest.mock("../../api/followupQueries");

// FlatList schedules a batched render on a timer; real timers let it fire
// between waitFor polls, outside act(). Fake timers park it (RNTL's
// waitFor/findBy advance them), and the search debounce runs on them too.
jest.useFakeTimers();

const reply = (followups: FollowUp[], total = followups.length) =>
  envelope({ followups, pagination: pagination(total) });

const mount = (navigation = makeNavigation<"FollowUps">()) =>
  renderWithProviders(<FollowUpsScreen navigation={navigation} route={makeRoute("FollowUps", undefined)} />);

const today = localDay();

beforeEach(() => {
  jest.mocked(fetchFollowUps).mockResolvedValue(reply([followUp()]));
});

it("opens on Today: open follow-ups due today, page 1 of 50", async () => {
  await mount();
  expect(await screen.findByText("Ramesh Patel")).toBeOnTheScreen();
  expect(fetchFollowUps).toHaveBeenCalledWith(
    expect.objectContaining({
      Status: "open",
      DueFrom: today,
      DueTo: today,
      PageNumber: 1,
      PageSize: 50,
      SearchTerm: null,
    }),
  );
  expect(screen.getByText("Follow-ups")).toBeOnTheScreen();
  expect(screen.getByText("1 follow-ups")).toBeOnTheScreen();
});

describe("paging", () => {
  const list = () => screen.getByTestId("followups-list");
  const pageCalls = (n: number) =>
    jest.mocked(fetchFollowUps).mock.calls.filter(([p]) => p?.PageNumber === n);

  it("reaching the end asks for the next page and shows it; the header keeps the server total", async () => {
    jest
      .mocked(fetchFollowUps)
      .mockResolvedValueOnce(reply([followUp()], 120))
      .mockResolvedValueOnce(reply([followUp({ Id: 12, LeadName: "Meera Joshi" })], 120));
    await mount();
    await screen.findByText("Ramesh Patel");
    expect(screen.getByText("120 follow-ups")).toBeOnTheScreen();

    await fireEvent(list(), "onEndReached");
    expect(await screen.findByText("Meera Joshi")).toBeOnTheScreen();
    expect(pageCalls(2)).toHaveLength(1);
    expect(pageCalls(2)[0]![0]).toEqual(expect.objectContaining({ Status: "open", PageSize: 50 }));
    expect(screen.getByText("Ramesh Patel")).toBeOnTheScreen();
    expect(screen.getByText("120 follow-ups")).toBeOnTheScreen();
  });

  it("never asks past the last page", async () => {
    await mount(); // 1 row = one page
    await screen.findByText("Ramesh Patel");
    await fireEvent(list(), "onEndReached");
    await act(() => jest.advanceTimersByTime(1000));
    expect(pageCalls(2)).toHaveLength(0);
  });

  it("does not page while a new search is still loading over the old rows", async () => {
    jest
      .mocked(fetchFollowUps)
      .mockResolvedValueOnce(reply([followUp()], 120))
      .mockReturnValue(new Promise(() => {}));
    await mount();
    await screen.findByText("Ramesh Patel");
    await fireEvent.changeText(screen.getByPlaceholderText("Lead name, company or mobile"), "zz");
    await waitFor(() =>
      expect(fetchFollowUps).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "zz" })),
    );
    const before = jest.mocked(fetchFollowUps).mock.calls.length;
    await fireEvent(list(), "onEndReached");
    await act(() => jest.advanceTimersByTime(1000));
    expect(fetchFollowUps).toHaveBeenCalledTimes(before);
  });

  it("a row that shifts onto the next page while scrolling shows once", async () => {
    jest
      .mocked(fetchFollowUps)
      .mockResolvedValueOnce(reply([followUp(), followUp({ Id: 12, LeadName: "Meera Joshi" })], 120))
      .mockResolvedValueOnce(
        reply([followUp({ Id: 12, LeadName: "Meera Joshi (moved)" }), followUp({ Id: 13, LeadName: "Arjun Rao" })], 120),
      );
    await mount();
    await screen.findByText("Meera Joshi");
    await fireEvent(list(), "onEndReached");
    expect(await screen.findByText("Arjun Rao")).toBeOnTheScreen();
    expect(screen.getAllByText(/^Meera Joshi/)).toHaveLength(1);
    expect(screen.getByText("Meera Joshi")).toBeOnTheScreen();
  });
});

it("switching view does not spin pull-to-refresh; a pull does", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  const spinning = () => screen.getByTestId("followups-list").props.refreshControl.props.refreshing;
  jest.mocked(fetchFollowUps).mockReturnValue(new Promise(() => {}));
  await fireEvent.press(screen.getByText("Overdue"));
  await waitFor(() =>
    expect(fetchFollowUps).toHaveBeenLastCalledWith(expect.objectContaining({ Overdue: true })),
  );
  expect(spinning()).toBe(false);

  // Back on Today with a server that answers: let its background refetch land
  // so nothing is in flight and the rows are real, not a placeholder.
  jest.mocked(fetchFollowUps).mockResolvedValue(reply([followUp()], 3));
  const settled = jest.mocked(fetchFollowUps).mock.calls.length;
  await fireEvent.press(screen.getByText("Today"));
  await screen.findByText("3 follow-ups");
  await waitFor(() => expect(fetchFollowUps).toHaveBeenCalledTimes(settled + 1));
  await act(() => jest.advanceTimersByTime(100));
  expect(spinning()).toBe(false);

  // The pull, and only the pull, starts the spinner. It never settles, so
  // fire it without awaiting.
  jest.mocked(fetchFollowUps).mockReturnValue(new Promise(() => {}));
  await act(() => {
    void screen.getByTestId("followups-list").props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(spinning()).toBe(true));
});

it("no empty-state flash for the new view while its reply is in flight", async () => {
  jest.mocked(fetchFollowUps).mockResolvedValueOnce(reply([])).mockReturnValue(new Promise(() => {}));
  await mount();
  await screen.findByText("Nothing due today");
  await fireEvent.press(screen.getByText("Overdue"));
  await waitFor(() =>
    expect(fetchFollowUps).toHaveBeenLastCalledWith(expect.objectContaining({ Overdue: true })),
  );
  expect(screen.queryByText("Nothing overdue")).toBeNull();
  expect(screen.queryByText("Nothing due today")).toBeNull();
});

it("no 'Nothing matches' flash while a search is in flight", async () => {
  jest.mocked(fetchFollowUps).mockResolvedValueOnce(reply([])).mockReturnValue(new Promise(() => {}));
  await mount();
  await screen.findByText("Nothing due today");
  await fireEvent.changeText(screen.getByPlaceholderText("Lead name, company or mobile"), "zz");
  await waitFor(() =>
    expect(fetchFollowUps).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "zz" })),
  );
  expect(screen.queryByText("Nothing matches")).toBeNull();
});

it("a search with no hits says nothing matches", async () => {
  jest.mocked(fetchFollowUps).mockResolvedValueOnce(reply([followUp()])).mockResolvedValue(reply([]));
  await mount();
  await screen.findByText("Ramesh Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("Lead name, company or mobile"), "zz");
  expect(await screen.findByText("Nothing matches")).toBeOnTheScreen();
});

it("Overdue asks the server for overdue rows", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  await fireEvent.press(screen.getByText("Overdue"));
  await waitFor(() =>
    expect(fetchFollowUps).toHaveBeenLastCalledWith(expect.objectContaining({ Overdue: true, PageSize: 50 })),
  );
});

it("a row shows the lead, the type and day, and goes danger when overdue", async () => {
  jest.mocked(fetchFollowUps).mockResolvedValue(
    reply([followUp({ IsOverdue: true, Type: "visit", DueAt: `${localDay(-1)}T10:00:00` })]),
  );
  await mount();
  const chip = await screen.findByText("Visit · Yesterday");
  expect(chip).toHaveStyle({ color: chipTones.danger.text });
  expect(screen.getByText("9825012345 · Patel Solar")).toBeOnTheScreen();
});

it("an on-time open row is not danger", async () => {
  await mount();
  expect(await screen.findByText("Call · Today")).not.toHaveStyle({ color: chipTones.danger.text });
});

it("closed rows carry a Done or Skipped chip", async () => {
  jest.mocked(fetchFollowUps).mockResolvedValue(
    reply([
      followUp({ Id: 1, Status: "done", LeadName: "Done lead" }),
      followUp({ Id: 2, Status: "skipped", LeadName: "Skipped lead" }),
    ]),
  );
  await mount();
  await screen.findByText("Done lead");
  expect(screen.getByText("Done")).toBeOnTheScreen();
  expect(screen.getByText("Skipped")).toBeOnTheScreen();
});

it("tapping a row opens its lead", async () => {
  const navigation = makeNavigation<"FollowUps">();
  jest.mocked(fetchFollowUps).mockResolvedValue(reply([followUp({ LeadId: 55 })]));
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Ramesh Patel"));
  expect(navigation.navigate).toHaveBeenCalledWith("LeadDetail", { leadId: 55 });
});

it("an empty Today says nothing is due", async () => {
  jest.mocked(fetchFollowUps).mockResolvedValue(reply([]));
  await mount();
  expect(await screen.findByText("Nothing due today")).toBeOnTheScreen();
});

it("a failed fetch says so", async () => {
  jest.mocked(fetchFollowUps).mockRejectedValue(new Error("boom"));
  await mount();
  expect(await screen.findByText("Couldn't load follow-ups")).toBeOnTheScreen();
});

it("search waits for typing to pause, and keeps the list up meanwhile", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("Lead name, company or mobile"), "pat");
  // Not per keystroke: nothing is sent until the pause.
  expect(fetchFollowUps).not.toHaveBeenCalledWith(expect.objectContaining({ SearchTerm: "pat" }));
  jest.mocked(fetchFollowUps).mockReturnValue(new Promise(() => {}));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(fetchFollowUps).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "pat" }));
  // The new page is still in flight: the old rows stay instead of blanking.
  expect(screen.getByText("Ramesh Patel")).toBeOnTheScreen();
});
