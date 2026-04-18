-- ============================================================
-- Migration 004 — Phase 2 of Workstream C
--
-- Adds @AccessibleBranchIdsJson NVARCHAR(MAX) param to fetch SPs
-- that filter by BranchId. When provided, the SP filters by that
-- JSON array of branch IDs (driven by the API middleware's
-- req.scope.branchIds). When NULL, falls back to the previous
-- single-BranchId behaviour for backward compatibility.
--
-- Scope:
--   • sp_FetchLeads        (per-row BranchId)
--   • sp_FetchProject      (per-row BranchId)
--   • sp_FetchKanbanColumn (per-row BranchId + IsCompanyWide)
--
-- Out of scope (next iteration):
--   • sp_FetchTask — tblTasks has no BranchId; scope flows via the
--     parent project. Needs a small schema decision (denormalize
--     BranchId onto tblTasks vs. always JOIN through tblProjects).
--   • sp_FetchTeam, sp_FetchUser, sp_FetchUserGroup — same multi-
--     branch concept applies; mechanical follow-up.
-- ============================================================

USE [eCRM+]
GO

SET XACT_ABORT ON;
GO

-- ----- sp_FetchLeads (scope-aware) -----
ALTER PROCEDURE [dbo].[sp_FetchLeads]
(
    @Id INT = 0,
    @BranchId INT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(150) = NULL
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    -- Parse scope JSON; NULL → fall back to single-BranchId filter
    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);

    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblLeads l
        WHERE ((@UseScope = 1 AND l.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND l.BranchId = @BranchId))
          AND (@SearchTerm IS NULL OR
               l.CustomerName LIKE '%' + @SearchTerm + '%' OR
               l.MobileNo     LIKE '%' + @SearchTerm + '%' OR
               l.LeadSource   LIKE '%' + @SearchTerm + '%' OR
               l.ProductModel LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No leads found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS LeadDate, NULL AS CustomerName, NULL AS MobileNo,
                   NULL AS LeadSource, NULL AS ProductCategory, NULL AS ProductBrand,
                   NULL AS ProductModel, NULL AS Budget, NULL AS LeadStatus,
                   NULL AS FollowupDate, NULL AS AssignTo, NULL AS AssignedDate,
                   NULL AS BranchId, NULL AS CreatedDate;
            RETURN;
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Leads fetched successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               l.Id, l.LeadDate, l.CustomerName, l.MobileNo, l.AlternateMobile, l.Email,
               l.Address, l.LeadSource, l.ProductCategory, l.ProductBrand,
               l.ProductModel, l.Budget, l.LeadStatus, l.FollowupDate,
               l.Remarks, l.AssignTo, l.AssignedDate,
               l.InvoiceDate, l.InvoiceNo, l.BranchId,
               l.OriginalBranchId, l.TransferredAt, l.TransferredByUserId,
               l.CreatedBy, l.CreatedDate, l.EditBy, l.EditDate
        FROM tblLeads l
        WHERE ((@UseScope = 1 AND l.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND l.BranchId = @BranchId))
          AND (@SearchTerm IS NULL OR
               l.CustomerName LIKE '%' + @SearchTerm + '%' OR
               l.MobileNo     LIKE '%' + @SearchTerm + '%' OR
               l.LeadSource   LIKE '%' + @SearchTerm + '%' OR
               l.ProductModel LIKE '%' + @SearchTerm + '%')
        ORDER BY l.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        RETURN;
    END
    ELSE
    BEGIN
        IF EXISTS (
            SELECT 1 FROM tblLeads
            WHERE Id = @Id
              AND ((@UseScope = 1 AND BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND BranchId = @BranchId))
        )
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Lead fetched successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   l.Id, l.LeadDate, l.CustomerName, l.MobileNo, l.AlternateMobile, l.Email,
                   l.Address, l.LeadSource, l.ProductCategory, l.ProductBrand,
                   l.ProductModel, l.Budget, l.LeadStatus, l.FollowupDate,
                   l.Remarks, l.AssignTo, l.AssignedDate,
                   l.InvoiceDate, l.InvoiceNo, l.BranchId,
                   l.OriginalBranchId, l.TransferredAt, l.TransferredByUserId,
                   l.CreatedBy, l.CreatedDate, l.EditBy, l.EditDate
            FROM tblLeads l
            WHERE l.Id = @Id;
            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Lead not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS LeadDate, NULL AS CustomerName, NULL AS MobileNo,
                   NULL AS LeadSource, NULL AS ProductModel, NULL AS LeadStatus,
                   NULL AS FollowupDate, NULL AS AssignTo, NULL AS AssignedDate,
                   NULL AS BranchId, NULL AS CreatedDate;
            RETURN;
        END
    END
END
GO

-- ----- sp_FetchProject (scope-aware) -----
ALTER PROC sp_FetchProject
    @Id INT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
AS
BEGIN
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
        FROM tblProjects p
        INNER JOIN tblUser u ON p.ManagerUserId = u.Id
        LEFT JOIN tblTeams t ON p.TeamId = t.Id
        LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
        WHERE p.CompId = @CompId
          AND ((@UseScope = 1 AND p.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0))
          AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
               JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
          AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%' OR t.Name LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No projects found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS ManagerUserId,
                   NULL AS TeamId, NULL AS Members, NULL AS Status, NULL AS Priority,
                   NULL AS StartDate, NULL AS EndDate, NULL AS Budget, NULL AS Progress,
                   NULL AS BranchId, NULL AS ManagerName, NULL AS TeamName, NULL AS TaskCount;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Projects retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   p.Id, p.Name, p.Description, p.ManagerUserId, p.TeamId, p.Members,
                   p.Status, p.Priority, p.StartDate, p.EndDate, p.Budget, p.Progress,
                   p.BranchId,
                   u.FullName AS ManagerName, t.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks ts WHERE ts.ProjectId = p.Id) AS TaskCount
            FROM tblProjects p
            INNER JOIN tblUser u ON p.ManagerUserId = u.Id
            LEFT JOIN tblTeams t ON p.TeamId = t.Id
            LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
            WHERE p.CompId = @CompId
              AND ((@UseScope = 1 AND p.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0))
              AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
                   JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
              AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%' OR t.Name LIKE '%' + @SearchTerm + '%')
            ORDER BY p.Name
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (
            SELECT 1 FROM tblProjects p
            LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
            WHERE p.Id = @Id AND p.CompId = @CompId
              AND ((@UseScope = 1 AND p.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0))
              AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
                   JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
        )
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Project retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   p.Id, p.Name, p.Description, p.ManagerUserId, p.TeamId, p.Members,
                   p.Status, p.Priority, p.StartDate, p.EndDate, p.Budget, p.Progress,
                   p.BranchId,
                   u.FullName AS ManagerName, t.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks ts WHERE ts.ProjectId = p.Id) AS TaskCount
            FROM tblProjects p
            INNER JOIN tblUser u ON p.ManagerUserId = u.Id
            LEFT JOIN tblTeams t ON p.TeamId = t.Id
            WHERE p.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Project not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS ManagerUserId,
                   NULL AS TeamId, NULL AS Members, NULL AS Status, NULL AS Priority,
                   NULL AS StartDate, NULL AS EndDate, NULL AS Budget, NULL AS Progress,
                   NULL AS BranchId, NULL AS ManagerName, NULL AS TeamName, NULL AS TaskCount;
        END
    END
