// stores/useWorkspaceStore.js
//
// Tracks the active workspace the user is viewing on the kanban/list
// screen. Persisted so a reload returns the user to the same board.
//
// Deliberately minimal — workspace list + CRUD go through useApiQuery
// directly against the /api/workspaces/* endpoints. Only the "which
// board am I looking at right now" selector lives here.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const useWorkspaceStore = create(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      activeWorkspaceType: null,
      activeWorkspaceRole: null,
      activeWorkspaceName: null,
      activeWorkspaceColor: null,

      setActiveWorkspace: (workspace) =>
        set(
          workspace
            ? {
                activeWorkspaceId: workspace.Id ?? null,
                activeWorkspaceType: workspace.Type ?? null,
                activeWorkspaceRole: workspace.MyRole ?? null,
                activeWorkspaceName: workspace.Name ?? null,
                activeWorkspaceColor: workspace.Color ?? null,
              }
            : {
                activeWorkspaceId: null,
                activeWorkspaceType: null,
                activeWorkspaceRole: null,
                activeWorkspaceName: null,
                activeWorkspaceColor: null,
              },
        ),

      clearActiveWorkspace: () =>
        set({
          activeWorkspaceId: null,
          activeWorkspaceType: null,
          activeWorkspaceRole: null,
          activeWorkspaceName: null,
          activeWorkspaceColor: null,
        }),

      // Caller-facing gates so UI can hide buttons without bespoke logic
      // per component. Match the sp_CheckTaskPermission matrix from 013.
      canManageMembers: () => {
        const role = useWorkspaceStore.getState().activeWorkspaceRole;
        return role === "owner";
      },
      canCreateTasks: () => {
        const role = useWorkspaceStore.getState().activeWorkspaceRole;
        return role === "owner" || role === "manager" || role === "member";
      },
      canEditOthersTasks: () => {
        const role = useWorkspaceStore.getState().activeWorkspaceRole;
        return role === "owner" || role === "manager";
      },
    }),
    {
      name: "workspace-store",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export default useWorkspaceStore;
