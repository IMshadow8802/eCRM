// A mobile number is ten digits — the same rule, word for word, as
// backend/src/utils/mobile.js. The backend is what ENFORCES it (and the DB
// CHECK behind that); this only stops someone typing a wrong one in the first
// place, and lets a form say so before a round-trip.
import * as z from "zod";

export const MOBILE_MESSAGE = "Mobile number must be 10 digits";

/** "+91 98250-12345" → "9825012345". Anything that is not ten digits afterwards → null. */
export function normalizeMobile(raw) {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** A zod string that parses to the normalised ten digits, or "" when blank and optional. */
export const mobileSchema = ({ required = false, label = "Mobile number" } = {}) =>
  z.string().optional().transform((v) => (v ?? "").trim()).superRefine((v, ctx) => {
    if (v === "") {
      if (required) ctx.addIssue({ code: "custom", message: `${label} is required` });
      return;
    }
    if (!normalizeMobile(v)) ctx.addIssue({ code: "custom", message: `${label} must be 10 digits` });
  }).transform((v) => (v === "" ? "" : normalizeMobile(v) ?? v));
