jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const { REPORTS, parseReportArgs, runReport } = require("../../../src/utils/reportKit");
const { mockRes } = require("../../helpers/mockRes");

const TODAY = new Date("2026-09-10T12:00:00Z");
const req = (body = {}, scope = { branchIds: [1, 2], ownerIds: null }) => ({
  user: { UserId: 13, CompId: 1, BranchId: 1 },
  scope,
  body,
});

// The default window is a LOCAL calendar window. Pin a non-UTC zone so a
// UTC-based implementation is caught here rather than at 00:30 in production.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = "Asia/Kolkata"; });
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

beforeEach(() => database.executeStoredProcedure.mockReset());

describe("REPORTS", () => {
  it("lists the eight reports with their SP and a non-empty GroupBy whitelist", () => {
    expect(Object.keys(REPORTS)).toEqual([
      "funnel", "followUpCompliance", "activity", "lost", "aging", "transfers", "pipelineValue", "leaderboard",
    ]);
    for (const r of Object.values(REPORTS)) {
      expect(r.sp).toMatch(/^sp_Rpt/);
      expect(r.groupBys.length).toBeGreaterThan(0);
    }
    expect(REPORTS.transfers.groupBys).toContain("pair");
    expect(REPORTS.leaderboard.groupBys).toEqual(["owner"]);
  });
});

describe("parseReportArgs", () => {
  it("defaults to the last 30 days, basis created and the first GroupBy", () => {
    const { args } = parseReportArgs({}, "funnel", TODAY);
    expect(args).toEqual({
      FromDate: "2026-08-12", ToDate: "2026-09-10", DateBasis: "created", GroupBy: "source",
      BranchId: null, OwnerId: null, SourceId: null, ProductId: null,
    });
  });

  it("accepts explicit dates, basis, GroupBy and narrows the id filters", () => {
    const { args } = parseReportArgs(
      { FromDate: "2026-01-01", ToDate: "2026-03-31", DateBasis: "closed", GroupBy: "owner",
        BranchId: "2", OwnerId: 17, SourceId: 0, ProductId: "abc" },
      "funnel", TODAY,
    );
    expect(args).toEqual({
      FromDate: "2026-01-01", ToDate: "2026-03-31", DateBasis: "closed", GroupBy: "owner",
      BranchId: 2, OwnerId: 17, SourceId: null, ProductId: null,
    });
  });

  it("uses the caller's local calendar day, not the UTC one, for the default window", () => {
    // 01:00 local on 2026-09-10 is 2026-09-09T19:30Z in IST — toISOString()
    // would call that "yesterday" and drop a whole day of leads.
    const justAfterLocalMidnight = new Date(2026, 8, 10, 1, 0, 0);
    expect(justAfterLocalMidnight.toISOString().slice(0, 10)).toBe("2026-09-09");

    const { args } = parseReportArgs({}, "funnel", justAfterLocalMidnight);
    expect(args.ToDate).toBe("2026-09-10");
    expect(args.FromDate).toBe("2026-08-12");
  });

  it("derives FromDate from an explicit ToDate", () => {
    const { args } = parseReportArgs({ ToDate: "2026-06-30" }, "funnel", TODAY);
    expect(args.FromDate).toBe("2026-06-01");
  });

  it.each([
    [{ FromDate: "10/09/2026" }, /YYYY-MM-DD/],
    [{ ToDate: "2026-13-45" }, /YYYY-MM-DD/],
    [{ FromDate: "2026-02-30" }, /YYYY-MM-DD/], // regex-shaped but not a real day
    [{ FromDate: "2026-09-11", ToDate: "2026-09-10" }, /not be after/],
    [{ DateBasis: "invoiced" }, /DateBasis/],
    [{ GroupBy: "nope" }, /GroupBy must be one of/],
    [{ GroupBy: "pair" }, /GroupBy must be one of/], // valid for transfers, not for funnel
  ])("rejects %j", (body, message) => {
    const { error, args } = parseReportArgs(body, "funnel", TODAY);
    expect(args).toBeUndefined();
    expect(error).toMatch(message);
  });

  it("rejects an unknown report key", () => {
    expect(parseReportArgs({}, "revenue", TODAY).error).toMatch(/Unknown report/);
  });
});

describe("runReport", () => {
  it("400s on a validation error without touching the database", async () => {
    const res = mockRes();
    await runReport("sp_RptFunnel", req({ GroupBy: "nope" }), res, "funnel");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s on a calendar-invalid date without touching the database", async () => {
    const res = mockRes();
    await runReport("sp_RptFunnel", req({ FromDate: "2026-02-30", ToDate: "2026-03-31" }), res, "funnel");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("calls the SP with CompId + args + the caller's scope and maps the three result sets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Created: 10, Qualified: 3 }],
        [{ GroupKey: 11, GroupLabel: "Website", Created: 6 }],
        [{ Bucket: "2026-09-07", Created: 4 }],
      ],
    });
    const res = mockRes();
    await runReport(
      "sp_RptFunnel",
      req({ FromDate: "2026-08-01", ToDate: "2026-08-31", GroupBy: "source", BranchId: 2 }, { branchIds: [1, 2], ownerIds: [17] }),
      res, "funnel",
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_RptFunnel", {
      CompId: 1,
      FromDate: "2026-08-01", ToDate: "2026-08-31", DateBasis: "created", GroupBy: "source",
      BranchId: 2, OwnerId: null, SourceId: null, ProductId: null,
      UserId: 13, AccessibleBranchIdsJson: "[1,2]", OwnerIdsJson: "[17]",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      kpis: { Created: 10, Qualified: 3 },
      rows: [{ GroupKey: 11, GroupLabel: "Website", Created: 6 }],
      trend: [{ Bucket: "2026-09-07", Created: 4 }],
      range: { from: "2026-08-01", to: "2026-08-31", basis: "created", groupBy: "source" },
    });
  });

  // The leaderboard's RS1 and RS3 are empty by contract; an empty first
  // recordset must become {} not undefined, so the page can read kpis.X safely.
  it("returns {} kpis and [] trend when those result sets are empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [{ GroupKey: 17, Rank: 1 }], []] });
    const res = mockRes();
    await runReport("sp_RptLeaderboard", req({ FromDate: "2026-08-01", ToDate: "2026-08-31" }), res, "leaderboard");
    const { data } = res.json.mock.calls[0][0];
    expect(data.kpis).toEqual({});
    expect(data.rows).toHaveLength(1);
    expect(data.trend).toEqual([]);
  });

  it("sends null scope json (and still the UserId) when req.scope is absent — loadScope always sets it in production", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const r = { user: { UserId: 13, CompId: 1 }, body: {} };
    await runReport("sp_RptFunnel", r, mockRes(), "funnel");
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      UserId: 13, AccessibleBranchIdsJson: null, OwnerIdsJson: null,
    });
  });

  it("lets a database error propagate (asyncRoute in the controller turns it into a 500)", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    await expect(runReport("sp_RptFunnel", req({ FromDate: "2026-08-01", ToDate: "2026-08-31" }), mockRes(), "funnel")).rejects.toThrow("boom");
  });
});
