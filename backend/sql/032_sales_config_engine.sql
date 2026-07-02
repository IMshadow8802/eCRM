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

-- Prevent duplicate active lookups + close the sp_SaveLookup TOCTOU race.
-- Filtered on IsActive=1 so soft-deleted rows can collide freely.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_tblLookup_CompId_Kind_Value')
    CREATE UNIQUE INDEX UQ_tblLookup_CompId_Kind_Value
        ON dbo.tblLookup (CompId, Kind, Value)
        WHERE IsActive = 1;
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

-- ============================================================
-- Task 0.4: Data migration — move existing product-sales lead
-- data into the generalized model, then rename tables.
--
-- Source schema (verified against the live SPs, NOT the stale
-- src/db/tables.sql reference which predates externally-applied
-- columns):
--   tblLeads      — HAS CompId (sp_SaveLead/sp_TransferLead insert
--                   & filter on it) + BranchId, CustomerName,
--                   MobileNo, AlternateMobile, Email, Address,
--                   LeadSource (varchar NAME, not FK), ProductCategory,
--                   ProductBrand, ProductModel, Budget, LeadStatus
--                   (varchar NAME, not FK), FollowupDate, Remarks,
--                   AssignTo, AssignedDate, InvoiceDate, InvoiceNo,
--                   LeadDate, CreatedBy, CreatedDate, EditBy, EditDate.
--   tblLeadSource — GLOBAL master (SourceId, SourceName). No CompId.
--   tblStatus     — GLOBAL master (StatusId, StatusName). No CompId,
--                   no SortOrder → ordered by StatusId.
--
-- Because Source/Status are global but the new tables are per-company,
-- they are fanned out to every company that has leads. Leads store
-- source/status as NAMES, so they map by name (not by old id).
--
-- Idempotent: guarded by OBJECT_ID('tblLeads_old') — after a clean run
-- the old table is renamed to tblLeads_old, so a re-run is a no-op.
-- Every seed insert is additionally NOT EXISTS-guarded. Whole thing
-- runs in one transaction (single batch — no GO — so the tran and the
-- #temp maps stay in scope) with TRY/CATCH ROLLBACK.
-- ============================================================
IF OBJECT_ID(N'dbo.tblLeads_old') IS NOT NULL
BEGIN
    PRINT 'Task 0.4: tblLeads_old already exists — migration already applied, skipping.';
END
ELSE
BEGIN
    BEGIN TRY
        BEGIN TRAN;

        -- ---- Step 1: default pipeline (IsDefault=1, Entity='lead') per company ----
        INSERT INTO dbo.tblPipeline (CompId, Entity, Name, IsDefault)
        SELECT c.CompId, 'lead', 'Default Sales Pipeline', 1
        FROM (SELECT DISTINCT CompId FROM dbo.tblLeads WHERE CompId IS NOT NULL) c
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.tblPipeline p
            WHERE p.CompId = c.CompId AND p.Entity = 'lead' AND p.IsDefault = 1
        );

        -- ---- Step 1b: stages from the (global) tblStatus master, per default pipeline ----
        -- SortOrder follows StatusId (no SortOrder col on tblStatus).
        -- StageType heuristic: name ~ won|convert -> won; ~ lost|dead -> lost; else open.
        -- (default collation is case-insensitive, so LIKE matches regardless of case.)
        INSERT INTO dbo.tblPipelineStage (CompId, PipelineId, Name, SortOrder, StageType)
        SELECT p.CompId, p.Id, LTRIM(RTRIM(s.StatusName)),
               ROW_NUMBER() OVER (PARTITION BY p.Id ORDER BY s.StatusId) - 1 AS SortOrder,
               CASE
                   WHEN s.StatusName LIKE '%won%' OR s.StatusName LIKE '%convert%' THEN 'won'
                   WHEN s.StatusName LIKE '%lost%' OR s.StatusName LIKE '%dead%'    THEN 'lost'
                   ELSE 'open'
               END AS StageType
        FROM dbo.tblPipeline p
        CROSS JOIN dbo.tblStatus s
        WHERE p.Entity = 'lead' AND p.IsDefault = 1
          AND s.StatusName IS NOT NULL AND LTRIM(RTRIM(s.StatusName)) <> ''
          AND NOT EXISTS (SELECT 1 FROM dbo.tblPipelineStage st WHERE st.PipelineId = p.Id);

        -- "first stage open if none matched": guarantee every pipeline has an
        -- 'open' stage — if all stages matched won/lost, force the first to open.
        UPDATE st
        SET StageType = 'open'
        FROM dbo.tblPipelineStage st
        WHERE st.SortOrder = (SELECT MIN(s2.SortOrder) FROM dbo.tblPipelineStage s2 WHERE s2.PipelineId = st.PipelineId)
          AND NOT EXISTS (SELECT 1 FROM dbo.tblPipelineStage s3 WHERE s3.PipelineId = st.PipelineId AND s3.StageType = 'open');

        -- ---- Step 2: lead_source lookups from (global) tblLeadSource, fanned per company ----
        INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder)
        SELECT c.CompId, 'lead_source', src.SourceName,
               ROW_NUMBER() OVER (PARTITION BY c.CompId ORDER BY src.SourceId) - 1
        FROM (SELECT DISTINCT CompId FROM dbo.tblLeads WHERE CompId IS NOT NULL) c
        CROSS JOIN dbo.tblLeadSource src
        WHERE src.SourceName IS NOT NULL AND LTRIM(RTRIM(src.SourceName)) <> ''
          AND NOT EXISTS (
              SELECT 1 FROM dbo.tblLookup lk
              WHERE lk.CompId = c.CompId AND lk.Kind = 'lead_source' AND lk.Value = src.SourceName
          );

        -- old->new id map (per brief): keyed by (CompId, OldSourceId).
        -- Value is carried too so Step 4 can resolve the lead's source NAME.
        -- Dedup on (CompId, Value): duplicate SourceNames in the global
        -- tblLeadSource master would otherwise multiply lead rows in Step 4's
        -- LEFT JOIN. One lookup id per (CompId, Value) — MIN is arbitrary but
        -- stable (all dupes resolve to the same new lookup anyway).
        CREATE TABLE #SourceMap (CompId INT, OldSourceId INT, NewLookupId INT, Value NVARCHAR(200));
        INSERT INTO #SourceMap (CompId, OldSourceId, NewLookupId, Value)
        SELECT lk.CompId, MIN(src.SourceId), MIN(lk.Id), lk.Value
        FROM dbo.tblLookup lk
        JOIN dbo.tblLeadSource src ON src.SourceName = lk.Value
        WHERE lk.Kind = 'lead_source'
        GROUP BY lk.CompId, lk.Value;

        -- ---- Step 3: seed product custom-field defs (Entity='lead') per company ----
        INSERT INTO dbo.tblCustomFieldDef (CompId, Entity, FieldKey, Label, Type, SortOrder)
        SELECT c.CompId, 'lead', f.FieldKey, f.Label, f.Type, f.SortOrder
        FROM (SELECT DISTINCT CompId FROM dbo.tblLeads WHERE CompId IS NOT NULL) c
        CROSS JOIN (VALUES
            ('category',     'Category',     'dropdown', 0),
            ('brand',        'Brand',        'text',     1),
            ('model',        'Model',        'text',     2),
            ('budget',       'Budget',       'number',   3),
            ('invoice_no',   'Invoice No',   'text',     4),
            ('invoice_date', 'Invoice Date', 'date',     5),
            ('remarks',      'Remarks',      'text',     6),
            ('address',      'Address',      'text',     7)
        ) f(FieldKey, Label, Type, SortOrder)
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.tblCustomFieldDef d
            WHERE d.CompId = c.CompId AND d.Entity = 'lead' AND d.FieldKey = f.FieldKey
        );
        -- ponytail: 'category' dropdown seeded with Options=NULL. The backfilled
        -- ValueText carries the real category regardless; populate Options from the
        -- distinct values via the config UI (sp_SaveCustomField) if picker choices
        -- are needed for NEW leads.

        -- ---- Step 4: populate tblLeads_new; capture old->new lead id map ----
        -- MERGE (not INSERT..SELECT) so OUTPUT can emit the source lead Id
        -- alongside the new IDENTITY. ON 1=0 => every row is "not matched" => insert.
        CREATE TABLE #LeadMap (OldLeadId INT, NewLeadId INT);

        MERGE dbo.tblLeads_new AS tgt
        USING (
            SELECT l.Id AS OldId, l.CompId, l.BranchId,
                   ISNULL(NULLIF(LTRIM(RTRIM(l.CustomerName)), ''), '(no name)') AS Name,
                   l.MobileNo, l.AlternateMobile AS AltMobile, l.Email,
                   sm.NewLookupId AS SourceId,
                   p.Id AS PipelineId,
                   stg.Id AS StageId,
                   l.AssignTo AS OwnerId,
                   l.Budget AS EstValue,
                   l.FollowupDate AS NextFollowupDate,
                   l.CreatedBy, l.EditBy,
                   ISNULL(l.CreatedDate, ISNULL(l.LeadDate, GETDATE())) AS CreatedAt,
                   l.EditDate AS UpdatedAt
            FROM dbo.tblLeads l
            LEFT JOIN #SourceMap sm
                   ON sm.CompId = l.CompId AND sm.Value = LTRIM(RTRIM(l.LeadSource))
            LEFT JOIN dbo.tblPipeline p
                   ON p.CompId = l.CompId AND p.Entity = 'lead' AND p.IsDefault = 1
            LEFT JOIN dbo.tblPipelineStage stg
                   ON stg.PipelineId = p.Id AND LTRIM(RTRIM(stg.Name)) = LTRIM(RTRIM(l.LeadStatus))
        ) AS src
        ON 1 = 0
        WHEN NOT MATCHED THEN
            INSERT (CompId, BranchId, Name, MobileNo, AltMobile, Email, SourceId,
                    PipelineId, StageId, OwnerId, EstValue, NextFollowupDate,
                    CreatedBy, EditBy, CreatedAt, UpdatedAt)
            VALUES (src.CompId, src.BranchId, src.Name, src.MobileNo, src.AltMobile, src.Email, src.SourceId,
                    src.PipelineId, src.StageId, src.OwnerId, src.EstValue, src.NextFollowupDate,
                    src.CreatedBy, src.EditBy, src.CreatedAt, src.UpdatedAt)
        OUTPUT src.OldId, inserted.Id INTO #LeadMap (OldLeadId, NewLeadId);

        -- ---- Step 5: backfill tblCustomFieldValue from old product columns ----
        -- Text fields: category / brand / model / invoice_no -> ValueText
        INSERT INTO dbo.tblCustomFieldValue (CompId, Entity, EntityId, FieldId, ValueText)
        SELECT l.CompId, 'lead', m.NewLeadId, d.Id, LTRIM(RTRIM(l.ProductCategory))
        FROM dbo.tblLeads l
        JOIN #LeadMap m ON m.OldLeadId = l.Id
        JOIN dbo.tblCustomFieldDef d ON d.CompId = l.CompId AND d.Entity = 'lead' AND d.FieldKey = 'category'
        WHERE l.ProductCategory IS NOT NULL AND LTRIM(RTRIM(l.ProductCategory)) <> '';

        INSERT INTO dbo.tblCustomFieldValue (CompId, Entity, EntityId, FieldId, ValueText)
        SELECT l.CompId, 'lead', m.NewLeadId, d.Id, LTRIM(RTRIM(l.ProductBrand))
        FROM dbo.tblLeads l
        JOIN #LeadMap m ON m.OldLeadId = l.Id
        JOIN dbo.tblCustomFieldDef d ON d.CompId = l.CompId AND d.Entity = 'lead' AND d.FieldKey = 'brand'
        WHERE l.ProductBrand IS NOT NULL AND LTRIM(RTRIM(l.ProductBrand)) <> '';

        INSERT INTO dbo.tblCustomFieldValue (CompId, Entity, EntityId, FieldId, ValueText)
        SELECT l.CompId, 'lead', m.NewLeadId, d.Id, LTRIM(RTRIM(l.ProductModel))
        FROM dbo.tblLeads l
        JOIN #LeadMap m ON m.OldLeadId = l.Id
        JOIN dbo.tblCustomFieldDef d ON d.CompId = l.CompId AND d.Entity = 'lead' AND d.FieldKey = 'model'
        WHERE l.ProductModel IS NOT NULL AND LTRIM(RTRIM(l.ProductModel)) <> '';

        INSERT INTO dbo.tblCustomFieldValue (CompId, Entity, EntityId, FieldId, ValueText)
        SELECT l.CompId, 'lead', m.NewLeadId, d.Id, LTRIM(RTRIM(l.InvoiceNo))
        FROM dbo.tblLeads l
        JOIN #LeadMap m ON m.OldLeadId = l.Id
        JOIN dbo.tblCustomFieldDef d ON d.CompId = l.CompId AND d.Entity = 'lead' AND d.FieldKey = 'invoice_no'
        WHERE l.InvoiceNo IS NOT NULL AND LTRIM(RTRIM(l.InvoiceNo)) <> '';

        -- Free-text sales notes preserved as custom fields (no core column).
        INSERT INTO dbo.tblCustomFieldValue (CompId, Entity, EntityId, FieldId, ValueText)
        SELECT l.CompId, 'lead', m.NewLeadId, d.Id, LTRIM(RTRIM(l.Remarks))
        FROM dbo.tblLeads l
        JOIN #LeadMap m ON m.OldLeadId = l.Id
        JOIN dbo.tblCustomFieldDef d ON d.CompId = l.CompId AND d.Entity = 'lead' AND d.FieldKey = 'remarks'
        WHERE l.Remarks IS NOT NULL AND LTRIM(RTRIM(l.Remarks)) <> '';

        INSERT INTO dbo.tblCustomFieldValue (CompId, Entity, EntityId, FieldId, ValueText)
        SELECT l.CompId, 'lead', m.NewLeadId, d.Id, LTRIM(RTRIM(l.Address))
        FROM dbo.tblLeads l
        JOIN #LeadMap m ON m.OldLeadId = l.Id
        JOIN dbo.tblCustomFieldDef d ON d.CompId = l.CompId AND d.Entity = 'lead' AND d.FieldKey = 'address'
        WHERE l.Address IS NOT NULL AND LTRIM(RTRIM(l.Address)) <> '';

        -- Number field: budget -> ValueNumber (also kept on core EstValue, per brief)
        INSERT INTO dbo.tblCustomFieldValue (CompId, Entity, EntityId, FieldId, ValueNumber)
        SELECT l.CompId, 'lead', m.NewLeadId, d.Id, l.Budget
        FROM dbo.tblLeads l
        JOIN #LeadMap m ON m.OldLeadId = l.Id
        JOIN dbo.tblCustomFieldDef d ON d.CompId = l.CompId AND d.Entity = 'lead' AND d.FieldKey = 'budget'
        WHERE l.Budget IS NOT NULL;

        -- Date field: invoice_date -> ValueDate
        INSERT INTO dbo.tblCustomFieldValue (CompId, Entity, EntityId, FieldId, ValueDate)
        SELECT l.CompId, 'lead', m.NewLeadId, d.Id, l.InvoiceDate
        FROM dbo.tblLeads l
        JOIN #LeadMap m ON m.OldLeadId = l.Id
        JOIN dbo.tblCustomFieldDef d ON d.CompId = l.CompId AND d.Entity = 'lead' AND d.FieldKey = 'invoice_date'
        WHERE l.InvoiceDate IS NOT NULL;

        -- ---- Step 6: swap tables into place ----
        EXEC sp_rename 'dbo.tblLeads',     'tblLeads_old';
        EXEC sp_rename 'dbo.tblLeads_new', 'tblLeads';

        DROP TABLE #SourceMap;
        DROP TABLE #LeadMap;

        COMMIT TRAN;
        PRINT 'Task 0.4: leads migration committed.';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        PRINT 'Task 0.4: migration FAILED and was rolled back.';
        THROW;
    END CATCH
