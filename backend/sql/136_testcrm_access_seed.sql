-- ===========================================================================
-- 136 - TestCRM only: access-model seed. 18 personas (am_...), one seeded
--       role (AM Central Desk) and tagged records (AM-...) that cover every
--       scenario row of the design.
--       (spec docs/superpowers/specs/2026-11-21-access-model/design.md
--        sections 5 and 7; plan 2026-11-22-access-model Task 8;
--        pre-flight S14, S18, B3)
--
-- Apply by hand, TestCRM only, AFTER Gate G1's comparison run (seed rows must
-- not disturb its counts) and after 130-134:
--   sqlcmd -I -b -d TestCRM ... -v RefUser="<your own TestCRM username>" -i 136_testcrm_access_seed.sql
--   -I = QUOTED_IDENTIFIER ON, -b = stop at the first error (every refusal
--   below also SETs NOEXEC ON).
--
-- RefUser is substituted as text into a '...' literal before T-SQL parses
-- it, so a quote in it cannot be escaped from inside the script: a username
-- containing ' must be passed with the quote doubled (O''Neil). An unknown
-- name makes the script refuse.
--
-- Passwords: none in this file. Every persona gets a copy of RefUser's
-- stored password HASH, so the owner already knows the one password and
-- nobody else does. RefUser's company is the personas' company.
--
-- Refuses (nothing changed) when: the database is not TestCRM; any of
-- 130-134 is missing; a user am_% / an exact-tag record (case-sensitive
-- AM-Cnn / AM-Lnn / AM-Cust-) / the AM Central Desk role
-- already exists (run 137 first); RefUser is unknown or inactive; a role or
-- office named below is missing.
--
-- Tags (the live suite resolves them by name through the API; no id is
-- hard-coded anywhere): usernames am_..., full names "AM ...", customers,
-- complaint subjects and lead names start "AM-<tag> ". Leak-suite proof of
-- database (pre-flight B3): signing in as am_amit and resolving AM- tags
-- works only where this script ran, and it runs only on TestCRM.
--
-- Not seeded, on purpose:
--   * "Away today" (pre-flight S14). A day mark goes stale overnight, so the
--     suite / tester sets it on the test day through the app, signed in as
--     am_amit:  POST /api/work/saveDayMark
--               { "UserId": <am_vinod's id>, "WorkDate": "<today YYYY-MM-DD>",
--                 "Part": "full", "Kind": "leave", "Remarks": "AM test" }
--     and removes it after with POST /api/work/deleteDayMark
--               { "UserId": <id>, "WorkDate": "<today>" }.
--     137 deletes any left behind.
--   * Quotations (need a quote profile and exact totals): the flows suite
--     creates them through the API; office 1's quote profile is created by
--     the API too (sp_EnsureQuoteProfile).
--   * Activity-timeline rows (tblTicketActivity / tblLeadActivity); the
--     history tables named in the brief are seeded.
-- tblLeadStatusHistory / tblTicketStatusHistory are normally written only by
-- their procedures; this seed writes the rows those procedures would have.
--
-- Personas (office 1 = HEAD OFFICE, 2 = SOUTH EXTENSION, 6 = North Delhi
-- Branch; PresenceExempt = 1; PresenceNoticeAt set so no notice pops up):
--   am_amit     Admin              1  -           owner
--   am_neha     Branch Manager     1  am_amit     office manager
--   am_nitin    Support Agent      1  am_amit     call desk
--   am_rohit    Support Team Lead  1  am_amit     team lead
--   am_vinod    Support Agent      1  am_rohit    field agent
--   am_vivek    Support Agent      1  am_rohit    field agent
--   am_prasant  Support Agent      1  am_amit     agent outside Rohit's team
--   am_kasak    Sales Executive    1  am_neha     tele-caller
--   am_roshan   Sales Executive    1  am_neha     tele-caller
--   am_stl      Sales Team Lead    1  am_neha     sales team lead
--   am_field    Sales Executive    1  am_stl      field executive
--   am_imran    AM Central Desk    1  am_amit     central desk
--   am_vikram   Support Head       1  am_amit     support head
--   am_pooja    Support Agent      6  am_vikram   other-office agent
--   am_ndmgr    Branch Manager     6  am_amit     other-office manager
--   am_hr       Task Collaborator  1  am_amit     cannot work leads/complaints
--   am_gone     Support Agent      1  am_rohit    INACTIVE, deactivated holder
--   am_readonly Support Agent      2  am_amit     + read-only grant on office 1
-- AM Central Desk: complaints V/A/E, Can see Own, Can assign to Company;
--                  customers V/A, Can see Office.
--
-- Records (office 1 and customer AM-Cust-HO unless stated; "logged" =
-- CreatedBy; assigned at creation writes the "Assigned on creation" history
-- row by the logger, as sp_SaveTicket / sp_SaveLead do):
--   AM-Cust-HO (office 1), AM-Cust-ND (office 6),
--   AM-Cust-SE (office 2)                                       customers
--   AM-C01 nitin -> vinod at creation, open                     1 2 3 8 10
--   AM-C02 nitin, unassigned, LoggerHolds 1                     7
--   AM-C03 nitin -> vinod, then unassigned by amit, LH 0        16 F13
--   AM-C04 nitin -> vinod, escalated to rohit, open             11 12
--   AM-C05 nitin -> vinod, resolved by vinod                    14 18
--   AM-C06 nitin -> vivek, resolved, EscalatedTo prasant        F23
--   AM-C07 nitin -> am_gone, resolved by am_gone                D27 N4
--   AM-C08..AM-C12 nitin -> vinod, open                         4 (bulk)
--   AM-C13 nitin -> vinod, open, LinkedLeadId = AM-L03          F24
--   AM-C14 amit -> am_hr, open                                  F5 F6 17
--   AM-C15 amit -> vinod (history by amit), open                13
--   AM-C16 ndmgr -> pooja, office 6, AM-Cust-ND, open           Rule 3, wall
--   AM-C17 nitin -> vinod, open, EscalatedTo prasant (rule b    W3 (S14)
--          only: prasant reports to amit, Own reach)
--   AM-C18 nitin -> rohit, resolved by rohit                     team lead
--          cannot reopen his own (Task 29)
--   AM-C19 amit -> am_readonly, office 2, AM-Cust-SE, open      read-only
--   AM-C20 amit -> am_readonly, office 1 (his read-only extra), grant case
--          AM-Cust-HO, open
--   AM-L01 kasak, owner kasak, open; follow-ups: open -> kasak, 6 19 10
--          open visit -> am_field (scheduled by neha), done by kasak;
--          one call by kasak
--   AM-L02 kasak, owner kasak, lost                             18
--   AM-L03 roshan, owner roshan, open                           10 (target)
--   AM-L04 kasak, unassigned, LoggerHolds 1                     7 (lead)
--   AM-L05 kasak -> roshan, then unassigned by neha, LH 0       F13
--   AM-L06 am_field, owner am_field, open                       team lead
--   AM-L07 am_field, unassigned, LoggerHolds 1                  D5.2
--   AM-L08 kasak, owner kasak, converted                        18
--   AM-L09 kasak -> kasak, reassigned by kasak to roshan;       F1 F2 9
--          kasak's done call + done follow-up on it
--
-- VERIFY AFTER APPLY (the script ends by printing these; expected):
--   1. Counts: Personas 18 (Active 17), Role 1, Customers 3, Complaints 20,
--      Leads 9, FollowUps 4, Calls 2, BranchGrants 1.
--   2. Persona list: 18 rows, Username -> Id, Role, ReportsTo, Office, IsActive.
--   3. Tag list: 32 rows, Tag -> Kind, Id (complaints also TicketNo).
--   4. Every check row prints PASS:
--      SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END FROM dbo.tblTicket
--       WHERE Subject COLLATE Latin1_General_CS_AS LIKE 'AM-C[0-9][0-9] %' AND LoggerHolds = 1 AND AssignedTo IS NOT NULL;
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
IF DB_NAME() <> 'TestCRM'
BEGIN
    RAISERROR('136: TestCRM only. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- ---------------------------------------------------------------------------
-- Refusals.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblTicket', 'LoggerHolds') IS NULL              -- 130
   OR COL_LENGTH('dbo.tblLeads', 'LoggerHolds') IS NULL            -- 130
   OR COL_LENGTH('dbo.tblGroupModule', 'AssignReach') IS NULL      -- 130
   OR OBJECT_ID('dbo.fn_VisibleTickets') IS NULL                   -- 131
   OR OBJECT_ID('dbo.fn_VisibleLeads') IS NULL                     -- 131
   OR OBJECT_ID('dbo.sp_FetchLoggedByMe') IS NULL                  -- 132
   OR OBJECT_ID('dbo.sp_FetchTicketEscalationTargets') IS NULL     -- 133
   OR OBJECT_ID('dbo.CK_tblTicket_LoggerHolds', 'C') IS NULL       -- 133
   OR OBJECT_ID('dbo.sp_LeadsUserWise') IS NOT NULL                -- 134 drops it
   OR OBJECT_ID('dbo.sp_ConvertedSummary') IS NOT NULL             -- 134 drops it
BEGIN
    RAISERROR('136: scripts 130-134 are not all applied to this database. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

IF EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username LIKE 'am[_]%')
   OR EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Name = 'AM Central Desk')
   OR EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-Cust-%')
   OR EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Subject COLLATE Latin1_General_CS_AS LIKE 'AM-C[0-9][0-9] %')
   OR EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %')
