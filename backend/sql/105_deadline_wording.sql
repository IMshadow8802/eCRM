-- 105_deadline_wording.sql — plain words in the task-deadline alerts and messages.
-- "ran over" -> "missed its deadline", "clock" -> "deadline", "verdict" -> "decision".
-- Wording only: logic of all four procedures is unchanged (copied from live, 2026-10-08).
-- Also rewords alerts already sent so old and new read the same.
-- Apply on BOTH databases (eCRM+ and SolarCRM):
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "eCRM+"    -C -b -I -i sql/105_deadline_wording.sql
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "SolarCRM" -C -b -I -i sql/105_deadline_wording.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ===========================================================================
-- Sweep (every 60 s per live company, after processPending).
--    One notification per recipient per kind per run, from rows stamped in THIS run.
--    RS1 = notified UserId rows.
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_TatSweep
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Released TABLE (TatId BIGINT);
    DECLARE @warn   TABLE (TatId BIGINT, TaskId BIGINT, UserId INT, BranchId BIGINT);
    DECLARE @breach TABLE (TatId BIGINT, TaskId BIGINT, UserId INT, BranchId BIGINT);
    DECLARE @Mgr TABLE (UserId INT, Source VARCHAR(10));
    DECLARE @Rcpt TABLE (Kind VARCHAR(12), RecipientId INT, TaskId BIGINT, BranchId BIGINT);
    DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
    DECLARE @PersonId INT, @RecipientId INT, @Kind VARCHAR(12), @Cnt INT, @EntityId BIGINT,
            @BranchId BIGINT, @Title VARCHAR(200);

    BEGIN TRY
        BEGIN TRAN;

        -- 1. Auto-release manual holds past their AutoReleaseAt.
        UPDATE h SET EndedAt = GETDATE()
        OUTPUT inserted.TatId INTO @Released (TatId)
        FROM dbo.tblTaskTatHold h
        JOIN dbo.tblTaskTat tt ON tt.Id = h.TatId
        WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL
          AND h.Kind = 'manual' AND h.EndedAt IS NULL AND h.AutoReleaseAt < GETDATE();

        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue)
        SELECT TatId, 'release', N'auto' FROM @Released;

        UPDATE tt
           SET DueStale = 1, StaleKind = CASE WHEN tt.DueStale = 1 THEN tt.StaleKind ELSE 'hold' END,
               StaleSeq = tt.StaleSeq + 1
        FROM dbo.tblTaskTat tt
        WHERE tt.Id IN (SELECT TatId FROM @Released);

        -- 2. Warn.
        UPDATE tt SET WarnedAt = GETDATE()
        OUTPUT inserted.Id, inserted.TaskId, inserted.UserId, inserted.BranchId INTO @warn
        FROM dbo.tblTaskTat tt
        WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL AND tt.DueStale = 0 AND tt.WarnedAt IS NULL
          AND tt.WarnAt <= GETDATE()
          AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatHold h WHERE h.TatId = tt.Id AND h.EndedAt IS NULL);

        -- 3. Breach.
        UPDATE tt SET BreachedAt = GETDATE()
        OUTPUT inserted.Id, inserted.TaskId, inserted.UserId, inserted.BranchId INTO @breach
        FROM dbo.tblTaskTat tt
        WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL AND tt.DueStale = 0 AND tt.BreachedAt IS NULL
          AND tt.DueAt <= GETDATE()
          AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatHold h WHERE h.TatId = tt.Id AND h.EndedAt IS NULL);

        -- Recipients. A clock warned and breached in the same run only says "missed".
        INSERT INTO @Rcpt (Kind, RecipientId, TaskId, BranchId)
        SELECT 'tat_warning', w.UserId, w.TaskId, w.BranchId
        FROM @warn w WHERE NOT EXISTS (SELECT 1 FROM @breach b WHERE b.TatId = w.TatId);

        INSERT INTO @Rcpt (Kind, RecipientId, TaskId, BranchId)
        SELECT 'tat_breach', UserId, TaskId, BranchId FROM @breach;

        DECLARE ppl CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT UserId FROM @breach;
        OPEN ppl;
        FETCH NEXT FROM ppl INTO @PersonId;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            DELETE FROM @Mgr;
            INSERT INTO @Mgr (UserId, Source) EXEC dbo.sp_FetchPersonManagers @UserId = @PersonId, @CompId = @CompId;
            INSERT INTO @Rcpt (Kind, RecipientId, TaskId, BranchId)
            SELECT 'tat_breach', m.UserId, b.TaskId, b.BranchId
            FROM @Mgr m CROSS JOIN @breach b
            WHERE b.UserId = @PersonId;
            FETCH NEXT FROM ppl INTO @PersonId;
        END
        CLOSE ppl; DEALLOCATE ppl;

        -- One notification per recipient per kind.
        DECLARE rcp CURSOR LOCAL FAST_FORWARD FOR
            SELECT Kind, RecipientId, COUNT(DISTINCT TaskId), MIN(TaskId), MIN(BranchId)
            FROM @Rcpt GROUP BY Kind, RecipientId;
        OPEN rcp;
        FETCH NEXT FROM rcp INTO @Kind, @RecipientId, @Cnt, @EntityId, @BranchId;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @Title = CASE
                WHEN @Kind = 'tat_warning' AND @Cnt = 1 THEN '1 task is close to its deadline'
                WHEN @Kind = 'tat_warning'              THEN CAST(@Cnt AS VARCHAR(10)) + ' tasks are close to their deadline'
                WHEN @Cnt = 1                           THEN '1 task missed its deadline'
                ELSE CAST(@Cnt AS VARCHAR(10)) + ' tasks missed their deadline' END;

            -- EXEC arguments cannot be expressions; several tasks link nowhere.
            IF @Cnt <> 1 SET @EntityId = 0;
            INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                @UserId = @RecipientId, @Type = @Kind, @EntityType = 'task',
                @EntityId = @EntityId,
                @ActorUserId = NULL, @Title = @Title, @Body = NULL,
                @CompId = @CompId, @BranchId = @BranchId, @SkipSelf = 1;
            FETCH NEXT FROM rcp INTO @Kind, @RecipientId, @Cnt, @EntityId, @BranchId;
        END
        CLOSE rcp; DEALLOCATE rcp;

        COMMIT;
        SELECT DISTINCT UserId FROM @ntf WHERE NotificationId IS NOT NULL;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- @UserId NULL = every open clock of the task; a clock already on hold (manual or blocked)
