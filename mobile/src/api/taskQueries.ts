// src/api/taskQueries.ts
// Every payload here is taken from the controller signature in
// backend/src/controllers/taskController.js, not guessed. The previous mobile
// app hand-mapped fields (Status, Progress, IsBlocked, Watchers) that quietly
// drifted from the backend — that drift is what killed it.
import { post, postData } from "./client";
import type {
  ApiEnvelope,
  Pagination,
  Task,
  TaskActivityEntry,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskPriority,
  TaskTimeEntry,
} from "../types/api";

export const TASK_ENDPOINTS = {
  fetchTasks: "/api/tasks/fetchTasks",
  saveTask: "/api/tasks/saveTask",
  moveTaskColumn: "/api/tasks/moveTaskColumn",
  deleteTask: "/api/tasks/deleteTask",
  bulkDeleteTasks: "/api/tasks/bulkDeleteTasks",
  addTaskComment: "/api/tasks/addTaskComment",
  getTaskComments: "/api/tasks/getTaskComments",
  deleteTaskComment: "/api/tasks/deleteTaskComment",
  pinTaskComment: "/api/tasks/pinTaskComment",
  markTaskCommentRead: "/api/tasks/markTaskCommentRead",
  saveTaskChecklist: "/api/tasks/saveTaskChecklist",
  getTaskChecklist: "/api/tasks/getTaskChecklist",
  deleteTaskChecklist: "/api/tasks/deleteTaskChecklist",
  logTaskTime: "/api/tasks/logTaskTime",
  getTaskTimeEntries: "/api/tasks/getTaskTimeEntries",
  deleteTaskTimeEntry: "/api/tasks/deleteTaskTimeEntry",
  getTaskActivity: "/api/tasks/getTaskActivity",
  addTaskDependency: "/api/tasks/addTaskDependency",
  removeTaskDependency: "/api/tasks/removeTaskDependency",
  fetchTaskDependencies: "/api/tasks/fetchTaskDependencies",
} as const;

export interface FetchTasksParams {
  Id?: number;
  /** null = every workspace the caller can see — this is what powers My Work. */
  WorkspaceId?: number | null;
  ProjectId?: number | null;
  BranchId?: number | null;
  PageNumber?: number;
  PageSize?: number;
  SearchTerm?: string | null;
}

interface TasksPayload {
  tasks: Task[];
  pagination: Pagination;
}

/**
 * sp_FetchTask treats `@WorkspaceId IS NULL` as "no filter", and every row
 * carries AssigneesJson — which is how My Work lists tasks across all
 * workspaces without a backend change. See spec §5.1 for the scale ceiling.
 */
export const fetchTasks = ({
  Id = 0,
  WorkspaceId = null,
  ProjectId = null,
  BranchId = null,
  PageNumber = 1,
  PageSize = 100,
  SearchTerm = null,
}: FetchTasksParams = {}): Promise<ApiEnvelope<TasksPayload>> =>
  post<TasksPayload>(TASK_ENDPOINTS.fetchTasks, {
    Id,
    WorkspaceId,
    ProjectId,
    BranchId,
    PageNumber,
    PageSize,
    SearchTerm,
  });

export const fetchTaskById = (Id: number): Promise<Task | null> =>
  postData<Task>(
    TASK_ENDPOINTS.fetchTasks,
    { Id, PageNumber: 1, PageSize: 1, SearchTerm: null },
    "tasks",
  ).then((tasks) => tasks[0] ?? null);

export interface SaveTaskPayload {
  Id?: number;
  Title: string;
  Description?: string;
  WorkspaceId: number;
  ColumnId?: number | null;
  ProjectId?: number | null;
  ParentTaskId?: number | null;
  /**
   * The real input. `AssignedToUserId` is deliberately NOT accepted here —
   * the backend still takes it as a legacy single-assignee alias, and sending
   * it would collapse a multi-assignee task down to one person.
   */
  AssigneeIds?: number[];
  TeamId?: number | null;
  Priority?: TaskPriority;
  Type?: string;
  DueDate?: string | null;
  EstimatedHours?: number;
  LoggedHours?: number;
  Progress?: number;
  IsBlocked?: boolean;
  Labels?: string | null;
  Watchers?: string | null;
  /** Only honoured on create (Id === 0); ignored on update. */
  ChecklistItems?: string[] | null;
}

export const saveTask = ({
  Id = 0,
  Title,
  Description = "",
  WorkspaceId,
  ColumnId = null,
  ProjectId = null,
  ParentTaskId = null,
  AssigneeIds = [],
  TeamId = null,
  Priority = "medium",
  Type = "task",
  DueDate = null,
  EstimatedHours = 0,
  LoggedHours = 0,
  Progress = 0,
  IsBlocked = false,
  Labels = null,
  Watchers = null,
  ChecklistItems = null,
}: SaveTaskPayload): Promise<ApiEnvelope<{ taskId: number }>> =>
  post(TASK_ENDPOINTS.saveTask, {
    Id,
    Title,
    Description,
    WorkspaceId,
    ColumnId,
    ProjectId,
    ParentTaskId,
    AssigneeIds,
    TeamId,
    Priority,
    Type,
    DueDate,
    EstimatedHours,
    LoggedHours,
    Progress,
    IsBlocked,
    Labels,
    Watchers,
    ChecklistItems,
  });

/**
 * Dedicated endpoint, gated on `change_status` rather than `edit_fields` —
 * moving a card is progress, not redefinition, so an assignee may do it.
 * Never use saveTask for a column change: it re-sends the whole task and would
 * drop co-assignees.
 */
