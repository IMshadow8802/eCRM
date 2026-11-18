// Date presets for the Leads list's Created filter — the web's six
// (web/src/utils/datePresets.js), same labels. Dates are local 'YYYY-MM-DD'
// built from local parts, never toISOString() (UTC rolls the day back in IST).
// A week runs Monday to Sunday; a preset is a whole period.

export type DatePreset = "any" | "today" | "yesterday" | "week" | "month" | "lastMonth" | "custom";
export type DateRange = { from: string; to: string };

export const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom" },
];
export const ANY: { value: DatePreset; label: string } = { value: "any", label: "Any time" };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// new Date(y, m, d) normalises overflow: day 0 is the last day of the month before.
const span = (y: number, m: number, a: number, b: number): DateRange => ({ from: ymd(new Date(y, m, a)), to: ymd(new Date(y, m, b)) });

export function presetRange(preset: DatePreset, today = new Date()): DateRange | null {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  switch (preset) {
    case "today": return span(y, m, d, d);
    case "yesterday": return span(y, m, d - 1, d - 1);
    case "week": { const mon = d - ((today.getDay() + 6) % 7); return span(y, m, mon, mon + 6); }
    case "month": return span(y, m, 1, new Date(y, m + 1, 0).getDate());
    case "lastMonth": return span(y, m - 1, 1, new Date(y, m, 0).getDate());
    default: return null;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "17 Nov 2026" · "1 – 30 Nov 2026" · "28 Oct – 3 Nov 2026" · "30 Dec 2025 – 5 Jan 2026"
export function rangeLabel({ from, to }: DateRange): string {
  const [ay, am, ad] = from.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = to.split("-").map(Number) as [number, number, number];
  const end = `${bd} ${MONTHS[bm - 1]} ${by}`;
  if (from === to) return end;
  if (ay !== by) return `${ad} ${MONTHS[am - 1]} ${ay} – ${end}`;
  if (am === bm) return `${ad} – ${end}`;
  return `${ad} ${MONTHS[am - 1]} – ${end}`;
}
