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
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

class Database {
  constructor() {
    this.pool = null;
    this.connected = false;
  }

  async connect() {
    try {
      if (this.connected && this.pool) {
        return this.pool;
      }

      console.log("🔄 Connecting to SQL Server...");
      this.pool = await sql.connect(dbConfig);
      this.connected = true;
      console.log("✅ Database connected successfully");
      return this.pool;
    } catch (error) {
      console.error("❌ Database connection failed:", error.message);
      this.connected = false;
      throw error;
    }
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
          request.input(key, sql.Int, value);
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
          request.input(key, sql.Int, value);
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
