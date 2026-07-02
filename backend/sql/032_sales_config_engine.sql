-- ============================================================
-- 032: Sales config engine (shared) — custom fields, pipelines,
-- and lookups. Multi-tenant (CompId), keyed by an Entity
-- discriminator ('lead' for this Sales spec; 'ticket' reserved
-- for the Complaints/Ticketing spec, which reuses this engine).
--
-- Tables created (Task 0.1 — config engine only):
--   tblCustomFieldDef    - per-company custom field definitions
--   tblCustomFieldValue  - typed EAV values per (entity row, field)
--   tblPipeline          - named stage sequence per entity
--   tblPipelineStage     - stages within a pipeline
--   tblLookup            - generic per-company lookup
--                          (lead_source | call_outcome | lost_reason | ...)
--
-- Tables added (Task 0.2 — sales core + ticket tables, appended
-- below):
--   tblLeads_new         - NEW generalized lead core (old tblLeads
--                          is untouched; Task 0.4 backfills + renames)
--   tblCall              - manual call log (+ TicketId, telephony seams)
--   tblLeadActivity      - lead timeline
--   tblTicket            - ticket core (Spec 2 — Complaints/Ticketing)
--   tblTicketActivity    - ticket timeline (Spec 2)
--   tblSLARule           - per-company priority -> SLA targets (Spec 2)
--   tblFollowUp          - altered: +SourceCallId
--
-- DDL only. Guarded/idempotent — safe to re-run. A human applies
-- this by hand; nothing in the app executes it automatically.
-- ============================================================
USE [eCRM+]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ------------------------------------------------------------
-- tblCustomFieldDef — definition of a configurable field for an entity.
-- Unique: (CompId, Entity, FieldKey)
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblCustomFieldDef') IS NULL
BEGIN
    CREATE TABLE dbo.tblCustomFieldDef (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompId      INT NOT NULL,
        Entity      VARCHAR(20) NOT NULL,
        FieldKey    VARCHAR(50) NOT NULL,
        Label       NVARCHAR(200) NOT NULL,
        Type        VARCHAR(20) NOT NULL,        -- text | number | date | dropdown | checkbox
        Options     NVARCHAR(MAX) NULL,           -- JSON array of choices (dropdown only)
        IsRequired  BIT NOT NULL DEFAULT 0,
        SortOrder   INT NOT NULL DEFAULT 0,
        IsActive    BIT NOT NULL DEFAULT 1,
        CreatedBy   INT NULL,
        CreatedAt   DATETIME NOT NULL DEFAULT GETDATE()
    );

    CREATE UNIQUE INDEX UQ_tblCustomFieldDef_CompId_Entity_FieldKey
        ON dbo.tblCustomFieldDef (CompId, Entity, FieldKey);
END
GO

-- ------------------------------------------------------------
-- tblCustomFieldValue — typed value per (entity row, field).
-- Exactly one Value* column is populated per row, chosen by the
-- field's Type (checkbox -> ValueNumber 0/1; dropdown -> ValueText).
-- Unique: (EntityId, FieldId). Plus a non-unique filter/join index.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblCustomFieldValue') IS NULL
BEGIN
    CREATE TABLE dbo.tblCustomFieldValue (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompId      INT NOT NULL,
        Entity      VARCHAR(20) NOT NULL,
        EntityId    INT NOT NULL,
        FieldId     INT NOT NULL,
        ValueText   NVARCHAR(MAX) NULL,
        ValueNumber DECIMAL(18,2) NULL,
        ValueDate   DATETIME NULL
    );

    CREATE UNIQUE INDEX UQ_tblCustomFieldValue_EntityId_FieldId
        ON dbo.tblCustomFieldValue (EntityId, FieldId);

    CREATE INDEX IX_tblCustomFieldValue_CompId_Entity_FieldId
        ON dbo.tblCustomFieldValue (CompId, Entity, FieldId);
END
GO

