// Spec 3: quotations. A quotation has NO permission model of its own — it is
// part of its lead. Every method resolves the parent lead and is gated by the
// lead's visibility (permission.assertRecordAccess): whoever can see the lead
// can see, edit and issue its quotations, and a transferred lead carries them
// along. tblQuotation has no BranchId / OwnerId to go stale.
//
// Totals are never accepted from the client. sp_SaveQuotation computes every
// amount from the lines; anything total-shaped in a request body is dropped.
const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { scopeParams, canSeeRecord, assertRecordAccess } = require("../middleware/permission");
const { positiveInt, pageParams } = require("../utils/controllerKit");
const { applyMobiles } = require("../utils/mobile");
const { parseDay } = require("../utils/reportKit");
const attachmentController = require("./attachmentController");

const TEMPLATE_CODES = ["classic", "modern", "minimal"];
const STATUSES = ["draft", "final", "accepted", "rejected", "superseded", "unused"];
// One rich-text block. Generous for prose, small enough that a pasted novel (or
// a base64 image someone smuggled into the HTML) is refused rather than stored.
const MAX_HTML = 200 * 1024;
const MAX_LINES = 200;

// Mutating SPs return exactly one status row: Id + ResponseCode + ResponseMess.
async function runSp(res, spName, params, failMessage) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;
    if (spResponse.ResponseCode === 200) return responseHelper.success(res, message, spResponse);
    return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, failMessage);
  }
}

const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const number = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);
const gstin = (v) => text(v)?.toUpperCase().replace(/\s+/g, "") ?? null;
const isoDay = (s) => (typeof s === "string" && parseDay(s) ? s : null);
const plainObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const tooLong = (html) => typeof html === "string" && html.length > MAX_HTML;
const safeParse = (json) => {
  try { return plainObject(JSON.parse(json)); } catch { return {}; }
};

// Exactly the keys sp_SaveQuotation's OPENJSON reads. Anything else on a line
// — a total the client computed, a React key — is dropped here.
const toLine = (l) => ({
  productId: positiveInt(l?.productId),
  description: text(l?.description) ?? "",
  hsn: text(l?.hsn),
  qty: number(l?.qty),
  unit: text(l?.unit),
  rate: number(l?.rate),
  discountType: l?.discountType === "amt" ? "amt" : "pct",
  discountValue: number(l?.discountValue),
  taxPct: number(l?.taxPct),
});

/** Body → the SP's parameters, or `{ error }`. No DB access. */
function readQuotation(body) {
  if (!TEMPLATE_CODES.includes(body.TemplateCode ?? "classic")) return { error: "Unknown template" };
  if (body.QuoteDate != null && body.QuoteDate !== "" && !isoDay(body.QuoteDate)) return { error: "QuoteDate must be YYYY-MM-DD" };
  if (body.ValidTill != null && body.ValidTill !== "" && !isoDay(body.ValidTill)) return { error: "ValidTill must be YYYY-MM-DD" };

  const state = text(body.ToStateCode);
  if (state && !/^\d{2}$/.test(state)) return { error: "Place of supply must be a 2-digit state code" };

  if (body.Lines != null && !Array.isArray(body.Lines)) return { error: "Lines must be a list" };
  const lines = (body.Lines ?? []).map(toLine);
  if (lines.length > MAX_LINES) return { error: `A quotation can hold at most ${MAX_LINES} lines` };

  const content = plainObject(body.Content);
  if (tooLong(content.intro)) return { error: "The opening message is too long" };
  if (tooLong(content.terms)) return { error: "The terms are too long" };
  if (tooLong(content.notes)) return { error: "The notes are too long" };
  const sections = Array.isArray(content.sections) ? content.sections : [];
  if (sections.some((s) => tooLong(s?.body))) return { error: "An extra section is too long" };

  const to = { ToMobile: body.ToMobile };
  const mobileError = applyMobiles(to, [["ToMobile", "Mobile number"]]);
  if (mobileError) return { error: mobileError };

  const company = plainObject(body.Company);
  return {
    params: {
      TemplateCode: body.TemplateCode ?? "classic",
      QuoteDate: isoDay(body.QuoteDate),
      ValidTill: isoDay(body.ValidTill),
      Subject: text(body.Subject),
      ToName: text(body.ToName),
      ToCompany: text(body.ToCompany),
      ToMobile: to.ToMobile,
      ToEmail: text(body.ToEmail),
      ToAddress: text(body.ToAddress),
      ToCity: text(body.ToCity),
      ToStateCode: state,
      ToPincode: text(body.ToPincode),
      ToGSTIN: gstin(body.ToGSTIN),
      // The SP derives the seller's state from the GSTIN and ignores this when
      // there is one; it only matters for an unregistered seller.
      SellerGSTIN: gstin(company.gstin),
      SellerStateCode: text(company.stateCode),
      CompanyJSON: JSON.stringify(company),
      ContentJSON: JSON.stringify({ ...content, sections }),
      LinesJSON: JSON.stringify(lines),
    },
  };
}

