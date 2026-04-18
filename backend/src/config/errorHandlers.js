// src/config/errorHandlers.js
const { error, serverErrors } = require("../utils/responseHelper");

function setupErrorHandlers(app) {
  // 404 handler
  app.use((req, res) => {
    console.log(`⚠️  404 - Route not found: ${req.method} ${req.originalUrl}`);
    return error(
      res,
      `Route not found: ${req.method} ${req.originalUrl}`,
      "ROUTE_NOT_FOUND",
      404
    );
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error("❌ Uncaught Error:", err.message);

    if (process.env.NODE_ENV === "development") {
      console.error("📍 Error Stack:", err.stack);
      return serverErrors.internalError(res, err.message);
    } else {
      return serverErrors.internalError(res);
    }
  });
}

module.exports = { setupErrorHandlers };
