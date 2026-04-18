-- ============================================================
-- Migration 019 — tblTasks.ProjectId → nullable
--
-- Oversight from migration 010: ProjectId left NOT NULL. Personal
-- workspaces have no project; sp_SaveTask (migration 015) tries to
-- insert NULL and fails.
--
-- Fix: flip the column to nullable. Existing rows (zero) unaffected.
-- Re-probe sp_SaveTask to confirm personal-task creation now works.
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Drop any FK / default on ProjectId first (safe no-ops if absent)
IF EXISTS (
    SELECT 1 FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
    WHERE fkc.parent_object_id = OBJECT_ID('dbo.tblTasks') AND c.name = 'ProjectId'
)
BEGIN
    DECLARE @fk sysname;
    SELECT @fk = fk.name
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
     WHERE fkc.parent_object_id = OBJECT_ID('dbo.tblTasks') AND c.name = 'ProjectId';
    EXEC('ALTER TABLE dbo.tblTasks DROP CONSTRAINT ' + @fk);
END;
GO

-- Drop any indexes that include ProjectId, if present (rebuild after)
DECLARE @pidx sysname;
DECLARE idx_cur CURSOR FAST_FORWARD LOCAL FOR
    SELECT DISTINCT i.name
      FROM sys.indexes i
      JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      JOIN sys.columns c         ON ic.object_id = c.object_id AND ic.column_id = c.column_id
     WHERE i.object_id = OBJECT_ID('dbo.tblTasks')
       AND c.name = 'ProjectId'
       AND i.is_primary_key = 0
       AND i.is_unique_constraint = 0;
OPEN idx_cur;
FETCH NEXT FROM idx_cur INTO @pidx;
WHILE (@@FETCH_STATUS = 0)
BEGIN
    DECLARE @dropIdx NVARCHAR(400) = N'DROP INDEX ' + QUOTENAME(@pidx) + N' ON dbo.tblTasks';
    EXEC sp_executesql @dropIdx;
    FETCH NEXT FROM idx_cur INTO @pidx;
END;
CLOSE idx_cur; DEALLOCATE idx_cur;
GO

-- Alter column to nullable
ALTER TABLE dbo.tblTasks ALTER COLUMN ProjectId INT NULL;
GO

-- Recreate helpful index (partial — only when ProjectId present)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'IX_tblTasks_ProjectId'
)
    CREATE INDEX IX_tblTasks_ProjectId ON dbo.tblTasks (ProjectId)
    WHERE ProjectId IS NOT NULL;
GO

-- Sanity
PRINT '----- migration 019 sanity -----';
SELECT 'tblTasks.ProjectId nullable' AS chk,
       CASE WHEN EXISTS (
           SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'ProjectId' AND is_nullable = 1
       ) THEN 'OK' ELSE 'STILL NOT NULL' END AS status;
GO

-- Re-probe: create task in user 2's personal workspace (should now succeed)
PRINT '----- probe: create task in personal workspace (UserId=2) -----';
DECLARE @PersonalWs BIGINT;
SELECT TOP 1 @PersonalWs = Id FROM dbo.tblWorkspaces WHERE OwnerUserId = 2 AND Type='personal';
EXEC dbo.sp_SaveTask
    @Id=0, @Title='Buy groceries', @Description='milk, eggs, bread',
    @WorkspaceId=@PersonalWs, @ProjectId=NULL, @ParentTaskId=NULL,
    @AssignedToUserId=2, @CreatedByUserId=2, @TeamId=NULL,
    @Priority='medium', @Type='task', @Status='todo',
    @DueDate=NULL, @EstimatedHours=0, @LoggedHours=0, @Progress=0, @IsBlocked=0,
    @Labels=NULL, @Watchers=NULL, @Dependencies=NULL,
    @IsAdmin=1, @CompId=1, @BranchId=1;

-- Owner fetches list → should see the task now
PRINT '----- probe: owner fetches personal tasks (expect 1) -----';
EXEC dbo.sp_FetchTask @Id=0, @UserId=2, @CompId=1, @BranchId=1, @IsAdmin=1,
                     @AccessibleBranchIdsJson=NULL, @PageNumber=1, @PageSize=25;

-- Non-owner (Raaj, UserId=3) fetches personal tasks for themselves → still empty
PRINT '----- probe: non-owner fetches (expect 0, personal privacy) -----';
EXEC dbo.sp_FetchTask @Id=0, @UserId=3, @CompId=1, @BranchId=1, @IsAdmin=0,
                     @AccessibleBranchIdsJson=NULL, @PageNumber=1, @PageSize=25;
GO
