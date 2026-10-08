// src/middleware/access.js
//
// Pure access logic (spec 2026-10-07-org-hierarchy §2–3). sp_FetchUserAccess
// returns the grants and the office lists per reach level; this turns them into
// one scope per module. No DB, no Express — permission.js wires it in.

const MODULES = ["leads", "sales_reports", "complaints", "support_reports", "customers", "people",
  "tasks", "teams", "projects", "roles", "offices", "settings", "dashboard", "attendance"];
const REACH_MODULES = new Set(["leads", "complaints", "customers", "people", "attendance"]);
// Report modules have their own on/off but read with the source module's reach;
// everything else that has no reach of its own reads with people's.
const REACH_SOURCE = { sales_reports: "leads", support_reports: "complaints", dashboard: "leads" };
const WIDE = new Set(["Office", "OfficeTree", "Company"]);
const REACH_ORDER = ["Own", "Team", "Office", "OfficeTree", "Company"];
const NONE = { view: false, add: false, edit: false, delete: false };
const ALL = { view: true, add: true, edit: true, delete: true };

const bit = (v) => v === true || v === 1;

function buildAccess(recordsets = [], userId) {
  const head = recordsets[0]?.[0] || {};
  const isAdmin = bit(head.IsAdmin);
  const modules = {};
  for (const r of recordsets[1] || []) {
    modules[r.Module] = { view: bit(r.CanView), add: bit(r.CanAdd), edit: bit(r.CanEdit), delete: bit(r.CanDelete), reach: r.Reach || null };
  }
  const lists = { Own: [], Team: [], Office: [], OfficeTree: [], Company: [] };
  for (const r of recordsets[2] || []) {
    if (lists[r.Reach]) lists[r.Reach].push({ BranchId: Number(r.BranchId), CanWrite: bit(r.CanWrite) });
  }
  return {
    userId: Number(userId),
    isAdmin,
    // No user row comes back as IsActive 0; a header without the column (old SP) must not lock out.
    isActive: !(head.IsActive === false || head.IsActive === 0),
    canSeeSensitive: isAdmin || bit(head.CanSeeSensitive),
    primaryBranchId: head.PrimaryBranchId ? Number(head.PrimaryBranchId) : null,
    modules,
    lists,
    teamOwners: (recordsets[3] || []).map((r) => Number(r.OwnerId)),
  };
}

function listsFor(access, reach, userId) {
  const rows = access.lists[reach] || [];
  const branchIds = rows.map((r) => r.BranchId).sort((a, b) => a - b);
  const canWriteBranchIds = rows.filter((r) => r.CanWrite).map((r) => r.BranchId).sort((a, b) => a - b);
  // [] vs null is load-bearing: null = no owner filter, [] = match nobody.
  const ownerIds = reach === "Own" ? [Number(userId)] : reach === "Team" ? [...access.teamOwners] : null;
  return { branchIds, canWriteBranchIds, ownerIds };
}

function scopeFor(access, module, userId) {
  const base = {
    module,
    isAdmin: !!access?.isAdmin,
    isActive: access?.isActive !== false,
    primaryBranchId: access?.primaryBranchId ?? null,
  };
  if (!access) return { ...base, reach: null, can: NONE, branchIds: [], canWriteBranchIds: [], ownerIds: [] };
  if (access.isAdmin) return { ...base, reach: "Company", can: ALL, ...listsFor(access, "Company", userId) };

  const grant = access.modules[module];
  const can = grant ? { view: grant.view, add: grant.add, edit: grant.edit, delete: grant.delete } : NONE;
  if (!can.view) return { ...base, reach: null, can: NONE, branchIds: [], canWriteBranchIds: [], ownerIds: [] };

  const source = REACH_MODULES.has(module) ? module : REACH_SOURCE[module] || "people";
  const reach = access.modules[source]?.reach || "Own";
  return { ...base, reach, can, ...listsFor(access, reach, userId) };
}

const isWide = (scope) => !!scope && (scope.isAdmin === true || WIDE.has(scope.reach));

// Salary and contact details leave the server only for the person themselves,
// or for a caller with the sensitive permission whose people reach covers the row.
function stripSensitive(access, viewerId, user) {
  if (!user || Number(user.Id) === Number(viewerId)) return user;
  if (access?.canSeeSensitive) {
    const s = scopeFor(access, "people", viewerId);
    if (access.isAdmin || s.branchIds.includes(Number(user.BranchId))) return user;
  }
  return { ...user, HourlyRate: null, Mobile: null, Email: null, Username: null };
}

// A non-admin may hand out a role only if it grants nothing they lack
// (sp_FetchGroupModules RS2 rows): no action the actor's grant does not have,
// and no reach wider than the actor's reach for that module.
function roleWithin(access, roleRows = []) {
  if (access?.isAdmin) return true;
  return roleRows.every((r) => {
    const mine = access?.modules?.[r.Module] || NONE;
    const acts = [["CanView", "view"], ["CanAdd", "add"], ["CanEdit", "edit"], ["CanDelete", "delete"]];
    if (acts.some(([col, k]) => bit(r[col]) && !mine[k])) return false;
    if (!r.Reach || !bit(r.CanView)) return true;
    return REACH_ORDER.indexOf(r.Reach) <= REACH_ORDER.indexOf(mine.reach || "Own");
  });
}

// What the client needs to hide buttons; office lists stay server-side.
const publicAccess = (a) => ({ isAdmin: a.isAdmin, canSeeSensitive: a.canSeeSensitive,
  primaryBranchId: a.primaryBranchId, modules: a.modules });

module.exports = { MODULES, REACH_MODULES, buildAccess, scopeFor, isWide, stripSensitive, publicAccess, roleWithin };
