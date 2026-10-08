# Presence + Task TAT (P2 + P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phases P2 (work calendar, day marks, sessions, presence) and P3 (task TAT clocks) of the TAT/presence spec in one deploy, plus the four access lows parked after the org-hierarchy work and the minimum mobile change sessions force.

**Architecture:** All working-time arithmetic lives in one pure module, `backend/src/utils/workCalendar.js` (D12). SQL stores timestamps and compares them with `GETDATE()`. Clocks are opened/closed by one reconcile procedure (`sp_TatReconcile`) that Node calls after every task write and the sweep calls every minute, so every P1 path that changes assignees (member removal, deactivation, claim, delete…) is covered without editing each SP. A 60-second in-process sweep (first background job in the backend) expires sessions, raises "not signed in", fills due times, and stamps warnings/breaches with `IS NULL` guards.

**Tech Stack:** Express 5 + mssql (SQL Server SPs), Jest/Supertest; React 19 + MUI 9 + TanStack Query, Vitest/RTL/MSW; Expo SDK 57 TypeScript (typecheck + lint only).

**Spec:** `docs/superpowers/specs/2026-10-07-task-tat-presence-design.md` §2 (D1–D13), §5 (P2), §6 (P3). Org model: `docs/superpowers/specs/2026-10-07-org-hierarchy/design.md` and `backend/ROLES.md`.

## Global Constraints

- **Git is read-only.** No `git add/commit/stash/checkout`. Leave everything uncommitted. The controller snapshots diffs between tasks.
- **SQL is written, never applied.** Scripts go in `backend/sql/099_presence.sql` and `backend/sql/100_task_tat.sql`, each starting with `SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;` and ending with a commented "VERIFY AFTER APPLY" block. No `sqlcmd`, no MCP write tools. MCP `read_query` is allowed for inspecting live definitions (`SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID('dbo.<sp>')`).
- **Backward compatible SQL.** The scripts are applied while the *old* Node is still running. Only add tables, columns, and **optional** parameters (`= NULL`); never remove a column or a result-set column an existing proc returns; new result columns go at the end of existing SELECTs and into *every* branch of a proc that has several (mssql throws on recordset merge otherwise).
- **pnpm only.** Backend tests: `cd backend && pnpm exec jest <name>`. Web: `cd web && pnpm exec vitest run <file>`. Mobile gate: `cd mobile && pnpm typecheck && pnpm lint`.
- **Test-first; ≥80% line and branch coverage on every touched file** in `backend/src` and `web/src`. Never `.only`/`.skip`.
- **Every route declares access:** `requireModule(module, action)`, `open()` or `requireAdmin`. `backend/tests/unit/routes/routeAccess.test.js` fails otherwise.
- **Multi-tenancy:** every proc takes and filters `@CompId`; `CompId`/`UserId`/`BranchId` come from `req.user`, never the body.
- **Times are IST.** The DB server's `GETDATE()` is IST wall clock; Node runs with `TZ=Asia/Kolkata` and mssql `useUTC:false`. `workCalendar.js` must not depend on the process TZ (fixed +05:30, no DST). **Datetimes passed inside JSON to SQL are IST wall-clock strings `YYYY-MM-DD HH:mm:ss` from `toSqlIst()`, never `toISOString()`.** Date objects passed as direct SP params are fine. UI shows times with an "IST" suffix.
- **Go-live gate:** nothing is recorded (presence rows, not-signed-in alerts, task clocks) for dates/assignments before `tblCompanySetting.GoLiveDate`; `NULL` = feature off for that company.
- **No TAT in personal workspaces** (D10); only `shared`/`project`, not archived, task not deleted.
- **Copy rules:** neutral words. Statuses exactly: `Online`, `Offline`, `Signed out`, `Not signed in yet`, `Late by n min`, `On leave`, `On duty`, `Holiday`. Chip: `Due 17:30 IST` / `Due Tue 11:00 IST`, amber at warn, red `Over by 25m`, grey `On hold: <reason>`. Text + icon, never colour alone.
- **Web UI** uses the shared `ui/` components and `FormSelect`/`FormInput`; MUI v9 `slotProps`.
- **Mobile:** lucide icons, tokens only, no `Alert`, fetchers only in `src/api/`.
- **Notifications** are created only through `sp_CreateNotification` (inside SPs) and pinged with `emitToUser(id, SCOPES.NOTIFICATIONS)`. Manager of a person = `sp_FetchPersonManagers(@UserId, @CompId)` (first active `ReportsTo` ancestor, else active admins; rows `UserId, Source`).

## Review Focus

1. **Process TZ or JSON datetimes wrong** → every clock 5h30 off. `toSqlIst` is table-tested, `workCalendar` runs under `TZ=UTC` and `TZ=Asia/Dubai`, and `server.js` logs a loud warning at startup when `new Date().getTimezoneOffset() !== -330` (Task 1, Task 6).
2. **Night shift across midnight** — a sign-in at 00:30 belongs to the shift that started the previous evening; presence `WorkDate` is the start date; session expiry is that shift's end + buffer (Task 1 tests `night shift`).
3. **Forced end / logout must bite fast** — logout clears the session cache entry in-process immediately; a forced end on the same container clears it too; any other change is picked up within 60 s (Task 5 tests).
4. **Sweep overlap or restart double-fires** — in-flight flag skips a tick while one runs; SPs stamp `IS NULL` columns before notifying, so a second run sends nothing (Task 6 test + SP shape in Tasks 2–3).
5. **Re-sign-in over unsaved work** — the dialog keeps the page mounted, retries each queued request exactly once with the new token, and a different username does a full logout instead (Task 9 tests).

## Deviations from the spec (decided here)

- **Clocks open/close in `sp_TatReconcile`, called right after each task write and every minute** — not inside `sp_SaveTask`'s transaction. One proc covers every path P1 added that changes assignees (member removal, deactivation, claim, delete, archive) instead of editing ~10 procs; the gap is milliseconds after a write, at most one sweep tick on any path that forgot to call it.
- **The chip shows the due moment** (`Due Tue 11:00 IST`), not "time left": the browser has no working calendar, and wall-clock "17h left" overnight would mislead.
- **Due date on a day without a shift** → end of the last shift before it (within 14 days).
- **Go-live defaults to the day after 099 is applied**; `NULL` switches a company off.
- **D9 "Attendance menu grant" is an `attendance` module grant** (reach Own…Company) in the role grid, since roles moved to modules.

---

## SQL contracts (the interface every later task codes against)

Tasks 2 and 3 implement these; Tasks 4–8 mock them. Result sets are numbered RS1, RS2…; every mutating proc's RS1 is `ResponseCode, ResponseMess[, Id]`.

### 099 — presence, calendar, sessions, lows

| Proc | Params | Returns / semantics |
|---|---|---|
| `sp_FetchWorkSettings` | `@CompId` | RS1 one row `LateGraceMin, SessionBufferMin, WarnPct, NotifyNotSignedIn, GoLiveDate`; RS2 calendars `Id, Name, IsDefault, DaysJson, UserCount`; RS3 holidays `Id, HolidayDate, Name, BranchId, BranchName` (from 1 year ago onward); RS4 TAT policy `Priority, Minutes` (empty until 100 is applied — Node treats a missing RS4 as `[]`). |
| `sp_SaveCompanySetting` | `@CompId, @LateGraceMin, @SessionBufferMin, @WarnPct, @NotifyNotSignedIn, @GoLiveDate` | upsert; 400 if grace not 0–120, buffer not 0–480, warn not 50–95. |
| `sp_SaveWorkCalendar` | `@Id, @CompId, @Name, @DaysJson, @IsDefault` | insert/update; `@IsDefault=1` clears the flag on the others. 409 on duplicate name. (DaysJson validated in Node.) |
| `sp_DeleteWorkCalendar` | `@Id, @CompId` | 409 if default or any user has `WorkCalendarId = @Id`. |
| `sp_SaveHoliday` / `sp_DeleteHoliday` | `@Id, @CompId, @HolidayDate, @Name, @BranchId NULL` / `@Id, @CompId` | 409 on duplicate (CompId, BranchId, HolidayDate). |
| `sp_SetUserWorkProfile` | `@UserId, @CompId, @WorkCalendarId NULL, @PresenceExempt BIT NULL` | NULL `@PresenceExempt` = keep; `@WorkCalendarId` 0 = company default (stores NULL), NULL = keep. 404 if calendar not in company. |
| `sp_FetchCalendarContext` | `@CompId, @UserIdsJson, @FromDate DATE, @ToDate DATE` | RS1 users `UserId, CalendarId` (resolved: own or company default), `BranchId, PresenceExempt, ReportsTo`; RS2 calendars `Id, DaysJson` (only those referenced); RS3 holidays `HolidayDate, BranchId` in range; RS4 marks `UserId, WorkDate, Part, Kind` in range. |
| `sp_SaveDayMark` | `@CompId, @UserId, @WorkDate, @Part, @Kind, @Remarks, @ActorUserId, @ActorIsAdmin` | one mark per (UserId, WorkDate) — upsert. 403 unless actor is admin or an **active ReportsTo ancestor** of the user (recursive CTE, depth < 20). 400 on bad Part/Kind. Returns `Id`. |
| `sp_DeleteDayMark` | `@CompId, @UserId, @WorkDate, @ActorUserId, @ActorIsAdmin` | same 403 rule. |
| `sp_FetchDayMarks` | `@CompId, @UserIdsJson, @FromDate, @ToDate` | `UserId, WorkDate, Part, Kind, Remarks, MarkedBy, MarkedByName, MarkedAt`. |
| `sp_StartSession` | `@SessionId UNIQUEIDENTIFIER, @CompId, @UserId, @Device, @Ip, @UserAgent, @ExpiresAt, @WorkDate DATE NULL, @ShiftStart, @ShiftEnd, @LateMinutes, @BranchId, @ManagerId` | inserts the session. When `@WorkDate` not NULL and ≥ GoLiveDate: inserts `tblPresenceDay` if missing, else sets `FirstSignInAt`/`LateMinutes` where `FirstSignInAt IS NULL` (row pre-created by the not-signed-in sweep). Returns `ShowNotice` bit = `PresenceNoticeAt IS NULL AND GoLiveDate <= today`. |
| `sp_CheckSession` | `@SessionId` | `UserId, CompId, ExpiresAt, EndedAt, EndReason` or no row. |
| `sp_TouchSession` | `@SessionId, @ExpiresAt` | open sessions only: `LastSeenAt = GETDATE()`, `ExpiresAt = @ExpiresAt` when later. Returns `Touched` bit. |
| `sp_EndSession` | `@SessionId, @Reason, @CompId NULL` | sets `EndedAt/EndReason` where open; on `logout` also `tblPresenceDay.SignedOutAt` for that user's latest row. Returns `UserId, Ended` bit. |
| `sp_EndUserSessions` | `@UserId, @CompId, @Reason` | ends all open; returns ended `SessionId` rows. |
| `sp_FetchSessions` | `@CompId, @UserId` | last 30: `SessionId, Device, Ip, UserAgent, StartedAt, LastSeenAt, ExpiresAt, EndedAt, EndReason`. |
| `sp_AckPresenceNotice` | `@UserId, @CompId` | sets `PresenceNoticeAt` where NULL. |
| `sp_FetchPresence` | `@CompId, @WorkDate, @UserIdsJson` | one row per listed active user: `UserId, FullName, JobTitle, BranchId, PresenceExempt, ShiftStart, ShiftEnd, FirstSignInAt, LateMinutes, SignedOutAt, LastSeenAt` (latest open session), `HasOpenSession` bit, `MarkPart, MarkKind`. |
| `sp_PresenceSweep` | `@CompId` | ends sessions with `ExpiresAt < GETDATE()` (`EndReason='expired'`), deletes sessions older than 13 months (TOP 2000), RS1 ended `SessionId` rows. |
| `sp_FetchPresenceCandidates` | `@CompId, @WorkDate` | active, non-exempt users with **no** `tblPresenceDay` row for `@WorkDate`: `UserId, BranchId`. Empty when `NotifyNotSignedIn=0` or before GoLiveDate. |
| `sp_MarkNotSignedIn` | `@CompId, @UserId, @WorkDate, @ShiftStart, @ShiftEnd, @BranchId` | inserts presence row with `NotSignedInAt = GETDATE()` only if no row exists (`IF NOT EXISTS` under `UPDLOCK, HOLDLOCK`); when inserted, runs `sp_FetchPersonManagers` into a table var and `sp_CreateNotification` (Type `presence_not_signed_in`, EntityType `user`, EntityId `@UserId`, Title `"<FullName> has not signed in"`, `@SkipSelf=1`) per recipient. RS1 `Inserted` bit; RS2 notified `UserId` rows. |
| `sp_FetchLiveCompanies` | — | `CompId` rows with `GoLiveDate IS NOT NULL AND GoLiveDate <= CAST(GETDATE() AS DATE)` (sweep). |
| `sp_FetchUser` (changed) | unchanged + `@SearchSensitive=0` now also excludes `Username` from the search predicate (lows L1) | |

