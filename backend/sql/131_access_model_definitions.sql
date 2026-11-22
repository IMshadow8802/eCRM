-- ===========================================================================
-- 131 - access model: the definitions. Scope, visibility, assign list, giver,
--       record actions, report tree, stranded work + notice; sp_FetchUserAccess,
--       the role-module procedures and the assign-list procedure rebuilt on them.
--       (spec docs/superpowers/specs/2026-11-21-access-model/design.md
--        sections 2.2-2.6, 3.1, 3.3, 3.6, 3.7, 10, 11 SQL 3/6/9;
--        plan 2026-11-22-access-model Task 3; pre-flight S5, S6, S8, S18)
--
-- Apply by hand:  sqlcmd -I -b ... -i 131_access_model_definitions.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error.
-- Needs 130 on the same database; 131 refuses otherwise (and SETs NOEXEC ON).
-- From 131 on, the OLD server cannot serve leads / complaints (fn_ReportTree
-- changes signature; 132 re-points its callers). 132-134 follow in the same
-- sitting (plan Ruling 1).
--
-- Every object below is first saved into dbo.tblAccessModelBackup through
-- dbo.sp_AccessModelBackup (first save wins; Definition NULL = it did not
-- exist, so 135 drops it).
--
-- THE RULE (written here once; every later script reads it, never copies it):
--   holder(record) = AssignedTo / OwnerId, else CreatedBy when LoggerHolds = 1
--   scope(module)  = fn_AccessScope: 0 rows = no View = nothing at all
--   visible        = holder = me
--                 OR (complaints) EscalatedTo = me AND status open / onhold
--                 OR ReachLevel >= 2 AND holder IN fn_AccessPeople
--                 OR ReachLevel >= 3 AND BranchId IN my offices (Level 3)
--                 OR ReachLevel >= 4 AND BranchId IN my offices (Level 3 or 4)
--                 OR ReachLevel  = 5
--   ReachLevel: Own 1, Team 2, Office 3, OfficeTree 4, Company 5.
--   "Can assign to" (AssignLevel): Team 2, Office 3, OfficeTree 4, Company 5;
--   NULL on a leads / complaints row reads as Team.
--   In progress: lead status code open / qualified; complaint open / onhold.
--
-- Created / replaced (exact signatures, later scripts depend on them):
--   fn_AccessGrants    (@CompId BIGINT, @UserId INT)                          inline
--   fn_AccessScope     (@CompId BIGINT, @UserId INT, @Module VARCHAR(30))     inline
--   fn_AccessPeople    (@CompId BIGINT, @UserId INT)          -> UserId
--   fn_AccessOffices   (@CompId BIGINT, @UserId INT)          -> BranchId, Level, CanWrite
--   fn_RecordGiver     (@CompId BIGINT, @Module VARCHAR(30), @RecordId INT, @HolderId INT) -> INT
--   fn_VisibleLeads    (@CompId BIGINT, @UserId INT)          -> LeadId
--   fn_VisibleTickets  (@CompId BIGINT, @UserId INT)          -> TicketId
--   fn_VisibleFollowUps(@CompId BIGINT, @UserId INT)          -> FollowUpId, Via
--   fn_AssignableUsers (@CompId BIGINT, @UserId INT, @Module VARCHAR(30), @RecordId INT)
--                                                            -> Id, GroupRank, IsGiver
--   fn_RecordActions   (@CompId BIGINT, @UserId INT, @Module VARCHAR(30), @RecordId INT)  inline
--                      -> InProgress, CanEdit, CanReassign, CanReopen, SendBackToId
--                         (0 rows = the record is not visible; pre-flight S6)
--   fn_StrandedWork    (@CompId BIGINT)                       -> UserId, Leads, Complaints  inline
--   fn_ReportTree      (@CompId BIGINT, @UserId INT)          (was 4 params; same columns)
--   sp_NotifyStranded  @CompId BIGINT, @UserIdsJson NVARCHAR(MAX), @ActorUserId INT
--   sp_FetchUserAccess @UserId INT, @CompId BIGINT           (RS2 gains AssignReach)
--   sp_FetchGroupModules @GroupId INT, @CompId BIGINT       (rows gain AssignReach)
--   sp_SaveGroupModules @GroupId INT, @CompId BIGINT, @ModulesJson NVARCHAR(MAX),
--                      @CanSeeSensitive BIT = 0, @UserId INT
--   sp_FetchAssignableUsers @CompId BIGINT, @UserId INT, @Module VARCHAR(30),
--                      @RecordId INT, @TargetUserId INT
-- Not created (pre-flight S8, no caller): sp_CheckRecordAccess.
-- No person parameter has a default (N1a); @UserId NULL answers nothing.
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse unless 130 is applied (S18).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_AccessModelBackup', 'P') IS NULL
   OR OBJECT_ID('dbo.tblAccessModelBackup', 'U') IS NULL
   OR COL_LENGTH('dbo.tblGroupModule', 'AssignReach') IS NULL
   OR COL_LENGTH('dbo.tblTicket', 'LoggerHolds') IS NULL
   OR COL_LENGTH('dbo.tblLeads', 'LoggerHolds') IS NULL
BEGIN
    RAISERROR('131: script 130 is not applied to this database. Apply 130 first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2. Back up every object this script creates or replaces (first save wins).
-- ---------------------------------------------------------------------------
EXEC dbo.sp_AccessModelBackup 131, 'fn_AccessGrants';
EXEC dbo.sp_AccessModelBackup 131, 'fn_AccessScope';
EXEC dbo.sp_AccessModelBackup 131, 'fn_AccessPeople';
EXEC dbo.sp_AccessModelBackup 131, 'fn_AccessOffices';
EXEC dbo.sp_AccessModelBackup 131, 'fn_RecordGiver';
EXEC dbo.sp_AccessModelBackup 131, 'fn_VisibleLeads';
EXEC dbo.sp_AccessModelBackup 131, 'fn_VisibleTickets';
EXEC dbo.sp_AccessModelBackup 131, 'fn_VisibleFollowUps';
EXEC dbo.sp_AccessModelBackup 131, 'fn_AssignableUsers';
EXEC dbo.sp_AccessModelBackup 131, 'fn_RecordActions';
EXEC dbo.sp_AccessModelBackup 131, 'fn_StrandedWork';
EXEC dbo.sp_AccessModelBackup 131, 'fn_ReportTree';
EXEC dbo.sp_AccessModelBackup 131, 'sp_NotifyStranded';
EXEC dbo.sp_AccessModelBackup 131, 'sp_FetchUserAccess';
EXEC dbo.sp_AccessModelBackup 131, 'sp_FetchGroupModules';
EXEC dbo.sp_AccessModelBackup 131, 'sp_SaveGroupModules';
EXEC dbo.sp_AccessModelBackup 131, 'sp_FetchAssignableUsers';
GO

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
                   ('attendance'), ('partners'), ('cards')) mo (Module);
GO

-- fn_AccessScope: the person's grant on one module (0 or 1 row) + home office.
CREATE OR ALTER FUNCTION dbo.fn_AccessScope (@CompId BIGINT, @UserId INT, @Module VARCHAR(30))
RETURNS TABLE
AS
RETURN
SELECT g.Module, g.CanView, g.CanAdd, g.CanEdit, g.CanDelete,
       g.Reach, g.ReachLevel, g.AssignReach, g.AssignLevel,
       u.BranchId AS HomeBranchId
FROM dbo.fn_AccessGrants(@CompId, @UserId) g
JOIN dbo.tblUser u ON u.Id = @UserId AND u.CompId = @CompId
WHERE g.Module = @Module;
GO

-- ---------------------------------------------------------------------------
-- 4. fn_AccessPeople: everyone below the person in "Reports to", any depth,
--    any active state (an inactive report still holds work), self excluded.
--    Level by level, never revisiting an id: a loop stops on the repeat, an
--    inactive manager in the chain is walked through, nothing raises.
--    Caller unknown / inactive: nobody.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_AccessPeople (@CompId BIGINT, @UserId INT)
RETURNS @P TABLE (UserId INT NOT NULL PRIMARY KEY)
AS
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId AND IsActive = 1)
        RETURN;

    DECLARE @n INT = 1;
    INSERT INTO @P (UserId)
    SELECT u.Id FROM dbo.tblUser u
    WHERE u.CompId = @CompId AND u.ReportsTo = @UserId AND u.Id <> @UserId;
    SET @n = @@ROWCOUNT;

    WHILE @n > 0
    BEGIN
        INSERT INTO @P (UserId)
        SELECT u.Id
        FROM dbo.tblUser u
        JOIN @P p ON p.UserId = u.ReportsTo
        WHERE u.CompId = @CompId AND u.Id <> @UserId
          AND NOT EXISTS (SELECT 1 FROM @P q WHERE q.UserId = u.Id);
        SET @n = @@ROWCOUNT;
    END
    RETURN;
