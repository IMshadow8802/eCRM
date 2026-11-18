// src/utils/reportKit.js
//
// Date-range parsing shared by every report and drill (parseDay, parseRange),
// plus the TAT report's argument parser (parseReportArgs over REPORTS.tat).
// The spec-4a sales reports that also used it went with sql/122.

const { positiveInt } = require("./controllerKit");

const MAX_RANGE_DAYS = 731; // two years, leap included

// GroupBy whitelist — must match the RAISERROR guard at the top of sp_RptTat.
// The SP rejects anything else too, but that surfaces as a 500; the 400 lives here.
const REPORTS = {
  // Task TAT (P4): one basis, the clock's AssignedAt; its own handler in reportController.
  tat: { sp: "sp_RptTat", groupBys: ["person", "priority", "workspace"], bases: ["assigned"] },
};

// Which clocks a TAT headline number counts (sp_RptTatClocks @Metric).
const TAT_METRICS = ["finished", "ontime", "missed", "not_excused", "excused", "no_decision", "reason_pending", "overdue_now"];

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

/** Body -> { from, to } (default last 30 days, at most MAX_RANGE_DAYS), or { error }. */
function parseRange(body = {}, today = new Date()) {
  const to = body.ToDate ?? isoDay(today);
  const toDate = parseDay(to);
  if (!toDate) return { error: "FromDate and ToDate must be YYYY-MM-DD" };
  const from = body.FromDate ?? isoDay(daysBefore(toDate, 29));
  if (!parseDay(from)) return { error: "FromDate and ToDate must be YYYY-MM-DD" };
  if (from > to) return { error: "FromDate must not be after ToDate" };
  // Every report scans tblLeads into a temp table with correlated subqueries
  // per row, so an unbounded window is a free way to pin the database. Two
  // years is well past any reporting need.
  if ((parseDay(to) - parseDay(from)) / 86400000 > MAX_RANGE_DAYS) {
    return { error: `The date range must be ${MAX_RANGE_DAYS} days or less` };
  }
  return { from, to };
}

/**
 * Body -> SP params, or a message for a 400.
 * Defaults: last 30 days (today inclusive), the report's first basis, the report's
 * first GroupBy. Id filters narrow only when they are positive integers.
 */
function parseReportArgs(body = {}, key, today = new Date()) {
  const report = REPORTS[key];
  if (!report) return { error: `Unknown report: ${key}` };
  const range = parseRange(body, today);
  if (range.error) return range;
  const { from, to } = range;

  const { bases } = report;
  const basis = body.DateBasis ?? bases[0];
  if (!bases.includes(basis)) return { error: `DateBasis must be one of ${bases.join(", ")}` };

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

module.exports = { REPORTS, TAT_METRICS, MAX_RANGE_DAYS, parseDay, parseRange, parseReportArgs };
