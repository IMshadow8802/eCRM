-- ===========================================================================
-- 149 — calling lists: bought contact sheets, hand-out to callers, call
--       results, do-not-call / caution marks, conversion to a lead, and the
--       calling figures in the sales reports.
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-11-16-calling-lists/design.md (section 3a,
--       "Access decided 2026-11-24", wins where older text differs).
-- Plan: docs/superpowers/plans/2026-11-16-calling-lists.md, Tasks 1-4.
--
-- Apply by hand (CLAUDE.md §0.2), with QUOTED_IDENTIFIER ON (-I), in this order:
--   TestCRM -> eCRM+ -> SolarCRM -> OSG
--   e.g.  sqlcmd -I -S <server> -d TestCRM -i 149_calling_lists.sql
--
-- Needs 131-134, 139, 140, 143 applied (it re-states fn_AccessGrants,
-- fn_SalesReportRows, sp_RptSales, sp_RptSalesRows, sp_SaveLead and five
-- fetches from their live text). The first batch stops the script when
-- fn_AssignableUsers is missing. Every altered object below was copied from
-- the live definition, which was byte-identical (SHA-256) in all four
-- databases on 2026-11-24; changed lines carry "-- 149".
--
-- Idempotent: every CREATE TABLE / ADD COLUMN / index / constraint is guarded,
-- every function and procedure is CREATE OR ALTER, every seed is NOT EXISTS.
--
-- Sections, in apply order:
--   §1  tables  tblCallList, tblCallListCaller, tblCallContact, tblCallAttempt, tblPhoneMark
--   §2  existing tables  tblLeads.CallListId, tblCompanySetting calling settings,
--       CK_tblGroupModule_Module + 'calling'
--   §3  access  fn_AccessGrants (+ calling), fn_VisibleCallLists
--   §4  fn_PhoneMark
--   §5  seeds  lead_source 'calling', three menu rows, calling grant for admin roles
--   §6  list, import and pool-view procedures
--   §7  phone-mark procedures
--   §8  distribution engine (fn_CallEligible, top-up, hand-out, my list, result, undo)
--   §9  sp_CallSweep
--   §10 altered  sp_SaveLead, sp_SaveCustomer, lead / customer / complaint fetches, settings
--   §11 report families  fn_SalesReportRows, sp_RptSales, sp_RptSalesRows
--   §12 verify after apply (end of file, -- comments only)
--
-- Rules carried here (the reasoning travels with the objects):
--   * A caller sees only what they hold now: caller procedures read
--     tblCallContact through HeldBy = @UserId AND Status IN ('held','callback').
--     A contact the person never called answers 404 "Contact not found" (its
--     existence is not confirmed); one they called that has left answers 409.
--   * A contact changes hands only inside these procedures (never in Node).
--   * Status is the only branching key: pool · held · callback · lead · closed.
--   * A dnc number is never handed out: fn_CallEligible checks Mobile AND AltMobile.
--   * Managers' lists = fn_VisibleCallLists (calling View + the person's leads
--     offices). Hand-outs go only to fn_AssignableUsers(..., 'leads', NULL).
--   * Cost: only an admin's save writes it (a non-admin's save keeps the stored
--     value), and sp_FetchCallLists / sp_RptSales return it as NULL to anyone else.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.fn_AssignableUsers') IS NULL OR OBJECT_ID('dbo.fn_VisibleLeads') IS NULL
   OR OBJECT_ID('dbo.fn_SalesReportRows') IS NULL
BEGIN
    RAISERROR('149: apply 131-134, 139, 140 and 143 first (fn_AssignableUsers / fn_VisibleLeads / fn_SalesReportRows missing). Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ===========================================================================
-- §1 tables
-- ===========================================================================

-- One purchase of contact data.
IF OBJECT_ID('dbo.tblCallList', 'U') IS NULL
CREATE TABLE dbo.tblCallList (
    Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblCallList PRIMARY KEY,
    CompId        INT            NOT NULL,
    BranchId      INT            NOT NULL,            -- the office the data was bought for; reach is measured on it
    Name          NVARCHAR(200)  NOT NULL,
    Vendor        NVARCHAR(200)  NULL,
    PurchasedOn   DATE           NULL,
    Cost          DECIMAL(18,2)  NULL,                -- admin-only figure (spec 3a, A5)
    ProductId     INT            NULL,
    Script        NVARCHAR(MAX)  NULL,
    AutoTopUp     BIT            NOT NULL CONSTRAINT DF_tblCallList_AutoTopUp     DEFAULT (0),
    HoldSize      INT            NOT NULL CONSTRAINT DF_tblCallList_HoldSize      DEFAULT (10),
    MaxAttempts   TINYINT        NOT NULL CONSTRAINT DF_tblCallList_MaxAttempts   DEFAULT (3),
    RetryGapHours INT            NOT NULL CONSTRAINT DF_tblCallList_RetryGapHours DEFAULT (4),
    Status        VARCHAR(10)    NOT NULL CONSTRAINT DF_tblCallList_Status        DEFAULT ('active'),
    -- import counts, kept for the vendor-quality figures
    SheetRows     INT            NOT NULL CONSTRAINT DF_tblCallList_SheetRows  DEFAULT (0),
    SkippedDup    INT            NOT NULL CONSTRAINT DF_tblCallList_SkippedDup DEFAULT (0),
    SkippedBad    INT            NOT NULL CONSTRAINT DF_tblCallList_SkippedBad DEFAULT (0),
    SkippedDnc    INT            NOT NULL CONSTRAINT DF_tblCallList_SkippedDnc DEFAULT (0),
    CreatedBy     INT            NULL,
    CreatedAt     DATETIME       NOT NULL CONSTRAINT DF_tblCallList_CreatedAt DEFAULT (GETDATE()),
    EditBy        INT            NULL,
    UpdatedAt     DATETIME       NULL,
    CONSTRAINT CK_tblCallList_Status   CHECK (Status IN ('active','paused','archived')),
    CONSTRAINT CK_tblCallList_Ranges   CHECK (HoldSize BETWEEN 1 AND 200 AND MaxAttempts BETWEEN 1 AND 10
                                              AND RetryGapHours BETWEEN 0 AND 168),
    CONSTRAINT CK_tblCallList_Cost     CHECK (Cost IS NULL OR Cost >= 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblCallList_Name' AND object_id = OBJECT_ID('dbo.tblCallList'))
    CREATE UNIQUE INDEX UX_tblCallList_Name ON dbo.tblCallList (CompId, Name) WHERE Status <> 'archived';
GO

-- Who works a list (the answer to "who may draw from it" for automatic top-up).
IF OBJECT_ID('dbo.tblCallListCaller', 'U') IS NULL
CREATE TABLE dbo.tblCallListCaller (
    CallListId INT      NOT NULL CONSTRAINT FK_tblCallListCaller_List REFERENCES dbo.tblCallList (Id),
    UserId     INT      NOT NULL,
    CompId     INT      NOT NULL,
    HoldSize   INT      NULL,                         -- overrides the list's
    IsPaused   BIT      NOT NULL CONSTRAINT DF_tblCallListCaller_IsPaused DEFAULT (0),
    AddedBy    INT      NULL,
    AddedAt    DATETIME NOT NULL CONSTRAINT DF_tblCallListCaller_AddedAt DEFAULT (GETDATE()),
    CONSTRAINT PK_tblCallListCaller PRIMARY KEY (CallListId, UserId),
    CONSTRAINT CK_tblCallListCaller_HoldSize CHECK (HoldSize IS NULL OR HoldSize BETWEEN 1 AND 200)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblCallListCaller_User' AND object_id = OBJECT_ID('dbo.tblCallListCaller'))
    CREATE INDEX IX_tblCallListCaller_User ON dbo.tblCallListCaller (CompId, UserId);
GO

-- One bought person. Status is the only branching key.
IF OBJECT_ID('dbo.tblCallContact', 'U') IS NULL
CREATE TABLE dbo.tblCallContact (
    Id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblCallContact PRIMARY KEY,
    CompId             INT            NOT NULL,
    BranchId           INT            NOT NULL,       -- copied from the list
    CallListId         INT            NOT NULL CONSTRAINT FK_tblCallContact_List REFERENCES dbo.tblCallList (Id),
    Name               NVARCHAR(200)  NULL,           -- sizes as tblLeads, so conversion never truncates
    Company            NVARCHAR(200)  NULL,
    City               NVARCHAR(100)  NULL,
    State              NVARCHAR(100)  NULL,
    Pincode            VARCHAR(10)    NULL,
    Email              NVARCHAR(150)  NULL,
    Address            NVARCHAR(500)  NULL,
    Mobile             VARCHAR(10)    NOT NULL,
    AltMobile          VARCHAR(10)    NULL,
    Extra              NVARCHAR(MAX)  NULL,           -- JSON object of the sheet's unmapped columns
    Status             VARCHAR(10)    NOT NULL CONSTRAINT DF_tblCallContact_Status DEFAULT ('pool'),
    CloseReason        VARCHAR(16)    NULL,
    HeldBy             INT            NULL,
    HeldAt             DATETIME       NULL,
    HeldVia            VARCHAR(6)     NULL,
    CallbackAt         DATETIME       NULL,
    CallbackWarnedAt   DATETIME       NULL,
    CallbackNotifiedAt DATETIME       NULL,
    CallbackReleaseAt  DATETIME       NULL,           -- the cut-off, computed in Node on the working calendar
    Attempts           INT            NOT NULL CONSTRAINT DF_tblCallContact_Attempts DEFAULT (0),
    LastResult         VARCHAR(16)    NULL,
    LastCalledAt       DATETIME       NULL,
    LastCalledBy       INT            NULL,
    NextEligibleAt     DATETIME       NULL,           -- retry gap; NULL = now
    Priority           TINYINT        NOT NULL CONSTRAINT DF_tblCallContact_Priority DEFAULT (0),   -- 9 = missed callback
    LeadId             INT            NULL,           -- set once, at conversion
    RecycledAt         DATETIME       NULL,
    RecycledBy         INT            NULL,
    CreatedBy          INT            NULL,
    CreatedAt          DATETIME       NOT NULL CONSTRAINT DF_tblCallContact_CreatedAt DEFAULT (GETDATE()),
    CONSTRAINT CK_tblCallContact_Mobile    CHECK (Mobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    CONSTRAINT CK_tblCallContact_AltMobile CHECK (AltMobile IS NULL OR AltMobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    CONSTRAINT CK_tblCallContact_Status    CHECK (Status IN ('pool','held','callback','lead','closed')),
    CONSTRAINT CK_tblCallContact_Close     CHECK (CloseReason IS NULL OR CloseReason IN ('not_interested','wrong_number','dnc','no_response','duplicate','removed')),
    CONSTRAINT CK_tblCallContact_HeldVia   CHECK (HeldVia IS NULL OR HeldVia IN ('manual','auto')),
    CONSTRAINT CK_tblCallContact_Extra     CHECK (Extra IS NULL OR ISJSON(Extra) = 1),
    -- spec 9.3: held / callback <=> a holder; lead <=> LeadId; closed <=> a reason; callback => a time
    CONSTRAINT CK_tblCallContact_Holder    CHECK ((Status IN ('held','callback') AND HeldBy IS NOT NULL)
                                                  OR (Status NOT IN ('held','callback') AND HeldBy IS NULL)),
    CONSTRAINT CK_tblCallContact_Lead      CHECK ((Status = 'lead' AND LeadId IS NOT NULL) OR (Status <> 'lead' AND LeadId IS NULL)),
    CONSTRAINT CK_tblCallContact_Closed    CHECK ((Status = 'closed' AND CloseReason IS NOT NULL) OR (Status <> 'closed' AND CloseReason IS NULL)),
    CONSTRAINT CK_tblCallContact_Callback  CHECK (Status <> 'callback' OR CallbackAt IS NOT NULL)
);
GO
-- A number is in a company's pool once, for ever, whatever became of it (U4, U7, Q7).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblCallContact_Mobile' AND object_id = OBJECT_ID('dbo.tblCallContact'))
    CREATE UNIQUE INDEX UX_tblCallContact_Mobile ON dbo.tblCallContact (CompId, Mobile);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblCallContact_Draw' AND object_id = OBJECT_ID('dbo.tblCallContact'))
    -- key order = the pick's ORDER BY (Status = 'pool' fixed), so TOP (@Need) stops after @Need rows
    CREATE INDEX IX_tblCallContact_Draw ON dbo.tblCallContact (CompId, CallListId, Status, Priority DESC, Attempts, Id)
        INCLUDE (NextEligibleAt, Mobile, AltMobile);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblCallContact_Held' AND object_id = OBJECT_ID('dbo.tblCallContact'))
    CREATE INDEX IX_tblCallContact_Held ON dbo.tblCallContact (CompId, HeldBy, Status) INCLUDE (CallListId, CallbackAt);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblCallContact_AltMobile' AND object_id = OBJECT_ID('dbo.tblCallContact'))
    CREATE INDEX IX_tblCallContact_AltMobile ON dbo.tblCallContact (CompId, AltMobile) WHERE AltMobile IS NOT NULL;
GO

-- Every call, append-only. Written only by sp_SaveCallResult, sp_UndoCallResult
-- (UndoneAt), sp_CallSweep (CallbackOutcome) and sp_SaveLead's conversion path.
IF OBJECT_ID('dbo.tblCallAttempt', 'U') IS NULL
CREATE TABLE dbo.tblCallAttempt (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblCallAttempt PRIMARY KEY,
    CompId          INT            NOT NULL,
    ContactId       INT            NOT NULL CONSTRAINT FK_tblCallAttempt_Contact REFERENCES dbo.tblCallContact (Id),
    CallListId      INT            NOT NULL CONSTRAINT FK_tblCallAttempt_List REFERENCES dbo.tblCallList (Id),
    UserId          INT            NOT NULL,
    Result          VARCHAR(16)    NOT NULL,
    Notes           NVARCHAR(1000) NULL,
    DialedAt        DATETIME       NULL,              -- when the caller tapped Call (sent by the app)
    CalledAt        DATETIME       NOT NULL CONSTRAINT DF_tblCallAttempt_CalledAt DEFAULT (GETDATE()),
    CallbackAt      DATETIME       NULL,
    LeadId          INT            NULL,
    AttemptsBefore  INT            NOT NULL CONSTRAINT DF_tblCallAttempt_AttemptsBefore DEFAULT (0),   -- for undo
    UndoneAt        DATETIME       NULL,
    CallbackOutcome VARCHAR(6)     NULL,              -- on a booked callback: kept / missed
    CONSTRAINT CK_tblCallAttempt_Result  CHECK (Result IN ('interested','not_interested','wrong_number','no_answer','busy','callback','dnc')),
    CONSTRAINT CK_tblCallAttempt_Outcome CHECK (CallbackOutcome IS NULL OR CallbackOutcome IN ('kept','missed'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblCallAttempt_CalledAt' AND object_id = OBJECT_ID('dbo.tblCallAttempt'))
    CREATE INDEX IX_tblCallAttempt_CalledAt ON dbo.tblCallAttempt (CompId, CalledAt) INCLUDE (UserId, CallListId, ContactId, Result);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblCallAttempt_Contact' AND object_id = OBJECT_ID('dbo.tblCallAttempt'))
    CREATE INDEX IX_tblCallAttempt_Contact ON dbo.tblCallAttempt (ContactId, Id);
GO

-- Do not call / caution, keyed by number, never by row (U6). A cleared mark stays as history.
IF OBJECT_ID('dbo.tblPhoneMark', 'U') IS NULL
CREATE TABLE dbo.tblPhoneMark (
    Id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblPhoneMark PRIMARY KEY,
    CompId    INT           NOT NULL,
    Mobile    VARCHAR(10)   NOT NULL,
    Mark      VARCHAR(8)    NOT NULL,
    Note      NVARCHAR(500) NOT NULL,
    Source    VARCHAR(8)    NOT NULL,
    SetBy     INT           NULL,
    SetAt     DATETIME      NOT NULL CONSTRAINT DF_tblPhoneMark_SetAt DEFAULT (GETDATE()),
    ClearedBy INT           NULL,
    ClearedAt DATETIME      NULL,
    ClearNote NVARCHAR(500) NULL,
    CONSTRAINT CK_tblPhoneMark_Mobile CHECK (Mobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    CONSTRAINT CK_tblPhoneMark_Mark   CHECK (Mark IN ('dnc','caution')),
    CONSTRAINT CK_tblPhoneMark_Source CHECK (Source IN ('caller','admin','upload'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblPhoneMark_Live' AND object_id = OBJECT_ID('dbo.tblPhoneMark'))
    CREATE UNIQUE INDEX UX_tblPhoneMark_Live ON dbo.tblPhoneMark (CompId, Mobile) WHERE ClearedAt IS NULL;
GO

-- ===========================================================================
-- §2 changes to existing tables
-- ===========================================================================
IF COL_LENGTH('dbo.tblLeads', 'CallListId') IS NULL
    ALTER TABLE dbo.tblLeads ADD CallListId INT NULL;          -- the purchase a lead came from
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_CallList' AND object_id = OBJECT_ID('dbo.tblLeads'))
    CREATE INDEX IX_tblLeads_CallList ON dbo.tblLeads (CompId, CallListId) WHERE CallListId IS NOT NULL;
GO

-- Calling hours (minutes of the day, 9 am - 9 pm) and the callback cap per caller.
IF COL_LENGTH('dbo.tblCompanySetting', 'CallStartMin') IS NULL
    ALTER TABLE dbo.tblCompanySetting ADD CallStartMin INT NOT NULL CONSTRAINT DF_tblCompanySetting_CallStartMin DEFAULT (540);
IF COL_LENGTH('dbo.tblCompanySetting', 'CallEndMin') IS NULL
    ALTER TABLE dbo.tblCompanySetting ADD CallEndMin INT NOT NULL CONSTRAINT DF_tblCompanySetting_CallEndMin DEFAULT (1260);
IF COL_LENGTH('dbo.tblCompanySetting', 'CallbackCap') IS NULL
    ALTER TABLE dbo.tblCompanySetting ADD CallbackCap INT NOT NULL CONSTRAINT DF_tblCompanySetting_CallbackCap DEFAULT (20);
GO

-- Module 'calling' (the way 107 added partners and 114 cards). Not a reach
-- module: CK_tblGroupModule_Reach then requires Reach NULL, which the seed gives.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE name = 'CK_tblGroupModule_Module' AND definition LIKE '%''calling''%')
BEGIN
    IF OBJECT_ID('dbo.CK_tblGroupModule_Module', 'C') IS NOT NULL
        ALTER TABLE dbo.tblGroupModule DROP CONSTRAINT CK_tblGroupModule_Module;
    ALTER TABLE dbo.tblGroupModule WITH CHECK ADD CONSTRAINT CK_tblGroupModule_Module CHECK (Module IN (
        'leads', 'sales_reports', 'complaints', 'support_reports', 'customers', 'people', 'tasks',
        'teams', 'projects', 'settings', 'dashboard', 'attendance', 'partners', 'cards',
        'calling'));   -- 149
END
GO
-- ===========================================================================
-- §3 access definitions
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 149: dbo.fn_AccessGrants from its live definition. Only change: 'calling' in the admin module list (no reach, no AssignLevel).
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 3. fn_AccessGrants: one row per module the person can view. Union over the
--    person's active groups of their company; widest wins per column, each on
--    its own. Admin (any active IsAdmin group): every module of
--    CK_tblGroupModule_Module, all bits 1, Company / Company. Unknown,
--    other-company or inactive person: no rows (an escalation to an inactive
--    account therefore grants no sight).
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_AccessGrants (@CompId BIGINT, @UserId INT)
RETURNS TABLE
AS
RETURN
WITH grp AS (
    SELECT g.Id, g.IsAdmin
    FROM dbo.tblUser u
    JOIN dbo.tblUserGroupMap m ON m.UserId = u.Id
    JOIN dbo.tblUserGroups g   ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = @CompId
    WHERE u.Id = @UserId AND u.CompId = @CompId AND u.IsActive = 1
),
adm AS (
    SELECT TOP (1) 1 AS IsAdmin FROM grp WHERE IsAdmin = 1
),
agg AS (
    SELECT gm.Module,
           MAX(CAST(gm.CanView   AS INT)) AS V,
           MAX(CAST(gm.CanAdd    AS INT)) AS A,
           MAX(CAST(gm.CanEdit   AS INT)) AS E,
           MAX(CAST(gm.CanDelete AS INT)) AS D,
           MAX(CASE gm.Reach WHEN 'Own' THEN 1 WHEN 'Team' THEN 2 WHEN 'Office' THEN 3
                             WHEN 'OfficeTree' THEN 4 WHEN 'Company' THEN 5 END) AS RL,
           MAX(CASE WHEN gm.Module IN ('leads', 'complaints')
                    THEN CASE ISNULL(gm.AssignReach, 'Team') WHEN 'Office' THEN 3 WHEN 'OfficeTree' THEN 4
                                                            WHEN 'Company' THEN 5 ELSE 2 END END) AS AL
    FROM grp
    JOIN dbo.tblGroupModule gm ON gm.GroupId = grp.Id AND gm.CanView = 1
    WHERE NOT EXISTS (SELECT 1 FROM adm)
    GROUP BY gm.Module
)
SELECT a.Module,
       CAST(a.V AS BIT) AS CanView, CAST(a.A AS BIT) AS CanAdd,
       CAST(a.E AS BIT) AS CanEdit, CAST(a.D AS BIT) AS CanDelete,
       CAST(CASE a.RL WHEN 1 THEN 'Own' WHEN 2 THEN 'Team' WHEN 3 THEN 'Office'
                      WHEN 4 THEN 'OfficeTree' WHEN 5 THEN 'Company' END AS VARCHAR(12)) AS Reach,
       CAST(a.RL AS TINYINT) AS ReachLevel,
       CAST(CASE a.AL WHEN 2 THEN 'Team' WHEN 3 THEN 'Office'
                      WHEN 4 THEN 'OfficeTree' WHEN 5 THEN 'Company' END AS VARCHAR(12)) AS AssignReach,
       CAST(a.AL AS TINYINT) AS AssignLevel
FROM agg a
UNION ALL
SELECT mo.Module, CAST(1 AS BIT), CAST(1 AS BIT), CAST(1 AS BIT), CAST(1 AS BIT),
       CAST('Company' AS VARCHAR(12)), CAST(5 AS TINYINT),
       CAST('Company' AS VARCHAR(12)), CAST(5 AS TINYINT)
FROM adm
CROSS JOIN (VALUES ('leads'), ('sales_reports'), ('complaints'), ('support_reports'), ('customers'),
                   ('people'), ('tasks'), ('teams'), ('projects'), ('settings'), ('dashboard'),
                   ('attendance'), ('partners'), ('cards'),
                   ('calling')) mo (Module);   -- 149: admins hold the calling grant too
GO

-- ---------------------------------------------------------------------------
-- fn_VisibleCallLists (new): the lists a person may MANAGE. Nothing without
-- calling View. calling has no reach of its own; it borrows the person's
-- leads offices exactly as fn_VisibleLeads reads them (spec 3a, A3):
-- leads Company -> every list of the company (admins always land here);
-- OfficeTree -> lists of every office of fn_AccessOffices; anything else
-- (Office, Team, Own, no leads View) -> its Level-3 offices = home office +
-- tblUserBranchAccess extras (ruling 2026-11-24: a grant holder always sees
-- their own offices' lists, whatever their leads reach). No creator rule:
-- managing comes from the grant, not from having made the list.
-- The caller side never reads this: a caller's rows are HeldBy = @UserId.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_VisibleCallLists (@CompId BIGINT, @UserId INT)
RETURNS @T TABLE (CallListId INT NOT NULL PRIMARY KEY)
AS
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, @UserId, 'calling') WHERE CanView = 1)
        RETURN;                                                   -- no grant: nothing (fail closed)

    DECLARE @Lvl TINYINT;
    SELECT @Lvl = ISNULL(ReachLevel, 1) FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads');
    -- ruling 2026-11-24: Own / Team / no leads View still get home + extra offices (Level 3)

    IF @Lvl = 5
    BEGIN
        INSERT INTO @T (CallListId) SELECT Id FROM dbo.tblCallList WHERE CompId = @CompId;
        RETURN;
    END

    INSERT INTO @T (CallListId)
    SELECT cl.Id
    FROM dbo.tblCallList cl
    WHERE cl.CompId = @CompId
      AND EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, @UserId) o
                  WHERE o.BranchId = cl.BranchId AND (o.Level = 3 OR @Lvl = 4));
    RETURN;
END
GO

-- ===========================================================================
-- §4 fn_PhoneMark — the live marks of a company, one definition.
-- Pattern every reader repeats (one OUTER APPLY, both numbers, dnc first):
--     OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note, pm.SetByName, pm.SetAt
--                  FROM dbo.fn_PhoneMark(@CompId) pm
--                  WHERE pm.Mobile IN (x.Mobile, x.AltMobile)
--                  ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk
-- ===========================================================================
CREATE OR ALTER FUNCTION dbo.fn_PhoneMark (@CompId INT)
RETURNS TABLE
AS
RETURN
SELECT pm.Id, pm.Mobile, pm.Mark, pm.Note, pm.SetAt, pm.SetBy,
       CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200)) AS SetByName
FROM dbo.tblPhoneMark pm
LEFT JOIN dbo.tblUser u ON u.Id = pm.SetBy
WHERE pm.CompId = @CompId AND pm.ClearedAt IS NULL;
GO

-- ===========================================================================
-- §5 seeds (per company, each NOT EXISTS-guarded)
-- ===========================================================================

-- lead_source Code 'calling' (the Code 'partner' row of 107 is the precedent).
-- A company that already has an active, code-less 'Calling list' source gets
-- the code on that row instead (UQ_tblLookup_CompId_Kind_Value).
UPDATE lk SET Code = 'calling'
FROM dbo.tblLookup lk
WHERE lk.Kind = 'lead_source' AND lk.Value = N'Calling list' AND lk.Code IS NULL AND lk.IsActive = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup x WHERE x.CompId = lk.CompId AND x.Kind = 'lead_source' AND x.Code = 'calling');

INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive, Code)
SELECT s.CompId, 'lead_source', N'Calling list', s.MaxSort + 1, 1, 'calling'
FROM (SELECT CompId, MAX(SortOrder) AS MaxSort FROM dbo.tblLookup WHERE Kind = 'lead_source' GROUP BY CompId) s
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup x WHERE x.CompId = s.CompId AND x.Kind = 'lead_source' AND x.Code = 'calling');
GO

-- Menu rows, keyed on Route (ids differ per database: OSG's report rows are 1058+,
-- SolarCRM has no Visiting Cards row). Filler columns as 122 §7 wrote them.
-- Menus come from tblMenu.Module joined to tblGroupModule; no tblGroupAccess rows.
DECLARE @Sales149 INT = (SELECT TOP (1) Id FROM dbo.tblMenu WHERE Route = N'/sales' AND ISNULL(ParentId, 0) = 0 ORDER BY Id);
DECLARE @Rpt149   INT = (SELECT TOP (1) ParentId FROM dbo.tblMenu WHERE Route = N'/reports/sales/team' ORDER BY Id);
IF @Sales149 IS NULL OR @Rpt149 IS NULL
    RAISERROR('149 §5: Sales or Sales Reports menu parent not found; the three calling menu rows were not added.', 10, 1);
ELSE
BEGIN
    INSERT INTO dbo.tblMenu (ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route, Module, SortOrder)
    SELECT n.ParentId, n.Title, NULL, 0, 1, 0, 1, NULL, NULL, 1, n.Route, n.Module,
           ISNULL((SELECT MAX(m.SortOrder) FROM dbo.tblMenu m WHERE m.ParentId = n.ParentId), 0) + n.Step
    FROM (VALUES (@Sales149, 'Calling Lists', N'/sales/calling-lists',    'calling',       1),
                 (@Sales149, 'Do not call',   N'/sales/do-not-call',      'calling',       2),
                 (@Rpt149,   'Calling',       N'/reports/sales/calling',  'sales_reports', 1)) n (ParentId, Title, Route, Module, Step)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblMenu m WHERE m.Route = n.Route);
END
GO

-- The one new grant, for admin roles only (spec 3a, A2). No salesperson role:
-- callers need no row. Reach / AssignReach NULL (not a reach module).
INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach)
SELECT g.Id, 'calling', 1, 1, 1, 1, NULL, NULL
FROM dbo.tblUserGroups g
WHERE g.IsAdmin = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupModule gm WHERE gm.GroupId = g.Id AND gm.Module = 'calling');
GO
-- ---------------------------------------------------------------------------
-- fn_CallEligible (§8's predicate, defined first because §6 counts with it):
-- the contacts of a list that may be handed out now (spec 10.1) — in the pool,
-- list active, retry gap passed, tries left, and no live dnc mark on Mobile
-- OR AltMobile (checked at hand-out, not only at upload). Every hand-out
-- (sp_TopUpCallList, sp_AssignCallContacts) picks through this and nothing else.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_CallEligible (@CompId INT, @CallListId INT)
RETURNS TABLE
AS
RETURN
SELECT c.Id
FROM dbo.tblCallContact c
JOIN dbo.tblCallList l ON l.Id = c.CallListId AND l.CompId = c.CompId
WHERE c.CompId = @CompId AND c.CallListId = @CallListId
  AND c.Status = 'pool'
  AND l.Status = 'active'
  AND (c.NextEligibleAt IS NULL OR c.NextEligibleAt <= GETDATE())
  AND c.Attempts < l.MaxAttempts
  AND NOT EXISTS (SELECT 1 FROM dbo.tblPhoneMark pm
                  WHERE pm.CompId = c.CompId AND pm.ClearedAt IS NULL AND pm.Mark = 'dnc'
                    AND pm.Mobile IN (c.Mobile, c.AltMobile));
GO

-- ===========================================================================
-- §6 list, import and pool-view procedures (manager side)
-- Every one answers 404 "Calling list not found" for a list outside
-- fn_VisibleCallLists(@CompId, @UserId). Add / Edit / Delete rights are the
-- route's (requireModule('calling', ...)); visibility is decided here.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- sp_SaveCallList: @Id = 0 insert, > 0 update. A new list's office must be one
-- the person may write to and will then see (leads Company: any active office;
-- OfficeTree: any writable fn_AccessOffices office; otherwise a writable home /
-- extra office, the same offices fn_VisibleCallLists gives them). @Id > 0
-- never changes BranchId. Cost: only an admin's save writes it. Archiving
-- returns held and callback contacts to the pool.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveCallList
    @CompId        INT,
    @UserId        INT,
    @Id            INT            = 0,
    @BranchId      INT            = NULL,
    @Name          NVARCHAR(200)  = NULL,
    @Vendor        NVARCHAR(200)  = NULL,
    @PurchasedOn   DATE           = NULL,
    @Cost          DECIMAL(18,2)  = NULL,
    @ProductId     INT            = NULL,
    @Script        NVARCHAR(MAX)  = NULL,
    @AutoTopUp     BIT            = 0,
    @HoldSize      INT            = 10,
    @MaxAttempts   INT            = 3,
    @RetryGapHours INT            = 4,
    @Status        VARCHAR(10)    = 'active'
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);
    SET @Name = NULLIF(LTRIM(RTRIM(@Name)), N'');
    SET @Vendor = NULLIF(LTRIM(RTRIM(@Vendor)), N'');
    SET @Script = NULLIF(LTRIM(RTRIM(@Script)), N'');
    SET @Status = ISNULL(NULLIF(@Status, ''), 'active');
    IF @ProductId <= 0 SET @ProductId = NULL;

    IF @CompId IS NULL OR @CompId <= 0 OR @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId and UserId are required' AS ResponseMess; RETURN; END
    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.fn_VisibleCallLists(@CompId, @UserId) WHERE CallListId = @Id)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Calling list not found' AS ResponseMess; RETURN; END
    IF @Name IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Status NOT IN ('active','paused','archived')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Status must be active, paused or archived' AS ResponseMess; RETURN; END
    IF @HoldSize IS NULL OR @HoldSize NOT BETWEEN 1 AND 200
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Hold size must be 1 to 200' AS ResponseMess; RETURN; END
    IF @MaxAttempts IS NULL OR @MaxAttempts NOT BETWEEN 1 AND 10
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Tries must be 1 to 10' AS ResponseMess; RETURN; END
    IF @RetryGapHours IS NULL OR @RetryGapHours NOT BETWEEN 0 AND 168
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Retry gap must be 0 to 168 hours' AS ResponseMess; RETURN; END
    IF @Cost < 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Cost cannot be negative' AS ResponseMess; RETURN; END
    IF @ProductId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id = @ProductId AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid product' AS ResponseMess; RETURN; END

    DECLARE @IsAdmin BIT = CASE WHEN EXISTS (
        SELECT 1 FROM dbo.tblUserGroupMap m
        JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1 AND g.CompId = @CompId
        WHERE m.UserId = @UserId) THEN 1 ELSE 0 END;

    IF @Id = 0
    BEGIN
        DECLARE @Lvl TINYINT;
        SELECT @Lvl = ISNULL(ReachLevel, 1) FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads');
        IF @BranchId IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.fn_CompanyOffice(@CompId, @BranchId))
           OR NOT (   @Lvl = 5
                   OR (EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, @UserId) o   -- any level: its writable Level-3 offices (ruling 2026-11-24)
                                                  WHERE o.BranchId = @BranchId AND o.CanWrite = 1
                                                    AND (o.Level = 3 OR @Lvl = 4))))
        BEGIN SELECT 0 AS Id, 403 AS ResponseCode, 'You cannot create a list for that office' AS ResponseMess; RETURN; END
    END

    IF @Status <> 'archived' AND EXISTS (SELECT 1 FROM dbo.tblCallList
                                         WHERE CompId = @CompId AND Name = @Name AND Status <> 'archived' AND Id <> @Id)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'A list with this name already exists' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF @Id = 0
        BEGIN
            INSERT INTO dbo.tblCallList (CompId, BranchId, Name, Vendor, PurchasedOn, Cost, ProductId, Script,
                                         AutoTopUp, HoldSize, MaxAttempts, RetryGapHours, Status, CreatedBy, EditBy)
            VALUES (@CompId, @BranchId, @Name, @Vendor, @PurchasedOn, CASE WHEN @IsAdmin = 1 THEN @Cost END, @ProductId, @Script,
                    ISNULL(@AutoTopUp, 0), @HoldSize, @MaxAttempts, @RetryGapHours, @Status, @UserId, @UserId);
            SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE
        BEGIN
            UPDATE dbo.tblCallList
               SET Name = @Name, Vendor = @Vendor, PurchasedOn = @PurchasedOn,
                   Cost = CASE WHEN @IsAdmin = 1 THEN @Cost ELSE Cost END,
                   ProductId = @ProductId, Script = @Script, AutoTopUp = ISNULL(@AutoTopUp, 0),
                   HoldSize = @HoldSize, MaxAttempts = @MaxAttempts, RetryGapHours = @RetryGapHours,
                   Status = @Status, EditBy = @UserId, UpdatedAt = GETDATE()
             WHERE Id = @Id AND CompId = @CompId;

            IF @Status = 'archived'
                UPDATE dbo.tblCallContact
                   SET Status = 'pool', HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
                       CallbackAt = NULL, CallbackReleaseAt = NULL, CallbackWarnedAt = NULL, CallbackNotifiedAt = NULL
                 WHERE CompId = @CompId AND CallListId = @Id AND Status IN ('held','callback');
        END
        COMMIT;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Calling list saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @Id AS Id, 409 AS ResponseCode, 'A list with this name already exists' AS ResponseMess;
        ELSE
            SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- sp_DeleteCallList: only a list nobody has called yet (otherwise archive).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_DeleteCallList
    @CompId INT,
    @UserId INT,
    @Id     INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_VisibleCallLists(@CompId, @UserId) WHERE CallListId = @Id)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Calling list not found' AS ResponseMess; RETURN; END
    BEGIN TRY
        BEGIN TRAN;
        IF EXISTS (SELECT 1 FROM dbo.tblCallAttempt WITH (UPDLOCK, HOLDLOCK) WHERE CompId = @CompId AND CallListId = @Id)
           OR EXISTS (SELECT 1 FROM dbo.tblLeads WHERE CompId = @CompId AND CallListId = @Id)
        BEGIN
            ROLLBACK;
            SELECT @Id AS Id, 409 AS ResponseCode, 'This list has calls; archive it instead' AS ResponseMess;
            RETURN;
        END
        DELETE FROM dbo.tblCallListCaller WHERE CompId = @CompId AND CallListId = @Id;
        DELETE FROM dbo.tblCallContact    WHERE CompId = @CompId AND CallListId = @Id;
        DELETE FROM dbo.tblCallList       WHERE CompId = @CompId AND Id = @Id;
        COMMIT;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Calling list deleted' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- sp_FetchCallLists: RS1 the lists in view with their counts; RS2 pagination;
