// The builder's state, and its two borders: the row the server returns → the
// form (toForm), and the form → the body the server accepts (toBody). Pure, so
// the page component is left with wiring and nothing to get subtly wrong.
import { computeQuote } from "./quoteMath";
import { cleanGstin, isValidGstin, matchStateName, stateFromGstin } from "./gst";

export const DEFAULT_VALID_DAYS = 15;
export const DEFAULT_ACCENT = "#1e3a8a";
export const ACCENTS = ["#1e3a8a", "#0f766e", "#b45309", "#9f1239", "#6d28d9", "#0f172a"];

// Local Y/M/D. toISOString() is UTC and would roll the date back a day in IST.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayIso = (now = new Date()) => iso(now);
export const addDays = (isoDay, days) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDay ?? ""));
  if (!m) return "";
  return iso(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
};
const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? "")) ? String(v).slice(0, 10) : "");

let seq = 0;
/** React list keys for rows the user adds and removes; never sent to the server. */
const nextKey = () => `k${++seq}`;
const str = (v) => (v == null ? "" : String(v));

export const emptyLine = () => ({
  key: nextKey(), productId: null, description: "", hsn: "", qty: 1, unit: "", rate: "", discountType: "pct", discountValue: "", taxPct: "",
});

/** A product from the master → a line. The line is free text from here on; the product only seeds it. */
export const lineFromProduct = (p) => ({
  ...emptyLine(),
  productId: p?.Id ?? null,
  description: [p?.Name, p?.Description].filter(Boolean).join(" — "),
  hsn: str(p?.HSNCode), unit: str(p?.Unit), rate: p?.UnitPrice ?? "", taxPct: p?.TaxPct ?? "",
});

/** The branch's remembered letterhead → a quotation's company block. */
export const companyFromProfile = (profile, fallbackName = "") => ({
  name: str(profile?.CompanyName) || fallbackName,
  address: str(profile?.Address), city: str(profile?.City), stateCode: str(profile?.StateCode), pincode: str(profile?.Pincode),
  gstin: str(profile?.GSTIN), phone: str(profile?.Phone), email: str(profile?.Email), website: str(profile?.Website),
  bank: str(profile?.BankDetails), signatory: str(profile?.SignatoryName),
  logoAttachmentId: profile?.LogoAttachmentId ?? null, headerAttachmentId: profile?.HeaderAttachmentId ?? null,
  showLogo: true, showHeader: true,
  accent: profile?.AccentColor || DEFAULT_ACCENT,
});

/** …and back: what "remember this for next time" sends to saveQuoteProfile. */
export const profileFromForm = (form, leadId) => ({
  LeadId: leadId,
  CompanyName: form.Company.name, Address: form.Company.address, City: form.Company.city, StateCode: form.Company.stateCode,
  Pincode: form.Company.pincode, GSTIN: form.Company.gstin, Phone: form.Company.phone, Email: form.Company.email,
  Website: form.Company.website, BankDetails: form.Company.bank, SignatoryName: form.Company.signatory,
  DefaultIntro: form.Content.intro, DefaultTerms: form.Content.terms,
  LogoAttachmentId: form.Company.logoAttachmentId, HeaderAttachmentId: form.Company.headerAttachmentId,
  AccentColor: form.Company.accent, DefaultTemplate: form.TemplateCode,
});

/**
 * "Create quotation" on a lead: everything the lead and the branch's profile
 * already know, so the builder opens filled in. The lead's one product seeds
 * line 1; its free-text State pre-picks the place of supply only on an exact
 * name match (a wrong guess would silently flip CGST/SGST to IGST).
 */
export function draftBodyFromLead({ lead, profile, product, templateCode, companyName, now = new Date() }) {
  const quoteDate = todayIso(now);
  const company = companyFromProfile(profile, companyName);
  const hasCompany = Boolean(str(lead.Company).trim());
  return {
    Id: 0,
    LeadId: lead.Id,
    TemplateCode: templateCode || profile?.DefaultTemplate || "classic",
    QuoteDate: quoteDate,
    ValidTill: addDays(quoteDate, DEFAULT_VALID_DAYS),
    Subject: product?.Name ? `Quotation for ${product.Name}` : "",
    ToName: lead.Name, ToCompany: hasCompany ? lead.Company : "",
    ToMobile: str(lead.MobileNo), ToEmail: str(lead.Email), ToAddress: str(lead.Address), ToCity: str(lead.City),
    ToStateCode: matchStateName(lead.State) ?? "", ToPincode: str(lead.Pincode), ToGSTIN: "",
    Company: company,
    Content: { intro: str(profile?.DefaultIntro), terms: str(profile?.DefaultTerms), notes: "", sections: [] },
    Lines: product ? [stripKey(lineFromProduct(product))] : [],
  };
}

