# Tasks, people, TAT — consolidated audit findings

**Date:** 2026-10-07 · **Branch:** `feat/task-tat`
**Sources:** four independent audits in this folder —
`01-tasks.md` (task system, live SPs + data) · `02-people.md` (users, teams,
projects, hierarchy) · `03-scenarios.md` (18-person WFH company simulated
against the draft spec: 60 scenarios) · `04-industry.md` (Zendesk/ServiceNow/
Zoho People/Keka practice, DPDP 2023 + Rules 2025, CERT-In, OSH Code).

Live data (eCRM+): 20 users, 39 tasks, 3 branches, 1 company. SolarCRM not checked.

---

## 0. Decisions (user, 2026-10-07)

| # | Decision |
|---|---|
| Q1 | **Security holes (§2) fixed now on their own branch off `main`**, shipped ahead of TAT. |
| Q2 | **Response clock is shown, not judged.** "Acknowledged at …" is recorded on every task; only the **resolution** clock can breach, needs a reason, and counts in reports. |
| Q3 | **Every task needs at least one checklist step.** The 2 live tasks without one get fixed in the script. (Resolves F5/T4.) |
| Q4 | **CRM, not HR.** The **manager marks a day** for an employee: *On leave* (full / half) or *On duty* (field visit, outage). No employee requests, no approvals, no leave types or balances. A marked day is non-working for that person (no Late / Not-signed-in, no manager alert, task clocks paused). This **replaces** T1's leave table design and T14's correction requests with one manager action. |

Consequences for §4: T1 → one table `tblUserDayMark(CompId, UserId, WorkDate, Part [full/first_half/second_half], Kind [leave/on_duty], Remarks, MarkedBy, MarkedAt)`; T14 removed; `03-scenarios` §7 items 1 and 7 collapse into it. Other HR-style extras from the research (lates-per-month allowance, alternate-Saturday rules, `tblUserCalendar` history) are **dropped** unless they come up again — the presence day freezes the shift at sign-in, which is enough history.

---

## 1. Verdict

The task system's **shape** is sound (workspaces, roles, checklist-driven
completion, multi-assignee, per-action permission SP). What is wrong sits in
three layers:

1. **Live security holes** — any user can change or complete other people's
   tasks, write to other companies' boards, read other companies' task titles,
   and add themselves to any project workspace. These exist **today**, on
   `main`, independent of TAT.
2. **Lifecycle gaps** — people removed from a workspace or deactivated stay
   assigned; tasks practically cannot be deleted; notifications do not open the
   task; "Seen" is never recorded. Harmless now; **every one becomes an unfair
   breach the moment clocks run.**
3. **The draft TAT spec** has four blockers (no leave, night shifts impossible,
   personal-workspace privacy leak, tasks with no checklist can never complete)
   and ~25 undefined cases.

TAT on top of today's tasks would measure the bugs, not the people. The
foundation goes first.

---

## 2. Live security holes (verified)

| # | Hole | Where | Size |
|---|---|---|---|
| S1 | **Checklist IDOR.** Tick/rename/delete a step of *any* task in *any* company by sending its item id with your own TaskId. Completes other people's tasks. **Verified in live SP text.** | `sp_SaveTaskChecklist`, `sp_DeleteTaskChecklist` act on `@Id` only | S |
| S2 | **Any user can rewrite any team**, and through the cascade **add themselves to every linked project workspace**. `saveProject`/`deleteProject` equally open. | `teamRoutes.js`, `projectRoutes.js` — no admin gate | S |
| S3 | **Kanban template on any workspace, any company.** | `applyKanbanTemplate` → `sp_ApplyKanbanTemplate` — no tenant/role check | S |
| S4 | **Read other companies' / colleagues' private task titles** via a dependency on any task id. | `sp_AddTaskDependency` checks only the dependent task | S |
| S5 | `sp_SaveTask` trusts the client's `WorkspaceId` on edit → assign non-members, park cards in foreign columns. | `sp_SaveTask` | S |
| S6 | **Two admin flags.** JWT `IsAdmin` comes from a `tblUser` column the Users form sets directly; it drives deletes, fetches and socket rooms. One live user already disagrees with their group. | `authController.js:92`, ~6 controllers, `socket.js` | M |
| S7 | A **deactivated group** still grants its scope and admin rights. | `sp_FetchAccessibleBranchIds` ignores `ug.IsActive` | S |
| S8 | Read receipts on any comment id; deactivated user keeps socket ≤24 h; loadScope fallback lacks `isActive`. | small | S |

---

## 3. Task and people foundation (needed before clocks are fair)

