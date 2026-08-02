// src/api/workspaceQueries.ts
// Payloads taken from backend/src/controllers/workspaceController.js.
import { post, postData } from "./client";
import type {
  ApiEnvelope,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceType,
} from "../types/api";

export const WORKSPACE_ENDPOINTS = {
  fetchWorkspaces: "/api/workspaces/fetchWorkspaces",
  saveWorkspace: "/api/workspaces/saveWorkspace",
  fetchWorkspaceMembers: "/api/workspaces/fetchWorkspaceMembers",
  addWorkspaceMember: "/api/workspaces/addWorkspaceMember",
  setWorkspaceMemberRole: "/api/workspaces/setWorkspaceMemberRole",
  removeWorkspaceMember: "/api/workspaces/removeWorkspaceMember",
  respondInvite: "/api/workspaces/respondInvite",
  archiveWorkspace: "/api/workspaces/archiveWorkspace",
  deleteWorkspace: "/api/workspaces/deleteWorkspace",
  convertWorkspaceToShared: "/api/workspaces/convertWorkspaceToShared",
  transferWorkspaceOwnership: "/api/workspaces/transferWorkspaceOwnership",
  syncProjectWorkspaceMembers: "/api/workspaces/syncProjectWorkspaceMembers",
  ensurePersonalWorkspace: "/api/workspaces/ensurePersonalWorkspace",
  applyKanbanTemplate: "/api/workspaces/applyKanbanTemplate",
} as const;

export const fetchWorkspaces = (
  params: {
    Id?: number;
    Type?: WorkspaceType | null;
    IncludeArchived?: boolean;
    PageNumber?: number;
    PageSize?: number;
    SearchTerm?: string | null;
  } = {},
): Promise<Workspace[]> =>
  postData<Workspace>(
    WORKSPACE_ENDPOINTS.fetchWorkspaces,
    {
      Id: 0,
      Type: null,
      IncludeArchived: false,
      PageNumber: 1,
      PageSize: 50,
      SearchTerm: null,
      ...params,
    },
    "workspaces",
  );

export const saveWorkspace = (params: {
  Id?: number;
  Name: string;
  Type: WorkspaceType;
  TeamId?: number | null;
  ProjectId?: number | null;
  Color?: string | null;
  Icon?: string | null;
  TemplateKey?: string;
  /** Only meaningful for `shared`. Each becomes a pending invite. */
  Members?: number[];
}): Promise<ApiEnvelope<{ workspaceId: number }>> =>
  post(WORKSPACE_ENDPOINTS.saveWorkspace, {
    Id: 0,
    TeamId: null,
    ProjectId: null,
    Color: null,
    Icon: null,
    TemplateKey: "basic",
    Members: [],
    ...params,
  });

/**
 * Returns pending and declined rows as well as active members. Filter on
 * `InviteStatus === "active"` before offering anyone as an assignee — a
 * pending invite is not a member, and showing them is how the web leaked
 * non-members into its pickers.
 */
export const fetchWorkspaceMembers = (params: {
  WorkspaceId: number;
}): Promise<WorkspaceMember[]> =>
  postData<WorkspaceMember>(
    WORKSPACE_ENDPOINTS.fetchWorkspaceMembers,
    params,
    "members",
  );

export const addWorkspaceMember = (params: {
  WorkspaceId: number;
  UserId: number;
  Role?: WorkspaceRole;
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.addWorkspaceMember, { Role: "member", ...params });

/** Role only — never touches invite state. */
export const setWorkspaceMemberRole = (params: {
  WorkspaceId: number;
  UserId: number;
  Role: WorkspaceRole;
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.setWorkspaceMemberRole, params);

export const removeWorkspaceMember = (params: {
  WorkspaceId: number;
  UserId: number;
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.removeWorkspaceMember, params);

export const respondInvite = (params: {
  WorkspaceId: number;
  Action: "accept" | "decline";
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.respondInvite, params);

export const archiveWorkspace = (params: {
  WorkspaceId: number;
  IsArchived?: boolean;
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.archiveWorkspace, { IsArchived: true, ...params });

/** `DryRun: true` returns the blast radius without deleting — always ask first. */
export const deleteWorkspace = (params: {
  WorkspaceId: number;
  DryRun?: boolean;
}): Promise<ApiEnvelope<{ taskCount: number; attachmentCount: number }>> =>
  post(WORKSPACE_ENDPOINTS.deleteWorkspace, { DryRun: false, ...params });

export const convertWorkspaceToShared = (params: {
  WorkspaceId: number;
  MemberIds: number[];
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.convertWorkspaceToShared, params);

export const transferWorkspaceOwnership = (params: {
  WorkspaceId: number;
  NewOwnerUserId: number;
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.transferWorkspaceOwnership, params);

export const syncProjectWorkspaceMembers = (params: {
  WorkspaceId: number;
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.syncProjectWorkspaceMembers, params);

/** Idempotent — safe on every login. Seeds a personal workspace if missing. */
export const ensurePersonalWorkspace = (): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.ensurePersonalWorkspace, {});

export const applyKanbanTemplate = (params: {
  WorkspaceId: number;
  TemplateKey?: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(WORKSPACE_ENDPOINTS.applyKanbanTemplate, {
    TemplateKey: "basic",
    ...params,
  });
