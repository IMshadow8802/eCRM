-- 034_create_sp_savelead.sql
-- CRITICAL: sp_SaveLead is called by leadController.save (create/update lead +
-- LeadDetail "Save changes" for custom fields) but was NOT present in the
-- applied database — every save currently fails with "Could not find stored
-- procedure 'sp_SaveLead'". This creates it. Apply by hand.
--
-- Params match leadController.save's payload exactly ({...req.body, Id, CompId,
-- BranchId, UserId}); the mssql driver errors if it passes a param the proc
-- doesn't declare, so keep this signature in sync with the controller.
--
-- Verify after apply:
--   EXEC sp_SaveLead @Id=0, @CompId=1, @BranchId=1, @UserId=1, @Name=N'Test Lead',
--        @CustomJSON=N'[{"fieldId":1,"type":"number","value":"5000"}]';
--   -> returns one row: Id (new), ResponseCode=200. A 2nd EXEC with that Id
--      updates and upserts the custom value (no duplicate tblCustomFieldValue row).
USE [eCRM+]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROC dbo.sp_SaveLead
    @Id               INT            = 0,
    @CompId           INT,
    @BranchId         INT,
    @UserId           INT,
    @Name             NVARCHAR(200),
    @MobileNo         VARCHAR(20)    = NULL,
    @AltMobile        VARCHAR(20)    = NULL,
    @Email            VARCHAR(150)   = NULL,
    @SourceId         INT            = NULL,
    @PipelineId       INT            = NULL,
    @StageId          INT            = NULL,
    @OwnerId          INT            = NULL,
    @EstValue         DECIMAL(18,2)  = NULL,
    @NextFollowupDate DATETIME       = NULL,
    @CustomJSON       NVARCHAR(MAX)  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN;
    END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN;
    END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN
        SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN;
    END

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
    BEGIN
        SELECT @Id AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @LeadId INT = @Id;
        DECLARE @ActType VARCHAR(30);

        IF @Id > 0
        BEGIN
            -- Update core columns. LeadDetail sends the lead's existing
            -- Pipeline/Stage back, so overwriting them is a no-op there; a
            -- won/lost stamp is owned by sp_MoveLeadStage, untouched here.
            UPDATE dbo.tblLeads
            SET Name = @Name, MobileNo = @MobileNo, AltMobile = @AltMobile, Email = @Email,
                SourceId = @SourceId, PipelineId = ISNULL(@PipelineId, PipelineId),
                StageId = ISNULL(@StageId, StageId), OwnerId = @OwnerId,
                EstValue = @EstValue, NextFollowupDate = @NextFollowupDate,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

            SET @ActType = 'note';  -- generic edit; stage/won/lost go via sp_MoveLeadStage
        END
        ELSE
        BEGIN
            -- New lead: default to the company's default lead pipeline and its
            -- first 'open' stage when caller didn't specify.
            IF @PipelineId IS NULL
                SET @PipelineId = (SELECT TOP 1 Id FROM dbo.tblPipeline
                                   WHERE CompId=@CompId AND Entity='lead' AND IsActive=1
                                   ORDER BY IsDefault DESC, Id);
            IF @StageId IS NULL
                SET @StageId = (SELECT TOP 1 Id FROM dbo.tblPipelineStage
                                WHERE PipelineId=@PipelineId AND CompId=@CompId
                                  AND IsActive=1 AND StageType='open'
                                ORDER BY SortOrder);

            INSERT INTO dbo.tblLeads
                (CompId, BranchId, Name, MobileNo, AltMobile, Email, SourceId,
                 PipelineId, StageId, OwnerId, EstValue, NextFollowupDate,
                 CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @Name, @MobileNo, @AltMobile, @Email, @SourceId,
                 @PipelineId, @StageId, @OwnerId, @EstValue, @NextFollowupDate,
                 @UserId, @UserId, GETDATE());

            SET @LeadId = CAST(SCOPE_IDENTITY() AS INT);
            SET @ActType = 'created';
        END

        -- Upsert custom-field values. JSON: [{fieldId,type,value}]. Typed
        -- column chosen by type (checkbox -> ValueNumber 0/1, number ->
        -- ValueNumber, date -> ValueDate, dropdown/text -> ValueText). One row
        -- per (EntityId, FieldId) enforced by MERGE.
        IF @CustomJSON IS NOT NULL AND LTRIM(RTRIM(@CustomJSON)) NOT IN ('', '[]')
        BEGIN
            ;WITH src AS (
                SELECT j.fieldId,
                       CASE WHEN j.type IN ('dropdown','text') THEN j.val END AS ValueText,
                       CASE WHEN j.type = 'number'   THEN TRY_CONVERT(DECIMAL(18,2), j.val)
                            WHEN j.type = 'checkbox'  THEN CASE WHEN j.val = 'true' THEN 1 ELSE 0 END
                       END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CONVERT(DATETIME, j.val) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                     WITH (fieldId INT '$.fieldId',
                           type    VARCHAR(20) '$.type',
                           val     NVARCHAR(MAX) '$.value') j
                WHERE j.fieldId IS NOT NULL
            )
            MERGE dbo.tblCustomFieldValue AS tgt
            USING src
               ON tgt.CompId = @CompId AND tgt.Entity = 'lead'
              AND tgt.EntityId = @LeadId AND tgt.FieldId = src.fieldId
            WHEN MATCHED THEN
                UPDATE SET ValueText = src.ValueText,
                           ValueNumber = src.ValueNumber,
                           ValueDate = src.ValueDate
            WHEN NOT MATCHED THEN
                INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                VALUES (@CompId, 'lead', @LeadId, src.fieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = @ActType, @Summary = @ActType, @MetaJSON = NULL;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO
