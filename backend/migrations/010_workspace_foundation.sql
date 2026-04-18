-- ============================================================
-- Migration 010 — Workspace foundation for task management rewrite
--
-- Scope (Phase 1.1 of plan /Users/ayushmishra/.claude/plans/rustling-singing-lynx.md):
--   * New tables: tblWorkspaces, tblWorkspaceMembers, tblTaskReads,
--     tblCommentReads, tblNotifications, tblTaskDependencies,
--     tblUserPushTokens, tblNotificationPreferences
--   * ALTERs:
--       tblTasks          — add WorkspaceId, CompletedDate, CompletedByUserId,
--                           UpdatedDate; drop Dependencies (moved to FK table);
--                           make TeamId nullable
--       tblTaskComments   — add ParentCommentId, UpdatedDate, IsPinned, IsDeleted
--       tblKanbanColumns  — rename ProjectId → WorkspaceId
--
-- Out of scope (follow-up migrations):
--   011 — drop tblUser.GroupId after tblUserGroupMap backfill
--   012 — new/modified stored procedures (sp_CheckTaskPermission, sp_SaveWorkspace, etc.)
--
-- DB is empty (0 tasks/projects/teams/columns) so ALTERs + drops are safe.
--
-- Run in [eCRM+] in SSMS or via sqlserver-ecrm MCP. Each batch is GO-terminated.
-- Safe rollback: see migrations/010_workspace_foundation_rollback.sql
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET XACT_ABORT ON
GO

-- ============================================================
-- 1) New tables
-- ============================================================

BEGIN TRANSACTION;

-- ---------- tblWorkspaces ----------
-- Unified container: personal / shared / project boards.
CREATE TABLE dbo.tblWorkspaces (
    Id            BIGINT       IDENTITY(1,1) PRIMARY KEY,
    Name          VARCHAR(200) NOT NULL,
    Type          VARCHAR(20)  NOT NULL CONSTRAINT CK_tblWorkspaces_Type
                               CHECK (Type IN ('personal','shared','project')),
    OwnerUserId   INT          NOT NULL,
    TeamId        INT          NULL,
    ProjectId     INT          NULL,
    IsArchived    BIT          NOT NULL CONSTRAINT DF_tblWorkspaces_IsArchived DEFAULT (0),
    Color         VARCHAR(20)  NULL,
    Icon          VARCHAR(40)  NULL,
    CompId        BIGINT       NOT NULL CONSTRAINT DF_tblWorkspaces_CompId   DEFAULT (1),
    BranchId      BIGINT       NOT NULL CONSTRAINT DF_tblWorkspaces_BranchId DEFAULT (1),
    CreatedDate   DATETIME     NOT NULL CONSTRAINT DF_tblWorkspaces_CreatedDate DEFAULT (GETDATE()),
    UpdatedDate   DATETIME     NULL
);
CREATE INDEX IX_tblWorkspaces_Owner_Type ON dbo.tblWorkspaces (OwnerUserId, Type, IsArchived);
CREATE INDEX IX_tblWorkspaces_CompBranch ON dbo.tblWorkspaces (CompId, BranchId, IsArchived);

-- ---------- tblWorkspaceMembers ----------
-- Per-workspace role. Replaces tblProjects.Members JSON.
CREATE TABLE dbo.tblWorkspaceMembers (
    Id              BIGINT      IDENTITY(1,1) PRIMARY KEY,
    WorkspaceId     BIGINT      NOT NULL,
    UserId          INT         NOT NULL,
    Role            VARCHAR(20) NOT NULL CONSTRAINT CK_tblWorkspaceMembers_Role
                                CHECK (Role IN ('owner','manager','member','viewer')),
    AddedByUserId   INT         NULL,
    JoinedDate      DATETIME    NOT NULL CONSTRAINT DF_tblWorkspaceMembers_JoinedDate DEFAULT (GETDATE()),
    IsActive        BIT         NOT NULL CONSTRAINT DF_tblWorkspaceMembers_IsActive   DEFAULT (1),
    CONSTRAINT FK_tblWorkspaceMembers_Workspace FOREIGN KEY (WorkspaceId)
        REFERENCES dbo.tblWorkspaces (Id) ON DELETE CASCADE,
    CONSTRAINT UQ_tblWorkspaceMembers_WSUser UNIQUE (WorkspaceId, UserId)
);
CREATE INDEX IX_tblWorkspaceMembers_UserActive ON dbo.tblWorkspaceMembers (UserId, IsActive);

