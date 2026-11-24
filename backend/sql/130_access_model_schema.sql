-- ===========================================================================
-- 130 - access model: schema, migration, Support Team Lead, Sent-back label,
--       N3 escalation wipe, old-answer snapshot, backup table.
--       (spec docs/superpowers/specs/2026-11-21-access-model/design.md
--        sections 5, 11, 13.1; plan 2026-11-22-access-model Task 2)
--
-- Apply by hand:  sqlcmd -I -b ... -i 130_access_model_schema.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error, so
--   a refusal below really stops the run (it also SETs NOEXEC ON).
-- Order of databases: TestCRM first; eCRM+, SolarCRM, OSG only after Gate G3.
-- Needs 129 applied on the same database; 130 refuses otherwise.
-- 131-134 follow in the same sitting (plan Ruling 1). 130 on its own leaves the
-- old server working: it adds columns and rows, it alters no procedure.
--
-- Steps (each guarded, a re-run is a no-op):
--   1. Refuse unless sp_FetchFollowUps and sp_FetchCustomerDetail carry 129.
--   2. dbo.tblAccessModelBackup + dbo.sp_AccessModelBackup (first save wins;
--      Definition NULL = the object did not exist), dbo.tblAccessModelSnapshot.
--   3. Print every role's leads / complaints rows (before).
--   4. tblGroupModule.AssignReach + CK; tblTicket / tblLeads.LoggerHolds
--      (BIT NOT NULL DEFAULT 0; its constraint comes in 133). Migration:
--      Company -> Company, OfficeTree -> OfficeTree, Office / Team / Own ->
--      Office, on every leads / complaints row. Print the rows again (after).
--   5. LoggerHolds = 1 exactly where nobody is assigned and no history row
--      names anyone; 0 elsewhere (both ways, so 133 can re-run it).
--   6. transfer_reason `sent_back`: "Sent back to manager" -> "Sent back"
--      (a reworded label is left alone). Old rows saved as #label_sent_back.
--   7. Role "Support Team Lead" in every company that has none, no members.
--      Inserted ids saved as #role_support_team_lead.
--   8. N3 (plan Ruling 16): print, then clear EscalatedTo / EscalatedAt on
--      in-progress complaints whose target has no complaints View. Cleared
--      rows saved as #escalation_n3.
--   9. Print records in progress held by someone who cannot work the module
--      (no View + Edit through an active group, and not admin).
--  10. Old-answer snapshot (spec 13.1), only while the snapshot is empty: for
--      every active user, the ids today's code shows them, kinds
--      ticket / lead / followup / custticket (pre-flight S13).
--
-- Pseudo-rows in tblAccessModelBackup (ObjName starts with '#', ObjType NULL;
-- the rollback 135 must skip them in its EXEC loop and restore them by hand):
--   #label_sent_back        [{"Id":39,"CompId":1,"Value":"Sent back to manager"}]
--   #role_support_team_lead [{"CompId":1,"GroupId":13}]  (groups 130 inserted)
--   #escalation_n3          [{"Id":..,"EscalatedTo":..,"EscalatedAt":".."}]
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse unless 129 is applied (both procs, the exact new clauses).
-- ---------------------------------------------------------------------------
IF CHARINDEX('(f.AssignedTo = @UserId AND f.Status = ''open'')', ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchFollowUps')), '')) = 0
   OR CHARINDEX('t.CreatedBy = @UserId AND t.AssignedTo IS NULL', ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchCustomerDetail')), '')) = 0
BEGIN
    RAISERROR('130: script 129 is not applied to this database (sp_FetchFollowUps / sp_FetchCustomerDetail). Apply 129 first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2. Backup table + procedure, snapshot table.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblAccessModelBackup', 'U') IS NULL
    CREATE TABLE dbo.tblAccessModelBackup (
        ObjName    SYSNAME       NOT NULL CONSTRAINT PK_tblAccessModelBackup PRIMARY KEY,
        ScriptNo   INT           NOT NULL,
        ObjType    CHAR(2)       NULL,
        Definition NVARCHAR(MAX) NULL,      -- NULL = the object did not exist before
        SavedAt    DATETIME      NOT NULL
    );

IF OBJECT_ID('dbo.tblAccessModelSnapshot', 'U') IS NULL
    CREATE TABLE dbo.tblAccessModelSnapshot (
        Kind     VARCHAR(12) NOT NULL,      -- ticket | lead | followup | custticket
        UserId   INT         NOT NULL,
        RecordId INT         NOT NULL,      -- custticket: the TicketId
        CONSTRAINT PK_tblAccessModelSnapshot PRIMARY KEY (Kind, UserId, RecordId)
    );
GO

-- Saves the live definition of dbo.<@ObjName> once; a second call for the same
-- name does nothing (first save wins). Called by 131-134 before each alter.
CREATE OR ALTER PROC dbo.sp_AccessModelBackup
    @ScriptNo INT,
    @ObjName  SYSNAME
AS
BEGIN
    SET NOCOUNT ON;
    IF @ScriptNo IS NULL OR @ObjName IS NULL
    BEGIN
        RAISERROR('sp_AccessModelBackup: @ScriptNo and @ObjName are required', 16, 1);
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM dbo.tblAccessModelBackup WHERE ObjName = @ObjName) RETURN;

    DECLARE @id INT = OBJECT_ID(N'dbo.' + QUOTENAME(@ObjName));
    INSERT INTO dbo.tblAccessModelBackup (ObjName, ScriptNo, ObjType, Definition, SavedAt)
    SELECT @ObjName, @ScriptNo,
           (SELECT o.type FROM sys.objects o WHERE o.object_id = @id),
           OBJECT_DEFINITION(@id),
           GETDATE();
END
GO

-- ---------------------------------------------------------------------------
-- 3. Before: every role's leads / complaints rows.
-- ---------------------------------------------------------------------------
SELECT 'before' AS Phase, g.CompId, g.Id AS GroupId, g.Name AS RoleName, gm.Module,
       gm.CanView, gm.CanAdd, gm.CanEdit, gm.CanDelete, gm.Reach
FROM dbo.tblGroupModule gm
JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
WHERE gm.Module IN ('leads', 'complaints')
ORDER BY g.CompId, g.Name, gm.Module;
GO

-- ---------------------------------------------------------------------------
-- 4. Columns, check, migration.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblGroupModule', 'AssignReach') IS NULL
    ALTER TABLE dbo.tblGroupModule ADD AssignReach VARCHAR(12) NULL;

IF COL_LENGTH('dbo.tblTicket', 'LoggerHolds') IS NULL
    ALTER TABLE dbo.tblTicket ADD LoggerHolds BIT NOT NULL
        CONSTRAINT DF_tblTicket_LoggerHolds DEFAULT 0;

IF COL_LENGTH('dbo.tblLeads', 'LoggerHolds') IS NULL
    ALTER TABLE dbo.tblLeads ADD LoggerHolds BIT NOT NULL
        CONSTRAINT DF_tblLeads_LoggerHolds DEFAULT 0;
GO

IF OBJECT_ID('dbo.CK_tblGroupModule_AssignReach', 'C') IS NULL
    ALTER TABLE dbo.tblGroupModule WITH CHECK ADD CONSTRAINT CK_tblGroupModule_AssignReach
        CHECK (AssignReach IN ('Team', 'Office', 'OfficeTree', 'Company'));
GO

-- Spec 11 Migration: Own and Team become Their office (D2). Only empty cells
-- are filled, so a re-run never undoes an admin's later choice.
UPDATE dbo.tblGroupModule
SET AssignReach = CASE Reach WHEN 'Company'    THEN 'Company'
                             WHEN 'OfficeTree' THEN 'OfficeTree'
                             ELSE 'Office' END
WHERE Module IN ('leads', 'complaints') AND AssignReach IS NULL;
PRINT '130: AssignReach filled on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' row(s)';

SELECT 'after' AS Phase, g.CompId, g.Id AS GroupId, g.Name AS RoleName, gm.Module,
       gm.CanView, gm.CanAdd, gm.CanEdit, gm.CanDelete, gm.Reach, gm.AssignReach
FROM dbo.tblGroupModule gm
JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
WHERE gm.Module IN ('leads', 'complaints')
ORDER BY g.CompId, g.Name, gm.Module;
GO

-- ---------------------------------------------------------------------------
-- 5. LoggerHolds backfill (plan Ruling 12; spec 11 Migration). Yes only when
--    nobody is assigned and no history row names anyone.
-- ---------------------------------------------------------------------------
UPDATE t SET LoggerHolds = x.Want
FROM dbo.tblTicket t
CROSS APPLY (SELECT CAST(CASE WHEN t.AssignedTo IS NULL
                               AND NOT EXISTS (SELECT 1 FROM dbo.tblTicketAssignment a
                                               WHERE a.TicketId = t.Id
                                                 AND (a.ToUserId IS NOT NULL OR a.FromUserId IS NOT NULL))
                              THEN 1 ELSE 0 END AS BIT) AS Want) x
WHERE t.LoggerHolds <> x.Want;
PRINT '130: tblTicket.LoggerHolds changed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' row(s)';

UPDATE l SET LoggerHolds = x.Want
FROM dbo.tblLeads l
CROSS APPLY (SELECT CAST(CASE WHEN l.OwnerId IS NULL
                               AND NOT EXISTS (SELECT 1 FROM dbo.tblLeadAssignment a
                                               WHERE a.LeadId = l.Id
                                                 AND (a.ToUserId IS NOT NULL OR a.FromUserId IS NOT NULL))
                              THEN 1 ELSE 0 END AS BIT) AS Want) x
WHERE l.LoggerHolds <> x.Want;
PRINT '130: tblLeads.LoggerHolds changed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' row(s)';

SELECT 'LoggerHolds = 1' AS Measure,
       (SELECT COUNT(*) FROM dbo.tblTicket WHERE LoggerHolds = 1) AS Complaints,
       (SELECT COUNT(*) FROM dbo.tblLeads  WHERE LoggerHolds = 1) AS Leads;
GO

-- ---------------------------------------------------------------------------
-- 6. Sent-back label (spec 4, 11 SQL 10). Old text saved first (S1).
-- ---------------------------------------------------------------------------
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @old NVARCHAR(MAX) = (
    SELECT Id, CompId, Value FROM dbo.tblLookup
    WHERE Kind = 'transfer_reason' AND Code = 'sent_back' AND Value = N'Sent back to manager'
    FOR JSON PATH);
IF @old IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.tblAccessModelBackup WHERE ObjName = '#label_sent_back')
        INSERT INTO dbo.tblAccessModelBackup (ObjName, ScriptNo, ObjType, Definition, SavedAt)
        VALUES ('#label_sent_back', 130, NULL, @old, GETDATE());

    UPDATE dbo.tblLookup SET Value = N'Sent back'
    WHERE Kind = 'transfer_reason' AND Code = 'sent_back' AND Value = N'Sent back to manager';
    PRINT '130: sent_back label renamed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' row(s)';
