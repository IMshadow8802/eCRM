const {
  parseSalesArgs, previousRange, rangeDays, sumRows, SUM_KEYS, METRICS, MAX_ROWS, PREVIOUS_MAX_DAYS,
} = require("../../../src/utils/salesReport");
const NOW = new Date(2026, 10, 18, 9, 40); // 18 Nov 2026, local

describe("parseSalesArgs (summary)", () => {
  it("defaults to yesterday and GroupBy team", () => {
    expect(parseSalesArgs({}, { today: NOW })).toEqual({ args: {
      FromDate: "2026-11-17", ToDate: "2026-11-17", GroupBy: "team",
      NodeId: null, BranchId: null, SourceId: null, ProductId: null } });
  });
  it("person with no dates means any time (both null)", () => {
    const { args } = parseSalesArgs({ GroupBy: "person" }, { today: NOW });
    expect([args.FromDate, args.ToDate]).toEqual([null, null]);
  });
  it("person with dates keeps them", () => {
    const { args } = parseSalesArgs({ GroupBy: "person", FromDate: "2026-11-01", ToDate: "2026-11-18" }, { today: NOW });
    expect([args.FromDate, args.ToDate]).toEqual(["2026-11-01", "2026-11-18"]);
  });
  it("yesterday across a month boundary, from local parts", () => {
    const { args } = parseSalesArgs({}, { today: new Date(2026, 11, 1, 0, 30) });
    expect([args.FromDate, args.ToDate]).toEqual(["2026-11-30", "2026-11-30"]);
  });
  it("works with no body at all", () => {
    expect(parseSalesArgs(undefined).args.GroupBy).toBe("team");
  });
  it.each([
    [{ GroupBy: "owner" }, /GroupBy must be one of/],
    [{ FromDate: "2026-11-01" }, /FromDate and ToDate go together/],
    [{ ToDate: "2026-11-01" }, /FromDate and ToDate go together/],
    [{ FromDate: "2026-02-30", ToDate: "2026-03-01" }, /YYYY-MM-DD/],
    [{ FromDate: "2026-11-02", ToDate: "2026-11-01" }, /must not be after/],
    [{ FromDate: "2024-01-01", ToDate: "2026-11-01" }, /731 days or less/],
  ])("400s %j", (body, msg) => expect(parseSalesArgs(body, { today: NOW }).error).toMatch(msg));
  it("keeps positive integer ids and nulls the rest", () => {
    const { args } = parseSalesArgs({ NodeId: "12", BranchId: 0, SourceId: "x", ProductId: 3 }, { today: NOW });
    expect(args).toMatchObject({ NodeId: 12, BranchId: null, SourceId: null, ProductId: 3 });
  });
});