-- ---------- tblTaskReads ----------
-- WhatsApp-style: delivered (list fetched) + firstSeen + lastSeen.
CREATE TABLE dbo.tblTaskReads (
    Id             BIGINT    IDENTITY(1,1) PRIMARY KEY,
    TaskId         BIGINT    NOT NULL,
    UserId         INT       NOT NULL,
    FirstSeenAt    DATETIME  NULL,
    LastSeenAt     DATETIME  NULL,
    DeliveredAt    DATETIME  NOT NULL CONSTRAINT DF_tblTaskReads_DeliveredAt DEFAULT (GETDATE()),
    CONSTRAINT UQ_tblTaskReads_TaskUser UNIQUE (TaskId, UserId)
);
CREATE INDEX IX_tblTaskReads_Task ON dbo.tblTaskReads (TaskId);

-- ---------- tblCommentReads ----------
-- Per-comment per-user read stamp.
CREATE TABLE dbo.tblCommentReads (
    Id         BIGINT   IDENTITY(1,1) PRIMARY KEY,
    CommentId  BIGINT   NOT NULL,
    UserId     INT      NOT NULL,
    SeenAt     DATETIME NOT NULL CONSTRAINT DF_tblCommentReads_SeenAt DEFAULT (GETDATE()),
    CONSTRAINT UQ_tblCommentReads_CommentUser UNIQUE (CommentId, UserId)
);
CREATE INDEX IX_tblCommentReads_Comment ON dbo.tblCommentReads (CommentId);

-- ---------- tblNotifications ----------
-- One feed powers both web bell + mobile push.
CREATE TABLE dbo.tblNotifications (
    Id            BIGINT       IDENTITY(1,1) PRIMARY KEY,
    UserId        INT          NOT NULL,   -- recipient
    Type          VARCHAR(40)  NOT NULL,   -- task_assigned | comment_added | mention | due_soon | overdue | status_changed | dependency_unblocked | reply | workspace_invite
    EntityType    VARCHAR(20)  NOT NULL,   -- task | comment | workspace
    EntityId      BIGINT       NOT NULL,
    ActorUserId   INT          NULL,
    Title         VARCHAR(200) NOT NULL,
    Body          NVARCHAR(1000) NULL,
    IsRead        BIT          NOT NULL CONSTRAINT DF_tblNotifications_IsRead   DEFAULT (0),
    ReadAt        DATETIME     NULL,
    CompId        BIGINT       NOT NULL CONSTRAINT DF_tblNotifications_CompId   DEFAULT (1),
    BranchId      BIGINT       NOT NULL CONSTRAINT DF_tblNotifications_BranchId DEFAULT (1),
    CreatedDate   DATETIME     NOT NULL CONSTRAINT DF_tblNotifications_CreatedDate DEFAULT (GETDATE())
);
CREATE INDEX IX_tblNotifications_UserUnread ON dbo.tblNotifications (UserId, IsRead, CreatedDate DESC);
CREATE INDEX IX_tblNotifications_Entity     ON dbo.tblNotifications (EntityType, EntityId);