END
GO

-- ----- sp_FetchKanbanColumn (scope + IsCompanyWide hybrid) -----
ALTER PROC [dbo].[sp_FetchKanbanColumn]
    @Id INT = 0,
    @ProjectId INT = NULL,
    @CompId INT,
    @BranchId INT,
    @IsAdmin BIT = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    BEGIN TRY
        IF (@CompId IS NULL OR @CompId <= 0)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Company ID is required';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        IF (@BranchId IS NULL OR @BranchId <= 0)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Branch ID is required';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        DECLARE @BranchIds TABLE (BranchId BIGINT);
        IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
            INSERT INTO @BranchIds (BranchId)
            SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
        DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

        SELECT 200 AS ResponseCode, 'Kanban columns fetched successfully' AS ResponseMess,
            kc.Id, kc.ProjectId, p.Name AS ProjectName, kc.Title, kc.Color,
            kc.SortOrder, kc.MaxTasks, kc.IsActive, kc.IsCompanyWide,
            kc.CompId, kc.BranchId, kc.CreatedDate
        FROM [dbo].[tblKanbanColumns] kc
        LEFT JOIN [dbo].[tblProjects] p ON kc.ProjectId = p.Id
        WHERE
            (@Id = 0 OR kc.Id = @Id)
            AND (@ProjectId IS NULL OR kc.ProjectId = @ProjectId)
            AND kc.CompId = @CompId
            AND kc.IsActive = 1
            AND (
                kc.IsCompanyWide = 1
                OR (@UseScope = 1 AND kc.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND kc.BranchId = @BranchId)
            )
        ORDER BY kc.ProjectId, kc.SortOrder;
    END TRY
    BEGIN CATCH
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to fetch kanban columns: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

PRINT '✓ Scope-aware fetch SPs in place';
GO
