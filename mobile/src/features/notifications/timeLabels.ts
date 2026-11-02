// The device's local clock (IST on every phone here). Never Intl: Hermes and
// jest disagree on its output, and these strings are E's exact shapes.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9:28 am", "2:05 pm". */
export function clockTime(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "Sun, 1 Nov". */
export const shortDate = (d: Date): string => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** Same local calendar day. */
export const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
