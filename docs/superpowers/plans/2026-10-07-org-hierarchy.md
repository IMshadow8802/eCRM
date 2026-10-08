# Org Hierarchy & Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat branch + single-DataScope model with an office tree and per-module role grants. The server enforces them on every route, and the database enforces them again in every scoped query.

**Architecture:**
- **One procedure loads a user's access** on every request: `sp_FetchUserAccess` returns the per-module actions, the reach, and the office/owner lists.
- **`loadScope` keeps its name** (every route file and route test mocks it) but now builds `req.access`.
- **Every route declares `requireModule(module, action)`, `open()` or `requireAdmin`.**
  - `requireModule` refuses with 403, or re-binds `req.scope` to that module's office/owner lists.
  - So the existing `scopeParams`, `canSeeRecord`, `assertRecordAccess` and `assertCanAssign` keep working unchanged, now per module.
- **A route-walk test fails the build** if any route declares nothing.

**Tech Stack:** SQL Server stored procedures, Express 5 + Jest/Supertest, React 19 + Vitest/RTL/MSW, Expo RN (typecheck/lint only).

**Spec:** `docs/superpowers/specs/2026-10-07-org-hierarchy/design.md` (research: `research.md` beside it).

## Global Constraints

- **Git is read-only** unless the user orders otherwise. Work stays uncommitted; the "Commit" steps below run only if the user has ordered commits for this run.
- **Branch:** `feat/org-hierarchy`, cut from `feat/task-tat-presence`. One folder (`~/Developer/Nexus/CRM`), no worktrees.
- **SQL is written, never applied by Claude.**
  - One script: `backend/sql/096_org_hierarchy.sql`, starting `SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; GO`.
  - The user applies it with `sqlcmd -I`.
  - Use `CREATE OR ALTER PROC`. Every `ALTER TABLE ADD` is guarded with `IF COL_LENGTH(...) IS NULL`.
  - The script must be idempotent: running it twice is harmless.
- **pnpm only.**
- **Test-first** for `backend/src` and `web/src`: each changed file reaches ≥80% line/branch coverage, global floor 60%. `mobile/` gate: `pnpm typecheck` + `pnpm lint` clean.
- **Module keys** (exact strings, used in SQL CHECK, Node and web):
  `leads, sales_reports, complaints, support_reports, customers, people, tasks, teams, projects, roles, offices, settings, dashboard`.
- **Reach values** (exact): `Own, Team, Office, OfficeTree, Company`. Reach modules: `leads, complaints, customers, people`.
- **Report modules borrow reach:** `sales_reports` → `leads`, `support_reports` → `complaints`, `dashboard` → `leads`. All other non-reach modules borrow `people`.
- **`roles` and `offices` are admin-only:**
  - they never get `tblGroupModule` rows;
  - their routes use `requireAdmin`;
  - their menus show only to admins.
- **Customers are per office:** mobile is unique per `(CompId, BranchId)` among active rows.
- **Tasks stay membership-governed.** Personal workspaces stay private, even from admins.
- **The people picker** (`fetchUsers`, `directory`, `fetchBranches`, `fetchUserGroups`) stays readable by every signed-in user, basic fields only.
- **SolarCRM:** the script must run on both databases (`eCRM+`, `SolarCRM`). Match menus by `Route`, never by `Id`.

## Review Focus

1. **A user in two groups** (e.g. Sales Executive + Task Collaborator) gets the union of actions and the widest reach per module, never the narrower one. Owned by Task 1 (SQL verify snippet) and Task 3 (`buildAccess` test).
2. **An admin whose groups have no `tblGroupModule` rows** still passes every `requireModule`. Owned by Task 3 test "admin passes every module".
3. **An HR user posting directly to `/api/leads/fetchLeads`, `/api/reports/funnel` and `/api/tickets/fetchTickets`** gets 403 and no rows. Owned by Task 4 route tests and Task 10 live matrix.
4. **A non-admin with `people.edit`** cannot:
   - give anyone an admin role;
   - edit an admin user;
   - place a user in an office outside their write reach.

   Owned by Task 6 tests.
5. **Editing a user whose form omits `ReportsTo`** keeps the manager, and the web form clearing it sends `0`. Owned by Task 6 (backend) and Task 8 (web).

---

## File structure

| File | Responsibility |
|---|---|
| `backend/sql/096_org_hierarchy.sql` | Schema, seed, migration, new and changed SPs (Tasks 1–2) |
| `backend/src/middleware/access.js` (new) | Pure access logic: `MODULES`, `REACH_MODULES`, `buildAccess(rows, userId)`, `scopeFor(access, module, userId)`, `isWide(scope)`, `stripSensitive(access, viewerId, user)` |
| `backend/src/middleware/permission.js` | `loadScope` (now loads access), `requireModule`, `open`, `saveAction`, `requireAdmin` marker; `assertRecordAccess` module-aware; `assertCanAssign`/`canReopen` use `isWide`; `requireMinLevel`/`requireMenuRight` deleted |
| `backend/src/routes/*.js` | Every route declares access |
| `backend/tests/unit/routes/routeAccess.test.js` (new) | Walks every router; fails on an undeclared route |
| `backend/src/controllers/branchController.js` + `routes/branchRoutes.js` (new) | Office tree save |
| `backend/src/controllers/userGroupController.js` | `fetchModules` / `saveModules`, replacing the menu-access pair |
| `backend/src/controllers/{customer,ticket,report,user,auth,userBranchAccess}Controller.js` | Cross-module scope, office customers, sensitive stripping, save guards, login `access` |
| `web/src/stores/useAuthStore.js`, `web/src/hooks/useAccess.js` (new) | Hold and read `access` |
| `web/src/pages/Master/Groups.jsx` | Module grid |
| `web/src/pages/Master/Offices.jsx` (new) | Office tree |
| `web/src/pages/Master/components/UserForm.jsx` | Office tree picker, extra offices, ReportsTo `0` |
| `web/src/pages/Support/CustomerFormModal.jsx`, `Customers.jsx` | Office field and column |
| `web/src/pages/Sales/TransferLeadModal.jsx` callers, `TransferTicketModal.jsx`, `hooks/useAssignableUsers.jsx` | Pass `Module`; `canCrossBranch` from access |
| `mobile/src/types/api.ts`, `mobile/src/utils/menuAccess.ts` | Login `access` type, corrected comment |
| `backend/ROLES.md`, `CLAUDE.md` §3 | The new model, documented |

---

### Task 1: SQL part A — schema, seed, migration, access procedures

**Files:**
- Create: `backend/sql/096_org_hierarchy.sql` (sections 0–6)

**Interfaces:**
- Produces:
  - **`sp_FetchUserAccess @UserId INT, @CompId BIGINT`**
    - RS1: `PrimaryBranchId BIGINT, IsActive BIT, IsAdmin BIT, CanSeeSensitive BIT`
    - RS2: `Module, CanView, CanAdd, CanEdit, CanDelete, Reach` (only modules with view)
    - RS3: `Reach VARCHAR(12), BranchId BIGINT, CanWrite BIT` (rows for `Own`, `Team`, `Office`, `OfficeTree`, `Company`)
    - RS4: `OwnerId INT` (the Team subtree, including self)
  - **`sp_ValidateUser`**: same result shapes as today; the menu rows now come from module grants.
  - **`sp_FetchUserMenus @UserId INT`**: the same menu rows, for `fetchMyAccess`.
  - **`sp_FetchGroupModules @GroupId INT, @CompId BIGINT`** → rows `Module, CanView, CanAdd, CanEdit, CanDelete, Reach` plus the group's `CanSeeSensitive`.
  - **`sp_SaveGroupModules @GroupId INT, @CompId BIGINT, @ModulesJson NVARCHAR(MAX), @CanSeeSensitive BIT`** → `Id, ResponseCode, ResponseMess`.

- [ ] **Step 1: Header and schema (section 0–1)**

```sql
-- 096_org_hierarchy.sql — office tree + per-module role grants (spec 2026-10-07-org-hierarchy)
-- Apply on BOTH databases: sqlcmd -I -S <server> -U <user> -P <pw> -d "eCRM+"   -i 096_org_hierarchy.sql
--                          sqlcmd -I -S <server> -U <user> -P <pw> -d "SolarCRM" -i 096_org_hierarchy.sql
-- Idempotent. Verify-after-apply block at the end.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Schema --------------------------------------------------------------
IF COL_LENGTH('dbo.tblBranch', 'ParentId') IS NULL
    ALTER TABLE dbo.tblBranch ADD ParentId BIGINT NULL;
IF COL_LENGTH('dbo.tblBranch', 'IsActive') IS NULL
    ALTER TABLE dbo.tblBranch ADD IsActive BIT NOT NULL CONSTRAINT DF_tblBranch_IsActive DEFAULT 1;
IF COL_LENGTH('dbo.tblUserGroups', 'CanSeeSensitive') IS NULL
    ALTER TABLE dbo.tblUserGroups ADD CanSeeSensitive BIT NOT NULL CONSTRAINT DF_tblUserGroups_CanSeeSensitive DEFAULT 0;
IF COL_LENGTH('dbo.tblMenu', 'Module') IS NULL
    ALTER TABLE dbo.tblMenu ADD Module VARCHAR(30) NULL;
GO
IF OBJECT_ID('dbo.tblGroupModule') IS NULL
CREATE TABLE dbo.tblGroupModule (
    Id        INT IDENTITY(1,1) CONSTRAINT PK_tblGroupModule PRIMARY KEY,
    GroupId   INT          NOT NULL CONSTRAINT FK_tblGroupModule_Group REFERENCES dbo.tblUserGroups(Id),
    Module    VARCHAR(30)  NOT NULL,
    CanView   BIT NOT NULL CONSTRAINT DF_tblGroupModule_V DEFAULT 0,
    CanAdd    BIT NOT NULL CONSTRAINT DF_tblGroupModule_A DEFAULT 0,
    CanEdit   BIT NOT NULL CONSTRAINT DF_tblGroupModule_E DEFAULT 0,
    CanDelete BIT NOT NULL CONSTRAINT DF_tblGroupModule_D DEFAULT 0,
    Reach     VARCHAR(12)  NULL,
    CONSTRAINT UX_tblGroupModule UNIQUE (GroupId, Module),
    CONSTRAINT CK_tblGroupModule_Module CHECK (Module IN ('leads','sales_reports','complaints','support_reports',
        'customers','people','tasks','teams','projects','settings','dashboard')),
    CONSTRAINT CK_tblGroupModule_Reach CHECK (
        (Module IN ('leads','complaints','customers','people') AND Reach IN ('Own','Team','Office','OfficeTree','Company'))
     OR (Module NOT IN ('leads','complaints','customers','people') AND Reach IS NULL))
);
GO
```

- [ ] **Step 2: Menu modules + Offices menu (section 2)**

```sql
-- 2. Menus belong to a module. Parents (rows with children) stay NULL: they
--    show when any child shows. Matched by Route so both databases agree.
UPDATE m SET Module = NULL FROM dbo.tblMenu m
 WHERE EXISTS (SELECT 1 FROM dbo.tblMenu c WHERE c.ParentId = m.Id);

UPDATE m SET Module = x.Module
FROM dbo.tblMenu m
JOIN (VALUES
    ('/dashboard','dashboard'), ('/tasks','tasks'), ('/my-work','tasks'),
    ('/sales/leads','leads'), ('/sales/follow-ups','leads'), ('/sales/quotations','leads'),
    ('/support/tickets','complaints'), ('/support/customers','customers'),
    ('/settings/custom-fields','settings'), ('/settings/lookups','settings'),
    ('/settings/ticket-categories','settings'), ('/settings/priorities','settings'),
    ('/settings/products','settings'),
    ('/users','people'), ('/teams','teams'), ('/projects','projects'),
    ('/groups','roles'), ('/offices','offices')
) x(Route, Module) ON x.Route = m.Route
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblMenu c WHERE c.ParentId = m.Id);

-- Report leaves are matched by their parent, since a parent shares a child's route.
UPDATE c SET Module = CASE WHEN p.Description = 'Sales Reports' THEN 'sales_reports' ELSE 'support_reports' END
FROM dbo.tblMenu c JOIN dbo.tblMenu p ON p.Id = c.ParentId
WHERE p.Description IN ('Sales Reports', 'Support Reports');

-- The Offices screen, under Admin.
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/offices')
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route, Module)
    SELECT TOP 1 Id, 'Offices', 1, '/offices', 'offices' FROM dbo.tblMenu WHERE Route = '/admin';
GO
```

- [ ] **Step 3: Migration into `tblGroupModule` (section 3)**

