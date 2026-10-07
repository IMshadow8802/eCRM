# Task TAT + daily presence — design

**Date:** 2026-10-07 · **Branch:** `feat/task-tat` (merged to `main` only after it is tested)
**Status:** draft for review

## 1. Why

A company with staff working from home needs to know, without asking:

1. Did the employee sign in and become active by their shift start (e.g. 09:00)?
2. When work was assigned, how long did they take to pick it up, and to finish it?
3. Which tasks ran over the time they were given, and why?

Both sides see it: the employee sees their own clocks counting down; the
manager sees their team.

## 2. Decisions already made

| # | Decision | Why |
|---|---|---|
| D1 | **TAT clock starts at assignment**, not when the employee presses Start. Two clocks: **response** (assigned → started) and **resolution** (assigned → completed). | The model every service desk uses (Zendesk, Freshdesk, ServiceNow, Jira SM). A clock the employee starts is a clock the employee controls. |
| D2 | **Clocks count working time only**, from a work calendar with holidays. | 1 h assigned at 17:45 Friday is due 09:45 Monday, not 18:45 Friday. |
| D3 | **No free Pause.** The clock stops only while the task is **On hold**, which needs a reason and is logged. | Fair to the employee without being self-reported. |
| D4 | **Breach is permanent.** Completing late does not clear it. | Reports must be able to count it. |
| D5 | **Each assignee has their own clocks.** | 3 live tasks already have two assignees; one slow person must not mark the other late. |
| D6 | **Reassignment closes the old assignee's clock and opens a new one.** An old breach stays on record. | |
| D7 | **Sessions end daily.** Signing in is the check-in. | Today a token silently lives 24 h and logout does nothing server-side, so "first signed in" cannot be known. |
| D8 | **Presence = app open + real interaction**, via heartbeat. Nothing more. | No screenshots, keystrokes or camera: DPDP Act 2023 risk and a different product. |
| D9 | Complaints move onto the same calendar, **last phase**. | One meaning of "1 hour" everywhere. Reverses the 2026-07-16 "no business hours" decision on purpose. |
| D10 | **Working-time maths lives in one JS module** (`backend/src/utils/workCalendar.js`), not in SQL. SQL stores the computed timestamps and only compares them to `GETDATE()`. | It is the most error-prone code in the feature and the only place a mistake silently mis-flags everyone. In JS it gets exhaustive unit tests; in SQL our mocked tests cannot reach it (§0.4). |

## 3. What exists today (measured 2026-10-07)

| Piece | State |
|---|---|
| `tblTasks.EstimatedHours`, `tblTimeEntries`, "Log time" panel | Built, **unused** (0 estimates, 0 entries). Manual hours, no flag. Left as is — out of scope. |
| `tblTasks.CompletedDate` | Set by `sp_RecomputeTaskCompletion` when the checklist completes. Task-level. |
| `tblTaskAssignee.AssignedAt` | Per assignee. Rows are deleted on unassign. |
| `tblTaskReads.FirstSeenAt` | When the assignee first opened the task. |
| `tblActivityLog` | Task events logged; **no login events** (the `LOGIN` constant is never written). |
| Auth | JWT, 24 h, no session table, logout is client-only, `refreshToken()` unrouted. |
| Notifications | `tblNotifications` + `sp_CreateNotification`; socket.io `invalidate` events to `user:<id>` (web only; mobile has no socket). |
| Background jobs | None. One Node process per client container. |
| Company settings table | None (company lives in Central). |
| Task priority | String: `low` / `medium` / `high` / `critical`. |
| Web "My Work" | Does not exist (mobile has `MyWorkScreen`). |

## 4. Features

### F1 Work calendar

- **Calendars are named shifts** per company: "General 10–19", "Morning 9–18". One is the company default.
- Per weekday: working or not, start, end, optional break (break minutes are not working time).
- **Holidays** per company, optionally per branch.
- **Each user may be assigned a calendar** (`tblUser.WorkCalendarId`); null = company default.
- **Presence-exempt users** (`tblUser.PresenceExempt`, e.g. Owner): no late/absent marks, but their task clocks still run on their calendar.
- Company settings: late grace (default **10 min**), session buffer after shift end (default **2 h**), warn threshold (default **80%**), notify manager on not-signed-in (default **on**).
- Admin screen under Settings → Work calendar.
- **`workCalendar.js`**: `addWorkingMinutes(calendar, holidays, from, minutes)`, `workingMinutesBetween(calendar, holidays, from, to)`, `shiftFor(calendar, holidays, date)`. Pure functions, IST, no I/O. Every other part calls these.

### F2 Sessions and daily sign-in

- **`tblUserSession`** — one row per sign-in: `SessionId` (GUID), user, company, branch, device (`web`/`mobile`), IP, user agent, `StartedAt`, `ExpiresAt`, `LastSeenAt`, `LastActiveAt`, `EndedAt`, `EndReason` (`logout` / `expired` / `forced`).
- **Expiry** = today's shift end + buffer; outside a shift, or on a non-working day, 23:59 IST. Never past 23:59 — every day starts with a sign-in.
- The JWT carries `sid` and expires with the session.
- **`verifyToken` checks the session is open**, through a 60-second in-memory cache per container. Force-end therefore lands within 60 s; a socket `session-ended` event makes it immediate on an open web tab.
- **Logout** ends the session server-side (today it does nothing).
- Web and mobile may each hold a session at the same time.
- **Rollout:** tokens without `sid` are rejected, so everyone signs in once after deploy. Intended.

### F3 Presence

- **`tblPresenceDay`** — one row per user per working day, written at first sign-in: shift start/end **frozen at that moment** (a later calendar edit does not rewrite history), `FirstSignInAt`, `LateMinutes`, `LastSeenAt`, `SignedOutAt`.
- **Heartbeat** `POST /api/presence/heartbeat` every 2 min while the app is in the foreground, with `active` = any pointer/key/touch in the last 2 min. Updates the session's `LastSeenAt` / `LastActiveAt`.
- **Status shown:** Active (active heartbeat ≤ 5 min) · Idle *n* min (seen but not active) · Offline (no heartbeat ≤ 5 min) · Signed out · **Not signed in** (working day, past shift start + grace, no sign-in) · **Late by *n* min**.
- At shift start + grace, a not-signed-in user's `ReportsTo` manager gets one notification (company setting).

### F4 Task TAT

- **Targets** in working minutes:
  - Company defaults per priority (`tblTaskTatDefault`: priority → response, resolution). Seeded: critical 30m/2h · high 1h/4h · medium 2h/1d · low 4h/3d (1d = one shift).
  - Per-task override (`tblTasks.ResponseTargetMinutes`, `ResolutionTargetMinutes`), settable by the workspace owner/manager or the creator — the people who can assign today.
  - Null target = no clock.
- **`tblTaskTat`** — one row per (task, assignee, assignment): `AssignedAt`, targets, `ResponseDueAt`, `ResolutionDueAt`, `StartedAt`, `CompletedAt`, `WarnedAt`, `ResponseBreachedAt`, `ResolutionBreachedAt`, `HeldMinutes`, `ClosedAt` + `CloseReason` (`completed` / `unassigned` / `deleted`).
  - Opened by the controller after `sp_SaveTask` reports a new assignee; due times come from `workCalendar.js` against **the assignee's** calendar.
  - Closed with `unassigned` when the assignee is removed; the row survives (`tblTaskAssignee` does not).
- **Start** — `POST /api/tasks/startTask`: the assignee stamps `StartedAt` on their own clock. Idempotent. Stops the response clock.
- **Complete** — unchanged (checklist). When `sp_RecomputeTaskCompletion` stamps `CompletedDate`, every open clock on the task gets `CompletedAt` and closes. Reopening the task (checklist un-ticked) reopens clocks that closed as `completed`; breach stamps stay.
- **On hold** — `tblTaskHold` (task, start, end, reason from lookup `Kind='task_hold_reason'`, remarks, by). While a hold is open the task shows On hold and the sweep skips it. On release, every open clock's due times move forward by the working minutes the hold covered, and `HeldMinutes` accumulates. Who can hold/release: anyone who can edit the task.
- **The board column is not a status here.** Columns are free text per workspace, so nothing is inferred from them.

### F5 Breach reasons

- **`tblTaskTatReason`** — per breached clock: kind (`response` / `resolution`), reason (lookup `Kind='tat_reason'`, seeded: Waiting on someone · Scope grew · Technical issue · Unplanned leave · Other), remarks, by, at; manager verdict `excused` / `not_excused` + remarks, by, at.
- **Completion is not blocked.** Ticking the last checklist item on a breached task opens the reason dialog; skipping it leaves the breach **Reason pending**, which stays on the employee's Today strip until given and counts as unexcused in reports. Blocking the last tick would stop work, not record it.
- Verdict by the assignee's `ReportsTo` chain or a workspace owner/manager.

### F6 Background sweep

