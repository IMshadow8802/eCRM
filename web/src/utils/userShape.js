/**
 * Canonical user-record helpers.
 *
 * Backend is the single source of truth: every endpoint that emits a user
 * (fetchUsers, loginUser, teamMembers, assignee lookups, ...) returns the
 * PascalCase shape that matches tblUser columns:
 *
 *   { Id, Username, FullName, Email, JobTitle, HourlyRate,
 *     BranchId, CompId, IsAdmin, IsActive }
 *
 * Use these helpers in every component / store that reads a user record.
 * If you find yourself inlining `user.Id` or `user.FullName` across three
 * call sites, add an accessor here instead.
 */

export function getUserId(user) {
  return user?.Id ?? null;
}

export function getUserName(user) {
  if (!user) return "";
  return user.FullName || user.Username || "";
}

export function getUserJobTitle(user) {
  return user?.JobTitle ?? "";
}

/**
 * Shape a user record into a select/combobox option.
 * `withJobTitle` appends " - JobTitle" when present.
 * Returns null if record has no id → caller filters out.
 */
export function toUserOption(user, { withJobTitle = false } = {}) {
  const id = getUserId(user);
  if (id == null) return null;
  const name = getUserName(user) || "Unnamed";
  const job = withJobTitle ? getUserJobTitle(user) : "";
  return {
    value: id.toString(),
    label: job ? `${name} - ${job}` : name,
  };
}

export function toUserOptions(users, opts) {
  return (Array.isArray(users) ? users : [])
    .map((u) => toUserOption(u, opts))
    .filter(Boolean);
}

/** Find a user in a list by id (handles string/number mismatch). */
export function findUserById(users, id) {
  if (id == null) return null;
  const target = String(id);
  return (
    (Array.isArray(users) ? users : []).find(
      (u) => String(getUserId(u)) === target,
    ) ?? null
  );
}
