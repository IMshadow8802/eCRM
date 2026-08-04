jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: { CREATED: "Created", UPDATED: "Updated", DELETED: "Deleted" },
}));
jest.mock("../../../src/utils/encryption", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
}));

const database = require("../../../src/config/database");
const { hashPassword, comparePassword } = require("../../../src/utils/encryption");
const userController = require("../../../src/controllers/userController");
const { mockRes } = require("../../helpers/mockRes");

const spResult = (rows) => ({ recordsets: [rows] });
const baseReq = (over = {}) => ({
  user: { UserId: 7, UserName: "alice", CompId: 1, BranchId: 2, IsAdmin: false },
  body: {},
  ip: "10.0.0.1",
  headers: { "user-agent": "jest" },
  ...over,
});

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  hashPassword.mockReset();
  comparePassword.mockReset();
});

describe("userController.save threads Mobile", () => {
  it("passes Mobile through to sp_SaveUser", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", UserId: 9 }]),
    );
    await userController.save(
      baseReq({
        body: {
          Username: "bob",
          Password: "h",
          FullName: "Bob",
          Mobile: "9998887777",
        },
      }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      Username: "bob",
      Mobile: "9998887777",
    });
  });
});

// Regression: /api/auth/hashPassword was removed as a bcrypt oracle in 978885f
// and nothing replaced it here, so save() wrote whatever the admin typed into
// tblUser.Password as plaintext. Login bcrypt-compares against that column, so
// every user created through the admin screen was locked out of their account.
describe("userController.save hashes the password", () => {
  it("bcrypt-hashes a supplied password before it reaches the SP", async () => {
    hashPassword.mockResolvedValueOnce("$2b$12$hashed");
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", UserId: 9 }]),
    );

    await userController.save(
      baseReq({
        body: { Username: "bob", Password: "plaintext1", FullName: "Bob" },
      }),
      mockRes(),
    );

    expect(hashPassword).toHaveBeenCalledWith("plaintext1");
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.Password).toBe("$2b$12$hashed");
    expect(params.Password).not.toBe("plaintext1");
  });

  it("sends null when editing with a blank password, so the SP keeps the current hash", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }]),
    );

    await userController.save(
      baseReq({ body: { Id: 5, Username: "bob", FullName: "Bob" } }),
      mockRes(),
    );

    expect(hashPassword).not.toHaveBeenCalled();
    expect(database.executeStoredProcedure.mock.calls[0][1].Password).toBeNull();
  });
});

describe("userController.save error handling", () => {
  it("500s when the SP throws", async () => {
    hashPassword.mockResolvedValueOnce("$2b$12$x");
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userController.save(
      baseReq({ body: { Username: "bob", Password: "pw", FullName: "Bob" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_SAVE_ERROR");
  });

  it("passes the SP's rejection straight through without logging activity", async () => {
    hashPassword.mockResolvedValueOnce("$2b$12$x");
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: "Username already exists" }]),
    );
    const res = mockRes();
    await userController.save(
      baseReq({ body: { Username: "bob", Password: "pw", FullName: "Bob" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Username already exists",
      data: null,
    });
  });
});

describe("userController.fetch", () => {
  it("scopes by req.scope.branchIds and returns users + pagination", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "ok",
          CurrentPage: 2,
          PageSize: 10,
          TotalRecords: 15,
          TotalPages: 2,
          Id: 3,
          Username: "carol",
        },
      ]),
    );
    const res = mockRes();
    await userController.fetch(
      baseReq({
        body: { PageNumber: 2, PageSize: 10, SearchTerm: "car" },
        scope: { branchIds: [2, 5] },
      }),
      res,
    );

    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      CompId: 1,
      PageNumber: 2,
      PageSize: 10,
      SearchTerm: "car",
      AccessibleBranchIdsJson: "[2,5]",
    });
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.pagination).toEqual({
      currentPage: 2,
      pageSize: 10,
      totalRecords: 15,
      totalPages: 2,
    });
  });

  /**
   * REGRESSION, 2026-08-04. This asserted `null` and was named for it, which
   * made the bug look like the specification.
   *
   * sp_FetchUser gates on `@UseScope`, and NULL sets that to 0 — "apply no
   * branch filter". So the user with the narrowest possible scope saw the
   * widest possible list. `'[]'` keeps @UseScope at 1 against an empty
   * allow-list, which matches nothing.
   */
  it("sends an empty allow-list, not null, when scope carries no branches", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    await userController.fetch(baseReq({ scope: { branchIds: [] } }), mockRes());
    expect(
      database.executeStoredProcedure.mock.calls[0][1].AccessibleBranchIdsJson,
    ).toBe("[]");
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_FETCH_ERROR");
  });
});

describe("userController.delete", () => {
  it("passes RequestingUserId so the SP can block self-deletion", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "User deleted" }]),
    );
    const res = mockRes();
    await userController.delete(baseReq({ body: { Id: 12 } }), res);

    expect(database.executeStoredProcedure.mock.calls[0][0]).toBe("sp_DeleteUser");
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      Id: 12,
      CompId: 1,
      RequestingUserId: 7,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("surfaces an SP refusal without claiming success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Cannot delete yourself" }]),
    );
    const res = mockRes();
    await userController.delete(baseReq({ body: { Id: 7 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_DELETE_ERROR");
  });
});

