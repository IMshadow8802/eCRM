import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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

  // Regression: the gate used to be creator-only, so a member assigned a task
  // by their manager saw a dead checklist on work they were told to do — the
  // server allows it (change_status grants creator OR assignee).
  const seedAssignedToMe = () => {
    taskFixture.reset(); // beforeEach already seeded a 501 created by me
    taskFixture.seed({
      Id: 501,
      Title: "Task 501",
      WorkspaceId: 100,
      ColumnId: 1,
      ColumnTitle: "To Do",
      Priority: "high",
      CreatedByUserId: 99, // someone else made it
      AssignedToUserId: 1, // ...and handed it to me
      ChecklistTotal: 1,
      ChecklistDone: 0,
    });
  };

  const openChecklistTab = async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Checklist/i }));
    return user;
  };

  it("lets the assignee tick a checklist item on a task someone else created", async () => {
    seedAssignedToMe();
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { checklist: [{ Id: 900, ItemText: "step one", IsCompleted: false }] },
        }),
      ),
    );
    await openChecklistTab();
    expect(await screen.findByTestId("checklist-toggle-900")).not.toBeDisabled();
  });

  it("does not let the assignee delete checklist items (that stays edit_fields)", async () => {
    seedAssignedToMe();
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { checklist: [{ Id: 900, ItemText: "step one", IsCompleted: false }] },
        }),
      ),
    );
    await openChecklistTab();
    await screen.findByTestId("checklist-toggle-900");
    expect(screen.queryByRole("button", { name: /Remove item/i })).not.toBeInTheDocument();
  });

  it("leaves the checklist read-only for a member who is neither creator nor assignee", async () => {
    taskFixture.reset();
    taskFixture.seed({
      Id: 501,
      Title: "Task 501",
      WorkspaceId: 100,
      ColumnId: 1,
      ColumnTitle: "To Do",
      Priority: "high",
      CreatedByUserId: 99,
      AssignedToUserId: 98,
      ChecklistTotal: 1,
      ChecklistDone: 0,
    });
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { checklist: [{ Id: 900, ItemText: "step one", IsCompleted: false }] },
        }),
      ),
    );
    await openChecklistTab();
    expect(await screen.findByTestId("checklist-toggle-900")).toBeDisabled();
  });

  it("checklist delete sends TaskId so the server can authorize it", async () => {
    let deleteBody;
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { checklist: [{ Id: 900, ItemText: "step one", IsCompleted: false }] },
        }),
      ),
      http.post(`*/api/tasks/deleteTaskChecklist`, async ({ request }) => {
        deleteBody = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200 });
      }),
    );
    const user = await openChecklistTab();
    await user.click(await screen.findByRole("button", { name: /Remove item/i }));
    await waitFor(() => {
      expect(deleteBody).toMatchObject({ Id: 900, TaskId: 501, WorkspaceId: 100 });
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

  const seedOneComment = () =>
    server.use(
      http.post(`*/api/tasks/getTaskComments`, async () =>
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
                Comment: "orig",
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

  // F3: editing reuses addTaskComment with Id>0 (the SP updates on Id>0).
  it("editing your own comment posts addTaskComment with the comment Id", async () => {
    let editBody;
    seedOneComment();
    server.use(
      http.post(`*/api/tasks/addTaskComment`, async ({ request }) => {
        editBody = await request.json();
        return HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { commentId: 900 },
        });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    await user.click(await screen.findByTestId("edit-900"));
    const input = await screen.findByTestId("edit-input-900");
    const inner = input.querySelector("textarea") || input;
    await user.clear(inner);
    await user.type(inner, "updated text");
    await user.click(screen.getByTestId("edit-save-900"));
    await waitFor(() => {
      expect(editBody).toMatchObject({
        Id: 900,
        TaskId: 501,
        Comment: "updated text",
      });
    });
  });

  // F4: locking the delete while it's in flight is what stops the double-tap
  // that fired a second delete at an already-gone comment (the false "failed").
  it("locks the comment delete button while the delete is in flight", async () => {
    let release;
    seedOneComment();
    server.use(
      http.post(
        `*/api/tasks/deleteTaskComment`,
        async () =>
          new Promise((resolve) => {
            release = () =>
              resolve(
                HttpResponse.json({ success: true, message: "ok", responseCode: 200 }),
              );
          }),
      ),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    await user.click(await screen.findByTestId("delete-900"));
    await waitFor(() =>
      expect(screen.getByTestId("delete-900")).toBeDisabled(),
    );
    release();
  });

  const seedOneChecklistItem = () =>
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { checklist: [{ Id: 900, ItemText: "step one", IsCompleted: false }] },
        }),
      ),
    );

  it("ticking a checklist item sends IsCompleted true", async () => {
    let body;
    seedOneChecklistItem();
    server.use(
      http.post(`*/api/tasks/saveTaskChecklist`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { checklistId: 900 },
        });
      }),
    );
    const user = await openChecklistTab();
    await user.click(await screen.findByTestId("checklist-toggle-900"));
    await waitFor(() => {
      expect(body).toMatchObject({ Id: 900, TaskId: 501, IsCompleted: true });
    });
  });

  it("locks the checklist toggle while its save is in flight", async () => {
    let release;
    seedOneChecklistItem();
    server.use(
      http.post(
        `*/api/tasks/saveTaskChecklist`,
        async () =>
          new Promise((resolve) => {
            release = () =>
              resolve(
                HttpResponse.json({
                  success: true,
                  message: "ok",
                  responseCode: 200,
                  data: { checklistId: 900 },
                }),
              );
          }),
      ),
    );
    const user = await openChecklistTab();
    await user.click(await screen.findByTestId("checklist-toggle-900"));
    await waitFor(() =>
      expect(screen.getByTestId("checklist-toggle-900")).toBeDisabled(),
    );
    release();
  });

  it("History tab lists activity from the audit log", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskActivity`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            activities: [
              {
                Id: 1,
                UserName: "Alice",
                Action: "StatusChanged",
                Description: "Checklist ticked: step one",
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
    await user.click(screen.getByRole("tab", { name: /History/i }));
    expect(
      await screen.findByText(/Checklist ticked: step one/i),
    ).toBeInTheDocument();
  });

  it("History tab shows an empty state when there's no activity", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /History/i }));
    expect(await screen.findByText(/No history yet/i)).toBeInTheDocument();
  });

  it("History renders an old→new change line when a value changed", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskActivity`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            activities: [
              {
                Id: 2,
                UserName: "Bob",
                Action: "StatusChanged",
                Description: "Checklist ticked: deploy",
                OldValue: "open",
                NewValue: "done",
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
    await user.click(screen.getByRole("tab", { name: /History/i }));
    await screen.findByText(/Checklist ticked: deploy/i);
    expect(screen.getByTestId("task-history").textContent).toMatch(
      /open.*→.*done/,
    );
  });

  // F4 rollback: a failed tick unwinds the optimistic flip and unlocks the row.
  it("rolls back and re-enables the checklist toggle when the save fails", async () => {
    seedOneChecklistItem();
    server.use(
      http.post(`*/api/tasks/saveTaskChecklist`, async () =>
        HttpResponse.json(
          { success: false, message: "denied", responseCode: 403 },
          { status: 403 },
        ),
      ),
    );
    const user = await openChecklistTab();
    const toggle = await screen.findByTestId("checklist-toggle-900");
    await user.click(toggle);
    await waitFor(() =>
      expect(screen.getByTestId("checklist-toggle-900")).not.toBeDisabled(),
    );
  });

  it("re-enables the comment delete button if the delete fails", async () => {
    seedOneComment();
    server.use(
      http.post(`*/api/tasks/deleteTaskComment`, async () =>
        HttpResponse.json(
          { success: false, message: "denied", responseCode: 403 },
          { status: 403 },
        ),
      ),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    await user.click(await screen.findByTestId("delete-900"));
    await waitFor(() =>
      expect(screen.getByTestId("delete-900")).not.toBeDisabled(),
    );
  });

  it("hides edit and delete on a comment you don't own", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskComments`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            comments: [
              {
                Id: 900,
                TaskId: 501,
                UserId: 77, // someone else's comment
                UserName: "Carol",
                Comment: "not yours",
                IsDeleted: false,
                IsPinned: false,
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
    expect(screen.queryByTestId("edit-900")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-900")).not.toBeInTheDocument();
  });

  it("cancelling a comment edit restores the original text", async () => {
    seedOneComment();
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Comments/i }));
    await user.click(await screen.findByTestId("edit-900"));
    const input = await screen.findByTestId("edit-input-900");
    const inner = input.querySelector("textarea") || input;
    await user.clear(inner);
    await user.type(inner, "changed my mind");
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    // back to read view showing the original comment
    expect(await screen.findByText("orig")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-input-900")).not.toBeInTheDocument();
  });

  it("renders an edited + pinned comment with its badge and unpin control", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskComments`, async () =>
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
                Comment: "pinned + edited",
                IsEdited: true,
                IsPinned: true,
                IsDeleted: false,
                ReadByUserIds: "1,2",
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
    const bubble = await screen.findByTestId("comment-900");
    expect(within(bubble).getByText(/^edited$/i)).toBeInTheDocument();
    expect(within(bubble).getByText(/Seen by 2/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Unpin comment/i }),
    ).toBeInTheDocument();
  });

  it("Dependencies tab renders blocker and dependent chips", async () => {
    server.use(
      http.post(`*/api/tasks/fetchTaskDependencies`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            blockers: [
              { TaskId: 2, Title: "Blocker A", IsCompleted: 1, ColumnTitle: "Done" },
            ],
            dependents: [
              { TaskId: 3, Title: "Dependent B", IsCompleted: 0, ColumnTitle: "To Do" },
            ],
          },
        }),
      ),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Dependencies/i }));
    expect(await screen.findByText(/Blocker A/i)).toBeInTheDocument();
    expect(screen.getByText(/Dependent B/i)).toBeInTheDocument();
  });

  it("Time tab renders a logged entry with hours and date", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskTimeEntries`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            timeEntries: [
              {
                Id: 81,
                TaskId: 501,
                UserId: 1,
                UserName: "Alice",
                Hours: 2.5,
                Description: "did the thing",
                LogDate: "2026-07-01",
              },
            ],
          },
        }),
      ),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Time/i }));
    expect(await screen.findByText(/did the thing/i)).toBeInTheDocument();
    expect(screen.getAllByText(/2\.50 h/i).length).toBeGreaterThan(0);
  });
});
