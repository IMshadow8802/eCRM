-- ============================================================================
-- 071_sales_foundation.sql
--
-- Spec 1 of the Sales/Support rebuild: reporting hierarchy + flat lead model.
-- Design: docs/superpowers/specs/2026-09-08-sales-foundation-hierarchy-design.md
--
-- What changes and why (short form; the spec carries the reasoning):
--
--   * tblUser.ReportsTo — explicit manager, Zoho/Salesforce style. Drives
--     Team-scope visibility (self + subtree) now, escalation in spec 2.
--   * Leads lose PipelineId/StageId; gain StatusId (tblLookup 'lead_status'),
--     Company/Address/City/State/Pincode, ProductId, Remarks, AssignedAt.
--     OwnerId NULL now means "unassigned".
--   * tblLookup.Code — machine meaning behind an editable label.
--     lead_status: open | qualified | lost | junk  (spec 3 adds converted;
--     spec 2 reuses the column for ticket State).
--   * tblFollowUp rebuilt as activities (0 rows on apply day): DueAt,
--     Status open|done|skipped, DoneAt/DoneBy, OutcomeId, Remarks — and a
--     CHECK that makes Remarks mandatory the moment a row is not open.
--     Absorbs lead calls (Type='call', Direction, Duration). tblCall stays
--     for tickets; sp_LogCall no longer writes follow-ups.
--   * tblProduct (light master with MarginPct) and tblLeadAssignment
--     (transfer history with mandatory reason + remarks).
--   * Lead pipelines/stages deleted. Ticket pipelines untouched until spec 2.
--
-- Data on apply day: 1 lead, 0 follow-ups, 1 call, 5 branches, 6 users.
--
-- APPLY BY HAND, top to bottom, in one go. Idempotent: DDL is guarded, seeds
-- use NOT EXISTS, procs are CREATE OR ALTER. The verify block at the bottom
-- runs inside a rolled-back transaction.
--
-- Deploy the backend AFTER this is applied — sp_SaveFollowUp, sp_FetchFollowUp,
-- sp_MoveLeadStage and sp_PipelineFunnel are dropped here, and the old
-- backend calls them.
--
-- Author: Claude  Date: 2026-09-08
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0a. A verify block that dies mid-way can leave this session inside BEGIN
--     TRAN. Re-running with that open would put every CREATE OR ALTER below
--     inside it, and the verify's final ROLLBACK would then undo them all.
-- ---------------------------------------------------------------------------
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO

-- ---------------------------------------------------------------------------
-- 0. Guard: tblFollowUp is rebuilt, not migrated. Stop if it grew rows.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblFollowUp', 'FollowupType') IS NOT NULL
   AND EXISTS (SELECT 1 FROM dbo.tblFollowUp)
BEGIN
    RAISERROR('071: tblFollowUp has rows in the OLD shape. Migrate them by hand before running this script.', 16, 1);
    RETURN;
END
GO


-- ---------------------------------------------------------------------------
-- 1. tblUser.ReportsTo
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblUser', 'ReportsTo') IS NULL
    ALTER TABLE dbo.tblUser ADD ReportsTo INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblUser_CompId_ReportsTo' AND object_id = OBJECT_ID('dbo.tblUser'))
    CREATE INDEX IX_tblUser_CompId_ReportsTo ON dbo.tblUser (CompId, ReportsTo);
GO


-- ---------------------------------------------------------------------------
-- 2. tblLookup.Code + seeds (per company that has users)
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblLookup', 'Code') IS NULL
    ALTER TABLE dbo.tblLookup ADD Code VARCHAR(30) NULL;
GO

;WITH comp AS (
    SELECT DISTINCT CAST(CompId AS INT) AS CompId FROM dbo.tblUser WHERE CompId IS NOT NULL
), seed AS (
    SELECT * FROM (VALUES
        ('lead_status',      N'New',                   1, 'open'),
        ('lead_status',      N'Contacted',             2, 'open'),
        ('lead_status',      N'Follow-up',             3, 'open'),
        ('lead_status',      N'Qualified',             4, 'qualified'),
        ('lead_status',      N'Lost',                  5, 'lost'),
        ('lead_status',      N'Junk',                  6, 'junk'),
        ('product_category', N'General',               1, NULL),
        ('transfer_reason',  N'Absent',                1, NULL),
        ('transfer_reason',  N'Overloaded',            2, NULL),
        ('transfer_reason',  N'Wrong branch',          3, NULL),
        ('transfer_reason',  N'Sent back to manager',  4, NULL),
        ('transfer_reason',  N'Reassigned by manager', 5, NULL),
        ('transfer_reason',  N'Other',                 6, NULL)
    ) v(Kind, Value, SortOrder, Code)
)
INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive, Code)
SELECT c.CompId, s.Kind, s.Value, s.SortOrder, 1, s.Code
FROM comp c CROSS JOIN seed s
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup l
                  WHERE l.CompId = c.CompId AND l.Kind = s.Kind AND l.Value = s.Value);

-- Re-run safety: any lead_status row that predates Code gets one.
UPDATE dbo.tblLookup
SET Code = CASE Value WHEN N'Qualified' THEN 'qualified'
                      WHEN N'Lost'      THEN 'lost'
                      WHEN N'Junk'      THEN 'junk'
                      ELSE 'open' END
WHERE Kind = 'lead_status' AND Code IS NULL;
GO


-- ---------------------------------------------------------------------------
-- 3. tblLeads — add, backfill, then drop the pipeline columns
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblLeads', 'StatusId')   IS NULL ALTER TABLE dbo.tblLeads ADD StatusId   INT NULL;
IF COL_LENGTH('dbo.tblLeads', 'Company')    IS NULL ALTER TABLE dbo.tblLeads ADD Company    NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.tblLeads', 'Address')    IS NULL ALTER TABLE dbo.tblLeads ADD Address    NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.tblLeads', 'City')       IS NULL ALTER TABLE dbo.tblLeads ADD City       NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.tblLeads', 'State')      IS NULL ALTER TABLE dbo.tblLeads ADD State      NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.tblLeads', 'Pincode')    IS NULL ALTER TABLE dbo.tblLeads ADD Pincode    VARCHAR(10) NULL;
IF COL_LENGTH('dbo.tblLeads', 'ProductId')  IS NULL ALTER TABLE dbo.tblLeads ADD ProductId  INT NULL;
IF COL_LENGTH('dbo.tblLeads', 'Remarks')    IS NULL ALTER TABLE dbo.tblLeads ADD Remarks    NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.tblLeads', 'AssignedAt') IS NULL ALTER TABLE dbo.tblLeads ADD AssignedAt DATETIME NULL;
GO

-- Backfill StatusId from the stage type. Dynamic SQL because StageId is
-- dropped further down and a plain reference would not compile on re-run.
IF COL_LENGTH('dbo.tblLeads', 'StageId') IS NOT NULL
BEGIN
    EXEC sp_executesql N'
        UPDATE l SET StatusId = lk.Id
        FROM dbo.tblLeads l
        LEFT JOIN dbo.tblPipelineStage s ON s.Id = l.StageId
        JOIN dbo.tblLookup lk
          ON lk.CompId = l.CompId AND lk.Kind = ''lead_status''
         AND lk.Value = CASE ISNULL(s.StageType, ''open'')
                            WHEN ''won''  THEN N''Qualified''
                            WHEN ''lost'' THEN N''Lost''
                            ELSE N''New'' END
        WHERE l.StatusId IS NULL;';
END
GO

-- Anything still NULL (no stage, no pipeline) -> New.
UPDATE l SET StatusId = lk.Id
FROM dbo.tblLeads l
JOIN dbo.tblLookup lk ON lk.CompId = l.CompId AND lk.Kind = 'lead_status' AND lk.Value = N'New'
WHERE l.StatusId IS NULL;

UPDATE dbo.tblLeads
SET AssignedAt = ISNULL(UpdatedAt, CreatedAt)
WHERE OwnerId IS NOT NULL AND AssignedAt IS NULL;
GO

ALTER TABLE dbo.tblLeads ALTER COLUMN StatusId INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_new_CompId_StageId' AND object_id = OBJECT_ID('dbo.tblLeads'))
    DROP INDEX IX_tblLeads_new_CompId_StageId ON dbo.tblLeads;
IF COL_LENGTH('dbo.tblLeads', 'StageId')    IS NOT NULL ALTER TABLE dbo.tblLeads DROP COLUMN StageId;
IF COL_LENGTH('dbo.tblLeads', 'PipelineId') IS NOT NULL ALTER TABLE dbo.tblLeads DROP COLUMN PipelineId;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_CompId_StatusId' AND object_id = OBJECT_ID('dbo.tblLeads'))
    CREATE INDEX IX_tblLeads_CompId_StatusId ON dbo.tblLeads (CompId, StatusId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_CompId_OwnerId' AND object_id = OBJECT_ID('dbo.tblLeads'))
    CREATE INDEX IX_tblLeads_CompId_OwnerId ON dbo.tblLeads (CompId, OwnerId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_CompId_NextFollowupDate' AND object_id = OBJECT_ID('dbo.tblLeads'))
    CREATE INDEX IX_tblLeads_CompId_NextFollowupDate ON dbo.tblLeads (CompId, NextFollowupDate);
GO


-- ---------------------------------------------------------------------------
-- 4. tblFollowUp — rebuilt as activities
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblFollowUp', 'FollowupType') IS NOT NULL
    DROP TABLE dbo.tblFollowUp;   -- section 0 guaranteed it is empty
GO

IF OBJECT_ID('dbo.tblFollowUp') IS NULL
BEGIN
    CREATE TABLE dbo.tblFollowUp (
        Id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblFollowUp PRIMARY KEY,
        CompId     INT NOT NULL,
        BranchId   INT NOT NULL,
        LeadId     INT NOT NULL,
        Type       VARCHAR(20)  NOT NULL CONSTRAINT DF_tblFollowUp_Type   DEFAULT 'call',
        DueAt      DATETIME     NOT NULL,
        AssignedTo INT NULL,
        Status     VARCHAR(20)  NOT NULL CONSTRAINT DF_tblFollowUp_Status DEFAULT 'open',
        DoneAt     DATETIME NULL,
        DoneBy     INT NULL,
        OutcomeId  INT NULL,
        Remarks    NVARCHAR(1000) NULL,
        Direction  VARCHAR(5) NULL,
        Duration   INT NULL,
        CreatedBy  INT NULL,
        CreatedAt  DATETIME NOT NULL CONSTRAINT DF_tblFollowUp_CreatedAt DEFAULT GETDATE(),
        EditBy     INT NULL,
        UpdatedAt  DATETIME NULL,
        CONSTRAINT CK_tblFollowUp_Type   CHECK (Type   IN ('call','visit','meeting','other')),
        CONSTRAINT CK_tblFollowUp_Status CHECK (Status IN ('open','done','skipped')),
        -- The mandatory-remarks rule lives here, not only in the SP.
        CONSTRAINT CK_tblFollowUp_DoneRemarks
            CHECK (Status = 'open' OR (Remarks IS NOT NULL AND LEN(LTRIM(RTRIM(Remarks))) > 0))
    );
    CREATE INDEX IX_tblFollowUp_CompId_LeadId_Status ON dbo.tblFollowUp (CompId, LeadId, Status);
    CREATE INDEX IX_tblFollowUp_CompId_AssignedTo_Status_DueAt ON dbo.tblFollowUp (CompId, AssignedTo, Status, DueAt);
END
GO


-- ---------------------------------------------------------------------------
-- 5. tblProduct
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblProduct') IS NULL
BEGIN
    CREATE TABLE dbo.tblProduct (
        Id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblProduct PRIMARY KEY,
        CompId     INT NOT NULL,
        Name       NVARCHAR(200) NOT NULL,
        Code       VARCHAR(50) NULL,
        CategoryId INT NULL,
        UnitPrice  DECIMAL(18,2) NULL,
        MarginPct  DECIMAL(5,2) NULL,
        IsActive   BIT NOT NULL CONSTRAINT DF_tblProduct_IsActive DEFAULT 1,
        CreatedBy  INT NULL,
        CreatedAt  DATETIME NOT NULL CONSTRAINT DF_tblProduct_CreatedAt DEFAULT GETDATE(),
        EditBy     INT NULL,
        UpdatedAt  DATETIME NULL,
        CONSTRAINT CK_tblProduct_Margin CHECK (MarginPct IS NULL OR (MarginPct >= 0 AND MarginPct <= 100))
    );
    -- Filtered: a soft-deleted product's name can be reused.
    CREATE UNIQUE INDEX UX_tblProduct_CompId_Name ON dbo.tblProduct (CompId, Name) WHERE IsActive = 1;
END
GO


-- ---------------------------------------------------------------------------
-- 6. tblLeadAssignment — transfer history
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblLeadAssignment') IS NULL
BEGIN
    CREATE TABLE dbo.tblLeadAssignment (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblLeadAssignment PRIMARY KEY,
        CompId       INT NOT NULL,
        LeadId       INT NOT NULL,
        FromUserId   INT NULL,
        ToUserId     INT NULL,
        FromBranchId INT NULL,
        ToBranchId   INT NULL,
        ReasonId     INT NULL,
        Remarks      NVARCHAR(500) NOT NULL,
        AssignedBy   INT NOT NULL,
        AssignedAt   DATETIME NOT NULL CONSTRAINT DF_tblLeadAssignment_AssignedAt DEFAULT GETDATE()
    );
    CREATE INDEX IX_tblLeadAssignment_CompId_LeadId ON dbo.tblLeadAssignment (CompId, LeadId);
    CREATE INDEX IX_tblLeadAssignment_CompId_ToUserId_AssignedAt ON dbo.tblLeadAssignment (CompId, ToUserId, AssignedAt);
END
GO


-- ---------------------------------------------------------------------------
-- 7. Lead pipelines go. Ticket pipelines stay (spec 2).
-- ---------------------------------------------------------------------------
DELETE s FROM dbo.tblPipelineStage s
JOIN dbo.tblPipeline p ON p.Id = s.PipelineId
WHERE p.Entity = 'lead';
DELETE FROM dbo.tblPipeline WHERE Entity = 'lead';
GO


-- ---------------------------------------------------------------------------
-- 8. Replaced procedures
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_MoveLeadStage',  'P') IS NOT NULL DROP PROCEDURE dbo.sp_MoveLeadStage;
IF OBJECT_ID('dbo.sp_SaveFollowUp',   'P') IS NOT NULL DROP PROCEDURE dbo.sp_SaveFollowUp;
IF OBJECT_ID('dbo.sp_FetchFollowUp',  'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchFollowUp;
IF OBJECT_ID('dbo.sp_PipelineFunnel', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_PipelineFunnel;
GO


-- ===========================================================================
-- 9. PROCEDURES
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 9.1 sp_FetchAccessibleBranchIds — Team scope follows ReportsTo
--
--   Result 1: HierarchyLevel, DataScope, PrimaryBranchId, IsAdmin, IsActive
--   Result 2: BranchId, CanWrite
--   Result 3: OwnerId (Self/Team only)
--
--   Team = self + everyone whose ReportsTo chain leads here. Their branches
--   join the branch set, so a subordinate sitting in another branch is not
--   hidden by the branch predicate. Inactive subordinates stay in: a
--   deactivated executive's leads must remain visible to be reassigned.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchAccessibleBranchIds
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @HierarchyLevel  TINYINT;
    DECLARE @DataScope       VARCHAR(20);
    DECLARE @PrimaryBranchId BIGINT;
    DECLARE @IsAdmin         BIT;
    DECLARE @IsActive        BIT;

    -- A user in several groups gets their strongest: lowest HierarchyLevel wins.
    SELECT TOP 1
        @HierarchyLevel  = ug.HierarchyLevel,
        @DataScope       = ug.DataScope,
        @IsAdmin         = ug.IsAdmin,
        @PrimaryBranchId = u.BranchId,
        @IsActive        = u.IsActive
    FROM dbo.tblUser u
    LEFT JOIN dbo.tblUserGroupMap ugm ON ugm.UserId = u.Id
    LEFT JOIN dbo.tblUserGroups   ug  ON ug.Id = ugm.GroupId
    WHERE u.Id = @UserId AND u.CompId = @CompId
    ORDER BY ug.HierarchyLevel ASC;

    -- No group = least privilege. No user row = inactive (fail closed).
    IF @DataScope      IS NULL SET @DataScope      = 'Self';
    IF @HierarchyLevel IS NULL SET @HierarchyLevel = 4;
    IF @IsAdmin        IS NULL SET @IsAdmin        = 0;
    IF @IsActive       IS NULL SET @IsActive       = 0;

    DECLARE @Subtree TABLE (UserId INT PRIMARY KEY, BranchId BIGINT NULL);
    IF @DataScope = 'Team'
    BEGIN
        ;WITH chain AS (
            SELECT Id, BranchId FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId
            UNION ALL
            SELECT u.Id, u.BranchId
            FROM dbo.tblUser u
            JOIN chain c ON u.ReportsTo = c.Id
            WHERE u.CompId = @CompId AND u.Id <> @UserId
        )
        INSERT INTO @Subtree (UserId, BranchId)
        SELECT DISTINCT Id, BranchId FROM chain
        OPTION (MAXRECURSION 32);
    END

    SELECT @HierarchyLevel  AS HierarchyLevel,
           @DataScope       AS DataScope,
           @PrimaryBranchId AS PrimaryBranchId,
           @IsAdmin         AS IsAdmin,
           @IsActive        AS IsActive;

    -- Result 2: branches
    IF @DataScope IN ('All', 'Company')
        SELECT b.Id AS BranchId, CAST(1 AS BIT) AS CanWrite FROM dbo.tblBranch b;
    ELSE IF @DataScope = 'MultiBranch'
        SELECT BranchId, CanWrite FROM (
            SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite
            UNION
            SELECT BranchId, CanWrite FROM dbo.tblUserBranchAccess
             WHERE UserId = @UserId AND CanRead = 1
        ) merged GROUP BY BranchId, CanWrite;
    ELSE IF @DataScope = 'Team'
        SELECT BranchId, CAST(1 AS BIT) AS CanWrite FROM (
            SELECT @PrimaryBranchId AS BranchId
            UNION
            SELECT BranchId FROM @Subtree WHERE BranchId IS NOT NULL
        ) x GROUP BY BranchId;
    ELSE
        SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite;

    -- Result 3: owners. Empty for the wide scopes = "no ownership filter".
    IF @DataScope = 'Self'
        SELECT @UserId AS OwnerId;
    ELSE IF @DataScope = 'Team'
        SELECT UserId AS OwnerId FROM @Subtree;
    ELSE
        SELECT CAST(NULL AS INT) AS OwnerId WHERE 1 = 0;  -- no rows
END
GO


-- ---------------------------------------------------------------------------
-- 9.2 sp_SaveUser — +@ReportsTo (defaults NULL; old callers unaffected)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveUser
    @Id INT,
    @Username VARCHAR(100),
    @Password VARCHAR(500),
    @UserActive BIT,
    @IsAdmin BIT,
    @UserIp VARCHAR(50),
    @AllowDay INT,
    @FullName VARCHAR(200),
    @Email VARCHAR(150),
    @JobTitle VARCHAR(100),
    @HourlyRate DECIMAL(10,2),
    @GroupId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @Mobile VARCHAR(20) = NULL,
    @ReportsTo INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Username IS NULL OR LTRIM(RTRIM(@Username)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Username is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- A new user needs a password. An edit may omit it to keep the current one.
    IF (@Id = 0 AND (@Password IS NULL OR LTRIM(RTRIM(@Password)) = ''))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Password is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@FullName IS NULL OR LTRIM(RTRIM(@FullName)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Full name is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Normalize blanks to NULL so filtered-unique indexes ignore them.
    IF (@Mobile IS NOT NULL AND LTRIM(RTRIM(@Mobile)) = '') SET @Mobile = NULL;
    IF (@Email  IS NOT NULL AND LTRIM(RTRIM(@Email))  = '') SET @Email  = NULL;
    IF (@ReportsTo IS NOT NULL AND @ReportsTo <= 0)         SET @ReportsTo = NULL;

    IF (@GroupId IS NOT NULL AND @GroupId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid group selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END
    ELSE
    BEGIN SET @GroupId = 8; END

    -- Reporting line: must be a colleague, not self, and must not loop.
    IF @ReportsTo IS NOT NULL
    BEGIN
        IF @ReportsTo = @Id
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'A user cannot report to themselves';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @ReportsTo AND CompId = @CompId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Reports To must be a user in this company';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        DECLARE @cur INT = @ReportsTo, @hops INT = 0;
        WHILE @cur IS NOT NULL AND @hops < 20
        BEGIN
            IF @cur = @Id
            BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Reporting line would loop back to this user';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
            SET @cur = (SELECT ReportsTo FROM tblUser WHERE Id = @cur AND CompId = @CompId);
            SET @hops += 1;
        END
    END

    -- Login keys are GLOBAL (not per-company) -- a friendly 409 before the
    -- unique index would throw a raw error.
    IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND Id <> @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Email IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Email = @Email AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Email already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Mobile IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Mobile = @Mobile AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Mobile already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO tblUser
                (Username, Password, IsActive, IsAdmin, UserIp, AllowDay,
                 FullName, Email, JobTitle, HourlyRate, Mobile, CompId, BranchId, ReportsTo)
            VALUES
                (@Username, @Password, @UserActive, @IsAdmin, @UserIp, @AllowDay,
                 @FullName, @Email, @JobTitle, @HourlyRate, @Mobile, @CompId, @BranchId, @ReportsTo);

            SET @Id = SCOPE_IDENTITY();

            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            COMMIT TRANSACTION;

            SET @ResponseCode = 201;
            SET @ResponseMess = 'User created successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
        END
        ELSE
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId)
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 404; SET @ResponseMess = 'User not found';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            UPDATE tblUser
               SET Username = @Username, IsActive = @UserActive,
                   IsAdmin = @IsAdmin, UserIp = @UserIp, AllowDay = @AllowDay,
                   FullName = @FullName, Email = @Email, JobTitle = @JobTitle,
                   HourlyRate = @HourlyRate, Mobile = @Mobile,
                   ReportsTo = @ReportsTo,
                   -- Password only when a new hash is supplied; blank means
                   -- "keep current" (same contract as sp_UpdateOwnProfile).
                   Password = CASE WHEN @Password IS NOT NULL AND LEN(@Password) > 0
                                   THEN @Password ELSE Password END
             WHERE Id = @Id AND CompId = @CompId;

            DELETE FROM tblUserGroupMap WHERE UserId = @Id;
            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            COMMIT TRANSACTION;

            SET @ResponseCode = 200;
            SET @ResponseMess = 'User updated successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 9.3 sp_FetchUser — +ReportsTo, ReportsToName (contract otherwise unchanged)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
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
        FROM tblUser u
        WHERE u.CompId = @CompId
          AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
          AND (@SearchTerm IS NULL OR
               u.Username LIKE '%' + @SearchTerm + '%' OR
               u.FullName LIKE '%' + @SearchTerm + '%' OR
               u.Email    LIKE '%' + @SearchTerm + '%' OR
               u.Mobile   LIKE '%' + @SearchTerm + '%' OR
               u.JobTitle LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No users found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS ReportsTo, NULL AS ReportsToName,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Users retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.ReportsTo,
                   (SELECT r.FullName FROM tblUser r WHERE r.Id = u.ReportsTo) AS ReportsToName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            WHERE u.CompId = @CompId
              AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR
                   u.Username LIKE '%' + @SearchTerm + '%' OR
                   u.FullName LIKE '%' + @SearchTerm + '%' OR
                   u.Email    LIKE '%' + @SearchTerm + '%' OR
                   u.Mobile   LIKE '%' + @SearchTerm + '%' OR
                   u.JobTitle LIKE '%' + @SearchTerm + '%')
            ORDER BY u.FullName
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUser
                   WHERE Id = @Id AND CompId = @CompId
                     AND ((@UseScope = 1 AND BranchId IN (SELECT BranchId FROM @BranchIds))
                       OR (@UseScope = 0 AND (@IsAdmin = 1 OR BranchId = @BranchId))))
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'User retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.ReportsTo,
                   (SELECT r.FullName FROM tblUser r WHERE r.Id = u.ReportsTo) AS ReportsToName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            WHERE u.Id = @Id AND u.CompId = @CompId;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS ReportsTo, NULL AS ReportsToName,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
    END
END
GO


-- ---------------------------------------------------------------------------
-- 9.4 sp_FetchUserDirectory — +BranchId, ReportsTo, JobTitle (Reports To picker)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchUserDirectory
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, FullName, Avatar, JobTitle, BranchId, ReportsTo
    FROM dbo.tblUser
    WHERE CompId = @CompId AND IsActive = 1
    ORDER BY FullName;
END
GO


-- ---------------------------------------------------------------------------
-- 9.5 sp_FetchAssignableUsers — who can the caller hand a lead to
--
--   Wide scopes    : everyone in the branches they can read.
--   Team / Self    : own subtree (Self = just self) + own manager, so an
--                    executive can only send a lead back UP.
--   @BranchId set  : that branch's active roster — the cross-branch case.
--                    Whether the caller MAY do that is decided in Node
--                    (DataScope Branch and up); this only lists.
--
--   Node re-runs this before every transfer and checks membership. The
--   dropdown is a convenience, not the gate.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchAssignableUsers
    @UserId   INT,
    @CompId   INT,
    @BranchId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @DataScope VARCHAR(20), @PrimaryBranchId BIGINT, @ManagerId INT;
    SELECT TOP 1
        @DataScope       = ug.DataScope,
        @PrimaryBranchId = u.BranchId,
        @ManagerId       = u.ReportsTo
    FROM dbo.tblUser u
    LEFT JOIN dbo.tblUserGroupMap ugm ON ugm.UserId = u.Id
    LEFT JOIN dbo.tblUserGroups   ug  ON ug.Id = ugm.GroupId
    WHERE u.Id = @UserId AND u.CompId = @CompId
    ORDER BY ug.HierarchyLevel ASC;
    IF @DataScope IS NULL SET @DataScope = 'Self';

    DECLARE @Users TABLE (Id INT PRIMARY KEY);

    IF @BranchId IS NOT NULL
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND BranchId = @BranchId AND IsActive = 1;
    ELSE IF @DataScope IN ('All', 'Company')
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND IsActive = 1;
    ELSE IF @DataScope = 'MultiBranch'
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND IsActive = 1
          AND (BranchId = @PrimaryBranchId
               OR BranchId IN (SELECT BranchId FROM dbo.tblUserBranchAccess WHERE UserId = @UserId AND CanRead = 1));
    ELSE IF @DataScope = 'Branch'
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND IsActive = 1 AND BranchId = @PrimaryBranchId;
    ELSE
    BEGIN
        ;WITH chain AS (
            SELECT Id FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId
            UNION ALL
            SELECT u.Id FROM dbo.tblUser u JOIN chain c ON u.ReportsTo = c.Id
            WHERE u.CompId = @CompId AND u.Id <> @UserId
        )
        INSERT INTO @Users SELECT DISTINCT Id FROM chain OPTION (MAXRECURSION 32);

        IF @ManagerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM @Users WHERE Id = @ManagerId)
            INSERT INTO @Users (Id) VALUES (@ManagerId);

        DELETE x FROM @Users x JOIN dbo.tblUser u ON u.Id = x.Id WHERE u.IsActive = 0;
    END

    SELECT u.Id, u.FullName, u.Avatar, u.JobTitle, u.BranchId, b.BranchName, u.ReportsTo,
           200 AS ResponseCode, 'Assignable users retrieved successfully' AS ResponseMess
    FROM @Users x
    JOIN dbo.tblUser u ON u.Id = x.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = u.BranchId
    ORDER BY u.FullName;
END
GO


-- ---------------------------------------------------------------------------
-- 9.6 Lookups — Code travels with the row
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLookups
    @CompId INT,
    @Kind   VARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, CompId, Kind, Value, SortOrder, IsActive, Code,
           200 AS ResponseCode, 'Lookups retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup
    WHERE CompId = @CompId AND Kind = @Kind AND IsActive = 1
    ORDER BY SortOrder;
END
GO

CREATE OR ALTER PROC dbo.sp_SaveLookup
    @Id        INT,
    @CompId    INT,
    @Kind      VARCHAR(30),
    @Value     NVARCHAR(200),
    @SortOrder INT = 0,
    @Code      VARCHAR(30) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @Kind IS NULL OR LTRIM(RTRIM(@Kind)) = ''
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Kind is required' AS ResponseMess; RETURN; END
    IF @Value IS NULL OR LTRIM(RTRIM(@Value)) = ''
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Value is required' AS ResponseMess; RETURN; END

    IF (@Code IS NOT NULL AND LTRIM(RTRIM(@Code)) = '') SET @Code = NULL;

    -- A lead status always carries a state. Labels are the company's; codes
    -- are ours, and the app branches on them.
    IF @Kind = 'lead_status'
    BEGIN
        IF @Code IS NULL SET @Code = 'open';
        IF @Code NOT IN ('open','qualified','lost','junk','converted')
        BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Code must be one of open, qualified, lost, junk, converted' AS ResponseMess; RETURN; END
    END

    IF @Id = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.tblLookup WHERE CompId=@CompId AND Kind=@Kind AND Value=@Value AND IsActive=1)
        BEGIN SELECT 0 AS Id, 409 AS ResponseCode, 'A lookup with this value already exists' AS ResponseMess; RETURN; END

        INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, Code)
        VALUES (@CompId, @Kind, @Value, ISNULL(@SortOrder,0), @Code);

        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Lookup created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId)
        BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Lookup not found' AS ResponseMess; RETURN; END

        UPDATE dbo.tblLookup
        SET Kind = @Kind, Value = @Value, SortOrder = ISNULL(@SortOrder,0), Code = @Code
        WHERE Id=@Id AND CompId=@CompId;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Lookup updated successfully' AS ResponseMess;
    END
END
GO


-- ---------------------------------------------------------------------------
-- 9.7 Products
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveProduct
    @Id         INT = 0,
    @CompId     INT,
    @UserId     INT,
    @Name       NVARCHAR(200),
    @Code       VARCHAR(50)   = NULL,
    @CategoryId INT           = NULL,
    @UnitPrice  DECIMAL(18,2) = NULL,
    @MarginPct  DECIMAL(5,2)  = NULL,
    @IsActive   BIT           = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @MarginPct IS NOT NULL AND (@MarginPct < 0 OR @MarginPct > 100)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Margin must be between 0 and 100' AS ResponseMess; RETURN; END
    IF @UnitPrice IS NOT NULL AND @UnitPrice < 0
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Price cannot be negative' AS ResponseMess; RETURN; END
    IF (@Code IS NOT NULL AND LTRIM(RTRIM(@Code)) = '') SET @Code = NULL;
    IF @CategoryId IS NOT NULL AND @CategoryId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@CategoryId AND CompId=@CompId AND Kind='product_category')
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid category' AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblProduct WHERE CompId=@CompId AND Name=@Name AND IsActive=1 AND Id<>ISNULL(@Id,0))
    BEGIN SELECT ISNULL(@Id,0) AS Id, 409 AS ResponseCode, 'A product with this name already exists' AS ResponseMess; RETURN; END

    IF ISNULL(@Id,0) = 0
    BEGIN
        INSERT INTO dbo.tblProduct (CompId, Name, Code, CategoryId, UnitPrice, MarginPct, IsActive, CreatedBy, EditBy)
        VALUES (@CompId, @Name, @Code, @CategoryId, @UnitPrice, @MarginPct, ISNULL(@IsActive,1), @UserId, @UserId);
        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Product created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id=@Id AND CompId=@CompId)
        BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Product not found' AS ResponseMess; RETURN; END

        UPDATE dbo.tblProduct
        SET Name=@Name, Code=@Code, CategoryId=@CategoryId, UnitPrice=@UnitPrice,
            MarginPct=@MarginPct, IsActive=ISNULL(@IsActive,1), EditBy=@UserId, UpdatedAt=GETDATE()
        WHERE Id=@Id AND CompId=@CompId;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Product updated successfully' AS ResponseMess;
    END
END
GO

CREATE OR ALTER PROC dbo.sp_FetchProducts
    @CompId     INT,
    @PageNumber INT = 1,
    @PageSize   INT = 25,
    @SearchTerm NVARCHAR(200) = NULL,
    @CategoryId INT = NULL,
    @IsActive   BIT = 1          -- NULL = all
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,25) < 1 THEN 25 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;

    DECLARE @Page TABLE (Id INT, Total INT);
    INSERT INTO @Page (Id, Total)
    SELECT p.Id, COUNT(*) OVER ()
    FROM dbo.tblProduct p
    WHERE p.CompId = @CompId
      AND (@IsActive IS NULL OR p.IsActive = @IsActive)
      AND (@CategoryId IS NULL OR p.CategoryId = @CategoryId)
      AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Code LIKE '%' + @SearchTerm + '%')
    ORDER BY p.Name
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT p.Id, p.CompId, p.Name, p.Code, p.CategoryId, c.Value AS CategoryName,
           p.UnitPrice, p.MarginPct, p.IsActive, p.CreatedBy, p.CreatedAt, p.EditBy, p.UpdatedAt,
           200 AS ResponseCode, 'Products retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblProduct p ON p.Id = x.Id
    LEFT JOIN dbo.tblLookup c ON c.Id = p.CategoryId
    ORDER BY p.Name;

    DECLARE @Total INT = ISNULL((SELECT MAX(Total) FROM @Page), 0);
    IF @Total = 0
        SELECT @Total = COUNT(*) FROM dbo.tblProduct p
        WHERE p.CompId = @CompId
          AND (@IsActive IS NULL OR p.IsActive = @IsActive)
          AND (@CategoryId IS NULL OR p.CategoryId = @CategoryId)
          AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Code LIKE '%' + @SearchTerm + '%');

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO

CREATE OR ALTER PROC dbo.sp_DeleteProduct
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Id IS NULL OR @Id <= 0
    BEGIN SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Product not found' AS ResponseMess; RETURN; END

    -- Soft: leads keep pointing at it; it just leaves the pick list.
    UPDATE dbo.tblProduct SET IsActive = 0, UpdatedAt = GETDATE() WHERE Id=@Id AND CompId=@CompId;
    SELECT 200 AS ResponseCode, 'Product deleted successfully' AS ResponseMess;
END
GO


-- ---------------------------------------------------------------------------
-- 9.8 sp_RefreshLeadNextFollowup — keeps the tblLeads cache honest
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_RefreshLeadNextFollowup
    @CompId INT,
    @LeadId INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.tblLeads
    SET NextFollowupDate = (SELECT MIN(DueAt) FROM dbo.tblFollowUp
                            WHERE CompId = @CompId AND LeadId = @LeadId AND Status = 'open')
    WHERE Id = @LeadId AND CompId = @CompId;
END
GO


