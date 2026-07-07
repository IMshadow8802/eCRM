jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
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

describe("configController.savePipeline", () => {
  it("calls sp_SavePipeline with CompId + CreatedBy", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 9 }],
    });
    const req = baseReq({ body: { Id: 0, Entity: "lead", Name: "Sales Pipeline" } });
    const res = mockRes();
    await configController.savePipeline(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SavePipeline",
      expect.objectContaining({ Entity: "lead", Name: "Sales Pipeline", CompId: 5, CreatedBy: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("configController.fetchPipelines", () => {
  it("calls sp_FetchPipelines with CompId+Entity", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, Name: "Sales Pipeline" }],
    });
    const req = baseReq({ body: { Entity: "deal" } });
    const res = mockRes();
    await configController.fetchPipelines(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchPipelines",
      expect.objectContaining({ CompId: 5, Entity: "deal" }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.pipelines).toEqual([{ Id: 1, Name: "Sales Pipeline" }]);
  });

  it("forwards the stages result set (2nd recordset) alongside pipelines", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, Name: "Sales Pipeline" }],
      recordsets: [
        [{ Id: 1, Name: "Sales Pipeline" }],
        [{ Id: 41, PipelineId: 1, Name: "New", SortOrder: 1 }],
      ],
    });
    const req = baseReq({ body: { Entity: "lead" } });
    const res = mockRes();
    await configController.fetchPipelines(req, res);
    const json = res.json.mock.calls[0][0];
    expect(json.data.pipelines).toEqual([{ Id: 1, Name: "Sales Pipeline" }]);
    expect(json.data.stages).toEqual([{ Id: 41, PipelineId: 1, Name: "New", SortOrder: 1 }]);
  });
});

describe("configController.saveStage", () => {
  it("calls sp_SaveStage with CompId + CreatedBy", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 4 }],
    });
    const req = baseReq({ body: { Id: 0, PipelineId: 9, Name: "Qualified" } });
    const res = mockRes();
    await configController.saveStage(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveStage",
      expect.objectContaining({ PipelineId: 9, Name: "Qualified", CompId: 5, CreatedBy: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("configController.deleteStage", () => {
  it("calls sp_DeleteStage with CompId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Deleted" }],
    });
    const req = baseReq({ body: { Id: 4 } });
    const res = mockRes();
    await configController.deleteStage(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteStage",
      expect.objectContaining({ Id: 4, CompId: 5 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("configController.saveLookup", () => {
  it("calls sp_SaveLookup with CompId + CreatedBy", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 11 }],
    });
    const req = baseReq({ body: { Id: 0, Kind: "industry", Value: "Retail" } });
    const res = mockRes();
    await configController.saveLookup(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveLookup",
      expect.objectContaining({ Kind: "industry", Value: "Retail", CompId: 5, CreatedBy: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
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
