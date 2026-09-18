jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const {
  HIERARCHY,
  loadScope,
  requireMinLevel,
  requireAdmin,
  scopeParams,
  canSeeRecord,
  canWriteBranch,
  canReadBranch,
  assertRecordAccess,
  canReopen,
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

  describe("requireAdmin", () => {
    it("403s when scope is absent", () => {
      const res = mockRes();
      const next = jest.fn();
      requireAdmin({ user: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "NO_SCOPE" })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("403s a non-admin caller", () => {
      const res = mockRes();
      const next = jest.fn();
      requireAdmin({ scope: { isAdmin: false } }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INSUFFICIENT_ROLE" })
      );
      expect(next).not.toHaveBeenCalled();
    });

    // REGRESSION: the refusal used to read "Only an administrator can manage
    // users" — written when userRoutes was its only caller. It now guards
    // lookups, custom fields, products and customer deletion too, and the live
    // pass on 2026-09-17 caught it telling a Support Head that adding a ticket
    // category was about managing users. The message is shown verbatim in both
    // clients, so it has to describe the action the caller actually attempted —
    // which means saying nothing about which one it was.
    it("refuses without naming user management — it guards six route groups", () => {
      const res = mockRes();
      requireAdmin({ scope: { isAdmin: false } }, res, jest.fn());
      const { message } = res.json.mock.calls[0][0];
      expect(message).not.toMatch(/user/i);
      expect(message).toMatch(/administrator/i);
    });

    // The distinction that matters: IsAdmin is a role property on
    // tblUserGroups, not a rank. The level-2 department heads (Sales/Support/HR)
    // must NOT pass — requireMinLevel(HIERARCHY.ADMIN) would let them through,
    // handing them the ability to mint IsAdmin accounts.
    it("403s a level-2 department head who is not IsAdmin", () => {
      const res = mockRes();
      const next = jest.fn();
      requireAdmin(
        { scope: { hierarchyLevel: HIERARCHY.ADMIN, isAdmin: false } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next for a real admin", () => {
      const res = mockRes();
      const next = jest.fn();
      requireAdmin({ scope: { isAdmin: true } }, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
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

    // Spec 2 §3: the guard hands back the row it fetched, so a controller
    // that needs the assignee (the reopen gate) has it without a second
    // sp_Fetch*Detail round-trip. Truthiness is what every caller tests.
    it("allows a lead the caller owns and resolves to the fetched record", async () => {
      const lead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 3 };
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[lead], [], []],
      });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "lead", 9)).resolves.toEqual(lead);
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

    it("reads tickets via sp_FetchTicketDetail using AssignedTo as the owner field, and resolves to the ticket", async () => {
      const ticket = { Id: 4, BranchId: 9, AssignedTo: 7, CreatedBy: 3 };
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[ticket], [], [], [], []],
      });
      const res = mockRes();
      // Assigned to caller from an out-of-scope branch: assignment beats scope.
      await expect(assertRecordAccess(selfReq, res, "ticket", 4)).resolves.toEqual(ticket);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith(
        "sp_FetchTicketDetail",
        { CompId: 5, TicketId: 4 },
      );
    });

    // Tasks have no row to hand back — sp_CheckTaskPermission answers yes/no —
    // so the task branch keeps resolving to a plain true.
    it("still resolves to true (not a record) for tasks", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Allowed: true, Reason: "role=owner" }]],
      });
      await expect(assertRecordAccess(selfReq, mockRes(), "task", 12)).resolves.toBe(true);
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

    it("passes a raw task action straight through (change_status for a checklist tick)", async () => {
      // 'view'/'write' don't cover ticking a checklist: that is change_status,
      // which the SP grants an assignee but edit_fields would refuse.
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Allowed: true, Reason: "role=member action=change_status" }]],
      });
      const res = mockRes();
      await expect(
        assertRecordAccess(selfReq, res, "task", 12, "change_status"),
      ).resolves.toBe(true);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith(
        "sp_CheckTaskPermission",
        expect.objectContaining({ Action: "change_status" }),
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

  // Spec 2 §3 Rules — Reopen: a manager's act. Wide scopes always; a Team
  // lead only for a ticket assigned to someone in their subtree — never their
  // own, never an unassigned one. Self agents never. Pure: the controller
  // already fetched the ticket through assertRecordAccess.
  describe("canReopen", () => {
    const req = (dataScope, ownerIds, UserId = 16) => ({
      user: { UserId, CompId: 1 },
      scope: { dataScope, branchIds: [1], ownerIds },
    });
    const ticket = (AssignedTo) => ({ Id: 1, BranchId: 1, AssignedTo, CreatedBy: 16 });

    it.each(["All", "Company", "MultiBranch", "Branch"])(
      "%s scope may reopen anything — own, unassigned, a stranger's",
      (scope) => {
        expect(canReopen(req(scope, null), ticket(16))).toBe(true);
        expect(canReopen(req(scope, null), ticket(null))).toBe(true);
        expect(canReopen(req(scope, null), ticket(99))).toBe(true);
      },
    );

    it("lets a Team lead reopen a subordinate's ticket", () => {
      expect(canReopen(req("Team", [16, 17, 18]), ticket(17))).toBe(true);
    });

    it("refuses a Team lead their own, an unassigned, or an outsider's ticket", () => {
      const r = req("Team", [16, 17, 18]);
      expect(canReopen(r, ticket(16))).toBe(false);
      expect(canReopen(r, ticket(null))).toBe(false);
      expect(canReopen(r, ticket(21))).toBe(false);
    });

    it("never lets a Self agent reopen — not even a colleague's ticket they created", () => {
      expect(canReopen(req("Self", [17], 17), ticket(17))).toBe(false);
      expect(canReopen(req("Self", [17], 17), { ...ticket(18), CreatedBy: 17 })).toBe(false);
    });

    it("coerces ids (the driver hands BIGINTs back as strings) and fails closed on a missing scope or record", () => {
      expect(canReopen(req("Team", [17]), ticket("17"))).toBe(true);
      expect(canReopen({ user: { UserId: 16 } }, ticket(17))).toBe(false);
      expect(canReopen(req("Team", [17]), null)).toBe(false);
    });
  });
});