END
GO

-- ---------------------------------------------------------------------------
-- 5. fn_AccessOffices: Level 3 = home (writable) + each extra office with
--    CanRead = 1 (writable when any of its grants has CanWrite = 1, as the old
--    sp_FetchUserAccess); Level 4 = every office below one of those, inheriting
--    its parent's CanWrite. Loop-safe on tblBranch.ParentId.
--    ponytail: an extra office that is itself below a writable one keeps its
--    own CanWrite (the old OfficeTree list took the MAX); no such grant exists.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_AccessOffices (@CompId BIGINT, @UserId INT)
RETURNS @O TABLE (BranchId BIGINT NOT NULL PRIMARY KEY, Level TINYINT NOT NULL, CanWrite BIT NOT NULL)
AS
BEGIN
    DECLARE @Home BIGINT, @Found BIT = 0;
    SELECT @Home = BranchId, @Found = 1
    FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId AND IsActive = 1;
    IF @Found = 0 RETURN;

    IF @Home IS NOT NULL INSERT INTO @O (BranchId, Level, CanWrite) VALUES (@Home, 3, 1);

    INSERT INTO @O (BranchId, Level, CanWrite)
    SELECT a.BranchId, 3, CAST(MAX(CAST(a.CanWrite AS INT)) AS BIT)
    FROM dbo.tblUserBranchAccess a
    WHERE a.UserId = @UserId AND a.CompId = @CompId AND a.CanRead = 1
      AND a.BranchId <> ISNULL(@Home, -1)
    GROUP BY a.BranchId;

    DECLARE @n INT = 1;
    WHILE @n > 0
    BEGIN
        INSERT INTO @O (BranchId, Level, CanWrite)
        SELECT b.Id, 4, CAST(MAX(CAST(p.CanWrite AS INT)) AS BIT)
        FROM dbo.tblBranch b
        JOIN @O p ON p.BranchId = b.ParentId
        WHERE b.Id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM @O q WHERE q.BranchId = b.Id)
        GROUP BY b.Id;
        SET @n = @@ROWCOUNT;
    END
    RETURN;
END
GO

-- ---------------------------------------------------------------------------
-- 6. fn_RecordGiver: "the person who gave it to me" (spec 3.1). Only when
--    @HolderId is the record's assigned person: AssignedBy of the latest
--    history row to them whose reason is not 'sent_back'. NULL when there is
--    none, when it is the holder, or when that person cannot work the module
--    now (inactive, or no View + Edit). The raw giver for gate 4's named
--    refusal is 133's business (pre-flight S2).
--    INLINE = OFF: SQL Server 2019 RTM scalar inlining is not trusted here.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_RecordGiver (@CompId BIGINT, @Module VARCHAR(30), @RecordId INT, @HolderId INT)
RETURNS INT
WITH INLINE = OFF
AS
BEGIN
    DECLARE @Giver INT;
    IF @Module = 'complaints'
        SELECT TOP (1) @Giver = a.AssignedBy
        FROM dbo.tblTicketAssignment a
        JOIN dbo.tblTicket t ON t.Id = a.TicketId AND t.CompId = @CompId AND t.AssignedTo = @HolderId
        LEFT JOIN dbo.tblLookup r ON r.Id = a.ReasonId
        WHERE a.TicketId = @RecordId AND a.CompId = @CompId AND a.ToUserId = @HolderId
          AND ISNULL(r.Code, '') <> 'sent_back'
        ORDER BY a.AssignedAt DESC, a.Id DESC;
    ELSE IF @Module = 'leads'
        SELECT TOP (1) @Giver = a.AssignedBy
        FROM dbo.tblLeadAssignment a
        JOIN dbo.tblLeads l ON l.Id = a.LeadId AND l.CompId = @CompId AND l.OwnerId = @HolderId
        LEFT JOIN dbo.tblLookup r ON r.Id = a.ReasonId
        WHERE a.LeadId = @RecordId AND a.CompId = @CompId AND a.ToUserId = @HolderId
          AND ISNULL(r.Code, '') <> 'sent_back'
        ORDER BY a.AssignedAt DESC, a.Id DESC;

    IF @Giver IS NULL OR @Giver = @HolderId RETURN NULL;
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_AccessGrants(@CompId, @Giver) g
                   WHERE g.Module = @Module AND g.CanEdit = 1)
        RETURN NULL;
    RETURN @Giver;
END
GO

-- ---------------------------------------------------------------------------
-- 7. Visibility (Rule 1). The scope is worked out once per call.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_VisibleLeads (@CompId BIGINT, @UserId INT)
RETURNS @T TABLE (LeadId INT NOT NULL PRIMARY KEY)
AS
BEGIN
    DECLARE @Lvl TINYINT;
    SELECT @Lvl = ISNULL(ReachLevel, 1) FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads');
    IF @Lvl IS NULL RETURN;                                   -- no View: nothing

    DECLARE @P TABLE (UserId INT NOT NULL PRIMARY KEY);
    DECLARE @O TABLE (BranchId BIGINT NOT NULL PRIMARY KEY, Level TINYINT NOT NULL);
    IF @Lvl BETWEEN 2 AND 4 INSERT INTO @P (UserId) SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId);
    IF @Lvl IN (3, 4)       INSERT INTO @O (BranchId, Level) SELECT BranchId, Level FROM dbo.fn_AccessOffices(@CompId, @UserId);

    INSERT INTO @T (LeadId)
    SELECT l.Id
    FROM dbo.tblLeads l
    CROSS APPLY (SELECT COALESCE(l.OwnerId, CASE WHEN l.LoggerHolds = 1 THEN l.CreatedBy END) AS HolderId) h
    WHERE l.CompId = @CompId
      AND (   @Lvl = 5
           OR h.HolderId = @UserId
           OR EXISTS (SELECT 1 FROM @P p WHERE p.UserId = h.HolderId)
           OR EXISTS (SELECT 1 FROM @O o WHERE o.BranchId = l.BranchId AND (o.Level = 3 OR @Lvl = 4)));
    RETURN;
END
GO

CREATE OR ALTER FUNCTION dbo.fn_VisibleTickets (@CompId BIGINT, @UserId INT)
RETURNS @T TABLE (TicketId INT NOT NULL PRIMARY KEY)
AS
BEGIN
    DECLARE @Lvl TINYINT;
    SELECT @Lvl = ISNULL(ReachLevel, 1) FROM dbo.fn_AccessScope(@CompId, @UserId, 'complaints');
    IF @Lvl IS NULL RETURN;                                   -- no View: nothing

    DECLARE @P TABLE (UserId INT NOT NULL PRIMARY KEY);
    DECLARE @O TABLE (BranchId BIGINT NOT NULL PRIMARY KEY, Level TINYINT NOT NULL);
    IF @Lvl BETWEEN 2 AND 4 INSERT INTO @P (UserId) SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId);
    IF @Lvl IN (3, 4)       INSERT INTO @O (BranchId, Level) SELECT BranchId, Level FROM dbo.fn_AccessOffices(@CompId, @UserId);

    INSERT INTO @T (TicketId)
    SELECT t.Id
    FROM dbo.tblTicket t
    CROSS APPLY (SELECT COALESCE(t.AssignedTo, CASE WHEN t.LoggerHolds = 1 THEN t.CreatedBy END) AS HolderId) h
    WHERE t.CompId = @CompId
      AND (   @Lvl = 5
           OR h.HolderId = @UserId
           OR (t.EscalatedTo = @UserId
               AND EXISTS (SELECT 1 FROM dbo.tblLookup s WHERE s.Id = t.StatusId AND s.Code IN ('open', 'onhold')))
           OR EXISTS (SELECT 1 FROM @P p WHERE p.UserId = h.HolderId)
           OR EXISTS (SELECT 1 FROM @O o WHERE o.BranchId = t.BranchId AND (o.Level = 3 OR @Lvl = 4)));
    RETURN;