END
ELSE
    PRINT '130: sent_back label already renamed or reworded, skipping';
COMMIT;
GO

-- ---------------------------------------------------------------------------
-- 7. Support Team Lead (spec 5, D9): Support Agent's rows, raised where 5
--    raises them. No members. Ids saved for the rollback (S1).
-- ---------------------------------------------------------------------------
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @new TABLE (GroupId INT PRIMARY KEY, CompId BIGINT);

INSERT INTO dbo.tblUserGroups (Name, Description, IsActive, CompId, BranchId, HierarchyLevel, DataScope, IsAdmin, CanSeeSensitive)
OUTPUT inserted.Id, inserted.CompId INTO @new (GroupId, CompId)
SELECT 'Support Team Lead', 'Own and their team''s complaints', 1, c.CompId, c.BranchId, 3, 'Team', 0, 0
FROM (SELECT CompId, MIN(BranchId) AS BranchId FROM dbo.tblUserGroups
      WHERE CompId IS NOT NULL GROUP BY CompId) c
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups g WHERE g.CompId = c.CompId AND g.Name = 'Support Team Lead');

INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach)
SELECT n.GroupId, r.Module, r.V, r.A, r.E, r.D, r.Reach, r.AssignReach
FROM @new n
CROSS JOIN (VALUES
    ('complaints',      1, 1, 1, 0, 'Team',   'Office'),
    ('customers',       1, 1, 1, 0, 'Office', NULL),
    ('people',          1, 0, 0, 0, 'Team',   NULL),
    ('tasks',           1, 1, 1, 1, NULL,     NULL),
    ('dashboard',       1, 0, 0, 0, NULL,     NULL),
    ('support_reports', 1, 0, 0, 0, NULL,     NULL)
) r (Module, V, A, E, D, Reach, AssignReach);