END
GO

-- ============================================================
-- Verification (Task 0.4) — run manually after applying:
--
-- 1) Old vs new lead counts must be equal:
-- SELECT (SELECT COUNT(*) FROM tblLeads_old) AS old,
--        (SELECT COUNT(*) FROM tblLeads)     AS new;  -- expect equal
--
-- 2) Sample migrated leads (Name/StageId/SourceId resolved):
-- SELECT TOP 5 l.Id, l.Name, l.StageId, l.SourceId FROM tblLeads l;
--
-- 3) Custom-field values were backfilled:
-- SELECT COUNT(*) FROM tblCustomFieldValue WHERE Entity = 'lead';  -- expect > 0
--
-- Optional sanity:
-- SELECT p.CompId, COUNT(*) AS Stages FROM tblPipelineStage s
--   JOIN tblPipeline p ON p.Id=s.PipelineId WHERE p.Entity='lead' GROUP BY p.CompId;
-- SELECT COUNT(*) FROM tblLeads WHERE StageId IS NULL;  -- leads whose status
--   -- name didn't match any stage (free-text statuses); investigate if high.
-- ============================================================

-- ============================================================
-- Task 0.5: Lead / call / follow-up / report SPs, appended to
-- the same batch as Tasks 0.1-0.4 above. Lead SPs target the
-- POST-MIGRATION tblLeads (the tblLeads_new shape, renamed into
-- place by Task 0.4).
--
-- Conventions (same as Task 0.3):
--  - DROP + CREATE PROC guard; every read/write filters/stamps @CompId.
--  - Mutating SPs validate required params -> ResponseCode 400.
--  - sp_SaveLead and sp_LogCall wrap their multi-table writes in
--    BEGIN TRAN / TRY-CATCH.
--  - Activity is written ONLY through sp_LogLeadActivity (Task 0.3).
--    That SP emits its own status result set; callers swallow it with
--    `INSERT INTO @actLog EXEC ...` so the caller's own final SELECT
--    (Id + ResponseCode/ResponseMess) stays the single meaningful
--    result set the controller reads.
--
-- Custom-value upsert (sp_SaveLead): @CustomJSON is a JSON array of
-- {fieldId,type,value}. OPENJSON shreds it; a CASE on `type` routes
-- each value to the correct typed column (text/dropdown -> ValueText,
-- number/checkbox -> ValueNumber, date -> ValueDate); MERGE on
-- (EntityId,FieldId) inserts-or-updates one row per field.
--
-- SPs added:
--   sp_SaveLead        - upsert lead core + custom values + activity (tx)
--   sp_FetchLeads      - paged list (rows + pagination result sets)
--   sp_FetchLeadDetail - 3 result sets: core / custom values / timeline
--   sp_MoveLeadStage   - stage change with won/lost rules + activity (tx)
--   sp_TransferLead    - reassign owner + 'assigned' activity
--   sp_DeleteLead      - hard delete (tenant-scoped)
--   sp_LogCall         - insert call (+ optional follow-up) + activity (tx)
--   sp_FetchCalls      - by lead or by user
--   sp_FetchLeadActivity - timeline, newest first
--   sp_PipelineFunnel  - lead count per stage (by SortOrder)
--   sp_CallsPerUser    - call count per user in a date window
--   sp_ConversionBySource - per source: total leads + won count
-- ============================================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ------------------------------------------------------------
-- sp_SaveLead — @Id=0 insert / @Id>0 update the lead core, then
-- MERGE @CustomJSON into tblCustomFieldValue, then log activity.
-- All in one transaction. Returns the lead Id.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_SaveLead', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveLead;
GO

