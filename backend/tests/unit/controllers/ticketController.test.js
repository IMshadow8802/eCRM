jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const ticketController = require("../../../src/controllers/ticketController");
const { mockRes } = require("../../helpers/mockRes");

// Routes always run loadScope, so req.scope is present on every real request.
// Default here mirrors a Branch-scoped user (sees their branch, no ownership
// filter, and wide enough for assertCanAssign's manager-only checks).
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

// Guard lookup: mutations fetch the ticket (sp_FetchTicketDetail — five
// recordsets since 086: core, custom values, timeline, assignments, linked
// lead) and apply canSeeRecord before running the mutating SP.
function mockTicketLookup(ticket) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ticket ? [ticket] : [], [], [], [], []],
  });
}
const visibleTicket = { Id: 1, BranchId: 2, AssignedTo: 7, CreatedBy: 7 };

// assertCanAssign's roster lookup (sp_FetchAssignableUsers).
function mockRoster(...ids) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ids.map((Id) => ({ Id }))],
  });
}

const okRow = (extra = {}) => ({
  recordset: [{ Id: 1, ResponseCode: 200, ResponseMess: "ok", ...extra }],
});

const CREATE_BODY = {
  CustomerId: 31, Subject: "  Inverter trips at noon ", ContactPerson: "Rakesh", Contact: "9876543210",
  ChannelId: 51, CategoryId: 7, Priority: 3, ProductId: 2, AssignedTo: 18, LinkedLeadId: 9,
  Description: "Trips daily around 12:30", CustomJSON: '[{"fieldId":1,"type":"text","value":"x"}]',
};

