jest.mock("../../../src/services/sessionService", () => ({ check: jest.fn() }));

const jwt = require("jsonwebtoken");
const sessionService = require("../../../src/services/sessionService");
const { verifyToken } = require("../../../src/middleware/auth");
const { mockRes } = require("../../helpers/mockRes");

// tests/setup.js silences log/info/warn but not error — auth.js logs every
// failure through console.error, which would otherwise spam the run.
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  sessionService.check.mockReset().mockResolvedValue({ ok: true, userId: 7 });
});

const SECRET = process.env.JWT_SECRET;

const CLAIMS = {
  UserId: 7,
  UserName: "asha",
  BranchId: 2,
  CompId: 1,
  IsAdmin: false,
  Sid: "11111111-2222-3333-4444-555555555555",
};

const sign = (payload = CLAIMS, secret = SECRET, opts = {}) =>
  jwt.sign(payload, secret, opts);

const reqWith = (authHeader) => ({
  headers: authHeader === undefined ? {} : { authorization: authHeader },
});

/** The single json() payload the middleware sent. */
const body = (res) => res.json.mock.calls[0][0];

describe("verifyToken", () => {
  describe("valid token", () => {
    it("populates req.user with exactly the six claims and calls next", async () => {
      const req = reqWith(`Bearer ${sign()}`);
      const res = mockRes();
      const next = jest.fn();

      await verifyToken(req, res, next);

      expect(req.user).toEqual(CLAIMS);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    // req.user is the identity every controller trusts for CompId/BranchId —
    // it must be a whitelist, not a copy of the token. iat/exp/FullName/Email
    // ride along in the real login payload and must not land on req.user.
    it("copies only the whitelisted claims, never the whole payload", async () => {
      const req = reqWith(
        `Bearer ${sign(
          { ...CLAIMS, FullName: "Asha K", Email: "a@b.c", Role: "owner" },
          SECRET,
          { expiresIn: "1h" },
        )}`,
      );
      const res = mockRes();

      await verifyToken(req, res, jest.fn());

      expect(Object.keys(req.user).sort()).toEqual([
        "BranchId",
        "CompId",
        "IsAdmin",
        "Sid",
        "UserId",
        "UserName",
      ]);
    });

    it("carries IsAdmin=true through unchanged", async () => {
      const req = reqWith(`Bearer ${sign({ ...CLAIMS, IsAdmin: true })}`);
      await verifyToken(req, mockRes(), jest.fn());
      expect(req.user.IsAdmin).toBe(true);
    });
  });

  describe("missing / malformed Authorization header", () => {
    it("401s NO_TOKEN when the header is absent, without calling next", async () => {
      const res = mockRes();
      const next = jest.fn();

      await verifyToken(reqWith(undefined), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res)).toEqual(
        expect.objectContaining({ success: false, code: "NO_TOKEN" }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("401s NO_TOKEN on an empty header string", async () => {
      const res = mockRes();
      await verifyToken(reqWith(""), res, jest.fn());
      expect(body(res).code).toBe("NO_TOKEN");
    });

    it.each([
      ["no scheme (raw token)", "sometoken"],
      ["wrong scheme", "Token sometoken"],
      ["Basic auth", "Basic dXNlcjpwYXNz"],
      ["three parts", "Bearer a b"],
      // Deviation worth knowing about: RFC 7235 makes the auth scheme
      // case-insensitive, but the check here is a strict === "Bearer".
      ["lowercase bearer", "bearer sometoken"],
    ])("401s INVALID_TOKEN_FORMAT for %s", async (_label, header) => {
      const res = mockRes();
      const next = jest.fn();

      await verifyToken(reqWith(header), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("INVALID_TOKEN_FORMAT");
      expect(next).not.toHaveBeenCalled();
    });

    // BUG: "Bearer " (empty token) sails through the format gate — split(" ")
    // yields ["Bearer", ""], which is length 2 with parts[0] === "Bearer" — and
    // is only caught later by jwt.verify. It is still a 401 so it is not
    // exploitable, but the client is told INVALID_TOKEN ("please login again")
    // when the real fault is a malformed header, i.e. the wrong diagnosis.
    it("401s an empty token as INVALID_TOKEN, not INVALID_TOKEN_FORMAT", async () => {
      const res = mockRes();
      const next = jest.fn();

      await verifyToken(reqWith("Bearer "), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("INVALID_TOKEN");
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("bad signatures and expiry", () => {
    it("401s INVALID_TOKEN for a token signed with the wrong secret", async () => {
      const res = mockRes();
      const next = jest.fn();

      await verifyToken(reqWith(`Bearer ${sign(CLAIMS, "attacker-secret")}`), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("INVALID_TOKEN");
      expect(next).not.toHaveBeenCalled();
    });

    it("401s TOKEN_EXPIRED for an expired token", async () => {
      const res = mockRes();
      const next = jest.fn();
      const expired = sign(CLAIMS, SECRET, { expiresIn: "-10s" });

      await verifyToken(reqWith(`Bearer ${expired}`), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("TOKEN_EXPIRED");
      expect(next).not.toHaveBeenCalled();
    });

    // The classic JWT forgery: strip the signature and set alg=none. jwt.verify
    // rejects it because a secret was supplied ("jwt signature is required").
    it("401s an unsigned alg=none token", async () => {
      const res = mockRes();
      const next = jest.fn();
      const none = jwt.sign({ ...CLAIMS, IsAdmin: true }, null, {
        algorithm: "none",
      });

      await verifyToken(reqWith(`Bearer ${none}`), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("401s structurally invalid garbage", async () => {
      const res = mockRes();
      await verifyToken(reqWith("Bearer not.a.jwt"), res, jest.fn());
      expect(body(res).code).toBe("INVALID_TOKEN");
    });

    // NotBeforeError is neither TokenExpiredError nor (by name)
    // JsonWebTokenError, so it falls to the final catch-all return.
    it("401s a not-yet-valid (nbf in the future) token via the fallback branch", async () => {
      const res = mockRes();
      const next = jest.fn();
      const future = sign(CLAIMS, SECRET, { notBefore: "1h" });

      await verifyToken(reqWith(`Bearer ${future}`), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("INVALID_TOKEN");
      expect(next).not.toHaveBeenCalled();
    });

    it("fails closed with a 401 when JWT_SECRET is not configured", async () => {
      const token = sign();
      delete process.env.JWT_SECRET;
      const res = mockRes();
      const next = jest.fn();
      try {
        await verifyToken(reqWith(`Bearer ${token}`), res, next);
      } finally {
        process.env.JWT_SECRET = SECRET;
      }
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  /**
   * FIXED 2026-08-04. jwt.verify proves the signature and nothing else, so a
   * token this server signed with an empty or partial payload used to sail
   * through: next() ran with req.user = { UserId: undefined, CompId: undefined }
   * and every controller then injected that undefined CompId straight into its
   * stored procedure — an authenticated request belonging to no tenant.
   *
   * The realistic route in was never a forged token but our own login path: if
   * sp_ValidateUser returns a row missing CompId, authController mints exactly
   * this token and nothing downstream notices.
   */
  describe("valid signature, missing claims", () => {
    it("rejects a token with no claims at all", async () => {
      const req = reqWith(`Bearer ${sign({})}`);
      const res = mockRes();
      const next = jest.fn();

      await verifyToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.user).toBeUndefined();
    });

    it("rejects a token carrying a UserId but no CompId", async () => {
      const req = reqWith(`Bearer ${sign({ UserId: 7, UserName: "asha" })}`);
      const res = mockRes();
      const next = jest.fn();

      await verifyToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("rejects a token carrying a CompId but no UserId", async () => {
      const req = reqWith(`Bearer ${sign({ CompId: 5 })}`);
      const res = mockRes();
      const next = jest.fn();

      await verifyToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("still admits a token carrying both, with the rest optional", async () => {
      // BranchId and IsAdmin are legitimately absent for some roles; only
      // UserId and CompId are load-bearing on every request.
      const req = reqWith(`Bearer ${sign({ UserId: 7, CompId: 5, Sid: "s" })}`);
      const next = jest.fn();

      await verifyToken(req, mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toMatchObject({ UserId: 7, CompId: 5 });
    });
  });

  describe("failure responses leak nothing", () => {
    const token = sign(CLAIMS, "attacker-secret");
    const cases = [
      ["no header", undefined],
      ["bad format", `Token ${token}`],
      ["wrong secret", `Bearer ${token}`],
      ["expired", `Bearer ${sign(CLAIMS, SECRET, { expiresIn: "-10s" })}`],
      ["garbage", "Bearer not.a.jwt"],
    ];

    it.each(cases)("%s: response body contains no token material", async (_l, header) => {
      const res = mockRes();
      await verifyToken(reqWith(header), res, jest.fn());
      const json = JSON.stringify(body(res));
      expect(json).not.toContain(token);
      expect(json).not.toMatch(/eyJ/); // any base64url JWT segment
      // "Use: Bearer <token>" in the format hint is the only echo of the
      // scheme, and it is a fixed string — never the caller's header.
      expect(json).not.toContain(header || "«no header sent»");
    });

    it.each(cases)("%s: response body contains no jsonwebtoken internals", async (_l, header) => {
      const res = mockRes();
      await verifyToken(reqWith(header), res, jest.fn());
      const json = JSON.stringify(body(res));
      expect(json).not.toMatch(
        /signature|malformed|jwt expired|jwt malformed|JsonWebTokenError|TokenExpiredError|stack|secret/i,
      );
      // Only the fixed envelope fields ever ship.
      expect(Object.keys(body(res)).sort()).toEqual([
        "code",
        "message",
        "responseCode",
        "success",
        "timestamp",
      ]);
    });
  });
});

describe("verifyToken session check (spec D7)", () => {
  it("passes the token's Sid to the session check and onto req.user", async () => {
    const req = reqWith(`Bearer ${sign()}`);
    const next = jest.fn();
    await verifyToken(req, mockRes(), next);
    expect(sessionService.check).toHaveBeenCalledWith(CLAIMS.Sid);
    expect(req.user.Sid).toBe(CLAIMS.Sid);
    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ["no Sid", { UserId: 7, CompId: 1 }],
    ["a non-string Sid", { UserId: 7, CompId: 1, Sid: 42 }],
  ])("401s SESSION_REQUIRED for %s, without a lookup", async (_l, claims) => {
    const res = mockRes();
    const next = jest.fn();
    await verifyToken(reqWith(`Bearer ${sign(claims)}`), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(body(res)).toMatchObject({ code: "SESSION_REQUIRED", message: "Please sign in again" });
    expect(sessionService.check).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ["SESSION_EXPIRED", "Your session ended at the end of your shift. Sign in again to continue."],
    ["SESSION_FORCED", "An admin ended your session. Sign in again to continue."],
    ["SESSION_ENDED", "You signed out. Sign in again to continue."],
  ])("401s %s with its message", async (code, message) => {
    sessionService.check.mockResolvedValue({ ok: false, code });
    const req = reqWith(`Bearer ${sign()}`);
    const res = mockRes();
    const next = jest.fn();
    await verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(body(res)).toMatchObject({ success: false, code, message, responseCode: 401 });
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it("401s SESSION_ENDED when the session belongs to another user", async () => {
    sessionService.check.mockResolvedValue({ ok: true, userId: 99 });
    const res = mockRes();
    const next = jest.fn();
    await verifyToken(reqWith(`Bearer ${sign()}`), res, next);
    expect(body(res).code).toBe("SESSION_ENDED");
    expect(next).not.toHaveBeenCalled();
  });

  it("503s (not a sign-out code) when the session store cannot be read", async () => {
    sessionService.check.mockRejectedValue(new Error("db down"));
    const res = mockRes();
    const next = jest.fn();
    await verifyToken(reqWith(`Bearer ${sign()}`), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(body(res).code).toBe("SESSION_CHECK_FAILED");
    expect(next).not.toHaveBeenCalled();
  });

  it("an error thrown downstream of next() is not reported as a token error", async () => {
    const res = mockRes();
    const next = jest.fn(() => { throw new Error("controller blew up"); });
    await expect(verifyToken(reqWith(`Bearer ${sign()}`), res, next)).rejects.toThrow("controller blew up");
    expect(res.status).not.toHaveBeenCalled();
  });
});