-- RS3 (only with @Id) the list's callers. Cost is NULL unless the caller is an
-- admin (Node strips it too). @Status NULL = every status.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchCallLists
    @CompId     INT,
    @UserId     INT,
    @Id         INT           = NULL,
    @Status     VARCHAR(10)   = NULL,
    @SearchTerm NVARCHAR(200) = NULL,
    @PageNumber INT           = 1,
    @PageSize   INT           = 25
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize, 25) < 1 THEN 25 ELSE @PageSize END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    SET @Status     = NULLIF(@Status, '');
    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    CREATE TABLE #VC (CallListId INT PRIMARY KEY);
    INSERT INTO #VC (CallListId) SELECT CallListId FROM dbo.fn_VisibleCallLists(@CompId, @UserId);
    DECLARE @IsAdmin BIT = CASE WHEN EXISTS (
        SELECT 1 FROM dbo.tblUserGroupMap m
        JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1 AND g.CompId = @CompId
        WHERE m.UserId = @UserId) THEN 1 ELSE 0 END;

    DECLARE @F TABLE (Id INT PRIMARY KEY, CreatedAt DATETIME);
    INSERT INTO @F (Id, CreatedAt)
    SELECT cl.Id, cl.CreatedAt
    FROM dbo.tblCallList cl
    JOIN #VC v ON v.CallListId = cl.Id
    WHERE cl.CompId = @CompId
      AND (@Id IS NULL OR cl.Id = @Id)
      AND (@Status IS NULL OR cl.Status = @Status)
      AND (@SearchTerm IS NULL OR cl.Name LIKE '%' + @SearchTerm + '%' OR cl.Vendor LIKE '%' + @SearchTerm + '%');
    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- RS1
    SELECT cl.Id, cl.CompId, cl.BranchId, b.BranchName, cl.Name, cl.Vendor, cl.PurchasedOn,
           CASE WHEN @IsAdmin = 1 THEN cl.Cost END AS Cost,   -- admins only (spec 3a, A5), in SQL as well as Node
           cl.ProductId, p.Name AS ProductName, cl.Script, cl.AutoTopUp, cl.HoldSize, cl.MaxAttempts,
           cl.RetryGapHours, cl.Status, cl.SheetRows, cl.SkippedDup, cl.SkippedBad, cl.SkippedDnc,
           cl.CreatedBy, CAST(COALESCE(NULLIF(cu.FullName, ''), cu.Username) AS NVARCHAR(200)) AS CreatedByName,
           cl.CreatedAt, cl.UpdatedAt,
           ISNULL(k.Contacts, 0) AS Contacts, ISNULL(k.InPool, 0) AS InPool, ISNULL(k.Held, 0) AS Held,
           ISNULL(k.Callbacks, 0) AS Callbacks, ISNULL(k.Closed, 0) AS Closed, ISNULL(k.Leads, 0) AS Leads,
           ISNULL(e.Eligible, 0) AS Eligible, ISNULL(t.CalledToday, 0) AS CalledToday,
           200 AS ResponseCode, 'Calling lists retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblCallList cl    ON cl.Id = f.Id
    LEFT JOIN dbo.tblBranch b  ON b.Id = cl.BranchId
    LEFT JOIN dbo.tblProduct p ON p.Id = cl.ProductId
    LEFT JOIN dbo.tblUser cu   ON cu.Id = cl.CreatedBy
    OUTER APPLY (SELECT COUNT(*) AS Contacts,
                        SUM(CASE WHEN c.Status = 'pool'     THEN 1 ELSE 0 END) AS InPool,
                        SUM(CASE WHEN c.Status = 'held'     THEN 1 ELSE 0 END) AS Held,
                        SUM(CASE WHEN c.Status = 'callback' THEN 1 ELSE 0 END) AS Callbacks,
                        SUM(CASE WHEN c.Status = 'closed'   THEN 1 ELSE 0 END) AS Closed,
                        SUM(CASE WHEN c.Status = 'lead'     THEN 1 ELSE 0 END) AS Leads
                 FROM dbo.tblCallContact c WHERE c.CompId = @CompId AND c.CallListId = cl.Id) k
    OUTER APPLY (SELECT COUNT(*) AS Eligible FROM dbo.fn_CallEligible(@CompId, cl.Id)) e
    OUTER APPLY (SELECT COUNT(*) AS CalledToday FROM dbo.tblCallAttempt a
                 WHERE a.CompId = @CompId AND a.CallListId = cl.Id AND a.UndoneAt IS NULL AND a.CalledAt >= @Today) t
    ORDER BY f.CreatedAt DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- RS2
    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;

    -- RS3 callers of one list
    IF @Id IS NOT NULL
        SELECT lc.UserId, CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200)) AS FullName, u.Avatar,
               lc.HoldSize, lc.IsPaused, u.IsActive,
               ISNULL(h.Holding, 0) AS Holding, ISNULL(h.Callbacks, 0) AS Callbacks,
               ISNULL(a.CalledToday, 0) AS CalledToday, ISNULL(a.Leads, 0) AS Leads
        FROM dbo.tblCallListCaller lc
        JOIN @F f ON f.Id = lc.CallListId
        JOIN dbo.tblUser u ON u.Id = lc.UserId
        OUTER APPLY (SELECT SUM(CASE WHEN c.Status = 'held' THEN 1 ELSE 0 END) AS Holding,
                            SUM(CASE WHEN c.Status = 'callback' THEN 1 ELSE 0 END) AS Callbacks
                     FROM dbo.tblCallContact c
                     WHERE c.CompId = @CompId AND c.CallListId = lc.CallListId AND c.HeldBy = lc.UserId) h
        OUTER APPLY (SELECT SUM(CASE WHEN x.CalledAt >= @Today THEN 1 ELSE 0 END) AS CalledToday,
                            SUM(CASE WHEN x.Result = 'interested' AND x.LeadId IS NOT NULL THEN 1 ELSE 0 END) AS Leads
                     FROM dbo.tblCallAttempt x
                     WHERE x.CompId = @CompId AND x.CallListId = lc.CallListId AND x.UserId = lc.UserId AND x.UndoneAt IS NULL) a
        WHERE lc.CompId = @CompId AND lc.CallListId = @Id
        ORDER BY FullName;
END
GO

-- ---------------------------------------------------------------------------
-- sp_SaveCallListCallers: [{UserId, HoldSize, IsPaused, Remove}]. A person
-- being added must be one the manager may already hand a lead to
-- (fn_AssignableUsers 'leads', unaltered); otherwise nothing changes (403).
-- A removed caller's held and callback contacts go back to the pool at once.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveCallListCallers
    @CompId      INT,
    @UserId      INT,
    @CallListId  INT,
    @CallersJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_VisibleCallLists(@CompId, @UserId) WHERE CallListId = @CallListId)
    BEGIN SELECT @CallListId AS Id, 404 AS ResponseCode, 'Calling list not found' AS ResponseMess; RETURN; END
    IF ISJSON(ISNULL(@CallersJson, '')) <> 1
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'Callers must be a JSON array' AS ResponseMess; RETURN; END

    DECLARE @In TABLE (UserId INT PRIMARY KEY, HoldSize INT NULL, IsPaused BIT NOT NULL, Remove BIT NOT NULL, IsNew BIT NOT NULL DEFAULT 0);
    BEGIN TRY
        INSERT INTO @In (UserId, HoldSize, IsPaused, Remove)
        SELECT j.UserId, MAX(j.HoldSize), MAX(CAST(ISNULL(j.IsPaused, 0) AS INT)), MAX(CAST(ISNULL(j.Remove, 0) AS INT))
        FROM OPENJSON(@CallersJson) WITH (UserId INT, HoldSize INT, IsPaused BIT, Remove BIT) j
        WHERE j.UserId > 0
        GROUP BY j.UserId;
    END TRY
    BEGIN CATCH
        SELECT @CallListId AS Id, 400 AS ResponseCode, 'Callers must be a JSON array' AS ResponseMess; RETURN;
    END CATCH
    IF NOT EXISTS (SELECT 1 FROM @In)
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'No callers supplied' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM @In WHERE Remove = 0 AND HoldSize IS NOT NULL AND HoldSize NOT BETWEEN 1 AND 200)
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'Hold size must be 1 to 200' AS ResponseMess; RETURN; END

    UPDATE i SET IsNew = 1 FROM @In i
    WHERE i.Remove = 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblCallListCaller lc WHERE lc.CallListId = @CallListId AND lc.UserId = i.UserId);
    IF EXISTS (SELECT 1 FROM @In i WHERE i.IsNew = 1
               AND NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(@CompId, @UserId, 'leads', NULL) a WHERE a.Id = i.UserId))
    BEGIN SELECT @CallListId AS Id, 403 AS ResponseCode, 'You cannot give contacts to that person' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE lc SET HoldSize = i.HoldSize, IsPaused = i.IsPaused
        FROM dbo.tblCallListCaller lc JOIN @In i ON i.UserId = lc.UserId AND i.Remove = 0
        WHERE lc.CallListId = @CallListId;

        INSERT INTO dbo.tblCallListCaller (CallListId, UserId, CompId, HoldSize, IsPaused, AddedBy)
        SELECT @CallListId, i.UserId, @CompId, i.HoldSize, i.IsPaused, @UserId FROM @In i WHERE i.IsNew = 1;

        UPDATE c
           SET Status = 'pool', HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
               CallbackAt = NULL, CallbackReleaseAt = NULL, CallbackWarnedAt = NULL, CallbackNotifiedAt = NULL
        FROM dbo.tblCallContact c JOIN @In i ON i.UserId = c.HeldBy AND i.Remove = 1
        WHERE c.CompId = @CompId AND c.CallListId = @CallListId AND c.Status IN ('held','callback');

        DELETE lc FROM dbo.tblCallListCaller lc JOIN @In i ON i.UserId = lc.UserId AND i.Remove = 1
        WHERE lc.CallListId = @CallListId;
        COMMIT;
        SELECT @CallListId AS Id, 200 AS ResponseCode, 'Callers saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @CallListId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- sp_ImportCallContacts: one chunk (<= 500 rows) of an already-cleaned sheet:
