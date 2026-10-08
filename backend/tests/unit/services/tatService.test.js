jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(), settings: jest.fn() }));

const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const tat = require("../../../src/services/tatService");
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");

// Wed 2026-10-07 / Thu 10-08: shift 09:00-18:00 IST, break 13:00-14:00 (480 working min a day).
const ctx = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
const ist = (key, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return at(key, h * 60 + m); };
const WED = (hhmm) => ist("2026-10-07", hhmm);
const THU = (hhmm) => ist("2026-10-08", hhmm);
const clock = (over = {}) => ({
  Id: 1, UserId: 7, AssignedAt: WED("10:00"), AnchorAt: WED("10:00"), TargetMinutes: null, HeldMinutes: 0,
  DueAt: null, BreachedAt: null, StaleKind: "assign", ReopenedAt: null, LastClosedAt: null,
  Priority: "medium", DueDate: null, DueTime: null, TaskTatMinutes: null, PolicyMinutes: 120, warnPct: 80, StaleSeq: 3,
  ...over,
});
const calls = (n) => database.executeStoredProcedure.mock.calls.filter((c) => c[0] === n).map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  cc.settings.mockResolvedValue({ warnPct: 80 });
  cc.load.mockResolvedValue(new Map([[7, { ctx }]]));
});

describe("computeDue", () => {
  const now = WED("10:00");

  it("policy minutes from assignment, warn at 80%", () => {
    const d = tat.computeDue(clock(), ctx, now);
    expect(d.DueAt).toEqual(WED("12:00"));
    expect(d.WarnAt).toEqual(WED("11:36"));
    expect(d).toMatchObject({ AnchorAt: WED("10:00"), TargetMinutes: 120, HeldMinutes: 0 });
  });

  it("task minutes override the policy and skip the break", () => {
    expect(tat.computeDue(clock({ TaskTatMinutes: 240 }), ctx, now).DueAt).toEqual(WED("15:00"));
  });

  it.each([
    ["string", "15:30:00"],
    ["Date (local TIME)", new Date(1970, 0, 1, 15, 30)],
  ])("due date with a due time as %s", (_n, DueTime) => {
    const d = tat.computeDue(clock({ DueDate: new Date(2026, 9, 8), DueTime }), ctx, now);
    expect(d.DueAt).toEqual(THU("15:30"));
    expect(d.TargetMinutes).toBeNull();
  });

  it("due date without a time is the end of that day's shift", () => {
    expect(tat.computeDue(clock({ DueDate: "2026-10-08" }), ctx, now).DueAt).toEqual(THU("18:00"));
  });

  it("held minutes push the due time", () => {
    const d = tat.computeDue(clock({ HeldMinutes: 60 }), ctx, now);
    expect(d.DueAt).toEqual(WED("13:00"));
    expect(d.HeldMinutes).toBe(60);
  });

  it.each([
    ["remaining 200 → 200", WED("10:00"), WED("14:20"), THU("14:20")],
    ["remaining 10 → 60", WED("14:00"), WED("14:10"), THU("11:00")],
    ["past due at close → 60", WED("15:00"), WED("12:00"), THU("11:00")],
  ])("reopen: %s", (_n, LastClosedAt, DueAt, want) => {
    const d = tat.computeDue(clock({ StaleKind: "reopen", ReopenedAt: THU("10:00"), LastClosedAt, DueAt, HeldMinutes: 45 }), ctx, THU("10:00"));
    expect(d.DueAt).toEqual(want);
    expect(d.AnchorAt).toEqual(THU("10:00"));
    expect(d.HeldMinutes).toBe(0);
  });

  it("reopen with no due time left gets the floor", () => {
    const d = tat.computeDue(clock({ StaleKind: "reopen", ReopenedAt: THU("10:00"), LastClosedAt: null, DueAt: null }), ctx, THU("10:00"));
    expect(d.TargetMinutes).toBe(60);
  });

  it("after a reopen the reopen anchor and target stand", () => {
    const d = tat.computeDue(clock({ StaleKind: "hold", ReopenedAt: THU("10:00"), AnchorAt: THU("10:00"), TargetMinutes: 60, HeldMinutes: 30 }), ctx, THU("10:30"));
    expect(d.DueAt).toEqual(THU("11:30"));
    expect(d.TargetMinutes).toBe(60);
  });

  it("a change whose due time has passed gets now + 30 working minutes", () => {
    const d = tat.computeDue(clock({ StaleKind: "change", AssignedAt: WED("09:00"), PolicyMinutes: 60 }), ctx, WED("11:00"));
    expect(d.DueAt).toEqual(WED("11:30"));
  });

  it("an assignment keeps a past due time", () => {
    const d = tat.computeDue(clock({ AssignedAt: WED("09:00"), PolicyMinutes: 60 }), ctx, WED("11:00"));
    expect(d.DueAt).toEqual(WED("10:00"));
  });

  it("a breached clock keeps its past due time", () => {
    const d = tat.computeDue(clock({ StaleKind: "change", AssignedAt: WED("09:00"), PolicyMinutes: 60, BreachedAt: WED("10:00") }), ctx, WED("11:00"));
    expect(d.DueAt).toEqual(WED("10:00"));
  });

  it("a due date already past at assignment warns at the due time", () => {
    const d = tat.computeDue(clock({ DueDate: "2026-10-06" }), ctx, now);
    expect(d.DueAt).toEqual(ist("2026-10-06", "18:00"));
    expect(d.WarnAt).toEqual(d.DueAt);
  });

  it("defaults warnPct to 80", () => {
    expect(tat.computeDue(clock({ warnPct: undefined }), ctx, now).WarnAt).toEqual(WED("11:36"));
  });
});