CREATE PROC dbo.sp_SaveLead
    @Id               INT,
    @CompId           INT,
    @BranchId         INT,
    @Name             NVARCHAR(200),
    @MobileNo         VARCHAR(20)   = NULL,
    @AltMobile        VARCHAR(20)   = NULL,
    @Email            NVARCHAR(150) = NULL,
    @SourceId         INT           = NULL,
    @PipelineId       INT           = NULL,
    @StageId          INT           = NULL,
    @OwnerId          INT           = NULL,
    @EstValue         DECIMAL(18,2) = NULL,
    @NextFollowupDate DATETIME      = NULL,
    @CustomJSON       NVARCHAR(MAX) = NULL,
    @UserId           INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess;
        RETURN;
    END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess;
        RETURN;
    END
    IF @CustomJSON IS NOT NULL AND ISJSON(@CustomJSON) = 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CustomJSON is not valid JSON' AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @IsInsert BIT = CASE WHEN ISNULL(@Id,0) = 0 THEN 1 ELSE 0 END;

        IF @IsInsert = 1
        BEGIN
            INSERT INTO dbo.tblLeads
                (CompId, BranchId, Name, MobileNo, AltMobile, Email, SourceId,
                 PipelineId, StageId, OwnerId, EstValue, NextFollowupDate, CreatedBy)
            VALUES
                (@CompId, ISNULL(@BranchId,1), @Name, @MobileNo, @AltMobile, @Email, @SourceId,
                 @PipelineId, @StageId, @OwnerId, @EstValue, @NextFollowupDate, @UserId);

            SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @Id AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess;
                RETURN;
            END

            UPDATE dbo.tblLeads
            SET Name = @Name, MobileNo = @MobileNo, AltMobile = @AltMobile, Email = @Email,
                SourceId = @SourceId, PipelineId = @PipelineId, StageId = @StageId,
                OwnerId = @OwnerId, EstValue = @EstValue, NextFollowupDate = @NextFollowupDate,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id=@Id AND CompId=@CompId;
        END

        -- Custom values: MERGE one row per {fieldId,type,value}. Typed column
        -- chosen by `type`; the other two columns are set NULL so a field that
        -- changed type doesn't leave a stale value behind.
        IF @CustomJSON IS NOT NULL
        BEGIN
            MERGE dbo.tblCustomFieldValue AS tgt
            USING (
                SELECT j.fieldId AS FieldId,
                       CASE WHEN j.type IN ('text','dropdown') THEN j.value END AS ValueText,
                       CASE WHEN j.type IN ('number','checkbox') THEN TRY_CAST(j.value AS DECIMAL(18,2)) END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CAST(j.value AS DATETIME) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                WITH (
                    fieldId INT           '$.fieldId',
                    type    VARCHAR(20)    '$.type',
                    value   NVARCHAR(MAX)  '$.value'
                ) j
                WHERE j.fieldId IS NOT NULL
            ) AS src
            ON tgt.EntityId = @Id AND tgt.FieldId = src.FieldId AND tgt.Entity = 'lead'
            WHEN MATCHED THEN
                UPDATE SET ValueText = src.ValueText, ValueNumber = src.ValueNumber, ValueDate = src.ValueDate
            WHEN NOT MATCHED THEN
                INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                VALUES (@CompId, 'lead', @Id, src.FieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId  = @CompId,
            @LeadId  = @Id,
            @UserId  = @UserId,
            @Type    = CASE WHEN @IsInsert = 1 THEN 'created' ELSE 'field_changed' END,
            @Summary = CASE WHEN @IsInsert = 1 THEN 'Lead created' ELSE 'Lead details updated' END;

        COMMIT TRANSACTION;

        SELECT @Id AS Id, 200 AS ResponseCode,
               CASE WHEN @IsInsert = 1 THEN 'Lead created successfully' ELSE 'Lead updated successfully' END AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ------------------------------------------------------------
-- sp_FetchLeads — paged list, tenant-scoped. Optional filters
-- (@StageId/@OwnerId/@SourceId) apply only when non-null;
-- @SearchTerm LIKEs Name/MobileNo/Email. Result set 1 = rows,
-- result set 2 = pagination row.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_FetchLeads', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchLeads;
GO

CREATE PROC dbo.sp_FetchLeads
    @CompId     INT,
    @BranchId   INT           = NULL,
    @PageNumber INT           = 1,
    @PageSize   INT           = 10,
    @SearchTerm NVARCHAR(200) = NULL,
    @StageId    INT           = NULL,
    @OwnerId    INT           = NULL,
    @SourceId   INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,10) < 1 THEN 10 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;

    DECLARE @Total INT;
    SELECT @Total = COUNT(*)
    FROM dbo.tblLeads l
    WHERE l.CompId = @CompId
      AND (@BranchId IS NULL OR l.BranchId = @BranchId)
      AND (@StageId  IS NULL OR l.StageId  = @StageId)
      AND (@OwnerId  IS NULL OR l.OwnerId  = @OwnerId)
      AND (@SourceId IS NULL OR l.SourceId = @SourceId)
      AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                              OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                              OR l.Email LIKE '%' + @SearchTerm + '%');

    -- Result set 1: page of leads
    SELECT l.Id, l.CompId, l.BranchId, l.Name, l.MobileNo, l.AltMobile, l.Email,
           l.SourceId, l.PipelineId, l.StageId, l.OwnerId, l.EstValue,
           l.NextFollowupDate, l.LostReasonId, l.WonAt, l.LostAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           200 AS ResponseCode, 'Leads retrieved successfully' AS ResponseMess
    FROM dbo.tblLeads l
    WHERE l.CompId = @CompId
      AND (@BranchId IS NULL OR l.BranchId = @BranchId)
      AND (@StageId  IS NULL OR l.StageId  = @StageId)
      AND (@OwnerId  IS NULL OR l.OwnerId  = @OwnerId)
      AND (@SourceId IS NULL OR l.SourceId = @SourceId)
      AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                              OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                              OR l.Email LIKE '%' + @SearchTerm + '%')
    ORDER BY l.CreatedAt DESC, l.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 2: pagination
    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;
