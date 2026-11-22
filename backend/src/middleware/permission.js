// src/middleware/permission.js
//
// Loads the caller's access once per request (spec 2026-10-07-org-hierarchy):
//
//   req.access = buildAccess(sp_FetchUserAccess)   // see access.js
//     { isAdmin, isActive, canSeeSensitive, primaryBranchId,
//       modules: { leads: { view, add, edit, delete, reach }, ... },
//       lists: { Own, Team, Office, OfficeTree, Company: [{BranchId, CanWrite}] },
//       teamOwners }
//
//   req.scope = the scope of ONE module for this caller:
//     { module, reach, can, branchIds, canWriteBranchIds, ownerIds, isAdmin, ... }
//
// loadScope binds req.scope to "people" (the scope a route with no module of
// its own reads with); requireModule re-binds it to the route's module. So
// scopeParams downstream reads the lists of the module the route is about.
//
// No cross-request cache: grant and office changes must take effect at once.

const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { buildAccess, scopeFor: scopeOf, isWide } = require("./access");
const { actor } = require("../utils/actor");

const EMPTY_ACCESS = (req) => buildAccess([[{
  PrimaryBranchId: req.user?.BranchId ?? null, IsActive: 1, IsAdmin: 0, CanSeeSensitive: 0 }]], req.user?.UserId);

// req-level wrapper: the scope of one module for this caller.
const scopeFor = (req, module) => scopeOf(req.access, module, req.user?.UserId);

const loadScope = async (req, res, next) => {
  if (!req.user) return next();
  try {
    const result = await database.executeStoredProcedure("sp_FetchUserAccess", {
      UserId: req.user.UserId,
      CompId: req.user.CompId,
    });
    req.access = buildAccess(result.recordsets, req.user.UserId);
  } catch (err) {
    console.error("loadScope failed:", err.message);
    // Fail closed: no modules, so every requireModule refuses and every scoped
    // SP gets an empty allow-list.
    req.access = EMPTY_ACCESS(req);
  }
  // A deactivated user keeps a valid JWT until it expires; this round-trip
  // already hits the DB every request, so enforce IsActive here.
  if (req.access.isActive === false) {
    return res.status(403).json({
      success: false, message: "Account is inactive", code: "USER_INACTIVE",
      responseCode: 403, timestamp: new Date().toISOString(),
    });
  }
  // Routes with no module of their own read with the people scope (isAdmin rides along).
  req.scope = scopeFor(req, "people");
  next();
};

const saveAction = (req) => (Number(req.body?.Id) > 0 ? "edit" : "add");

// Route guard: the caller's role must grant `action` on `module`. Both may be
// functions of the request. On success req.scope becomes that module's scope, so
// scopeParams downstream reads the right lists.
const requireModule = (module, action) => {
  const guard = (req, res, next) => {
    const m = typeof module === "function" ? module(req) : module;
    const a = typeof action === "function" ? action(req) : action;
    const s = scopeFor(req, m);
    if (!s.can[a]) {
      return responseHelper.error(res, "You do not have permission for this action", "INSUFFICIENT_ROLE", 403);
    }
    req.scope = s;
    next();
  };
  guard.access = { module, action };
  return guard;
};

// Marks a route that needs no module (auth, own profile, notifications, pick-lists).
const open = () => {
  const guard = (req, res, next) => next();
  guard.access = "open";
  return guard;
};

// Route guard: require the IsAdmin role property (Owner + Admin only).
//
// IsAdmin lives on tblUserGroups and is a role property, not a set of module
// grants: a department head holding every right on people/roles/settings still
// does not pass, because user management can mint IsAdmin accounts. Reads
// req.access, never req.scope (which requireModule rebinds per module).
//
// Several route groups share this guard, so the refusal says nothing about
// which one — it is rendered verbatim by both clients.
const requireAdmin = (req, res, next) => {
  if (!req.access) {
    return res.status(403).json({
      success: false,
      message: "Permission scope not loaded",
      code: "NO_SCOPE",
      responseCode: 403,
      timestamp: new Date().toISOString(),
    });
  }
  if (!req.access.isAdmin) {
    return res.status(403).json({
      success: false,
      message: "This action is restricted to administrators",
      code: "INSUFFICIENT_ROLE",
      responseCode: 403,
      timestamp: new Date().toISOString(),
    });
  }
  next();
};
requireAdmin.access = "admin";

