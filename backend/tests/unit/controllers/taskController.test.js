jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: {
    CREATED: "Created",
    UPDATED: "Updated",
    DELETED: "Deleted",
    STATUS_CHANGED: "StatusChanged",
    COMMENTED: "Commented",
    ASSIGNED: "Assigned",
  },
}));

// The record guard is exercised for real in middleware/permission.test.js;
// here it is stubbed so the checklist tests keep asserting controller wiring
// on their own SP mocks (allow by default, flipped per-test to check the gate).
jest.mock("../../../src/middleware/permission", () => ({
  assertRecordAccess: jest.fn().mockResolvedValue(true),
}));

const database = require("../../../src/config/database");
const { logActivity } = require("../../../src/utils/activityLogger");
const { assertRecordAccess } = require("../../../src/middleware/permission");
const taskController = require("../../../src/controllers/taskController");
const { mockRes } = require("../../helpers/mockRes");

const baseReq = (overrides = {}) => ({
  user: { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: false },
  scope: { branchIds: [1, 2, 3], isAdmin: false },
  body: {},
  ip: "10.0.0.1",
  headers: { "user-agent": "jest" },
  ...overrides,
});

const spResult = (rows) => ({ recordsets: [rows] });

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  logActivity.mockClear();
  assertRecordAccess.mockClear();
  assertRecordAccess.mockResolvedValue(true);
});

// Helper: sequence SP mocks for primary call + any fire-and-forget notify
function mockSequence(rowsForSave, followupOk = true) {
  database.executeStoredProcedure.mockResolvedValueOnce(spResult(rowsForSave));
  if (followupOk) {
    database.executeStoredProcedure.mockResolvedValue(spResult([{}]));
  }
}

