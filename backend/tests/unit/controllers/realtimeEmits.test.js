// Controller -> realtime emit sweep. src/realtime/events is mocked so these
// stay unit-level: we only assert WHICH room/scope fires, and that nothing
// fires when the SP returns an error row.
jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: {
    CREATED: "Created",
    UPDATED: "Updated",
    DELETED: "Deleted",
    COMMENTED: "Commented",
    ASSIGNED: "Assigned",
    TRANSFERRED: "Transferred",
  },
}));
jest.mock("../../../src/realtime/events", () => ({
  emitToWorkspace: jest.fn(),
  emitToUser: jest.fn(),
}));
jest.mock("../../../src/controllers/attachmentController", () => ({
  cascadeDelete: jest.fn().mockResolvedValue(undefined),
}));

const database = require("../../../src/config/database");
const { emitToWorkspace, emitToUser } = require("../../../src/realtime/events");
const { SCOPES } = require("../../../src/realtime/contract");
const taskController = require("../../../src/controllers/taskController");
const kanbanController = require("../../../src/controllers/kanbanController");
const workspaceController = require("../../../src/controllers/workspaceController");
const { mockRes } = require("../../helpers/mockRes");

const baseReq = (body = {}, user = {}) => ({
  user: { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: false, ...user },
  scope: { branchIds: [1, 2], isAdmin: false },
  body,
  ip: "10.0.0.1",
  headers: { "user-agent": "jest" },
});

const spResult = (rows) => ({ recordsets: [rows] });

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  // fire-and-forget notify SPs resolve harmlessly by default
  database.executeStoredProcedure.mockResolvedValue(spResult([{}]));
});

describe("taskController.save emits", () => {
  it("create emits TASK_LIST to the workspace room on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Task created", TaskId: 11 }]),
    );
    const res = mockRes();
    await taskController.save(baseReq({ Title: "T", WorkspaceId: 5 }), res);

    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, {
      workspaceId: 5,
    });
    // create — no TASK_DETAIL emit
    expect(emitToWorkspace).toHaveBeenCalledTimes(1);
  });

  it("assigning someone else pings the assignee's user room (NOTIFICATIONS)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Task created", TaskId: 11 }]),
    );
    const res = mockRes();
    await taskController.save(
      baseReq({ Title: "T", WorkspaceId: 5, AssignedToUserId: 9 }),
      res,
    );
    expect(emitToUser).toHaveBeenCalledWith(9, SCOPES.NOTIFICATIONS);
  });

  it("self-assignment does NOT ping the user room", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Task created", TaskId: 11 }]),
    );
    const res = mockRes();
    await taskController.save(
      baseReq({ Title: "T", WorkspaceId: 5, AssignedToUserId: 7 }), // == caller
      res,
    );
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it("update emits TASK_LIST and TASK_DETAIL", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Task updated", TaskId: 11 }]),
    );
    const res = mockRes();
    await taskController.save(
      baseReq({ Id: 11, Title: "T", WorkspaceId: 5 }),
      res,
    );

    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, {
      workspaceId: 5,
    });
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_DETAIL, {
      workspaceId: 5,
      taskId: 11,
    });
  });

  it("does NOT emit when the SP returns an error row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Permission denied" }]),
    );
    const res = mockRes();
    await taskController.save(baseReq({ Title: "T", WorkspaceId: 5 }), res);
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });

  it("skips the emit when WorkspaceId is unknown (update without it)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Task updated", TaskId: 11 }]),
    );
    const res = mockRes();
    await taskController.save(baseReq({ Id: 11, Title: "T" }), res);
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });
});

describe("taskController.delete emits", () => {
  it("emits TASK_LIST when the client supplies the WorkspaceId hint", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Task deleted" }]),
    );
    const res = mockRes();
    await taskController.delete(baseReq({ Id: 11, WorkspaceId: 5 }), res);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, {
      workspaceId: 5,
    });
  });

  it("does NOT emit on SP error row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Permission denied" }]),
    );
    const res = mockRes();
    await taskController.delete(baseReq({ Id: 11, WorkspaceId: 5 }), res);
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });
});

describe("taskController.addComment emits", () => {
  it("emits TASK_COMMENTS to the workspace room on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", CommentId: 3 }]),
    );
    const res = mockRes();
    await taskController.addComment(
      baseReq({ TaskId: 11, Comment: "hi", WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_COMMENTS, {
      workspaceId: 5,
      taskId: 11,
    });
    // comment-count badges on board cards
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, {
      workspaceId: 5,
    });
    // watcher ids unknown in the controller — bell broadcast to the room
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.NOTIFICATIONS);
  });

  it("does NOT emit when the SP returns an error row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Permission denied" }]),
    );
    const res = mockRes();
    await taskController.addComment(
      baseReq({ TaskId: 11, Comment: "hi", WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });

  it("skips the emit without the WorkspaceId hint", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", CommentId: 3 }]),
    );
    const res = mockRes();
    await taskController.addComment(baseReq({ TaskId: 11, Comment: "hi" }), res);
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });
});

