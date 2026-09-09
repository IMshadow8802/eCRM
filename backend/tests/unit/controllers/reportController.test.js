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
  it("calls sp_Dashboard with CompId and null AccessibleBranchIdsJson when scope has no branchIds", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ TotalLeads: 10 }]],
    });
    const req = baseReq();
    const res = mockRes();
    await reportController.getDashboard(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_Dashboard", {
      CompId: 5,
      AccessibleBranchIdsJson: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.dashboard).toEqual([{ TotalLeads: 10 }]);
  });

  it("serializes req.scope.branchIds to AccessibleBranchIdsJson when present", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = baseReq({ scope: { branchIds: [1, 2, 3] } });
    const res = mockRes();
    await reportController.getDashboard(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_Dashboard",
      expect.objectContaining({ AccessibleBranchIdsJson: JSON.stringify([1, 2, 3]) }),
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

describe("reportController.getConvertedSummary", () => {
  it("calls sp_ConvertedSummary with CompId and returns first row of first recordset", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ConvertedCount: 4 }]],
    });
    const req = baseReq();
    const res = mockRes();
    await reportController.getConvertedSummary(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_ConvertedSummary", {
      CompId: 5,
      AccessibleBranchIdsJson: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.summary).toEqual({ ConvertedCount: 4 });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();
    await reportController.getConvertedSummary(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});

describe("reportController.leadsByStatus", () => {
  it("passes an optional BranchId filter plus the caller's scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ StatusId: 1, LeadCount: 2 }]] });
    const res = mockRes();
    await reportController.leadsByStatus(
      { user: { CompId: 5, BranchId: 2 }, scope: { branchIds: [2, 3] }, body: { BranchId: 3 } },
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_LeadsByStatus", {
      CompId: 5, BranchId: 3, AccessibleBranchIdsJson: "[2,3]",
    });
    expect(res.json.mock.calls[0][0].data.statuses).toEqual([{ StatusId: 1, LeadCount: 2 }]);
  });

  it("defaults BranchId and AccessibleBranchIdsJson to null when no filter/scope given", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await reportController.leadsByStatus({ user: { CompId: 5 }, body: {} }, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_LeadsByStatus", {
      CompId: 5, BranchId: null, AccessibleBranchIdsJson: null,
    });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await reportController.leadsByStatus({ user: { CompId: 5 }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});

describe("reportController.callsPerUser", () => {
  it("calls sp_CallsPerUser with CompId + body's BranchId + date range and returns rows", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ UserId: 7, FullName: "Jane", CallCount: 12 }]],
    });
    const req = baseReq({ scope: { branchIds: [2, 3] }, body: { BranchId: 3, FromDate: "2026-06-01", ToDate: "2026-06-30" } });
    const res = mockRes();
    await reportController.callsPerUser(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_CallsPerUser", {
      CompId: 5,
      BranchId: 3,
      FromDate: "2026-06-01",
      ToDate: "2026-06-30",
      AccessibleBranchIdsJson: "[2,3]",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data.calls).toEqual([{ UserId: 7, FullName: "Jane", CallCount: 12 }]);
  });

  it("defaults FromDate/ToDate/BranchId to null when absent from body", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = baseReq();
    const res = mockRes();
    await reportController.callsPerUser(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_CallsPerUser",
      expect.objectContaining({ FromDate: null, ToDate: null, BranchId: null, AccessibleBranchIdsJson: null }),
    );
  });

  // The caller's OWN branch was being passed as the filter — that is the bug
  // ROLES.md names. A filter is a dropdown, not a scope.
  it("filters by the body's BranchId, not the caller's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    await reportController.callsPerUser({ user: { CompId: 5, BranchId: 2 }, scope: {}, body: {} }, mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ CompId: 5, BranchId: null });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();
    await reportController.callsPerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});

describe("reportController.conversionBySource", () => {
  it("calls sp_ConversionBySource with CompId + body's BranchId and returns per-source rows incl. Qualified/Lost counts", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ SourceId: 1, SourceName: "Website", Total: 50, Won: 8, QualifiedCount: 20, LostCount: 5 }]],
    });
    const req = baseReq({ scope: { branchIds: [2, 3] }, body: { BranchId: 3 } });
    const res = mockRes();
    await reportController.conversionBySource(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_ConversionBySource", {
      CompId: 5,
      BranchId: 3,
      AccessibleBranchIdsJson: "[2,3]",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data.conversion).toEqual([
      { SourceId: 1, SourceName: "Website", Total: 50, Won: 8, QualifiedCount: 20, LostCount: 5 },
    ]);
  });

  it("defaults BranchId to null when absent from body — not the caller's own branch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = baseReq();
    const res = mockRes();
    await reportController.conversionBySource(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_ConversionBySource", {
      CompId: 5,
      BranchId: null,
      AccessibleBranchIdsJson: null,
    });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();
    await reportController.conversionBySource(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});

describe("reportController ticket reports", () => {
  it("ticketsByCategory calls sp_TicketsByCategory and returns category rows", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ CategoryId: 1, CategoryName: "Billing", TicketCount: 3 }]],
    });
    const res = mockRes();
    await reportController.ticketsByCategory(baseReq(), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_TicketsByCategory", {
      CompId: 5,
      BranchId: 2,
    });
    expect(res.json.mock.calls[0][0].data.categories).toHaveLength(1);
  });

  it("resolutionSummary returns resolution rows incl. the avg-resolution speed metric", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResolutionId: 1, ResolutionName: "Fixed", TicketCount: 4, AvgResolutionMins: 95 }]],
    });
    const res = mockRes();
    await reportController.resolutionSummary(baseReq(), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_ResolutionSummary", {
      CompId: 5,
      BranchId: 2,
    });
    const rows = res.json.mock.calls[0][0].data.resolutions;
    expect(rows).toHaveLength(1);
    expect(rows[0].AvgResolutionMins).toBe(95);
  });

  it("handles DB error as 500 on a ticket report", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await reportController.ticketsByCategory(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
