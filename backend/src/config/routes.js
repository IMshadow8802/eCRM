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
const customerRoutes = require("../routes/customerRoutes");
const reportRoutes = require("../routes/reportRoutes");
const userBranchAccessRoutes = require("../routes/userBranchAccessRoutes");
const configRoutes = require("../routes/configRoutes");
const productRoutes = require("../routes/productRoutes");
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
  app.use("/api/customers", customerRoutes);
  // /api/sources and /api/status were removed on 2026-08-04. They were the
  // pre-config-engine Status and LeadSource lists, superseded by tblLookup, and
  // no client had called them for months. Their SPs take no @CompId — not
  // "forget to check it", there is no parameter — so sp_DeleteStatus deleted
  // whatever row id it was handed, whoever owned it. Deleting the routes closes
  // that outright; the legacy tables and SPs are a separate DB cleanup.
  app.use("/api/reports", reportRoutes);
  app.use("/api/user-branch-access", userBranchAccessRoutes);
  app.use("/api/config", configRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/attachments", attachmentRoutes);

  app.get("/health", (req, res) => {
    return success(res, "CRM API is running", {
      uptime: process.uptime(),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      environment: process.env.NODE_ENV || "development",
    });
  });

  /**
   * Connectivity probe. Unauthenticated on purpose — it is what nginx and a
   * human debugging a deploy reach for, and requiring a token would defeat that.
   *
   * It no longer echoes DB_SERVER and DB_NAME, though. Those named the database
   * host and catalogue to anyone who could curl the domain, which is a free head
   * start for anyone probing the box and buys the operator nothing they cannot
   * read from their own .env. Whether the connection works, and how long it
   * took, is the entire useful answer.
   */
  app.get("/test-db", async (req, res) => {
    try {
      const startTime = Date.now();
      const isConnected = await database.testConnection();
      if (!isConnected) return dbErrors.connectionFailed(res);
      return success(res, "Database connected", {
        connectionTimeMs: Date.now() - startTime,
      });
    } catch (err) {
      return dbErrors.connectionFailed(res);
    }
  });
}

module.exports = { setupRoutes };