BEGIN
    RAISERROR('136: the seed (am_ users / AM- records / AM Central Desk) already exists. Apply 137 first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

DECLARE @RefUser VARCHAR(100) = '$(RefUser)';
DECLARE @CompId BIGINT = (SELECT CompId FROM dbo.tblUser
                          WHERE Username = @RefUser AND IsActive = 1 AND Username NOT LIKE 'am[_]%');
DECLARE @missing NVARCHAR(400) = NULL;
IF @CompId IS NULL
    SET @missing = N'RefUser "' + @RefUser + N'" (unknown, inactive or without a company)';
ELSE
    SELECT @missing = STRING_AGG(r.Name, ', ')
    FROM (VALUES ('Admin'), ('Branch Manager'), ('Support Agent'), ('Support Team Lead'),
                 ('Sales Executive'), ('Sales Team Lead'), ('Support Head'), ('Task Collaborator')) r (Name)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups g
                      WHERE g.CompId = @CompId AND g.Name = r.Name AND g.IsActive = 1);
IF @missing IS NULL
    SELECT @missing = STRING_AGG('office ' + CAST(b.Id AS VARCHAR(10)), ', ')
    FROM (VALUES (1), (2), (6)) b (Id)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblBranch x WHERE x.Id = b.Id AND x.IsActive = 1);
