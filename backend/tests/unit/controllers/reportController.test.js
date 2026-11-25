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
  // REGRESSION F6: the old call sent the leads lists + the complaints lists.
  it("F6 regression: getDashboard passes only CompId and UserId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    await reportController.getDashboard(
      dashReq([DASH, ["leads", "v", "Own"], ["complaints", "v", "Office"]]), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_Dashboard", { CompId: 5, UserId: 7 });
  });

  it("takes the person from the session, never the body", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = dashReq([DASH]);
    req.body = { UserId: 99, CompId: 98 };
    await reportController.getDashboard(req, mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toEqual({ CompId: 5, UserId: 7 });
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
      UserId: 7,
      BranchId: null,
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
      UserId: 7,
      BranchId: null,
    });
    const rows = res.json.mock.calls[0][0].data.resolutions;
    expect(rows).toHaveLength(1);
    expect(rows[0].AvgResolutionMins).toBe(95);
  });

  it("an office filter narrows (BranchId passed), the database decides the rest", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
    await reportController.ticketsByCategory(baseReq({ body: { BranchId: "4" } }), mockRes());
    await reportController.resolutionSummary(baseReq({ body: { BranchId: 4 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toEqual({ CompId: 5, UserId: 7, BranchId: 4 });
    expect(database.executeStoredProcedure.mock.calls[1][1]).toEqual({ CompId: 5, UserId: 7, BranchId: 4 });
  });

  it("handles DB error as 500 on a ticket report", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await reportController.ticketsByCategory(scopedReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
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

// --- Sales reports rebuild: sp_RptSales (summary lines) and sp_RptSalesRows (drill) ---

const salesReq = (body = {}, scope) => {
  const req = baseReq({ body });
  req.access = mockAccess({ modules: [["sales_reports", "v"], ["leads", "v", "Own"]] }, 7);
  req.scope = scope ?? scopeFor(req.access, "sales_reports", 7);
  return req;
};
const salesCall = (n) => database.executeStoredProcedure.mock.calls[n][1];

describe("reportController.sales", () => {
  const rs = (lines, path = [], ok = 1) => ({ recordsets: [lines, path, [{ NodeOk: ok }]] });

  it("calls sp_RptSales for the range and the previous range with the session person, no lists", async () => {
    database.executeStoredProcedure
      .mockResolvedValueOnce(rs([{ GroupKey: 3, GroupLabel: "A", LineKind: "person", New: 2, WonValue: "10.00" }]))
      .mockResolvedValueOnce(rs([{ GroupKey: 3, New: 1, WonValue: "0.00" }]));
    const req = salesReq({ FromDate: "2026-11-17", ToDate: "2026-11-17", NodeId: 12 });
    const res = mockRes();
    await reportController.sales(req, res);
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(1, "sp_RptSales", {
      CompId: 5, FromDate: "2026-11-17", ToDate: "2026-11-17", GroupBy: "team", NodeId: 12,
      BranchId: null, SourceId: null, ProductId: null, CallListId: null, UserId: 7 });
    expect(salesCall(1)).toMatchObject({ FromDate: "2026-11-16", ToDate: "2026-11-16", NodeId: 12 });
    const data = res.json.mock.calls[0][0].data;
    expect(data.totals).toMatchObject({ New: 2, WonValue: 10 });
    expect(data.previous).toEqual({ totals: expect.objectContaining({ New: 1 }), range: { from: "2026-11-16", to: "2026-11-16" } });
    expect(data.rows[0].WonValue).toBe(10); // DECIMAL strings become numbers
    expect(data.rows[0]).toMatchObject({ GroupKey: 3, GroupLabel: "A", LineKind: "person" });
    expect(data.nodeOk).toBe(true);
    expect(data.range).toEqual({ from: "2026-11-17", to: "2026-11-17" });
    expect(data.asOf).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("returns the path without its Ord and keeps an own line's TeamSize as sent", async () => {
    database.executeStoredProcedure
      .mockResolvedValueOnce(rs([{ GroupKey: 12, GroupLabel: "Neha", LineKind: "own", TeamSize: 5, New: 1 }],
        [{ Ord: 1, Id: 9, Name: "Ravi" }, { Ord: 2, Id: 12, Name: "Neha" }]))
      .mockResolvedValueOnce(rs([]));
    const res = mockRes();
    await reportController.sales(salesReq({ FromDate: "2026-11-17", ToDate: "2026-11-17", NodeId: 12 }), res);
    const data = res.json.mock.calls[0][0].data;
    expect(data.path).toEqual([{ Id: 9, Name: "Ravi" }, { Id: 12, Name: "Neha" }]);
    expect(data.rows[0]).toMatchObject({ LineKind: "own", TeamSize: 5 });
    expect(data.totals.TeamSize).toBeUndefined();
  });

  it("skips the previous call for Open leads and for ranges over 92 days", async () => {
    database.executeStoredProcedure.mockResolvedValue(rs([{ GroupKey: 3, OpenNow: 4 }]));
    let res = mockRes();
    await reportController.sales(salesReq({ GroupBy: "person" }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(salesCall(0)).toMatchObject({ GroupBy: "person", FromDate: null, ToDate: null });
    expect(res.json.mock.calls[0][0].data.previous).toBeNull();
    expect(res.json.mock.calls[0][0].data.range).toEqual({ from: null, to: null });

    database.executeStoredProcedure.mockClear();
    res = mockRes();
    await reportController.sales(salesReq({ GroupBy: "person", FromDate: "2026-11-01", ToDate: "2026-11-17" }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].data.previous).toBeNull();

    database.executeStoredProcedure.mockClear();
    res = mockRes();
    await reportController.sales(salesReq({ GroupBy: "source", FromDate: "2026-01-01", ToDate: "2026-06-30" }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].data.previous).toBeNull();
  });

  it("defaults to yesterday with a previous day when no dates are sent", async () => {
    database.executeStoredProcedure.mockResolvedValue(rs([]));
    await reportController.sales(salesReq({}), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(salesCall(0).FromDate).toEqual(expect.any(String));
    expect(salesCall(0).FromDate).toBe(salesCall(0).ToDate);
  });

  it("sends no lists to either call, whatever the caller's scope", async () => {
    database.executeStoredProcedure.mockResolvedValue(rs([]));
    await reportController.sales(salesReq({ FromDate: "2026-11-17", ToDate: "2026-11-17", UserId: 99 }, { branchIds: [2], ownerIds: [] }), mockRes());
    for (const n of [0, 1]) {
      expect(salesCall(n)).not.toHaveProperty("AccessibleBranchIdsJson");
      expect(salesCall(n)).not.toHaveProperty("OwnerIdsJson");
      expect(salesCall(n).UserId).toBe(7);
    }
  });

  it("answers nodeOk false with no rows when the SP refuses the node", async () => {
    database.executeStoredProcedure.mockResolvedValue(rs([], [], 0));
    const res = mockRes();
    await reportController.sales(salesReq({ FromDate: "2026-11-17", ToDate: "2026-11-17", NodeId: 99 }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const data = res.json.mock.calls[0][0].data;
    expect(data.rows).toEqual([]);
    expect(data.nodeOk).toBe(false);
    expect(data.path).toEqual([]);
  });

  it("tolerates missing recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValue({});
    const res = mockRes();
    await reportController.sales(salesReq({ FromDate: "2026-11-17", ToDate: "2026-11-17" }), res);
    const data = res.json.mock.calls[0][0].data;
    expect(data).toMatchObject({ rows: [], path: [], nodeOk: true });
    expect(data.totals.New).toBe(0);
  });

  it("400s bad input without touching the DB", async () => {
    const res = mockRes();
    await reportController.sales(salesReq({ GroupBy: "owner" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    jest.spyOn(console, "error").mockImplementation(() => {});
    await reportController.sales(salesReq({ FromDate: "2026-11-17", ToDate: "2026-11-17" }), res);
    console.error.mockRestore();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("REPORT_ERROR");
  });
});

describe("reportController.salesRows", () => {
  const ROW = { EventAt: new Date("2026-09-03T10:00:00Z"), Metric: "call", Src: "F", RefId: 1, LeadId: 9,
    LeadName: "Acme", MobileNo: "9825012345", Amount: "5.00", Detail1: "12", StatusCode: "open" };
  const body = (over = {}) => ({ FromDate: "2026-09-01", ToDate: "2026-09-30", Metric: "call", PersonId: 9, Rollup: true, ...over });

  it("passes the drill and the session person, MaxRows 2000, and reports truncation from the true total", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[ROW, { ...ROW, RefId: 2 }], [{ Total: 6412, AmountTotal: "5.00" }], [{ Ord: 1, Id: 9, Name: "Neha" }], [{ HiddenCount: 0 }]],
    });
    const res = mockRes();
    await reportController.salesRows(salesReq(body()), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure.mock.calls[0][0]).toBe("sp_RptSalesRows");
    expect(salesCall(0)).toMatchObject({
      CompId: 5, FromDate: "2026-09-01", ToDate: "2026-09-30", GroupBy: "team",
      Metric: "call", Shape: "events", PersonId: 9, Rollup: 1, MaxRows: 2000, UserId: 7,
    });
    const data = res.json.mock.calls[0][0].data;
    expect(data.total).toBe(6412);
    expect(data.truncated).toBe(true);
    expect(data.amountTotal).toBe(5);
    expect(data.sums).toEqual({});
    expect(data.path).toEqual([{ Id: 9, Name: "Neha" }]);
    expect(data.previous).toBeNull();
    expect(data.range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // text and date columns stay as they came; money becomes a number
    expect(data.rows[0]).toMatchObject({ EventAt: ROW.EventAt, MobileNo: "9825012345", Detail1: "12", Amount: 5, LeadId: 9 });
  });

  it("salesRows returns hiddenCount from the last recordset", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[ROW], [{ Total: 4, AmountTotal: "5.00" }], [], [{ HiddenCount: 3 }]],
    });
    const res = mockRes();
    await reportController.salesRows(salesReq(body()), res);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ total: 4, hiddenCount: 3, truncated: false });
  });

  // REGRESSION F2: the drill was fed Node's lists and every matching row came back.
  it("F2 regression: salesRows passes no list and returns only the rows the procedure returned", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[ROW, { ...ROW, RefId: 2 }], [{ Total: 5, AmountTotal: "5.00" }], [], [{ HiddenCount: 3 }]],
    });
    const res = mockRes();
    await reportController.salesRows(salesReq(body(), { branchIds: [2], ownerIds: [] }), res);
    expect(salesCall(0)).not.toHaveProperty("AccessibleBranchIdsJson");
    expect(salesCall(0)).not.toHaveProperty("OwnerIdsJson");
    const data = res.json.mock.calls[0][0].data;
    expect(data.rows.map((r) => r.RefId)).toEqual([1, 2]);
    // rows + hiddenCount = total: nothing was cut off, so not truncated
    expect(data).toMatchObject({ total: 5, hiddenCount: 3, truncated: false });
  });

  it("is truncated when visible matches exceed the rows returned", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[ROW], [{ Total: 10, AmountTotal: 0 }], [], [{ HiddenCount: 3 }]],
    });
    const res = mockRes();
    await reportController.salesRows(salesReq(body()), res);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ total: 10, hiddenCount: 3, truncated: true });
  });

  it("clamps a larger MaxRows to 2000", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [{ Total: 0, AmountTotal: 0 }]] });
    await reportController.salesRows(salesReq(body({ MaxRows: 50000 })), mockRes());
    expect(salesCall(0).MaxRows).toBe(2000);
  });

  it("is not truncated when every row came back", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[ROW, ROW], [{ Total: 2, AmountTotal: "10.00" }], []] });
    const res = mockRes();
    await reportController.salesRows(salesReq(body()), res);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ total: 2, truncated: false });
  });

  it("returns the column sums of the leads shape", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [
      [{ LeadId: 4, LeadName: "A", NNew: 1 }],
      [{ Total: 1, AmountTotal: "100.00", NNew: 1, NMissed: 2, WonValue: "17000.00" }], []] });
    const res = mockRes();
    await reportController.salesRows(salesReq(body({ Shape: "leads", Metric: "all", Rollup: false })), res);
    expect(salesCall(0)).toMatchObject({ Shape: "leads", Metric: "all", Rollup: 0 });
    expect(res.json.mock.calls[0][0].data.sums).toEqual({ NNew: 1, NMissed: 2, WonValue: 17000 });
  });

  it("WithPrevious makes one extra call with MaxRows 0 and returns its totals", async () => {
    database.executeStoredProcedure
      .mockResolvedValueOnce({ recordsets: [[ROW], [{ Total: 1, AmountTotal: "5.00" }], []] })
      .mockResolvedValueOnce({ recordsets: [[{ Total: 3, AmountTotal: "7.50" }]] });
    const res = mockRes();
    await reportController.salesRows(salesReq(body({ WithPrevious: true })), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(salesCall(1)).toMatchObject({ FromDate: "2026-08-01", ToDate: "2026-08-31", MaxRows: 0, Metric: "call", PersonId: 9 });
    expect(res.json.mock.calls[0][0].data.previous).toEqual({ total: 3, amountTotal: 7.5, range: { from: "2026-08-01", to: "2026-08-31" } });
  });

  it("WithPrevious is ignored for Open leads", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [{ Total: 0, AmountTotal: 0 }]] });
    const res = mockRes();
    await reportController.salesRows(salesReq({ GroupBy: "person", Metric: "open", WithPrevious: true }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(salesCall(0)).toMatchObject({ FromDate: null, ToDate: null });
    expect(res.json.mock.calls[0][0].data.previous).toBeNull();
  });

  it("a malformed PersonId is dropped, not an error", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await reportController.salesRows(salesReq(body({ PersonId: "abc" })), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(salesCall(0).PersonId).toBeNull();
  });

  it("400s a bad Metric without touching the DB", async () => {
    const res = mockRes();
    await reportController.salesRows(salesReq(body({ Metric: "calls" })), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("tolerates missing recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await reportController.salesRows(salesReq(body()), res);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ rows: [], total: 0, amountTotal: 0, hiddenCount: 0, truncated: false, path: [] });
  });
});

