-- ===========================================================================
-- 137 - TestCRM only: remove the access-model seed (136) and everything the
--       live / Playwright / Maestro suites did with it.
--       (plan 2026-11-22-access-model Task 8; pre-flight S14 / P37)
--
-- Apply by hand, TestCRM only:
--   sqlcmd -I -b -d TestCRM ... -i 137_testcrm_access_seed_cleanup.sql
--   -I = QUOTED_IDENTIFIER ON, -b = stop at the first error (the refusal
--   below also SETs NOEXEC ON).
--
-- What is "seed" (by tag, never by id):
--   people    tblUser.Username LIKE 'am[_]%'          (set @U)
--   role      tblUserGroups.Name = 'AM Central Desk'
--   complaints Subject LIKE 'AM-%' OR CreatedBy IN @U (set @T)
--   leads     Name    LIKE 'AM-%' OR CreatedBy IN @U  (set @L)
--   customers Name    LIKE 'AM-%' OR CreatedBy IN @U, once no complaint
--             or lead outside the sets points at them
--
-- Children, found on TestCRM 2026-11-22. sys.foreign_keys holds only a few
-- (tblTicket.CustomerId -> tblCustomer, tblPartnerCommission.LeadId ->
-- tblLeads, tblQuotationLine -> tblQuotation CASCADE, tblUserGroupMap /
-- tblGroupModule / tblGroupAccess -> tblUserGroups, and tblUser is referenced
-- by tblProjects, tblTaskAssignee, tblTaskComments, tblTasks (x2),
-- tblTeamMembers, tblTeams, tblTimeEntries, tblUserGroupMap). Every other
-- child is joined by convention (no FK), found by column name
-- (UserId / LeadId / TicketId / EntityId / AssignedTo / ...) in
-- INFORMATION_SCHEMA.COLUMNS, and deleted here explicitly:
--   records:  tblNotifications, tblCustomFieldValue, tblAttachment,
--             tblActivityLog, tblTicketActivity, tblLeadActivity, tblCall,
--             tblFollowUp, tblPartnerCommission, tblQuotation (+ lines),
--             tblTicketAssignment, tblTicketStatusHistory, tblLeadAssignment,
--             tblLeadStatusHistory, tblTicket, tblLeads, tblCustomer
--   people:   tblUserSession, tblUserBranchAccess, tblUserDayMark,
--             tblPresenceDay, tblUserPushTokens, tblNotificationPreferences,
--             tblTaskReads, tblCommentReads, the personal workspace each
--             persona got at first sign-in (sp_SeedDefaultWorkspace: its
--             tasks and their children, columns, members), tblUserGroupMap,
--             tblUser, then the AM Central Desk role.
-- Anything a persona did OUTSIDE its personal workspace in tasks / teams /
-- projects stops the run (THROW, nothing deleted): those are real tables
-- the access suites never touch, so a hit means someone used a persona by
-- hand; clean that by hand first.
-- Untagged complaints / leads still pointing at a persona (a suite moved a
-- real record onto one) are released to Unassigned, and counted in a PRINT.
-- Files of deleted attachments stay on disk under the uploads volume.
--
-- Idempotent: a second run deletes nothing and prints 0.
--
-- VERIFY AFTER APPLY (expected: one row, Remaining = 0):
--   SELECT (SELECT COUNT(*) FROM dbo.tblUser       WHERE Username LIKE 'am[_]%')
--        + (SELECT COUNT(*) FROM dbo.tblUserGroups WHERE Name = 'AM Central Desk')
--        + (SELECT COUNT(*) FROM dbo.tblCustomer   WHERE Name    LIKE 'AM-%')
--        + (SELECT COUNT(*) FROM dbo.tblTicket     WHERE Subject LIKE 'AM-%')
--        + (SELECT COUNT(*) FROM dbo.tblLeads      WHERE Name    LIKE 'AM-%') AS Remaining;
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
IF DB_NAME() <> 'TestCRM'
BEGIN
    RAISERROR('137: TestCRM only. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRAN;

DECLARE @U TABLE (Id INT PRIMARY KEY);
INSERT INTO @U SELECT Id FROM dbo.tblUser WHERE Username LIKE 'am[_]%';

DECLARE @T TABLE (Id INT PRIMARY KEY);
INSERT INTO @T SELECT Id FROM dbo.tblTicket
 WHERE Subject LIKE 'AM-%' OR CreatedBy IN (SELECT Id FROM @U);

DECLARE @L TABLE (Id INT PRIMARY KEY);
INSERT INTO @L SELECT Id FROM dbo.tblLeads
 WHERE Name LIKE 'AM-%' OR CreatedBy IN (SELECT Id FROM @U);

DECLARE @Q TABLE (Id INT PRIMARY KEY);
INSERT INTO @Q SELECT Id FROM dbo.tblQuotation
 WHERE LeadId IN (SELECT Id FROM @L) OR CreatedBy IN (SELECT Id FROM @U);

-- Personal workspaces the personas got at first sign-in, and their tasks.
DECLARE @W TABLE (Id BIGINT PRIMARY KEY);
INSERT INTO @W SELECT Id FROM dbo.tblWorkspaces
 WHERE Type = 'personal' AND OwnerUserId IN (SELECT Id FROM @U);

DECLARE @K TABLE (Id BIGINT PRIMARY KEY);
INSERT INTO @K SELECT Id FROM dbo.tblTasks WHERE WorkspaceId IN (SELECT Id FROM @W);

-- Stop before touching anything if a persona left a trace in real task data.
DECLARE @foreign INT =
      (SELECT COUNT(*) FROM dbo.tblTasks WHERE Id NOT IN (SELECT Id FROM @K)
         AND (AssignedToUserId IN (SELECT Id FROM @U) OR CreatedByUserId IN (SELECT Id FROM @U)))
    + (SELECT COUNT(*) FROM dbo.tblTaskAssignee WHERE TaskId NOT IN (SELECT Id FROM @K) AND UserId IN (SELECT Id FROM @U))
    + (SELECT COUNT(*) FROM dbo.tblTaskComments WHERE TaskId NOT IN (SELECT Id FROM @K) AND UserId IN (SELECT Id FROM @U))
    + (SELECT COUNT(*) FROM dbo.tblTimeEntries  WHERE TaskId NOT IN (SELECT Id FROM @K) AND UserId IN (SELECT Id FROM @U))
    + (SELECT COUNT(*) FROM dbo.tblTeamMembers  WHERE UserId IN (SELECT Id FROM @U))
    + (SELECT COUNT(*) FROM dbo.tblTeams        WHERE LeadUserId IN (SELECT Id FROM @U))
    + (SELECT COUNT(*) FROM dbo.tblProjects     WHERE ManagerUserId IN (SELECT Id FROM @U))
    + (SELECT COUNT(*) FROM dbo.tblWorkspaces   WHERE Type <> 'personal' AND OwnerUserId IN (SELECT Id FROM @U))
    + (SELECT COUNT(*) FROM dbo.tblTaskTat      WHERE UserId IN (SELECT Id FROM @U));
IF @foreign > 0
    THROW 50137, '137: a persona has tasks / teams / projects / TAT rows outside its personal workspace. Clean those by hand first. Nothing was deleted.', 1;

-- ---- records --------------------------------------------------------------
DELETE FROM dbo.tblNotifications
 WHERE UserId IN (SELECT Id FROM @U)
    OR ActorUserId IN (SELECT Id FROM @U)
    OR (EntityType = 'ticket' AND EntityId IN (SELECT Id FROM @T))
    OR (EntityType = 'lead'   AND EntityId IN (SELECT Id FROM @L))
    OR (EntityType = 'user'   AND EntityId IN (SELECT Id FROM @U));
PRINT '137: notifications ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DELETE FROM dbo.tblCustomFieldValue
 WHERE (Entity = 'ticket' AND EntityId IN (SELECT Id FROM @T))
    OR (Entity = 'lead'   AND EntityId IN (SELECT Id FROM @L));

DELETE FROM dbo.tblAttachment
 WHERE UploadedBy IN (SELECT Id FROM @U)
    OR (Entity = 'ticket'    AND EntityId IN (SELECT Id FROM @T))
    OR (Entity = 'lead'      AND EntityId IN (SELECT Id FROM @L))
    OR (Entity = 'quotation' AND EntityId IN (SELECT Id FROM @Q));
PRINT '137: attachments ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' (files stay on disk)';

DELETE FROM dbo.tblActivityLog
 WHERE UserId IN (SELECT Id FROM @U)
    OR (EntityType = 'Ticket' AND EntityId IN (SELECT Id FROM @T))
    OR (EntityType = 'Lead'   AND EntityId IN (SELECT Id FROM @L))
    OR (EntityType = 'User'   AND EntityId IN (SELECT Id FROM @U));

DELETE FROM dbo.tblTicketActivity WHERE TicketId IN (SELECT Id FROM @T) OR UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblLeadActivity   WHERE LeadId   IN (SELECT Id FROM @L) OR UserId IN (SELECT Id FROM @U);

DELETE FROM dbo.tblCall
 WHERE LeadId IN (SELECT Id FROM @L) OR TicketId IN (SELECT Id FROM @T) OR UserId IN (SELECT Id FROM @U);
PRINT '137: calls ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DELETE FROM dbo.tblFollowUp
 WHERE LeadId IN (SELECT Id FROM @L)
    OR CreatedBy IN (SELECT Id FROM @U) OR DoneBy IN (SELECT Id FROM @U);
PRINT '137: follow-ups ' + CAST(@@ROWCOUNT AS VARCHAR(10));
-- A real lead's open follow-up a suite handed to a persona: back to nobody.
UPDATE dbo.tblFollowUp SET AssignedTo = NULL WHERE AssignedTo IN (SELECT Id FROM @U);

DELETE FROM dbo.tblPartnerCommission WHERE LeadId IN (SELECT Id FROM @L);
DELETE FROM dbo.tblQuotation WHERE Id IN (SELECT Id FROM @Q);   -- lines cascade
PRINT '137: quotations ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DELETE FROM dbo.tblTicketAssignment    WHERE TicketId IN (SELECT Id FROM @T);
DELETE FROM dbo.tblTicketStatusHistory WHERE TicketId IN (SELECT Id FROM @T);
DELETE FROM dbo.tblLeadAssignment      WHERE LeadId   IN (SELECT Id FROM @L);
DELETE FROM dbo.tblLeadStatusHistory   WHERE LeadId   IN (SELECT Id FROM @L);

DELETE FROM dbo.tblTicket WHERE Id IN (SELECT Id FROM @T);
PRINT '137: complaints ' + CAST(@@ROWCOUNT AS VARCHAR(10));
UPDATE dbo.tblTicket SET LinkedLeadId = NULL WHERE LinkedLeadId IN (SELECT Id FROM @L);
DELETE FROM dbo.tblLeads  WHERE Id IN (SELECT Id FROM @L);
PRINT '137: leads ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- Untagged records still held by / escalated to a persona: release them.
UPDATE dbo.tblTicket SET AssignedTo = NULL, AssignedAt = NULL WHERE AssignedTo IN (SELECT Id FROM @U);
DECLARE @released INT = @@ROWCOUNT;
UPDATE dbo.tblTicket SET EscalatedTo = NULL, EscalatedAt = NULL WHERE EscalatedTo IN (SELECT Id FROM @U);
UPDATE dbo.tblLeads  SET OwnerId = NULL, AssignedAt = NULL WHERE OwnerId IN (SELECT Id FROM @U);
SET @released += @@ROWCOUNT;
PRINT '137: untagged records released from personas ' + CAST(@released AS VARCHAR(10));

DELETE c FROM dbo.tblCustomer c
 WHERE (c.Name LIKE 'AM-%' OR c.CreatedBy IN (SELECT Id FROM @U))
   AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket t WHERE t.CustomerId = c.Id)
   AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads  l WHERE l.CustomerId = c.Id)
   AND NOT EXISTS (SELECT 1 FROM dbo.tblQuotation q WHERE q.CustomerId = c.Id);
