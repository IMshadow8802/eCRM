-- ============================================================
-- Migration 011 — Drop tblUser.GroupId, canonicalize on tblUserGroupMap
--
-- Backfill check (2026-04-18): all 10 existing users already have a
-- matching row in tblUserGroupMap where ugm.GroupId = u.GroupId.
-- Idempotent safety net included below regardless.
--
-- After this migration:
--   * tblUserGroupMap is the single source of role assignment
--   * sp_FetchUser reads GroupId/GroupName via the map (TOP 1 active)
--   * sp_SaveUser writes role via the map (delete+insert on update)
--   * tblUser.GroupId + FK_tblUser_GroupId are gone
--
-- Run in [eCRM+]. Each DDL is its own GO batch (see 010b lesson —
-- outer transaction + GO behaves badly with cross-batch dependencies).
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) Backfill safety net — copy any missing u.GroupId → tblUserGroupMap
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblUser') AND name = 'GroupId')
BEGIN
    INSERT INTO dbo.tblUserGroupMap (UserId, GroupId)
    SELECT u.Id, u.GroupId
    FROM dbo.tblUser u
    WHERE u.GroupId IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM dbo.tblUserGroupMap m
          WHERE m.UserId = u.Id AND m.GroupId = u.GroupId
      );
END;
GO

-- ============================================================
-- 2) Rewrite sp_FetchUser to read role from tblUserGroupMap
-- ============================================================
IF OBJECT_ID('dbo.sp_FetchUser', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchUser;
GO

CREATE PROC dbo.sp_FetchUser
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
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Users retrieved successfully';
            -- GroupId/GroupName come from the first active mapping (TOP 1).
            -- Multi-role users: the UI still shows one primary group; full
            -- role list is available via /api/user-groups/map when needed.
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate,
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
                   u.JobTitle, u.HourlyRate,
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
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
    END
END
GO

-- ============================================================
-- 3) Rewrite sp_SaveUser to write role via tblUserGroupMap
-- ============================================================
IF OBJECT_ID('dbo.sp_SaveUser', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_SaveUser;
GO

CREATE PROC dbo.sp_SaveUser
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
    @BranchId BIGINT
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

    IF (@GroupId IS NOT NULL AND @GroupId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid group selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END
    ELSE
    BEGIN SET @GroupId = 8; END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND CompId = @CompId)
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            INSERT INTO tblUser
                (Username, Password, IsActive, IsAdmin, UserIp, AllowDay,
                 FullName, Email, JobTitle, HourlyRate, CompId, BranchId)
            VALUES
                (@Username, @Password, @UserActive, @IsAdmin, @UserIp, @AllowDay,
                 @FullName, @Email, @JobTitle, @HourlyRate, @CompId, @BranchId);

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

            IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND Id <> @Id AND CompId = @CompId)
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            UPDATE tblUser
               SET Username = @Username, Password = @Password, IsActive = @UserActive,
                   IsAdmin = @IsAdmin, UserIp = @UserIp, AllowDay = @AllowDay,
                   FullName = @FullName, Email = @Email, JobTitle = @JobTitle,
                   HourlyRate = @HourlyRate
             WHERE Id = @Id AND CompId = @CompId;

            -- Replace-single-role semantics: clear existing map rows, insert new.
            -- Multi-role editing can evolve into a dedicated SP later.
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

-- ============================================================
-- 4) Drop FK + column on tblUser
-- ============================================================
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblUser_GroupId')
    ALTER TABLE dbo.tblUser DROP CONSTRAINT FK_tblUser_GroupId;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblUser') AND name = 'GroupId')
BEGIN
    -- Default constraint (if any) must be dropped first
    DECLARE @df sysname;
    SELECT @df = dc.name
      FROM sys.default_constraints dc
      JOIN sys.columns c ON c.default_object_id = dc.object_id
     WHERE c.object_id = OBJECT_ID('dbo.tblUser') AND c.name = 'GroupId';
    IF @df IS NOT NULL EXEC('ALTER TABLE dbo.tblUser DROP CONSTRAINT ' + @df);

    ALTER TABLE dbo.tblUser DROP COLUMN GroupId;
END;
GO

-- ============================================================
-- 5) Sanity check
-- ============================================================
PRINT '----- migration 011 sanity -----';

SELECT 'tblUser.GroupId (should be gone)' AS chk,
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblUser') AND name='GroupId')
            THEN 'STILL PRESENT' ELSE 'OK' END AS status
UNION ALL
SELECT 'FK_tblUser_GroupId (should be gone)',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_tblUser_GroupId')
            THEN 'STILL PRESENT' ELSE 'OK' END
UNION ALL
SELECT 'sp_FetchUser exists',
       CASE WHEN OBJECT_ID('dbo.sp_FetchUser','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'sp_SaveUser exists',
       CASE WHEN OBJECT_ID('dbo.sp_SaveUser','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'tblUserGroupMap row count',
       CAST(COUNT(*) AS VARCHAR) FROM dbo.tblUserGroupMap;
GO

-- Probe: sp_FetchUser returns GroupId/GroupName for seeded users
PRINT '----- probe: sp_FetchUser (page 1, 3 rows) -----';
EXEC dbo.sp_FetchUser @Id = 0, @CompId = 1, @BranchId = 1, @IsAdmin = 1,
                     @AccessibleBranchIdsJson = NULL, @PageNumber = 1, @PageSize = 3;
GO
