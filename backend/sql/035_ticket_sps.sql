-- 035_ticket_sps.sql  (Spec 2 — Complaints / Ticketing)
-- Ticket + SLA stored procedures + a per-company seed (ticket pipeline,
-- priority/category/resolution lookups, default SLA rules). Tables already
-- exist from the 032 batch (tblTicket, tblTicketActivity, tblSLARule, and
-- tblCall.TicketId). Reuses the shared config engine via Entity='ticket'.
-- Apply by hand. Idempotent: seed guarded by existence, SPs CREATE OR ALTER.
--
-- Verify after apply:
--   EXEC sp_SaveTicket @Id=0,@CompId=1,@BranchId=1,@CustomerName=N'Test',
--        @Priority=(SELECT Id FROM tblLookup WHERE CompId=1 AND Kind='priority' AND Value='urgent'),
--        @UserId=1;  -- returns TicketNo TKT-000001 + non-null SLADueAt
--   EXEC sp_FetchTickets @CompId=1,@BranchId=1,@BreachedOnly=1;  -- breach filter
USE [eCRM+]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

/* ============================================================
   SEED — per company (only where a ticket pipeline is absent)
   ============================================================ */
DECLARE @comps TABLE (CompId INT);
INSERT INTO @comps (CompId)
SELECT DISTINCT CompId FROM dbo.tblUser
WHERE CompId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.tblPipeline p
                  WHERE p.CompId = tblUser.CompId AND p.Entity = 'ticket');

DECLARE @CompId INT;
DECLARE comp_cur CURSOR LOCAL FAST_FORWARD FOR SELECT CompId FROM @comps;
OPEN comp_cur;
FETCH NEXT FROM comp_cur INTO @CompId;
WHILE @@FETCH_STATUS = 0
BEGIN
    -- ticket pipeline + stages
    DECLARE @PipeId INT;
    INSERT INTO dbo.tblPipeline (CompId, Entity, Name, IsDefault, IsActive, CreatedAt)
    VALUES (@CompId, 'ticket', 'Support Pipeline', 1, 1, GETDATE());
    SET @PipeId = CAST(SCOPE_IDENTITY() AS INT);

    INSERT INTO dbo.tblPipelineStage (CompId, PipelineId, Name, SortOrder, StageType, Color, IsActive)
    VALUES (@CompId, @PipeId, 'New',         1, 'open', '#3B82F6', 1),
           (@CompId, @PipeId, 'Assigned',    2, 'open', '#6366F1', 1),
           (@CompId, @PipeId, 'In-Progress', 3, 'open', '#F59E0B', 1),
           (@CompId, @PipeId, 'Resolved',    4, 'won',  '#10B981', 1),
           (@CompId, @PipeId, 'Closed',      5, 'won',  '#059669', 1),
           (@CompId, @PipeId, 'Rejected',    6, 'lost', '#EF4444', 1);

    -- lookups: priority / ticket_category / resolution
    INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive)
    VALUES (@CompId, 'priority', 'low', 1, 1),
           (@CompId, 'priority', 'medium', 2, 1),
           (@CompId, 'priority', 'high', 3, 1),
           (@CompId, 'priority', 'urgent', 4, 1),
           (@CompId, 'ticket_category', 'General', 1, 1),
           (@CompId, 'ticket_category', 'Billing', 2, 1),
           (@CompId, 'ticket_category', 'Technical', 3, 1),
           (@CompId, 'resolution', 'Fixed', 1, 1),
           (@CompId, 'resolution', 'Won''t Fix', 2, 1),
           (@CompId, 'resolution', 'Duplicate', 3, 1);

    -- default SLA rules keyed on the priority lookup ids just inserted
    INSERT INTO dbo.tblSLARule (CompId, Priority, ResponseMins, ResolutionMins, IsActive, CreatedAt)
    SELECT @CompId, lk.Id,
           CASE lk.Value WHEN 'urgent' THEN 30 WHEN 'high' THEN 60 WHEN 'medium' THEN 240 ELSE 480 END,
           CASE lk.Value WHEN 'urgent' THEN 240 WHEN 'high' THEN 480 WHEN 'medium' THEN 1440 ELSE 2880 END,
           1, GETDATE()
    FROM dbo.tblLookup lk
    WHERE lk.CompId = @CompId AND lk.Kind = 'priority' AND lk.IsActive = 1;

    FETCH NEXT FROM comp_cur INTO @CompId;
