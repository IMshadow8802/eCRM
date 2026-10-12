// Auth route surface: login is limited on FAILED attempts (see below), and the public
// hashPassword endpoint — which echoed plaintext passwords back with a
// ready-made UPDATE statement — is gone.
jest.mock("../../../src/controllers/authController", () => ({
  // "right" signs in; anything else is a wrong password.
  login: jest.fn((req, res) => (req.body.password === "right"
    ? res.status(200).json({ success: true })
    : res.status(401).json({ success: false, code: "INVALID_CREDENTIALS" }))),
  logout: jest.fn((req, res) => res.status(200).json({ success: true })),
  fetchMyAccess: jest.fn((req, res) => res.status(200).json({ success: true })),
}));

// logout now needs a session (verifyToken) — a request without the header is refused.
jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: jest.fn((req, res, next) => (req.headers.authorization
    ? (req.user = { UserId: 7, CompId: 1, Sid: "s" }, next())
    : res.status(401).json({ success: false, code: "NO_TOKEN" }))),
}));
jest.mock("../../../src/middleware/permission", () => ({
  loadScope: (req, res, next) => next(),
  open: () => (req, res, next) => next(),
}));

const express = require("express");
const request = require("supertest");
const authRoutes = require("../../../src/routes/authRoutes");

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);

describe("authRoutes", () => {
  const attempt = (identifier, password = "wrong") =>
    request(app).post("/api/auth/loginUser").send({ identifier, password });

  // Brute-force guard (audit 2026-10-12, A2). The old limiter was keyed on IP,
  // so one office behind one NAT address shared a bucket and a single typo
  // locked everyone out. Now: failed attempts per ACCOUNT, successes free.
  it("locks one account after 10 failed attempts, with a message the form can show", async () => {
    for (let i = 0; i < 10; i++) expect((await attempt("victim")).status).toBe(401);
    const r = await attempt("victim");
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ success: false, code: "TOO_MANY_ATTEMPTS" });
    expect(r.body.message).toMatch(/15 minutes/);
  });

  it("a locked account even refuses the right password until the window ends", async () => {
    for (let i = 0; i < 10; i++) await attempt("locked");
    expect((await attempt("locked", "right")).status).toBe(429);
  });

  it("counts the account case- and space-insensitively", async () => {
    for (let i = 0; i < 10; i++) await attempt(i % 2 ? "  Mixed " : "mixed");
    expect((await attempt("MIXED")).status).toBe(429);
  });

  it("one person's typos never lock out a colleague on the same office IP", async () => {
    for (let i = 0; i < 10; i++) await attempt("typo");
    expect((await attempt("colleague", "right")).status).toBe(200);
  });

  // No account name at all is the controller's 400; the limiter must not throw on it.
  it("passes a body with no account name through to the controller", async () => {
    const r = await request(app).post("/api/auth/loginUser").send({ password: "x" });
    expect(r.status).toBe(401);
  });

  it("successful sign-ins do not count toward the limit", async () => {
    for (let i = 0; i < 25; i++) expect((await attempt("daily", "right")).status).toBe(200);
  });

  it("does not limit by the old `username` field differently", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).post("/api/auth/loginUser").send({ username: "legacy", password: "x" });
    }
    expect((await attempt("legacy")).status).toBe(429);
  });

  it("does not rate-limit logout", async () => {
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post("/api/auth/logoutUser").set("Authorization", "Bearer t").send({});
      expect(r.status).toBe(200);
    }
  });

  it("logout sits behind verifyToken, so it knows which session to end", async () => {
    const r = await request(app).post("/api/auth/logoutUser").send({});
    expect(r.status).toBe(401);
  });

  // Password spraying: one password tried across many accounts slips past the
  // per-account limit, so one address also gets a loose cap on failures —
  // high enough that a whole office's typos never reach it.
  it("caps failed attempts from one address at 100 per window across accounts", async () => {
    for (let i = 0; i < 100; i++) await attempt(`spray${i}`);
    const r = await attempt("spray-next");
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("TOO_MANY_ATTEMPTS");
  });

  // With one trusted hop (server.js), a forged X-Forwarded-For prefix does not
  // move the caller to a fresh address bucket: the IP is the one nginx appended.
  it("a forged X-Forwarded-For does not reset the address limit behind one proxy", async () => {
    const behindNginx = express();
    behindNginx.set("trust proxy", 1);
    behindNginx.use(express.json());
    behindNginx.use("/api/auth", jest.requireActual("../../../src/routes/authRoutes"));
    const send = (i) => request(behindNginx).post("/api/auth/loginUser")
      .set("X-Forwarded-For", `10.0.0.${i % 250}, 203.0.113.9`)
      .send({ identifier: `forged${i}`, password: "wrong" });
    for (let i = 0; i < 100; i++) await send(i);
    expect((await send(101)).status).toBe(429);
  });

  // REGRESSION: this endpoint was public and returned the plaintext password
  // plus a SQL snippet — free bcrypt oracle. It must stay deleted.
  it("no longer exposes hashPassword", async () => {
    const r = await request(app).post("/api/auth/hashPassword").send({ password: "x" });
    expect(r.status).toBe(404);
  });
});
