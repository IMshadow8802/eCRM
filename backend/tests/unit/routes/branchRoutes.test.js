let mockAcc;
jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => { req.user = { UserId: 7, CompId: 1, BranchId: 2 }; next(); },
}));
jest.mock("../../../src/middleware/permission", () => ({
  ...jest.requireActual("../../../src/middleware/permission"),
  loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next),
}));

const express = require("express");
const request = require("supertest");
const database = require("../../../src/config/database");
const { mockAccess } = require("../../helpers/mockAccess");

const app = express();
app.use(express.json());
app.use("/api/branches", require("../../../src/routes/branchRoutes"));

beforeEach(() => database.executeStoredProcedure.mockReset());

describe("branchRoutes", () => {
  it("lets an admin save an office", async () => {
    mockAcc = mockAccess({ admin: true });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3, ResponseCode: 201, ResponseMess: "Created" }]] });
    const r = await request(app).post("/api/branches/saveBranch").send({ BranchName: "Pune" });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ id: 3 });
  });

  it("403s a non-admin, even with the offices module, before the controller", async () => {
    mockAcc = mockAccess({ modules: [["offices", "vaed"]] });
    const r = await request(app).post("/api/branches/saveBranch").send({ BranchName: "Pune" });
    expect(r.status).toBe(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s an empty payload", async () => {
    mockAcc = mockAccess({ admin: true });
    const r = await request(app).post("/api/branches/saveBranch").send({});
    expect(r.status).toBe(400);
  });
});
