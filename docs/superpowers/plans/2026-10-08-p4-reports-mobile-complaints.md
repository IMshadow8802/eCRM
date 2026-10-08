# P4 — TAT & Attendance reports, mobile TAT, complaints on the calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship P4 of the TAT/presence spec: two reports (TAT, Attendance), task TAT on mobile, and complaint due times counted in working hours on the assignee's shift.

**Architecture:** Working-time maths stays in `backend/src/utils/workCalendar.js` (D12). A clock's worked minutes are computed in Node once it closes and stored (`tblTaskTat.WorkMinutes`), so the TAT report is plain SQL (`sp_RptTat`, same contract shape as the sales reports). The Attendance report is a Node controller over raw presence rows, because working days need the calendar. Complaints keep `sp_SaveTicket` / `sp_SetTicketStatus` as the only writers of `DueAt`; Node computes the working-time due and passes it in a new optional param (NULL = today's wall-clock behaviour, so the old Node keeps working).

**Tech:** as P2/P3. **Spec:** `docs/superpowers/specs/2026-10-07-task-tat-presence-design.md` §7 (+ §2 D9, D12, D13). Previous plan (conventions, contracts): `docs/superpowers/plans/2026-10-08-tat-presence.md`.

## Global Constraints

- Git read-only; leave work uncommitted. SQL written to `backend/sql/101_p4_reports.sql`, never applied by agents; `SET QUOTED_IDENTIFIER ON`; **EXEC arguments must be variables or literals, never expressions** (100 failed on this); additive + backward compatible (old Node keeps running).
- pnpm only; test-first; ≥80% line+branch on touched files; every route declares access; CompId/UserId from `req.user`.
- Times IST. JSON datetimes to SQL via `toSqlIst`; DATE columns to clients via `workCalendar.dayKey`.
- Scope (D9): a caller sees self + `ReportsTo` subtree + `attendance` reach (`workSettingsController.visibleUserIds`). Employees see their own rows. Never 403 on scope — rows outside reach are dropped.
- Report copy: neutral. "On time", "Ran over", "Ran over, not excused", "Excused", "Working days", "Late", "Not signed in".
- Mobile: no tests (typecheck + lint), tokens only, `ui/` components, fetchers only in `src/api/`. Admin/manager work (verdicts, day marks, Today team view) stays web-only.

## Review Focus

1. A clock closed while held or reopened later: WorkMinutes = working minutes from AnchorAt (or AssignedAt) to ClosedAt minus HeldMinutes, never negative; recomputed (set NULL) when the clock reopens.
2. Report scope: an employee calling the TAT/Attendance report with another person's `OwnerId` gets no rows, not that person's data.
3. Complaint created unassigned → due on the company default calendar; a later transfer does **not** move DueAt (ruling below).
4. Old Node against 101: sp_SaveTicket / sp_SetTicketStatus without the new param behave byte-for-byte as before.
5. Attendance working days with half-day leave count 0.5; holidays and full leave 0; non-working weekdays 0; dates before go-live excluded.

## Decisions (rulings)

- R-P4-1: Both reports are under a new sidebar parent **"Team Reports"** with Module `tasks` (everyone who has tasks sees them; the data is scoped). Routes `/reports/tat`, `/reports/attendance`.
- R-P4-2: TAT report date basis = the clock's **AssignedAt** in range (one basis; the basis picker is hidden). GroupBy: `person` (default), `priority`, `workspace`, `verdict_by`.
- R-P4-3: Complaint transfer does not re-stamp DueAt (the clock belongs to the ticket, not the agent); only create, priority change and reopen stamp it — same as today. Priority change re-stamps from `tblTicket.TatAnchorAt` (new column; NULL on old rows → CreatedAt).
- R-P4-4: Mobile gets the chip, a TAT tab with own-clock actions (acknowledge, hold/release own, my part done, give reason). No verdicts, no hold-everyone, no Today team view on mobile.

---

