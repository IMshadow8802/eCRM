import { describe, it, expect, beforeEach } from "vitest";
import useAuthStore from "./useAuthStore";

describe("useAuthStore.hasPermission", () => {
  beforeEach(() => {
    // Reset store between tests by overwriting permissions
    useAuthStore.setState({
      permissions: {
        menuItems: [
          {
            description: "Leads",
            permissions: { view: true, add: true, edit: true, delete: false },
          },
          {
            description: "Tasks",
            permissions: { view: true, add: false, edit: false, delete: false },
          },
        ],
      },
    });
  });

  it("returns true for granted permissions", () => {
    expect(useAuthStore.getState().hasPermission("Leads", "view")).toBe(true);
    expect(useAuthStore.getState().hasPermission("Leads", "add")).toBe(true);
    expect(useAuthStore.getState().hasPermission("Leads", "edit")).toBe(true);
  });

  it("returns false for denied permissions", () => {
    expect(useAuthStore.getState().hasPermission("Leads", "delete")).toBe(false);
    expect(useAuthStore.getState().hasPermission("Tasks", "edit")).toBe(false);
  });

  it("returns false for unknown menus", () => {
    expect(useAuthStore.getState().hasPermission("Accounts", "view")).toBe(false);
  });

  it("returns false when permissions are missing entirely", () => {
    useAuthStore.setState({ permissions: null });
    expect(useAuthStore.getState().hasPermission("Leads", "view")).toBe(false);
  });

  it("returns false when menuItems is missing", () => {
    useAuthStore.setState({ permissions: {} });
    expect(useAuthStore.getState().hasPermission("Leads", "view")).toBe(false);
  });
});
