# Sales Foundation + Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the reporting hierarchy and the flat, Zoho-shaped lead model (status dropdown, follow-ups as activities, transfers with mandatory reason) into the backend and web, on top of the already-applied `071_sales_foundation.sql`.

**Architecture:** The DB is done (`071` applied 2026-09-08). Backend controllers are thin adapters over the SPs: they inject tenant/user ids, apply `req.scope` rules, and map recordsets. Web pages call the endpoints through `salesQueries.js`; every lead-facing screen is rebuilt around `StatusId` + labels the SPs now return, so no page resolves names client-side any more.

**Tech Stack:** Node 22 + Express 5 + mssql (backend, Jest); React 19 + Vite + MUI 9 + TanStack Query 5 + RHF/Zod + material-react-table (web, Vitest + RTL + MSW).

**Spec:** `docs/superpowers/specs/2026-09-08-sales-foundation-hierarchy-design.md`

## Global Constraints

- **pnpm only.** Never npm.
- **Git is read-only for the implementer.** Every task ends with "stop and report" — the user commits. Never `git add`/`commit`/`push`.
- **SQL is never applied by the implementer.** `071` is applied. The one new script here (`072`) is written to `backend/sql/` and the user runs it.
- **Test-first, ≥ 80 % line/branch on every touched file** in `backend/src/` and `web/src/`. Global floor 60 %. Never `.only`/`.skip`.
- **Mobile is out of scope.** Nothing under `mobile/` changes.
- **MUI v9**: `slotProps`, never `InputProps`/`inputProps`. Use `components/ui/*` primitives.
- **Every route is `POST`-per-action** under the existing routers; every SP call carries `CompId` from `req.user`, never from the body.
- **Visibility rule is unchanged:** in scope **or** owner **or** creator. `assertRecordAccess(req, res, "lead", id)` gates every lead write.
- **Rules from the spec §2 apply verbatim:** transfer target must be in `sp_FetchAssignableUsers(caller)`; cross-branch and unassign need `DataScope ∈ {Branch, MultiBranch, Company, All}`; products write = `requireMinLevel(2)`; `ReportsTo` = `requireAdmin`.
- **Deploy order:** backend before web. Both user-run (commands in Task 19).

---

## File structure

**Backend — create**
| File | Responsibility |
|---|---|
| `backend/sql/072_menu_pipeline_row.sql` | Remove the Pipeline sidebar row; rename the funnel report row |
| `backend/src/controllers/productController.js` | `save` / `fetch` / `delete` over `sp_SaveProduct` / `sp_FetchProducts` / `sp_DeleteProduct` |
| `backend/src/routes/productRoutes.js` | `/api/products/*`, writes gated `requireMinLevel(2)` |
| `backend/tests/unit/controllers/productController.test.js` | |
| `backend/tests/unit/middleware/assertCanAssign.test.js` | |
| `backend/tests/unit/controllers/followupController.test.js` | rewritten from scratch (old one tests dropped SPs) |

**Backend — modify**
| File | Change |
|---|---|
| `backend/src/middleware/permission.js` | `+assertCanAssign(req, res, {toUserId, toBranchId})` |
| `backend/src/config/routes.js` | register `productRoutes` |
| `backend/src/controllers/userController.js` | `save` threads `ReportsTo`; `+assignableUsers` |
| `backend/src/routes/userRoutes.js` | `+/fetchAssignableUsers` |
| `backend/src/controllers/leadController.js` | `save` (new fields), `fetch` (new filters), `detail` (5 recordsets), `setStatus` replaces `moveStage`, `transfer` (new contract), `+bulkTransfer` |
| `backend/src/routes/leadRoutes.js` | `−moveLeadStage`, `+setLeadStatus`, `+bulkTransferLeads` |
| `backend/src/controllers/followupController.js` | rewritten: `schedule` / `complete` / `skip` / `fetch` / `delete` |
| `backend/src/routes/followupRoutes.js` | new action set |
| `backend/src/controllers/configController.js` | `saveLookup` sends an explicit param list incl. `Code` |
| `backend/src/controllers/reportController.js` | `pipelineFunnel` → `leadsByStatus`; `callsPerUser` + `conversionBySource` pass scope |
| `backend/src/routes/reportRoutes.js` | `−pipelineFunnel`, `+leadsByStatus` |
| `backend/tests/unit/controllers/{lead,user,config,report}Controller.test.js` | updated |

**Web — create**
| File | Responsibility |
|---|---|
| `web/src/hooks/useAssignableUsers.jsx` | `fetchAssignableUsers` query, optional `BranchId` |
| `web/src/pages/Sales/LogFollowUpModal.jsx` (+test) | complete a follow-up: outcome, remarks (required), next date |
| `web/src/pages/Sales/leadStatus.js` (+test) | status helpers: `isActiveCode`, `LEAD_PRESETS`, `presetParams`, `FOLLOWUP_TYPES` |
| `web/src/pages/Settings/Products.jsx` (stub in Task 9, real in Task 16) | |
| `web/src/pages/Reports/LeadsByStatus.jsx` (stub in Task 9, real in Task 18) | |
| `web/src/pages/Settings/Products.jsx` (+test) | products CRUD |
| `web/src/pages/Reports/LeadsByStatus.jsx` (+test) | renamed from `PipelineFunnel` |

**Web — modify**
| File | Change |
|---|---|
| `web/src/api/salesQueries.js` | endpoints: `−moveLeadStage, logCall, fetchCalls, saveFollowup, pipelineFunnel`; `+setLeadStatus, bulkTransferLeads, scheduleFollowUp, completeFollowUp, skipFollowUp, leadsByStatus, products.*, users.fetchAssignableUsers` |
| `web/src/App.jsx` | `/sales/pipeline` → redirect; `+/settings/products`; `/reports/pipeline-funnel` → `/reports/leads-by-status` (+ old path redirect); section fallbacks |
| `web/src/pages/Sales/TransferLeadModal.jsx` (+test) | person / branch / reason / remarks; `leadIds[]` — one lead or bulk |
| `web/src/pages/Sales/LeadCreateModal.jsx` (+test) | new fields; no pipeline/stage; owner only on create |
| `web/src/pages/Sales/Leads.jsx` (+test) | presets, filters, label columns, bulk reassign |
| `web/src/pages/Sales/LeadDetail.jsx` (+test) | status dropdown, follow-ups + history from the detail call |
| `web/src/pages/Sales/FollowUps.jsx` (+test) | Today / Overdue / Upcoming; complete + skip in place |
| `web/src/pages/Settings/Lookups.jsx` | `+lead_status, product_category, transfer_reason` |
| `web/src/pages/Settings/LookupMaster.jsx` (+test) | `Code` select for `lead_status` |
| `web/src/pages/Settings/Pipelines.jsx` (+test) | tickets only |
| `web/src/pages/Master/components/UserForm.jsx` (+test) | `Reports To` select |
| `web/src/pages/Reports/ConversionBySource.jsx` (+test) | Qualified column |
| `web/src/data/helpGuides.js` | drop pipeline / Log Call lines |

**Web — delete**
`pages/Sales/Pipeline.jsx`, `PipelineCard.jsx`, `PipelineColumn.jsx`, `Pipeline.test.jsx`, `LogCallModal.jsx`, `LogCallModal.test.jsx`, `pages/Reports/PipelineFunnel.jsx`, `PipelineFunnel.test.jsx`. (`ui/BoardColumn` + `hooks/useStageBoard` stay — `TicketBoard` uses them until spec 2.)

---

### Task 1: Sidebar rows — `072_menu_pipeline_row.sql`

**Files:**
- Create: `backend/sql/072_menu_pipeline_row.sql`

**Interfaces:**
- Produces: menu row 15 gone; row 20 = `Leads by Status` at `/reports/leads-by-status`. Web Task 9 relies on that route.

- [ ] **Step 1: Write the script**

```sql
-- ============================================================================
-- 072_menu_pipeline_row.sql
--
-- The sidebar is DB-driven (tblMenu). 071 removed the lead pipeline; the
-- 'Pipeline' row (Id 15, /sales/pipeline) would still render and land on a
-- redirect. The 'Pipeline Funnel' report row (Id 20) becomes Leads by Status.
-- Menu rights load at LOGIN — users re-login to see the change.
--
-- APPLY BY HAND. Idempotent. Author: Claude  Date: 2026-09-08
-- ============================================================================
DELETE FROM dbo.tblGroupAccess WHERE MenuId = 15;
DELETE FROM dbo.tblMenu WHERE Id = 15 AND Route = '/sales/pipeline';

UPDATE dbo.tblMenu
SET Description = 'Leads by Status', Route = '/reports/leads-by-status'
WHERE Id = 20 AND Route = '/reports/pipeline-funnel';

-- verify: 15 absent; 20 renamed; Sales children = Leads (16) + Follow-ups (33)
SELECT Id, ParentId, Description, Route FROM dbo.tblMenu
WHERE Id IN (14, 15, 16, 20, 33) ORDER BY Id;
GO

-- ---------------------------------------------------------------------------
-- sp_FetchFollowUpLead — one row: the follow-up plus its lead's visibility
-- columns. The complete / skip / delete endpoints need to know WHOSE lead a
-- follow-up belongs to before they touch it; sp_FetchFollowUps has no @Id mode
-- and the mutating SPs are CompId-scoped only. This is the cheapest gate: one
-- read, then canSeeRecord in Node against BranchId / OwnerId / CreatedBy.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchFollowUpLead
    @CompId INT,
    @Id     INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.Id, f.LeadId, f.Status, f.AssignedTo,
           l.BranchId, l.OwnerId, l.CreatedBy
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    WHERE f.Id = @Id AND f.CompId = @CompId;
END
GO

-- ---------------------------------------------------------------------------
-- sp_FetchBranches — the branch pick-list for cross-branch transfers. Nothing
-- served it before (tblBranch has no CompId; one company today).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchBranches
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, BranchName FROM dbo.tblBranch ORDER BY BranchName;
END
GO
SELECT name FROM sys.procedures WHERE name IN ('sp_FetchFollowUpLead','sp_FetchBranches');   -- expect 2 rows
```

- [ ] **Step 2: Stop and report** — hand the path to the user; they apply it and re-login. Do not continue past web Task 9 until it is applied.

---

### Task 2: `assertCanAssign` — the transfer target guard

**Files:**
- Modify: `backend/src/middleware/permission.js` (append before `module.exports`)
- Create: `backend/tests/unit/middleware/assertCanAssign.test.js`

**Interfaces:**
- Consumes: `sp_FetchAssignableUsers(UserId, CompId, BranchId)` → recordset `[{Id, FullName, ...}]`
- Produces: `async assertCanAssign(req, res, { toUserId, toBranchId }) → boolean`. Sends its own 403/500 and returns `false`; `true` = proceed. Used by Task 5.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/unit/middleware/assertCanAssign.test.js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/middleware/assertCanAssign.test.js`
Expected: FAIL — `assertCanAssign is not a function`

- [ ] **Step 3: Implement**

Append to `backend/src/middleware/permission.js` immediately above `module.exports`:

```js
// Transfer target guard.
//
// Three rules from the spec, in order of cheapness:
//   1. Unassigning (no target) and moving to another branch are manager acts:
//      DataScope Branch / MultiBranch / Company / All. Team and Self cannot.
//   2. A target must be someone sp_FetchAssignableUsers lists for the caller —
//      their subtree + their manager for Team/Self, their readable branches for
//      the wide scopes, or the destination branch's roster when @BranchId is
//      supplied. The dropdown on the client is a convenience; this is the gate.
//
// Sends its own 403 (or 500 on lookup failure) and returns false; true = proceed.
const WIDE_SCOPES = new Set(["All", "Company", "MultiBranch", "Branch"]);

async function assertCanAssign(req, res, { toUserId, toBranchId }) {
  const target = Number(toUserId) || null;
  const branch = Number(toBranchId) || null;
  const wide = WIDE_SCOPES.has(req.scope?.dataScope);

  if (!target && !wide) {
    responseHelper.error(res, "Only a manager can leave a lead unassigned", "FORBIDDEN", 403);
    return false;
  }
  if (branch && !wide) {
    responseHelper.error(
      res,
      "Only a branch manager or above can move a lead to another branch",
      "FORBIDDEN",
      403,
    );
    return false;
  }
  if (!target) return true;

  try {
    const result = await database.executeStoredProcedure("sp_FetchAssignableUsers", {
      UserId: req.user.UserId,
      CompId: req.user.CompId,
      BranchId: branch,
    });
    const rows = result.recordsets?.[0] ?? result.recordset ?? [];
    if (rows.some((r) => Number(r.Id) === target)) return true;
    responseHelper.error(res, "You cannot assign leads to that user", "FORBIDDEN", 403);
    return false;
  } catch (err) {
    console.error("assertCanAssign failed:", err.message);
    responseHelper.error(res, "Failed to verify assignment target");
    return false;
  }
}
```

Add `assertCanAssign,` to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && pnpm exec jest tests/unit/middleware/assertCanAssign.test.js --coverage --collectCoverageFrom='src/middleware/permission.js'`
Expected: 7 passed; `permission.js` still ≥ 80 % (the file already has a suite — run `pnpm exec jest tests/unit/middleware` to confirm nothing else regressed).

- [ ] **Step 5: Stop and report** — files changed + test output. The user commits.

---

### Task 3: Products — controller, routes, registration

**Files:**
- Create: `backend/src/controllers/productController.js`
- Create: `backend/src/routes/productRoutes.js`
- Modify: `backend/src/config/routes.js` (require + `app.use("/api/products", productRoutes)`)
- Create: `backend/tests/unit/controllers/productController.test.js`

**Interfaces:**
- Consumes: `sp_SaveProduct(Id, CompId, UserId, Name, Code, CategoryId, UnitPrice, MarginPct, IsActive)` → `{Id, ResponseCode, ResponseMess}`; `sp_FetchProducts(CompId, PageNumber, PageSize, SearchTerm, CategoryId, IsActive)` → RS1 rows, RS2 pagination; `sp_DeleteProduct(Id, CompId)`.
- Produces: `POST /api/products/saveProduct | fetchProducts | deleteProduct`. `fetchProducts` → `data: { products: [...], pagination: {currentPage, pageSize, totalRecords, totalPages} }`. Web Task 16 relies on that shape.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/unit/controllers/productController.test.js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/controllers/productController.test.js`
Expected: FAIL — cannot find module `productController`

- [ ] **Step 3: Implement the controller**

```js
// backend/src/controllers/productController.js
const database = require("../config/database");
const { success, error, validationError } = require("../utils/responseHelper");
const {
  asyncRoute,
  firstRow,
  spStatus,
  spOk,
  spMessage,
  pageParams,
  positiveInt,
} = require("../utils/controllerKit");

// Numeric form fields arrive as strings from the web; the SP wants decimals.
const num = (v) => (v === "" || v == null ? null : Number(v));

class ProductController {
  save = asyncRoute(
    async (req, res) => {
      const { Id = 0, Name, Code = null, CategoryId = null, UnitPrice = null, MarginPct = null, IsActive = true } = req.body;
      const result = await database.executeStoredProcedure("sp_SaveProduct", {
        Id: positiveInt(Id) ?? 0,
        CompId: req.user.CompId,
        UserId: req.user.UserId,
        Name,
        Code: Code || null,
        CategoryId: positiveInt(CategoryId),
        UnitPrice: num(UnitPrice),
        MarginPct: num(MarginPct),
        IsActive: Boolean(IsActive),
      });
      const row = firstRow(result);
      if (!spOk(row)) return error(res, spMessage(row, "Failed to save product"), "SP_ERROR", spStatus(row));
      return success(res, spMessage(row), row);
    },
    "Failed to save product",
    "PRODUCT_SAVE_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const { SearchTerm = null, CategoryId = null, IsActive = true } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);
      const result = await database.executeStoredProcedure("sp_FetchProducts", {
        CompId: req.user.CompId,
        PageNumber,
        PageSize,
        SearchTerm,
        CategoryId: positiveInt(CategoryId),
        // null = every product, active or not (the admin list); default = pick-lists.
        IsActive: IsActive === null ? null : Boolean(IsActive),
      });
      const products = result.recordsets?.[0] ?? [];
      const p = result.recordsets?.[1]?.[0] ?? {};
      return success(res, "Products fetched successfully", {
        products,
        pagination: {
          currentPage: p.CurrentPage ?? PageNumber,
          pageSize: p.PageSize ?? PageSize,
          totalRecords: p.TotalRecords ?? products.length,
          totalPages: p.TotalPages ?? 1,
        },
      });
    },
    "Failed to fetch products",
    "PRODUCT_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      const Id = positiveInt(req.body.Id);
      if (!Id) return validationError(res, "Product ID is required");
      const result = await database.executeStoredProcedure("sp_DeleteProduct", { Id, CompId: req.user.CompId });
      const row = firstRow(result);
      if (!spOk(row)) return error(res, spMessage(row, "Failed to delete product"), "SP_ERROR", spStatus(row));
      return success(res, spMessage(row));
    },
    "Failed to delete product",
    "PRODUCT_DELETE_ERROR",
  );
}

