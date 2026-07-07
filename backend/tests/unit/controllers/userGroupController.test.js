jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const userGroupController = require("../../../src/controllers/userGroupController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: true },
    body: {},
    scope: { branchIds: [] },
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

describe("userGroupController.fetchAccess", () => {
  it("400s when GroupId is missing", async () => {
    const res = mockRes();
    await userGroupController.fetchAccess(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("returns the menu matrix for a group, scoped to CompId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          { MenuId: 2, ParentId: 0, Title: "Tasks", Route: "/tasks", CanView: true, CanAdd: true, CanEdit: false, CanDelete: false },
        ],
      ],
    });
    const res = mockRes();
    await userGroupController.fetchAccess(baseReq({ body: { GroupId: 3 } }), res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchGroupAccess",
      { GroupId: 3, CompId: 5 },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.access).toHaveLength(1);
    expect(payload.data.access[0].Title).toBe("Tasks");
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userGroupController.fetchAccess(baseReq({ body: { GroupId: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("userGroupController.saveAccess", () => {
  it("400s when GroupId is missing", async () => {
    const res = mockRes();
    await userGroupController.saveAccess(baseReq({ body: { Access: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("serializes Access to JSON and passes GroupId + CompId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Permissions saved", GroupId: 3 }]],
    });
    const access = [{ MenuId: 2, CanView: 1, CanAdd: 1, CanEdit: 0, CanDelete: 0 }];
    const res = mockRes();
    await userGroupController.saveAccess(baseReq({ body: { GroupId: 3, Access: access } }), res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveGroupAccess",
      { GroupId: 3, AccessJson: JSON.stringify(access), CompId: 5 },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("writes a PermissionChanged audit entry with the granted menu set", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Permissions saved", GroupId: 3 }]],
    });
    const access = [
      { MenuId: 2, CanView: 1, CanAdd: 0, CanEdit: 0, CanDelete: 0 },
      { MenuId: 5, CanView: 0, CanAdd: 0, CanEdit: 0, CanDelete: 0 }, // no grant → excluded
    ];
    const res = mockRes();
    await userGroupController.saveAccess(baseReq({ body: { GroupId: 3, Access: access } }), res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveActivityLog",
      expect.objectContaining({
        EntityType: "UserGroup",
        EntityId: 3,
        Action: "PermissionChanged",
        NewValue: JSON.stringify([2]), // only the granted menu id
        UserId: 7,
      }),
    );
  });

  it("defaults Access to an empty array when omitted", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Permissions saved", GroupId: 3 }]],
    });
    const res = mockRes();
    await userGroupController.saveAccess(baseReq({ body: { GroupId: 3 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveGroupAccess",
      expect.objectContaining({ AccessJson: "[]" }),
    );
  });

  it("propagates a non-2xx SP response (e.g. group not found)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 404, ResponseMess: "Group not found" }]],
    });
    const res = mockRes();
    await userGroupController.saveAccess(baseReq({ body: { GroupId: 999, Access: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
  });
});