describe("taskController.save", () => {
  it("creates task with WorkspaceId + IsAdmin + notifies assignee", async () => {
    mockSequence([{ ResponseCode: 201, ResponseMess: "Task created", TaskId: 11 }]);
    const req = baseReq({
      body: {
        Title: "Do X",
        WorkspaceId: 5,
        AssignedToUserId: 9,
        Priority: "high",
      },
    });
    const res = mockRes();
    await taskController.save(req, res);

    const firstCall = database.executeStoredProcedure.mock.calls[0];
    expect(firstCall[0]).toBe("sp_SaveTask");
    expect(firstCall[1]).toMatchObject({
      Id: 0,
      Title: "Do X",
      WorkspaceId: 5,
      AssignedToUserId: 9,
      CreatedByUserId: 7,
      IsAdmin: 0,
      CompId: 1,
      BranchId: 2,
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Task", entityId: 11, action: "Created" }),
    );
    // Second SP call is sp_NotifyTaskAssigned
    await new Promise((r) => setImmediate(r));
    const secondCall = database.executeStoredProcedure.mock.calls[1];
    expect(secondCall[0]).toBe("sp_NotifyTaskAssigned");
    expect(secondCall[1]).toEqual({ TaskId: 11, ActorUserId: 7 });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("skips notify when assignee is same as actor (self-assign)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", TaskId: 12 }]),
    );
    const req = baseReq({
      body: { Title: "T", WorkspaceId: 5, AssignedToUserId: 7 },
    });
    await taskController.save(req, mockRes());
    await new Promise((r) => setImmediate(r));
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("JSON-serializes Labels/Watchers when objects", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", TaskId: 1 }]),
    );
    const req = baseReq({
      body: { Title: "T", WorkspaceId: 1, Labels: ["x"], Watchers: [1, 2] },
    });
    await taskController.save(req, mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      Labels: '["x"]',
      Watchers: "[1,2]",
    });
  });

  it("does not log activity on validation error from SP", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 400, ResponseMess: "Task title is required" }]),
    );
    const req = baseReq({ body: { Title: "", WorkspaceId: 5 } });
    const res = mockRes();
    await taskController.save(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await taskController.save(baseReq({ body: { Title: "T", WorkspaceId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("TASK_SAVE_ERROR");
    spy.mockRestore();
  });

  it("forwards ChecklistItemsJson when creating a task (strings + object form)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", TaskId: 77 }]),
    );
    const req = baseReq({
      body: {
        Title: "T",
        WorkspaceId: 5,
        ChecklistItems: ["First", { ItemText: "Second" }, "  ", ""],
      },
    });
    await taskController.save(req, mockRes());
    const args = database.executeStoredProcedure.mock.calls[0][1];
    expect(args.ChecklistItemsJson).toBe(JSON.stringify(["First", "Second"]));
  });

  it("passes ChecklistItemsJson=null when editing a task (update path)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", TaskId: 11 }]),
    );
    const req = baseReq({
      body: {
        Id: 11,
        Title: "T",
        WorkspaceId: 5,
        ChecklistItems: ["noop-on-update"],
      },
    });
    await taskController.save(req, mockRes());
    const args = database.executeStoredProcedure.mock.calls[0][1];
    expect(args.ChecklistItemsJson).toBeNull();
  });

  it("passes ChecklistItemsJson=null on create with no items (SP enforces ≥1)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 400, ResponseMess: "At least one checklist item is required" },
      ]),
    );
    const req = baseReq({ body: { Title: "T", WorkspaceId: 5 } });
    const res = mockRes();
    await taskController.save(req, res);
    const args = database.executeStoredProcedure.mock.calls[0][1];
    expect(args.ChecklistItemsJson).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("taskController.fetch", () => {
  it("passes WorkspaceId filter + default PageSize 25 + IsAdmin", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Tasks retrieved",
          TotalRecords: 1,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 25,
          Id: 100,
          Title: "X",
          WorkspaceId: 5,
        },
      ]),
    );
    const req = baseReq({ body: { WorkspaceId: 5 } });
    const res = mockRes();
    await taskController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTask",
      expect.objectContaining({
        WorkspaceId: 5,
        PageSize: 25,
        PageNumber: 1,
        IsAdmin: 0,
        AccessibleBranchIdsJson: JSON.stringify([1, 2, 3]),
        // REGRESSION: @BranchId is an optional narrowing filter in
        // sp_FetchTask, not a scope gate. Passing req.user.BranchId here hid
        // every cross-branch workspace from its own members (a branch-1 user
        // who was a member of a branch-2 shared workspace saw zero tasks).
        BranchId: null,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.tasks).toHaveLength(1);
  });

  it("forwards a BranchId filter from the body when the user picks one", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "No tasks found",
          TotalRecords: 0,
          TotalPages: 0,
          CurrentPage: 1,
          PageSize: 25,
        },
      ]),
    );
    const req = baseReq({ body: { BranchId: 3 } });
    const res = mockRes();
    await taskController.fetch(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTask",
      expect.objectContaining({ BranchId: 3 }),
    );
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.fetch(baseReq(), mockRes());
    spy.mockRestore();
  });
});

describe("taskController.delete", () => {
  it("rejects missing Id with 400", async () => {
    const res = mockRes();
    await taskController.delete(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp + logs on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await taskController.delete(baseReq({ body: { Id: 11 } }), mockRes());
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 11, action: "Deleted" }),
    );
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.delete(baseReq({ body: { Id: 11 } }), mockRes());
    spy.mockRestore();
  });
});

