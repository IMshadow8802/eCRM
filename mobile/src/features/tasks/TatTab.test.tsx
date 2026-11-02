import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import {
  acknowledgeTat,
  fetchTaskTat,
  holdMine,
  myPartDone,
  releaseMine,
  saveTatReason,
} from "../../api/tatQueries";
import type { Lookup, TaskTat, TaskTatClock, TaskTatHold } from "../../types/api";
import { envelope, serverError } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import { TatTab } from "./TatTab";

jest.mock("../../api/tatQueries");
jest.mock("../../api/configQueries", () => ({
  ...jest.requireActual("../../api/configQueries"),
  fetchLookups: jest.fn(),
}));

const ME = 42;
const TASK = 1;

const clock = (patch: Partial<TaskTatClock> = {}): TaskTatClock => ({
  Id: 500,
  UserId: ME,
  FullName: "Asha Rao",
  AssignedAt: "2026-10-08 09:00:00",
  FirstSeenAt: null,
  AcknowledgedAt: null,
  DueAt: "2026-10-08 17:00:00",
  ClosedAt: null,
  CloseReason: null,
  BreachedAt: null,
  BreachReasonId: null,
  BreachReason: null,
  BreachRemarks: null,
  ReasonAt: null,
  Verdict: null,
  VerdictByName: null,
  VerdictRemarks: null,
  ...patch,
});

const hold = (patch: Partial<TaskTatHold> = {}): TaskTatHold => ({
  HoldId: 1,
  TatId: 500,
  UserId: ME,
  StartedBy: ME,
  Kind: "manual",
  Reason: "Waiting on client",
  Remarks: null,
  StartedAt: "2026-10-08 11:00:00",
  EndedAt: null,
  ...patch,
});

const lookup = (Id: number, Value: string, Kind: string): Lookup => ({
  Id,
  CompId: 1,
  Kind,
  Value,
  SortOrder: Id,
  IsActive: true,
  Code: null,
});

const serve = (tat: Partial<TaskTat>) =>
  jest.mocked(fetchTaskTat).mockResolvedValue({ clocks: [], holds: [], events: [], ...tat });

const mount = () => renderWithProviders(<TatTab taskId={TASK} userId={ME} />);

beforeEach(() => {
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) =>
    Kind === LOOKUP_KIND.taskHoldReason
      ? [lookup(1, "Waiting on client", Kind)]
      : [lookup(2, "Parts late", Kind)],
  );
  for (const fn of [acknowledgeTat, myPartDone, releaseMine, holdMine, saveTatReason]) {
    jest.mocked(fn).mockResolvedValue(envelope(null));
  }
});

it("with no clock of mine, says there is no deadline on me", async () => {
  serve({ clocks: [clock({ UserId: 7 })] });
  await mount();
  expect(await screen.findByText("No deadline on you")).toBeOnTheScreen();
  expect(fetchTaskTat).toHaveBeenCalledWith(TASK);
});

it("a failed load offers a retry", async () => {
  jest.mocked(fetchTaskTat).mockRejectedValue(new Error("boom"));
  await mount();
  expect(await screen.findByText("Try again")).toBeOnTheScreen();
});

it("a fresh clock runs, shows its timeline, and can be accepted", async () => {
  serve({ clocks: [clock({ FirstSeenAt: "2026-10-08 09:05:00" })] });
  await mount();

  expect(await screen.findByText("Running")).toBeOnTheScreen();
  expect(screen.getByText("Assigned")).toBeOnTheScreen();
  expect(screen.getByText("08 Oct 2026, 09:05 IST")).toBeOnTheScreen();
  expect(screen.getByText("08 Oct 2026, 17:00 IST")).toBeOnTheScreen();
  // One open clock on the task: "my part" is the whole task, so no such button.
  expect(screen.queryByText("My part is done")).toBeNull();

  await fireEvent.press(screen.getByText("Accept task"));
  await waitFor(() => expect(acknowledgeTat).toHaveBeenCalledWith(TASK));
});

it("an accepted clock no longer asks to be accepted", async () => {
  serve({ clocks: [clock({ AcknowledgedAt: "2026-10-08 09:10:00" })] });
  await mount();
  expect(await screen.findByText("Accepted")).toBeOnTheScreen();
  expect(screen.queryByText("Accept task")).toBeNull();
});

it("with other assignees still working, I can finish my part", async () => {
  serve({ clocks: [clock(), clock({ Id: 501, UserId: 7 })] });
  await mount();
  await fireEvent.press(await screen.findByText("My part is done"));
  await waitFor(() => expect(myPartDone).toHaveBeenCalledWith(TASK));
});

it("my own manual hold reads On hold and can be resumed", async () => {
  serve({ clocks: [clock()], holds: [hold({ Remarks: "call back" })] });
  await mount();
  expect(await screen.findByText("On hold")).toBeOnTheScreen();
  expect(screen.getByText("On hold: Waiting on client (call back)")).toBeOnTheScreen();
  expect(screen.getByText("08 Oct 2026, 11:00 IST → now")).toBeOnTheScreen();

  await fireEvent.press(screen.getByText("Resume"));
  await waitFor(() => expect(releaseMine).toHaveBeenCalledWith(TASK));
});

it("a dependency hold cannot be resumed by hand", async () => {
  serve({ clocks: [clock()], holds: [hold({ Kind: "blocked", StartedBy: null, Reason: null })] });
  await mount();
  expect(await screen.findByText("On hold: Blocked by a dependency")).toBeOnTheScreen();
  expect(screen.queryByText("Resume")).toBeNull();
});