module.exports = new ProductController();
```

- [ ] **Step 4: Routes + registration**

```js
// backend/src/routes/productRoutes.js
const express = require("express");
const productController = require("../controllers/productController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireMinLevel, HIERARCHY } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();
router.use(verifyToken, loadScope);

// The master is company config: Owner, Admin and the department heads
// (HierarchyLevel <= 2) maintain it; everyone reads it for pick-lists.
router.post("/saveProduct", requireMinLevel(HIERARCHY.ADMIN), requirePayload, productController.save);
router.post("/fetchProducts", allowEmptyPayload, productController.fetch);
router.post("/deleteProduct", requireMinLevel(HIERARCHY.ADMIN), requirePayload, productController.delete);

module.exports = router;
```

In `backend/src/config/routes.js`: add `const productRoutes = require("../routes/productRoutes");` after `configRoutes`, and `app.use("/api/products", productRoutes);` after the `/api/config` line.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && pnpm exec jest tests/unit/controllers/productController.test.js --coverage --collectCoverageFrom='src/controllers/productController.js'`
Expected: 8 passed; ≥ 80 %.

- [ ] **Step 6: Stop and report.**

---

### Task 4: Users — `ReportsTo` on save, `fetchAssignableUsers`

**Files:**
- Modify: `backend/src/controllers/userController.js` (`save` destructuring + SP params; new `assignableUsers` method after `directory`)
- Modify: `backend/src/routes/userRoutes.js`
- Modify: `backend/tests/unit/controllers/userController.test.js` (append two describes)

**Interfaces:**
- Consumes: `sp_SaveUser(... , Mobile, ReportsTo)`; `sp_FetchAssignableUsers(UserId, CompId, BranchId)` → `[{Id, FullName, Avatar, JobTitle, BranchId, BranchName, ReportsTo, ResponseCode, ResponseMess}]`
- Produces: `POST /api/users/saveUser` accepts `ReportsTo` (int|null); `POST /api/users/fetchAssignableUsers` body `{ BranchId? }` → `data: { users: [...] }` (envelope columns stripped). Web Task 10 relies on it.

- [ ] **Step 1: Write the failing tests** — append to `userController.test.js`:

```js
describe("userController.save threads ReportsTo", () => {
  it("passes ReportsTo through, null when absent", async () => {
    database.executeStoredProcedure.mockResolvedValue(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", UserId: 9 }]),
    );
    await userController.save(
      baseReq({ body: { Username: "bob", Password: "h", FullName: "Bob", ReportsTo: 4 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ ReportsTo: 4 });

    await userController.save(
      baseReq({ body: { Username: "cat", Password: "h", FullName: "Cat" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ ReportsTo: null });
  });

  it("surfaces the SP's loop refusal as a 400", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 400, ResponseMess: "Reporting line would loop back to this user" }]),
    );
    const res = mockRes();
    await userController.save(
      baseReq({ body: { Id: 4, Username: "bob", FullName: "Bob", ReportsTo: 9 } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/loop/);
  });
});

describe("userController.assignableUsers", () => {
  it("calls the roster SP for the caller and strips the envelope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ Id: 3, FullName: "Ravi", BranchId: 2, ResponseCode: 200, ResponseMess: "ok" }]),
    );
    const res = mockRes();
    await userController.assignableUsers(baseReq({ body: {} }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchAssignableUsers", {
      UserId: 7, CompId: 1, BranchId: null,
    });
    expect(res.json.mock.calls[0][0].data.users).toEqual([{ Id: 3, FullName: "Ravi", BranchId: 2 }]);
  });

  it("forwards a destination BranchId for cross-branch pickers", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    await userController.assignableUsers(baseReq({ body: { BranchId: "4" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].BranchId).toBe(4);
  });
});

describe("userController.branches", () => {
  it("returns the branch list", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ Id: 1, BranchName: "Pune" }, { Id: 2, BranchName: "Nashik" }]),
    );
    const res = mockRes();
    await userController.branches(baseReq(), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchBranches", {});
    expect(res.json.mock.calls[0][0].data.branches).toEqual([
      { Id: 1, BranchName: "Pune" }, { Id: 2, BranchName: "Nashik" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/controllers/userController.test.js`
Expected: FAIL — `ReportsTo` missing from the SP call; `assignableUsers is not a function`

- [ ] **Step 3: Implement**

In `save`: add `ReportsTo = null,` to the `req.body` destructuring (after `Mobile = null,`) and `ReportsTo: positiveInt(ReportsTo),` to the `sp_SaveUser` params (after `Mobile,`).

After the `directory` method, add:

```js
  // Who the caller may hand a lead to. Body { BranchId } lists a destination
  // branch's roster for cross-branch transfers; the RIGHT to do that is checked
  // in assertCanAssign at transfer time, not here — this only lists.
  assignableUsers = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure("sp_FetchAssignableUsers", {
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: positiveInt(req.body?.BranchId),
      });
      const users = cleanSpRows(result.recordsets?.[0] ?? []);
      return success(res, "Assignable users retrieved", { users });
    },
    "Failed to fetch assignable users",
    "ASSIGNABLE_USERS_ERROR",
  );
```

Then, after `assignableUsers`:

```js
  // Branch pick-list for cross-branch transfers. Any authenticated user.
  branches = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure("sp_FetchBranches", {});
      return success(res, "Branches retrieved", { branches: result.recordsets?.[0] ?? [] });
    },
    "Failed to fetch branches",
    "BRANCHES_ERROR",
  );
```

In `userRoutes.js`, after `/directory`:

```js
// Transfer pick-lists — any authenticated user; the roster SP scopes itself.
router.post("/fetchAssignableUsers", allowEmptyPayload, userController.assignableUsers);
router.post("/fetchBranches", allowEmptyPayload, userController.branches);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && pnpm exec jest tests/unit/controllers/userController.test.js --coverage --collectCoverageFrom='src/controllers/userController.js'`
Expected: all pass; ≥ 80 %.

- [ ] **Step 5: Stop and report.**

---

### Task 5: Leads controller — new contract

**Files:**
- Modify: `backend/src/controllers/leadController.js` (full rewrite below)
- Modify: `backend/src/routes/leadRoutes.js`
- Modify: `backend/tests/unit/controllers/leadController.test.js` (replace the `save`, `fetch`, `detail` describes; replace `moveStage` with `setStatus`; rewrite `transfer`; add `bulkTransfer`)

**Interfaces:**
- Consumes: `assertCanAssign` (Task 2); SPs `sp_SaveLead`, `sp_FetchLeads`, `sp_FetchLeadDetail` (5 recordsets), `sp_SetLeadStatus`, `sp_TransferLead`, `sp_BulkTransferLeads`, `sp_DeleteLead` as in `071`.
- Produces:
  - `saveLeads` body: `Id, Name, Company, MobileNo, AltMobile, Email, Address, City, State, Pincode, SourceId, ProductId, StatusId, OwnerId, EstValue, Remarks, FirstFollowupAt, CustomJSON`. On edit `OwnerId`/`StatusId`/`FirstFollowupAt` are dropped.
  - `fetchLeads` body: `BranchId, PageNumber, PageSize, SearchTerm, StatusId, StatusCode, ProductId, OwnerId, SourceId, Overdue, Unassigned` → `{ leads, pagination }`.
  - `fetchLeadDetail` → `{ lead, fields, activity, followups, assignments }`.
  - `setLeadStatus` body `{ LeadId, StatusId, LostReasonId? }`.
  - `transferLead` body `{ LeadId, ToUserId?, ToBranchId?, ReasonId, Remarks }`.
  - `bulkTransferLeads` body `{ LeadIds: number[], ToUserId?, ToBranchId?, ReasonId, Remarks }` → `{ Transferred, Skipped }`.

- [ ] **Step 1: Write the failing tests** — replace the existing `save`, `detail` and `moveStage`/`transfer` describes with these (keep `fetch`'s scope tests; extend as shown):

```js
const EDIT_BODY = {
  Id: 9, Name: "Acme", Company: "Acme Ltd", MobileNo: "9", City: "Pune", Pincode: "411001",
  ProductId: 2, StatusId: 5, OwnerId: 3, EstValue: 50000, Remarks: "hot", FirstFollowupAt: "2026-09-10",
};

describe("leadController.save", () => {
  it("creates with the new fields, creator's branch, and no stage/pipeline", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 42 }],
    });
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0 } }), res);
    const [sp, params] = database.executeStoredProcedure.mock.calls[0];
    expect(sp).toBe("sp_SaveLead");
    expect(params).toMatchObject({
      Id: 0, CompId: 5, BranchId: 2, UserId: 7, Company: "Acme Ltd", City: "Pune",
      Pincode: "411001", ProductId: 2, StatusId: 5, OwnerId: 3, Remarks: "hot",
      FirstFollowupAt: "2026-09-10",
    });
    expect(params).not.toHaveProperty("PipelineId");
    expect(params).not.toHaveProperty("StageId");
    expect(res.json.mock.calls[0][0].data.Id).toBe(42);
  });

  // Ownership only moves through transfer (history) and status through
  // setStatus (guards). An edit must not be a side door for either.
  it("on edit, gates on the lead and drops OwnerId / StatusId / FirstFollowupAt", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 9 }],
    });
    await leadController.save(baseReq({ body: EDIT_BODY }), mockRes());
    const params = database.executeStoredProcedure.mock.calls[1][1];
    expect(params).toMatchObject({ Id: 9, OwnerId: null, StatusId: null, FirstFollowupAt: null, Company: "Acme Ltd" });
  });

  it("403s an edit of a lead the caller cannot see", async () => {
    mockLeadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await leadController.save(baseReq({ body: EDIT_BODY }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("returns the SP's validation status", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Name is required" }],
    });
    const res = mockRes();
    await leadController.save(baseReq({ body: { Id: 0 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("leadController.fetch filters", () => {
  it("forwards the new filters with booleans coerced", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await leadController.fetch(
      baseReq({ body: { StatusId: 5, StatusCode: "open", ProductId: 2, Overdue: 1, Unassigned: "true" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({ StatusId: 5, StatusCode: "open", ProductId: 2, Overdue: true, Unassigned: true }),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).not.toHaveProperty("StageId");
  });
});

describe("leadController.detail", () => {
  it("maps the 5 recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 9, Name: "Acme", BranchId: 2, OwnerId: 3, CreatedBy: 3, StatusCode: "open" }],
        [{ FieldId: 1 }],
        [{ Id: 11, Type: "created" }],
        [{ Id: 21, Status: "open" }],
        [{ Id: 31, ToUserId: 3 }],
      ],
    });
    const res = mockRes();
    await leadController.detail(baseReq({ body: { LeadId: 9 } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.lead.Id).toBe(9);
    expect(data.fields).toEqual([{ FieldId: 1 }]);
    expect(data.activity).toEqual([{ Id: 11, Type: "created" }]);
    expect(data.followups).toEqual([{ Id: 21, Status: "open" }]);
    expect(data.assignments).toEqual([{ Id: 31, ToUserId: 3 }]);
  });

  it("404s a lead owned by someone else when Self-scoped", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 }], [], [], [], []],
    });
    const res = mockRes();
    await leadController.detail(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("leadController.setStatus", () => {
  it("gates on the lead then calls sp_SetLeadStatus", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 9, ResponseCode: 200, ResponseMess: "Lead status updated successfully" }],
    });
    const res = mockRes();
    await leadController.setStatus(baseReq({ body: { LeadId: 9, StatusId: 6, LostReasonId: 2 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SetLeadStatus", {
      CompId: 5, LeadId: 9, StatusId: 6, LostReasonId: 2, UserId: 7,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("passes the SP's 'Lost reason required' 400 through", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 9, ResponseCode: 400, ResponseMess: "Lost reason required" }],
    });
    const res = mockRes();
    await leadController.setStatus(baseReq({ body: { LeadId: 9, StatusId: 6 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("leadController.transfer", () => {
  const body = { LeadId: 9, ToUserId: 3, ReasonId: 1, Remarks: "Absent" };

  it("gates on the lead, then the target, then transfers", async () => {
    mockLeadLookup(visibleLead);                                        // sp_FetchLeadDetail
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3 }]] }); // roster
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 9, ResponseCode: 200, ResponseMess: "Lead transferred successfully" }],
    });
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_TransferLead", {
      CompId: 5, LeadId: 9, ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "Absent", UserId: 7,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s when the target is not assignable and never calls the SP", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 4 }]] });
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
  });

  it("400s without remarks before touching the DB", async () => {
    const res = mockRes();
    await leadController.transfer(baseReq({ body: { ...body, Remarks: "  " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

describe("leadController.bulkTransfer", () => {
  const body = { LeadIds: [9, 10], ToUserId: 3, ReasonId: 1, Remarks: "Back on duty" };

  it("checks every lead, the target once, then calls the bulk SP with JSON ids", async () => {
    mockLeadLookup(visibleLead);
    mockLeadLookup({ ...visibleLead, Id: 10 });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3 }]] });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Transferred: 2, Skipped: 0, ResponseCode: 200, ResponseMess: "2 lead(s) transferred" }],
    });
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_BulkTransferLeads", {
      CompId: 5, LeadIdsJson: "[9,10]", ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "Back on duty", UserId: 7,
    });
    expect(res.json.mock.calls[0][0].data).toMatchObject({ Transferred: 2, Skipped: 0 });
  });

  it("400s on an empty id list", async () => {
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body: { ...body, LeadIds: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("403s if any lead is out of scope", async () => {
    mockLeadLookup(visibleLead);
    mockLeadLookup({ Id: 10, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
```

Delete the old `moveStage` describe entirely.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/controllers/leadController.test.js`
Expected: FAIL — `setStatus`/`bulkTransfer` not functions; save/transfer param mismatches.

- [ ] **Step 3: Rewrite the controller**

```js
// backend/src/controllers/leadController.js
const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const attachmentController = require("./attachmentController");
const {
  scopeParams,
  canSeeRecord,
  assertRecordAccess,
  assertCanAssign,
} = require("../middleware/permission");
const { positiveInt } = require("../utils/controllerKit");

// Mutating SPs log their own activity server-side and return exactly one
// status row: Id + ResponseCode + ResponseMess.
async function runSp(res, spName, params, failMessage) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;
    if (spResponse.ResponseCode === 200) return responseHelper.success(res, message, spResponse);
    return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, failMessage);
  }
}

// Exactly the columns sp_SaveLead accepts. Anything else in the body is dropped.
const LEAD_FIELDS = [
  "Name", "Company", "MobileNo", "AltMobile", "Email",
  "Address", "City", "State", "Pincode",
  "SourceId", "ProductId", "StatusId", "OwnerId", "EstValue", "Remarks",
  "FirstFollowupAt", "CustomJSON",
];
const pick = (body, keys) => Object.fromEntries(keys.map((k) => [k, body[k] ?? null]));
const bit = (v) => v === true || v === 1 || v === "1" || v === "true";
const blank = (s) => !s || !String(s).trim();

// Shared by transfer and bulkTransfer: the SP requires both, and refusing
// here saves the lookup round-trips.
const transferArgs = (body) => ({
  ToUserId: positiveInt(body.ToUserId),
  ToBranchId: positiveInt(body.ToBranchId),
  ReasonId: positiveInt(body.ReasonId),
  Remarks: body.Remarks == null ? null : String(body.Remarks).trim(),
});

const leadController = {
  async save(req, res) {
    const { CompId, BranchId, UserId } = req.user;
    const Id = positiveInt(req.body.Id) ?? 0;
    const fields = pick(req.body, LEAD_FIELDS);
    if (Id > 0) {
      if (!(await assertRecordAccess(req, res, "lead", Id))) return;
      // Ownership moves through transfer (history), status through setStatus
      // (guards). The SP ignores these on update; not sending them keeps that
      // fact visible here rather than buried in T-SQL.
      fields.OwnerId = null;
      fields.StatusId = null;
      fields.FirstFollowupAt = null;
    }
    return runSp(res, "sp_SaveLead", { Id, CompId, BranchId, UserId, ...fields }, "Failed to save lead");
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const {
        BranchId = null, PageNumber = 1, PageSize = 10, SearchTerm = null,
        StatusId = null, StatusCode = null, ProductId = null, OwnerId = null, SourceId = null,
        Overdue = false, Unassigned = false,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_FetchLeads", {
        CompId, BranchId, PageNumber, PageSize, SearchTerm,
        StatusId, StatusCode, ProductId, OwnerId, SourceId,
        Overdue: bit(Overdue), Unassigned: bit(Unassigned),
        ...scopeParams(req),
      });

      const leads = result.recordsets[0] || [];
      const pagination = (result.recordsets[1] && result.recordsets[1][0]) || {};
      return responseHelper.success(res, "Leads fetched successfully", {
        leads,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? leads.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchLeads error:", err);
      return responseHelper.error(res, "Failed to fetch leads");
    }
  },

  async detail(req, res) {
    try {
      const { CompId } = req.user;
      const { LeadId } = req.body;
      const result = await database.executeStoredProcedure("sp_FetchLeadDetail", { CompId, LeadId });
      const rs = result.recordsets ?? [];
      const lead = rs[0]?.[0] || null;
      // 404 rather than 403: a user who cannot see a lead should not learn it exists.
      if (!canSeeRecord(req, lead, "OwnerId")) {
        return responseHelper.error(res, "Lead not found", "NOT_FOUND", 404);
      }
      return responseHelper.success(res, "Lead detail fetched successfully", {
        lead,
        fields: rs[1] || [],
        activity: rs[2] || [],
        followups: rs[3] || [],
        assignments: rs[4] || [],
      });
    } catch (err) {
      console.error("sp_FetchLeadDetail error:", err);
      return responseHelper.error(res, "Failed to fetch lead detail");
    }
  },

  async setStatus(req, res) {
    const { CompId, UserId } = req.user;
    const { LeadId, StatusId, LostReasonId = null } = req.body;
    if (!(await assertRecordAccess(req, res, "lead", LeadId))) return;
    return runSp(
      res,
      "sp_SetLeadStatus",
      { CompId, LeadId, StatusId, LostReasonId, UserId },
      "Failed to update lead status",
    );
  },

  async transfer(req, res) {
    const { CompId, UserId } = req.user;
    const { LeadId } = req.body;
    const args = transferArgs(req.body);
    if (blank(args.Remarks) || !args.ReasonId) {
      return responseHelper.validationError(res, "A reason and remarks are required for a transfer");
    }
    if (!(await assertRecordAccess(req, res, "lead", LeadId))) return;
    if (!(await assertCanAssign(req, res, { toUserId: args.ToUserId, toBranchId: args.ToBranchId }))) return;
    return runSp(res, "sp_TransferLead", { CompId, LeadId, ...args, UserId }, "Failed to transfer lead");
  },

  async bulkTransfer(req, res) {
    const { CompId, UserId } = req.user;
    const ids = Array.isArray(req.body.LeadIds)
      ? [...new Set(req.body.LeadIds.map(positiveInt).filter(Boolean))]
      : [];
    const args = transferArgs(req.body);
    if (ids.length === 0 || ids.length > 200) {
      return responseHelper.validationError(res, "Pick between 1 and 200 leads");
    }
    if (blank(args.Remarks) || !args.ReasonId) {
      return responseHelper.validationError(res, "A reason and remarks are required for a transfer");
    }
    // Every lead must be visible to the caller; the SP is tenant-scoped only.
    for (const id of ids) {
      if (!(await assertRecordAccess(req, res, "lead", id))) return;
    }
    if (!(await assertCanAssign(req, res, { toUserId: args.ToUserId, toBranchId: args.ToBranchId }))) return;
    return runSp(
      res,
      "sp_BulkTransferLeads",
      { CompId, LeadIdsJson: JSON.stringify(ids), ...args, UserId },
      "Failed to transfer leads",
    );
  },

  async delete(req, res) {
    const { CompId } = req.user;
    const { Id } = req.body;
    if (!(await assertRecordAccess(req, res, "lead", Id))) return;
    try {
      const result = await database.executeStoredProcedure("sp_DeleteLead", { Id, CompId });
      const spResponse = result.recordset[0];
      const message = spResponse.ResponseMess || spResponse.ResponseMessage;
      if (spResponse.ResponseCode === 200) {
        await attachmentController.cascadeDelete(CompId, "lead", Id);
        return responseHelper.success(res, message, spResponse);
      }
      return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
    } catch (err) {
      console.error("sp_DeleteLead error:", err);
      return responseHelper.error(res, "Failed to delete lead");
    }
  },
};

module.exports = leadController;
```

`leadRoutes.js` — replace the route block:

```js
router.post("/saveLeads", requirePayload, leadController.save);
router.post("/fetchLeads", allowEmptyPayload, leadController.fetch);
router.post("/fetchLeadDetail", requirePayload, leadController.detail);
router.post("/setLeadStatus", requirePayload, leadController.setStatus);
router.post("/transferLead", requirePayload, leadController.transfer);
router.post("/bulkTransferLeads", requirePayload, leadController.bulkTransfer);
router.post("/deleteLeads", requirePayload, leadController.delete);
```

Note for the tests: `mockLeadLookup` must now return **five** recordsets — update the helper to `recordsets: [lead ? [lead] : [], [], [], [], []]`. The `bulkTransfer` "out of scope" test relies on `assertRecordAccess` sending the 403 on the second lead.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && pnpm exec jest tests/unit/controllers/leadController.test.js --coverage --collectCoverageFrom='src/controllers/leadController.js'`
Expected: all pass; ≥ 80 %. Then `pnpm exec jest tests/unit/routes` — the route suite (if it enumerates lead routes) must be updated for `setLeadStatus` / `bulkTransferLeads` and the removed `moveLeadStage`.

- [ ] **Step 5: Stop and report.**

---

### Task 6: Follow-ups controller — rewritten around the activity model

**Files:**
- Modify: `backend/src/controllers/followupController.js` (full rewrite)
- Modify: `backend/src/routes/followupRoutes.js`
- Create: `backend/tests/unit/controllers/followupController.test.js` (replace the existing file entirely)

**Interfaces:**
- Consumes: `sp_FetchFollowUpLead(CompId, Id)` (Task 1) → `{Id, LeadId, Status, AssignedTo, BranchId, OwnerId, CreatedBy}`; `sp_ScheduleFollowUp`, `sp_CompleteFollowUp`, `sp_SkipFollowUp`, `sp_FetchFollowUps`, `sp_DeleteFollowUp` from `071`.
- Produces:
  - `scheduleFollowUp` `{ LeadId, Type?, DueAt, AssignedTo? }` → `{ Id }`
  - `completeFollowUp` `{ Id, OutcomeId?, Remarks, Direction?, Duration?, NextType?, NextDueAt? }` → `{ Id, NextId }`
  - `skipFollowUp` `{ Id, Remarks }`
  - `fetchFollowups` `{ LeadId }` → `{ followups }` (no paging) **or** `{ AssignedTo?, Status?, DueFrom?, DueTo?, Overdue?, SearchTerm?, PageNumber?, PageSize? }` → `{ followups, pagination }`
  - `deleteFollowup` `{ Id }`

- [ ] **Step 1: Write the failing tests** (new file, replaces the old):

