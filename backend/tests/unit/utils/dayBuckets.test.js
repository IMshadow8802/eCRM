const { describeTask, countTasks, rankPeople } = require("../../../src/utils/dayBuckets");
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");

const ctx = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
const key = "2026-10-12"; // a Monday
const now = at(key, 12 * 60); // 12:00 IST
const base = { TaskId: 1, Title: "T", AssignedAt: at(key, 9 * 60), IsCompleted: false, StepsTotal: 2, StepsDone: 0 };
const d = (row, o = {}) => describeTask({ ...base, ...row }, { key, now, ctx, live: true, ...o });

describe("describeTask", () => {
  it("given today, not started, no timer", () => {
    const r = d({});
    expect(r.flags).toMatchObject({ given: true, open: true, working: false, notStarted: true, overdue: false });
    expect(r.timer).toBe("none");
  });
  it("working when accepted or one step ticked", () => {
    expect(d({ StepsDone: 1 }).flags.working).toBe(true);
    expect(d({ TatId: 5, DueAt: at(key, 16 * 60), AcknowledgedAt: now }).flags.working).toBe(true);
  });
  it("clock overdue = breached, with negative working time left", () => {
    const r = d({ TatId: 5, DueAt: at(key, 10 * 60), BreachedAt: at(key, 10 * 60) });
    expect(r.flags.overdue).toBe(true);
    expect(r.timeLeftMin).toBeLessThan(0);
  });
  it("no clock: overdue when DueDate+DueTime passed", () => {
    expect(d({ DueDate: new Date(at(key, 0)), DueTime: "11:00" }).flags.overdue).toBe(true);
    expect(d({ DueDate: new Date(at(key, 0)), DueTime: "15:00" }).flags).toMatchObject({ overdue: false, dueToday: true });
  });
  it("no clock and no time: due at end of shift", () => {
    expect(d({ DueDate: new Date(at(key, 0)) }).flags).toMatchObject({ overdue: false, dueToday: true });
  });
  it("no time on a day off: due 23:59 that day, not the previous shift end", () => {
    const sun = "2026-10-11";
    const r = d({ DueDate: new Date(at(sun, 0)) }, { key: sun, now: at(sun, 10 * 60) });
    expect(r.due).toEqual(at(sun, 23 * 60 + 59));
    expect(r.flags).toMatchObject({ overdue: false, dueToday: true });
  });
  it("close to deadline = warned, not breached", () => {
    expect(d({ TatId: 5, DueAt: at(key, 13 * 60), WarnedAt: now }).flags.atRisk).toBe(true);
  });
  it("on hold shows when the open clock has a hold", () => {
    expect(d({ TatId: 5, DueAt: at(key, 18 * 60), HeldSince: now, HoldReason: "Client" }).flags.onHold).toBe(true);
  });
  it("done today, late when breached", () => {
    const r = d({ IsCompleted: true, CompletedDate: now, TatId: 5, ClosedAt: now, BreachedAt: at(key, 10 * 60) });
    expect(r.flags).toMatchObject({ open: false, done: true, doneLate: true, overdue: false });
  });
  it("my part done counts as done and not open", () => {
    expect(d({ TatId: 5, ClosedAt: now, CloseReason: "my_part_done" }).flags).toMatchObject({ open: false, done: true });
  });
  it("reason owed vs to rule", () => {
    expect(d({ TatId: 5, BreachedAt: now, BreachReasonId: null }).flags.reasonOwed).toBe(true);
    expect(d({ TatId: 5, BreachedAt: now, BreachReasonId: 3, ViewerCanRule: true }).flags.toRule).toBe(true);
    expect(d({ TatId: 5, BreachedAt: now, BreachReasonId: 3, ViewerCanRule: false }).flags.toRule).toBe(false);
  });
  it("past day: live flags off, given/done kept", () => {
    const r = d({ IsCompleted: true, CompletedDate: now }, { live: false });
    expect(r.flags).toMatchObject({ given: true, done: true, open: false, overdue: false, working: false });
    expect(r.timeLeftMin).toBeNull();
  });
});

describe("countTasks", () => {
  it("zeros for nobody, nulls for live keys on a past day", () => {
    expect(countTasks([], { live: true })).toMatchObject({ open: 0, overdue: 0, done: 0 });
    expect(countTasks([], { live: false })).toMatchObject({ open: null, overdue: null, done: 0, given: 0 });
  });
  it("sums flags", () => {
    const rows = [d({ StepsDone: 1 }), d({ DueDate: new Date(at(key, 0)), DueTime: "11:00" })];
    expect(countTasks(rows, { live: true })).toMatchObject({ open: 2, working: 1, overdue: 1, given: 2 });
  });
});

describe("rankPeople", () => {
  const p = (FullName, counts, status = "online") => ({ FullName, counts, status: status === "late" ? { code: "online", late: "Late by 5 min" } : { code: status } });
  it("overdue, then to-rule, then not signed in, then late, then at risk, then name", () => {
    const out = rankPeople([
      p("Zed", { overdue: 0, toRule: 0, atRisk: 0 }),
      p("Amy", { overdue: 0, toRule: 0, atRisk: 2 }),
      p("Bob", { overdue: 0, toRule: 0, atRisk: 0 }, "late"),
      p("Cat", { overdue: 0, toRule: 0, atRisk: 0 }, "not_signed_in"),
      p("Dan", { overdue: 0, toRule: 1, atRisk: 0 }),
      p("Eve", { overdue: 3, toRule: 0, atRisk: 0 }),
    ]).map((x) => x.FullName);
    expect(out).toEqual(["Eve", "Dan", "Cat", "Bob", "Amy", "Zed"]);
  });
  it("null counts (past day) rank by presence then name", () => {
    expect(rankPeople([p("B", { overdue: null }), p("A", { overdue: null })]).map((x) => x.FullName)).toEqual(["A", "B"]);
  });
});
