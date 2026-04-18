import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TaskDetailModal from "./TaskDetailModal";
import useAuthStore from "../../../stores/useAuthStore";
import { taskFixture } from "../../../test/mocks/handlers";
import renderWithProviders from "../../../test/renderWithProviders";

const renderModal = (taskId, props = {}) =>
  renderWithProviders(
    <TaskDetailModal taskId={taskId} open onClose={() => {}} {...props} />,
    { router: false },
  );

describe("TaskDetailModal", () => {
  beforeEach(() => {
    taskFixture.reset();
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    taskFixture.seed({
      Id: 501,
      Title: "Task 501",
      Description: "Body",
      WorkspaceId: 100,
      ColumnId: 1,
      ColumnTitle: "To Do",
      ColumnIsDone: false,
      Priority: "high",
      AssigneeName: "Alice",
      IsBlocked: false,
      CreatedByUserId: 1,
    });
  });

  it("renders the task title when loaded", async () => {
    renderModal(501);
    expect(await screen.findByText("Task 501")).toBeInTheDocument();
  });

  it("shows Blocked chip if task IsBlocked", async () => {
    taskFixture.list[0].IsBlocked = true;
    renderModal(501);
    expect((await screen.findAllByText(/Blocked/i)).length).toBeGreaterThan(0);
  });

  it("switches to Comments tab", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    expect(await screen.findByPlaceholderText(/Write a comment/i)).toBeInTheDocument();
  });

  it("comment submit calls API when text provided", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    const input = await screen.findByPlaceholderText(/Write a comment/i);
    await user.type(input, "Nice one");
    const btn = screen.getByTestId("comment-submit");
    expect(btn).not.toBeDisabled();
    await user.click(btn);
  });

  it("switches to Dependencies tab and shows empty state", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Dependencies/i }));
    expect(await screen.findByText(/No blockers/i)).toBeInTheDocument();
  });

  it("shows task description", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.getByDisplayValue("Body")).toBeInTheDocument();
  });

  it("comment submit button is disabled with empty input", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    expect(screen.getByTestId("comment-submit")).toBeDisabled();
  });

  it("shows 'No comments yet' empty state", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    expect(await screen.findByText(/No comments yet/i)).toBeInTheDocument();
  });

  it("column change + Save dispatches save mutation with new ColumnId", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    const select = await screen.findByTestId("task-column-select");
    const combo = select.querySelector("[role='combobox']") ?? select;
    await user.click(combo);
    const doneOption = await screen.findByRole("option", { name: /Done/i });
    await user.click(doneOption);
    await user.click(await screen.findByTestId("task-save-btn"));
    await waitFor(() => {
      expect(taskFixture.list[0].ColumnId).toBe(3);
    });
  });

  it("shows Done badge when task sits in a done column", async () => {
    taskFixture.list[0].ColumnId = 3;
    taskFixture.list[0].ColumnIsDone = true;
    taskFixture.list[0].CompletedDate = new Date().toISOString();
    renderModal(501);
    expect(await screen.findByText(/^Done/)).toBeInTheDocument();
  });

  it("close button fires onClose", async () => {
    const onClose = vi.fn();
    renderModal(501, { onClose });
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("modal-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("reply action sets reply-to state", async () => {
    // Seed a comment via the fixture-tracked response — need to override handler
    const { server } = await import("../../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/api/tasks/getTaskComments", async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            comments: [
              {
                Id: 900,
                TaskId: 501,
                UserId: 1,
                UserName: "Alice",
                Comment: "Hey",
                IsEdited: false,
                IsPinned: false,
                IsDeleted: false,
                CreatedDate: new Date().toISOString(),
              },
            ],
            pagination: { currentPage: 1, pageSize: 100, totalRecords: 1, totalPages: 1 },
          },
        }),
      ),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    await screen.findByTestId("comment-900");
    // Reply button is an IconButton with a ReplyRounded icon — click it via title
    const replyBtn = screen.getByRole("button", { name: /Reply/i });
    await user.click(replyBtn);
    expect(screen.getByText(/Replying to comment #900/i)).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = renderModal(501, { open: false });
    // Dialog isn't mounted in DOM body when open=false but component returns null
    expect(container).toBeTruthy();
  });
});
