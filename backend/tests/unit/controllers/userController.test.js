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