```js
// backend/tests/unit/controllers/followupController.test.js
jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const followupController = require("../../../src/controllers/followupController");
const { mockRes } = require("../../helpers/mockRes");

const baseReq = (overrides = {}) => ({
  user: { UserId: 7, CompId: 5, BranchId: 2 },
  scope: { dataScope: "Branch", branchIds: [2], ownerIds: null, isAdmin: false },
  body: {},
  ...overrides,
});
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 };
const leadLookup = (lead) =>
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [lead ? [lead] : [], [], [], [], []] });
const fuLookup = (row) =>
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [row ? [row] : []] });
const status = (row) => database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[row]] });

beforeEach(() => database.executeStoredProcedure.mockReset());

describe("schedule", () => {
  it("gates on the lead and forwards the row", async () => {
    leadLookup(visibleLead);
    status({ Id: 21, ResponseCode: 201, ResponseMess: "Follow-up scheduled" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, Type: "visit", DueAt: "2026-09-12" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ScheduleFollowUp", {
      CompId: 5, LeadId: 9, UserId: 7, Type: "visit", DueAt: "2026-09-12", AssignedTo: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.Id).toBe(21);
  });

  it("403s a lead outside scope", async () => {
    leadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, DueAt: "2026-09-12" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("complete", () => {
  const row = { Id: 21, LeadId: 9, Status: "open", AssignedTo: 7, BranchId: 2, OwnerId: 7, CreatedBy: 7 };

  it("400s without remarks before any lookup", async () => {
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: " " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("looks the follow-up up, checks its lead, then completes with the next date", async () => {
    fuLookup(row);
    status({ Id: 21, NextId: 22, ResponseCode: 200, ResponseMess: "Follow-up logged" });
    const res = mockRes();
    await followupController.complete(
      baseReq({ body: { Id: 21, OutcomeId: 3, Remarks: "Spoke", Direction: "out", Duration: 5, NextType: "visit", NextDueAt: "2026-09-14" } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(1, "sp_FetchFollowUpLead", { CompId: 5, Id: 21 });
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_CompleteFollowUp", {
      CompId: 5, Id: 21, UserId: 7, OutcomeId: 3, Remarks: "Spoke", Direction: "out", Duration: 5,
      NextType: "visit", NextDueAt: "2026-09-14",
    });
    expect(res.json.mock.calls[0][0].data).toEqual({ Id: 21, NextId: 22 });
  });

  // The follow-up is assigned to me though the lead is a colleague's: still mine to log.
  it("allows the assignee even when the lead is outside their owner scope", async () => {
    fuLookup({ ...row, OwnerId: 3, CreatedBy: 3, AssignedTo: 7 });
    status({ Id: 21, NextId: null, ResponseCode: 200, ResponseMess: "ok" });
    const res = mockRes();
    await followupController.complete(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("404s an unknown follow-up", async () => {
    fuLookup(null);
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("passes the SP's 409 (already done) through", async () => {
    fuLookup(row);
    status({ Id: 21, NextId: null, ResponseCode: 409, ResponseMess: "Follow-up is already done" });
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("skip", () => {
  it("requires remarks and forwards", async () => {
    fuLookup({ Id: 21, LeadId: 9, Status: "open", AssignedTo: 7, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    status({ Id: 21, ResponseCode: 200, ResponseMess: "Follow-up skipped" });
    await followupController.skip(baseReq({ body: { Id: 21, Remarks: "Customer travelling" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SkipFollowUp", {
      CompId: 5, Id: 21, UserId: 7, Remarks: "Customer travelling",
    });
  });
});

describe("fetch", () => {
  it("per-lead mode gates on the lead and returns rows without paging", async () => {
    leadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 21 }, { Id: 22 }]] });
    const res = mockRes();
    await followupController.fetch(baseReq({ body: { LeadId: 9 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith(
      "sp_FetchFollowUps",
      expect.objectContaining({ CompId: 5, LeadId: 9 }),
    );
    expect(res.json.mock.calls[0][0].data).toEqual({ followups: [{ Id: 21 }, { Id: 22 }] });
  });

  it("queue mode passes scope + filters and maps pagination", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 21 }], [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 25 }]],
    });
    const res = mockRes();
    await followupController.fetch(
      baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Overdue: true, AssignedTo: 7, DueTo: "2026-09-30" } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchFollowUps", expect.objectContaining({
      CompId: 5, LeadId: 0, Overdue: true, AssignedTo: 7, DueTo: "2026-09-30",
      UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]", PageNumber: 1, PageSize: 25,
    }));
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });
});

describe("delete", () => {
  it("resolves the lead, gates, then deletes", async () => {
    fuLookup({ Id: 21, LeadId: 9, Status: "open", AssignedTo: 7, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    status({ ResponseCode: 200, ResponseMess: "Follow-up deleted successfully" });
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_DeleteFollowUp", { Id: 21, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s when the lead is out of scope", async () => {
    fuLookup({ Id: 21, LeadId: 9, Status: "open", AssignedTo: 3, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/controllers/followupController.test.js`
Expected: FAIL — `schedule`/`complete`/`skip` not functions.

- [ ] **Step 3: Rewrite the controller**

```js
// backend/src/controllers/followupController.js
const database = require("../config/database");
const { success, error, validationError } = require("../utils/responseHelper");
const {
  asyncRoute, firstRow, spStatus, spOk, spMessage, pageParams, positiveInt,
} = require("../utils/controllerKit");
const { assertRecordAccess, canSeeRecord, scopeParams } = require("../middleware/permission");

const blank = (s) => !s || !String(s).trim();

// A follow-up is governed by its lead's visibility, plus one extra: the person
// it is ASSIGNED to may act on it even when the lead sits outside their owner
// scope (a manager scheduled it onto them). Resolved in one read via
// sp_FetchFollowUpLead; sends 404/403 itself and returns null on refusal.
async function loadVisibleFollowUp(req, res, id) {
  const Id = positiveInt(id);
  if (!Id) {
    validationError(res, "Follow-up Id is required");
    return null;
  }
  const result = await database.executeStoredProcedure("sp_FetchFollowUpLead", { CompId: req.user.CompId, Id });
  const row = firstRow(result);
  if (!row) {
    error(res, "Follow-up not found", "NOT_FOUND", 404);
    return null;
  }
  const mine = Number(row.AssignedTo) === Number(req.user.UserId);
  if (!mine && !canSeeRecord(req, row, "OwnerId")) {
    error(res, "You do not have access to this follow-up", "FORBIDDEN", 403);
    return null;
  }
  return row;
}

const reply = (res, row, okMessage, data) =>
  spOk(row)
    ? success(res, spMessage(row, okMessage), data(row), spStatus(row))
    : error(res, spMessage(row, "Request failed"), "SP_ERROR", spStatus(row));

class FollowupController {
  schedule = asyncRoute(
    async (req, res) => {
      const { LeadId, Type = "call", DueAt, AssignedTo = null } = req.body;
      if (!DueAt) return validationError(res, "Due date is required");
      if (!(await assertRecordAccess(req, res, "lead", LeadId))) return;
      const result = await database.executeStoredProcedure("sp_ScheduleFollowUp", {
        CompId: req.user.CompId, LeadId: positiveInt(LeadId), UserId: req.user.UserId,
        Type, DueAt, AssignedTo: positiveInt(AssignedTo),
      });
      return reply(res, firstRow(result), "Follow-up scheduled", (r) => ({ Id: r.Id }));
    },
    "Failed to schedule follow-up",
    "FOLLOWUP_SCHEDULE_ERROR",
  );

  complete = asyncRoute(
    async (req, res) => {
      const { Id, OutcomeId = null, Remarks, Direction = null, Duration = null, NextType = null, NextDueAt = null } = req.body;
      if (blank(Remarks)) return validationError(res, "Remarks are required");
      if (!(await loadVisibleFollowUp(req, res, Id))) return;
      const result = await database.executeStoredProcedure("sp_CompleteFollowUp", {
        CompId: req.user.CompId, Id: positiveInt(Id), UserId: req.user.UserId,
        OutcomeId: positiveInt(OutcomeId), Remarks: String(Remarks).trim(),
        Direction, Duration: positiveInt(Duration), NextType, NextDueAt,
      });
      return reply(res, firstRow(result), "Follow-up logged", (r) => ({ Id: r.Id, NextId: r.NextId ?? null }));
    },
    "Failed to log follow-up",
    "FOLLOWUP_COMPLETE_ERROR",
  );

  skip = asyncRoute(
    async (req, res) => {
      const { Id, Remarks } = req.body;
      if (blank(Remarks)) return validationError(res, "Remarks are required");
      if (!(await loadVisibleFollowUp(req, res, Id))) return;
      const result = await database.executeStoredProcedure("sp_SkipFollowUp", {
        CompId: req.user.CompId, Id: positiveInt(Id), UserId: req.user.UserId, Remarks: String(Remarks).trim(),
      });
      return reply(res, firstRow(result), "Follow-up skipped", (r) => ({ Id: r.Id }));
    },
    "Failed to skip follow-up",
    "FOLLOWUP_SKIP_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const LeadId = positiveInt(req.body.LeadId) ?? 0;
      const { AssignedTo = null, Status = null, DueFrom = null, DueTo = null, Overdue = false, SearchTerm = null } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      // Per-lead: the lead is the record being read; gate on it and return the
      // full list. Queue: the SP applies scope itself.
      if (LeadId && !(await assertRecordAccess(req, res, "lead", LeadId))) return;

      const result = await database.executeStoredProcedure("sp_FetchFollowUps", {
        CompId: req.user.CompId, LeadId,
        AssignedTo: positiveInt(AssignedTo), Status, DueFrom, DueTo,
        Overdue: Overdue === true || Overdue === 1 || Overdue === "true",
        SearchTerm, PageNumber, PageSize,
        ...scopeParams(req),
      });
      const followups = result.recordsets?.[0] ?? [];
      if (LeadId) return success(res, "Follow-ups fetched successfully", { followups });

      const p = result.recordsets?.[1]?.[0] ?? {};
      return success(res, "Follow-ups fetched successfully", {
        followups,
        pagination: {
          currentPage: p.CurrentPage ?? PageNumber,
          pageSize: p.PageSize ?? PageSize,
          totalRecords: p.TotalRecords ?? followups.length,
          totalPages: p.TotalPages ?? 1,
        },
      });
    },
    "Failed to fetch follow-ups",
    "FOLLOWUP_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      const { Id } = req.body;
      if (!(await loadVisibleFollowUp(req, res, Id))) return;
      const result = await database.executeStoredProcedure("sp_DeleteFollowUp", { Id: positiveInt(Id), CompId: req.user.CompId });
      return reply(res, firstRow(result), "Follow-up deleted", () => null);
    },
    "Failed to delete follow-up",
    "FOLLOWUP_DELETE_ERROR",
  );
}

module.exports = new FollowupController();
```

`followupRoutes.js`:

```js
router.post("/scheduleFollowUp", requirePayload, followupController.schedule);
router.post("/completeFollowUp", requirePayload, followupController.complete);
router.post("/skipFollowUp", requirePayload, followupController.skip);
router.post("/fetchFollowups", allowEmptyPayload, followupController.fetch);
router.post("/deleteFollowup", requirePayload, followupController.delete);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && pnpm exec jest tests/unit/controllers/followupController.test.js --coverage --collectCoverageFrom='src/controllers/followupController.js'`
Expected: 12 passed; ≥ 80 %.

- [ ] **Step 5: Stop and report.**

---

### Task 7: Config `Code` + reports

**Files:**
- Modify: `backend/src/controllers/configController.js` (`saveLookup`)
- Modify: `backend/src/controllers/reportController.js` (`pipelineFunnel` → `leadsByStatus`; `callsPerUser`, `conversionBySource` take `BranchId` from the body)
- Modify: `backend/src/routes/reportRoutes.js`
- Modify: `backend/tests/unit/controllers/configController.test.js`, `reportController.test.js`

**Interfaces:**
- Produces: `saveLookup` body `{ Id, Kind, Value, SortOrder, Code? }`; `POST /api/reports/leadsByStatus` `{ BranchId? }` → `{ statuses: [{StatusId, StatusName, StatusCode, SortOrder, LeadCount}] }`; `conversionBySource` rows now carry `QualifiedCount` + `LostCount`.

- [ ] **Step 1: Failing tests**

```js
// configController.test.js — add
describe("configController.saveLookup", () => {
  it("sends exactly the SP's parameters, Code included", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 3, ResponseCode: 200, ResponseMess: "Lookup created successfully" }],
    });
    const req = baseReq({ body: { Id: 0, Kind: "lead_status", Value: "Warm", SortOrder: 3, Code: "open", Junk: 1 } });
    await configController.saveLookup(req, mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveLookup", {
      Id: 0, CompId: 5, Kind: "lead_status", Value: "Warm", SortOrder: 3, Code: "open",
    });
  });
});

// reportController.test.js — add / replace pipelineFunnel
describe("reportController.leadsByStatus", () => {
  it("passes an optional BranchId filter plus the caller's scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ StatusId: 1, LeadCount: 2 }]] });
    const res = mockRes();
    await reportController.leadsByStatus(
      { user: { CompId: 5, BranchId: 2 }, scope: { branchIds: [2, 3] }, body: { BranchId: 3 } },
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_LeadsByStatus", {
      CompId: 5, BranchId: 3, AccessibleBranchIdsJson: "[2,3]",
    });
    expect(res.json.mock.calls[0][0].data.statuses).toEqual([{ StatusId: 1, LeadCount: 2 }]);
  });
});

describe("reportController.callsPerUser", () => {
  // The caller's OWN branch was being passed as the filter — that is the bug
  // ROLES.md names. A filter is a dropdown, not a scope.
  it("filters by the body's BranchId, not the caller's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    await reportController.callsPerUser({ user: { CompId: 5, BranchId: 2 }, scope: {}, body: {} }, mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ CompId: 5, BranchId: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && pnpm exec jest tests/unit/controllers/configController.test.js tests/unit/controllers/reportController.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement**

`configController.saveLookup`:

```js
  // Explicit list, not `...req.body`: sp_SaveLookup declares exactly these, and
  // node-mssql sends every key it is given — a stray one is a hard error from
  // SQL Server, not an ignored extra.
  saveLookup(req, res) {
    const { CompId } = req.user;
    const { Id = 0, Kind, Value, SortOrder = 0, Code = null } = req.body;
    return runSp(
      res,
      "sp_SaveLookup",
      { Id: Number(Id) || 0, CompId, Kind, Value, SortOrder: Number(SortOrder) || 0, Code: Code || null },
      "Failed to save lookup",
      req,
      saveLog(req, "Lookup", "Lookup"),
    );
  },
```

`reportController` — replace `pipelineFunnel` with:

```js
  async leadsByStatus(req, res) {
    try {
      const { BranchId = null } = req.body;
      const result = await database.executeStoredProcedure("sp_LeadsByStatus", {
        CompId: req.user.CompId,
        BranchId,
        AccessibleBranchIdsJson: scopeJson(req),
      });
      return res.status(200).json({
        success: true,
        message: "Leads by status fetched successfully",
        responseCode: 200,
        data: { statuses: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Leads by status error:", err);
      return res.status(500).json({
        success: false, message: "Failed to fetch leads by status",
        code: "LEADS_BY_STATUS_ERROR", responseCode: 500, timestamp: new Date().toISOString(),
      });
    }
  }
```

In `callsPerUser` and `conversionBySource`, change `const { CompId, BranchId } = req.user;` to `const { CompId } = req.user; const { BranchId = null } = req.body;` (keep `FromDate`/`ToDate` destructuring in `callsPerUser`).

`reportRoutes.js`: replace the `pipelineFunnel` line with `router.post("/leadsByStatus", allowEmptyPayload, reportController.leadsByStatus);`.

- [ ] **Step 4: Run to verify it passes** — both suites with `--coverage --collectCoverageFrom='src/controllers/{config,report}Controller.js'`. Expected: ≥ 80 % each.

- [ ] **Step 5: Whole backend green**

Run: `cd backend && pnpm exec jest --silent --coverage`
Expected: all suites pass; global ≥ 60 %; every file touched in Tasks 2–7 ≥ 80 %.

- [ ] **Step 6: Stop and report.**

---

### Task 8: Backend deploy (user-run) — closes the prod gap opened by `071`

**Files:** none.

Prod has been calling four dropped SPs since `071` was applied. Ship the backend now, before any web work.

- [ ] **Step 1: Confirm green** — `cd backend && pnpm exec jest --silent` → all pass.
- [ ] **Step 2: Hand the user these commands** (never run them yourself):

```bash
cd ~/Developer/Nexus/CRM/backend
REMOTE=/www/wwwroot/shadowcodes.in/CRM
rsync -avzcn src/ myserver:$REMOTE/src/          # preview: expect the controllers/routes touched in Tasks 2–7
rsync -avzc  src/ myserver:$REMOTE/src/
ssh myserver "cd $REMOTE && docker compose up -d --build crm && docker compose logs crm --tail=50"
sleep 45
ssh myserver "docker inspect --format '{{.State.Health.Status}}' nexus_crm"
curl -s https://shadowcodes.in/CRM/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://shadowcodes.in/CRM/api/products/fetchProducts   # 401 = routed
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://shadowcodes.in/CRM/api/leads/moveLeadStage       # 404 = gone
```

- [ ] **Step 3: Stop and report.** Web tasks start after `healthy` and `401`/`404` above.

---

### Task 9: Web plumbing — endpoints, routes, deletions, tickets-only Pipelines

**Files:**
- Modify: `web/src/api/salesQueries.js`
- Modify: `web/src/api/salesQueries.test.js` (replace endpoint-map assertions)
- Modify: `web/src/App.jsx` (imports + `routesConfig`)
- Modify: `web/src/App.routes.test.jsx` (append)
- Modify: `web/src/pages/Settings/Pipelines.jsx` + `Pipelines.test.jsx`
- Modify: `web/src/pages/Settings/Lookups.jsx`
- Modify: `web/src/data/helpGuides.js`
- Delete: `web/src/pages/Sales/Pipeline.jsx`, `PipelineCard.jsx`, `PipelineColumn.jsx`, `Pipeline.test.jsx`, `web/src/pages/Reports/PipelineFunnel.jsx`, `PipelineFunnel.test.jsx`

`LogCallModal` **stays** in `pages/Sales/` — `Support/TicketDetail.jsx` imports it and `supportQueries.js` reuses `SALES_ENDPOINTS.calls`. Only `LeadDetail` stops using it (Task 14). Spec 2 owns the move.

**Interfaces:**
- Produces: `SALES_ENDPOINTS` shape below — every later web task imports from it.

- [ ] **Step 1: Failing tests**

Replace the body of `salesQueries.test.js` with:

```js
import { describe, it, expect } from "vitest";
import { SALES_ENDPOINTS } from "./salesQueries";

describe("SALES_ENDPOINTS", () => {
  it("exposes the spec-1 lead contract and nothing from the pipeline era", () => {
    expect(SALES_ENDPOINTS.leads).toEqual({
      saveLeads: "/api/leads/saveLeads",
      fetchLeads: "/api/leads/fetchLeads",
      fetchLeadDetail: "/api/leads/fetchLeadDetail",
      setLeadStatus: "/api/leads/setLeadStatus",
      transferLead: "/api/leads/transferLead",
      bulkTransferLeads: "/api/leads/bulkTransferLeads",
      deleteLeads: "/api/leads/deleteLeads",
    });
    expect(SALES_ENDPOINTS.followups).toEqual({
      fetchFollowups: "/api/followups/fetchFollowups",
      scheduleFollowUp: "/api/followups/scheduleFollowUp",
      completeFollowUp: "/api/followups/completeFollowUp",
      skipFollowUp: "/api/followups/skipFollowUp",
      deleteFollowup: "/api/followups/deleteFollowup",
    });
    expect(SALES_ENDPOINTS.products).toEqual({
      saveProduct: "/api/products/saveProduct",
      fetchProducts: "/api/products/fetchProducts",
      deleteProduct: "/api/products/deleteProduct",
    });
    expect(SALES_ENDPOINTS.users).toEqual({
      fetchAssignableUsers: "/api/users/fetchAssignableUsers",
      fetchBranches: "/api/users/fetchBranches",
    });
    expect(SALES_ENDPOINTS.reports.leadsByStatus).toBe("/api/reports/leadsByStatus");
    expect(SALES_ENDPOINTS.reports).not.toHaveProperty("pipelineFunnel");
  });

  it("keeps the config + calls endpoints Support still reads", () => {
    expect(SALES_ENDPOINTS.config.fetchPipelines).toBe("/api/config/fetchPipelines");
    expect(SALES_ENDPOINTS.calls.logCall).toBe("/api/calls/logCall");
  });
});
```

Append to `App.routes.test.jsx`:

```js
import { routesConfig } from "./App";

describe("spec-1 routes", () => {
  const paths = routesConfig.map((r) => r.path);
  it("has no pipeline page, only a redirect", () => {
    const pipeline = routesConfig.find((r) => r.path === "/sales/pipeline");
    expect(pipeline.element.type.name).toBe("Navigate");
  });
  it("registers products and leads-by-status", () => {
    expect(paths).toContain("/settings/products");
    expect(paths).toContain("/reports/leads-by-status");
  });
});
```

In `Pipelines.test.jsx`: delete the tests "switches to the Tickets tab…" and "creates a pipeline under the active entity (Entity='ticket')"; change "lists pipelines for Entity='lead' by default" to expect `{ Entity: "ticket" }`; change the `Entity: "lead"` expectation near line 248 to `"ticket"`; remove every `pipeline-entity-tabs` click. Add:

```js
  it("no longer offers an entity switch — tickets only until spec 2", async () => {
    renderPage();
    await waitFor(() => expect(lastFetchBody).toEqual({ Entity: "ticket" }));
    expect(screen.queryByTestId("pipeline-entity-tabs")).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail** — `cd web && pnpm exec vitest run src/api/salesQueries.test.js src/App.routes.test.jsx src/pages/Settings/Pipelines.test.jsx`. Expected: FAIL.

- [ ] **Step 3: `salesQueries.js`** — replace `SALES_ENDPOINTS` and the fetcher block:

```js
export const SALES_ENDPOINTS = {
  config: {
    saveCustomField: "/api/config/saveCustomField",
    fetchCustomFields: "/api/config/fetchCustomFields",
    deleteCustomField: "/api/config/deleteCustomField",
    savePipeline: "/api/config/savePipeline",
    fetchPipelines: "/api/config/fetchPipelines",
    saveStage: "/api/config/saveStage",
    deleteStage: "/api/config/deleteStage",
    saveLookup: "/api/config/saveLookup",
    fetchLookups: "/api/config/fetchLookups",
    deleteLookup: "/api/config/deleteLookup",
  },
  products: {
    saveProduct: "/api/products/saveProduct",
    fetchProducts: "/api/products/fetchProducts",
    deleteProduct: "/api/products/deleteProduct",
  },
  users: {
    fetchAssignableUsers: "/api/users/fetchAssignableUsers",
    fetchBranches: "/api/users/fetchBranches",
  },
  leads: {
    saveLeads: "/api/leads/saveLeads",
    fetchLeads: "/api/leads/fetchLeads",
    fetchLeadDetail: "/api/leads/fetchLeadDetail",
    setLeadStatus: "/api/leads/setLeadStatus",
    transferLead: "/api/leads/transferLead",
    bulkTransferLeads: "/api/leads/bulkTransferLeads",
    deleteLeads: "/api/leads/deleteLeads",
  },
  // Tickets still log calls here (Support/TicketDetail + supportQueries).
  calls: {
    logCall: "/api/calls/logCall",
    fetchCalls: "/api/calls/fetchCalls",
  },
  followups: {
    fetchFollowups: "/api/followups/fetchFollowups",
    scheduleFollowUp: "/api/followups/scheduleFollowUp",
    completeFollowUp: "/api/followups/completeFollowUp",
    skipFollowUp: "/api/followups/skipFollowUp",
    deleteFollowup: "/api/followups/deleteFollowup",
  },
  reports: {
    leadsByStatus: "/api/reports/leadsByStatus",
    callsPerUser: "/api/reports/callsPerUser",
    conversionBySource: "/api/reports/conversionBySource",
  },
};

const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

export const saveCustomField = post(SALES_ENDPOINTS.config.saveCustomField);
export const fetchCustomFields = post(SALES_ENDPOINTS.config.fetchCustomFields);
export const deleteCustomField = post(SALES_ENDPOINTS.config.deleteCustomField);
export const savePipeline = post(SALES_ENDPOINTS.config.savePipeline);
export const fetchPipelines = post(SALES_ENDPOINTS.config.fetchPipelines);
export const saveStage = post(SALES_ENDPOINTS.config.saveStage);
export const deleteStage = post(SALES_ENDPOINTS.config.deleteStage);
export const saveLookup = post(SALES_ENDPOINTS.config.saveLookup);
export const fetchLookups = post(SALES_ENDPOINTS.config.fetchLookups);
export const deleteLookup = post(SALES_ENDPOINTS.config.deleteLookup);

export const saveProduct = post(SALES_ENDPOINTS.products.saveProduct);
export const fetchProducts = post(SALES_ENDPOINTS.products.fetchProducts);
export const deleteProduct = post(SALES_ENDPOINTS.products.deleteProduct);

export const fetchAssignableUsers = post(SALES_ENDPOINTS.users.fetchAssignableUsers);
export const fetchBranches = post(SALES_ENDPOINTS.users.fetchBranches);

export const saveLeads = post(SALES_ENDPOINTS.leads.saveLeads);
export const fetchLeads = post(SALES_ENDPOINTS.leads.fetchLeads);
export const fetchLeadDetail = post(SALES_ENDPOINTS.leads.fetchLeadDetail);
export const setLeadStatus = post(SALES_ENDPOINTS.leads.setLeadStatus);
export const transferLead = post(SALES_ENDPOINTS.leads.transferLead);
export const bulkTransferLeads = post(SALES_ENDPOINTS.leads.bulkTransferLeads);
export const deleteLeads = post(SALES_ENDPOINTS.leads.deleteLeads);

export const logCall = post(SALES_ENDPOINTS.calls.logCall);
export const fetchCalls = post(SALES_ENDPOINTS.calls.fetchCalls);

export const fetchFollowups = post(SALES_ENDPOINTS.followups.fetchFollowups);
export const scheduleFollowUp = post(SALES_ENDPOINTS.followups.scheduleFollowUp);
export const completeFollowUp = post(SALES_ENDPOINTS.followups.completeFollowUp);
export const skipFollowUp = post(SALES_ENDPOINTS.followups.skipFollowUp);
export const deleteFollowup = post(SALES_ENDPOINTS.followups.deleteFollowup);

export const leadsByStatus = post(SALES_ENDPOINTS.reports.leadsByStatus);
export const callsPerUser = post(SALES_ENDPOINTS.reports.callsPerUser);
export const conversionBySource = post(SALES_ENDPOINTS.reports.conversionBySource);
```

- [ ] **Step 4: `App.jsx`**

Remove the `Pipeline` and `PipelineFunnel` lazy imports; add:

```js
const Products = lazy(() => import("./pages/Settings/Products"));
const LeadsByStatus = lazy(() => import("./pages/Reports/LeadsByStatus"));
```

In `routesConfig`: change the `/sales` fallback to `"/sales/leads"` and the `/reports` fallback to `"/reports/leads-by-status"`; replace the `/sales/pipeline` and `/reports/pipeline-funnel` entries with:

```js
  // The pipeline board is gone (spec 1). Bookmarks land on the list.
  { path: "/sales/pipeline", element: <Navigate to="/sales/leads" replace /> },
  { path: "/reports/pipeline-funnel", element: <Navigate to="/reports/leads-by-status" replace /> },
  { path: "/reports/leads-by-status", element: <ProtectedRoute element={<LeadsByStatus />} /> },
  { path: "/settings/products", element: <ProtectedRoute element={<Products />} /> },
```

`Products` and `LeadsByStatus` do not exist yet — create two stub files so the build stays green until Tasks 16 and 18 replace them:

```jsx
// web/src/pages/Settings/Products.jsx  (stub — replaced in Task 16)
export default function Products() { return null; }
```
```jsx
// web/src/pages/Reports/LeadsByStatus.jsx  (stub — replaced in Task 18)
export default function LeadsByStatus() { return null; }
```

- [ ] **Step 5: `Pipelines.jsx` tickets-only**

Delete `ENTITY_OPTIONS`; replace `const [entity, setEntity] = useState(ENTITY_OPTIONS[0].value);` with `const entity = "ticket"; // leads have no pipeline since spec 1; spec 2 retires this page`; delete the `handleEntityChange` function (lines ~80–85) and the `<Tabs … data-testid="pipeline-entity-tabs" />` block (~lines 246–253). Update the page subtitle to `"Ticket pipelines and their stages."`.

- [ ] **Step 6: `Lookups.jsx`** — add to `KIND_OPTIONS`:

```js
  { value: "lead_status", label: "Lead Statuses" },
  { value: "product_category", label: "Product Categories" },
  { value: "transfer_reason", label: "Transfer Reasons" },
```

- [ ] **Step 7: `helpGuides.js`** — delete the three lead lines about the Pipeline board (en+hi at ~108–109), "Log Call" (~104–105) and "created automatically when you log a call" (~123). Replace the Stage-filter line (~96–97) with `en: "Use the Status / Owner / Product / Source filters and the presets (My leads, Overdue, Unassigned) to find leads."`, `hi: "Status / Owner / Product / Source फ़िल्टर और presets (My leads, Overdue, Unassigned) से लीड्स ढूँढें।"`.

- [ ] **Step 8: Delete** the six files listed above.

- [ ] **Step 9: Verify** — `cd web && pnpm exec vitest run src/api src/App.routes.test.jsx src/pages/Settings/Pipelines.test.jsx && pnpm build`. Expected: pass; build green (stubs satisfy the lazy imports).

- [ ] **Step 10: Stop and report.**

---

### Task 10: `useAssignableUsers` + the new Transfer modal (single **and** bulk)

**Files:**
- Create: `web/src/hooks/useAssignableUsers.jsx`
- Modify: `web/src/pages/Sales/TransferLeadModal.jsx` (rewrite)
- Modify: `web/src/pages/Sales/TransferLeadModal.test.jsx` (rewrite)

**Interfaces:**
- Consumes: `fetchAssignableUsers { BranchId? }` → `{ users: [{Id, FullName, BranchId, BranchName}] }`; `fetchBranches` → `{ branches: [{Id, BranchName}] }`; `transferLead` / `bulkTransferLeads` bodies from Task 5; `useLookups("transfer_reason")`.
- Produces: `useAssignableUsers({ branchId, enabled })` → `{ users, isLoading }`; `<TransferLeadModal open leadIds={number[]} onClose onTransferred canCrossBranch />`. One lead → `transferLead`; several → `bulkTransferLeads`. Tasks 13 and 14 render it.

- [ ] **Step 1: Failing tests** — replace `TransferLeadModal.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import TransferLeadModal from "./TransferLeadModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const mocks = (capture = {}) =>
  server.use(
    http.post("*/api/users/fetchAssignableUsers", async ({ request }) => {
      const body = await request.json();
      capture.roster = body;
      return json({
        users: body?.BranchId === 4
          ? [{ Id: 9, FullName: "Nashik Nina", BranchId: 4 }]
          : [{ Id: 2, FullName: "Bob", BranchId: 2 }, { Id: 3, FullName: "Priya", BranchId: 2 }],
      });
    }),
    http.post("*/api/users/fetchBranches", async () =>
      json({ branches: [{ Id: 2, BranchName: "Pune" }, { Id: 4, BranchName: "Nashik" }] }),
    ),
    http.post("*/api/config/fetchLookups", async () =>
      json({ lookups: [{ Id: 1, Value: "Absent" }, { Id: 2, Value: "Wrong branch" }] }),
    ),
    http.post("*/api/leads/transferLead", async ({ request }) => {
      capture.single = await request.json();
      return json({ Id: 7, ResponseCode: 200, ResponseMess: "Lead transferred successfully" });
    }),
    http.post("*/api/leads/bulkTransferLeads", async ({ request }) => {
      capture.bulk = await request.json();
      return json({ Transferred: 2, Skipped: 0, ResponseCode: 200, ResponseMess: "2 lead(s) transferred" });
    }),
  );

const pick = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name }));
};

describe("TransferLeadModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" });
  });

  it("posts transferLead with person, reason and remarks", async () => {
    const cap = {};
    mocks(cap);
    const onTransferred = vi.fn();
    renderWithProviders(<TransferLeadModal open leadIds={[7]} onClose={() => {}} onTransferred={onTransferred} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "transfer-owner", "Priya");
    await pick(user, "transfer-reason", "Absent");
    await user.type(screen.getByTestId("transfer-remarks"), "On leave this week");
    await user.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => expect(cap.single).toBeTruthy());
    expect(cap.single).toEqual({ LeadId: 7, ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "On leave this week" });
    expect(onTransferred).toHaveBeenCalled();
  });

  it("refuses to submit without remarks", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<TransferLeadModal open leadIds={[7]} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();
    await pick(user, "transfer-owner", "Bob");
    await pick(user, "transfer-reason", "Absent");
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();
    await user.click(screen.getByTestId("transfer-submit"));
    expect(cap.single).toBeUndefined();
  });

  it("cross-branch: picking a branch reloads the roster for it and sends ToBranchId", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<TransferLeadModal open leadIds={[7]} canCrossBranch onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "transfer-branch", "Nashik");
    await waitFor(() => expect(cap.roster).toEqual({ BranchId: 4 }));
    await pick(user, "transfer-owner", "Nashik Nina");
    await pick(user, "transfer-reason", "Wrong branch");
    await user.type(screen.getByTestId("transfer-remarks"), "Address is Nashik");
    await user.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => expect(cap.single).toBeTruthy());
    expect(cap.single).toMatchObject({ ToUserId: 9, ToBranchId: 4, ReasonId: 2 });
  });

  it("hides the branch picker when the caller cannot cross branches", () => {
    mocks();
    renderWithProviders(<TransferLeadModal open leadIds={[7]} onClose={() => {}} />, { router: false });
    expect(screen.queryByTestId("transfer-branch-input")).toBeNull();
  });

  it("several leads → bulkTransferLeads with the id list", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<TransferLeadModal open leadIds={[7, 8]} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();
    expect(screen.getByText(/Transfer 2 leads/)).toBeInTheDocument();

    await pick(user, "transfer-owner", "Bob");
    await pick(user, "transfer-reason", "Absent");
    await user.type(screen.getByTestId("transfer-remarks"), "Covering");
    await user.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => expect(cap.bulk).toBeTruthy());
    expect(cap.bulk).toEqual({ LeadIds: [7, 8], ToUserId: 2, ToBranchId: null, ReasonId: 1, Remarks: "Covering" });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd web && pnpm exec vitest run src/pages/Sales/TransferLeadModal.test.jsx`. Expected: FAIL (old modal has no reason/remarks).

- [ ] **Step 3: The hook**

```jsx
// web/src/hooks/useAssignableUsers.jsx
import { useMemo } from "react";
import { useApiQuery } from "./useApiQuery";
import { SALES_ENDPOINTS } from "../api/salesQueries";

/**
 * Who the signed-in user may hand a lead to. The server scopes the list
 * (subtree + manager for Team/Self; readable branches for wide scopes) and
 * re-checks membership on every transfer — this is the pick-list, not the gate.
 *
 * `branchId` switches to a destination branch's roster for cross-branch moves.
 */
export function useAssignableUsers({ branchId = null, enabled = true } = {}) {
  const query = useApiQuery({
    queryKey: ["assignable-users", branchId],
    endpoint: SALES_ENDPOINTS.users.fetchAssignableUsers,
    params: branchId ? { BranchId: branchId } : {},
    enabled,
    showErrorMessage: false,
  });
  const users = useMemo(() => query.data?.users ?? [], [query.data]);
  return { ...query, users };
}

export default useAssignableUsers;
```

- [ ] **Step 4: The modal**

```jsx
// web/src/pages/Sales/TransferLeadModal.jsx
import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { useLookups } from "../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

/**
 * Hand one lead, or many, to someone else — always with a reason and remarks.
 * Those two are what make the assignment history readable by whoever inherits
 * the lead, so the button stays disabled until both are there. The server
 * refuses without them too; this just saves the round-trip.
 *
 * `canCrossBranch` (DataScope Branch and up) shows the branch picker; choosing
 * a branch reloads the roster for that branch and sends ToBranchId.
 */
export default function TransferLeadModal({ open, onClose, leadIds = [], onTransferred, canCrossBranch = false }) {
  const [branch, setBranch] = useState(null);
  const [owner, setOwner] = useState(null);
  const [reason, setReason] = useState(null);
  const [remarks, setRemarks] = useState("");

  const bulk = leadIds.length > 1;

  const { users } = useAssignableUsers({ branchId: branch?.value ?? null, enabled: open });
  const { lookups: reasons } = useLookups("transfer_reason", { enabled: open, showErrorMessage: false });
  const { data: branchData } = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    enabled: open && canCrossBranch,
    showErrorMessage: false,
  });

  const ownerOptions = users.map((u) => ({ value: u.Id, label: u.FullName }));
  const reasonOptions = reasons.map((r) => ({ value: r.Id, label: r.Value }));
  const branchOptions = (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName }));

  // A new branch means a new roster — the old pick no longer exists in it.
  useEffect(() => setOwner(null), [branch?.value]);

  const mutation = useApiMutation({
    endpoint: bulk ? SALES_ENDPOINTS.leads.bulkTransferLeads : SALES_ENDPOINTS.leads.transferLead,
    successMessage: bulk ? "Leads transferred" : "Lead transferred",
    invalidateQueries: [["leads"], ["lead-detail"], ["followups"]],
  });

  const reset = () => { setBranch(null); setOwner(null); setReason(null); setRemarks(""); };
  const handleClose = () => { reset(); onClose?.(); };
  const ready = Boolean(owner && reason && remarks.trim());

  const submit = async () => {
    if (!ready) return;
    const common = { ToUserId: owner.value, ToBranchId: branch?.value ?? null, ReasonId: reason.value, Remarks: remarks.trim() };
    try {
      await mutation.mutateAsync(bulk ? { LeadIds: leadIds, ...common } : { LeadId: leadIds[0], ...common });
      reset();
      onTransferred?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="transfer-lead-modal">
      <Modal.Header
        title={bulk ? `Transfer ${leadIds.length} leads` : "Transfer Lead"}
        icon={<ArrowRightLeft size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {canCrossBranch && (
            <Combobox
              label="Branch"
              options={branchOptions}
              value={branch}
              onChange={setBranch}
              placeholder="Keep current branch"
              data-testid="transfer-branch"
            />
          )}
          <Combobox
            label="New owner"
            required
            options={ownerOptions}
            value={owner}
            onChange={setOwner}
            placeholder="Pick the new owner"
            data-testid="transfer-owner"
          />
          <Combobox
            label="Reason"
            required
            options={reasonOptions}
            value={reason}
            onChange={setReason}
            placeholder="Why is this moving?"
            data-testid="transfer-reason"
          />
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What the next person needs to know"
            data-testid="transfer-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!ready}
          loading={mutation.isPending}
          data-testid="transfer-submit"
        >
          Transfer
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

- [ ] **Step 5: Run to verify it passes** — `cd web && pnpm exec vitest run src/pages/Sales/TransferLeadModal.test.jsx --coverage.include='src/pages/Sales/TransferLeadModal.jsx' --coverage.include='src/hooks/useAssignableUsers.jsx'`. Expected: 5 passed; both ≥ 80 %. (If `TextArea`'s testid lands on a wrapper rather than the textarea, use `screen.getByTestId("transfer-remarks").querySelector("textarea")` in the test — check `components/ui/TextArea.jsx` first.)

- [ ] **Step 6: Stop and report.**

---

### Task 11: `leadStatus.js` + `LogFollowUpModal`

**Files:**
- Create: `web/src/pages/Sales/leadStatus.js` + `leadStatus.test.js`
- Create: `web/src/pages/Sales/LogFollowUpModal.jsx` + `LogFollowUpModal.test.jsx`

**Interfaces:**
- Produces: `isActiveCode(code)`, `LEAD_PRESETS` (used by Task 13), `FOLLOWUP_TYPES`; `<LogFollowUpModal open followUp onClose onLogged />` posting `completeFollowUp` (Tasks 14, 15).

- [ ] **Step 1: Failing tests**

```js
// web/src/pages/Sales/leadStatus.test.js
import { describe, it, expect } from "vitest";
import { isActiveCode, LEAD_PRESETS, presetParams } from "./leadStatus";

describe("leadStatus helpers", () => {
  it("treats open and qualified as active, the rest as closed", () => {
    expect(isActiveCode("open")).toBe(true);
    expect(isActiveCode("qualified")).toBe(true);
    expect(isActiveCode("lost")).toBe(false);
    expect(isActiveCode("junk")).toBe(false);
    expect(isActiveCode(undefined)).toBe(false);
  });

  it("maps presets onto fetchLeads params", () => {
    expect(presetParams("mine", 7)).toEqual({ OwnerId: 7 });
    expect(presetParams("overdue")).toEqual({ Overdue: true });
    expect(presetParams("unassigned")).toEqual({ Unassigned: true });
    expect(presetParams("lost")).toEqual({ StatusCode: "lost" });
    expect(presetParams("all")).toEqual({});
    expect(LEAD_PRESETS.map((p) => p.value)).toEqual(["all", "mine", "overdue", "unassigned", "lost"]);
  });
});
```

```jsx
// web/src/pages/Sales/LogFollowUpModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import LogFollowUpModal from "./LogFollowUpModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const FU = { Id: 21, LeadId: 9, Type: "call", DueAt: "2026-09-10T00:00:00.000Z", Status: "open" };

const mocks = (cap = {}) =>
  server.use(
    http.post("*/api/config/fetchLookups", async () =>
      json({ lookups: [{ Id: 1, Value: "Connected" }, { Id: 2, Value: "No Answer" }] }),
    ),
    http.post("*/api/followups/completeFollowUp", async ({ request }) => {
      cap.body = await request.json();
      return json({ Id: 21, NextId: 22 });
    }),
  );

describe("LogFollowUpModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" });
  });

  it("posts outcome, remarks and the next follow-up", async () => {
    const cap = {};
    mocks(cap);
    const onLogged = vi.fn();
    renderWithProviders(<LogFollowUpModal open followUp={FU} onClose={() => {}} onLogged={onLogged} />, { router: false });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("followup-outcome-input"));
    await user.click(await screen.findByRole("option", { name: "Connected" }));
    await user.type(screen.getByTestId("followup-remarks"), "Wants a quote for 2 units");
    await user.click(screen.getByTestId("followup-next-type-input"));
    await user.click(await screen.findByRole("option", { name: "Visit" }));
    await user.type(screen.getByTestId("followup-next-date"), "2026-09-14");
    await user.click(screen.getByTestId("followup-submit"));

    await waitFor(() => expect(cap.body).toBeTruthy());
    expect(cap.body).toEqual({
      Id: 21, OutcomeId: 1, Remarks: "Wants a quote for 2 units",
      Direction: "out", Duration: null, NextType: "visit", NextDueAt: "2026-09-14",
    });
    expect(onLogged).toHaveBeenCalled();
  });

  it("will not submit without remarks", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<LogFollowUpModal open followUp={FU} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();
    expect(screen.getByTestId("followup-submit")).toBeDisabled();
    await user.click(screen.getByTestId("followup-submit"));
    expect(cap.body).toBeUndefined();
  });

  it("hides call-only fields for a visit", () => {
    mocks();
    renderWithProviders(<LogFollowUpModal open followUp={{ ...FU, Type: "visit" }} onClose={() => {}} />, { router: false });
    expect(screen.queryByTestId("followup-direction-input")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `cd web && pnpm exec vitest run src/pages/Sales/leadStatus.test.js src/pages/Sales/LogFollowUpModal.test.jsx`.

- [ ] **Step 3: Helpers**

```js
// web/src/pages/Sales/leadStatus.js
// The lookup's Code is the machine meaning behind an editable label.
// open | qualified = still being worked; lost | junk | converted = closed.
export const isActiveCode = (code) => code === "open" || code === "qualified";

export const LEAD_PRESETS = [
  { value: "all", label: "All" },
  { value: "mine", label: "My leads" },
  { value: "overdue", label: "Overdue" },
  { value: "unassigned", label: "Unassigned" },
  { value: "lost", label: "Lost" },
];

export const presetParams = (preset, userId) => {
  switch (preset) {
    case "mine": return { OwnerId: userId };
    case "overdue": return { Overdue: true };
    case "unassigned": return { Unassigned: true };
    case "lost": return { StatusCode: "lost" };
    default: return {};
  }
};

export const FOLLOWUP_TYPES = [
  { value: "call", label: "Call" },
  { value: "visit", label: "Visit" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

export const DIRECTIONS = [
  { value: "out", label: "Outgoing" },
  { value: "in", label: "Incoming" },
];
```

- [ ] **Step 4: The modal**

```jsx
// web/src/pages/Sales/LogFollowUpModal.jsx
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import dayjs from "dayjs";

import { Modal, Button, Combobox, TextArea, DateField, NumberInput } from "../../components/ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { FOLLOWUP_TYPES, DIRECTIONS } from "./leadStatus";

/**
 * Completes an open follow-up: what happened (outcome), what was said
 * (remarks — required; the table's CHECK enforces it too), and optionally the
 * next one. A call also records direction and minutes.
 */
export default function LogFollowUpModal({ open, onClose, followUp, onLogged }) {
  const [outcome, setOutcome] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [direction, setDirection] = useState(DIRECTIONS[0]);
  const [duration, setDuration] = useState("");
  const [nextType, setNextType] = useState(FOLLOWUP_TYPES[0]);
  const [nextDate, setNextDate] = useState("");

  const isCall = followUp?.Type === "call";
  const { lookups: outcomes } = useLookups("call_outcome", { enabled: open, showErrorMessage: false });
  const outcomeOptions = outcomes.map((o) => ({ value: o.Id, label: o.Value }));

  useEffect(() => {
    if (!open) return;
    setOutcome(null); setRemarks(""); setDirection(DIRECTIONS[0]); setDuration("");
    setNextType(FOLLOWUP_TYPES[0]); setNextDate("");
  }, [open, followUp?.Id]);

  const mutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.followups.completeFollowUp,
    successMessage: "Follow-up logged",
    invalidateQueries: [["followups"], ["lead-detail"], ["leads"]],
  });

  const ready = Boolean(remarks.trim());
  const submit = async () => {
    if (!ready) return;
    try {
      await mutation.mutateAsync({
        Id: followUp.Id,
        OutcomeId: outcome?.value ?? null,
        Remarks: remarks.trim(),
        Direction: isCall ? direction?.value ?? null : null,
        Duration: isCall && duration !== "" ? Number(duration) : null,
        NextType: nextDate ? nextType?.value ?? "call" : null,
        NextDueAt: nextDate || null,
      });
      onLogged?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message.
    }
  };

  const due = followUp?.DueAt ? dayjs(followUp.DueAt).format("DD-MM-YYYY") : "";
  const typeLabel = FOLLOWUP_TYPES.find((t) => t.value === followUp?.Type)?.label ?? "Follow-up";

  return (
    <Modal open={open} onClose={onClose} size="md" data-testid="log-followup-modal">
      <Modal.Header title={`Log ${typeLabel}${due ? ` · due ${due}` : ""}`} icon={<CheckCircle2 size={18} />} onClose={onClose} />
      <Modal.Body>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          <Combobox label="Outcome" options={outcomeOptions} value={outcome} onChange={setOutcome} placeholder="What happened?" data-testid="followup-outcome" />
          {isCall && (
            <>
              <Combobox label="Direction" options={DIRECTIONS} value={direction} onChange={setDirection} data-testid="followup-direction" />
              <NumberInput label="Minutes" value={duration} onChange={(e) => setDuration(e.target.value)} data-testid="followup-duration" />
            </>
          )}
          <div style={{ gridColumn: "1 / -1" }}>
            <TextArea
              label="Remarks"
              required
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Exactly what was discussed — the next person reads this"
              data-testid="followup-remarks"
            />
          </div>
          <Combobox label="Next follow-up" options={FOLLOWUP_TYPES} value={nextType} onChange={setNextType} data-testid="followup-next-type" />
          <DateField label="Next date" value={nextDate} onChange={setNextDate} data-testid="followup-next-date" />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="followup-submit">
          Log follow-up
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

- [ ] **Step 5: Run to verify it passes** — `cd web && pnpm exec vitest run src/pages/Sales/leadStatus.test.js src/pages/Sales/LogFollowUpModal.test.jsx --coverage.include='src/pages/Sales/leadStatus.js' --coverage.include='src/pages/Sales/LogFollowUpModal.jsx'`. Expected: 5 passed; ≥ 80 %. (`DateField`'s testid: check how `LeadCreateModal.test.jsx` types into `lead-followup-date` today and mirror it.)

- [ ] **Step 6: Stop and report.**

---

### Task 12: `LeadCreateModal` — the richer form

**Files:**
- Modify: `web/src/pages/Sales/LeadCreateModal.jsx` (rewrite the schema, `EMPTY`, `leadToForm`, option sources, submit payload, and the field grid)
- Modify: `web/src/pages/Sales/LeadCreateModal.test.jsx` (replace the pipeline/stage assertions)

**Interfaces:**
- Consumes: `saveLeads` body (Task 5); `useLookups("lead_source")`, `useLookups("lead_status")`; `fetchProducts` → `{ products }`; `useUsers` for owner (create only).
- Produces: `<LeadCreateModal open lead onClose onSaved />` unchanged signature.

- [ ] **Step 1: Failing tests** — in `LeadCreateModal.test.jsx`, replace the existing "creates" test's mocks and assertions with:

```jsx
// MSW additions in the file's mock setup:
http.post("*/api/products/fetchProducts", async () =>
  json({ products: [{ Id: 2, Name: "TV 43in" }], pagination: { currentPage: 1, pageSize: 200, totalRecords: 1, totalPages: 1 } }),
),
// fetchLookups: branch on body.Kind —
//   lead_source  -> [{ Id: 5, Value: "Website" }]
//   lead_status  -> [{ Id: 11, Value: "New", Code: "open", SortOrder: 1 }, { Id: 12, Value: "Contacted", Code: "open", SortOrder: 2 }]

it("creates with address, product, remarks and a first follow-up, no pipeline", async () => {
  let captured;
  // saveLeads handler captures the body → { Id: 42, ResponseCode: 200 }
  renderWithProviders(<LeadCreateModal open onClose={() => {}} />, { router: false });
  const user = userEvent.setup();

  await user.type(screen.getByTestId("lead-name"), "Sharma");
  await user.type(screen.getByTestId("lead-mobile"), "9820012345");
  await user.type(screen.getByTestId("lead-company"), "Sharma Traders");
  await user.type(screen.getByTestId("lead-city"), "Pune");
  await user.type(screen.getByTestId("lead-pincode"), "411001");
  await pick(user, "lead-product", "TV 43in");
  await pick(user, "lead-owner", "Bob");
  await user.type(screen.getByTestId("lead-remarks"), "Walk-in, wants delivery Friday");
  await user.click(screen.getByTestId("lead-create-submit"));

  await waitFor(() => expect(captured).toBeTruthy());
  expect(captured).toMatchObject({
    Id: 0, Name: "Sharma", MobileNo: "9820012345", Company: "Sharma Traders", City: "Pune",
    Pincode: "411001", ProductId: 2, OwnerId: 2, Remarks: "Walk-in, wants delivery Friday",
    StatusId: 11,                                   // the default 'open' status, lowest SortOrder
    FirstFollowupAt: dayjs().format("YYYY-MM-DD"),  // today
  });
  expect(captured).not.toHaveProperty("PipelineId");
  expect(captured).not.toHaveProperty("StageId");
});

it("edit hides Owner and Status and sends neither", async () => {
  let captured;
  renderWithProviders(<LeadCreateModal open lead={{ Id: 9, Name: "Acme", MobileNo: "9", City: "Pune" }} onClose={() => {}} />, { router: false });
  expect(screen.queryByTestId("lead-owner-input")).toBeNull();
  expect(screen.queryByTestId("lead-status-input")).toBeNull();
  const user = userEvent.setup();
  await user.click(screen.getByTestId("lead-create-submit"));
  await waitFor(() => expect(captured).toBeTruthy());
  expect(captured).toMatchObject({ Id: 9, City: "Pune", CustomJSON: null });
  expect(captured.OwnerId).toBeUndefined();
  expect(captured.StatusId).toBeUndefined();
});
```

(Keep the file's existing `pick` helper / `json` helper / auth-store `beforeEach`; delete every assertion on `lead-pipeline` / `lead-stage`.)

- [ ] **Step 2: Run to verify it fails** — `cd web && pnpm exec vitest run src/pages/Sales/LeadCreateModal.test.jsx`.

- [ ] **Step 3: Implement** — in `LeadCreateModal.jsx`:

Replace `schema`, `EMPTY`, `leadToForm`:

```js
const schema = z.object({
  Name: z.string().trim().min(1, "Name is required"),
  Company: z.string().optional(),
  MobileNo: z.string().trim().min(1, "Mobile number is required"),
  AltMobile: z.string().optional(),
  Email: z.union([z.string().email("Invalid email"), z.literal("")]).optional(),
  Address: z.string().optional(),
  City: z.string().optional(),
  State: z.string().optional(),
  Pincode: z.string().optional(),
  SourceId: z.number().nullable().optional(),
  ProductId: z.number().nullable().optional(),
  StatusId: z.number().nullable().optional(),
  OwnerId: z.number().nullable().optional(),
  EstValue: z.string().optional(),
  Remarks: z.string().optional(),
  FirstFollowupAt: z.string().optional(),
});

const today = () => dayjs().format("YYYY-MM-DD");

const EMPTY = {
  Name: "", Company: "", MobileNo: "", AltMobile: "", Email: "",
  Address: "", City: "", State: "", Pincode: "",
  SourceId: null, ProductId: null, StatusId: null, OwnerId: null,
  EstValue: "", Remarks: "", FirstFollowupAt: today(),
};

const leadToForm = (lead) => ({
  Name: lead.Name ?? "", Company: lead.Company ?? "", MobileNo: lead.MobileNo ?? "",
  AltMobile: lead.AltMobile ?? "", Email: lead.Email ?? "",
  Address: lead.Address ?? "", City: lead.City ?? "", State: lead.State ?? "", Pincode: lead.Pincode ?? "",
  SourceId: lead.SourceId ?? null, ProductId: lead.ProductId ?? null,
  StatusId: null, OwnerId: null,
  EstValue: lead.EstValue == null ? "" : String(lead.EstValue),
  Remarks: lead.Remarks ?? "", FirstFollowupAt: "",
});
```

Replace the pipelines query with statuses + products:

```js
  const { lookups: statuses } = useLookups("lead_status", { enabled: Boolean(open) && !isEdit, showErrorMessage: false });
  const { data: productsData } = useApiQuery({
    queryKey: ["products", "active"],
    endpoint: SALES_ENDPOINTS.products.fetchProducts,
    params: { PageSize: 200, IsActive: true },
    enabled: Boolean(open),
    showErrorMessage: false,
  });
  const products = productsData?.products ?? [];
  const statusOpts = useMemo(() => statuses.map((s) => ({ value: s.Id, label: s.Value })), [statuses]);
  const productOpts = useMemo(() => products.map((p) => ({ value: p.Id, label: p.Name })), [products]);
```

Delete `pipelineId`/`pipelineOpts`/`stageOpts` and the "default to the company's default pipeline" effect. Replace it with the default-status effect:

```js
  // New leads start in the first 'open' status unless the user picks another.
  useEffect(() => {
    if (!open || isEdit || statuses.length === 0) return;
    const first = [...statuses].filter((s) => s.Code === "open").sort((a, b) => a.SortOrder - b.SortOrder)[0] ?? statuses[0];
    setValue("StatusId", first.Id);
  }, [open, isEdit, statuses, setValue]);
```

Submit payload — replace the `mutateAsync({...})` object:

```js
      const saved = await saveMutation.mutateAsync({
        Id: lead?.Id ?? 0,
        Name: values.Name.trim(),
        Company: values.Company?.trim() || null,
        MobileNo: values.MobileNo.trim(),
        AltMobile: values.AltMobile?.trim() || null,
        Email: values.Email?.trim() || null,
        Address: values.Address?.trim() || null,
        City: values.City?.trim() || null,
        State: values.State?.trim() || null,
        Pincode: values.Pincode?.trim() || null,
        SourceId: values.SourceId ?? null,
        ProductId: values.ProductId ?? null,
        EstValue: values.EstValue === "" ? null : Number(values.EstValue),
        Remarks: values.Remarks?.trim() || null,
        // Ownership and status are create-time only; edits move them through
        // Transfer and the status dropdown, never through this form.
        ...(isEdit ? {} : { StatusId: values.StatusId ?? null, OwnerId: values.OwnerId ?? null, FirstFollowupAt: values.FirstFollowupAt || null }),
        CustomJSON: isEdit ? null : JSON.stringify(customJson),
      });
```

Field grid — replace the `PipelineId`/`StageId`/`NextFollowupDate` controllers, and add after `Email`:

```jsx
            <Controller control={control} name="Company" render={({ field }) => (
              <TextInput label="Company" value={field.value} onChange={field.onChange} onBlur={field.onBlur} data-testid="lead-company" />
            )} />
            <Controller control={control} name="Address" render={({ field }) => (
              <TextInput label="Address" value={field.value} onChange={field.onChange} onBlur={field.onBlur} data-testid="lead-address" />
            )} />
            <Controller control={control} name="City" render={({ field }) => (
              <TextInput label="City" value={field.value} onChange={field.onChange} onBlur={field.onBlur} data-testid="lead-city" />
            )} />
            <Controller control={control} name="State" render={({ field }) => (
              <TextInput label="State" value={field.value} onChange={field.onChange} onBlur={field.onBlur} data-testid="lead-state" />
            )} />
            <Controller control={control} name="Pincode" render={({ field }) => (
              <TextInput label="Pincode" value={field.value} onChange={field.onChange} onBlur={field.onBlur} data-testid="lead-pincode" />
            )} />
            <Controller control={control} name="ProductId" render={({ field }) => (
              <Combobox label="Product" options={productOpts} value={productOpts.find((o) => o.value === field.value) ?? null}
                onChange={(opt) => field.onChange(opt?.value ?? null)} placeholder="Interested in…" data-testid="lead-product" />
            )} />
            {!isEdit && (
              <>
                <Controller control={control} name="StatusId" render={({ field }) => (
                  <Combobox label="Status" options={statusOpts} value={statusOpts.find((o) => o.value === field.value) ?? null}
                    onChange={(opt) => field.onChange(opt?.value ?? null)} data-testid="lead-status" />
                )} />
                <Controller control={control} name="OwnerId" render={({ field }) => (
                  <Combobox label="Owner" options={ownerOpts} value={ownerOpts.find((o) => o.value === field.value) ?? null}
                    onChange={(opt) => field.onChange(opt?.value ?? null)} placeholder="Leave blank to assign later" data-testid="lead-owner" />
                )} />
                <Controller control={control} name="FirstFollowupAt" render={({ field }) => (
                  <DateField label="First follow-up" value={field.value} onChange={field.onChange} data-testid="lead-followup-date" />
                )} />
              </>
            )}
```

And below the grid, above custom fields:

```jsx
          <Controller control={control} name="Remarks" render={({ field }) => (
            <TextArea label="Remarks" value={field.value} onChange={field.onChange} onBlur={field.onBlur}
              placeholder="Anything the next person should know" data-testid="lead-remarks" />
          )} />
```

Add `TextArea` to the `components/ui` import. Owner is no longer `required` — an unassigned lead lands on the branch manager's Unassigned preset.

- [ ] **Step 4: Run to verify it passes** — `cd web && pnpm exec vitest run src/pages/Sales/LeadCreateModal.test.jsx --coverage.include='src/pages/Sales/LeadCreateModal.jsx'`. Expected: pass; ≥ 80 %.

- [ ] **Step 5: Stop and report.**

---

### Task 13: Leads list — presets, label columns, bulk reassign

**Files:**
- Modify: `web/src/pages/Sales/Leads.jsx` (rewrite)
- Modify: `web/src/pages/Sales/Leads.test.jsx` (rewrite)

**Interfaces:**
- Consumes: `fetchLeads` rows now carry `StatusName, StatusCode, ProductName, OwnerName, SourceName, BranchName, City, IsOverdue`; `LEAD_PRESETS`/`presetParams` (Task 11); `TransferLeadModal leadIds` (Task 10); `fetchBranches`, `fetchProducts`, `useLookups("lead_status"|"lead_source")`, `useUsers`.
- Produces: the page. Row click → `/sales/leads/:id` (unchanged).

- [ ] **Step 1: Failing tests** — replace `Leads.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

const FIXTURE_LEADS = [
  { Id: 101, Name: "Acme Corp", MobileNo: "9990001111", City: "Pune", StatusName: "Contacted", StatusCode: "open",
    ProductName: "TV 43in", OwnerName: "Bob", EstValue: 50000, NextFollowupDate: "2026-07-10", IsOverdue: true },
];
let rowSelection = {};
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));
vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: { data: FIXTURE_LEADS }, getState: () => ({ rowSelection }), resetRowSelection: vi.fn() },
    data: FIXTURE_LEADS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: 1,
  })),
}));
vi.mock("../../hooks", () => ({
  useUsers: vi.fn(() => ({ data: { users: [{ Id: 2, Username: "bob", FullName: "Bob" }] } })),
  useConfirmation: vi.fn(() => ({ confirmationState: { open: false }, showConfirmation: vi.fn(), hideConfirmation: vi.fn(), handleConfirm: vi.fn(), confirmDelete: vi.fn() })),
}));
vi.mock("../../hooks/useLookups", () => ({
  useLookups: vi.fn((kind) => ({
    lookups: kind === "lead_status"
      ? [{ Id: 11, Value: "New", Code: "open" }, { Id: 15, Value: "Lost", Code: "lost" }]
      : [{ Id: 5, Value: "Website" }],
  })),
}));
vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn((cfg) => {
    if (cfg?.endpoint === "/api/products/fetchProducts") return { data: { products: [{ Id: 2, Name: "TV 43in" }] } };
    if (cfg?.endpoint === "/api/users/fetchBranches") return { data: { branches: [{ Id: 2, BranchName: "Pune" }] } };
    return { data: {} };
  }),
}));
vi.mock("../../stores/useAuthStore", () => ({ __esModule: true, default: (sel) => sel({ user: { UserId: 7 }, UserId: 7 }) }));
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => <div key={row.Id} data-testid={`lead-row-${row.Id}`}>{row.Name}</div>)}
    </div>
  ),
}));
vi.mock("./TransferLeadModal", () => ({ __esModule: true, default: vi.fn(({ open, leadIds }) => (open ? <div data-testid="transfer-modal">{leadIds.join(",")}</div> : null)) }));

