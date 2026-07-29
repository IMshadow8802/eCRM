# Workspace & Task Permission Model — Design

**Date:** 2026-07-29
**Status:** proposed, pending review
**Supersedes:** the permission sections of `backend/WORKSPACES.md` §1 and `backend/ROLES.md`
(both to be updated as each workstream lands)

Written after a full audit of the shared-workspace and task-collaboration code
against live data. This is the reference the five workstreams in §7 build
against.

---

## 1. Why this exists

The module works, is in production, and is accumulating bugs of a consistent
shape: the permission *matrix* is sound, but the code around it is not. Three
read paths bypass it entirely, two of its actions are unreachable, the UI's
approximation of it can't express half its states, and one structural choice
(single assignee) makes a five-person shared board a one-person board with
spectators.

Rather than patch each symptom, this document states how each workspace type
**should** behave in real use, so the fixes have something to be correct
against.

---

## 2. The core principle

The model today derives task authority from a tangle of workspace role,
creator identity, and a single assignee column. That is why a 5-member board
has 3 actors. The correction is to separate two questions that were merged:

> **Workspace role sets the ceiling. Task relationship grants the working
> rights inside it.**

And beneath that, one distinction that every rule hangs off:

| Class | Actions | Who |
|---|---|---|
| **Progress** — *doing* the work | tick/untick a checklist item, move a card between columns, log time | anyone assigned to it (plus owner/manager) |
| **Definition** — *deciding* the work | title, description, due date, dependencies, assignees, delete | owner/manager, and the task's creator |

The codebase already encodes this split as `change_status` vs `edit_fields`.
It is applied wrongly in one critical place: dragging a card — the single most
obvious progress gesture — is classified as `edit_fields`, so the assignee
cannot move their own work. Ticking every box completes the task while the card
sits in "To Do".

Between the two sits a third class:

| Class | Actions | Who |
|---|---|---|
| **Work artifacts** — the material of the work | add/edit/delete checklist items, attach/remove files | assignees, the creator, owner/manager |

The person doing the work decides the steps and holds the evidence. A checklist
step routinely needs a document against it — a signed form, a screenshot, a
report — so attaching is part of doing the work, not part of defining it.
Neither confers definition rights.

Today both are gated as `edit_fields` (owner/manager/creator): checklist items
via `taskController.saveChecklist`, and attachments via
`attachmentController.save`, which calls `assertRecordAccess(..., "write")` and
`TASK_ACTION.write` maps to `edit_fields`. So an assignee can tick a box but
cannot add a step or attach the document that proves it.

---

## 3. Workspace types

### 3.1 Personal

**Scenario:** my own list. Braindump, private notes, things not ready to show
anyone.

- Owner only. No members, no invites, no assignment (implicitly always self).
- **Private even from admins** — not "admins shouldn't", actually blocked.
- Convertible to shared, one-way, when it outgrows being private.

**Status: correct today. No changes.** `sp_CheckTaskPermission` explicitly
blocks the admin bypass for `Type='personal'`, and
`sp_ConvertWorkspaceToShared` exists.

### 3.2 Shared

**Scenario:** a team board — "Q3 Sales Push", "Client X Onboarding".
Membership is deliberate: you invite, they accept.

- **Visibility is binary.** An `active` member sees every task on the board.
  No per-task hiding — per-task visibility inside a shared board is a
  permissions maze with no real use case here.
- Invite → `pending` → member accepts → `active`. Only `active` grants anything.
- Owner invites and removes. Manager runs the work but not the roster.

### 3.3 Project

**Scenario:** a board bound to a project record. Membership is *inherited*,
not invited.

- Members **derive continuously from the project team**. Added to the project →
  on the board. Removed → off it.
- Project manager → workspace `manager`. Team members → `member`.
- **No manual invites.** Hand-adding people makes the board drift from the
  project team and leaves no authoritative answer to "who is on this project".
- Task authority: identical to shared.

**Change from today:** membership is *snapshotted* at creation, so the board
drifts the moment the project team changes. `sp_SyncProjectWorkspaceMembers`
exists but is not continuous. → sync, don't snapshot.

---

## 4. Permission matrix (shared & project)