describe("processPending", () => {
  it("nothing pending: no contexts, no apply", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    expect(await tat.processPending(1, 5)).toEqual({ updated: 0 });
    expect(calls("sp_TatReconcile")[0]).toEqual({ CompId: 1, TaskId: 5 });
    expect(calls("sp_TatApplyDue")).toHaveLength(0);
    expect(cc.load).not.toHaveBeenCalled();
  });

  it("adds ended holds to their clock and applies IST strings with the StaleSeq echo", async () => {
    database.executeStoredProcedure
      .mockResolvedValueOnce({ recordsets: [
        [clock({ StaleKind: "hold" })],
        [
          { HoldId: 9, TatId: 1, UserId: 7, StartedAt: WED("10:00"), EndedAt: WED("11:00") },
          { HoldId: 10, TatId: 99, UserId: 8, StartedAt: WED("10:00"), EndedAt: WED("11:00") }, // clock not stale: waits
        ],
      ] })
      .mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 200, Updated: 1 }]] });

    expect(await tat.processPending(1, null, WED("11:00"))).toEqual({ updated: 1 });
    expect(cc.load).toHaveBeenCalledWith(1, [7], "2026-10-06", "2027-02-04");
    const apply = calls("sp_TatApplyDue")[0];
    expect(apply.CompId).toBe(1);
    expect(JSON.parse(apply.ItemsJson)).toEqual([{
      Id: 1, DueAt: "2026-10-07 13:00:00", WarnAt: "2026-10-07 12:24:00", AnchorAt: "2026-10-07 10:00:00",
      TargetMinutes: 120, HeldMinutes: 60, Kind: "hold", StaleSeq: 3,
    }]);
    expect(JSON.parse(apply.HoldsJson)).toEqual([{ HoldId: 9, HeldMinutes: 60 }]);
  });

  it("an uncomputable clock keeps its hold unapplied (minutes not lost); a failed apply is logged", async () => {
    cc.load.mockResolvedValue(new Map([[8, { ctx: { ...ctx, days: DEFAULT_DAYS.map((d) => ({ d: d.d, on: false })) } }]]));
    database.executeStoredProcedure
      .mockResolvedValueOnce({ recordsets: [
        [clock(), clock({ Id: 2, UserId: 8, StaleKind: "hold" })],
        [
          { HoldId: 9, TatId: 2, UserId: 8, StartedAt: WED("10:00"), EndedAt: WED("11:00") },
          { HoldId: 10, TatId: 1, UserId: 7, StartedAt: WED("10:00"), EndedAt: WED("11:00") },
        ],
      ] })
      .mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 400, ResponseMess: "Invalid item", Updated: 0 }]] });
    await tat.processPending(1, null, WED("11:00"));
    const apply = calls("sp_TatApplyDue")[0];
    expect(JSON.parse(apply.ItemsJson).map((i) => i.Id)).toEqual([1]);
    expect(JSON.parse(apply.HoldsJson)).toEqual([{ HoldId: 10, HeldMinutes: 60 }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("TAT_APPLY"), "Invalid item");
  });

  it("loads far enough for a distant due date, defaults an unknown user's calendar, skips an impossible clock", async () => {
    cc.load.mockResolvedValue(new Map([[8, { ctx: { ...ctx, days: DEFAULT_DAYS.map((d) => ({ d: d.d, on: false })) } }]]));
    database.executeStoredProcedure
      .mockResolvedValueOnce({ recordsets: [[
        clock({ DueDate: "2027-06-01" }),
        clock({ Id: 2, UserId: 8 }),
      ]] })
      .mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 200 }]] });
    expect(await tat.processPending(1, null, WED("10:00"))).toEqual({ updated: 0 });
    expect(cc.load.mock.calls[0][3]).toBe("2027-06-02");
    const items = JSON.parse(calls("sp_TatApplyDue")[0].ItemsJson);
    expect(items.map((i) => i.Id)).toEqual([1]);
    expect(items[0].DueAt).toBe("2027-06-01 18:00:00");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("TAT_COMPUTE"), expect.any(String));
  });
});