-- ---------------------------------------------------------------------------
-- 9.9 sp_SaveLead
--
--   Insert: default status = lowest-SortOrder 'open' lead_status; AssignedAt
--   stamped when an owner is given; ONE open follow-up created, due
--   @FirstFollowupAt or today.
--   Update: fields only. OwnerId and StatusId are deliberately NOT here —
--   ownership moves through sp_TransferLead (history), status through
--   sp_SetLeadStatus (guards). Neither can be bypassed by an edit.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveLead
    @Id               INT            = 0,
    @CompId           INT,
    @BranchId         INT,
    @UserId           INT,
    @Name             NVARCHAR(200),
    @Company          NVARCHAR(200)  = NULL,
    @MobileNo         VARCHAR(20)    = NULL,
    @AltMobile        VARCHAR(20)    = NULL,
    @Email            VARCHAR(150)   = NULL,
    @Address          NVARCHAR(500)  = NULL,
    @City             NVARCHAR(100)  = NULL,
    @State            NVARCHAR(100)  = NULL,
    @Pincode          VARCHAR(10)    = NULL,
    @SourceId         INT            = NULL,
    @ProductId        INT            = NULL,
    @StatusId         INT            = NULL,
    @OwnerId          INT            = NULL,
    @EstValue         DECIMAL(18,2)  = NULL,
    @Remarks          NVARCHAR(MAX)  = NULL,
    @FirstFollowupAt  DATETIME       = NULL,
    @CustomJSON       NVARCHAR(MAX)  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF @ProductId IS NOT NULL AND @ProductId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id=@ProductId AND CompId=@CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid product' AS ResponseMess; RETURN; END
    IF @OwnerId IS NOT NULL AND @OwnerId <= 0 SET @OwnerId = NULL;
    IF @OwnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id=@OwnerId AND CompId=@CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid owner' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @LeadId INT = @Id;

        IF @Id > 0
        BEGIN
            UPDATE dbo.tblLeads
            SET Name = @Name, Company = @Company, MobileNo = @MobileNo, AltMobile = @AltMobile,
                Email = @Email, Address = @Address, City = @City, State = @State, Pincode = @Pincode,
                SourceId = @SourceId, ProductId = @ProductId, EstValue = @EstValue, Remarks = @Remarks,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;
        END
        ELSE
        BEGIN
            IF @StatusId IS NULL OR @StatusId <= 0
                SET @StatusId = (SELECT TOP 1 Id FROM dbo.tblLookup
                                 WHERE CompId=@CompId AND Kind='lead_status' AND Code='open' AND IsActive=1
                                 ORDER BY SortOrder, Id);
            IF @StatusId IS NULL
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, 500 AS ResponseCode, 'No lead_status lookups configured for this company' AS ResponseMess;
                RETURN;
            END
            IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@StatusId AND CompId=@CompId AND Kind='lead_status')
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid status' AS ResponseMess;
                RETURN;
            END

            INSERT INTO dbo.tblLeads
                (CompId, BranchId, Name, Company, MobileNo, AltMobile, Email,
                 Address, City, State, Pincode, SourceId, ProductId, StatusId, OwnerId,
                 EstValue, Remarks, AssignedAt, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @Name, @Company, @MobileNo, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @SourceId, @ProductId, @StatusId, @OwnerId,
                 @EstValue, @Remarks, CASE WHEN @OwnerId IS NULL THEN NULL ELSE GETDATE() END,
                 @UserId, @UserId, GETDATE());

            SET @LeadId = CAST(SCOPE_IDENTITY() AS INT);

            -- The first follow-up: today unless the form said otherwise.
            DECLARE @DueAt DATETIME = ISNULL(@FirstFollowupAt, CAST(CAST(GETDATE() AS DATE) AS DATETIME));
            INSERT INTO dbo.tblFollowUp (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, CreatedBy)
            VALUES (@CompId, @BranchId, @LeadId, 'call', @DueAt, @OwnerId, 'open', @UserId);

            UPDATE dbo.tblLeads SET NextFollowupDate = @DueAt WHERE Id = @LeadId;

            -- Opening record on the timeline; carries the assignment too, so a
            -- lead created straight onto someone shows who and when.
            IF @OwnerId IS NOT NULL
                INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy)
                VALUES (@CompId, @LeadId, NULL, @OwnerId, NULL, @BranchId, NULL, N'Assigned on creation', @UserId);
        END

        -- Custom-field values. JSON: [{fieldId,type,value}].
        IF @CustomJSON IS NOT NULL AND LTRIM(RTRIM(@CustomJSON)) NOT IN ('', '[]')
        BEGIN
            ;WITH src AS (
                SELECT j.fieldId,
                       CASE WHEN j.type IN ('dropdown','text') THEN j.val END AS ValueText,
                       CASE WHEN j.type = 'number'   THEN TRY_CONVERT(DECIMAL(18,2), j.val)
                            WHEN j.type = 'checkbox'  THEN CASE WHEN j.val = 'true' THEN 1 ELSE 0 END
                       END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CONVERT(DATETIME, j.val) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                     WITH (fieldId INT '$.fieldId',
                           type    VARCHAR(20) '$.type',
                           val     NVARCHAR(MAX) '$.value') j
                WHERE j.fieldId IS NOT NULL
            )
            MERGE dbo.tblCustomFieldValue AS tgt
            USING src
               ON tgt.CompId = @CompId AND tgt.Entity = 'lead'
              AND tgt.EntityId = @LeadId AND tgt.FieldId = src.fieldId
            WHEN MATCHED THEN
                UPDATE SET ValueText = src.ValueText, ValueNumber = src.ValueNumber, ValueDate = src.ValueDate
            WHEN NOT MATCHED THEN
                INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                VALUES (@CompId, 'lead', @LeadId, src.fieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        DECLARE @ActType VARCHAR(30) = CASE WHEN @Id > 0 THEN 'updated' ELSE 'created' END;
        DECLARE @ActSummary NVARCHAR(500) = CASE WHEN @Id > 0 THEN N'Lead details updated' ELSE N'Lead created' END;
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = @ActType, @Summary = @ActSummary, @MetaJSON = NULL;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 9.10 sp_FetchLeads — list with labels; scope rule unchanged
--
--   Scope: (branch ∧ owner) ∨ assigned-to-me ∨ created-by-me.
--   A NULL OwnerId (unassigned) fails the owner predicate, so Team/Self never
--   see unassigned rows; wide scopes (no owner filter) do — by design.
--   @Overdue and @Unassigned are presets; the rest are dropdown filters.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLeads
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 10,
    @SearchTerm              NVARCHAR(200) = NULL,
    @StatusId                INT           = NULL,
    @StatusCode              VARCHAR(30)   = NULL,
    @ProductId               INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @Overdue                 BIT           = 0,
    @Unassigned              BIT           = 0,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,10) < 1 THEN 10 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @StatusCode IS NOT NULL AND LTRIM(RTRIM(@StatusCode)) = '' SET @StatusCode = NULL;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;

    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    DECLARE @Page TABLE (Id INT, Total INT, rn INT);
    INSERT INTO @Page (Id, Total, rn)
    SELECT l.Id, COUNT(*) OVER (), ROW_NUMBER() OVER (
               ORDER BY CASE WHEN @Overdue = 1 THEN l.NextFollowupDate END ASC,
                        l.CreatedAt DESC, l.Id DESC)
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId
      AND (@BranchId   IS NULL OR l.BranchId  = @BranchId)
      AND (@StatusId   IS NULL OR l.StatusId  = @StatusId)
      AND (@StatusCode IS NULL OR st.Code     = @StatusCode)
      AND (@ProductId  IS NULL OR l.ProductId = @ProductId)
      AND (@OwnerId    IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId   IS NULL OR l.SourceId  = @SourceId)
      AND (@Unassigned = 0 OR l.OwnerId IS NULL)
      AND (@Overdue = 0 OR (l.NextFollowupDate < @Today AND st.Code IN ('open','qualified')))
      AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                              OR l.Company LIKE '%' + @SearchTerm + '%'
                              OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                              OR l.Email LIKE '%' + @SearchTerm + '%'
                              OR l.City LIKE '%' + @SearchTerm + '%')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )
    ORDER BY CASE WHEN @Overdue = 1 THEN l.NextFollowupDate END ASC, l.CreatedAt DESC, l.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1: page of leads
    SELECT l.Id, l.CompId, l.BranchId, b.BranchName,
           l.Name, l.Company, l.MobileNo, l.AltMobile, l.Email,
           l.Address, l.City, l.State, l.Pincode,
           l.SourceId, src.Value AS SourceName,
           l.ProductId, p.Name AS ProductName,
           l.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           l.OwnerId, o.FullName AS OwnerName, o.Avatar AS OwnerAvatar,
           l.EstValue, l.Remarks, l.NextFollowupDate,
           CAST(CASE WHEN l.NextFollowupDate < @Today AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           l.LostReasonId, l.WonAt, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           200 AS ResponseCode, 'Leads retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblLeads l ON l.Id = x.Id
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblProduct p ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    ORDER BY x.rn;

    -- Result set 2: pagination
    DECLARE @Total INT = ISNULL((SELECT MAX(Total) FROM @Page), 0);
    IF @Total = 0 AND @PageNumber > 1
        -- Asked for a page past the end: count still matters for the client.
        SELECT @Total = COUNT(*)
        FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
        WHERE l.CompId = @CompId
          AND (@BranchId   IS NULL OR l.BranchId  = @BranchId)
          AND (@StatusId   IS NULL OR l.StatusId  = @StatusId)
          AND (@StatusCode IS NULL OR st.Code     = @StatusCode)
          AND (@ProductId  IS NULL OR l.ProductId = @ProductId)
          AND (@OwnerId    IS NULL OR l.OwnerId   = @OwnerId)
          AND (@SourceId   IS NULL OR l.SourceId  = @SourceId)
          AND (@Unassigned = 0 OR l.OwnerId IS NULL)
          AND (@Overdue = 0 OR (l.NextFollowupDate < @Today AND st.Code IN ('open','qualified')))
          AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                                  OR l.Company LIKE '%' + @SearchTerm + '%'
                                  OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                                  OR l.Email LIKE '%' + @SearchTerm + '%'
                                  OR l.City LIKE '%' + @SearchTerm + '%')
          AND (
                (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
              );

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;
END
GO


-- ---------------------------------------------------------------------------
-- 9.11 sp_FetchLeadDetail — 5 result sets
--   1 core (+labels)   2 custom values   3 timeline
--   4 follow-ups       5 assignment history
--   permission.js reads RS1[0].OwnerId / CreatedBy / BranchId — kept.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLeadDetail
    @CompId INT,
    @LeadId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    -- 1) core
    SELECT l.Id, l.CompId, l.BranchId, b.BranchName,
           l.Name, l.Company, l.MobileNo, l.AltMobile, l.Email,
           l.Address, l.City, l.State, l.Pincode,
           l.SourceId, src.Value AS SourceName,
           l.ProductId, p.Name AS ProductName,
           l.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           l.OwnerId, o.FullName AS OwnerName, o.Avatar AS OwnerAvatar,
           l.EstValue, l.Remarks, l.NextFollowupDate,
           CAST(CASE WHEN l.NextFollowupDate < @Today AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           200 AS ResponseCode, 'Lead detail retrieved successfully' AS ResponseMess
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblLookup lr  ON lr.Id  = l.LostReasonId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = l.ProductId
    LEFT JOIN dbo.tblUser o     ON o.Id   = l.OwnerId
    LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;

    -- 2) custom values
    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type,
           v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId = @CompId AND v.Entity = 'lead' AND v.EntityId = @LeadId
    ORDER BY d.SortOrder;

    -- 3) timeline
    SELECT a.Id, a.LeadId, a.UserId, u.FullName AS UserName, u.Avatar AS UserAvatar,
           a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblLeadActivity a
    LEFT JOIN dbo.tblUser u ON u.Id = a.UserId
    WHERE a.CompId = @CompId AND a.LeadId = @LeadId
    ORDER BY a.CreatedAt DESC, a.Id DESC;

    -- 4) follow-ups: open first (soonest due), then done/skipped newest first
    SELECT f.Id, f.LeadId, f.Type, f.DueAt, f.Status,
           f.AssignedTo, au.FullName AS AssignedToName,
           f.DoneAt, f.DoneBy, du.FullName AS DoneByName,
           f.OutcomeId, oc.Value AS Outcome, f.Remarks, f.Direction, f.Duration,
           CAST(CASE WHEN f.Status = 'open' AND f.DueAt < @Today THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           f.CreatedBy, f.CreatedAt
    FROM dbo.tblFollowUp f
    LEFT JOIN dbo.tblUser au ON au.Id = f.AssignedTo
    LEFT JOIN dbo.tblUser du ON du.Id = f.DoneBy
    LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
    WHERE f.CompId = @CompId AND f.LeadId = @LeadId
    ORDER BY CASE WHEN f.Status = 'open' THEN 0 ELSE 1 END,
             CASE WHEN f.Status = 'open' THEN f.DueAt END ASC,
             f.DoneAt DESC, f.Id DESC;

    -- 5) assignment history, newest first
    SELECT a.Id, a.LeadId,
           a.FromUserId, fu.FullName AS FromUserName,
           a.ToUserId,   tu.FullName AS ToUserName,
           a.FromBranchId, fb.BranchName AS FromBranchName,
           a.ToBranchId,   tb.BranchName AS ToBranchName,
           a.ReasonId, r.Value AS Reason, a.Remarks,
           a.AssignedBy, ab.FullName AS AssignedByName, a.AssignedAt
    FROM dbo.tblLeadAssignment a
    LEFT JOIN dbo.tblUser fu ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblUser ab ON ab.Id = a.AssignedBy
    LEFT JOIN dbo.tblBranch fb ON fb.Id = a.FromBranchId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    LEFT JOIN dbo.tblLookup r ON r.Id = a.ReasonId
    WHERE a.CompId = @CompId AND a.LeadId = @LeadId
    ORDER BY a.AssignedAt DESC, a.Id DESC;