it("someone else's manual hold is not mine to resume", async () => {
  serve({ clocks: [clock()], holds: [hold({ StartedBy: 7 })] });
  await mount();
  await screen.findByText("On hold");
  expect(screen.queryByText("Resume")).toBeNull();
});

it("putting my part on hold sends the reason and remarks", async () => {
  serve({ clocks: [clock()] });
  await mount();
  await screen.findByText("Running");

  // The first "Put on hold" is the action; the sheet's submit carries the same words.
  await fireEvent.press(screen.getAllByText("Put on hold")[0]!);
  expect(screen.getByText("Why is your part on hold?")).toBeOnTheScreen();
  await fireEvent.press(await screen.findByText("Waiting on client"));
  await fireEvent.changeText(screen.getByPlaceholderText("Remarks (optional)"), "Back Monday");
  await fireEvent.press(screen.getAllByText("Put on hold").at(-1)!);

  await waitFor(() => expect(holdMine).toHaveBeenCalled());
  expect(jest.mocked(holdMine).mock.calls[0]![0]).toEqual({ TaskId: TASK, ReasonId: 1, Remarks: "Back Monday" });
  expect(fetchLookups).toHaveBeenCalledWith({ Kind: LOOKUP_KIND.taskHoldReason });
});

it("a refused hold keeps the sheet open with the server's reason", async () => {
  jest.mocked(holdMine).mockRejectedValue(serverError(400, "This clock is already on hold"));
  serve({ clocks: [clock()] });
  await mount();
  await screen.findByText("Running");
  await fireEvent.press(screen.getAllByText("Put on hold")[0]!);
  await fireEvent.press(await screen.findByText("Waiting on client"));
  await fireEvent.press(screen.getAllByText("Put on hold").at(-1)!);
  expect(await screen.findByText("This clock is already on hold")).toBeOnTheScreen();
});

it("a refused quick action shows the server's reason", async () => {
  jest.mocked(acknowledgeTat).mockRejectedValue(serverError(403, "Not your clock"));
  serve({ clocks: [clock()] });
  await mount();
  await fireEvent.press(await screen.findByText("Accept task"));
  expect(await screen.findByText("Not your clock")).toBeOnTheScreen();
});

it("a missed deadline asks for a reason and sends it against the clock", async () => {
  // parity: TAT-01 — the head chip still reads "Running" for a breached open
  // clock; not asserted here. TAT-02 — remarks stay optional even for "other".
  serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" })] });
  await mount();

  expect(await screen.findByText(/^Missed deadline by /)).toBeOnTheScreen();
  expect(screen.getByText("08 Oct 2026, 17:00 IST · waiting for reason")).toBeOnTheScreen();

  await fireEvent.press(screen.getByText("Explain delay"));
  expect(screen.getByText("Why was the deadline missed?")).toBeOnTheScreen();
  await fireEvent.press(await screen.findByText("Parts late"));
  await fireEvent.press(screen.getByText("Save reason"));

  await waitFor(() => expect(saveTatReason).toHaveBeenCalled());
  expect(jest.mocked(saveTatReason).mock.calls[0]![0]).toEqual({
    TaskId: TASK,
    TatId: 500,
    ReasonId: 2,
    Remarks: null,
  });
  expect(fetchLookups).toHaveBeenCalledWith({ Kind: LOOKUP_KIND.taskBreachReason });
});

it("a closed, explained clock shows the reason and offers nothing", async () => {
  serve({
    clocks: [
      clock({
        DueAt: "2026-10-08 17:00:00",
        BreachedAt: "2026-10-08 17:00:00",
        ClosedAt: "2026-10-08 19:30:00",
        CloseReason: "completed",
        BreachReasonId: 2,
        BreachReason: "Parts late",
        BreachRemarks: "vendor",
      }),
    ],
  });
  await mount();

  expect(await screen.findByText("Missed deadline by 2h 30m")).toBeOnTheScreen();
  expect(screen.getByText("08 Oct 2026, 17:00 IST · Parts late (vendor)")).toBeOnTheScreen();
  // Head chip and the closing timeline entry both say how it ended.
  expect(screen.getAllByText("Done")).toHaveLength(2);
  for (const action of ["Accept task", "Resume", "My part is done", "Explain delay"]) {
    expect(screen.queryByText(action)).toBeNull();
  }
  // Only the (unopened) sheet's submit is left carrying these words.
  expect(screen.getAllByText("Put on hold")).toHaveLength(1);
});

it("an unknown close reason reads Closed", async () => {
  serve({ clocks: [clock({ ClosedAt: "2026-10-08 12:00:00", CloseReason: "mystery" })] });
  await mount();
  expect(await screen.findAllByText("Closed")).toHaveLength(2);
});

it("prefers the open clock when I have an older closed one", async () => {
  serve({
    clocks: [
      clock({ Id: 499, ClosedAt: "2026-10-01 12:00:00", CloseReason: "unassigned" }),
      clock({ Id: 500 }),
    ],
  });
  await mount();
  expect(await screen.findByText("Running")).toBeOnTheScreen();
});

it("lists the clock's history with who did it", async () => {
  // parity: TAT-04 — event kinds print raw until eventText is ported; only the actor is pinned.
  serve({
    clocks: [clock()],
    events: [
      { Id: 1, Kind: "due_changed", OldValue: null, NewValue: null, At: "2026-10-08 10:00:00", ActorName: "Ravi Kumar" },
      { Id: 2, Kind: "resumed", OldValue: null, NewValue: null, At: "2026-10-08 10:30:00", ActorName: null },
    ],
  });
  await mount();
  expect(await screen.findByText("History")).toBeOnTheScreen();
  expect(screen.getByText(/by Ravi Kumar/)).toBeOnTheScreen();
});