- `setInterval` every 60 s in each container, started from `server.js`, calling `sp_TatSweep(@Now, @WarnPct)`:
  - stamps `WarnedAt` / `ResponseBreachedAt` / `ResolutionBreachedAt` with `UPDATE … WHERE … IS NULL OUTPUT …` — **idempotent**, so an overlap or a restart cannot double-fire;
  - skips tasks with an open hold;
  - returns the stamped rows; Node creates notifications (`task_tat_warning`, `task_tat_breached`) for the assignee and, on breach, their `ReportsTo`, and emits `invalidate`.
- Same tick: not-signed-in check (F3), and expiring sessions past `ExpiresAt` (`EndReason='expired'`).
- One failure is logged and the next tick carries on; a tick never overlaps the previous one.

### F7 Where it shows

- **Task card** (board, lists, mobile): chip — green with time left · amber from 80% · red *Breached 25m* · grey *On hold*. Response chip until started, then resolution chip.
- **Task detail:** new **TAT** tab — per-assignee timeline: Assigned → Seen → Started → On hold … → Completed, working time for each step, breach + reason + verdict. Start / On hold / Release buttons.
- **Today page** (new, web `/today`):
  - *Employee view:* my sign-in time (and Late), my open tasks by soonest due with chips, Reason pending list.
  - *Manager view* (anyone whose `DataScope` covers other users): a row per person — presence status, signed in at, late by, open / at risk / breached counts; expands to their tasks.
- **Notifications:** bell + toast on web; on mobile, a notifications screen refreshed on app focus (no push — §9.7 of CLAUDE.md).
- **Session ended** (expired/forced): the existing end-session path, with a message saying why.

### F8 Reports (`ReportShell` frame)

- **TAT compliance** — by employee / team / period: clocks, on-time %, breached, excused, avg response, avg resolution (working minutes). Drill to the clocks.
- **Breach reasons** — count by reason, excused vs not.
- **Attendance** — by employee / period: working days, signed in, late (count, avg minutes), not signed in.
- Scope = `req.scope` over users (`DataScope`), like every other report.

### F9 Mobile parity

Sign-in as check-in, heartbeat on `AppState` active, session-ended handling, chips on `TaskCard`, TAT tab, Start / On hold / reason dialog, notifications screen. No Today manager view (admin work is web-only).

### F10 Complaints on the calendar (last phase)

`sp_SaveTicket` / `sp_SetTicketStatus` stop computing `DueAt` themselves; the ticket controller computes it with `workCalendar.js` against the assignee's calendar (company default when unassigned) and passes it in. `TatHours` stays the setting, now read as working hours.

## 5. Permissions

- Presence and Today: `req.scope` over **users** — Self sees self, Team sees `ReportsTo` subtree, Branch/Company by branch. Never wider.
- Task TAT: follows task permissions (`sp_CheckTaskPermission`); starting a clock is the assignee's own act only.
- Calendar admin and force-end: `IsAdmin` only.
- Every table carries `CompId`; every SP filters on it.

## 6. Build order

1. **SQL** — one script `backend/sql/093_task_tat_presence.sql`: tables, columns, lookups + seeds, defaults, SPs, menu rows. User applies to eCRM+ and SolarCRM.
2. **Backend** — `workCalendar.js` first (tests before anything uses it), then sessions/auth, presence, TAT hooks + endpoints, sweep, reports.
3. **Web** — parallel agents by page: calendar settings · Today · task card + TAT tab · reports · heartbeat + session-ended.
4. **Mobile** — F9. Gate: `pnpm typecheck` + `pnpm lint`.
5. **Complaints** — F10.

Each phase verified (tests + coverage ≥80% on touched files) before the next. SP↔controller contracts checked against the live DB after step 1.

## 7. Out of scope

Screenshots/keystroke/camera monitoring · geofencing · payroll attendance (a separate Attendance product runs on the server) · push notifications · changes to the existing Log-time panel · a free Pause button.

## 8. Risks

| Risk | Handling |
|---|---|
| Calendar maths wrong ⇒ everyone mis-flagged | D10: one pure module, table-driven tests incl. holidays, breaks, overnight, weekend, DST-free IST. |
| Daily expiry annoys mobile users | It is the requirement; sign-in is one screen with the company code remembered. |
| Session check on every request | 60 s cache per container. |
| Sweep runs twice (restart mid-tick) | Stamps are `IS NULL`-guarded; notifications come only from stamped rows. |
| Calendar edited mid-day | Presence day is frozen at sign-in; open clocks keep their due times; new clocks use the new calendar. |
