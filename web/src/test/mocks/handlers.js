import { http, HttpResponse } from "msw";

const API = "https://prdinfotech.in/CRM";

// In-memory state for workspace endpoints so tests can observe
// create → fetch round-trips.
let workspaceSeq = 100;
export const workspaceFixture = {
  list: [],
  reset() {
    this.list = [];
    workspaceSeq = 100;
  },
  seed(ws) {
    this.list.push(ws);
  },
};

let taskSeq = 500;
export const taskFixture = {
  list: [],
  columns: [
    { Id: 1, Title: "To Do", Color: "#94A3B8", SortOrder: 1, WorkspaceId: 100, IsDone: false },
    { Id: 2, Title: "In Progress", Color: "#3B82F6", SortOrder: 2, WorkspaceId: 100, IsDone: false },
    { Id: 3, Title: "Done", Color: "#10B981", SortOrder: 3, WorkspaceId: 100, IsDone: true },
  ],
  reset() {
    this.list = [];
    taskSeq = 500;
  },
  seed(t) {
    this.list.push(t);
  },
};

let notifSeq = 900;
export const notificationFixture = {
  list: [],
  reset() {
    this.list = [];
    notifSeq = 900;
  },
  seed(n) {
    this.list.push({ Id: ++notifSeq, IsRead: false, CreatedDate: new Date().toISOString(), ...n });
  },
};

