// Helpers for a task's assignee SET.
//
// A task holds many assignees (tblTaskAssignee). sp_FetchTask returns them as
// an AssigneesJson array, alongside the legacy scalar AssignedToUserId /
// AssigneeName, which are a mirror of the first assignee kept only until the
// column is dropped. Read the set through here — never the scalars — so the
// eventual column drop is a no-op for the UI.

/**
 * Assignees of a task, always an array.
 *
 * Falls back to the legacy scalar pair when AssigneesJson is absent, so a
 * cached task fetched before the migration still renders one avatar rather
 * than none.
 */
export function assigneesOf(task) {
  if (!task) return [];

  const raw = task.Assignees ?? task.AssigneesJson;
  if (Array.isArray(raw)) return raw;

  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Malformed JSON from the server shouldn't blank the card — fall through
      // to the legacy scalars below.
    }
  }

  if (task.AssignedToUserId) {
    return [
      {
        UserId: task.AssignedToUserId,
        FullName: task.AssigneeName ?? null,
        Avatar: null,
      },
    ];
  }

  return [];
}

/** Is this user one of the task's assignees? */
export function isAssignee(task, userId) {
  if (!userId) return false;
  return assigneesOf(task).some((a) => Number(a.UserId) === Number(userId));
}

/** Nobody is on this task yet — any member may claim it. */
export function isUnassigned(task) {
  return assigneesOf(task).length === 0;
}

/** User ids only, for submitting back as AssigneeIds. */
export function assigneeIdsOf(task) {
  return assigneesOf(task).map((a) => Number(a.UserId));
}

/**
 * Two assignee id lists holding the same people, order-insensitive.
 * Used by the detail modal's dirty check.
 */
export function sameAssignees(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].map(Number).sort((x, y) => x - y);
  const right = [...b].map(Number).sort((x, y) => x - y);
  return left.every((v, i) => v === right[i]);
}
