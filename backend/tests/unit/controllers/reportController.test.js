jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const reportController = require("../../../src/controllers/reportController");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");
const { scopeFor } = require("../../../src/middleware/access");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    body: {},
    ...overrides,
  };
}

// A dashboard request: the route binds req.scope to "dashboard" (leads reach).
function dashReq(modules) {
  const req = baseReq();
  req.access = mockAccess({ modules }, 7);
  req.scope = scopeFor(req.access, "dashboard", 7);
  return req;
}
const DASH = ["dashboard", "v"];

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

describe("reportController.getDashboard", () => {
  it("passes leads scope and complaints scope separately", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    await reportController.getDashboard(
      dashReq([DASH, ["leads", "v", "Own"], ["complaints", "v", "Office"]]), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_Dashboard", {
      CompId: 5, UserId: 7,
      AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]",
      TicketBranchIdsJson: "[2]", TicketOwnerIdsJson: null,
    });
  });

  it("sends an empty ticket allow-list when the role has no complaints module", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    await reportController.getDashboard(dashReq([DASH, ["leads", "v", "Office"]]), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_Dashboard",
      expect.objectContaining({ TicketBranchIdsJson: "[]", TicketOwnerIdsJson: "[]", OwnerIdsJson: null }));
  });

  it("maps the chart series recordsets into named keys", async () => {
    const kpis = [{ Type: "TotalLeads", Number: 10 }];
    const trend = [{ Name: "Mon", Leads: 3, Converted: 1 }];
    const source = [{ Name: "Google", Value: 5 }];
    const funnel = [{ Name: "New", Value: 4, SortOrder: 1 }];
    const teamLoad = [{ Name: "Asha", Value: 7 }];
    const quarters = [{ Name: "Q1", Leads: 9, Calls: 12, Tickets: 2 }];
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [kpis, trend, source, funnel, teamLoad, quarters],
    });
    const res = mockRes();
    await reportController.getDashboard(dashReq([DASH, ["leads", "v", "Office"]]), res);

    const data = res.json.mock.calls[0][0].data;
    expect(data.dashboard).toEqual(kpis);
    expect(data.leadsTrend).toEqual(trend);
    expect(data.leadsBySource).toEqual(source);
    expect(data.funnel).toEqual(funnel);
    expect(data.teamLoad).toEqual(teamLoad);
    expect(data.quarterlyActivity).toEqual(quarters);
  });

  it("returns empty arrays for series when the SP only returns KPIs (sql/055 not yet applied)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Type: "TotalLeads", Number: 10 }]],
    });
    const res = mockRes();
    await reportController.getDashboard(dashReq([DASH, ["leads", "v", "Office"]]), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const data = res.json.mock.calls[0][0].data;
    expect(data.leadsTrend).toEqual([]);
    expect(data.leadsBySource).toEqual([]);
    expect(data.funnel).toEqual([]);
    expect(data.teamLoad).toEqual([]);
    expect(data.quarterlyActivity).toEqual([]);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = dashReq([DASH, ["leads", "v", "Office"]]);
    const res = mockRes();
    await reportController.getDashboard(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});