IF EXISTS (SELECT 1 FROM @new)
BEGIN
    DECLARE @ids NVARCHAR(MAX) = (
        SELECT CompId, GroupId FROM (
            SELECT j.CompId, j.GroupId
            FROM dbo.tblAccessModelBackup b
            CROSS APPLY OPENJSON(b.Definition) WITH (CompId BIGINT, GroupId INT) j
            WHERE b.ObjName = '#role_support_team_lead'
            UNION
            SELECT CompId, GroupId FROM @new) x
        FOR JSON PATH);
    IF EXISTS (SELECT 1 FROM dbo.tblAccessModelBackup WHERE ObjName = '#role_support_team_lead')
        UPDATE dbo.tblAccessModelBackup SET Definition = @ids WHERE ObjName = '#role_support_team_lead';
    ELSE
        INSERT INTO dbo.tblAccessModelBackup (ObjName, ScriptNo, ObjType, Definition, SavedAt)
        VALUES ('#role_support_team_lead', 130, NULL, @ids, GETDATE());
END
DECLARE @newCount INT = (SELECT COUNT(*) FROM @new);
PRINT '130: Support Team Lead added in ' + CAST(@newCount AS VARCHAR(10)) + ' company(ies)';
COMMIT;
GO

-- ---------------------------------------------------------------------------
-- 8. N3 (plan Ruling 16): in-progress escalations whose target has no
--    complaints View through an active group (nor an admin group). Print,
--    save, clear.
-- ---------------------------------------------------------------------------
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @n3 TABLE (Id INT PRIMARY KEY, TicketNo VARCHAR(50), EscalatedTo INT, EscalatedAt DATETIME);
INSERT INTO @n3 (Id, TicketNo, EscalatedTo, EscalatedAt)
SELECT t.Id, t.TicketNo, t.EscalatedTo, t.EscalatedAt
FROM dbo.tblTicket t
JOIN dbo.tblLookup s ON s.Id = t.StatusId
WHERE s.Code IN ('open', 'onhold') AND t.EscalatedTo IS NOT NULL
  AND NOT EXISTS (
        SELECT 1 FROM dbo.tblUserGroupMap m
        JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = t.CompId
        LEFT JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id AND gm.Module = 'complaints' AND gm.CanView = 1
        WHERE m.UserId = t.EscalatedTo AND (g.IsAdmin = 1 OR gm.Id IS NOT NULL));

