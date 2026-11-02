// A mobile number is ten digits — the same rule, word for word, as
// backend/src/utils/mobile.js (which enforces it) and web/src/utils/mobile.js.

/** "+91 98250-12345" → "9825012345". Anything that is not ten digits afterwards → null. */
export function normalizeMobile(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}
