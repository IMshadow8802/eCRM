import { describe, expect, it, vi } from "vitest";

import {
  buildRows, chunks, cleanNumber, guessMapping, MAX_ROWS, CHUNK, parseCsv, readSheet, splitNumbers, TARGETS,
} from "./sheetParse";

const readXlsx = vi.fn();
vi.mock("read-excel-file/browser", () => ({ readSheet: (...a) => readXlsx(...a) }));

// jsdom's File has no text(); a browser's does.
const csvFile = (text, name) => Object.assign(new File([text], name), { text: async () => text });

describe("sheetParse", () => {
  it("names the targets in order and the limits", () => {
    expect(TARGETS.map((t) => t.value)).toEqual(["Name", "Mobile", "AltMobile", "Company", "City", "State", "Pincode", "Email", "Address", "Dnc", "extra", "ignore"]);
    expect(TARGETS.find((t) => t.value === "extra").label).toBe("Keep as extra");
    expect([MAX_ROWS, CHUNK]).toEqual([50000, 500]);
  });

  it("parses quoted CSV with commas, quotes and newlines inside a field", () => {
    expect(parseCsv('﻿Name,Mobile\r\n"Shah, R ""Raju""","98250\n12345"\r\n\r\n')).toEqual([["Name", "Mobile"], ['Shah, R "Raju"', "98250\n12345"]]);
  });

  it("parses plain LF CSV and a last line without a newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });

  it.each([["9825012345.0", "9825012345"], ["+91 98250-12345", "9825012345"], ["098250 12345", "9825012345"],
    ["9.82501E+09", null], ["0261 2345678", null], ["5825012345", null], ["", null], [null, null]])("cleanNumber(%s) → %s", (a, b) => expect(cleanNumber(a)).toBe(b));

  it("splits two numbers in one cell", () => {
    expect(splitNumbers("98250 12345 / 98980 11111")).toEqual(["9825012345", "9898011111"]);
    expect(splitNumbers("9825012345 or 9898011111")).toEqual(["9825012345", "9898011111"]);
    expect(splitNumbers("9825012345")).toEqual(["9825012345", null]);
    expect(splitNumbers("")).toEqual([null, null]);
  });

  it("guesses the usual headers", () => {
    expect(guessMapping(["Sr", "Party Name", "Company Name", "Mobile No", "Phone 2", "City", "Turnover", "DND"]))
      .toEqual(["extra", "Name", "Company", "Mobile", "AltMobile", "City", "extra", "Dnc"]);
  });

  it("maps a real sheet whose columns are not the usual ones", () => {
    expect(guessMapping(["Ref No.", "Name", "Anniversary", "Contact", "Mobile2", "Address", "GroupName", "BranchName"]))
      .toEqual(["extra", "Name", "extra", "Mobile", "AltMobile", "Address", "extra", "extra"]);
  });

  it("guesses the rest of the targets, each once", () => {
    expect(guessMapping(["Phone", "Mobile", "WhatsApp", "E-mail", "Pin Code", "State", "Town", "City", "Do not call", "Customer Name", "Name"]))
      .toEqual(["Mobile", "AltMobile", "extra", "Email", "Pincode", "State", "City", "extra", "Dnc", "Name", "extra"]);
  });

  it("uses the alt number when the mobile cell is empty or bad, and still catches the repeat", () => {
    const { rows, repeated } = buildRows([["A", "", "98980 11111"], ["B", "n/a", "9898011112"], ["C", "9898011111", ""], ["D", "", ""]],
      ["Name", "Mobile", "AltMobile"], ["Name", "Contact", "Mobile2"]);
    expect(rows.map((r) => [r.RowNo, r.Mobile, r.AltMobile])).toEqual([[1, "9898011111", null], [2, "9898011112", null], [4, "", null]]);
    expect(repeated).toEqual([3]);
  });

  it("builds rows, fills the alt number from a two-number cell, keeps extras, and pulls out repeats", () => {
    const { rows, repeated } = buildRows([["A", "98250 12345 / 98980 11111", "2 Cr"], ["B", "9825012345", ""], ["C", "12", ""]],
      ["Name", "Mobile", "extra"], ["Name", "Mobile", "Turnover"]);
    expect(rows[0]).toMatchObject({ RowNo: 1, Name: "A", Mobile: "9825012345", AltMobile: "9898011111", Extra: { Turnover: "2 Cr" } });
    expect(repeated).toEqual([2]);
    expect(rows[1]).toMatchObject({ RowNo: 3, Mobile: "12", Extra: null }); // bad number travels, the server counts it
  });

  it("keeps a mapped alt column over the second number, and skips ignored columns", () => {
    const { rows } = buildRows([["9825012345 / 9898011111", "9898022222", "x", "Yes"]], ["Mobile", "AltMobile", "ignore", "Dnc"], ["M", "A", "I", "D"]);
    expect(rows[0]).toMatchObject({ Mobile: "9825012345", AltMobile: "9898022222", Dnc: "Yes" });
    expect(rows[0]).not.toHaveProperty("I");
  });

  it("a mapped but empty alt column still takes the second number of the mobile cell", () => {
    const { rows } = buildRows([["9825012345 / 9898011111", ""]], ["Mobile", "AltMobile"], ["M", "A"]);
    expect(rows[0]).toMatchObject({ Mobile: "9825012345", AltMobile: "9898011111" });
  });

  it("chunks by 500", () => expect(chunks(Array.from({ length: 1201 }, (_, i) => ({ RowNo: i }))).map((c) => c.length)).toEqual([500, 500, 201]));

  it("reads a CSV file through the CSV parser", async () => {
    const file = csvFile("Name,Mobile\nA,9825012345\n", "list.csv");
    expect(await readSheet(file)).toEqual({ headers: ["Name", "Mobile"], rows: [["A", "9825012345"]] });
  });

  it("reads an xlsx through read-excel-file, cells as trimmed strings", async () => {
    readXlsx.mockResolvedValueOnce([[" Name ", null, "Joined"], ["A", 9825012345, new Date(2026, 1, 3)], ["B", true, null], [null, null, null]]);
    const file = new File(["x"], "list.xlsx");
    expect(await readSheet(file)).toEqual({ headers: ["Name", "Column 2", "Joined"], rows: [["A", "9825012345", "2026-02-03"], ["B", "true", ""]] });
  });

  it("an empty file has no headers and no rows", async () => {
    expect(await readSheet(csvFile("", "e.csv"))).toEqual({ headers: [], rows: [] });
  });
});
