import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn(() => Promise.resolve({ data: { success: true } })) },
}));

import { apiClient } from "../utils/axiosConfig";
import * as taskQueries from "./taskQueries";
import { TASK_ENDPOINTS } from "./taskQueries";

// Every fetcher is the same `post(endpoint)` factory (see taskQueries.js) —
// one table-driven test proves the pattern for all 18 rather than hand
// duplicating the same assertion 18 times.
const FETCHERS = {
  saveTask: TASK_ENDPOINTS.tasks.saveTask,
  fetchTasks: TASK_ENDPOINTS.tasks.fetchTasks,
  moveTaskColumn: TASK_ENDPOINTS.tasks.moveTaskColumn,
  bulkDeleteTasks: TASK_ENDPOINTS.tasks.bulkDeleteTasks,
  getTaskComments: TASK_ENDPOINTS.comments.getTaskComments,
  addTaskComment: TASK_ENDPOINTS.comments.addTaskComment,
  deleteTaskComment: TASK_ENDPOINTS.comments.deleteTaskComment,
  pinTaskComment: TASK_ENDPOINTS.comments.pinTaskComment,
  getTaskChecklist: TASK_ENDPOINTS.checklist.getTaskChecklist,
  saveTaskChecklist: TASK_ENDPOINTS.checklist.saveTaskChecklist,
  deleteTaskChecklist: TASK_ENDPOINTS.checklist.deleteTaskChecklist,
  getTaskTimeEntries: TASK_ENDPOINTS.time.getTaskTimeEntries,
  logTaskTime: TASK_ENDPOINTS.time.logTaskTime,
  deleteTaskTimeEntry: TASK_ENDPOINTS.time.deleteTaskTimeEntry,
  fetchTaskDependencies: TASK_ENDPOINTS.dependencies.fetchTaskDependencies,
  addTaskDependency: TASK_ENDPOINTS.dependencies.addTaskDependency,
  removeTaskDependency: TASK_ENDPOINTS.dependencies.removeTaskDependency,
  getTaskActivity: TASK_ENDPOINTS.activity.getTaskActivity,
};

describe("taskQueries", () => {
  beforeEach(() => {
    apiClient.post.mockClear();
  });

  it.each(Object.entries(FETCHERS))(
    "%s posts to its endpoint with the given params",
    async (name, endpoint) => {
      const params = { foo: "bar" };
      await taskQueries[name](params);
      expect(apiClient.post).toHaveBeenCalledWith(endpoint, params);
    },
  );

  it("defaults params to {} when called with no arguments", async () => {
    await taskQueries.fetchTasks();
    expect(apiClient.post).toHaveBeenCalledWith(TASK_ENDPOINTS.tasks.fetchTasks, {});
  });

  // The endpoint map is the contract other modules import — every path must
  // live under /api/tasks/ and match its key, or a page silently 404s.
  it("maps every endpoint key to /api/tasks/<key>", () => {
    for (const group of Object.values(TASK_ENDPOINTS)) {
      for (const [name, path] of Object.entries(group)) {
        expect(path).toBe(`/api/tasks/${name}`);
      }
    }
  });
});
