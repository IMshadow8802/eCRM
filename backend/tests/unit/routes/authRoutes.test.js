// Auth route surface: login is NOT rate-limited (see below), and the public
// hashPassword endpoint — which echoed plaintext passwords back with a
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

describe("authRoutes", () => {
  // REGRESSION: login used to be capped at 10 attempts / 15 min keyed on IP.
  // A whole office behind one NAT address shared that single bucket, so one
  // person mistyping their password locked out everyone else — and because the
  // limiter counted its own 429s toward the quota, the retries it provoked
  // re-exhausted each new window the moment it opened. Removed deliberately.
  // If it comes back, it must key on the submitted identifier, not the IP.
  it("does not rate-limit login — repeated attempts all reach the controller", async () => {
    for (let i = 0; i < 25; i++) {
      const r = await request(app)
        .post("/api/auth/loginUser")
        .send({ identifier: "x", password: "y" });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("WRONG_PASSWORD");
    }
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
