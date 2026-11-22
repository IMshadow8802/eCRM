jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

jest.mock("../../../src/services/ticketDue", () => ({
  compute: jest.fn().mockResolvedValue(null),
  priorityTatHours: jest.fn().mockResolvedValue(null),
  forReopen: jest.fn().mockResolvedValue(null),
}));

jest.mock("../../../src/realtime/events", () => ({
  emitToUser: jest.fn(),
  emitToWorkspace: jest.fn(),
}));

const database = require("../../../src/config/database");
const { emitToUser } = require("../../../src/realtime/events");
const { SCOPES } = require("../../../src/realtime/contract");
const ticketController = require("../../../src/controllers/ticketController");
const { mockRes } = require("../../helpers/mockRes");
const { accessForScope } = require("../../helpers/mockAccess");

// Access model (131–133): the session person is req.user; visibility, CanEdit
// and every reassign / reopen gate are the database's. req.access is still
// built by loadScope — the controller reads only primaryBranchId (W6) and the
// customers scope from it.
const baseReq = (overrides = {}) => {
  const req = {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: { reach: "Office", primaryBranchId: 2, branchIds: [2], ownerIds: null, canWriteBranchIds: [2], isAdmin: false },
    body: {},
    ...overrides,
  };
  if (!req.access) req.access = accessForScope(req.scope, req.user.UserId);
  return req;
};

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  emitToUser.mockClear();
});

const calls = () => database.executeStoredProcedure.mock.calls;
const called = (sp) => calls().some((c) => c[0] === sp);

// The record gate: sp_FetchTicketDetail answers a row (with CanEdit) or no row.
function mockTicketLookup(ticket) {
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [ticket ? [ticket] : [], [], [], [], []] });
}
const editable = { Id: 1, BranchId: 2, AssignedTo: 7, CreatedBy: 7, CanEdit: 1 };
const readOnly = { ...editable, CanEdit: 0 };

// assertCustomerVisible's lookup (sp_FetchCustomerDetail RS1).
function mockCustomer(row = { Id: 31, BranchId: 2, CreatedBy: 7 }) {
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [row ? [row] : [], []] });
}
// The linked lead check (sp_FetchLeadDetail RS1: a row = visible).
function mockLead(row = { Id: 9, CanEdit: 1 }) {
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [row ? [row] : []] });
}
const okRow = (extra = {}) => ({ recordset: [{ Id: 1, ResponseCode: 200, ResponseMess: "ok", ...extra }] });
const spRefusal = (ResponseCode, ResponseMess, extra = {}) => ({ recordset: [{ Id: 1, ResponseCode, ResponseMess, ...extra }] });

const CREATE_BODY = {
  CustomerId: 31, Subject: "  Inverter trips at noon ", ContactPerson: "Rakesh", Contact: "9876543210",
  ChannelId: 51, CategoryId: 7, Priority: 3, ProductId: 2, AssignedTo: 18, LinkedLeadId: 9,
  Description: "Trips daily around 12:30", CustomJSON: '[{"fieldId":1,"type":"text","value":"x"}]',
};

