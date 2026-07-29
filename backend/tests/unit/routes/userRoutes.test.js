// User management routes are admin-only. Without the guard any authenticated
// employee could POST /saveUser with { Id: 0, IsAdmin: true } and mint
// themselves an owner-level account — the endpoint sets IsAdmin from the body.
//
// The gate is req.scope.isAdmin, deliberately NOT requireMinLevel(ADMIN):
// IsAdmin is a role property on tblUserGroups, not a rank, so the level-2
// department heads (Sales/Support/HR) must not slip through.

let mockScope;

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
    loadScope: (req, res, next) => {
      req.scope = mockScope;
      next();
    },
  };
});

jest.mock("../../../src/controllers/userController", () => ({
  save: jest.fn((req, res) => res.status(201).json({ success: true, hit: "save" })),
  fetch: jest.fn((req, res) => res.status(200).json({ success: true, hit: "fetch" })),
  delete: jest.fn((req, res) => res.status(200).json({ success: true, hit: "delete" })),
  updateMyProfile: jest.fn((req, res) => res.status(200).json({ success: true })),
  changeMyPassword: jest.fn((req, res) => res.status(200).json({ success: true })),
  directory: jest.fn((req, res) => res.status(200).json({ success: true })),
}));

const express = require("express");
const request = require("supertest");
const userRoutes = require("../../../src/routes/userRoutes");
const userController = require("../../../src/controllers/userController");

const app = express();
app.use(express.json());
app.use("/api/users", userRoutes);

const asAdmin = () => {
  mockScope = { isAdmin: true, branchIds: [2] };
};
const asEmployee = () => {
  mockScope = { isAdmin: false, hierarchyLevel: 4, branchIds: [2] };
};
const asDepartmentHead = () => {
  // HierarchyLevel 2, but IsAdmin false — a Sales/Support/HR head.
  mockScope = { isAdmin: false, hierarchyLevel: 2, branchIds: [2] };
};

beforeEach(() => {
  jest.clearAllMocks();
  asAdmin();
});

describe("userRoutes admin gate", () => {
  it.each([
    ["/api/users/saveUser", { Username: "x", Password: "y", FullName: "X" }],
    ["/api/users/deleteUser", { Id: 3 }],
  ])("403s a non-admin on %s", async (path, body) => {
    asEmployee();
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("INSUFFICIENT_ROLE");
    expect(userController.save).not.toHaveBeenCalled();
    expect(userController.delete).not.toHaveBeenCalled();
  });

  it("403s a level-2 department head who is not IsAdmin", async () => {
    asDepartmentHead();
    const r = await request(app)
      .post("/api/users/saveUser")
      .send({ Username: "x", Password: "y", FullName: "X", IsAdmin: true });
    expect(r.status).toBe(403);
    expect(userController.save).not.toHaveBeenCalled();
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

  // Reading the roster is not gated — assignee dropdowns across the app need it.
  it("does NOT gate fetchUsers", async () => {
    asEmployee();
    const r = await request(app).post("/api/users/fetchUsers").send({});
    expect(r.status).toBe(200);
    expect(userController.fetch).toHaveBeenCalledTimes(1);
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
