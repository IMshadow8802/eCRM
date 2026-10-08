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
// scopeParams / canSeeRecord / assertCanAssign downstream read the lists of the
// module the route is about.
//
// No cross-request cache: grant and office changes must take effect at once.

const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { buildAccess, scopeFor: scopeOf, isWide } = require("./access");

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
// scopeParams / canSeeRecord / assertCanAssign downstream read the right lists.
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

// Single-record visibility check, for detail endpoints whose SP takes no scope
// params. Mirrors the WHERE clause in the scoped fetch SPs — keep the two in
// step. `ownerField` is 'OwnerId' for leads, 'AssignedTo' for tickets.
//
// Without this a Self-scoped user is only fenced out of the *list*: they could
// still post any Id to fetchLeadDetail / fetchTicketDetail and read the record.
const canSeeRecord = (req, record, ownerField) => {
  if (!record) return false;

  const userId = Number(req.user?.UserId);
  const owner = Number(record[ownerField]);
  const createdBy = Number(record.CreatedBy);

  // Always-visible rule: assigned to me, or created by me. Beats scope.
  if (owner === userId || createdBy === userId) return true;

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

// Record-level guard for WRITE endpoints (and attachment reads). The read
// paths already gate single records via canSeeRecord; write paths used to
// trust the client-supplied id blindly. This fetches the record and applies
// the same rule — assigned/created-by-caller always wins, OR-ed with scope.
//
// Tasks route through sp_CheckTaskPermission (workspace membership), which
// also keeps personal workspaces private from admins — deliberately no
// isAdmin shortcut around it here.
//
// Sends the 403 (or 500 on lookup failure) itself and returns false;
// true = proceed. `level` only matters for tasks: 'view' | 'write', or any
// raw sp_CheckTaskPermission action ('change_status', 'log_time', …) when the
// coarse pair doesn't fit — ticking a checklist is change_status, not
// edit_fields, because checklist state IS completion state.
const TASK_ACTION = { view: "view_task", write: "edit_fields" };

const ENTITY_LOOKUP = {
  lead: { sp: "sp_FetchLeadDetail", idParam: "LeadId", ownerField: "OwnerId", module: "leads" },
  ticket: { sp: "sp_FetchTicketDetail", idParam: "TicketId", ownerField: "AssignedTo", module: "complaints" },
  // A quotation has no permission model of its own. sp_FetchQuotationDetail
  // returns its LEAD's OwnerId / BranchId / CreatedBy under those names, so
  // canSeeRecord answers for the lead: whoever can see the lead can see its
  // quotations, and a transferred lead carries them along.
  quotation: { sp: "sp_FetchQuotationDetail", idParam: "QuotationId", ownerField: "OwnerId", module: "leads" },
  // The branch letterhead (logo + header image). Company-wide on purpose:
  // every agent who may write a quotation must be able to draw it, whatever
  // their data scope. The SP's CompId filter is the whole gate.
  quoteprofile: { sp: "sp_FetchQuoteProfileById", idParam: "ProfileId", companyWide: true },
};

async function assertRecordAccess(req, res, entity, entityId, level = "view") {
  try {
    // What the caller gets on success: the record itself for lead/ticket, so
    // a controller that needs the assignee (the reopen gate, spec 2 §3) has it
    // without a second round-trip; a plain true for tasks, where the
    // permission SP answers yes/no and there is no row to hand over. Callers
    // only ever test truthiness.
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
      const { sp, idParam, ownerField, companyWide, module } = ENTITY_LOOKUP[entity];
      // The module is the outer gate: no right on it = refuse before the fetch.
      // Its scope (not req.scope, which may be bound to another module) then
      // judges the record.
      const s = module ? scopeFor(req, module) : null;
      if (s && (!s.can.view || (level === "write" && !s.can.edit))) {
        responseHelper.error(res, `You do not have access to this ${entity}`, "FORBIDDEN", 403);
        return false;
      }
      const result = await database.executeStoredProcedure(sp, {
        CompId: req.user.CompId,
        [idParam]: Number(entityId) || 0,
      });
      const record = result.recordsets?.[0]?.[0] || null;
      granted = companyWide
        ? record || false
        : canSeeRecord({ ...req, scope: s }, record, ownerField) ? record : false;
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

// Transfer target guard.
//
// The rules, in order of cheapness (no scope loaded = 403 NO_SCOPE):
//   1. Unassigning (no target) and moving to another branch are manager acts:
//      reach Office / OfficeTree / Company (or admin). Team and Own cannot.
//   2. A destination office must be one the caller may write (admin exempt).
//   3. A target must be someone sp_FetchAssignableUsers lists for the caller —
//      their subtree + their manager for Team/Own, their readable offices for
//      the wide reaches (the caller's lists are passed in), or the destination branch's roster when @BranchId is
//      supplied. The dropdown on the client is a convenience; this is the gate.
//
// Sends its own 403 (or 500 on lookup failure) and returns false; true = proceed.

async function assertCanAssign(req, res, { toUserId, toBranchId }) {
  if (!req.scope) {
    responseHelper.error(res, "Permission scope not loaded", "NO_SCOPE", 403);
    return false;
  }
  const target = Number(toUserId) || null;
  const branch = Number(toBranchId) || null;
  const wide = isWide(req.scope);

  if (!target && !wide) {
    responseHelper.error(res, "Only a manager can leave a record unassigned", "FORBIDDEN", 403);
    return false;
  }
  if (branch && !wide) {
    responseHelper.error(
      res,
      "Only a branch manager or above can move a record to another branch",
      "FORBIDDEN",
      403,
    );
    return false;
  }
  // A wide reach still only moves records into offices it may write.
  if (branch && !req.scope.isAdmin && !canWriteBranch(req, branch)) {
    responseHelper.error(res, "You cannot move records to that office", "FORBIDDEN", 403);
    return false;
  }
  if (!target) return true;

  try {
    const result = await database.executeStoredProcedure("sp_FetchAssignableUsers", {
      UserId: req.user.UserId,
      CompId: req.user.CompId,
      BranchId: branch,
      AccessibleBranchIdsJson: scopeJson(req.scope?.branchIds),
      OwnerIdsJson: scopeJson(req.scope?.ownerIds),
    });
    const rows = result.recordsets?.[0] ?? result.recordset ?? [];
    if (rows.some((r) => Number(r.Id) === target)) return true;
    responseHelper.error(res, "You cannot assign records to that user", "FORBIDDEN", 403);
    return false;
  } catch (err) {
    console.error("assertCanAssign failed:", err.message);
    responseHelper.error(res, "Failed to verify assignment target");
    return false;
  }
}

// Reopen gate (spec 2 §3 Rules). Reopening a resolved / closed / rejected
// complaint is a manager's act: the wide reaches always may; a Team lead only
// for a ticket assigned to someone in their subtree — never their own, never
// an unassigned one; an Own-reach agent never. Pure: the controller already fetched
// the ticket through assertRecordAccess, so this is a lookup on req.scope.
//
// The controller passes the answer as @AllowReopen on EVERY status call and
// sp_SetTicketStatus alone decides whether the requested move IS a reopen —
// Node never inspects status codes.
const canReopen = (req, record) => {
  if (isWide(req.scope)) return true;
  const assignee = Number(record?.AssignedTo) || null;
  if (!assignee || assignee === Number(req.user?.UserId)) return false;
  const { ownerIds } = req.scope || {};
  return Array.isArray(ownerIds) && ownerIds.includes(assignee);
};

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
  taskAllowed,
  assertCanAssign,
  canReopen,
};
