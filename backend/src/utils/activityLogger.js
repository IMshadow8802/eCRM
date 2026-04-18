// src/utils/activityLogger.js
//
// Fire-and-forget wrapper around sp_SaveActivityLog. Call this from
// any controller after a save/update/delete to record an audit row in
// tblActivityLog (Workstream D).
//
// Usage:
//   const { logActivity } = require("../utils/activityLogger");
//   await logActivity({
//     entityType: "Lead",
//     entityId: leadId,
//     action: "Updated",
//     fieldName: "Status",        // optional
//     oldValue: "New",            // optional
//     newValue: "Qualified",      // optional
//     description: "Status changed via UI",
//     req,
//   });
//
// Errors are swallowed — audit logging must never break the actual
// operation.

const database = require("../config/database");

const ACTIONS = {
  CREATED: "Created",
  UPDATED: "Updated",
  DELETED: "Deleted",
  STATUS_CHANGED: "StatusChanged",
  ASSIGNED: "Assigned",
  TRANSFERRED: "Transferred",
  COMMENTED: "Commented",
  LOGIN: "Login",
  LOGOUT: "Logout",
  PERMISSION_CHANGED: "PermissionChanged",
};

async function logActivity({
  entityType,
  entityId,
  action,
  fieldName = null,
  oldValue = null,
  newValue = null,
  description = null,
  req,
}) {
  if (!req || !req.user) return;
  if (!entityType || entityId == null || !action) return;

  try {
    await database.executeStoredProcedure("sp_SaveActivityLog", {
      EntityType: entityType,
      EntityId: entityId,
      Action: action,
      FieldName: fieldName,
      OldValue: oldValue != null ? String(oldValue) : null,
      NewValue: newValue != null ? String(newValue) : null,
      Description: description,
      UserId: req.user.UserId,
      CompId: req.user.CompId,
      BranchId: req.user.BranchId,
      IpAddress: req.ip || null,
      UserAgent: (req.headers && req.headers["user-agent"]) || null,
    });
  } catch (err) {
    console.error("activityLogger failed:", err.message);
  }
}

module.exports = { logActivity, ACTIONS };
