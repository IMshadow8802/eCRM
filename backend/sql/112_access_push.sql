-- 112_access_push.sql — who holds a role, for the realtime `access` push (2026-10-11).
-- When an admin saves a role's module grants (or edits the role), the backend
-- tells every signed-in member to re-read their access, so the sidebar and
-- route gates change without a sign-out. This read-only proc lists the active
-- members of one role, inside one company. No existing proc returns them.
-- Part 2: the two office-access procs return the affected UserId, so the
-- backend can push to that person. The UserId comes from a row checked against
-- @CompId, never from the request body, so a push can never cross companies.
-- Side fix: sp_SaveUserBranchAccess did not check the user (or, on update, the
-- row) belonged to @CompId — another company's admin could grant offices to a
-- user id they guessed. It now 404s.
-- No schema or data change. Idempotent (CREATE OR ALTER).
-- Until it is applied the backend logs "sp_FetchGroupMembers skipped" and the
-- save still succeeds; members then pick the change up on reload / focus.
-- Apply on TestCRM first, then eCRM+ and SolarCRM once checked.
-- Apply: sqlcmd -I -S <server> -d TestCRM -i 112_access_push.sql
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

CREATE OR ALTER PROC dbo.sp_FetchGroupMembers
    @GroupId INT,
    @CompId  BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT DISTINCT u.Id AS UserId
    FROM dbo.tblUserGroupMap ugm
    JOIN dbo.tblUserGroups g ON g.Id = ugm.GroupId AND g.CompId = @CompId
    JOIN dbo.tblUser u       ON u.Id = ugm.UserId  AND u.CompId = @CompId AND u.IsActive = 1
    WHERE ugm.GroupId = @GroupId;
END
GO

CREATE OR ALTER PROC dbo.sp_SaveUserBranchAccess
    @Id        INT,
    @UserId    INT,
    @BranchId  BIGINT,
    @CanRead   BIT,
    @CanWrite  BIT,
    @CompId    BIGINT,
    @CreatedBy INT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF @UserId IS NULL OR @UserId <= 0 OR @BranchId IS NULL OR @BranchId <= 0
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'UserId and BranchId required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- 112: the person must be in the caller's company.
    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @UserId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'User not found' AS ResponseMess; RETURN; END

    IF @Id = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUserBranchAccess WHERE UserId = @UserId AND BranchId = @BranchId)
        BEGIN
            UPDATE tblUserBranchAccess
            SET CanRead = @CanRead, CanWrite = @CanWrite
            WHERE UserId = @UserId AND BranchId = @BranchId;
            SET @Id = (SELECT Id FROM tblUserBranchAccess WHERE UserId = @UserId AND BranchId = @BranchId);
            SET @ResponseCode = 200; SET @ResponseMess = 'Branch access updated';
        END
        ELSE
        BEGIN
            INSERT INTO tblUserBranchAccess (UserId, BranchId, CanRead, CanWrite, CompId, CreatedBy)
            VALUES (@UserId, @BranchId, @CanRead, @CanWrite, @CompId, @CreatedBy);
            SET @Id = SCOPE_IDENTITY();
            SET @ResponseCode = 201; SET @ResponseMess = 'Branch access granted';
        END
    END
    ELSE
    BEGIN
        -- 112: the row must be this company's; the push goes to its owner.
        DECLARE @RowUser INT = (SELECT UserId FROM tblUserBranchAccess WHERE Id = @Id AND CompId = @CompId);
        IF @RowUser IS NULL
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Branch access not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblUserBranchAccess
        SET CanRead = @CanRead, CanWrite = @CanWrite
        WHERE Id = @Id AND CompId = @CompId;
        SET @UserId = @RowUser;

        SET @ResponseCode = 200; SET @ResponseMess = 'Branch access updated';
    END

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS Id, @UserId AS UserId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_DeleteUserBranchAccess
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF (@CompId IS NULL OR @CompId <= 0)
    BEGIN SELECT 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END

    -- Same 404 for "does not exist" and "another company's" (no id oracle).
    DECLARE @UserId INT = (SELECT UserId FROM tblUserBranchAccess WHERE Id = @Id AND CompId = @CompId);
    IF @UserId IS NULL
    BEGIN SELECT 404 AS ResponseCode, 'Branch access not found' AS ResponseMess; RETURN; END

    DELETE FROM tblUserBranchAccess WHERE Id = @Id AND CompId = @CompId;
    SELECT 200 AS ResponseCode, 'Branch access removed' AS ResponseMess, @UserId AS UserId;
END
GO

-- Verify after apply (expect one row per active member of the role):
--   EXEC dbo.sp_FetchGroupMembers @GroupId = <role id>, @CompId = <company id>;
--   SELECT OBJECT_ID('dbo.sp_FetchGroupMembers');   -- not NULL
--   Branch access: save / delete one on a test user; the status row now carries UserId.
--   EXEC dbo.sp_SaveUserBranchAccess 0, <other company's user id>, 1, 1, 0, <CompId>, 1;  -- 404 User not found
