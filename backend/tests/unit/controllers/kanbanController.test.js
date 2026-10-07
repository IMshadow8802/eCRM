jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/spHelpers", () => ({
  cleanSpRows: (rows) => rows,
}));

jest.mock("../../../src/realtime/events", () => ({
  ...jest.requireActual("../../../src/realtime/events"),
  emitToWorkspace: jest.fn(),
}));

const { emitToWorkspace } = require("../../../src/realtime/events");
const database = require("../../../src/config/database");
const kanbanController = require("../../../src/controllers/kanbanController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: false },
    body: {},
    ...overrides,
  };
}

const spResult = (rows) => ({ recordsets: [rows] });

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  emitToWorkspace.mockClear();
});

describe("kanbanController.fetch", () => {
  it("returns columns + pagination", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Kanban columns retrieved",
          TotalRecords: 2,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 200,
          Id: 1,
          Title: "To Do",
        },
        { Id: 2, Title: "Done" },
      ]),
    );

    const req = baseReq({ body: { WorkspaceId: 100 } });
    const res = mockRes();
    await kanbanController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchKanbanColumn",
      expect.objectContaining({ WorkspaceId: 100, CompId: 1, BranchId: 2 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data.columns).toHaveLength(2);
    expect(json.data.kanbanColumns).toHaveLength(2);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { WorkspaceId: 100 } });
    const res = mockRes();
    await kanbanController.fetch(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // REGRESSION (B10): columns are gated by workspace membership, so the SP
  // must know who is asking. Branch scope no longer decides anything.
  it("passes the caller's UserId and no branch scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const req = baseReq({ body: { WorkspaceId: 100 }, scope: { branchIds: [9] } });
    await kanbanController.fetch(req, mockRes());
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.UserId).toBe(7);
    expect(params).not.toHaveProperty("AccessibleBranchIdsJson");
  });

  it("defaults everything with no body and an empty result set", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const req = baseReq({ body: undefined, scope: undefined });
    const res = mockRes();
    await kanbanController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchKanbanColumn",
      expect.objectContaining({
        Id: 0,
        WorkspaceId: null,
        UserId: 7, // rewritten 2026-10-07: columns gated by membership, not branch scope
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data.columns).toHaveLength(0);
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 200,
      totalRecords: 0,
      totalPages: 1,
    });
  });
});

describe("kanbanController.save", () => {
  it("rejects missing WorkspaceId with 400", async () => {
    const req = baseReq({ body: { Title: "x" } });
    const res = mockRes();
    await kanbanController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // REGRESSION (B16): IsActive=false "deleted" a column without moving its tasks.
  it.each([false, 0])("rejects IsActive=%p with 400 and never calls the SP", async (v) => {
    const req = baseReq({ body: { Id: 3, WorkspaceId: 100, Title: "x", IsActive: v } });
    const res = mockRes();
    await kanbanController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("does NOT forward IsDone param (migration 030 retires the flag)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Created", ColumnId: 42 }]),
    );
    const req = baseReq({
      body: {
        Id: 0,
        WorkspaceId: 100,
        Title: "New col",
        Color: "#fff",
        SortOrder: 1,
        MaxTasks: null,
        IsActive: true,
        IsDone: true, // caller might still send it — we must strip it
      },
    });
    const res = mockRes();
    await kanbanController.save(req, res);

    const args = database.executeStoredProcedure.mock.calls[0][1];
    expect(args).not.toHaveProperty("IsDone");
    expect(args).toMatchObject({
      WorkspaceId: 100,
      Title: "New col",
      Color: "#fff",
      SortOrder: 1,
      IsActive: true,
      UserId: 7,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    const json = res.json.mock.calls[0][0];
    expect(json.data).toEqual({ columnId: 42 });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({
      body: { WorkspaceId: 100, Title: "x" },
    });
    const res = mockRes();
    await kanbanController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("update without ColumnId in the SP row logs against the body Id", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Updated" }]),
    );
    const req = baseReq({ body: { Id: 9, WorkspaceId: 100, Title: "Ren" } });
    const res = mockRes();
    await kanbanController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data).toEqual({ columnId: undefined });
  });

  it("surfaces an SP error row without data", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Permission denied" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 100, Title: "x" } });
    const res = mockRes();
    await kanbanController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });
});

describe("kanbanController.delete", () => {
  it("rejects missing Id with 400", async () => {
    const req = baseReq({ body: {} });
    const res = mockRes();
    await kanbanController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp_DeleteKanbanColumn with reassign + returns 200 summary", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Deleted",
          TasksMoved: 3,
          ReassignedTo: 5,
        },
      ]),
    );
    const req = baseReq({ body: { Id: 9, ReassignToColumnId: 5 } });
    const res = mockRes();
    await kanbanController.delete(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteKanbanColumn",
      expect.objectContaining({ Id: 9, ReassignToColumnId: 5 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data).toEqual({ tasksMoved: 3, reassignedTo: 5 });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await kanbanController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("defaults TasksMoved/ReassignedTo when the SP row omits them", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Deleted" }]),
    );
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await kanbanController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      tasksMoved: 0,
      reassignedTo: null,
    });
  });

  it("surfaces an SP error row without data", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 404, ResponseMess: "Column not found" }]),
    );
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await kanbanController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });

  // Contract only: the last-column guard lives in the SP, a mocked DB cannot see it.
  it("surfaces the SP's 409 (last column) with no data and no side effects", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: "A board needs at least one column" }]),
    );
    const req = baseReq({ body: { Id: 9, WorkspaceId: 100 } });
    const res = mockRes();
    await kanbanController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.data).toBeNull();
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });
});

// REGRESSION: the controller read req.user.IsAdmin (the login-time token flag)
// instead of req.scope.isAdmin (loadScope, the role's live flag) like every
// other controller — a demoted admin kept column rights until re-login.
describe("kanbanController IsAdmin comes from req.scope, never req.user", () => {
  const adminUser = { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: true };
  const calls = [
    ["fetch", { WorkspaceId: 100 }, spResult([])],
    ["save", { WorkspaceId: 100, Title: "x" }, spResult([{ ResponseCode: 200, ResponseMess: "ok", ColumnId: 3 }])],
    ["delete", { Id: 3, WorkspaceId: 100 }, spResult([{ ResponseCode: 200, ResponseMess: "ok", TasksMoved: 0 }])],
  ];

  it.each(calls)("%s sends IsAdmin 1 when req.scope.isAdmin", async (fn, body, rs) => {
    database.executeStoredProcedure.mockResolvedValueOnce(rs);
    await kanbanController[fn](baseReq({ body, scope: { isAdmin: true } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].IsAdmin).toBe(1);
  });

  it.each(calls)("%s sends IsAdmin 0 when the token says admin but the scope does not", async (fn, body, rs) => {
    database.executeStoredProcedure.mockResolvedValueOnce(rs);
    await kanbanController[fn](baseReq({ user: adminUser, body, scope: { isAdmin: false } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].IsAdmin).toBe(0);
  });

  it("sends IsAdmin 0 with no scope at all", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    await kanbanController.fetch(baseReq({ user: adminUser, body: { WorkspaceId: 100 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].IsAdmin).toBe(0);
  });
});