END
GO


-- ---------------------------------------------------------------------------
-- 9.12 sp_SetLeadStatus — replaces sp_MoveLeadStage
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SetLeadStatus
    @CompId       INT,
    @LeadId       INT,
    @StatusId     INT,
    @LostReasonId INT = NULL,
    @UserId       INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END
    IF @StatusId IS NULL OR @StatusId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'StatusId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200);
    SELECT @FromStatusId = l.StatusId, @FromCode = st.Code, @FromName = st.Value
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    IF @FromStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    DECLARE @ToCode VARCHAR(30), @ToName NVARCHAR(200);
    SELECT @ToCode = Code, @ToName = Value FROM dbo.tblLookup
    WHERE Id = @StatusId AND CompId = @CompId AND Kind = 'lead_status' AND IsActive = 1;
    IF @ToCode IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Status not found' AS ResponseMess; RETURN; END

    IF @ToCode = 'converted'
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Use convert to move a lead to Converted' AS ResponseMess; RETURN; END

    IF @ToCode = 'lost' AND (@LostReasonId IS NULL OR @LostReasonId <= 0)
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Lost reason required' AS ResponseMess; RETURN; END
    IF @ToCode = 'lost'
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@LostReasonId AND CompId=@CompId AND Kind='lost_reason')
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Invalid lost reason' AS ResponseMess; RETURN; END

    IF @FromStatusId = @StatusId
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead already in this status' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblLeads
        SET StatusId = @StatusId,
            LostAt       = CASE WHEN @ToCode = 'lost' THEN GETDATE() ELSE NULL END,
            LostReasonId = CASE WHEN @ToCode = 'lost' THEN @LostReasonId ELSE NULL END,
            EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id = @LeadId AND CompId = @CompId;

        DECLARE @Summary NVARCHAR(500) = N'Status: ' + @FromName + N' → ' + @ToName;
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @StatusId AS toStatusId,
                                              @FromCode AS fromCode, @ToCode AS toCode,
                                              @LostReasonId AS lostReasonId
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead status updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 9.13 sp_TransferLead — reason + remarks always; history row always
--
--   @ToUserId NULL   -> unassign (Node allows this for wide scopes only)
--   @ToBranchId NULL -> branch stays where it is
--   Whether the CALLER may hand to this target is checked in Node against
--   sp_FetchAssignableUsers. This SP checks the target is real and the move
--   is not a no-op, then records it.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_TransferLead
    @CompId     INT,
    @LeadId     INT,
    @ToUserId   INT           = NULL,
    @ToBranchId INT           = NULL,
    @ReasonId   INT,
    @Remarks    NVARCHAR(500),
    @UserId     INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = ''
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Remarks are required for a transfer' AS ResponseMess; RETURN; END
    IF @ReasonId IS NULL OR @ReasonId <= 0
       OR NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@ReasonId AND CompId=@CompId AND Kind='transfer_reason')
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'A transfer reason is required' AS ResponseMess; RETURN; END
    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;
    IF @ToUserId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id=@ToUserId AND CompId=@CompId AND IsActive=1)
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Target user not found or inactive' AS ResponseMess; RETURN; END
    IF @ToBranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id=@ToBranchId)
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Target branch not found' AS ResponseMess; RETURN; END

    DECLARE @FromUserId INT, @FromBranchId INT;
    SELECT @FromUserId = OwnerId, @FromBranchId = BranchId
    FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId;
    IF @FromBranchId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    SET @ToBranchId = ISNULL(@ToBranchId, @FromBranchId);
    IF ISNULL(@FromUserId, -1) = ISNULL(@ToUserId, -1) AND @FromBranchId = @ToBranchId
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Lead is already assigned there' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblLeads
        SET OwnerId = @ToUserId, BranchId = @ToBranchId,
            AssignedAt = CASE WHEN @ToUserId IS NULL THEN NULL ELSE GETDATE() END,
            EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id=@LeadId AND CompId=@CompId;

        -- Open follow-ups travel with the lead.
        UPDATE dbo.tblFollowUp
        SET AssignedTo = @ToUserId, BranchId = @ToBranchId, EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE CompId=@CompId AND LeadId=@LeadId AND Status='open';

        INSERT INTO dbo.tblLeadAssignment
            (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy)
        VALUES
            (@CompId, @LeadId, @FromUserId, @ToUserId, @FromBranchId, @ToBranchId, @ReasonId, @Remarks, @UserId);

        DECLARE @ToName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id=@ToUserId), N'Unassigned');
        DECLARE @Reason NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id=@ReasonId);
        DECLARE @Summary NVARCHAR(500) =
            CASE WHEN @ToUserId IS NULL THEN N'Unassigned' ELSE N'Transferred to ' + @ToName END
            + CASE WHEN @FromBranchId <> @ToBranchId
                   THEN N' (' + ISNULL((SELECT BranchName FROM dbo.tblBranch WHERE Id=@ToBranchId), N'') + N')'
                   ELSE N'' END
            + N' — ' + ISNULL(@Reason, N'');
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromUserId AS fromUserId, @ToUserId AS toUserId,
                                              @FromBranchId AS fromBranchId, @ToBranchId AS toBranchId,
                                              @ReasonId AS reasonId, @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = 'assigned', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead transferred successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 9.14 sp_BulkTransferLeads — "move all of Ravi's leads to Priya"
--   Every id validated up front; one transaction; leads already with the
--   target are skipped, not errors.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_BulkTransferLeads
    @CompId      INT,
    @LeadIdsJson NVARCHAR(MAX),
    @ToUserId    INT           = NULL,
    @ToBranchId  INT           = NULL,
    @ReasonId    INT,
    @Remarks     NVARCHAR(500),
    @UserId      INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = ''
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'Remarks are required for a transfer' AS ResponseMess; RETURN; END
    IF @ReasonId IS NULL OR @ReasonId <= 0
       OR NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@ReasonId AND CompId=@CompId AND Kind='transfer_reason')
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'A transfer reason is required' AS ResponseMess; RETURN; END
    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;
    IF @ToUserId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id=@ToUserId AND CompId=@CompId AND IsActive=1)
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'Target user not found or inactive' AS ResponseMess; RETURN; END
    IF @ToBranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id=@ToBranchId)
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'Target branch not found' AS ResponseMess; RETURN; END

    DECLARE @Ids TABLE (LeadId INT PRIMARY KEY, OwnerId INT NULL, BranchId INT NULL, Done BIT DEFAULT 0);
    INSERT INTO @Ids (LeadId)
    SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(ISNULL(@LeadIdsJson, '[]'));
    IF NOT EXISTS (SELECT 1 FROM @Ids)
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'No leads supplied' AS ResponseMess; RETURN; END

    UPDATE i SET OwnerId = l.OwnerId, BranchId = l.BranchId
    FROM @Ids i JOIN dbo.tblLeads l ON l.Id = i.LeadId AND l.CompId = @CompId;
    IF EXISTS (SELECT 1 FROM @Ids WHERE BranchId IS NULL)
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 404 AS ResponseCode, 'One or more leads not found' AS ResponseMess; RETURN; END

    DECLARE @Transferred INT = 0, @Skipped INT = 0;
    DECLARE @LeadId INT, @FromUserId INT, @FromBranchId INT, @TargetBranch INT;
    DECLARE @Reason NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id=@ReasonId);
    DECLARE @ToName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id=@ToUserId), N'Unassigned');
    DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

    BEGIN TRY
        BEGIN TRANSACTION;

        WHILE EXISTS (SELECT 1 FROM @Ids WHERE Done = 0)
        BEGIN
            SELECT TOP 1 @LeadId = LeadId, @FromUserId = OwnerId, @FromBranchId = BranchId
            FROM @Ids WHERE Done = 0 ORDER BY LeadId;
            SET @TargetBranch = ISNULL(@ToBranchId, @FromBranchId);

            IF ISNULL(@FromUserId, -1) = ISNULL(@ToUserId, -1) AND @FromBranchId = @TargetBranch
                SET @Skipped += 1;
            ELSE
            BEGIN
                UPDATE dbo.tblLeads
                SET OwnerId = @ToUserId, BranchId = @TargetBranch,
                    AssignedAt = CASE WHEN @ToUserId IS NULL THEN NULL ELSE GETDATE() END,
                    EditBy = @UserId, UpdatedAt = GETDATE()
                WHERE Id=@LeadId AND CompId=@CompId;

                UPDATE dbo.tblFollowUp
                SET AssignedTo = @ToUserId, BranchId = @TargetBranch, EditBy = @UserId, UpdatedAt = GETDATE()
                WHERE CompId=@CompId AND LeadId=@LeadId AND Status='open';

                INSERT INTO dbo.tblLeadAssignment
                    (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy)
                VALUES
                    (@CompId, @LeadId, @FromUserId, @ToUserId, @FromBranchId, @TargetBranch, @ReasonId, @Remarks, @UserId);

                DECLARE @Summary NVARCHAR(500) =
                    CASE WHEN @ToUserId IS NULL THEN N'Unassigned' ELSE N'Transferred to ' + @ToName END
                    + N' — ' + ISNULL(@Reason, N'') + N' (bulk)';
                DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromUserId AS fromUserId, @ToUserId AS toUserId,
                                                      @FromBranchId AS fromBranchId, @TargetBranch AS toBranchId,
                                                      @ReasonId AS reasonId, @Remarks AS remarks, 1 AS isBulk
                                               FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
                INSERT INTO @actLog
                EXEC dbo.sp_LogLeadActivity
                    @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                    @Type = 'assigned', @Summary = @Summary, @MetaJSON = @Meta;

                SET @Transferred += 1;
            END

            UPDATE @Ids SET Done = 1 WHERE LeadId = @LeadId;
        END

        COMMIT TRANSACTION;

        SELECT @Transferred AS Transferred, @Skipped AS Skipped,
               200 AS ResponseCode, CAST(@Transferred AS VARCHAR(10)) + ' lead(s) transferred' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 0 AS Transferred, 0 AS Skipped, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 9.15 sp_DeleteLead — + assignment rows
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_DeleteLead
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess; RETURN; END
    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- No DB-level FKs (integrity lives in SPs): clear children explicitly.
        DELETE FROM dbo.tblCustomFieldValue WHERE Entity='lead' AND EntityId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblCall             WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeadActivity     WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblFollowUp         WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeadAssignment   WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeads            WHERE Id=@Id AND CompId=@CompId;

        COMMIT TRANSACTION;

        SELECT 200 AS ResponseCode, 'Lead deleted successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 9.16 Follow-ups — split by intent (schedule / complete / skip / fetch / delete)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ScheduleFollowUp
    @CompId     INT,
    @LeadId     INT,
    @UserId     INT,
    @Type       VARCHAR(20) = 'call',
    @DueAt      DATETIME,
    @AssignedTo INT = NULL        -- NULL = the lead's current owner
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END
    IF @DueAt IS NULL
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Due date is required' AS ResponseMess; RETURN; END
    IF @Type IS NULL OR @Type NOT IN ('call','visit','meeting','other')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Type must be call, visit, meeting or other' AS ResponseMess; RETURN; END

    DECLARE @BranchId INT, @OwnerId INT;
    SELECT @BranchId = BranchId, @OwnerId = OwnerId FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId;
    IF @BranchId IS NULL
    BEGIN SELECT 0 AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF @AssignedTo IS NULL OR @AssignedTo <= 0 SET @AssignedTo = @OwnerId;

    INSERT INTO dbo.tblFollowUp (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, CreatedBy)
    VALUES (@CompId, @BranchId, @LeadId, @Type, @DueAt, @AssignedTo, 'open', @UserId);
    DECLARE @Id INT = CAST(SCOPE_IDENTITY() AS INT);

    EXEC dbo.sp_RefreshLeadNextFollowup @CompId = @CompId, @LeadId = @LeadId;

    SELECT @Id AS Id, 201 AS ResponseCode, 'Follow-up scheduled' AS ResponseMess;
