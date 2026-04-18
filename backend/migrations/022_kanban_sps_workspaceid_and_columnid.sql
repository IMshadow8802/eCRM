-- ============================================================
-- Migration 022 — Column-centric task model
--
-- Replaces the old dual-state (column + Status enum) model with a
-- single source of truth: the kanban column.
--
-- Schema changes
--   • tblKanbanColumns.IsDone       BIT, default 0. "This column means
--                                    the task is finished."
--   • tblTasks.Status                DROPPED. Column placement is the
--                                    state; no parallel enum.
--
-- Built-in templates mark their final column IsDone=1; users can toggle
-- the flag on custom columns.
--
-- Completion bookkeeping (CompletedDate, CompletedByUserId, dependency
-- unblocks, notifications, reports) now reads column.IsDone instead of
-- Status='done'.
--
-- SPs rewritten in this migration:
--   sp_FetchKanbanColumn     adds IsDone, TaskCount on each column row
--   sp_SaveKanbanColumn      accepts @IsDone
--   sp_DeleteKanbanColumn    reassigns tasks, honours permission
--   sp_ApplyKanbanTemplate   marks last column IsDone=1 per template
--   sp_SeedDefaultWorkspace  same for the auto-personal board
--   sp_SaveTask              drops @Status; CompletedDate from column
--   sp_FetchTask             no Status; adds ColumnIsDone, ColumnTitle
--
-- Depends on: 021b_task_columnid_fk_fixup.sql.
-- ============================================================

USE [eCRM+];
GO

-- ============================================================
-- Part A — Schema
-- ============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns')
       AND name      = 'IsDone'
)
BEGIN
    ALTER TABLE dbo.tblKanbanColumns ADD IsDone BIT NOT NULL DEFAULT 0;
    PRINT 'Added tblKanbanColumns.IsDone';
END
GO

-- Backfill: any existing column whose title matches a common
-- terminal-state word is flagged IsDone=1.
UPDATE dbo.tblKanbanColumns
   SET IsDone = 1
 WHERE IsDone = 0
   AND LOWER(LTRIM(RTRIM(Title))) IN (
       'done', 'completed', 'complete', 'closed',
       'fixed', 'verified', 'shipped', 'published', 'resolved'
   );
GO

-- Backfill CompletedDate / CompletedByUserId for existing tasks whose
-- current column is an IsDone column but timestamps are missing.
UPDATE t
   SET CompletedDate      = COALESCE(t.CompletedDate, GETDATE()),
       CompletedByUserId  = COALESCE(t.CompletedByUserId, t.AssignedToUserId, t.CreatedByUserId)
  FROM dbo.tblTasks t
  JOIN dbo.tblKanbanColumns c ON c.Id = t.ColumnId
 WHERE c.IsDone = 1
   AND t.CompletedDate IS NULL;

-- Clear CompletedDate for tasks that are *not* in a done column (in case
-- old Status='done' flipped them via legacy path).
UPDATE t
   SET CompletedDate      = NULL,
       CompletedByUserId  = NULL
  FROM dbo.tblTasks t
  JOIN dbo.tblKanbanColumns c ON c.Id = t.ColumnId
 WHERE c.IsDone = 0
   AND t.CompletedDate IS NOT NULL;
GO

-- Drop tblTasks.Status after CompletedDate backfill so we don't lose
-- information mid-flight.
IF EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblTasks')
       AND name      = 'Status'
)
BEGIN
    -- Drop any default constraint on Status first
    DECLARE @dc SYSNAME;
    SELECT @dc = dc.name
      FROM sys.default_constraints dc
      JOIN sys.columns c ON c.default_object_id = dc.object_id
     WHERE c.object_id = OBJECT_ID('dbo.tblTasks')
       AND c.name      = 'Status';
    IF @dc IS NOT NULL
        EXEC('ALTER TABLE dbo.tblTasks DROP CONSTRAINT ' + @dc);

    ALTER TABLE dbo.tblTasks DROP COLUMN Status;
    PRINT 'Dropped tblTasks.Status';
END
GO

-- ============================================================
-- Part B — SPs
-- ============================================================

