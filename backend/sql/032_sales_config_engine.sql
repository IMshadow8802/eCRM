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