-- [{RowNo, Name, Mobile, AltMobile, Company, City, State, Pincode, Email,
--   Address, Dnc, Extra}]  (Extra = a JSON object; Mobile already normalised by
-- Node, including the Alt-mobile fallback, or null). Each row is classified,
-- first match wins: bad -> repeated -> dnc -> pool -> lead -> customer -> add.
-- The duplicate tests are company-wide and NOT limited to what the uploader can
-- see (U7). @DryRun = 1 changes nothing. A re-sent chunk adds nothing twice
-- (UX_tblCallContact_Mobile; a row that lost a race is re-classified 'pool').
-- RS1 status + counts; RS2 RowNo, Reason for every skipped row.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_ImportCallContacts
    @CompId     INT,
    @UserId     INT,
    @CallListId INT,
    @RowsJson   NVARCHAR(MAX),
    @DryRun     BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @DryRun = ISNULL(@DryRun, 1);
    DECLARE @ListStatus VARCHAR(10), @ListBranch INT;

    IF NOT EXISTS (SELECT 1 FROM dbo.fn_VisibleCallLists(@CompId, @UserId) WHERE CallListId = @CallListId)
    BEGIN SELECT @CallListId AS Id, 404 AS ResponseCode, 'Calling list not found' AS ResponseMess,
                 0 AS Added, 0 AS InPool, 0 AS IsLead, 0 AS IsCustomer, 0 AS Dnc, 0 AS BadNumber, 0 AS Repeated; RETURN; END
    SELECT @ListStatus = Status, @ListBranch = BranchId FROM dbo.tblCallList WHERE Id = @CallListId AND CompId = @CompId;
    IF @ListStatus = 'archived'
    BEGIN SELECT @CallListId AS Id, 409 AS ResponseCode, 'This list is archived' AS ResponseMess,
                 0 AS Added, 0 AS InPool, 0 AS IsLead, 0 AS IsCustomer, 0 AS Dnc, 0 AS BadNumber, 0 AS Repeated; RETURN; END
    IF ISJSON(ISNULL(@RowsJson, '')) <> 1
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'Rows must be a JSON array' AS ResponseMess,
                 0 AS Added, 0 AS InPool, 0 AS IsLead, 0 AS IsCustomer, 0 AS Dnc, 0 AS BadNumber, 0 AS Repeated; RETURN; END

    CREATE TABLE #In (
        RowNo INT NOT NULL, Name NVARCHAR(200) NULL, Mobile VARCHAR(10) NULL, AltMobile VARCHAR(10) NULL,
        Company NVARCHAR(200) NULL, City NVARCHAR(100) NULL, State NVARCHAR(100) NULL, Pincode VARCHAR(10) NULL,
        Email NVARCHAR(150) NULL, Address NVARCHAR(500) NULL, Dnc BIT NOT NULL, Extra NVARCHAR(MAX) NULL,
        Class VARCHAR(10) NULL);
    BEGIN TRY
        INSERT INTO #In (RowNo, Name, Mobile, AltMobile, Company, City, State, Pincode, Email, Address, Dnc, Extra)
        SELECT ISNULL(j.RowNo, 0),
               NULLIF(LEFT(LTRIM(RTRIM(j.Name)), 200), N''),
               CASE WHEN j.Mobile LIKE '[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND LEN(j.Mobile) = 10 THEN j.Mobile END,
               CASE WHEN j.AltMobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND LEN(j.AltMobile) = 10
                     AND j.AltMobile <> ISNULL(j.Mobile, '') THEN j.AltMobile END,
               NULLIF(LEFT(LTRIM(RTRIM(j.Company)), 200), N''), NULLIF(LEFT(LTRIM(RTRIM(j.City)), 100), N''),
               NULLIF(LEFT(LTRIM(RTRIM(j.State)), 100), N''), NULLIF(LEFT(LTRIM(RTRIM(j.Pincode)), 10), ''),
               NULLIF(LEFT(LTRIM(RTRIM(j.Email)), 150), N''), NULLIF(LEFT(LTRIM(RTRIM(j.Address)), 500), N''),
               ISNULL(j.Dnc, 0),
               CASE WHEN ISJSON(j.Extra) = 1 AND j.Extra NOT IN (N'{}', N'[]') THEN j.Extra END
        FROM OPENJSON(@RowsJson) WITH (
            RowNo INT, Name NVARCHAR(400), Mobile VARCHAR(40), AltMobile VARCHAR(40), Company NVARCHAR(400),
            City NVARCHAR(200), State NVARCHAR(200), Pincode NVARCHAR(40), Email NVARCHAR(300), Address NVARCHAR(1000),
            Dnc BIT, Extra NVARCHAR(MAX) AS JSON) j;
    END TRY
    BEGIN CATCH
        SELECT @CallListId AS Id, 400 AS ResponseCode, 'Rows could not be read' AS ResponseMess,
               0 AS Added, 0 AS InPool, 0 AS IsLead, 0 AS IsCustomer, 0 AS Dnc, 0 AS BadNumber, 0 AS Repeated; RETURN;
    END CATCH
    IF (SELECT COUNT(*) FROM #In) > 500
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'At most 500 rows at once' AS ResponseMess,
                 0 AS Added, 0 AS InPool, 0 AS IsLead, 0 AS IsCustomer, 0 AS Dnc, 0 AS BadNumber, 0 AS Repeated; RETURN; END

    -- classify, first match wins
    UPDATE #In SET Class = 'bad' WHERE Mobile IS NULL;
    ;WITH r AS (SELECT Class, ROW_NUMBER() OVER (PARTITION BY Mobile ORDER BY RowNo) AS n FROM #In WHERE Class IS NULL)
    UPDATE r SET Class = 'repeated' WHERE n > 1;
    UPDATE i SET Class = 'dnc' FROM #In i
    WHERE i.Class IS NULL
      AND (i.Dnc = 1 OR EXISTS (SELECT 1 FROM dbo.tblPhoneMark pm
                                WHERE pm.CompId = @CompId AND pm.ClearedAt IS NULL AND pm.Mark = 'dnc'
                                  AND pm.Mobile IN (i.Mobile, i.AltMobile)));
    UPDATE i SET Class = 'pool' FROM #In i
    WHERE i.Class IS NULL
      AND EXISTS (SELECT 1 FROM dbo.tblCallContact c WHERE c.CompId = @CompId
                    AND (c.Mobile IN (i.Mobile, i.AltMobile) OR c.AltMobile IN (i.Mobile, i.AltMobile)));   -- both numbers of the row
    UPDATE i SET Class = 'lead' FROM #In i
    WHERE i.Class IS NULL
      AND EXISTS (SELECT 1 FROM dbo.tblLeads l WHERE l.CompId = @CompId
                    AND (l.MobileNo IN (i.Mobile, i.AltMobile) OR l.AltMobile IN (i.Mobile, i.AltMobile)));
    UPDATE i SET Class = 'customer' FROM #In i
    WHERE i.Class IS NULL
      AND EXISTS (SELECT 1 FROM dbo.tblCustomer c WHERE c.CompId = @CompId AND c.IsActive = 1
                                                   AND (c.Mobile IN (i.Mobile, i.AltMobile) OR c.AltMobile IN (i.Mobile, i.AltMobile)));
    UPDATE #In SET Class = 'add' WHERE Class IS NULL;

    IF @DryRun = 0
    BEGIN
        BEGIN TRY
            BEGIN TRAN;
            DECLARE @Ins TABLE (Mobile VARCHAR(10) PRIMARY KEY);
            -- UPDLOCK + HOLDLOCK on the probe: a concurrent upload of the same number waits, then skips it.
            INSERT INTO dbo.tblCallContact (CompId, BranchId, CallListId, Name, Company, City, State, Pincode, Email,
                                            Address, Mobile, AltMobile, Extra, Status, CreatedBy)
            OUTPUT inserted.Mobile INTO @Ins (Mobile)
            SELECT @CompId, @ListBranch, @CallListId, i.Name, i.Company, i.City, i.State, i.Pincode, i.Email,
                   i.Address, i.Mobile, i.AltMobile, i.Extra, 'pool', @UserId
            FROM #In i
            WHERE i.Class = 'add'
              AND NOT EXISTS (SELECT 1 FROM dbo.tblCallContact c WITH (UPDLOCK, HOLDLOCK)
                              WHERE c.CompId = @CompId AND c.Mobile = i.Mobile);
            UPDATE i SET Class = 'pool' FROM #In i
            WHERE i.Class = 'add' AND NOT EXISTS (SELECT 1 FROM @Ins s WHERE s.Mobile = i.Mobile);

            -- the sheet's own do-not-call column: mark the number (Source 'upload') ...
            INSERT INTO dbo.tblPhoneMark (CompId, Mobile, Mark, Note, Source, SetBy)
            SELECT DISTINCT @CompId, i.Mobile, 'dnc', N'Marked do not call in the uploaded sheet', 'upload', @UserId
            FROM #In i
            WHERE i.Class = 'dnc' AND i.Dnc = 1
              AND NOT EXISTS (SELECT 1 FROM dbo.tblPhoneMark pm WITH (UPDLOCK, HOLDLOCK)
                              WHERE pm.CompId = @CompId AND pm.Mobile = i.Mobile AND pm.ClearedAt IS NULL);
            -- ... and, as sp_SetPhoneMark does, take that number off every list at once
            UPDATE c
               SET Status = 'closed', CloseReason = 'dnc', HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
                   CallbackAt = NULL, CallbackReleaseAt = NULL, Priority = 0
            FROM dbo.tblCallContact c
            WHERE c.CompId = @CompId AND c.Status IN ('pool','held','callback')
              AND EXISTS (SELECT 1 FROM #In i WHERE i.Class = 'dnc' AND i.Dnc = 1 AND i.Mobile IN (c.Mobile, c.AltMobile));

            UPDATE dbo.tblCallList
               SET SheetRows  = SheetRows  + (SELECT COUNT(*) FROM #In),
                   SkippedDup = SkippedDup + (SELECT COUNT(*) FROM #In WHERE Class IN ('repeated','pool','lead','customer')),
                   SkippedBad = SkippedBad + (SELECT COUNT(*) FROM #In WHERE Class = 'bad'),
                   SkippedDnc = SkippedDnc + (SELECT COUNT(*) FROM #In WHERE Class = 'dnc'),
                   EditBy = @UserId, UpdatedAt = GETDATE()
             WHERE Id = @CallListId AND CompId = @CompId;
            COMMIT;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            SELECT @CallListId AS Id,
                   CASE WHEN ERROR_NUMBER() IN (2601, 2627) THEN 409 ELSE 500 END AS ResponseCode,
                   CASE WHEN ERROR_NUMBER() IN (2601, 2627)
                        THEN 'Another upload added some of these numbers at the same moment; send this part again'
                        ELSE ERROR_MESSAGE() END AS ResponseMess,
                   0 AS Added, 0 AS InPool, 0 AS IsLead, 0 AS IsCustomer, 0 AS Dnc, 0 AS BadNumber, 0 AS Repeated;
            RETURN;
        END CATCH
    END

    SELECT @CallListId AS Id, 200 AS ResponseCode,
           CASE WHEN @DryRun = 1 THEN 'Preview ready' ELSE 'Contacts imported' END AS ResponseMess,
           SUM(CASE WHEN Class = 'add'      THEN 1 ELSE 0 END) AS Added,
           SUM(CASE WHEN Class = 'pool'     THEN 1 ELSE 0 END) AS InPool,
           SUM(CASE WHEN Class = 'lead'     THEN 1 ELSE 0 END) AS IsLead,
           SUM(CASE WHEN Class = 'customer' THEN 1 ELSE 0 END) AS IsCustomer,
           SUM(CASE WHEN Class = 'dnc'      THEN 1 ELSE 0 END) AS Dnc,
           SUM(CASE WHEN Class = 'bad'      THEN 1 ELSE 0 END) AS BadNumber,
           SUM(CASE WHEN Class = 'repeated' THEN 1 ELSE 0 END) AS Repeated
    FROM #In;

    SELECT RowNo, Class AS Reason FROM #In WHERE Class <> 'add' ORDER BY RowNo;
END
GO

-- ---------------------------------------------------------------------------
-- sp_FetchCallContacts: the pool view of one list (managers only; there is no
-- caller path into it). @Stale = held over 2 days; @Missed = missed callbacks.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchCallContacts
    @CompId     INT,
    @UserId     INT,
    @CallListId INT,
    @Status     VARCHAR(10)   = NULL,
    @HeldBy     INT           = NULL,
    @LastResult VARCHAR(16)   = NULL,
    @City       NVARCHAR(100) = NULL,
    @Stale      BIT           = 0,
    @Missed     BIT           = 0,
    @SearchTerm NVARCHAR(200) = NULL,
    @PageNumber INT           = 1,
    @PageSize   INT           = 25
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_VisibleCallLists(@CompId, @UserId) WHERE CallListId = @CallListId)
    BEGIN SELECT @CallListId AS Id, 404 AS ResponseCode, 'Calling list not found' AS ResponseMess; RETURN; END

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize, 25) < 1 THEN 25 ELSE @PageSize END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    SET @City       = NULLIF(LTRIM(RTRIM(@City)), N'');
    SET @Status     = NULLIF(@Status, '');
    SET @LastResult = NULLIF(@LastResult, '');
    DECLARE @StaleBefore DATETIME = DATEADD(DAY, -2, GETDATE());

    CREATE TABLE #VL (LeadId INT PRIMARY KEY);
    INSERT INTO #VL (LeadId) SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);

    DECLARE @F TABLE (Id INT PRIMARY KEY);
    INSERT INTO @F (Id)
    SELECT c.Id
    FROM dbo.tblCallContact c
    WHERE c.CompId = @CompId AND c.CallListId = @CallListId
      AND (@Status IS NULL OR c.Status = @Status)
      AND (@HeldBy IS NULL OR c.HeldBy = @HeldBy)
      AND (@LastResult IS NULL OR c.LastResult = @LastResult)
      AND (@City IS NULL OR c.City = @City)
      AND (ISNULL(@Stale, 0) = 0 OR (c.Status = 'held' AND c.HeldAt < @StaleBefore))
      AND (ISNULL(@Missed, 0) = 0 OR (c.Status = 'pool' AND c.Priority = 9))
      AND (@SearchTerm IS NULL OR c.Name LIKE '%' + @SearchTerm + '%' OR c.Company LIKE '%' + @SearchTerm + '%'
                               OR c.Mobile LIKE '%' + @SearchTerm + '%' OR c.City LIKE '%' + @SearchTerm + '%');
    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    SELECT c.Id, c.CallListId, c.Name, c.Company, c.City, c.State, c.Pincode, c.Email, c.Address,
           c.Mobile, c.AltMobile, c.Extra, c.Status, c.CloseReason,
           c.HeldBy, CAST(COALESCE(NULLIF(hu.FullName, ''), hu.Username) AS NVARCHAR(200)) AS HeldByName,
           c.HeldAt, c.HeldVia, c.CallbackAt, c.Attempts, c.LastResult, c.LastCalledAt, c.LastCalledBy,
           CAST(COALESCE(NULLIF(lu.FullName, ''), lu.Username) AS NVARCHAR(200)) AS LastCalledByName,
           c.NextEligibleAt, c.Priority,
           CASE WHEN c.LeadId IN (SELECT LeadId FROM #VL) THEN c.LeadId END AS LeadId,
           c.RecycledAt, c.CreatedAt,
           mk.Mark AS PhoneMark, mk.Note AS PhoneMarkNote,
           200 AS ResponseCode, 'Contacts retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblCallContact c ON c.Id = f.Id
    LEFT JOIN dbo.tblUser hu ON hu.Id = c.HeldBy
    LEFT JOIN dbo.tblUser lu ON lu.Id = c.LastCalledBy
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (c.Mobile, c.AltMobile)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk
    ORDER BY c.Id
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO

-- ---------------------------------------------------------------------------
-- sp_FetchCallContactHistory: RS1 the contact, RS2 its calls newest first.
-- Both empty when the contact's list is not in view.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchCallContactHistory
    @CompId    INT,
    @UserId    INT,
    @ContactId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Vis BIT = 0;
    IF EXISTS (SELECT 1 FROM dbo.tblCallContact c
               JOIN dbo.fn_VisibleCallLists(@CompId, @UserId) v ON v.CallListId = c.CallListId
               WHERE c.Id = @ContactId AND c.CompId = @CompId)
        SET @Vis = 1;
    CREATE TABLE #VL (LeadId INT PRIMARY KEY);
    IF @Vis = 1 INSERT INTO #VL (LeadId) SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);

    SELECT c.Id, c.CallListId, cl.Name AS ListName, c.Name, c.Company, c.City, c.State, c.Pincode, c.Email,
           c.Address, c.Mobile, c.AltMobile, c.Extra, c.Status, c.CloseReason, c.HeldBy,
           CAST(COALESCE(NULLIF(hu.FullName, ''), hu.Username) AS NVARCHAR(200)) AS HeldByName,
           c.HeldAt, c.CallbackAt, c.Attempts, c.LastResult, c.LastCalledAt, c.NextEligibleAt, c.Priority,
           CASE WHEN c.LeadId IN (SELECT LeadId FROM #VL) THEN c.LeadId END AS LeadId,
           c.RecycledAt, c.CreatedAt, mk.Mark AS PhoneMark, mk.Note AS PhoneMarkNote,
           200 AS ResponseCode, 'Contact retrieved successfully' AS ResponseMess
    FROM dbo.tblCallContact c
    JOIN dbo.tblCallList cl ON cl.Id = c.CallListId
    LEFT JOIN dbo.tblUser hu ON hu.Id = c.HeldBy
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (c.Mobile, c.AltMobile)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk
    WHERE c.Id = @ContactId AND c.CompId = @CompId AND @Vis = 1;

    SELECT a.Id, a.Result, a.Notes, a.DialedAt, a.CalledAt, a.CallbackAt, a.CallbackOutcome,
           CASE WHEN a.LeadId IN (SELECT LeadId FROM #VL) THEN a.LeadId END AS LeadId,
           a.AttemptsBefore, a.UndoneAt, a.UserId,
           CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200)) AS UserName
    FROM dbo.tblCallAttempt a
    LEFT JOIN dbo.tblUser u ON u.Id = a.UserId
    WHERE a.ContactId = @ContactId AND a.CompId = @CompId AND @Vis = 1
    ORDER BY a.Id DESC;
END
GO
-- ===========================================================================
-- §7 phone-mark procedures (U6). Marks belong to the number, never the row.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- sp_PhoneMarkApply (internal): the one place a mark is written. No result
-- set and no transaction of its own, so sp_SetPhoneMark and sp_SaveCallResult
-- (result 'dnc') both run it inside theirs. dnc outranks caution: dnc over a
-- caution replaces it; caution over a dnc is refused; the same mark twice is a
-- 200 with the existing Id. Setting dnc closes every pool / held / callback
-- contact of the company carrying the number on Mobile or AltMobile, at once.
-- Inputs are validated by the callers.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_PhoneMarkApply
    @CompId INT,
    @UserId INT,
    @Mobile VARCHAR(10),
    @Mark   VARCHAR(8),
    @Note   NVARCHAR(500),
    @Source VARCHAR(8),
    @Code   INT           OUTPUT,
    @Mess   NVARCHAR(200) OUTPUT,
    @MarkId INT           OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @LiveId INT, @LiveMark VARCHAR(8);
    SELECT @LiveId = Id, @LiveMark = Mark
    FROM dbo.tblPhoneMark WITH (UPDLOCK, HOLDLOCK)
    WHERE CompId = @CompId AND Mobile = @Mobile AND ClearedAt IS NULL;

    IF @LiveMark = @Mark
    BEGIN SELECT @Code = 200, @Mess = N'This number is already marked', @MarkId = @LiveId; RETURN; END
    IF @LiveMark = 'dnc' AND @Mark = 'caution'
    BEGIN SELECT @Code = 409, @Mess = N'This number is already marked do not call', @MarkId = @LiveId; RETURN; END

    IF @LiveMark = 'caution'          -- and @Mark = 'dnc'
        UPDATE dbo.tblPhoneMark
           SET ClearedBy = @UserId, ClearedAt = GETDATE(), ClearNote = N'Replaced by do not call'
         WHERE Id = @LiveId;

    INSERT INTO dbo.tblPhoneMark (CompId, Mobile, Mark, Note, Source, SetBy)
    VALUES (@CompId, @Mobile, @Mark, @Note, @Source, @UserId);
    SET @MarkId = CAST(SCOPE_IDENTITY() AS INT);

    IF @Mark = 'dnc'
        UPDATE dbo.tblCallContact
           SET Status = 'closed', CloseReason = 'dnc', HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
               CallbackAt = NULL, CallbackReleaseAt = NULL, Priority = 0
         WHERE CompId = @CompId AND Status IN ('pool','held','callback')
           AND (Mobile = @Mobile OR AltMobile = @Mobile);

    SELECT @Code = 200, @Mess = CASE WHEN @Mark = 'dnc' THEN N'Marked do not call' ELSE N'Marked call with caution' END;
END
GO

-- ---------------------------------------------------------------------------
-- sp_SetPhoneMark: by a caller (result sheet, a lead, a customer) or an admin
-- (the Do not call page). Note required.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SetPhoneMark
    @CompId INT,
    @UserId INT,
    @Mobile VARCHAR(20),
    @Mark   VARCHAR(8),
    @Note   NVARCHAR(500),
    @Source VARCHAR(8) = 'caller'
AS
BEGIN
    SET NOCOUNT ON;
    SET @Note = NULLIF(LTRIM(RTRIM(@Note)), N'');
    SET @Source = ISNULL(NULLIF(@Source, ''), 'caller');
    IF @CompId IS NULL OR @CompId <= 0 OR @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId and UserId are required' AS ResponseMess; RETURN; END
    IF @Mobile IS NULL OR LEN(@Mobile) <> 10 OR @Mobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Mobile number must be 10 digits' AS ResponseMess; RETURN; END
    IF @Mark IS NULL OR @Mark NOT IN ('dnc','caution')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Mark must be dnc or caution' AS ResponseMess; RETURN; END
    IF @Source NOT IN ('caller','admin','upload')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Unknown source' AS ResponseMess; RETURN; END
    IF @Note IS NULL
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'A note is required' AS ResponseMess; RETURN; END

    DECLARE @Code INT, @Mess NVARCHAR(200), @MarkId INT, @Mobile10 VARCHAR(10) = CAST(@Mobile AS VARCHAR(10));
    BEGIN TRY
        BEGIN TRAN;
        EXEC dbo.sp_PhoneMarkApply @CompId = @CompId, @UserId = @UserId, @Mobile = @Mobile10, @Mark = @Mark,
             @Note = @Note, @Source = @Source, @Code = @Code OUTPUT, @Mess = @Mess OUTPUT, @MarkId = @MarkId OUTPUT;
        IF @Code = 200 COMMIT; ELSE ROLLBACK;
        SELECT ISNULL(@MarkId, 0) AS Id, @Code AS ResponseCode, @Mess AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 0 AS Id, CASE WHEN ERROR_NUMBER() IN (2601, 2627) THEN 409 ELSE 500 END AS ResponseCode,
               CASE WHEN ERROR_NUMBER() IN (2601, 2627) THEN N'This number was marked at the same moment; reload' ELSE ERROR_MESSAGE() END AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- sp_ClearPhoneMark: admin only (U6, Q4; also gated by the route), note
-- required, the row is kept. Contacts closed as dnc stay closed: an admin
-- recycles them deliberately (spec 11.6).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_ClearPhoneMark
    @CompId    INT,
    @UserId    INT,
    @Id        INT,
    @ClearNote NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET @ClearNote = NULLIF(LTRIM(RTRIM(@ClearNote)), N'');
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m
                   JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1 AND g.CompId = @CompId
                   WHERE m.UserId = @UserId)
    BEGIN SELECT @Id AS Id, 403 AS ResponseCode, 'Only an admin can clear a mark' AS ResponseMess; RETURN; END
    IF @ClearNote IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'A note is required' AS ResponseMess; RETURN; END

    UPDATE dbo.tblPhoneMark
       SET ClearedBy = @UserId, ClearedAt = GETDATE(), ClearNote = @ClearNote
     WHERE Id = @Id AND CompId = @CompId AND ClearedAt IS NULL;
    IF @@ROWCOUNT = 0
        SELECT @Id AS Id, 404 AS ResponseCode, 'Mark not found' AS ResponseMess;
    ELSE
        SELECT @Id AS Id, 200 AS ResponseCode, 'Mark cleared' AS ResponseMess;
END
GO

-- ---------------------------------------------------------------------------
-- sp_FetchPhoneMarks: live marks (@History = 1: cleared ones). Where the
-- number appears: the newest lead (only when the reader can see it), the
-- newest active customer, and the contact with its list (only when the
-- reader manages that list). A link the reader could not open is not offered.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchPhoneMarks
    @CompId     INT,
    @UserId     INT,
    @SearchTerm NVARCHAR(200) = NULL,
    @History    BIT           = 0,
    @PageNumber INT           = 1,
    @PageSize   INT           = 25
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize, 25) < 1 THEN 25 ELSE @PageSize END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    SET @History    = ISNULL(@History, 0);

    CREATE TABLE #VL (LeadId INT PRIMARY KEY);
    INSERT INTO #VL (LeadId) SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);
    CREATE TABLE #VC (CallListId INT PRIMARY KEY);
    INSERT INTO #VC (CallListId) SELECT CallListId FROM dbo.fn_VisibleCallLists(@CompId, @UserId);

    DECLARE @F TABLE (Id INT PRIMARY KEY, At DATETIME);
    INSERT INTO @F (Id, At)
    SELECT pm.Id, ISNULL(pm.ClearedAt, pm.SetAt)
    FROM dbo.tblPhoneMark pm
    WHERE pm.CompId = @CompId
      AND ((@History = 0 AND pm.ClearedAt IS NULL) OR (@History = 1 AND pm.ClearedAt IS NOT NULL))
      AND (@SearchTerm IS NULL OR pm.Mobile LIKE '%' + @SearchTerm + '%' OR pm.Note LIKE '%' + @SearchTerm + '%');
    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    SELECT pm.Id, pm.Mobile, pm.Mark, pm.Note, pm.Source, pm.SetBy,
           CAST(COALESCE(NULLIF(su.FullName, ''), su.Username) AS NVARCHAR(200)) AS SetByName, pm.SetAt,
           CAST(COALESCE(NULLIF(cu.FullName, ''), cu.Username) AS NVARCHAR(200)) AS ClearedByName,
           pm.ClearedAt, pm.ClearNote,
           ld.LeadId, cs.CustomerId, ct.ContactId, ct.CallListId,
           200 AS ResponseCode, 'Marks retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblPhoneMark pm ON pm.Id = f.Id
    LEFT JOIN dbo.tblUser su ON su.Id = pm.SetBy
    LEFT JOIN dbo.tblUser cu ON cu.Id = pm.ClearedBy
    OUTER APPLY (SELECT TOP (1) l.Id AS LeadId FROM dbo.tblLeads l JOIN #VL v ON v.LeadId = l.Id
                 WHERE l.CompId = @CompId AND (l.MobileNo = pm.Mobile OR l.AltMobile = pm.Mobile)
                 ORDER BY l.CreatedAt DESC, l.Id DESC) ld
    OUTER APPLY (SELECT TOP (1) c.Id AS CustomerId FROM dbo.tblCustomer c
                 WHERE c.CompId = @CompId AND c.IsActive = 1 AND (c.Mobile = pm.Mobile OR c.AltMobile = pm.Mobile)
                 ORDER BY c.Id DESC) cs
    OUTER APPLY (SELECT TOP (1) c.Id AS ContactId, c.CallListId FROM dbo.tblCallContact c JOIN #VC v ON v.CallListId = c.CallListId
                 WHERE c.CompId = @CompId AND (c.Mobile = pm.Mobile OR c.AltMobile = pm.Mobile)
                 ORDER BY c.Id DESC) ct
    ORDER BY f.At DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO
-- ===========================================================================
-- §8 distribution engine. A contact changes hands only in these procedures.
-- The pick (both hand-outs, spec 10.4):
--     ;WITH pick AS (SELECT TOP (@Need) c.* FROM dbo.tblCallContact c WITH (UPDLOCK, READPAST, ROWLOCK)
--                    WHERE c.CompId = @CompId AND c.CallListId = @L AND c.Status = 'pool'
--                      AND <the fn_CallEligible conditions, written on c itself>
--                    ORDER BY c.Priority DESC, c.Attempts, c.Id)
--     UPDATE pick SET Status = 'held', HeldBy = @To, HeldAt = GETDATE(), HeldVia = @Via, Priority = 0;
-- UPDLOCK + READPAST: two pickers in the same instant lock different rows; the
-- second skips the first one's rows instead of waiting or taking them. The
-- eligibility test sits on the hinted alias c, so it is evaluated on the row
-- under the U lock: a row another picker has just committed as 'held' fails
-- Status = 'pool' and is never overwritten. (fn_CallEligible stays for the
-- read-only counts.) IX_tblCallContact_Draw is keyed in the ORDER BY's order,
-- so TOP stops early and a concurrent picker is not starved into 0 rows.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- sp_TopUpCallList: automatic top-up for one caller. No result set (it runs
-- inside sp_SaveCallResult and sp_FetchMyCallList). Per-caller app lock, so a
-- double tap cannot draw twice; "need" is computed inside the lock. Nothing
-- outside calling hours, nothing for someone who can no longer add leads.
-- Per list the caller is on (AutoTopUp, list active, caller not paused),
-- oldest list first: refill only when they hold 0 from it (U5; callbacks do
-- not count as held, so a booked callback never blocks the next batch).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_TopUpCallList
    @CompId INT,
    @UserId INT,
    @Given  INT = 0 OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Given = 0;
    DECLARE @Now DATETIME = GETDATE();
    DECLARE @Min INT = DATEPART(HOUR, @Now) * 60 + DATEPART(MINUTE, @Now), @Start INT, @End INT;
    SELECT @Start = ISNULL(s.CallStartMin, 540), @End = ISNULL(s.CallEndMin, 1260)
    FROM (SELECT 1 AS x) d LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;
    IF @Min < @Start OR @Min >= @End RETURN;
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads') WHERE CanAdd = 1) RETURN;

    DECLARE @OwnTran BIT = CASE WHEN @@TRANCOUNT = 0 THEN 1 ELSE 0 END;
    DECLARE @Res NVARCHAR(255) = N'calltopup:' + CAST(@CompId AS NVARCHAR(12)) + N':' + CAST(@UserId AS NVARCHAR(12));
    DECLARE @rc INT, @L INT, @Need INT, @Held INT, @MaxAtt INT;
    BEGIN TRY
        IF @OwnTran = 1 BEGIN TRAN;
        EXEC @rc = sp_getapplock @Resource = @Res, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
        IF @rc < 0
        BEGIN
            IF @OwnTran = 1 ROLLBACK;
            RETURN;                                                   -- busy: the next refresh tops up
        END

        DECLARE lists CURSOR LOCAL FAST_FORWARD FOR
            SELECT l.Id, ISNULL(lc.HoldSize, l.HoldSize), l.MaxAttempts
            FROM dbo.tblCallListCaller lc
            JOIN dbo.tblCallList l ON l.Id = lc.CallListId AND l.CompId = lc.CompId
            WHERE lc.CompId = @CompId AND lc.UserId = @UserId AND lc.IsPaused = 0
              AND l.AutoTopUp = 1 AND l.Status = 'active'
            ORDER BY l.CreatedAt, l.Id;
        OPEN lists;
        FETCH NEXT FROM lists INTO @L, @Need, @MaxAtt;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SELECT @Held = COUNT(*) FROM dbo.tblCallContact
            WHERE CompId = @CompId AND CallListId = @L AND HeldBy = @UserId AND Status = 'held';
            IF @Held = 0 AND @Need > 0
            BEGIN
                ;WITH pick AS (
                    SELECT TOP (@Need) c.*
                    FROM dbo.tblCallContact c WITH (UPDLOCK, READPAST, ROWLOCK)
                    WHERE c.CompId = @CompId AND c.CallListId = @L
                      AND c.Status = 'pool'                                          -- eligibility ON the locked row (spec 10.1),
                      AND (c.NextEligibleAt IS NULL OR c.NextEligibleAt <= GETDATE())   -- never a second unlocked read
                      AND c.Attempts < @MaxAtt
                      AND NOT EXISTS (SELECT 1 FROM dbo.tblPhoneMark pm
                                      WHERE pm.CompId = c.CompId AND pm.ClearedAt IS NULL AND pm.Mark = 'dnc'
                                        AND pm.Mobile IN (c.Mobile, c.AltMobile))
                    ORDER BY c.Priority DESC, c.Attempts, c.Id
                )
                UPDATE pick SET Status = 'held', HeldBy = @UserId, HeldAt = @Now, HeldVia = 'auto', Priority = 0;
                SET @Given = @Given + @@ROWCOUNT;
            END
            FETCH NEXT FROM lists INTO @L, @Need, @MaxAtt;
        END
        CLOSE lists; DEALLOCATE lists;

        IF @OwnTran = 1 COMMIT;
    END TRY
    BEGIN CATCH
        -- a LOCAL cursor is deallocated when the procedure ends
        IF @OwnTran = 1 AND @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- sp_AssignCallContacts: manual hand-out. @AssignJson [{UserId, Count}]
-- ("Ramesh gets 30"; the client splits "N equally" into this shape) or
-- @ContactIdsJson (<= 500 exact rows, still eligible ones only) + @ToUserId.
-- No cap and not blocked by calling hours; refused on a paused / archived list.
-- Every receiver must be one the giver may already hand a lead to (403, nothing
-- handed out). A receiver not on the list is added, paused for top-up.
-- One in-app notice per receiver. RS1 status + Given, Asked; RS2 UserId,
-- Given; RS3 notified UserId.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_AssignCallContacts
    @CompId         INT,
    @UserId         INT,
    @CallListId     INT,
    @AssignJson     NVARCHAR(MAX) = NULL,
    @ContactIdsJson NVARCHAR(MAX) = NULL,
    @ToUserId       INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Code INT = 200, @Mess NVARCHAR(300) = NULL, @Given INT = 0, @Asked INT = 0,
            @ListStatus VARCHAR(10), @ListName NVARCHAR(200), @ListBranch INT, @Now DATETIME = GETDATE();
    DECLARE @T TABLE (UserId INT PRIMARY KEY, Asked INT NOT NULL, Given INT NOT NULL DEFAULT 0);
    DECLARE @Ids TABLE (Id INT PRIMARY KEY);
    DECLARE @Ntf TABLE (UserId INT);
    DECLARE @n INT = 0;

    IF NOT EXISTS (SELECT 1 FROM dbo.fn_VisibleCallLists(@CompId, @UserId) WHERE CallListId = @CallListId)
    BEGIN SELECT @Code = 404, @Mess = N'Calling list not found'; GOTO Answer; END
    DECLARE @MaxAtt INT;
    SELECT @ListStatus = Status, @ListName = Name, @ListBranch = BranchId, @MaxAtt = MaxAttempts
    FROM dbo.tblCallList WHERE Id = @CallListId AND CompId = @CompId;
    IF @ListStatus <> 'active'
    BEGIN SELECT @Code = 409, @Mess = CASE WHEN @ListStatus = 'paused' THEN N'This list is paused; nothing can be handed out'
                                          ELSE N'This list is archived' END; GOTO Answer; END

    BEGIN TRY
        IF @ContactIdsJson IS NOT NULL AND ISJSON(@ContactIdsJson) = 1
        BEGIN
            INSERT INTO @Ids (Id) SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(@ContactIdsJson) WHERE TRY_CAST(value AS INT) > 0;
            IF NOT EXISTS (SELECT 1 FROM @Ids) OR ISNULL(@ToUserId, 0) <= 0
            BEGIN SELECT @Code = 400, @Mess = N'Pick the contacts and the person to give them to'; GOTO Answer; END
            IF (SELECT COUNT(*) FROM @Ids) > 500
            BEGIN SELECT @Code = 400, @Mess = N'At most 500 contacts at once'; GOTO Answer; END
            INSERT INTO @T (UserId, Asked) SELECT @ToUserId, COUNT(*) FROM @Ids;
        END
        ELSE IF @AssignJson IS NOT NULL AND ISJSON(@AssignJson) = 1
            INSERT INTO @T (UserId, Asked)
            SELECT j.UserId, SUM(j.Cnt) FROM OPENJSON(@AssignJson) WITH (UserId INT, Cnt INT '$.Count') j
            WHERE j.UserId > 0 AND j.Cnt > 0
            GROUP BY j.UserId;
    END TRY
    BEGIN CATCH
        SELECT @Code = 400, @Mess = N'Hand-out could not be read'; GOTO Answer;
    END CATCH
    IF NOT EXISTS (SELECT 1 FROM @T)
    BEGIN SELECT @Code = 400, @Mess = N'Say who gets how many'; GOTO Answer; END
    IF EXISTS (SELECT 1 FROM @T t WHERE NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(@CompId, @UserId, 'leads', NULL) a WHERE a.Id = t.UserId))
    BEGIN SELECT @Code = 403, @Mess = N'You cannot give contacts to that person'; GOTO Answer; END
    SET @Asked = (SELECT SUM(Asked) FROM @T);

    BEGIN TRY
        BEGIN TRAN;
        INSERT INTO dbo.tblCallListCaller (CallListId, UserId, CompId, IsPaused, AddedBy)
        SELECT @CallListId, t.UserId, @CompId, 1, @UserId FROM @T t
        WHERE NOT EXISTS (SELECT 1 FROM dbo.tblCallListCaller lc WHERE lc.CallListId = @CallListId AND lc.UserId = t.UserId);

        IF EXISTS (SELECT 1 FROM @Ids)
        BEGIN
            UPDATE c SET Status = 'held', HeldBy = @ToUserId, HeldAt = @Now, HeldVia = 'manual', Priority = 0
            FROM dbo.tblCallContact c WITH (UPDLOCK, READPAST, ROWLOCK)
            WHERE c.CompId = @CompId AND c.CallListId = @CallListId
              AND c.Id IN (SELECT Id FROM @Ids)
              AND c.Status = 'pool'                                  -- eligibility ON the locked row (spec 10.1),
              AND (c.NextEligibleAt IS NULL OR c.NextEligibleAt <= GETDATE())   -- never a second unlocked read
              AND c.Attempts < @MaxAtt
              AND NOT EXISTS (SELECT 1 FROM dbo.tblPhoneMark pm
                              WHERE pm.CompId = c.CompId AND pm.ClearedAt IS NULL AND pm.Mark = 'dnc'
                                AND pm.Mobile IN (c.Mobile, c.AltMobile));
            SET @n = @@ROWCOUNT;
            UPDATE @T SET Given = @n;
        END
        ELSE
        BEGIN
            DECLARE @To INT, @Need INT;
            DECLARE tg CURSOR LOCAL FAST_FORWARD FOR SELECT UserId, Asked FROM @T ORDER BY UserId;
            OPEN tg;
            FETCH NEXT FROM tg INTO @To, @Need;
            WHILE @@FETCH_STATUS = 0
            BEGIN
                ;WITH pick AS (
                    SELECT TOP (@Need) c.*
                    FROM dbo.tblCallContact c WITH (UPDLOCK, READPAST, ROWLOCK)
                    WHERE c.CompId = @CompId AND c.CallListId = @CallListId
                      AND c.Status = 'pool'                                          -- eligibility ON the locked row (spec 10.1),
                      AND (c.NextEligibleAt IS NULL OR c.NextEligibleAt <= GETDATE())   -- never a second unlocked read
                      AND c.Attempts < @MaxAtt
                      AND NOT EXISTS (SELECT 1 FROM dbo.tblPhoneMark pm
                                      WHERE pm.CompId = c.CompId AND pm.ClearedAt IS NULL AND pm.Mark = 'dnc'
                                        AND pm.Mobile IN (c.Mobile, c.AltMobile))
                    ORDER BY c.Priority DESC, c.Attempts, c.Id
                )
                UPDATE pick SET Status = 'held', HeldBy = @To, HeldAt = @Now, HeldVia = 'manual', Priority = 0;
                SET @n = @@ROWCOUNT;
                UPDATE @T SET Given = @n WHERE UserId = @To;
                FETCH NEXT FROM tg INTO @To, @Need;
            END
            CLOSE tg; DEALLOCATE tg;
        END
        SET @Given = (SELECT SUM(Given) FROM @T);

        INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
        OUTPUT inserted.UserId INTO @Ntf (UserId)
        SELECT t.UserId, 'call_assigned', 'call_list', @CallListId, @UserId,
               CAST(t.Given AS VARCHAR(10)) + CASE WHEN t.Given = 1 THEN ' contact to call' ELSE ' contacts to call' END,
               LEFT(@ListName, 1000), @CompId, @ListBranch
        FROM @T t
        JOIN dbo.tblUser r ON r.Id = t.UserId AND r.CompId = @CompId AND r.IsActive = 1
        WHERE t.Given > 0 AND t.UserId <> @UserId
          AND NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                          WHERE np.UserId = t.UserId AND np.Type = 'call_assigned' AND np.Channel = 'inapp' AND np.IsEnabled = 0);
        COMMIT;
        SET @Mess = CASE WHEN @Given < @Asked THEN CAST(@Given AS NVARCHAR(10)) + N' given, the list has no more'
                         ELSE CAST(@Given AS NVARCHAR(10)) + N' contacts given' END;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @Code = 500, @Mess = ERROR_MESSAGE(), @Given = 0;
        DELETE FROM @Ntf; UPDATE @T SET Given = 0;
    END CATCH

Answer:
    SELECT @CallListId AS Id, @Code AS ResponseCode, @Mess AS ResponseMess, @Given AS Given, @Asked AS Asked;
    SELECT UserId, Given FROM @T WHERE @Code = 200;
    SELECT DISTINCT UserId FROM @Ntf;
END
GO

-- ---------------------------------------------------------------------------
-- sp_RecallCallContacts: pull back held contacts to the pool, no try counted.
-- By caller (@FromUserId), by ids, or the whole list. Callbacks only with
-- @IncludeCallbacks = 1.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_RecallCallContacts
    @CompId           INT,
    @UserId           INT,
    @CallListId       INT,
    @FromUserId       INT           = NULL,
    @ContactIdsJson   NVARCHAR(MAX) = NULL,
    @IncludeCallbacks BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_VisibleCallLists(@CompId, @UserId) WHERE CallListId = @CallListId)
    BEGIN SELECT @CallListId AS Id, 404 AS ResponseCode, 'Calling list not found' AS ResponseMess, 0 AS Recalled; RETURN; END
    IF @FromUserId <= 0 SET @FromUserId = NULL;
    DECLARE @Ids TABLE (Id INT PRIMARY KEY);
    DECLARE @ByIds BIT = 0;
    IF @ContactIdsJson IS NOT NULL
    BEGIN
        IF ISJSON(@ContactIdsJson) <> 1
        BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'Contacts must be a JSON array' AS ResponseMess, 0 AS Recalled; RETURN; END
        INSERT INTO @Ids (Id) SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(@ContactIdsJson) WHERE TRY_CAST(value AS INT) > 0;
        SET @ByIds = 1;
    END

    UPDATE dbo.tblCallContact
       SET Status = 'pool', HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
           CallbackAt = NULL, CallbackReleaseAt = NULL, CallbackWarnedAt = NULL, CallbackNotifiedAt = NULL
     WHERE CompId = @CompId AND CallListId = @CallListId
       AND (Status = 'held' OR (Status = 'callback' AND ISNULL(@IncludeCallbacks, 0) = 1))
       AND (@FromUserId IS NULL OR HeldBy = @FromUserId)
       AND (@ByIds = 0 OR Id IN (SELECT Id FROM @Ids));
    DECLARE @n INT = @@ROWCOUNT;
    SELECT @CallListId AS Id, 200 AS ResponseCode,
           CAST(@n AS VARCHAR(10)) + ' contact(s) pulled back' AS ResponseMess, @n AS Recalled;
END
GO

-- ---------------------------------------------------------------------------
-- sp_SetCallContactState (<= 500 ids):
--   remove   -> pool / held / callback rows become closed / removed (never a lead)
--   recycle  -> closed rows with reason no_response / not_interested, or dnc once
--               its mark is cleared (spec 11.6), and no live dnc on either number,
--               back to the pool with tries reset; RecycledAt / RecycledBy stamped
--   move     -> callback rows to @ToUserId (gated like a hand-out; callback cap)
--   priority -> Priority 5 on pool rows
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SetCallContactState
    @CompId         INT,
    @UserId         INT,
    @CallListId     INT,
    @ContactIdsJson NVARCHAR(MAX),
    @Action         VARCHAR(10),
    @ToUserId       INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ids TABLE (Id INT PRIMARY KEY);
    DECLARE @n INT = 0, @Cap INT;
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_VisibleCallLists(@CompId, @UserId) WHERE CallListId = @CallListId)
    BEGIN SELECT @CallListId AS Id, 404 AS ResponseCode, 'Calling list not found' AS ResponseMess, 0 AS Changed; RETURN; END
    IF @Action IS NULL OR @Action NOT IN ('remove','recycle','move','priority')
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'Action must be remove, recycle, move or priority' AS ResponseMess, 0 AS Changed; RETURN; END
    IF ISJSON(ISNULL(@ContactIdsJson, '')) <> 1
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'Contacts must be a JSON array' AS ResponseMess, 0 AS Changed; RETURN; END
    INSERT INTO @Ids (Id) SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(@ContactIdsJson) WHERE TRY_CAST(value AS INT) > 0;
    IF NOT EXISTS (SELECT 1 FROM @Ids)
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'No contacts supplied' AS ResponseMess, 0 AS Changed; RETURN; END
    IF (SELECT COUNT(*) FROM @Ids) > 500
    BEGIN SELECT @CallListId AS Id, 400 AS ResponseCode, 'At most 500 contacts at once' AS ResponseMess, 0 AS Changed; RETURN; END

    IF @Action = 'move'
    BEGIN
        IF ISNULL(@ToUserId, 0) <= 0
           OR NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(@CompId, @UserId, 'leads', NULL) a WHERE a.Id = @ToUserId)
        BEGIN SELECT @CallListId AS Id, 403 AS ResponseCode, 'You cannot give contacts to that person' AS ResponseMess, 0 AS Changed; RETURN; END
        SELECT @Cap = ISNULL(s.CallbackCap, 20) FROM (SELECT 1 AS x) d LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;
    END

    BEGIN TRY
        BEGIN TRAN;
        IF @Action = 'remove'
        BEGIN
            UPDATE dbo.tblCallContact
               SET Status = 'closed', CloseReason = 'removed', HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
                   CallbackAt = NULL, CallbackReleaseAt = NULL, Priority = 0
             WHERE CompId = @CompId AND CallListId = @CallListId AND Id IN (SELECT Id FROM @Ids)
               AND Status IN ('pool','held','callback');
            SET @n = @@ROWCOUNT;
        END
        ELSE IF @Action = 'recycle'
        BEGIN
            UPDATE c
               SET Status = 'pool', CloseReason = NULL, Attempts = 0, NextEligibleAt = NULL, Priority = 0,
                   RecycledAt = GETDATE(), RecycledBy = @UserId
            FROM dbo.tblCallContact c
            WHERE c.CompId = @CompId AND c.CallListId = @CallListId AND c.Id IN (SELECT Id FROM @Ids)
              AND c.Status = 'closed' AND c.CloseReason IN ('no_response','not_interested','dnc')
              AND NOT EXISTS (SELECT 1 FROM dbo.tblPhoneMark pm
                              WHERE pm.CompId = @CompId AND pm.ClearedAt IS NULL AND pm.Mark = 'dnc'
                                AND pm.Mobile IN (c.Mobile, c.AltMobile));
            SET @n = @@ROWCOUNT;
        END
        ELSE IF @Action = 'move'
        BEGIN
            DECLARE @Moving INT = (SELECT COUNT(*) FROM dbo.tblCallContact WITH (UPDLOCK, HOLDLOCK)
                                   WHERE CompId = @CompId AND CallListId = @CallListId AND Id IN (SELECT Id FROM @Ids)
                                     AND Status = 'callback' AND HeldBy <> @ToUserId);
            IF (SELECT COUNT(*) FROM dbo.tblCallContact WHERE CompId = @CompId AND HeldBy = @ToUserId AND Status = 'callback') + @Moving > @Cap
            BEGIN
                ROLLBACK;
                SELECT @CallListId AS Id, 409 AS ResponseCode,
                       'That person would hold more than ' + CAST(@Cap AS VARCHAR(10)) + ' callbacks' AS ResponseMess, 0 AS Changed;
                RETURN;
            END
            INSERT INTO dbo.tblCallListCaller (CallListId, UserId, CompId, IsPaused, AddedBy)
            SELECT @CallListId, @ToUserId, @CompId, 1, @UserId
            WHERE NOT EXISTS (SELECT 1 FROM dbo.tblCallListCaller WHERE CallListId = @CallListId AND UserId = @ToUserId);
            UPDATE dbo.tblCallContact
               SET HeldBy = @ToUserId, HeldAt = GETDATE(), HeldVia = 'manual',
                   CallbackWarnedAt = NULL, CallbackNotifiedAt = NULL
             WHERE CompId = @CompId AND CallListId = @CallListId AND Id IN (SELECT Id FROM @Ids)
               AND Status = 'callback' AND HeldBy <> @ToUserId;
            SET @n = @@ROWCOUNT;
        END
        ELSE
        BEGIN
            UPDATE dbo.tblCallContact SET Priority = 5
             WHERE CompId = @CompId AND CallListId = @CallListId AND Id IN (SELECT Id FROM @Ids) AND Status = 'pool';
            SET @n = @@ROWCOUNT;
        END
        COMMIT;
        SELECT @CallListId AS Id, 200 AS ResponseCode, CAST(@n AS VARCHAR(10)) + ' contact(s) changed' AS ResponseMess, @n AS Changed;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @CallListId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess, 0 AS Changed;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- sp_FetchMyCallList: the caller's phone screen. Only HeldBy = @UserId, ever.
