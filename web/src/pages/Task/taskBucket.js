// Bucket tasks by their ColumnId FK.
// The legacy Status-string bucketing has been retired — tblTasks.ColumnId
// is the source of truth now (migration 021). Any task with a ColumnId that
// doesn't match a visible column lands in the `__orphans__` bucket so we
// never silently drop work after a rename/delete.
//
// Within each bucket, tasks are ordered:
//   1. Incomplete first (IsCompleted ASC)
//   2. Priority DESC (critical > high > medium > low)
//   3. Due date ASC (nulls last)
//   4. Newest first (Id DESC)

export const ORPHAN_BUCKET_KEY = "__orphans__";

const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function priorityRank(p) {
  return PRIORITY_RANK[String(p || "").toLowerCase()] ?? 0;
}

const FAR_FUTURE = Number.MAX_SAFE_INTEGER;

function dueTs(d) {
  if (!d) return FAR_FUTURE;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? FAR_FUTURE : t;
}

export function sortTasksWithinColumn(list) {
  return [...list].sort((a, b) => {
    const aDone = a?.IsCompleted ? 1 : 0;
    const bDone = b?.IsCompleted ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const pr = priorityRank(b?.Priority) - priorityRank(a?.Priority);
    if (pr !== 0) return pr;
    const dd = dueTs(a?.DueDate) - dueTs(b?.DueDate);
    if (dd !== 0) return dd;
    return (b?.Id ?? 0) - (a?.Id ?? 0);
  });
}

export function bucketTasksByColumn(columns, tasks) {
  const bucket = {};
  const known = new Set();
  for (const col of Array.isArray(columns) ? columns : []) {
    if (col?.Id == null) continue;
    bucket[col.Id] = [];
    known.add(col.Id);
  }

  for (const t of Array.isArray(tasks) ? tasks : []) {
    const colId = t?.ColumnId;
    if (colId != null && known.has(colId)) {
      bucket[colId].push(t);
    } else {
      if (!bucket[ORPHAN_BUCKET_KEY]) bucket[ORPHAN_BUCKET_KEY] = [];
      bucket[ORPHAN_BUCKET_KEY].push(t);
    }
  }

  for (const key of Object.keys(bucket)) {
    bucket[key] = sortTasksWithinColumn(bucket[key]);
  }

  return bucket;
}
