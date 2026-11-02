import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchFollowUps } from "../../api/followupQueries";
import type { FollowUp } from "../../types/api";
import { colors } from "../../theme";
import { envelope, followUp, localDay, pagination } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders } from "../../test/renderWithProviders";
import FollowUpsScreen from "./FollowUpsScreen";

jest.mock("../../api/followupQueries");

// FlatList schedules a batched render on a timer; real timers let it fire
// between waitFor polls, outside act(). Fake timers park it (RNTL's
// waitFor/findBy advance them), and the search debounce runs on them too.
jest.useFakeTimers();

const reply = (followups: FollowUp[]) => envelope({ followups, pagination: pagination(followups.length) });

const mount = (navigation = makeNavigation<"FollowUps">()) =>
  renderWithProviders(<FollowUpsScreen navigation={navigation} route={makeRoute("FollowUps", undefined)} />);

const today = localDay();

beforeEach(() => {
  jest.mocked(fetchFollowUps).mockResolvedValue(reply([followUp()]));
});

it("opens on Today: open follow-ups due today, a page of 100", async () => {
  await mount();
  expect(await screen.findByText("Ramesh Patel")).toBeOnTheScreen();
  expect(fetchFollowUps).toHaveBeenCalledWith(
    expect.objectContaining({ Status: "open", DueFrom: today, DueTo: today, PageSize: 100, SearchTerm: null }),
  );
  expect(screen.getByText("Follow-ups")).toBeOnTheScreen();
});

it("Overdue asks the server for overdue rows", async () => {
  await mount();
  await screen.findByText("Ramesh Patel");
  await fireEvent.press(screen.getByText("Overdue"));
  await waitFor(() =>
    expect(fetchFollowUps).toHaveBeenLastCalledWith(expect.objectContaining({ Overdue: true, PageSize: 100 })),
  );
});

it("a row shows the lead, the type and day, and goes danger when overdue", async () => {
  jest.mocked(fetchFollowUps).mockResolvedValue(
    reply([followUp({ IsOverdue: true, Type: "visit", DueAt: `${localDay(-1)}T10:00:00` })]),
  );
  await mount();
  const chip = await screen.findByText("Visit · Yesterday");
  expect(chip).toHaveStyle({ color: colors.danger });
  expect(screen.getByText("9825012345 · Patel Solar")).toBeOnTheScreen();
});

it("an on-time open row is not danger", async () => {
  await mount();
  expect(await screen.findByText("Call · Today")).not.toHaveStyle({ color: colors.danger });
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