-- RS1 head  ToCall, Callbacks, CalledToday, Given, OutsideHours, EmptyReason,
--           CallbackCap, Active
-- RS2 to call  (held by me, HeldAt, Id)
-- RS3 callbacks (callback by me, by CallbackAt)
-- RS4 done today: a record — AttemptId, ContactId, Name, Result, CalledAt,
--     LeadId, CanUndo. No number, nothing to call.
-- RS5 lists behind RS2 / RS3 and the lists I am on: CallListId, Name, Script
-- A contact with a saved result is in neither RS2 nor RS3 (its status moved
-- in the same transaction as the result).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchMyCallList
    @CompId INT,
    @UserId INT,
    @TopUp  BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Given INT = 0, @Now DATETIME = GETDATE();
    DECLARE @Today DATETIME = CAST(CAST(@Now AS DATE) AS DATETIME);
    IF ISNULL(@TopUp, 1) = 1
    BEGIN TRY
        EXEC dbo.sp_TopUpCallList @CompId = @CompId, @UserId = @UserId, @Given = @Given OUTPUT;
    END TRY
    BEGIN CATCH
        SET @Given = 0;                                 -- the list still loads; the next refresh tops up
    END CATCH

    DECLARE @Min INT = DATEPART(HOUR, @Now) * 60 + DATEPART(MINUTE, @Now), @Start INT, @End INT, @Cap INT;
    SELECT @Start = ISNULL(s.CallStartMin, 540), @End = ISNULL(s.CallEndMin, 1260), @Cap = ISNULL(s.CallbackCap, 20)
    FROM (SELECT 1 AS x) d LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;
    DECLARE @Outside BIT = CASE WHEN @Min < @Start OR @Min >= @End THEN 1 ELSE 0 END;

    DECLARE @ToCall INT, @Cb INT, @CalledToday INT;
    SELECT @ToCall = SUM(CASE WHEN Status = 'held' THEN 1 ELSE 0 END),
           @Cb     = SUM(CASE WHEN Status = 'callback' THEN 1 ELSE 0 END)
    FROM dbo.tblCallContact WHERE CompId = @CompId AND HeldBy = @UserId AND Status IN ('held','callback');
    SELECT @CalledToday = COUNT(*) FROM dbo.tblCallAttempt
    WHERE CompId = @CompId AND UserId = @UserId AND UndoneAt IS NULL AND CalledAt >= @Today;

    -- the lists I am on, not archived
    DECLARE @Mine TABLE (CallListId INT PRIMARY KEY, Usable BIT NOT NULL, Auto BIT NOT NULL);
    INSERT INTO @Mine (CallListId, Usable, Auto)
    SELECT l.Id,
           CASE WHEN l.Status = 'active' AND lc.IsPaused = 0 THEN 1 ELSE 0 END,
           CASE WHEN l.Status = 'active' AND lc.IsPaused = 0 AND l.AutoTopUp = 1 THEN 1 ELSE 0 END
    FROM dbo.tblCallListCaller lc
    JOIN dbo.tblCallList l ON l.Id = lc.CallListId AND l.CompId = lc.CompId
    WHERE lc.CompId = @CompId AND lc.UserId = @UserId AND l.Status <> 'archived';

    DECLARE @Empty VARCHAR(10) = NULL;
    IF ISNULL(@ToCall, 0) = 0
        SET @Empty = CASE
            WHEN @Outside = 1 THEN 'hours'
            WHEN EXISTS (SELECT 1 FROM @Mine) AND NOT EXISTS (SELECT 1 FROM @Mine WHERE Usable = 1) THEN 'paused'
            WHEN EXISTS (SELECT 1 FROM @Mine WHERE Auto = 1)
                 AND NOT EXISTS (SELECT 1 FROM @Mine m CROSS APPLY dbo.fn_CallEligible(@CompId, m.CallListId) e WHERE m.Auto = 1)
                 THEN 'finished'
            ELSE 'manual' END;

    -- RS1
    SELECT ISNULL(@ToCall, 0) AS ToCall, ISNULL(@Cb, 0) AS Callbacks, ISNULL(@CalledToday, 0) AS CalledToday,
           ISNULL(@Given, 0) AS Given, @Outside AS OutsideHours, @Empty AS EmptyReason, @Cap AS CallbackCap,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM @Mine) OR ISNULL(@ToCall, 0) + ISNULL(@Cb, 0) > 0 THEN 1 ELSE 0 END AS BIT) AS Active;

    -- RS2 to call
    SELECT c.Id, c.CallListId, l.Name AS ListName, c.Name, c.Company, c.City, c.State, c.Mobile, c.AltMobile,
           c.Extra, c.Attempts, c.LastResult, c.LastCalledAt, c.CallbackAt, mk.Mark AS PhoneMark, mk.Note AS PhoneMarkNote
    FROM dbo.tblCallContact c
    JOIN dbo.tblCallList l ON l.Id = c.CallListId
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (c.Mobile, c.AltMobile)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk
    WHERE c.CompId = @CompId AND c.HeldBy = @UserId AND c.Status = 'held'
    ORDER BY c.HeldAt, c.Id;

    -- RS3 callbacks
    SELECT c.Id, c.CallListId, l.Name AS ListName, c.Name, c.Company, c.City, c.State, c.Mobile, c.AltMobile,
           c.Extra, c.Attempts, c.LastResult, c.LastCalledAt, c.CallbackAt, mk.Mark AS PhoneMark, mk.Note AS PhoneMarkNote
    FROM dbo.tblCallContact c
    JOIN dbo.tblCallList l ON l.Id = c.CallListId
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (c.Mobile, c.AltMobile)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk
    WHERE c.CompId = @CompId AND c.HeldBy = @UserId AND c.Status = 'callback'
    ORDER BY c.CallbackAt, c.Id;

    -- RS4 done today (a record: name, result, time)
    SELECT a.Id AS AttemptId, a.ContactId, c.Name, a.Result, a.CalledAt, a.LeadId,
           CAST(CASE WHEN a.Result NOT IN ('interested','dnc')
                      AND a.CalledAt >= DATEADD(MINUTE, -2, @Now)
                      AND NOT EXISTS (SELECT 1 FROM dbo.tblCallAttempt n
                                      WHERE n.ContactId = a.ContactId AND n.Id > a.Id AND n.UndoneAt IS NULL)
                      AND c.Status <> 'lead'
                      AND NOT (c.Status IN ('held','callback') AND c.HeldBy <> @UserId)
                     THEN 1 ELSE 0 END AS BIT) AS CanUndo
    FROM dbo.tblCallAttempt a
    JOIN dbo.tblCallContact c ON c.Id = a.ContactId
    WHERE a.CompId = @CompId AND a.UserId = @UserId AND a.UndoneAt IS NULL AND a.CalledAt >= @Today
    ORDER BY a.CalledAt DESC, a.Id DESC;

    -- RS5 lists
    SELECT l.Id AS CallListId, l.Name, l.Script
    FROM dbo.tblCallList l
    WHERE l.CompId = @CompId
      AND (   l.Id IN (SELECT CallListId FROM @Mine)
           OR l.Id IN (SELECT CallListId FROM dbo.tblCallContact
                       WHERE CompId = @CompId AND HeldBy = @UserId AND Status IN ('held','callback')))
    ORDER BY l.Name;
END
GO

-- ---------------------------------------------------------------------------
-- sp_SaveCallResult (spec 10.5). 404 "Contact not found" when the caller holds
-- it not and never called it; 409 "This contact is no longer on your list"
-- when they called it and it has left (also what makes a double submit
-- harmless). 'interested' goes through sp_SaveLead (@CallContactId).
--   no_answer / busy   -> pool, +1 try, retry gap (busy 1 h); last try -> closed / no_response
--   callback, no time  -> pool tomorrow 10:00, no try counted (someone answered)
--   callback, a time   -> stays mine as a booked callback (cap per company setting)
--   not_interested / wrong_number -> closed
--   dnc                -> closed + a dnc mark on the number (note required)
-- Every branch writes one tblCallAttempt row, then tops up in the same
-- transaction. Status row: Id = the attempt, + Given.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveCallResult
    @CompId            INT,
    @UserId            INT,
    @ContactId         INT,
    @Result            VARCHAR(16),
    @Notes             NVARCHAR(1000) = NULL,
    @DialedAt          DATETIME       = NULL,
    @CallbackAt        DATETIME       = NULL,
    @CallbackReleaseAt DATETIME       = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE(), @Given INT = 0, @AttemptId INT = 0;
    SET @Notes = NULLIF(LTRIM(RTRIM(@Notes)), N'');
    IF @DialedAt > @Now SET @DialedAt = NULL;           -- a clock ahead of the server is not a dial time

    IF @Result = 'interested'
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Use convert to turn an interested contact into a lead' AS ResponseMess, 0 AS Given; RETURN; END
    IF @Result IS NULL OR @Result NOT IN ('not_interested','wrong_number','no_answer','busy','callback','dnc')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Unknown result' AS ResponseMess, 0 AS Given; RETURN; END
    IF @Result = 'dnc' AND @Notes IS NULL
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'A note is required' AS ResponseMess, 0 AS Given; RETURN; END
    IF @Result <> 'callback' SET @CallbackAt = NULL;
    IF @CallbackAt IS NOT NULL AND @CallbackAt <= @Now
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Pick a callback time in the future' AS ResponseMess, 0 AS Given; RETURN; END

    DECLARE @Status VARCHAR(10), @HeldBy INT, @ListId INT, @Attempts INT, @Mobile VARCHAR(10),
            @MaxAttempts INT, @GapHours INT, @Cap INT, @MyCallbacks INT,
            @MCode INT, @MMess NVARCHAR(200), @MarkId INT;
    BEGIN TRY
        BEGIN TRAN;
        SELECT @Status = Status, @HeldBy = HeldBy, @ListId = CallListId, @Attempts = Attempts, @Mobile = Mobile
        FROM dbo.tblCallContact WITH (UPDLOCK, HOLDLOCK)
        WHERE Id = @ContactId AND CompId = @CompId;

        IF NOT (ISNULL(@Status, '') IN ('held','callback') AND @HeldBy = @UserId)
        BEGIN
            ROLLBACK;
            IF @Status IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.tblCallAttempt
                                               WHERE ContactId = @ContactId AND CompId = @CompId AND UserId = @UserId)
                SELECT 0 AS Id, 409 AS ResponseCode, 'This contact is no longer on your list' AS ResponseMess, 0 AS Given;
            ELSE
                SELECT 0 AS Id, 404 AS ResponseCode, 'Contact not found' AS ResponseMess, 0 AS Given;
            RETURN;
        END

        SELECT @MaxAttempts = MaxAttempts, @GapHours = RetryGapHours FROM dbo.tblCallList WHERE Id = @ListId;

        IF @CallbackAt IS NOT NULL AND @Status <> 'callback'
        BEGIN
            SELECT @Cap = ISNULL(s.CallbackCap, 20) FROM (SELECT 1 AS x) d LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;
            SELECT @MyCallbacks = COUNT(*) FROM dbo.tblCallContact WHERE CompId = @CompId AND HeldBy = @UserId AND Status = 'callback';
            IF @MyCallbacks >= @Cap
            BEGIN
                ROLLBACK;
                SELECT 0 AS Id, 409 AS ResponseCode,
                       'You already have ' + CAST(@Cap AS VARCHAR(10)) + ' callbacks booked' AS ResponseMess, 0 AS Given;
                RETURN;
            END
        END

        -- a booked callback that is now being made was kept
        IF @Status = 'callback'
            UPDATE dbo.tblCallAttempt SET CallbackOutcome = 'kept'
            WHERE Id = (SELECT MAX(Id) FROM dbo.tblCallAttempt
                        WHERE ContactId = @ContactId AND Result = 'callback' AND CallbackAt IS NOT NULL AND UndoneAt IS NULL);

        INSERT INTO dbo.tblCallAttempt (CompId, ContactId, CallListId, UserId, Result, Notes, DialedAt, CalledAt, CallbackAt, AttemptsBefore)
        VALUES (@CompId, @ContactId, @ListId, @UserId, @Result, @Notes, @DialedAt, @Now, @CallbackAt, @Attempts);
        SET @AttemptId = CAST(SCOPE_IDENTITY() AS INT);

        -- the contact's next state, then ONE update (the holder CHECKs are per statement)
        DECLARE @NewStatus VARCHAR(10), @NewReason VARCHAR(16) = NULL, @NewAttempts INT = @Attempts, @NextElig DATETIME = NULL;
        IF @Result IN ('no_answer','busy')
        BEGIN
            SET @NewAttempts = @Attempts + 1;
            IF @NewAttempts >= @MaxAttempts
                SELECT @NewStatus = 'closed', @NewReason = 'no_response';
            ELSE
                SELECT @NewStatus = 'pool',
                       @NextElig = CASE WHEN @Result = 'busy' THEN DATEADD(HOUR, 1, @Now) ELSE DATEADD(HOUR, @GapHours, @Now) END;
        END
        ELSE IF @Result = 'callback' AND @CallbackAt IS NULL
            SELECT @NewStatus = 'pool', @NextElig = DATEADD(HOUR, 10, CAST(DATEADD(DAY, 1, CAST(@Now AS DATE)) AS DATETIME));
        ELSE IF @Result = 'callback'
            SET @NewStatus = 'callback';
        ELSE   -- not_interested, wrong_number, dnc
            SELECT @NewStatus = 'closed', @NewReason = @Result;

        UPDATE dbo.tblCallContact
           SET Status = @NewStatus, CloseReason = @NewReason, Attempts = @NewAttempts, NextEligibleAt = @NextElig,
               HeldBy  = CASE WHEN @NewStatus = 'callback' THEN @UserId END,
               HeldAt  = CASE WHEN @NewStatus = 'callback' THEN HeldAt END,
               HeldVia = CASE WHEN @NewStatus = 'callback' THEN HeldVia END,
               CallbackAt = CASE WHEN @NewStatus = 'callback' THEN @CallbackAt END,
               CallbackReleaseAt = CASE WHEN @NewStatus = 'callback'
                                        THEN ISNULL(@CallbackReleaseAt, DATEADD(DAY, 2, CAST(CAST(@CallbackAt AS DATE) AS DATETIME))) END,
               CallbackWarnedAt = NULL, CallbackNotifiedAt = NULL,
               LastResult = @Result, LastCalledAt = @Now, LastCalledBy = @UserId, Priority = 0
         WHERE Id = @ContactId;

        IF @Result = 'dnc'
        BEGIN
            EXEC dbo.sp_PhoneMarkApply @CompId = @CompId, @UserId = @UserId, @Mobile = @Mobile, @Mark = 'dnc',
                 @Note = @Notes, @Source = 'caller', @Code = @MCode OUTPUT, @Mess = @MMess OUTPUT, @MarkId = @MarkId OUTPUT;
        END

        -- a failed top-up must not undo the saved result: savepoint, catch, Given = 0
        SAVE TRANSACTION topup149;
        BEGIN TRY
            EXEC dbo.sp_TopUpCallList @CompId = @CompId, @UserId = @UserId, @Given = @Given OUTPUT;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() = -1 THROW;                 -- a doomed transaction cannot keep the result either
            ROLLBACK TRANSACTION topup149;
            SET @Given = 0;
        END CATCH
        COMMIT;
        SELECT @AttemptId AS Id, 200 AS ResponseCode, 'Saved' AS ResponseMess, ISNULL(@Given, 0) AS Given;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 0 AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess, 0 AS Given;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- sp_UndoCallResult: a wrong tap, within 2 minutes (Q9). Allowed only while
-- RS4's CanUndo holds: my attempt, not undone, not interested / dnc, the
-- contact's newest live attempt, and the contact is not a lead and not with
-- someone else. The contact returns to me as held, tries as before.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_UndoCallResult
    @CompId    INT,
    @UserId    INT,
    @AttemptId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ContactId INT, @Result VARCHAR(16), @CalledAt DATETIME, @Undone DATETIME, @Before INT,
            @Status VARCHAR(10), @HeldBy INT;
    SELECT @ContactId = ContactId, @Result = Result, @CalledAt = CalledAt, @Undone = UndoneAt, @Before = AttemptsBefore
    FROM dbo.tblCallAttempt WHERE Id = @AttemptId AND CompId = @CompId AND UserId = @UserId;
    IF @ContactId IS NULL
    BEGIN SELECT @AttemptId AS Id, 404 AS ResponseCode, 'Contact not found' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        SELECT @Status = Status, @HeldBy = HeldBy
        FROM dbo.tblCallContact WITH (UPDLOCK, HOLDLOCK) WHERE Id = @ContactId AND CompId = @CompId;

        IF @Undone IS NOT NULL OR @Result IN ('interested','dnc') OR @CalledAt < DATEADD(MINUTE, -2, GETDATE())
           OR @Status = 'lead' OR (@Status IN ('held','callback') AND @HeldBy <> @UserId)
           OR EXISTS (SELECT 1 FROM dbo.tblCallAttempt WHERE ContactId = @ContactId AND Id > @AttemptId AND UndoneAt IS NULL)
        BEGIN
            ROLLBACK;
            SELECT @AttemptId AS Id, 409 AS ResponseCode, 'This can no longer be undone; ask your manager' AS ResponseMess;
            RETURN;
        END

        UPDATE dbo.tblCallAttempt SET UndoneAt = GETDATE() WHERE Id = @AttemptId;
        UPDATE c
           SET Status = 'held', HeldBy = @UserId, HeldAt = GETDATE(), HeldVia = ISNULL(c.HeldVia, 'manual'),
               Attempts = @Before, CloseReason = NULL, NextEligibleAt = NULL,
               CallbackAt = NULL, CallbackReleaseAt = NULL, CallbackWarnedAt = NULL, CallbackNotifiedAt = NULL,
               LastResult = la.Result, LastCalledAt = la.CalledAt, LastCalledBy = la.UserId
        FROM dbo.tblCallContact c
        OUTER APPLY (SELECT TOP (1) a.Result, a.CalledAt, a.UserId FROM dbo.tblCallAttempt a
                     WHERE a.ContactId = c.Id AND a.UndoneAt IS NULL ORDER BY a.Id DESC) la
        WHERE c.Id = @ContactId;
        COMMIT;
        SELECT @AttemptId AS Id, 200 AS ResponseCode, 'Undone' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @AttemptId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO
-- ===========================================================================
-- §9 sp_CallSweep — every minute per live company from jobs/sweep.js. Every
-- stamp is IS NULL-guarded, so a second tick or a second container cannot
-- double-fire. RS1 = notified UserId rows.
--   (a) a booked callback due within 10 minutes -> remind the holder
--   (b) a callback past its cut-off (CallbackReleaseAt, worked out in Node on
--       the working calendar), or due today while the holder has a full-day
--       leave mark -> back to the pool at the front (Priority 9), the booking
--       marked missed, the list's creator / last editor told (resolving every
--       manager whose reach covers the office is too heavy for a minute sweep)
--   (c) held / callback contacts of someone inactive or no longer able to add
--       leads -> back to the pool
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_CallSweep
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();
    DECLARE @Warn   TABLE (ContactId INT, UserId INT, BranchId INT, Who NVARCHAR(200), At DATETIME);
    DECLARE @Missed TABLE (ContactId INT, CallListId INT, BranchId INT);
    DECLARE @Gone   TABLE (UserId INT PRIMARY KEY);
    DECLARE @Ntf    TABLE (UserId INT);

    BEGIN TRY
        BEGIN TRAN;

        -- (a)
        UPDATE c SET CallbackWarnedAt = @Now
        OUTPUT inserted.Id, inserted.HeldBy, inserted.BranchId, ISNULL(inserted.Name, inserted.Mobile), inserted.CallbackAt
        INTO @Warn (ContactId, UserId, BranchId, Who, At)
        FROM dbo.tblCallContact c
        WHERE c.CompId = @CompId AND c.Status = 'callback' AND c.CallbackWarnedAt IS NULL
          AND c.CallbackAt <= DATEADD(MINUTE, 10, @Now);

        INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
        OUTPUT inserted.UserId INTO @Ntf (UserId)
        SELECT w.UserId, 'call_callback_due', 'call_contact', w.ContactId, NULL,
               LEFT(N'Call back ' + w.Who + N' at ' + FORMAT(w.At, 'h:mm tt'), 200), NULL, @CompId, w.BranchId
        FROM @Warn w
        JOIN dbo.tblUser r ON r.Id = w.UserId AND r.IsActive = 1
        WHERE NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                          WHERE np.UserId = w.UserId AND np.Type = 'call_callback_due' AND np.Channel = 'inapp' AND np.IsEnabled = 0);

        -- (b)
        UPDATE c
           SET Status = 'pool', Priority = 9, HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
               CallbackNotifiedAt = @Now
        OUTPUT inserted.Id, inserted.CallListId, inserted.BranchId INTO @Missed (ContactId, CallListId, BranchId)
        FROM dbo.tblCallContact c
        WHERE c.CompId = @CompId AND c.Status = 'callback' AND c.CallbackNotifiedAt IS NULL
          AND (   c.CallbackReleaseAt <= @Now
               OR (c.CallbackAt <= @Now
                   AND EXISTS (SELECT 1 FROM dbo.tblUserDayMark d
                               WHERE d.CompId = @CompId AND d.UserId = c.HeldBy AND d.Kind = 'leave' AND d.Part = 'full'
                                 AND d.WorkDate = CAST(c.CallbackAt AS DATE))));

        UPDATE a SET CallbackOutcome = 'missed'
        FROM dbo.tblCallAttempt a
        WHERE a.Id IN (SELECT MAX(x.Id) FROM dbo.tblCallAttempt x JOIN @Missed m ON m.ContactId = x.ContactId
                       WHERE x.Result = 'callback' AND x.CallbackAt IS NOT NULL AND x.UndoneAt IS NULL
                       GROUP BY x.ContactId)
          AND a.CallbackOutcome IS NULL;

        INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
        OUTPUT inserted.UserId INTO @Ntf (UserId)
        SELECT r.UserId, 'call_callback_missed', 'call_list', g.CallListId, NULL,
               LEFT(CASE WHEN g.Cnt = 1 THEN N'Missed callback' ELSE CAST(g.Cnt AS NVARCHAR(10)) + N' missed callbacks' END
                    + N' · ' + l.Name, 200), NULL, @CompId, l.BranchId
        FROM (SELECT CallListId, COUNT(*) AS Cnt FROM @Missed GROUP BY CallListId) g
        JOIN dbo.tblCallList l ON l.Id = g.CallListId
        CROSS APPLY (SELECT l.CreatedBy AS UserId UNION SELECT l.EditBy) r
        JOIN dbo.tblUser u ON u.Id = r.UserId AND u.CompId = @CompId AND u.IsActive = 1
        WHERE NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                          WHERE np.UserId = r.UserId AND np.Type = 'call_callback_missed' AND np.Channel = 'inapp' AND np.IsEnabled = 0);

        -- (c)
        INSERT INTO @Gone (UserId)
        SELECT h.HeldBy
        FROM (SELECT DISTINCT HeldBy FROM dbo.tblCallContact
              WHERE CompId = @CompId AND Status IN ('held','callback')) h
        WHERE NOT EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, h.HeldBy, 'leads') s WHERE s.CanAdd = 1);
        -- (fn_AccessGrants already returns nothing for an inactive person)

        UPDATE c
           SET Status = 'pool', Priority = CASE WHEN c.Status = 'callback' THEN 9 ELSE c.Priority END,
               HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
               CallbackAt = NULL, CallbackReleaseAt = NULL, CallbackWarnedAt = NULL, CallbackNotifiedAt = NULL
        FROM dbo.tblCallContact c
        JOIN @Gone g ON g.UserId = c.HeldBy
        WHERE c.CompId = @CompId AND c.Status IN ('held','callback');

        COMMIT;
        SELECT DISTINCT UserId FROM @Ntf;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO
-- ===========================================================================
-- §10 altered procedures (live text; no visibility predicate is touched)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 149: dbo.sp_SaveLead from its live definition. + @CallContactId / @CallDialedAt (NULL = exactly the old behaviour, the @SetPartner precedent),
--      the conversion path (spec 12), and every new lead closes a pool contact with its number.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 9. sp_SaveLead — live body (071 / 075 / 107) with the 133 create-path rules
--    (same as sp_SaveTicket): Rule 2 on @OwnerId (403), Rule 3 office,
--    LoggerHolds, and a lead_assigned notice when the person is not the
--    creator (W5). Update still ignores @OwnerId. Lines marked "133".
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
    @CustomJSON       NVARCHAR(MAX)  = NULL,
    @SetPartner       BIT            = 0,      -- 107
    @PartnerId        INT            = NULL,   -- 107
    @CommType         VARCHAR(5)     = NULL,   -- 107
    @CommValue        DECIMAL(12,2)  = NULL,   -- 107
    @SetTerms         BIT            = 0,      -- 107
    @CallContactId    INT            = NULL,   -- 149: convert this calling-list contact
    @CallDialedAt     DATETIME       = NULL    -- 149: when the caller tapped Call
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    -- 149 BEGIN calling-list conversion (spec 12): @CallContactId set and @Id = 0.
    --   The contact, never the client, supplies the lead: number, company, address,
    --   product (the list's), source (Code 'calling'), owner (the caller, U1) and
    --   office (the caller's own, as a hand-made lead). @Remarks = the caller's note
    --   then one "Label: value" line per extra sheet column. A contact the caller
    --   does not hold: 404 when never theirs, 409 when it has left them.
    DECLARE @CcStatus VARCHAR(10), @CcHeldBy INT, @CcListId INT, @CcAttempts INT,
            @CcNote NVARCHAR(MAX), @CcListName NVARCHAR(200);
    IF ISNULL(@Id, 0) > 0 SET @CallContactId = NULL;
    IF @CallDialedAt > GETDATE() SET @CallDialedAt = NULL;
    IF @CallContactId IS NOT NULL
    BEGIN
        SELECT @CcStatus = c.Status, @CcHeldBy = c.HeldBy, @CcListId = c.CallListId, @CcAttempts = c.Attempts
        FROM dbo.tblCallContact c WHERE c.Id = @CallContactId AND c.CompId = @CompId;
        IF NOT (ISNULL(@CcStatus, '') IN ('held','callback') AND @CcHeldBy = @UserId)
        BEGIN
            IF @CcStatus IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.tblCallAttempt
                                                 WHERE ContactId = @CallContactId AND CompId = @CompId AND UserId = @UserId)
                SELECT 0 AS Id, 409 AS ResponseCode, 'This contact is no longer on your list' AS ResponseMess;
            ELSE
                SELECT 0 AS Id, 404 AS ResponseCode, 'Contact not found' AS ResponseMess;
            RETURN;
        END
        SET @CcNote = NULLIF(LTRIM(RTRIM(@Remarks)), N'');
        SELECT @Name       = LEFT(COALESCE(NULLIF(LTRIM(RTRIM(@Name)), N''), c.Name, c.Mobile), 200),
               @Company    = c.Company, @MobileNo = c.Mobile, @AltMobile = c.AltMobile, @Email = c.Email,
               @Address    = c.Address, @City = c.City, @State = c.State, @Pincode = c.Pincode,
               @ProductId  = l.ProductId, @CcListName = l.Name,
               @Remarks    = NULLIF(CONCAT(@CcNote, CASE WHEN @CcNote IS NOT NULL AND x.Lines IS NOT NULL THEN NCHAR(10) END, x.Lines), N'')
        FROM dbo.tblCallContact c
        JOIN dbo.tblCallList l ON l.Id = c.CallListId
        OUTER APPLY (SELECT STRING_AGG(CAST(j.[key] + N': ' + ISNULL(j.[value], N'') AS NVARCHAR(MAX)), NCHAR(10)) AS Lines
                     FROM OPENJSON(c.Extra) j) x
        WHERE c.Id = @CallContactId;
        SET @OwnerId    = @UserId;
        SET @BranchId   = (SELECT CAST(BranchId AS INT) FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId);
        SET @StatusId   = NULL;
        SET @SourceId   = (SELECT TOP (1) Id FROM dbo.tblLookup
                           WHERE CompId = @CompId AND Kind = 'lead_source' AND Code = 'calling' AND IsActive = 1 ORDER BY Id);
        SET @SetPartner = 0;
    END
    -- 149 END
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
    -- 133: Rule 2 on create — the named person must be in the creator's "Can assign to" list.
    IF ISNULL(@Id, 0) <= 0 AND @OwnerId IS NOT NULL
       AND NOT (@CallContactId IS NOT NULL AND @OwnerId = @UserId)   -- 149: a caller converting their own contact
       AND NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(@CompId, @UserId, 'leads', NULL) WHERE Id = @OwnerId)
    BEGIN SELECT 0 AS Id, 403 AS ResponseCode, 'You cannot assign records to that person' AS ResponseMess; RETURN; END
    -- 133: Rule 3 on create — the lead sits in an office its person works in.
    IF ISNULL(@Id, 0) <= 0 AND @OwnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, @OwnerId) WHERE BranchId = @BranchId AND Level = 3)
        SET @BranchId = ISNULL((SELECT u.BranchId FROM dbo.tblUser u
                                CROSS APPLY dbo.fn_CompanyOffice(@CompId, u.BranchId) co
                                WHERE u.Id = @OwnerId AND u.CompId = @CompId), @BranchId);
    -- 133: the office must be an active office of this company (review fix 1).
    IF ISNULL(@Id, 0) <= 0 AND NOT EXISTS (SELECT 1 FROM dbo.fn_CompanyOffice(@CompId, @BranchId))
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid branch' AS ResponseMess; RETURN; END
    -- 107: partner inputs that can be refused without reading the lead
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL AND @PartnerId <= 0 SET @PartnerId = NULL;
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL AND @SetTerms = 1 AND @CommType IS NOT NULL
       AND (@CommType NOT IN ('pct','fixed') OR @CommValue IS NULL OR @CommValue < 0
            OR (@CommType = 'pct' AND @CommValue > 100))
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Commission must be a percent from 0 to 100 or an amount of 0 or more' AS ResponseMess; RETURN; END
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblPartner WHERE Id = @PartnerId AND CompId = @CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid partner' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @LeadId INT = @Id;

        -- 149 BEGIN: lock the contact; refuse when it has left the caller. A number that is
        -- already an open lead or an active customer closes the contact as 'duplicate'
        -- and COMMITS that close before the 409 (the close must survive the refusal).
        IF @CallContactId IS NOT NULL
        BEGIN
            SELECT @CcStatus = Status, @CcHeldBy = HeldBy, @CcAttempts = Attempts
            FROM dbo.tblCallContact WITH (UPDLOCK, HOLDLOCK) WHERE Id = @CallContactId AND CompId = @CompId;
            IF NOT (ISNULL(@CcStatus, '') IN ('held','callback') AND @CcHeldBy = @UserId)
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, 409 AS ResponseCode, 'This contact is no longer on your list' AS ResponseMess;
                RETURN;
            END
            DECLARE @CcDup NVARCHAR(400) = NULL;
            SELECT TOP (1) @CcDup = N'Already a lead with '
                                  + ISNULL(CAST(COALESCE(NULLIF(o.FullName, ''), o.Username) AS NVARCHAR(200)), N'nobody')
                                  + N' — opened ' + FORMAT(dl.CreatedAt, 'd MMM')
            FROM dbo.tblLeads dl
            JOIN dbo.tblLookup dst ON dst.Id = dl.StatusId
            LEFT JOIN dbo.tblUser o ON o.Id = dl.OwnerId
            WHERE dl.CompId = @CompId AND dst.Code NOT IN ('lost','junk','converted')
              AND (dl.MobileNo IN (@MobileNo, @AltMobile) OR dl.AltMobile IN (@MobileNo, @AltMobile))
            ORDER BY dl.CreatedAt DESC, dl.Id DESC;
            IF @CcDup IS NULL
                SELECT TOP (1) @CcDup = N'Already a customer: ' + cu.Name
                FROM dbo.tblCustomer cu
                WHERE cu.CompId = @CompId AND cu.IsActive = 1
                  AND (cu.Mobile IN (@MobileNo, @AltMobile) OR cu.AltMobile IN (@MobileNo, @AltMobile))
                ORDER BY cu.Id DESC;
            IF @CcDup IS NOT NULL
            BEGIN
                IF @CcStatus = 'callback'
                    UPDATE dbo.tblCallAttempt SET CallbackOutcome = 'kept'
                    WHERE Id = (SELECT MAX(Id) FROM dbo.tblCallAttempt
                                WHERE ContactId = @CallContactId AND Result = 'callback' AND CallbackAt IS NOT NULL AND UndoneAt IS NULL);
                UPDATE dbo.tblCallContact
                   SET Status = 'closed', CloseReason = 'duplicate', HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
                       CallbackAt = NULL, CallbackReleaseAt = NULL,
                       LastResult = 'interested', LastCalledAt = GETDATE(), LastCalledBy = @UserId, Priority = 0
                 WHERE Id = @CallContactId;
                INSERT INTO dbo.tblCallAttempt (CompId, ContactId, CallListId, UserId, Result, Notes, DialedAt, AttemptsBefore)
                VALUES (@CompId, @CallContactId, @CcListId, @UserId, 'interested', LEFT(@CcNote, 1000), @CallDialedAt, @CcAttempts);
                COMMIT TRANSACTION;
                SELECT 0 AS Id, 409 AS ResponseCode, @CcDup AS ResponseMess;
                RETURN;
            END
        END
        -- 149 END

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
                 EstValue, Remarks, AssignedAt, CreatedBy, EditBy, CreatedAt, LoggerHolds)
            VALUES
                (@CompId, @BranchId, @Name, @Company, @MobileNo, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @SourceId, @ProductId, @StatusId, @OwnerId,
                 @EstValue, @Remarks, CASE WHEN @OwnerId IS NULL THEN NULL ELSE GETDATE() END,
                 @UserId, @UserId, GETDATE(),
                 CASE WHEN @OwnerId IS NULL THEN 1 ELSE 0 END);   -- 133: Ruling 12

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
            -- lead created straight onto someone shows who and when, and so
            -- "Send back" can find the creator (Ruling 13).
            IF @OwnerId IS NOT NULL
                INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy)
                VALUES (@CompId, @LeadId, NULL, @OwnerId, NULL, @BranchId, NULL, N'Assigned on creation', @UserId);

            -- 149 BEGIN: a pool contact with this number is now spoken for (spec 15); on the
            -- conversion path the contact becomes this lead and the call is recorded.
            UPDATE dbo.tblCallContact SET Status = 'closed', CloseReason = 'duplicate', Priority = 0
            WHERE CompId = @CompId AND Status = 'pool' AND Id <> ISNULL(@CallContactId, -1)
              AND (Mobile IN (@MobileNo, @AltMobile) OR AltMobile IN (@MobileNo, @AltMobile));
            IF @CallContactId IS NOT NULL
            BEGIN
                UPDATE dbo.tblLeads SET CallListId = @CcListId WHERE Id = @LeadId;
                IF @CcStatus = 'callback'
                    UPDATE dbo.tblCallAttempt SET CallbackOutcome = 'kept'
                    WHERE Id = (SELECT MAX(Id) FROM dbo.tblCallAttempt
                                WHERE ContactId = @CallContactId AND Result = 'callback' AND CallbackAt IS NOT NULL AND UndoneAt IS NULL);
                UPDATE dbo.tblCallContact
                   SET Status = 'lead', LeadId = @LeadId, HeldBy = NULL, HeldAt = NULL, HeldVia = NULL,
                       CallbackAt = NULL, CallbackReleaseAt = NULL,
                       LastResult = 'interested', LastCalledAt = GETDATE(), LastCalledBy = @UserId, Priority = 0
                 WHERE Id = @CallContactId;
                INSERT INTO dbo.tblCallAttempt (CompId, ContactId, CallListId, UserId, Result, Notes, DialedAt, LeadId, AttemptsBefore)
                VALUES (@CompId, @CallContactId, @CcListId, @UserId, 'interested', LEFT(@CcNote, 1000), @CallDialedAt, @LeadId, @CcAttempts);
            END
            -- 149 END
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

        -- 149: the purchase on the timeline ("From calling list Surat traders, Nov · 3rd call")
        IF @CallContactId IS NOT NULL
        BEGIN
            DECLARE @CcN INT = (SELECT COUNT(*) FROM dbo.tblCallAttempt WHERE ContactId = @CallContactId AND UndoneAt IS NULL);
            DECLARE @CcSummary NVARCHAR(500) = LEFT(N'From calling list ' + ISNULL(@CcListName, N'') + N' · '
                + CAST(@CcN AS NVARCHAR(10))
                + CASE WHEN @CcN % 100 IN (11, 12, 13) THEN N'th' WHEN @CcN % 10 = 1 THEN N'st'
                       WHEN @CcN % 10 = 2 THEN N'nd' WHEN @CcN % 10 = 3 THEN N'rd' ELSE N'th' END + N' call', 500);
            DECLARE @CcMeta NVARCHAR(MAX) = (SELECT @CcListId AS callListId, @CallContactId AS callContactId
                                             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
            INSERT INTO @actLog
            EXEC dbo.sp_LogLeadActivity
                @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                @Type = 'calling', @Summary = @CcSummary, @MetaJSON = @CcMeta;
        END

        -- 133: W5 — tell the person a lead was assigned to them at creation
        -- (sp_CreateNotification skips the creator assigning to themself).
        IF ISNULL(@Id, 0) <= 0 AND @OwnerId IS NOT NULL
        BEGIN
            DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
            DECLARE @NtfBody NVARCHAR(1000) = LEFT(@Name, 1000);
            INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                @UserId = @OwnerId, @Type = 'lead_assigned', @EntityType = 'lead', @EntityId = @LeadId,
                @ActorUserId = @UserId, @Title = 'Lead assigned to you', @Body = @NtfBody,
                @CompId = @CompId, @BranchId = @BranchId;
        END

        -- 107 BEGIN partner block (amendment A1): set or clear the lead's partner and terms.
        --   @SetTerms = 1: take @CommType/@CommValue.  @SetTerms = 0: the partner's usual rule when
        --   the partner changes, the lead's current terms when it does not.
        --   Refused (409) when the live commission is already paid and partner/terms would change.
        IF @SetPartner = 1
        BEGIN
            DECLARE @OldPartner INT, @OldType VARCHAR(5), @OldValue DECIMAL(12,2),
                    @NewType VARCHAR(5), @NewValue DECIMAL(12,2);
            SELECT @OldPartner = PartnerId, @OldType = CommType, @OldValue = CommValue
            FROM dbo.tblLeads WITH (UPDLOCK, HOLDLOCK) WHERE Id = @LeadId AND CompId = @CompId;

            IF @PartnerId IS NOT NULL AND ISNULL(@OldPartner, 0) <> @PartnerId AND NOT EXISTS (
                SELECT 1 FROM dbo.tblPartner WHERE Id = @PartnerId AND CompId = @CompId AND IsActive = 1)
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Pick an active partner' AS ResponseMess;
                RETURN;
            END

            IF @PartnerId IS NULL
                SELECT @NewType = NULL, @NewValue = NULL;
            ELSE IF @SetTerms = 1
                SELECT @NewType = @CommType, @NewValue = CASE WHEN @CommType IS NULL THEN NULL ELSE @CommValue END;
            ELSE IF ISNULL(@OldPartner, 0) <> @PartnerId
                SELECT @NewType = CommType, @NewValue = CommValue FROM dbo.tblPartner WHERE Id = @PartnerId;
            ELSE
                SELECT @NewType = @OldType, @NewValue = @OldValue;

            IF NOT (ISNULL(@OldPartner, 0) = ISNULL(@PartnerId, 0) AND ISNULL(@OldType, '') = ISNULL(@NewType, '')
                    AND ISNULL(@OldValue, -1) = ISNULL(@NewValue, -1))
            BEGIN
                IF EXISTS (SELECT 1 FROM dbo.tblPartnerCommission WITH (UPDLOCK, HOLDLOCK)
                           WHERE LeadId = @LeadId AND CompId = @CompId AND Status = 'paid')  -- 107: a Reverted paid row freezes too
                BEGIN
                    ROLLBACK TRANSACTION;
                    SELECT ISNULL(@Id,0) AS Id, 409 AS ResponseCode, 'The commission for this lead is already paid, so its partner and commission cannot change' AS ResponseMess;
                    RETURN;
                END

                DECLARE @PartnerSource INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                                              WHERE CompId = @CompId AND Kind = 'lead_source' AND Code = 'partner' AND IsActive = 1);
                UPDATE dbo.tblLeads
                SET PartnerId = @PartnerId, CommType = @NewType, CommValue = @NewValue,
                    SourceId = CASE WHEN @PartnerId IS NOT NULL AND @PartnerSource IS NOT NULL THEN @PartnerSource ELSE SourceId END
                WHERE Id = @LeadId AND CompId = @CompId;

                DECLARE @PartnerName NVARCHAR(200) = (SELECT Name FROM dbo.tblPartner WHERE Id = @PartnerId);
                DECLARE @PartnerSummary NVARCHAR(500) = CASE WHEN @PartnerId IS NULL THEN N'Partner removed' ELSE N'Partner: ' + @PartnerName END;
                INSERT INTO @actLog
                EXEC dbo.sp_LogLeadActivity
                    @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                    @Type = 'partner', @Summary = @PartnerSummary, @MetaJSON = NULL;

                EXEC dbo.sp_SyncPartnerCommission @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId;
            END
        END
        -- 107 END partner block

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
-- 149: dbo.sp_SaveCustomer from its live definition. A new customer closes a pool contact with its number.
-- ---------------------------------------------------------------------------
-- sp_SaveCustomer: dedupe per office; BranchId on edit NULL = keep, value = move.
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
-- ---------------------------------------------------------------------------
-- 8.4 sp_SaveCustomer — + @GSTIN; and the mobile rule becomes TEN DIGITS.
--     The old checks allowed '+' and any length, which is how '+919310500657'
--     and '111' got in. The backend normalises before calling; this makes the
--     SP say the same thing in words instead of tripping the CHECK constraint.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveCustomer
    @Id            INT            = 0,
    @CompId        INT,
    @BranchId      INT,
    @UserId        INT,
    @Name          NVARCHAR(200),
    @ContactPerson NVARCHAR(200)  = NULL,
    @Mobile        VARCHAR(20)    = NULL,
    @AltMobile     VARCHAR(20)    = NULL,
    @Email         NVARCHAR(200)  = NULL,
    @Address       NVARCHAR(500)  = NULL,
    @City          NVARCHAR(100)  = NULL,
    @State         NVARCHAR(100)  = NULL,
    @Pincode       VARCHAR(10)    = NULL,
    @Remarks       NVARCHAR(MAX)  = NULL,
    @GSTIN         VARCHAR(15)    = NULL,
    @MoveToBranchId INT           = NULL   -- 096: edit only; non-null moves the customer to that office
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);
    IF @MoveToBranchId <= 0 SET @MoveToBranchId = NULL;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Id = 0 AND (@BranchId IS NULL OR @BranchId <= 0)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'BranchId is required' AS ResponseMess; RETURN; END

    SET @Name          = NULLIF(LTRIM(RTRIM(@Name)), N'');
    SET @ContactPerson = NULLIF(LTRIM(RTRIM(@ContactPerson)), N'');
    SET @Email         = NULLIF(LTRIM(RTRIM(@Email)), N'');
    SET @Mobile        = NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(@Mobile)),    ' ', ''), '-', ''), '');
    SET @AltMobile     = NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(@AltMobile)), ' ', ''), '-', ''), '');
    SET @GSTIN         = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@GSTIN)), ' ', '')), '');

    IF @Name IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NULL AND @Email IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'A mobile number or an email is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NOT NULL AND @Mobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Mobile number must be 10 digits' AS ResponseMess; RETURN; END
    IF @AltMobile IS NOT NULL AND @AltMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Alternate mobile must be 10 digits' AS ResponseMess; RETURN; END
    IF @Email IS NOT NULL AND @Email NOT LIKE '%_@_%'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid email' AS ResponseMess; RETURN; END
    IF @GSTIN IS NOT NULL AND (LEN(@GSTIN) <> 15 OR @GSTIN NOT LIKE '[0-9][0-9]%' OR @GSTIN LIKE '%[^0-9A-Z]%')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'GSTIN must be 15 characters' AS ResponseMess; RETURN; END

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Customer not found' AS ResponseMess; RETURN; END

    -- 096: @BranchId is used on insert only; an edit moves the customer only via @MoveToBranchId.
    IF @Id = 0 AND @BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @BranchId)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Office not found' AS ResponseMess; RETURN; END
    IF @Id > 0 AND @MoveToBranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @MoveToBranchId)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Office not found' AS ResponseMess; RETURN; END

    -- One live customer per mobile per office (spec 2026-10-07 §2.5).
    -- UX_tblCustomer_Branch_Mobile is the backstop for the race this check cannot see.
    IF @Mobile IS NOT NULL
       AND EXISTS (SELECT 1 FROM dbo.tblCustomer
                   WHERE CompId = @CompId AND Mobile = @Mobile AND IsActive = 1 AND Id <> @Id
                     AND BranchId = CASE WHEN @Id > 0 THEN ISNULL(@MoveToBranchId, (SELECT BranchId FROM dbo.tblCustomer WHERE Id = @Id)) ELSE @BranchId END)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Another customer in this office already has this mobile number' AS ResponseMess; RETURN; END

    BEGIN TRY
        IF @Id > 0
        BEGIN
            UPDATE dbo.tblCustomer
            SET Name = @Name, ContactPerson = @ContactPerson,
                Mobile = @Mobile, AltMobile = @AltMobile, Email = @Email,
                Address = @Address, City = @City, State = @State, Pincode = @Pincode,
                GSTIN = @GSTIN, Remarks = @Remarks,
                BranchId = ISNULL(@MoveToBranchId, BranchId),
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

            SELECT @Id AS Id, 200 AS ResponseCode, 'Customer updated successfully' AS ResponseMess;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, GSTIN, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @Name, @ContactPerson, @Mobile, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @GSTIN, @Remarks, 1, @UserId, @UserId, GETDATE());

            DECLARE @NewId149 INT = CAST(SCOPE_IDENTITY() AS INT);                                        -- 149
            -- 149: a pool contact with this number is now spoken for (spec 15)
            -- ponytail: outside a transaction like the rest of this proc; the update cannot violate a CHECK
            UPDATE dbo.tblCallContact SET Status = 'closed', CloseReason = 'duplicate', Priority = 0       -- 149
            WHERE CompId = @CompId AND Status = 'pool'                                                    -- 149
              AND (Mobile IN (@Mobile, @AltMobile) OR AltMobile IN (@Mobile, @AltMobile));                -- 149
            SELECT @NewId149 AS Id, 200 AS ResponseCode, 'Customer created successfully' AS ResponseMess;   -- 149
        END
    END TRY
    BEGIN CATCH
        -- 2601 / 2627: the unique index caught a concurrent insert of the same mobile.
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @Id AS Id, 409 AS ResponseCode, 'Another customer in this office already has this mobile number' AS ResponseMess;
        ELSE
            SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_FetchLeads from its live definition. RS1 + CallListId, CallListName, PhoneMark, PhoneMarkNote. No new parameter.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 8. sp_FetchLeads (122 body): the two lists are gone, visibility =
