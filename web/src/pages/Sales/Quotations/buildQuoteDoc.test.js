import { describe, it, expect } from "vitest";
import { buildQuoteDoc, amountsFromServer, money, dmy } from "./buildQuoteDoc";
import { computeQuote } from "./quoteMath";

const items = [
  { description: "5 kW Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 },
  { description: "Installation", hsn: "", qty: 2.5, unit: "", rate: 1000, discountType: "pct", discountValue: 10, taxPct: 18 },
];
const company = { name: "Solar Care", address: "402 Titanium", city: "Ahmedabad", stateCode: "24", pincode: "380054", gstin: "24ABCDE1234F1Z5", phone: "079", email: "s@s.in", accent: "#0f766e", logoAttachmentId: 9 };
const header = { Status: "final", QuoteNo: "QT-2627-0042", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", ToName: "Ramesh Patel", ToCity: "Ahmedabad", ToPincode: "380015", ToStateCode: "24", ToMobile: "9825012345" };
const build = (over = {}) => {
  const h = { ...header, ...(over.header ?? {}) };
  const c = { ...company, ...(over.company ?? {}) };
  return buildQuoteDoc({ header: h, company: c, content: over.content ?? {}, items, images: { 9: "data:logo", 21: "data:pic" }, samples: { logo: "sample:logo", header: "sample:header" },
    amounts: computeQuote(items, { sellerGstin: c.gstin, sellerState: c.stateCode, buyerState: h.ToStateCode }) });
};

describe("formatting", () => {
  it("prints money with Indian grouping and two decimals", () => {
    expect(money(341930)).toBe("₹3,41,930.00");
    expect(money(0)).toBe("₹0.00");
    expect(money(null)).toBe("₹0.00");
    expect(money(12345678.5)).toBe("₹1,23,45,678.50");
  });

  // toISOString() is UTC and rolls the date back a day for every user in IST.
  it("prints a date as DD-MM-YYYY from the string, never through a Date", () => {
    expect(dmy("2026-04-01")).toBe("01-04-2026");
    expect(dmy("2026-04-01T00:00:00.000Z")).toBe("01-04-2026");
    expect(dmy(null)).toBe("");
  });
});

describe("buildQuoteDoc", () => {
  it("numbers a final quote and marks a draft as DRAFT", () => {
    expect(build()).toMatchObject({ isDraft: false, quoteNo: "QT-2627-0042", quoteDate: "18-09-2026", validTill: "03-10-2026" });
    expect(build({ header: { Status: "draft", QuoteNo: null } })).toMatchObject({ isDraft: true, quoteNo: "DRAFT" });
  });

  it("formats each line; a discount shows as the user entered it", () => {
    const d = build();
    expect(d.rows[0]).toEqual({ sr: "1", description: "5 kW Rooftop", hsn: "8541", qtyText: "1 Set", rateText: "₹2,80,000.00", discountText: "₹10,000.00", taxPctText: "12%", amountText: "₹2,70,000.00" });
    expect(d.rows[1]).toMatchObject({ qtyText: "2.5", discountText: "10%", amountText: "₹2,250.00" });
    expect(d).toMatchObject({ showHsn: true, showDiscount: true });
  });

  it("intra-state: CGST + SGST rows and a two-column tax summary", () => {
    const d = build();
    expect(d.totals.map((t) => t.label)).toEqual(["Sub total", "Discount", "Taxable value", "CGST", "SGST"]);
    expect(d.gstSummary).toEqual([
      { rateText: "12%", taxableText: "₹2,70,000.00", cgstText: "₹16,200.00", sgstText: "₹16,200.00", igstText: "₹0.00" },
      { rateText: "18%", taxableText: "₹2,250.00", cgstText: "₹202.50", sgstText: "₹202.50", igstText: "₹0.00" },
    ]);
    expect(d.grandTotalText).toBe("₹3,05,055.00");
    expect(d.amountInWords).toBe("Rupees Three Lakh Five Thousand Fifty Five Only");
  });

  it("inter-state: one IGST row, and the place of supply is named", () => {
    const d = build({ header: { ToStateCode: "27" } });
    expect(d.inter).toBe(true);
    expect(d.totals.map((t) => t.label)).toEqual(["Sub total", "Discount", "Taxable value", "IGST"]);
    expect(d.to.placeOfSupply).toBe("Maharashtra (27)");
  });

  // An unregistered seller charges no GST: the template must not print a GST
  // column, a tax summary, or a GSTIN line at all.
  it("unregistered seller: no tax anywhere", () => {
    const d = build({ company: { gstin: "" } });
    expect(d.taxed).toBe(false);
    expect(d.gstSummary).toEqual([]);
    expect(d.rows[0].taxPctText).toBe("");
    expect(d.totals.map((t) => t.label)).toEqual(["Sub total", "Discount", "Taxable value"]);
    expect(d.company.gstin).toBe("");
  });

  it("shows a round-off row only when there is one, signed", () => {
    const one = [{ description: "x", qty: 1, rate: 100.1, discountType: "pct", discountValue: 0, taxPct: 5 }];
    const d = buildQuoteDoc({ header, company, items: one, amounts: computeQuote(one, { sellerGstin: company.gstin, sellerState: "24", buyerState: "24" }) });
    expect(d.totals.at(-1)).toEqual({ label: "Round off", value: "− ₹0.11" });
    expect(build().totals.some((t) => t.label === "Round off")).toBe(false);
  });

  it("uses the company's image, then the sample, and nothing when switched off", () => {
    expect(build().logoSrc).toBe("data:logo");
    expect(build().headerSrc).toBe("sample:header");                       // no id yet → sample art
    expect(build({ company: { showHeader: false } }).headerSrc).toBeNull(); // removed outright
    expect(build({ company: { logoAttachmentId: 77 } }).logoSrc).toBeNull(); // id set but blob not loaded: draw nothing, never the sample
  });

  it("falls back to the default accent for anything that is not #RRGGBB", () => {
    expect(build().accent).toBe("#0f766e");
    expect(build({ company: { accent: "red" } }).accent).toBe("#1e3a8a");
  });

  it("drops blank rich text and empty sections; keeps pictures whose blob loaded", () => {
    const d = build({ content: { intro: "<p></p>", terms: "<p>50% advance <mark>now</mark></p>", notes: "<p>Bring a valid ID <mark>on-site</mark></p>", sections: [
      { type: "text", title: "", body: "<p> </p>" },
      { type: "text", title: "Scope", body: "<p>x</p>" },
      { type: "images", title: "Sites", items: [{ attachmentId: 21, caption: "Bopal" }, { attachmentId: 404, caption: "lost" }] },
      { type: "images", title: "None loaded", items: [{ attachmentId: 404 }] },
    ] } });
    expect(d.intro).toBe("");
    expect(d.terms).toBe("<p>50% advance now</p>");
    expect(d.notes).toBe("<p>Bring a valid ID on-site</p>");
    expect(d.sections).toEqual([
      { type: "text", title: "Scope", html: "<p>x</p>" },
      { type: "images", title: "Sites", items: [{ src: "data:pic", caption: "Bopal" }] },
    ]);
  });

  it("drops blank notes the same way as intro/terms", () => {
    expect(build({ content: { notes: "<p> </p>" } }).notes).toBe("");
    expect(build().notes).toBe("");
  });

  it("composes address and contact lines, skipping what is empty", () => {
    const d = build();
    expect(d.company.addressLines).toEqual(["402 Titanium", "Ahmedabad, Gujarat, 380054"]);
    expect(d.company.contactLine).toBe("079  ·  s@s.in");
    expect(d.to.addressLines).toEqual(["Ahmedabad 380015"]);
  });

  it("survives being handed nothing", () => {
    const d = buildQuoteDoc({});
    expect(d).toMatchObject({ isDraft: true, quoteNo: "DRAFT", rows: [], sections: [], grandTotalText: "₹0.00" });
  });
});

describe("amountsFromServer", () => {
  it("maps the SP's stored columns onto computeQuote's shape", () => {
    const a = amountsFromServer(
      { SellerGSTIN: "24ABCDE1234F1Z5", SellerStateCode: "24", ToStateCode: "27", SubTotal: 100, DiscountTotal: 0, TaxableTotal: 100, CgstTotal: 0, SgstTotal: 0, IgstTotal: 18, RoundOff: 0, GrandTotal: 118 },
      [{ GrossAmt: 100, DiscountAmt: 0, TaxableAmt: 100, CgstAmt: 0, SgstAmt: 0, IgstAmt: 18, LineTotal: 118 }],
    );
    expect(a).toMatchObject({ taxed: true, inter: true, igstTotal: 18, grandTotal: 118 });
    expect(a.lines[0]).toEqual({ grossAmt: 100, discountAmt: 0, taxableAmt: 100, cgstAmt: 0, sgstAmt: 0, igstAmt: 18, lineTotal: 118 });
    expect(amountsFromServer({ SellerGSTIN: null }).taxed).toBe(false);
  });
});
