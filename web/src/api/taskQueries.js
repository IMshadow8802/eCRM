// src/api/taskQueries.js
// Endpoint constants + thin POST fetchers for the task module (tasks,
// comments, checklist, time entries, dependencies, activity). Mirrors how
// pages call useApiQuery/useApiMutation today (POST via the shared apiClient)
// — see hooks/useApiQuery.jsx. Same shape as api/salesQueries.js.
import { apiClient } from "../utils/axiosConfig";

export const TASK_ENDPOINTS = {
  tasks: {
    saveTask: "/api/tasks/saveTask",
    fetchTasks: "/api/tasks/fetchTasks",
    moveTaskColumn: "/api/tasks/moveTaskColumn",
    bulkDeleteTasks: "/api/tasks/bulkDeleteTasks",
  },
  comments: {
    getTaskComments: "/api/tasks/getTaskComments",
    addTaskComment: "/api/tasks/addTaskComment",
    deleteTaskComment: "/api/tasks/deleteTaskComment",
    pinTaskComment: "/api/tasks/pinTaskComment",
  },
  checklist: {
    getTaskChecklist: "/api/tasks/getTaskChecklist",
    saveTaskChecklist: "/api/tasks/saveTaskChecklist",
    deleteTaskChecklist: "/api/tasks/deleteTaskChecklist",
  },
  time: {
    getTaskTimeEntries: "/api/tasks/getTaskTimeEntries",
    logTaskTime: "/api/tasks/logTaskTime",
    deleteTaskTimeEntry: "/api/tasks/deleteTaskTimeEntry",
  },
  dependencies: {
    fetchTaskDependencies: "/api/tasks/fetchTaskDependencies",
    addTaskDependency: "/api/tasks/addTaskDependency",
    removeTaskDependency: "/api/tasks/removeTaskDependency",
  },
  activity: {
    getTaskActivity: "/api/tasks/getTaskActivity",
  },
};

// ponytail: every fetcher is `apiClient.post(endpoint, params)` — no per-endpoint
// logic exists yet, so one factory beats 18 hand-written near-duplicates.
const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

// Tasks
export const saveTask = post(TASK_ENDPOINTS.tasks.saveTask);
export const fetchTasks = post(TASK_ENDPOINTS.tasks.fetchTasks);
export const moveTaskColumn = post(TASK_ENDPOINTS.tasks.moveTaskColumn);
export const bulkDeleteTasks = post(TASK_ENDPOINTS.tasks.bulkDeleteTasks);

// Comments
export const getTaskComments = post(TASK_ENDPOINTS.comments.getTaskComments);
export const addTaskComment = post(TASK_ENDPOINTS.comments.addTaskComment);
export const deleteTaskComment = post(TASK_ENDPOINTS.comments.deleteTaskComment);
export const pinTaskComment = post(TASK_ENDPOINTS.comments.pinTaskComment);

// Checklist (drives task completion — see CLAUDE.md §6)
export const getTaskChecklist = post(TASK_ENDPOINTS.checklist.getTaskChecklist);
export const saveTaskChecklist = post(TASK_ENDPOINTS.checklist.saveTaskChecklist);
export const deleteTaskChecklist = post(TASK_ENDPOINTS.checklist.deleteTaskChecklist);

// Time tracking
export const getTaskTimeEntries = post(TASK_ENDPOINTS.time.getTaskTimeEntries);
export const logTaskTime = post(TASK_ENDPOINTS.time.logTaskTime);
export const deleteTaskTimeEntry = post(TASK_ENDPOINTS.time.deleteTaskTimeEntry);

// Dependencies (hard blocks)
export const fetchTaskDependencies = post(TASK_ENDPOINTS.dependencies.fetchTaskDependencies);
export const addTaskDependency = post(TASK_ENDPOINTS.dependencies.addTaskDependency);
export const removeTaskDependency = post(TASK_ENDPOINTS.dependencies.removeTaskDependency);

// Activity
export const getTaskActivity = post(TASK_ENDPOINTS.activity.getTaskActivity);
