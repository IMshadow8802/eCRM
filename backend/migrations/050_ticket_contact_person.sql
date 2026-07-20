-- 050_ticket_contact_person.sql
-- ============================================================================
-- Tickets: who at the customer actually contacted us. CustomerName holds the
-- organisation ("Roop Apparels"); the human's name had no field, so users
-- were cramming it into brackets — "Paras Ram Apreal (Gurpreet)". New core
-- column ContactPerson + a backfill that splits the existing bracket-hacks.
--
--   1. tblTicket.ContactPerson (NVARCHAR(200) NULL)
--   2. Backfill: "Org (Name)" -> CustomerName='Org', ContactPerson='Name'
--   3. sp_SaveTicket        + @ContactPerson
--   4. sp_FetchTickets      returns it
--   5. sp_FetchTicketDetail returns it
-- ============================================================================
USE [eCRM+];
GO

IF COL_LENGTH('dbo.tblTicket', 'ContactPerson') IS NULL
    ALTER TABLE dbo.tblTicket ADD ContactPerson NVARCHAR(200) NULL;
GO

-- ---------------------------------------------------------------------------
-- 2. Backfill the bracket workaround: trailing "(...)" becomes ContactPerson.
--    Only rows that end with ")" and have exactly one "(" — anything fancier
--    stays untouched for manual review.
-- ---------------------------------------------------------------------------
UPDATE t
   SET ContactPerson = LTRIM(RTRIM(
           SUBSTRING(CustomerName,
                     CHARINDEX('(', CustomerName) + 1,
                     LEN(CustomerName) - CHARINDEX('(', CustomerName) - 1))),
       CustomerName = LTRIM(RTRIM(
           LEFT(CustomerName, CHARINDEX('(', CustomerName) - 1)))
  FROM dbo.tblTicket t
 WHERE ContactPerson IS NULL
   AND CustomerName LIKE '%(%)'
   AND LEN(CustomerName) - LEN(REPLACE(CustomerName, '(', '')) = 1;
GO

