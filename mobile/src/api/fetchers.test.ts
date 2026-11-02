// Every named fetcher in src/api against its backend contract. URLs and bodies
// are written from backend/src/routes + controllers, not from the constants
// under test. Only the wire is fake (src/test/transport).
import { lastRequest, respond } from "../test/transport";
import * as attachments from "./attachmentQueries";
import * as auth from "./authQueries";
import * as calls from "./callQueries";
import { setApiBaseUrl, setAuthToken } from "./client";
import * as config from "./configQueries";
import * as customers from "./customerQueries";
import * as kanban from "./kanbanQueries";
import * as notifications from "./notificationQueries";
import * as presence from "./presenceQueries";
import * as products from "./productQueries";
import * as tasks from "./taskQueries";
import * as tat from "./tatQueries";
import * as tickets from "./ticketQueries";
import * as users from "./userQueries";
import * as workspaces from "./workspaceQueries";

const ENVELOPE = { success: true, message: "OK", data: { Id: 1 } };
const ROW = { Id: 1 };

interface Case {
  call: () => Promise<unknown>;
  url: string;
  body: unknown;
  /** postData fetchers: the `data` key the controller answers with. */
  key?: string;
}

// [fetcher, case] — the name is only the test title.
const CASES: [string, Case][] = [
  // ------------------------------------------------------------- auth / presence
  ["login", { call: () => auth.login({ identifier: "a@b.in", password: "fixture" }), url: "/api/auth/loginUser", body: { identifier: "a@b.in", password: "fixture", Device: "mobile" } }],
  ["logout", { call: auth.logout, url: "/api/auth/logoutUser", body: {} }],
  ["heartbeat", { call: presence.heartbeat, url: "/api/presence/heartbeat", body: {} }],
  ["ackNotice", { call: presence.ackNotice, url: "/api/presence/ackNotice", body: {} }],

  // ------------------------------------------------------------- reference data
  ["fetchProducts", { call: products.fetchProducts, url: "/api/products/fetchProducts", key: "products", body: { PageNumber: 1, PageSize: 200, SearchTerm: null, CategoryId: null, IsActive: true } }],
  ["fetchLookups", { call: () => config.fetchLookups({ Kind: config.LOOKUP_KIND.priority }), url: "/api/config/fetchLookups", key: "lookups", body: { Kind: "priority" } }],
  ["fetchCustomFields", { call: () => config.fetchCustomFields({ Entity: "ticket" }), url: "/api/config/fetchCustomFields", key: "customFields", body: { Entity: "ticket" } }],
  ["fetchUserDirectory", { call: users.fetchUserDirectory, url: "/api/users/directory", key: "users", body: {} }],
  ["fetchAssignableUsers default", { call: users.fetchAssignableUsers, url: "/api/users/fetchAssignableUsers", key: "users", body: { BranchId: null, Module: "leads" } }],
  ["fetchAssignableUsers complaints", { call: () => users.fetchAssignableUsers({ Module: "complaints" }), url: "/api/users/fetchAssignableUsers", key: "users", body: { BranchId: null, Module: "complaints" } }],
  ["updateMyProfile", { call: () => users.updateMyProfile({ FullName: "Asha" }), url: "/api/users/me/updateProfile", body: { FullName: "Asha", Email: null, Mobile: null, Avatar: null } }],
  ["changeMyPassword", { call: () => users.changeMyPassword({ CurrentPassword: "old-fixture", NewPassword: "new-fixture" }), url: "/api/users/me/changePassword", body: { CurrentPassword: "old-fixture", NewPassword: "new-fixture" } }],

  // ------------------------------------------------------------- notifications
  ["fetchNotifications", { call: () => notifications.fetchNotifications(), url: "/api/notifications/fetchNotifications", body: { UnreadOnly: false, PageNumber: 1, PageSize: 50, SearchTerm: null } }],
  ["fetchNotifications unread", { call: () => notifications.fetchNotifications({ UnreadOnly: true, PageNumber: 2 }), url: "/api/notifications/fetchNotifications", body: { UnreadOnly: true, PageNumber: 2, PageSize: 50, SearchTerm: null } }],
  ["markNotificationRead", { call: () => notifications.markNotificationRead(3), url: "/api/notifications/markNotificationRead", body: { Id: 3 } }],
  ["markAllNotificationsRead", { call: notifications.markAllNotificationsRead, url: "/api/notifications/markAllNotificationsRead", body: {} }],

  // ------------------------------------------------------------- attachments
  ["fetchAttachments", { call: () => attachments.fetchAttachments({ Entity: "task", EntityId: 4 }), url: "/api/attachments/fetch", key: "attachments", body: { Id: 0, Entity: "task", EntityId: 4 } }],
  ["deleteAttachment", { call: () => attachments.deleteAttachment({ Id: 8 }), url: "/api/attachments/delete", body: { Id: 8 } }],

  // ------------------------------------------------------------- calls / customers
  ["logCall", { call: () => calls.logCall({ TicketId: 5, Direction: "out" }), url: "/api/calls/logCall", body: { LeadId: null, TicketId: 5, Direction: "out", OutcomeId: null, Notes: null, Duration: null, NextFollowupDate: null, FollowupRemarks: null } }],
  ["fetchCalls", { call: () => calls.fetchCalls(), url: "/api/calls/fetchCalls", key: "calls", body: { LeadId: null, TicketId: null } }],
  ["fetchCalls ticket", { call: () => calls.fetchCalls({ TicketId: 5 }), url: "/api/calls/fetchCalls", key: "calls", body: { LeadId: null, TicketId: 5 } }],
  ["fetchCustomers", { call: () => customers.fetchCustomers(), url: "/api/customers/fetchCustomers", key: "customers", body: { PageNumber: 1, PageSize: 10, SearchTerm: null, BranchId: null, IsActive: true } }],
  ["fetchCustomers search", { call: () => customers.fetchCustomers({ SearchTerm: "98250", PageSize: 5 }), url: "/api/customers/fetchCustomers", key: "customers", body: { PageNumber: 1, PageSize: 5, SearchTerm: "98250", BranchId: null, IsActive: true } }],
  ["saveCustomer", { call: () => customers.saveCustomer({ Name: "Ravi", Mobile: "9825012345" }), url: "/api/customers/saveCustomer", body: { Id: 0, Name: "Ravi", ContactPerson: null, Mobile: "9825012345", AltMobile: null, Email: null, Address: null, City: null, State: null, Pincode: null, Remarks: null } }],

  // ------------------------------------------------------------- kanban
  ["fetchKanbanColumns", { call: () => kanban.fetchKanbanColumns({ WorkspaceId: 3 }), url: "/api/kanban/fetchKanbanColumns", key: "columns", body: { Id: 0, WorkspaceId: 3, PageNumber: 1, PageSize: 200, SearchTerm: null } }],
  ["fetchKanbanColumns default", { call: () => kanban.fetchKanbanColumns(), url: "/api/kanban/fetchKanbanColumns", key: "columns", body: { Id: 0, WorkspaceId: null, PageNumber: 1, PageSize: 200, SearchTerm: null } }],
  ["saveKanbanColumn", { call: () => kanban.saveKanbanColumn({ WorkspaceId: 3, Title: "Doing" }), url: "/api/kanban/saveKanbanColumn", body: { Id: 0, WorkspaceId: 3, Title: "Doing", Color: null, SortOrder: 0, MaxTasks: null, IsActive: true } }],
  ["deleteKanbanColumn", { call: () => kanban.deleteKanbanColumn({ Id: 2 }), url: "/api/kanban/deleteKanbanColumn", body: { Id: 2, ReassignToColumnId: null, WorkspaceId: null } }],

  // ------------------------------------------------------------- workspaces
  ["fetchWorkspaces", { call: () => workspaces.fetchWorkspaces(), url: "/api/workspaces/fetchWorkspaces", key: "workspaces", body: { Id: 0, Type: null, IncludeArchived: false, PageNumber: 1, PageSize: 50, SearchTerm: null } }],
  ["saveWorkspace", { call: () => workspaces.saveWorkspace({ Name: "Ops", Type: "shared", Members: [4] }), url: "/api/workspaces/saveWorkspace", body: { Id: 0, Name: "Ops", Type: "shared", TeamId: null, ProjectId: null, Color: null, Icon: null, TemplateKey: "basic", Members: [4] } }],
  ["fetchWorkspaceMembers", { call: () => workspaces.fetchWorkspaceMembers({ WorkspaceId: 3 }), url: "/api/workspaces/fetchWorkspaceMembers", key: "members", body: { WorkspaceId: 3 } }],
  ["addWorkspaceMember", { call: () => workspaces.addWorkspaceMember({ WorkspaceId: 3, UserId: 4 }), url: "/api/workspaces/addWorkspaceMember", body: { WorkspaceId: 3, UserId: 4, Role: "member" } }],
  ["setWorkspaceMemberRole", { call: () => workspaces.setWorkspaceMemberRole({ WorkspaceId: 3, UserId: 4, Role: "viewer" }), url: "/api/workspaces/setWorkspaceMemberRole", body: { WorkspaceId: 3, UserId: 4, Role: "viewer" } }],
  ["removeWorkspaceMember", { call: () => workspaces.removeWorkspaceMember({ WorkspaceId: 3, UserId: 4 }), url: "/api/workspaces/removeWorkspaceMember", body: { WorkspaceId: 3, UserId: 4 } }],
  ["respondInvite", { call: () => workspaces.respondInvite({ WorkspaceId: 3, Action: "accept" }), url: "/api/workspaces/respondInvite", body: { WorkspaceId: 3, Action: "accept" } }],
  ["archiveWorkspace", { call: () => workspaces.archiveWorkspace({ WorkspaceId: 3 }), url: "/api/workspaces/archiveWorkspace", body: { WorkspaceId: 3, IsArchived: true } }],
  ["deleteWorkspace", { call: () => workspaces.deleteWorkspace({ WorkspaceId: 3 }), url: "/api/workspaces/deleteWorkspace", body: { WorkspaceId: 3, DryRun: false } }],
  ["convertWorkspaceToShared", { call: () => workspaces.convertWorkspaceToShared({ WorkspaceId: 3, MemberIds: [4] }), url: "/api/workspaces/convertWorkspaceToShared", body: { WorkspaceId: 3, MemberIds: [4] } }],
  ["transferWorkspaceOwnership", { call: () => workspaces.transferWorkspaceOwnership({ WorkspaceId: 3, NewOwnerUserId: 4 }), url: "/api/workspaces/transferWorkspaceOwnership", body: { WorkspaceId: 3, NewOwnerUserId: 4 } }],
  ["syncProjectWorkspaceMembers", { call: () => workspaces.syncProjectWorkspaceMembers({ WorkspaceId: 3 }), url: "/api/workspaces/syncProjectWorkspaceMembers", body: { WorkspaceId: 3 } }],
  ["ensurePersonalWorkspace", { call: workspaces.ensurePersonalWorkspace, url: "/api/workspaces/ensurePersonalWorkspace", body: {} }],
  ["applyKanbanTemplate", { call: () => workspaces.applyKanbanTemplate({ WorkspaceId: 3 }), url: "/api/workspaces/applyKanbanTemplate", body: { WorkspaceId: 3, TemplateKey: "basic" } }],

  // ------------------------------------------------------------- tasks
  ["fetchTasks", { call: () => tasks.fetchTasks(), url: "/api/tasks/fetchTasks", body: { Id: 0, WorkspaceId: null, ProjectId: null, BranchId: null, PageNumber: 1, PageSize: 100, SearchTerm: null, AssigneeUserId: null, OnlyOpen: false, Overdue: false } }],
  ["fetchTasks my work", { call: () => tasks.fetchTasks({ AssigneeUserId: 42, OnlyOpen: true }), url: "/api/tasks/fetchTasks", body: { Id: 0, WorkspaceId: null, ProjectId: null, BranchId: null, PageNumber: 1, PageSize: 100, SearchTerm: null, AssigneeUserId: 42, OnlyOpen: true, Overdue: false } }],
  ["saveTask", { call: () => tasks.saveTask({ Title: "Fix", WorkspaceId: 3, AssigneeIds: [4, 5] }), url: "/api/tasks/saveTask", body: { Id: 0, Title: "Fix", Description: "", WorkspaceId: 3, ColumnId: null, ProjectId: null, ParentTaskId: null, AssigneeIds: [4, 5], TeamId: null, Priority: "medium", Type: "task", DueDate: null, EstimatedHours: 0, LoggedHours: 0, Progress: 0, IsBlocked: false, Labels: null, Watchers: null, ChecklistItems: null } }],
  ["saveTask no assignees", { call: () => tasks.saveTask({ Title: "Fix", WorkspaceId: 3 }), url: "/api/tasks/saveTask", body: { Id: 0, Title: "Fix", Description: "", WorkspaceId: 3, ColumnId: null, ProjectId: null, ParentTaskId: null, AssigneeIds: [], TeamId: null, Priority: "medium", Type: "task", DueDate: null, EstimatedHours: 0, LoggedHours: 0, Progress: 0, IsBlocked: false, Labels: null, Watchers: null, ChecklistItems: null } }],
  ["moveTaskColumn", { call: () => tasks.moveTaskColumn({ TaskId: 9, ColumnId: 2 }), url: "/api/tasks/moveTaskColumn", body: { TaskId: 9, ColumnId: 2, WorkspaceId: null } }],
  ["claimTask", { call: () => tasks.claimTask({ TaskId: 9 }), url: "/api/tasks/claimTask", body: { TaskId: 9, WorkspaceId: null } }],
  ["deleteTask", { call: () => tasks.deleteTask({ Id: 9 }), url: "/api/tasks/deleteTask", body: { Id: 9, WorkspaceId: null } }],
  ["bulkDeleteTasks", { call: () => tasks.bulkDeleteTasks({ TaskIds: [9, 10] }), url: "/api/tasks/bulkDeleteTasks", body: { TaskIds: [9, 10], WorkspaceId: null } }],
  ["addTaskComment", { call: () => tasks.addTaskComment({ TaskId: 9, Comment: "hi" }), url: "/api/tasks/addTaskComment", body: { Id: 0, TaskId: 9, Comment: "hi", ParentCommentId: null, WorkspaceId: null } }],
  ["getTaskComments", { call: () => tasks.getTaskComments({ TaskId: 9 }), url: "/api/tasks/getTaskComments", key: "comments", body: { TaskId: 9, PageNumber: 1, PageSize: 100 } }],
  ["deleteTaskComment", { call: () => tasks.deleteTaskComment({ Id: 6 }), url: "/api/tasks/deleteTaskComment", body: { Id: 6, TaskId: null, WorkspaceId: null } }],
  ["pinTaskComment", { call: () => tasks.pinTaskComment({ CommentId: 6 }), url: "/api/tasks/pinTaskComment", body: { CommentId: 6, IsPinned: true, TaskId: null, WorkspaceId: null } }],
  ["markTaskCommentRead", { call: () => tasks.markTaskCommentRead({ CommentId: 6 }), url: "/api/tasks/markTaskCommentRead", body: { CommentId: 6 } }],
  ["saveTaskChecklist", { call: () => tasks.saveTaskChecklist({ TaskId: 9, ItemText: "Step" }), url: "/api/tasks/saveTaskChecklist", body: { Id: 0, TaskId: 9, ItemText: "Step", IsCompleted: false, SortOrder: 0, WorkspaceId: null } }],
  ["getTaskChecklist", { call: () => tasks.getTaskChecklist({ TaskId: 9 }), url: "/api/tasks/getTaskChecklist", key: "checklist", body: { Id: 0, TaskId: 9, PageNumber: 1, PageSize: 50 } }],
  ["deleteTaskChecklist", { call: () => tasks.deleteTaskChecklist({ Id: 1, TaskId: 9 }), url: "/api/tasks/deleteTaskChecklist", body: { Id: 1, TaskId: 9, WorkspaceId: null } }],
  ["logTaskTime", { call: () => tasks.logTaskTime({ TaskId: 9, Hours: 1.5 }), url: "/api/tasks/logTaskTime", body: { TaskId: 9, Hours: 1.5, Description: "", WorkDate: null, WorkspaceId: null } }],
  ["getTaskTimeEntries", { call: () => tasks.getTaskTimeEntries({ TaskId: 9 }), url: "/api/tasks/getTaskTimeEntries", key: "timeEntries", body: { TaskId: 9, UserId: null, PageNumber: 1, PageSize: 20 } }],
  ["deleteTaskTimeEntry", { call: () => tasks.deleteTaskTimeEntry({ Id: 2 }), url: "/api/tasks/deleteTaskTimeEntry", body: { Id: 2, TaskId: null, WorkspaceId: null } }],
  ["getTaskActivity", { call: () => tasks.getTaskActivity({ TaskId: 9 }), url: "/api/tasks/getTaskActivity", key: "activities", body: { TaskId: 9, PageNumber: 1, PageSize: 50 } }],
  ["addTaskDependency", { call: () => tasks.addTaskDependency({ TaskId: 9, DependsOnTaskId: 8 }), url: "/api/tasks/addTaskDependency", body: { TaskId: 9, DependsOnTaskId: 8, Type: "blocks", WorkspaceId: null } }],
  ["removeTaskDependency", { call: () => tasks.removeTaskDependency({ TaskId: 9, DependsOnTaskId: 8 }), url: "/api/tasks/removeTaskDependency", body: { TaskId: 9, DependsOnTaskId: 8, WorkspaceId: null } }],

  // ------------------------------------------------------------- task TAT
  ["acknowledgeTat", { call: () => tat.acknowledgeTat(9), url: "/api/tat/acknowledge", body: { TaskId: 9 } }],
  ["myPartDone", { call: () => tat.myPartDone(9), url: "/api/tat/myPartDone", body: { TaskId: 9 } }],
  ["releaseMine", { call: () => tat.releaseMine(9), url: "/api/tat/release", body: { TaskId: 9, Mine: true } }],
  ["holdMine", { call: () => tat.holdMine({ TaskId: 9, ReasonId: 3, Remarks: null }), url: "/api/tat/hold", body: { TaskId: 9, ReasonId: 3, Remarks: null, Mine: true } }],
  ["saveTatReason", { call: () => tat.saveTatReason({ TaskId: 9, TatId: 11, ReasonId: 3, Remarks: "late part" }), url: "/api/tat/saveReason", body: { TaskId: 9, TatId: 11, ReasonId: 3, Remarks: "late part" } }],

  // ------------------------------------------------------------- tickets
  ["fetchTickets", { call: () => tickets.fetchTickets(), url: "/api/tickets/fetchTickets", body: { BranchId: null, PageNumber: 1, PageSize: 50, SearchTerm: null, StatusId: null, StatusCode: null, Priority: null, CategoryId: null, ChannelId: null, ProductId: null, CustomerId: null, AssignedTo: null, Overdue: 0, Escalated: 0, Unassigned: 0, FromDate: null, ToDate: null } }],
  ["fetchTickets flags", { call: () => tickets.fetchTickets({ StatusCode: "active", Overdue: true, Escalated: true, Unassigned: true, FromDate: "2026-11-01" }), url: "/api/tickets/fetchTickets", body: { BranchId: null, PageNumber: 1, PageSize: 50, SearchTerm: null, StatusId: null, StatusCode: "active", Priority: null, CategoryId: null, ChannelId: null, ProductId: null, CustomerId: null, AssignedTo: null, Overdue: 1, Escalated: 1, Unassigned: 1, FromDate: "2026-11-01", ToDate: null } }],
  ["saveTicket", { call: () => tickets.saveTicket({ CustomerId: 2, Subject: "Trip", CategoryId: 5, Priority: 6, Description: "d" }), url: "/api/tickets/saveTicket", body: { Id: 0, CustomerId: 2, Subject: "Trip", ContactPerson: null, Contact: null, ChannelId: null, CategoryId: 5, Priority: 6, ProductId: null, AssignedTo: null, LinkedLeadId: null, Description: "d", CustomJSON: null } }],
  ["setTicketStatus", { call: () => tickets.setTicketStatus({ TicketId: 7, StatusId: 3 }), url: "/api/tickets/setTicketStatus", body: { TicketId: 7, StatusId: 3, ResolutionId: null, Remarks: null } }],
  ["resolveTicket", { call: () => tickets.resolveTicket({ TicketId: 7, ResolutionId: 1, Remarks: "fixed" }), url: "/api/tickets/resolveTicket", body: { TicketId: 7, ResolutionId: 1, Remarks: "fixed" } }],
  ["closeTicket", { call: () => tickets.closeTicket({ TicketId: 7 }), url: "/api/tickets/closeTicket", body: { TicketId: 7, ResolutionId: null, Remarks: null } }],
  ["rejectTicket", { call: () => tickets.rejectTicket({ TicketId: 7, Remarks: "dup" }), url: "/api/tickets/rejectTicket", body: { TicketId: 7, Remarks: "dup" } }],
  ["reopenTicket", { call: () => tickets.reopenTicket({ TicketId: 7, Remarks: "again" }), url: "/api/tickets/reopenTicket", body: { TicketId: 7, Remarks: "again" } }],
  ["transferTicket", { call: () => tickets.transferTicket({ TicketId: 7, ToUserId: 4, ReasonId: 2, Remarks: "leave" }), url: "/api/tickets/transferTicket", body: { TicketId: 7, ToUserId: 4, ToBranchId: null, ReasonId: 2, Remarks: "leave" } }],
  ["escalateTicket", { call: () => tickets.escalateTicket({ TicketId: 7, ToUserId: 4, Remarks: "late" }), url: "/api/tickets/escalateTicket", body: { TicketId: 7, ToUserId: 4, Remarks: "late" } }],
  ["fetchEscalationTargets", { call: () => tickets.fetchEscalationTargets(), url: "/api/tickets/fetchEscalationTargets", key: "users", body: { ForUserId: null } }],
  ["fetchEscalationTargets for", { call: () => tickets.fetchEscalationTargets(4), url: "/api/tickets/fetchEscalationTargets", key: "users", body: { ForUserId: 4 } }],
  ["deleteTicket", { call: () => tickets.deleteTicket({ Id: 7 }), url: "/api/tickets/deleteTicket", body: { Id: 7 } }],
];

