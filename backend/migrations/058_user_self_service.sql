-- 058_user_self_service.sql
-- ============================================================================
-- User self-service profile + multi-identifier login.
--
-- Adds: Mobile + Avatar columns; global-unique guards on the three login keys
-- (Username / Email / Mobile); one self-service write SP (name + avatar +
-- optional password); a light company user directory for client-side avatars;
-- and multi-identifier login (username OR email OR mobile).
--
-- Display name = the existing FullName (now user-editable) — no new column, so
-- names keep propagating to every feed for free. Username stays admin-only.
--
-- Idempotent where practical (IF NOT EXISTS guards on columns/indexes; ALTERs
-- for procs). Data verified clean before writing: 4 users, emails unique, no
-- duplicate usernames, Mobile is new (all NULL) — so the unique indexes apply
-- without conflict.
-- ============================================================================
USE [eCRM+];
GO

-- 1) Columns ------------------------------------------------------------------
IF COL_LENGTH('dbo.tblUser', 'Mobile') IS NULL
    ALTER TABLE dbo.tblUser ADD Mobile VARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.tblUser', 'Avatar') IS NULL
    ALTER TABLE dbo.tblUser ADD Avatar VARCHAR(60) NULL;
GO

-- 2) Unique guards on the login identifiers -----------------------------------
--    Username is NOT NULL and dup-free -> plain unique (blocks admins too).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblUser_Username' AND object_id = OBJECT_ID('dbo.tblUser'))
    CREATE UNIQUE INDEX UX_tblUser_Username ON dbo.tblUser(Username);
GO
--    Email / Mobile are optional -> filtered unique (ignore NULLs).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblUser_Email' AND object_id = OBJECT_ID('dbo.tblUser'))
    CREATE UNIQUE INDEX UX_tblUser_Email ON dbo.tblUser(Email) WHERE Email IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblUser_Mobile' AND object_id = OBJECT_ID('dbo.tblUser'))
    CREATE UNIQUE INDEX UX_tblUser_Mobile ON dbo.tblUser(Mobile) WHERE Mobile IS NOT NULL;
GO

-- 3) sp_ValidateUser — log in with username OR email OR mobile -----------------
--    Param renamed to @identifier; all three are unique so at most one matches.
--    User result set gains Avatar + Mobile (added to every branch for a uniform
--    shape). Menu result set is unchanged.
ALTER PROC dbo.sp_ValidateUser
    @identifier VARCHAR(150)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @UserId INT;
    DECLARE @IsActive BIT;

    SELECT TOP 1 @UserId = Id, @IsActive = IsActive
    FROM tblUser
    WHERE Username = @identifier OR Email = @identifier OR Mobile = @identifier;

    IF @UserId IS NULL
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
    WHERE u.Id = @UserId;

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
    WHERE ugm.UserId = @UserId
      AND m.IsAllowed = 1
      AND ga.CanView = 1
      AND ug.IsActive = 1
    ORDER BY m.ParentId, m.Id;
END
GO

-- 4) sp_SaveUser (admin) — add Mobile; make dup guards GLOBAL (login keys) -----
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

    IF (@Password IS NULL OR LTRIM(RTRIM(@Password)) = '')
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

    -- Login keys are GLOBAL now (not per-company) — a friendly 409 before the
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
               SET Username = @Username, Password = @Password, IsActive = @UserActive,
                   IsAdmin = @IsAdmin, UserIp = @UserIp, AllowDay = @AllowDay,
                   FullName = @FullName, Email = @Email, JobTitle = @JobTitle,
                   HourlyRate = @HourlyRate, Mobile = @Mobile
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

-- 5) sp_FetchUser (admin) — project Mobile + Avatar in every branch -----------
ALTER PROC dbo.sp_FetchUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblUser u
        WHERE u.CompId = @CompId
          AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
          AND (@SearchTerm IS NULL OR
               u.Username LIKE '%' + @SearchTerm + '%' OR
               u.FullName LIKE '%' + @SearchTerm + '%' OR
               u.Email    LIKE '%' + @SearchTerm + '%' OR
               u.Mobile   LIKE '%' + @SearchTerm + '%' OR
               u.JobTitle LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No users found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Users retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            WHERE u.CompId = @CompId
              AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR
                   u.Username LIKE '%' + @SearchTerm + '%' OR
                   u.FullName LIKE '%' + @SearchTerm + '%' OR
                   u.Email    LIKE '%' + @SearchTerm + '%' OR
                   u.Mobile   LIKE '%' + @SearchTerm + '%' OR
                   u.JobTitle LIKE '%' + @SearchTerm + '%')
            ORDER BY u.FullName
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUser
                   WHERE Id = @Id AND CompId = @CompId
                     AND ((@UseScope = 1 AND BranchId IN (SELECT BranchId FROM @BranchIds))
                       OR (@UseScope = 0 AND (@IsAdmin = 1 OR BranchId = @BranchId))))
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'User retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            WHERE u.Id = @Id AND u.CompId = @CompId;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
    END
END
GO

