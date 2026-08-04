-- ============================================================================
-- 069_tenancy_guards.sql
--
-- Closes four cross-company holes and one write-path hole found in the
-- 2026-08-04 audit. Every one of these was verified against this database
-- before the script was written.
--
-- PARTIAL-APPLY NOTE (2026-08-04, 15:06)
--
--   Sections 3, 4 and 5 applied cleanly on the first run and are already live.
--   All three are CREATE OR ALTER, so re-running this whole file is safe and
--   idempotent.
--
--   Sections 1 and 2 FAILED, and the failure was the useful part — see below.
--   They are now DROPs rather than rewrites.
--
-- THE HOLES
--
--   sp_FollowupsListUserWise   @StartDate, @EndDate         <- that is ALL
--   sp_LeadSummaryBranchWise   @StartDate, @EndDate         <- that is ALL
--
--     Not "the controller forgets to pass CompId" — there was no parameter to
--     pass. Both were reachable at /api/reports/getFollowupsUserWise and
--     /api/reports/getLeadSummaryBranchWise.
--
--     But they never leaked, because they never returned anything: both
--     referenced tblLeads.AssignTo, .FollowupDate, .LeadDate and .LeadStatus,
--     none of which have existed since the lead schema moved to the config
--     engine (OwnerId / NextFollowupDate / CreatedAt / StageId+WonAt). SQL
--     Server's deferred name resolution let them sit here compiling fine and
--     failing only on execution, so they have been a 500 on every call for
--     months. Trying to CREATE OR ALTER them forced validation and surfaced it.
--
--     Nothing in web or mobile calls either one. Rewriting a report that has
--     never successfully run, against a guess at what the old columns meant,
--     is inventing a feature — so they are dropped along with their routes and
--     controller methods. Rebuilding them is a separate, deliberate piece of
--     work if the reports are ever actually wanted.
--
--   sp_FetchFollowUp           filters on scope, never on company
--
--     Its only tenant-ish filter is @AccessibleBranchIdsJson, and the SP
--     treats NULL as "no filter". The controller currently sends NULL whenever
--     the caller's scope resolves to zero branches, so an empty scope returns
--     every follow-up in every company. The @Id branch has no filter at all.
--
--   sp_DeleteUserBranchAccess  @Id                          <- that is ALL
--
--     Deletes whatever row id it is handed. Company A's admin can strip branch
--     permissions from Company B's users by guessing ids. Its siblings
--     sp_SaveUserBranchAccess and sp_FetchUserBranchAccess both take @CompId;
--     only delete was missed.
--
--   sp_SaveTicket              LinkedLeadId = @LinkedLeadId  (unconditional)
--
--     Its neighbours on the same line are guarded — PipelineId=ISNULL(...),
--     StageId=ISNULL(...) — but LinkedLeadId is not. The mobile complaint form
--     does not send it, so saving an edit from a phone silently NULLs it and
--     destroys the lead <-> ticket join. Web echoes the current value back
--     (TicketDetail.jsx:209) and no client has a "clear the link" action, so
--     guarding it takes nothing away.
--
-- WHAT IS DELIBERATELY *NOT* HERE
--
--   sp_SaveTask's UPDATE branch writes LoggedHours/Progress/Labels/Watchers/
--   TeamId/ParentTaskId/ProjectId unconditionally, and mobile's partial payload
--   zeroes them. That reads like the same bug, and it is NOT: web does a full
--   read-modify-write (TaskDetailModal.jsx:179-190) and genuinely relies on
--   being able to clear those fields. Adding ISNULL guards here would take a
--   working feature away from web to paper over a mobile bug. Mobile is being
--   fixed to echo the loaded values instead. Do not "helpfully" add them.
--
-- APPLY ORDER — READ THIS
--
--   @CompId is added as REQUIRED (validated, not defaulted-and-ignored), so
--   these procs cannot silently keep leaking if a caller is missed. That means
--   the backend deploy must follow this script promptly: between applying this
--   and deploying, the Reports screen and follow-up fetches will error rather
--   than return wrong data. That is the correct failure direction, but it is a
--   visible one — apply during a quiet window.
--
--     1. apply this script
--     2. deploy the backend (controllers pass CompId + scope)
--     3. run the VERIFY block at the bottom
--
-- Author: Claude  Date: 2026-08-04
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1 + 2. sp_FollowupsListUserWise, sp_LeadSummaryBranchWise — DROPPED
--
--    Both referenced columns that no longer exist (tblLeads.AssignTo,
--    .FollowupDate, .LeadDate, .LeadStatus), so both threw on every execution.
--    Neither is called by web or mobile. Their routes and controller methods
--    are removed in the same change.
--
--    Guarded so re-running this file is a no-op once they are gone.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_FollowupsListUserWise', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FollowupsListUserWise;
GO

