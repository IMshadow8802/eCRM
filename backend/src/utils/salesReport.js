// src/utils/salesReport.js
//
// Argument parsing and period maths for the sales report endpoints, which run
// sp_RptSales (summary lines) and sp_RptSalesRows (the rows behind one number).
// The closed lists here mirror the RAISERROR guards in those procs (sql/122
// §4, §5): the proc rejects anything else too, but that is a 500. The 400
// comes from here.

const { parseRange, parseDay } = require("./reportKit");
const { positiveInt } = require("./controllerKit");

const GROUP_BYS = ["team", "source", "person", "reason"];
// sp_RptSalesRows @Metric: visits = visit + meeting, fu_due = the five fu_*, all = everything but open.
const METRICS = ["new", "call", "visit", "meeting", "other", "visits", "fu_due", "fu_ontime",
  "fu_late", "fu_skipped", "fu_missed", "fu_open", "won", "lost", "open", "all"];
const SHAPES = ["events", "leads"];
const STATES = ["open", "won", "lost", "junk", "untouched"];
const AGE_BUCKETS = ["0_7", "8_30", "31_90", "90p"];
const FLAGS = ["overdue", "nonext", "stale"];
const MAX_ROWS = 2000;          // drill cap; the controller clamps MaxRows to it
const PREVIOUS_MAX_DAYS = 92;   // the previous-period line is skipped over this

// Every numeric RS1 column of sp_RptSales (not GroupKey/TeamSize/IsActive/NoManager/Ord).
const SUM_KEYS = ["New", "Calls", "Visits", "Meetings", "Other",
  "FuOnTime", "FuLate", "FuSkipped", "FuMissed", "FuOpen",
  "Won", "WonValue", "Lost", "LostValue", "OpenNow", "OpenValue",
  "OverdueNow", "NoNext", "Stale", "Age0_7", "Age8_30", "Age31_90", "Age90Plus",
  "CohortOpen", "CohortWon", "CohortWonValue", "CohortLost", "CohortJunk", "CohortUntouched",
  "DaysOpenSum", "DaysOpenN"];

const pad = (n) => String(n).padStart(2, "0");
// Local calendar day, never toISOString() (UTC rolls IST mornings back a day).
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const bit = (v) => (v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);
const oneOf = (name, value, list) =>
  value == null || list.includes(value) ? null : `${name} must be one of ${list.join(", ")}`;

/** Inclusive day count of two ISO days. Rounded, so a DST hour cannot shave a day. */
const rangeDays = (from, to) => Math.round((parseDay(to) - parseDay(from)) / 86400000) + 1;

/**
 * The period just before [from, to]. Whole calendar months map to as many
 * whole months before (Mar -> Feb, whatever their lengths); anything else to
 * the same number of days ending the day before `from`.
 */
function previousRange(from, to) {
  const f = parseDay(from);
  const t = parseDay(to);
  const wholeMonths = f.getDate() === 1 && addDays(t, 1).getDate() === 1;
  if (wholeMonths) {
    const months = (t.getFullYear() - f.getFullYear()) * 12 + t.getMonth() - f.getMonth() + 1;
    return {
      from: isoDay(new Date(f.getFullYear(), f.getMonth() - months, 1)),
      to: isoDay(addDays(f, -1)),
    };
  }
  const prevTo = addDays(f, -1);
  return { from: isoDay(addDays(prevTo, 1 - rangeDays(from, to))), to: isoDay(prevTo) };
}

/**
 * Body -> { args } for sp_RptSales (or sp_RptSalesRows with rows: true), or { error } for a 400.
 * Dates: both or neither. Neither = yesterday, except GroupBy 'person' (Open leads) = any time (null).
 */
function parseSalesArgs(body, { rows = false, today = new Date() } = {}) {
  const b = body ?? {};
  const GroupBy = b.GroupBy ?? "team";
  const groupErr = oneOf("GroupBy", GroupBy, GROUP_BYS);
  if (groupErr) return { error: groupErr };

  let FromDate = null;
  let ToDate = null;
  const hasFrom = b.FromDate != null;
  const hasTo = b.ToDate != null;
  if (hasFrom !== hasTo) return { error: "FromDate and ToDate go together" };
  if (hasFrom) {
    const range = parseRange(b, today);
    if (range.error) return range;
    ({ from: FromDate, to: ToDate } = range);
  } else if (GroupBy !== "person") {
    FromDate = ToDate = isoDay(addDays(today, -1));
  }

  const filters = {
    BranchId: positiveInt(b.BranchId),
    SourceId: positiveInt(b.SourceId),
    ProductId: positiveInt(b.ProductId),
  };
  if (!rows) return { args: { FromDate, ToDate, GroupBy, NodeId: positiveInt(b.NodeId), ...filters } };

  const Metric = b.Metric;
  const Shape = b.Shape ?? "events";
  const State = b.State ?? null;
  const AgeBucket = b.AgeBucket ?? null;
  const Flag = b.Flag ?? null;
  const listErr = (Metric == null ? `Metric must be one of ${METRICS.join(", ")}` : oneOf("Metric", Metric, METRICS))
    ?? oneOf("Shape", Shape, SHAPES)
    ?? oneOf("State", State, STATES)
    ?? oneOf("AgeBucket", AgeBucket, AGE_BUCKETS)
    ?? oneOf("Flag", Flag, FLAGS);
  if (listErr) return { error: listErr };

  const PersonId = positiveInt(b.PersonId);
  const Rollup = bit(b.Rollup);
  // ponytail: Metric 'all' is only the per-lead view; the proc would take it as events too, the UI never asks.
  if ((Shape === "leads" || Metric === "all") && (Shape !== "leads" || Metric !== "all" || !PersonId || Rollup)) {
    return { error: "Shape leads needs Metric all and a PersonId, without Rollup" };
  }

  return {
    args: {
      FromDate, ToDate, GroupBy, ...filters,
      Metric, Shape, PersonId, Rollup,
      Unassigned: bit(b.Unassigned),
      GroupKey: positiveInt(b.GroupKey),
      GroupKeyIsNull: bit(b.GroupKeyIsNull),
      State, AgeBucket, Flag,
    },
  };
}

/**
 * Sum of every SUM_KEYS column over the lines (mssql returns DECIMAL as a string or number; null = 0).
 * Rounded to paise so float drift (0.1 + 0.2) never reaches a money total; counts are unaffected.
 */
const sumRows = (lines) =>
  Object.fromEntries(SUM_KEYS.map((k) =>
    [k, Math.round(lines.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100]));

module.exports = {
  GROUP_BYS, METRICS, SHAPES, STATES, AGE_BUCKETS, FLAGS, MAX_ROWS, PREVIOUS_MAX_DAYS, SUM_KEYS,
  parseSalesArgs, previousRange, rangeDays, sumRows,
};