describe("calling figures on the sales report (149)", () => {
  const rs = (lines) => ({ recordsets: [lines, [], [{ NodeOk: 1 }]] });
  const callingReq = (body, admin = false) => {
    const req = baseReq({ body });
    req.access = mockAccess({ admin, modules: [["sales_reports", "v"], ["calling", "ve"], ["leads", "v", "Own"]] }, 7);
    req.scope = scopeFor(req.access, "sales_reports", 7);
    return req;
  };
  it("GroupBy caller runs sp_RptSales with CompId, UserId and no list parameter", async () => {
    database.executeStoredProcedure.mockResolvedValue(rs([{ GroupKey: 7, GroupLabel: "Ravi", Dials: 4 }]));
    const res = mockRes();
    await reportController.sales(callingReq({ GroupBy: "caller", FromDate: "2026-11-17", ToDate: "2026-11-17" }), res);
    const p = database.executeStoredProcedure.mock.calls[0][1];
    expect(p).toMatchObject({ CompId: 5, UserId: 7, GroupBy: "caller", CallListId: null });
    expect(Object.keys(p).some((k) => /Json$|Ids$/.test(k))).toBe(false);
    expect(res.json.mock.calls[0][0].data.totals.Dials).toBe(4);
  });
  it("GroupBy calllist returns ListCost to an admin and null to a non-admin with sales_reports and calling", async () => {
    const line = { GroupKey: 4, GroupLabel: "Surat", LineKind: "list", ListCost: "5000.00", SheetRows: 100, Dials: 2 };
    database.executeStoredProcedure.mockResolvedValue(rs([line]));
    const admin = mockRes();
    await reportController.sales(callingReq({ GroupBy: "calllist", CallListId: 4 }, true), admin);
    expect(admin.json.mock.calls[0][0].data.rows[0]).toMatchObject({ ListCost: 5000, SheetRows: 100 });
    // Any time on a dated report = 2000-01-01 .. today (NULL would match no row); no previous line for it.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ FromDate: "2000-01-01", ToDate: today, CallListId: 4 });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    database.executeStoredProcedure.mockResolvedValue(rs([line]));
    const other = mockRes();
    await reportController.sales(callingReq({ GroupBy: "calllist" }), other);
    expect(other.json.mock.calls[0][0].data.rows[0].ListCost).toBeNull();
    expect(other.json.mock.calls[0][0].data.previous).toBeNull();
  });
  it("salesRows keeps CallListName on a row and passes the calling metric", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ LeadName: "Mahesh", CallListId: 4, CallListName: "Surat", Detail1: "busy" }], [{ Total: 1 }], [], [{ HiddenCount: 0 }]] });
    const res = mockRes();
    await reportController.salesRows(callingReq({ GroupBy: "caller", Metric: "dial", Flag: "reached", CallListId: 4 }), res);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ Metric: "dial", Flag: "reached", CallListId: 4 });
    expect(res.json.mock.calls[0][0].data.rows[0]).toMatchObject({ CallListName: "Surat", CallListId: 4 });
  });
  it("salesRows for a list with no dates (See every call) sends 2000-01-01 .. today and skips the previous line", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], [{ Total: 3 }], [], [{ HiddenCount: 0 }]] });
    const res = mockRes();
    await reportController.salesRows(callingReq({ GroupBy: "calllist", Metric: "dial", GroupKey: 4, WithPrevious: true }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ FromDate: "2000-01-01", GroupKey: 4 });
    expect(database.executeStoredProcedure.mock.calls[0][1].ToDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ total: 3, previous: null });
  });
});
