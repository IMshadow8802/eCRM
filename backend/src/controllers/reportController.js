const database = require("../config/database");
const { actor } = require("../utils/actor");
const { asyncRoute, positiveInt } = require("../utils/controllerKit");
const { parseReportArgs, TAT_METRICS } = require("../utils/reportKit");
const { success, error } = require("../utils/responseHelper");
const { dayKey, toSqlIst } = require("../utils/workCalendar");
const { parseSalesArgs, previousRange, rangeDays, sumRows, MAX_ROWS, PREVIOUS_MAX_DAYS } = require("../utils/salesReport");
const { visibleUserIds } = require("./workSettingsController");

class ReportController {
  async getDashboard(req, res) {
    try {
      // F6: the company and the person only. The dashboard module opens the
      // route; every figure follows the leads / complaints definitions (132).
      const { CompId, UserId } = actor(req);
      const result = await database.executeStoredProcedure("sp_Dashboard", { CompId, UserId });

      // ponytail: extra recordsets ship in sql/055 — guard so the old SP (KPIs only) doesn't 500
      const rs = result.recordsets ?? [];
      return res.status(200).json({
        success: true,
        message: "Dashboard data fetched successfully",
        responseCode: 200,
        data: {
          dashboard: rs[0] ?? [],
          leadsTrend: rs[1] ?? [],
          leadsBySource: rs[2] ?? [],
          funnel: rs[3] ?? [],
          teamLoad: rs[4] ?? [],
          quarterlyActivity: rs[5] ?? [],
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Dashboard error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch dashboard data",
        code: "DASHBOARD_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // --- Ticket reports (Spec 2) ---

  async ticketsByCategory(req, res) {
    try {
      // BranchId is an optional filter that narrows; visibility is the complaints
      // definition in the database (132), never req.user.BranchId.
      const { CompId, UserId } = actor(req);
      const result = await database.executeStoredProcedure("sp_TicketsByCategory", {
        CompId, UserId, BranchId: positiveInt(req.body.BranchId),
      });
      return res.status(200).json({
        success: true,
        message: "Tickets by category fetched successfully",
        responseCode: 200,
        data: { categories: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Tickets by category error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch tickets by category",
        code: "TICKETS_BY_CATEGORY_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async resolutionSummary(req, res) {
    try {
      const { CompId, UserId } = actor(req);
      const result = await database.executeStoredProcedure("sp_ResolutionSummary", {
        CompId, UserId, BranchId: positiveInt(req.body.BranchId),
      });
      return res.status(200).json({
        success: true,
        message: "Resolution summary fetched successfully",
        responseCode: 200,
        data: { resolutions: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Resolution summary error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch resolution summary",
        code: "RESOLUTION_SUMMARY_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

const controller = new ReportController();

// Task TAT report (P4). Scope is the attendance scope (self + ReportsTo subtree +
// attendance reach), sent as a user allow-list: NULL = everyone, [] = nobody.
// An OwnerId outside it yields no rows, never that person's clocks.
// With no OwnerId the company's users are the candidates, or Office reach would drop the office.
const MAX_COMPANY_USERS = 1000; // ponytail: one page of sp_FetchUser, same ceiling as todayData.teamIds
async function companyUserIds(req) {
  const result = await database.executeStoredProcedure("sp_FetchUser", {
    Id: 0, CompId: req.user.CompId, BranchId: req.user.BranchId ?? null, IsAdmin: 1, AccessibleBranchIdsJson: null,
    PageNumber: 1, PageSize: MAX_COMPANY_USERS, SearchTerm: null,
  });
  return (result?.recordsets?.[0] ?? []).map((u) => Number(u.Id)).filter(Boolean);
}

// mssql hands DECIMALs back as numbers or strings; the page wants numbers, NULL kept.
const num = (v) => (v == null ? null : Number(v));
const numRow = (row, keep = []) => Object.fromEntries(
  Object.entries(row).map(([k, v]) => [k, keep.includes(k) ? v : num(v)]));
const EMPTY_KPIS = {
  Finished: 0, OnTime: 0, OnTimePct: null, Missed: 0, NotExcused: 0, Excused: 0, NoDecision: 0,
  ReasonPending: 0, OverdueNow: 0, OldestOverdueAt: null, MedianUsedPct: null, P90UsedPct: null,
};

// Same scope for the report and its drill-down: a user allow-list (NULL = everyone),
// [] when OwnerId is outside it.
async function tatScopeJson(req, OwnerId) {
  const allowed = await visibleUserIds(req, OwnerId ? [OwnerId] : await companyUserIds(req));
  const ids = allowed && OwnerId && !allowed.includes(OwnerId) ? [] : allowed;
  return ids === null ? null : JSON.stringify(ids);
}

controller.tat = asyncRoute(
  async (req, res) => {
    const parsed = parseReportArgs(req.body, "tat");
    if (parsed.error) return error(res, parsed.error, "VALIDATION_ERROR", 400);
    const { FromDate, ToDate, GroupBy, BranchId, OwnerId } = parsed.args;
    const result = await database.executeStoredProcedure("sp_RptTat", {
      CompId: req.user.CompId, FromDate, ToDate, GroupBy, BranchId, OwnerId,
      UserIdsJson: await tatScopeJson(req, OwnerId),
    });
    const rs = result?.recordsets ?? [];
    return success(res, "Report fetched successfully", {
      kpis: rs[0]?.[0] ? numRow(rs[0][0], ["OldestOverdueAt"]) : EMPTY_KPIS,
      rows: (rs[1] ?? []).map((r) => numRow(r, ["GroupKey", "GroupLabel"])),
      trend: (rs[2] ?? []).map((r) => ({ ...numRow(r, ["Bucket"]), Bucket: dayKey(r.Bucket) })),
      previous: rs[3]?.[0] ? numRow(rs[3][0]) : { Finished: 0, OnTime: 0 },
    });
  },
  "Failed to fetch report",
  "REPORT_ERROR",
);

// Drill-down: the clocks behind one headline number or one group row (TOP 500 in the SP).
controller.tatClocks = asyncRoute(
  async (req, res) => {
    const parsed = parseReportArgs(req.body, "tat");
    if (parsed.error) return error(res, parsed.error, "VALIDATION_ERROR", 400);
    const { Metric, GroupKey } = req.body ?? {};
    if (!TAT_METRICS.includes(Metric)) return error(res, `Metric must be one of ${TAT_METRICS.join(", ")}`, "VALIDATION_ERROR", 400);
    const { FromDate, ToDate, GroupBy, BranchId, OwnerId } = parsed.args;
    const result = await database.executeStoredProcedure("sp_RptTatClocks", {
      CompId: req.user.CompId, FromDate, ToDate, GroupBy,
      GroupKey: GroupKey == null ? null : String(GroupKey), // '' is a real group (no priority / board)
      Metric, BranchId, OwnerId, UserIdsJson: await tatScopeJson(req, OwnerId),
    });
    return success(res, "Report fetched successfully", { clocks: result?.recordsets?.[0] ?? [] });
  },
  "Failed to fetch report",
  "REPORT_ERROR",
);

// --- Sales reports (sql/122): summary lines and the rows behind one number ---
// The sales_reports module opens the route; what counts is the leads definition
// in the database (132, Ruling 7), fed only the session person — no lists.
// Totals are summed here from the lines (no totals from SQL); an 'own' line's
// TeamSize is the whole team and is passed through as the proc sent it.
const LINE_KEEP = ["GroupKey", "GroupLabel", "LineKind"];
const ROW_KEEP = ["EventAt", "Metric", "Src", "LeadName", "CreatedAt", "MobileNo", "Company", "PersonName",
  "OwnerName", "SourceName", "StatusName", "StatusCode", "Detail1", "Detail2", "LostReason", "Remarks",
  "QuoteNo", "LastActivityAt", "NextFollowupDate"];
const toPath = (rows = []) => rows.map((r) => ({ Id: num(r.Id), Name: r.Name }));
// Previous period only for a dated, non-Open-leads range of at most 92 days.
const previousOf = ({ FromDate, ToDate, GroupBy }) =>
  (FromDate && ToDate && GroupBy !== "person" && rangeDays(FromDate, ToDate) <= PREVIOUS_MAX_DAYS
    ? previousRange(FromDate, ToDate) : null);

controller.sales = asyncRoute(
  async (req, res) => {
    const parsed = parseSalesArgs(req.body);
    if (parsed.error) return error(res, parsed.error, "VALIDATION_ERROR", 400);
    const args = parsed.args;
    const { CompId, UserId } = actor(req);
    const run = (over) => database.executeStoredProcedure("sp_RptSales",
      { CompId, ...args, UserId, ...over });
    const prev = previousOf(args);
    const [result, prevResult] = await Promise.all([
      run(),
      prev && run({ FromDate: prev.from, ToDate: prev.to }),
    ]);
    const rs = result?.recordsets ?? [];
    const rows = (rs[0] ?? []).map((r) => numRow(r, LINE_KEEP));
    return success(res, "Report fetched successfully", {
      rows,
      totals: sumRows(rows),
      // the previous call's lines only (RS1); its path / NodeOk are the same call's
      previous: prev ? { totals: sumRows(prevResult?.recordsets?.[0] ?? []), range: prev } : null,
      path: toPath(rs[1]),
      nodeOk: rs[2]?.[0] ? !!rs[2][0].NodeOk : true,
      range: { from: args.FromDate, to: args.ToDate },
      asOf: toSqlIst(new Date()),
    });
  },
  "Failed to fetch report",
  "REPORT_ERROR",
);

controller.salesRows = asyncRoute(
  async (req, res) => {
    const parsed = parseSalesArgs(req.body, { rows: true });
    if (parsed.error) return error(res, parsed.error, "VALIDATION_ERROR", 400);
    const args = parsed.args;
    const MaxRows = Math.min(positiveInt(req.body?.MaxRows) ?? MAX_ROWS, MAX_ROWS);
    const { CompId, UserId } = actor(req);
    const run = (over) => database.executeStoredProcedure("sp_RptSalesRows",
      { CompId, ...args, MaxRows, UserId, ...over });
    const prev = req.body?.WithPrevious ? previousOf(args) : null;
    const [result, prevResult] = await Promise.all([
      run(),
      // MaxRows 0 = the totals row alone, as recordsets[0]
      prev && run({ FromDate: prev.from, ToDate: prev.to, MaxRows: 0 }),
    ]);
    const rs = result?.recordsets ?? [];
    const rows = (rs[0] ?? []).map((r) => numRow(r, ROW_KEEP));
    const { Total = 0, AmountTotal = 0, ...sums } = rs[1]?.[0] ?? {};
    const p = prevResult?.recordsets?.[0]?.[0] ?? {};
    // RS4 (last, only when MaxRows > 0): matches on leads out of view. The proc
    // lists visible rows only, and listed + hiddenCount = Total (= the summary cell).
    const hiddenCount = num(rs[3]?.[0]?.HiddenCount ?? 0);
    return success(res, "Report fetched successfully", {
      rows,
      total: num(Total),
      hiddenCount,
      amountTotal: num(AmountTotal),
      sums: numRow(sums),
      truncated: num(Total) - hiddenCount > rows.length,
      path: toPath(rs[2]),
      range: { from: args.FromDate, to: args.ToDate },
      previous: prev ? { total: num(p.Total ?? 0), amountTotal: num(p.AmountTotal ?? 0), range: prev } : null,
    });
  },
  "Failed to fetch report",
  "REPORT_ERROR",
);

module.exports = controller;
