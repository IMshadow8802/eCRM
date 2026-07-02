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
-- tblCall, tblLeadActivity, tblFollowUp changes, and the tblLeads
-- rebuild are later tasks appended to this same file.
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
