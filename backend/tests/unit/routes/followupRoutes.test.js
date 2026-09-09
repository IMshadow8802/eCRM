// The follow-up route table after 071. The old saveFollowup is gone with
// sp_SaveFollowUp; scheduling, completing and skipping are separate acts now.
// The controller suite tests the handlers — this tests they are reachable, that
// the retired route is not, and which routes tolerate an empty body.

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
jest.mock("../../../src/controllers/followupController", () => ({
  schedule: hit("schedule"),
  complete: hit("complete"),
  skip: hit("skip"),
  fetch: hit("fetch"),
  delete: hit("delete"),
}));

const express = require("express");
const request = require("supertest");
const followupRoutes = require("../../../src/routes/followupRoutes");

const app = express();
app.use(express.json());
app.use("/api/followups", followupRoutes);

describe("followupRoutes", () => {
  it.each([
    ["/api/followups/scheduleFollowUp", { LeadId: 9, DueAt: "2026-09-12" }, "schedule"],
    ["/api/followups/completeFollowUp", { Id: 21, Remarks: "Spoke" }, "complete"],
    ["/api/followups/skipFollowUp", { Id: 21, Remarks: "Travelling" }, "skip"],
    ["/api/followups/fetchFollowups", { LeadId: 9 }, "fetch"],
    ["/api/followups/deleteFollowup", { Id: 21 }, "delete"],
  ])("routes %s to the %s handler", async (path, body, handler) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  it("no longer exposes saveFollowup", async () => {
    const r = await request(app).post("/api/followups/saveFollowup").send({ LeadId: 9 });
    expect(r.status).toBe(404);
  });

  it("requires a payload on every route but fetchFollowups", async () => {
    expect((await request(app).post("/api/followups/scheduleFollowUp").send({})).status).toBe(400);
    expect((await request(app).post("/api/followups/completeFollowUp").send({})).status).toBe(400);
    expect((await request(app).post("/api/followups/skipFollowUp").send({})).status).toBe(400);
    expect((await request(app).post("/api/followups/deleteFollowup").send({})).status).toBe(400);
    // The queue view legitimately asks for "everything I can see".
    expect((await request(app).post("/api/followups/fetchFollowups").send({})).status).toBe(200);
  });
});