-- ---------- tblTaskDependencies ----------
-- Replaces tblTasks.Dependencies JSON. Cycle-checkable via SP.
CREATE TABLE dbo.tblTaskDependencies (
    Id                BIGINT      IDENTITY(1,1) PRIMARY KEY,
    TaskId            BIGINT      NOT NULL,  -- the dependent
    DependsOnTaskId   BIGINT      NOT NULL,  -- the blocker
    Type              VARCHAR(20) NOT NULL CONSTRAINT CK_tblTaskDependencies_Type
                                  CHECK (Type IN ('blocks','related'))
                                  CONSTRAINT DF_tblTaskDependencies_Type DEFAULT ('blocks'),
    CreatedByUserId   INT         NOT NULL,
    CreatedDate       DATETIME    NOT NULL CONSTRAINT DF_tblTaskDependencies_CreatedDate DEFAULT (GETDATE()),
    CONSTRAINT UQ_tblTaskDependencies_Pair UNIQUE (TaskId, DependsOnTaskId),
    CONSTRAINT CK_tblTaskDependencies_NotSelf CHECK (TaskId <> DependsOnTaskId)
);
CREATE INDEX IX_tblTaskDependencies_Task       ON dbo.tblTaskDependencies (TaskId);
CREATE INDEX IX_tblTaskDependencies_DependsOn  ON dbo.tblTaskDependencies (DependsOnTaskId);

-- ---------- tblUserPushTokens ----------
-- Mobile later. Define now so API stable across phases.
CREATE TABLE dbo.tblUserPushTokens (
    Id          BIGINT       IDENTITY(1,1) PRIMARY KEY,
    UserId      INT          NOT NULL,
    Token       VARCHAR(500) NOT NULL,
    Platform    VARCHAR(20)  NOT NULL CONSTRAINT CK_tblUserPushTokens_Platform
                             CHECK (Platform IN ('expo','fcm','apns','web')),
    IsActive    BIT          NOT NULL CONSTRAINT DF_tblUserPushTokens_IsActive DEFAULT (1),
    LastSeenAt  DATETIME     NULL,
    CreatedDate DATETIME     NOT NULL CONSTRAINT DF_tblUserPushTokens_CreatedDate DEFAULT (GETDATE()),
    CONSTRAINT UQ_tblUserPushTokens_Token UNIQUE (Token)
);
CREATE INDEX IX_tblUserPushTokens_UserActive ON dbo.tblUserPushTokens (UserId, IsActive);

-- ---------- tblNotificationPreferences ----------
-- Per-user opt-in/out per (Type, Channel).
CREATE TABLE dbo.tblNotificationPreferences (
    Id         BIGINT      IDENTITY(1,1) PRIMARY KEY,
    UserId     INT         NOT NULL,
    Type       VARCHAR(40) NOT NULL,   -- matches tblNotifications.Type; NULL semantics handled at app level
    Channel    VARCHAR(20) NOT NULL CONSTRAINT CK_tblNotificationPreferences_Channel
                           CHECK (Channel IN ('inapp','push','email')),
    IsEnabled  BIT         NOT NULL CONSTRAINT DF_tblNotificationPreferences_IsEnabled DEFAULT (1),
    CONSTRAINT UQ_tblNotificationPreferences_Triple UNIQUE (UserId, Type, Channel)
);
CREATE INDEX IX_tblNotificationPreferences_User ON dbo.tblNotificationPreferences (UserId);

COMMIT TRANSACTION;
GO

-- ============================================================
-- 2) ALTERs on existing tables
-- ============================================================

BEGIN TRANSACTION;

-- ---------- tblTasks ----------
-- Add WorkspaceId (nullable now, populated once workspaces seeded)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'WorkspaceId'
)
    ALTER TABLE dbo.tblTasks ADD WorkspaceId BIGINT NULL;
GO

-- Add CompletedDate + CompletedByUserId
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'CompletedDate'
)
    ALTER TABLE dbo.tblTasks ADD CompletedDate DATETIME NULL;
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'CompletedByUserId'
)
    ALTER TABLE dbo.tblTasks ADD CompletedByUserId INT NULL;
GO

-- Add UpdatedDate for "recently modified" sort
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'UpdatedDate'
)
    ALTER TABLE dbo.tblTasks ADD UpdatedDate DATETIME NULL;
