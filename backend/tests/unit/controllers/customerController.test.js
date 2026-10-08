jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const customerController = require("../../../src/controllers/customerController");
const { mockRes } = require("../../helpers/mockRes");
const { accessForScope, mockAccess } = require("../../helpers/mockAccess");
const { scopeFor } = require("../../../src/middleware/access");

// Routes always run loadScope, so req.scope is present on every real request.
function baseReq(overrides = {}) {
  const req = rawReq(overrides);
  if (!req.access) req.access = accessForScope(req.scope, req.user.UserId);
  return req;
}
// A request whose req.access is built from modules, req.scope = customers scope.
function accessReq(modules, body = {}) {
  const access = mockAccess({ modules }, 7);
  return { user: { UserId: 7, CompId: 5, BranchId: 2 }, access, scope: scopeFor(access, "customers", 7), body };
}
function rawReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: {
      reach: "Office",
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

const okRow = (extra = {}) => ({
  recordset: [{ Id: 31, ResponseCode: 200, ResponseMess: "Customer saved successfully", ...extra }],
});

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

const FULL = {
  Name: "Sharma Traders", ContactPerson: "Rakesh Sharma", Mobile: "98765 43210", AltMobile: null,
  Email: "rakesh@sharma.in", Address: "12 MG Road", City: "Ghaziabad", State: "UP", Pincode: "201010",
  Remarks: "Walk-in regular",
};

// assertCustomerVisible's lookup (sp_FetchCustomerDetail RS1).
const mockExisting = (row = {}) => database.executeStoredProcedure.mockResolvedValueOnce({
  recordsets: [[{ Id: 31, BranchId: 2, CreatedBy: 7, ...row }], []],
});

describe("customerController.save", () => {
  it("creates: injects Id=0, CompId, the caller's BranchId and UserId, and forwards exactly the SP's columns", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await customerController.save(baseReq({ body: { ...FULL, CompId: 999, IsActive: 0, Junk: "x" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveCustomer", {
      Id: 0, CompId: 5, BranchId: 2, UserId: 7, MoveToBranchId: null,
      Name: "Sharma Traders", ContactPerson: "Rakesh Sharma", Mobile: "9876543210", AltMobile: null,
      Email: "rakesh@sharma.in", Address: "12 MG Road", City: "Ghaziabad", State: "UP", Pincode: "201010",
      Remarks: "Walk-in regular", GSTIN: null,
    });
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).not.toHaveProperty("IsActive");
    expect(params).not.toHaveProperty("Junk");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.Id).toBe(31);
  });

  it("updates when Id > 0 after the visibility check, keeping the current office", async () => {
    mockExisting();
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 31 }));
    await customerController.save(baseReq({ body: { ...FULL, Id: "31" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ Id: 31, CompId: 5, BranchId: 2, MoveToBranchId: null });
  });

  it("moves a customer: passes MoveToBranchId when both offices are writable", async () => {
    mockExisting();
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 31 }));
    const req = baseReq({ body: { ...FULL, Id: 31, BranchId: 4 }, scope: { ...rawReq().scope, branchIds: [2, 4], canWriteBranchIds: [2, 4] } });
    await customerController.save(req, mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ BranchId: 2, MoveToBranchId: 4 });
  });

  it("editing a customer into another office needs write over both", async () => {
    mockExisting({ BranchId: 3 }); // visible, but current office 3 is not writable
    const res = mockRes();
    const req = baseReq({ body: { ...FULL, Id: 31, BranchId: 2 }, scope: { ...rawReq().scope, branchIds: [2, 3], canWriteBranchIds: [2] } });
    await customerController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_SaveCustomer", expect.anything());
  });

  it("403s an edit of a customer outside customers reach", async () => {
    mockExisting({ BranchId: 9, CreatedBy: 3 });
    const res = mockRes();
    await customerController.save(baseReq({ body: { ...FULL, Id: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("refuses an office the caller cannot write", async () => {
    const res = mockRes();
    await customerController.save(baseReq({ body: { ...FULL, BranchId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("defaults the office to the caller's home office", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await customerController.save(baseReq({ body: FULL }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ BranchId: 2 });
  });

  it("400s without a Name before touching the DB", async () => {
    const res = mockRes();
    await customerController.save(baseReq({ body: { ...FULL, Name: "   " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR", message: "Name is required" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Spec §1: sp_SaveCustomer requires mobile OR email. Refusing here names the
  // rule; the SP enforces it too.
  it("400s when neither Mobile nor Email is given", async () => {
    const res = mockRes();
    await customerController.save(baseReq({ body: { Name: "Nobody", Mobile: "", Email: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Mobile or Email is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("accepts email-only and mobile-only customers", async () => {
    database.executeStoredProcedure.mockResolvedValue(okRow());
    await customerController.save(baseReq({ body: { Name: "A", Email: "a@x.in" } }), mockRes());
    await customerController.save(baseReq({ body: { Name: "B", Mobile: "9876500000" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
  });

  it("400s a mobile that cannot be ten digits, before touching the DB", async () => {
    const res = mockRes();
    await customerController.save(baseReq({ body: { Name: "B", Mobile: "111" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Mobile number must be 10 digits");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("forwards the GSTIN, upper-cased and unspaced", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await customerController.save(baseReq({ body: { ...FULL, GSTIN: " 24abcde1234f1z5 " } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].GSTIN).toBe("24ABCDE1234F1Z5");
  });

  // Spec §1: unique filtered index on (CompId, Mobile) WHERE IsActive = 1 —
  // the SP answers 409 and the controller must not flatten it into a 500.
  it("surfaces the SP's 409 on a duplicate mobile", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 0, ResponseCode: 409, ResponseMess: "A customer with this mobile already exists" }],
    });
    const res = mockRes();
    await customerController.save(baseReq({ body: FULL }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR", message: "A customer with this mobile already exists" });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.save(baseReq({ body: FULL }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("customerController.fetch", () => {
  it("forwards CompId + filters, defaults paging to 1/25 and IsActive to 1, maps two recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 31, Name: "Sharma Traders", OpenTickets: 2, TotalTickets: 5 }],
        [{ CurrentPage: 1, PageSize: 25, TotalRecords: 1, TotalPages: 1 }],
      ],
    });
    const res = mockRes();
    await customerController.fetch(baseReq({ body: { SearchTerm: "  sharma ", BranchId: "3" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCustomers", {
      CompId: 5, PageNumber: 1, PageSize: 25, SearchTerm: "sharma", BranchId: 3, IsActive: 1,
      UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: null,
    });
    const { data } = res.json.mock.calls[0][0];
    expect(data.customers).toHaveLength(1);
    expect(data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });

  // REGRESSION guard (controllerKit): PageSize must never reach SQL Server raw.
  it("clamps PageSize to 200 and echoes the clamped value when the SP returns no pagination row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await customerController.fetch(baseReq({ body: { PageNumber: 3, PageSize: 99999 } }), res);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ PageNumber: 3, PageSize: 200 });
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 3, pageSize: 200, totalRecords: 0, totalPages: 1 });
  });

  it("sends IsActive 0 for an explicit false and nulls a junk BranchId / blank search", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await customerController.fetch(baseReq({ body: { IsActive: false, BranchId: "abc", SearchTerm: "  " } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ IsActive: 0, BranchId: null, SearchTerm: null });
  });

  it("passes the customers scope (office + CreatedBy owner)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await customerController.fetch(accessReq([["customers", "v", "Office"]]), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCustomers",
      expect.objectContaining({ UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: null }));
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("customerController.detail", () => {
  const COMPLAINTS_OWN = [["customers", "v", "Office"], ["complaints", "v", "Own"]];

  it("gates RS1 by customers and lists complaints under the complaints scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 31, Name: "Sharma Traders", BranchId: 2, CreatedBy: 3 }],
        [{ Id: 4, TicketNo: "TKT-000004", StatusCode: "open", IsOverdue: true }],
      ],
    });
    const res = mockRes();
    const req = accessReq(COMPLAINTS_OWN, { CustomerId: "31" });
    await customerController.detail(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCustomerDetail", {
      CompId: 5, CustomerId: 31, UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]",
    });
    const { data } = res.json.mock.calls[0][0];
    expect(data.customer.Id).toBe(31);
    expect(data.tickets).toHaveLength(1);
  });

  it("sends an empty complaints allow-list when the caller has no complaints module", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 31, BranchId: 2, CreatedBy: 3 }], []] });
    await customerController.detail(accessReq([["customers", "v", "Office"]], { CustomerId: 31 }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ AccessibleBranchIdsJson: "[]", OwnerIdsJson: "[]" });
  });

  it("403s a customer outside customers reach", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 31, BranchId: 9, CreatedBy: 3 }], []] });
    const res = mockRes();
    await customerController.detail(accessReq(COMPLAINTS_OWN, { CustomerId: 31 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("400s without a CustomerId before touching the DB", async () => {
    const res = mockRes();
    await customerController.detail(baseReq({ body: { CustomerId: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("CustomerId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("404s when the customer does not exist in this company", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const res = mockRes();
    await customerController.detail(baseReq({ body: { CustomerId: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "NOT_FOUND" });
  });

  it("tolerates a missing recordsets array (404, not a TypeError)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({});
    const res = mockRes();
    await customerController.detail(baseReq({ body: { CustomerId: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.detail(baseReq({ body: { CustomerId: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("customerController.delete", () => {
  it("calls sp_DeleteCustomer with Id then CompId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 31, ResponseCode: 200, ResponseMess: "Customer deleted successfully" }],
    });
    const res = mockRes();
    await customerController.delete(baseReq({ body: { Id: 31 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteCustomer", { Id: 31, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §3: soft delete, 409 while any ticket references the customer.
  it("surfaces the SP's 409 when tickets still reference the customer", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 31, ResponseCode: 409, ResponseMess: "Customer has 3 complaint(s) and cannot be deleted" }],
    });
    const res = mockRes();
    await customerController.delete(baseReq({ body: { Id: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toMatch(/cannot be deleted/);
  });

  it("400s without an Id", async () => {
    const res = mockRes();
    await customerController.delete(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("falls back to ResponseMessage when ResponseMess is absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMessage: "Deleted via ResponseMessage" }],
    });
    const res = mockRes();
    await customerController.delete(baseReq({ body: { Id: 31 } }), res);
    expect(res.json.mock.calls[0][0].message).toBe("Deleted via ResponseMessage");
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.delete(baseReq({ body: { Id: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