IF @missing IS NULL
    SELECT @missing = STRING_AGG(k.Kind + '/' + k.Code, ', ')
    FROM (VALUES ('ticket_status', 'open'), ('ticket_status', 'resolved'),
                 ('lead_status', 'open'), ('lead_status', 'lost'), ('lead_status', 'converted')) k (Kind, Code)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup x
                      WHERE x.CompId = @CompId AND x.Kind = k.Kind AND x.Code = k.Code AND x.IsActive = 1);
IF @missing IS NOT NULL
BEGIN
    RAISERROR('136: missing %s. Nothing was changed.', 16, 1, @missing);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- The seed, one transaction.
-- ---------------------------------------------------------------------------
BEGIN TRAN;

DECLARE @RefUser VARCHAR(100) = '$(RefUser)';
DECLARE @CompId BIGINT, @Hash VARCHAR(500);
SELECT @CompId = CompId, @Hash = Password FROM dbo.tblUser WHERE Username = @RefUser AND IsActive = 1;

DECLARE @Now DATETIME = GETDATE();

-- ---- the seeded role ------------------------------------------------------
INSERT INTO dbo.tblUserGroups (Name, Description, IsActive, CompId, BranchId, HierarchyLevel, DataScope, IsAdmin, CanSeeSensitive)
VALUES ('AM Central Desk', 'AM test role: logs complaints, assigns company-wide', 1, @CompId, 1, 4, 'Self', 0, 0);
DECLARE @DeskGroup INT = CAST(SCOPE_IDENTITY() AS INT);

INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach)
VALUES (@DeskGroup, 'complaints', 1, 1, 1, 0, 'Own',    'Company'),
       (@DeskGroup, 'customers',  1, 1, 0, 0, 'Office', NULL);

-- ---- personas -------------------------------------------------------------
DECLARE @P TABLE (Username VARCHAR(50) PRIMARY KEY, FullName VARCHAR(100), RoleName VARCHAR(100),
                  BranchId BIGINT, Boss VARCHAR(50), JobTitle VARCHAR(100), IsActive BIT, Id INT NULL);
INSERT INTO @P (Username, FullName, RoleName, BranchId, Boss, JobTitle, IsActive) VALUES
  ('am_amit',     'AM Amit',          'Admin',             1, NULL,        'Owner',                      1),
  ('am_neha',     'AM Neha',          'Branch Manager',    1, 'am_amit',   'Office manager',             1),
  ('am_nitin',    'AM Nitin',         'Support Agent',     1, 'am_amit',   'Call desk',                  1),
  ('am_rohit',    'AM Rohit',         'Support Team Lead', 1, 'am_amit',   'Team lead',                  1),
  ('am_vinod',    'AM Vinod',         'Support Agent',     1, 'am_rohit',  'Field agent',                1),
  ('am_vivek',    'AM Vivek',         'Support Agent',     1, 'am_rohit',  'Field agent',                1),
  ('am_prasant',  'AM Prasant',       'Support Agent',     1, 'am_amit',   'Agent outside Rohit''s team', 1),
  ('am_kasak',    'AM Kasak',         'Sales Executive',   1, 'am_neha',   'Tele-caller',                1),
  ('am_roshan',   'AM Roshan',        'Sales Executive',   1, 'am_neha',   'Tele-caller',                1),
  ('am_stl',      'AM Sales Lead',    'Sales Team Lead',   1, 'am_neha',   'Sales team lead',            1),
  ('am_field',    'AM Field',         'Sales Executive',   1, 'am_stl',    'Field executive',            1),
  ('am_imran',    'AM Imran',         'AM Central Desk',   1, 'am_amit',   'Central desk',               1),
  ('am_vikram',   'AM Vikram',        'Support Head',      1, 'am_amit',   'Support head',               1),
  ('am_pooja',    'AM Pooja',         'Support Agent',     6, 'am_vikram', 'Other-office agent',         1),
  ('am_ndmgr',    'AM ND Manager',    'Branch Manager',    6, 'am_amit',   'Other-office manager',       1),
  ('am_hr',       'AM HR',            'Task Collaborator', 1, 'am_amit',   'Cannot work leads or complaints', 1),
  ('am_gone',     'AM Gone',          'Support Agent',     1, 'am_rohit',  'Deactivated holder',         0),
  ('am_readonly', 'AM Readonly',      'Support Agent',     2, 'am_amit',   'Read-only office case',      1);

INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, FullName, JobTitle, CompId, BranchId,
                         PresenceExempt, PresenceNoticeAt)
SELECT p.Username, @Hash, p.IsActive, CASE WHEN p.RoleName = 'Admin' THEN 1 ELSE 0 END,
       p.FullName, p.JobTitle, @CompId, p.BranchId, 1, @Now
FROM @P p;

UPDATE p SET Id = u.Id FROM @P p JOIN dbo.tblUser u ON u.Username = p.Username;
UPDATE u SET ReportsTo = b.Id
FROM dbo.tblUser u JOIN @P p ON p.Id = u.Id JOIN @P b ON b.Username = p.Boss;

INSERT INTO dbo.tblUserGroupMap (UserId, GroupId)
SELECT p.Id, (SELECT MIN(g.Id) FROM dbo.tblUserGroups g
              WHERE g.CompId = @CompId AND g.Name = p.RoleName AND g.IsActive = 1)
FROM @P p;

DECLARE @amit INT, @neha INT, @nitin INT, @rohit INT, @vinod INT, @vivek INT, @prasant INT,
        @kasak INT, @roshan INT, @field INT, @pooja INT, @ndmgr INT, @hr INT, @gone INT, @readonly INT;
SELECT @amit = MAX(CASE Username WHEN 'am_amit' THEN Id END),
       @neha = MAX(CASE Username WHEN 'am_neha' THEN Id END),
       @nitin = MAX(CASE Username WHEN 'am_nitin' THEN Id END),
       @rohit = MAX(CASE Username WHEN 'am_rohit' THEN Id END),
       @vinod = MAX(CASE Username WHEN 'am_vinod' THEN Id END),
       @vivek = MAX(CASE Username WHEN 'am_vivek' THEN Id END),
       @prasant = MAX(CASE Username WHEN 'am_prasant' THEN Id END),
       @kasak = MAX(CASE Username WHEN 'am_kasak' THEN Id END),
       @roshan = MAX(CASE Username WHEN 'am_roshan' THEN Id END),
       @field = MAX(CASE Username WHEN 'am_field' THEN Id END),
       @pooja = MAX(CASE Username WHEN 'am_pooja' THEN Id END),
       @ndmgr = MAX(CASE Username WHEN 'am_ndmgr' THEN Id END),
       @hr = MAX(CASE Username WHEN 'am_hr' THEN Id END),
       @gone = MAX(CASE Username WHEN 'am_gone' THEN Id END),
       @readonly = MAX(CASE Username WHEN 'am_readonly' THEN Id END)
FROM @P;

-- am_readonly: home office 2, plus a read-only extra grant on office 1.
INSERT INTO dbo.tblUserBranchAccess (UserId, BranchId, CanRead, CanWrite, CompId, CreatedBy)
VALUES (@readonly, 1, 1, 0, @CompId, @amit);

-- ---- lookups ----------------------------------------------------------------
DECLARE @TOpen INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'ticket_status' AND Code = 'open' AND IsActive = 1 ORDER BY SortOrder, Id);
DECLARE @TResolved INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'ticket_status' AND Code = 'resolved' AND IsActive = 1 ORDER BY SortOrder, Id);
DECLARE @LOpen INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lead_status' AND Code = 'open' AND IsActive = 1 ORDER BY SortOrder, Id);
DECLARE @LLost INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lead_status' AND Code = 'lost' AND IsActive = 1 ORDER BY SortOrder, Id);
DECLARE @LWon INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lead_status' AND Code = 'converted' AND IsActive = 1 ORDER BY SortOrder, Id);
DECLARE @Prio INT, @PrioHours INT;
SELECT TOP 1 @Prio = Id, @PrioHours = TatHours FROM dbo.tblLookup
 WHERE CompId = @CompId AND Kind = 'priority' AND IsActive = 1
 ORDER BY CASE WHEN Value = 'medium' THEN 0 ELSE 1 END, SortOrder, Id;
DECLARE @Resolution INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'resolution' AND IsActive = 1 ORDER BY SortOrder, Id);
DECLARE @LostReason INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lost_reason' AND IsActive = 1 ORDER BY SortOrder, Id);
DECLARE @Overloaded INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'transfer_reason' AND Value = N'Overloaded' AND IsActive = 1);
DECLARE @Connected INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'call_outcome' AND Code = 'connected' AND IsActive = 1);