```sql
-- 3. Fill tblGroupModule from today's tblGroupAccess + DataScope, then pin
--    the stock roles to the spec §4 table. Only when the table is empty, so a
--    re-run never overwrites grants an admin has edited since.
IF NOT EXISTS (SELECT 1 FROM dbo.tblGroupModule)
BEGIN
    INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
    SELECT g.Id, m.Module,
           MAX(CAST(ga.CanView AS INT)), MAX(CAST(ga.CanAdd AS INT)),
           MAX(CAST(ga.CanEdit AS INT)), MAX(CAST(ga.CanDelete AS INT)),
           CASE WHEN m.Module IN ('leads','complaints','customers','people') THEN
                CASE g.DataScope WHEN 'Self' THEN 'Own' WHEN 'Team' THEN 'Team'
                                 WHEN 'Branch' THEN 'Office' WHEN 'MultiBranch' THEN 'Office'
                                 ELSE 'Company' END END
    FROM dbo.tblUserGroups g
    JOIN dbo.tblGroupAccess ga ON ga.GroupId = g.Id
    JOIN dbo.tblMenu m ON m.Id = ga.MenuId AND m.Module NOT IN ('roles','offices')
    GROUP BY g.Id, g.DataScope, m.Module
    HAVING MAX(CAST(ga.CanView AS INT)) = 1;

    -- Stock roles, by name (spec §4). V/A/E = 1/1/1/0; V = 1/0/0/0; V/A = 1/1/0/0.
    DECLARE @Stock TABLE (RoleName VARCHAR(100), Module VARCHAR(30), V BIT, A BIT, E BIT, D BIT, Reach VARCHAR(12));
    INSERT INTO @Stock VALUES
     ('Sales Head','leads',1,1,1,0,'Company'), ('Sales Head','customers',1,1,1,0,'Company'), ('Sales Head','people',1,0,0,0,'Team'),
     ('Sales Head','tasks',1,1,1,1,NULL), ('Sales Head','dashboard',1,0,0,0,NULL), ('Sales Head','sales_reports',1,0,0,0,NULL),
     ('Support Head','complaints',1,1,1,0,'Company'), ('Support Head','customers',1,1,1,0,'Company'), ('Support Head','people',1,0,0,0,'Team'),
     ('Support Head','tasks',1,1,1,1,NULL), ('Support Head','dashboard',1,0,0,0,NULL), ('Support Head','support_reports',1,0,0,0,NULL),
     ('HR Manager','people',1,1,1,0,'Company'), ('HR Manager','tasks',1,1,1,1,NULL), ('HR Manager','dashboard',1,0,0,0,NULL),
     ('HR Manager','teams',1,1,1,1,NULL), ('HR Manager','projects',1,1,1,1,NULL),
     ('Regional Manager','leads',1,1,1,0,'OfficeTree'), ('Regional Manager','complaints',1,1,1,0,'OfficeTree'),
     ('Regional Manager','customers',1,1,1,0,'OfficeTree'), ('Regional Manager','people',1,0,0,0,'OfficeTree'),
     ('Regional Manager','tasks',1,1,1,1,NULL), ('Regional Manager','dashboard',1,0,0,0,NULL),
     ('Regional Manager','sales_reports',1,0,0,0,NULL), ('Regional Manager','support_reports',1,0,0,0,NULL),
     ('Regional Manager','teams',1,1,1,0,NULL), ('Regional Manager','projects',1,1,1,0,NULL),
     ('Branch Manager','leads',1,1,1,0,'Office'), ('Branch Manager','complaints',1,1,1,0,'Office'),
     ('Branch Manager','customers',1,1,1,0,'Office'), ('Branch Manager','people',1,0,0,0,'Office'),
     ('Branch Manager','tasks',1,1,1,1,NULL), ('Branch Manager','dashboard',1,0,0,0,NULL),
     ('Branch Manager','sales_reports',1,0,0,0,NULL), ('Branch Manager','support_reports',1,0,0,0,NULL),
     ('Branch Manager','teams',1,1,1,0,NULL), ('Branch Manager','projects',1,1,1,0,NULL),
     ('Support Manager','complaints',1,1,1,0,'Office'), ('Support Manager','customers',1,1,1,0,'Office'),
     ('Support Manager','people',1,0,0,0,'Office'), ('Support Manager','tasks',1,1,1,1,NULL),
     ('Support Manager','dashboard',1,0,0,0,NULL), ('Support Manager','support_reports',1,0,0,0,NULL),
     ('Sales Team Lead','leads',1,1,1,0,'Team'), ('Sales Team Lead','customers',1,1,1,0,'Office'),
     ('Sales Team Lead','people',1,0,0,0,'Team'), ('Sales Team Lead','tasks',1,1,1,1,NULL),
     ('Sales Team Lead','dashboard',1,0,0,0,NULL), ('Sales Team Lead','sales_reports',1,0,0,0,NULL),
     ('Sales Executive','leads',1,1,1,0,'Own'), ('Sales Executive','customers',1,1,0,0,'Office'),
     ('Sales Executive','people',1,0,0,0,'Own'), ('Sales Executive','tasks',1,1,1,1,NULL), ('Sales Executive','dashboard',1,0,0,0,NULL),
     ('Support Agent','complaints',1,1,1,0,'Own'), ('Support Agent','customers',1,1,0,0,'Office'),
     ('Support Agent','people',1,0,0,0,'Own'), ('Support Agent','tasks',1,1,1,1,NULL), ('Support Agent','dashboard',1,0,0,0,NULL),
     ('Task Collaborator','people',1,0,0,0,'Own'), ('Task Collaborator','tasks',1,1,1,1,NULL);

    -- A stock role is replaced wholesale by its table rows.
    DELETE gm FROM dbo.tblGroupModule gm
    JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
    WHERE g.Name IN (SELECT DISTINCT RoleName FROM @Stock) AND g.IsAdmin = 0;

    INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
    SELECT g.Id, s.Module, s.V, s.A, s.E, s.D, s.Reach
    FROM @Stock s JOIN dbo.tblUserGroups g ON g.Name = s.RoleName AND g.IsAdmin = 0;

    UPDATE dbo.tblUserGroups SET CanSeeSensitive = 1 WHERE IsAdmin = 1 OR Name = 'HR Manager';
END
GO
```

- [ ] **Step 4: `sp_FetchUserAccess` (section 4)**

```sql
-- 4. The one access read. Node builds per-module scopes from these lists.
CREATE OR ALTER PROC dbo.sp_FetchUserAccess
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Home BIGINT, @IsActive BIT, @IsAdmin BIT = 0, @Sensitive BIT = 0;

    SELECT @Home = BranchId, @IsActive = IsActive
    FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId;

    SELECT @IsAdmin   = CAST(ISNULL(MAX(CAST(g.IsAdmin AS INT)), 0) AS BIT),
           @Sensitive = CAST(ISNULL(MAX(CAST(g.CanSeeSensitive AS INT)), 0) AS BIT)
    FROM dbo.tblUserGroupMap m
    JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = @CompId
    WHERE m.UserId = @UserId;

    -- RS1 header. No user row = inactive (fail closed).
    SELECT @Home AS PrimaryBranchId,
           CAST(ISNULL(@IsActive, 0) AS BIT) AS IsActive,
           @IsAdmin AS IsAdmin,
           CAST(CASE WHEN @IsAdmin = 1 OR @Sensitive = 1 THEN 1 ELSE 0 END AS BIT) AS CanSeeSensitive;

    -- RS2 modules: union over active groups; widest reach wins.
    SELECT gm.Module,
           CAST(MAX(CAST(gm.CanView   AS INT)) AS BIT) AS CanView,
           CAST(MAX(CAST(gm.CanAdd    AS INT)) AS BIT) AS CanAdd,
           CAST(MAX(CAST(gm.CanEdit   AS INT)) AS BIT) AS CanEdit,
           CAST(MAX(CAST(gm.CanDelete AS INT)) AS BIT) AS CanDelete,
           CASE MAX(CASE gm.Reach WHEN 'Own' THEN 1 WHEN 'Team' THEN 2 WHEN 'Office' THEN 3
                                  WHEN 'OfficeTree' THEN 4 WHEN 'Company' THEN 5 END)
                WHEN 1 THEN 'Own' WHEN 2 THEN 'Team' WHEN 3 THEN 'Office'
                WHEN 4 THEN 'OfficeTree' WHEN 5 THEN 'Company' END AS Reach
    FROM dbo.tblUserGroupMap m
    JOIN dbo.tblUserGroups g   ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = @CompId
    JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id AND gm.CanView = 1
    WHERE m.UserId = @UserId
    GROUP BY gm.Module;

    -- Office lists per reach level.
    DECLARE @Office TABLE (BranchId BIGINT PRIMARY KEY, CanWrite BIT);
    IF @Home IS NOT NULL INSERT INTO @Office VALUES (@Home, 1);
    INSERT INTO @Office (BranchId, CanWrite)
    SELECT a.BranchId, CAST(MAX(CAST(a.CanWrite AS INT)) AS BIT)
    FROM dbo.tblUserBranchAccess a
    WHERE a.UserId = @UserId AND a.CompId = @CompId AND a.CanRead = 1 AND a.BranchId <> ISNULL(@Home, -1)
    GROUP BY a.BranchId;

    DECLARE @Tree TABLE (BranchId BIGINT PRIMARY KEY, CanWrite BIT);
    ;WITH t AS (
        SELECT BranchId, CanWrite, 0 AS Depth FROM @Office
        UNION ALL
        SELECT b.Id, t.CanWrite, t.Depth + 1
        FROM dbo.tblBranch b JOIN t ON b.ParentId = t.BranchId
        WHERE t.Depth < 30
    )
    INSERT INTO @Tree (BranchId, CanWrite)
    SELECT BranchId, CAST(MAX(CAST(CanWrite AS INT)) AS BIT) FROM t GROUP BY BranchId
    OPTION (MAXRECURSION 32);

    DECLARE @Subtree TABLE (UserId INT PRIMARY KEY, BranchId BIGINT NULL);
    ;WITH chain AS (
        SELECT Id, BranchId FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId
        UNION ALL
        SELECT u.Id, u.BranchId FROM dbo.tblUser u JOIN chain c ON u.ReportsTo = c.Id
        WHERE u.CompId = @CompId AND u.Id <> @UserId
    )
    INSERT INTO @Subtree (UserId, BranchId) SELECT DISTINCT Id, BranchId FROM chain OPTION (MAXRECURSION 32);

    -- RS3 offices per reach.
    SELECT 'Own' AS Reach, @Home AS BranchId, CAST(1 AS BIT) AS CanWrite WHERE @Home IS NOT NULL
    UNION ALL
    SELECT 'Team', BranchId, CAST(1 AS BIT) FROM (
        SELECT @Home AS BranchId WHERE @Home IS NOT NULL
        UNION SELECT BranchId FROM @Subtree WHERE BranchId IS NOT NULL) x
    UNION ALL
    SELECT 'Office', BranchId, CanWrite FROM @Office
    UNION ALL
    SELECT 'OfficeTree', BranchId, CanWrite FROM @Tree
    UNION ALL
    SELECT 'Company', b.Id, CAST(1 AS BIT) FROM dbo.tblBranch b WHERE b.Id IS NOT NULL;

    -- RS4 the Team owner list (self included).
    SELECT UserId AS OwnerId FROM @Subtree;
END
GO
```

- [ ] **Step 5: `sp_ValidateUser` menu rows from modules (section 5)**

Start from the live definition, dumped at the scratchpad (`…/scratchpad/sp/sp_ValidateUser.sql`) or from `OBJECT_DEFINITION(OBJECT_ID('sp_ValidateUser'))`. Change `CREATE PROC` to `CREATE OR ALTER PROC`. Replace **only** the final menu `SELECT DISTINCT … ORDER BY m.ParentId, m.Id;` (lines 102–117 of the live text) with:

```sql
    DECLARE @MenuAdmin BIT = CASE WHEN EXISTS (
        SELECT 1 FROM tblUserGroupMap ugm JOIN tblUserGroups ug ON ug.Id = ugm.GroupId
        WHERE ugm.UserId = @FoundId AND ug.IsActive = 1 AND ug.IsAdmin = 1) THEN 1 ELSE 0 END;
    DECLARE @GroupName VARCHAR(100) = (
        SELECT TOP 1 ug.Name FROM tblUserGroupMap ugm JOIN tblUserGroups ug ON ug.Id = ugm.GroupId
        WHERE ugm.UserId = @FoundId AND ug.IsActive = 1 ORDER BY ug.IsAdmin DESC, ug.HierarchyLevel, ug.Id);

    ;WITH g AS (
        SELECT gm.Module,
               MAX(CAST(gm.CanAdd AS INT)) AS A, MAX(CAST(gm.CanEdit AS INT)) AS E,
               MAX(CAST(gm.CanDelete AS INT)) AS D
        FROM tblUserGroupMap ugm
        JOIN tblUserGroups ug  ON ug.Id = ugm.GroupId AND ug.IsActive = 1
        JOIN tblGroupModule gm ON gm.GroupId = ug.Id AND gm.CanView = 1
        WHERE ugm.UserId = @FoundId
        GROUP BY gm.Module
    ),
    leaf AS (
        SELECT m.Id, m.ParentId,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.A END AS BIT) AS CanAdd,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.E END AS BIT) AS CanEdit,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.D END AS BIT) AS CanDelete
        FROM tblMenu m
        LEFT JOIN g ON g.Module = m.Module
        WHERE m.IsAllowed = 1 AND m.Module IS NOT NULL
          AND (@MenuAdmin = 1 OR (g.Module IS NOT NULL AND m.Module NOT IN ('roles', 'offices')))
    ),
    rows AS (
        SELECT Id, CanAdd, CanEdit, CanDelete FROM leaf
        UNION ALL
        SELECT p.Id, CAST(0 AS BIT), CAST(0 AS BIT), CAST(0 AS BIT)
        FROM tblMenu p
        WHERE p.IsAllowed = 1 AND p.Module IS NULL
          AND EXISTS (SELECT 1 FROM leaf WHERE leaf.ParentId = p.Id)
    )
    SELECT m.Id AS MenuId, m.ParentId, m.Description, m.Image, m.FormId, m.MenuType, m.ActualId,
           m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, m.Route,
           r.CanAdd, r.CanEdit, r.CanDelete, CAST(1 AS BIT) AS CanView,
           @GroupName AS GroupName
    FROM rows r JOIN tblMenu m ON m.Id = r.Id
    ORDER BY m.ParentId, m.Id;
```

