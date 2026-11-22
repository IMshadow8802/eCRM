jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const {
  loadScope,
  requireAdmin,
  requireModule,
  open,
  saveAction,
  scopeParams,
  canSeeRecord,
  canWriteBranch,
  canReadBranch,
  assertRecordAccess,
  taskAllowed,
  visibleRecord,
  visibleFollowUp,
} = require("../../../src/middleware/permission");
const permission = require("../../../src/middleware/permission");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");

describe("permission middleware", () => {
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

  describe("requireAdmin", () => {
    it("403s when access is absent", () => {
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
      requireAdmin({ access: { isAdmin: false } }, res, next);
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
      requireAdmin({ access: { isAdmin: false } }, res, jest.fn());
      const { message } = res.json.mock.calls[0][0];
      expect(message).not.toMatch(/user/i);
      expect(message).toMatch(/administrator/i);
    });

    // IsAdmin is a role property on tblUserGroups, not a set of grants. A
    // department head holding every module right must still not pass — user
    // management can mint IsAdmin accounts.
    it("403s a head with every module grant who is not IsAdmin", () => {
      const res = mockRes();
      const next = jest.fn();
      const access = mockAccess({ modules: [["people", "vaed", "Company"], ["settings", "vaed"], ["roles", "vaed"]] });
      requireAdmin({ user: { UserId: 7 }, access }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    // The guard reads req.access, not req.scope: a scope object is rebound per
    // module and must not be the thing that grants admin.
    it("ignores an isAdmin on req.scope when req.access says no", () => {
      const res = mockRes();
      requireAdmin({ access: { isAdmin: false }, scope: { isAdmin: true } }, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("calls next for a real admin", () => {
      const res = mockRes();
      const next = jest.fn();
      requireAdmin({ access: { isAdmin: true } }, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("requireModule / open / saveAction", () => {
    const access = { isAdmin: false, isActive: true, primaryBranchId: 2, teamOwners: [],
      modules: { leads: { view: true, add: true, edit: false, delete: false, reach: "Own" } },
      lists: { Own: [{ BranchId: 2, CanWrite: true }], Team: [], Office: [], OfficeTree: [], Company: [] } };
    const mk = (body = {}) => ({ user: { UserId: 7 }, access, scope: { module: "people" }, body });

    it("passes with the right and re-binds req.scope to the module", () => {
      const req = mk(); const next = jest.fn();
      requireModule("leads", "view")(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.scope).toMatchObject({ module: "leads", ownerIds: [7] });
    });
    it("403s without the right", () => {
      const res = mockRes(); const next = jest.fn();
      requireModule("leads", "edit")(mk(), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
    it("403s a module the role lacks entirely (HR on leads)", () => {
      const res = mockRes();
      requireModule("complaints", "view")(mk(), res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
    });
    it("saveAction: Id > 0 is edit, else add", () => {
      expect(saveAction({ body: { Id: 5 } })).toBe("edit");
      expect(saveAction({ body: { Id: 0 } })).toBe("add");
      expect(saveAction({ body: {} })).toBe("add");
    });
    it("module may be a function of the request", () => {
      const next = jest.fn();
      requireModule((req) => (req.body.TicketId ? "complaints" : "leads"), "view")(mk({ LeadId: 1 }), mockRes(), next);
      expect(next).toHaveBeenCalled();
    });
    it("guards carry an access marker for the route walk", () => {
      expect(requireModule("leads", "view").access).toEqual({ module: "leads", action: "view" });
      expect(open().access).toBe("open");
      expect(requireAdmin.access).toBe("admin");
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

  describe("canSeeRecord — a moved lead leaves its creator", () => {
    const ownOnly = (userId) => ({ user: { UserId: userId }, scope: { branchIds: [1], ownerIds: [userId] } });

    it("hides a lead from its creator once someone else owns it", () => {
      expect(canSeeRecord(ownOnly(7), { OwnerId: 9, CreatedBy: 7, BranchId: 1 }, "OwnerId")).toBe(false);
    });
    it("still shows the lead to its current owner", () => {
      expect(canSeeRecord(ownOnly(9), { OwnerId: 9, CreatedBy: 7, BranchId: 1 }, "OwnerId")).toBe(true);
    });
    it("still shows it to a manager whose team reach covers the new owner", () => {
      const manager = { user: { UserId: 3 }, scope: { branchIds: [1], ownerIds: [3, 9] } };
      expect(canSeeRecord(manager, { OwnerId: 9, CreatedBy: 7, BranchId: 1 }, "OwnerId")).toBe(true);
    });
    // Complaints now mirror leads (aligned 2026-11-21): the creator keeps a
    // ticket only while it is unassigned. Once it is assigned to someone else,
    // the ex-creator loses it, just like a handed-off lead.
    it("hides a complaint from its creator once it is assigned to someone else", () => {
      expect(canSeeRecord(ownOnly(7), { AssignedTo: 9, CreatedBy: 7, BranchId: 1 }, "AssignedTo")).toBe(false);
    });
    it("keeps an unassigned complaint visible to its creator, even outside their reach", () => {
      expect(canSeeRecord(ownOnly(7), { AssignedTo: null, CreatedBy: 7, BranchId: 5 }, "AssignedTo")).toBe(true);
    });
    it("keeps a self-assigned complaint visible to its creator", () => {
      expect(canSeeRecord(ownOnly(7), { AssignedTo: 7, CreatedBy: 7, BranchId: 5 }, "AssignedTo")).toBe(true);
    });
    it("still shows a reassigned complaint to its current assignee", () => {
      expect(canSeeRecord(ownOnly(9), { AssignedTo: 9, CreatedBy: 7, BranchId: 1 }, "AssignedTo")).toBe(true);
    });
    it("still shows a reassigned complaint to a manager whose reach covers the assignee", () => {
      const manager = { user: { UserId: 3 }, scope: { branchIds: [1], ownerIds: [3, 9] } };
      expect(canSeeRecord(manager, { AssignedTo: 9, CreatedBy: 7, BranchId: 1 }, "AssignedTo")).toBe(true);
    });
    // Regression: an "assign later" lead (OwnerId NULL) vanished from its creator's list and detail.
    it("keeps an unassigned lead visible to its creator, even outside their reach", () => {
      expect(canSeeRecord(ownOnly(7), { OwnerId: null, CreatedBy: 7, BranchId: 5 }, "OwnerId")).toBe(true);
      expect(canSeeRecord({ user: { UserId: 7 } }, { OwnerId: null, CreatedBy: 7, BranchId: 5 }, "OwnerId")).toBe(true);
    });
    it("does not show an unassigned lead to someone who did not create it", () => {
      expect(canSeeRecord(ownOnly(7), { OwnerId: null, CreatedBy: 8, BranchId: 1 }, "OwnerId")).toBe(false);
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

    it("allows a complaint the caller created while it is unassigned", () => {
      expect(canSeeRecord(selfScoped, { BranchId: 2, AssignedTo: null, CreatedBy: 7 }, "AssignedTo")).toBe(true);
    });

    it("denies a complaint the caller created once it is assigned to someone else", () => {
      expect(canSeeRecord(selfScoped, { BranchId: 2, AssignedTo: 3, CreatedBy: 7 }, "AssignedTo")).toBe(false);
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

    // Fix round 1: no scope = fail closed, but the always-visible rule
    // (owner / creator) is checked first and still wins.
    it("denies a colleague's record when req.scope is missing", () => {
      expect(canSeeRecord({ user: { UserId: 7 } }, { BranchId: 2, OwnerId: 3, CreatedBy: 3 }, "OwnerId")).toBe(false);
    });

    it("still allows the caller's own or created (unassigned) record when req.scope is missing", () => {
      expect(canSeeRecord({ user: { UserId: 7 } }, { BranchId: 2, OwnerId: 7, CreatedBy: 3 }, "OwnerId")).toBe(true);
      expect(canSeeRecord({ user: { UserId: 7 } }, { BranchId: 2, AssignedTo: null, CreatedBy: 7 }, "AssignedTo")).toBe(true);
    });

    it("denies a null record", () => {
      expect(canSeeRecord(branchScoped, null, "OwnerId")).toBe(false);
    });

    it("reads the owner from the named field (tickets use AssignedTo)", () => {
      expect(canSeeRecord(selfScoped, { BranchId: 9, AssignedTo: 7, CreatedBy: 3 }, "AssignedTo")).toBe(true);
      expect(canSeeRecord(selfScoped, { BranchId: 2, AssignedTo: 3, CreatedBy: 3 }, "AssignedTo")).toBe(false);
    });
  });

  describe("loadScope (access)", () => {
    beforeEach(() => database.executeStoredProcedure.mockReset());
    const sets = (header, modules = [], lists = [], owners = []) => ({ recordsets: [[header], modules, lists, owners] });
    it("builds req.access and binds req.scope to people", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(sets(
        { PrimaryBranchId: 2, IsActive: 1, IsAdmin: 0, CanSeeSensitive: 0 },
        [{ Module: "people", CanView: 1, Reach: "Own" }],
        [{ Reach: "Own", BranchId: 2, CanWrite: 1 }]));
      const req = { user: { UserId: 7, CompId: 1, BranchId: 2 } };
      const next = jest.fn();
      await loadScope(req, mockRes(), next);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchUserAccess", { UserId: 7, CompId: 1 });
      expect(req.scope).toMatchObject({ module: "people", reach: "Own", branchIds: [2], ownerIds: [7], isAdmin: false });
      expect(next).toHaveBeenCalled();
    });
    it("403s an inactive user", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(sets({ PrimaryBranchId: 2, IsActive: 0, IsAdmin: 0 }));
      const res = mockRes();
      await loadScope({ user: { UserId: 7, CompId: 1 } }, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
    });
    it("fails closed with no modules when the lookup throws", async () => {
      database.executeStoredProcedure.mockRejectedValueOnce(new Error("db down"));
      const req = { user: { UserId: 7, CompId: 1, BranchId: 2 } };
      await loadScope(req, mockRes(), jest.fn());
      expect(req.access.modules).toEqual({});
      expect(req.scope.can.view).toBe(false);
      expect(req.scope.branchIds).toEqual([]);
    });
  });

  describe("taskAllowed", () => {
    const req = { user: { UserId: 7, CompId: 1 }, scope: { isAdmin: true } };
    beforeEach(() => database.executeStoredProcedure.mockReset());

    it("asks sp_CheckTaskPermission for the exact action and answers true", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Allowed: 1 }]] });
      await expect(taskAllowed(req, "12", "manage_checklist")).resolves.toBe(true);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_CheckTaskPermission", {
        TaskId: 12, UserId: 7, Action: "manage_checklist", IsAdmin: 1, CompId: 1,
      });
    });

    it("answers false on a refusal or an empty answer", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Allowed: 0 }]] });
      await expect(taskAllowed(req, 12, "manage_checklist")).resolves.toBe(false);
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
      await expect(taskAllowed(req, 12, "manage_checklist")).resolves.toBe(false);
    });

    it("reads a plain recordset and a non-admin scope", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ Allowed: true }] });
      await expect(taskAllowed({ user: req.user }, 12, "x")).resolves.toBe(true);
      expect(database.executeStoredProcedure.mock.calls[0][1].IsAdmin).toBe(0);
    });
  });

  describe("assertRecordAccess", () => {
    beforeEach(() => {
      database.executeStoredProcedure.mockReset();
    });

    // Own reach on leads + complaints: home office 2, owner = me.
    const selfReq = {
      user: { UserId: 7, CompId: 5 },
      access: mockAccess({ modules: [["leads", "v", "Own"], ["complaints", "v", "Own"]] }),
      scope: { branchIds: [2], ownerIds: [7], isAdmin: false },
    };

    it("resolves to the row the detail procedure returns, asked with the session person", async () => {
      const lead = { Id: 9, CanEdit: 0 };
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[lead], [], []] });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "lead", 9)).resolves.toEqual(lead);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchLeadDetail", { CompId: 5, UserId: 7, LeadId: 9 });
      expect(res.status).not.toHaveBeenCalled();
    });

    // 404 = not visible (missing and out-of-reach answer alike); the clients
    // leave the screen on 404 only.
    it("404s NOT_FOUND with the entity's name when the procedure returns no row", async () => {
      for (const [entity, name] of [["lead", "Lead"], ["ticket", "Complaint"], ["quotation", "Quotation"], ["quoteprofile", "Letterhead"]]) {
        database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [], []] });
        const res = mockRes();
        await expect(assertRecordAccess(selfReq, res, entity, 9, "write")).resolves.toBe(false);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NOT_FOUND", message: `${name} not found` }));
      }
    });

    // 403 = visible, but the action is refused: the client stays on the record.
    it("403s FORBIDDEN on a write to a row it can see but not edit; a view passes", async () => {
      for (const entity of ["lead", "ticket", "quotation"]) {
        database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 9, CanEdit: 0 }]] });
        const res = mockRes();
        await expect(assertRecordAccess(selfReq, res, entity, 9, "write")).resolves.toBe(false);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          code: "FORBIDDEN", message: "You do not have permission for this action",
        }));
      }
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 9, CanEdit: 0 }]] });
      await expect(assertRecordAccess(selfReq, mockRes(), "lead", 9, "view")).resolves.toEqual({ Id: 9, CanEdit: 0 });
    });

    it("lets a write through on CanEdit 1, and on a company-wide entity without CanEdit", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 9, CanEdit: 1 }]] });
      await expect(assertRecordAccess(selfReq, mockRes(), "lead", 9, "write")).resolves.toEqual({ Id: 9, CanEdit: 1 });
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 2 }]] });
      await expect(assertRecordAccess(selfReq, mockRes(), "quoteprofile", 2, "write")).resolves.toEqual({ Id: 2 });
    });

    it("403s a write when the row says CanEdit 0", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 4, CanEdit: 0 }]] });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "ticket", 4, "write")).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("500s (fail closed) when there is no session person", async () => {
      const res = mockRes();
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      await expect(assertRecordAccess({ user: { CompId: 5 } }, res, "lead", 9)).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    // Tasks have no row to hand back — sp_CheckTaskPermission answers yes/no —
    // so the task branch keeps resolving to a plain true.
    it("still resolves to true (not a record) for tasks", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Allowed: true, Reason: "role=owner" }]],
      });
      await expect(assertRecordAccess(selfReq, mockRes(), "task", 12)).resolves.toBe(true);
    });

    // Regression, 2026-10-07 audit S8: markTaskCommentRead wrote a read receipt
    // for any comment id in any company. A comment is judged by its task's
    // workspace — sp_CheckTaskPermission resolves the task from CommentId.
    it("routes comments through sp_CheckTaskPermission by CommentId", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Allowed: false, Reason: "not a workspace member" }]],
      });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "comment", 33)).resolves.toBe(false);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_CheckTaskPermission", {
        CommentId: 33,
        UserId: 7,
        Action: "view_task",
        IsAdmin: 0,
        CompId: 5,
      });
      expect(res.status).toHaveBeenCalledWith(403);
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

    // The letterhead is the company's. A Self-scoped agent in another branch
    // must still be able to draw the logo on a quotation.
    it("lets any user of the company read a quote profile, whatever their scope", async () => {
      const profile = { Id: 3, CompId: selfReq.user.CompId, BranchId: 77, IsSet: true };
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[profile]] });
      await expect(assertRecordAccess(selfReq, mockRes(), "quoteprofile", 3)).resolves.toEqual(profile);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchQuoteProfileById", {
        CompId: selfReq.user.CompId, ProfileId: 3,
      });
    });

    it("403s a quote profile that is not in the caller's company (the SP returns nothing)", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
      await expect(assertRecordAccess(selfReq, mockRes(), "quoteprofile", 3)).resolves.toBe(false);
    });
  });

  describe("visibleRecord — the database answers", () => {
    beforeEach(() => database.executeStoredProcedure.mockReset());
    const reqAs = (user, extra = {}) => ({ user, ...extra });

    it("asks the detail procedure with the session person and nothing else", async () => {
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 5, CanEdit: 1 }]] });
      await visibleRecord(reqAs({ UserId: 7, CompId: 1 }), "ticket", 5);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchTicketDetail", { CompId: 1, UserId: 7, TicketId: 5 });
    });

    it("maps each entity to its procedure and id parameter", async () => {
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 1 }]] });
      const req = reqAs({ UserId: 7, CompId: 1 });
      await visibleRecord(req, "lead", "3");
      await visibleRecord(req, "quotation", 4);
      expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(1, "sp_FetchLeadDetail", { CompId: 1, UserId: 7, LeadId: 3 });
      expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(2, "sp_FetchQuotationDetail", { CompId: 1, UserId: 7, QuotationId: 4 });
    });

    it("takes the person from the session, never from the body", async () => {
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 5 }]] });
      await visibleRecord(reqAs({ UserId: 7, CompId: 1 }, { body: { UserId: 99, CompId: 2 } }), "lead", 5);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchLeadDetail", { CompId: 1, UserId: 7, LeadId: 5 });
    });

    it("no row = not visible, even for an admin session", async () => {
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
      const admin = reqAs({ UserId: 7, CompId: 1, IsAdmin: true }, {
        access: mockAccess({ admin: true }), scope: { isAdmin: true, branchIds: null, ownerIds: null },
      });
      await expect(visibleRecord(admin, "ticket", 5)).resolves.toBe(false);
      database.executeStoredProcedure.mockResolvedValue({});
      await expect(visibleRecord(admin, "lead", 5)).resolves.toBe(false);
    });

    it("write level needs CanEdit on the row", async () => {
      const req = reqAs({ UserId: 7, CompId: 1 });
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 5, CanEdit: 0 }]] });
      await expect(visibleRecord(req, "lead", 5, "write")).resolves.toBe(false);
      await expect(visibleRecord(req, "lead", 5)).resolves.toEqual({ Id: 5, CanEdit: 0 });
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 5 }]] });
      await expect(visibleRecord(req, "lead", 5, "write")).resolves.toBe(false);
      for (const CanEdit of [1, true]) {
        database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 5, CanEdit }]] });
        await expect(visibleRecord(req, "lead", 5, "write")).resolves.toEqual({ Id: 5, CanEdit });
      }
    });

    // W3 regression (fails on the old code, which re-judged the row against
    // req.scope's lists): the database's answer is the whole answer.
    it("W3 regression: a record outside req.scope lists is visible when the database returns it", async () => {
      const row = { Id: 5, BranchId: 99, AssignedTo: 42, CreatedBy: 42, CanEdit: 1 };
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[row]] });
      const req = reqAs({ UserId: 7, CompId: 1 }, {
        access: mockAccess({ modules: [["complaints", "ve", "Own"]] }),
        scope: { branchIds: [2], ownerIds: [7], isAdmin: false },
      });
      await expect(visibleRecord(req, "ticket", 5, "write")).resolves.toEqual(row);
    });

    it("throws NO_ACTOR without a session person, before any call", async () => {
      await expect(visibleRecord(reqAs({ CompId: 1 }), "ticket", 5)).rejects.toThrow("NO_ACTOR");
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    it("quoteprofile stays company-wide: CompId only, no CanEdit needed", async () => {
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 3 }]] });
      await expect(visibleRecord(reqAs({ UserId: 7, CompId: 1 }), "quoteprofile", 3, "write")).resolves.toEqual({ Id: 3 });
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchQuoteProfileById", { CompId: 1, ProfileId: 3 });
    });
  });

  describe("visibleFollowUp", () => {
    beforeEach(() => database.executeStoredProcedure.mockReset());

    it("asks sp_FetchFollowUpLead with the session person and returns the row", async () => {
      const row = { Id: 21, LeadId: 9, Via: 2, CanAct: 1 };
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[row]] });
      await expect(visibleFollowUp({ user: { UserId: 7, CompId: 1 } }, "21")).resolves.toEqual(row);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchFollowUpLead", { CompId: 1, UserId: 7, Id: 21 });
    });

    it("no row = false", async () => {
      database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
      await expect(visibleFollowUp({ user: { UserId: 7, CompId: 1 } }, 21)).resolves.toBe(false);
      database.executeStoredProcedure.mockResolvedValue({});
      await expect(visibleFollowUp({ user: { UserId: 7, CompId: 1 } }, "x")).resolves.toBe(false);
      expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_FetchFollowUpLead", { CompId: 1, UserId: 7, Id: 0 });
    });
  });

  it("assertCanAssign and canReopen are gone", () => {
    expect(permission.assertCanAssign).toBeUndefined();
    expect(permission.canReopen).toBeUndefined();
  });
});