-- ---- customers --------------------------------------------------------------
INSERT INTO dbo.tblCustomer (CompId, BranchId, Name, ContactPerson, Mobile, City, IsActive, CreatedBy, CreatedAt)
VALUES (@CompId, 1, N'AM-Cust-HO', N'AM Sharma', '9990003001', N'New Delhi', 1, @amit,  @Now),
       (@CompId, 6, N'AM-Cust-ND', N'AM Gupta',  '9990003002', N'New Delhi', 1, @ndmgr, @Now),
       (@CompId, 2, N'AM-Cust-SE', N'AM Mehta',  '9990003003', N'New Delhi', 1, @amit,  @Now);
DECLARE @CustHO INT = (SELECT Id FROM dbo.tblCustomer WHERE CompId = @CompId AND Name = N'AM-Cust-HO');
DECLARE @CustND INT = (SELECT Id FROM dbo.tblCustomer WHERE CompId = @CompId AND Name = N'AM-Cust-ND');
DECLARE @CustSE INT = (SELECT Id FROM dbo.tblCustomer WHERE CompId = @CompId AND Name = N'AM-Cust-SE');

-- ---- leads (before complaints: AM-C13 links AM-L03) -----------------------
-- FirstTo = assigned at creation ("Assigned on creation" row by the logger).
DECLARE @LD TABLE (Tag VARCHAR(10) PRIMARY KEY, Subject NVARCHAR(200), CreatedBy INT, FirstTo INT, OwnerId INT,
                   StatusId INT, LoggerHolds BIT, Mobile VARCHAR(10), Id INT NULL);
INSERT INTO @LD (Tag, Subject, CreatedBy, FirstTo, OwnerId, StatusId, LoggerHolds, Mobile) VALUES
  ('AM-L01', N'AM-L01 Rooftop solar enquiry',   @kasak,  @kasak,  @kasak,  @LOpen, 0, '9990002001'),
  ('AM-L02', N'AM-L02 Inverter quote, lost',    @kasak,  @kasak,  @kasak,  @LLost, 0, '9990002002'),
  ('AM-L03', N'AM-L03 Roshan''s battery lead',  @roshan, @roshan, @roshan, @LOpen, 0, '9990002003'),
  ('AM-L04', N'AM-L04 Unassigned walk-in',      @kasak,  NULL,    NULL,    @LOpen, 1, '9990002004'),
  ('AM-L05', N'AM-L05 Assigned then unassigned', @kasak, @roshan, NULL,    @LOpen, 0, '9990002005'),
  ('AM-L06', N'AM-L06 Field visit lead',        @field,  @field,  @field,  @LOpen, 0, '9990002006'),
  ('AM-L07', N'AM-L07 Field unassigned',        @field,  NULL,    NULL,    @LOpen, 1, '9990002007'),
  ('AM-L08', N'AM-L08 Solar AMC, won',          @kasak,  @kasak,  @kasak,  @LWon,  0, '9990002008'),
  ('AM-L09', N'AM-L09 Handed to Roshan',        @kasak,  @kasak,  @roshan, @LOpen, 0, '9990002009');

DECLARE @LCreated DATETIME = DATEADD(DAY, -3, @Now), @LChanged DATETIME = DATEADD(DAY, -2, @Now);

INSERT INTO dbo.tblLeads (CompId, BranchId, Name, MobileNo, OwnerId, StatusId, EstValue,
                          LostAt, LostReasonId, WonAt, WonValue, AssignedAt,
                          CreatedBy, EditBy, CreatedAt, LoggerHolds)
SELECT @CompId, 1, d.Subject, d.Mobile, d.OwnerId, d.StatusId, 50000,
       CASE WHEN d.StatusId = @LLost THEN @LChanged END,
       CASE WHEN d.StatusId = @LLost THEN @LostReason END,
       CASE WHEN d.StatusId = @LWon THEN @LChanged END,
       CASE WHEN d.StatusId = @LWon THEN 50000 END,
       CASE WHEN d.OwnerId IS NOT NULL THEN @LCreated END,
       d.CreatedBy, d.CreatedBy, @LCreated, d.LoggerHolds
FROM @LD d;
UPDATE d SET Id = l.Id FROM @LD d JOIN dbo.tblLeads l ON l.CompId = @CompId AND l.Name = d.Subject;

-- Status history: opening row; then open -> lost / converted.
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, d.Id, NULL, @LOpen, d.CreatedBy, @LCreated FROM @LD d
UNION ALL
SELECT @CompId, d.Id, @LOpen, d.StatusId, @kasak, @LChanged FROM @LD d WHERE d.StatusId IN (@LLost, @LWon);

-- Assignment history.
INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
SELECT @CompId, d.Id, NULL, d.FirstTo, NULL, 1, NULL, N'Assigned on creation', d.CreatedBy, @LCreated
FROM @LD d WHERE d.FirstTo IS NOT NULL
UNION ALL   -- AM-L05: roshan -> nobody, by neha
SELECT @CompId, d.Id, @roshan, NULL, 1, 1, NULL, N'AM seed: unassigned by manager', @neha, @LChanged
FROM @LD d WHERE d.Tag = 'AM-L05'
UNION ALL   -- AM-L09: kasak -> roshan, by kasak
SELECT @CompId, d.Id, @kasak, @roshan, 1, 1, @Overloaded, N'AM seed: handed to Roshan', @kasak, @LChanged
FROM @LD d WHERE d.Tag = 'AM-L09';

DECLARE @L01 INT = (SELECT Id FROM @LD WHERE Tag = 'AM-L01');
DECLARE @L03 INT = (SELECT Id FROM @LD WHERE Tag = 'AM-L03');
DECLARE @L09 INT = (SELECT Id FROM @LD WHERE Tag = 'AM-L09');
DECLARE @Tomorrow DATETIME = DATEADD(DAY, 1, CAST(CAST(@Now AS DATE) AS DATETIME));
DECLARE @Yesterday DATETIME = DATEADD(DAY, -1, @Now);

-- Follow-ups. AM-L01: kasak's open call, neha's visit for am_field, kasak's
-- done call. AM-L09: kasak's done follow-up (from before the hand-over).
INSERT INTO dbo.tblFollowUp (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, DoneAt, DoneBy, Remarks, CreatedBy, CreatedAt)
VALUES (@CompId, 1, @L01, 'call',  DATEADD(HOUR, 11, @Tomorrow), @kasak, 'open', NULL, NULL, NULL, @kasak, @LCreated),
       (@CompId, 1, @L01, 'visit', DATEADD(HOUR, 15, @Tomorrow), @field, 'open', NULL, NULL, NULL, @neha,  @LCreated),
       (@CompId, 1, @L01, 'call',  @Yesterday, @kasak, 'done', @Yesterday, @kasak, N'AM seed: customer wants a site visit', @kasak, @LCreated),
       (@CompId, 1, @L09, 'call',  @LChanged,  @kasak, 'done', @LChanged,  @kasak, N'AM seed: spoke before hand-over',      @kasak, @LCreated);
UPDATE dbo.tblLeads SET NextFollowupDate = DATEADD(HOUR, 11, @Tomorrow) WHERE Id = @L01;

-- Calls: one by kasak on AM-L01, kasak's done call on AM-L09.
INSERT INTO dbo.tblCall (CompId, LeadId, UserId, Direction, OutcomeId, Notes, Duration, CalledAt, CreatedBy, CreatedAt)
VALUES (@CompId, @L01, @kasak, 'out', @Connected, N'AM seed call', 120, @Yesterday, @kasak, @Yesterday),
       (@CompId, @L09, @kasak, 'out', @Connected, N'AM seed call', 90,  @LChanged,  @kasak, @LChanged);

-- ---- complaints -----------------------------------------------------------
-- FirstTo = assigned at creation by the logger; AssignedTo = holder now.
DECLARE @C TABLE (Tag VARCHAR(10) PRIMARY KEY, Subject NVARCHAR(200), CreatedBy INT, FirstTo INT, AssignedTo INT,
                  BranchId INT, CustomerId INT, Resolved BIT, LoggerHolds BIT, EscalatedTo INT,
                  LinkedLeadId INT, Contact VARCHAR(10), CreatedAt DATETIME NULL, Id INT NULL);
INSERT INTO @C (Tag, Subject, CreatedBy, FirstTo, AssignedTo, BranchId, CustomerId, Resolved, LoggerHolds, EscalatedTo, LinkedLeadId, Contact) VALUES
  ('AM-C01', N'AM-C01 Inverter tripping',        @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, NULL,     NULL, '9990001001'),
  ('AM-C02', N'AM-C02 Unassigned, with logger',  @nitin, NULL,   NULL,   1, @CustHO, 0, 1, NULL,     NULL, '9990001002'),
  ('AM-C03', N'AM-C03 Unassigned by manager',    @nitin, @vinod, NULL,   1, @CustHO, 0, 0, NULL,     NULL, '9990001003'),
  ('AM-C04', N'AM-C04 Escalated to Rohit',       @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, @rohit,   NULL, '9990001004'),
  ('AM-C05', N'AM-C05 Resolved by Vinod',        @nitin, @vinod, @vinod, 1, @CustHO, 1, 0, NULL,     NULL, '9990001005'),
  ('AM-C06', N'AM-C06 Resolved, was escalated',  @nitin, @vivek, @vivek, 1, @CustHO, 1, 0, @prasant, NULL, '9990001006'),
  ('AM-C07', N'AM-C07 Resolved by am_gone',      @nitin, @gone,  @gone,  1, @CustHO, 1, 0, NULL,     NULL, '9990001007'),
  ('AM-C08', N'AM-C08 Bulk one',                 @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, NULL,     NULL, '9990001008'),
  ('AM-C09', N'AM-C09 Bulk two',                 @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, NULL,     NULL, '9990001009'),
  ('AM-C10', N'AM-C10 Bulk three',               @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, NULL,     NULL, '9990001010'),
  ('AM-C11', N'AM-C11 Bulk four',                @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, NULL,     NULL, '9990001011'),
  ('AM-C12', N'AM-C12 Bulk five',                @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, NULL,     NULL, '9990001012'),
  ('AM-C13', N'AM-C13 Linked to AM-L03',         @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, NULL,     @L03, '9990001013'),
  ('AM-C14', N'AM-C14 Held by am_hr',            @amit,  @hr,    @hr,    1, @CustHO, 0, 0, NULL,     NULL, '9990001014'),
  ('AM-C15', N'AM-C15 Assigned by Amit',         @amit,  @vinod, @vinod, 1, @CustHO, 0, 0, NULL,     NULL, '9990001015'),
  ('AM-C16', N'AM-C16 North Delhi, Pooja',       @ndmgr, @pooja, @pooja, 6, @CustND, 0, 0, NULL,     NULL, '9990001016'),
  ('AM-C17', N'AM-C17 Escalated to Prasant',     @nitin, @vinod, @vinod, 1, @CustHO, 0, 0, @prasant, NULL, '9990001017'),
  ('AM-C18', N'AM-C18 Resolved by Rohit',        @nitin, @rohit, @rohit, 1, @CustHO, 1, 0, NULL,     NULL, '9990001018'),
  ('AM-C19', N'AM-C19 Readonly, home office 2',  @amit,  @readonly, @readonly, 2, @CustSE, 0, 0, NULL, NULL, '9990001019'),
  ('AM-C20', N'AM-C20 Readonly, held in office 1', @amit, @readonly, @readonly, 1, @CustHO, 0, 0, NULL, NULL, '9990001020');

