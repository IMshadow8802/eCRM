# 05 — Adversarial review of fix/security-holes (093 + backend diff)

Reviewed: `git diff` in /Users/ayushmishra/Developer/Nexus/CRM-security, backend/sql/093_security_holes.sql,
backend/tests/unit/routes/teamProjectRoutes.test.js. Every SP rewritten by 093 was diffed against the LIVE
OBJECT_DEFINITION on eCRM+ (SolarCRM menu grants also checked). Changed test files run green (5 suites, 289 tests).

Verdict on the intended diffs: sp_SaveTaskChecklist, sp_DeleteTaskChecklist, sp_ApplyKanbanTemplate,
sp_AddTaskDependency, sp_SaveTask, sp_ValidateUser, sp_FetchAccessibleBranchIds match live except for the
intended lines. No accidental behaviour change found beyond the notes below. No SQL module EXECs any of the
rewritten procs (sys.sql_expression_dependencies empty), so no hidden SQL caller breaks. Live data: 0
cross-workspace dependencies, 0 mis-parked task columns, 0 personal tasks with foreign assignees, 0 foreign
kanban columns — the tightened checks won't strand existing rows.

---

## HIGH-1 — S1 not fully closed: read side of the same checklist IDOR (sp_FetchTaskChecklist)
- File/SP: `taskController.getChecklist` → live `sp_FetchTaskChecklist`.
- Scenario: the controller authorises `TaskId` (caller's own task) but forwards the client's `Id`. The SP's
  `IF (@Id <> 0)` branch does `SELECT ... FROM tblTaskChecklist WHERE Id = @Id`, without checking TaskId or
  CompId. POST `/api/tasks/getTaskChecklist {TaskId: <mine>, Id: N}` returns the text, TaskId and state of
  item N in any task, in any company. Enumerating N reads every checklist step in the DB. This is the same
  pattern S1 fixed for save/delete.
- Fix: in 093 add `AND TaskId = @TaskId` to both the EXISTS and the SELECT of the `@Id <> 0` branch of
  sp_FetchTaskChecklist. Or have the controller force `Id: 0`; neither client ever sends Id>0 (mobile/web send
  Id:0). Doing both costs nothing.

## MED-1 — Deploy window silently creates workspaces with zero board columns (S3 signature change)
- File/SP: `workspaceController.save` / `applyTemplate` ↔ `sp_ApplyKanbanTemplate` (new `@UserId`, `@IsAdmin`).
- Scenario A (SQL applied first, the order 093 prescribes): the old backend calls without `@UserId`, so the
  SP returns 403. `save` does not treat that as an error: it reads `ColumnsCreated ?? 0`, the workspace is
  created, and it has no columns. Tasks created there get `ColumnId NULL` and the board is empty. The damage
  persists after the backend deploy. `applyTemplate` 403s for everyone during the window.
- Scenario B (backend deployed first): node-mssql sends `@UserId`/`@IsAdmin` to the old proc, which fails
  with "too many arguments". `save` swallows it (catch → console.error) and you get the same zero-column
  workspace.
- 093's header covers the checklist-delete window but not this one.
- Fix: apply 093 and deploy the backend back-to-back. Add a post-deploy check to the verify block:
  `SELECT w.Id FROM tblWorkspaces w WHERE w.Type<>'personal' AND NOT EXISTS (SELECT 1 FROM tblKanbanColumns k WHERE k.WorkspaceId=w.Id AND k.IsActive=1)`.
  Re-apply the template to any rows it returns. Optionally make `save` surface a non-2xx template result
  instead of reporting success.

## MED-2 — SQL-side fixes have no automated proof; verify block skips S4, S5, S7
- Files: tests/unit/** (all mocked DB), 093 verify section.
- The new Jest tests prove the controller and middleware wiring, and each would fail without its JS change
  (checked: the S1 TaskId 400/forwarding, the S3 UserId/IsAdmin params, the S8 assertRecordAccess call, the
  S2 route 403s). But the actual hole-closing logic for S1/S3/S4/S5/S6/S7 lives in SQL, and mocked tests can't
  catch a regression there (CLAUDE.md says the same). The verify block exercises 1/2/3/6/8 only. There is
  nothing for S4 (cross-workspace blocker → 404), S5a (edit with a foreign WorkspaceId/ColumnId → 400),
  S5b (personal task assigned to non-owner → 400), or S7 (user whose only group is inactive → Self/IsAdmin 0).
  The S3 snippet also runs without a caller, so it never proves that a non-manager member is refused or that
  an owner is allowed.
- Fix: add BEGIN TRAN/ROLLBACK verify snippets for S4, S5a, S5b, S7. Add an S3 case with a real member
  `@UserId` (role='member') that expects 403, and one with the owner that expects 201.

## MED-3 — Checklist update gated by change_status: an assigned viewer can rewrite step text (pre-existing, adjacent to S1)
- File: `taskController.saveChecklist` (`Id > 0 ? "change_status" : "manage_checklist"`).
- Scenario: per sp_CheckTaskPermission, an assigned **viewer** gets change_status but not manage_checklist.
  For Id>0 the SP updates ItemText and SortOrder as well as IsCompleted. So a viewer, who must not "manage
  artifacts" (063), can rename or reorder any step of a task assigned to them. The permission class only fits
  a pure tick.
- Fix: in the controller, use manage_checklist for an update unless only IsCompleted changed. Or split the
  SP so the change_status path writes only IsCompleted.

## LOW-1 — JWT IsAdmin vs req.scope.isAdmin can still disagree for multi-group users (S6/S7 consistency)
- SPs: `sp_ValidateUser` (IsAdmin = EXISTS any active admin group) vs `sp_FetchAccessibleBranchIds`
  (IsAdmin from the TOP 1 group by HierarchyLevel).
- Scenario: Admin and Sales/Support/HR Head are all HierarchyLevel 2 (live). A user mapped to Admin + Sales
  Head gets JWT IsAdmin=1, which drives the kanban/team/project/user fetch and delete SPs, socket rooms and
  client UI. But req.scope.isAdmin, which drives requireAdmin, requireMenuRight, sp_CheckTaskPermission and
  sp_SaveTask, is decided by a non-deterministic TOP 1 tie. The two flags can split, and they can flip between
  requests. Not exploitable today (every user has exactly one group), but the stated goal was "the same flag".
- Fix: in sp_FetchAccessibleBranchIds, compute `@IsAdmin` as an EXISTS over active groups, as ValidateUser
  does. Or add `ug.IsAdmin DESC` as a tie-breaker after HierarchyLevel.

## LOW-2 — tblUser.IsAdmin is now dead but still editable/displayed
- Files: web `pages/Master/components/UserForm.jsx` (IsAdmin checkbox), `pages/Master/Users.jsx` (IsAdmin
  column), `sp_FetchUser` (returns u.IsAdmin), `sp_SaveUser` (writes it).
- Scenario: an admin ticks "IsAdmin" for a user and sees it saved and shown in the grid, but it grants
  nothing. User 4 on eCRM+ is the reverse case: the column says 0 but the user is an effective admin through
  the Admin group. The UI is now misleading in both directions. Not a hole; it confuses whoever audits access.
- Fix: hide the checkbox and column, or derive the displayed value from the group in sp_FetchUser. Drop the
  column later.

## LOW-3 — Old tokens keep the column-based IsAdmin for up to 24h after deploy
- `JWT_EXPIRE=24h` (prd and solarcrm). Tokens issued before the deploy carry the old flag. Live data: no
  non-admin-group user has the column set, so nobody is over-privileged today; user 4 just won't gain admin
  until re-login. Informational. If needed, rotating JWT_SECRET forces re-login for everyone.

## LOW-4 — requireMenuRight 'save' resolution trusts loose `Number(body.Id)`
- File: `middleware/permission.js` requireMenuRight.
- `Id: -1`, `"abc"`, `null` all resolve to "add", and `true` / `[5]` resolve to "edit". It doesn't matter
  today: every granted group has both CanAdd and CanEdit, and the SPs 404/no-op a bad Id. But a future
  add-only grant could edit with `Id: "5"` only if the controller then coerces differently. teamController
  uses `Id === 0` for its log text, so `Id: "0"` would log "updated".
- Fix: resolve with the same `positiveInt` the controllers use, and 400 on a non-integer Id.

## LOW-5 — Remaining adjacent integrity gaps in sp_SaveTask (not in S5 scope)
- `@ParentTaskId` is only checked for existence (any task, any company/workspace). `@TeamId` is checked for
  IsActive but not CompId. `@ProjectId` isn't checked at all. A member can link their task to a foreign
  parent, team or project id. Whether this leaks depends on what sp_FetchTask joins for display (parent
  title / project name).
- Fix: add `AND WorkspaceId = @WorkspaceId` for ParentTaskId and `AND CompId = @CompId` for TeamId and
  ProjectId while sp_SaveTask is being rewritten anyway.

## LOW-6 — getTimeEntries accepts a client `UserId` for non-admins (adjacent, verify)
- File: `taskController.getTimeEntries`: `UserId: UserId || (isAdmin ? null : req.user.UserId)`.
- With no TaskId, a non-admin can pass any UserId and list that user's time entries. I didn't confirm
  whether sp_FetchTimeEntry's scope predicate limits this. Worth one check: force `req.user.UserId` for
  non-admins.

## Checked, no finding
- sp_CheckMenuRight semantics: it requires CanView (matches the sidebar), active user, active group,
  IsAllowed menu, and ORs across multiple groups. An unknown @Right gives NULL, which means deny. Live grants
  on both eCRM+ and SolarCRM: Owner/Admin get full rights, and HR Manager gets add/edit but not delete on
  /teams and /projects (duplicate HR rows in tblGroupAccess are harmless). No other caller of save/delete
  Team/Project exists outside the Master pages, and mobile doesn't use them.
- S8: sp_CheckTaskPermission already resolves the task from @CommentId (live); action view_task is fine.
- S3: sp_SaveWorkspace inserts the creator as an `owner`/`active` member, so the creator passes the new
  check for shared/project. Personal workspaces are checked by OwnerUserId.
- S1 clients: web useTaskChecklist and mobile deleteTaskChecklist already send TaskId.
- S5: no legacy personal tasks have foreign assignees, so edits won't start failing. Moving the task-exists
  404 before validation only reorders error codes.
- S7: the ORDER BY change correctly prefers an active group, and a user whose only group is inactive falls
  to Self/level 4/non-admin.
