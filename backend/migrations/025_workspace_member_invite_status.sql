-- ============================================================
-- Migration 025 — Add invite lifecycle to tblWorkspaceMembers.
--
-- Shared workspaces now carry pending invites. Members reach the
-- 'active' state only by explicitly accepting. Projects snapshot
-- existing team members straight to 'active' since they're already
-- on the team. Personal workspaces are single-owner and always
-- 'active'.
--
-- Columns added:
--   InviteStatus     VARCHAR(20) DEFAULT 'active'
--                    values: 'active' | 'pending' | 'declined' | 'removed'
--   InvitedDate      DATETIME NULL
--   RespondedDate    DATETIME NULL
--
-- Index for fast "my pending invites" lookups.
-- ============================================================

USE [eCRM+];
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblWorkspaceMembers')
       AND name      = 'InviteStatus'
)
BEGIN
    ALTER TABLE dbo.tblWorkspaceMembers
      ADD InviteStatus VARCHAR(20) NOT NULL CONSTRAINT DF_WorkspaceMembers_InviteStatus DEFAULT 'active';
    PRINT 'Added tblWorkspaceMembers.InviteStatus';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblWorkspaceMembers') AND name = 'InvitedDate'
)
    ALTER TABLE dbo.tblWorkspaceMembers ADD InvitedDate DATETIME NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblWorkspaceMembers') AND name = 'RespondedDate'
)
    ALTER TABLE dbo.tblWorkspaceMembers ADD RespondedDate DATETIME NULL;
GO

-- Backfill: every existing row is already accepted; default 'active' handled
-- by the NOT NULL constraint, but ensure explicit fill for rows that predate
-- the column (SQL Server back-fills the default, but just to be safe).
UPDATE dbo.tblWorkspaceMembers
   SET InviteStatus = 'active'
 WHERE InviteStatus IS NULL OR InviteStatus = '';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = 'IX_tblWorkspaceMembers_UserId_InviteStatus'
       AND object_id = OBJECT_ID('dbo.tblWorkspaceMembers')
)
BEGIN
    CREATE INDEX IX_tblWorkspaceMembers_UserId_InviteStatus
        ON dbo.tblWorkspaceMembers (UserId, InviteStatus)
     INCLUDE (WorkspaceId, Role, IsActive);
    PRINT 'Added IX_tblWorkspaceMembers_UserId_InviteStatus';
END
GO

PRINT 'Migration 025 complete.';
GO
