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
  };
}

const loadScope = async (req, res, next) => {
  try {
    if (!req.user) return next();
    req.scope = await computeScope(req);
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

module.exports = {
  HIERARCHY,
  loadScope,
  requireMinLevel,
  scopeParams,
  canSeeRecord,
  canWriteBranch,
  canReadBranch,
};