export const handlers = [
  http.post(`*/api/projects/fetchProjects`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: {
        projects: [],
        pagination: { currentPage: 1, pageSize: 100, totalRecords: 0, totalPages: 1 },
      },
    }),
  ),

  http.post(`*/api/workspaces/respondInvite`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      success: true,
      message: body?.Action === "accept" ? "Invite accepted" : "Invite declined",
      responseCode: 200,
      data: {
        workspaceId: body?.WorkspaceId,
        inviteStatus: body?.Action === "accept" ? "active" : "declined",
      },
    });
  }),

  http.post(`*/api/workspaces/fetchWorkspaces`, async () => {
    const rows = workspaceFixture.list;
    return HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: {
        workspaces: rows,
        pagination: {
          currentPage: 1,
          pageSize: 100,
          totalRecords: rows.length,
          totalPages: 1,
        },
      },
    });
  }),

  http.post(`*/api/workspaces/saveWorkspace`, async ({ request }) => {
    const body = await request.json();
    if (!body?.Name || !body?.Name.trim()) {
      return HttpResponse.json({
        success: false,
        message: "Workspace name is required",
        responseCode: 400,
      });
    }
    const id = ++workspaceSeq;
    workspaceFixture.list.push({
      Id: id,
      Name: body.Name,
      Type: body.Type,
      OwnerUserId: 1,
      MyRole: "owner",
      MemberCount: 1,
    });
    return HttpResponse.json({
      success: true,
      message: "Workspace created",
      responseCode: 201,
      data: { workspaceId: id },
    });
  }),

  http.post(`*/api/workspaces/applyKanbanTemplate`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      success: true,
      message: "Template applied",
      responseCode: 201,
      data: {
        workspaceId: body.WorkspaceId,
        templateKey: body.TemplateKey,
        columnsCreated: 3,
      },
    });
  }),

  http.post(`*/api/workspaces/ensurePersonalWorkspace`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 201,
      data: { workspaceId: 100, seeded: true },
    }),
  ),

  http.post(`*/api/kanban/fetchKanbanColumns`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: {
        kanbanColumns: taskFixture.columns,
        columns: taskFixture.columns,
        pagination: { currentPage: 1, pageSize: 100, totalRecords: 3, totalPages: 1 },
      },
    }),
  ),

  http.post(`*/api/kanban/saveKanbanColumn`, async ({ request }) => {
    const body = await request.json();
    const id = body?.Id || Math.max(0, ...taskFixture.columns.map((c) => c.Id)) + 1;
    const existing = taskFixture.columns.find((c) => c.Id === id);
    if (existing) {
      Object.assign(existing, body);
    } else {
      taskFixture.columns.push({ Id: id, ...body });
    }
    return HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: body?.Id ? 200 : 201,
      data: { columnId: id },
    });
  }),

  http.post(`*/api/kanban/deleteKanbanColumn`, async ({ request }) => {
    const body = await request.json();
    taskFixture.columns = taskFixture.columns.filter((c) => c.Id !== body?.Id);
    return HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: { tasksMoved: 0, reassignedTo: body?.ReassignToColumnId ?? null },
    });
  }),

  http.post(`*/api/tasks/fetchTasks`, async ({ request }) => {
    const body = await request.json();
    const filtered =
      body?.Id > 0
        ? taskFixture.list.filter((t) => t.Id === body.Id)
        : taskFixture.list;
    return HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: {
        tasks: filtered,
        pagination: {
          currentPage: 1,
          pageSize: 200,
          totalRecords: filtered.length,
          totalPages: 1,
        },
      },
    });
  }),

  http.post(`*/api/tasks/saveTask`, async ({ request }) => {
    const body = await request.json();
    if (!body?.Title) {
      return HttpResponse.json({
        success: false,
        message: "Task title is required",
        responseCode: 400,
      });
    }
    if (body.Id === 0 || !body.Id) {
      const checklistItems = Array.isArray(body.ChecklistItems)
        ? body.ChecklistItems
            .map((s) => (typeof s === "string" ? s.trim() : ""))
            .filter(Boolean)
        : [];
      if (checklistItems.length === 0) {
        return HttpResponse.json({
          success: false,
          message: "At least one checklist item is required",
          responseCode: 400,
        });
      }
      const id = ++taskSeq;
      const newTask = {
        Id: id,
        Title: body.Title,
        Description: body.Description ?? "",
        WorkspaceId: body.WorkspaceId,
        ColumnId: body.ColumnId ?? null,
        Priority: body.Priority ?? "medium",
        AssignedToUserId: body.AssignedToUserId ?? null,
        DueDate: body.DueDate ?? null,
        IsBlocked: false,
        IsCompleted: 0,
        ChecklistTotal: checklistItems.length,
        ChecklistDone: 0,
        ChecklistItems: checklistItems,
        CreatedByUserId: 1,
      };
      taskFixture.list.push(newTask);
      return HttpResponse.json({
        success: true,
        message: "Task created",
        responseCode: 201,
        data: { taskId: id },
      });
    }
    const idx = taskFixture.list.findIndex((t) => t.Id === body.Id);
    if (idx !== -1) {
      taskFixture.list[idx] = { ...taskFixture.list[idx], ...body };
    }
    return HttpResponse.json({
      success: true,
      message: "Task updated",
      responseCode: 200,
      data: { taskId: body.Id },
    });
  }),

  http.post(`*/api/tasks/bulkDeleteTasks`, async ({ request }) => {
    const body = await request.json();
    const ids = Array.isArray(body?.TaskIds)
      ? body.TaskIds
      : String(body?.TaskIds ?? "").split(",").map(Number).filter(Boolean);
    const blocked = taskFixture.list.find(
      (t) => ids.includes(t.Id) && (t.ChecklistItems?.length ?? 0) > 0,
    );
    if (blocked) {
      return HttpResponse.json({
        success: false,
        message: "Clear checklist items before deleting this task",
        responseCode: 409,
      });
    }
    const before = taskFixture.list.length;
    taskFixture.list = taskFixture.list.filter((t) => !ids.includes(t.Id));
    return HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: { deletedCount: before - taskFixture.list.length, failedCount: 0 },
    });
  }),

  http.post(`*/api/tasks/deleteTask`, async ({ request }) => {
    const body = await request.json();
    const id = body?.Id;
    const target = taskFixture.list.find((t) => t.Id === id);
    if (target && (target.ChecklistItems?.length ?? 0) > 0) {
      return HttpResponse.json({
        success: false,
        message: "Clear checklist items before deleting this task",
        responseCode: 409,
      });
    }
    const before = taskFixture.list.length;
    taskFixture.list = taskFixture.list.filter((t) => t.Id !== id);
    return HttpResponse.json({
      success: before > taskFixture.list.length,
      message: before > taskFixture.list.length ? "Task deleted" : "Task not found",
      responseCode: before > taskFixture.list.length ? 200 : 404,
    });
  }),

  http.post(`*/api/tasks/getTaskComments`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: {
        comments: [],
        pagination: { currentPage: 1, pageSize: 100, totalRecords: 0, totalPages: 0 },
      },
    }),
  ),

  http.post(`*/api/tasks/addTaskComment`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 201,
      data: { commentId: 1 },
    }),
  ),

  http.post(`*/api/tasks/deleteTaskComment`, async () =>
    HttpResponse.json({ success: true, message: "ok", responseCode: 200 }),
  ),

  http.post(`*/api/tasks/pinTaskComment`, async () =>
    HttpResponse.json({ success: true, message: "ok", responseCode: 200 }),
  ),

  http.post(`*/api/tasks/fetchTaskDependencies`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: { blockers: [], dependents: [] },
    }),
  ),

  http.post(`*/api/tasks/addTaskDependency`, async () =>
    HttpResponse.json({ success: true, message: "ok", responseCode: 201 }),
  ),

  http.post(`*/api/tasks/removeTaskDependency`, async () =>
    HttpResponse.json({ success: true, message: "ok", responseCode: 200 }),
  ),

  http.post(`*/api/tasks/getTaskChecklist`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: { checklist: [], items: [] },
    }),
  ),

  http.post(`*/api/tasks/saveTaskChecklist`, async () =>
    HttpResponse.json({ success: true, message: "ok", responseCode: 201 }),
  ),

  http.post(`*/api/tasks/deleteTaskChecklist`, async () =>
    HttpResponse.json({ success: true, message: "ok", responseCode: 200 }),
  ),

  http.post(`*/api/tasks/getTaskTimeEntries`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: { timeEntries: [], entries: [] },
    }),
  ),

  http.post(`*/api/tasks/logTaskTime`, async () =>
    HttpResponse.json({ success: true, message: "ok", responseCode: 201 }),
  ),

  http.post(`*/api/tasks/deleteTaskTimeEntry`, async () =>
    HttpResponse.json({ success: true, message: "ok", responseCode: 200 }),
  ),

  http.post(`*/api/users/fetchUsers`, async () =>
    HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: {
        users: [
          { Id: 1, Username: "alice", FullName: "Alice" },
          { Id: 2, Username: "bob", FullName: "Bob" },
        ],
        pagination: { currentPage: 1, pageSize: 200, totalRecords: 2, totalPages: 1 },
      },
    }),
  ),

  http.post(`*/api/notifications/fetchNotifications`, async () => {
    const rows = notificationFixture.list;
    return HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: {
        notifications: rows,
        unreadCount: rows.filter((n) => !n.IsRead).length,
        pagination: {
          currentPage: 1,
          pageSize: 20,
          totalRecords: rows.length,
          totalPages: 1,
        },
      },
    });
  }),

  http.post(`*/api/notifications/markNotificationRead`, async ({ request }) => {
    const body = await request.json();
    const n = notificationFixture.list.find((x) => x.Id === body.Id);
    if (n) {
      n.IsRead = true;
      n.ReadAt = new Date().toISOString();
    }
    return HttpResponse.json({ success: true, message: "ok", responseCode: 200 });
  }),

  http.post(`*/api/notifications/markAllNotificationsRead`, async () => {
    notificationFixture.list.forEach((n) => (n.IsRead = true));
    return HttpResponse.json({
      success: true,
      message: "ok",
      responseCode: 200,
      data: { updatedCount: notificationFixture.list.length },
    });
  }),

  http.post(`${API}/api/auth/loginUser`, async ({ request }) => {
    const body = await request.json();
    if (body?.username === "test" && body?.password === "test") {
      return HttpResponse.json({
        success: true,
        message: "Login successful",
        responseCode: 200,
        data: {
          token: "mock-jwt-token",
          user: { Id: 1, Username: "test", FullName: "Test User", IsAdmin: false },
          company: { CompId: 1, BranchId: 1 },
          permissions: { menuItems: [] },
        },
      });
    }
    return HttpResponse.json(
      { success: false, message: "Invalid credentials", responseCode: 401 },
      { status: 401 }
    );
  }),
];
