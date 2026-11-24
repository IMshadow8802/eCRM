const { checkAccessModel, reportAccessModel, ACCESS_MODEL_OBJECTS } = require("../../../src/utils/dbReady");

const allPresent = () => Object.fromEntries(ACCESS_MODEL_OBJECTS.map((n) => [n, 1]));
const dbWith = (row) => ({ executeQuery: jest.fn().mockResolvedValue({ recordset: [row] }) });
const log = () => ({ log: jest.fn(), error: jest.fn() });

describe("checkAccessModel", () => {
  it("is ready when every object exists, and names the database reached", async () => {
    const db = dbWith({ Db: "TestCRM", ...allPresent() });
    await expect(checkAccessModel(db)).resolves.toEqual({ ready: true, missing: [], database: "TestCRM" });
    const sql = db.executeQuery.mock.calls[0][0];
    expect(sql).toContain("DB_NAME()");
    for (const n of ACCESS_MODEL_OBJECTS) expect(sql).toContain(`OBJECT_ID('dbo.${n}')`);
  });

  it("lists what is missing", async () => {
    const db = dbWith({ Db: "eCRM+", ...allPresent(), fn_ReassignGate: 0, sp_FetchLoggedByMe: 0 });
    await expect(checkAccessModel(db)).resolves.toEqual({
      ready: false,
      missing: ["sp_FetchLoggedByMe", "fn_ReassignGate"],
      database: "eCRM+",
    });
  });

  it("treats an empty answer as nothing applied", async () => {
    const db = { executeQuery: jest.fn().mockResolvedValue({}) };
    const r = await checkAccessModel(db);
    expect(r).toMatchObject({ ready: false, missing: ACCESS_MODEL_OBJECTS, database: null });
  });

  it("a query error resolves { ready:false } and never throws", async () => {
    const err = new Error("ESOCKET");
    const db = { executeQuery: jest.fn().mockRejectedValue(err) };
    const r = await checkAccessModel(db);
    expect(r).toMatchObject({ ready: false, missing: ACCESS_MODEL_OBJECTS, database: null, error: err });
  });
});

describe("reportAccessModel", () => {
  it("logs the database and no error when ready", async () => {
    const l = log();
    await reportAccessModel(dbWith({ Db: "TestCRM", ...allPresent() }), "ignored", l);
    expect(l.log).toHaveBeenCalledWith("🗄️  Connected database: TestCRM");
    expect(l.error).not.toHaveBeenCalled();
  });

  it("prints the NOT APPLIED line with the real database name", async () => {
    const l = log();
    await reportAccessModel(dbWith({ Db: "eCRM+", ...allPresent(), fn_VisibleLeads: 0 }), "TestCRM", l);
    expect(l.error).toHaveBeenCalledWith(
      "ACCESS MODEL NOT APPLIED on eCRM+: missing fn_VisibleLeads - leads and complaints will error until scripts 130-134 are applied",
    );
  });

  it("on a query failure falls back to the env name and adds the error", async () => {
    const l = log();
    await reportAccessModel({ executeQuery: jest.fn().mockRejectedValue(new Error("down")) }, "TestCRM", l);
    expect(l.log).not.toHaveBeenCalled();
    const line = l.error.mock.calls[0][0];
    expect(line).toMatch(/^ACCESS MODEL NOT APPLIED on TestCRM: missing fn_VisibleTickets, /);
    expect(line).toMatch(/\(check failed: down\)$/);
  });
});
