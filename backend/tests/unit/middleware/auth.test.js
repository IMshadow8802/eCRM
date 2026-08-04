const jwt = require("jsonwebtoken");
const { verifyToken } = require("../../../src/middleware/auth");
const { mockRes } = require("../../helpers/mockRes");

// tests/setup.js silences log/info/warn but not error — auth.js logs every
// failure through console.error, which would otherwise spam the run.
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

const SECRET = process.env.JWT_SECRET;

const CLAIMS = {
  UserId: 7,
  UserName: "asha",
  BranchId: 2,
  CompId: 1,
  IsAdmin: false,
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
    it("populates req.user with exactly the five claims and calls next", () => {
      const req = reqWith(`Bearer ${sign()}`);
      const res = mockRes();
      const next = jest.fn();

      verifyToken(req, res, next);

      expect(req.user).toEqual(CLAIMS);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    // req.user is the identity every controller trusts for CompId/BranchId —
    // it must be a whitelist, not a copy of the token. iat/exp/FullName/Email
    // ride along in the real login payload and must not land on req.user.
    it("copies only the whitelisted claims, never the whole payload", () => {
      const req = reqWith(
        `Bearer ${sign(
          { ...CLAIMS, FullName: "Asha K", Email: "a@b.c", Role: "owner" },
          SECRET,
          { expiresIn: "1h" },
        )}`,
      );
      const res = mockRes();

      verifyToken(req, res, jest.fn());

      expect(Object.keys(req.user).sort()).toEqual([
        "BranchId",
        "CompId",
        "IsAdmin",
        "UserId",
        "UserName",
      ]);
    });

    it("carries IsAdmin=true through unchanged", () => {
      const req = reqWith(`Bearer ${sign({ ...CLAIMS, IsAdmin: true })}`);
      verifyToken(req, mockRes(), jest.fn());
      expect(req.user.IsAdmin).toBe(true);
    });
  });

  describe("missing / malformed Authorization header", () => {
    it("401s NO_TOKEN when the header is absent, without calling next", () => {
      const res = mockRes();
      const next = jest.fn();

      verifyToken(reqWith(undefined), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res)).toEqual(
        expect.objectContaining({ success: false, code: "NO_TOKEN" }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("401s NO_TOKEN on an empty header string", () => {
      const res = mockRes();
      verifyToken(reqWith(""), res, jest.fn());
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
    ])("401s INVALID_TOKEN_FORMAT for %s", (_label, header) => {
      const res = mockRes();
      const next = jest.fn();

      verifyToken(reqWith(header), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("INVALID_TOKEN_FORMAT");
      expect(next).not.toHaveBeenCalled();
    });

    // BUG: "Bearer " (empty token) sails through the format gate — split(" ")
    // yields ["Bearer", ""], which is length 2 with parts[0] === "Bearer" — and
    // is only caught later by jwt.verify. It is still a 401 so it is not
    // exploitable, but the client is told INVALID_TOKEN ("please login again")
    // when the real fault is a malformed header, i.e. the wrong diagnosis.
    it("401s an empty token as INVALID_TOKEN, not INVALID_TOKEN_FORMAT", () => {
      const res = mockRes();
      const next = jest.fn();

      verifyToken(reqWith("Bearer "), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("INVALID_TOKEN");
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("bad signatures and expiry", () => {
    it("401s INVALID_TOKEN for a token signed with the wrong secret", () => {
      const res = mockRes();
      const next = jest.fn();

      verifyToken(reqWith(`Bearer ${sign(CLAIMS, "attacker-secret")}`), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("INVALID_TOKEN");
      expect(next).not.toHaveBeenCalled();
    });

    it("401s TOKEN_EXPIRED for an expired token", () => {
      const res = mockRes();
      const next = jest.fn();
      const expired = sign(CLAIMS, SECRET, { expiresIn: "-10s" });

      verifyToken(reqWith(`Bearer ${expired}`), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("TOKEN_EXPIRED");
      expect(next).not.toHaveBeenCalled();
    });

    // The classic JWT forgery: strip the signature and set alg=none. jwt.verify
    // rejects it because a secret was supplied ("jwt signature is required").
    it("401s an unsigned alg=none token", () => {
      const res = mockRes();
      const next = jest.fn();
      const none = jwt.sign({ ...CLAIMS, IsAdmin: true }, null, {
        algorithm: "none",
      });

      verifyToken(reqWith(`Bearer ${none}`), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("401s structurally invalid garbage", () => {
      const res = mockRes();
      verifyToken(reqWith("Bearer not.a.jwt"), res, jest.fn());
      expect(body(res).code).toBe("INVALID_TOKEN");
    });

    // NotBeforeError is neither TokenExpiredError nor (by name)
    // JsonWebTokenError, so it falls to the final catch-all return.
    it("401s a not-yet-valid (nbf in the future) token via the fallback branch", () => {
      const res = mockRes();
      const next = jest.fn();
      const future = sign(CLAIMS, SECRET, { notBefore: "1h" });

      verifyToken(reqWith(`Bearer ${future}`), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(body(res).code).toBe("INVALID_TOKEN");
      expect(next).not.toHaveBeenCalled();
    });

    it("fails closed with a 401 when JWT_SECRET is not configured", () => {
      const token = sign();
      delete process.env.JWT_SECRET;
      const res = mockRes();
      const next = jest.fn();
      try {
        verifyToken(reqWith(`Bearer ${token}`), res, next);
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
    it("rejects a token with no claims at all", () => {
      const req = reqWith(`Bearer ${sign({})}`);
      const res = mockRes();
      const next = jest.fn();

      verifyToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.user).toBeUndefined();
    });

    it("rejects a token carrying a UserId but no CompId", () => {
      const req = reqWith(`Bearer ${sign({ UserId: 7, UserName: "asha" })}`);
      const res = mockRes();
      const next = jest.fn();

      verifyToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("rejects a token carrying a CompId but no UserId", () => {
      const req = reqWith(`Bearer ${sign({ CompId: 5 })}`);
      const res = mockRes();
      const next = jest.fn();

      verifyToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("still admits a token carrying both, with the rest optional", () => {
      // BranchId and IsAdmin are legitimately absent for some roles; only
      // UserId and CompId are load-bearing on every request.
      const req = reqWith(`Bearer ${sign({ UserId: 7, CompId: 5 })}`);
      const next = jest.fn();

      verifyToken(req, mockRes(), next);

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

    it.each(cases)("%s: response body contains no token material", (_l, header) => {
      const res = mockRes();
      verifyToken(reqWith(header), res, jest.fn());
      const json = JSON.stringify(body(res));
      expect(json).not.toContain(token);
      expect(json).not.toMatch(/eyJ/); // any base64url JWT segment
      // "Use: Bearer <token>" in the format hint is the only echo of the
      // scheme, and it is a fixed string — never the caller's header.
      expect(json).not.toContain(header || "«no header sent»");
    });

    it.each(cases)("%s: response body contains no jsonwebtoken internals", (_l, header) => {
      const res = mockRes();
      verifyToken(reqWith(header), res, jest.fn());
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
