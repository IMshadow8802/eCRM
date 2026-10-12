# Today + Team Reports redesign — design

2026-10-10 · status: approved (mockups: https://claude.ai/artifact/98FSVxVH6AnS2kMQ98vBSF)

## Why

Today (Mine / My team) and the TAT + Attendance reports tell a manager nothing
useful, and some numbers are wrong (audit 2026-10-10):

- My team counts ignore the picked day (`sp_FetchTeamToday` never reads `@WorkDate`).
- "Tasks running" / Mine's "Open tasks" count only TAT clocks — tasks without a
  clock (26 of 46 shared on TestCRM) and every personal task are invisible;
  Mine says "Nothing due" to someone with overdue tasks.
- Data we hold but never show: shift, sign-out, time online, sign-in count,
  done today, accepted, hold reasons, live overdue.
- The manager never sees their own row; PresenceExempt people show "Offline".
- TAT report: "Tasks" are clocks, the trend buckets finished work by
  *assignment* day, `OpenOverdue` is computed and never shown, "Missed, delay
  rejected" silently includes "no decision yet".
- Attendance: Present + Not signed in ≠ Working days (today counted early),
  a half day counts as a full late day, no hours online, no sign-out.

Rules taken from the research (Todoist People, Asana Workload, Keka, greytHR,
Hubstaff, Zendesk/Freshdesk/JSM SLA, Linear Insights): every number opens its
list; what needs action first and in red; a % always with its count; fixed
status words; medians, not means; no pie charts; credit the person whose clock it
was (we already do — one clock per assignee).

Out of scope: mobile (does not call these endpoints), new tracking of any kind,
changes to how clocks/presence are computed, the no-checklist completion issue
(separate job).

## 1. Definitions — the one source for every number

"Day" = the picked work day (IST). "Now" = `GETDATE()`. A person's **tasks** =
rows in `tblTaskAssignee` for them, task not deleted, workspace not archived.
**Mine** includes personal workspaces; **My team** and the reports use shared +
project only (personal stays private, D10).

| Word | Rule |
|---|---|
| Open | `IsCompleted = 0` |
| Given (that day) | `tblTaskAssignee.AssignedAt` on the day |
| Done (that day) | `CompletedDate` on the day, or this person's clock closed `my_part_done` that day |
| Working on | open AND (their clock `AcknowledgedAt` set OR ≥1 checklist item ticked) |
| Not started | open AND not working on |
| On hold | open AND their clock has an open hold (`tblTaskTatHold.EndedAt IS NULL`) — reason shown |
| Overdue | open AND (their clock open and `BreachedAt` set) OR (no open clock AND due moment < now). Due moment = `DueDate` + `DueTime` (no time → end of the person's shift that day, else 23:59) |
| Close to deadline | open AND their open clock `WarnedAt` set AND not breached |
| Due today | open AND (open clock `DueAt` on the day OR no clock and `DueDate` = day) |
| Time left | clock: working minutes `now → DueAt` (`workCalendar.workingMinutesBetween`); no clock: wall time. Shown "1h 20m left" / "Overdue 2h 10m" / "No timer" |
| Missed | clock `BreachedAt` set (permanent) |
| Waiting for reason | missed AND `ReasonAt IS NULL` AND `Verdict IS NULL` |
| Waiting for your ruling | missed AND reason given AND `Verdict IS NULL` AND the viewer may rule (an active `ReportsTo` ancestor of the clock's person, or owner/manager of the workspace — same test as `sp_TatSaveVerdict`) and is not that person |

Presence for a day (per person):

| Word | Rule |
|---|---|
| Shift | the person's calendar for the day (`tblPresenceDay.ShiftStart/End`, else calendar) |
| Signed in | `tblPresenceDay.FirstSignInAt`; late chip from `LateMinutes` (after grace) |
| Online today | Σ over that day's sessions of `min(EndedAt, LastSeenAt, end of day) − max(StartedAt, start of day)`, minutes. Approximate (heartbeat every 2 min) — labelled "online", never "worked" |
| Sign-ins | count of sessions started that day + devices (web / mobile) |
| Last seen | latest `LastSeenAt` that day |
| Signed out | `tblPresenceDay.SignedOutAt` when no session is still open |
| Left early | signed out before `ShiftEnd` and no session afterwards that day |
| Status word | existing `presenceController.presenceStatus` (unchanged), PresenceExempt → "Not tracked" |

**Past day:** presence, Given, Done, Missed-that-day are for that day. Open,
Working on, Overdue, Close to deadline, Waiting-for are *live* states — on a past
day they are not shown (the card says "Live counts only for today"), never
silently mixed.

## 2. Screens

### 2.1 Today → Mine (`pages/Today/MyDay.jsx`)
- Greeting + date + "N things need you now".
- **Strip** (5 cells): Shift · Signed in (+ late chip) · Online today (+ Online/Offline, last active) · Done today (on time / late split) · Open tasks (working on / not started).
- **Needs you now** (red frame, hidden when empty): waiting for my reason (button *Explain delay* → existing `BreachReasonDialog`), then overdue, then close to deadline; sorted by time left; row = title, board · given by, chip, steps "3 of 5", *Open task*.
- **Due today** (time, title, step bar, time-left chip) | **Working on** (incl. on hold with reason).
- **Not started** (due, *Accept* → existing `/api/tat/acknowledge`; tasks without a clock show no button) | **Done today** (on time / late n min / no timer).
- Every row opens the task (`/tasks?taskId=`).

### 2.2 Today → My team (`pages/Today/TeamDay.jsx`)
- Day picker (default today) + Mine / My team switch (tab hidden when no team, decided by a light `fetchTeamDay` count, not the full payload).
- **7 tiles**: In now (of expected) · Not signed in · Late (total min) · On leave / on duty · Overdue tasks (people) · Close to deadline · Waiting for your ruling. Clicking a tile filters the people below; click again clears.
- **Cards / Table** switch (remembered per viewer in localStorage; table default when > 24 people).
- **Card** per person, ordered: overdue > waiting for my ruling > not signed in > late > close to deadline > rest, then name. Red edge when overdue or not signed in.
  - avatar + online dot, name, job title · office, status pill;
  - presence line: "In 09:42 · online 4h 10m · 2 sign-ins (web, mobile)" / "Shift 09:30–18:30 · no sign-in today · last seen Thu 12:29" / leave;
  - 6 numbers: Given today · Open · Working on · Done today · Overdue (red) · Close to deadline (amber); zero is grey;
  - missed line (red box) when any missed clock is waiting for reason or ruling, with **Rule** → existing verdict dialog;
  - row actions kept: Leave / on duty (DayMarkDialog), Sign-ins (admin, SessionsDialog).
- The viewer's own card pinned first, labelled "You".
- **Any number** opens a right-side **drawer** listing that person's tasks in that bucket (title, board, chip, due, steps) with a link to each task.

### 2.3 Reports → Task deadlines (`pages/Reports/TatReport.jsx`, own layout, shared filter bar)
- Filters as today (range presets, office, person/team, group by person / priority / board). Basis: **finish day** for finished/on-time/missed-finished; "Overdue now" is live.
- **KPI cards**: Finished on time `87%` + "40 of 46 finished" + stacked bar + previous same-length period; Missed (not excused / excused / no decision yet); Overdue right now (oldest age); Time used (median `WorkMinutes / TargetMinutes` %, p90).
- **Weekly bars** (daily when range ≤ 14 days): on-time % per bucket with finished count; amber below 85%.
- **Table** per group: Finished · On time (bar + %) · Missed · Not excused · No decision · Reason pending · Overdue now · Time used (median %). Sorted by Not excused desc. Every number opens a drawer of the clocks behind it (task, person, due, finished, reason, decision). Export CSV kept.

### 2.4 Reports → Attendance (`pages/Reports/AttendanceReport.jsx`, own layout)
- Filters: month (default current) or custom range ≤ 62 days, office, person/team.
- **KPI cards**: Present % (present person-days of working person-days, ½ counts ½) · Late arrivals (count, total min, median) · Absent (no sign-in) with top names · Hours online (median per present day vs shift length).
- **Month grid** person × day, fixed cell words: ✓ on time · late minutes · A absent · LV leave · ½ half-day leave · OD on duty · HO holiday · – weekly off · blank future. Today counts only after shift end (or once signed in).
- Totals per person: Present · Late (n) · Absent · Left early · Hours online / shift (median). Red dot on the name for late 3 working days in a row.
- Cell click → that day's sign-ins (SessionsDialog for that date; admins and the person's managers by reach).

## 3. Backend

New endpoints, all `open()` + scope in the controller (same as today's), scoped by the
`attendance` reach / `ReportsTo` subtree exactly like `fetchTeamToday`
(`visibleUserIds`); an out-of-scope `UserId` → 403.

| Endpoint | Proc | Returns |
|---|---|---|
| `POST /api/today/mine` | `sp_FetchDayTasks` + `sp_FetchSessionsRange` + `sp_FetchPresence` | presence + online + counts + described task rows |
| `POST /api/today/team` | same procs, many users | per-person presence + online + counts (no task rows) |
| `POST /api/today/teamSize` | — (Node, `visibleUserIds`) | `{count}` for the tab |
| `POST /api/today/personTasks` | `sp_FetchDayTasks` for one user, filtered by bucket in Node | drawer rows |
| `POST /api/reports/tat` (changed) | `sp_RptTat` v2 over `fn_TatReportRows` | new KPIs + per-group columns + trend by finish day + previous period |
| `POST /api/reports/tatClocks` | `sp_RptTatClocks` over `fn_TatReportRows` | drawer rows for a report cell |
| `POST /api/reports/attendance` (changed) | `sp_FetchAttendanceRange` (unchanged) + `sp_FetchSessionsRange` | + per-day cell codes, online min, left early, late streak |

All bucketing (open / working / overdue …) happens once in `utils/dayBuckets.js`;
online minutes (overlaps merged, clipped to the day) once in `utils/sessionDay.js`.

- Time left / due moment in working minutes are computed in Node
  (`workCalendar`), not SQL, like every other working-time number.
- Old `fetchToday` / `fetchTeamToday` stay until the web no longer calls them;
  removed in the same change once unused (no other caller — mobile checked).
- `routeAccess.test.js` covers every new route.

## 4. SQL — `backend/sql/108_today_reports.sql`

One script, TestCRM first. New: `sp_FetchDayTasks`, `sp_FetchSessionsRange`,
`fn_TatReportRows`, `sp_RptTatClocks`; `sp_RptTat` rewritten (GroupBy
person / priority / workspace). Read-only (no table or data changes), `CompId`
everywhere. No new indexes (volumes are tiny; revisit if a page gets slow).
Verify-after-apply block runs each proc for two TestCRM users.

## 5. Web

- `pages/Today/`: `Today.jsx` (shell, tab), `MyDay.jsx`, `TeamDay.jsx`,
  `PersonCard.jsx`, `TeamTiles.jsx`, `PersonTasksDrawer.jsx`, `todayWords.js`
  (chips, time-left text, ordering — pure, unit-tested).
- `pages/Reports/`: `TatReport.jsx`, `AttendanceReport.jsx` move off the generic
  config onto own layouts that reuse the filter bar, `ReportTable`, `Drawer`,
  `StatisticsCard`-style cards. `AttendanceGrid.jsx` for the month grid.
- `api/todayQueries.js` for the new endpoints.
- Shared `ui/` only (Card, Chip, Drawer, Tabs, Button, DateField, EmptyState); sizes in rem (fluid scaling).
- Help guides (`helpGuides.js` `today`, `tat`, attendance) rewritten to the new words.

## 6. Testing

- Backend: controller tests per endpoint (scope 403, past-day nulls, bucket
  validation), `todayWords`/ordering + online-minutes math as pure units,
  `reportKit` changes; ≥80% on touched files.
- Web: MyDay / TeamDay / drawer / tiles filter / cards-table switch / TAT + Attendance pages with MSW; ≥80%.
- Live: every new proc run against TestCRM after apply and checked against hand counts for two users (Kavya Nair 80, Priya Singh 78).
