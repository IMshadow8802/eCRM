// src/controllers/callingCallerController.js
//
// Calling lists (149), the caller side. A caller sees only what they hold now: the
// holding rule lives in the procedures (HeldBy = @UserId), and this controller adds
// no way round it — the person comes from actor(req) only, and there is no endpoint
// that fetches a contact by id, lists a list's contacts or searches.
const database = require("../config/database");
const { asyncRoute, firstRow, spStatus, spOk, spMessage, positiveInt, istDateTime, optionalDateTime } = require("../utils/controllerKit");
const { success, error, validationError } = require("../utils/responseHelper");
const { actor } = require("../utils/actor");
const { shapeMyList, releaseAtFor } = require("../services/callingService");
const { toSqlIst, dateKey, addDays } = require("../utils/workCalendar");

const RESULTS = ["no_answer", "busy", "not_interested", "wrong_number", "callback", "dnc"];
const MAX_NOTE = 1000;
const note = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
// Present and valid → the SP value; absent → null; present but invalid → undefined (400).
const optionalInstant = (v) => (v == null || v === "" ? null : istDateTime(v) ?? undefined);
// The SP value back to a Date: it is IST wall clock.
const istDate = (s) => new Date(`${s.replace(" ", "T")}+05:30`);

const fetchList = async (CompId, UserId, TopUp) =>
  shapeMyList(await database.executeStoredProcedure("sp_FetchMyCallList", { CompId, UserId, TopUp }));

// After a write: 2xx → the fresh list (plus `extra`); 409 → the sentence and the fresh list (same TopUp),
// so the phone refetches nothing; anything else (404 "Contact not found") → the sentence only.
async function afterWrite(res, row, CompId, UserId, TopUp, extra = {}) {
  const code = spStatus(row);
  if (spOk(row)) {
    const list = await fetchList(CompId, UserId, TopUp);
    // The save ran the top-up itself; the re-read (TopUp 0) cannot know how many it gave.
    if (row.Given > 0) list.head = { ...list.head, Given: row.Given };
    return success(res, spMessage(row, "Saved"), { ...extra, ...list }, code);
  }
  if (code === 409) {
    const data = await fetchList(CompId, UserId, TopUp); // convert: the contact closed, so top up (saveResult / undo pass 0)
    return res.status(409).json({ success: false, message: spMessage(row, "This contact is no longer on your list"),
      code: "SP_ERROR", responseCode: 409, data, timestamp: new Date().toISOString() });
  }
  return error(res, spMessage(row, "Request failed"), "SP_ERROR", code);
}

module.exports = {
  myList: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    // Only the calling screen tops up; Home reads with TopUp 0. Anything but 0 means 1.
    const TopUp = req.body?.TopUp === 0 ? 0 : 1;
    return success(res, "Calling list fetched", await fetchList(CompId, UserId, TopUp));
  }, "Failed to fetch your calling list", "CALL_MY_LIST_ERROR"),

  saveResult: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const ContactId = positiveInt(b.ContactId);
    if (!ContactId) return validationError(res, "Pick a contact");
    if (b.Result === "interested") return validationError(res, "Use convert for an interested contact");
    if (!RESULTS.includes(b.Result)) return validationError(res, "Unknown result");
    const Notes = note(b.Notes);
    if (Notes && Notes.length > MAX_NOTE) return validationError(res, `A note can be at most ${MAX_NOTE} characters`);
    if (b.Result === "dnc" && !Notes) return validationError(res, "A note is required for do not call");
    const DialedAt = optionalInstant(b.DialedAt);
    if (DialedAt === undefined) return validationError(res, "Dial time is not valid");
    const CallbackAt = optionalInstant(b.CallbackAt);
    if (CallbackAt === undefined) return validationError(res, "Callback time is not valid");
    if (CallbackAt && b.Result !== "callback") return validationError(res, "A callback time goes only with call back");
    const release = CallbackAt ? await releaseAtFor(CompId, UserId, istDate(CallbackAt)) : null;
    const result = await database.executeStoredProcedure("sp_SaveCallResult", {
      CompId, UserId, ContactId, Result: b.Result, Notes, DialedAt, CallbackAt,
      CallbackReleaseAt: release ? toSqlIst(release) : null,
    });
    const row = firstRow(result);
    return afterWrite(res, row, CompId, UserId, 0, { AttemptId: row?.Id });
  }, "Failed to save the result", "CALL_SAVE_RESULT_ERROR"),

  convert: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const ContactId = positiveInt(b.ContactId);
    if (!ContactId) return validationError(res, "Pick a contact");
    const Remarks = note(b.Notes);
    if (Remarks && Remarks.length > MAX_NOTE) return validationError(res, `A note can be at most ${MAX_NOTE} characters`);
    const FirstFollowupAt = optionalDateTime(b.FirstFollowupAt);
    if (FirstFollowupAt === undefined) return validationError(res, "Follow-up date is not valid");
    const CallDialedAt = optionalInstant(b.DialedAt);
    if (CallDialedAt === undefined) return validationError(res, "Dial time is not valid");
    // Number, owner, source, product and office come from the contact inside sp_SaveLead, never from the body.
    const result = await database.executeStoredProcedure("sp_SaveLead", {
      Id: 0, CompId, BranchId: req.access?.primaryBranchId ?? null, UserId, Name: note(b.Name), Remarks,
      FirstFollowupAt: FirstFollowupAt ?? addDays(dateKey(new Date()), 1), CallContactId: ContactId, CallDialedAt,
    });
    const row = firstRow(result);
    return afterWrite(res, row, CompId, UserId, 1, { LeadId: row?.Id });
  }, "Failed to turn the contact into a lead", "CALL_CONVERT_ERROR"),

  undoResult: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const AttemptId = positiveInt(req.body.AttemptId);
    if (!AttemptId) return validationError(res, "Pick a call to undo");
    const result = await database.executeStoredProcedure("sp_UndoCallResult", { CompId, UserId, AttemptId });
    return afterWrite(res, firstRow(result), CompId, UserId, 0);
  }, "Failed to undo the result", "CALL_UNDO_ERROR"),
};
