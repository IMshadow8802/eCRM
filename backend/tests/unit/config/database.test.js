// Regression: timestamps showed +5:30 in the browser because node-mssql
// defaulted useUTC:true and re-tagged SQL Server's IST wall-clock as UTC.
// With useUTC:false + container TZ=Asia/Kolkata, DATETIME round-trips as IST.
jest.mock("mssql", () => ({
  connect: jest.fn(),
  on: jest.fn(),
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

// devlens monitoring: the API must stay up and say so when SQL Server is not.
describe("health probe", () => {
  afterEach(() => {
    db.connected = false;
    db.pool = null;
    db.connecting = null;
    db.healthCheck = null;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("registers a pool error listener so an 'error' event cannot crash the process", () => {
    jest.isolateModules(() => require("../../../src/config/database"));
    expect(sql.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("ping reports up with a latency", async () => {
    sql.connect.mockResolvedValue({ request: () => ({ query: jest.fn().mockResolvedValue({}) }) });
    const r = await db.ping();
    expect(r).toEqual({ database: "up", dbLatencyMs: expect.any(Number) });
  });

  it("ping reports the error code only, never the message with the server address", async () => {
    const err = Object.assign(new Error("Failed to connect to 10.0.0.5:1433 - ECONNREFUSED"), {
      name: "ConnectionError",
      code: "ESOCKET",
    });
    sql.connect.mockRejectedValue(err);
    await expect(db.ping()).resolves.toEqual({ database: "down", error: "ESOCKET" });
  });

  it("ping falls back to the driver's own code, and to EUNKNOWN for anything else", async () => {
    sql.connect.mockRejectedValueOnce(Object.assign(new Error("x"), { originalError: { code: "ELOGIN" } }));
    await expect(db.ping()).resolves.toEqual({ database: "down", error: "ELOGIN" });
    sql.connect.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "server 10.0.0.5" }));
    await expect(db.ping()).resolves.toEqual({ database: "down", error: "EUNKNOWN" });
  });

  it("ping gives up after the timeout with ETIMEOUT instead of hanging", async () => {
    jest.useFakeTimers();
    sql.connect.mockReturnValue(new Promise(() => {}));
    const r = db.ping(3000);
    jest.advanceTimersByTime(3000);
    await expect(r).resolves.toEqual({ database: "down", error: "ETIMEOUT" });
  });

  it("dials once while a connect is in flight", async () => {
    let resolve;
    sql.connect.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = db.connect();
    const b = db.connect();
    resolve({ request: jest.fn() });
    await Promise.all([a, b]);
    expect(sql.connect).toHaveBeenCalledTimes(1);
  });

  it("health caches the probe for 10 s, then probes again", async () => {
    jest.useFakeTimers();
    const query = jest.fn().mockResolvedValue({});
    sql.connect.mockResolvedValue({ request: () => ({ query }) });
    await db.health();
    await db.health();
    expect(query).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10000);
    await db.health();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("a connection failure in a stored procedure drops the cache; a query timeout does not", async () => {
    db.connected = true;
    const execute = jest.fn();
    db.pool = { request: () => ({ input: jest.fn(), execute }) };
    db.healthCheck = Promise.resolve({ database: "up" });
    db.healthAt = Date.now();

    execute.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "RequestError", code: "ETIMEOUT" }));
    await expect(db.executeStoredProcedure("sp_Slow")).rejects.toThrow();
    expect(db.healthCheck).not.toBeNull();

    execute.mockRejectedValueOnce(Object.assign(new Error("gone"), { name: "RequestError", code: "ESOCKET" }));
    await expect(db.executeStoredProcedure("sp_Thing")).rejects.toThrow();
    expect(db.healthCheck).toBeNull();
  });
});
