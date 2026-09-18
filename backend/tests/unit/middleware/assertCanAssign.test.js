jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const { assertCanAssign } = require("../../../src/middleware/permission");
const { mockRes } = require("../../helpers/mockRes");

const req = (dataScope, over = {}) => ({
  user: { UserId: 7, CompId: 5, BranchId: 2 },
  scope: { dataScope, branchIds: [2], ownerIds: null, isAdmin: false },
  ...over,
});
const roster = (ids) =>
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ids.map((Id) => ({ Id, FullName: `u${Id}` }))],
  });

beforeEach(() => database.executeStoredProcedure.mockReset());

describe("assertCanAssign", () => {
  it("allows a target the roster SP lists", async () => {
    roster([3, 9]);
    const res = mockRes();
    expect(await assertCanAssign(req("Team"), res, { toUserId: 9 })).toBe(true);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchAssignableUsers",
      { UserId: 7, CompId: 5, BranchId: null },
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403s a target outside the caller's subtree", async () => {
    roster([3]);
    const res = mockRes();
    expect(await assertCanAssign(req("Team"), res, { toUserId: 9 })).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("403s a cross-branch move from a Team lead", async () => {
    const res = mockRes();
    expect(await assertCanAssign(req("Team"), res, { toUserId: 9, toBranchId: 4 })).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("lets a Branch manager move to another branch, checking that branch's roster", async () => {
    roster([9]);
    const res = mockRes();
    expect(await assertCanAssign(req("Branch"), res, { toUserId: 9, toBranchId: 4 })).toBe(true);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchAssignableUsers",
      { UserId: 7, CompId: 5, BranchId: 4 },
    );
  });

  it("403s unassign from a Self-scoped executive", async () => {
    const res = mockRes();
    expect(await assertCanAssign(req("Self"), res, { toUserId: null })).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows unassign from a wide scope without a roster call", async () => {
    const res = mockRes();
    expect(await assertCanAssign(req("Company"), res, { toUserId: null })).toBe(true);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("500s when the roster lookup throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    expect(await assertCanAssign(req("Branch"), res, { toUserId: 9 })).toBe(false);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// The guard is shared by leads and tickets (spec 2 §3); the copy must not
// name either. The web shows these strings verbatim in a toast.
describe("assertCanAssign messages are entity-neutral", () => {
  it("unassign below Branch scope", async () => {
    const res = mockRes();
    await assertCanAssign(req("Self"), res, { toUserId: null });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Only a manager can leave a record unassigned" }),
    );
  });

  it("cross-branch below Branch scope", async () => {
    const res = mockRes();
    await assertCanAssign(req("Team"), res, { toUserId: 9, toBranchId: 4 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Only a branch manager or above can move a record to another branch" }),
    );
  });

  it("target outside the roster", async () => {
    roster([3]);
    const res = mockRes();
    await assertCanAssign(req("Team"), res, { toUserId: 9 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "You cannot assign records to that user" }),
    );
  });
});