describe("ticketController.save — create", () => {
  it("injects Id=0/CompId/BranchId/UserId, trims Subject, forwards exactly sp_SaveTicket's columns, echoes TicketNo", async () => {
    mockRoster(18); // AssignedTo 18 is assignable by the caller
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 12, TicketNo: "TKT-000012" }));
    const res = mockRes();
    await ticketController.save(baseReq({ body: CREATE_BODY }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SaveTicket", {
      Id: 0, CompId: 5, BranchId: 2, UserId: 7,
      CustomerId: 31, Subject: "Inverter trips at noon", ContactPerson: "Rakesh", Contact: "9876543210",
      ChannelId: 51, CategoryId: 7, Priority: 3, ProductId: 2, AssignedTo: 18, LinkedLeadId: 9,
      Description: "Trips daily around 12:30", CustomJSON: '[{"fieldId":1,"type":"text","value":"x"}]',
    });
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data.TicketNo).toBe("TKT-000012");
  });

  // 086 drops CustomerName / Channel / PipelineId / StageId. A stale client
  // still sending them must not blow up the call — node-mssql rejects an
  // undeclared parameter outright — and the body never names its own tenant.
  it("drops the retired columns and unknown keys; the body cannot override CompId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(
      baseReq({ body: { ...CREATE_BODY, AssignedTo: null, CustomerName: "Acme", Channel: "Phone", PipelineId: 1, StageId: 2, CompId: 999, CreatedBy: 1, Nonsense: "x" } }),
      mockRes(),
    );
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.CompId).toBe(5);
    for (const k of ["CustomerName", "Channel", "PipelineId", "StageId", "CreatedBy", "Nonsense"]) {
      expect(params).not.toHaveProperty(k);
    }
  });

  // Spec §3: the two things a complaint cannot exist without.
  it("400s without a CustomerId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, CustomerId: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR", message: "CustomerId is required" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a Subject (blank counts as missing)", async () => {
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, Subject: "   " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Subject is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("normalises id fields: a select's empty string and junk become null, numeric strings become ints", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(
      baseReq({ body: { CustomerId: "31", Subject: "x", CategoryId: "", Priority: "3", ProductId: "abc", ChannelId: 0 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // no roster call: AssignedTo is null
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      CustomerId: 31, CategoryId: null, Priority: 3, ProductId: null, ChannelId: null, AssignedTo: null, LinkedLeadId: null,
    });
  });

  // Assigning on create is an assignment: same roster rule as transfer.
  it("403s a create assigned to someone outside the caller's roster, never calling sp_SaveTicket", async () => {
    mockRoster(4); // not 18
    const res = mockRes();
    await ticketController.save(baseReq({ body: CREATE_BODY }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // roster only
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_SaveTicket", expect.anything());
  });

  it("skips the roster check for an unassigned create", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure.mock.calls[0][0]).toBe("sp_SaveTicket");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // The SP checks the customer is active and in this company (spec §3: 404).
  it("surfaces the SP's 404 for a customer outside the company", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 0, ResponseCode: 404, ResponseMess: "Customer not found" }],
    });
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null, CustomerId: 999 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR" });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.save — update", () => {
  // Ownership moves through transfer (history + notification), status through
  // setStatus (guards). An edit must not be a side door for either.
  it("gates on the ticket, then saves with AssignedTo dropped and no status key", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(baseReq({ body: { Id: "1", ...CREATE_BODY, AssignedTo: 18, StatusId: 99 } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // lookup + save; no roster
    const [sp, params] = database.executeStoredProcedure.mock.calls[1];
    expect(sp).toBe("sp_SaveTicket");
    expect(params).toMatchObject({ Id: 1, CompId: 5, AssignedTo: null, CustomerId: 31, Subject: "Inverter trips at noon" });
    expect(params).not.toHaveProperty("StatusId");
  });

  // REGRESSION: save was once the one mutating endpoint with no guard — any
  // authenticated user could POST {Id} and rewrite a ticket they cannot read.
  it("403s an update on a ticket the caller cannot see, without running the SP", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.save(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Id: 1, Subject: "hijacked" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // the lookup only
  });

  it("allows an update on a ticket assigned to the caller from an out-of-scope branch", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 7, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.save(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Id: 1, Description: "more detail" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("ticketController.fetch", () => {
  // REGRESSION: fetch used to pass req.user.BranchId as the visibility filter,
  // so every ticket raised in another branch vanished. Visibility comes from
  // req.scope; BranchId in the body is a filter that narrows within it.
  it("passes scope (not the caller's own BranchId); defaults paging to 1/25 and every filter to null / 0 — the full sp_FetchTickets contract", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(baseReq({ scope: { branchIds: [1, 2, 3, 4, 5], ownerIds: null } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchTickets", {
      CompId: 5, BranchId: null, PageNumber: 1, PageSize: 25, SearchTerm: null,
      StatusId: null, StatusCode: null, Priority: null, CategoryId: null, ChannelId: null, ProductId: null,
      CustomerId: null, AssignedTo: null, Overdue: 0, Escalated: 0, Unassigned: 0, FromDate: null, ToDate: null,
      UserId: 7, AccessibleBranchIdsJson: "[1,2,3,4,5]", OwnerIdsJson: null,
    });
  });

  it("sends an ownership filter for a Self-scoped agent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(baseReq({ scope: { branchIds: [2], ownerIds: [7] } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]" });
  });

  // The web presets (spec §4) arrive as these params: My queue = AssignedTo,
  // Unassigned / Overdue / Escalated = bits, On hold / Closed = StatusCode.
  it("maps the preset params: bits to 1, codes lower-cased, ids to ints, ISO dates through, search trimmed", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(
      baseReq({
        body: {
          StatusCode: " Active ", StatusId: "61", Overdue: true, Escalated: 1, Unassigned: "true",
          AssignedTo: "18", CustomerId: 31, ChannelId: 51, ProductId: 2, CategoryId: 7, Priority: "4",
          FromDate: "2026-09-01", ToDate: "2026-09-16", BranchId: 3, SearchTerm: " inverter ",
        },
      }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      StatusCode: "active", StatusId: 61, Overdue: 1, Escalated: 1, Unassigned: 1,
      AssignedTo: 18, CustomerId: 31, ChannelId: 51, ProductId: 2, CategoryId: 7, Priority: 4,
      FromDate: "2026-09-01", ToDate: "2026-09-16", BranchId: 3, SearchTerm: "inverter",
    });
  });

  it("treats 'false' / '0' as 0 and nulls a non-ISO or impossible date", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(
      baseReq({ body: { Overdue: "false", Escalated: "0", Unassigned: 0, FromDate: "01/09/2026", ToDate: "2026-02-30", StatusCode: "" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      Overdue: 0, Escalated: 0, Unassigned: 0, FromDate: null, ToDate: null, StatusCode: null,
    });
  });

  // REGRESSION (controllerKit): PageSize went straight to the SP, so one
  // request could ask SQL Server for every row the scope allows.
  it("clamps PageSize to 200 and echoes the clamped value", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const res = mockRes();
    await ticketController.fetch(baseReq({ body: { PageNumber: 2, PageSize: 99999 } }), res);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ PageNumber: 2, PageSize: 200 });
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 2, pageSize: 200, totalRecords: 0, totalPages: 1 });
  });

  it("maps rows + the pagination recordset", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, TicketNo: "TKT-000001", StatusCode: "open", IsOverdue: true }],
        [{ CurrentPage: 1, PageSize: 25, TotalRecords: 1, TotalPages: 1 }],
      ],
    });
    const res = mockRes();
    await ticketController.fetch(baseReq(), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.tickets).toHaveLength(1);
    expect(data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });

  it("falls back to defaults when the pagination recordset is missing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [undefined] });
    const res = mockRes();
    await ticketController.fetch(baseReq(), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.tickets).toEqual([]);
    expect(data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 0, totalPages: 1 });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.detail", () => {
  it("maps the five recordsets to ticket / fields / activity / assignments / linkedLead", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, TicketNo: "TKT-000001", BranchId: 2, AssignedTo: 4, CreatedBy: 4, CustomerName: "Sharma Traders", PreviousTickets: 2 }],
        [{ FieldId: 2, Type: "text", ValueText: "x" }],
        [{ Id: 9, Type: "created", Summary: "created" }],
        [{ Id: 3, FromUserId: null, ToUserId: 4, Reason: "Absent" }],
        [{ Id: 9, Name: "Acme Corp" }],
      ],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: "1" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchTicketDetail", { CompId: 5, TicketId: 1 });
    const { data } = res.json.mock.calls[0][0];
    expect(data.ticket.TicketNo).toBe("TKT-000001");
    expect(data.fields).toHaveLength(1);
    expect(data.activity).toHaveLength(1);
    expect(data.assignments).toEqual([{ Id: 3, FromUserId: null, ToUserId: 4, Reason: "Absent" }]);
    expect(data.linkedLead).toEqual({ Id: 9, Name: "Acme Corp" });
  });

  it("returns linkedLead null and empty lists when the tail recordsets are absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, BranchId: 2, AssignedTo: 7, CreatedBy: 7 }]],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.fields).toEqual([]);
    expect(data.assignments).toEqual([]);
    expect(data.linkedLead).toBeNull();
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.detail(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // A missing ticket and a forbidden one give the same answer, so the endpoint
  // cannot be used to probe which ids exist.
  it("404s when the ticket does not exist", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [], [], [], []] });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s when the recordsets array is empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s a ticket outside the caller's scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, BranchId: 9, AssignedTo: 4, CreatedBy: 4 }], [], [], [], []],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ scope: { branchIds: [2], ownerIds: null }, body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // Assignment is an explicit act of sharing and must beat scope.
  it("shows a ticket assigned to the caller even from an out-of-scope branch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, BranchId: 9, AssignedTo: 7, CreatedBy: 4 }], [], [], [], []],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.ticket.Id).toBe(1);
  });

  it("shows a ticket the caller created but assigned to someone else", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, BranchId: 9, AssignedTo: 4, CreatedBy: 7 }], [], [], [], []],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ---- Lifecycle (spec 2 §2): one engine, sp_SetTicketStatus, plus four
