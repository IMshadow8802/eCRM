// The report route table. The controller suite tests the handlers; this tests
// that they are reachable and that the retired routes are not.

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
jest.mock("../../../src/controllers/reportController", () => ({
  getDashboard: hit("getDashboard"),
  ticketsByCategory: hit("ticketsByCategory"),
  resolutionSummary: hit("resolutionSummary"),
  tat: hit("tat"),
  tatClocks: hit("tatClocks"),
  sales: hit("sales"),
  salesRows: hit("salesRows"),
}));
jest.mock("../../../src/controllers/attendanceReport", () => ({
  attendance: jest.fn((req, res) => res.status(200).json({ success: true, hit: "attendance" })),
}));

const { mockAccess } = require("../../helpers/mockAccess");
mockAcc = mockAccess({ modules: [["dashboard"],["support_reports"],["sales_reports"]] });

const express = require("express");
const request = require("supertest");
const reportRoutes = require("../../../src/routes/reportRoutes");

const app = express();
app.use(express.json());
app.use("/api/reports", reportRoutes);

describe("reportRoutes", () => {
  it.each([
    ["/api/reports/getDashboard", "getDashboard"],
    ["/api/reports/ticketsByCategory", "ticketsByCategory"],
    ["/api/reports/resolutionSummary", "resolutionSummary"],
    // Sales reports rebuild
    ["/api/reports/sales", "sales"],
    ["/api/reports/salesRows", "salesRows"],
  ])("routes %s to the %s handler", async (path, handler) => {
    const r = await request(app).post(path).send({});
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  // P4 Team Reports are open(): the data is scoped, so a role with no report grant still reaches them.
  it.each([
    ["/api/reports/tat", "tat"],
    ["/api/reports/tatClocks", "tatClocks"],
    ["/api/reports/attendance", "attendance"],
  ])("routes %s to %s for a role with no report modules", async (path, handler) => {
    const saved = mockAcc;
    mockAcc = mockAccess({ modules: [["tasks", "v"]] });
    const r = await request(app).post(path).send({});
    mockAcc = saved;
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  // HR holds `people` only: no dashboard / support / sales report grants.
  it.each([
    ["/api/reports/sales", "sales"],
    ["/api/reports/salesRows", "salesRows"],
    ["/api/reports/ticketsByCategory", "ticketsByCategory"],
    ["/api/reports/getDashboard", "getDashboard"],
  ])("403s HR (people only) on %s without reaching the controller", async (path, handler) => {
    const saved = mockAcc;
    mockAcc = mockAccess({ modules: [["people", "vaed"]] });
    const r = await request(app).post(path).send({});
    mockAcc = saved;
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("INSUFFICIENT_ROLE");
    expect(require("../../../src/controllers/reportController")[handler]).not.toHaveBeenCalled();
  });

  it("splits the three report modules: a sales_reports grant does not open support reports", async () => {
    const saved = mockAcc;
    mockAcc = mockAccess({ modules: [["sales_reports"]] });
    expect((await request(app).post("/api/reports/sales").send({})).status).toBe(200);
    expect((await request(app).post("/api/reports/salesRows").send({})).status).toBe(200);
    expect((await request(app).post("/api/reports/resolutionSummary").send({})).status).toBe(403);
    expect((await request(app).post("/api/reports/getDashboard").send({})).status).toBe(403);
    mockAcc = saved;
  });

  it("no longer exposes pipelineFunnel", async () => {
    const r = await request(app).post("/api/reports/pipelineFunnel").send({ PipelineId: 3 });
    expect(r.status).toBe(404);
  });

  // Deleted 2026-09-13. sp_CallsPerUser and friends scope by BRANCH only, so a
  // Self-scope rep could read every colleague's call volume through them — a
  // softer path to data the spec-4a procs guard with branch AND owner scope.
  // They were kept "one release for the web redirects", but those redirects are
  // client-side routes that never call the API, and grep found zero callers in
  // web/ or mobile/. sp_ConvertedSummary additionally referenced columns that
  // no longer exist, so it threw on every call.
  it.each([
    ["/api/reports/getConvertedSummary"],
    ["/api/reports/leadsByStatus"],
    ["/api/reports/callsPerUser"],
    ["/api/reports/conversionBySource"],
    // Replaced by /sales + /salesRows (sql/122 drops their procs).
    ["/api/reports/funnel"],
    ["/api/reports/followUpCompliance"],
    ["/api/reports/activity"],
    ["/api/reports/lost"],
    ["/api/reports/aging"],
    ["/api/reports/transfers"],
    ["/api/reports/pipelineValue"],
    ["/api/reports/leaderboard"],
    ["/api/reports/partners"],
  ])("no longer serves %s", async (path) => {
    const res = await request(app).post(path).send({});
    expect(res.status).toBe(404);
  });
});