END
GO

CREATE OR ALTER PROC dbo.sp_CompleteFollowUp
    @CompId     INT,
    @Id         INT,
    @UserId     INT,
    @OutcomeId  INT            = NULL,
    @Remarks    NVARCHAR(1000),
    @Direction  VARCHAR(5)     = NULL,
    @Duration   INT            = NULL,
    @NextType   VARCHAR(20)    = NULL,
    @NextDueAt  DATETIME       = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, NULL AS NextId, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @Id IS NULL OR @Id <= 0
    BEGIN SELECT @Id AS Id, NULL AS NextId, 400 AS ResponseCode, 'Id is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Id AS Id, NULL AS NextId, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = ''
    BEGIN SELECT @Id AS Id, NULL AS NextId, 400 AS ResponseCode, 'Remarks are required' AS ResponseMess; RETURN; END
    IF @Direction IS NOT NULL AND @Direction NOT IN ('in','out')
    BEGIN SELECT @Id AS Id, NULL AS NextId, 400 AS ResponseCode, 'Direction must be in or out' AS ResponseMess; RETURN; END
    IF @OutcomeId IS NOT NULL AND @OutcomeId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@OutcomeId AND CompId=@CompId AND Kind='call_outcome')
    BEGIN SELECT @Id AS Id, NULL AS NextId, 400 AS ResponseCode, 'Invalid outcome' AS ResponseMess; RETURN; END
    IF @NextDueAt IS NOT NULL AND (@NextType IS NULL OR @NextType NOT IN ('call','visit','meeting','other'))
        SET @NextType = 'call';

    DECLARE @LeadId INT, @Status VARCHAR(20), @Type VARCHAR(20), @BranchId INT;
    SELECT @LeadId = LeadId, @Status = Status, @Type = Type, @BranchId = BranchId
    FROM dbo.tblFollowUp WHERE Id=@Id AND CompId=@CompId;
    IF @LeadId IS NULL
    BEGIN SELECT @Id AS Id, NULL AS NextId, 404 AS ResponseCode, 'Follow-up not found' AS ResponseMess; RETURN; END
    IF @Status <> 'open'
    BEGIN SELECT @Id AS Id, NULL AS NextId, 409 AS ResponseCode, 'Follow-up is already ' + @Status AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @NextId INT = NULL;

        UPDATE dbo.tblFollowUp
        SET Status = 'done', DoneAt = GETDATE(), DoneBy = @UserId,
            OutcomeId = @OutcomeId, Remarks = @Remarks, Direction = @Direction, Duration = @Duration,
            EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id=@Id AND CompId=@CompId;

        IF @NextDueAt IS NOT NULL
        BEGIN
            DECLARE @OwnerId INT = (SELECT OwnerId FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId);
            INSERT INTO dbo.tblFollowUp (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, CreatedBy)
            VALUES (@CompId, @BranchId, @LeadId, @NextType, @NextDueAt, @OwnerId, 'open', @UserId);
            SET @NextId = CAST(SCOPE_IDENTITY() AS INT);
        END

        EXEC dbo.sp_RefreshLeadNextFollowup @CompId = @CompId, @LeadId = @LeadId;
        UPDATE dbo.tblLeads SET EditBy = @UserId, UpdatedAt = GETDATE() WHERE Id=@LeadId AND CompId=@CompId;

        DECLARE @Outcome NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id=@OutcomeId);
        DECLARE @Summary NVARCHAR(500) =
            CASE @Type WHEN 'call' THEN N'Call' WHEN 'visit' THEN N'Visit' WHEN 'meeting' THEN N'Meeting' ELSE N'Follow-up' END
            + CASE WHEN @Outcome IS NULL THEN N'' ELSE N' · ' + @Outcome END
            + N': ' + LEFT(@Remarks, 300)
            + CASE WHEN @NextDueAt IS NULL THEN N'' ELSE N' · next ' + CONVERT(NVARCHAR(10), @NextDueAt, 105) END;
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @Id AS followUpId, @Type AS type, @OutcomeId AS outcomeId,
                                              @Direction AS direction, @Duration AS duration,
                                              @NextId AS nextFollowUpId, @NextDueAt AS nextDueAt
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        DECLARE @ActType VARCHAR(30) = CASE WHEN @Type = 'call' THEN 'call' ELSE 'followup' END;
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = @ActType, @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;

        SELECT @Id AS Id, @NextId AS NextId, 200 AS ResponseCode, 'Follow-up logged' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Id AS Id, NULL AS NextId, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROC dbo.sp_SkipFollowUp
    @CompId  INT,
    @Id      INT,
    @UserId  INT,
    @Remarks NVARCHAR(1000)
AS
BEGIN
    SET NOCOUNT ON;

    IF @Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = ''
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Remarks are required' AS ResponseMess; RETURN; END

    DECLARE @LeadId INT, @Status VARCHAR(20);
    SELECT @LeadId = LeadId, @Status = Status FROM dbo.tblFollowUp WHERE Id=@Id AND CompId=@CompId;
    IF @LeadId IS NULL
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Follow-up not found' AS ResponseMess; RETURN; END
    IF @Status <> 'open'
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Follow-up is already ' + @Status AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblFollowUp
        SET Status = 'skipped', DoneAt = GETDATE(), DoneBy = @UserId, Remarks = @Remarks,
            EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id=@Id AND CompId=@CompId;

        EXEC dbo.sp_RefreshLeadNextFollowup @CompId = @CompId, @LeadId = @LeadId;

        DECLARE @Summary NVARCHAR(500) = N'Follow-up skipped: ' + LEFT(@Remarks, 400);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = 'followup', @Summary = @Summary, @MetaJSON = NULL;

        COMMIT TRANSACTION;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Follow-up skipped' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- Two modes:
--   @LeadId > 0 : every follow-up on that lead, open first. No paging.
--   otherwise   : cross-lead, paged, scoped like leads, for the Follow-ups page.
--                 @Overdue = open and past due. @DueFrom/@DueTo bracket DueAt.
CREATE OR ALTER PROC dbo.sp_FetchFollowUps
    @CompId                  INT,
    @LeadId                  INT           = 0,
    @AssignedTo              INT           = NULL,
    @Status                  VARCHAR(20)   = NULL,
    @DueFrom                 DATETIME      = NULL,
    @DueTo                   DATETIME      = NULL,
    @Overdue                 BIT           = 0,
    @SearchTerm              NVARCHAR(200) = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    IF ISNULL(@LeadId, 0) > 0
    BEGIN
        SELECT f.Id, f.LeadId, f.Type, f.DueAt, f.Status,
               f.AssignedTo, au.FullName AS AssignedToName,
               f.DoneAt, f.DoneBy, du.FullName AS DoneByName,
               f.OutcomeId, oc.Value AS Outcome, f.Remarks, f.Direction, f.Duration,
               CAST(CASE WHEN f.Status = 'open' AND f.DueAt < @Today THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
               f.CreatedBy, f.CreatedAt,
               200 AS ResponseCode, 'Follow-ups retrieved successfully' AS ResponseMess
        FROM dbo.tblFollowUp f
        LEFT JOIN dbo.tblUser au ON au.Id = f.AssignedTo
        LEFT JOIN dbo.tblUser du ON du.Id = f.DoneBy
        LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
        WHERE f.CompId = @CompId AND f.LeadId = @LeadId
        ORDER BY CASE WHEN f.Status = 'open' THEN 0 ELSE 1 END,
                 CASE WHEN f.Status = 'open' THEN f.DueAt END ASC,
                 f.DoneAt DESC, f.Id DESC;
        RETURN;
    END

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,25) < 1 THEN 25 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @Status IS NOT NULL AND LTRIM(RTRIM(@Status)) = '' SET @Status = NULL;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    DECLARE @Page TABLE (Id INT, Total INT, rn INT);
    INSERT INTO @Page (Id, Total, rn)
    SELECT f.Id, COUNT(*) OVER (), ROW_NUMBER() OVER (ORDER BY f.DueAt ASC, f.Id ASC)
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId
      AND (@AssignedTo IS NULL OR f.AssignedTo = @AssignedTo)
      AND (@Status IS NULL OR f.Status = @Status)
      AND (@DueFrom IS NULL OR f.DueAt >= @DueFrom)
      AND (@DueTo   IS NULL OR f.DueAt <  DATEADD(DAY, 1, CAST(CAST(@DueTo AS DATE) AS DATETIME)))
      AND (@Overdue = 0 OR (f.Status = 'open' AND f.DueAt < @Today AND st.Code IN ('open','qualified')))
      AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                              OR l.Company LIKE '%' + @SearchTerm + '%'
                              OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                              OR f.Remarks LIKE '%' + @SearchTerm + '%')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.AssignedTo = @UserId))
          )
    ORDER BY f.DueAt ASC, f.Id ASC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT f.Id, f.LeadId, l.Name AS LeadName, l.Company AS LeadCompany, l.MobileNo AS LeadMobile,
           l.BranchId, l.OwnerId, o.FullName AS OwnerName,
           l.StatusId, st.Value AS LeadStatus, st.Code AS LeadStatusCode,
           f.Type, f.DueAt, f.Status,
           f.AssignedTo, au.FullName AS AssignedToName,
           f.DoneAt, f.DoneBy, du.FullName AS DoneByName,
           f.OutcomeId, oc.Value AS Outcome, f.Remarks, f.Direction, f.Duration,
           CAST(CASE WHEN f.Status = 'open' AND f.DueAt < @Today THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           f.CreatedBy, f.CreatedAt,
           200 AS ResponseCode, 'Follow-ups retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblFollowUp f ON f.Id = x.Id
    JOIN dbo.tblLeads l ON l.Id = f.LeadId
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser o  ON o.Id  = l.OwnerId
    LEFT JOIN dbo.tblUser au ON au.Id = f.AssignedTo
    LEFT JOIN dbo.tblUser du ON du.Id = f.DoneBy
    LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
    ORDER BY x.rn;

    DECLARE @Total INT = ISNULL((SELECT MAX(Total) FROM @Page), 0);
    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO

CREATE OR ALTER PROC dbo.sp_DeleteFollowUp
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF (@CompId IS NULL OR @CompId = 0)
    BEGIN SELECT 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END

    DECLARE @LeadId INT, @Status VARCHAR(20);
    SELECT @LeadId = LeadId, @Status = Status FROM dbo.tblFollowUp WHERE Id = @Id AND CompId = @CompId;
    IF @LeadId IS NULL
    BEGIN SELECT 404 AS ResponseCode, 'Follow-up not found' AS ResponseMess; RETURN; END
    -- Done rows are history. They are not deleted; that is the point of them.
    IF @Status <> 'open'
    BEGIN SELECT 409 AS ResponseCode, 'Only an open follow-up can be deleted' AS ResponseMess; RETURN; END

    DELETE FROM dbo.tblFollowUp WHERE Id = @Id AND CompId = @CompId;
    EXEC dbo.sp_RefreshLeadNextFollowup @CompId = @CompId, @LeadId = @LeadId;

    SELECT 200 AS ResponseCode, 'Follow-up deleted successfully' AS ResponseMess;
END
GO


-- ---------------------------------------------------------------------------
-- 9.17 sp_LogCall — no longer writes a follow-up
--   Lead calls are follow-ups now (sp_CompleteFollowUp, Type='call'). This
--   stays for tickets. @NextFollowupDate / @FollowupRemarks are kept in the
--   signature so the current controller keeps compiling; they are ignored.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_LogCall
    @CompId           INT,
    @LeadId           INT           = NULL,
    @TicketId         INT           = NULL,
    @UserId           INT,
    @Direction        VARCHAR(5),
    @OutcomeId        INT           = NULL,
    @Notes            NVARCHAR(1000)= NULL,
    @Duration         INT           = NULL,
    @NextFollowupDate DATETIME      = NULL,
    @FollowupRemarks  NVARCHAR(1000)= NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF (@LeadId IS NULL OR @LeadId <= 0) AND (@TicketId IS NULL OR @TicketId <= 0)
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'A LeadId or TicketId is required' AS ResponseMess; RETURN; END
    IF @Direction IS NULL OR @Direction NOT IN ('in','out')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Direction must be in or out' AS ResponseMess; RETURN; END

    IF @LeadId IS NOT NULL AND @LeadId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId)
    BEGIN SELECT 0 AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF @TicketId IS NOT NULL AND @TicketId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id=@TicketId AND CompId=@CompId)
    BEGIN SELECT 0 AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @CallId INT;

        INSERT INTO dbo.tblCall
            (CompId, LeadId, TicketId, UserId, Direction, OutcomeId, Notes, Duration, CalledAt, CreatedBy)
        VALUES
            (@CompId, @LeadId, @TicketId, @UserId, @Direction, @OutcomeId, @Notes, @Duration, GETDATE(), @UserId);

        SET @CallId = CAST(SCOPE_IDENTITY() AS INT);

        IF @LeadId IS NOT NULL AND @LeadId > 0
        BEGIN
            INSERT INTO @actLog
            EXEC dbo.sp_LogLeadActivity
                @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                @Type = 'call', @Summary = 'Call logged', @MetaJSON = NULL;
        END

        IF @TicketId IS NOT NULL AND @TicketId > 0
        BEGIN
            DECLARE @TicketSummary NVARCHAR(500) =
                CASE WHEN @Direction = 'in' THEN 'Inbound call logged' ELSE 'Outbound call logged' END;
            INSERT INTO @actLog
            EXEC dbo.sp_LogTicketActivity
                @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
                @Type = 'call', @Summary = @TicketSummary, @MetaJSON = NULL;
        END

        COMMIT TRANSACTION;

        SELECT @CallId AS Id, 200 AS ResponseCode, 'Call logged successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 0 AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 9.18 Reports
-- ---------------------------------------------------------------------------

-- Replaces sp_PipelineFunnel. Same optional @BranchId; also accepts the
-- scope JSON so the controller can pass either.
CREATE OR ALTER PROC dbo.sp_LeadsByStatus
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @UseScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseScope = 1;
    END

    SELECT st.Id AS StatusId, st.Value AS StatusName, st.Code AS StatusCode, st.SortOrder,
           COUNT(l.Id) AS LeadCount,
           200 AS ResponseCode, 'Leads by status retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup st
    LEFT JOIN dbo.tblLeads l
           ON l.StatusId = st.Id AND l.CompId = @CompId
          AND (@BranchId IS NULL OR l.BranchId = @BranchId)
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
    WHERE st.CompId = @CompId AND st.Kind = 'lead_status' AND st.IsActive = 1
    GROUP BY st.Id, st.Value, st.Code, st.SortOrder
    ORDER BY st.SortOrder;
END
GO

-- Lead calls are done follow-ups of Type='call'; ticket calls still live in
-- tblCall. Both count.
CREATE OR ALTER PROC dbo.sp_CallsPerUser
    @CompId   INT,
    @BranchId INT      = NULL,
    @FromDate DATETIME = NULL,
    @ToDate   DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH calls AS (
        SELECT f.DoneBy AS UserId, f.DoneAt AS CalledAt, l.BranchId
        FROM dbo.tblFollowUp f
        JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
        WHERE f.CompId = @CompId AND f.Type = 'call' AND f.Status = 'done' AND f.DoneBy IS NOT NULL
        UNION ALL
        SELECT c.UserId, c.CalledAt, t.BranchId
        FROM dbo.tblCall c
        JOIN dbo.tblTicket t ON t.Id = c.TicketId AND t.CompId = c.CompId
        WHERE c.CompId = @CompId AND c.TicketId IS NOT NULL
    )
    SELECT c.UserId, u.FullName, COUNT(*) AS CallCount,
           200 AS ResponseCode, 'Calls per user retrieved successfully' AS ResponseMess
    FROM calls c
    LEFT JOIN dbo.tblUser u ON u.Id = c.UserId
    WHERE (@FromDate IS NULL OR c.CalledAt >= @FromDate)
      AND (@ToDate   IS NULL OR c.CalledAt <  DATEADD(DAY, 1, @ToDate))
      AND (@BranchId IS NULL OR c.BranchId = @BranchId)
    GROUP BY c.UserId, u.FullName
    ORDER BY CallCount DESC;
END
GO

-- WonCount stays in the contract (0 until spec 3 sets WonAt on conversion);
-- QualifiedCount is the interim conversion measure the page shows.
CREATE OR ALTER PROC dbo.sp_ConversionBySource
    @CompId   INT,
    @BranchId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT lk.Id AS SourceId, lk.Value AS SourceName,
           COUNT(l.Id) AS TotalLeads,
           SUM(CASE WHEN st.Code IN ('qualified','converted') THEN 1 ELSE 0 END) AS QualifiedCount,
           SUM(CASE WHEN l.WonAt IS NOT NULL THEN 1 ELSE 0 END) AS WonCount,
           SUM(CASE WHEN st.Code = 'lost' THEN 1 ELSE 0 END) AS LostCount,
           200 AS ResponseCode, 'Conversion by source retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblLeads l
           ON l.SourceId = lk.Id AND l.CompId = @CompId
          AND (@BranchId IS NULL OR l.BranchId = @BranchId)
    LEFT JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE lk.CompId = @CompId AND lk.Kind = 'lead_source' AND lk.IsActive = 1
    GROUP BY lk.Id, lk.Value
    ORDER BY TotalLeads DESC;
END
GO

-- Result-set contract unchanged (RS0 KPIs, RS1 trend, RS2 sources, RS3 funnel,
-- RS4 team load, RS5 quarterly). What changed inside:
--   * follow-up KPIs read tblFollowUp (open rows), not the lead cache
--   * "active" lead = status Code in (open, qualified)
--   * RS3 funnel = leads per status (the pipeline is gone)
--   * RS5 calls = done call follow-ups + ticket calls
CREATE OR ALTER PROCEDURE dbo.sp_Dashboard
    @CompId BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;
    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    /* RS0 — KPI rows */
    SELECT 'TotalLeads' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))

    UNION ALL

    SELECT 'TodayNewLeads', COUNT(*)
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))
      AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)

    UNION ALL

    SELECT 'TodayFollowups', COUNT(*)
    FROM tblFollowUp f
    JOIN tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status = 'open'
      AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND CAST(f.DueAt AS DATE) = CAST(GETDATE() AS DATE)
      AND st.Code IN ('open','qualified')

    UNION ALL

    SELECT 'MissedFollowups', COUNT(*)
    FROM tblFollowUp f
    JOIN tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status = 'open'
      AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND f.DueAt < @Today
      AND st.Code IN ('open','qualified');

    /* RS1 — leads per day, last 7 days */
    ;WITH days AS (
        SELECT DATEADD(DAY, -v.n, CAST(GETDATE() AS DATE)) AS D
        FROM (VALUES (6),(5),(4),(3),(2),(1),(0)) v(n)
    )
    SELECT LEFT(DATENAME(WEEKDAY, d.D), 3) AS Name,
           d.D AS [Date],
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND CAST(l.CreatedAt AS DATE) = d.D) AS Leads,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND CAST(l.WonAt AS DATE) = d.D) AS Converted
    FROM days d
    ORDER BY d.D;

    /* RS2 — leads by source, top 5 + Other */
    ;WITH src AS (
        SELECT ISNULL(lk.Value, N'Unknown') AS Name,
               COUNT(*) AS Value,
               ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rn
        FROM tblLeads l
        LEFT JOIN tblLookup lk ON lk.Id = l.SourceId AND lk.CompId = l.CompId
        WHERE l.CompId = @CompId
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
        GROUP BY ISNULL(lk.Value, N'Unknown')
    )
    SELECT x.Name, x.Value
    FROM (
        SELECT Name, Value, rn FROM src WHERE rn <= 5
        UNION ALL
        SELECT N'Other', SUM(Value), 6 FROM src WHERE rn > 5 HAVING SUM(Value) > 0
    ) x
    ORDER BY x.rn;

    /* RS3 — funnel: leads per status */
    SELECT st.Value AS Name, COUNT(l.Id) AS Value, st.SortOrder
    FROM tblLookup st
    LEFT JOIN tblLeads l
           ON l.StatusId = st.Id AND l.CompId = @CompId
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
    WHERE st.CompId = @CompId AND st.Kind = 'lead_status' AND st.IsActive = 1
    GROUP BY st.Id, st.Value, st.SortOrder
    ORDER BY st.SortOrder;

    /* RS4 — team load: active leads per owner, top 5 */
    SELECT TOP 5 u.FullName AS Name, COUNT(*) AS Value
    FROM tblLeads l
    JOIN tblUser u ON u.Id = l.OwnerId AND u.IsActive = 1
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId
      AND st.Code IN ('open','qualified')
      AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
    GROUP BY u.Id, u.FullName
    ORDER BY Value DESC;

    /* RS5 — activity per quarter, current year */
    ;WITH q AS (SELECT v.n FROM (VALUES (1),(2),(3),(4)) v(n))
    SELECT 'Q' + CAST(q.n AS VARCHAR(1)) AS Name,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND YEAR(l.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, l.CreatedAt) = q.n) AS Leads,
           (SELECT COUNT(*) FROM tblFollowUp f
              JOIN tblLeads bl ON bl.Id = f.LeadId AND bl.CompId = f.CompId
             WHERE f.CompId = @CompId AND f.Type = 'call' AND f.Status = 'done'
               AND YEAR(f.DoneAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, f.DoneAt) = q.n
               AND (@UseScope = 0 OR bl.BranchId IN (SELECT BranchId FROM @BranchIds)))
           + (SELECT COUNT(*) FROM tblCall c
               JOIN tblTicket bt ON bt.Id = c.TicketId AND bt.CompId = c.CompId
              WHERE c.CompId = @CompId
                AND YEAR(c.CalledAt) = YEAR(GETDATE())
                AND DATEPART(QUARTER, c.CalledAt) = q.n
                AND (@UseScope = 0 OR bt.BranchId IN (SELECT BranchId FROM @BranchIds))) AS Calls,
           (SELECT COUNT(*) FROM tblTicket t
             WHERE t.CompId = @CompId
               AND (@UseScope = 0 OR t.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND YEAR(t.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, t.CreatedAt) = q.n) AS Tickets
    FROM q
    ORDER BY q.n;
END
GO


-- ===========================================================================
-- VERIFY AFTER APPLY — everything below rolls back
-- ===========================================================================
SET NOCOUNT ON;

-- 1. Shape
SELECT 'tblUser.ReportsTo'      AS what, CASE WHEN COL_LENGTH('dbo.tblUser','ReportsTo')     IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS state
UNION ALL SELECT 'tblLookup.Code',        CASE WHEN COL_LENGTH('dbo.tblLookup','Code')        IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblLeads.StatusId',     CASE WHEN COL_LENGTH('dbo.tblLeads','StatusId')     IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblLeads.StageId gone', CASE WHEN COL_LENGTH('dbo.tblLeads','StageId')      IS NULL     THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'tblLeads.PipelineId gone', CASE WHEN COL_LENGTH('dbo.tblLeads','PipelineId') IS NULL    THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'tblFollowUp.DueAt',     CASE WHEN COL_LENGTH('dbo.tblFollowUp','DueAt')     IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblProduct',            CASE WHEN OBJECT_ID('dbo.tblProduct')               IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblLeadAssignment',     CASE WHEN OBJECT_ID('dbo.tblLeadAssignment')        IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'lead pipelines gone',   CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.tblPipeline WHERE Entity='lead') THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'old procs gone',        CASE WHEN OBJECT_ID('dbo.sp_MoveLeadStage','P') IS NULL AND OBJECT_ID('dbo.sp_SaveFollowUp','P') IS NULL
                                                AND OBJECT_ID('dbo.sp_FetchFollowUp','P') IS NULL AND OBJECT_ID('dbo.sp_PipelineFunnel','P') IS NULL
                                               THEN 'ok' ELSE 'STILL THERE' END;

