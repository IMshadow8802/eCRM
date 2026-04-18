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

  it("groups workspaces by type under 'Your X' headers", async () => {
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

    expect(await screen.findByText("Your Personal")).toBeInTheDocument();
    expect(screen.getByText("Your Shared")).toBeInTheDocument();
    expect(screen.getByText("Your Projects")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-menu-1")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-menu-2")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-menu-3")).toBeInTheDocument();
  });

  it("surfaces admin-visible workspaces under a separate read-only section", async () => {
    workspaceFixture.seed({
      Id: 1,
      Name: "My Tasks",
      Type: "personal",
      MyRole: "owner",
      MemberCount: 1,
    });
    // shared board the admin is NOT a member of — API still returns it
    workspaceFixture.seed({
      Id: 9,
      Name: "Raaj and Aman",
      Type: "shared",
      MyRole: null,
      MemberCount: 3,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));

    expect(await screen.findByText("Your Personal")).toBeInTheDocument();
    expect(
      screen.getByText(/Admin view — Shared \(read-only\)/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workspace-menu-9")).toBeInTheDocument();
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

  it("owners see a gear next to their workspace that opens settings", async () => {
    workspaceFixture.seed({
      Id: 55,
      Name: "Hobbies",
      Type: "personal",
      OwnerUserId: 1,
      MyRole: "owner",
      MemberCount: 1,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));
    const gear = await screen.findByTestId("workspace-menu-55-settings");
    await user.click(gear);

    expect(
      await screen.findByTestId("workspace-settings-modal"),
    ).toBeInTheDocument();
  });

  it("surfaces pending invites with a badge and opens the accept modal", async () => {
    workspaceFixture.seed({
      Id: 77,
      Name: "Raaj's board",
      Type: "shared",
      MyRole: null,
      MyInviteStatus: "pending",
      MemberCount: 3,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    expect(await screen.findByTestId("pending-invites-badge")).toHaveTextContent("1");

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));
    expect(await screen.findByText(/Pending invites · 1/i)).toBeInTheDocument();

    await user.click(await screen.findByTestId("workspace-menu-pending-77"));
    expect(
      await screen.findByText(/Join "Raaj's board"\?/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invite-accept")).toBeInTheDocument();
    expect(screen.getByTestId("invite-decline")).toBeInTheDocument();
  });
});
