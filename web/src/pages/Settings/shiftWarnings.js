// Soft checks on a shift's 7 days. Shown as warnings, never blocking (spec 5).
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const mins = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};
const NIGHT_START = 21 * 60;
const NIGHT_END = 6 * 60;

export default function shiftWarnings(days = []) {
  const out = [];
  let week = 0;
  for (const day of days) {
    if (!day?.on || !day.start || !day.end) continue;
    const name = NAMES[day.d];
    const s = mins(day.start);
    let e = mins(day.end);
    if (e <= s) e += 1440; // runs past midnight
    const brk = day.breakStart && day.breakEnd ? Math.max(0, mins(day.breakEnd) - mins(day.breakStart)) : 0;
    const worked = e - s - brk;
    week += worked;
    if (worked > 9 * 60) out.push(`> 9 hours on ${name}`);
    if (!brk && e - s > 5 * 60) out.push(`No break after 5 hours on ${name}`);
    if (s < NIGHT_END || e > NIGHT_START) {
      out.push(`Night hours (21:00–06:00) on ${name} — check the rules for women staff`);
    }
  }
  if (week > 48 * 60) out.push("> 48 hours a week");
  return out;
}