END
GO

-- ------------------------------------------------------------
-- sp_FetchLeadDetail — 3 result sets:
--   1) lead core row
--   2) custom values joined to their def (label/type + typed value)
--   3) activity timeline, newest first
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_FetchLeadDetail', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchLeadDetail;
GO

CREATE PROC dbo.sp_FetchLeadDetail
    @CompId INT,
    @LeadId INT
AS
BEGIN
    SET NOCOUNT ON;

    -- 1) core
    SELECT l.Id, l.CompId, l.BranchId, l.Name, l.MobileNo, l.AltMobile, l.Email,
           l.SourceId, l.PipelineId, l.StageId, l.OwnerId, l.EstValue,
           l.NextFollowupDate, l.LostReasonId, l.WonAt, l.LostAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           200 AS ResponseCode, 'Lead detail retrieved successfully' AS ResponseMess
    FROM dbo.tblLeads l
    WHERE l.Id = @LeadId AND l.CompId = @CompId;

    -- 2) custom values (only fields that have a value row)
    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type,
           v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId = @CompId AND v.Entity = 'lead' AND v.EntityId = @LeadId
    ORDER BY d.SortOrder;

    -- 3) timeline
    SELECT a.Id, a.LeadId, a.UserId, a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblLeadActivity a
    WHERE a.CompId = @CompId AND a.LeadId = @LeadId
    ORDER BY a.CreatedAt DESC, a.Id DESC;
