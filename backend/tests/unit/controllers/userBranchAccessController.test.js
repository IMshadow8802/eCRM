jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: { CREATED: "Created", UPDATED: "Updated", DELETED: "Deleted" },
}));

const database = require("../../../src/config/database");
const controller = require("../../../src/controllers/userBranchAccessController");
const { mockRes } = require("../../helpers/mockRes");

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
