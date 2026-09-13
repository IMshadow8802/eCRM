-- ============================================================================
-- 075_sales_reports.sql
--
-- Spec 4a — the sales report system.
-- Design: docs/superpowers/specs/2026-09-10-sales-reports-design.md
--
-- What changes and why:
--   * tblLeadStatusHistory — every status change, written by sp_SaveLead
--     (insert path) and sp_SetLeadStatus in the same transaction. The funnel
--     over time and "days per step" cannot be derived from tblLeads alone.
--     Backfilled with one opening row per existing lead.
--   * sp_FetchLeads gains @FromDate/@ToDate (CreatedAt window) so a report
--     number can drill into the exact list it counted.
--   * Eight read-only report procs, sp_Rpt*, one contract (spec §3): same
--     twelve params, three result sets (KPIs · breakdown · trend), branch AND
--     owner scope exactly as sp_FetchLeads applies it. This closes the live
--     test finding that a Team/Self caller saw branch totals.
--   * Sidebar: rows 20/21/22 re-pointed to the new pages (grants carry over),
--     six new rows cloned from row 20. Menu rights load at LOGIN — re-login.
--
-- APPLY BY HAND, top to bottom, in one go. Idempotent: DDL guarded, procs are
-- CREATE OR ALTER, menu inserts use NOT EXISTS. The verify block at the bottom
-- rolls back its dry run.
--
-- Deploy the backend AFTER this is applied — the new endpoints call sp_Rpt*
-- and leadController sends @FromDate/@ToDate to sp_FetchLeads.
--
-- Author: Claude  Date: 2026-09-10
-- ============================================================================

IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO

-- ---------------------------------------------------------------------------
-- 1. tblLeadStatusHistory
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblLeadStatusHistory') IS NULL
BEGIN
    CREATE TABLE dbo.tblLeadStatusHistory (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblLeadStatusHistory PRIMARY KEY,
        CompId       INT NOT NULL,
        LeadId       INT NOT NULL,
        FromStatusId INT NULL,
        ToStatusId   INT NOT NULL,
        ChangedBy    INT NULL,
        ChangedAt    DATETIME NOT NULL CONSTRAINT DF_tblLeadStatusHistory_ChangedAt DEFAULT GETDATE()
    );
    CREATE INDEX IX_tblLeadStatusHistory_CompId_LeadId_ChangedAt     ON dbo.tblLeadStatusHistory (CompId, LeadId, ChangedAt);
    CREATE INDEX IX_tblLeadStatusHistory_CompId_ToStatusId_ChangedAt ON dbo.tblLeadStatusHistory (CompId, ToStatusId, ChangedAt);
END
GO

-- Backfill: one opening row (NULL -> current status, at CreatedAt) per lead
-- that has no history yet. Re-run safe.
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT l.CompId, l.Id, NULL, l.StatusId, l.CreatedBy, l.CreatedAt
FROM dbo.tblLeads l
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLeadStatusHistory h WHERE h.LeadId = l.Id AND h.CompId = l.CompId);
GO


-- ---------------------------------------------------------------------------
-- 2. sp_SaveLead — unchanged from 071 except the history row on insert
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

            -- 075: opening row of the status history (NULL -> first status).
            INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy)
            VALUES (@CompId, @LeadId, NULL, @StatusId, @UserId);

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
-- 3. sp_SetLeadStatus — unchanged from 071 except the history row
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
        DECLARE @hist   TABLE (FromStatusId INT);

        UPDATE dbo.tblLeads
        SET StatusId = @StatusId,
            LostAt       = CASE WHEN @ToCode = 'lost' THEN GETDATE() ELSE NULL END,
            LostReasonId = CASE WHEN @ToCode = 'lost' THEN @LostReasonId ELSE NULL END,
            EditBy = @UserId, UpdatedAt = GETDATE()
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @LeadId AND CompId = @CompId;

        -- 075: the transition, in the same transaction as the update. The source
        -- status comes from the UPDATE's own OUTPUT, not the @FromStatusId read
        -- before the transaction — two concurrent changes would otherwise both
        -- record the same source.
        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @LeadId, h.FromStatusId, @StatusId, @UserId, GETDATE() FROM @hist h;

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
-- 4. sp_FetchLeads — unchanged from 071 except @FromDate/@ToDate (CreatedAt
--    window, @ToDate inclusive). Report drill-downs land here with the range
--    they counted, so the list matches the number.
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
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
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
    DECLARE @ToEx DATETIME = CASE WHEN @ToDate IS NULL THEN NULL ELSE DATEADD(DAY, 1, CAST(@ToDate AS DATETIME)) END;

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
      AND (@FromDate IS NULL OR l.CreatedAt >= @FromDate)
      AND (@ToEx     IS NULL OR l.CreatedAt <  @ToEx)
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
          AND (@FromDate IS NULL OR l.CreatedAt >= @FromDate)
          AND (@ToEx     IS NULL OR l.CreatedAt <  @ToEx)
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


-- ===========================================================================
-- 5. REPORT PROCS — lead-cohort family
--
-- Contract (spec §3): same twelve params, three result sets, no ResponseCode.
-- Scope predicate copied from sp_FetchLeads. The scoped, basis-dated lead set
-- is materialised once into #L, then read three times.
--
-- Every tblLeadStatusHistory / tblFollowUp correlated read carries CompId as
-- well as LeadId: multi-tenancy, and both tables' indexes lead with CompId, so
-- a LeadId-only predicate cannot seek.
--
-- Backfilled history rows are synthetic (NULL -> current status at CreatedAt),
-- so ContactedAt only counts rows with FromStatusId IS NOT NULL. A lead with no
-- real transition yields NULL, AVG ignores it, and an empty cohort yields NULL
-- rather than a divide-by-zero.
-- ===========================================================================

