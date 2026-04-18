-- =============================================
-- CRM Database Stored Procedures - FETCH Operations
-- Database: eCRM+
-- Created: 2025-11-19
-- =============================================

USE [eCRM+]
GO

-- =============================================
-- Stored Procedure: sp_FetchLeads
-- Description: Fetch leads with pagination and search
-- Parameters: @Id=0 for all leads, @Id>0 for single lead
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_FetchLeads]
(
    @Id INT = 0,                     -- 0 = Fetch All, >0 = Fetch Single
    @BranchId INT,
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

    ---------------------------------------------------------
    -- FETCH ALL LEADS (WITH PAGINATION)
    ---------------------------------------------------------
    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        -- Count Total Records
        SELECT @TotalRecords = COUNT(*)
        FROM tblLeads l
        WHERE l.BranchId = @BranchId
        AND (
                @SearchTerm IS NULL
                OR l.CustomerName LIKE '%' + @SearchTerm + '%'
                OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                OR l.LeadSource LIKE '%' + @SearchTerm + '%'
                OR l.ProductModel LIKE '%' + @SearchTerm + '%'
            );

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        -- If no records found
        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'No leads found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS CustomerName, NULL AS MobileNo,
                   NULL AS LeadSource, NULL AS ProductCategory, NULL AS ProductBrand,
                   NULL AS ProductModel, NULL AS Budget, NULL AS LeadStatus,
                   NULL AS FollowupDate, NULL AS AssignTo, NULL AS AssignedDate,
                   NULL AS CreatedDate;

            RETURN;
        END

        -- If records found
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Leads fetched successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               l.Id, l.CustomerName, l.MobileNo, l.AlternateMobile, l.Email,
               l.Address, l.LeadSource, l.ProductCategory, l.ProductBrand,
               l.ProductModel, l.Budget, l.LeadStatus, l.FollowupDate,
               l.Remarks, l.AssignTo, l.AssignedDate,
               l.InvoiceDate, l.InvoiceNo,
               l.CreatedBy, l.CreatedDate, l.EditBy, l.EditDate
        FROM tblLeads l
        WHERE l.BranchId = @BranchId
        AND (
                @SearchTerm IS NULL
                OR l.CustomerName LIKE '%' + @SearchTerm + '%'
                OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                OR l.LeadSource LIKE '%' + @SearchTerm + '%'
                OR l.ProductModel LIKE '%' + @SearchTerm + '%'
            )
        ORDER BY l.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

        RETURN;
    END

    ---------------------------------------------------------
    -- FETCH SINGLE LEAD RECORD
    ---------------------------------------------------------
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblLeads WHERE Id = @Id AND BranchId = @BranchId)
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'Lead fetched successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   l.Id, l.CustomerName, l.MobileNo, l.AlternateMobile, l.Email,
                   l.Address, l.LeadSource, l.ProductCategory, l.ProductBrand,
                   l.ProductModel, l.Budget, l.LeadStatus, l.FollowupDate,
                   l.Remarks, l.AssignTo, l.AssignedDate,
                   l.InvoiceDate, l.InvoiceNo,
                   l.CreatedBy, l.CreatedDate, l.EditBy, l.EditDate
            FROM tblLeads l
            WHERE l.Id = @Id;

            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Lead not found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS CustomerName, NULL AS MobileNo,
                   NULL AS LeadSource, NULL AS ProductModel, NULL AS LeadStatus,
                   NULL AS FollowupDate, NULL AS AssignTo, NULL AS AssignedDate,
                   NULL AS CreatedDate;

            RETURN;
        END
    END

END
GO

