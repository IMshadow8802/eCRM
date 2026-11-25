// e2e/solartest/calling-fixtures.mjs — a fake Solar-style contact sheet for the
// calling-list runs. Every number is 9000<block><nnn>: clearly fake, and a fresh
// block per run, because an imported number stays in tblCallContact for good
// (re-importing it is "Already in pool").
//
//   node e2e/solartest/calling-fixtures.mjs   → fixtures/solar-contacts.{csv,xlsx} (block 000)
//
// Headers are the client's sheet, exactly. The sheet carries, on purpose:
// in-sheet repeats, bad numbers, an empty Contact with a good Mobile2, two
// numbers in one cell, a number that is already a lead (LEAD: the run creates
// that lead first) and one marked do-not-call (DNC: the run marks it first).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const HEADERS = ["Ref No.", "Name", "Anniversary", "Contact", "Mobile2", "Address", "GroupName", "BranchName"];

const FIRST = ["Ramesh", "Sunita", "Arvind", "Kavita", "Manoj", "Pooja", "Rakesh", "Neelam", "Suresh", "Anjali",
  "Dinesh", "Meena", "Vijay", "Rekha", "Ajay", "Seema", "Pankaj", "Geeta", "Sanjay", "Usha"];
const LAST = ["Verma", "Srivastava", "Mishra", "Tiwari", "Pandey", "Yadav", "Gupta", "Shukla", "Chauhan", "Rastogi"];
const AREAS = ["Gomti Nagar", "Indira Nagar", "Aliganj", "Alambagh", "Hazratganj", "Jankipuram"];

const pad = (n, w) => String(n).padStart(w, "0");

/** The sheet for one block (0..999). `expect` is what an import of it must report. */
export function makeSheet(block = 0) {
  const num = (n) => `9000${pad(block, 3)}${pad(n, 3)}`;
  const rows = [];
  const add = (n, contact, mobile2 = "") => {
    const name = `${FIRST[n % FIRST.length]} ${LAST[(n * 7) % LAST.length]} T${pad(n, 2)}`;   // T<row>: unique, and plainly a test row
    rows.push([`ST-${pad(block, 3)}-${pad(n, 3)}`, name, `${pad((n % 28) + 1, 2)}-${pad((n % 12) + 1, 2)}-20${pad(10 + (n % 15), 2)}`,
      contact, mobile2, `Plot ${n}, ${AREAS[n % AREAS.length]}, Lucknow`, n % 2 ? "Solar Rooftop" : "Residential", "Lucknow"]);
  };
  for (let n = 1; n <= 40; n += 1) add(n, Number(num(n)), n <= 5 ? num(500 + n) : "");
  add(41, Number(num(1)));                 // repeats row 1
  add(42, Number(num(2)));                 // repeats row 2
  add(43, num(3));                         // repeats row 3 (as text)
  add(44, "12345");                        // bad: too short
  add(45, "98765abc");                     // bad
  add(46, "9.00000E+09");                  // bad: Excel already lost the digits
  add(47, "5000000047");                   // bad: starts with 5
  add(48, "", num(48));                    // empty Contact, good Mobile2 → imports on Mobile2
  add(49, "", num(49));
  add(50, `${num(50)} / ${num(51)}`);      // two numbers in one cell → Mobile + Alt mobile
  add(51, Number(num(990)));               // already a lead (the run creates it first)
  add(52, Number(num(991)));               // do-not-call (the run marks it first)
  for (let n = 53; n <= 60; n += 1) add(n, Number(num(n)));

  const pooled = [...Array.from({ length: 40 }, (_, i) => num(i + 1)), num(48), num(49), num(50),
    ...Array.from({ length: 8 }, (_, i) => num(53 + i))];
  return {
    block, headers: HEADERS, rows,
    numbers: {
      pooled,                                   // the 51 that land in the pool
      alts: [1, 2, 3, 4, 5].map((n) => num(500 + n)).concat(num(51)),
      altOnly: [num(48), num(49)],              // Contact empty: Mobile = Mobile2, no alt
      twoInCell: [num(50), num(51)],
      lead: num(990), dnc: num(991),
      all: [...new Set([...pooled, ...[1, 2, 3, 4, 5].map((n) => num(500 + n)), num(51), num(990), num(991)])],
    },
    // What the upload must report: rows the browser drops as repeats, then the server's counts.
    expect: { sheetRows: 60, repeated: 3, sent: 57, Added: 51, BadNumber: 4, IsLead: 1, Dnc: 1, InPool: 0, IsCustomer: 0 },
  };
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (sheet) => [sheet.headers, ...sheet.rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

// ---- a minimal .xlsx (shared strings; numbers as numeric cells, as Excel saves a phone column) ----
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i) => String.fromCharCode(65 + i);

export function toXlsx(sheet) {
  const strings = [];
  const sid = new Map();
  const s = (v) => { if (!sid.has(v)) { sid.set(v, strings.length); strings.push(v); } return sid.get(v); };
  const rowXml = [sheet.headers, ...sheet.rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${col(ci)}${ri + 1}`;
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    if (v === "" || v == null) return "";
    return `<c r="${ref}" t="s"><v>${s(String(v))}</v></c>`;
  }).join("")}</row>`).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`,
  };
  files["xl/sharedStrings.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((t) => `<si><t xml:space="preserve">${xml(t)}</t></si>`).join("")}</sst>`;
  return zip(files);
}

// Stored-deflate zip, stdlib only (zlib.crc32 needs Node >= 22.2).
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const n = Buffer.from(name, "utf8");
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0, 10); head.writeUInt32LE(crc, 14); head.writeUInt32LE(comp.length, 18);
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26); head.writeUInt16LE(0, 28);
    local.push(head, n, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  const count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

/** Writes <dir>/solar-contacts.{csv,xlsx} for a block; returns the sheet. */
export function writeSheet(dir, block = 0) {
  const sheet = makeSheet(block);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "solar-contacts.csv"), toCsv(sheet));
  fs.writeFileSync(path.join(dir, "solar-contacts.xlsx"), toXlsx(sheet));
  return sheet;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
  writeSheet(dir, Number(process.argv[2] ?? 0));
  console.log(`wrote ${dir}/solar-contacts.{csv,xlsx}`);
}
