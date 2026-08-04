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

const spResult = (rows) => ({ recordsets: [rows] });

describe("userGroupController.save", () => {
  it("400s on an empty payload, before touching the database", async () => {
    const res = mockRes();
    await userGroupController.save(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "No payload found",
      code: "VALIDATION_ERROR",
      data: null,
    });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("calls sp_SaveUserGroup with CompId/BranchId from req.user and logs a create", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Group created", GroupId: 11 }]),
    );
    const res = mockRes();
    await userGroupController.save(
      baseReq({ body: { Name: "Support Agents", Description: "Tier 1" } }),
      res,
    );

    expect(database.executeStoredProcedure.mock.calls[0]).toEqual([
      "sp_SaveUserGroup",
      {
        Id: 0,
        Name: "Support Agents",
        Description: "Tier 1",
        IsActive: true,
        CompId: 5,
        BranchId: 2,
      },
    ]);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      responseCode: 201,
      data: { groupId: 11 },
    });
  });

  // The frontend was migrated from GroupName/GroupDescription to Name/
  // Description; both spellings still arrive, so both must reach the SP.
  it("accepts the legacy GroupName/GroupDescription spelling", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Group updated", GroupId: 11 }]),
    );
    const res = mockRes();
    await userGroupController.save(
      baseReq({ body: { Id: 11, GroupName: "Old Name", GroupDescription: "Old" } }),
      res,
    );

    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      Name: "Old Name",
      Description: "Old",
    });
  });

  it("surfaces a non-2xx from the SP and logs nothing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: "Group name already exists" }]),
    );
    const res = mockRes();
    await userGroupController.save(baseReq({ body: { Name: "Admins" } }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Group name already exists",
      data: null,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // no audit row
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userGroupController.save(baseReq({ body: { Name: "Admins" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_GROUP_SAVE_ERROR");
  });
});

describe("userGroupController.fetch", () => {
  const oneGroup = spResult([
    {
      ResponseCode: 200,
      ResponseMess: "Groups retrieved",
      CurrentPage: 1,
      PageSize: 10,
      TotalRecords: 1,
      TotalPages: 1,
      Id: 3,
      Name: "Admins",
    },
  ]);

  it("defaults paging and passes CompId/BranchId/IsAdmin from req.user", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(oneGroup);
    const res = mockRes();
    await userGroupController.fetch(baseReq({ body: {} }), res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchUserGroup",
      {
        Id: 0,
        CompId: 5,
        BranchId: 2,
        IsAdmin: true,
        PageNumber: 1,
        PageSize: 10,
        SearchTerm: null,
      },
    );
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.userGroups).toEqual([{ Id: 3, Name: "Admins" }]);
    expect(body.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 1,
      totalPages: 1,
    });
  });

  it("survives a missing body entirely", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(oneGroup);
    const res = mockRes();
    await userGroupController.fetch(baseReq({ body: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  /**
   * A page size is a hard ceiling, not a suggestion. `{"PageSize": 999999999}`
   * used to go straight into the SP as a one-line way to ask SQL Server for
   * every group the scope allows.
   */
  it("clamps an absurd PageSize to 200 and a junk PageNumber to 1", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(oneGroup);
    const res = mockRes();
    await userGroupController.fetch(
      baseReq({ body: { PageNumber: "abc", PageSize: 999999999 } }),
      res,
    );

    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      PageNumber: 1,
      PageSize: 200,
    });
  });

  /**
   * REGRESSION, 2026-08-04. fetch used `ResponseCode === 200` while its
   * neighbour save used `< 300`, so an SP returning 201 was a success on one
   * endpoint and a failure on the other — in the same file. spOk is 2xx
   * everywhere now.
   */
  it("treats any 2xx from the SP as success, not just 200", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 206, ResponseMess: "Partial", Id: 3, Name: "Admins" }]),
    );
    const res = mockRes();
    await userGroupController.fetch(baseReq(), res);

    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userGroupController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_GROUP_FETCH_ERROR");
  });
});

describe("userGroupController.delete", () => {
  it("400s on an empty payload, before touching the database", async () => {
    const res = mockRes();
    await userGroupController.delete(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("No payload found");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", { Id: 0 }],
    ["negative", { Id: -1 }],
    ["non-numeric", { Id: "abc" }],
  ])("400s on a %s Id, before touching the database", async (_label, body) => {
    const res = mockRes();
    await userGroupController.delete(baseReq({ body }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Group ID is required",
      code: "VALIDATION_ERROR",
      responseCode: 400,
    });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("deletes scoped by CompId and writes an audit row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Group deleted" }]),
    );
    const res = mockRes();
    await userGroupController.delete(baseReq({ body: { Id: 3 } }), res);

    expect(database.executeStoredProcedure.mock.calls[0]).toEqual([
      "sp_DeleteUserGroup",
      { Id: 3, CompId: 5, BranchId: 2 },
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveActivityLog",
      expect.objectContaining({ EntityType: "UserGroup", EntityId: 3, Action: "Deleted" }),
    );
  });

  it("surfaces the SP's 409 when the group still has users, and logs nothing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: "Cannot delete group - users assigned" }]),
    );
    const res = mockRes();
    await userGroupController.delete(baseReq({ body: { Id: 3 } }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userGroupController.delete(baseReq({ body: { Id: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_GROUP_DELETE_ERROR");
  });
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
