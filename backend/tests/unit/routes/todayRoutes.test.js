let mockAcc;
jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(async () => new Map()), settings: jest.fn(async () => ({})) }));
jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => { req.user = { UserId: 7, CompId: 1, BranchId: 2 }; next(); },
}));
jest.mock("../../../src/middleware/permission", () => ({
  ...jest.requireActual("../../../src/middleware/permission"),
  loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next),
}));

const express = require("express");
const request = require("supertest");
const database = require("../../../src/config/database");
const { mockAccess } = require("../../helpers/mockAccess");

const app = express();
app.use(express.json());
app.use("/api/today", require("../../../src/routes/todayRoutes"));

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
  mockAcc = mockAccess({ modules: [] });
});

describe("todayRoutes", () => {
  it.each(["mine", "team", "teamSize"])("%s is open to any signed-in user with an empty body", async (url) => {
    const r = await request(app).post(`/api/today/${url}`).send({});
    expect(r.status).toBe(200);
  });

  it("personTasks needs a payload", async () => {
    expect((await request(app).post("/api/today/personTasks").send({})).status).toBe(400);
    const r = await request(app).post("/api/today/personTasks").send({ UserId: 7, Bucket: "open" });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ tasks: [] });
  });
});
