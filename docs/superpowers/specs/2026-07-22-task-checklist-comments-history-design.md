# Task checklist / comments reliability + History tab — design

Date: 2026-07-22

## Problem

Reported symptoms in the task detail modal:

1. **Last checklist item always fails** on tick or delete — 9 of 10 fine, the
   last one "fails then works seconds later" or can be re-ticked.
2. **Comments API 500s** (`COMMENTS_ERROR`) seemingly at random.
3. **Cannot edit a comment** at all.
4. **Delete (comment + checklist) is "random"** — says failed but the item is
   gone; delete it, still shown, click again, gone, then "failed".
5. **No accountability record** — no trace of when a checklist item was added,
   by whom, or when it was ticked complete. An admin can add work late at night
   with no record; an employee can claim it was done long ago. No history.

## Root causes (confirmed against live DB)

| # | Cause |
|---|-------|
| 1 | `sp_ResolveDependencies` ends with `SELECT … FROM @Unblocked`. It fires only when a task flips to complete — i.e. the **last** unticked item. That stray result set becomes `recordsets[0]`, shifting the real status row to `recordsets[1]`; the controller reads `recordsets[0][0]` → wrong/undefined → 500. The write already committed, so a refetch shows it done — a *false* failure. Called only from `sp_RecomputeTaskCompletion`. |
| 2 | `sp_FetchTaskComment` (and the other paged fetchers) fold `ResponseCode` into each **data** row instead of a separate status row. A task with 0 comments returns an empty recordset → `recordsets[0][0]` undefined → throws → 500. Any commentless task 500s. |
| 3 | No update-comment route/controller/UI. `sp_SaveTaskComment` already supports `@Id > 0` update; the web never wired it. |
| 4 | Checklist toggle/delete and comment delete have **no optimistic UI and no in-flight lockout**. The row stays on screen during the round-trip → a second click hits an already-changed/soft-deleted row → 404 → "failed". |

## Fixes

### SQL (`backend/sql/`, user-applied)
- **F1** — `sp_RecomputeTaskCompletion` captures `sp_ResolveDependencies`'
  result set via `INSERT INTO @tbl EXEC …` so it no longer leaks into the
  caller. Keeps `sp_ResolveDependencies`' contract (its only caller). Fixes
  the last-item tick **and** delete.

### Backend
- **F2** — small guard in the paged fetchers (`getComments`, `getChecklist`,
  `getActivity`, time, deps): empty recordset → return an empty page with 200,
  never `undefined.ResponseCode`.
- **F3** — `updateComment` controller + `/updateTaskComment` route calling
  `sp_SaveTaskComment` with `@Id`, guarded by `assertRecordAccess`.
- **F5 (logging)** — normalize the three stragglers so a task's history catches
  every event: comment-add (`TaskComment`→`Task`), time (`TimeEntry`→`Task`),
  checklist-delete (`TaskChecklist`→`Task`), all `entityId = TaskId`. Sharpen
  descriptions: *ticked / unticked*, *comment edited / deleted*, *item added /
  removed*, *added by X*. `assertRecordAccess(view)` guards the history fetch.

### Web
- **F4** — optimistic update + disable-while-pending on checklist toggle/delete
  and comment delete. Kills the double-tap 404 and the lag.
- **F3 UI** — inline edit for your own comments (pencil → edit box → save;
  shows "edited").
- **History tab** — new tab in the task modal beside Comments/Checklist. Reads
  `/getTaskActivity` (paged), renders a reverse-chronological timeline:
  who · action · field old→new · when. Invalidated by the realtime
  task-detail socket event. This is the accountability record — nothing is
  overwritten.

## Reused, not built

The audit trail already exists: `tblActivityLog` ← `sp_SaveActivityLog` ←
`logActivity()`, read by `sp_FetchTaskActivity` at `/getTaskActivity`. The
History tab surfaces it; no new table.

**Dropped:** per-item stamp columns on `tblTaskChecklist` — the activity log
already records who/when for add and complete, so schema columns would be
redundant. Add them later only if an inline "✓ by X · date" stamp on the row
itself is wanted.

## Testing
Every change ships with tests (§0.4): F1 verify block executes the write path
under `BEGIN TRAN … ROLLBACK` and asserts a single status recordset; backend
jest for the empty-page guard, update-comment, and logging normalization; web
vitest for optimistic/lockout behaviour, comment edit, and the History tab.
