// Everything a template prints, already formatted. Templates are dumb on
// purpose: they place strings. All arithmetic lives in quoteMath (draft) or
// came from the SP (final); all formatting lives here, where it can be tested
// without a PDF engine.
import { amountInWords } from "./amountInWords";
import { stateByCode } from "./gst";
import { toPdfHtml, isBlankHtml } from "../../../components/ui/richTextHtml";

export const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const pct = (n) => `${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

// Local Y/M/D — never toISOString(), which is UTC and rolls the date back a day in IST.
export const dmy = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

const lines = (...parts) => parts.map((p) => String(p ?? "").trim()).filter(Boolean);

/** The SP's stored columns → the shape computeQuote returns, so one builder serves draft and final. */
export const amountsFromServer = (q, rows = []) => ({
  taxed: Boolean(q.SellerGSTIN),
  inter: Boolean(q.SellerGSTIN) && Boolean(q.ToStateCode) && q.ToStateCode !== q.SellerStateCode,
  lines: rows.map((r) => ({
    grossAmt: Number(r.GrossAmt), discountAmt: Number(r.DiscountAmt), taxableAmt: Number(r.TaxableAmt),
    cgstAmt: Number(r.CgstAmt), sgstAmt: Number(r.SgstAmt), igstAmt: Number(r.IgstAmt), lineTotal: Number(r.LineTotal),
  })),
  subTotal: Number(q.SubTotal), discountTotal: Number(q.DiscountTotal), taxableTotal: Number(q.TaxableTotal),
  cgstTotal: Number(q.CgstTotal), sgstTotal: Number(q.SgstTotal), igstTotal: Number(q.IgstTotal),
  roundOff: Number(q.RoundOff), grandTotal: Number(q.GrandTotal),
});

/**
 * @param header   { Status, QuoteNo, QuoteDate, ValidTill, Subject, ToName, ToCompany, ToMobile, ToEmail,
 *                   ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN }
 * @param company  CompanyJSON
 * @param content  ContentJSON
 * @param items    [{ description, hsn, qty, unit, rate, discountType, discountValue, taxPct }]
 * @param amounts  computeQuote(...) or amountsFromServer(...)
 * @param images   { [attachmentId]: dataUrl } — resolved by useQuoteImages; a missing id draws nothing
 * @param samples  { logo, header } — the sample art, shown while the id is null
 */
export function buildQuoteDoc({ header = {}, company = {}, content = {}, items = [], amounts, images = {}, samples = {} }) {
  const isDraft = (header.Status ?? "draft") === "draft";
  const taxed = Boolean(amounts?.taxed);
  const inter = Boolean(amounts?.inter);
  const a = amounts ?? { lines: [] };

  const rows = items.map((it, i) => {
    const amt = a.lines?.[i] ?? {};
    const discounted = Number(amt.discountAmt) > 0;
    return {
      sr: String(i + 1),
      description: String(it.description ?? ""),
      hsn: String(it.hsn ?? ""),
      qtyText: [qty(it.qty), it.unit].filter(Boolean).join(" "),
      rateText: money(it.rate),
      discountText: !discounted ? "" : it.discountType === "amt" ? money(amt.discountAmt) : pct(it.discountValue),
      taxPctText: taxed ? pct(it.taxPct) : "",
      amountText: money(amt.taxableAmt),
    };
  });

  // Tax by rate — what an accountant looks for first.
  const byRate = new Map();
  items.forEach((it, i) => {
    const amt = a.lines?.[i] ?? {};
    const key = Number(it.taxPct || 0);
    const g = byRate.get(key) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable += Number(amt.taxableAmt || 0); g.cgst += Number(amt.cgstAmt || 0);
    g.sgst += Number(amt.sgstAmt || 0); g.igst += Number(amt.igstAmt || 0);
    byRate.set(key, g);
  });
  const gstSummary = !taxed ? [] : [...byRate.entries()].sort((x, y) => x[0] - y[0]).map(([rate, g]) => ({
    rateText: pct(rate), taxableText: money(g.taxable), cgstText: money(g.cgst), sgstText: money(g.sgst), igstText: money(g.igst),
  }));

  const totals = [
    { label: "Sub total", value: money(a.subTotal) },
    ...(Number(a.discountTotal) > 0 ? [{ label: "Discount", value: `− ${money(a.discountTotal)}` }, { label: "Taxable value", value: money(a.taxableTotal) }] : []),
    ...(taxed && !inter ? [{ label: "CGST", value: money(a.cgstTotal) }, { label: "SGST", value: money(a.sgstTotal) }] : []),
    ...(taxed && inter ? [{ label: "IGST", value: money(a.igstTotal) }] : []),
    ...(Number(a.roundOff) !== 0 ? [{ label: "Round off", value: `${a.roundOff < 0 ? "− " : ""}${money(Math.abs(a.roundOff))}` }] : []),
  ];

  const pick = (id, sample, show) => (show === false ? null : id ? images[id] ?? null : sample ?? null);

  const sections = (Array.isArray(content.sections) ? content.sections : []).map((s) =>
    s?.type === "images"
      ? { type: "images", title: String(s.title ?? ""), items: (s.items ?? []).map((im) => ({ src: images[im.attachmentId] ?? null, caption: String(im.caption ?? "") })).filter((im) => im.src) }
      : { type: "text", title: String(s?.title ?? ""), html: toPdfHtml(s?.body) },
  ).filter((s) => (s.type === "images" ? s.items.length > 0 : !isBlankHtml(s.html) || s.title));

  return {
    isDraft,
    title: "Quotation",
    quoteNo: isDraft ? "DRAFT" : String(header.QuoteNo ?? ""),
    quoteDate: dmy(header.QuoteDate),
    validTill: dmy(header.ValidTill),
    subject: String(header.Subject ?? ""),
    accent: /^#[0-9a-f]{6}$/i.test(company.accent ?? "") ? company.accent : "#1e3a8a",
    logoSrc: pick(company.logoAttachmentId, samples.logo, company.showLogo),
    headerSrc: pick(company.headerAttachmentId, samples.header, company.showHeader),
    company: {
      name: String(company.name ?? ""),
      addressLines: lines(company.address, [company.city, stateByCode(company.stateCode)?.name, company.pincode].filter(Boolean).join(", ")),
      contactLine: lines(company.phone, company.email, company.website).join("  ·  "),
      gstin: String(company.gstin ?? ""),
      bank: String(company.bank ?? ""),
      signatory: String(company.signatory ?? ""),
    },
    to: {
      name: String(header.ToName ?? ""),
      company: String(header.ToCompany ?? ""),
      addressLines: lines(header.ToAddress, [header.ToCity, header.ToPincode].filter(Boolean).join(" ")),
      contactLine: lines(header.ToMobile, header.ToEmail).join("  ·  "),
      gstin: String(header.ToGSTIN ?? ""),
      placeOfSupply: stateByCode(header.ToStateCode) ? `${stateByCode(header.ToStateCode).name} (${header.ToStateCode})` : "",
    },
    taxed, inter,
    showHsn: rows.some((r) => r.hsn),
    showDiscount: rows.some((r) => r.discountText),
    rows, gstSummary, totals,
    grandTotalText: money(a.grandTotal),
    amountInWords: amountInWords(a.grandTotal),
    intro: isBlankHtml(content.intro) ? "" : toPdfHtml(content.intro),
    terms: isBlankHtml(content.terms) ? "" : toPdfHtml(content.terms),
    notes: isBlankHtml(content.notes) ? "" : toPdfHtml(content.notes),
    sections,
  };
}
