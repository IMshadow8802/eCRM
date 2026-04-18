-- ============================================================
-- Migration 008 — Wipe transactional data + reseed demo roster
--
-- Wipes: all users, tasks, leads, follow-ups, projects, teams,
--        kanban columns, time entries, comments, checklists,
--        activity logs, group access, user-group map, branch access
-- Keeps: tblBranch, tblUserGroups, tblMenu, tblStatus, tblLeadSource
--
-- Reseeds: 10 demo users (first names only) spanning all 5 branches
--          and all 4 hierarchy levels, all sharing Super's bcrypt
--          hash so login-as-anyone works for the demo.
--
-- Then re-grants per-group menu permissions so each role's menu
-- is visibly different on login.
--
-- Run in [eCRM+] in SSMS as a single script.
-- ============================================================

USE [eCRM+]
GO

SET XACT_ABORT ON;
GO

-- ============================================================
-- Step 1: Wipe in FK-safe order
-- ============================================================
BEGIN TRANSACTION;

DELETE FROM tblActivityLog;
DELETE FROM tblTaskActivity;
DELETE FROM tblTaskChecklist;
DELETE FROM tblTaskComments;
DELETE FROM tblTimeEntries;

-- tblTasks has self-FK ParentTaskId; null parents first to avoid FK error
UPDATE tblTasks SET ParentTaskId = NULL WHERE ParentTaskId IS NOT NULL;
DELETE FROM tblTasks;

DELETE FROM tblFollowUp;
DELETE FROM tblLeads;
DELETE FROM tblKanbanColumns;
DELETE FROM tblProjects;
DELETE FROM tblTeamMembers;
DELETE FROM tblTeams;
DELETE FROM tblUserBranchAccess;
DELETE FROM tblUserGroupMap;
DELETE FROM tblGroupAccess;
DELETE FROM tblUser;

COMMIT TRANSACTION;
GO

PRINT '✓ Wipe complete';
GO

-- ============================================================
-- Step 2: Reset IDENTITY seeds so new IDs start at 1
-- ============================================================
DBCC CHECKIDENT ('tblUser',             RESEED, 0);
DBCC CHECKIDENT ('tblTasks',            RESEED, 0);
DBCC CHECKIDENT ('tblLeads',            RESEED, 0);
DBCC CHECKIDENT ('tblFollowUp',         RESEED, 0);
DBCC CHECKIDENT ('tblProjects',         RESEED, 0);
DBCC CHECKIDENT ('tblTeams',            RESEED, 0);
DBCC CHECKIDENT ('tblTeamMembers',      RESEED, 0);
DBCC CHECKIDENT ('tblTaskComments',     RESEED, 0);
DBCC CHECKIDENT ('tblTaskChecklist',    RESEED, 0);
DBCC CHECKIDENT ('tblTimeEntries',      RESEED, 0);
DBCC CHECKIDENT ('tblTaskActivity',     RESEED, 0);
DBCC CHECKIDENT ('tblActivityLog',      RESEED, 0);
DBCC CHECKIDENT ('tblKanbanColumns',    RESEED, 0);
DBCC CHECKIDENT ('tblUserBranchAccess', RESEED, 0);
DBCC CHECKIDENT ('tblUserGroupMap',     RESEED, 0);
DBCC CHECKIDENT ('tblGroupAccess',      RESEED, 0);
GO

PRINT '✓ Identity seeds reset';
GO

