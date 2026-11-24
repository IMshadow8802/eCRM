// src/controllers/callingController.js
//
// Calling lists (149), the manager side: lists, callers, import, the pool, hand-outs.
// Every call passes the person from actor(req) and nothing else about them: which
// lists, offices and people are allowed is the procedure's answer (fn_VisibleCallLists,
// fn_AssignableUsers 'leads'), relayed with its sentence. Cost goes to admins only.
const database = require("../config/database");
const { asyncRoute, firstRow, spStatus, spOk, spMessage, pageParams, positiveInt } = require("../utils/controllerKit");
const { success, error, validationError } = require("../utils/responseHelper");
const { actor } = require("../utils/actor");
const { parseDay } = require("../utils/reportKit");
const { cleanRows, MAX_CHUNK } = require("../utils/callingImport");
const { pagination, withExtras } = require("../services/callingService");
const { emitToUser } = require("../realtime/events");
const { SCOPES } = require("../realtime/contract");

const REASONS = { bad: "Bad number", repeated: "Repeated in sheet", dnc: "Do not call", pool: "Already in pool",
  lead: "Already a lead", customer: "Already a customer" };
const CONTACT_STATUSES = ["pool", "held", "callback", "lead", "closed"];
const LIST_STATUSES = ["active", "paused", "archived"];
const ACTIONS = ["remove", "recycle", "move", "priority"];
const MAX_IDS = 500;

const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const bit = (v) => (v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);
const optBit = (v) => (v == null ? null : bit(v));
const optInt = (v) => (v == null || v === "" ? null : Number.isInteger(Number(v)) ? Number(v) : null);
const ids = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(positiveInt).filter(Boolean))];
const NOT_FOUND = "Calling list not found";

// Status row → the reply; `data` shapes a success.
const relay = (res, row, data = (r) => r) => (spOk(row)
  ? success(res, spMessage(row, "Done"), data(row), spStatus(row))
  : error(res, spMessage(row, "Request failed"), "SP_ERROR", spStatus(row)));

const hideCost = (req) => (row) => ({ ...row, Cost: req.scope?.isAdmin ? row.Cost ?? null : null });

// Shared by importContacts and addContact. Extra travels as a JSON object: the
// procedure reads it with OPENJSON ... AS JSON, which drops a string.
async function importRows(CompId, UserId, CallListId, rows, DryRun) {
  const RowsJson = JSON.stringify(cleanRows(rows).map((r) => ({ ...r, RowNo: positiveInt(r.RowNo), Extra: r.Extra ? JSON.parse(r.Extra) : null })));
  const result = await database.executeStoredProcedure("sp_ImportCallContacts", { CompId, UserId, CallListId, RowsJson, DryRun });
  const counts = firstRow(result);
  const skipped = (result?.recordsets?.[1] ?? []).map((s) => ({ RowNo: s.RowNo, Reason: REASONS[s.Reason] ?? s.Reason }));
  return { counts, skipped };
}