IF OBJECT_ID('dbo.sp_LeadSummaryBranchWise', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_LeadSummaryBranchWise;
GO
-- ---------------------------------------------------------------------------
-- 3. sp_FetchFollowUp — +@CompId on BOTH branches
--
--    tblFollowUp carries its own CompId, so the filter goes on f, not through
--    the tblLeads join — a follow-up whose lead row was deleted still belongs
--    to a company and must not leak.
--
--    Everything else is unchanged from 054_followup_lifecycle.sql.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchFollowUp
(
    @Id                      INT = 0,
    @LeadId                  INT = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber              INT = 1,
    @PageSize                INT = 10,
    @SearchTerm              NVARCHAR(200) = NULL,
    @Status                  VARCHAR(50) = NULL,
    @CompId                  INT = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    IF (@CompId IS NULL OR @CompId <= 0)
    BEGIN
        SET @ResponseCode = 400; SET @ResponseMess = 'CompId is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblFollowUp f
        LEFT JOIN tblLeads l ON f.LeadId = l.Id
        WHERE f.CompId = @CompId
          AND (@LeadId = 0 OR f.LeadId = @LeadId)
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
          AND (@Status IS NULL OR ISNULL(f.Status, 'Pending') = @Status)
          AND (@SearchTerm IS NULL
               OR f.Remarks      LIKE '%' + @SearchTerm + '%'
               OR f.Status       LIKE '%' + @SearchTerm + '%'
               OR f.FollowupType LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No follow-up records found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS LeadId, NULL AS NextFollowupDate,
                   NULL AS FollowupType, NULL AS Remarks, NULL AS Status,
                   NULL AS CreatedBy, NULL AS CreatedDate;
            RETURN;
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Follow-ups retrieved successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               f.Id, f.LeadId, f.NextFollowupDate, f.FollowupType,
               f.Remarks, f.Status, f.SourceCallId,
               f.CreatedBy, f.CreatedDate, f.EditBy, f.EditDate
        FROM tblFollowUp f
        LEFT JOIN tblLeads l ON f.LeadId = l.Id
        WHERE f.CompId = @CompId
          AND (@LeadId = 0 OR f.LeadId = @LeadId)
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
          AND (@Status IS NULL OR ISNULL(f.Status, 'Pending') = @Status)
          AND (@SearchTerm IS NULL
               OR f.Remarks      LIKE '%' + @SearchTerm + '%'
               OR f.Status       LIKE '%' + @SearchTerm + '%'
               OR f.FollowupType LIKE '%' + @SearchTerm + '%')
        ORDER BY f.NextFollowupDate ASC, f.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        RETURN;
    END
    ELSE
    BEGIN
        -- Was `WHERE Id = @Id` with no tenant filter — any id, any company.
        IF EXISTS (SELECT 1 FROM tblFollowUp WHERE Id = @Id AND CompId = @CompId)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Follow-up record fetched successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   f.*
            FROM tblFollowUp f
            WHERE f.Id = @Id AND f.CompId = @CompId;
            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Follow-up not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
        END
    END
END
GO


-- ---------------------------------------------------------------------------
-- 4. sp_DeleteUserBranchAccess — +@CompId
--
--    Deliberately returns the same 404 for "does not exist" and "belongs to
--    another company". Distinguishing them turns the endpoint into an id
--    oracle for probing other tenants.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_DeleteUserBranchAccess
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF (@CompId IS NULL OR @CompId <= 0)
    BEGIN SELECT 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblUserBranchAccess WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Branch access not found' AS ResponseMess; RETURN; END

    DELETE FROM tblUserBranchAccess WHERE Id = @Id AND CompId = @CompId;
    SELECT 200 AS ResponseCode, 'Branch access removed' AS ResponseMess;
END
GO


-- ---------------------------------------------------------------------------
-- 5. sp_SaveTicket — guard LinkedLeadId
--
--    ONE line changes, on the UPDATE branch:
--        LinkedLeadId=@LinkedLeadId
--     -> LinkedLeadId=ISNULL(@LinkedLeadId, LinkedLeadId)
--
--    The rest is reproduced verbatim from 050_ticket_contact_person.sql —
--    T-SQL has no partial-alter, so the whole body has to travel.
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
                AssignedTo=@AssignedTo,
                -- Guarded, like PipelineId/StageId above it. A client that does
                -- not know about the lead link must not be able to sever it by
                -- omitting the field. Nothing clears a link today; if that ever
                -- becomes a feature it gets its own action, the way moving a
                -- stage has sp_MoveTicketStage.
                LinkedLeadId=ISNULL(@LinkedLeadId, LinkedLeadId),
                Description=@Description,
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


-- ============================================================================
-- VERIFY AFTER APPLY
--
-- (a) Every proc now declares the tenant parameter. Expect 5 rows, and every
--     has_compid value = 1.
-- ============================================================================
SELECT p.name,
       MAX(CASE WHEN par.name = '@CompId' THEN 1 ELSE 0 END) AS has_compid
  FROM sys.procedures p
  LEFT JOIN sys.parameters par ON par.object_id = p.object_id
 WHERE p.name IN ('sp_FetchFollowUp','sp_DeleteUserBranchAccess','sp_SaveTicket')
 GROUP BY p.name
 ORDER BY p.name;

-- ============================================================================
-- (b) The two broken reports are gone. Expect ZERO rows.
-- ============================================================================
SELECT name AS should_be_gone
  FROM sys.procedures
 WHERE name IN ('sp_FollowupsListUserWise','sp_LeadSummaryBranchWise');

-- ============================================================================
-- (c) The follow-up list is company-bound. Expect the SECOND call to return
--     TotalRecords = 0 while the first returns your real count — same rows,
--     different tenant asking.
--     Replace 1 with a real CompId, and 99999 with one that does not exist.
-- ============================================================================
EXEC dbo.sp_FetchFollowUp @CompId = 1,     @PageSize = 5;
EXEC dbo.sp_FetchFollowUp @CompId = 99999, @PageSize = 5;

-- ============================================================================
-- (d) The ticket link survives a save that omits it.
--     Rolled back — leaves nothing behind.
-- ============================================================================
BEGIN TRANSACTION;
    DECLARE @tid INT, @cid INT, @bid INT, @uid INT, @lead INT;

    SELECT TOP 1 @tid = Id, @cid = CompId, @bid = BranchId, @uid = CreatedBy
      FROM dbo.tblTicket WHERE LinkedLeadId IS NOT NULL ORDER BY Id DESC;

    IF @tid IS NULL
        SELECT 'SKIPPED - no ticket with a LinkedLeadId to test against' AS Note;
    ELSE
    BEGIN
        SELECT @lead = LinkedLeadId FROM dbo.tblTicket WHERE Id = @tid;

        -- A mobile-shaped save: no @LinkedLeadId, no @StageId.
        EXEC dbo.sp_SaveTicket
             @Id = @tid, @CompId = @cid, @BranchId = @bid, @UserId = @uid,
             @CustomerName = 'verify-069', @Description = 'verify-069';

        -- Expect link_preserved = 1.
        SELECT CASE WHEN LinkedLeadId = @lead THEN 1 ELSE 0 END AS link_preserved,
               @lead AS expected, LinkedLeadId AS actual
          FROM dbo.tblTicket WHERE Id = @tid;
    END
ROLLBACK TRANSACTION;
