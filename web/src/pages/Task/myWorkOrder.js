const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const dayKey = (d) => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
};

// Overdue (oldest due first) -> due today -> upcoming (soonest first) -> undated;
// ties break on priority. Date-only compare, like KanbanCard's overdue rule.
export function orderMyWork(tasks, today = new Date()) {
  const t0 = dayKey(today);
  const bucket = (t) => (!t.DueDate ? 3 : dayKey(t.DueDate) < t0 ? 0 : dayKey(t.DueDate) === t0 ? 1 : 2);
  return [...tasks].sort(
    (a, b) =>
      bucket(a) - bucket(b) ||
      (a.DueDate ? dayKey(a.DueDate) - dayKey(b.DueDate) : 0) ||
      (RANK[String(a.Priority).toLowerCase()] ?? 9) - (RANK[String(b.Priority).toLowerCase()] ?? 9),
  );
}

export const isOverdue = (t, today = new Date()) => Boolean(t.DueDate) && dayKey(t.DueDate) < dayKey(today);