-- ------------------------------------------------------------
-- tblPipeline — a named stage sequence for an entity.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblPipeline') IS NULL
BEGIN
    CREATE TABLE dbo.tblPipeline (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompId      INT NOT NULL,
        Entity      VARCHAR(20) NOT NULL,
        Name        NVARCHAR(200) NOT NULL,
        IsDefault   BIT NOT NULL DEFAULT 0,
        IsActive    BIT NOT NULL DEFAULT 1,
        CreatedAt   DATETIME NOT NULL DEFAULT GETDATE()
    );
END
GO

-- ------------------------------------------------------------
-- tblPipelineStage — stages within a pipeline.
-- CompId is denormalized from tblPipeline so stage lookups can be
-- filtered by tenant without a join (spec §3.1 lists PipelineId as
-- the FK; the brief's "every table has CompId" constraint adds this).
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblPipelineStage') IS NULL
BEGIN
    CREATE TABLE dbo.tblPipelineStage (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompId      INT NOT NULL,
        PipelineId  INT NOT NULL,
        Name        NVARCHAR(200) NOT NULL,
        SortOrder   INT NOT NULL DEFAULT 0,
        StageType   VARCHAR(20) NOT NULL,        -- open | won | lost
        Color       NVARCHAR(20) NULL,
        IsActive    BIT NOT NULL DEFAULT 1
    );
END
GO

-- ------------------------------------------------------------
-- tblLookup — generic per-company lookup, replaces standalone
-- Source/Status tables.
-- Kind: lead_source | call_outcome | lost_reason
--       (Spec 2: ticket_category | priority | resolution)
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblLookup') IS NULL
BEGIN
    CREATE TABLE dbo.tblLookup (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompId      INT NOT NULL,
        Kind        VARCHAR(30) NOT NULL,
        Value       NVARCHAR(200) NOT NULL,
        SortOrder   INT NOT NULL DEFAULT 0,
        IsActive    BIT NOT NULL DEFAULT 1
    );
END
GO

-- ============================================================
-- Verification — run manually after applying:
-- After apply: expect 5 rows
-- SELECT name FROM sys.tables WHERE name IN
--  ('tblCustomFieldDef','tblCustomFieldValue','tblPipeline','tblPipelineStage','tblLookup');
-- ============================================================

-- ============================================================
-- Task 0.2: Sales core + ticket tables, appended to the same
-- batch as the Task 0.1 config engine above.
--
-- tblLeads_new is a NEW table, not a rebuild of the existing
-- tblLeads — the old tblLeads is untouched here. Task 0.4
-- backfills data from tblLeads into tblLeads_new, then renames it
-- into tblLeads's place.
--
-- Tables created:
--   tblLeads_new      - generalized lead core (Spec 1 §3.2)
--   tblCall           - manual call log, shared by leads + tickets
--                       (Spec 1 §3.2 + TicketId for Spec 2 §4)
--   tblLeadActivity   - lead timeline (Spec 1 §3.2)
--   tblTicket         - ticket core (Spec 2 §4)
--   tblTicketActivity - ticket timeline (Spec 2 §4)
--   tblSLARule        - per-company priority -> SLA targets (Spec 2 §4)
--
-- Plus: tblFollowUp +SourceCallId (nullable link to the call that
-- scheduled it, via sp_LogCall).
--
-- Same conventions as Task 0.1: guarded/idempotent, no DB-level FK
-- constraints (integrity enforced in SPs), DDL only.
-- ============================================================

-- ------------------------------------------------------------
-- tblLeads_new — generalized lead core. Industry-specific data
-- (Category/Brand/Model/etc.) lives in tblCustomFieldValue
-- (Entity='lead'), not here.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblLeads_new') IS NULL
BEGIN
    CREATE TABLE dbo.tblLeads_new (
        Id                INT IDENTITY(1,1) PRIMARY KEY,
        CompId            INT NOT NULL,
        BranchId          INT NOT NULL,
        Name              NVARCHAR(200) NOT NULL,
        MobileNo          VARCHAR(20) NULL,
        AltMobile         VARCHAR(20) NULL,
        Email             NVARCHAR(150) NULL,
        SourceId          INT NULL,             -- tblLookup (Kind=lead_source)
        PipelineId        INT NULL,
        StageId           INT NULL,
        OwnerId           INT NULL,             -- assigned user (was AssignTo)
        EstValue          DECIMAL(18,2) NULL,   -- neutral 'Budget'
        NextFollowupDate  DATETIME NULL,
        LostReasonId      INT NULL,             -- tblLookup (Kind=lost_reason); null unless lost
        WonAt             DATETIME NULL,
        LostAt            DATETIME NULL,
        CreatedBy         INT NULL,
        EditBy            INT NULL,
        CreatedAt         DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt         DATETIME NULL
    );

    CREATE INDEX IX_tblLeads_new_CompId_StageId
        ON dbo.tblLeads_new (CompId, StageId);
END
GO

-- ------------------------------------------------------------
-- tblCall — a logged call, against a lead OR a ticket (exactly
-- one of LeadId/TicketId is set; enforced in sp_LogCall, not
-- here since the repo keeps integrity in SPs). Telephony seams
-- (ExternalCallId/RecordingUrl/Provider) are nullable — no
-- telephony integration exists yet.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblCall') IS NULL
BEGIN
    CREATE TABLE dbo.tblCall (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        CompId          INT NOT NULL,
        LeadId          INT NULL,
        TicketId        INT NULL,             -- shared with Spec 2 (Complaints/Ticketing)
        UserId          INT NOT NULL,
        Direction       VARCHAR(5) NOT NULL,   -- out | in
        OutcomeId       INT NULL,              -- tblLookup (Kind=call_outcome)
        Notes           NVARCHAR(1000) NULL,
        Duration        INT NULL,              -- seconds; null until filled in
        CalledAt        DATETIME NOT NULL,
        ExternalCallId  NVARCHAR(100) NULL,    -- telephony seam
        RecordingUrl    NVARCHAR(500) NULL,    -- telephony seam
        Provider        VARCHAR(30) NULL,      -- telephony seam
        CreatedBy       INT NULL,
        EditBy          INT NULL,
        CreatedAt       DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt       DATETIME NULL
    );

    CREATE INDEX IX_tblCall_LeadId ON dbo.tblCall (LeadId);
    CREATE INDEX IX_tblCall_TicketId ON dbo.tblCall (TicketId);
END
GO

-- ------------------------------------------------------------
-- tblLeadActivity — unified chronological lead timeline. Every
-- state-changing lead action funnels through sp_LogLeadActivity.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblLeadActivity') IS NULL
BEGIN
    CREATE TABLE dbo.tblLeadActivity (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompId      INT NOT NULL,
        LeadId      INT NOT NULL,
        UserId      INT NOT NULL,
        Type        VARCHAR(30) NOT NULL,   -- created | stage_changed | call | followup | note | field_changed | assigned | won | lost
        Summary     NVARCHAR(500) NULL,
        MetaJSON    NVARCHAR(MAX) NULL,
        CreatedBy   INT NULL,
        EditBy      INT NULL,
        CreatedAt   DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt   DATETIME NULL
    );

    CREATE INDEX IX_tblLeadActivity_LeadId ON dbo.tblLeadActivity (LeadId);
END
GO

-- ------------------------------------------------------------
-- tblTicket — ticket core (Spec 2). Industry-specific data lives
-- in tblCustomFieldValue (Entity='ticket'), not here.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblTicket') IS NULL
BEGIN
    CREATE TABLE dbo.tblTicket (
        Id            INT IDENTITY(1,1) PRIMARY KEY,
        CompId        INT NOT NULL,
        BranchId      INT NOT NULL,
        TicketNo      VARCHAR(30) NOT NULL,   -- auto-generated per company, e.g. TKT-000123
        CustomerName  NVARCHAR(150) NULL,
        Contact       VARCHAR(50) NULL,
        Channel       VARCHAR(20) NULL,       -- phone | email | walk-in | web | other
        CategoryId    INT NULL,               -- tblLookup (Kind=ticket_category)
        Priority      INT NULL,               -- tblLookup (Kind=priority)
        PipelineId    INT NULL,
        StageId       INT NULL,
        AssignedTo    INT NULL,               -- user
        LinkedLeadId  INT NULL,               -- tblLeads_new.Id, optional
        SLADueAt      DATETIME NULL,          -- computed on create from priority
        ResolvedAt    DATETIME NULL,
        ClosedAt      DATETIME NULL,
        ResolutionId  INT NULL,               -- tblLookup (Kind=resolution)
        Description   NVARCHAR(MAX) NULL,
        CreatedBy     INT NULL,
        EditBy        INT NULL,
        CreatedAt     DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt     DATETIME NULL
    );

    CREATE UNIQUE INDEX UQ_tblTicket_CompId_TicketNo
        ON dbo.tblTicket (CompId, TicketNo);

    CREATE INDEX IX_tblTicket_CompId_StageId
        ON dbo.tblTicket (CompId, StageId);
END
GO

-- ------------------------------------------------------------
-- tblTicketActivity — unified chronological ticket timeline,
-- same pattern as tblLeadActivity. sp_LogTicketActivity is the
-- single writer.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblTicketActivity') IS NULL
BEGIN
    CREATE TABLE dbo.tblTicketActivity (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompId      INT NOT NULL,
        TicketId    INT NOT NULL,
        UserId      INT NOT NULL,
        Type        VARCHAR(30) NOT NULL,   -- created | stage_changed | assigned | call | note | field_changed | resolved | reopened | closed
        Summary     NVARCHAR(500) NULL,
        MetaJSON    NVARCHAR(MAX) NULL,
        CreatedBy   INT NULL,
        EditBy      INT NULL,
        CreatedAt   DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt   DATETIME NULL
    );

    CREATE INDEX IX_tblTicketActivity_TicketId ON dbo.tblTicketActivity (TicketId);
END
GO

-- ------------------------------------------------------------
-- tblSLARule — per-company priority -> response/resolution
-- targets. Breach is computed on read (SLADueAt < now AND
-- ResolvedAt IS NULL) — no background job.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.tblSLARule') IS NULL
BEGIN
    CREATE TABLE dbo.tblSLARule (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        CompId          INT NOT NULL,
        Priority        INT NOT NULL,       -- tblLookup (Kind=priority)
        ResponseMins    INT NULL,
        ResolutionMins  INT NULL,
        IsActive        BIT NOT NULL DEFAULT 1,
        CreatedBy       INT NULL,
        EditBy          INT NULL,
        CreatedAt       DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt       DATETIME NULL
    );

    CREATE UNIQUE INDEX UQ_tblSLARule_CompId_Priority
        ON dbo.tblSLARule (CompId, Priority);
END
GO

-- ------------------------------------------------------------
-- tblFollowUp — add the link back to the call that scheduled it
-- (sp_LogCall can create the call + follow-up in one action).
-- ------------------------------------------------------------
IF COL_LENGTH('tblFollowUp','SourceCallId') IS NULL
    ALTER TABLE tblFollowUp ADD SourceCallId INT NULL;
GO

-- ============================================================
-- Verification (Task 0.2) — run manually after applying:
-- After apply: expect 6 rows
-- SELECT name FROM sys.tables WHERE name IN
--  ('tblLeads_new','tblCall','tblLeadActivity','tblTicket','tblTicketActivity','tblSLARule');
-- After apply: non-null (column exists)
-- SELECT COL_LENGTH('tblFollowUp','SourceCallId');
-- ============================================================

-- ============================================================
-- Task 0.3: Lead activity logger + config-engine CRUD SPs,
-- appended to the same batch as Tasks 0.1/0.2 above.
--
-- Convention (matches 031_login_distinguishes_user_state.sql):
-- IF OBJECT_ID(..., 'P') IS NOT NULL DROP PROCEDURE ...; GO;
-- CREATE PROC ...  (not CREATE OR ALTER — this repo's existing
-- SP file drops + recreates, so this batch does the same).
--
-- Every SP filters/stamps @CompId (multi-tenant). Save/Delete SPs
-- validate required params and return ResponseCode 400 on bad
-- input; Fetch SPs trust @CompId (already scoped server-side from
-- the JWT by the controller) and skip redundant validation.
--
-- Fetch SPs embed ResponseCode/ResponseMess as columns on the
-- data rows themselves (single result set) — same style 031 uses
-- for its data + status columns together. sp_FetchPipelines is the
-- one exception: pipelines carry the status columns, stages are a
-- second plain result set (spec §6 allows either shape).
--
-- SPs added:
--   sp_LogLeadActivity   - INSERT into tblLeadActivity
--   sp_SaveCustomField   - upsert tblCustomFieldDef
--   sp_FetchCustomFields - list tblCustomFieldDef (IsActive=1, by SortOrder)
--   sp_DeleteCustomField - soft-delete if referenced by tblCustomFieldValue, else hard delete
--   sp_SavePipeline      - upsert tblPipeline; @IsDefault=1 clears siblings
--   sp_FetchPipelines    - tblPipeline rows + tblPipelineStage rows (2 result sets)
--   sp_SaveStage         - upsert tblPipelineStage
--   sp_DeleteStage       - soft-delete (IsActive=0)
--   sp_SaveLookup        - upsert tblLookup
--   sp_FetchLookups      - list tblLookup (IsActive=1, by SortOrder)
--   sp_DeleteLookup      - soft-delete (IsActive=0)
-- ============================================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ------------------------------------------------------------
-- sp_LogLeadActivity — single writer for the lead timeline.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_LogLeadActivity', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_LogLeadActivity;
GO

CREATE PROC dbo.sp_LogLeadActivity
    @CompId   INT,
    @LeadId   INT,
    @UserId   INT,
    @Type     VARCHAR(30),
    @Summary  NVARCHAR(500) = NULL,
    @MetaJSON NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT CAST(NULL AS INT) AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN
        SELECT CAST(NULL AS INT) AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess;
        RETURN;
    END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN
        SELECT CAST(NULL AS INT) AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess;
        RETURN;
    END
    IF @Type IS NULL OR LTRIM(RTRIM(@Type)) = ''
    BEGIN
        SELECT CAST(NULL AS INT) AS Id, 400 AS ResponseCode, 'Type is required' AS ResponseMess;
        RETURN;
    END

    INSERT INTO dbo.tblLeadActivity (CompId, LeadId, UserId, Type, Summary, MetaJSON, CreatedBy)
    VALUES (@CompId, @LeadId, @UserId, @Type, @Summary, @MetaJSON, @UserId);

    SELECT SCOPE_IDENTITY() AS Id, 200 AS ResponseCode, 'Activity logged successfully' AS ResponseMess;
END
GO

-- ------------------------------------------------------------
-- sp_SaveCustomField — @Id=0 insert / @Id>0 update tblCustomFieldDef.
-- Uniqueness on (CompId, Entity, FieldKey) checked explicitly for a
-- friendly 409 (table also has a unique index as the hard backstop).
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_SaveCustomField', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveCustomField;
GO

CREATE PROC dbo.sp_SaveCustomField
    @Id         INT,
    @CompId     INT,
    @Entity     VARCHAR(20),
    @FieldKey   VARCHAR(50),
    @Label      NVARCHAR(200),
    @Type       VARCHAR(20),
    @Options    NVARCHAR(MAX) = NULL,
    @IsRequired BIT = 0,
    @SortOrder  INT = 0,
    @CreatedBy  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @Entity IS NULL OR LTRIM(RTRIM(@Entity)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Entity is required' AS ResponseMess;
        RETURN;
    END
    IF @FieldKey IS NULL OR LTRIM(RTRIM(@FieldKey)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'FieldKey is required' AS ResponseMess;
        RETURN;
    END
    IF @Label IS NULL OR LTRIM(RTRIM(@Label)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Label is required' AS ResponseMess;
        RETURN;
    END
    IF @Type IS NULL OR @Type NOT IN ('text','number','date','dropdown','checkbox')
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Type must be text, number, date, dropdown, or checkbox' AS ResponseMess;
        RETURN;
    END

    IF @Id = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.tblCustomFieldDef WHERE CompId=@CompId AND Entity=@Entity AND FieldKey=@FieldKey)
        BEGIN
            SELECT 0 AS Id, 409 AS ResponseCode, 'A field with this key already exists for this entity' AS ResponseMess;
            RETURN;
        END

        INSERT INTO dbo.tblCustomFieldDef
            (CompId, Entity, FieldKey, Label, Type, Options, IsRequired, SortOrder, CreatedBy)
        VALUES
            (@CompId, @Entity, @FieldKey, @Label, @Type, @Options, ISNULL(@IsRequired,0), ISNULL(@SortOrder,0), @CreatedBy);

        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Custom field created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblCustomFieldDef WHERE Id=@Id AND CompId=@CompId)
        BEGIN
            SELECT @Id AS Id, 404 AS ResponseCode, 'Custom field not found' AS ResponseMess;
            RETURN;
        END

        IF EXISTS (SELECT 1 FROM dbo.tblCustomFieldDef WHERE CompId=@CompId AND Entity=@Entity AND FieldKey=@FieldKey AND Id<>@Id)
        BEGIN
            SELECT @Id AS Id, 409 AS ResponseCode, 'A field with this key already exists for this entity' AS ResponseMess;
            RETURN;
        END

        UPDATE dbo.tblCustomFieldDef
        SET Entity = @Entity, FieldKey = @FieldKey, Label = @Label, Type = @Type,
            Options = @Options, IsRequired = ISNULL(@IsRequired,0), SortOrder = ISNULL(@SortOrder,0)
        WHERE Id=@Id AND CompId=@CompId;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Custom field updated successfully' AS ResponseMess;
    END
END
GO

-- ------------------------------------------------------------
-- sp_FetchCustomFields — active fields for an entity, by SortOrder.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_FetchCustomFields', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchCustomFields;
GO

CREATE PROC dbo.sp_FetchCustomFields
    @CompId INT,
    @Entity VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, CompId, Entity, FieldKey, Label, Type, Options, IsRequired, SortOrder, IsActive, CreatedBy, CreatedAt,
           200 AS ResponseCode, 'Custom fields retrieved successfully' AS ResponseMess
    FROM dbo.tblCustomFieldDef
    WHERE CompId = @CompId AND Entity = @Entity AND IsActive = 1
    ORDER BY SortOrder;
END
GO

-- ------------------------------------------------------------
-- sp_DeleteCustomField — soft-delete (IsActive=0) if values exist
-- against this field, else hard delete.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_DeleteCustomField', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_DeleteCustomField;
GO

CREATE PROC dbo.sp_DeleteCustomField
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN
        SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblCustomFieldDef WHERE Id=@Id AND CompId=@CompId)
    BEGIN
        SELECT 404 AS ResponseCode, 'Custom field not found' AS ResponseMess;
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.tblCustomFieldValue WHERE FieldId=@Id)
    BEGIN
        UPDATE dbo.tblCustomFieldDef SET IsActive = 0 WHERE Id=@Id AND CompId=@CompId;
        SELECT 200 AS ResponseCode, 'Custom field deactivated (values exist)' AS ResponseMess;
    END
    ELSE
    BEGIN
        DELETE FROM dbo.tblCustomFieldDef WHERE Id=@Id AND CompId=@CompId;
        SELECT 200 AS ResponseCode, 'Custom field deleted successfully' AS ResponseMess;
    END