| # | Problem | Fix | Size |
|---|---|---|---|
| F1 | **Delete is broken**: 37/39 tasks have steps, delete refuses while steps exist; web has no single delete. Deletes are hard, so TAT history would vanish. | Soft delete (`IsDeleted/At/By`), single delete in the modal, filtered everywhere. | M |
| F2 | **Removed / deactivated people stay assigned** (member removal, leave, team sync, deactivation, archive). | Unassign on those paths, tell the owner, close clocks. | M |
| F3 | **Deactivation does nothing else**: tasks, leads, tickets, owned workspaces, direct reports all left as-is. | Deactivation ends sessions, closes clocks, and shows a handover list. | M |
| F4 | `sp_DeleteUser` hard-deletes comments and time entries; skips leads/tickets/reports; default group 8 doesn't exist. | Refuse delete when history exists; deactivate instead; 400 on no group. | S |
| F5 | **Task with no checklist can never complete** (2 live). | Allow completion without a checklist (explicit "Mark done"), or require a step — decision Q6. | S |
| F6 | **Notifications don't open the task** on web; **mobile has no notifications at all**. | Deep link `?taskId=` → switch workspace + open modal; mobile notifications screen. | S–M |
| F7 | **No "my tasks across all boards" on web**; no server-side assignee filter. | `sp_FetchTask` filters (`@AssigneeUserId`, `@OnlyOpen`, `@Overdue`, no archived) + web My Work (inside Today). | M |
| F8 | "Seen" never recorded (`FirstSeenAt` 0/64). | Stamp on single-task fetch, assignees only. | S |
| F9 | Nobody is told when a task is **completed, reopened or unblocked**. | Notify creator + assigner. | S |
| F10 | Dependency "hard blocks" are not enforced anywhere. | Blocked = automatic hold on clocks (TAT); enforcement optional. | S |
| F11 | Board column ≠ completion (9 tasks disagree); assignee can drag but not use the Column select. | Auto-move to the last column on completion (decision Q7); align the select. | S |
| F12 | Unassigned tasks can't be claimed (`claim_task` permission exists, no endpoint). | "Take this task". | S |
| F13 | Admin abilities differ web/mobile; mobile personal tasks created unassigned; mobile shows only the oldest 25 comments. | Align helpers; defaults; paging. | S |
| F14 | Task history logs "updated" only — no field/assignee diffs. Breach disputes need them. | Log diffs. | S |
| F15 | Branch can't be changed; new users land in the creating admin's branch. Branch holidays depend on it. | Branch field on the user form. | S |
| F16 | **7/20 users have no manager** (incl. 2 Self-scope users) → alerts reach nobody. | Notify first *active* ancestor, else admins; show "no manager set" warning. | S |
| F17 | Kanban columns filtered by branch → cross-branch member sees an empty board; pending invitees can manage columns; last column deletable. | Membership gate. | S |

---

## 4. Changes to the TAT / presence spec

