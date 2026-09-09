// The lead route table after 071: stage moves are gone (sp_MoveLeadStage no
// longer exists), status changes go through setLeadStatus, and transfers have
// a bulk sibling. This file locks that table down — the controller suite tests
// the handlers, this tests that they are reachable and that the retired route
// is not.

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
      req.scope = { isAdmin: false, hierarchyLevel: 3, dataScope: "Branch", branchIds: [2] };
      next();
    },
  };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/leadController", () => ({
  save: hit("save"),
  fetch: hit("fetch"),
  detail: hit("detail"),
  setStatus: hit("setStatus"),
  transfer: hit("transfer"),
  bulkTransfer: hit("bulkTransfer"),
  delete: hit("delete"),
}));

const express = require("express");
const request = require("supertest");
const leadRoutes = require("../../../src/routes/leadRoutes");

const app = express();
app.use(express.json());
app.use("/api/leads", leadRoutes);

describe("leadRoutes", () => {
  it.each([
    ["/api/leads/saveLeads", { Name: "Acme" }, "save"],
    ["/api/leads/fetchLeads", { PageNumber: 1 }, "fetch"],
    ["/api/leads/fetchLeadDetail", { LeadId: 9 }, "detail"],
    ["/api/leads/setLeadStatus", { LeadId: 9, StatusId: 6 }, "setStatus"],
    ["/api/leads/transferLead", { LeadId: 9, ToUserId: 3 }, "transfer"],
    ["/api/leads/bulkTransferLeads", { LeadIds: [9] }, "bulkTransfer"],
    ["/api/leads/deleteLeads", { Id: 9 }, "delete"],
  ])("routes %s to the %s handler", async (path, body, handler) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  it("no longer exposes moveLeadStage", async () => {
    const r = await request(app).post("/api/leads/moveLeadStage").send({ LeadId: 9, StageId: 3 });
    expect(r.status).toBe(404);
  });

  it("requires a payload on every route but fetchLeads", async () => {
    expect((await request(app).post("/api/leads/setLeadStatus").send({})).status).toBe(400);
    expect((await request(app).post("/api/leads/bulkTransferLeads").send({})).status).toBe(400);
    expect((await request(app).post("/api/leads/fetchLeads").send({})).status).toBe(200);
  });
});
