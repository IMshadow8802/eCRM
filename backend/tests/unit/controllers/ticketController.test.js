jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const ticketController = require("../../../src/controllers/ticketController");
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

describe("ticketController.save", () => {
  it("injects CompId/BranchId/UserId, defaults Id=0, forwards CustomJSON + LinkedLeadId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Ticket saved successfully", Id: 12, TicketNo: "TKT-000012" }],
    });
    const req = baseReq({
      body: {
        CustomerName: "Acme",
        Priority: 4,
        LinkedLeadId: 9,
        CustomJSON: '[{"fieldId":1,"type":"text","value":"x"}]',
      },
    });
    const res = mockRes();
    await ticketController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveTicket",
      expect.objectContaining({
        Id: 0,
        CompId: 5,
        BranchId: 2,
        UserId: 7,
        CustomerName: "Acme",
        Priority: 4,
        LinkedLeadId: 9,
        CustomJSON: '[{"fieldId":1,"type":"text","value":"x"}]',
      }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data.TicketNo).toBe("TKT-000012");
  });

  it("returns the SP error status when the SP rejects", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "CompId is required" }],
    });
    const req = baseReq({ body: {} });
    const res = mockRes();
    await ticketController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { CustomerName: "Acme" } });
    const res = mockRes();
    await ticketController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.fetch", () => {
  it("forwards filters + pagination and maps two recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, TicketNo: "TKT-000001", IsBreached: true }],
        [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 10 }],
      ],
    });
    const req = baseReq({ body: { BreachedOnly: 1, Priority: 4 } });
    const res = mockRes();
    await ticketController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTickets",
      expect.objectContaining({ CompId: 5, BranchId: 2, BreachedOnly: 1, Priority: 4 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.tickets).toHaveLength(1);
    expect(json.data.pagination.totalRecords).toBe(1);
  });

  it("falls back to defaults when body is empty and the pagination recordset is missing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [undefined] });
    const req = baseReq({ body: {} });
    const res = mockRes();
    await ticketController.fetch(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTickets",
      expect.objectContaining({ PageNumber: 1, PageSize: 10, BreachedOnly: 0, SearchTerm: null }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.tickets).toEqual([]);
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
    await ticketController.fetch(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.detail", () => {
  it("maps 4 recordsets to ticket/fields/activity/linkedLead", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, TicketNo: "TKT-000001" }],
        [{ FieldId: 2, Type: "text", ValueText: "x" }],
        [{ Id: 9, Type: "created", Summary: "created" }],
        [{ Id: 9, Name: "Acme Corp" }],
      ],
    });
    const req = baseReq({ body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);

    const json = res.json.mock.calls[0][0];
    expect(json.data.ticket).toEqual({ Id: 1, TicketNo: "TKT-000001" });
    expect(json.data.fields).toHaveLength(1);
    expect(json.data.activity).toHaveLength(1);
    expect(json.data.linkedLead).toEqual({ Id: 9, Name: "Acme Corp" });
  });

  it("null-safes ticket + linkedLead when recordsets are empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[], [], [], []],
    });
    const req = baseReq({ body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);
    const json = res.json.mock.calls[0][0];
    expect(json.data.ticket).toBeNull();
    expect(json.data.linkedLead).toBeNull();
  });

  it("null-safes every field when the recordsets array is empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const req = baseReq({ body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);
    const json = res.json.mock.calls[0][0];
    expect(json.data).toEqual({ ticket: null, fields: [], activity: [], linkedLead: null });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController stage/resolve/close/reopen/delete", () => {
  const okRow = { recordset: [{ ResponseCode: 200, ResponseMess: "ok", Id: 1 }] };

  it("moveStage forwards CompId/TicketId/StageId/UserId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow);
    const req = baseReq({ body: { TicketId: 1, StageId: 3 } });
    const res = mockRes();
    await ticketController.moveStage(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_MoveTicketStage",
      { CompId: 5, TicketId: 1, StageId: 3, UserId: 7 },
    );
  });

  it("resolve forwards ResolutionId and surfaces a 400 when the SP requires it", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Resolution is required", Id: 1 }],
    });
    const req = baseReq({ body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.resolve(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ResolveTicket",
      expect.objectContaining({ CompId: 5, TicketId: 1, UserId: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("close/reopen/delete map to their SPs", async () => {
    database.executeStoredProcedure.mockResolvedValue(okRow);
    const res1 = mockRes();
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), res1);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_CloseTicket",
      { CompId: 5, TicketId: 1, UserId: 7 },
    );
    const res2 = mockRes();
    await ticketController.reopen(baseReq({ body: { TicketId: 1 } }), res2);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ReopenTicket",
      { CompId: 5, TicketId: 1, UserId: 7 },
    );
    const res3 = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res3);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteTicket",
      { Id: 1, CompId: 5 },
    );
  });

  it("handles DB error as 500 on a mutating call", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController SLA rules", () => {
  it("saveSLARule injects CompId/UserId + defaults Id=0", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "ok", Id: 3 }],
    });
    const req = baseReq({ body: { Priority: 4, ResolutionMins: 240 } });
    const res = mockRes();
    await ticketController.saveSLARule(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveSLARule",
      expect.objectContaining({ Id: 0, CompId: 5, UserId: 7, Priority: 4, ResolutionMins: 240 }),
    );
  });

  it("fetchSLARules returns the recordset under slaRules", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, Priority: 4, PriorityName: "urgent", ResolutionMins: 240 }],
    });
    const req = baseReq();
    const res = mockRes();
    await ticketController.fetchSLARules(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchSLARules", { CompId: 5 });
    expect(res.json.mock.calls[0][0].data.slaRules).toHaveLength(1);
  });

  it("fetchSLARules defaults to an empty list when the recordset is missing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({});
    const res = mockRes();
    await ticketController.fetchSLARules(baseReq(), res);
    expect(res.json.mock.calls[0][0].data.slaRules).toEqual([]);
  });

  it("saveSLARule uses ResponseMessage when the SP omits ResponseMess", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMessage: "Saved via ResponseMessage", Id: 4 }],
    });
    const res = mockRes();
    await ticketController.saveSLARule(baseReq({ body: { Priority: 4 } }), res);
    expect(res.json.mock.calls[0][0].message).toBe("Saved via ResponseMessage");
  });

  it("handles DB error as 500 on fetchSLARules", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.fetchSLARules(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