END
GO

-- ------------------------------------------------------------
-- sp_MoveLeadStage — move a lead to @StageId. Behaviour depends on
-- the target stage's StageType (won | lost | open):
--   won  -> stamp WonAt, log 'won'
--   lost -> REQUIRE @LostReasonId (else 400, no change);
--           stamp LostAt + set LostReasonId, log 'lost'
--   else -> log 'stage_changed'
-- StageId is always updated. Transaction-wrapped.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_MoveLeadStage', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_MoveLeadStage;
GO

CREATE PROC dbo.sp_MoveLeadStage
    @CompId       INT,
    @LeadId       INT,
    @StageId      INT,
    @LostReasonId INT = NULL,
    @UserId       INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess;
        RETURN;
    END
    IF @StageId IS NULL OR @StageId <= 0
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'StageId is required' AS ResponseMess;
        RETURN;
    END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId)
    BEGIN
        SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess;
        RETURN;
    END

    DECLARE @StageType VARCHAR(20) =
        (SELECT StageType FROM dbo.tblPipelineStage WHERE Id=@StageId AND CompId=@CompId);

    IF @StageType IS NULL
    BEGIN
        SELECT @LeadId AS Id, 404 AS ResponseCode, 'Stage not found' AS ResponseMess;
        RETURN;
    END

    -- lost requires a reason; reject BEFORE any write.
    IF @StageType = 'lost' AND (@LostReasonId IS NULL OR @LostReasonId <= 0)
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'Lost reason required' AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @ActType VARCHAR(30);

        -- Each branch clears the stamps it doesn't own, so a lead reopened
        -- OUT of a won/lost stage stops counting as converted/lost.
        IF @StageType = 'won'
        BEGIN
            UPDATE dbo.tblLeads
            SET StageId = @StageId, WonAt = GETDATE(),
                LostAt = NULL, LostReasonId = NULL,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id=@LeadId AND CompId=@CompId;
            SET @ActType = 'won';
        END
        ELSE IF @StageType = 'lost'
        BEGIN
            UPDATE dbo.tblLeads
            SET StageId = @StageId, LostAt = GETDATE(), LostReasonId = @LostReasonId,
                WonAt = NULL,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id=@LeadId AND CompId=@CompId;
            SET @ActType = 'lost';
        END
        ELSE
        BEGIN
            UPDATE dbo.tblLeads
            SET StageId = @StageId,
                WonAt = NULL, LostAt = NULL, LostReasonId = NULL,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id=@LeadId AND CompId=@CompId;
            SET @ActType = 'stage_changed';
        END

        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId  = @CompId,
            @LeadId  = @LeadId,
            @UserId  = @UserId,
            @Type    = @ActType,
            @Summary = @ActType,
            @MetaJSON = NULL;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead stage updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ------------------------------------------------------------
