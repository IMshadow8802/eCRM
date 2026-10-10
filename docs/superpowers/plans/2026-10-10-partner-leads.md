# Partner Leads and Commission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partners as records, a lead tied to the partner who sent it with per-lead commission terms, commission tracked earned → due → paid, a Partner report, and leads that stop being visible to their creator once moved.

**Architecture:** One SQL script (`backend/sql/107_partners.sql`) holds every table, column, seed and stored procedure, and is applied to **TestCRM first**. Commission rows are written by one idempotent proc, `sp_SyncPartnerCommission`, which Node calls after every lead write that can change it (save-partner, convert, status change) — the same "reconcile after write" pattern TAT uses (`tatService.afterTaskWrite`), so the big existing procs (`sp_SaveLead`, `sp_ConvertLead`, `sp_SetLeadStatus`) are not rewritten. Backend: a `partners` module, `partnerController` + routes, hooks in `leadController`, one report. Web: Sales → Partners page (two tabs), partner picker on the lead form, a partner card on the lead, a Partner report.

**Tech Stack:** SQL Server stored procedures; Node/Express 5 + Jest/Supertest (DB mocked); React 19 + MUI 9 + material-react-table + TanStack Query + Vitest/RTL/MSW.

**Spec:** `docs/superpowers/specs/2026-10-10-partner-leads-design.md`

## Global Constraints

- pnpm only. Git is read-only for implementers unless the controller says commit; leave work uncommitted otherwise (CLAUDE.md §0.1).
- SQL is written, never applied by Claude. The user applies with `sqlcmd ... -C -b -I -i` to `TestCRM` first (CLAUDE.md §0.2, §0.7). MCP `read_query` is fine for reading live definitions (`[TestCRM].sys.sql_modules`).
- Every SP filters by `@CompId`. Mutating SPs return one row `Id, ResponseCode, ResponseMess`.
- Every route declares access (`requireModule` / `open()` / `requireAdmin`) — `tests/unit/routes/routeAccess.test.js` fails otherwise.
- Mobile number = ten digits via `backend/src/utils/mobile.js` (backend) and `ui/MobileInput` (web).
- MUI v9: `slotProps`, shared `ui/` components (`Combobox`, `TextInput`, `Modal`, `PageHeader`, `Tabs`, `Chip`, `Button`, `DateField`), tables through `components/table/useAppTable` / `useServerTable`.
- Test-first; ≥80% line/branch coverage on touched files in `backend/src` and `web/src`. Never `.only`/`.skip`.
- Plain words in the UI (no jargon): "Ready to pay", "Mark paid", "Partner", "Commission".
- Spec deviation (ruled): the "commission becomes payable" setting lives on the Partners page → Commissions tab (one control, `partners` edit), not on Settings → Work settings, so the work-settings proc and page stay untouched.

## Review Focus

1. A `pct` commission on a lead converted with WonValue 0 or NULL → Amount 0.00, row still created and shown — Task 1 verify block + Task 3 test.
2. Two people press "Mark paid" on the same row → one succeeds, the other gets a 409 "already paid", never two payments — Task 1 (`WHERE Status='due'`) + Task 3 test.
3. Lead moved A → B → A gets 404 on detail and no row in lists/reports; A's manager (Team reach) still sees it — Task 2 tests.
4. Changing the partner or terms on a lead whose commission is already paid → refused with a plain message, nothing changes — Task 1 + Task 4 test.
5. A salesperson without `partners` view saves a lead with a partner → terms default silently from the partner's usual rule, and the API never returns amounts/terms to them — Task 4 tests.

---

### Task 1: SQL script 107 — tables, seeds, procs, visibility fix

**Files:**
- Create: `backend/sql/107_partners.sql`

**Interfaces:**
- Produces (procs, exact params):
  - `sp_SavePartner @Id INT, @CompId INT, @UserId INT, @Name NVARCHAR(200), @ContactPerson NVARCHAR(200), @Mobile VARCHAR(10), @Email VARCHAR(150), @City NVARCHAR(100), @Notes NVARCHAR(1000), @CommType VARCHAR(5), @CommValue DECIMAL(12,2), @IsActive BIT` → status row
  - `sp_FetchPartners @CompId INT, @IncludeInactive BIT = 0` → rows `Id, Name, ContactPerson, Mobile, Email, City, Notes, CommType, CommValue, IsActive, LeadsSent, Converted, EarnedAmount, DueAmount, PaidAmount`
  - `sp_FetchPartnerPicker @CompId INT` → `Id, Name, City` (active only)
  - `sp_SetLeadPartner @CompId INT, @LeadId INT, @UserId INT, @PartnerId INT, @CommType VARCHAR(5), @CommValue DECIMAL(12,2), @SetTerms BIT` → status row
  - `sp_SyncPartnerCommission @CompId INT, @LeadId INT, @UserId INT` → status row
  - `sp_FetchLeadPartner @CompId INT, @LeadId INT` → RS1 `PartnerId, PartnerName, CommType, CommValue`; RS2 commission rows (newest first)
  - `sp_FetchCommissions @CompId INT, @PartnerId INT = NULL, @Status VARCHAR(10) = NULL, @FromDate DATE = NULL, @ToDate DATE = NULL` → RS1 rows `Id, LeadId, LeadName, PartnerId, PartnerName, BaseValue, CommType, CommValue, Amount, Status, Reverted, EarnedAt, DueAt, PaidAt, PaidRef`; RS2 one row `CommissionDueOn`
  - `sp_MarkCommissionDue @CompId INT, @UserId INT, @IdsJson NVARCHAR(MAX)` → status row, `Id` = rows changed
  - `sp_MarkCommissionPaid @CompId INT, @UserId INT, @IdsJson NVARCHAR(MAX), @PaidAt DATE, @PaidRef NVARCHAR(100)` → status row, `Id` = rows changed
  - `sp_SavePartnerSetting @CompId INT, @CommissionDueOn VARCHAR(10)` → status row
  - `sp_RptPartners` — the shared 12-param report contract (see Step 6)
  - `sp_FetchLeads` gains `@PartnerId INT = NULL` and returns `PartnerId, PartnerName`

- [ ] **Step 1: Header, tables and columns**

```sql
-- 107_partners.sql — partners, partner on a lead, commission, Partner report,
-- and "moving a lead really moves it" (spec 2026-10-10-partner-leads-design).
--
-- Apply to TestCRM FIRST, check, then eCRM+ and SolarCRM:
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "TestCRM"  -C -b -I -i sql/107_partners.sql
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "eCRM+"    -C -b -I -i sql/107_partners.sql
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "SolarCRM" -C -b -I -i sql/107_partners.sql
-- Re-runnable: every DDL is guarded, every proc is CREATE OR ALTER.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Partners -----------------------------------------------------------------
IF OBJECT_ID('dbo.tblPartner') IS NULL
CREATE TABLE dbo.tblPartner (
    Id            INT IDENTITY(1,1) CONSTRAINT PK_tblPartner PRIMARY KEY,
    CompId        INT            NOT NULL,
    Name          NVARCHAR(200)  NOT NULL,
    ContactPerson NVARCHAR(200)  NULL,
    Mobile        VARCHAR(10)    NULL
        CONSTRAINT CK_tblPartner_Mobile CHECK (Mobile IS NULL OR Mobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    Email         VARCHAR(150)   NULL,
    City          NVARCHAR(100)  NULL,
    Notes         NVARCHAR(1000) NULL,
    CommType      VARCHAR(5)     NULL CONSTRAINT CK_tblPartner_CommType CHECK (CommType IN ('pct','fixed')),
    CommValue     DECIMAL(12,2)  NULL,
    IsActive      BIT            NOT NULL CONSTRAINT DF_tblPartner_IsActive DEFAULT 1,
    CreatedBy     INT            NOT NULL,
    CreatedAt     DATETIME       NOT NULL CONSTRAINT DF_tblPartner_CreatedAt DEFAULT GETDATE(),
    UpdatedAt     DATETIME       NULL,
    CONSTRAINT CK_tblPartner_Comm CHECK (
        (CommType IS NULL AND CommValue IS NULL)
     OR (CommType = 'fixed' AND CommValue >= 0)
     OR (CommType = 'pct'   AND CommValue >= 0 AND CommValue <= 100))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblPartner_Mobile')
    CREATE UNIQUE INDEX UX_tblPartner_Mobile ON dbo.tblPartner (CompId, Mobile)
        WHERE IsActive = 1 AND Mobile IS NOT NULL;
GO

-- 2. Partner + terms on the lead ------------------------------------------------
IF COL_LENGTH('dbo.tblLeads', 'PartnerId') IS NULL
    ALTER TABLE dbo.tblLeads ADD
        PartnerId INT NULL CONSTRAINT FK_tblLeads_Partner REFERENCES dbo.tblPartner (Id),
        CommType  VARCHAR(5)    NULL,
        CommValue DECIMAL(12,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblLeads_Comm')
    ALTER TABLE dbo.tblLeads ADD CONSTRAINT CK_tblLeads_Comm CHECK (
        (CommType IS NULL AND CommValue IS NULL)
     OR (PartnerId IS NOT NULL AND CommType = 'fixed' AND CommValue >= 0)
     OR (PartnerId IS NOT NULL AND CommType = 'pct'   AND CommValue >= 0 AND CommValue <= 100));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_PartnerId')
    CREATE INDEX IX_tblLeads_PartnerId ON dbo.tblLeads (CompId, PartnerId) WHERE PartnerId IS NOT NULL;
GO

-- 3. Commission ------------------------------------------------------------------
IF OBJECT_ID('dbo.tblPartnerCommission') IS NULL
CREATE TABLE dbo.tblPartnerCommission (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_tblPartnerCommission PRIMARY KEY,
    CompId      INT           NOT NULL,
    LeadId      INT           NOT NULL CONSTRAINT FK_tblPartnerCommission_Lead REFERENCES dbo.tblLeads (Id),
    PartnerId   INT           NOT NULL CONSTRAINT FK_tblPartnerCommission_Partner REFERENCES dbo.tblPartner (Id),
    BaseValue   DECIMAL(18,2) NULL,
    CommType    VARCHAR(5)    NOT NULL CONSTRAINT CK_tblPartnerCommission_Type CHECK (CommType IN ('pct','fixed')),
    CommValue   DECIMAL(12,2) NOT NULL,
    Amount      DECIMAL(14,2) NOT NULL,
    Status      VARCHAR(10)   NOT NULL CONSTRAINT CK_tblPartnerCommission_Status CHECK (Status IN ('earned','due','paid','cancelled')),
    Reverted    BIT           NOT NULL CONSTRAINT DF_tblPartnerCommission_Reverted DEFAULT 0,
    EarnedAt    DATETIME      NOT NULL,
    DueAt       DATETIME      NULL,
    DueBy       INT           NULL,
    PaidAt      DATE          NULL,
    PaidBy      INT           NULL,
    PaidRef     NVARCHAR(100) NULL,
    CancelledAt DATETIME      NULL
);
GO
-- One live row per lead. A paid row whose lead was un-converted (Reverted = 1)
-- and cancelled rows are history and do not count.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblPartnerCommission_Live')
    CREATE UNIQUE INDEX UX_tblPartnerCommission_Live ON dbo.tblPartnerCommission (LeadId)
        WHERE Status <> 'cancelled' AND Reverted = 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblPartnerCommission_Partner')
    CREATE INDEX IX_tblPartnerCommission_Partner ON dbo.tblPartnerCommission (CompId, PartnerId, Status);
GO

-- 4. Setting: when does a commission become payable -------------------------------
IF COL_LENGTH('dbo.tblCompanySetting', 'CommissionDueOn') IS NULL
    ALTER TABLE dbo.tblCompanySetting ADD CommissionDueOn VARCHAR(10) NOT NULL
        CONSTRAINT DF_tblCompanySetting_CommissionDueOn DEFAULT 'manual'
        CONSTRAINT CK_tblCompanySetting_CommissionDueOn CHECK (CommissionDueOn IN ('manual','convert'));
GO

-- 5. Module 'partners' is a grantable module (no reach of its own) --------------------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Module'
           AND definition NOT LIKE '%partners%')
BEGIN
    ALTER TABLE dbo.tblGroupModule DROP CONSTRAINT CK_tblGroupModule_Module;
    ALTER TABLE dbo.tblGroupModule ADD CONSTRAINT CK_tblGroupModule_Module CHECK (Module IN
        ('leads','sales_reports','complaints','support_reports','customers','people',
         'tasks','teams','projects','settings','dashboard','attendance','partners'));
END
GO

-- 6. "Partner" lead source per company, and the two menu rows ---------------------------
INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive, Code)
SELECT c.CompId, 'lead_source', N'Partner',
       ISNULL((SELECT MAX(SortOrder) FROM dbo.tblLookup x WHERE x.CompId = c.CompId AND x.Kind = 'lead_source'), 0) + 1,
       1, 'partner'
FROM (SELECT DISTINCT CompId FROM dbo.tblLookup WHERE Kind = 'lead_source') c
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup y WHERE y.CompId = c.CompId AND y.Kind = 'lead_source' AND y.Code = 'partner');
GO
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/sales/partners')
    INSERT INTO dbo.tblMenu (ParentId, Description, MenuType, FormId, ActualId, IsAllowed, Route, Module)
    SELECT Id, 'Partners', 1, 0, 0, 1, '/sales/partners', 'partners' FROM dbo.tblMenu WHERE Route = '/sales' AND ParentId = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/reports/partners')
    INSERT INTO dbo.tblMenu (ParentId, Description, MenuType, FormId, ActualId, IsAllowed, Route, Module)
    SELECT Id, 'Partners', 1, 0, 0, 1, '/reports/partners', 'sales_reports' FROM dbo.tblMenu WHERE Description = 'Sales Reports' AND ParentId = 0;
GO
```

