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
  assertCanAssign,
  canReopen,
} = require("../../../src/middleware/permission");
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

    // Fix round 1: no scope = fail closed, but the always-visible rule
    // (owner / creator) is checked first and still wins.
    it("denies a colleague's record when req.scope is missing", () => {
      expect(canSeeRecord({ user: { UserId: 7 } }, { BranchId: 2, OwnerId: 3, CreatedBy: 3 }, "OwnerId")).toBe(false);
    });

    it("still allows the caller's own or created record when req.scope is missing", () => {
      expect(canSeeRecord({ user: { UserId: 7 } }, { BranchId: 2, OwnerId: 7, CreatedBy: 3 }, "OwnerId")).toBe(true);
      expect(canSeeRecord({ user: { UserId: 7 } }, { BranchId: 2, OwnerId: 3, CreatedBy: 7 }, "OwnerId")).toBe(true);
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

    // A role without the module (HR on leads) is refused before the record is
    // even fetched — the module is the outer gate, the record rule the inner.
    it("403s a module the caller's role lacks, without a DB call", async () => {
      const hrReq = { ...selfReq, access: mockAccess({ modules: [["people", "vaed", "Company"]] }) };
      for (const entity of ["lead", "ticket", "quotation"]) {
        const res = mockRes();
        await expect(assertRecordAccess(hrReq, res, entity, 9)).resolves.toBe(false);
        expect(res.status).toHaveBeenCalledWith(403);
      }
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    it("403s a write when the module grants view but not edit, without a DB call", async () => {
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "lead", 9, "write")).resolves.toBe(false);
      await expect(assertRecordAccess(selfReq, mockRes(), "ticket", 4, "write")).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    it("allows a write when the module grants edit", async () => {
      const lead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 3 };
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[lead]] });
      const editReq = { ...selfReq, access: mockAccess({ modules: [["leads", "ve", "Own"]] }) };
      await expect(assertRecordAccess(editReq, mockRes(), "lead", 9, "write")).resolves.toEqual(lead);
    });

    // The record rule reads the MODULE's lists, not whatever req.scope holds:
    // an Office reach on complaints sees a colleague's ticket in the office
    // even when req.scope is still bound to a narrower module.
    it("judges the record against the entity's module scope, not req.scope", async () => {
      const ticket = { Id: 4, BranchId: 2, AssignedTo: 3, CreatedBy: 3 };
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[ticket]] });
      const officeReq = { ...selfReq, access: mockAccess({ modules: [["complaints", "v", "Office"]] }) };
      await expect(assertRecordAccess(officeReq, mockRes(), "ticket", 4)).resolves.toEqual(ticket);
    });

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

    // A quotation has no permission model of its own: sp_FetchQuotationDetail
    // returns the LEAD's OwnerId / BranchId / CreatedBy, so canSeeRecord
    // answers for the lead without knowing a quotation exists.
    it("gates a quotation on its parent lead's visibility", async () => {
      const quote = { Id: 4, LeadId: 9, Status: "draft", OwnerId: selfReq.user.UserId, BranchId: 2, CreatedBy: 99 };
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[quote], [], []] });
      await expect(assertRecordAccess(selfReq, mockRes(), "quotation", 4)).resolves.toEqual(quote);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchQuotationDetail", {
        CompId: selfReq.user.CompId, QuotationId: 4,
      });
    });

    it("403s a quotation whose lead the caller cannot see", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 4, Status: "draft", OwnerId: 999, BranchId: 77, CreatedBy: 999 }], [], []],
      });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "quotation", 4)).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
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

  // Transfer target guard. Three refusal rules in cheapness order, then a
  // DB-backed membership check. No isAdmin shortcut anywhere in here —
  // isWide(req.scope) decides wide vs narrow.
  describe("assertCanAssign", () => {
    beforeEach(() => {
      database.executeStoredProcedure.mockReset();
    });

    const req = (reach, UserId = 7, CompId = 5, extra = {}) => ({
      user: { UserId, CompId },
      scope: { reach, branchIds: [2], ownerIds: reach === "Own" ? [UserId] : null, ...extra },
    });

    it("refuses to leave a record unassigned under a narrow (Team) scope", async () => {
      const res = mockRes();
      await expect(assertCanAssign(req("Team"), res, {})).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Only a manager can leave a record unassigned" }),
      );
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    it("refuses to leave a record unassigned under Self scope too", async () => {
      const res = mockRes();
      await expect(assertCanAssign(req("Own"), res, { toUserId: 0 })).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("refuses moving a record to another branch under a narrow scope, even with a target user", async () => {
      const res = mockRes();
      await expect(
        assertCanAssign(req("Team"), res, { toUserId: 3, toBranchId: 9 }),
      ).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Only a branch manager or above can move a record to another branch",
        }),
      );
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    it("lets a wide-scope (Company) caller unassign without touching the DB", async () => {
      const res = mockRes();
      await expect(assertCanAssign(req("Company"), res, {})).resolves.toBe(true);
      expect(res.status).not.toHaveBeenCalled();
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    it("lets a wide-scope (Branch) caller move an unassigned record to another branch", async () => {
      const res = mockRes();
      await expect(
        assertCanAssign(req("Office", 7, 5, { canWriteBranchIds: [2, 9] }), res, { toBranchId: 9 }),
      ).resolves.toBe(true);
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    // isWide counts an admin as wide whatever the reach says — an admin's scope
    // is Company on every module anyway (access.scopeFor), so the two agree.
    it("treats an admin as wide even if the reach field says Own", async () => {
      const res = mockRes();
      await expect(
        assertCanAssign(req("Own", 7, 5, { isAdmin: true }), res, {}),
      ).resolves.toBe(true);
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    // Fix round 1: a wide reach used to move a record to ANY office. The
    // destination must be one the caller may write; admin is exempt.
    it("lets an Office-reach caller move to an office it may write", async () => {
      const res = mockRes();
      await expect(
        assertCanAssign(req("Office", 7, 5, { canWriteBranchIds: [2, 4] }), res, { toBranchId: 4 }),
      ).resolves.toBe(true);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("403s an Office-reach caller moving to an office outside its writable list, before any DB call", async () => {
      const res = mockRes();
      await expect(
        assertCanAssign(req("Office", 7, 5, { branchIds: [2, 4], canWriteBranchIds: [2] }), res, { toUserId: 3, toBranchId: 4 }),
      ).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "You cannot move records to that office" }),
      );
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    it("lets an admin move to any office", async () => {
      const res = mockRes();
      await expect(
        assertCanAssign(req("Company", 7, 5, { isAdmin: true, canWriteBranchIds: [2] }), res, { toBranchId: 77 }),
      ).resolves.toBe(true);
    });

    it("403s NO_SCOPE when req.scope is missing, before any DB call", async () => {
      const res = mockRes();
      await expect(assertCanAssign({ user: { UserId: 7, CompId: 5 } }, res, { toUserId: 3 })).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NO_SCOPE" }));
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    });

    it("allows a target the caller's assignable-users list includes (in scope)", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 3 }, { Id: 9 }]],
      });
      const res = mockRes();
      await expect(
        assertCanAssign(req("Team", 7, 5), res, { toUserId: 3 }),
      ).resolves.toBe(true);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchAssignableUsers", {
        UserId: 7, CompId: 5, BranchId: null, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: null,
      });
      expect(res.status).not.toHaveBeenCalled();
    });

    it("refuses a target outside the caller's assignable-users list (out of scope)", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 11 }]],
      });
      const res = mockRes();
      await expect(
        assertCanAssign(req("Team", 7, 5), res, { toUserId: 3 }),
      ).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "You cannot assign records to that user" }),
      );
    });

    // Not a distinct code branch — assertCanAssign has no self-assignment
    // special case. Included because it was asked for: it exercises the same
    // success path, with the caller's own id in the assignable-users rows.
    it("allows the caller to assign to themself when the list includes their own id", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 7 }]],
      });
      const res = mockRes();
      await expect(
        assertCanAssign(req("Team", 7, 5), res, { toUserId: 7 }),
      ).resolves.toBe(true);
    });

    it("lets a wide-scope caller reassign AND move branch in one call, passing BranchId through", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 12 }]],
      });
      const res = mockRes();
      await expect(
        assertCanAssign(req("OfficeTree", 7, 5, { canWriteBranchIds: [9] }), res, { toUserId: 12, toBranchId: 9 }),
      ).resolves.toBe(true);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchAssignableUsers", {
        UserId: 7, CompId: 5, BranchId: 9, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: null,
      });
    });

    it("falls back to the singular `recordset` field when the driver returns that shape", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordset: [{ Id: 3 }],
      });
      const res = mockRes();
      await expect(
        assertCanAssign(req("Team", 7, 5), res, { toUserId: 3 }),
      ).resolves.toBe(true);
    });

    it("refuses when the SP result carries no rows at all", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({});
      const res = mockRes();
      await expect(
        assertCanAssign(req("Team", 7, 5), res, { toUserId: 3 }),
      ).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("fails closed (500) and logs when the assignable-users lookup throws", async () => {
      database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const res = mockRes();
      await expect(
        assertCanAssign(req("Team", 7, 5), res, { toUserId: 3 }),
      ).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Failed to verify assignment target", code: "SERVER_ERROR" }),
      );
      consoleSpy.mockRestore();
    });
  });

  // Spec 2 §3 Rules — Reopen: a manager's act. Wide scopes always; a Team
  // lead only for a ticket assigned to someone in their subtree — never their
  // own, never an unassigned one. Own-reach agents never. Pure: the controller
  // already fetched the ticket through assertRecordAccess.
  describe("canReopen", () => {
    const req = (reach, ownerIds, UserId = 16) => ({
      user: { UserId, CompId: 1 },
      scope: { reach, branchIds: [1], ownerIds },
    });
    const ticket = (AssignedTo) => ({ Id: 1, BranchId: 1, AssignedTo, CreatedBy: 16 });

    it.each(["Company", "OfficeTree", "Office"])(
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
      expect(canReopen(req("Own", [17], 17), ticket(17))).toBe(false);
      expect(canReopen(req("Own", [17], 17), { ...ticket(18), CreatedBy: 17 })).toBe(false);
    });

    it("lets an admin reopen whatever the reach field says", () => {
      expect(canReopen({ user: { UserId: 16 }, scope: { reach: "Own", isAdmin: true } }, ticket(99))).toBe(true);
    });

    it("coerces ids (the driver hands BIGINTs back as strings) and fails closed on a missing scope or record", () => {
      expect(canReopen(req("Team", [17]), ticket("17"))).toBe(true);
      expect(canReopen({ user: { UserId: 16 } }, ticket(17))).toBe(false);
      expect(canReopen(req("Team", [17]), null)).toBe(false);
    });
  });
});