export const moveTaskColumn = (params: {
  TaskId: number;
  ColumnId: number;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.moveTaskColumn, {
    WorkspaceId: null,
    ...params,
  });

export const deleteTask = (params: {
  Id: number;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.deleteTask, { WorkspaceId: null, ...params });

export const bulkDeleteTasks = (params: {
  TaskIds: number[];
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.bulkDeleteTasks, { WorkspaceId: null, ...params });

// ------------------------------------------------------------- comments

/**
 * `Id > 0` edits an existing comment — sp_SaveTaskComment updates on Id > 0,
 * guarded by edit_own_comment. There is no separate edit endpoint.
 */
export const addTaskComment = (params: {
  Id?: number;
  TaskId: number;
  Comment: string;
  ParentCommentId?: number | null;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.addTaskComment, {
    Id: 0,
    ParentCommentId: null,
    WorkspaceId: null,
    ...params,
  });

export const getTaskComments = (params: {
  TaskId: number;
  PageNumber?: number;
  PageSize?: number;
}): Promise<TaskComment[]> =>
  postData<TaskComment>(
    TASK_ENDPOINTS.getTaskComments,
    { PageNumber: 1, PageSize: 25, ...params },
    "comments",
  );

export const deleteTaskComment = (params: {
  Id: number;
  TaskId?: number | null;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.deleteTaskComment, {
    TaskId: null,
    WorkspaceId: null,
    ...params,
  });

export const pinTaskComment = (params: {
  CommentId: number;
  IsPinned?: boolean;
  TaskId?: number | null;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.pinTaskComment, {
    IsPinned: true,
    TaskId: null,
    WorkspaceId: null,
    ...params,
  });

export const markTaskCommentRead = (params: {
  CommentId: number;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.markTaskCommentRead, params);

// ------------------------------------------------------------ checklist

/**
 * Completion is DERIVED from the checklist — there is no IsDone column on the
 * task, and one must never be reintroduced. Ticking an item here is what marks
 * a task complete.
 *
 * Permission differs by operation: ticking (`Id > 0`) is `change_status`, so
 * any assignee may do it; adding or renaming (`Id === 0`) is
 * `manage_checklist`, which an assigned viewer does not have.
 */
export const saveTaskChecklist = (params: {
  Id?: number;
  TaskId: number;
  ItemText: string;
  IsCompleted?: boolean;
  SortOrder?: number;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.saveTaskChecklist, {
    Id: 0,
    IsCompleted: false,
    SortOrder: 0,
    WorkspaceId: null,
    ...params,
  });

export const getTaskChecklist = (params: {
  TaskId: number;
  PageNumber?: number;
  PageSize?: number;
}): Promise<TaskChecklistItem[]> =>
  postData<TaskChecklistItem>(
    TASK_ENDPOINTS.getTaskChecklist,
    { Id: 0, PageNumber: 1, PageSize: 50, ...params },
    "checklist",
  );

export const deleteTaskChecklist = (params: {
  Id: number;
  TaskId: number;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.deleteTaskChecklist, { WorkspaceId: null, ...params });

// ----------------------------------------------------------- time entries

export const logTaskTime = (params: {
  TaskId: number;
  Hours: number;
  Description?: string;
  WorkDate?: string | null;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.logTaskTime, {
    Description: "",
    WorkDate: null,
    WorkspaceId: null,
    ...params,
  });

export const getTaskTimeEntries = (params: {
  TaskId?: number | null;
  UserId?: number | null;
  PageNumber?: number;
  PageSize?: number;
}): Promise<TaskTimeEntry[]> =>
  postData<TaskTimeEntry>(
    TASK_ENDPOINTS.getTaskTimeEntries,
    { TaskId: null, UserId: null, PageNumber: 1, PageSize: 20, ...params },
    "timeEntries",
  );

export const deleteTaskTimeEntry = (params: {
  Id: number;
  TaskId?: number | null;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.deleteTaskTimeEntry, {
    TaskId: null,
    WorkspaceId: null,
    ...params,
  });

// --------------------------------------------------- activity + dependencies

/** NOTE the key: the controller answers with `activities`, not `activity`. */
export const getTaskActivity = (params: {
  TaskId: number;
  PageNumber?: number;
  PageSize?: number;
}): Promise<TaskActivityEntry[]> =>
  postData<TaskActivityEntry>(
    TASK_ENDPOINTS.getTaskActivity,
    { PageNumber: 1, PageSize: 50, ...params },
    "activities",
  );

/**
 * Two lists, not one: sp_FetchTaskDependencies returns both directions in a
 * single result set tagged with `Direction`, and the controller splits them
 * into `blockers` (what this task waits on) and `dependents` (what waits on
 * it). Each row describes the OTHER task — `TaskId` is its id, not this one's.
 */
export const fetchTaskDependencies = (params: {
  TaskId: number;
}): Promise<{ blockers: TaskDependency[]; dependents: TaskDependency[] }> =>
  post<{ blockers: TaskDependency[]; dependents: TaskDependency[] }>(
    TASK_ENDPOINTS.fetchTaskDependencies,
    params,
  ).then((response) => ({
    blockers: response.data?.blockers ?? [],
    dependents: response.data?.dependents ?? [],
  }));

export const addTaskDependency = (params: {
  TaskId: number;
  DependsOnTaskId: number;
  Type?: string;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.addTaskDependency, {
    Type: "blocks",
    WorkspaceId: null,
    ...params,
  });

export const removeTaskDependency = (params: {
  TaskId: number;
  DependsOnTaskId: number;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.removeTaskDependency, { WorkspaceId: null, ...params });
