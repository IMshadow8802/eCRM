-- ===========================================================================
-- 140 - assign picker: peers in the top group (2026-11-23, owner-approved).
--
-- Apply by hand, TestCRM FIRST, then eCRM+ and SolarCRM once it is checked:
--   sqlcmd -I -b -f 65001 -S <server> -U <login> -d TestCRM -i 140_assign_picker_peers.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error,
--   -f 65001 = read the file as UTF-8. Needs 130-133 on the same database.
--   Idempotent: one CREATE OR ALTER, a re-run changes nothing.
--
-- What changes (fn_AssignableUsers only; GroupRank only):
--   People who share the caller's ReportsTo (peers; the caller excluded) now
--   get GroupRank 1 ("Your manager and team") instead of 2 / 3. Example: agent
--   Vinod (ReportsTo = Rohit) used to see only Rohit there, his peer Vivek
--   under "Your office"; now both are in the top group.
--   WHO is assignable does not change - the WHERE clause is 131's verbatim,
--   so a peer still has to qualify by reach / Edit right as before.
--   A caller with ReportsTo NULL gets no peers (NULL never equals NULL).
--   Everything else is the 131 text verbatim (139 did not touch this function).
--
-- ROLLBACK (135): saved with sp_AccessModelBackup under ScriptNo 131, the way
-- 139 files its saves under 133. 131 already saved fn_AssignableUsers (first
-- save wins), so this call is a no-op on a database that has 131: the save
-- that counts is the pre-131 one, and 135 -v From=130 or 131 undoes 140 along
-- with 131. 135 -v From=134 keeps 140.
-- To undo 140 ALONE: re-apply 131 (its CREATE OR ALTER puts the 131 text back;
-- 131 is idempotent), then re-run 139 if it was applied.
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse unless 130-133 are applied.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_AccessModelBackup', 'P') IS NULL
   OR OBJECT_ID('dbo.fn_AssignableUsers') IS NULL
   OR OBJECT_ID('dbo.fn_AccessScope') IS NULL
   OR OBJECT_ID('dbo.fn_ReassignGate') IS NULL
BEGIN
    RAISERROR('140: scripts 130-133 are not applied to this database. Apply them first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2. Backup (first save wins; filed under 131, see the header).
-- ---------------------------------------------------------------------------
EXEC dbo.sp_AccessModelBackup 131, 'fn_AssignableUsers';
GO

-- ---------------------------------------------------------------------------
-- 3. fn_AssignableUsers (Rule 2): active, same company, View + Edit on the
--    module (admins always), and: me; my manager; my people; at Office my
--    writable Level-3 offices' people; at OfficeTree also the Level-4 ones;
--    at Company everyone; plus the record's giver when I hold it (IsGiver).
--    GroupRank 1 = me, manager, people, peers (same ReportsTo as me; 140)
--    (and a giver outside the list);
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
                WHEN u.ReportsTo = @Mgr THEN 1      -- a peer (140); @Mgr NULL never matches
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

SET NOEXEC OFF;
GO

-- ===========================================================================
-- VERIFY AFTER APPLY (TestCRM; read-only)
--
-- 1. The new text is live -> 1
-- SELECT CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.fn_AssignableUsers')) LIKE '%a peer (140)%' THEN 1 ELSE 0 END;
--
-- 2. Vinod's complaints picker: Rohit (manager) and Vivek (peer) both GroupRank 1;
--    Vinod himself is 1; nobody new appears (compare the count with a pre-140 run)
-- DECLARE @vinod INT = (SELECT Id FROM dbo.tblUser WHERE CompId = 1 AND FullName LIKE 'Vinod%');
-- SELECT u.FullName, u.ReportsTo, a.GroupRank
-- FROM dbo.fn_AssignableUsers(1, @vinod, 'complaints', NULL) a JOIN dbo.tblUser u ON u.Id = a.Id
-- ORDER BY a.GroupRank, u.FullName;
--
-- 3. A caller with ReportsTo NULL gets no peers: every GroupRank 1 row is
--    themselves or one of their people -> 0 rows
-- DECLARE @top INT = (SELECT TOP 1 Id FROM dbo.tblUser WHERE CompId = 1 AND IsActive = 1 AND ReportsTo IS NULL AND IsAdmin = 1);
-- SELECT a.Id FROM dbo.fn_AssignableUsers(1, @top, 'complaints', NULL) a
-- WHERE a.GroupRank = 1 AND a.Id <> @top
--   AND a.Id NOT IN (SELECT UserId FROM dbo.fn_AccessPeople(1, @top));
--
-- 4. Backup row still the 131 one -> ScriptNo 131
-- SELECT ObjName, ScriptNo FROM dbo.tblAccessModelBackup WHERE ObjName = 'fn_AssignableUsers';
-- ===========================================================================
