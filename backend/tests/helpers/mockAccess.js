// Builds the req.access a mocked loadScope injects.
const { buildAccess, scopeFor } = require("../../src/middleware/access");
const LISTS = [{ Reach: "Own", BranchId: 2, CanWrite: 1 }, { Reach: "Office", BranchId: 2, CanWrite: 1 },
  { Reach: "Company", BranchId: 2, CanWrite: 1 }];
function mockAccess({ admin = false, sensitive = false, modules = [] } = {}, userId = 7) {
  return buildAccess([[{ PrimaryBranchId: 2, IsActive: 1, IsAdmin: admin, CanSeeSensitive: sensitive }],
    modules.map(([Module, rights = "v", Reach = null]) => ({ Module, Reach,
      CanView: 1, CanAdd: rights.includes("a") ? 1 : 0, CanEdit: rights.includes("e") ? 1 : 0, CanDelete: rights.includes("d") ? 1 : 0 })),
    LISTS, []], userId);
}
const loadScopeWith = (getAccess) => (req, res, next) => {
  req.access = getAccess();
  req.scope = { ...scopeFor(req.access, "people", req.user.UserId), isAdmin: req.access.isAdmin };
  next();
};

// The req.access that matches a legacy-style req.scope, for controller tests
// that describe the caller by scope shape: ownerIds null = Office reach,
// [userId] = Own, any other list = Team (those owners), isAdmin = admin. Every
// reach module gets `rights` with that reach, over exactly scope.branchIds.
const REACH_MODS = ["leads", "complaints", "customers", "people"];
function accessForScope(scope = {}, userId = 7, rights = "vaed") {
  const owners = scope.ownerIds;
  const reach = scope.isAdmin ? "Company" : !Array.isArray(owners) ? "Office"
    : owners.length === 1 && Number(owners[0]) === Number(userId) ? "Own" : "Team";
  const write = scope.canWriteBranchIds || scope.branchIds || [];
  const lists = (scope.branchIds || []).map((BranchId) => ({ Reach: reach, BranchId, CanWrite: write.includes(BranchId) ? 1 : 0 }));
  return buildAccess([[{ PrimaryBranchId: scope.primaryBranchId ?? 2, IsActive: 1, IsAdmin: !!scope.isAdmin, CanSeeSensitive: 0 }],
    REACH_MODS.map((Module) => ({ Module, Reach: reach, CanView: 1, CanAdd: rights.includes("a") ? 1 : 0,
      CanEdit: rights.includes("e") ? 1 : 0, CanDelete: rights.includes("d") ? 1 : 0 })),
    lists, reach === "Team" ? owners.map((OwnerId) => ({ OwnerId })) : []], userId);
}
module.exports = { mockAccess, loadScopeWith, accessForScope };
