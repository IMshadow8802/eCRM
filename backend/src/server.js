// src/server.js
const express = require("express");

// Load environment variables based on NODE_ENV
require("dotenv-flow").config();

const { setupMiddleware } = require("./config/middleware");
const { setupRoutes } = require("./config/routes");
const { setupErrorHandlers } = require("./config/errorHandlers");
const database = require("./config/database");

const app = express();
const PORT = process.env.PORT || 5001;

// Trust proxy headers when behind IIS
app.set("trust proxy", true);

console.log("🚀 Starting CRM API Server...");

// ===========================================
// MIDDLEWARE SETUP
// ===========================================
setupMiddleware(app);

// ===========================================
// ROUTES SETUP
// ===========================================
setupRoutes(app);

// ===========================================
// ERROR HANDLERS
// ===========================================
setupErrorHandlers(app);

// ===========================================
// SERVER STARTUP
// ===========================================
async function startServer() {
  try {
    console.log("📡 Testing database connection...");

    const dbConnected = await database.testConnection();

    if (!dbConnected) {
      console.error("❌ Cannot start server - database connection failed");
      process.exit(1);
    }

    // Bind host: 127.0.0.1 locally (IIS reverse proxy), 0.0.0.0 in Docker.
    // Docker Compose sets HOST=0.0.0.0 so the port is reachable from outside
    // the container; local dev keeps the loopback default.
    const HOST = process.env.HOST || "127.0.0.1";
    const server = app.listen(PORT, HOST, () => {
      const isProduction = process.env.NODE_ENV === "production";
      const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

      console.log("\n🎉 CRM API SERVER STARTED");
      console.log(`🌐 Base: ${baseUrl}`);
      console.log(`🏥 Health: ${baseUrl}/health`);
      console.log(`🌍 Env: ${process.env.NODE_ENV || "development"}`);
      console.log(`🗄️  DB: ${process.env.DB_NAME} on ${process.env.DB_SERVER}`);
      console.log(`🔧 Port: ${PORT}`);
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      console.log("\n🛑 Shutting down gracefully...");
      server.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
      });
    };

    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
