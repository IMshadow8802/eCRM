const { cleanRows, MAX_CHUNK } = require("../../../src/utils/callingImport");

describe("cleanRows", () => {
  it("normalises the number forms a sheet produces", () => {
    const out = cleanRows([{ RowNo: 1, Mobile: "+91 98250-12345" }, { RowNo: 2, Mobile: "09825012346" },
      { RowNo: 3, Mobile: "9825012347.0" }, { RowNo: 4, Mobile: 9825012348 }]);
    expect(out.map((r) => r.Mobile)).toEqual(["9825012345", "9825012346", "9825012347", "9825012348"]);
  });
  it("refuses a landline, a short number, a first digit below 6 and an exponent", () => {
    expect(cleanRows([{ RowNo: 1, Mobile: "02612345678" }, { RowNo: 2, Mobile: "98250" }, { RowNo: 3, Mobile: "5825012345" },
      { RowNo: 4, Mobile: "9.82501E+09" }]).map((r) => r.Mobile)).toEqual([null, null, null, null]);
  });
  it("keeps the row when only the alternate number is bad", () => {
    expect(cleanRows([{ RowNo: 1, Mobile: "9825012345", AltMobile: "123" }])[0]).toMatchObject({ Mobile: "9825012345", AltMobile: null });
  });
  it("uses the alternate number when the mobile cell is empty or bad", () => {
    const out = cleanRows([{ RowNo: 1, Mobile: "", AltMobile: "98980 11111" }, { RowNo: 2, Mobile: "0261 2345678", AltMobile: "+91 9898011112" },
      { RowNo: 3, Mobile: null, AltMobile: "123" }]);
    expect(out.map((r) => [r.Mobile, r.AltMobile])).toEqual([["9898011111", null], ["9898011112", null], [null, null]]);
  });
  it("drops an alternate number equal to the mobile", () => {
    expect(cleanRows([{ RowNo: 1, Mobile: "9825012345", AltMobile: "09825012345" }])[0].AltMobile).toBeNull();
  });
  it("reads a do-not-call column", () => {
    const vals = ["Yes", "", "y", "DND", "dnc", true, 1, "1", "no", 0, undefined];
    expect(cleanRows(vals.map((Dnc, i) => ({ RowNo: i, Mobile: "9825012345", Dnc }))).map((r) => r.Dnc))
      .toEqual([1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0]);
  });
  it("bounds the extra columns and keeps them valid JSON", () => {
    const Extra = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Col "${i}": x${"y".repeat(80)}`, "v".repeat(3000)]));
    const parsed = JSON.parse(cleanRows([{ RowNo: 1, Mobile: "9825012345", Extra }])[0].Extra);
    expect(Object.keys(parsed)).toHaveLength(20);
    expect(Object.keys(parsed)[0]).toHaveLength(60);
    expect(Object.values(parsed)[0]).toHaveLength(200);
  });
  it("keeps only string and number extra values", () => {
    const Extra = { A: "x", B: 5, C: { nested: 1 }, D: ["a"], E: true, F: null };
    expect(JSON.parse(cleanRows([{ RowNo: 1, Mobile: "9825012345", Extra }])[0].Extra)).toEqual({ A: "x", B: "5" });
  });
  it("drops blank extras and gives null when none are left", () => {
    expect(cleanRows([{ RowNo: 1, Mobile: "9825012345", Extra: { A: " ", B: null } }])[0].Extra).toBeNull();
    expect(cleanRows([{ RowNo: 1, Mobile: "9825012345", Extra: "not an object" }])[0].Extra).toBeNull();
    expect(JSON.parse(cleanRows([{ RowNo: 1, Mobile: "9825012345", Extra: { A: 5, B: "" } }])[0].Extra)).toEqual({ A: "5" });
  });
  it("cuts text to the lead column sizes and blanks become null", () => {
    expect(cleanRows([{ RowNo: 1, Mobile: "9825012345", Name: "n".repeat(300), Pincode: "395007-1234", City: "  ", Email: " a@b.c " }])[0])
      .toMatchObject({ Name: "n".repeat(200), Pincode: "395007-123", City: null, Email: "a@b.c", Address: null });
  });
  it("keeps the row number and tolerates a missing input", () => {
    expect(cleanRows([{ RowNo: 7 }])[0]).toMatchObject({ RowNo: 7, Mobile: null, Dnc: 0, Extra: null });
    expect(cleanRows()).toEqual([]);
    expect(MAX_CHUNK).toBe(500);
  });
});