describe.each(CASES)("%s", (_name, c) => {
  it("posts its documented body to its endpoint and resolves the reply", async () => {
    respond(c.key ? { success: true, data: { [c.key]: [ROW] } } : ENVELOPE);
    const result = await c.call();
    expect(lastRequest()).toMatchObject({ url: c.url });
    expect(lastRequest().config.method).toBe("post");
    expect(lastRequest().body).toStrictEqual(c.body);
    expect(result).toEqual(c.key ? [ROW] : ENVELOPE);
  });

  if (c.key) {
    it("maps an absent list to []", async () => {
      respond({ success: true, data: {} });
      await expect(c.call()).resolves.toEqual([]);
    });
  }
});

// ----------------------------------------------- fetchers that reshape the reply

describe("fetchTaskById", () => {
  it("asks for one row and returns it", async () => {
    respond({ success: true, data: { tasks: [ROW, { Id: 2 }] } });
    await expect(tasks.fetchTaskById(9)).resolves.toEqual(ROW);
    expect(lastRequest()).toMatchObject({ url: "/api/tasks/fetchTasks", body: { Id: 9, PageNumber: 1, PageSize: 1, SearchTerm: null } });
  });

  it("returns null when the task is not visible", async () => {
    respond({ success: true, data: { tasks: [] } });
    await expect(tasks.fetchTaskById(9)).resolves.toBeNull();
  });
});

