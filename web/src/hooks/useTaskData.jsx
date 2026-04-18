import { useApiQuery, useManualApiQuery } from "./useApiQuery.jsx";
import { useApiMutation, useDeleteMutation } from "./useApiMutation.jsx";

// ==================== QUERY KEYS ====================
export const TASK_QUERY_KEYS = {
  tasks: 'tasks',
  task: 'task',
  projects: 'projects',
  teams: 'teams',
  users: 'users',
  comments: 'taskComments',
  timeEntries: 'taskTimeEntries',
  checklist: 'taskChecklist',
  taskDetails: 'taskDetails'
};

// Base payload creator
const createBasePayload = (overrides = {}) => ({
  Id: 0,
  PageNumber: 1,
  PageSize: 100,
  SearchTerm: null,
  ...overrides,
});

// ==================== TASK QUERIES ====================

/**
 * Hook for fetching tasks with filters
 * @param {Object} filters - Filter parameters
 * @param {boolean} enabled - Whether to auto-fetch (default: true)
 */
export const useTasks = (filters = {}, enabled = true) => {
  return useApiQuery({
    queryKey: [TASK_QUERY_KEYS.tasks, filters],
    endpoint: '/api/tasks/fetchTasks',
    params: createBasePayload(filters),
    dataKeys: 'tasks',
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes for frequently changing data
  });
};

/**
 * Hook for fetching single task by ID
 * @param {number} taskId - Task ID
 * @param {boolean} enabled - Whether to auto-fetch
 */
export const useTask = (taskId, enabled = !!taskId) => {
  return useApiQuery({
    queryKey: [TASK_QUERY_KEYS.task, taskId],
    endpoint: '/api/tasks/fetchTasks',
    params: {
      Id: taskId,
      PageNumber: 1,
      PageSize: 1,
      SearchTerm: null,
    },
    dataKeys: 'tasks',
    enabled,
    select: (data) => data.tasks?.[0] || null,
  });
};

/**
 * Hook for manually fetching tasks
 * @param {Object} filters - Filter parameters
 */
export const useTasksManual = (filters = {}) => {
  return useManualApiQuery({
    queryKey: [TASK_QUERY_KEYS.tasks, filters],
    endpoint: '/api/tasks/fetchTasks',
    params: createBasePayload(filters),
    dataKeys: 'tasks',
    showSuccessMessage: true,
    successMessage: 'Tasks fetched successfully'
  });
};

// ==================== SUPPORTING DATA QUERIES ====================

/**
 * Hook for fetching projects
 * @param {Object} filters - Filter parameters
 * @param {boolean} enabled - Whether to auto-fetch (default: true)
 */
export const useProjects = (filters = {}, enabled = true) => {
  return useApiQuery({
    queryKey: [TASK_QUERY_KEYS.projects, filters],
    endpoint: '/api/projects/fetchProjects',
    params: createBasePayload(filters),
    dataKeys: 'projects',
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes for relatively static data
  });
};

/**
 * Hook for fetching teams
 * @param {Object} filters - Filter parameters
 * @param {boolean} enabled - Whether to auto-fetch (default: true)
 */
export const useTeams = (filters = {}, enabled = true) => {
  return useApiQuery({
    queryKey: [TASK_QUERY_KEYS.teams, filters],
    endpoint: '/api/teams/fetchTeams',
    params: createBasePayload(filters),
    dataKeys: 'teams',
    enabled,
    staleTime: 15 * 60 * 1000, // 15 minutes for relatively static data
  });
};

/**
 * Hook for fetching users
 * @param {Object} filters - Filter parameters
 * @param {boolean} enabled - Whether to auto-fetch (default: true)
 */
export const useUsers = (filters = {}, enabled = true) => {
  return useApiQuery({
    queryKey: [TASK_QUERY_KEYS.users, filters],
    endpoint: '/api/users/fetchUsers',
    params: createBasePayload(filters),
    dataKeys: 'users',
    enabled,
    staleTime: 15 * 60 * 1000, // 15 minutes for relatively static data
  });
};


// ==================== TASK DETAILS QUERIES ====================

/**
 * Hook for fetching task comments
 * @param {number} taskId - Task ID
 * @param {boolean} enabled - Whether to auto-fetch
 */
export const useTaskComments = (taskId, enabled = !!taskId) => {
  return useApiQuery({
    queryKey: [TASK_QUERY_KEYS.comments, taskId],
    endpoint: '/api/tasks/getTaskComments',
    params: { TaskId: taskId },
    dataKeys: 'comments',
    enabled,
    staleTime: 1 * 60 * 1000, // 1 minute for frequently changing data
  });
};