-- Resolved ones were logged two days ago; open ones minutes ago, in tag order.
UPDATE c SET CreatedAt = CASE WHEN c.Resolved = 1 THEN DATEADD(DAY, -2, @Now)
                              ELSE DATEADD(MINUTE, -100 + CAST(RIGHT(c.Tag, 2) AS INT), @Now) END
FROM @C c;

DECLARE @Seq INT = (SELECT ISNULL(MAX(TRY_CONVERT(INT, SUBSTRING(TicketNo, 5, 10))), 0)
                    FROM dbo.tblTicket WHERE CompId = @CompId AND TicketNo LIKE 'TKT-%');

INSERT INTO dbo.tblTicket (CompId, BranchId, TicketNo, CustomerId, Subject, ContactPerson, Contact,
                           Priority, StatusId, AssignedTo, AssignedAt, LinkedLeadId, DueAt,
                           ResolvedAt, ResolutionId, EscalatedTo, EscalatedAt,
                           Description, CreatedBy, EditBy, CreatedAt, TatAnchorAt, LoggerHolds)
SELECT @CompId, c.BranchId,
       'TKT-' + RIGHT('000000' + CAST(@Seq + ROW_NUMBER() OVER (ORDER BY c.Tag) AS VARCHAR(10)), 6),
       c.CustomerId, c.Subject, NULL, c.Contact,
       @Prio, CASE WHEN c.Resolved = 1 THEN @TResolved ELSE @TOpen END,
       c.AssignedTo, CASE WHEN c.AssignedTo IS NOT NULL THEN c.CreatedAt END,
       c.LinkedLeadId, DATEADD(HOUR, ISNULL(@PrioHours, 72), c.CreatedAt),
       CASE WHEN c.Resolved = 1 THEN DATEADD(DAY, 1, c.CreatedAt) END,
       CASE WHEN c.Resolved = 1 THEN @Resolution END,
       c.EscalatedTo, CASE WHEN c.EscalatedTo IS NOT NULL THEN DATEADD(HOUR, 1, c.CreatedAt) END,
       N'AM seed complaint', c.CreatedBy,
       CASE WHEN c.Resolved = 1 THEN c.AssignedTo ELSE c.CreatedBy END,
       c.CreatedAt, c.CreatedAt, c.LoggerHolds
FROM @C c;
UPDATE c SET Id = t.Id FROM @C c JOIN dbo.tblTicket t ON t.CompId = @CompId AND t.Subject = c.Subject;