-- is left alone. RS1 status; RS2 notified UserId rows.
CREATE OR ALTER PROCEDURE dbo.sp_TatHold
    @CompId        BIGINT,
    @TaskId        BIGINT,
    @UserId        INT           = NULL,
    @ReasonId      INT,
    @Remarks       NVARCHAR(500) = NULL,
    @ActorUserId   INT,
    @AutoReleaseAt DATETIME      = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Reason NVARCHAR(200), @Title VARCHAR(200), @Body NVARCHAR(1000),
            @BranchId BIGINT, @RecipientId INT;
    DECLARE @Held TABLE (TatId BIGINT);
    DECLARE @Mgr TABLE (UserId INT, Source VARCHAR(10));
    DECLARE @Notified TABLE (UserId INT);
    DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));

    SELECT @Reason = Value FROM dbo.tblLookup
     WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'task_hold_reason' AND IsActive = 1;
    IF @Reason IS NULL
    BEGIN
        SELECT 400 AS ResponseCode, 'Pick a reason for the hold' AS ResponseMess, 0 AS Held;
        SELECT UserId FROM @Notified; RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskTat
                    WHERE CompId = @CompId AND TaskId = @TaskId AND ClosedAt IS NULL
                      AND (@UserId IS NULL OR UserId = @UserId))
    BEGIN
        SELECT 404 AS ResponseCode, 'This task has no deadline running' AS ResponseMess, 0 AS Held;
        SELECT UserId FROM @Notified; RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;
        INSERT INTO dbo.tblTaskTatHold (TatId, Kind, ReasonId, Remarks, StartedBy, AutoReleaseAt)
        OUTPUT inserted.TatId INTO @Held (TatId)
        SELECT tt.Id, 'manual', @ReasonId, NULLIF(LTRIM(RTRIM(@Remarks)), N''), @ActorUserId, @AutoReleaseAt
        FROM dbo.tblTaskTat tt
        WHERE tt.CompId = @CompId AND tt.TaskId = @TaskId AND tt.ClosedAt IS NULL
          AND (@UserId IS NULL OR tt.UserId = @UserId)
          AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatHold h
                           WHERE h.TatId = tt.Id AND h.EndedAt IS NULL);   -- one open hold per clock, any kind

        IF NOT EXISTS (SELECT 1 FROM @Held)
        BEGIN
            ROLLBACK;
            SELECT 409 AS ResponseCode, 'Already on hold' AS ResponseMess, 0 AS Held;
            SELECT UserId FROM @Notified; RETURN;
        END

        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue, ActorUserId)
        SELECT TatId, 'hold', LEFT(@Reason, 200), @ActorUserId FROM @Held;

        -- Holding your own clock tells your manager (else the admins).
        IF @UserId = @ActorUserId
        BEGIN
            SELECT TOP 1 @BranchId = tt.BranchId,
                         @Title = LEFT(ISNULL(u.FullName, u.Username) + ' put a task on hold', 200),
                         @Body  = LEFT(tt.TaskTitle + N' — ' + @Reason
                                       + ISNULL(N': ' + NULLIF(LTRIM(RTRIM(@Remarks)), N''), N''), 1000)
              FROM dbo.tblTaskTat tt
              JOIN @Held hd ON hd.TatId = tt.Id
              JOIN dbo.tblUser u ON u.Id = tt.UserId;

            INSERT INTO @Mgr (UserId, Source) EXEC dbo.sp_FetchPersonManagers @UserId = @UserId, @CompId = @CompId;

            DECLARE rcp CURSOR LOCAL FAST_FORWARD FOR SELECT UserId FROM @Mgr;
            OPEN rcp;
            FETCH NEXT FROM rcp INTO @RecipientId;
            WHILE @@FETCH_STATUS = 0
            BEGIN
                INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                    @UserId = @RecipientId, @Type = 'tat_hold', @EntityType = 'task',
                    @EntityId = @TaskId, @ActorUserId = @ActorUserId, @Title = @Title, @Body = @Body,
                    @CompId = @CompId, @BranchId = @BranchId, @SkipSelf = 1;
                FETCH NEXT FROM rcp INTO @RecipientId;
            END
            CLOSE rcp; DEALLOCATE rcp;

            INSERT INTO @Notified (UserId)
            SELECT DISTINCT UserId FROM @ntf WHERE NotificationId IS NOT NULL;
        END
        COMMIT;
        SELECT 200 AS ResponseCode, 'On hold' AS ResponseMess, (SELECT COUNT(*) FROM @Held) AS Held;
        SELECT UserId FROM @Notified;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, 0 AS Held;
        SELECT CAST(NULL AS INT) AS UserId WHERE 1 = 0;
    END CATCH
