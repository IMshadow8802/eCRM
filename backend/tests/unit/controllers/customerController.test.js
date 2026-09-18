jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const customerController = require("../../../src/controllers/customerController");
const { mockRes } = require("../../helpers/mockRes");

// Routes always run loadScope, so req.scope is present on every real request.
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

describe("customerController.save", () => {
  it("creates: injects Id=0, CompId, the caller's BranchId and UserId, and forwards exactly the SP's columns", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await customerController.save(baseReq({ body: { ...FULL, CompId: 999, IsActive: 0, Junk: "x" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveCustomer", {
      Id: 0, CompId: 5, BranchId: 2, UserId: 7,
      Name: "Sharma Traders", ContactPerson: "Rakesh Sharma", Mobile: "98765 43210", AltMobile: null,
      Email: "rakesh@sharma.in", Address: "12 MG Road", City: "Ghaziabad", State: "UP", Pincode: "201010",
      Remarks: "Walk-in regular",
    });
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).not.toHaveProperty("IsActive");
    expect(params).not.toHaveProperty("Junk");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.Id).toBe(31);
  });

  it("updates when Id > 0 (no record gate — customers are company-wide, spec §3)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 31 }));
    await customerController.save(baseReq({ body: { ...FULL, Id: "31" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ Id: 31, CompId: 5 });
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
    await customerController.save(baseReq({ body: { Name: "B", Mobile: "9" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
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

  // Customers are company-wide by design (dedupe needs it, spec §3) — the SP
  // declares no scope params, so none are sent (node-mssql rejects extras).
  it("does not send scope params — sp_FetchCustomers declares none", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await customerController.fetch(baseReq({ scope: { branchIds: [2], ownerIds: [7] } }), mockRes());
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).not.toHaveProperty("AccessibleBranchIdsJson");
    expect(params).not.toHaveProperty("OwnerIdsJson");
    expect(params).not.toHaveProperty("UserId");
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("customerController.detail", () => {
  it("passes CompId, CustomerId and the caller's scope; maps customer + tickets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 31, Name: "Sharma Traders", Mobile: "9876543210" }],
        [{ Id: 4, TicketNo: "TKT-000004", StatusCode: "open", IsOverdue: true }],
      ],
    });
    const res = mockRes();
    await customerController.detail(
      baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { CustomerId: "31" } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCustomerDetail", {
      CompId: 5, CustomerId: 31, UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]",
    });
    const { data } = res.json.mock.calls[0][0];
    expect(data.customer.Id).toBe(31);
    expect(data.tickets).toEqual([{ Id: 4, TicketNo: "TKT-000004", StatusCode: "open", IsOverdue: true }]);
  });

  it("sends null scope json for a wide scope (no owner filter on RS2)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 31 }], []] });
    await customerController.detail(baseReq({ scope: { branchIds: [1, 2, 3], ownerIds: null }, body: { CustomerId: 31 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ AccessibleBranchIdsJson: "[1,2,3]", OwnerIdsJson: null });
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