-- sp_TransferLead — reassign the lead owner + log 'assigned'.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_TransferLead', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_TransferLead;
GO

CREATE PROC dbo.sp_TransferLead
    @CompId  INT,
    @LeadId  INT,
    @OwnerId INT,
    @UserId  INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess;
        RETURN;
    END
    IF @OwnerId IS NULL OR @OwnerId <= 0
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'OwnerId is required' AS ResponseMess;
        RETURN;
    END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN
        SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId)
    BEGIN
        SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblLeads
        SET OwnerId = @OwnerId, EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id=@LeadId AND CompId=@CompId;

        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId  = @CompId,
            @LeadId  = @LeadId,
            @UserId  = @UserId,
            @Type    = 'assigned',
            @Summary = 'Lead reassigned';

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead transferred successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ------------------------------------------------------------
-- sp_DeleteLead — hard delete, tenant-scoped.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_DeleteLead', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_DeleteLead;
GO

CREATE PROC dbo.sp_DeleteLead
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
    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
    BEGIN
        SELECT 404 AS ResponseCode, 'Lead not found' AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Cascade: no DB-level FKs (integrity lives in SPs), so clear child
        -- rows explicitly, else they orphan against a reused IDENTITY.
        DELETE FROM dbo.tblCustomFieldValue WHERE Entity='lead' AND EntityId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblCall            WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeadActivity    WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblFollowUp        WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeads           WHERE Id=@Id AND CompId=@CompId;

        COMMIT TRANSACTION;

        SELECT 200 AS ResponseCode, 'Lead deleted successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ------------------------------------------------------------