describe("fetchTaskDependencies", () => {
  it("returns the controller's two lists", async () => {
    respond({ success: true, data: { blockers: [ROW], dependents: [{ Id: 2 }] } });
    await expect(tasks.fetchTaskDependencies({ TaskId: 9 })).resolves.toEqual({ blockers: [ROW], dependents: [{ Id: 2 }] });
    expect(lastRequest()).toMatchObject({ url: "/api/tasks/fetchTaskDependencies", body: { TaskId: 9 } });
  });

  it("maps absent lists to []", async () => {
    respond({ success: true, data: null });
    await expect(tasks.fetchTaskDependencies({ TaskId: 9 })).resolves.toEqual({ blockers: [], dependents: [] });
  });
});

describe("fetchTaskTat", () => {
  it("returns data as-is", async () => {
    const data = { clocks: [ROW], holds: [], events: [] };
    respond({ success: true, data });
    await expect(tat.fetchTaskTat(9)).resolves.toEqual(data);
    expect(lastRequest()).toMatchObject({ url: "/api/tat/fetchTaskTat", body: { TaskId: 9 } });
  });

  it("an empty reply is three empty lists", async () => {
    respond({ success: true, data: null });
    await expect(tat.fetchTaskTat(9)).resolves.toEqual({ clocks: [], holds: [], events: [] });
  });
});

