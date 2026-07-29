// Regression: timestamps showed +5:30 in the browser because node-mssql
// defaulted useUTC:true and re-tagged SQL Server's IST wall-clock as UTC.
// With useUTC:false + container TZ=Asia/Kolkata, DATETIME round-trips as IST.
jest.mock("mssql", () => ({
  connect: jest.fn(),
  Int: "Int",
  NVarChar: "NVarChar",
  Bit: "Bit",
  DateTime: "DateTime",
  Decimal: jest.fn((p, s) => `Decimal(${p},${s})`),
}));

const sql = require("mssql");
const db = require("../../../src/config/database");

describe("database config", () => {
  it("reads DATETIME in local time (useUTC:false) so IST timestamps are not mislabelled UTC", () => {
    expect(db.config.options.useUTC).toBe(false);
  });
});

// Regression: every JS number mapped to sql.Int, so DECIMAL params were
// truncated on the way in — a user's HourlyRate of 12.50 was stored as 12.
describe("parameter type mapping", () => {
  const runWith = async (params, method) => {
    const request = { input: jest.fn(), query: jest.fn(), execute: jest.fn() };
    db.connected = true;
    db.pool = { request: () => request };
    await db[method](method === "executeQuery" ? "SELECT 1" : "sp_Thing", params);
    return request.input.mock.calls;
  };

  afterEach(() => {
    db.connected = false;
    db.pool = null;
  });

  it.each(["executeStoredProcedure", "executeQuery"])(
    "%s sends a fractional number as DECIMAL, not Int",
    async (method) => {
      const calls = await runWith({ HourlyRate: 12.5 }, method);
      expect(calls).toContainEqual(["HourlyRate", "Decimal(18,4)", 12.5]);
      expect(sql.Decimal).toHaveBeenCalledWith(18, 4);
    },
  );

  it.each(["executeStoredProcedure", "executeQuery"])(
    "%s still sends whole numbers as Int",
    async (method) => {
      const calls = await runWith({ CompId: 1, PageSize: 50 }, method);
      expect(calls).toContainEqual(["CompId", "Int", 1]);
      expect(calls).toContainEqual(["PageSize", "Int", 50]);
    },
  );

  it.each(["executeStoredProcedure", "executeQuery"])(
    "%s keeps the other type mappings intact",
    async (method) => {
      const when = new Date("2026-07-29T00:00:00Z");
      const calls = await runWith(
        { Name: "bob", IsActive: true, CreatedDate: when, Nothing: null },
        method,
      );
      expect(calls).toContainEqual(["Name", "NVarChar", "bob"]);
      expect(calls).toContainEqual(["IsActive", "Bit", true]);
      expect(calls).toContainEqual(["CreatedDate", "DateTime", when]);
      expect(calls).toContainEqual(["Nothing", null]);
    },
  );
});

describe("connection lifecycle", () => {
  afterEach(() => {
    db.connected = false;
    db.pool = null;
    jest.clearAllMocks();
  });

  it("connects once and reuses the pool", async () => {
    const pool = { request: jest.fn(), close: jest.fn() };
    sql.connect.mockResolvedValue(pool);

    expect(await db.connect()).toBe(pool);
    expect(await db.connect()).toBe(pool); // cached, no second dial
    expect(sql.connect).toHaveBeenCalledTimes(1);
    expect(db.connected).toBe(true);
  });

  it("rethrows and stays disconnected when the dial fails", async () => {
    sql.connect.mockRejectedValueOnce(new Error("no route to host"));
    await expect(db.connect()).rejects.toThrow("no route to host");
    expect(db.connected).toBe(false);
  });

  it("opens a connection lazily when a query runs before connect()", async () => {
    const request = { input: jest.fn(), query: jest.fn().mockResolvedValue({}) };
    sql.connect.mockResolvedValue({ request: () => request });
    await db.executeQuery("SELECT 1");
    expect(sql.connect).toHaveBeenCalledTimes(1);
  });

  it("testConnection returns true on success and false on failure", async () => {
    const request = { query: jest.fn().mockResolvedValue({}) };
    sql.connect.mockResolvedValue({ request: () => request });
    await expect(db.testConnection()).resolves.toBe(true);

    db.connected = false;
    db.pool = null;
    sql.connect.mockRejectedValueOnce(new Error("down"));
    await expect(db.testConnection()).resolves.toBe(false);
  });

  it("rethrows query and stored-procedure failures", async () => {
    db.connected = true;
    db.pool = {
      request: () => ({
        input: jest.fn(),
        query: jest.fn().mockRejectedValue(new Error("bad sql")),
        execute: jest.fn().mockRejectedValue(new Error("bad proc")),
      }),
    };
    await expect(db.executeQuery("SELECT 1")).rejects.toThrow("bad sql");
    await expect(db.executeStoredProcedure("sp_Thing")).rejects.toThrow("bad proc");
  });

  it("close() releases the pool, and swallows a close error", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    db.pool = { close };
    db.connected = true;
    await db.close();
    expect(close).toHaveBeenCalled();
    expect(db.connected).toBe(false);

    db.pool = { close: jest.fn().mockRejectedValue(new Error("already gone")) };
    await expect(db.close()).resolves.toBeUndefined();
  });

  it("close() is a no-op when there is no pool", async () => {
    db.pool = null;
    await expect(db.close()).resolves.toBeUndefined();
  });
});