-- sp_LogCall — insert a call; if @NextFollowupDate is supplied,
-- insert a linked tblFollowUp (SourceCallId = the new call id);
-- log a 'call' activity on the lead. All in one transaction.
-- Returns the new call Id.
--
-- tblFollowUp NOT-NULL columns beyond the params: FollowupType
-- (defaulted 'call'), Remarks (from @FollowupRemarks, '' fallback),
-- Status ('Pending'), CreatedBy/EditBy (@UserId), BranchId (from the
-- lead, 1 fallback). SourceCallId links back to this call.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_LogCall', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_LogCall;
GO

CREATE PROC dbo.sp_LogCall
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
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess;
        RETURN;
    END
    IF (@LeadId IS NULL OR @LeadId <= 0) AND (@TicketId IS NULL OR @TicketId <= 0)
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'A LeadId or TicketId is required' AS ResponseMess;
        RETURN;
    END
    IF @Direction IS NULL OR @Direction NOT IN ('in','out')
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Direction must be in or out' AS ResponseMess;
        RETURN;
    END
    -- Tenant guard: a supplied lead must belong to this company.
    -- (@TicketId-only calls are Spec 2 territory; that path is untouched.)
    IF @LeadId IS NOT NULL AND @LeadId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId)
    BEGIN
        SELECT 0 AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @CallId INT;

        INSERT INTO dbo.tblCall
            (CompId, LeadId, TicketId, UserId, Direction, OutcomeId, Notes, Duration, CalledAt, CreatedBy)
        VALUES
            (@CompId, @LeadId, @TicketId, @UserId, @Direction, @OutcomeId, @Notes, @Duration, GETDATE(), @UserId);

        SET @CallId = CAST(SCOPE_IDENTITY() AS INT);

        IF @NextFollowupDate IS NOT NULL AND @LeadId IS NOT NULL AND @LeadId > 0
        BEGIN
            DECLARE @BranchId INT = (SELECT BranchId FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId);

            INSERT INTO dbo.tblFollowUp
                (LeadId, NextFollowupDate, FollowupType, Remarks, Status,
                 CreatedBy, EditBy, CompId, BranchId, SourceCallId)
            VALUES
                (@LeadId, @NextFollowupDate, 'call', ISNULL(@FollowupRemarks,''), 'Pending',
                 @UserId, @UserId, @CompId, ISNULL(@BranchId,1), @CallId);
        END

        -- Timeline only tracks leads (tickets have their own logger).
        IF @LeadId IS NOT NULL AND @LeadId > 0
        BEGIN
            INSERT INTO @actLog
            EXEC dbo.sp_LogLeadActivity
                @CompId  = @CompId,
                @LeadId  = @LeadId,
                @UserId  = @UserId,
                @Type    = 'call',
                @Summary = 'Call logged',
                @MetaJSON = NULL;
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

-- ------------------------------------------------------------
-- sp_FetchCalls — by lead (when @LeadId set) else by user.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_FetchCalls', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchCalls;
GO

CREATE PROC dbo.sp_FetchCalls
    @CompId INT,
    @LeadId INT = NULL,
    @UserId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.Id, c.CompId, c.LeadId, c.TicketId, c.UserId, c.Direction, c.OutcomeId,
           c.Notes, c.Duration, c.CalledAt, c.CreatedBy, c.CreatedAt,
           200 AS ResponseCode, 'Calls retrieved successfully' AS ResponseMess
    FROM dbo.tblCall c
    WHERE c.CompId = @CompId
      AND ( (@LeadId IS NOT NULL AND c.LeadId = @LeadId)
         OR (@LeadId IS NULL AND @UserId IS NOT NULL AND c.UserId = @UserId) )
    ORDER BY c.CalledAt DESC, c.Id DESC;
END
GO

-- ------------------------------------------------------------
-- sp_FetchLeadActivity — timeline for a lead, newest first.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_FetchLeadActivity', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchLeadActivity;
GO

CREATE PROC dbo.sp_FetchLeadActivity
    @CompId INT,
    @LeadId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT a.Id, a.CompId, a.LeadId, a.UserId, a.Type, a.Summary, a.MetaJSON, a.CreatedAt,
           200 AS ResponseCode, 'Activity retrieved successfully' AS ResponseMess
    FROM dbo.tblLeadActivity a
    WHERE a.CompId = @CompId AND a.LeadId = @LeadId
    ORDER BY a.CreatedAt DESC, a.Id DESC;
END
GO

-- ------------------------------------------------------------
-- sp_PipelineFunnel — lead count per stage of a pipeline, ordered
-- by stage SortOrder. LEFT JOIN so empty stages report 0.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_PipelineFunnel', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PipelineFunnel;
GO