### 100 — task TAT

| Proc | Params | Returns / semantics |
|---|---|---|
| `sp_SaveTask` (changed) | + `@DueTime TIME = NULL, @TatMinutes INT = NULL, @CanSetTarget BIT = NULL` | `@TatMinutes` written only when `@CanSetTarget = 1` (NULL from old Node = ignore). `@DueTime` written on create/update like `@DueDate` (cleared when `@DueDate` is NULL). RS3 gains `DueTime` and `TatMinutes` change rows. |
| `sp_FetchTask` (changed) | unchanged | every branch gains, at the end: `DueTime, TatMinutes, TatDueAt, TatWarnAt, TatBreachedAt, TatHeldSince, TatHoldReason, TatOpenClocks` — from `OUTER APPLY` choosing the caller's own open clock, else the open clock with the earliest `DueAt`. |
| `sp_FetchTatPolicy` / `sp_SaveTatPolicy` | `@CompId` / `@CompId, @ItemsJson` (`[{Priority, Minutes}]`) | `Priority, Minutes`; save replaces the set; 400 when Minutes < 1 or > 100000 or Priority not in `critical, high, medium, low`. Also feeds RS4 of `sp_FetchWorkSettings` (redefined in 100). |
| `sp_TatReconcile` | `@CompId, @TaskId BIGINT NULL` | see "Reconcile rules" below. RS1 clocks needing a due time; RS2 ended holds not yet applied. |
| `sp_TatApplyDue` | `@CompId, @ItemsJson, @HoldsJson` | items `[{Id, DueAt, WarnAt, AnchorAt, TargetMinutes, HeldMinutes, Kind}]` (datetimes as IST strings): sets them, `DueStale=0`, logs a `tblTaskTatEvent` (`Kind`, old→new DueAt) when DueAt changed. holds `[{HoldId, HeldMinutes}]`: sets `HeldMinutes`, `AppliedAt=GETDATE()` where `AppliedAt IS NULL`. One transaction. |
| `sp_TatMarkStale` | `@CompId, @TaskId NULL, @UserId NULL, @Kind` | open, unbreached clocks of the task / user: `DueStale=1`, `StaleKind = CASE WHEN DueStale=1 THEN StaleKind ELSE @Kind END`. |
| `sp_TatAcknowledge` | `@CompId, @TaskId, @UserId` | sets `AcknowledgedAt` where NULL on the user's open clock; event `acknowledge`. Returns `Acknowledged` bit. |
| `sp_TatHold` | `@CompId, @TaskId, @UserId NULL, @ReasonId, @Remarks, @ActorUserId, @AutoReleaseAt NULL` | `@UserId` NULL = every open clock of the task; else that user's. Skips clocks already on manual hold. 400 if reason not a `task_hold_reason` lookup of the company. Events `hold`. When the actor holds their own clock (`@UserId = @ActorUserId`): notify `sp_FetchPersonManagers` (Type `tat_hold`, EntityType `task`). RS1 status; RS2 notified `UserId`s. |
| `sp_TatRelease` | `@CompId, @TaskId, @UserId NULL, @ActorUserId` | ends open **manual** holds (`EndedAt`, `EndedBy`); events `release`. |
| `sp_TatMyPartDone` | `@CompId, @TaskId, @UserId` | closes the user's open clock `CloseReason='my_part_done'`. 409 when they are the only open clock (finish the task instead). |
| `sp_TatSaveReason` | `@CompId, @TatId, @UserId, @ReasonId, @Remarks` | own clock only (403), breached only (409), reason must be a `task_breach_reason` lookup; `other` code requires remarks (400). |
| `sp_TatSaveVerdict` | `@CompId, @TatId, @ActorUserId, @Verdict, @Remarks, @ActorManagesWorkspace BIT` | 403 when actor is the clock's user, or is neither an active ReportsTo ancestor of the user nor `@ActorManagesWorkspace=1`. 400 `excused` without remarks; 409 not breached. |
| `sp_TatExcuseForDays` | `@CompId, @UserId NULL, @FromAt DATETIME, @ToAt DATETIME, @Why NVARCHAR(100)` | breached clocks (of the user, or everyone when NULL) whose `BreachedAt` falls in the window and have no verdict: `Verdict='excused', VerdictBy=NULL, VerdictRemarks=@Why, VerdictAt=GETDATE()`. |
| `sp_FetchTaskTat` | `@CompId, @TaskId` | RS1 clocks + `FullName`, `FirstSeenAt, LastSeenAt` (tblTaskReads), `BreachReason` (lookup value), `VerdictByName`; RS2 holds + reason value; RS3 events + actor name, oldest first. |
| `sp_TatSweep` | `@CompId` | (1) auto-release manual holds with `AutoReleaseAt < GETDATE()`; (2) `WarnedAt=GETDATE()` where open, not held, `DueStale=0`, `WarnAt <= GETDATE()`, `WarnedAt IS NULL`; (3) `BreachedAt=GETDATE()` likewise on `DueAt`. Stamps first into a table var via `OUTPUT`, then **one** `sp_CreateNotification` per recipient per kind (`tat_warning` → assignee; `tat_breach` → assignee + `sp_FetchPersonManagers` of the assignee), Title `"1 task is about to run over"` / `"3 tasks ran over"`, EntityType `task`, EntityId = the task when the count is 1 else 0. RS1 recipient `UserId`s. |
| `sp_FetchToday` | `@CompId, @UserId` | RS1 presence today (`FirstSignInAt, LateMinutes, ShiftStart, ShiftEnd`); RS2 the user's open clocks `TatId, TaskId, TaskTitle, WorkspaceId, DueAt, WarnedAt, BreachedAt, HeldSince, HoldReason`, ordered by `DueAt`; RS3 reason pending: own breached clocks with `BreachReasonId IS NULL`. |
| `sp_FetchTeamToday` | `@CompId, @WorkDate, @UserIdsJson` | per user: `UserId, Open, AtRisk` (open, warned, not breached), `Over` (open, breached), `ReasonPending`. |

### Reconcile rules (`sp_TatReconcile`)

Clock-eligible assignment = `tblTaskAssignee` row whose task is in the company, not deleted, not completed, `TatMinutes` is not 0, workspace `Type IN ('shared','project')` and not archived, user active, and `AssignedAt >= GoLiveDate` (no-op when GoLiveDate NULL). Optional `@TaskId` limits every step to that task. In one transaction:

1. **Close** open clocks with no eligible assignment: reason `completed` (task completed), `deleted` (task deleted), `user_left` (user inactive), `no_clock` (TatMinutes = 0 or workspace archived/personal), else `unassigned`. `LastClosedAt = ClosedAt = GETDATE()`. End their open holds.
2. **Reopen** clocks closed `completed` within the last 30 days whose assignment is eligible again and that have no open clock: `ClosedAt=NULL, CloseReason=NULL, ReopenedAt=GETDATE(), DueStale=1, StaleKind='reopen'`, event `reopen`.
3. **Resume** clocks closed `unassigned` less than 7 days ago for the same (task, user): `ClosedAt=NULL, DueStale=1, StaleKind='change'`, event `resume`.
4. **Open** a clock for every eligible assignment still without one: `AssignedAt` from `tblTaskAssignee.AssignedAt`, `AnchorAt = AssignedAt`, `DueStale=1, StaleKind='assign'`, `TaskTitle`, `BranchId` (workspace), `ManagerId` (first `Source='manager'` row of `sp_FetchPersonManagers`, NULL otherwise — use the same CTE inline). Event `assign`.
5. **Blocked holds:** open a `blocked` hold on each open clock of a task that depends on an uncompleted, undeleted task and has no open `blocked` hold; end `blocked` holds whose task no longer has one.
**Every proc that ends a hold** (`sp_TatReconcile` step 5, `sp_TatRelease`, `sp_TatSweep` auto-release) also sets the clock `DueStale=1, StaleKind = CASE WHEN DueStale=1 THEN StaleKind ELSE 'hold' END`, so `processPending` applies the held minutes.

6. RS1: open clocks with `DueStale=1` joined to the task — `Id, UserId, AssignedAt, AnchorAt, TargetMinutes, HeldMinutes, DueAt, BreachedAt, StaleKind, ReopenedAt, LastClosedAt, Priority, DueDate, DueTime, TaskTatMinutes, PolicyMinutes` (policy for the task's priority, else medium's, else 480). RS2: holds with `EndedAt IS NOT NULL AND AppliedAt IS NULL` — `HoldId, TatId, UserId, StartedAt, EndedAt`.

---

## File map

**Backend — create**
- `src/utils/workCalendar.js` — pure IST working-time maths (Task 1).
- `src/services/calendarContext.js` — loads `sp_FetchCalendarContext` into per-user contexts (Task 4).
- `src/services/sessionService.js` — session start/check cache/touch/end (Task 5).
- `src/services/tatService.js` — due computation + `processPending` (Task 7).
- `src/jobs/sweep.js` — 60 s runner (Task 6).
- `src/controllers/workSettingsController.js`, `routes/workSettingsRoutes.js` (`/api/work`) — settings, calendars, holidays, day marks, user work profile (Task 4).
- `src/controllers/presenceController.js`, `routes/presenceRoutes.js` (`/api/presence`) — heartbeat, notice ack, presence, sessions, end session, today, team today (Tasks 5, 7).
- `src/controllers/tatController.js`, `routes/tatRoutes.js` (`/api/tat`) — policy, acknowledge, hold, release, my-part-done, reason, verdict, fetch (Task 7).
- tests mirroring each under `tests/unit/...`.

**Backend — modify**: `middleware/auth.js`, `middleware/access.js`, `middleware/permission.js` (if a helper is needed), `controllers/authController.js`, `controllers/taskController.js`, `controllers/userController.js`, `realtime/socket.js`, `realtime/contract.js`, `config/routes.js`, `server.js`.

**Web — create**: `utils/reauth.js`, `components/ReauthDialog.jsx`, `components/PresenceNoticeDialog.jsx`, `hooks/useHeartbeat.js`, `api/presenceQueries.js`, `api/workQueries.js`, `api/tatQueries.js`, `pages/Settings/WorkCalendar.jsx` (+ `shiftWarnings.js`), `pages/Today/Today.jsx` (+ `TeamToday.jsx`, `DayMarkDialog.jsx`, `SessionsDialog.jsx`), `components/Kanban/TatChip.jsx` (+ `utils/tatChip.js`), `pages/Task/Components/TaskDetail/TatPanel.jsx`, `pages/Task/Components/TaskDetail/BreachReasonDialog.jsx`. **Modify**: `utils/axiosConfig.js`, `realtime/SocketProvider.jsx`, `realtime/contract.js`, `stores/useAuthStore.js`, `App.jsx`, `pages/auth/Login.jsx`, `pages/Master/components/UserForm.jsx`, `pages/Master/Groups.jsx`, `pages/Master/Users.jsx`, `components/Kanban/KanbanCard.jsx`, `pages/Task/Components/TaskDetailModal.jsx`, `TaskCreateModal.jsx`, `WorkspaceSettingsModal.jsx`, `QuotationBuilder.jsx`, `TaskBoard.jsx`.

**Mobile — modify/create**: `src/api/client.ts`, `src/api/presenceQueries.ts`, `src/stores/useAuthStore.ts`, `App.tsx`, `src/features/auth/LoginScreen.tsx`, `src/types/api.ts`.

---

### Task 1: `workCalendar.js` — the working-time module

**Files:**
- Create: `backend/src/utils/workCalendar.js`
- Test: `backend/tests/unit/utils/workCalendar.test.js`

