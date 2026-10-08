jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: { CREATED: "Created", UPDATED: "Updated", DELETED: "Deleted", PASSWORD_RESET: "PasswordReset" },
}));
jest.mock("../../../src/realtime/events", () => ({
  emitToWorkspace: jest.fn(),
  emitToUser: jest.fn(),
}));
jest.mock("../../../src/utils/encryption", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
}));

const database = require("../../../src/config/database");
const { hashPassword, comparePassword } = require("../../../src/utils/encryption");
const { emitToWorkspace, emitToUser } = require("../../../src/realtime/events");
const { logActivity } = require("../../../src/utils/activityLogger");
const userController = require("../../../src/controllers/userController");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");
const { scopeFor } = require("../../../src/middleware/access");

const spResult = (rows) => ({ recordsets: [rows] });
// sp_FetchGroupModules: RS1 head, RS2 grant rows (the role being handed out).
const roleRs = (rows = [["people", "v", "Own"]], head = {}) => ({ recordsets: [
  [{ ResponseCode: 200, ResponseMess: "ok", CanSeeSensitive: false, IsAdmin: false, ...head }],
  rows.map(([Module, r = "v", Reach = null]) => ({ Module, Reach, CanView: r.includes("v") ? 1 : 0,
    CanAdd: r.includes("a") ? 1 : 0, CanEdit: r.includes("e") ? 1 : 0, CanDelete: r.includes("d") ? 1 : 0 })),
] });
const spCall = (name) => database.executeStoredProcedure.mock.calls.find((c) => c[0] === name)?.[1];
const baseReq = (over = {}) => ({
  user: { UserId: 7, UserName: "alice", CompId: 1, BranchId: 2, IsAdmin: false },
  body: {},
  access: mockAccess({ admin: true }, 7),
  ip: "10.0.0.1",
  headers: { "user-agent": "jest" },
  ...over,
});

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  hashPassword.mockReset();
  comparePassword.mockReset();
  emitToWorkspace.mockReset();
  emitToUser.mockReset();
  logActivity.mockClear();
});

// GroupId is required since 094 (no default role), so every save body below carries one.
describe("userController.save threads Mobile", () => {
  it("passes Mobile through to sp_SaveUser", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", UserId: 9 }]),
    );
    await userController.save(
      baseReq({
        body: {
          GroupId: 16,
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
        body: { GroupId: 16, Username: "bob", Password: "plaintext1", FullName: "Bob" },
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
      baseReq({ body: { GroupId: 16, Id: 5, Username: "bob", FullName: "Bob" } }),
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
      baseReq({ body: { GroupId: 16, Username: "bob", Password: "pw", FullName: "Bob" } }),
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
      baseReq({ body: { GroupId: 16, Username: "bob", Password: "pw", FullName: "Bob" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Username already exists",
      data: null,
    });
  });

  it("passes the last-admin 409 through when the save moves them to a non-admin role", async () => {
    const msg =
      "This is the last active admin. Make someone else an admin before deactivating them or changing their role.";
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: msg }]),
    );
    const res = mockRes();
    await userController.save(
      baseReq({
        body: { Id: 7, GroupId: 16, Username: "alice", FullName: "Alice", UserActive: true },
      }),
      res,
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ Id: 7, GroupId: 16 });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, message: msg });
    expect(logActivity).not.toHaveBeenCalled();
    expect(emitToWorkspace).not.toHaveBeenCalled();
  });
});