--    fn_VisibleLeads (#VL, once per call) in both the page and the
--    past-the-end count. Everything else is the live text.
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
    @UserId                  INT,
    @PartnerId               INT           = NULL,
    @SortBy                  VARCHAR(20)   = NULL,
    @SortDir                 VARCHAR(4)    = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,10) < 1 THEN 10 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @StatusCode IS NOT NULL AND LTRIM(RTRIM(@StatusCode)) = '' SET @StatusCode = NULL;
    IF @SortBy NOT IN ('created','lastActivity','name','value','nextFollowUp') SET @SortBy = NULL;
    SET @SortDir = CASE WHEN @SortDir = 'asc' THEN 'asc' ELSE 'desc' END;
    DECLARE @ToEx DATETIME = CASE WHEN @ToDate IS NULL THEN NULL ELSE DATEADD(DAY, 1, CAST(@ToDate AS DATETIME)) END;

    CREATE TABLE #VL (LeadId INT PRIMARY KEY);
    INSERT INTO #VL (LeadId) SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);

    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    DECLARE @Page TABLE (Id INT, Total INT, rn INT, LastActivityAt DATETIME NULL);
    INSERT INTO @Page (Id, Total, rn, LastActivityAt)
    SELECT l.Id, COUNT(*) OVER (), ROW_NUMBER() OVER (
               ORDER BY CASE WHEN @SortBy IS NULL AND @Overdue = 1 THEN l.NextFollowupDate END ASC,
                        CASE WHEN @SortBy = 'lastActivity' AND la.LastActivityAt   IS NULL THEN 1
                             WHEN @SortBy = 'value'        AND l.EstValue          IS NULL THEN 1
                             WHEN @SortBy = 'nextFollowUp' AND l.NextFollowupDate  IS NULL THEN 1 ELSE 0 END ASC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'created'      THEN l.CreatedAt        END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'created'      THEN l.CreatedAt        END DESC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'lastActivity' THEN la.LastActivityAt  END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'lastActivity' THEN la.LastActivityAt  END DESC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'name'         THEN l.Name             END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'name'         THEN l.Name             END DESC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'value'        THEN l.EstValue         END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'value'        THEN l.EstValue         END DESC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'nextFollowUp' THEN l.NextFollowupDate END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'nextFollowUp' THEN l.NextFollowupDate END DESC,
                        l.CreatedAt DESC, l.Id DESC),
           la.LastActivityAt
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    -- ceiling: ~50k leads per company; then a stored column kept by sp_LogLeadActivity
    OUTER APPLY (
        SELECT CASE WHEN fd.MaxDone IS NULL THEN ac.MaxAct
                    WHEN ac.MaxAct  IS NULL OR fd.MaxDone >= ac.MaxAct THEN fd.MaxDone
                    ELSE ac.MaxAct END AS LastActivityAt
        FROM (SELECT MAX(f.DoneAt) AS MaxDone FROM dbo.tblFollowUp f
              WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'done') fd
        CROSS JOIN
             (SELECT MAX(a.CreatedAt) AS MaxAct FROM dbo.tblLeadActivity a
              WHERE a.CompId = l.CompId AND a.LeadId = l.Id
                AND a.Type IN ('call','followup','note','status','quotation','assigned')) ac
    ) la
    WHERE l.CompId = @CompId
      AND (@BranchId   IS NULL OR l.BranchId  = @BranchId)
      AND (@StatusId   IS NULL OR l.StatusId  = @StatusId)
      AND (@StatusCode IS NULL OR st.Code     = @StatusCode)
      AND (@ProductId  IS NULL OR l.ProductId = @ProductId)
      AND (@OwnerId    IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId   IS NULL OR l.SourceId  = @SourceId)
      AND (@PartnerId  IS NULL OR l.PartnerId = @PartnerId)
      AND (@Unassigned = 0 OR l.OwnerId IS NULL)
      AND (@Overdue = 0 OR (l.NextFollowupDate < /*120*/ CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified')))
      AND (@FromDate IS NULL OR l.CreatedAt >= @FromDate)
      AND (@ToEx     IS NULL OR l.CreatedAt <  @ToEx)
      AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                              OR l.Company LIKE '%' + @SearchTerm + '%'
                              OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                              OR l.Email LIKE '%' + @SearchTerm + '%'
                              OR l.City LIKE '%' + @SearchTerm + '%')
      AND l.Id IN (SELECT LeadId FROM #VL)
    ORDER BY CASE WHEN @SortBy IS NULL AND @Overdue = 1 THEN l.NextFollowupDate END ASC,
             CASE WHEN @SortBy = 'lastActivity' AND la.LastActivityAt   IS NULL THEN 1
                  WHEN @SortBy = 'value'        AND l.EstValue          IS NULL THEN 1
                  WHEN @SortBy = 'nextFollowUp' AND l.NextFollowupDate  IS NULL THEN 1 ELSE 0 END ASC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'created'      THEN l.CreatedAt        END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'created'      THEN l.CreatedAt        END DESC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'lastActivity' THEN la.LastActivityAt  END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'lastActivity' THEN la.LastActivityAt  END DESC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'name'         THEN l.Name             END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'name'         THEN l.Name             END DESC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'value'        THEN l.EstValue         END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'value'        THEN l.EstValue         END DESC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'nextFollowUp' THEN l.NextFollowupDate END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'nextFollowUp' THEN l.NextFollowupDate END DESC,
             l.CreatedAt DESC, l.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1: page of leads
    SELECT l.Id, l.CompId, l.BranchId, b.BranchName,
           l.Name, l.Company, l.MobileNo, l.AltMobile, l.Email,
           l.Address, l.City, l.State, l.Pincode,
           l.SourceId, src.Value AS SourceName,
           l.PartnerId, pr.Name AS PartnerName,
           l.ProductId, p.Name AS ProductName,
           l.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           l.OwnerId, o.FullName AS OwnerName, o.Avatar AS OwnerAvatar,
           l.EstValue, l.Remarks, l.NextFollowupDate, x.LastActivityAt,
           (SELECT TOP 1 f.Type FROM dbo.tblFollowUp f WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'open' ORDER BY f.DueAt, f.Id) AS NextFollowupType,  -- 119
           CAST(CASE WHEN l.NextFollowupDate < /*120*/ CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           l.LostReasonId, l.WonAt, l.WonValue, l.CustomerId, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           l.CallListId, cl149.Name AS CallListName, mk149.Mark AS PhoneMark, mk149.Note AS PhoneMarkNote,   -- 149
           200 AS ResponseCode, 'Leads retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblLeads l ON l.Id = x.Id
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblPartner pr ON pr.Id = l.PartnerId
    LEFT JOIN dbo.tblProduct p ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    LEFT JOIN dbo.tblCallList cl149 ON cl149.Id = l.CallListId AND cl149.CompId = l.CompId   -- 149
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note, pm.SetByName, pm.SetAt FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (l.MobileNo, l.AltMobile)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk149   -- 149
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
          AND (@PartnerId  IS NULL OR l.PartnerId = @PartnerId)
          AND (@Unassigned = 0 OR l.OwnerId IS NULL)
          AND (@Overdue = 0 OR (l.NextFollowupDate < /*120*/ CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified')))
          AND (@FromDate IS NULL OR l.CreatedAt >= @FromDate)
          AND (@ToEx     IS NULL OR l.CreatedAt <  @ToEx)
          AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                                  OR l.Company LIKE '%' + @SearchTerm + '%'
                                  OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                                  OR l.Email LIKE '%' + @SearchTerm + '%'
                                  OR l.City LIKE '%' + @SearchTerm + '%')
          AND l.Id IN (SELECT LeadId FROM #VL);

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;
END
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_FetchLeadDetail from its live definition. RS1 + CallListId, CallListName, PhoneMark, PhoneMarkNote, PhoneMarkBy, PhoneMarkAt.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 9. sp_FetchLeadDetail - 6 result sets, all empty when the lead is not
--    visible. RS1 gains CanEdit, CanReassign, SendBackToId, SendBackToName
--    (fn_RecordActions). Leads have no reopen.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLeadDetail
    @CompId INT,
    @LeadId INT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    DECLARE @Vis BIT = 0, @CanEdit BIT = 0, @CanReassign BIT = 0, @SendBackToId INT = NULL;
    DECLARE @CanReopen139 BIT = 0;   -- 139
    SELECT @Vis = 1, @CanEdit = ISNULL(a.CanEdit, 0), @CanReassign = ISNULL(a.CanReassign, 0), @SendBackToId = a.SendBackToId,
           @CanReopen139 = ISNULL(a.CanReopen, 0)
    FROM dbo.fn_RecordActions(@CompId, @UserId, 'leads', @LeadId) a;

    -- 1) core
    SELECT l.Id, l.CompId, l.BranchId, b.BranchName,
           l.Name, l.Company, l.MobileNo, l.AltMobile, l.Email,
           l.Address, l.City, l.State, l.Pincode,
           l.SourceId, src.Value AS SourceName,
           l.ProductId, p.Name AS ProductName,
           l.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           l.OwnerId, o.FullName AS OwnerName, o.Avatar AS OwnerAvatar,
           l.EstValue, l.Remarks, l.NextFollowupDate,
           CAST(CASE WHEN l.NextFollowupDate < /*120*/ CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.WonValue, l.CustomerId, cust.Name AS CustomerName, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           l.PartnerId, pr.Name AS PartnerName, l.CommType, l.CommValue,   -- 107
           @CanEdit AS CanEdit, @CanReassign AS CanReassign, @CanReopen139 AS CanReopen,
           @SendBackToId AS SendBackToId, sb.FullName AS SendBackToName,
           l.CallListId, cl149.Name AS CallListName,   -- 149
           mk149.Mark AS PhoneMark, mk149.Note AS PhoneMarkNote, mk149.SetByName AS PhoneMarkBy, mk149.SetAt AS PhoneMarkAt,   -- 149
           200 AS ResponseCode, 'Lead detail retrieved successfully' AS ResponseMess
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblLookup lr  ON lr.Id  = l.LostReasonId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = l.ProductId
    LEFT JOIN dbo.tblUser o     ON o.Id   = l.OwnerId
    LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId
    LEFT JOIN dbo.tblCustomer cust ON cust.Id = l.CustomerId AND cust.CompId = l.CompId
    LEFT JOIN dbo.tblPartner pr ON pr.Id = l.PartnerId   -- 107
    LEFT JOIN dbo.tblUser sb    ON sb.Id  = @SendBackToId
    LEFT JOIN dbo.tblCallList cl149 ON cl149.Id = l.CallListId AND cl149.CompId = l.CompId   -- 149
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note, pm.SetByName, pm.SetAt FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (l.MobileNo, l.AltMobile)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk149   -- 149
    WHERE l.Id = @LeadId AND l.CompId = @CompId AND @Vis = 1;

    -- 2) custom values
    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type,
           v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId = @CompId AND v.Entity = 'lead' AND v.EntityId = @LeadId AND @Vis = 1
    ORDER BY d.SortOrder;

    -- 3) timeline
    SELECT a.Id, a.LeadId, a.UserId, u.FullName AS UserName, u.Avatar AS UserAvatar,
           a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblLeadActivity a
    LEFT JOIN dbo.tblUser u ON u.Id = a.UserId
    WHERE a.CompId = @CompId AND a.LeadId = @LeadId AND @Vis = 1
    ORDER BY a.CreatedAt DESC, a.Id DESC;

    -- 4) follow-ups: open first (soonest due), then done/skipped newest first
    SELECT f.Id, f.LeadId, f.Type, f.DueAt, f.Status,
           f.AssignedTo, au.FullName AS AssignedToName,
           f.DoneAt, f.DoneBy, du.FullName AS DoneByName,
           f.OutcomeId, oc.Value AS Outcome, f.Remarks, f.Direction, f.Duration,
           CAST(CASE WHEN f.Status = 'open' AND f.DueAt < /*120*/ CASE WHEN CAST(f.DueAt AS TIME) = '00:00' THEN @Today ELSE GETDATE() END THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           f.CreatedBy, f.CreatedAt
    FROM dbo.tblFollowUp f
    LEFT JOIN dbo.tblUser au ON au.Id = f.AssignedTo
    LEFT JOIN dbo.tblUser du ON du.Id = f.DoneBy
    LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
    WHERE f.CompId = @CompId AND f.LeadId = @LeadId AND @Vis = 1
    ORDER BY CASE WHEN f.Status = 'open' THEN 0 ELSE 1 END,
             CASE WHEN f.Status = 'open' THEN f.DueAt END ASC,
             f.DoneAt DESC, f.Id DESC;

    -- 5) assignment history, newest first
    SELECT a.Id, a.LeadId,
           a.FromUserId, fu.FullName AS FromUserName,
           a.ToUserId,   tu.FullName AS ToUserName,
           a.FromBranchId, fb.BranchName AS FromBranchName,
           a.ToBranchId,   tb.BranchName AS ToBranchName,
           a.ReasonId, r.Value AS Reason, a.Remarks,
           a.AssignedBy, ab.FullName AS AssignedByName, a.AssignedAt
    FROM dbo.tblLeadAssignment a
    LEFT JOIN dbo.tblUser fu ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblUser ab ON ab.Id = a.AssignedBy
    LEFT JOIN dbo.tblBranch fb ON fb.Id = a.FromBranchId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    LEFT JOIN dbo.tblLookup r ON r.Id = a.ReasonId
    WHERE a.CompId = @CompId AND a.LeadId = @LeadId AND @Vis = 1
    ORDER BY a.AssignedAt DESC, a.Id DESC;

    -- 6) commission rows of this lead, newest first (107)
    SELECT c.Id, c.PartnerId, p2.Name AS PartnerName, c.BaseValue, c.CommType, c.CommValue, c.Amount,
           c.Status, c.Reverted, c.EarnedAt, c.DueAt, c.PaidAt, c.PaidRef
    FROM dbo.tblPartnerCommission c JOIN dbo.tblPartner p2 ON p2.Id = c.PartnerId
    WHERE c.LeadId = @LeadId AND c.CompId = @CompId AND @Vis = 1
    ORDER BY c.Id DESC;
END
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_FetchCustomers from its live definition. RS1 + PhoneMark, PhoneMarkNote.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 14. sp_FetchCustomers - the customers rule is unchanged (Node still feeds
--     the customers lists; spec 3.4). Only the complaint figures change
--     (F4): Open / Total / LastTicketAt count complaints the viewer can open
--     (fn_VisibleTickets; no complaints View = 0 / 0 / NULL). @UserId loses
--     its default (N1a).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchCustomers
    @CompId                  INT,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL,
    @BranchId                INT           = NULL,
    @IsActive                BIT           = 1,
    @UserId                  INT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    -- Scoped by the customers module (office + CreatedBy as owner), paged, newest first.
    -- Search: Name / ContactPerson / Mobile / AltMobile / Email / City. A
    -- digits-only term also matches a mobile typed with spaces or dashes.
    -- @IsActive NULL = both live and soft-deleted rows.
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1)  < 1 THEN 1  ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,  25)  < 1 THEN 25 ELSE @PageSize   END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    DECLARE @Digits VARCHAR(50) = CASE WHEN @SearchTerm IS NOT NULL
                                        AND REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') NOT LIKE '%[^0-9+]%'
                                       THEN REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') END;

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

    -- One predicate, one scan: the matching ids, then count and page from them.
    DECLARE @F TABLE (Id INT PRIMARY KEY, CreatedAt DATETIME);
    INSERT INTO @F (Id, CreatedAt)
    SELECT c.Id, c.CreatedAt
    FROM dbo.tblCustomer c
    WHERE c.CompId = @CompId
      AND (@IsActive IS NULL OR c.IsActive = @IsActive)
      AND (@BranchId IS NULL OR c.BranchId = @BranchId)
      AND (
            (    (@UseBranchScope = 0 OR c.BranchId  IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR c.CreatedBy IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND c.CreatedBy = @UserId)
          )
      AND (@SearchTerm IS NULL
           OR c.Name          LIKE '%' + @SearchTerm + '%'
           OR c.ContactPerson LIKE '%' + @SearchTerm + '%'
           OR c.Mobile        LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR c.AltMobile     LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR c.Email         LIKE '%' + @SearchTerm + '%'
           OR c.City          LIKE '%' + @SearchTerm + '%');

    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- Complaints the viewer can open (F4), once per call.
    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);

    -- RS1: the page, with the viewer's complaint counts
    SELECT c.Id, c.CompId, c.BranchId, b.BranchName,
           c.Name, c.ContactPerson, c.Mobile, c.AltMobile, c.Email,
           c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,
           ISNULL(tk.OpenTickets, 0) AS OpenTickets,
           ISNULL(tk.TotalTickets, 0) AS TotalTickets,
           tk.LastTicketAt,
           c.CreatedAt, c.UpdatedAt,
           mk149.Mark AS PhoneMark, mk149.Note AS PhoneMarkNote,   -- 149
           200 AS ResponseCode, 'Customers retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblCustomer c ON c.Id = f.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = c.BranchId
    OUTER APPLY (
        SELECT COUNT(*) AS TotalTickets,
               SUM(CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END) AS OpenTickets,
               MAX(t.CreatedAt) AS LastTicketAt
        FROM dbo.tblTicket t
        JOIN #VT v ON v.TicketId = t.Id
        JOIN dbo.tblLookup st ON st.Id = t.StatusId
        WHERE t.CompId = c.CompId AND t.CustomerId = c.Id
    ) tk
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note, pm.SetByName, pm.SetAt FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (c.Mobile, c.AltMobile)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk149   -- 149
    ORDER BY f.CreatedAt DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- RS2: pagination
    SELECT @PageNumber AS CurrentPage,
           @PageSize   AS PageSize,
           @Total      AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages;
END
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_FetchCustomerDetail from its live definition. RS1 + PhoneMark, PhoneMarkNote, PhoneMarkBy, PhoneMarkAt.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 15. sp_FetchCustomerDetail - RS1 the customer (Node still checks the
--     customers rule before calling); RS1 counts and RS2 the complaint list
--     come from fn_VisibleTickets (F3, F4, F6): only complaints the viewer
--     can open, none without the complaints module. The two JSON lists (the
--     old complaints scope) are gone.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchCustomerDetail
    @CompId     INT,
    @CustomerId INT,
    @UserId     INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();

    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);

    -- RS1: the customer
    SELECT c.Id, c.CompId, c.BranchId, b.BranchName,
           c.Name, c.ContactPerson, c.Mobile, c.AltMobile, c.Email,
           c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,
           c.CreatedBy,   -- 096: Node's visibility check needs the owner
           ISNULL(tk.OpenTickets, 0) AS OpenTickets,
           ISNULL(tk.TotalTickets, 0) AS TotalTickets,
           tk.LastTicketAt,
           c.CreatedAt, c.UpdatedAt,
           mk149.Mark AS PhoneMark, mk149.Note AS PhoneMarkNote, mk149.SetByName AS PhoneMarkBy, mk149.SetAt AS PhoneMarkAt,   -- 149
           200 AS ResponseCode, 'Customer detail retrieved successfully' AS ResponseMess
    FROM dbo.tblCustomer c
    LEFT JOIN dbo.tblBranch b ON b.Id = c.BranchId
    OUTER APPLY (
        SELECT COUNT(*) AS TotalTickets,
               SUM(CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END) AS OpenTickets,
               MAX(t.CreatedAt) AS LastTicketAt
        FROM dbo.tblTicket t
        JOIN #VT v ON v.TicketId = t.Id
        JOIN dbo.tblLookup st ON st.Id = t.StatusId
        WHERE t.CompId = c.CompId AND t.CustomerId = c.Id
    ) tk
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note, pm.SetByName, pm.SetAt FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (c.Mobile, c.AltMobile)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk149   -- 149
    WHERE c.Id = @CustomerId AND c.CompId = @CompId;

    -- RS2: their complaints the viewer can open
    SELECT t.Id, t.TicketNo, t.Subject,
           t.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           t.Priority, p.Value AS PriorityName,
           t.AssignedTo, a.FullName AS AssigneeName,
           t.DueAt,
           CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           t.CreatedAt, t.ResolvedAt, t.ClosedAt
    FROM dbo.tblTicket t
    JOIN #VT v                ON v.TicketId = t.Id
    JOIN dbo.tblLookup st     ON st.Id = t.StatusId
    LEFT JOIN dbo.tblLookup p ON p.Id  = t.Priority
    LEFT JOIN dbo.tblUser a   ON a.Id  = t.AssignedTo
    WHERE t.CompId = @CompId AND t.CustomerId = @CustomerId
    ORDER BY t.CreatedAt DESC, t.Id DESC;
END
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_FetchTicketDetail from its live definition. RS1 + PhoneMark, PhoneMarkNote, PhoneMarkBy, PhoneMarkAt (customer's numbers and the ticket's own ten-digit Contact).
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 7. sp_FetchTicketDetail - 5 result sets, all empty when the complaint is not
--    visible to @UserId (fn_RecordActions: 0 rows). RS1 gains CanEdit,
--    CanReassign, CanReopen, SendBackToId, SendBackToName (from
--    fn_RecordActions, never restated); LinkedLeadId and RS5 only when the
--    lead is visible; PreviousTickets counts visible complaints only (F4).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTicketDetail
    @CompId   INT,
    @TicketId INT,
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();

    DECLARE @Vis BIT = 0, @CanEdit BIT = 0, @CanReassign BIT = 0, @CanReopen BIT = 0,
            @SendBackToId INT = NULL, @LeadVis BIT = 0;
    SELECT @Vis = 1, @CanEdit = ISNULL(a.CanEdit, 0), @CanReassign = ISNULL(a.CanReassign, 0),
           @CanReopen = ISNULL(a.CanReopen, 0), @SendBackToId = a.SendBackToId
    FROM dbo.fn_RecordActions(@CompId, @UserId, 'complaints', @TicketId) a;

    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    IF @Vis = 1
    BEGIN
        INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);
        IF EXISTS (SELECT 1 FROM dbo.tblTicket t
                   JOIN dbo.fn_VisibleLeads(@CompId, @UserId) vl ON vl.LeadId = t.LinkedLeadId
                   WHERE t.Id = @TicketId AND t.CompId = @CompId)
            SET @LeadVis = 1;
    END

    -- 1) core
    SELECT t.Id, t.CompId, t.BranchId, b.BranchName,
           t.TicketNo, t.Subject,
           t.CustomerId, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
           t.ContactPerson, t.Contact,
           t.ChannelId,  ch.Value AS ChannelName,
           t.CategoryId, cat.Value AS CategoryName,
           t.Priority,   pr.Value AS PriorityName,
           t.ProductId,  p.Name AS ProductName,
           t.StatusId,   st.Value AS StatusName, st.Code AS StatusCode,
           t.AssignedTo, a.FullName AS AssigneeName, a.Avatar AS AssigneeAvatar, t.AssignedAt,
           t.DueAt,
           CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           DATEDIFF(HOUR, t.CreatedAt, COALESCE(t.ClosedAt, t.ResolvedAt, @Now)) AS AgeHours,
           t.EscalatedTo, e.FullName AS EscalatedToName, t.EscalatedAt,
           CASE WHEN @LeadVis = 1 THEN t.LinkedLeadId END AS LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, r.Value AS ResolutionName,
           t.Description,
           t.CreatedBy, t.CreatedAt, t.UpdatedAt,
           t.EditBy,
           c.ContactPerson AS CustomerContactPerson, c.Email AS CustomerEmail,
           c.City AS CustomerCity, c.Address AS CustomerAddress,
           (SELECT COUNT(*) FROM dbo.tblTicket x
             JOIN #VT vx ON vx.TicketId = x.Id
             WHERE x.CompId = t.CompId AND x.CustomerId = t.CustomerId AND x.Id <> t.Id) AS PreviousTickets,
           @CanEdit AS CanEdit, @CanReassign AS CanReassign, @CanReopen AS CanReopen,
           @SendBackToId AS SendBackToId, sb.FullName AS SendBackToName,
           mk149.Mark AS PhoneMark, mk149.Note AS PhoneMarkNote, mk149.SetByName AS PhoneMarkBy, mk149.SetAt AS PhoneMarkAt,   -- 149
           200 AS ResponseCode, 'Ticket detail retrieved successfully' AS ResponseMess
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st       ON st.Id  = t.StatusId
    JOIN dbo.tblCustomer c      ON c.Id   = t.CustomerId
    LEFT JOIN dbo.tblLookup ch  ON ch.Id  = t.ChannelId
    LEFT JOIN dbo.tblLookup cat ON cat.Id = t.CategoryId
    LEFT JOIN dbo.tblLookup pr  ON pr.Id  = t.Priority
    LEFT JOIN dbo.tblLookup r   ON r.Id   = t.ResolutionId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = t.ProductId
    LEFT JOIN dbo.tblUser a     ON a.Id   = t.AssignedTo
    LEFT JOIN dbo.tblUser e     ON e.Id   = t.EscalatedTo
    LEFT JOIN dbo.tblBranch b   ON b.Id   = t.BranchId
    LEFT JOIN dbo.tblUser sb    ON sb.Id  = @SendBackToId
    OUTER APPLY (SELECT TOP (1) pm.Mark, pm.Note, pm.SetByName, pm.SetAt FROM dbo.fn_PhoneMark(@CompId) pm
                 WHERE pm.Mobile IN (c.Mobile, c.AltMobile,
                                     CASE WHEN t.Contact LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' THEN t.Contact END)
                 ORDER BY CASE pm.Mark WHEN 'dnc' THEN 0 ELSE 1 END, pm.SetAt DESC) mk149   -- 149
    WHERE t.Id = @TicketId AND t.CompId = @CompId AND @Vis = 1;

    -- 2) custom values
    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type, v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId = @CompId AND v.Entity = 'ticket' AND v.EntityId = @TicketId AND @Vis = 1
    ORDER BY d.SortOrder;

    -- 3) timeline
    SELECT a.Id, a.TicketId, a.UserId, u.FullName AS UserName, u.Avatar AS UserAvatar,
           a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblTicketActivity a
    LEFT JOIN dbo.tblUser u ON u.Id = a.UserId
    WHERE a.CompId = @CompId AND a.TicketId = @TicketId AND @Vis = 1
    ORDER BY a.CreatedAt DESC, a.Id DESC;

    -- 4) assignment history, newest first
    SELECT a.Id,
           a.FromUserId, fu.FullName AS FromUserName,
           a.ToUserId,   tu.FullName AS ToUserName,
           a.FromBranchId, fb.BranchName AS FromBranchName,
           a.ToBranchId,   tb.BranchName AS ToBranchName,
           a.ReasonId, rs.Value AS Reason, a.Remarks,
           a.AssignedBy, ab.FullName AS AssignedByName, a.AssignedAt
    FROM dbo.tblTicketAssignment a
    LEFT JOIN dbo.tblUser fu   ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu   ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblUser ab   ON ab.Id = a.AssignedBy
    LEFT JOIN dbo.tblBranch fb ON fb.Id = a.FromBranchId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    LEFT JOIN dbo.tblLookup rs ON rs.Id = a.ReasonId
    WHERE a.CompId = @CompId AND a.TicketId = @TicketId AND @Vis = 1
    ORDER BY a.AssignedAt DESC, a.Id DESC;

    -- 5) linked-lead summary (empty set when no link, or the lead is not visible).
    SELECT l.Id, l.Name, l.MobileNo, l.Email, l.StatusId
    FROM dbo.tblLeads l
    INNER JOIN dbo.tblTicket t ON t.LinkedLeadId = l.Id
    WHERE t.Id = @TicketId AND t.CompId = @CompId AND l.CompId = @CompId AND @LeadVis = 1;
END
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_SaveCompanySetting from its live definition. + @CallStartMin, @CallEndMin, @CallbackCap (NULL leaves the column, the @CommissionDueOn precedent).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveCompanySetting
    @CompId            BIGINT,
    @LateGraceMin      INT,
    @SessionBufferMin  INT,
    @WarnPct           INT,
    @NotifyNotSignedIn BIT,
    @GoLiveDate        DATE = NULL,
    @CommissionDueOn   VARCHAR(10) = NULL,  -- 107: NULL leaves the column as it is
    @CallStartMin      INT = NULL,          -- 149: calling hours, minutes of the day; NULL leaves the column
    @CallEndMin        INT = NULL,          -- 149
    @CallbackCap       INT = NULL           -- 149: open callbacks a caller may hold
AS
BEGIN
    SET NOCOUNT ON;

    IF @LateGraceMin IS NULL OR @LateGraceMin NOT BETWEEN 0 AND 120
    BEGIN SELECT 400 AS ResponseCode, 'Late grace must be 0 to 120 minutes' AS ResponseMess; RETURN; END
    IF @SessionBufferMin IS NULL OR @SessionBufferMin NOT BETWEEN 0 AND 480
    BEGIN SELECT 400 AS ResponseCode, 'Session buffer must be 0 to 480 minutes' AS ResponseMess; RETURN; END
    IF @WarnPct IS NULL OR @WarnPct NOT BETWEEN 50 AND 95
    BEGIN SELECT 400 AS ResponseCode, 'Warn at must be 50 to 95 percent' AS ResponseMess; RETURN; END
    IF @CommissionDueOn IS NOT NULL AND @CommissionDueOn NOT IN ('manual','convert')   -- 107
    BEGIN SELECT 400 AS ResponseCode, 'Choose when commission becomes payable' AS ResponseMess; RETURN; END
    IF (@CallStartMin IS NOT NULL AND @CallStartMin NOT BETWEEN 0 AND 1440)   -- 149
       OR (@CallEndMin IS NOT NULL AND @CallEndMin NOT BETWEEN 0 AND 1440)
    BEGIN SELECT 400 AS ResponseCode, 'Calling hours must be within the day' AS ResponseMess; RETURN; END
    IF COALESCE(@CallStartMin, (SELECT CallStartMin FROM dbo.tblCompanySetting WHERE CompId = @CompId), 540)   -- 149
       >= COALESCE(@CallEndMin, (SELECT CallEndMin FROM dbo.tblCompanySetting WHERE CompId = @CompId), 1260)
    BEGIN SELECT 400 AS ResponseCode, 'Calling hours must start before they end' AS ResponseMess; RETURN; END
    IF @CallbackCap IS NOT NULL AND @CallbackCap NOT BETWEEN 1 AND 200   -- 149
    BEGIN SELECT 400 AS ResponseCode, 'Callback cap must be 1 to 200' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblCompanySetting WITH (UPDLOCK, HOLDLOCK)
           SET LateGraceMin = @LateGraceMin, SessionBufferMin = @SessionBufferMin, WarnPct = @WarnPct,
               NotifyNotSignedIn = ISNULL(@NotifyNotSignedIn, 1), GoLiveDate = @GoLiveDate,
               CommissionDueOn = ISNULL(@CommissionDueOn, CommissionDueOn),   -- 107
               CallStartMin = ISNULL(@CallStartMin, CallStartMin), CallEndMin = ISNULL(@CallEndMin, CallEndMin),   -- 149
               CallbackCap = ISNULL(@CallbackCap, CallbackCap),   -- 149
               UpdatedAt = GETDATE()
         WHERE CompId = @CompId;
        IF @@ROWCOUNT = 0
            INSERT INTO dbo.tblCompanySetting (CompId, LateGraceMin, SessionBufferMin, WarnPct, NotifyNotSignedIn, GoLiveDate, CommissionDueOn,
                                               CallStartMin, CallEndMin, CallbackCap)   -- 149
            VALUES (@CompId, @LateGraceMin, @SessionBufferMin, @WarnPct, ISNULL(@NotifyNotSignedIn, 1), @GoLiveDate, ISNULL(@CommissionDueOn, 'manual'),
                    ISNULL(@CallStartMin, 540), ISNULL(@CallEndMin, 1260), ISNULL(@CallbackCap, 20));   -- 149
        COMMIT;
        SELECT 200 AS ResponseCode, 'Settings saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_FetchWorkSettings from its live definition. RS1 + CallStartMin, CallEndMin, CallbackCap.
-- ---------------------------------------------------------------------------
-- RS1–RS3 exactly as 099; RS4 now reads the policy. 107: RS1 also returns CommissionDueOn.
CREATE OR ALTER PROCEDURE dbo.sp_FetchWorkSettings
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    -- RS1 always one row (defaults when the company has no settings row yet).
    SELECT ISNULL(s.LateGraceMin, 10)                   AS LateGraceMin,
           ISNULL(s.SessionBufferMin, 120)              AS SessionBufferMin,
           ISNULL(s.WarnPct, 80)                        AS WarnPct,
           ISNULL(s.NotifyNotSignedIn, CAST(1 AS BIT))  AS NotifyNotSignedIn,
           s.GoLiveDate,
           ISNULL(s.CommissionDueOn, 'manual')          AS CommissionDueOn,  -- 107
           ISNULL(s.CallStartMin, 540)                  AS CallStartMin,     -- 149
           ISNULL(s.CallEndMin, 1260)                   AS CallEndMin,       -- 149
           ISNULL(s.CallbackCap, 20)                    AS CallbackCap       -- 149
    FROM (SELECT 1 AS x) d
    LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;

    -- RS2 shifts. The default also counts users with no shift of their own.
    SELECT w.Id, w.Name, w.IsDefault, w.DaysJson,
           (SELECT COUNT(*) FROM dbo.tblUser u
             WHERE u.CompId = @CompId AND u.IsActive = 1
               AND (u.WorkCalendarId = w.Id OR (w.IsDefault = 1 AND u.WorkCalendarId IS NULL))) AS UserCount
    FROM dbo.tblWorkCalendar w
    WHERE w.CompId = @CompId
    ORDER BY w.IsDefault DESC, w.Name;

    -- RS3 holidays from a year ago onward.
    SELECT h.Id, h.HolidayDate, h.Name, h.BranchId, b.BranchName
    FROM dbo.tblHoliday h
    LEFT JOIN dbo.tblBranch b ON b.Id = h.BranchId
    WHERE h.CompId = @CompId
      AND h.HolidayDate >= DATEADD(YEAR, -1, CAST(GETDATE() AS DATE))
    ORDER BY h.HolidayDate;

    -- RS4 TAT policy (100).
    SELECT CAST(Priority AS VARCHAR(30)) AS Priority, Minutes
    FROM dbo.tblTaskTatPolicy
    WHERE CompId = @CompId
    ORDER BY CASE Priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END;
END
GO

