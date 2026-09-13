// The report route table after 072: pipelineFunnel is gone (sp_PipelineFunnel
// dropped), leadsByStatus takes its place. This file locks that table down —
// the controller suite tests the handlers, this tests that they are reachable
// and that the retired route is not.

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
jest.mock("../../../src/controllers/reportController", () => ({
  getDashboard: hit("getDashboard"),
  getConvertedSummary: hit("getConvertedSummary"),
  leadsByStatus: hit("leadsByStatus"),
  callsPerUser: hit("callsPerUser"),
  conversionBySource: hit("conversionBySource"),
  ticketsByCategory: hit("ticketsByCategory"),
  resolutionSummary: hit("resolutionSummary"),
  funnel: hit("funnel"),
  followUpCompliance: hit("followUpCompliance"),
  activity: hit("activity"),
  lost: hit("lost"),
  aging: hit("aging"),
  transfers: hit("transfers"),
  pipelineValue: hit("pipelineValue"),
  leaderboard: hit("leaderboard"),
}));

const express = require("express");
const request = require("supertest");
const reportRoutes = require("../../../src/routes/reportRoutes");

const app = express();
app.use(express.json());
app.use("/api/reports", reportRoutes);

describe("reportRoutes", () => {
  it.each([
    ["/api/reports/getDashboard", "getDashboard"],
    ["/api/reports/getConvertedSummary", "getConvertedSummary"],
    // Spec 1 endpoints — kept one release for the web redirects (spec 4a §4).
    ["/api/reports/leadsByStatus", "leadsByStatus"],
    ["/api/reports/callsPerUser", "callsPerUser"],
    ["/api/reports/conversionBySource", "conversionBySource"],
    ["/api/reports/ticketsByCategory", "ticketsByCategory"],
    ["/api/reports/resolutionSummary", "resolutionSummary"],
    // Spec 4a
    ["/api/reports/funnel", "funnel"],
    ["/api/reports/followUpCompliance", "followUpCompliance"],
    ["/api/reports/activity", "activity"],
    ["/api/reports/lost", "lost"],
    ["/api/reports/aging", "aging"],
    ["/api/reports/transfers", "transfers"],
    ["/api/reports/pipelineValue", "pipelineValue"],
    ["/api/reports/leaderboard", "leaderboard"],
  ])("routes %s to the %s handler", async (path, handler) => {
    const r = await request(app).post(path).send({});
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  it("no longer exposes pipelineFunnel", async () => {
    const r = await request(app).post("/api/reports/pipelineFunnel").send({ PipelineId: 3 });
    expect(r.status).toBe(404);
  });
});
