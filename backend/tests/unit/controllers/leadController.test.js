jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const leadController = require("../../../src/controllers/leadController");
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

describe("leadController.save", () => {
  it("injects CompId/BranchId/UserId and passes CustomJSON through unchanged", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 42 }],
    });
    const req = baseReq({
      body: {
        Id: 0,
        Name: "Acme Corp",
        MobileNo: "9999999999",
        SourceId: 1,
        PipelineId: 1,
        StageId: 2,
        CustomJSON: '[{"fieldId":3,"type":"text","value":"blue"}]',
      },
    });
    const res = mockRes();
    await leadController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveLead",
      expect.objectContaining({
        Id: 0,
        CompId: 5,
        BranchId: 2,
        UserId: 7,
        Name: "Acme Corp",
        CustomJSON: '[{"fieldId":3,"type":"text","value":"blue"}]',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].data.Id).toBe(42);
  });

  it("returns error status when SP rejects (e.g. validation failure)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Name required" }],
    });
    const req = baseReq({ body: { Id: 0 } });
    const res = mockRes();
    await leadController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 0, Name: "X" } });
    const res = mockRes();
    await leadController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.fetch", () => {
  it("forwards CompId/BranchId + optional filters and maps rows + pagination recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, Name: "Acme" }, { Id: 2, Name: "Beta" }],
        [{ TotalRecords: 2, TotalPages: 1, CurrentPage: 1, PageSize: 10 }],
      ],
    });
    const req = baseReq({
      body: { PageNumber: 1, PageSize: 10, StageId: 2, OwnerId: 3, SourceId: 1, SearchTerm: "ac" },
    });
    const res = mockRes();
    await leadController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({
        CompId: 5,
        BranchId: 2,
        PageNumber: 1,
        PageSize: 10,
        StageId: 2,
        OwnerId: 3,
        SourceId: 1,
        SearchTerm: "ac",
      }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.leads).toHaveLength(2);
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 2,
      totalPages: 1,
    });
  });

  it("defaults paging/filter params and pagination when recordsets are sparse", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = baseReq();
    const res = mockRes();
    await leadController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({ PageNumber: 1, PageSize: 10, SearchTerm: null }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.leads).toEqual([]);
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 0,
      totalPages: 1,
    });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();
    await leadController.fetch(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.detail", () => {
  it("maps the 3 recordsets to {lead, fields, activity}", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 9, Name: "Acme" }],
        [{ FieldId: 1, Label: "Budget", ValueNumber: 5000 }],
        [{ Action: "created", CreatedAt: "2026-01-01" }],
      ],
    });
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeadDetail",
      expect.objectContaining({ CompId: 5, LeadId: 9 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.lead).toEqual({ Id: 9, Name: "Acme" });
    expect(json.data.fields).toEqual([{ FieldId: 1, Label: "Budget", ValueNumber: 5000 }]);
    expect(json.data.activity).toEqual([{ Action: "created", CreatedAt: "2026-01-01" }]);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.moveStage", () => {
  it("returns 400 when SP rejects lost-without-reason", async () => {
    database.executeStoredProcedure.mockResolvedValue({
      recordset: [{ ResponseCode: 400, ResponseMess: "Lost reason required" }],
    });
    const res = mockRes();
    await leadController.moveStage(
      { user: { CompId: 1, UserId: 2 }, body: { LeadId: 9, StageId: 5 } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp_MoveLeadStage with CompId/UserId injected and succeeds", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Stage updated", Id: 9 }],
    });
    const req = baseReq({ body: { LeadId: 9, StageId: 3 } });
    const res = mockRes();
    await leadController.moveStage(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_MoveLeadStage",
      expect.objectContaining({ CompId: 5, LeadId: 9, StageId: 3, LostReasonId: null, UserId: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("leadController.transfer", () => {
  it("calls sp_TransferLead with CompId/UserId injected", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Transferred", Id: 9 }],
    });
    const req = baseReq({ body: { LeadId: 9, OwnerId: 4 } });
    const res = mockRes();
    await leadController.transfer(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_TransferLead",
      expect.objectContaining({ CompId: 5, LeadId: 9, OwnerId: 4, UserId: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { LeadId: 9, OwnerId: 4 } });
    const res = mockRes();
    await leadController.transfer(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.delete", () => {
  it("calls sp_DeleteLead with Id first, then CompId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Deleted" }],
    });
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteLead", { Id: 9, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("falls back to ResponseMessage when ResponseMess is absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMessage: "Deleted via ResponseMessage" }],
    });
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(res.json.mock.calls[0][0].message).toBe("Deleted via ResponseMessage");
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
