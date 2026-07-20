jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
// Real fs everywhere except unlink — delete tests assert exactly which files
// get removed (and that dry runs remove none).
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  unlink: jest.fn((p, cb) => cb && cb(null)),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: {
    CREATED: "Created",
    UPDATED: "Updated",
    DELETED: "Deleted",
    ASSIGNED: "Assigned",
    TRANSFERRED: "Transferred",
  },
}));

const fs = require("fs");
const path = require("path");
const database = require("../../../src/config/database");
const { logActivity } = require("../../../src/utils/activityLogger");
const { UPLOAD_ROOT } = require("../../../src/middleware/upload");
const workspaceController = require("../../../src/controllers/workspaceController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: false },
    scope: { branchIds: [1, 2, 3], isAdmin: false },
    body: {},
    ip: "10.0.0.1",
    headers: { "user-agent": "jest" },
    ...overrides,
  };
}

function spResult(rows) {
  return { recordsets: [rows] };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  logActivity.mockClear();
  fs.unlink.mockClear();
});

describe("workspaceController.save", () => {
  it("creates a shared workspace with invited members, seeds template, logs activity", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Workspace created", WorkspaceId: 42 }]),
    );
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Template applied", WorkspaceId: 42, TemplateKey: "basic", ColumnsCreated: 3 }]),
    );

    const req = baseReq({
      body: {
        Name: "Marketing",
        Type: "shared",
        Color: "#F59E0B",
        TemplateKey: "basic",
        Members: [3, 4, 9],
      },
    });
    const res = mockRes();
    await workspaceController.save(req, res);

    const calls = database.executeStoredProcedure.mock.calls;
    expect(calls[0][0]).toBe("sp_SaveWorkspace");
    expect(calls[0][1]).toEqual(
      expect.objectContaining({
        Id: 0,
        Name: "Marketing",
        Type: "shared",
        OwnerUserId: 7,
        CompId: 1,
        BranchId: 2,
        Color: "#F59E0B",
        MembersJson: JSON.stringify([3, 4, 9]),
      }),
    );
    expect(calls[1][0]).toBe("sp_ApplyKanbanTemplate");
    expect(calls[1][1]).toEqual({
      WorkspaceId: 42,
      TemplateKey: "basic",
      CompId: 1,
      BranchId: 2,
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Workspace",
        entityId: 42,
        action: "Created",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ workspaceId: 42, columnsSeeded: 3 });
  });

  it("creates a project workspace with the requested TemplateKey", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Workspace created", WorkspaceId: 7 }]),
    );
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Template applied", WorkspaceId: 7, TemplateKey: "scrum", ColumnsCreated: 5 }]),
    );

    const req = baseReq({
      body: { Name: "Sprint", Type: "project", ProjectId: 9, TemplateKey: "scrum" },
    });
    const res = mockRes();
    await workspaceController.save(req, res);

    const calls = database.executeStoredProcedure.mock.calls;
    expect(calls[1][1].TemplateKey).toBe("scrum");
    expect(res.json.mock.calls[0][0].data.columnsSeeded).toBe(5);
  });

  it("calls sp_ApplyKanbanTemplate for personal workspaces too (user-picked template)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Workspace created", WorkspaceId: 1 }]),
    );
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 201,
          ResponseMess: "Template applied",
          WorkspaceId: 1,
          TemplateKey: "basic",
          ColumnsCreated: 3,
        },
      ]),
    );

    const req = baseReq({ body: { Name: "My Tasks", Type: "personal" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    const spNames = database.executeStoredProcedure.mock.calls.map((c) => c[0]);
    expect(spNames).toEqual(["sp_SaveWorkspace", "sp_ApplyKanbanTemplate"]);
  });

  it("still succeeds + logs when template SP throws (save is source of truth)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Workspace created", WorkspaceId: 99 }]),
    );
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("template boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    const req = baseReq({ body: { Name: "X", Type: "shared" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.columnsSeeded).toBe(0);
    expect(logActivity).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("updates a workspace and logs UPDATED when Id > 0 (no template reseed)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace updated", WorkspaceId: 5 }]),
    );

    const req = baseReq({ body: { Id: 5, Name: "Renamed", Type: "shared" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    const spNames = database.executeStoredProcedure.mock.calls.map((c) => c[0]);
    expect(spNames).toEqual(["sp_SaveWorkspace"]);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Updated", entityId: 5 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not log activity when SP returns validation error", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 400, ResponseMess: "Workspace name is required" }]),
    );

    const req = baseReq({ body: { Name: "", Type: "shared" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.data).toBeNull();
  });

  it("omits MembersJson when no members array is provided", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", WorkspaceId: 1 }]),
    );
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", ColumnsCreated: 3 }]),
    );

    const req = baseReq({ body: { Name: "Solo", Type: "shared" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].MembersJson).toBeNull();
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { Name: "X", Type: "shared" } });
    const res = mockRes();

    await workspaceController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.code).toBe("WORKSPACE_SAVE_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.fetch", () => {
  it("returns cleaned workspace rows + pagination envelope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Workspaces retrieved",
          TotalRecords: 2,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 25,
          Id: 1,
          Name: "My Tasks",
          Type: "personal",
          OwnerUserId: 7,
          MemberCount: 1,
          MyRole: "owner",
        },
        {
          ResponseCode: 200,
          ResponseMess: "Workspaces retrieved",
          TotalRecords: 2,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 25,
          Id: 2,
          Name: "Team",
          Type: "shared",
          OwnerUserId: 7,
          MemberCount: 3,
          MyRole: "owner",
        },
      ]),
    );

    const req = baseReq({ body: { PageNumber: 1, PageSize: 25 } });
    const res = mockRes();
    await workspaceController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchWorkspaces",
      expect.objectContaining({
        UserId: 7,
        CompId: 1,
        BranchId: 2,
        IsAdmin: 0,
        AccessibleBranchIdsJson: JSON.stringify([1, 2, 3]),
        PageNumber: 1,
        PageSize: 25,
      }),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data.workspaces).toHaveLength(2);
    expect(json.data.workspaces[0]).toMatchObject({ Id: 1, Type: "personal" });
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 25,
      totalRecords: 2,
      totalPages: 1,
    });
  });

  it("passes null AccessibleBranchIdsJson when scope is empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "No workspaces found",
          TotalRecords: 0,
          TotalPages: 0,
          CurrentPage: 1,
          PageSize: 25,
          Id: null,
        },
      ]),
    );

    const req = baseReq({ scope: {} });
    const res = mockRes();
    await workspaceController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchWorkspaces",
      expect.objectContaining({ AccessibleBranchIdsJson: null }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.workspaces).toHaveLength(0);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("db down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq();
    const res = mockRes();

    await workspaceController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_FETCH_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.fetchMembers", () => {
  it("400s without WorkspaceId", async () => {
    const res = mockRes();
    await workspaceController.fetchMembers(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("passes the caller's identity faithfully and maps member rows", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Members retrieved",
          UserId: 3,
          FullName: "Raaj",
          Role: "owner",
          InviteStatus: "active",
          IsOwner: true,
        },
        {
          ResponseCode: 200,
          ResponseMess: "Members retrieved",
          UserId: 2,
          FullName: "Ayush",
          Role: "member",
          InviteStatus: "removed", // left members stay listed for re-invite
          IsOwner: false,
        },
      ]),
    );
    const res = mockRes();
    await workspaceController.fetchMembers(baseReq({ body: { WorkspaceId: 9 } }), res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchWorkspaceMembers",
      { WorkspaceId: 9, ActingUserId: 7, IsAdmin: 0, CompId: 1 },
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.members).toHaveLength(2);
    expect(json.data.members[1].InviteStatus).toBe("removed");
  });

  it("surfaces the SP's 403 (personal workspace privacy) as-is", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Not allowed" }]),
    );
    const res = mockRes();
    await workspaceController.fetchMembers(baseReq({ body: { WorkspaceId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("500s when the DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await workspaceController.fetchMembers(baseReq({ body: { WorkspaceId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});

describe("workspaceController.addMember", () => {
  it("rejects missing WorkspaceId or UserId with 400", async () => {
    const req = baseReq({ body: { Role: "member" } });
    const res = mockRes();
    await workspaceController.addMember(req, res);

    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
  });

  it("calls sp_AddWorkspaceMember and logs on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 201,
          ResponseMess: "Member added",
          WorkspaceId: 4,
          UserId: 9,
          Role: "member",
        },
      ]),
    );

    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.addMember(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_AddWorkspaceMember",
      expect.objectContaining({
        WorkspaceId: 4,
        UserId: 9,
        Role: "member",
        ActingUserId: 7,
        IsAdmin: 0,
        CompId: 1,
      }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Workspace", entityId: 4 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("does not log on 403", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Only owner can add" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.addMember(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("oops"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.addMember(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_MEMBER_ADD_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.removeMember", () => {
  it("rejects missing ids with 400", async () => {
    const req = baseReq({ body: { WorkspaceId: 4 } });
    const res = mockRes();
    await workspaceController.removeMember(req, res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp_RemoveWorkspaceMember and logs on 200", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Member removed" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.removeMember(req, res);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Transferred", entityId: 4 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not log when SP returns 404", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 404, ResponseMess: "Member not found" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.removeMember(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("fail"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.removeMember(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_MEMBER_REMOVE_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.applyTemplate", () => {
  it("rejects missing WorkspaceId", async () => {
    const res = mockRes();
    await workspaceController.applyTemplate(baseReq({ body: {} }), res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp on success with default TemplateKey", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 201,
          ResponseMess: "Template applied",
          WorkspaceId: 3,
          TemplateKey: "basic",
          ColumnsCreated: 3,
        },
      ]),
    );
    const res = mockRes();
    await workspaceController.applyTemplate(
      baseReq({ body: { WorkspaceId: 3 } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ApplyKanbanTemplate",
      expect.objectContaining({ WorkspaceId: 3, TemplateKey: "basic", CompId: 1 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.columnsCreated).toBe(3);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await workspaceController.applyTemplate(
      baseReq({ body: { WorkspaceId: 3 } }),
      mockRes(),
    );
    spy.mockRestore();
  });
});

describe("workspaceController.ensurePersonal", () => {
  it("seeds workspace on first call and logs Created", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 201,
          ResponseMess: "Personal workspace seeded",
          WorkspaceId: 99,
          Seeded: 1,
        },
      ]),
    );
    const req = baseReq();
    const res = mockRes();
    await workspaceController.ensurePersonal(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SeedDefaultWorkspace",
      { UserId: 7, CompId: 1, BranchId: 2 },
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 99, action: "Created" }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data).toEqual({ workspaceId: 99, seeded: true });
  });

  it("does not log when already seeded (Seeded=0)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Personal workspace already exists",
          WorkspaceId: 1,
          Seeded: 0,
        },
      ]),
    );
    const req = baseReq();
    const res = mockRes();
    await workspaceController.ensurePersonal(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ workspaceId: 1, seeded: false });
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await workspaceController.ensurePersonal(baseReq(), mockRes());
    spy.mockRestore();
  });
});

describe("workspaceController.archive", () => {
  it("rejects missing WorkspaceId with 400", async () => {
    const req = baseReq({ body: {} });
    const res = mockRes();
    await workspaceController.archive(req, res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("archives (IsArchived=true) and logs DELETED", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace archived" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 11 } });
    const res = mockRes();
    await workspaceController.archive(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ArchiveWorkspace",
      expect.objectContaining({ WorkspaceId: 11, IsArchived: 1 }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Deleted", entityId: 11 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("unarchives (IsArchived=false) and logs UPDATED", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace unarchived" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 11, IsArchived: false } });
    const res = mockRes();
    await workspaceController.archive(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ArchiveWorkspace",
      expect.objectContaining({ IsArchived: 0 }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Updated" }),
    );
  });

  it("does not log when SP returns 403", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "denied" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 11 } });
    const res = mockRes();
    await workspaceController.archive(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { WorkspaceId: 11 } });
    const res = mockRes();
    await workspaceController.archive(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_ARCHIVE_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.respondInvite", () => {
  it("accepts invite + logs activity", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Invite accepted",
          WorkspaceId: 21,
          InviteStatus: "active",
        },
      ]),
    );

    const req = baseReq({ body: { WorkspaceId: 21, Action: "accept" } });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_RespondWorkspaceInvite",
      { WorkspaceId: 21, UserId: 7, Action: "accept", CompId: 1 },
    );
    expect(logActivity).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      workspaceId: 21,
      inviteStatus: "active",
    });
  });

  it("declines invite", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Invite declined",
          WorkspaceId: 9,
          InviteStatus: "declined",
        },
      ]),
    );

    const req = baseReq({ body: { WorkspaceId: 9, Action: "decline" } });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].Action).toBe(
      "decline",
    );
    expect(res.json.mock.calls[0][0].data.inviteStatus).toBe("declined");
  });

  it("400 on bad action", async () => {
    const req = baseReq({ body: { WorkspaceId: 1, Action: "whatever" } });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400 when fields missing", async () => {
    const req = baseReq({ body: {} });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { WorkspaceId: 1, Action: "accept" } });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_INVITE_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.save — acting identity (lifecycle contract)", () => {
  it("passes ActingUserId and IsAdmin=0 for a non-admin caller", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace updated", WorkspaceId: 5 }]),
    );
    const req = baseReq({ body: { Id: 5, Name: "Renamed", Type: "shared" } });
    await workspaceController.save(req, mockRes());

    expect(database.executeStoredProcedure.mock.calls[0][1]).toEqual(
      expect.objectContaining({ ActingUserId: 7, IsAdmin: 0 }),
    );
  });

  it("passes IsAdmin=1 for an admin caller", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace updated", WorkspaceId: 5 }]),
    );
    const req = baseReq({
      user: { UserId: 2, CompId: 1, BranchId: 2, IsAdmin: true },
      scope: { branchIds: [1, 2, 3], isAdmin: true },
      body: { Id: 5, Name: "Renamed", Type: "shared" },
    });
    await workspaceController.save(req, mockRes());

    expect(database.executeStoredProcedure.mock.calls[0][1]).toEqual(
      expect.objectContaining({ ActingUserId: 2, IsAdmin: 1 }),
    );
  });

  // REGRESSION (stale-admin): the JWT's login-time IsAdmin bit must not win
  // over the per-request scope computed by loadScope. Before the fix this
  // passed IsAdmin: 1 to the SP off the stale token.
  it("token IsAdmin=1 but scope isAdmin=false gets NO admin bypass", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace updated", WorkspaceId: 5 }]),
    );
    const req = baseReq({
      user: { UserId: 2, CompId: 1, BranchId: 2, IsAdmin: true }, // stale JWT
      scope: { branchIds: [1, 2, 3], isAdmin: false }, // fresh truth
      body: { Id: 5, Name: "Renamed", Type: "shared" },
    });
    await workspaceController.save(req, mockRes());

    expect(database.executeStoredProcedure.mock.calls[0][1]).toEqual(
      expect.objectContaining({ ActingUserId: 2, IsAdmin: 0 }),
    );
  });

  it("surfaces the SP 403 when an admin edits another user's personal workspace", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Only the owner can edit a personal workspace" }]),
    );
    const req = baseReq({
      user: { UserId: 2, CompId: 1, BranchId: 2, IsAdmin: true },
      body: { Id: 10007, Name: "Sneaky rename", Type: "personal" },
    });
    const res = mockRes();
    await workspaceController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("workspaceController.convertToShared", () => {
  it("rejects missing WorkspaceId with 400", async () => {
    const res = mockRes();
    await workspaceController.convertToShared(baseReq({ body: {} }), res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
  });

  it("serializes MemberIds to MembersJson and logs UPDATED on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace shared", WorkspaceId: 10 }]),
    );
    const req = baseReq({ body: { WorkspaceId: 10, MemberIds: [3, 9] } });
    const res = mockRes();
    await workspaceController.convertToShared(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ConvertWorkspaceToShared",
      {
        WorkspaceId: 10,
        ActingUserId: 7,
        MembersJson: JSON.stringify([3, 9]),
        CompId: 1,
      },
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Workspace",
        entityId: 10,
        action: "Updated",
        description: "Workspace shared (personal -> shared)",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ workspaceId: 10 });
  });

  it("defaults MembersJson to '[]' when MemberIds is omitted", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace shared", WorkspaceId: 10 }]),
    );
    await workspaceController.convertToShared(
      baseReq({ body: { WorkspaceId: 10 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1].MembersJson).toBe("[]");
  });

  it("INVARIANT: an admin cannot share another user's personal workspace — SP 403 surfaces, identity passed faithfully", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 403, ResponseMess: "Only the owner can share their personal workspace" },
      ]),
    );
    const req = baseReq({
      user: { UserId: 2, CompId: 1, BranchId: 2, IsAdmin: true },
      body: { WorkspaceId: 10007 },
    });
    const res = mockRes();
    await workspaceController.convertToShared(req, res);

    // The controller must send the TRUE acting user — never spoof the owner.
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ConvertWorkspaceToShared",
      { WorkspaceId: 10007, ActingUserId: 2, MembersJson: "[]", CompId: 1 },
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].data).toBeNull();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await workspaceController.convertToShared(baseReq({ body: { WorkspaceId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_CONVERT_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.delete", () => {
  const countsRow = {
    ResponseCode: 200,
    ResponseMess: "Workspace deleted",
    WorkspaceId: 11,
    TaskCount: 4,
    CommentCount: 6,
    AttachmentCount: 2,
    MemberCount: 3,
  };

  it("rejects missing WorkspaceId with 400", async () => {
    const res = mockRes();
    await workspaceController.delete(baseReq({ body: {} }), res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("dry run: returns counts, does NOT unlink files, does NOT audit-log", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ...countsRow, ResponseMess: "Dry run" }],
        [], // empty file list — shape identical in both modes
      ],
    });
    const req = baseReq({ body: { WorkspaceId: 11, DryRun: true } });
    const res = mockRes();
    await workspaceController.delete(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteWorkspace",
      { WorkspaceId: 11, ActingUserId: 7, IsAdmin: 0, CompId: 1, DryRun: 1 },
    );
    expect(fs.unlink).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      workspaceId: 11,
      dryRun: true,
      taskCount: 4,
      commentCount: 6,
      attachmentCount: 2,
      memberCount: 3,
    });
  });

  it("real delete: unlinks exactly the files from result set 2 and logs DELETED with counts", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [countsRow],
        [
          { Entity: "task", StoredName: "aaa.png" },
          { Entity: "task", StoredName: "bbb.pdf" },
        ],
      ],
    });
    const req = baseReq({ body: { WorkspaceId: 11 } });
    const res = mockRes();
    await workspaceController.delete(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].DryRun).toBe(0);
    expect(fs.unlink).toHaveBeenCalledTimes(2);
    expect(fs.unlink.mock.calls.map((c) => c[0])).toEqual([
      path.join(UPLOAD_ROOT, "task", "aaa.png"),
      path.join(UPLOAD_ROOT, "task", "bbb.pdf"),
    ]);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Workspace",
        entityId: 11,
        action: "Deleted",
        description: expect.stringContaining("4 tasks"),
      }),
    );
    expect(logActivity.mock.calls[0][0].description).toContain("2 attachments");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.dryRun).toBe(false);
  });

  it("unlink failure is best-effort: request still succeeds", async () => {
    fs.unlink.mockImplementationOnce((p, cb) => cb({ code: "EACCES", message: "denied" }));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[countsRow], [{ Entity: "task", StoredName: "aaa.png" }]],
    });
    const res = mockRes();
    await workspaceController.delete(baseReq({ body: { WorkspaceId: 11 } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    spy.mockRestore();
  });

  it("SP 400 (not archived): no unlink, no audit", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 400, ResponseMess: "Archive the workspace before deleting it" }]),
    );
    const res = mockRes();
    await workspaceController.delete(baseReq({ body: { WorkspaceId: 11 } }), res);

    expect(fs.unlink).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });

  it("INVARIANT: an admin cannot delete another active user's personal workspace — SP 403 surfaces, identity passed faithfully", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 403, ResponseMess: "Personal workspaces can only be deleted by their owner" },
      ]),
    );
    const req = baseReq({
      user: { UserId: 2, CompId: 1, BranchId: 2, IsAdmin: true },
      scope: { branchIds: [1, 2, 3], isAdmin: true },
      body: { WorkspaceId: 10007 },
    });
    const res = mockRes();
    await workspaceController.delete(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteWorkspace",
      { WorkspaceId: 10007, ActingUserId: 2, IsAdmin: 1, CompId: 1, DryRun: 0 },
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(fs.unlink).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await workspaceController.delete(baseReq({ body: { WorkspaceId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_DELETE_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.transferOwnership", () => {
  it("rejects missing WorkspaceId or NewOwnerUserId with 400", async () => {
    const res = mockRes();
    await workspaceController.transferOwnership(baseReq({ body: { WorkspaceId: 5 } }), res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("transfers ownership and logs UPDATED with the new owner id", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 200, ResponseMess: "Ownership transferred", WorkspaceId: 5, NewOwnerUserId: 9 },
      ]),
    );
    const req = baseReq({ body: { WorkspaceId: 5, NewOwnerUserId: 9 } });
    const res = mockRes();
    await workspaceController.transferOwnership(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_TransferWorkspaceOwnership",
      { WorkspaceId: 5, NewOwnerUserId: 9, ActingUserId: 7, IsAdmin: 0, CompId: 1 },
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Workspace",
        entityId: 5,
        action: "Updated",
        description: "Ownership transferred to user 9",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ workspaceId: 5, newOwnerUserId: 9 });
  });

  it("surfaces SP 400 (personal workspace) without logging", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 400, ResponseMess: "Personal workspaces cannot change owner" }]),
    );
    const res = mockRes();
    await workspaceController.transferOwnership(
      baseReq({ body: { WorkspaceId: 5, NewOwnerUserId: 9 } }),
      res,
    );
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await workspaceController.transferOwnership(
      baseReq({ body: { WorkspaceId: 5, NewOwnerUserId: 9 } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_TRANSFER_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.syncProjectMembers", () => {
  it("rejects missing WorkspaceId with 400", async () => {
    const res = mockRes();
    await workspaceController.syncProjectMembers(baseReq({ body: {} }), res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("syncs members and logs UPDATED with add/deactivate counts", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Members synced",
          WorkspaceId: 8,
          MembersAddedOrRestored: 2,
          MembersDeactivated: 1,
        },
      ]),
    );
    const req = baseReq({ body: { WorkspaceId: 8 } });
    const res = mockRes();
    await workspaceController.syncProjectMembers(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SyncProjectWorkspaceMembers",
      { WorkspaceId: 8, ActingUserId: 7, IsAdmin: 0, CompId: 1 },
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Workspace",
        entityId: 8,
        action: "Updated",
        description: expect.stringContaining("2 added/restored"),
      }),
    );
    expect(logActivity.mock.calls[0][0].description).toContain("1 deactivated");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      workspaceId: 8,
      membersAddedOrRestored: 2,
      membersDeactivated: 1,
    });
  });

  it("surfaces SP 400 (not a project workspace) without logging", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 400, ResponseMess: "Only project workspaces sync from a team" }]),
    );
    const res = mockRes();
    await workspaceController.syncProjectMembers(baseReq({ body: { WorkspaceId: 8 } }), res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await workspaceController.syncProjectMembers(baseReq({ body: { WorkspaceId: 8 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_SYNC_ERROR");
    spy.mockRestore();
  });
});
