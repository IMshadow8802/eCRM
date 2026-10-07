# P1-C — Same rules everywhere (#13) + Columns follow membership (#14)

Sources read live 2026-10-07: `OBJECT_DEFINITION` of `sp_CheckTaskPermission`, `sp_FetchKanbanColumn`,
`sp_SaveKanbanColumn`, `sp_DeleteKanbanColumn`, `sp_FetchTaskComment`, `sp_FetchWorkspaces` (MyRole lines).
Live data: 45 columns, all `IsActive=1`, `IsCompanyWide=0` on every row, `WorkspaceId` never NULL, 0 tasks with
NULL `ColumnId`, every workspace has ≥1 column; all 14 workspaces (incl. 7 personal) have an `owner` member row
with `InviteStatus='active'` for `OwnerUserId` → on the clients a personal owner's `MyRole` is `'owner'`.
`sp_FetchWorkspaces.MyRole` = role only when `IsActive=1 AND InviteStatus='active'` (pending invitee and
non-member admin both get `MyRole = NULL`).

Audit refs: B10, B13, B15, B16 (+ the `IsActive=0` half), B12, B21.

---

## 0. Source-of-truth table (from live `sp_CheckTaskPermission` + kanban SPs)

Resolution order in the SP — **both clients must apply it in this order**:
1. workspace `personal` → owner (`OwnerUserId = me`) gets **everything**, everyone else (admins included) **nothing**.
2. non-personal + `IsAdmin=1` (same company) → **everything** (no membership/role needed).
3. role = member row with `IsActive=1 AND InviteStatus='active'`; no such row → **nothing** (pending/declined = nothing).
4. per action:

| Action (SP name) | owner | manager | member | viewer | notes |
|---|---|---|---|---|---|
| `view_task`, `comment`, `reply` | ✓ | ✓ | ✓ | ✓ | |
| `create_task` | ✓ | ✓ | ✓ | ✗ | |
| `change_status`, `log_time` | ✓ | ✓ | if assignee **or** creator | if assignee | web today grants log_time to every member (over-grant) |
| `manage_checklist`, `manage_attachments` | ✓ | ✓ | if assignee or creator | ✗ (even assigned) | |
| `edit_fields`, `reassign`, `add_dependency` | ✓ | ✓ | if creator | ✗ | web today lets a viewer-creator edit |
| `claim_task` | ✓ | ✓ | ✓ | ✗ | only when the task has **no** assignees |
| `delete_task` | ✓ | ✓ | if creator AND no other assignee AND no undeleted comment by anyone else | ✗ | client can check the assignee half only |
| `edit_own_comment`, `delete_own_comment` | author | author | author | author | admin bypass = any comment |
| `delete_others_comment`, `pin_comment` | ✓ | ✓ | ✗ | ✗ | |
| `manage_members` | ✓ | ✗ | ✗ | ✗ | (not touched here) |
| manage columns (`sp_Save/DeleteKanbanColumn` `@CanManage`) | ✓ | ✓ | ✗ | ✗ | after this plan also requires `InviteStatus='active'` |
| fetch columns (`sp_FetchKanbanColumn`) | = `view_task` | | | | after this plan |

"everything" in rows 1–2 = every row of the table ✓ (incl. pin, manage columns; claim still needs no assignees).

---

## SQL changes

One section in the P1 script (orchestrator assigns the number — next free is **094**; `backend/sql/` is empty,
last applied 093). Script header carries `SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;` and each proc is
`CREATE OR ALTER`. The three kanban procs are re-issued in full from the live text with only these hunks.

### S1. `sp_FetchKanbanColumn` — membership gate, branch predicate gone (B10)

Param list: **add** `@UserId INT = NULL` (last). Keep `@BranchId` and `@AccessibleBranchIdsJson` in the
signature as `-- accepted, intentionally unused` (same pattern as `sp_FetchWorkspaces`) so an old backend
calling with them does not error. Delete the `@BranchIds` table / `OPENJSON` / `@UseScope` block entirely.

