# Task TAT, daily presence, and the task/people foundation — design

**Date:** 2026-10-07 · **Branch:** `feat/task-tat-presence` (merged to `main` after testing)
**Status:** v2, for approval — replaces the morning draft
**Evidence:** `2026-10-07-tat-audit/` (`00-findings.md` + five reports). Security holes S1–S8 are already fixed and live (`093`, commit `c51e87b`).

## 1. Goal

A company with staff working from home must know, without asking:

1. Did each person sign in by their shift start, and are they online now?
2. When work was handed to someone, how long did it take to finish — in working time?
3. What ran over, and why?

Both sides see it: the employee sees their own clocks; the manager sees their team. **This is a CRM, not an HR system** — the manager marks leave; nobody applies for anything.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | The clock starts at **assignment**, counted in **working time** (shift calendar + holidays + the person's marked days). |
| D2 | **Only the resolution clock is judged** (assigned → done). "Acknowledged at …" is recorded and shown, never breached, never in a score. |
| D3 | **No free pause.** A clock stops only while the task is on hold with a reason, blocked by a dependency, or the person is on leave / it's a holiday. |
| D4 | A breach is **permanent**; finishing late does not clear it. |
| D5 | **Each assignee has their own clock**, closed by their own "My part is done" or by the task completing. |
| D6 | **The manager marks the day** — *On leave* (full / first half / second half) or *On duty* (field visit, outage). No requests, no approvals, no balances. |
| D7 | **Sessions end daily**; the sign-in is the check-in. |
| D8 | Presence is **Online / Offline** from heartbeats. No "idle" counter, no screenshots, keystrokes, camera or location. |
| D9 | **"My team" = the `ReportsTo` subtree.** Company-wide only for admins or a new *Attendance* menu grant. |
| D10 | **No TAT in personal workspaces** — they are private even from admins. |
| D11 | **Every task has at least one checklist step** (completion = all steps done). |
| D12 | Working-time arithmetic lives in **one JS module** (`backend/src/utils/workCalendar.js`), fully unit-tested. SQL stores the computed timestamps and only compares them with `GETDATE()`. |
| D13 | Complaints move onto the same calendar in the last phase (reverses the 2026-07-16 "no business hours" decision on purpose; CLAUDE.md §6 changes with it). |

## 3. Phases

Each phase ships on its own: one SQL script (user-applied, `SET QUOTED_IDENTIFIER ON` at the top), backend, web, mobile; tests with ≥80% line/branch coverage on touched files; a live API check like `093`'s.

| Phase | What | Why first |
|---|---|---|
| **P1** | Task & people foundation | Without it, clocks measure our bugs instead of people. |
| **P2** | Calendar, day marks, sessions, presence | P3 counts working time from it. |
| **P3** | Task TAT | The feature. |
| **P4** | Reports, mobile parity, complaints on the calendar | Reads what P2/P3 record. |

---

## 4. P1 — Task & people foundation

### Tasks
1. **Soft delete.** `tblTasks.IsDeleted/DeletedAt/DeletedBy`; the "clear checklist first" 409 goes (it made delete impossible: 37/39 tasks have steps). Every task fetch filters deleted rows. Web gets a Delete in the task modal (today only a bulk delete that always fails).
2. **At least one step, always.** The 2 live tasks without steps get one ("Complete this task"). Deleting a task's last step is refused.
3. **Step rights split.** Ticking = `change_status` (assignees, incl. viewers). Adding, renaming, reordering, deleting = `manage_checklist`. Today a rename rides the tick permission.
4. **Viewers cannot be assignees** (400). They can't complete a task.
5. **Leaving a workspace = leaving its tasks.** Member removal, leaving, team/project sync, archive and user deactivation unassign that person from open tasks there and tell the owner which tasks became unassigned. Today they stay assigned to tasks they can no longer open.
6. **Notifications open the task.** Web: `?taskId=` switches to the task's workspace and opens it; comment notifications resolve to their task. **Mobile:** a notifications screen (refreshed on app focus) that opens the task.
7. **Told when it's done.** Creator and assigner are notified on complete, reopen, and when a blocking task finishes.
8. **"Seen" is recorded.** First and last time each assignee opened the task (`tblTaskReads.FirstSeenAt/LastSeenAt` — never written today).
9. **My Work on web.** `sp_FetchTask` gains `@AssigneeUserId`, `@OnlyOpen`, `@Overdue` and drops archived/deleted. Web gets a My Work page across all boards (mobile has one; web has none). P3 turns it into Today.
10. **Take this task.** A member can claim an unassigned task (the `claim_task` permission exists; no endpoint uses it).
11. **Board = completion.** Completing a task moves its card to the board's last column; reopening moves it back to the first. Assignees can use the Column select in the modal (they can already drag).
12. **History shows what changed** — assignee, priority, due date, title diffs, not just "updated".
13. **Same rules everywhere.** Web and mobile ability helpers honour `IsAdmin` the way the server does; mobile personal tasks default to the owner; mobile shows the newest 100 comments.
14. **Columns follow membership, not branch.** Column fetch/manage use workspace membership (a cross-branch member sees an empty board today); a pending invitee can't manage columns; the last column can't be deleted.
15. **`sp_SaveTask` checks** parent task, team and project belong to the company/workspace. **`getTimeEntries`** with a `UserId` and no `TaskId` is scoped.

### People
16. **Deactivating a user** unassigns their open tasks (5), and the Users screen shows what they still own — leads, complaints, owned workspaces, direct reports — so it can be handed over.
17. **`sp_DeleteUser` refuses** when the user has history (tasks, comments, time, leads, complaints, reports). Deactivate instead. A save without a valid group is a 400 (today it maps to a group id that doesn't exist).
18. **Branch is editable** on the user form (admin), and a new user can be created in any branch.
19. **The `Is Admin` checkbox goes** from the Users form and list — admin comes from the role since `093`. A user in two groups resolves admin the same way at login and per request.
20. **Who gets told about a person** = their first *active* manager up the `ReportsTo` chain, else the company admins (`sp_FetchEscalationTargets` already walks past inactive managers). The Users list flags "no manager set" (7 of 20 today).

---

## 5. P2 — Calendar, day marks, sessions, presence

### Calendar
- **Works with zero setup.** Every company is seeded with one shift, **"Standard": Mon–Sat, 09:00–18:00, lunch 13:00–14:00** (8 working hours a day), as its default. Everyone follows it — existing users and every new one — until an admin changes it. Nothing in user creation becomes required.
- **Shifts** per company: named, per weekday working or not, start, end, optional break. One is the company default (editable, never deleted). A shift may cross midnight (21:00–06:00): it **belongs to the date it starts**.
- **A user who works differently** (full week, half Saturday, night) gets one optional dropdown on the user form — *Shift: Company standard ▾*. Exceptions for a single day are day marks, not profile edits.
- **Holidays** per company, optionally per branch (the user's branch).
- **`tblUser.WorkCalendarId`** (null = company default) and **`PresenceExempt`** (owner: no presence marks; task clocks still run).
- **Company settings:** late grace (10 min), session buffer (2 h), warn at (80%), notify manager when not signed in (on), **go-live date** (nothing is recorded before it).
- The calendar editor **warns, not blocks**, on > 9 h/day, > 48 h/week, no break after 5 h, women's night shift (OSH Code / Shops & Establishments).

### Day marks (D6)
- `tblUserDayMark(CompId, UserId, WorkDate, Part [full | first_half | second_half], Kind [leave | on_duty], Remarks, MarkedBy, MarkedAt)`.
- Marked by the person's `ReportsTo` chain or an admin, past dates included. Visible to the person.
- *Leave* = non-working time for that person: no Late / Not-signed-in, no manager alert, task clocks don't count it.
- *On duty* = counts as present (field visit, internet down) — the correction for a wrong mark.
- A mark or holiday added after the fact **recomputes** that day's presence and excuses breaches that fell inside it (P3).

### Sessions (D7)
- `tblUserSession` — one row per sign-in: GUID, user, company, device (web/mobile), IP, user agent, started, expires, last seen, ended + reason (`logout` / `expired` / `forced`).
- The JWT carries the session id; **`verifyToken` checks the session is open** (60-second cache per container). Logout ends it server-side (today it does nothing).
- **Expiry** = the shift's end + buffer, extended while in active use, never into the next shift. Outside any shift: until the next one starts. So everyone signs in once per shift.
- **Admin can end anyone's session.** Socket gets `session-ended` at once.
- **No lost work.** A 401 says why (`SESSION_EXPIRED` / `SESSION_FORCED`); web shows a sign-in-again box over the page and retries — no hard redirect while a form has changes. Mobile shows the reason on the sign-in screen.
- **Rollout:** tokens without a session id are refused, so everyone signs in once after deploy. Deploy before shift start.

### Presence
- `tblPresenceDay` — one row per person per shift, written at first sign-in, **shift frozen at that moment**: shift start/end, first sign-in, late minutes, signed out, `ManagerId`/`BranchId` at the time.
- **Heartbeat** every 2 min while the app is open → updates the session's last-seen. **No row per heartbeat.**
- **Status:** Online · Offline · Signed out · Not signed in yet · Late by *n* min · On leave · On duty · Holiday.
- **Not signed in** by shift start + grace → one notification to the person's manager (P1 item 20).
- **Notice:** first sign-in after go-live shows what is recorded, who sees it, how long it's kept, and what is *not* collected. Sessions kept 13 months (CERT-In needs 180 days of IP logs, in India).

### Background job
- First one in the backend: a 60-second timer per container. P2 uses it for session expiry and not-signed-in; P3 adds the TAT sweep. Every action is guarded (`IS NULL` stamps), so a restart or overlap cannot double-fire.

---

## 6. P3 — Task TAT

### Target
- **Due date set** → the resolution target is the end of the assignee's shift on that date (a due *time* is added to the task form).
- **No due date** → company default per priority, in working minutes: critical 2 h · high 4 h · medium 8 working hours (one standard day) · low 24 working hours (three standard days). Editable per company.
- Per-task override; `0` = no clock. Set by the workspace owner/manager or the creator — never by the assignee alone.
- **No clock** in personal workspaces (D10).

### Clock
- `tblTaskTat` — one row per (task, assignee, assignment): assigned at, target, due at, acknowledged at, completed at, warned at, breached at, held minutes, closed at + reason (`completed` / `my_part_done` / `unassigned` / `deleted` / `user_left`), task title snapshot, `ManagerId`/`BranchId` at assignment.
- **Opened and closed inside `sp_SaveTask`'s transaction** (it returns removed assignees as well as added ones). Due time from `workCalendar.js`; the sweep fills any still missing. One open clock per (task, user). Re-adding the same person within 7 days **resumes** their old clock — reassigning cannot reset it.
- **Acknowledged** = the assignee's first act on the task: Start, tick, move, time log or comment.
- **My part is done** closes that assignee's clock only (D5).
- **Changed after assignment** (priority, target, due date): open, unbreached clocks are recomputed from assignment; never breached retroactively (if the new due time has already passed, due = now + 30 working minutes). Logged old → new.
- **Reopened:** due = reopen time + the time that was left at completion (at least 60 working minutes).

### Holds (D3)
- **Blocked** by an unfinished dependency = automatic hold, released when the blocker completes.
- **On hold** with a reason (lookup) + remarks: by the creator or a workspace owner/manager, or by the **assignee on their own clock** — which notifies their manager and auto-releases after 3 working days.
- On release, due times move forward by the working minutes held.
- Leave, on-duty-away and holidays are already non-working time (P2), so they need no hold.

### Breach
- Warned at 80% (assignee only). Breached at 100% (assignee + manager). Notifications grouped: one per person per minute.
- **Reason:** finishing a breached task opens the reason box (waiting on someone · scope grew · technical issue · other + remarks). Not blocking: skipped → *Reason pending* on their Today until given; counts as unexcused.
- **Verdict:** *excused* (needs remarks) or *not excused*, by a `ReportsTo` ancestor or a workspace owner/manager — **never on your own clock**.
- A breach inside a later-marked leave day or holiday is excused by the system.

### Where it shows
- **Card chip:** time left (green) → amber at 80% → red *Over by 25m* → grey *On hold: waiting on client*. Text + icon, never colour alone.
- **Task TAT tab:** per assignee — Assigned → Seen → Acknowledged → held … → Done, working time for each step, breach, reason, verdict, and every target change.
- **Today (web):** *mine* — sign-in time, open tasks by soonest due, reason pending; *my team* (if I have reports) — each person's status, open / at risk / over. Employees see exactly what their manager sees about them.
- Times always in IST with an "IST" suffix.

### Sweep
- Each minute: warn, breach, auto-release holds, fill missing due times. Uses SQL `GETDATE()`, stamps `NotifiedAt` before notifying. Skips held, archived, deleted, personal.

---

## 7. P4 — Reports, mobile, complaints

- **Reports** (existing report frame, filters in the URL, drill-down): **TAT** — on-time % *with the clock count*, per priority, median and p90 working time, breached vs breached-and-not-excused, excused % by verdict giver; **Attendance** — working days net of leave and holidays, late count and median minutes, not signed in. Scope = D9. Employees see their own rows.
- **Mobile:** sign-in as check-in, heartbeat on app foreground, session-ended reason, chips, TAT tab, acknowledge / my part done / hold / reason, notifications screen (P1). No manager Today (admin work is web-only).
- **Complaints:** `DueAt` computed by `workCalendar.js` against the assignee's shift (company default when unassigned); `TatHours` now means working hours. CLAUDE.md §6 updated in the same change.

## 8. Out of scope

Leave requests/approvals/balances · screenshots, keystrokes, camera, location, geofencing · payroll attendance · push notifications · recurring tasks · changes to the Log-time panel.

## 9. Risks

| Risk | Handling |
|---|---|
| Calendar maths wrong ⇒ everyone mis-flagged | D12: one pure module; table tests for breaks, holidays, half days, night shift, weekend, run under `TZ=UTC` and `TZ=Asia/Dubai`. |
| Daily sign-in drops someone's unsaved work | Sign-in-again box over the page; expiry extends while in use. |
| A script applied with sqlcmd defaults breaks procedures | `SET QUOTED_IDENTIFIER ON` in every script; `-I` in every apply command; check `uses_quoted_identifier` after apply. |
| Sweep fires twice | `IS NULL`-guarded stamps; notifications only from stamped rows. |
| Alerts reach nobody (no manager set) | Fallback to admins; Users list flags it. |
| Staff read it as surveillance | Notice at sign-in, neutral words, no idle counter, employees see what managers see. |