import Leads from "./Leads";
import useServerTable from "../../hooks/useServerTable";

const renderPage = () => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}><MemoryRouter><Leads /></MemoryRouter></QueryClientProvider></ThemeProvider>,
);
const lastExtraParams = () => useServerTable.mock.calls.at(-1)[0].extraParams;

describe("Leads page (spec 1)", () => {
  beforeEach(() => { rowSelection = {}; useServerTable.mockClear(); });

  it("renders presets and the five filters", () => {
    renderPage();
    for (const p of ["All", "My leads", "Overdue", "Unassigned", "Lost"]) expect(screen.getByRole("tab", { name: p })).toBeInTheDocument();
    for (const id of ["filter-status", "filter-product", "filter-owner", "filter-source", "filter-branch"]) expect(screen.getByTestId(`${id}-input`)).toBeInTheDocument();
    expect(lastExtraParams()).toEqual({ StatusId: null, ProductId: null, OwnerId: null, SourceId: null, BranchId: null });
  });

  it("Overdue preset sends Overdue:true; My leads sends the caller's OwnerId", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Overdue" }));
    expect(lastExtraParams()).toMatchObject({ Overdue: true });
    await user.click(screen.getByRole("tab", { name: "My leads" }));
    expect(lastExtraParams()).toMatchObject({ OwnerId: 7 });
  });

  it("status column shows the label the SP returned", () => {
    renderPage();
    const col = useServerTable.mock.calls.at(-1)[0].columns.find((c) => c.accessorKey === "StatusName");
    expect(col).toBeTruthy();
    expect(useServerTable.mock.calls.at(-1)[0].columns.some((c) => c.accessorKey === "StageId")).toBe(false);
  });

  it("shows Reassign only with a selection and hands the ids to the modal", async () => {
    rowSelection = { 101: true, 102: true };
    renderPage();
    const btn = screen.getByTestId("bulk-reassign-btn");
    expect(btn).toHaveTextContent("Reassign 2");
    await userEvent.setup().click(btn);
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("101,102");
  });

  it("hides Reassign with nothing selected", () => {
    renderPage();
    expect(screen.queryByTestId("bulk-reassign-btn")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd web && pnpm exec vitest run src/pages/Sales/Leads.test.jsx`.

- [ ] **Step 3: Rewrite `Leads.jsx`**

```jsx
// src/pages/Sales/Leads.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";
import { ArrowRightLeft, Pencil, Plus, Trash2, Users } from "lucide-react";

import { Button, Combobox, IconButton, Tooltip, Tabs, Chip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUsers } from "../../hooks";
import { useLookups } from "../../hooks/useLookups";
import useAuthStore from "../../stores/useAuthStore";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatCurrency, formatDate } from "../../utils/format";
import { getUserName } from "../../utils/userShape";
import { LEAD_PRESETS, presetParams } from "./leadStatus";
import LeadCreateModal from "./LeadCreateModal";
import TransferLeadModal from "./TransferLeadModal";
import DeleteLeadModal from "./DeleteLeadModal";

const EMPTY_FILTERS = { StatusId: "", ProductId: "", OwnerId: "", SourceId: "", BranchId: "" };
const num = (v) => (v === "" ? null : Number(v));

const Leads = () => {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.UserId ?? s.UserId);

  const [preset, setPreset] = useState("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [transferIds, setTransferIds] = useState([]);
  const [deleteLead, setDeleteLead] = useState(null);

  const setFilterValue = (key) => (opt) => setFilters((prev) => ({ ...prev, [key]: opt?.value ?? "" }));

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const { lookups: statuses } = useLookups("lead_status");
  const { lookups: sources } = useLookups("lead_source");
  const { data: productsData } = useApiQuery({ queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true } });
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });

  const opts = {
    status: useMemo(() => statuses.map((s) => ({ value: s.Id, label: s.Value })), [statuses]),
    product: useMemo(() => (productsData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })), [productsData]),
    owner: useMemo(() => (usersData?.users ?? []).map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })), [usersData]),
    source: useMemo(() => sources.map((s) => ({ value: s.Id, label: s.Value })), [sources]),
    branch: useMemo(() => (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })), [branchData]),
  };
  const optById = (list, v) => list.find((o) => o.value === v) ?? null;

  // Every label comes from the SP now; no client-side id → name resolution.
  const columns = useMemo(() => [
    { accessorKey: "Name", header: "Name", enableSorting: true },
    { accessorKey: "Company", header: "Company", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "MobileNo", header: "Mobile", enableSorting: false },
    { accessorKey: "City", header: "City", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "StatusName", header: "Status", enableSorting: false,
      Cell: ({ row }) => <Chip label={row.original.StatusName || "—"} size="sm" tone={row.original.StatusCode === "open" || row.original.StatusCode === "qualified" ? "primary" : "default"} /> },
    { accessorKey: "ProductName", header: "Product", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "OwnerName", header: "Owner", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "Unassigned" },
    { accessorKey: "EstValue", header: "Est. Value", enableSorting: true, Cell: ({ cell }) => formatCurrency(cell.getValue(), { empty: "—" }) },
    { accessorKey: "NextFollowupDate", header: "Next Follow-up", enableSorting: true,
      Cell: ({ row, cell }) => <span style={row.original.IsOverdue ? { color: "#DC2626", fontWeight: 600 } : undefined}>{formatDate(cell.getValue(), { empty: "—" })}</span> },
  ], []);

  const extraParams = useMemo(() => ({
    StatusId: num(filters.StatusId), ProductId: num(filters.ProductId), OwnerId: num(filters.OwnerId),
    SourceId: num(filters.SourceId), BranchId: num(filters.BranchId),
    ...presetParams(preset, userId),
  }), [filters, preset, userId]);

  const { table } = useServerTable({
    columns, queryKey: "leads", endpoint: SALES_ENDPOINTS.leads.fetchLeads, dataKey: "leads", extraParams,
    initialPageSize: 25, getRowId: (row) => row.Id,
    enableRowSelection: true, enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => navigate(`/sales/leads/${row.original.Id}`) }),
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="Edit"><IconButton size="sm" variant="ghost" aria-label="Edit lead" data-testid={`edit-lead-${row.original.Id}`} onClick={() => setEditLead(row.original)}><Pencil size={16} /></IconButton></Tooltip>
        <Tooltip title="Transfer"><IconButton size="sm" variant="ghost" aria-label="Transfer lead" data-testid={`transfer-lead-${row.original.Id}`} onClick={() => setTransferIds([row.original.Id])}><ArrowRightLeft size={16} /></IconButton></Tooltip>
        <Tooltip title="Delete"><IconButton size="sm" variant="ghost" aria-label="Delete lead" data-testid={`delete-lead-${row.original.Id}`} onClick={() => setDeleteLead(row.original)}><Trash2 size={16} /></IconButton></Tooltip>
      </Box>
    ),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  const selectedIds = Object.keys(table.getState?.()?.rowSelection ?? {}).map(Number);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Leads"
        subtitle="Every prospect, who holds it, and what happens next."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {selectedIds.length > 0 && (
              <Button variant="tonal" size="sm" leftIcon={<Users size={14} />} onClick={() => setTransferIds(selectedIds)} data-testid="bulk-reassign-btn">
                Reassign {selectedIds.length}
              </Button>
            )}
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)} data-testid="new-lead-btn">New Lead</Button>
            <HelpGuide guide={HELP_GUIDES.leads} />
          </Box>
        }
      />
      <Helmet><title>PRD Infotech | Leads</title></Helmet>

      <Box sx={{ mt: 1 }}><Tabs value={preset} onChange={setPreset} items={LEAD_PRESETS} data-testid="lead-presets" /></Box>

      <Box sx={{ display: "flex", gap: 1, mt: 1, mb: 0.5, flexWrap: "wrap" }}>
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All statuses" options={opts.status} value={optById(opts.status, filters.StatusId)} onChange={setFilterValue("StatusId")} data-testid="filter-status" /></Box>
        <Box sx={{ width: 180 }}><Combobox size="sm" placeholder="All products" options={opts.product} value={optById(opts.product, filters.ProductId)} onChange={setFilterValue("ProductId")} data-testid="filter-product" /></Box>
        <Box sx={{ width: 180 }}><Combobox size="sm" placeholder="All owners" options={opts.owner} value={optById(opts.owner, filters.OwnerId)} onChange={setFilterValue("OwnerId")} data-testid="filter-owner" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All sources" options={opts.source} value={optById(opts.source, filters.SourceId)} onChange={setFilterValue("SourceId")} data-testid="filter-source" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All branches" options={opts.branch} value={optById(opts.branch, filters.BranchId)} onChange={setFilterValue("BranchId")} data-testid="filter-branch" /></Box>
      </Box>

      <Box sx={{ width: "100%", overflowX: "auto" }}><MaterialReactTable table={table} /></Box>

      <LeadCreateModal open={createOpen || Boolean(editLead)} lead={editLead} onClose={() => { setCreateOpen(false); setEditLead(null); }} />
      {/* canCrossBranch is always on here: the server (assertCanAssign) is the
          gate and answers a Team/Self caller with a clear 403. The prop exists
          so spec 2 can hide the picker once DataScope reaches the client. */}
      <TransferLeadModal open={transferIds.length > 0} leadIds={transferIds} canCrossBranch onClose={() => setTransferIds([])} onTransferred={() => table.resetRowSelection?.()} />
      <DeleteLeadModal open={Boolean(deleteLead)} leadId={deleteLead?.Id} leadName={deleteLead?.Name} onClose={() => setDeleteLead(null)} />
    </Box>
  );
};