describe("reportController ticket reports", () => {
  // These are scope-governed like every other report, so the request carries
  // req.scope. Before 080 they read req.user.BranchId instead.
  const scopedReq = () => baseReq({ scope: { branchIds: [2], ownerIds: [7] } });

  it("ticketsByCategory calls sp_TicketsByCategory and returns category rows", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ CategoryId: 1, CategoryName: "Billing", TicketCount: 3 }]],
    });
    const res = mockRes();
    await reportController.ticketsByCategory(scopedReq(), res);
    // req.scope, never req.user.BranchId. Passing the JWT branch let a
    // Self-scope agent read the whole branch's tickets and showed a
    // Company-scope user only their own branch — wrong in both directions,
    // and fail-open for anyone whose tblUser.BranchId is NULL.
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_TicketsByCategory", {
      CompId: 5,
      BranchId: null,
      UserId: 7,
      AccessibleBranchIdsJson: "[2]",
      OwnerIdsJson: "[7]",
    });
    expect(res.json.mock.calls[0][0].data.categories).toHaveLength(1);
  });

  it("resolutionSummary returns resolution rows incl. the avg-resolution speed metric", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResolutionId: 1, ResolutionName: "Fixed", TicketCount: 4, AvgResolutionMins: 95 }]],
    });
    const res = mockRes();
    await reportController.resolutionSummary(scopedReq(), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_ResolutionSummary", {
      CompId: 5,
      BranchId: null,
      UserId: 7,
      AccessibleBranchIdsJson: "[2]",
      OwnerIdsJson: "[7]",
    });
    const rows = res.json.mock.calls[0][0].data.resolutions;
    expect(rows).toHaveLength(1);
    expect(rows[0].AvgResolutionMins).toBe(95);
  });

  it("handles DB error as 500 on a ticket report", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await reportController.ticketsByCategory(scopedReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// --- Spec 4a: the eight report endpoints, all through reportKit.runReport ---

const REPORT_METHODS = [
  ["funnel", "sp_RptFunnel", "source"],
  ["followUpCompliance", "sp_RptFollowUpCompliance", "owner"],
  ["activity", "sp_RptActivity", "owner"],
  ["lost", "sp_RptLost", "reason"],
  ["aging", "sp_RptAging", "owner"],
  ["transfers", "sp_RptTransfers", "reason"],
  ["pipelineValue", "sp_RptPipelineValue", "status"],
  ["leaderboard", "sp_RptLeaderboard", "owner"],
];

describe.each(REPORT_METHODS)("reportController.%s", (method, sp, defaultGroupBy) => {
  it(`calls ${sp} with CompId, the parsed args and the caller's scope`, async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ A: 1 }], [{ GroupKey: 1, GroupLabel: "x" }], [{ Bucket: "2026-09-01" }]],
    });
    const res = mockRes();
    await reportController[method](
      baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { FromDate: "2026-08-01", ToDate: "2026-08-31" } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(sp, {
      CompId: 5,
      FromDate: "2026-08-01", ToDate: "2026-08-31", DateBasis: "created", GroupBy: defaultGroupBy,
      BranchId: null, OwnerId: null, SourceId: null, ProductId: null,
      UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      kpis: { A: 1 },
      rows: [{ GroupKey: 1, GroupLabel: "x" }],
      trend: [{ Bucket: "2026-09-01" }],
      range: { from: "2026-08-01", to: "2026-08-31", basis: "created", groupBy: defaultGroupBy },
    });
  });

  it("400s on a GroupBy outside this report's whitelist", async () => {
    const res = mockRes();
    await reportController[method](baseReq({ body: { GroupBy: "nope" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await reportController[method](baseReq({ body: { FromDate: "2026-08-01", ToDate: "2026-08-31" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "REPORT_ERROR" });
  });
});

// --- P4: the TAT report — scoped by the attendance scope as a user allow-list ---

describe("reportController.tat", () => {
  const tatReq = (body = {}, { admin = false, modules = [["tasks", "v"]], team = [] } = {}) => {
    const req = baseReq({ body });
    req.access = mockAccess({ admin, modules }, 7);
    req.access.teamOwners = team;
    return req;
  };
  const sp = (rs = [
    [{ Finished: 3, OnTime: 3, OnTimePct: "100.0", MedianUsedPct: ".0", P90UsedPct: null, OldestOverdueAt: null }],
    [{ GroupKey: "7", GroupLabel: "Asha", Finished: 3, OnTimePct: null }],
    [{ Bucket: new Date(2026, 7, 3), Finished: "1", OnTime: 1 }],
    [{ Finished: 5, OnTime: 4 }],
  ]) => {
    database.executeStoredProcedure.mockImplementation(async (name) => (name === "sp_FetchCalendarContext"
      ? { recordsets: [[{ UserId: 20, BranchId: 2, CalendarId: null }], [], [], []] }
      : { recordsets: rs }));
  };
  const tatCall = () => database.executeStoredProcedure.mock.calls.find((c) => c[0] === "sp_RptTat")[1];

  it("an employee gets their own id only; no DateBasis/Source/Product params", async () => {
    sp();
    const res = mockRes();
    await reportController.tat(tatReq({ FromDate: "2026-08-01", ToDate: "2026-08-31" }), res);
    expect(tatCall()).toEqual({
      CompId: 5, FromDate: "2026-08-01", ToDate: "2026-08-31", GroupBy: "person",
      BranchId: null, OwnerId: null, UserIdsJson: "[7]",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      kpis: expect.objectContaining({ Finished: 3, OnTimePct: 100, MedianUsedPct: 0, P90UsedPct: null, OldestOverdueAt: null }),
      rows: [{ GroupKey: "7", GroupLabel: "Asha", Finished: 3, OnTimePct: null }], // NVARCHAR key stays a string; DECIMALs become numbers
      trend: [{ Bucket: "2026-08-03", Finished: 1, OnTime: 1 }],
      previous: { Finished: 5, OnTime: 4 },
    });
  });

  it("an OwnerId outside scope sends [] (no rows), never that person's clocks", async () => {
    sp();
    await reportController.tat(tatReq({ OwnerId: 99 }), mockRes());
    expect(tatCall()).toMatchObject({ OwnerId: 99, UserIdsJson: "[]" });
  });

  it("a manager's OwnerId inside the subtree keeps the allow-list", async () => {
    sp();
    await reportController.tat(tatReq({ OwnerId: 8, GroupBy: "priority" }, { team: [7, 8] }), mockRes());
    expect(tatCall()).toMatchObject({ OwnerId: 8, GroupBy: "priority", UserIdsJson: "[7,8]" });
  });

  it("Office attendance reach admits an OwnerId in the caller's office", async () => {
    sp();
    await reportController.tat(tatReq({ OwnerId: 20 }, { modules: [["attendance", "v", "Office"]] }), mockRes());
    expect(tatCall()).toMatchObject({ OwnerId: 20, UserIdsJson: "[7,20]" });
  });

  it("Office reach with no OwnerId includes the office members (the report loads the company as candidates)", async () => {
    database.executeStoredProcedure.mockImplementation(async (name) => {
      if (name === "sp_FetchUser") return { recordsets: [[{ Id: 20 }, { Id: 21 }]] };
      if (name === "sp_FetchCalendarContext") {
        return { recordsets: [[{ UserId: 20, BranchId: 2, CalendarId: null }, { UserId: 21, BranchId: 9, CalendarId: null }], [], [], []] };
      }
      return { recordsets: [] };
    });
    await reportController.tat(tatReq({}, { modules: [["attendance", "v", "Office"]] }), mockRes());
    expect(tatCall()).toMatchObject({ OwnerId: null, UserIdsJson: "[7,20]" });
    expect(database.executeStoredProcedure.mock.calls.find((c) => c[0] === "sp_FetchUser")[1])
      .toMatchObject({ Id: 0, CompId: 5, IsAdmin: 1, PageSize: 1000 });
  });

  it("an admin sends NULL (everyone)", async () => {
    sp([]);
    const res = mockRes();
    await reportController.tat(tatReq({ OwnerId: 99 }, { admin: true }), res);
    expect(tatCall()).toMatchObject({ UserIdsJson: null });
    const data = res.json.mock.calls[0][0].data;
    expect(data).toMatchObject({ rows: [], trend: [], previous: { Finished: 0, OnTime: 0 } });
    expect(data.kpis.Finished).toBe(0);
    expect(data.kpis.OnTimePct).toBeNull();
  });

  it("400s a DateBasis other than assigned, and an unknown GroupBy (verdict_by is gone), without the DB", async () => {
    for (const body of [{ DateBasis: "created" }, { GroupBy: "owner" }, { GroupBy: "verdict_by" }]) {
      const res = mockRes();
      await reportController.tat(tatReq(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

describe("reportController.tatClocks", () => {
  const req = (body = {}, { admin = false, team = [] } = {}) => {
    const r = baseReq({ body });
    r.access = mockAccess({ admin, modules: [["tasks", "v"]] }, 7);
    r.access.teamOwners = team;
    return r;
  };
  const clocksCall = () => database.executeStoredProcedure.mock.calls.find((c) => c[0] === "sp_RptTatClocks")[1];
  const stub = (rows = [{ TatId: 1 }]) => database.executeStoredProcedure.mockImplementation(async (name) => (name === "sp_FetchCalendarContext"
    ? { recordsets: [[], [], [], []] } : { recordsets: [rows] }));

  it("passes Metric, GroupKey and the scoped UserIdsJson, returns clocks", async () => {
    stub();
    const res = mockRes();
    await reportController.tatClocks(req({ FromDate: "2026-08-01", ToDate: "2026-08-31", GroupBy: "priority", GroupKey: "3", Metric: "missed" }), res);
    expect(clocksCall()).toEqual({
      CompId: 5, FromDate: "2026-08-01", ToDate: "2026-08-31", GroupBy: "priority", GroupKey: "3", Metric: "missed",
      BranchId: null, OwnerId: null, UserIdsJson: "[7]",
    });
    expect(res.json.mock.calls[0][0].data).toEqual({ clocks: [{ TatId: 1 }] });
  });

  it("keeps an empty GroupKey as '' and an absent one as null", async () => {
    stub();
    await reportController.tatClocks(req({ Metric: "finished", GroupKey: "" }), mockRes());
    expect(clocksCall().GroupKey).toBe("");
    database.executeStoredProcedure.mockClear();
    stub();
    await reportController.tatClocks(req({ Metric: "finished" }), mockRes());
    expect(clocksCall().GroupKey).toBeNull();
  });

  it("an admin sends NULL scope", async () => {
    stub();
    await reportController.tatClocks(req({ Metric: "overdue_now" }, { admin: true }), mockRes());
    expect(clocksCall().UserIdsJson).toBeNull();
  });

  it("400s a bad or missing Metric, bad GroupBy, bad dates, without the DB", async () => {
    for (const body of [{ Metric: "nope" }, {}, { Metric: "missed", GroupBy: "owner" }, { Metric: "missed", FromDate: "x" }]) {
      const res = mockRes();
      await reportController.tatClocks(req(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("an out-of-scope OwnerId sends [] and answers clocks: [] (never 403)", async () => {
    stub([]);
    const res = mockRes();
    await reportController.tatClocks(req({ Metric: "missed", OwnerId: 99 }), res);
    expect(clocksCall()).toMatchObject({ OwnerId: 99, UserIdsJson: "[]" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ clocks: [] });
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValue(new Error("boom"));
    const res = mockRes();
    await reportController.tatClocks(req({ Metric: "missed", OwnerId: 7 }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// --- Partner report: money columns only for callers who can view partners ---

describe("reportController.partners", () => {
  const FULL = { LeadsSent: 4, Converted: 1, ConversionPct: 25, WonValue: 100, Earned: 10, Due: 5, Paid: 5 };
  const partnersReq = (modules) => {
    const req = baseReq({ body: { FromDate: "2026-08-01", ToDate: "2026-08-31" } });
    req.access = mockAccess({ modules }, 7);
    req.scope = scopeFor(req.access, "sales_reports", 7);
    return req;
  };
  const run = async (modules) => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[FULL], [{ GroupKey: 1, GroupLabel: "P", ...FULL }], [{ Bucket: "2026-08-01", LeadsSent: 4, Converted: 1 }]],
    });
    const res = mockRes();
    await reportController.partners(partnersReq(modules), res);
    return res.json.mock.calls[0][0].data;
  };

  it("calls sp_RptPartners and keeps money when the caller can view partners", async () => {
    const data = await run([["sales_reports", "v"], ["partners", "v"]]);
    expect(database.executeStoredProcedure.mock.calls[0][0]).toBe("sp_RptPartners");
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ GroupBy: "partner", CompId: 5 });
    expect(data.kpis.Earned).toBe(10);
    expect(data.rows[0].Paid).toBe(5);
  });

  it("strips WonValue/Earned/Due/Paid from kpis and rows without partners view", async () => {
    const data = await run([["sales_reports", "v"]]);
    expect(data.kpis).toEqual({ LeadsSent: 4, Converted: 1, ConversionPct: 25 });
    expect(data.rows[0]).toEqual({ GroupKey: 1, GroupLabel: "P", LeadsSent: 4, Converted: 1, ConversionPct: 25 });
    expect(data.trend).toHaveLength(1);
  });

  it("tolerates empty result sets when stripping", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await reportController.partners(partnersReq([["sales_reports", "v"]]), res);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ kpis: {}, rows: [], trend: [] });
  });
});
