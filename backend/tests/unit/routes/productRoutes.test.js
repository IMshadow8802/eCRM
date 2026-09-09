// saveProduct/deleteProduct are gated requireMinLevel(HIERARCHY.ADMIN) — Owner,
// Admin and the level-2 department heads maintain the product master; everyone
// below that (Manager/Employee) must not. fetchProducts stays open: every
// screen with a product picker needs the read.

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

jest.mock("../../../src/controllers/productController", () => ({
  save: jest.fn((req, res) => res.status(201).json({ success: true, hit: "save" })),
  fetch: jest.fn((req, res) => res.status(200).json({ success: true, hit: "fetch" })),
  delete: jest.fn((req, res) => res.status(200).json({ success: true, hit: "delete" })),
}));

const express = require("express");
const request = require("supertest");
const productRoutes = require("../../../src/routes/productRoutes");
const productController = require("../../../src/controllers/productController");

const app = express();
app.use(express.json());
app.use("/api/products", productRoutes);

const asAdmin = () => {
  mockScope = { isAdmin: true, hierarchyLevel: 2, branchIds: [2] };
};
const asManager = () => {
  mockScope = { isAdmin: false, hierarchyLevel: 3, branchIds: [2] };
};

beforeEach(() => {
  jest.clearAllMocks();
  asAdmin();
});

describe("productRoutes admin gate", () => {
  it.each([
    ["/api/products/saveProduct", { Name: "TV" }],
    ["/api/products/deleteProduct", { Id: 3 }],
  ])("403s a non-admin on %s", async (path, body) => {
    asManager();
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("INSUFFICIENT_ROLE");
    expect(productController.save).not.toHaveBeenCalled();
    expect(productController.delete).not.toHaveBeenCalled();
  });

  it("lets an admin through to saveProduct", async () => {
    const r = await request(app).post("/api/products/saveProduct").send({ Name: "TV" });
    expect(r.status).toBe(201);
    expect(productController.save).toHaveBeenCalledTimes(1);
  });

  it("lets an admin through to deleteProduct", async () => {
    const r = await request(app).post("/api/products/deleteProduct").send({ Id: 3 });
    expect(r.status).toBe(200);
    expect(productController.delete).toHaveBeenCalledTimes(1);
  });

  // Read path is not gated — pick-lists need it from every hierarchy level.
  it("does NOT gate fetchProducts", async () => {
    asManager();
    const r = await request(app).post("/api/products/fetchProducts").send({});
    expect(r.status).toBe(200);
    expect(productController.fetch).toHaveBeenCalledTimes(1);
  });
});