END
GO

-- Follow-ups (spec 3.3). Via 1 = its lead is visible (any status);
-- Via 2 = open, assigned to the person, lead not visible;
-- Via 3 = open, assigned to one of the person's people (leads reach >= Team),
-- lead not visible. No leads View: nothing.
CREATE OR ALTER FUNCTION dbo.fn_VisibleFollowUps (@CompId BIGINT, @UserId INT)
RETURNS @F TABLE (FollowUpId INT NOT NULL PRIMARY KEY, Via TINYINT NOT NULL)
AS
BEGIN
    DECLARE @Lvl TINYINT;
    SELECT @Lvl = ISNULL(ReachLevel, 1) FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads');
    IF @Lvl IS NULL RETURN;

    DECLARE @L TABLE (LeadId INT NOT NULL PRIMARY KEY);
    DECLARE @P TABLE (UserId INT NOT NULL PRIMARY KEY);
    INSERT INTO @L (LeadId) SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);
    IF @Lvl BETWEEN 2 AND 4 INSERT INTO @P (UserId) SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId);

    INSERT INTO @F (FollowUpId, Via)
    SELECT f.Id,
           CASE WHEN l.LeadId IS NOT NULL THEN 1 WHEN f.AssignedTo = @UserId THEN 2 ELSE 3 END
    FROM dbo.tblFollowUp f
    LEFT JOIN @L l ON l.LeadId = f.LeadId
    WHERE f.CompId = @CompId
      AND (   l.LeadId IS NOT NULL
           OR (f.Status = 'open'
               AND (   f.AssignedTo = @UserId
                    OR EXISTS (SELECT 1 FROM @P p WHERE p.UserId = f.AssignedTo))));
    RETURN;
END
GO

-- ---------------------------------------------------------------------------
-- 8. fn_AssignableUsers (Rule 2): active, same company, View + Edit on the
--    module (admins always), and: me; my manager; my people; at Office my
--    writable Level-3 offices' people; at OfficeTree also the Level-4 ones;
--    at Company everyone; plus the record's giver when I hold it (IsGiver).
--    GroupRank 1 = me, manager, people (and a giver outside the list);
--    2 = based in one of my writable Level-3 offices; 3 = anyone else.
--    Caller without View on the module, or a module other than leads /
--    complaints: nobody.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_AssignableUsers (@CompId BIGINT, @UserId INT, @Module VARCHAR(30), @RecordId INT)
RETURNS @A TABLE (Id INT NOT NULL PRIMARY KEY, GroupRank TINYINT NOT NULL, IsGiver BIT NOT NULL)
AS
BEGIN
    IF @Module NOT IN ('leads', 'complaints') RETURN;
    DECLARE @AL TINYINT;
    SELECT @AL = ISNULL(AssignLevel, 2) FROM dbo.fn_AccessScope(@CompId, @UserId, @Module);
    IF @AL IS NULL RETURN;

    DECLARE @Mgr INT = (SELECT ReportsTo FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId);
    DECLARE @Giver INT = CASE WHEN @RecordId IS NULL THEN NULL
                              ELSE dbo.fn_RecordGiver(@CompId, @Module, @RecordId, @UserId) END;
    DECLARE @P TABLE (UserId INT NOT NULL PRIMARY KEY);
    DECLARE @O TABLE (BranchId BIGINT NOT NULL PRIMARY KEY, Level TINYINT NOT NULL);
    INSERT INTO @P (UserId) SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId);
    IF @AL >= 3
        INSERT INTO @O (BranchId, Level)
        SELECT BranchId, Level FROM dbo.fn_AccessOffices(@CompId, @UserId) WHERE CanWrite = 1;

    INSERT INTO @A (Id, GroupRank, IsGiver)
    SELECT u.Id,
           CASE WHEN u.Id = @UserId OR u.Id = @Mgr OR p.UserId IS NOT NULL THEN 1
                WHEN EXISTS (SELECT 1 FROM @O o WHERE o.BranchId = u.BranchId AND o.Level = 3) THEN 2
                WHEN u.Id = @Giver AND @AL < 5      -- a giver outside the list
                     AND NOT EXISTS (SELECT 1 FROM @O o WHERE o.BranchId = u.BranchId AND (o.Level = 3 OR @AL = 4)) THEN 1
                ELSE 3 END,
           CAST(CASE WHEN u.Id = @Giver THEN 1 ELSE 0 END AS BIT)
    FROM dbo.tblUser u
    LEFT JOIN @P p ON p.UserId = u.Id
    WHERE u.CompId = @CompId AND u.IsActive = 1
      AND EXISTS (SELECT 1 FROM dbo.fn_AccessGrants(@CompId, u.Id) g WHERE g.Module = @Module AND g.CanEdit = 1)
      AND (   u.Id = @UserId
           OR u.Id = @Mgr
           OR p.UserId IS NOT NULL
           OR (@AL IN (3, 4) AND EXISTS (SELECT 1 FROM @O o WHERE o.BranchId = u.BranchId AND (o.Level = 3 OR @AL = 4)))
           OR @AL = 5
           OR u.Id = @Giver);
    RETURN;
END
GO

-- ---------------------------------------------------------------------------
-- 9. fn_RecordActions (pre-flight S6): the action rules, written once. One row
--    when the record is visible to the person, none otherwise.
--      CanReassign = Edit AND (ReachLevel >= 3 OR in progress)       (F26)
--      CanReopen   = complaint, Edit, terminal status, AND
--                    (ReachLevel >= 3 OR (ReachLevel = 2 AND the assigned
--                     person is one of my people, never myself))  (canReopen)
--      SendBackToId = fn_RecordGiver when I hold it, else NULL.
--    133 adds the one reassign gate function (gates 1-7 -> Code, Message) on top
--    of this; detail procs (132) and sp_SetTicketStatus (133) read this one.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_RecordActions (@CompId BIGINT, @UserId INT, @Module VARCHAR(30), @RecordId INT)
RETURNS TABLE
AS
RETURN
SELECT CAST(r.InProgress AS BIT) AS InProgress,
       s.CanEdit,
       CAST(CASE WHEN s.CanEdit = 1 AND (ISNULL(s.ReachLevel, 1) >= 3 OR r.InProgress = 1) THEN 1 ELSE 0 END AS BIT) AS CanReassign,
       CAST(CASE WHEN @Module = 'complaints' AND s.CanEdit = 1 AND r.Terminal = 1
                  AND (   ISNULL(s.ReachLevel, 1) >= 3
                       OR (s.ReachLevel = 2
                           AND r.AssignedTo IN (SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId))))
                 THEN 1 ELSE 0 END AS BIT) AS CanReopen,
       dbo.fn_RecordGiver(@CompId, @Module, @RecordId, @UserId) AS SendBackToId
FROM dbo.fn_AccessScope(@CompId, @UserId, @Module) s
CROSS JOIN (
    SELECT t.AssignedTo,
           CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END AS InProgress,
           CASE WHEN st.Code IN ('resolved', 'closed', 'rejected') THEN 1 ELSE 0 END AS Terminal
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st ON st.Id = t.StatusId
    WHERE @Module = 'complaints' AND t.Id = @RecordId AND t.CompId = @CompId
      AND t.Id IN (SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId))
    UNION ALL
    SELECT l.OwnerId,
           CASE WHEN st.Code IN ('open', 'qualified') THEN 1 ELSE 0 END,
           0
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE @Module = 'leads' AND l.Id = @RecordId AND l.CompId = @CompId
      AND l.Id IN (SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId))
) r;
GO

-- ---------------------------------------------------------------------------
-- 10. fn_StrandedWork: per holder, in-progress records they cannot work
--     (no View + Edit on the module now; inactive holders included).
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_StrandedWork (@CompId BIGINT)
RETURNS TABLE
AS
RETURN
SELECT h.HolderId AS UserId,
       SUM(CASE WHEN h.Module = 'leads'      THEN 1 ELSE 0 END) AS Leads,
       SUM(CASE WHEN h.Module = 'complaints' THEN 1 ELSE 0 END) AS Complaints
