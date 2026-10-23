// devlens + Docker poll GET /health; while SQL Server is down the API must still
// answer — /health with 503 + the error code, every /api call with a clean 503.
jest.mock("../../../src/config/database", () => ({
  health: jest.fn(),
  testConnection: jest.fn(),
  executeStoredProcedure: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const database = require("../../../src/config/database");
const { setupRoutes } = require("../../../src/config/routes");
const { version } = require("../../../package.json");

const app = express();
setupRoutes(app);

describe("GET /health", () => {
  it("answers 200 ok with the DB latency when the database is up", async () => {
    database.health.mockResolvedValue({ database: "up", dbLatencyMs: 4 });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      database: "up",
      dbLatencyMs: 4,
      service: "Nexus CRM API",
      version,
      environment: "test",
      startedAt: expect.any(String),
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    });
  });

  it("answers 503 degraded with the error code only when the database is down", async () => {
    database.health.mockResolvedValue({ database: "down", error: "ESOCKET" });
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", database: "down", error: "ESOCKET" });
    expect(res.body).not.toHaveProperty("dbLatencyMs");
    expect(JSON.stringify(res.body)).not.toMatch(/DB_|server|password|user/i);
  });

  it("keeps startedAt fixed between calls", async () => {
    database.health.mockResolvedValue({ database: "up", dbLatencyMs: 1 });
    const a = await request(app).get("/health");
    const b = await request(app).get("/health");
    expect(a.body.startedAt).toBe(b.body.startedAt);
  });
});

describe("/api while the database is down", () => {
  it("answers 503 DB_CONNECTION_FAILED without reaching a controller", async () => {
    database.health.mockResolvedValue({ database: "down", error: "ETIMEOUT" });
    const res = await request(app).post("/api/auth/loginUser").send({});
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: "DB_CONNECTION_FAILED" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("passes through to the route when the database is up", async () => {
    database.health.mockResolvedValue({ database: "up", dbLatencyMs: 1 });
    const res = await request(app).post("/api/auth/loginUser").send({});
    expect(res.status).not.toBe(503);
  });
});

describe("GET /test-db", () => {
  it("reports the connect time, or 503 when the database cannot be reached", async () => {
    database.testConnection.mockResolvedValueOnce(true);
    const ok = await request(app).get("/test-db");
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ connectionTimeMs: expect.any(Number) });

    database.testConnection.mockResolvedValueOnce(false);
    expect((await request(app).get("/test-db")).status).toBe(503);
    database.testConnection.mockRejectedValueOnce(new Error("boom"));
    expect((await request(app).get("/test-db")).status).toBe(503);
  });
});
