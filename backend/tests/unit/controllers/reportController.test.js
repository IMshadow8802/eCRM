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
