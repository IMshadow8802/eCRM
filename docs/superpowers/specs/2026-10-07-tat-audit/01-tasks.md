# Task management audit — 2026-10-07

Read-only. Sources: SP bodies from the live DB (`OBJECT_DEFINITION`, DB = `eCRM+`), `backend/src/controllers/{task,workspace,kanban,attachment}Controller.js`, `middleware/permission.js`, web `pages/Task/**`, `components/Kanban/**`, `components/TopNav.jsx`, mobile `features/tasks/**`, `api/taskQueries.ts`. Live numbers are counts only. Anything not verified against code/SP text is marked **(unverified)**.

Live data snapshot (eCRM+): 39 tasks (17 open, 9 of those overdue), 13 workspaces (6 personal / 5 shared / 2 project), 20 active users, 38 assignee rows, 3 multi-assignee tasks, 4 unassigned (all shared, all open), 29 comments, 0 dependencies, 0 time entries, 0 labels, 0 watchers, 0 ParentTaskId/TeamId/ProjectId, Type = `task` only, priorities used: critical 1 / high 16 / medium 22 / low 0. Integrity checks all clean: 0 orphan assignee rows, 0 inactive assignees, 0 non-member assignees, 0 tasks without a column, 0 tasks in archived/deleted workspaces, 0 dependency orphans, 0 inactive users as active members, 0 IsBlocked drift, 0 legacy-mirror drift. Dirty: 2 task + 2 comment notifications point at deleted rows; **8 completed tasks sit outside a "Done" column and 1 open task sits in one**; **tblTaskReads: 64 rows, FirstSeenAt and LastSeenAt both 0/64**.

---

## 1. How it works today (concise)