- [ ] **Step 2: Partner procs**

```sql
CREATE OR ALTER PROC dbo.sp_SavePartner
    @Id INT, @CompId INT, @UserId INT,
    @Name NVARCHAR(200), @ContactPerson NVARCHAR(200) = NULL, @Mobile VARCHAR(10) = NULL,
    @Email VARCHAR(150) = NULL, @City NVARCHAR(100) = NULL, @Notes NVARCHAR(1000) = NULL,
    @CommType VARCHAR(5) = NULL, @CommValue DECIMAL(12,2) = NULL, @IsActive BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @Name = LTRIM(RTRIM(@Name));
    IF @Name IS NULL OR @Name = N''
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Partner name is required' AS ResponseMess; RETURN; END
    IF (@CommType IS NULL) <> (@CommValue IS NULL)
       OR (@CommType = 'pct' AND (@CommValue < 0 OR @CommValue > 100))
       OR (@CommType = 'fixed' AND @CommValue < 0)
       OR (@CommType IS NOT NULL AND @CommType NOT IN ('pct','fixed'))
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Commission must be a percent from 0 to 100 or an amount of 0 or more' AS ResponseMess; RETURN; END
    IF @Mobile IS NOT NULL AND ISNULL(@IsActive, 1) = 1 AND EXISTS (
        SELECT 1 FROM dbo.tblPartner WHERE CompId = @CompId AND Mobile = @Mobile AND IsActive = 1 AND Id <> ISNULL(@Id, 0))
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Another partner already has this mobile number' AS ResponseMess; RETURN; END

    IF ISNULL(@Id, 0) = 0
    BEGIN
        INSERT INTO dbo.tblPartner (CompId, Name, ContactPerson, Mobile, Email, City, Notes, CommType, CommValue, IsActive, CreatedBy)
        VALUES (@CompId, @Name, @ContactPerson, @Mobile, @Email, @City, @Notes, @CommType, @CommValue, ISNULL(@IsActive, 1), @UserId);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id, 200 AS ResponseCode, 'Partner added' AS ResponseMess;
        RETURN;
    END
    UPDATE dbo.tblPartner
    SET Name = @Name, ContactPerson = @ContactPerson, Mobile = @Mobile, Email = @Email, City = @City, Notes = @Notes,
        CommType = @CommType, CommValue = @CommValue, IsActive = ISNULL(@IsActive, 1), UpdatedAt = GETDATE()
    WHERE Id = @Id AND CompId = @CompId;
    IF @@ROWCOUNT = 0
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Partner not found' AS ResponseMess; RETURN; END
    SELECT @Id AS Id, 200 AS ResponseCode, 'Partner saved' AS ResponseMess;
END
GO

CREATE OR ALTER PROC dbo.sp_FetchPartners @CompId INT, @IncludeInactive BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.Id, p.Name, p.ContactPerson, p.Mobile, p.Email, p.City, p.Notes, p.CommType, p.CommValue, p.IsActive,
           (SELECT COUNT(*) FROM dbo.tblLeads l WHERE l.CompId = @CompId AND l.PartnerId = p.Id) AS LeadsSent,
           (SELECT COUNT(*) FROM dbo.tblLeads l JOIN dbo.tblLookup s ON s.Id = l.StatusId
             WHERE l.CompId = @CompId AND l.PartnerId = p.Id AND s.Code = 'converted') AS Converted,
           ISNULL((SELECT SUM(Amount) FROM dbo.tblPartnerCommission c WHERE c.CompId = @CompId AND c.PartnerId = p.Id AND c.Status = 'earned'), 0) AS EarnedAmount,
           ISNULL((SELECT SUM(Amount) FROM dbo.tblPartnerCommission c WHERE c.CompId = @CompId AND c.PartnerId = p.Id AND c.Status = 'due'), 0)    AS DueAmount,
           ISNULL((SELECT SUM(Amount) FROM dbo.tblPartnerCommission c WHERE c.CompId = @CompId AND c.PartnerId = p.Id AND c.Status = 'paid'), 0)   AS PaidAmount
    FROM dbo.tblPartner p
    WHERE p.CompId = @CompId AND (@IncludeInactive = 1 OR p.IsActive = 1)
    ORDER BY p.IsActive DESC, p.Name;
END
GO

CREATE OR ALTER PROC dbo.sp_FetchPartnerPicker @CompId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, Name, City FROM dbo.tblPartner WHERE CompId = @CompId AND IsActive = 1 ORDER BY Name;
END
GO
```

- [ ] **Step 3: Commission sync (the one writer of commission rows besides the two "mark" procs)**