## SQL contract — `101_p4_reports.sql`

| Object | Contract |
|---|---|
| `tblTaskTat.WorkMinutes INT NULL` | guarded ADD |
| `tblTicket.TatAnchorAt DATETIME NULL` | guarded ADD |
| `sp_TatReconcile` (changed) | wherever a clock is reopened or resumed, also `WorkMinutes = NULL`. Nothing else changes (dump live text, patch). |
| `sp_TatPendingWork` | `@CompId` → closed clocks with `WorkMinutes IS NULL AND ClosedAt IS NOT NULL` (TOP 500): `Id, UserId, AssignedAt, AnchorAt, ClosedAt, HeldMinutes` |
| `sp_TatApplyWork` | `@CompId, @ItemsJson` (`[{Id, WorkMinutes}]`) → sets where `WorkMinutes IS NULL`; RS1 status |
| `sp_RptTat` | params `@CompId, @FromDate, @ToDate, @GroupBy VARCHAR(20)='person', @BranchId INT=NULL, @OwnerId INT=NULL, @UserIdsJson NVARCHAR(MAX)=NULL` (NULL = no user filter, `[]` = nobody). Clocks with `AssignedAt` in [From, To+1). RAISERROR on unknown GroupBy (`person, priority, workspace, verdict_by`). **RS1** KPIs: `Clocks, Closed, OnTime` (closed, never breached), `OnTimePct` (OnTime*100.0/NULLIF(Closed,0), 1 dp), `RanOver` (BreachedAt not null), `RanOverNotExcused` (RanOver and Verdict IS NULL or 'not_excused'), `Excused`, `OpenOverdue` (open and BreachedAt not null), `MedianWorkMin`, `P90WorkMin` (PERCENTILE_CONT over closed WorkMinutes). **RS2** per group: `GroupKey, GroupLabel, Clocks, Closed, OnTime, OnTimePct, RanOver, RanOverNotExcused, Excused, MedianWorkMin, P90WorkMin` (`verdict_by`: label = verdict giver's FullName, "System" for VerdictBy NULL with a verdict, only rows with a verdict). **RS3** trend: `Bucket` (day, or ISO week start when the range > 31 days) with `Closed, OnTime, RanOver`. |
| `sp_FetchAttendanceRange` | `@CompId, @FromDate, @ToDate, @UserIdsJson NULL` → RS1 users (active, not exempt): `UserId, FullName, BranchId, ManagerId(ReportsTo)`; RS2 presence rows in range: `UserId, WorkDate, FirstSignInAt, LateMinutes, NotSignedInAt`; RS3 `GoLiveDate`, `LateGraceMin` |
| `sp_SaveTicket` (changed) | + `@DueAtOverride DATETIME = NULL` appended. Where it stamps DueAt (create; update when priority changed) it uses `ISNULL(@DueAtOverride, <existing expression>)` and sets `TatAnchorAt` = `@Now` on create; priority change keeps TatAnchorAt. Everything else byte-identical. |
| `sp_SetTicketStatus` (changed) | + `@DueAtOverride DATETIME = NULL` appended; on reopen `DueAt = ISNULL(@DueAtOverride, <existing>)` and `TatAnchorAt = @Now`. |
| `sp_FetchTicketDue` | `@CompId, @TicketId` → `AssignedTo, Priority (lookup Id), TatHours (of current priority), CreatedAt, TatAnchorAt` |
| Menus | parent "Team Reports" (Route NULL, Module NULL), children "TAT" `/reports/tat` Module `tasks`, "Attendance" `/reports/attendance` Module `tasks` — `NOT EXISTS` guarded, same insert style as 099's Today row. |

---

### Task 1: SQL `101_p4_reports.sql`

**Files:** Create `backend/sql/101_p4_reports.sql`. Dump live `sp_TatReconcile`, `sp_SaveTicket`, `sp_SetTicketStatus` first (`sys.sql_modules`); patch only what the contract says. Pattern: `git show fbd81c2:backend/sql/100_task_tat.sql`.

- [ ] Header + guarded columns, procs (`CREATE OR ALTER`, `GO` before each), menus, VERIFY block (incl. `uses_quoted_identifier` check and `EXEC sp_RptTat @CompId=1, @FromDate='2026-10-01', @ToDate='2026-10-31'`).
- [ ] Self-check: grep every `EXEC` argument list — no expressions; every proc in the table present; changed procs keep every existing param + result column.

### Task 2: Backend — worked minutes, TAT report, Attendance report

**Files:** modify `services/tatService.js` (+ `processWork(compId)`), `jobs/sweep.js` (tatStep calls it after processPending), `utils/reportKit.js` (REPORTS row `tat` with `{sp:"sp_RptTat", groupBys:["person","priority","workspace","verdict_by"], bases:["assigned"]}` — `parseReportArgs` validates DateBasis against `REPORTS[key].bases || DATE_BASES`; the TAT SP gets no DateBasis/Source/Product params), `controllers/reportController.js`, `routes/reportRoutes.js`; create `controllers/attendanceReport.js` (or a method on reportController). Tests beside each.

- `processWork(compId)`: `sp_TatPendingWork` → load calendar contexts for the users over `[min AnchorAt − 1 day, max ClosedAt]` → `WorkMinutes = max(0, workingMinutesBetween(AnchorAt ?? AssignedAt, ClosedAt, ctx) − HeldMinutes)` → `sp_TatApplyWork`. Log-and-swallow.
- `POST /api/reports/tat` — guard `open()`; body via `parseReportArgs(body,"tat")` (OwnerId = assignee filter); `UserIdsJson` = `visibleUserIds(req)` (null → NULL, else JSON of ids; if an OwnerId outside the allowed set is asked → `[]`). Response shape identical to runReport (`kpis, rows, trend, range`).
- `POST /api/reports/attendance` — guard `open()`; From/To like parseReportArgs (default last 30 days, ≤ 731), GroupBy `person` only (rows per person), optional BranchId/OwnerId narrow within scope. Calls `sp_FetchAttendanceRange`, loads calendar contexts for the users over the range, and per user per date from `max(From, GoLiveDate)` to `min(To, today)`: working day value = 0 when no shift / holiday / full leave, 0.5 for half leave, else 1; Late = `LateMinutes > LateGraceMin` on a day with a sign-in; NotSignedIn = day value > 0 and no `FirstSignInAt`. Output: `kpis {People, WorkingDays, PresentDays, LateDays, MedianLateMin, NotSignedInDays}`, `rows [{GroupKey: UserId, GroupLabel: FullName, WorkingDays, PresentDays, LateDays, MedianLateMin, NotSignedInDays}]`, `trend [{Bucket: 'YYYY-MM-DD', Present, Late, NotSignedIn}]` (weekly buckets when > 31 days), `range`.
- [ ] Tests: processWork (held minutes subtracted, never negative, AnchorAt preferred); tat report scope (employee → own id only; OwnerId outside scope → `[]`; admin → NULL); parseReportArgs per-report bases; attendance maths table (half leave 0.5, holiday 0, weekend 0, before go-live excluded, late vs grace, not signed in), weekly bucketing.

### Task 3: Backend — complaints due on the working calendar

**Files:** create `backend/src/services/ticketDue.js`; modify `controllers/ticketController.js` (save, setStatus/reopen paths). Tests.

- `ticketDue.compute(compId, {assigneeId, tatHours, anchorAt}) → Date | null`: null when `tatHours` null; calendar = the assignee's (company default when unassigned — `calendarContext.load` with the assignee, or a context built from the company default calendar); `addWorkingMinutes(anchorAt, tatHours*60, ctx)`.
- Create: priority's TatHours from the lookup (existing fetcher/SP used by configController), assignee from the body, anchor = now → pass `DueAtOverride`.
- Update: call `sp_FetchTicketDue` first; if the body's priority differs → compute with anchor `TatAnchorAt ?? CreatedAt` and the new priority's TatHours → `DueAtOverride`. Otherwise pass nothing.
- Reopen (any status move the SP treats as reopen — read `sp_SetTicketStatus` / the controller's reopen detection; simplest: always compute for the ticket's current assignee with anchor now and pass it; the SP only uses it on reopen) → `DueAtOverride`.
- Failure to compute → log and pass NULL (old wall-clock behaviour), never fail the ticket write.
- [ ] Tests: unassigned create uses company default calendar; created Saturday 17:00 with 4 h TatHours → Monday 11:00 (Mon–Sat 9–18, break 13–14); priority change re-stamps from anchor; reopen stamps from now; compute failure → NULL passed; transfer passes nothing.
- [ ] Update `CLAUDE.md` §6 Support "TAT and escalation": TatHours are working hours on the assignee's shift (company default when unassigned) since P4; the D13 reversal of the 2026-07-16 no-business-hours decision; DueAt still written only by the two SPs.

### Task 4: Web — report pages

**Files:** modify `web/src/pages/Reports/ReportPage.jsx` (+ prop `pickers` — subset of `["branch","owner","source","product"]`, default all; when `dateBases` has one entry the basis picker is already hidden), `reportUtils.js` if needed; create `web/src/pages/Reports/TatReport.jsx`, `AttendanceReport.jsx`, routes in `App.jsx`, endpoints in a new `web/src/api/reportQueries.js` (or extend the existing constants). Tests.

- TAT page: KPIs (Clocks, On time %, Ran over, Ran over not excused, Median working time, P90) — minutes formatted `3h 10m`; group-by person/priority/workspace/verdict giver; trend Closed/On time/Ran over; pickers branch + owner (label "Person"); drill: person row → `/tasks/my-work`? No drill (pass `drill={null}` and support it in ReportPage: rows not clickable).
- Attendance page: KPIs (People, Working days, Present, Late days, Median late, Not signed in); rows per person; trend Present/Late/Not signed in; pickers branch + owner ("Person"); no drill.
- [ ] Tests: ReportPage hides unlisted pickers and supports `drill={null}`; each page renders KPIs/rows from a mocked response and sends the right body.

### Task 5: Mobile — task TAT

**Files:** `mobile/src/types/api.ts` (Task TAT fields: `DueTime, TatMinutes, TatDueAt, TatWarnAt, TatBreachedAt, TatHeldSince, TatHoldReason, TatOpenClocks`; TAT clock/hold/event types), `mobile/src/api/tatQueries.ts` (fetchTaskTat, acknowledge, hold, release, myPartDone, saveReason — bodies exactly as web `web/src/api/tatQueries.js` sends), `mobile/src/features/tasks/tatChip.ts` (port of `web/src/utils/tatChip.js` `tatChip` + IST formatting), `TaskCard.tsx` (chip via `ui/Chip`), `TaskDetailScreen.tsx` (Segmented tab "TAT" + body: own clock timeline Assigned → Seen → Acknowledged → holds → Done; actions per R-P4-4 via `ActionSheet`/`ComposeSheet` with hold reasons and breach reasons from the lookups fetcher), notifications: `tat_warning`/`tat_breach`/`tat_hold` open the task (check `NotificationsScreen.tsx` mapping).
- [ ] Gate: `cd mobile && pnpm typecheck && pnpm lint` clean.

### Task 6: Docs + live check

- [ ] `CLAUDE.md` §6 Tasks TAT bullet: WorkMinutes stored at close by the sweep; reports at `/api/reports/tat|attendance`. `backend/ROLES.md`: reports scope = attendance reach / subtree, employees own rows.
- [ ] Scratchpad `matrix-p4.mjs` (not in repo): TAT report returns KPIs for the owner; an employee sees only own rows; attendance report shape; a complaint created on a Saturday evening with a 4 h priority is due Monday 11:00 IST (use a test customer, clean up).
