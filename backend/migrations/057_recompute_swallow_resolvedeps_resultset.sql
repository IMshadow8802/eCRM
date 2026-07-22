-- 057_recompute_swallow_resolvedeps_resultset.sql
-- ============================================================================
-- BUG FIX (procs only, no schema).  *** RE-APPLY: supersedes the first cut ***
--
-- Symptom: ticking (or deleting) the LAST unchecked checklist item on a task
-- "fails then works" — 9 of 10 fine, the last one 500s in the UI even though
-- the write committed.
--
-- Cause: sp_ResolveDependencies ends with `SELECT ... FROM @Unblocked`, so it
-- emits a result set. It runs ONLY when a task flips to complete (the last
-- tick) via sp_RecomputeTaskCompletion. That stray result set propagates out
-- of sp_SaveTaskChecklist / sp_DeleteTaskChecklist as recordsets[0], shoving
-- the real status row to recordsets[1]. The Node controller reads
-- recordsets[0][0] -> wrong/undefined -> 500. A false failure: the DB already
-- saved it, so a refetch shows it done.
--
-- Fix: sp_ResolveDependencies simply stops emitting a result set — nobody
-- consumes it (its only caller is sp_RecomputeTaskCompletion, and no backend
-- code calls it directly). The dependency-unblocking UPDATE is unchanged.
-- sp_RecomputeTaskCompletion is restored to a plain EXEC.
--
-- (The first cut of this script tried `INSERT INTO @sink EXEC` to swallow the
--  result set; that made the chain a nested INSERT EXEC and failed with
--  Msg 8164 in the verify block. Removing the SELECT at the source is simpler
--  and has no such hazard. Safe to re-run — both statements are ALTERs.)
-- ============================================================================
USE [eCRM+];
GO

ALTER PROCEDURE dbo.sp_ResolveDependencies
    @ResolvedTaskId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    -- Unblock every task whose 'blocks' dependencies are now all complete.
    -- No result set on purpose: emitting one here leaked into the caller
    -- (sp_RecomputeTaskCompletion -> sp_SaveTaskChecklist/DeleteTaskChecklist)
    -- and displaced their status row — the last-item "fail then works" bug.
    UPDATE t
       SET IsBlocked = 0, UpdatedDate = GETDATE()
      FROM dbo.tblTasks t
     WHERE t.IsBlocked = 1
       AND EXISTS (SELECT 1 FROM dbo.tblTaskDependencies d
                    WHERE d.TaskId = t.Id AND d.DependsOnTaskId = @ResolvedTaskId
                      AND d.Type = 'blocks')
       AND NOT EXISTS (
           SELECT 1 FROM dbo.tblTaskDependencies d2
           JOIN dbo.tblTasks b ON b.Id = d2.DependsOnTaskId
           WHERE d2.TaskId = t.Id AND d2.Type = 'blocks'
             AND ISNULL(b.IsCompleted, 0) = 0
       );
END
GO

ALTER PROCEDURE dbo.sp_RecomputeTaskCompletion
    @TaskId       BIGINT,
    @ActingUserId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Total INT, @Open INT, @Was BIT;

    SELECT @Was = ISNULL(IsCompleted, 0) FROM dbo.tblTasks WHERE Id = @TaskId;
    SELECT @Total = COUNT(*),
           @Open  = SUM(CASE WHEN ISNULL(IsCompleted,0) = 0 THEN 1 ELSE 0 END)
      FROM dbo.tblTaskChecklist WHERE TaskId = @TaskId;

    DECLARE @Now BIT = CASE WHEN @Total > 0 AND @Open = 0 THEN 1 ELSE 0 END;

    UPDATE dbo.tblTasks
       SET IsCompleted = @Now,
           CompletedDate = CASE
               WHEN @Now = 1 AND CompletedDate IS NULL THEN GETDATE()
               WHEN @Now = 0 THEN NULL
               ELSE CompletedDate END,
           CompletedByUserId = CASE
               WHEN @Now = 1 AND CompletedByUserId IS NULL
               THEN ISNULL(@ActingUserId, CreatedByUserId)
               WHEN @Now = 0 THEN NULL
               ELSE CompletedByUserId END,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    -- sp_ResolveDependencies no longer returns a result set, so a plain EXEC
    -- is safe — nothing leaks out to this proc's caller.
    IF (@Now = 1 AND @Was = 0)
        EXEC dbo.sp_ResolveDependencies @ResolvedTaskId = @TaskId;
END
GO

-- ============================================================================
-- VERIFY AFTER APPLY  (self-contained; creates throwaway rows, rolls back)
-- Expected single result set:
--   Rows = 1, StatusMess = 'Checklist item updated', DependentUnblocked = 0
--     - Rows = 1  -> only the checklist status came back (pre-fix the leaked
--                    'Dependencies resolved' row landed here first)
--     - StatusMess is the CHECKLIST status, not 'Dependencies resolved'
--     - DependentUnblocked = 0 proves sp_ResolveDependencies still ran (the
--       blocked dependent was unblocked by completing its blocker)
-- ============================================================================
BEGIN TRAN;

    DECLARE @Actor INT = (SELECT TOP 1 Id FROM dbo.tblUser WHERE IsActive = 1 ORDER BY Id);

    -- B = the task we complete; A = a task blocked on B
    INSERT INTO dbo.tblTasks (Title, CreatedByUserId, IsCompleted)
    VALUES ('__verify_B_blocker', @Actor, 0);
    DECLARE @TaskB BIGINT = SCOPE_IDENTITY();

    INSERT INTO dbo.tblTasks (Title, CreatedByUserId, IsCompleted)
    VALUES ('__verify_A_dependent', @Actor, 0);
    DECLARE @TaskA BIGINT = SCOPE_IDENTITY();

    -- A depends on (is blocked by) B, and is currently blocked
    INSERT INTO dbo.tblTaskDependencies (TaskId, DependsOnTaskId, Type, CreatedByUserId, CreatedDate)
    VALUES (@TaskA, @TaskB, 'blocks', @Actor, GETDATE());
    UPDATE dbo.tblTasks SET IsBlocked = 1 WHERE Id = @TaskA;

    -- One open checklist item on B -> ticking it flips B complete
    INSERT INTO dbo.tblTaskChecklist (TaskId, ItemText, IsCompleted, SortOrder)
    VALUES (@TaskB, '__verify_item', 0, 1);
    DECLARE @Item BIGINT = SCOPE_IDENTITY();

    -- Exercise the real write path and capture whatever it emits
    DECLARE @Res TABLE (ResponseCode INT, ResponseMess VARCHAR(400), ChecklistId BIGINT);
    INSERT INTO @Res
    EXEC dbo.sp_SaveTaskChecklist
        @Id = @Item, @TaskId = @TaskB, @ItemText = '__verify_item',
        @IsCompleted = 1, @SortOrder = 1, @CompId = 1, @BranchId = 1,
        @ActingUserId = @Actor;

    SELECT (SELECT COUNT(*) FROM @Res)                              AS Rows,
           (SELECT TOP 1 ResponseMess FROM @Res)                   AS StatusMess,
           (SELECT ISNULL(IsBlocked,0) FROM dbo.tblTasks WHERE Id = @TaskA) AS DependentUnblocked;

ROLLBACK TRAN;
GO
