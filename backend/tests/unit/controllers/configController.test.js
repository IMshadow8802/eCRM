jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
// Without this, every runSp(req, log) call fires a second, unrelated
// sp_SaveActivityLog call through the same mocked database — which the new
// "nulls a 0 / blank / junk TatHours" test's exhaustive mock.calls walk would
// trip over. Every other controller test file in this suite already mocks
// this the same way.
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: { CREATED: "Created", UPDATED: "Updated", DELETED: "Deleted" },
}));

const database = require("../../../src/config/database");
const { configController } = require("../../../src/controllers/configController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    body: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

describe("configController.fetchCustomFields", () => {
  it("calls sp_FetchCustomFields with CompId+Entity and returns rows", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordset: [{ Id: 1, Label: "Budget" }] });
    const req = { user: { CompId: 5 }, body: { Entity: "lead" } };
    const res = mockRes();
    await configController.fetchCustomFields(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchCustomFields",
      expect.objectContaining({ CompId: 5, Entity: "lead" }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const json = res.json.mock.calls[0][0];
    expect(json.data.customFields).toEqual([{ Id: 1, Label: "Budget" }]);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Entity: "lead" } });
    const res = mockRes();
    await configController.fetchCustomFields(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("configController.saveCustomField", () => {
  it("injects CompId + CreatedBy and returns success on ResponseCode 200", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 3 }],
    });
    const req = baseReq({ body: { Id: 0, Entity: "lead", Label: "Budget", FieldType: "number" } });
    const res = mockRes();
    await configController.saveCustomField(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveCustomField",
      expect.objectContaining({
        Entity: "lead",
        Label: "Budget",
        FieldType: "number",
        CompId: 5,
        CreatedBy: 7,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("returns error when SP ResponseCode is not 200", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Label required" }],
    });
    const req = baseReq({ body: { Entity: "lead" } });
    const res = mockRes();
    await configController.saveCustomField(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.message).toBe("Label required");
  });
});

describe("configController.deleteCustomField", () => {
  it("calls sp_DeleteCustomField with CompId and returns success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Deleted" }],
    });
    const req = baseReq({ body: { Id: 3 } });
    const res = mockRes();
    await configController.deleteCustomField(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteCustomField",
      expect.objectContaining({ Id: 3, CompId: 5 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 3 } });
    const res = mockRes();
    await configController.deleteCustomField(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("configController.saveLookup", () => {
  const okRow = (extra = {}) => ({
    recordset: [{ Id: 11, ResponseCode: 200, ResponseMess: "Saved", ...extra }],
  });

  it("calls sp_SaveLookup with CompId, defaulting SortOrder, Code and TatHours (no CreatedBy — the SP doesn't declare it)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const req = baseReq({ body: { Id: 0, Kind: "industry", Value: "Retail" } });
    const res = mockRes();
    await configController.saveLookup(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveLookup", {
      Id: 0, CompId: 5, Kind: "industry", Value: "Retail", SortOrder: 0, Code: null, TatHours: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("sends exactly the SP's parameters, Code included, and drops unknown keys", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 3, ResponseMess: "Lookup created successfully" }));
    const req = baseReq({ body: { Id: 0, Kind: "lead_status", Value: "Warm", SortOrder: 3, Code: "open", Junk: 1 } });
    await configController.saveLookup(req, mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveLookup", {
      Id: 0, CompId: 5, Kind: "lead_status", Value: "Warm", SortOrder: 3, Code: "open", TatHours: null,
    });
  });

  // Spec 2 §1: TAT = hours per priority, stored on the lookup row. The web
  // sends it from a number field, so it may arrive as a string.
  it("forwards TatHours as an int for a priority", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 3 }));
    const req = baseReq({ body: { Id: "3", Kind: "priority", Value: "High", SortOrder: 3, TatHours: "24" } });
    await configController.saveLookup(req, mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveLookup", {
      Id: 3, CompId: 5, Kind: "priority", Value: "High", SortOrder: 3, Code: null, TatHours: 24,
    });
  });

  // No TAT = DueAt NULL = never overdue (spec §1). A zero-hour TAT is not a thing.
  it("nulls a 0 / blank / junk TatHours", async () => {
    database.executeStoredProcedure.mockResolvedValue(okRow());
    for (const TatHours of [0, "", "abc", -4]) {
      await configController.saveLookup(baseReq({ body: { Kind: "priority", Value: "Low", TatHours } }), mockRes());
    }
    for (const [, params] of database.executeStoredProcedure.mock.calls) expect(params.TatHours).toBeNull();
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(4);
  });

  // ticket_status rows carry a Code like lead_status (spec §1). The SP owns the
  // allowed set and answers 400 — surfaced with its message, not flattened.
  it("surfaces the SP's 400 for a ticket_status code outside the allowed set", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 0, ResponseCode: 400, ResponseMess: "Code must be one of open, onhold, resolved, closed, rejected" }],
    });
    const res = mockRes();
    await configController.saveLookup(baseReq({ body: { Kind: "ticket_status", Value: "Parked", Code: "paused" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR", message: expect.stringMatching(/open, onhold/) });
  });
});

describe("configController.fetchLookups", () => {
  it("calls sp_FetchLookups with CompId+Kind", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, Value: "Retail" }],
    });
    const req = baseReq({ body: { Kind: "industry" } });
    const res = mockRes();
    await configController.fetchLookups(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLookups",
      expect.objectContaining({ CompId: 5, Kind: "industry" }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.lookups).toEqual([{ Id: 1, Value: "Retail" }]);
  });
});

describe("configController fallback branches", () => {
  it("fetchLookups defaults to an empty list when recordset is missing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({});
    const req = baseReq({ body: { Kind: "industry" } });
    const res = mockRes();
    await configController.fetchLookups(req, res);
    const json = res.json.mock.calls[0][0];
    expect(json.data.lookups).toEqual([]);
  });

  it("saveLookup falls back to ResponseMessage when ResponseMess is absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMessage: "Saved via ResponseMessage", Id: 12 }],
    });
    const req = baseReq({ body: { Kind: "industry", Value: "Manufacturing" } });
    const res = mockRes();
    await configController.saveLookup(req, res);
    const json = res.json.mock.calls[0][0];
    expect(json.message).toBe("Saved via ResponseMessage");
  });
});

describe("configController.deleteLookup", () => {
  it("calls sp_DeleteLookup with CompId and returns success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Deleted" }],
    });
    const req = baseReq({ body: { Id: 11 } });
    const res = mockRes();
    await configController.deleteLookup(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteLookup",
      expect.objectContaining({ Id: 11, CompId: 5 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 11 } });
    const res = mockRes();
    await configController.deleteLookup(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// 086 drops the pipeline engine: sp_SavePipeline / sp_FetchPipelines /
// sp_SaveStage / sp_DeleteStage and the two tables. The handlers go with them.
describe("configController pipeline removal", () => {
  it("no longer exposes the pipeline handlers", () => {
    for (const m of ["savePipeline", "fetchPipelines", "saveStage", "deleteStage"]) {
      expect(configController[m]).toBeUndefined();
    }
  });
});
