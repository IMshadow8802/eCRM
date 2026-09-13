jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const reportController = require("../../../src/controllers/reportController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    body: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

describe("reportController.getDashboard", () => {
  // No req.scope at all — loadScope did not run (or a route mounted without
  // it). Both allow-lists serialise to null, which the SP reads as "no filter
  // on that dimension". That is unchanged by 081 and deliberate: absent scope
  // is not an empty allow-list, and collapsing the two would be the opposite
  // mistake. UserId still goes, because the assigned-or-created escape hatch
  // is what a scopeless request leans on.
  it("sends the full scope contract with null allow-lists when the request carries no scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ TotalLeads: 10 }]],
    });
    const req = baseReq();
    const res = mockRes();
    await reportController.getDashboard(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_Dashboard", {
      CompId: 5,
      UserId: 7,
      AccessibleBranchIdsJson: null,
      OwnerIdsJson: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.dashboard).toEqual([{ TotalLeads: 10 }]);
  });

  // The leak this replaced: sp_Dashboard got branch scope and no owner axis,
  // so se_se_pooja (Self, branch 2) read 222 leads — her whole branch —
  // where /api/reports/funnel showed her the correct 133.
  it("sends both axes of req.scope, so a Self-scope user is not given the whole branch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [21] } });
    const res = mockRes();
    await reportController.getDashboard(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_Dashboard", {
      CompId: 5,
      UserId: 7,
      AccessibleBranchIdsJson: "[2]",
      OwnerIdsJson: "[21]",
    });
  });

  // A Company-scope user has no ownership filter: ownerIds is null, never [].
  it("leaves the owner axis null for a wide scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await reportController.getDashboard(
      baseReq({ scope: { branchIds: [1, 2, 3], ownerIds: null } }),
      res,
    );

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_Dashboard",
      expect.objectContaining({
        AccessibleBranchIdsJson: JSON.stringify([1, 2, 3]),
        OwnerIdsJson: null,
      }),
    );
  });

  // Fail closed: an empty allow-list means "see nothing". Serialising [] to
  // null would fail OPEN and hand the narrowest user the widest dashboard.
  it("keeps an empty allow-list as [] rather than collapsing it to null", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await reportController.getDashboard(
      baseReq({ scope: { branchIds: [], ownerIds: [] } }),
      res,
    );

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_Dashboard",
      expect.objectContaining({ AccessibleBranchIdsJson: "[]", OwnerIdsJson: "[]" }),
    );
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
    await reportController.getDashboard(baseReq(), res);

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
    await reportController.getDashboard(baseReq(), res);

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
    const req = baseReq();
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
