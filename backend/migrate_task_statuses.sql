USE [eCRM+]
GO

-- ================================================
-- Migration Script: Convert Task Status to Kanban Column IDs
-- Date: 2025-08-19
-- Purpose: Update existing task statuses from strings to kanban column IDs
-- ================================================

BEGIN TRANSACTION;

BEGIN TRY
    PRINT 'Starting task status migration to kanban column IDs...';
    
    -- First, let's see what we're working with
    PRINT 'Current task status distribution:';
    SELECT Status, COUNT(*) as TaskCount
    FROM tblTasks 
    GROUP BY Status
    ORDER BY TaskCount DESC;
    
    -- Step 1: Create default kanban columns for all projects if they don't exist
    -- We'll create a standard set that matches your current statuses
    
    INSERT INTO [dbo].[tblKanbanColumns] (ProjectId, Title, Color, SortOrder, MaxTasks, IsActive, CompId, BranchId)
    SELECT DISTINCT
        p.Id as ProjectId,
        'Backlog' as Title,
        '#6B7280' as Color,
        1 as SortOrder,
        NULL as MaxTasks,
        1 as IsActive,
        p.CompId,
        p.BranchId
    FROM [dbo].[tblProjects] p
    WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[tblKanbanColumns] kc 
        WHERE kc.ProjectId = p.Id AND kc.Title = 'Backlog'
    );

    INSERT INTO [dbo].[tblKanbanColumns] (ProjectId, Title, Color, SortOrder, MaxTasks, IsActive, CompId, BranchId)
    SELECT DISTINCT
        p.Id as ProjectId,
        'To Do' as Title,
        '#3B82F6' as Color,
        2 as SortOrder,
        NULL as MaxTasks,
        1 as IsActive,
        p.CompId,
        p.BranchId
    FROM [dbo].[tblProjects] p
    WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[tblKanbanColumns] kc 
        WHERE kc.ProjectId = p.Id AND kc.Title = 'To Do'
    );

    INSERT INTO [dbo].[tblKanbanColumns] (ProjectId, Title, Color, SortOrder, MaxTasks, IsActive, CompId, BranchId)
    SELECT DISTINCT
        p.Id as ProjectId,
        'In Progress' as Title,
        '#F59E0B' as Color,
        3 as SortOrder,
        5 as MaxTasks,
        1 as IsActive,
        p.CompId,
        p.BranchId
    FROM [dbo].[tblProjects] p
    WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[tblKanbanColumns] kc 
        WHERE kc.ProjectId = p.Id AND kc.Title = 'In Progress'
    );

    INSERT INTO [dbo].[tblKanbanColumns] (ProjectId, Title, Color, SortOrder, MaxTasks, IsActive, CompId, BranchId)
    SELECT DISTINCT
        p.Id as ProjectId,
        'Testing' as Title,
        '#EF4444' as Color,
        4 as SortOrder,
        3 as MaxTasks,
        1 as IsActive,
        p.CompId,
        p.BranchId
    FROM [dbo].[tblProjects] p
    WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[tblKanbanColumns] kc 
        WHERE kc.ProjectId = p.Id AND kc.Title = 'Testing'
    );

    INSERT INTO [dbo].[tblKanbanColumns] (ProjectId, Title, Color, SortOrder, MaxTasks, IsActive, CompId, BranchId)
    SELECT DISTINCT
        p.Id as ProjectId,
        'Done' as Title,
        '#10B981' as Color,
        5 as SortOrder,
        NULL as MaxTasks,
        1 as IsActive,
        p.CompId,
        p.BranchId
    FROM [dbo].[tblProjects] p
    WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[tblKanbanColumns] kc 
        WHERE kc.ProjectId = p.Id AND kc.Title = 'Done'
    );

    PRINT 'Default kanban columns created for all projects.';

    -- Step 2: Update task statuses to use kanban column IDs
    DECLARE @UpdateCount INT = 0;

    -- Update 'todo' -> 'To Do' column ID
    UPDATE t 
    SET Status = CAST(kc.Id AS VARCHAR(10))
    FROM tblTasks t
    INNER JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblKanbanColumns kc ON kc.ProjectId = p.Id AND kc.Title = 'To Do'
    WHERE t.Status = 'todo';
    
    SET @UpdateCount = @UpdateCount + @@ROWCOUNT;
    PRINT 'Updated ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' tasks from ''todo'' to ''To Do'' column IDs';

    -- Update 'done' -> 'Done' column ID
    UPDATE t 
    SET Status = CAST(kc.Id AS VARCHAR(10))
    FROM tblTasks t
    INNER JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblKanbanColumns kc ON kc.ProjectId = p.Id AND kc.Title = 'Done'
    WHERE t.Status = 'done';
    
    SET @UpdateCount = @UpdateCount + @@ROWCOUNT;
    PRINT 'Updated ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' tasks from ''done'' to ''Done'' column IDs';

    -- Update 'in-progress' -> 'In Progress' column ID
    UPDATE t 
    SET Status = CAST(kc.Id AS VARCHAR(10))
    FROM tblTasks t
    INNER JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblKanbanColumns kc ON kc.ProjectId = p.Id AND kc.Title = 'In Progress'
    WHERE t.Status = 'in-progress';
    
    SET @UpdateCount = @UpdateCount + @@ROWCOUNT;
    PRINT 'Updated ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' tasks from ''in-progress'' to ''In Progress'' column IDs';

    -- Update 'testing' -> 'Testing' column ID
    UPDATE t 
    SET Status = CAST(kc.Id AS VARCHAR(10))
    FROM tblTasks t
    INNER JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblKanbanColumns kc ON kc.ProjectId = p.Id AND kc.Title = 'Testing'
    WHERE t.Status = 'testing';
    
    SET @UpdateCount = @UpdateCount + @@ROWCOUNT;
    PRINT 'Updated ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' tasks from ''testing'' to ''Testing'' column IDs';

    -- Update 'backlog' -> 'Backlog' column ID
    UPDATE t 
    SET Status = CAST(kc.Id AS VARCHAR(10))
    FROM tblTasks t
    INNER JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblKanbanColumns kc ON kc.ProjectId = p.Id AND kc.Title = 'Backlog'
    WHERE t.Status = 'backlog';
    
    SET @UpdateCount = @UpdateCount + @@ROWCOUNT;
    PRINT 'Updated ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' tasks from ''backlog'' to ''Backlog'' column IDs';

    -- Update 'review' -> 'In Progress' column ID (closest match)
    UPDATE t 
    SET Status = CAST(kc.Id AS VARCHAR(10))
    FROM tblTasks t
    INNER JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblKanbanColumns kc ON kc.ProjectId = p.Id AND kc.Title = 'In Progress'
    WHERE t.Status = 'review';
    
    SET @UpdateCount = @UpdateCount + @@ROWCOUNT;
    PRINT 'Updated ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' tasks from ''review'' to ''In Progress'' column IDs';

    PRINT 'Total tasks updated: ' + CAST(@UpdateCount AS VARCHAR(10));

    -- Step 3: Show final status after migration
    PRINT 'Task status distribution after migration:';
    SELECT 
        t.Status,
        kc.Title as ColumnTitle,
        COUNT(*) as TaskCount
    FROM tblTasks t
    LEFT JOIN tblProjects p ON t.ProjectId = p.Id
    LEFT JOIN tblKanbanColumns kc ON kc.Id = TRY_CAST(t.Status AS INT) AND kc.ProjectId = p.Id
    GROUP BY t.Status, kc.Title
    ORDER BY TaskCount DESC;

    -- Step 4: Check for any unmapped statuses
    PRINT 'Tasks with unmapped statuses (if any):';
    SELECT DISTINCT t.Status, COUNT(*) as TaskCount
    FROM tblTasks t
    LEFT JOIN tblProjects p ON t.ProjectId = p.Id
    LEFT JOIN tblKanbanColumns kc ON kc.Id = TRY_CAST(t.Status AS INT) AND kc.ProjectId = p.Id
    WHERE kc.Id IS NULL
    GROUP BY t.Status;

    COMMIT TRANSACTION;
    PRINT 'Migration completed successfully!';

END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT 'Migration failed. Error: ' + ERROR_MESSAGE();
    THROW;
END CATCH;

-- ================================================
-- Verification Queries (Run after migration)
-- ================================================
/*
-- Check task-to-column mapping
SELECT TOP 10
    t.Id as TaskId,
    t.Title as TaskTitle,
    t.Status as StatusColumnId,
    kc.Title as ColumnTitle,
    kc.Color as ColumnColor,
    p.Name as ProjectName
FROM tblTasks t
INNER JOIN tblProjects p ON t.ProjectId = p.Id
LEFT JOIN tblKanbanColumns kc ON kc.Id = TRY_CAST(t.Status AS INT) AND kc.ProjectId = p.Id
ORDER BY t.Id;

-- Check kanban columns per project
SELECT 
    p.Name as ProjectName,
    kc.Id,
    kc.Title,
    kc.SortOrder,
    kc.Color,
    (SELECT COUNT(*) FROM tblTasks t WHERE t.Status = CAST(kc.Id AS VARCHAR) AND t.ProjectId = p.Id) as TaskCount
FROM tblProjects p
LEFT JOIN tblKanbanColumns kc ON kc.ProjectId = p.Id AND kc.IsActive = 1
ORDER BY p.Id, kc.SortOrder;
*/