-- ============================================================
-- Migration 002 — Workstream C Phase 1
--   • Role hierarchy + DataScope on tblUserGroups
--   • Per-user branch access table (tblUserBranchAccess)
--   • IsCompanyWide flag on master data
--   • Lead-transfer columns on tblLeads
--   • Helper SPs: sp_FetchAccessibleBranchIds, sp_TransferLead,
--     sp_SaveUserBranchAccess, sp_FetchUserBranchAccess,
--     sp_DeleteUserBranchAccess
--
-- Out of scope (Phase 2 of C): updating every fetch SP to honor
-- the new scope. That follows once Phase 1 lands and the API
-- middleware exposes req.scope.branchIds to every controller.
-- ============================================================

USE [eCRM+]
GO

SET XACT_ABORT ON;
GO

-- ============================================================
-- 1) Schema additions
-- ============================================================

BEGIN TRANSACTION;

-- HierarchyLevel: 1=Super, 2=Admin, 3=Manager, 4=Employee
-- DataScope:     All | Company | MultiBranch | Branch | Team | Self
ALTER TABLE tblUserGroups
    ADD HierarchyLevel TINYINT NOT NULL CONSTRAINT DF_tblUserGroups_HierarchyLevel DEFAULT 4,
        DataScope VARCHAR(20) NOT NULL CONSTRAINT DF_tblUserGroups_DataScope DEFAULT 'Self';

-- Lead transfer tracking
ALTER TABLE tblLeads
    ADD OriginalBranchId INT NULL,
        TransferredAt DATETIME NULL,
        TransferredByUserId INT NULL;

-- Hybrid master-data scope
ALTER TABLE tblLeadSource    ADD IsCompanyWide BIT NOT NULL CONSTRAINT DF_tblLeadSource_IsCompanyWide    DEFAULT 0;
ALTER TABLE tblStatus        ADD IsCompanyWide BIT NOT NULL CONSTRAINT DF_tblStatus_IsCompanyWide        DEFAULT 0;
ALTER TABLE tblKanbanColumns ADD IsCompanyWide BIT NOT NULL CONSTRAINT DF_tblKanbanColumns_IsCompanyWide DEFAULT 0;

COMMIT TRANSACTION;
GO

-- ============================================================
-- 2) Per-user branch access (additive — for MultiBranch scope)
-- ============================================================

CREATE TABLE tblUserBranchAccess (
    Id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    UserId      INT NOT NULL,
    BranchId    BIGINT NOT NULL,
    CanRead     BIT NOT NULL CONSTRAINT DF_tblUserBranchAccess_CanRead  DEFAULT 1,
    CanWrite    BIT NOT NULL CONSTRAINT DF_tblUserBranchAccess_CanWrite DEFAULT 0,
    CompId      BIGINT NOT NULL CONSTRAINT DF_tblUserBranchAccess_CompId DEFAULT 1,
    CreatedBy   INT NULL,
    CreatedDate DATETIME NOT NULL CONSTRAINT DF_tblUserBranchAccess_CreatedDate DEFAULT GETDATE(),
    CONSTRAINT UQ_tblUserBranchAccess_UserBranch UNIQUE (UserId, BranchId)
);
GO
CREATE INDEX IX_UserBranchAccess_User ON tblUserBranchAccess (UserId);
GO

-- ============================================================
-- 3) Backfill role hierarchy on existing groups
-- ============================================================

UPDATE tblUserGroups SET HierarchyLevel = 1, DataScope = 'Company'     WHERE Name = 'Super Admins';
UPDATE tblUserGroups SET HierarchyLevel = 2, DataScope = 'Company'     WHERE Name = 'Admins';
UPDATE tblUserGroups SET HierarchyLevel = 3, DataScope = 'MultiBranch' WHERE Name = 'Project Managers';
UPDATE tblUserGroups SET HierarchyLevel = 3, DataScope = 'Team'        WHERE Name = 'Team Leads';
UPDATE tblUserGroups SET HierarchyLevel = 4, DataScope = 'Self'        WHERE Name = 'Developers';
GO

PRINT '✓ Schema + backfill complete';
GO

-- ============================================================
-- 4) Helper SP: sp_FetchAccessibleBranchIds
--    Returns one row per branch the user can READ + flag
--    indicating WRITE permission. Used by middleware to
--    populate req.scope.
-- ============================================================

CREATE OR ALTER PROC sp_FetchAccessibleBranchIds
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @HierarchyLevel TINYINT;
    DECLARE @DataScope VARCHAR(20);
    DECLARE @PrimaryBranchId BIGINT;

    -- Resolve user's effective role (highest level if member of multiple groups)
    SELECT TOP 1
        @HierarchyLevel = ug.HierarchyLevel,
        @DataScope      = ug.DataScope,
        @PrimaryBranchId = u.BranchId
    FROM tblUser u
    LEFT JOIN tblUserGroupMap ugm ON ugm.UserId = u.userid
    LEFT JOIN tblUserGroups   ug  ON ug.Id = ugm.GroupId
    WHERE u.userid = @UserId AND u.CompId = @CompId
    ORDER BY ug.HierarchyLevel ASC;  -- 1 = highest

    IF @DataScope IS NULL      SET @DataScope = 'Self';
    IF @HierarchyLevel IS NULL SET @HierarchyLevel = 4;

    -- Header row so the caller can read scope metadata
    SELECT
        @HierarchyLevel  AS HierarchyLevel,
        @DataScope       AS DataScope,
        @PrimaryBranchId AS PrimaryBranchId;

    -- Result set: BranchId, CanWrite (1/0)
    IF @DataScope IN ('All', 'Company')
    BEGIN
        SELECT b.Id AS BranchId, CAST(1 AS BIT) AS CanWrite
        FROM tblBranch b;
    END
    ELSE IF @DataScope = 'MultiBranch'
    BEGIN
        SELECT BranchId, CanWrite FROM (
            SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite
            UNION
            SELECT BranchId, CanWrite
            FROM tblUserBranchAccess
            WHERE UserId = @UserId AND CanRead = 1
        ) merged
        GROUP BY BranchId, CanWrite;
    END
    ELSE
    BEGIN
        -- Branch / Team / Self → only the user's own branch
        SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite;
    END