END
GO

-- ------------------------------------------------------------
-- sp_SavePipeline — @Id=0 insert / @Id>0 update tblPipeline.
-- @IsDefault=1 clears IsDefault on the company's other pipelines
-- for the same Entity (two statements -> wrapped in a transaction).
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_SavePipeline', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SavePipeline;
GO

CREATE PROC dbo.sp_SavePipeline
    @Id        INT,
    @CompId    INT,
    @Entity    VARCHAR(20),
    @Name      NVARCHAR(200),
    @IsDefault BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @Entity IS NULL OR LTRIM(RTRIM(@Entity)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Entity is required' AS ResponseMess;
        RETURN;
    END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF @Id = 0
        BEGIN
            INSERT INTO dbo.tblPipeline (CompId, Entity, Name, IsDefault)
            VALUES (@CompId, @Entity, @Name, ISNULL(@IsDefault,0));

            SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.tblPipeline WHERE Id=@Id AND CompId=@CompId)
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @Id AS Id, 404 AS ResponseCode, 'Pipeline not found' AS ResponseMess;
                RETURN;
            END

            UPDATE dbo.tblPipeline
            SET Name = @Name, IsDefault = ISNULL(@IsDefault,0)
            WHERE Id=@Id AND CompId=@CompId;
        END

        IF ISNULL(@IsDefault,0) = 1
        BEGIN
            UPDATE dbo.tblPipeline
            SET IsDefault = 0
            WHERE CompId=@CompId AND Entity=@Entity AND Id <> @Id;
        END

        COMMIT TRANSACTION;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Pipeline saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ------------------------------------------------------------