Then add **`sp_FetchUserMenus @UserId INT`**, the same menu rows for a signed-in user (`fetchMyAccess`). Its body is exactly the block above, with `@FoundId` renamed `@UserId`, wrapped in `CREATE OR ALTER PROC dbo.sp_FetchUserMenus @UserId INT AS BEGIN SET NOCOUNT ON; … END` + `GO`.

- [ ] **Step 6: Group-module procs + `sp_DeleteUserGroup` (section 6)**

```sql
-- 6. Role grid read/write.
CREATE OR ALTER PROC dbo.sp_FetchGroupModules
    @GroupId INT,
    @CompId  BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Id = @GroupId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Role not found' AS ResponseMess; RETURN; END
    SELECT 200 AS ResponseCode, 'Role modules retrieved' AS ResponseMess,
           g.CanSeeSensitive, g.IsAdmin
    FROM dbo.tblUserGroups g WHERE g.Id = @GroupId;
    SELECT Module, CanView, CanAdd, CanEdit, CanDelete, Reach
    FROM dbo.tblGroupModule WHERE GroupId = @GroupId ORDER BY Module;
END
GO

CREATE OR ALTER PROC dbo.sp_SaveGroupModules
    @GroupId         INT,
    @CompId          BIGINT,
    @ModulesJson     NVARCHAR(MAX),
    @CanSeeSensitive BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Id = @GroupId AND CompId = @CompId)
    BEGIN SELECT @GroupId AS Id, 404 AS ResponseCode, 'Role not found' AS ResponseMess; RETURN; END
    IF ISJSON(@ModulesJson) <> 1
    BEGIN SELECT @GroupId AS Id, 400 AS ResponseCode, 'Modules must be a JSON array' AS ResponseMess; RETURN; END

    DECLARE @In TABLE (Module VARCHAR(30) PRIMARY KEY, V BIT, A BIT, E BIT, D BIT, Reach VARCHAR(12));
    INSERT INTO @In
    SELECT Module, ISNULL(CanView,0), ISNULL(CanAdd,0), ISNULL(CanEdit,0), ISNULL(CanDelete,0), NULLIF(Reach, '')
    FROM OPENJSON(@ModulesJson) WITH (Module VARCHAR(30), CanView BIT, CanAdd BIT, CanEdit BIT, CanDelete BIT, Reach VARCHAR(12));

    -- Any right implies view; no view = no row.
    UPDATE @In SET V = 1 WHERE A = 1 OR E = 1 OR D = 1;
    DELETE FROM @In WHERE V = 0;
    -- Reach modules default to Own; others carry none.
    UPDATE @In SET Reach = ISNULL(Reach, 'Own') WHERE Module IN ('leads','complaints','customers','people');
    UPDATE @In SET Reach = NULL WHERE Module NOT IN ('leads','complaints','customers','people');

    BEGIN TRY
        BEGIN TRAN;
        DELETE FROM dbo.tblGroupModule WHERE GroupId = @GroupId;
        INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
        SELECT @GroupId, Module, V, A, E, D, Reach FROM @In;
        UPDATE dbo.tblUserGroups SET CanSeeSensitive = ISNULL(@CanSeeSensitive, 0) WHERE Id = @GroupId;
        COMMIT;
        SELECT @GroupId AS Id, 200 AS ResponseCode, 'Role permissions saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        -- 547 = the CHECK constraints: an unknown module or a bad reach.
        SELECT @GroupId AS Id,
               CASE WHEN ERROR_NUMBER() = 547 THEN 400 ELSE 500 END AS ResponseCode,
               CASE WHEN ERROR_NUMBER() = 547 THEN 'Unknown module or reach' ELSE ERROR_MESSAGE() END AS ResponseMess;
    END CATCH
END
GO
```

`sp_DeleteUserGroup`: start from the live text, change to `CREATE OR ALTER PROC`, and add `DELETE FROM tblGroupModule WHERE GroupId = @Id;` directly above `DELETE FROM tblGroupAccess WHERE GroupId = @Id;`.

- [ ] **Step 7: Self-check the section against the live DB (read-only)**

Run with `mcp__sqlserver-ecrm__read_query`: `SELECT Route, Id, ParentId FROM tblMenu`. Confirm every leaf route in Step 2's `VALUES` list exists, and that `'Sales Reports'` / `'Support Reports'` are the exact parent descriptions. Do not apply anything.

- [ ] **Step 8: Commit** (only if ordered): `git add backend/sql/096_org_hierarchy.sql && git commit -m "feat(access): 096 part A — office tree, module grants, access procs"`

---

### Task 2: SQL part B — changed procedures + verify block

**Files:**
- Modify: `backend/sql/096_org_hierarchy.sql` (append sections 7–13)

**Interfaces:**
- Produces:
  - **`sp_FetchBranches`**: `Id, BranchName, ParentId, IsActive, Address, PeopleCount`.
  - **`sp_SaveBranch @Id BIGINT, @BranchName VARCHAR(50), @ParentId BIGINT, @Address VARCHAR(50), @IsActive BIT, @CompId BIGINT`** → `Id, ResponseCode, ResponseMess`.
  - **`sp_FetchAssignableUsers @UserId, @CompId, @BranchId = NULL, @AccessibleBranchIdsJson = NULL, @OwnerIdsJson = NULL`**:
    - the lists decide who is assignable;
    - Node passes the module's scope;
    - `@OwnerIdsJson` set = narrow (owner list + own manager).
  - **`sp_FetchCustomers`**: adds `@UserId INT = NULL, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL`. A customer's owner is `CreatedBy`.
  - **`sp_SaveCustomer`**: dedupe per office; on edit `@BranchId` NULL keeps the office, a value moves it.
  - **`sp_ConvertLead`**: the mobile match is restricted to the lead's office.
  - **`sp_Dashboard`**: adds `@TicketBranchIdsJson NVARCHAR(MAX) = NULL, @TicketOwnerIdsJson NVARCHAR(MAX) = NULL`; ticket and call figures use them.
  - **`sp_SaveUser`**:
    - `@ReportsTo` NULL = keep, `0` = clear;
    - new `@ActorIsAdmin BIT = 0`;
    - a non-admin actor may not assign an admin role or edit an admin user (403).

- [ ] **Step 1: Office procs (section 7)**

```sql
-- 7. Offices.
CREATE OR ALTER PROC dbo.sp_FetchBranches
AS
BEGIN
    SET NOCOUNT ON;
    SELECT b.Id, b.BranchName, b.ParentId, b.IsActive, b.Address,
           (SELECT COUNT(*) FROM dbo.tblUser u WHERE u.BranchId = b.Id AND u.IsActive = 1) AS PeopleCount
    FROM dbo.tblBranch b
    WHERE b.Id IS NOT NULL
    ORDER BY b.BranchName;
END
GO

CREATE OR ALTER PROC dbo.sp_SaveBranch
    @Id         BIGINT       = 0,
    @BranchName VARCHAR(50),
    @ParentId   BIGINT       = NULL,
    @Address    VARCHAR(50)  = NULL,
    @IsActive   BIT          = 1,
    @CompId     BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);
    SET @BranchName = NULLIF(LTRIM(RTRIM(@BranchName)), '');
    IF @ParentId <= 0 SET @ParentId = NULL;

    IF @BranchName IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Office name is required' AS ResponseMess; RETURN; END
    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @Id)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Office not found' AS ResponseMess; RETURN; END
    IF @ParentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @ParentId)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Parent office not found' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblBranch WHERE BranchName = @BranchName AND Id <> @Id)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Another office already has this name' AS ResponseMess; RETURN; END

    -- No loops: walk up from the new parent; meeting @Id means it would sit under itself.
    IF @Id > 0 AND @ParentId IS NOT NULL
    BEGIN
        DECLARE @cur BIGINT = @ParentId, @hops INT = 0;
        WHILE @cur IS NOT NULL AND @hops < 32
        BEGIN
            IF @cur = @Id
            BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'An office cannot sit under itself or one of its own offices' AS ResponseMess; RETURN; END
            SET @cur = (SELECT ParentId FROM dbo.tblBranch WHERE Id = @cur);
            SET @hops += 1;
        END
    END

    IF @Id > 0 AND @IsActive = 0
       AND EXISTS (SELECT 1 FROM dbo.tblUser WHERE BranchId = @Id AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Move or deactivate the people in this office first' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF @Id > 0
            UPDATE dbo.tblBranch SET BranchName = @BranchName, ParentId = @ParentId,
                   Address = @Address, IsActive = ISNULL(@IsActive, 1)
            WHERE Id = @Id;
        ELSE
        BEGIN
            -- tblBranch.Id is not an identity column.
            SELECT @Id = ISNULL(MAX(Id), 0) + 1 FROM dbo.tblBranch WITH (UPDLOCK, HOLDLOCK);
            INSERT INTO dbo.tblBranch (Id, BranchName, Address, ParentId, IsActive)
            VALUES (@Id, @BranchName, @Address, @ParentId, 1);
        END
        COMMIT;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Office saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO
```

- [ ] **Step 2: `sp_FetchAssignableUsers` takes the scope (section 8)**

```sql
-- 8. Who the caller may hand a record to — decided by the module scope Node
--    passes, not by a DataScope read here. Narrow (owner list) = own subtree +
--    own manager; wide = everyone in the readable offices; @BranchId = that
--    office's roster (Node decides whether a cross-office move is allowed).
CREATE OR ALTER PROC dbo.sp_FetchAssignableUsers
    @UserId                  INT,
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Users TABLE (Id INT PRIMARY KEY);
    DECLARE @ManagerId INT = (SELECT ReportsTo FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId);

    IF @BranchId IS NOT NULL
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND BranchId = @BranchId AND IsActive = 1;
    ELSE IF @OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> ''
    BEGIN
        INSERT INTO @Users SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        IF @ManagerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM @Users WHERE Id = @ManagerId)
            INSERT INTO @Users (Id) VALUES (@ManagerId);
        DELETE x FROM @Users x JOIN dbo.tblUser u ON u.Id = x.Id WHERE u.IsActive = 0 OR u.CompId <> @CompId;
    END
    ELSE
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND IsActive = 1
          AND (@AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = ''
               OR BranchId IN (SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson)));

    SELECT u.Id, u.FullName, u.Avatar, u.JobTitle, u.BranchId, b.BranchName, u.ReportsTo,
           200 AS ResponseCode, 'Assignable users retrieved successfully' AS ResponseMess
    FROM @Users x
    JOIN dbo.tblUser u ON u.Id = x.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = u.BranchId
    ORDER BY u.FullName;
END
GO
```

- [ ] **Step 3: Customers per office (section 9)**

```sql
-- 9. Customers belong to an office.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblCustomer_CompId_Mobile' AND object_id = OBJECT_ID('dbo.tblCustomer'))
    DROP INDEX UX_tblCustomer_CompId_Mobile ON dbo.tblCustomer;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblCustomer_Branch_Mobile' AND object_id = OBJECT_ID('dbo.tblCustomer'))
    CREATE UNIQUE INDEX UX_tblCustomer_Branch_Mobile ON dbo.tblCustomer (CompId, BranchId, Mobile)
    WHERE IsActive = 1 AND Mobile IS NOT NULL;
GO
```

Before writing the DROP, read the live index name and filter: `SELECT name, filter_definition FROM sys.indexes WHERE object_id = OBJECT_ID('tblCustomer') AND is_unique = 1`. If the name differs from `UX_tblCustomer_CompId_Mobile`, use the live name. Copy its filter, adding `Mobile IS NOT NULL` only if the live one has it.

`sp_SaveCustomer`: start from the live text, `CREATE OR ALTER`. Three edits:
1. The duplicate check's `WHERE CompId = @CompId AND Mobile = @Mobile …` gains
   `AND BranchId = CASE WHEN @Id > 0 THEN ISNULL(@BranchId, (SELECT BranchId FROM dbo.tblCustomer WHERE Id = @Id)) ELSE @BranchId END`.
   The message (both places) becomes `'Another customer in this office already has this mobile number'`.
   Its comment becomes `-- One live customer per mobile per office (spec 2026-10-07 §2.5).`
2. The `UPDATE` gains `BranchId = ISNULL(@BranchId, BranchId),`.
3. After the 404 check, add:
   ```sql
   IF @BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @BranchId)
   BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Office not found' AS ResponseMess; RETURN; END
   ```

