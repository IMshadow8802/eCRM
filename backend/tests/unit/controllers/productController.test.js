jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const productController = require("../../../src/controllers/productController");
const { mockRes } = require("../../helpers/mockRes");

const baseReq = (body = {}) => ({
  user: { UserId: 7, CompId: 5, BranchId: 2 },
  body,
});

beforeEach(() => database.executeStoredProcedure.mockReset());

describe("productController.save", () => {
  it("injects CompId + UserId and coerces the numeric fields", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 3, ResponseCode: 200, ResponseMess: "Product created successfully" }]],
    });
    const res = mockRes();
    await productController.save(
      baseReq({ Id: 0, Name: "TV 43in", Code: "TV43", CategoryId: 12, UnitPrice: "45000", MarginPct: "10" }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveProduct", {
      Id: 0, CompId: 5, UserId: 7, Name: "TV 43in", Code: "TV43",
      CategoryId: 12, UnitPrice: 45000, MarginPct: 10, IsActive: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.Id).toBe(3);
  });

  it("returns the SP's 409 on a duplicate name", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 0, ResponseCode: 409, ResponseMess: "A product with this name already exists" }]],
    });
    const res = mockRes();
    await productController.save(baseReq({ Name: "TV 43in" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await productController.save(baseReq({ Name: "X" }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("productController.fetch", () => {
  it("maps rows + pagination and clamps paging", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, Name: "TV" }],
        [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 25 }],
      ],
    });
    const res = mockRes();
    await productController.fetch(baseReq({ PageNumber: 0, PageSize: 99999, SearchTerm: "tv" }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchProducts", {
      CompId: 5, PageNumber: 1, PageSize: 200, SearchTerm: "tv", CategoryId: null, IsActive: true,
    });
    const json = res.json.mock.calls[0][0];
    expect(json.data.products).toEqual([{ Id: 1, Name: "TV" }]);
    expect(json.data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });

  it("passes IsActive null through as 'all'", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [{}]] });
    await productController.fetch(baseReq({ IsActive: null }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].IsActive).toBeNull();
  });
});

describe("productController.delete", () => {
  it("400s without an Id", async () => {
    const res = mockRes();
    await productController.delete(baseReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("forwards Id + CompId and returns the SP status", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Product deleted successfully" }]],
    });
    const res = mockRes();
    await productController.delete(baseReq({ Id: 4 }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteProduct", { Id: 4, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 404 from the SP", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 404, ResponseMess: "Product not found" }]],
    });
    const res = mockRes();
    await productController.delete(baseReq({ Id: 4 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
