// src/utils/reportKit.js
//
// The one shape every sales report endpoint shares (spec 4a §3–4): the same
// twelve SP params, the same three result sets, the same validation. Eight
// controller methods are each one line because this exists.

const database = require("../config/database");
const { scopeParams } = require("../middleware/permission");
const { success, error } = require("./responseHelper");
const { positiveInt } = require("./controllerKit");

const DATE_BASES = ["created", "closed", "activity"];

// GroupBy whitelist per report — must match the RAISERROR guard at the top of
// each sp_Rpt*. The SP rejects anything else too, but that surfaces as a 500;
// the 400 lives here.
const REPORTS = {
  funnel:             { sp: "sp_RptFunnel",             groupBys: ["source", "owner", "product", "branch", "status", "team"] },
  followUpCompliance: { sp: "sp_RptFollowUpCompliance", groupBys: ["owner", "team", "branch"] },
  activity:           { sp: "sp_RptActivity",           groupBys: ["owner", "day", "team", "branch"] },
  lost:               { sp: "sp_RptLost",               groupBys: ["reason", "source", "product", "owner", "branch"] },
  aging:              { sp: "sp_RptAging",              groupBys: ["owner", "branch", "team"] },
  transfers:          { sp: "sp_RptTransfers",          groupBys: ["reason", "pair", "branch"] },
  pipelineValue:      { sp: "sp_RptPipelineValue",      groupBys: ["status", "owner", "product", "branch"] },
  leaderboard:        { sp: "sp_RptLeaderboard",        groupBys: ["owner"] },
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");

// The LOCAL calendar date — never `toISOString()`, which converts to UTC and so
// renders "yesterday" for every caller east of Greenwich between midnight and
// their UTC offset (05:30 in IST, where the prod container runs). That silently
// dropped today's leads out of the default window every morning.
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// A YYYY-MM-DD string as a local Date, or null. The round-trip check is what
// rejects "2026-02-30": the regex passes it and `new Date(2026, 1, 30)` rolls it
// to March 2, so only comparing the parts back catches it.
const parseDay = (s) => {
  if (typeof s !== "string" || !ISO_DAY.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? date
    : null;
};

// n days before a local date, DST-safe (setDate normalises the calendar).
const daysBefore = (date, n) => {
  const back = new Date(date);
  back.setDate(back.getDate() - n);
  return back;
};

/**
 * Body -> SP params, or a message for a 400.
 * Defaults: last 30 days (today inclusive), basis 'created', the report's
 * first GroupBy. Id filters narrow only when they are positive integers.
 */
function parseReportArgs(body = {}, key, today = new Date()) {
  const report = REPORTS[key];
  if (!report) return { error: `Unknown report: ${key}` };

  const to = body.ToDate ?? isoDay(today);
  const toDate = parseDay(to);
  if (!toDate) return { error: "FromDate and ToDate must be YYYY-MM-DD" };
  const from = body.FromDate ?? isoDay(daysBefore(toDate, 29));
  if (!parseDay(from)) return { error: "FromDate and ToDate must be YYYY-MM-DD" };
  if (from > to) return { error: "FromDate must not be after ToDate" };

  const basis = body.DateBasis ?? "created";
  if (!DATE_BASES.includes(basis)) return { error: `DateBasis must be one of ${DATE_BASES.join(", ")}` };

  const groupBy = body.GroupBy ?? report.groupBys[0];
  if (!report.groupBys.includes(groupBy)) return { error: `GroupBy must be one of ${report.groupBys.join(", ")}` };

  return {
    args: {
      FromDate: from,
      ToDate: to,
      DateBasis: basis,
      GroupBy: groupBy,
      BranchId: positiveInt(body.BranchId),
      OwnerId: positiveInt(body.OwnerId),
      SourceId: positiveInt(body.SourceId),
      ProductId: positiveInt(body.ProductId),
    },
  };
}

/**
 * Runs one report SP and answers in the shared shape. Throws on a DB error so
 * the controller's asyncRoute owns the 500 — one place, one message.
 */
async function runReport(spName, req, res, key) {
  const parsed = parseReportArgs(req.body, key);
  if (parsed.error) return error(res, parsed.error, "VALIDATION_ERROR", 400);

  const result = await database.executeStoredProcedure(spName, {
    CompId: req.user.CompId,
    ...parsed.args,
    ...scopeParams(req),
  });
  const rs = result?.recordsets ?? [];
  const { FromDate, ToDate, DateBasis, GroupBy } = parsed.args;
  return success(res, "Report fetched successfully", {
    kpis: rs[0]?.[0] ?? {},
    rows: rs[1] ?? [],
    trend: rs[2] ?? [],
    range: { from: FromDate, to: ToDate, basis: DateBasis, groupBy: GroupBy },
  });
}

module.exports = { REPORTS, DATE_BASES, parseReportArgs, runReport };
