import { describe, it, expect, beforeEach } from "vitest";
import useWorkspaceStore from "./useWorkspaceStore";

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().clearActiveWorkspace();
  });

  it("defaults to no active workspace", () => {
    const s = useWorkspaceStore.getState();
    expect(s.activeWorkspaceId).toBeNull();
    expect(s.activeWorkspaceType).toBeNull();
    expect(s.activeWorkspaceRole).toBeNull();
  });

  it("setActiveWorkspace copies Id/Type/MyRole", () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 11,
      Type: "shared",
      MyRole: "member",
    });
    const s = useWorkspaceStore.getState();
    expect(s.activeWorkspaceId).toBe(11);
    expect(s.activeWorkspaceType).toBe("shared");
    expect(s.activeWorkspaceRole).toBe("member");
  });

  it("setActiveWorkspace(null) clears", () => {
    useWorkspaceStore.getState().setActiveWorkspace({ Id: 1, Type: "personal", MyRole: "owner" });
    useWorkspaceStore.getState().setActiveWorkspace(null);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });

  it("role gates match the permission matrix", () => {
    const s = useWorkspaceStore.getState();
    s.setActiveWorkspace({ Id: 1, Type: "shared", MyRole: "owner" });
    expect(s.canManageMembers()).toBe(true);
    expect(s.canCreateTasks()).toBe(true);
    expect(s.canEditOthersTasks()).toBe(true);

    s.setActiveWorkspace({ Id: 1, Type: "shared", MyRole: "manager" });
    expect(s.canManageMembers()).toBe(false);
    expect(s.canCreateTasks()).toBe(true);
    expect(s.canEditOthersTasks()).toBe(true);

    s.setActiveWorkspace({ Id: 1, Type: "shared", MyRole: "member" });
    expect(s.canManageMembers()).toBe(false);
    expect(s.canCreateTasks()).toBe(true);
    expect(s.canEditOthersTasks()).toBe(false);

    s.setActiveWorkspace({ Id: 1, Type: "shared", MyRole: "viewer" });
    expect(s.canManageMembers()).toBe(false);
    expect(s.canCreateTasks()).toBe(false);
    expect(s.canEditOthersTasks()).toBe(false);
  });

  it("setActiveWorkspace handles missing optional fields", () => {
    useWorkspaceStore.getState().setActiveWorkspace({ Id: 2 });
    const s = useWorkspaceStore.getState();
    expect(s.activeWorkspaceId).toBe(2);
    expect(s.activeWorkspaceType).toBeNull();
    expect(s.activeWorkspaceRole).toBeNull();
  });
});
