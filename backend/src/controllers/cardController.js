// src/controllers/cardController.js
//
// Visiting cards from the VisiScan app (ported from JRS cardController). The app's
// contract is fixed: any non-2xx makes it retry later, so a repeat or a stale save
// answers 200. Photos live on disk under uploads/cards/<id>/ (utils/cardPhotos)
// and are served only through cardPhoto, never as static files.
const path = require("path");
const { z } = require("zod");
const database = require("../config/database");
const { asyncRoute, firstRow, spStatus, spMessage, pageParams } = require("../utils/controllerKit");
const { success, error } = require("../utils/responseHelper");
const { scopeFor, scopeParams } = require("../middleware/permission");
const { HttpError, readForm, readPhoto, writePhoto, removePhoto, photoFile } = require("../utils/cardPhotos");

const jsonList = z.preprocess(
  (s) => { try { return JSON.parse(s); } catch { return s; } },
  z.array(z.string().trim().max(500), { error: "must be a JSON array of text" }).max(50)
);
const appDate = z.string().trim().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 date")
  .transform((s) => new Date(s).toISOString());
const cardFields = z.object({
  id: z.uuid(),
  businessName: z.string().trim().max(200),
  contactPerson: z.string().trim().max(150),
  designation: z.string().trim().max(150),
  website: z.string().trim().max(300),
  gstin: z.string().trim().max(50),
  description: z.string().trim().max(4000),
  other: z.string().trim().max(4000),
  notes: z.string().trim().max(4000),
  mobiles: jsonList, landlines: jsonList, emails: jsonList, addresses: jsonList,
  createdAt: appDate,
  updatedAt: appDate,
});
const isUuid = (v) => z.uuid().safeParse(v).success;
const badId = (res) => error(res, "The card id is not valid.", "CARD_INVALID", 400);

async function writeCard(req, res) {
  const form = await readForm(req);
  const raw = {};
  for (const key of Object.keys(cardFields.shape)) { const v = form.get(key); raw[key] = typeof v === "string" ? v : undefined; }
  const parsed = cardFields.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, `${issue.path.join(".")}: ${issue.message}`);
  }
  const c = parsed.data;
  c.id = c.id.toLowerCase();
  const front = await readPhoto(form, "front", true);
  const back = await readPhoto(form, "back", false);

  // Photos go to disk first, then the row; a row not saved (error, repeat, stale, refused) takes them back off.
  const frontPath = await writePhoto(c.id, "front", front);
  let backPath = null;
  let row;
  try {
    if (back) backPath = await writePhoto(c.id, "back", back);
    row = firstRow(await database.executeStoredProcedure("sp_SaveVisitingCard", {
      Id: c.id, CompId: req.user.CompId, UserId: req.user.UserId, BranchId: Number(req.scope.primaryBranchId),
      BusinessName: c.businessName, ContactPerson: c.contactPerson, Designation: c.designation,
      Website: c.website, Gstin: c.gstin, Description: c.description, Other: c.other, Notes: c.notes,
      Mobiles: JSON.stringify(c.mobiles), Landlines: JSON.stringify(c.landlines),
      Emails: JSON.stringify(c.emails), Addresses: JSON.stringify(c.addresses),
      FrontPath: frontPath, BackPath: backPath, AppCreatedAt: c.createdAt, AppUpdatedAt: c.updatedAt,
      CanEditOthers: scopeFor(req, "cards").can.edit ? 1 : 0,
      ...scopeParams(req, "cards"),
    }));
  } finally {
    if (!row?.Saved) { await removePhoto(frontPath); if (backPath) await removePhoto(backPath); }
  }
  if (!row) return error(res, "Failed to save card", "CARD_SAVE_ERROR", 500);
  if (row.Saved) {
    // The card is saved; an old file that will not go is an orphan, not a failed save.
    for (const old of [row.OldFront, row.OldBack]) {
      if (old && old !== frontPath && old !== backPath) {
        try { await removePhoto(old); } catch (e) { console.error("CARD_OLD_PHOTO_REMOVE:", e); }
      }
    }
  }
  const code = spStatus(row);
  return code === 200 ? success(res, spMessage(row), { id: c.id }) : error(res, spMessage(row, "Failed to save card"), "CARD_SAVE_ERROR", code);
}