PRINT '137: customers ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- ---- people ---------------------------------------------------------------
DELETE FROM dbo.tblUserSession      WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblUserBranchAccess WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblUserDayMark      WHERE UserId IN (SELECT Id FROM @U) OR MarkedBy IN (SELECT Id FROM @U);
DELETE FROM dbo.tblPresenceDay      WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblUserPushTokens   WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblNotificationPreferences WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblTaskReads        WHERE UserId IN (SELECT Id FROM @U) OR TaskId IN (SELECT Id FROM @K);
DELETE FROM dbo.tblCommentReads     WHERE UserId IN (SELECT Id FROM @U)
    OR CommentId IN (SELECT Id FROM dbo.tblTaskComments WHERE TaskId IN (SELECT Id FROM @K));

-- Personal workspaces: task children, tasks (self-references cut first), columns, members.
DELETE FROM dbo.tblTaskDependencies WHERE TaskId IN (SELECT Id FROM @K) OR DependsOnTaskId IN (SELECT Id FROM @K);
DELETE FROM dbo.tblTaskChecklist    WHERE TaskId IN (SELECT Id FROM @K);
UPDATE dbo.tblTaskComments SET ParentCommentId = NULL WHERE TaskId IN (SELECT Id FROM @K);
DELETE FROM dbo.tblTaskComments     WHERE TaskId IN (SELECT Id FROM @K);
DELETE FROM dbo.tblTimeEntries      WHERE TaskId IN (SELECT Id FROM @K);
DELETE FROM dbo.tblTaskAssignee     WHERE TaskId IN (SELECT Id FROM @K);
UPDATE dbo.tblTasks SET ParentTaskId = NULL WHERE Id IN (SELECT Id FROM @K);
DELETE FROM dbo.tblTasks            WHERE Id IN (SELECT Id FROM @K);
DELETE FROM dbo.tblKanbanColumns    WHERE WorkspaceId IN (SELECT Id FROM @W);
DELETE FROM dbo.tblWorkspaceMembers WHERE WorkspaceId IN (SELECT Id FROM @W) OR UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblWorkspaces       WHERE Id IN (SELECT Id FROM @W);

