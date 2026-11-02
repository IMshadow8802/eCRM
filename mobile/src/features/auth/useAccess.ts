// Role grants on the phone — mirrors web/src/hooks/useAccess.js + utils/refreshAccess.js.
import { useEffect } from "react";
import { AppState } from "react-native";

import useAuthStore from "../../stores/useAuthStore";
import type { ModuleKey, Reach } from "../../types/api";

export interface ModuleAccess {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
  reach: Reach | null;
  isAdmin: boolean;
}

const NONE: ModuleAccess = { view: false, add: false, edit: false, delete: false, reach: null, isAdmin: false };
const ADMIN: ModuleAccess = { view: true, add: true, edit: true, delete: true, reach: "Company", isAdmin: true };

/**
 * What the role may do in `module`. Courtesy only: it hides what the server
 * would refuse anyway. Admin comes from `access` (a role property), never from
 * the login-time `user.IsAdmin`; until access is known nothing is granted.
 */
export function useAccess(module: ModuleKey): ModuleAccess {
  const access = useAuthStore((s) => s.access);
  if (access?.isAdmin) return ADMIN;
  const m = access?.modules[module];
  return m ? { ...m, reach: m.reach ?? null, isAdmin: false } : NONE;
}

/**
 * Re-reads access + menu rights when the app comes to the foreground (and on
 * mount), at most once a minute, so a role change reaches a signed-in phone
 * without a re-login. Mounted once, in App.tsx.
 */
export function useAccessRefresh(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    if (!isAuthenticated) return;
    const refresh = () => void useAuthStore.getState().refreshAccess();
    if (AppState.currentState === "active") refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [isAuthenticated]);
}