CREATE OR ALTER PROC dbo.sp_RptFunnel
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'source',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('source','owner','product','branch','status','team')
    BEGIN RAISERROR('sp_RptFunnel: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

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
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT l.Id, l.CreatedAt,
           CASE @GroupBy WHEN 'source'  THEN l.SourceId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'branch'  THEN l.BranchId
                         WHEN 'status'  THEN l.StatusId
                         WHEN 'team'    THEN ISNULL(o.ReportsTo, o.Id) END AS GroupKey,
           CASE @GroupBy WHEN 'source'  THEN ISNULL(src.Value, N'No source')
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—')
                         WHEN 'status'  THEN st.Value
                         WHEN 'team'    THEN ISNULL(mgr.FullName, ISNULL(o.FullName, N'Unassigned')) END AS GroupLabel,
           c.ContactedAt, c.QualifiedAt, c.LostAt, c.JunkAt,
           d.EventAt,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st       ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblProduct p  ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o     ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblUser mgr   ON mgr.Id = o.ReportsTo
    LEFT JOIN dbo.tblBranch b   ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT
          (SELECT MIN(x.At) FROM (
               SELECT h.ChangedAt AS At FROM dbo.tblLeadStatusHistory h
                WHERE h.CompId = @CompId AND h.LeadId = l.Id AND h.FromStatusId IS NOT NULL
               UNION ALL
               SELECT f.DoneAt FROM dbo.tblFollowUp f
                WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done') x) AS ContactedAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code = 'qualified') AS QualifiedAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code = 'lost') AS LostAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code = 'junk') AS JunkAt,
          (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f
            WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done') AS LastActivityAt
    ) c
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
                                        WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code IN ('qualified','lost','junk'))
                 WHEN 'activity' THEN c.LastActivityAt
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (@DateBasis <> 'created' OR (l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1: KPIs
    SELECT COUNT(*) AS Created,
           ISNULL(SUM(CASE WHEN ContactedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS Contacted,
           ISNULL(SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS Qualified,
           ISNULL(SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END), 0) AS Lost,
           ISNULL(SUM(CASE WHEN JunkAt      IS NOT NULL THEN 1 ELSE 0 END), 0) AS Junk,
           CAST(100.0 * SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS QualifiedPct,
           CAST(100.0 * SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS LostPct,
           CAST(AVG(CASE WHEN ContactedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, ContactedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToContact,
           CAST(AVG(CASE WHEN QualifiedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, QualifiedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToQualify
    FROM #L;

    -- RS2: breakdown
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS Created,
           SUM(CASE WHEN ContactedAt IS NOT NULL THEN 1 ELSE 0 END) AS Contacted,
           SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) AS Qualified,
           SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) AS Lost,
           SUM(CASE WHEN JunkAt      IS NOT NULL THEN 1 ELSE 0 END) AS Junk,
           CAST(100.0 * SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS QualifiedPct,
           CAST(100.0 * SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS LostPct,
           CAST(AVG(CASE WHEN ContactedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, ContactedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToContact,
           CAST(AVG(CASE WHEN QualifiedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, QualifiedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToQualify
    FROM #L
    GROUP BY GroupKey, GroupLabel
    ORDER BY Created DESC, GroupLabel;

    -- RS3: trend
    SELECT Bucket,
           COUNT(*) AS Created,
           SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) AS Qualified,
           SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) AS Lost
    FROM #L
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


CREATE OR ALTER PROC dbo.sp_RptLost
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'reason',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('reason','source','product','owner','branch')
    BEGIN RAISERROR('sp_RptLost: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

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
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    -- Every scoped lead dated on the basis; IsLost marks the subset. LostPct
    -- is lost / all, so the denominator has to be here too.
    SELECT l.Id,
           CASE WHEN st.Code = 'lost' THEN 1 ELSE 0 END AS IsLost,
           l.LostReasonId,
           ISNULL(lr.Value, N'No reason') AS ReasonLabel,
           CASE @GroupBy WHEN 'source'  THEN l.SourceId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'branch'  THEN l.BranchId END AS SubKey,
           CASE @GroupBy WHEN 'source'  THEN ISNULL(src.Value, N'No source')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—') END AS SubLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st       ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup lr  ON lr.Id = l.LostReasonId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblProduct p  ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o     ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblBranch b   ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
                                        WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code IN ('qualified','lost','junk'))
                 WHEN 'activity' THEN (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f
                                        WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done')
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (@DateBasis <> 'created' OR (l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    DECLARE @Lost INT = (SELECT COUNT(*) FROM #L WHERE IsLost = 1);

    -- RS1
    SELECT @Lost AS Lost,
           CAST(100.0 * @Lost / NULLIF((SELECT COUNT(*) FROM #L), 0) AS DECIMAL(5,1)) AS LostPct,
           (SELECT TOP 1 ReasonLabel FROM #L WHERE IsLost = 1 GROUP BY ReasonLabel ORDER BY COUNT(*) DESC, ReasonLabel) AS TopReason;

    -- RS2: reason rows; a second key when grouped by source/product/owner/branch
    SELECT LostReasonId AS GroupKey, ReasonLabel AS GroupLabel,
           CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubKey END AS SubKey,
           CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubLabel END AS SubLabel,
           COUNT(*) AS Lost,
           CAST(100.0 * COUNT(*) / NULLIF(@Lost, 0) AS DECIMAL(5,1)) AS LostPct
    FROM #L
    WHERE IsLost = 1
    GROUP BY LostReasonId, ReasonLabel,
             CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubKey END,
             CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubLabel END
    ORDER BY Lost DESC, GroupLabel, SubLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Lost
    FROM #L
    WHERE IsLost = 1
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


CREATE OR ALTER PROC dbo.sp_RptPipelineValue
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'status',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('status','owner','product','branch')
    BEGIN RAISERROR('sp_RptPipelineValue: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

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
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT l.Id, l.EstValue, st.Code AS StatusCode,
           CASE @GroupBy WHEN 'status'  THEN l.StatusId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'branch'  THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'status'  THEN st.Value
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—') END AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st      ON st.Id = l.StatusId
    LEFT JOIN dbo.tblProduct p ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o    ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblBranch b  ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
                                        WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code IN ('qualified','lost','junk'))
                 WHEN 'activity' THEN (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f
                                        WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done')
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (@DateBasis <> 'created' OR (l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1
    SELECT ISNULL(SUM(CASE WHEN StatusCode = 'open'      THEN ISNULL(EstValue, 0) END), 0) AS OpenValue,
           ISNULL(SUM(CASE WHEN StatusCode = 'qualified' THEN ISNULL(EstValue, 0) END), 0) AS QualifiedValue,
           ISNULL(SUM(CASE WHEN StatusCode = 'lost'      THEN ISNULL(EstValue, 0) END), 0) AS LostValue,
           ISNULL(SUM(CASE WHEN StatusCode IN ('open','qualified') THEN 1 ELSE 0 END), 0) AS OpenCount,
           CAST(AVG(CASE WHEN StatusCode IN ('open','qualified') THEN EstValue END) AS DECIMAL(18,2)) AS AvgValue
    FROM #L;

    -- RS2
    SELECT GroupKey, GroupLabel, COUNT(*) AS [Count], SUM(ISNULL(EstValue, 0)) AS Value
    FROM #L
    GROUP BY GroupKey, GroupLabel
    ORDER BY Value DESC, GroupLabel;

    -- RS3: value still in play, by the bucket the lead was dated into
    SELECT Bucket, ISNULL(SUM(CASE WHEN StatusCode IN ('open','qualified') THEN ISNULL(EstValue, 0) END), 0) AS OpenValue
    FROM #L
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


-- ===========================================================================
-- 6. REPORT PROCS — follow-up family
--
-- Contract (spec §3): same twelve params, three result sets, no ResponseCode.
--
-- Scope: a follow-up is visible when it sits in an accessible BRANCH and
-- either its lead is owned by someone in the caller's owner scope OR the
-- follow-up is ASSIGNED to someone in it -- or the caller owns/created the
-- lead, or the follow-up is the caller's own.
--
-- CORRECTED 2026-09-13 (see 083_compliance_scope_comment.sql, which ships the
-- same text into the live definition). This paragraph used to claim the
-- predicate was "the same predicate sp_FetchFollowUps (071) uses". It never
-- was: the f.AssignedTo IN @OwnerIds disjunct below is deliberate, because
-- these are PEOPLE reports and the lead-centric list predicate would show a
-- Team lead fewer of her own rep's activities than both the rep herself and
-- the rep's branch manager. 083 carries the full reasoning and the measured
-- numbers.
--
-- Dates: compliance is dated on DueAt for @DateBasis='created' and on
-- COALESCE(DoneAt, DueAt) otherwise; activity has exactly one date (DoneAt)
-- and ignores @DateBasis, as does the leaderboard (leads on CreatedAt,
-- follow-ups on COALESCE(DoneAt, DueAt) — a skipped or still-open one has no
-- DoneAt, and the leaderboard now counts those). For the default basis the window is
-- repeated on the base column (f.DueAt) as well as on d.EventAt: a predicate
-- on a CROSS APPLY output is not sargable, so without it the optimizer has no
-- range on a real column to estimate or to push down as a residual filter.
--
-- 'On time' is DoneAt <= DueAt + 2h (the grace in spec §3); 'Missed' is a
-- follow-up still open whose DueAt has passed as of GETDATE() AND whose lead is
-- still in play (lead_status Code 'open' or 'qualified', carried into #F as
-- LeadCode). The active-lead gate is what makes Missed reconcile with the row's
-- drill, which lists that group's overdue ACTIVE leads: a follow-up left open
-- on a lost or junk lead is nobody's outstanding work. It gates Missed only —
-- Due, DoneOnTime, DoneLate and Skipped count on every lead. Every row in #F
-- already has DueAt < @ToEx, so for a window that has closed the two readings
-- ("past due now" / "past due at @ToEx") coincide; GETDATE() is the stricter
-- one for a window running into the future, where a not-yet-due follow-up is
-- not a miss.
--
-- The leaderboard's OnTimePct uses those same four terms, so a rep's number
-- there is the number Compliance shows for him — 'of everything that came due',
-- not 'of what he got round to'.
--
-- Every tblLeadStatusHistory / tblFollowUp correlated read carries CompId as
-- well as LeadId: multi-tenancy, and both tables' indexes lead with CompId.
-- The 'Connected' outcome is matched on tblLookup.Code = 'connected', not on
-- Value: Value is company-editable free text and renaming it must not zero a
-- KPI. Part D of this script backfills Code on the call_outcome rows, which
-- today carry Code NULL — so apply this script whole, in order.
-- ===========================================================================

CREATE OR ALTER PROC dbo.sp_RptFollowUpCompliance
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('owner','team','branch')
    BEGIN RAISERROR('sp_RptFollowUpCompliance: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

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
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;
    DECLARE @Now    DATETIME = GETDATE();

    SELECT f.Id, f.DueAt, f.DoneAt, f.Status, d.LeadCode,
           CASE WHEN f.Status = 'done' AND f.DoneAt <= DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS OnTime,
           CASE WHEN f.Status = 'done' AND f.DoneAt >  DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS Late,
           CASE WHEN f.Status = 'skipped' THEN 1 ELSE 0 END AS Skipped,
           CASE WHEN f.Status = 'open' AND f.DueAt < @Now AND d.LeadCode IN ('open','qualified') THEN 1 ELSE 0 END AS Missed,
           CASE @GroupBy WHEN 'owner'  THEN rep.Id
                         WHEN 'team'   THEN ISNULL(rep.ReportsTo, rep.Id)
                         WHEN 'branch' THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'owner'  THEN ISNULL(rep.FullName, N'Unassigned')
                         WHEN 'team'   THEN ISNULL(mgr.FullName, ISNULL(rep.FullName, N'Unassigned'))
                         WHEN 'branch' THEN ISNULL(b.BranchName, N'—') END AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #F
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l       ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.tblLookup st     ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser rep ON rep.Id = COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId)
    LEFT JOIN dbo.tblUser mgr ON mgr.Id = rep.ReportsTo
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    CROSS APPLY (SELECT CASE WHEN @DateBasis = 'created' THEN f.DueAt ELSE COALESCE(f.DoneAt, f.DueAt) END AS EventAt,
                        st.Code AS LeadCode) d
    WHERE f.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (@DateBasis <> 'created' OR (f.DueAt >= @FromDate AND f.DueAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.AssignedTo = @UserId))
          );

    -- RS1
    SELECT COUNT(*) AS Due,
           ISNULL(SUM(OnTime), 0)  AS DoneOnTime,
           ISNULL(SUM(Late), 0)    AS DoneLate,
           ISNULL(SUM(Skipped), 0) AS Skipped,
           ISNULL(SUM(Missed), 0)  AS Missed,
           CAST(100.0 * SUM(OnTime) / NULLIF(SUM(OnTime) + SUM(Late) + SUM(Skipped) + SUM(Missed), 0) AS DECIMAL(5,1)) AS OnTimePct,
           CAST(AVG(CASE WHEN Late = 1 THEN DATEDIFF(MINUTE, DueAt, DoneAt) / 60.0 END) AS DECIMAL(8,1)) AS AvgDelayHours
    FROM #F;

    -- RS2
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS Due, SUM(OnTime) AS DoneOnTime, SUM(Late) AS DoneLate, SUM(Skipped) AS Skipped, SUM(Missed) AS Missed,
           CAST(100.0 * SUM(OnTime) / NULLIF(SUM(OnTime) + SUM(Late) + SUM(Skipped) + SUM(Missed), 0) AS DECIMAL(5,1)) AS OnTimePct,
           CAST(AVG(CASE WHEN Late = 1 THEN DATEDIFF(MINUTE, DueAt, DoneAt) / 60.0 END) AS DECIMAL(8,1)) AS AvgDelayHours
    FROM #F
    GROUP BY GroupKey, GroupLabel
    ORDER BY OnTimePct DESC, Due DESC, GroupLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Due, SUM(OnTime) AS DoneOnTime, SUM(Late) AS DoneLate, SUM(Missed) AS Missed
    FROM #F
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


CREATE OR ALTER PROC dbo.sp_RptActivity
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'activity',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('owner','day','team','branch')
    BEGIN RAISERROR('sp_RptActivity: unknown GroupBy', 16, 1); RETURN; END
    -- Activity has one date: when it happened. @DateBasis is accepted for the
    -- shared contract and ignored.

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
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT f.Id, f.Type, ISNULL(f.Duration, 0) AS Duration, f.Direction,
           CASE WHEN oc.Code = 'connected' THEN 1 ELSE 0 END AS Connected,
           CASE @GroupBy WHEN 'owner'  THEN rep.Id
                         WHEN 'day'    THEN DATEDIFF(DAY, 0, f.DoneAt)
                         WHEN 'team'   THEN ISNULL(rep.ReportsTo, rep.Id)
                         WHEN 'branch' THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'owner'  THEN ISNULL(rep.FullName, N'Unknown')
                         WHEN 'day'    THEN CONVERT(NVARCHAR(10), f.DoneAt, 23)
                         WHEN 'team'   THEN ISNULL(mgr.FullName, ISNULL(rep.FullName, N'Unknown'))
                         WHEN 'branch' THEN ISNULL(b.BranchName, N'—') END AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, f.DoneAt), 0) ELSE f.DoneAt END AS DATE) AS Bucket
    INTO #F
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l        ON l.Id = f.LeadId AND l.CompId = f.CompId
    LEFT JOIN dbo.tblUser rep  ON rep.Id = f.DoneBy
    LEFT JOIN dbo.tblUser mgr  ON mgr.Id = rep.ReportsTo
    LEFT JOIN dbo.tblBranch b  ON b.Id = l.BranchId
    LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
    WHERE f.CompId = @CompId AND f.Status = 'done' AND f.DoneAt IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR f.DoneBy    = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND f.DoneAt >= @FromDate AND f.DoneAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.DoneBy IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.DoneBy = @UserId))
          );

    -- RS1
    SELECT ISNULL(SUM(CASE WHEN Type = 'call'    THEN 1 ELSE 0 END), 0) AS Calls,
           ISNULL(SUM(CASE WHEN Type = 'visit'   THEN 1 ELSE 0 END), 0) AS Visits,
           ISNULL(SUM(CASE WHEN Type = 'meeting' THEN 1 ELSE 0 END), 0) AS Meetings,
           ISNULL(SUM(CASE WHEN Type = 'other'   THEN 1 ELSE 0 END), 0) AS Other,
           ISNULL(SUM(CASE WHEN Type = 'call'    THEN Duration ELSE 0 END), 0) AS TalkMinutes,
           ISNULL(SUM(CASE WHEN Direction = 'in'  THEN 1 ELSE 0 END), 0) AS Inbound,
           ISNULL(SUM(CASE WHEN Direction = 'out' THEN 1 ELSE 0 END), 0) AS Outbound,
           ISNULL(SUM(Connected), 0) AS Connected
    FROM #F;

    -- RS2
    SELECT GroupKey, GroupLabel,
           SUM(CASE WHEN Type = 'call'    THEN 1 ELSE 0 END) AS Calls,
           SUM(CASE WHEN Type = 'visit'   THEN 1 ELSE 0 END) AS Visits,
           SUM(CASE WHEN Type = 'meeting' THEN 1 ELSE 0 END) AS Meetings,
           SUM(CASE WHEN Type = 'other'   THEN 1 ELSE 0 END) AS Other,
           SUM(CASE WHEN Type = 'call'    THEN Duration ELSE 0 END) AS TalkMinutes,
           SUM(CASE WHEN Direction = 'in'  THEN 1 ELSE 0 END) AS Inbound,
           SUM(CASE WHEN Direction = 'out' THEN 1 ELSE 0 END) AS Outbound,
           SUM(Connected) AS Connected
    FROM #F
    GROUP BY GroupKey, GroupLabel
    ORDER BY CASE WHEN @GroupBy = 'day' THEN GroupKey END ASC, Calls DESC, GroupLabel;

    -- RS3
    SELECT Bucket,
           SUM(CASE WHEN Type = 'call'    THEN 1 ELSE 0 END) AS Calls,
           SUM(CASE WHEN Type = 'visit'   THEN 1 ELSE 0 END) AS Visits,
           SUM(CASE WHEN Type = 'meeting' THEN 1 ELSE 0 END) AS Meetings
    FROM #F
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


CREATE OR ALTER PROC dbo.sp_RptLeaderboard
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('owner')
    BEGIN RAISERROR('sp_RptLeaderboard: unknown GroupBy', 16, 1); RETURN; END
    -- Leads are dated on CreatedAt, activities on DoneAt; @DateBasis ignored.

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
    DECLARE @ToEx DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Now  DATETIME = GETDATE();

    -- Scoped leads created in range, with their qualified date and first touch.
    SELECT l.Id, l.OwnerId, l.CreatedAt,
           (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
             WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code = 'qualified') AS QualifiedAt,
           (SELECT MIN(f.DoneAt) FROM dbo.tblFollowUp f
             WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done') AS FirstTouchAt
    INTO #L
    FROM dbo.tblLeads l
    WHERE l.CompId = @CompId AND l.OwnerId IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- Scoped follow-ups in range, carrying Compliance's four terms verbatim so
    -- the leaderboard's OnTimePct is the same number the Compliance report
    -- shows for that rep. Skipped and missed rows have no DoneBy, so the rep is
    -- COALESCE(DoneBy, AssignedTo, l.OwnerId) as it is there, and the row is
    -- dated on COALESCE(DoneAt, DueAt) — for a done row that is still DoneAt,
    -- so Activities (Done = 1) counts exactly what it counted before.
    SELECT f.Id,
           COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) AS RepId,
           CASE WHEN f.Status = 'done' THEN 1 ELSE 0 END AS Done,
           CASE WHEN f.Status = 'done' AND f.DoneAt <= DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS OnTime,
           CASE WHEN f.Status = 'done' AND f.DoneAt >  DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS Late,
           CASE WHEN f.Status = 'skipped' THEN 1 ELSE 0 END AS Skipped,
           CASE WHEN f.Status = 'open' AND f.DueAt < @Now AND d.LeadCode IN ('open','qualified') THEN 1 ELSE 0 END AS Missed
    INTO #F
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l   ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    CROSS APPLY (SELECT COALESCE(f.DoneAt, f.DueAt) AS EventAt, st.Code AS LeadCode) d
    WHERE f.CompId = @CompId
      AND COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND ((f.DoneAt >= @FromDate AND f.DoneAt < @ToEx)
        OR (f.DoneAt IS NULL AND f.DueAt >= @FromDate AND f.DueAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.DoneBy IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.DoneBy = @UserId OR f.AssignedTo = @UserId))
          );

    -- RS1: no KPI row for a leaderboard (spec §3)
    SELECT CAST(NULL AS INT) AS Nothing WHERE 1 = 0;

    -- RS2: one row per rep who owns a lead or did an activity in range
    ;WITH reps AS (
        SELECT OwnerId AS RepId FROM #L
        UNION
        SELECT RepId FROM #F
    ), stats AS (
        SELECT r.RepId,
               (SELECT COUNT(*) FROM #L x WHERE x.OwnerId = r.RepId) AS Created,
               (SELECT COUNT(*) FROM #L x WHERE x.OwnerId = r.RepId AND x.QualifiedAt IS NOT NULL) AS Qualified,
               (SELECT COUNT(*) FROM #F y WHERE y.RepId = r.RepId AND y.Done = 1) AS Activities,
               (SELECT CAST(100.0 * SUM(y.OnTime) / NULLIF(SUM(y.OnTime) + SUM(y.Late) + SUM(y.Skipped) + SUM(y.Missed), 0) AS DECIMAL(5,1))
                  FROM #F y WHERE y.RepId = r.RepId) AS OnTimePct,
               (SELECT CAST(AVG(DATEDIFF(MINUTE, x.CreatedAt, x.FirstTouchAt) / 60.0) AS DECIMAL(8,1))
                  FROM #L x WHERE x.OwnerId = r.RepId AND x.FirstTouchAt IS NOT NULL) AS AvgResponseHours
        FROM reps r
    )
    SELECT s.RepId AS GroupKey, ISNULL(u.FullName, N'Unknown') AS GroupLabel,
           s.Created, s.Qualified, s.Activities, s.OnTimePct, s.AvgResponseHours,
           CAST(RANK() OVER (ORDER BY s.Qualified DESC, s.Activities DESC, s.Created DESC) AS INT) AS [Rank]
    FROM stats s
    LEFT JOIN dbo.tblUser u ON u.Id = s.RepId
    ORDER BY [Rank], GroupLabel;

    -- RS3: no trend for a leaderboard (spec §3)
    SELECT CAST(NULL AS DATE) AS Bucket WHERE 1 = 0;
END
GO


-- ===========================================================================
-- 7. REPORT PROCS — aging + transfers
--
-- Contract (spec §3): same twelve params, three result sets, no ResponseCode.
--
-- Aging is the one report that is NOT a cohort. RS1/RS2 answer "what is open
-- right now and how old is it", so they ignore @FromDate/@ToDate and @DateBasis
-- entirely; the range shapes RS3 only, which replays the open count as of the
-- end of each bucket. A range filter on the snapshot would mean "leads created
-- in the last 30 days that are still open", which is a different question and
-- not the one the page asks.
--
-- RS3's ClosedAt is the lead's CURRENT state, not its first close: a lead that
-- was lost and reopened is open now, so it must stay in the trend as well as in
-- the Open KPI — MIN(ChangedAt) would have dropped it out of one and not the
-- other. Leads created before 075 carry only the synthetic backfill row, so
-- their trend is a backward projection of today's status; it becomes true
-- history as sp_SetLeadStatus writes real transitions from here on.
--
-- Transfers reads tblLeadAssignment, which has exactly one date (AssignedAt),
-- so @DateBasis is accepted for the shared contract and ignored. Creation rows
-- (ReasonId IS NULL, written by sp_SaveLead) are excluded: the report is about
-- leads changing hands, and a lead's first owner never changed hands.
--
-- Every tblLeadStatusHistory / tblFollowUp / tblLeadActivity correlated read
-- carries CompId as well as LeadId: multi-tenancy, and those indexes lead with
-- CompId, so a LeadId-only predicate cannot seek.
-- ===========================================================================

CREATE OR ALTER PROC dbo.sp_RptAging
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('owner','branch','team')
    BEGIN RAISERROR('sp_RptAging: unknown GroupBy', 16, 1); RETURN; END
    -- Aging is a snapshot: RS1/RS2 describe what is open right now. The date
    -- range (and @DateBasis) only shape RS3, the "open as of" trend.

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
    DECLARE @Now    DATETIME = GETDATE();
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;
    DECLARE @Step   INT      = CASE WHEN @Weekly = 1 THEN 7 ELSE 1 END;

    -- Every scoped lead (any status) with its close date; RS1/RS2 filter to
    -- the ones still active, RS3 replays the count over time.
    SELECT l.Id, l.CreatedAt, l.NextFollowupDate,
           CASE WHEN st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS IsActive,
           CASE WHEN st.Code IN ('open','qualified') THEN NULL ELSE
             (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
               WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code IN ('lost','junk')) END AS ClosedAt,
           (SELECT MAX(v) FROM (VALUES (l.CreatedAt), (t.FuTouch), (t.ActTouch)) x(v)) AS LastTouchAt,
           CASE @GroupBy WHEN 'owner'  THEN l.OwnerId
                         WHEN 'team'   THEN ISNULL(o.ReportsTo, o.Id)
                         WHEN 'branch' THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'owner'  THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'team'   THEN ISNULL(mgr.FullName, ISNULL(o.FullName, N'Unassigned'))
                         WHEN 'branch' THEN ISNULL(b.BranchName, N'—') END AS GroupLabel
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st     ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser o   ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblUser mgr ON mgr.Id = o.ReportsTo
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT (SELECT MAX(COALESCE(f.DoneAt, f.CreatedAt)) FROM dbo.tblFollowUp f
                 WHERE f.CompId = @CompId AND f.LeadId = l.Id) AS FuTouch,
               (SELECT MAX(a.CreatedAt) FROM dbo.tblLeadActivity a
                 WHERE a.CompId = @CompId AND a.LeadId = l.Id) AS ActTouch
    ) t
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1: snapshot
    SELECT COUNT(*) AS [Open],
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) <= 7  THEN 1 ELSE 0 END), 0) AS Age0_7,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 8  AND 30 THEN 1 ELSE 0 END), 0) AS Age8_30,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 31 AND 90 THEN 1 ELSE 0 END), 0) AS Age31_90,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) > 90 THEN 1 ELSE 0 END), 0) AS Age90Plus,
           ISNULL(SUM(CASE WHEN NextFollowupDate IS NULL THEN 1 ELSE 0 END), 0) AS NoNextFollowUp,
           CAST(AVG(DATEDIFF(HOUR, LastTouchAt, @Now) / 24.0) AS DECIMAL(6,1)) AS AvgDaysSinceTouch
    FROM #L WHERE IsActive = 1;

    -- RS2
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS [Open],
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) <= 7  THEN 1 ELSE 0 END) AS Age0_7,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 8  AND 30 THEN 1 ELSE 0 END) AS Age8_30,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS Age31_90,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) > 90 THEN 1 ELSE 0 END) AS Age90Plus,
           SUM(CASE WHEN NextFollowupDate IS NULL THEN 1 ELSE 0 END) AS NoNextFollowUp,
           CAST(AVG(DATEDIFF(HOUR, LastTouchAt, @Now) / 24.0) AS DECIMAL(6,1)) AS AvgDaysSinceTouch
    FROM #L WHERE IsActive = 1
    GROUP BY GroupKey, GroupLabel
    ORDER BY [Open] DESC, GroupLabel;

    -- RS3: active leads as of each bucket end (created before it, not closed before it)
    ;WITH buckets AS (
        SELECT CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, @FromDate), 0) ELSE @FromDate END AS DATE) AS Bucket
        UNION ALL
        SELECT CAST(DATEADD(DAY, @Step, Bucket) AS DATE) FROM buckets WHERE DATEADD(DAY, @Step, Bucket) <= @ToDate
    )
    SELECT b.Bucket,
           (SELECT COUNT(*) FROM #L x
             WHERE x.CreatedAt < DATEADD(DAY, @Step, CAST(b.Bucket AS DATETIME))
               AND (x.ClosedAt IS NULL OR x.ClosedAt >= DATEADD(DAY, @Step, CAST(b.Bucket AS DATETIME)))) AS [Open]
    FROM buckets b
    ORDER BY b.Bucket
    OPTION (MAXRECURSION 1000);
END
GO


CREATE OR ALTER PROC dbo.sp_RptTransfers
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'reason',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('reason','pair','branch')
    BEGIN RAISERROR('sp_RptTransfers: unknown GroupBy', 16, 1); RETURN; END
    -- A transfer has one date, AssignedAt; @DateBasis ignored.

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
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    -- SendBacks is matched on tblLookup.Code = 'sent_back', never on Value:
    -- Value is company-editable free text and renaming the reason in Settings
    -- must not zero a KPI. Section 8 stamps that Code on the seeded row, the
    -- same treatment call_outcome gets for sp_RptActivity's Connected.
    SELECT a.Id,
           CASE WHEN ISNULL(a.FromBranchId, a.ToBranchId) <> a.ToBranchId THEN 1 ELSE 0 END AS CrossBranch,
           CASE WHEN r.Code = 'sent_back' THEN 1 ELSE 0 END AS SendBack,
           CASE WHEN a.ToUserId IS NULL THEN 1 ELSE 0 END AS Unassign,
           CASE @GroupBy WHEN 'reason' THEN a.ReasonId
                         WHEN 'pair'   THEN a.FromUserId
                         WHEN 'branch' THEN a.ToBranchId END AS GroupKey,
           CASE @GroupBy WHEN 'reason' THEN ISNULL(r.Value, N'No reason')
                         WHEN 'pair'   THEN ISNULL(fu.FullName, N'Unassigned') + N' → ' + ISNULL(tu.FullName, N'Unassigned')
                         WHEN 'branch' THEN ISNULL(tb.BranchName, N'—') END AS GroupLabel,
           CASE WHEN @GroupBy = 'pair' THEN a.ToUserId END AS SubKey,
           CASE WHEN @GroupBy = 'pair' THEN ISNULL(tu.FullName, N'Unassigned') END AS SubLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, a.AssignedAt), 0) ELSE a.AssignedAt END AS DATE) AS Bucket
    INTO #A
    FROM dbo.tblLeadAssignment a
    JOIN dbo.tblLeads l        ON l.Id = a.LeadId AND l.CompId = a.CompId
    LEFT JOIN dbo.tblLookup r  ON r.Id = a.ReasonId
    LEFT JOIN dbo.tblUser fu   ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu   ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    WHERE a.CompId = @CompId AND a.ReasonId IS NOT NULL
      AND (@BranchId  IS NULL OR a.ToBranchId = @BranchId OR a.FromBranchId = @BranchId)
      AND (@OwnerId   IS NULL OR a.ToUserId = @OwnerId OR a.FromUserId = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND a.AssignedAt >= @FromDate AND a.AssignedAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds)
                                      OR a.ToUserId IN (SELECT OwnerId FROM @OwnerIds)
                                      OR a.FromUserId IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR a.ToUserId = @UserId OR a.FromUserId = @UserId))
          );

    -- RS1
    SELECT COUNT(*) AS Transfers,
           ISNULL(SUM(CrossBranch), 0) AS CrossBranch,
           ISNULL(SUM(SendBack), 0)    AS SendBacks,
           ISNULL(SUM(Unassign), 0)    AS Unassigns
    FROM #A;

    -- RS2
    SELECT GroupKey, GroupLabel, SubKey, SubLabel,
           COUNT(*) AS Transfers, SUM(CrossBranch) AS CrossBranch, SUM(SendBack) AS SendBacks, SUM(Unassign) AS Unassigns
    FROM #A
    GROUP BY GroupKey, GroupLabel, SubKey, SubLabel
    ORDER BY Transfers DESC, GroupLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Transfers
    FROM #A
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO


-- ===========================================================================
-- 8. SIDEBAR — Sales Reports (parent 11) + the call_outcome code backfill
--    20/21/22 re-pointed (their grants carry over); six new rows cloned from
--    row 20. DISTINCT because tblGroupAccess carries duplicate (GroupId,
--    MenuId) rows today. No executive group is granted (spec §1 decision 6).
-- ===========================================================================
UPDATE dbo.tblMenu SET Description = 'Funnel',   Route = '/reports/funnel'
 WHERE Id = 20 AND Route = '/reports/leads-by-status';
UPDATE dbo.tblMenu SET Description = 'Activity', Route = '/reports/activity'
 WHERE Id = 21 AND Route = '/reports/calls-per-user';
UPDATE dbo.tblMenu SET Route = '/reports/funnel?groupBy=source'
 WHERE Id = 22 AND Route = '/reports/conversion-by-source';

;WITH new_rows AS (
    SELECT * FROM (VALUES
        ('Follow-up Compliance', '/reports/follow-up-compliance'),
        ('Lost Analysis',        '/reports/lost'),
        ('Aging',                '/reports/aging'),
        ('Transfers',            '/reports/transfers'),
        ('Pipeline Value',       '/reports/pipeline-value'),
        ('Leaderboard',          '/reports/leaderboard')
    ) v(Description, Route)
)
INSERT INTO dbo.tblMenu (ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route)
SELECT m.ParentId, n.Description, m.Image, m.FormId, m.MenuType, m.ActualId, m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, n.Route
FROM new_rows n
CROSS JOIN dbo.tblMenu m
WHERE m.Id = 20
  AND NOT EXISTS (SELECT 1 FROM dbo.tblMenu x WHERE x.Route = n.Route);