FROM (
    SELECT COALESCE(t.AssignedTo, CASE WHEN t.LoggerHolds = 1 THEN t.CreatedBy END) AS HolderId,
           CAST('complaints' AS VARCHAR(30)) AS Module
    FROM dbo.tblTicket t JOIN dbo.tblLookup s ON s.Id = t.StatusId
    WHERE t.CompId = @CompId AND s.Code IN ('open', 'onhold')
    UNION ALL
    SELECT COALESCE(l.OwnerId, CASE WHEN l.LoggerHolds = 1 THEN l.CreatedBy END),
           CAST('leads' AS VARCHAR(30))
    FROM dbo.tblLeads l JOIN dbo.tblLookup s ON s.Id = l.StatusId
    WHERE l.CompId = @CompId AND s.Code IN ('open', 'qualified')
) h
WHERE h.HolderId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.fn_AccessGrants(@CompId, h.HolderId) g
                  WHERE g.Module = h.Module AND g.CanEdit = 1)
GROUP BY h.HolderId;
GO

-- ---------------------------------------------------------------------------
-- 11. fn_ReportTree (sales-reports plan Rulings 2 and 3 kept: the in-view
--     tree, the caller is a root). In view now comes from the caller's leads
--     scope, worked out here: Own -> self; Team -> self + people; Office /
--     OfficeTree -> self + people + people based in those offices (spec 3.6);
--     Company -> everyone in the company. No leads View / NULL caller: no rows.
--     Steps 2-4 are the previous body unchanged.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_ReportTree
(
    @CompId BIGINT,
    @UserId INT
)
RETURNS @T TABLE
(
    AncestorId INT NOT NULL,
    PersonId   INT NOT NULL,
    ChildId    INT NOT NULL,
    Depth      INT NOT NULL,
    NoManager  BIT NOT NULL,
    PRIMARY KEY (AncestorId, PersonId)
)
AS
BEGIN
    DECLARE @Lvl TINYINT;
    SELECT @Lvl = ISNULL(ReachLevel, 1) FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads');
    IF @Lvl IS NULL RETURN;

    DECLARE @P TABLE (UserId INT NOT NULL PRIMARY KEY);
    DECLARE @O TABLE (BranchId BIGINT NOT NULL PRIMARY KEY, Level TINYINT NOT NULL);
    IF @Lvl BETWEEN 2 AND 4 INSERT INTO @P (UserId) SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId);
    IF @Lvl IN (3, 4)       INSERT INTO @O (BranchId, Level) SELECT BranchId, Level FROM dbo.fn_AccessOffices(@CompId, @UserId);

    DECLARE @V TABLE (Id INT PRIMARY KEY, RawMgr INT NULL, Mgr INT NULL, Lvl INT NULL, NoManager BIT NOT NULL);

    -- 1. in view
    INSERT INTO @V (Id, RawMgr, NoManager)
    SELECT u.Id, u.ReportsTo,
           CASE WHEN u.ReportsTo IS NULL OR u.ReportsTo = u.Id THEN 1 ELSE 0 END
    FROM dbo.tblUser u
    WHERE u.CompId = @CompId
      AND (   u.Id = @UserId
           OR @Lvl = 5
           OR EXISTS (SELECT 1 FROM @P p WHERE p.UserId = u.Id)
           OR EXISTS (SELECT 1 FROM @O o WHERE o.BranchId = u.BranchId AND (o.Level = 3 OR @Lvl = 4)));

    -- 2. manager in view (the caller is always a root)
    UPDATE v SET Mgr = v.RawMgr
    FROM @V v
    WHERE v.RawMgr <> v.Id
      AND v.Id <> @UserId
      AND EXISTS (SELECT 1 FROM @V m WHERE m.Id = v.RawMgr);

    -- 3. walk from the roots; cut loops
    -- ponytail: depth capped at 50 levels; anyone deeper is cut like a loop member.
    UPDATE @V SET Lvl = 0 WHERE Mgr IS NULL;
    DECLARE @lvlN INT, @n INT, @cut INT;
    DECLARE @C TABLE (Id INT PRIMARY KEY, Mgr INT NULL);
    WHILE 1 = 1
    BEGIN
        SET @lvlN = 0; SET @n = 1;
        WHILE @n > 0 AND @lvlN < 50
        BEGIN
            UPDATE c SET Lvl = @lvlN + 1
            FROM @V c JOIN @V p ON p.Id = c.Mgr
            WHERE c.Lvl IS NULL AND p.Lvl = @lvlN;
            SET @n = @@ROWCOUNT;
            SET @lvlN += 1;
        END

        IF NOT EXISTS (SELECT 1 FROM @V WHERE Lvl IS NULL) BREAK;

        -- the loop members: prune unreached people nobody unreached reports to
        DELETE FROM @C;
        INSERT INTO @C (Id, Mgr) SELECT Id, Mgr FROM @V WHERE Lvl IS NULL;
        SET @n = 1;
        WHILE @n > 0
        BEGIN
            DELETE c FROM @C c WHERE NOT EXISTS (SELECT 1 FROM @C k WHERE k.Mgr = c.Id);
            SET @n = @@ROWCOUNT;
        END
        SELECT @cut = MIN(Id) FROM @C;
        IF @cut IS NULL SELECT @cut = MIN(Id) FROM @V WHERE Lvl IS NULL;   -- deeper than 50, no loop

        UPDATE @V SET Mgr = NULL, NoManager = 1, Lvl = 0 WHERE Id = @cut;
    END;

    -- 4. output: self rows + every ancestor through the kept edges (a forest now)
    WITH A AS
    (
        SELECT v.Id AS PersonId, v.Mgr AS AncestorId, v.Id AS ChildId, 1 AS Depth
        FROM @V v WHERE v.Mgr IS NOT NULL
        UNION ALL
        SELECT a.PersonId, p.Mgr, a.AncestorId, a.Depth + 1
        FROM A a JOIN @V p ON p.Id = a.AncestorId
        WHERE p.Mgr IS NOT NULL
    )
    INSERT INTO @T (AncestorId, PersonId, ChildId, Depth, NoManager)
    SELECT v.Id, v.Id, v.Id, 0, v.NoManager FROM @V v
    UNION ALL
    SELECT a.AncestorId, a.PersonId, a.ChildId, a.Depth, v.NoManager
    FROM A a JOIN @V v ON v.Id = a.PersonId;

    RETURN;
END
GO

-- ---------------------------------------------------------------------------
-- 12. sp_NotifyStranded (spec 3.7, plan Ruling 15): for each listed person
--     who holds in-progress work they cannot work, one `stranded_work` notice
--     per module (EntityType 'ticket' / 'lead', EntityId = that person) to
--     their active manager; with no active manager, to everyone whose Office
--     reach or wider on that module covers the person's home office (admins
--     are Company, so they are always in that set). The actor is not told
--     (they get the count on screen). Returns no recordset (it runs inside
--     sp_SaveGroupModules / sp_SaveUser).
--     @UserIdsJson items: a plain id = every module the person is stranded on
--     ([5, 9]); an object = only that module ([{"UserId":5,"Module":"leads"}]),
--     so a caller that knows what just changed sends no duplicate notice.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_NotifyStranded
    @CompId      BIGINT,
    @UserIdsJson NVARCHAR(MAX),
    @ActorUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @CompId IS NULL OR @ActorUserId IS NULL OR ISJSON(@UserIdsJson) <> 1 RETURN;

    DECLARE @W TABLE (UserId INT NOT NULL, Module VARCHAR(30) NOT NULL, N INT NOT NULL,
                      Name VARCHAR(200) NULL, Home BIGINT NULL, Mgr INT NULL,
                      PRIMARY KEY (UserId, Module));
    INSERT INTO @W (UserId, Module, N, Name, Home, Mgr)
    SELECT s.UserId, m.Module, m.N, u.FullName, u.BranchId, mg.Id
    FROM dbo.fn_StrandedWork(@CompId) s
    JOIN dbo.tblUser u ON u.Id = s.UserId AND u.CompId = @CompId
    CROSS APPLY (VALUES ('complaints', s.Complaints), ('leads', s.Leads)) m (Module, N)
    LEFT JOIN dbo.tblUser mg ON mg.Id = u.ReportsTo AND mg.Id <> u.Id AND mg.CompId = @CompId AND mg.IsActive = 1
    WHERE m.N > 0
      AND EXISTS (SELECT 1 FROM OPENJSON(@UserIdsJson) j
                  WHERE (j.type = 2 AND TRY_CAST(j.value AS INT) = s.UserId)
                     OR (j.type = 5 AND TRY_CAST(JSON_VALUE(j.value, '$.UserId') AS INT) = s.UserId
                                    AND JSON_VALUE(j.value, '$.Module') = m.Module));

    IF NOT EXISTS (SELECT 1 FROM @W) RETURN;

    DECLARE @R TABLE (UserId INT NOT NULL, Module VARCHAR(30) NOT NULL, RecipientId INT NOT NULL,
                      PRIMARY KEY (UserId, Module, RecipientId));
    INSERT INTO @R (UserId, Module, RecipientId)
    SELECT UserId, Module, Mgr FROM @W WHERE Mgr IS NOT NULL;

    INSERT INTO @R (UserId, Module, RecipientId)
    SELECT w.UserId, w.Module, c.Id
    FROM @W w
    JOIN dbo.tblUser c ON c.CompId = @CompId AND c.IsActive = 1 AND c.Id <> w.UserId
    CROSS APPLY dbo.fn_AccessScope(@CompId, c.Id, w.Module) sc
    WHERE w.Mgr IS NULL
      AND (   sc.ReachLevel = 5
           OR (sc.ReachLevel >= 3 AND w.Home IS NOT NULL
               AND EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, c.Id) o
                           WHERE o.BranchId = w.Home AND (o.Level = 3 OR sc.ReachLevel >= 4))));

    INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
    SELECT r.RecipientId, 'stranded_work',
           CASE w.Module WHEN 'leads' THEN 'lead' ELSE 'ticket' END,
           w.UserId, @ActorUserId,
           LEFT(ISNULL(w.Name, 'Someone') + ' holds ' + CAST(w.N AS VARCHAR(10)) + ' open '
                + CASE w.Module WHEN 'leads' THEN CASE WHEN w.N = 1 THEN 'lead' ELSE 'leads' END
                                ELSE CASE WHEN w.N = 1 THEN 'complaint' ELSE 'complaints' END END
                + ' they can no longer open', 200),
           NULL, @CompId, COALESCE(w.Home, rc.BranchId, 0)
    FROM @R r
    JOIN @W w ON w.UserId = r.UserId AND w.Module = r.Module
    JOIN dbo.tblUser rc ON rc.Id = r.RecipientId
    WHERE r.RecipientId <> @ActorUserId
      AND NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                      WHERE np.UserId = r.RecipientId AND np.Type = 'stranded_work'
                        AND np.Channel = 'inapp' AND np.IsEnabled = 0);
END
GO

-- ---------------------------------------------------------------------------
-- 13. sp_FetchUserAccess: same four recordsets. RS2 = fn_AccessGrants (gains
--     AssignReach; an admin now gets every module; an inactive person none).
--     RS3 / RS4 (customers, cards, people still read them) come from
--     fn_AccessOffices / fn_AccessPeople, so a "Reports to" loop no longer
--     errors here.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchUserAccess
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Home BIGINT, @IsActive BIT, @Found BIT = 0, @IsAdmin BIT = 0, @Sensitive BIT = 0;

    SELECT @Home = BranchId, @IsActive = IsActive, @Found = 1
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

    -- RS2 modules: the one grant definition.
    SELECT Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach
    FROM dbo.fn_AccessGrants(@CompId, @UserId)
    ORDER BY Module;

    DECLARE @People TABLE (UserId INT PRIMARY KEY);
    INSERT INTO @People (UserId) SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId);
    DECLARE @Off TABLE (BranchId BIGINT PRIMARY KEY, Level TINYINT, CanWrite BIT);
    INSERT INTO @Off (BranchId, Level, CanWrite) SELECT BranchId, Level, CanWrite FROM dbo.fn_AccessOffices(@CompId, @UserId);

    -- RS3 offices per reach.
    SELECT 'Own' AS Reach, @Home AS BranchId, CAST(1 AS BIT) AS CanWrite WHERE @Home IS NOT NULL
    UNION ALL
    SELECT 'Team', BranchId, CAST(1 AS BIT) FROM (
        SELECT @Home AS BranchId WHERE @Home IS NOT NULL
        UNION SELECT u.BranchId FROM @People p JOIN dbo.tblUser u ON u.Id = p.UserId WHERE u.BranchId IS NOT NULL) x
    UNION ALL
    SELECT 'Office', BranchId, CanWrite FROM @Off WHERE Level = 3
    UNION ALL
    SELECT 'OfficeTree', BranchId, CanWrite FROM @Off
    UNION ALL
    -- Inactive offices are included on purpose: old records there stay visible.
    SELECT 'Company', b.Id, CAST(1 AS BIT) FROM dbo.tblBranch b WHERE b.Id IS NOT NULL;

    -- RS4 the Team owner list (self included).
    SELECT @UserId AS OwnerId WHERE @Found = 1
    UNION
    SELECT UserId FROM @People;
END
GO

-- ---------------------------------------------------------------------------
-- 14. Role grid read / write.
-- ---------------------------------------------------------------------------
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
    SELECT Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach
    FROM dbo.tblGroupModule WHERE GroupId = @GroupId ORDER BY Module;
END
GO