SELECT 'N3 escalation cleared' AS List, n.Id AS TicketId, n.TicketNo, n.EscalatedTo, u.FullName AS EscalatedToName, n.EscalatedAt
FROM @n3 n LEFT JOIN dbo.tblUser u ON u.Id = n.EscalatedTo
ORDER BY n.Id;

IF EXISTS (SELECT 1 FROM @n3)
BEGIN
    DECLARE @esc NVARCHAR(MAX) = (
        SELECT Id, EscalatedTo, EscalatedAt FROM (
            SELECT j.Id, j.EscalatedTo, j.EscalatedAt
            FROM dbo.tblAccessModelBackup b
            CROSS APPLY OPENJSON(b.Definition) WITH (Id INT, EscalatedTo INT, EscalatedAt DATETIME) j
            WHERE b.ObjName = '#escalation_n3'
            UNION
            SELECT Id, EscalatedTo, EscalatedAt FROM @n3) x
        FOR JSON PATH);
    IF EXISTS (SELECT 1 FROM dbo.tblAccessModelBackup WHERE ObjName = '#escalation_n3')
        UPDATE dbo.tblAccessModelBackup SET Definition = @esc WHERE ObjName = '#escalation_n3';
    ELSE
        INSERT INTO dbo.tblAccessModelBackup (ObjName, ScriptNo, ObjType, Definition, SavedAt)
        VALUES ('#escalation_n3', 130, NULL, @esc, GETDATE());

    UPDATE t SET EscalatedTo = NULL, EscalatedAt = NULL
    FROM dbo.tblTicket t JOIN @n3 n ON n.Id = t.Id;
END
DECLARE @n3Count INT = (SELECT COUNT(*) FROM @n3);
PRINT '130: N3 escalations cleared: ' + CAST(@n3Count AS VARCHAR(10));
COMMIT;
GO

-- ---------------------------------------------------------------------------
-- 9. Records in progress held by someone who cannot work the module
--    (F5 list; printed only, nothing changes). View + Edit = a CanView row
--    that also has CanEdit, as sp_FetchUserAccess unions them.
-- ---------------------------------------------------------------------------
SELECT 'cannot work it' AS List, x.Kind, x.RecordId, x.HolderId, u.FullName AS HolderName, u.IsActive AS HolderActive
FROM (
    SELECT 'complaint' AS Kind, t.Id AS RecordId, t.AssignedTo AS HolderId, t.CompId, 'complaints' AS Module
    FROM dbo.tblTicket t JOIN dbo.tblLookup s ON s.Id = t.StatusId
    WHERE s.Code IN ('open', 'onhold') AND t.AssignedTo IS NOT NULL
    UNION ALL
    SELECT 'lead', l.Id, l.OwnerId, l.CompId, 'leads'
    FROM dbo.tblLeads l JOIN dbo.tblLookup s ON s.Id = l.StatusId
    WHERE s.Code IN ('open', 'qualified') AND l.OwnerId IS NOT NULL
) x
LEFT JOIN dbo.tblUser u ON u.Id = x.HolderId
WHERE NOT EXISTS (
        SELECT 1 FROM dbo.tblUserGroupMap m
        JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = x.CompId
        LEFT JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id AND gm.Module = x.Module
                                       AND gm.CanView = 1 AND gm.CanEdit = 1
        WHERE m.UserId = x.HolderId AND (g.IsAdmin = 1 OR gm.Id IS NOT NULL))
ORDER BY x.Kind, x.HolderId, x.RecordId;
GO