/**
 * Hook for fetching task time entries
 * @param {number} taskId - Task ID
 * @param {boolean} enabled - Whether to auto-fetch
 */
export const useTaskTimeEntries = (taskId, enabled = !!taskId) => {
  return useApiQuery({
    queryKey: [TASK_QUERY_KEYS.timeEntries, taskId],
    endpoint: '/api/tasks/getTaskTimeEntries',
    params: { TaskId: taskId },
    dataKeys: 'timeEntries',
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
};

/**
 * Hook for fetching task checklist
 * @param {number} taskId - Task ID
 * @param {boolean} enabled - Whether to auto-fetch
 */
export const useTaskChecklist = (taskId, enabled = !!taskId) => {
  return useApiQuery({
    queryKey: [TASK_QUERY_KEYS.checklist, taskId],
    endpoint: '/api/tasks/getTaskChecklist',
    params: { TaskId: taskId },
    dataKeys: 'checklist',
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
};

/**
 * Hook for fetching all task details (comments, time entries, checklist)
 * @param {number} taskId - Task ID
 * @param {boolean} enabled - Whether to auto-fetch
 */
export const useTaskDetails = (taskId, enabled = !!taskId) => {
  const comments = useTaskComments(taskId, enabled);
  const timeEntries = useTaskTimeEntries(taskId, enabled);
  const checklist = useTaskChecklist(taskId, enabled);

  return {
    comments,
    timeEntries,
    checklist,
    isLoading: comments.isLoading || timeEntries.isLoading || checklist.isLoading,
    isError: comments.isError || timeEntries.isError || checklist.isError,
    error: comments.error || timeEntries.error || checklist.error,
  };
};

// ==================== TASK MUTATIONS ====================

/**
 * Hook for creating/updating tasks
 */
export const useTaskMutation = () => {
  return useApiMutation({
    endpoint: '/api/tasks/saveTask',
    invalidateQueries: [[TASK_QUERY_KEYS.tasks], [TASK_QUERY_KEYS.task]],
    successMessage: 'Task saved successfully',
    errorMessage: 'Failed to save task'
  });
};

/**
 * Hook for updating task status (drag & drop)
 */
export const useTaskStatusMutation = () => {
  return useApiMutation({
    endpoint: '/api/tasks/saveTask',
    invalidateQueries: [[TASK_QUERY_KEYS.tasks], [TASK_QUERY_KEYS.task]],
    showSuccessMessage: false, // Don't show success for drag & drop
    errorMessage: 'Failed to update task status'
  });
};

/**
 * Hook for deleting tasks with confirmation
 */
export const useDeleteTask = () => {
  return useDeleteMutation({
    endpoint: '/api/tasks/deleteTask',
    invalidateQueries: [[TASK_QUERY_KEYS.tasks], [TASK_QUERY_KEYS.task]],
    confirmMessage: 'Are you sure you want to delete this task?',
    getItemName: (task) => task.Title || 'this task',
    errorMessage: 'Failed to delete task'
  });
};

/**
 * Hook for toggling task blocked status
 */
export const useToggleTaskBlocked = () => {
  return useApiMutation({
    endpoint: '/api/tasks/saveTask',
    invalidateQueries: [[TASK_QUERY_KEYS.tasks], [TASK_QUERY_KEYS.task]],
    successMessage: 'Task status updated',
    errorMessage: 'Failed to update task status'
  });
};

// ==================== COMMENT MUTATIONS ====================

/**
 * Hook for adding task comments
 */
export const useAddTaskComment = () => {
  return useApiMutation({
    endpoint: '/api/tasks/addTaskComment',
    invalidateQueries: [[TASK_QUERY_KEYS.comments]],
    successMessage: 'Comment added successfully',
    errorMessage: 'Failed to add comment'
  });
};

/**
 * Hook for deleting task comments
 */
export const useDeleteTaskComment = () => {
  return useDeleteMutation({
    endpoint: '/api/tasks/deleteTaskComment',
    invalidateQueries: [[TASK_QUERY_KEYS.comments]],
    confirmMessage: 'Are you sure you want to delete this comment?',
    getItemName: () => 'this comment',
    errorMessage: 'Failed to delete comment'
  });
};

// ==================== TIME TRACKING MUTATIONS ====================

/**
 * Hook for logging time to tasks
 */
export const useLogTaskTime = () => {
  return useApiMutation({
    endpoint: '/api/tasks/logTaskTime',
    invalidateQueries: [[TASK_QUERY_KEYS.timeEntries], [TASK_QUERY_KEYS.tasks]],
    successMessage: 'Time logged successfully',
    errorMessage: 'Failed to log time'
  });
};

/**
 * Hook for deleting time entries
 */
export const useDeleteTimeEntry = () => {
  return useDeleteMutation({
    endpoint: '/api/tasks/deleteTaskTimeEntry',
    invalidateQueries: [[TASK_QUERY_KEYS.timeEntries], [TASK_QUERY_KEYS.tasks]],
    confirmMessage: 'Are you sure you want to delete this time entry?',
    getItemName: () => 'this time entry',
    errorMessage: 'Failed to delete time entry'
  });
};

// ==================== CHECKLIST MUTATIONS ====================

/**
 * Hook for adding checklist items
 */
export const useAddChecklistItem = () => {
  return useApiMutation({
    endpoint: '/api/tasks/saveTaskChecklist',
    invalidateQueries: [[TASK_QUERY_KEYS.checklist]],
    successMessage: 'Checklist item added',
    errorMessage: 'Failed to add checklist item'
  });
};

/**
 * Hook for updating checklist items
 */
export const useUpdateChecklistItem = () => {
  return useApiMutation({
    endpoint: '/api/tasks/saveTaskChecklist',
    invalidateQueries: [[TASK_QUERY_KEYS.checklist]],
    showSuccessMessage: false, // Don't show for every checkbox toggle
    errorMessage: 'Failed to update checklist item'
  });
};

/**
 * Hook for deleting checklist items
 */
export const useDeleteChecklistItem = () => {
  return useDeleteMutation({
    endpoint: '/api/tasks/deleteTaskChecklist',
    invalidateQueries: [[TASK_QUERY_KEYS.checklist]],
    confirmMessage: 'Are you sure you want to delete this checklist item?',
    getItemName: () => 'this checklist item',
    errorMessage: 'Failed to delete checklist item'
  });
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Create a new task object with defaults
 */
export const createTaskObject = (overrides = {}) => ({
  Id: 0,
  Title: "",
  Description: "",
  ProjectId: null,
  ParentTaskId: null,
  AssignedToUserId: null,
  TeamId: null,
  Priority: "medium",
  Type: "task",
  Status: "todo",
  DueDate: null,
  EstimatedHours: 0,
  LoggedHours: 0,
  Progress: 0,
  IsBlocked: false,
  Labels: "[]",
  Watchers: "[]",
  Dependencies: "[]",
  ...overrides,
});

/**
 * Clean and validate task object
 */
export const cleanTaskObject = (task) => ({
  Id: parseInt(task.Id) || 0,
  Title: task.Title || "",
  Description: task.Description || "",
  ProjectId: parseInt(task.ProjectId) || null,
  ProjectName: task.ProjectName || "",
  ParentTaskId: task.ParentTaskId ? parseInt(task.ParentTaskId) : null,
  AssignedToUserId: parseInt(task.AssignedToUserId) || null,
  AssigneeName: task.AssigneeName || "",
  CreatedByUserId: parseInt(task.CreatedByUserId) || null,
  CreatorName: task.CreatorName || "",
  TeamId: task.TeamId ? parseInt(task.TeamId) : null,
  TeamName: task.TeamName || "",
  Priority: task.Priority || "medium",
  Type: task.Type || "task",
  Status: task.Status || "todo",
  DueDate: task.DueDate || null,
  EstimatedHours: parseFloat(task.EstimatedHours) || 0,
  LoggedHours: parseFloat(task.LoggedHours) || 0,
  Progress: parseFloat(task.Progress) || 0,
  IsBlocked: Boolean(task.IsBlocked),
  Labels: task.Labels || "[]",
  Watchers: task.Watchers || "[]",
  Dependencies: task.Dependencies || "[]",
  SubTaskCount: parseInt(task.SubTaskCount) || 0,
  CreatedDate: task.CreatedDate || null,
  BlockingReason: task.BlockingReason || null,
});

/**
 * Parse JSON strings safely
 */
export const parseJsonField = (jsonString, fallback = []) => {
  try {
    if (!jsonString) return fallback;
    return typeof jsonString === "string" ? JSON.parse(jsonString) : jsonString;
  } catch {
    return fallback;
  }
};