-- sp_FetchPipelines — pipelines (with status columns) then their
-- stages, as two result sets.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_FetchPipelines', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchPipelines;
GO

CREATE PROC dbo.sp_FetchPipelines
    @CompId INT,
    @Entity VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT p.Id, p.CompId, p.Entity, p.Name, p.IsDefault, p.IsActive, p.CreatedAt,
           200 AS ResponseCode, 'Pipelines retrieved successfully' AS ResponseMess
    FROM dbo.tblPipeline p
    WHERE p.CompId = @CompId AND p.Entity = @Entity AND p.IsActive = 1
    ORDER BY p.IsDefault DESC, p.Name;

    SELECT s.Id, s.CompId, s.PipelineId, s.Name, s.SortOrder, s.StageType, s.Color, s.IsActive
    FROM dbo.tblPipelineStage s
    INNER JOIN dbo.tblPipeline p ON p.Id = s.PipelineId
    WHERE p.CompId = @CompId AND p.Entity = @Entity AND p.IsActive = 1 AND s.IsActive = 1
    ORDER BY s.PipelineId, s.SortOrder;
END
GO

-- ------------------------------------------------------------
-- sp_SaveStage — @Id=0 insert / @Id>0 update tblPipelineStage.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_SaveStage', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveStage;
GO

