-- =============================================================================
-- 059_admin_user_password.sql
--
-- Fixes the admin Users screen (Master > Users) password handling.
--
-- Background: /api/auth/hashPassword used to be a public endpoint that handed
-- admins a bcrypt hash to paste into the Password field, so sp_SaveUser was a
-- deliberate passthrough. That endpoint was removed as a bcrypt oracle in
-- 978885f, and nothing replaced it -- since then the admin screen has written
-- whatever the admin typed straight into tblUser.Password as PLAINTEXT, and
-- login (bcrypt.compare in Node) could never match it. Every user created or
-- edited through the panel since then has been unable to log in.
--
-- The Node side now bcrypt-hashes before calling this SP (userController.save).
-- This script fixes the other half: the SP hard-required a non-blank @Password
-- on UPDATE and always overwrote the column, so "leave empty to keep current"
-- (which the form has always promised) was impossible, and every edit clobbered
-- the stored hash. sp_UpdateOwnProfile (058) already got this right; this
-- brings the admin path in line.
--
-- Changes to sp_SaveUser, both in the ELSE (@Id <> 0 / update) path:
--   1. The blank-password 400 now only fires on INSERT. A new user genuinely
--      needs a password; an edit does not.
--   2. UPDATE sets Password only when a new one was supplied, otherwise keeps
--      the existing hash.
--
-- Nothing else in the proc changes. No data migration needed -- every row in
-- tblUser currently holds a valid $2b$ bcrypt hash.
--
-- Part 2 (below) adds an optional @UserId to sp_ValidateUser. userController
-- .changeMyPassword resolved the caller by req.user.UserName -- a JWT claim
-- minted at login -- so after an admin renamed someone, that claim no longer
-- matched any row and the user got a 401 "Could not verify current user" until
-- they logged out and back in. UserId is the stable key. @UserId defaults to
-- NULL, so the login path (which passes @identifier only) is unchanged.
-- =============================================================================