-- ===========================================================================
-- §11 report families (spec 13.5 as amended 2026-11-24). No report procedure of
-- its own: three Src = 'K' families in fn_SalesReportRows, read by sp_RptSales /
-- sp_RptSalesRows under @GroupBy 'caller' and 'calllist'. Every number is still a
-- count or sum of these rows, so a cell equals its drill by construction.
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 149: dbo.fn_SalesReportRows from its live definition. + CallListId on every row; + the dial, dial_first and contact families (Src 'K').
--      dial / dial_first: visible by the people-subject rule (who rang) or when the list is in
--      fn_VisibleCallLists; contact: list in fn_VisibleCallLists. Existing families untouched.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 3. fn_SalesReportRows (spec 3.6, D8). The 122 body; only the scope changes:
--    record families (Src 'L': new, won, lost, open) count only leads the
--    viewer can see (fn_VisibleLeads); activity families (Src 'F' / 'C':
--    done follow-ups, calls, follow-up states) count when the lead is visible
--    OR the person the row is credited to (PersonId) has a line in the
--    viewer's Team report (fn_ReportTree). CanOpen = the lead is visible.
--    Every number of sp_RptSales / sp_RptSalesRows is a count or sum of these
--    rows, so a cell still equals its drill by construction. Actor1 / Actor2
--    stay in the fact rows (unused now).
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_SalesReportRows
(
    @CompId        INT,
    @From          DATETIME,
    @ToEx          DATETIME,
    @UserId        INT
)
RETURNS TABLE
AS
RETURN
WITH V AS (SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId)),
VC AS (SELECT CallListId FROM dbo.fn_VisibleCallLists(@CompId, @UserId)),   -- 149
P AS (SELECT PersonId FROM dbo.fn_ReportTree(@CompId, @UserId) WHERE Depth = 0),
L AS
(
    SELECT l.Id, l.BranchId, l.SourceId, l.ProductId, l.PartnerId, l.StatusId,
           st.Code AS StatusCode, l.LostReasonId, l.OwnerId, l.CreatedBy, l.CreatedAt,
           l.EstValue, l.WonValue, l.NextFollowupDate, l.CallListId,   -- 149
           la.LastActivityAt,
           DATEDIFF(DAY, l.CreatedAt, GETDATE()) AS AgeDays,
           CAST(CASE WHEN l.NextFollowupDate < CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN CAST(CAST(GETDATE() AS DATE) AS DATETIME) ELSE GETDATE() END AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           CAST(CASE WHEN st.Code IN ('open','qualified') AND l.NextFollowupDate IS NULL THEN 1 ELSE 0 END AS BIT) AS NoNext,
           CAST(CASE WHEN st.Code IN ('open','qualified')
                      AND ISNULL(la.LastActivityAt, l.CreatedAt) < DATEADD(DAY, -7, GETDATE()) THEN 1 ELSE 0 END AS BIT) AS IsStale,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.tblFollowUp f WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'done')
                       OR EXISTS (SELECT 1 FROM dbo.tblCall c WHERE c.CompId = l.CompId AND c.LeadId = l.Id)
                     THEN 1 ELSE 0 END AS BIT) AS Contacted,
           CAST(CASE WHEN l.Id IN (SELECT LeadId FROM V) THEN 1 ELSE 0 END AS BIT) AS CanOpen
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    CROSS APPLY (
        SELECT CASE WHEN fd.MaxDone IS NULL THEN ac.MaxAct
                    WHEN ac.MaxAct  IS NULL OR fd.MaxDone >= ac.MaxAct THEN fd.MaxDone
                    ELSE ac.MaxAct END AS LastActivityAt
        FROM (SELECT MAX(f.DoneAt) AS MaxDone FROM dbo.tblFollowUp f
              WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'done') fd
        CROSS JOIN
             (SELECT MAX(a.CreatedAt) AS MaxAct FROM dbo.tblLeadActivity a
              WHERE a.CompId = l.CompId AND a.LeadId = l.Id
                AND a.Type IN ('call','followup','note','status','quotation','assigned')) ac
    ) la
    WHERE l.CompId = @CompId
),
Facts AS
(
    -- new
    SELECT CAST('new' AS VARCHAR(12)) AS Metric, CAST('L' AS CHAR(1)) AS Src, l.Id AS RefId, l.Id AS LeadId,
           l.OwnerId AS PersonId, l.CreatedAt AS EventAt, CAST(l.EstValue AS DECIMAL(18,2)) AS Amount,
           CAST(NULL AS NVARCHAR(200)) AS Detail1, CAST(NULL AS NVARCHAR(200)) AS Detail2,
           CAST(NULL AS INT) AS Actor1, CAST(NULL AS INT) AS Actor2
    FROM dbo.tblLeads l
    WHERE l.CompId = @CompId AND l.CreatedAt >= @From AND l.CreatedAt < @ToEx

    UNION ALL   -- done follow-ups, metric = Type
    SELECT CAST(f.Type AS VARCHAR(12)), 'F', f.Id, f.LeadId,
           f.DoneBy, f.DoneAt, CAST(f.Duration AS DECIMAL(18,2)),
           CAST(f.Type AS NVARCHAR(200)), LEFT(f.Remarks, 200),
           f.DoneBy, f.AssignedTo
    FROM dbo.tblFollowUp f
    WHERE f.CompId = @CompId AND f.Status = 'done' AND f.DoneAt >= @From AND f.DoneAt < @ToEx

    UNION ALL   -- calls logged on a lead (Ruling 1)
    SELECT 'call', 'C', c.Id, c.LeadId,
           c.UserId, c.CalledAt, CAST(c.Duration AS DECIMAL(18,2)),
           N'call', LEFT(c.Notes, 200),
           c.UserId, NULL
    FROM dbo.tblCall c
    WHERE c.CompId = @CompId AND c.LeadId IS NOT NULL AND c.CalledAt >= @From AND c.CalledAt < @ToEx

    UNION ALL   -- follow-ups that fell due, one state each (Rulings 4, 5)
    SELECT CAST(CASE
             WHEN f.Status = 'done' AND f.DoneAt <= CASE WHEN CAST(f.DueAt AS TIME) = '00:00'
                                                         THEN DATEADD(DAY, 1, f.DueAt) ELSE DATEADD(HOUR, 2, f.DueAt) END THEN 'fu_ontime'
             WHEN f.Status = 'done'    THEN 'fu_late'
             WHEN f.Status = 'skipped' THEN 'fu_skipped'
             WHEN f.Status = 'open' AND st.Code IN ('open','qualified')
                  AND f.DueAt < CASE WHEN CAST(f.DueAt AS TIME) = '00:00'
                                     THEN CAST(CAST(GETDATE() AS DATE) AS DATETIME) ELSE GETDATE() END THEN 'fu_missed'
             ELSE 'fu_open'
           END AS VARCHAR(12)), 'F', f.Id, f.LeadId,
           COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId), f.DueAt, NULL,
           CAST(f.Type AS NVARCHAR(200)), LEFT(f.Remarks, 200),
           f.DoneBy, f.AssignedTo
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l    ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.tblLookup st  ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status <> 'cancelled' AND f.DueAt >= @From AND f.DueAt < @ToEx
      -- an open follow-up on a lost / junk / converted lead is a leftover (119 cancels them now;
      -- older ones were never cancelled): nobody owes it, so it is neither fu_open nor fu_missed
      AND NOT (f.Status = 'open' AND st.Code IN ('lost','junk','converted'))

    UNION ALL   -- won
    SELECT 'won', 'L', l.Id, l.Id, l.OwnerId, l.WonAt, l.WonValue, NULL, NULL, NULL, NULL
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId AND st.Code = 'converted' AND l.WonAt >= @From AND l.WonAt < @ToEx

    UNION ALL   -- lost
    SELECT 'lost', 'L', l.Id, l.Id, l.OwnerId, l.LostAt, l.EstValue, NULL, NULL, NULL, NULL
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId AND st.Code = 'lost' AND l.LostAt >= @From AND l.LostAt < @ToEx

    UNION ALL   -- open now: ignores @From / @ToEx
    SELECT 'open', 'L', l.Id, l.Id, l.OwnerId, NULL, l.EstValue, NULL, NULL, NULL, NULL
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId AND st.Code IN ('open','qualified')
),
-- 149 BEGIN calling families (Src 'K'). Amount: dial = seconds DialedAt -> CalledAt (NULL when
-- saved without dialling); contact = its tries so far. Detail1 / Detail2: dial = Result /
-- callback booking (booked | kept | missed, NULL when none); contact = Status / CloseReason.
-- LeadId only when the viewer can see that lead (a hidden lead's attributes never travel).
K AS
(
    SELECT CAST('dial' AS VARCHAR(12)) AS Metric, a.Id AS RefId,
           CASE WHEN a.LeadId IN (SELECT LeadId FROM V) THEN a.LeadId END AS LeadId,
           a.UserId AS PersonId, a.CalledAt AS EventAt,
           CAST(CASE WHEN a.DialedAt IS NULL THEN NULL WHEN a.DialedAt > a.CalledAt THEN 0
                     ELSE DATEDIFF(SECOND, a.DialedAt, a.CalledAt) END AS DECIMAL(18,2)) AS Amount,
           CAST(a.Result AS NVARCHAR(200)) AS Detail1,
           CAST(COALESCE(a.CallbackOutcome, CASE WHEN a.Result = 'callback' AND a.CallbackAt IS NOT NULL THEN 'booked' END) AS NVARCHAR(200)) AS Detail2,
           a.CallListId
    FROM dbo.tblCallAttempt a
    WHERE a.CompId = @CompId AND a.UndoneAt IS NULL AND a.CalledAt >= @From AND a.CalledAt < @ToEx

    UNION ALL   -- dial_first: that caller's first call on that contact inside the period ("contacts called")
    SELECT 'dial_first', a.Id, CASE WHEN a.LeadId IN (SELECT LeadId FROM V) THEN a.LeadId END,
           a.UserId, a.CalledAt, NULL, CAST(a.Result AS NVARCHAR(200)), NULL, a.CallListId
    FROM dbo.tblCallAttempt a
    WHERE a.CompId = @CompId AND a.UndoneAt IS NULL AND a.CalledAt >= @From AND a.CalledAt < @ToEx
      AND NOT EXISTS (SELECT 1 FROM dbo.tblCallAttempt e
                      WHERE e.CompId = a.CompId AND e.ContactId = a.ContactId AND e.UserId = a.UserId
                        AND e.UndoneAt IS NULL AND e.CalledAt >= @From
                        AND (e.CalledAt < a.CalledAt OR (e.CalledAt = a.CalledAt AND e.Id < a.Id)))

    UNION ALL   -- contact: every contact of a list as it stands now (ignores the dates, like 'open')
    SELECT 'contact', c.Id, CASE WHEN c.LeadId IN (SELECT LeadId FROM V) THEN c.LeadId END,
           c.HeldBy, NULL, CAST(c.Attempts AS DECIMAL(18,2)),
           CAST(c.Status AS NVARCHAR(200)), CAST(c.CloseReason AS NVARCHAR(200)), c.CallListId
    FROM dbo.tblCallContact c
    WHERE c.CompId = @CompId
)
-- 149 END
SELECT x.Metric, x.Src, x.RefId, x.LeadId, x.PersonId, x.EventAt, x.Amount, x.Detail1, x.Detail2,
       L.BranchId, L.SourceId, L.ProductId, L.PartnerId, L.StatusId, L.StatusCode, L.LostReasonId,
       L.OwnerId, L.CreatedAt, L.EstValue, L.WonValue, L.NextFollowupDate, L.LastActivityAt,
       L.AgeDays, L.IsOverdue, L.NoNext, L.IsStale, L.Contacted, L.CanOpen,
       L.CallListId   -- 149: every row carries its list (the lead's, or the call's / contact's)
FROM Facts x
JOIN L ON L.Id = x.LeadId
WHERE
    -- record families: only leads the viewer can see (Rule 1)
    (x.Src = 'L' AND L.CanOpen = 1)
    -- activity families (spec 3.6): the lead is visible, or the person credited
    -- with the row has a line in the viewer's Team report
 OR (x.Src IN ('F','C') AND (L.CanOpen = 1 OR x.PersonId IN (SELECT PersonId FROM P)))
UNION ALL   -- 149: the calling families. BranchId = the list's office; CanOpen = the viewer manages
            -- the list (a caller's own drill then shows names, never numbers or links).
SELECT k.Metric, CAST('K' AS CHAR(1)), k.RefId, k.LeadId, k.PersonId, k.EventAt, k.Amount, k.Detail1, k.Detail2,
       cl.BranchId, L.SourceId, L.ProductId, L.PartnerId, L.StatusId, L.StatusCode, L.LostReasonId,
       L.OwnerId, L.CreatedAt, L.EstValue, L.WonValue, L.NextFollowupDate, L.LastActivityAt,
       L.AgeDays, L.IsOverdue, L.NoNext, L.IsStale, L.Contacted,
       CAST(CASE WHEN k.CallListId IN (SELECT CallListId FROM VC) THEN 1 ELSE 0 END AS BIT),
       k.CallListId
FROM K k
JOIN dbo.tblCallList cl ON cl.Id = k.CallListId AND cl.CompId = @CompId
LEFT JOIN L ON L.Id = k.LeadId
WHERE
    -- calls: by the people-subject rule with the caller as the actor (as a done call follow-up), or the list is managed
    (k.Metric IN ('dial','dial_first') AND (k.PersonId IN (SELECT PersonId FROM P) OR k.CallListId IN (SELECT CallListId FROM VC)))
    -- the pool as it stands: list managers only
 OR (k.Metric = 'contact' AND k.CallListId IN (SELECT CallListId FROM VC));
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_RptSales from its live definition. + @GroupBy 'caller' (flat, by PersonId, K rows only) and 'calllist' (by CallListId, every family);
--      + @CallListId (narrows); RS1 + the calling columns and a list's attributes. K rows reach
--      only the two calling group-bys, so team / source / person / reason are unchanged.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 4. sp_RptSales (122 body). The two lists are gone; the opening block reads
--    the definitions:
--    - "unassigned" line (owner axis off) = leads reach Office or wider, as the
--      old lists made it (Own and Team carried an owner list);
--    - Ruling 7 (N2): with @BranchId / @SourceId / @ProductId set, or grouped
--      by source, only rows on visible leads count (an activity on a hidden
--      lead would otherwise tell the viewer that lead's office / source /
--      product). Team / person lines are people; reason lines are lost rows.
--    The opening block is the same in sp_RptSalesRows; change both together.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_RptSales
    @CompId                  INT,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @GroupBy                 VARCHAR(12),
    @NodeId                  INT           = NULL,
    @BranchId                INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @UserId                  INT,
    @LinesOnly               BIT           = 0,
    @CallListId              INT           = NULL   -- 149: narrows to one calling list
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy IS NULL OR @GroupBy NOT IN ('team','source','person','reason','caller','calllist')   -- 149
    BEGIN RAISERROR('sp_RptSales: @GroupBy must be team, source, person, reason, caller or calllist.', 16, 1); RETURN; END;
    DECLARE @IsAdmin149 BIT = CASE WHEN EXISTS (   -- 149: ListCost goes to admins only
        SELECT 1 FROM dbo.tblUserGroupMap m
        JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1 AND g.CompId = @CompId
        WHERE m.UserId = @UserId) THEN 1 ELSE 0 END;

    -- opening block, same in sp_RptSalesRows -------------------------------
    DECLARE @ToEx DATE = DATEADD(DAY, 1, @ToDate);
    -- "unassigned" line only for leads reach Office or wider (owner axis off, as the old lists made it)
    DECLARE @OwnerOff BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads')
                                              WHERE ReachLevel >= 3) THEN 1 ELSE 0 END;
    -- Ruling 7 (N2): filtered by office / source / product, or grouped by source (each
    -- line names a lead attribute) -> rows on visible leads only. Team / person lines are
    -- people; reason lines are lost rows (a record family, always visible).
    DECLARE @Filtered BIT = CASE WHEN @BranchId IS NULL AND @SourceId IS NULL AND @ProductId IS NULL
                                  AND @GroupBy <> 'source'
                                  AND @CallListId IS NULL AND @GroupBy <> 'calllist'   -- 149: a list names a record attribute too
                             THEN 0 ELSE 1 END;
    SELECT * INTO #T FROM dbo.fn_ReportTree(@CompId, @UserId);
    SELECT r.* INTO #R
    FROM dbo.fn_SalesReportRows(@CompId, @FromDate, @ToEx, @UserId) r
    WHERE (@Filtered = 0 OR r.CanOpen = 1)
      AND (@BranchId  IS NULL OR r.BranchId  = @BranchId)
      AND (@SourceId  IS NULL OR r.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR r.ProductId = @ProductId)
      AND (@CallListId IS NULL OR r.CallListId = @CallListId)                -- 149
      AND (r.Src <> 'K' OR @GroupBy IN ('caller','calllist'))                 -- 149: calling rows only on calling lines
      -- Open leads report: "Leads created in"
      AND NOT (@GroupBy = 'person' AND r.Metric = 'open'
               AND (   (@FromDate IS NOT NULL AND r.CreatedAt <  @FromDate)
                    OR (@ToEx     IS NOT NULL AND r.CreatedAt >= @ToEx)));
    -- end of the opening block ---------------------------------------------

    CREATE TABLE #Map (PersonId INT PRIMARY KEY, GroupKey INT NOT NULL);
    CREATE TABLE #L (GroupKey INT NULL, LineKind VARCHAR(10) NOT NULL, Ord INT NOT NULL,
                     NoManager BIT NOT NULL, TeamSize INT NOT NULL,
                     GroupLabel NVARCHAR(200) NULL, IsActive BIT NOT NULL DEFAULT 1);
    DECLARE @NodeOk BIT = 1, @Me INT, @Level INT;

    IF @GroupBy = 'team'
    BEGIN
        SELECT @Me = PersonId FROM #T WHERE Depth = 0 AND PersonId = @UserId;
        IF @NodeId IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM #T WHERE AncestorId = @NodeId AND Depth >= 1) SET @Level = @NodeId;
            ELSE SET @NodeOk = 0;
        END
        ELSE IF EXISTS (SELECT 1 FROM #T WHERE AncestorId = @Me AND Depth >= 1) SET @Level = @Me;

        -- the level: direct reports rolled up, the level person's own rows on ChildId = @Level
        INSERT INTO #Map (PersonId, GroupKey) SELECT PersonId, ChildId FROM #T WHERE AncestorId = @Level;

        IF @NodeId IS NULL
        BEGIN
            IF @Level IS NULL AND @Me IS NOT NULL INSERT INTO #Map (PersonId, GroupKey) VALUES (@Me, @Me);
            -- every other root, rolled up over its subtree
            INSERT INTO #Map (PersonId, GroupKey)
            SELECT t.PersonId, t.AncestorId
            FROM #T t
            WHERE t.AncestorId <> ISNULL(@Me, -1)
              AND NOT EXISTS (SELECT 1 FROM #T up WHERE up.PersonId = t.AncestorId AND up.Depth >= 1);
        END;

        INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize)
        SELECT k.GroupKey,
               CASE WHEN k.GroupKey = @Level THEN 'own'
                    WHEN s.TeamSize > 1      THEN 'team' ELSE 'person' END,
               CASE WHEN k.GroupKey = @Level THEN 3
                    WHEN lv.IsLevel = 1      THEN 1
                    WHEN k.GroupKey = @Me    THEN 3
                    WHEN t0.NoManager = 1    THEN 4 ELSE 2 END,
               CASE WHEN lv.IsLevel = 0 AND k.GroupKey <> ISNULL(@Me, -1) THEN t0.NoManager ELSE 0 END,
               s.TeamSize
        FROM (SELECT DISTINCT GroupKey FROM #Map) k
        JOIN #T t0 ON t0.AncestorId = k.GroupKey AND t0.PersonId = k.GroupKey
        CROSS APPLY (SELECT COUNT(*) AS TeamSize FROM #T s WHERE s.AncestorId = k.GroupKey) s
        CROSS APPLY (SELECT CASE WHEN EXISTS (SELECT 1 FROM #T c WHERE c.AncestorId = @Level AND c.ChildId = k.GroupKey)
                                 THEN 1 ELSE 0 END AS IsLevel) lv;

        IF @NodeId IS NULL AND @OwnerOff = 1
            INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize) VALUES (NULL, 'unassigned', 5, 0, 0);
    END
    ELSE IF @GroupBy = 'person'
    BEGIN
        INSERT INTO #Map (PersonId, GroupKey) SELECT PersonId, PersonId FROM #T WHERE Depth = 0;
        INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize)
        SELECT GroupKey, 'person', 1, 0, 1 FROM #Map;
        IF @OwnerOff = 1
            INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize) VALUES (NULL, 'unassigned', 5, 0, 0);
    END;

    -- every counted row with its line key
    -- source / reason lines take every #R row: they are NOT person-scoped through #T (those reports
    -- have no person axis), so a Lead sources total can differ from the Team report total by the rows
    -- credited to people out of view (V13) — the 'team' / 'person' lines drop those.
    SELECT CASE @GroupBy WHEN 'source' THEN r.SourceId WHEN 'reason' THEN r.LostReasonId
                         WHEN 'caller' THEN r.PersonId WHEN 'calllist' THEN r.CallListId   -- 149
                         ELSE m.GroupKey END AS GroupKey,
           r.*
    INTO #G
    FROM #R r
    LEFT JOIN #Map m ON m.PersonId = r.PersonId
    WHERE @GroupBy = 'source'
       OR (@GroupBy = 'reason' AND r.Metric = 'lost')
       OR (@GroupBy = 'caller' AND r.Src = 'K')                         -- 149: flat, by who rang / holds
       OR (@GroupBy = 'calllist' AND r.CallListId IS NOT NULL)          -- 149: every family of a list
       OR (@GroupBy IN ('team','person')
           AND (   m.PersonId IS NOT NULL
                OR (r.PersonId IS NULL AND EXISTS (SELECT 1 FROM #L WHERE LineKind = 'unassigned'))));

    IF @GroupBy IN ('source','reason','caller','calllist')   -- 149
        INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize)
        SELECT DISTINCT GroupKey, 'group', 1, 0, 1 FROM #G;

    UPDATE l SET
        GroupLabel = CASE WHEN l.LineKind = 'unassigned' THEN N'Unassigned leads'
                          WHEN @GroupBy = 'caller' THEN ISNULL(CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200)), N'Not with anyone')   -- 149
                          WHEN @GroupBy = 'calllist' THEN cl.Name   -- 149
                          WHEN @GroupBy IN ('team','person') THEN CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200))
                          WHEN @GroupBy = 'source' THEN ISNULL(lk.Value, N'No source')
                          ELSE ISNULL(lk.Value, N'No reason given') END,
        IsActive   = CASE WHEN @GroupBy IN ('team','person') AND l.LineKind <> 'unassigned' THEN ISNULL(u.IsActive, 0)
                          WHEN @GroupBy = 'caller' AND l.GroupKey IS NOT NULL THEN ISNULL(u.IsActive, 0)   -- 149
                          ELSE 1 END
    FROM #L l
    LEFT JOIN dbo.tblUser   u  ON u.Id  = l.GroupKey AND @GroupBy IN ('team','person','caller')   -- 149: + caller
    LEFT JOIN dbo.tblLookup lk ON lk.Id = l.GroupKey AND @GroupBy IN ('source','reason')
    LEFT JOIN dbo.tblCallList cl ON cl.Id = l.GroupKey AND @GroupBy = 'calllist';   -- 149

    -- RS1 lines
    SELECT l.GroupKey, l.GroupLabel, l.LineKind, l.TeamSize, l.IsActive, l.NoManager, l.Ord,
           SUM(CASE WHEN g.Metric = 'new'        THEN 1 ELSE 0 END) AS New,
           SUM(CASE WHEN g.Metric = 'call'       THEN 1 ELSE 0 END) AS Calls,
           SUM(CASE WHEN g.Metric = 'visit'      THEN 1 ELSE 0 END) AS Visits,
           SUM(CASE WHEN g.Metric = 'meeting'    THEN 1 ELSE 0 END) AS Meetings,
           SUM(CASE WHEN g.Metric = 'other'      THEN 1 ELSE 0 END) AS Other,
           SUM(CASE WHEN g.Metric = 'fu_ontime'  THEN 1 ELSE 0 END) AS FuOnTime,
           SUM(CASE WHEN g.Metric = 'fu_late'    THEN 1 ELSE 0 END) AS FuLate,
           SUM(CASE WHEN g.Metric = 'fu_skipped' THEN 1 ELSE 0 END) AS FuSkipped,
           SUM(CASE WHEN g.Metric = 'fu_missed'  THEN 1 ELSE 0 END) AS FuMissed,
           SUM(CASE WHEN g.Metric = 'fu_open'    THEN 1 ELSE 0 END) AS FuOpen,
           SUM(CASE WHEN g.Metric = 'won'        THEN 1 ELSE 0 END) AS Won,
           CAST(SUM(CASE WHEN g.Metric = 'won'   THEN ISNULL(g.Amount, 0) ELSE 0 END) AS DECIMAL(18,2)) AS WonValue,
           SUM(CASE WHEN g.Metric = 'lost'       THEN 1 ELSE 0 END) AS Lost,
           CAST(SUM(CASE WHEN g.Metric = 'lost'  THEN ISNULL(g.Amount, 0) ELSE 0 END) AS DECIMAL(18,2)) AS LostValue,
           SUM(CASE WHEN g.Metric = 'open'       THEN 1 ELSE 0 END) AS OpenNow,
           CAST(SUM(CASE WHEN g.Metric = 'open'  THEN ISNULL(g.Amount, 0) ELSE 0 END) AS DECIMAL(18,2)) AS OpenValue,
           SUM(CASE WHEN g.Metric = 'open' AND g.IsOverdue = 1 THEN 1 ELSE 0 END) AS OverdueNow,
           SUM(CASE WHEN g.Metric = 'open' AND g.NoNext    = 1 THEN 1 ELSE 0 END) AS NoNext,
           SUM(CASE WHEN g.Metric = 'open' AND g.IsStale   = 1 THEN 1 ELSE 0 END) AS Stale,
           SUM(CASE WHEN g.Metric = 'open' AND g.AgeDays <= 7              THEN 1 ELSE 0 END) AS Age0_7,
           SUM(CASE WHEN g.Metric = 'open' AND g.AgeDays BETWEEN 8  AND 30 THEN 1 ELSE 0 END) AS Age8_30,
           SUM(CASE WHEN g.Metric = 'open' AND g.AgeDays BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS Age31_90,
           SUM(CASE WHEN g.Metric = 'open' AND g.AgeDays > 90              THEN 1 ELSE 0 END) AS Age90Plus,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode IN ('open','qualified') THEN 1 ELSE 0 END) AS CohortOpen,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode = 'converted'           THEN 1 ELSE 0 END) AS CohortWon,
           CAST(SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode = 'converted' THEN ISNULL(g.WonValue, 0) ELSE 0 END) AS DECIMAL(18,2)) AS CohortWonValue,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode = 'lost'                THEN 1 ELSE 0 END) AS CohortLost,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode = 'junk'                THEN 1 ELSE 0 END) AS CohortJunk,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode IN ('open','qualified') AND g.Contacted = 0 THEN 1 ELSE 0 END) AS CohortUntouched,
           SUM(CASE WHEN g.Metric = 'lost' THEN DATEDIFF(DAY, g.CreatedAt, g.EventAt) ELSE 0 END) AS DaysOpenSum,
           SUM(CASE WHEN g.Metric = 'lost' THEN 1 ELSE 0 END) AS DaysOpenN,
           -- 149 calling columns; each flag of sp_RptSalesRows repeats its expression here
           SUM(CASE WHEN g.Metric = 'dial'       THEN 1 ELSE 0 END) AS Dials,
           SUM(CASE WHEN g.Metric = 'dial_first' THEN 1 ELSE 0 END) AS DialContacts,
           SUM(CASE WHEN g.Metric = 'dial' AND g.Detail1 IN ('interested','not_interested','callback','dnc') THEN 1 ELSE 0 END) AS DialReached,   -- = @Flag 'reached'
           SUM(CASE WHEN g.Metric = 'dial' AND g.Amount IS NULL THEN 1 ELSE 0 END) AS DialNoDial,                 -- = @Flag 'nodial'
           CAST(SUM(CASE WHEN g.Metric = 'dial' AND g.Amount IS NOT NULL THEN g.Amount ELSE 0 END) AS DECIMAL(18,2)) AS DialSecSum,
           SUM(CASE WHEN g.Metric = 'dial' AND g.Amount IS NOT NULL THEN 1 ELSE 0 END) AS DialSecN,
           SUM(CASE WHEN g.Metric = 'dial' AND g.Detail1 = 'callback' AND g.Detail2 IS NOT NULL THEN 1 ELSE 0 END) AS CbBooked,   -- = @Flag 'cbbooked'
           SUM(CASE WHEN g.Metric = 'dial' AND g.Detail2 = 'kept'   THEN 1 ELSE 0 END) AS CbKept,                 -- = @Flag 'cbkept'
           SUM(CASE WHEN g.Metric = 'dial' AND g.Detail2 = 'missed' THEN 1 ELSE 0 END) AS CbMissed,               -- = @Flag 'cbmissed'
           SUM(CASE WHEN g.Metric = 'contact' THEN 1 ELSE 0 END) AS ListContacts,
           SUM(CASE WHEN g.Metric = 'contact' AND (g.Detail1 <> 'pool' OR g.Amount > 0) THEN 1 ELSE 0 END) AS ListUsed,   -- = @Flag 'used'
           -- 149: a list's own attributes on calllist lines (ListCost NULL unless the caller is an admin)
           MAX(CASE WHEN @IsAdmin149 = 1 THEN cl149.Cost END) AS ListCost, MAX(cl149.SheetRows) AS SheetRows,   -- cost: admins only, in SQL too
           MAX(cl149.SkippedDup) AS SkippedDup, MAX(cl149.SkippedBad) AS SkippedBad
    FROM #L l
    LEFT JOIN #G g ON ISNULL(g.GroupKey, -1) = ISNULL(l.GroupKey, -1)
    LEFT JOIN dbo.tblCallList cl149 ON @GroupBy = 'calllist' AND cl149.Id = l.GroupKey   -- 149
    GROUP BY l.GroupKey, l.GroupLabel, l.LineKind, l.TeamSize, l.IsActive, l.NoManager, l.Ord
    HAVING COUNT(g.Metric) > 0
        OR (@GroupBy = 'team' AND l.LineKind <> 'unassigned' AND l.IsActive = 1)
    ORDER BY l.Ord, l.GroupLabel;

    IF @LinesOnly = 1 RETURN;

    -- RS2 path: the node's ancestors from the top down, the caller left out, then the node
    SELECT CAST(ROW_NUMBER() OVER (ORDER BY t.Depth DESC) AS INT) AS Ord, t.AncestorId AS Id,
           CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200)) AS Name
    FROM #T t
    JOIN dbo.tblUser u ON u.Id = t.AncestorId
    WHERE @GroupBy = 'team' AND @NodeOk = 1 AND t.PersonId = @NodeId
      AND t.AncestorId <> ISNULL(@UserId, -1)
    ORDER BY t.Depth DESC;

    -- RS3
    SELECT @NodeOk AS NodeOk;
END
GO

-- ---------------------------------------------------------------------------
-- 149: dbo.sp_RptSalesRows from its live definition. + @GroupBy 'caller' / 'calllist' (drilled by @GroupKey / @GroupKeyIsNull, as source / reason);
--      + @CallListId; @Metric + dial, dial_first, contact; @Flag + reached, nodial, cbbooked, cbkept,
--      cbmissed, used. K rows fill LeadName (contact name), Company, MobileNo (NULL when CanOpen = 0),
--      + CallListId, CallListName. Total is still counted before TOP.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 5. sp_RptSalesRows (122 body), same opening block. F2 / D8:
--    - rows are returned only where CanOpen = 1 (both shapes);
--    - RS2 Total still counts every matching row, so it equals the summary
--      cell (= returned rows + HiddenCount); AmountTotal (and WonValue in the
--      leads shape) only from rows on visible leads; in the leads shape Total
--      = every matching lead (listed + HiddenCount), the N* counts stay = the
--      summary cells;
--    - a last recordset HiddenCount INT = matching rows (leads shape: leads)
--      out of view ("N activities on leads no longer in your view"), only when
--      @MaxRows > 0 (@MaxRows = 0 stays one result set for INSERT ... EXEC).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_RptSalesRows
    @CompId                  INT,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @GroupBy                 VARCHAR(12),
    @Metric                  VARCHAR(12),
    @Shape                   VARCHAR(6),
    @PersonId                INT           = NULL,
    @Rollup                  BIT           = 0,
    @Unassigned              BIT           = 0,
    @GroupKey                INT           = NULL,
    @GroupKeyIsNull          BIT           = 0,
    @State                   VARCHAR(10)   = NULL,
    @AgeBucket               VARCHAR(6)    = NULL,
    @Flag                    VARCHAR(8)    = NULL,
    @BranchId                INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @MaxRows                 INT           = 2000,
    @UserId                  INT,
    @CallListId              INT           = NULL   -- 149: narrows to one calling list
