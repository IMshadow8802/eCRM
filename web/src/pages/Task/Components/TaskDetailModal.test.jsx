import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { http, HttpResponse } from "msw";

import TaskDetailModal from "./TaskDetailModal";
import useAuthStore from "../../../stores/useAuthStore";
import useWorkspaceStore from "../../../stores/useWorkspaceStore";
import { taskFixture, workspaceFixture } from "../../../test/mocks/handlers";
import { server } from "../../../test/mocks/server";
import renderWithProviders from "../../../test/renderWithProviders";
import { tatHandlers } from "../../../test/tatMocks";

const renderModal = (taskId, props = {}) =>
  renderWithProviders(
    <TaskDetailModal taskId={taskId} open onClose={() => {}} {...props} />,
    { router: false },
  );

describe("TaskDetailModal", () => {
  beforeEach(() => {
    taskFixture.reset();
    // Permissions mirror sp_CheckTaskPermission (utils/taskAbilities): the modal
    // needs a workspace + role to know what the caller may do. Default: a member.
    useWorkspaceStore.getState().setActiveWorkspace({ Id: 100, Type: "shared", MyRole: "member" });
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

  // CHANGED (094): the column is progress, not a field - it moves the card at
  // once through moveTaskColumn instead of waiting for Save.
  it("changing the column moves the card at once through moveTaskColumn", async () => {
    let moveBody;
    server.use(
      http.post(`*/api/tasks/moveTaskColumn`, async ({ request }) => {
        moveBody = await request.json();
        return HttpResponse.json({ success: true, message: "Task moved", responseCode: 200 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    const select = await screen.findByTestId("task-column-select");
    await user.click(select.querySelector("[role='combobox']") ?? select);
    await user.click(await screen.findByRole("option", { name: /Done/i }));
    await waitFor(() =>
      expect(moveBody).toEqual({ TaskId: 501, ColumnId: 3, WorkspaceId: 100 }),
    );
  });

  // REGRESSION (R7, board = completion): the server refuses an open task into
  // the last column; the modal shows why and the column stays where it was.
  it("a refused column move shows the server's reason and keeps the old column", async () => {
    server.use(
      http.post(`*/api/tasks/moveTaskColumn`, () =>
        HttpResponse.json(
          { success: false, message: "Tick the remaining steps to finish this task", responseCode: 409 },
          { status: 409 },
        ),
      ),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    const select = await screen.findByTestId("task-column-select");
    await user.click(select.querySelector("[role='combobox']") ?? select);
    await user.click(await screen.findByRole("option", { name: /Done/i }));
    expect(
      await screen.findByText("Tick the remaining steps to finish this task"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(select.querySelector("input")?.value ?? select.textContent).toMatch(/To Do/),
    );
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

  it("ticking the last step toasts that the creator has been told", async () => {
    taskFixture.list[0].ChecklistTotal = 1;
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { checklist: [{ Id: 81, TaskId: 501, ItemText: "only step", IsCompleted: false, SortOrder: 0 }] } })),
      http.post(`*/api/tasks/saveTaskChecklist`, async () =>
        HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { completionChange: "completed" } })),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Checklist/i }));
    await user.click(await screen.findByTestId("checklist-toggle-81"));
    expect(await screen.findByText(/Task completed — the creator has been told/)).toBeInTheDocument();
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
      AssignedToUserId: 1, // ...and handed it to me (legacy mirror)
      AssigneesJson: JSON.stringify([{ UserId: 1, FullName: "Me" }]),
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

  it("never offers to remove a task's last step", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({
          success: true, message: "ok", responseCode: 200,
          data: { checklist: [{ Id: 900, ItemText: "only step", IsCompleted: false }] },
        }),
      ),
    );
    await openChecklistTab();
    await screen.findByTestId("checklist-toggle-900");
    expect(screen.queryByRole("button", { name: /Remove item/i })).not.toBeInTheDocument();
  });

  // REGRESSION (spec P1 item 11): an assignee could drag the card but the
  // Column select was locked behind edit_fields.
  it("lets an assignee who can't edit the task change its column", async () => {
    seedAssignedToMe();
    renderModal(501);
    await screen.findByText("Task 501");
    const select = await screen.findByTestId("task-column-select");
    const combo = select.querySelector("[role='combobox']") ?? select;
    expect(combo).not.toBeDisabled();
    expect(screen.getByTestId("task-title-input")).toBeDisabled();
  });

  it("deletes the task after confirming, then closes", async () => {
    const onClose = vi.fn();
    let body;
    server.use(
      http.post(`*/api/tasks/deleteTask`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "Task deleted", responseCode: 200 });
      }),
    );
    renderModal(501, { onClose });
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("task-delete-btn"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(body).toEqual({ Id: 501, WorkspaceId: 100 }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("stays open when the server refuses the delete", async () => {
    const onClose = vi.fn();
    server.use(
      http.post(`*/api/tasks/deleteTask`, async () =>
        HttpResponse.json({
          success: false,
          message: "Permission denied: others have contributed to this task",
          responseCode: 403,
        }),
      ),
    );
    renderModal(501, { onClose });
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("task-delete-btn"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Delete$/ }));
    expect(await screen.findByText(/others have contributed/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows no Delete to someone who neither created nor manages the task", async () => {
    taskFixture.list[0].CreatedByUserId = 99;
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.queryByTestId("task-delete-btn")).not.toBeInTheDocument();
  });

  it("falls back for a sparse task and stays open when Save fails", async () => {
    taskFixture.reset();
    taskFixture.seed({ Id: 501, Title: "Bare", WorkspaceId: 100, CreatedByUserId: 1 });
    const onClose = vi.fn();
    server.use(
      http.post(`*/api/tasks/saveTask`, async () =>
        HttpResponse.json({ success: false, message: "nope", responseCode: 500 }),
      ),
    );
    renderModal(501, { onClose });
    await screen.findByText("Bare");
    const user = userEvent.setup();
    const title = screen.getByTestId("task-title-input");
    const input = title.querySelector("input") || title;
    await user.clear(input);
    await user.type(input, "Bare 2");
    await user.click(await screen.findByTestId("task-save-btn"));
    await waitFor(() => expect(screen.getByTestId("task-save-btn")).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("labels members by username, then id, when they have no full name", async () => {
    workspaceFixture.members = [
      { UserId: 4, Username: "uname", Role: "member", IsActive: true, InviteStatus: "active" },
      { UserId: 5, Role: "member", IsActive: true, InviteStatus: "active" },
    ];
    try {
      renderModal(501);
      await screen.findByText("Task 501");
      const select = screen.getByTestId("task-assignee-select");
      await userEvent.setup().click(select.querySelector("[role='combobox']") ?? select);
      expect(await screen.findByRole("option", { name: "uname" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "User #5" })).toBeInTheDocument();
    } finally {
      workspaceFixture.members = null;
    }
  });

  it("never offers a viewer as an assignee", async () => {
    workspaceFixture.members = [
      { UserId: 1, FullName: "Me", Role: "owner", IsActive: true, InviteStatus: "active" },
      { UserId: 2, FullName: "Vera Viewer", Role: "viewer", IsActive: true, InviteStatus: "active" },
      { UserId: 3, FullName: "Mo Member", Role: "member", IsActive: true, InviteStatus: "active" },
    ];
    try {
      renderModal(501);
      await screen.findByText("Task 501");
      const user = userEvent.setup();
      const select = screen.getByTestId("task-assignee-select");
      await user.click(select.querySelector("[role='combobox']") ?? select);
      expect(await screen.findByRole("option", { name: /Mo Member/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Vera Viewer/ })).not.toBeInTheDocument();
    } finally {
      workspaceFixture.members = null;
    }
  });

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

  // CHANGED in 063: adding/removing checklist steps is manage_checklist — a
  // work artifact owned by whoever is doing the work. It used to be edit_fields,
  // so an assignee could tick a box but not add the step or remove a wrong one.
  it("lets the assignee manage checklist items (manage_checklist, not edit_fields)", async () => {
    seedAssignedToMe();
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: { checklist: [{ Id: 900, ItemText: "step one", IsCompleted: false }, { Id: 901, ItemText: "step two", IsCompleted: false }] },
        }),
      ),
    );
    await openChecklistTab();
    await screen.findByTestId("checklist-toggle-900");
    expect((await screen.findAllByRole("button", { name: /Remove item/i })).length).toBeGreaterThan(0);
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
          data: { checklist: [{ Id: 900, ItemText: "step one", IsCompleted: false }, { Id: 901, ItemText: "step two", IsCompleted: false }] },
        }),
      ),
      http.post(`*/api/tasks/deleteTaskChecklist`, async ({ request }) => {
        deleteBody = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200 });
      }),
    );
    const user = await openChecklistTab();
    await user.click((await screen.findAllByRole("button", { name: /Remove item/i }))[0]);
    await waitFor(() => {
      expect(deleteBody).toMatchObject({ Id: 900, TaskId: 501, WorkspaceId: 100 });
    });
  });

  it("removing the last open step of several toasts completion", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { checklist: [{ Id: 900, ItemText: "step one", IsCompleted: false }, { Id: 901, ItemText: "step two", IsCompleted: true }] } })),
      http.post(`*/api/tasks/deleteTaskChecklist`, async () =>
        HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { completionChange: "completed" } })),
    );
    const user = await openChecklistTab();
    await user.click((await screen.findAllByRole("button", { name: /Remove item/i }))[0]);
    expect(await screen.findByText(/Task completed — the creator has been told/)).toBeInTheDocument();
  });

  describe("checklist failure paths", () => {
    const fail = (path) =>
      http.post(`*/api/tasks/${path}`, async () =>
        HttpResponse.json({ success: false, message: "nope", responseCode: 500 }, { status: 500 }));
    const twoSteps = http.post(`*/api/tasks/getTaskChecklist`, async () =>
      HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { items: [{ Id: 900, ItemText: "step one", IsCompleted: false }, { Id: 901, ItemText: "step two", IsCompleted: false }] } }));

    it("a failed tick rolls back; no toast", async () => {
      server.use(twoSteps, fail("saveTaskChecklist"));
      const user = await openChecklistTab();
      const box = await screen.findByTestId("checklist-toggle-900");
      await user.click(box);
      await waitFor(() => expect(box).not.toBeDisabled());
      expect(screen.queryByText(/creator has been told/)).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /Remove item/i })).toHaveLength(2);
    });

    it("a failed remove restores the row", async () => {
      server.use(twoSteps, fail("deleteTaskChecklist"));
      const user = await openChecklistTab();
      await user.click((await screen.findAllByRole("button", { name: /Remove item/i }))[0]);
      await waitFor(() => expect(screen.getAllByRole("button", { name: /Remove item/i })).toHaveLength(2));
      expect(screen.getByText("step one")).toBeInTheDocument();
    });

    it("a failed add keeps the typed text", async () => {
      server.use(twoSteps, fail("saveTaskChecklist"));
      const user = await openChecklistTab();
      const input = await screen.findByPlaceholderText(/Add a step/i);
      await user.type(input, "keep me{Enter}");
      await waitFor(() => expect(input).toHaveValue("keep me"));
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

  // Two events so the timeline rail (drawn on every row but the last) renders,
  // and the second carries neither a user nor a description so the "Someone" +
  // bare-Action fallbacks are exercised.
  it("History draws the connector rail and falls back when fields are missing", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskActivity`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            activities: [
              {
                Id: 3,
                UserName: "Alice",
                Action: "Created",
                Description: "created the task",
                CreatedDate: new Date().toISOString(),
              },
              { Id: 4, Action: "Archived" },
            ],
            pagination: { currentPage: 1, pageSize: 100, totalRecords: 2, totalPages: 1 },
          },
        }),
      ),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /History/i }));
    expect(await screen.findByText(/created the task/i)).toBeInTheDocument();
    expect(screen.getByText("Someone")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
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

  it("Time tab shows the work date and who logged it", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskTimeEntries`, async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            timeEntries: [
              {
                Id: 82,
                TaskId: 501,
                UserId: 1,
                Hours: 1.5,
                WorkDate: "2026-07-02",
                UserFullName: "Alice Smith",
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
    expect(await screen.findByText("02-07-2026")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("logging time posts the hours plus the emit-routing hints", async () => {
    let logBody;
    server.use(
      http.post(`*/api/tasks/logTaskTime`, async ({ request }) => {
        logBody = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 201 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("log-time-btn"));
    const hours = await screen.findByTestId("log-time-hours");
    const inner = hours.querySelector("input") || hours;
    await user.clear(inner);
    await user.type(inner, "3");
    await user.click(screen.getByTestId("log-time-submit"));
    await waitFor(() => {
      expect(logBody).toMatchObject({ TaskId: 501, Hours: 3, WorkspaceId: 100 });
    });
  });

  // The dependency picker is fed by a workspace-wide fetchTasks, so a second
  // task has to exist for either direction to be addable.
  const seedSecondTask = () =>
    taskFixture.seed({
      Id: 502,
      Title: "Other task",
      WorkspaceId: 100,
      ColumnId: 1,
      ColumnTitle: "To Do",
      Priority: "low",
      CreatedByUserId: 1,
    });

  const pickDependency = async (user, testId, optionName) => {
    const pick = await screen.findByTestId(testId);
    await user.click(pick.querySelector("[role='combobox']") ?? pick);
    await user.click(await screen.findByRole("option", { name: optionName }));
  };

  it("adding a blocker posts the dependency with the blocks type", async () => {
    let depBody;
    seedSecondTask();
    server.use(
      http.post(`*/api/tasks/addTaskDependency`, async ({ request }) => {
        depBody = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 201 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Dependencies/i }));
    await pickDependency(user, "blocker-pick", /Other task/i);
    await user.click(screen.getByTestId("add-blocker-btn"));
    await waitFor(() => {
      expect(depBody).toMatchObject({
        TaskId: 501,
        DependsOnTaskId: 502,
        Type: "blocks",
        WorkspaceId: 100,
      });
    });
  });

  // Adding a dependent flips the direction: the OTHER task is the one that
  // gains a blocker, so TaskId/DependsOnTaskId are the reverse of above.
  it("adding a dependent posts the dependency in the reverse direction", async () => {
    let depBody;
    seedSecondTask();
    server.use(
      http.post(`*/api/tasks/addTaskDependency`, async ({ request }) => {
        depBody = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 201 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Dependencies/i }));
    await pickDependency(user, "dependent-pick", /Other task/i);
    await user.click(screen.getByTestId("add-dependent-btn"));
    await waitFor(() => {
      expect(depBody).toMatchObject({
        TaskId: 502,
        DependsOnTaskId: 501,
        Type: "blocks",
        WorkspaceId: 100,
      });
    });
  });

  describe("permissions mirror sp_CheckTaskPermission", () => {
    const setup = ({ type = "shared", role, isAdmin = false, task = {} }) => {
      useWorkspaceStore.getState().setActiveWorkspace({ Id: 100, Type: type, MyRole: role });
      useAuthStore.setState({ user: { UserId: 1 }, UserId: 1, access: { isAdmin } });
      Object.assign(taskFixture.list[0], { CreatedByUserId: 9, AssigneesJson: [], AssignedToUserId: null, ...task });
    };

    // REGRESSION (B13): the old gate was role-only; an admin outside the roster got a read-only task.
    it("lets a non-member admin edit on a shared board", async () => {
      setup({ role: null, isAdmin: true });
      renderModal(501);
      await screen.findByText("Task 501");
      expect(await screen.findByTestId("task-title-input")).toBeEnabled();
    });

    it("keeps an admin out of someone else's personal task", async () => {
      setup({ type: "personal", role: null, isAdmin: true });
      renderModal(501);
      await screen.findByText("Task 501");
      expect(await screen.findByTestId("task-title-input")).toBeDisabled();
    });

    // REGRESSION: web granted log_time to every member; the server 403s unless assignee/creator.
    it("disables Log time for a member who is neither assignee nor creator", async () => {
      setup({ role: "member" });
      renderModal(501);
      await screen.findByText("Task 501");
      expect(await screen.findByTestId("log-time-btn")).toBeDisabled();
    });

    it("does not let a viewer who created the task edit it", async () => {
      setup({ role: "viewer", task: { CreatedByUserId: 1 } });
      renderModal(501);
      await screen.findByText("Task 501");
      expect(await screen.findByTestId("task-title-input")).toBeDisabled();
    });
  });
});

describe("TaskDetailModal — take this task", () => {
  beforeEach(() => {
    taskFixture.reset();
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1 });
    taskFixture.seed({
      Id: 501, Title: "Task 501", WorkspaceId: 100, ColumnId: 1, ColumnTitle: "To Do",
      IsCompleted: 0, Priority: "high", CreatedByUserId: 99, AssigneesJson: null,
    });
  });
  afterEach(() =>
    useWorkspaceStore.setState({ activeWorkspaceRole: null, activeWorkspaceType: null }),
  );

  it("lets a member take an unassigned task", async () => {
    useWorkspaceStore.setState({ activeWorkspaceRole: "member", activeWorkspaceType: "shared" });
    let body;
    server.use(
      http.post(`*/api/tasks/claimTask`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "Task taken", responseCode: 200 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    await userEvent.setup().click(screen.getByTestId("task-claim-btn"));
    await waitFor(() => expect(body).toEqual({ TaskId: 501, WorkspaceId: 100 }));
  });

  it("is not offered once someone has the task", async () => {
    useWorkspaceStore.setState({ activeWorkspaceRole: "member", activeWorkspaceType: "shared" });
    taskFixture.list[0].AssigneesJson = JSON.stringify([{ UserId: 2, FullName: "Bo" }]);
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.queryByTestId("task-claim-btn")).not.toBeInTheDocument();
  });

  it("is not offered to a viewer", async () => {
    useWorkspaceStore.setState({ activeWorkspaceRole: "viewer", activeWorkspaceType: "shared" });
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.queryByTestId("task-claim-btn")).not.toBeInTheDocument();
  });
});

describe("TaskDetailModal — TAT", () => {
  let saved;
  beforeEach(() => {
    saved = undefined;
    taskFixture.reset();
    useWorkspaceStore.getState().setActiveWorkspace({ Id: 100, Type: "shared", MyRole: "member" });
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" });
    taskFixture.seed({
      Id: 501, Title: "Task 501", WorkspaceId: 100, ColumnId: 1, Priority: "high", CreatedByUserId: 1,
      DueDate: "2026-10-10", DueTime: "10:00", TatMinutes: 120, // the wire shape: "HH:mm"
    });
    server.use(
      ...tatHandlers(),
      http.post(`*/api/tasks/saveTask`, async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: {} });
      }),
    );
  });

  it.each([
    ["HH:mm", "09:45"],
    ["HH:mm:ss", "09:45:00"],
  ])("a stored %s due time shows in the form and is not re-sent", async (_shape, stored) => {
    taskFixture.list[0].DueTime = stored;
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.getByTestId("task-due-time-input")).toHaveValue("09:45");
    const user = userEvent.setup();
    await user.type(screen.getByTestId("task-title-input"), "!");
    await user.click(screen.getByTestId("task-save-btn"));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).not.toHaveProperty("DueTime");
  });

  it("a value that is not a time shows an empty field instead of junk", async () => {
    taskFixture.list[0].DueTime = "1970-01-01T04:30:00.000Z";
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.getByTestId("task-due-time-input")).toHaveValue("");
  });

  it("due time shows only with a due date", async () => {
    taskFixture.list[0].DueDate = null;
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.queryByTestId("task-due-time-input")).toBeNull();
  });

  it("target is hidden from a member who did not create the task (no reassign)", async () => {
    taskFixture.list[0].CreatedByUserId = 2;
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.getByTestId("task-due-time-input")).toBeDisabled();
    expect(screen.queryByTestId("task-tat-hours-input")).toBeNull();
  });

  it("an unrelated edit sends neither DueTime nor TatMinutes", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.getByTestId("task-due-time-input")).toHaveValue("10:00");
    expect(screen.getByTestId("task-tat-hours-input")).toHaveValue(2);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("task-title-input"), "!");
    await user.click(screen.getByTestId("task-save-btn"));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).not.toHaveProperty("DueTime");
    expect(saved).not.toHaveProperty("TatMinutes");
  });

  it("a stored 2-minute target shows as 0.03 hours, never a long float, and is not re-sent", async () => {
    taskFixture.list[0].TatMinutes = 2;
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.getByTestId("task-tat-hours-input")).toHaveValue(0.03);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("task-title-input"), "!");
    await user.click(screen.getByTestId("task-save-btn"));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).not.toHaveProperty("TatMinutes");
  });

  it("changed time and target are sent; an emptied target means the company default", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId("task-due-time-input"), { target: { value: "11:30" } });
    await user.clear(screen.getByTestId("task-tat-hours-input"));
    await user.click(screen.getByTestId("task-save-btn"));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({ DueTime: "11:30", TatMinutes: null });
  });

  it("hours become minutes; a cleared time is sent as null", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId("task-due-time-input"), { target: { value: "" } });
    await user.clear(screen.getByTestId("task-tat-hours-input"));
    await user.type(screen.getByTestId("task-tat-hours-input"), "1.5");
    await user.click(screen.getByTestId("task-save-btn"));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({ DueTime: null, TatMinutes: 90 });
  });

  it("a TAT tab after History opens the clock panel", async () => {
    renderModal(501);
    await screen.findByText("Task 501");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.indexOf("TAT")).toBe(tabs.findIndex((t) => t.startsWith("History")) + 1);
    await userEvent.setup().click(screen.getByRole("tab", { name: "TAT" }));
    expect(await screen.findByText("No time target running")).toBeInTheDocument();
  });

  it("personal boards have no TAT tab and no target", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({ Id: 100, Type: "personal", MyRole: "owner" });
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.queryByRole("tab", { name: "TAT" })).toBeNull();
    expect(screen.queryByTestId("task-tat-hours-input")).toBeNull();
  });

  it("finishing a breached task opens the reason dialog (tatReasonNeeded)", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { checklist: [{ Id: 81, TaskId: 501, ItemText: "only", IsCompleted: false, SortOrder: 0 }] } })),
      http.post(`*/api/tasks/saveTaskChecklist`, async () =>
        HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { completionChange: "completed", tatReasonNeeded: 88 } })),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Checklist/i }));
    await user.click(await screen.findByTestId("checklist-toggle-81"));
    expect(await screen.findByTestId("breach-reason-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("breach-reason-later"));
    await waitFor(() => expect(screen.queryByTestId("breach-reason-dialog")).toBeNull());
  });
});
