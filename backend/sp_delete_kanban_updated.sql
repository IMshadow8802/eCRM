USE [eCRM+]
GO

-- ================================================
-- sp_DeleteKanbanColumn - Updated for numeric status IDs
-- ================================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROC [dbo].[sp_DeleteKanbanColumn]
    @Id INT,
    @CompId INT,
    @BranchId INT
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TaskCount INT;
    DECLARE @ColumnTitle VARCHAR(100);
    
    BEGIN TRY
        -- Validation
        IF (@Id IS NULL OR @Id <= 0)
        BEGIN
            SET @ResponseCode = 400;
            SET @ResponseMess = 'Column ID is required';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
        
        IF (@CompId IS NULL OR @CompId <= 0)
        BEGIN
            SET @ResponseCode = 400;
            SET @ResponseMess = 'Company ID is required';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
        
        IF (@BranchId IS NULL OR @BranchId <= 0)
        BEGIN
            SET @ResponseCode = 400;
            SET @ResponseMess = 'Branch ID is required';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
        
        -- Check if column exists and get title
        SELECT @ColumnTitle = Title 
        FROM [dbo].[tblKanbanColumns] 
        WHERE Id = @Id 
        AND CompId = @CompId 
        AND BranchId = @BranchId;
        
        IF (@ColumnTitle IS NULL)
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Kanban column not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
        
        -- Check if any tasks are using this column ID (status field now contains column ID)
        SELECT @TaskCount = COUNT(*) 
        FROM [dbo].[tblTasks] t
        INNER JOIN [dbo].[tblProjects] p ON t.ProjectId = p.Id
        WHERE t.Status = CAST(@Id AS VARCHAR(10))
        AND p.CompId = @CompId 
        AND p.BranchId = @BranchId;
        
        IF (@TaskCount > 0)
        BEGIN
            SET @ResponseCode = 409;
            SET @ResponseMess = 'Cannot delete column. ' + CAST(@TaskCount AS VARCHAR(10)) + ' tasks are using this status';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
        
        -- Soft delete the column
        UPDATE [dbo].[tblKanbanColumns] 
        SET IsActive = 0
        WHERE Id = @Id;
        
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Kanban column deleted successfully';
        
        SELECT 
            @ResponseCode AS ResponseCode, 
            @ResponseMess AS ResponseMess;
            
    END TRY
    BEGIN CATCH
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete kanban column: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO