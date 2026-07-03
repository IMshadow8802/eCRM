jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/encryption", () => ({
  comparePassword: jest.fn(),
  hashPassword: jest.fn(),
}));
jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "fake.jwt.token"),
}));

const database = require("../../../src/config/database");
const { comparePassword } = require("../../../src/utils/encryption");
const authController = require("../../../src/controllers/authController");
const { mockRes } = require("../../helpers/mockRes");

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  comparePassword.mockReset();
  process.env.JWT_SECRET = "test-secret";
});

describe("authController.login response shape", () => {
  it("returns user + company keyed PascalCase matching tblUser/tblCompany", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 200,
            ResponseMess: "Login successful",
            UserId: 42,
            UserName: "alice",
            FullName: "Alice Nguyen",
            Email: "alice@example.com",
            JobTitle: "Engineer",
            HourlyRate: 55,
            BranchId: 2,
            CompId: 1,
            IsAdmin: true,
            UserActive: true,
            Password: "bcrypt-hash",
            CompName: "Acme",
            CompAddress: "123 Main",
            CompPhone: "555",
            CompState: "CA",
            CompStateCode: "CA",
            CompEmail: "ops@acme.example",
            CompWebSite: "acme.example",
            CompGSTIN: "GSTIN",
          },
        ],
        [],
      ],
    });
    comparePassword.mockResolvedValueOnce(true);

    const res = mockRes();
    await authController.login(
      { body: { username: "alice", password: "pw" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.user).toEqual({
      Id: 42,
      Username: "alice",
      FullName: "Alice Nguyen",
      Email: "alice@example.com",
      JobTitle: "Engineer",
      HourlyRate: 55,
      BranchId: 2,
      CompId: 1,
      IsAdmin: true,
      IsActive: true,
    });
    expect(payload.data.company).toEqual({
      CompId: 1,
      CompName: "Acme",
      CompAddress: "123 Main",
      CompPhone: "555",
      CompState: "CA",
      CompStateCode: "CA",
      CompEmail: "ops@acme.example",
      CompWebSite: "acme.example",
      CompGSTIN: "GSTIN",
    });
    // Regression guard: no legacy camelCase leaks into the wire payload.
    expect(payload.data.user).not.toHaveProperty("userid");
    expect(payload.data.user).not.toHaveProperty("fullName");
    expect(payload.data.company).not.toHaveProperty("compId");
  });

  it("threads a menu row's Route through to the permissions payload", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 200,
            ResponseMess: "Login successful",
            UserId: 42,
            UserName: "alice",
            UserActive: true,
            Password: "bcrypt-hash",
            CompId: 1,
            BranchId: 2,
          },
        ],
        [
          {
            MenuId: 30,
            ParentId: 0,
            Description: "Support",
            Route: "/support",
            CanView: 1,
          },
          {
            MenuId: 31,
            ParentId: 30,
            Description: "Ticket Board",
            Route: "/support/board",
            CanView: 1,
          },
        ],
      ],
    });
    comparePassword.mockResolvedValueOnce(true);

    const res = mockRes();
    await authController.login({ body: { username: "alice", password: "pw" } }, res);

    const payload = res.json.mock.calls[0][0];
    const raw = payload.data.permissions.rawPermissions;
    expect(raw.find((m) => m.menuid === 31).route).toBe("/support/board");
    expect(raw.find((m) => m.menuid === 30).route).toBe("/support");
  });

  it("rejects wrong password with 401 + WRONG_PASSWORD code (distinct from missing-user)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 200,
            ResponseMess: "ok",
            UserId: 1,
            Password: "bcrypt-hash",
          },
        ],
        [],
      ],
    });
    comparePassword.mockResolvedValueOnce(false);

    const res = mockRes();
    await authController.login(
      { body: { username: "x", password: "wrong" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    const payload = res.json.mock.calls[0][0];
    expect(payload.code).toBe("WRONG_PASSWORD");
    expect(payload.message).toBe("Incorrect password");
  });

  it("returns 404 + USER_NOT_FOUND when sp_ValidateUser reports the username does not exist", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 404,
            ResponseMess: "Username does not exist",
          },
        ],
        [],
      ],
    });

    const res = mockRes();
    await authController.login(
      { body: { username: "ghost", password: "anything" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    const payload = res.json.mock.calls[0][0];
    expect(payload.code).toBe("USER_NOT_FOUND");
    expect(payload.message).toBe("Username does not exist");
    expect(payload.success).toBe(false);
    // bcrypt must NOT run when the user does not exist.
    expect(comparePassword).not.toHaveBeenCalled();
  });

  it("returns 403 + USER_INACTIVE when sp_ValidateUser reports the account is disabled", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 403,
            ResponseMess: "Account is inactive",
          },
        ],
        [],
      ],
    });

    const res = mockRes();
    await authController.login(
      { body: { username: "disabled", password: "anything" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    const payload = res.json.mock.calls[0][0];
    expect(payload.code).toBe("USER_INACTIVE");
    expect(payload.message).toBe("Account is inactive");
    expect(comparePassword).not.toHaveBeenCalled();
  });

  it("rejects missing credentials with 400", async () => {
    const res = mockRes();
    await authController.login({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
  });
});
