// src/config/routes.js
const authRoutes = require("../routes/authRoutes");
const userRoutes = require("../routes/userRoutes");
const userGroupRoutes = require("../routes/userGroupRoutes");
const teamRoutes = require("../routes/teamRoutes");
const projectRoutes = require("../routes/projectRoutes");
const taskRoutes = require("../routes/taskRoutes");
const kanbanRoutes = require("../routes/kanbanRoutes");
const workspaceRoutes = require("../routes/workspaceRoutes");
const notificationRoutes = require("../routes/notificationRoutes");
const leadRoutes = require("../routes/leadRoutes");
const followupRoutes = require("../routes/followupRoutes");
const callRoutes = require("../routes/callRoutes");
const ticketRoutes = require("../routes/ticketRoutes");
const leadSourceRoutes = require("../routes/leadSourceRoutes");
const statusRoutes = require("../routes/statusRoutes");
const reportRoutes = require("../routes/reportRoutes");
const userBranchAccessRoutes = require("../routes/userBranchAccessRoutes");
const configRoutes = require("../routes/configRoutes");
const attachmentRoutes = require("../routes/attachmentRoutes");
const { success, dbErrors } = require("../utils/responseHelper");
const database = require("./database");

function setupRoutes(app) {
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/user-groups", userGroupRoutes);
  app.use("/api/teams", teamRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/kanban", kanbanRoutes);
  app.use("/api/workspaces", workspaceRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/leads", leadRoutes);
  app.use("/api/followups", followupRoutes);
  app.use("/api/calls", callRoutes);
  app.use("/api/tickets", ticketRoutes);
  app.use("/api/sources", leadSourceRoutes);
  app.use("/api/status", statusRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/user-branch-access", userBranchAccessRoutes);
  app.use("/api/config", configRoutes);
  app.use("/api/attachments", attachmentRoutes);

  app.get("/health", (req, res) => {
    return success(res, "CRM API is running", {
      uptime: process.uptime(),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      environment: process.env.NODE_ENV || "development",
    });
  });

  app.get("/test-db", async (req, res) => {
    try {
      const startTime = Date.now();
      const isConnected = await database.testConnection();
      if (!isConnected) return dbErrors.connectionFailed(res);
      return success(res, "Database connected", {
        connectionTimeMs: Date.now() - startTime,
        server: process.env.DB_SERVER,
        database: process.env.DB_NAME,
      });
    } catch (err) {
      return dbErrors.connectionFailed(res);
    }
  });
}

module.exports = { setupRoutes };