### Blockers
| # | Problem | Rule |
|---|---|---|
| T1 | **No leave.** Leave day = "Not signed in", manager pinged, clocks breach. | `tblUserLeave` (full / first half / second half, type, remarks, entered by self or manager). Leave = non-working time on that person's calendar: no marks, no pings, clocks pause. |
| T2 | **Night shift impossible** (sessions capped at 23:59, presence keyed by date). | A shift belongs to the date it **starts**; sign-in attributed to the shift window containing it; sessions expire at that shift's end + buffer. Delete "never past 23:59". |
| T3 | **Personal workspaces leak** into manager counts, reports, alerts (they're private even from admins). | **No TAT in personal workspaces.** |
| T4 | Task with no checklist never completes → certain breach. | F5. |

### High
| # | Rule |
|---|---|
| T5 | **DueDate becomes the resolution target** when set (end of the assignee's shift that day; optional due *time*). Priority default only when no due date. One deadline, not two. |
| T6 | Priority/target/due-date change mid-flight: recompute open, un-breached clocks from `AssignedAt` (+ held time); never breach retroactively; log old→new. |
| T7 | **"My part is done"** per assignee — closes only their clock. Task completion closes the rest. (Without it, D5 is false.) |
| T8 | Clock rows opened/closed **inside `sp_SaveTask`'s transaction** (it must also report removed assignees); sweep back-fills due times. One open clock per (task, user). Re-adding within 7 days resumes the old clock (stops reassign-to-reset). |
| T9 | **Blocked = automatic hold.** Assignees may hold **their own** clock (reason + remarks, manager notified, auto-release after 3 working days). |
| T10 | **Reopen**: due = reopen time + remaining time at completion (min 60 working min). Not an instant breach. |
| T11 | **No self-verdicts.** Verdict by a `ReportsTo` ancestor or a workspace owner/manager who is not the assignee; excused needs remarks; report shows excused % by verdict-giver. |
| T12 | **Session expiry must not lose work.** 401s carry a reason; web shows a sign-in-again modal over the page (no hard redirect while a form is dirty); expiry extends while actively used. |
| T13 | **Presence shown as Online / Offline / Signed out / Not signed in yet / On leave / Holiday / Late by n min.** No "Idle n min" counter — CRM-only activity calls a WFH person on the phone "idle" and a mouse-jiggler beats it. |
| T14 | **Corrections**: employee can request "I was working / on field duty / internet down"; manager approves; append-only, visible to the employee. Reports read the corrected value. (Every HR tool has this; DPDP accuracy duty.) |
| T15 | **Retroactive holiday or leave** recomputes presence and system-excuses breaches inside it. |
| T16 | "My team" = **`ReportsTo` subtree**, never raw DataScope (a Company-scope Sales Head must not see HR's attendance). Company-wide view only for admins or a new "Attendance" menu grant. Store `ManagerId`/`BranchId`/`NotifiedUserId` on presence and TAT rows (manager changes mid-month). |
| T17 | Viewers cannot be assignees. Deleting an open step on an assigned task needs owner/manager or a creator who isn't the assignee (stops "complete by deleting"). |

### Medium (folded in, details in `03-scenarios.md` §7)
Go-live date setting · `tblUserCalendar(UserId, CalendarId, FromDate)` so a shift change keeps history · alternate Saturdays · targets: NULL = default, 0 = none; seed "8 working hours" not "1 day" · grouped notifications (one per person per tick; managers get breaches only) · all times shown in IST with suffix (Dubai user) · reports: on-time % with counts, medians/p90, net of leave · employees see their own rows · sweep notifies via `NotifiedAt IS NULL` · CLAUDE.md §6 updated in the same change (business hours reinstated).

---

## 5. Legal and fairness must-dos (India)

- **DPDP Act 2023 §7(i)**: employment use needs no consent, but **accuracy, security, retention, grievance and access** duties apply. Rules 2025 obligations bite from 13 May 2027; build them now.
- **One-time notice** at first sign-in after go-live: what is recorded, who sees it, retention. Sign-in screen states what is *not* collected (no screenshots, keystrokes, camera, location).
- **CERT-In 2022**: session IP/user-agent logs kept **180 days, in India** — confirm the server is in India.
- **Retention**: sessions 13 months; presence days and TAT rows kept as the employment record; **no raw heartbeat log** (latest state per session only).
- **OSH Code / Shops & Establishments**: calendar editor *warns* (not blocks) on > 9 h/day, > 48 h/week, missing break after 5 h, women on night shift without consent.
- **Employee sees exactly what the manager sees about them.**

---

## 6. Recommended phasing

Too much for one change. Five independently shippable pieces:

| Phase | Content | Ships to |
|---|---|---|
| **P0 Security** | S1–S8 | its own branch → `main` **now** (live holes) |
| **P1 Task & people foundation** | F1–F17 | `feat/task-tat` |
| **P2 Calendar, leave, sessions, presence** | T1, T2, T12–T16, legal | `feat/task-tat` |
| **P3 Task TAT** | T3–T11, T17, sweep, chips, TAT tab, Today | `feat/task-tat` |
| **P4 Reports, mobile parity, complaints on calendar** | F8 reports, F9 mobile, F10 complaints | `feat/task-tat` |

Each phase: SQL script first (user-applied), backend, web, mobile; tests and
≥80% coverage per phase.

---

## 7. Carried into P1 from the P0 security review (`05-security-review.md`)

P0 (`fix/security-holes`, script `093`) closed S1–S8 plus the read side of S1
(`sp_FetchTaskChecklist`). Deferred, not exploitable across companies:

- An assigned **viewer** can rename/reorder checklist steps (update needs only `change_status`). Split tick vs edit.
- `tblUser.IsAdmin` grants nothing since `093` but is still on the Users form and list — remove it.
- Two-group users: token `IsAdmin` = any active group; `req.scope` = top group by level (Admin and Heads tie at 2). No live case; make both "any".
- `sp_SaveTask` accepts a parent task / team / project without a company or workspace check.
- `getTimeEntries` with a `UserId` and no `TaskId` — confirm `sp_FetchTimeEntry` scopes it.
- SQL fixes have no automated test (mocked DB); covered by `093`'s verify snippets only.
