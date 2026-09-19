// src/middleware/permission.js
//
// Computes the request's data scope (hierarchy level + branches the
// caller can read/write) once per request and exposes it as `req.scope`:
//
//   req.scope = {
//     hierarchyLevel: 1|2|3|4,
//     dataScope: 'All' | 'Company' | 'MultiBranch' | 'Branch' | 'Team' | 'Self',
//     primaryBranchId: BIGINT,
//     branchIds: BIGINT[],          // every branch the user can READ
//     canWriteBranchIds: BIGINT[],  // subset they can also WRITE
//   }
//
// Mount globally after verifyToken. Controllers use req.scope to filter
// fetches and gate writes (e.g. require record.BranchId in canWriteBranchIds).
//
// Caches the scope for ~60s on the request itself; we don't yet cache
// across requests because branch-access changes need to take effect
// immediately. Optimisation later (cache by UserId + invalidate on
// sp_SaveUserBranchAccess).

const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");

const HIERARCHY = {
  SUPER: 1,
  ADMIN: 2,
  MANAGER: 3,
  EMPLOYEE: 4,
};

async function computeScope(req) {
  if (!req.user || !req.user.UserId) {
    return null;
  }

  const result = await database.executeStoredProcedure(
    "sp_FetchAccessibleBranchIds",
    { UserId: req.user.UserId, CompId: req.user.CompId }
  );

  // recordset[0] = header row {HierarchyLevel, DataScope, PrimaryBranchId}
  // recordset[1] = branch rows {BranchId, CanWrite}
  const header = result.recordsets[0]?.[0] || {};
  const rows = result.recordsets[1] || [];
  // recordset[2] = owner rows {OwnerId}; populated only for Self/Team scope.
  const ownerRows = result.recordsets[2] || [];

  const branchIds = rows.map((r) => Number(r.BranchId));
  const canWriteBranchIds = rows
    .filter((r) => r.CanWrite === true || r.CanWrite === 1)
    .map((r) => Number(r.BranchId));

  // null = "no ownership filter" (the wide scopes). An empty array would mean
  // "match nobody" and hide everything, so the distinction matters.
  const ownerIds = ownerRows.length
    ? ownerRows.map((r) => Number(r.OwnerId))
    : null;

  return {
    hierarchyLevel: header.HierarchyLevel ?? HIERARCHY.EMPLOYEE,
    dataScope: header.DataScope ?? "Self",
    primaryBranchId: header.PrimaryBranchId
      ? Number(header.PrimaryBranchId)
      : null,
    branchIds,
    canWriteBranchIds,
    ownerIds,
    isAdmin: header.IsAdmin === true || header.IsAdmin === 1,
    // Only explicitly-inactive blocks: until 052 adds IsActive to the SP's
    // header row the column is undefined, and that must not lock everyone out.
    isActive: !(header.IsActive === false || header.IsActive === 0),
  };
}

const loadScope = async (req, res, next) => {
  try {
    if (!req.user) return next();
    req.scope = await computeScope(req);
    // A deactivated user keeps a valid JWT until it expires; this round-trip
    // already hits the DB every request, so enforce IsActive here.
    if (req.scope && req.scope.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Account is inactive",
        code: "USER_INACTIVE",
        responseCode: 403,
        timestamp: new Date().toISOString(),
      });
    }
    next();
  } catch (err) {
    console.error("loadScope failed:", err.message);
    // Fail closed: empty scope means SPs that filter by branchIds will
    // return no rows. Better than allowing unscoped access.
    req.scope = {
      hierarchyLevel: HIERARCHY.EMPLOYEE,
      dataScope: "Self",
      primaryBranchId: req.user?.BranchId ? Number(req.user.BranchId) : null,
      branchIds: req.user?.BranchId ? [Number(req.user.BranchId)] : [],
      canWriteBranchIds: req.user?.BranchId
        ? [Number(req.user.BranchId)]
        : [],
      // Self scope means an ownership filter, not just a branch one — without
      // this the fallback would quietly widen to the whole branch.
      ownerIds: req.user?.UserId ? [Number(req.user.UserId)] : [],
      isAdmin: false,
    };
    next();
  }
};

// Route guard: require a minimum hierarchy level (lower number = higher rank).
const requireMinLevel = (level) => (req, res, next) => {
  if (!req.scope) {
    return res.status(403).json({
      success: false,
      message: "Permission scope not loaded",
      code: "NO_SCOPE",
      responseCode: 403,
      timestamp: new Date().toISOString(),
    });
  }
  if (req.scope.hierarchyLevel > level) {
    return res.status(403).json({
      success: false,
      message: "Insufficient role to perform this action",
      code: "INSUFFICIENT_ROLE",
      responseCode: 403,
      timestamp: new Date().toISOString(),
    });
  }
  next();
};