INSERT INTO dbo.tblGroupAccess (GroupId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
SELECT DISTINCT src.GroupId, m.Id, src.CanView, src.CanAdd, src.CanEdit, src.CanDelete
FROM dbo.tblGroupAccess src
CROSS JOIN dbo.tblMenu m
WHERE src.MenuId = 20
  AND m.ParentId = 11 AND m.Id NOT IN (20, 21, 22)
  AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupAccess ga WHERE ga.GroupId = src.GroupId AND ga.MenuId = m.Id);

-- sp_RptActivity (part C) counts a connected call on tblLookup.Code, not on
-- Value: Value is company-editable free text and renaming it must not zero a
-- KPI. The seeded call_outcome rows carry Code NULL, so stamp the one code the
-- report reads. Idempotent by construction — the Code IS NULL guard makes a
-- re-run a no-op, and a company that already set a Code keeps it.
UPDATE dbo.tblLookup SET Code = 'connected'
 WHERE Kind = 'call_outcome' AND Value = N'Connected' AND Code IS NULL;

-- Same treatment for sp_RptTransfers' SendBacks, which reads
-- transfer_reason.Code = 'sent_back'.
UPDATE dbo.tblLookup SET Code = 'sent_back'
 WHERE Kind = 'transfer_reason' AND Value = N'Sent back to manager' AND Code IS NULL;