END
CLOSE comp_cur;
DEALLOCATE comp_cur;
GO

/* ============================================================
   sp_LogTicketActivity — single timeline logger (mirrors leads)
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_LogTicketActivity
    @CompId   INT,
    @TicketId INT,
    @UserId   INT,
    @Type     VARCHAR(30),
    @Summary  NVARCHAR(500) = NULL,
    @MetaJSON NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @CompId IS NULL OR @CompId <= 0 OR @TicketId IS NULL OR @TicketId <= 0
       OR @UserId IS NULL OR @UserId <= 0 OR @Type IS NULL OR LTRIM(RTRIM(@Type)) = ''
    BEGIN
        SELECT CAST(NULL AS INT) AS Id, 400 AS ResponseCode, 'Missing required activity fields' AS ResponseMess;
        RETURN;
    END
    INSERT INTO dbo.tblTicketActivity (CompId, TicketId, UserId, Type, Summary, MetaJSON, CreatedBy)
    VALUES (@CompId, @TicketId, @UserId, @Type, @Summary, @MetaJSON, @UserId);
    SELECT SCOPE_IDENTITY() AS Id, 200 AS ResponseCode, 'Activity logged successfully' AS ResponseMess;
END
GO

/* ============================================================
   sp_SaveTicket — upsert; auto TicketNo + SLA + custom vals + activity
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_SaveTicket
    @Id           INT           = 0,
    @CompId       INT,
    @BranchId     INT,
    @UserId       INT,
    @CustomerName NVARCHAR(200) = NULL,
    @Contact      VARCHAR(100)  = NULL,
    @Channel      VARCHAR(20)   = NULL,
    @CategoryId   INT           = NULL,
    @Priority     INT           = NULL,
    @PipelineId   INT           = NULL,
    @StageId      INT           = NULL,
    @AssignedTo   INT           = NULL,
    @LinkedLeadId INT           = NULL,
    @Description  NVARCHAR(MAX) = NULL,
    @CustomJSON   NVARCHAR(MAX) = NULL
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
            SET CustomerName=@CustomerName, Contact=@Contact, Channel=@Channel,
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

            -- TicketNo: next number after the current MAX suffix for this
            -- company (MAX, not COUNT, so deleting a ticket never makes the
            -- next create reuse an existing number and hit the unique index).
            -- ponytail: still a read-then-insert; swap to a sequence/counter
            -- row only if concurrent inserts ever collide on the unique key.
            DECLARE @Seq INT = (SELECT ISNULL(MAX(TRY_CONVERT(INT, RIGHT(TicketNo, 6))), 0) + 1
                                FROM dbo.tblTicket
                                WHERE CompId=@CompId AND TicketNo LIKE 'TKT-%');
            SET @TicketNo = 'TKT-' + RIGHT('000000' + CAST(@Seq AS VARCHAR(10)), 6);

            -- SLA: resolution target for this priority, else any active company
            -- rule, else 24h.
            DECLARE @Mins INT =
                (SELECT TOP 1 ResolutionMins FROM dbo.tblSLARule
                 WHERE CompId=@CompId AND Priority=@Priority AND IsActive=1 ORDER BY Id);
            IF @Mins IS NULL
                SET @Mins = (SELECT TOP 1 ResolutionMins FROM dbo.tblSLARule
                             WHERE CompId=@CompId AND IsActive=1 ORDER BY Id);
            DECLARE @SLADueAt DATETIME = DATEADD(MINUTE, ISNULL(@Mins, 1440), GETDATE());

            INSERT INTO dbo.tblTicket
                (CompId, BranchId, TicketNo, CustomerName, Contact, Channel, CategoryId,
                 Priority, PipelineId, StageId, AssignedTo, LinkedLeadId, SLADueAt,
                 Description, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @TicketNo, @CustomerName, @Contact, @Channel, @CategoryId,
                 @Priority, @PipelineId, @StageId, @AssignedTo, @LinkedLeadId, @SLADueAt,
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

/* ============================================================
   sp_FetchTickets — paged + filters + breach flag
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_FetchTickets
    @CompId       INT,
    @BranchId     INT           = NULL,
    @PageNumber   INT           = 1,
    @PageSize     INT           = 10,
    @SearchTerm   NVARCHAR(200) = NULL,
    @StageId      INT           = NULL,
    @Priority     INT           = NULL,
    @CategoryId   INT           = NULL,
    @AssignedTo   INT           = NULL,
    @BreachedOnly BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,10) < 1 THEN 10 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;

    DECLARE @Total INT;
    SELECT @Total = COUNT(*)
    FROM dbo.tblTicket t
    WHERE t.CompId=@CompId
      AND (@BranchId   IS NULL OR t.BranchId=@BranchId)
      AND (@StageId    IS NULL OR t.StageId=@StageId)
      AND (@Priority   IS NULL OR t.Priority=@Priority)
      AND (@CategoryId IS NULL OR t.CategoryId=@CategoryId)
      AND (@AssignedTo IS NULL OR t.AssignedTo=@AssignedTo)
      AND (@BreachedOnly=0 OR (t.SLADueAt < GETDATE() AND t.ResolvedAt IS NULL))
      AND (@SearchTerm IS NULL OR t.CustomerName LIKE '%'+@SearchTerm+'%'
                              OR t.TicketNo LIKE '%'+@SearchTerm+'%'
                              OR t.Contact LIKE '%'+@SearchTerm+'%');

    SELECT t.Id, t.CompId, t.BranchId, t.TicketNo, t.CustomerName, t.Contact, t.Channel,
           t.CategoryId, t.Priority, t.PipelineId, t.StageId, t.AssignedTo, t.LinkedLeadId,
           t.SLADueAt, t.ResolvedAt, t.ClosedAt, t.ResolutionId, t.Description,
           CAST(CASE WHEN t.SLADueAt < GETDATE() AND t.ResolvedAt IS NULL THEN 1 ELSE 0 END AS BIT) AS IsBreached,
           t.CreatedAt, t.UpdatedAt,
           200 AS ResponseCode, 'Tickets retrieved successfully' AS ResponseMess
    FROM dbo.tblTicket t
    WHERE t.CompId=@CompId
      AND (@BranchId   IS NULL OR t.BranchId=@BranchId)
      AND (@StageId    IS NULL OR t.StageId=@StageId)
      AND (@Priority   IS NULL OR t.Priority=@Priority)
      AND (@CategoryId IS NULL OR t.CategoryId=@CategoryId)
      AND (@AssignedTo IS NULL OR t.AssignedTo=@AssignedTo)
      AND (@BreachedOnly=0 OR (t.SLADueAt < GETDATE() AND t.ResolvedAt IS NULL))
      AND (@SearchTerm IS NULL OR t.CustomerName LIKE '%'+@SearchTerm+'%'
                              OR t.TicketNo LIKE '%'+@SearchTerm+'%'
                              OR t.Contact LIKE '%'+@SearchTerm+'%')
    ORDER BY t.CreatedAt DESC, t.Id DESC
    OFFSET (@PageNumber-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total=0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT)/@PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO

/* ============================================================
   sp_FetchTicketDetail — 4 result sets (core, custom, activity, linked lead)
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_FetchTicketDetail
    @CompId INT,
    @TicketId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT t.Id, t.CompId, t.BranchId, t.TicketNo, t.CustomerName, t.Contact, t.Channel,
           t.CategoryId, t.Priority, t.PipelineId, t.StageId, t.AssignedTo, t.LinkedLeadId,
           t.SLADueAt, t.ResolvedAt, t.ClosedAt, t.ResolutionId, t.Description,
           CAST(CASE WHEN t.SLADueAt < GETDATE() AND t.ResolvedAt IS NULL THEN 1 ELSE 0 END AS BIT) AS IsBreached,
           t.CreatedAt, t.UpdatedAt,
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

/* ============================================================
   sp_MoveTicketStage — generic stage change + activity
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_MoveTicketStage
    @CompId INT, @TicketId INT, @StageId INT, @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id=@TicketId AND CompId=@CompId)
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    -- stage must belong to a ticket pipeline of this company (not a sales stage)
    IF NOT EXISTS (SELECT 1 FROM dbo.tblPipelineStage s
                   INNER JOIN dbo.tblPipeline p ON p.Id = s.PipelineId
                   WHERE s.Id=@StageId AND s.CompId=@CompId AND p.Entity='ticket')
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Stage not found' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        UPDATE dbo.tblTicket SET StageId=@StageId, EditBy=@UserId, UpdatedAt=GETDATE()
        WHERE Id=@TicketId AND CompId=@CompId;
        INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
            @CompId=@CompId, @TicketId=@TicketId, @UserId=@UserId, @Type='stage_changed', @Summary='stage_changed', @MetaJSON=NULL;
        COMMIT TRANSACTION;
        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Ticket stage updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

/* ============================================================
   sp_ResolveTicket / sp_CloseTicket / sp_ReopenTicket
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_ResolveTicket
    @CompId INT, @TicketId INT, @ResolutionId INT, @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id=@TicketId AND CompId=@CompId)
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    IF @ResolutionId IS NULL OR @ResolutionId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Resolution is required' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        -- Advance to the pipeline's first 'won' (Resolved) stage so the board
        -- column matches the resolved status (spec §6). Keep the current stage
        -- if the pipeline has no won stage.
        DECLARE @WonStage INT = (SELECT TOP 1 s.Id FROM dbo.tblPipelineStage s
            INNER JOIN dbo.tblTicket t ON t.PipelineId = s.PipelineId
            WHERE t.Id=@TicketId AND s.CompId=@CompId AND s.IsActive=1 AND s.StageType='won'
            ORDER BY s.SortOrder);
        UPDATE dbo.tblTicket
        SET ResolutionId=@ResolutionId, ResolvedAt=GETDATE(),
            StageId=ISNULL(@WonStage, StageId), EditBy=@UserId, UpdatedAt=GETDATE()
        WHERE Id=@TicketId AND CompId=@CompId;
        INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
            @CompId=@CompId, @TicketId=@TicketId, @UserId=@UserId, @Type='resolved', @Summary='resolved', @MetaJSON=NULL;
        COMMIT TRANSACTION;
        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Ticket resolved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROC dbo.sp_CloseTicket
    @CompId INT, @TicketId INT, @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id=@TicketId AND CompId=@CompId)
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        UPDATE dbo.tblTicket SET ClosedAt=GETDATE(), EditBy=@UserId, UpdatedAt=GETDATE()
        WHERE Id=@TicketId AND CompId=@CompId;
        INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
            @CompId=@CompId, @TicketId=@TicketId, @UserId=@UserId, @Type='closed', @Summary='closed', @MetaJSON=NULL;
        COMMIT TRANSACTION;
        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Ticket closed successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROC dbo.sp_ReopenTicket
    @CompId INT, @TicketId INT, @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id=@TicketId AND CompId=@CompId)
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        -- clear resolution + closure so SLA breach + workflow resume; audit stays in activity
        UPDATE dbo.tblTicket SET ResolvedAt=NULL, ClosedAt=NULL, ResolutionId=NULL, EditBy=@UserId, UpdatedAt=GETDATE()
        WHERE Id=@TicketId AND CompId=@CompId;
        INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
            @CompId=@CompId, @TicketId=@TicketId, @UserId=@UserId, @Type='reopened', @Summary='reopened', @MetaJSON=NULL;
        COMMIT TRANSACTION;
        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Ticket reopened successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

/* ============================================================
   sp_DeleteTicket — remove ticket + its custom values + activity
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_DeleteTicket
    @Id INT, @CompId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM dbo.tblCustomFieldValue WHERE CompId=@CompId AND Entity='ticket' AND EntityId=@Id;
        DELETE FROM dbo.tblTicketActivity WHERE CompId=@CompId AND TicketId=@Id;
        DELETE FROM dbo.tblTicket WHERE Id=@Id AND CompId=@CompId;
        COMMIT TRANSACTION;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Ticket deleted successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

/* ============================================================
   sp_SaveSLARule / sp_FetchSLARules
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_SaveSLARule
    @Id INT = 0, @CompId INT, @Priority INT, @ResponseMins INT = NULL, @ResolutionMins INT = NULL, @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @CompId IS NULL OR @CompId <= 0 OR @Priority IS NULL OR @Priority <= 0
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'CompId and Priority are required' AS ResponseMess; RETURN; END
    BEGIN TRY
        IF @Id > 0
            UPDATE dbo.tblSLARule SET Priority=@Priority, ResponseMins=@ResponseMins, ResolutionMins=@ResolutionMins,
                   EditBy=@UserId, UpdatedAt=GETDATE()
            WHERE Id=@Id AND CompId=@CompId;
        ELSE
            INSERT INTO dbo.tblSLARule (CompId, Priority, ResponseMins, ResolutionMins, IsActive, CreatedBy, CreatedAt)
            VALUES (@CompId, @Priority, @ResponseMins, @ResolutionMins, 1, @UserId, GETDATE());
        SELECT ISNULL(NULLIF(@Id,0), CAST(SCOPE_IDENTITY() AS INT)) AS Id, 200 AS ResponseCode, 'SLA rule saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        SELECT ISNULL(@Id,0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROC dbo.sp_FetchSLARules
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.Id, r.CompId, r.Priority, lk.Value AS PriorityName,
           r.ResponseMins, r.ResolutionMins, r.IsActive,
           200 AS ResponseCode, 'SLA rules retrieved successfully' AS ResponseMess
    FROM dbo.tblSLARule r
    LEFT JOIN dbo.tblLookup lk ON lk.Id = r.Priority
    WHERE r.CompId=@CompId AND r.IsActive=1
    ORDER BY lk.SortOrder, r.Id;
END
GO

/* ============================================================
   Reports: SLA breach / by category / resolution summary
   ============================================================ */
