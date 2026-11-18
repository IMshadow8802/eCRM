// src/pages/Reports/sales/salesReportUtils.js
//
// Pure helpers behind the sales report pages: filters <-> address bar <-> POST
// body, the drill address of every number and its way back into a
// sp_RptSalesRows body, the words on a drill page, the previous-period line,
// and the two CSV exports. No React, so all of it is testable without a DOM.
import dayjs from "dayjs";

import { ANY, rangeLabel, readRange, writeRange } from "../../../utils/datePresets";
import { toCsv } from "../reportUtils";
import { COLUMNS } from "./columns";

// The closed lists of sp_RptSalesRows (backend/src/utils/salesReport.js). Anything else in an address is dropped.
const METRICS = ["new", "call", "visit", "meeting", "other", "visits", "fu_due", "fu_ontime",
  "fu_late", "fu_skipped", "fu_missed", "fu_open", "won", "lost", "open", "all"];
const STATES = ["open", "won", "lost", "junk", "untouched"];
const AGE_BUCKETS = ["0_7", "8_30", "31_90", "90p"];
const FLAGS = ["overdue", "nonext", "stale"];
const ID_KEYS = ["BranchId", "SourceId", "ProductId"];

const idOf = (v) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);
const oneOf = (v, list) => (list.includes(v) ? v : null);
const int = (v) => Number(v).toLocaleString("en-IN");
const plural = (count, one, many) => `${int(count)} ${count === 1 ? one : many}`;

/** Address bar -> { preset, from, to, error, at, BranchId, SourceId, ProductId }. */
export function readFilters(params, report, today = dayjs()) {
  return {
    ...readRange(params, { defaultPreset: report.defaultPreset, allowAny: report.allowAny, today }),
    at: idOf(params.get("at")),
    ...Object.fromEntries(ID_KEYS.map((k) => [k, idOf(params.get(k))])),
  };
}

/** Filters -> address-bar params, defaults left out. */
export function writeFilters(f, report) {
  const out = writeRange(f, { defaultPreset: report.defaultPreset });
  if (f.at) out.at = String(f.at);
  for (const k of ID_KEYS) if (f[k]) out[k] = String(f[k]);
  return out;
}

const dates = (f) => (f.preset === ANY.value || !f.from ? {} : { FromDate: f.from, ToDate: f.to });
const ids = (f) => Object.fromEntries(ID_KEYS.map((k) => [k, f[k] ?? null]));

/** Filters -> the POST body of /api/reports/sales. No dates for Any time. */
export const toBody = (f, report) => ({ GroupBy: report.groupBy, ...dates(f), NodeId: f.at ?? null, ...ids(f) });

// The frame's own params (dates and ids) at the end of every drill address; `at` stays on the summary.
const frameQuery = (report, f) => {
  const { at: _at, ...rest } = writeFilters(f, report);
  return rest;
};
const rowsUrl = (report, filters, head) =>
  `/reports/sales/${report.slug}/rows?${new URLSearchParams({ ...head, ...frameQuery(report, filters) })}`;

// Who a line stands for, in drill params.
function whoOf(report, filters, line) {
  switch (line.LineKind) {
    case "team": return { person: line.GroupKey, rollup: 1 };
    case "own":
    case "person": return { person: line.GroupKey };
    case "unassigned": return { unassigned: 1 };
    case "group": return line.GroupKey == null ? { keynull: 1 } : { key: line.GroupKey };
    case "total": return report.groupBy === "team" && filters.at ? { person: filters.at, rollup: 1 } : {};
    default: return {};
  }
}

/**
 * The rows behind one cell, or null when the column has no drill or the cell
 * is 0 / empty. `line` is an sp_RptSales line, or { LineKind: "total", ...totals }.
 */
export function drillUrl(report, filters, line, column) {
  if (!column.drill || !Number(column.value(line))) return null;
  const { Metric, State, AgeBucket, Flag } = column.drill;
  return rowsUrl(report, filters, {
    metric: Metric, shape: "events", ...whoOf(report, filters, line),
    ...(State ? { state: State } : {}), ...(AgeBucket ? { age: AgeBucket } : {}), ...(Flag ? { flag: Flag } : {}),
  });
}

/** A person's name: their leads for these days, one line each. */
export const leadsOfUrl = (report, filters, line) =>
  rowsUrl(report, filters, { shape: "leads", metric: "all", person: line.GroupKey });

/** Drill address -> the drill half of a sp_RptSalesRows body. */
export function readDrill(params) {
  return {
    Metric: oneOf(params.get("metric"), METRICS),
    Shape: params.get("shape") === "leads" ? "leads" : "events",
    PersonId: idOf(params.get("person")),
    Rollup: params.get("rollup") === "1",
    Unassigned: params.get("unassigned") === "1",
    GroupKey: idOf(params.get("key")),
    GroupKeyIsNull: params.get("keynull") === "1",
    State: oneOf(params.get("state"), STATES),
    AgeBucket: oneOf(params.get("age"), AGE_BUCKETS),
    Flag: oneOf(params.get("flag"), FLAGS),
  };
}

/** The POST body of /api/reports/salesRows. */
export const drillBody = (report, filters, drill) => ({ GroupBy: report.groupBy, ...dates(filters), ...drill, ...ids(filters) });