```sql
-- Brings the lead's live commission row in line with the lead. Idempotent:
-- Node calls it after every write that can change the answer (partner/terms,
-- convert, status change); a second call changes nothing.
--   converted + partner + terms -> a live row exists (inserted earned/due per
--                                  the company setting; an unpaid one is
--                                  recomputed; a paid one is never touched)
--   anything else               -> unpaid live row cancelled; a paid one is
--                                  kept and flagged Reverted
CREATE OR ALTER PROC dbo.sp_SyncPartnerCommission @CompId INT, @LeadId INT, @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @Code VARCHAR(30), @PartnerId INT, @CommType VARCHAR(5), @CommValue DECIMAL(12,2), @Won DECIMAL(18,2);
    SELECT @Code = s.Code, @PartnerId = l.PartnerId, @CommType = l.CommType, @CommValue = l.CommValue, @Won = l.WonValue
    FROM dbo.tblLeads l JOIN dbo.tblLookup s ON s.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    IF @Code IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    BEGIN TRAN;
    DECLARE @LiveId INT, @LiveStatus VARCHAR(10);
    SELECT @LiveId = Id, @LiveStatus = Status
    FROM dbo.tblPartnerCommission WITH (UPDLOCK, HOLDLOCK)
    WHERE LeadId = @LeadId AND CompId = @CompId AND Status <> 'cancelled' AND Reverted = 0;

    IF @Code = 'converted' AND @PartnerId IS NOT NULL AND @CommType IS NOT NULL
    BEGIN
        DECLARE @Amount DECIMAL(14,2) = CASE @CommType
            WHEN 'pct' THEN ROUND(ISNULL(@Won, 0) * @CommValue / 100, 2) ELSE @CommValue END;
        IF @LiveId IS NULL
        BEGIN
            DECLARE @DueOn VARCHAR(10) = ISNULL((SELECT CommissionDueOn FROM dbo.tblCompanySetting WHERE CompId = @CompId), 'manual');
            INSERT INTO dbo.tblPartnerCommission
                (CompId, LeadId, PartnerId, BaseValue, CommType, CommValue, Amount, Status, EarnedAt, DueAt, DueBy)
            VALUES (@CompId, @LeadId, @PartnerId, @Won, @CommType, @CommValue, @Amount,
                    CASE @DueOn WHEN 'convert' THEN 'due' ELSE 'earned' END, GETDATE(),
                    CASE @DueOn WHEN 'convert' THEN GETDATE() END,
                    CASE @DueOn WHEN 'convert' THEN @UserId END);
        END
        ELSE IF @LiveStatus IN ('earned','due')
            UPDATE dbo.tblPartnerCommission
            SET PartnerId = @PartnerId, BaseValue = @Won, CommType = @CommType, CommValue = @CommValue, Amount = @Amount
            WHERE Id = @LiveId;
    END
    ELSE IF @LiveId IS NOT NULL
    BEGIN
        IF @LiveStatus = 'paid'
            UPDATE dbo.tblPartnerCommission SET Reverted = 1 WHERE Id = @LiveId;
        ELSE
            UPDATE dbo.tblPartnerCommission SET Status = 'cancelled', CancelledAt = GETDATE() WHERE Id = @LiveId;
    END
    COMMIT;
    SELECT @LeadId AS Id, 200 AS ResponseCode, 'Commission in step' AS ResponseMess;
END
GO

-- Sets (or clears) the lead's partner and terms, then syncs the commission.
--   @SetTerms = 1: the caller may decide terms (partners view) — take @CommType/@CommValue.
--   @SetTerms = 0: terms are the partner's usual rule when the partner changes,
--                  and stay as they are when it does not.
-- Refused when the live commission is already paid and the partner or terms would change.
CREATE OR ALTER PROC dbo.sp_SetLeadPartner
    @CompId INT, @LeadId INT, @UserId INT,
    @PartnerId INT = NULL, @CommType VARCHAR(5) = NULL, @CommValue DECIMAL(12,2) = NULL, @SetTerms BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @OldPartner INT, @OldType VARCHAR(5), @OldValue DECIMAL(12,2), @Found BIT = 0;
    SELECT @Found = 1, @OldPartner = PartnerId, @OldType = CommType, @OldValue = CommValue
    FROM dbo.tblLeads WHERE Id = @LeadId AND CompId = @CompId;
    IF @Found = 0
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    IF @PartnerId IS NOT NULL AND ISNULL(@OldPartner, 0) <> @PartnerId AND NOT EXISTS (
        SELECT 1 FROM dbo.tblPartner WHERE Id = @PartnerId AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Pick an active partner' AS ResponseMess; RETURN; END

    DECLARE @NewType VARCHAR(5), @NewValue DECIMAL(12,2);
    IF @PartnerId IS NULL
        SELECT @NewType = NULL, @NewValue = NULL;
    ELSE IF @SetTerms = 1
        SELECT @NewType = @CommType, @NewValue = CASE WHEN @CommType IS NULL THEN NULL ELSE @CommValue END;
    ELSE IF ISNULL(@OldPartner, 0) <> @PartnerId
        SELECT @NewType = CommType, @NewValue = CommValue FROM dbo.tblPartner WHERE Id = @PartnerId;
    ELSE
        SELECT @NewType = @OldType, @NewValue = @OldValue;

    IF @NewType IS NOT NULL AND (@NewType NOT IN ('pct','fixed') OR @NewValue IS NULL OR @NewValue < 0
                                 OR (@NewType = 'pct' AND @NewValue > 100))
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Commission must be a percent from 0 to 100 or an amount of 0 or more' AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblPartnerCommission WHERE LeadId = @LeadId AND CompId = @CompId
                 AND Status = 'paid' AND Reverted = 0)
       AND (ISNULL(@OldPartner, 0) <> ISNULL(@PartnerId, 0) OR ISNULL(@OldType, '') <> ISNULL(@NewType, '')
            OR ISNULL(@OldValue, -1) <> ISNULL(@NewValue, -1))
    BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'The commission for this lead is already paid, so its partner and commission cannot change' AS ResponseMess; RETURN; END

    IF ISNULL(@OldPartner, 0) = ISNULL(@PartnerId, 0) AND ISNULL(@OldType, '') = ISNULL(@NewType, '')
       AND ISNULL(@OldValue, -1) = ISNULL(@NewValue, -1)
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'No change' AS ResponseMess; RETURN; END

    DECLARE @PartnerSource INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                                  WHERE CompId = @CompId AND Kind = 'lead_source' AND Code = 'partner' AND IsActive = 1);
    BEGIN TRAN;
    UPDATE dbo.tblLeads
    SET PartnerId = @PartnerId, CommType = @NewType, CommValue = @NewValue,
        SourceId = CASE WHEN @PartnerId IS NOT NULL AND @PartnerSource IS NOT NULL THEN @PartnerSource ELSE SourceId END,
        EditBy = @UserId, UpdatedAt = GETDATE()
    WHERE Id = @LeadId AND CompId = @CompId;

    DECLARE @PartnerName NVARCHAR(200) = (SELECT Name FROM dbo.tblPartner WHERE Id = @PartnerId);
    DECLARE @Summary NVARCHAR(500) = CASE WHEN @PartnerId IS NULL THEN N'Partner removed' ELSE N'Partner: ' + @PartnerName END;
    DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
    INSERT INTO @actLog
    EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
         @Type = 'partner', @Summary = @Summary, @MetaJSON = NULL;
    COMMIT;

    DECLARE @sync TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
    INSERT INTO @sync EXEC dbo.sp_SyncPartnerCommission @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId;
    SELECT @LeadId AS Id, 200 AS ResponseCode, 'Partner saved' AS ResponseMess;
END
GO

CREATE OR ALTER PROC dbo.sp_FetchLeadPartner @CompId INT, @LeadId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.PartnerId, p.Name AS PartnerName, l.CommType, l.CommValue
    FROM dbo.tblLeads l LEFT JOIN dbo.tblPartner p ON p.Id = l.PartnerId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    SELECT c.Id, c.PartnerId, p.Name AS PartnerName, c.BaseValue, c.CommType, c.CommValue, c.Amount,
           c.Status, c.Reverted, c.EarnedAt, c.DueAt, c.PaidAt, c.PaidRef
    FROM dbo.tblPartnerCommission c JOIN dbo.tblPartner p ON p.Id = c.PartnerId
    WHERE c.LeadId = @LeadId AND c.CompId = @CompId
    ORDER BY c.Id DESC;
END
GO
```

Before writing `sp_SetLeadPartner`, confirm `sp_LogLeadActivity`'s parameter names against the live proc (`SELECT name FROM [TestCRM].sys.parameters WHERE object_id = OBJECT_ID('[TestCRM].dbo.sp_LogLeadActivity')`) and adjust the call if they differ — `tblLeadActivity.Type` has no CHECK constraint (checked 2026-10-10).

- [ ] **Step 4: Commission list, mark procs, setting**

```sql
CREATE OR ALTER PROC dbo.sp_FetchCommissions
    @CompId INT, @PartnerId INT = NULL, @Status VARCHAR(10) = NULL, @FromDate DATE = NULL, @ToDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.Id, c.LeadId, l.Name AS LeadName, c.PartnerId, p.Name AS PartnerName,
           c.BaseValue, c.CommType, c.CommValue, c.Amount, c.Status, c.Reverted,
           c.EarnedAt, c.DueAt, c.PaidAt, c.PaidRef
    FROM dbo.tblPartnerCommission c
    JOIN dbo.tblPartner p ON p.Id = c.PartnerId
    JOIN dbo.tblLeads   l ON l.Id = c.LeadId
    WHERE c.CompId = @CompId
      AND (@PartnerId IS NULL OR c.PartnerId = @PartnerId)
      AND (@Status IS NULL OR c.Status = @Status)
      AND (@FromDate IS NULL OR c.EarnedAt >= @FromDate)
      AND (@ToDate   IS NULL OR c.EarnedAt < DATEADD(DAY, 1, @ToDate))
    ORDER BY CASE c.Status WHEN 'due' THEN 0 WHEN 'earned' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END, c.EarnedAt DESC;
    SELECT ISNULL((SELECT CommissionDueOn FROM dbo.tblCompanySetting WHERE CompId = @CompId), 'manual') AS CommissionDueOn;
END
GO

-- Both mark procs carry the required status in their own WHERE, so the test and
-- the write are one statement: two people pressing at once change a row once.
CREATE OR ALTER PROC dbo.sp_MarkCommissionDue @CompId INT, @UserId INT, @IdsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE c SET Status = 'due', DueAt = GETDATE(), DueBy = @UserId
    FROM dbo.tblPartnerCommission c
    JOIN OPENJSON(@IdsJson) WITH (Id INT '$') j ON j.Id = c.Id
    WHERE c.CompId = @CompId AND c.Status = 'earned';
    DECLARE @n INT = @@ROWCOUNT;
    IF @n = 0
    BEGIN SELECT 0 AS Id, 409 AS ResponseCode, 'Nothing changed: these are not waiting to be marked ready' AS ResponseMess; RETURN; END
    SELECT @n AS Id, 200 AS ResponseCode, CONCAT(@n, ' marked ready to pay') AS ResponseMess;
END
GO

CREATE OR ALTER PROC dbo.sp_MarkCommissionPaid
    @CompId INT, @UserId INT, @IdsJson NVARCHAR(MAX), @PaidAt DATE, @PaidRef NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @PaidAt IS NULL
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Payment date is required' AS ResponseMess; RETURN; END
    UPDATE c SET Status = 'paid', PaidAt = @PaidAt, PaidBy = @UserId, PaidRef = NULLIF(LTRIM(RTRIM(@PaidRef)), N'')
    FROM dbo.tblPartnerCommission c
    JOIN OPENJSON(@IdsJson) WITH (Id INT '$') j ON j.Id = c.Id
    WHERE c.CompId = @CompId AND c.Status = 'due';
    DECLARE @n INT = @@ROWCOUNT;
    IF @n = 0
    BEGIN SELECT 0 AS Id, 409 AS ResponseCode, 'Nothing changed: these are already paid or not ready to pay' AS ResponseMess; RETURN; END
    SELECT @n AS Id, 200 AS ResponseCode, CONCAT(@n, ' marked paid') AS ResponseMess;
END
GO

CREATE OR ALTER PROC dbo.sp_SavePartnerSetting @CompId INT, @CommissionDueOn VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    IF @CommissionDueOn NOT IN ('manual','convert')
    BEGIN SELECT @CompId AS Id, 400 AS ResponseCode, 'Choose when commission becomes payable' AS ResponseMess; RETURN; END
    UPDATE dbo.tblCompanySetting SET CommissionDueOn = @CommissionDueOn, UpdatedAt = GETDATE() WHERE CompId = @CompId;
    IF @@ROWCOUNT = 0
        INSERT INTO dbo.tblCompanySetting (CompId, CommissionDueOn) VALUES (@CompId, @CommissionDueOn);
    SELECT @CompId AS Id, 200 AS ResponseCode, 'Saved' AS ResponseMess;
END
GO
```