describe("taskController checklist emits", () => {
  it("save emits TASK_DETAIL + TASK_LIST (completion is checklist-derived)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", ChecklistId: 4 }]),
    );
    const res = mockRes();
    await taskController.saveChecklist(
      baseReq({ TaskId: 11, ItemText: "step", WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_DETAIL, {
      workspaceId: 5,
      taskId: 11,
    });
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, {
      workspaceId: 5,
    });
  });

  it("delete emits TASK_DETAIL (taskId from the SP row) + TASK_LIST", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", TaskId: 11 }]),
    );
    const res = mockRes();
    await taskController.deleteChecklist(baseReq({ Id: 4, WorkspaceId: 5 }), res);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_DETAIL, {
      workspaceId: 5,
      taskId: 11,
    });
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, {
      workspaceId: 5,
    });
  });
});

describe("taskController time + dependency emits", () => {
  it("logTime emits TASK_DETAIL", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", TimeEntryId: 9 }]),
    );
    const res = mockRes();
    await taskController.logTime(
      baseReq({ TaskId: 11, Hours: 2, WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_DETAIL, {
      workspaceId: 5,
      taskId: 11,
    });
  });

  it("addDependency emits TASK_DETAIL; removeDependency too", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok" }]),
    );
    let res = mockRes();
    await taskController.addDependency(
      baseReq({ TaskId: 11, DependsOnTaskId: 12, WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_DETAIL, {
      workspaceId: 5,
      taskId: 11,
    });

    emitToWorkspace.mockClear();
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    res = mockRes();
    await taskController.removeDependency(
      baseReq({ TaskId: 11, DependsOnTaskId: 12, WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_DETAIL, {
      workspaceId: 5,
      taskId: 11,
    });
  });

  it("deleteTimeEntry emits TASK_DETAIL with both client hints, skips without", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    let res = mockRes();
    await taskController.deleteTimeEntry(
      baseReq({ Id: 9, TaskId: 11, WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_DETAIL, {
      workspaceId: 5,
      taskId: 11,
    });

    emitToWorkspace.mockClear();
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    res = mockRes();
    await taskController.deleteTimeEntry(baseReq({ Id: 9 }), res);
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });
});

describe("taskController pin + mark-read emits", () => {
  it("pinComment emits TASK_COMMENTS (pins render in the comment list)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    const res = mockRes();
    await taskController.pinComment(
      baseReq({ CommentId: 3, IsPinned: true, TaskId: 11, WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_COMMENTS, {
      workspaceId: 5,
      taskId: 11,
    });
  });

  it("pinComment does NOT emit on SP error or without hints", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "denied" }]),
    );
    let res = mockRes();
    await taskController.pinComment(
      baseReq({ CommentId: 3, TaskId: 11, WorkspaceId: 5 }),
      res,
    );
    expect(emitToWorkspace).not.toHaveBeenCalled();

    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    res = mockRes();
    await taskController.pinComment(baseReq({ CommentId: 3 }), res);
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });

  it("markCommentRead pings the CALLER's user room so other tabs clear badges", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    const res = mockRes();
    await taskController.markCommentRead(baseReq({ CommentId: 3 }), res);
    expect(emitToUser).toHaveBeenCalledWith(7, SCOPES.NOTIFICATIONS); // req.user
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });

  it("markCommentRead does NOT emit on SP error", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 404, ResponseMess: "not found" }]),
    );
    const res = mockRes();
    await taskController.markCommentRead(baseReq({ CommentId: 3 }), res);
    expect(emitToUser).not.toHaveBeenCalled();
  });
});

describe("kanbanController emits", () => {
  it("column save emits TASK_LIST on success, not on error", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", ColumnId: 2 }]),
    );
    let res = mockRes();
    await kanbanController.save(baseReq({ WorkspaceId: 5, Title: "Col" }), res);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, {
      workspaceId: 5,
    });

    emitToWorkspace.mockClear();
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "denied" }]),
    );
    res = mockRes();
    await kanbanController.save(baseReq({ WorkspaceId: 5, Title: "Col" }), res);
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });

  it("column delete emits TASK_LIST with the client WorkspaceId hint", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", TasksMoved: 0 }]),
    );
    const res = mockRes();
    await kanbanController.delete(baseReq({ Id: 2, WorkspaceId: 5 }), res);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, {
      workspaceId: 5,
    });
  });
});