module.exports = {
  fetchLists: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body || {};
    const Id = positiveInt(b.Id);
    const { PageNumber, PageSize } = pageParams(b, 25);
    const result = await database.executeStoredProcedure("sp_FetchCallLists", { CompId, UserId, Id,
      Status: LIST_STATUSES.includes(b.Status) ? b.Status : null, SearchTerm: text(b.SearchTerm), PageNumber, PageSize });
    const lists = (result?.recordsets?.[0] ?? []).map(hideCost(req));
    if (Id) {
      if (!lists.length) return error(res, NOT_FOUND, "SP_ERROR", 404);
      return success(res, "Calling list fetched", { list: lists[0], callers: result.recordsets[2] ?? [] });
    }
    return success(res, "Calling lists fetched", { lists, pagination: pagination(result, PageNumber, PageSize, lists.length) });
  }, "Failed to fetch calling lists", "CALL_LISTS_FETCH_ERROR"),

  saveList: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const PurchasedOn = text(b.PurchasedOn);
    if (PurchasedOn && !parseDay(PurchasedOn)) return validationError(res, "Purchase date must be YYYY-MM-DD");
    const Cost = b.Cost == null || b.Cost === "" ? null : Number(b.Cost);
    if (Cost != null && !Number.isFinite(Cost)) return validationError(res, "Cost must be a number");
    const result = await database.executeStoredProcedure("sp_SaveCallList", {
      CompId, UserId, Id: positiveInt(b.Id) ?? 0, BranchId: positiveInt(b.BranchId), Name: text(b.Name),
      Vendor: text(b.Vendor), PurchasedOn, Cost, ProductId: positiveInt(b.ProductId), Script: text(b.Script),
      // An explicit NULL would beat the procedure's defaults (and fail its range check), so they are applied here.
      AutoTopUp: optBit(b.AutoTopUp), HoldSize: optInt(b.HoldSize) ?? 10, MaxAttempts: optInt(b.MaxAttempts) ?? 3,
      RetryGapHours: optInt(b.RetryGapHours) ?? 4, Status: text(b.Status),
    });
    return relay(res, firstRow(result));
  }, "Failed to save calling list", "CALL_LIST_SAVE_ERROR"),

  deleteList: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const Id = positiveInt(req.body.Id);
    if (!Id) return validationError(res, "Pick a list");
    return relay(res, firstRow(await database.executeStoredProcedure("sp_DeleteCallList", { CompId, UserId, Id })));
  }, "Failed to delete calling list", "CALL_LIST_DELETE_ERROR"),

  saveCallers: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const CallListId = positiveInt(req.body.CallListId);
    const callers = (Array.isArray(req.body.Callers) ? req.body.Callers : [])
      .filter((x) => positiveInt(x?.UserId))
      .map((x) => ({ UserId: positiveInt(x.UserId), HoldSize: optInt(x.HoldSize), IsPaused: bit(x.IsPaused), Remove: bit(x.Remove) }));
    if (!CallListId) return validationError(res, "Pick a list");
    if (!callers.length) return validationError(res, "Pick at least one caller");
    return relay(res, firstRow(await database.executeStoredProcedure("sp_SaveCallListCallers", { CompId, UserId, CallListId, CallersJson: JSON.stringify(callers) })));
  }, "Failed to save callers", "CALL_CALLERS_SAVE_ERROR"),

  importContacts: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const CallListId = positiveInt(req.body.CallListId);
    const rows = req.body.rows;
    if (!CallListId) return validationError(res, "Pick a list");
    if (!Array.isArray(rows) || !rows.length) return validationError(res, "No rows to import");
    if (rows.length > MAX_CHUNK) return validationError(res, `At most ${MAX_CHUNK} rows at once`);
    if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r) && positiveInt(r.RowNo))) {
      return validationError(res, "Every row needs a row number");
    }
    const DryRun = req.body.DryRun === false || req.body.DryRun === 0 ? 0 : 1;
    const { counts, skipped } = await importRows(CompId, UserId, CallListId, rows, DryRun);
    return relay(res, counts, () => ({ counts, skipped }));
  }, "Failed to import contacts", "CALL_IMPORT_ERROR"),

  addContact: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const CallListId = positiveInt(b.CallListId);
    if (!CallListId) return validationError(res, "Pick a list");
    const row = { RowNo: 1, Name: b.Name, Mobile: b.Mobile, AltMobile: b.AltMobile, Company: b.Company, City: b.City };
    if (!cleanRows([row])[0].Mobile) return validationError(res, "Mobile number must be 10 digits starting 6 to 9");
    const { counts, skipped } = await importRows(CompId, UserId, CallListId, [row], 0);
    if (spOk(counts) && skipped.length) return error(res, skipped[0].Reason, "CONTACT_SKIPPED", 409);
    return relay(res, counts, () => ({ counts, skipped }));
  }, "Failed to add contact", "CALL_ADD_CONTACT_ERROR"),

  fetchContacts: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const CallListId = positiveInt(b.CallListId);
    if (!CallListId) return validationError(res, "Pick a list");
    if (b.Status != null && b.Status !== "" && !CONTACT_STATUSES.includes(b.Status)) return validationError(res, "Unknown status");
    const { PageNumber, PageSize } = pageParams(b, 25);
    const result = await database.executeStoredProcedure("sp_FetchCallContacts", {
      CompId, UserId, CallListId, Status: text(b.Status), HeldBy: positiveInt(b.HeldBy), LastResult: text(b.LastResult),
      City: text(b.City), Stale: bit(b.Stale), Missed: bit(b.Missed), SearchTerm: text(b.SearchTerm), PageNumber, PageSize,
    });
    const first = firstRow(result);
    if (first?.ResponseCode != null && !spOk(first)) return relay(res, first);
    const contacts = result?.recordsets?.[0] ?? [];
    return success(res, "Contacts fetched", { contacts, pagination: pagination(result, PageNumber, PageSize, contacts.length) });
  }, "Failed to fetch contacts", "CALL_CONTACTS_FETCH_ERROR"),

  contactHistory: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const ContactId = positiveInt(req.body.ContactId);
    if (!ContactId) return validationError(res, "Pick a contact");
    const result = await database.executeStoredProcedure("sp_FetchCallContactHistory", { CompId, UserId, ContactId });
    const contact = firstRow(result);
    // Empty when the contact's list is out of view: never confirm it exists.
    if (!contact) return error(res, "Contact not found", "SP_ERROR", 404);
    return success(res, "Contact fetched", { contact: withExtras([contact])[0], attempts: result.recordsets[1] ?? [] });
  }, "Failed to fetch contact history", "CALL_HISTORY_FETCH_ERROR"),

  assign: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const CallListId = positiveInt(b.CallListId);
    if (!CallListId) return validationError(res, "Pick a list");
    let AssignJson = null, ContactIdsJson = null, ToUserId = null;
    if (Array.isArray(b.ContactIds)) {
      const list = ids(b.ContactIds);
      ToUserId = positiveInt(b.ToUserId);
      if (!list.length || !ToUserId) return validationError(res, "Pick the contacts and the person to give them to");
      if (list.length > MAX_IDS) return validationError(res, `At most ${MAX_IDS} contacts at once`);
      ContactIdsJson = JSON.stringify(list);
    } else {
      const split = (Array.isArray(b.Assign) ? b.Assign : [])
        .map((x) => ({ UserId: positiveInt(x?.UserId), Count: positiveInt(x?.Count) }))
        .filter((x) => x.UserId && x.Count);
      if (!split.length) return validationError(res, "Say who gets how many");
      AssignJson = JSON.stringify(split);
    }
    const result = await database.executeStoredProcedure("sp_AssignCallContacts", { CompId, UserId, CallListId, AssignJson, ContactIdsJson, ToUserId });
    const row = firstRow(result);
    if (spOk(row)) for (const n of result.recordsets?.[2] ?? []) emitToUser(n.UserId, SCOPES.NOTIFICATIONS);
    return relay(res, row, (r) => ({ Given: r.Given, Asked: r.Asked, perCaller: result.recordsets?.[1] ?? [] }));
  }, "Failed to give out contacts", "CALL_ASSIGN_ERROR"),

  recall: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const CallListId = positiveInt(b.CallListId);
    if (!CallListId) return validationError(res, "Pick a list");
    const list = ids(b.ContactIds);
    const result = await database.executeStoredProcedure("sp_RecallCallContacts", { CompId, UserId, CallListId, FromUserId: positiveInt(b.FromUserId),
      ContactIdsJson: list.length ? JSON.stringify(list) : null, IncludeCallbacks: bit(b.IncludeCallbacks) });
    return relay(res, firstRow(result), (r) => ({ Recalled: r.Recalled }));
  }, "Failed to pull back contacts", "CALL_RECALL_ERROR"),

  setState: asyncRoute(async (req, res) => {
    const { CompId, UserId } = actor(req);
    const b = req.body;
    const CallListId = positiveInt(b.CallListId);
    const list = ids(b.ContactIds);
    const ToUserId = positiveInt(b.ToUserId);
    if (!CallListId) return validationError(res, "Pick a list");
    if (!ACTIONS.includes(b.Action)) return validationError(res, `Action must be one of ${ACTIONS.join(", ")}`);
    if (!list.length) return validationError(res, "Pick at least one contact");
    if (list.length > MAX_IDS) return validationError(res, `At most ${MAX_IDS} contacts at once`);
    if (b.Action === "move" && !ToUserId) return validationError(res, "Pick the person to move them to");
    const result = await database.executeStoredProcedure("sp_SetCallContactState", { CompId, UserId, CallListId, ContactIdsJson: JSON.stringify(list),
      Action: b.Action, ToUserId: b.Action === "move" ? ToUserId : null });
    return relay(res, firstRow(result), (r) => ({ Changed: r.Changed }));
  }, "Failed to change contacts", "CALL_SET_STATE_ERROR"),
};
