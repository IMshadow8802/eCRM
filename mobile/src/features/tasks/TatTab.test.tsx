import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import {
  acknowledgeTat,
  fetchTaskTat,
  holdMine,
  myPartDone,
  releaseMine,
  saveTatReason,
  saveVerdict,
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
  VerdictAt: null,
  CanJudge: false,
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

const lookup = (Id: number, Value: string, Kind: string, Code: string | null = null): Lookup => ({
  Id,
  CompId: 1,
  Kind,
  Value,
  SortOrder: Id,
  IsActive: true,
  Code,
});

const serve = (tat: Partial<TaskTat>) =>
  jest.mocked(fetchTaskTat).mockResolvedValue({ clocks: [], holds: [], events: [], ...tat });

const mount = () => renderWithProviders(<TatTab taskId={TASK} userId={ME} />);

beforeEach(() => {
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) =>
    Kind === LOOKUP_KIND.taskHoldReason
      ? [lookup(1, "Waiting on client", Kind)]
      : [lookup(2, "Parts late", Kind), lookup(3, "Other", Kind, "other")],
  );
  for (const fn of [acknowledgeTat, myPartDone, releaseMine, holdMine, saveTatReason, saveVerdict]) {
    jest.mocked(fn).mockResolvedValue(envelope(null));
  }
});

it("with no clock on the task, says there is no deadline", async () => {
  serve({ clocks: [] });
  await mount();
  expect(await screen.findByText("No deadline on this task")).toBeOnTheScreen();
  expect(fetchTaskTat).toHaveBeenCalledWith(TASK);
});

it("lists other assignees' clocks read-only when I have none", async () => {
  // parity: TAT-05 — a manager on a team task sees everyone's clock.
  serve({ clocks: [clock({ UserId: 7, FullName: "Ravi Kumar", AcknowledgedAt: "2026-10-08 09:10:00" })] });
  await mount();
  expect(await screen.findByText("Ravi Kumar")).toBeOnTheScreen();
  expect(screen.getByText("Running")).toBeOnTheScreen();
  expect(screen.getByText("Accepted")).toBeOnTheScreen();
  for (const action of ["Accept task", "My part is done", "Explain delay", "Accept delay", "Reject delay"]) {
    expect(screen.queryByText(action)).toBeNull();
  }
  // Only the (unopened) sheet's submit carries these words.
  expect(screen.getAllByText("Put on hold")).toHaveLength(1);
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
  serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" })] });
  await mount();

  expect(await screen.findByText(/^Missed deadline by /)).toBeOnTheScreen();
  // parity: TAT-01 — an open, breached clock is not "Running".
  expect(screen.getByText("Missed deadline")).toBeOnTheScreen();
  expect(screen.queryByText("Running")).toBeNull();
  expect(screen.getByText("08 Oct 2026, 17:00 IST · waiting for reason")).toBeOnTheScreen();

  await fireEvent.press(screen.getByText("Explain delay"));
  expect(screen.getByText("Why was the deadline missed?")).toBeOnTheScreen();
  await fireEvent.press(await screen.findByText("Parts late"));
  await fireEvent.press(screen.getByText("Save reason"));

  await waitFor(() => expect(saveTatReason).toHaveBeenCalled());
  // "Explain delay" names no clock: the reason falls back to the clock shown (never TatId 0).
  expect(jest.mocked(saveTatReason).mock.calls[0]![0]).toEqual({
    TaskId: TASK,
    TatId: 500,
    ReasonId: 2,
    Remarks: null,
  });
  expect(fetchLookups).toHaveBeenCalledWith({ Kind: LOOKUP_KIND.taskBreachReason });
});

it("a breach reason of Other needs remarks", async () => {
  // parity: TAT-02 — web BreachReasonDialog requires remarks when Code is "other".
  serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" })] });
  await mount();
  await fireEvent.press(await screen.findByText("Explain delay"));
  await fireEvent.press(await screen.findByText("Other"));
  const save = () => screen.getByRole("button", { name: "Save reason" });
  expect(save()).toBeDisabled();
  await fireEvent.press(save());
  expect(saveTatReason).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByPlaceholderText("Remarks (needed for Other)"), "Power cut");
  await fireEvent.press(save());
  await waitFor(() => expect(saveTatReason).toHaveBeenCalled());
  expect(jest.mocked(saveTatReason).mock.calls[0]![0]).toEqual({ TaskId: TASK, TatId: 500, ReasonId: 3, Remarks: "Power cut" });
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
        ReasonAt: "2026-10-08 19:45:00",
      }),
    ],
  });
  await mount();

  expect(await screen.findByText("Missed deadline by 2h 30m")).toBeOnTheScreen();
  // parity: TAT-03 — the reason is its own timeline entry, stamped when given.
  expect(screen.getByText("Reason: Parts late (vendor)")).toBeOnTheScreen();
  expect(screen.getByText("08 Oct 2026, 19:45 IST")).toBeOnTheScreen();
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

