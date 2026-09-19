import { describe, it, expect } from "vitest";
import {
  addDays, todayIso, emptyLine, lineFromProduct, companyFromProfile, profileFromForm, draftBodyFromLead,
  toForm, toBody, amountsOf, finaliseBlockers, DEFAULT_ACCENT,
} from "./quoteForm";

const LEAD = { Id: 9, Name: "Ramesh Patel", Company: "", MobileNo: "9825012345", Email: "r@p.in", Address: "14 Shanti", City: "Ahmedabad", State: "gujarat", Pincode: "380015", ProductId: 7 };
const PROFILE = { Id: 3, CompanyName: "Solar Care", Address: "402 Titanium", City: "Ahmedabad", StateCode: "24", Pincode: "380054", GSTIN: "24ABCDE1234F1Z5", Phone: "079", Email: "s@s.in", Website: "s.in", BankDetails: "HDFC", SignatoryName: "Amit", LogoAttachmentId: 12, HeaderAttachmentId: null, AccentColor: "#0f766e", DefaultTemplate: "modern", DefaultIntro: "<p>Dear customer</p>", DefaultTerms: "<p>50%</p>", IsSet: true };
const PRODUCT = { Id: 7, Name: "5 kW Rooftop", Description: "Mono PERC", HSNCode: "8541", Unit: "Set", UnitPrice: 280000, TaxPct: 12 };

describe("dates", () => {
  // toISOString() is UTC: at 02:00 IST on 1 April it still says 31 March.
  it("reads and writes local calendar days", () => {
    expect(todayIso(new Date(2026, 3, 1, 2, 0))).toBe("2026-04-01");
    expect(addDays("2026-09-18", 15)).toBe("2026-10-03");
    expect(addDays("2026-12-25", 15)).toBe("2027-01-09");
    expect(addDays("junk", 1)).toBe("");
  });
});

describe("lines", () => {
  it("starts a blank line at quantity 1, discount as a percentage, with its own key", () => {
    const a = emptyLine(); const b = emptyLine();
    expect(a).toMatchObject({ productId: null, description: "", qty: 1, discountType: "pct" });
    expect(a.key).not.toBe(b.key);
  });

  it("seeds a line from a product, and copes with a bare one", () => {
    expect(lineFromProduct(PRODUCT)).toMatchObject({ productId: 7, description: "5 kW Rooftop — Mono PERC", hsn: "8541", unit: "Set", rate: 280000, taxPct: 12 });
    expect(lineFromProduct({ Id: 8, Name: "Cable" })).toMatchObject({ description: "Cable", hsn: "", rate: "", taxPct: "" });
  });
});

describe("the remembered letterhead", () => {
  it("becomes the company block, images on", () => {
    expect(companyFromProfile(PROFILE)).toMatchObject({ name: "Solar Care", gstin: "24ABCDE1234F1Z5", bank: "HDFC", signatory: "Amit", logoAttachmentId: 12, headerAttachmentId: null, showLogo: true, showHeader: true, accent: "#0f766e" });
  });

  // A brand-new branch has an empty profile; Central's company name is a better
  // starting point than a blank field.
  it("falls back to the tenant's name and the default accent when nothing is saved yet", () => {
    expect(companyFromProfile({ Id: 3, IsSet: false }, "Solar Care")).toMatchObject({ name: "Solar Care", accent: DEFAULT_ACCENT, gstin: "" });
    expect(companyFromProfile(null).name).toBe("");
  });

  it("round-trips back into a saveQuoteProfile body", () => {
    const form = toForm({ quotation: { TemplateCode: "modern", Company: companyFromProfile(PROFILE), Content: { intro: "<p>i</p>", terms: "<p>t</p>" } } });
    expect(profileFromForm(form, 9)).toEqual({
      LeadId: 9, CompanyName: "Solar Care", Address: "402 Titanium", City: "Ahmedabad", StateCode: "24", Pincode: "380054",
      GSTIN: "24ABCDE1234F1Z5", Phone: "079", Email: "s@s.in", Website: "s.in", BankDetails: "HDFC", SignatoryName: "Amit",
      DefaultIntro: "<p>i</p>", DefaultTerms: "<p>t</p>", LogoAttachmentId: 12, HeaderAttachmentId: null, AccentColor: "#0f766e", DefaultTemplate: "modern",
    });
  });
});