-- ---------------------------------------------------------------------------
-- 3. sp_SaveTicket — accepts + stores ContactPerson
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveTicket
    @Id            INT           = 0,
    @CompId        INT,
    @BranchId      INT,
    @UserId        INT,
    @CustomerName  NVARCHAR(200) = NULL,
    @ContactPerson NVARCHAR(200) = NULL,
    @Contact       VARCHAR(100)  = NULL,
    @Channel       VARCHAR(20)   = NULL,
    @CategoryId    INT           = NULL,
    @Priority      INT           = NULL,
    @PipelineId    INT           = NULL,
    @StageId       INT           = NULL,
    @AssignedTo    INT           = NULL,
    @LinkedLeadId  INT           = NULL,
    @Description   NVARCHAR(MAX) = NULL,
    @CustomJSON    NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(20)) AS TicketNo, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(20)) AS TicketNo, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(20)) AS TicketNo, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @TicketId INT = @Id;
        DECLARE @TicketNo VARCHAR(20);
        DECLARE @ActType VARCHAR(30);

        IF @Id > 0
        BEGIN
            UPDATE dbo.tblTicket
            SET CustomerName=@CustomerName, ContactPerson=@ContactPerson,
                Contact=@Contact, Channel=@Channel,
                CategoryId=@CategoryId, Priority=@Priority,
                PipelineId=ISNULL(@PipelineId,PipelineId), StageId=ISNULL(@StageId,StageId),
                AssignedTo=@AssignedTo, LinkedLeadId=@LinkedLeadId, Description=@Description,
                EditBy=@UserId, UpdatedAt=GETDATE()
            WHERE Id=@Id AND CompId=@CompId;
            SET @TicketNo = (SELECT TicketNo FROM dbo.tblTicket WHERE Id=@Id AND CompId=@CompId);
            SET @ActType = 'note';
        END
        ELSE
        BEGIN
            -- default pipeline / first open stage
            IF @PipelineId IS NULL
                SET @PipelineId = (SELECT TOP 1 Id FROM dbo.tblPipeline
                                   WHERE CompId=@CompId AND Entity='ticket' AND IsActive=1
                                   ORDER BY IsDefault DESC, Id);
            IF @StageId IS NULL
                SET @StageId = (SELECT TOP 1 Id FROM dbo.tblPipelineStage
                                WHERE PipelineId=@PipelineId AND CompId=@CompId
                                  AND IsActive=1 AND StageType='open' ORDER BY SortOrder);

            -- TicketNo: per-company sequence. ponytail: COUNT+1 inside the tran
            -- is fine at expected volume; swap to a sequence table if two
            -- concurrent inserts ever collide on the unique TicketNo.
            DECLARE @Seq INT = (SELECT COUNT(*) + 1 FROM dbo.tblTicket WHERE CompId=@CompId);
            SET @TicketNo = 'TKT-' + RIGHT('000000' + CAST(@Seq AS VARCHAR(10)), 6);

            INSERT INTO dbo.tblTicket
                (CompId, BranchId, TicketNo, CustomerName, ContactPerson, Contact, Channel, CategoryId,
                 Priority, PipelineId, StageId, AssignedTo, LinkedLeadId,
                 Description, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @TicketNo, @CustomerName, @ContactPerson, @Contact, @Channel, @CategoryId,
                 @Priority, @PipelineId, @StageId, @AssignedTo, @LinkedLeadId,
                 @Description, @UserId, @UserId, GETDATE());

            SET @TicketId = CAST(SCOPE_IDENTITY() AS INT);
            SET @ActType = 'created';
        END

        -- custom-field values (shared engine, Entity='ticket')
        IF @CustomJSON IS NOT NULL AND LTRIM(RTRIM(@CustomJSON)) NOT IN ('', '[]')
        BEGIN
            ;WITH src AS (
                SELECT j.fieldId,
                       CASE WHEN j.type IN ('dropdown','text') THEN j.val END AS ValueText,
                       CASE WHEN j.type = 'number'  THEN TRY_CONVERT(DECIMAL(18,2), j.val)
                            WHEN j.type = 'checkbox' THEN CASE WHEN j.val='true' THEN 1 ELSE 0 END END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CONVERT(DATETIME, j.val) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                     WITH (fieldId INT '$.fieldId', type VARCHAR(20) '$.type', val NVARCHAR(MAX) '$.value') j
                WHERE j.fieldId IS NOT NULL
            )
            MERGE dbo.tblCustomFieldValue AS tgt
            USING src ON tgt.CompId=@CompId AND tgt.Entity='ticket'
                      AND tgt.EntityId=@TicketId AND tgt.FieldId=src.fieldId
            WHEN MATCHED THEN UPDATE SET ValueText=src.ValueText, ValueNumber=src.ValueNumber, ValueDate=src.ValueDate
            WHEN NOT MATCHED THEN INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                 VALUES (@CompId, 'ticket', @TicketId, src.fieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
            @CompId=@CompId, @TicketId=@TicketId, @UserId=@UserId, @Type=@ActType, @Summary=@ActType, @MetaJSON=NULL;

        COMMIT TRANSACTION;
        SELECT @TicketId AS Id, @TicketNo AS TicketNo, 200 AS ResponseCode, 'Ticket saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, CAST(NULL AS VARCHAR(20)) AS TicketNo, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 4. sp_FetchTickets — returns ContactPerson (scope logic unchanged from 046)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTickets
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 10,
    @SearchTerm              NVARCHAR(200) = NULL,
    @StageId                 INT           = NULL,
    @Priority                INT           = NULL,
    @CategoryId              INT           = NULL,
    @AssignedTo              INT           = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,10) < 1 THEN 10 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;

    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId)
        SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END

    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId)
        SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    DECLARE @Total INT;
    SELECT @Total = COUNT(*)
    FROM dbo.tblTicket t
    WHERE t.CompId=@CompId
      AND (@BranchId   IS NULL OR t.BranchId=@BranchId)
      AND (@StageId    IS NULL OR t.StageId=@StageId)
      AND (@Priority   IS NULL OR t.Priority=@Priority)
      AND (@CategoryId IS NULL OR t.CategoryId=@CategoryId)
      AND (@AssignedTo IS NULL OR t.AssignedTo=@AssignedTo)
      AND (@SearchTerm IS NULL OR t.CustomerName LIKE '%'+@SearchTerm+'%'
                              OR t.ContactPerson LIKE '%'+@SearchTerm+'%'
                              OR t.TicketNo LIKE '%'+@SearchTerm+'%'
                              OR t.Contact LIKE '%'+@SearchTerm+'%')
      AND (
            (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
          );

    SELECT t.Id, t.CompId, t.BranchId, t.TicketNo, t.CustomerName, t.ContactPerson,
           t.Contact, t.Channel,
           t.CategoryId, t.Priority, t.PipelineId, t.StageId, t.AssignedTo, t.LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, t.Description,
           t.CreatedAt, t.UpdatedAt,
           200 AS ResponseCode, 'Tickets retrieved successfully' AS ResponseMess
    FROM dbo.tblTicket t
    WHERE t.CompId=@CompId
      AND (@BranchId   IS NULL OR t.BranchId=@BranchId)
      AND (@StageId    IS NULL OR t.StageId=@StageId)
      AND (@Priority   IS NULL OR t.Priority=@Priority)
      AND (@CategoryId IS NULL OR t.CategoryId=@CategoryId)
      AND (@AssignedTo IS NULL OR t.AssignedTo=@AssignedTo)
      AND (@SearchTerm IS NULL OR t.CustomerName LIKE '%'+@SearchTerm+'%'
                              OR t.ContactPerson LIKE '%'+@SearchTerm+'%'
                              OR t.TicketNo LIKE '%'+@SearchTerm+'%'
                              OR t.Contact LIKE '%'+@SearchTerm+'%')
      AND (
            (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
          )
    ORDER BY t.CreatedAt DESC, t.Id DESC
    OFFSET (@PageNumber-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total=0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT)/@PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO

-- ---------------------------------------------------------------------------
-- 5. sp_FetchTicketDetail — returns ContactPerson
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTicketDetail
    @CompId INT,
    @TicketId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT t.Id, t.CompId, t.BranchId, t.TicketNo, t.CustomerName, t.ContactPerson,
           t.Contact, t.Channel,
           t.CategoryId, t.Priority, t.PipelineId, t.StageId, t.AssignedTo, t.LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, t.Description,
           t.CreatedBy, t.EditBy, t.CreatedAt, t.UpdatedAt,
           200 AS ResponseCode, 'Ticket detail retrieved successfully' AS ResponseMess
    FROM dbo.tblTicket t WHERE t.Id=@TicketId AND t.CompId=@CompId;

    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type, v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId=@CompId AND v.Entity='ticket' AND v.EntityId=@TicketId
    ORDER BY d.SortOrder;

    SELECT a.Id, a.TicketId, a.UserId, a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblTicketActivity a
    WHERE a.CompId=@CompId AND a.TicketId=@TicketId
    ORDER BY a.CreatedAt DESC, a.Id DESC;

    -- linked-lead summary (null-safe: empty set when no link)
    SELECT l.Id, l.Name, l.MobileNo, l.Email, l.StageId
    FROM dbo.tblLeads l
    INNER JOIN dbo.tblTicket t ON t.LinkedLeadId = l.Id
    WHERE t.Id=@TicketId AND t.CompId=@CompId AND l.CompId=@CompId;
END
GO

-- ============================================================================
-- VERIFY AFTER APPLY
-- ============================================================================
-- 1. Backfill split the bracket-hacks: expect clean org names + person names.
SELECT Id, TicketNo, CustomerName, ContactPerson FROM dbo.tblTicket ORDER BY Id;

-- 2. Column present in both fetch paths.
EXEC dbo.sp_FetchTickets @CompId = 1, @UserId = 2,
     @AccessibleBranchIdsJson = N'[1,2,3,4,5]', @PageSize = 5;
