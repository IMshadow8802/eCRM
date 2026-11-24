// src/utils/callingImport.js
//
// Cleans one chunk of sheet rows for sp_ImportCallContacts (149). Pure. The web
// parses the sheet; this is the trust boundary, so every row passes here again.
const { normalizeMobile } = require("./mobile");

const MAX_CHUNK = 500;
const SIZES = { Name: 200, Company: 200, City: 100, State: 100, Pincode: 10, Email: 150, Address: 500 };
const DNC_YES = new Set(["true", "1", "yes", "y", "dnd", "dnc"]);
const MAX_EXTRAS = 20;

const text = (v, n) => {
  const s = v == null ? "" : String(v).trim();
  return s ? s.slice(0, n) : null;
};

// Ten digits starting 6-9, or null. "9825012347.0" is a number Excel stored as a float;
// "9.82501E+09" already lost its digits in the file, so it is refused.
function cleanMobile(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/e\+?\d+$/i.test(s)) return null;
  const m = normalizeMobile(s.replace(/\.0+$/, ""));
  return m && /^[6-9]/.test(m) ? m : null;
}

function cleanExtra(extra) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const out = {};
  for (const [k, v] of Object.entries(extra)) {
    if (Object.keys(out).length >= MAX_EXTRAS) break;
    const label = text(k, 60);
    const value = typeof v === "string" || typeof v === "number" ? text(v, 200) : null;
    if (label && value) out[label] = value;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

function cleanRows(rows = []) {
  return rows.map((r) => {
    let Mobile = cleanMobile(r.Mobile);
    let AltMobile = cleanMobile(r.AltMobile);
    // Owner rule 2026-11-24: an unusable Mobile beside a good Alt mobile uses the Alt mobile.
    if (!Mobile && AltMobile) [Mobile, AltMobile] = [AltMobile, null];
    if (AltMobile === Mobile) AltMobile = null;
    const texts = Object.fromEntries(Object.entries(SIZES).map(([k, n]) => [k, text(r[k], n)]));
    return {
      RowNo: r.RowNo, ...texts, Mobile, AltMobile,
      Dnc: DNC_YES.has(String(r.Dnc ?? "").trim().toLowerCase()) ? 1 : 0,
      Extra: cleanExtra(r.Extra),
    };
  });
}

module.exports = { cleanRows, MAX_CHUNK };