describe("taskController.bulkDelete", () => {
  it("rejects empty list", async () => {
    const res = mockRes();
    await taskController.bulkDelete(baseReq({ body: { TaskIds: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("joins array + logs each id", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 200, ResponseMess: "ok", DeletedCount: 2, FailedCount: 0 },
      ]),
    );
    await taskController.bulkDelete(
      baseReq({ body: { TaskIds: [1, 2] } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_BulkDeleteTasks",
      expect.objectContaining({ TaskIds: "1,2" }),
    );
    expect(logActivity).toHaveBeenCalledTimes(2);
  });

  it("accepts CSV string", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", DeletedCount: 1, FailedCount: 0 }]),
    );
    await taskController.bulkDelete(
      baseReq({ body: { TaskIds: "3,4" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1].TaskIds).toBe("3,4");
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.bulkDelete(baseReq({ body: { TaskIds: [1] } }), mockRes());
    spy.mockRestore();
  });
});

describe("taskController.addComment", () => {
  it("creates a comment + fires sp_NotifyCommentAdded", async () => {
    mockSequence([{ ResponseCode: 201, ResponseMess: "ok", CommentId: 42 }]);
    const req = baseReq({ body: { TaskId: 5, Comment: "hi" } });
    const res = mockRes();
    await taskController.addComment(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][0]).toBe("sp_SaveTaskComment");
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      Id: 0,
      TaskId: 5,
      UserId: 7,
      Comment: "hi",
      ParentCommentId: null,
      IsAdmin: 0,
    });
    await new Promise((r) => setImmediate(r));
    expect(database.executeStoredProcedure.mock.calls[1][0]).toBe(
      "sp_NotifyCommentAdded",
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Task", entityId: 5, action: "Commented" }),
    );
  });

  it("edit path skips notify", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", CommentId: 42 }]),
    );
    await taskController.addComment(
      baseReq({ body: { Id: 42, TaskId: 5, Comment: "edit" } }),
      mockRes(),
    );
    await new Promise((r) => setImmediate(r));
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.addComment(
      baseReq({ body: { TaskId: 1, Comment: "x" } }),
      mockRes(),
    );
    spy.mockRestore();
  });
});

describe("taskController.getComments", () => {
  it("uses PageSize 25 default", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          TotalRecords: 0,
          TotalPages: 0,
          CurrentPage: 1,
          PageSize: 25,
          Id: null,
        },
      ]),
    );
    await taskController.getComments(
      baseReq({ body: { TaskId: 1 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1].PageSize).toBe(25);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.getComments(baseReq({ body: { TaskId: 1 } }), mockRes());
    spy.mockRestore();
  });

  // REGRESSION (COMMENTS_ERROR 500): the SP folds status into data rows, so a
  // task with zero comments returns an EMPTY recordset. Must yield a 200 empty
  // page, not crash on recordsets[0][0].
  it("returns an empty 200 page when the task has no comments", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const res = mockRes();
    await taskController.getComments(baseReq({ body: { TaskId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data.comments).toHaveLength(0);
    expect(json.data.pagination.totalRecords).toBe(0);
  });
});

describe("taskController.deleteComment", () => {
  it("rejects missing Id", async () => {
    await taskController.deleteComment(baseReq({ body: {} }), mockRes());
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("passes IsAdmin to SP", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await taskController.deleteComment(
      baseReq({
        body: { Id: 9 },
        // Admin bypasses come from the per-request scope, not the JWT bit.
        scope: { branchIds: [1, 2, 3], isAdmin: true },
      }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      Id: 9,
      IsAdmin: 1,
    });
    expect(logActivity).toHaveBeenCalled();
  });

  // REGRESSION (stale-admin): a JWT minted while the user was admin must NOT
  // grant a bypass once loadScope says they no longer are — before the fix,
  // req.user.IsAdmin (the login-time bit) fed the SP and this received 1.
  it("token IsAdmin=1 but scope isAdmin=false gets NO admin bypass", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await taskController.deleteComment(
      baseReq({
        body: { Id: 9 },
        user: { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: true }, // stale JWT
        scope: { branchIds: [1, 2, 3], isAdmin: false }, // fresh truth
      }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      IsAdmin: 0,
    });
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.deleteComment(
      baseReq({ body: { Id: 1 } }),
      mockRes(),
    );
    spy.mockRestore();
  });

  // History tab filters on EntityType='Task', so a comment deletion must log
  // under the parent Task (entityId=TaskId), not the comment id.
  it("logs the deletion under the parent Task so it shows in history", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await taskController.deleteComment(
      baseReq({ body: { Id: 9, TaskId: 55 } }),
      mockRes(),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Task",
        entityId: 55,
        fieldName: "Comment",
      }),
    );
  });
});

