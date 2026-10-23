// src/config/database.js
const sql = require("mssql");
require("dotenv").config();

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    requestTimeout: 30000,
    connectionTimeout: 30000,
    // SQL Server stores IST wall-clock (GETDATE() is server-local, +05:30).
    // useUTC:false makes node-mssql read/write DATETIME in the node process's
    // local timezone — which we pin to Asia/Kolkata (docker-compose TZ) so the
    // stored wall-clock is interpreted as IST, not mislabelled UTC (+5:30 bug).
    useUTC: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// A pool error event with no listener would crash the process.
sql.on("error", (err) => console.error("❌ SQL pool error:", err.message));

const HEALTH_TTL_MS = 10000; // Docker's healthcheck, devlens and the /api gate all poll
const PING_TIMEOUT_MS = 3000;
// Connection-level failures: the pool cannot reach the server, so the cached
// health is no longer trusted. A query's own ETIMEOUT is not one of these.
const isConnectionError = (err) =>
  err?.name === "ConnectionError" || ["ESOCKET", "ECONNCLOSED"].includes(err?.code);
// The code only: an mssql message carries the DB server's address, and /health is public.
const errorCode = (err) => {
  const code = err?.code || err?.originalError?.code;
  return /^E[A-Z]+$/.test(code || "") ? code : "EUNKNOWN";
};

class Database {
  constructor() {
    this.pool = null;
    this.connected = false;
    this.connecting = null;
    this.healthCheck = null;
    this.healthAt = 0;
    this.config = dbConfig; // exposed for inspection/tests
  }

  async connect() {
    if (this.connected && this.pool) {
      return this.pool;
    }
    // One dial at a time: while the server is down every request and health
    // probe would otherwise open its own.
    if (!this.connecting) {
      console.log("🔄 Connecting to SQL Server...");
      this.connecting = sql
        .connect(dbConfig)
        .then((pool) => {
          this.pool = pool;
          this.connected = true;
          console.log("✅ Database connected successfully");
          return pool;
        })
        .catch((error) => {
          console.error("❌ Database connection failed:", error.message);
          this.connected = false;
          throw error;
        })
        .finally(() => {
          this.connecting = null;
        });
    }
    return this.connecting;
  }

  /** SELECT 1 within timeoutMs → { database: "up", dbLatencyMs } or { database: "down", error: <code> }. Never rejects. */
  async ping(timeoutMs = PING_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error(`no answer in ${timeoutMs} ms`), { code: "ETIMEOUT" })),
        timeoutMs,
      );
    });
    const started = Date.now();
    try {
      await Promise.race([this.connect().then((pool) => pool.request().query("SELECT 1")), timeout]);
      return { database: "up", dbLatencyMs: Date.now() - started };
    } catch (err) {
      console.error("❌ Database health check failed:", err.message);
      return { database: "down", error: errorCode(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** ping(), shared for HEALTH_TTL_MS so pollers do not hit the client DB on every call. */
  health() {
    if (!this.healthCheck || Date.now() - this.healthAt >= HEALTH_TTL_MS) {
      this.healthAt = Date.now();
      this.healthCheck = this.ping();
    }
    return this.healthCheck;
  }

  noteFailure(error) {
    if (isConnectionError(error)) this.healthCheck = null; // re-probe on the next request
  }

  async testConnection() {
    try {
      await this.connect();
      const request = this.pool.request();
      await request.query("SELECT 1 as TestValue");
      console.log("✅ Database test successful");
      return true;
    } catch (error) {
      console.error("❌ Database test failed:", error.message);
      return false;
    }
  }

  async executeQuery(query, parameters = {}) {
    try {
      if (!this.connected) {
        await this.connect();
      }

      const request = this.pool.request();

      // Add parameters
      Object.keys(parameters).forEach((key) => {
        const value = parameters[key];
        if (typeof value === "string") {
          request.input(key, sql.NVarChar, value);
        } else if (typeof value === "number") {
          // Every number used to map to sql.Int, which silently truncated the
          // DECIMAL params (HourlyRate 12.50 was stored as 12).
          request.input(
            key,
            Number.isInteger(value) ? sql.Int : sql.Decimal(18, 4),
            value,
          );
        } else if (typeof value === "boolean") {
          request.input(key, sql.Bit, value);
        } else if (value instanceof Date) {
          request.input(key, sql.DateTime, value);
        } else {
          request.input(key, value);
        }
      });

      const result = await request.query(query);
      return result;
    } catch (error) {
      console.error("❌ Query execution failed:", error.message);
      this.noteFailure(error);
      throw error;
    }
  }

  async executeStoredProcedure(procedureName, parameters = {}) {
    try {
      if (!this.connected) {
        await this.connect();
      }

      const request = this.pool.request();

      // Add parameters
      Object.keys(parameters).forEach((key) => {
        const value = parameters[key];
        if (typeof value === "string") {
          request.input(key, sql.NVarChar, value);
        } else if (typeof value === "number") {
          // Every number used to map to sql.Int, which silently truncated the
          // DECIMAL params (HourlyRate 12.50 was stored as 12).
          request.input(
            key,
            Number.isInteger(value) ? sql.Int : sql.Decimal(18, 4),
            value,
          );
        } else if (typeof value === "boolean") {
          request.input(key, sql.Bit, value);
        } else if (value instanceof Date) {
          request.input(key, sql.DateTime, value);
        } else {
          request.input(key, value);
        }
      });

      const result = await request.execute(procedureName);
      return result;
    } catch (error) {
      console.error(
        `❌ Stored procedure ${procedureName} failed:`,
        error.message
      );
      this.noteFailure(error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.pool) {
        await this.pool.close();
        this.connected = false;
        console.log("📴 Database connection closed");
      }
    } catch (error) {
      console.error("❌ Error closing database:", error.message);
    }
  }
}

module.exports = new Database();
