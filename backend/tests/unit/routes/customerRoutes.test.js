// Customers are read and written by anyone in the company (spec 2 §3); only
// delete is an admin act. The controller suite tests the handlers, this tests
// that they are reachable, that delete is gated, and that requirePayload sits
// on every route but the list.


let mockAcc;

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
    loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next),
  };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/customerController", () => ({
  save: hit("save"),
  fetch: hit("fetch"),
  detail: hit("detail"),
  delete: hit("delete"),
}));

const { mockAccess } = require("../../helpers/mockAccess");
mockAcc = mockAccess({ modules: [["customers","vaed"]] });

const express = require("express");
const request = require("supertest");
const customerRoutes = require("../../../src/routes/customerRoutes");
const customerController = require("../../../src/controllers/customerController");

const app = express();
app.use(express.json());
app.use("/api/customers", customerRoutes);

const asAdmin = () => { mockAcc = mockAccess({ admin: true }); };
const asAgent = () => { mockAcc = mockAccess({ modules: [["customers", "vaed"]] }); };
const asNoCustomers = () => { mockAcc = mockAccess({ modules: [["leads", "vaed"]] }); };

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

  it("403s every customer route without the customers module, before any controller", async () => {
    asNoCustomers();
    for (const p of ["saveCustomer", "fetchCustomers", "fetchCustomerDetail"]) {
      expect((await request(app).post(`/api/customers/${p}`).send({ Name: "x", CustomerId: 1 })).status).toBe(403);
    }
    expect(customerController.save).not.toHaveBeenCalled();
    expect(customerController.fetch).not.toHaveBeenCalled();
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