-- 2. Seeds per company (expect 6 / 1 / 6)
SELECT CompId, Kind, COUNT(*) AS N
FROM dbo.tblLookup
WHERE Kind IN ('lead_status','product_category','transfer_reason') AND IsActive = 1
GROUP BY CompId, Kind ORDER BY CompId, Kind;

-- 3. Every lead has a status
SELECT COUNT(*) AS leads_without_status FROM dbo.tblLeads WHERE StatusId IS NULL;   -- expect 0

-- 4. New procs present
SELECT name FROM sys.procedures
WHERE name IN ('sp_FetchAssignableUsers','sp_SaveProduct','sp_FetchProducts','sp_DeleteProduct',
               'sp_RefreshLeadNextFollowup','sp_SetLeadStatus','sp_BulkTransferLeads',
               'sp_ScheduleFollowUp','sp_CompleteFollowUp','sp_SkipFollowUp','sp_FetchFollowUps','sp_LeadsByStatus')
ORDER BY name;   -- expect 12 rows

-- 5. Dry run of the lead lifecycle, rolled back.
--
--    Plain EXEC, not INSERT-EXEC: the write procs capture their activity
--    logger via INSERT INTO @actLog EXEC ..., and T-SQL refuses to nest
--    INSERT-EXEC (Msg 8164). Each proc's own status row prints as its own
--    grid, directly under the 'step' label that precedes it — read
--    ResponseCode there. Outer TRY/CATCH guarantees the rollback.
BEGIN TRY
BEGIN TRANSACTION;
    DECLARE @cid INT = (SELECT TOP 1 CAST(CompId AS INT) FROM dbo.tblUser WHERE IsActive = 1 ORDER BY Id);
    DECLARE @u1  INT = (SELECT TOP 1 Id FROM dbo.tblUser WHERE CompId = @cid AND IsActive = 1 ORDER BY Id);
    DECLARE @u2  INT = (SELECT TOP 1 Id FROM dbo.tblUser WHERE CompId = @cid AND IsActive = 1 AND Id <> @u1 ORDER BY Id);
    DECLARE @bid INT = (SELECT BranchId FROM dbo.tblUser WHERE Id = @u1);
    DECLARE @reason INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='transfer_reason' ORDER BY SortOrder);
    DECLARE @lost   INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='lead_status' AND Code='lost');
    DECLARE @lid INT, @fid INT;

    -- (a) create -> 200; one open follow-up due today; one assignment row
    SELECT '(a) create — expect ResponseCode 200 below' AS step;
    EXEC dbo.sp_SaveLead @Id=0, @CompId=@cid, @BranchId=@bid, @UserId=@u1,
         @Name=N'verify-071', @MobileNo='9999999999', @City=N'Pune', @Pincode='411001', @OwnerId=@u1, @EstValue=50000;
    SET @lid = (SELECT TOP 1 Id FROM dbo.tblLeads WHERE CompId=@cid AND Name=N'verify-071' ORDER BY Id DESC);
    SELECT '(a) open follow-ups' AS step, COUNT(*) AS N, 1 AS expect FROM dbo.tblFollowUp WHERE LeadId=@lid AND Status='open';
    SELECT '(a) assignment rows' AS step, COUNT(*) AS N, 1 AS expect FROM dbo.tblLeadAssignment WHERE LeadId=@lid;
    SELECT '(a) NextFollowupDate is today' AS step,
           CASE WHEN CAST(NextFollowupDate AS DATE) = CAST(GETDATE() AS DATE) THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblLeads WHERE Id=@lid;

    -- (b) complete without remarks -> 400
    SET @fid = (SELECT TOP 1 Id FROM dbo.tblFollowUp WHERE LeadId=@lid AND Status='open');
    SELECT '(b) complete without remarks — expect 400 below' AS step;
    EXEC dbo.sp_CompleteFollowUp @CompId=@cid, @Id=@fid, @UserId=@u1, @Remarks='';

    -- (c) complete with remarks + next date -> 200 with NextId; open=1 done=1
    DECLARE @next DATETIME = DATEADD(DAY, 2, CAST(GETDATE() AS DATE));
    SELECT '(c) complete with remarks + next date — expect 200 and a NextId below' AS step;
    EXEC dbo.sp_CompleteFollowUp @CompId=@cid, @Id=@fid, @UserId=@u1, @Remarks=N'Spoke, wants quote', @NextDueAt=@next;
    SELECT '(c) follow-ups by status' AS step, Status, COUNT(*) AS N FROM dbo.tblFollowUp WHERE LeadId=@lid GROUP BY Status;

    -- (d) transfer without remarks -> 400; with -> 200, history row, follow-up moves
    SELECT '(d) transfer without remarks — expect 400 below' AS step;
    EXEC dbo.sp_TransferLead @CompId=@cid, @LeadId=@lid, @ToUserId=@u2, @ReasonId=@reason, @Remarks='', @UserId=@u1;
    IF @u2 IS NOT NULL
    BEGIN
        SELECT '(d) transfer to u2 — expect 200 below' AS step;
        EXEC dbo.sp_TransferLead @CompId=@cid, @LeadId=@lid, @ToUserId=@u2, @ReasonId=@reason, @Remarks=N'Absent today', @UserId=@u1;
        SELECT '(d) assignment rows' AS step, COUNT(*) AS N, 2 AS expect FROM dbo.tblLeadAssignment WHERE LeadId=@lid;
        SELECT '(d) open follow-up moved to u2' AS step,
               CASE WHEN AssignedTo = @u2 THEN 'ok' ELSE 'WRONG' END AS state
        FROM dbo.tblFollowUp WHERE LeadId=@lid AND Status='open';

        -- bulk: send it back to u1 -> Transferred=1, Skipped=0
        DECLARE @ids NVARCHAR(MAX) = '[' + CAST(@lid AS VARCHAR(10)) + ']';
        SELECT '(d) bulk transfer back to u1 — expect Transferred=1, Skipped=0 below' AS step;
        EXEC dbo.sp_BulkTransferLeads @CompId=@cid, @LeadIdsJson=@ids, @ToUserId=@u1, @ReasonId=@reason, @Remarks=N'Back on duty', @UserId=@u2;
        SELECT '(d) assignment rows after bulk' AS step, COUNT(*) AS N, 3 AS expect FROM dbo.tblLeadAssignment WHERE LeadId=@lid;
    END

    -- (e) lost without reason -> 400
    SELECT '(e) Lost without reason — expect 400 below' AS step;
    EXEC dbo.sp_SetLeadStatus @CompId=@cid, @LeadId=@lid, @StatusId=@lost, @UserId=@u1;

    -- (f) the CHECK itself: a done row with blank remarks must be rejected by the table
    BEGIN TRY
        UPDATE dbo.tblFollowUp SET Remarks = N'' WHERE Id = @fid;
        SELECT '(f) CHECK constraint' AS step, 'NOT ENFORCED' AS state;
    END TRY
    BEGIN CATCH
        SELECT '(f) CHECK constraint' AS step, 'ok — rejected: ' + ERROR_MESSAGE() AS state;
    END CATCH

    -- (g) hierarchy: point u2 at u1 -> u1's subtree contains u2; loop refused
    IF @u2 IS NOT NULL
    BEGIN
        UPDATE dbo.tblUser SET ReportsTo = @u1 WHERE Id = @u2;

        -- sp_FetchAssignableUsers and sp_SaveUser have no nested INSERT-EXEC, so capture is fine here.
        DECLARE @assignable TABLE (Id INT, FullName VARCHAR(200), Avatar VARCHAR(60), JobTitle VARCHAR(100),
                                   BranchId BIGINT, BranchName VARCHAR(50), ReportsTo INT,
                                   ResponseCode INT, ResponseMess VARCHAR(200));
        INSERT INTO @assignable EXEC dbo.sp_FetchAssignableUsers @UserId = @u1, @CompId = @cid;
        SELECT '(g) u2 assignable from u1' AS step, COUNT(*) AS N, 1 AS expect FROM @assignable WHERE Id = @u2;

        -- Plain EXEC: sp_SaveUser's refusal rows are 2 columns, its success row
        -- is 4, so a capture table cannot fit both. Read the grid below.
        DECLARE @uname VARCHAR(100), @ufull VARCHAR(200), @ugrp INT;
        SELECT @uname = Username, @ufull = FullName FROM dbo.tblUser WHERE Id = @u1;
        SELECT TOP 1 @ugrp = GroupId FROM dbo.tblUserGroupMap WHERE UserId = @u1;
        SELECT '(g) u1 -> reports to u2 would loop — expect 400 below' AS step;
        EXEC dbo.sp_SaveUser @Id=@u1, @Username=@uname, @Password=NULL, @UserActive=1, @IsAdmin=0,
             @UserIp=NULL, @AllowDay=NULL, @FullName=@ufull, @Email=NULL, @JobTitle=NULL, @HourlyRate=NULL,
             @GroupId=@ugrp, @CompId=@cid, @BranchId=@bid, @Mobile=NULL, @ReportsTo=@u2;
    END

    SELECT '(h) rolling back — nothing above is kept' AS step;
ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'VERIFY FAILED (rolled back)' AS step, ERROR_NUMBER() AS ErrNo, ERROR_PROCEDURE() AS Proc_, ERROR_LINE() AS Line_, ERROR_MESSAGE() AS Msg_;
END CATCH
