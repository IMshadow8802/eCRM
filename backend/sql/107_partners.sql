-- 107_partners.sql — partners, partner on a lead, commission, Partner report,
-- and "moving a lead really moves it" (spec 2026-10-10-partner-leads-design).
--
-- Apply to TestCRM FIRST, check, then eCRM+ and SolarCRM:
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "TestCRM"  -C -b -I -i sql/107_partners.sql
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "eCRM+"    -C -b -I -i sql/107_partners.sql
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "SolarCRM" -C -b -I -i sql/107_partners.sql
-- DEPLOY ORDER. Per database: apply 107 FIRST, then rebuild that client's backend container.
--   The new backend sends params (SetPartner..., PartnerId, CommissionDueOn) that a pre-107
--   database rejects. The web build can go first.
-- Re-runnable (also on a DB where an earlier 107 was applied - the six superseded procs are dropped below): every DDL is guarded and the new procs are CREATE OR ALTER. Step 7 drops
-- and re-creates the other lead procs from their own live text (no explicit GRANTs exist
-- on them - checked 2026-10-10).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Partners -----------------------------------------------------------------
IF OBJECT_ID('dbo.tblPartner') IS NULL
CREATE TABLE dbo.tblPartner (
    Id            INT IDENTITY(1,1) CONSTRAINT PK_tblPartner PRIMARY KEY,
    CompId        INT            NOT NULL,
    Name          NVARCHAR(200)  NOT NULL,
    ContactPerson NVARCHAR(200)  NULL,
    Mobile        VARCHAR(10)    NULL
        CONSTRAINT CK_tblPartner_Mobile CHECK (Mobile IS NULL OR Mobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    Email         VARCHAR(150)   NULL,
    City          NVARCHAR(100)  NULL,
    Notes         NVARCHAR(1000) NULL,
    CommType      VARCHAR(5)     NULL CONSTRAINT CK_tblPartner_CommType CHECK (CommType IN ('pct','fixed')),
    CommValue     DECIMAL(12,2)  NULL,
    IsActive      BIT            NOT NULL CONSTRAINT DF_tblPartner_IsActive DEFAULT 1,
    CreatedBy     INT            NOT NULL,
    CreatedAt     DATETIME       NOT NULL CONSTRAINT DF_tblPartner_CreatedAt DEFAULT GETDATE(),
    UpdatedAt     DATETIME       NULL,
    CONSTRAINT CK_tblPartner_Comm CHECK (
        (CommType IS NULL AND CommValue IS NULL)
     OR (CommType = 'fixed' AND CommValue >= 0)
     OR (CommType = 'pct'   AND CommValue >= 0 AND CommValue <= 100))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblPartner_Mobile')
    CREATE UNIQUE INDEX UX_tblPartner_Mobile ON dbo.tblPartner (CompId, Mobile)
        WHERE IsActive = 1 AND Mobile IS NOT NULL;
GO

-- 2. Partner + terms on the lead ------------------------------------------------
IF COL_LENGTH('dbo.tblLeads', 'PartnerId') IS NULL
    ALTER TABLE dbo.tblLeads ADD
        PartnerId INT NULL CONSTRAINT FK_tblLeads_Partner REFERENCES dbo.tblPartner (Id),
        CommType  VARCHAR(5)    NULL,
        CommValue DECIMAL(12,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblLeads_Comm')
    ALTER TABLE dbo.tblLeads ADD CONSTRAINT CK_tblLeads_Comm CHECK (
        (CommType IS NULL AND CommValue IS NULL)
     OR (PartnerId IS NOT NULL AND CommType = 'fixed' AND CommValue >= 0)
     OR (PartnerId IS NOT NULL AND CommType = 'pct'   AND CommValue >= 0 AND CommValue <= 100));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_PartnerId')
    CREATE INDEX IX_tblLeads_PartnerId ON dbo.tblLeads (CompId, PartnerId) WHERE PartnerId IS NOT NULL;
GO

-- 3. Commission ------------------------------------------------------------------
IF OBJECT_ID('dbo.tblPartnerCommission') IS NULL
CREATE TABLE dbo.tblPartnerCommission (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_tblPartnerCommission PRIMARY KEY,
    CompId      INT           NOT NULL,
    LeadId      INT           NOT NULL CONSTRAINT FK_tblPartnerCommission_Lead REFERENCES dbo.tblLeads (Id),
    PartnerId   INT           NOT NULL CONSTRAINT FK_tblPartnerCommission_Partner REFERENCES dbo.tblPartner (Id),
    BaseValue   DECIMAL(18,2) NULL,
    CommType    VARCHAR(5)    NOT NULL CONSTRAINT CK_tblPartnerCommission_Type CHECK (CommType IN ('pct','fixed')),
    CommValue   DECIMAL(12,2) NOT NULL,
    Amount      DECIMAL(14,2) NOT NULL,
    Status      VARCHAR(10)   NOT NULL CONSTRAINT CK_tblPartnerCommission_Status CHECK (Status IN ('earned','due','paid','cancelled')),
    Reverted    BIT           NOT NULL CONSTRAINT DF_tblPartnerCommission_Reverted DEFAULT 0,
    EarnedAt    DATETIME      NOT NULL,
    DueAt       DATETIME      NULL,
    DueBy       INT           NULL,
    PaidAt      DATE          NULL,
    PaidBy      INT           NULL,
    PaidRef     NVARCHAR(100) NULL,
    CancelledAt DATETIME      NULL
);
GO
-- One live row per lead. A paid row whose lead was un-converted (Reverted = 1)
-- and cancelled rows are history and do not count.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblPartnerCommission_Live')
    CREATE UNIQUE INDEX UX_tblPartnerCommission_Live ON dbo.tblPartnerCommission (LeadId)
        WHERE Status <> 'cancelled' AND Reverted = 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblPartnerCommission_Partner')
    CREATE INDEX IX_tblPartnerCommission_Partner ON dbo.tblPartnerCommission (CompId, PartnerId, Status);
GO

-- 4. Setting: when does a commission become payable -------------------------------
IF COL_LENGTH('dbo.tblCompanySetting', 'CommissionDueOn') IS NULL
    ALTER TABLE dbo.tblCompanySetting ADD CommissionDueOn VARCHAR(10) NOT NULL
        CONSTRAINT DF_tblCompanySetting_CommissionDueOn DEFAULT 'manual'
        CONSTRAINT CK_tblCompanySetting_CommissionDueOn CHECK (CommissionDueOn IN ('manual','convert'));
GO

-- 5. Module 'partners' is a grantable module (no reach of its own) --------------------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Module'
           AND definition NOT LIKE '%partners%')
BEGIN
    SET XACT_ABORT ON;
    BEGIN TRAN;
    ALTER TABLE dbo.tblGroupModule DROP CONSTRAINT CK_tblGroupModule_Module;
    ALTER TABLE dbo.tblGroupModule ADD CONSTRAINT CK_tblGroupModule_Module CHECK (Module IN
        ('leads','sales_reports','complaints','support_reports','customers','people',
         'tasks','teams','projects','settings','dashboard','attendance','partners'));
    COMMIT;
END
GO

-- 6. "Partner" lead source per company, and the two menu rows ---------------------------
-- A company that already has an active 'Partner' source (no Code) adopts it instead of
-- colliding with UQ_tblLookup_CompId_Kind_Value (CompId, Kind, Value) WHERE IsActive = 1.
UPDATE p SET Code = 'partner'
FROM dbo.tblLookup p
WHERE p.Kind = 'lead_source' AND p.Value = N'Partner' AND p.IsActive = 1 AND p.Code IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup o WHERE o.CompId = p.CompId AND o.Kind = 'lead_source' AND o.Code = 'partner');
INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive, Code)
SELECT c.CompId, 'lead_source', N'Partner',
       ISNULL((SELECT MAX(SortOrder) FROM dbo.tblLookup x WHERE x.CompId = c.CompId AND x.Kind = 'lead_source'), 0) + 1,
       1, 'partner'
