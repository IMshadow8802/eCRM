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