`viewer` is a real role in the schema (`CK_tblWorkspaceMembers_Role`) with zero
live rows today. It is specified here so it stops being latent.

| Action | owner | manager | member | viewer |
|---|:--:|:--:|:--:|:--:|
| View board & tasks | ✅ | ✅ | ✅ | ✅ |
| Comment / reply | ✅ | ✅ | ✅ | ✅ |
| Edit / delete **own** comment | ✅ | ✅ | ✅ | ✅ |
| Create task | ✅ | ✅ | ✅ | ❌ |
| **Progress** (tick, move column, log time) | ✅ | ✅ | if assigned | if assigned |
| **Manage checklist items** (add/edit/delete) | ✅ | ✅ | if assigned or creator | ❌ |
| **Attach / remove files** | ✅ | ✅ | if assigned or creator | ❌ |
| **Define** (title, desc, dates, deps) | ✅ | ✅ | if creator | ❌ |
| **Delete task** | ✅ | ✅ | if creator **and** untouched (§4.2) | ❌ |
| Assign / unassign others | ✅ | ✅ | if creator | ❌ |
| **Claim an unassigned task** | ✅ | ✅ | ✅ | ❌ |
| Moderate comments (delete others', pin) | ✅ | ✅ | ❌ | ❌ |
| Invite / remove members | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |

Company admins (`tblUserGroups.IsAdmin`) bypass on shared/project only, never
personal — unchanged.

### 4.1 Three deliberate changes

**Multi-assignee.** A task holds a *set* of assignees. Every assignee gets
progress + checklist rights. Without this, one person is a bottleneck on a
board shared with five.

**Self-claim.** Any `member` can assign themselves to an **unassigned** task.
This is what stops assignment becoming the new bottleneck — work lands on the
board, whoever is free picks it up. Claiming an *already-assigned* task
requires definition rights (it's a reassignment).

**Viewers can progress tasks assigned to them — but not redefine the steps.**
Today a viewer holding an assigned task cannot tick a box on it, which makes
assigning to a viewer meaningless. If you assign work to someone they can do
the work. But an assigned viewer ticks existing boxes only: they cannot add,
edit or delete checklist items. That keeps `viewer` genuinely limited, which is
the role an external client or outside collaborator gets. `viewer` remains
"read + comment" for everyone *not* assigned.

### 4.2 Deleting a task

A `member` may delete a task they created **only while it is still just
theirs** — no other assignee, and no comments by anyone else. Once another
person is assigned or has commented, the task carries other people's work and
deleting it becomes an owner/manager decision.

Owner and manager may always delete. This replaces today's rule, where the
creator can always delete regardless of who else has contributed.

---

## 5. Cross-cutting invariants

These hold for every workspace type. Each is currently violated.

1. **Only `active` membership grants anything.** `pending`, `declined` and
   `removed` grant nothing. Today `IsActive` is set to 1 at *invite* time and
   never cleared on decline, and the two gates that matter (`sp_CheckTaskPermission`,
   `sp_FetchTask`) filter on `IsActive` alone — so a user who declined keeps
   full read and write on the board indefinitely.

2. **Assignment implies membership.** Only an `active` member can be assigned.
   Assigning anyone else produces a notification that leads to a 404.

3. **Membership is never scoped by branch.** A project deliberately spans
   branches and departments. `sp_FetchTask` gets this right; `sp_FetchWorkspaces`
   still `AND`s branch scope onto membership, so a cross-branch member sees the
   tasks but not the board they belong to — and a cross-branch invite is
   unacceptable through the UI because the workspace never renders.

4. **Every task-scoped endpoint authorizes.** Reads included. Comments,
   checklist and time entries currently have no check at any layer — not
   membership, not even `CompId`.

5. **The UI offers exactly what the server permits** — no control that will
   403, no hidden action that would succeed. Both directions are violated today.

6. **Completion is derived from the checklist, and derivation never destroys
   history.** Emptying a checklist may set `IsCompleted = 0`; it must not NULL
   `CompletedDate` / `CompletedByUserId`.

---

## 6. Data model changes

| Change | Why |
|---|---|
| **New `tblTaskAssignee`** (`TaskId`, `UserId`, `AssignedAt`, `AssignedByUserId`; unique on `TaskId,UserId`) | multi-assignee |
| Backfill from `tblTasks.AssignedToUserId`, then keep that column as a **derived mirror of the first assignee** — written from the set, read by nothing that decides anything. Dropped in a follow-up. | see below |
| `sp_CheckTaskPermission`: new actions `manage_checklist` and `manage_attachments`; they and `change_status` consult the assignee **set** | §2, §4 |
| `attachmentController` save/delete pass `manage_attachments` for `Entity='task'` instead of `"write"` | assignees hold the evidence. Lead/ticket attachments are unaffected — `assertRecordAccess` ignores `level` for those entities |
| Membership lookups gain `AND InviteStatus = 'active'` | invariant 1 |
| `sp_SaveTask`: validate every assignee is an active member | invariant 2 |
| `sp_FetchWorkspaces`: branch becomes an optional filter, not a gate | invariant 3 |
| `sp_SaveTimeEntry`: drop the `INNER JOIN tblProjects` gate, delegate to `sp_CheckTaskPermission` | §7.3 |
| `sp_RecomputeTaskCompletion`: stop NULLing the completion audit columns | invariant 6 |
| `tblTasks.WorkspaceId` → `NOT NULL` | kills a dead orphan-fallback branch that yields permanently read-only ghost tasks |

### 6.1 Why the column survives this migration (revised 2026-07-29)

The original plan was a straight replacement. A full inventory of every
assignee reference changed that, for three reasons:

1. **The row shape is contractual.** `sp_FetchTask` returns `AssignedToUserId`
   and `AssigneeName` as scalars, and the whole web tree reads them directly.
   Changing the shape and the storage in one step means every consumer breaks
   at once, with no way to bisect which change caused it.
2. **`LEFT JOIN tblUser assignee ON assignee.Id = t.AssignedToUserId` fans out
   under M2M.** A task with two assignees would return twice — and because the
   join appears in both the count query and the page query, pagination would
   quietly disagree with itself rather than fail loudly.
3. **`IX_tblTasks_WorkspaceId_ColumnId` INCLUDEs the column**, so the drop
   fails until the index is rebuilt, and the FK name is system-generated
   (`FK__tblTasks__Assign__6754599E`) so it differs per environment — a
   hardcoded drop passes on dev and fails on prod.

So: `tblTaskAssignee` is authoritative for every decision — permission,
visibility, notification fan-out, writes. `AssignedToUserId` is reduced to a
mirror of the first assignee, maintained by `sp_SaveTask`, consulted by nothing
that branches. `sp_FetchTask` keeps the scalar columns *and* adds an
`AssigneesJson` array plus `AssigneeCount`, so old consumers keep working while
new UI renders the full set.

This is not the two-sources-of-truth trap: nothing reads the mirror to make a
choice, and the migration ships a verify query asserting mirror == set. The
column, its FK and its dedicated index are dropped in a follow-up once the web
side no longer reads them.

---

## 7. Workstreams, in order

Ordered so that live security and dead features land before the redesign.
1–3 need no design decisions and ship independently.

### 7.1 Authorize the unguarded read endpoints — **ship first, alone**

`getComments`, `getChecklist`, `getTimeEntries` accept a client-supplied
`TaskId` with no check in the controller and none in the SP. Any authenticated
user reads any task's comments **across companies**. `sp_FetchTaskComment` also
writes read-receipts on that path, so an unauthorised reader corrupts
"Seen by N".

**Fix:** one `assertRecordAccess(req, res, "task", TaskId, "view")` per
endpoint, mirroring `getActivity`, which already does this correctly.

**Done when:** a non-member gets 403/404 on all three; a member is unaffected;
cross-company access is impossible; regression tests cover each.

### 7.2 Membership correctness

- `sp_CheckTaskPermission` role lookup and both `sp_FetchTask` `EXISTS` clauses
  gain `AND InviteStatus = 'active'`. **Not** `sp_FetchWorkspaces`, which
  deliberately includes `pending` so the invite prompt can render.
- `sp_FetchWorkspaces`: demote the branch predicate to an optional filter.
- Wire the `workspace_invite` notification to open the invite modal — it
  currently has no handler anywhere in `web/src`.

**Done when:** a declined/pending user gets nothing; a cross-branch member sees
their board and can accept an invite through the UI.

### 7.3 Time logging

`sp_SaveTimeEntry` gates on `INNER JOIN tblProjects ON t.ProjectId = p.Id`, but
`ProjectId` is nullable and **all 19 live tasks have it NULL** — so every
log-time call 404s and the feature has never worked. The `log_time` action in
`sp_CheckTaskPermission` is unreachable.

**Fix:** delegate to `sp_CheckTaskPermission` with `log_time`. Also
`TaskDetailModal` sends `LogDate` while the controller destructures `WorkDate`
— the field is silently dropped and always defaults to today.

**Done when:** an assignee can log time; a non-member cannot; the date sent is
the date stored.

### 7.4 Multi-assignee and the progress/definition split — *the redesign*

Everything in §2, §4 and §6. Includes:

- `tblTaskAssignee` + migration + retiring `AssignedToUserId`
- `manage_checklist` and `manage_attachments` actions; `change_status`
  consults the assignee set
- Attachment upload/delete on a task moves off `edit_fields`, so an assignee
  can attach the document a checklist step calls for
- **Column moves reclassified from `edit_fields` to `change_status`**
- Kanban cards become permission-aware — today `KanbanCard` takes no permission
  prop, so every card is draggable by every role, optimistically moves, 403s,
  and snaps back with a raw error
- Self-claim on unassigned tasks
- Assignee picker filtered to workspace members
- UI flags reworked: the current three (`canEditOthers` / `canEditThisTask` /
  `canProgressThisTask`) cannot express `viewer`, `isAdmin`, or the
  progress/definition split

**Done when:** on a 5-member board with 2 assignees, both assignees can tick,
move and manage the checklist; the other 3 can view and comment; no control is
shown that 403s.

### 7.5 Consistency and cleanup

- **Deactivated assignee freezes the task** — `sp_SaveTask` re-validates the
  assignee on every save and both write paths echo the existing one back, so a
  deactivated assignee kills drag and every field edit with "Invalid assigned
  user selected". Validate only when the assignee set actually changes.
- **Completion audit** — stop NULLing `CompletedDate` / `CompletedByUserId`.
- **Project membership sync** rather than snapshot.
- **Comment moderation UI** — owners/managers can delete others' comments
  server-side but there is no interface for it.
- **Pin button** gated to owner/manager, with error handling.
- **Bulk delete** gated in the UI, and its checklist/subtask guards moved to
  *after* the permission loop (they currently leak task existence to
  non-members).
- **Watchers** — no table, no notifications, no permissions, and 15 of 19 rows
  hold the literal string `'null'` from `JSON.stringify(null)`. Implement or
  delete; `Labels` has the same defect.
- `tblTasks.WorkspaceId` → NOT NULL.
- Dead `reassign` action: wire it or remove it.

---

## 8. Non-goals

- Per-task visibility inside a workspace.
- Custom/user-defined workspace roles — the four are enough.
- Changing completion to a manual flag; checklist-derived stays.
- Cross-workspace task moves.
- Guest/external accounts as a distinct concept — an external collaborator is a
  `member` or `viewer` on exactly the boards they were invited to, gated by the
  Tasks-only menu role (migration 060).

---

## 9. Decisions taken (2026-07-29)

Confirmed with the user; no longer open.

1. **Project membership syncs, it does not snapshot.** Removing someone from
   the project team revokes their board access immediately, mid-task included.
   The board always matches the project team — one list to maintain, not two.
2. **A creator can only delete an untouched task.** Once another person is
   assigned or has commented, deletion is an owner/manager decision. See §4.2.
   This is a change from current behaviour.
3. **Self-claim is allowed.** Any `member` may assign themselves to an
   unassigned task without asking.
4. **An assigned `viewer` ticks only.** They may progress work (tick, move, log
   time) but not add, edit or delete checklist items — and by the same
   reasoning, not attach or remove files. `viewer` stays genuinely limited — it
   is the role an external client gets. Anyone who needs to contribute
   artifacts should be a `member`.
