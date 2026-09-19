import { describe, it, expect } from "vitest";
import { computeQuote } from "./quoteMath";

const GJ = { sellerGstin: "24ABCDE1234F1Z5", sellerState: "24" };

/**
 * THE FIXTURE TABLE. The same rows sit in the verify block of
 * backend/sql/091_quotations.sql, run against sp_SaveQuotation after apply.
 * If one side changes, the other must — that is the whole point of it.
 */
describe("computeQuote — fixtures shared with 091", () => {
  it("F1 intra-state: CGST + SGST, each half", () => {
    const q = computeQuote([{ qty: 1, rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 }], { ...GJ, buyerState: "24" });
    expect(q).toMatchObject({ inter: false, subTotal: 280000, discountTotal: 10000, taxableTotal: 270000,
      cgstTotal: 16200, sgstTotal: 16200, igstTotal: 0, roundOff: 0, grandTotal: 302400 });
  });

  it("F2 inter-state: the same line, all of it IGST", () => {
    const q = computeQuote([{ qty: 1, rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 }], { ...GJ, buyerState: "27" });
    expect(q).toMatchObject({ inter: true, cgstTotal: 0, sgstTotal: 0, igstTotal: 32400, grandTotal: 302400 });
  });

  it("F3 unregistered seller: no tax whatever the line says", () => {
    const q = computeQuote([{ qty: 2, rate: 1500, discountType: "pct", discountValue: 0, taxPct: 18 }], { sellerGstin: "", buyerState: "24" });
    expect(q).toMatchObject({ taxed: false, taxableTotal: 3000, cgstTotal: 0, sgstTotal: 0, igstTotal: 0, grandTotal: 3000 });
  });

  it("F4 the odd paisa goes to CGST, always", () => {
    // taxable 100.10 @ 5% = 5.005 → 5.01; half = 2.505 → CGST 2.51, SGST 2.50
    const q = computeQuote([{ qty: 1, rate: 100.10, discountType: "pct", discountValue: 0, taxPct: 5 }], { ...GJ, buyerState: "24" });
    expect(q.lines[0]).toMatchObject({ taxableAmt: 100.1, cgstAmt: 2.51, sgstAmt: 2.5 });
    expect(q).toMatchObject({ grandTotal: 105, roundOff: -0.11 });
  });

  it("F5 percentage discount, fractional quantity, mixed rates, round-off up", () => {
    const q = computeQuote([
      { qty: 2.5, rate: 1234.56, discountType: "pct", discountValue: 7.5, taxPct: 18 },
      { qty: 3, rate: 99.99, discountType: "amt", discountValue: 0, taxPct: 28 },
    ], { ...GJ, buyerState: "24" });
    expect(q.lines[0]).toMatchObject({ grossAmt: 3086.4, discountAmt: 231.48, taxableAmt: 2854.92, cgstAmt: 256.95, sgstAmt: 256.94, lineTotal: 3368.81 });
    expect(q.lines[1]).toMatchObject({ grossAmt: 299.97, discountAmt: 0, taxableAmt: 299.97, cgstAmt: 42, sgstAmt: 41.99, lineTotal: 383.96 });
    expect(q).toMatchObject({ subTotal: 3386.37, discountTotal: 231.48, taxableTotal: 3154.89, cgstTotal: 298.95, sgstTotal: 298.93, grandTotal: 3753, roundOff: 0.23 });
  });
});

describe("computeQuote — edges", () => {
  // The float this file exists to avoid: 1234.565 is 1234.5649999999998 in a
  // double. SQL's exact DECIMAL rounds it up; a naive Math.round rounds down.
  it("rounds half away from zero the way SQL DECIMAL does, not the way a double does", () => {
    const q = computeQuote([{ qty: 1, rate: 8230.43, discountType: "pct", discountValue: 0, taxPct: 15 }], { ...GJ, buyerState: "27" });
    expect(q.lines[0].igstAmt).toBe(1234.56); // 1234.5645 → .56
    const half = computeQuote([{ qty: 1, rate: 24691.30, discountType: "pct", discountValue: 0, taxPct: 5 }], { ...GJ, buyerState: "27" });
    expect(half.lines[0].igstAmt).toBe(1234.57); // 1234.565 exactly → .57
  });

  it("caps an amount discount at the line's gross — a line cannot go negative", () => {
    const q = computeQuote([{ qty: 1, rate: 500, discountType: "amt", discountValue: 900, taxPct: 18 }], { ...GJ, buyerState: "24" });
    expect(q.lines[0]).toMatchObject({ discountAmt: 500, taxableAmt: 0, lineTotal: 0 });
  });

  it("treats a missing place of supply as the seller's own state, so a draft still totals", () => {
    expect(computeQuote([{ qty: 1, rate: 100, taxPct: 18 }], { ...GJ }).inter).toBe(false);
  });

  it("is zero, not NaN, for an empty quote and for junk in a field", () => {
    expect(computeQuote([], GJ)).toMatchObject({ grandTotal: 0, roundOff: 0, lines: [] });
    const q = computeQuote([{ qty: "abc", rate: null, discountType: "pct", discountValue: undefined, taxPct: "" }], { ...GJ, buyerState: "24" });
    expect(q.grandTotal).toBe(0);
    expect(Number.isNaN(q.lines[0].lineTotal)).toBe(false);
  });

  it("ignores negatives rather than subtracting them", () => {
    expect(computeQuote([{ qty: -2, rate: 100, taxPct: 18 }], { ...GJ, buyerState: "24" }).grandTotal).toBe(0);
  });
});