export default Leads;
```

If `Tabs` renders items without `role="tab"`, change the test's `getByRole("tab", …)` to `getByText(…)`; check `components/ui/Tabs.jsx` first.

- [ ] **Step 4: Run to verify it passes** — `cd web && pnpm exec vitest run src/pages/Sales/Leads.test.jsx --coverage.include='src/pages/Sales/Leads.jsx'`. Expected: 5 passed; ≥ 80 %.

- [ ] **Step 5: Stop and report.**

---

### Task 14: Lead detail — status dropdown, follow-ups, history

**Files:**
- Modify: `web/src/pages/Sales/LeadDetail.jsx` (rewrite)
- Modify: `web/src/pages/Sales/LeadDetail.test.jsx` (rewrite)

**Interfaces:**
- Consumes: `fetchLeadDetail` → `{ lead, fields, activity, followups, assignments }` with the labels from `071`; `setLeadStatus`, `scheduleFollowUp`; `LogFollowUpModal`, `TransferLeadModal`, `LeadCreateModal`, `Timeline` (unchanged, `calls` prop no longer passed).

- [ ] **Step 1: Failing tests** — replace `LeadDetail.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Routes, Route } from "react-router-dom";

import LeadDetail from "./LeadDetail";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

vi.mock("./LogFollowUpModal", () => ({ __esModule: true, default: ({ open, followUp }) => (open ? <div data-testid="log-modal">{followUp?.Id}</div> : null) }));
vi.mock("./TransferLeadModal", () => ({ __esModule: true, default: ({ open, leadIds }) => (open ? <div data-testid="transfer-modal">{leadIds.join(",")}</div> : null) }));
vi.mock("./LeadCreateModal", () => ({ __esModule: true, default: () => null }));

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const LEAD = { Id: 9, Name: "Sharma", Company: "Sharma Traders", MobileNo: "98200", City: "Pune", State: "MH", Pincode: "411001",
  StatusId: 12, StatusName: "Contacted", StatusCode: "open", ProductName: "TV 43in", OwnerName: "Bob", SourceName: "Website",
  EstValue: 50000, Remarks: "Walk-in", NextFollowupDate: "2026-09-10", BranchName: "Pune", OwnerId: 2, CreatedBy: 2 };
const DETAIL = {
  lead: LEAD, fields: [],
  activity: [{ Id: 1, Type: "created", Summary: "Lead created", CreatedAt: "2026-09-01T10:00:00Z" }],
  followups: [{ Id: 21, Type: "call", DueAt: "2026-09-10T00:00:00Z", Status: "open", AssignedToName: "Bob" },
              { Id: 20, Type: "call", DueAt: "2026-09-08T00:00:00Z", Status: "done", DoneByName: "Bob", Outcome: "Connected", Remarks: "Wants a quote", DoneAt: "2026-09-08T11:00:00Z" }],
  assignments: [{ Id: 31, FromUserName: null, ToUserName: "Bob", Reason: null, Remarks: "Assigned on creation", AssignedByName: "Alice", AssignedAt: "2026-09-01T10:00:00Z" }],
};

const mocks = (cap = {}) => server.use(
  http.post("*/api/leads/fetchLeadDetail", async () => json(DETAIL)),
  http.post("*/api/config/fetchCustomFields", async () => json({ customFields: [] })),
  http.post("*/api/config/fetchLookups", async ({ request }) => {
    const { Kind } = await request.json();
    return json({ lookups: Kind === "lead_status"
      ? [{ Id: 11, Value: "New", Code: "open" }, { Id: 12, Value: "Contacted", Code: "open" }, { Id: 15, Value: "Lost", Code: "lost" }]
      : [{ Id: 1, Value: "Price" }] });
  }),
  http.post("*/api/leads/setLeadStatus", async ({ request }) => { cap.status = await request.json(); return json({ Id: 9, ResponseCode: 200 }); }),
);

const renderDetail = () => renderWithProviders(
  <Routes><Route path="/sales/leads/:leadId" element={<LeadDetail />} /></Routes>, { route: "/sales/leads/9" },
);