AS
BEGIN
    SET NOCOUNT ON;
    SET @Rollup         = ISNULL(@Rollup, 0);
    SET @Unassigned     = ISNULL(@Unassigned, 0);
    SET @GroupKeyIsNull = ISNULL(@GroupKeyIsNull, 0);
    SET @MaxRows        = CASE WHEN @MaxRows IS NULL THEN 2000 WHEN @MaxRows < 0 THEN 0 ELSE @MaxRows END;

    IF @GroupBy IS NULL OR @GroupBy NOT IN ('team','source','person','reason','caller','calllist')   -- 149
    BEGIN RAISERROR('sp_RptSalesRows: @GroupBy must be team, source, person, reason, caller or calllist.', 16, 1); RETURN; END;
    IF @Shape IS NULL OR @Shape NOT IN ('events','leads')
    BEGIN RAISERROR('sp_RptSalesRows: @Shape must be events or leads.', 16, 1); RETURN; END;
    IF (@State IS NOT NULL AND @State NOT IN ('open','won','lost','junk','untouched'))
       OR (@AgeBucket IS NOT NULL AND @AgeBucket NOT IN ('0_7','8_30','31_90','90p'))
       OR (@Flag IS NOT NULL AND @Flag NOT IN ('overdue','nonext','stale',
                                               'reached','nodial','cbbooked','cbkept','cbmissed','used'))   -- 149
    BEGIN RAISERROR('sp_RptSalesRows: unknown @State, @AgeBucket or @Flag.', 16, 1); RETURN; END;
    IF @Shape = 'leads' AND (@Metric <> 'all' OR @PersonId IS NULL OR @Rollup = 1)
    BEGIN RAISERROR('sp_RptSalesRows: @Shape leads needs @Metric all and one @PersonId without @Rollup.', 16, 1); RETURN; END;

    DECLARE @M TABLE (Metric VARCHAR(12) PRIMARY KEY);
    INSERT INTO @M (Metric)
    SELECT v.m
    FROM (VALUES ('new'),('call'),('visit'),('meeting'),('other'),
                 ('fu_ontime'),('fu_late'),('fu_skipped'),('fu_missed'),('fu_open'),
                 ('won'),('lost'),('open'),
                 ('dial'),('dial_first'),('contact')) v(m)   -- 149
    WHERE v.m = @Metric
       OR (@Metric = 'visits' AND v.m IN ('visit','meeting'))
       OR (@Metric = 'fu_due' AND v.m LIKE 'fu[_]%')
       OR (@Metric = 'all'    AND v.m NOT IN ('open','dial','dial_first','contact'));   -- 149: 'all' stays the lead families
    IF NOT EXISTS (SELECT 1 FROM @M)
    BEGIN RAISERROR('sp_RptSalesRows: unknown @Metric.', 16, 1); RETURN; END;

    -- opening block, same in sp_RptSales -----------------------------------
    DECLARE @ToEx DATE = DATEADD(DAY, 1, @ToDate);
    -- "unassigned" line only for leads reach Office or wider (owner axis off, as the old lists made it)
    DECLARE @OwnerOff BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads')
                                              WHERE ReachLevel >= 3) THEN 1 ELSE 0 END;
    -- Ruling 7 (N2): filtered by office / source / product, or grouped by source (each
    -- line names a lead attribute) -> rows on visible leads only. Team / person lines are
    -- people; reason lines are lost rows (a record family, always visible).
    DECLARE @Filtered BIT = CASE WHEN @BranchId IS NULL AND @SourceId IS NULL AND @ProductId IS NULL
                                  AND @GroupBy <> 'source'
                                  AND @CallListId IS NULL AND @GroupBy <> 'calllist'   -- 149: a list names a record attribute too
                             THEN 0 ELSE 1 END;
    SELECT * INTO #T FROM dbo.fn_ReportTree(@CompId, @UserId);
    SELECT r.* INTO #R
    FROM dbo.fn_SalesReportRows(@CompId, @FromDate, @ToEx, @UserId) r
    WHERE (@Filtered = 0 OR r.CanOpen = 1)
      AND (@BranchId  IS NULL OR r.BranchId  = @BranchId)
      AND (@SourceId  IS NULL OR r.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR r.ProductId = @ProductId)
      AND (@CallListId IS NULL OR r.CallListId = @CallListId)                -- 149
      AND (r.Src <> 'K' OR @GroupBy IN ('caller','calllist'))                 -- 149: calling rows only on calling lines
      -- Open leads report: "Leads created in"
      AND NOT (@GroupBy = 'person' AND r.Metric = 'open'
               AND (   (@FromDate IS NOT NULL AND r.CreatedAt <  @FromDate)
                    OR (@ToEx     IS NOT NULL AND r.CreatedAt >= @ToEx)));
    -- end of the opening block ---------------------------------------------

    SELECT r.* INTO #F
    FROM #R r
    WHERE r.Metric IN (SELECT Metric FROM @M)
      -- person
      AND (   (@Unassigned = 1 AND r.PersonId IS NULL AND @OwnerOff = 1)
           OR (@Unassigned = 0 AND @PersonId IS NOT NULL
               AND r.PersonId IN (SELECT t.PersonId FROM #T t
                                  WHERE t.AncestorId = @PersonId AND (@Rollup = 1 OR t.Depth = 0)))
           OR (@Unassigned = 0 AND @PersonId IS NULL AND @GroupBy IN ('team','person')
               AND (   r.PersonId IN (SELECT t.PersonId FROM #T t WHERE t.Depth = 0)
                    OR (r.PersonId IS NULL AND @OwnerOff = 1)))
           OR (@Unassigned = 0 AND @PersonId IS NULL AND @GroupBy IN ('source','reason','caller','calllist')))   -- 149
      -- source / reason / caller / calllist line (149: + caller = PersonId, calllist = CallListId, as sp_RptSales #G)
      AND (@GroupBy <> 'reason' OR r.Metric = 'lost')
      AND (@GroupBy <> 'caller' OR r.Src = 'K')                       -- 149
      AND (@GroupBy <> 'calllist' OR r.CallListId IS NOT NULL)        -- 149
      AND (   @GroupBy NOT IN ('source','reason','caller','calllist')
           OR (@GroupKeyIsNull = 0 AND @GroupKey IS NULL)
           OR (@GroupKeyIsNull = 1 AND CASE @GroupBy WHEN 'source' THEN r.SourceId WHEN 'reason' THEN r.LostReasonId
                                                     WHEN 'caller' THEN r.PersonId ELSE r.CallListId END IS NULL)
           OR (@GroupKeyIsNull = 0 AND CASE @GroupBy WHEN 'source' THEN r.SourceId WHEN 'reason' THEN r.LostReasonId
                                                     WHEN 'caller' THEN r.PersonId ELSE r.CallListId END = @GroupKey))
      -- the summary's column expressions
      AND (   @State IS NULL
           OR (@State = 'open'      AND r.StatusCode IN ('open','qualified'))
           OR (@State = 'won'       AND r.StatusCode = 'converted')
           OR (@State = 'lost'      AND r.StatusCode = 'lost')
           OR (@State = 'junk'      AND r.StatusCode = 'junk')
           OR (@State = 'untouched' AND r.StatusCode IN ('open','qualified') AND r.Contacted = 0))
      AND (   @AgeBucket IS NULL
           OR (@AgeBucket = '0_7'   AND r.AgeDays <= 7)
           OR (@AgeBucket = '8_30'  AND r.AgeDays BETWEEN 8  AND 30)
           OR (@AgeBucket = '31_90' AND r.AgeDays BETWEEN 31 AND 90)
           OR (@AgeBucket = '90p'   AND r.AgeDays > 90))
      AND (   @Flag IS NULL
           OR (@Flag = 'overdue' AND r.IsOverdue = 1)
           OR (@Flag = 'nonext'  AND r.NoNext    = 1)
           OR (@Flag = 'stale'   AND r.IsStale   = 1)
           -- 149: each flag is the same expression as its sp_RptSales column (named on the right)
           OR (@Flag = 'reached'  AND r.Metric = 'dial' AND r.Detail1 IN ('interested','not_interested','callback','dnc'))   -- DialReached
           OR (@Flag = 'nodial'   AND r.Metric = 'dial' AND r.Amount IS NULL)                                              -- DialNoDial
           OR (@Flag = 'cbbooked' AND r.Metric = 'dial' AND r.Detail1 = 'callback' AND r.Detail2 IS NOT NULL)            -- CbBooked
           OR (@Flag = 'cbkept'   AND r.Metric = 'dial' AND r.Detail2 = 'kept')                                            -- CbKept
           OR (@Flag = 'cbmissed' AND r.Metric = 'dial' AND r.Detail2 = 'missed')                                          -- CbMissed
           OR (@Flag = 'used'     AND r.Metric = 'contact' AND (r.Detail1 <> 'pool' OR r.Amount > 0)));                    -- ListUsed

    IF @Shape = 'events'
    BEGIN
        IF @MaxRows > 0
            SELECT TOP (@MaxRows)
                   f.EventAt, f.Metric, f.Src, f.RefId, f.LeadId,
                   -- 149: a finished contact is cleared for callers: its name shows only to a manager of the list
                   -- (CanOpen) or on the viewer's own call of today
                   CASE WHEN f.Src <> 'K' THEN l.Name
                        WHEN f.CanOpen = 1 THEN COALESCE(kc.Name, kc.Mobile)
                        WHEN f.PersonId = @UserId AND f.EventAt >= CAST(CAST(GETDATE() AS DATE) AS DATETIME) THEN kc.Name END AS LeadName,   -- 149
                   f.CreatedAt,
                   CASE WHEN f.CanOpen = 1 THEN CASE WHEN f.Src = 'K' THEN kc.Mobile ELSE l.MobileNo END END AS MobileNo,   -- 149
                   CASE WHEN f.Src <> 'K' THEN l.Company
                        WHEN f.CanOpen = 1 OR (f.PersonId = @UserId AND f.EventAt >= CAST(CAST(GETDATE() AS DATE) AS DATETIME))
                        THEN kc.Company END AS Company,   -- 149: same rule as the name
                   f.PersonId, CAST(COALESCE(NULLIF(p.FullName, ''), p.Username) AS NVARCHAR(200)) AS PersonName,
                   CAST(COALESCE(NULLIF(o.FullName, ''), o.Username) AS NVARCHAR(200)) AS OwnerName,
                   src.Value AS SourceName, st.Value AS StatusName, f.StatusCode, f.Amount, f.Detail1, f.Detail2, f.CanOpen,
                   lr.Value AS LostReason, l.Remarks, q.QuoteNo, f.LastActivityAt, f.NextFollowupDate,
                   f.AgeDays, f.IsOverdue, f.IsStale,
                   f.CallListId, kl.Name AS CallListName   -- 149
            FROM #F f
            LEFT JOIN dbo.tblLeads l   ON l.Id = f.LeadId   -- 149: LEFT, a calling row may have no lead
            LEFT JOIN dbo.tblCallList kl ON kl.Id = f.CallListId   -- 149
            OUTER APPLY (SELECT TOP (1) cc.Name, cc.Company, cc.Mobile FROM dbo.tblCallContact cc   -- 149: the contact behind a K row
                         WHERE f.Src = 'K' AND cc.CompId = @CompId
                           AND cc.Id = CASE WHEN f.Metric = 'contact' THEN f.RefId
                                            ELSE (SELECT a.ContactId FROM dbo.tblCallAttempt a WHERE a.Id = f.RefId) END) kc
            LEFT JOIN dbo.tblUser p    ON p.Id = f.PersonId
            LEFT JOIN dbo.tblUser o    ON o.Id = f.OwnerId
            LEFT JOIN dbo.tblLookup src ON src.Id = f.SourceId
            LEFT JOIN dbo.tblLookup st  ON st.Id = f.StatusId
            LEFT JOIN dbo.tblLookup lr  ON lr.Id = f.LostReasonId
            OUTER APPLY (SELECT TOP 1 qq.QuoteNo FROM dbo.tblQuotation qq
                         WHERE qq.CompId = @CompId AND qq.LeadId = f.LeadId AND qq.Status = 'accepted'
                         ORDER BY qq.Id DESC) q
            WHERE (f.CanOpen = 1 OR f.Src = 'K')    -- F2 / D8: no rows for leads out of view; 149: calling rows list
                                                    -- (name / number only as the rule above allows)
            ORDER BY CASE WHEN @Metric = 'open' THEN f.AgeDays END DESC,
                     CASE WHEN @Metric = 'open' THEN f.LeadId  END DESC,
                     f.EventAt DESC, f.RefId DESC;

        -- Total = every matching row (= the summary cell); money only from visible leads
        SELECT COUNT(*) AS Total, CAST(ISNULL(SUM(CASE WHEN CanOpen = 1 THEN Amount END), 0) AS DECIMAL(18,2)) AS AmountTotal FROM #F;
    END
    ELSE
    BEGIN
        SELECT f.LeadId, f.StatusId, f.StatusCode, f.OwnerId, f.CreatedAt, f.EstValue, f.WonValue,
               f.LastActivityAt, f.NextFollowupDate, f.IsOverdue, f.IsStale, f.CanOpen,
               SUM(CASE WHEN f.Metric = 'new'                    THEN 1 ELSE 0 END) AS NNew,
               SUM(CASE WHEN f.Metric = 'call'                   THEN 1 ELSE 0 END) AS NCalls,
               SUM(CASE WHEN f.Metric IN ('visit','meeting')     THEN 1 ELSE 0 END) AS NVisits,
               SUM(CASE WHEN f.Metric = 'other'                  THEN 1 ELSE 0 END) AS NOther,
               SUM(CASE WHEN f.Metric LIKE 'fu[_]%'              THEN 1 ELSE 0 END) AS NDue,
               SUM(CASE WHEN f.Metric = 'fu_ontime'              THEN 1 ELSE 0 END) AS NOnTime,
               SUM(CASE WHEN f.Metric = 'fu_late'                THEN 1 ELSE 0 END) AS NLate,
               SUM(CASE WHEN f.Metric = 'fu_skipped'             THEN 1 ELSE 0 END) AS NSkipped,
               SUM(CASE WHEN f.Metric = 'fu_missed'              THEN 1 ELSE 0 END) AS NMissed,
               SUM(CASE WHEN f.Metric = 'won'                    THEN 1 ELSE 0 END) AS NWon,
               SUM(CASE WHEN f.Metric = 'won' THEN ISNULL(f.Amount, 0) ELSE 0 END)  AS WonAmount,
               SUM(CASE WHEN f.Metric = 'lost'                   THEN 1 ELSE 0 END) AS NLost
        INTO #LD
        FROM #F f
        GROUP BY f.LeadId, f.StatusId, f.StatusCode, f.OwnerId, f.CreatedAt, f.EstValue, f.WonValue,
                 f.LastActivityAt, f.NextFollowupDate, f.IsOverdue, f.IsStale, f.CanOpen;

        IF @MaxRows > 0
            SELECT TOP (@MaxRows)
                   d.LeadId, l.Name AS LeadName, d.CreatedAt,
                   CASE WHEN d.CanOpen = 1 THEN l.MobileNo END AS MobileNo, l.Company,
                   CAST(COALESCE(NULLIF(o.FullName, ''), o.Username) AS NVARCHAR(200)) AS OwnerName,
                   st.Value AS StatusName, d.StatusCode, d.EstValue, d.WonValue,
                   d.LastActivityAt, d.NextFollowupDate, d.IsOverdue, d.IsStale, d.CanOpen,
                   d.NNew, d.NCalls, d.NVisits, d.NOther, d.NDue, d.NOnTime, d.NLate, d.NSkipped, d.NMissed, d.NWon, d.NLost
            FROM #LD d
            JOIN dbo.tblLeads l        ON l.Id = d.LeadId
            LEFT JOIN dbo.tblUser o    ON o.Id = d.OwnerId
            LEFT JOIN dbo.tblLookup st ON st.Id = d.StatusId
            WHERE d.CanOpen = 1                     -- F2 / D8: no rows for leads out of view
            ORDER BY d.CreatedAt DESC, d.LeadId DESC;

        -- Total = every matching lead (= listed leads + HiddenCount); AmountTotal = the visible leads'
        -- estimated value; the N* counts = the summary cells; WonValue = Won of the period, visible leads only
        SELECT COUNT(*) AS Total,
               CAST(ISNULL(SUM(CASE WHEN CanOpen = 1 THEN EstValue END), 0) AS DECIMAL(18,2)) AS AmountTotal,
               ISNULL(SUM(NNew), 0) AS NNew, ISNULL(SUM(NCalls), 0) AS NCalls, ISNULL(SUM(NVisits), 0) AS NVisits,
               ISNULL(SUM(NOther), 0) AS NOther, ISNULL(SUM(NDue), 0) AS NDue, ISNULL(SUM(NOnTime), 0) AS NOnTime,
               ISNULL(SUM(NLate), 0) AS NLate, ISNULL(SUM(NSkipped), 0) AS NSkipped, ISNULL(SUM(NMissed), 0) AS NMissed,
               ISNULL(SUM(NWon), 0) AS NWon, CAST(ISNULL(SUM(CASE WHEN CanOpen = 1 THEN WonAmount END), 0) AS DECIMAL(18,2)) AS WonValue,
               ISNULL(SUM(NLost), 0) AS NLost
        FROM #LD;
    END;

    IF @MaxRows = 0 RETURN;

    -- RS3 path (team + @PersonId): ancestors from the top down, the caller left out, then the person
    SELECT CAST(ROW_NUMBER() OVER (ORDER BY t.Depth DESC) AS INT) AS Ord, t.AncestorId AS Id,
           CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200)) AS Name
    FROM #T t
    JOIN dbo.tblUser u ON u.Id = t.AncestorId
    WHERE @GroupBy = 'team' AND t.PersonId = @PersonId
      AND t.AncestorId <> ISNULL(@UserId, -1)
    ORDER BY t.Depth DESC;

    -- RS4 (last): what matched on leads out of view - events: rows ("N activities on leads no
    -- longer in your view"); leads shape: leads. Either way listed + HiddenCount = RS2 Total.
    SELECT CAST(CASE WHEN @Shape = 'leads' THEN (SELECT COUNT(DISTINCT LeadId) FROM #F WHERE CanOpen = 0)
                     ELSE (SELECT COUNT(*) FROM #F WHERE CanOpen = 0 AND Src <> 'K') END AS INT) AS HiddenCount;   -- 149: K rows are listed
END
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- §12 verify after apply  (-- comments only; run by hand, read-only unless a
-- block says BEGIN TRAN ... ROLLBACK). Replace <comp>, <admin>, <exec>,
-- <mgr>, <callerA>, <callerB>, <branch> with real ids of the database.
-- ---------------------------------------------------------------------------
-- BEFORE applying (snapshots the checks below compare against):
--   SELECT CONVERT(varchar(64), HASHBYTES('SHA2_256', OBJECT_DEFINITION(OBJECT_ID('dbo.fn_AssignableUsers'))), 2);
--     -- TestCRM / eCRM+ / SolarCRM / OSG on 2026-11-24: 79F769BD...
--   EXEC dbo.sp_RptSales @CompId = <comp>, @FromDate = '2026-11-01', @ToDate = '2026-11-30',
--        @GroupBy = 'team', @UserId = <mgr>;          -- keep the output
--
-- V1  tables, columns, constraint, seeds, grants
--   SELECT t.name, SUM(p.rows) AS rows FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
--   WHERE t.name IN ('tblCallList','tblCallListCaller','tblCallContact','tblCallAttempt','tblPhoneMark') GROUP BY t.name;   -- 5 rows
--   SELECT COL_LENGTH('dbo.tblLeads','CallListId') AS a, COL_LENGTH('dbo.tblCompanySetting','CallStartMin') AS b,
--          COL_LENGTH('dbo.tblCompanySetting','CallEndMin') AS c, COL_LENGTH('dbo.tblCompanySetting','CallbackCap') AS d;   -- none NULL
--   SELECT definition FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Module';     -- contains 'calling'
--   SELECT Id, ParentId, Description, Route, Module, SortOrder FROM dbo.tblMenu
--   WHERE Route IN (N'/sales/calling-lists', N'/sales/do-not-call', N'/reports/sales/calling');   -- 3 rows
--   SELECT g.Name, gm.* FROM dbo.tblGroupModule gm JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId WHERE gm.Module = 'calling';
--     -- one row per IsAdmin group, V/A/E/D = 1, Reach / AssignReach NULL
--   SELECT CompId, Id, Value, SortOrder FROM dbo.tblLookup WHERE Kind = 'lead_source' AND Code = 'calling';   -- one per company
--   SELECT * FROM dbo.fn_AccessScope(<comp>, <admin>, 'calling');   -- 1 row, all four rights
--   SELECT * FROM dbo.fn_AccessScope(<comp>, <exec>,  'calling');   -- 0 rows (Sales Executive)
--   SELECT CONVERT(varchar(64), HASHBYTES('SHA2_256', OBJECT_DEFINITION(OBJECT_ID('dbo.fn_AssignableUsers'))), 2);   -- = the snapshot (untouched)
--
-- V2  list / import / mark procedures
--   SELECT name FROM sys.procedures WHERE name IN ('sp_SaveCallList','sp_DeleteCallList','sp_FetchCallLists',
--     'sp_SaveCallListCallers','sp_ImportCallContacts','sp_FetchCallContacts','sp_FetchCallContactHistory',
--     'sp_SetPhoneMark','sp_ClearPhoneMark','sp_FetchPhoneMarks','sp_PhoneMarkApply');            -- 11 rows
--   Scenario (rolled back). Pick one number per class from the live DB first: <leadNo> an existing
--   tblLeads.MobileNo, <custNo> an active tblCustomer.Mobile.
--     BEGIN TRAN;
--     DECLARE @r TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(400));
--     INSERT INTO @r EXEC dbo.sp_SaveCallList @CompId = <comp>, @UserId = <admin>, @BranchId = <branch>, @Name = N'V2 test';
--     DECLARE @L INT = (SELECT Id FROM @r);
--     EXEC dbo.sp_ImportCallContacts @CompId = <comp>, @UserId = <admin>, @CallListId = @L, @DryRun = 1, @RowsJson = N'[
--       {"RowNo":1,"Mobile":"9000000001"},  {"RowNo":2,"Mobile":"<leadNo>"},  {"RowNo":3,"Mobile":"<custNo>"},
--       {"RowNo":4,"Mobile":"9000000002","Dnc":true}, {"RowNo":5,"Mobile":null}, {"RowNo":6,"Mobile":"9000000001"}]';
--       -- expected: Added 1, InPool 0, IsLead 1, IsCustomer 1, Dnc 1, BadNumber 1, Repeated 1
--     EXEC dbo.sp_FetchCallLists    @CompId = <comp>, @UserId = <exec>;                    -- 0 rows (no calling grant)
--     EXEC dbo.sp_FetchCallContacts @CompId = <comp>, @UserId = <exec>, @CallListId = @L;  -- 404 row
--     -- give <mgr> calling View on their role inside this transaction, then: the list is returned only when
--     -- <branch> is one of <mgr>'s leads offices (Office: Level 3; OfficeTree: any; Company: every list).
--     ROLLBACK;
--   V2-b grant holder with Team / Own leads reach (ruling 2026-11-24), rolled back: give <tl> (a Sales Team
--     Lead, leads Reach 'Team') calling View on their role, then
--       SELECT cl.Id, cl.BranchId FROM dbo.fn_VisibleCallLists(<comp>, <tl>) v JOIN dbo.tblCallList cl ON cl.Id = v.CallListId;
--     -> exactly the lists whose BranchId is <tl>'s tblUser.BranchId or a tblUserBranchAccess (CanRead = 1) office of theirs:
--       SELECT cl.Id FROM dbo.tblCallList cl WHERE cl.CompId = <comp> AND cl.BranchId IN (
--         SELECT BranchId FROM dbo.tblUser WHERE Id = <tl> UNION
--         SELECT BranchId FROM dbo.tblUserBranchAccess WHERE UserId = <tl> AND CompId = <comp> AND CanRead = 1)
--       EXCEPT SELECT CallListId FROM dbo.fn_VisibleCallLists(<comp>, <tl>);     -- 0 rows (and the reverse EXCEPT: 0 rows)
--     without the calling grant: fn_VisibleCallLists(<comp>, <tl>) -> 0 rows.
--
-- V3  distribution engine
--   V3-1 SELECT name FROM sys.objects WHERE name IN ('fn_CallEligible','sp_TopUpCallList','sp_AssignCallContacts',
--          'sp_RecallCallContacts','sp_SetCallContactState','sp_FetchMyCallList','sp_SaveCallResult',
--          'sp_UndoCallResult','sp_CallSweep');                                                   -- 9 rows
--   V3-2 (rolled back, inside calling hours) a list with AutoTopUp = 1, HoldSize 10, 12 contacts imported
--        (@DryRun = 0), sp_SaveCallListCallers [{"UserId":<callerA>}]:
--        sp_FetchMyCallList <callerA> -> RS2 has 10 rows; sp_SaveCallResult 'no_answer' on nine -> RS2 has 1,
--        no new rows; save the tenth -> Given = 2 and RS2 has those 2.
--   V3-3 a second sp_SaveCallResult on the same contact -> 409 "This contact is no longer on your list".
--   V3-4 a pool contact whose AltMobile carries a live dnc mark is never returned:
--        SELECT c.Id FROM dbo.tblCallContact c JOIN dbo.tblPhoneMark pm ON pm.CompId = c.CompId
--          AND pm.Mobile = c.AltMobile AND pm.Mark = 'dnc' AND pm.ClearedAt IS NULL
--        WHERE c.Id IN (SELECT Id FROM dbo.fn_CallEligible(c.CompId, c.CallListId));          -- 0 rows
--   V3-5 SELECT COUNT(*) FROM dbo.tblCallContact WHERE Status IN ('held','callback') AND HeldBy IS NULL;   -- 0
--   V3-6 a manager whose leads "Can assign to" is Team: sp_AssignCallContacts to someone in another
--        team -> 403 "You cannot give contacts to that person", nothing held; to one of their own -> 200.
--   V3-7 [holding] (rolled back) callers A and B, a list of 12, manual hand-outs:
--        give A 5 -> A's RS2 = exactly those 5, none of the 7 pool rows; give B 3 -> none of B's in A's RS2;
--        A saves 'no_answer' on one -> A's next RS2 has 4 without it, and RS4 shows it by Name only (no number);
--        A saves the other 4 -> RS2 empty (manual list: EmptyReason 'manual'); A books a callback ->
--        it is in RS3 on every later fetch until made; sp_SaveCallResult by A on one of B's contacts and on
--        a pool contact -> 404 "Contact not found"; on the contact A just finished -> 409.
--   V3-8 no double hand-out (two sessions, both rolled back at the end), a list of 12 eligible contacts:
--        session 1: BEGIN TRAN; EXEC dbo.sp_AssignCallContacts @CompId=<comp>, @UserId=<admin>, @CallListId=@L,
--                   @AssignJson=N'[{"UserId":<callerA>,"Count":10}]';      -- stays open (no COMMIT yet)
--        session 2: EXEC dbo.sp_AssignCallContacts ... @AssignJson=N'[{"UserId":<callerB>,"Count":10}]';
--                   -> returns at once (READPAST) with Given = 2, not 0 and not 10
--        session 1: COMMIT; then both sessions:
--          SELECT HeldBy, COUNT(*) FROM dbo.tblCallContact WHERE CallListId = @L AND Status = 'held' GROUP BY HeldBy;  -- 10 / 2
--          (callerA still holds all 10 session 1 gave: none of them was re-taken by session 2)
--        repeat with session 1 holding a committed hand-out and session 2 retrying: no row changes HeldBy
--        (Status = 'pool' is tested on the locked row). Clean up: recall both, or delete the test list.
--
-- V4  altered procedures, conversion, report
--   SELECT OBJECT_NAME(object_id) AS proc_name, name, TYPE_NAME(user_type_id) AS type, is_output
--   FROM sys.parameters
--   WHERE object_id IN (OBJECT_ID('dbo.sp_SaveLead'), OBJECT_ID('dbo.sp_SaveCompanySetting'),
--                       OBJECT_ID('dbo.sp_RptSales'), OBJECT_ID('dbo.sp_RptSalesRows'))
--   ORDER BY proc_name, parameter_id;
--     -- sp_SaveLead ends @CallContactId, @CallDialedAt; sp_SaveCompanySetting ends @CallStartMin, @CallEndMin,
--     -- @CallbackCap; both report procs end @CallListId
--   A hand-made lead still saves: EXEC dbo.sp_SaveLead @CompId = <comp>, @BranchId = <branch>, @UserId = <exec>,
--     @Name = N'V4 test', @MobileNo = '9000000009';   -- inside BEGIN TRAN ... ROLLBACK; 200
--   End to end (rolled back): import 3 -> assign to <callerA> -> 'no_answer' on one -> on another
--     EXEC dbo.sp_SaveLead @CompId = <comp>, @BranchId = NULL, @UserId = <callerA>, @Name = NULL, @CallContactId = <id>;
--     -> 200; the lead has CallListId, SourceId = the 'calling' row, OwnerId = <callerA>; the contact is 'lead';
--     EXEC dbo.sp_RptSales @CompId = <comp>, @FromDate = <today>, @ToDate = <today>, @GroupBy = 'calllist', @UserId = <admin>;
--     -> that list's line: Dials = 2, DialContacts = 2, New = 1
--   Reconciliation (expected: no rows) — for each line of
--     EXEC dbo.sp_RptSales ... @GroupBy = 'caller' | 'calllist'  (into a temp table with INSERT ... EXEC, @LinesOnly = 1)
--   compare Dials / DialContacts / DialReached / DialNoDial / CbBooked / CbKept / CbMissed / ListContacts / ListUsed
--   with RS2.Total of
--     EXEC dbo.sp_RptSalesRows ..., @GroupBy = <same>, @Metric = 'dial' | 'dial_first' | 'contact',
--          @Flag = NULL | 'reached' | 'nodial' | 'cbbooked' | 'cbkept' | 'cbmissed' | 'used',
--          @Shape = 'events', @GroupKey = <GroupKey>, @GroupKeyIsNull = <GroupKey IS NULL>, @MaxRows = 0;
--     and keep only the lines where they differ.
--   EXEC dbo.sp_RptSales ... @GroupBy = 'team', @UserId = <mgr>;   -- same numbers as the snapshot; new columns 0
-- ===========================================================================
