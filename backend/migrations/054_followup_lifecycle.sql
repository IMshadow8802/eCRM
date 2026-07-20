-- 054_followup_lifecycle.sql
-- ============================================================================
-- Follow-up lifecycle: complete / reschedule / delete from the Follow-ups page.
--
--   1. sp_SaveFollowUp
--      - BUG FIX: the controller has always sent @SourceCallId but the live SP
--        never declared it, so EVERY save (create, complete, reschedule) died
--        with "@SourceCallId is not a parameter". Param added; stored on insert
--        (tblFollowUp.SourceCallId already exists — no ALTER TABLE needed).
--      - BUG FIX: the update path matched AND overwrote BranchId with the
--        CALLER's branch, so a cross-branch manager got a 404 and a same-branch
--        edit could re-home the row. Update now matches on Id + CompId only and
--        leaves CompId/BranchId/SourceCallId as they were.
--      - Completion needs no new column: Status already exists — the app writes
--        'Done' (with the row's other fields sent back unchanged).
--   2. sp_DeleteFollowUp
--      - SECURITY FIX: took only @Id — any authenticated user could delete any
--        company's follow-up. Now requires @CompId and deletes only within it.
--   3. sp_FetchFollowUp
--      - New optional @Status exact-match filter for the Pending/Done work
--        queue (NULL status counts as 'Pending'). Replaces the SearchTerm-LIKE
--        hack the web page used. Page rows now also return SourceCallId.
-- ============================================================================
USE [eCRM+];
GO

-- ---------------------------------------------------------------------------
-- 1. sp_SaveFollowUp — +@SourceCallId, tenant-safe update, keeps Status write
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE [dbo].[sp_SaveFollowUp]
(
    @Id INT = 0,
    @LeadId INT,
    @NextFollowupDate DATETIME = NULL,
    @FollowupType VARCHAR(50) = NULL,
    @Remarks VARCHAR(500) = NULL,
    @Status VARCHAR(50) = NULL,
    @SourceCallId INT = NULL,
    @CompId INT,
    @BranchId INT,
    @CreatedBy INT = NULL,
    @EditBy INT = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    -- Every path returns the SAME 3-column shape (ResponseCode, ResponseMess,
    -- FollowUpId) so INSERT INTO @tbl EXEC capture never breaks (051 doctrine).
    IF (@CompId IS NULL OR @CompId = 0 OR @BranchId IS NULL OR @BranchId = 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'CompId and BranchId are required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, NULL AS FollowUpId; RETURN; END

    IF (@Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = '')
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Remarks is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, NULL AS FollowUpId; RETURN; END

    IF (@Id = 0)
    BEGIN
        INSERT INTO tblFollowUp (CompId, BranchId, LeadId, NextFollowupDate, FollowupType,
                                 Remarks, Status, SourceCallId, CreatedBy, CreatedDate)
        VALUES (@CompId, @BranchId, @LeadId, @NextFollowupDate, @FollowupType,
                @Remarks, @Status, @SourceCallId, @CreatedBy, GETDATE());

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Follow-up created successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS FollowUpId;
        RETURN;
    END
    ELSE
    BEGIN
        -- Tenant gate is CompId only: BranchId is where the row LIVES, not who
        -- may edit it — branch visibility is already enforced by the fetch scope.
        UPDATE tblFollowUp
        SET LeadId = @LeadId,
            NextFollowupDate = @NextFollowupDate, FollowupType = @FollowupType,
            Remarks = @Remarks, Status = @Status, EditBy = @EditBy, EditDate = GETDATE()
        WHERE Id = @Id AND CompId = @CompId;

        IF (@@ROWCOUNT = 0)
        BEGIN SET @ResponseCode = 404;
              SET @ResponseMess = 'Follow-up not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, NULL AS FollowUpId; RETURN; END

        SET @ResponseCode = 200;
        SET @ResponseMess = 'Follow-up updated successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS FollowUpId;
        RETURN;
    END
END
GO

-- ---------------------------------------------------------------------------
-- 2. sp_DeleteFollowUp — @CompId required (closes cross-tenant delete hole)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE [dbo].[sp_DeleteFollowUp]
(
    @Id INT,
    @CompId INT
)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    IF (@CompId IS NULL OR @CompId = 0)
    BEGIN
        SET @ResponseCode = 400; SET @ResponseMess = 'CompId is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    DELETE FROM tblFollowUp WHERE Id = @Id AND CompId = @CompId;

    IF (@@ROWCOUNT = 0)
    BEGIN
        SET @ResponseCode = 404; SET @ResponseMess = 'Follow-up not found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    SET @ResponseCode = 200;
    SET @ResponseMess = 'Follow-up deleted successfully';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
END
GO

-- ---------------------------------------------------------------------------
-- 3. sp_FetchFollowUp — +@Status exact filter (NULL row status = 'Pending')
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE [dbo].[sp_FetchFollowUp]
(
    @Id INT = 0,
    @LeadId INT = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(200) = NULL,
    @Status VARCHAR(50) = NULL
)
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
        FROM tblFollowUp f
        LEFT JOIN tblLeads l ON f.LeadId = l.Id
        WHERE (@LeadId = 0 OR f.LeadId = @LeadId)
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
        WHERE (@LeadId = 0 OR f.LeadId = @LeadId)
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
        IF EXISTS (SELECT 1 FROM tblFollowUp WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Follow-up record fetched successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   f.*
            FROM tblFollowUp f
            WHERE f.Id = @Id;
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

-- ============================================================================
-- VERIFY AFTER APPLY (rollback transaction — leaves no data behind)
-- Expected result sets, in order:
--   1. 201 'Follow-up created successfully' + FollowUpId
--   2. 200 'Follow-up updated successfully'      (completed: Status -> Done)
--   3. one row, Status = 'Done'                  (@Status filter finds it)
--   4. 404 'Follow-up not found'                 (delete blocked cross-tenant)
--   5. 200 'Follow-up deleted successfully'      (delete works in-tenant)
-- ============================================================================
BEGIN TRANSACTION;
    -- Literals, not lookups: tblLeads may be empty (it was on 2026-07-19 and a
    -- NULL @CompId fired the SP's validation path, whose result shape then broke
    -- the INSERT..EXEC capture). tblFollowUp has no FK on LeadId, and everything
    -- rolls back, so a dummy LeadId is safe.
    DECLARE @LeadId INT = 999999,
            @CompId INT = 1,
            @WrongComp INT = 1000,  -- EXEC args must be plain variables/literals, no expressions
            @NewId  INT;

    DECLARE @created TABLE (ResponseCode INT, ResponseMess VARCHAR(200), FollowUpId INT);
    INSERT INTO @created
    EXEC dbo.sp_SaveFollowUp @Id = 0, @LeadId = @LeadId,
         @NextFollowupDate = '2026-01-01', @FollowupType = 'Call',
         @Remarks = 'verify 054', @Status = 'Pending', @SourceCallId = NULL,
         @CompId = @CompId, @BranchId = 1, @CreatedBy = 1, @EditBy = 1;
    SELECT * FROM @created;                                        -- (1)

    SET @NewId = (SELECT TOP 1 FollowUpId FROM @created);

    EXEC dbo.sp_SaveFollowUp @Id = @NewId, @LeadId = @LeadId,
         @NextFollowupDate = '2026-01-01', @FollowupType = 'Call',
         @Remarks = 'verify 054', @Status = 'Done',
         @CompId = @CompId, @BranchId = 1, @EditBy = 1;            -- (2)

    EXEC dbo.sp_FetchFollowUp @LeadId = @LeadId, @Status = 'Done', @PageSize = 5;  -- (3)

    EXEC dbo.sp_DeleteFollowUp @Id = @NewId, @CompId = @WrongComp;                 -- (4)
    EXEC dbo.sp_DeleteFollowUp @Id = @NewId, @CompId = @CompId;                    -- (5)
ROLLBACK TRANSACTION;