CREATE PROC dbo.sp_PipelineFunnel
    @CompId     INT,
    @BranchId   INT = NULL,
    @PipelineId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT s.Id AS StageId, s.Name AS StageName, s.StageType, s.SortOrder,
           COUNT(l.Id) AS LeadCount,
           200 AS ResponseCode, 'Pipeline funnel retrieved successfully' AS ResponseMess
    FROM dbo.tblPipelineStage s
    LEFT JOIN dbo.tblLeads l
           ON l.StageId = s.Id AND l.CompId = @CompId
          AND (@BranchId IS NULL OR l.BranchId = @BranchId)
    WHERE s.CompId = @CompId AND s.PipelineId = @PipelineId AND s.IsActive = 1
    GROUP BY s.Id, s.Name, s.StageType, s.SortOrder
    ORDER BY s.SortOrder;
END
GO

-- ------------------------------------------------------------
-- sp_CallsPerUser — call count per user within a date window.
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_CallsPerUser', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_CallsPerUser;
GO

CREATE PROC dbo.sp_CallsPerUser
    @CompId   INT,
    @BranchId INT      = NULL,
    @FromDate DATETIME = NULL,
    @ToDate   DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.UserId, COUNT(*) AS CallCount,
           200 AS ResponseCode, 'Calls per user retrieved successfully' AS ResponseMess
    FROM dbo.tblCall c
    WHERE c.CompId = @CompId
      AND (@FromDate IS NULL OR c.CalledAt >= @FromDate)
      AND (@ToDate   IS NULL OR c.CalledAt <  DATEADD(DAY, 1, @ToDate))
      AND (@BranchId IS NULL OR EXISTS (
              SELECT 1 FROM dbo.tblLeads l
              WHERE l.Id = c.LeadId AND l.CompId = @CompId AND l.BranchId = @BranchId))
    GROUP BY c.UserId
    ORDER BY CallCount DESC;
END
GO

-- ------------------------------------------------------------
-- sp_ConversionBySource — per lead source: total leads + won count.
-- Won = the lead has a WonAt stamp (set by sp_MoveLeadStage).
-- ------------------------------------------------------------
IF OBJECT_ID(N'dbo.sp_ConversionBySource', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_ConversionBySource;
GO

CREATE PROC dbo.sp_ConversionBySource
    @CompId   INT,
    @BranchId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT lk.Id AS SourceId, lk.Value AS SourceName,
           COUNT(l.Id) AS TotalLeads,
           SUM(CASE WHEN l.WonAt IS NOT NULL THEN 1 ELSE 0 END) AS WonCount,
           200 AS ResponseCode, 'Conversion by source retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblLeads l
           ON l.SourceId = lk.Id AND l.CompId = @CompId
          AND (@BranchId IS NULL OR l.BranchId = @BranchId)
    WHERE lk.CompId = @CompId AND lk.Kind = 'lead_source' AND lk.IsActive = 1
    GROUP BY lk.Id, lk.Value
    ORDER BY TotalLeads DESC;
END
GO

-- ============================================================
-- Verification (Task 0.5) — run manually after applying:
--
-- After apply: expect 12 rows
-- SELECT name FROM sys.procedures WHERE name IN
--  ('sp_SaveLead','sp_FetchLeads','sp_FetchLeadDetail','sp_MoveLeadStage',
--   'sp_TransferLead','sp_DeleteLead','sp_LogCall','sp_FetchCalls',
--   'sp_FetchLeadActivity','sp_PipelineFunnel','sp_CallsPerUser','sp_ConversionBySource');
--
-- Sample flow (uses CompId=1; a real StageId/pipeline from your data):
--
-- 1) Create a lead with two custom values, then read it back.
--    sp_FetchLeadDetail returns THREE result sets: core / custom values / timeline.
-- DECLARE @cj NVARCHAR(MAX) =
--   N'[{"fieldId":1,"type":"text","value":"Acme"},{"fieldId":4,"type":"number","value":"50000"}]';
-- EXEC sp_SaveLead @Id=0, @CompId=1, @BranchId=1, @Name='Test Lead',
--      @MobileNo='9990001111', @AltMobile=NULL, @Email='t@example.com',
--      @SourceId=NULL, @PipelineId=NULL, @StageId=NULL, @OwnerId=1,
--      @EstValue=50000, @NextFollowupDate=NULL, @CustomJSON=@cj, @UserId=1;
--   -- note the returned Id, then:
-- EXEC sp_FetchLeadDetail @CompId=1, @LeadId=<that Id>;  -- 3 result sets
--
-- 2) Moving into a LOST stage with NULL reason must return ResponseCode 400
--    and change nothing (pick a StageId whose StageType='lost'):
-- EXEC sp_MoveLeadStage @CompId=1, @LeadId=<Id>, @StageId=<lost stage>,
--      @LostReasonId=NULL, @UserId=1;   -- expect ResponseCode 400 'Lost reason required'
--
-- 3) Log a call that schedules a follow-up (creates tblFollowUp w/ SourceCallId):
-- EXEC sp_LogCall @CompId=1, @LeadId=<Id>, @TicketId=NULL, @UserId=1,
--      @Direction='out', @OutcomeId=NULL, @Notes='Spoke to client',
--      @Duration=120, @NextFollowupDate='2026-07-10', @FollowupRemarks='Call back';
-- ============================================================