-- =============================================
-- Stored Procedure: sp_FetchFollowUp
-- Description: Fetch follow-ups with pagination and search
-- Parameters: @Id=0 for all follow-ups, @Id>0 for single follow-up
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_FetchFollowUp]
(
    @Id INT = 0,
    @LeadID INT = 0,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(200) = NULL
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    ----------------------------------------------------
    -- FETCH ALL FOLLOWUPS
    ----------------------------------------------------
    IF(@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblFollowUp f
        WHERE
            (@LeadID = 0 OR f.LeadID = @LeadID)
            AND (
                @SearchTerm IS NULL
                OR f.Remarks LIKE '%' + @SearchTerm + '%'
                OR f.Status LIKE '%' + @SearchTerm + '%'
                OR f.FollowupType LIKE '%' + @SearchTerm + '%'
            );

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'No follow-up records found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS LeadID, NULL AS NextFollowupDate,
                   NULL AS FollowupType, NULL AS Remarks, NULL AS Status,
                   NULL AS CreatedBy, NULL AS CreatedDate;

            RETURN;
        END

        SET @ResponseCode = 200;
        SET @ResponseMess = 'Follow-ups retrieved successfully';

        SELECT
            @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
            @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
            @PageNumber AS CurrentPage, @PageSize AS PageSize,
            f.Id, f.LeadID, f.NextFollowupDate, f.FollowupType,
            f.Remarks, f.Status, f.CreatedBy, f.CreatedDate,
            f.EditBy, f.EditDate
        FROM tblFollowUp f
        WHERE
            (@LeadID = 0 OR f.LeadID = @LeadID)
            AND (
                @SearchTerm IS NULL
                OR f.Remarks LIKE '%' + @SearchTerm + '%'
                OR f.Status LIKE '%' + @SearchTerm + '%'
                OR f.FollowupType LIKE '%' + @SearchTerm + '%'
            )
        ORDER BY f.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

        RETURN;
    END

    ----------------------------------------------------
    -- FETCH SINGLE RECORD
    ----------------------------------------------------
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblFollowUp WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'Follow-up record fetched successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   f.*
            FROM tblFollowUp f
            WHERE f.Id = @Id;

            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Follow-up not found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
    END
END
GO

-- =============================================
-- Stored Procedure: sp_FetchLeadSource
-- Description: Fetch lead sources (all or single)
-- Parameters: @SourceId=0 for all sources, @SourceId>0 for single source
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_FetchLeadSource]
(
    @SourceId INT = 0
)
AS
BEGIN
    -- Get ALL
    IF(@SourceId = 0)
    BEGIN
        SELECT SourceId, SourceName
        FROM tblLeadSource
        ORDER BY SourceId;
        RETURN;
    END

    -- Get Single
    ELSE
    BEGIN
        SELECT SourceId, SourceName
        FROM tblLeadSource
        WHERE SourceId = @SourceId;
        RETURN;
    END
END
GO

-- =============================================
-- Stored Procedure: sp_FetchStatus
-- Description: Fetch statuses (all or single)
-- Parameters: @StatusId=0 for all statuses, @StatusId>0 for single status
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_FetchStatus]
(
    @StatusId INT = 0
)
AS
BEGIN
    -- Fetch All
    IF(@StatusId = 0)
    BEGIN
        SELECT StatusId, StatusName
        FROM tblStatus
        ORDER BY StatusId;
        RETURN;
    END

    -- Fetch One
    SELECT StatusId, StatusName
    FROM tblStatus
    WHERE StatusId = @StatusId;
END
GO

-- =============================================
-- Stored Procedure: sp_Dashboard
-- Description: Dashboard statistics (total leads, today's leads, followups, missed)
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_Dashboard]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 'TotalLeads' AS Type, COUNT(*) AS Number
    FROM tblLeads

    UNION ALL

    SELECT 'TodayNewLeads' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CAST(LeadDate AS DATE) = CAST(GETDATE() AS DATE)

    UNION ALL

    SELECT 'TodayFollowups' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CAST(FollowupDate AS DATE) = CAST(GETDATE() AS DATE)
      AND LeadStatus <> 'Converted'

    UNION ALL

    SELECT 'MissedFollowups' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE FollowupDate < CAST(GETDATE() AS DATE)
      AND LeadStatus NOT IN ('Converted', 'Closed')
      AND FollowupDate IS NOT NULL;
END
GO

-- =============================================
-- Stored Procedure: sp_ConvertedSummary
-- Description: Summary of converted leads (total and today)
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_ConvertedSummary]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        COUNT(*) AS TotalConverted,
        SUM(CASE
                WHEN CAST(InvoiceDate AS DATE) = CAST(GETDATE() AS DATE)
                THEN 1
                ELSE 0
            END) AS TodayConverted
    FROM tblLeads
    WHERE LeadStatus = 'Converted';

END
GO

-- =============================================
-- Stored Procedure: sp_FollowupsListUserWise
-- Description: Follow-ups list grouped by user for a date range
-- Parameters: @StartDate, @EndDate
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_FollowupsListUserWise]
(
    @StartDate DATE,
    @EndDate   DATE
)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        U.UserName,
        B.BranchName,
        COUNT(*) AS TodayFollowups
    FROM tblLeads L
    LEFT JOIN tblUser U   ON L.AssignTo = U.UserID
    LEFT JOIN tblBranch B ON L.BranchId = B.Id
    WHERE CAST(L.FollowupDate AS DATE) BETWEEN @StartDate AND @EndDate
    GROUP BY
        U.UserName,
        B.BranchName;
END
GO

-- =============================================
-- Stored Procedure: sp_LeadSummaryBranchWise
-- Description: Lead summary by branch for a date range
-- Parameters: @StartDate, @EndDate
-- Returns: Branch-wise total leads, converted, and pending counts
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_LeadSummaryBranchWise]
(
    @StartDate DATE,
    @EndDate   DATE
)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        B.BranchName,
        COUNT(L.Id) AS TotalLeads,
        SUM(CASE WHEN L.LeadStatus = 'Converted' THEN 1 ELSE 0 END) AS Converted,
        SUM(CASE WHEN L.LeadStatus <> 'Converted' THEN 1 ELSE 0 END) AS Pending
    FROM tblLeads L
    LEFT JOIN tblBranch B ON L.BranchId = B.Id
    WHERE CAST(L.LeadDate AS DATE) BETWEEN @StartDate AND @EndDate
    GROUP BY B.BranchName;

END
GO
