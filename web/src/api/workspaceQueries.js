// src/api/workspaceQueries.js
// Endpoint constants + thin POST fetchers for the workspace module (lifecycle,
// membership, kanban template seeding). Mirrors how pages call
// useApiQuery/useApiMutation today (POST via the shared apiClient) — see
// hooks/useApiQuery.jsx. Same shape as api/salesQueries.js.
import { apiClient } from "../utils/axiosConfig";

export const WORKSPACE_ENDPOINTS = {
  workspaces: {
    fetchWorkspaces: "/api/workspaces/fetchWorkspaces",
    saveWorkspace: "/api/workspaces/saveWorkspace",
    deleteWorkspace: "/api/workspaces/deleteWorkspace",
    archiveWorkspace: "/api/workspaces/archiveWorkspace",
    convertWorkspaceToShared: "/api/workspaces/convertWorkspaceToShared",
    transferWorkspaceOwnership: "/api/workspaces/transferWorkspaceOwnership",
    ensurePersonalWorkspace: "/api/workspaces/ensurePersonalWorkspace",
    applyKanbanTemplate: "/api/workspaces/applyKanbanTemplate",
  },
  members: {
    fetchWorkspaceMembers: "/api/workspaces/fetchWorkspaceMembers",
    addWorkspaceMember: "/api/workspaces/addWorkspaceMember",
    removeWorkspaceMember: "/api/workspaces/removeWorkspaceMember",
    setWorkspaceMemberRole: "/api/workspaces/setWorkspaceMemberRole",
    syncProjectWorkspaceMembers: "/api/workspaces/syncProjectWorkspaceMembers",
    respondInvite: "/api/workspaces/respondInvite",
  },
};

// ponytail: every fetcher is `apiClient.post(endpoint, params)` — no per-endpoint
// logic exists yet, so one factory beats 14 hand-written near-duplicates.
const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

// Workspace lifecycle
export const fetchWorkspaces = post(WORKSPACE_ENDPOINTS.workspaces.fetchWorkspaces);
export const saveWorkspace = post(WORKSPACE_ENDPOINTS.workspaces.saveWorkspace);
export const deleteWorkspace = post(WORKSPACE_ENDPOINTS.workspaces.deleteWorkspace);
export const archiveWorkspace = post(WORKSPACE_ENDPOINTS.workspaces.archiveWorkspace);
export const convertWorkspaceToShared = post(WORKSPACE_ENDPOINTS.workspaces.convertWorkspaceToShared);
export const transferWorkspaceOwnership = post(WORKSPACE_ENDPOINTS.workspaces.transferWorkspaceOwnership);
export const ensurePersonalWorkspace = post(WORKSPACE_ENDPOINTS.workspaces.ensurePersonalWorkspace);
export const applyKanbanTemplate = post(WORKSPACE_ENDPOINTS.workspaces.applyKanbanTemplate);

// Membership
export const fetchWorkspaceMembers = post(WORKSPACE_ENDPOINTS.members.fetchWorkspaceMembers);
export const addWorkspaceMember = post(WORKSPACE_ENDPOINTS.members.addWorkspaceMember);
export const removeWorkspaceMember = post(WORKSPACE_ENDPOINTS.members.removeWorkspaceMember);
export const setWorkspaceMemberRole = post(WORKSPACE_ENDPOINTS.members.setWorkspaceMemberRole);
export const syncProjectWorkspaceMembers = post(WORKSPACE_ENDPOINTS.members.syncProjectWorkspaceMembers);
export const respondInvite = post(WORKSPACE_ENDPOINTS.members.respondInvite);