`sp_FetchCustomers`: start from the live text, `CREATE OR ALTER`.
- Add the three parameters after `@IsActive`.
- Replace the comment line `-- Company-wide (the dedupe picker needs it), paged, newest first.` with `-- Scoped by the customers module (office + CreatedBy as owner), paged, newest first.`
- Add the scope tables, copied from `sp_FetchCustomerDetail`'s top block (`@BranchIds`, `@OwnerIds`, `@UseBranchScope`, `@UseOwnerScope`).
- Add to the `@F` filter's `WHERE`:

```sql
      AND (
            (    (@UseBranchScope = 0 OR c.BranchId  IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR c.CreatedBy IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND c.CreatedBy = @UserId)
          )
```

`sp_FetchCustomerDetail`: start from the live text, `CREATE OR ALTER`; add `c.CreatedBy,` after `c.IsActive,` in the RS1 select list (Node's visibility check needs the owner). Nothing else changes.

`sp_ConvertLead`: start from the live text, `CREATE OR ALTER`. In the mobile match, change `WHERE CompId = @CompId AND Mobile = @LMobile AND IsActive = 1` to `WHERE CompId = @CompId AND BranchId = @BranchId AND Mobile = @LMobile AND IsActive = 1`.

- [ ] **Step 4: Dashboard ticket scope (section 10)**

`sp_Dashboard`: start from the live text, `CREATE OR ALTER`.
- Add parameters `@TicketBranchIdsJson NVARCHAR(MAX) = NULL, @TicketOwnerIdsJson NVARCHAR(MAX) = NULL`.
- After the existing scope tables, add:

```sql
    DECLARE @TBranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @TOwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseTBranch BIT = 0, @UseTOwner BIT = 0;
    IF (@TicketBranchIdsJson IS NOT NULL AND @TicketBranchIdsJson <> '')
    BEGIN INSERT INTO @TBranchIds SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@TicketBranchIdsJson); SET @UseTBranch = 1; END
    IF (@TicketOwnerIdsJson IS NOT NULL AND @TicketOwnerIdsJson <> '')
    BEGIN INSERT INTO @TOwnerIds SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@TicketOwnerIdsJson); SET @UseTOwner = 1; END
```

In the two ticket predicates (the `tblCall … JOIN tblTicket bt` block and the `tblTicket t` block), replace `@UseBranchScope`/`@BranchIds`/`@UseOwnerScope`/`@OwnerIds` with `@UseTBranch`/`@TBranchIds`/`@UseTOwner`/`@TOwnerIds`. Lead predicates stay unchanged.

- [ ] **Step 5: `sp_SaveUser` (section 11)**

Start from the live text, `CREATE OR ALTER`.
1. Add the parameter `@ActorIsAdmin BIT = 0` after `@ActorUserId`.
2. Replace `IF (@ReportsTo IS NOT NULL AND @ReportsTo <= 0) SET @ReportsTo = NULL;` with:
   ```sql
   -- NULL = keep the current manager; 0 = clear it (spec 2026-10-07 §6).
   DECLARE @ClearReportsTo BIT = CASE WHEN @ReportsTo IS NOT NULL AND @ReportsTo <= 0 THEN 1 ELSE 0 END;
   IF @ClearReportsTo = 1 SET @ReportsTo = NULL;
   ```
3. After the role check, add:
   ```sql
   -- A non-admin (HR with people.edit) may not mint or touch an admin.
   IF ISNULL(@ActorIsAdmin, 0) = 0
   BEGIN
       IF EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND IsAdmin = 1)
       BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only an administrator can give the admin role';
             SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
       IF @Id > 0 AND EXISTS (SELECT 1 FROM tblUserGroupMap m JOIN tblUserGroups g ON g.Id = m.GroupId
                              WHERE m.UserId = @Id AND g.IsAdmin = 1 AND g.IsActive = 1)
       BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only an administrator can edit an administrator';
             SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
   END
   ```
4. In the `UPDATE tblUser`, replace `ReportsTo = @ReportsTo,` with `ReportsTo = CASE WHEN @ClearReportsTo = 1 THEN NULL ELSE ISNULL(@ReportsTo, ReportsTo) END,`.
5. Leave the INSERT as is: a new user with `@ReportsTo` NULL simply has none.

- [ ] **Step 6: Verify block (section 12) — comments only, for the user to run after applying**

```sql
-- 12. VERIFY AFTER APPLY (read-only):
-- SELECT g.Name, gm.Module, gm.CanView, gm.CanAdd, gm.CanEdit, gm.CanDelete, gm.Reach
--   FROM tblGroupModule gm JOIN tblUserGroups g ON g.Id = gm.GroupId ORDER BY g.Name, gm.Module;
--   -> HR Manager has NO leads / complaints / customers / sales_reports / support_reports rows.
-- SELECT Route, Module FROM tblMenu ORDER BY Module;           -> no leaf with NULL Module except parents
-- EXEC sp_FetchUserAccess @UserId = <an executive>, @CompId = 1;  -> 4 result sets
-- EXEC sp_ValidateUser ... (log in through the app) -> same sidebar as before for Owner
-- SELECT name FROM sys.indexes WHERE name = 'UX_tblCustomer_Branch_Mobile';  -> 1 row
-- Nothing reads tblGroupAccess any more except sp_FetchGroupAccess / sp_SaveGroupAccess /
-- sp_CheckMenuRight (unused); a later cleanup script drops them with the table.
```

- [ ] **Step 7: Self-check (read-only).** For every procedure edited in Steps 3–5, diff the edited text against the live definition. Only the listed lines may differ. Confirm the `sp_Dashboard` ticket blocks are the only ones switched.

- [ ] **Step 8: Hand the script to the user** with the two `sqlcmd -I` lines from the header. Wait for "applied" before Task 10. Tasks 3–9 use mocked DB tests and can proceed meanwhile.

- [ ] **Step 9: Commit** (only if ordered).

---

### Task 3: Access core (`access.js`, `loadScope`, `requireModule`)

**Files:**
- Create: `backend/src/middleware/access.js`
- Create: `backend/tests/unit/middleware/access.test.js`
- Modify: `backend/src/middleware/permission.js` (loadScope, guards, exports; delete `requireMinLevel`, `requireMenuRight`, `HIERARCHY`, `WIDE_SCOPES`)
- Modify: `backend/tests/unit/middleware/permission.test.js`, `backend/tests/unit/assertCanAssign.test.js`

**Interfaces:**
- Consumes: `sp_FetchUserAccess` (Task 1).
- Produces (later tasks rely on these names exactly):
  - `access.js`: `MODULES`, `REACH_MODULES`, `buildAccess(recordsets, userId) → Access`, `scopeFor(access, module, userId) → Scope`, `isWide(scope) → boolean`, `stripSensitive(access, viewerId, user) → user`.
  - `Access = { isAdmin, isActive, canSeeSensitive, primaryBranchId, modules: { [module]: { view, add, edit, delete, reach|null } }, lists: { Own, Team, Office, OfficeTree, Company: [{BranchId, CanWrite}] }, teamOwners: number[] }`.
  - `Scope = { module, reach, can: {view, add, edit, delete}, branchIds: number[], canWriteBranchIds: number[], ownerIds: number[]|null, isAdmin, isActive, primaryBranchId }`.
  - `permission.js` exports: `loadScope`, `requireModule(module|fn, action|fn)`, `open()`, `saveAction(req)`, `requireAdmin`, `scopeFor(req, module)` (req-level wrapper), `scopeJson`, `scopeParams(req, module?)`, `canSeeRecord`, `canWriteBranch`, `canReadBranch`, `assertRecordAccess`, `assertCanAssign`, `canReopen`, `taskAllowed`.

- [ ] **Step 1: Write the failing tests** — `backend/tests/unit/middleware/access.test.js`

```js
const { MODULES, REACH_MODULES, buildAccess, scopeFor, isWide, stripSensitive } = require("../../../src/middleware/access");

// recordsets as sp_FetchUserAccess returns them
const rs = ({ admin = false, sensitive = false, modules = [], lists = [], owners = [] } = {}) => [
  [{ PrimaryBranchId: 2, IsActive: true, IsAdmin: admin, CanSeeSensitive: sensitive }],
  modules,
  lists,
  owners.map((OwnerId) => ({ OwnerId })),
];
const mod = (Module, Reach = null, v = 1, a = 0, e = 0, d = 0) =>
  ({ Module, Reach, CanView: v, CanAdd: a, CanEdit: e, CanDelete: d });
const LISTS = [
  { Reach: "Own", BranchId: 2, CanWrite: 1 },
  { Reach: "Team", BranchId: 2, CanWrite: 1 }, { Reach: "Team", BranchId: 3, CanWrite: 1 },
  { Reach: "Office", BranchId: 2, CanWrite: 1 }, { Reach: "Office", BranchId: 4, CanWrite: 0 },
  { Reach: "OfficeTree", BranchId: 2, CanWrite: 1 }, { Reach: "OfficeTree", BranchId: 4, CanWrite: 0 },
  { Reach: "OfficeTree", BranchId: 5, CanWrite: 0 },
  { Reach: "Company", BranchId: 1, CanWrite: 1 }, { Reach: "Company", BranchId: 2, CanWrite: 1 },
];

describe("module list", () => {
  it("holds the spec keys and the four reach modules", () => {
    expect(MODULES).toEqual(["leads", "sales_reports", "complaints", "support_reports", "customers", "people",
      "tasks", "teams", "projects", "roles", "offices", "settings", "dashboard"]);
    expect([...REACH_MODULES]).toEqual(["leads", "complaints", "customers", "people"]);
  });
});

describe("scopeFor", () => {
  const access = buildAccess(rs({
    modules: [mod("leads", "Own", 1, 1, 1, 0), mod("customers", "Office", 1, 1), mod("people", "Team"),
      mod("complaints", "OfficeTree"), mod("sales_reports"), mod("teams", null, 1, 1, 1)],
    lists: LISTS, owners: [7, 8],
  }), 7);

  it("Own = home office, owner = me", () => {
    const s = scopeFor(access, "leads", 7);
    expect(s).toMatchObject({ reach: "Own", branchIds: [2], canWriteBranchIds: [2], ownerIds: [7] });
    expect(s.can).toEqual({ view: true, add: true, edit: true, delete: false });
  });
  it("Team = subtree offices + subtree owners", () => {
    expect(scopeFor(access, "people", 7)).toMatchObject({ reach: "Team", branchIds: [2, 3], ownerIds: [7, 8] });
  });
  it("Office = home + extra offices, read-only extras not writable, no owner filter", () => {
    expect(scopeFor(access, "customers", 7)).toMatchObject({ branchIds: [2, 4], canWriteBranchIds: [2], ownerIds: null });
  });
  it("OfficeTree includes offices below", () => {
    expect(scopeFor(access, "complaints", 7).branchIds).toEqual([2, 4, 5]);
  });
  it("report modules borrow the source module's reach but keep their own rights", () => {
    const s = scopeFor(access, "sales_reports", 7);
    expect(s.reach).toBe("Own");
    expect(s.can).toEqual({ view: true, add: false, edit: false, delete: false });
  });
  it("plain modules borrow people's lists", () => {
    const s = scopeFor(access, "teams", 7);
    expect(s.branchIds).toEqual([2, 3]);
    expect(s.can.edit).toBe(true);
  });
  it("a module with no grant matches nothing and allows nothing", () => {
    const s = scopeFor(access, "settings", 7);
    expect(s.can).toEqual({ view: false, add: false, edit: false, delete: false });
    expect(s.branchIds).toEqual([]);
    expect(s.ownerIds).toEqual([]);
  });
});

describe("admin", () => {
  it("passes every module with Company reach and every office", () => {
    const access = buildAccess(rs({ admin: true, lists: LISTS }), 1);
    for (const m of MODULES) expect(scopeFor(access, m, 1).can).toEqual({ view: true, add: true, edit: true, delete: true });
    expect(scopeFor(access, "leads", 1)).toMatchObject({ reach: "Company", branchIds: [1, 2], ownerIds: null });
    expect(access.canSeeSensitive).toBe(true);
  });
});

describe("isWide", () => {
  it("Office and up, or admin", () => {
    expect(isWide({ reach: "Own" })).toBe(false);
    expect(isWide({ reach: "Team" })).toBe(false);
    expect(isWide({ reach: "Office" })).toBe(true);
    expect(isWide({ reach: "Company" })).toBe(true);
    expect(isWide({ reach: "Own", isAdmin: true })).toBe(true);
    expect(isWide(undefined)).toBe(false);
  });
});

describe("stripSensitive", () => {
  const user = { Id: 9, FullName: "A", BranchId: 4, HourlyRate: 500, Mobile: "9999999999", Email: "a@x.in" };
  const staff = buildAccess(rs({ modules: [mod("people", "Office")], lists: LISTS }), 7);
  const hr = buildAccess(rs({ sensitive: true, modules: [mod("people", "Office")], lists: LISTS }), 7);
  it("removes rate/mobile/email for a caller without the permission", () => {
    expect(stripSensitive(staff, 7, user)).toEqual({ Id: 9, FullName: "A", BranchId: 4, HourlyRate: null, Mobile: null, Email: null });
  });
  it("keeps them for the caller's own row", () => {
    expect(stripSensitive(staff, 9, user)).toEqual(user);
  });
  it("keeps them for a sensitive caller within people reach, strips outside it", () => {
    expect(stripSensitive(hr, 7, user)).toEqual(user);
    expect(stripSensitive(hr, 7, { ...user, BranchId: 99 }).Mobile).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `cd backend && pnpm exec jest access --silent`. Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Implement `backend/src/middleware/access.js`**

```js
// src/middleware/access.js
//
// Pure access logic (spec 2026-10-07-org-hierarchy §2–3). sp_FetchUserAccess
// returns the grants and the office lists per reach level; this turns them into
// one scope per module. No DB, no Express — permission.js wires it in.

const MODULES = ["leads", "sales_reports", "complaints", "support_reports", "customers", "people",
  "tasks", "teams", "projects", "roles", "offices", "settings", "dashboard"];
const REACH_MODULES = new Set(["leads", "complaints", "customers", "people"]);
// Report modules have their own on/off but read with the source module's reach;
// everything else that has no reach of its own reads with people's.
const REACH_SOURCE = { sales_reports: "leads", support_reports: "complaints", dashboard: "leads" };
const WIDE = new Set(["Office", "OfficeTree", "Company"]);
const NONE = { view: false, add: false, edit: false, delete: false };
const ALL = { view: true, add: true, edit: true, delete: true };

const bit = (v) => v === true || v === 1;

function buildAccess(recordsets = [], userId) {
  const head = recordsets[0]?.[0] || {};
  const isAdmin = bit(head.IsAdmin);
  const modules = {};
  for (const r of recordsets[1] || []) {
    modules[r.Module] = { view: bit(r.CanView), add: bit(r.CanAdd), edit: bit(r.CanEdit), delete: bit(r.CanDelete), reach: r.Reach || null };
  }
  const lists = { Own: [], Team: [], Office: [], OfficeTree: [], Company: [] };
  for (const r of recordsets[2] || []) {
    if (lists[r.Reach]) lists[r.Reach].push({ BranchId: Number(r.BranchId), CanWrite: bit(r.CanWrite) });
  }
  return {
    userId: Number(userId),
    isAdmin,
    // No user row comes back as IsActive 0; a header without the column (old SP) must not lock out.
    isActive: !(head.IsActive === false || head.IsActive === 0),
    canSeeSensitive: isAdmin || bit(head.CanSeeSensitive),
    primaryBranchId: head.PrimaryBranchId ? Number(head.PrimaryBranchId) : null,
    modules,
    lists,
    teamOwners: (recordsets[3] || []).map((r) => Number(r.OwnerId)),
  };
}

function listsFor(access, reach, userId) {
  const rows = access.lists[reach] || [];
  const branchIds = rows.map((r) => r.BranchId).sort((a, b) => a - b);
  const canWriteBranchIds = rows.filter((r) => r.CanWrite).map((r) => r.BranchId).sort((a, b) => a - b);
  // [] vs null is load-bearing: null = no owner filter, [] = match nobody.
  const ownerIds = reach === "Own" ? [Number(userId)] : reach === "Team" ? [...access.teamOwners] : null;
  return { branchIds, canWriteBranchIds, ownerIds };
}

function scopeFor(access, module, userId) {
  const base = {
    module,
    isAdmin: !!access?.isAdmin,
    isActive: access?.isActive !== false,
    primaryBranchId: access?.primaryBranchId ?? null,
  };
  if (!access) return { ...base, reach: null, can: NONE, branchIds: [], canWriteBranchIds: [], ownerIds: [] };
  if (access.isAdmin) return { ...base, reach: "Company", can: ALL, ...listsFor(access, "Company", userId) };

  const grant = access.modules[module];
  const can = grant ? { view: grant.view, add: grant.add, edit: grant.edit, delete: grant.delete } : NONE;
  if (!can.view) return { ...base, reach: null, can: NONE, branchIds: [], canWriteBranchIds: [], ownerIds: [] };

  const source = REACH_MODULES.has(module) ? module : REACH_SOURCE[module] || "people";
  const reach = access.modules[source]?.reach || "Own";
  return { ...base, reach, can, ...listsFor(access, reach, userId) };
}

const isWide = (scope) => !!scope && (scope.isAdmin === true || WIDE.has(scope.reach));

// Salary and contact details leave the server only for the person themselves,
// or for a caller with the sensitive permission whose people reach covers the row.
function stripSensitive(access, viewerId, user) {
  if (!user || Number(user.Id) === Number(viewerId)) return user;
  if (access?.canSeeSensitive) {
    const s = scopeFor(access, "people", viewerId);
    if (access.isAdmin || s.branchIds.includes(Number(user.BranchId))) return user;
  }
  return { ...user, HourlyRate: null, Mobile: null, Email: null };
}

module.exports = { MODULES, REACH_MODULES, buildAccess, scopeFor, isWide, stripSensitive };
```

- [ ] **Step 4: Run** `pnpm exec jest access --silent`. Expected: PASS.

- [ ] **Step 5: Rewire `permission.js`, test-first.** Add to `permission.test.js`, replacing the `HIERARCHY`, `requireMinLevel`, `requireMenuRight` and `loadScope` describes:

```js
describe("loadScope (access)", () => {
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
```

Also update these existing tests:
- `assertCanAssign` and `canReopen`: give their `req.scope` a `reach` instead of `dataScope` (`"Branch"` → `"Office"`, `"Self"` → `"Own"`, `"Team"` stays).
- `assertCanAssign`: now expects `sp_FetchAssignableUsers` called with `{ UserId, CompId, BranchId, AccessibleBranchIdsJson, OwnerIdsJson }`.
- `assertRecordAccess` lead/ticket: add a `req.access` granting view on `leads`/`complaints`, plus one new case each — no module → 403 without a DB call; `level: "write"` without `edit` → 403.

- [ ] **Step 6: Run** `pnpm exec jest permission assertCanAssign --silent`. Expected: FAIL.

- [ ] **Step 7: Implement in `permission.js`**

- Delete `HIERARCHY`, `computeScope`, `requireMinLevel`, `requireMenuRight` and `WIDE_SCOPES`, and update the header comment to describe `req.access`/`req.scope`.
- Add:

```js
const { buildAccess, scopeFor: scopeOf, isWide } = require("./access");

const EMPTY_ACCESS = (req) => buildAccess([[{
  PrimaryBranchId: req.user?.BranchId ?? null, IsActive: 1, IsAdmin: 0, CanSeeSensitive: 0 }]], req.user?.UserId);

// req-level wrapper: the scope of one module for this caller.
const scopeFor = (req, module) => scopeOf(req.access, module, req.user?.UserId);

const loadScope = async (req, res, next) => {
  if (!req.user) return next();
  try {
    const result = await database.executeStoredProcedure("sp_FetchUserAccess", {
      UserId: req.user.UserId,
      CompId: req.user.CompId,
    });
    req.access = buildAccess(result.recordsets, req.user.UserId);
  } catch (err) {
    console.error("loadScope failed:", err.message);
    // Fail closed: no modules, so every requireModule refuses and every scoped
    // SP gets an empty allow-list.
    req.access = EMPTY_ACCESS(req);
  }
  if (req.access.isActive === false) {
    return res.status(403).json({
      success: false, message: "Account is inactive", code: "USER_INACTIVE",
      responseCode: 403, timestamp: new Date().toISOString(),
    });
  }
  // Routes with no module of their own read with the people scope (isAdmin rides along).
  req.scope = scopeFor(req, "people");
  next();
};

const saveAction = (req) => (Number(req.body?.Id) > 0 ? "edit" : "add");

// Route guard: the caller's role must grant `action` on `module`. Both may be
// functions of the request. On success req.scope becomes that module's scope, so
// scopeParams / canSeeRecord / assertCanAssign downstream read the right lists.
const requireModule = (module, action) => {
  const guard = (req, res, next) => {
    const m = typeof module === "function" ? module(req) : module;
    const a = typeof action === "function" ? action(req) : action;
    const s = scopeFor(req, m);
    if (!s.can[a]) {
      return responseHelper.error(res, "You do not have permission for this action", "INSUFFICIENT_ROLE", 403);
    }
    req.scope = s;
    next();
  };
  guard.access = { module, action };
  return guard;
};

// Marks a route that needs no module (auth, own profile, notifications, pick-lists).
const open = () => {
  const guard = (req, res, next) => next();
  guard.access = "open";
  return guard;
};
```

- Set `requireAdmin.access = "admin";` after its definition. Change its check from `req.scope.isAdmin` to `req.access?.isAdmin`, keeping the `NO_SCOPE` branch when `!req.access`.
- `scopeParams(req, module)`: when `module` is given, use `scopeFor(req, module)`, otherwise `req.scope`.
- `assertRecordAccess`: add `module` to each `ENTITY_LOOKUP` entry (`lead: "leads"`, `ticket: "complaints"`, `quotation: "leads"`; `quoteprofile` none). For a module entry:
  - `const s = scopeFor(req, module)`;
  - if `!s.can.view`, or `level === "write"` and `!s.can.edit`, send the 403 before any DB call;
  - then `canSeeRecord({ ...req, scope: s }, record, ownerField)`.
- `assertCanAssign`: use `isWide(req.scope)` instead of `WIDE_SCOPES.has(req.scope?.dataScope)`. Pass `AccessibleBranchIdsJson: scopeJson(req.scope?.branchIds)` and `OwnerIdsJson: scopeJson(req.scope?.ownerIds)` to `sp_FetchAssignableUsers`.
- `canReopen`: use `isWide(req.scope)`.
- Exports: add `requireModule`, `open`, `saveAction`, `scopeFor`, `isWide`; remove the deleted names.

- [ ] **Step 8: Run** `pnpm exec jest --silent`.
  - Expected: only the route-file suites fail (they still import `requireMinLevel`/`requireMenuRight`); those are fixed in Task 4.
  - Coverage: `pnpm exec jest access permission --coverage --collectCoverageFrom='src/middleware/access.js' --collectCoverageFrom='src/middleware/permission.js'` must be ≥80%.

- [ ] **Step 9: Commit** (only if ordered).

---

### Task 4: Every route declares its access + route-walk test

**Files:**
- Modify: every file in `backend/src/routes/` (21 files)
- Create: `backend/tests/unit/routes/routeAccess.test.js`
- Modify: `backend/tests/unit/routes/*.test.js` that assert the old gates (`teamProjectRoutes`, `productRoutes`, `configRoutes`, `userRoutes`, `customerRoutes`, `reportRoutes`)

**Interfaces:**
- Consumes: `requireModule`, `open`, `saveAction`, `requireAdmin` (Task 3).

- [ ] **Step 1: Write the failing walk test** — `backend/tests/unit/routes/routeAccess.test.js`

```js
// Fail-closed guarantee (spec 2026-10-07 §3.2): every route declares the module
// and action it needs, open(), or requireAdmin. A new endpoint without one
// fails here, before it can ship unguarded.
jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));

const { setupRoutes } = require("../../../src/config/routes");

const mounted = [];
setupRoutes({
  use: (path, router) => mounted.push({ path, router }),
  get: () => {},
});

const routes = mounted.flatMap(({ path, router }) =>
  (router.stack || [])
    .filter((layer) => layer.route)
    .map((layer) => ({
      url: `${path}${layer.route.path}`,
      marks: layer.route.stack.map((l) => l.handle.access).filter(Boolean),
    })));

it("finds the routers", () => {
  expect(routes.length).toBeGreaterThan(120); // 133 on 2026-10-07
});

it.each(routes.map((r) => [r.url, r]))("%s declares its access", (url, r) => {
  expect(r.marks.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run** `pnpm exec jest routeAccess --silent`. Expected: FAIL. Nearly every route lacks a mark; this also catches any import of the removed guards.

- [ ] **Step 3: Declare access in every route file.** In each file, import `{ loadScope, requireModule, open, saveAction, requireAdmin }` as needed and drop the deleted names. Then apply this table exactly. "+ keep" means existing payload middlewares stay where they are, with the guard placed right after them.

| Router | Route → guard |
|---|---|
| auth | `loginUser`, `logoutUser` → `open()`; new `fetchMyAccess` → `verifyToken, loadScope, open()` (controller in Task 6) |
| users | `saveUser` → `requireModule("people", saveAction)`; `fetchUserHandover`, `deleteUser` → `requireAdmin` (unchanged); `fetchUsers`, `me/updateProfile`, `me/changePassword`, `directory`, `fetchAssignableUsers`, `fetchBranches` → `open()` |
| user-groups | `saveUserGroup`, `deleteUserGroup` → `requireAdmin`; `fetchUserGroups` → `open()`; **remove** `fetchGroupAccess`/`saveGroupAccess`; **add** `fetchGroupModules` → `requireAdmin`, `saveGroupModules` → `requireAdmin` (controller in Task 6) |
| teams | `saveTeam` → `requireModule("teams", saveAction)`; `deleteTeam` → `requireModule("teams", "delete")`; `fetchTeams` → `open()` |
| projects | `saveProject` → `requireModule("projects", saveAction)`; `deleteProject` → `requireModule("projects", "delete")`; `fetchProjects` → `open()` |
| tasks, kanban, workspaces | every route → `requireModule("tasks", "view")` (membership decides the rest) |
| notifications | every route → `open()` |
| leads | `saveLeads` → `requireModule("leads", saveAction)`; `fetchLeads`, `fetchLeadDetail` → `requireModule("leads", "view")`; `setLeadStatus`, `convertLead`, `transferLead`, `bulkTransferLeads` → `requireModule("leads", "edit")`; `deleteLeads` → `requireModule("leads", "delete")` |
| quotations | `saveQuotation` → `requireModule("leads", saveAction)`; `fetchQuotations`, `fetchQuotationDetail`, `ensureQuoteProfile` → `requireModule("leads", "view")`; `finaliseQuotation`, `reviseQuotation`, `rejectQuotation`, `deleteQuotation`, `saveQuoteProfile` → `requireModule("leads", "edit")` |
| followups | `fetchFollowups` → `requireModule("leads", "view")`; the other four → `requireModule("leads", "edit")` |
| calls | both → `open()` (each call's parent goes through `assertRecordAccess`, which checks the module) |
| tickets | `saveTicket` → `requireModule("complaints", saveAction)`; `fetchTickets`, `fetchTicketDetail`, `fetchEscalationTargets` → `requireModule("complaints", "view")`; `setTicketStatus`, `resolveTicket`, `closeTicket`, `rejectTicket`, `reopenTicket`, `transferTicket`, `bulkTransferTickets`, `escalateTicket` → `requireModule("complaints", "edit")`; `deleteTicket` → `requireModule("complaints", "delete")` |
| customers | `saveCustomer` → `requireModule("customers", saveAction)`; `fetchCustomers`, `fetchCustomerDetail` → `requireModule("customers", "view")`; `deleteCustomer` → `requireAdmin` (unchanged) |
| reports | `getDashboard` → `requireModule("dashboard", "view")`; `ticketsByCategory`, `resolutionSummary` → `requireModule("support_reports", "view")`; the eight sales reports → `requireModule("sales_reports", "view")` |
| user-branch-access | `myScope` → `open()`; `fetchUserBranchAccess` → `requireModule("people", "view")`; save/delete → `requireAdmin` (unchanged) |
| config | `fetchCustomFields`, `fetchLookups` → `open()`; `saveCustomField`, `saveLookup` → `requireModule("settings", saveAction)`; `deleteCustomField`, `deleteLookup` → `requireModule("settings", "delete")` |
| products | `fetchProducts` → `open()`; `saveProduct` → `requireModule("settings", saveAction)`; `deleteProduct` → `requireModule("settings", "delete")` |
| attachments | every route → `open()` (`assertRecordAccess` checks the module per Entity) |
| branches (new, Task 6) | `saveBranch` → `requireAdmin` |

Update each route file's comment block to say which module governs it, in one line. Example for `teamRoutes.js`:

```js
// Writes need the teams module (Owner, Admin, HR, managers); reads stay open
// because task forms list teams for everyone (spec 2026-10-07 §3).
router.post("/saveTeam", requirePayload, requireModule("teams", saveAction), teamController.save);
router.post("/fetchTeams", allowEmptyPayload, open(), teamController.fetch);
router.post("/deleteTeam", requirePayload, requireModule("teams", "delete"), teamController.delete);
```

- [ ] **Step 4: Update the route tests that pinned old gates.** Their `loadScope` mock now sets both `req.access` and `req.scope`. Use this shared helper, put in `backend/tests/helpers/mockAccess.js`:

```js
// Builds the req.access a mocked loadScope injects.
const { buildAccess, scopeFor } = require("../../src/middleware/access");
const LISTS = [{ Reach: "Own", BranchId: 2, CanWrite: 1 }, { Reach: "Office", BranchId: 2, CanWrite: 1 },
  { Reach: "Company", BranchId: 2, CanWrite: 1 }];
function mockAccess({ admin = false, sensitive = false, modules = [] } = {}, userId = 7) {
  return buildAccess([[{ PrimaryBranchId: 2, IsActive: 1, IsAdmin: admin, CanSeeSensitive: sensitive }],
    modules.map(([Module, rights = "v", Reach = null]) => ({ Module, Reach,
      CanView: 1, CanAdd: rights.includes("a") ? 1 : 0, CanEdit: rights.includes("e") ? 1 : 0, CanDelete: rights.includes("d") ? 1 : 0 })),
    LISTS, []], userId);
}
const loadScopeWith = (getAccess) => (req, res, next) => {
  req.access = getAccess();
  req.scope = { ...scopeFor(req.access, "people", req.user.UserId), isAdmin: req.access.isAdmin };
  next();
};
module.exports = { mockAccess, loadScopeWith };
```

In `teamProjectRoutes.test.js`:
- replace the `sp_CheckMenuRight` expectations with access-based ones: HR with `["teams","vae"]` → 200 on save; Sales Executive with no `teams` → 403; admin → 200;
- assert no DB call is made by the guard.

Do the same for `productRoutes`, `configRoutes` (settings) and `reportRoutes`. `reportRoutes` adds: HR (`people` only) → 403 on `/funnel`, `/ticketsByCategory`, `/getDashboard` when no `dashboard` grant.

- [ ] **Step 5: Run** `pnpm exec jest --silent`. Expected: all suites PASS, including `routeAccess`.

- [ ] **Step 6: Commit** (only if ordered).

---

### Task 5: Cross-module controllers — customers, tickets, dashboard, assignable users

**Files:**
- Modify: `backend/src/controllers/customerController.js`, `ticketController.js`, `reportController.js`, `userController.js` (`assignableUsers` only)
- Test: `backend/tests/unit/controllers/customerController.test.js`, `ticketController.test.js`, `reportController.test.js`, `userController.test.js`

**Interfaces:**
- Consumes: `scopeFor(req, module)`, `scopeParams(req, module)`, `canSeeRecord`, `canWriteBranch` (Task 3); SP params from Task 2.

- [ ] **Step 1: Failing tests.** Add these cases, in the style of each suite's existing mocked-DB tests. Each test builds `req.access` with `mockAccess` (Task 4 helper) and sets `req.scope = scopeFor(req.access, <route module>, 7)`.

customerController:
```js
it("fetch passes the customers scope (office + CreatedBy owner)", async () => {
  // Sales Executive: customers Office over [2]
  await customerController.fetch(req, res);
  expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCustomers",
    expect.objectContaining({ UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: null }));
});
it("save refuses an office the caller cannot write", async () => {
  req.body = { Name: "X", Mobile: "9876543210", BranchId: 4 };
  await customerController.save(req, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_SaveCustomer", expect.anything());
});
it("save defaults the office to the caller's home office", async () => { /* body has no BranchId -> SP gets BranchId 2 */ });
it("detail 403s a customer outside customers reach", async () => { /* RS1 row BranchId 9, CreatedBy 3 -> 403 */ });
it("detail lists complaints under the COMPLAINTS scope, not customers", async () => {
  // caller has customers Office, no complaints -> detail SP gets AccessibleBranchIdsJson "[]", OwnerIdsJson "[]"
});
it("editing a customer into another office needs write over both", async () => { /* existing BranchId 2 -> 4 not writable -> 403 */ });
```

ticketController:
```js
it("save refuses a customer the caller cannot see", async () => {
  // sp_FetchCustomerDetail RS1 returns BranchId 9 -> 403, sp_SaveTicket never called
});
```

reportController:
```js
it("dashboard passes leads scope and complaints scope separately", async () => {
  // access: leads Own, complaints Office -> sp_Dashboard gets AccessibleBranchIdsJson "[2]", OwnerIdsJson "[7]",
  // TicketBranchIdsJson "[2]", TicketOwnerIdsJson null
});
it("dashboard with no complaints module sends an empty ticket allow-list", async () => {
  // TicketBranchIdsJson "[]", TicketOwnerIdsJson "[]"
});
```

userController.assignableUsers:
```js
it("uses the scope of the requested module", async () => {
  req.body = { Module: "complaints" };
  // access: complaints Team -> sp_FetchAssignableUsers gets OwnerIdsJson of the team
});
it("rejects an unknown Module with 400", async () => { req.body = { Module: "people" }; /* 400 */ });
it("403s a module the caller lacks", async () => { /* HR asking for leads -> 403 */ });
```

- [ ] **Step 2: Run** the four suites. Expected: FAIL.

- [ ] **Step 3: Implement**

`customerController.js`:
- **fetch:** spread `...scopeParams(req)` (the route bound `req.scope` to customers) into the `sp_FetchCustomers` params. Delete the "No scopeParams: company-wide by design" comment and replace it with `// Scoped by the customers module (spec 2026-10-07 §2.5).`
- **save:**
  ```js
  const isEdit = Number(req.body.Id) > 0;
  const target = positiveInt(req.body.BranchId) ?? (isEdit ? null : Number(req.scope.primaryBranchId));
  if (target && !canWriteBranch(req, target)) {
    return error(res, "You cannot add customers to that office", "FORBIDDEN", 403);
  }
  if (isEdit) {
    const existing = await assertCustomerVisible(req, res, req.body.Id); // helper below
    if (!existing) return;
    if (target && Number(existing.BranchId) !== target && !canWriteBranch(req, existing.BranchId)) {
      return error(res, "You cannot move this customer", "FORBIDDEN", 403);
    }
  }
  // ...existing call, with BranchId: target (null on edit = keep)
  ```
- **The visibility helper:**
  ```js
  // A customer's owner is whoever created it.
  async function assertCustomerVisible(req, res, customerId, scope = req.scope) {
    const r = await database.executeStoredProcedure("sp_FetchCustomerDetail", {
      CompId: req.user.CompId, CustomerId: Number(customerId) || 0,
      UserId: null, AccessibleBranchIdsJson: "[]", OwnerIdsJson: "[]",
    });
    const row = r.recordsets?.[0]?.[0] || null;
    if (row && canSeeRecord({ ...req, scope }, row, "CreatedBy")) return row;
    error(res, "You do not have access to this customer", "FORBIDDEN", 403);
    return null;
  }
  module.exports.assertCustomerVisible = assertCustomerVisible;
  ```
  Export it so `ticketController` reuses it, called with `scopeFor(req, "customers")`.
- **detail:** gate RS1 with `canSeeRecord(req, row, "CreatedBy")` → 403. Pass `...scopeParams(req, "complaints")` (it already returns `"[]"` for a caller without complaints) for RS2.

`sp_FetchCustomerDetail` RS1 carries `CreatedBy` (added in Task 2 Step 3).

`ticketController.save`: before calling `sp_SaveTicket`, when `CustomerId` is present, run `await assertCustomerVisible(req, res, CustomerId, scopeFor(req, "customers"))`; stop if it returns falsy.

`reportController.getDashboard`:
```js
const t = scopeFor(req, "complaints");
// leads figures read with the dashboard (= leads) scope bound by the route;
// ticket figures with the complaints scope, "[]" when the role has none.
...scopeParams(req),
TicketBranchIdsJson: scopeJson(t.branchIds),
TicketOwnerIdsJson: scopeJson(t.ownerIds),
```

`userController.assignableUsers`:
```js
const module = req.body?.Module ?? "leads";
if (!["leads", "complaints"].includes(module)) return validationError(res, "Module must be leads or complaints");
const s = scopeFor(req, module);
if (!s.can.view) return error(res, "You do not have permission for this action", "INSUFFICIENT_ROLE", 403);
// sp_FetchAssignableUsers with { UserId, CompId, BranchId, AccessibleBranchIdsJson: scopeJson(s.branchIds), OwnerIdsJson: scopeJson(s.ownerIds) }
```

- [ ] **Step 4: Run** the four suites + coverage on the four controllers (≥80%). Expected: PASS.

- [ ] **Step 5: Commit** (only if ordered).

---

### Task 6: People, roles, offices, login access

**Files:**
- Modify: `backend/src/controllers/userController.js` (`save`, `fetch`, `directory` if it returns sensitive columns), `userGroupController.js`, `authController.js`, `userBranchAccessController.js`
- Create: `backend/src/controllers/branchController.js`, `backend/src/routes/branchRoutes.js`; register `app.use("/api/branches", branchRoutes)` in `config/routes.js`
- Test: matching suites in `backend/tests/unit/controllers/` + `backend/tests/unit/routes/branchRoutes.test.js`

**Interfaces:**
- Produces:
  - `POST /api/user-groups/fetchGroupModules { GroupId }` → `data: { modules: [...], canSeeSensitive, isAdmin }`.
  - `POST /api/user-groups/saveGroupModules { GroupId, Modules: [{Module, CanView, CanAdd, CanEdit, CanDelete, Reach}], CanSeeSensitive }`.
  - `POST /api/branches/saveBranch { Id, BranchName, ParentId, Address, IsActive }` → `data: { id }`.
  - **The login response** gains `data.access = { isAdmin, canSeeSensitive, primaryBranchId, modules: {<module>: {view, add, edit, delete, reach}} }`.
  - **`POST /api/auth/fetchMyAccess`** → `data: { access, permissions: { menuItems, rawPermissions } }` (same shapes as login).

- [ ] **Step 1: Failing tests**

userController.save:
```js
it("non-admin (HR) cannot save without the sensitive permission", async () => { /* people vae, sensitive false -> 403 */ });
it("non-admin cannot place a user in an office outside people write reach", async () => { /* BranchId 4 -> 403 */ });
it("passes ActorIsAdmin to the SP", async () => { /* admin -> ActorIsAdmin 1; HR -> 0 */ });
it("ReportsTo: absent -> null (keep), 0 -> 0 (clear), 5 -> 5", async () => { /* regression for the clear-on-edit bug */ });
```
userController.fetch:
```js
it("is company-wide and strips salary/contact for a non-sensitive caller", async () => {
  // SP called with AccessibleBranchIdsJson null; rows of others have HourlyRate/Mobile/Email null; own row intact
});
it("keeps them for HR within people reach", async () => {});
```
userGroupController:
```js
it("fetchModules maps both result sets", async () => {});
it("saveModules sends ModulesJson and CanSeeSensitive", async () => {});
it("saveModules 400s when Modules is not an array", async () => {});
```
branchController:
```js
it("saveBranch passes fields and CompId, returns the id", async () => {});
it("saveBranch surfaces the SP's 400 for a loop", async () => {});
```
authController:
```js
it("login returns data.access built from sp_FetchUserAccess", async () => {});
it("fetchMyAccess returns access + menu rights for the token's user", async () => {});
```

- [ ] **Step 2: Run** the suites. Expected: FAIL.

- [ ] **Step 3: Implement**

`userController.save` (the route already passed `requireModule("people", saveAction)`, so `req.scope` = people):
```js
const actorIsAdmin = !!req.access?.isAdmin;
if (!actorIsAdmin && !req.access?.canSeeSensitive) {
  return error(res, "Editing people needs the salary & contact permission", "INSUFFICIENT_ROLE", 403);
}
const branch = positiveInt(BranchId);
if (!actorIsAdmin && branch && !canWriteBranch(req, branch)) {
  return error(res, "You cannot place people in that office", "FORBIDDEN", 403);
}
// ReportsTo: absent/null = keep the current manager, 0 = clear it (spec §6).
const reportsTo = ReportsTo === 0 || ReportsTo === "0" ? 0 : positiveInt(ReportsTo);
```
Pass `ReportsTo: reportsTo` and `ActorIsAdmin: actorIsAdmin ? 1 : 0`. Change the `ReportsTo = null` default in the destructure to `ReportsTo` (undefined). Update the "Admin-only route" comment on `BranchId` to "people module; a non-admin is limited to offices they can write".

`userController.fetch`:
- Pass `AccessibleBranchIdsJson: null` and `IsAdmin: 1`, with the comment `// The people picker is company-wide (spec §2.6); detail is stripped below.` This is so the SP applies no branch filter.
- Then `users.map((u) => stripSensitive(req.access, req.user.UserId, u))`.
- Apply the same `stripSensitive` map to any other user-returning method in this controller whose SP selects `HourlyRate`, `Mobile` or `Email`. Check `directory` and `handover` with `grep -n "HourlyRate\|Mobile\|Email"` on their SPs' SELECT lists.

`userGroupController`: `fetchModules` and `saveModules` follow the file's existing `fetchAccess`/`saveAccess` pattern, which they replace (delete those two methods):
```js
fetchModules = asyncRoute(async (req, res) => {
  const result = await database.executeStoredProcedure("sp_FetchGroupModules", {
    GroupId: Number(req.body.GroupId) || 0, CompId: req.user.CompId });
  const head = firstRow(result);
  if (!spOk(head)) return error(res, spMessage(head), "NOT_FOUND", spStatus(head));
  return success(res, "Role modules retrieved", {
    modules: result.recordsets[1] || [],
    canSeeSensitive: head.CanSeeSensitive === true || head.CanSeeSensitive === 1,
    isAdmin: head.IsAdmin === true || head.IsAdmin === 1,
  });
}, "Failed to fetch role modules", "ROLE_MODULES_ERROR");

saveModules = asyncRoute(async (req, res) => {
  const { GroupId, Modules, CanSeeSensitive = false } = req.body;
  if (!Array.isArray(Modules)) return validationError(res, "Modules must be a list");
  const result = await database.executeStoredProcedure("sp_SaveGroupModules", {
    GroupId: Number(GroupId) || 0, CompId: req.user.CompId,
    ModulesJson: JSON.stringify(Modules), CanSeeSensitive: CanSeeSensitive ? 1 : 0 });
  const row = firstRow(result);
  return res.status(spStatus(row)).json({ success: spOk(row), message: spMessage(row),
    responseCode: spStatus(row), data: spOk(row) ? { groupId: row.Id } : null, timestamp: new Date().toISOString() });
}, "Failed to save role modules", "ROLE_MODULES_SAVE_ERROR");
```
Check the exact helper names (`firstRow`, `spOk`, `spStatus`, `spMessage`, `success`, `error`, `validationError`) against the file's imports before writing, and import any that are missing from `../utils/controllerKit` / `../utils/responseHelper`.

`branchController.saveBranch`: the same shape as `saveModules`, calling `sp_SaveBranch` with `{ Id: Number(Id) || 0, BranchName, ParentId: positiveInt(ParentId), Address: Address ?? null, IsActive: IsActive === false ? 0 : 1, CompId: req.user.CompId }` and returning `data: { id: row.Id }`. In `branchRoutes.js`: `router.use(verifyToken, loadScope); router.post("/saveBranch", requirePayload, requireAdmin, branchController.saveBranch);`.

`authController`:
- Extract a helper `menuPayload(rows)` → `{ menuItems: organizeMenuHierarchy(items), rawPermissions: items, totalMenuItems }` from the login body, and use it in both places.
- After a successful `sp_ValidateUser`:
  ```js
  const accessResult = await database.executeStoredProcedure("sp_FetchUserAccess", { UserId: spResponse.UserId, CompId: spResponse.CompId });
  const access = publicAccess(buildAccess(accessResult.recordsets, spResponse.UserId));
  ```
  ```js
  // What the client needs to hide buttons; office lists stay server-side.
  const publicAccess = (a) => ({ isAdmin: a.isAdmin, canSeeSensitive: a.canSeeSensitive,
    primaryBranchId: a.primaryBranchId, modules: a.modules });
  ```
  Add `access` to `data`.
- `fetchMyAccess`: `req.access` is already loaded by `loadScope`. The menu rows come from `sp_FetchUserMenus @UserId` (Task 1 Step 5). `fetchMyAccess` returns `{ access: publicAccess(req.access), permissions: menuPayload(rows) }`.

`userBranchAccessController.myScope`: return `{ access: publicAccess(req.access) }`, importing `publicAccess` from a shared spot. Put `publicAccess` in `access.js` and export it (add a one-line test there).

- [ ] **Step 4: Run** all backend suites with coverage on every touched controller (≥80%). Expected: PASS.

- [ ] **Step 5: Commit** (only if ordered).

---

### Task 7: Web — access in the store, pickers, customers, transfers

**Files:**
- Modify: `web/src/stores/useAuthStore.js` (hold `access`; `setAccess`), `web/src/pages/auth/Login.jsx` (store `data.access`)
- Create: `web/src/hooks/useAccess.js` (+ test)
- Modify: `web/src/components/ProtectedRoutes.jsx` (refresh on window focus)
- Modify: `web/src/pages/Support/CustomerFormModal.jsx`, `Customers.jsx`, `web/src/hooks/useAssignableUsers.jsx`, `web/src/pages/Sales/Leads.jsx`, `LeadDetail.jsx`, `web/src/pages/Support/TransferTicketModal.jsx`, `web/src/api/masterQueries.js` (new endpoints)
- Tests beside each

**Interfaces:**
- Consumes: the login `data.access`, `fetchMyAccess`, `fetchAssignableUsers { Module }`, `fetchBranches` columns.
- Produces:
  - `useAccess(module) → { view, add, edit, delete, reach, wide }`, where `wide = isAdmin || reach in Office/OfficeTree/Company`;
  - `useIsAdmin()`, `useCanSeeSensitive()`.

- [ ] **Step 1: Failing tests**

`useAccess.test.js`:
```js
import { renderHook } from "@testing-library/react";
import { useAuthStore } from "../stores/useAuthStore";
import { useAccess } from "./useAccess";

it("reads a module's rights and computes wide", () => {
  useAuthStore.setState({ access: { isAdmin: false, modules: { leads: { view: true, add: true, edit: false, delete: false, reach: "Office" } } } });
  const { result } = renderHook(() => useAccess("leads"));
  expect(result.current).toEqual({ view: true, add: true, edit: false, delete: false, reach: "Office", wide: true });
});
it("a missing module is all false", () => {
  useAuthStore.setState({ access: { isAdmin: false, modules: {} } });
  const { result } = renderHook(() => useAccess("complaints"));
  expect(result.current.view).toBe(false);
});
it("admin is everything", () => {
  useAuthStore.setState({ access: { isAdmin: true, modules: {} } });
  const { result } = renderHook(() => useAccess("settings"));
  expect(result.current).toMatchObject({ view: true, delete: true, wide: true });
});
```

`CustomerFormModal.test.jsx`:
- an office select shows when `access.modules.customers.reach` is `Office` and `fetchBranches` returns two offices;
- it is hidden with one office;
- the save payload carries `BranchId`.

`Customers.test.jsx`: an Office column shows when the list spans more than one `BranchId`.

`TransferLeadModal` callers: `canCrossBranch` comes from `useAccess("leads").wide`. Test: a Leads page with an `Own` reach → the modal gets `canCrossBranch={false}`.

`useAssignableUsers`: sends `Module`. Test: the hook called with `"complaints"` → the request body has `Module: "complaints"`.

- [ ] **Step 2: Run** `cd web && pnpm exec vitest run src/hooks/useAccess.test.js src/pages/Support src/pages/Sales`. Expected: FAIL.

- [ ] **Step 3: Implement**

`useAccess.js`:
```js
import { useAuthStore } from "../stores/useAuthStore";

const WIDE = new Set(["Office", "OfficeTree", "Company"]);
const NONE = { view: false, add: false, edit: false, delete: false, reach: null };

// Courtesy only: hides what the server would refuse anyway (spec 2026-10-07 §3).
export function useAccess(module) {
  const access = useAuthStore((s) => s.access);
  if (access?.isAdmin) return { view: true, add: true, edit: true, delete: true, reach: "Company", wide: true };
  const m = access?.modules?.[module] ?? NONE;
  return { view: !!m.view, add: !!m.add, edit: !!m.edit, delete: !!m.delete, reach: m.reach ?? null, wide: WIDE.has(m.reach) };
}
export const useIsAdmin = () => useAuthStore((s) => !!s.access?.isAdmin);
export const useCanSeeSensitive = () => useAuthStore((s) => !!s.access?.canSeeSensitive);
```

`useAuthStore`:
- add `access: null`;
- `login` stores `responseData.access ?? null`;
- add `setAccess: (access) => set({ access })`;
- include `access` in the persisted `partialize`;
- clear it in logout/`clearClientConfig`.

`ProtectedRoutes.jsx`: on `window` `focus`, call `fetchMyAccess` (new in `masterQueries.js` under `auth`), then `setAccess(data.access)` and `setMenuRights(data.permissions.rawPermissions)`. Ignore errors; the 401 interceptor already handles an expired session. Throttle to once per 60 s with a ref timestamp.

`CustomerFormModal.jsx`:
- fetch branches with the existing `fetchBranches` query;
- `const { wide } = useAccess("customers")`;
- show a `FormSelect` named `BranchId`, labelled "Office", only when `wide && branches.length > 1`;
- default to `useAuthStore.getState().user.BranchId`;
- send `BranchId` on create; on edit send it only when changed.

`Customers.jsx`: add an "Office" column (`BranchName`, already returned by `sp_FetchCustomers`) when the page's rows have more than one distinct `BranchId`.

`useAssignableUsers(module = "leads")`: include `Module: module` in the body and in the query key. `TransferTicketModal` passes `"complaints"`.

`Leads.jsx` / `LeadDetail.jsx`: replace the bare `canCrossBranch` prop with `canCrossBranch={leadsAccess.wide}`, where `const leadsAccess = useAccess("leads")`. Delete the "canCrossBranch is always on here … once DataScope reaches the client" comment.

- [ ] **Step 4: Run** `pnpm exec vitest run`, then coverage on every touched file (`pnpm exec vitest run --coverage`). Expected: all green, touched files ≥80%. Run `pnpm lint`.

- [ ] **Step 5: Commit** (only if ordered).

---

### Task 8: Web — Roles grid, Offices screen, User form

**Files:**
- Modify: `web/src/pages/Master/Groups.jsx` (+ test), `web/src/api/masterQueries.js`
- Create: `web/src/pages/Master/Offices.jsx` (+ test); route `{ path: "/offices/*", element: <ProtectedRoute element={<Offices />} /> }` in `App.jsx` (lazy import like `Groups`)
- Modify: `web/src/pages/Master/components/UserForm.jsx` (+ test)

**Interfaces:**
- Consumes: `fetchGroupModules`, `saveGroupModules`, `saveBranch`, `fetchBranches`, `saveUserBranchAccess`/`deleteUserBranchAccess`/`fetchUserBranchAccess`, `useAccess`, `useIsAdmin`, `useCanSeeSensitive`.

- [ ] **Step 1: Failing tests**

`Groups.test.jsx`, replacing the menu-matrix cases:
```jsx
it("renders one row per grantable module with a reach select only on reach modules", async () => {
  // MSW fetchGroupModules -> modules [{Module:"leads",CanView:1,CanAdd:1,CanEdit:1,CanDelete:0,Reach:"Office"}]
  // expect rows: Leads, Sales reports, Complaints, Support reports, Customers, People, Tasks, Teams,
  //              Projects, Settings, Dashboard (11; no Roles/Offices)
  // expect a reach combobox in Leads/Complaints/Customers/People rows only; Leads shows "Office"
});
it("ticking Add ticks View; unticking View clears the row", async () => {});
it("saves Modules + CanSeeSensitive", async () => {
  // click save -> request body { GroupId, Modules: [...only viewed rows...], CanSeeSensitive: true }
});
it("an admin role shows a note instead of the grid", async () => { /* isAdmin -> "Administrators can do everything" */ });
```

`Offices.test.jsx`:
```jsx
it("draws the tree from ParentId", async () => {
  // branches: 1 HO (null), 2 Delhi (1), 3 Noida (1), 4 West HO (null) -> Delhi and Noida indented under HO
});
it("adds an office under a parent", async () => { /* "Add under" on HO -> modal -> saveBranch {Id:0, BranchName, ParentId:1} */ });
it("moving offers no descendants as parents", async () => { /* edit HO -> parent options exclude Delhi, Noida, HO */ });
it("shows the server's refusal", async () => { /* saveBranch 409 -> message in the modal */ });
```

`UserForm.test.jsx`:
```jsx
it("clearing Reports To on edit sends 0", async () => {});
it("leaving Reports To untouched on edit sends the current id", async () => {});
it("extra offices picker shows for a role with Office reach and saves each grant", async () => {});
it("hides Hourly rate, Mobile and Email inputs when the editor lacks the sensitive permission", async () => {});
it("office picker lists offices indented by depth", async () => {});
```

- [ ] **Step 2: Run** these three test files. Expected: FAIL.

- [ ] **Step 3: Implement**

`masterQueries.js`:
- add `userGroups.fetchGroupModules`, `userGroups.saveGroupModules`, `branches.saveBranch: "/api/branches/saveBranch"`, `auth.fetchMyAccess: "/api/auth/fetchMyAccess"`, and their `post(...)` exports;
- remove `fetchGroupAccess`/`saveGroupAccess`.

`Groups.jsx`:
- Keep the left panel (role list + create/edit/delete) as is.
- Replace the right-panel menu matrix with a module grid:
  ```jsx
  const MODULE_ROWS = [
    { key: "leads", label: "Leads, follow-ups, quotations", reach: true },
    { key: "sales_reports", label: "Sales reports" },
    { key: "complaints", label: "Complaints", reach: true },
    { key: "support_reports", label: "Support reports" },
    { key: "customers", label: "Customers", reach: true },
    { key: "people", label: "People", reach: true },
    { key: "tasks", label: "Tasks & My Work" },
    { key: "teams", label: "Teams" },
    { key: "projects", label: "Projects" },
    { key: "settings", label: "Settings & products" },
    { key: "dashboard", label: "Dashboard" },
  ];
  const REACH_OPTIONS = [
    { value: "Own", label: "Own records" },
    { value: "Team", label: "Their team" },
    { value: "Office", label: "Their office" },
    { value: "OfficeTree", label: "Their office + offices below" },
    { value: "Company", label: "Whole company" },
  ];
  ```
- Each row has four `Checkbox`es (reuse `PERMS`) and, for reach rows, a `Combobox` (from `components/ui`) with `REACH_OPTIONS`, defaulting to `Own` when View is ticked.
- Tick rules: ticking Add/Edit/Delete ticks View; unticking View clears the row.
- Below the grid, a `Checkbox` "Can see salary & contact details" bound to `canSeeSensitive`.
- Save sends `saveGroupModules({ GroupId, Modules: rows.filter((r) => r.CanView), CanSeeSensitive })`.
- When the fetched role has `isAdmin`, show `"Administrators can do everything; there is nothing to set."` instead of the grid.
- Update the file's header comment to the new contract.

`Offices.jsx`:
- `PageHeader` "Offices", a list built from `fetchBranches` rows as a tree:
  ```js
  // depth-first order with depth, children sorted by name
  export function toTree(rows) {
    const kids = new Map();
    for (const r of rows) {
      const p = r.ParentId ?? 0;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(r);
    }
    for (const list of kids.values()) list.sort((a, b) => a.BranchName.localeCompare(b.BranchName));
    const out = [];
    const walk = (parent, depth) => (kids.get(parent) || []).forEach((r) => { out.push({ ...r, depth }); walk(r.Id, depth + 1); });
    walk(0, 0);
    return out;
  }
  export const descendantsOf = (rows, id) => {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows) if (r.ParentId != null && out.has(r.ParentId) && !out.has(r.Id)) { out.add(r.Id); grew = true; }
    }
    return out;
  };
  ```
- Each row shows the name (indented `depth * 24px`), `PeopleCount` people and an inactive `Chip`. Actions: "Add under" and "Edit" (`IconButton`s).
- A `Modal` holds the name `TextInput`, the parent `Combobox` (options: all offices except `descendantsOf(rows, editing.Id)`, plus "Top level"), the address `TextInput`, and on edit an "Active" `Checkbox`.
- Save calls `saveBranch`, shows `res.message` in the modal on failure, and refetches on success.
- Put `toTree` and `descendantsOf` in `web/src/utils/officeTree.js` with their own test, since UserForm reuses `toTree`.

`UserForm.jsx`:
- **Office:** the `BranchId` `FormSelect` options become `toTree(branches)` labels with `"— ".repeat(depth)` prefixes, inactive offices excluded.
- **Reports To:** on submit, `ReportsTo: data.ReportsTo ?? (isEdit ? 0 : null)`. Change the field to send `0` when the user cleared it on edit. Untouched keeps the loaded value.
- **Hourly rate, Mobile, Email:** render only when `useCanSeeSensitive()`. When hidden, omit them from the payload; the server refuses the save anyway for a non-sensitive non-admin.
- **Extra offices** (admin only, `useIsAdmin()`):
  - a multi-select of the other offices, loaded from `fetchUserBranchAccess { UserId }`;
  - on save, diff against what was loaded: `saveUserBranchAccess { UserId, BranchId, CanRead: 1, CanWrite: 1 }` for each added office, `deleteUserBranchAccess { Id }` for each removed one;
  - read the payload shapes from `userBranchAccessController` before writing.

`menuBuilder`/`routeAccess` need no change: `/offices` arrives as a menu row under Admin from `sp_ValidateUser`. Confirm with one `routeAccess` test that a menu row with route `/offices` grants access to `/offices`.

- [ ] **Step 4: Run** `pnpm exec vitest run`, coverage on touched files ≥80%, and `pnpm lint`. Expected: green.

- [ ] **Step 5: Commit** (only if ordered).

---

### Task 9: Mobile + docs

**Files:**
- Modify: `mobile/src/types/api.ts` (`LoginResponse.data.access?: Access`), `mobile/src/utils/menuAccess.ts` (comment), `mobile/src/features/support/useTicketRefData.ts` and any `fetchAssignableUsers` caller (send `Module: "complaints"` / `"leads"`)
- Modify: `backend/ROLES.md` (rewrite to the new model), `CLAUDE.md` §3 "Roles, permissions & data scope"

- [ ] **Step 1: Mobile edits**
  - `menuAccess.ts`: change the header comment's "the server does not check them. The real gate is DataScope" to:
    > Menu rights come from the role's module grants. The server enforces those same grants on every route (spec 2026-10-07), so this only hides what the server would refuse.
  - Drop "Rights load at LOGIN … re-login" (the web refreshes on focus; mobile still loads at login, so say exactly that).
  - Add an `Access` type to `types/api.ts` matching Task 6's `publicAccess` shape.
  - Add `Module` to the `fetchAssignableUsers` payload in `api/userQueries.ts` (typed `"leads" | "complaints"`), and pass `"complaints"` from `useTicketRefData.ts`.

- [ ] **Step 2: Run** `cd mobile && pnpm typecheck && pnpm lint`. Expected: clean.

- [ ] **Step 3: Docs.**
  - **`backend/ROLES.md`:** replace the DataScope sections with the spec's §2–4. Keep it short:
    - the office tree;
    - module grants + reach table;
    - the one visibility rule;
    - enforcement (`requireModule` + route walk + SP lists);
    - the stock role table;
    - "tblGroupAccess / DataScope / HierarchyLevel are legacy, read by nothing".
  - **`CLAUDE.md` §3:** rewrite the "Roles, permissions & data scope" bullets to match.
    - Group = role holding per-module V/A/E/D + reach.
    - Reach is relative to the user's office (+ extras, + tree) and `ReportsTo` subtree.
    - Controllers read `req.scope` (bound by `requireModule`) or `scopeFor(req, module)`.
    - Every route declares access, and `routeAccess.test.js` fails otherwise.
    - Customers are per office.
    - Keep the universal "owner/assignee/creator always visible" rule, the filters-narrow rule, `IsAdmin` as a role property, and tasks being membership-governed.
    - Delete the "Known-open: menu rights are enforced server-side only on routes that opt in" sentence; it is closed.

- [ ] **Step 4: Commit** (only if ordered).

---

### Task 10: Live proof (after the user applies 096)

**Files:**
- Modify: scratchpad `matrix.mjs` → `matrix-org.mjs` (not in repo); output `matrix-org-out.txt`
- Create (for the user to apply after the run): `backend/sql/097_org_hierarchy_test_cleanup.sql`

- [ ] **Step 1: Verify the apply (read-only MCP):** run each query in 096's verify block and record the results.

- [ ] **Step 2: Start the local backend** (`cd backend && pnpm dev`, port 5001, DB `eCRM+`).

- [ ] **Step 3: Build the test company through the API** as the Owner (password from `CRM_PW` env, never written to a file):
  - **Offices:** via `saveBranch`, `QA North HO` → `QA Delhi`, `QA Noida`; `QA West HO` → `QA Mumbai`, `QA Pune`.
  - **Users:** one each of Regional Manager (home `QA North HO`), Branch Manager, Sales Team Lead, Sales Executive ×2, Support Agent and HR Manager in `QA Delhi`; Branch Manager + Sales Executive in `QA Noida`, `QA Mumbai`; Regional Manager in `QA West HO`.
  - **Records:** each Sales Executive creates 2 leads; each Support Agent and Executive creates 1 customer; each customer gets 1 complaint.
  - **Duplicate check:** the same mobile is used for the customers in `QA Delhi` and `QA Mumbai`.

- [ ] **Step 4: Assert, per caller** (log PASS/FAIL lines):
  1. **Every route × caller:** a 403 exactly where the role has no grant.
  2. **Leads, complaints and customers lists:** each caller sees exactly the records the spec rule predicts, computed independently in the script from office tree + reach + `ReportsTo`.
  3. **Head offices:** the North Regional Manager sees Delhi + Noida records and none from Mumbai/Pune; the West Regional Manager sees the reverse.
  4. **Siblings:** the Delhi Branch Manager sees nothing from Noida.
  5. **HR:** 403 on `fetchLeads`, `fetchTickets`, `funnel`, `ticketsByCategory`; `fetchUsers` returns everyone with salary/contact present.
  6. **Executive on `fetchUsers`:** everyone, with `HourlyRate`/`Mobile`/`Email` null except their own row.
  7. **Customer duplicates:** the same mobile saved in Delhi and Mumbai → both 200; the same mobile twice in Delhi → 409.
  8. **Cross-office customer:** a Delhi executive's `fetchCustomerDetail` on the Mumbai customer → 403; `saveTicket` with that `CustomerId` → 403.
  9. **ReportsTo:** an HR edit of a user without `ReportsTo` keeps the manager; with `0` clears it.
  10. **HR and admin:** HR `saveUser` with the Admin role → 403; editing the Owner → 403.
  11. **Office loop:** `saveBranch` moving `QA North HO` under `QA Delhi` → 400.
  12. **Union of roles:** a user in Sales Executive + Task Collaborator keeps leads Own and tasks.

- [ ] **Step 5: Browser pass** at `http://localhost:8080/prdcrm/login` (dev override → localhost:5001), as Owner, HR, the Delhi Branch Manager and an Executive:
  - sidebar per role;
  - the Roles grid;
  - the Offices tree (add/move);
  - the user form (Reports To clear, extra offices);
  - the customer office field.

- [ ] **Step 6: Report.**
  - Write the PASS/FAIL count and every FAIL with its cause to the user.
  - Fix FAILs through the owning task (new tests first).
  - Then write `097_org_hierarchy_test_cleanup.sql`: deactivate the QA users, deactivate the QA offices (after their people), soft-delete QA customers, and delete QA leads/complaints by the `QA ` name prefix, with a verify block. Hand it to the user.

- [ ] **Step 7: Notion log** (CLAUDE.md §0.5): Done + Change Log entries dated `2026-10-07` (or the actual ship date).