FROM (SELECT DISTINCT CompId FROM dbo.tblLookup WHERE Kind = 'lead_source') c
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup y WHERE y.CompId = c.CompId AND y.Kind = 'lead_source' AND y.Code = 'partner')
  AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup z WHERE z.CompId = c.CompId AND z.Kind = 'lead_source' AND z.Value = N'Partner' AND z.IsActive = 1);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/sales/partners')
    INSERT INTO dbo.tblMenu (ParentId, Description, MenuType, FormId, ActualId, IsAllowed, Route, Module)
    SELECT Id, 'Partners', 1, 0, 0, 1, '/sales/partners', 'partners' FROM dbo.tblMenu WHERE Route = '/sales' AND ParentId = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/reports/partners')
    INSERT INTO dbo.tblMenu (ParentId, Description, MenuType, FormId, ActualId, IsAllowed, Route, Module)
    SELECT Id, 'Partners', 1, 0, 0, 1, '/reports/partners', 'sales_reports' FROM dbo.tblMenu WHERE Description = 'Sales Reports' AND ParentId = 0;
GO

-- Step 2: partner procs
CREATE OR ALTER PROC dbo.sp_SavePartner
    @Id INT, @CompId INT, @UserId INT,
    @Name NVARCHAR(200), @ContactPerson NVARCHAR(200) = NULL, @Mobile VARCHAR(10) = NULL,
    @Email VARCHAR(150) = NULL, @City NVARCHAR(100) = NULL, @Notes NVARCHAR(1000) = NULL,
    @CommType VARCHAR(5) = NULL, @CommValue DECIMAL(12,2) = NULL, @IsActive BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @Name = LTRIM(RTRIM(@Name));
    SET @ContactPerson = NULLIF(LTRIM(RTRIM(@ContactPerson)), N'');
    SET @Mobile = NULLIF(LTRIM(RTRIM(@Mobile)), '');
    SET @Email = NULLIF(LTRIM(RTRIM(@Email)), '');
    SET @City = NULLIF(LTRIM(RTRIM(@City)), N'');
    SET @Notes = NULLIF(LTRIM(RTRIM(@Notes)), N'');
    IF @Name IS NULL OR @Name = N''
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Partner name is required' AS ResponseMess; RETURN; END
    IF (@CommType IS NULL AND @CommValue IS NOT NULL) OR (@CommType IS NOT NULL AND @CommValue IS NULL)
       OR (@CommType = 'pct' AND (@CommValue < 0 OR @CommValue > 100))
       OR (@CommType = 'fixed' AND @CommValue < 0)
       OR (@CommType IS NOT NULL AND @CommType NOT IN ('pct','fixed'))
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Commission must be a percent from 0 to 100 or an amount of 0 or more' AS ResponseMess; RETURN; END
    IF @Mobile IS NOT NULL AND ISNULL(@IsActive, 1) = 1 AND EXISTS (
        SELECT 1 FROM dbo.tblPartner WHERE CompId = @CompId AND Mobile = @Mobile AND IsActive = 1 AND Id <> ISNULL(@Id, 0))
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Another partner already has this mobile number' AS ResponseMess; RETURN; END

    IF ISNULL(@Id, 0) = 0
    BEGIN
        INSERT INTO dbo.tblPartner (CompId, Name, ContactPerson, Mobile, Email, City, Notes, CommType, CommValue, IsActive, CreatedBy)
        VALUES (@CompId, @Name, @ContactPerson, @Mobile, @Email, @City, @Notes, @CommType, @CommValue, ISNULL(@IsActive, 1), @UserId);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id, 200 AS ResponseCode, 'Partner added' AS ResponseMess;
        RETURN;
    END
    UPDATE dbo.tblPartner
    SET Name = @Name, ContactPerson = @ContactPerson, Mobile = @Mobile, Email = @Email, City = @City, Notes = @Notes,
        CommType = @CommType, CommValue = @CommValue, IsActive = ISNULL(@IsActive, 1), UpdatedAt = GETDATE()
    WHERE Id = @Id AND CompId = @CompId;
    IF @@ROWCOUNT = 0
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Partner not found' AS ResponseMess; RETURN; END
    SELECT @Id AS Id, 200 AS ResponseCode, 'Partner saved' AS ResponseMess;
END
GO

CREATE OR ALTER PROC dbo.sp_FetchPartners @CompId INT, @IncludeInactive BIT = 0, @WithStats BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    -- @WithStats = 0: the lead-form dropdown - active partners only, no aggregates.
    IF ISNULL(@WithStats, 1) = 0
    BEGIN
        SELECT Id, Name, City, CommType, CommValue
        FROM dbo.tblPartner WHERE CompId = @CompId AND IsActive = 1 ORDER BY Name;
        RETURN;
    END
    SELECT p.Id, p.Name, p.ContactPerson, p.Mobile, p.Email, p.City, p.Notes, p.CommType, p.CommValue, p.IsActive,
           (SELECT COUNT(*) FROM dbo.tblLeads l WHERE l.CompId = @CompId AND l.PartnerId = p.Id) AS LeadsSent,
           (SELECT COUNT(*) FROM dbo.tblLeads l JOIN dbo.tblLookup s ON s.Id = l.StatusId
             WHERE l.CompId = @CompId AND l.PartnerId = p.Id AND s.Code = 'converted') AS Converted,
           ISNULL((SELECT SUM(Amount) FROM dbo.tblPartnerCommission c WHERE c.CompId = @CompId AND c.PartnerId = p.Id AND c.Status = 'earned'), 0) AS EarnedAmount,
           ISNULL((SELECT SUM(Amount) FROM dbo.tblPartnerCommission c WHERE c.CompId = @CompId AND c.PartnerId = p.Id AND c.Status = 'due'), 0)    AS DueAmount,
           ISNULL((SELECT SUM(Amount) FROM dbo.tblPartnerCommission c WHERE c.CompId = @CompId AND c.PartnerId = p.Id AND c.Status = 'paid'), 0)   AS PaidAmount
    FROM dbo.tblPartner p
    WHERE p.CompId = @CompId AND (@IncludeInactive = 1 OR p.IsActive = 1)
    ORDER BY p.IsActive DESC, p.Name;
END
GO