**Interfaces — Produces** (exact names, used by Tasks 4–7):
- `parseDays(json) → Day[]` (throws `Error` with a user message on invalid input) where `Day = {d:0..6, on:boolean, start?:"HH:mm", end?:"HH:mm", breakStart?, breakEnd?}`
- `DEFAULT_DAYS` (Mon–Sat 09:00–18:00, break 13:00–14:00, Sunday off)
- `dateKey(date) → "YYYY-MM-DD"` (IST), `addDays(key, n) → key`, `at(key, minutes) → Date`, `toSqlIst(date) → "YYYY-MM-DD HH:mm:ss"`
- `workIntervals(key, ctx) → [Date, Date][]` where `ctx = {days, holidays:Set<key>, marks:Map<key,{part,kind}>}`
- `workingMinutesBetween(a, b, ctx) → int`, `addWorkingMinutes(start, minutes, ctx) → Date`
- `endOfShift(key, ctx) → Date`, `currentShift(now, days) → {workDate, start, end} | null`
- `sessionExpiry(now, days, bufferMin) → Date`, `extendExpiry(current, now, days, bufferMin) → Date`
- `warnAt(anchor, due, pct, ctx) → Date`
- `effectiveStart(key, ctx) → Date | null` (first working interval start that day, after holidays/marks)

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/unit/utils/workCalendar.test.js
const wc = require("../../../src/utils/workCalendar");

// IST wall clock → instant, independent of process TZ.
const ist = (s) => new Date(s.replace(" ", "T") + ":00+05:30");
const ctx = (over = {}) => ({ days: wc.DEFAULT_DAYS, holidays: new Set(), marks: new Map(), ...over });
// 2026-10-05 is a Monday, 2026-10-11 a Sunday.