describe("workspaceController.addMember emits", () => {
  it("emits WORKSPACE_MEMBERS to the room + WORKSPACES/NOTIFICATIONS to the invitee", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 201, ResponseMess: "ok", WorkspaceId: 5, UserId: 9, Role: "member" },
      ]),
    );
    const res = mockRes();
    await workspaceController.addMember(
      baseReq({ WorkspaceId: 5, UserId: 9 }),
      res,
    );

    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACE_MEMBERS, {
      workspaceId: 5,
    });
    expect(emitToUser).toHaveBeenCalledWith(9, SCOPES.WORKSPACES);
    expect(emitToUser).toHaveBeenCalledWith(9, SCOPES.NOTIFICATIONS);
  });

  it("does NOT emit when the SP returns an error row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "denied" }]),
    );
    const res = mockRes();
    await workspaceController.addMember(
      baseReq({ WorkspaceId: 5, UserId: 9 }),
      res,
    );
    expect(emitToWorkspace).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });
});

describe("workspaceController.removeMember / respondInvite emits", () => {
  it("removeMember: members + notifications to room, workspaces + notifications to the removed user", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    const res = mockRes();
    await workspaceController.removeMember(
      baseReq({ WorkspaceId: 5, UserId: 9 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACE_MEMBERS, {
      workspaceId: 5,
    });
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.NOTIFICATIONS);
    expect(emitToUser).toHaveBeenCalledWith(9, SCOPES.WORKSPACES);
    expect(emitToUser).toHaveBeenCalledWith(9, SCOPES.NOTIFICATIONS);
  });

  it("respondInvite: members + notifications to room, workspaces + notifications to the responder", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 200, ResponseMess: "ok", WorkspaceId: 5, InviteStatus: "active" },
      ]),
    );
    const res = mockRes();
    await workspaceController.respondInvite(
      baseReq({ WorkspaceId: 5, Action: "accept" }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACE_MEMBERS, {
      workspaceId: 5,
    });
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.NOTIFICATIONS);
    expect(emitToUser).toHaveBeenCalledWith(7, SCOPES.WORKSPACES); // req.user
    expect(emitToUser).toHaveBeenCalledWith(7, SCOPES.NOTIFICATIONS);
  });
});

describe("workspaceController lifecycle emits", () => {
  it("transferOwnership emits WORKSPACES + WORKSPACE_MEMBERS + NOTIFICATIONS to the room", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 200, ResponseMess: "ok", WorkspaceId: 5, NewOwnerUserId: 9 },
      ]),
    );
    const res = mockRes();
    await workspaceController.transferOwnership(
      baseReq({ WorkspaceId: 5, NewOwnerUserId: 9 }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACES);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACE_MEMBERS, {
      workspaceId: 5,
    });
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.NOTIFICATIONS);
  });

  it("archive emits WORKSPACES to the room", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    const res = mockRes();
    await workspaceController.archive(baseReq({ WorkspaceId: 5 }), res);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACES);
  });

  it("save(update) emits WORKSPACES; save(create) does not", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", WorkspaceId: 5 }]),
    );
    let res = mockRes();
    await workspaceController.save(
      baseReq({ Id: 5, Name: "WS", Type: "shared" }),
      res,
    );
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACES);

    emitToWorkspace.mockClear();
    // create: sp_SaveWorkspace + sp_ApplyKanbanTemplate
    database.executeStoredProcedure
      .mockResolvedValueOnce(
        spResult([{ ResponseCode: 201, ResponseMess: "ok", WorkspaceId: 6 }]),
      )
      .mockResolvedValueOnce(spResult([{ ColumnsCreated: 3 }]));
    res = mockRes();
    await workspaceController.save(
      baseReq({ Id: 0, Name: "WS", Type: "shared" }),
      res,
    );
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });

  it("delete emits WORKSPACES on a real delete but NEVER on dry-run", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ResponseCode: 200, ResponseMess: "ok", WorkspaceId: 5 }],
        [],
      ],
    });
    let res = mockRes();
    await workspaceController.delete(baseReq({ WorkspaceId: 5 }), res);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACES);

    emitToWorkspace.mockClear();
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ResponseCode: 200, ResponseMess: "ok", WorkspaceId: 5 }],
        [],
      ],
    });
    res = mockRes();
    await workspaceController.delete(
      baseReq({ WorkspaceId: 5, DryRun: 1 }),
      res,
    );
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });

  it("syncProjectMembers emits WORKSPACE_MEMBERS + WORKSPACES", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          WorkspaceId: 5,
          MembersAddedOrRestored: 1,
          MembersDeactivated: 0,
        },
      ]),
    );
    const res = mockRes();
    await workspaceController.syncProjectMembers(baseReq({ WorkspaceId: 5 }), res);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACE_MEMBERS, {
      workspaceId: 5,
    });
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACES);
  });

  it("convertToShared emits WORKSPACES + WORKSPACE_MEMBERS", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", WorkspaceId: 5 }]),
    );
    const res = mockRes();
    await workspaceController.convertToShared(baseReq({ WorkspaceId: 5 }), res);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACES);
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.WORKSPACE_MEMBERS, {
      workspaceId: 5,
    });
  });
});