END
GO

-- The person's own reason for missing the deadline.
CREATE OR ALTER PROCEDURE dbo.sp_TatSaveReason
    @CompId   BIGINT,
    @TatId    BIGINT,
    @UserId   INT,
    @ReasonId INT,
    @Remarks  NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT, @Breached DATETIME, @Code VARCHAR(30), @Value NVARCHAR(200);
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    SELECT @Owner = UserId, @Breached = BreachedAt FROM dbo.tblTaskTat WHERE Id = @TatId AND CompId = @CompId;
    IF @Owner IS NULL
    BEGIN SELECT 404 AS ResponseCode, 'Task deadline not found' AS ResponseMess; RETURN; END
    IF @Owner <> @UserId
    BEGIN SELECT 403 AS ResponseCode, 'Only the person the task is assigned to can explain the delay' AS ResponseMess; RETURN; END
    IF @Breached IS NULL
    BEGIN SELECT 409 AS ResponseCode, 'This task has not missed its deadline' AS ResponseMess; RETURN; END

    SELECT @Code = Code, @Value = Value FROM dbo.tblLookup
     WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'task_breach_reason' AND IsActive = 1;
    IF @Value IS NULL
    BEGIN SELECT 400 AS ResponseCode, 'Pick a reason' AS ResponseMess; RETURN; END
    IF @Code = 'other' AND @Remarks IS NULL
    BEGIN SELECT 400 AS ResponseCode, 'Add a few words for "Other"' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblTaskTat
           SET BreachReasonId = @ReasonId, BreachRemarks = @Remarks, ReasonAt = GETDATE()
         WHERE Id = @TatId;
        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue, ActorUserId)
        VALUES (@TatId, 'reason', LEFT(@Value, 200), @UserId);
        COMMIT;
        SELECT 200 AS ResponseCode, 'Reason saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- A manager's call on a missed deadline: an active ReportsTo ancestor, or someone who manages the workspace.