describe("LeadDetail (spec 1)", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" }));

  it("shows the labels the SP returned, no client-side lookups", async () => {
    mocks();
    renderDetail();
    expect(await screen.findByTestId("lead-detail")).toBeInTheDocument();
    expect(screen.getByTestId("lead-status-chip")).toHaveTextContent("Contacted");
    expect(screen.getByText("TV 43in")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/411001/)).toBeInTheDocument();
  });

  it("changing status to a non-lost value posts setLeadStatus immediately", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "New" }));
    await waitFor(() => expect(cap.status).toEqual({ LeadId: 9, StatusId: 11, LostReasonId: null }));
  });

  it("Lost prompts for a reason before posting", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lead-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "Lost" }));
    expect(cap.status).toBeUndefined();
    await user.click(screen.getByTestId("lost-reason-input"));
    await user.click(await screen.findByRole("option", { name: "Price" }));
    await user.click(screen.getByTestId("lost-reason-submit"));
    await waitFor(() => expect(cap.status).toEqual({ LeadId: 9, StatusId: 15, LostReasonId: 1 }));
  });

  it("follow-ups tab lists open above done and Log opens the modal for the open one", async () => {
    mocks();
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByText(/Follow-ups/));   // the tab label carries a badge
    const items = screen.getAllByTestId("followup-item");
    expect(items[0]).toHaveTextContent("Open");
    expect(items[1]).toHaveTextContent("Wants a quote");
    await user.click(screen.getByTestId("log-followup-21"));
    expect(screen.getByTestId("log-modal")).toHaveTextContent("21");
  });

  it("history tab shows the assignment trail and Transfer opens the modal", async () => {
    mocks();
    renderDetail();
    await screen.findByTestId("lead-detail");
    const user = userEvent.setup();
    await user.click(screen.getByText(/History/));
    expect(screen.getByText(/Assigned on creation/)).toBeInTheDocument();
    await user.click(screen.getByTestId("transfer-lead-btn"));
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("9");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd web && pnpm exec vitest run src/pages/Sales/LeadDetail.test.jsx`.

- [ ] **Step 3: Rewrite `LeadDetail.jsx`** — keep `fieldValue`, `InfoItem`, the custom-fields draft/save block and the Attachments card exactly as they are; replace everything else:

```jsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { ArrowRightLeft, CalendarPlus, Pencil, Save as SaveIcon } from "lucide-react";
import dayjs from "dayjs";

import { PageHeader, Card, Chip, Button, Tabs, EmptyState, Skeleton, Combobox, Modal, DateField } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { FOLLOWUP_TYPES } from "./leadStatus";
import Timeline from "./Timeline";
import LogFollowUpModal from "./LogFollowUpModal";
import TransferLeadModal from "./TransferLeadModal";
import LeadCreateModal from "./LeadCreateModal";

// … fieldValue + InfoItem unchanged …

const fmt = (d, f = "DD-MM-YYYY") => (d ? dayjs(d).format(f) : null);

export default function LeadDetail({ leadId: leadIdProp }) {
  const { leadId: leadIdParam } = useParams();
  const leadId = Number(leadIdProp ?? leadIdParam);

  const [tab, setTab] = useState("details");
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [logging, setLogging] = useState(null);          // follow-up row being completed
  const [lostPick, setLostPick] = useState(null);        // status option awaiting a reason
  const [lostReason, setLostReason] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleType, setScheduleType] = useState(FOLLOWUP_TYPES[0]);
  const [scheduleDate, setScheduleDate] = useState("");
  const [draft, setDraft] = useState({});

  const { data, isLoading, refetch } = useApiQuery({
    queryKey: ["lead-detail", leadId], endpoint: SALES_ENDPOINTS.leads.fetchLeadDetail,
    params: { LeadId: leadId }, enabled: Boolean(leadId), showErrorMessage: false,
  });
  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "lead"], endpoint: SALES_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "lead" }, showErrorMessage: false,
  });
  const { lookups: statuses } = useLookups("lead_status", { showErrorMessage: false });
  const { lookups: lostReasons } = useLookups("lost_reason", { enabled: Boolean(lostPick), showErrorMessage: false });

  const lead = data?.lead ?? null;
  const activity = data?.activity ?? [];
  const followups = data?.followups ?? [];
  const assignments = data?.assignments ?? [];
  const openFollowups = followups.filter((f) => f.Status === "open");

  const statusOpts = useMemo(() => statuses.map((s) => ({ value: s.Id, label: s.Value, code: s.Code })), [statuses]);
  const lostOpts = useMemo(() => lostReasons.map((r) => ({ value: r.Id, label: r.Value })), [lostReasons]);

  // … fields memo + draft effect + isDirty + saveMutation + saveCustomFields unchanged …

  const statusMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.leads.setLeadStatus, successMessage: "Status updated", invalidateQueries: [["lead-detail", leadId], ["leads"]] });
  const scheduleMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.followups.scheduleFollowUp, successMessage: "Follow-up scheduled", invalidateQueries: [["lead-detail", leadId], ["followups"], ["leads"]] });

  // Lost needs a reason — the SP refuses without one, so ask before posting.
  const onStatusPick = (opt) => {
    if (!opt || opt.value === lead?.StatusId) return;
    if (opt.code === "lost") { setLostPick(opt); setLostReason(null); return; }
    statusMutation.mutate({ LeadId: leadId, StatusId: opt.value, LostReasonId: null });
  };
  const submitLost = async () => {
    if (!lostPick || !lostReason) return;
    await statusMutation.mutateAsync({ LeadId: leadId, StatusId: lostPick.value, LostReasonId: lostReason.value });
    setLostPick(null);
  };
  const submitSchedule = async () => {
    if (!scheduleDate) return;
    await scheduleMutation.mutateAsync({ LeadId: leadId, Type: scheduleType.value, DueAt: scheduleDate });
    setScheduleOpen(false); setScheduleDate("");
  };

  if (isLoading || !lead) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="lead-detail-loading">
      <Skeleton variant="text" height={28} width={240} /><Skeleton variant="rect" height={160} />
    </div>
  );

  const address = [lead.Address, lead.City, lead.State, lead.Pincode].filter(Boolean).join(", ");

  return (
    <div data-testid="lead-detail">
      <PageHeader
        title={lead.Name}
        subtitle={[lead.Company, lead.MobileNo, lead.Email].filter(Boolean).join(" · ")}
        titleSuffix={<Chip label={lead.StatusName || "—"} tone="primary" size="sm" data-testid="lead-status-chip" />}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ width: 180 }}>
              <Combobox size="sm" options={statusOpts} value={statusOpts.find((o) => o.value === lead.StatusId) ?? null} onChange={onStatusPick} placeholder="Status" data-testid="lead-status-select" />
            </div>
            <Button variant="tonal" leftIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)} data-testid="edit-lead-btn">Edit</Button>
            <Button variant="tonal" leftIcon={<ArrowRightLeft size={14} />} onClick={() => setTransferOpen(true)} data-testid="transfer-lead-btn">Transfer</Button>
            {openFollowups[0]
              ? <Button variant="primary" onClick={() => setLogging(openFollowups[0])} data-testid="log-followup-btn">Log follow-up</Button>
              : <Button variant="primary" leftIcon={<CalendarPlus size={14} />} onClick={() => setScheduleOpen(true)} data-testid="schedule-followup-btn">Schedule follow-up</Button>}
          </div>
        }
      />

      <Tabs value={tab} onChange={setTab} data-testid="lead-detail-tabs" items={[
        { value: "details", label: "Details" },
        { value: "followups", label: "Follow-ups", badge: openFollowups.length },
        { value: "history", label: "History", badge: activity.length },
      ]} />

      <div style={{ marginTop: 20 }}>
        {tab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card data-testid="lead-core-info">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                <InfoItem label="Mobile" value={lead.MobileNo} />
                <InfoItem label="Alternate" value={lead.AltMobile} />
                <InfoItem label="Email" value={lead.Email} />
                <InfoItem label="Product" value={lead.ProductName} />
                <InfoItem label="Estimated value" value={lead.EstValue} />
                <InfoItem label="Owner" value={lead.OwnerName || "Unassigned"} />
                <InfoItem label="Branch" value={lead.BranchName} />
                <InfoItem label="Source" value={lead.SourceName} />
                <InfoItem label="Next follow-up" value={fmt(lead.NextFollowupDate)} />
                <InfoItem label="Assigned since" value={fmt(lead.AssignedAt)} />
                {Boolean(lead.LostReason) && <InfoItem label="Lost reason" value={lead.LostReason} />}
              </div>
              {(address || lead.Remarks) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
                  <InfoItem label="Address" value={address} />
                  <InfoItem label="Remarks" value={lead.Remarks} />
                </div>
              )}
            </Card>
            {/* … custom fields Card + Attachments Card unchanged … */}
          </div>
        )}

        {tab === "followups" && (
          <div data-testid="lead-followups" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {followups.length === 0 && <EmptyState title="No follow-ups" description="Schedule one from the header." size="sm" data-testid="followups-empty" />}
            {followups.map((f) => (
              <Card key={f.Id} data-testid="followup-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {FOLLOWUP_TYPES.find((t) => t.value === f.Type)?.label ?? f.Type} · {f.Status === "open" ? `due ${fmt(f.DueAt)}` : `${f.Status} ${fmt(f.DoneAt, "DD-MM-YYYY HH:mm")} by ${f.DoneByName ?? "—"}`}
                      {f.IsOverdue ? " · overdue" : ""}
                    </div>
                    {(f.Outcome || f.Remarks) && <div style={{ fontSize: 13, marginTop: 2 }}>{[f.Outcome, f.Remarks].filter(Boolean).join(" — ")}</div>}
                    {f.Status === "open" && f.AssignedToName && <div style={{ fontSize: 12, marginTop: 2 }}>Assigned to {f.AssignedToName}</div>}
                  </div>
                  {f.Status === "open"
                    ? <Button size="sm" variant="primary" onClick={() => setLogging(f)} data-testid={`log-followup-${f.Id}`}>Log</Button>
                    : <Chip label={f.Status === "done" ? "Done" : "Skipped"} size="sm" />}
                  {f.Status === "open" && <Chip label="Open" size="sm" tone="primary" />}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Assignments</h3>
              {assignments.length === 0 ? <div style={{ fontSize: 13 }}>Never assigned.</div> : assignments.map((a) => (
                <div key={a.Id} data-testid="assignment-item" style={{ fontSize: 13, padding: "6px 0" }}>
                  <strong>{fmt(a.AssignedAt, "DD-MM-YYYY HH:mm")}</strong> · {a.FromUserName ?? "Unassigned"} → {a.ToUserName ?? "Unassigned"}
                  {a.ToBranchName && a.FromBranchName !== a.ToBranchName ? ` (${a.ToBranchName})` : ""}
                  {a.Reason ? ` · ${a.Reason}` : ""} — {a.Remarks} <em>by {a.AssignedByName}</em>
                </div>
              ))}
            </Card>
            <Timeline activity={activity} />
          </div>
        )}
      </div>

      <Modal open={Boolean(lostPick)} onClose={() => setLostPick(null)} size="sm" data-testid="lost-reason-modal">
        <Modal.Header title="Why was this lead lost?" onClose={() => setLostPick(null)} />
        <Modal.Body><Combobox label="Reason" required options={lostOpts} value={lostReason} onChange={setLostReason} data-testid="lost-reason" /></Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setLostPick(null)}>Cancel</Button>
          <Button variant="primary" onClick={submitLost} disabled={!lostReason} loading={statusMutation.isPending} data-testid="lost-reason-submit">Mark lost</Button>
        </Modal.Footer>
      </Modal>

      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} size="sm" data-testid="schedule-modal">
        <Modal.Header title="Schedule follow-up" onClose={() => setScheduleOpen(false)} />
        <Modal.Body>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Combobox label="Type" options={FOLLOWUP_TYPES} value={scheduleType} onChange={setScheduleType} data-testid="schedule-type" />
            <DateField label="Due" required value={scheduleDate} onChange={setScheduleDate} data-testid="schedule-date" />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={submitSchedule} disabled={!scheduleDate} loading={scheduleMutation.isPending} data-testid="schedule-submit">Schedule</Button>
        </Modal.Footer>
      </Modal>

      <LogFollowUpModal open={Boolean(logging)} followUp={logging} onClose={() => setLogging(null)} onLogged={refetch} />
      <TransferLeadModal open={transferOpen} leadIds={[leadId]} canCrossBranch onClose={() => setTransferOpen(false)} onTransferred={refetch} />
      <LeadCreateModal open={editOpen} lead={lead} onClose={() => setEditOpen(false)} onSaved={refetch} />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `cd web && pnpm exec vitest run src/pages/Sales/LeadDetail.test.jsx --coverage.include='src/pages/Sales/LeadDetail.jsx'`. Expected: 5 passed; ≥ 80 %.

- [ ] **Step 5: Stop and report.**

---

### Task 15: Follow-ups queue — Today / Overdue / Upcoming

**Files:**
- Modify: `web/src/pages/Sales/FollowUps.jsx` (rewrite)
- Modify: `web/src/pages/Sales/FollowUps.test.jsx` (rewrite)

**Interfaces:**
- Consumes: `fetchFollowups` queue mode (Task 6) rows carry `LeadName, LeadMobile, OwnerName, AssignedToName, Type, DueAt, Status, IsOverdue, Outcome, Remarks`; `skipFollowUp`, `deleteFollowup`; `LogFollowUpModal`.

- [ ] **Step 1: Failing tests** — replace `FollowUps.test.jsx` (same mocking shape as the Leads test: mock `useServerTable`, `material-react-table`, `./LogFollowUpModal`; stub `apiClient.post` like `Users.test.jsx`):

```jsx
// fixtures
const ROWS = [
  { Id: 21, LeadId: 9, LeadName: "Sharma", Type: "call", DueAt: "2026-09-01T00:00:00Z", Status: "open", AssignedToName: "Bob", IsOverdue: true },
  { Id: 20, LeadId: 9, LeadName: "Sharma", Type: "visit", DueAt: "2026-08-30T00:00:00Z", Status: "done", Outcome: "Connected", Remarks: "ok" },
];
const lastExtraParams = () => useServerTable.mock.calls.at(-1)[0].extraParams;

it("defaults to Today and maps the three tabs onto fetch params", async () => {
  renderPage();
  const today = dayjs().format("YYYY-MM-DD");
  expect(lastExtraParams()).toEqual({ LeadId: 0, Status: "open", DueFrom: today, DueTo: today });
  const user = userEvent.setup();
  await user.click(screen.getByText("Overdue"));
  expect(lastExtraParams()).toEqual({ LeadId: 0, Overdue: true });
  await user.click(screen.getByText("Upcoming"));
  expect(lastExtraParams()).toEqual({ LeadId: 0, Status: "open", DueFrom: dayjs().add(1, "day").format("YYYY-MM-DD") });
  await user.click(screen.getByText("All"));
  expect(lastExtraParams()).toEqual({ LeadId: 0 });
});

it("Log opens the modal for an open row; done rows have no Log/Skip/Delete", async () => {
  renderPage();
  const user = userEvent.setup();
  await user.click(screen.getByTestId("log-followup-21"));
  expect(screen.getByTestId("log-modal")).toHaveTextContent("21");
  expect(screen.queryByTestId("log-followup-20")).toBeNull();
  expect(screen.queryByTestId("skip-followup-20")).toBeNull();
});

it("Skip requires remarks and posts skipFollowUp", async () => {
  renderPage();
  const user = userEvent.setup();
  await user.click(screen.getByTestId("skip-followup-21"));
  expect(screen.getByTestId("skip-submit")).toBeDisabled();
  await user.type(screen.getByTestId("skip-remarks"), "Customer travelling");
  await user.click(screen.getByTestId("skip-submit"));
  await waitFor(() => expect(post).toHaveBeenCalledWith("/api/followups/skipFollowUp", { Id: 21, Remarks: "Customer travelling" }));
});
```

(`renderPage` renders `<FollowUps />` inside the theme + QueryClient + MemoryRouter exactly as `Leads.test.jsx` does; the `useServerTable` mock returns `ROWS`; `post` is the stubbed `apiClient.post` resolving `{ data: { success: true, data: {} } }`.)

- [ ] **Step 2: Run to verify it fails** — `cd web && pnpm exec vitest run src/pages/Sales/FollowUps.test.jsx`.

- [ ] **Step 3: Rewrite `FollowUps.jsx`**

```jsx
// src/pages/Sales/FollowUps.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, SkipForward, Trash2 } from "lucide-react";
import dayjs from "dayjs";

import { Button, IconButton, Modal, TextArea, Tooltip, Tabs, Chip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatDate } from "../../utils/format";
import { FOLLOWUP_TYPES } from "./leadStatus";
import LogFollowUpModal from "./LogFollowUpModal";

const VIEWS = [
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All" },
];
const viewParams = (view) => {
  const today = dayjs().format("YYYY-MM-DD");
  switch (view) {
    case "today": return { LeadId: 0, Status: "open", DueFrom: today, DueTo: today };
    case "overdue": return { LeadId: 0, Overdue: true };
    case "upcoming": return { LeadId: 0, Status: "open", DueFrom: dayjs().add(1, "day").format("YYYY-MM-DD") };
    default: return { LeadId: 0 };
  }
};
const typeLabel = (t) => FOLLOWUP_TYPES.find((x) => x.value === t)?.label ?? t;

const FollowUps = () => {
  const navigate = useNavigate();
  const [view, setView] = useState("today");
  const [logging, setLogging] = useState(null);
  const [skipping, setSkipping] = useState(null);
  const [skipRemarks, setSkipRemarks] = useState("");
  const [deleting, setDeleting] = useState(null);

  const skipMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.followups.skipFollowUp, successMessage: "Follow-up skipped", invalidateQueries: [["followups"], ["leads"]] });
  const deleteMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.followups.deleteFollowup, successMessage: "Follow-up deleted", invalidateQueries: [["followups"], ["leads"]] });

  const submitSkip = async () => {
    if (!skipping || !skipRemarks.trim()) return;
    await skipMutation.mutateAsync({ Id: skipping.Id, Remarks: skipRemarks.trim() });
    setSkipping(null); setSkipRemarks("");
  };
  const submitDelete = async () => {
    if (!deleting) return;
    await deleteMutation.mutateAsync({ Id: deleting.Id });
    setDeleting(null);
  };

  const columns = useMemo(() => [
    { accessorKey: "LeadName", header: "Lead", enableSorting: false, Cell: ({ row }) => <span>{row.original.LeadName}{row.original.LeadMobile ? ` · ${row.original.LeadMobile}` : ""}</span> },
    { accessorKey: "DueAt", header: "Due", enableSorting: true, Cell: ({ row, cell }) => <span style={row.original.IsOverdue ? { color: "#DC2626", fontWeight: 600 } : undefined}>{formatDate(cell.getValue(), { empty: "—" })}</span> },
    { accessorKey: "Type", header: "Type", enableSorting: false, Cell: ({ cell }) => typeLabel(cell.getValue()) },
    { accessorKey: "AssignedToName", header: "Assigned to", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "Status", header: "Status", enableSorting: false, Cell: ({ cell }) => <Chip label={cell.getValue()} size="sm" tone={cell.getValue() === "open" ? "primary" : "default"} /> },
    { accessorKey: "Remarks", header: "Outcome / remarks", enableSorting: false, Cell: ({ row }) => [row.original.Outcome, row.original.Remarks].filter(Boolean).join(" — ") || "—" },
  ], []);

  const extraParams = useMemo(() => viewParams(view), [view]);

  const { table } = useServerTable({
    columns, queryKey: "followups", endpoint: SALES_ENDPOINTS.followups.fetchFollowups, dataKey: "followups", extraParams,
    initialPageSize: 25, getRowId: (row) => row.Id, enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => navigate(`/sales/leads/${row.original.LeadId}`) }),
    renderRowActions: ({ row }) => {
      const f = row.original;
      if (f.Status !== "open") return null;
      return (
        <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="Log"><IconButton size="sm" variant="ghost" aria-label="Log follow-up" data-testid={`log-followup-${f.Id}`} onClick={() => setLogging(f)}><CheckCircle2 size={16} /></IconButton></Tooltip>
          <Tooltip title="Skip"><IconButton size="sm" variant="ghost" aria-label="Skip follow-up" data-testid={`skip-followup-${f.Id}`} onClick={() => setSkipping(f)}><SkipForward size={16} /></IconButton></Tooltip>
          <Tooltip title="Delete"><IconButton size="sm" variant="ghost" aria-label="Delete follow-up" data-testid={`delete-followup-${f.Id}`} onClick={() => setDeleting(f)}><Trash2 size={16} /></IconButton></Tooltip>
        </Box>
      );
    },
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Follow-ups" subtitle="What is due, what is late, what is next — across every lead you can see." actions={<HelpGuide guide={HELP_GUIDES.followups} />} />
      <Helmet><title>PRD Infotech | Follow-ups</title></Helmet>
      <Box sx={{ mt: 1 }}><Tabs value={view} onChange={setView} items={VIEWS} data-testid="followup-views" /></Box>
      <Box sx={{ width: "100%", overflowX: "auto", mt: 1 }}><MaterialReactTable table={table} /></Box>

      <LogFollowUpModal open={Boolean(logging)} followUp={logging} onClose={() => setLogging(null)} />

      <Modal open={Boolean(skipping)} onClose={() => setSkipping(null)} size="sm" data-testid="skip-modal">
        <Modal.Header title="Skip follow-up" icon={<SkipForward size={18} />} onClose={() => setSkipping(null)} />
        <Modal.Body><TextArea label="Why?" required value={skipRemarks} onChange={(e) => setSkipRemarks(e.target.value)} data-testid="skip-remarks" /></Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setSkipping(null)}>Cancel</Button>
          <Button variant="primary" onClick={submitSkip} disabled={!skipRemarks.trim()} loading={skipMutation.isPending} data-testid="skip-submit">Skip</Button>
        </Modal.Footer>
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} size="sm" data-testid="delete-followup-modal">
        <Modal.Header title="Delete follow-up?" icon={<Trash2 size={18} />} onClose={() => setDeleting(null)} />
        <Modal.Body><div style={{ fontSize: 14 }}>Removes the open follow-up due {formatDate(deleting?.DueAt, { empty: "—" })}. Logged ones are history and cannot be deleted.</div></Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" onClick={submitDelete} loading={deleteMutation.isPending} data-testid="delete-followup-confirm">Delete</Button>
        </Modal.Footer>
      </Modal>
    </Box>
  );
};

export default FollowUps;
```

- [ ] **Step 4: Run to verify it passes** — `cd web && pnpm exec vitest run src/pages/Sales/FollowUps.test.jsx --coverage.include='src/pages/Sales/FollowUps.jsx'`. Expected: ≥ 80 %.

- [ ] **Step 5: Stop and report.**

---

### Task 16: Settings — Products page, `Code` on lead statuses

**Files:**
- Create: `web/src/pages/Settings/Products.jsx` (replaces the Task 9 stub) + `Products.test.jsx`
- Modify: `web/src/pages/Settings/LookupMaster.jsx` + `LookupMaster.test.jsx`

**Interfaces:**
- Consumes: `fetchProducts` `{ products, pagination }`; `saveProduct` `{ Id, Name, Code, CategoryId, UnitPrice, MarginPct, IsActive }`; `deleteProduct { Id }`; `useLookups("product_category")`; `saveLookup` `+Code`.

- [ ] **Step 1: Failing tests**

`Products.test.jsx` — same scaffolding as `Users.test.jsx` (mock `useServerTable`, `material-react-table`, `../../hooks` for `useConfirmation`, stub `apiClient.post`; mock `../../hooks/useLookups` to return `[{ Id: 12, Value: "Electronics" }]`):

```jsx
it("wires the table to fetchProducts with IsActive:null (admin sees inactive too)", () => {
  renderPage();
  const cfg = useServerTable.mock.calls.at(-1)[0];
  expect(cfg.endpoint).toBe("/api/products/fetchProducts");
  expect(cfg.dataKey).toBe("products");
  expect(cfg.extraParams).toEqual({ IsActive: null });
});

it("creates a product with numeric price and margin", async () => {
  post.mockResolvedValue({ data: { success: true, data: { Id: 3 } } });
  renderPage();
  const user = userEvent.setup();
  await user.click(screen.getByTestId("new-product-btn"));
  await user.type(screen.getByLabelText(/^Name/), "TV 43in");
  await user.type(screen.getByLabelText(/Code/), "TV43");
  await user.selectOptions(screen.getByLabelText(/Category/), "12");
  await user.type(screen.getByLabelText(/Unit price/), "45000");
  await user.type(screen.getByLabelText(/Margin/), "10");
  await user.click(screen.getByText("Create Product"));
  await waitFor(() => expect(post).toHaveBeenCalledWith("/api/products/saveProduct", {
    Id: 0, Name: "TV 43in", Code: "TV43", CategoryId: 12, UnitPrice: 45000, MarginPct: 10, IsActive: true,
  }));
});

it("rejects a margin over 100 before posting", async () => {
  renderPage();
  const user = userEvent.setup();
  await user.click(screen.getByTestId("new-product-btn"));
  await user.type(screen.getByLabelText(/^Name/), "X");
  await user.type(screen.getByLabelText(/Margin/), "150");
  await user.click(screen.getByText("Create Product"));
  expect(screen.getByText(/between 0 and 100/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
```

`LookupMaster.test.jsx` — append:

```jsx
it("shows a Code select for lead_status and sends it", async () => {
  // render with kinds=[{ value: "lead_status", label: "Lead Statuses" }]
  const user = userEvent.setup();
  await user.click(screen.getByText("New Status"));
  await user.type(screen.getByLabelText(/Value/), "Warm");
  await user.selectOptions(screen.getByLabelText(/Code/), "qualified");
  await user.click(screen.getByText("Create Status"));
  await waitFor(() => expect(post).toHaveBeenCalledWith("/api/config/saveLookup", { Id: 0, Kind: "lead_status", Value: "Warm", SortOrder: 0, Code: "qualified" }));
});

it("has no Code select for other kinds and omits it", async () => {
  // render with kinds=[{ value: "lead_source", label: "Lead Sources" }]
  expect(screen.queryByLabelText(/Code/)).toBeNull();
});
```

(Adapt these to how the existing `LookupMaster.test.jsx` renders and stubs — reuse its `renderMaster`/`post` helpers; the `noun` for the lead-status render is `"Status"`.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: `Products.jsx`**

```jsx
// src/pages/Settings/Products.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Chip as MuiChip } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/ui/PageHeader";
import { Button, IconButton, Tooltip } from "../../components/ui";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import { FormModal, FormContainer, FormRow, FormInput, FormNumberInput, FormSelect, FormCheckbox, FormButtons } from "../../components/Design/FormComponents";
import useServerTable from "../../hooks/useServerTable";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { useConfirmation } from "../../hooks";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatCurrency } from "../../utils/format";

const EMPTY = { Name: "", Code: "", CategoryId: "", UnitPrice: "", MarginPct: "", IsActive: true };
const toForm = (p) => ({ Name: p.Name ?? "", Code: p.Code ?? "", CategoryId: p.CategoryId ? String(p.CategoryId) : "", UnitPrice: p.UnitPrice == null ? "" : String(p.UnitPrice), MarginPct: p.MarginPct == null ? "" : String(p.MarginPct), IsActive: Boolean(p.IsActive) });
const errorText = (error, fallback) => (error.isAxiosError ? error.response?.data?.message || fallback : error.message);

export default function Products() {
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});

  const { lookups: categories } = useLookups("product_category", { showErrorMessage: false });
  const categoryOptions = categories.map((c) => ({ value: String(c.Id), label: c.Value }));

  const columns = useMemo(() => [
    { accessorKey: "Name", header: "Name" },
    { accessorKey: "Code", header: "Code", Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "CategoryName", header: "Category", Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "UnitPrice", header: "Unit price", Cell: ({ cell }) => formatCurrency(cell.getValue(), { empty: "—" }) },
    { accessorKey: "MarginPct", header: "Margin %", Cell: ({ cell }) => (cell.getValue() == null ? "—" : `${cell.getValue()}%`) },
    { accessorKey: "IsActive", header: "Status", Cell: ({ cell }) => <MuiChip label={cell.getValue() ? "Active" : "Inactive"} color={cell.getValue() ? "success" : "default"} size="small" /> },
  ], []);

  const { table, refetch } = useServerTable({
    columns, queryKey: "products", endpoint: SALES_ENDPOINTS.products.fetchProducts, dataKey: "products",
    extraParams: { IsActive: null }, getRowId: (row) => row.Id, enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { size: 80, grow: false, header: "Actions" } },
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Tooltip title="Edit"><IconButton size="sm" variant="ghost" aria-label="Edit product" onClick={() => { setEditing(row.original); setForm(toForm(row.original)); setErrors({}); setOpen(true); }}><Pencil size={16} /></IconButton></Tooltip>
        <Tooltip title="Delete"><IconButton size="sm" variant="ghost" aria-label="Delete product" onClick={() => confirmation.confirmDelete({ title: "Delete Product", message: `Delete "${row.original.Name}"? Leads keep their reference; it just leaves the pick-list.`, confirmText: "Delete Product", onConfirm: () => deleteMutation.mutateAsync({ Id: row.original.Id }) })}><Trash2 size={16} /></IconButton></Tooltip>
      </Box>
    ),
  });

  const saveMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.products.saveProduct, successMessage: `Product ${editing ? "updated" : "created"}`, invalidateQueries: [["products"]], showErrorMessage: false,
    onSuccess: () => { setOpen(false); setEditing(null); refetch?.(); }, onError: (e) => enqueueSnackbar(errorText(e, "Failed to save product"), { variant: "error" }) });
  const deleteMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.products.deleteProduct, successMessage: "Product deleted", invalidateQueries: [["products"]], showErrorMessage: false,
    onError: (e) => enqueueSnackbar(errorText(e, "Failed to delete product"), { variant: "error" }) });

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e?.target?.type === "checkbox" ? e.target.checked : e.target.value })); if (errors[k]) setErrors((x) => ({ ...x, [k]: "" })); };
  const validate = () => {
    const next = {};
    if (!form.Name.trim()) next.Name = "Name is required";
    const m = form.MarginPct === "" ? null : Number(form.MarginPct);
    if (m != null && (Number.isNaN(m) || m < 0 || m > 100)) next.MarginPct = "Margin must be between 0 and 100";
    if (form.UnitPrice !== "" && Number(form.UnitPrice) < 0) next.UnitPrice = "Price cannot be negative";
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  const submit = () => {
    if (!validate()) return;
    saveMutation.mutate({
      Id: editing?.Id ?? 0, Name: form.Name.trim(), Code: form.Code.trim() || null,
      CategoryId: form.CategoryId ? Number(form.CategoryId) : null,
      UnitPrice: form.UnitPrice === "" ? null : Number(form.UnitPrice),
      MarginPct: form.MarginPct === "" ? null : Number(form.MarginPct),
      IsActive: Boolean(form.IsActive),
    });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Products" subtitle="What you sell, at what price, and the margin reports count as profit."
        actions={<Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => { setEditing(null); setForm(EMPTY); setErrors({}); setOpen(true); }} data-testid="new-product-btn">New Product</Button>} />
      <Helmet><title>PRD Infotech | Products</title></Helmet>
      <Box sx={{ mt: 1.5, width: "100%", overflowX: "auto" }}><MaterialReactTable table={table} /></Box>

      <FormModal open={open} title={`${editing ? "Edit" : "Create"} Product`} maxWidth="max-w-2xl" onClose={() => setOpen(false)}>
        <div className="p-6">
          <FormContainer spacing="space-y-4">
            <FormRow columns={2}>
              <FormInput label="Name" value={form.Name} onChange={set("Name")} error={errors.Name} required />
              <FormInput label="Code" value={form.Code} onChange={set("Code")} placeholder="SKU / short code" />
            </FormRow>
            <FormRow columns={1}>
              <FormSelect label="Category" value={form.CategoryId} onChange={set("CategoryId")} options={categoryOptions} placeholder="Select a category" />
            </FormRow>
            <FormRow columns={2}>
              <FormNumberInput label="Unit price" value={form.UnitPrice} onChange={set("UnitPrice")} error={errors.UnitPrice} />
              <FormNumberInput label="Margin %" value={form.MarginPct} onChange={set("MarginPct")} error={errors.MarginPct} placeholder="Profit % reports use" />
            </FormRow>
            <FormRow columns={1}>
              <FormCheckbox label="Active" checked={form.IsActive} onChange={set("IsActive")} />
            </FormRow>
          </FormContainer>
        </div>
        <FormButtons onCancel={() => setOpen(false)} onSubmit={submit} submitText={`${editing ? "Update" : "Create"} Product`} isLoading={saveMutation.isPending} />
      </FormModal>

      <ConfirmationDialog open={confirmation.isOpen} onClose={confirmation.hideConfirmation} onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title} message={confirmation.confirmationState.message} confirmText={confirmation.confirmationState.confirmText}
        cancelText={confirmation.confirmationState.cancelText} type={confirmation.confirmationState.type} icon={confirmation.confirmationState.icon}
        isLoading={confirmation.isLoading} maxWidth={confirmation.confirmationState.maxWidth} />
    </Box>
  );
}
```

`FormCheckbox`'s `onChange` signature: check `FormComponents.jsx` line ~319 — if it passes a boolean rather than an event, change `set("IsActive")` to `(v) => setForm((f) => ({ ...f, IsActive: Boolean(v?.target ? v.target.checked : v) }))`.

- [ ] **Step 4: `LookupMaster.jsx`** — add the code select for lead statuses:

```js
const STATUS_CODES = [
  { value: "open", label: "Open — still being worked" },
  { value: "qualified", label: "Qualified — ready to convert" },
  { value: "lost", label: "Lost — needs a reason" },
  { value: "junk", label: "Junk" },
];
const emptyForm = { Value: "", SortOrder: "0", Code: "open" };
```

In the edit-seed effect add `Code: editingLookup.Code || "open"`; in `handleSubmit`'s payload add `...(activeKind === "lead_status" ? { Code: formData.Code } : {})`; after the Sort Order `FormRow` add:

```jsx
            {activeKind === "lead_status" && (
              <FormRow columns={1}>
                <FormSelect label="Code" value={formData.Code} onChange={(e) => handleChange("Code", e.target.value)} options={STATUS_CODES} required />
              </FormRow>
            )}
```

Import `FormSelect` from `FormComponents`.

- [ ] **Step 5: Run to verify they pass** — `cd web && pnpm exec vitest run src/pages/Settings --coverage.include='src/pages/Settings/Products.jsx' --coverage.include='src/pages/Settings/LookupMaster.jsx'`. Expected: ≥ 80 % both.

- [ ] **Step 6: Stop and report.**

---

### Task 17: Users — `Reports To`

**Files:**
- Modify: `web/src/pages/Master/components/UserForm.jsx`
- Modify: `web/src/pages/Master/components/UserForm.test.jsx` (append)
- Modify: `web/src/pages/Master/Users.jsx` (`handleEdit` + a column)

**Interfaces:**
- Consumes: `MASTER_ENDPOINTS.users.directory` → `{ users: [{Id, FullName, Avatar, JobTitle, BranchId, ReportsTo}] }` (Task 4 widened it); `saveUser` body `+ReportsTo`; `fetchUsers` rows `+ReportsTo, ReportsToName`.

- [ ] **Step 1: Failing tests** — append to `UserForm.test.jsx` (reuse its existing render + `saveUser` stub; add `vi.mock("../../../hooks/useApiQuery", () => ({ useApiQuery: () => ({ data: { users: [{ Id: 4, FullName: "Meera Manager" }, { Id: 9, FullName: "Self" }] } }) }))`):

```jsx
it("offers the company directory as Reports To, minus the user being edited", () => {
  renderForm({ editingUser: { Id: 9, Username: "self", FullName: "Self", GroupId: 2 } });
  const select = screen.getByLabelText(/Reports To/);
  expect(within(select).getByText("Meera Manager")).toBeInTheDocument();
  expect(within(select).queryByText("Self")).toBeNull();
});

it("sends ReportsTo as a number, or null when blank", async () => {
  saveUser.mockResolvedValue({ data: { success: true } });
  renderForm({});
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Username/), "bob");
  await user.type(screen.getByLabelText(/^Password/), "secret1");
  await user.type(screen.getByLabelText(/Full Name/), "Bob");
  await user.selectOptions(screen.getByLabelText(/Reports To/), "4");
  await user.click(screen.getByText("Create User"));
  await waitFor(() => expect(saveUser.mock.calls[0][0]).toMatchObject({ ReportsTo: 4 }));
});
```

- [ ] **Step 2: Run to verify it fails** — `cd web && pnpm exec vitest run src/pages/Master/components/UserForm.test.jsx`.

- [ ] **Step 3: Implement**

`UserForm.jsx`:
- Import `{ useApiQuery } from "../../../hooks/useApiQuery"` and `{ MASTER_ENDPOINTS } from "../../../api/masterQueries"`.
- Schema: add `ReportsTo: z.number().nullable().optional(),`.
- Defaults: add `ReportsTo: null,` to the create branch (the edit branch spreads `editingUser`, which now carries it).
- Inside the component, after `useAuthStore()`:

```js
  // The reporting line: one manager per user (Zoho / Salesforce "Reports To").
  // Drives Team-scope visibility and, in spec 2, escalation. A user cannot
  // report to themselves; the SP also refuses any loop further up.
  const { data: directoryData } = useApiQuery({
    queryKey: ["userDirectory"],
    endpoint: MASTER_ENDPOINTS.users.directory,
    params: {},
    staleTime: 10 * 60 * 1000,
    showErrorMessage: false,
  });
  const reportsToOptions = (directoryData?.users ?? [])
    .filter((u) => u.Id !== editingUser?.Id)
    .map((u) => ({ value: String(u.Id), label: u.FullName }));
```

- Payload: in `onSubmit`, add `ReportsTo: data.ReportsTo ?? null,` after `BranchId: BranchId,`.
- Field: after the User Group `Controller` (inside the same `grid-cols-2` row, or a new row):

```jsx
            <Controller
              control={control}
              name="ReportsTo"
              render={({ field }) => (
                <FormSelect
                  label="Reports To"
                  value={field.value == null ? "" : String(field.value)}
                  onChange={(e) => field.onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
                  onBlur={field.onBlur}
                  options={reportsToOptions}
                  placeholder="No manager (top of the chain)"
                  error={errors.ReportsTo?.message}
                />
              )}
            />
```

`Users.jsx`: in `handleEdit` add `ReportsTo: row.original.ReportsTo ?? null,`; in `columns` add `{ accessorKey: "ReportsToName", header: "Reports To", size: 140, Cell: ({ cell }) => cell.getValue() || "—" },` after `GroupName`.

- [ ] **Step 4: Run to verify it passes** — `cd web && pnpm exec vitest run src/pages/Master --coverage.include='src/pages/Master/components/UserForm.jsx' --coverage.include='src/pages/Master/Users.jsx'`. Expected: ≥ 80 %.

- [ ] **Step 5: Stop and report.**

---

### Task 18: Reports — Leads by Status, Conversion by Source

**Files:**
- Modify: `web/src/pages/Reports/LeadsByStatus.jsx` (replace the Task 9 stub) + Create `LeadsByStatus.test.jsx`
- Modify: `web/src/pages/Reports/ConversionBySource.jsx` + `ConversionBySource.test.jsx`

**Interfaces:**
- Consumes: `leadsByStatus` → `{ statuses: [{StatusId, StatusName, StatusCode, SortOrder, LeadCount}] }`; `conversionBySource` rows now `{SourceId, SourceName, TotalLeads, QualifiedCount, WonCount, LostCount}`.

- [ ] **Step 1: Failing tests**

```jsx
// web/src/pages/Reports/LeadsByStatus.test.jsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import LeadsByStatus from "./LeadsByStatus";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

describe("LeadsByStatus", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" }));

  it("renders one row per status in SortOrder", async () => {
    server.use(http.post("*/api/reports/leadsByStatus", async () => json({ statuses: [
      { StatusId: 11, StatusName: "New", StatusCode: "open", SortOrder: 1, LeadCount: 4 },
      { StatusId: 15, StatusName: "Lost", StatusCode: "lost", SortOrder: 5, LeadCount: 1 },
    ] })));
    renderWithProviders(<LeadsByStatus />);
    const table = await screen.findByTestId("leads-by-status-table");
    expect(table).toHaveTextContent("New");
    expect(table).toHaveTextContent("Lost");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("shows the empty state with no rows", async () => {
    server.use(http.post("*/api/reports/leadsByStatus", async () => json({ statuses: [] })));
    renderWithProviders(<LeadsByStatus />);
    expect(await screen.findByTestId("leads-by-status-empty")).toBeInTheDocument();
  });

  it("shows the error state on a failed request", async () => {
    server.use(http.post("*/api/reports/leadsByStatus", async () => HttpResponse.json({ success: false, message: "boom" }, { status: 500 })));
    renderWithProviders(<LeadsByStatus />);
    expect(await screen.findByTestId("leads-by-status-error")).toBeInTheDocument();
  });
});
```

`ConversionBySource.test.jsx` — update the fixture rows to include `QualifiedCount` and `LostCount`, and add:

```jsx
it("shows Qualified and the rate per source", async () => {
  // fixture: { SourceId: 5, SourceName: "Website", TotalLeads: 10, QualifiedCount: 4, WonCount: 0, LostCount: 2 }
  const table = await screen.findByTestId("conversion-by-source-table");
  expect(table).toHaveTextContent("Qualified");
  expect(table).toHaveTextContent("40%");
});
```

- [ ] **Step 2: Run to verify they fail** — `cd web && pnpm exec vitest run src/pages/Reports/LeadsByStatus.test.jsx src/pages/Reports/ConversionBySource.test.jsx`.

- [ ] **Step 3: `LeadsByStatus.jsx`**

```jsx
import { useMemo } from "react";

import Funnel from "../../components/Charts/Funnel";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { ReportPage, ReportTable } from "./ReportShell";

// Replaces Pipeline Funnel. Same chart; the x-axis is now the status list the
// company edits in Settings › Lookups, not a pipeline's stages.
const LeadsByStatus = () => {
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-leads-by-status"],
    endpoint: SALES_ENDPOINTS.reports.leadsByStatus,
    params: {},
    retry: false,
  });
  const rows = data?.statuses ?? [];
  const chartData = useMemo(() => rows.map((r) => ({ name: r.StatusName, value: r.LeadCount })), [rows]);

  return (
    <ReportPage
      title="LEADS BY STATUS"
      subtitle="How many leads sit in each status right now."
      documentTitle="Leads by Status"
      testId="leads-by-status"
      isLoading={isLoading}
      error={error}
      isEmpty={rows.length === 0}
      errorText="Failed to load leads by status."
      emptyText="No leads yet."
    >
      <Funnel data={chartData} height={280} />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.StatusId}
        testId="leads-by-status-table"
        columns={[
          { header: "Status", cell: (r) => r.StatusName },
          { header: "Kind", cell: (r) => r.StatusCode },
          { header: "Leads", align: "right", cell: (r) => r.LeadCount },
        ]}
      />
    </ReportPage>
  );
};

export default LeadsByStatus;
```

- [ ] **Step 4: `ConversionBySource.jsx`** — in the `ReportBarChart` `bars` prop, replace the `WonCount` bar with `{ key: "QualifiedCount", name: "Qualified", tone: "success" }`; in the `ReportTable` columns add `{ header: "Qualified", align: "right", cell: (r) => r.QualifiedCount ?? 0 }`, `{ header: "Lost", align: "right", cell: (r) => r.LostCount ?? 0 }`, and `{ header: "Rate", align: "right", cell: (r) => (r.TotalLeads ? `${Math.round((100 * (r.QualifiedCount ?? 0)) / r.TotalLeads)}%` : "—") }`; drop the Won column. Change the subtitle to `"Leads per source and how many reached Qualified. Won lands here in spec 3."`.

- [ ] **Step 5: Run to verify they pass** — `cd web && pnpm exec vitest run src/pages/Reports --coverage.include='src/pages/Reports/LeadsByStatus.jsx' --coverage.include='src/pages/Reports/ConversionBySource.jsx'`. Expected: ≥ 80 %.

- [ ] **Step 6: Stop and report.**

---

### Task 19: Whole web green, build, deploy, docs

**Files:**
- Modify: `backend/ROLES.md` (Known-open: replace the stale "write path is ungated" bullet)
- Modify: `CLAUDE.md` §6 Sales (one sentence)

- [ ] **Step 1: Full suite with coverage**

Run: `cd web && pnpm exec vitest run --coverage`
Expected: every suite passes; every file created/modified in Tasks 9–18 ≥ 80 % line + branch; global ≥ 60 %. Any file under 80 %: add the missing case to its own test file — never lower the threshold.

- [ ] **Step 2: Lint + build**

Run: `cd web && pnpm lint && pnpm build`
Expected: 0 errors (pre-existing warnings only); `dist-web/` produced.

- [ ] **Step 3: Docs**

`backend/ROLES.md` → **Known-open**: delete the "Write path is ungated" bullet (it has been gated by `assertRecordAccess` since before this spec) and add under **Where things live**:

```
| Transfer target rules | `middleware/permission.js` → `assertCanAssign` (roster via `sp_FetchAssignableUsers`; cross-branch + unassign = DataScope Branch and up) |
| Reporting line | `tblUser.ReportsTo`; `Team` scope = self + subtree (`sp_FetchAccessibleBranchIds`) |
```

`CLAUDE.md` §6 **Sales**: replace "Pipeline board, leads table, lead detail, Settings, reports." with "Leads are a flat `lead_status` lookup (no pipeline since 2026-09-08; the pipeline engine now serves tickets only). Follow-ups are activities on `tblFollowUp`; ownership moves only through `sp_TransferLead` with a reason + remarks; `tblUser.ReportsTo` drives Team scope."

- [ ] **Step 4: Hand the user the web deploy**

```
cd ~/Developer/Nexus/CRM/web && pnpm build
# then upload the CONTENTS of web/dist-web/ to the IIS server's /CRM/ folder (your usual upload).
# public/web.config travels with it and keeps deep links working.
```

Post-deploy checks for the user, in the browser: re-login (menu rights reload) → sidebar shows no Pipeline; Leads page presets + filters; create a lead (first follow-up appears due today); Log follow-up without remarks is refused; Transfer without remarks is refused; Settings › Products; Users › Reports To.

- [ ] **Step 5: Close-out (driver, not the implementer)**
- After the user confirms `071` and `072` are applied and the smoke checks pass: delete `backend/sql/071_sales_foundation.sql` and `072_menu_pipeline_row.sql` (§0.2).
- Notion (§0.5): Done / Bug Fix Log / Change Log entries for spec 1 with absolute dates.
- Stop and report. The user commits and pushes.

---

## Self-review

**Spec coverage** (spec §1–§5 → tasks):

| Spec item | Task |
|---|---|
| `ReportsTo` on save; `Team` = subtree | 4 (visibility itself is in `071`) |
| `sp_FetchAssignableUsers` endpoint | 4 |
| Products CRUD | 3, 16 |
| Lead fields / flattened status / auto first follow-up | 5, 12 |
| `fetchLeads` filters + presets | 5, 11, 13 |
| Detail with follow-ups + assignment history | 5, 14 |
| `setLeadStatus`, Lost requires reason | 5, 14 |
| Transfer with reason + remarks; cross-branch; unassign | 2, 5, 10 |
| Bulk reassign | 5, 10, 13 |
| Follow-ups as activities: schedule / complete / skip / queue / delete-open-only | 6, 11, 14, 15 |
| Lookups carry `Code`; Settings edits it | 7, 16 |
| Reports: leads by status, calls (SP-side), conversion qualified | 7, 18 |
| Pipeline + board removed; Settings › Pipelines tickets-only; menu row | 1, 9 |
| Users › Reports To | 17 |
| Rules table (§2) | 2, 5 |
| Rollout order SQL → backend → web | 1, 8, 19 |
| Mobile untouched | — (no task touches `mobile/`) |

Not in scope and not planned: `Converted` status / convert action (spec 3); ticket flattening and TAT (spec 2); `sp_ConvertedSummary` (already broken; spec 3); `LogCallModal` relocation (spec 2).

**Placeholder scan:** no TBD/TODO. Three steps say "adapt to the existing helper" (Tasks 12, 15, 16, 17 test scaffolding) because those test files already exist with their own render helpers — the assertions and payloads are given in full; only the render wrapper is reused.

**Type consistency:**
- `assertCanAssign(req, res, { toUserId, toBranchId })` — Task 2 defines, Task 5 calls with those names ✓
- `transferLead` body `{ LeadId, ToUserId, ToBranchId, ReasonId, Remarks }` — Task 5 controller ↔ Task 10 modal ↔ `071` `sp_TransferLead` ✓
- `bulkTransferLeads` body `{ LeadIds, … }` → SP `LeadIdsJson` ✓; response `{ Transferred, Skipped }` ✓
- `fetchLeadDetail` → `{ lead, fields, activity, followups, assignments }` — Task 5 ↔ Task 14 ✓
- `fetchFollowups` per-lead `{ followups }` / queue `{ followups, pagination }` — Task 6 ↔ Task 15 (`dataKey: "followups"`) ✓; Task 14 reads follow-ups from the detail call, not this endpoint ✓
- `completeFollowUp` body ↔ `LogFollowUpModal` payload ↔ `sp_CompleteFollowUp` params (`Direction`, `Duration`, `NextType`, `NextDueAt`) ✓
- `fetchAssignableUsers` `{ BranchId? }` → `{ users }` — Task 4 ↔ `useAssignableUsers` ✓; `fetchBranches` → `{ branches }` ✓
- `fetchProducts` `{ products, pagination }` — Task 3 ↔ Tasks 12, 13, 16 (`dataKey: "products"`) ✓
- `leadsByStatus` → `{ statuses }` — Task 7 ↔ Task 18 ✓
- `presetParams(preset, userId)` — Task 11 ↔ Task 13 ✓
- `TransferLeadModal` props `{ open, onClose, leadIds, onTransferred, canCrossBranch }` — Task 10 ↔ Tasks 13, 14 ✓
- `LogFollowUpModal` props `{ open, onClose, followUp, onLogged }` — Task 11 ↔ Tasks 14, 15 ✓
- `saveLookup` `{ Id, Kind, Value, SortOrder, Code }` — Task 7 ↔ Task 16 ✓