-- ----- sp_FetchKanbanColumn -----------------------------------
IF OBJECT_ID('dbo.sp_FetchKanbanColumn', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchKanbanColumn;
GO

CREATE PROCEDURE dbo.sp_FetchKanbanColumn
    @Id                      INT           = 0,
    @WorkspaceId             BIGINT        = NULL,
    @CompId                  BIGINT,
    @BranchId                BIGINT,
    @IsAdmin                 BIT           = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 200,
    @SearchTerm              NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT =
        CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
      FROM dbo.tblKanbanColumns kc
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = kc.WorkspaceId
     WHERE (@Id = 0 OR kc.Id = @Id)
       AND (@WorkspaceId IS NULL OR kc.WorkspaceId = @WorkspaceId)
       AND kc.CompId = @CompId
       AND kc.IsActive = 1
       AND (
             kc.IsCompanyWide = 1
          OR (@UseScope = 1 AND kc.BranchId IN (SELECT BranchId FROM @BranchIds))
          OR (@UseScope = 0 AND (@IsAdmin = 1 OR kc.BranchId = @BranchId))
           )
       AND (@SearchTerm IS NULL OR kc.Title LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize)
                           ELSE 0 END;

    SELECT 200 AS ResponseCode, 'Kanban columns fetched successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           kc.Id, kc.WorkspaceId, w.Name AS WorkspaceName,
           kc.Title, kc.Color, kc.SortOrder, kc.MaxTasks,
           kc.IsActive, kc.IsCompanyWide, kc.IsDone,
           kc.CompId, kc.BranchId, kc.CreatedDate,
           (SELECT COUNT(*) FROM dbo.tblTasks t WHERE t.ColumnId = kc.Id) AS TaskCount
      FROM dbo.tblKanbanColumns kc
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = kc.WorkspaceId
     WHERE (@Id = 0 OR kc.Id = @Id)
       AND (@WorkspaceId IS NULL OR kc.WorkspaceId = @WorkspaceId)
       AND kc.CompId = @CompId
       AND kc.IsActive = 1
       AND (
             kc.IsCompanyWide = 1
          OR (@UseScope = 1 AND kc.BranchId IN (SELECT BranchId FROM @BranchIds))
          OR (@UseScope = 0 AND (@IsAdmin = 1 OR kc.BranchId = @BranchId))
           )
       AND (@SearchTerm IS NULL OR kc.Title LIKE '%' + @SearchTerm + '%')
     ORDER BY kc.WorkspaceId, kc.SortOrder, kc.Id
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_SaveKanbanColumn ------------------------------------
IF OBJECT_ID('dbo.sp_SaveKanbanColumn', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveKanbanColumn;
GO

CREATE PROCEDURE dbo.sp_SaveKanbanColumn
    @Id          INT          = 0,
    @WorkspaceId BIGINT,
    @Title       VARCHAR(100),
    @Color       VARCHAR(20)  = NULL,
    @SortOrder   INT          = 0,
    @MaxTasks    INT          = NULL,
    @IsActive    BIT          = 1,
    @IsDone      BIT          = 0,
    @UserId      INT,
    @IsAdmin     BIT          = 0,
    @CompId      BIGINT,
    @BranchId    BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @SavedId INT;

    IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'WorkspaceId is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Title IS NULL OR LTRIM(RTRIM(@Title)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column title is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @WsType VARCHAR(20), @WsOwner INT;
    SELECT @WsType = Type, @WsOwner = OwnerUserId
      FROM dbo.tblWorkspaces
     WHERE Id = @WorkspaceId AND CompId = @CompId;
    IF (@WsType IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @CanManage BIT = 0;
    IF (@IsAdmin = 1 AND @WsType <> 'personal') SET @CanManage = 1;
    ELSE IF (@WsType = 'personal' AND @WsOwner = @UserId) SET @CanManage = 1;
    ELSE IF (EXISTS (
        SELECT 1 FROM dbo.tblWorkspaceMembers m
         WHERE m.WorkspaceId = @WorkspaceId AND m.UserId = @UserId
           AND m.IsActive = 1 AND m.Role IN ('owner','manager')))
        SET @CanManage = 1;

    IF (@CanManage = 0)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Permission denied: not a manager of this workspace';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        IF (@Id = 0)
        BEGIN
            IF EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId
                   AND Title = @Title
                   AND IsActive = 1
            )
            BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'A column with this title already exists';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            IF (@SortOrder IS NULL OR @SortOrder = 0)
                SELECT @SortOrder = ISNULL(MAX(SortOrder), 0) + 1
                  FROM dbo.tblKanbanColumns WHERE WorkspaceId = @WorkspaceId;

            INSERT INTO dbo.tblKanbanColumns
                (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive, IsDone,
                 CompId, BranchId, IsCompanyWide)
            VALUES
                (@WorkspaceId, @Title, @Color, @SortOrder, @MaxTasks, @IsActive, @IsDone,
                 @CompId, @BranchId, 0);

            SET @SavedId = SCOPE_IDENTITY();
            SET @ResponseCode = 201; SET @ResponseMess = 'Kanban column created successfully';
        END
        ELSE
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE Id = @Id AND WorkspaceId = @WorkspaceId
            )
            BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Kanban column not found in this workspace';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            IF EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId
                   AND Title = @Title
                   AND Id <> @Id
                   AND IsActive = 1
            )
            BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'A column with this title already exists';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            -- Capture IsDone change to cascade CompletedDate on tasks in this column.
            DECLARE @OldIsDone BIT = (SELECT IsDone FROM dbo.tblKanbanColumns WHERE Id = @Id);

            UPDATE dbo.tblKanbanColumns
               SET Title     = @Title,
                   Color     = @Color,
                   SortOrder = @SortOrder,
                   MaxTasks  = @MaxTasks,
                   IsActive  = @IsActive,
                   IsDone    = @IsDone
             WHERE Id = @Id;

            IF (@OldIsDone = 0 AND @IsDone = 1)
                UPDATE dbo.tblTasks
                   SET CompletedDate = COALESCE(CompletedDate, GETDATE()),
                       CompletedByUserId = COALESCE(CompletedByUserId, @UserId),
                       UpdatedDate = GETDATE()
                 WHERE ColumnId = @Id AND CompletedDate IS NULL;
            ELSE IF (@OldIsDone = 1 AND @IsDone = 0)
                UPDATE dbo.tblTasks
                   SET CompletedDate = NULL,
                       CompletedByUserId = NULL,
                       UpdatedDate = GETDATE()
                 WHERE ColumnId = @Id;

            SET @SavedId = @Id;
            SET @ResponseCode = 200; SET @ResponseMess = 'Kanban column updated successfully';
        END

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @SavedId AS ColumnId;
    END TRY
    BEGIN CATCH
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to save kanban column: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ----- sp_DeleteKanbanColumn ----------------------------------
IF OBJECT_ID('dbo.sp_DeleteKanbanColumn', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_DeleteKanbanColumn;
GO

CREATE PROCEDURE dbo.sp_DeleteKanbanColumn
    @Id                   INT,
    @ReassignToColumnId   INT    = NULL,
    @UserId               INT,
    @IsAdmin              BIT    = 0,
    @CompId               BIGINT,
    @BranchId             BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WorkspaceId BIGINT, @WsType VARCHAR(20), @WsOwner INT;
    DECLARE @ReassignTargetId INT;
    DECLARE @MovedCount INT = 0;

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WorkspaceId = kc.WorkspaceId
      FROM dbo.tblKanbanColumns kc
     WHERE kc.Id = @Id AND kc.CompId = @CompId AND kc.IsActive = 1;

    IF (@WorkspaceId IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Kanban column not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WsType = Type, @WsOwner = OwnerUserId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;

    DECLARE @CanManage BIT = 0;
    IF (@IsAdmin = 1 AND @WsType <> 'personal') SET @CanManage = 1;
    ELSE IF (@WsType = 'personal' AND @WsOwner = @UserId) SET @CanManage = 1;
    ELSE IF (EXISTS (
        SELECT 1 FROM dbo.tblWorkspaceMembers m
         WHERE m.WorkspaceId = @WorkspaceId AND m.UserId = @UserId
           AND m.IsActive = 1 AND m.Role IN ('owner','manager')))
        SET @CanManage = 1;

    IF (@CanManage = 0)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Permission denied: not a manager of this workspace';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ReassignToColumnId IS NOT NULL AND @ReassignToColumnId > 0)
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblKanbanColumns
             WHERE Id = @ReassignToColumnId
               AND WorkspaceId = @WorkspaceId
               AND IsActive = 1
               AND Id <> @Id
        )
        BEGIN SET @ResponseCode = 400;
              SET @ResponseMess = 'Reassign target column is not in the same workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        SET @ReassignTargetId = @ReassignToColumnId;
    END
    ELSE
    BEGIN
        SELECT TOP 1 @ReassignTargetId = Id
          FROM dbo.tblKanbanColumns
         WHERE WorkspaceId = @WorkspaceId
           AND IsActive = 1
           AND Id <> @Id
         ORDER BY SortOrder ASC, Id ASC;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@ReassignTargetId IS NOT NULL)
        BEGIN
            DECLARE @TargetIsDone BIT =
                (SELECT IsDone FROM dbo.tblKanbanColumns WHERE Id = @ReassignTargetId);

            UPDATE dbo.tblTasks
               SET ColumnId = @ReassignTargetId,
                   CompletedDate =
                       CASE WHEN @TargetIsDone = 1 THEN COALESCE(CompletedDate, GETDATE())
                            ELSE NULL END,
                   CompletedByUserId =
                       CASE WHEN @TargetIsDone = 1 THEN COALESCE(CompletedByUserId, @UserId)
                            ELSE NULL END,
                   UpdatedDate = GETDATE()
             WHERE ColumnId = @Id;
            SET @MovedCount = @@ROWCOUNT;
        END
        ELSE
        BEGIN
            UPDATE dbo.tblTasks
               SET ColumnId = NULL,
                   CompletedDate = NULL,
                   CompletedByUserId = NULL,
                   UpdatedDate = GETDATE()
             WHERE ColumnId = @Id;
            SET @MovedCount = @@ROWCOUNT;
        END

        UPDATE dbo.tblKanbanColumns
           SET IsActive = 0
         WHERE Id = @Id;

        COMMIT TRANSACTION;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'Kanban column deleted';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @MovedCount AS TasksMoved,
               @ReassignTargetId AS ReassignedTo;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete kanban column: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ----- sp_ApplyKanbanTemplate ---------------------------------