-- Step 3: commission sync
-- Brings the lead's live commission row in line with the lead. Idempotent:
-- sp_SaveLead, sp_ConvertLead and sp_SetLeadStatus call it inside their own transaction
-- (a plain EXEC: it returns no result set and has no INSERT...EXEC). A second call changes nothing.
--   converted + partner + terms -> a live row exists (a Reverted paid row is restored,
--                                  not duplicated) (inserted earned/due per
--                                  the company setting; an unpaid one is
--                                  recomputed; a paid one is never touched)
--   anything else               -> unpaid live row cancelled; a paid one is
--                                  kept and flagged Reverted
CREATE OR ALTER PROC dbo.sp_SyncPartnerCommission @CompId INT, @LeadId INT, @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @Code VARCHAR(30), @PartnerId INT, @CommType VARCHAR(5), @CommValue DECIMAL(12,2), @Won DECIMAL(18,2);
    SELECT @Code = s.Code, @PartnerId = l.PartnerId, @CommType = l.CommType, @CommValue = l.CommValue, @Won = l.WonValue
    FROM dbo.tblLeads l JOIN dbo.tblLookup s ON s.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    IF @Code IS NULL RETURN;   -- callers have just read or written this lead

    BEGIN TRAN;
    DECLARE @LiveId INT, @LiveStatus VARCHAR(10);
    SELECT @LiveId = Id, @LiveStatus = Status
    FROM dbo.tblPartnerCommission WITH (UPDLOCK, HOLDLOCK)
    WHERE LeadId = @LeadId AND CompId = @CompId AND Status <> 'cancelled' AND Reverted = 0;

    IF @Code = 'converted' AND @PartnerId IS NOT NULL AND @CommType IS NOT NULL
    BEGIN
        DECLARE @Amount DECIMAL(14,2) = CASE @CommType
            WHEN 'pct' THEN ROUND(ISNULL(@Won, 0) * @CommValue / 100, 2) ELSE @CommValue END;
        DECLARE @RevId INT = (SELECT TOP 1 Id FROM dbo.tblPartnerCommission
                              WHERE LeadId = @LeadId AND CompId = @CompId AND Status = 'paid' AND Reverted = 1
                              ORDER BY Id DESC);
        IF @LiveId IS NULL AND @RevId IS NOT NULL
            -- re-convert: the paid row is settled again, never recomputed, never paid twice
            UPDATE dbo.tblPartnerCommission SET Reverted = 0 WHERE Id = @RevId;
        ELSE IF @LiveId IS NULL
        BEGIN
            DECLARE @DueOn VARCHAR(10) = ISNULL((SELECT CommissionDueOn FROM dbo.tblCompanySetting WHERE CompId = @CompId), 'manual');
            INSERT INTO dbo.tblPartnerCommission
                (CompId, LeadId, PartnerId, BaseValue, CommType, CommValue, Amount, Status, EarnedAt, DueAt, DueBy)
            VALUES (@CompId, @LeadId, @PartnerId, @Won, @CommType, @CommValue, @Amount,
                    CASE @DueOn WHEN 'convert' THEN 'due' ELSE 'earned' END, GETDATE(),
                    CASE @DueOn WHEN 'convert' THEN GETDATE() END,
                    CASE @DueOn WHEN 'convert' THEN @UserId END);
        END
        ELSE IF @LiveStatus IN ('earned','due')
            UPDATE dbo.tblPartnerCommission
            SET PartnerId = @PartnerId, BaseValue = @Won, CommType = @CommType, CommValue = @CommValue, Amount = @Amount
            WHERE Id = @LiveId;
    END
    ELSE IF @LiveId IS NOT NULL
    BEGIN
        IF @LiveStatus = 'paid'
            UPDATE dbo.tblPartnerCommission SET Reverted = 1 WHERE Id = @LiveId;
        ELSE
            UPDATE dbo.tblPartnerCommission SET Status = 'cancelled', CancelledAt = GETDATE() WHERE Id = @LiveId;
    END
    COMMIT;
END
GO

-- ---------------------------------------------------------------------------
-- 2. sp_SaveLead — unchanged from 071 except the history row on insert
--    107 (amendment A1): + @SetPartner/@PartnerId/@CommType/@CommValue/@SetTerms.
--    @SetPartner = 0 is exactly the old behaviour.
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
    @CustomJSON       NVARCHAR(MAX)  = NULL,
    @SetPartner       BIT            = 0,      -- 107
    @PartnerId        INT            = NULL,   -- 107
    @CommType         VARCHAR(5)     = NULL,   -- 107
    @CommValue        DECIMAL(12,2)  = NULL,   -- 107
    @SetTerms         BIT            = 0       -- 107
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
    -- 107: partner inputs that can be refused without reading the lead
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL AND @PartnerId <= 0 SET @PartnerId = NULL;
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL AND @SetTerms = 1 AND @CommType IS NOT NULL
       AND (@CommType NOT IN ('pct','fixed') OR @CommValue IS NULL OR @CommValue < 0
            OR (@CommType = 'pct' AND @CommValue > 100))
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Commission must be a percent from 0 to 100 or an amount of 0 or more' AS ResponseMess; RETURN; END
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblPartner WHERE Id = @PartnerId AND CompId = @CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid partner' AS ResponseMess; RETURN; END

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

        -- 107 BEGIN partner block (amendment A1): set or clear the lead's partner and terms.
        --   @SetTerms = 1: take @CommType/@CommValue.  @SetTerms = 0: the partner's usual rule when
        --   the partner changes, the lead's current terms when it does not.
        --   Refused (409) when the live commission is already paid and partner/terms would change.
        IF @SetPartner = 1
        BEGIN
            DECLARE @OldPartner INT, @OldType VARCHAR(5), @OldValue DECIMAL(12,2),
                    @NewType VARCHAR(5), @NewValue DECIMAL(12,2);
            SELECT @OldPartner = PartnerId, @OldType = CommType, @OldValue = CommValue
            FROM dbo.tblLeads WITH (UPDLOCK, HOLDLOCK) WHERE Id = @LeadId AND CompId = @CompId;

            IF @PartnerId IS NOT NULL AND ISNULL(@OldPartner, 0) <> @PartnerId AND NOT EXISTS (
                SELECT 1 FROM dbo.tblPartner WHERE Id = @PartnerId AND CompId = @CompId AND IsActive = 1)
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Pick an active partner' AS ResponseMess;
                RETURN;
            END

            IF @PartnerId IS NULL
                SELECT @NewType = NULL, @NewValue = NULL;
            ELSE IF @SetTerms = 1
                SELECT @NewType = @CommType, @NewValue = CASE WHEN @CommType IS NULL THEN NULL ELSE @CommValue END;
            ELSE IF ISNULL(@OldPartner, 0) <> @PartnerId
                SELECT @NewType = CommType, @NewValue = CommValue FROM dbo.tblPartner WHERE Id = @PartnerId;
            ELSE
                SELECT @NewType = @OldType, @NewValue = @OldValue;

            IF NOT (ISNULL(@OldPartner, 0) = ISNULL(@PartnerId, 0) AND ISNULL(@OldType, '') = ISNULL(@NewType, '')
                    AND ISNULL(@OldValue, -1) = ISNULL(@NewValue, -1))
            BEGIN
                IF EXISTS (SELECT 1 FROM dbo.tblPartnerCommission WITH (UPDLOCK, HOLDLOCK)
                           WHERE LeadId = @LeadId AND CompId = @CompId AND Status = 'paid')  -- 107: a Reverted paid row freezes too
                BEGIN
                    ROLLBACK TRANSACTION;
                    SELECT ISNULL(@Id,0) AS Id, 409 AS ResponseCode, 'The commission for this lead is already paid, so its partner and commission cannot change' AS ResponseMess;
                    RETURN;
                END

                DECLARE @PartnerSource INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                                              WHERE CompId = @CompId AND Kind = 'lead_source' AND Code = 'partner' AND IsActive = 1);
                UPDATE dbo.tblLeads
                SET PartnerId = @PartnerId, CommType = @NewType, CommValue = @NewValue,
                    SourceId = CASE WHEN @PartnerId IS NOT NULL AND @PartnerSource IS NOT NULL THEN @PartnerSource ELSE SourceId END
                WHERE Id = @LeadId AND CompId = @CompId;

                DECLARE @PartnerName NVARCHAR(200) = (SELECT Name FROM dbo.tblPartner WHERE Id = @PartnerId);
                DECLARE @PartnerSummary NVARCHAR(500) = CASE WHEN @PartnerId IS NULL THEN N'Partner removed' ELSE N'Partner: ' + @PartnerName END;
                INSERT INTO @actLog
                EXEC dbo.sp_LogLeadActivity
                    @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                    @Type = 'partner', @Summary = @PartnerSummary, @MetaJSON = NULL;

                EXEC dbo.sp_SyncPartnerCommission @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId;
            END
        END
        -- 107 END partner block

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- sp_ConvertLead: customer match restricted to the lead's office.
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
-- ===== 7. Procedures — convert engine (sp_ConvertLead, sp_SetLeadStatus)

