-- =============================================================================
-- 060_task_only_role.sql
--
-- Creates a "Task Collaborator" role that can see EXACTLY ONE menu (Tasks), and
-- moves Vikas (UserId 11) onto it, stripping every other permission he has.
--
-- Vikas is currently a Branch Manager (GroupId 13), which grants Dashboard,
-- Tasks, Sales, Pipeline, Leads, Follow-ups, Support, Ticket Board, Tickets and
-- every Sales/Support report. After this he sees Tasks and nothing else.
--
-- Access is a matrix of two independent axes, both keyed to the group:
--   * tblUserGroups.DataScope  -> WHICH ROWS   ('Self' = only his own)
--   * tblGroupAccess (per menu)-> WHICH SCREENS (here: Tasks only)
-- Tasks specifically are membership-governed, not scope-governed: he will see
-- exactly the workspaces he has been invited to and accepted, and inside them
-- his authority comes from his workspace role (owner/manager/member/viewer).
-- A 'member' can create tasks, fully edit their own, and comment/tick checklist
-- items on tasks assigned to them -- which is the "client collaborator" shape.
--
-- SAFE TO RE-RUN. Creating the role and remapping Vikas are both idempotent.
--
-- !! Menu rights are read at LOGIN (sp_ValidateUser returns them alongside the
-- !! JWT). Vikas must log out and back in before the sidebar changes.
--
-- !! Menu rights are NOT enforced server-side yet -- they only drive the
-- !! sidebar. Hiding Sales from this role does not stop a determined caller
-- !! from hitting /api/leads/fetchLeads directly. DataScope='Self' still limits
-- !! the rows he would get back, but see the note at the bottom of this file
-- !! before putting a genuine external client on this role.
-- =============================================================================

SET NOCOUNT ON;
BEGIN TRY
BEGIN TRAN;

DECLARE @CompId    BIGINT = 1;
DECLARE @BranchId  BIGINT = 1;
DECLARE @UserId    INT    = 11;          -- Vikas
DECLARE @TasksMenu INT    = 2;           -- tblMenu.Id for 'Tasks' (Route /tasks)
DECLARE @GroupId   INT;

-- Guard: fail loudly rather than silently granting the wrong screen if the menu
-- ids ever get reshuffled.
IF NOT EXISTS (SELECT 1 FROM tblMenu WHERE Id = @TasksMenu AND Description = 'Tasks')
    THROW 50001, 'Menu id 2 is not Tasks -- check tblMenu before running this.', 1;

IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @UserId AND Username = 'Vikas')
    THROW 50002, 'User id 11 is not Vikas -- check tblUser before running this.', 1;

-- ---------------------------------------------------------------------------
-- 1. The role. Self scope, bottom of the hierarchy, explicitly NOT IsAdmin
--    (IsAdmin is a role property, not a rank -- it grants the
--    sp_CheckTaskPermission bypass over every workspace, which a collaborator
--    must never have).
-- ---------------------------------------------------------------------------
SELECT @GroupId = Id FROM tblUserGroups WHERE Name = 'Task Collaborator' AND CompId = @CompId;

IF @GroupId IS NULL
BEGIN
    INSERT INTO tblUserGroups (Name, Description, IsActive, CompId, BranchId, HierarchyLevel, DataScope, IsAdmin)
    VALUES ('Task Collaborator',
            'Tasks screen only. For clients and outside collaborators invited to a shared workspace.',
            1, @CompId, @BranchId, 4, 'Self', 0);
    SET @GroupId = SCOPE_IDENTITY();
END
ELSE
BEGIN
    UPDATE tblUserGroups
       SET IsActive = 1, HierarchyLevel = 4, DataScope = 'Self', IsAdmin = 0
     WHERE Id = @GroupId;
END