describe("afterTaskWrite", () => {
  const req = { user: { UserId: 7, CompId: 1 } };

  it("marks stale on a target change, then reconciles the task", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
    await tat.afterTaskWrite(req, 5, { changed: [{ Field: "Title" }, { Field: "Priority" }] });
    expect(database.executeStoredProcedure.mock.calls.map((c) => c[0])).toEqual(["sp_TatMarkStale", "sp_TatReconcile"]);
    expect(calls("sp_TatMarkStale")[0]).toEqual({ CompId: 1, TaskId: 5, UserId: null, Kind: "change" });
  });

  it("no target change: only reconciles", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
    await tat.afterTaskWrite(req, 5, { changed: [{ Field: "Title" }] });
    await tat.afterTaskWrite(req, null);
    expect(calls("sp_TatMarkStale")).toHaveLength(0);
    expect(calls("sp_TatReconcile")).toEqual([{ CompId: 1, TaskId: 5 }, { CompId: 1, TaskId: null }]);
  });

  it("swallows a failure", async () => {
    database.executeStoredProcedure.mockRejectedValue(new Error("no proc"));
    await expect(tat.afterTaskWrite(req, 5)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("acknowledge / reasonNeeded", () => {
  const req = { user: { UserId: 7, CompId: 1 } };

  it("acknowledges the caller's clock and swallows a failure", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 200 }]] });
    await tat.acknowledge(req, 5);
    expect(calls("sp_TatAcknowledge")[0]).toEqual({ CompId: 1, TaskId: 5, UserId: 7 });
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    await expect(tat.acknowledge(req, 5)).resolves.toBeUndefined();
  });

  it("returns the caller's breached clock owing a reason", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[
      { Id: 3, UserId: 8, BreachedAt: WED("10:00"), BreachReasonId: null },
      { Id: 4, UserId: 7, BreachedAt: null },
      { Id: 5, UserId: 7, BreachedAt: WED("10:00"), BreachReasonId: null, Verdict: null },
    ]] });
    expect(await tat.reasonNeeded(req, 5)).toBe(5);
  });

  it("null when none owed or on failure", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 5, UserId: 7, BreachedAt: WED("10:00"), BreachReasonId: 2 }]] });
    expect(await tat.reasonNeeded(req, 5)).toBeNull();
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    expect(await tat.reasonNeeded(req, 5)).toBeNull();
  });
});
