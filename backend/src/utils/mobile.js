// src/utils/mobile.js
//
// A mobile number is ten digits. That was never written down anywhere, so
// nothing enforced it: the lead form checked "not empty", sp_SaveLead stored
// what it was given, and sp_SaveCustomer stripped spaces but still accepted
// '+' and any length. tblCustomer ended up holding '+919310500657', '111' and
// '44774445555' on the one column whose job is telling two customers apart —
// and sp_ConvertLead (091) matches on it.
//
// This is the one place a number is made right. The web's input is a
// convenience and the DB CHECK constraint is a backstop; the backend is the
// trust boundary, so the mobile app and any future caller get this for free.

const MOBILE_MESSAGE = "Mobile number must be 10 digits";

/** "+91 98250-12345" → "9825012345". Anything that is not ten digits afterwards → null. */
function normalizeMobile(raw) {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * Normalises the named fields in place. Blank stays null (a mobile is optional
 * wherever this is used); a value that cannot be made into ten digits returns
 * the sentence to 400 with, and leaves the rest untouched.
 *
 * @param {object} fields
 * @param {Array<[string, string]>} pairs  [key, human label]
 * @returns {string|null} error message, or null
 */
function applyMobiles(fields, pairs) {
  for (const [key, label] of pairs) {
    const raw = fields[key];
    if (raw == null || String(raw).trim() === "") {
      fields[key] = null;
      continue;
    }
    const value = normalizeMobile(raw);
    if (!value) return `${label} must be 10 digits`;
    fields[key] = value;
  }
  return null;
}

module.exports = { normalizeMobile, applyMobiles, MOBILE_MESSAGE };