CREATE OR ALTER PROCEDURE dbo.sp_TatSaveVerdict
    @CompId                BIGINT,
    @TatId                 BIGINT,
    @ActorUserId           INT,
    @Verdict               VARCHAR(12),
    @Remarks               NVARCHAR(500) = NULL,
    @ActorManagesWorkspace BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT, @Breached DATETIME, @Allowed BIT = ISNULL(@ActorManagesWorkspace, 0);
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    SELECT @Owner = UserId, @Breached = BreachedAt FROM dbo.tblTaskTat WHERE Id = @TatId AND CompId = @CompId;
    IF @Owner IS NULL
    BEGIN SELECT 404 AS ResponseCode, 'Task deadline not found' AS ResponseMess; RETURN; END
    IF @Owner = @ActorUserId
    BEGIN SELECT 403 AS ResponseCode, 'You cannot decide on your own delay' AS ResponseMess; RETURN; END

    IF @Allowed = 0
    BEGIN
        ;WITH chain AS (
            SELECT u.Id, u.ReportsTo, 0 AS Depth
              FROM dbo.tblUser u WHERE u.Id = @Owner AND u.CompId = @CompId
            UNION ALL
            SELECT m.Id, m.ReportsTo, c.Depth + 1
              FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
             WHERE m.CompId = @CompId AND c.Depth < 20
        )
        SELECT @Allowed = 1
          FROM chain c JOIN dbo.tblUser u ON u.Id = c.Id
         WHERE c.Depth > 0 AND u.Id = @ActorUserId AND u.IsActive = 1
        OPTION (MAXRECURSION 32);
    END
    IF @Allowed = 0
    BEGIN SELECT 403 AS ResponseCode, 'Only their manager or a workspace manager can decide this' AS ResponseMess; RETURN; END

    IF ISNULL(@Verdict, '') NOT IN ('excused','not_excused')
    BEGIN SELECT 400 AS ResponseCode, 'Invalid decision' AS ResponseMess; RETURN; END
    IF @Verdict = 'excused' AND @Remarks IS NULL
    BEGIN SELECT 400 AS ResponseCode, 'Say why the delay is accepted' AS ResponseMess; RETURN; END
    IF @Breached IS NULL
    BEGIN SELECT 409 AS ResponseCode, 'This task has not missed its deadline' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblTaskTat
           SET Verdict = @Verdict, VerdictBy = @ActorUserId, VerdictRemarks = @Remarks, VerdictAt = GETDATE()
         WHERE Id = @TatId;
        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue, ActorUserId)
        VALUES (@TatId, 'verdict', @Verdict, @ActorUserId);
        COMMIT;
        SELECT 200 AS ResponseCode, 'Saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- Alerts already sent read the same as new ones.
UPDATE dbo.tblNotifications
   SET Title = REPLACE(REPLACE(REPLACE(Title,
               ' tasks are about to run over', ' tasks are close to their deadline'),
               ' task is about to run over',   ' task is close to its deadline'),
               ' tasks ran over',              ' tasks missed their deadline')
 WHERE Type = 'tat_warning' OR Type = 'tat_breach';
UPDATE dbo.tblNotifications
   SET Title = REPLACE(Title, ' task ran over', ' task missed its deadline')
 WHERE Type = 'tat_breach';
GO

-- VERIFY AFTER APPLY (expect 0, then the new titles):
-- SELECT COUNT(*) FROM tblNotifications WHERE Title LIKE '%run over%' OR Title LIKE '%ran over%';
-- SELECT DISTINCT Title FROM tblNotifications WHERE Type IN ('tat_warning','tat_breach');
-- SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_TatSweep')) LIKE '%missed its deadline%';