-- AssignReach per item: stored only on leads / complaints; when an item
-- carries none (an old client) the stored value is kept, else Team. After the
-- save, members newly stranded (a count that went up) are told about through
-- sp_NotifyStranded, all in one transaction. Status row gains StrandedCount;
-- RS2 lists those people with their current counts.
-- ('cards' joins the reach modules: its CHECK demands a Reach, so the old text
-- refused any role carrying cards.)
CREATE OR ALTER PROC dbo.sp_SaveGroupModules
    @GroupId         INT,
    @CompId          BIGINT,
    @ModulesJson     NVARCHAR(MAX),
    @CanSeeSensitive BIT = 0,
    @UserId          INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @UserId IS NULL
    BEGIN SELECT @GroupId AS Id, 403 AS ResponseCode, 'You do not have permission for this action' AS ResponseMess, 0 AS StrandedCount; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Id = @GroupId AND CompId = @CompId)
    BEGIN SELECT @GroupId AS Id, 404 AS ResponseCode, 'Role not found' AS ResponseMess, 0 AS StrandedCount; RETURN; END
    IF ISJSON(@ModulesJson) <> 1
    BEGIN SELECT @GroupId AS Id, 400 AS ResponseCode, 'Modules must be a JSON array' AS ResponseMess, 0 AS StrandedCount; RETURN; END

    DECLARE @In TABLE (Module VARCHAR(30) PRIMARY KEY, V BIT, A BIT, E BIT, D BIT, Reach VARCHAR(12), AssignReach VARCHAR(12));
    DECLARE @Members TABLE (UserId INT PRIMARY KEY);
    DECLARE @Before TABLE (UserId INT PRIMARY KEY, Leads INT, Complaints INT);
    DECLARE @New TABLE (UserId INT PRIMARY KEY, Leads INT, Complaints INT, NewLeads BIT, NewComplaints BIT);
    DECLARE @Ids NVARCHAR(MAX);

    BEGIN TRY
        -- Parsed inside the TRY, and de-duplicated per module, so a bad payload is a 400, not a raw 500.
        INSERT INTO @In
        SELECT Module, MAX(CAST(ISNULL(CanView,0) AS INT)), MAX(CAST(ISNULL(CanAdd,0) AS INT)),
               MAX(CAST(ISNULL(CanEdit,0) AS INT)), MAX(CAST(ISNULL(CanDelete,0) AS INT)),
               MAX(NULLIF(Reach, '')), MAX(NULLIF(AssignReach, ''))
        FROM OPENJSON(@ModulesJson) WITH (Module VARCHAR(30), CanView BIT, CanAdd BIT, CanEdit BIT, CanDelete BIT,
                                          Reach VARCHAR(12), AssignReach VARCHAR(12))
        WHERE Module IS NOT NULL
        GROUP BY Module;

        -- Any right implies view; no view = no row.
        UPDATE @In SET V = 1 WHERE A = 1 OR E = 1 OR D = 1;
        DELETE FROM @In WHERE V = 0;
        -- Reach modules default to Own; others carry none.
        UPDATE @In SET Reach = ISNULL(Reach, 'Own') WHERE Module IN ('leads','complaints','customers','people','attendance','cards');
        UPDATE @In SET Reach = NULL WHERE Module NOT IN ('leads','complaints','customers','people','attendance','cards');
        -- "Can assign to": leads / complaints only; missing = keep the stored value, else Team.
        UPDATE @In SET AssignReach = NULL WHERE Module NOT IN ('leads','complaints');
        UPDATE i SET AssignReach = COALESCE(i.AssignReach, gm.AssignReach, 'Team')
        FROM @In i
        LEFT JOIN dbo.tblGroupModule gm ON gm.GroupId = @GroupId AND gm.Module = i.Module
        WHERE i.Module IN ('leads','complaints');

        BEGIN TRAN;
        -- "before" is read inside the transaction, so a concurrent change cannot slip between it and the save.
        INSERT INTO @Members (UserId) SELECT DISTINCT UserId FROM dbo.tblUserGroupMap WHERE GroupId = @GroupId;
        INSERT INTO @Before (UserId, Leads, Complaints)
        SELECT s.UserId, s.Leads, s.Complaints
        FROM dbo.fn_StrandedWork(@CompId) s JOIN @Members m ON m.UserId = s.UserId;

        DELETE FROM dbo.tblGroupModule WHERE GroupId = @GroupId;
        INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach)
        SELECT @GroupId, Module, V, A, E, D, Reach, AssignReach FROM @In;
        UPDATE dbo.tblUserGroups SET CanSeeSensitive = ISNULL(@CanSeeSensitive, 0) WHERE Id = @GroupId;

        INSERT INTO @New (UserId, Leads, Complaints, NewLeads, NewComplaints)
        SELECT s.UserId, s.Leads, s.Complaints,
               CASE WHEN s.Leads      > ISNULL(b.Leads, 0)      THEN 1 ELSE 0 END,
               CASE WHEN s.Complaints > ISNULL(b.Complaints, 0) THEN 1 ELSE 0 END
        FROM dbo.fn_StrandedWork(@CompId) s
        JOIN @Members m ON m.UserId = s.UserId
        LEFT JOIN @Before b ON b.UserId = s.UserId
        WHERE s.Leads > ISNULL(b.Leads, 0) OR s.Complaints > ISNULL(b.Complaints, 0);

        IF EXISTS (SELECT 1 FROM @New)
        BEGIN
            -- only the module(s) that just became stranded: [{"UserId":5,"Module":"leads"}, ...]
            SET @Ids = (SELECT x.UserId, x.Module FROM (
                            SELECT UserId, 'leads' AS Module FROM @New WHERE NewLeads = 1
                            UNION ALL
                            SELECT UserId, 'complaints' FROM @New WHERE NewComplaints = 1) x
                        FOR JSON PATH);
            EXEC dbo.sp_NotifyStranded @CompId = @CompId, @UserIdsJson = @Ids, @ActorUserId = @UserId;
        END
        COMMIT;

        SELECT @GroupId AS Id, 200 AS ResponseCode, 'Role permissions saved' AS ResponseMess,
               (SELECT COUNT(*) FROM @New) AS StrandedCount;
        SELECT n.UserId, u.FullName, n.Leads, n.Complaints
        FROM @New n JOIN dbo.tblUser u ON u.Id = n.UserId
        ORDER BY u.FullName;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        -- 547 = the CHECK constraints (unknown module / bad reach); 245/2628/8114/8152 = unparseable or oversize values.
        SELECT @GroupId AS Id,
               CASE WHEN ERROR_NUMBER() IN (547, 245, 2628, 8114, 8152) THEN 400 ELSE 500 END AS ResponseCode,
               CASE WHEN ERROR_NUMBER() IN (547, 245, 2628, 8114, 8152) THEN 'Unknown module or reach' ELSE ERROR_MESSAGE() END AS ResponseMess,
               0 AS StrandedCount;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 15. sp_FetchAssignableUsers: Rule 2 from fn_AssignableUsers; a name, a job
--     title, an office, and "Away today" (D25: a full-day leave mark today, or
--     a holiday today for the home office or company-wide). Nothing else of
--     the person. @TargetUserId = only that row, if allowed ("may I assign this
--     record to that person"). Ordered GroupRank, FullName. No paging.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchAssignableUsers
    @CompId       BIGINT,
    @UserId       INT,
    @Module       VARCHAR(30),
    @RecordId     INT,
    @TargetUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATE = CAST(GETDATE() AS DATE);

    SELECT u.Id, u.FullName, u.Avatar, u.JobTitle, u.BranchId, b.BranchName, u.ReportsTo,
           a.GroupRank, a.IsGiver,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.tblUserDayMark d
                                  WHERE d.CompId = @CompId AND d.UserId = u.Id AND d.WorkDate = @Today
                                    AND d.Kind = 'leave' AND d.Part = 'full')
                       OR EXISTS (SELECT 1 FROM dbo.tblHoliday h
                                  WHERE h.CompId = @CompId AND h.HolidayDate = @Today
                                    AND (h.BranchId IS NULL OR h.BranchId = u.BranchId))
                     THEN 1 ELSE 0 END AS BIT) AS AwayToday,
           200 AS ResponseCode, 'Assignable users retrieved successfully' AS ResponseMess
    FROM dbo.fn_AssignableUsers(@CompId, @UserId, @Module, @RecordId) a
    JOIN dbo.tblUser u ON u.Id = a.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = u.BranchId
    WHERE @TargetUserId IS NULL OR a.Id = @TargetUserId
    ORDER BY a.GroupRank, u.FullName;
