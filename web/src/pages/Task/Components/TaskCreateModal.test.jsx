import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TaskCreateModal from "./TaskCreateModal";
import useAuthStore from "../../../stores/useAuthStore";
import useWorkspaceStore from "../../../stores/useWorkspaceStore";
import { taskFixture, workspaceFixture } from "../../../test/mocks/handlers";
import renderWithProviders from "../../../test/renderWithProviders";

const member = (UserId, FullName) => ({
  UserId,
  FullName,
  Username: FullName.toLowerCase(),
  Role: "member",
  InviteStatus: "active",
  IsActive: 1,
});

const pickAssignee = async (user, name) => {
  await user.click(screen.getByTestId("create-task-assignees-input"));
  await user.click(await screen.findByRole("option", { name }));
};

const renderModal = (props = {}) =>
  renderWithProviders(
    <TaskCreateModal open onClose={() => {}} workspaceId={100} {...props} />,
    { router: false },
  );

const fillFirstStep = async (user, text = "Do the thing") => {
  const input = await screen.findByTestId("create-task-step-0");
  // TextInput wraps an <input>; userEvent.type targets the inner input
  const inner = input.querySelector("input") || input;
  await user.type(inner, text);
};

describe("TaskCreateModal", () => {
  beforeEach(() => {
    taskFixture.reset();
    workspaceFixture.reset();
    useWorkspaceStore.setState({ activeWorkspaceType: "shared" });
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { Id: 1, UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  it("Create is disabled when title empty", async () => {
    renderModal();
    const btn = await screen.findByTestId("create-task-submit");
    expect(btn).toBeDisabled();
  });

  it("Create is disabled when no steps are filled", async () => {
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "Only title");
    const btn = await screen.findByTestId("create-task-submit");
    expect(btn).toBeDisabled();
  });

  it("creates a task with steps and calls onCreated", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCreated, onClose });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "Fix bug");
    await fillFirstStep(user, "Reproduce");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(taskFixture.list).toHaveLength(1);
    expect(taskFixture.list[0].Title).toBe("Fix bug");
    expect(taskFixture.list[0].ChecklistItems).toEqual(["Reproduce"]);
  });

  it("Cancel closes without creating", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(taskFixture.list).toHaveLength(0);
  });

  it("creates with default priority medium", async () => {
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "Default");
    await fillFirstStep(user, "Step");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(taskFixture.list[0].Priority).toBe("medium");
    });
  });

  it("renders due date field", async () => {
    renderModal();
    expect(
      await screen.findByLabelText(/due date/i),
    ).toBeInTheDocument();
  });

  it("passes columnId from prop into save payload", async () => {
    renderModal({ columnId: 5, columnTitle: "Sprint" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "S1");
    await fillFirstStep(user, "first");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(taskFixture.list[0].ColumnId).toBe(5);
    });
  });

  it("adds and removes extra steps", async () => {
    renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("create-task-add-step"));
    expect(screen.getByTestId("create-task-step-1")).toBeInTheDocument();
  });

  it("submits every picked assignee as AssigneeIds", async () => {
    workspaceFixture.members = [member(7, "Carol"), member(8, "Dave")];
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/title/i), "Pair up");
    await fillFirstStep(user, "Kick off");
    await pickAssignee(user, "Carol");
    await pickAssignee(user, "Dave");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(taskFixture.list).toHaveLength(1);
    });
    expect(taskFixture.list[0].AssigneeIds).toEqual([7, 8]);
    expect(taskFixture.list[0].AssignedToUserId).toBeNull();
  });

  it("offers workspace members, not every company user", async () => {
    workspaceFixture.members = [
      member(7, "Carol"),
      member(8, "Dave"),
      { ...member(9, "Pending Pete"), InviteStatus: "pending" },
    ];
    renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("create-task-assignees-input"));
    expect(await screen.findByRole("option", { name: "Carol" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Dave" })).toBeInTheDocument();
    // Alice/Bob come from /api/users/fetchUsers — the picker must not use it.
    expect(screen.queryByRole("option", { name: "Alice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Pending Pete" })).not.toBeInTheDocument();
  });

  it("personal workspace hides the picker and assigns the owner", async () => {
    useWorkspaceStore.setState({ activeWorkspaceType: "personal" });
    renderModal();
    const user = userEvent.setup();
    expect(screen.queryByTestId("create-task-assignees")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/title/i), "Mine alone");
    await fillFirstStep(user, "Just do it");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(taskFixture.list).toHaveLength(1);
    });
    expect(taskFixture.list[0].AssigneeIds).toEqual([1]);
  });
});