-- ============================================================
-- Step 3: Seed 10 demo users
-- All share Super's bcrypt hash so you can log in as anyone.
-- Branch spread: HEAD OFFICE(1)x4, SOUTH EXTENSION(2)x2,
--                INDIRAPURAM(3)x1, SADHNA(4)x1, GOLDEN I(5)x1
--                + 1 Super at HEAD OFFICE = 10 total (counts above
--                  exclude Super's row to avoid double counting).
-- ============================================================
BEGIN TRANSACTION;

DECLARE @Pwd VARCHAR(500) = '$2b$12$X/xxDttdfVDGMhvdeYL77e4vQDgjFEXUbaioeQFIBuC82xczrzypq';

INSERT INTO tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, GroupId, CompId, BranchId)
VALUES
  -- Super Admins (HierarchyLevel=1, DataScope=Company) ───────────────
  ('Super',  @Pwd, 1, 1, '', 0, 'Super',  'super@nexus.local',  'Super Admin',     0,   1, 1, 1),  -- HEAD OFFICE
  ('Ayush',  @Pwd, 1, 1, '', 0, 'Ayush',  'ayush@nexus.local',  'Owner',           0,   1, 1, 1),  -- HEAD OFFICE

  -- Admins (HierarchyLevel=2, DataScope=Company) ────────────────────
  ('Raaj',   @Pwd, 1, 0, '', 0, 'Raaj',   'raaj@nexus.local',   'Admin',           0,   2, 1, 1),  -- HEAD OFFICE
  ('Aman',   @Pwd, 1, 0, '', 0, 'Aman',   'aman@nexus.local',   'Admin',           0,   2, 1, 2),  -- SOUTH EXTENSION

  -- Project Managers (HierarchyLevel=3, DataScope=MultiBranch) ──────
  ('Priya',  @Pwd, 1, 0, '', 0, 'Priya',  'priya@nexus.local',  'Project Manager', 120, 3, 1, 3),  -- INDIRAPURAM
  ('Rohan',  @Pwd, 1, 0, '', 0, 'Rohan',  'rohan@nexus.local',  'Project Manager', 120, 3, 1, 4),  -- SADHNA

  -- Team Lead (HierarchyLevel=3, DataScope=Team) ────────────────────
  ('Neha',   @Pwd, 1, 0, '', 0, 'Neha',   'neha@nexus.local',   'Team Lead',       100, 4, 1, 1),  -- HEAD OFFICE

  -- Developers / Employees (HierarchyLevel=4, DataScope=Self) ───────
  ('Vikram', @Pwd, 1, 0, '', 0, 'Vikram', 'vikram@nexus.local', 'Developer',       75,  5, 1, 1),  -- HEAD OFFICE
  ('Kavya',  @Pwd, 1, 0, '', 0, 'Kavya',  'kavya@nexus.local',  'Developer',       75,  5, 1, 2),  -- SOUTH EXTENSION
  ('Suresh', @Pwd, 1, 0, '', 0, 'Suresh', 'suresh@nexus.local', 'Employee',        65,  5, 1, 5);  -- GOLDEN I

COMMIT TRANSACTION;
GO

PRINT '✓ 10 users seeded';
GO

-- ============================================================
-- Step 4: tblUserGroupMap — mirror tblUser.GroupId into the
-- junction table so loadScope's sp_FetchAccessibleBranchIds works.
-- ============================================================
BEGIN TRANSACTION;

INSERT INTO tblUserGroupMap (UserId, GroupId)
SELECT Id, GroupId FROM tblUser;

COMMIT TRANSACTION;
GO

PRINT '✓ tblUserGroupMap populated';
GO

-- ============================================================
-- Step 5: tblUserBranchAccess — give the two MultiBranch managers
-- some cross-branch access so the demo actually shows scope filtering.
--
--   Priya (primary INDIRAPURAM=3) → +SADHNA(4) read+write, +GOLDEN I(5) read-only
--   Rohan (primary SADHNA=4)      → +INDIRAPURAM(3) read-only
-- ============================================================
BEGIN TRANSACTION;

DECLARE @SuperId INT = (SELECT Id FROM tblUser WHERE Username = 'Super');
DECLARE @PriyaId INT = (SELECT Id FROM tblUser WHERE Username = 'Priya');
DECLARE @RohanId INT = (SELECT Id FROM tblUser WHERE Username = 'Rohan');

INSERT INTO tblUserBranchAccess (UserId, BranchId, CanRead, CanWrite, CompId, CreatedBy)
VALUES
  (@PriyaId, 4, 1, 1, 1, @SuperId),  -- Priya can read+write SADHNA
  (@PriyaId, 5, 1, 0, 1, @SuperId),  -- Priya can only read GOLDEN I
  (@RohanId, 3, 1, 0, 1, @SuperId);  -- Rohan can only read INDIRAPURAM

COMMIT TRANSACTION;
GO

PRINT '✓ tblUserBranchAccess seeded';
GO

-- ============================================================
-- Step 6: tblGroupAccess — per-role menu permissions
--
-- Menu IDs (from tblMenu):
--   1=Dashboard, 2=Tasks, 3=Projects, 4=Teams, 5=Users,
--   6=Kanban Columns, 7=Lead Source, 8=Status, 9=Leads,
--   10=Follow-up, 11=Reports, 12=Followups User-wise,
--   13=Lead Summary Branch-wise
--
-- Group IDs:
--   1=Super Admins, 2=Admins, 3=Project Managers,
--   4=Team Leads,  5=Developers
-- ============================================================
BEGIN TRANSACTION;