CREATE PROC dbo.sp_SaveStage
    @Id         INT,
    @PipelineId INT,
    @CompId     INT,
    @Name       NVARCHAR(200),
    @SortOrder  INT = 0,
    @StageType  VARCHAR(20),
    @Color      NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @PipelineId IS NULL OR @PipelineId <= 0
       OR NOT EXISTS (SELECT 1 FROM dbo.tblPipeline WHERE Id=@PipelineId AND CompId=@CompId)
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Valid PipelineId is required' AS ResponseMess;
        RETURN;
    END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess;
        RETURN;
    END
    IF @StageType IS NULL OR @StageType NOT IN ('open','won','lost')
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'StageType must be open, won, or lost' AS ResponseMess;
        RETURN;
    END

    IF @Id = 0
    BEGIN
        INSERT INTO dbo.tblPipelineStage (CompId, PipelineId, Name, SortOrder, StageType, Color)
        VALUES (@CompId, @PipelineId, @Name, ISNULL(@SortOrder,0), @StageType, @Color);

        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Stage created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblPipelineStage WHERE Id=@Id AND CompId=@CompId)
        BEGIN
            SELECT @Id AS Id, 404 AS ResponseCode, 'Stage not found' AS ResponseMess;
            RETURN;
        END

        UPDATE dbo.tblPipelineStage
        SET PipelineId = @PipelineId, Name = @Name, SortOrder = ISNULL(@SortOrder,0),
            StageType = @StageType, Color = @Color
        WHERE Id=@Id AND CompId=@CompId;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Stage updated successfully' AS ResponseMess;
    END