-- ---------------------------------------------------------------------------
-- 10. Old-answer snapshot (spec 13.1, pre-flight S13). Only while empty.
--     Scope per active user, set-based, as sp_FetchUserAccess + access.js
--     scopeFor / listsFor give it today:
--       admin (an active IsAdmin group) -> Company lists, no owner filter;
--       no CanView on the module -> no scope (list routes answer 403);
--       Reach NULL -> Own; Own -> [home], owners [me];
--       Team -> home + the ReportsTo subtree's homes, owners = subtree incl. me;
--       Office -> home + tblUserBranchAccess CanRead; OfficeTree -> Office +
--       descendants; Company -> every tblBranch row; wide = no owner filter.
--     Each kind then uses the live WHERE of its proc:
--       ticket     sp_FetchTickets (complaints scope)
--       lead       sp_FetchLeads (leads scope)
--       followup   sp_FetchFollowUps paged mode, post-129 (leads scope)
--       custticket sp_FetchCustomerDetail RS2, post-129 (complaints scope, []
--                  without View), only for customers the user can open
--                  (customers View + canSeeRecord on CreatedBy).
-- ---------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM dbo.tblAccessModelSnapshot)
BEGIN
    PRINT '130: snapshot already taken, skipping';
    RETURN;
END

SET XACT_ABORT ON;

CREATE TABLE #U (UserId INT PRIMARY KEY, CompId BIGINT NOT NULL, Home BIGINT NULL, IsAdmin BIT NOT NULL);
INSERT INTO #U (UserId, CompId, Home, IsAdmin)
SELECT u.Id, u.CompId, u.BranchId,
       CAST(ISNULL((SELECT MAX(CAST(g.IsAdmin AS INT))
                    FROM dbo.tblUserGroupMap m
                    JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = u.CompId
                    WHERE m.UserId = u.Id), 0) AS BIT)
FROM dbo.tblUser u
WHERE u.IsActive = 1;

-- Scope per (user, module) for the three modules the kinds read.
CREATE TABLE #S (UserId INT NOT NULL, Module VARCHAR(20) NOT NULL, Reach VARCHAR(12) NOT NULL,
                 PRIMARY KEY (UserId, Module));
INSERT INTO #S (UserId, Module, Reach)
SELECT u.UserId, mo.Module, 'Company'
FROM #U u CROSS JOIN (VALUES ('leads'), ('complaints'), ('customers')) mo (Module)
WHERE u.IsAdmin = 1
UNION ALL
SELECT u.UserId, gm.Module,
       ISNULL(CASE MAX(CASE gm.Reach WHEN 'Own' THEN 1 WHEN 'Team' THEN 2 WHEN 'Office' THEN 3
                                     WHEN 'OfficeTree' THEN 4 WHEN 'Company' THEN 5 END)
                   WHEN 1 THEN 'Own' WHEN 2 THEN 'Team' WHEN 3 THEN 'Office'
                   WHEN 4 THEN 'OfficeTree' WHEN 5 THEN 'Company' END, 'Own')
FROM #U u
JOIN dbo.tblUserGroupMap m ON m.UserId = u.UserId
JOIN dbo.tblUserGroups g   ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = u.CompId
JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id AND gm.CanView = 1
                          AND gm.Module IN ('leads', 'complaints', 'customers')
WHERE u.IsAdmin = 0
GROUP BY u.UserId, gm.Module;

-- ReportsTo subtree incl. self (any active state, as the live proc).
-- ponytail: depth capped at 30; the live proc errors past 32 levels instead.
CREATE TABLE #Team (UserId INT NOT NULL, MemberId INT NOT NULL, BranchId BIGINT NULL, PRIMARY KEY (UserId, MemberId));
;WITH chain AS (
    SELECT u.UserId AS RootId, u.CompId, u.UserId AS MemberId, u.Home AS BranchId, 0 AS Depth
    FROM #U u
    UNION ALL
    SELECT c.RootId, c.CompId, x.Id, x.BranchId, c.Depth + 1
    FROM dbo.tblUser x JOIN chain c ON x.ReportsTo = c.MemberId
    WHERE x.CompId = c.CompId AND x.Id <> c.RootId AND c.Depth < 30
)
INSERT INTO #Team (UserId, MemberId, BranchId)
SELECT RootId, MemberId, MIN(BranchId) FROM chain GROUP BY RootId, MemberId
OPTION (MAXRECURSION 32);

CREATE TABLE #Off (UserId INT NOT NULL, BranchId BIGINT NOT NULL, PRIMARY KEY (UserId, BranchId));
INSERT INTO #Off (UserId, BranchId)
SELECT UserId, Home FROM #U WHERE Home IS NOT NULL
UNION
SELECT u.UserId, a.BranchId
FROM #U u JOIN dbo.tblUserBranchAccess a ON a.UserId = u.UserId AND a.CompId = u.CompId AND a.CanRead = 1;