ALTER PROC dbo.sp_SaveUser
    @Id INT,
    @Username VARCHAR(100),
    @Password VARCHAR(500),
    @UserActive BIT,
    @IsAdmin BIT,
    @UserIp VARCHAR(50),
    @AllowDay INT,
    @FullName VARCHAR(200),
    @Email VARCHAR(150),
    @JobTitle VARCHAR(100),
    @HourlyRate DECIMAL(10,2),
    @GroupId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @Mobile VARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Username IS NULL OR LTRIM(RTRIM(@Username)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Username is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- A new user needs a password. An edit may omit it to keep the current one
    -- (the form has always said "leave empty to keep current" -- now it's true).
    IF (@Id = 0 AND (@Password IS NULL OR LTRIM(RTRIM(@Password)) = ''))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Password is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@FullName IS NULL OR LTRIM(RTRIM(@FullName)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Full name is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Normalize blanks to NULL so filtered-unique indexes ignore them.
    IF (@Mobile IS NOT NULL AND LTRIM(RTRIM(@Mobile)) = '') SET @Mobile = NULL;
    IF (@Email  IS NOT NULL AND LTRIM(RTRIM(@Email))  = '') SET @Email  = NULL;

    IF (@GroupId IS NOT NULL AND @GroupId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid group selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END
    ELSE
    BEGIN SET @GroupId = 8; END

    -- Login keys are GLOBAL now (not per-company) -- a friendly 409 before the
    -- unique index would throw a raw error.
    IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND Id <> @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Email IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Email = @Email AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Email already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Mobile IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Mobile = @Mobile AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Mobile already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO tblUser
                (Username, Password, IsActive, IsAdmin, UserIp, AllowDay,
                 FullName, Email, JobTitle, HourlyRate, Mobile, CompId, BranchId)
            VALUES
                (@Username, @Password, @UserActive, @IsAdmin, @UserIp, @AllowDay,
                 @FullName, @Email, @JobTitle, @HourlyRate, @Mobile, @CompId, @BranchId);

            SET @Id = SCOPE_IDENTITY();

            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            COMMIT TRANSACTION;

            SET @ResponseCode = 201;
            SET @ResponseMess = 'User created successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
        END
        ELSE
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId)
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 404; SET @ResponseMess = 'User not found';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            UPDATE tblUser
               SET Username = @Username, IsActive = @UserActive,
                   IsAdmin = @IsAdmin, UserIp = @UserIp, AllowDay = @AllowDay,
                   FullName = @FullName, Email = @Email, JobTitle = @JobTitle,
                   HourlyRate = @HourlyRate, Mobile = @Mobile,
                   -- Password only when a new hash is supplied; blank means
                   -- "keep current" (same contract as sp_UpdateOwnProfile).
                   Password = CASE WHEN @Password IS NOT NULL AND LEN(@Password) > 0
                                   THEN @Password ELSE Password END
             WHERE Id = @Id AND CompId = @CompId;

            DELETE FROM tblUserGroupMap WHERE UserId = @Id;
            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            COMMIT TRANSACTION;

            SET @ResponseCode = 200;
            SET @ResponseMess = 'User updated successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- =============================================================================
-- Part 2: sp_ValidateUser -- resolve by a stable UserId when one is given.
--
-- Only the lookup at the top changes. @UserId defaults to NULL so the login
-- path (@identifier only) behaves exactly as before; callers that already hold
-- a verified UserId pass it and skip the mutable-identifier match entirely.
-- =============================================================================

ALTER PROC dbo.sp_ValidateUser
    @identifier VARCHAR(150) = NULL,
    @UserId     INT          = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @FoundId INT;
    DECLARE @IsActive BIT;

    -- UserId wins when supplied (self-service callers already authenticated);
    -- otherwise fall back to the three login keys, all of them unique.
    IF (@UserId IS NOT NULL)
        SELECT TOP 1 @FoundId = Id, @IsActive = IsActive
        FROM tblUser WHERE Id = @UserId;
    ELSE
        SELECT TOP 1 @FoundId = Id, @IsActive = IsActive
        FROM tblUser
        WHERE Username = @identifier OR Email = @identifier OR Mobile = @identifier;

    IF @FoundId IS NULL
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Username does not exist';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS Mobile, NULL AS Avatar,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle, NULL AS Route,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
        RETURN;
    END

    IF @IsActive = 0
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Account is inactive';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS Mobile, NULL AS Avatar,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle, NULL AS Route,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
        RETURN;
    END

    SET @ResponseCode = 200;
    SET @ResponseMess = 'User found successfully';

    SELECT @ResponseCode AS ResponseCode,
           @ResponseMess AS ResponseMess,
           u.Id       AS UserId,
           u.Username AS UserName,
           u.Password AS Password,
           u.IsActive AS UserActive,
           u.IsAdmin  AS IsAdmin,
           u.FullName, u.Email, u.JobTitle, u.HourlyRate,
           u.Mobile, u.Avatar,
           u.CompId, u.BranchId,
           'Your Company Name'  AS CompName,
           'Company Address'    AS CompAddress,
           'Company Phone'      AS CompPhone,
           'State'              AS CompState,
           'ST'                 AS CompStateCode,
           'company@email.com'  AS CompEmail,
           'www.company.com'    AS CompWebSite,
           'GSTIN123456789'     AS CompGSTIN
    FROM tblUser u
    WHERE u.Id = @FoundId;

    SELECT DISTINCT
           m.Id          AS MenuId,
           m.ParentId, m.Description, m.Image, m.FormId, m.MenuType, m.ActualId,
           m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, m.Route,
           ga.CanAdd, ga.CanEdit, ga.CanDelete, ga.CanView,
           ug.Name AS GroupName
    FROM tblMenu m
    INNER JOIN tblGroupAccess ga    ON m.Id = ga.MenuId
    INNER JOIN tblUserGroupMap ugm  ON ga.GroupId = ugm.GroupId
    INNER JOIN tblUserGroups ug     ON ugm.GroupId = ug.Id
    WHERE ugm.UserId = @FoundId
      AND m.IsAllowed = 1
      AND ga.CanView = 1
      AND ug.IsActive = 1
    ORDER BY m.ParentId, m.Id;
END
GO

-- =============================================================================
-- Verify after apply
-- =============================================================================
-- 1. The proc now guards the password only on insert, and keeps it on update:
--
-- SELECT CASE WHEN m.definition LIKE '%@Id = 0 AND (@Password IS NULL%'
--              AND m.definition LIKE '%ELSE Password END%'
--             THEN 'OK - 059 applied' ELSE 'NOT APPLIED' END AS Status
-- FROM sys.sql_modules m
-- JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name = 'sp_SaveUser';
--
-- 2. Every stored password is a bcrypt hash (expect all rows 'bcrypt'):
--
-- SELECT Id, Username,
--        CASE WHEN Password LIKE '$2[aby]$%' AND LEN(Password) = 60
--             THEN 'bcrypt' ELSE 'PLAINTEXT - RESET THIS USER' END AS PwdShape
-- FROM tblUser ORDER BY Id;
--
-- 3. Smoke test on a throwaway user -- edit with a blank password must keep the
--    existing hash (run inside a transaction you roll back):
--
-- BEGIN TRAN;
--   DECLARE @before VARCHAR(500) = (SELECT Password FROM tblUser WHERE Id = 3);
--   EXEC sp_SaveUser @Id=3, @Username='Raaj', @Password='', @UserActive=1,
--        @IsAdmin=0, @UserIp='', @AllowDay=0, @FullName='Raaj',
--        @Email='raaj@prdinfotech.in', @JobTitle='', @HourlyRate=0,
--        @GroupId=8, @CompId=1, @BranchId=1, @Mobile='7982613284';
--   SELECT CASE WHEN (SELECT Password FROM tblUser WHERE Id = 3) = @before
--               THEN 'OK - hash preserved' ELSE 'FAIL - hash was overwritten' END AS Result;
-- ROLLBACK TRAN;
--
-- 4. sp_ValidateUser resolves both ways and returns the same row:
--
-- EXEC sp_ValidateUser @identifier = 'Raaj';   -- login path, unchanged
-- EXEC sp_ValidateUser @UserId = 3;            -- new self-service path
-- =============================================================================
