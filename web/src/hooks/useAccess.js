import useAuthStore from "../stores/useAuthStore";

const WIDE = new Set(["Office", "OfficeTree", "Company"]);
const NONE = { view: false, add: false, edit: false, delete: false, reach: null, assignReach: null };

// Courtesy only: hides what the server would refuse anyway (spec 2026-10-07 section 3).
// assignReach = "Can assign to" (Team | Office | OfficeTree | Company) for leads/complaints, else null.
export function useAccess(module) {
  const access = useAuthStore((s) => s.access);
  if (access?.isAdmin) return { view: true, add: true, edit: true, delete: true, reach: "Company", assignReach: "Company", wide: true };
  const m = access?.modules?.[module] ?? NONE;
  return { view: !!m.view, add: !!m.add, edit: !!m.edit, delete: !!m.delete, reach: m.reach ?? null, assignReach: m.assignReach ?? null, wide: WIDE.has(m.reach) };
}
export const useIsAdmin = () => useAuthStore((s) => !!s.access?.isAdmin);
export const useCanSeeSensitive = () => useAuthStore((s) => !!s.access?.canSeeSensitive);
