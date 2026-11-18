const reportKit = require("../../../src/utils/reportKit");

const { REPORTS, parseReportArgs } = reportKit;

const TODAY = new Date("2026-09-10T12:00:00Z");
// The default window is a LOCAL calendar window. Pin a non-UTC zone so a
// UTC-based implementation is caught here rather than at 00:30 in production.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = "Asia/Kolkata"; });
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("reportKit exports", () => {
  it("keeps the range helpers and the TAT parser only (the spec-4a reports went with sql/122)", () => {
    expect(Object.keys(reportKit).sort()).toEqual(
      ["MAX_RANGE_DAYS", "REPORTS", "TAT_METRICS", "parseDay", "parseRange", "parseReportArgs"]);
    expect(REPORTS).toEqual({
      tat: { sp: "sp_RptTat", groupBys: ["person", "priority", "workspace"], bases: ["assigned"] },
    });
  });
});

describe("parseReportArgs", () => {
  it("defaults to the last 30 days, the report's first basis and the first GroupBy", () => {
    const { args } = parseReportArgs({}, "tat", TODAY);
    expect(args).toEqual({
      FromDate: "2026-08-12", ToDate: "2026-09-10", DateBasis: "assigned", GroupBy: "person",
      BranchId: null, OwnerId: null, SourceId: null, ProductId: null,
    });
  });

  it("accepts explicit dates, basis, GroupBy and narrows the id filters", () => {
    const { args } = parseReportArgs(
      { FromDate: "2026-01-01", ToDate: "2026-03-31", DateBasis: "assigned", GroupBy: "priority",
        BranchId: "2", OwnerId: 17, SourceId: 0, ProductId: "abc" },
      "tat", TODAY,
    );
    expect(args).toEqual({
      FromDate: "2026-01-01", ToDate: "2026-03-31", DateBasis: "assigned", GroupBy: "priority",
      BranchId: 2, OwnerId: 17, SourceId: null, ProductId: null,
    });
  });

  it("uses the caller's local calendar day, not the UTC one, for the default window", () => {
    // 01:00 local on 2026-09-10 is 2026-09-09T19:30Z in IST — toISOString()
    // would call that "yesterday" and drop a whole day of leads.
    const justAfterLocalMidnight = new Date(2026, 8, 10, 1, 0, 0);
    expect(justAfterLocalMidnight.toISOString().slice(0, 10)).toBe("2026-09-09");

    const { args } = parseReportArgs({}, "tat", justAfterLocalMidnight);
    expect(args.ToDate).toBe("2026-09-10");
    expect(args.FromDate).toBe("2026-08-12");
  });

  it("derives FromDate from an explicit ToDate", () => {
    const { args } = parseReportArgs({ ToDate: "2026-06-30" }, "tat", TODAY);
    expect(args.FromDate).toBe("2026-06-01");
  });

  it.each([
    [{ FromDate: "10/09/2026" }, /YYYY-MM-DD/],
    [{ ToDate: "2026-13-45" }, /YYYY-MM-DD/],
    [{ FromDate: "2026-02-30" }, /YYYY-MM-DD/], // regex-shaped but not a real day
    [{ FromDate: "2026-09-11", ToDate: "2026-09-10" }, /not be after/],
    [{ DateBasis: "invoiced" }, /DateBasis/],
    [{ GroupBy: "nope" }, /GroupBy must be one of/],
  ])("rejects %j", (body, message) => {
    const { error, args } = parseReportArgs(body, "tat", TODAY);
    expect(args).toBeUndefined();
    expect(error).toMatch(message);
  });

  it("validates DateBasis against the report's own bases (tat: assigned only)", () => {
    const { args } = parseReportArgs({}, "tat", TODAY);
    expect(args).toMatchObject({ DateBasis: "assigned", GroupBy: "person" });
    expect(parseReportArgs({ GroupBy: "workspace" }, "tat", TODAY).args.GroupBy).toBe("workspace");
    expect(parseReportArgs({ GroupBy: "verdict_by" }, "tat", TODAY).error).toMatch(/GroupBy must be one of person, priority, workspace/);
    expect(parseReportArgs({ DateBasis: "created" }, "tat", TODAY).error).toMatch(/DateBasis must be one of assigned/);
  });

  it("rejects a range over two years", () => {
    expect(parseReportArgs({ FromDate: "2024-01-01", ToDate: "2026-09-10" }, "tat", TODAY).error).toMatch(/731 days/);
  });

  it("rejects an unknown report key", () => {
    expect(parseReportArgs({}, "revenue", TODAY).error).toMatch(/Unknown report/);
  });
});
