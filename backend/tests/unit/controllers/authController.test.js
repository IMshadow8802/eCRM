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

  it("rejects invalid password with 401", async () => {
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
    expect(res.json.mock.calls[0][0].code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects missing credentials with 400", async () => {
    const res = mockRes();
    await authController.login({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
  });
});
