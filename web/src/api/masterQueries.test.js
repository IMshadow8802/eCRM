import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn(() => Promise.resolve({ data: { success: true } })) },
}));

import { apiClient } from "../utils/axiosConfig";
import * as masterQueries from "./masterQueries";
import { MASTER_ENDPOINTS } from "./masterQueries";

// Every fetcher is the same `post(endpoint)` factory (see masterQueries.js) —
// one table-driven test proves the pattern for all of them.
const FETCHERS = {
  fetchMyAccess: MASTER_ENDPOINTS.auth.fetchMyAccess,
  fetchUsers: MASTER_ENDPOINTS.users.fetchUsers,
  saveUser: MASTER_ENDPOINTS.users.saveUser,
  deleteUser: MASTER_ENDPOINTS.users.deleteUser,
  directory: MASTER_ENDPOINTS.users.directory,
  updateProfile: MASTER_ENDPOINTS.users.updateProfile,
  changePassword: MASTER_ENDPOINTS.users.changePassword,
  fetchUserGroups: MASTER_ENDPOINTS.userGroups.fetchUserGroups,
  saveUserGroup: MASTER_ENDPOINTS.userGroups.saveUserGroup,
  deleteUserGroup: MASTER_ENDPOINTS.userGroups.deleteUserGroup,
  fetchGroupModules: MASTER_ENDPOINTS.userGroups.fetchGroupModules,
  saveGroupModules: MASTER_ENDPOINTS.userGroups.saveGroupModules,
  saveBranch: MASTER_ENDPOINTS.branches.saveBranch,
  fetchUserBranchAccess: MASTER_ENDPOINTS.userBranchAccess.fetchUserBranchAccess,
  saveUserBranchAccess: MASTER_ENDPOINTS.userBranchAccess.saveUserBranchAccess,
  deleteUserBranchAccess: MASTER_ENDPOINTS.userBranchAccess.deleteUserBranchAccess,
  fetchTeams: MASTER_ENDPOINTS.teams.fetchTeams,
  saveTeam: MASTER_ENDPOINTS.teams.saveTeam,
  deleteTeam: MASTER_ENDPOINTS.teams.deleteTeam,
  fetchProjects: MASTER_ENDPOINTS.projects.fetchProjects,
  saveProject: MASTER_ENDPOINTS.projects.saveProject,
  deleteProject: MASTER_ENDPOINTS.projects.deleteProject,
};

describe("masterQueries", () => {
  beforeEach(() => {
    apiClient.post.mockClear();
  });

  it.each(Object.entries(FETCHERS))(
    "%s posts to its endpoint with the given params",
    async (name, endpoint) => {
      const params = { foo: "bar" };
      await masterQueries[name](params);
      expect(apiClient.post).toHaveBeenCalledWith(endpoint, params);
    },
  );

  it("defaults params to {} when called with no arguments", async () => {
    await masterQueries.fetchUsers();
    expect(apiClient.post).toHaveBeenCalledWith(MASTER_ENDPOINTS.users.fetchUsers, {});
  });

  // deleteProject was a controller method with no route until 2026-08-04, so the
  // path is easy to get wrong; pin it (and the self-service paths, which nest
  // under /me/) rather than trusting the table above to be typo-free.
  it("keeps the paths that are easy to get wrong", () => {
    expect(MASTER_ENDPOINTS.projects.deleteProject).toBe("/api/projects/deleteProject");
    expect(MASTER_ENDPOINTS.users.updateProfile).toBe("/api/users/me/updateProfile");
    expect(MASTER_ENDPOINTS.users.changePassword).toBe("/api/users/me/changePassword");
    expect(MASTER_ENDPOINTS.branches.saveBranch).toBe("/api/branches/saveBranch");
    expect(MASTER_ENDPOINTS.userBranchAccess.saveUserBranchAccess).toBe(
      "/api/user-branch-access/saveUserBranchAccess",
    );
    expect(masterQueries).not.toHaveProperty("fetchGroupAccess");
    expect(masterQueries).not.toHaveProperty("saveGroupAccess");
  });
});
