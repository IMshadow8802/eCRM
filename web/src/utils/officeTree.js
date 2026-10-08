// Offices (tblBranch) form a tree through ParentId; null = top level.

// Depth-first order with depth, children sorted by name.
// An office whose parent is not in the list sits at top level, never dropped.
export function toTree(rows) {
  const ids = new Set(rows.map((r) => r.Id));
  const kids = new Map();
  for (const r of rows) {
    const p = ids.has(r.ParentId) ? r.ParentId : 0;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(r);
  }
  for (const list of kids.values()) list.sort((a, b) => a.BranchName.localeCompare(b.BranchName));
  const out = [];
  const walk = (parent, depth) =>
    (kids.get(parent) || []).forEach((r) => {
      out.push({ ...r, depth });
      walk(r.Id, depth + 1);
    });
  walk(0, 0);
  return out;
}

// The office itself plus every office below it — none can become its parent.
export const descendantsOf = (rows, id) => {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows)
      if (r.ParentId != null && out.has(r.ParentId) && !out.has(r.Id)) {
        out.add(r.Id);
        grew = true;
      }
  }
  return out;
};
