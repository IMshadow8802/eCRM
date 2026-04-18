import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WorkspaceSwitcher from "./WorkspaceSwitcher";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import useAuthStore from "../../stores/useAuthStore";
import { workspaceFixture } from "../../test/mocks/handlers";
import renderProviders from "../../test/renderWithProviders";

const renderWithProviders = (ui) => renderProviders(ui, { router: false });

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    workspaceFixture.reset();
    useWorkspaceStore.getState().clearActiveWorkspace();
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  it("shows 'Pick a workspace' when none is active", async () => {
    workspaceFixture.seed({
      Id: 1,
      Name: "My Tasks",
      Type: "personal",
      OwnerUserId: 1,
      MyRole: "owner",
      MemberCount: 1,
    });
    renderWithProviders(<WorkspaceSwitcher />);
    expect(await screen.findByText(/Pick a workspace/i)).toBeInTheDocument();
  });

  it("shows active workspace name + role chip", async () => {
    workspaceFixture.seed({
      Id: 7,
      Name: "Design Team",
      Type: "shared",
      OwnerUserId: 1,
      MyRole: "member",
      MemberCount: 3,
    });
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 7,
      Type: "shared",
      MyRole: "member",
    });
    renderWithProviders(<WorkspaceSwitcher />);
    await waitFor(() => {
      expect(screen.getByText("Design Team")).toBeInTheDocument();
    });
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  it("groups workspaces by type in the dropdown", async () => {
    workspaceFixture.seed({
      Id: 1,
      Name: "My Tasks",
      Type: "personal",
      MyRole: "owner",
      MemberCount: 1,
    });
    workspaceFixture.seed({
      Id: 2,
      Name: "Marketing",
      Type: "shared",
      MyRole: "member",
      MemberCount: 4,
    });
    workspaceFixture.seed({
      Id: 3,
      Name: "Phoenix",
      Type: "project",
      MyRole: "manager",
      MemberCount: 6,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));

    expect(await screen.findByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-menu-1")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-menu-2")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-menu-3")).toBeInTheDocument();
  });

  it("clicking a workspace option sets active workspace", async () => {
    workspaceFixture.seed({
      Id: 42,
      Name: "Ops",
      Type: "shared",
      MyRole: "member",
      MemberCount: 2,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));
    await user.click(await screen.findByTestId("workspace-menu-42"));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(42);
    });
  });

  it("opens the create modal from the dropdown", async () => {
    renderWithProviders(<WorkspaceSwitcher />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));
    await user.click(await screen.findByTestId("workspace-menu-create"));

    expect(await screen.findByLabelText(/workspace name/i)).toBeInTheDocument();
  });
});