CREATE TABLE #Tree (UserId INT NOT NULL, BranchId BIGINT NOT NULL, PRIMARY KEY (UserId, BranchId));
;WITH t AS (
    SELECT UserId, BranchId, 0 AS Depth FROM #Off
    UNION ALL
    SELECT t.UserId, b.Id, t.Depth + 1 FROM dbo.tblBranch b JOIN t ON b.ParentId = t.BranchId
    WHERE t.Depth < 30
)
INSERT INTO #Tree (UserId, BranchId) SELECT DISTINCT UserId, BranchId FROM t
OPTION (MAXRECURSION 32);

-- Office list per (user, module) for that module's reach.
CREATE TABLE #Br (UserId INT NOT NULL, Module VARCHAR(20) NOT NULL, BranchId BIGINT NOT NULL,
                  PRIMARY KEY (UserId, Module, BranchId));
INSERT INTO #Br (UserId, Module, BranchId)
SELECT s.UserId, s.Module, u.Home FROM #S s JOIN #U u ON u.UserId = s.UserId
WHERE s.Reach = 'Own' AND u.Home IS NOT NULL
UNION
SELECT s.UserId, s.Module, u.Home FROM #S s JOIN #U u ON u.UserId = s.UserId
WHERE s.Reach = 'Team' AND u.Home IS NOT NULL
UNION
SELECT s.UserId, s.Module, tm.BranchId FROM #S s JOIN #Team tm ON tm.UserId = s.UserId
WHERE s.Reach = 'Team' AND tm.BranchId IS NOT NULL
UNION
SELECT s.UserId, s.Module, o.BranchId FROM #S s JOIN #Off o ON o.UserId = s.UserId
WHERE s.Reach = 'Office'
UNION
SELECT s.UserId, s.Module, tr.BranchId FROM #S s JOIN #Tree tr ON tr.UserId = s.UserId
WHERE s.Reach = 'OfficeTree'
UNION
SELECT s.UserId, s.Module, b.Id FROM #S s CROSS JOIN dbo.tblBranch b
WHERE s.Reach = 'Company' AND b.Id IS NOT NULL;

-- Owner list per (user, module): only Own / Team filter on the holder.
CREATE TABLE #Ow (UserId INT NOT NULL, Module VARCHAR(20) NOT NULL, OwnerId INT NOT NULL,
                  PRIMARY KEY (UserId, Module, OwnerId));
INSERT INTO #Ow (UserId, Module, OwnerId)
SELECT s.UserId, s.Module, s.UserId FROM #S s WHERE s.Reach = 'Own'
UNION
SELECT s.UserId, s.Module, tm.MemberId FROM #S s JOIN #Team tm ON tm.UserId = s.UserId WHERE s.Reach = 'Team';

BEGIN TRAN;