// Exactly the columns sp_SaveQuoteProfile accepts, in its order.
const PROFILE_TEXT = [
  "CompanyName", "Address", "City", "StateCode", "Pincode", "GSTIN", "Phone", "Email", "Website",
  "BankDetails", "DefaultIntro", "DefaultTerms", "SignatoryName",
];

// Every lifecycle move is the same two steps: gate on the quotation (which
// gates on its lead), then hand the SP the three ids it needs.
async function gateQuotation(req, res) {
  const QuotationId = positiveInt(req.body.QuotationId);
  if (!QuotationId) {
    responseHelper.validationError(res, "QuotationId is required");
    return null;
  }
  return (await assertRecordAccess(req, res, "quotation", QuotationId, "write")) ? QuotationId : null;
}

// Both profile endpoints name a LEAD, and the branch comes from it — never from
// req.user.BranchId. A regional manager quoting for a Mumbai lead must get
// Mumbai's letterhead and GSTIN, not their own office's.
async function gateLeadBranch(req, res) {
  const LeadId = positiveInt(req.body.LeadId);
  if (!LeadId) {
    responseHelper.validationError(res, "LeadId is required");
    return null;
  }
  const lead = await assertRecordAccess(req, res, "lead", LeadId, "write");
  return lead ? lead.BranchId : null;
}