-- ---------------------------------------------------------------------------
-- 7.1 sp_ConvertLead — the proc sp_SetLeadStatus has been pointing at since
--     071 ("Use convert to move a lead to Converted") and which never existed.
--
--     ONE engine writes a win. "Accepted" on a quotation and "Won" in the
--     lead's status dropdown both land here; the only difference is where the
--     value comes from:
--        with @QuotationId → the quotation's BEFORE-TAX total (GST is not
--                            revenue); any @WonValue passed is ignored
--        without           → @WonValue, typed by the agent (small leads are
--                            won without a quotation — spec decision 6)
--
--     It also does what "convert" has always meant in this product: the
--     prospect becomes a customer. An active tblCustomer with the lead's mobile
--     is LINKED (a repeat buyer must not become a duplicate); otherwise one is
--     created from the lead. Mobiles are 10 digits on both sides (§1), so the
--     match is reliable.
--
--     Idempotent: a lead that is already won answers 200 and changes nothing.
--     tblLeadStatusHistory now has three writers — sp_SaveLead (insert),
--     sp_SetLeadStatus, and this.
--
--     107 (amendment A1): one line before COMMIT syncs the partner commission.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ConvertLead
    @CompId      INT,
    @LeadId      INT,
    @UserId      INT,
    @WonValue    DECIMAL(18,2) = NULL,
    @Remarks     NVARCHAR(500) = NULL,
    @QuotationId INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @QuotationId IS NOT NULL AND @QuotationId <= 0 SET @QuotationId = NULL;
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200),
            @BranchId INT, @CustomerId INT, @CurWon DECIMAL(18,2),
            @LName NVARCHAR(200), @LCompany NVARCHAR(200), @LMobile VARCHAR(20), @LAlt VARCHAR(20),
            @LEmail NVARCHAR(200), @LAddress NVARCHAR(500), @LCity NVARCHAR(100), @LState NVARCHAR(100), @LPin VARCHAR(10);

    SELECT @FromStatusId = l.StatusId, @FromCode = st.Code, @FromName = st.Value,
           @BranchId = l.BranchId, @CustomerId = l.CustomerId, @CurWon = l.WonValue,
           @LName = l.Name, @LCompany = NULLIF(LTRIM(RTRIM(l.Company)), N''), @LMobile = l.MobileNo, @LAlt = l.AltMobile,
           @LEmail = l.Email, @LAddress = l.Address, @LCity = l.City, @LState = l.State, @LPin = l.Pincode
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;

    IF @FromStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @FromCode = 'converted'
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead is already won' AS ResponseMess, @CustomerId AS CustomerId, @CurWon AS WonValue; RETURN; END
    IF @FromCode NOT IN ('open','qualified')
    BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only an active lead can be marked won — reopen it first' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    DECLARE @WonStatusId INT, @ToName NVARCHAR(200);
    SELECT TOP 1 @WonStatusId = Id, @ToName = Value FROM dbo.tblLookup
    WHERE CompId = @CompId AND Kind = 'lead_status' AND Code = 'converted' AND IsActive = 1
    ORDER BY SortOrder, Id;
    IF @WonStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'No Won status is configured for this company' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    DECLARE @QuoteNo VARCHAR(30), @QuoteGstin VARCHAR(15);
    IF @QuotationId IS NOT NULL
    BEGIN
        DECLARE @QStatus VARCHAR(20);
        SELECT @QStatus = Status, @QuoteNo = QuoteNo, @WonValue = TaxableTotal, @QuoteGstin = ToGSTIN
        FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId AND LeadId = @LeadId;
        IF @QStatus IS NULL
        BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'That quotation does not belong to this lead' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
        IF @QStatus <> 'final'
        BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    END
    ELSE IF @WonValue IS NULL OR @WonValue < 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Enter the value this lead was won for' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- LOCK ORDER, and why this proc takes it in exactly this direction:
        --   tblCustomer → tblLeads → tblQuotation → tblLeadActivity
        -- sp_SetLeadStatus (7.2) writes tblLeads then tblQuotation, so this
        -- proc must too — taking the quotation first would close a deadlock
        -- cycle with an agent moving the same lead to lost at the same moment.
        -- The other four writers of tblQuotation.Status (save, finalise,
        -- revise, reject) read tblLeads BEFORE their transaction opens and so
        -- never hold a quotation lock while asking for a lead row; their own
        -- order, tblQuotation → tblQuotationLine → tblLeadActivity, is a
        -- suffix of this one and stays intact.

        -- The customer: keep the link the lead already has, else match on the
        -- mobile, else create.
        IF @CustomerId IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @CustomerId AND CompId = @CompId AND IsActive = 1)
            SET @CustomerId = NULL;

        IF @CustomerId IS NULL AND @LMobile IS NOT NULL
            SELECT TOP 1 @CustomerId = Id FROM dbo.tblCustomer WITH (UPDLOCK, HOLDLOCK)
            WHERE CompId = @CompId AND BranchId = @BranchId AND Mobile = @LMobile AND IsActive = 1 ORDER BY Id;  -- 096: match within the lead's office

        IF @CustomerId IS NULL
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, GSTIN, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, ISNULL(@LCompany, @LName), CASE WHEN @LCompany IS NOT NULL THEN @LName END,
                 @LMobile, @LAlt, @LEmail, @LAddress, @LCity, @LState, @LPin, @QuoteGstin,
                 NULL, 1, @UserId, @UserId, GETDATE());
            SET @CustomerId = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE IF @QuoteGstin IS NOT NULL
            UPDATE dbo.tblCustomer SET GSTIN = @QuoteGstin, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @CustomerId AND CompId = @CompId AND GSTIN IS NULL;

        -- The win.
        DECLARE @hist TABLE (FromStatusId INT);
        UPDATE dbo.tblLeads
        SET StatusId = @WonStatusId, WonAt = GETDATE(), WonValue = @WonValue, CustomerId = @CustomerId,
            LostAt = NULL, LostReasonId = NULL, EditBy = @UserId, UpdatedAt = GETDATE()
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @LeadId AND CompId = @CompId;

        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @LeadId, h.FromStatusId, @WonStatusId, @UserId, GETDATE() FROM @hist h;

        -- Its quotations: the accepted one, and everything else on the lead.
        --
        -- This is the FIFTH writer of tblQuotation.Status, and it wears the
        -- same race guard as finalise: re-read the row under UPDLOCK, re-assert
        -- the status the decision above was made on, guard the UPDATE itself
        -- with that status and check @@ROWCOUNT. The `IS NULL` arm is not
        -- decoration — `SELECT @v = col` leaves @v untouched when no row
        -- matches, and NULL <> 'final' is UNKNOWN, not TRUE, so a row deleted
        -- in the gap would otherwise fall straight through.
        -- @WonValue was read from this row before the transaction and is
        -- already on the lead by now; re-reading TaxableTotal here would buy
        -- nothing, because only sp_SaveQuotation writes the totals and it
        -- refuses anything that is not a draft — a row still 'final' under the
        -- lock has the same total it had a moment ago.
        IF @QuotationId IS NOT NULL
        BEGIN
            DECLARE @LockStatus VARCHAR(20);
            SELECT @LockStatus = Status FROM dbo.tblQuotation WITH (UPDLOCK)
            WHERE Id = @QuotationId AND CompId = @CompId AND LeadId = @LeadId;

            IF @LockStatus IS NULL OR @LockStatus <> 'final'
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN;
            END

            UPDATE dbo.tblQuotation
            SET Status = 'accepted', CustomerId = @CustomerId, ClosedAt = GETDATE(), ClosedBy = @UserId,
                CloseRemarks = @Remarks, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @QuotationId AND CompId = @CompId AND Status = 'final';

            IF @@ROWCOUNT = 0
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN;
            END
        END

        -- The sweep needs no re-read: the status it requires is in its own
        -- WHERE, so the test and the write are one atomic statement. Zero rows
        -- is a legitimate answer here (a lead won without a quotation), which
        -- is why this one is not @@ROWCOUNT-checked.
        UPDATE dbo.tblQuotation
        SET Status = 'unused', ClosedAt = GETDATE(), ClosedBy = @UserId,
            CloseRemarks = CASE WHEN @QuoteNo IS NOT NULL THEN N'Lead won on ' + @QuoteNo ELSE N'Lead won without a quotation' END
        WHERE CompId = @CompId AND LeadId = @LeadId AND Status IN ('draft','final')
          AND (@QuotationId IS NULL OR Id <> @QuotationId);

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        -- 500, matching sp_LogLeadActivity's own @Summary: a wider variable only
        -- moves the truncation to the EXEC, where it is invisible.
        DECLARE @Summary NVARCHAR(500) = N'Status: ' + @FromName + N' → ' + @ToName
                                        + N' · value ' + CAST(@WonValue AS NVARCHAR(30))
                                        + ISNULL(N' · ' + @QuoteNo, N'')
                                        + ISNULL(N' — ' + @Remarks, N'');
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @WonStatusId AS toStatusId,
                                              @FromCode AS fromCode, 'converted' AS toCode,
                                              @WonValue AS wonValue, @QuotationId AS quotationId,
                                              @CustomerId AS customerId, @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        EXEC dbo.sp_SyncPartnerCommission @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId;  -- 107

        COMMIT TRANSACTION;
        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead marked won' AS ResponseMess, @CustomerId AS CustomerId, @WonValue AS WonValue;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        -- 2601 / 2627: someone created a customer with this mobile a moment ago.
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @LeadId AS Id, 409 AS ResponseCode, 'A customer with this mobile was just created — please try again' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue;
        ELSE
            SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 7.2 sp_SetLeadStatus — unchanged from 075 except three things. The refusal
--     of 'converted' STAYS: a win is written by sp_ConvertLead and nowhere else.
--       a. any move made here clears WonAt / WonValue. This proc can never set
--          them, so the only lead that has them is one LEAVING 'converted' —
--          an agent undoing a mistaken win.
--       b. …and that lead's accepted quotation goes back to 'final'. The
--          customer record and tblLeads.CustomerId stay: a complaint may
--          already hang off that customer.
--       c. → lost / junk closes the lead's open quotations as 'unused'.
--
--     Both quotation writes carry the status they require in their own WHERE,
--     so the test and the write are one atomic statement — no read-then-write
--     gap to lock against. Lock order is tblLeads → tblQuotation →
--     tblLeadActivity, the same direction sp_ConvertLead takes.
--
--     107 (amendment A1): one line before COMMIT syncs the partner commission.
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
            WonAt = NULL, WonValue = NULL,                       -- (a)
            EditBy = @UserId, UpdatedAt = GETDATE()
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @LeadId AND CompId = @CompId;

        -- 075: the transition, in the same transaction as the update. The source
        -- status comes from the UPDATE's own OUTPUT, not the @FromStatusId read
        -- before the transaction — two concurrent changes would otherwise both
        -- record the same source.
        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @LeadId, h.FromStatusId, @StatusId, @UserId, GETDATE() FROM @hist h;

        -- (b) a win undone: its quotation is a live offer again.
        IF @FromCode = 'converted'
            UPDATE dbo.tblQuotation
            SET Status = 'final', CustomerId = NULL, ClosedAt = NULL, ClosedBy = NULL, CloseRemarks = NULL,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE CompId = @CompId AND LeadId = @LeadId AND Status = 'accepted';

        -- (c) a dead lead has no open offers.
        IF @ToCode IN ('lost','junk')
            UPDATE dbo.tblQuotation
            SET Status = 'unused', ClosedAt = GETDATE(), ClosedBy = @UserId,
                CloseRemarks = N'Lead marked ' + @ToName
            WHERE CompId = @CompId AND LeadId = @LeadId AND Status IN ('draft','final');

        DECLARE @Summary NVARCHAR(500) = N'Status: ' + @FromName + N' → ' + @ToName;
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @StatusId AS toStatusId,
                                              @FromCode AS fromCode, @ToCode AS toCode,
                                              @LostReasonId AS lostReasonId
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        EXEC dbo.sp_SyncPartnerCommission @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId;  -- 107

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
-- 9.11 sp_FetchLeadDetail — 5 result sets
--   1 core (+labels)   2 custom values   3 timeline
--   4 follow-ups       5 assignment history
--   permission.js reads RS1[0].OwnerId / CreatedBy / BranchId — kept.
--   107 (amendment A1): RS1 + partner/terms columns; RS6 (last) = the lead's commission rows.
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
           l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.WonValue, l.CustomerId, cust.Name AS CustomerName, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           l.PartnerId, pr.Name AS PartnerName, l.CommType, l.CommValue,   -- 107
           200 AS ResponseCode, 'Lead detail retrieved successfully' AS ResponseMess
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblLookup lr  ON lr.Id  = l.LostReasonId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = l.ProductId
    LEFT JOIN dbo.tblUser o     ON o.Id   = l.OwnerId
    LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId
    LEFT JOIN dbo.tblCustomer cust ON cust.Id = l.CustomerId AND cust.CompId = l.CompId
    LEFT JOIN dbo.tblPartner pr ON pr.Id = l.PartnerId   -- 107
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

    -- 6) commission rows of this lead, newest first (107)
    SELECT c.Id, c.PartnerId, p2.Name AS PartnerName, c.BaseValue, c.CommType, c.CommValue, c.Amount,
           c.Status, c.Reverted, c.EarnedAt, c.DueAt, c.PaidAt, c.PaidRef
    FROM dbo.tblPartnerCommission c JOIN dbo.tblPartner p2 ON p2.Id = c.PartnerId
    WHERE c.LeadId = @LeadId AND c.CompId = @CompId
    ORDER BY c.Id DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_SaveCompanySetting
    @CompId            BIGINT,
    @LateGraceMin      INT,
    @SessionBufferMin  INT,
    @WarnPct           INT,
    @NotifyNotSignedIn BIT,
    @GoLiveDate        DATE = NULL,
    @CommissionDueOn   VARCHAR(10) = NULL   -- 107: NULL leaves the column as it is
AS
BEGIN
    SET NOCOUNT ON;

    IF @LateGraceMin IS NULL OR @LateGraceMin NOT BETWEEN 0 AND 120
    BEGIN SELECT 400 AS ResponseCode, 'Late grace must be 0 to 120 minutes' AS ResponseMess; RETURN; END
    IF @SessionBufferMin IS NULL OR @SessionBufferMin NOT BETWEEN 0 AND 480
    BEGIN SELECT 400 AS ResponseCode, 'Session buffer must be 0 to 480 minutes' AS ResponseMess; RETURN; END
    IF @WarnPct IS NULL OR @WarnPct NOT BETWEEN 50 AND 95
    BEGIN SELECT 400 AS ResponseCode, 'Warn at must be 50 to 95 percent' AS ResponseMess; RETURN; END
    IF @CommissionDueOn IS NOT NULL AND @CommissionDueOn NOT IN ('manual','convert')   -- 107
    BEGIN SELECT 400 AS ResponseCode, 'Choose when commission becomes payable' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblCompanySetting WITH (UPDLOCK, HOLDLOCK)
           SET LateGraceMin = @LateGraceMin, SessionBufferMin = @SessionBufferMin, WarnPct = @WarnPct,
               NotifyNotSignedIn = ISNULL(@NotifyNotSignedIn, 1), GoLiveDate = @GoLiveDate,
               CommissionDueOn = ISNULL(@CommissionDueOn, CommissionDueOn),   -- 107
               UpdatedAt = GETDATE()
         WHERE CompId = @CompId;
        IF @@ROWCOUNT = 0
            INSERT INTO dbo.tblCompanySetting (CompId, LateGraceMin, SessionBufferMin, WarnPct, NotifyNotSignedIn, GoLiveDate, CommissionDueOn)   -- 107
            VALUES (@CompId, @LateGraceMin, @SessionBufferMin, @WarnPct, ISNULL(@NotifyNotSignedIn, 1), @GoLiveDate, ISNULL(@CommissionDueOn, 'manual'));
        COMMIT;
        SELECT 200 AS ResponseCode, 'Settings saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- RS1–RS3 exactly as 099; RS4 now reads the policy. 107: RS1 also returns CommissionDueOn.