// Route guard: require the IsAdmin role property (Owner + Admin only).
//
// Deliberately NOT requireMinLevel(HIERARCHY.ADMIN) — that is HierarchyLevel<=2,
// which also catches the level-2 department heads (Sales/Support/HR). IsAdmin
// lives on tblUserGroups and is a role property, not a rank; user management can
// mint IsAdmin accounts, so it needs the narrow check.
//
// Six route groups share this guard now (users, user groups, branch access,
// products, config lookups/custom fields, customer deletion), so the refusal
// says nothing about which one — it is rendered verbatim by both clients.
const requireAdmin = (req, res, next) => {
  if (!req.scope) {
    return res.status(403).json({
      success: false,
      message: "Permission scope not loaded",
      code: "NO_SCOPE",
      responseCode: 403,
      timestamp: new Date().toISOString(),
    });
  }
  if (!req.scope.isAdmin) {
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

const scopeParams = (req) => ({
  UserId: req.user?.UserId ?? null,
  AccessibleBranchIdsJson: scopeJson(req.scope?.branchIds),
  OwnerIdsJson: scopeJson(req.scope?.ownerIds),
});

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

  const { branchIds, ownerIds } = req.scope || {};
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
  lead: { sp: "sp_FetchLeadDetail", idParam: "LeadId", ownerField: "OwnerId" },
  ticket: { sp: "sp_FetchTicketDetail", idParam: "TicketId", ownerField: "AssignedTo" },
  // A quotation has no permission model of its own. sp_FetchQuotationDetail
  // returns its LEAD's OwnerId / BranchId / CreatedBy under those names, so
  // canSeeRecord answers for the lead: whoever can see the lead can see its
  // quotations, and a transferred lead carries them along.
  quotation: { sp: "sp_FetchQuotationDetail", idParam: "QuotationId", ownerField: "OwnerId" },
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

    if (entity === "task") {
      const result = await database.executeStoredProcedure(
        "sp_CheckTaskPermission",
        {
          TaskId: Number(entityId) || 0,
          UserId: req.user.UserId,
          Action: TASK_ACTION[level] ?? level,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );
      const row = result.recordsets?.[0]?.[0] ?? result.recordset?.[0];
      granted = row?.Allowed === true || row?.Allowed === 1;
    } else if (ENTITY_LOOKUP[entity]) {
      const { sp, idParam, ownerField, companyWide } = ENTITY_LOOKUP[entity];
      const result = await database.executeStoredProcedure(sp, {
        CompId: req.user.CompId,
        [idParam]: Number(entityId) || 0,
      });
      const record = result.recordsets?.[0]?.[0] || null;
      granted = companyWide
        ? record || false
        : canSeeRecord(req, record, ownerField) ? record : false;
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
// Three rules from the spec, in order of cheapness:
//   1. Unassigning (no target) and moving to another branch are manager acts:
//      DataScope Branch / MultiBranch / Company / All. Team and Self cannot.
//   2. A target must be someone sp_FetchAssignableUsers lists for the caller —
//      their subtree + their manager for Team/Self, their readable branches for
//      the wide scopes, or the destination branch's roster when @BranchId is
//      supplied. The dropdown on the client is a convenience; this is the gate.
//
// Sends its own 403 (or 500 on lookup failure) and returns false; true = proceed.
const WIDE_SCOPES = new Set(["All", "Company", "MultiBranch", "Branch"]);

async function assertCanAssign(req, res, { toUserId, toBranchId }) {
  const target = Number(toUserId) || null;
  const branch = Number(toBranchId) || null;
  const wide = WIDE_SCOPES.has(req.scope?.dataScope);

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
  if (!target) return true;

  try {
    const result = await database.executeStoredProcedure("sp_FetchAssignableUsers", {
      UserId: req.user.UserId,
      CompId: req.user.CompId,
      BranchId: branch,
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
// complaint is a manager's act: the wide scopes always may; a Team lead only
// for a ticket assigned to someone in their subtree — never their own, never
// an unassigned one; a Self agent never. Pure: the controller already fetched
// the ticket through assertRecordAccess, so this is a lookup on req.scope.
//
// The controller passes the answer as @AllowReopen on EVERY status call and
// sp_SetTicketStatus alone decides whether the requested move IS a reopen —
// Node never inspects status codes.
const canReopen = (req, record) => {
  if (WIDE_SCOPES.has(req.scope?.dataScope)) return true;
  const assignee = Number(record?.AssignedTo) || null;
  if (!assignee || assignee === Number(req.user?.UserId)) return false;
  const { ownerIds } = req.scope || {};
  return Array.isArray(ownerIds) && ownerIds.includes(assignee);
};

module.exports = {
  HIERARCHY,
  loadScope,
  requireMinLevel,
  requireAdmin,
  scopeParams,
  // Exported for the SPs that declare AccessibleBranchIdsJson but not UserId or
  // OwnerIdsJson — spreading the whole of scopeParams into those makes node-mssql
  // reject the call for passing parameters the procedure never declared.
  scopeJson,
  canSeeRecord,
  canWriteBranch,
  canReadBranch,
  assertRecordAccess,
  assertCanAssign,
  canReopen,
};
