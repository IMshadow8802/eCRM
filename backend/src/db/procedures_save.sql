-- =============================================
-- CRM Database Stored Procedures - SAVE Operations
-- Database: eCRM+
-- Created: 2025-11-19
-- Description: INSERT/UPDATE operations (@Id=0 for INSERT, @Id>0 for UPDATE)
-- =============================================

USE [eCRM+]
GO

-- =============================================
-- Stored Procedure: sp_SaveLead
-- Description: Create or update a lead
-- Parameters: @Id=0 for INSERT, @Id>0 for UPDATE
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_SaveLead]
(
    @Id INT = 0,
    @CompId INT,
    @BranchId INT,
    @LeadDate DATETIME = NULL,
    @CustomerName VARCHAR(150) = NULL,
    @MobileNo VARCHAR(15),
    @AlternateMobile VARCHAR(15) = NULL,
    @Email VARCHAR(150) = NULL,
    @Address VARCHAR(250) = NULL,
    @LeadSource VARCHAR(100) = NULL,
    @ProductCategory VARCHAR(100) = NULL,
    @ProductBrand VARCHAR(100) = NULL,
    @ProductModel VARCHAR(100) = NULL,
    @Budget DECIMAL(10,2) = NULL,
    @LeadStatus VARCHAR(50) = NULL,
    @FollowupDate DATETIME = NULL,
    @Remarks VARCHAR(500) = NULL,
    @AssignTo INT = NULL,
    @AssignedDate DATETIME = NULL,
    @InvoiceDate DATETIME = NULL,
    @InvoiceNo VARCHAR(50) = NULL,
    @CreatedBy INT = NULL,
    @EditBy INT = NULL
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMessage VARCHAR(200);

    ----------------------------------------------
    -- COMPID AND BRANCHID VALIDATION
    ----------------------------------------------
    IF (@CompId IS NULL OR @CompId = 0 OR @BranchId IS NULL OR @BranchId = 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMessage = 'CompId and BranchId are required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage;
        RETURN;
    END

    ----------------------------------------------
    -- MOBILE NO VALIDATION
    ----------------------------------------------
    IF (@MobileNo IS NULL OR LTRIM(RTRIM(@MobileNo)) = '')
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMessage = 'Mobile No is required!';
        SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage;
        RETURN;
    END

    IF (LEN(@MobileNo) < 10)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMessage = 'Mobile No must be at least 10 digits!';
        SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage;
        RETURN;
    END

    ----------------------------------------------
    -- INSERT MODE
    ----------------------------------------------
    IF (@Id = 0)
    BEGIN
        INSERT INTO tblLeads
        (
            CompId, BranchId, LeadDate, CustomerName, MobileNo, AlternateMobile, Email, Address,
            LeadSource, ProductCategory, ProductBrand, ProductModel, Budget, LeadStatus,
            FollowupDate, Remarks, AssignTo, AssignedDate, InvoiceDate, InvoiceNo,
            CreatedBy, CreatedDate
        )
        VALUES
        (
            @CompId, @BranchId, @LeadDate, @CustomerName, @MobileNo, @AlternateMobile, @Email, @Address,
            @LeadSource, @ProductCategory, @ProductBrand, @ProductModel, @Budget, @LeadStatus,
            @FollowupDate, @Remarks, @AssignTo, @AssignedDate, @InvoiceDate, @InvoiceNo,
            @CreatedBy, GETDATE()
        );

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMessage = 'Lead Created Successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage, @Id AS Id;
        RETURN;
    END

    ----------------------------------------------
    -- UPDATE MODE
    ----------------------------------------------
    IF EXISTS (SELECT 1 FROM tblLeads WHERE Id = @Id)
    BEGIN
        UPDATE tblLeads
        SET
            CompId = @CompId,
            BranchId = @BranchId,
            LeadDate = @LeadDate,
            CustomerName = @CustomerName,
            MobileNo = @MobileNo,
            AlternateMobile = @AlternateMobile,
            Email = @Email,
            Address = @Address,
            LeadSource = @LeadSource,
            ProductCategory = @ProductCategory,
            ProductBrand = @ProductBrand,
            ProductModel = @ProductModel,
            Budget = @Budget,
            LeadStatus = @LeadStatus,
            FollowupDate = @FollowupDate,
            Remarks = @Remarks,
            AssignTo = @AssignTo,
            AssignedDate = @AssignedDate,
            InvoiceDate = @InvoiceDate,
            InvoiceNo = @InvoiceNo,
            EditBy = @EditBy,
            EditDate = GETDATE()
        WHERE Id = @Id AND CompId = @CompId AND BranchId = @BranchId;

        -- Check if UPDATE affected any rows
        DECLARE @RowsAffected INT = @@ROWCOUNT;

        IF (@RowsAffected = 0)
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMessage = 'Lead not found or access denied (CompId/BranchId mismatch)';
            SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage;
            RETURN;
        END

        SET @ResponseCode = 200;
        SET @ResponseMessage = 'Lead Updated Successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage, @Id AS Id;
        RETURN;
    END
    ELSE
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMessage = 'Lead ID Not Found!';
        SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage;
        RETURN;
    END
END
GO

-- =============================================
-- Stored Procedure: sp_SaveFollowUp
-- Description: Create or update a follow-up record
-- Parameters: @Id=0 for INSERT, @Id>0 for UPDATE
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_SaveFollowUp]
(
    @Id INT = 0,                     -- 0 = Insert, >0 = Update
    @LeadID INT,
    @NextFollowupDate DATETIME = NULL,
    @FollowupType VARCHAR(50) = NULL,
    @Remarks VARCHAR(500) = NULL,
    @Status VARCHAR(50) = NULL,
    @CompId INT,
    @BranchId INT,
    @CreatedBy INT = NULL,
    @EditBy INT = NULL
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    ----------------------------------------------------
    -- Validation: CompId and BranchId Required
    ----------------------------------------------------
    IF (@CompId IS NULL OR @CompId = 0 OR @BranchId IS NULL OR @BranchId = 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'CompId and BranchId are required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    ----------------------------------------------------
    -- Validation: Remarks Required
    ----------------------------------------------------
    IF (@Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = '')
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Remarks is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    ----------------------------------------------------
    -- INSERT
    ----------------------------------------------------
    IF(@Id = 0)
    BEGIN
        INSERT INTO tblFollowUp
        (
            CompId, BranchId, LeadID, NextFollowupDate, FollowupType, Remarks,
            Status, CreatedBy, CreatedDate
        )
        VALUES
        (
            @CompId, @BranchId, @LeadID, @NextFollowupDate, @FollowupType, @Remarks,
            @Status, @CreatedBy, GETDATE()
        );

        SET @Id = SCOPE_IDENTITY();

        SET @ResponseCode = 201;
        SET @ResponseMess = 'Follow-up created successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS FollowUpID;
        RETURN;
    END

    ----------------------------------------------------
    -- UPDATE
    ----------------------------------------------------
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblFollowUp WHERE Id = @Id)
        BEGIN
            UPDATE tblFollowUp
            SET
                CompId = @CompId,
                BranchId = @BranchId,
                LeadID = @LeadID,
                NextFollowupDate = @NextFollowupDate,
                FollowupType = @FollowupType,
                Remarks = @Remarks,
                Status = @Status,
                EditBy = @EditBy,
                EditDate = GETDATE()
            WHERE Id = @Id AND CompId = @CompId AND BranchId = @BranchId;

            -- Check if UPDATE affected any rows
            DECLARE @RowsAffected INT = @@ROWCOUNT;

            IF (@RowsAffected = 0)
            BEGIN
                SET @ResponseCode = 404;
                SET @ResponseMess = 'Follow-up not found or access denied (CompId/BranchId mismatch)';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
                RETURN;
            END

            SET @ResponseCode = 200;
            SET @ResponseMess = 'Follow-up updated successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Follow-up Id not found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
    END
END
GO

-- =============================================
-- Stored Procedure: sp_SaveLeadSource
-- Description: Create or update a lead source
-- Parameters: @SourceId=0 for INSERT, @SourceId>0 for UPDATE
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_SaveLeadSource]
(
    @SourceId INT = 0,
    @SourceName VARCHAR(100)
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    -- Validation : Name should not be blank
    IF(@SourceName IS NULL OR LTRIM(RTRIM(@SourceName)) = '')
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Source Name cannot be blank!';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
        RETURN;
    END

    -- INSERT
    IF(@SourceId = 0)
    BEGIN
        INSERT INTO tblLeadSource(SourceName)
        VALUES(@SourceName);

        SET @SourceId = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Source Created Successfully!';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage, @SourceId AS SourceId;
        RETURN;
    END

    -- UPDATE
    ELSE
    BEGIN
        IF EXISTS(SELECT 1 FROM tblLeadSource WHERE SourceId = @SourceId)
        BEGIN
            UPDATE tblLeadSource
            SET SourceName = @SourceName
            WHERE SourceId = @SourceId;

            SET @ResponseCode = 200;
            SET @ResponseMess = 'Source Updated Successfully!';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'SourceId Not Found!';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
            RETURN;
        END
    END
END
GO

-- =============================================
-- Stored Procedure: sp_SaveStatus
-- Description: Create or update a status
-- Parameters: @StatusId=0 for INSERT, @StatusId>0 for UPDATE
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_SaveStatus]
(
    @StatusId INT = 0,
    @StatusName VARCHAR(50)
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    -- Validation
    IF(@StatusName IS NULL OR LTRIM(RTRIM(@StatusName)) = '')
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Status Name cannot be blank!';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
        RETURN;
    END

    -- Insert
    IF(@StatusId = 0)
    BEGIN
        INSERT INTO tblStatus(StatusName)
        VALUES(@StatusName);

        SET @StatusId = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Status Created Successfully';

        SELECT @ResponseCode AS ResponseCode,
               @ResponseMess AS ResponseMessage,
               @StatusId AS StatusId;
        RETURN;
    END

    -- Update
    ELSE
    BEGIN
        IF EXISTS(SELECT 1 FROM tblStatus WHERE StatusId = @StatusId)
        BEGIN
            UPDATE tblStatus
            SET StatusName = @StatusName
            WHERE StatusId = @StatusId;

            SET @ResponseCode = 200;
            SET @ResponseMess = 'Status Updated Successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'StatusId Not Found!';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
            RETURN;
        END
    END
END
GO