// shortcuts that delegate to it inside SQL. Node validates SHAPE (ids) and
// answers the reopen gate; every lifecycle rule — remarks required, resolution
// required, "is this move a reopen" — is the SP's, and its 400 / 403 comes
// back untouched. Node never inspects a status code.

// A Team lead over users 17 and 18, and a Self agent (user 7 in both cases).
const teamLeadReq = (body) =>
  baseReq({ scope: { dataScope: "Team", branchIds: [2], ownerIds: [7, 17, 18] }, body });
const selfReq = (body) =>
  baseReq({ scope: { dataScope: "Self", branchIds: [2], ownerIds: [7] }, body });
const subordinatesTicket = { Id: 1, BranchId: 2, AssignedTo: 17, CreatedBy: 17 };
const unassignedOwnTicket = { Id: 1, BranchId: 2, AssignedTo: null, CreatedBy: 7 };
const strangersTicket = { Id: 1, BranchId: 2, AssignedTo: 3, CreatedBy: 3 };

describe("ticketController.setStatus", () => {
  it("gates on the ticket, then calls sp_SetTicketStatus with exactly its params — AllowReopen 1 for a Branch manager", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Status: New → Resolved" }));
    const res = mockRes();
    await ticketController.setStatus(
      baseReq({ body: { TicketId: "1", StatusId: "64", ResolutionId: 8, Remarks: "  Replaced the fuse " } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SetTicketStatus", {
      CompId: 5, TicketId: 1, StatusId: 64, UserId: 7, ResolutionId: 8, Remarks: "Replaced the fuse", AllowReopen: 1,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // lookup + status
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Status: New → Resolved");
  });

  it("nulls a blank Remarks and a junk ResolutionId rather than sending '' / NaN", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(
      baseReq({ body: { TicketId: 1, StatusId: 62, ResolutionId: "", Remarks: "   " } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ ResolutionId: null, Remarks: null });
  });

  // Spec §3 Rules — Reopen. canReopen answers on every call; the SP applies it
  // only when the requested move IS a reopen. Node never reads the status code.
  it("passes AllowReopen 0 for a Self agent on their own ticket", async () => {
    mockTicketLookup(visibleTicket); // assigned to 7 = the caller
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(selfReq({ TicketId: 1, StatusId: 62 }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 0 });
  });

  it("passes AllowReopen 1 for a Team lead on a subordinate's ticket", async () => {
    mockTicketLookup(subordinatesTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(teamLeadReq({ TicketId: 1, StatusId: 62 }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 1 });
  });

  it("passes AllowReopen 0 for a Team lead on an unassigned ticket they created", async () => {
    mockTicketLookup(unassignedOwnTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(teamLeadReq({ TicketId: 1, StatusId: 62 }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 0 });
  });

  // The SP owns the rule table (spec §2). Its answers must reach the client
  // with their message — the web shows them in a toast.
  it("surfaces the SP's 403 when a non-manager's move turns out to be a reopen", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 403, ResponseMess: "Reopening requires a manager" }],
    });
    const res = mockRes();
    await ticketController.setStatus(selfReq({ TicketId: 1, StatusId: 61, Remarks: "please" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR", message: "Reopening requires a manager" });
  });

  it("surfaces the SP's 400 when remarks are missing on a terminal move", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Remarks are required" }],
    });
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 66 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Remarks are required");
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { StatusId: 62 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR", message: "TicketId is required" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a StatusId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: "abc" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("StatusId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // REGRESSION: the write path once trusted the client-supplied TicketId — a
  // Self agent could restatus any colleague's complaint by posting its Id.
  it("403s a ticket the caller cannot see, without running the mutation", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.setStatus(selfReq({ TicketId: 1, StatusId: 62 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });

  it("403s an unknown ticket id from the guard (no row = no access, so ids cannot be probed)", async () => {
    mockTicketLookup(null);
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 999, StatusId: 62 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_SetTicketStatus", expect.anything());
  });

  it("handles a DB error on the mutation as 500", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 62 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// Shortcuts: each is "first status of that code by SortOrder" inside SQL and
// delegates to sp_SetTicketStatus. Mobile uses them; the web uses setStatus.
describe("ticketController.resolve", () => {
  it("gates, then calls sp_ResolveTicket with exactly its params — no AllowReopen (the SP does not declare it)", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.resolve(baseReq({ body: { TicketId: 1, ResolutionId: "8", Remarks: "Fixed" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ResolveTicket", {
      CompId: 5, TicketId: 1, ResolutionId: 8, Remarks: "Fixed", UserId: 7,
    });
    expect(database.executeStoredProcedure.mock.calls[1][1]).not.toHaveProperty("AllowReopen");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §6: resolve without resolution → 400. It is the SP's 400, not Node's:
  // sp_SetTicketStatus may also take the ticket's EXISTING ResolutionId, so
  // the controller cannot know the answer.
  it("surfaces the SP's 400 when no resolution is given", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "A resolution is required to resolve a complaint" }],
    });
    const res = mockRes();
    await ticketController.resolve(baseReq({ body: { TicketId: 1, Remarks: "done" } }), res);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ ResolutionId: null });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/resolution is required/);
  });

  it("403s a ticket outside the caller's scope, lookup only", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.resolve(baseReq({ body: { TicketId: 1, ResolutionId: 8, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("ticketController.close", () => {
  it("calls sp_CloseTicket with nulls for the optional resolution + remarks", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_CloseTicket", {
      CompId: 5, TicketId: 1, UserId: 7, ResolutionId: null, Remarks: null,
    });
  });

  it("forwards ResolutionId + Remarks for a straight-to-closed move", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.close(
      baseReq({ body: { TicketId: 1, ResolutionId: 8, Remarks: "Customer confirmed on call" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ ResolutionId: 8, Remarks: "Customer confirmed on call" });
  });

  // Assignment is an explicit act of sharing and beats scope.
  it("allows a close on a ticket assigned to the caller from an out-of-scope branch", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 7, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.close(selfReq({ TicketId: 1 }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("handles a DB error on the guard lookup as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("ticketController.reject", () => {
  it("calls sp_RejectTicket with exactly its params", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.reject(baseReq({ body: { TicketId: 1, Remarks: " Out of warranty " } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_RejectTicket", {
      CompId: 5, TicketId: 1, Remarks: "Out of warranty", UserId: 7,
    });
    expect(database.executeStoredProcedure.mock.calls[1][1]).not.toHaveProperty("AllowReopen");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §6: reject without remarks → 400, from the SP (remarks required on `rejected`).
  it("surfaces the SP's 400 when remarks are missing", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Remarks are required to reject a complaint" }],
    });
    const res = mockRes();
    await ticketController.reject(baseReq({ body: { TicketId: 1 } }), res);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ Remarks: null });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("403s a ticket outside the caller's scope, lookup only", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.reject(selfReq({ TicketId: 1, Remarks: "no" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("ticketController.reopen", () => {
  it("manager: sp_ReopenTicket gets AllowReopen 1 with exactly its params", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { TicketId: 1, Remarks: "Customer called back" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ReopenTicket", {
      CompId: 5, TicketId: 1, Remarks: "Customer called back", UserId: 7, AllowReopen: 1,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §6: reopen by a Self agent → AllowReopen 0 → the SP's 403 surfaced.
  it("Self agent on their own ticket: AllowReopen 0, and the SP's 403 comes back as-is", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 403, ResponseMess: "Reopening requires a manager" }],
    });
    const res = mockRes();
    await ticketController.reopen(selfReq({ TicketId: 1, Remarks: "not fixed" }), res);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 0 });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "SP_ERROR", message: "Reopening requires a manager" });
  });

  it("Team lead on a subordinate's ticket: AllowReopen 1", async () => {
    mockTicketLookup(subordinatesTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.reopen(teamLeadReq({ TicketId: 1, Remarks: "Recurred" }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 1 });
  });

  it("Team lead on their own ticket: AllowReopen 0", async () => {
    mockTicketLookup(visibleTicket); // assigned to 7 = the lead themself
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.reopen(teamLeadReq({ TicketId: 1, Remarks: "Recurred" }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 0 });
  });

  it("403s an unknown ticket from the guard", async () => {
    mockTicketLookup(null);
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { TicketId: 999, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_ReopenTicket", expect.anything());
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

// delete is untouched by Task 7; Task 8 rewrites it and REPLACES this block.
// ---- Transfer / escalate / delete (spec 2 §2). The lead playbook: validation
// that needs no DB first, then the record gate, then the target gate, then
// the SP. The SP owns the domain rules (no-op, ancestor, non-terminal) and its
// 400 is surfaced as-is.

describe("ticketController.transfer", () => {
  const body = { TicketId: 1, ToUserId: 18, ReasonId: 36, Remarks: "Absent today" };

  it("gates on the ticket, then the target, then calls sp_TransferTicket with exactly its params", async () => {
    mockTicketLookup(visibleTicket); // sp_FetchTicketDetail
    mockRoster(18);                  // sp_FetchAssignableUsers
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Complaint transferred" }));
    const res = mockRes();
    await ticketController.transfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_TransferTicket", {
      CompId: 5, TicketId: 1, ToUserId: 18, ToBranchId: null, ReasonId: 36, Remarks: "Absent today", UserId: 7,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Complaint transferred");
  });

  it("forwards ToBranchId for a cross-branch move by a Branch manager, checking that branch's roster", async () => {
    mockTicketLookup(visibleTicket);
    mockRoster(21);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.transfer(baseReq({ body: { ...body, ToUserId: "21", ToBranchId: "4" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(2, "sp_FetchAssignableUsers", {
      UserId: 7, CompId: 5, BranchId: 4,
    });
    expect(database.executeStoredProcedure.mock.calls[2][1]).toMatchObject({ ToUserId: 21, ToBranchId: 4 });
  });

  // Spec §6: missing remarks → 400, before any round-trip.
  it("400s without remarks before touching the DB", async () => {
    const res = mockRes();
    await ticketController.transfer(baseReq({ body: { ...body, Remarks: "   " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("A reason and remarks are required for a transfer");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a reason before touching the DB", async () => {
    const res = mockRes();
    await ticketController.transfer(baseReq({ body: { ...body, ReasonId: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Spec §6: target outside the subtree → 403 (the roster is the gate; the
  // dropdown is a convenience).
  it("403s a target outside the caller's roster and never calls the SP", async () => {
    mockTicketLookup(visibleTicket);
    mockRoster(4); // not 18
    const res = mockRes();
    await ticketController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You cannot assign records to that user");
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_TransferTicket", expect.anything());
  });

  // Spec §6: cross-branch by Team scope → 403, decided before any roster call.
  it("403s a cross-branch move from a Team lead without a roster call", async () => {
    mockTicketLookup(visibleTicket);
    const res = mockRes();
    await ticketController.transfer(teamLeadReq({ ...body, ToUserId: 17, ToBranchId: 4 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("Only a branch manager or above can move a record to another branch");
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });

  // Spec §6: unassign by an executive → 403.
  it("403s an unassign from a Self agent", async () => {
    mockTicketLookup(visibleTicket);
    const res = mockRes();
    await ticketController.transfer(selfReq({ ...body, ToUserId: null }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("Only a manager can leave a record unassigned");
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("lets a Branch manager unassign, with no roster call", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.transfer(baseReq({ body: { ...body, ToUserId: null } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual([
      "sp_TransferTicket",
      { CompId: 5, TicketId: 1, ToUserId: null, ToBranchId: null, ReasonId: 36, Remarks: "Absent today", UserId: 7 },
    ]);
  });

  it("403s transferring a ticket the caller cannot see, lookup only", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.transfer(selfReq(body), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("surfaces the SP's 400 on a no-op transfer", async () => {
    mockTicketLookup(visibleTicket);
    mockRoster(18);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Complaint is already assigned to that user in that branch" }],
    });
    const res = mockRes();
    await ticketController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "SP_ERROR" });
  });
});

describe("ticketController.bulkTransfer", () => {
  const body = { TicketIds: [1, 2, "2", "x"], ToUserId: 18, ReasonId: 37, Remarks: "Rebalancing the queue" };

  it("dedupes and cleans the ids, checks every ticket, the target once, then calls the bulk SP with JSON ids", async () => {
    mockTicketLookup(visibleTicket);
    mockTicketLookup({ ...visibleTicket, Id: 2 });
    mockRoster(18);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Transferred: 2, Skipped: 0, ResponseCode: 200, ResponseMess: "2 complaint(s) transferred" }],
    });
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_BulkTransferTickets", {
      CompId: 5, TicketIdsJson: "[1,2]", ToUserId: 18, ToBranchId: null, ReasonId: 37, Remarks: "Rebalancing the queue", UserId: 7,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(4); // 2 lookups + roster + SP
    expect(res.json.mock.calls[0][0].data).toMatchObject({ Transferred: 2, Skipped: 0 });
  });

  it("400s on an empty id list or a non-array, before touching the DB", async () => {
    const res1 = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, TicketIds: [] } }), res1);
    expect(res1.status).toHaveBeenCalledWith(400);
    expect(res1.json.mock.calls[0][0].message).toBe("Pick between 1 and 200 tickets");
    const res2 = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, TicketIds: "1,2" } }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s on more than 200 ids", async () => {
    const TicketIds = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, TicketIds } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a reason or remarks", async () => {
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, Remarks: "" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Spec §6: one invisible id fails the batch — before the roster, before the SP.
  it("403s the whole batch when any one ticket is out of scope, without reaching the roster or the SP", async () => {
    mockTicketLookup(visibleTicket);
    mockTicketLookup({ Id: 2, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_BulkTransferTickets", expect.anything());
  });

  it("403s when the target is not assignable, after the lookups", async () => {
    mockTicketLookup(visibleTicket);
    mockTicketLookup({ ...visibleTicket, Id: 2 });
    mockRoster(4);
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(3);
  });
});

describe("ticketController.escalate", () => {
  const body = { TicketId: 1, ToUserId: 16, Remarks: "Customer threatening to cancel" };

  it("gates on the ticket, then calls sp_EscalateTicket with exactly its params — no roster check, the SP validates the ancestor rule", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Escalated to Neha" }));
    const res = mockRes();
    await ticketController.escalate(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_EscalateTicket", {
      CompId: 5, TicketId: 1, ToUserId: 16, Remarks: "Customer threatening to cancel", UserId: 7,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §6: a non-ancestor → 400 from the SP.
  it("surfaces the SP's 400 for a target who is not a senior of the assignee", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Escalation target must be a senior of the assignee" }],
    });
    const res = mockRes();
    await ticketController.escalate(baseReq({ body: { ...body, ToUserId: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Escalation target must be a senior of the assignee");
  });

  // Spec §6: on a closed ticket → 400 from the SP.
  it("surfaces the SP's 400 on a closed complaint", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Only open complaints can be escalated" }],
    });
    const res = mockRes();
    await ticketController.escalate(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Only open complaints can be escalated");
  });

  it("sends Remarks null when blank and surfaces the SP's 400 for it", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Remarks are required to escalate" }],
    });
    const res = mockRes();
    await ticketController.escalate(baseReq({ body: { TicketId: 1, ToUserId: 16, Remarks: "  " } }), res);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ Remarks: null });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400s without a ToUserId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.escalate(baseReq({ body: { TicketId: 1, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("ToUserId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.escalate(baseReq({ body: { ToUserId: 16, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("TicketId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("403s a ticket the caller cannot see, lookup only", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.escalate(selfReq(body), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("ticketController.escalationTargets", () => {
  const chain = [
    { Id: 16, FullName: "Neha", JobTitle: "Team Lead", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 1 },
    { Id: 15, FullName: "Rahul", JobTitle: "Branch Manager", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 2 },
  ];

  it("defaults to the caller's own chain and maps RS1 to users", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [chain] });
    const res = mockRes();
    await ticketController.escalationTargets(baseReq(), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchEscalationTargets", { CompId: 5, UserId: 7 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.users).toEqual(chain);
  });

  // The SP's rule is "a senior of the ASSIGNEE"; the Escalate modal asks for
  // that user's chain, not the caller's.
  it("walks the chain of ForUserId when given", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [chain] });
    await ticketController.escalationTargets(baseReq({ body: { ForUserId: "18" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchEscalationTargets", { CompId: 5, UserId: 18 });
  });

  it("falls back to the caller for a junk ForUserId and to [] when the SP returns nothing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await ticketController.escalationTargets(baseReq({ body: { ForUserId: "abc" } }), res);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toEqual({ CompId: 5, UserId: 7 });
    expect(res.json.mock.calls[0][0].data.users).toEqual([]);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.escalationTargets(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.delete", () => {
  it("gates, calls sp_DeleteTicket with Id then CompId, then cascades the attachments", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Complaint deleted" }));
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] }); // sp_DeleteAttachmentsByEntity
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: "1" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(2, "sp_DeleteTicket", { Id: 1, CompId: 5 });
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(3, "sp_DeleteAttachmentsByEntity", {
      CompId: 5, Entity: "ticket", EntityId: 1,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Complaint deleted");
  });

  // REGRESSION (spec §2 Delete): the guard is what stops any authenticated
  // user deleting any ticket in the company by id. Spec §6: delete by a
  // non-viewer → 403.
  it("403s deleting a ticket the caller cannot see, without running the SP", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.delete(selfReq({ Id: 1 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_DeleteTicket", expect.anything());
  });

  it("400s without an Id before touching the DB", async () => {
    const res = mockRes();
    await ticketController.delete(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Id is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("surfaces the SP's error and does not cascade attachments when it refuses", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 404, ResponseMess: "Complaint not found" }],
    });
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // lookup + delete, no cascade
  });

  it("falls back to ResponseMessage when ResponseMess is absent", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMessage: "Deleted via ResponseMessage" }],
    });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.json.mock.calls[0][0].message).toBe("Deleted via ResponseMessage");
  });

  it("handles a failing sp_DeleteTicket as 500", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// 086 drops the pipeline engine: sp_MoveTicketStage is gone, so is the handler.
describe("ticketController pipeline removal", () => {
  it("no longer exposes moveStage", () => {
    expect(ticketController.moveStage).toBeUndefined();
  });
});