describe("userController.fetch", () => {
  it("is company-wide and strips salary/contact for a non-sensitive caller", async () => {
    const full = (Id, BranchId) => ({ Id, BranchId, FullName: `U${Id}`, HourlyRate: 50, Mobile: "9999999999", Email: "a@b.c" });
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        { ResponseCode: 200, ResponseMess: "ok", CurrentPage: 2, PageSize: 10, TotalRecords: 15, TotalPages: 2, ...full(7, 2) },
        { ResponseCode: 200, ResponseMess: "ok", ...full(9, 4) },
      ]),
    );
    const res = mockRes();
    await userController.fetch(
      baseReq({
        body: { PageNumber: 2, PageSize: 10, SearchTerm: "car" },
        access: mockAccess({ modules: [["people", "v", "Office"]] }, 7),
        scope: { isAdmin: false, branchIds: [2] },
      }),
      res,
    );

    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      CompId: 1, PageNumber: 2, PageSize: 10, SearchTerm: "car",
      AccessibleBranchIdsJson: null, IsAdmin: 1,
      SearchSensitive: 0, // I3: no email/mobile search without the sensitive permission
    });
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.pagination).toEqual({ currentPage: 2, pageSize: 10, totalRecords: 15, totalPages: 2 });
    const [me, other] = body.data.users;
    expect(me).toMatchObject({ HourlyRate: 50, Mobile: "9999999999", Email: "a@b.c" });
    expect(other).toMatchObject({ HourlyRate: null, Mobile: null, Email: null });
  });

  it("keeps them for HR within people reach", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", Id: 9, BranchId: 2, HourlyRate: 50, Mobile: "9999999999", Email: "a@b.c" }]),
    );
    const res = mockRes();
    await userController.fetch(
      baseReq({ access: mockAccess({ sensitive: true, modules: [["people", "v", "Office"]] }, 7) }),
      res,
    );
    expect(res.json.mock.calls[0][0].data.users[0]).toMatchObject({ HourlyRate: 50, Mobile: "9999999999" });
    expect(database.executeStoredProcedure.mock.calls[0][1].SearchSensitive).toBe(1);
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

  /**
   * REGRESSION, 2026-08-04. delete sent whatever Id it was handed straight to
   * sp_DeleteUser with no check at all — its siblings deleteTeam and
   * deleteProject both validated, this one did not — so `undefined`, `0` and
   * `"abc"` all reached the procedure and it decided for itself what they
   * meant. The database is the wrong place to answer "you didn't send an id".
   */
  it.each([
    ["missing", {}],
    ["zero", { Id: 0 }],
    ["negative", { Id: -1 }],
    ["non-numeric", { Id: "abc" }],
  ])("400s on a %s Id, before touching the database", async (_label, body) => {
    const res = mockRes();
    await userController.delete(baseReq({ body }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "User ID is required",
      code: "VALIDATION_ERROR",
      responseCode: 400,
    });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
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

  it("401s when the user lookup itself fails, without hashing anything", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 404, ResponseMess: "User not found" }]),
    );
    const res = mockRes();
    await userController.changeMyPassword(
      baseReq({ body: { CurrentPassword: "a", NewPassword: "newpass1" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].code).toBe("AUTH_ERROR");
    expect(comparePassword).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
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

  it("surfaces the profile SP's own failure instead of claiming the password changed", async () => {
    database.executeStoredProcedure
      .mockResolvedValueOnce(
        validateRow({ FullName: "Alice", Avatar: null, Email: null, Mobile: null }),
      )
      .mockResolvedValueOnce(
        spResult([{ ResponseCode: 409, ResponseMess: "Password reuse not allowed" }]),
      );
    comparePassword.mockResolvedValueOnce(true);
    hashPassword.mockResolvedValueOnce("new-hash");

    const res = mockRes();
    await userController.changeMyPassword(
      baseReq({ body: { CurrentPassword: "right", NewPassword: "newpass1" } }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Password reuse not allowed",
      responseCode: 409,
    });
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

describe("userController.save threads ReportsTo", () => {
  it("ReportsTo: absent -> null (keep), 0 -> 0 (clear), 5 -> 5", async () => {
    database.executeStoredProcedure.mockResolvedValue(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", UserId: 9 }]),
    );
    const sent = async (extra) => {
      database.executeStoredProcedure.mockClear();
      await userController.save(
        baseReq({ body: { GroupId: 16, Username: "bob", Password: "h", FullName: "Bob", ...extra } }),
        mockRes(),
      );
      return database.executeStoredProcedure.mock.calls[0][1].ReportsTo;
    };
    expect(await sent({})).toBeNull();
    expect(await sent({ ReportsTo: null })).toBeNull();
    expect(await sent({ ReportsTo: 0 })).toBe(0);
    expect(await sent({ ReportsTo: "0" })).toBe(0);
    expect(await sent({ ReportsTo: 5 })).toBe(5);
  });

  it("surfaces the SP's loop refusal as a 400", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 400, ResponseMess: "Reporting line would loop back to this user" }]),
    );
    const res = mockRes();
    await userController.save(
      baseReq({ body: { GroupId: 16, Id: 4, Username: "bob", FullName: "Bob", ReportsTo: 9 } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/loop/);
  });
});

// assignableUsers reads req.access (the route is open(), so no module guard ran).
const accessReq = (modules, body = {}) => baseReq({ body, access: mockAccess({ modules }, 7) });
const LEADS_OFFICE = [["leads", "v", "Office"]];

describe("userController.assignableUsers", () => {
  it("calls the roster SP with the leads scope by default and strips the envelope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ Id: 3, FullName: "Ravi", BranchId: 2, ResponseCode: 200, ResponseMess: "ok" }]),
    );
    const res = mockRes();
    await userController.assignableUsers(accessReq(LEADS_OFFICE), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchAssignableUsers", {
      UserId: 7, CompId: 1, BranchId: null, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: null,
    });
    expect(res.json.mock.calls[0][0].data.users).toEqual([{ Id: 3, FullName: "Ravi", BranchId: 2 }]);
  });

  it("forwards a destination BranchId for cross-branch pickers", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    await userController.assignableUsers(accessReq(LEADS_OFFICE, { BranchId: "4" }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].BranchId).toBe(4);
  });

  it("uses the scope of the requested module", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    await userController.assignableUsers(
      accessReq([["leads", "v", "Company"], ["complaints", "v", "Own"]], { Module: "complaints" }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]",
    });
  });

  // REGRESSION (I1): old clients send no Module; support roles got 403 from the leads default.
  it("defaults to complaints for a caller without leads view", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    const res = mockRes();
    await userController.assignableUsers(accessReq([["complaints", "v", "Own"]]), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ OwnerIdsJson: "[7]" });
  });

  it("an explicit Module stays strict: leads for a support role is 403", async () => {
    const res = mockRes();
    await userController.assignableUsers(accessReq([["complaints", "v", "Own"]], { Module: "leads" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("rejects an unknown Module with 400", async () => {
    const res = mockRes();
    await userController.assignableUsers(accessReq(LEADS_OFFICE, { Module: "people" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("403s a module the caller lacks", async () => {
    const res = mockRes();
    await userController.assignableUsers(accessReq([["people", "v", "Office"]]), res); // HR: no leads
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("500s on DB error", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await userController.assignableUsers(accessReq(LEADS_OFFICE), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      code: "ASSIGNABLE_USERS_ERROR",
    });
    spy.mockRestore();
  });
});

describe("userController.branches", () => {
  it("returns the branch list", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ Id: 1, BranchName: "Pune" }, { Id: 2, BranchName: "Nashik" }]),
    );
    const res = mockRes();
    await userController.branches(baseReq(), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchBranches", {});
    expect(res.json.mock.calls[0][0].data.branches).toEqual([
      { Id: 1, BranchName: "Pune" }, { Id: 2, BranchName: "Nashik" },
    ]);
  });

  it("500s on DB error", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await userController.branches(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      code: "BRANCHES_ERROR",
    });
    spy.mockRestore();
  });
});

describe("userController.save (094: role, branch, actor, unassign fan-out)", () => {
  const saveBody = (over = {}) => ({
    GroupId: 16, Username: "bob", Password: "h", FullName: "Bob", ...over,
  });
  const run = async (body, rs = [[{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }]], user) => {
    hashPassword.mockResolvedValue("hash");
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: rs });
    const res = mockRes();
    await userController.save(baseReq({ body, ...(user && { user }) }), res);
    return { res, params: database.executeStoredProcedure.mock.calls[0]?.[1] };
  };

  it.each([["missing", undefined], ["zero", 0], ["text", "abc"], ["negative", -1]])(
    "400s with no SP call when GroupId is %s",
    async (_l, GroupId) => {
      const res = mockRes();
      await userController.save(baseReq({ body: saveBody({ GroupId }) }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    },
  );

  it("does not forward IsAdmin from the body", async () => {
    const { params } = await run(saveBody({ IsAdmin: true }));
    expect(params).not.toHaveProperty("IsAdmin");
    expect(params.GroupId).toBe(16);
  });

  it("create: body BranchId wins, else the admin's branch", async () => {
    expect((await run(saveBody({ BranchId: 5 }))).params.BranchId).toBe(5);
    database.executeStoredProcedure.mockReset();
    expect((await run(saveBody())).params.BranchId).toBe(2);
  });

  it("edit: absent or invalid BranchId sends null, a valid one is forwarded", async () => {
    expect((await run(saveBody({ Id: 5 }))).params.BranchId).toBeNull();
    database.executeStoredProcedure.mockReset();
    expect((await run(saveBody({ Id: 5, BranchId: "x" }))).params.BranchId).toBeNull();
    database.executeStoredProcedure.mockReset();
    expect((await run(saveBody({ Id: 5, BranchId: 3 }))).params.BranchId).toBe(3);
  });

  // REGRESSION (task 4 H1): saveUser is guarded by `people`, not admin. sp_SaveUser
  // only refuses a non-admin actor when told @ActorIsAdmin = 0; NULL = legacy admin.
  it.each([["HR (sensitive, people vae)", mockAccess({ sensitive: true, modules: [["people", "vae", "Office"]] }, 7), 0],
    ["an admin", mockAccess({ admin: true }, 7), 1]])(
    "always sends ActorIsAdmin explicitly: %s",
    async (_l, access, expected) => {
      hashPassword.mockResolvedValue("hash");
      database.executeStoredProcedure.mockImplementation(async (sp) => sp === "sp_FetchGroupModules" ? roleRs()
        : { recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }]] });
      const res = mockRes();
      await userController.save(baseReq({ body: saveBody(), access, scope: { ...scopeFor(access, "people", 7), isAdmin: access.isAdmin } }), res);
      expect(spCall("sp_SaveUser").ActorIsAdmin).toBe(expected);
    },
  );

  it("non-admin (HR) cannot save without the sensitive permission", async () => {
    const access = mockAccess({ modules: [["people", "vae", "Office"]] }, 7);
    const res = mockRes();
    await userController.save(baseReq({ body: saveBody(), access }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe("INSUFFICIENT_ROLE");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("non-admin cannot place a user in an office outside people write reach", async () => {
    const access = mockAccess({ sensitive: true, modules: [["people", "vae", "Office"]] }, 7);
    const scope = { canWriteBranchIds: [2], branchIds: [2] };
    const res = mockRes();
    await userController.save(baseReq({ body: saveBody({ BranchId: 4 }), access, scope }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe("FORBIDDEN");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    // inside reach it goes through
    hashPassword.mockResolvedValue("hash");
    database.executeStoredProcedure.mockResolvedValueOnce(roleRs())
      .mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }]] });
    await userController.save(baseReq({ body: saveBody({ BranchId: 2 }), access, scope }), mockRes());
    expect(spCall("sp_SaveUser")).toMatchObject({ BranchId: 2, ActorIsAdmin: 0 });
  });

  describe("non-admin edit checks the target's CURRENT office", () => {
    const hr = () => mockAccess({ sensitive: true, modules: [["people", "vae", "Office"]] }, 7);
    const scope = { canWriteBranchIds: [2], branchIds: [2] };
    const target = (BranchId, GroupId = 16) => ({ recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", Id: 5, BranchId, GroupId }]] });
    const okSave = { recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }]] };
    const edit = (body, access = hr()) => {
      const res = mockRes();
      return userController.save(baseReq({ body: saveBody({ Id: 5, ...body }), access, scope }), res).then(() => res);
    };
    const spNames = () => database.executeStoredProcedure.mock.calls.map((c) => c[0]);

    it("403s an out-of-reach target with no BranchId sent; no hash, no sp_SaveUser", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(target(4));
      const res = await edit({});
      expect(res.status).toHaveBeenCalledWith(403);
      expect(spNames()).toEqual(["sp_FetchUser"]);
      expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
        Id: 5, CompId: 1, IsAdmin: 1, AccessibleBranchIdsJson: null, PageNumber: 1, PageSize: 1, SearchTerm: null });
      expect(hashPassword).not.toHaveBeenCalled();
    });

    it("lets an in-reach target move to an in-reach office", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(target(2)).mockResolvedValueOnce(roleRs()).mockResolvedValueOnce(okSave);
      const res = await edit({ BranchId: 2 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(spNames()).toEqual(["sp_FetchUser", "sp_FetchGroupModules", "sp_SaveUser"]);
    });

    it("403s an out-of-reach target even when the new BranchId is in reach", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(target(4));
      const res = await edit({ BranchId: 2 });
      expect(res.status).toHaveBeenCalledWith(403);
      expect(spNames()).toEqual(["sp_FetchUser"]);
    });

    it("404s a target that is not found", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
      const res = await edit({});
      expect(res.status).toHaveBeenCalledWith(404);
      expect(spNames()).toEqual(["sp_FetchUser"]);
    });

    it("an admin skips the lookup", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(okSave);
      await edit({}, mockAccess({ admin: true }, 7));
      expect(spNames()).toEqual(["sp_SaveUser"]);
    });

    it("a create by a non-admin does no target lookup, only the role check", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(roleRs()).mockResolvedValueOnce(okSave);
      const res = mockRes();
      await userController.save(baseReq({ body: saveBody(), access: hr(), scope }), res);
      expect(spNames()).toEqual(["sp_FetchGroupModules", "sp_SaveUser"]);
    });

    it("logs a distinct PasswordReset entry when a password is supplied on an edit", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(target(2)).mockResolvedValueOnce(roleRs()).mockResolvedValueOnce(okSave);
      await edit({});
      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        entityType: "User", entityId: 5, action: "PasswordReset", description: "Password reset for bob" }));
    });
  });

  it("no PasswordReset entry on create or on an edit without a password", async () => {
    await run(saveBody());
    await run(saveBody({ Id: 5, Password: undefined }));
    expect(logActivity.mock.calls.map((c) => c[0].action)).not.toContain("PasswordReset");
  });

  it("surfaces the SP's 403 when a non-admin assigns an admin role", async () => {
    const { res } = await run(saveBody({ Id: 5 }), [[{ ResponseCode: 403, ResponseMess: "Only an admin can do that" }]]);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, responseCode: 403 });
  });

  it("sends the actor", async () => {
    expect((await run(saveBody())).params.ActorUserId).toBe(7);
  });

  it("fans out realtime refreshes from the unassigned-boards result set", async () => {
    const { res } = await run(saveBody({ Id: 5 }), [
      [{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }],
      [{ WorkspaceId: 40, OwnerUserId: 3, TaskCount: 2 }],
    ]);
    expect(emitToWorkspace).toHaveBeenCalledWith(40, "task-list", expect.anything());
    expect(emitToUser).toHaveBeenCalledWith(3, "notifications", expect.anything());
    expect(res.json.mock.calls[0][0].data.unassignedTasks).toBe(2);
  });

  it("emits nothing and reports 0 when there is no second result set", async () => {
    const { res } = await run(saveBody());
    expect(emitToWorkspace).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.unassignedTasks).toBe(0);
    database.executeStoredProcedure.mockReset();
    const r2 = await run(saveBody(), [[{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }], []]);
    expect(r2.res.json.mock.calls[0][0].data.unassignedTasks).toBe(0);
  });

  it("passes the SP's self-deactivation 400 through, no emits, no activity log", async () => {
    const { res } = await run(saveBody({ Id: 7, UserActive: false }), [
      [{ ResponseCode: 400, ResponseMess: "You cannot deactivate your own account" }],
    ]);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(emitToWorkspace).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("treats a missing UserId in an ok row as no activity log, and tolerates a null TaskCount", async () => {
    await run(saveBody({ Id: 5 }), [
      [{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }],
      [{ WorkspaceId: 1, OwnerUserId: 2, TaskCount: null }],
    ]);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ description: "User bob updated" }));
  });
});

