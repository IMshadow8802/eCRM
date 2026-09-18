// Customers are read and written by anyone in the company (spec 2 §3); only
// delete is an admin act. The controller suite tests the handlers, this tests
// that they are reachable, that delete is gated, and that requirePayload sits
// on every route but the list.

let mockScope;

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    req.user = { UserId: 7, CompId: 5, BranchId: 2 };
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

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/customerController", () => ({
  save: hit("save"),
  fetch: hit("fetch"),
  detail: hit("detail"),
  delete: hit("delete"),
}));

const express = require("express");
const request = require("supertest");
const customerRoutes = require("../../../src/routes/customerRoutes");
const customerController = require("../../../src/controllers/customerController");

const app = express();
app.use(express.json());
app.use("/api/customers", customerRoutes);

const asAdmin = () => { mockScope = { isAdmin: true, hierarchyLevel: 1, dataScope: "All", branchIds: [2] }; };
const asAgent = () => { mockScope = { isAdmin: false, hierarchyLevel: 4, dataScope: "Self", branchIds: [2], ownerIds: [7] }; };

beforeEach(() => {
  jest.clearAllMocks();
  asAgent();
});

describe("customerRoutes", () => {
  it.each([
    ["/api/customers/saveCustomer", { Name: "Acme", Mobile: "9" }, "save"],
    ["/api/customers/fetchCustomers", {}, "fetch"],
    ["/api/customers/fetchCustomerDetail", { CustomerId: 31 }, "detail"],
  ])("routes %s to the %s handler for any authenticated user", async (path, body, handler) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  it("403s deleteCustomer for a non-admin without reaching the controller", async () => {
    const r = await request(app).post("/api/customers/deleteCustomer").send({ Id: 31 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("INSUFFICIENT_ROLE");
    expect(customerController.delete).not.toHaveBeenCalled();
  });

  it("lets an admin through to deleteCustomer", async () => {
    asAdmin();
    const r = await request(app).post("/api/customers/deleteCustomer").send({ Id: 31 });
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe("delete");
  });

  it("requires a payload on every route but fetchCustomers", async () => {
    expect((await request(app).post("/api/customers/saveCustomer").send({})).status).toBe(400);
    expect((await request(app).post("/api/customers/fetchCustomerDetail").send({})).status).toBe(400);
    asAdmin();
    expect((await request(app).post("/api/customers/deleteCustomer").send({})).status).toBe(400);
    expect((await request(app).post("/api/customers/fetchCustomers").send({})).status).toBe(200);
  });
});