**Workspaces** (`tblWorkspaces`, `tblWorkspaceMembers`)
- `personal`: seeded lazily by `sp_SeedDefaultWorkspace` (web calls `ensurePersonalWorkspace` on first board visit; 14 of 20 active users have none yet). Owner-only; `sp_CheckTaskPermission` returns allowed for owner and denies everyone else including admins.
- `shared`: `sp_AddWorkspaceMember` creates a `pending` row + `workspace_invite` notification; `sp_RespondWorkspaceInvite` → `active`/`declined` (decline leaves `IsActive=1`). `project`: direct add (`active`), plus manual "Sync from team" (`sp_SyncProjectWorkspaceMembers`).
- Roles owner/manager/member/viewer. Owner/manager add members, change roles (not the owner's), remove members; any member can leave (owner notified). Ownership transfer: owner or admin, target must be an active member; old owner becomes manager. Personal → shared conversion is one-way, owner-only.
- Archive: owner or admin. Delete: only when archived; full hard cascade in one transaction (tasks, comments, checklist, deps, time, attachments, columns, members) with a dry-run blast-radius count.
- **What happens to tasks** on member removal/leave/sync-out: nothing — assignments stay. On archive: nothing — tasks stay listed and editable. On delete: hard-deleted.

**Tasks** (`tblTasks` — note: **no CompId/BranchId column**; tenancy is via `WorkspaceId → tblWorkspaces.CompId`)
- Create (`sp_SaveTask`, Id=0): `create_task` (owner/manager/member). Requires WorkspaceId and **≥1 checklist item**. Column defaults to the first column. Assignees from `AssigneeIdsJson` (legacy `AssignedToUserId` alias); in shared/project each must be an active member. `tblTaskAssignee` rows + `tblTaskReads` delivery rows (shared/project only). Controller notifies newly added assignees (`sp_NotifyTaskAssigned`, skips self) and emits socket invalidations.
- Edit (Id>0): one gate, `edit_fields` (owner/manager, or the member who created it). Every column is overwritten from the payload except `ColumnId` (COALESCE). Assignee set replaced only if a set was sent; removed rows are **hard-deleted**; added rows get `AssignedAt=GETDATE()`. No notification to removed people, none for due-date/priority changes.
- Move column: `sp_MoveTaskColumn`, gated `change_status` (owner/manager, any assignee incl. viewer, member-creator). No ordering inside a column (no SortOrder on tasks; list order is IsCompleted, priority, DueDate, Id).
- Due date: `DATE` only. Priority: free string, UI offers low/medium/high/critical.
- Completion: **only** the checklist. `sp_SaveTaskChecklist` / `sp_DeleteTaskChecklist` → `sp_RecomputeTaskCompletion` sets `IsCompleted`, `CompletedDate`, `CompletedByUserId` when all items done; un-ticking or adding an item reopens (clears both). On completion, `sp_ResolveDependencies` clears `IsBlocked` on dependents. Tick = `change_status`; add/remove item = `manage_checklist` (owner/manager, member who is assignee or creator; not viewers). Columns carry no meaning.
- Delete: `sp_DeleteTask` / `sp_BulkDeleteTasks` are **hard** deletes, gated `delete_task` (owner/manager; member-creator only if nobody else is assigned or has commented) — and refused with 409 while any checklist item exists.
- Dependencies: `sp_AddTaskDependency` (gate `add_dependency` on the dependent task only), BFS cycle check, sets stored `IsBlocked`. `sp_FetchTask` recomputes IsBlocked live. Nothing enforces the block.
- Comments: threaded (1 level), edit own, soft-delete, pin (owner/manager). `sp_NotifyCommentAdded` notifies creator + every assignee (+ parent author on reply); never in personal workspaces; never watchers; no @mentions. Fetching comments marks all read (`tblCommentReads`).
- Activity: `logActivity` rows per action; task updates are a generic "Task X updated" (no field diff).
- Attachments: `tblAttachment` Entity='task', gated `manage_attachments`, ids resolved from the DB row (done right).
- Realtime: socket.io invalidation to `workspace:<id>` / `user:<id>`, only when the client sends a `WorkspaceId` hint. Web only; mobile refetches on focus.
- Time: `tblTimeEntries` + "Log time" (unused, 0 rows).

**Clients**
- Web: `/tasks` = one board per active workspace (fetch PageSize 200), text search only, card multi-select → bulk delete, detail modal (Details/Checklist/Comments/Dependencies/Time/History). **No cross-workspace "my tasks" view. No single-task delete.**
- Mobile: `MyWorkScreen` fetches every visible task (`WorkspaceId:null, PageSize:200`) and filters Mine/Unassigned/All client-side from `AssigneesJson`; `TaskDetailScreen` with action sheet (log time, move, edit, add blocker, delete). No notifications screen at all.

---

## 2. Bugs

Severity reflects impact on a 15-person company and on the TAT feature.

### HIGH

**B1. Checklist IDOR — tick/rename/delete any checklist item in any task, any company.**
`taskController.saveChecklist` (taskController.js:790-883) and `deleteChecklist` (941-1002) authorise against the **client-supplied `TaskId`**, then call `sp_SaveTaskChecklist` / `sp_DeleteTaskChecklist`, which act on the item `@Id` and only check that it exists (`IF NOT EXISTS (SELECT 1 FROM tblTaskChecklist WHERE Id=@Id)`), never that it belongs to `@TaskId` or to the caller's company.
Repro: as any member assigned to task A, POST `/api/tasks/saveTaskChecklist {Id:<item of task B>, TaskId:A, ItemText:"x", IsCompleted:true}` → item of B is renamed and ticked; `sp_RecomputeTaskCompletion` then runs on **A**, so B's completion state is also left wrong. `deleteTaskChecklist {Id:<item of B>, TaskId:A}` deletes B's step. Ids are sequential bigints.
Why it matters for TAT: completion closes clocks; anyone could "complete" anyone's task.
Fix: in both SPs, `WHERE Id=@Id AND TaskId=@TaskId` (404 otherwise); recompute the item's real TaskId. Same pattern as attachments (row decides the parent). Size S.

**B2. `applyKanbanTemplate` has no permission or tenant check.**
`workspaceController.applyTemplate` (workspaceController.js:395-429) → `sp_ApplyKanbanTemplate` only checks `EXISTS (tblWorkspaces WHERE Id=@WorkspaceId)` — no CompId match, no role check. Any logged-in user of any company can add columns to any workspace id (stamped with the caller's CompId/BranchId). Also re-applying a template duplicates columns (bypasses the duplicate-title 409 in `sp_SaveKanbanColumn`).
Repro: viewer POSTs `/api/workspaces/applyKanbanTemplate {WorkspaceId:<any>, TemplateKey:"scrum"}` → 201.
Fix: CompId check + owner/manager/admin (personal: owner) gate + skip titles that already exist. Size S.

**B3. Web notifications never open the task.**
`TopNav.jsx:144-161` navigates to `/tasks?taskId=<id>` and `/tasks?commentId=<id>`; nothing under `pages/Task` reads the query string (no `useSearchParams` anywhere there). Clicking "New task assigned" lands on whatever board was last active — often a different workspace — with no modal. Comment notifications carry a CommentId, so even a fix needs a comment→task lookup.
For a WFH team this is the primary hand-off channel. TAT warnings/breaches (spec F6/F7) will ride this same broken link.
Fix: TaskBoard reads `taskId` → fetch the task → switch active workspace to `task.WorkspaceId` → open modal; for `commentId`, have `sp_NotifyCommentAdded` store `EntityType='task', EntityId=TaskId` (or resolve server-side). Size S–M.

**B4. Deleting a task is effectively impossible.**
`sp_SaveTask` refuses a create without ≥1 checklist item; `sp_DeleteTask` and `sp_BulkDeleteTasks` refuse (409 "Clear checklist items before deleting this task") while any item exists. 37/39 live tasks have items. Web has **no single-task delete** and its only delete (bulk, TaskBoard.jsx:264-281) will 409 on any normal task; mobile's Delete (TaskDetailScreen action sheet) 409s unless the user first deletes every step one by one.
Fix: delete checklist rows inside the delete transaction (the guard is a leftover from before checklists were mandatory). Prefer soft delete (see R4) because TAT history must survive. Size S.

**B5. Removing a member (or deactivating a user) leaves them assigned.**
`sp_RemoveWorkspaceMember` and `sp_SyncProjectWorkspaceMembers` set the member row inactive and never touch `tblTaskAssignee`; user deactivation doesn't either (unverified where deactivation lives, but no SP touching `tblTaskAssignee` exists besides save/delete paths). The person keeps open assignments on tasks they can no longer open (`sp_CheckTaskPermission` → "not a workspace member"). 0 such rows today, but with TAT every one of those is a guaranteed breach on someone who cannot act, and the manager sees the task as "owned".
Fix: on remove/leave/sync-out/deactivate, delete their `tblTaskAssignee` rows on open tasks of that workspace (and close TAT clocks with reason `member_removed`), notify the owner which tasks became unassigned. Size S–M.

**B6. Cross-tenant title leak via dependencies.**
`sp_AddTaskDependency` gates only `@TaskId` (add_dependency); `@DependsOnTaskId` is checked only for existence — any company, any personal workspace. `sp_FetchTaskDependencies` then returns that task's `Title` and `ColumnTitle` to the caller.
Repro: member of any shared workspace POSTs `addTaskDependency {TaskId:<own>, DependsOnTaskId:<n>}` for n = 1..N, then `fetchTaskDependencies` → titles of other companies' / colleagues' private tasks. It also lets an outsider task block yours.
Fix: require same workspace (or at least same CompId + `view_task` on the blocker). Size S.

### MEDIUM

**B7. `sp_SaveTask` trusts the client's `WorkspaceId` on update.**
On update, the member check uses `COALESCE(@WorkspaceId, task.WorkspaceId)` and the column check uses `@WorkspaceId` from the body; the task's own workspace is never re-read. Passing the id of your own personal workspace (`Type='personal'` → member check skipped) lets an editor assign non-members; passing another workspace id + one of its column ids parks the card in a foreign column (shows as "Uncategorized"). Fix: on update, ignore `@WorkspaceId` and use the task's. Size S.

**B8. "Seen" does not exist — `FirstSeenAt` is never written.**
No SP or code writes `tblTaskReads.FirstSeenAt`/`LastSeenAt` (0/64 rows). `sp_FetchTask` single-fetch inserts a row with only `DeliveredAt` for **any** viewer (managers included), not assignees; `sp_SaveTask` inserts delivery rows at assignment. The spec (§3 and F7 "Assigned → Seen → Started") assumes this works. Nothing in web/mobile reads it either. Size S to fix (stamp FirstSeenAt/LastSeenAt for the caller in the single-task fetch).

**B9. Hard dependency blocks are not enforced (CLAUDE.md §6 says they are).**
No SP checks `IsBlocked`/open blockers before a tick, a column move, or completion; UI only shows a chip (KanbanCard.jsx:129, TaskDetailModal.jsx:165). Also when a blocker is reopened (un-ticked), dependents are not re-blocked in the stored column (display is fine because `sp_FetchTask` recomputes). 0 dependencies in use, so impact is latent — but TAT will clock a blocked assignee. No notification when a task becomes unblocked.

**B10. Kanban columns are branch-scoped.**
`sp_FetchKanbanColumn` filters `kc.BranchId IN (@AccessibleBranchIdsJson)` (or `= @BranchId`); a column carries the branch of whoever created it. A Self/Team/Branch-scope member from another branch gets zero columns → "No columns yet" on a board full of tasks. This is exactly the bug ROLES.md says was removed from tasks. Latent: 5 cross-branch member rows today, all All/Company scope. Fix: membership gate (or `sp_CheckTaskPermission`-style workspace check), drop branch predicate. Size S.

**B11. Archived workspaces keep live tasks.**
`sp_CheckTaskPermission` ignores `IsArchived`; `sp_FetchTask` (all-workspaces mode, used by mobile MyWork) has no archive filter. Archived-board tasks still show under "Mine" and stay editable. With TAT, the sweep would keep breaching them. 0 today.

**B12. Mobile personal tasks are created unassigned.**
Web auto-assigns the owner in a personal workspace (TaskCreateModal submit, `isPersonal ? [currentUserId]`); mobile `saveTask` defaults `AssigneeIds = []` (api/taskQueries.ts:125) and `TaskFormScreen` starts with an empty picker. Such tasks never appear under mobile "Mine", and would get no clock.

**B13. Admin abilities differ on every surface.**
Server: `IsAdmin` = full bypass on shared/project. Web: `canDragCard` honours admin (TaskBoard.jsx:82-88) but `canEditOthersTasks`/`canCreateTasks` are role-only (useWorkspaceStore.js:56-63), so an admin who isn't a member can drag cards but the detail modal is read-only and "+" is hidden. Mobile: `adminBypass` requires `role !== null` (taskHelpers.ts:222), so the same admin gets nothing — not even `comment` (taskHelpers.ts:230).

**B14. Two competing "status" notions.**
Completion = checklist; the board column = free text. Live: 8 completed tasks are not in a Done-like column, 1 open task sits in one. Dragging a card to "Done" does nothing; ticking the last step does not move the card. Managers reading the board are misled. Also the known one: an assignee can drag a card (change_status) but the Column select in TaskDetailModal is disabled for them (`canEditThisTask`, TaskDetailModal.jsx:277) because it goes through saveTask/edit_fields.

**B15. Column management gate ignores invite state.**
`sp_SaveKanbanColumn` / `sp_DeleteKanbanColumn` check `IsActive=1 AND Role IN ('owner','manager')` but not `InviteStatus='active'`; a pending or declined invitee (decline keeps IsActive=1) invited as manager can add/rename/delete columns.

**B16. Deleting the last column orphans every task.**
`sp_DeleteKanbanColumn` with no remaining column sets `ColumnId = NULL` on all its tasks (they appear in "Uncategorized"). `sp_SaveKanbanColumn` also accepts `IsActive=0`, which "deletes" a column without moving its tasks.

**B17. Member-creator can reset their own clock / reassign freely.**
`edit_fields` lets a member who created a task change its assignees, due date, priority. Unassign + reassign deletes and re-creates the `tblTaskAssignee` row with a fresh `AssignedAt`. Today harmless; under D6 ("reassignment opens a new clock") a member who self-assigned can restart their own clock before it breaches.

### LOW

- **B18.** `sp_FetchTask` admin branch for `WorkspaceId IS NULL` tasks has no CompId filter → cross-company list (0 such tasks today).
- **B19.** Delete paths leave dangling `tblNotifications` (2 task + 2 comment rows today); `sp_DeleteWorkspace` doesn't delete `tblCommentReads`; `tblTaskDependencies`/`tblTaskReads` have no FKs.
- **B20.** `markTaskCommentRead` (`sp_MarkCommentRead`) has no access/tenant check — any user can insert read receipts on any comment id.
- **B21.** Mobile fetches comments with `PageSize:25`, ordered oldest-first (TaskDetailScreen.tsx:139 → api/taskQueries.ts:215), so on a thread > 25 the newest comments are never shown. Web uses 100. Latent (max 6 today).
- **B22.** `sp_SoftDeleteTask` is dead and broken (updates non-existent `tblTasks.Status`, joins `tblProjects`). Drop it.
- **B23.** Comment notifications skip watchers; Labels/Watchers have no UI (0 rows) yet both clients re-send them on every edit; `sp_SaveTask @Dependencies` is accepted and ignored.
- **B24.** Task history can't show reassignment or field changes — `save` logs only "Task X updated" (taskController.js:103-109).
- **B25.** Personal-workspace assignees are not validated in `sp_SaveTask`; via API anyone can be assigned (and notified) on a task they can never open.
- **B26.** Realtime emits are skipped whenever the client omits the `WorkspaceId` hint (save/delete/comment); any caller that forgets it leaves other screens stale (by design, noted).

---

## 3. Gaps / missing features — ranked by value to a 15-person WFH company

1. **Web "My work / Today" across workspaces.** A manager assigns into 3 boards; the employee has to click through each board on web. Mobile has it (client-side filter over 200 rows). Needs a server-side `@AssigneeUserId` / `@OnlyOpen` filter in `sp_FetchTask` — the spec's Today page needs the same thing.
2. **Notifications you can act on** — B3 on web; **mobile has no notifications at all** (no screen, no fetcher). Spec F9 adds one; until then a mobile-only field worker never learns of new work except by opening MyWork.
3. **Tell the assigner when it's done.** No notification on completion, reopen, or unblock. Manager has to poll boards. Also no due-tomorrow / overdue reminder (no scheduler exists — the TAT sweep will be the first).
4. **"Started / in progress" signal.** Nothing distinguishes "not touched" from "being worked on"; columns are free text. TAT needs a Start (spec has it) — make it automatic on first progress (see §5).
5. **Due time.** `DueDate` is a DATE; "by 3 pm today" cannot be expressed. Collides with TAT (§5).
6. **Claim an unassigned task.** `claim_task` exists in `sp_CheckTaskPermission` but no endpoint uses it; 4 open shared tasks are unassigned and only owner/manager/creator can assign.
7. **Board filters**: assignee, priority, overdue, "mine", completed hidden. Only free-text search exists.
8. **Delete that works / undo** (B4), and soft delete for history.
9. **Recurring daily tasks** (daily report, daily calls). None. Also no task templates — every task needs hand-typed steps.
10. **@mentions + watchers** (columns exist, no UI, not notified).
11. **Workload view** for managers (open/overdue per person) — the spec's Today manager view covers this.
12. Ordering within a column; bulk reassign/move; subtasks (retired, `ParentTaskId` unused — fine to drop).

---

## 4. Inconsistencies web ↔ mobile ↔ backend

| Area | Backend | Web | Mobile |
|---|---|---|---|
| Admin non-member on shared/project | full bypass | can drag; modal read-only; no "+" | no abilities, cannot even comment (B13) |
| Move column as assignee | allowed (`change_status`) | drag yes; Column select in modal disabled | "Move to column" yes |
| Personal task assignee | not validated | auto = owner | defaults to nobody (B12) |
| Delete task | hard, 409 if any step | bulk only (always 409) | single delete (409 unless steps removed) |
| Notifications | written for task/comment/workspace | bell; task/comment links dead (B3) | none |
| Comments page | paged | 100 | 25, oldest first (B21) |
| Dependencies | any task id, any company (B6) | picker = same workspace | picker = same workspace |
| "My tasks" | no assignee filter | none | client-side over 200 rows |
| Realtime | socket emits | yes | no socket; refetch on focus |
| Blocked | stored + computed, not enforced | chip only | form re-sends `IsBlocked` |
| Column mgmt by non-active invitee | allowed (B15) | hidden by role | n/a |

---

## 5. Interactions with the TAT spec (what must change in the spec)

1. **"Seen" is not available** (§3 table, F7 timeline). `tblTaskReads.FirstSeenAt` is never written (B8). Either add the write to the single-task fetch (assignee only) in 093, or drop "Seen" from the timeline.
2. **Clock open/close hooks need more than "sp_SaveTask reports a new assignee".** `sp_SaveTask` returns only *added* assignees. To close clocks with `unassigned`, it must also return *removed* ones (3rd result set). Other paths that end an assignment and must close clocks: `sp_RemoveWorkspaceMember`, `sp_SyncProjectWorkspaceMembers`, user deactivation, workspace archive, `sp_DeleteTask`, `sp_BulkDeleteTasks`, `sp_DeleteWorkspace` (hard cascades). Add close reasons `member_removed`, `archived`, `user_inactive`. Fix B5 first or the sweep will breach people who can't open the task.
3. **Hard deletes destroy TAT history.** All three delete paths physically delete the task. `tblTaskTat` must either not FK to `tblTasks` (and keep `TaskTitle` snapshot) or tasks must become soft-deleted (recommended, R4). Spec says CloseReason `deleted` — say how the row survives.
4. **Completion is task-level, clocks are per-assignee (D5).** One co-assignee ticking the last step completes *every* assignee's clock, and the slow one is credited. Spec should state this explicitly (or make completion per-assignee — large). `CompletedByUserId` is single.
5. **Completion can be gamed without doing the work.** An assignee has `manage_checklist`: deleting the remaining open steps completes the task (`sp_DeleteTaskChecklist` → recompute). Combined with B1 (any item, any task) this must be closed before clocks count: (a) fix B1; (b) once a task has an open clock, only owner/manager/creator may *delete* steps, or deleting the last open step does not complete. Decide and write it into F4.
6. **Reopen semantics.** Adding a step to a completed task reopens it (recompute clears `CompletedDate`). Spec: "reopening reopens clocks closed as completed". Specify whether the time between completion and reopen counts (it shouldn't), and that a manager adding a step re-arms the employee's resolution clock.
7. **DueDate vs resolution target.** Two deadlines will disagree (high = 4 h target but DueDate next week; low = 3 d but due today). 9/17 open tasks are already past DueDate. Recommended rule: if `DueDate` is set, `ResolutionDueAt` = shift end of that date on the assignee's calendar; else the priority default. Without a rule, chips and reports contradict the card's red due date. Consider adding a due time (`DueAt DATETIME`) at the same time.
8. **Priority change mid-flight** — spec silent. Tickets use anchor-preserving restamp; do the same (from `AssignedAt`) and say so.
9. **Start = explicit button only will under-report.** People drag cards and tick steps; they will forget "Start". Recommend: StartedAt is stamped by the first progress act by that assignee — Start button, checklist tick, column move, time log (all `change_status`/`log_time`). Keep it idempotent.
10. **Blocked tasks.** A dependency block is outside the assignee's control. Either the sweep treats "has open blocker" as an automatic hold (system reason `blocked`, logged), or blocks are enforced and auto-hold. Today blocks are not enforced at all (B9). Dependencies are unused (0 rows), so the cheap option is to state "blocked = held".
11. **Archived workspaces**: sweep must skip them (B11), and archive should close/hold clocks.
12. **Self-assigned / personal-workspace tasks**: say whether they get clocks. Recommend: no clock in personal workspaces (no manager, private even from admins — TAT on them would also leak into manager reports, contradicting "private even from admins").
13. **Reassign-to-reset (B17)**: with D6 a member-creator can unassign/reassign themselves to restart a clock before breach. Rule: re-adding the same user to the same task within N minutes resumes the previous clock, or only owner/manager may change assignees once a clock is open.
14. **Notifications rely on a broken link** (B3) and mobile has no notification list. Fix B3 in the TAT web phase; F9 must add the mobile screen and its deep link.
15. **Today page data**: needs `sp_FetchTask` with `@AssigneeUserId`, `@OnlyOpen` server-side filters (mobile MyWork's 200-row client filter won't scale to a manager view). Add to 093.
16. **Tenancy**: `tblTasks` has no CompId; `tblTaskTat`, `tblTaskHold`, `tblTaskTatReason` must carry CompId copied from the workspace at open time (spec §5 says so — just note the source).
17. **Assignee with no calendar on a task in another branch** — calendar is per user (fine), but holiday "per branch" should use the assignee's branch, not the workspace's. State it.
18. **Column ≠ status** (spec already says so) — but users will expect "Done" column = done (B14). Consider auto-moving to the last column on completion, or labelling the column chip "Done ✓" from completion. Otherwise "why is my Done task breaching" support calls.

---

## 6. Recommended fixes to fold in

| # | What | Why | Size |
|---|---|---|---|
| R1 | Checklist SPs: match `Id` to `TaskId`, recompute the item's real task (B1) | Security + TAT integrity | S |
| R2 | `applyKanbanTemplate`: tenant + role gate, skip duplicate titles (B2) | Cross-tenant write | S |
| R3 | Dependencies: same-workspace (or same company + view) check for `DependsOnTaskId` (B6) | Cross-tenant leak | S |
| R4 | Task delete: soft delete (`IsDeleted`, `DeletedAt/By`) replacing the 409 checklist guard; web single delete in the modal; filter deleted everywhere (B4) | Delete is broken; TAT history must survive | M |
| R5 | `sp_SaveTask` update: use the task's own WorkspaceId for member/column checks; return removed assignees as a result set (B7, spec §5.2) | Integrity + clock close hook | S |
| R6 | On member remove/leave/sync/deactivate/archive: unassign open tasks in that workspace, notify owner, close clocks (B5, B11) | No phantom owners; no unfair breaches | M |
| R7 | Stamp `FirstSeenAt`/`LastSeenAt` for assignees on single-task fetch (B8) | Spec's "Seen" step | S |
| R8 | Web deep link `?taskId=` / comment → task; switch workspace + open modal (B3) | Notifications are the hand-off | S |
| R9 | `sp_FetchTask` filters `@AssigneeUserId`, `@OnlyOpen`, `@Overdue`, exclude archived; web "My work" page (or fold into Today) (Gap 1) | Daily driver for WFH staff | M |
| R10 | Completion/reopen/unblock notifications to creator + assigner | Manager stops polling | S |
| R11 | Kanban fetch/manage: membership gate, drop branch predicate, require `InviteStatus='active'`, block deleting the last column (B10, B15, B16) | Cross-branch blank boards | S |
| R12 | Align ability helpers: web store + mobile `abilitiesFor` honour `IsAdmin` without a role; web Column select allowed for assignees via `moveTaskColumn` (B13, B14 known) | Same rules on every surface | S |
| R13 | Mobile: personal task defaults to owner; comments PageSize 100 / newest-first (B12, B21) | Consistency | S |
| R14 | Auto-start clock on first progress act; blocked = auto-hold; DueDate → ResolutionDueAt rule; no clocks in personal workspaces (spec §5.7-5.12) | Correct TAT | M (in spec scope) |
| R15 | Restrict step deletion on tasks with an open clock to owner/manager/creator (spec §5.5) | Stops "complete by deleting" | S |
| R16 | Claim endpoint wiring `claim_task` ("Take this task") | Unassigned tasks get picked up and clocked | S |
| R17 | Log field/assignee diffs in task history (B24) | Audit trail for disputes about breaches | S |
| R18 | Clean-ups: drop `sp_SoftDeleteTask`; delete notifications/comment-reads on delete; CompId on admin orphan branch; `sp_MarkCommentRead` gate (B18-B22) | Hygiene | S |
| R19 | Dead columns: plan to drop `Progress`, `LoggedHours` (derive from time entries), `TeamId`, `ProjectId` on tasks, `ParentTaskId`, `Type`, stored `IsBlocked` (computed on read already), `AssignedToUserId` mirror (still used for the 1-row join in `sp_FetchTask` — replace with AssigneesJson only), `@Dependencies` param, Labels/Watchers unless a UI is built. Do **not** drop in 093; list for a later cleanup script. | Every edit currently round-trips 8 dead fields | M (later) |
| R20 | Optional, high value for daily work: recurring tasks (daily/weekly template that spawns a task at shift start via the sweep) | Managers re-typing the same daily task | L |

Order suggestion: R1–R3 (security) and R4–R8 belong in the same SQL batch as 093, since TAT depends on them; R9–R13 ride with the web/mobile phases; R19–R20 after.