GO

-- Drop Dependencies JSON column (moved to tblTaskDependencies)
IF EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'Dependencies'
)
BEGIN
    DECLARE @df sysname;
    SELECT @df = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.default_object_id = dc.object_id
    WHERE c.object_id = OBJECT_ID('dbo.tblTasks') AND c.name = 'Dependencies';
    IF @df IS NOT NULL
        EXEC('ALTER TABLE dbo.tblTasks DROP CONSTRAINT ' + @df);
    ALTER TABLE dbo.tblTasks DROP COLUMN Dependencies;
END;
GO

-- Make TeamId nullable (fixes current notnull+null-default mismatch)
ALTER TABLE dbo.tblTasks ALTER COLUMN TeamId INT NULL;
GO

-- Add FK on WorkspaceId (nullable; enforced once workspaces seeded by migration 012+)
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblTasks_Workspace'
)
    ALTER TABLE dbo.tblTasks
        ADD CONSTRAINT FK_tblTasks_Workspace FOREIGN KEY (WorkspaceId)
            REFERENCES dbo.tblWorkspaces (Id);
GO

-- ---------- tblTaskComments ----------
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'ParentCommentId'
)
    ALTER TABLE dbo.tblTaskComments ADD ParentCommentId BIGINT NULL;
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'UpdatedDate'
)
    ALTER TABLE dbo.tblTaskComments ADD UpdatedDate DATETIME NULL;
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'IsPinned'
)
    ALTER TABLE dbo.tblTaskComments ADD IsPinned BIT NOT NULL
        CONSTRAINT DF_tblTaskComments_IsPinned DEFAULT (0);
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'IsDeleted'
)
    ALTER TABLE dbo.tblTaskComments ADD IsDeleted BIT NOT NULL
        CONSTRAINT DF_tblTaskComments_IsDeleted DEFAULT (0);
GO

-- Self-FK for threaded replies
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblTaskComments_Parent'
)
    ALTER TABLE dbo.tblTaskComments
        ADD CONSTRAINT FK_tblTaskComments_Parent FOREIGN KEY (ParentCommentId)
            REFERENCES dbo.tblTaskComments (Id);
GO

-- ---------- tblKanbanColumns ----------
-- Rename ProjectId → WorkspaceId. Columns now attach to workspaces
-- (personal/shared boards need columns too, not just projects).
IF EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns') AND name = 'ProjectId'
)
AND NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns') AND name = 'WorkspaceId'
)
BEGIN
    EXEC sp_rename 'dbo.tblKanbanColumns.ProjectId', 'WorkspaceId', 'COLUMN';
    -- Widen type to match tblWorkspaces.Id (BIGINT)
    ALTER TABLE dbo.tblKanbanColumns ALTER COLUMN WorkspaceId BIGINT NULL;
END;
GO

COMMIT TRANSACTION;
GO

-- ============================================================
-- 3) Sanity check
-- ============================================================
PRINT '----- migration 010 sanity -----';
SELECT 'tblWorkspaces'              AS tbl, COUNT(*) AS rows_ FROM dbo.tblWorkspaces
UNION ALL SELECT 'tblWorkspaceMembers',      COUNT(*) FROM dbo.tblWorkspaceMembers
UNION ALL SELECT 'tblTaskReads',             COUNT(*) FROM dbo.tblTaskReads
UNION ALL SELECT 'tblCommentReads',          COUNT(*) FROM dbo.tblCommentReads
UNION ALL SELECT 'tblNotifications',         COUNT(*) FROM dbo.tblNotifications
UNION ALL SELECT 'tblTaskDependencies',      COUNT(*) FROM dbo.tblTaskDependencies
UNION ALL SELECT 'tblUserPushTokens',        COUNT(*) FROM dbo.tblUserPushTokens
UNION ALL SELECT 'tblNotificationPreferences', COUNT(*) FROM dbo.tblNotificationPreferences;
GO