const quotationController = {
  async save(req, res) {
    const { CompId, UserId } = req.user;
    const Id = positiveInt(req.body.Id) ?? 0;
    let LeadId = positiveInt(req.body.LeadId);

    if (Id === 0 && !LeadId) return responseHelper.validationError(res, "LeadId is required");
    const read = readQuotation(req.body);
    if (read.error) return responseHelper.validationError(res, read.error);

    if (Id > 0) {
      // Gate on the quotation itself, and keep it on ITS lead: the body cannot
      // move a quotation to a lead the caller happens to be able to see.
      const quote = await assertRecordAccess(req, res, "quotation", Id, "write");
      if (!quote) return;
      LeadId = quote.LeadId;
    } else if (!(await assertRecordAccess(req, res, "lead", LeadId, "write"))) return;

    return runSp(res, "sp_SaveQuotation", { Id, CompId, UserId, LeadId, ...read.params }, "Failed to save quotation");
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const { SearchTerm = null, Status = null, OwnerId = null, BranchId = null, LeadId = null, FromDate = null, ToDate = null } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      const result = await database.executeStoredProcedure("sp_FetchQuotations", {
        CompId,
        PageNumber,
        PageSize,
        SearchTerm: text(SearchTerm),
        Status: STATUSES.includes(Status) ? Status : null,
        OwnerId: positiveInt(OwnerId),
        BranchId: positiveInt(BranchId),
        LeadId: positiveInt(LeadId),
        FromDate: isoDay(FromDate),
        ToDate: isoDay(ToDate),
        ...scopeParams(req),
      });

      const quotations = result.recordsets?.[0] ?? [];
      const pagination = result.recordsets?.[1]?.[0] ?? {};
      return responseHelper.success(res, "Quotations fetched successfully", {
        quotations,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? quotations.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchQuotations error:", err);
      return responseHelper.error(res, "Failed to fetch quotations");
    }
  },

  async detail(req, res) {
    const { CompId } = req.user;
    const QuotationId = positiveInt(req.body.QuotationId);
    if (!QuotationId) return responseHelper.validationError(res, "QuotationId is required");
    try {
      const result = await database.executeStoredProcedure("sp_FetchQuotationDetail", {
        CompId,
        QuotationId,
      });
      const rs = result.recordsets ?? [];
      const row = rs[0]?.[0] || null;
      // RS1 carries the LEAD's OwnerId / BranchId / CreatedBy. 404 rather than
      // 403: a user who cannot see a lead should not learn it has quotations.
      if (!canSeeRecord(req, row, "OwnerId")) {
        return responseHelper.error(res, "Quotation not found", "NOT_FOUND", 404);
      }
      const { CompanyJSON, ContentJSON, ...quotation } = row;
      return responseHelper.success(res, "Quotation fetched successfully", {
        quotation: { ...quotation, Company: safeParse(CompanyJSON), Content: safeParse(ContentJSON) },
        lines: rs[1] || [],
        revisions: rs[2] || [],
      });
    } catch (err) {
      console.error("sp_FetchQuotationDetail error:", err);
      return responseHelper.error(res, "Failed to fetch quotation");
    }
  },

  async finalise(req, res) {
    const QuotationId = await gateQuotation(req, res);
    if (!QuotationId) return;
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_FinaliseQuotation", { CompId, QuotationId, UserId }, "Failed to finalise quotation");
  },

  async revise(req, res) {
    const QuotationId = await gateQuotation(req, res);
    if (!QuotationId) return;
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_ReviseQuotation", { CompId, QuotationId, UserId }, "Failed to revise quotation");
  },

  async reject(req, res) {
    const QuotationId = await gateQuotation(req, res);
    if (!QuotationId) return;
    const { CompId, UserId } = req.user;
    const Remarks = text(req.body.Remarks);
    return runSp(res, "sp_RejectQuotation", { CompId, QuotationId, UserId, Remarks }, "Failed to reject quotation");
  },

  // Drafts only — the SP answers 409 for anything issued. On success the
  // pictures uploaded to the draft go too (they have no other owner).
  async remove(req, res) {
    const QuotationId = await gateQuotation(req, res);
    if (!QuotationId) return;
    const { CompId } = req.user;
    try {
      const result = await database.executeStoredProcedure("sp_DeleteQuotation", {
        CompId,
        QuotationId,
      });
      const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
      const message = spResponse.ResponseMess || spResponse.ResponseMessage;
      if (spResponse.ResponseCode !== 200) {
        return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
      }
      await attachmentController.cascadeDelete(CompId, "quotation", QuotationId);
      return responseHelper.success(res, message, spResponse);
    } catch (err) {
      console.error("sp_DeleteQuotation error:", err);
      return responseHelper.error(res, "Failed to delete quotation");
    }
  },

  // A fetch that creates (sp_EnsureQuoteProfile): the builder needs the branch's
  // row to exist before anyone has saved anything, because a logo upload needs
  // an EntityId to hang off.
  async ensureProfile(req, res) {
    const BranchId = await gateLeadBranch(req, res);
    if (!BranchId) return;
    const { CompId, UserId } = req.user;
    try {
      const result = await database.executeStoredProcedure("sp_EnsureQuoteProfile", {
        CompId,
        BranchId,
        UserId,
      });
      const profile = result.recordsets?.[0]?.[0] ?? null;
      return responseHelper.success(res, "Quote profile fetched successfully", { profile });
    } catch (err) {
      console.error("sp_EnsureQuoteProfile error:", err);
      return responseHelper.error(res, "Failed to fetch quote profile");
    }
  },

  // The remembered default. WHO may change it lives in the SP, next to the
  // IsSet flag it depends on: open while unset, admins only afterwards. IsAdmin
  // comes from the loaded scope — never from the body.
  async saveProfile(req, res) {
    const b = req.body;
    // Cheap checks first, in the order a user would hit them; the lead gate
    // (one DB round-trip) only runs once the body is worth saving.
    if (!positiveInt(b.LeadId)) return responseHelper.validationError(res, "LeadId is required");
    if (!text(b.CompanyName)) return responseHelper.validationError(res, "Company name is required");
    if (b.DefaultTemplate != null && b.DefaultTemplate !== "" && !TEMPLATE_CODES.includes(b.DefaultTemplate)) {
      return responseHelper.validationError(res, "Unknown template");
    }
    if (tooLong(b.DefaultIntro)) return responseHelper.validationError(res, "The default opening message is too long");
    if (tooLong(b.DefaultTerms)) return responseHelper.validationError(res, "The default terms are too long");

    const BranchId = await gateLeadBranch(req, res);
    if (!BranchId) return;
    const { CompId, UserId } = req.user;
    const fields = Object.fromEntries(PROFILE_TEXT.map((k) => [k, text(b[k])]));
    fields.GSTIN = gstin(b.GSTIN);
    const IsAdmin = req.scope?.isAdmin ? 1 : 0;
    const LogoAttachmentId = positiveInt(b.LogoAttachmentId);
    const HeaderAttachmentId = positiveInt(b.HeaderAttachmentId);
    const AccentColor = text(b.AccentColor);
    const DefaultTemplate = text(b.DefaultTemplate);
    return runSp(
      res,
      "sp_SaveQuoteProfile",
      { CompId, BranchId, UserId, IsAdmin, ...fields, LogoAttachmentId, HeaderAttachmentId, AccentColor, DefaultTemplate },
      "Failed to save company details",
    );
  },
};

module.exports = quotationController;
module.exports.TEMPLATE_CODES = TEMPLATE_CODES;
module.exports.MAX_HTML = MAX_HTML;
module.exports.MAX_LINES = MAX_LINES;