describe("draftBodyFromLead", () => {
  const body = draftBodyFromLead({ lead: LEAD, profile: PROFILE, product: PRODUCT, templateCode: "minimal", now: new Date(2026, 8, 18) });

  it("opens the builder already filled in", () => {
    expect(body).toMatchObject({
      Id: 0, LeadId: 9, TemplateCode: "minimal", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "Quotation for 5 kW Rooftop",
      ToName: "Ramesh Patel", ToCompany: "", ToMobile: "9825012345", ToCity: "Ahmedabad", ToStateCode: "24", ToGSTIN: "",
    });
    expect(body.Company.name).toBe("Solar Care");
    expect(body.Content).toEqual({ intro: "<p>Dear customer</p>", terms: "<p>50%</p>", notes: "", sections: [] });
    expect(body.Lines).toEqual([{ productId: 7, description: "5 kW Rooftop — Mono PERC", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "pct", discountValue: "", taxPct: 12 }]);
  });

  it("uses the profile's template when none was picked, and classic when there is neither", () => {
    expect(draftBodyFromLead({ lead: LEAD, profile: PROFILE }).TemplateCode).toBe("modern");
    expect(draftBodyFromLead({ lead: LEAD, profile: null }).TemplateCode).toBe("classic");
  });

  // A wrong guess silently flips CGST/SGST to IGST. No guess leaves the field
  // for the user, and Finalise insists on it.
  it("pre-picks place of supply only on an exact state name", () => {
    expect(draftBodyFromLead({ lead: { ...LEAD, State: "Gujrat" }, profile: PROFILE }).ToStateCode).toBe("");
  });

  it("has no lines and no subject for a lead with no product; addresses a company lead to the company", () => {
    const b = draftBodyFromLead({ lead: { ...LEAD, Company: "Patel Textiles" }, profile: PROFILE });
    expect(b).toMatchObject({ Lines: [], Subject: "", ToCompany: "Patel Textiles", ToName: "Ramesh Patel" });
  });
});