// `key` is the React list key, not part of the payload. eslint's
// ignoreRestSiblings lets the destructure drop it without complaint.
const stripKey = ({ key, ...line }) => line;

/** fetchQuotationDetail's `{ quotation, lines }` → form state. */
export function toForm({ quotation: q, lines = [] }) {
  const c = q.Company ?? {};
  return {
    TemplateCode: q.TemplateCode || "classic",
    QuoteDate: day(q.QuoteDate), ValidTill: day(q.ValidTill), Subject: str(q.Subject),
    To: {
      ToName: str(q.ToName), ToCompany: str(q.ToCompany), ToMobile: str(q.ToMobile), ToEmail: str(q.ToEmail),
      ToAddress: str(q.ToAddress), ToCity: str(q.ToCity), ToStateCode: str(q.ToStateCode), ToPincode: str(q.ToPincode), ToGSTIN: str(q.ToGSTIN),
    },
    Company: { ...companyFromProfile(null), ...c, showLogo: c.showLogo !== false, showHeader: c.showHeader !== false, accent: c.accent || DEFAULT_ACCENT },
    Content: {
      intro: str(q.Content?.intro), terms: str(q.Content?.terms), notes: str(q.Content?.notes),
      sections: (Array.isArray(q.Content?.sections) ? q.Content.sections : []).map((s) => ({ ...s, key: nextKey() })),
    },
    Lines: lines.map((l) => ({
      key: nextKey(), productId: l.ProductId ?? null, description: str(l.Description), hsn: str(l.HSNCode), qty: Number(l.Qty),
      unit: str(l.Unit), rate: Number(l.Rate), discountType: l.DiscountType === "amt" ? "amt" : "pct",
      discountValue: Number(l.DiscountValue) || "", taxPct: Number(l.TaxPct) || "",
    })),
  };
}

/** Form state → the saveQuotation body. No totals: the server computes every amount. */
export function toBody(form, { id, leadId }) {
  return {
    Id: id, LeadId: leadId,
    TemplateCode: form.TemplateCode, QuoteDate: form.QuoteDate || null, ValidTill: form.ValidTill || null, Subject: form.Subject,
    ...form.To,
    Company: { ...form.Company, gstin: cleanGstin(form.Company.gstin), stateCode: stateFromGstin(form.Company.gstin) ?? form.Company.stateCode },
    Content: { ...form.Content, sections: form.Content.sections.map(stripKey) },
    Lines: form.Lines.map(stripKey),
  };
}

/** The live preview's numbers. The server's are the truth; these only have to agree with them. */
export const amountsOf = (form) => computeQuote(form.Lines, {
  sellerGstin: cleanGstin(form.Company.gstin),
  sellerState: stateFromGstin(form.Company.gstin) ?? form.Company.stateCode,
  buyerState: form.To.ToStateCode,
});

const OPEN_LEAD_STATUSES = ["open", "qualified"];

/**
 * Why Finalise is not available yet, in the user's words — an empty list means
 * go. The server checks the substantive ones again (sp_FinaliseQuotation); the
 * sample-art checks exist only here, because only the builder knows that what
 * is on the page is OUR placeholder and not their logo.
 *
 * `leadStatusCode` is optional: sp_FinaliseQuotation also refuses a lead that
 * is not open/qualified, but this pure function has no way to know the lead's
 * status unless the caller passes it — omit it and this check is silent.
 */
export function finaliseBlockers(form, { leadStatusCode } = {}) {
  const out = [];
  const c = form.Company;
  if (!str(c.name).trim()) out.push("Add your company name");
  if (c.showLogo !== false && !c.logoAttachmentId) out.push("Replace the sample logo, or remove it");
  if (c.showHeader !== false && !c.headerAttachmentId) out.push("Replace the sample banner, or remove it");
  if (!str(form.To.ToName).trim()) out.push("Add the customer's name");
  if (form.Lines.length === 0) out.push("Add at least one line");
  else if (form.Lines.some((l) => !str(l.description).trim() || !(Number(l.qty) > 0))) out.push("Every line needs a description and a quantity");
  else if (form.Lines.some((l) => Number(l.rate) < 0)) out.push("No line can have a negative rate");
  const seller = cleanGstin(c.gstin);
  if (seller && !isValidGstin(seller)) out.push("Your GSTIN does not look right");
  if (str(form.To.ToGSTIN).trim() && !isValidGstin(form.To.ToGSTIN)) out.push("The customer's GSTIN does not look right");
  if (seller && isValidGstin(seller) && !form.To.ToStateCode) out.push("Choose the customer's state — GST depends on it");
  if (leadStatusCode && !OPEN_LEAD_STATUSES.includes(leadStatusCode)) out.push("This lead is closed — the quotation cannot be finalised");
  return out;
}
