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
-- What is "seed" (case-sensitive, never by id):
--   personas  Username LIKE 'am[_]%' AND FullName LIKE 'AM %'   (set @U)
--             -- their company is @CompId; every set below is in it
--   records   complaints / leads / customers whose CreatedBy is a persona.
--             Every 136 row is one of these (exact tags AM-Cnn / AM-Lnn /
--             AM-Cust- AND logged by a persona); the rest are records the
--             suites logged as personas. A persona exists only for testing,
--             so nothing a persona logged is real data. A real record never
--             matches, whatever its name ("AM-Tech", "Am-5 inverter").
--   role      tblUserGroups.Name = 'AM Central Desk' in @CompId
--
-- Children of the seed records are deleted. A persona's work on a REAL record
-- (a call, follow-up, activity row, attachment, quotation, notification it
-- caused) is never deleted: it is counted and PRINTed for the owner. Real
-- records still held by / escalated to / with an open follow-up for a persona
-- are released to nobody (counted and PRINTed), so no record is left with a
-- holder who does not exist.
--
-- Children, found on TestCRM 2026-11-22. sys.foreign_keys holds only a few
-- (tblTicket.CustomerId -> tblCustomer, tblPartnerCommission.LeadId ->
-- tblLeads, tblQuotationLine -> tblQuotation CASCADE, tblUserGroupMap /
-- tblGroupModule / tblGroupAccess -> tblUserGroups, and tblUser is referenced
-- by tblProjects, tblTaskAssignee, tblTaskComments, tblTasks (x2),
-- tblTeamMembers, tblTeams, tblTimeEntries, tblUserGroupMap). Every other
-- child is joined by convention (no FK), found by column name in
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
--             tasks, their attachments and children, columns, members),
--             tblUserGroupMap, tblUser, then the AM Central Desk role.
-- Refuses (THROW, nothing deleted) when a persona has tasks / teams /
-- projects / TAT rows / workspace memberships outside its own personal
-- workspace: real task data the access suites never touch, so a hit means
-- someone used a persona by hand; clean that by hand first.
-- Files of deleted attachments stay on disk under the uploads volume.
--
-- Idempotent: a second run deletes nothing and prints 0.
--
-- VERIFY AFTER APPLY (expected: one row, Remaining = 0):
--   SELECT (SELECT COUNT(*) FROM dbo.tblUser WHERE Username COLLATE Latin1_General_CS_AS LIKE 'am[_]%')
--        + (SELECT COUNT(*) FROM dbo.tblUserGroups WHERE Name = 'AM Central Desk')
--        + (SELECT COUNT(*) FROM dbo.tblCustomer WHERE Name    COLLATE Latin1_General_CS_AS LIKE 'AM-Cust-%')
--        + (SELECT COUNT(*) FROM dbo.tblTicket   WHERE Subject COLLATE Latin1_General_CS_AS LIKE 'AM-C[0-9][0-9] %')
--        + (SELECT COUNT(*) FROM dbo.tblLeads    WHERE Name    COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %') AS Remaining;
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
INSERT INTO @U SELECT Id FROM dbo.tblUser
 WHERE Username COLLATE Latin1_General_CS_AS LIKE 'am[_]%'
   AND FullName COLLATE Latin1_General_CS_AS LIKE 'AM %';

DECLARE @CompId BIGINT = (SELECT MIN(u.CompId) FROM dbo.tblUser u WHERE u.Id IN (SELECT Id FROM @U));
IF (SELECT COUNT(DISTINCT u.CompId) FROM dbo.tblUser u WHERE u.Id IN (SELECT Id FROM @U)) > 1
    THROW 50137, '137: personas span more than one company. Nothing was deleted.', 1;

-- Seed records: logged by a persona, in the personas' company.
DECLARE @T TABLE (Id INT PRIMARY KEY);
INSERT INTO @T SELECT Id FROM dbo.tblTicket
 WHERE CompId = @CompId AND CreatedBy IN (SELECT Id FROM @U);

DECLARE @L TABLE (Id INT PRIMARY KEY);
INSERT INTO @L SELECT Id FROM dbo.tblLeads
 WHERE CompId = @CompId AND CreatedBy IN (SELECT Id FROM @U);

DECLARE @Q TABLE (Id INT PRIMARY KEY);
INSERT INTO @Q SELECT Id FROM dbo.tblQuotation
 WHERE CompId = @CompId AND LeadId IN (SELECT Id FROM @L);

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
    + (SELECT COUNT(*) FROM dbo.tblWorkspaceMembers WHERE UserId IN (SELECT Id FROM @U)
         AND WorkspaceId NOT IN (SELECT Id FROM @W))
    + (SELECT COUNT(*) FROM dbo.tblTaskTat      WHERE UserId IN (SELECT Id FROM @U));
IF @foreign > 0
    THROW 50137, '137: a persona has tasks / teams / projects / TAT rows / workspace memberships outside its personal workspace. Clean those by hand first. Nothing was deleted.', 1;

-- ---- a persona's work on REAL records: counted, kept ------------------------
SELECT 'kept: persona work on real records' AS List, x.What, x.Rows
FROM (
    SELECT 'calls' AS What, COUNT(*) AS Rows FROM dbo.tblCall
     WHERE CompId = @CompId AND UserId IN (SELECT Id FROM @U)
       AND ISNULL(LeadId, 0) NOT IN (SELECT Id FROM @L) AND ISNULL(TicketId, 0) NOT IN (SELECT Id FROM @T)
    UNION ALL
    SELECT 'follow-ups created / done', COUNT(*) FROM dbo.tblFollowUp
     WHERE CompId = @CompId AND LeadId NOT IN (SELECT Id FROM @L)
       AND (CreatedBy IN (SELECT Id FROM @U) OR DoneBy IN (SELECT Id FROM @U))
    UNION ALL
    SELECT 'complaint activity', COUNT(*) FROM dbo.tblTicketActivity
     WHERE CompId = @CompId AND UserId IN (SELECT Id FROM @U) AND TicketId NOT IN (SELECT Id FROM @T)
    UNION ALL
    SELECT 'lead activity', COUNT(*) FROM dbo.tblLeadActivity
     WHERE CompId = @CompId AND UserId IN (SELECT Id FROM @U) AND LeadId NOT IN (SELECT Id FROM @L)
    UNION ALL
    SELECT 'attachments', COUNT(*) FROM dbo.tblAttachment
     WHERE CompId = @CompId AND UploadedBy IN (SELECT Id FROM @U)
       AND NOT (Entity = 'ticket' AND EntityId IN (SELECT Id FROM @T))
       AND NOT (Entity = 'lead' AND EntityId IN (SELECT Id FROM @L))
       AND NOT (Entity = 'quotation' AND EntityId IN (SELECT Id FROM @Q))
       AND NOT (Entity = 'task' AND EntityId IN (SELECT Id FROM @K))
    UNION ALL
    SELECT 'quotations', COUNT(*) FROM dbo.tblQuotation
     WHERE CompId = @CompId AND CreatedBy IN (SELECT Id FROM @U) AND Id NOT IN (SELECT Id FROM @Q)
    UNION ALL
    SELECT 'status / assignment history rows', COUNT(*) FROM (
        SELECT Id FROM dbo.tblTicketStatusHistory WHERE CompId = @CompId AND ChangedBy IN (SELECT Id FROM @U) AND TicketId NOT IN (SELECT Id FROM @T)
        UNION ALL SELECT Id FROM dbo.tblTicketAssignment WHERE CompId = @CompId AND TicketId NOT IN (SELECT Id FROM @T)
             AND (AssignedBy IN (SELECT Id FROM @U) OR FromUserId IN (SELECT Id FROM @U) OR ToUserId IN (SELECT Id FROM @U))
        UNION ALL SELECT Id FROM dbo.tblLeadStatusHistory WHERE CompId = @CompId AND ChangedBy IN (SELECT Id FROM @U) AND LeadId NOT IN (SELECT Id FROM @L)
        UNION ALL SELECT Id FROM dbo.tblLeadAssignment WHERE CompId = @CompId AND LeadId NOT IN (SELECT Id FROM @L)
             AND (AssignedBy IN (SELECT Id FROM @U) OR FromUserId IN (SELECT Id FROM @U) OR ToUserId IN (SELECT Id FROM @U))) h
    UNION ALL
    SELECT 'notifications a persona caused for real people', COUNT(*) FROM dbo.tblNotifications
     WHERE CompId = @CompId AND ActorUserId IN (SELECT Id FROM @U) AND UserId NOT IN (SELECT Id FROM @U)
       AND NOT (EntityType = 'ticket' AND EntityId IN (SELECT Id FROM @T))
       AND NOT (EntityType = 'lead' AND EntityId IN (SELECT Id FROM @L))
       AND NOT (EntityType = 'user' AND EntityId IN (SELECT Id FROM @U))
    UNION ALL
    SELECT 'day marks a persona set on real people', COUNT(*) FROM dbo.tblUserDayMark
     WHERE MarkedBy IN (SELECT Id FROM @U) AND UserId NOT IN (SELECT Id FROM @U)
    UNION ALL
    SELECT 'activity-log rows', COUNT(*) FROM dbo.tblActivityLog
     WHERE CompId = @CompId AND UserId IN (SELECT Id FROM @U)
       AND NOT (EntityType = 'Ticket' AND EntityId IN (SELECT Id FROM @T))
       AND NOT (EntityType = 'Lead' AND EntityId IN (SELECT Id FROM @L))
       AND NOT (EntityType = 'User' AND EntityId IN (SELECT Id FROM @U))
) x;

-- ---- seed records and their children ----------------------------------------
DELETE FROM dbo.tblNotifications
 WHERE CompId = @CompId
   AND (UserId IN (SELECT Id FROM @U)
        OR (EntityType = 'ticket' AND EntityId IN (SELECT Id FROM @T))
        OR (EntityType = 'lead'   AND EntityId IN (SELECT Id FROM @L))
        OR (EntityType = 'user'   AND EntityId IN (SELECT Id FROM @U)));
PRINT '137: notifications ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DELETE FROM dbo.tblCustomFieldValue
 WHERE CompId = @CompId
   AND ((Entity = 'ticket' AND EntityId IN (SELECT Id FROM @T))
        OR (Entity = 'lead' AND EntityId IN (SELECT Id FROM @L)));

DELETE FROM dbo.tblAttachment
 WHERE CompId = @CompId
   AND ((Entity = 'ticket'    AND EntityId IN (SELECT Id FROM @T))
        OR (Entity = 'lead'      AND EntityId IN (SELECT Id FROM @L))
        OR (Entity = 'quotation' AND EntityId IN (SELECT Id FROM @Q))
        OR (Entity = 'task'      AND EntityId IN (SELECT Id FROM @K)));
PRINT '137: attachments ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' (files stay on disk)';

DELETE FROM dbo.tblActivityLog
 WHERE CompId = @CompId
   AND ((EntityType = 'Ticket' AND EntityId IN (SELECT Id FROM @T))
        OR (EntityType = 'Lead' AND EntityId IN (SELECT Id FROM @L))
        OR (EntityType = 'User' AND EntityId IN (SELECT Id FROM @U)));

DELETE FROM dbo.tblTicketActivity WHERE CompId = @CompId AND TicketId IN (SELECT Id FROM @T);
DELETE FROM dbo.tblLeadActivity   WHERE CompId = @CompId AND LeadId   IN (SELECT Id FROM @L);

DELETE FROM dbo.tblCall
 WHERE CompId = @CompId AND (LeadId IN (SELECT Id FROM @L) OR TicketId IN (SELECT Id FROM @T));
PRINT '137: calls ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DELETE FROM dbo.tblFollowUp WHERE CompId = @CompId AND LeadId IN (SELECT Id FROM @L);
PRINT '137: follow-ups ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DELETE FROM dbo.tblPartnerCommission WHERE LeadId IN (SELECT Id FROM @L);
DELETE FROM dbo.tblQuotation WHERE Id IN (SELECT Id FROM @Q);   -- lines cascade
PRINT '137: quotations ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DELETE FROM dbo.tblTicketAssignment    WHERE CompId = @CompId AND TicketId IN (SELECT Id FROM @T);
DELETE FROM dbo.tblTicketStatusHistory WHERE CompId = @CompId AND TicketId IN (SELECT Id FROM @T);
DELETE FROM dbo.tblLeadAssignment      WHERE CompId = @CompId AND LeadId   IN (SELECT Id FROM @L);
DELETE FROM dbo.tblLeadStatusHistory   WHERE CompId = @CompId AND LeadId   IN (SELECT Id FROM @L);

DELETE FROM dbo.tblTicket WHERE Id IN (SELECT Id FROM @T);
PRINT '137: complaints ' + CAST(@@ROWCOUNT AS VARCHAR(10));
UPDATE dbo.tblTicket SET LinkedLeadId = NULL WHERE CompId = @CompId AND LinkedLeadId IN (SELECT Id FROM @L);
DELETE FROM dbo.tblLeads WHERE Id IN (SELECT Id FROM @L);
PRINT '137: leads ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- ---- real records pointing at a persona: released to nobody -----------------
DECLARE @released INT = 0;
UPDATE dbo.tblTicket SET AssignedTo = NULL, AssignedAt = NULL
 WHERE CompId = @CompId AND AssignedTo IN (SELECT Id FROM @U);
SET @released += @@ROWCOUNT;
UPDATE dbo.tblTicket SET EscalatedTo = NULL, EscalatedAt = NULL
 WHERE CompId = @CompId AND EscalatedTo IN (SELECT Id FROM @U);
SET @released += @@ROWCOUNT;
UPDATE dbo.tblLeads SET OwnerId = NULL, AssignedAt = NULL
 WHERE CompId = @CompId AND OwnerId IN (SELECT Id FROM @U);
SET @released += @@ROWCOUNT;
UPDATE dbo.tblFollowUp SET AssignedTo = NULL
 WHERE CompId = @CompId AND Status = 'open' AND AssignedTo IN (SELECT Id FROM @U);
SET @released += @@ROWCOUNT;
PRINT '137: real records / open follow-ups released from personas ' + CAST(@released AS VARCHAR(10));

DELETE c FROM dbo.tblCustomer c
 WHERE c.CompId = @CompId AND c.CreatedBy IN (SELECT Id FROM @U)
   AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket t WHERE t.CustomerId = c.Id)
   AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads  l WHERE l.CustomerId = c.Id)
   AND NOT EXISTS (SELECT 1 FROM dbo.tblQuotation q WHERE q.CustomerId = c.Id);