-- ---------------------------------------------------------------------------
-- 2. Its menu access: Tasks and nothing else.
--    CanDelete stays 0 -- a collaborator should not be able to delete tasks.
--    (Task-level authority is still enforced by sp_CheckTaskPermission on top
--    of this; these flags only drive the screen's Add/Edit affordances.)
-- ---------------------------------------------------------------------------
DELETE FROM tblGroupAccess WHERE GroupId = @GroupId;

INSERT INTO tblGroupAccess (GroupId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
VALUES (@GroupId, @TasksMenu, 1, 1, 1, 0);

-- ---------------------------------------------------------------------------
-- 3. Move Vikas onto it, dropping every permission he had before.
-- ---------------------------------------------------------------------------
DELETE FROM tblUserGroupMap WHERE UserId = @UserId;
INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@UserId, @GroupId);

COMMIT TRAN;
PRINT 'OK - Vikas moved to Task Collaborator (GroupId ' + CAST(@GroupId AS VARCHAR(10)) + ')';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT 'FAILED - ' + ERROR_MESSAGE();
    THROW;
END CATCH
GO

-- =============================================================================
-- Verify after apply
-- =============================================================================
-- 1. Vikas is on exactly one group, and it is the new one:
--
-- SELECT u.Username, g.Id AS GroupId, g.Name, g.DataScope, g.HierarchyLevel, g.IsAdmin
-- FROM tblUserGroupMap m
-- JOIN tblUser u        ON u.Id = m.UserId
-- JOIN tblUserGroups g  ON g.Id = m.GroupId
-- WHERE m.UserId = 11;
-- -- expect ONE row: Vikas | <new id> | Task Collaborator | Self | 4 | 0
--
-- 2. That group can see exactly one menu:
--
-- SELECT m.Id, m.Description, ga.CanView, ga.CanAdd, ga.CanEdit, ga.CanDelete
-- FROM tblGroupAccess ga
-- JOIN tblMenu m ON m.Id = ga.MenuId
-- WHERE ga.GroupId = (SELECT Id FROM tblUserGroups WHERE Name = 'Task Collaborator');
-- -- expect ONE row: 2 | Tasks | 1 | 1 | 1 | 0
--
-- 3. What his sidebar will actually build from (this is the exact query
--    sp_ValidateUser runs at login):
--
-- SELECT DISTINCT m.Id, m.Description, m.Route, ga.CanView, ga.CanAdd, ga.CanEdit, ga.CanDelete
-- FROM tblMenu m
-- JOIN tblGroupAccess ga   ON m.Id = ga.MenuId
-- JOIN tblUserGroupMap ugm ON ga.GroupId = ugm.GroupId
-- JOIN tblUserGroups ug    ON ugm.GroupId = ug.Id
-- WHERE ugm.UserId = 11 AND m.IsAllowed = 1 AND ga.CanView = 1 AND ug.IsActive = 1;
-- -- expect ONE row: Tasks /tasks
--
-- 4. Then: Vikas logs out and logs back in. Menu rights are cached in the JWT
--    payload at login, so until he does he still sees the old sidebar.
--
-- To put anyone else on this role, only step 3 is needed:
--   DELETE FROM tblUserGroupMap WHERE UserId = <id>;
--   INSERT INTO tblUserGroupMap (UserId, GroupId)
--   VALUES (<id>, (SELECT Id FROM tblUserGroups WHERE Name = 'Task Collaborator'));
-- =============================================================================

-- =============================================================================
-- NOT FIXED BY THIS SCRIPT -- read before onboarding a real external client
-- =============================================================================
-- a) Menu rights are sidebar-only. There is no server-side check that a caller's
--    group has CanView on the menu behind an endpoint, so this role hides Sales
--    and Support from the UI but does not block the APIs. DataScope='Self'
--    narrows the rows returned, and tasks are membership-gated, so the exposure
--    is limited -- but it is not zero, and it is the thing to close before an
--    outside party gets an account.
--
-- b) The role seed appears to have run twice: groups 9-17 are duplicated as
--    18-26 (all the duplicates have 0 members), and every tblGroupAccess row for
--    group 13 exists twice. Harmless today only because sp_ValidateUser uses
--    SELECT DISTINCT. Worth a cleanup script of its own.
--
-- c) GroupId 8 does not exist, yet it is the fallback in BOTH
--    userController.save ('GroupId = 8 // Default to General Users') and
--    sp_SaveUser ('ELSE BEGIN SET @GroupId = 8; END'). A user saved without an
--    explicit group therefore gets a tblUserGroupMap row pointing at nothing:
--    no scope, no menus, empty sidebar. Nothing is currently broken by it
--    (0 orphan rows today) but the next user created without a group will hit it.
-- =============================================================================