it("lists the clock's history in words, with who did it", async () => {
  // parity: TAT-04 — eventText, never the raw Kind.
  serve({
    clocks: [clock()],
    events: [
      { Id: 1, Kind: "recompute", OldValue: "2026-10-08 17:00:00", NewValue: "2026-10-09 11:00:00", At: "2026-10-08 10:00:00", ActorName: "Ravi Kumar" },
      { Id: 2, Kind: "my_part_done", OldValue: null, NewValue: null, At: "2026-10-08 10:30:00", ActorName: null },
    ],
  });
  await mount();
  expect(await screen.findByText("History")).toBeOnTheScreen();
  expect(
    screen.getByText("08 Oct 2026, 10:00 IST · Deadline changed Thu 17:00 → 11:00 IST by Ravi Kumar"),
  ).toBeOnTheScreen();
  expect(screen.getByText("08 Oct 2026, 10:30 IST · Marked their part done")).toBeOnTheScreen();
  expect(screen.queryByText(/my_part_done/)).toBeNull();
});

it("shows the manager's decision on my clock", async () => {
  // parity: TAT-03 — the person sees the outcome.
  serve({
    clocks: [
      clock({
        BreachedAt: "2026-10-08 17:00:00",
        BreachReasonId: 2,
        BreachReason: "Parts late",
        ReasonAt: "2026-10-08 18:00:00",
        Verdict: "excused",
        VerdictByName: "Meera Shah",
        VerdictRemarks: "vendor strike",
        VerdictAt: "2026-10-09 10:00:00",
      }),
    ],
  });
  await mount();
  expect(await screen.findByText("Delay accepted by Meera Shah (vendor strike)")).toBeOnTheScreen();
  expect(screen.getByText("09 Oct 2026, 10:00 IST")).toBeOnTheScreen();
  expect(screen.getByText("Reason: Parts late")).toBeOnTheScreen();
  expect(screen.queryByText("Explain delay")).toBeNull();
});

it("a system decision with no remarks still reads", async () => {
  serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00", Verdict: "not_excused" })] });
  await mount();
  expect(await screen.findByText("Delay rejected by the system")).toBeOnTheScreen();
});

describe("judging someone else's missed deadline", () => {
  const theirs = (patch: Partial<TaskTatClock> = {}) =>
    clock({
      Id: 501,
      UserId: 7,
      FullName: "Ravi Kumar",
      BreachedAt: "2026-10-08 17:00:00",
      BreachReasonId: 2,
      BreachReason: "Parts late",
      ...patch,
    });

  it("offers Accept/Reject only when the server says I can judge", async () => {
    // parity: TAT-05 — CanJudge decides; the server never sets it on my own clock.
    serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" }), theirs({ CanJudge: false })] });
    await mount();
    await screen.findByText("Ravi Kumar");
    expect(screen.queryByText("Accept delay")).toBeNull();
    expect(screen.queryByText("Reject delay")).toBeNull();
  });

  it("nothing to rule once a verdict is in", async () => {
    serve({ clocks: [theirs({ CanJudge: true, Verdict: "excused" })] });
    await mount();
    await screen.findByText("Ravi Kumar");
    expect(screen.queryByText("Accept delay")).toBeNull();
  });

  it("accepting a delay needs remarks and sends the verdict", async () => {
    serve({ clocks: [theirs({ CanJudge: true })] });
    await mount();
    await fireEvent.press(await screen.findByText("Accept delay"));
    expect(screen.getByText("Accept the delay")).toBeOnTheScreen();
    const save = () => screen.getByRole("button", { name: "Save decision" });
    expect(save()).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText("Remarks (needed to accept)"), "Vendor strike");
    await fireEvent.press(save());
    await waitFor(() => expect(saveVerdict).toHaveBeenCalled());
    expect(jest.mocked(saveVerdict).mock.calls[0]![0]).toEqual({
      TaskId: TASK,
      TatId: 501,
      Verdict: "excused",
      Remarks: "Vendor strike",
    });
  });

  it("rejecting a delay may go without remarks", async () => {
    serve({ clocks: [theirs({ CanJudge: true })] });
    await mount();
    await fireEvent.press(await screen.findByText("Reject delay"));
    expect(screen.getByText("Reject the delay")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(saveVerdict).toHaveBeenCalled());
    expect(jest.mocked(saveVerdict).mock.calls[0]![0]).toEqual({
      TaskId: TASK,
      TatId: 501,
      Verdict: "not_excused",
      Remarks: null,
    });
  });

  it("a refused verdict keeps the sheet open with the server's reason", async () => {
    jest.mocked(saveVerdict).mockRejectedValue(serverError(403, "Only their manager can decide"));
    serve({ clocks: [theirs({ CanJudge: true })] });
    await mount();
    await fireEvent.press(await screen.findByText("Reject delay"));
    await fireEvent.press(screen.getByRole("button", { name: "Save decision" }));
    expect(await screen.findByText("Only their manager can decide")).toBeOnTheScreen();
  });
});