END
GO

-- ------------------------------------------------------------
-- sp_DeleteStage — soft-delete (IsActive=0); leads/tickets may
-- still reference a stage by Id, same reasoning as sp_DeleteLookup.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_DeleteStage', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_DeleteStage;
GO

CREATE PROC dbo.sp_DeleteStage
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN
        SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblPipelineStage WHERE Id=@Id AND CompId=@CompId)
    BEGIN
        SELECT 404 AS ResponseCode, 'Stage not found' AS ResponseMess;
        RETURN;
    END

    UPDATE dbo.tblPipelineStage SET IsActive = 0 WHERE Id=@Id AND CompId=@CompId;

    SELECT 200 AS ResponseCode, 'Stage deleted successfully' AS ResponseMess;
END
GO

-- ------------------------------------------------------------
-- sp_SaveLookup — @Id=0 insert / @Id>0 update tblLookup.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_SaveLookup', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveLookup;
GO

CREATE PROC dbo.sp_SaveLookup
    @Id        INT,
    @CompId    INT,
    @Kind      VARCHAR(30),
    @Value     NVARCHAR(200),
    @SortOrder INT = 0
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @Kind IS NULL OR LTRIM(RTRIM(@Kind)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Kind is required' AS ResponseMess;
        RETURN;
    END
    IF @Value IS NULL OR LTRIM(RTRIM(@Value)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Value is required' AS ResponseMess;
        RETURN;
    END

    IF @Id = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.tblLookup WHERE CompId=@CompId AND Kind=@Kind AND Value=@Value AND IsActive=1)
        BEGIN
            SELECT 0 AS Id, 409 AS ResponseCode, 'A lookup with this value already exists' AS ResponseMess;
            RETURN;
        END

        INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder)
        VALUES (@CompId, @Kind, @Value, ISNULL(@SortOrder,0));

        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Lookup created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId)
        BEGIN
            SELECT @Id AS Id, 404 AS ResponseCode, 'Lookup not found' AS ResponseMess;
            RETURN;
        END

        UPDATE dbo.tblLookup
        SET Kind = @Kind, Value = @Value, SortOrder = ISNULL(@SortOrder,0)
        WHERE Id=@Id AND CompId=@CompId;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Lookup updated successfully' AS ResponseMess;
    END