END
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- Verify after apply. Run each block on its own; each prints PASS n / FAIL n.
-- Blocks that change data run inside BEGIN TRAN ... ROLLBACK. User ids are
-- TestCRM's (company 1); on another database pick users of the same kind.
--
-- 1. Fail closed: inactive, unknown, NULL, and a user without the module
--    -> 0 rows each.
-- DECLARE @inactive INT = (SELECT TOP 1 Id FROM dbo.tblUser WHERE CompId = 1 AND IsActive = 0 ORDER BY Id);
-- SELECT CASE WHEN (SELECT COUNT(*) FROM dbo.fn_AccessScope(1, @inactive, 'leads')) = 0
--              AND (SELECT COUNT(*) FROM dbo.fn_AccessScope(1, 2147483647, 'leads')) = 0
--              AND (SELECT COUNT(*) FROM dbo.fn_AccessScope(1, NULL, 'leads')) = 0
--              AND (SELECT COUNT(*) FROM dbo.fn_AccessScope(1, 82, 'leads')) = 0      -- pooja.joshi, Support Agent
--              AND (SELECT COUNT(*) FROM dbo.fn_VisibleLeads(1, NULL)) = 0
--              AND (SELECT COUNT(*) FROM dbo.fn_VisibleTickets(1, @inactive)) = 0
--              AND (SELECT COUNT(*) FROM dbo.fn_AssignableUsers(1, NULL, 'leads', NULL)) = 0
--              AND (SELECT COUNT(*) FROM dbo.fn_ReportTree(1, NULL)) = 0
--         THEN 'PASS 1' ELSE 'FAIL 1' END;
--
-- 2. fn_AccessGrants equals an aggregate built straight from the group tables
--    (pre-flight S5), EXCEPT both ways -> 0 / 0; and the admin module list
--    has as many modules as CK_tblGroupModule_Module names.
-- ;WITH ug AS (
--     SELECT u.Id AS UserId, u.CompId, g.Id AS GroupId, g.IsAdmin
--     FROM dbo.tblUser u
--     JOIN dbo.tblUserGroupMap m ON m.UserId = u.Id
--     JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = u.CompId
--     WHERE u.IsActive = 1),
-- adm AS (SELECT DISTINCT UserId FROM ug WHERE IsAdmin = 1),
-- want AS (
--     SELECT ug.UserId, gm.Module,
--            MAX(CAST(gm.CanView AS INT)) AS V, MAX(CAST(gm.CanAdd AS INT)) AS A,
--            MAX(CAST(gm.CanEdit AS INT)) AS E, MAX(CAST(gm.CanDelete AS INT)) AS D,
--            MAX(CHARINDEX('|' + gm.Reach + '|', '|Own|Team|Office|OfficeTree|Company|')) AS R,
--            MAX(CASE WHEN gm.Module IN ('leads','complaints')
--                     THEN CHARINDEX('|' + ISNULL(gm.AssignReach, 'Team') + '|', '|Own|Team|Office|OfficeTree|Company|') END) AS AL
--     FROM ug JOIN dbo.tblGroupModule gm ON gm.GroupId = ug.GroupId AND gm.CanView = 1
--     WHERE ug.UserId NOT IN (SELECT UserId FROM adm)
--     GROUP BY ug.UserId, gm.Module
--     UNION ALL
--     SELECT a.UserId, c.Module, 1, 1, 1, 1, 0, 0 FROM adm a
--     CROSS JOIN (VALUES ('leads'),('sales_reports'),('complaints'),('support_reports'),('customers'),('people'),
--                        ('tasks'),('teams'),('projects'),('settings'),('dashboard'),('attendance'),('partners'),('cards')) c (Module)),
-- got AS (
--     SELECT u.Id AS UserId, g.Module, CAST(g.CanView AS INT) AS V, CAST(g.CanAdd AS INT) AS A,
--            CAST(g.CanEdit AS INT) AS E, CAST(g.CanDelete AS INT) AS D,
--            CASE WHEN u.Id IN (SELECT UserId FROM adm) THEN 0 ELSE CHARINDEX('|' + g.Reach + '|', '|Own|Team|Office|OfficeTree|Company|') END AS R,
--            CASE WHEN u.Id IN (SELECT UserId FROM adm) THEN 0 ELSE CHARINDEX('|' + g.AssignReach + '|', '|Own|Team|Office|OfficeTree|Company|') END AS AL
--     FROM dbo.tblUser u CROSS APPLY dbo.fn_AccessGrants(u.CompId, u.Id) g
--     WHERE u.IsActive = 1)
-- SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT * FROM want EXCEPT SELECT * FROM got) x) = 0
--              AND (SELECT COUNT(*) FROM (SELECT * FROM got EXCEPT SELECT * FROM want) y) = 0
--              AND NOT EXISTS (SELECT 1 FROM dbo.tblUser u CROSS APPLY dbo.fn_AccessGrants(u.CompId, u.Id) g
--                              WHERE u.Id IN (SELECT UserId FROM adm) AND (g.Reach <> 'Company' OR g.AssignReach <> 'Company'))
--              AND (SELECT (LEN(definition) - LEN(REPLACE(definition, '[Module]=', ''))) / 9
--                   FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Module') = 14
--         THEN 'PASS 2' ELSE 'FAIL 2' END;
--
-- 3. "Reports to" loop: two leaf users report to each other -> each has
--    exactly 1 person, the calls return, the tree is built, and one of them
--    still sees every lead they hold.
-- BEGIN TRAN;
-- DECLARE @a INT = 17, @b INT = 18;   -- se_ho_amit, se_ho_sara (nobody reports to them)
-- UPDATE dbo.tblUser SET ReportsTo = @b WHERE Id = @a;
-- UPDATE dbo.tblUser SET ReportsTo = @a WHERE Id = @b;
-- SELECT CASE WHEN (SELECT COUNT(*) FROM dbo.fn_AccessPeople(1, @a)) = 1
--              AND (SELECT COUNT(*) FROM dbo.fn_AccessPeople(1, @b)) = 1
--              AND (SELECT COUNT(*) FROM dbo.fn_ReportTree(1, @a)) >= 1
--              AND NOT EXISTS (SELECT Id FROM dbo.tblLeads WHERE CompId = 1 AND OwnerId = @a
--                              EXCEPT SELECT LeadId FROM dbo.fn_VisibleLeads(1, @a))
--         THEN 'PASS 3' ELSE 'FAIL 3' END;
-- ROLLBACK;
--
-- 4. Two roles: a Support Agent gets a second group whose complaints row is
--    Reach Office, AssignReach NULL -> Reach Office, AssignReach Office.
-- BEGIN TRAN;
-- DECLARE @g TABLE (Id INT);
-- INSERT INTO dbo.tblUserGroups (Name, Description, IsActive, CompId, BranchId, HierarchyLevel, DataScope, IsAdmin, CanSeeSensitive)
-- OUTPUT inserted.Id INTO @g VALUES ('zz verify 131', NULL, 1, 1, 1, 9, 'Own', 0, 0);
-- INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach)
-- SELECT Id, 'complaints', 1, 0, 0, 0, 'Office', NULL FROM @g;
-- INSERT INTO dbo.tblUserGroupMap (UserId, GroupId) SELECT 82, Id FROM @g;   -- pooja.joshi
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.fn_AccessScope(1, 82, 'complaints')
--                          WHERE Reach = 'Office' AND AssignReach = 'Office' AND CanEdit = 1)
--         THEN 'PASS 4' ELSE 'FAIL 4' END;
-- ROLLBACK;
--
-- 5. No home office: tickets = exactly what they hold (or is escalated to
--    them, open); assign list = self, manager, people only.
-- BEGIN TRAN;
-- UPDATE dbo.tblUser SET BranchId = NULL WHERE Id = 82;    -- pooja.joshi, Own, Can assign to Office
-- SELECT CASE WHEN NOT EXISTS (
--                 (SELECT TicketId FROM dbo.fn_VisibleTickets(1, 82)
--                  EXCEPT SELECT t.Id FROM dbo.tblTicket t JOIN dbo.tblLookup s ON s.Id = t.StatusId
--                         WHERE t.CompId = 1 AND (COALESCE(t.AssignedTo, CASE WHEN t.LoggerHolds = 1 THEN t.CreatedBy END) = 82
--                                                 OR (t.EscalatedTo = 82 AND s.Code IN ('open','onhold'))))
--                 UNION ALL
--                 (SELECT t.Id FROM dbo.tblTicket t WHERE t.CompId = 1
--                    AND COALESCE(t.AssignedTo, CASE WHEN t.LoggerHolds = 1 THEN t.CreatedBy END) = 82
--                  EXCEPT SELECT TicketId FROM dbo.fn_VisibleTickets(1, 82)))
--              AND EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(1, 82, 'complaints', NULL) WHERE Id = 82)
--              AND NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(1, 82, 'complaints', NULL) a
--                              WHERE a.Id <> 82 AND a.Id <> ISNULL((SELECT ReportsTo FROM dbo.tblUser WHERE Id = 82), -1)
--                                AND a.Id NOT IN (SELECT UserId FROM dbo.fn_AccessPeople(1, 82)))
--         THEN 'PASS 5' ELSE 'FAIL 5' END;
-- ROLLBACK;
--
-- 6. The assign list never offers an inactive person or one who cannot work
--    the module (checked from the group tables), over every active caller
--    -> 0.
-- SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS 6' ELSE 'FAIL 6' END
-- FROM dbo.tblUser c
-- CROSS JOIN (VALUES ('leads'), ('complaints')) mo (Module)
-- CROSS APPLY dbo.fn_AssignableUsers(c.CompId, c.Id, mo.Module, NULL) a
-- JOIN dbo.tblUser u ON u.Id = a.Id
-- WHERE c.IsActive = 1
--   AND (   ISNULL(u.IsActive, 0) = 0 OR u.CompId <> c.CompId
--        OR NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m
--                       JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = u.CompId
--                       LEFT JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id AND gm.Module = mo.Module
--                                                      AND gm.CanView = 1 AND gm.CanEdit = 1
--                       WHERE m.UserId = u.Id AND (g.IsAdmin = 1 OR gm.Id IS NOT NULL)));
--
-- 7. A read-only extra office does not open the assign list: bm_se_vikram
--    (home 2, Can assign to Office) gets a read-only grant on office 3 ->
--    nobody based in 3 unless linked by "Reports to"; with CanWrite = 1 the
--    office-3 people appear (positive control).
-- BEGIN TRAN;
-- INSERT INTO dbo.tblUserBranchAccess (UserId, BranchId, CanRead, CanWrite, CompId, CreatedBy, CreatedDate)
-- VALUES (20, 3, 1, 0, 1, 1, GETDATE());
-- DECLARE @ro INT = (SELECT COUNT(*) FROM dbo.fn_AssignableUsers(1, 20, 'complaints', NULL) a
--                    JOIN dbo.tblUser u ON u.Id = a.Id
--                    WHERE u.BranchId = 3 AND a.Id <> ISNULL((SELECT ReportsTo FROM dbo.tblUser WHERE Id = 20), -1)
--                      AND a.Id NOT IN (SELECT UserId FROM dbo.fn_AccessPeople(1, 20)));
-- UPDATE dbo.tblUserBranchAccess SET CanWrite = 1 WHERE UserId = 20 AND BranchId = 3;
-- DECLARE @rw INT = (SELECT COUNT(*) FROM dbo.fn_AssignableUsers(1, 20, 'complaints', NULL) a
--                    JOIN dbo.tblUser u ON u.Id = a.Id WHERE u.BranchId = 3);
-- SELECT CASE WHEN @ro = 0 AND @rw > 0 THEN 'PASS 7' ELSE 'FAIL 7' END;
-- ROLLBACK;
--
-- 8. Rule b ends with the complaint: escalated to an Own-reach agent who does
--    not hold it -> visible while open, not once resolved.
-- BEGIN TRAN;
-- DECLARE @t INT = (SELECT TOP 1 Id FROM dbo.tblTicket WHERE CompId = 1 AND ISNULL(AssignedTo, 0) <> 85
--                   AND NOT (LoggerHolds = 1 AND CreatedBy = 85) ORDER BY Id);    -- imran.khan, Support Agent
-- UPDATE dbo.tblTicket SET EscalatedTo = 85,
--        StatusId = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = 1 AND Kind = 'ticket_status' AND Code = 'open')
-- WHERE Id = @t;
-- DECLARE @open BIT = CASE WHEN @t IN (SELECT TicketId FROM dbo.fn_VisibleTickets(1, 85)) THEN 1 ELSE 0 END;
-- UPDATE dbo.tblTicket SET StatusId = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = 1 AND Kind = 'ticket_status' AND Code = 'resolved')
-- WHERE Id = @t;
-- SELECT CASE WHEN @open = 1 AND @t NOT IN (SELECT TicketId FROM dbo.fn_VisibleTickets(1, 85))
--         THEN 'PASS 8' ELSE 'FAIL 8' END;
-- ROLLBACK;
--
-- 9. fn_RecordActions: an Own-reach agent on a resolved complaint they hold
--    -> CanReassign 0, CanReopen 0; the Support Head (Company) -> 1, 1;
--    an invisible record -> no row.
-- BEGIN TRAN;
-- DECLARE @t9 INT = (SELECT TOP 1 Id FROM dbo.tblTicket WHERE CompId = 1 AND AssignedTo = 82 ORDER BY Id);
-- UPDATE dbo.tblTicket SET StatusId = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = 1 AND Kind = 'ticket_status' AND Code = 'resolved')
-- WHERE Id = @t9;
-- DECLARE @other INT = (SELECT TOP 1 Id FROM dbo.tblTicket WHERE CompId = 1 AND Id NOT IN (SELECT TicketId FROM dbo.fn_VisibleTickets(1, 82)));
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.fn_RecordActions(1, 82, 'complaints', @t9) WHERE CanReassign = 0 AND CanReopen = 0 AND InProgress = 0)
--              AND EXISTS (SELECT 1 FROM dbo.fn_RecordActions(1, 75, 'complaints', @t9) WHERE CanReassign = 1 AND CanReopen = 1)
--              AND NOT EXISTS (SELECT 1 FROM dbo.fn_RecordActions(1, 82, 'complaints', @other))
--         THEN 'PASS 9' ELSE 'FAIL 9' END;
-- ROLLBACK;
--
-- 10. N1a: the person parameter has no default (error 201 when left out).
-- BEGIN TRY EXEC dbo.sp_FetchAssignableUsers @CompId = 1, @Module = 'leads', @RecordId = NULL, @TargetUserId = NULL; PRINT 'FAIL 10a'; END TRY
-- BEGIN CATCH PRINT CASE WHEN ERROR_NUMBER() = 201 THEN 'PASS 10a' ELSE 'FAIL 10a' END; END CATCH;
-- BEGIN TRY EXEC dbo.sp_SaveGroupModules @GroupId = 0, @CompId = 1, @ModulesJson = '[]'; PRINT 'FAIL 10b'; END TRY
-- BEGIN CATCH PRINT CASE WHEN ERROR_NUMBER() = 201 THEN 'PASS 10b' ELSE 'FAIL 10b' END; END CATCH;
-- BEGIN TRY EXEC dbo.sp_NotifyStranded @CompId = 1, @UserIdsJson = '[]'; PRINT 'FAIL 10c'; END TRY
-- BEGIN CATCH PRINT CASE WHEN ERROR_NUMBER() = 201 THEN 'PASS 10c' ELSE 'FAIL 10c' END; END CATCH;
--
-- 11. Stranded work: every row is a holder without View + Edit (group tables)
--     -> 0 (both modules of every row); and the role save tells the manager:
--     move the Support Agent role off complaints inside a transaction ->
--     StrandedCount 4, one complaints stranded_work notice per agent to
--     vikram.rao (75), and no leads notice.
-- SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS 11a' ELSE 'FAIL 11a' END
-- FROM dbo.fn_StrandedWork(1) s
-- CROSS APPLY (VALUES ('leads', s.Leads), ('complaints', s.Complaints)) mo (Module, N)
-- WHERE mo.N > 0
--   AND EXISTS (SELECT 1 FROM dbo.tblUser u
--               JOIN dbo.tblUserGroupMap m ON m.UserId = u.Id
--               JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = 1
--               LEFT JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id AND gm.CanView = 1 AND gm.CanEdit = 1
--                                              AND gm.Module = mo.Module
--               WHERE u.Id = s.UserId AND u.IsActive = 1 AND (g.IsAdmin = 1 OR gm.Id IS NOT NULL));
-- BEGIN TRAN;
-- DECLARE @grp INT = (SELECT TOP 1 m.GroupId FROM dbo.tblUserGroupMap m JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
--                     WHERE m.UserId = 82 AND g.Name = 'Support Agent');
-- DECLARE @before INT = (SELECT COUNT(*) FROM dbo.tblNotifications WHERE UserId = 75 AND Type = 'stranded_work');
-- DECLARE @json NVARCHAR(MAX) = (SELECT Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach
--                                FROM dbo.tblGroupModule WHERE GroupId = @grp AND Module <> 'complaints' FOR JSON PATH);
-- EXEC dbo.sp_SaveGroupModules @GroupId = @grp, @CompId = 1, @ModulesJson = @json, @CanSeeSensitive = 0, @UserId = 2;
--   -- TestCRM: RS1 StrandedCount 4; RS2 pooja.joshi 0/3, sandeep.kumar 0/1, ananya.das 0/1, imran.khan 0/3
-- SELECT CASE WHEN (SELECT COUNT(*) FROM dbo.tblNotifications WHERE UserId = 75 AND Type = 'stranded_work') = @before + 4
--              AND NOT EXISTS (SELECT 1 FROM dbo.tblNotifications WHERE UserId = 75 AND Type = 'stranded_work'
--                              AND EntityType = 'lead' AND ActorUserId = 2 AND CreatedDate >= DATEADD(MINUTE, -1, GETDATE()))
--         THEN 'PASS 11b' ELSE 'FAIL 11b' END;
-- ROLLBACK;
--
-- 12. The objects exist, and sp_CheckRecordAccess does not (pre-flight S8)
--     -> 17 / 0.
-- SELECT COUNT(*) FROM sys.objects WHERE name IN ('fn_AccessGrants','fn_AccessScope','fn_AccessPeople','fn_AccessOffices',
--   'fn_RecordGiver','fn_VisibleLeads','fn_VisibleTickets','fn_VisibleFollowUps','fn_AssignableUsers','fn_RecordActions',
--   'fn_StrandedWork','fn_ReportTree','sp_NotifyStranded','sp_FetchUserAccess','sp_FetchGroupModules','sp_SaveGroupModules',
--   'sp_FetchAssignableUsers');
-- SELECT COUNT(*) FROM sys.objects WHERE name = 'sp_CheckRecordAccess';
--
-- Expected counts (TestCRM dry run 2026-11-22, LoggerHolds as 130 sets it):
--   fn_VisibleLeads   se_ho_amit (Own) 179 | tl_ho_neha (Team) 264 |
--                     bm_ho_rahul (Office) 469 | rm_arjun (OfficeTree) 703 |
--                     sh_priya (Company) 833
--   fn_VisibleTickets pooja.joshi (Own) 4 | bm_ho_rahul (Office) 74 |
--                     rm_arjun (OfficeTree) 159 | vikram.rao (Company) 159
--   fn_StrandedWork(1): one row, se_ho_amit (17) Leads 0, Complaints 21.
--   Old rule vs new: the only difference is tl_ho_neha +5 leads (623-627,
--   never assigned, logged by se_ho_amit) = spec 13 bucket "+ never-assigned
--   records logged by one of your people".
-- ===========================================================================
