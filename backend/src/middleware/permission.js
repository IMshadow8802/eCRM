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

  const branchIds = rows.map((r) => Number(r.BranchId));
  const canWriteBranchIds = rows
    .filter((r) => r.CanWrite === true || r.CanWrite === 1)
    .map((r) => Number(r.BranchId));

  return {
    hierarchyLevel: header.HierarchyLevel ?? HIERARCHY.EMPLOYEE,
    dataScope: header.DataScope ?? "Self",
    primaryBranchId: header.PrimaryBranchId
      ? Number(header.PrimaryBranchId)
      : null,
    branchIds,
    canWriteBranchIds,
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

// Helper for controllers gating per-record writes.
const canWriteBranch = (req, branchId) =>
  req.scope?.canWriteBranchIds?.includes(Number(branchId)) || false;

const canReadBranch = (req, branchId) =>
  req.scope?.branchIds?.includes(Number(branchId)) || false;

module.exports = {
  HIERARCHY,
  loadScope,
  requireMinLevel,
  canWriteBranch,
  canReadBranch,
};
