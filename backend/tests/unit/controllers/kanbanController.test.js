jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/spHelpers", () => ({
  cleanSpRows: (rows) => rows,
}));

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
        AccessibleBranchIdsJson: null,
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
});