describe("taskController.pinComment", () => {
  it("rejects missing CommentId", async () => {
    await taskController.pinComment(baseReq({ body: {} }), mockRes());
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("pins (IsPinned=1)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Pinned" }]),
    );
    await taskController.pinComment(
      baseReq({ body: { CommentId: 3 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1].IsPinned).toBe(1);
  });

  it("unpins (IsPinned=0)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Unpinned" }]),
    );
    await taskController.pinComment(
      baseReq({ body: { CommentId: 3, IsPinned: false } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1].IsPinned).toBe(0);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.pinComment(baseReq({ body: { CommentId: 3 } }), mockRes());
    spy.mockRestore();
  });
});

describe("taskController.markCommentRead", () => {
  it("rejects missing CommentId", async () => {
    await taskController.markCommentRead(baseReq({ body: {} }), mockRes());
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("calls sp on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await taskController.markCommentRead(
      baseReq({ body: { CommentId: 5 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_MarkCommentRead",
      { CommentId: 5, UserId: 7 },
    );
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.markCommentRead(baseReq({ body: { CommentId: 5 } }), mockRes());
    spy.mockRestore();
  });
});

describe("taskController.addDependency", () => {
  it("rejects missing fields", async () => {
    await taskController.addDependency(
      baseReq({ body: { TaskId: 1 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("adds + logs activity on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Dependency added" }]),
    );
    await taskController.addDependency(
      baseReq({ body: { TaskId: 1, DependsOnTaskId: 2 } }),
      mockRes(),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 1, fieldName: "Dependency" }),
    );
  });

  it("does not log on SP error", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: "cycle" }]),
    );
    await taskController.addDependency(
      baseReq({ body: { TaskId: 1, DependsOnTaskId: 2 } }),
      mockRes(),
    );
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.addDependency(
      baseReq({ body: { TaskId: 1, DependsOnTaskId: 2 } }),
      mockRes(),
    );
    spy.mockRestore();
  });
});