PRINT '137: customers ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- ---- people -------------------------------------------------------------------
DELETE FROM dbo.tblUserSession      WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblUserBranchAccess WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblUserDayMark      WHERE UserId IN (SELECT Id FROM @U);
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
DELETE FROM dbo.tblWorkspaceMembers WHERE WorkspaceId IN (SELECT Id FROM @W);
DELETE FROM dbo.tblWorkspaces       WHERE Id IN (SELECT Id FROM @W);

-- A real person reporting to a persona (set by hand during testing): nobody.
UPDATE dbo.tblUser SET ReportsTo = NULL
 WHERE CompId = @CompId AND ReportsTo IN (SELECT Id FROM @U) AND Id NOT IN (SELECT Id FROM @U);

DELETE FROM dbo.tblUserGroupMap WHERE UserId IN (SELECT Id FROM @U);
DELETE FROM dbo.tblUser WHERE Id IN (SELECT Id FROM @U);
PRINT '137: personas ' + CAST(@@ROWCOUNT AS VARCHAR(10));

DECLARE @G TABLE (Id INT PRIMARY KEY);
INSERT INTO @G SELECT Id FROM dbo.tblUserGroups WHERE Name = 'AM Central Desk' AND CompId = @CompId;
DELETE FROM dbo.tblUserGroupMap WHERE GroupId IN (SELECT Id FROM @G);
DELETE FROM dbo.tblGroupModule  WHERE GroupId IN (SELECT Id FROM @G);
DELETE FROM dbo.tblGroupAccess  WHERE GroupId IN (SELECT Id FROM @G);
DELETE FROM dbo.tblUserGroups   WHERE Id IN (SELECT Id FROM @G);
PRINT '137: AM Central Desk role ' + CAST(@@ROWCOUNT AS VARCHAR(10));

COMMIT;
GO

-- Expected: Remaining = 0.
SELECT (SELECT COUNT(*) FROM dbo.tblUser WHERE Username COLLATE Latin1_General_CS_AS LIKE 'am[_]%')
     + (SELECT COUNT(*) FROM dbo.tblUserGroups WHERE Name = 'AM Central Desk')
     + (SELECT COUNT(*) FROM dbo.tblCustomer WHERE Name    COLLATE Latin1_General_CS_AS LIKE 'AM-Cust-%')
     + (SELECT COUNT(*) FROM dbo.tblTicket   WHERE Subject COLLATE Latin1_General_CS_AS LIKE 'AM-C[0-9][0-9] %')
     + (SELECT COUNT(*) FROM dbo.tblLeads    WHERE Name    COLLATE Latin1_General_CS_AS LIKE 'AM-L[0-9][0-9] %') AS Remaining;
GO