-- 6) sp_UpdateOwnProfile — the ONE self-service write (name + avatar + email
--    + mobile + optional password). Username stays admin-only; email/mobile are
--    login keys, so uniqueness is guarded (friendly 409 before the index).
--    Callers pass the full current-or-new set of profile fields so a password
--    change doesn't wipe email/mobile/avatar.
CREATE OR ALTER PROC dbo.sp_UpdateOwnProfile
    @UserId          INT,
    @FullName        VARCHAR(200),
    @Avatar          VARCHAR(60)  = NULL,
    @Email           VARCHAR(150) = NULL,
    @Mobile          VARCHAR(20)  = NULL,
    @NewPasswordHash VARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF (@FullName IS NULL OR LTRIM(RTRIM(@FullName)) = '')
    BEGIN SELECT 400 AS ResponseCode, 'Display name cannot be blank' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId)
    BEGIN SELECT 404 AS ResponseCode, 'User not found' AS ResponseMess; RETURN; END

    -- Normalize blanks to NULL so filtered-unique indexes ignore them.
    IF (@Email  IS NOT NULL AND LTRIM(RTRIM(@Email))  = '') SET @Email  = NULL;
    IF (@Mobile IS NOT NULL AND LTRIM(RTRIM(@Mobile)) = '') SET @Mobile = NULL;

    IF (@Email IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.tblUser WHERE Email = @Email AND Id <> @UserId))
    BEGIN SELECT 409 AS ResponseCode, 'Email already in use' AS ResponseMess; RETURN; END
    IF (@Mobile IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.tblUser WHERE Mobile = @Mobile AND Id <> @UserId))
    BEGIN SELECT 409 AS ResponseCode, 'Mobile already in use' AS ResponseMess; RETURN; END

    UPDATE dbo.tblUser
       SET FullName = @FullName,
           Avatar   = @Avatar,
           Email    = @Email,
           Mobile   = @Mobile,
           -- Password only when a new hash is supplied; the controller has
           -- already bcrypt-verified the current one.
           Password = CASE WHEN @NewPasswordHash IS NOT NULL AND LEN(@NewPasswordHash) > 0
                           THEN @NewPasswordHash ELSE Password END
     WHERE Id = @UserId;

    SELECT 200 AS ResponseCode, 'Profile updated' AS ResponseMess;
END
GO

-- 7) sp_FetchUserDirectory — light company roster for client-side avatars ------
--    Any authenticated user (company-scoped). Plain rows; controller wraps.
CREATE OR ALTER PROC dbo.sp_FetchUserDirectory
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, FullName, Avatar
    FROM dbo.tblUser
    WHERE CompId = @CompId AND IsActive = 1
    ORDER BY FullName;
END
GO

-- ============================================================================
-- VERIFY AFTER APPLY
-- Expected:
--   cols_ok = 1          (Mobile + Avatar exist)
--   idx_ok  = 3          (the three unique indexes)
--   Profile update: FullName/Avatar changed; password swapped only when a hash
--     is passed; rolled back so nothing persists.
--   Login by email + by mobile both resolve to the same user.
-- ============================================================================
SELECT
  CASE WHEN COL_LENGTH('dbo.tblUser','Mobile') IS NOT NULL
        AND COL_LENGTH('dbo.tblUser','Avatar') IS NOT NULL THEN 1 ELSE 0 END AS cols_ok,
  (SELECT COUNT(*) FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.tblUser')
      AND name IN ('UX_tblUser_Username','UX_tblUser_Email','UX_tblUser_Mobile')) AS idx_ok;

BEGIN TRAN;
    DECLARE @U INT = (SELECT TOP 1 Id FROM dbo.tblUser ORDER BY Id);
    DECLARE @OldPw VARCHAR(500) = (SELECT Password FROM dbo.tblUser WHERE Id = @U);

    -- profile-only (no password) -> name+avatar change, password untouched
    EXEC dbo.sp_UpdateOwnProfile @UserId = @U, @FullName = '__verify_name',
         @Avatar = 'icon:rocket|violet', @NewPasswordHash = NULL;
    SELECT 'profile-only' AS step, FullName, Avatar,
           CASE WHEN Password = @OldPw THEN 'pw-unchanged' ELSE 'pw-CHANGED(!)' END AS pw
      FROM dbo.tblUser WHERE Id = @U;

    -- with password -> password swaps too
    EXEC dbo.sp_UpdateOwnProfile @UserId = @U, @FullName = '__verify_name',
         @Avatar = 'emoji:🚀', @NewPasswordHash = '__new_hash__';
    SELECT 'with-password' AS step,
           CASE WHEN Password = '__new_hash__' THEN 'pw-updated' ELSE 'pw-NOT-updated(!)' END AS pw
      FROM dbo.tblUser WHERE Id = @U;
ROLLBACK TRAN;

-- Multi-identifier login: same user by email and by mobile (if set)
DECLARE @Email VARCHAR(150) = (SELECT TOP 1 Email FROM dbo.tblUser WHERE Email IS NOT NULL ORDER BY Id);
EXEC dbo.sp_ValidateUser @identifier = @Email;   -- expect the matching UserId in row 1
GO