describe("toForm / toBody", () => {
  const detail = {
    quotation: { Id: 4, LeadId: 9, TemplateCode: "modern", QuoteDate: "2026-09-18T00:00:00.000Z", ValidTill: null, Subject: null,
      ToName: "Ramesh", ToStateCode: "24", ToGSTIN: null, Company: { name: "Solar Care", gstin: "24abcde1234f1z5", showLogo: false }, Content: { intro: "<p>hi</p>", sections: [{ type: "text", title: "Scope", body: "<p>x</p>" }] } },
    lines: [{ Id: 1, ProductId: 7, Description: "Rooftop", HSNCode: "8541", Qty: 1, Unit: "Set", Rate: 280000, DiscountType: "amt", DiscountValue: 10000, TaxPct: 12, LineTotal: 302400 }],
  };

  it("maps the server's row into form state, nulls to empty strings", () => {
    const f = toForm(detail);
    expect(f).toMatchObject({ TemplateCode: "modern", QuoteDate: "2026-09-18", ValidTill: "", Subject: "" });
    expect(f.To).toMatchObject({ ToName: "Ramesh", ToGSTIN: "", ToStateCode: "24" });
    expect(f.Company).toMatchObject({ name: "Solar Care", showLogo: false, showHeader: true, accent: DEFAULT_ACCENT });
    expect(f.Lines[0]).toMatchObject({ productId: 7, description: "Rooftop", discountType: "amt", discountValue: 10000, taxPct: 12 });
    expect(f.Content.sections[0]).toMatchObject({ type: "text", title: "Scope" });
    expect(f.Content.sections[0].key).toBeTruthy();
  });

  it("survives a row with no JSON at all", () => {
    const f = toForm({ quotation: { ToName: "x" } });
    expect(f).toMatchObject({ TemplateCode: "classic", Lines: [], Content: { intro: "", terms: "", notes: "", sections: [] } });
  });

  // The web never sends a total, a React key, or a server-computed amount.
  it("builds the save body: no keys, no totals, GSTIN cleaned, seller state read off it", () => {
    const b = toBody(toForm(detail), { id: 4, leadId: 9 });
    expect(b).toMatchObject({ Id: 4, LeadId: 9, TemplateCode: "modern", QuoteDate: "2026-09-18", ValidTill: null, ToName: "Ramesh" });
    expect(b.Company).toMatchObject({ gstin: "24ABCDE1234F1Z5", stateCode: "24" });
    expect(b.Lines).toEqual([{ productId: 7, description: "Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 }]);
    expect(b.Content.sections).toEqual([{ type: "text", title: "Scope", body: "<p>x</p>" }]);
    expect(JSON.stringify(b)).not.toMatch(/"key"|LineTotal|GrandTotal/);
  });

  it("previews the same numbers the fixture table promises (F1)", () => {
    expect(amountsOf(toForm(detail))).toMatchObject({ inter: false, taxableTotal: 270000, cgstTotal: 16200, sgstTotal: 16200, grandTotal: 302400 });
  });
});

describe("finaliseBlockers", () => {
  const ready = () => {
    const f = toForm({ quotation: { ToName: "Ramesh", ToStateCode: "24", Company: { name: "Solar Care", gstin: "24ABCDE1234F1Z5", logoAttachmentId: 12, showHeader: false } },
      lines: [{ Description: "Rooftop", Qty: 1, Rate: 100 }] });
    return f;
  };
  const patch = (fn) => { const f = ready(); fn(f); return finaliseBlockers(f); };

  it("is empty when the quotation is ready", () => expect(finaliseBlockers(ready())).toEqual([]));

  // Only the builder knows the art on the page is OUR placeholder. Without this
  // a customer receives a quotation carrying a grey sample logo.
  it("refuses while our sample art is still showing — replace it or remove it", () => {
    expect(patch((f) => { f.Company.logoAttachmentId = null; })).toEqual(["Replace the sample logo, or remove it"]);
    expect(patch((f) => { f.Company.logoAttachmentId = null; f.Company.showLogo = false; })).toEqual([]);
    expect(patch((f) => { f.Company.showHeader = true; })).toEqual(["Replace the sample banner, or remove it"]);
  });

  it.each([
    [(f) => { f.Company.name = "  "; }, "Add your company name"],
    [(f) => { f.To.ToName = ""; }, "Add the customer's name"],
    [(f) => { f.Lines = []; }, "Add at least one line"],
    [(f) => { f.Lines[0].description = " "; }, "Every line needs a description and a quantity"],
    [(f) => { f.Lines[0].qty = 0; }, "Every line needs a description and a quantity"],
    [(f) => { f.Company.gstin = "24ABC"; }, "Your GSTIN does not look right"],
    [(f) => { f.To.ToGSTIN = "nope"; }, "The customer's GSTIN does not look right"],
    [(f) => { f.To.ToStateCode = ""; }, "Choose the customer's state — GST depends on it"],
  ])("names what is missing", (mutate, message) => expect(patch(mutate)).toEqual([message]));

  it("does not ask an unregistered seller for a place of supply", () => {
    expect(patch((f) => { f.Company.gstin = ""; f.To.ToStateCode = ""; })).toEqual([]);
  });

  // sp_FinaliseQuotation independently refuses Rate < 0. A zero rate (a free
  // replacement line) stays legal.
  it("refuses a negative rate, but not a zero one", () => {
    expect(patch((f) => { f.Lines[0].rate = -100; })).toEqual(["No line can have a negative rate"]);
    expect(patch((f) => { f.Lines[0].rate = 0; })).toEqual([]);
  });

  // sp_FinaliseQuotation also refuses a closed/unqualified lead. Called with
  // one argument (no second, leadStatusCode unknown) the check stays silent —
  // Task 15B is the only caller that will ever pass the second argument.
  describe("leadStatusCode (optional second argument)", () => {
    it("is silent when the caller does not pass a lead status", () => {
      expect(finaliseBlockers(ready())).toEqual([]);
    });

    it("flags a closed or disqualified lead", () => {
      expect(finaliseBlockers(ready(), { leadStatusCode: "closed" })).toEqual(["This lead is closed — the quotation cannot be finalised"]);
      expect(finaliseBlockers(ready(), { leadStatusCode: "lost" })).toEqual(["This lead is closed — the quotation cannot be finalised"]);
    });

    it("stays quiet for an open or qualified lead", () => {
      expect(finaliseBlockers(ready(), { leadStatusCode: "open" })).toEqual([]);
      expect(finaliseBlockers(ready(), { leadStatusCode: "qualified" })).toEqual([]);
    });
  });
});
