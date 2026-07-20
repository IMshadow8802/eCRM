jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const {
  HIERARCHY,
  loadScope,
  requireMinLevel,
  scopeParams,
  canSeeRecord,
  canWriteBranch,
  canReadBranch,
  assertRecordAccess,
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

  describe("scopeParams", () => {
    it("serialises branch + owner scope and the caller's UserId", () => {
      const req = {
        user: { UserId: 7 },
        scope: { branchIds: [1, 2], ownerIds: [7] },
      };
      expect(scopeParams(req)).toEqual({
        UserId: 7,
        AccessibleBranchIdsJson: "[1,2]",
        OwnerIdsJson: "[7]",
      });
    });

    it("sends null for ownerIds on a wide scope (no ownership filter)", () => {
      const req = { user: { UserId: 7 }, scope: { branchIds: [1], ownerIds: null } };
      expect(scopeParams(req).OwnerIdsJson).toBeNull();
    });

    // The [] vs null distinction is load-bearing: serialising an empty scope to
    // null would mean "no filter" and fail OPEN, showing every row.
    it("serialises an empty scope to [] so it matches nothing, not everything", () => {
      const req = { user: { UserId: 7 }, scope: { branchIds: [], ownerIds: [] } };
      expect(scopeParams(req)).toEqual({
        UserId: 7,
        AccessibleBranchIdsJson: "[]",
        OwnerIdsJson: "[]",
      });
    });
  });

  describe("canSeeRecord", () => {
    const selfScoped = {
      user: { UserId: 7 },
      scope: { branchIds: [2], ownerIds: [7] },
    };
    const branchScoped = {
      user: { UserId: 7 },
      scope: { branchIds: [2], ownerIds: null },
    };

    it("allows a record the caller owns", () => {
      expect(canSeeRecord(selfScoped, { BranchId: 2, OwnerId: 7, CreatedBy: 3 }, "OwnerId")).toBe(true);
    });

    it("allows a record the caller created but does not own", () => {
      expect(canSeeRecord(selfScoped, { BranchId: 2, OwnerId: 3, CreatedBy: 7 }, "OwnerId")).toBe(true);
    });

    // Assignment is an explicit act of sharing — it beats branch scope.
    it("allows a record assigned to the caller from an out-of-scope branch", () => {
      expect(canSeeRecord(selfScoped, { BranchId: 9, OwnerId: 7, CreatedBy: 3 }, "OwnerId")).toBe(true);
    });

    it("denies a colleague's record under Self scope", () => {
      expect(canSeeRecord(selfScoped, { BranchId: 2, OwnerId: 3, CreatedBy: 3 }, "OwnerId")).toBe(false);
    });

    it("denies a record from a branch outside scope", () => {
      expect(canSeeRecord(branchScoped, { BranchId: 9, OwnerId: 3, CreatedBy: 3 }, "OwnerId")).toBe(false);
    });

    it("allows any in-branch record when there is no ownership filter", () => {
      expect(canSeeRecord(branchScoped, { BranchId: 2, OwnerId: 3, CreatedBy: 3 }, "OwnerId")).toBe(true);
    });

    it("denies a null record", () => {
      expect(canSeeRecord(branchScoped, null, "OwnerId")).toBe(false);
    });

    it("reads the owner from the named field (tickets use AssignedTo)", () => {
      expect(canSeeRecord(selfScoped, { BranchId: 9, AssignedTo: 7, CreatedBy: 3 }, "AssignedTo")).toBe(true);
      expect(canSeeRecord(selfScoped, { BranchId: 2, AssignedTo: 3, CreatedBy: 3 }, "AssignedTo")).toBe(false);
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
        ownerIds: null, // wide scope -> no ownership filter
        isAdmin: false,
        // Header has no IsActive column until 052 is applied — treated active.
        isActive: true,
      });
      expect(next).toHaveBeenCalled();
    });

    // Deactivation must take effect immediately, not when the JWT expires.
    it("403s USER_INACTIVE when the header row reports IsActive=0", async () => {
      database.executeStoredProcedure.mockResolvedValue({
        recordsets: [
          [{ HierarchyLevel: 4, DataScope: "Self", PrimaryBranchId: 2, IsAdmin: false, IsActive: false }],
          [{ BranchId: 2, CanWrite: true }],
          [{ OwnerId: 5 }],
        ],
      });
      const req = { user: { UserId: 5, CompId: 1 } };
      const res = mockRes();
      const next = jest.fn();
      await loadScope(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "USER_INACTIVE", success: false }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("passes through an active user when IsActive=1", async () => {
      database.executeStoredProcedure.mockResolvedValue({
        recordsets: [
          [{ HierarchyLevel: 4, DataScope: "Self", PrimaryBranchId: 2, IsAdmin: false, IsActive: true }],
          [{ BranchId: 2, CanWrite: true }],
          [{ OwnerId: 5 }],
        ],
      });
      const req = { user: { UserId: 5, CompId: 1 } };
      const next = jest.fn();
      await loadScope(req, mockRes(), next);
      expect(req.scope.isActive).toBe(true);
      expect(next).toHaveBeenCalled();
    });

    it("reads ownerIds + isAdmin from the SP's third result set", async () => {
      database.executeStoredProcedure.mockResolvedValue({
        recordsets: [
          [{ HierarchyLevel: 4, DataScope: "Self", PrimaryBranchId: 2, IsAdmin: false }],
          [{ BranchId: 2, CanWrite: true }],
          [{ OwnerId: 5 }],
        ],
      });

      const req = { user: { UserId: 5, CompId: 1 } };
      await loadScope(req, mockRes(), jest.fn());

      expect(req.scope.dataScope).toBe("Self");
      expect(req.scope.ownerIds).toEqual([5]);
      expect(req.scope.isAdmin).toBe(false);
    });

    it("marks isAdmin from the group, not from the hierarchy level", async () => {
      // A level-2 head (Sales/Support/HR) must NOT get the admin bypass —
      // deriving IsAdmin from `level <= 2` would hand them every workspace.
      database.executeStoredProcedure.mockResolvedValue({
        recordsets: [
          [{ HierarchyLevel: 2, DataScope: "Company", PrimaryBranchId: 1, IsAdmin: false }],
          [{ BranchId: 1, CanWrite: true }],
          [],
        ],
      });

      const req = { user: { UserId: 5, CompId: 1 } };
      await loadScope(req, mockRes(), jest.fn());

      expect(req.scope.hierarchyLevel).toBe(2);
      expect(req.scope.isAdmin).toBe(false);
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
      // Self scope means an ownership filter too — without it the fallback
      // would quietly widen to the caller's whole branch.
      expect(req.scope.ownerIds).toEqual([5]);
      expect(req.scope.isAdmin).toBe(false);
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

  describe("assertRecordAccess", () => {
    beforeEach(() => {
      database.executeStoredProcedure.mockReset();
    });

    const selfReq = {
      user: { UserId: 7, CompId: 5 },
      scope: { branchIds: [2], ownerIds: [7], isAdmin: false },
    };

    it("allows a lead the caller owns and fetches it via sp_FetchLeadDetail", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 3 }], [], []],
      });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "lead", 9)).resolves.toBe(true);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith(
        "sp_FetchLeadDetail",
        { CompId: 5, LeadId: 9 },
      );
      expect(res.status).not.toHaveBeenCalled();
    });

    it("403s a colleague's lead under Self scope", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 }], [], []],
      });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "lead", 9)).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN" }));
    });

    it("403s a missing record (mutation on a nonexistent id is denied)", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [], []] });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "lead", 999)).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("reads tickets via sp_FetchTicketDetail using AssignedTo as the owner field", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 4, BranchId: 9, AssignedTo: 7, CreatedBy: 3 }], [], [], []],
      });
      const res = mockRes();
      // Assigned to caller from an out-of-scope branch: assignment beats scope.
      await expect(assertRecordAccess(selfReq, res, "ticket", 4)).resolves.toBe(true);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith(
        "sp_FetchTicketDetail",
        { CompId: 5, TicketId: 4 },
      );
    });

    it("routes tasks through sp_CheckTaskPermission and honours a denial even for admins", async () => {
      // Personal-workspace privacy: the SP says no, and there is no isAdmin
      // bypass around it in the middleware.
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Allowed: false, Reason: "personal workspaces are private" }]],
      });
      const adminReq = { user: { UserId: 7, CompId: 5 }, scope: { isAdmin: true } };
      const res = mockRes();
      await expect(assertRecordAccess(adminReq, res, "task", 12, "write")).resolves.toBe(false);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith(
        "sp_CheckTaskPermission",
        { TaskId: 12, UserId: 7, Action: "edit_fields", IsAdmin: 1, CompId: 5 },
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("passes view-level task checks as view_task and allows when the SP allows", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Allowed: true, Reason: "role=member action=view_task" }]],
      });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "task", 12)).resolves.toBe(true);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith(
        "sp_CheckTaskPermission",
        expect.objectContaining({ Action: "view_task", IsAdmin: 0 }),
      );
    });

    it("403s an unknown entity without touching the DB", async () => {
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "misc", 1)).resolves.toBe(false);
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("500s (fail closed) when the lookup throws", async () => {
      database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "lead", 9)).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
