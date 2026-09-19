// Quotation arithmetic — the preview's copy of what sp_SaveQuotation computes.
//
// The SP's numbers are the truth (spec §2): a final quote's PDF renders from
// the fetched row. This file exists so the preview can move while they type,
// and it must agree with the SP to the paisa or the total would visibly jump
// on save. Both are pinned to the same fixture table (quoteMath.test.js and
// the verify block in 091).
//
// BigInt paise, not floats. SQL Server does this in exact DECIMAL and rounds
// half away from zero; 1234.565 held in a double is 1234.5649999999998 and
// rounds the other way. One paisa, once a month, in front of a customer.

const int = (v, scale) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * scale)) : 0n;
};
// n / d rounded half away from zero; n, d >= 0.
const divRound = (n, d) => {
  const q = n / d;
  return (n % d) * 2n >= d ? q + 1n : q;
};
const rupees = (paise) => Number(paise) / 100;

/** One line, in paise. `inter`: IGST instead of CGST+SGST. `taxed`: seller has a GSTIN. */
function linePaise(line, { taxed, inter }) {
  const gross = divRound(int(line.qty, 1000) * int(line.rate, 100), 1000n);
  const rawDiscount = line.discountType === "amt"
    ? int(line.discountValue, 100)
    : divRound(gross * int(line.discountValue, 100), 10000n);
  const discount = rawDiscount > gross ? gross : rawDiscount;
  const taxable = gross - discount;
  const tax = taxed ? divRound(taxable * int(line.taxPct, 100), 10000n) : 0n;
  const cgst = inter ? 0n : divRound(tax, 2n);
  const sgst = inter ? 0n : tax - cgst;
  const igst = inter ? tax : 0n;
  return { gross, discount, taxable, cgst, sgst, igst, total: taxable + tax };
}

/**
 * @param lines      [{ qty, rate, discountType: 'pct'|'amt', discountValue, taxPct }]
 * @param sellerGstin  empty → unregistered seller → no tax at all
 * @param sellerState / buyerState  2-digit GST codes; a missing buyer state is
 *        treated as the seller's own (a draft has to total to something —
 *        finalise is what insists on a place of supply).
 */
export function computeQuote(lines = [], { sellerGstin, sellerState, buyerState } = {}) {
  const taxed = Boolean(sellerGstin && String(sellerGstin).trim());
  const inter = taxed && Boolean(buyerState) && Boolean(sellerState) && buyerState !== sellerState;
  const computed = lines.map((l) => linePaise(l, { taxed, inter }));
  const sum = (k) => computed.reduce((a, l) => a + l[k], 0n);
  const total = sum("total");
  const grand = divRound(total, 100n) * 100n;
  return {
    taxed,
    inter,
    lines: computed.map((l) => ({
      grossAmt: rupees(l.gross), discountAmt: rupees(l.discount), taxableAmt: rupees(l.taxable),
      cgstAmt: rupees(l.cgst), sgstAmt: rupees(l.sgst), igstAmt: rupees(l.igst), lineTotal: rupees(l.total),
    })),
    subTotal: rupees(sum("gross")),
    discountTotal: rupees(sum("discount")),
    taxableTotal: rupees(sum("taxable")),
    cgstTotal: rupees(sum("cgst")),
    sgstTotal: rupees(sum("sgst")),
    igstTotal: rupees(sum("igst")),
    roundOff: rupees(grand - total),
    grandTotal: rupees(grand),
  };
}
