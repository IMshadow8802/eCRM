// src/api/userQueries.ts
// Only what a phone needs. User administration (saveUser/deleteUser) is
// deliberately absent — admin-gated desk work, stays on web.
import { post, postData } from "./client";
import type { ApiEnvelope, AssignableUser, Branch, DirectoryUser } from "../types/api";

const USER_ENDPOINTS = {
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
 * Who the caller may hand a record to in `Module` (the role's "Can assign to"),
 * ordered GroupRank, FullName. Pass `RecordId` when reassigning one record so
 * the person who gave it to the caller is marked `IsGiver`. The save/transfer
 * procedure re-checks — this is the pick-list, not the gate.
 */
export const fetchAssignableUsers = ({
  Module,
  RecordId = null,
}: {
  Module: "leads" | "complaints";
  RecordId?: number | null;
}): Promise<AssignableUser[]> =>
  postData<AssignableUser>(USER_ENDPOINTS.fetchAssignableUsers, { Module, RecordId }, "users");

/** Every office in the company, open to any signed-in user (the office pick-list). */
export const fetchBranches = (): Promise<Branch[]> =>
  postData<Branch>(USER_ENDPOINTS.fetchBranches, {}, "branches");

/**
 * userController.updateMyProfile reads only these four. All four are required:
 * sp_UpdateOwnProfile (058) writes every column, so a missing one is blanked.
 */
export const updateMyProfile = (params: {
  FullName: string;
  Email: string | null;
  Mobile: string | null;
  Avatar: string | null;
}): Promise<ApiEnvelope<unknown>> => post(USER_ENDPOINTS.updateProfile, params);

export const changeMyPassword = (params: {
  CurrentPassword: string;
  NewPassword: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(USER_ENDPOINTS.changePassword, params);