Before the INSERT fallback in `sp_SavePartnerSetting`, check that every other `tblCompanySetting` column is nullable or has a default (`[TestCRM].INFORMATION_SCHEMA.COLUMNS`); if one is NOT NULL without a default, insert the same defaults `sp_SaveCompanySetting` uses.

- [ ] **Step 5: `sp_FetchLeads` — partner filter + column, creator arm removed**

Read the live definition (`SELECT definition FROM [TestCRM].sys.sql_modules WHERE object_id = OBJECT_ID('[TestCRM].dbo.sp_FetchLeads')`) and paste it into the script as `CREATE OR ALTER PROC dbo.sp_FetchLeads` with exactly these changes and nothing else:
1. New last parameter `@PartnerId INT = NULL`.
2. In every WHERE that has `AND (@SourceId IS NULL OR l.SourceId = @SourceId)`, add on the next line `AND (@PartnerId IS NULL OR l.PartnerId = @PartnerId)` (the count and the page queries both).
3. Replace both occurrences of `(l.OwnerId = @UserId OR l.CreatedBy = @UserId)` with `(l.OwnerId = @UserId)`.
4. In the result-set-1 SELECT add `l.PartnerId, pr.Name AS PartnerName,` and `LEFT JOIN dbo.tblPartner pr ON pr.Id = l.PartnerId` beside the other lookups' joins.

- [ ] **Step 6: `sp_RptPartners` on the shared report contract**

Read `sp_RptFunnel` live and model this proc on it: same 12 parameters in the same order (`@CompId, @FromDate, @ToDate, @DateBasis, @BranchId, @OwnerId, @SourceId, @ProductId, @GroupBy, @UserId, @AccessibleBranchIdsJson, @OwnerIdsJson`), the same GroupBy RAISERROR guard (allowed: `partner` only), the same date-basis handling (`created` = `l.CreatedAt`; `closed` = `l.WonAt`; `activity` = as Funnel does), and the same scope predicate **with the creator arm already removed** (`OR (@UserId IS NOT NULL AND l.OwnerId = @UserId)`). The lead set is the scoped, filtered, in-range leads with `l.PartnerId IS NOT NULL`. Output:
- RS1 (one row): `LeadsSent INT, Converted INT, ConversionPct DECIMAL(5,1), WonValue DECIMAL(18,2), Earned DECIMAL(14,2), Due DECIMAL(14,2), Paid DECIMAL(14,2)`
- RS2 (one row per partner, ordered by `LeadsSent DESC`): `GroupKey` (= PartnerId), `GroupLabel` (= partner name), then the same seven columns.
- RS3: `Bucket` (week start, as Funnel buckets) and `LeadsSent`, `Converted`.
Commission sums come from `tblPartnerCommission` rows of those leads: `Earned` = status earned, `Due` = due, `Paid` = paid (Reverted included — it was paid). `Converted` counts `converted` status; `WonValue` sums `l.WonValue` of converted leads; `ConversionPct` = Converted × 100 / NULLIF(LeadsSent, 0), ISNULL → 0.

- [ ] **Step 7: Visibility fix in every other lead-scoped proc**

```sql
-- 107 §6: a lead is always visible to its current OWNER only; the creator arm
-- goes. Each proc is re-created from its own live text with exactly that
-- string removed — nothing else changes. DDL is transactional, so a failed
-- re-create leaves the old proc in place.
DECLARE @procs TABLE (name SYSNAME);
INSERT INTO @procs VALUES (N'sp_Dashboard'), (N'sp_FetchQuotations'), (N'sp_FetchFollowUps'),
    (N'sp_RptFunnel'), (N'sp_RptLost'), (N'sp_RptPipelineValue'), (N'sp_RptFollowUpCompliance'),
    (N'sp_RptActivity'), (N'sp_RptLeaderboard'), (N'sp_RptAging'), (N'sp_RptTransfers');
DECLARE @p SYSNAME, @def NVARCHAR(MAX), @drop NVARCHAR(400);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @procs;
OPEN c; FETCH NEXT FROM c INTO @p;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @p));
    IF @def IS NOT NULL AND CHARINDEX(N' OR l.CreatedBy = @UserId', @def) > 0
    BEGIN
        SET @def = REPLACE(@def, N' OR l.CreatedBy = @UserId', N'');
        SET @drop = N'DROP PROCEDURE dbo.' + QUOTENAME(@p);
        BEGIN TRY
            BEGIN TRAN;
            EXEC (@drop);
            EXEC (@def);
            COMMIT;
            PRINT N'creator arm removed: ' + @p;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            PRINT N'FAILED, left as it was: ' + @p + N' — ' + ERROR_MESSAGE();
            THROW;
        END CATCH
    END
    FETCH NEXT FROM c INTO @p;
END
CLOSE c; DEALLOCATE c;
GO
```

- [ ] **Step 8: Verify block (end of file)**

```sql
-- VERIFY AFTER APPLY (TestCRM):
-- 1. No lead proc keeps the creator arm (expect 0 rows):
--    SELECT o.name FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
--    WHERE m.definition LIKE '%l.CreatedBy = @UserId%';
-- 2. Tables / columns exist:
--    SELECT OBJECT_ID('dbo.tblPartner'), OBJECT_ID('dbo.tblPartnerCommission'),
--           COL_LENGTH('dbo.tblLeads','PartnerId'), COL_LENGTH('dbo.tblCompanySetting','CommissionDueOn');
-- 3. Partner source and menus:
--    SELECT CompId, Value FROM tblLookup WHERE Kind = 'lead_source' AND Code = 'partner';
--    SELECT Id, ParentId, Description, Route, Module FROM tblMenu WHERE Route IN ('/sales/partners','/reports/partners');
-- 4. Commission round trip on a throwaway partner (run inside BEGIN TRAN … ROLLBACK):
--    BEGIN TRAN;
--    DECLARE @lead INT = (SELECT TOP 1 l.Id FROM tblLeads l JOIN tblLookup s ON s.Id = l.StatusId WHERE s.Code = 'converted');
--    INSERT tblPartner (CompId, Name, CreatedBy) VALUES (1, N'Verify partner', 1);
--    EXEC sp_SetLeadPartner 1, @lead, 1, @@IDENTITY, 'pct', 10, 1;      -- expect 200
--    SELECT Status, Amount FROM tblPartnerCommission WHERE LeadId = @lead;  -- earned, 10% of WonValue (0.00 if WonValue is NULL)
--    DECLARE @cid NVARCHAR(20) = (SELECT CONCAT('[', MAX(Id), ']') FROM tblPartnerCommission WHERE LeadId = @lead);
--    EXEC sp_MarkCommissionDue 1, 1, @cid;                                   -- 200
--    EXEC sp_MarkCommissionPaid 1, 1, @cid, '2026-10-10', N'UTR1';           -- 200
--    EXEC sp_MarkCommissionPaid 1, 1, @cid, '2026-10-10', N'UTR1';           -- 409, not a second payment
--    EXEC sp_SetLeadPartner 1, @lead, 1, NULL, NULL, NULL, 1;                -- 409, already paid
--    ROLLBACK;
```

- [ ] **Step 9: Hand over**

No commit. Report to the controller: the script path and the three apply commands (TestCRM first). The user applies it before Tasks 2–5 are verified against the live DB.

---

### Task 2: Backend — moving a lead really moves it

