// Date presets for the sales reports and the Leads list. Dates are local
// 'YYYY-MM-DD' strings (dayjs format, never toISOString). A week runs Monday
// to Sunday; a preset is always a whole period (this month runs to its last day).
import dayjs from "dayjs";

const F = "YYYY-MM-DD";

export const PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom" },
];
export const ANY = { value: "any", label: "Any time" };

const span = (a, b) => ({ from: a.format(F), to: b.format(F) });

export function presetRange(preset, today = dayjs()) {
  const d = today.startOf("day");
  switch (preset) {
    case "today": return span(d, d);
    case "yesterday": { const y = d.subtract(1, "day"); return span(y, y); }
    case "week": { const mon = d.subtract((d.day() + 6) % 7, "day"); return span(mon, mon.add(6, "day")); }
    case "month": return span(d.startOf("month"), d.endOf("month"));
    case "lastMonth": { const m = d.subtract(1, "month"); return span(m.startOf("month"), m.endOf("month")); }
    default: return null;
  }
}

// "17 Nov 2026" · "1 – 30 Nov 2026" · "28 Oct – 3 Nov 2026" · "30 Dec 2025 – 5 Jan 2026"
export function rangeLabel({ from, to }) {
  const a = dayjs(from), b = dayjs(to);
  if (from === to) return a.format("D MMM YYYY");
  if (!a.isSame(b, "year")) return `${a.format("D MMM YYYY")} – ${b.format("D MMM YYYY")}`;
  if (a.isSame(b, "month")) return `${a.format("D")} – ${b.format("D MMM YYYY")}`;
  return `${a.format("D MMM")} – ${b.format("D MMM YYYY")}`;
}

// The compact form used beside a preset and on the apply button: one day is
// "17-11-2026"; a span in the current year drops the year ("16 – 22 Nov").
export function shortRangeLabel(range, today = dayjs()) {
  if (range.from === range.to) return dayjs(range.from).format("DD-MM-YYYY");
  const long = rangeLabel(range);
  const y = ` ${today.year()}`;
  return dayjs(range.from).year() === today.year() && long.endsWith(y) ? long.slice(0, -y.length) : long;
}

const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayjs(s).format(F) === s;

function resolve(preset, today) {
  return preset === ANY.value ? { preset, from: null, to: null, error: null } : { preset, ...presetRange(preset, today), error: null };
}

// URL → { preset, from, to, error }. Anything unreadable falls back to the default.
export function readRange(params, { key = "preset", defaultPreset, allowAny = false, today = dayjs() } = {}) {
  const p = params.get(key);
  if (p === "custom") {
    const from = params.get("from"), to = params.get("to");
    if (isDay(from) && isDay(to)) return { preset: "custom", from, to, error: to < from ? "To is before From" : null };
  } else if (p && (presetRange(p, today) || (allowAny && p === ANY.value))) {
    return resolve(p, today);
  }
  return resolve(defaultPreset, today);
}

// { preset, from, to } → URL params. The default is left out; from/to only for custom.
export function writeRange(value, { key = "preset", defaultPreset } = {}) {
  if (value.preset === defaultPreset) return {};
  if (value.preset === "custom") return { [key]: "custom", from: value.from, to: value.to };
  return { [key]: value.preset };
}
