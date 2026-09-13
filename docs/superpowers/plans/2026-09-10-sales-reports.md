# Sales Reports System (spec 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three single-number lead reports with a report *system*: one SP shape (three result sets), one backend helper, one web frame, eight reports, drill-down into the Leads list, and a deterministic backdated demo seed that makes the charts real.

**Architecture:** Three SQL scripts the owner applies by hand (`075` schema + 8 report SPs + menu rows, `076` demo seed, `077` demo removal). Backend gains `utils/reportKit.js` (`parseReportArgs` + `runReport`) and eight one-line controller methods that all post `{ kpis, rows, trend, range }`. Web gains `pages/Reports/ReportPage.jsx` (filter bar → KPI strip → trend → breakdown table → drill) and eight ≤ 60-line page files that are a config object plus `<ReportPage/>`. Every report SP applies the exact scope predicate `sp_FetchLeads` uses, which fixes the live-test finding that Team/Self callers saw branch totals.

**Tech Stack:** SQL Server (T-SQL, `CREATE OR ALTER`), Node 22 + Express 5 + mssql (Jest + Supertest), React 19 + Vite + MUI 9 + TanStack Query 5 + react-router 7 + recharts 3 (Vitest + RTL + MSW).

**Spec:** `docs/superpowers/specs/2026-09-10-sales-reports-design.md` (binding). Builds on `docs/superpowers/specs/2026-09-08-sales-foundation-hierarchy-design.md` (shipped `eec3a36`, SQL `071`–`074` applied).

## Global Constraints

- **pnpm only.** Never npm.
- **Git is read-only for the implementer.** Every task ends with "Stop and report" — the owner commits. Never `git add`/`commit`/`push`/`stash`/`checkout`.
- **SQL is never applied by the implementer.** `075`, `076`, `077` are written to `backend/sql/` and the owner runs them by hand. Live DB reads through `mcp__sqlserver-ecrm__read_query` / `describe_table` are allowed for verification; never `write_query`/`create_table`/`alter_table`/`drop_table`/`sqlcmd`.
- **Test-first, ≥ 80 % line/branch on every touched file** in `backend/src/` and `web/src/`. Global floor 60 %. Never `.only`/`.skip`/`xit`.
- **MEMORY-SAFE test rules (verbatim, every task):** one test file per run; Bash timeout ≤ 300000; never `pnpm test`; never bare `vitest`; never a full-suite run except the final task; never `pnpm build` except the final task; max 3 attempts on a failing test then report BLOCKED.
- **Jest command shape:** `cd backend && pnpm exec jest <file> --maxWorkers=2 --silent` (add `--coverage --collectCoverageFrom='<src file>'` on the GREEN run). **Vitest command shape:** `cd web && pnpm exec vitest run <file>` (add `--coverage --coverage.include=<src file>` on the GREEN run).
- **MUI v9**: `slotProps`, never `InputProps`/`inputProps`. Use `components/ui/*` primitives (`Combobox`, `DateField`, `Tabs`, `Chip`, `Button`) and the existing `components/StatCard.jsx` (`StatisticsCard`) for KPI tiles — no new stat-card component (spec §5: "reuse if one exists").
- **Every route is `POST`** under `/api/reports/<camelCase>`; every SP call carries `CompId` from `req.user` and visibility from `scopeParams(req)` (`UserId`, `AccessibleBranchIdsJson`, `OwnerIdsJson`). Never `req.user.BranchId` as a filter.
- **Report SP contract (spec §3), identical for all eight:** params `@CompId INT, @FromDate DATE, @ToDate DATE, @DateBasis VARCHAR(10) = 'created', @BranchId INT = NULL, @OwnerId INT = NULL, @SourceId INT = NULL, @ProductId INT = NULL, @GroupBy VARCHAR(20), @UserId INT = NULL, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL`. Three result sets: RS1 one KPI row (named columns), RS2 breakdown rows starting `GroupKey INT NULL, GroupLabel NVARCHAR(200)`, RS3 trend rows starting `Bucket DATE` — weekly (`DATEADD(WEEK, DATEDIFF(WEEK, 0, x), 0)`) when the range > 31 days, else daily. `@ToDate` inclusive (`< DATEADD(DAY, 1, @ToDate)`). No `ResponseCode` columns. Unknown `@GroupBy` → `RAISERROR(…, 16, 1)` in the SP; the controller whitelist is what answers 400.
- **Scope predicate (copied from `sp_FetchLeads`, `071:1200-1210`), verbatim in every report SP:** `( ((@UseBranchScope = 0 OR l.BranchId IN @BranchIds) AND (@UseOwnerScope = 0 OR l.OwnerId IN @OwnerIds)) OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId)) )`. Optional filters narrow inside it, never widen.
- **Live reference ids (company 1):** `lead_status` 29 New · 30 Contacted · 31 Follow-up (Code `open`), 32 Qualified (`qualified`), 33 Lost (`lost`), 34 Junk (`junk`); `lead_source` 11 Website · 12 Referral · 13 Phone · 14 Walk-in · 15 Advertisement · 16 Social Media; `lost_reason` 22 Price · 23 Chose Competitor · 24 No Budget · 25 Not Interested · 26 No Response; `call_outcome` 17 Connected · 18 No Answer · 19 Busy · 20 Wrong Number · 21 Callback Requested; `transfer_reason` 36 Absent · 37 Overloaded · 38 Wrong branch · 39 Sent back to manager · 40 Reassigned by manager · 41 Other; `product_category` 35 General. Branches 1 HEAD OFFICE · 2 SOUTH EXTENSION · 3 INDIRAPURAM · 4 SADHNA · 5 GOLDEN I. Groups: Sales Head 9 · Regional Manager 12 · Branch Manager 13 · Sales Team Lead 15 · Sales Executive 16. Test users: 13 sh_priya · 14 rm_arjun · 15 bm_ho_rahul · 16 tl_ho_neha · 17 se_ho_amit · 18 se_ho_sara · 19 se_ho_karan · 20 bm_se_vikram · 21 se_se_pooja · 22 se_se_dev (shared test password — not recorded here). Products: 1 Gold Chain 22K (`GC22`, ₹85,000) · 2 Diamond Ring Solitaire (`DR01`, ₹150,000) · 3 Silver Anklet (`SA01`, ₹4,500) · 4 Platinum Band (`PB01`, ₹60,000). Menu parent 11 = Sales Reports with children 20 / 21 / 22; row-20 grants = groups 1, 2, 9, 12, 13, 15, 18, 21, 22, 24 (`tblGroupAccess` holds duplicate rows per group today — every clone uses `DISTINCT` + `NOT EXISTS`). `tblUser` has no `GroupId`; membership is `tblUserGroupMap`.
- **Seed is deterministic (spec §6):** numbers table + `(n * 7919) % 1000`-style hashes; **no `NEWID()`/`RAND()`**; idempotent by deleting `Name LIKE 'DEMO %'` first; demo users `Username LIKE 'demo_%'`; `Password` copied from `se_ho_amit`.
- **Rollout order (spec §7):** `075` → backend deploy → `076` → web deploy → owner walkthrough → `077` when demo data is no longer wanted. Old endpoints `leadsByStatus` / `callsPerUser` / `conversionBySource` / `getConvertedSummary` stay one release.
- **Mobile is out of scope.** Nothing under `mobile/` changes.

