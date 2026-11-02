import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

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
import { flat } from "../../test/style";
import { colors } from "../../theme";
import { deadlineFigures, TatTab } from "./TatTab";

jest.useFakeTimers();

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
  // Thu 8 Oct 2026, 12:00 IST: the fixture clock (09:00 → 17:00) is running.
  jest.setSystemTime(new Date("2026-10-08T12:00:00+05:30"));
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

it("a failed load shows the error card with a retry", async () => {
  jest.mocked(fetchTaskTat).mockRejectedValue(new Error("boom"));
  await mount();
  expect(await screen.findByText("Try again")).toBeOnTheScreen();
});

describe("09 · the deadline hero", () => {
  it("a missed clock: Target 8 h 00 m, Over by in the warm figure, the split bar, Explain delay", async () => {
    // Due 17:00, now 19:00 IST: two hours over a 480-minute target.
    jest.setSystemTime(new Date("2026-10-08T19:00:00+05:30"));
    serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" })] });
    await renderWithProviders(<TatTab taskId={TASK} userId={ME} tatMinutes={480} />);
    expect(await screen.findByText("Your clock")).toBeOnTheScreen();
    expect(screen.getAllByText("Missed deadline").length).toBeGreaterThan(0);
    expect(screen.getByText("Target")).toBeOnTheScreen();
    expect(screen.getByText("8 h 00 m")).toBeOnTheScreen();
    expect(screen.getByText("Over by")).toBeOnTheScreen();
    expect(flat(screen.getByText("2 h 00 m")).color).toBe(colors.onBrandWarn);
    expect(flat(screen.getByTestId("split-used")).flex).toBeCloseTo(0.8);
    expect(flat(screen.getByTestId("split-overrun")).flex).toBeCloseTo(0.2);
    expect(screen.getByText("Working time on your shift")).toBeOnTheScreen();
    expect(screen.getByText("Due Thu, 8 Oct · 5:00 pm")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Explain delay" })).toBeOnTheScreen();
  });

  it("a running clock: Time left, no overrun, a butter Due in, no Explain", async () => {
    jest.setSystemTime(new Date("2026-10-08T15:00:00+05:30"));
    serve({ clocks: [clock()] });
    await renderWithProviders(<TatTab taskId={TASK} userId={ME} tatMinutes={480} />);
    expect(await screen.findByText("Time left")).toBeOnTheScreen();
    expect(screen.getByText("2 h 00 m")).toBeOnTheScreen();
    expect(screen.getByText("Due in 2 h")).toBeOnTheScreen();
    expect(flat(screen.getByTestId("split-used")).flex).toBeCloseTo(0.75);
    expect(screen.queryByTestId("split-overrun")).toBeNull();
    expect(screen.queryByRole("button", { name: "Explain delay" })).toBeNull();
  });

  it("without TatMinutes the target is the clock's own span", () => {
    const f = deadlineFigures(clock(), null, new Date("2026-10-08T13:00:00+05:30").getTime());
    expect(f.target).toBe(8 * 3_600_000);
    expect(f.left).toBe(4 * 3_600_000);
    expect(f.used).toBeCloseTo(0.5);
    expect(deadlineFigures(clock({ DueAt: null }), null, 0)).toMatchObject({ target: null, used: 0, overrun: 0 });
  });

  it("closed on time reads On time, with what was spare", async () => {
    serve({ clocks: [clock({ ClosedAt: "2026-10-08 16:00:00", CloseReason: "completed" })] });
    await mount();
    expect(await screen.findByText("On time")).toBeOnTheScreen();
    expect(screen.getByText("Spare")).toBeOnTheScreen();
  });
});

describe("timeline (Started · Held · Due · Breached)", () => {
  it("in that order, in E's words", async () => {
    serve({
      clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" })],
      holds: [hold({ EndedAt: "2026-10-08 15:10:00" })],
    });
    await renderWithProviders(<TatTab taskId={TASK} userId={ME} tatMinutes={480} />);
    await screen.findByText("Started");
    const order = ["Started", "Held", "Due", "Breached"].map((t) => screen.getByText(t));
    const all = screen.getAllByText(/./);
    expect(order.map((n) => all.indexOf(n))).toEqual([...order.map((n) => all.indexOf(n))].sort((a, b) => a - b));
    expect(screen.getByText("Assigned to Asha Rao")).toBeOnTheScreen();
    expect(screen.getByText("Waiting on client · 4 h 10 m added back")).toBeOnTheScreen();
    expect(screen.getByText("8 h 00 m working time from start")).toBeOnTheScreen();
    expect(screen.getByText("Stays on record, even if reopened · waiting for reason")).toBeOnTheScreen();
    expect(screen.getByText("Thu, 8 Oct · 9:00 am")).toBeOnTheScreen();
  });

  it("a closed, explained clock shows the reason and offers nothing", async () => {
    serve({
      clocks: [clock({
        BreachedAt: "2026-10-08 17:00:00", ClosedAt: "2026-10-08 19:30:00", CloseReason: "completed",
        BreachReasonId: 2, BreachReason: "Parts late", BreachRemarks: "vendor", ReasonAt: "2026-10-08 19:45:00",
      })],
    });
    await mount();
    expect(await screen.findByText("Reason: Parts late (vendor)")).toBeOnTheScreen();
    expect(screen.getByText("Over by")).toBeOnTheScreen();
    expect(screen.getByText("2 h 30 m")).toBeOnTheScreen();
    expect(screen.getByText("Done")).toBeOnTheScreen();
    for (const action of ["Accept task", "Resume", "My part is done", "Explain delay"]) {
      expect(screen.queryByRole("button", { name: action })).toBeNull();
    }
  });

  it("an unknown close reason reads Closed", async () => {
    serve({ clocks: [clock({ ClosedAt: "2026-10-08 12:00:00", CloseReason: "mystery" })] });
    await mount();
    expect(await screen.findAllByText("Closed")).toHaveLength(2);
  });

  it("shows the manager's decision on my clock", async () => {
    serve({
      clocks: [clock({
        BreachedAt: "2026-10-08 17:00:00", BreachReasonId: 2, BreachReason: "Parts late", ReasonAt: "2026-10-08 18:00:00",
        Verdict: "excused", VerdictByName: "Meera Shah", VerdictRemarks: "vendor strike", VerdictAt: "2026-10-09 10:00:00",
      })],
    });
    await mount();
    expect(await screen.findByText("Delay accepted by Meera Shah (vendor strike)")).toBeOnTheScreen();
    expect(screen.getByText("Fri, 9 Oct · 10:00 am")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Explain delay" })).toBeNull();
  });

  it("a system rejection with no remarks still reads", async () => {
    serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00", Verdict: "not_excused" })] });
    await mount();
    expect(await screen.findByText("Delay rejected by the system")).toBeOnTheScreen();
  });

  it("the clock's history in words, with who did it", async () => {
    serve({
      clocks: [clock()],
      events: [
        { Id: 1, Kind: "recompute", OldValue: "2026-10-08 17:00:00", NewValue: "2026-10-09 11:00:00", At: "2026-10-08 10:00:00", ActorName: "Ravi Kumar" },
        { Id: 2, Kind: "my_part_done", OldValue: null, NewValue: null, At: "2026-10-08 10:30:00", ActorName: null },
      ],
    });
    await mount();
    expect(await screen.findByText("Clock history")).toBeOnTheScreen();
    expect(screen.getByText("Deadline changed Thu 17:00 → 11:00 IST by Ravi Kumar")).toBeOnTheScreen();
    expect(screen.getByText("Marked their part done")).toBeOnTheScreen();
    expect(screen.getByText("08 Oct 2026, 10:30 IST")).toBeOnTheScreen();
  });
});

describe("the hold card", () => {
  it("my own manual hold: the card, On hold, and Resume", async () => {
    serve({ clocks: [clock()], holds: [hold({ Remarks: "call back" })] });
    await mount();
    const card = await screen.findByTestId("hold-card");
    expect(within(card).getByText("Reason given for the hold")).toBeOnTheScreen();
    expect(within(card).getByText("Waiting on client (call back)")).toBeOnTheScreen();
    expect(within(card).getByText("Thu, 8 Oct")).toBeOnTheScreen();
    expect(screen.getByText("On hold")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(releaseMine).toHaveBeenCalledWith(TASK));
  });

  it("a dependency hold cannot be resumed by hand", async () => {
    serve({ clocks: [clock()], holds: [hold({ Kind: "blocked", StartedBy: null, Reason: null })] });
    await mount();
    expect(await screen.findByText("Blocked by a dependency")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("someone else's manual hold is not mine to resume", async () => {
    serve({ clocks: [clock()], holds: [hold({ StartedBy: 7 })] });
    await mount();
    await screen.findByTestId("hold-card");
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("no hold, no card", async () => {
    serve({ clocks: [clock()] });
    await mount();
    await screen.findByText("Your clock");
    expect(screen.queryByTestId("hold-card")).toBeNull();
  });
});

describe("own-clock actions", () => {
  it("a fresh clock can be accepted; one open clock means no 'my part'", async () => {
    serve({ clocks: [clock()] });
    await mount();
    await fireEvent.press(await screen.findByRole("button", { name: "Accept task" }));
    await waitFor(() => expect(acknowledgeTat).toHaveBeenCalledWith(TASK));
    expect(screen.queryByRole("button", { name: "My part is done" })).toBeNull();
  });

  it("an accepted clock no longer asks to be accepted", async () => {
    serve({ clocks: [clock({ AcknowledgedAt: "2026-10-08 09:10:00" })] });
    await mount();
    await screen.findByText("Your clock");
    expect(screen.queryByRole("button", { name: "Accept task" })).toBeNull();
  });

  it("with other assignees still working, I can finish my part", async () => {
    serve({ clocks: [clock(), clock({ Id: 501, UserId: 7 })] });
    await mount();
    await fireEvent.press(await screen.findByRole("button", { name: "My part is done" }));
    await waitFor(() => expect(myPartDone).toHaveBeenCalledWith(TASK));
  });

  it("prefers the open clock when I have an older closed one", async () => {
    serve({ clocks: [clock({ Id: 499, ClosedAt: "2026-10-01 12:00:00", CloseReason: "unassigned" }), clock({ Id: 500 })] });
    await mount();
    expect(await screen.findByRole("button", { name: "Accept task" })).toBeOnTheScreen();
  });

  it("putting my part on hold sends the reason and remarks", async () => {
    serve({ clocks: [clock()] });
    await mount();
    await fireEvent.press((await screen.findAllByRole("button", { name: "Put on hold" }))[0]!);
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
    await fireEvent.press((await screen.findAllByRole("button", { name: "Put on hold" }))[0]!);
    await fireEvent.press(await screen.findByText("Waiting on client"));
    await fireEvent.press(screen.getAllByText("Put on hold").at(-1)!);
    expect(await screen.findByText("This clock is already on hold")).toBeOnTheScreen();
  });

  it("a refused quick action shows the server's reason", async () => {
    jest.mocked(acknowledgeTat).mockRejectedValue(serverError(403, "Not your clock"));
    serve({ clocks: [clock()] });
    await mount();
    await fireEvent.press(await screen.findByRole("button", { name: "Accept task" }));
    expect(await screen.findByText("Not your clock")).toBeOnTheScreen();
  });
});

describe("Explain delay", () => {
  it("asks for a reason and sends it against the clock shown", async () => {
    serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" })] });
    await mount();
    await fireEvent.press(await screen.findByRole("button", { name: "Explain delay" }));
    expect(screen.getByText("Why was the deadline missed?")).toBeOnTheScreen();
    await fireEvent.press(await screen.findByText("Parts late"));
    await fireEvent.press(screen.getByText("Save reason"));
    await waitFor(() => expect(saveTatReason).toHaveBeenCalled());
    expect(jest.mocked(saveTatReason).mock.calls[0]![0]).toEqual({ TaskId: TASK, TatId: 500, ReasonId: 2, Remarks: null });
    expect(fetchLookups).toHaveBeenCalledWith({ Kind: LOOKUP_KIND.taskBreachReason });
  });

  it("a reason of Other needs remarks", async () => {
    serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" })] });
    await mount();
    await fireEvent.press(await screen.findByRole("button", { name: "Explain delay" }));
    await fireEvent.press(await screen.findByText("Other"));
    const save = () => screen.getByRole("button", { name: "Save reason" });
    expect(save()).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText("Remarks (needed for Other)"), "Power cut");
    await fireEvent.press(save());
    await waitFor(() => expect(saveTatReason).toHaveBeenCalled());
    expect(jest.mocked(saveTatReason).mock.calls[0]![0]).toEqual({ TaskId: TASK, TatId: 500, ReasonId: 3, Remarks: "Power cut" });
  });

  it("opens by itself once when the screen asks for a clock", async () => {
    serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" })] });
    await renderWithProviders(<TatTab taskId={TASK} userId={ME} explainTatId={500} />);
    expect(await screen.findByText("Why was the deadline missed?")).toBeOnTheScreen();
  });
});

describe("others' clocks", () => {
  const theirs = (patch: Partial<TaskTatClock> = {}) =>
    clock({ Id: 501, UserId: 7, FullName: "Ravi Kumar", BreachedAt: "2026-10-08 17:00:00", BreachReasonId: 2, BreachReason: "Parts late", ...patch });

  it("are rows below, read-only when I have no clock of my own", async () => {
    serve({ clocks: [clock({ UserId: 7, FullName: "Ravi Kumar" })] });
    await mount();
    expect(await screen.findByText("Ravi Kumar")).toBeOnTheScreen();
    expect(screen.getByText("Others on this task")).toBeOnTheScreen();
    expect(screen.queryByText("Your clock")).toBeNull();
    for (const action of ["Accept task", "My part is done", "Explain delay", "Accept delay", "Reject delay"]) {
      expect(screen.queryByRole("button", { name: action })).toBeNull();
    }
  });

  it("offer Accept/Reject only when the server says I can judge", async () => {
    serve({ clocks: [clock({ BreachedAt: "2026-10-08 17:00:00" }), theirs({ CanJudge: false })] });
    await mount();
    expect(await screen.findByText("Reason: Parts late")).toBeOnTheScreen();
    expect(screen.queryByText("Accept delay")).toBeNull();
  });

  it("nothing to rule once a verdict is in", async () => {
    serve({ clocks: [theirs({ CanJudge: true, Verdict: "excused" })] });
    await mount();
    expect(await screen.findByText("Reason: Parts late · Delay accepted")).toBeOnTheScreen();
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
    expect(jest.mocked(saveVerdict).mock.calls[0]![0]).toEqual({ TaskId: TASK, TatId: 501, Verdict: "excused", Remarks: "Vendor strike" });
  });

  it("rejecting a delay may go without remarks", async () => {
    serve({ clocks: [theirs({ CanJudge: true })] });
    await mount();
    await fireEvent.press(await screen.findByText("Reject delay"));
    await fireEvent.press(screen.getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(saveVerdict).toHaveBeenCalled());
    expect(jest.mocked(saveVerdict).mock.calls[0]![0]).toEqual({ TaskId: TASK, TatId: 501, Verdict: "not_excused", Remarks: null });
  });

  it("a refused verdict keeps the sheet open with the server's reason", async () => {
    jest.mocked(saveVerdict).mockRejectedValue(serverError(403, "Only their manager can decide"));
    serve({ clocks: [theirs({ CanJudge: true })] });
    await mount();
    await fireEvent.press(await screen.findByText("Reject delay"));
    await fireEvent.press(screen.getByRole("button", { name: "Save decision" }));
    expect(await screen.findByText("Only their manager can decide")).toBeOnTheScreen();
  });

  it("a held or closed colleague reads so", async () => {
    serve({
      clocks: [clock({ UserId: 7, FullName: "Ravi Kumar" }), clock({ Id: 502, UserId: 8, FullName: "Om Pal", ClosedAt: "2026-10-08 12:00:00", CloseReason: "unassigned" })],
      holds: [hold({ TatId: 500, UserId: 7 })],
    });
    await mount();
    expect(await screen.findByText("On hold")).toBeOnTheScreen();
    expect(screen.getByText("Unassigned")).toBeOnTheScreen();
  });
});