Live (appears **twice** — COUNT and page query):
```sql
       AND (kc.IsCompanyWide = 1
            OR (@UseScope = 1 AND kc.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR kc.BranchId = @BranchId)))
```
After (both places):
```sql
       -- Same gate as sp_CheckTaskPermission 'view_task'. Branch is not part of it:
       -- a column carries its creator's branch, which hid whole boards from
       -- cross-branch members (B10).
       AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces w2
                    WHERE w2.Id = kc.WorkspaceId AND w2.CompId = @CompId
                      AND (   (w2.Type = 'personal' AND w2.OwnerUserId = @UserId)
                           OR (w2.Type <> 'personal'
                               AND (@IsAdmin = 1
                                    OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                                WHERE m.WorkspaceId = w2.Id AND m.UserId = @UserId
                                                  AND m.IsActive = 1 AND m.InviteStatus = 'active')))))
```
`IsCompanyWide` is dropped from the predicate (0 rows use it; still selected in the output list, unchanged).
`@UserId IS NULL` ⇒ only admin rows on non-personal boards ⇒ fail-closed.
Everything else (columns, `ORDER BY`, paging, `TaskCount`) identical. **If P1 #1 (soft delete) lands in the
same script**, `TaskCount`'s subquery becomes `WHERE t.ColumnId = kc.Id AND ISNULL(t.IsDeleted,0) = 0` —
coordinate with that section.

### S2. `sp_SaveKanbanColumn` — invite state, no "delete by IsActive=0", no resurrect (B15, B16b)

After the `@Title` check, add:
```sql
    -- Deleting is sp_DeleteKanbanColumn's job: it moves the column's tasks.
    -- IsActive = 0 here hid the column and orphaned its cards (B16).
    IF (@IsActive = 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Use delete to remove a column';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
```
Live `@CanManage` member branch:
```sql
           AND m.IsActive = 1 AND m.Role IN ('owner','manager')))
```
After:
```sql
           AND m.IsActive = 1 AND m.InviteStatus = 'active'
           AND m.Role IN ('owner','manager')))
```
Live update existence check:
```sql
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE Id = @Id AND WorkspaceId = @WorkspaceId
```
After (a deleted column cannot be renamed back to life):
```sql
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE Id = @Id AND WorkspaceId = @WorkspaceId AND IsActive = 1
```
Live update `SET`: `MaxTasks = @MaxTasks, IsActive = @IsActive` → `MaxTasks = @MaxTasks` (IsActive no longer
written on update). Insert keeps `@IsActive` (always 1 now). `@IsActive` stays in the signature.

### S3. `sp_DeleteKanbanColumn` — invite state, last column refused (B15, B16a)

Same `@CanManage` hunk as S2 (`AND m.InviteStatus = 'active'`).
Live, after the `ELSE SELECT TOP 1 @ReassignTargetId = Id ... ORDER BY SortOrder ASC, Id ASC;`, insert:
```sql
    -- The last column cannot go: its tasks would have nowhere to live and
    -- would be parked at ColumnId = NULL ("Uncategorized") (B16).
    IF (@ReassignTargetId IS NULL)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'A board needs at least one column';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
```
(The explicit-target branch already sets a non-NULL target or 400s, so this only fires on the
"no other active column" path.)

### S4. `sp_FetchTaskComment` — newest page, shown oldest→newest (B21)

No sort param exists today (`ORDER BY tc.IsPinned DESC, tc.CreatedDate ASC` + OFFSET), so page 1 = the
**oldest** N. Both callers (web `useTaskComments` PageSize 100, mobile) only ever request page 1. Change the
paged list only (the `@Id <> 0` branch is untouched). Live tail:
```sql
      FROM dbo.tblTaskComments tc
      INNER JOIN dbo.tblUser u ON tc.UserId = u.Id
     WHERE tc.TaskId = @TaskId
       AND (@SearchTerm IS NULL
            OR tc.Comment LIKE '%' + @SearchTerm + '%'
            OR u.FullName LIKE '%' + @SearchTerm + '%')
     ORDER BY tc.IsPinned DESC, tc.CreatedDate ASC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
```
After:
```sql
      FROM ( -- page N counts back from the newest; pinned always make page 1 (B21)
             SELECT tc0.Id
               FROM dbo.tblTaskComments tc0
               INNER JOIN dbo.tblUser u0 ON tc0.UserId = u0.Id
              WHERE tc0.TaskId = @TaskId
                AND (@SearchTerm IS NULL
                     OR tc0.Comment LIKE '%' + @SearchTerm + '%'
                     OR u0.FullName LIKE '%' + @SearchTerm + '%')
              ORDER BY tc0.IsPinned DESC, tc0.CreatedDate DESC, tc0.Id DESC
              OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY ) pg
      INNER JOIN dbo.tblTaskComments tc ON tc.Id = pg.Id
      INNER JOIN dbo.tblUser u ON tc.UserId = u.Id
     ORDER BY tc.IsPinned DESC, tc.CreatedDate ASC, tc.Id ASC;
```
Output column list, read-receipt insert, counts: identical. Display order on both clients is unchanged
(oldest→newest, pinned first); only *which* 100 changes.

