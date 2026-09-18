// src/api/userQueries.ts
// Only what a phone needs. User administration (saveUser/deleteUser) is
// deliberately absent — admin-gated desk work, stays on web.
import { post, postData } from "./client";
import type { ApiEnvelope, AssignableUser, DirectoryUser } from "../types/api";

export const USER_ENDPOINTS = {
  directory: "/api/users/directory",
  fetchAssignableUsers: "/api/users/fetchAssignableUsers",
  updateProfile: "/api/users/me/updateProfile",
  changePassword: "/api/users/me/changePassword",
} as const;

/**
 * Non-admin-safe name/avatar lookup for assignee pickers and comment authors.
 * `fetchUsers` is admin-only; this is the endpoint an ordinary member may call.
 */
export const fetchUserDirectory = (
  params: { SearchTerm?: string | null } = {},
): Promise<DirectoryUser[]> =>
  postData<DirectoryUser>(
    USER_ENDPOINTS.directory,
    { SearchTerm: null, ...params },
    "users",
  );

/**
 * Who the caller may hand a record to. sp_FetchAssignableUsers scopes it
 * (own subtree + own manager for Team/Self; readable branches for wide
 * scopes) and `assertCanAssign` re-checks membership on every save and
 * transfer — this is the pick-list, not the gate. `BranchId` lists another
 * branch's roster for a cross-branch move; mobile never passes it.
 */
export const fetchAssignableUsers = (
  params: { BranchId?: number | null } = {},
): Promise<AssignableUser[]> =>
  postData<AssignableUser>(
    USER_ENDPOINTS.fetchAssignableUsers,
    { BranchId: null, ...params },
    "users",
  );

export const updateMyProfile = (params: {
  FullName: string;
  Email?: string | null;
  Mobile?: string | null;
  JobTitle?: string | null;
  Avatar?: string | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(USER_ENDPOINTS.updateProfile, {
    Email: null,
    Mobile: null,
    JobTitle: null,
    Avatar: null,
    ...params,
  });

export const changeMyPassword = (params: {
  CurrentPassword: string;
  NewPassword: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(USER_ENDPOINTS.changePassword, params);
