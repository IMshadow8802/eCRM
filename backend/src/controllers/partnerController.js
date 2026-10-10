// src/controllers/partnerController.js
//
// Partners (company-wide, the `partners` module) and their commission. Commission
// rows are written inside the lead procs (save / convert / set status) and by sp_SetCommissionStatus here; nothing else.
const database = require("../config/database");
const { asyncRoute, positiveInt } = require("../utils/controllerKit");
const { success, error, validationError } = require("../utils/responseHelper");
const { applyMobiles } = require("../utils/mobile");
const { parseDay } = require("../utils/reportKit");
const { scopeFor } = require("../middleware/permission");
const { termsError } = require("../utils/commission");

const STATUSES = ["earned", "due", "paid", "cancelled"];
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());

const idsJson = (ids) => JSON.stringify([...new Set((Array.isArray(ids) ? ids : []).map(positiveInt).filter(Boolean))]);

const reply = (res, row) => (row?.ResponseCode === 200
  ? success(res, row.ResponseMess, row)
  : error(res, row?.ResponseMess || "Request failed", "SP_ERROR", row?.ResponseCode || 500));
const firstRow = (result) => result?.recordset?.[0] ?? result?.recordsets?.[0]?.[0];

module.exports = {
  // One endpoint for the Partners page and the lead-form dropdown. Route is open();
  // the gate is here: leads view or partners view. Without partners view the
  // caller gets active partners by name and city only - never terms or stats.
  fetchPartners: asyncRoute(async (req, res) => {
    const full = scopeFor(req, "partners").can.view;
    if (!full && !scopeFor(req, "leads").can.view) return error(res, "Access denied", "FORBIDDEN", 403);
    const result = await database.executeStoredProcedure("sp_FetchPartners", {
      CompId: req.user.CompId,
      IncludeInactive: full && req.body.IncludeInactive ? 1 : 0,
      WithStats: full && req.body.Stats !== false ? 1 : 0,
    });
    const rows = result.recordsets?.[0] ?? [];
    return success(res, "Partners fetched", {
      partners: full ? rows : rows.map(({ Id, Name, City }) => ({ Id, Name, City })) });
  }, "Failed to fetch partners", "PARTNERS_FETCH_ERROR"),

  savePartner: asyncRoute(async (req, res) => {
    const b = req.body;
    const fields = { Mobile: text(b.Mobile) };
    const mobileError = applyMobiles(fields, [["Mobile", "Mobile number"]]);
    if (mobileError) return validationError(res, mobileError);
    if (!text(b.Name)) return validationError(res, "Partner name is required");
    const CommType = text(b.CommType);
    const CommValue = b.CommValue == null || b.CommValue === "" ? null : Number(b.CommValue);
    const bad = termsError(CommType, CommValue);
    if (bad) return validationError(res, bad);
    const result = await database.executeStoredProcedure("sp_SavePartner", {
      Id: positiveInt(b.Id) ?? 0, CompId: req.user.CompId, UserId: req.user.UserId,
      Name: text(b.Name), ContactPerson: text(b.ContactPerson), Mobile: fields.Mobile,
      Email: text(b.Email), City: text(b.City), Notes: text(b.Notes),
      CommType, CommValue, IsActive: b.IsActive === false || b.IsActive === 0 ? 0 : 1,
    });
    return reply(res, firstRow(result));
  }, "Failed to save partner", "PARTNER_SAVE_ERROR"),

  fetchCommissions: asyncRoute(async (req, res) => {
    const { PartnerId, Status, FromDate, ToDate } = req.body;
    if (Status != null && !STATUSES.includes(Status)) return validationError(res, `Status must be one of ${STATUSES.join(", ")}`);
    const day = (s) => (s && parseDay(s) ? s : null);
    const result = await database.executeStoredProcedure("sp_FetchCommissions", {
      CompId: req.user.CompId, PartnerId: positiveInt(PartnerId), Status: Status ?? null,
      FromDate: day(FromDate), ToDate: day(ToDate),
    });
    return success(res, "Commissions fetched", { commissions: result.recordsets?.[0] ?? [] });
  }, "Failed to fetch commissions", "COMMISSIONS_FETCH_ERROR"),

  setCommissionStatus: asyncRoute(async (req, res) => {
    const { ToStatus, PaidAt, PaidRef } = req.body;
    const IdsJson = idsJson(req.body.Ids);
    if (IdsJson === "[]") return validationError(res, "Pick at least one commission");
    if (!["due", "paid"].includes(ToStatus)) return validationError(res, "Unknown status");
    const paid = ToStatus === "paid";
    if (paid && !parseDay(PaidAt)) return validationError(res, "Payment date must be YYYY-MM-DD");
    const result = await database.executeStoredProcedure("sp_SetCommissionStatus", {
      CompId: req.user.CompId, UserId: req.user.UserId, IdsJson, ToStatus,
      PaidAt: paid ? PaidAt : null, PaidRef: paid ? text(PaidRef) : null });
    return reply(res, firstRow(result));
  }, "Failed to update commission", "COMMISSION_STATUS_ERROR"),
};