describe("ist helpers", () => {
  test("dateKey/at/toSqlIst round-trip in IST", () => {
    const d = ist("2026-10-05 23:30");
    expect(wc.dateKey(d)).toBe("2026-10-05");
    expect(wc.at("2026-10-05", 23 * 60 + 30).getTime()).toBe(d.getTime());
    expect(wc.toSqlIst(d)).toBe("2026-10-05 23:30:00");
    expect(wc.addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("parseDays", () => {
  test("accepts the default", () => expect(wc.parseDays(JSON.stringify(wc.DEFAULT_DAYS))).toHaveLength(7));
  test.each([
    ["not json", "{"],
    ["not 7 days", "[]"],
    ["no working day", JSON.stringify([0,1,2,3,4,5,6].map((d) => ({ d, on: false })))],
    ["bad time", JSON.stringify(wc.DEFAULT_DAYS.map((x) => (x.on ? { ...x, start: "9am" } : x)))],
    ["break outside shift", JSON.stringify(wc.DEFAULT_DAYS.map((x) => (x.on ? { ...x, breakStart: "19:00", breakEnd: "19:30" } : x)))],
    ["start equals end", JSON.stringify(wc.DEFAULT_DAYS.map((x) => (x.on ? { ...x, start: "09:00", end: "09:00" } : x)))],
  ])("rejects %s", (_n, json) => expect(() => wc.parseDays(json)).toThrow());
});

describe("working minutes", () => {
  test("break is not working time", () => {
    expect(wc.workingMinutesBetween(ist("2026-10-05 12:00"), ist("2026-10-05 15:00"), ctx())).toBe(120);
  });
  test("one standard day is 480", () => {
    expect(wc.workingMinutesBetween(ist("2026-10-05 00:00"), ist("2026-10-06 00:00"), ctx())).toBe(480);
  });
  test("Sunday adds nothing; Saturday 17:00 + 120 lands Monday 10:00", () => {
    expect(wc.addWorkingMinutes(ist("2026-10-10 17:00"), 120, ctx()).getTime()).toBe(ist("2026-10-12 10:00").getTime());
  });
  test("holiday is skipped", () => {
    const c = ctx({ holidays: new Set(["2026-10-06"]) });
    expect(wc.addWorkingMinutes(ist("2026-10-05 17:00"), 120, c).getTime()).toBe(ist("2026-10-07 10:00").getTime());
  });
  test("first-half leave starts the day after the break", () => {
    const c = ctx({ marks: new Map([["2026-10-06", { part: "first_half", kind: "leave" }]]) });
    expect(wc.addWorkingMinutes(ist("2026-10-05 17:30"), 60, c).getTime()).toBe(ist("2026-10-06 14:30").getTime());
  });
  test("second-half leave ends the day at the break", () => {
    const c = ctx({ marks: new Map([["2026-10-05", { part: "second_half", kind: "leave" }]]) });
    expect(wc.workingMinutesBetween(ist("2026-10-05 09:00"), ist("2026-10-05 18:00"), c)).toBe(240);
  });
  test("half leave without a break splits at the midpoint", () => {
    const days = wc.DEFAULT_DAYS.map((x) => (x.on ? { d: x.d, on: true, start: "10:00", end: "14:00" } : x));
    const c = ctx({ days, marks: new Map([["2026-10-05", { part: "first_half", kind: "leave" }]]) });
    expect(wc.effectiveStart("2026-10-05", c).getTime()).toBe(ist("2026-10-05 12:00").getTime());
  });
  test("on-duty mark changes nothing", () => {
    const c = ctx({ marks: new Map([["2026-10-05", { part: "full", kind: "on_duty" }]]) });
    expect(wc.workingMinutesBetween(ist("2026-10-05 09:00"), ist("2026-10-05 18:00"), c)).toBe(480);
  });
  test("full leave: no working time, effectiveStart null", () => {
    const c = ctx({ marks: new Map([["2026-10-05", { part: "full", kind: "leave" }]]) });
    expect(wc.workingMinutesBetween(ist("2026-10-05 00:00"), ist("2026-10-06 00:00"), c)).toBe(0);
    expect(wc.effectiveStart("2026-10-05", c)).toBeNull();
  });
  test("reversed or equal range is 0; adding 0 returns start", () => {
    expect(wc.workingMinutesBetween(ist("2026-10-05 12:00"), ist("2026-10-05 11:00"), ctx())).toBe(0);
    const s = ist("2026-10-11 10:00");
    expect(wc.addWorkingMinutes(s, 0, ctx()).getTime()).toBe(s.getTime());
  });
  test("a calendar with no working time throws instead of looping", () => {
    const days = wc.DEFAULT_DAYS.map((x) => ({ d: x.d, on: false }));
    expect(() => wc.addWorkingMinutes(ist("2026-10-05 09:00"), 60, ctx({ days }))).toThrow();
  });
});

describe("night shift (21:00–06:00, break 01:00–01:30, Mon–Fri)", () => {
  const days = [0,1,2,3,4,5,6].map((d) => (d >= 1 && d <= 5
    ? { d, on: true, start: "21:00", end: "06:00", breakStart: "01:00", breakEnd: "01:30" } : { d, on: false }));
  test("00:30 belongs to the previous evening's shift", () => {
    const s = wc.currentShift(ist("2026-10-06 00:30"), days);
    expect(s.workDate).toBe("2026-10-05");
    expect(s.end.getTime()).toBe(ist("2026-10-06 06:00").getTime());
  });
  test("a night is 510 working minutes", () => {
    expect(wc.workingMinutesBetween(ist("2026-10-05 12:00"), ist("2026-10-06 12:00"), ctx({ days }))).toBe(510);
  });
});

describe("endOfShift", () => {
  test("working day → its end", () => {
    expect(wc.endOfShift("2026-10-05", ctx()).getTime()).toBe(ist("2026-10-05 18:00").getTime());
  });
  test("Sunday → Saturday's end", () => {
    expect(wc.endOfShift("2026-10-11", ctx()).getTime()).toBe(ist("2026-10-10 18:00").getTime());
  });
  test("no shift in the 14 days before → 23:59 that day", () => {
    const days = wc.DEFAULT_DAYS.map((x) => ({ d: x.d, on: false }));
    expect(wc.endOfShift("2026-10-11", ctx({ days })).getTime()).toBe(ist("2026-10-11 23:59").getTime());
  });
});

describe("sessions", () => {
  const D = wc.DEFAULT_DAYS;
  test("inside a shift: end + buffer", () => {
    expect(wc.sessionExpiry(ist("2026-10-05 10:00"), D, 120).getTime()).toBe(ist("2026-10-05 20:00").getTime());
  });
  test("before the shift: today's end + buffer", () => {
    expect(wc.sessionExpiry(ist("2026-10-05 07:00"), D, 120).getTime()).toBe(ist("2026-10-05 20:00").getTime());
  });
  test("after the shift: until the next one starts", () => {
    expect(wc.sessionExpiry(ist("2026-10-05 22:00"), D, 120).getTime()).toBe(ist("2026-10-06 09:00").getTime());
    expect(wc.sessionExpiry(ist("2026-10-10 21:00"), D, 120).getTime()).toBe(ist("2026-10-12 09:00").getTime());
  });
  test("buffer never reaches into the next shift", () => {
    const days = D.map((x) => (x.on ? { d: x.d, on: true, start: "09:00", end: "23:00" } : x));
    expect(wc.sessionExpiry(ist("2026-10-05 10:00"), days, 720).getTime()).toBe(ist("2026-10-06 09:00").getTime());
  });
  test("extendExpiry keeps the later of current and now+buffer, capped at next shift", () => {
    const cur = ist("2026-10-05 20:00");
    expect(wc.extendExpiry(cur, ist("2026-10-05 19:30"), D, 120).getTime()).toBe(ist("2026-10-05 21:30").getTime());
    expect(wc.extendExpiry(cur, ist("2026-10-05 19:30"), D, 900).getTime()).toBe(ist("2026-10-06 09:00").getTime());
    expect(wc.extendExpiry(ist("2026-10-05 23:00"), ist("2026-10-05 10:00"), D, 120).getTime()).toBe(ist("2026-10-05 23:00").getTime());
  });
});

describe("warnAt", () => {
  test("80% of working time", () => {
    expect(wc.warnAt(ist("2026-10-05 09:00"), ist("2026-10-05 11:00"), 80, ctx()).getTime()).toBe(ist("2026-10-05 10:36").getTime());
  });
});
```

- [ ] **Step 2: Run under three timezones, expect FAIL** ("Cannot find module")

Run: `cd backend && TZ=Asia/Kolkata pnpm exec jest workCalendar; TZ=UTC pnpm exec jest workCalendar; TZ=Asia/Dubai pnpm exec jest workCalendar`

- [ ] **Step 3: Implement**

```js
// src/utils/workCalendar.js
//
// All working-time arithmetic (spec D12). Instants in, instants out. The wall
// clock is IST (+05:30, no DST) whatever the process TZ is, so results do not
// change between a laptop, a UTC container and the IST server.
//
// ctx = { days: Day[7], holidays: Set<"YYYY-MM-DD">, marks: Map<key, {part, kind}> }
// A shift belongs to the date it starts on; one ending past midnight runs into the next date.

const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const MAX_DAYS = 400; // ponytail: guard against a calendar with no working time; raise if targets go past a year

const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 0
  ? { d, on: false }
  : { d, on: true, start: "09:00", end: "18:00", breakStart: "13:00", breakEnd: "14:00" }));

const pad = (n) => String(n).padStart(2, "0");
const keyOfUtc = (t) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
const midnightUtc = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };

const dateKey = (date) => keyOfUtc(new Date(date.getTime() + IST_MS));
const addDays = (key, n) => keyOfUtc(new Date(midnightUtc(key) + n * DAY_MS));
const at = (key, minutes) => new Date(midnightUtc(key) + minutes * 60000 - IST_MS);
const weekday = (key) => new Date(midnightUtc(key)).getUTCDay();
const toSqlIst = (date) => {
  const t = new Date(date.getTime() + IST_MS);
  return `${keyOfUtc(t)} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
};

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

function parseDays(json) {
  let days;
  try { days = typeof json === "string" ? JSON.parse(json) : json; } catch { throw new Error("Shift days are not valid JSON"); }
  if (!Array.isArray(days) || days.length !== 7) throw new Error("A shift needs all seven weekdays");
  const out = [];
  for (let d = 0; d < 7; d++) {
    const r = days.find((x) => Number(x?.d) === d);
    if (!r) throw new Error("A shift needs all seven weekdays");
    if (!r.on) { out.push({ d, on: false }); continue; }
    if (!HM.test(r.start) || !HM.test(r.end)) throw new Error("Times must be HH:mm");
    if (r.start === r.end) throw new Error("A shift cannot start and end at the same time");
    const day = { d, on: true, start: r.start, end: r.end };
    if (r.breakStart || r.breakEnd) {
      if (!HM.test(r.breakStart) || !HM.test(r.breakEnd)) throw new Error("Break times must be HH:mm");
      const s = hm(r.start); let e = hm(r.end); if (e <= s) e += 1440;
      let bs = hm(r.breakStart); if (bs < s) bs += 1440;
      let be = hm(r.breakEnd); if (be < bs) be += 1440;
      if (bs <= s || be >= e || be <= bs) throw new Error("The break must sit inside the shift");
      day.breakStart = r.breakStart; day.breakEnd = r.breakEnd;
    }
    out.push(day);
  }
  if (!out.some((x) => x.on)) throw new Error("A shift needs at least one working day");
  return out;
}

// The base shift on a date, ignoring holidays and marks.
function shiftOn(key, days) {
  const r = days.find((x) => x.d === weekday(key));
  if (!r || !r.on) return null;
  const s = hm(r.start); let e = hm(r.end); if (e <= s) e += 1440;
  const sh = { workDate: key, start: at(key, s), end: at(key, e) };
  if (r.breakStart) {
    let bs = hm(r.breakStart); if (bs < s) bs += 1440;
    let be = hm(r.breakEnd); if (be < bs) be += 1440;
    sh.breakStart = at(key, bs); sh.breakEnd = at(key, be);
  }
  return sh;
}

function workIntervals(key, ctx) {
  const sh = shiftOn(key, ctx.days);
  if (!sh || ctx.holidays?.has(key)) return [];
  const mark = ctx.marks?.get(key);
  if (mark?.kind === "leave" && mark.part === "full") return [];
  const first = sh.breakStart ? [[sh.start, sh.breakStart]] : [[sh.start, new Date((sh.start.getTime() + sh.end.getTime()) / 2)]];
  const second = sh.breakStart ? [[sh.breakEnd, sh.end]] : [[first[0][1], sh.end]];
  if (mark?.kind === "leave") return mark.part === "first_half" ? second : first;
  return sh.breakStart ? [...first, ...second] : [[sh.start, sh.end]];
}

// Working intervals from `from` onward, clipped to start at `from`.
function* intervalsFrom(from, ctx) {
  let key = addDays(dateKey(from), -1); // yesterday's night shift may still be running
  for (let i = 0; i < MAX_DAYS; i++, key = addDays(key, 1)) {
    for (const [s, e] of workIntervals(key, ctx)) {
      if (e.getTime() > from.getTime()) yield [s.getTime() < from.getTime() ? from : s, e];
    }
  }
}

function workingMinutesBetween(a, b, ctx) {
  if (b.getTime() <= a.getTime()) return 0;
  let ms = 0;
  for (const [s, e] of intervalsFrom(a, ctx)) {
    if (s.getTime() >= b.getTime()) break;
    ms += Math.min(e.getTime(), b.getTime()) - s.getTime();
  }
  return Math.round(ms / 60000);
}

function addWorkingMinutes(start, minutes, ctx) {
  if (minutes <= 0) return new Date(start.getTime());
  let left = minutes * 60000;
  for (const [s, e] of intervalsFrom(start, ctx)) {
    const len = e.getTime() - s.getTime();
    if (left <= len) return new Date(s.getTime() + left);
    left -= len;
  }
  throw new Error("No working time found within 400 days");
}

function endOfShift(key, ctx) {
  for (let i = 0, k = key; i <= 14; i++, k = addDays(k, -1)) {
    const iv = workIntervals(k, ctx);
    if (iv.length) return iv[iv.length - 1][1];
  }
  return at(key, 23 * 60 + 59);
}

const effectiveStart = (key, ctx) => workIntervals(key, ctx)[0]?.[0] || null;

// The shift `now` is in, or today's not yet started; yesterday's night shift wins while it runs.
function currentShift(now, days) {
  const today = dateKey(now);
  for (const key of [addDays(today, -1), today]) {
    const sh = shiftOn(key, days);
    if (sh && now.getTime() < sh.end.getTime() && (key === today || now.getTime() >= sh.start.getTime())) {
      return { workDate: sh.workDate, start: sh.start, end: sh.end };
    }
  }
  return null;
}

function nextShiftStart(after, days) {
  for (let i = 0, k = dateKey(after); i < 15; i++, k = addDays(k, 1)) {
    const sh = shiftOn(k, days);
    if (sh && sh.start.getTime() > after.getTime()) return sh.start;
  }
  return null;
}

const minDate = (a, b) => (b && b.getTime() < a.getTime() ? b : a);

function sessionExpiry(now, days, bufferMin) {
  const cur = currentShift(now, days);
  if (cur) return minDate(new Date(cur.end.getTime() + bufferMin * 60000), nextShiftStart(cur.end, days));
  return nextShiftStart(now, days) || new Date(now.getTime() + DAY_MS);
}

// Later of current and now+buffer, never past the next shift's start; never shrinks.
function extendExpiry(current, now, days, bufferMin) {
  const want = new Date(Math.max(current.getTime(), now.getTime() + bufferMin * 60000));
  const cur = currentShift(now, days);
  const cap = nextShiftStart(cur ? cur.end : now, days);
  if (!cap) return want;
  if (cap.getTime() <= current.getTime()) return current;
  return minDate(want, cap);
}

const warnAt = (anchor, due, pct, ctx) =>
  addWorkingMinutes(anchor, Math.floor((workingMinutesBetween(anchor, due, ctx) * pct) / 100), ctx);

module.exports = {
  DEFAULT_DAYS, parseDays, dateKey, addDays, at, toSqlIst, workIntervals, workingMinutesBetween,
  addWorkingMinutes, endOfShift, effectiveStart, currentShift, sessionExpiry, extendExpiry, warnAt,
};
```


- [ ] **Step 4: Run the three-TZ command from Step 2. Expected: PASS in all three; coverage ≥ 80% lines and branches** (`pnpm exec jest workCalendar --coverage --collectCoverageFrom='src/utils/workCalendar.js'`).

- [ ] **Step 5: No commit.** Leave uncommitted; report the test count.

---

### Task 2: SQL `099_presence.sql`

**Files:** Create `backend/sql/099_presence.sql`. Read live definitions first for every proc you **change** (`sp_FetchUser`) and for `sp_FetchPersonManagers`, `sp_CreateNotification`.

**Interfaces — Produces:** every proc in the "099" contract table, exactly as named.

- [ ] **Step 1: Header + schema**

```sql
-- 099_presence.sql — P2 of docs/superpowers/specs/2026-10-07-task-tat-presence-design.md §5:
-- work calendar, company settings, holidays, day marks, sessions, presence; plus lows L1.
-- Additive and backward compatible: safe to apply while the old Node is running.
-- Apply (both DBs): sqlcmd ... -C -b -I -i sql/099_presence.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.tblCompanySetting') IS NULL
CREATE TABLE dbo.tblCompanySetting (
    CompId            BIGINT       NOT NULL PRIMARY KEY,
    LateGraceMin      INT          NOT NULL CONSTRAINT DF_tblCompanySetting_Grace  DEFAULT 10,
    SessionBufferMin  INT          NOT NULL CONSTRAINT DF_tblCompanySetting_Buffer DEFAULT 120,
    WarnPct           INT          NOT NULL CONSTRAINT DF_tblCompanySetting_Warn   DEFAULT 80,
    NotifyNotSignedIn BIT          NOT NULL CONSTRAINT DF_tblCompanySetting_Notify DEFAULT 1,
    GoLiveDate        DATE         NULL,
    UpdatedAt         DATETIME     NOT NULL CONSTRAINT DF_tblCompanySetting_Upd    DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.tblWorkCalendar') IS NULL
CREATE TABLE dbo.tblWorkCalendar (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    CompId    BIGINT        NOT NULL,
    Name      NVARCHAR(60)  NOT NULL,
    DaysJson  NVARCHAR(MAX) NOT NULL,
    IsDefault BIT           NOT NULL CONSTRAINT DF_tblWorkCalendar_Def DEFAULT 0,
    CreatedAt DATETIME      NOT NULL CONSTRAINT DF_tblWorkCalendar_Cr  DEFAULT GETDATE(),
    CONSTRAINT UQ_tblWorkCalendar_Name UNIQUE (CompId, Name)
);

IF OBJECT_ID('dbo.tblHoliday') IS NULL
CREATE TABLE dbo.tblHoliday (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    CompId      BIGINT       NOT NULL,
    BranchId    BIGINT       NULL,
    HolidayDate DATE         NOT NULL,
    Name        NVARCHAR(80) NOT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblHoliday_Day')
CREATE UNIQUE INDEX UX_tblHoliday_Day ON dbo.tblHoliday (CompId, HolidayDate, BranchId);

IF OBJECT_ID('dbo.tblUserDayMark') IS NULL
CREATE TABLE dbo.tblUserDayMark (
    Id       BIGINT IDENTITY(1,1) PRIMARY KEY,
    CompId   BIGINT        NOT NULL,
    UserId   INT           NOT NULL,
    WorkDate DATE          NOT NULL,
    Part     VARCHAR(12)   NOT NULL CONSTRAINT CK_tblUserDayMark_Part CHECK (Part IN ('full','first_half','second_half')),
    Kind     VARCHAR(10)   NOT NULL CONSTRAINT CK_tblUserDayMark_Kind CHECK (Kind IN ('leave','on_duty')),
    Remarks  NVARCHAR(300) NULL,
    MarkedBy INT           NOT NULL,
    MarkedAt DATETIME      NOT NULL CONSTRAINT DF_tblUserDayMark_At DEFAULT GETDATE(),
    CONSTRAINT UQ_tblUserDayMark UNIQUE (UserId, WorkDate)
);

IF OBJECT_ID('dbo.tblUserSession') IS NULL
CREATE TABLE dbo.tblUserSession (
    SessionId  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    CompId     BIGINT        NOT NULL,
    UserId     INT           NOT NULL,
    Device     VARCHAR(10)   NOT NULL,          -- web | mobile
    Ip         VARCHAR(64)   NULL,
    UserAgent  NVARCHAR(300) NULL,
    StartedAt  DATETIME      NOT NULL CONSTRAINT DF_tblUserSession_Start DEFAULT GETDATE(),
    LastSeenAt DATETIME      NOT NULL CONSTRAINT DF_tblUserSession_Seen  DEFAULT GETDATE(),
    ExpiresAt  DATETIME      NOT NULL,
    EndedAt    DATETIME      NULL,
    EndReason  VARCHAR(10)   NULL               -- logout | expired | forced
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblUserSession_User')
CREATE INDEX IX_tblUserSession_User ON dbo.tblUserSession (UserId, EndedAt) INCLUDE (LastSeenAt, ExpiresAt);

IF OBJECT_ID('dbo.tblPresenceDay') IS NULL
CREATE TABLE dbo.tblPresenceDay (
    Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    CompId        BIGINT   NOT NULL,
    UserId        INT      NOT NULL,
    WorkDate      DATE     NOT NULL,
    ShiftStart    DATETIME NULL,
    ShiftEnd      DATETIME NULL,
    FirstSignInAt DATETIME NULL,
    LateMinutes   INT      NULL,
    SignedOutAt   DATETIME NULL,
    NotSignedInAt DATETIME NULL,
    ManagerId     INT      NULL,
    BranchId      BIGINT   NULL,
    CONSTRAINT UQ_tblPresenceDay UNIQUE (UserId, WorkDate)
);

IF COL_LENGTH('dbo.tblUser', 'WorkCalendarId') IS NULL ALTER TABLE dbo.tblUser ADD WorkCalendarId INT NULL;
IF COL_LENGTH('dbo.tblUser', 'PresenceExempt') IS NULL ALTER TABLE dbo.tblUser ADD PresenceExempt BIT NOT NULL CONSTRAINT DF_tblUser_PresenceExempt DEFAULT 0;
IF COL_LENGTH('dbo.tblUser', 'PresenceNoticeAt') IS NULL ALTER TABLE dbo.tblUser ADD PresenceNoticeAt DATETIME NULL;
GO
```

- [ ] **Step 2: Seeds, module, menus**
  - For each `DISTINCT CompId FROM dbo.tblUser`: insert `tblCompanySetting` (GoLiveDate = `DATEADD(DAY, 1, CAST(GETDATE() AS DATE))` — go-live is the day after apply; admins can move it) and a default calendar `Name='Standard'`, `IsDefault=1`, DaysJson = the JSON of `DEFAULT_DAYS` from Task 1 (`[{"d":0,"on":false},{"d":1,"on":true,"start":"09:00","end":"18:00","breakStart":"13:00","breakEnd":"14:00"},…]`), both guarded by `NOT EXISTS`.
  - Owners are presence-exempt: `UPDATE tblUser SET PresenceExempt = 1` for users in a group named like the stock Owner role — **read `tblUserGroups` columns first** (the group name column is not `GroupName`) and match the Owner role by its real column; if no clean match exists, skip and note it in the report.
  - Widen `CK_tblGroupModule_Module` (drop + re-add) to include `'attendance'`. Read the current constraint definition first and keep every existing value.
  - Menus (read `tblMenu` — check whether `Id` is IDENTITY; follow how `096` inserted the Offices row, Id 50): `Today` → Route `/today`, Module `tasks`, ParentId 0, placed before My Work (Id 49) in whatever ordering column the sidebar uses; `Work calendar` → Route `/settings/work-calendar`, Module `settings`, ParentId 26. Guard both with `NOT EXISTS (… WHERE Route = …)`.

- [ ] **Step 3: Procs.** Write every proc in the 099 contract table with `CREATE OR ALTER PROCEDURE`, `SET NOCOUNT ON`, `@CompId` filtering, mutating ones in `BEGIN TRY / BEGIN TRAN / COMMIT / CATCH ROLLBACK + 500 row`. Notes:
  - `sp_SaveDayMark`/`sp_DeleteDayMark` ancestor check: the recursive CTE from `sp_FetchEscalationTargets` (walk `ReportsTo` up from `@UserId`, depth < 20), actor must appear with `Depth > 0` and be active.
  - `sp_StartSession` must not fail the login when presence insert races: use `IF NOT EXISTS … INSERT` under `WITH (UPDLOCK, HOLDLOCK)`; the unique key is the backstop — catch error 2627 and continue.
  - `sp_FetchPresence` "latest open session" = `OUTER APPLY (SELECT TOP 1 LastSeenAt FROM tblUserSession WHERE UserId = u.Id AND EndedAt IS NULL ORDER BY LastSeenAt DESC)`.
  - `sp_PresenceSweep` uses `UPDATE … OUTPUT inserted.SessionId` for RS1.
  - `sp_FetchUser`: dump the live definition; also append `WorkCalendarId, PresenceExempt` to the end of its user SELECT(s) (web user form, Task 10);, change only the search predicate so `@SearchSensitive = 0` excludes `Username` as well as `Email`/`Mobile`. Keep every other byte.
- [ ] **Step 4: VERIFY block** (commented): tables exist, `uses_quoted_identifier = 1` for every new proc (`SELECT OBJECT_NAME(object_id), uses_quoted_identifier FROM sys.sql_modules WHERE OBJECT_NAME(object_id) IN (…)`), one settings row and one default calendar per company, constraint contains `attendance`, the two menu rows.
- [ ] **Step 5: Self-check:** grep the file — every `CREATE TABLE`/`ALTER TABLE ADD` is guarded; every proc in the table exists; no `DROP` other than the constraint swap. No commit.

---

### Task 3: SQL `100_task_tat.sql`

**Files:** Create `backend/sql/100_task_tat.sql`. Dump live `sp_SaveTask`, `sp_FetchTask`, `sp_FetchWorkSettings` (from 099 file) before changing them.

**Interfaces — Produces:** every proc in the "100" contract table + reconcile rules.

- [ ] **Step 1: Schema**

```sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.tblTasks', 'DueTime') IS NULL    ALTER TABLE dbo.tblTasks ADD DueTime TIME(0) NULL;
IF COL_LENGTH('dbo.tblTasks', 'TatMinutes') IS NULL ALTER TABLE dbo.tblTasks ADD TatMinutes INT NULL;  -- NULL = policy, 0 = no clock

IF OBJECT_ID('dbo.tblTaskTatPolicy') IS NULL
CREATE TABLE dbo.tblTaskTatPolicy (
    CompId   BIGINT      NOT NULL,
    Priority VARCHAR(20) NOT NULL,
    Minutes  INT         NOT NULL,
    CONSTRAINT PK_tblTaskTatPolicy PRIMARY KEY (CompId, Priority)
);

IF OBJECT_ID('dbo.tblTaskTat') IS NULL
CREATE TABLE dbo.tblTaskTat (
    Id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    CompId         BIGINT        NOT NULL,
    TaskId         BIGINT        NOT NULL,
    UserId         INT           NOT NULL,
    AssignedAt     DATETIME      NOT NULL,
    AnchorAt       DATETIME      NOT NULL,
    TargetMinutes  INT           NULL,         -- NULL = due-date target
    HeldMinutes    INT           NOT NULL CONSTRAINT DF_tblTaskTat_Held  DEFAULT 0,
    DueAt          DATETIME      NULL,
    WarnAt         DATETIME      NULL,
    DueStale       BIT           NOT NULL CONSTRAINT DF_tblTaskTat_Stale DEFAULT 1,
    StaleKind      VARCHAR(10)   NOT NULL CONSTRAINT DF_tblTaskTat_Kind  DEFAULT 'assign',
    AcknowledgedAt DATETIME      NULL,
    WarnedAt       DATETIME      NULL,
    BreachedAt     DATETIME      NULL,
    ReopenedAt     DATETIME      NULL,
    LastClosedAt   DATETIME      NULL,
    ClosedAt       DATETIME      NULL,
    CloseReason    VARCHAR(15)   NULL,  -- completed | my_part_done | unassigned | deleted | user_left | no_clock
    BreachReasonId INT           NULL,
    BreachRemarks  NVARCHAR(500) NULL,
    ReasonAt       DATETIME      NULL,
    Verdict        VARCHAR(12)   NULL,  -- excused | not_excused
    VerdictBy      INT           NULL,  -- NULL with a verdict = the system
    VerdictRemarks NVARCHAR(500) NULL,
    VerdictAt      DATETIME      NULL,
    TaskTitle      NVARCHAR(500) NOT NULL,
    ManagerId      INT           NULL,
    BranchId       BIGINT        NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblTaskTat_Open')
CREATE UNIQUE INDEX UX_tblTaskTat_Open ON dbo.tblTaskTat (TaskId, UserId) WHERE ClosedAt IS NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblTaskTat_Sweep')
CREATE INDEX IX_tblTaskTat_Sweep ON dbo.tblTaskTat (CompId, ClosedAt) INCLUDE (DueAt, WarnAt, WarnedAt, BreachedAt, DueStale);

IF OBJECT_ID('dbo.tblTaskTatHold') IS NULL
CREATE TABLE dbo.tblTaskTatHold (
    Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    TatId         BIGINT        NOT NULL,
    Kind          VARCHAR(8)    NOT NULL,   -- blocked | manual
    ReasonId      INT           NULL,
    Remarks       NVARCHAR(500) NULL,
    StartedAt     DATETIME      NOT NULL CONSTRAINT DF_tblTaskTatHold_At DEFAULT GETDATE(),
    StartedBy     INT           NULL,
    AutoReleaseAt DATETIME      NULL,
    EndedAt       DATETIME      NULL,
    EndedBy       INT           NULL,
    HeldMinutes   INT           NULL,
    AppliedAt     DATETIME      NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblTaskTatHold_Tat')
CREATE INDEX IX_tblTaskTatHold_Tat ON dbo.tblTaskTatHold (TatId, EndedAt);

IF OBJECT_ID('dbo.tblTaskTatEvent') IS NULL
CREATE TABLE dbo.tblTaskTatEvent (
    Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    TatId       BIGINT        NOT NULL,
    Kind        VARCHAR(12)   NOT NULL,
    OldValue    NVARCHAR(200) NULL,
    NewValue    NVARCHAR(200) NULL,
    ActorUserId INT           NULL,
    At          DATETIME      NOT NULL CONSTRAINT DF_tblTaskTatEvent_At DEFAULT GETDATE()
);
GO
```

- [ ] **Step 2: Seeds** per `DISTINCT CompId FROM tblUser`, `NOT EXISTS`-guarded:
  - `tblTaskTatPolicy`: critical 120, high 240, medium 480, low 1440.
  - `tblLookup` Kind `task_hold_reason`: (`waiting_client`, "Waiting on client"), (`waiting_colleague`, "Waiting on a colleague"), (`other`, "Other") — `Code`, `Value`, `SortOrder` 1..3, `IsActive 1`.
  - `tblLookup` Kind `task_breach_reason`: (`waiting`, "Waiting on someone"), (`scope`, "Scope grew"), (`technical`, "Technical issue"), (`other`, "Other").
  - If `tblLookup.Kind` has a CHECK constraint, widen it (read it first).
- [ ] **Step 3: Change `sp_SaveTask` and `sp_FetchTask`** per the contract — `CREATE OR ALTER` from the dumped live text; touch only what the contract says. In `sp_FetchTask` add the 8 columns at the end of **every** SELECT that produces the task result set, including NULL-shaped branches (`CAST(NULL AS TIME(0)) AS DueTime, …`). The OUTER APPLY:

```sql
OUTER APPLY (
    SELECT TOP 1 tt.DueAt AS TatDueAt, tt.WarnAt AS TatWarnAt, tt.BreachedAt AS TatBreachedAt,
           h.StartedAt AS TatHeldSince, hl.Value AS TatHoldReason,
           (SELECT COUNT(*) FROM dbo.tblTaskTat c WHERE c.TaskId = t.Id AND c.ClosedAt IS NULL) AS TatOpenClocks
    FROM dbo.tblTaskTat tt
    OUTER APPLY (SELECT TOP 1 StartedAt, ReasonId, Kind FROM dbo.tblTaskTatHold WHERE TatId = tt.Id AND EndedAt IS NULL ORDER BY StartedAt) h
    LEFT JOIN dbo.tblLookup hl ON hl.Id = h.ReasonId
    WHERE tt.TaskId = t.Id AND tt.ClosedAt IS NULL
    ORDER BY CASE WHEN tt.UserId = @UserId THEN 0 ELSE 1 END, tt.DueAt
) tat
```
  (A `blocked` hold has no reason row — Node renders "Blocked" when `TatHeldSince` is set and `TatHoldReason` is NULL.)
- [ ] **Step 4: New procs** — every proc in the 100 table and the reconcile rules. `CREATE OR ALTER` `sp_FetchWorkSettings` again here so RS4 reads `tblTaskTatPolicy`. `sp_TatSweep` shape:

```sql
DECLARE @warn TABLE (TatId BIGINT, TaskId BIGINT, UserId INT);
UPDATE tt SET WarnedAt = GETDATE()
OUTPUT inserted.Id, inserted.TaskId, inserted.UserId INTO @warn
FROM dbo.tblTaskTat tt
WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL AND tt.DueStale = 0 AND tt.WarnedAt IS NULL
  AND tt.WarnAt <= GETDATE()
  AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatHold h WHERE h.TatId = tt.Id AND h.EndedAt IS NULL);
-- same for breach into @breach; then recipients = assignees (+ managers for breach) grouped, one sp_CreateNotification each.
```
- [ ] **Step 5: VERIFY block** + self-check as in Task 2 (`uses_quoted_identifier`, seeds per company, `sp_FetchTask` returns the new columns: `EXEC sp_FetchTask @UserId=1, @CompId=1, …` against a known task). No commit.

---

### Task 4: Calendar context, settings, holidays, day marks, `attendance` module (backend)

**Files:**
- Create: `backend/src/services/calendarContext.js`, `backend/src/controllers/workSettingsController.js`, `backend/src/routes/workSettingsRoutes.js`
- Modify: `backend/src/middleware/access.js` (`attendance` in `MODULES` and `REACH_MODULES`), `backend/src/config/routes.js` (`/api/work`), `backend/src/controllers/userController.js` (call `sp_SetUserWorkProfile`)
- Test: `tests/unit/services/calendarContext.test.js`, `tests/unit/controllers/workSettingsController.test.js`, `tests/unit/routes/workSettingsRoutes.test.js`, existing `access.test.js`, `userController.test.js`

**Interfaces:**
- Consumes: Task 1 (`parseDays`, `DEFAULT_DAYS`, `dateKey`), 099 procs.
- Produces:
  - `calendarContext.load(compId, userIds, fromKey, toKey) → Promise<Map<userId, {ctx, days, branchId, presenceExempt, reportsTo, calendarId}>>` — `ctx = {days, holidays, marks}`, holidays include company-wide (`BranchId NULL`) plus the user's branch. A calendar whose JSON fails `parseDays` falls back to `DEFAULT_DAYS` (log once).
  - `calendarContext.settings(compId) → Promise<{lateGraceMin, sessionBufferMin, warnPct, notifyNotSignedIn, goLiveDate}>` — from RS1 of `sp_FetchWorkSettings`, cached 60 s per CompId; `clearSettingsCache()` for tests and after saves.
  - Routes under `/api/work` (all `verifyToken, loadScope`):

| Route | Guard | Body → SP |
|---|---|---|
| `fetchWorkSettings` | `open()` | → `sp_FetchWorkSettings` → `{settings, calendars, holidays, tatPolicy}` (calendars' DaysJson parsed) |
| `saveCompanySetting` | `requireModule("settings","edit")` | validate ranges in Node too (400 with message) |
| `saveWorkCalendar` | `requireModule("settings", saveAction)` | `DaysJson` through `parseDays` → 400 with its message |
| `deleteWorkCalendar`, `saveHoliday`, `deleteHoliday` | `requireModule("settings", …)` | after holiday save/delete: `sp_TatMarkStale(@CompId, NULL, NULL, 'recompute')` and, on save, `sp_TatExcuseForDays(@CompId, NULL, holiday 00:00, next day 00:00, 'Holiday')` — both wrapped so a missing 100 (old DB) does not fail the request (catch, log). |
| `saveDayMark`, `deleteDayMark` | `open()` (SP enforces chain/admin) | ActorIsAdmin = `req.scope.isAdmin`; after success: mark stale for the user, and on a `leave` mark excuse breaches in the marked part (full: the day's 00:00–24:00; halves: the corresponding `workIntervals` span of the unmarked context). |
| `fetchDayMarks` | `open()` | `UserIds` filtered to those the caller may see: self, `req.access.teamOwners`, or `attendance` scope (see `visibleUserIds` below) |

  - `visibleUserIds(req, candidateIds) → number[] | null` (export from `workSettingsController.js`, reused by Task 5/7): admin → `null` (all); `attendance` view with reach `Company` → `null`; `attendance` view with Office/OfficeTree → users whose `BranchId` is in `scopeFor(req,'attendance').branchIds` **plus** team owners; otherwise `req.access.teamOwners` (which includes self). Implement with one query `sp_FetchCalendarContext` RS1 BranchIds when needed — or simply filter a user list the caller already loaded; keep it one function with tests for each branch.
  - `userController.save`: after a successful `sp_SaveUser`, when the body has `WorkCalendarId` or `PresenceExempt`, call `sp_SetUserWorkProfile`; `PresenceExempt` honoured only for admins (ignored otherwise). Failure here returns the SP's status (the user row is already saved — message says "Saved, but the shift could not be set").
- `access.js`: `attendance` is a reach module. Update `access.test.js` (scopeFor attendance with Team reach → teamOwners; no grant → NONE).

- [ ] **Step 1: Write failing tests** for: `calendarContext.load` (company + branch holidays, marks map, bad JSON fallback, default calendar when user has none), settings cache (one DB call for two reads within 60 s; `clearSettingsCache` forces a reload), each route's guard (route-walk test picks them up automatically once registered), each controller's happy path + one failure (400 bad days, 403 from SP passed through, stale/excuse calls made after holiday save and swallowed when they throw), `visibleUserIds` (admin, Company, Office, none), userController PresenceExempt ignored for non-admin.
- [ ] **Step 2: Run, expect FAIL.** `cd backend && pnpm exec jest calendarContext workSettings access userController`
- [ ] **Step 3: Implement** with `asyncRoute`, `firstRow`, `spOk`, `spStatus` from `utils/controllerKit` like the other controllers; register `app.use("/api/work", workSettingsRoutes)` in `config/routes.js`.
- [ ] **Step 4: Run the files above plus `routeAccess`; then the full backend suite** `pnpm exec jest --silent`. Expected: all green, ≥80% on touched files.
- [ ] **Step 5: No commit.**

---

### Task 5: Sessions + presence endpoints (backend)

**Files:**
- Create: `backend/src/services/sessionService.js`, `backend/src/controllers/presenceController.js`, `backend/src/routes/presenceRoutes.js`
- Modify: `middleware/auth.js`, `controllers/authController.js`, `realtime/socket.js`, `realtime/contract.js` (+ `web/src/realtime/contract.js` twin), `config/routes.js`, `utils/responseHelper.js` (new token error codes)
- Test: `tests/unit/services/sessionService.test.js`, `tests/unit/middleware/auth.test.js`, `tests/unit/controllers/presenceController.test.js`, `tests/unit/controllers/authController.test.js`, `tests/unit/realtime/socket.test.js` (or the existing realtime test file)

**Interfaces:**
- Consumes: Task 1 (`currentShift`, `sessionExpiry`, `extendExpiry`, `effectiveStart`, `dateKey`), Task 4 (`calendarContext.load/settings`, `visibleUserIds`), 099 procs.
- Produces:
  - `sessionService.start({req, user, device}) → {sessionId, expiresAt, showNotice}`:
    - `sessionId = crypto.randomUUID()`; device = `req.body.Device === "mobile" ? "mobile" : "web"`; ip = `req.headers["x-real-ip"] || req.ip`; ua = first 300 chars.
    - Loads the user's context for today (`calendarContext.load(compId, [userId], yesterday, today)`), `settings`.
    - `shift = currentShift(now, days)`; presence only when `shift` and not `presenceExempt` and `goLiveDate <= shift.workDate`: `start = effectiveStart(shift.workDate, ctx)`; `late = start ? max(0, floor((now - start)/60000)) : 0`; `managerId` = first `Source='manager'` row of `sp_FetchPersonManagers`.
    - `expiresAt = sessionExpiry(now, days, bufferMin)`. Calls `sp_StartSession`.
  - `sessionService.check(sessionId) → {ok:true, userId} | {ok:false, code}` with a per-process `Map` cache, TTL 60 s. Codes: no row → `SESSION_ENDED`; `EndReason='forced'` → `SESSION_FORCED`; `EndReason='logout'` → `SESSION_ENDED`; `EndReason='expired'` or `ExpiresAt < now` → `SESSION_EXPIRED`.
  - `sessionService.forget(sessionId)` (cache delete), `sessionService.touch(sessionId, user)` (extendExpiry → `sp_TouchSession`; refreshes the cache entry), `sessionService.end(sessionId, reason)`, `sessionService.endUser(userId, compId, reason) → sessionIds[]`.
  - `verifyToken` becomes `async`: after `jwt.verify`, a token **without `Sid`** → 401 `SESSION_REQUIRED` ("Please sign in again"); else `check(Sid)`; not ok → 401 with the code and messages: `SESSION_EXPIRED` "Your session ended at the end of your shift. Sign in again to continue.", `SESSION_FORCED` "An admin ended your session. Sign in again to continue.", `SESSION_ENDED` "You signed out. Sign in again to continue.". `req.user.Sid = Sid`. Keep every existing branch/test.
  - `authController.login`: after the password check, `sessionService.start(...)`; JWT payload gains `Sid`; response `data` gains `sessionExpiresAt` (ISO) and `presenceNotice` (bool). A session start failure fails the login with 500 `LOGIN_ERROR` (no session = no access).
  - `logoutUser` route becomes `verifyToken, loadScope, open()` → `sessionService.end(req.user.Sid, "logout")`. Web/mobile already ignore its errors. `authRedirectGuard`'s skip list keeps `/logoutUser`, so a 401 there causes no loop.
  - socket.js handshake: after `jwt.verify`, `check(Sid)`; not ok → `next(new Error(code))`. Add scope `SESSION: "session"` to both contract files. `presenceController.endSession` emits `emitToUser(userId, SCOPES.SESSION, {reason: "SESSION_FORCED"})` and disconnects that user's sockets (`getIo().in(rooms.user(id)).disconnectSockets(true)`) after `endUser`.
  - Routes under `/api/presence` (all `verifyToken, loadScope`):

| Route | Guard | Behaviour |
|---|---|---|
| `heartbeat` | `open()` | `touch(req.user.Sid)` → `{expiresAt}` |
| `ackNotice` | `open()` | `sp_AckPresenceNotice` |
| `fetchPresence` | `open()` | body `{WorkDate?, UserIds?}`; ids filtered by `visibleUserIds`; returns rows + computed `status` (below) |
| `fetchSessions` | `requireAdmin` | `{UserId}` → `sp_FetchSessions` |
| `endSession` | `requireAdmin` | `{UserId}` → `endUser(..., "forced")`, forget each, emit + disconnect; 400 when ending your own |

  - `presenceStatus(row, now, settings, holidayToday) → {code, label}` (export, pure): order — holiday → `Holiday`; mark leave full → `On leave`; mark on_duty → `On duty`; `HasOpenSession` and `LastSeenAt` within 5 min → `Online` (+ `Late by n min` as a second field `late` when `LateMinutes > LateGraceMin`); `SignedOutAt` → `Signed out`; `FirstSignInAt` → `Offline`; no sign-in and now < ShiftStart + grace → `Not signed in yet`; otherwise `Not signed in`. Half-day leave keeps the session-based status and adds `half: "first_half"|"second_half"`.

- [ ] **Step 1: Failing tests** — sessionService: start (presence args when inside a shift; none when exempt, no shift, or before go-live; late minutes after grace math; expiry = shift end + buffer), check cache (one SP call for two checks; `forget` forces a call; each code mapping; expiry by clock), touch extends; auth middleware: no Sid → 401 `SESSION_REQUIRED`, forced → 401 `SESSION_FORCED`, valid → `next()` with `req.user.Sid`; login: Sid in token, `presenceNotice` passthrough, start failure → 500; logout ends the session and forgets it; socket rejects a forced session; presenceController: heartbeat, fetchPresence filters ids through `visibleUserIds`, endSession (admin, not self, emits SESSION, disconnects), `presenceStatus` table test covering every branch.
- [ ] **Step 2: Run, expect FAIL.** `pnpm exec jest sessionService auth presenceController authController socket`
- [ ] **Step 3: Implement.** Existing suites that call `verifyToken` with a signed test token must now include a `Sid` and mock `sessionService.check` → `{ok:true}`; update `tests/helpers` once (a `signTestToken()` helper if one does not exist) rather than every suite separately.
- [ ] **Step 4: Full backend suite green; touched files ≥80%.**
- [ ] **Step 5: No commit.**

---

### Task 6: The sweep runner + presence sweep (backend)

**Files:**
- Create: `backend/src/jobs/sweep.js`
- Modify: `backend/src/server.js`
- Test: `tests/unit/jobs/sweep.test.js`

**Interfaces:**
- Consumes: Task 1, Task 4 (`calendarContext`), Task 5 (`sessionService.forget`), `realtime/events.emitToUser`, 099 procs; Task 7's `tatService.processPending` and `sp_TatSweep` are called from here too (wire them now behind `typeof` guards? **No** — Task 7 adds its two calls to `runOnce`; leave a clearly named `tatStep` function that Task 7 fills).
- Produces: `sweep.runOnce(now = new Date()) → Promise<{companies, expired, notSignedIn}>`, `sweep.start() → stop()`.
  - `start()`: no-op returning a no-op stop when `process.env.NODE_ENV === "test"` or `process.env.SWEEP_DISABLED === "1"`; else `setInterval(tick, 60000)` (+ one tick after 5 s); `tick` skips when the previous run is still in flight (`running` flag); errors logged, never thrown.
  - `runOnce`: companies = `SELECT CompId FROM tblCompanySetting WHERE GoLiveDate IS NOT NULL AND GoLiveDate <= CAST(GETDATE() AS DATE)` — via `sp_FetchLiveCompanies` (099). Per company:
    1. `sp_PresenceSweep` → `forget` each ended session.
    2. Not signed in: `sp_FetchPresenceCandidates(@CompId, today)`; load contexts for those users; for each user, `shift = currentShift(now, days)`; skip when no shift, `shift.workDate !== today` is fine (night shift) but use `shift.workDate` as `WorkDate` (re-query candidates for that date when it differs from today — or simply only consider shifts whose `workDate === today`; pick the latter and note it); skip on holiday / full leave / on_duty; `start = effectiveStart(...)`; when `now >= start + grace` → `sp_MarkNotSignedIn`, then `emitToUser(id, NOTIFICATIONS)` for each notified id.
    3. `await tatStep(compId, now)` (empty in this task).
  - `server.js`: after `initRealtime(server)`: TZ guard (`if (new Date().getTimezoneOffset() !== -330) console.warn("[sweep] process TZ is not Asia/Kolkata — DB datetimes will be misread")`), `const stopSweep = sweep.start();` and call `stopSweep()` in `gracefulShutdown`.

- [ ] **Step 1: Failing tests** — fake timers: `start()` in test env is a no-op; with `NODE_ENV=production`-like override (set env in the test, restore after), a second tick while the first is pending does not call `runOnce` twice; `runOnce` with two companies; not-signed-in: inside grace → no call; after grace → `sp_MarkNotSignedIn` + emits; holiday/leave/on_duty/no shift → skipped; expired sessions forgotten; an SP error in one company does not stop the next.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: suite green, ≥80%. Step 5: no commit.**

---

### Task 7: TAT backend — service, hooks, endpoints, sweep step

**Files:**
- Create: `backend/src/services/tatService.js`, `backend/src/controllers/tatController.js`, `backend/src/routes/tatRoutes.js`
- Modify: `controllers/taskController.js`, `jobs/sweep.js` (`tatStep`), `controllers/presenceController.js` (`fetchToday`, `fetchTeamToday`), `routes/presenceRoutes.js`, `config/routes.js` (`/api/tat`)
- Test: `tests/unit/services/tatService.test.js`, `tests/unit/controllers/tatController.test.js`, `taskController.test.js`, `sweep.test.js`, `presenceController.test.js`

**Interfaces:**
- Consumes: Task 1 (`addWorkingMinutes`, `workingMinutesBetween`, `endOfShift`, `at`, `warnAt`, `toSqlIst`, `dateKey`, `addDays`), Task 4 (`calendarContext`), 100 procs.
- Produces:
  - `tatService.computeDue(clock, ctx, now) → {DueAt, WarnAt, AnchorAt, TargetMinutes, HeldMinutes}` (pure; settings `warnPct` passed in `clock.warnPct`):
    - `reopen` (`StaleKind === "reopen"`): `remaining = DueAt && DueAt > LastClosedAt ? workingMinutesBetween(LastClosedAt, DueAt) : 0`; `TargetMinutes = max(60, remaining)`; `AnchorAt = ReopenedAt`; `HeldMinutes = 0`.
    - otherwise when `ReopenedAt` is set: keep `AnchorAt`/`TargetMinutes` (the reopen anchor stands).
    - otherwise: `AnchorAt = AssignedAt`; `TargetMinutes = TaskTatMinutes ?? (DueDate ? null : PolicyMinutes)`.
    - due: minutes target → `addWorkingMinutes(AnchorAt, TargetMinutes + HeldMinutes)`; date target → `base = DueTime ? at(DueDate, minutesOf(DueTime)) : endOfShift(DueDate)`, then `addWorkingMinutes(base, HeldMinutes)`.
    - **Never retroactive:** when `StaleKind !== "assign"` and `!BreachedAt` and `due <= now` → `due = addWorkingMinutes(now, 30)`.
    - `WarnAt = warnAt(AnchorAt, due, warnPct)`; when due ≤ anchor (date target already past at assignment) `WarnAt = due`.
    - `DueDate` from mssql is a JS Date at local midnight — convert with `dateKey()`; `DueTime` (TIME) arrives as a Date on 1970-01-01 — read `getUTCHours/getUTCMinutes` **after checking how the driver returns TIME locally** (log one value in a scratch script against the live DB via MCP is not possible; instead accept both `"HH:mm:ss"` strings and Date and test both).
  - `tatService.processPending(compId, taskId = null, now = new Date()) → {updated}`: `sp_TatReconcile` → RS1/RS2; nothing pending → return; load contexts for all user ids over `[dateKey(min AnchorAt/AssignedAt/hold StartedAt) − 1 day, today + 120 days]`; for each RS2 hold: `held = workingMinutesBetween(StartedAt, EndedAt, ctx)`; add to its clock's `HeldMinutes` (their clocks are in RS1 because every hold-ending proc marks the clock stale — see Reconcile rules); compute each RS1 clock; `sp_TatApplyDue` with IST strings.
  - `tatService.afterTaskWrite(req, taskId, {changed})` — `changed` = RS3 fields of `sp_SaveTask`; when any of `Priority, DueDate, DueTime, TatMinutes` changed → `sp_TatMarkStale(@CompId, @TaskId, NULL, 'change')` first; then `processPending(compId, taskId)`. Errors are logged and swallowed (a TAT failure never fails a task write); returns nothing.
  - `taskController` hooks — call `afterTaskWrite` after a successful: `save` (pass RS3), `claim`, `delete`, `bulkDelete` (per id, or once with `null` taskId), `saveChecklist`/`deleteChecklist` (completion/reopen), `addDependency`/`removeDependency`, `moveColumn`. Call `sp_TatAcknowledge` (same swallow rule) after the caller's own successful: checklist tick, `moveColumn`, `logTime`, `addComment`. `save` passes `DueTime`, `TatMinutes` and `CanSetTarget = taskAllowed(..., "reassign")` (on create: the creator can) to `sp_SaveTask`; validate `DueTime` `HH:mm` (400) and `TatMinutes` integer 0–100000 (400).
  - `saveChecklist`: when `CompletionChange === "completed"`, look up the caller's own clock for the task (`sp_FetchTaskTat` RS1 filtered) and return `data.tatReasonNeeded = TatId` when it is breached without a reason.
  - Routes `/api/tat` (`verifyToken, loadScope`; each controller first checks `taskAllowed(req, TaskId, "view_task")` → 404):

| Route | Guard | Rule |
|---|---|---|
| `fetchTatPolicy` | `open()` | |
| `saveTatPolicy` | `requireModule("settings","edit")` | then `sp_TatMarkStale(@CompId, NULL, NULL, 'change')` |
| `fetchTaskTat` | `requireModule("tasks","view")` | adds `CanJudge` per clock: not own AND (actor is an ancestor — reuse `sp_FetchEscalationTargets(@CompId, clock.UserId)` ids — OR `taskAllowed(..., "manage_members")` OR admin) |
| `acknowledge` | `requireModule("tasks","view")` | own clock |
| `hold` | `requireModule("tasks","view")` | `{TaskId, Mine, ReasonId, Remarks}`; `Mine` → own clock, `AutoReleaseAt = addWorkingMinutes(now, 3 × the user's working minutes per standard day … use 1440 working minutes = 3 standard days)`; else needs `taskAllowed("reassign")` → 403. Emits NOTIFICATIONS to RS2 ids. |
| `release` | `requireModule("tasks","view")` | own manual hold, or `reassign` |
| `myPartDone` | `requireModule("tasks","view")` | own clock |
| `saveReason` | `requireModule("tasks","view")` | `{TatId, ReasonId, Remarks}` |
| `saveVerdict` | `requireModule("tasks","view")` | `{TatId, Verdict, Remarks}`; passes `ActorManagesWorkspace = taskAllowed("manage_members")` |

  - presence `fetchToday` (`open()`): `sp_FetchToday` → `{presence, clocks, reasonPending}`; `fetchTeamToday` (`open()`): ids = `visibleUserIds(req, …)` minus self (from a company user list: `sp_FetchCalendarContext`'s RS1 is enough — or load via the existing basic `fetchUsers` SP; pick one and test it) → `sp_FetchPresence` + `sp_FetchTeamToday` merged by `UserId`, each with `presenceStatus`.
  - `sweep.tatStep(compId, now)`: `processPending(compId)` then `sp_TatSweep(@CompId)` → `emitToUser(id, NOTIFICATIONS)` for each id.

- [ ] **Step 1: Failing tests** — `computeDue` table: minutes target; due-date with time; due-date without time (end of shift); held minutes push; reopen (remaining 200 → 200; remaining 10 → 60; past-due at close → 60); retro rule (change with due in the past → now+30; assign keeps the past due; breached keeps); warnAt 80%; DueTime as string and as Date. `processPending`: nothing pending → no apply call; holds applied and their minutes added; JSON datetimes are IST strings (assert the exact string). Hooks: save with Priority change calls MarkStale then reconcile; a reconcile throw does not fail the save; acknowledge after own comment; `tatReasonNeeded` returned. Every tatController route: happy + its 403/404/400. Sweep `tatStep` emits to returned ids. `fetchTeamToday` excludes people outside reach.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: full backend suite green; touched files ≥80%. Step 5: no commit.**

---

### Task 8: Access lows L1–L4

**Files:** `backend/src/controllers/userController.js`, `web/src/pages/Master/Users.jsx`, `web/src/components/Workspace/WorkspaceSettingsModal.jsx`, `web/src/pages/Sales/Quotations/QuotationBuilder.jsx`, `web/src/pages/Task/Components/TaskDetailModal.jsx`, `web/src/pages/Task/TaskBoard.jsx`, tests beside each.

- L1 is the SQL change already in 099 (`sp_FetchUser`); add a backend test that `fetchUsers` passes `SearchSensitive: 0` for a non-sensitive caller (exists? then extend to assert the documented Username behaviour in a comment only).
- **L2** — `userController.fetch` adds `CanEdit` per row, computed with the **same** function `save` uses to refuse (extract `canEditPerson(req, row) → boolean` from the existing save checks: admin rows only by admins; non-admin needs people edit + sensitive + the row's office in people write offices + row's role within own access). `Users.jsx` shows Edit/Reset only when `row.CanEdit` (drop the `ADMIN_ROLES` name heuristic and its ponytail comment).
- **L3** — replace `useAuthStore((s) => s.user?.IsAdmin)` reads in the four files above with `useIsAdmin()` from `hooks/useAccess.js`.
- **L4** — in `userController.save`, the "current role within access" check covers **every** active group of the target (today only the first); `roleRefusal` returns a refusal (fail closed) when the access RS2 is missing.

- [ ] **Step 1: Failing tests:** fetch returns `CanEdit` false for an admin row seen by HR and for a row outside HR's write offices, true inside; Users.jsx hides Edit when `CanEdit` false; each of the four web files re-renders admin-only controls when `access.isAdmin` changes without `user.IsAdmin` changing; save refuses when the target's *second* group exceeds the actor's access; roleRefusal with missing RS2 refuses.
- [ ] **Step 2–4:** FAIL → implement → backend + web suites green, ≥80% touched. **Step 5:** no commit.

---

### Task 9: Web — sessions, re-sign-in, heartbeat, notice

**Files:**
- Create: `web/src/utils/reauth.js`, `web/src/components/ReauthDialog.jsx`, `web/src/components/PresenceNoticeDialog.jsx`, `web/src/hooks/useHeartbeat.js`, `web/src/api/presenceQueries.js`
- Modify: `web/src/utils/axiosConfig.js`, `web/src/stores/useAuthStore.js`, `web/src/realtime/SocketProvider.jsx`, `web/src/realtime/contract.js`, `web/src/App.jsx` (mount dialogs + heartbeat inside the authenticated layout), `web/src/pages/auth/Login.jsx` (send `Device: "web"`)
- Tests beside each (+ MSW handlers in `web/src/test/mocks/handlers.js`).

**Interfaces:**
- Consumes: backend codes `SESSION_REQUIRED | SESSION_EXPIRED | SESSION_FORCED | SESSION_ENDED`, login `data.presenceNotice`, `/api/presence/heartbeat`, `/api/presence/ackNotice`, socket scope `session`.
- Produces:
  - `reauth.requestReauth(code) → Promise<string /* new token */>`: first call sets store `reauth = {code, username: user.Username}` and returns a shared promise; later calls while open return the same promise. `reauth.resolveReauth(token)`, `reauth.cancelReauth()` (rejects → callers reject; then `endSession("cancelled re-sign-in")`).
  - `axiosConfig` response interceptor: 401 with `data.code` in the four session codes and not an auth URL → `const token = await requestReauth(code)`; retry the original config once (`config._retried = true`, new `Authorization`) and return its result; a second 401 on a retried request → existing `endSession`. Other 401s unchanged. The request interceptor must not reject requests while a re-auth is open (queue them through the same promise instead of `isEndingSession`).
  - `ReauthDialog` (uses `ui/Modal`, `TextInput`, `Button`): title by code — EXPIRED "Your shift session ended", FORCED "An admin ended your session", others "Please sign in again"; shows the username read-only + password field; Submit → `loginUser({identifier, password, Device:"web"})` → `useAuthStore.login(data)` → `resolveReauth(data.token)`. Error stays in the dialog. "Sign in as someone else" → `cancelReauth()`. Cannot be dismissed by backdrop/Escape. The page beneath stays mounted.
  - `useHeartbeat()`: when authenticated, POST heartbeat on mount, every 120 s while `document.visibilityState === "visible"`, and on `visibilitychange` → visible. Errors ignored (a 401 is handled by the interceptor).
  - `PresenceNoticeDialog`: shown when store `presenceNotice` is true (set from login `data.presenceNotice`). Text (exact): heading "What this workplace records"; bullets: "Your sign-in and sign-out times, and when the app was last open (every 2 minutes while it is).", "Leave and on-duty days your manager marks.", "How long assigned tasks take, counted in working hours.", "Who sees it: you, your manager and their managers, and admins.", "Kept for 13 months.", "Not recorded: screenshots, keystrokes, camera, microphone or location."; button "OK" → `ackNotice()` → store `presenceNotice=false`.
  - Socket: `invalidate` with `scope === "session"` → `requestReauth(payload.reason)`; `connect_error` whose message is a session code → `requestReauth(message)` and do not auto-reconnect until a token changes.
  - `useAuthStore`: `presenceNotice`, `reauth` fields + setters; `login` keeps working for re-auth (same user) — re-auth with a **different** username than `reauth.username` → `cancelReauth()` + full logout + navigate to login (test it).

- [ ] **Step 1: Failing tests:** interceptor queues two parallel 401s into one dialog and retries both once after success; non-session 401 still calls `endSession`; retried request 401 → `endSession`; dialog renders title per code and keeps an input in the page beneath (render a form behind it, type, re-auth, assert the value is intact); different username → logout; heartbeat timer + visibility; notice dialog shows/acks; socket session event opens the dialog.
- [ ] **Step 2–4:** FAIL → implement → `pnpm exec vitest run` full suite green; `pnpm lint` 0 errors; touched ≥80%. **Step 5:** no commit.

---

### Task 10: Web — Work calendar settings, user form, roles row

**Files:**
- Create: `web/src/api/workQueries.js`, `web/src/pages/Settings/WorkCalendar.jsx`, `web/src/pages/Settings/shiftWarnings.js`, tests
- Modify: `web/src/App.jsx` (route `/settings/work-calendar`), `web/src/pages/Master/components/UserForm.jsx`, `web/src/pages/Master/Groups.jsx` (MODULE_ROWS `{ key: "attendance", label: "Attendance (team presence)", reach: true }`), `mobile/src/types/api.ts` ModuleKey union (+`"attendance"`)

**Interfaces:**
- Consumes: `/api/work/*` (Task 4), `/api/tat/fetchTatPolicy|saveTatPolicy` (Task 7).
- Produces:
  - `WorkCalendar.jsx` with `ui/Tabs`: **Shifts** (list; editor: 7 rows weekday · Working toggle · Start · End · Break start · Break end as `TextInput type="time"`; "Default" radio; delete disabled for the default or when `UserCount > 0` with a tooltip), **Holidays** (date via `DateField` with a label, name, office `FormSelect` "All offices" + active offices), **Rules** (grace, buffer, warn %, notify toggle, go-live `DateField`; TAT targets per priority in **hours** with decimals converted to minutes). Save buttons only when `useAccess("settings").edit`.
  - `shiftWarnings(days) → string[]` (pure): "> 9 hours on <Day>" ; "> 48 hours a week"; "No break after 5 hours on <Day>"; "Night hours (21:00–06:00) on <Day> — check the rules for women staff". Shown as warnings, never blocking.
  - `UserForm.jsx`: `Shift` `FormSelect` (first option "Company standard" value `0`, then calendars), sent as `WorkCalendarId`; admin-only checkbox "No attendance tracking" → `PresenceExempt`. Load the user's current values from `WorkCalendarId`/`PresenceExempt` (returned by `sp_FetchUser` since 099).

- [ ] **Steps:** failing tests (warnings table; shift editor round-trip with a break; holiday save; rules save converts hours→minutes; non-editor sees no Save; user form sends `WorkCalendarId: 0` for company standard and omits `PresenceExempt` for non-admins; Groups shows the attendance row with reach) → implement → web suite green, lint clean, ≥80% → no commit.

---

### Task 11: Web — TAT on tasks

**Files:**
- Create: `web/src/api/tatQueries.js`, `web/src/utils/tatChip.js`, `web/src/components/Kanban/TatChip.jsx`, `web/src/pages/Task/Components/TaskDetail/TatPanel.jsx`, `web/src/pages/Task/Components/TaskDetail/BreachReasonDialog.jsx`, tests
- Modify: `web/src/components/Kanban/KanbanCard.jsx`, `web/src/pages/Task/Components/TaskDetailModal.jsx` (tab `tat` "TAT" after History; due-time + target fields), `web/src/pages/Task/Components/TaskCreateModal.jsx`, the checklist save path (open `BreachReasonDialog` on `tatReasonNeeded`), `web/src/pages/Task/MyWork.jsx` (chip on rows)

**Interfaces:**
- Consumes: task fields `DueTime, TatMinutes, TatDueAt, TatWarnAt, TatBreachedAt, TatHeldSince, TatHoldReason, TatOpenClocks`; `/api/tat/*`; `tatReasonNeeded`.
- Produces:
  - `tatChip(task, now) → null | {tone: "ok"|"warn"|"over"|"held", text, icon}`: no `TatDueAt` and no `TatHeldSince` → null; held → `held`, `On hold: <TatHoldReason || "Blocked">`; breached or `now > TatDueAt` → `over`, `Over by <d>` (`25m`, `3h 10m`, `2d 4h` — wall-clock difference); `TatWarnAt <= now` → `warn`; else `ok`; `ok`/`warn` text `Due HH:mm IST` when same IST day, else `Due Ddd HH:mm IST` (format in `Asia/Kolkata` with `Intl.DateTimeFormat`, not the browser TZ).
  - `TatChip` renders it with `ui/Chip` + lucide icon (`Clock`, `AlertTriangle`, `AlertOctagon`, `PauseCircle`) and `aria-label` = text.
  - Task form: "Due time" (`TextInput type="time"`, only when a due date is set); "Time target (hours)" — empty = company default, `0` = no clock — shown only when the caller may set it (web permission helper's `reassign` ability).
  - `TatPanel`: per clock (assignee): Assigned → Seen (`FirstSeenAt`) → Acknowledged → holds (from–to, reason) → Done/closed reason; working times are server facts, show timestamps; breach + reason + verdict; events list ("Target changed 17:00 → 18:30 IST by …"). Actions (only where they apply; server is the judge): own open clock — "Acknowledge" (if not yet), "Put on hold" (reason select from `task_hold_reason` lookups + remarks), "Release", "My part is done" (when `TatOpenClocks > 1`); task-level "Hold all"/"Release all" when the caller has `reassign`; own breached without reason — "Give reason"; `CanJudge` — "Excused"/"Not excused" (+ remarks, required for Excused).
  - `BreachReasonDialog` (`task_breach_reason` lookups; Other requires remarks; "Later" closes — it stays pending on Today).
  - After any TAT action invalidate the task list + task detail queries.

- [ ] **Steps:** failing tests (tatChip table incl. IST formatting under a non-IST `TZ` — set `process.env.TZ` is not reliable in vitest; assert via `Intl` with fixed instants; card shows chip; panel action visibility per role; reason dialog required remarks; due-time hidden without due date; target field hidden without `reassign`) → implement → suite green, lint clean, ≥80% → no commit.

---

### Task 12: Web — Today page, team view, day marks, sessions

**Files:**
- Create: `web/src/pages/Today/Today.jsx`, `TeamToday.jsx`, `DayMarkDialog.jsx`, `SessionsDialog.jsx`, tests; add fetchers to `api/presenceQueries.js` and `api/workQueries.js`
- Modify: `web/src/App.jsx` (route `/today`), notification click mapping for `presence_not_signed_in` (EntityType `user`) → `/today?tab=team` (find where P1 maps notification → route).

**Interfaces:**
- Consumes: `/api/presence/fetchToday`, `fetchTeamToday`, `fetchPresence`, `fetchSessions`, `endSession`; `/api/work/saveDayMark|deleteDayMark|fetchDayMarks`.
- Produces:
  - `Today.jsx` with `PageHeader` "Today" and tabs **Mine** / **My team** (team tab only when `fetchTeamToday` returns rows). Mine: "Signed in at 09:12 IST" (+ "Late by 12 min" when late), open clocks sorted by due with `TatChip` and link opening the task (`/tasks?taskId=`), "Reason pending" list opening `BreachReasonDialog`. Employees see the same words about themselves that their manager sees.
  - `TeamToday`: date filter (`DateField` labelled "Day", default today), table: Person · Status (`presenceStatus` label, `Late by n min` badge) · Signed in · Open · At risk · Over · Reason pending · actions ("Mark day" → `DayMarkDialog`; admins: "Sessions" → `SessionsDialog`).
  - `DayMarkDialog`: date, part (Full day / First half / Second half), kind (On leave / On duty), remarks; "Remove mark" when one exists. 403 message shown in the dialog.
  - `SessionsDialog`: list (device, IP, started, last seen, ended + reason) and "End all sessions" (disabled for yourself) → confirm via `ui/Modal` → `endSession`.

- [ ] **Steps:** failing tests (Mine renders clocks in due order; reason pending opens the dialog; team tab hidden with no rows; statuses rendered; Mark day save + 403 shown; sessions end calls API and is hidden for non-admins; notification maps to team tab) → implement → suite green, lint clean, ≥80% → no commit.

---

### Task 13: Mobile — survive sessions

**Files:** `mobile/src/api/client.ts`, `mobile/src/api/presenceQueries.ts` (new), `mobile/src/api/authQueries.ts`, `mobile/src/stores/useAuthStore.ts`, `mobile/App.tsx`, `mobile/src/features/auth/LoginScreen.tsx`, `mobile/src/types/api.ts`, a small notice component under `mobile/src/features/auth/` using `ui/Dialog`.

- `client.ts`: the unauthorized handler receives the `code` (`setUnauthorizedHandler((code?: string) => …)`).
- Store: `sessionEndedReason: string | null` set on a session code before `logout()`; `presenceNotice: boolean` from login `data.presenceNotice`; cleared on next successful login.
- `LoginScreen` shows the reason above the form (`SESSION_EXPIRED` "Your session ended at the end of your shift. Sign in again.", `SESSION_FORCED` "An admin ended your session.", others "Please sign in again.") using `ui/Text` + `colors.danger`… no — use the neutral `colors.textSecondary` token (read `theme/tokens.ts` for the real name).
- Login sends `Device: "mobile"`.
- Heartbeat: in `App.tsx`, when authenticated: on AppState `active` and every 120 s while active → `heartbeat()` (errors ignored).
- Notice: after login, when `presenceNotice` → `Dialog` with the same text as web (Task 9), "OK" → `ackNotice()`.
- Gate: `cd mobile && pnpm typecheck && pnpm lint` clean. No commit.

---

### Task 14: Docs + live check

**Files:** `CLAUDE.md` (§3 Auth: sessions + `Sid` + session 401 codes + re-sign-in; §5: first background job `jobs/sweep.js`, `SWEEP_DISABLED`; §6 Tasks: TAT clocks, reconcile, chip, holds, breach/verdict; new "Presence" bullet under §6), `backend/ROLES.md` (`attendance` module: who sees team presence; day marks by ReportsTo chain or admin; verdict rules), scratchpad `matrix-tat.mjs` (not in the repo).

- [ ] Docs edits as listed; keep them as terse as the surrounding text.
- [ ] `matrix-tat.mjs` against `http://localhost:5001` (password from `CRM_PW`), run after the user applies 099+100: login returns `Sid` token + `presenceNotice`; old token without Sid → 401 `SESSION_REQUIRED`; heartbeat extends; admin ends a test user's session → that token gets 401 `SESSION_FORCED` within 60 s; day mark by a non-manager → 403; create a task in a shared workspace with a 1-minute target (`TatMinutes: 1`) → clock exists with DueAt, after ≥ 2 sweep ticks `BreachedAt` set and exactly one breach notification; hold → chip held; reopen semantics; personal workspace task → no clock. Clean up via API.

---

## Deploy notes (for the final hand-back, not a task)

1. User applies `099` then `100` on both DBs (`-I`).
2. **Rotate `JWT_SECRET`** in `backend/.env.prd` and `backend/.env.solarcrm` (the current value is the public jwt.io sample token): `openssl rand -hex 48`. Everyone signs in again anyway because of sessions.
3. Backend rsync + `up -d --build crm crm_solar` **before a shift starts**, web build straight after, mobile build next.
4. Check go-live date per company in Settings → Work calendar (defaults to the day after 099 is applied).