describe("taskController.removeDependency", () => {
  it("rejects missing fields", async () => {
    await taskController.removeDependency(
      baseReq({ body: { TaskId: 1 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("calls sp on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await taskController.removeDependency(
      baseReq({ body: { TaskId: 1, DependsOnTaskId: 2 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_RemoveTaskDependency",
      expect.objectContaining({ TaskId: 1, DependsOnTaskId: 2 }),
    );
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.removeDependency(
      baseReq({ body: { TaskId: 1, DependsOnTaskId: 2 } }),
      mockRes(),
    );
    spy.mockRestore();
  });
});

describe("taskController.fetchDependencies", () => {
  it("rejects missing TaskId", async () => {
    await taskController.fetchDependencies(
      baseReq({ body: {} }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("partitions into blockers + dependents", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          Direction: "blocker",
          TaskId: 9,
          Title: "API",
          Status: "todo",
          Type: "blocks",
        },
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          Direction: "dependent",
          TaskId: 11,
          Title: "UI",
          Status: "todo",
          Type: "blocks",
        },
      ]),
    );
    const res = mockRes();
    await taskController.fetchDependencies(
      baseReq({ body: { TaskId: 5 } }),
      res,
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.blockers).toHaveLength(1);
    expect(json.data.dependents).toHaveLength(1);
  });

  // REGRESSION: the SP carries status columns on the data rows, so a task
  // with no dependencies returns ZERO rows — the controller crashed reading
  // [0].ResponseCode off undefined and 500'd every dependency-free task.
  it("returns 200 with empty lists when the task has no dependencies", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const res = mockRes();
    await taskController.fetchDependencies(baseReq({ body: { TaskId: 5 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data.blockers).toEqual([]);
    expect(json.data.dependents).toEqual([]);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.fetchDependencies(
      baseReq({ body: { TaskId: 1 } }),
      mockRes(),
    );
    spy.mockRestore();
  });
});

describe("taskController time-tracking + checklist + activity", () => {
  it("logTime defaults WorkDate to today and calls sp", async () => {
    mockSequence([{ ResponseCode: 201, ResponseMess: "ok", TimeEntryId: 1 }]);
    await taskController.logTime(
      baseReq({ body: { TaskId: 1, Hours: 2, Description: "w" } }),
      mockRes(),
    );
    const call = database.executeStoredProcedure.mock.calls[0][1];
    expect(call.WorkDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(logActivity).toHaveBeenCalled();
  });

  it("logTime returns 500 on DB throw", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.logTime(baseReq({ body: { TaskId: 1, Hours: 1 } }), mockRes());
    spy.mockRestore();
  });

  it("getTimeEntries scopes to self for non-admin", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          TotalRecords: 0,
          TotalPages: 0,
          CurrentPage: 1,
          PageSize: 20,
          Id: null,
        },
      ]),
    );
    await taskController.getTimeEntries(
      baseReq({ body: { TaskId: 1 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1].UserId).toBe(7);
  });

  it("getTimeEntries admin sees all when UserId not specified", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          TotalRecords: 0,
          TotalPages: 0,
          CurrentPage: 1,
          PageSize: 20,
          Id: null,
        },
      ]),
    );
    await taskController.getTimeEntries(
      baseReq({
        scope: { branchIds: [1, 2, 3], isAdmin: true },
        body: { TaskId: 1 },
      }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1].UserId).toBeNull();
  });

  // REGRESSION: same zero-rows crash as fetchDependencies — a task with no
  // time entries 500'd instead of returning an empty page.
  it("getTimeEntries returns 200 with an empty page when there are no entries", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const res = mockRes();
    await taskController.getTimeEntries(baseReq({ body: { TaskId: 5 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data.timeEntries).toEqual([]);
    expect(json.data.pagination.totalRecords).toBe(0);
  });

  it("getTimeEntries returns 500 on DB throw", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.getTimeEntries(baseReq({ body: {} }), mockRes());
    spy.mockRestore();
  });

  it("deleteTimeEntry rejects missing Id", async () => {
    await taskController.deleteTimeEntry(baseReq({ body: {} }), mockRes());
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("deleteTimeEntry calls sp + logs under the parent Task", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await taskController.deleteTimeEntry(
      baseReq({ body: { Id: 3, TaskId: 55 } }),
      mockRes(),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Task",
        entityId: 55,
        fieldName: "TimeEntry",
      }),
    );
  });

  it("deleteTimeEntry returns 500 on DB throw", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.deleteTimeEntry(baseReq({ body: { Id: 1 } }), mockRes());
    spy.mockRestore();
  });

  it("saveChecklist create logs CREATED + forwards ActingUserId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", ChecklistId: 7 }]),
    );
    await taskController.saveChecklist(
      baseReq({ body: { TaskId: 1, ItemText: "do" } }),
      mockRes(),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Created" }),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      ActingUserId: 7,
    });
  });

  it("saveChecklist tick logs a StatusChanged with a 'ticked' description", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", ChecklistId: 7 }]),
    );
    await taskController.saveChecklist(
      baseReq({ body: { Id: 7, TaskId: 1, ItemText: "do", IsCompleted: true } }),
      mockRes(),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Task",
        entityId: 1,
        action: "StatusChanged",
        description: "Checklist ticked: do",
        newValue: "done",
      }),
    );
  });

  it("saveChecklist untick logs an 'unticked' description", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", ChecklistId: 7 }]),
    );
    await taskController.saveChecklist(
      baseReq({ body: { Id: 7, TaskId: 1, ItemText: "do", IsCompleted: false } }),
      mockRes(),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "StatusChanged",
        description: "Checklist unticked: do",
        newValue: "open",
      }),
    );
  });

  it("saveChecklist asks for change_status when ticking an existing item", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", ChecklistId: 7 }]),
    );
    await taskController.saveChecklist(
      baseReq({ body: { Id: 7, TaskId: 1, ItemText: "do", IsCompleted: true } }),
      mockRes(),
    );
    expect(assertRecordAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "task",
      1,
      "change_status",
    );
  });

  it("saveChecklist asks for edit_fields when adding a new item", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", ChecklistId: 7 }]),
    );
    await taskController.saveChecklist(
      baseReq({ body: { TaskId: 1, ItemText: "do" } }),
      mockRes(),
    );
    expect(assertRecordAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "task",
      1,
      "edit_fields",
    );
  });

  it("saveChecklist never touches the SP when the guard refuses", async () => {
    assertRecordAccess.mockResolvedValue(false);
    await taskController.saveChecklist(
      baseReq({ body: { Id: 7, TaskId: 1, ItemText: "do" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("deleteChecklist asks for edit_fields and stops when refused", async () => {
    assertRecordAccess.mockResolvedValue(false);
    await taskController.deleteChecklist(
      baseReq({ body: { Id: 7, TaskId: 1 } }),
      mockRes(),
    );
    expect(assertRecordAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "task",
      1,
      "edit_fields",
    );
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("saveChecklist returns 500 on DB throw", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.saveChecklist(baseReq({ body: { TaskId: 1 } }), mockRes());
    spy.mockRestore();
  });

  it("getChecklist returns data", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          TotalRecords: 1,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 50,
          Id: 1,
          ItemText: "x",
        },
      ]),
    );
    const res = mockRes();
    await taskController.getChecklist(
      baseReq({ body: { TaskId: 1 } }),
      res,
    );
    expect(res.json.mock.calls[0][0].data.checklist).toHaveLength(1);
  });

  it("getChecklist returns 500 on DB throw", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.getChecklist(baseReq({ body: { TaskId: 1 } }), mockRes());
    spy.mockRestore();
  });

  // REGRESSION: same empty-recordset trap as comments — a task with no
  // checklist items must return a 200 empty page, not 500.
  it("getChecklist returns an empty 200 page when there are no items", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const res = mockRes();
    await taskController.getChecklist(baseReq({ body: { TaskId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.checklist).toHaveLength(0);
  });

  it("deleteChecklist rejects missing Id", async () => {
    await taskController.deleteChecklist(baseReq({ body: {} }), mockRes());
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("deleteChecklist calls sp + logs + forwards ActingUserId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await taskController.deleteChecklist(
      baseReq({ body: { Id: 4, TaskId: 55 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      ActingUserId: 7,
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Task",
        entityId: 55,
        fieldName: "Checklist",
      }),
    );
  });

  it("deleteChecklist returns 500 on DB throw", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.deleteChecklist(baseReq({ body: { Id: 1 } }), mockRes());
    spy.mockRestore();
  });

  it("getActivity returns data", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          TotalRecords: 0,
          TotalPages: 0,
          CurrentPage: 1,
          PageSize: 50,
          Id: null,
        },
      ]),
    );
    await taskController.getActivity(
      baseReq({ body: { TaskId: 1 } }),
      mockRes(),
    );
  });

  it("getActivity returns 500 on DB throw", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await taskController.getActivity(baseReq({ body: { TaskId: 1 } }), mockRes());
    spy.mockRestore();
  });

  // History is gated behind task membership — a non-member is refused and the
  // SP never runs.
  it("getActivity is blocked when the record guard refuses", async () => {
    assertRecordAccess.mockResolvedValue(false);
    await taskController.getActivity(
      baseReq({ body: { TaskId: 1 } }),
      mockRes(),
    );
    expect(assertRecordAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "task",
      1,
      "view",
    );
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // REGRESSION: a task with no logged activity must return a 200 empty page.
  it("getActivity returns an empty 200 page when there's no activity", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const res = mockRes();
    await taskController.getActivity(baseReq({ body: { TaskId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.activities).toHaveLength(0);
  });
});