GO


-- ===========================================================================
-- 9. VERIFY AFTER APPLY — one transaction, always rolled back
--
-- Everything below runs inside a single transaction that ends in ROLLBACK, so
-- the dry-run lead in 9.8 leaves nothing behind and no read holds a lock after
-- the batch. Plain EXEC throughout: the report procs already do SELECT ... INTO
-- and INSERT ... EXEC of a proc that itself does INSERT ... EXEC is illegal in
-- SQL Server, so the result sets are read by eye, not captured.
--
-- Expect no red text and, for 9.5, THREE grids per proc (KPI row · breakdown ·
-- trend). A write proc's own guard path can roll this transaction back early,
-- so the close tests @@TRANCOUNT first: still open, it rolls back; already
-- closed, it deletes the dry-run lead outright and says so. The CATCH tests
-- @@TRANCOUNT for the same reason. Nothing is left open, and nothing is kept.
-- ===========================================================================
SET NOCOUNT ON;
BEGIN TRY
BEGIN TRANSACTION;

-- 9.1 Shape: the table exists, sp_FetchLeads took the new params, the backfill
--     covered every lead (history >= leads, and none without a row).
SELECT 'tblLeadStatusHistory'        AS what,
       CASE WHEN OBJECT_ID('dbo.tblLeadStatusHistory') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS state