const parseList = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const iso = (d) => (d ? new Date(d).toISOString() : "");
const toCard = (r) => ({
  id: String(r.Id).toLowerCase(), businessName: r.BusinessName, contactPerson: r.ContactPerson, designation: r.Designation,
  mobiles: parseList(r.Mobiles), landlines: parseList(r.Landlines), emails: parseList(r.Emails), addresses: parseList(r.Addresses),
  website: r.Website, gstin: r.Gstin, description: r.Description, other: r.Other, notes: r.Notes,
  createdAt: iso(r.AppCreatedAt), updatedAt: iso(r.AppUpdatedAt),
  frontImage: r.FrontPath, backImage: r.BackPath || "", ownerName: r.OwnerName, receivedAt: r.ReceivedAt,
});

// One card (scoped) or null.
async function fetchOne(req, id) {
  const result = await database.executeStoredProcedure("sp_FetchVisitingCards", {
    CompId: req.user.CompId, Id: id, Search: "", PageNumber: 1, PageSize: 1, ...scopeParams(req, "cards") });
  return result.recordsets?.[1]?.[0] ?? null;
}

module.exports = {
  saveCard: asyncRoute(async (req, res) => {
    try {
      return await writeCard(req, res);
    } catch (e) {
      if (e instanceof HttpError) return error(res, e.message, "CARD_INVALID", e.status);
      throw e;
    }
  }, "Failed to save card", "CARD_SAVE_ERROR"),

  // { id } = one card; otherwise newest first, paged, with search. camelCase (the app) wins over PascalCase (the web).
  fetchCard: asyncRoute(async (req, res) => {
    const b = req.body || {};
    if (b.id != null && !isUuid(b.id)) return badId(res);
    const { PageNumber, PageSize } = pageParams({ PageNumber: b.pageNumber ?? b.PageNumber, PageSize: b.pageSize ?? b.PageSize }, 50);
    const result = await database.executeStoredProcedure("sp_FetchVisitingCards", {
      CompId: req.user.CompId, Id: b.id ?? null, Search: String(b.search ?? b.SearchTerm ?? "").trim().slice(0, 100),
      PageNumber, PageSize, ...scopeParams(req, "cards") });
    const rows = (result.recordsets?.[1] ?? []).map(toCard);
    if (b.id != null && !rows.length) return error(res, "Card not found", "NOT_FOUND", 404);
    const totalCount = Number(result.recordsets?.[0]?.[0]?.TotalCount) || 0;
    const totalPages = Math.ceil(totalCount / PageSize);
    return success(res, rows.length ? `${rows.length} of ${totalCount} shown` : "No cards yet", {
      rows, totalCount, pageNumber: PageNumber, pageSize: PageSize, totalPages,
      pagination: { currentPage: PageNumber, pageSize: PageSize, totalRecords: totalCount, totalPages },
    });
  }, "Failed to fetch cards", "CARD_FETCH_ERROR"),

  deleteCard: asyncRoute(async (req, res) => {
    const { id } = req.body;
    if (!isUuid(id)) return badId(res);
    const row = firstRow(await database.executeStoredProcedure("sp_DeleteVisitingCard", {
      Id: id, CompId: req.user.CompId, ...scopeParams(req, "cards") }));
    const code = spStatus(row);
    return code === 200 ? success(res, spMessage(row), { id }) : error(res, spMessage(row, "Failed to delete card"), "CARD_DELETE_ERROR", code);
  }, "Failed to delete card", "CARD_DELETE_ERROR"),

  // GET /uploads/cards/:id/:file — only a file the caller's scoped fetch names for that card.
  cardPhoto: asyncRoute(async (req, res) => {
    const { id, file } = req.params;
    const notFound = () => error(res, "Photo not found", "NOT_FOUND", 404);
    if (!isUuid(id)) return notFound();
    const row = await fetchOne(req, id);
    const rel = row && [row.FrontPath, row.BackPath].find((p) => p && path.posix.basename(p) === file);
    const full = rel && photoFile(rel);
    if (!full) return notFound();
    return res.set("Cache-Control", "private, max-age=300").type("image/jpeg")
      .sendFile(full, (err) => { if (err && !res.headersSent) notFound(); });
  }, "Failed to fetch photo", "CARD_PHOTO_ERROR"),
};
