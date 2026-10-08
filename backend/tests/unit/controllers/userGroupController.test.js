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

describe("userGroupController.fetchModules", () => {
  it("400s without a GroupId", async () => {
    const res = mockRes();
    await userGroupController.fetchModules(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("maps both result sets", async () => {
    const mods = [{ Module: "leads", CanView: 1, CanAdd: 0, CanEdit: 0, CanDelete: 0, Reach: "Office" }];
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", CanSeeSensitive: 1, IsAdmin: 0 }], mods],
    });
    const res = mockRes();
    await userGroupController.fetchModules(baseReq({ body: { GroupId: 3 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchGroupModules", { GroupId: 3, CompId: 5 });
    expect(res.json.mock.calls[0][0].data).toEqual({ modules: mods, canSeeSensitive: true, isAdmin: false });
  });

  it("tolerates a missing second result set", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", CanSeeSensitive: false, IsAdmin: true }]],
    });
    const res = mockRes();
    await userGroupController.fetchModules(baseReq({ body: { GroupId: 3 } }), res);
    expect(res.json.mock.calls[0][0].data).toEqual({ modules: [], canSeeSensitive: false, isAdmin: true });
  });

  it("surfaces the SP's 404", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 404, ResponseMess: "Role not found" }]] });
    const res = mockRes();
    await userGroupController.fetchModules(baseReq({ body: { GroupId: 99 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, message: "Role not found" });
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userGroupController.fetchModules(baseReq({ body: { GroupId: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("ROLE_MODULES_ERROR");
  });
});

describe("userGroupController.saveModules", () => {
  const modules = [{ Module: "leads", CanView: 1, CanAdd: 1, CanEdit: 0, CanDelete: 0, Reach: "Team" }];

  it("sends ModulesJson and CanSeeSensitive", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([{ Id: 3, ResponseCode: 200, ResponseMess: "Saved" }]));
    const res = mockRes();
    await userGroupController.saveModules(baseReq({ body: { GroupId: 3, Modules: modules, CanSeeSensitive: true } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveGroupModules", {
      GroupId: 3, CompId: 5, ModulesJson: JSON.stringify(modules), CanSeeSensitive: 1,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, data: { groupId: 3 } });
  });

  it("defaults CanSeeSensitive to 0", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([{ Id: 3, ResponseCode: 200, ResponseMess: "Saved" }]));
    await userGroupController.saveModules(baseReq({ body: { GroupId: 3, Modules: [] } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ CanSeeSensitive: 0, ModulesJson: "[]" });
  });

  it("saveModules 400s when Modules is not an array", async () => {
    const res = mockRes();
    await userGroupController.saveModules(baseReq({ body: { GroupId: 3, Modules: "leads" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("surfaces an SP refusal with data null", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([{ ResponseCode: 404, ResponseMess: "Role not found" }]));
    const res = mockRes();
    await userGroupController.saveModules(baseReq({ body: { GroupId: 9, Modules: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, data: null });
  });

  it("writes a PermissionChanged audit row on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([{ Id: 3, ResponseCode: 200, ResponseMess: "Saved" }]));
    await userGroupController.saveModules(baseReq({ body: { GroupId: 3, Modules: modules } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveActivityLog",
      expect.objectContaining({ EntityType: "UserGroup", EntityId: 3, Action: "PermissionChanged" }),
    );
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userGroupController.saveModules(baseReq({ body: { GroupId: 3, Modules: [] } }), res);
    expect(res.json.mock.calls[0][0].code).toBe("ROLE_MODULES_SAVE_ERROR");
  });
});