-- ─── Super Admins (group 1): everything, full CRUD ───────────────
INSERT INTO tblGroupAccess (GroupId, MenuId, CanAdd, CanEdit, CanDelete, CanView)
SELECT 1, Id, 1, 1, 1, 1 FROM tblMenu;

-- ─── Admins (group 2): everything, full CRUD ─────────────────────
INSERT INTO tblGroupAccess (GroupId, MenuId, CanAdd, CanEdit, CanDelete, CanView)
SELECT 2, Id, 1, 1, 1, 1 FROM tblMenu;

-- ─── Project Managers (group 3): operational + reports, no admin ─
INSERT INTO tblGroupAccess (GroupId, MenuId, CanAdd, CanEdit, CanDelete, CanView) VALUES
  (3,  1, 0, 0, 0, 1),  -- Dashboard
  (3,  2, 1, 1, 1, 1),  -- Tasks
  (3,  3, 1, 1, 1, 1),  -- Projects
  (3,  4, 0, 0, 0, 1),  -- Teams (view-only)
  (3,  9, 1, 1, 1, 1),  -- Leads
  (3, 10, 1, 1, 1, 1),  -- Follow-up
  (3, 11, 0, 0, 0, 1),  -- Reports (parent — view-only)
  (3, 12, 0, 0, 0, 1),  -- Followups User-wise
  (3, 13, 0, 0, 0, 1);  -- Lead Summary Branch-wise

-- ─── Team Leads (group 4): mostly view, can manage tasks ─────────
INSERT INTO tblGroupAccess (GroupId, MenuId, CanAdd, CanEdit, CanDelete, CanView) VALUES
  (4,  1, 0, 0, 0, 1),  -- Dashboard
  (4,  2, 1, 1, 0, 1),  -- Tasks (add/edit, no delete)
  (4,  3, 0, 0, 0, 1),  -- Projects
  (4,  4, 0, 0, 0, 1),  -- Teams
  (4,  9, 0, 0, 0, 1),  -- Leads
  (4, 10, 0, 0, 0, 1);  -- Follow-up

-- ─── Developers (group 5): minimal — dashboard, own tasks, reports
INSERT INTO tblGroupAccess (GroupId, MenuId, CanAdd, CanEdit, CanDelete, CanView) VALUES
  (5,  1, 0, 0, 0, 1),  -- Dashboard
  (5,  2, 1, 1, 0, 1),  -- Tasks (add/edit own)
  (5, 11, 0, 0, 0, 1),  -- Reports (parent)
  (5, 12, 0, 0, 0, 1);  -- Followups User-wise

COMMIT TRANSACTION;
GO

PRINT '✓ tblGroupAccess matrix in place';
GO

-- ============================================================
-- Step 7: Verification queries (so you see what landed)
-- ============================================================
PRINT '';
PRINT '=== Seeded users ===';
SELECT u.Id, u.Username, u.FullName, u.JobTitle,
       ug.Name AS Role, ug.HierarchyLevel, ug.DataScope,
       b.BranchName AS PrimaryBranch
FROM tblUser u
LEFT JOIN tblUserGroups ug ON u.GroupId = ug.Id
LEFT JOIN tblBranch b      ON u.BranchId = b.Id
ORDER BY ug.HierarchyLevel, u.Id;

PRINT '';
PRINT '=== Per-role menu permissions ===';
SELECT ug.Name AS Role, m.Description AS Menu,
       ga.CanView AS V, ga.CanAdd AS A, ga.CanEdit AS E, ga.CanDelete AS D
FROM tblGroupAccess ga
JOIN tblUserGroups ug ON ug.Id = ga.GroupId
JOIN tblMenu m        ON m.Id = ga.MenuId
WHERE ug.Id IN (1, 2, 3, 4, 5)
ORDER BY ug.HierarchyLevel, m.Id;

PRINT '';
PRINT '=== Cross-branch access grants ===';
SELECT u.Username, b.BranchName AS GrantedBranch,
       uba.CanRead, uba.CanWrite
FROM tblUserBranchAccess uba
JOIN tblUser u   ON u.Id = uba.UserId
JOIN tblBranch b ON b.Id = uba.BranchId
ORDER BY u.Username, b.BranchName;

PRINT '';
PRINT '✓ Migration 008 complete — restart backend, then log in as Super/Ayush/Raaj/Aman/Priya/Rohan/Neha/Vikram/Kavya/Suresh';
GO