CREATE OR ALTER PROCEDURE dbo.sp_FetchWorkSettings
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    -- RS1 always one row (defaults when the company has no settings row yet).
    SELECT ISNULL(s.LateGraceMin, 10)                   AS LateGraceMin,
           ISNULL(s.SessionBufferMin, 120)              AS SessionBufferMin,
           ISNULL(s.WarnPct, 80)                        AS WarnPct,
           ISNULL(s.NotifyNotSignedIn, CAST(1 AS BIT))  AS NotifyNotSignedIn,
           s.GoLiveDate,
           ISNULL(s.CommissionDueOn, 'manual')          AS CommissionDueOn   -- 107
    FROM (SELECT 1 AS x) d
    LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;

    -- RS2 shifts. The default also counts users with no shift of their own.
    SELECT w.Id, w.Name, w.IsDefault, w.DaysJson,
           (SELECT COUNT(*) FROM dbo.tblUser u
             WHERE u.CompId = @CompId AND u.IsActive = 1
               AND (u.WorkCalendarId = w.Id OR (w.IsDefault = 1 AND u.WorkCalendarId IS NULL))) AS UserCount
    FROM dbo.tblWorkCalendar w
    WHERE w.CompId = @CompId
    ORDER BY w.IsDefault DESC, w.Name;

    -- RS3 holidays from a year ago onward.
    SELECT h.Id, h.HolidayDate, h.Name, h.BranchId, b.BranchName
    FROM dbo.tblHoliday h
    LEFT JOIN dbo.tblBranch b ON b.Id = h.BranchId
    WHERE h.CompId = @CompId
      AND h.HolidayDate >= DATEADD(YEAR, -1, CAST(GETDATE() AS DATE))
    ORDER BY h.HolidayDate;

    -- RS4 TAT policy (100).
    SELECT CAST(Priority AS VARCHAR(30)) AS Priority, Minutes
    FROM dbo.tblTaskTatPolicy
    WHERE CompId = @CompId
    ORDER BY CASE Priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END;
END
GO

-- Step 4: commission list and status
CREATE OR ALTER PROC dbo.sp_FetchCommissions
    @CompId INT, @PartnerId INT = NULL, @Status VARCHAR(10) = NULL, @FromDate DATE = NULL, @ToDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.Id, c.LeadId, l.Name AS LeadName, c.PartnerId, p.Name AS PartnerName,
           c.BaseValue, c.CommType, c.CommValue, c.Amount, c.Status, c.Reverted,
           c.EarnedAt, c.DueAt, c.PaidAt, c.PaidRef
    FROM dbo.tblPartnerCommission c
    JOIN dbo.tblPartner p ON p.Id = c.PartnerId
    JOIN dbo.tblLeads   l ON l.Id = c.LeadId
    WHERE c.CompId = @CompId
      AND (@PartnerId IS NULL OR c.PartnerId = @PartnerId)
      AND (@Status IS NULL OR c.Status = @Status)
      AND (@FromDate IS NULL OR c.EarnedAt >= @FromDate)
      AND (@ToDate   IS NULL OR c.EarnedAt < DATEADD(DAY, 1, @ToDate))
    ORDER BY CASE c.Status WHEN 'due' THEN 0 WHEN 'earned' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END, c.EarnedAt DESC;
END
GO

-- One proc moves commission rows: 'due' (ready to pay) from 'earned', 'paid' from 'due'.
-- The status test and the write are one UPDATE, so two people pressing at once change a row once.
CREATE OR ALTER PROC dbo.sp_SetCommissionStatus
    @CompId INT, @UserId INT, @IdsJson NVARCHAR(MAX), @ToStatus VARCHAR(10),
    @PaidAt DATE = NULL, @PaidRef NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @n INT;
    IF @ToStatus = 'due'
    BEGIN
        UPDATE c SET Status = 'due', DueAt = GETDATE(), DueBy = @UserId
        FROM dbo.tblPartnerCommission c
        JOIN OPENJSON(@IdsJson) WITH (Id INT '$') j ON j.Id = c.Id
        WHERE c.CompId = @CompId AND c.Status = 'earned';
        SET @n = @@ROWCOUNT;
        IF @n = 0
        BEGIN SELECT 0 AS Id, 409 AS ResponseCode, 'Nothing changed: these are not waiting to be marked ready' AS ResponseMess; RETURN; END
        SELECT @n AS Id, 200 AS ResponseCode, CONCAT(@n, ' marked ready to pay') AS ResponseMess;
    END
    ELSE IF @ToStatus = 'paid'
    BEGIN
        IF @PaidAt IS NULL
        BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Payment date is required' AS ResponseMess; RETURN; END
        UPDATE c SET Status = 'paid', PaidAt = @PaidAt, PaidBy = @UserId, PaidRef = NULLIF(LTRIM(RTRIM(@PaidRef)), N'')
        FROM dbo.tblPartnerCommission c
        JOIN OPENJSON(@IdsJson) WITH (Id INT '$') j ON j.Id = c.Id
        WHERE c.CompId = @CompId AND c.Status = 'due';
        SET @n = @@ROWCOUNT;
        IF @n = 0
        BEGIN SELECT 0 AS Id, 409 AS ResponseCode, 'Nothing changed: these are already paid or not ready to pay' AS ResponseMess; RETURN; END
        SELECT @n AS Id, 200 AS ResponseCode, CONCAT(@n, ' marked paid') AS ResponseMess;
    END
    ELSE
        SELECT 0 AS Id, 400 AS ResponseCode, 'Unknown status' AS ResponseMess;
END
GO

-- Step 5: sp_FetchLeads — @PartnerId filter + PartnerId/PartnerName column; the creator keeps a lead only while it has no owner.
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
    @OwnerIdsJson            NVARCHAR(MAX) = NULL,
    @PartnerId               INT           = NULL
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
      AND (@PartnerId  IS NULL OR l.PartnerId = @PartnerId)
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
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR (l.OwnerId IS NULL AND l.CreatedBy = @UserId)))
          )
    ORDER BY CASE WHEN @Overdue = 1 THEN l.NextFollowupDate END ASC, l.CreatedAt DESC, l.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1: page of leads
    SELECT l.Id, l.CompId, l.BranchId, b.BranchName,
           l.Name, l.Company, l.MobileNo, l.AltMobile, l.Email,
           l.Address, l.City, l.State, l.Pincode,
           l.SourceId, src.Value AS SourceName,
           l.PartnerId, pr.Name AS PartnerName,
           l.ProductId, p.Name AS ProductName,
           l.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           l.OwnerId, o.FullName AS OwnerName, o.Avatar AS OwnerAvatar,
           l.EstValue, l.Remarks, l.NextFollowupDate,
           CAST(CASE WHEN l.NextFollowupDate < @Today AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           l.LostReasonId, l.WonAt, l.WonValue, l.CustomerId, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           200 AS ResponseCode, 'Leads retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblLeads l ON l.Id = x.Id
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblPartner pr ON pr.Id = l.PartnerId
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
          AND (@PartnerId  IS NULL OR l.PartnerId = @PartnerId)
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
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR (l.OwnerId IS NULL AND l.CreatedBy = @UserId)))
              );

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;
END
GO

