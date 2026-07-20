// Auth route hardening: login is rate-limited (brute-force guard) and the
// public hashPassword endpoint — which echoed plaintext passwords back with a
// ready-made UPDATE statement — is gone.
jest.mock("../../../src/controllers/authController", () => ({
  login: jest.fn((req, res) =>
    res.status(401).json({ success: false, code: "WRONG_PASSWORD" }),
  ),
  logout: jest.fn((req, res) => res.status(200).json({ success: true })),
}));

const express = require("express");
const request = require("supertest");
const authRoutes = require("../../../src/routes/authRoutes");

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);

describe("authRoutes login rate limiter", () => {
  it("allows 10 attempts then 429s the 11th with the standard error shape", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post("/api/auth/loginUser").send({ username: "x", password: "y" });
      expect(r.status).toBe(401); // limiter passes through to the controller
    }
    const r = await request(app).post("/api/auth/loginUser").send({ username: "x", password: "y" });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({
      success: false,
      code: "RATE_LIMITED",
      responseCode: 429,
    });
  });

  it("does not rate-limit logout", async () => {
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post("/api/auth/logoutUser").send({});
      expect(r.status).toBe(200);
    }
  });

  // REGRESSION: this endpoint was public and returned the plaintext password
  // plus a SQL snippet — free bcrypt oracle. It must stay deleted.
  it("no longer exposes hashPassword", async () => {
    const r = await request(app).post("/api/auth/hashPassword").send({ password: "x" });
    expect(r.status).toBe(404);
  });
});