### Verify after apply
```sql
-- 1. text landed
SELECT name,
       CASE WHEN OBJECT_DEFINITION(object_id) LIKE '%@UseScope%' THEN 'OLD' ELSE 'ok' END AS no_branch_scope,
       CASE WHEN OBJECT_DEFINITION(object_id) LIKE '%InviteStatus = ''active''%' THEN 'ok' ELSE 'MISSING' END AS invite_gate
  FROM sys.procedures
 WHERE name IN ('sp_FetchKanbanColumn','sp_SaveKanbanColumn','sp_DeleteKanbanColumn');
SELECT CASE WHEN OBJECT_DEFINITION(OBJECT_ID('sp_DeleteKanbanColumn')) LIKE '%at least one column%' THEN 'ok' END last_col,
       CASE WHEN OBJECT_DEFINITION(OBJECT_ID('sp_SaveKanbanColumn'))   LIKE '%Use delete to remove%' THEN 'ok' END no_soft,
       CASE WHEN OBJECT_DEFINITION(OBJECT_ID('sp_FetchTaskComment'))   LIKE '%CreatedDate DESC%'     THEN 'ok' END newest;

-- 2. cross-branch member now sees columns (pick a pair; 5 such rows live)
SELECT TOP 5 m.WorkspaceId, m.UserId, u.BranchId AS UserBranch,
       (SELECT TOP 1 BranchId FROM tblKanbanColumns k WHERE k.WorkspaceId = m.WorkspaceId) AS ColBranch
  FROM tblWorkspaceMembers m JOIN tblUser u ON u.Id = m.UserId JOIN tblWorkspaces w ON w.Id = m.WorkspaceId
 WHERE m.IsActive = 1 AND m.InviteStatus = 'active' AND w.Type <> 'personal'
   AND EXISTS (SELECT 1 FROM tblKanbanColumns k WHERE k.WorkspaceId = m.WorkspaceId AND k.BranchId <> u.BranchId);
EXEC dbo.sp_FetchKanbanColumn @WorkspaceId = <ws>, @UserId = <user>, @CompId = 1, @BranchId = <UserBranch>, @IsAdmin = 0;  -- expect rows
EXEC dbo.sp_FetchKanbanColumn @WorkspaceId = <ws>, @UserId = <non-member>, @CompId = 1, @BranchId = 1, @IsAdmin = 0;  -- expect 0 rows
EXEC dbo.sp_FetchKanbanColumn @WorkspaceId = <someone's personal ws>, @UserId = <admin, not owner>, @CompId = 1, @BranchId = 1, @IsAdmin = 1; -- expect 0 rows
```
Live API check (like 093's): as a pending invitee `POST /api/kanban/saveKanbanColumn` → 403; on a one-column
scratch board `deleteKanbanColumn` → 409; `saveKanbanColumn {IsActive:false}` → 400.

---

## Backend tasks

Nothing in `kanbanRoutes.js` changes (already `verifyToken, loadScope`).

### B-1 `kanbanController.fetch` passes `UserId`, drops branch scope
File `backend/src/controllers/kanbanController.js`.
1. **Test first** — `backend/tests/unit/controllers/kanbanController.test.js`, in `describe("kanbanController.fetch")`:
   ```js
   // REGRESSION (B10): columns are gated by workspace membership, so the SP
   // must know who is asking. Branch scope no longer decides anything.
   it("passes the caller's UserId and no branch scope", async () => {
     database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
     const req = baseReq({ body: { WorkspaceId: 100 }, scope: { branchIds: [9] } });
     await kanbanController.fetch(req, mockRes());
     const params = database.executeStoredProcedure.mock.calls[0][1];
     expect(params.UserId).toBe(7);
     expect(params).not.toHaveProperty("AccessibleBranchIdsJson");
   });
   ```
   Update the existing "defaults everything…" test: remove `AccessibleBranchIdsJson: null` from its
   `objectContaining`, add `UserId: 7`.
   Run `cd backend && pnpm exec jest kanbanController` → new test fails.
2. Fix: delete the `scopeJson` import + `accessibleBranchIdsJson` lines + the comment above them; in the SP
   params replace `AccessibleBranchIdsJson: accessibleBranchIdsJson,` with `UserId: req.user.UserId,`.
   (`BranchId` keeps being sent — harmless, the SP ignores it.)
3. Re-run → green.

### B-2 `kanbanController.save` refuses `IsActive: false` (B16b, testable twin of the SP guard)
1. Test:
   ```js
   // REGRESSION (B16): IsActive=false "deleted" a column without moving its tasks.
   it("rejects IsActive=false with 400 and never calls the SP", async () => {
     const req = baseReq({ body: { Id: 3, WorkspaceId: 100, Title: "x", IsActive: false } });
     const res = mockRes();
     await kanbanController.save(req, res);
     expect(res.status).toHaveBeenCalledWith(400);
     expect(database.executeStoredProcedure).not.toHaveBeenCalled();
   });
   ```
   Fails today (SP is called, mock returns undefined → 500).
2. Fix: after the `WorkspaceId` 400 block:
   ```js
   if (IsActive === false || IsActive === 0) {
     return res.status(400).json({
       success: false,
       message: "Use delete to remove a column",
       code: "VALIDATION_ERROR",
       responseCode: 400,
       timestamp: new Date().toISOString(),
     });
   }
   ```
   and pass `IsActive: true` to the SP (the destructured default stays for the check).
3. Green.

### B-3 `kanbanController.delete` — 409 contract (SP-side behaviour, contract test only)
Test: SP returns `{ResponseCode:409, ResponseMess:"A board needs at least one column"}` → `res.status(409)`,
`json.success === false`, `json.data === null`, no `logActivity`/emit. Passes on current code (flag: **not a
regression test** — mocked DB cannot see the SP guard; the live check above covers it).

### B-4 Comments — no controller change
`getComments` default stays 25 (only mobile changes its request). Ordering is SP-only (S4); mocked tests cannot
see it → live check: on a task with >2 comments, `getTaskComments {TaskId, PageSize:2}` returns the **two newest**,
oldest of them first.

Gate: `cd backend && pnpm exec jest kanbanController --coverage --collectCoverageFrom='src/controllers/kanbanController.js'`
→ ≥80% line/branch.

---

## Web tasks

### W-1 One mirror of the SP: `web/src/utils/taskAbilities.js` (new)
```js
// Mirror of sp_CheckTaskPermission (+ the kanban SPs' column gate). UI only:
// a wrong answer hides a button, it never grants access — the server re-checks.
// Order matters and is the SP's: personal → owner only (admins too are out);
// admin → everything on shared/project; else the ACTIVE member role decides.
import { isAssignee, assigneesOf } from "./taskAssignees";

export function workspaceAbilities({ wsType, role, isAdmin }) {
  const personal = wsType === "personal";
  // ponytail: personal owner is read from role === "owner" — every personal
  // workspace has its owner's member row (live: 7/7); OwnerUserId is not in the store.
  const full = personal ? role === "owner" : Boolean(isAdmin && wsType) || role === "owner" || role === "manager";
  const member = !personal && !full && role === "member";
  const viewer = !personal && !full && role === "viewer";
  return {
    full, member, viewer,
    view: full || member || viewer,
    createTask: full || member,
    manageColumns: full,
    pinComment: full,
  };
}

export function taskAbilities({ wsType, role, isAdmin, userId, task }) {
  const ws = workspaceAbilities({ wsType, role, isAdmin });
  const creator = task != null && task.CreatedByUserId === userId;
  const assigned = task != null && isAssignee(task, userId);
  const others = task ? assigneesOf(task).some((a) => a.UserId !== userId) : false;
  return {
    ...ws,
    comment: ws.view,
    changeStatus: ws.full || (ws.member && (assigned || creator)) || (ws.viewer && assigned),
    logTime:      ws.full || (ws.member && (assigned || creator)) || (ws.viewer && assigned),
    manageArtifacts: ws.full || (ws.member && (assigned || creator)),
    editFields: ws.full || (ws.member && creator),
    claim: (ws.full || ws.member) && task != null && assigneesOf(task).length === 0,
    // server also refuses when someone else has commented — it has the last word
    deleteTask: ws.full || (ws.member && creator && !others),
  };
}
```
(Check `assigneesOf` returns objects with `UserId` — it is the helper `isAssignee` is built on in
`web/src/utils/taskAssignees.js`; adjust the field name if it differs.)

Test `web/src/utils/taskAbilities.test.js` — `it.each` over the §0 table:
- personal owner → every flag true; personal + `isAdmin` + role null → every flag false (**the B13 inverse case**);
- shared + `isAdmin` + role null → `createTask`, `editFields`, `manageColumns`, `pinComment`, `comment` true;
- shared + role null, not admin (pending invitee) → all false;
- member: non-assignee non-creator → `changeStatus/logTime/manageArtifacts/editFields` false, `comment/createTask` true;
  member creator → `editFields` true, `deleteTask` true only with no other assignee; member assignee → `manageArtifacts` true, `editFields` false;
- viewer assignee → `changeStatus` true, `manageArtifacts` false, `createTask` false; viewer creator → `editFields` **false**;
- `claim` true only with zero assignees; `task = null` → task-level flags false, workspace flags unchanged.
Run `cd web && pnpm exec vitest run src/utils/taskAbilities.test.js`.

### W-2 Store: drop the role-only gates
`web/src/stores/useWorkspaceStore.js`: delete `canCreateTasks` and `canEditOthersTasks` (lines 56-63; only
TaskBoard/TaskDetailModal use them). Keep `canManageMembers` (out of scope). In
`useWorkspaceStore.test.js` cut those two from "role gates match the permission matrix" (keep the
`canManageMembers` asserts) — the matrix now lives in W-1's test.

### W-3 `TaskBoard.jsx` uses the mirror
Replace lines 74 (`canCreate`) and 78-89 (`canDragCard` + its comment + `canManageColumns`) with:
```js
const isAdmin = useAuthStore((s) => Boolean(s.user?.IsAdmin));   // keep the existing line, coerce
const ws = workspaceAbilities({ wsType: activeType, role: activeRole, isAdmin });
const canCreate = ws.createTask;
const canManageColumns = ws.manageColumns;
// One rule set with the server (utils/taskAbilities) — a card you cannot move
// does not offer to move.
const canDragCard = (task) =>
  taskAbilities({ wsType: activeType, role: activeRole, isAdmin, userId: currentUserId, task }).changeStatus;
```
Tests (`web/src/pages/Task/TaskBoard.test.jsx`):
- **REGRESSION (B13):** admin, `MyRole: null`, `Type: "shared"` → `await screen.findByTestId("quick-add-btn-1")`
  present and `column-menu-1` present. Fails today (`canCreateTasks` is role-only).
- viewer, not admin, not assignee → no `quick-add-btn-1`, card cursor `default`.
- existing "lets an admin drag a card…" stays green.

### W-4 `TaskDetailModal.jsx` uses the mirror
Replace lines 47-48 (`canEditOthers`, `canCreateTasks`) and 111-134 with:
```js
const isAdmin = useAuthStore((s) => Boolean(s.user?.IsAdmin));
const can = taskAbilities({ wsType: workspaceType, role: workspaceRole, isAdmin, userId: currentUserId, task });
const canEditThisTask = Boolean(task) && can.editFields;
const canProgressThisTask = can.changeStatus;
const canManageArtifacts = can.manageArtifacts;
const canLogTime = can.logTime;
```
`isViewer` / `amAssignee` locals go if unused after the swap (`amAssignee` may still feed a panel — grep before
deleting). Behaviour changes, all toward the SP: admin non-member can edit; viewer-creator can no longer edit;
a member who is neither assignee nor creator can no longer press Log time (server 403'd it).
Tests (`TaskDetailModal.test.jsx`), set `useWorkspaceStore.getState().setActiveWorkspace({Id:100, Type, MyRole})`
and `useAuthStore.setState({ user: { UserId: 1, IsAdmin }, UserId: 1 })`, task seeded with `CreatedByUserId: 9`:
- **REGRESSION (B13):** admin, shared, `MyRole: null` → `task-title-input` enabled. Fails today.
- admin, `Type: "personal"`, `MyRole: null` → `task-title-input` disabled.
- member, not assignee/creator → `log-time-btn` disabled (**regression for the log_time over-grant**; fails today).
- viewer who created the task → `task-title-input` disabled.

### W-5 Last column cannot be deleted (B16 UI)
`web/src/components/Kanban/KanbanColumn.jsx` menu items: build the array with a conditional spread so
"Delete column" is absent when `otherColumnOptions.length === 0`:
```js
items={[
  { id: "rename", … },
  ...(otherColumnOptions.length ? [{ id: "delete", … }] : []),
]}
```
Test (`KanbanColumn.test.jsx`): `siblingColumns=[column]`, `canManage` → open `column-menu-<id>` → no
"Delete column"; with two siblings → present. Also add an MSW override in that test (`server.use`) returning
`409` for `deleteKanbanColumn` and assert the dialog stays open (error toast from the hook) — guards the race
where another manager deleted the sibling first.

### W-6 MSW
`web/src/test/mocks/handlers.js` `deleteKanbanColumn`: if, after filtering, the deleted column was the
workspace's last, return `HttpResponse.json({success:false, message:"A board needs at least one column", responseCode:409}, {status:409})`
and do not mutate the fixture — keeps the default handler faithful to the SP.

Gate: `cd web && pnpm exec vitest run src/utils/taskAbilities.test.js src/stores/useWorkspaceStore.test.js src/pages/Task src/components/Kanban`,
then the full suite (`pnpm exec vitest run`) since the store changed; coverage ≥80% on the five touched files.

---

## Mobile tasks
Gate for each: `cd mobile && pnpm typecheck && pnpm lint`.

### M-1 `abilitiesFor` = the same table (B13)
`mobile/src/features/tasks/taskHelpers.ts` (lines ~199-230). Port W-1 verbatim in TS (same names:
`workspaceAbilities`, and `abilitiesFor` returning the W-1 `taskAbilities` shape). New signature:
```ts
export function workspaceAbilities(role: WorkspaceRole | null, isAdmin: boolean, wsType: WorkspaceType | null): WorkspaceAbilities
export function abilitiesFor(task: Task | null | undefined, userId: number | null,
                             role: WorkspaceRole | null, isAdmin: boolean,
                             wsType: WorkspaceType | null): TaskAbilities
```
Keep the existing keys `changeStatus`, `manageArtifacts`, `editFields`, `comment` (callers), add `createTask`,
`manageColumns`, `logTime`, `claim`, `deleteTask`. Delete `adminBypass` (`role !== null` was the bug) and the
`comment: role !== null || creator || assigned` line (SP: membership only). Replace the doc comment's
"matches the web" with "matches web/src/utils/taskAbilities.js — change both together".

### M-2 Callers pass the workspace type
- `TaskDetailScreen.tsx:169-173`: `const ws = workspaces?.find((w) => w.Id === boardId);`
  `const role = ws?.MyRole ?? null;` `const can = abilitiesFor(task, userId, role, isAdmin, ws?.Type ?? null);`
  Wire `can.logTime` to the "Log time" action and `can.deleteTask` to "Delete" if those actions are currently
  ungated (grep the action-sheet literal; conditional spreads, never `.push()` — §9.5).
- `BoardScreen.tsx:76-77,143`: `const wsAbilities = workspaceAbilities(role, isAdmin, workspace?.Type ?? null);`
  `manages` → `wsAbilities.manageColumns` (admin non-member now gets "Manage columns");
  line 143 passes `workspace?.Type ?? null`; the `Fab` at ~269 renders only when
  `columns.length && wsAbilities.createTask` (a viewer no longer gets a Fab that 403s).

### M-3 Personal task defaults to the owner (B12)
`TaskFormScreen.tsx`:
- add `const { data: workspaces } = useQuery({ queryKey: ["workspaces", false], queryFn: () => fetchWorkspaces({ PageSize: 100 }) });`
  (same key as Boards → cached), `const isPersonal = workspaces?.find((w) => w.Id === workspaceId)?.Type === "personal";`
  and `const userId = useAuthStore((s) => s.UserId);`
- hide the Assignees `Select` when `isPersonal` (web hides it too);
- in `submit`: `AssigneeIds: isPersonal ? [userId] : assignees,` (`userId` non-null guard: fall back to `assignees`).
- `api/taskQueries.ts:125` default `AssigneeIds = []` stays — the decision belongs to the form that knows the
  workspace, the fetcher does not. (Spec's "api/taskQueries.ts:125" pointer resolved this way; see Open decisions.)

### M-4 Comments: newest 100 (B21)
`api/taskQueries.ts:215`: `{ PageNumber: 1, PageSize: 100, ...params }`. With S4 that is the newest 100,
still rendered oldest→newest. No screen change.

### M-5 Last column
`ColumnsScreen.tsx`: render the delete `Pressable` only when `columns.length > 1`; `submit` sends `IsActive: true`
(drop `editing?.IsActive ?? true` — the server now 400s `false`). The screen is reachable only via
`manages` on BoardScreen, now `manageColumns`.

---

## Open decisions (recommended default first)

1. **Comment order semantics (S4)** — *Default: change the SP so page N counts back from the newest, output
   ascending; no new param.* Only two callers, both page-1-only. Alternative: `@NewestFirst BIT = 0` param +
   controller passthrough + mobile flag (more code, web keeps the oldest-100 ceiling).
2. **Old params on `sp_FetchKanbanColumn`** — *Default: keep `@BranchId`/`@AccessibleBranchIdsJson` as
   accepted-unused* (deploy-order safe). Drop in the R19 cleanup script.
3. **Mobile personal default location** — *Default: in `TaskFormScreen`, not `saveTask`* (the fetcher has no
   workspace type; changing its default to "me" would assign the caller on shared boards too).
4. **`IsActive=false` on save** — *Default: 400 in controller + SP.* Alternative: silently ignore it. 400 is
   honest and no client sends `false`.
5. **Pending invitee sees the board?** `sp_FetchWorkspaces` lists pending boards (`InviteStatus IN ('active','pending')`);
   after S1 their column fetch is empty, same as their task fetch already is. *Default: accept* — the invite
   UI should show "Accept to open"; flag to whoever owns invite UX.
6. **Admin column management on archived boards** — SP ignores `IsArchived` (as `sp_CheckTaskPermission` does).
   *Default: leave* — B11 owns archive semantics.

---

## Risks / callers affected

- **Deploy window (S1):** after the SQL is applied, the *old* backend does not send `@UserId` → every
  non-admin sees **no columns** until the new backend is up. Apply 094 and run the backend deploy back-to-back
  (or deploy backend in the same sitting); the reverse order fails louder (unknown `@UserId` param → 500).
- `sp_FetchKanbanColumn` callers: `kanbanController.fetch` only. Clients: web `TaskBoard` (154),
  `TaskDetailModal` (65); mobile `BoardScreen`, `TaskDetailScreen`, `TaskFormScreen`, `ColumnsScreen`. All pass a
  `WorkspaceId`; none relies on the cross-workspace (NULL) mode.
- `sp_Save/DeleteKanbanColumn` callers: `kanbanController` only; web `ColumnAddInline`, `KanbanColumn`;
  mobile `ColumnsScreen`. `sp_ApplyKanbanTemplate` / `sp_CreateDefaultKanbanColumns` insert directly and are
  untouched (B2 was 093's).
- `sp_FetchTaskComment` callers: `taskController.getComments` only (web `useTaskComments`, mobile
  `TaskDetailScreen`). A reply whose parent fell outside the newest 100 renders indented without its parent —
  same as today's oldest-100 cut, at the other end.
- Web store API shrinks (`canCreateTasks`, `canEditOthersTasks` removed) — any branch in flight that uses them
  breaks at import; grep before merging.
- Behaviour tightens on web for: viewer-creators (no edit), non-assigned members (no Log time). Both were 403s
  server-side, so nothing that worked stops working.
- The web modal still reads role/type from the **active** workspace, not the task's; correct only while the
  modal opens from that board. P1 #6 (deep link switches workspace first) keeps it true — note for that task.
- Mobile has no tests: the two copies (web `taskAbilities.js`, mobile `taskHelpers.ts`) can drift. Mitigation
  is the comment pointing at each other plus W-1's table test; a shared package is not worth it for ~40 lines.
- Column Select in the task modal for assignees (B14) is P1 #11, not here — W-4 does not touch it.