IF OBJECT_ID('dbo.sp_ApplyKanbanTemplate', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_ApplyKanbanTemplate;
GO

CREATE PROCEDURE dbo.sp_ApplyKanbanTemplate
    @WorkspaceId  BIGINT,
    @TemplateKey  VARCHAR(40) = 'basic',
    @CompId       BIGINT,
    @BranchId     BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Workspace not found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    DECLARE @Cols TABLE (SortOrder INT, Title VARCHAR(100), Color VARCHAR(20), IsDone BIT);

    IF (@TemplateKey = 'basic')
        INSERT INTO @Cols VALUES
            (1,'To Do','#94A3B8',0),
            (2,'In Progress','#3B82F6',0),
            (3,'Done','#10B981',1);
    ELSE IF (@TemplateKey = 'scrum')
        INSERT INTO @Cols VALUES
            (1,'Backlog','#94A3B8',0),
            (2,'Sprint','#8B5CF6',0),
            (3,'In Progress','#3B82F6',0),
            (4,'Review','#F59E0B',0),
            (5,'Done','#10B981',1);
    ELSE IF (@TemplateKey = 'bug')
        INSERT INTO @Cols VALUES
            (1,'New','#EF4444',0),
            (2,'Triaged','#F59E0B',0),
            (3,'In Progress','#3B82F6',0),
            (4,'Fixed','#10B981',0),
            (5,'Verified','#6366F1',1);
    ELSE IF (@TemplateKey = 'content')
        INSERT INTO @Cols VALUES
            (1,'Idea','#94A3B8',0),
            (2,'Draft','#F59E0B',0),
            (3,'Review','#3B82F6',0),
            (4,'Published','#10B981',1);
    ELSE
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Unknown template key';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    INSERT INTO dbo.tblKanbanColumns
        (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive, IsDone,
         CompId, BranchId, IsCompanyWide)
    SELECT @WorkspaceId, c.Title, c.Color, c.SortOrder, NULL, 1, c.IsDone,
           @CompId, @BranchId, 0
      FROM @Cols c;

    SET @ResponseCode = 201;
    SET @ResponseMess = 'Template applied';

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @TemplateKey AS TemplateKey,
           @@ROWCOUNT AS ColumnsCreated;
END
GO

-- ----- sp_SeedDefaultWorkspace --------------------------------
IF OBJECT_ID('dbo.sp_SeedDefaultWorkspace', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SeedDefaultWorkspace;
GO

CREATE PROCEDURE dbo.sp_SeedDefaultWorkspace
    @UserId   INT,
    @CompId   BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WorkspaceId BIGINT, @Seeded BIT = 0;

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT TOP 1 @WorkspaceId = Id FROM dbo.tblWorkspaces
     WHERE Type = 'personal' AND OwnerUserId = @UserId AND IsArchived = 0
     ORDER BY Id ASC;

    IF (@WorkspaceId IS NOT NULL)
    BEGIN
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Personal workspace already exists';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @Seeded AS Seeded; RETURN;
    END

    DECLARE @DisplayName VARCHAR(200) =
        ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @UserId),
               (SELECT Username FROM dbo.tblUser WHERE Id = @UserId));
    DECLARE @WorkspaceName VARCHAR(200) = CONCAT(@DisplayName, '''s Tasks');

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.tblWorkspaces
            (Name, Type, OwnerUserId, IsArchived, CompId, BranchId)
        VALUES
            (@WorkspaceName, 'personal', @UserId, 0, @CompId, @BranchId);

        SET @WorkspaceId = SCOPE_IDENTITY();

        INSERT INTO dbo.tblWorkspaceMembers
            (WorkspaceId, UserId, Role, AddedByUserId, IsActive)
        VALUES
            (@WorkspaceId, @UserId, 'owner', @UserId, 1);

        INSERT INTO dbo.tblKanbanColumns
            (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive, IsDone,
             CompId, BranchId, IsCompanyWide)
        VALUES
            (@WorkspaceId, 'To Do',       '#94A3B8', 1, NULL, 1, 0, @CompId, @BranchId, 0),
            (@WorkspaceId, 'In Progress', '#3B82F6', 2, NULL, 1, 0, @CompId, @BranchId, 0),
            (@WorkspaceId, 'Done',        '#10B981', 3, NULL, 1, 1, @CompId, @BranchId, 0);

        COMMIT TRANSACTION;

        SET @Seeded = 1;
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Personal workspace seeded';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @Seeded AS Seeded;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Seed failed: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ----- sp_SaveTask --------------------------------------------
IF OBJECT_ID('dbo.sp_SaveTask', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_SaveTask;
GO

CREATE PROCEDURE dbo.sp_SaveTask
    @Id                BIGINT          = 0,
    @Title             VARCHAR(500),
    @Description       NVARCHAR(MAX)   = NULL,
    @WorkspaceId       BIGINT          = NULL,
    @ColumnId          INT             = NULL,
    @ProjectId         INT             = NULL,
    @ParentTaskId      BIGINT          = NULL,
    @AssignedToUserId  INT             = NULL,
    @CreatedByUserId   INT,
    @TeamId            INT             = NULL,
    @Priority          VARCHAR(20)     = 'medium',
    @Type              VARCHAR(50)     = 'task',
    @DueDate           DATE            = NULL,
    @EstimatedHours    DECIMAL(10,2)   = 0,
    @LoggedHours       DECIMAL(10,2)   = 0,
    @Progress          DECIMAL(5,2)    = 0,
    @IsBlocked         BIT             = 0,
    @Labels            NVARCHAR(MAX)   = NULL,
    @Watchers          NVARCHAR(MAX)   = NULL,
    @Dependencies      NVARCHAR(MAX)   = NULL,
    @IsAdmin           BIT             = 0,
    @CompId            BIGINT,
    @BranchId          BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Title IS NULL OR LTRIM(RTRIM(@Title)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task title is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@CreatedByUserId IS NULL OR @CreatedByUserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Created by user is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@WorkspaceId IS NOT NULL AND @WorkspaceId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId AND CompId = @CompId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@ColumnId IS NOT NULL AND @ColumnId > 0)
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblKanbanColumns
             WHERE Id = @ColumnId
               AND WorkspaceId = @WorkspaceId
               AND IsActive = 1
        )
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column does not belong to this workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@ProjectId IS NOT NULL AND @ProjectId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblProjects WHERE Id = @ProjectId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @AssignedToUserId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid assigned user selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TeamId IS NOT NULL AND @TeamId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams WHERE Id = @TeamId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ParentTaskId IS NOT NULL AND @ParentTaskId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @ParentTaskId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid parent task selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Permission
    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
    DECLARE @OldColumnId INT;
    DECLARE @OldIsDone BIT, @NewIsDone BIT = 0;

    IF (@Id = 0)
    BEGIN
        IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'WorkspaceId is required to create a task';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = NULL, @WorkspaceId = @WorkspaceId, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = 'create_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END
    ELSE
    BEGIN
        SELECT @OldColumnId = ColumnId FROM dbo.tblTasks WHERE Id = @Id;
        IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        SELECT @OldIsDone = ISNULL(IsDone,0) FROM dbo.tblKanbanColumns WHERE Id = @OldColumnId;

        DECLARE @EditAction VARCHAR(50) =
            CASE WHEN @ColumnId IS NOT NULL AND @ColumnId <> @OldColumnId
                 THEN 'change_status' ELSE 'edit_fields' END;

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = @EditAction,
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        DECLARE @Reason VARCHAR(400) = (SELECT TOP 1 Reason FROM @PermTable);
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL(@Reason, 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    -- Dependency block: can only enter an IsDone column if all hard-block
    -- dependencies are themselves in an IsDone column.
    IF (@ColumnId IS NOT NULL)
        SELECT @NewIsDone = ISNULL(IsDone,0) FROM dbo.tblKanbanColumns WHERE Id = @ColumnId;

    IF (@Id > 0 AND @NewIsDone = 1 AND ISNULL(@OldIsDone,0) = 0)
    BEGIN
        IF EXISTS (
            SELECT 1
              FROM dbo.tblTaskDependencies d
              JOIN dbo.tblTasks b      ON b.Id = d.DependsOnTaskId
              LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
             WHERE d.TaskId = @Id
               AND d.Type = 'blocks'
               AND (bc.IsDone IS NULL OR bc.IsDone = 0)
        )
        BEGIN SET @ResponseCode = 409;
              SET @ResponseMess = 'Cannot move to Done — blocked by unfinished dependencies';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            IF (@ColumnId IS NULL AND @WorkspaceId IS NOT NULL)
                SELECT TOP 1 @ColumnId = Id FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId AND IsActive = 1
                 ORDER BY SortOrder ASC, Id ASC;

            SELECT @NewIsDone = ISNULL(IsDone,0) FROM dbo.tblKanbanColumns WHERE Id = @ColumnId;

            INSERT INTO dbo.tblTasks
                (Title, Description, WorkspaceId, ColumnId, ProjectId, ParentTaskId,
                 AssignedToUserId, CreatedByUserId, TeamId, Priority, Type,
                 DueDate, EstimatedHours, LoggedHours, Progress, IsBlocked,
                 Labels, Watchers,
                 CompletedDate, CompletedByUserId, UpdatedDate)
            VALUES
                (@Title, @Description, @WorkspaceId, @ColumnId, @ProjectId, @ParentTaskId,
                 @AssignedToUserId, @CreatedByUserId, @TeamId, @Priority, @Type,
                 @DueDate, @EstimatedHours, @LoggedHours, @Progress, @IsBlocked,
                 @Labels, @Watchers,
                 CASE WHEN @NewIsDone = 1 THEN GETDATE() ELSE NULL END,
                 CASE WHEN @NewIsDone = 1 THEN @CreatedByUserId ELSE NULL END,
                 GETDATE());

            SET @Id = SCOPE_IDENTITY();

            IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0)
            BEGIN
                DECLARE @WsTypeForSeed VARCHAR(20);
                SELECT @WsTypeForSeed = Type FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
                IF (@WsTypeForSeed IN ('shared','project'))
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads
                                    WHERE TaskId = @Id AND UserId = @AssignedToUserId)
                        INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                        VALUES (@Id, @AssignedToUserId, GETDATE());
                END
            END

            COMMIT TRANSACTION;
            SET @ResponseCode = 201; SET @ResponseMess = 'Task created successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
        END
        ELSE
        BEGIN
            UPDATE dbo.tblTasks
               SET Title = @Title,
                   Description = @Description,
                   ColumnId = COALESCE(@ColumnId, ColumnId),
                   ProjectId = @ProjectId,
                   ParentTaskId = @ParentTaskId,
                   AssignedToUserId = @AssignedToUserId,
                   TeamId = @TeamId,
                   Priority = @Priority,
                   Type = @Type,
                   DueDate = @DueDate,
                   EstimatedHours = @EstimatedHours,
                   LoggedHours = @LoggedHours,
                   Progress = @Progress,
                   IsBlocked = @IsBlocked,
                   Labels = @Labels,
                   Watchers = @Watchers,
                   CompletedDate = CASE
                       WHEN @NewIsDone = 1 AND CompletedDate IS NULL THEN GETDATE()
                       WHEN @NewIsDone = 0 THEN NULL
                       ELSE CompletedDate END,
                   CompletedByUserId = CASE
                       WHEN @NewIsDone = 1 AND CompletedByUserId IS NULL THEN @CreatedByUserId
                       WHEN @NewIsDone = 0 THEN NULL
                       ELSE CompletedByUserId END,
                   UpdatedDate = GETDATE()
             WHERE Id = @Id;

            COMMIT TRANSACTION;
            SET @ResponseCode = 200; SET @ResponseMess = 'Task updated successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Save failed: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ----- sp_FetchTask -------------------------------------------
IF OBJECT_ID('dbo.sp_FetchTask', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchTask;
GO

CREATE PROCEDURE dbo.sp_FetchTask
    @Id                      BIGINT        = 0,
    @WorkspaceId             BIGINT        = NULL,
    @ProjectId               INT           = NULL,
    @UserId                  INT,
    @CompId                  BIGINT,
    @BranchId                BIGINT,
    @IsAdmin                 BIT           = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT =
        CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id > 0)
    BEGIN
        DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @UserId, @Action = 'view_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;

        IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Task not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Title, NULL AS Description, NULL AS WorkspaceId, NULL AS ColumnId,
                   NULL AS ColumnTitle, NULL AS ColumnIsDone,
                   NULL AS ProjectId, NULL AS ParentTaskId,
                   NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
                   NULL AS Priority, NULL AS Type, NULL AS DueDate,
                   NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress,
                   NULL AS IsBlocked, NULL AS Labels, NULL AS Watchers,
                   NULL AS CompletedDate, NULL AS CompletedByUserId, NULL AS UpdatedDate,
                   NULL AS BranchId, NULL AS ProjectName, NULL AS WorkspaceName, NULL AS AssigneeName,
                   NULL AS CreatorName, NULL AS TeamName, NULL AS SubTaskCount, NULL AS BlockerCount;
            RETURN;
        END

        DECLARE @WsTypeOne VARCHAR(20);
        SELECT @WsTypeOne = w.Type
          FROM dbo.tblTasks t LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
         WHERE t.Id = @Id;

        IF (@WsTypeOne IN ('shared','project'))
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads
                            WHERE TaskId = @Id AND UserId = @UserId)
                INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                VALUES (@Id, @UserId, GETDATE());
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Task retrieved successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
               t.Id, t.Title, t.Description, t.WorkspaceId, t.ColumnId,
               col.Title AS ColumnTitle, col.IsDone AS ColumnIsDone,
               t.ProjectId, t.ParentTaskId,
               t.AssignedToUserId, t.CreatedByUserId, t.TeamId,
               t.Priority, t.Type, t.DueDate,
               t.EstimatedHours, t.LoggedHours, t.Progress,
               CAST(CASE WHEN EXISTS (
                   SELECT 1 FROM dbo.tblTaskDependencies d
                   JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
                   LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
                   WHERE d.TaskId = t.Id AND d.Type = 'blocks'
                     AND (bc.IsDone IS NULL OR bc.IsDone = 0)
               ) THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
               t.Labels, t.Watchers,
               t.CompletedDate, t.CompletedByUserId, t.UpdatedDate,
               ISNULL(p.BranchId, w.BranchId) AS BranchId,
               p.Name AS ProjectName,
               w.Name AS WorkspaceName,
               assignee.FullName AS AssigneeName,
               creator.FullName AS CreatorName,
               team.Name AS TeamName,
               (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount,
               (SELECT COUNT(*) FROM dbo.tblTaskDependencies d
                 WHERE d.TaskId = t.Id AND d.Type = 'blocks') AS BlockerCount
          FROM dbo.tblTasks t
          LEFT JOIN dbo.tblKanbanColumns col ON col.Id = t.ColumnId
          LEFT JOIN dbo.tblWorkspaces    w   ON w.Id   = t.WorkspaceId
          LEFT JOIN dbo.tblProjects      p   ON p.Id   = t.ProjectId
          INNER JOIN dbo.tblUser creator     ON creator.Id = t.CreatedByUserId
          LEFT  JOIN dbo.tblUser assignee    ON assignee.Id = t.AssignedToUserId
          LEFT  JOIN dbo.tblTeams team       ON team.Id = t.TeamId
         WHERE t.Id = @Id;
        RETURN;
    END

    -- List path
    SET @Offset = (@PageNumber - 1) * @PageSize;

    ;WITH visible_ws AS (
        SELECT Id, Type FROM dbo.tblWorkspaces w
         WHERE w.CompId = @CompId
           AND (
                 (w.Type = 'personal' AND w.OwnerUserId = @UserId)
              OR (w.Type IN ('shared','project')
                  AND (@IsAdmin = 1
                       OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                   WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1)))
               )
    )
    SELECT @TotalRecords = COUNT(*)
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
      LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
      LEFT JOIN dbo.tblUser assignee ON assignee.Id = t.AssignedToUserId
      LEFT JOIN dbo.tblTeams team     ON team.Id = t.TeamId
     WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
       AND (@ProjectId   IS NULL OR t.ProjectId   = @ProjectId)
       AND ((@UseScope = 0)
            OR (w.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (p.BranchId IN (SELECT BranchId FROM @BranchIds)))
       AND (
             t.WorkspaceId IN (SELECT Id FROM visible_ws)
          OR (t.WorkspaceId IS NULL
              AND (@IsAdmin = 1
                   OR t.AssignedToUserId = @UserId
                   OR t.CreatedByUserId  = @UserId
                   OR p.ManagerUserId    = @UserId))
           )
       AND (@SearchTerm IS NULL
            OR t.Title LIKE '%' + @SearchTerm + '%'
            OR t.Description LIKE '%' + @SearchTerm + '%'
            OR assignee.FullName LIKE '%' + @SearchTerm + '%'
            OR team.Name LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize)
                           ELSE 0 END;

    IF (@TotalRecords = 0)
    BEGIN
        SET @ResponseCode = 200; SET @ResponseMess = 'No tasks found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               NULL AS Id, NULL AS Title, NULL AS Description, NULL AS WorkspaceId, NULL AS ColumnId,
               NULL AS ColumnTitle, NULL AS ColumnIsDone,
               NULL AS ProjectId, NULL AS ParentTaskId,
               NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
               NULL AS Priority, NULL AS Type, NULL AS DueDate,
               NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress,
               NULL AS IsBlocked, NULL AS Labels, NULL AS Watchers,
               NULL AS CompletedDate, NULL AS CompletedByUserId, NULL AS UpdatedDate,
               NULL AS BranchId, NULL AS ProjectName, NULL AS WorkspaceName, NULL AS AssigneeName,
               NULL AS CreatorName, NULL AS TeamName, NULL AS SubTaskCount, NULL AS BlockerCount;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Tasks retrieved successfully';

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           t.Id, t.Title, t.Description, t.WorkspaceId, t.ColumnId,
           col.Title AS ColumnTitle, col.IsDone AS ColumnIsDone,
           t.ProjectId, t.ParentTaskId,
           t.AssignedToUserId, t.CreatedByUserId, t.TeamId,
           t.Priority, t.Type, t.DueDate,
           t.EstimatedHours, t.LoggedHours, t.Progress,
           CAST(CASE WHEN EXISTS (
               SELECT 1 FROM dbo.tblTaskDependencies d
               JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
               LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
               WHERE d.TaskId = t.Id AND d.Type = 'blocks'
                 AND (bc.IsDone IS NULL OR bc.IsDone = 0)
           ) THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
           t.Labels, t.Watchers,
           t.CompletedDate, t.CompletedByUserId, t.UpdatedDate,
           ISNULL(p.BranchId, w.BranchId) AS BranchId,
           p.Name AS ProjectName,
           w.Name AS WorkspaceName,
           assignee.FullName AS AssigneeName,
           creator.FullName AS CreatorName,
           team.Name AS TeamName,
           (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount,
           (SELECT COUNT(*) FROM dbo.tblTaskDependencies d
             WHERE d.TaskId = t.Id AND d.Type = 'blocks') AS BlockerCount
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblKanbanColumns col ON col.Id = t.ColumnId
      LEFT JOIN dbo.tblWorkspaces    w   ON w.Id   = t.WorkspaceId
      LEFT JOIN dbo.tblProjects      p   ON p.Id   = t.ProjectId
      INNER JOIN dbo.tblUser creator     ON creator.Id = t.CreatedByUserId
      LEFT  JOIN dbo.tblUser assignee    ON assignee.Id = t.AssignedToUserId
      LEFT  JOIN dbo.tblTeams team       ON team.Id = t.TeamId
     WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
       AND (@ProjectId   IS NULL OR t.ProjectId   = @ProjectId)
       AND ((@UseScope = 0)
            OR (w.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (p.BranchId IN (SELECT BranchId FROM @BranchIds)))
       AND (
             t.WorkspaceId IN (SELECT Id FROM dbo.tblWorkspaces ww
                                WHERE ww.CompId = @CompId
                                  AND (
                                        (ww.Type = 'personal' AND ww.OwnerUserId = @UserId)
                                     OR (ww.Type IN ('shared','project')
                                         AND (@IsAdmin = 1
                                              OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers mm
                                                          WHERE mm.WorkspaceId = ww.Id AND mm.UserId = @UserId AND mm.IsActive = 1)))))
          OR (t.WorkspaceId IS NULL
              AND (@IsAdmin = 1
                   OR t.AssignedToUserId = @UserId
                   OR t.CreatedByUserId  = @UserId
                   OR p.ManagerUserId    = @UserId))
           )
       AND (@SearchTerm IS NULL
            OR t.Title LIKE '%' + @SearchTerm + '%'
            OR t.Description LIKE '%' + @SearchTerm + '%'
            OR assignee.FullName LIKE '%' + @SearchTerm + '%'
            OR team.Name LIKE '%' + @SearchTerm + '%')
     ORDER BY CASE t.Priority
                   WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                   WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
              t.DueDate ASC, t.Id DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

PRINT 'Migration 022 complete.';
GO
