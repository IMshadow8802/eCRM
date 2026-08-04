// src/middleware/auth.js
const jwt = require("jsonwebtoken");
const { tokenErrors } = require("../utils/responseHelper");

const verifyToken = (req, res, next) => {
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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

    // Add user data to request for use in APIs
    req.user = {
      UserId: decoded.UserId,
      UserName: decoded.UserName,
      BranchId: decoded.BranchId,
      CompId: decoded.CompId,
      IsAdmin: decoded.IsAdmin,
    };

    console.log(`✅ Token verified for: ${decoded.UserName}`);
    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);

    if (error.name === "TokenExpiredError") {
      return tokenErrors.tokenExpired(res);
    }

    if (error.name === "JsonWebTokenError") {
      return tokenErrors.invalidToken(res);
    }

    return tokenErrors.invalidToken(res);
  }
};

module.exports = {
  verifyToken,
};