CREATE OR ALTER PROC dbo.sp_SLABreachSummary
    @CompId INT, @BranchId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT lk.Id AS Priority, lk.Value AS PriorityName,
           COUNT(t.Id) AS TotalOpen,
           SUM(CASE WHEN t.SLADueAt < GETDATE() AND t.ResolvedAt IS NULL THEN 1 ELSE 0 END) AS Breached,
           200 AS ResponseCode, 'SLA breach summary retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblTicket t
           ON t.Priority = lk.Id AND t.CompId=@CompId AND t.ResolvedAt IS NULL
          AND (@BranchId IS NULL OR t.BranchId=@BranchId)
    WHERE lk.CompId=@CompId AND lk.Kind='priority' AND lk.IsActive=1
    GROUP BY lk.Id, lk.Value, lk.SortOrder
    ORDER BY lk.SortOrder;
END
GO

CREATE OR ALTER PROC dbo.sp_TicketsByCategory
    @CompId INT, @BranchId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT lk.Id AS CategoryId, lk.Value AS CategoryName,
           COUNT(t.Id) AS TicketCount,
           200 AS ResponseCode, 'Tickets by category retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblTicket t
           ON t.CategoryId = lk.Id AND t.CompId=@CompId
          AND (@BranchId IS NULL OR t.BranchId=@BranchId)
    WHERE lk.CompId=@CompId AND lk.Kind='ticket_category' AND lk.IsActive=1
    GROUP BY lk.Id, lk.Value, lk.SortOrder
    ORDER BY lk.SortOrder;
END
GO

CREATE OR ALTER PROC dbo.sp_ResolutionSummary
    @CompId INT, @BranchId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT lk.Id AS ResolutionId, lk.Value AS ResolutionName,
           COUNT(t.Id) AS TicketCount,
           200 AS ResponseCode, 'Resolution summary retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblTicket t
           ON t.ResolutionId = lk.Id AND t.CompId=@CompId AND t.ResolvedAt IS NOT NULL
          AND (@BranchId IS NULL OR t.BranchId=@BranchId)
    WHERE lk.CompId=@CompId AND lk.Kind='resolution' AND lk.IsActive=1
    GROUP BY lk.Id, lk.Value, lk.SortOrder
    ORDER BY lk.SortOrder;
END
GO
