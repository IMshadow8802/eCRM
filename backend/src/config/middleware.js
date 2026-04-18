// src/config/middleware.js
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const express = require("express");
const { error, serverErrors } = require("../utils/responseHelper");

function setupMiddleware(app) {
  // 1. Security headers
  app.use(helmet());
  console.log("✅ Security headers enabled");

  // 2. CORS
  app.use(
    cors({
      origin: [
        "http://localhost:3000",
        "http://localhost:19006",
        "http://localhost:3001",
        "http://localhost:4000",
        "http://localhost:8080",
        "http://localhost:5001",
        "https://prdinfotech.in", // ADD THIS
        "http://prdinfotech.in", // AND THIS
      ],
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-requested-with"],
    })
  );
  console.log("✅ CORS enabled");

  // 3. Request logging
  const logFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";
  app.use(morgan(logFormat));
  console.log(`✅ Request logging enabled (${logFormat})`);

  // 4. Response compression
  app.use(compression());
  console.log("✅ Response compression enabled");

  // 5. JSON parsing
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, res, buf) => {
        try {
          JSON.parse(buf);
        } catch (e) {
          return error(res, "Invalid JSON format", "INVALID_JSON", 400);
        }
      },
    })
  );

  app.use(
    express.urlencoded({
      extended: true,
      limit: "10mb",
      parameterLimit: 20000,
    })
  );
  console.log("✅ JSON parsing enabled");

  // 6. Request timeout
  app.use((req, res, next) => {
    req.setTimeout(30000, () => {
      console.log("⏰ Request timeout for:", req.method, req.url);
      return serverErrors.timeout(res);
    });
    next();
  });
  console.log("✅ Request timeout enabled (30s)");
}

module.exports = { setupMiddleware };
