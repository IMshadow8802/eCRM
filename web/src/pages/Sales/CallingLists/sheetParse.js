// src/pages/Sales/CallingLists/sheetParse.js
//
// Reads an uploaded contact sheet in the browser and turns it into rows for
// POST /api/calling/importContacts. Pure apart from readSheet. The backend
// cleans every row again (utils/callingImport.js) — this is the courtesy pass
// that lets the modal show what will happen before anything is sent.
// read-excel-file is imported ONLY inside readSheet, so it lands in this
// modal's lazy chunk and nowhere else.
import { normalizeMobile } from "../../../utils/mobile";

export const TARGETS = [
  { value: "Name", label: "Name" },
  { value: "Mobile", label: "Mobile" },
  { value: "AltMobile", label: "Alt mobile" },
  { value: "Company", label: "Company" },
  { value: "City", label: "City" },
  { value: "State", label: "State" },
  { value: "Pincode", label: "Pincode" },
  { value: "Email", label: "Email" },
  { value: "Address", label: "Address" },
  { value: "Dnc", label: "Do not call" },
  { value: "extra", label: "Keep as extra" },
  { value: "ignore", label: "Ignore" },
];
export const MAX_ROWS = 50000;
export const CHUNK = 500;
const FIELDS = ["Name", "Company", "City", "State", "Pincode", "Email", "Address", "Dnc"];

/** RFC 4180: quoted fields, "" escape, separators and newlines inside quotes, CRLF, BOM, trailing blank lines. */
export function parseCsv(text) {
  const s = String(text ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

const pad = (n) => String(n).padStart(2, "0");
// Local calendar day, never toISOString() (UTC rolls an IST date back).
const cellText = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v).trim();
};

/** { headers, rows } from a .csv or .xlsx File; the first row is the header. */
export async function readSheet(file) {
  const csv = /\.csv$/i.test(file.name ?? "") || file.type === "text/csv";
  const raw = csv ? parseCsv(await file.text()) : await (await import("read-excel-file/browser")).readSheet(file);
  const all = raw.map((r) => r.map(cellText));
  while (all.length && all[all.length - 1].every((c) => c === "")) all.pop();
  if (!all.length) return { headers: [], rows: [] };
  const headers = all[0].map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows: all.slice(1) };
}

const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const RULES = [
  ["Mobile", (h) => /\b(mobile|phone|cell|whatsapp)/.test(h) || /\bcontact (no|number)\b/.test(h) || h === "contact"],
  ["Company", (h) => /\b(company|firm|shop|business)/.test(h)],
  ["Name", (h) => h === "name" || (/\b(party|customer|client|person|contact|full)/.test(h) && /name\b/.test(h))],
  ["City", (h) => /\b(city|town)/.test(h)],
  ["State", (h) => /\bstate\b/.test(h)],
  ["Pincode", (h) => /\bpin/.test(h)],
  ["Email", (h) => /mail/.test(h)],
  ["Address", (h) => /address/.test(h)],
  ["Dnc", (h) => /\b(dnd|dnc|do not call)\b/.test(h)],
];

/** One target per column, guessed from the header. Only a starting point: the user maps the rest. */
export function guessMapping(headers) {
  const used = new Set();
  return headers.map((raw) => {
    const h = norm(raw);
    const rule = RULES.find(([, test]) => test(h));
    if (!rule) return "extra";
    let target = rule[0];
    if (target === "Mobile" && used.has("Mobile")) target = "AltMobile";
    if (used.has(target)) return "extra";
    used.add(target);
    return target;
  });
}

/** Ten digits starting 6–9, or null. "9825012345.0" is a float Excel kept; "9.82501E+09" already lost digits. */
export function cleanNumber(cell) {
  if (cell == null) return null;
  const s = String(cell).trim();
  if (!s || /e\+?\d+$/i.test(s)) return null;
  const m = normalizeMobile(s.replace(/\.0+$/, ""));
  return m && /^[6-9]/.test(m) ? m : null;
}

/** "98250 12345 / 98980 11111" → ["9825012345", "9898011111"]: the first two good numbers in the cell. */
export function splitNumbers(cell) {
  const good = String(cell ?? "").split(/\s*(?:[/,;|]|\bor\b)\s*/i).map(cleanNumber).filter(Boolean);
  return [good[0] ?? null, good[1] ?? null];
}

/**
 * Sheet rows → import rows. A row whose clean number already appeared earlier is
 * left out and its RowNo returned in `repeated`. An unusable Mobile travels as
 * typed so the server counts it as a bad number — unless the Alt mobile is good,
 * which then becomes the number (owner rule 2026-11-24).
 */
export function buildRows(rows, mapping, headers) {
  const seen = new Set();
  const out = [];
  const repeated = [];
  rows.forEach((cells, i) => {
    const row = { RowNo: i + 1, Name: null, Mobile: "", AltMobile: null, Company: null, City: null, State: null, Pincode: null, Email: null, Address: null, Dnc: null, Extra: null };
    const extra = {};
    let altRaw = "";
    mapping.forEach((target, j) => {
      const v = cellText(cells[j]);
      if (target === "extra") { if (v) extra[headers[j]] = v; }
      else if (target === "Mobile") row.Mobile = v;
      else if (target === "AltMobile") altRaw = v;
      else if (FIELDS.includes(target)) row[target] = v || null;
    });
    const [m1, m2] = splitNumbers(row.Mobile);
    const alt = splitNumbers(altRaw)[0];
    if (m1) { row.Mobile = m1; row.AltMobile = alt ?? m2; }
    else if (alt) { row.Mobile = alt; row.AltMobile = null; }
    if (Object.keys(extra).length) row.Extra = extra;
    const clean = cleanNumber(row.Mobile);
    if (clean && seen.has(clean)) { repeated.push(row.RowNo); return; }
    if (clean) seen.add(clean);
    out.push(row);
  });
  return { rows: out, repeated };
}

export const chunks = (rows, size = CHUNK) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
