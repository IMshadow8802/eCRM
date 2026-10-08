// Soft checks on a shift's 7 days. Shown as warnings, never blocking (spec 5).
const ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

// [1,2,3,4,5] -> "Mon–Fri"; [1,3] -> "Mon, Wed"; a run of two is listed, not ranged.
export function dayRange(days) {
  const idx = ORDER.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
  const parts = [];
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (idx[j + 1] === idx[j] + 1) j += 1;
    const [a, b] = [ABBR[ORDER[idx[i]]], ABBR[ORDER[idx[j]]]];
    parts.push(j - i >= 2 ? `${a}–${b}` : j > i ? `${a}, ${b}` : a);
    i = j + 1;
  }
  return parts.join(", ");
}

const mins = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};
const NIGHT_START = 21 * 60;
const NIGHT_END = 6 * 60;

export default function shiftWarnings(days = []) {
  // One line per kind of problem, listing every day it applies to.
  const byKind = new Map();
  const flag = (text, d) => byKind.set(text, [...(byKind.get(text) ?? []), d]);
  let week = 0;
  for (const day of days) {
    if (!day?.on || !day.start || !day.end) continue;
    const s = mins(day.start);
    let e = mins(day.end);
    if (e <= s) e += 1440; // runs past midnight
    const brk = day.breakStart && day.breakEnd ? Math.max(0, mins(day.breakEnd) - mins(day.breakStart)) : 0;
    const worked = e - s - brk;
    week += worked;
    if (worked > 9 * 60) flag("> 9 hours", day.d);
    if (!brk && e - s > 5 * 60) flag("No break after 5 hours", day.d);
    if (s < NIGHT_END || e > NIGHT_START) {
      flag("Night hours (21:00–06:00)", day.d);
    }
  }
  const out = [...byKind].map(([text, ds]) =>
    `${text} on ${dayRange(ds)}${text.startsWith("Night") ? " — check the rules for women staff" : ""}`);
  if (week > 48 * 60) out.push("> 48 hours a week");
  return out;
}
