jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));

const database = require("../../../src/config/database");
const branchController = require("../../../src/controllers/branchController");
const { mockRes } = require("../../helpers/mockRes");

const req = (body) => ({ user: { UserId: 7, CompId: 5, BranchId: 2 }, body, ip: "1.1.1.1", headers: {} });
beforeEach(() => database.executeStoredProcedure.mockReset());

describe("branchController.saveBranch", () => {
  it("passes fields and CompId, returns the id, logs a create", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 9, ResponseCode: 201, ResponseMess: "Created" }]] });
    const res = mockRes();
    await branchController.saveBranch(req({ BranchName: "Pune", ParentId: "1", Address: "MG Rd" }), res);
    expect(database.executeStoredProcedure.mock.calls[0]).toEqual(["sp_SaveBranch",
      { Id: 0, BranchName: "Pune", ParentId: 1, Address: "MG Rd", IsActive: 1, CompId: 5 }]);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, data: { id: 9 } });
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveActivityLog",
      expect.objectContaining({ EntityType: "Branch", EntityId: 9, Action: "Created" }));
  });

  it("edit: keeps Id, null parent/address, IsActive false -> 0, logs an update", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 4, ResponseCode: 200, ResponseMess: "Saved" }]] });
    await branchController.saveBranch(req({ Id: 4, BranchName: "Old", IsActive: false }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toEqual(
      { Id: 4, BranchName: "Old", ParentId: null, Address: null, IsActive: 0, CompId: 5 });
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveActivityLog",
      expect.objectContaining({ Action: "Updated" }));
  });

  it("surfaces the SP's 400 for a loop, with no audit row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 400, ResponseMess: "Office tree would loop" }]] });
    const res = mockRes();
    await branchController.saveBranch(req({ Id: 4, BranchName: "A", ParentId: 4 }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, data: null, message: "Office tree would loop" });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await branchController.saveBranch(req({ BranchName: "A" }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("BRANCH_SAVE_ERROR");
  });
});