-- A real person reporting to a persona (set by hand during testing): nobody.
UPDATE dbo.tblUser SET ReportsTo = NULL
 WHERE ReportsTo IN (SELECT Id FROM @U) AND Id NOT IN (SELECT Id FROM @U);

DELETE FROM dbo.tblUserGroupMap WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblUser WHERE Id IN (SELECT Id FROM @U);
PRINT '137: personas ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DECLARE @G TABLE (Id INT PRIMARY KEY);
INSERT INTO @G SELECT Id FROM dbo.tblUserGroups WHERE Name = 'AM Central Desk';
DELETE FROM dbo.tblUserGroupMap WHERE GroupId IN (SELECT Id FROM @G);
DELETE FROM dbo.tblGroupModule  WHERE GroupId IN (SELECT Id FROM @G);
DELETE FROM dbo.tblGroupAccess  WHERE GroupId IN (SELECT Id FROM @G);
DELETE FROM dbo.tblUserGroups   WHERE Id IN (SELECT Id FROM @G);
PRINT '137: AM Central Desk role ' + CAST(@@ROWCOUNT AS VARCHAR(10));

COMMIT;
GO

-- Expected: Remaining = 0.
SELECT (SELECT COUNT(*) FROM dbo.tblUser       WHERE Username LIKE 'am[_]%')
     + (SELECT COUNT(*) FROM dbo.tblUserGroups WHERE Name = 'AM Central Desk')
     + (SELECT COUNT(*) FROM dbo.tblCustomer   WHERE Name    LIKE 'AM-%')
     + (SELECT COUNT(*) FROM dbo.tblTicket     WHERE Subject LIKE 'AM-%')
     + (SELECT COUNT(*) FROM dbo.tblLeads      WHERE Name    LIKE 'AM-%') AS Remaining;
GO