END
GO

-- ============================================================
-- 5) sp_SaveUserBranchAccess
-- ============================================================
CREATE OR ALTER PROC sp_SaveUserBranchAccess
    @Id        INT,
    @UserId    INT,
    @BranchId  BIGINT,
    @CanRead   BIT,
    @CanWrite  BIT,
    @CompId    BIGINT,
    @CreatedBy INT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF @UserId IS NULL OR @UserId <= 0 OR @BranchId IS NULL OR @BranchId <= 0
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'UserId and BranchId required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF @Id = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUserBranchAccess WHERE UserId = @UserId AND BranchId = @BranchId)
        BEGIN
            UPDATE tblUserBranchAccess
            SET CanRead = @CanRead, CanWrite = @CanWrite
            WHERE UserId = @UserId AND BranchId = @BranchId;
            SET @Id = (SELECT Id FROM tblUserBranchAccess WHERE UserId = @UserId AND BranchId = @BranchId);
            SET @ResponseCode = 200; SET @ResponseMess = 'Branch access updated';
        END
        ELSE
        BEGIN
            INSERT INTO tblUserBranchAccess (UserId, BranchId, CanRead, CanWrite, CompId, CreatedBy)
            VALUES (@UserId, @BranchId, @CanRead, @CanWrite, @CompId, @CreatedBy);
            SET @Id = SCOPE_IDENTITY();
            SET @ResponseCode = 201; SET @ResponseMess = 'Branch access granted';
        END
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUserBranchAccess WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Branch access not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblUserBranchAccess
        SET CanRead = @CanRead, CanWrite = @CanWrite
        WHERE Id = @Id;

        SET @ResponseCode = 200; SET @ResponseMess = 'Branch access updated';
    END

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS Id;
END
GO

-- ============================================================
-- 6) sp_FetchUserBranchAccess
-- ============================================================
CREATE OR ALTER PROC sp_FetchUserBranchAccess
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
           uba.Id, uba.UserId, uba.BranchId, b.BranchName,
           uba.CanRead, uba.CanWrite, uba.CreatedDate
    FROM tblUserBranchAccess uba
    INNER JOIN tblBranch b ON b.Id = uba.BranchId
    WHERE uba.UserId = @UserId AND uba.CompId = @CompId
    ORDER BY b.BranchName;
END
GO

-- ============================================================
-- 7) sp_DeleteUserBranchAccess
-- ============================================================
CREATE OR ALTER PROC sp_DeleteUserBranchAccess
    @Id INT
AS
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tblUserBranchAccess WHERE Id = @Id)
    BEGIN SELECT 404 AS ResponseCode, 'Branch access not found' AS ResponseMess; RETURN; END
    DELETE FROM tblUserBranchAccess WHERE Id = @Id;
    SELECT 200 AS ResponseCode, 'Branch access removed' AS ResponseMess;
END
GO

-- ============================================================
-- 8) sp_TransferLead — move a lead between branches
--    Records OriginalBranchId, TransferredAt, TransferredByUserId
--    on tblLeads. Activity-log entry will be added in Workstream D.
-- ============================================================

CREATE OR ALTER PROC sp_TransferLead
    @LeadId INT,
    @ToBranchId INT,
    @ToAssignToUserId INT = NULL,
    @CompId BIGINT,
    @TransferredByUserId INT,
    @Reason NVARCHAR(500) = NULL
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @FromBranchId INT;

    IF NOT EXISTS (SELECT 1 FROM tblLeads WHERE Id = @LeadId AND CompId = @CompId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Lead not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblBranch WHERE Id = @ToBranchId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Target branch not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @FromBranchId = BranchId FROM tblLeads WHERE Id = @LeadId;

    IF @FromBranchId = @ToBranchId
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Lead is already at this branch';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE tblLeads
        SET BranchId = @ToBranchId,
            AssignTo = COALESCE(@ToAssignToUserId, AssignTo),
            OriginalBranchId = COALESCE(OriginalBranchId, @FromBranchId),
            TransferredAt = GETDATE(),
            TransferredByUserId = @TransferredByUserId,
            EditBy = @TransferredByUserId,
            EditDate = GETDATE()
        WHERE Id = @LeadId;

        COMMIT TRANSACTION;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'Lead transferred';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @LeadId AS LeadId, @FromBranchId AS FromBranchId, @ToBranchId AS ToBranchId;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to transfer lead: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

PRINT '✓ Workstream C Phase 1 SPs in place';
GO
