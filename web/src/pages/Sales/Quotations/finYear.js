// The Indian financial year runs 1 April → 31 March. Quotation numbers restart
// with it: QT-2627-0001 is the first quote finalised on or after 2026-04-01.
// The SP stamps the real number; this is only for labels and the preview.

const two = (y) => String(y % 100).padStart(2, "0");

/** "2627" for any date in FY 2026-27. Accepts a Date or a YYYY-MM-DD string. */
export function finYear(value = new Date()) {
  // A bare date string is read as local Y/M/D — `new Date("2026-04-01")` is UTC
  // midnight, which in IST is still 31 March for the first 5½ hours of the day.
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${two(start)}${two(start + 1)}`;
}

/** "2026-27" */
export const finYearLabel = (value) => {
  const fy = finYear(value);
  return fy ? `20${fy.slice(0, 2)}-${fy.slice(2)}` : "";
};
