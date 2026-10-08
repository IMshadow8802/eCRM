// src/middleware/auth.js
const jwt = require("jsonwebtoken");
const { tokenErrors, error } = require("../utils/responseHelper");
const sessionService = require("../services/sessionService");

const verifyToken = async (req, res, next) => {
  let decoded;
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return tokenErrors.noToken(res);
    }

    // Check format: "Bearer <token>"
    const tokenParts = authHeader.split(" ");
    if (tokenParts.length !== 2 || tokenParts[0] !== "Bearer") {
      return tokenErrors.invalidFormat(res);
    }

    const token = tokenParts[1];

    // Verify token
    decoded = jwt.verify(token, process.env.JWT_SECRET);

    /**
     * A valid signature used to be the ONLY check, so a correctly-signed token
     * carrying an empty or partial payload sailed through and `req.user` came
     * out as `{ UserId: undefined, CompId: undefined, ... }`. Every controller
     * then injected that `undefined` CompId straight into its stored
     * procedure — an authenticated request belonging to no tenant, which is the
     * one state the whole multi-tenancy model has no answer for.
     *
     * The realistic route in is not a forged token but our own login path:
     * if sp_ValidateUser ever returns a row missing CompId, authController
     * mints exactly this token and nothing downstream notices.
     *
     * UserId and CompId are the two claims every request needs. A token without
     * them is not a usable session, whoever signed it.
     */
    if (!decoded?.UserId || !decoded?.CompId) {
      console.error("Token verification failed: payload missing UserId/CompId");
      return tokenErrors.invalidToken(res);
    }
  } catch (err) {
    console.error("Token verification failed:", err.message);

    if (err.name === "TokenExpiredError") {
      return tokenErrors.tokenExpired(res);
    }

    if (err.name === "JsonWebTokenError") {
      return tokenErrors.invalidToken(res);
    }

    return tokenErrors.invalidToken(res);
  }

  /**
   * Server-side session (spec D7). A signature proves who minted the token,
   * not that the person is still signed in: logout, shift end and an admin's
   * forced end all close the session row, and this is where that bites.
   * Tokens minted before sessions existed carry no Sid and are refused, so
   * everyone signs in once after the deploy.
   */
  if (typeof decoded.Sid !== "string" || !decoded.Sid) {
    return tokenErrors.session(res, "SESSION_REQUIRED");
  }
  let verdict;
  try {
    verdict = await sessionService.check(decoded.Sid);
  } catch (err) {
    // The session store is unreadable: refuse, but not with a sign-out code —
    // a DB blip must not throw every open page onto the sign-in screen.
    console.error("Session check failed:", err.message);
    return error(res, "Could not verify your session. Try again.", "SESSION_CHECK_FAILED", 503);
  }
  if (!verdict.ok) return tokenErrors.session(res, verdict.code);
  // The row's owner must be the token's user; a mismatch is never a usable session.
  if (Number(verdict.userId) !== Number(decoded.UserId)) return tokenErrors.session(res, "SESSION_ENDED");

  // Add user data to request for use in APIs
  req.user = {
    UserId: decoded.UserId,
    UserName: decoded.UserName,
    BranchId: decoded.BranchId,
    CompId: decoded.CompId,
    IsAdmin: decoded.IsAdmin,
    Sid: decoded.Sid,
  };

  console.log(`✅ Token verified for: ${decoded.UserName}`);
  // Outside the try blocks: an error downstream is not a token error.
  return next();
};

module.exports = {
  verifyToken,
};