**Spec ambiguities resolved in this plan** (each is called out again in the task that implements it):
1. `sp_FetchLeads` has no date params, yet spec §5 has `Leads.jsx` reading `from`/`to` for drill-down → `075` adds `@FromDate DATE = NULL, @ToDate DATE = NULL` (narrows on `CreatedAt`) and `leadController.fetch` forwards them.
2. Spec §2 says insert rows for all 8 routes **and** re-point 20/21/22 — that would put 11 rows (3 duplicates) in the sidebar → rows 20/21/22 are re-pointed (Funnel / Activity / Conversion by Source) and only the **6 remaining** routes are inserted, grants cloned from row 20.
3. `ReportShell.jsx` cannot be retired: `TicketsByCategory` and `ResolutionSummary` (spec 2) still import it → it stays; `ReportTable` gains an optional `onRowClick` and the new frame reuses it. The new file is `ReportPage.jsx` (default export) as the spec names it.
4. `Charts/AreaTrend.jsx` is hard-wired to `leads`/`converted` keys with a sample-data fallback and KPI strip (dashboard-specific) → reports get a generic `Charts/TrendArea.jsx` (`series: [{key,label,tone}]`).
5. Unknown `@GroupBy`: SP `RAISERROR`, controller whitelist → 400 (spec left the choice to the planner).
6. `sp_RptTransfers` needs a `pair` GroupBy (spec's "from→to pair" is not in the §3 GroupBy list) → whitelist `reason | pair | branch` for that report only.
7. Date basis per family: lead-cohort SPs (`Funnel`, `Lost`, `PipelineValue`, `Aging` trend) honour all three; follow-up SPs use `created` = `DueAt`, `closed`/`activity` = `COALESCE(DoneAt, DueAt)`; `Activity`, `Transfers`, `Leaderboard` have one natural date (`DoneAt` / `AssignedAt` / lead `CreatedAt`) and ignore the basis. `Aging` KPIs/rows are a snapshot as of now; the date range drives its trend only.
8. The livetest runner at the scratchpad path named in the brief does not exist on disk (`livetest/` is gone); its `lib.mjs` was recovered from the session log and is recreated verbatim in Task 21.

---

## File structure

**SQL — create (`backend/sql/`, user-applied, deleted after apply)**
| File | Responsibility |
|---|---|
| `075_sales_reports.sql` | `tblLeadStatusHistory` + backfill; `sp_SaveLead` / `sp_SetLeadStatus` write history; `sp_FetchLeads` `@FromDate/@ToDate`; the 8 `sp_Rpt*` procs; menu rows + grants; verify block |
| `076_seed_sales_demo.sql` | deterministic backdated demo: 4 users, 2 products, 600 leads, follow-ups, history, transfers; verify prints distributions + each SP's KPI row |
| `077_remove_sales_demo.sql` | removes everything `076` created |

**Backend — create**
| File | Responsibility |
|---|---|
| `backend/src/utils/reportKit.js` | `REPORTS` (sp name + GroupBy whitelist per report), `parseReportArgs(body, key, today)`, `runReport(spName, req, res, key)` |
| `backend/tests/unit/utils/reportKit.test.js` | validation, defaults, scope pass-through, response shape |

**Backend — modify**
| File | Change |
|---|---|
| `backend/src/controllers/reportController.js` | `+funnel, followUpCompliance, activity, lost, aging, transfers, pipelineValue, leaderboard` (each = `asyncRoute(runReport)`); old four stay |
| `backend/src/routes/reportRoutes.js` | `+8 POST routes` |
| `backend/src/controllers/leadController.js` | `fetch` forwards `FromDate`/`ToDate` (ISO day or null) |
| `backend/tests/unit/controllers/reportController.test.js` | + one describe per new method (happy + 400) |
| `backend/tests/unit/routes/reportRoutes.test.js` | + 8 routes in the mock + table |
| `backend/tests/unit/controllers/leadController.test.js` | + date pass-through test |

**Web — create**
| File | Responsibility |
|---|---|
| `web/src/pages/Reports/reportUtils.js` (+`.test.js`) | pure helpers: `PRESETS`, `DATE_BASES`, `presetRange`, `readFilters`, `writeFilters`, `toBody`, `formatValue`, `toCsv`, `leadsUrl`, `drillParams` |
| `web/src/components/Charts/TrendArea.jsx` (+`.test.jsx`) | generic multi-series recharts area chart, theme tokens, dark-mode aware |
| `web/src/pages/Reports/ReportPage.jsx` (+`.test.jsx`) | the frame: URL-backed filters → KPI tiles → trend → table → drill; CSV export |
| `web/src/test/reportMocks.js` | `mockReportEndpoints(path, data, capture)` — the five MSW handlers every report page test needs |
| `web/src/pages/Reports/{Funnel,FollowUpCompliance,Activity,Lost,Aging,Transfers,PipelineValue,Leaderboard}.jsx` (+`.test.jsx` each) | config + `<ReportPage/>` |

**Web — modify**
| File | Change |
|---|---|
| `web/src/pages/Reports/ReportShell.jsx` | `ReportTable` gains `onRowClick` |
| `web/src/api/salesQueries.js` (+`.test.js`) | `reports` = the 8 new endpoints; old three fetchers removed |
| `web/src/pages/Sales/leadStatus.js` (+`.test.js`) | `+leadsParamsToState(params)` |
| `web/src/pages/Sales/Leads.jsx` (+`.test.jsx`) | reads URL params on mount; date-range chip; `FromDate`/`ToDate` in `extraParams` |
| `web/src/App.jsx` | 8 routes, 3 redirects, `/reports` fallback → `/reports/funnel` |
| `web/src/App.routes.test.jsx` | updated expectations |
| `web/src/data/helpGuides.js` | `+reports` guide |

**Web — delete** (Task 20, after the redirects exist)
`pages/Reports/LeadsByStatus.jsx`, `LeadsByStatus.test.jsx`, `CallsPerUser.jsx`, `CallsPerUser.test.jsx`, `ConversionBySource.jsx`, `ConversionBySource.test.jsx`.

---

### Task 1: `075_sales_reports.sql` — part A: status history, write paths, `sp_FetchLeads` dates

**Files:**
- Create: `backend/sql/075_sales_reports.sql` (this task writes the header + sections 1–4; Tasks 2–4 append to the same file)

**Interfaces:**
- Produces: `dbo.tblLeadStatusHistory (Id, CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)`; `sp_SaveLead` inserts `(NULL → @StatusId)` on create; `sp_SetLeadStatus` inserts `(old → new)`; `sp_FetchLeads` accepts `@FromDate DATE = NULL, @ToDate DATE = NULL` (narrow on `CreatedAt`, `@ToDate` inclusive). Tasks 2–4 read the history table; Task 7 sends the dates.
- Resolves ambiguity 1.

- [ ] **Step 1: Write the file header + sections 1–4**

```sql
-- ============================================================================
-- 075_sales_reports.sql
--
-- Spec 4a — the sales report system.
-- Design: docs/superpowers/specs/2026-09-10-sales-reports-design.md
--
-- What changes and why:
--   * tblLeadStatusHistory — every status change, written by sp_SaveLead
--     (insert path) and sp_SetLeadStatus in the same transaction. The funnel
--     over time and "days per step" cannot be derived from tblLeads alone.
--     Backfilled with one opening row per existing lead.
--   * sp_FetchLeads gains @FromDate/@ToDate (CreatedAt window) so a report
--     number can drill into the exact list it counted.
--   * Eight read-only report procs, sp_Rpt*, one contract (spec §3): same
--     twelve params, three result sets (KPIs · breakdown · trend), branch AND
--     owner scope exactly as sp_FetchLeads applies it. This closes the live
--     test finding that a Team/Self caller saw branch totals.
--   * Sidebar: rows 20/21/22 re-pointed to the new pages (grants carry over),
--     six new rows cloned from row 20. Menu rights load at LOGIN — re-login.
--
-- APPLY BY HAND, top to bottom, in one go. Idempotent: DDL guarded, procs are
-- CREATE OR ALTER, menu inserts use NOT EXISTS. The verify block at the bottom
-- rolls back its dry run.
--
-- Deploy the backend AFTER this is applied — the new endpoints call sp_Rpt*
-- and leadController sends @FromDate/@ToDate to sp_FetchLeads.
--
-- Author: Claude  Date: 2026-09-10
-- ============================================================================

IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO

-- ---------------------------------------------------------------------------
-- 1. tblLeadStatusHistory
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblLeadStatusHistory') IS NULL
BEGIN
    CREATE TABLE dbo.tblLeadStatusHistory (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblLeadStatusHistory PRIMARY KEY,
        CompId       INT NOT NULL,
        LeadId       INT NOT NULL,
        FromStatusId INT NULL,
        ToStatusId   INT NOT NULL,
        ChangedBy    INT NULL,
        ChangedAt    DATETIME NOT NULL CONSTRAINT DF_tblLeadStatusHistory_ChangedAt DEFAULT GETDATE()
    );
    CREATE INDEX IX_tblLeadStatusHistory_CompId_LeadId_ChangedAt     ON dbo.tblLeadStatusHistory (CompId, LeadId, ChangedAt);
    CREATE INDEX IX_tblLeadStatusHistory_CompId_ToStatusId_ChangedAt ON dbo.tblLeadStatusHistory (CompId, ToStatusId, ChangedAt);
END
GO

-- Backfill: one opening row (NULL -> current status, at CreatedAt) per lead
-- that has no history yet. Re-run safe.
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT l.CompId, l.Id, NULL, l.StatusId, l.CreatedBy, l.CreatedAt
FROM dbo.tblLeads l
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLeadStatusHistory h WHERE h.LeadId = l.Id AND h.CompId = l.CompId);
GO


-- ---------------------------------------------------------------------------
-- 2. sp_SaveLead — unchanged from 071 except the history row on insert
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveLead
    @Id               INT            = 0,
    @CompId           INT,
    @BranchId         INT,
    @UserId           INT,
    @Name             NVARCHAR(200),
    @Company          NVARCHAR(200)  = NULL,
    @MobileNo         VARCHAR(20)    = NULL,
    @AltMobile        VARCHAR(20)    = NULL,
    @Email            VARCHAR(150)   = NULL,
    @Address          NVARCHAR(500)  = NULL,
    @City             NVARCHAR(100)  = NULL,
    @State            NVARCHAR(100)  = NULL,
    @Pincode          VARCHAR(10)    = NULL,
    @SourceId         INT            = NULL,
    @ProductId        INT            = NULL,
    @StatusId         INT            = NULL,
    @OwnerId          INT            = NULL,
    @EstValue         DECIMAL(18,2)  = NULL,
    @Remarks          NVARCHAR(MAX)  = NULL,
    @FirstFollowupAt  DATETIME       = NULL,
    @CustomJSON       NVARCHAR(MAX)  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF @ProductId IS NOT NULL AND @ProductId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id=@ProductId AND CompId=@CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid product' AS ResponseMess; RETURN; END
    IF @OwnerId IS NOT NULL AND @OwnerId <= 0 SET @OwnerId = NULL;
    IF @OwnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id=@OwnerId AND CompId=@CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid owner' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @LeadId INT = @Id;

        IF @Id > 0
        BEGIN
            UPDATE dbo.tblLeads
            SET Name = @Name, Company = @Company, MobileNo = @MobileNo, AltMobile = @AltMobile,
                Email = @Email, Address = @Address, City = @City, State = @State, Pincode = @Pincode,
                SourceId = @SourceId, ProductId = @ProductId, EstValue = @EstValue, Remarks = @Remarks,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;
        END
        ELSE
        BEGIN
            IF @StatusId IS NULL OR @StatusId <= 0
                SET @StatusId = (SELECT TOP 1 Id FROM dbo.tblLookup
                                 WHERE CompId=@CompId AND Kind='lead_status' AND Code='open' AND IsActive=1
                                 ORDER BY SortOrder, Id);
            IF @StatusId IS NULL
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, 500 AS ResponseCode, 'No lead_status lookups configured for this company' AS ResponseMess;
                RETURN;
            END
            IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@StatusId AND CompId=@CompId AND Kind='lead_status')
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid status' AS ResponseMess;
                RETURN;
            END

            INSERT INTO dbo.tblLeads
                (CompId, BranchId, Name, Company, MobileNo, AltMobile, Email,
                 Address, City, State, Pincode, SourceId, ProductId, StatusId, OwnerId,
                 EstValue, Remarks, AssignedAt, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @Name, @Company, @MobileNo, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @SourceId, @ProductId, @StatusId, @OwnerId,
                 @EstValue, @Remarks, CASE WHEN @OwnerId IS NULL THEN NULL ELSE GETDATE() END,
                 @UserId, @UserId, GETDATE());

            SET @LeadId = CAST(SCOPE_IDENTITY() AS INT);

            -- 075: opening row of the status history (NULL -> first status).
            INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy)
            VALUES (@CompId, @LeadId, NULL, @StatusId, @UserId);

            -- The first follow-up: today unless the form said otherwise.
            DECLARE @DueAt DATETIME = ISNULL(@FirstFollowupAt, CAST(CAST(GETDATE() AS DATE) AS DATETIME));
            INSERT INTO dbo.tblFollowUp (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, CreatedBy)
            VALUES (@CompId, @BranchId, @LeadId, 'call', @DueAt, @OwnerId, 'open', @UserId);

            UPDATE dbo.tblLeads SET NextFollowupDate = @DueAt WHERE Id = @LeadId;

            -- Opening record on the timeline; carries the assignment too, so a
            -- lead created straight onto someone shows who and when.
            IF @OwnerId IS NOT NULL
                INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy)
                VALUES (@CompId, @LeadId, NULL, @OwnerId, NULL, @BranchId, NULL, N'Assigned on creation', @UserId);
        END

        -- Custom-field values. JSON: [{fieldId,type,value}].
        IF @CustomJSON IS NOT NULL AND LTRIM(RTRIM(@CustomJSON)) NOT IN ('', '[]')
        BEGIN
            ;WITH src AS (
                SELECT j.fieldId,
                       CASE WHEN j.type IN ('dropdown','text') THEN j.val END AS ValueText,
                       CASE WHEN j.type = 'number'   THEN TRY_CONVERT(DECIMAL(18,2), j.val)
                            WHEN j.type = 'checkbox'  THEN CASE WHEN j.val = 'true' THEN 1 ELSE 0 END
                       END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CONVERT(DATETIME, j.val) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                     WITH (fieldId INT '$.fieldId',
                           type    VARCHAR(20) '$.type',
                           val     NVARCHAR(MAX) '$.value') j
                WHERE j.fieldId IS NOT NULL
            )
            MERGE dbo.tblCustomFieldValue AS tgt
            USING src
               ON tgt.CompId = @CompId AND tgt.Entity = 'lead'
              AND tgt.EntityId = @LeadId AND tgt.FieldId = src.fieldId
            WHEN MATCHED THEN
                UPDATE SET ValueText = src.ValueText, ValueNumber = src.ValueNumber, ValueDate = src.ValueDate
            WHEN NOT MATCHED THEN
                INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                VALUES (@CompId, 'lead', @LeadId, src.fieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        DECLARE @ActType VARCHAR(30) = CASE WHEN @Id > 0 THEN 'updated' ELSE 'created' END;
        DECLARE @ActSummary NVARCHAR(500) = CASE WHEN @Id > 0 THEN N'Lead details updated' ELSE N'Lead created' END;
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = @ActType, @Summary = @ActSummary, @MetaJSON = NULL;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 3. sp_SetLeadStatus — unchanged from 071 except the history row
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SetLeadStatus
    @CompId       INT,
    @LeadId       INT,
    @StatusId     INT,
    @LostReasonId INT = NULL,
    @UserId       INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END
    IF @StatusId IS NULL OR @StatusId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'StatusId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200);
    SELECT @FromStatusId = l.StatusId, @FromCode = st.Code, @FromName = st.Value
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    IF @FromStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    DECLARE @ToCode VARCHAR(30), @ToName NVARCHAR(200);
    SELECT @ToCode = Code, @ToName = Value FROM dbo.tblLookup
    WHERE Id = @StatusId AND CompId = @CompId AND Kind = 'lead_status' AND IsActive = 1;
    IF @ToCode IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Status not found' AS ResponseMess; RETURN; END

    IF @ToCode = 'converted'
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Use convert to move a lead to Converted' AS ResponseMess; RETURN; END

    IF @ToCode = 'lost' AND (@LostReasonId IS NULL OR @LostReasonId <= 0)
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Lost reason required' AS ResponseMess; RETURN; END
    IF @ToCode = 'lost'
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@LostReasonId AND CompId=@CompId AND Kind='lost_reason')
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Invalid lost reason' AS ResponseMess; RETURN; END

    IF @FromStatusId = @StatusId
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead already in this status' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblLeads
        SET StatusId = @StatusId,
            LostAt       = CASE WHEN @ToCode = 'lost' THEN GETDATE() ELSE NULL END,
            LostReasonId = CASE WHEN @ToCode = 'lost' THEN @LostReasonId ELSE NULL END,
            EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id = @LeadId AND CompId = @CompId;

        -- 075: the transition, in the same transaction as the update.
        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy)
        VALUES (@CompId, @LeadId, @FromStatusId, @StatusId, @UserId);

        DECLARE @Summary NVARCHAR(500) = N'Status: ' + @FromName + N' → ' + @ToName;
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @StatusId AS toStatusId,
                                              @FromCode AS fromCode, @ToCode AS toCode,
                                              @LostReasonId AS lostReasonId
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead status updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 4. sp_FetchLeads — unchanged from 071 except @FromDate/@ToDate (CreatedAt
--    window, @ToDate inclusive). Report drill-downs land here with the range
--    they counted, so the list matches the number.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLeads
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 10,
    @SearchTerm              NVARCHAR(200) = NULL,
    @StatusId                INT           = NULL,
    @StatusCode              VARCHAR(30)   = NULL,
    @ProductId               INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @Overdue                 BIT           = 0,
    @Unassigned              BIT           = 0,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,10) < 1 THEN 10 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @StatusCode IS NOT NULL AND LTRIM(RTRIM(@StatusCode)) = '' SET @StatusCode = NULL;
    DECLARE @ToEx DATETIME = CASE WHEN @ToDate IS NULL THEN NULL ELSE DATEADD(DAY, 1, CAST(@ToDate AS DATETIME)) END;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;

    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    DECLARE @Page TABLE (Id INT, Total INT, rn INT);
    INSERT INTO @Page (Id, Total, rn)
    SELECT l.Id, COUNT(*) OVER (), ROW_NUMBER() OVER (
               ORDER BY CASE WHEN @Overdue = 1 THEN l.NextFollowupDate END ASC,
                        l.CreatedAt DESC, l.Id DESC)
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId
      AND (@BranchId   IS NULL OR l.BranchId  = @BranchId)
      AND (@StatusId   IS NULL OR l.StatusId  = @StatusId)
      AND (@StatusCode IS NULL OR st.Code     = @StatusCode)
      AND (@ProductId  IS NULL OR l.ProductId = @ProductId)
      AND (@OwnerId    IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId   IS NULL OR l.SourceId  = @SourceId)
      AND (@Unassigned = 0 OR l.OwnerId IS NULL)
      AND (@Overdue = 0 OR (l.NextFollowupDate < @Today AND st.Code IN ('open','qualified')))
      AND (@FromDate IS NULL OR l.CreatedAt >= @FromDate)
      AND (@ToEx     IS NULL OR l.CreatedAt <  @ToEx)
      AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                              OR l.Company LIKE '%' + @SearchTerm + '%'
                              OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                              OR l.Email LIKE '%' + @SearchTerm + '%'
                              OR l.City LIKE '%' + @SearchTerm + '%')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )
    ORDER BY CASE WHEN @Overdue = 1 THEN l.NextFollowupDate END ASC, l.CreatedAt DESC, l.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1: page of leads
    SELECT l.Id, l.CompId, l.BranchId, b.BranchName,
           l.Name, l.Company, l.MobileNo, l.AltMobile, l.Email,
           l.Address, l.City, l.State, l.Pincode,
           l.SourceId, src.Value AS SourceName,
           l.ProductId, p.Name AS ProductName,
           l.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           l.OwnerId, o.FullName AS OwnerName, o.Avatar AS OwnerAvatar,
           l.EstValue, l.Remarks, l.NextFollowupDate,
           CAST(CASE WHEN l.NextFollowupDate < @Today AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           l.LostReasonId, l.WonAt, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           200 AS ResponseCode, 'Leads retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblLeads l ON l.Id = x.Id
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblProduct p ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    ORDER BY x.rn;

    -- Result set 2: pagination
    DECLARE @Total INT = ISNULL((SELECT MAX(Total) FROM @Page), 0);
    IF @Total = 0 AND @PageNumber > 1
        -- Asked for a page past the end: count still matters for the client.
        SELECT @Total = COUNT(*)
        FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
        WHERE l.CompId = @CompId
          AND (@BranchId   IS NULL OR l.BranchId  = @BranchId)
          AND (@StatusId   IS NULL OR l.StatusId  = @StatusId)
          AND (@StatusCode IS NULL OR st.Code     = @StatusCode)
          AND (@ProductId  IS NULL OR l.ProductId = @ProductId)
          AND (@OwnerId    IS NULL OR l.OwnerId   = @OwnerId)
          AND (@SourceId   IS NULL OR l.SourceId  = @SourceId)
          AND (@Unassigned = 0 OR l.OwnerId IS NULL)
          AND (@Overdue = 0 OR (l.NextFollowupDate < @Today AND st.Code IN ('open','qualified')))
          AND (@FromDate IS NULL OR l.CreatedAt >= @FromDate)
          AND (@ToEx     IS NULL OR l.CreatedAt <  @ToEx)
          AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                                  OR l.Company LIKE '%' + @SearchTerm + '%'
                                  OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                                  OR l.Email LIKE '%' + @SearchTerm + '%'
                                  OR l.City LIKE '%' + @SearchTerm + '%')
          AND (
                (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
              );

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;
END
GO
```

- [ ] **Step 2: Sanity-check the file parses as T-SQL batches**

Run: `cd backend && grep -c "^GO$" sql/075_sales_reports.sql`
Expected: `8` (one per batch above). Also `grep -n "sp_FetchLeads\b" sql/075_sales_reports.sql | head -1` prints the CREATE line.

- [ ] **Step 3: Stop and report** — path of the file; note that Tasks 2–4 append to it and the owner applies it only after Task 4 is complete.

---

### Task 2: `075` — part B: `sp_RptFunnel`, `sp_RptLost`, `sp_RptPipelineValue` (lead-cohort family)

**Files:**
- Modify: `backend/sql/075_sales_reports.sql` (append section 5)

**Interfaces:**
- Consumes: `tblLeadStatusHistory` (Task 1), `tblLeads`, `tblFollowUp`, `tblLookup`, `tblProduct`, `tblUser`, `tblBranch`.
- Produces (all three follow the Global Constraints contract):
  - `sp_RptFunnel` — GroupBy `source|owner|product|branch|status|team`. RS1 `Created, Contacted, Qualified, Lost, Junk, QualifiedPct, LostPct, AvgDaysToContact, AvgDaysToQualify`. RS2 `GroupKey, GroupLabel` + the same nine. RS3 `Bucket, Created, Qualified, Lost`.
  - `sp_RptLost` — GroupBy `reason|source|product|owner|branch`. RS1 `Lost, LostPct, TopReason`. RS2 `GroupKey, GroupLabel, SubKey, SubLabel, Lost, LostPct` (`SubKey/SubLabel` NULL when `@GroupBy='reason'`). RS3 `Bucket, Lost`.
  - `sp_RptPipelineValue` — GroupBy `status|owner|product|branch`. RS1 `OpenValue, QualifiedValue, LostValue, OpenCount, AvgValue`. RS2 `GroupKey, GroupLabel, Count, Value`. RS3 `Bucket, OpenValue`.
- Date basis (ambiguity 7): `created` = `CreatedAt`; `closed` = latest terminal transition in history (`qualified`/`lost`/`junk`); `activity` = last done follow-up `DoneAt`. Leads whose basis date is NULL or outside the range are excluded.
- "Contacted" = first history row with `FromStatusId IS NOT NULL` **or** first done follow-up, whichever is earlier.

- [ ] **Step 1: Append section 5 to `075_sales_reports.sql`**

```sql
-- ===========================================================================
-- 5. REPORT PROCS — lead-cohort family
--
-- Contract (spec §3): same twelve params, three result sets, no ResponseCode.
-- Scope predicate copied from sp_FetchLeads. The scoped, basis-dated lead set
-- is materialised once into #L, then read three times.
-- ===========================================================================

CREATE OR ALTER PROC dbo.sp_RptFunnel
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'source',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy NOT IN ('source','owner','product','branch','status','team')
    BEGIN RAISERROR('sp_RptFunnel: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT l.Id, l.CreatedAt,
           CASE @GroupBy WHEN 'source'  THEN l.SourceId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'branch'  THEN l.BranchId
                         WHEN 'status'  THEN l.StatusId
                         WHEN 'team'    THEN ISNULL(o.ReportsTo, o.Id) END AS GroupKey,
           CASE @GroupBy WHEN 'source'  THEN ISNULL(src.Value, N'No source')
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—')
                         WHEN 'status'  THEN st.Value
                         WHEN 'team'    THEN ISNULL(mgr.FullName, ISNULL(o.FullName, N'Unassigned')) END AS GroupLabel,
           c.ContactedAt, c.QualifiedAt, c.LostAt, c.JunkAt,
           d.EventAt,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st       ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblProduct p  ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o     ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblUser mgr   ON mgr.Id = o.ReportsTo
    LEFT JOIN dbo.tblBranch b   ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT
          (SELECT MIN(x.At) FROM (
               SELECT h.ChangedAt AS At FROM dbo.tblLeadStatusHistory h WHERE h.LeadId = l.Id AND h.FromStatusId IS NOT NULL
               UNION ALL
               SELECT f.DoneAt FROM dbo.tblFollowUp f WHERE f.LeadId = l.Id AND f.Status = 'done') x) AS ContactedAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.LeadId = l.Id AND s.Code = 'qualified') AS QualifiedAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.LeadId = l.Id AND s.Code = 'lost') AS LostAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.LeadId = l.Id AND s.Code = 'junk') AS JunkAt,
          (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f WHERE f.LeadId = l.Id AND f.Status = 'done') AS LastActivityAt
    ) c
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(v) FROM (VALUES (c.QualifiedAt), (c.LostAt), (c.JunkAt)) t(v))
                 WHEN 'activity' THEN c.LastActivityAt
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1: KPIs
    SELECT COUNT(*) AS Created,
           ISNULL(SUM(CASE WHEN ContactedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS Contacted,
           ISNULL(SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS Qualified,
           ISNULL(SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END), 0) AS Lost,
           ISNULL(SUM(CASE WHEN JunkAt      IS NOT NULL THEN 1 ELSE 0 END), 0) AS Junk,
           CAST(100.0 * SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS QualifiedPct,
           CAST(100.0 * SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS LostPct,
           CAST(AVG(CASE WHEN ContactedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, ContactedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToContact,
           CAST(AVG(CASE WHEN QualifiedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, QualifiedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToQualify
    FROM #L;

    -- RS2: breakdown
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS Created,
           SUM(CASE WHEN ContactedAt IS NOT NULL THEN 1 ELSE 0 END) AS Contacted,
           SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) AS Qualified,
           SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) AS Lost,
           SUM(CASE WHEN JunkAt      IS NOT NULL THEN 1 ELSE 0 END) AS Junk,
           CAST(100.0 * SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) AS DECIMAL(5,1)) AS QualifiedPct,
           CAST(100.0 * SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) AS DECIMAL(5,1)) AS LostPct,
           CAST(AVG(CASE WHEN ContactedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, ContactedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToContact,
           CAST(AVG(CASE WHEN QualifiedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, QualifiedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToQualify
    FROM #L
    GROUP BY GroupKey, GroupLabel
    ORDER BY Created DESC, GroupLabel;

    -- RS3: trend
    SELECT Bucket,
           COUNT(*) AS Created,
           SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) AS Qualified,
           SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) AS Lost
    FROM #L
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


CREATE OR ALTER PROC dbo.sp_RptLost
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'reason',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy NOT IN ('reason','source','product','owner','branch')
    BEGIN RAISERROR('sp_RptLost: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    -- Every scoped lead dated on the basis; IsLost marks the subset. LostPct
    -- is lost / all, so the denominator has to be here too.
    SELECT l.Id,
           CASE WHEN st.Code = 'lost' THEN 1 ELSE 0 END AS IsLost,
           l.LostReasonId,
           ISNULL(lr.Value, N'No reason') AS ReasonLabel,
           CASE @GroupBy WHEN 'source'  THEN l.SourceId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'branch'  THEN l.BranchId END AS SubKey,
           CASE @GroupBy WHEN 'source'  THEN ISNULL(src.Value, N'No source')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—') END AS SubLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st       ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup lr  ON lr.Id = l.LostReasonId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblProduct p  ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o     ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblBranch b   ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
                                        WHERE h.LeadId = l.Id AND s.Code IN ('qualified','lost','junk'))
                 WHEN 'activity' THEN (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f WHERE f.LeadId = l.Id AND f.Status = 'done')
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    DECLARE @Lost INT = (SELECT COUNT(*) FROM #L WHERE IsLost = 1);

    -- RS1
    SELECT @Lost AS Lost,
           CAST(100.0 * @Lost / NULLIF((SELECT COUNT(*) FROM #L), 0) AS DECIMAL(5,1)) AS LostPct,
           (SELECT TOP 1 ReasonLabel FROM #L WHERE IsLost = 1 GROUP BY ReasonLabel ORDER BY COUNT(*) DESC, ReasonLabel) AS TopReason;

    -- RS2: reason rows; a second key when grouped by source/product/owner/branch
    SELECT LostReasonId AS GroupKey, ReasonLabel AS GroupLabel,
           CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubKey END AS SubKey,
           CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubLabel END AS SubLabel,
           COUNT(*) AS Lost,
           CAST(100.0 * COUNT(*) / NULLIF(@Lost, 0) AS DECIMAL(5,1)) AS LostPct
    FROM #L
    WHERE IsLost = 1
    GROUP BY LostReasonId, ReasonLabel,
             CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubKey END,
             CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubLabel END
    ORDER BY Lost DESC, GroupLabel, SubLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Lost
    FROM #L
    WHERE IsLost = 1
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


CREATE OR ALTER PROC dbo.sp_RptPipelineValue
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'status',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy NOT IN ('status','owner','product','branch')
    BEGIN RAISERROR('sp_RptPipelineValue: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT l.Id, ISNULL(l.EstValue, 0) AS EstValue, st.Code AS StatusCode,
           CASE @GroupBy WHEN 'status'  THEN l.StatusId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'branch'  THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'status'  THEN st.Value
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—') END AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st      ON st.Id = l.StatusId
    LEFT JOIN dbo.tblProduct p ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o    ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblBranch b  ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
                                        WHERE h.LeadId = l.Id AND s.Code IN ('qualified','lost','junk'))
                 WHEN 'activity' THEN (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f WHERE f.LeadId = l.Id AND f.Status = 'done')
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1
    SELECT ISNULL(SUM(CASE WHEN StatusCode = 'open'      THEN EstValue END), 0) AS OpenValue,
           ISNULL(SUM(CASE WHEN StatusCode = 'qualified' THEN EstValue END), 0) AS QualifiedValue,
           ISNULL(SUM(CASE WHEN StatusCode = 'lost'      THEN EstValue END), 0) AS LostValue,
           ISNULL(SUM(CASE WHEN StatusCode IN ('open','qualified') THEN 1 ELSE 0 END), 0) AS OpenCount,
           CAST(AVG(CASE WHEN StatusCode IN ('open','qualified') THEN EstValue END) AS DECIMAL(18,2)) AS AvgValue
    FROM #L;

    -- RS2
    SELECT GroupKey, GroupLabel, COUNT(*) AS [Count], SUM(EstValue) AS Value
    FROM #L
    GROUP BY GroupKey, GroupLabel
    ORDER BY Value DESC, GroupLabel;

    -- RS3: value still in play, by the bucket the lead was dated into
    SELECT Bucket, ISNULL(SUM(CASE WHEN StatusCode IN ('open','qualified') THEN EstValue END), 0) AS OpenValue
    FROM #L
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO
```

- [ ] **Step 2: Check the batch count**

Run: `cd backend && grep -c "^GO$" sql/075_sales_reports.sql && grep -n "CREATE OR ALTER PROC dbo.sp_Rpt" sql/075_sales_reports.sql`
Expected: `11`; three `sp_Rpt*` CREATE lines (`Funnel`, `Lost`, `PipelineValue`).

- [ ] **Step 3: Stop and report** — the three procs appended; the file is still not ready to apply.

---

### Task 3: `075` — part C: `sp_RptFollowUpCompliance`, `sp_RptActivity`, `sp_RptLeaderboard` (follow-up family)

**Files:**
- Modify: `backend/sql/075_sales_reports.sql` (append section 6)

**Interfaces:**
- Consumes: `tblFollowUp` (`Type, DueAt, Status, DoneAt, DoneBy, OutcomeId, Direction, Duration, AssignedTo`), `tblLeads`, `tblLeadStatusHistory`.
- Produces:
  - `sp_RptFollowUpCompliance` — GroupBy `owner|team|branch`. Row date (ambiguity 7): `created` → `DueAt`, else `COALESCE(DoneAt, DueAt)`. RS1 `Due, DoneOnTime, DoneLate, Skipped, Missed, OnTimePct, AvgDelayHours`. RS2 `GroupKey, GroupLabel` + the same seven. RS3 `Bucket, Due, DoneOnTime, DoneLate, Missed`. "On time" = `DoneAt <= DueAt + 2h`; "Missed" = still open and `DueAt < GETDATE()`; `OnTimePct = DoneOnTime / (DoneOnTime + DoneLate + Skipped + Missed)`.
  - `sp_RptActivity` — GroupBy `owner|day|team|branch`; date = `DoneAt` (basis ignored). RS1 `Calls, Visits, Meetings, Other, TalkMinutes, Inbound, Outbound, Connected`. RS2 `GroupKey, GroupLabel` + the same eight (`day`: `GroupKey = DATEDIFF(DAY, 0, DoneAt)`, `GroupLabel = 'yyyy-mm-dd'`). RS3 `Bucket, Calls, Visits, Meetings`. `Connected` = outcome lookup `Value = N'Connected'` (the lookup has no Code).
  - `sp_RptLeaderboard` — GroupBy `owner` only; lead dates on `CreatedAt` (basis ignored). RS1 empty (zero rows → controller sends `{}`). RS2 `GroupKey, GroupLabel, Created, Qualified, Activities, OnTimePct, AvgResponseHours, Rank`. RS3 empty.
- Follow-up rows honour the lead scope predicate **plus** `f.AssignedTo = @UserId` (the always-visible rule `sp_FetchFollowUps` uses); the owner-scope list also matches `f.AssignedTo`.

- [ ] **Step 1: Append section 6 to `075_sales_reports.sql`**

```sql
-- ===========================================================================
-- 6. REPORT PROCS — follow-up family
-- ===========================================================================

CREATE OR ALTER PROC dbo.sp_RptFollowUpCompliance
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy NOT IN ('owner','team','branch')
    BEGIN RAISERROR('sp_RptFollowUpCompliance: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;
    DECLARE @Now    DATETIME = GETDATE();

    SELECT f.Id, f.DueAt, f.DoneAt, f.Status,
           CASE WHEN f.Status = 'done' AND f.DoneAt <= DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS OnTime,
           CASE WHEN f.Status = 'done' AND f.DoneAt >  DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS Late,
           CASE WHEN f.Status = 'skipped' THEN 1 ELSE 0 END AS Skipped,
           CASE WHEN f.Status = 'open' AND f.DueAt < @Now THEN 1 ELSE 0 END AS Missed,
           CASE @GroupBy WHEN 'owner'  THEN rep.Id
                         WHEN 'team'   THEN ISNULL(rep.ReportsTo, rep.Id)
                         WHEN 'branch' THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'owner'  THEN ISNULL(rep.FullName, N'Unassigned')
                         WHEN 'team'   THEN ISNULL(mgr.FullName, ISNULL(rep.FullName, N'Unassigned'))
                         WHEN 'branch' THEN ISNULL(b.BranchName, N'—') END AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #F
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l       ON l.Id = f.LeadId AND l.CompId = f.CompId
    LEFT JOIN dbo.tblUser rep ON rep.Id = COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId)
    LEFT JOIN dbo.tblUser mgr ON mgr.Id = rep.ReportsTo
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    CROSS APPLY (SELECT CASE WHEN @DateBasis = 'created' THEN f.DueAt ELSE COALESCE(f.DoneAt, f.DueAt) END AS EventAt) d
    WHERE f.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.AssignedTo = @UserId))
          );

    -- RS1
    SELECT COUNT(*) AS Due,
           ISNULL(SUM(OnTime), 0)  AS DoneOnTime,
           ISNULL(SUM(Late), 0)    AS DoneLate,
           ISNULL(SUM(Skipped), 0) AS Skipped,
           ISNULL(SUM(Missed), 0)  AS Missed,
           CAST(100.0 * SUM(OnTime) / NULLIF(SUM(OnTime) + SUM(Late) + SUM(Skipped) + SUM(Missed), 0) AS DECIMAL(5,1)) AS OnTimePct,
           CAST(AVG(CASE WHEN Late = 1 THEN DATEDIFF(MINUTE, DueAt, DoneAt) / 60.0 END) AS DECIMAL(8,1)) AS AvgDelayHours
    FROM #F;

    -- RS2
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS Due, SUM(OnTime) AS DoneOnTime, SUM(Late) AS DoneLate, SUM(Skipped) AS Skipped, SUM(Missed) AS Missed,
           CAST(100.0 * SUM(OnTime) / NULLIF(SUM(OnTime) + SUM(Late) + SUM(Skipped) + SUM(Missed), 0) AS DECIMAL(5,1)) AS OnTimePct,
           CAST(AVG(CASE WHEN Late = 1 THEN DATEDIFF(MINUTE, DueAt, DoneAt) / 60.0 END) AS DECIMAL(8,1)) AS AvgDelayHours
    FROM #F
    GROUP BY GroupKey, GroupLabel
    ORDER BY OnTimePct DESC, Due DESC, GroupLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Due, SUM(OnTime) AS DoneOnTime, SUM(Late) AS DoneLate, SUM(Missed) AS Missed
    FROM #F
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


CREATE OR ALTER PROC dbo.sp_RptActivity
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'activity',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy NOT IN ('owner','day','team','branch')
    BEGIN RAISERROR('sp_RptActivity: unknown GroupBy', 16, 1); RETURN; END
    -- Activity has one date: when it happened. @DateBasis is accepted for the
    -- shared contract and ignored.

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT f.Id, f.Type, ISNULL(f.Duration, 0) AS Duration, f.Direction,
           CASE WHEN oc.Value = N'Connected' THEN 1 ELSE 0 END AS Connected,
           CASE @GroupBy WHEN 'owner'  THEN rep.Id
                         WHEN 'day'    THEN DATEDIFF(DAY, 0, f.DoneAt)
                         WHEN 'team'   THEN ISNULL(rep.ReportsTo, rep.Id)
                         WHEN 'branch' THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'owner'  THEN ISNULL(rep.FullName, N'Unknown')
                         WHEN 'day'    THEN CONVERT(NVARCHAR(10), f.DoneAt, 23)
                         WHEN 'team'   THEN ISNULL(mgr.FullName, ISNULL(rep.FullName, N'Unknown'))
                         WHEN 'branch' THEN ISNULL(b.BranchName, N'—') END AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, f.DoneAt), 0) ELSE f.DoneAt END AS DATE) AS Bucket
    INTO #F
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l        ON l.Id = f.LeadId AND l.CompId = f.CompId
    LEFT JOIN dbo.tblUser rep  ON rep.Id = f.DoneBy
    LEFT JOIN dbo.tblUser mgr  ON mgr.Id = rep.ReportsTo
    LEFT JOIN dbo.tblBranch b  ON b.Id = l.BranchId
    LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
    WHERE f.CompId = @CompId AND f.Status = 'done' AND f.DoneAt IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR f.DoneBy    = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND f.DoneAt >= @FromDate AND f.DoneAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.DoneBy IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.DoneBy = @UserId))
          );

    -- RS1
    SELECT ISNULL(SUM(CASE WHEN Type = 'call'    THEN 1 ELSE 0 END), 0) AS Calls,
           ISNULL(SUM(CASE WHEN Type = 'visit'   THEN 1 ELSE 0 END), 0) AS Visits,
           ISNULL(SUM(CASE WHEN Type = 'meeting' THEN 1 ELSE 0 END), 0) AS Meetings,
           ISNULL(SUM(CASE WHEN Type = 'other'   THEN 1 ELSE 0 END), 0) AS Other,
           ISNULL(SUM(CASE WHEN Type = 'call'    THEN Duration ELSE 0 END), 0) AS TalkMinutes,
           ISNULL(SUM(CASE WHEN Direction = 'in'  THEN 1 ELSE 0 END), 0) AS Inbound,
           ISNULL(SUM(CASE WHEN Direction = 'out' THEN 1 ELSE 0 END), 0) AS Outbound,
           ISNULL(SUM(Connected), 0) AS Connected
    FROM #F;

    -- RS2
    SELECT GroupKey, GroupLabel,
           SUM(CASE WHEN Type = 'call'    THEN 1 ELSE 0 END) AS Calls,
           SUM(CASE WHEN Type = 'visit'   THEN 1 ELSE 0 END) AS Visits,
           SUM(CASE WHEN Type = 'meeting' THEN 1 ELSE 0 END) AS Meetings,
           SUM(CASE WHEN Type = 'other'   THEN 1 ELSE 0 END) AS Other,
           SUM(CASE WHEN Type = 'call'    THEN Duration ELSE 0 END) AS TalkMinutes,
           SUM(CASE WHEN Direction = 'in'  THEN 1 ELSE 0 END) AS Inbound,
           SUM(CASE WHEN Direction = 'out' THEN 1 ELSE 0 END) AS Outbound,
           SUM(Connected) AS Connected
    FROM #F
    GROUP BY GroupKey, GroupLabel
    ORDER BY CASE WHEN @GroupBy = 'day' THEN GroupKey END ASC, Calls DESC, GroupLabel;

    -- RS3
    SELECT Bucket,
           SUM(CASE WHEN Type = 'call'    THEN 1 ELSE 0 END) AS Calls,
           SUM(CASE WHEN Type = 'visit'   THEN 1 ELSE 0 END) AS Visits,
           SUM(CASE WHEN Type = 'meeting' THEN 1 ELSE 0 END) AS Meetings
    FROM #F
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


CREATE OR ALTER PROC dbo.sp_RptLeaderboard
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy NOT IN ('owner')
    BEGIN RAISERROR('sp_RptLeaderboard: unknown GroupBy', 16, 1); RETURN; END
    -- Leads are dated on CreatedAt, activities on DoneAt; @DateBasis ignored.

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));

    -- Scoped leads created in range, with their qualified date and first touch.
    SELECT l.Id, l.OwnerId, l.CreatedAt,
           (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
             WHERE h.LeadId = l.Id AND s.Code = 'qualified') AS QualifiedAt,
           (SELECT MIN(f.DoneAt) FROM dbo.tblFollowUp f WHERE f.LeadId = l.Id AND f.Status = 'done') AS FirstTouchAt
    INTO #L
    FROM dbo.tblLeads l
    WHERE l.CompId = @CompId AND l.OwnerId IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- Scoped done follow-ups in range, by the rep who did them.
    SELECT f.Id, f.DoneBy,
           CASE WHEN f.DoneAt <= DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS OnTime
    INTO #F
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    WHERE f.CompId = @CompId AND f.Status = 'done' AND f.DoneBy IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR f.DoneBy    = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND f.DoneAt >= @FromDate AND f.DoneAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.DoneBy IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.DoneBy = @UserId))
          );

    -- RS1: no KPI row for a leaderboard (spec §3)
    SELECT CAST(NULL AS INT) AS Nothing WHERE 1 = 0;

    -- RS2: one row per rep who owns a lead or did an activity in range
    ;WITH reps AS (
        SELECT OwnerId AS RepId FROM #L
        UNION
        SELECT DoneBy FROM #F
    ), stats AS (
        SELECT r.RepId,
               (SELECT COUNT(*) FROM #L x WHERE x.OwnerId = r.RepId) AS Created,
               (SELECT COUNT(*) FROM #L x WHERE x.OwnerId = r.RepId AND x.QualifiedAt IS NOT NULL) AS Qualified,
               (SELECT COUNT(*) FROM #F y WHERE y.DoneBy = r.RepId) AS Activities,
               (SELECT CAST(100.0 * SUM(OnTime) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) FROM #F y WHERE y.DoneBy = r.RepId) AS OnTimePct,
               (SELECT CAST(AVG(DATEDIFF(MINUTE, x.CreatedAt, x.FirstTouchAt) / 60.0) AS DECIMAL(8,1))
                  FROM #L x WHERE x.OwnerId = r.RepId AND x.FirstTouchAt IS NOT NULL) AS AvgResponseHours
        FROM reps r
    )
    SELECT s.RepId AS GroupKey, ISNULL(u.FullName, N'Unknown') AS GroupLabel,
           s.Created, s.Qualified, s.Activities, s.OnTimePct, s.AvgResponseHours,
           RANK() OVER (ORDER BY s.Qualified DESC, s.Activities DESC, s.Created DESC) AS [Rank]
    FROM stats s
    LEFT JOIN dbo.tblUser u ON u.Id = s.RepId
    ORDER BY [Rank], GroupLabel;

    -- RS3: no trend for a leaderboard (spec §3)
    SELECT CAST(NULL AS DATE) AS Bucket WHERE 1 = 0;
END
GO
```

- [ ] **Step 2: Check the batch count**

Run: `cd backend && grep -c "^GO$" sql/075_sales_reports.sql && grep -c "CREATE OR ALTER PROC dbo.sp_Rpt" sql/075_sales_reports.sql`
Expected: `14` and `6`.

- [ ] **Step 3: Stop and report.**

---

### Task 4: `075` — part D: `sp_RptAging`, `sp_RptTransfers`, sidebar rows, verify block

**Files:**
- Modify: `backend/sql/075_sales_reports.sql` (append sections 7–9; the file is complete after this task)

**Interfaces:**
- Produces:
  - `sp_RptAging` — GroupBy `owner|branch|team`. RS1/RS2 are a **snapshot as of now** of scoped active leads (status Code `open`/`qualified`): `Open, Age0_7, Age8_30, Age31_90, Age90Plus, NoNextFollowUp, AvgDaysSinceTouch` (RS2 = `GroupKey, GroupLabel` + the same). RS3 `Bucket, [Open]` = leads that were active at the end of each bucket in the range (created before bucket end, not yet lost/junk). Last touch = latest of lead `CreatedAt`, follow-up `COALESCE(DoneAt, CreatedAt)`, `tblLeadActivity.CreatedAt`. The date range drives RS3 only (ambiguity 7).
  - `sp_RptTransfers` — GroupBy `reason|pair|branch` (ambiguity 6); date = `AssignedAt` (basis ignored); creation rows (`ReasonId IS NULL`) excluded. RS1 `Transfers, CrossBranch, SendBacks, Unassigns` (`SendBacks` = reason lookup `Value = N'Sent back to manager'`). RS2 `GroupKey, GroupLabel, SubKey, SubLabel` + the same four (`pair`: `GroupKey = FromUserId`, `SubKey = ToUserId`, `GroupLabel = 'Amit → Sara'`; `SubKey/SubLabel` NULL otherwise). RS3 `Bucket, Transfers`.
  - Sidebar: row 20 → `Funnel` `/reports/funnel`; row 21 → `Activity` `/reports/activity`; row 22 → `/reports/funnel?groupBy=source` (label kept); six new rows `Follow-up Compliance /reports/follow-up-compliance`, `Lost Analysis /reports/lost`, `Aging /reports/aging`, `Transfers /reports/transfers`, `Pipeline Value /reports/pipeline-value`, `Leaderboard /reports/leaderboard` — grants cloned from row 20 with `DISTINCT` (ambiguity 2). Web Task 20 registers exactly these routes.

- [ ] **Step 1: Append sections 7–9 to `075_sales_reports.sql`**

```sql
-- ===========================================================================
-- 7. REPORT PROCS — aging + transfers
-- ===========================================================================

CREATE OR ALTER PROC dbo.sp_RptAging
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy NOT IN ('owner','branch','team')
    BEGIN RAISERROR('sp_RptAging: unknown GroupBy', 16, 1); RETURN; END
    -- Aging is a snapshot: RS1/RS2 describe what is open right now. The date
    -- range (and @DateBasis) only shape RS3, the "open as of" trend.

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @Now    DATETIME = GETDATE();
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;
    DECLARE @Step   INT      = CASE WHEN @Weekly = 1 THEN 7 ELSE 1 END;

    -- Every scoped lead (any status) with its close date; RS1/RS2 filter to
    -- the ones still active, RS3 replays the count over time.
    SELECT l.Id, l.CreatedAt, l.NextFollowupDate,
           CASE WHEN st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS IsActive,
           (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
             WHERE h.LeadId = l.Id AND s.Code IN ('lost','junk')) AS ClosedAt,
           (SELECT MAX(v) FROM (VALUES (l.CreatedAt), (t.FuTouch), (t.ActTouch)) x(v)) AS LastTouchAt,
           CASE @GroupBy WHEN 'owner'  THEN l.OwnerId
                         WHEN 'team'   THEN ISNULL(o.ReportsTo, o.Id)
                         WHEN 'branch' THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'owner'  THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'team'   THEN ISNULL(mgr.FullName, ISNULL(o.FullName, N'Unassigned'))
                         WHEN 'branch' THEN ISNULL(b.BranchName, N'—') END AS GroupLabel
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st     ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser o   ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblUser mgr ON mgr.Id = o.ReportsTo
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT (SELECT MAX(COALESCE(f.DoneAt, f.CreatedAt)) FROM dbo.tblFollowUp f WHERE f.LeadId = l.Id) AS FuTouch,
               (SELECT MAX(a.CreatedAt) FROM dbo.tblLeadActivity a WHERE a.LeadId = l.Id) AS ActTouch
    ) t
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1: snapshot
    SELECT COUNT(*) AS [Open],
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) <= 7  THEN 1 ELSE 0 END), 0) AS Age0_7,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 8  AND 30 THEN 1 ELSE 0 END), 0) AS Age8_30,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 31 AND 90 THEN 1 ELSE 0 END), 0) AS Age31_90,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) > 90 THEN 1 ELSE 0 END), 0) AS Age90Plus,
           ISNULL(SUM(CASE WHEN NextFollowupDate IS NULL THEN 1 ELSE 0 END), 0) AS NoNextFollowUp,
           CAST(AVG(DATEDIFF(HOUR, LastTouchAt, @Now) / 24.0) AS DECIMAL(6,1)) AS AvgDaysSinceTouch
    FROM #L WHERE IsActive = 1;

    -- RS2
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS [Open],
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) <= 7  THEN 1 ELSE 0 END) AS Age0_7,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 8  AND 30 THEN 1 ELSE 0 END) AS Age8_30,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS Age31_90,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) > 90 THEN 1 ELSE 0 END) AS Age90Plus,
           SUM(CASE WHEN NextFollowupDate IS NULL THEN 1 ELSE 0 END) AS NoNextFollowUp,
           CAST(AVG(DATEDIFF(HOUR, LastTouchAt, @Now) / 24.0) AS DECIMAL(6,1)) AS AvgDaysSinceTouch
    FROM #L WHERE IsActive = 1
    GROUP BY GroupKey, GroupLabel
    ORDER BY [Open] DESC, GroupLabel;

    -- RS3: active leads as of each bucket end (created before it, not closed before it)
    ;WITH buckets AS (
        SELECT CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, @FromDate), 0) ELSE @FromDate END AS DATE) AS Bucket
        UNION ALL
        SELECT DATEADD(DAY, @Step, Bucket) FROM buckets WHERE DATEADD(DAY, @Step, Bucket) <= @ToDate
    )
    SELECT b.Bucket,
           (SELECT COUNT(*) FROM #L x
             WHERE x.CreatedAt < DATEADD(DAY, @Step, CAST(b.Bucket AS DATETIME))
               AND (x.ClosedAt IS NULL OR x.ClosedAt >= DATEADD(DAY, @Step, CAST(b.Bucket AS DATETIME)))) AS [Open]
    FROM buckets b
    ORDER BY b.Bucket
    OPTION (MAXRECURSION 1000);
END
GO


CREATE OR ALTER PROC dbo.sp_RptTransfers
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'reason',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy NOT IN ('reason','pair','branch')
    BEGIN RAISERROR('sp_RptTransfers: unknown GroupBy', 16, 1); RETURN; END
    -- A transfer has one date, AssignedAt; @DateBasis ignored.

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT a.Id,
           CASE WHEN ISNULL(a.FromBranchId, a.ToBranchId) <> a.ToBranchId THEN 1 ELSE 0 END AS CrossBranch,
           CASE WHEN r.Value = N'Sent back to manager' THEN 1 ELSE 0 END AS SendBack,
           CASE WHEN a.ToUserId IS NULL THEN 1 ELSE 0 END AS Unassign,
           CASE @GroupBy WHEN 'reason' THEN a.ReasonId
                         WHEN 'pair'   THEN a.FromUserId
                         WHEN 'branch' THEN a.ToBranchId END AS GroupKey,
           CASE @GroupBy WHEN 'reason' THEN ISNULL(r.Value, N'No reason')
                         WHEN 'pair'   THEN ISNULL(fu.FullName, N'Unassigned') + N' → ' + ISNULL(tu.FullName, N'Unassigned')
                         WHEN 'branch' THEN ISNULL(tb.BranchName, N'—') END AS GroupLabel,
           CASE WHEN @GroupBy = 'pair' THEN a.ToUserId END AS SubKey,
           CASE WHEN @GroupBy = 'pair' THEN ISNULL(tu.FullName, N'Unassigned') END AS SubLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, a.AssignedAt), 0) ELSE a.AssignedAt END AS DATE) AS Bucket
    INTO #A
    FROM dbo.tblLeadAssignment a
    JOIN dbo.tblLeads l        ON l.Id = a.LeadId AND l.CompId = a.CompId
    LEFT JOIN dbo.tblLookup r  ON r.Id = a.ReasonId
    LEFT JOIN dbo.tblUser fu   ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu   ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    WHERE a.CompId = @CompId AND a.ReasonId IS NOT NULL
      AND (@BranchId  IS NULL OR a.ToBranchId = @BranchId OR a.FromBranchId = @BranchId)
      AND (@OwnerId   IS NULL OR a.ToUserId = @OwnerId OR a.FromUserId = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND a.AssignedAt >= @FromDate AND a.AssignedAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds)
                                      OR a.ToUserId IN (SELECT OwnerId FROM @OwnerIds)
                                      OR a.FromUserId IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR a.ToUserId = @UserId OR a.FromUserId = @UserId))
          );

    -- RS1
    SELECT COUNT(*) AS Transfers,
           ISNULL(SUM(CrossBranch), 0) AS CrossBranch,
           ISNULL(SUM(SendBack), 0)    AS SendBacks,
           ISNULL(SUM(Unassign), 0)    AS Unassigns
    FROM #A;

    -- RS2
    SELECT GroupKey, GroupLabel, SubKey, SubLabel,
           COUNT(*) AS Transfers, SUM(CrossBranch) AS CrossBranch, SUM(SendBack) AS SendBacks, SUM(Unassign) AS Unassigns
    FROM #A
    GROUP BY GroupKey, GroupLabel, SubKey, SubLabel
    ORDER BY Transfers DESC, GroupLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Transfers
    FROM #A
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


-- ===========================================================================
-- 8. SIDEBAR — Sales Reports (parent 11)
--    20/21/22 re-pointed (their grants carry over); six new rows cloned from
--    row 20. DISTINCT because tblGroupAccess carries duplicate (GroupId,
--    MenuId) rows today. No executive group is granted (spec §1 decision 6).
-- ===========================================================================
UPDATE dbo.tblMenu SET Description = 'Funnel',   Route = '/reports/funnel'
 WHERE Id = 20 AND Route = '/reports/leads-by-status';
UPDATE dbo.tblMenu SET Description = 'Activity', Route = '/reports/activity'
 WHERE Id = 21 AND Route = '/reports/calls-per-user';
UPDATE dbo.tblMenu SET Route = '/reports/funnel?groupBy=source'
 WHERE Id = 22 AND Route = '/reports/conversion-by-source';

;WITH new_rows AS (
    SELECT * FROM (VALUES
        ('Follow-up Compliance', '/reports/follow-up-compliance'),
        ('Lost Analysis',        '/reports/lost'),
        ('Aging',                '/reports/aging'),
        ('Transfers',            '/reports/transfers'),
        ('Pipeline Value',       '/reports/pipeline-value'),
        ('Leaderboard',          '/reports/leaderboard')
    ) v(Description, Route)
)
INSERT INTO dbo.tblMenu (ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route)
SELECT m.ParentId, n.Description, m.Image, m.FormId, m.MenuType, m.ActualId, m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, n.Route
FROM new_rows n
CROSS JOIN dbo.tblMenu m
WHERE m.Id = 20
  AND NOT EXISTS (SELECT 1 FROM dbo.tblMenu x WHERE x.Route = n.Route);

INSERT INTO dbo.tblGroupAccess (GroupId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
SELECT DISTINCT src.GroupId, m.Id, src.CanView, src.CanAdd, src.CanEdit, src.CanDelete
FROM dbo.tblGroupAccess src
CROSS JOIN dbo.tblMenu m
WHERE src.MenuId = 20
  AND m.ParentId = 11 AND m.Id NOT IN (20, 21, 22)
  AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupAccess ga WHERE ga.GroupId = src.GroupId AND ga.MenuId = m.Id);
GO


-- ===========================================================================
-- 9. VERIFY AFTER APPLY — the dry run rolls back
-- ===========================================================================
SET NOCOUNT ON;

-- 9.1 Shape
SELECT 'tblLeadStatusHistory'        AS what, CASE WHEN OBJECT_ID('dbo.tblLeadStatusHistory') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS state
UNION ALL SELECT 'sp_FetchLeads @FromDate',    CASE WHEN EXISTS (SELECT 1 FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
                                                                 WHERE o.name = 'sp_FetchLeads' AND p.name = '@FromDate') THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'leads without history',      CAST((SELECT COUNT(*) FROM dbo.tblLeads l
                                                     WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLeadStatusHistory h WHERE h.LeadId = l.Id)) AS VARCHAR(10)) + ' (expect 0)';

-- 9.2 Eight procs present (expect 8 rows)
SELECT name FROM sys.procedures
WHERE name IN ('sp_RptFunnel','sp_RptFollowUpCompliance','sp_RptActivity','sp_RptLost',
               'sp_RptAging','sp_RptTransfers','sp_RptPipelineValue','sp_RptLeaderboard')
ORDER BY name;

-- 9.3 Sidebar: 9 rows under parent 11; every new row has row 20's group set
SELECT Id, Description, Route FROM dbo.tblMenu WHERE ParentId = 11 ORDER BY Id;   -- expect 9
SELECT m.Route, COUNT(DISTINCT ga.GroupId) AS Groups
FROM dbo.tblMenu m LEFT JOIN dbo.tblGroupAccess ga ON ga.MenuId = m.Id
WHERE m.ParentId = 11 GROUP BY m.Route ORDER BY m.Route;                            -- expect 10 for every row

-- 9.4 Each report once, wide range, Sales-Head-like scope: expect THREE grids
--     per proc (KPI row · breakdown · trend), no error. Plain EXEC — result
--     sets cannot be captured into a table variable.
DECLARE @cid INT = 1, @uid INT = 13, @all NVARCHAR(MAX) = '[1,2,3,4,5]';
DECLARE @from DATE = DATEADD(DAY, -365, CAST(GETDATE() AS DATE)), @to DATE = CAST(GETDATE() AS DATE);
SELECT 'sp_RptFunnel — expect 3 grids' AS step;
EXEC dbo.sp_RptFunnel             @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='source', @UserId=@uid, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptFollowUpCompliance — expect 3 grids' AS step;
EXEC dbo.sp_RptFollowUpCompliance @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=@uid, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptActivity — expect 3 grids' AS step;
EXEC dbo.sp_RptActivity           @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=@uid, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptLost — expect 3 grids' AS step;
EXEC dbo.sp_RptLost               @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='reason', @UserId=@uid, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptAging — expect 3 grids' AS step;
EXEC dbo.sp_RptAging              @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=@uid, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptTransfers — expect 3 grids' AS step;
EXEC dbo.sp_RptTransfers          @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='reason', @UserId=@uid, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptPipelineValue — expect 3 grids' AS step;
EXEC dbo.sp_RptPipelineValue      @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='status', @UserId=@uid, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptLeaderboard — expect 3 grids (first and last empty)' AS step;
EXEC dbo.sp_RptLeaderboard        @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=@uid, @AccessibleBranchIdsJson=@all;

-- 9.5 Self scope narrows: Amit (17) must not see more Created than Priya
SELECT 'sp_RptFunnel as Amit (Self) — Created must be <= the Priya grid above' AS step;
EXEC dbo.sp_RptFunnel @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner', @UserId=17, @AccessibleBranchIdsJson='[1]', @OwnerIdsJson='[17]';

-- 9.6 Unknown GroupBy raises (expect an error message, not a grid)
BEGIN TRY
    EXEC dbo.sp_RptFunnel @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='nope', @UserId=@uid;
    SELECT '9.6 unknown GroupBy' AS step, 'NOT REJECTED' AS state;
END TRY
BEGIN CATCH
    SELECT '9.6 unknown GroupBy' AS step, 'ok — ' + ERROR_MESSAGE() AS state;
END CATCH

-- 9.7 Write paths log history — rolled back
BEGIN TRY
BEGIN TRANSACTION;
    DECLARE @lost INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='lead_status' AND Code='lost');
    DECLARE @reason INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='lost_reason' ORDER BY SortOrder);
    SELECT '(a) create — expect 200 below' AS step;
    EXEC dbo.sp_SaveLead @Id=0, @CompId=@cid, @BranchId=1, @UserId=@uid, @Name=N'verify-075', @MobileNo='9999999999', @OwnerId=@uid;
    DECLARE @lid INT = (SELECT TOP 1 Id FROM dbo.tblLeads WHERE CompId=@cid AND Name=N'verify-075' ORDER BY Id DESC);
    SELECT '(a) history rows' AS step, COUNT(*) AS N, 1 AS expect FROM dbo.tblLeadStatusHistory WHERE LeadId=@lid;
    SELECT '(b) set Lost — expect 200 below' AS step;
    EXEC dbo.sp_SetLeadStatus @CompId=@cid, @LeadId=@lid, @StatusId=@lost, @LostReasonId=@reason, @UserId=@uid;
    SELECT '(b) history rows' AS step, COUNT(*) AS N, 2 AS expect FROM dbo.tblLeadStatusHistory WHERE LeadId=@lid;
    SELECT '(b) last row is old -> lost' AS step,
           CASE WHEN FromStatusId IS NOT NULL AND ToStatusId = @lost THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblLeadStatusHistory WHERE Id = (SELECT MAX(Id) FROM dbo.tblLeadStatusHistory WHERE LeadId=@lid);
    SELECT '(c) rolling back — nothing above is kept' AS step;
ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'VERIFY FAILED (rolled back)' AS step, ERROR_NUMBER() AS ErrNo, ERROR_PROCEDURE() AS Proc_, ERROR_LINE() AS Line_, ERROR_MESSAGE() AS Msg_;
END CATCH
GO
```

- [ ] **Step 2: Check the file is whole**

Run: `cd backend && grep -c "^GO$" sql/075_sales_reports.sql && grep -c "CREATE OR ALTER PROC dbo.sp_Rpt" sql/075_sales_reports.sql && grep -n "9.7 Write paths" sql/075_sales_reports.sql`
Expected: `18`, `8`, one match.

- [ ] **Step 3: Stop and report** — hand `backend/sql/075_sales_reports.sql` to the owner to apply. **Do not start Task 6 (backend) until the owner confirms it is applied** — Task 21's live check needs the procs. Tasks 5 (seed) can be written meanwhile.

---

### Task 5: `076_seed_sales_demo.sql` + `077_remove_sales_demo.sql`

**Files:**
- Create: `backend/sql/076_seed_sales_demo.sql`
- Create: `backend/sql/077_remove_sales_demo.sql`

**Interfaces:**
- Consumes: `075` applied (history table, `sp_Rpt*`), test users 13–22, products `GC22/DR01/SA01/PB01`, lookups by `Kind`+`Value`.
- Produces: 4 users (`demo_bm_ip_meera` BM group 13 branch 3 → reports to `sh_priya`; `demo_se_ip_rohan`, `demo_se_ip_isha`, `demo_se_ip_kabir` group 16 → report to Meera), 2 products (`DEMO Gold Bangle Set` ₹120,000 15 %, `DEMO Silver Coin 10g` ₹900 20 %), 600 leads `DEMO <First> <Last>` with `MobileNo = '98' + 8-digit n`, status history, 2–6 follow-ups each, assignment rows. All removable by `077`.

**The deterministic hash (spec §6).** `#N` holds `n = 0..599`. Every random-looking choice is an integer expression of `n` (or of `n` and the follow-up ordinal `m`) reduced `% 1000`, then bucketed by thresholds. Different primes per purpose keep the streams independent-looking; nothing is random, so re-running produces byte-identical rows.

Worked example, `n = 1`:
| stream | expression | value | meaning |
|---|---|---|---|
| `hA` (age) | `(1 × 7919) % 1000` | 919 | `Age = 919² / 5556 = 152` days ago (squaring skews uniform → recent-dense; max `999²/5556 = 179`) |
| `hB` (branch) | `(1 × 7907 + 101) % 1000` | 8 | `< 450` → branch 1 (45 / 35 / 20 split at 450 / 800) |
| `hC` (owner) | `(1 × 7877 + 211) % 1000` | 88 | branch-1 roster cumulative weights amit 450 · sara 800 · karan 1000 → amit (star) |
| `hD` (source) | `(1 × 7873 + 307) % 1000` | 180 | `< 300` → Website (300 / 500 / 650 / 800 / 920 → Website 30 · Referral 20 · Walk-in 15 · Phone 15 · Social 12 · Advertisement 8) |
| `hE` (product) | `(1 × 7867 + 401) % 1000` | 268 | `268 % 6 = 4` → 5th product by Id |
| `hS` (status) | `(1 × 7741 + 541) % 1000` | 282 | `< 400` → Contacted (200 / 400 / 550 / 750 / 930 → New 20 · Contacted 20 · Follow-up 15 · Qualified 20 · Lost 18 · Junk 7) |
| `hR` (lost reason) | `(1 × 7727 + 641) % 1000` | 368 | `< 600` → Chose Competitor (350 / 600 / 750 / 900 → Price 35 · Competitor 25 · No budget 15 · Not interested 15 · No response 10) |
| `hI/hJ/hK` (offsets) | `% 4`, `5 + % 21`, `3 + % 38` | | contact 0–3 d, qualify 5–25 d, lost 3–40 d — each clamped to `Age` |
| `hN` (follow-ups) | `2 + ((1 × 7753 + 433) % 1000) % 5` | 2 + 186 % 5 = 3 | 2–6 per lead |
| `hY` (transfer) | `(1 × 7723 + 743) % 1000` | 466 | `< 30` cross-branch (3 %), `< 120` in-branch transfer (12 %), `60–119` also a send-back (second row) |

Per-follow-up streams use both indices, e.g. type `hT = (n × 31 + m × 17) % 1000` (`< 650` call · `< 850` visit · `< 950` meeting · else other), outcome `hP = (n × 37 + m × 19 + 5) % 1000` (`< 700` done on time · `< 900` done 1–5 d late · else left open = missed), `EstValue = UnitPrice × (1 + hF % 3) × (90 + hG % 21) / 100` (×1–3, ±10 %).

- [ ] **Step 1: Write `076_seed_sales_demo.sql`**

```sql
-- ============================================================================
-- 076_seed_sales_demo.sql   (DEMO DATA — deterministic, backdated, removable)
--
-- The API stamps GETDATE() on everything, so a trend needs history it cannot
-- create. This seeds 180 days of it: 600 leads, their status history, 2–6
-- follow-ups each, transfers — every value an integer function of a row
-- number (spec §6), so re-running produces identical rows. No NEWID()/RAND().
--
-- Idempotent: deletes Name LIKE 'DEMO %' (and children) and Name LIKE 'DEMO %'
-- products first; demo users are inserted IF NOT EXISTS. 077 removes it all.
--
-- Requires 075 applied and the 2026-09-09 test users (sh_priya … se_se_dev).
-- APPLY BY HAND. One batch: a RAISERROR/RETURN aborts the whole seed.
-- Author: Claude  Date: 2026-09-10
-- ============================================================================
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO
SET NOCOUNT ON;

DECLARE @CompId INT = 1;
DECLARE @Now    DATETIME = GETDATE();
DECLARE @Today  DATETIME = CAST(CAST(@Now AS DATE) AS DATETIME);

-- ---------------------------------------------------------------------------
-- 0. Guards + lookups resolved by name (ids differ per company)
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblLeadStatusHistory') IS NULL
BEGIN RAISERROR('076: apply 075_sales_reports.sql first', 16, 1); RETURN; END

DECLARE @Pwd VARCHAR(500) = (SELECT Password FROM dbo.tblUser WHERE Username = 'se_ho_amit' AND CompId = @CompId);
DECLARE @Priya INT = (SELECT Id FROM dbo.tblUser WHERE Username = 'sh_priya' AND CompId = @CompId);
IF @Pwd IS NULL OR @Priya IS NULL
BEGIN RAISERROR('076: test users from the 2026-09-09 live test are missing (se_ho_amit / sh_priya)', 16, 1); RETURN; END

DECLARE @stNew INT, @stContacted INT, @stFollowUp INT, @stQualified INT, @stLost INT, @stJunk INT;
SELECT @stNew       = MAX(CASE WHEN Value = N'New'       THEN Id END),
       @stContacted = MAX(CASE WHEN Value = N'Contacted' THEN Id END),
       @stFollowUp  = MAX(CASE WHEN Value = N'Follow-up' THEN Id END),
       @stQualified = MAX(CASE WHEN Value = N'Qualified' THEN Id END),
       @stLost      = MAX(CASE WHEN Value = N'Lost'      THEN Id END),
       @stJunk      = MAX(CASE WHEN Value = N'Junk'      THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lead_status';
IF @stNew IS NULL OR @stContacted IS NULL OR @stFollowUp IS NULL OR @stQualified IS NULL OR @stLost IS NULL OR @stJunk IS NULL
BEGIN RAISERROR('076: lead_status lookups New/Contacted/Follow-up/Qualified/Lost/Junk are required', 16, 1); RETURN; END

DECLARE @srcWebsite INT, @srcReferral INT, @srcWalkIn INT, @srcPhone INT, @srcSocial INT, @srcAd INT;
SELECT @srcWebsite  = MAX(CASE WHEN Value = N'Website'       THEN Id END),
       @srcReferral = MAX(CASE WHEN Value = N'Referral'      THEN Id END),
       @srcWalkIn   = MAX(CASE WHEN Value = N'Walk-in'       THEN Id END),
       @srcPhone    = MAX(CASE WHEN Value = N'Phone'         THEN Id END),
       @srcSocial   = MAX(CASE WHEN Value = N'Social Media'  THEN Id END),
       @srcAd       = MAX(CASE WHEN Value = N'Advertisement' THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lead_source';

DECLARE @lrPrice INT, @lrCompetitor INT, @lrBudget INT, @lrNotInterested INT, @lrNoResponse INT;
SELECT @lrPrice         = MAX(CASE WHEN Value = N'Price'            THEN Id END),
       @lrCompetitor    = MAX(CASE WHEN Value = N'Chose Competitor' THEN Id END),
       @lrBudget        = MAX(CASE WHEN Value = N'No Budget'        THEN Id END),
       @lrNotInterested = MAX(CASE WHEN Value = N'Not Interested'   THEN Id END),
       @lrNoResponse    = MAX(CASE WHEN Value = N'No Response'      THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lost_reason';

DECLARE @ocConnected INT, @ocNoAnswer INT, @ocBusy INT, @ocWrong INT, @ocCallback INT;
SELECT @ocConnected = MAX(CASE WHEN Value = N'Connected'          THEN Id END),
       @ocNoAnswer  = MAX(CASE WHEN Value = N'No Answer'          THEN Id END),
       @ocBusy      = MAX(CASE WHEN Value = N'Busy'               THEN Id END),
       @ocWrong     = MAX(CASE WHEN Value = N'Wrong Number'       THEN Id END),
       @ocCallback  = MAX(CASE WHEN Value = N'Callback Requested' THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'call_outcome';

DECLARE @trAbsent INT, @trOverloaded INT, @trWrongBranch INT, @trSentBack INT, @trReassigned INT, @trOther INT;
SELECT @trAbsent      = MAX(CASE WHEN Value = N'Absent'                THEN Id END),
       @trOverloaded  = MAX(CASE WHEN Value = N'Overloaded'            THEN Id END),
       @trWrongBranch = MAX(CASE WHEN Value = N'Wrong branch'          THEN Id END),
       @trSentBack    = MAX(CASE WHEN Value = N'Sent back to manager'  THEN Id END),
       @trReassigned  = MAX(CASE WHEN Value = N'Reassigned by manager' THEN Id END),
       @trOther       = MAX(CASE WHEN Value = N'Other'                 THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'transfer_reason';

DECLARE @catGeneral INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'product_category' ORDER BY SortOrder, Id);

-- ---------------------------------------------------------------------------
-- 1. Wipe a previous run
-- ---------------------------------------------------------------------------
DECLARE @Old TABLE (Id INT PRIMARY KEY);
INSERT INTO @Old SELECT Id FROM dbo.tblLeads WHERE CompId = @CompId AND Name LIKE 'DEMO %';
DELETE FROM dbo.tblFollowUp          WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadAssignment    WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadStatusHistory WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadActivity      WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblCustomFieldValue  WHERE CompId = @CompId AND Entity = 'lead' AND EntityId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeads             WHERE Id IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblProduct WHERE CompId = @CompId AND Name LIKE 'DEMO %';

-- ---------------------------------------------------------------------------
-- 2. Users — branch 3 (INDIRAPURAM): 1 BM + 3 execs. Password = Amit's hash.
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'demo_bm_ip_meera')
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, CompId, BranchId, ReportsTo)
    VALUES ('demo_bm_ip_meera', @Pwd, 1, 0, '', 0, 'Meera Iyer (BM Indirapuram)', 'demo_bm_ip_meera@nexus.test', 'Branch Manager', 0, @CompId, 3, @Priya);
DECLARE @Meera INT = (SELECT Id FROM dbo.tblUser WHERE Username = 'demo_bm_ip_meera');

IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'demo_se_ip_rohan')
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, CompId, BranchId, ReportsTo)
    VALUES ('demo_se_ip_rohan', @Pwd, 1, 0, '', 0, 'Rohan Das (Exec Indirapuram)', 'demo_se_ip_rohan@nexus.test', 'Sales Executive', 0, @CompId, 3, @Meera);
IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'demo_se_ip_isha')
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, CompId, BranchId, ReportsTo)
    VALUES ('demo_se_ip_isha', @Pwd, 1, 0, '', 0, 'Isha Bose (Exec Indirapuram)', 'demo_se_ip_isha@nexus.test', 'Sales Executive', 0, @CompId, 3, @Meera);
IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'demo_se_ip_kabir')
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, CompId, BranchId, ReportsTo)
    VALUES ('demo_se_ip_kabir', @Pwd, 1, 0, '', 0, 'Kabir Malhotra (Exec Indirapuram)', 'demo_se_ip_kabir@nexus.test', 'Sales Executive', 0, @CompId, 3, @Meera);

-- Group membership: 13 = Branch Manager, 16 = Sales Executive (tblUser has no GroupId)
INSERT INTO dbo.tblUserGroupMap (UserId, GroupId)
SELECT u.Id, CASE WHEN u.Username = 'demo_bm_ip_meera' THEN 13 ELSE 16 END
FROM dbo.tblUser u
WHERE u.Username IN ('demo_bm_ip_meera','demo_se_ip_rohan','demo_se_ip_isha','demo_se_ip_kabir')
  AND NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m WHERE m.UserId = u.Id);

-- ---------------------------------------------------------------------------
-- 3. Products — the 4 live ones + 2 demo, ordinal 0..5 by Id
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblProduct (CompId, Name, Code, CategoryId, UnitPrice, MarginPct, IsActive, CreatedBy)
VALUES (@CompId, N'DEMO Gold Bangle Set', 'DGB1', @catGeneral, 120000, 15, 1, @Priya),
       (@CompId, N'DEMO Silver Coin 10g', 'DSC1', @catGeneral, 900, 20, 1, @Priya);

SELECT Ord = ROW_NUMBER() OVER (ORDER BY Id) - 1, Id, ISNULL(UnitPrice, 10000) AS UnitPrice
INTO #Prod
FROM dbo.tblProduct
WHERE CompId = @CompId AND IsActive = 1 AND (Code IN ('GC22','DR01','SA01','PB01') OR Name LIKE 'DEMO %');
IF (SELECT COUNT(*) FROM #Prod) <> 6
BEGIN RAISERROR('076: expected the 4 live products (GC22/DR01/SA01/PB01) + 2 demo products', 16, 1); RETURN; END

-- ---------------------------------------------------------------------------
-- 4. Rosters — execs per branch with cumulative weights (two stars, one
--    laggard), and the branch manager who "assigns"
-- ---------------------------------------------------------------------------
CREATE TABLE #Owner (BranchId INT, Ord INT, UserId INT, W INT);
INSERT INTO #Owner (BranchId, Ord, UserId, W)
SELECT 1, 0, Id, 450  FROM dbo.tblUser WHERE Username = 'se_ho_amit'     UNION ALL   -- star
SELECT 1, 1, Id, 800  FROM dbo.tblUser WHERE Username = 'se_ho_sara'     UNION ALL
SELECT 1, 2, Id, 1000 FROM dbo.tblUser WHERE Username = 'se_ho_karan'    UNION ALL   -- laggard
SELECT 2, 0, Id, 550  FROM dbo.tblUser WHERE Username = 'se_se_pooja'    UNION ALL   -- star
SELECT 2, 1, Id, 1000 FROM dbo.tblUser WHERE Username = 'se_se_dev'      UNION ALL
SELECT 3, 0, Id, 400  FROM dbo.tblUser WHERE Username = 'demo_se_ip_rohan' UNION ALL
SELECT 3, 1, Id, 750  FROM dbo.tblUser WHERE Username = 'demo_se_ip_isha'  UNION ALL
SELECT 3, 2, Id, 1000 FROM dbo.tblUser WHERE Username = 'demo_se_ip_kabir';
IF (SELECT COUNT(*) FROM #Owner) <> 8
BEGIN RAISERROR('076: expected 8 executives across branches 1/2/3', 16, 1); RETURN; END

CREATE TABLE #BM (BranchId INT PRIMARY KEY, UserId INT);
INSERT INTO #BM SELECT 1, Id FROM dbo.tblUser WHERE Username = 'bm_ho_rahul';
INSERT INTO #BM SELECT 2, Id FROM dbo.tblUser WHERE Username = 'bm_se_vikram';
INSERT INTO #BM VALUES (3, @Meera);

-- ---------------------------------------------------------------------------
-- 5. Name / place lists
-- ---------------------------------------------------------------------------
CREATE TABLE #First (Ord INT PRIMARY KEY, Name NVARCHAR(40));
INSERT INTO #First VALUES (0,N'Aarav'),(1,N'Diya'),(2,N'Kabir'),(3,N'Ananya'),(4,N'Vihaan'),(5,N'Ira'),
                          (6,N'Arjun'),(7,N'Myra'),(8,N'Reyansh'),(9,N'Saanvi'),(10,N'Advait'),(11,N'Kiara');
CREATE TABLE #Last (Ord INT PRIMARY KEY, Name NVARCHAR(40));
INSERT INTO #Last VALUES (0,N'Sharma'),(1,N'Verma'),(2,N'Gupta'),(3,N'Singh'),(4,N'Khan'),
                         (5,N'Joshi'),(6,N'Nair'),(7,N'Patel'),(8,N'Mehta'),(9,N'Rao');
CREATE TABLE #City (Ord INT PRIMARY KEY, City NVARCHAR(60), State NVARCHAR(60), Pincode VARCHAR(10));
INSERT INTO #City VALUES
 (0,N'New Delhi',N'Delhi','110001'),(1,N'Noida',N'Uttar Pradesh','201301'),(2,N'Ghaziabad',N'Uttar Pradesh','201010'),
 (3,N'Gurugram',N'Haryana','122001'),(4,N'Faridabad',N'Haryana','121001'),(5,N'Indirapuram',N'Uttar Pradesh','201014'),
 (6,N'Dwarka',N'Delhi','110075'),(7,N'Rohini',N'Delhi','110085'),(8,N'Greater Noida',N'Uttar Pradesh','201310'),
 (9,N'Vaishali',N'Uttar Pradesh','201012'),(10,N'Saket',N'Delhi','110017'),(11,N'Lajpat Nagar',N'Delhi','110024');
CREATE TABLE #Remark (Ord INT PRIMARY KEY, Text NVARCHAR(200));
INSERT INTO #Remark VALUES
 (0,N'Spoke, wants a quote'),(1,N'Asked to call back next week'),(2,N'Visited store, liked the design'),
 (3,N'Comparing with another jeweller'),(4,N'Budget is tight this month'),(5,N'Wants a custom engraving'),
 (6,N'No answer, left a message'),(7,N'Confirmed interest, sending catalogue'),(8,N'Meeting at the showroom went well'),
 (9,N'Needs approval from family'),(10,N'Asked about exchange offer'),(11,N'Wrong number, verified alternate'),
 (12,N'Interested in festive collection'),(13,N'Requested EMI details'),(14,N'Will decide after the wedding date'),
 (15,N'Discussed hallmark and purity'),(16,N'Wants delivery to another city'),(17,N'Busy, call after 6 pm'),
 (18,N'Sent price list on WhatsApp'),(19,N'Follow up after their trip');

-- ---------------------------------------------------------------------------
-- 6. Numbers + hash streams (see plan for the worked example)
-- ---------------------------------------------------------------------------
SELECT TOP (600) n = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1
INTO #N FROM sys.all_objects a CROSS JOIN sys.all_objects b;

SELECT n,
       hA = (n * 7919) % 1000,        hB = (n * 7907 + 101) % 1000, hC = (n * 7877 + 211) % 1000, hD = (n * 7873 + 307) % 1000,
       hE = (n * 7867 + 401) % 1000,  hF = (n * 7853 + 503) % 1000, hG = (n * 7841 + 601) % 1000, hH = (n * 7829 + 701) % 1000,
       hI = (n * 7823 + 809) % 1000,  hJ = (n * 7817 + 907) % 1000, hK = (n * 7789 + 113) % 1000, hL = (n * 7759 + 223) % 1000,
       hM = (n * 7757 + 331) % 1000,  hN = (n * 7753 + 433) % 1000, hS = (n * 7741 + 541) % 1000, hR = (n * 7727 + 641) % 1000,
       hY = (n * 7723 + 743) % 1000,  hZ = (n * 7717 + 853) % 1000
INTO #H FROM #N;

-- ---------------------------------------------------------------------------
-- 7. One row per lead, every attribute decided. Chained CROSS APPLYs so a
--    value can build on the one before it (Age -> CreatedAt -> offsets ->
--    close date); no ALTER TABLE on a temp table mid-batch.
-- ---------------------------------------------------------------------------
SELECT h.n,
       a.Age,
       b.BranchId, b.SourceId, b.ProdOrd, b.StatusId, b.LostReasonId, b.FuCount, b.Mult, b.Noise,
       b.FirstOrd, b.LastOrd, b.CityOrd, b.CreatedAt,
       c.dC, c.dF, c.dQ, c.dL, c.dJ,
       d.CloseAt,
       OwnerId = (SELECT TOP 1 o.UserId FROM #Owner o WHERE o.BranchId = b.BranchId AND h.hC < o.W ORDER BY o.W),
       hY = h.hY, hZ = h.hZ,
       CAST(NULL AS INT) AS LeadId
INTO #Seed
FROM #H h
CROSS APPLY (SELECT (h.hA * h.hA) / 5556 AS Age) a                                   -- 0..179, denser near 0
CROSS APPLY (SELECT
       BranchId = CASE WHEN h.hB < 450 THEN 1 WHEN h.hB < 800 THEN 2 ELSE 3 END,
       SourceId = CASE WHEN h.hD < 300 THEN @srcWebsite WHEN h.hD < 500 THEN @srcReferral WHEN h.hD < 650 THEN @srcWalkIn
                       WHEN h.hD < 800 THEN @srcPhone   WHEN h.hD < 920 THEN @srcSocial   ELSE @srcAd END,
       ProdOrd  = h.hE % 6,
       StatusId = CASE WHEN h.hS < 200 THEN @stNew WHEN h.hS < 400 THEN @stContacted WHEN h.hS < 550 THEN @stFollowUp
                       WHEN h.hS < 750 THEN @stQualified WHEN h.hS < 930 THEN @stLost ELSE @stJunk END,
       LostReasonId = CASE WHEN h.hR < 350 THEN @lrPrice WHEN h.hR < 600 THEN @lrCompetitor WHEN h.hR < 750 THEN @lrBudget
                           WHEN h.hR < 900 THEN @lrNotInterested ELSE @lrNoResponse END,
       FuCount  = 2 + (h.hN % 5),
       Mult     = 1 + (h.hF % 3),
       Noise    = 90 + (h.hG % 21),
       FirstOrd = h.hM % 12, LastOrd = h.hG % 10, CityOrd = h.hH % 12,
       CreatedAt = DATEADD(MINUTE, 540 + (h.hL % 600), DATEADD(DAY, -a.Age, @Today))     -- 09:00–19:00, Age days ago
) b
CROSS APPLY (SELECT   -- timeline offsets (contact 0–3 d, qualify 5–25 d, lost 3–40 d), clamped to Age
       dC = CASE WHEN h.hI % 4 < a.Age THEN h.hI % 4 ELSE a.Age END,
       dF = CASE WHEN (h.hI % 4) + 1 < a.Age THEN (h.hI % 4) + 1 ELSE a.Age END,
       dQ = CASE WHEN 5 + (h.hJ % 21) < a.Age THEN 5 + (h.hJ % 21) ELSE a.Age END,
       dL = CASE WHEN 3 + (h.hK % 38) < a.Age THEN 3 + (h.hK % 38) ELSE a.Age END,
       dJ = CASE WHEN a.Age >= 1 THEN 1 ELSE 0 END
) c
CROSS APPLY (SELECT
       CloseAt = CASE WHEN b.StatusId = @stLost THEN DATEADD(HOUR, 3, DATEADD(DAY, c.dL, b.CreatedAt))
                      WHEN b.StatusId = @stJunk THEN DATEADD(HOUR, 2, DATEADD(DAY, c.dJ, b.CreatedAt)) END
) d;

-- ---------------------------------------------------------------------------
-- 8. Leads
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblLeads
    (CompId, BranchId, Name, Company, MobileNo, Email, Address, City, State, Pincode,
     SourceId, ProductId, StatusId, OwnerId, EstValue, Remarks, AssignedAt,
     LostAt, LostReasonId, CreatedBy, EditBy, CreatedAt, UpdatedAt)
SELECT @CompId, s.BranchId,
       N'DEMO ' + f.Name + N' ' + l.Name,
       NULL,
       '98' + RIGHT('00000000' + CAST(s.n AS VARCHAR(8)), 8),
       LOWER(f.Name + '.' + l.Name) + CAST(s.n AS VARCHAR(8)) + '@example.com',
       CAST(10 + s.n % 90 AS NVARCHAR(4)) + N', ' + c.City,
       c.City, c.State, c.Pincode,
       s.SourceId, p.Id, s.StatusId, s.OwnerId,
       CAST(p.UnitPrice * s.Mult * s.Noise / 100.0 AS DECIMAL(18,2)),
       N'Demo lead — seeded by 076',
       s.CreatedAt,
       CASE WHEN s.StatusId = @stLost THEN s.CloseAt END,
       CASE WHEN s.StatusId = @stLost THEN s.LostReasonId END,
       s.OwnerId, s.OwnerId, s.CreatedAt, s.CreatedAt
FROM #Seed s
JOIN #Prod p  ON p.Ord = s.ProdOrd
JOIN #First f ON f.Ord = s.FirstOrd
JOIN #Last l  ON l.Ord = s.LastOrd
JOIN #City c  ON c.Ord = s.CityOrd;

UPDATE s SET LeadId = ld.Id
FROM #Seed s
JOIN dbo.tblLeads ld ON ld.CompId = @CompId AND ld.Name LIKE 'DEMO %'
                     AND ld.MobileNo = '98' + RIGHT('00000000' + CAST(s.n AS VARCHAR(8)), 8);

-- ---------------------------------------------------------------------------
-- 9. Status history — the timeline each lead walked
-- ---------------------------------------------------------------------------
-- (a) opening row for every lead
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, NULL, @stNew, OwnerId, CreatedAt FROM #Seed;

-- (b) New -> Contacted: everything past New, plus Lost leads that were spoken to first
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, @stNew, @stContacted, OwnerId, DATEADD(HOUR, 1, DATEADD(DAY, dC, CreatedAt))
FROM #Seed
WHERE StatusId IN (@stContacted, @stFollowUp, @stQualified) OR (StatusId = @stLost AND dL > dC);

-- (c) Contacted -> Follow-up
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, @stContacted, @stFollowUp, OwnerId, DATEADD(HOUR, 2, DATEADD(DAY, dF, CreatedAt))
FROM #Seed WHERE StatusId = @stFollowUp;

-- (d) Contacted -> Qualified
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, @stContacted, @stQualified, OwnerId, DATEADD(HOUR, 2, DATEADD(DAY, CASE WHEN dQ > dC THEN dQ ELSE dC END, CreatedAt))
FROM #Seed WHERE StatusId = @stQualified;

-- (e) -> Lost (from Contacted when there was a conversation, else straight from New)
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, CASE WHEN dL > dC THEN @stContacted ELSE @stNew END, @stLost, OwnerId, CloseAt
FROM #Seed WHERE StatusId = @stLost;

-- (f) New -> Junk
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, @stNew, @stJunk, OwnerId, CloseAt
FROM #Seed WHERE StatusId = @stJunk;

-- ---------------------------------------------------------------------------
-- 10. Follow-ups — 2–6 per lead; past ones 70 % on time / 20 % late / 10 % missed
-- ---------------------------------------------------------------------------
SELECT TOP (6) m = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 INTO #M FROM sys.all_objects;

SELECT s.n, s.LeadId, s.BranchId, s.OwnerId, s.StatusId, s.CloseAt, x.m,
       a.DueAt, a.hT, a.hP, a.hO, a.hDir, a.hRem,
       b.Type, b.Status, b.DoneAt,
       OutcomeId = CASE WHEN b.Status = 'done' AND b.Type = 'call'
                        THEN CASE WHEN a.hO < 550 THEN @ocConnected WHEN a.hO < 750 THEN @ocNoAnswer WHEN a.hO < 850 THEN @ocBusy
                                  WHEN a.hO < 900 THEN @ocWrong ELSE @ocCallback END END,
       Duration  = CASE WHEN b.Status = 'done' AND b.Type = 'call' THEN 2 + (a.hO % 24) END,
       Direction = CASE WHEN b.Status = 'done' AND b.Type = 'call' THEN CASE WHEN a.hDir < 800 THEN 'out' ELSE 'in' END END,
       Remarks   = CASE WHEN b.Status IN ('done','skipped') THEN (SELECT r.Text FROM #Remark r WHERE r.Ord = a.hRem) END
INTO #FU
FROM #Seed s
JOIN #M x ON x.m < s.FuCount
CROSS APPLY (SELECT
       DueAt = DATEADD(HOUR, 10 + ((s.n + x.m * 3) % 9),
                       DATEADD(DAY, x.m * (2 + ((s.n * 13 + x.m * 7) % 5)), CAST(CAST(s.CreatedAt AS DATE) AS DATETIME))),
       hT   = (s.n * 31 + x.m * 17) % 1000,
       hP   = (s.n * 37 + x.m * 19 + 5) % 1000,
       hO   = (s.n * 41 + x.m * 23) % 1000,
       hDir = (s.n * 43 + x.m * 29) % 1000,
       hRem = (s.n * 47 + x.m * 31) % 20
) a
CROSS APPLY (SELECT
       Type   = CASE WHEN a.hT < 650 THEN 'call' WHEN a.hT < 850 THEN 'visit' WHEN a.hT < 950 THEN 'meeting' ELSE 'other' END,
       Status = CASE WHEN a.DueAt >= @Now THEN 'open'
                     WHEN a.hP < 900 THEN 'done'                          -- 70 % on time + 20 % late
                     WHEN s.CloseAt IS NOT NULL THEN 'skipped'            -- a closed lead's stragglers were skipped, not missed
                     ELSE 'open' END,                                     -- 10 % left open past due = missed
       DoneAt = CASE WHEN a.DueAt >= @Now THEN NULL
                     WHEN a.hP < 700 THEN DATEADD(MINUTE, a.hP % 120, a.DueAt)        -- on time (<= +2 h)
                     WHEN a.hP < 900 THEN DATEADD(DAY, 1 + (a.hP % 5), a.DueAt)       -- 1–5 days late
                     ELSE NULL END
) b
-- A closed lead has no follow-ups after it closed and none in the future.
WHERE NOT (s.CloseAt IS NOT NULL AND (a.DueAt > s.CloseAt OR a.DueAt >= @Now));

-- A "done" stamp cannot sit in the future.
UPDATE #FU SET DoneAt = DATEADD(MINUTE, -30, @Now) WHERE DoneAt > @Now;

INSERT INTO dbo.tblFollowUp
    (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, DoneAt, DoneBy, OutcomeId, Remarks, Direction, Duration, CreatedBy, CreatedAt, EditBy, UpdatedAt)
SELECT @CompId, f.BranchId, f.LeadId, f.Type, f.DueAt, f.OwnerId, f.Status, f.DoneAt,
       CASE WHEN f.Status = 'done' THEN f.OwnerId END,
       f.OutcomeId, f.Remarks, f.Direction, f.Duration,
       f.OwnerId, CASE WHEN f.m = 0 THEN s.CreatedAt ELSE DATEADD(DAY, -1, f.DueAt) END,
       CASE WHEN f.Status <> 'open' THEN f.OwnerId END, COALESCE(f.DoneAt, CASE WHEN f.Status = 'skipped' THEN f.DueAt END)
FROM #FU f
JOIN #Seed s ON s.n = f.n;

-- NextFollowupDate = earliest open follow-up (what sp_RefreshLeadNextFollowup keeps)
UPDATE ld SET NextFollowupDate = nf.NextDue
FROM dbo.tblLeads ld
JOIN #Seed s ON s.LeadId = ld.Id
LEFT JOIN (SELECT LeadId, MIN(DueAt) AS NextDue FROM dbo.tblFollowUp WHERE Status = 'open' GROUP BY LeadId) nf ON nf.LeadId = ld.Id;

-- ---------------------------------------------------------------------------
-- 11. Assignments — creation row for all; transfers for 12 %, 3 % cross-branch
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
SELECT @CompId, s.LeadId, NULL, s.OwnerId, NULL, s.BranchId, NULL, N'Assigned on creation', bm.UserId, s.CreatedAt
FROM #Seed s JOIN #BM bm ON bm.BranchId = s.BranchId;

-- (a) cross-branch (hY < 30): to the next branch's first exec, reason Wrong branch
SELECT s.n, s.LeadId, s.OwnerId AS FromUserId, s.BranchId AS FromBranchId,
       ToBranchId = (s.BranchId % 3) + 1,
       ToUserId   = (SELECT o.UserId FROM #Owner o WHERE o.BranchId = (s.BranchId % 3) + 1 AND o.Ord = 0),
       ReasonId   = @trWrongBranch,
       AssignedAt = DATEADD(HOUR, 4, DATEADD(DAY, CASE WHEN 1 + (s.hY % 10) < s.Age THEN 1 + (s.hY % 10) ELSE s.Age END, s.CreatedAt))
INTO #X
FROM #Seed s WHERE s.hY < 30;

-- (b) in-branch (30 <= hY < 120): to another exec of the same branch, weighted reason
INSERT INTO #X (n, LeadId, FromUserId, FromBranchId, ToBranchId, ToUserId, ReasonId, AssignedAt)
SELECT s.n, s.LeadId, s.OwnerId, s.BranchId, s.BranchId,
       (SELECT o2.UserId FROM #Owner o2 WHERE o2.BranchId = s.BranchId
         AND o2.Ord = ((SELECT o1.Ord FROM #Owner o1 WHERE o1.UserId = s.OwnerId) + 1) % (SELECT COUNT(*) FROM #Owner o3 WHERE o3.BranchId = s.BranchId)),
       CASE WHEN s.hZ < 300 THEN @trAbsent WHEN s.hZ < 550 THEN @trOverloaded WHEN s.hZ < 750 THEN @trReassigned
            WHEN s.hZ < 900 THEN @trSentBack ELSE @trOther END,
       DATEADD(HOUR, 4, DATEADD(DAY, CASE WHEN 1 + (s.hY % 10) < s.Age THEN 1 + (s.hY % 10) ELSE s.Age END, s.CreatedAt))
FROM #Seed s WHERE s.hY >= 30 AND s.hY < 120;

INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
SELECT @CompId, x.LeadId, x.FromUserId, x.ToUserId, x.FromBranchId, x.ToBranchId, x.ReasonId,
       N'Demo transfer — seeded by 076', bm.UserId, x.AssignedAt
FROM #X x JOIN #BM bm ON bm.BranchId = x.FromBranchId;

-- (c) second row for 60 <= hY < 120: sent back to the (new) branch manager 3 days later
INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
SELECT @CompId, x.LeadId, x.ToUserId, bm.UserId, x.ToBranchId, x.ToBranchId, @trSentBack,
       N'Demo send-back — seeded by 076', x.ToUserId,
       CASE WHEN DATEADD(DAY, 3, x.AssignedAt) < @Now THEN DATEADD(DAY, 3, x.AssignedAt) ELSE DATEADD(HOUR, -1, @Now) END
FROM #X x JOIN #Seed s ON s.n = x.n JOIN #BM bm ON bm.BranchId = x.ToBranchId
WHERE s.hY >= 60;

-- The lead reflects its LAST assignment (owner, branch, AssignedAt); open follow-ups travel with it.
UPDATE ld SET OwnerId = la.ToUserId, BranchId = la.ToBranchId, AssignedAt = la.AssignedAt, UpdatedAt = la.AssignedAt
FROM dbo.tblLeads ld
JOIN (SELECT a.LeadId, a.ToUserId, a.ToBranchId, a.AssignedAt,
             ROW_NUMBER() OVER (PARTITION BY a.LeadId ORDER BY a.AssignedAt DESC, a.Id DESC) AS rn
      FROM dbo.tblLeadAssignment a WHERE a.ReasonId IS NOT NULL AND a.LeadId IN (SELECT LeadId FROM #Seed)) la
  ON la.LeadId = ld.Id AND la.rn = 1;
UPDATE f SET AssignedTo = ld.OwnerId, BranchId = ld.BranchId
FROM dbo.tblFollowUp f JOIN dbo.tblLeads ld ON ld.Id = f.LeadId
WHERE f.Status = 'open' AND ld.Id IN (SELECT LeadId FROM #Seed);

DROP TABLE #Prod, #Owner, #BM, #First, #Last, #City, #Remark, #N, #H, #Seed, #M, #FU, #X;
GO

-- ===========================================================================
-- VERIFY AFTER APPLY
-- ===========================================================================
SET NOCOUNT ON;
SELECT 'demo users' AS what, COUNT(*) AS N, 4 AS expect FROM dbo.tblUser WHERE Username LIKE 'demo\_%' ESCAPE '\';
SELECT 'demo products' AS what, COUNT(*) AS N, 2 AS expect FROM dbo.tblProduct WHERE Name LIKE 'DEMO %';
SELECT 'demo leads' AS what, COUNT(*) AS N, 600 AS expect FROM dbo.tblLeads WHERE Name LIKE 'DEMO %';

-- Distribution: branch x status (expect roughly 45/35/20 by branch, 55/20/18/7 by status class)
SELECT l.BranchId, st.Value AS Status, COUNT(*) AS N
FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
WHERE l.Name LIKE 'DEMO %' GROUP BY l.BranchId, st.Value ORDER BY l.BranchId, st.Value;

-- Follow-ups by status (expect done ≫ open ≫ skipped) and history rows (expect ≥ 600)
SELECT 'follow-ups' AS what, Status, COUNT(*) AS N FROM dbo.tblFollowUp
WHERE LeadId IN (SELECT Id FROM dbo.tblLeads WHERE Name LIKE 'DEMO %') GROUP BY Status;
SELECT 'history rows' AS what, COUNT(*) AS N FROM dbo.tblLeadStatusHistory
WHERE LeadId IN (SELECT Id FROM dbo.tblLeads WHERE Name LIKE 'DEMO %');
SELECT 'transfer rows (ReasonId set)' AS what, COUNT(*) AS N,
       SUM(CASE WHEN FromBranchId <> ToBranchId THEN 1 ELSE 0 END) AS CrossBranch
FROM dbo.tblLeadAssignment WHERE ReasonId IS NOT NULL AND LeadId IN (SELECT Id FROM dbo.tblLeads WHERE Name LIKE 'DEMO %');

-- KPI row of every report for the last 90 days, Sales-Head scope
DECLARE @from DATE = DATEADD(DAY, -90, CAST(GETDATE() AS DATE)), @to DATE = CAST(GETDATE() AS DATE);
DECLARE @all NVARCHAR(MAX) = '[1,2,3,4,5]';
SELECT 'KPIs, last 90 days, as sh_priya — read the FIRST grid under each label' AS step;
SELECT 'sp_RptFunnel' AS step;             EXEC dbo.sp_RptFunnel             @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='source', @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptFollowUpCompliance' AS step; EXEC dbo.sp_RptFollowUpCompliance @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptActivity' AS step;           EXEC dbo.sp_RptActivity           @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptLost' AS step;               EXEC dbo.sp_RptLost               @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='reason', @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptAging' AS step;              EXEC dbo.sp_RptAging              @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptTransfers' AS step;          EXEC dbo.sp_RptTransfers          @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='reason', @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptPipelineValue' AS step;      EXEC dbo.sp_RptPipelineValue      @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='status', @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptLeaderboard' AS step;        EXEC dbo.sp_RptLeaderboard        @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=13, @AccessibleBranchIdsJson=@all;
GO
```

- [ ] **Step 2: Write `077_remove_sales_demo.sql`**

```sql
-- ============================================================================
-- 077_remove_sales_demo.sql — undo 076 completely
--
-- Leads named 'DEMO %' and every child row, the two 'DEMO %' products, the
-- four 'demo_%' users and their group rows. Real data untouched. Idempotent.
-- APPLY BY HAND when the demo data is no longer wanted.
-- Author: Claude  Date: 2026-09-10
-- ============================================================================
SET NOCOUNT ON;
DECLARE @CompId INT = 1;

DECLARE @Old TABLE (Id INT PRIMARY KEY);
INSERT INTO @Old SELECT Id FROM dbo.tblLeads WHERE CompId = @CompId AND Name LIKE 'DEMO %';
DELETE FROM dbo.tblFollowUp          WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadAssignment    WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadStatusHistory WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadActivity      WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblCustomFieldValue  WHERE CompId = @CompId AND Entity = 'lead' AND EntityId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeads             WHERE Id IN (SELECT Id FROM @Old);

DELETE FROM dbo.tblProduct WHERE CompId = @CompId AND Name LIKE 'DEMO %';

DECLARE @Users TABLE (Id INT PRIMARY KEY);
INSERT INTO @Users SELECT Id FROM dbo.tblUser WHERE CompId = @CompId AND Username LIKE 'demo\_%' ESCAPE '\';
DELETE FROM dbo.tblUserGroupMap     WHERE UserId IN (SELECT Id FROM @Users);
DELETE FROM dbo.tblUserBranchAccess WHERE UserId IN (SELECT Id FROM @Users);
DELETE FROM dbo.tblUser             WHERE Id IN (SELECT Id FROM @Users);
GO

-- verify after apply (expect 0 / 0 / 0 / 0)
SELECT 'demo leads' AS what, COUNT(*) AS N FROM dbo.tblLeads WHERE Name LIKE 'DEMO %'
UNION ALL SELECT 'demo products', COUNT(*) FROM dbo.tblProduct WHERE Name LIKE 'DEMO %'
UNION ALL SELECT 'demo users',    COUNT(*) FROM dbo.tblUser WHERE Username LIKE 'demo\_%' ESCAPE '\'
UNION ALL SELECT 'orphan follow-ups', COUNT(*) FROM dbo.tblFollowUp f WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLeads l WHERE l.Id = f.LeadId);
GO
```

- [ ] **Step 3: Static checks**

Run: `cd backend && grep -c "NEWID\|RAND(" sql/076_seed_sales_demo.sql; grep -c "^GO$" sql/076_seed_sales_demo.sql sql/077_remove_sales_demo.sql`
Expected: `0` (no randomness); `076` has 3 batches, `077` has 2.

- [ ] **Step 4: Stop and report** — both paths. The owner applies `076` **after** the backend deploy (rollout order) and keeps `077` until the demo is retired.

---

### Task 6: `reportKit.js` — `parseReportArgs` + `runReport`

**Files:**
- Create: `backend/src/utils/reportKit.js`
- Create: `backend/tests/unit/utils/reportKit.test.js`

**Interfaces:**
- Consumes: `database.executeStoredProcedure(name, params)`; `scopeParams(req)` from `src/middleware/permission.js` (`{ UserId, AccessibleBranchIdsJson, OwnerIdsJson }`); `positiveInt` from `src/utils/controllerKit.js`; `success`/`error` from `src/utils/responseHelper.js`.
- Produces:
  - `REPORTS` — `{ funnel: { sp: "sp_RptFunnel", groupBys: [...] }, followUpCompliance, activity, lost, aging, transfers, pipelineValue, leaderboard }` (whitelists match Tasks 2–4 exactly).
  - `parseReportArgs(body, key, today = new Date())` → `{ error: string }` **or** `{ args: { FromDate, ToDate, DateBasis, GroupBy, BranchId, OwnerId, SourceId, ProductId } }`. Defaults: last 30 days (`ToDate` = today, `FromDate` = today − 29), basis `created`, the report's first GroupBy.
  - `runReport(spName, req, res, key)` → 400 on a parse error; otherwise calls the SP with `{ CompId, ...args, ...scopeParams(req) }` and responds `success(res, "Report fetched successfully", { kpis: rs[0]?.[0] ?? {}, rows: rs[1] ?? [], trend: rs[2] ?? [], range: { from, to, basis, groupBy } })`. Throws on a DB error (the controller's `asyncRoute` turns that into a 500). Task 7 wraps it.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/unit/utils/reportKit.test.js
jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const { REPORTS, parseReportArgs, runReport } = require("../../../src/utils/reportKit");
const { mockRes } = require("../../helpers/mockRes");

const TODAY = new Date("2026-09-10T12:00:00Z");
const req = (body = {}, scope = { branchIds: [1, 2], ownerIds: null }) => ({
  user: { UserId: 13, CompId: 1, BranchId: 1 },
  scope,
  body,
});

beforeEach(() => database.executeStoredProcedure.mockReset());

describe("REPORTS", () => {
  it("lists the eight reports with their SP and a non-empty GroupBy whitelist", () => {
    expect(Object.keys(REPORTS)).toEqual([
      "funnel", "followUpCompliance", "activity", "lost", "aging", "transfers", "pipelineValue", "leaderboard",
    ]);
    for (const r of Object.values(REPORTS)) {
      expect(r.sp).toMatch(/^sp_Rpt/);
      expect(r.groupBys.length).toBeGreaterThan(0);
    }
    expect(REPORTS.transfers.groupBys).toContain("pair");
    expect(REPORTS.leaderboard.groupBys).toEqual(["owner"]);
  });
});

describe("parseReportArgs", () => {
  it("defaults to the last 30 days, basis created and the first GroupBy", () => {
    const { args } = parseReportArgs({}, "funnel", TODAY);
    expect(args).toEqual({
      FromDate: "2026-08-12", ToDate: "2026-09-10", DateBasis: "created", GroupBy: "source",
      BranchId: null, OwnerId: null, SourceId: null, ProductId: null,
    });
  });

  it("accepts explicit dates, basis, GroupBy and narrows the id filters", () => {
    const { args } = parseReportArgs(
      { FromDate: "2026-01-01", ToDate: "2026-03-31", DateBasis: "closed", GroupBy: "owner",
        BranchId: "2", OwnerId: 17, SourceId: 0, ProductId: "abc" },
      "funnel", TODAY,
    );
    expect(args).toEqual({
      FromDate: "2026-01-01", ToDate: "2026-03-31", DateBasis: "closed", GroupBy: "owner",
      BranchId: 2, OwnerId: 17, SourceId: null, ProductId: null,
    });
  });

  it("derives FromDate from an explicit ToDate", () => {
    const { args } = parseReportArgs({ ToDate: "2026-06-30" }, "funnel", TODAY);
    expect(args.FromDate).toBe("2026-06-01");
  });

  it.each([
    [{ FromDate: "10/09/2026" }, /YYYY-MM-DD/],
    [{ ToDate: "2026-13-45" }, /YYYY-MM-DD/],
    [{ FromDate: "2026-09-11", ToDate: "2026-09-10" }, /not be after/],
    [{ DateBasis: "invoiced" }, /DateBasis/],
    [{ GroupBy: "nope" }, /GroupBy must be one of/],
    [{ GroupBy: "pair" }, /GroupBy must be one of/], // valid for transfers, not for funnel
  ])("rejects %j", (body, message) => {
    const { error, args } = parseReportArgs(body, "funnel", TODAY);
    expect(args).toBeUndefined();
    expect(error).toMatch(message);
  });

  it("rejects an unknown report key", () => {
    expect(parseReportArgs({}, "revenue", TODAY).error).toMatch(/Unknown report/);
  });
});

describe("runReport", () => {
  it("400s on a validation error without touching the database", async () => {
    const res = mockRes();
    await runReport("sp_RptFunnel", req({ GroupBy: "nope" }), res, "funnel");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("calls the SP with CompId + args + the caller's scope and maps the three result sets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Created: 10, Qualified: 3 }],
        [{ GroupKey: 11, GroupLabel: "Website", Created: 6 }],
        [{ Bucket: "2026-09-07", Created: 4 }],
      ],
    });
    const res = mockRes();
    await runReport(
      "sp_RptFunnel",
      req({ FromDate: "2026-08-01", ToDate: "2026-08-31", GroupBy: "source", BranchId: 2 }, { branchIds: [1, 2], ownerIds: [17] }),
      res, "funnel",
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_RptFunnel", {
      CompId: 1,
      FromDate: "2026-08-01", ToDate: "2026-08-31", DateBasis: "created", GroupBy: "source",
      BranchId: 2, OwnerId: null, SourceId: null, ProductId: null,
      UserId: 13, AccessibleBranchIdsJson: "[1,2]", OwnerIdsJson: "[17]",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      kpis: { Created: 10, Qualified: 3 },
      rows: [{ GroupKey: 11, GroupLabel: "Website", Created: 6 }],
      trend: [{ Bucket: "2026-09-07", Created: 4 }],
      range: { from: "2026-08-01", to: "2026-08-31", basis: "created", groupBy: "source" },
    });
  });

  // The leaderboard's RS1 and RS3 are empty by contract; an empty first
  // recordset must become {} not undefined, so the page can read kpis.X safely.
  it("returns {} kpis and [] trend when those result sets are empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [{ GroupKey: 17, Rank: 1 }], []] });
    const res = mockRes();
    await runReport("sp_RptLeaderboard", req({ FromDate: "2026-08-01", ToDate: "2026-08-31" }), res, "leaderboard");
    const { data } = res.json.mock.calls[0][0];
    expect(data.kpis).toEqual({});
    expect(data.rows).toHaveLength(1);
    expect(data.trend).toEqual([]);
  });

  it("sends null scope json (and still the UserId) when req.scope is absent — loadScope always sets it in production", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const r = { user: { UserId: 13, CompId: 1 }, body: {} };
    await runReport("sp_RptFunnel", r, mockRes(), "funnel");
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      UserId: 13, AccessibleBranchIdsJson: null, OwnerIdsJson: null,
    });
  });

  it("lets a database error propagate (asyncRoute in the controller turns it into a 500)", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    await expect(runReport("sp_RptFunnel", req({ FromDate: "2026-08-01", ToDate: "2026-08-31" }), mockRes(), "funnel")).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/utils/reportKit.test.js --maxWorkers=2 --silent`
Expected: FAIL — `Cannot find module '../../../src/utils/reportKit'`.

- [ ] **Step 3: Implement**

```js
// src/utils/reportKit.js
//
// The one shape every sales report endpoint shares (spec 4a §3–4): the same
// twelve SP params, the same three result sets, the same validation. Eight
// controller methods are each one line because this exists.

const database = require("../config/database");
const { scopeParams } = require("../middleware/permission");
const { success, error } = require("./responseHelper");
const { positiveInt } = require("./controllerKit");

const DATE_BASES = ["created", "closed", "activity"];

// GroupBy whitelist per report — must match the RAISERROR guard at the top of
// each sp_Rpt* (backend/sql/075). The SP rejects anything else too, but that
// surfaces as a 500; the 400 lives here.
const REPORTS = {
  funnel:             { sp: "sp_RptFunnel",             groupBys: ["source", "owner", "product", "branch", "status", "team"] },
  followUpCompliance: { sp: "sp_RptFollowUpCompliance", groupBys: ["owner", "team", "branch"] },
  activity:           { sp: "sp_RptActivity",           groupBys: ["owner", "day", "team", "branch"] },
  lost:               { sp: "sp_RptLost",               groupBys: ["reason", "source", "product", "owner", "branch"] },
  aging:              { sp: "sp_RptAging",              groupBys: ["owner", "branch", "team"] },
  transfers:          { sp: "sp_RptTransfers",          groupBys: ["reason", "pair", "branch"] },
  pipelineValue:      { sp: "sp_RptPipelineValue",      groupBys: ["status", "owner", "product", "branch"] },
  leaderboard:        { sp: "sp_RptLeaderboard",        groupBys: ["owner"] },
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const isoDay = (d) => d.toISOString().slice(0, 10);
// Date.parse rejects "2026-13-45" (NaN) but accepts "2026-02-30" as March 2;
// good enough — SQL Server's DATE rejects the rest.
const validDay = (s) => typeof s === "string" && ISO_DAY.test(s) && !Number.isNaN(Date.parse(s));

/**
 * Body -> SP params, or a message for a 400.
 * Defaults: last 30 days (today inclusive), basis 'created', the report's
 * first GroupBy. Id filters narrow only when they are positive integers.
 */
function parseReportArgs(body = {}, key, today = new Date()) {
  const report = REPORTS[key];
  if (!report) return { error: `Unknown report: ${key}` };

  const to = body.ToDate ?? isoDay(today);
  if (!validDay(to)) return { error: "FromDate and ToDate must be YYYY-MM-DD" };
  const from = body.FromDate ?? isoDay(new Date(Date.parse(to) - 29 * DAY_MS));
  if (!validDay(from)) return { error: "FromDate and ToDate must be YYYY-MM-DD" };
  if (from > to) return { error: "FromDate must not be after ToDate" };

  const basis = body.DateBasis ?? "created";
  if (!DATE_BASES.includes(basis)) return { error: `DateBasis must be one of ${DATE_BASES.join(", ")}` };

  const groupBy = body.GroupBy ?? report.groupBys[0];
  if (!report.groupBys.includes(groupBy)) return { error: `GroupBy must be one of ${report.groupBys.join(", ")}` };

  return {
    args: {
      FromDate: from,
      ToDate: to,
      DateBasis: basis,
      GroupBy: groupBy,
      BranchId: positiveInt(body.BranchId),
      OwnerId: positiveInt(body.OwnerId),
      SourceId: positiveInt(body.SourceId),
      ProductId: positiveInt(body.ProductId),
    },
  };
}

/**
 * Runs one report SP and answers in the shared shape. Throws on a DB error so
 * the controller's asyncRoute owns the 500 — one place, one message.
 */
async function runReport(spName, req, res, key) {
  const parsed = parseReportArgs(req.body, key);
  if (parsed.error) return error(res, parsed.error, "VALIDATION_ERROR", 400);

  const result = await database.executeStoredProcedure(spName, {
    CompId: req.user.CompId,
    ...parsed.args,
    ...scopeParams(req),
  });
  const rs = result?.recordsets ?? [];
  const { FromDate, ToDate, DateBasis, GroupBy } = parsed.args;
  return success(res, "Report fetched successfully", {
    kpis: rs[0]?.[0] ?? {},
    rows: rs[1] ?? [],
    trend: rs[2] ?? [],
    range: { from: FromDate, to: ToDate, basis: DateBasis, groupBy: GroupBy },
  });
}

module.exports = { REPORTS, DATE_BASES, parseReportArgs, runReport };
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/utils/reportKit.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/utils/reportKit.js'`
Expected: 16 passed; `reportKit.js` ≥ 80 % lines and branches (every early return has a case above).

- [ ] **Step 5: Stop and report.**

---

### Task 7: Report controller methods, routes, `leadController.fetch` dates

**Files:**
- Modify: `backend/src/controllers/reportController.js` (top imports + bottom export)
- Modify: `backend/src/routes/reportRoutes.js`
- Modify: `backend/src/controllers/leadController.js:69-86` (`fetch`)
- Modify: `backend/tests/unit/controllers/reportController.test.js` (append)
- Modify: `backend/tests/unit/routes/reportRoutes.test.js`
- Modify: `backend/tests/unit/controllers/leadController.test.js` (append to `describe("leadController.fetch filters")`)

**Interfaces:**
- Consumes: `runReport`, `REPORTS` (Task 6); `asyncRoute` from `controllerKit`.
- Produces: `POST /api/reports/funnel | followUpCompliance | activity | lost | aging | transfers | pipelineValue | leaderboard` → `{ success, data: { kpis, rows, trend, range } }`; `POST /api/leads/fetchLeads` accepts `FromDate`/`ToDate` (`YYYY-MM-DD`, else null). Web Tasks 10 and 11 rely on both.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/controllers/reportController.test.js`:

```js
// --- Spec 4a: the eight report endpoints, all through reportKit.runReport ---

const REPORT_METHODS = [
  ["funnel", "sp_RptFunnel", "source"],
  ["followUpCompliance", "sp_RptFollowUpCompliance", "owner"],
  ["activity", "sp_RptActivity", "owner"],
  ["lost", "sp_RptLost", "reason"],
  ["aging", "sp_RptAging", "owner"],
  ["transfers", "sp_RptTransfers", "reason"],
  ["pipelineValue", "sp_RptPipelineValue", "status"],
  ["leaderboard", "sp_RptLeaderboard", "owner"],
];

describe.each(REPORT_METHODS)("reportController.%s", (method, sp, defaultGroupBy) => {
  it(`calls ${sp} with CompId, the parsed args and the caller's scope`, async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ A: 1 }], [{ GroupKey: 1, GroupLabel: "x" }], [{ Bucket: "2026-09-01" }]],
    });
    const res = mockRes();
    await reportController[method](
      baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { FromDate: "2026-08-01", ToDate: "2026-08-31" } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(sp, {
      CompId: 5,
      FromDate: "2026-08-01", ToDate: "2026-08-31", DateBasis: "created", GroupBy: defaultGroupBy,
      BranchId: null, OwnerId: null, SourceId: null, ProductId: null,
      UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      kpis: { A: 1 },
      rows: [{ GroupKey: 1, GroupLabel: "x" }],
      trend: [{ Bucket: "2026-09-01" }],
      range: { from: "2026-08-01", to: "2026-08-31", basis: "created", groupBy: defaultGroupBy },
    });
  });

  it("400s on a GroupBy outside this report's whitelist", async () => {
    const res = mockRes();
    await reportController[method](baseReq({ body: { GroupBy: "nope" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("500s when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await reportController[method](baseReq({ body: { FromDate: "2026-08-01", ToDate: "2026-08-31" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "REPORT_ERROR" });
  });
});
```

Replace the controller mock and the route table in `backend/tests/unit/routes/reportRoutes.test.js`:

```js
jest.mock("../../../src/controllers/reportController", () => ({
  getDashboard: hit("getDashboard"),
  getConvertedSummary: hit("getConvertedSummary"),
  leadsByStatus: hit("leadsByStatus"),
  callsPerUser: hit("callsPerUser"),
  conversionBySource: hit("conversionBySource"),
  ticketsByCategory: hit("ticketsByCategory"),
  resolutionSummary: hit("resolutionSummary"),
  funnel: hit("funnel"),
  followUpCompliance: hit("followUpCompliance"),
  activity: hit("activity"),
  lost: hit("lost"),
  aging: hit("aging"),
  transfers: hit("transfers"),
  pipelineValue: hit("pipelineValue"),
  leaderboard: hit("leaderboard"),
}));
```

```js
  it.each([
    ["/api/reports/getDashboard", "getDashboard"],
    ["/api/reports/getConvertedSummary", "getConvertedSummary"],
    // Spec 1 endpoints — kept one release for the web redirects (spec 4a §4).
    ["/api/reports/leadsByStatus", "leadsByStatus"],
    ["/api/reports/callsPerUser", "callsPerUser"],
    ["/api/reports/conversionBySource", "conversionBySource"],
    ["/api/reports/ticketsByCategory", "ticketsByCategory"],
    ["/api/reports/resolutionSummary", "resolutionSummary"],
    // Spec 4a
    ["/api/reports/funnel", "funnel"],
    ["/api/reports/followUpCompliance", "followUpCompliance"],
    ["/api/reports/activity", "activity"],
    ["/api/reports/lost", "lost"],
    ["/api/reports/aging", "aging"],
    ["/api/reports/transfers", "transfers"],
    ["/api/reports/pipelineValue", "pipelineValue"],
    ["/api/reports/leaderboard", "leaderboard"],
  ])("routes %s to the %s handler", async (path, handler) => {
```

Append inside `describe("leadController.fetch filters", …)` in `backend/tests/unit/controllers/leadController.test.js`:

```js
  // Report drill-downs arrive with the range they counted (spec 4a §5).
  it("forwards an ISO FromDate/ToDate and nulls anything else", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await leadController.fetch(baseReq({ body: { FromDate: "2026-08-01", ToDate: "2026-08-31" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ FromDate: "2026-08-01", ToDate: "2026-08-31" });

    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await leadController.fetch(baseReq({ body: { FromDate: "01/08/2026", ToDate: 20260831 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ FromDate: null, ToDate: null });
  });
```

- [ ] **Step 2: Run each file to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/controllers/reportController.test.js --maxWorkers=2 --silent`
Expected: FAIL — `reportController[method] is not a function` (×24).
Run: `cd backend && pnpm exec jest tests/unit/routes/reportRoutes.test.js --maxWorkers=2 --silent`
Expected: FAIL — 8 routes answer 404.
Run: `cd backend && pnpm exec jest tests/unit/controllers/leadController.test.js --maxWorkers=2 --silent`
Expected: FAIL — `FromDate` not in the SP params.

- [ ] **Step 3: Implement the controller methods**

In `backend/src/controllers/reportController.js`, change the first two lines to:

```js
const database = require("../config/database");
const { scopeJson: serialiseScope } = require("../middleware/permission");
const { asyncRoute } = require("../utils/controllerKit");
const { runReport, REPORTS } = require("../utils/reportKit");
```

Replace the final `module.exports = new ReportController();` with:

```js
const controller = new ReportController();

// Spec 4a: one method per report, every one the same line. Assigned on the
// instance rather than declared on the class so asyncRoute wraps each once —
// a thrown SP error becomes one consistent 500, validation stays a 400 inside
// runReport. REPORTS is the single list; adding a report = one row there.
for (const [key, { sp }] of Object.entries(REPORTS)) {
  controller[key] = asyncRoute(
    (req, res) => runReport(sp, req, res, key),
    "Failed to fetch report",
    "REPORT_ERROR",
  );
}

module.exports = controller;
```

- [ ] **Step 4: Add the routes**

In `backend/src/routes/reportRoutes.js`, after the `resolutionSummary` line:

```js
// Spec 4a — the report system. Old lead reports above stay one release for
// the web redirects, then go.
router.post("/funnel", allowEmptyPayload, reportController.funnel);
router.post("/followUpCompliance", allowEmptyPayload, reportController.followUpCompliance);
router.post("/activity", allowEmptyPayload, reportController.activity);
router.post("/lost", allowEmptyPayload, reportController.lost);
router.post("/aging", allowEmptyPayload, reportController.aging);
router.post("/transfers", allowEmptyPayload, reportController.transfers);
router.post("/pipelineValue", allowEmptyPayload, reportController.pipelineValue);
router.post("/leaderboard", allowEmptyPayload, reportController.leaderboard);
```

- [ ] **Step 5: Forward the dates in `leadController.fetch`**

Above `const leadController = {` add:

```js
// A drill-down from a report carries the range it counted. Anything that is
// not a plain ISO day is dropped rather than handed to the SP as-is.
const isoDay = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
```

In `fetch`, change the destructure and the SP call:

```js
      const {
        BranchId = null, SearchTerm = null,
        StatusId = null, StatusCode = null, ProductId = null, OwnerId = null, SourceId = null,
        Overdue = false, Unassigned = false, FromDate = null, ToDate = null,
      } = req.body;
```

```js
      const result = await database.executeStoredProcedure("sp_FetchLeads", {
        CompId, BranchId, PageNumber, PageSize, SearchTerm,
        StatusId, StatusCode, ProductId, OwnerId, SourceId,
        Overdue: bit(Overdue), Unassigned: bit(Unassigned),
        FromDate: isoDay(FromDate), ToDate: isoDay(ToDate),
        ...scopeParams(req),
      });
```

- [ ] **Step 6: Run each file to verify it passes, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/controllers/reportController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/reportController.js'`
Expected: all passed (24 new); `reportController.js` ≥ 80 %.
Run: `cd backend && pnpm exec jest tests/unit/routes/reportRoutes.test.js --maxWorkers=2 --silent`
Expected: 17 passed (16 routes + the pipelineFunnel 404).
Run: `cd backend && pnpm exec jest tests/unit/controllers/leadController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/leadController.js'`
Expected: all passed; `leadController.js` ≥ 80 %.

- [ ] **Step 7: Live contract check of the SP parameter list (read-only)**

Run via `mcp__sqlserver-ecrm__read_query`:
```sql
SELECT o.name, COUNT(*) AS Params FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
WHERE o.name LIKE 'sp_Rpt%' GROUP BY o.name ORDER BY o.name;
```
Expected: 8 rows, each `Params = 12` (only after the owner has applied `075`; if it returns 0 rows, report that the check is pending and continue).

- [ ] **Step 8: Stop and report.**

---

### Task 8: `reportUtils.js` — filters ↔ URL ↔ body, formatting, CSV, drill

**Files:**
- Create: `web/src/pages/Reports/reportUtils.js`
- Create: `web/src/pages/Reports/reportUtils.test.js`

**Interfaces:**
- Consumes: `formatCurrency` from `web/src/utils/format.js`; `dayjs`.
- Produces (Tasks 9–19 import these by name):
  - `PRESETS` `[{value:"7d"|"30d"|"90d"|"month"|"custom", label}]`, `DATE_BASES` `[{value:"created"|"closed"|"activity", label}]`
  - `presetRange(preset, today = dayjs())` → `{ from, to }` (`YYYY-MM-DD`, today inclusive)
  - `readFilters(searchParams, { groupBys, today })` → `{ preset, from, to, basis, groupBy, BranchId, OwnerId, SourceId, ProductId }` (ids are numbers or `null`)
  - `writeFilters(filters)` → plain object for `setSearchParams` (defaults omitted; `groupBy` always present)
  - `toBody(filters)` → `{ FromDate, ToDate, DateBasis, GroupBy, BranchId, OwnerId, SourceId, ProductId }` — exactly what Task 6 parses
  - `formatValue(format, v)` — `int | pct | money | days | hours | date | text`; `null/undefined/""` → `"—"`
  - `toCsv(columns, rows)` — `columns: [{ key, header }]`
  - `leadsUrl(params)` → `/sales/leads?…` (null/empty dropped)
  - `GROUP_PARAM` `{ source: "SourceId", owner: "OwnerId", product: "ProductId", branch: "BranchId", status: "StatusId" }`; `drillParams(filters, row)` → Leads-list params (active id filters + `from`/`to` + the row's group when the list can filter by it)

- [ ] **Step 1: Write the failing tests**

```js
// web/src/pages/Reports/reportUtils.test.js
import { describe, it, expect } from "vitest";
import dayjs from "dayjs";

import {
  PRESETS, DATE_BASES, presetRange, readFilters, writeFilters, toBody,
  formatValue, toCsv, leadsUrl, drillParams, GROUP_PARAM,
} from "./reportUtils";

const TODAY = dayjs("2026-09-10");
const GROUP_BYS = [{ value: "source", label: "Source" }, { value: "owner", label: "Owner" }];
const params = (s) => new URLSearchParams(s);

describe("presetRange", () => {
  it.each([
    ["7d", "2026-09-04"],
    ["30d", "2026-08-12"],
    ["90d", "2026-06-13"],
    ["month", "2026-09-01"],
    ["custom", "2026-08-12"], // custom without dates behaves like 30d
  ])("%s starts on %s and ends today", (preset, from) => {
    expect(presetRange(preset, TODAY)).toEqual({ from, to: "2026-09-10" });
  });

  it("lists the five presets and three bases in order", () => {
    expect(PRESETS.map((p) => p.value)).toEqual(["7d", "30d", "90d", "month", "custom"]);
    expect(DATE_BASES.map((b) => b.value)).toEqual(["created", "closed", "activity"]);
  });
});

describe("readFilters", () => {
  it("defaults to 30d / created / first GroupBy / no ids", () => {
    expect(readFilters(params(""), { groupBys: GROUP_BYS, today: TODAY })).toEqual({
      preset: "30d", from: "2026-08-12", to: "2026-09-10", basis: "created", groupBy: "source",
      BranchId: null, OwnerId: null, SourceId: null, ProductId: null,
    });
  });

  it("reads a preset, basis, GroupBy and numeric ids", () => {
    const f = readFilters(params("preset=7d&basis=closed&groupBy=owner&BranchId=2&OwnerId=17&SourceId=x&ProductId=-1"), { groupBys: GROUP_BYS, today: TODAY });
    expect(f).toMatchObject({ preset: "7d", from: "2026-09-04", basis: "closed", groupBy: "owner", BranchId: 2, OwnerId: 17, SourceId: null, ProductId: null });
  });

  it("custom dates win: explicit from/to imply the custom preset", () => {
    const f = readFilters(params("from=2026-08-01&to=2026-08-31"), { groupBys: GROUP_BYS, today: TODAY });
    expect(f).toMatchObject({ preset: "custom", from: "2026-08-01", to: "2026-08-31" });
  });

  it("custom with a bad date falls back to the 30-day bound on that side", () => {
    const f = readFilters(params("preset=custom&from=01/08/2026&to=2026-08-31"), { groupBys: GROUP_BYS, today: TODAY });
    expect(f).toMatchObject({ preset: "custom", from: "2026-08-12", to: "2026-08-31" });
  });

  it("ignores unknown preset / basis / GroupBy values", () => {
    const f = readFilters(params("preset=year&basis=invoiced&groupBy=team"), { groupBys: GROUP_BYS, today: TODAY });
    expect(f).toMatchObject({ preset: "30d", basis: "created", groupBy: "source" });
  });
});

describe("writeFilters / toBody", () => {
  const base = { preset: "30d", from: "2026-08-12", to: "2026-09-10", basis: "created", groupBy: "source", BranchId: null, OwnerId: null, SourceId: null, ProductId: null };

  it("writes only what differs from the defaults, groupBy always", () => {
    expect(writeFilters(base)).toEqual({ groupBy: "source" });
    expect(writeFilters({ ...base, preset: "7d", basis: "closed", OwnerId: 17 })).toEqual({ groupBy: "source", preset: "7d", basis: "closed", OwnerId: "17" });
    expect(writeFilters({ ...base, preset: "custom", from: "2026-08-01", to: "2026-08-31" })).toEqual({ groupBy: "source", preset: "custom", from: "2026-08-01", to: "2026-08-31" });
  });

  it("round-trips through readFilters", () => {
    const f = { ...base, preset: "custom", from: "2026-08-01", to: "2026-08-31", basis: "activity", groupBy: "owner", BranchId: 2 };
    expect(readFilters(params(new URLSearchParams(writeFilters(f)).toString()), { groupBys: GROUP_BYS, today: TODAY })).toEqual(f);
  });

  it("toBody is the report POST contract", () => {
    expect(toBody({ ...base, OwnerId: 17 })).toEqual({
      FromDate: "2026-08-12", ToDate: "2026-09-10", DateBasis: "created", GroupBy: "source",
      BranchId: null, OwnerId: 17, SourceId: null, ProductId: null,
    });
  });
});

describe("formatValue", () => {
  it.each([
    ["int", 1234, "1,234"],
    ["int", 0, "0"],
    ["pct", 12.345, "12.3%"],
    ["money", 85000, "₹85,000.00"],
    ["days", 2.25, "2.3 d"],
    ["hours", 5, "5.0 h"],
    ["date", "2026-09-07", "07-09-2026"],
    ["date", "not a date", "not a date"],
    ["text", "Price", "Price"],
    [undefined, 7, "7"],
  ])("%s formats %j as %s", (format, v, out) => {
    expect(formatValue(format, v)).toBe(out);
  });

  it("renders an em dash for nothing", () => {
    expect(formatValue("int", null)).toBe("—");
    expect(formatValue("pct", undefined)).toBe("—");
    expect(formatValue("text", "")).toBe("—");
  });
});

describe("toCsv", () => {
  it("writes a header row and escapes commas, quotes and newlines", () => {
    const cols = [{ key: "GroupLabel", header: "Source" }, { key: "Created", header: "Created, total" }];
    const rows = [{ GroupLabel: "Web \"organic\"", Created: 5 }, { GroupLabel: "Walk-in\nstore", Created: null }];
    expect(toCsv(cols, rows)).toBe('Source,"Created, total"\n"Web ""organic""",5\n"Walk-in\nstore",');
  });
});

describe("leadsUrl / drillParams", () => {
  it("builds the Leads list URL without empty values", () => {
    expect(leadsUrl({ SourceId: 11, OwnerId: null, from: "2026-08-01", to: "", BranchId: undefined })).toBe("/sales/leads?SourceId=11&from=2026-08-01");
    expect(leadsUrl({})).toBe("/sales/leads");
  });

  it("maps the row's group onto the matching Leads filter and carries the range + active filters", () => {
    const f = { groupBy: "source", from: "2026-08-01", to: "2026-08-31", BranchId: 2, OwnerId: null, SourceId: null, ProductId: null };
    expect(drillParams(f, { GroupKey: 11, GroupLabel: "Website" })).toEqual({
      BranchId: 2, OwnerId: null, SourceId: 11, ProductId: null, from: "2026-08-01", to: "2026-08-31",
    });
    // Key order is part of the contract: the URL is asserted as a string elsewhere.
    expect(leadsUrl(drillParams(f, { GroupKey: 11 }))).toBe("/sales/leads?from=2026-08-01&to=2026-08-31&BranchId=2&SourceId=11");
  });

  it("adds nothing for a grouping the list cannot filter by, or a null key", () => {
    const f = { groupBy: "team", from: "2026-08-01", to: "2026-08-31", BranchId: null, OwnerId: null, SourceId: null, ProductId: null };
    expect(drillParams(f, { GroupKey: 16 })).toEqual({ BranchId: null, OwnerId: null, SourceId: null, ProductId: null, from: "2026-08-01", to: "2026-08-31" });
    expect(drillParams({ ...f, groupBy: "source" }, { GroupKey: null })).not.toHaveProperty("SourceId", null);
    expect(GROUP_PARAM.status).toBe("StatusId");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/reportUtils.test.js`
Expected: FAIL — `Failed to resolve import "./reportUtils"`.

- [ ] **Step 3: Implement**

```js
// src/pages/Reports/reportUtils.js
//
// Pure helpers behind ReportPage: filter state <-> URL <-> POST body, value
// formatting, CSV, and the drill-down URL. No React, so the arithmetic that
// decides what a report asks for is testable without a DOM.
import dayjs from "dayjs";

import { formatCurrency } from "../../utils/format";

const ISO = "YYYY-MM-DD";

export const PRESETS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

export const DATE_BASES = [
  { value: "created", label: "Created" },
  { value: "closed", label: "Closed" },
  { value: "activity", label: "Activity" },
];

const ID_KEYS = ["BranchId", "OwnerId", "SourceId", "ProductId"];

/** The date range a preset stands for, today inclusive. */
export function presetRange(preset, today = dayjs()) {
  const to = today.format(ISO);
  switch (preset) {
    case "7d": return { from: today.subtract(6, "day").format(ISO), to };
    case "90d": return { from: today.subtract(89, "day").format(ISO), to };
    case "month": return { from: today.startOf("month").format(ISO), to };
    default: return { from: today.subtract(29, "day").format(ISO), to };
  }
}

const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayjs(s).isValid();
const idOf = (v) => (v && /^\d+$/.test(v) ? Number(v) : null);

/** URL search params -> filter state. Anything unknown falls back to a default. */
export function readFilters(params, { groupBys, today = dayjs() }) {
  const get = (k) => params.get(k);
  const hasDates = isIso(get("from")) || isIso(get("to"));
  const preset = PRESETS.some((p) => p.value === get("preset")) ? get("preset") : hasDates ? "custom" : "30d";
  let range;
  if (preset === "custom") {
    const fallback = presetRange("30d", today);
    range = { from: isIso(get("from")) ? get("from") : fallback.from, to: isIso(get("to")) ? get("to") : fallback.to };
  } else {
    range = presetRange(preset, today);
  }
  const basis = DATE_BASES.some((b) => b.value === get("basis")) ? get("basis") : "created";
  const groupBy = groupBys.some((g) => g.value === get("groupBy")) ? get("groupBy") : groupBys[0].value;
  const ids = Object.fromEntries(ID_KEYS.map((k) => [k, idOf(get(k))]));
  return { preset, from: range.from, to: range.to, basis, groupBy, ...ids };
}

/**
 * Filter state -> URL params. Defaults are left out so a fresh page has a
 * clean address; groupBy always stays so a shared link says what it shows.
 */
export function writeFilters(f) {
  const out = { groupBy: f.groupBy };
  if (f.preset !== "30d") out.preset = f.preset;
  if (f.preset === "custom") {
    out.from = f.from;
    out.to = f.to;
  }
  if (f.basis !== "created") out.basis = f.basis;
  for (const k of ID_KEYS) if (f[k]) out[k] = String(f[k]);
  return out;
}

/** Filter state -> the POST body every report endpoint takes (reportKit.parseReportArgs). */
export const toBody = (f) => ({
  FromDate: f.from,
  ToDate: f.to,
  DateBasis: f.basis,
  GroupBy: f.groupBy,
  BranchId: f.BranchId,
  OwnerId: f.OwnerId,
  SourceId: f.SourceId,
  ProductId: f.ProductId,
});

/** One formatter for KPI tiles and table cells. Nothing renders as an em dash. */
export function formatValue(format, v) {
  if (v === null || v === undefined || v === "") return "—";
  switch (format) {
    case "int": return Number(v).toLocaleString("en-IN");
    case "pct": return `${Number(v).toFixed(1)}%`;
    case "money": return formatCurrency(v, { empty: "—" });
    case "days": return `${Number(v).toFixed(1)} d`;
    case "hours": return `${Number(v).toFixed(1)} h`;
    case "date": return dayjs(v).isValid() ? dayjs(v).format("DD-MM-YYYY") : String(v);
    default: return String(v);
  }
}

/** Header row from the column headers; a cell is quoted when it holds a comma, quote or newline. */
export function toCsv(columns, rows) {
  const esc = (s) => {
    const t = s === null || s === undefined ? "" : String(s);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(","));
  return [head, ...body].join("\n");
}

/** The Leads list, pre-filtered. Null / empty values are dropped. */
export function leadsUrl(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `/sales/leads?${s}` : "/sales/leads";
}

/**
 * Which Leads filter a breakdown row's GroupKey maps onto. Groupings the list
 * cannot filter by (team, day, reason, pair) map to nothing: the drill then
 * shows the range with the active filters, which is still the right list.
 */
export const GROUP_PARAM = { source: "SourceId", owner: "OwnerId", product: "ProductId", branch: "BranchId", status: "StatusId" };

/** Default drill: the active filters + the range + the row's group. */
export function drillParams(filters, row) {
  const key = GROUP_PARAM[filters.groupBy];
  const hasKey = key && row?.GroupKey !== null && row?.GroupKey !== undefined;
  // Range first: a JS object keeps a key's first position when a later spread
  // overwrites it, so the URL reads from&to&<filters>&<group> whatever the group is.
  return {
    from: filters.from,
    to: filters.to,
    BranchId: filters.BranchId,
    OwnerId: filters.OwnerId,
    SourceId: filters.SourceId,
    ProductId: filters.ProductId,
    ...(hasKey ? { [key]: row.GroupKey } : {}),
  };
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/reportUtils.test.js --coverage --coverage.include=src/pages/Reports/reportUtils.js`
Expected: 29 passed; `reportUtils.js` ≥ 90 % lines/branches.

- [ ] **Step 5: Stop and report.**

---

### Task 9: `TrendArea` chart + `ReportTable.onRowClick`

**Files:**
- Create: `web/src/components/Charts/TrendArea.jsx`
- Create: `web/src/components/Charts/TrendArea.test.jsx`
- Modify: `web/src/pages/Reports/ReportShell.jsx` (`ReportTable` only)
- Create: `web/src/pages/Reports/ReportShell.test.jsx`

**Interfaces:**
- Produces:
  - `<TrendArea data xKey="Bucket" series=[{ key, label, tone }] height=240 data-testid="trend-area" />` — recharts `AreaChart`, one `Area` per series, colours from `theme.tokens[tone].main` (`primary|accent|success|warning|error|info`, unknown → primary), legend row above the chart with `data-testid="<testId>-legend-<key>"` per series. Resolves ambiguity 4.
  - `ReportTable({ rows, columns, rowKey, testId, onRowClick })` — when `onRowClick` is given, rows get `hover`, a pointer cursor and `data-testid="<testId>-row"`; `ReportPage`, `ReportBarChart` and the two ticket pages are untouched.

- [ ] **Step 1: Write the failing tests**

```jsx
// web/src/components/Charts/TrendArea.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";
import TrendArea from "./TrendArea";

const wrap = (ui, mode = "light") => render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);
const SERIES = [
  { key: "Created", label: "Created", tone: "primary" },
  { key: "Lost", label: "Lost", tone: "error" },
  { key: "Odd", label: "Odd", tone: "nope" }, // unknown tone falls back to primary
];
const DATA = [{ Bucket: "2026-09-01", Created: 4, Lost: 1, Odd: 0 }, { Bucket: "2026-09-08", Created: 6, Lost: 2, Odd: 1 }];

describe("TrendArea", () => {
  it("renders one legend entry per series, in order", () => {
    wrap(<TrendArea data={DATA} series={SERIES} />);
    expect(screen.getByTestId("trend-area-legend-Created")).toHaveTextContent("Created");
    expect(screen.getByTestId("trend-area-legend-Lost")).toHaveTextContent("Lost");
    expect(screen.getByTestId("trend-area-legend-Odd")).toHaveTextContent("Odd");
    expect(screen.getByTestId("trend-area")).toBeInTheDocument();
  });

  it("renders in dark mode and with no data or series", () => {
    wrap(<TrendArea data={[]} series={[]} data-testid="empty-trend" />, "dark");
    expect(screen.getByTestId("empty-trend")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-trend-legend-Created")).toBeNull();
  });
});
```

```jsx
// web/src/pages/Reports/ReportShell.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import renderWithProviders from "../../test/renderWithProviders";
import { ReportPage, ReportBarChart, ReportTable } from "./ReportShell";

const rows = [{ Id: 1, Name: "A", N: 3 }, { Id: 2, Name: "B", N: 5 }];
const columns = [{ header: "Name", cell: (r) => r.Name }, { header: "N", align: "right", cell: (r) => r.N }];

describe("ReportTable", () => {
  it("renders header + rows without row click affordances by default", () => {
    renderWithProviders(<ReportTable rows={rows} columns={columns} rowKey={(r) => r.Id} testId="t" />, { router: false });
    const table = screen.getByTestId("t");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "N"]);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.queryAllByTestId("t-row")).toHaveLength(0);
  });

  it("calls onRowClick with the row and marks rows clickable", async () => {
    const onRowClick = vi.fn();
    renderWithProviders(<ReportTable rows={rows} columns={columns} rowKey={(r) => r.Id} testId="t" onRowClick={onRowClick} />, { router: false });
    const trs = screen.getAllByTestId("t-row");
    expect(trs).toHaveLength(2);
    expect(trs[1].style.cursor).toBe("pointer");
    await userEvent.setup().click(within(trs[1]).getByText("B"));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});

describe("ReportPage (shell) states", () => {
  const base = { title: "T", documentTitle: "T", testId: "p", errorText: "err", emptyText: "empty" };
  it("shows loading, then error, then empty, then children", () => {
    const { rerender } = renderWithProviders(<ReportPage {...base} isLoading><div>child</div></ReportPage>, { router: false });
    expect(screen.getByTestId("p-loading")).toBeInTheDocument();
    rerender(<ReportPage {...base} error={new Error("x")}><div>child</div></ReportPage>);
    expect(screen.getByTestId("p-error")).toHaveTextContent("err");
    rerender(<ReportPage {...base} isEmpty><div>child</div></ReportPage>);
    expect(screen.getByTestId("p-empty")).toHaveTextContent("empty");
    rerender(<ReportPage {...base}><div>child</div></ReportPage>);
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});

describe("ReportBarChart", () => {
  it("renders with and without a legend", () => {
    const { container, rerender } = renderWithProviders(<ReportBarChart data={[{ n: "A", v: 1 }]} xKey="n" bars={[{ key: "v", name: "V" }]} />, { router: false });
    expect(container.firstChild).toBeTruthy();
    rerender(<ReportBarChart data={[]} xKey="n" legend={false} bars={[{ key: "v", name: "V", tone: "success" }]} />);
    expect(container.firstChild).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run each to verify it fails**

Run: `cd web && pnpm exec vitest run src/components/Charts/TrendArea.test.jsx`
Expected: FAIL — cannot resolve `./TrendArea`.
Run: `cd web && pnpm exec vitest run src/pages/Reports/ReportShell.test.jsx`
Expected: FAIL — `t-row` not found / `onRowClick` never called.

- [ ] **Step 3: Implement `TrendArea`**

```jsx
// src/components/Charts/TrendArea.jsx
import { useTheme } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";
import dayjs from "dayjs";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Generic multi-series area chart for the report frame.
 *
 * AreaTrend (dashboard) is wired to the leads/converted keys with a
 * sample-data fallback and its own KPI strip; this one draws whatever
 * `series` names, with theme tones so it follows dark mode.
 *   series: [{ key, label, tone }]  tone ∈ primary|accent|success|warning|error|info
 */
export default function TrendArea({ data = [], xKey = "Bucket", series = [], height = 240, "data-testid": testId = "trend-area" }) {
  const theme = useTheme();
  const p = theme.tokens;
  const tone = (t) => (p[t] ?? p.primary).main;
  const axis = { tick: { fill: p.text.tertiary, fontSize: 11 }, stroke: p.border.default, tickLine: false, axisLine: false };
  const fmtX = (v) => (dayjs(v).isValid() ? dayjs(v).format("DD MMM") : String(v));

  return (
    <Box data-testid={testId}>
      <Box sx={{ display: "flex", gap: 2, mb: 1, flexWrap: "wrap" }}>
        {series.map((s) => (
          <Box key={s.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 999, backgroundColor: tone(s.tone) }} />
            <Typography sx={{ fontSize: "0.7333rem", color: "text.secondary" }} data-testid={`${testId}-legend-${s.key}`}>
              {s.label}
            </Typography>
          </Box>
        ))}
      </Box>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`trend-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone(s.tone)} stopOpacity={0.45} />
                <stop offset="100%" stopColor={tone(s.tone)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={p.border.subtle} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={fmtX} {...axis} />
          <YAxis {...axis} width={40} allowDecimals={false} />
          <Tooltip
            labelFormatter={fmtX}
            contentStyle={{ background: p.surface.card, border: `1px solid ${p.border.default}`, borderRadius: 8, fontSize: 12, color: p.text.primary }}
            cursor={{ stroke: p.border.strong }}
          />
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={tone(s.tone)} strokeWidth={2} fill={`url(#trend-${s.key})`} dot={false} activeDot={{ r: 4 }} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
```

- [ ] **Step 4: Add `onRowClick` to `ReportTable`**

In `web/src/pages/Reports/ReportShell.jsx` replace the `ReportTable` function with:

```jsx
/**
 * The summary table under each chart. `columns` is
 * `{ header, align, cell(row) }`; `rowKey(row)` supplies the React key, which
 * every page took from its own id column. `onRowClick` (spec 4a drill-down)
 * makes rows hoverable + clickable; without it the table is static. Columns
 * may carry a `key` (ReportPage does) — used for React keys so two columns
 * can share a header.
 */
export function ReportTable({ rows, columns, rowKey, testId, onRowClick }) {
  return (
    <TableContainer component={Paper} variant="outlined" data-testid={testId}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.key ?? c.header} align={c.align}>
                {c.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={rowKey(row)}
              hover={Boolean(onRowClick)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: "pointer" } : undefined}
              data-testid={onRowClick && testId ? `${testId}-row` : undefined}
            >
              {columns.map((c) => (
                <TableCell key={c.key ?? c.header} align={c.align}>
                  {c.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
```

(`key={c.key ?? c.header}`: the Lost page has two columns headed "Reason"; the old pages pass no `key` and keep header keys.)

- [ ] **Step 5: Run each to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/components/Charts/TrendArea.test.jsx --coverage --coverage.include=src/components/Charts/TrendArea.jsx`
Expected: 2 passed; ≥ 80 % (only `fmtX`'s date branch is unreachable in jsdom — recharts draws no axis at width 0).
Run: `cd web && pnpm exec vitest run src/pages/Reports/ReportShell.test.jsx --coverage --coverage.include=src/pages/Reports/ReportShell.jsx`
Expected: 4 passed; ≥ 80 %.

- [ ] **Step 6: Stop and report.**

---

### Task 10: `ReportPage` frame, report endpoints, test mocks, help guide

**Files:**
- Create: `web/src/pages/Reports/ReportPage.jsx`
- Create: `web/src/pages/Reports/ReportPage.test.jsx`
- Create: `web/src/test/reportMocks.js`
- Modify: `web/src/api/salesQueries.js` (`reports` block + fetchers)
- Modify: `web/src/api/salesQueries.test.js`
- Modify: `web/src/data/helpGuides.js` (append `reports`)

**Interfaces:**
- Consumes: Task 8 helpers; `TrendArea`, `ReportTable.onRowClick` (Task 9); `StatisticsCard` (`components/StatCard.jsx`, props `{ title, value, color }`); `useApiQuery`, `useLookups`, `useAssignableUsers`; `Combobox`, `Chip`, `Tabs`, `Button`, `Skeleton` from `components/ui`; `DateField` from `components/ui/DateField` (imported directly so tests can mock it); `HelpGuide` + `HELP_GUIDES.reports`.
- Produces:
  - `SALES_ENDPOINTS.reports = { funnel, followUpCompliance, activity, lost, aging, transfers, pipelineValue, leaderboard }` (`/api/reports/<key>`) + fetchers of the same names; the old three keys/fetchers are gone.
  - `<ReportPage reportKey title subtitle endpoint groupBys dateBases kpis columns trend drill />`:
    - `groupBys: [{ value, label }]` (≥ 1; tabs hidden when 1); `dateBases` defaults to `DATE_BASES` (picker hidden when 1)
    - `kpis: [{ key, label, format, tone? }]` (strip hidden when empty)
    - `columns: [{ key, header?, format?, align? }]` — **a column with no `header` takes the active GroupBy's label**
    - `trend: { series: [{ key, label, tone }] } | null`
    - `drill: (row, filters) => url` (default `leadsUrl(drillParams(filters, row))`); `null` disables row clicks
    - Test ids: `report-preset-<value>`, `report-from`, `report-to`, `report-basis`, `report-BranchId|OwnerId|SourceId|ProductId`, `report-groupby-<value>`, `report-kpis`, `report-export`, `<reportKey>-loading|-error|-empty|-table`, `trend-area`.
  - `mockReportEndpoints(path, data, capture = {})` (test helper) registers MSW handlers for `fetchBranches` (HEAD OFFICE 1, SOUTH EXTENSION 2), `fetchAssignableUsers` (Amit Singh 17, Sara Khan 18), `fetchLookups` (Website 11, Referral 12), `fetchProducts` (Gold Chain 22K 1) and `*<path>` (stores the JSON body in `capture.body`, answers `data`); `reportData(over)` → `{ kpis: {}, rows: [], trend: [], range: {}, ...over }`.

- [ ] **Step 1: Endpoints + test helper + help guide**

In `web/src/api/salesQueries.js` replace the `reports` block:

```js
  // Spec 4a report system — one POST shape, { kpis, rows, trend, range } back.
  reports: {
    funnel: "/api/reports/funnel",
    followUpCompliance: "/api/reports/followUpCompliance",
    activity: "/api/reports/activity",
    lost: "/api/reports/lost",
    aging: "/api/reports/aging",
    transfers: "/api/reports/transfers",
    pipelineValue: "/api/reports/pipelineValue",
    leaderboard: "/api/reports/leaderboard",
  },
```

and the three report fetchers at the bottom with:

```js
// Reports (spec 4a)
export const funnel = post(SALES_ENDPOINTS.reports.funnel);
export const followUpCompliance = post(SALES_ENDPOINTS.reports.followUpCompliance);
export const activity = post(SALES_ENDPOINTS.reports.activity);
export const lost = post(SALES_ENDPOINTS.reports.lost);
export const aging = post(SALES_ENDPOINTS.reports.aging);
export const transfers = post(SALES_ENDPOINTS.reports.transfers);
export const pipelineValue = post(SALES_ENDPOINTS.reports.pipelineValue);
export const leaderboard = post(SALES_ENDPOINTS.reports.leaderboard);
```

In `web/src/api/salesQueries.test.js`: replace `expect(SALES_ENDPOINTS.reports.leadsByStatus).toBe("/api/reports/leadsByStatus");` with

```js
    expect(SALES_ENDPOINTS.reports).toEqual({
      funnel: "/api/reports/funnel",
      followUpCompliance: "/api/reports/followUpCompliance",
      activity: "/api/reports/activity",
      lost: "/api/reports/lost",
      aging: "/api/reports/aging",
      transfers: "/api/reports/transfers",
      pipelineValue: "/api/reports/pipelineValue",
      leaderboard: "/api/reports/leaderboard",
    });
```

replace the last three `FETCHERS` entries (`leadsByStatus`, `callsPerUser`, `conversionBySource`) with

```js
  funnel: SALES_ENDPOINTS.reports.funnel,
  followUpCompliance: SALES_ENDPOINTS.reports.followUpCompliance,
  activity: SALES_ENDPOINTS.reports.activity,
  lost: SALES_ENDPOINTS.reports.lost,
  aging: SALES_ENDPOINTS.reports.aging,
  transfers: SALES_ENDPOINTS.reports.transfers,
  pipelineValue: SALES_ENDPOINTS.reports.pipelineValue,
  leaderboard: SALES_ENDPOINTS.reports.leaderboard,
```

and extend the last test:

```js
  it("no longer exports the retired pipeline-era or spec-1 report fetchers", () => {
    expect(salesQueries.moveLeadStage).toBeUndefined();
    expect(salesQueries.saveFollowup).toBeUndefined();
    expect(salesQueries.pipelineFunnel).toBeUndefined();
    expect(salesQueries.leadsByStatus).toBeUndefined();
    expect(salesQueries.callsPerUser).toBeUndefined();
    expect(salesQueries.conversionBySource).toBeUndefined();
  });
```

Run: `cd web && pnpm exec vitest run src/api/salesQueries.test.js` — Expected: all passed.

Create `web/src/test/reportMocks.js`:

```js
// The five MSW handlers every report page needs: four pick-lists the filter
// bar loads on mount + the report endpoint itself. `capture.body` receives the
// last posted body so a test can assert what the page asked for.
import { http, HttpResponse } from "msw";

import { server } from "./mocks/server";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

export const reportData = (over = {}) => ({ kpis: {}, rows: [], trend: [], range: {}, ...over });

export function mockReportEndpoints(path, data, capture = {}) {
  server.use(
    http.post("*/api/users/fetchBranches", () => json({ branches: [{ Id: 1, BranchName: "HEAD OFFICE" }, { Id: 2, BranchName: "SOUTH EXTENSION" }] })),
    http.post("*/api/users/fetchAssignableUsers", () => json({ users: [{ Id: 17, FullName: "Amit Singh" }, { Id: 18, FullName: "Sara Khan" }] })),
    http.post("*/api/config/fetchLookups", () => json({ lookups: [{ Id: 11, Value: "Website" }, { Id: 12, Value: "Referral" }] })),
    http.post("*/api/products/fetchProducts", () => json({ products: [{ Id: 1, Name: "Gold Chain 22K" }], pagination: { currentPage: 1, pageSize: 200, totalRecords: 1, totalPages: 1 } })),
    http.post(`*${path}`, async ({ request }) => {
      capture.body = await request.json();
      return typeof data === "function" ? json(data(capture.body)) : json(data);
    }),
  );
  return capture;
}
```

Append to `HELP_GUIDES` in `web/src/data/helpGuides.js` (after the `followups` entry):

```js
  reports: {
    titleHi: "रिपोर्ट कैसे पढ़ें",
    titleEn: "How to read a report",
    steps: [
      {
        hi: "ऊपर की chips से अवधि चुनें (7 / 30 / 90 दिन, यह महीना, या Custom तारीखें); Branch / Owner / Source / Product फ़िल्टर संख्याओं को और सीमित करते हैं — कभी बढ़ाते नहीं।",
        en: "Pick a period with the chips (7 / 30 / 90 days, this month, or Custom dates); the Branch / Owner / Source / Product filters narrow the numbers — they never widen them.",
      },
      {
        hi: "'Group by' टैब से तालिका को source, owner, product, branch आदि के हिसाब से तोड़ें; ऊपर की टाइलें पूरी अवधि का कुल दिखाती हैं।",
        en: "Use the 'Group by' tabs to break the table down by source, owner, product, branch and so on; the tiles above show the total for the whole period.",
      },
      {
        hi: "किसी पंक्ति पर क्लिक करके उसी अवधि और फ़िल्टर के साथ Leads सूची खोलें — हर संख्या जाँची जा सकती है। 'Export CSV' तालिका डाउनलोड करता है। पेज का URL साझा करने पर वही रिपोर्ट, वही फ़िल्टर खुलते हैं।",
        en: "Click a row to open the Leads list with the same period and filters — every number can be inspected. 'Export CSV' downloads the table. Sharing the page URL opens the same report with the same filters.",
      },
    ],
  },
```

- [ ] **Step 2: Write the failing frame tests**

```jsx
// web/src/pages/Reports/ReportPage.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import dayjs from "dayjs";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import ReportPage from "./ReportPage";
import renderWithProviders from "../../test/renderWithProviders";
import { server } from "../../test/mocks/server";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

const GROUP_BYS = [{ value: "source", label: "Source" }, { value: "owner", label: "Owner" }];
const KPIS = [{ key: "Created", label: "Created", format: "int" }, { key: "QualifiedPct", label: "Qualified %", format: "pct" }];
const COLUMNS = [{ key: "GroupLabel" }, { key: "Created", header: "Created", format: "int", align: "right" }];
const TREND = { series: [{ key: "Created", label: "Created", tone: "primary" }] };
const DATA = reportData({
  kpis: { Created: 1234, QualifiedPct: 12.5 },
  rows: [{ GroupKey: 11, GroupLabel: "Website", Created: 700 }, { GroupKey: 12, GroupLabel: "Referral", Created: 534 }],
  trend: [{ Bucket: "2026-09-01", Created: 40 }, { Bucket: "2026-09-08", Created: 52 }],
});
const today = dayjs().format("YYYY-MM-DD");
const daysAgo = (n) => dayjs().subtract(n, "day").format("YYYY-MM-DD");

const renderPage = (route = "/reports/funnel", over = {}) =>
  renderWithProviders(
    <ReportPage reportKey="funnel" title="Funnel" subtitle="s" endpoint="/api/reports/funnel" groupBys={GROUP_BYS} kpis={KPIS} columns={COLUMNS} trend={TREND} {...over} />,
    { route },
  );

describe("ReportPage", () => {
  beforeEach(() => mockNavigate.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("posts the defaults (last 30 days, created, first GroupBy) and renders KPIs, trend and rows", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage();
    expect(screen.getByTestId("funnel-loading")).toBeInTheDocument();
    const table = await screen.findByTestId("funnel-table");
    expect(cap.body).toEqual({ FromDate: daysAgo(29), ToDate: today, DateBasis: "created", GroupBy: "source", BranchId: null, OwnerId: null, SourceId: null, ProductId: null });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("Created");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("1,234");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("12.5%");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Source", "Created"]);
    expect(within(table).getByText("Website")).toBeInTheDocument();
    expect(screen.getByTestId("trend-area-legend-Created")).toBeInTheDocument();
  });

  it("reads filters from the URL and reposts on a preset / GroupBy change", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage("/reports/funnel?groupBy=owner&basis=closed&BranchId=2");
    const table = await screen.findByTestId("funnel-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner", DateBasis: "closed", BranchId: 2 });
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Owner");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("report-preset-7d"));
    await waitFor(() => expect(cap.body).toMatchObject({ FromDate: daysAgo(6), ToDate: today, GroupBy: "owner" }));
    await user.click(screen.getByTestId("report-groupby-source"));
    await waitFor(() => expect(cap.body).toMatchObject({ GroupBy: "source", DateBasis: "closed" }));
  });

  it("custom preset shows two date fields and posts what is entered", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage();
    await screen.findByTestId("funnel-table");
    await userEvent.setup().click(screen.getByTestId("report-preset-custom"));
    fireEvent.change(screen.getByTestId("report-from"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByTestId("report-to"), { target: { value: "2026-08-31" } });
    await waitFor(() => expect(cap.body).toMatchObject({ FromDate: "2026-08-01", ToDate: "2026-08-31" }));
  });

  it("narrows on an owner from the assignable roster and on a basis", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage();
    await screen.findByTestId("funnel-table");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("report-OwnerId-input"));
    await user.click(await screen.findByRole("option", { name: "Amit Singh" }));
    await waitFor(() => expect(cap.body).toMatchObject({ OwnerId: 17 }));
    await user.click(screen.getByTestId("report-basis-input"));
    await user.click(await screen.findByRole("option", { name: "Activity" }));
    await waitFor(() => expect(cap.body).toMatchObject({ OwnerId: 17, DateBasis: "activity" }));
  });

  it("row click navigates to the Leads list pre-filtered by the row's group and the range", async () => {
    mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage("/reports/funnel?preset=custom&from=2026-08-01&to=2026-08-31");
    const table = await screen.findByTestId("funnel-table");
    await userEvent.setup().click(within(table).getByText("Website"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?from=2026-08-01&to=2026-08-31&SourceId=11");
  });

  it("honours a custom drill and a disabled one", async () => {
    mockReportEndpoints("/api/reports/funnel", DATA);
    const { unmount } = renderPage("/reports/funnel", { drill: (row, f) => `/custom/${row.GroupKey}/${f.groupBy}` });
    let table = await screen.findByTestId("funnel-table");
    await userEvent.setup().click(within(table).getByText("Website"));
    expect(mockNavigate).toHaveBeenCalledWith("/custom/11/source");
    unmount();

    mockNavigate.mockClear();
    renderPage("/reports/funnel", { drill: null });
    table = await screen.findByTestId("funnel-table");
    expect(within(table).queryAllByTestId("funnel-table-row")).toHaveLength(0);
  });

  it("exports the table as a CSV blob", async () => {
    mockReportEndpoints("/api/reports/funnel", DATA);
    const createURL = vi.fn(() => "blob:report");
    const revoke = vi.fn();
    const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createURL;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      renderPage();
      await screen.findByTestId("funnel-table");
      await userEvent.setup().click(screen.getByTestId("report-export"));
      expect(createURL).toHaveBeenCalledTimes(1);
      const blob = createURL.mock.calls[0][0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("text/csv;charset=utf-8");
      expect(blob.size).toBeGreaterThan(20);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith("blob:report");
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it("hides the basis picker, GroupBy tabs and KPI strip when a report has none", async () => {
    mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage("/reports/funnel", { dateBases: [{ value: "created", label: "Created" }], groupBys: [GROUP_BYS[0]], kpis: [], trend: null });
    await screen.findByTestId("funnel-table");
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(screen.queryByTestId("report-groupby")).toBeNull();
    expect(screen.queryByTestId("report-kpis")).toBeNull();
    expect(screen.queryByTestId("trend-area")).toBeNull();
  });

  it("shows the empty state with no rows and disables export", async () => {
    mockReportEndpoints("/api/reports/funnel", reportData());
    renderPage();
    expect(await screen.findByTestId("funnel-empty")).toBeInTheDocument();
    expect(screen.getByTestId("report-export")).toBeDisabled();
  });

  it("shows the error state on a failed request", async () => {
    mockReportEndpoints("/api/reports/funnel", reportData());
    server.use(http.post("*/api/reports/funnel", () => HttpResponse.json({ success: false, message: "boom" }, { status: 500 })));
    renderPage();
    expect(await screen.findByTestId("funnel-error")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/ReportPage.test.jsx`
Expected: FAIL — cannot resolve `./ReportPage`.

- [ ] **Step 4: Implement `ReportPage`**

```jsx
// src/pages/Reports/ReportPage.jsx
import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Typography } from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";

import { Button, Chip, Combobox, Skeleton, Tabs } from "../../components/ui";
import DateField from "../../components/ui/DateField";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import StatisticsCard from "../../components/StatCard";
import TrendArea from "../../components/Charts/TrendArea";
import { ReportTable } from "./ReportShell";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useLookups } from "../../hooks/useLookups";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { PRESETS, DATE_BASES, readFilters, writeFilters, toBody, formatValue, toCsv, leadsUrl, drillParams } from "./reportUtils";

const defaultDrill = (row, filters) => leadsUrl(drillParams(filters, row));

const PICKERS = [
  ["BranchId", "All branches"],
  ["OwnerId", "All owners"],
  ["SourceId", "All sources"],
  ["ProductId", "All products"],
];

/**
 * The one frame every sales report renders through (spec 4a §5):
 * filter bar → KPI strip → trend → breakdown table → drill-down.
 *
 * Filters live in the URL, so a report is a link: paste it and a colleague
 * sees the same numbers. A page file is a config object + this component.
 * A column with no `header` takes the active GroupBy's label.
 */
export default function ReportPage({
  reportKey, title, subtitle, endpoint, groupBys,
  dateBases = DATE_BASES, kpis = [], columns, trend = null, drill = defaultDrill,
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams, { groupBys }), [searchParams, groupBys]);
  const update = (patch) => setSearchParams(writeFilters({ ...filters, ...patch }), { replace: true });

  // Pick-lists. The owner roster is the caller's assignable set, so the filter
  // can never name someone the report would not show anyway.
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });
  const { users } = useAssignableUsers();
  const { lookups: sources } = useLookups("lead_source", { showErrorMessage: false });
  const { data: productData } = useApiQuery({
    queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, showErrorMessage: false,
  });
  const opts = {
    BranchId: (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })),
    OwnerId: users.map((u) => ({ value: u.Id, label: u.FullName })),
    SourceId: sources.map((s) => ({ value: s.Id, label: s.Value })),
    ProductId: (productData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })),
  };
  const optById = (list, v) => list.find((o) => o.value === v) ?? null;

  const body = toBody(filters);
  const { data, isLoading, error } = useApiQuery({ queryKey: ["report", reportKey, body], endpoint, params: body, retry: false, showErrorMessage: false });
  const kpiRow = data?.kpis ?? {};
  const rows = data?.rows ?? [];
  const trendRows = data?.trend ?? [];

  const groupLabel = groupBys.find((g) => g.value === filters.groupBy)?.label ?? "Group";
  const tableColumns = columns.map((c) => ({
    key: c.key,
    header: c.header ?? groupLabel,
    align: c.align,
    cell: (r) => formatValue(c.format, r[c.key]),
  }));

  const exportCsv = () => {
    const blob = new Blob([toCsv(tableColumns, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportKey}-${filters.from}-${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 1.5 }}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Button variant="tonal" size="sm" leftIcon={<Download size={14} />} onClick={exportCsv} disabled={rows.length === 0} data-testid="report-export">
              Export CSV
            </Button>
            <HelpGuide guide={HELP_GUIDES.reports} />
          </Box>
        }
      />
      <Helmet><title>PRD Infotech | {title}</title></Helmet>

      {/* Filter bar */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <Chip key={p.value} label={p.label} size="lg" tone="primary" variant={filters.preset === p.value ? "solid" : "tonal"}
            onClick={() => update({ preset: p.value })} data-testid={`report-preset-${p.value}`} />
        ))}
        {filters.preset === "custom" && (
          <>
            <Box sx={{ width: 160 }}><DateField size="sm" value={filters.from} onChange={(v) => v && update({ from: v })} data-testid="report-from" /></Box>
            <Box sx={{ width: 160 }}><DateField size="sm" value={filters.to} onChange={(v) => v && update({ to: v })} data-testid="report-to" /></Box>
          </>
        )}
        {dateBases.length > 1 && (
          <Box sx={{ width: 150 }}>
            <Combobox size="sm" options={dateBases} value={dateBases.find((b) => b.value === filters.basis) ?? null}
              onChange={(o) => o && update({ basis: o.value })} data-testid="report-basis" />
          </Box>
        )}
        {PICKERS.map(([key, placeholder]) => (
          <Box key={key} sx={{ width: 170 }}>
            <Combobox size="sm" placeholder={placeholder} options={opts[key]} value={optById(opts[key], filters[key])}
              onChange={(o) => update({ [key]: o?.value ?? null })} data-testid={`report-${key}`} />
          </Box>
        ))}
      </Box>
      {groupBys.length > 1 && (
        <Tabs size="sm" value={filters.groupBy} onChange={(v) => update({ groupBy: v })} items={groupBys} data-testid="report-groupby" />
      )}

      {/* KPI strip */}
      {kpis.length > 0 && (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }} data-testid="report-kpis">
          {kpis.map((k) => (
            <StatisticsCard key={k.key} title={k.label} color={k.tone ?? "primary"}
              value={isLoading ? <Skeleton width={60} height={28} /> : formatValue(k.format, kpiRow[k.key])} />
          ))}
        </Box>
      )}

      {/* Trend */}
      {trend && trendRows.length > 0 && <TrendArea data={trendRows} xKey="Bucket" series={trend.series} />}

      {/* Breakdown */}
      {isLoading ? (
        <Box sx={{ py: 2 }} data-testid={`${reportKey}-loading`}><Skeleton width="100%" height={120} /></Box>
      ) : error ? (
        <Typography color="error" data-testid={`${reportKey}-error`}>Failed to load this report.</Typography>
      ) : rows.length === 0 ? (
        <Typography data-testid={`${reportKey}-empty`} sx={{ color: "text.secondary", py: 4, textAlign: "center" }}>Nothing in this range.</Typography>
      ) : (
        <ReportTable
          rows={rows}
          columns={tableColumns}
          testId={`${reportKey}-table`}
          rowKey={(r) => `${r.GroupKey ?? "x"}-${r.SubKey ?? ""}-${r.GroupLabel}`}
          onRowClick={drill ? (row) => navigate(drill(row, filters)) : undefined}
        />
      )}
    </Box>
  );
}
```

- [ ] **Step 5: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/ReportPage.test.jsx --coverage --coverage.include=src/pages/Reports/ReportPage.jsx`
Expected: 10 passed; `ReportPage.jsx` ≥ 80 % lines and branches.

- [ ] **Step 6: Stop and report.**

---

### Task 11: Leads list reads the drill-down URL

**Files:**
- Modify: `web/src/pages/Sales/leadStatus.js` (append `leadsParamsToState`)
- Modify: `web/src/pages/Sales/leadStatus.test.js` (append)
- Modify: `web/src/pages/Sales/Leads.jsx`
- Modify: `web/src/pages/Sales/Leads.test.jsx`

**Interfaces:**
- Consumes: `POST /api/leads/fetchLeads` with `FromDate`/`ToDate` (Task 7).
- Produces: `leadsParamsToState(searchParams)` → `{ preset, filters: { StatusId, ProductId, OwnerId, SourceId, BranchId } ("" when absent), range: { from, to } ("" when absent) }`. On mount `Leads.jsx` seeds preset/filters/range from the URL, sends `FromDate`/`ToDate` only when set, and shows a removable "Created dd-mm-yyyy – dd-mm-yyyy" chip (`data-testid="leads-range-chip"`).

- [ ] **Step 1: Write the failing tests**

Append to `web/src/pages/Sales/leadStatus.test.js` (add `leadsParamsToState` to the import):

```js
describe("leadsParamsToState", () => {
  const p = (s) => new URLSearchParams(s);

  it("seeds ids and the date range from a report drill-down URL", () => {
    expect(leadsParamsToState(p("StatusId=32&OwnerId=17&SourceId=11&ProductId=2&BranchId=1&from=2026-08-01&to=2026-08-31"))).toEqual({
      preset: "all",
      filters: { StatusId: 32, ProductId: 2, OwnerId: 17, SourceId: 11, BranchId: 1 },
      range: { from: "2026-08-01", to: "2026-08-31" },
    });
  });

  it("maps Overdue / Unassigned / StatusCode=lost onto the presets", () => {
    expect(leadsParamsToState(p("Overdue=1")).preset).toBe("overdue");
    expect(leadsParamsToState(p("Unassigned=true")).preset).toBe("unassigned");
    expect(leadsParamsToState(p("StatusCode=lost")).preset).toBe("lost");
    expect(leadsParamsToState(p("")).preset).toBe("all");
  });

  it("drops anything that is not a positive integer or an ISO day", () => {
    expect(leadsParamsToState(p("StatusId=abc&OwnerId=-3&from=01/08/2026&to=2026-08-31"))).toEqual({
      preset: "all",
      filters: { StatusId: "", ProductId: "", OwnerId: "", SourceId: "", BranchId: "" },
      range: { from: "", to: "2026-08-31" },
    });
  });
});
```

In `web/src/pages/Sales/Leads.test.jsx` change `renderPage` to accept a route:

```jsx
const renderPage = (route) => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={route ? [route] : undefined}><Leads /></MemoryRouter></QueryClientProvider></ThemeProvider>,
);
```

and append inside `describe("Leads page (spec 1)")`:

```jsx
  // Spec 4a: a report number drills into this list with the range it counted.
  it("seeds filters and the date range from the URL, and the range chip clears it", async () => {
    renderPage("/sales/leads?StatusId=15&OwnerId=2&from=2026-08-01&to=2026-08-31");
    expect(lastExtraParams()).toEqual({
      StatusId: 15, ProductId: null, OwnerId: 2, SourceId: null, BranchId: null,
      FromDate: "2026-08-01", ToDate: "2026-08-31",
    });
    const chip = screen.getByTestId("leads-range-chip");
    expect(chip).toHaveTextContent("01-08-2026 – 31-08-2026");
    await userEvent.setup().click(screen.getByTestId("leads-range-chip-remove"));
    expect(lastExtraParams()).not.toHaveProperty("FromDate");
    expect(screen.queryByTestId("leads-range-chip")).toBeNull();
  });

  it("Overdue=1 lands on the Overdue preset", () => {
    renderPage("/sales/leads?Overdue=1");
    expect(lastExtraParams()).toMatchObject({ Overdue: true });
    expect(screen.getByRole("tab", { name: "Overdue" })).toHaveAttribute("aria-selected", "true");
  });
```

- [ ] **Step 2: Run each to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Sales/leadStatus.test.js`
Expected: FAIL — `leadsParamsToState is not a function`.
Run: `cd web && pnpm exec vitest run src/pages/Sales/Leads.test.jsx`
Expected: FAIL — extraParams has no `FromDate`; `leads-range-chip` not found.

- [ ] **Step 3: Implement**

Append to `web/src/pages/Sales/leadStatus.js`:

```js
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const idParam = (v) => (v && /^\d+$/.test(v) ? Number(v) : "");
const isOn = (v) => v === "1" || v === "true";

/**
 * Leads-list state from URL search params — the report drill-down contract
 * (spec 4a §5): StatusCode / StatusId / SourceId / ProductId / OwnerId /
 * BranchId / Overdue / Unassigned / from / to. Presets win the way the tabs
 * do; "" is the filters' own empty value, so the Comboboxes stay controlled.
 */
export function leadsParamsToState(params) {
  const get = (k) => params.get(k) ?? "";
  const preset = isOn(get("Overdue")) ? "overdue"
    : isOn(get("Unassigned")) ? "unassigned"
    : get("StatusCode") === "lost" ? "lost"
    : "all";
  return {
    preset,
    filters: {
      StatusId: idParam(get("StatusId")), ProductId: idParam(get("ProductId")), OwnerId: idParam(get("OwnerId")),
      SourceId: idParam(get("SourceId")), BranchId: idParam(get("BranchId")),
    },
    range: { from: ISO_DAY.test(get("from")) ? get("from") : "", to: ISO_DAY.test(get("to")) ? get("to") : "" },
  };
}
```

In `web/src/pages/Sales/Leads.jsx`:

```jsx
import { useNavigate, useSearchParams } from "react-router-dom";
```
```jsx
import { LEAD_PRESETS, presetParams, isActiveCode, leadsParamsToState } from "./leadStatus";
```

Replace the `preset` / `filters` state lines with:

```jsx
  // A report drill-down lands here with its filters in the URL (spec 4a).
  // Read once on mount; from then on the page owns its state.
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => leadsParamsToState(searchParams));
  const [preset, setPreset] = useState(initial.preset);
  const [filters, setFilters] = useState(initial.filters);
  const [range, setRange] = useState(initial.range);
```

Replace `extraParams`:

```jsx
  const extraParams = useMemo(() => ({
    StatusId: num(filters.StatusId), ProductId: num(filters.ProductId), OwnerId: num(filters.OwnerId),
    SourceId: num(filters.SourceId), BranchId: num(filters.BranchId),
    ...(range.from ? { FromDate: range.from } : {}),
    ...(range.to ? { ToDate: range.to } : {}),
    ...presetParams(preset, userId),
  }), [filters, range, preset, userId]);
```

After the filter `<Box>` (the five Comboboxes) add:

```jsx
      {(range.from || range.to) && (
        <Box sx={{ mb: 0.5 }}>
          <Chip tone="info" label={`Created ${formatDate(range.from, { empty: "…" })} – ${formatDate(range.to, { empty: "…" })}`}
            onDelete={() => setRange({ from: "", to: "" })} data-testid="leads-range-chip" />
        </Box>
      )}
```

`EMPTY_FILTERS` is no longer referenced — delete the constant.

- [ ] **Step 4: Run each to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Sales/leadStatus.test.js --coverage --coverage.include=src/pages/Sales/leadStatus.js`
Expected: 5 passed; ≥ 90 %.
Run: `cd web && pnpm exec vitest run src/pages/Sales/Leads.test.jsx --coverage --coverage.include=src/pages/Sales/Leads.jsx`
Expected: 12 passed; `Leads.jsx` ≥ 80 %.

- [ ] **Step 5: Stop and report.**

---

### Task 12: Report page — Funnel

**Files:**
- Create: `web/src/pages/Reports/Funnel.jsx`
- Create: `web/src/pages/Reports/Funnel.test.jsx`

**Interfaces:**
- Consumes: `ReportPage` (Task 10), `SALES_ENDPOINTS.reports.funnel`, `sp_RptFunnel` columns (Task 2).
- Produces: default export `Funnel`, route `/reports/funnel` (Task 20). `?groupBy=source` is the Conversion-by-Source redirect target.

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/pages/Reports/Funnel.test.jsx
import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";

import Funnel from "./Funnel";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Funnel report", () => {
  it("posts to /api/reports/funnel grouped by source and renders its KPIs and columns", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", reportData({
      kpis: { Created: 42, Contacted: 30, Qualified: 10, Lost: 8, Junk: 2, QualifiedPct: 23.8, LostPct: 19, AvgDaysToContact: 1.2, AvgDaysToQualify: 11.5 },
      rows: [{ GroupKey: 11, GroupLabel: "Website", Created: 42, Contacted: 30, Qualified: 10, Lost: 8, Junk: 2, QualifiedPct: 23.8, LostPct: 19, AvgDaysToQualify: 11.5 }],
      trend: [{ Bucket: "2026-09-01", Created: 4, Qualified: 1, Lost: 0 }],
    }));
    renderWithProviders(<Funnel />, { route: "/reports/funnel" });
    const table = await screen.findByTestId("funnel-table");
    expect(cap.body).toMatchObject({ GroupBy: "source", DateBasis: "created" });
    const kpis = screen.getByTestId("report-kpis");
    for (const label of ["Created", "Contacted", "Qualified", "Lost", "Junk", "Qualified %", "Lost %", "Days to contact", "Days to qualify"]) expect(kpis).toHaveTextContent(label);
    expect(kpis).toHaveTextContent("11.5 d");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Source", "Created", "Contacted", "Qualified", "Lost", "Junk", "Qualified %", "Lost %", "Days to qualify"],
    );
    expect(within(table).getByText("23.8%")).toBeInTheDocument();
    expect(screen.getByTestId("trend-area-legend-Lost")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Funnel.test.jsx`
Expected: FAIL — cannot resolve `./Funnel`.

- [ ] **Step 3: Implement**

```jsx
// src/pages/Reports/Funnel.jsx
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const GROUP_BYS = [
  { value: "source", label: "Source" }, { value: "owner", label: "Owner" }, { value: "product", label: "Product" },
  { value: "branch", label: "Branch" }, { value: "status", label: "Status" }, { value: "team", label: "Team" },
];
const KPIS = [
  { key: "Created", label: "Created", format: "int" },
  { key: "Contacted", label: "Contacted", format: "int" },
  { key: "Qualified", label: "Qualified", format: "int", tone: "success" },
  { key: "Lost", label: "Lost", format: "int", tone: "error" },
  { key: "Junk", label: "Junk", format: "int" },
  { key: "QualifiedPct", label: "Qualified %", format: "pct", tone: "success" },
  { key: "LostPct", label: "Lost %", format: "pct", tone: "error" },
  { key: "AvgDaysToContact", label: "Days to contact", format: "days", tone: "info" },
  { key: "AvgDaysToQualify", label: "Days to qualify", format: "days", tone: "info" },
];
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Created", header: "Created", format: "int", align: "right" },
  { key: "Contacted", header: "Contacted", format: "int", align: "right" },
  { key: "Qualified", header: "Qualified", format: "int", align: "right" },
  { key: "Lost", header: "Lost", format: "int", align: "right" },
  { key: "Junk", header: "Junk", format: "int", align: "right" },
  { key: "QualifiedPct", header: "Qualified %", format: "pct", align: "right" },
  { key: "LostPct", header: "Lost %", format: "pct", align: "right" },
  { key: "AvgDaysToQualify", header: "Days to qualify", format: "days", align: "right" },
];
const TREND = { series: [
  { key: "Created", label: "Created", tone: "primary" },
  { key: "Qualified", label: "Qualified", tone: "success" },
  { key: "Lost", label: "Lost", tone: "error" },
] };

export default function Funnel() {
  return (
    <ReportPage
      reportKey="funnel"
      title="Funnel"
      subtitle="Created → contacted → qualified, and how long each step takes. Click a row to see those leads."
      endpoint={SALES_ENDPOINTS.reports.funnel}
      groupBys={GROUP_BYS}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Funnel.test.jsx --coverage --coverage.include=src/pages/Reports/Funnel.jsx`
Expected: 1 passed; 100 %.

- [ ] **Step 5: Stop and report.**

---

### Task 13: Report page — Follow-up Compliance

**Files:**
- Create: `web/src/pages/Reports/FollowUpCompliance.jsx`
- Create: `web/src/pages/Reports/FollowUpCompliance.test.jsx`

**Interfaces:**
- Consumes: `ReportPage`; `sp_RptFollowUpCompliance` columns (Task 3); `leadsUrl`, `GROUP_PARAM` (Task 8).
- Produces: default export `FollowUpCompliance`, route `/reports/follow-up-compliance`. Date bases offered: `created` labelled "Due date", `activity` labelled "Done date". Drill: the group's **overdue** leads (`Overdue=1` + `OwnerId`/`BranchId` when the grouping maps).

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/pages/Reports/FollowUpCompliance.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import FollowUpCompliance from "./FollowUpCompliance";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("FollowUpCompliance report", () => {
  it("posts grouped by owner, offers Due/Done date bases, renders KPIs, and drills into the rep's overdue leads", async () => {
    const cap = mockReportEndpoints("/api/reports/followUpCompliance", reportData({
      kpis: { Due: 120, DoneOnTime: 80, DoneLate: 20, Skipped: 5, Missed: 15, OnTimePct: 66.7, AvgDelayHours: 30.5 },
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Due: 60, DoneOnTime: 45, DoneLate: 8, Skipped: 2, Missed: 5, OnTimePct: 75, AvgDelayHours: 26 }],
    }));
    renderWithProviders(<FollowUpCompliance />, { route: "/reports/follow-up-compliance" });
    const table = await screen.findByTestId("followUpCompliance-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner", DateBasis: "created" });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("66.7%");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("30.5 h");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Owner", "Due", "On time", "Late", "Skipped", "Missed", "On-time %", "Avg delay"],
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("report-basis-input"));
    expect(await screen.findByRole("option", { name: "Done date" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(table).getByText("Amit Singh"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?OwnerId=17&Overdue=1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/FollowUpCompliance.test.jsx`
Expected: FAIL — cannot resolve `./FollowUpCompliance`.

- [ ] **Step 3: Implement**

```jsx
// src/pages/Reports/FollowUpCompliance.jsx
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { GROUP_PARAM, leadsUrl } from "./reportUtils";

const GROUP_BYS = [{ value: "owner", label: "Owner" }, { value: "team", label: "Team" }, { value: "branch", label: "Branch" }];
// The SP dates a follow-up on DueAt for 'created' and on DoneAt for 'activity'.
const DATE_BASES = [{ value: "created", label: "Due date" }, { value: "activity", label: "Done date" }];
const KPIS = [
  { key: "Due", label: "Due", format: "int" },
  { key: "DoneOnTime", label: "On time", format: "int", tone: "success" },
  { key: "DoneLate", label: "Late", format: "int", tone: "warning" },
  { key: "Skipped", label: "Skipped", format: "int" },
  { key: "Missed", label: "Missed", format: "int", tone: "error" },
  { key: "OnTimePct", label: "On-time %", format: "pct", tone: "success" },
  { key: "AvgDelayHours", label: "Avg delay", format: "hours", tone: "warning" },
];
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Due", header: "Due", format: "int", align: "right" },
  { key: "DoneOnTime", header: "On time", format: "int", align: "right" },
  { key: "DoneLate", header: "Late", format: "int", align: "right" },
  { key: "Skipped", header: "Skipped", format: "int", align: "right" },
  { key: "Missed", header: "Missed", format: "int", align: "right" },
  { key: "OnTimePct", header: "On-time %", format: "pct", align: "right" },
  { key: "AvgDelayHours", header: "Avg delay", format: "hours", align: "right" },
];
const TREND = { series: [
  { key: "Due", label: "Due", tone: "primary" },
  { key: "DoneOnTime", label: "On time", tone: "success" },
  { key: "DoneLate", label: "Late", tone: "warning" },
  { key: "Missed", label: "Missed", tone: "error" },
] };

// Missed is the actionable number: drill lands on that group's overdue leads.
const drill = (row, f) => {
  const key = GROUP_PARAM[f.groupBy];
  return leadsUrl({ ...(key ? { [key]: row.GroupKey } : {}), Overdue: 1 });
};

export default function FollowUpCompliance() {
  return (
    <ReportPage
      reportKey="followUpCompliance"
      title="Follow-up Compliance"
      subtitle="Were follow-ups done when they were due? Late, skipped and missed, per rep. Click a row for their overdue leads."
      endpoint={SALES_ENDPOINTS.reports.followUpCompliance}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/FollowUpCompliance.test.jsx --coverage --coverage.include=src/pages/Reports/FollowUpCompliance.jsx`
Expected: 1 passed; ≥ 80 % (the `key ? … : {}` branch: owner grouping covers the truthy side; the falsy side is `team`, exercised by the same `drill` when a test passes `groupBy=team` — add a second `it` with route `?groupBy=team` asserting `navigate("/sales/leads?Overdue=1")` if branch coverage lands under 80 %).

- [ ] **Step 5: Stop and report.**

---

### Task 14: Report page — Activity

**Files:**
- Create: `web/src/pages/Reports/Activity.jsx`
- Create: `web/src/pages/Reports/Activity.test.jsx`

**Interfaces:**
- Consumes: `ReportPage`; `sp_RptActivity` columns (Task 3).
- Produces: default export `Activity`, route `/reports/activity` (the Calls-per-User redirect target). One date basis (hidden picker). Drill: `OwnerId`/`BranchId` only (no dates — activity dates are not lead-created dates); `day`/`team` rows drill to the plain list.

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/pages/Reports/Activity.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Activity from "./Activity";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

const DATA = reportData({
  kpis: { Calls: 300, Visits: 40, Meetings: 12, Other: 3, TalkMinutes: 2450, Inbound: 60, Outbound: 240, Connected: 180 },
  rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Calls: 120, Visits: 10, Meetings: 4, Other: 1, TalkMinutes: 900, Inbound: 20, Outbound: 100, Connected: 70 }],
});

describe("Activity report", () => {
  it("posts grouped by owner with no basis picker, renders KPIs, and drills into the rep's leads without dates", async () => {
    const cap = mockReportEndpoints("/api/reports/activity", DATA);
    renderWithProviders(<Activity />, { route: "/reports/activity" });
    const table = await screen.findByTestId("activity-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner" });
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("2,450");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Owner", "Calls", "Visits", "Meetings", "Other", "Talk min", "Inbound", "Outbound", "Connected"],
    );
    await userEvent.setup().click(within(table).getByText("Amit Singh"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?OwnerId=17");
  });

  it("grouped by day, a row drills to the plain list", async () => {
    mockReportEndpoints("/api/reports/activity", reportData({ rows: [{ GroupKey: 46270, GroupLabel: "2026-09-08", Calls: 9 }] }));
    renderWithProviders(<Activity />, { route: "/reports/activity?groupBy=day" });
    const table = await screen.findByTestId("activity-table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Day");
    await userEvent.setup().click(within(table).getByText("2026-09-08"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Activity.test.jsx`
Expected: FAIL — cannot resolve `./Activity`.

- [ ] **Step 3: Implement**

```jsx
// src/pages/Reports/Activity.jsx
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { GROUP_PARAM, leadsUrl } from "./reportUtils";

const GROUP_BYS = [{ value: "owner", label: "Owner" }, { value: "day", label: "Day" }, { value: "team", label: "Team" }, { value: "branch", label: "Branch" }];
// An activity has one date — when it was done. No basis to choose.
const DATE_BASES = [{ value: "activity", label: "Done date" }];
const KPIS = [
  { key: "Calls", label: "Calls", format: "int" },
  { key: "Visits", label: "Visits", format: "int", tone: "accent" },
  { key: "Meetings", label: "Meetings", format: "int", tone: "info" },
  { key: "Other", label: "Other", format: "int" },
  { key: "TalkMinutes", label: "Talk minutes", format: "int" },
  { key: "Inbound", label: "Inbound", format: "int" },
  { key: "Outbound", label: "Outbound", format: "int" },
  { key: "Connected", label: "Connected", format: "int", tone: "success" },
];
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Calls", header: "Calls", format: "int", align: "right" },
  { key: "Visits", header: "Visits", format: "int", align: "right" },
  { key: "Meetings", header: "Meetings", format: "int", align: "right" },
  { key: "Other", header: "Other", format: "int", align: "right" },
  { key: "TalkMinutes", header: "Talk min", format: "int", align: "right" },
  { key: "Inbound", header: "Inbound", format: "int", align: "right" },
  { key: "Outbound", header: "Outbound", format: "int", align: "right" },
  { key: "Connected", header: "Connected", format: "int", align: "right" },
];
const TREND = { series: [
  { key: "Calls", label: "Calls", tone: "primary" },
  { key: "Visits", label: "Visits", tone: "accent" },
  { key: "Meetings", label: "Meetings", tone: "info" },
] };

// Activity dates are not lead-created dates, so the drill carries no range.
const drill = (row, f) => {
  const key = GROUP_PARAM[f.groupBy];
  return leadsUrl(key ? { [key]: row.GroupKey } : {});
};

export default function Activity() {
  return (
    <ReportPage
      reportKey="activity"
      title="Activity"
      subtitle="Calls, visits and meetings logged — per rep or per day. Click a row for that rep's leads."
      endpoint={SALES_ENDPOINTS.reports.activity}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Activity.test.jsx --coverage --coverage.include=src/pages/Reports/Activity.jsx`
Expected: 2 passed; 100 %.

- [ ] **Step 5: Stop and report.**

---

### Task 15: Report page — Lost Analysis

**Files:**
- Create: `web/src/pages/Reports/Lost.jsx`
- Create: `web/src/pages/Reports/Lost.test.jsx`

**Interfaces:**
- Consumes: `ReportPage`; `sp_RptLost` columns (Task 2: `GroupKey/GroupLabel` = reason, `SubKey/SubLabel` = the second grouping).
- Produces: default export `Lost`, route `/reports/lost`. First column is always "Reason"; the second column (`SubLabel`) takes the active grouping's label and reads "—" when grouped by reason. Drill: `StatusCode=lost` + range + the sub-group's id.

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/pages/Reports/Lost.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Lost from "./Lost";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Lost report", () => {
  it("posts grouped by reason and renders the reason table + top-reason KPI", async () => {
    const cap = mockReportEndpoints("/api/reports/lost", reportData({
      kpis: { Lost: 40, LostPct: 18.2, TopReason: "Price" },
      rows: [{ GroupKey: 22, GroupLabel: "Price", SubKey: null, SubLabel: null, Lost: 14, LostPct: 35 }],
    }));
    renderWithProviders(<Lost />, { route: "/reports/lost?preset=custom&from=2026-08-01&to=2026-08-31" });
    const table = await screen.findByTestId("lost-table");
    expect(cap.body).toMatchObject({ GroupBy: "reason", FromDate: "2026-08-01" });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("Price");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Reason", "Reason", "Lost", "Share %"]);
    expect(within(table).getByText("—")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("35.0%"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?StatusCode=lost&from=2026-08-01&to=2026-08-31");
  });

  it("grouped by source, the second column is the source and the drill carries its id", async () => {
    mockReportEndpoints("/api/reports/lost", reportData({
      rows: [{ GroupKey: 22, GroupLabel: "Price", SubKey: 11, SubLabel: "Website", Lost: 6, LostPct: 15 }],
    }));
    renderWithProviders(<Lost />, { route: "/reports/lost?groupBy=source&preset=custom&from=2026-08-01&to=2026-08-31" });
    const table = await screen.findByTestId("lost-table");
    expect(within(table).getAllByRole("columnheader")[1]).toHaveTextContent("Source");
    await userEvent.setup().click(within(table).getByText("Website"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?StatusCode=lost&from=2026-08-01&to=2026-08-31&SourceId=11");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Lost.test.jsx`
Expected: FAIL — cannot resolve `./Lost`.

- [ ] **Step 3: Implement**

```jsx
// src/pages/Reports/Lost.jsx
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { GROUP_PARAM, leadsUrl } from "./reportUtils";

const GROUP_BYS = [
  { value: "reason", label: "Reason" }, { value: "source", label: "Source" }, { value: "product", label: "Product" },
  { value: "owner", label: "Owner" }, { value: "branch", label: "Branch" },
];
const KPIS = [
  { key: "Lost", label: "Lost", format: "int", tone: "error" },
  { key: "LostPct", label: "Lost %", format: "pct", tone: "error" },
  { key: "TopReason", label: "Top reason", format: "text", tone: "warning" },
];
// GroupLabel is always the reason (the SP's first key); SubLabel is the
// second key and takes the active grouping's label.
const COLUMNS = [
  { key: "GroupLabel", header: "Reason" },
  { key: "SubLabel" },
  { key: "Lost", header: "Lost", format: "int", align: "right" },
  { key: "LostPct", header: "Share %", format: "pct", align: "right" },
];
const TREND = { series: [{ key: "Lost", label: "Lost", tone: "error" }] };

const drill = (row, f) => {
  const key = GROUP_PARAM[f.groupBy];
  return leadsUrl({
    StatusCode: "lost", from: f.from, to: f.to,
    ...(key && row.SubKey !== null && row.SubKey !== undefined ? { [key]: row.SubKey } : {}),
  });
};

export default function Lost() {
  return (
    <ReportPage
      reportKey="lost"
      title="Lost Analysis"
      subtitle="Why leads are lost, and where. Group by source, product, owner or branch to see which reason hits which. Click a row for the leads."
      endpoint={SALES_ENDPOINTS.reports.lost}
      groupBys={GROUP_BYS}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Lost.test.jsx --coverage --coverage.include=src/pages/Reports/Lost.jsx`
Expected: 2 passed; 100 %.

- [ ] **Step 5: Stop and report.**

---

### Task 16: Report page — Aging

**Files:**
- Create: `web/src/pages/Reports/Aging.jsx`
- Create: `web/src/pages/Reports/Aging.test.jsx`

**Interfaces:**
- Consumes: `ReportPage`; `sp_RptAging` columns (Task 4; RS1/RS2 are a snapshot, the range drives the trend).
- Produces: default export `Aging`, route `/reports/aging`. One date basis (picker hidden). Drill: the group's leads (`OwnerId`/`BranchId`), no range — the snapshot is not a cohort.

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/pages/Reports/Aging.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Aging from "./Aging";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Aging report", () => {
  it("posts grouped by owner, renders the age buckets, and drills into the rep's leads without a range", async () => {
    const cap = mockReportEndpoints("/api/reports/aging", reportData({
      kpis: { Open: 210, Age0_7: 60, Age8_30: 90, Age31_90: 45, Age90Plus: 15, NoNextFollowUp: 22, AvgDaysSinceTouch: 6.4 },
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Open: 70, Age0_7: 20, Age8_30: 30, Age31_90: 15, Age90Plus: 5, NoNextFollowUp: 7, AvgDaysSinceTouch: 5.1 }],
      trend: [{ Bucket: "2026-09-01", Open: 200 }],
    }));
    renderWithProviders(<Aging />, { route: "/reports/aging?preset=90d" });
    const table = await screen.findByTestId("aging-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner" });
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("6.4 d");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Owner", "Open", "0–7 d", "8–30 d", "31–90 d", "90+ d", "No next follow-up", "Days since touch"],
    );
    expect(screen.getByTestId("trend-area-legend-Open")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("Amit Singh"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?OwnerId=17");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Aging.test.jsx`
Expected: FAIL — cannot resolve `./Aging`.

- [ ] **Step 3: Implement**

```jsx
// src/pages/Reports/Aging.jsx
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { GROUP_PARAM, leadsUrl } from "./reportUtils";

const GROUP_BYS = [{ value: "owner", label: "Owner" }, { value: "branch", label: "Branch" }, { value: "team", label: "Team" }];
// The tiles and table are a snapshot of what is open now; the range only
// drives the "open as of" trend, so there is no basis to choose.
const DATE_BASES = [{ value: "created", label: "Created" }];
const KPIS = [
  { key: "Open", label: "Open", format: "int" },
  { key: "Age0_7", label: "0–7 days", format: "int", tone: "success" },
  { key: "Age8_30", label: "8–30 days", format: "int", tone: "info" },
  { key: "Age31_90", label: "31–90 days", format: "int", tone: "warning" },
  { key: "Age90Plus", label: "90+ days", format: "int", tone: "error" },
  { key: "NoNextFollowUp", label: "Nothing scheduled", format: "int", tone: "error" },
  { key: "AvgDaysSinceTouch", label: "Days since touch", format: "days", tone: "warning" },
];
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Open", header: "Open", format: "int", align: "right" },
  { key: "Age0_7", header: "0–7 d", format: "int", align: "right" },
  { key: "Age8_30", header: "8–30 d", format: "int", align: "right" },
  { key: "Age31_90", header: "31–90 d", format: "int", align: "right" },
  { key: "Age90Plus", header: "90+ d", format: "int", align: "right" },
  { key: "NoNextFollowUp", header: "No next follow-up", format: "int", align: "right" },
  { key: "AvgDaysSinceTouch", header: "Days since touch", format: "days", align: "right" },
];
const TREND = { series: [{ key: "Open", label: "Open", tone: "primary" }] };

// A snapshot is not a cohort: the drill shows the group's leads, no range.
const drill = (row, f) => {
  const key = GROUP_PARAM[f.groupBy];
  return leadsUrl(key ? { [key]: row.GroupKey } : {});
};

export default function Aging() {
  return (
    <ReportPage
      reportKey="aging"
      title="Aging"
      subtitle="What is open right now, how old it is, and what has nothing scheduled. The chart replays the open count over the chosen range."
      endpoint={SALES_ENDPOINTS.reports.aging}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Aging.test.jsx --coverage --coverage.include=src/pages/Reports/Aging.jsx`
Expected: 1 passed; ≥ 80 % (add a `?groupBy=team` click asserting `navigate("/sales/leads")` if the falsy branch drops it under).

- [ ] **Step 5: Stop and report.**

---

### Task 17: Report page — Transfers

**Files:**
- Create: `web/src/pages/Reports/Transfers.jsx`
- Create: `web/src/pages/Reports/Transfers.test.jsx`

**Interfaces:**
- Consumes: `ReportPage`; `sp_RptTransfers` columns (Task 4; `pair` rows carry `SubKey` = the receiving user).
- Produces: default export `Transfers`, route `/reports/transfers`. One date basis (hidden). Drill: `pair` → `OwnerId=SubKey`; `branch` → `BranchId=GroupKey`; `reason` → the plain list. Never a range (assignment dates are not lead-created dates).

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/pages/Reports/Transfers.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Transfers from "./Transfers";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Transfers report", () => {
  it("posts grouped by reason, renders the KPIs, and a reason row drills to the plain list", async () => {
    const cap = mockReportEndpoints("/api/reports/transfers", reportData({
      kpis: { Transfers: 72, CrossBranch: 18, SendBacks: 9, Unassigns: 4 },
      rows: [{ GroupKey: 36, GroupLabel: "Absent", SubKey: null, SubLabel: null, Transfers: 30, CrossBranch: 0, SendBacks: 0, Unassigns: 0 }],
    }));
    renderWithProviders(<Transfers />, { route: "/reports/transfers" });
    const table = await screen.findByTestId("transfers-table");
    expect(cap.body).toMatchObject({ GroupBy: "reason" });
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Reason", "Transfers", "Cross-branch", "Send-backs", "Unassigns"],
    );
    await userEvent.setup().click(within(table).getByText("Absent"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads");
  });

  it("grouped by pair, a row drills into the receiving rep's leads; by branch, into the branch", async () => {
    mockReportEndpoints("/api/reports/transfers", reportData({
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh → Sara Khan", SubKey: 18, SubLabel: "Sara Khan", Transfers: 3, CrossBranch: 0, SendBacks: 0, Unassigns: 0 }],
    }));
    const { unmount } = renderWithProviders(<Transfers />, { route: "/reports/transfers?groupBy=pair" });
    let table = await screen.findByTestId("transfers-table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("From → To");
    await userEvent.setup().click(within(table).getByText("Amit Singh → Sara Khan"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?OwnerId=18");
    unmount();

    mockReportEndpoints("/api/reports/transfers", reportData({
      rows: [{ GroupKey: 2, GroupLabel: "SOUTH EXTENSION", SubKey: null, SubLabel: null, Transfers: 5, CrossBranch: 5, SendBacks: 0, Unassigns: 0 }],
    }));
    renderWithProviders(<Transfers />, { route: "/reports/transfers?groupBy=branch" });
    table = await screen.findByTestId("transfers-table");
    await userEvent.setup().click(within(table).getByText("SOUTH EXTENSION"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?BranchId=2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Transfers.test.jsx`
Expected: FAIL — cannot resolve `./Transfers`.

- [ ] **Step 3: Implement**

```jsx
// src/pages/Reports/Transfers.jsx
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { leadsUrl } from "./reportUtils";

const GROUP_BYS = [{ value: "reason", label: "Reason" }, { value: "pair", label: "From → To" }, { value: "branch", label: "Branch" }];
// A transfer has one date — when it happened.
const DATE_BASES = [{ value: "created", label: "Transferred" }];
const KPIS = [
  { key: "Transfers", label: "Transfers", format: "int" },
  { key: "CrossBranch", label: "Cross-branch", format: "int", tone: "warning" },
  { key: "SendBacks", label: "Sent back", format: "int", tone: "error" },
  { key: "Unassigns", label: "Unassigned", format: "int", tone: "info" },
];
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Transfers", header: "Transfers", format: "int", align: "right" },
  { key: "CrossBranch", header: "Cross-branch", format: "int", align: "right" },
  { key: "SendBacks", header: "Send-backs", format: "int", align: "right" },
  { key: "Unassigns", header: "Unassigns", format: "int", align: "right" },
];
const TREND = { series: [{ key: "Transfers", label: "Transfers", tone: "primary" }] };

// Who holds the lead now is what a manager wants to inspect: the receiving
// rep for a pair, the receiving branch for a branch. A reason has no owner.
const drill = (row, f) => {
  if (f.groupBy === "pair") return leadsUrl({ OwnerId: row.SubKey });
  if (f.groupBy === "branch") return leadsUrl({ BranchId: row.GroupKey });
  return leadsUrl({});
};

export default function Transfers() {
  return (
    <ReportPage
      reportKey="transfers"
      title="Transfers"
      subtitle="Leads changing hands: why, between whom, and across which branches."
      endpoint={SALES_ENDPOINTS.reports.transfers}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Transfers.test.jsx --coverage --coverage.include=src/pages/Reports/Transfers.jsx`
Expected: 2 passed; 100 %.

- [ ] **Step 5: Stop and report.**

---

### Task 18: Report page — Pipeline Value

**Files:**
- Create: `web/src/pages/Reports/PipelineValue.jsx`
- Create: `web/src/pages/Reports/PipelineValue.test.jsx`

**Interfaces:**
- Consumes: `ReportPage`; `sp_RptPipelineValue` columns (Task 2).
- Produces: default export `PipelineValue`, route `/reports/pipeline-value`. Default drill (status/owner/product/branch all map to a Leads filter).

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/pages/Reports/PipelineValue.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import PipelineValue from "./PipelineValue";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("PipelineValue report", () => {
  it("posts grouped by status, formats money, and drills by status with the range", async () => {
    const cap = mockReportEndpoints("/api/reports/pipelineValue", reportData({
      kpis: { OpenValue: 1250000, QualifiedValue: 480000, LostValue: 300000, OpenCount: 42, AvgValue: 41190.48 },
      rows: [{ GroupKey: 32, GroupLabel: "Qualified", Count: 12, Value: 480000 }],
      trend: [{ Bucket: "2026-09-01", OpenValue: 200000 }],
    }));
    renderWithProviders(<PipelineValue />, { route: "/reports/pipeline-value?preset=custom&from=2026-08-01&to=2026-08-31" });
    const table = await screen.findByTestId("pipelineValue-table");
    expect(cap.body).toMatchObject({ GroupBy: "status" });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("₹12,50,000.00");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Status", "Leads", "Value"]);
    expect(within(table).getByText("₹4,80,000.00")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("Qualified"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?from=2026-08-01&to=2026-08-31&StatusId=32");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/PipelineValue.test.jsx`
Expected: FAIL — cannot resolve `./PipelineValue`.

- [ ] **Step 3: Implement**

```jsx
// src/pages/Reports/PipelineValue.jsx
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const GROUP_BYS = [{ value: "status", label: "Status" }, { value: "owner", label: "Owner" }, { value: "product", label: "Product" }, { value: "branch", label: "Branch" }];
const KPIS = [
  { key: "OpenValue", label: "Open value", format: "money" },
  { key: "QualifiedValue", label: "Qualified value", format: "money", tone: "success" },
  { key: "LostValue", label: "Lost value", format: "money", tone: "error" },
  { key: "OpenCount", label: "Open leads", format: "int", tone: "info" },
  { key: "AvgValue", label: "Avg per lead", format: "money", tone: "info" },
];
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Count", header: "Leads", format: "int", align: "right" },
  { key: "Value", header: "Value", format: "money", align: "right" },
];
const TREND = { series: [{ key: "OpenValue", label: "Open value", tone: "success" }] };

export default function PipelineValue() {
  return (
    <ReportPage
      reportKey="pipelineValue"
      title="Pipeline Value"
      subtitle="Estimated value in play, qualified, and lost — by status, owner, product or branch. Revenue lands here in spec 3."
      endpoint={SALES_ENDPOINTS.reports.pipelineValue}
      groupBys={GROUP_BYS}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/PipelineValue.test.jsx --coverage --coverage.include=src/pages/Reports/PipelineValue.jsx`
Expected: 1 passed; 100 %.

- [ ] **Step 5: Stop and report.**

---

### Task 19: Report page — Leaderboard

**Files:**
- Create: `web/src/pages/Reports/Leaderboard.jsx`
- Create: `web/src/pages/Reports/Leaderboard.test.jsx`

**Interfaces:**
- Consumes: `ReportPage`; `sp_RptLeaderboard` columns (Task 3: RS1/RS3 empty; RS2 `Rank, Created, Qualified, Activities, OnTimePct, AvgResponseHours`).
- Produces: default export `Leaderboard`, route `/reports/leaderboard`. No KPI strip, no trend, no GroupBy tabs; default drill (`owner` → `OwnerId` + range).

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/pages/Reports/Leaderboard.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Leaderboard from "./Leaderboard";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Leaderboard report", () => {
  it("renders the ranked table with no KPI strip, trend or GroupBy tabs, and drills into the rep's leads for the range", async () => {
    const cap = mockReportEndpoints("/api/reports/leaderboard", reportData({
      rows: [
        { GroupKey: 17, GroupLabel: "Amit Singh", Created: 40, Qualified: 12, Activities: 150, OnTimePct: 82.5, AvgResponseHours: 3.2, Rank: 1 },
        { GroupKey: 18, GroupLabel: "Sara Khan", Created: 30, Qualified: 7, Activities: 90, OnTimePct: 70, AvgResponseHours: 9.8, Rank: 2 },
      ],
    }));
    renderWithProviders(<Leaderboard />, { route: "/reports/leaderboard?preset=custom&from=2026-08-01&to=2026-08-31" });
    const table = await screen.findByTestId("leaderboard-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner" });
    expect(screen.queryByTestId("report-kpis")).toBeNull();
    expect(screen.queryByTestId("trend-area")).toBeNull();
    expect(screen.queryByTestId("report-groupby")).toBeNull();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["#", "Rep", "Created", "Qualified", "Activities", "On-time %", "Avg response"],
    );
    expect(within(table).getByText("3.2 h")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("Sara Khan"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?from=2026-08-01&to=2026-08-31&OwnerId=18");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Leaderboard.test.jsx`
Expected: FAIL — cannot resolve `./Leaderboard`.

- [ ] **Step 3: Implement**

```jsx
// src/pages/Reports/Leaderboard.jsx
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

// One grouping (per rep) and no KPI row or trend by contract (spec §3):
// a leaderboard is its table.
const GROUP_BYS = [{ value: "owner", label: "Rep" }];
const COLUMNS = [
  { key: "Rank", header: "#", format: "int" },
  { key: "GroupLabel", header: "Rep" },
  { key: "Created", header: "Created", format: "int", align: "right" },
  { key: "Qualified", header: "Qualified", format: "int", align: "right" },
  { key: "Activities", header: "Activities", format: "int", align: "right" },
  { key: "OnTimePct", header: "On-time %", format: "pct", align: "right" },
  { key: "AvgResponseHours", header: "Avg response", format: "hours", align: "right" },
];

export default function Leaderboard() {
  return (
    <ReportPage
      reportKey="leaderboard"
      title="Leaderboard"
      subtitle="Reps ranked by qualified leads, then activity. Click a rep for their leads in this range."
      endpoint={SALES_ENDPOINTS.reports.leaderboard}
      groupBys={GROUP_BYS}
      columns={COLUMNS}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Reports/Leaderboard.test.jsx --coverage --coverage.include=src/pages/Reports/Leaderboard.jsx`
Expected: 1 passed; 100 %.

- [ ] **Step 5: Stop and report.**

---

### Task 20: Routes, redirects, deletions

**Files:**
- Modify: `web/src/App.jsx` (lazy imports + `routesConfig`)
- Modify: `web/src/App.routes.test.jsx`
- Delete: `web/src/pages/Reports/LeadsByStatus.jsx`, `LeadsByStatus.test.jsx`, `CallsPerUser.jsx`, `CallsPerUser.test.jsx`, `ConversionBySource.jsx`, `ConversionBySource.test.jsx`

**Interfaces:**
- Consumes: the eight page default exports (Tasks 12–19).
- Produces: routes `/reports/funnel`, `/reports/follow-up-compliance`, `/reports/activity`, `/reports/lost`, `/reports/aging`, `/reports/transfers`, `/reports/pipeline-value`, `/reports/leaderboard` — exactly the `tblMenu.Route` values `075` writes (Task 4). Redirects: `/reports/pipeline-funnel` and `/reports/leads-by-status` → `/reports/funnel`; `/reports/calls-per-user` → `/reports/activity`; `/reports/conversion-by-source` → `/reports/funnel?groupBy=source`; `/reports` fallback → `/reports/funnel`.

- [ ] **Step 1: Write the failing route tests**

In `web/src/App.routes.test.jsx`, change the section-redirect row `["/reports", "/reports/leads-by-status"]` to `["/reports", "/reports/funnel"]`, and replace the whole `describe("spec-1 routes", …)` block with:

```jsx
// Spec 1 retired the lead pipeline board; spec 4a retired the three
// single-number lead reports. Every old path survives only as a redirect so
// bookmarks and the one-release-old sidebar rows land somewhere useful.
describe("retired sales routes", () => {
  const paths = routesConfig.map((r) => r.path);
  const redirect = (from) => {
    const route = routesConfig.find((r) => r.path === from);
    expect(route.element.type.name).toBe("Navigate");
    return route.element.props.to;
  };

  it("has no pipeline page, only a redirect", () => {
    expect(redirect("/sales/pipeline")).toBe("/sales/leads");
  });

  it.each([
    ["/reports/pipeline-funnel", "/reports/funnel"],
    ["/reports/leads-by-status", "/reports/funnel"],
    ["/reports/calls-per-user", "/reports/activity"],
    ["/reports/conversion-by-source", "/reports/funnel?groupBy=source"],
  ])("redirects %s to %s", (from, to) => {
    expect(redirect(from)).toBe(to);
  });

  it("registers products and the eight spec-4a report pages (matching tblMenu.Route)", () => {
    expect(paths).toEqual(expect.arrayContaining([
      "/settings/products",
      "/reports/funnel",
      "/reports/follow-up-compliance",
      "/reports/activity",
      "/reports/lost",
      "/reports/aging",
      "/reports/transfers",
      "/reports/pipeline-value",
      "/reports/leaderboard",
    ]));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/App.routes.test.jsx`
Expected: FAIL — `/reports` falls back to `/reports/leads-by-status`; `/reports/leads-by-status` is a `ProtectedRoute`, not a `Navigate`; the eight paths are missing.

- [ ] **Step 3: Wire the routes**

In `web/src/App.jsx` replace the three report lazy imports:

```jsx
const LeadsByStatus = lazy(() => import("./pages/Reports/LeadsByStatus"));
const CallsPerUser = lazy(() => import("./pages/Reports/CallsPerUser"));
const ConversionBySource = lazy(() => import("./pages/Reports/ConversionBySource"));
```

with:

```jsx
// Sales reports (spec 4a) — one frame, eight config pages.
const FunnelReport = lazy(() => import("./pages/Reports/Funnel"));
const FollowUpComplianceReport = lazy(() => import("./pages/Reports/FollowUpCompliance"));
const ActivityReport = lazy(() => import("./pages/Reports/Activity"));
const LostReport = lazy(() => import("./pages/Reports/Lost"));
const AgingReport = lazy(() => import("./pages/Reports/Aging"));
const TransfersReport = lazy(() => import("./pages/Reports/Transfers"));
const PipelineValueReport = lazy(() => import("./pages/Reports/PipelineValue"));
const LeaderboardReport = lazy(() => import("./pages/Reports/Leaderboard"));
```

Change the `/reports` section redirect fallback:

```jsx
  { path: "/reports", element: <SectionRedirect prefix="/reports" fallback="/reports/funnel" /> },
```

Replace the four `/reports/pipeline-funnel` … `/reports/conversion-by-source` rows with:

```jsx
  // Sales reports (spec 4a). Spec-1 paths redirect: bookmarks and the sidebar
  // rows that were re-pointed in sql/075 both land on the new pages.
  { path: "/reports/pipeline-funnel", element: <Navigate to="/reports/funnel" replace /> },
  { path: "/reports/leads-by-status", element: <Navigate to="/reports/funnel" replace /> },
  { path: "/reports/calls-per-user", element: <Navigate to="/reports/activity" replace /> },
  { path: "/reports/conversion-by-source", element: <Navigate to="/reports/funnel?groupBy=source" replace /> },
  { path: "/reports/funnel", element: <ProtectedRoute element={<FunnelReport />} /> },
  { path: "/reports/follow-up-compliance", element: <ProtectedRoute element={<FollowUpComplianceReport />} /> },
  { path: "/reports/activity", element: <ProtectedRoute element={<ActivityReport />} /> },
  { path: "/reports/lost", element: <ProtectedRoute element={<LostReport />} /> },
  { path: "/reports/aging", element: <ProtectedRoute element={<AgingReport />} /> },
  { path: "/reports/transfers", element: <ProtectedRoute element={<TransfersReport />} /> },
  { path: "/reports/pipeline-value", element: <ProtectedRoute element={<PipelineValueReport />} /> },
  { path: "/reports/leaderboard", element: <ProtectedRoute element={<LeaderboardReport />} /> },
```

- [ ] **Step 4: Delete the retired pages**

Run: `cd web && rm src/pages/Reports/LeadsByStatus.jsx src/pages/Reports/LeadsByStatus.test.jsx src/pages/Reports/CallsPerUser.jsx src/pages/Reports/CallsPerUser.test.jsx src/pages/Reports/ConversionBySource.jsx src/pages/Reports/ConversionBySource.test.jsx`
Then: `cd web && grep -rn "LeadsByStatus\|CallsPerUser\|ConversionBySource\|leadsByStatus\|callsPerUser\|conversionBySource" src`
Expected: no matches (the `Funnel` chart in `components/Charts/` stays — the dashboard uses it).

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && pnpm exec vitest run src/App.routes.test.jsx`
Expected: all passed (`App.jsx` is excluded from coverage by config; the routes test is its gate).

- [ ] **Step 6: Stop and report.**

---

### Task 21: Whole suites green, lint, build, docs, deploy commands, live contract check

**Files:**
- Modify: `CLAUDE.md` §6 Sales (one sentence)
- Modify: `backend/ROLES.md` Known-open (one bullet replaced)
- Create (scratchpad only, not in the repo): `<scratchpad>/livetest/lib.mjs`, `<scratchpad>/livetest/reports.mjs`

This is the only task allowed to run a full suite or `pnpm build`.

- [ ] **Step 1: Backend — full suite with coverage**

Run: `cd backend && pnpm exec jest --maxWorkers=2 --silent --coverage` (timeout 300000)
Expected: every suite passes; `src/utils/reportKit.js`, `src/controllers/reportController.js`, `src/controllers/leadController.js` ≥ 80 % lines + branches; global ≥ 60 %.

- [ ] **Step 2: Web — full suite with coverage, lint, build**

Run: `cd web && pnpm exec vitest run --coverage` (timeout 300000; if it exceeds the timeout, run `pnpm exec vitest run src/pages --coverage` and then `pnpm exec vitest run src/components src/hooks src/utils src/api src/stores src/App.routes.test.jsx --coverage`, and read both reports)
Expected: every suite passes; every file created or modified in Tasks 8–20 ≥ 80 %; global ≥ 60 %. A file under 80 % gets the missing case added to its own test file — never lower a threshold.
Run: `cd web && pnpm lint`
Expected: 0 errors (pre-existing warnings only).
Run: `cd web && pnpm build`
Expected: `dist-web/` produced, no errors.

- [ ] **Step 3: Docs one-liners**

`CLAUDE.md` §6 **Sales (config engine)** — append a third bullet:

```
- **Sales reports (spec 4a, 2026-09-10):** eight read-only `sp_Rpt*` procs share one contract (12 params · RS1 KPIs · RS2 `GroupKey/GroupLabel` breakdown · RS3 `Bucket` trend) and apply the `sp_FetchLeads` scope predicate (branch **and** owner). `tblLeadStatusHistory` is written only by `sp_SaveLead` (insert) and `sp_SetLeadStatus` — never elsewhere. Backend: `utils/reportKit.js` (`parseReportArgs` whitelists GroupBy per report → 400). Web: one frame `pages/Reports/ReportPage.jsx`, filters in the URL, drill-down = `/sales/leads?…` (Leads reads `StatusCode/StatusId/SourceId/ProductId/OwnerId/BranchId/Overdue/Unassigned/from/to`). Demo data: `076` seed (deterministic, `DEMO %`), `077` removes it.
```

`backend/ROLES.md` **Known-open** — replace the bullet beginning "**Two lead reports are still unscoped.**" with:

```
- **The three spec-1 report SPs (`sp_LeadsByStatus`, `sp_CallsPerUser`,
  `sp_ConversionBySource`) scope by branch only.** Their endpoints stay one
  release for the `/reports/*` redirects and then go; the eight `sp_Rpt*`
  procs (spec 4a, `075`) apply branch AND owner scope like `sp_FetchLeads`.
```

- [ ] **Step 4: Live contract check (read-only against production, after the owner confirms `075` applied and the backend deployed)**

Recreate the runner in the scratchpad (the original `livetest/` directory no longer exists; this is the `lib.mjs` from the 2026-09-09 live test, recovered from the session log):

```js
// <scratchpad>/livetest/lib.mjs
import fs from "node:fs";
export const BASE = "https://shadowcodes.in/CRM";
export const PWD = process.env.CRM_TEST_PWD; // never hard-code a live credential
const LOG = new URL("./test-log.jsonl", import.meta.url).pathname;
export const state = (() => { try { return JSON.parse(fs.readFileSync(new URL("./state.json", import.meta.url).pathname)); } catch { return { users: {}, tokens: {}, products: {}, leads: {} }; } })();
export const saveState = () => fs.writeFileSync(new URL("./state.json", import.meta.url).pathname, JSON.stringify(state, null, 2));
export function log(entry) { fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n"); }
export async function login(username, password = PWD) {
  const r = await fetch(`${BASE}/api/auth/loginUser`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(`login ${username}: ${r.status} ${j.message}`);
  state.tokens[username] = j.data.token; state.users[username] = state.users[username] || {}; Object.assign(state.users[username], { Id: j.data.user.Id, BranchId: Number(j.data.user.BranchId), IsAdmin: j.data.user.IsAdmin });
  return j.data;
}
export async function post(as, path, body = {}) {
  const token = state.tokens[as]; if (!token) throw new Error(`no token for ${as}`);
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ raw: true }));
  return { status: r.status, ok: j.success === true, message: j.message, data: j.data, code: j.code };
}
let n = 0; export const results = [];
export function check(phase, name, res, expectStatus, detail = (r) => r.message) {
  const pass = Array.isArray(expectStatus) ? expectStatus.includes(res.status) : res.status === expectStatus;
  const row = { n: ++n, phase, name, expect: expectStatus, got: res.status, pass, detail: typeof detail === "function" ? detail(res) : detail };
  results.push(row); log(row);
  console.log(`${pass ? "PASS" : "FAIL"} #${row.n} [${phase}] ${name} → ${res.status} (want ${expectStatus}) ${row.detail ?? ""}`);
  return res;
}
export function summary(phase) {
  const rows = results.filter((r) => r.phase === phase); const f = rows.filter((r) => !r.pass);
  console.log(`\n== ${phase}: ${rows.length - f.length}/${rows.length} passed`);
  for (const r of f) console.log(`   FAIL #${r.n} ${r.name}: got ${r.got}, want ${r.expect}`);
  return f.length === 0;
}
```

```js
// <scratchpad>/livetest/reports.mjs — spec 4a §7: one call per report per persona, scope must narrow.
import { login, post, check, summary, state } from "./lib.mjs";

const PERSONAS = ["sh_priya", "bm_ho_rahul", "tl_ho_neha", "se_ho_amit"];   // Company → Branch → Team → Self
const REPORTS = ["funnel", "followUpCompliance", "activity", "lost", "aging", "transfers", "pipelineValue", "leaderboard"];
const range = { FromDate: "2026-03-14", ToDate: "2026-09-10" };            // 180 days — covers the 076 seed
const shape = (r) => r.data && "kpis" in r.data && Array.isArray(r.data.rows) && Array.isArray(r.data.trend) && r.data.range?.groupBy;

for (const u of PERSONAS) await login(u);

const created = {};
for (const rep of REPORTS) {
  for (const u of PERSONAS) {
    const res = await post(u, `/api/reports/${rep}`, range);
    check("P5", `${rep} as ${u}`, { ...res, status: res.status === 200 && !shape(res) ? 590 : res.status }, 200,
      (r) => (r.data ? `kpis=${JSON.stringify(r.data.kpis).slice(0, 70)} rows=${r.data.rows?.length}` : r.message));
    if (rep === "funnel") created[u] = res.data?.kpis?.Created ?? -1;
  }
}

// Scope narrows down the reporting chain: Company ≥ Branch ≥ Team ≥ Self.
const chain = PERSONAS.map((u) => created[u]);
const monotone = chain.every((v, i) => i === 0 || v <= chain[i - 1]);
check("P5", `funnel Created narrows ${chain.join(" ≥ ")}`, { status: monotone ? 200 : 500, message: "" }, 200);

// Self scope: Amit's leaderboard names nobody outside his own visibility.
const lb = await post("se_ho_amit", "/api/reports/leaderboard", range);
const amitId = state.users.se_ho_amit.Id;
check("P5", "Amit's leaderboard is himself (and only people whose leads he created)", { status: lb.data.rows.some((r) => r.GroupKey === amitId) || lb.data.rows.length === 0 ? 200 : 500, message: JSON.stringify(lb.data.rows.map((r) => r.GroupLabel)) }, 200);

// Contract edges
check("P5", "unknown GroupBy → 400", await post("sh_priya", "/api/reports/funnel", { ...range, GroupBy: "nope" }), 400);
check("P5", "bad date → 400", await post("sh_priya", "/api/reports/funnel", { FromDate: "10/09/2026" }), 400);
check("P5", "empty body → defaults, 200", await post("sh_priya", "/api/reports/funnel", {}), 200, (r) => `range=${JSON.stringify(r.data?.range)}`);
check("P5", "transfers GroupBy=pair → 200", await post("sh_priya", "/api/reports/transfers", { ...range, GroupBy: "pair" }), 200);
check("P5", "fetchLeads honours FromDate/ToDate", await post("sh_priya", "/api/leads/fetchLeads", { FromDate: "2026-09-01", ToDate: "2026-09-10", PageSize: 5 }), 200, (r) => `rows=${r.data?.leads?.length} total=${r.data?.pagination?.totalRecords}`);
check("P5", "old leadsByStatus still answers (one release)", await post("sh_priya", "/api/reports/leadsByStatus", {}), 200);

process.exit(summary("P5") ? 0 : 1);
```

Run: `cd <scratchpad>/livetest && node reports.mjs` (timeout 120000)
Expected: every check `PASS`; `funnel Created` non-increasing from Priya to Amit; exit code 0. On a FAIL, report the row verbatim — do not change the SQL yourself; the owner applies fixes.

- [ ] **Step 5: Hand the owner the deploy commands (user-run only, §0.6)**

Backend (after `075` is applied):

```bash
cd ~/Developer/Nexus/CRM/backend
REMOTE=/www/wwwroot/shadowcodes.in/CRM
rsync -avzc src/ myserver:$REMOTE/src/
rsync -avzc package.json pnpm-lock.yaml pnpm-workspace.yaml Dockerfile docker-compose.yml .dockerignore .env.prd myserver:$REMOTE/
ssh myserver "cd $REMOTE && docker compose up -d --build crm && docker compose logs crm --tail=50"
curl -s https://shadowcodes.in/CRM/health   # expect 200 JSON
```

Then apply `076_seed_sales_demo.sql` (optional, for the walkthrough). Then web:

```bash
cd ~/Developer/Nexus/CRM/web && pnpm build
# upload the CONTENTS of web/dist-web/ to the IIS server's /CRM/ folder (your usual upload);
# public/web.config travels with it and keeps deep links working.
```

Post-deploy checks for the owner, in the browser, after re-login (menu rights reload): Sales Reports shows 9 entries (Funnel, Activity, Conversion by Source, Follow-up Compliance, Lost Analysis, Aging, Transfers, Pipeline Value, Leaderboard); `/reports/leads-by-status` bookmark lands on Funnel; Funnel → 90d → click a Website row → Leads list shows the "Created dd-mm-yyyy – dd-mm-yyyy" chip and only Website leads; Export CSV downloads; log in as `tl_ho_neha` → Funnel totals are smaller than as `sh_priya`; dark mode: chart and tiles readable.

- [ ] **Step 6: Close-out (driver, not the implementer)**
- After the owner confirms `075` (and, if run, `076`) applied and the walkthrough passes: delete `backend/sql/075_sales_reports.sql` and `076_seed_sales_demo.sql` (§0.2). `077_remove_sales_demo.sql` stays until the owner runs it.
- Notion (§0.5): fetch the page, then `notion-update-page` with `content_updates` — **✅ Done** `- **2026-09-10** — Sales report system (spec 4a): tblLeadStatusHistory, 8 sp_Rpt* procs with branch+owner scope, reportKit + 8 endpoints, ReportPage frame + 8 pages, Leads drill-down, deterministic demo seed 076/077.`; **🐛 Bug Fix Log** `- **2026-09-10** — **Team/Self users saw branch-wide report totals.** Root cause: spec-1 report SPs took @AccessibleBranchIdsJson only. Fix: every sp_Rpt* (backend/sql/075) applies the sp_FetchLeads predicate incl. @OwnerIdsJson; controllers pass scopeParams(req).`; **📅 Change Log** `- **2026-09-10** — Reports: leads-by-status / calls-per-user / conversion-by-source replaced by Funnel / Activity / Funnel?groupBy=source (+ Follow-up Compliance, Lost, Aging, Transfers, Pipeline Value, Leaderboard). Old API endpoints kept one release.`
- Stop and report. The owner commits and pushes.

---

## Self-review

**Spec coverage** (spec §1–§7 → tasks):

| Spec item | Task |
|---|---|
| §1.1 one SP per report, three RS, same params | 2, 3, 4 (contract in Global Constraints) |
| §1.2 shared `ReportPage` frame | 10 |
| §1.3 branch AND owner scope in every report SP | 2, 3, 4 (predicate copied verbatim); live check 21 |
| §1.4 `tblLeadStatusHistory` on insert + every status change | 1 |
| §1.5 drill-down = Leads list via URL params | 8 (`drillParams`), 10 (row click), 11 (Leads reads them), 7 + 1 (`FromDate/ToDate` down to the SP) |
| §1.6 no Reports menu for executives | 4 (grants cloned from row 20 — no group 16) |
| §1.7 deterministic backdated seed, `DEMO` prefix, removable | 5 |
| §1.8 revenue/margin/ROI deferred | — (out of scope; PipelineValue subtitle says so) |
| §1.9 dashboards by role = phase 2 | — (separate plan) |
| §2 table + indexes, `sp_SaveLead`/`sp_SetLeadStatus`, backfill | 1 |
| §2 derived first-contact / last-touch / nothing-scheduled | 2 (`ContactedAt`), 4 (`LastTouchAt`, `NoNextFollowUp`) |
| §2 menu rows under parent 11, grants from row 20, 20/21/22 re-pointed | 4 (ambiguity 2) |
| §3 params, scope predicate, RS shapes, weekly/daily buckets, no ResponseCode | 2, 3, 4 |
| §3 table: Funnel / FollowUpCompliance / Activity / Lost / Aging / Transfers / PipelineValue / Leaderboard measures | 2 (Funnel, Lost, PipelineValue), 3 (FollowUpCompliance, Activity, Leaderboard), 4 (Aging, Transfers) |
| §3 GroupBy values incl. `team`, `day`; unknown → 400 | 2–4 (RAISERROR), 6 (whitelist → 400) |
| §4 `runReport` helper: dates default 30 d, GroupBy whitelist, `positiveInt` narrowing, `scopeParams`, response shape | 6 |
| §4 eight methods, camelCase routes, old endpoints kept one release | 7 |
| §4 helper unit-tested once; each method happy + 400 | 6, 7 |
| §5 `ReportPage` props, filter bar (presets, custom dates, basis, branch/owner/source/product, GroupBy), URL filters | 8, 10 |
| §5 KPI strip = existing `StatCard`; trend = recharts area (generic `TrendArea`, ambiguity 4); `ReportTable` kept + CSV + row click | 9, 10 |
| §5 `Leads.jsx` reads the ten URL params | 11 |
| §5 eight pages ≤ 60 lines, routes, three redirects, `/reports` fallback, deletions | 12–19, 20 |
| §5 recharts only, numeric heights, theme tokens, dark mode | 9 (`TrendArea` test renders dark) |
| §6 seed: users, products, 600 leads, mixes, follow-ups, transfers, verify block | 5 (worked hash example included) |
| §7 SQL verify blocks | 4 (`075`), 5 (`076`) |
| §7 Jest + live contract check per persona | 6, 7, 21 |
| §7 web frame tests, one page test each, Leads URL test | 10, 12–19, 11 |
| §7 rollout order | 4, 5, 21 |

Not planned (spec §8): revenue/margin/ROI, targets, scheduled reports, PDF, mobile.

**Placeholder scan:** no TBD/TODO/"similar to"/"add validation". Every SQL body, controller, page and test is written out. Two coverage fallbacks (Tasks 13, 16) name the exact extra assertion to add rather than "add tests".

**Type consistency:**
- SP params (12, same order) — Global Constraints ↔ Tasks 2/3/4 ↔ `parseReportArgs` args + `scopeParams` keys (Task 6) ↔ `toBody` (Task 8) ✓
- RS1/RS2/RS3 column names — Task 2 `sp_RptFunnel` (`Created, Contacted, Qualified, Lost, Junk, QualifiedPct, LostPct, AvgDaysToContact, AvgDaysToQualify`) ↔ Task 12 `KPIS`/`COLUMNS`/`TREND` ✓; Task 3 `sp_RptFollowUpCompliance` (`Due, DoneOnTime, DoneLate, Skipped, Missed, OnTimePct, AvgDelayHours`) ↔ Task 13 ✓; `sp_RptActivity` (`Calls, Visits, Meetings, Other, TalkMinutes, Inbound, Outbound, Connected`) ↔ Task 14 ✓; `sp_RptLost` (`Lost, LostPct, TopReason`; `SubKey/SubLabel`) ↔ Task 15 ✓; Task 4 `sp_RptAging` (`Open, Age0_7, Age8_30, Age31_90, Age90Plus, NoNextFollowUp, AvgDaysSinceTouch`) ↔ Task 16 ✓; `sp_RptTransfers` (`Transfers, CrossBranch, SendBacks, Unassigns`; `pair` → `SubKey`) ↔ Task 17 ✓; Task 2 `sp_RptPipelineValue` (`OpenValue, QualifiedValue, LostValue, OpenCount, AvgValue`; RS2 `Count, Value`) ↔ Task 18 ✓; Task 3 `sp_RptLeaderboard` (`Created, Qualified, Activities, OnTimePct, AvgResponseHours, Rank`) ↔ Task 19 ✓
- GroupBy whitelists — SP guards (2/3/4) ↔ `REPORTS` (6) ↔ page `GROUP_BYS` (12–19): funnel `source|owner|product|branch|status|team`; followUpCompliance `owner|team|branch`; activity `owner|day|team|branch`; lost `reason|source|product|owner|branch`; aging `owner|branch|team`; transfers `reason|pair|branch`; pipelineValue `status|owner|product|branch`; leaderboard `owner` ✓
- Response `data: { kpis, rows, trend, range: { from, to, basis, groupBy } }` — Task 6 ↔ Task 10 (`data?.kpis/rows/trend`) ↔ `reportData()` helper ✓
- Endpoint keys — `SALES_ENDPOINTS.reports.<key>` (Task 10) = route names (Task 7) = `reportKey` per page (12–19) = `REPORTS` keys (Task 6) ✓; test ids `<reportKey>-table` use the camelCase key (`followUpCompliance-table`, `pipelineValue-table`) ✓
- `ReportPage` props `{ reportKey, title, subtitle, endpoint, groupBys, dateBases, kpis, columns, trend, drill }` — Task 10 ↔ every page ✓; header rule "no `header` → GroupBy label" — Task 10 ↔ Tasks 12–19 column configs ✓; `drill(row, filters)` argument order — Task 10 ↔ Tasks 13–17 ✓
- `readFilters(params, { groupBys, today })` / `writeFilters(f)` / `toBody(f)` / `leadsUrl(params)` / `drillParams(filters, row)` / `GROUP_PARAM` — Task 8 ↔ Task 10 ↔ Tasks 13–17 ✓
- `ReportTable({ rows, columns, rowKey, testId, onRowClick })`, row test id `<testId>-row` — Task 9 ↔ Task 10 (`drill: null` test expects no `funnel-table-row`) ✓
- `mockReportEndpoints(path, data, capture)` → `capture.body`; `reportData(over)` — Task 10 ↔ Tasks 12–19 ✓
- `leadsParamsToState(params)` → `{ preset, filters, range }` — Task 11 helper ↔ `Leads.jsx` ✓; `FromDate`/`ToDate` body keys — Task 11 ↔ Task 7 `isoDay` ↔ Task 1 `@FromDate/@ToDate` ✓
- Routes — Task 4 `tblMenu.Route` values ↔ Task 20 `routesConfig` ↔ Task 20 test list ✓
- Seed users `demo_bm_ip_meera` / `demo_se_ip_rohan` / `demo_se_ip_isha` / `demo_se_ip_kabir` — Task 5 `076` ↔ `077` `Username LIKE 'demo\_%'` ✓; lookups resolved by `Kind`+`Value` against the live labels listed in Global Constraints ✓