-- ticket: sp_FetchTickets (inner joins on status and customer, as the proc).
INSERT INTO dbo.tblAccessModelSnapshot (Kind, UserId, RecordId)
SELECT 'ticket', s.UserId, t.Id
FROM #S s
JOIN #U u              ON u.UserId = s.UserId
JOIN dbo.tblTicket t   ON t.CompId = u.CompId
JOIN dbo.tblLookup st  ON st.Id = t.StatusId
JOIN dbo.tblCustomer c ON c.Id = t.CustomerId
WHERE s.Module = 'complaints'
  AND (   (    EXISTS (SELECT 1 FROM #Br b WHERE b.UserId = s.UserId AND b.Module = s.Module AND b.BranchId = t.BranchId)
           AND (s.Reach NOT IN ('Own', 'Team')
                OR EXISTS (SELECT 1 FROM #Ow o WHERE o.UserId = s.UserId AND o.Module = s.Module AND o.OwnerId = t.AssignedTo)))
       OR t.AssignedTo = s.UserId
       OR (t.CreatedBy = s.UserId AND t.AssignedTo IS NULL));

-- lead: sp_FetchLeads.
INSERT INTO dbo.tblAccessModelSnapshot (Kind, UserId, RecordId)
SELECT 'lead', s.UserId, l.Id
FROM #S s
JOIN #U u             ON u.UserId = s.UserId
JOIN dbo.tblLeads l   ON l.CompId = u.CompId
JOIN dbo.tblLookup st ON st.Id = l.StatusId
WHERE s.Module = 'leads'
  AND (   (    EXISTS (SELECT 1 FROM #Br b WHERE b.UserId = s.UserId AND b.Module = s.Module AND b.BranchId = l.BranchId)
           AND (s.Reach NOT IN ('Own', 'Team')
                OR EXISTS (SELECT 1 FROM #Ow o WHERE o.UserId = s.UserId AND o.Module = s.Module AND o.OwnerId = l.OwnerId)))
       OR l.OwnerId = s.UserId
       OR (l.OwnerId IS NULL AND l.CreatedBy = s.UserId));

-- followup: sp_FetchFollowUps paged mode, after 129.
INSERT INTO dbo.tblAccessModelSnapshot (Kind, UserId, RecordId)
SELECT 'followup', s.UserId, f.Id
FROM #S s
JOIN #U u              ON u.UserId = s.UserId
JOIN dbo.tblFollowUp f ON f.CompId = u.CompId
JOIN dbo.tblLeads l    ON l.Id = f.LeadId AND l.CompId = f.CompId
JOIN dbo.tblLookup st  ON st.Id = l.StatusId
WHERE s.Module = 'leads'
  AND (   (    EXISTS (SELECT 1 FROM #Br b WHERE b.UserId = s.UserId AND b.Module = s.Module AND b.BranchId = l.BranchId)
           AND (s.Reach NOT IN ('Own', 'Team')
                OR EXISTS (SELECT 1 FROM #Ow o WHERE o.UserId = s.UserId AND o.Module = s.Module AND o.OwnerId = l.OwnerId)))
       OR l.OwnerId = s.UserId
       OR (l.OwnerId IS NULL AND l.CreatedBy = s.UserId)
       OR (f.AssignedTo = s.UserId AND f.Status = 'open'));

-- custticket: sp_FetchCustomerDetail RS2 after 129, for customers the user
-- can open (customers scope + canSeeRecord with owner field CreatedBy).
-- Without complaints View the complaints lists are [] (only the "me" arm).
INSERT INTO dbo.tblAccessModelSnapshot (Kind, UserId, RecordId)
SELECT 'custticket', cs.UserId, t.Id
FROM #S cs
JOIN #U u              ON u.UserId = cs.UserId
JOIN dbo.tblCustomer c ON c.CompId = u.CompId
JOIN dbo.tblTicket t   ON t.CompId = u.CompId AND t.CustomerId = c.Id
JOIN dbo.tblLookup st  ON st.Id = t.StatusId
LEFT JOIN #S s         ON s.UserId = cs.UserId AND s.Module = 'complaints'
WHERE cs.Module = 'customers'
  AND (   c.CreatedBy = cs.UserId
       OR (    EXISTS (SELECT 1 FROM #Br b WHERE b.UserId = cs.UserId AND b.Module = 'customers' AND b.BranchId = c.BranchId)
           AND (cs.Reach NOT IN ('Own', 'Team')
                OR EXISTS (SELECT 1 FROM #Ow o WHERE o.UserId = cs.UserId AND o.Module = 'customers' AND o.OwnerId = c.CreatedBy))))
  AND (   (    s.UserId IS NOT NULL
           AND EXISTS (SELECT 1 FROM #Br b WHERE b.UserId = s.UserId AND b.Module = 'complaints' AND b.BranchId = t.BranchId)
           AND (s.Reach NOT IN ('Own', 'Team')
                OR EXISTS (SELECT 1 FROM #Ow o WHERE o.UserId = s.UserId AND o.Module = 'complaints' AND o.OwnerId = t.AssignedTo)))
       OR t.AssignedTo = cs.UserId
       OR (t.CreatedBy = cs.UserId AND t.AssignedTo IS NULL));

COMMIT;

SELECT 'snapshot' AS List, Kind, COUNT(*) AS Rows, COUNT(DISTINCT UserId) AS Users
FROM dbo.tblAccessModelSnapshot GROUP BY Kind ORDER BY Kind;

DROP TABLE #Ow; DROP TABLE #Br; DROP TABLE #Tree; DROP TABLE #Off; DROP TABLE #Team; DROP TABLE #S; DROP TABLE #U;
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- Verify after apply. Expected values: TestCRM from the 2026-11-22 dry run,
-- eCRM+ from the spec / Task 1; SolarCRM and OSG backfill 0 / 0, N3 0.
--
-- 1. No viewer row of leads / complaints without "Can assign to"  -> 0
-- SELECT COUNT(*) FROM dbo.tblGroupModule
-- WHERE Module IN ('leads', 'complaints') AND CanView = 1 AND AssignReach IS NULL;
--
-- 2. Migration table -> only the pairs Company/Company, OfficeTree/OfficeTree,
--    Office/Office, Team/Office, Own/Office; then 0 rows of other modules
--    carrying AssignReach.
-- SELECT gm.Reach, gm.AssignReach, COUNT(*) AS Rows FROM dbo.tblGroupModule gm
-- WHERE gm.Module IN ('leads', 'complaints') GROUP BY gm.Reach, gm.AssignReach;
-- SELECT COUNT(*) FROM dbo.tblGroupModule
-- WHERE Module NOT IN ('leads', 'complaints') AND AssignReach IS NOT NULL;   -- 0
--    TestCRM: Company/Company 6, OfficeTree/OfficeTree 2, Office/Office 3,
--    Team/Office 2 (Sales Team Lead + the new Support Team Lead), Own/Office 2.
--
-- 3. LoggerHolds only where nobody is or was named  -> 0, 0
-- SELECT COUNT(*) FROM dbo.tblTicket t WHERE t.LoggerHolds = 1
--   AND (t.AssignedTo IS NOT NULL OR EXISTS (SELECT 1 FROM dbo.tblTicketAssignment a
--        WHERE a.TicketId = t.Id AND (a.ToUserId IS NOT NULL OR a.FromUserId IS NOT NULL)));
-- SELECT COUNT(*) FROM dbo.tblLeads l WHERE l.LoggerHolds = 1
--   AND (l.OwnerId IS NOT NULL OR EXISTS (SELECT 1 FROM dbo.tblLeadAssignment a
--        WHERE a.LeadId = l.Id AND (a.ToUserId IS NOT NULL OR a.FromUserId IS NOT NULL)));
--    Yes-counts (SELECT COUNT(*) ... WHERE LoggerHolds = 1):
--      TestCRM 52 complaints / 22 leads; eCRM+ 4 / 6; SolarCRM 0 / 0; OSG 0 / 0.
--
-- 4. Old label gone  -> 0  (and the label now reads 'Sent back')
-- SELECT COUNT(*) FROM dbo.tblLookup
-- WHERE Kind = 'transfer_reason' AND Code = 'sent_back' AND Value = 'Sent back to manager';
--
-- 5. Support Team Lead once per company -> one group row per CompId with
--    HierarchyLevel 3, IsAdmin 0, no members; six module rows:
--      complaints      V A E -  Reach Team    AssignReach Office
--      customers       V A E -  Reach Office
--      people          V - - -  Reach Team
--      tasks           V A E D
--      dashboard       V - - -
--      support_reports V - - -
-- SELECT g.CompId, g.Id, g.HierarchyLevel, g.IsAdmin,
--        (SELECT COUNT(*) FROM dbo.tblUserGroupMap m WHERE m.GroupId = g.Id) AS Members,
--        gm.Module, gm.CanView, gm.CanAdd, gm.CanEdit, gm.CanDelete, gm.Reach, gm.AssignReach
-- FROM dbo.tblUserGroups g JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id
-- WHERE g.Name = 'Support Team Lead' ORDER BY g.CompId, gm.Module;
--
-- 6. No in-progress escalation to someone without complaints View  -> 0
--    (cleared by step 8: TestCRM 17, eCRM+ / SolarCRM / OSG 0)
-- SELECT COUNT(*) FROM dbo.tblTicket t JOIN dbo.tblLookup s ON s.Id = t.StatusId
-- WHERE s.Code IN ('open', 'onhold') AND t.EscalatedTo IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m
--       JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = t.CompId
--       LEFT JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id AND gm.Module = 'complaints' AND gm.CanView = 1
--       WHERE m.UserId = t.EscalatedTo AND (g.IsAdmin = 1 OR gm.Id IS NOT NULL));
--
-- 7. Snapshot rows per kind, and per user for the owner's spot check at G1.
-- SELECT Kind, COUNT(*) AS Rows, COUNT(DISTINCT UserId) AS Users
-- FROM dbo.tblAccessModelSnapshot GROUP BY Kind ORDER BY Kind;
--    TestCRM dry run 2026-11-22 (moves with the data; followup assumes 129):
--      custticket 1303 rows / 16 users, followup 24721 / 26,
--      lead 8291 / 26, ticket 1284 / 15.
-- SELECT u.Username, s.Kind, COUNT(*) AS Rows
-- FROM dbo.tblAccessModelSnapshot s JOIN dbo.tblUser u ON u.Id = s.UserId
-- WHERE u.Username IN ('bm_ho_rahul', 'pooja.joshi', 'tl_ho_neha') GROUP BY u.Username, s.Kind ORDER BY u.Username, s.Kind;
--    TestCRM dry run: bm_ho_rahul (Office) custticket 73, followup 1203,
--      lead 469, ticket 74; pooja.joshi (Own, no leads) custticket 4,
--      ticket 4; tl_ho_neha (Team, no complaints) followup 762, lead 259.
--
-- Backup pseudo-rows present (TestCRM: 3 rows):
-- SELECT ObjName, ScriptNo, LEFT(Definition, 200) FROM dbo.tblAccessModelBackup WHERE ObjName LIKE '#%';
-- ===========================================================================