describe("userController admin flag comes from req.scope (per request)", () => {
  it.each([
    ["delete", { Id: 3 }, "sp_DeleteUser"],
  ])("%s sends IsAdmin from scope, not the JWT claim", async (method, body, sp) => {
    for (const [scopeAdmin, jwtAdmin, want] of [[true, false, 1], [false, true, 0]]) {
      database.executeStoredProcedure.mockReset();
      database.executeStoredProcedure.mockResolvedValueOnce(
        spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
      );
      await userController[method](
        baseReq({
          body,
          scope: { isAdmin: scopeAdmin, branchIds: [2] },
          user: { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: jwtAdmin },
        }),
        mockRes(),
      );
      expect(database.executeStoredProcedure.mock.calls[0][0]).toBe(sp);
      expect(database.executeStoredProcedure.mock.calls[0][1].IsAdmin).toBe(want);
    }
  });

  it("delete passes the SP's 409 (user has history) through verbatim, no activity log", async () => {
    const msg = "Cannot delete: this user has leads. Deactivate them instead.";
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: msg }]),
    );
    const res = mockRes();
    await userController.delete(baseReq({ body: { Id: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toBe(msg);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("userController.handover", () => {
  it("400s without an Id, before the DB", async () => {
    const res = mockRes();
    await userController.handover(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("calls the SP with the token's CompId and maps the three result sets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ResponseCode: 200, ResponseMess: "ok", OpenTasks: 3, OpenLeads: 5, OpenTickets: 2, OwnedWorkspaces: 1, DirectReports: 1 }],
        [{ Id: 9, Name: "Ops" }],
        [{ Id: 4, FullName: "Asha" }],
      ],
    });
    const res = mockRes();
    await userController.handover(baseReq({ body: { Id: 11, CompId: 99 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchUserHandover", { UserId: 11, CompId: 1 });
    expect(res.json.mock.calls[0][0].data.handover).toEqual({
      OpenTasks: 3, OpenLeads: 5, OpenTickets: 2, OwnedWorkspaces: 1, DirectReports: 1,
      workspaces: [{ Id: 9, Name: "Ops" }],
      reports: [{ Id: 4, FullName: "Asha" }],
    });
  });

  it("defaults missing counts and result sets to empty/0", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok" }]),
    );
    const res = mockRes();
    await userController.handover(baseReq({ body: { Id: 11 } }), res);
    expect(res.json.mock.calls[0][0].data.handover).toMatchObject({ OpenTasks: 0, workspaces: [], reports: [] });
  });

  it("passes a 404 through", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 404, ResponseMess: "User not found" }]),
    );
    const res = mockRes();
    await userController.handover(baseReq({ body: { Id: 11 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, message: "User not found" });
  });

  it("500s with USER_HANDOVER_ERROR when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await userController.handover(baseReq({ body: { Id: 11 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("USER_HANDOVER_ERROR");
  });
});

describe("userController.save: a non-admin hands out only roles within their own access (I4, M1)", () => {
  // HR: people add/edit at Office + tasks, with the sensitive permission.
  const hr = () => mockAccess({ sensitive: true, modules: [["people", "vae", "Office"], ["tasks", "vae"]] }, 7);
  const scope = { canWriteBranchIds: [2], branchIds: [2] };
  const okSave = { recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", UserId: 5 }]] };
  const target = (Id, GroupId) => ({ recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", Id, BranchId: 2, GroupId }]] });
  const SALES_EXEC = [["leads", "vae", "Own"], ["customers", "va", "Own"], ["people", "v", "Own"]];
  const COLLAB = [["people", "v", "Own"], ["tasks", "vae"]];
  const save = async (body, access = hr()) => {
    hashPassword.mockResolvedValue("hash");
    const res = mockRes();
    await userController.save(baseReq({ body: { GroupId: 20, Username: "bob", FullName: "Bob", ...body }, access, scope }), res);
    return res;
  };
  const spNames = () => database.executeStoredProcedure.mock.calls.map((c) => c[0]);

  it("HR assigning Sales Executive is refused: leads is not in HR's grants", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(roleRs(SALES_EXEC));
    const res = await save({});
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You can only give roles within your own access");
    expect(spCall("sp_FetchGroupModules")).toEqual({ GroupId: 20, CompId: 1 });
    expect(spNames()).not.toContain("sp_SaveUser");
  });

  it("HR assigning Task Collaborator (people:Own, tasks) passes", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(roleRs(COLLAB)).mockResolvedValueOnce(okSave);
    const res = await save({});
    expect(res.status).toHaveBeenCalledWith(200);
    expect(spNames()).toEqual(["sp_FetchGroupModules", "sp_SaveUser"]);
  });

  it("refuses a role with wider people reach than the actor's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(roleRs([["people", "v", "Company"]]));
    expect((await save({})).status).toHaveBeenCalledWith(403);
  });

  it("refuses a sensitive role to an actor without the sensitive permission", async () => {
    // Today the earlier "needs the salary & contact permission" gate already stops
    // this actor; the role check repeats it so relaxing that gate cannot open this.
    database.executeStoredProcedure.mockResolvedValueOnce(roleRs(COLLAB, { CanSeeSensitive: 1 }));
    const access = hr();
    access.canSeeSensitive = false;
    const res = await save({}, access);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(spNames()).not.toContain("sp_SaveUser");
  });

  it("a sensitive role is fine for a sensitive actor when the grants fit", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(roleRs(COLLAB, { CanSeeSensitive: true })).mockResolvedValueOnce(okSave);
    expect((await save({})).status).toHaveBeenCalledWith(200);
  });

  it("404s a role that does not exist", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 404, ResponseMess: "Role not found" }]] });
    expect((await save({})).status).toHaveBeenCalledWith(404);
    expect(spNames()).toEqual(["sp_FetchGroupModules"]);
  });

  it("HR changing its own role is refused before any role lookup", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(target(7, 18));
    const res = await save({ Id: 7, GroupId: 20 });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You cannot change your own role");
    expect(spNames()).toEqual(["sp_FetchUser"]);
  });

  it("HR editing its own profile with the same role: one role fetch, then saves", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(target(7, 18)).mockResolvedValueOnce(roleRs(COLLAB)).mockResolvedValueOnce(okSave);
    const res = await save({ Id: 7, GroupId: 18 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(spNames()).toEqual(["sp_FetchUser", "sp_FetchGroupModules", "sp_SaveUser"]);
  });

  it("HR changing someone else's role to one outside its access is refused (current, then requested role)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(target(5, 18))
      .mockResolvedValueOnce(roleRs(COLLAB)).mockResolvedValueOnce(roleRs(SALES_EXEC));
    const res = await save({ Id: 5, GroupId: 20 });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You can only give roles within your own access");
    expect(spNames()).toEqual(["sp_FetchUser", "sp_FetchGroupModules", "sp_FetchGroupModules"]);
    expect(database.executeStoredProcedure.mock.calls.slice(1).map((c) => c[1].GroupId)).toEqual([18, 20]);
  });

  // Round 2 (takeover): an edit, password reset included, needs the target's CURRENT role inside the editor's access.
  it("HR editing a Sales Executive with no role change is refused; no save", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(target(5, 16)).mockResolvedValueOnce(roleRs(SALES_EXEC));
    const res = await save({ Id: 5, GroupId: 16, Password: "newpass" });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You can only edit people whose role is within your own access");
    expect(spCall("sp_FetchGroupModules")).toEqual({ GroupId: 16, CompId: 1 });
    expect(spNames()).toEqual(["sp_FetchUser", "sp_FetchGroupModules"]);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("HR editing someone whose current role is sensitive is refused when HR lacks sensitive", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(target(5, 18)).mockResolvedValueOnce(roleRs(COLLAB, { CanSeeSensitive: 1 }));
    const access = hr();
    access.canSeeSensitive = false;
    expect((await save({ Id: 5, GroupId: 18 }, access)).status).toHaveBeenCalledWith(403);
  });

  it("HR editing a Task Collaborator (same role) passes with one role fetch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(target(5, 27)).mockResolvedValueOnce(roleRs(COLLAB)).mockResolvedValueOnce(okSave);
    const res = await save({ Id: 5, GroupId: 27 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(spNames()).toEqual(["sp_FetchUser", "sp_FetchGroupModules", "sp_SaveUser"]);
  });

  it("a target whose current role is gone is refused", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(target(5, 27))
      .mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 404, ResponseMess: "Role not found" }]] });
    expect((await save({ Id: 5, GroupId: 27 })).status).toHaveBeenCalledWith(404);
  });

  it("an admin is unaffected: no role lookup, any role, may change their own", async () => {
    database.executeStoredProcedure.mockResolvedValue(okSave);
    const res = await save({ Id: 7, GroupId: 1 }, mockAccess({ admin: true }, 7));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(spNames()).toEqual(["sp_SaveUser"]);
  });

  // M1
  it.each([0, "0"])("a non-admin clearing a manager (ReportsTo %p) is refused", async (ReportsTo) => {
    database.executeStoredProcedure.mockResolvedValueOnce(roleRs(COLLAB)).mockResolvedValueOnce(okSave);
    const res = await save({ ReportsTo });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("Only an administrator can clear a manager");
    expect(spNames()).not.toContain("sp_SaveUser");
  });

  it("an admin may still clear a manager", async () => {
    database.executeStoredProcedure.mockResolvedValue(okSave);
    await save({ ReportsTo: 0 }, mockAccess({ admin: true }, 7));
    expect(spCall("sp_SaveUser").ReportsTo).toBe(0);
  });
});
