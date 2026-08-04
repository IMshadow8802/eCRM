import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn(() => Promise.resolve({ data: { success: true } })) },
}));

import { apiClient } from "../utils/axiosConfig";
import * as workspaceQueries from "./workspaceQueries";
import { WORKSPACE_ENDPOINTS } from "./workspaceQueries";

// Every fetcher is the same `post(endpoint)` factory (see workspaceQueries.js)
// — one table-driven test proves the pattern for all 14 rather than hand
// duplicating the same assertion 14 times.
const FETCHERS = {
  fetchWorkspaces: WORKSPACE_ENDPOINTS.workspaces.fetchWorkspaces,
  saveWorkspace: WORKSPACE_ENDPOINTS.workspaces.saveWorkspace,
  deleteWorkspace: WORKSPACE_ENDPOINTS.workspaces.deleteWorkspace,
  archiveWorkspace: WORKSPACE_ENDPOINTS.workspaces.archiveWorkspace,
  convertWorkspaceToShared: WORKSPACE_ENDPOINTS.workspaces.convertWorkspaceToShared,
  transferWorkspaceOwnership: WORKSPACE_ENDPOINTS.workspaces.transferWorkspaceOwnership,
  ensurePersonalWorkspace: WORKSPACE_ENDPOINTS.workspaces.ensurePersonalWorkspace,
  applyKanbanTemplate: WORKSPACE_ENDPOINTS.workspaces.applyKanbanTemplate,
  fetchWorkspaceMembers: WORKSPACE_ENDPOINTS.members.fetchWorkspaceMembers,
  addWorkspaceMember: WORKSPACE_ENDPOINTS.members.addWorkspaceMember,
  removeWorkspaceMember: WORKSPACE_ENDPOINTS.members.removeWorkspaceMember,
  setWorkspaceMemberRole: WORKSPACE_ENDPOINTS.members.setWorkspaceMemberRole,
  syncProjectWorkspaceMembers: WORKSPACE_ENDPOINTS.members.syncProjectWorkspaceMembers,
  respondInvite: WORKSPACE_ENDPOINTS.members.respondInvite,
};

describe("workspaceQueries", () => {
  beforeEach(() => {
    apiClient.post.mockClear();
  });

  it.each(Object.entries(FETCHERS))(
    "%s posts to its endpoint with the given params",
    async (name, endpoint) => {
      const params = { foo: "bar" };
      await workspaceQueries[name](params);
      expect(apiClient.post).toHaveBeenCalledWith(endpoint, params);
    },
  );

  it("defaults params to {} when called with no arguments", async () => {
    await workspaceQueries.fetchWorkspaces();
    expect(apiClient.post).toHaveBeenCalledWith(
      WORKSPACE_ENDPOINTS.workspaces.fetchWorkspaces,
      {},
    );
  });

  // The endpoint map is the contract other modules import — every path must
  // live under /api/workspaces/ and match its key, or a page silently 404s.
  it("maps every endpoint key to /api/workspaces/<key>", () => {
    for (const group of Object.values(WORKSPACE_ENDPOINTS)) {
      for (const [name, path] of Object.entries(group)) {
        expect(path).toBe(`/api/workspaces/${name}`);
      }
    }
  });
});
