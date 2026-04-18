-- =============================================
-- CRM Database Stored Procedures - DELETE Operations
-- Database: eCRM+
-- Created: 2025-11-19
-- =============================================

USE [eCRM+]
GO

-- =============================================
-- Stored Procedure: sp_DeleteLead
-- Description: Delete a lead by ID
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_DeleteLead]
(
    @Id INT
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMessage VARCHAR(200);

    IF NOT EXISTS (SELECT 1 FROM tblLeads WHERE Id = @Id)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMessage = 'Lead Not Found!';
        SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage;
        RETURN;
    END

    DELETE FROM tblLeads WHERE Id = @Id;

    SET @ResponseCode = 200;
    SET @ResponseMessage = 'Lead Deleted Successfully';
    SELECT @ResponseCode AS ResponseCode, @ResponseMessage AS ResponseMessage;
END
GO

-- =============================================
-- Stored Procedure: sp_DeleteFollowUp
-- Description: Delete a follow-up record by ID
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_DeleteFollowUp]
(
    @Id INT
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    IF NOT EXISTS (SELECT 1 FROM tblFollowUp WHERE Id = @Id)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Follow-up not found';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    DELETE FROM tblFollowUp WHERE Id = @Id;

    SET @ResponseCode = 200;
    SET @ResponseMess = 'Follow-up deleted successfully';

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
END
GO

-- =============================================
-- Stored Procedure: sp_DeleteLeadSource
-- Description: Delete a lead source by SourceId
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_DeleteLeadSource]
(
    @SourceId INT
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    IF NOT EXISTS (SELECT 1 FROM tblLeadSource WHERE SourceId = @SourceId)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'SourceId Not Found!';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
        RETURN;
    END

    DELETE FROM tblLeadSource WHERE SourceId = @SourceId;

    SET @ResponseCode = 200;
    SET @ResponseMess = 'Source Deleted Successfully!';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
END
GO

-- =============================================
-- Stored Procedure: sp_DeleteStatus
-- Description: Delete a status by StatusId
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[sp_DeleteStatus]
(
    @StatusId INT
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    IF NOT EXISTS (SELECT 1 FROM tblStatus WHERE StatusId = @StatusId)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'StatusId Not Found!';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
        RETURN;
    END

    DELETE FROM tblStatus WHERE StatusId = @StatusId;

    SET @ResponseCode = 200;
    SET @ResponseMess = 'Status Deleted Successfully';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMessage;
END
GO
