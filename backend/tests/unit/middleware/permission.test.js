jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const {
  HIERARCHY,
  loadScope,
  requireMinLevel,
  canWriteBranch,
  canReadBranch,
} = require("../../../src/middleware/permission");
const { mockRes } = require("../../helpers/mockRes");

describe("permission middleware", () => {
  describe("HIERARCHY constants", () => {
    it("orders Super < Admin < Manager < Employee", () => {
      expect(HIERARCHY.SUPER).toBeLessThan(HIERARCHY.ADMIN);
      expect(HIERARCHY.ADMIN).toBeLessThan(HIERARCHY.MANAGER);
      expect(HIERARCHY.MANAGER).toBeLessThan(HIERARCHY.EMPLOYEE);
    });
  });

  describe("canReadBranch / canWriteBranch", () => {
    const req = {
      scope: { branchIds: [1, 2, 3], canWriteBranchIds: [1] },
    };

    it("canReadBranch matches any branch in scope.branchIds", () => {
      expect(canReadBranch(req, 1)).toBe(true);
      expect(canReadBranch(req, 3)).toBe(true);
      expect(canReadBranch(req, 99)).toBe(false);
    });

    it("canWriteBranch only matches canWriteBranchIds", () => {
      expect(canWriteBranch(req, 1)).toBe(true);
      expect(canWriteBranch(req, 2)).toBe(false);
    });

    it("returns false when scope is missing", () => {
      expect(canReadBranch({}, 1)).toBe(false);
      expect(canWriteBranch({}, 1)).toBe(false);
    });

    it("coerces string branchIds", () => {
      expect(canReadBranch(req, "2")).toBe(true);
    });
  });

  describe("requireMinLevel", () => {
    it("403s when scope is absent", () => {
      const res = mockRes();
      const next = jest.fn();
      requireMinLevel(HIERARCHY.ADMIN)({ user: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("403s when caller's level is too high a number (lower rank)", () => {
      const res = mockRes();
      const next = jest.fn();
      const req = { scope: { hierarchyLevel: HIERARCHY.EMPLOYEE } };
      requireMinLevel(HIERARCHY.MANAGER)(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INSUFFICIENT_ROLE" })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next when caller meets the minimum level", () => {
      const res = mockRes();
      const next = jest.fn();
      const req = { scope: { hierarchyLevel: HIERARCHY.ADMIN } };
      requireMinLevel(HIERARCHY.MANAGER)(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("calls next at exact match", () => {
      const res = mockRes();
      const next = jest.fn();
      const req = { scope: { hierarchyLevel: HIERARCHY.MANAGER } };
      requireMinLevel(HIERARCHY.MANAGER)(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadScope", () => {
    beforeEach(() => {
      database.executeStoredProcedure.mockReset();
    });

    it("populates req.scope from SP result", async () => {
      database.executeStoredProcedure.mockResolvedValue({
        recordsets: [
          [{ HierarchyLevel: 2, DataScope: "Company", PrimaryBranchId: 1 }],
          [
            { BranchId: 1, CanWrite: true },
            { BranchId: 2, CanWrite: true },
            { BranchId: 3, CanWrite: false },
          ],
        ],
      });

      const req = { user: { UserId: 5, CompId: 1 } };
      const res = mockRes();
      const next = jest.fn();
      await loadScope(req, res, next);

      expect(req.scope).toEqual({
        hierarchyLevel: 2,
        dataScope: "Company",
        primaryBranchId: 1,
        branchIds: [1, 2, 3],
        canWriteBranchIds: [1, 2],
      });
      expect(next).toHaveBeenCalled();
    });

    it("fails closed when the SP throws", async () => {
      database.executeStoredProcedure.mockRejectedValue(new Error("boom"));
      const req = { user: { UserId: 5, CompId: 1, BranchId: 7 } };
      const res = mockRes();
      const next = jest.fn();
      await loadScope(req, res, next);

      expect(req.scope.hierarchyLevel).toBe(HIERARCHY.EMPLOYEE);
      expect(req.scope.dataScope).toBe("Self");
      expect(req.scope.branchIds).toEqual([7]);
      expect(next).toHaveBeenCalled();
    });

    it("no-ops when there is no req.user", async () => {
      const req = {};
      const res = mockRes();
      const next = jest.fn();
      await loadScope(req, res, next);
      expect(req.scope).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });
});