-- Status history: opening row; resolved ones add open -> resolved by the holder.
INSERT INTO dbo.tblTicketStatusHistory (CompId, TicketId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, c.Id, NULL, @TOpen, c.CreatedBy, c.CreatedAt FROM @C c
UNION ALL
SELECT @CompId, c.Id, @TOpen, @TResolved, c.AssignedTo, DATEADD(DAY, 1, c.CreatedAt) FROM @C c WHERE c.Resolved = 1;

-- Assignment history: "Assigned on creation" by the logger; AM-C03 then
-- unassigned by amit.
INSERT INTO dbo.tblTicketAssignment (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
SELECT @CompId, c.Id, NULL, c.FirstTo, NULL, c.BranchId, NULL, N'Assigned on creation', c.CreatedBy, c.CreatedAt
FROM @C c WHERE c.FirstTo IS NOT NULL
UNION ALL
SELECT @CompId, c.Id, @vinod, NULL, 1, 1, NULL, N'AM seed: unassigned by manager', @amit, DATEADD(MINUTE, 5, c.CreatedAt)
FROM @C c WHERE c.Tag = 'AM-C03';

COMMIT;
GO

-- ---------------------------------------------------------------------------
-- Verify (printed every run; expected values in the header).
-- ---------------------------------------------------------------------------
SELECT (SELECT COUNT(*) FROM dbo.tblUser WHERE Username LIKE 'am[_]%')                  AS Personas,
       (SELECT COUNT(*) FROM dbo.tblUser WHERE Username LIKE 'am[_]%' AND IsActive = 1) AS Active,
       (SELECT COUNT(*) FROM dbo.tblUserGroups WHERE Name = 'AM Central Desk')          AS Role,
       (SELECT COUNT(*) FROM dbo.tblCustomer WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-Cust-%')                    AS Customers,
       (SELECT COUNT(*) FROM dbo.tblTicket WHERE Subject COLLATE Latin1_General_CS_AS LIKE 'AM-C[0-9][0-9] %')                   AS Complaints,
       (SELECT COUNT(*) FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %')                       AS Leads,
       (SELECT COUNT(*) FROM dbo.tblFollowUp f JOIN dbo.tblLeads l ON l.Id = f.LeadId WHERE l.Name COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %') AS FollowUps,
       (SELECT COUNT(*) FROM dbo.tblCall c JOIN dbo.tblLeads l ON l.Id = c.LeadId WHERE l.Name COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %')     AS Calls,
       (SELECT COUNT(*) FROM dbo.tblUserBranchAccess a JOIN dbo.tblUser u ON u.Id = a.UserId WHERE u.Username LIKE 'am[_]%') AS BranchGrants;

SELECT u.Username, u.Id, g.Name AS RoleName, b.Username AS ReportsTo, u.BranchId AS Office, u.IsActive
FROM dbo.tblUser u
LEFT JOIN dbo.tblUserGroupMap m ON m.UserId = u.Id
LEFT JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
LEFT JOIN dbo.tblUser b ON b.Id = u.ReportsTo
WHERE u.Username LIKE 'am[_]%'
ORDER BY u.Id;

SELECT LEFT(Name, CHARINDEX(' ', Name + ' ') - 1) AS Tag, 'customer' AS Kind, Id, CAST(NULL AS VARCHAR(50)) AS TicketNo
FROM dbo.tblCustomer WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-Cust-%'
UNION ALL
SELECT LEFT(Subject, 6), 'complaint', Id, TicketNo FROM dbo.tblTicket WHERE Subject COLLATE Latin1_General_CS_AS LIKE 'AM-C[0-9][0-9] %'
UNION ALL
SELECT LEFT(Name, 6), 'lead', Id, NULL FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %'
ORDER BY 2, 1;

SELECT 'LoggerHolds only when unassigned' AS [Check],
       CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Subject COLLATE Latin1_General_CS_AS LIKE 'AM-C[0-9][0-9] %' AND LoggerHolds = 1 AND AssignedTo IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %' AND LoggerHolds = 1 AND OwnerId IS NOT NULL)
            THEN 'PASS' ELSE 'FAIL' END AS Result
UNION ALL
SELECT 'every persona has exactly one role',
       CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.tblUser u WHERE u.Username LIKE 'am[_]%'
                             AND (SELECT COUNT(*) FROM dbo.tblUserGroupMap m WHERE m.UserId = u.Id) <> 1)
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'AM-C17 escalated to am_prasant, held by am_vinod, open',
       CASE WHEN EXISTS (SELECT 1 FROM dbo.tblTicket t
                         JOIN dbo.tblUser e ON e.Id = t.EscalatedTo AND e.Username = 'am_prasant'
                         JOIN dbo.tblUser a ON a.Id = t.AssignedTo AND a.Username = 'am_vinod'
                         JOIN dbo.tblLookup s ON s.Id = t.StatusId AND s.Code = 'open'
                         WHERE t.Subject LIKE 'AM-C17 %')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'AM-C18 resolved, held by am_rohit',
       CASE WHEN EXISTS (SELECT 1 FROM dbo.tblTicket t
                         JOIN dbo.tblUser a ON a.Id = t.AssignedTo AND a.Username = 'am_rohit'
                         JOIN dbo.tblLookup s ON s.Id = t.StatusId AND s.Code = 'resolved'
                         WHERE t.Subject LIKE 'AM-C18 %')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'counts: 18 personas, 3 customers, 20 complaints, 9 leads',
       CASE WHEN (SELECT COUNT(*) FROM dbo.tblUser WHERE Username LIKE 'am[_]%') = 18
             AND (SELECT COUNT(*) FROM dbo.tblCustomer WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-Cust-%') = 3
             AND (SELECT COUNT(*) FROM dbo.tblTicket WHERE Subject COLLATE Latin1_General_CS_AS LIKE 'AM-C[0-9][0-9] %') = 20
             AND (SELECT COUNT(*) FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %') = 9
            THEN 'PASS' ELSE 'FAIL' END;
GO
