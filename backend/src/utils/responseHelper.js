// src/utils/responseHelper.js

const success = (res, message, data = null, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    responseCode: statusCode,
    data,
    timestamp: new Date().toISOString(),
  });
};

const error = (res, message, code = "SERVER_ERROR", statusCode = 500) => {
  return res.status(statusCode).json({
    success: false,
    message,
    code,
    responseCode: statusCode,
    timestamp: new Date().toISOString(),
  });
};

// Database-specific errors
const dbErrors = {
  connectionFailed: (res) =>
    res.status(503).json({
      success: false,
      message: "Database connection failed",
      code: "DB_CONNECTION_FAILED",
      responseCode: 503,
      timestamp: new Date().toISOString(),
    }),

  queryFailed: (res, details = null) =>
    res.status(500).json({
      success: false,
      message: "Database query failed",
      code: "DB_QUERY_FAILED",
      responseCode: 500,
      details: process.env.NODE_ENV === "development" ? details : null,
      timestamp: new Date().toISOString(),
    }),

  procedureFailed: (res, procedureName, details = null) =>
    res.status(500).json({
      success: false,
      message: `Stored procedure ${procedureName} failed`,
      code: "DB_PROCEDURE_FAILED",
      responseCode: 500,
      details: process.env.NODE_ENV === "development" ? details : null,
      timestamp: new Date().toISOString(),
    }),
};

// Token-specific errors
const tokenErrors = {
  noToken: (res) =>
    res.status(401).json({
      success: false,
      message: "Access token required",
      code: "NO_TOKEN",
      responseCode: 401,
      timestamp: new Date().toISOString(),
    }),

  invalidFormat: (res) =>
    res.status(401).json({
      success: false,
      message: "Invalid token format. Use: Bearer <token>",
      code: "INVALID_TOKEN_FORMAT",
      responseCode: 401,
      timestamp: new Date().toISOString(),
    }),

  tokenExpired: (res) =>
    res.status(401).json({
      success: false,
      message: "Token has expired - please login again",
      code: "TOKEN_EXPIRED",
      responseCode: 401,
      timestamp: new Date().toISOString(),
    }),

  invalidToken: (res) =>
    res.status(401).json({
      success: false,
      message: "Invalid token - please login again",
      code: "INVALID_TOKEN",
      responseCode: 401,
      timestamp: new Date().toISOString(),
    }),
};

// Server-specific errors
const serverErrors = {
  internalError: (res, details = null) =>
    res.status(500).json({
      success: false,
      message: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      responseCode: 500,
      details: process.env.NODE_ENV === "development" ? details : null,
      timestamp: new Date().toISOString(),
    }),

  serviceUnavailable: (res) =>
    res.status(503).json({
      success: false,
      message: "Service temporarily unavailable",
      code: "SERVICE_UNAVAILABLE",
      responseCode: 503,
      timestamp: new Date().toISOString(),
    }),

  timeout: (res) =>
    res.status(408).json({
      success: false,
      message: "Request timeout",
      code: "REQUEST_TIMEOUT",
      responseCode: 408,
      timestamp: new Date().toISOString(),
    }),
};

// Validation errors
const validationError = (res, message = "Validation failed") => {
  return res.status(400).json({
    success: false,
    message,
    code: "VALIDATION_ERROR",
    responseCode: 400,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  success,
  error,
  dbErrors,
  tokenErrors,
  serverErrors,
  validationError,
};