// Maps req.scope onto the scope params every scoped fetch SP takes.
//
// Controllers must use this instead of passing req.user.BranchId as a
// visibility filter — doing that is what hid every Sales/Support row from
// users outside the record creator's branch.
//
// The [] vs null distinction is load-bearing:
//   null / absent -> no filter on that dimension (the wide scopes)
//   []            -> match nothing (fail closed)
// Serialising [] to null instead would fail OPEN and show every row.
const scopeJson = (arr) => (Array.isArray(arr) ? JSON.stringify(arr) : null);

// `module` (optional) reads that module's scope instead of req.scope — for a
// controller that touches a second module beyond the one its route is bound to.
const scopeParams = (req, module) => {
  const s = module ? scopeFor(req, module) : req.scope;
  return {
    UserId: req.user?.UserId ?? null,
    AccessibleBranchIdsJson: scopeJson(s?.branchIds),
    OwnerIdsJson: scopeJson(s?.ownerIds),
  };
};

// Customers only (they keep the Node-fed lists, plan Global Constraints):
// mirrors sp_FetchCustomers' WHERE clause — keep the two in step. Leads,
// complaints, follow-ups and quotations are answered by the database
// (visibleRecord / visibleFollowUp), never by this.
const canSeeRecord = (req, record, ownerField) => {
  if (!record) return false;

  const userId = Number(req.user?.UserId);
  const owner = Number(record[ownerField]);
  const createdBy = Number(record.CreatedBy);

  const creatorKeeps = !record[ownerField];
  if (owner === userId || (creatorKeeps && createdBy === userId)) return true;

  // No scope loaded = fail closed (the always-visible rule above still won).
  if (!req.scope) return false;
  const { branchIds, ownerIds } = req.scope;
  if (Array.isArray(branchIds) && !branchIds.includes(Number(record.BranchId))) {
    return false;
  }
  if (Array.isArray(ownerIds) && !ownerIds.includes(owner)) {
    return false;
  }
  return true;
};

// Helper for controllers gating per-record writes.
const canWriteBranch = (req, branchId) =>
  req.scope?.canWriteBranchIds?.includes(Number(branchId)) || false;

const canReadBranch = (req, branchId) =>
  req.scope?.branchIds?.includes(Number(branchId)) || false;

// Record-level guard for single-record reads and writes.
//
// Leads, complaints and quotations: the detail procedure is the whole answer
// (plan Ruling 5). Given the session person it returns no row when the record
// is not visible to them, and carries CanEdit on the row. Node adds no rule of
// its own — no isAdmin shortcut, no req.scope lists.
//
// Tasks route through sp_CheckTaskPermission (workspace membership), which
// also keeps personal workspaces private from admins.
//
// Sends the 403 (or 500 on lookup failure) itself and returns false;
// truthy = proceed. `level` is 'view' | 'write'; for tasks also any raw
// sp_CheckTaskPermission action ('change_status', 'log_time', …) — ticking a
// checklist is change_status, not edit_fields, because checklist state IS
// completion state.
const TASK_ACTION = { view: "view_task", write: "edit_fields" };

const ENTITY_LOOKUP = {
  lead: { sp: "sp_FetchLeadDetail", idParam: "LeadId" },
  ticket: { sp: "sp_FetchTicketDetail", idParam: "TicketId" },
  // A quotation has no permission model of its own: the procedure answers for
  // its lead (whoever can see the lead can see its quotations).
  quotation: { sp: "sp_FetchQuotationDetail", idParam: "QuotationId" },
  // The branch letterhead (logo + header image). Company-wide on purpose:
  // every agent who may write a quotation must be able to draw it, whatever
  // their data scope. The SP's CompId filter is the whole gate.
  quoteprofile: { sp: "sp_FetchQuoteProfileById", idParam: "ProfileId", companyWide: true },
};