describe("fetchTicketDetail", () => {
  it("returns the five parts", async () => {
    const data = { ticket: ROW, fields: [{ FieldId: 1 }], activity: [{ Id: 3 }], assignments: [{ Id: 4 }], linkedLead: { Id: 5 } };
    respond({ success: true, data });
    await expect(tickets.fetchTicketDetail({ TicketId: 7 })).resolves.toEqual(data);
    expect(lastRequest()).toMatchObject({ url: "/api/tickets/fetchTicketDetail", body: { TicketId: 7 } });
  });

  it("fills absent parts with null / []", async () => {
    respond({ success: true, data: null });
    await expect(tickets.fetchTicketDetail({ TicketId: 7 })).resolves.toEqual({
      ticket: null,
      fields: [],
      activity: [],
      assignments: [],
      linkedLead: null,
    });
  });
});

// ------------------------------------------------------------ attachment transfer

describe("attachments", () => {
  beforeEach(() => {
    setAuthToken(null);
    setApiBaseUrl(null);
  });

  it("uploadAttachment sends multipart with Entity and EntityId BEFORE the file, no timeout", async () => {
    // jest runs Node's FormData, not RN's; the append order is what multer sees.
    const append = jest.spyOn(FormData.prototype, "append");
    respond(ENVELOPE);
    await attachments.uploadAttachment({ Entity: "ticket", EntityId: 7, file: { uri: "file:///a.jpg", name: "a.jpg", type: null } });
    const { url, body, config } = lastRequest();
    expect(url).toBe("/api/attachments/save");
    expect(body).toBeInstanceOf(FormData);
    expect(config.timeout).toBe(0);
    expect(config.headers["Content-Type"]).toBe("multipart/form-data");
    expect(append.mock.calls).toEqual([
      ["Entity", "ticket"],
      ["EntityId", "7"],
      ["file", { uri: "file:///a.jpg", name: "a.jpg", type: "application/octet-stream" }],
    ]);
    append.mockRestore();
  });

  it("fetchAttachmentBlob asks for a blob and returns the bytes", async () => {
    respond("BYTES");
    await expect(attachments.fetchAttachmentBlob({ Id: 8 })).resolves.toBe("BYTES");
    expect(lastRequest()).toMatchObject({ url: "/api/attachments/download", body: { Id: 8 } });
    expect(lastRequest().config.responseType).toBe("blob");
  });

  it("attachmentDownloadRequest builds the GET url with the bearer token", () => {
    setAuthToken("tok");
    setApiBaseUrl("https://shadowcodes.in/TestCRM");
    expect(attachments.attachmentDownloadRequest(8)).toEqual({
      url: "https://shadowcodes.in/TestCRM/api/attachments/download/8",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it.each([
    ["no token", null, "https://h"],
    ["no base URL", "tok", null],
  ])("attachmentDownloadRequest is null with %s", (_l, token, base) => {
    setAuthToken(token);
    setApiBaseUrl(base);
    expect(attachments.attachmentDownloadRequest(8)).toBeNull();
  });
});