END
GO

-- ------------------------------------------------------------
-- sp_FetchLookups — active lookups for a Kind, by SortOrder.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_FetchLookups', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchLookups;
GO

CREATE PROC dbo.sp_FetchLookups
    @CompId INT,
    @Kind   VARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, CompId, Kind, Value, SortOrder, IsActive,
           200 AS ResponseCode, 'Lookups retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup
    WHERE CompId = @CompId AND Kind = @Kind AND IsActive = 1
    ORDER BY SortOrder;
END
GO

-- ------------------------------------------------------------
-- sp_DeleteLookup — soft-delete (IsActive=0).
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_DeleteLookup', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_DeleteLookup;
GO

CREATE PROC dbo.sp_DeleteLookup
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN
        SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId)
    BEGIN
        SELECT 404 AS ResponseCode, 'Lookup not found' AS ResponseMess;
        RETURN;
    END

    UPDATE dbo.tblLookup SET IsActive = 0 WHERE Id=@Id AND CompId=@CompId;

    SELECT 200 AS ResponseCode, 'Lookup deleted successfully' AS ResponseMess;
END
GO

-- ============================================================
-- Verification (Task 0.3) — run manually after applying:
-- After apply: expect 11 rows
-- SELECT name FROM sys.procedures WHERE name IN
--  ('sp_LogLeadActivity','sp_SaveCustomField','sp_FetchCustomFields','sp_DeleteCustomField',
--   'sp_SavePipeline','sp_FetchPipelines','sp_SaveStage','sp_DeleteStage',
--   'sp_SaveLookup','sp_FetchLookups','sp_DeleteLookup');
--
-- Sample calls — insert a lookup, then fetch it back:
-- EXEC sp_SaveLookup @Id=0,@CompId=1,@Kind='lead_source',@Value='Website',@SortOrder=1;
-- EXEC sp_FetchLookups @CompId=1,@Kind='lead_source'; -- expect the row + ResponseCode 200
-- ============================================================
