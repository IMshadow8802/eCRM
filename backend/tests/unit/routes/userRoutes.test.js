// User routes: saveUser needs the people module (HR holds it, IsAdmin or not);
// deleteUser / fetchUserHandover stay IsAdmin-only (requireAdmin reads
// req.access.isAdmin). Without a guard any employee could POST
// { Id: 0, IsAdmin: true } and mint an owner-level account.

let mockAcc;

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    req.user = { UserId: 7, CompId: 1, BranchId: 2 };
    next();
  },
}));

jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return {
    ...actual,
    loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next),
  };
});

jest.mock("../../../src/controllers/userController", () => ({
  save: jest.fn((req, res) => res.status(201).json({ success: true, hit: "save" })),
  fetch: jest.fn((req, res) => res.status(200).json({ success: true, hit: "fetch" })),
  delete: jest.fn((req, res) => res.status(200).json({ success: true, hit: "delete" })),
  updateMyProfile: jest.fn((req, res) => res.status(200).json({ success: true })),
  changeMyPassword: jest.fn((req, res) => res.status(200).json({ success: true })),
  directory: jest.fn((req, res) => res.status(200).json({ success: true })),
  assignableUsers: jest.fn((req, res) => res.status(200).json({ success: true })),
  branches: jest.fn((req, res) => res.status(200).json({ success: true })),
  handover: jest.fn((req, res) => res.status(200).json({ success: true, hit: "handover" })),
}));

const { mockAccess } = require("../../helpers/mockAccess");
mockAcc = mockAccess({ modules: [] });

const express = require("express");
const request = require("supertest");
const userRoutes = require("../../../src/routes/userRoutes");
const userController = require("../../../src/controllers/userController");

const app = express();
app.use(express.json());
app.use("/api/users", userRoutes);

const asAdmin = () => {
  mockAcc = mockAccess({ admin: true });
};
const asEmployee = () => {
  mockAcc = mockAccess({ modules: [["leads", "vaed"]] });
};
const asDepartmentHead = () => {
  // Not IsAdmin, but holds the people module (an HR head): may saveUser, never the admin-only routes.
  mockAcc = mockAccess({ modules: [["people", "vaed"]] });
};

beforeEach(() => {
  jest.clearAllMocks();
  asAdmin();
});

describe("userRoutes admin gate", () => {
  it.each([
    ["/api/users/saveUser", { Username: "x", Password: "y", FullName: "X" }],
    ["/api/users/deleteUser", { Id: 3 }],
    ["/api/users/fetchUserHandover", { Id: 3 }],
  ])("403s a non-admin on %s", async (path, body) => {
    asEmployee();
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("INSUFFICIENT_ROLE");
    expect(userController.save).not.toHaveBeenCalled();
    expect(userController.delete).not.toHaveBeenCalled();
    expect(userController.handover).not.toHaveBeenCalled();
  });

  it("403s a department head on fetchUserHandover and lets an admin through", async () => {
    asDepartmentHead();
    expect((await request(app).post("/api/users/fetchUserHandover").send({ Id: 3 })).status).toBe(403);
    asAdmin();
    expect((await request(app).post("/api/users/fetchUserHandover").send({ Id: 3 })).status).toBe(200);
    expect(userController.handover).toHaveBeenCalledTimes(1);
  });

  it("403s a head without the people module on saveUser", async () => {
    mockAcc = mockAccess({ modules: [["leads", "vaed"]] });
    const r = await request(app)
      .post("/api/users/saveUser")
      .send({ Username: "x", Password: "y", FullName: "X", IsAdmin: true });
    expect(r.status).toBe(403);
    expect(userController.save).not.toHaveBeenCalled();
  });

  it("lets a non-admin with the people module through to saveUser, not deleteUser", async () => {
    asDepartmentHead();
    const r = await request(app).post("/api/users/saveUser").send({ Username: "x", Password: "y", FullName: "X" });
    expect(r.status).toBe(201);
    expect((await request(app).post("/api/users/deleteUser").send({ Id: 3 })).status).toBe(403);
  });

  it("lets a real admin through to saveUser", async () => {
    const r = await request(app)
      .post("/api/users/saveUser")
      .send({ Username: "x", Password: "y", FullName: "X" });
    expect(r.status).toBe(201);
    expect(userController.save).toHaveBeenCalledTimes(1);
  });

  it("lets a real admin through to deleteUser", async () => {
    const r = await request(app).post("/api/users/deleteUser").send({ Id: 3 });
    expect(r.status).toBe(200);
    expect(userController.delete).toHaveBeenCalledTimes(1);
  });

  // Reading the roster is not gated — assignee dropdowns and transfer
  // pick-lists across the app need it.
  it.each([
    ["/api/users/fetchUsers", "fetch"],
    ["/api/users/fetchAssignableUsers", "assignableUsers"],
    ["/api/users/fetchBranches", "branches"],
  ])("does NOT gate %s", async (path, method) => {
    asEmployee();
    const r = await request(app).post(path).send({});
    expect(r.status).toBe(200);
    expect(userController[method]).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/api/users/me/updateProfile", { FullName: "Me" }],
    ["/api/users/me/changePassword", { CurrentPassword: "a", NewPassword: "bbbbbb" }],
    ["/api/users/directory", {}],
  ])("does NOT gate the self-service route %s", async (path, body) => {
    asEmployee();
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
  });
});
