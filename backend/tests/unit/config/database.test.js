// Regression: timestamps showed +5:30 in the browser because node-mssql
// defaulted useUTC:true and re-tagged SQL Server's IST wall-clock as UTC.
// With useUTC:false + container TZ=Asia/Kolkata, DATETIME round-trips as IST.
jest.mock("mssql", () => ({ connect: jest.fn() }));

const db = require("../../../src/config/database");

describe("database config", () => {
  it("reads DATETIME in local time (useUTC:false) so IST timestamps are not mislabelled UTC", () => {
    expect(db.config.options.useUTC).toBe(false);
  });
});
