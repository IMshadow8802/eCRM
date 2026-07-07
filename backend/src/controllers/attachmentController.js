const fs = require("fs");
const path = require("path");
const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");
const { UPLOAD_ROOT, ENTITIES } = require("../middleware/upload");
const { logActivity, ACTIONS } = require("../utils/activityLogger");

// Absolute path to a stored file.
function filePath(entity, storedName) {
  return path.join(UPLOAD_ROOT, entity, storedName);
}

// Best-effort unlink — a missing file must never block the DB operation.
function unlinkQuiet(p) {
  fs.unlink(p, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("Attachment unlink failed:", p, err.message);
    }
  });
}

class AttachmentController {
  // POST /api/attachments/save  (multipart: file + Entity + EntityId)
  // Multer has already written the file to disk by the time this runs.
  async save(req, res) {
    const file = req.file;
    try {
      const { Entity, EntityId } = req.body || {};

      if (!file) {
        return res.status(400).json({
          success: false, message: "No file uploaded",
          code: "NO_FILE", responseCode: 400, timestamp: new Date().toISOString(),
        });
      }
      if (!ENTITIES.has(String(Entity)) || !EntityId || Number(EntityId) <= 0) {
        unlinkQuiet(file.path); // reject → clean the just-written file
        return res.status(400).json({
          success: false, message: "Valid Entity and EntityId are required",
          code: "VALIDATION_ERROR", responseCode: 400, timestamp: new Date().toISOString(),
        });
      }

      let result;
      try {
        result = await database.executeStoredProcedure("sp_SaveAttachment", {
          Id: 0,
          CompId: req.user.CompId,
          Entity,
          EntityId: Number(EntityId),
          FileName: file.originalname,
          StoredName: file.filename,
          FileSize: file.size,
          MimeType: file.mimetype,
          UploadedBy: req.user.UserId,
        });
      } catch (dbErr) {
        // Invariant: file on disk <-> row in DB. Row insert failed → remove file.
        unlinkQuiet(file.path);
        throw dbErr;
      }

      const spResponse = result.recordsets[0][0];
      if (spResponse.ResponseCode >= 300) unlinkQuiet(file.path);

      if (spResponse.ResponseCode < 300) {
        await logActivity({
          entityType: "Attachment",
          entityId: spResponse.AttachmentId,
          action: ACTIONS.CREATED,
          description: `File "${file.originalname}" attached to ${Entity} #${EntityId}`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: spResponse.ResponseCode < 300
          ? {
              attachmentId: spResponse.AttachmentId,
              fileName: file.originalname,
              fileSize: file.size,
              mimeType: file.mimetype,
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save attachment error:", err);
      if (file) unlinkQuiet(file.path);
      return res.status(500).json({
        success: false, message: "Failed to save attachment",
        code: "ATTACHMENT_SAVE_ERROR", responseCode: 500, timestamp: new Date().toISOString(),
      });
    }
  }

  // POST /api/attachments/fetch  { Entity, EntityId, Id? }
  async fetch(req, res) {
    try {
      const { Id = 0, Entity = null, EntityId = null } = req.body || {};
      if (Id === 0 && (!Entity || !EntityId)) {
        return res.status(400).json({
          success: false, message: "Entity and EntityId are required",
          code: "VALIDATION_ERROR", responseCode: 400, timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_FetchAttachments", {
        Id, CompId: req.user.CompId, Entity, EntityId,
      });

      return res.status(200).json({
        success: true, message: "Attachments fetched", responseCode: 200,
        data: { attachments: cleanSpRows(result.recordsets[0]) },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch attachments error:", err);
      return res.status(500).json({
        success: false, message: "Failed to fetch attachments",
        code: "ATTACHMENT_FETCH_ERROR", responseCode: 500, timestamp: new Date().toISOString(),
      });
    }
  }

  // POST /api/attachments/download  { Id }  → streams the file (blob on client)
  async download(req, res) {
    try {
      const { Id } = req.body || {};
      if (!Id || Id <= 0) {
        return res.status(400).json({ success: false, message: "Id is required", responseCode: 400 });
      }

      // CompId-scoped fetch is the hard multi-tenant boundary — a user can only
      // ever reach their own company's rows.
      // TODO(v2): finer per-task gating (workspace membership) via
      // sp_CheckTaskPermission; today within a company this mirrors how the
      // parent lead/ticket/task is already visible to staff.
      const result = await database.executeStoredProcedure("sp_FetchAttachments", {
        Id, CompId: req.user.CompId, Entity: null, EntityId: null,
      });
      const rows = cleanSpRows(result.recordsets[0], "Id");
      const row = rows[0];
      if (!row) {
        return res.status(404).json({ success: false, message: "Attachment not found", responseCode: 404 });
      }

      const abs = filePath(row.Entity, row.StoredName);
      if (!fs.existsSync(abs)) {
        return res.status(404).json({ success: false, message: "File missing on disk", responseCode: 404 });
      }

      res.setHeader("Content-Type", row.MimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(row.FileName)}"`,
      );
      return res.sendFile(abs);
    } catch (err) {
      console.error("Download attachment error:", err);
      return res.status(500).json({ success: false, message: "Failed to download", responseCode: 500 });
    }
  }

  // POST /api/attachments/delete  { Id }
  async delete(req, res) {
    try {
      const { Id } = req.body || {};
      if (!Id || Id <= 0) {
        return res.status(400).json({
          success: false, message: "Id is required",
          code: "VALIDATION_ERROR", responseCode: 400, timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_DeleteAttachment", {
        Id, CompId: req.user.CompId,
      });
      const spResponse = result.recordsets[0][0];

      // Row gone → remove the file (best-effort; missing file never blocks).
      if (spResponse.ResponseCode === 200 && spResponse.StoredName) {
        unlinkQuiet(filePath(spResponse.Entity, spResponse.StoredName));
        await logActivity({
          entityType: "Attachment",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: `Attachment removed from ${spResponse.Entity}`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete attachment error:", err);
      return res.status(500).json({
        success: false, message: "Failed to delete attachment",
        code: "ATTACHMENT_DELETE_ERROR", responseCode: 500, timestamp: new Date().toISOString(),
      });
    }
  }

  // Cascade: called from a parent's delete controller after the task/ticket/
  // lead is removed. Deletes attachment rows and unlinks their files. Never
  // throws — a cleanup failure must not fail the parent delete.
  async cascadeDelete(compId, entity, entityId) {
    try {
      const result = await database.executeStoredProcedure(
        "sp_DeleteAttachmentsByEntity",
        { CompId: compId, Entity: entity, EntityId: entityId },
      );
      const rows = result.recordsets?.[0] || [];
      rows.forEach((r) => unlinkQuiet(filePath(r.Entity, r.StoredName)));
    } catch (err) {
      console.error("Attachment cascade delete failed:", entity, entityId, err.message);
    }
  }
}

module.exports = new AttachmentController();
