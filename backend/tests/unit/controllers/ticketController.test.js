jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const ticketController = require("../../../src/controllers/ticketController");
const { mockRes } = require("../../helpers/mockRes");

// Routes always run loadScope, so req.scope is present on every real request.
// Default here mirrors a Branch-scoped user (sees their branch, no ownership
// filter).
function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: {
      hierarchyLevel: 3,
      dataScope: "Branch",
      primaryBranchId: 2,
      branchIds: [2],
      ownerIds: null,
      canWriteBranchIds: [2],
      isAdmin: false,
    },
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
        [{ Id: 1, TicketNo: "TKT-000001" }],
        [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 10 }],
      ],
    });
    const req = baseReq({ body: { Priority: 4 } });
    const res = mockRes();
    await ticketController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTickets",
      expect.objectContaining({ CompId: 5, Priority: 4 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.tickets).toHaveLength(1);
    expect(json.data.pagination.totalRecords).toBe(1);
  });

  // REGRESSION: fetch used to pass req.user.BranchId as the visibility filter,
  // so the SP ran `t.BranchId = <caller's branch>` and every ticket raised in
  // another branch vanished. Visibility must come from req.scope instead.
  it("passes scope (not the caller's own BranchId) as the visibility filter", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const req = baseReq({
      scope: { branchIds: [1, 2, 3, 4, 5], ownerIds: null },
      body: {},
    });
    const res = mockRes();
    await ticketController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTickets",
      expect.objectContaining({
        UserId: 7,
        AccessibleBranchIdsJson: "[1,2,3,4,5]",
        OwnerIdsJson: null, // wide scope -> no ownership filter
        BranchId: null, // not the caller's branch
      }),
    );
  });

  it("sends an ownership filter for a Self-scoped user", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: {} });
    const res = mockRes();
    await ticketController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTickets",
      expect.objectContaining({
        AccessibleBranchIdsJson: "[2]",
        OwnerIdsJson: "[7]",
      }),
    );
  });

  it("treats BranchId in the body as a filter that narrows within scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const req = baseReq({
      scope: { branchIds: [1, 2, 3], ownerIds: null },
      body: { BranchId: 3 },
    });
    const res = mockRes();
    await ticketController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTickets",
      expect.objectContaining({ BranchId: 3, AccessibleBranchIdsJson: "[1,2,3]" }),
    );
  });

  it("falls back to defaults when body is empty and the pagination recordset is missing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [undefined] });
    const req = baseReq({ body: {} });
    const res = mockRes();
    await ticketController.fetch(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTickets",
      expect.objectContaining({ PageNumber: 1, PageSize: 10, SearchTerm: null }),
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
        [{ Id: 1, TicketNo: "TKT-000001", BranchId: 2, AssignedTo: 4, CreatedBy: 4 }],
        [{ FieldId: 2, Type: "text", ValueText: "x" }],
        [{ Id: 9, Type: "created", Summary: "created" }],
        [{ Id: 9, Name: "Acme Corp" }],
      ],
    });
    const req = baseReq({ body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);

    const json = res.json.mock.calls[0][0];
    expect(json.data.ticket).toEqual({
      Id: 1,
      TicketNo: "TKT-000001",
      BranchId: 2,
      AssignedTo: 4,
      CreatedBy: 4,
    });
    expect(json.data.fields).toHaveLength(1);
    expect(json.data.activity).toHaveLength(1);
    expect(json.data.linkedLead).toEqual({ Id: 9, Name: "Acme Corp" });
  });

  // CONTRACT CHANGE: a missing ticket used to come back 200 with ticket:null.
  // It is now a 404 — same answer as "you may not see it", so the endpoint
  // cannot be used to probe which ticket Ids exist.
  it("404s when the ticket does not exist", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[], [], [], []],
    });
    const req = baseReq({ body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s when the recordsets array is empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const req = baseReq({ body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s a ticket outside the caller's scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, BranchId: 9, AssignedTo: 4, CreatedBy: 4 }], // branch 9, not in scope
        [], [], [],
      ],
    });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: null }, body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // THE RAAJ REGRESSION, at the record level: assigned to me, but raised in a
  // branch I have no scope over. Assignment is an explicit act of sharing and
  // must beat scope, so this has to be visible.
  it("shows a ticket assigned to the caller even from an out-of-scope branch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, BranchId: 9, AssignedTo: 7, CreatedBy: 4 }],
        [], [], [],
      ],
    });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.ticket.Id).toBe(1);
  });

  it("shows a ticket the caller created but assigned to someone else", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, BranchId: 9, AssignedTo: 4, CreatedBy: 7 }],
        [], [], [],
      ],
    });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
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

  // Guard lookup: mutations now fetch the ticket (sp_FetchTicketDetail) and
  // apply canSeeRecord before running the mutating SP.
  const visibleTicket = { Id: 1, BranchId: 2, AssignedTo: 7, CreatedBy: 7 };
  function mockTicketLookup(ticket) {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [ticket ? [ticket] : [], [], [], []],
    });
  }

  it("moveStage forwards CompId/TicketId/StageId/UserId (ResolutionId defaults null)", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow);
    const req = baseReq({ body: { TicketId: 1, StageId: 3 } });
    const res = mockRes();
    await ticketController.moveStage(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_MoveTicketStage",
      { CompId: 5, TicketId: 1, StageId: 3, UserId: 7, ResolutionId: null },
    );
  });

  // Stage is the lifecycle's source of truth: a drag into a won stage carries
  // the resolution with it instead of a separate resolve step.
  it("moveStage forwards ResolutionId for drags into a won stage", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow);
    const req = baseReq({ body: { TicketId: 1, StageId: 4, ResolutionId: 2 } });
    const res = mockRes();
    await ticketController.moveStage(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_MoveTicketStage",
      { CompId: 5, TicketId: 1, StageId: 4, UserId: 7, ResolutionId: 2 },
    );
  });

  it("moveStage surfaces the SP's 400 when a won stage needs a resolution", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Resolution required", Id: 1 }],
    });
    const res = mockRes();
    await ticketController.moveStage(baseReq({ body: { TicketId: 1, StageId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // REGRESSION: the write path used to trust the client-supplied TicketId — a
  // Self-scoped agent could move/close any colleague's ticket by posting its Id.
  it("403s a mutation on a ticket the caller cannot see, without running the SP", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1, StageId: 3 } });
    const res = mockRes();
    await ticketController.moveStage(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });

  it("allows a mutation on a ticket assigned to the caller from an out-of-scope branch", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 7, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow);
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1 } });
    const res = mockRes();
    await ticketController.close(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("resolve forwards ResolutionId and surfaces a 400 when the SP requires it", async () => {
    mockTicketLookup(visibleTicket);
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

  it("resolve 403s a ticket outside the caller's scope", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.resolve(baseReq({ body: { TicketId: 1, ResolutionId: 2 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("reopen 403s a ticket outside the caller's scope", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("delete 403s a ticket outside the caller's scope", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("close/reopen/delete map to their SPs", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow);
    const res1 = mockRes();
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), res1);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_CloseTicket",
      { CompId: 5, TicketId: 1, UserId: 7 },
    );

    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow);
    const res2 = mockRes();
    await ticketController.reopen(baseReq({ body: { TicketId: 1 } }), res2);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ReopenTicket",
      { CompId: 5, TicketId: 1, UserId: 7 },
    );

    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValue(okRow);
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

// SLA was removed entirely (no rules are promised to customers): saveSLARule/
// fetchSLARules are gone from the controller and their routes deleted.
describe("ticketController SLA removal", () => {
  it("no longer exposes SLA handlers", () => {
    expect(ticketController.saveSLARule).toBeUndefined();
    expect(ticketController.fetchSLARules).toBeUndefined();
  });
});
