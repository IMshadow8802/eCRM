// src/api/userQueries.ts
// Only what a phone needs. User administration (saveUser/deleteUser) is
// deliberately absent — admin-gated desk work, stays on web.
import { post, postData } from "./client";
import type { ApiEnvelope, AssignableUser, Branch, DirectoryUser } from "../types/api";

export const USER_ENDPOINTS = {
  directory: "/api/users/directory",
  fetchAssignableUsers: "/api/users/fetchAssignableUsers",
  fetchBranches: "/api/users/fetchBranches",
  updateProfile: "/api/users/me/updateProfile",
  changePassword: "/api/users/me/changePassword",
} as const;

/**
 * Non-admin-safe name/avatar lookup for assignee pickers and comment authors.
 * `fetchUsers` is admin-only; this is the endpoint an ordinary member may call.
 * The whole company roster: the controller takes no filter, so search locally.
 */
export const fetchUserDirectory = (): Promise<DirectoryUser[]> =>
  postData<DirectoryUser>(USER_ENDPOINTS.directory, {}, "users");

/**
 * Who the caller may hand a record to, for the given module (the roster
 * follows that module's reach). `assertCanAssign` re-checks membership on every
 * save and transfer — this is the pick-list, not the gate. `BranchId` lists
 * another office's roster for a cross-office move; mobile never passes it.
 */
export const fetchAssignableUsers = (
  params: { Module?: "leads" | "complaints"; BranchId?: number | null } = {},
): Promise<AssignableUser[]> =>
  postData<AssignableUser>(
    USER_ENDPOINTS.fetchAssignableUsers,
    { BranchId: null, Module: "leads", ...params },
    "users",
  );

/** Every office in the company, open to any signed-in user (the office pick-list). */
export const fetchBranches = (): Promise<Branch[]> =>
  postData<Branch>(USER_ENDPOINTS.fetchBranches, {}, "branches");

/** userController.updateMyProfile reads only these four; anything else is dropped. */
export const updateMyProfile = (params: {
  FullName: string;
  Email?: string | null;
  Mobile?: string | null;
  Avatar?: string | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(USER_ENDPOINTS.updateProfile, {
    Email: null,
    Mobile: null,
    Avatar: null,
    ...params,
  });

export const changeMyPassword = (params: {
  CurrentPassword: string;
  NewPassword: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(USER_ENDPOINTS.changePassword, params);