describe("userController.updateMyProfile", () => {
  it("updates the CALLER only (req.user.UserId), never a body id", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Profile updated" }]),
    );
    const res = mockRes();
    await userController.updateMyProfile(
      baseReq({
        body: {
          Id: 999,
          FullName: "Alice New",
          Avatar: "icon:star|amber",
          Email: "alice@new.com",
          Mobile: "9990001111",
        },
      }),
      res,
    );
    const args = database.executeStoredProcedure.mock.calls[0];
    expect(args[0]).toBe("sp_UpdateOwnProfile");
    expect(args[1]).toMatchObject({
      UserId: 7, // the caller, NOT the body's 999
      FullName: "Alice New",
      Avatar: "icon:star|amber",
      Email: "alice@new.com",
      Mobile: "9990001111",
      NewPasswordHash: null, // profile edit never touches the password
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("surfaces the SP's 409 when the email/mobile is already in use", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: "Email already in use" }]),
    );
    const res = mockRes();
    await userController.updateMyProfile(
      baseReq({ body: { FullName: "A", Email: "taken@x.com" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toBe("Email already in use");
  });

  it("500s when the DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await userController.updateMyProfile(baseReq({ body: { FullName: "X" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});

describe("userController.changeMyPassword", () => {
  const validateRow = (over = {}) =>
    spResult([
      {
        ResponseCode: 200,
        UserId: 7,
        FullName: "Alice",
        Avatar: "emoji:🚀",
        Password: "current-hash",
        ...over,
      },
    ]);

  it("400s when either password is missing", async () => {
    const res = mockRes();
    await userController.changeMyPassword(
      baseReq({ body: { CurrentPassword: "a" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("401s when the current password is wrong (no write happens)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(validateRow());
    comparePassword.mockResolvedValueOnce(false);
    const res = mockRes();
    await userController.changeMyPassword(
      baseReq({ body: { CurrentPassword: "wrong", NewPassword: "newpass1" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].code).toBe("WRONG_PASSWORD");
    // only the read ran; no sp_UpdateOwnProfile write
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("hashes the new password and writes it, keeping current name+avatar", async () => {
    database.executeStoredProcedure
      .mockResolvedValueOnce(validateRow()) // sp_ValidateUser read
      .mockResolvedValueOnce(
        spResult([{ ResponseCode: 200, ResponseMess: "Profile updated" }]),
      ); // sp_UpdateOwnProfile write
    comparePassword.mockResolvedValueOnce(true);
    hashPassword.mockResolvedValueOnce("new-hash");

    const res = mockRes();
    await userController.changeMyPassword(
      baseReq({ body: { CurrentPassword: "right", NewPassword: "newpass1" } }),
      res,
    );

    expect(hashPassword).toHaveBeenCalledWith("newpass1");
    const writeArgs = database.executeStoredProcedure.mock.calls[1];
    expect(writeArgs[0]).toBe("sp_UpdateOwnProfile");
    expect(writeArgs[1]).toMatchObject({
      UserId: 7,
      FullName: "Alice", // unchanged
      Avatar: "emoji:🚀", // unchanged
      NewPasswordHash: "new-hash",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Password changed");
  });

  it("rejects a too-short new password", async () => {
    const res = mockRes();
    await userController.changeMyPassword(
      baseReq({ body: { CurrentPassword: "a", NewPassword: "123" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Regression: the lookup used req.user.UserName, a JWT claim minted at login.
  // After an admin renamed the user that claim matched no row, so they got a
  // 401 on their own password change until they logged out and back in.
  it("resolves the caller by UserId, not the mutable UserName claim", async () => {
    database.executeStoredProcedure
      .mockResolvedValueOnce(validateRow())
      .mockResolvedValueOnce(
        spResult([{ ResponseCode: 200, ResponseMess: "Profile updated" }]),
      );
    comparePassword.mockResolvedValueOnce(true);
    hashPassword.mockResolvedValueOnce("new-hash");

    await userController.changeMyPassword(
      baseReq({
        // stale claim: an admin renamed this user since they logged in
        user: {
          UserId: 7,
          UserName: "old-name",
          CompId: 1,
          BranchId: 2,
          IsAdmin: false,
        },
        body: { CurrentPassword: "right", NewPassword: "newpass1" },
      }),
      mockRes(),
    );

    const readArgs = database.executeStoredProcedure.mock.calls[0];
    expect(readArgs[0]).toBe("sp_ValidateUser");
    expect(readArgs[1]).toEqual({ UserId: 7 });
    expect(readArgs[1].identifier).toBeUndefined();
  });
});

describe("userController.directory", () => {
  it("returns the company roster from sp_FetchUserDirectory", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { Id: 1, FullName: "Alice", Avatar: "emoji:🚀" },
        { Id: 2, FullName: "Bob", Avatar: null },
      ]),
    );
    const res = mockRes();
    await userController.directory(baseReq(), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchUserDirectory",
      { CompId: 1 },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.users).toHaveLength(2);
  });

  it("500s on DB error", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await userController.directory(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});
