// src/controllers/phoneMarkController.js
//
// Do-not-call and caution marks on a phone number (149, spec U6). A mark belongs to
// the number, never a row; sp_SetPhoneMark applies it everywhere. Source is decided
// here from the role, never taken from the body.
const database = require("../config/database");
const { asyncRoute, firstRow, spStatus, spOk, spMessage, pageParams, positiveInt } = require("../utils/controllerKit");
const { success, error, validationError } = require("../utils/responseHelper");
const { actor } = require("../utils/actor");
const { normalizeMobile, MOBILE_MESSAGE } = require("../utils/mobile");
const { pagination } = require("../services/callingService");

const MARKS = ["dnc", "caution"];
const MAX_NOTE = 500;
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const relay = (res, row) => (spOk(row)
  ? success(res, spMessage(row, "Done"), row, spStatus(row))
  : error(res, spMessage(row, "Request failed"), "SP_ERROR", spStatus(row)));

module.exports = {
  fetch: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body || {};
    const { PageNumber, PageSize } = pageParams(b, 25);
    const result = await database.executeStoredProcedure("sp_FetchPhoneMarks", {
      CompId, UserId, SearchTerm: text(b.SearchTerm), History: b.History === true || b.History === 1 ? 1 : 0, PageNumber, PageSize });
    const marks = result?.recordsets?.[0] ?? [];
    return success(res, "Marks fetched", { marks, pagination: pagination(result, PageNumber, PageSize, marks.length) });
  }, "Failed to fetch marks", "PHONE_MARK_FETCH_ERROR"),

  // Route: calling edit (list managers; admins have it).
  set: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const Mobile = normalizeMobile(b.Mobile);
    if (!Mobile) return validationError(res, MOBILE_MESSAGE);
    if (!MARKS.includes(b.Mark)) return validationError(res, "Mark must be dnc or caution");
    const Note = text(b.Note);
    if (!Note) return validationError(res, "A note is required");
    if (Note.length > MAX_NOTE) return validationError(res, `A note can be at most ${MAX_NOTE} characters`);
    const result = await database.executeStoredProcedure("sp_SetPhoneMark", {
      CompId, UserId, Mobile, Mark: b.Mark, Note, Source: req.access?.isAdmin ? "admin" : "caller" });
    return relay(res, firstRow(result));
  }, "Failed to mark the number", "PHONE_MARK_SET_ERROR"),

  clear: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const Id = positiveInt(req.body.Id);
    const ClearNote = text(req.body.ClearNote);
    if (!Id) return validationError(res, "Pick a mark");
    if (!ClearNote) return validationError(res, "A note is required");
    return relay(res, firstRow(await database.executeStoredProcedure("sp_ClearPhoneMark", { CompId, UserId, Id, ClearNote })));
  }, "Failed to clear the mark", "PHONE_MARK_CLEAR_ERROR"),
};
