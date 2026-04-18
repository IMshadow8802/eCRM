USE [eCRM+]
GO

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
                   NULL AS Id, NULL AS LeadDate, NULL AS CustomerName, NULL AS MobileNo,
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
               l.Id, l.LeadDate, l.CustomerName, l.MobileNo, l.AlternateMobile, l.Email,
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
                   l.Id, l.LeadDate, l.CustomerName, l.MobileNo, l.AlternateMobile, l.Email,
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
                   NULL AS Id, NULL AS LeadDate, NULL AS CustomerName, NULL AS MobileNo,
                   NULL AS LeadSource, NULL AS ProductModel, NULL AS LeadStatus,
                   NULL AS FollowupDate, NULL AS AssignTo, NULL AS AssignedDate,
                   NULL AS CreatedDate;

            RETURN;
        END
    END

END
GO