UNION ALL SELECT 'sp_FetchLeads @FromDate',   CASE WHEN EXISTS (SELECT 1 FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
                                                                WHERE o.name = 'sp_FetchLeads' AND p.name = '@FromDate') THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'history rows / leads',      CAST((SELECT COUNT(*) FROM dbo.tblLeadStatusHistory) AS VARCHAR(12)) + ' / '
                                            + CAST((SELECT COUNT(*) FROM dbo.tblLeads) AS VARCHAR(12)) + ' (history >= leads)'
UNION ALL SELECT 'leads without history',     CAST((SELECT COUNT(*) FROM dbo.tblLeads l
                                                    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLeadStatusHistory h WHERE h.LeadId = l.Id AND h.CompId = l.CompId)) AS VARCHAR(12)) + ' (expect 0)';

-- 9.2 Eight procs present (expect 8 rows)
SELECT name FROM sys.procedures
WHERE name IN ('sp_RptFunnel','sp_RptFollowUpCompliance','sp_RptActivity','sp_RptLost',
               'sp_RptAging','sp_RptTransfers','sp_RptPipelineValue','sp_RptLeaderboard')
ORDER BY name;

-- 9.3 Sidebar: 9 rows under parent 11 — three re-pointed, six new — and every
--     one of them carries row 20's full group set (expect 10 groups each).
SELECT Id, Description, Route FROM dbo.tblMenu WHERE ParentId = 11 ORDER BY Id;   -- expect 9
SELECT m.Id, m.Description, m.Route, COUNT(DISTINCT ga.GroupId) AS Groups
FROM dbo.tblMenu m LEFT JOIN dbo.tblGroupAccess ga ON ga.MenuId = m.Id
WHERE m.ParentId = 11
GROUP BY m.Id, m.Description, m.Route
ORDER BY m.Id;                                                                    -- expect 10 for every row