/** "New · 2 calls · 1 follow-up missed" on a per-lead line, each part with its colour-key hue. */
export function whyParts(r) {
  const parts = [];
  if (r.NNew) parts.push({ text: "New", k: "new" });
  if (r.NCalls) parts.push({ text: plural(r.NCalls, "call", "calls"), k: "call" });
  if (r.NVisits) parts.push({ text: plural(r.NVisits, "visit or meeting", "visits or meetings"), k: "visit" });
  if (r.NOther) parts.push({ text: plural(r.NOther, "other follow-up", "other follow-ups"), k: "stock" });
  if (r.NMissed) parts.push({ text: plural(r.NMissed, "follow-up missed", "follow-ups missed"), k: "late" });
  if (r.NWon) parts.push({ text: "won", k: "won" });
  if (r.NLost) parts.push({ text: "lost", k: "lost" });
  // A due follow-up is only worth saying when nothing done already explains the line.
  if (!parts.length && r.NDue) parts.push({ text: plural(r.NDue, "follow-up due", "follow-ups due"), k: "stock" });
  return parts;
}

const TITLE = {
  new: ["new lead", "new leads"], call: ["call", "calls"], visit: ["visit", "visits"], meeting: ["meeting", "meetings"],
  visits: ["visit or meeting", "visits & meetings"], other: ["other follow-up done", "other follow-ups done"],
  fu_due: ["follow-up due", "follow-ups due"], fu_ontime: ["follow-up done on time", "follow-ups done on time"],
  fu_late: ["follow-up done late", "follow-ups done late"], fu_skipped: ["follow-up skipped", "follow-ups skipped"],
  fu_missed: ["follow-up missed", "follow-ups missed"], fu_open: ["follow-up still open", "follow-ups still open"],
  won: ["deal won", "deals won"], lost: ["lead lost", "leads lost"], open: ["open lead", "open leads"], all: ["lead", "leads"],
};
const STATE_WORDS = { open: "still open", won: "won by now", lost: "lost by now", junk: "marked junk" };
const AGE_WORDS = { "0_7": "0–7 days old", "8_30": "8–30 days old", "31_90": "31–90 days old", "90p": "90+ days old" };
const FLAG_WORDS = { overdue: "overdue", nonext: "with no next follow-up", stale: "not touched 7+ days" };

/** "93 follow-ups missed", "4 leads not contacted yet", "12 open leads overdue". */
export function drillTitle(d, total) {
  if (d.Metric === "new" && d.State === "untouched") return plural(total, "lead not contacted yet", "leads not contacted yet");
  const [one, many] = TITLE[d.Metric] ?? ["row", "rows"];
  const tail = [STATE_WORDS[d.State], AGE_WORDS[d.AgeBucket], FLAG_WORDS[d.Flag]].filter(Boolean);
  return [plural(total, one, many), ...tail].join(" ");
}

/** "Previous period · Aug 2026" for a whole month, else the range ("16 Nov 2026", "9 – 15 Nov 2026"). */
export function previousLabel(range) {
  const a = dayjs(range.from);
  const wholeMonth = a.date() === 1 && range.to === a.endOf("month").format("YYYY-MM-DD");
  return `Previous period · ${wholeMonth ? a.format("MMM YYYY") : rangeLabel(range)}`;
}

/** Now against before: "+79" better / "−12" worse, "flat" when up is neither good nor bad. Equal or missing: no text. */
export function diffOf(now, before, goodUp) {
  if (now == null || before == null) return { text: "", tone: "flat" };
  const d = Math.round((Number(now) - Number(before)) * 100) / 100;
  if (!d) return { text: "", tone: "flat" };
  const text = `${d > 0 ? "+" : "−"}${int(Math.abs(d))}`;
  return { text, tone: goodUp == null ? "flat" : d > 0 === goodUp ? "better" : "worse" };
}

/** "Neha Kulkarni!" -> "neha-kulkarni". */
export const slug = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** team-report_neha-kulkarni_2026-11-17.csv · lead-sources_2026-11-01_2026-11-30.csv · open-leads_any-time.csv */
export function exportName(report, filters, personName) {
  const when = !filters.from ? "any-time" : filters.from === filters.to ? filters.from : `${filters.from}_${filters.to}`;
  // "Amit Singh (Exec HO, under Neha)" -> amit-singh: a bracketed role is not part of the name.
  const name = personName && slug(personName.replace(/\s*\([^)]*\)\s*$/, ""));
  return [report.fileKey, name, when].filter(Boolean).join("_") + ".csv";
}

const BOM = "﻿";

// Money is the plain number so Excel sums it; percent and days to one decimal.
const csvCell = (column, v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return column.format === "pct" || column.format === "days" ? Number(v).toFixed(1) : Number(v);
};

/** Every column of the report (shown, then export-only), the lines, Total, and the previous period. */
export function summaryCsv(report, lines, totals, previous) {
  const columns = [...report.columns, ...report.exportOnly].map((k) => COLUMNS[k]);
  const head = [{ key: "__label", header: report.firstHeader }, ...columns];
  // A "now" number has no previous value: the previous line leaves it blank.
  const row = (label, line, t, skipNow = false) => ({
    __label: label,
    ...Object.fromEntries(columns.map((c) => [c.key, skipNow && c.now ? null : csvCell(c, c.value(line, t))])),
  });
  const rows = lines.map((l) => row(l.LineKind === "own" ? `${l.GroupLabel} — own leads` : l.GroupLabel, l, totals));
  rows.push(row("Total", totals, totals));
  if (previous) rows.push(row(previousLabel(previous.range), previous.totals, previous.totals, true));
  return BOM + toCsv(head, rows);
}

/** A drill page's export: the table's columns, its rows, then the footer row if any. */
export const rowsCsv = (columns, rows, footer) => BOM + toCsv(columns, footer ? [...rows, footer] : rows);
