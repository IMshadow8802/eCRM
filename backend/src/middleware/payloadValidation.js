// src/middleware/payloadValidation.js

/**
 * Simple payload validation middleware
 * Just checks if payload exists or not
 */

// Requires payload to exist (not empty)
const requirePayload = (req, res, next) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      success: false,
      message: "No payload found",
      code: "VALIDATION_ERROR",
      responseCode: 400,
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
  next();
};

// Allows empty payload - just ensures req.body exists
const allowEmptyPayload = (req, res, next) => {
  if (!req.body) {
    req.body = {};
  }
  next();
};

module.exports = {
  requirePayload,
  allowEmptyPayload
};