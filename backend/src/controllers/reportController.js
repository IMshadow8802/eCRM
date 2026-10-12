const database = require("../config/database");
const { scopeParams, scopeFor, scopeJson } = require("../middleware/permission");
const { asyncRoute, positiveInt } = require("../utils/controllerKit");
const { runReport, REPORTS, parseReportArgs, TAT_METRICS } = require("../utils/reportKit");
const { success, error } = require("../utils/responseHelper");
const { dayKey } = require("../utils/workCalendar");
const { visibleUserIds } = require("./workSettingsController");

class ReportController {
  async getDashboard(req, res) {
    try {
      // sp_Dashboard used to get the branch axis only (sql/081 adds @UserId +
      // @OwnerIdsJson), so a Self-scope rep was handed their whole branch:
      // 222 leads where the funnel report showed the correct 133.
      const t = scopeFor(req, "complaints");
      const result = await database.executeStoredProcedure("sp_Dashboard", {
        CompId: req.user.CompId,
        // Leads figures: the dashboard (= leads) scope bound by the route.
        // Ticket figures: the complaints scope, "[]" when the role has none.
        ...scopeParams(req),
        TicketBranchIdsJson: scopeJson(t.branchIds),
        TicketOwnerIdsJson: scopeJson(t.ownerIds),
      });

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
      const result = await database.executeStoredProcedure("sp_TicketsByCategory", {
        CompId: req.user.CompId,
        // The caller's own branch is NOT a visibility gate — req.scope is.
        // Passing req.user.BranchId showed a Self-scope agent the whole
        // branch, showed a Company-scope user only their own, and went
        // company-wide for anyone whose tblUser.BranchId is NULL.
        BranchId: positiveInt(req.body.BranchId),
        ...scopeParams(req),
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
      const result = await database.executeStoredProcedure("sp_ResolutionSummary", {
        CompId: req.user.CompId,
        BranchId: positiveInt(req.body.BranchId),
        ...scopeParams(req),
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

// Spec 4a: one method per report, every one the same line. Assigned on the
// instance rather than declared on the class so asyncRoute wraps each once —
// a thrown SP error becomes one consistent 500, validation stays a 400 inside
// runReport. REPORTS is the single list; adding a report = one row there.
for (const [key, { sp }] of Object.entries(REPORTS)) {
  controller[key] = asyncRoute(
    (req, res) => runReport(sp, req, res, key),
    "Failed to fetch report",
    "REPORT_ERROR",
  );
}

// Partner report: the money columns need `partners` view, not just report access.
const MONEY = ["WonValue", "Earned", "Due", "Paid"];
const omitMoney = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !MONEY.includes(k)));
controller.partners = asyncRoute(
  (req, res) => runReport("sp_RptPartners", req, res, "partners",
    scopeFor(req, "partners").can.view
      ? undefined
      : (d) => ({ ...d, kpis: omitMoney(d.kpis), rows: d.rows.map(omitMoney) })),
  "Failed to fetch report",
  "REPORT_ERROR",
);

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

module.exports = controller;