describe("ticketController.save — create", () => {
  it("passes the live home office (W6), the session person and exactly sp_SaveTicket's columns; no roster call", async () => {
    mockCustomer();
    mockLead();
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 12, TicketNo: "TKT-000012" }));
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 18, FullName: "Vinod Kumar" }]] });
    const req = baseReq({ body: CREATE_BODY });
    req.user.BranchId = 99; // the token's office is stale; the access row is live
    req.access.primaryBranchId = 4;
    const res = mockRes();
    await ticketController.save(req, res);
    expect(calls()[2]).toEqual(["sp_SaveTicket", {
      Id: 0, CompId: 5, UserId: 7, BranchId: 4,
      CustomerId: 31, Subject: "Inverter trips at noon", ContactPerson: "Rakesh", Contact: "9876543210",
      ChannelId: 51, CategoryId: 7, Priority: 3, ProductId: 2, AssignedTo: 18, LinkedLeadId: 9,
      Description: "Trips daily around 12:30", CustomJSON: '[{"fieldId":1,"type":"text","value":"x"}]',
      DueAtOverride: null,
    }]);
    expect(calls()[3]).toEqual(["sp_FetchAssignableUsers", {
      CompId: 5, UserId: 7, Module: "complaints", RecordId: null, TargetUserId: 18,
    }]);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.message).toBe("Logged and assigned to Vinod Kumar");
    expect(json.data.TicketNo).toBe("TKT-000012");
  });

  it("keeps the procedure's message when the name lookup fails or finds nobody — the complaint is saved", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    for (const lookup of [() => database.executeStoredProcedure.mockRejectedValueOnce(new Error("x")),
      () => database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] })]) {
      database.executeStoredProcedure.mockReset();
      mockCustomer();
      mockLead();
      database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Ticket saved successfully" }));
      lookup();
      const res = mockRes();
      await ticketController.save(baseReq({ body: CREATE_BODY }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].message).toBe("Ticket saved successfully");
    }
    spy.mockRestore();
  });

  it("an unassigned create looks nobody up and keeps the procedure's message", async () => {
    mockCustomer();
    mockLead();
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Ticket saved successfully" }));
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null } }), res);
    expect(calls()).toHaveLength(3);
    expect(res.json.mock.calls[0][0].message).toBe("Ticket saved successfully");
  });

  it("relays the procedure's 403 for a person outside \"Can assign to\" (no Node roster check)", async () => {
    mockCustomer();
    mockLead();
    database.executeStoredProcedure.mockResolvedValueOnce(spRefusal(403, "You cannot assign records to that person"));
    const res = mockRes();
    await ticketController.save(baseReq({ body: CREATE_BODY }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "SP_ERROR", message: "You cannot assign records to that person" });
    expect(called("sp_FetchAssignableUsers")).toBe(false);
  });

  it("drops retired columns and unknown keys; the body cannot name the company or the person", async () => {
    mockCustomer();
    mockLead();
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(
      baseReq({ body: { ...CREATE_BODY, AssignedTo: null, CustomerName: "Acme", PipelineId: 1, CompId: 999, UserId: 1, BranchId: 8, CreatedBy: 1 } }),
      mockRes(),
    );
    const params = calls()[2][1];
    expect(params).toMatchObject({ CompId: 5, UserId: 7, BranchId: 2 });
    for (const k of ["CustomerName", "PipelineId", "CreatedBy"]) expect(params).not.toHaveProperty(k);
  });

  it("400s without a CustomerId or a Subject before touching the DB", async () => {
    for (const body of [{ ...CREATE_BODY, CustomerId: null }, { ...CREATE_BODY, Subject: "   " }]) {
      const res = mockRes();
      await ticketController.save(baseReq({ body }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("normalises id fields: empty strings and junk become null, numeric strings ints", async () => {
    mockCustomer();
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(
      baseReq({ body: { CustomerId: "31", Subject: "x", CategoryId: "", Priority: "3", ProductId: "abc", ChannelId: 0 } }),
      mockRes(),
    );
    expect(calls()).toHaveLength(2);
    expect(calls()[1][1]).toMatchObject({ CustomerId: 31, CategoryId: null, Priority: 3, ProductId: null, ChannelId: null, AssignedTo: null, LinkedLeadId: null });
  });

  it("handles a DB error as 500", async () => {
    mockCustomer();
    mockLead();
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.save — update", () => {
  it("gates on the record (with the session person), then saves with AssignedTo dropped and no status key", async () => {
    mockTicketLookup({ ...editable, LinkedLeadId: 9, CustomerId: 31 });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ Priority: 3, AssignedTo: 18 }] }); // sp_FetchTicketDue
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(baseReq({ body: { Id: "1", ...CREATE_BODY, StatusId: 99 } }), mockRes());
    expect(calls()[0]).toEqual(["sp_FetchTicketDetail", { CompId: 5, UserId: 7, TicketId: 1 }]);
    const [sp, params] = calls()[2];
    expect(sp).toBe("sp_SaveTicket");
    expect(params).toMatchObject({ Id: 1, CompId: 5, AssignedTo: null });
    expect(params).not.toHaveProperty("StatusId");
    expect(called("sp_FetchAssignableUsers")).toBe(false);
  });

  it("403s an update when the database returns no row, without running the SP", async () => {
    mockTicketLookup(null);
    const res = mockRes();
    await ticketController.save(baseReq({ body: { Id: 1, Subject: "hijacked" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(calls()).toHaveLength(1);
  });

  it("403s an update on a row the caller can see but not edit (CanEdit 0)", async () => {
    mockTicketLookup(readOnly);
    const res = mockRes();
    await ticketController.save(baseReq({ body: { Id: 1, Subject: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(called("sp_SaveTicket")).toBe(false);
  });
});

describe("ticketController.save — customer and linked lead", () => {
  it("refuses a customer the caller cannot see", async () => {
    mockCustomer(null);
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(called("sp_SaveTicket")).toBe(false);
  });

  // REGRESSION (W2): keeping the customer a complaint already has is no new act of linking.
  it("lets an edit keep its customer without re-checking it", async () => {
    mockTicketLookup({ ...editable, CustomerId: 31 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.save(baseReq({ body: { Id: 1, CustomerId: "31", Description: "visited" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(called("sp_FetchCustomerDetail")).toBe(false);
  });

  it("refuses a create linked to a lead the database does not show the caller", async () => {
    mockCustomer();
    mockLead(null);
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(calls()[1]).toEqual(["sp_FetchLeadDetail", { CompId: 5, UserId: 7, LeadId: 9 }]);
    expect(called("sp_SaveTicket")).toBe(false);
  });

  it("lets an edit keep an existing link without a lead lookup", async () => {
    mockTicketLookup({ ...editable, LinkedLeadId: 9 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.save(baseReq({ body: { Id: 1, LinkedLeadId: 9, Description: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(called("sp_FetchLeadDetail")).toBe(false);
  });
});

describe("ticketController.fetch", () => {
  it("passes the session person and the filters only — no list keys — with paging 1/25 and filters null / 0", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(baseReq(), mockRes());
    expect(calls()[0]).toEqual(["sp_FetchTickets", {
      CompId: 5, UserId: 7, BranchId: null, PageNumber: 1, PageSize: 25, SearchTerm: null,
      StatusId: null, StatusCode: null, Priority: null, CategoryId: null, ChannelId: null, ProductId: null,
      CustomerId: null, AssignedTo: null, Overdue: 0, Escalated: 0, Unassigned: 0, FromDate: null, ToDate: null,
    }]);
  });

  it("Escalated is a bit only: the database works out the subtree", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(baseReq({ body: { Escalated: true } }), mockRes());
    const params = calls()[0][1];
    expect(params.Escalated).toBe(1);
    expect(Object.keys(params).filter((k) => /Json$/.test(k))).toEqual([]);
  });

  it("the person comes from the session even when the body names another", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(baseReq({ body: { UserId: 1, CompId: 9 } }), mockRes());
    expect(calls()[0][1]).toMatchObject({ CompId: 5, UserId: 7 });
  });

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
    expect(calls()[0][1]).toMatchObject({
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
    expect(calls()[0][1]).toMatchObject({ Overdue: 0, Escalated: 0, Unassigned: 0, FromDate: null, ToDate: null, StatusCode: null });
  });

  it("clamps PageSize to 200 and maps rows + pagination, with defaults when RS2 is missing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const res = mockRes();
    await ticketController.fetch(baseReq({ body: { PageNumber: 2, PageSize: 99999 } }), res);
    expect(calls()[0][1]).toMatchObject({ PageNumber: 2, PageSize: 200 });
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 2, pageSize: 200, totalRecords: 0, totalPages: 1 });

    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1 }], [{ CurrentPage: 1, PageSize: 25, TotalRecords: 1, TotalPages: 1 }]],
    });
    const res2 = mockRes();
    await ticketController.fetch(baseReq(), res2);
    expect(res2.json.mock.calls[0][0].data).toEqual({ tickets: [{ Id: 1 }], pagination: { currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 } });

    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [undefined] });
    const res3 = mockRes();
    await ticketController.fetch(baseReq(), res3);
    expect(res3.json.mock.calls[0][0].data.tickets).toEqual([]);
  });

  it("passes ResolvedFrom / ResolvedTo only when set", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], []] });
    await ticketController.fetch(baseReq({ body: { ResolvedFrom: "2026-10-27", ResolvedTo: "2026-11-02T10:15" } }), mockRes());
    expect(calls()[0][1]).toMatchObject({ ResolvedFrom: "2026-10-27", ResolvedTo: "2026-11-02T10:15:00" });
    await ticketController.fetch(baseReq({ body: { ResolvedFrom: "", ResolvedTo: null } }), mockRes());
    expect(calls()[1][1]).not.toHaveProperty("ResolvedFrom");
    expect(calls()[1][1]).not.toHaveProperty("ResolvedTo");
  });

  it("400s a bad resolved date before any DB call", async () => {
    const res = mockRes();
    await ticketController.fetch(baseReq({ body: { ResolvedFrom: "last week" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("handles a DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.detail", () => {
  it("asks with { CompId, UserId, TicketId } and maps the five recordsets, the action flags riding on the row", async () => {
    const row = { Id: 1, TicketNo: "TKT-000001", LinkedLeadId: 9, CanEdit: 1, CanReassign: 1, CanReopen: 0, SendBackToId: 16, SendBackToName: "Nitin" };
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[row], [{ FieldId: 2 }], [{ Id: 9, Type: "created" }], [{ Id: 3, ToUserId: 4 }], [{ Id: 9, Name: "Acme Corp" }]],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: "1" } }), res);
    expect(calls()).toEqual([["sp_FetchTicketDetail", { CompId: 5, UserId: 7, TicketId: 1 }]]);
    expect(res.json.mock.calls[0][0].data).toEqual({
      ticket: row, fields: [{ FieldId: 2 }], activity: [{ Id: 9, Type: "created" }],
      assignments: [{ Id: 3, ToUserId: 4 }], linkedLead: { Id: 9, Name: "Acme Corp" },
    });
  });

  // REGRESSION (F24): the controller once looked the lead up itself and could
  // attach RS5 whatever the row said. Now the procedure blanks LinkedLeadId when
  // the lead is hidden, and Node attaches nothing the row does not carry.
  it("F24 regression: the controller no longer fetches or attaches a linked lead the row does not carry", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, LinkedLeadId: null }], [], [], [], [{ Id: 9, MobileNo: "9876543210" }]],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    expect(calls()).toHaveLength(1);
    expect(called("sp_FetchLeadDetail")).toBe(false);
    expect(res.json.mock.calls[0][0].data.linkedLead).toBeNull();
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/9876543210/);
  });

  it("returns empty lists and no lead when the tail recordsets are absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 1, LinkedLeadId: 9 }]] });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data).toMatchObject({ fields: [], activity: [], assignments: [], linkedLead: null });
  });

  // Scenario 10: one answer whether the id exists or is hidden.
  it("detail: no row answers 404, never 403", async () => {
    for (const recordsets of [[[], [], [], [], []], []]) {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets });
      const res = mockRes();
      await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0]).toMatchObject({ code: "NOT_FOUND", message: "Complaint not found" });
    }
  });

  it("400s without a TicketId; a DB error is 500", async () => {
    const res = mockRes();
    await ticketController.detail(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res2 = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res2);
    expect(res2.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController lifecycle", () => {
  it("setStatus: gate, then sp_SetTicketStatus with exactly its 133 params — no AllowReopen", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Status: New → Resolved" }));
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: "1", StatusId: "64", ResolutionId: 8, Remarks: "  Replaced the fuse " } }), res);
    expect(calls()[1]).toEqual(["sp_SetTicketStatus", {
      CompId: 5, TicketId: 1, StatusId: 64, UserId: 7, ResolutionId: 8, Remarks: "Replaced the fuse", DueAtOverride: null,
    }]);
    expect(res.json.mock.calls[0][0].message).toBe("Status: New → Resolved");
  });

  it("setStatus nulls a blank Remarks and a junk ResolutionId", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 62, ResolutionId: "", Remarks: "   " } }), mockRes());
    expect(calls()[1][1]).toMatchObject({ ResolutionId: null, Remarks: null });
  });

  it("setStatus 400s without a TicketId or a StatusId before touching the DB", async () => {
    for (const body of [{ StatusId: 62 }, { TicketId: 1, StatusId: "abc" }]) {
      const res = mockRes();
      await ticketController.setStatus(baseReq({ body }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("relays the procedure's 403/404/400 status and message unchanged", async () => {
    for (const [code, mess] of [[403, "Reopening requires a manager"], [404, "Ticket not found"], [400, "Remarks are required"]]) {
      database.executeStoredProcedure.mockReset();
      mockTicketLookup(editable);
      database.executeStoredProcedure.mockResolvedValueOnce(spRefusal(code, mess));
      const res = mockRes();
      await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 61, Remarks: "x" } }), res);
      expect(res.status).toHaveBeenCalledWith(code);
      expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR", message: mess });
    }
  });

  it("403s when the gate finds no row or CanEdit 0, without the mutation", async () => {
    for (const row of [null, readOnly]) {
      database.executeStoredProcedure.mockReset();
      mockTicketLookup(row);
      const res = mockRes();
      await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 62 } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(calls()).toHaveLength(1);
    }
  });

  it("a DB error on the mutation is 500", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 62 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("reopen: sp_ReopenTicket with exactly its 133 params — no AllowReopen — and its 403 relayed", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(spRefusal(403, "Reopening requires a manager"));
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { TicketId: 1, Remarks: "Customer called back" } }), res);
    expect(calls()[1]).toEqual(["sp_ReopenTicket", { CompId: 5, TicketId: 1, Remarks: "Customer called back", UserId: 7, DueAtOverride: null }]);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("reopen 400s without a TicketId", async () => {
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it.each([
    ["resolve", "sp_ResolveTicket", { TicketId: 1, ResolutionId: "8", Remarks: "Fixed" }, { CompId: 5, TicketId: 1, ResolutionId: 8, Remarks: "Fixed", UserId: 7 }],
    ["close", "sp_CloseTicket", { TicketId: 1 }, { CompId: 5, TicketId: 1, UserId: 7, ResolutionId: null, Remarks: null }],
    ["reject", "sp_RejectTicket", { TicketId: 1, Remarks: " Out of warranty " }, { CompId: 5, TicketId: 1, Remarks: "Out of warranty", UserId: 7 }],
  ])("%s: gate, then %s with exactly its params", async (method, sp, body, params) => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController[method](baseReq({ body }), res);
    expect(calls()[1]).toEqual([sp, params]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each(["resolve", "close", "reject"])("%s 403s a hidden complaint, lookup only", async (method) => {
    mockTicketLookup(null);
    const res = mockRes();
    await ticketController[method](baseReq({ body: { TicketId: 1, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(calls()).toHaveLength(1);
  });

  it("a DB error on the gate lookup is 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// These six writes rely entirely on gateTicket: their procedures have no
// visibility check of their own. Removing the gate from any one fails here.
describe("ticketController — gated writes refuse before the procedure", () => {
  const cases = [
    ["setStatus", "sp_SetTicketStatus", { TicketId: 1, StatusId: 62 }],
    ["resolve", "sp_ResolveTicket", { TicketId: 1, ResolutionId: 8, Remarks: "x" }],
    ["close", "sp_CloseTicket", { TicketId: 1 }],
    ["reject", "sp_RejectTicket", { TicketId: 1, Remarks: "x" }],
    ["reopen", "sp_ReopenTicket", { TicketId: 1, Remarks: "x" }],
    ["escalate", "sp_EscalateTicket", { TicketId: 1, ToUserId: 16, Remarks: "x" }],
  ];
  it.each(cases)("%s: no detail row → 403 and CanEdit 0 → 403, %s never called", async (method, sp, body) => {
    for (const row of [null, readOnly]) {
      database.executeStoredProcedure.mockReset();
      mockTicketLookup(row);
      database.executeStoredProcedure.mockResolvedValue(okRow());
      const res = mockRes();
      await ticketController[method](baseReq({ body }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(calls()[0]).toEqual(["sp_FetchTicketDetail", { CompId: 5, UserId: 7, TicketId: 1 }]);
      expect(called(sp)).toBe(false);
    }
  });
});

describe("ticketController.transfer", () => {
  const body = { TicketId: 1, ToUserId: 18, ReasonId: 36, Remarks: "Absent today" };
  const moved = (extra = {}) => okRow({ ResponseMess: "Complaint reassigned successfully", FromUserId: 7, ToUserId: 18, ToName: "Vivek", ...extra });

  it("one call: sp_TransferTicket with exactly its params (SendBack 0), then notifies both holders", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(moved());
    const res = mockRes();
    await ticketController.transfer(baseReq({ body: { ...body, ToBranchId: "3" } }), res);
    expect(calls()).toEqual([["sp_TransferTicket", {
      CompId: 5, TicketId: 1, ToUserId: 18, ToBranchId: 3, ReasonId: 36, Remarks: "Absent today", UserId: 7, SendBack: 0,
    }]]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ FromUserId: 7, ToUserId: 18, ToName: "Vivek" });
    expect(emitToUser).toHaveBeenCalledWith(7, SCOPES.RECORDS, { module: "complaints" });
    expect(emitToUser).toHaveBeenCalledWith(18, SCOPES.RECORDS, { module: "complaints" });
    expect(emitToUser).toHaveBeenCalledTimes(2);
  });

  it("send back needs remarks but no reason", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(moved({ ResponseMess: "Complaint sent back", ToUserId: 16 }));
    const res = mockRes();
    await ticketController.transfer(baseReq({ body: { TicketId: 1, SendBack: true, Remarks: "Wrong area" } }), res);
    expect(calls()[0][1]).toMatchObject({ SendBack: 1, ReasonId: null, Remarks: "Wrong area", ToUserId: null });
    expect(res.json.mock.calls[0][0].message).toBe("Complaint sent back");

    const res2 = mockRes();
    await ticketController.transfer(baseReq({ body: { TicketId: 1, SendBack: true, ReasonId: 36 } }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(res2.json.mock.calls[0][0].message).toBe("Remarks are required to send this back");
    expect(calls()).toHaveLength(1);
  });

  it("legacy payload: transfer without SendBack still needs a reason and remarks", async () => {
    for (const b of [{ ...body, Remarks: "  " }, { ...body, ReasonId: null }, { ...body, SendBack: "false", ReasonId: undefined }]) {
      const res = mockRes();
      await ticketController.transfer(baseReq({ body: b }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].message).toBe("A reason and remarks are required to reassign");
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.transfer(baseReq({ body: { ...body, TicketId: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("relays the gates' refusals unchanged and notifies nobody", async () => {
    for (const [code, mess] of [[404, "Record not found"], [403, "You cannot assign records to that person"],
      [400, "There is nobody to send this back to."], [409, "This complaint changed while you were working on it. Open it again and retry."]]) {
      database.executeStoredProcedure.mockReset();
      database.executeStoredProcedure.mockResolvedValueOnce(spRefusal(code, mess));
      const res = mockRes();
      await ticketController.transfer(baseReq({ body }), res);
      expect(res.status).toHaveBeenCalledWith(code);
      expect(res.json.mock.calls[0][0].message).toBe(mess);
    }
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it("an unassign notifies only the previous holder; no DueAtOverride is sent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(moved({ ToUserId: null, ToName: null }));
    await ticketController.transfer(baseReq({ body: { ...body, ToUserId: null } }), mockRes());
    expect(calls()[0][1]).not.toHaveProperty("DueAtOverride");
    expect(emitToUser.mock.calls).toEqual([[7, SCOPES.RECORDS, { module: "complaints" }]]);
  });

  it("a DB error is 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.bulkTransfer", () => {
  const body = { TicketIds: [3, "3", 4, "x", 0], ToUserId: 18, ReasonId: 37, Remarks: "Rebalance" };

  it("one procedure call with cleaned JSON ids, no per-id reads; emits to every user id in RS2", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Transferred: 2, Skipped: 0, Moved: 2, Refused: 0, ResponseCode: 200, ResponseMess: "2 complaint(s) reassigned" }],
      recordsets: [[{ Transferred: 2, Moved: 2, Refused: 0, ResponseCode: 200, ResponseMess: "2 complaint(s) reassigned" }],
        [{ UserId: 7 }, { UserId: 9 }, { UserId: 18 }]],
    });
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body }), res);
    expect(calls()).toEqual([["sp_BulkTransferTickets", {
      CompId: 5, TicketIdsJson: "[3,4]", ToUserId: 18, ToBranchId: null, ReasonId: 37, Remarks: "Rebalance", UserId: 7,
    }]]);
    expect(res.json.mock.calls[0][0].message).toBe("2 complaint(s) reassigned");
    expect(emitToUser.mock.calls.map((c) => c[0])).toEqual([7, 9, 18]);
    expect(emitToUser).toHaveBeenCalledWith(9, SCOPES.RECORDS, { module: "complaints" });
  });

  it("bulk: 0 ids and 201 ids are refused before any DB call", async () => {
    for (const TicketIds of [[], "1,2", Array.from({ length: 201 }, (_, i) => i + 1)]) {
      const res = mockRes();
      await ticketController.bulkTransfer(baseReq({ body: { ...body, TicketIds } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("200 ids are allowed", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.bulkTransfer(baseReq({ body: { ...body, TicketIds: Array.from({ length: 200 }, (_, i) => i + 1) } }), mockRes());
    expect(JSON.parse(calls()[0][1].TicketIdsJson)).toHaveLength(200);
  });

  it("400s without a reason or remarks", async () => {
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, ReasonId: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // S7: the first failing gate's code and sentence, plus the count.
  it("bulk: Refused > 0 answers 403 with the count in the message", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Transferred: 0, Moved: 0, Refused: 2, ResponseCode: 403, ResponseMess: "Only a manager can reassign a closed record (2 of 5 refused)" }],
    });
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("Only a manager can reassign a closed record (2 of 5 refused)");
    expect(emitToUser).not.toHaveBeenCalled();
  });
});

describe("ticketController.escalate", () => {
  const body = { TicketId: 1, ToUserId: 16, Remarks: "Customer threatening to cancel" };

  it("gates, then sp_EscalateTicket with exactly its params", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.escalate(baseReq({ body }), mockRes());
    expect(calls()[1]).toEqual(["sp_EscalateTicket", { CompId: 5, TicketId: 1, ToUserId: 16, Remarks: "Customer threatening to cancel", UserId: 7 }]);
  });

  it("relays the procedure's 400 for a target who cannot open complaints", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(spRefusal(400, "Escalation target must be able to open complaints"));
    const res = mockRes();
    await ticketController.escalate(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Escalation target must be able to open complaints");
  });

  it("400s without a ToUserId or a TicketId; 403s a hidden complaint", async () => {
    for (const b of [{ TicketId: 1 }, { ToUserId: 16 }]) {
      const res = mockRes();
      await ticketController.escalate(baseReq({ body: b }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    mockTicketLookup(null);
    const res = mockRes();
    await ticketController.escalate(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("ticketController.escalationTargets", () => {
  const chain = [{ Id: 16, FullName: "Neha", JobTitle: "Team Lead", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 1 }];

  it("by TicketId (new clients): sp_FetchTicketEscalationTargets with ForUserId null", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [chain] });
    const res = mockRes();
    await ticketController.escalationTargets(baseReq({ body: { TicketId: "1" } }), res);
    expect(calls()[0]).toEqual(["sp_FetchTicketEscalationTargets", { CompId: 5, UserId: 7, TicketId: 1, ForUserId: null }]);
    expect(res.json.mock.calls[0][0].data.users).toEqual(chain);
  });

  it("legacy payload: fetchEscalationTargets with ForUserId only calls the new proc with TicketId null", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [chain] });
    await ticketController.escalationTargets(baseReq({ body: { ForUserId: "18" } }), mockRes());
    expect(calls()[0]).toEqual(["sp_FetchTicketEscalationTargets", { CompId: 5, UserId: 7, TicketId: null, ForUserId: 18 }]);
    expect(called("sp_FetchEscalationTargets")).toBe(false);
  });

  it("neither given (or junk): ForUserId is the caller; an empty answer maps to []", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await ticketController.escalationTargets(baseReq({ body: { ForUserId: "abc" } }), res);
    expect(calls()[0][1]).toEqual({ CompId: 5, UserId: 7, TicketId: null, ForUserId: 7 });
    expect(res.json.mock.calls[0][0].data.users).toEqual([]);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    await ticketController.escalationTargets(baseReq({ body: undefined }), mockRes());
    expect(calls()[1][1]).toEqual({ CompId: 5, UserId: 7, TicketId: null, ForUserId: 7 });
  });

  it("a DB error is 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.escalationTargets(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.loggedByMe", () => {
  it("calls sp_FetchLoggedByMe with the session person, search and paging; answers { rows, pagination }", async () => {
    const rows = [{ Id: null, TicketNo: "TKT-000082", CanOpen: 0 }, { Id: 85, TicketNo: "TKT-000085", CanOpen: 1 }];
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [rows, [{ CurrentPage: 2, PageSize: 10, TotalRecords: 12, TotalPages: 2 }]] });
    const res = mockRes();
    await ticketController.loggedByMe(baseReq({ body: { SearchTerm: " TKT ", PageNumber: 2, PageSize: 10, UserId: 1 } }), res);
    expect(calls()).toEqual([["sp_FetchLoggedByMe", { CompId: 5, UserId: 7, SearchTerm: "TKT", PageNumber: 2, PageSize: 10 }]]);
    expect(res.json.mock.calls[0][0].data).toEqual({ rows, pagination: { currentPage: 2, pageSize: 10, totalRecords: 12, totalPages: 2 } });
  });

  it("an empty body defaults to page 1 of 25 with no search", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await ticketController.loggedByMe(baseReq({ body: undefined }), res);
    expect(calls()[0][1]).toEqual({ CompId: 5, UserId: 7, SearchTerm: null, PageNumber: 1, PageSize: 25 });
    expect(res.json.mock.calls[0][0].data).toEqual({ rows: [], pagination: { currentPage: 1, pageSize: 25, totalRecords: 0, totalPages: 1 } });
  });

  it("a DB error is 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.loggedByMe(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.delete", () => {
  it("gates, calls sp_DeleteTicket with Id then CompId, then cascades the attachments", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Complaint deleted" }));
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: "1" } }), res);
    expect(calls()[1]).toEqual(["sp_DeleteTicket", { Id: 1, CompId: 5 }]);
    expect(calls()[2]).toEqual(["sp_DeleteAttachmentsByEntity", { CompId: 5, Entity: "ticket", EntityId: 1 }]);
    expect(res.json.mock.calls[0][0].message).toBe("Complaint deleted");
  });

  it("403s a hidden complaint; 400s without an Id", async () => {
    mockTicketLookup(null);
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(called("sp_DeleteTicket")).toBe(false);
    const res2 = mockRes();
    await ticketController.delete(baseReq(), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("surfaces the SP's refusal without cascading; falls back to ResponseMessage", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(spRefusal(404, "Complaint not found"));
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(calls()).toHaveLength(2);

    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ ResponseCode: 200, ResponseMessage: "Deleted via ResponseMessage" }] });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res2 = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res2);
    expect(res2.json.mock.calls[0][0].message).toBe("Deleted via ResponseMessage");
  });

  it("a failing sp_DeleteTicket is 500", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController — no session person", () => {
  it("never asks the database without a person (NO_ACTOR: 500 from detail, a throw from a write)", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { TicketId: 1 } });
    req.user = { CompId: 5 };
    const res = mockRes();
    await ticketController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    await expect(ticketController.transfer(req, mockRes())).rejects.toThrow("NO_ACTOR");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("ticketController — DueAtOverride", () => {
  const ticketDue = require("../../../src/services/ticketDue");
  const DUE = new Date("2026-10-12T06:30:00Z");
  const saveParams = () => calls().find((c) => c[0] === "sp_SaveTicket")[1];

  it("create: TatHours of the chosen priority, assignee from the body, anchored now", async () => {
    mockCustomer();
    mockLead();
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 12 }));
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ FullName: "Vinod" }]] });
    ticketDue.priorityTatHours.mockResolvedValueOnce(4);
    ticketDue.compute.mockResolvedValueOnce(DUE);
    await ticketController.save(baseReq({ body: CREATE_BODY }), mockRes());
    expect(ticketDue.priorityTatHours).toHaveBeenLastCalledWith(5, 3);
    expect(ticketDue.compute).toHaveBeenLastCalledWith(5, { assigneeId: 18, tatHours: 4, anchorAt: expect.any(Date) });
    expect(saveParams().DueAtOverride).toBe(DUE);
  });

  it("update with a changed priority re-stamps from TatAnchorAt, falling back to CreatedAt", async () => {
    for (const row of [
      { Priority: 2, AssignedTo: 18, TatAnchorAt: "2026-10-10T04:00:00Z", CreatedAt: "2026-10-01T04:00:00Z" },
      { Priority: 2, AssignedTo: 18, TatAnchorAt: null, CreatedAt: "2026-10-01T04:00:00Z" },
    ]) {
      database.executeStoredProcedure.mockReset();
      ticketDue.compute.mockClear();
      mockTicketLookup({ ...editable, CustomerId: 31, LinkedLeadId: 9 });
      database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [row] });
      database.executeStoredProcedure.mockResolvedValueOnce(okRow());
      ticketDue.priorityTatHours.mockResolvedValueOnce(4);
      ticketDue.compute.mockResolvedValueOnce(DUE);
      await ticketController.save(baseReq({ body: { Id: 1, ...CREATE_BODY } }), mockRes());
      expect(ticketDue.compute.mock.calls[0][1].anchorAt.toISOString()).toBe(new Date(row.TatAnchorAt ?? row.CreatedAt).toISOString());
      expect(saveParams().DueAtOverride).toBe(DUE);
    }
  });

  it("update with an unchanged priority passes nothing; a failing due lookup never fails the save", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockTicketLookup({ ...editable, CustomerId: 31, LinkedLeadId: 9 });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ Priority: 3, AssignedTo: 18 }] });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    ticketDue.compute.mockClear();
    await ticketController.save(baseReq({ body: { Id: 1, ...CREATE_BODY } }), mockRes());
    expect(ticketDue.compute).not.toHaveBeenCalled();
    expect(saveParams().DueAtOverride).toBeNull();

    database.executeStoredProcedure.mockReset();
    mockTicketLookup({ ...editable, CustomerId: 31, LinkedLeadId: 9 });
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("sp missing"));
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.save(baseReq({ body: { Id: 1, ...CREATE_BODY } }), res);
    expect(saveParams().DueAtOverride).toBeNull();
    expect(res.status).toHaveBeenCalledWith(200);
    spy.mockRestore();
  });

  it("setStatus and reopen pass the reopen stamp", async () => {
    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    ticketDue.forReopen.mockResolvedValueOnce(DUE);
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 61, Remarks: "again" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SetTicketStatus", expect.objectContaining({ DueAtOverride: DUE }));
    expect(ticketDue.forReopen).toHaveBeenLastCalledWith(5, 1);

    mockTicketLookup(editable);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    ticketDue.forReopen.mockResolvedValueOnce(DUE);
    await ticketController.reopen(baseReq({ body: { TicketId: 1, Remarks: "back" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ReopenTicket", expect.objectContaining({ DueAtOverride: DUE }));
  });
});

describe("ticketController pipeline removal", () => {
  it("no longer exposes moveStage", () => {
    expect(ticketController.moveStage).toBeUndefined();
  });
});
