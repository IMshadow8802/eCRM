jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: {
    CREATED: "Created",
    UPDATED: "Updated",
    DELETED: "Deleted",
    PERMISSION_CHANGED: "PermissionChanged",
  },
}));

const database = require("../../../src/config/database");
const { logActivity } = require("../../../src/utils/activityLogger");
const controller = require("../../../src/controllers/userBranchAccessController");
const { mockRes } = require("../../helpers/mockRes");

const spResult = (rows) => ({ recordsets: [rows] });

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: true },
    body: {},
    scope: { branchIds: [2], ownerIds: [] },
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  logActivity.mockClear();
});

describe("userBranchAccessController.save", () => {
  it("grants access with CompId + CreatedBy from the caller and audits it", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Branch access granted", Id: 31 }]),
    );
    const res = mockRes();
    await controller.save(baseReq({ body: { UserId: 9, BranchId: 4 } }), res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveUserBranchAccess",
      {
        Id: 0,
        UserId: 9,
        BranchId: 4,
        CanRead: true,
        CanWrite: false,
        CompId: 5,
        CreatedBy: 7,
      },
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      responseCode: 201,
      data: { id: 31 },
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "UserBranchAccess",
        entityId: 31,
        action: "PermissionChanged",
      }),
    );
  });

  it.each([
    ["no UserId", { BranchId: 4 }],
    ["no BranchId", { UserId: 9 }],
    ["a zero UserId", { UserId: 0, BranchId: 4 }],
    ["a non-numeric BranchId", { UserId: 9, BranchId: "abc" }],
  ])("400s with %s, before touching the database", async (_label, body) => {
    const res = mockRes();
    await controller.save(baseReq({ body }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "UserId and BranchId are required",
      code: "VALIDATION_ERROR",
    });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("surfaces a non-2xx from the SP and audits nothing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 404, ResponseMess: "Branch not found" }]),
    );
    const res = mockRes();
    await controller.save(baseReq({ body: { Id: 3, UserId: 9, BranchId: 4 } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, data: null });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("500s when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await controller.save(baseReq({ body: { UserId: 9, BranchId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_BRANCH_ACCESS_SAVE_ERROR");
  });
});

describe("userBranchAccessController.fetch", () => {
  it("scopes by CompId, defaults paging to 25, and returns the grants", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Branch access retrieved",
          CurrentPage: 1,
          PageSize: 25,
          TotalRecords: 1,
          TotalPages: 1,
          Id: 31,
          BranchId: 4,
        },
      ]),
    );
    const res = mockRes();
    await controller.fetch(baseReq({ body: { UserId: 9 } }), res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchUserBranchAccess",
      { UserId: 9, CompId: 5, PageNumber: 1, PageSize: 25, SearchTerm: null },
    );
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.branchAccess).toEqual([{ Id: 31, BranchId: 4 }]);
    expect(body.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 25,
      totalRecords: 1,
      totalPages: 1,
    });
  });

  it("clamps an absurd PageSize to 200", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const res = mockRes();
    await controller.fetch(baseReq({ body: { UserId: 9, PageSize: 999999 } }), res);

    expect(database.executeStoredProcedure.mock.calls[0][1].PageSize).toBe(200);
  });

  /**
   * This SP's envelope columns are optional, so a row set carrying no
   * ResponseCode must still read as a 200 — unlike every other fetch here,
   * where a missing status row means a malformed response and a 500.
   */
  it("falls back to 200 and derives pagination when the SP sends no envelope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const res = mockRes();
    await controller.fetch(baseReq({ body: { UserId: 9, PageNumber: 2 } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.branchAccess).toEqual([]);
    expect(body.data.pagination).toEqual({
      currentPage: 2,
      pageSize: 25,
      totalRecords: 0,
      totalPages: 1,
    });
  });

  it("400s without a UserId, before touching the database", async () => {
    const res = mockRes();
    await controller.fetch(baseReq({ body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("UserId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("500s when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await controller.fetch(baseReq({ body: { UserId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_BRANCH_ACCESS_FETCH_ERROR");
  });
});

describe("userBranchAccessController.myScope", () => {
  it("hands back what loadScope put on the request", async () => {
    const res = mockRes();
    await controller.myScope(baseReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      message: "Scope retrieved",
      data: { branchIds: [2], ownerIds: [] },
    });
  });

  it("returns null rather than undefined when the request carries no scope", async () => {
    const res = mockRes();
    await controller.myScope(baseReq({ scope: undefined }), res);
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });
});

describe("userBranchAccessController.delete", () => {
  /**
   * REGRESSION, 2026-08-04.
   *
   * `sp_DeleteUserBranchAccess` took a bare @Id and deleted whatever row it
   * named. Its siblings save and fetch both scoped by company; only delete was
   * missed. Since the route is admin-guarded but not tenant-guarded, Company
   * A's admin could revoke Company B's users' branch grants by walking ids.
   *
   * The SP now requires @CompId (069_tenancy_guards.sql). This asserts the
   * controller actually supplies it — without that the SP returns 400 and the
   * feature is simply broken, which is the failure mode this test catches
   * cheaply.
   */
  it("passes the caller's CompId so the delete cannot cross tenants", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Branch access removed" }]],
    });
    const req = baseReq({ body: { Id: 12 } });
    const res = mockRes();

    await controller.delete(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteUserBranchAccess",
      { Id: 12, CompId: 5 },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("surfaces the SP's 404 when the row belongs to another company", async () => {
    // The SP deliberately answers 404 rather than 403 for a foreign row —
    // telling the caller "exists, but not yours" turns the endpoint into an id
    // oracle for probing other tenants.
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 404, ResponseMess: "Branch access not found" }]],
    });
    const req = baseReq({ body: { Id: 999 } });
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("400s without an Id, before touching the database", async () => {
    const req = baseReq({ body: {} });
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("500s when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 12 } });
    const res = mockRes();

    await controller.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});
