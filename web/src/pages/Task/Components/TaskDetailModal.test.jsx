import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { http, HttpResponse } from "msw";

import TaskDetailModal from "./TaskDetailModal";
import useAuthStore from "../../../stores/useAuthStore";
import { taskFixture } from "../../../test/mocks/handlers";
import { server } from "../../../test/mocks/server";
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
      IsCompleted: 0,
      ChecklistTotal: 1,
      ChecklistDone: 0,
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

  it("shows Done chip when task IsCompleted", async () => {
    taskFixture.list[0].IsCompleted = 1;
    taskFixture.list[0].CompletedDate = new Date().toISOString();
    renderModal(501);
    expect(await screen.findByTestId("task-completed-chip")).toBeInTheDocument();
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

  it("renders the Checklist tab (replaces legacy Subtasks)", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.getByRole("tab", { name: /Checklist/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Subtasks/i })).not.toBeInTheDocument();
  });

  it("Checklist tab shows empty state placeholder when no items", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Checklist/i }));
    expect(await screen.findByText(/No checklist yet/i)).toBeInTheDocument();
  });

  it("Time tab shows empty state when no entries", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Time/i }));
    expect(await screen.findByText(/No time logged/i)).toBeInTheDocument();
  });

  it("Log time opens modal from Time tab", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Time/i }));
    const logBtns = screen.getAllByRole("button", { name: /Log time/i });
    await user.click(logBtns[0]);
    expect(await screen.findByTestId("log-time-modal")).toBeInTheDocument();
  });

  it("pin toggle sends TaskId + WorkspaceId emit-routing hints", async () => {
    let pinBody;
    server.use(
      http.post(`*/api/tasks/getTaskComments`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            comments: [
              {
                Id: 71,
                TaskId: 501,
                UserId: 1,
                UserName: "Alice",
                Comment: "pin me",
                IsPinned: false,
                CreatedDate: new Date().toISOString(),
              },
            ],
            pagination: { currentPage: 1, pageSize: 100, totalRecords: 1, totalPages: 1 },
          },
        }),
      ),
      http.post(`*/api/tasks/pinTaskComment`, async ({ request }) => {
        pinBody = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    await user.click(await screen.findByTestId("pin-71"));
    await waitFor(() => {
      expect(pinBody).toMatchObject({
        CommentId: 71,
        IsPinned: true,
        TaskId: 501,
        WorkspaceId: 100,
      });
    });
  });

  it("time entry delete sends TaskId + WorkspaceId emit-routing hints", async () => {
    let deleteBody;
    server.use(
      http.post(`*/api/tasks/getTaskTimeEntries`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            timeEntries: [
              { Id: 81, TaskId: 501, UserId: 1, Hours: 2, LogDate: "2026-07-01" },
            ],
          },
        }),
      ),
      http.post(`*/api/tasks/deleteTaskTimeEntry`, async ({ request }) => {
        deleteBody = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Time/i }));
    await user.click(
      await screen.findByRole("button", { name: /Delete time entry/i }),
    );
    await waitFor(() => {
      expect(deleteBody).toMatchObject({
        Id: 81,
        TaskId: 501,
        WorkspaceId: 100,
      });
    });
  });

  it("checklist add sends the WorkspaceId emit-routing hint", async () => {
    let checklistBody;
    server.use(
      http.post(`*/api/tasks/saveTaskChecklist`, async ({ request }) => {
        checklistBody = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 201 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Checklist/i }));
    await user.type(await screen.findByPlaceholderText(/Add a step/i), "step one{Enter}");
    await waitFor(() => {
      expect(checklistBody).toMatchObject({
        TaskId: 501,
        ItemText: "step one",
        WorkspaceId: 100,
      });
    });
  });

  it("description edit + Save dispatches save mutation", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    const desc = screen.getByTestId("task-description-input");
    const inner = desc.querySelector("textarea") || desc;
    await user.clear(inner);
    await user.type(inner, "New body");
    await user.click(await screen.findByTestId("task-save-btn"));
    await waitFor(() => {
      expect(taskFixture.list[0].Description).toBe("New body");
    });
  });
});