-- 9.4 call_outcome codes: the 'Connected' row must now read 'connected'
SELECT Id, CompId, Value, Code, SortOrder FROM dbo.tblLookup
WHERE Kind = 'call_outcome' ORDER BY CompId, SortOrder;

-- 9.5 Each report once, 365-day range, Owner view (no scope JSON = no branch
--     or owner narrowing). Expect THREE grids per proc, no error.
DECLARE @cid INT = 1, @uid INT = 2;
DECLARE @from DATE = DATEADD(DAY, -365, CAST(GETDATE() AS DATE)), @to DATE = CAST(GETDATE() AS DATE);
SELECT 'sp_RptFunnel — expect 3 grids' AS step;
EXEC dbo.sp_RptFunnel             @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='source', @UserId=@uid;
SELECT 'sp_RptFollowUpCompliance — expect 3 grids' AS step;
EXEC dbo.sp_RptFollowUpCompliance @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=@uid;
SELECT 'sp_RptActivity — expect 3 grids' AS step;
EXEC dbo.sp_RptActivity           @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=@uid;
SELECT 'sp_RptLost — expect 3 grids' AS step;
EXEC dbo.sp_RptLost               @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='reason', @UserId=@uid;
SELECT 'sp_RptAging — expect 3 grids (RS1/RS2 are a snapshot, RS3 the range)' AS step;
EXEC dbo.sp_RptAging              @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=@uid;
SELECT 'sp_RptTransfers — expect 3 grids' AS step;
EXEC dbo.sp_RptTransfers          @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='reason', @UserId=@uid;
SELECT 'sp_RptPipelineValue — expect 3 grids' AS step;
EXEC dbo.sp_RptPipelineValue      @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='status', @UserId=@uid;
SELECT 'sp_RptLeaderboard — expect 3 grids (first and last empty)' AS step;
EXEC dbo.sp_RptLeaderboard        @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=@uid;