-- Step 6: Partner report on the shared 12-param contract.
CREATE OR ALTER PROC dbo.sp_RptPartners
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'partner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('partner')
    BEGIN RAISERROR('sp_RptPartners: unknown GroupBy', 16, 1); RETURN; END
    IF ISNULL(@DateBasis, '') NOT IN ('created','closed','activity') SET @DateBasis = 'created';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    -- Lead counts group by the lead's partner; commission sums group by the
    -- commission row's partner (as sp_FetchPartners does), so they are two sets.
    SELECT l.Id, l.PartnerId AS GroupKey,
           CAST(CASE WHEN st.Code = 'converted' THEN 1 ELSE 0 END AS INT) AS IsConv,
           CASE WHEN st.Code = 'converted' THEN ISNULL(l.WonValue, 0) ELSE 0 END AS WonValue,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st  ON st.Id = l.StatusId AND st.CompId = @CompId
    JOIN dbo.tblPartner pr ON pr.Id = l.PartnerId AND pr.CompId = @CompId
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN l.WonAt
                 WHEN 'activity' THEN (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f
                                        WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done')
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND l.PartnerId IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR (l.OwnerId IS NULL AND l.CreatedBy = @UserId)))
          );

    SELECT c.PartnerId AS GroupKey,
           SUM(CASE WHEN c.Status = 'earned' THEN c.Amount ELSE 0 END) AS Earned,
           SUM(CASE WHEN c.Status = 'due'    THEN c.Amount ELSE 0 END) AS Due,
           SUM(CASE WHEN c.Status = 'paid'   THEN c.Amount ELSE 0 END) AS Paid
    INTO #C
    FROM dbo.tblPartnerCommission c
    WHERE c.CompId = @CompId AND c.Status <> 'cancelled' AND c.LeadId IN (SELECT Id FROM #L)
    GROUP BY c.PartnerId;

    -- RS1: KPIs
    SELECT (SELECT COUNT(*) FROM #L) AS LeadsSent,
           (SELECT ISNULL(SUM(IsConv), 0) FROM #L) AS Converted,
           ISNULL((SELECT CAST(100.0 * SUM(IsConv) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) FROM #L), 0) AS ConversionPct,
           (SELECT CAST(ISNULL(SUM(WonValue), 0) AS DECIMAL(18,2)) FROM #L) AS WonValue,
           (SELECT CAST(ISNULL(SUM(Earned), 0) AS DECIMAL(14,2)) FROM #C) AS Earned,
           (SELECT CAST(ISNULL(SUM(Due), 0)    AS DECIMAL(14,2)) FROM #C) AS Due,
           (SELECT CAST(ISNULL(SUM(Paid), 0)   AS DECIMAL(14,2)) FROM #C) AS Paid;

    -- RS2: one row per partner (a partner with commission here but no lead here still shows)
    SELECT k.GroupKey, pr.Name AS GroupLabel,
           ISNULL(ls.LeadsSent, 0) AS LeadsSent,
           ISNULL(ls.Converted, 0) AS Converted,
           ISNULL(CAST(100.0 * ls.Converted / NULLIF(ls.LeadsSent, 0) AS DECIMAL(5,1)), 0) AS ConversionPct,
           CAST(ISNULL(ls.WonValue, 0) AS DECIMAL(18,2)) AS WonValue,
           CAST(ISNULL(cm.Earned, 0) AS DECIMAL(14,2)) AS Earned,
           CAST(ISNULL(cm.Due, 0)    AS DECIMAL(14,2)) AS Due,
           CAST(ISNULL(cm.Paid, 0)   AS DECIMAL(14,2)) AS Paid
    FROM (SELECT GroupKey FROM #L UNION SELECT GroupKey FROM #C) k
    JOIN dbo.tblPartner pr ON pr.Id = k.GroupKey AND pr.CompId = @CompId
    LEFT JOIN (SELECT GroupKey, COUNT(*) AS LeadsSent, SUM(IsConv) AS Converted, SUM(WonValue) AS WonValue
               FROM #L GROUP BY GroupKey) ls ON ls.GroupKey = k.GroupKey
    LEFT JOIN #C cm ON cm.GroupKey = k.GroupKey
    ORDER BY ISNULL(ls.LeadsSent, 0) DESC, pr.Name;

    -- RS3: trend
    SELECT Bucket, COUNT(*) AS LeadsSent, SUM(IsConv) AS Converted
    FROM #L
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO

-- 107 §6: a lead is always visible to its current OWNER; the bare creator arm
-- goes (Step 7b below puts the creator back only while the lead has no owner).
-- Each proc is re-created from its own live text with exactly that
-- string removed — nothing else changes. DDL is transactional, so a failed
-- re-create leaves the old proc in place.
DECLARE @procs TABLE (name SYSNAME);
INSERT INTO @procs VALUES (N'sp_Dashboard'), (N'sp_FetchQuotations'), (N'sp_FetchFollowUps'),
    (N'sp_RptFunnel'), (N'sp_RptLost'), (N'sp_RptPipelineValue'), (N'sp_RptFollowUpCompliance'),
    (N'sp_RptActivity'), (N'sp_RptLeaderboard'), (N'sp_RptAging'), (N'sp_RptTransfers');
DECLARE @p SYSNAME, @def NVARCHAR(MAX), @drop NVARCHAR(400);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @procs;
OPEN c; FETCH NEXT FROM c INTO @p;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @p));
    IF @def IS NOT NULL AND (CHARINDEX(N' OR l.CreatedBy = @UserId', @def) > 0
                          OR CHARINDEX(N' OR bl.CreatedBy = @UserId', @def) > 0)
    BEGIN
        SET @def = REPLACE(@def, N' OR l.CreatedBy = @UserId', N'');
        SET @def = REPLACE(@def, N' OR bl.CreatedBy = @UserId', N''); -- sp_Dashboard follow-up arm; bt. (tickets) is left alone
        SET @drop = N'DROP PROCEDURE dbo.' + QUOTENAME(@p);
        BEGIN TRY
            BEGIN TRAN;
            EXEC (@drop);
            EXEC (@def);
            COMMIT;
            PRINT N'creator arm removed: ' + @p;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            PRINT N'FAILED, left as it was: ' + @p + N' — ' + ERROR_MESSAGE();
            THROW;
        END CATCH
    END
    FETCH NEXT FROM c INTO @p;
END
CLOSE c; DEALLOCATE c;
GO

-- Step 7b: the creator keeps a lead only while it has NO owner (an "assign later" lead
-- must not vanish from the person who made it). Runs on the post-Step-7 text, where the
-- always-visible arm is "@UserId IS NOT NULL AND (l.OwnerId = @UserId" (sp_Dashboard's
-- follow-up Calls set: "(bl.OwnerId = @UserId"). The anchors carry the "@UserId IS NOT
-- NULL AND (" prefix so they match only that arm — never an @OwnerId filter, and the
-- l. anchor never matches inside bl. (checked against TestCRM and eCRM+ 2026-10-10: every
-- occurrence of "(l.OwnerId = @UserId" / "(bl.OwnerId = @UserId" is the arm).
-- Idempotent: a proc already carrying the new predicate is skipped.
DECLARE @procs TABLE (name SYSNAME);
INSERT INTO @procs VALUES (N'sp_Dashboard'), (N'sp_FetchQuotations'), (N'sp_FetchFollowUps'),
    (N'sp_RptFunnel'), (N'sp_RptLost'), (N'sp_RptPipelineValue'), (N'sp_RptFollowUpCompliance'),
    (N'sp_RptActivity'), (N'sp_RptLeaderboard'), (N'sp_RptAging'), (N'sp_RptTransfers');
DECLARE @p SYSNAME, @def NVARCHAR(MAX), @drop NVARCHAR(400);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @procs;
OPEN c; FETCH NEXT FROM c INTO @p;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @p));
    IF @def IS NOT NULL
       AND CHARINDEX(N'l.OwnerId IS NULL AND l.CreatedBy = @UserId', @def) = 0
       AND CHARINDEX(N'@UserId IS NOT NULL AND (l.OwnerId = @UserId', @def) > 0
    BEGIN
        SET @def = REPLACE(@def, N'@UserId IS NOT NULL AND (l.OwnerId = @UserId',
                                 N'@UserId IS NOT NULL AND (l.OwnerId = @UserId OR (l.OwnerId IS NULL AND l.CreatedBy = @UserId)');
        SET @def = REPLACE(@def, N'@UserId IS NOT NULL AND (bl.OwnerId = @UserId',
                                 N'@UserId IS NOT NULL AND (bl.OwnerId = @UserId OR (bl.OwnerId IS NULL AND bl.CreatedBy = @UserId)');
        SET @drop = N'DROP PROCEDURE dbo.' + QUOTENAME(@p);
        BEGIN TRY
            BEGIN TRAN;
            EXEC (@drop);
            EXEC (@def);
            COMMIT;
            PRINT N'creator kept while unowned: ' + @p;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            PRINT N'FAILED, left as it was: ' + @p + N' — ' + ERROR_MESSAGE();
            THROW;
        END CATCH
    END
    FETCH NEXT FROM c INTO @p;
END
CLOSE c; DEALLOCATE c;
GO

-- Procs of the first draft of 107 that were merged into the ones above (they exist only where that
-- draft was applied); callers moved to sp_FetchPartners @WithStats, sp_SaveLead @SetPartner,
-- sp_FetchLeadDetail (RS1 + RS6), sp_SetCommissionStatus and sp_SaveCompanySetting.
DROP PROCEDURE IF EXISTS dbo.sp_FetchPartnerPicker;
DROP PROCEDURE IF EXISTS dbo.sp_SetLeadPartner;
DROP PROCEDURE IF EXISTS dbo.sp_FetchLeadPartner;
DROP PROCEDURE IF EXISTS dbo.sp_MarkCommissionDue;
DROP PROCEDURE IF EXISTS dbo.sp_MarkCommissionPaid;
DROP PROCEDURE IF EXISTS dbo.sp_SavePartnerSetting;
GO

-- 7.9 sp_DeleteLead — unchanged from 8.3 except a lead with partner commission cannot be deleted
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
    IF EXISTS (SELECT 1 FROM dbo.tblQuotation WHERE LeadId=@Id AND CompId=@CompId)
    BEGIN SELECT 409 AS ResponseCode, 'This lead has quotations and cannot be deleted' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblPartnerCommission WHERE LeadId=@Id AND CompId=@CompId)  -- 107
    BEGIN SELECT 409 AS ResponseCode, 'This lead has partner commission, so it cannot be deleted' AS ResponseMess; RETURN; END  -- 107

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

-- VERIFY AFTER APPLY (TestCRM):
-- 1. Every lead proc keeps the creator ONLY while the lead has no owner (expect 13 rows, all
--    HasNew = 1 and BareArm = 0; sp_Dashboard also BlNew = 1):
--    SELECT o.name,
--           CASE WHEN m.definition LIKE '%(l.OwnerId = @UserId OR (l.OwnerId IS NULL AND l.CreatedBy = @UserId)%' THEN 1 ELSE 0 END AS HasNew,
--           CASE WHEN m.definition LIKE '%(bl.OwnerId = @UserId OR (bl.OwnerId IS NULL AND bl.CreatedBy = @UserId)%' THEN 1 ELSE 0 END AS BlNew,
--           CASE WHEN m.definition LIKE '% OR l.CreatedBy = @UserId%' OR m.definition LIKE '% OR bl.CreatedBy = @UserId%' THEN 1 ELSE 0 END AS BareArm
--    FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
--    WHERE o.name IN ('sp_FetchLeads','sp_RptPartners','sp_Dashboard','sp_FetchQuotations','sp_FetchFollowUps',
--          'sp_RptFunnel','sp_RptLost','sp_RptPipelineValue','sp_RptFollowUpCompliance','sp_RptActivity',
--          'sp_RptLeaderboard','sp_RptAging','sp_RptTransfers');
--    (ticket arms use the bt. alias — "OR bt.CreatedBy = @UserId" — and stay as they are)
-- 2. Tables / columns exist, and the six old procs are gone (expect 4 non-NULL ids/lengths, then 0 rows):
--    SELECT OBJECT_ID('dbo.tblPartner'), OBJECT_ID('dbo.tblPartnerCommission'),
--           COL_LENGTH('dbo.tblLeads','PartnerId'), COL_LENGTH('dbo.tblCompanySetting','CommissionDueOn');
--    SELECT name FROM sys.procedures WHERE name IN ('sp_FetchPartnerPicker','sp_SetLeadPartner','sp_FetchLeadPartner',
--           'sp_MarkCommissionDue','sp_MarkCommissionPaid','sp_SavePartnerSetting');
-- 3. Partner source and menus:
--    SELECT CompId, Value FROM tblLookup WHERE Kind = 'lead_source' AND Code = 'partner';
--    SELECT Id, ParentId, Description, Route, Module FROM tblMenu WHERE Route IN ('/sales/partners','/reports/partners');
-- 4. Setting round trip (the settings row carries CommissionDueOn; NULL leaves it as is; a bad value is a 400):
--    EXEC sp_FetchWorkSettings 1;                                  -- RS1 has CommissionDueOn
--    EXEC sp_SaveCompanySetting 1, 10, 120, 80, 1, NULL, 'bogus';  -- 400
-- 5. Commission round trip through sp_SaveLead + sp_SetCommissionStatus (inside BEGIN TRAN ... ROLLBACK).
--    Pick a converted lead and set its partner (SetPartner = 1) with 10 percent terms:
--    BEGIN TRAN;
--    DECLARE @lead INT = (SELECT TOP 1 l.Id FROM tblLeads l JOIN tblLookup s ON s.Id = l.StatusId WHERE s.Code = 'converted' AND l.CompId = 1);
--    DECLARE @branch INT = (SELECT BranchId FROM tblLeads WHERE Id = @lead);
--    DECLARE @name NVARCHAR(200) = (SELECT Name FROM tblLeads WHERE Id = @lead);
--    INSERT tblPartner (CompId, Name, CreatedBy) VALUES (1, N'Verify partner', 1);
--    DECLARE @p1 INT = SCOPE_IDENTITY();
--    INSERT tblPartner (CompId, Name, CreatedBy) VALUES (1, N'Verify partner 2', 1);
--    DECLARE @p2 INT = SCOPE_IDENTITY();
--    EXEC sp_SaveLead @Id = @lead, @CompId = 1, @BranchId = @branch, @UserId = 1, @Name = @name,
--         @SetPartner = 1, @PartnerId = @p1, @CommType = 'pct', @CommValue = 10, @SetTerms = 1;   -- 200
--    SELECT Status, Amount FROM tblPartnerCommission WHERE LeadId = @lead;   -- earned, 10% of WonValue (0.00 if WonValue is NULL)
--    DECLARE @cid NVARCHAR(20) = (SELECT CONCAT('[', MAX(Id), ']') FROM tblPartnerCommission WHERE LeadId = @lead);
--    EXEC sp_SetCommissionStatus 1, 1, @cid, 'due';                                  -- 200
--    EXEC sp_SetCommissionStatus 1, 1, @cid, 'paid', '2026-10-10', N'UTR1';          -- 200
--    EXEC sp_SetCommissionStatus 1, 1, @cid, 'paid', '2026-10-10', N'UTR1';          -- 409, not a second payment
--    EXEC sp_FetchLeadDetail 1, @lead;                                               -- last result set: the commission row
--    -- delete refusal (a lead with commission is never deleted):
--    EXEC sp_DeleteLead @Id = @lead, @CompId = 1;                                    -- 409 'This lead has partner commission, so it cannot be deleted'
--    -- re-convert never pays twice: leave 'converted' (paid row -> Reverted = 1), convert again (row restored):
--    DECLARE @other INT = (SELECT TOP 1 Id FROM tblLookup WHERE CompId = 1 AND Kind = 'lead_status' AND Code = 'open' AND IsActive = 1);
--    EXEC sp_SetLeadStatus @CompId = 1, @LeadId = @lead, @StatusId = @other, @UserId = 1;   -- 200
--    SELECT Status, Reverted FROM tblPartnerCommission WHERE LeadId = @lead;         -- one row: paid, 1
--    EXEC sp_ConvertLead @CompId = 1, @LeadId = @lead, @UserId = 1;                  -- 200
--    SELECT Status, Reverted FROM tblPartnerCommission WHERE LeadId = @lead;         -- exactly one row: paid, 0 (no new earned row)
--    -- the refusal below rolls back the whole test transaction (that is the cleanup), so it goes last:
--    EXEC sp_SaveLead @Id = @lead, @CompId = 1, @BranchId = @branch, @UserId = 1, @Name = @name,
--         @SetPartner = 1, @PartnerId = @p2, @SetTerms = 0;                          -- 409, already paid
--    IF @@TRANCOUNT > 0 ROLLBACK;