const truthy = (v) => v === true || v === 1;

// The lookup half of assertRecordAccess: the record when the caller may see it
// (and edit it, for "write"), else false. Sends nothing — for a caller that
// must hide a related record rather than refuse the whole request (a
// complaint's linked lead). Throws on a lookup failure (NO_ACTOR included);
// deciding the response is the caller's job.
async function visibleRecord(req, entity, entityId, level = "view") {
  const { sp, idParam, companyWide } = ENTITY_LOOKUP[entity];
  const id = Number(entityId) || 0;
  const who = companyWide ? null : actor(req); // the session person, never the body
  const result = await database.executeStoredProcedure(sp, { CompId: req.user.CompId, ...who, [idParam]: id });
  const record = result.recordsets?.[0]?.[0];
  if (!record) return false;
  if (!companyWide && level === "write" && !truthy(record.CanEdit)) return false;
  return record;
}

// A follow-up as the session person may see it: the sp_FetchFollowUpLead row
// (with Via and CanAct; the lead's BranchId/OwnerId/CreatedBy only on Via 1),
// or false. Throws on a lookup failure.
async function visibleFollowUp(req, id) {
  const result = await database.executeStoredProcedure("sp_FetchFollowUpLead", {
    ...actor(req),
    Id: Number(id) || 0,
  });
  return result.recordsets?.[0]?.[0] || false;
}

async function assertRecordAccess(req, res, entity, entityId, level = "view") {
  try {
    // What the caller gets on success: the record itself for lead/ticket/
    // quotation (CanReassign, CanReopen, SendBackToId ride on it); a plain
    // true for tasks, where the permission SP answers yes/no.
    let granted = false;

    if (entity === "task" || entity === "comment") {
      // A comment is judged by its task's workspace; the SP resolves the task
      // from CommentId.
      const result = await database.executeStoredProcedure(
        "sp_CheckTaskPermission",
        {
          [entity === "task" ? "TaskId" : "CommentId"]: Number(entityId) || 0,
          UserId: req.user.UserId,
          Action: TASK_ACTION[level] ?? level,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );
      const row = result.recordsets?.[0]?.[0] ?? result.recordset?.[0];
      granted = row?.Allowed === true || row?.Allowed === 1;
    } else if (ENTITY_LOOKUP[entity]) {
      granted = await visibleRecord(req, entity, entityId, level);
    }

    if (granted) return granted;
    responseHelper.error(
      res,
      `You do not have access to this ${entity}`,
      "FORBIDDEN",
      403,
    );
    return false;
  } catch (err) {
    console.error("assertRecordAccess failed:", entity, entityId, err.message);
    responseHelper.error(res, "Failed to verify record access");
    return false;
  }
}

// One sp_CheckTaskPermission answer as a boolean, without answering the
// request — for a controller that needs to know a SECOND right after the gate
// already passed (a tick-only caller vs one who may also rename the step).
async function taskAllowed(req, taskId, action) {
  const result = await database.executeStoredProcedure("sp_CheckTaskPermission", {
    TaskId: Number(taskId) || 0,
    UserId: req.user.UserId,
    Action: action,
    IsAdmin: req.scope?.isAdmin ? 1 : 0,
    CompId: req.user.CompId,
  });
  const row = result.recordsets?.[0]?.[0] ?? result.recordset?.[0];
  return row?.Allowed === true || row?.Allowed === 1;
}

module.exports = {
  loadScope,
  requireModule,
  open,
  saveAction,
  requireAdmin,
  scopeFor,
  isWide,
  scopeParams,
  // Exported for the SPs that declare AccessibleBranchIdsJson but not UserId or
  // OwnerIdsJson — spreading the whole of scopeParams into those makes node-mssql
  // reject the call for passing parameters the procedure never declared.
  scopeJson,
  canSeeRecord,
  canWriteBranch,
  canReadBranch,
  assertRecordAccess,
  visibleRecord,
  visibleFollowUp,
  taskAllowed,
};
