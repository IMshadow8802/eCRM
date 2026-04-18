// Bucket tasks by their ColumnId FK.
// The legacy Status-string bucketing has been retired — tblTasks.ColumnId
// is the source of truth now (migration 021). Any task with a ColumnId that
// doesn't match a visible column lands in the `__orphans__` bucket so we
// never silently drop work after a rename/delete.

export const ORPHAN_BUCKET_KEY = "__orphans__";

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

  return bucket;
}