describe("parseSalesArgs (rows)", () => {
  const ok = { GroupBy: "team", Metric: "fu_missed", Shape: "events", PersonId: 17, Rollup: true };
  it("passes a valid drill", () => {
    const { args } = parseSalesArgs(ok, { rows: true, today: NOW });
    expect(args).toMatchObject({
      Metric: "fu_missed", Shape: "events", PersonId: 17, Rollup: 1, Unassigned: 0,
      GroupKey: null, GroupKeyIsNull: 0, State: null, AgeBucket: null, Flag: null });
    expect(args).not.toHaveProperty("NodeId");
  });
  it("defaults Shape to events and reads the flags", () => {
    const { args } = parseSalesArgs(
      { GroupBy: "source", Metric: "new", GroupKeyIsNull: "1", Unassigned: "true", Rollup: "0",
        GroupKey: "5", State: "untouched", AgeBucket: "90p", Flag: "stale" },
      { rows: true, today: NOW });
    expect(args).toMatchObject({ Shape: "events", Rollup: 0, Unassigned: 1, GroupKeyIsNull: 1,
      GroupKey: 5, State: "untouched", AgeBucket: "90p", Flag: "stale", PersonId: null });
  });
  it("passes a lead-shaped drill for one person", () => {
    const { args } = parseSalesArgs({ GroupBy: "team", Metric: "all", Shape: "leads", PersonId: "9" }, { rows: true, today: NOW });
    expect(args).toMatchObject({ Metric: "all", Shape: "leads", PersonId: 9, Rollup: 0 });
  });
  it("keeps date errors on the rows path", () => {
    expect(parseSalesArgs({ ...ok, FromDate: "2026-11-01" }, { rows: true, today: NOW }).error)
      .toMatch(/go together/);
  });
  it.each([
    [{ ...ok, Metric: "calls" }, /Metric must be one of/],
    [{ ...ok, Metric: undefined }, /Metric must be one of/],
    [{ ...ok, Shape: "grid" }, /Shape must be one of/],
    [{ ...ok, State: "closed" }, /State must be one of/],
    [{ ...ok, AgeBucket: "old" }, /AgeBucket must be one of/],
    [{ ...ok, Flag: "late" }, /Flag must be one of/],
    [{ ...ok, Shape: "leads" }, /leads needs Metric all and a PersonId/],
    [{ ...ok, Metric: "all" }, /leads needs Metric all and a PersonId/],
    [{ GroupBy: "team", Metric: "all", Shape: "leads" }, /leads needs Metric all and a PersonId/],
    [{ GroupBy: "team", Metric: "all", Shape: "leads", PersonId: 4, Rollup: 1 }, /leads needs Metric all and a PersonId/],
  ])("400s %j", (body, msg) => expect(parseSalesArgs(body, { rows: true, today: NOW }).error).toMatch(msg));
});

describe("previousRange", () => {
  it.each([
    ["2026-11-17", "2026-11-17", "2026-11-16", "2026-11-16"],
    ["2026-11-16", "2026-11-22", "2026-11-09", "2026-11-15"],
    ["2026-11-01", "2026-11-30", "2026-10-01", "2026-10-31"],   // whole month -> whole previous month
    ["2026-03-01", "2026-03-31", "2026-02-01", "2026-02-28"],
    ["2026-01-01", "2026-01-31", "2025-12-01", "2025-12-31"],
    ["2026-11-01", "2026-11-18", "2026-10-14", "2026-10-31"],   // part month -> same length just before
    ["2026-10-01", "2026-11-30", "2026-08-01", "2026-09-30"],   // whole months -> as many whole months before
  ])("%s..%s -> %s..%s", (f, t, pf, pt) => expect(previousRange(f, t)).toEqual({ from: pf, to: pt }));
});

it("rangeDays is inclusive", () => {
  expect(rangeDays("2026-11-01", "2026-11-30")).toBe(30);
  expect(rangeDays("2026-03-01", "2026-03-31")).toBe(31); // across a DST change where one applies
});

it("sumRows sums every metric column and treats null as 0", () => {
  const t = sumRows([{ New: 2, WonValue: "100.50", Calls: null }, { New: 3, WonValue: 20, GroupLabel: "x" }]);
  expect(t).toMatchObject({ New: 5, WonValue: 120.5, Calls: 0, FuOpen: 0 });
  expect(t.GroupLabel).toBeUndefined();
  expect(t.TeamSize).toBeUndefined();
  expect(Object.keys(sumRows([]))).toEqual(SUM_KEYS);
});

it("exports the closed lists the procs accept", () => {
  expect(METRICS).toEqual(["new", "call", "visit", "meeting", "other", "visits", "fu_due", "fu_ontime",
    "fu_late", "fu_skipped", "fu_missed", "fu_open", "won", "lost", "open", "all"]);
  expect([MAX_ROWS, PREVIOUS_MAX_DAYS]).toEqual([2000, 92]);
  expect(SUM_KEYS).toHaveLength(31);
});

it("sumRows keeps money totals exact to the paisa", () => {
  expect(sumRows([{ WonValue: 0.1 }, { WonValue: "0.2" }]).WonValue).toBe(0.3);
});
