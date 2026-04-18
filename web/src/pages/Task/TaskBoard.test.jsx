import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TaskBoard from "./TaskBoard";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import useAuthStore from "../../stores/useAuthStore";
import { taskFixture } from "../../test/mocks/handlers";
import renderWithProviders from "../../test/renderWithProviders";

const renderBoard = () => renderWithProviders(<TaskBoard />);

describe("TaskBoard", () => {
  beforeEach(() => {
    taskFixture.reset();
    useWorkspaceStore.getState().clearActiveWorkspace();
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  it("shows empty-state welcome when no workspace selected", async () => {
    const { server } = await import("../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/api/workspaces/ensurePersonalWorkspace", async () =>
        HttpResponse.json({ success: false, message: "no auto seed", responseCode: 500 }, { status: 500 }),
      ),
    );
    renderBoard();
    expect(
      await screen.findByText(/Welcome — pick or create a workspace/i),
    ).toBeInTheDocument();
  });

  it("renders columns + new task button when workspace active", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    renderBoard();
    expect(await screen.findByTestId("new-task-btn")).toBeInTheDocument();
    expect(await screen.findByText("To Do")).toBeInTheDocument();
    expect(await screen.findByText("In Progress")).toBeInTheDocument();
    expect(await screen.findByText("Done")).toBeInTheDocument();
  });

  it("shows tasks in their columns", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 601,
      Title: "Test A",
      Status: "todo",
      Priority: "medium",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    taskFixture.seed({
      Id: 602,
      Title: "Test B",
      Status: "done",
      Priority: "high",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    renderBoard();
    expect(await screen.findByText("Test A")).toBeInTheDocument();
    expect(await screen.findByText("Test B")).toBeInTheDocument();
  });

  it("opens the create modal from new-task-btn", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    renderBoard();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("new-task-btn"));
    expect(await screen.findByLabelText(/title/i)).toBeInTheDocument();
  });

  it("hides new-task-btn for viewer role", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "shared",
      MyRole: "viewer",
    });
    renderBoard();
    await waitFor(() => {
      expect(screen.queryByTestId("new-task-btn")).not.toBeInTheDocument();
    });
  });

  it("search input updates query params", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    renderBoard();
    const search = await screen.findByPlaceholderText(/Search tasks/i);
    const user = userEvent.setup();
    await user.type(search, "urgent");
    expect(search).toHaveValue("urgent");
  });

  it("quick-add from a column creates a task", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    renderBoard();
    const user = userEvent.setup();
    const btns = await screen.findAllByText(/Add task/i);
    await user.click(btns[0]);
    const input = await screen.findByPlaceholderText(/Task title/i);
    await user.type(input, "Quick one{Enter}");
    await waitFor(() => {
      expect(taskFixture.list.some((t) => t.Title === "Quick one")).toBe(true);
    });
  });

  it("bulk delete removes tasks from fixture", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 777,
      Title: "Doomed",
      Status: "todo",
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    renderBoard();
    const user = userEvent.setup();
    const checkbox = await screen.findByTestId("card-select-777");
    // Checkbox input is visually hidden; click it directly, not via pointer
    checkbox.click();
    const deleteBtn = await screen.findByTestId("bulk-delete");
    await user.click(deleteBtn);
    await waitFor(() => {
      expect(taskFixture.list.find((t) => t.Id === 777)).toBeUndefined();
    });
  });

  it("bulk delete appears after selecting a task", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 701,
      Title: "Pick me",
      Status: "todo",
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    renderBoard();
    const checkbox = await screen.findByTestId("card-select-701");
    checkbox.click();
    expect(await screen.findByTestId("bulk-delete")).toBeInTheDocument();
  });
});
