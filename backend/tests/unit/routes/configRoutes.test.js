// backend/tests/unit/routes/configRoutes.test.js
//
// The config route table after 086: the pipeline engine is gone and its four
// routes with it. Writes stay admin-only (they rewrite company-wide
// vocabularies), reads stay open (every form needs its lookups). The
// controller suite tests the handlers; this tests reachability, the gate, the
// exact list, and that the retired routes answer 404.

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
jest.mock("../../../src/controllers/configController", () => ({
  configController: {
    saveCustomField: hit("saveCustomField"),
    fetchCustomFields: hit("fetchCustomFields"),
    deleteCustomField: hit("deleteCustomField"),
    saveLookup: hit("saveLookup"),
    fetchLookups: hit("fetchLookups"),
    deleteLookup: hit("deleteLookup"),
  },
}));

const express = require("express");
const request = require("supertest");
const configRoutes = require("../../../src/routes/configRoutes");
const { configController } = require("../../../src/controllers/configController");

const app = express();
app.use(express.json());
app.use("/api/config", configRoutes);

const asAdmin = () => { mockScope = { isAdmin: true, hierarchyLevel: 1, dataScope: "All", branchIds: [2] }; };
const asAgent = () => { mockScope = { isAdmin: false, hierarchyLevel: 4, dataScope: "Self", branchIds: [2], ownerIds: [7] }; };

beforeEach(() => {
  jest.clearAllMocks();
  asAgent();
});

describe("configRoutes", () => {
  it("exposes exactly the remaining routes, in order", () => {
    const paths = configRoutes.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(paths).toEqual([
      "/saveCustomField",
      "/fetchCustomFields",
      "/deleteCustomField",
      "/saveLookup",
      "/fetchLookups",
      "/deleteLookup",
    ]);
  });

  it.each([
    ["/api/config/fetchCustomFields", { Entity: "ticket" }, "fetchCustomFields"],
    ["/api/config/fetchLookups", { Kind: "ticket_status" }, "fetchLookups"],
  ])("routes the read %s to %s for any authenticated user", async (path, body, handler) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  it.each([
    ["/api/config/saveCustomField", { Entity: "ticket", Label: "Serial no." }, "saveCustomField"],
    ["/api/config/deleteCustomField", { Id: 3 }, "deleteCustomField"],
    ["/api/config/saveLookup", { Kind: "priority", Value: "High", TatHours: 24 }, "saveLookup"],
    ["/api/config/deleteLookup", { Id: 11 }, "deleteLookup"],
  ])("403s a non-admin on the write %s, then lets an admin through to %s", async (path, body, handler) => {
    const denied = await request(app).post(path).send(body);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("INSUFFICIENT_ROLE");
    expect(configController[handler]).not.toHaveBeenCalled();
    asAdmin();
    const ok = await request(app).post(path).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.hit).toBe(handler);
  });

  // 086 drops the pipeline engine and its five SPs; a stale client gets a 404,
  // not a 500 from a procedure that no longer exists.
  it.each([
    "/api/config/savePipeline",
    "/api/config/fetchPipelines",
    "/api/config/saveStage",
    "/api/config/deleteStage",
  ])("no longer serves %s", async (path) => {
    asAdmin();
    const r = await request(app).post(path).send({ Entity: "ticket", Id: 1 });
    expect(r.status).toBe(404);
  });

  it("requires a payload on the writes but not on the reads", async () => {
    asAdmin();
    expect((await request(app).post("/api/config/saveLookup").send({})).status).toBe(400);
    expect((await request(app).post("/api/config/fetchLookups").send({})).status).toBe(200);
  });
});
