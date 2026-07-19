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

  it("lists archived workspaces under an Archived section and restores on demand", async () => {
    workspaceFixture.seed({
      Id: 5,
      Name: "Old Board",
      Type: "shared",
      OwnerUserId: 1,
      MyRole: "owner",
      IsArchived: true,
      MemberCount: 2,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));

    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Old Board")).toBeInTheDocument();

    await user.click(screen.getByTestId("workspace-menu-archived-5-restore"));
    await waitFor(() => {
      expect(workspaceFixture.list[0].IsArchived).toBe(false);
    });
    expect(await screen.findByText("Workspace restored")).toBeInTheDocument();
  });

  it("shows 'Nothing archived' when the archive is empty", async () => {
    workspaceFixture.seed({
      Id: 1,
      Name: "My Tasks",
      Type: "personal",
      MyRole: "owner",
      MemberCount: 1,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));

    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Nothing archived")).toBeInTheDocument();
  });

  it("archived workspaces stay out of the normal type groups", async () => {
    workspaceFixture.seed({
      Id: 6,
      Name: "Dead Board",
      Type: "shared",
      MyRole: "owner",
      IsArchived: true,
      MemberCount: 1,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));
    await screen.findByText("Archived");
    expect(screen.queryByText("Your Shared")).toBeNull();
  });

  it("plain members also get the gear so they can leave from settings", async () => {
    workspaceFixture.seed({
      Id: 8,
      Name: "Ops",
      Type: "shared",
      OwnerUserId: 2,
      MyRole: "member",
      MemberCount: 3,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));
    const gear = await screen.findByTestId("workspace-menu-8-settings");
    await user.click(gear);

    expect(
      await screen.findByTestId("workspace-settings-modal"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("workspace-leave-button"),
    ).toBeInTheDocument();
  });

  it("clicking an archived workspace opens settings where Delete lives", async () => {
    workspaceFixture.seed({
      Id: 9,
      Name: "Old Board",
      Type: "personal",
      OwnerUserId: 1,
      MyRole: "owner",
      IsArchived: true,
      MemberCount: 1,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workspace-switcher-button"));
    await user.click(await screen.findByTestId("workspace-menu-archived-9"));

    expect(
      await screen.findByTestId("workspace-settings-modal"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("workspace-delete-button"),
    ).toBeInTheDocument();
  });

  // A pending invite must confront the user on arrival — not wait to be
  // discovered inside the switcher menu. Re-prompts on every mount (= every
  // visit to Tasks) until accepted or declined.
  it("auto-opens the invite modal on mount when a pending invite exists", async () => {
    workspaceFixture.seed({
      Id: 78,
      Name: "Sales board",
      Type: "shared",
      MyRole: null,
      MyInviteStatus: "pending",
      MemberCount: 2,
    });
    renderWithProviders(<WorkspaceSwitcher />);

    // No clicks — the modal appears by itself.
    expect(await screen.findByTestId("invite-response-modal")).toBeInTheDocument();
    expect(await screen.findByText(/Join "Sales board"\?/i)).toBeInTheDocument();
  });

  it("does not auto-open anything when there are no pending invites", async () => {
    renderWithProviders(<WorkspaceSwitcher />);
    expect(await screen.findByTestId("workspace-switcher-button")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-response-modal")).not.toBeInTheDocument();
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

  it("refreshes the stored role when the server list disagrees (no interaction)", async () => {
    workspaceFixture.seed({
      Id: 7,
      Name: "Design Team",
      Type: "shared",
      OwnerUserId: 1,
      MyRole: "manager",
      MemberCount: 3,
    });
    // Persisted store copy is stale: still says plain member.
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 7,
      Type: "shared",
      MyRole: "member",
      Name: "Design Team",
    });
    renderWithProviders(<WorkspaceSwitcher />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().activeWorkspaceRole).toBe("manager");
    });
  });

  it("clears the active workspace when it is gone from the fresh list", async () => {
    workspaceFixture.seed({
      Id: 1,
      Name: "My Tasks",
      Type: "personal",
      MyRole: "owner",
      MemberCount: 1,
    });
    // Active board was deleted / left / access lost on another device.
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 99,
      Type: "shared",
      MyRole: "member",
      Name: "Ghost board",
    });
    renderWithProviders(<WorkspaceSwitcher />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    });
  });
});