**Files:**
- Modify: `backend/src/middleware/permission.js` (`canSeeRecord`, ~line 146)
- Modify: `backend/ROLES.md`, `CLAUDE.md` §3 "Universal rule" bullet
- Test: `backend/tests/unit/middleware/permission.test.js` (existing — add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `canSeeRecord(req, record, ownerField)` unchanged signature; the creator rule now applies only when `ownerField === "AssignedTo"` (tickets).

- [ ] **Step 1: Write the failing tests**

Add to the existing `canSeeRecord` describe block in `backend/tests/unit/middleware/permission.test.js` (reuse its existing `req` builder; shape shown here):

```js
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

  it("keeps the creator rule for complaints", () => {
    expect(canSeeRecord(ownOnly(7), { AssignedTo: 9, CreatedBy: 7, BranchId: 1 }, "AssignedTo")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see the first case fail**

Run: `cd backend && pnpm exec jest tests/unit/middleware/permission.test.js -t "moved lead"`
Expected: FAIL — "hides a lead from its creator" gets `true`.

- [ ] **Step 3: Implement**

In `canSeeRecord` replace the always-visible block with:

```js
  // Always-visible rule: assigned to me beats scope. For complaints the person
  // who logged it keeps it too; a lead's creator does not — moving a lead to
  // someone else really moves it (spec 2026-10-10 §6).
  const creatorKeeps = ownerField === "AssignedTo";
  if (owner === userId || (creatorKeeps && createdBy === userId)) return true;
```

Update the comment above `assertRecordAccess` ("assigned/created-by-caller always wins") to "assigned-to-caller always wins (and created-by for complaints)".

- [ ] **Step 4: Search for other lead creator checks**

Run: `grep -rn "CreatedBy" backend/src/controllers/leadController.js backend/src/controllers/followupController.js backend/src/controllers/callController.js backend/src/controllers/quotationController.js`
Any check that grants a **lead** to `CreatedBy === UserId` is removed the same way, with a test. Report what was found (expected: none).

- [ ] **Step 5: Docs**

`backend/ROLES.md` and `CLAUDE.md` §3: change the universal rule to: "a record `AssignedTo`/`OwnerId` = the caller is always visible (complaints: also `CreatedBy`), OR-ed against reach. A lead's creator loses it once it is moved (107)."

- [ ] **Step 6: Run and check coverage**

Run: `cd backend && pnpm exec jest tests/unit/middleware --coverage --collectCoverageFrom='src/middleware/permission.js'`
Expected: PASS, permission.js ≥ 80% lines and branches.

---

### Task 3: Backend — partners module, partner and commission endpoints

**Files:**
- Modify: `backend/src/middleware/access.js` (MODULES)
- Create: `backend/src/controllers/partnerController.js`
- Create: `backend/src/routes/partnerRoutes.js`
- Modify: `backend/src/config/routes.js` (register `/api/partners`)
- Test: `backend/tests/unit/controllers/partnerController.test.js`

**Interfaces:**
- Consumes: Task 1 procs.
- Produces (all POST under `/api/partners`):
  - `fetchPartners` body `{ IncludeInactive? }` → `data.partners` — `requireModule("partners","view")`
  - `savePartner` body `{ Id?, Name, ContactPerson?, Mobile?, Email?, City?, Notes?, CommType?, CommValue?, IsActive? }` → status — `requireModule("partners", saveAction)`
  - `fetchPartnerPicker` body `{}` → `data.partners` `[{Id, Name, City}]` — `requireModule("leads","view")`
  - `fetchCommissions` body `{ PartnerId?, Status?, FromDate?, ToDate? }` → `data.commissions`, `data.commissionDueOn` — `requireModule("partners","view")`
  - `markCommissionDue` body `{ Ids: number[] }` — `requireModule("partners","edit")`
  - `markCommissionPaid` body `{ Ids: number[], PaidAt: "YYYY-MM-DD", PaidRef? }` — `requireModule("partners","edit")`
  - `savePartnerSetting` body `{ CommissionDueOn: "manual"|"convert" }` — `requireModule("partners","edit")`

- [ ] **Step 1: Add the module**

`backend/src/middleware/access.js`: append `"partners"` to `MODULES`. It is not a reach module (company-wide). Existing access tests must still pass.

- [ ] **Step 2: Write the failing controller tests**

Model on the existing controller suites (`jest.mock("../../../src/config/database")`, `tests/helpers/mockRes.js`). Cases (each one `it`):

```js
const database = require("../../../src/config/database");
jest.mock("../../../src/config/database");
const c = require("../../../src/controllers/partnerController");
const { mockRes } = require("../../helpers/mockRes");
const req = (body = {}) => ({ body, user: { CompId: 1, UserId: 5 } });
const ok = (row = { Id: 1, ResponseCode: 200, ResponseMess: "ok" }) => ({ recordset: [row], recordsets: [[row]] });

describe("partnerController", () => {
  beforeEach(() => jest.resetAllMocks());

  it("savePartner normalises a mobile and passes the terms through", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    const res = mockRes();
    await c.savePartner(req({ Name: "Sharma Traders", Mobile: "+91 98250 12345", CommType: "pct", CommValue: 10 }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SavePartner", expect.objectContaining({
      Id: 0, CompId: 1, UserId: 5, Name: "Sharma Traders", Mobile: "9825012345", CommType: "pct", CommValue: 10 }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("savePartner 400s a bad mobile before the DB", async () => {
    const res = mockRes();
    await c.savePartner(req({ Name: "X", Mobile: "12345" }), res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("savePartner 400s a percent over 100 and terms without a type", async () => {
    for (const body of [{ Name: "X", CommType: "pct", CommValue: 120 }, { Name: "X", CommValue: 5 }]) {
      const res = mockRes();
      await c.savePartner(req(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("savePartner surfaces the duplicate-mobile 409", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok({ Id: 0, ResponseCode: 409, ResponseMess: "Another partner already has this mobile number" }));
    const res = mockRes();
    await c.savePartner(req({ Name: "X", Mobile: "9825012345" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("markCommissionPaid needs ids and a real date", async () => {
    for (const body of [{ Ids: [], PaidAt: "2026-10-10" }, { Ids: [1], PaidAt: "2026-02-30" }]) {
      const res = mockRes();
      await c.markCommissionPaid(req(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it("markCommissionPaid sends ids as JSON and passes a 409 through (second click)", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok({ Id: 0, ResponseCode: 409, ResponseMess: "Nothing changed: these are already paid or not ready to pay" }));
    const res = mockRes();
    await c.markCommissionPaid(req({ Ids: [4, 4, "x", 7], PaidAt: "2026-10-10", PaidRef: "UTR1" }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_MarkCommissionPaid",
      { CompId: 1, UserId: 5, IdsJson: "[4,7]", PaidAt: "2026-10-10", PaidRef: "UTR1" });
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("fetchCommissions returns rows and the setting", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 1, Amount: 0 }], [{ CommissionDueOn: "manual" }]] });
    const res = mockRes();
    await c.fetchCommissions(req({ Status: "due" }), res);
    const body = res.json.mock.calls[0][0];
    expect(body.data).toEqual({ commissions: [{ Id: 1, Amount: 0 }], commissionDueOn: "manual" });
  });

  it("fetchCommissions 400s an unknown status", async () => {
    const res = mockRes();
    await c.fetchCommissions(req({ Status: "lost" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("savePartnerSetting accepts only manual|convert", async () => {
    const res = mockRes();
    await c.savePartnerSetting(req({ CommissionDueOn: "later" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
```

Adjust helper import names to what `tests/helpers/mockRes.js` actually exports.

- [ ] **Step 3: Run to see them fail**

Run: `cd backend && pnpm exec jest partnerController`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the controller**

```js
// src/controllers/partnerController.js
//
// Partners (company-wide, the `partners` module) and their commission. Commission
// rows are written by sp_SyncPartnerCommission (after lead writes) and the two
// mark procs here; nothing else.
const database = require("../config/database");
const { asyncRoute, positiveInt } = require("../utils/controllerKit");
const { success, error, validationError } = require("../utils/responseHelper");
const { applyMobiles } = require("../utils/mobile");
const { parseDay } = require("../utils/reportKit");

const STATUSES = ["earned", "due", "paid", "cancelled"];
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());

// Same rule the SP enforces; checked here so a typo is a 400, not a round trip.
function termsError(CommType, CommValue) {
  if (CommType == null && CommValue == null) return null;
  const v = Number(CommValue);
  if (!["pct", "fixed"].includes(CommType) || CommValue == null || !Number.isFinite(v) || v < 0 || (CommType === "pct" && v > 100)) {
    return "Commission must be a percent from 0 to 100 or an amount of 0 or more";
  }
  return null;
}

const idsJson = (ids) => JSON.stringify([...new Set((Array.isArray(ids) ? ids : []).map(positiveInt).filter(Boolean))]);

const reply = (res, row) => (row?.ResponseCode === 200
  ? success(res, row.ResponseMess, row)
  : error(res, row?.ResponseMess || "Request failed", "SP_ERROR", row?.ResponseCode || 500));
const firstRow = (result) => result?.recordset?.[0] ?? result?.recordsets?.[0]?.[0];

module.exports = {
  termsError,

  fetchPartners: asyncRoute(async (req, res) => {
    const result = await database.executeStoredProcedure("sp_FetchPartners", {
      CompId: req.user.CompId, IncludeInactive: req.body.IncludeInactive ? 1 : 0 });
    return success(res, "Partners fetched", { partners: result.recordsets?.[0] ?? [] });
  }, "Failed to fetch partners", "PARTNERS_FETCH_ERROR"),

  fetchPartnerPicker: asyncRoute(async (req, res) => {
    const result = await database.executeStoredProcedure("sp_FetchPartnerPicker", { CompId: req.user.CompId });
    return success(res, "Partners fetched", { partners: result.recordsets?.[0] ?? [] });
  }, "Failed to fetch partners", "PARTNER_PICKER_ERROR"),

  savePartner: asyncRoute(async (req, res) => {
    const b = req.body;
    const fields = { Mobile: text(b.Mobile) };
    const mobileError = applyMobiles(fields, [["Mobile", "Mobile number"]]);
    if (mobileError) return validationError(res, mobileError);
    if (!text(b.Name)) return validationError(res, "Partner name is required");
    const CommType = text(b.CommType);
    const CommValue = b.CommValue == null || b.CommValue === "" ? null : Number(b.CommValue);
    const bad = termsError(CommType, CommValue);
    if (bad) return validationError(res, bad);
    const result = await database.executeStoredProcedure("sp_SavePartner", {
      Id: positiveInt(b.Id) ?? 0, CompId: req.user.CompId, UserId: req.user.UserId,
      Name: text(b.Name), ContactPerson: text(b.ContactPerson), Mobile: fields.Mobile,
      Email: text(b.Email), City: text(b.City), Notes: text(b.Notes),
      CommType, CommValue, IsActive: b.IsActive === false || b.IsActive === 0 ? 0 : 1,
    });
    return reply(res, firstRow(result));
  }, "Failed to save partner", "PARTNER_SAVE_ERROR"),

  fetchCommissions: asyncRoute(async (req, res) => {
    const { PartnerId, Status, FromDate, ToDate } = req.body;
    if (Status != null && !STATUSES.includes(Status)) return validationError(res, `Status must be one of ${STATUSES.join(", ")}`);
    const day = (s) => (s && parseDay(s) ? s : null);
    const result = await database.executeStoredProcedure("sp_FetchCommissions", {
      CompId: req.user.CompId, PartnerId: positiveInt(PartnerId), Status: Status ?? null,
      FromDate: day(FromDate), ToDate: day(ToDate),
    });
    const [rows = [], setting = []] = result.recordsets ?? [];
    return success(res, "Commissions fetched", { commissions: rows, commissionDueOn: setting[0]?.CommissionDueOn ?? "manual" });
  }, "Failed to fetch commissions", "COMMISSIONS_FETCH_ERROR"),

  markCommissionDue: asyncRoute(async (req, res) => {
    const IdsJson = idsJson(req.body.Ids);
    if (IdsJson === "[]") return validationError(res, "Pick at least one commission");
    const result = await database.executeStoredProcedure("sp_MarkCommissionDue", { CompId: req.user.CompId, UserId: req.user.UserId, IdsJson });
    return reply(res, firstRow(result));
  }, "Failed to mark ready to pay", "COMMISSION_DUE_ERROR"),

  markCommissionPaid: asyncRoute(async (req, res) => {
    const IdsJson = idsJson(req.body.Ids);
    if (IdsJson === "[]") return validationError(res, "Pick at least one commission");
    if (!parseDay(req.body.PaidAt)) return validationError(res, "Payment date must be YYYY-MM-DD");
    const result = await database.executeStoredProcedure("sp_MarkCommissionPaid", {
      CompId: req.user.CompId, UserId: req.user.UserId, IdsJson, PaidAt: req.body.PaidAt, PaidRef: text(req.body.PaidRef) });
    return reply(res, firstRow(result));
  }, "Failed to mark paid", "COMMISSION_PAID_ERROR"),

  savePartnerSetting: asyncRoute(async (req, res) => {
    const { CommissionDueOn } = req.body;
    if (!["manual", "convert"].includes(CommissionDueOn)) return validationError(res, "Choose when commission becomes payable");
    const result = await database.executeStoredProcedure("sp_SavePartnerSetting", { CompId: req.user.CompId, CommissionDueOn });
    return reply(res, firstRow(result));
  }, "Failed to save setting", "PARTNER_SETTING_ERROR"),
};
```

Check `asyncRoute`'s real signature in `utils/controllerKit.js` and `validationError`'s in `responseHelper.js` (the work-settings controller uses both) and match them exactly. `applyMobiles` with a `null` Mobile must leave it null — confirm against `utils/mobile.js`.

- [ ] **Step 5: Routes**

```js
// src/routes/partnerRoutes.js
const express = require("express");
const c = require("../controllers/partnerController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, saveAction } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();
router.use(verifyToken, loadScope);

router.post("/fetchPartners", allowEmptyPayload, requireModule("partners", "view"), c.fetchPartners);
router.post("/savePartner", requirePayload, requireModule("partners", saveAction), c.savePartner);
// Anyone who works leads picks a partner; names only.
router.post("/fetchPartnerPicker", allowEmptyPayload, requireModule("leads", "view"), c.fetchPartnerPicker);
router.post("/fetchCommissions", allowEmptyPayload, requireModule("partners", "view"), c.fetchCommissions);
router.post("/markCommissionDue", requirePayload, requireModule("partners", "edit"), c.markCommissionDue);
router.post("/markCommissionPaid", requirePayload, requireModule("partners", "edit"), c.markCommissionPaid);
router.post("/savePartnerSetting", requirePayload, requireModule("partners", "edit"), c.savePartnerSetting);

module.exports = router;
```

Register in `src/config/routes.js` as `/api/partners`, following how `leadRoutes` is mounted.

- [ ] **Step 6: Run tests + route access + coverage**

Run: `cd backend && pnpm exec jest partnerController routeAccess access --coverage --collectCoverageFrom='src/controllers/partnerController.js'`
Expected: PASS, ≥80% lines/branches.

---

### Task 4: Backend — partner on the lead (save, fetch, detail, sync hooks)

**Files:**
- Create: `backend/src/services/partnerService.js`
- Modify: `backend/src/controllers/leadController.js` (`runSp`, `save`, `fetch`, `setStatus`, `convert`, new `partner`)
- Modify: `backend/src/routes/leadRoutes.js` (`fetchLeadPartner`)
- Test: `backend/tests/unit/services/partnerService.test.js`, `backend/tests/unit/controllers/leadController.test.js` (existing — add cases)

**Interfaces:**
- Consumes: `sp_SetLeadPartner`, `sp_SyncPartnerCommission`, `sp_FetchLeadPartner`, `sp_FetchLeads @PartnerId`; `scopeFor(req, "partners")` from `middleware/permission`.
- Produces:
  - `partnerService.syncCommission(CompId, LeadId, UserId) → Promise<void>` (never throws; logs)
  - `POST /api/leads/saveLeads` accepts optional `PartnerId`, `CommType`, `CommValue`; when the body has the key `PartnerId` the partner is set after the save.
  - `POST /api/leads/fetchLeads` accepts `PartnerId`; rows carry `PartnerId, PartnerName`.
  - `POST /api/leads/fetchLeadPartner` body `{ LeadId }` → `data: { partner: {PartnerId, PartnerName, CommType?, CommValue?} | null, commissions: [...] }` — terms and commissions only when the caller has `partners` view (else `CommType`/`CommValue` absent and `commissions: []`).

- [ ] **Step 1: Failing tests — service**

```js
const database = require("../../../src/config/database");
jest.mock("../../../src/config/database");
const { syncCommission } = require("../../../src/services/partnerService");

it("calls the sync proc with the lead", async () => {
  database.executeStoredProcedure.mockResolvedValue({ recordset: [{ ResponseCode: 200 }] });
  await syncCommission(1, 42, 5);
  expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SyncPartnerCommission", { CompId: 1, LeadId: 42, UserId: 5 });
});

it("never throws — a failed sync is logged and fixed by the next lead write", async () => {
  database.executeStoredProcedure.mockRejectedValue(new Error("db down"));
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  await expect(syncCommission(1, 42, 5)).resolves.toBeUndefined();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
```

- [ ] **Step 2: Failing tests — lead controller** (add to the existing suite; reuse its mocks for `assertRecordAccess`/`scopeFor`)

1. `save` with `PartnerId: 3, CommType: "pct", CommValue: 10` by a caller **with** partners view → after `sp_SaveLead` (returns Id 42) calls `sp_SetLeadPartner` with `{ CompId, LeadId: 42, UserId, PartnerId: 3, CommType: "pct", CommValue: 10, SetTerms: 1 }`; responds 200.
2. Same body by a caller **without** partners view → `SetTerms: 0, CommType: null, CommValue: null`.
3. `save` without the `PartnerId` key → `sp_SetLeadPartner` not called.
4. `save` where `sp_SetLeadPartner` answers 409 (paid) → response 409 with that message (lead fields were saved; the message says the partner could not change).
5. `save` with `PartnerId: 3, CommType: "pct", CommValue: 150` (partners view) → 400 before any DB call.
6. `convert` success → `sp_SyncPartnerCommission` called with the LeadId; a convert that the SP refuses (400) → no sync.
7. `setStatus` success → sync called.
8. `fetch` passes `PartnerId: 3` through to `sp_FetchLeads` (positive int only; `"x"` → null).
9. `partner` (fetchLeadPartner): without partners view → `{ partner: { PartnerId: 3, PartnerName: "Sharma" }, commissions: [] }` (no CommType/CommValue keys); with view → full row + commissions; a lead the caller cannot see → 404 via `assertRecordAccess`.

- [ ] **Step 3: Run to see them fail**

Run: `cd backend && pnpm exec jest partnerService leadController`
Expected: FAIL.

- [ ] **Step 4: Implement**

`src/services/partnerService.js`:

```js
// Keeps a lead's commission row in step with the lead (spec 2026-10-10 §3).
// Called after the lead write commits, like tatService.afterTaskWrite: the
// proc is idempotent, so a failure here is logged and the next write of the
// same lead puts it right.
const database = require("../config/database");

async function syncCommission(CompId, LeadId, UserId) {
  try {
    await database.executeStoredProcedure("sp_SyncPartnerCommission", { CompId, LeadId, UserId });
  } catch (err) {
    console.error(`sp_SyncPartnerCommission lead ${LeadId} failed:`, err);
  }
}

module.exports = { syncCommission };
```

`leadController.js`:
- `runSp(res, spName, params, failMessage, after)` — when `ResponseCode === 200` and `after` is given, `const override = await after(spResponse); if (override) return override;` before the success reply. `after` returns a response (to replace the success) or nothing.
- `save`: compute partner args before the DB:
  ```js
  const partnerSent = Object.prototype.hasOwnProperty.call(req.body, "PartnerId");
  const canTerms = scopeFor(req, "partners").can.view;
  const PartnerId = positiveInt(req.body.PartnerId);
  const CommType = canTerms && PartnerId ? (req.body.CommType ?? null) : null;
  const CommValue = CommType == null ? null : Number(req.body.CommValue);
  if (partnerSent && canTerms) {
    const bad = termsError(CommType, CommValue);   // from partnerController
    if (bad) return responseHelper.validationError(res, bad);
  }
  ```
  and pass `after` to `runSp`:
  ```js
  async (row) => {
    if (!partnerSent) return null;
    const r = await database.executeStoredProcedure("sp_SetLeadPartner", {
      CompId, LeadId: Id || row.Id, UserId, PartnerId, CommType, CommValue, SetTerms: canTerms ? 1 : 0 });
    const p = r.recordset?.[0] ?? r.recordsets?.[0]?.[0];
    return p?.ResponseCode === 200 ? null
      : responseHelper.error(res, `Lead saved, but the partner was not: ${p?.ResponseMess}`, "SP_ERROR", p?.ResponseCode || 500);
  }
  ```
- `convert` and `setStatus`: `after: () => syncCommission(CompId, LeadId, UserId).then(() => null)`.
- `fetch`: add `PartnerId = null` to the destructure and `PartnerId: positiveInt(PartnerId)` to the SP params.
- New `partner(req, res)`: `assertRecordAccess(req, res, "lead", LeadId, "view")`, then `sp_FetchLeadPartner`; strip as in test 9.

`leadRoutes.js`: `router.post("/fetchLeadPartner", requirePayload, requireModule("leads", "view"), leadController.partner);`

- [ ] **Step 5: Run full backend suite + coverage**

Run: `cd backend && pnpm exec jest --silent && pnpm exec jest leadController partnerService --coverage --collectCoverageFrom='src/controllers/leadController.js' --collectCoverageFrom='src/services/partnerService.js'`
Expected: all green; both files ≥80%.

---

### Task 5: Backend — Partner report

**Files:**
- Modify: `backend/src/utils/reportKit.js` (REPORTS + `runReport` shape hook)
- Modify: `backend/src/controllers/reportController.js` (`partners`)
- Modify: `backend/src/routes/reportRoutes.js`
- Test: `backend/tests/unit/utils/reportKit.test.js`, `backend/tests/unit/controllers/reportController.test.js` (existing — add cases)

**Interfaces:**
- Consumes: `sp_RptPartners` (Task 1 Step 6).
- Produces: `POST /api/reports/partners` — the shared report response (`kpis`, `rows`, `trend` — match what `runReport` returns today); money columns `WonValue, Earned, Due, Paid` removed from KPIs and rows when the caller lacks `partners` view.

- [ ] **Step 1: Failing tests**

1. `parseReportArgs({}, "partners")` → `GroupBy: "partner"`; `parseReportArgs({ GroupBy: "owner" }, "partners")` → error.
2. `reportController.partners` with partners view → SP `sp_RptPartners` called with the 12 params, response contains `Earned`.
3. Without partners view → no `WonValue/Earned/Due/Paid` keys in KPIs or any row; `LeadsSent`, `Converted`, `ConversionPct` kept.

- [ ] **Step 2: Run to see them fail** — `cd backend && pnpm exec jest reportKit reportController`

- [ ] **Step 3: Implement**

- `REPORTS.partners = { sp: "sp_RptPartners", groupBys: ["partner"] }`.
- `runReport(spName, req, res, key, shape = (data) => data)` — apply `shape` to the data object right before `success(...)`. Existing callers unchanged.
- Controller:
  ```js
  const MONEY = ["WonValue", "Earned", "Due", "Paid"];
  const omit = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !MONEY.includes(k)));
  partners = asyncRoute((req, res) => runReport("sp_RptPartners", req, res, "partners",
    scopeFor(req, "partners").can.view ? undefined : (d) => ({ ...d, kpis: (d.kpis ?? []).map(omit), rows: (d.rows ?? []).map(omit) })),
    "Failed to fetch partner report", "PARTNER_REPORT_ERROR");
  ```
  Use the real data keys `runReport` returns (read it; adjust `kpis`/`rows` names to match) and the same `asyncRoute` wiring the other report methods use.
- Route: `router.post("/partners", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.partners);`

- [ ] **Step 4: Run** — `cd backend && pnpm exec jest --silent` green; reportKit/reportController coverage ≥80%.

---

### Task 6: Web — Partners page (partners tab, commissions tab, setting)

**Files:**
- Create: `web/src/api/partnerQueries.js`
- Create: `web/src/pages/Sales/Partners/Partners.jsx`, `PartnerFormModal.jsx`, `Commissions.jsx`, `MarkPaidModal.jsx`
- Modify: `web/src/App.jsx` (route `/sales/partners`, lazy)
- Modify: `web/src/pages/Master/Groups.jsx` (`MODULE_ROWS` + `ROW_HINT.partners`)
- Modify: `web/src/data/helpGuides.js` (`partners` guide, EN + HI, same shape as `leads`)
- Test: `web/src/pages/Sales/Partners/Partners.test.jsx`, `Commissions.test.jsx`, `web/src/test/mocks/handlers` (add MSW handlers the way existing endpoints are mocked)

**Interfaces:**
- Consumes: Task 3 endpoints.
- Produces: `PARTNER_ENDPOINTS` in `api/partnerQueries.js`:
  ```js
  export const PARTNER_ENDPOINTS = {
    fetchPartners: "/api/partners/fetchPartners",
    savePartner: "/api/partners/savePartner",
    fetchPartnerPicker: "/api/partners/fetchPartnerPicker",
    fetchCommissions: "/api/partners/fetchCommissions",
    markCommissionDue: "/api/partners/markCommissionDue",
    markCommissionPaid: "/api/partners/markCommissionPaid",
    savePartnerSetting: "/api/partners/savePartnerSetting",
    fetchLeadPartner: "/api/leads/fetchLeadPartner",
  };
  ```
  plus `formatCommission(CommType, CommValue) → "10%" | "₹5,000" | "—"` (uses the existing `formatCurrency`).

- [ ] **Step 1: Failing tests**

`Partners.test.jsx` (renderWithProviders, MSW):
1. Lists partners with Name, Mobile, City, "Usual commission" (`10%` / `₹5,000` / `—`), Leads sent, Converted, Due (₹).
2. "Add partner" opens the modal; saving posts `{ Id: 0, Name, Mobile, City, CommType: "pct", CommValue: 10 }` and refetches.
3. Commission type "None" sends `CommType: null, CommValue: null` and hides the value field.
4. A 409 from the server shows its message inside the modal (not only a snackbar).
5. Deactivate posts `IsActive: false` for that partner; "Show inactive" re-fetches with `IncludeInactive: true`.

`Commissions.test.jsx`:
1. Rows show partner, lead (link to `/sales/leads/:id`), won value, terms, amount, status chip ("Earned" / "Ready to pay" / "Paid" / "Cancelled"); a `Reverted` paid row shows a warning chip "Lead no longer converted".
2. Selecting two Earned rows → "Ready to pay (2)" posts `markCommissionDue { Ids: [..] }`.
3. Selecting Ready-to-pay rows → "Mark paid" opens `MarkPaidModal` (date defaults to today, reference optional) → posts `markCommissionPaid`.
4. A 409 shows the server message.
5. The setting control shows the current `commissionDueOn` and saving posts `savePartnerSetting`; it is hidden for a user without partners edit (`useAccess("partners").edit` false).
6. Status filter tabs (All · Earned · Ready to pay · Paid) re-fetch with `Status`.

- [ ] **Step 2: Run to see them fail** — `cd web && pnpm exec vitest run src/pages/Sales/Partners`

- [ ] **Step 3: Implement**

- `Partners.jsx`: `PageHeader` "Partners" (subtitle "People and firms who send you leads, and what you owe them."), `HelpGuide`, `Tabs` `Partners | Commissions` (tab in the URL `?tab=commissions`). Partners tab: `useAppTable` MRT over `fetchPartners` (data via `useApiQuery`), row actions Edit / Deactivate (Deactivate uses the existing confirmation hook), header button "Add partner" when `useAccess("partners").add`.
- `PartnerFormModal.jsx`: React Hook Form + Zod; fields Name (required), Contact person, Mobile (`ui/MobileInput`), Email, City, Notes, Commission (`Combobox`: None · Percent of deal · Fixed amount) + value (`TextInput type=number`, suffix `%` or prefix `₹`). Errors from the server render in the form.
- `Commissions.jsx`: filters (partner `Combobox`, status tabs, date range with labelled `DateField`s), MRT with row selection, bulk buttons enabled only when every selected row has the right status, totals line under the table ("Selected: ₹x"). Setting row at the top: "Commission becomes payable: [When we mark it ▾ / As soon as the lead converts]" + Save, only with partners edit.
- `MarkPaidModal.jsx`: `DateField` "Paid on" (default today, local date — never `toISOString()`), `TextInput` "Reference (UTR / cheque no.)".
- `App.jsx`: `{ path: "/sales/partners", element: <ProtectedRoute element={<Partners />} /> }` (lazy like its neighbours).
- `Groups.jsx`: `{ key: "partners", label: "Partners & commission" }` after `sales_reports`, with `ROW_HINT.partners`: "View: see partners, commission terms and amounts. Add/Edit: add or change partners, mark commission ready to pay or paid. Salespeople pick a partner on a lead without this."

- [ ] **Step 4: Run** — `cd web && pnpm exec vitest run src/pages/Sales/Partners src/pages/Master --coverage` green; new files ≥80%.

---

### Task 7: Web — partner on the lead form, lead page and leads list

**Files:**
- Modify: `web/src/pages/Sales/LeadCreateModal.jsx`
- Create: `web/src/pages/Sales/LeadPartnerCard.jsx`
- Modify: `web/src/pages/Sales/LeadDetail.jsx` (render the card)
- Modify: `web/src/pages/Sales/Leads.jsx` (filter + column)
- Modify: `web/src/pages/Reports/reportUtils.js` (`ID_KEYS` + `GROUP_PARAM.partner = "PartnerId"`)
- Test: `LeadCreateModal.test.jsx`, `LeadPartnerCard.test.jsx` (new), `Leads.test.jsx`, `reportUtils.test.js`

**Interfaces:**
- Consumes: `PARTNER_ENDPOINTS.fetchPartnerPicker`, `PARTNER_ENDPOINTS.fetchPartners` (terms defaults, partners view only), `PARTNER_ENDPOINTS.fetchLeadPartner`, `formatCommission`.
- Produces: `saveLeads` body carries `PartnerId` (always — `null` to clear) and, with partners view, `CommType`/`CommValue`.

- [ ] **Step 1: Failing tests**

LeadCreateModal:
1. A "Partner" `Combobox` lists picker partners; choosing one sends `PartnerId` on save.
2. With partners view: choosing a partner whose usual rule is 10% fills Commission = Percent, 10; editing to Fixed 5000 sends `CommType: "fixed", CommValue: 5000`.
3. Without partners view: no commission fields render; body has `PartnerId` only.
4. Clearing the partner sends `PartnerId: null` and hides the commission fields.
5. Editing an existing lead pre-fills partner (+ terms with view) from `fetchLeadPartner`.

LeadPartnerCard:
1. No partner → card not rendered.
2. Partner, no view → "Sent by Sharma Traders" only.
3. With view → terms + latest commission (amount, status chip, paid date/ref); a reverted row shows the warning.

Leads:
1. Partner filter posts `PartnerId`; `?PartnerId=3` in the URL pre-selects it.
2. Partner column shows `PartnerName` or "—".

reportUtils: `leadsUrl({ PartnerId: 3 })` keeps it; `GROUP_PARAM.partner === "PartnerId"`.

- [ ] **Step 2: Run to see them fail** — `cd web && pnpm exec vitest run src/pages/Sales src/pages/Reports/reportUtils.test.js`

- [ ] **Step 3: Implement**

- `LeadCreateModal.jsx`: schema gains `PartnerId: z.number().nullable().optional(), CommType: z.enum(["pct","fixed"]).nullable().optional(), CommValue: z.number().min(0).nullable().optional()` with a refine: `pct` ≤ 100. Picker via `useApiQuery(PARTNER_ENDPOINTS.fetchPartnerPicker)`; usual rules via `fetchPartners` only when `useAccess("partners").view`. On partner change (and only then) set CommType/CommValue from the usual rule. Payload: `PartnerId: values.PartnerId ?? null` and, with view, `CommType`, `CommValue`. Place the Partner field next to Source.
- `LeadPartnerCard.jsx`: fetch `fetchLeadPartner { LeadId }`; small card in the lead detail sidebar (same surface as neighbouring cards).
- `Leads.jsx`: `opts.partner` from the picker; filter `Combobox` "All partners" (`data-testid="filter-partner"`), `PartnerId: num(filters.PartnerId)` in `extraParams`, and a column `{ accessorKey: "PartnerName", header: "Partner", enableSorting: false, Cell: v || "—" }` after Owner. Make sure `PartnerId` is read from the URL the same way `SourceId` is (check `leadsParamsToState`).

- [ ] **Step 4: Run** — `cd web && pnpm exec vitest run` (full suite, shared components touched) green; touched files ≥80%.

---

### Task 8: Web — Partner report

**Files:**
- Create: `web/src/pages/Reports/Partners.jsx`
- Modify: `web/src/api/salesQueries.js` (`reports.partners`, `export const partners`)
- Modify: `web/src/App.jsx` (`/reports/partners`)
- Test: `web/src/pages/Reports/Partners.test.jsx` (model on `Lost.test.jsx`; fixtures with two trend buckets)

**Interfaces:**
- Consumes: `POST /api/reports/partners`.
- Produces: page at `/reports/partners`.

- [ ] **Step 1: Failing tests**

1. Posts defaults (`GroupBy: "partner"`, last 30 days, `created`), renders KPIs Leads sent · Converted · Conversion % · Won value · Earned · Due · Paid and a row per partner.
2. When the response has no money keys (no partners view), the money KPI cards and columns are not shown — no "₹0".
3. Row click → `/sales/leads?PartnerId=<GroupKey>` (+ range when basis is `created`).
4. Trend draws LeadsSent / Converted.

- [ ] **Step 2: Run to see them fail** — `cd web && pnpm exec vitest run src/pages/Reports/Partners.test.jsx`

- [ ] **Step 3: Implement**

Config-only page like `Lost.jsx`: `reportKey="partners"`, title "Partners", subtitle "Leads each partner sent, how many converted, and the commission earned, due and paid.", one GroupBy `{ value: "partner", label: "Partner" }`, KPIs/columns listed above (money ones `format: "currency"` — use whatever currency format key the other reports use). For test 2, filter KPIs/columns to the keys present in the response: if `ReportPage` cannot do that, add a `hideMissing` prop to `ReportPage` that drops a KPI/column whose key is absent from the first row, with its own test in `ReportPage.test.jsx`. Drill: `leadsUrl({ PartnerId: row.GroupKey, ...drillRange(f), ...idFilters(f) })`.

- [ ] **Step 4: Run** — full `cd web && pnpm exec vitest run` green; touched files ≥80%.

---

### Task 9: Whole-branch check and hand-over

- [ ] `cd backend && pnpm exec jest --silent` green; `cd web && pnpm exec vitest run` green; `cd mobile && pnpm typecheck && pnpm lint` clean (mobile untouched, sanity only).
- [ ] Contract check against TestCRM (after the user applied 107): `read_query` that every proc named in Tasks 3–5 exists with the params the controllers send (`[TestCRM].sys.parameters`).
- [ ] Report to the user: what to click on TestCRM to try it (add a partner, put it on a lead, convert, mark ready, mark paid, open the Partner report; log in as a Sales Executive, move a lead away, confirm it vanishes), and the deploy commands (backend rsync + `docker compose up -d --build crm_test` first; web build). No commit until the user says so.

---

## Amendment A (2026-10-10): merge the procedures — 11 new procs → 6

Ordered by the user after Tasks 1–5: "1 procedure, 1 API", fewer round trips, atomic writes. Supersedes the conflicting parts of Tasks 1, 3, 4, 6, 7. Rule: one procedure per screen/action, doing everything that action needs in one transaction; no mode-flag god procs.

### Final procedure set

New (6): `sp_SavePartner` (unchanged), `sp_FetchPartners`, `sp_SyncPartnerCommission` (internal helper), `sp_FetchCommissions`, `sp_SetCommissionStatus`, `sp_RptPartners` (unchanged).
Dropped (`DROP PROCEDURE IF EXISTS` in 107 — they exist on TestCRM only): `sp_FetchPartnerPicker`, `sp_SetLeadPartner`, `sp_FetchLeadPartner`, `sp_MarkCommissionDue`, `sp_MarkCommissionPaid`, `sp_SavePartnerSetting`.
Existing procs changed (CREATE OR ALTER from live TestCRM text — identical on all 3 DBs — with only the listed edits): `sp_SaveLead`, `sp_ConvertLead`, `sp_SetLeadStatus`, `sp_FetchLeadDetail`, `sp_SaveCompanySetting`, `sp_FetchWorkSettings` (only if it does not already return `CommissionDueOn`). `sp_FetchLeads` and the Step 7 loop stay as they are.

### Task A1: SQL — rewrite `backend/sql/107_partners.sql` into the merged form

- `sp_SyncPartnerCommission @CompId, @LeadId, @UserId` — same logic as now, but **returns no result set** (it is only ever called from other procs now). Keep its own BEGIN TRAN/COMMIT (nests inside the caller's) and the UPDLOCK/HOLDLOCK read; no ROLLBACK in its body; it may THROW on error so the caller's CATCH rolls back the whole write.
- `sp_SaveLead` gains, after its existing params: `@SetPartner BIT = 0, @PartnerId INT = NULL, @CommType VARCHAR(5) = NULL, @CommValue DECIMAL(12,2) = NULL, @SetTerms BIT = 0`. When `@SetPartner = 0` behaviour is byte-for-byte as today. When 1, inside sp_SaveLead's existing transaction after the lead insert/update, apply exactly the rules sp_SetLeadPartner has today (active-partner check on change; SetTerms 1 = take given terms, 0 = partner's usual rule on partner change / keep on same partner; terms validation; refuse 409 when a live paid commission exists and partner/terms would change; SourceId → company's `lead_source` Code `partner` when a partner is set; activity row Type `partner`), then `EXEC dbo.sp_SyncPartnerCommission`. Validation failures that can be checked before the transaction return their status row before it, like sp_SaveLead's other checks. The proc still returns its one status row.
- `sp_ConvertLead` and `sp_SetLeadStatus`: one line each, `EXEC dbo.sp_SyncPartnerCommission @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId;` inside the existing transaction, immediately before `COMMIT TRANSACTION` (on the success path only).
- `sp_FetchLeadDetail`: result set 1 (the lead row) gains `l.PartnerId, pr.Name AS PartnerName, l.CommType, l.CommValue` (LEFT JOIN tblPartner pr); append ONE new LAST result set: the lead's commission rows (`Id, PartnerId, PartnerName, BaseValue, CommType, CommValue, Amount, Status, Reverted, EarnedAt, DueAt, PaidAt, PaidRef`, newest first). Existing result sets keep their order and columns.
- `sp_FetchPartners @CompId, @IncludeInactive BIT = 0, @WithStats BIT = 1`: `@WithStats = 1` → today's columns incl. the five counts/sums; `@WithStats = 0` → `Id, Name, City, CommType, CommValue` of active partners only, no aggregates (the lead-form dropdown).
- `sp_SetCommissionStatus @CompId, @UserId, @IdsJson NVARCHAR(MAX), @ToStatus VARCHAR(10), @PaidAt DATE = NULL, @PaidRef NVARCHAR(100) = NULL`: `@ToStatus = 'due'` moves only `earned` rows (sets DueAt/DueBy); `'paid'` needs `@PaidAt` (400 otherwise) and moves only `due` rows; anything else → 400 "Unknown status". Status test and write in one UPDATE; 0 rows → 409 with today's messages; else 200 `Id` = rows changed.
- `sp_FetchCommissions`: drop its second result set (the setting).
- `sp_SaveCompanySetting` gains `@CommissionDueOn VARCHAR(10) = NULL` — NULL leaves the column as is; otherwise must be `manual`/`convert` (400). `sp_FetchWorkSettings` returns `CommissionDueOn` in its settings row (add it only if its SELECT lists columns explicitly).
- Verify block updated to the new procs (commission round trip through `sp_SaveLead @SetPartner=1` + `sp_SetCommissionStatus`, double-pay → 409, change partner after paid → 409, inside BEGIN TRAN … ROLLBACK).

### Task A2: Backend — follow the merged procs

- `partnerController`: endpoints become `fetchPartners`, `savePartner`, `fetchCommissions`, `setCommissionStatus`. `fetchPartners` is ONE endpoint for both the page and the lead-form dropdown: route guard `open()`; in the handler 403 unless the caller has `leads` view or `partners` view; callers with partners view get `WithStats` per body (`Stats: true` default) and full columns; others always get `WithStats: 0` and only `Id, Name, City`. `setCommissionStatus` body `{ Ids, ToStatus: 'due'|'paid', PaidAt?, PaidRef? }` (partners edit). Remove `fetchPartnerPicker`, `markCommissionDue`, `markCommissionPaid`, `savePartnerSetting` (code, routes, tests). `fetchCommissions` returns `data.commissions` only.
- `leadController.save`: one `sp_SaveLead` call — when the body has the `PartnerId` key send `SetPartner: 1, PartnerId, CommType, CommValue, SetTerms` (same validation and view rules as now, before any DB call); otherwise `SetPartner: 0`. Remove the `after` hook use for partner; remove `runSp`'s `after` param if nothing else uses it.
- `convert` / `setStatus`: remove the Node sync call (the procs sync inside their transaction). Delete `services/partnerService.js` and its test.
- `detail`: callers without partners view get the lead row without `CommType`/`CommValue` and `commissions: []`; with view, `commissions` = the new last result set. Remove the `partner` handler and the `fetchLeadPartner` route.
- `workSettingsController.saveCompanySetting`: accept optional `CommissionDueOn` (`manual`|`convert`, else 400) and pass it; omitted → NULL (unchanged).
- Tests updated accordingly; full suite green; ≥80% on touched files.

### Task A3: Web — follow the merged endpoints (runs after Task 6 finishes)

- `api/partnerQueries.js`: endpoints `fetchPartners`, `savePartner`, `fetchCommissions`, `setCommissionStatus` only.
- Commissions tab: remove the setting control; "Ready to pay" / "Mark paid" post `setCommissionStatus` with `ToStatus` `due` / `paid`.
- Settings → Work settings (`pages/Settings/WorkCalendar.jsx` company settings form): add "Commission becomes payable" select (When we mark it · As soon as the lead converts), saved with the other company settings.
- Task 7 (when built) uses `fetchPartners` (Stats false) for the lead-form dropdown and reads partner + commissions from the lead detail response instead of `fetchLeadPartner`.