-- 9.6 Self scope narrows: Amit (17) must not see more Created than the Owner
--     view above, and Transfers must show only rows he is an end of.
SELECT 'sp_RptFunnel as Amit (Self) — Created must be <= the Owner grid above' AS step;
EXEC dbo.sp_RptFunnel    @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='owner', @UserId=17, @AccessibleBranchIdsJson='[1]', @OwnerIdsJson='[17]';
SELECT 'sp_RptTransfers as Amit (Self, pair) — every row has Amit at one end' AS step;
EXEC dbo.sp_RptTransfers @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='pair',  @UserId=17, @AccessibleBranchIdsJson='[1]', @OwnerIdsJson='[17]';

-- 9.7 Unknown GroupBy raises on the two new procs (expect an error message, not a grid)
BEGIN TRY
    EXEC dbo.sp_RptAging @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='nope', @UserId=@uid;
    SELECT '9.7 sp_RptAging bad GroupBy' AS step, 'NOT REJECTED' AS state;
END TRY
BEGIN CATCH
    SELECT '9.7 sp_RptAging bad GroupBy' AS step, 'ok — ' + ERROR_MESSAGE() AS state;
END CATCH
BEGIN TRY
    EXEC dbo.sp_RptTransfers @CompId=@cid, @FromDate=@from, @ToDate=@to, @GroupBy='nope', @UserId=@uid;
    SELECT '9.7 sp_RptTransfers bad GroupBy' AS step, 'NOT REJECTED' AS state;
END TRY
BEGIN CATCH
    SELECT '9.7 sp_RptTransfers bad GroupBy' AS step, 'ok — ' + ERROR_MESSAGE() AS state;
END CATCH

-- 9.8 Write paths log history (this is the part the ROLLBACK undoes)
DECLARE @lost   INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='lead_status' AND Code='lost');
DECLARE @reason INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='lost_reason' ORDER BY SortOrder);
SELECT '(a) create — expect 200 below' AS step;
EXEC dbo.sp_SaveLead @Id=0, @CompId=@cid, @BranchId=1, @UserId=@uid, @Name=N'verify-075', @MobileNo='9999999999', @OwnerId=@uid;
DECLARE @lid INT = (SELECT TOP 1 Id FROM dbo.tblLeads WHERE CompId=@cid AND Name=N'verify-075' ORDER BY Id DESC);
SELECT '(a) history rows' AS step, COUNT(*) AS N, 1 AS expect FROM dbo.tblLeadStatusHistory WHERE LeadId=@lid;
SELECT '(b) set Lost — expect 200 below' AS step;
EXEC dbo.sp_SetLeadStatus @CompId=@cid, @LeadId=@lid, @StatusId=@lost, @LostReasonId=@reason, @UserId=@uid;
SELECT '(b) history rows' AS step, COUNT(*) AS N, 2 AS expect FROM dbo.tblLeadStatusHistory WHERE LeadId=@lid;
SELECT '(b) last row is old -> lost' AS step,
       CASE WHEN FromStatusId IS NOT NULL AND ToStatusId = @lost THEN 'ok' ELSE 'WRONG' END AS state
FROM dbo.tblLeadStatusHistory WHERE Id = (SELECT MAX(Id) FROM dbo.tblLeadStatusHistory WHERE LeadId=@lid);

-- A write proc's own guard path (sp_SaveLead with no lead_status lookups)
-- issues an unqualified ROLLBACK, which ends THIS transaction too. If that
-- happened the dry-run rows are already committed, so delete them by hand —
-- everything sp_SaveLead + sp_SetLeadStatus write for this lead: history,
-- timeline, the auto first follow-up, the creation assignment row, the lead.
SELECT '(c) rolling back — nothing above is kept' AS step;
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
ELSE
BEGIN
    DECLARE @orphans TABLE (Id INT PRIMARY KEY);
    INSERT INTO @orphans (Id) SELECT Id FROM dbo.tblLeads WHERE CompId = @cid AND Name = N'verify-075';
    DELETE FROM dbo.tblLeadActivity      WHERE CompId = @cid AND LeadId IN (SELECT Id FROM @orphans);
    DELETE FROM dbo.tblLeadStatusHistory WHERE CompId = @cid AND LeadId IN (SELECT Id FROM @orphans);
    DELETE FROM dbo.tblLeadAssignment    WHERE CompId = @cid AND LeadId IN (SELECT Id FROM @orphans);
    DELETE FROM dbo.tblFollowUp          WHERE CompId = @cid AND LeadId IN (SELECT Id FROM @orphans);
    DELETE FROM dbo.tblLeads             WHERE CompId = @cid AND Name = N'verify-075';
    SELECT 'WARNING — a write proc rolled this back early; the verify-075 rows were deleted instead' AS step,
           (SELECT COUNT(*) FROM @orphans) AS LeadsRemoved;
END
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'VERIFY FAILED (rolled back)' AS step, ERROR_NUMBER() AS ErrNo, ERROR_PROCEDURE() AS Proc_, ERROR_LINE() AS Line_, ERROR_MESSAGE() AS Msg_;
END CATCH
GO
