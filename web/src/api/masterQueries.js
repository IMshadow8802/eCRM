// src/api/masterQueries.js
// Endpoint constants + thin POST fetchers for the master-data module (users,
// user groups, teams, projects). Same shape as api/salesQueries.js — pages
// POST through the shared apiClient (see hooks/useApiQuery.jsx).
import { apiClient } from "../utils/axiosConfig";

export const MASTER_ENDPOINTS = {
  auth: {
    fetchMyAccess: "/api/auth/fetchMyAccess",
  },
  users: {
    fetchUsers: "/api/users/fetchUsers",
    saveUser: "/api/users/saveUser",
    deleteUser: "/api/users/deleteUser",
    directory: "/api/users/directory",
    fetchUserHandover: "/api/users/fetchUserHandover",
    updateProfile: "/api/users/me/updateProfile",
    changePassword: "/api/users/me/changePassword",
  },
  userGroups: {
    fetchUserGroups: "/api/user-groups/fetchUserGroups",
    saveUserGroup: "/api/user-groups/saveUserGroup",
    deleteUserGroup: "/api/user-groups/deleteUserGroup",
    fetchGroupModules: "/api/user-groups/fetchGroupModules",
    saveGroupModules: "/api/user-groups/saveGroupModules",
  },
  branches: {
    saveBranch: "/api/branches/saveBranch",
  },
  userBranchAccess: {
    fetchUserBranchAccess: "/api/user-branch-access/fetchUserBranchAccess",
    saveUserBranchAccess: "/api/user-branch-access/saveUserBranchAccess",
    deleteUserBranchAccess: "/api/user-branch-access/deleteUserBranchAccess",
  },
  teams: {
    fetchTeams: "/api/teams/fetchTeams",
    saveTeam: "/api/teams/saveTeam",
    deleteTeam: "/api/teams/deleteTeam",
  },
  projects: {
    fetchProjects: "/api/projects/fetchProjects",
    saveProject: "/api/projects/saveProject",
    // Mounted 2026-08-04 — the controller method existed but was never routed,
    // so the Projects delete button 404'd. Call site is unchanged.
    deleteProject: "/api/projects/deleteProject",
  },
};

// ponytail: every fetcher is `apiClient.post(endpoint, params)` — one factory
// beats 17 hand-written near-duplicates.
const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

// Auth: the caller's module access + menu rights, re-read without a login.
export const fetchMyAccess = post(MASTER_ENDPOINTS.auth.fetchMyAccess);

// Users
export const fetchUsers = post(MASTER_ENDPOINTS.users.fetchUsers);
export const saveUser = post(MASTER_ENDPOINTS.users.saveUser);
export const deleteUser = post(MASTER_ENDPOINTS.users.deleteUser);
export const fetchUserHandover = post(MASTER_ENDPOINTS.users.fetchUserHandover);
export const directory = post(MASTER_ENDPOINTS.users.directory);
export const updateProfile = post(MASTER_ENDPOINTS.users.updateProfile);
export const changePassword = post(MASTER_ENDPOINTS.users.changePassword);

// User groups (roles + module grid)
export const fetchUserGroups = post(MASTER_ENDPOINTS.userGroups.fetchUserGroups);
export const saveUserGroup = post(MASTER_ENDPOINTS.userGroups.saveUserGroup);
export const deleteUserGroup = post(MASTER_ENDPOINTS.userGroups.deleteUserGroup);
export const fetchGroupModules = post(MASTER_ENDPOINTS.userGroups.fetchGroupModules);
export const saveGroupModules = post(MASTER_ENDPOINTS.userGroups.saveGroupModules);

// Offices (tblBranch tree) and a user's extra offices
export const saveBranch = post(MASTER_ENDPOINTS.branches.saveBranch);
export const fetchUserBranchAccess = post(MASTER_ENDPOINTS.userBranchAccess.fetchUserBranchAccess);
export const saveUserBranchAccess = post(MASTER_ENDPOINTS.userBranchAccess.saveUserBranchAccess);
export const deleteUserBranchAccess = post(MASTER_ENDPOINTS.userBranchAccess.deleteUserBranchAccess);

// Teams
export const fetchTeams = post(MASTER_ENDPOINTS.teams.fetchTeams);
export const saveTeam = post(MASTER_ENDPOINTS.teams.saveTeam);
export const deleteTeam = post(MASTER_ENDPOINTS.teams.deleteTeam);

// Projects
export const fetchProjects = post(MASTER_ENDPOINTS.projects.fetchProjects);
export const saveProject = post(MASTER_ENDPOINTS.projects.saveProject);
export const deleteProject = post(MASTER_ENDPOINTS.projects.deleteProject);
