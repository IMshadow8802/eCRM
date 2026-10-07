# 04 — Industry + legal check of the Task TAT / presence spec

Spec reviewed: `docs/superpowers/specs/2026-10-07-task-tat-presence-design.md` (2026-10-07).
Method: WebSearch + WebFetch on 2026-10-07. Claims marked **[K]** come from model knowledge
(cutoff mid-2026) and were not verified against a live source in this pass. Claims with
links come from search results or fetched pages; several are third-party summaries of the
vendor docs, so treat exact numbers as "check before quoting to a customer".

---

## 1. Service-desk SLA engines

### Zendesk
- **Business vs calendar hours per target, per priority.** Business hours count only time
  inside the schedule; the clock pauses outside it. [eesel: SLA calendar](https://www.eesel.ai/blog/zendesk-sla-calendar-business-hours), [Zendesk: metrics](https://support.zendesk.com/hc/en-us/articles/4408829459866)
- **Schedules** carry their own timezone and holiday list; a ticket gets one schedule
  (default, or set by trigger, e.g. by group). Schedules are per *group/ticket*, not per
  agent. **[K]** for the "not per agent" detail. [getmacha: business-hours schedules](https://www.getmacha.com/blog/zendesk-business-hours-schedules)
- **Pause:** "Pending"/"On-hold" pause *some* metrics (agent work time, pausable update);
  first reply / next reply / total resolution do **not** pause in Pending.
  [Zendesk: troubleshooting SLAs](https://support.zendesk.com/hc/en-us/articles/4408885881498-Troubleshooting-common-SLA-issues)
- **Reopen:** total resolution time "reactivates and continues to count from the ticket
  creation time"; time spent Solved counts as a pause. Reply metrics open new targets on a
  new end-user comment. [Zendesk: metrics](https://support.zendesk.com/hc/en-us/articles/4408829459866)
- **Target changes** (priority/policy change) recompute the target live; after a breach the
  badge reads "Now". [Zendesk: troubleshooting](https://support.zendesk.com/hc/en-us/articles/4408885881498-Troubleshooting-common-SLA-issues)
- **Reassignment:** the *ticket* SLA ignores agent reassignment (customer-facing). Separate
  **Group SLAs (OLAs)** measure one metric, *ownership time*, from assignment to a group
  until reassigned or solved; reassigning pauses the old group's clock and starts the new
  group's; it resumes if the ticket comes back. [eesel: group SLA](https://www.eesel.ai/blog/zendesk-group-sla-policies-for-teams), [Zendesk API: group_sla_policies](https://developer.zendesk.com/api-reference/ticketing/business-rules/group_sla_policies/)
- **Reporting:** each target is Achieved / Breached / Active / Paused; "% achieved" =
  achieved / (achieved + breached). Cancelled targets (policy no longer applies) are
  excluded. **[K]**

### Freshdesk / Freshservice
- Targets per priority (Urgent/High/Medium/Low): first response, every (next) response,
  resolution; business or calendar hours per policy. [getmacha: Freshdesk SLA](https://www.getmacha.com/blog/how-to-set-up-sla-policies-in-freshdesk)
- **Pause** via statuses flagged "SLA timer off" (e.g. Pending, Waiting on customer /
  third party) — admin-defined, not free. **[K]** for the "status flag" mechanism; pause on
  pending is in [getmacha](https://www.getmacha.com/blog/freshdesk-sla-policies-explained).
- **Reminders** before breach: 5 min – 4 h before due. **Escalations** after breach:
  configurable delay (immediately … 1 month), and **up to 4 escalation levels** for
  resolution (L1→L4, each to a different person, typically reporting manager → head).
  [getmacha](https://www.getmacha.com/blog/how-to-set-up-sla-policies-in-freshdesk); 4 levels **[K]**
- Business hours are multiple named calendars, each with timezone + holiday list,
  assigned **per group**; an agent inherits the group's hours. **[K]**
- Freshservice adds **OLAs** (internal team targets) alongside SLAs. [Freshservice escalations](https://support.freshservice.com/support/solutions/articles/156464-managing-ticket-escalations-in-freshservice)

### ServiceNow
- An SLA definition has **start / pause / stop / cancel (and reset)** conditions, each a
  query on the task; "pause when conditions are met" vs "resume when …" both exist.
  [ServiceNow: create SLA definition](https://www.servicenow.com/docs/r/UMl~97STJe3fa_KTmzD1Gg/C3FGocriIJZdpYapo3gunw)
- **Retroactive start:** the SLA can start from a date field on the task (e.g. `opened_at`)
  instead of when the condition first matched; **retroactive pause** subtracts time the
  task was already in a paused state. (Same link.)
- **Schedule + timezone source:** system TZ, caller's TZ, task location's TZ, or CI's TZ —
  chosen per definition. (Same link.)
- **Reset condition** (e.g. assignment group changes) cancels the running SLA and attaches
  a fresh one — this is how OLAs per assignment group are built. **[K]** (reset exists in
  the definition form; the OLA usage is common practice).
- **Notifications:** the default SLA flow notifies the assignee at **50%**, assignee +
  manager at **75%**, both at **100% (breach)**. [ServiceNow: SLA notifications](https://www.servicenow.com/docs/r/UMl~97STJe3fa_KTmzD1Gg/TrKIMWVK9akWWhAHMPnQRA)
- **Task SLA record** (`task_sla`) stores stage (In progress / Paused / Cancelled /
  Completed), `has_breached` (sticky), business elapsed, business % , pause duration.
  [ServiceNow: Task SLA table](https://www.servicenow.com/docs/r/MlbQAgTiiiMOLOw9T36wJg/IzrPpIJiB2a2oFdgpBOUEg)
  → this is almost exactly our `tblTaskTat`. Breach is permanent there too.

### Jira Service Management
- SLA = **start / pause / stop** conditions + goals (JQL → target → calendar). Multiple
  pause conditions; **multiple cycles**: if a start condition recurs after stop, a new cycle
  starts (that's how "SLA on reopen" works — a new cycle, old one keeps its met/breached).
  [Atlassian: setting up SLAs](https://confluence.atlassian.com/servicemanagementserver0420/setting-up-slas-1095771691.html)
- **Calendars** carry working hours incl. lunch breaks, holidays, weekends, timezone; one
  calendar per goal. (Same link.)
- Display: remaining time, red negative when breached, clock icon paused; reports show
  "met vs breached" and "% met". [Atlassian: how teams see SLAs](https://confluence.atlassian.com/display/SERVICEMANAGEMENTSERVER0419/How+teams+see+SLAs)

### Zoho Desk
- SLA = first response + resolution, per department; criteria by priority/channel/etc.
- **Business hours and holiday lists are org-level**, then chosen per SLA (not per
  department object). [Zoho community: business hours](https://help.zoho.com/portal/community/topic/business-hours), [Zoho SLA help](https://www.zoho.com/support/help/sla.html)
- Escalation: notify/reassign/webhook on approach and on violation; multiple escalation
  levels after violation. [aaxonix: Zoho Desk SLA](https://aaxonix.com/resources/zoho-desk-sla-configuration/); levels **[K]**
- "On Hold" status pauses the SLA ("Pause SLA on hold" in status settings). **[K]**

### Salesforce (Entitlements & Milestones)
- **Business hours**: milestone → entitlement process → record, in that fallback order.
  [NTT Data: entitlements](https://us.nttdata.com/en/insights/technical-articles/2022/april/using-salesforce-entitlements-and-milestones)
- **Milestone actions:** *Success*, *Warning* (time-triggered before violation), *Violation*
  (time-triggered after). Multiple warning/violation actions at different offsets = escalation levels.
  [Trailhead: set up milestones](https://trailhead.salesforce.com/content/learn/modules/entitlement-management-for-lightning-experience/set-up-milestones)
- **Stopped** flag on the case pauses all milestones; "stopped time" and "actual elapsed
  time" are tracked when enabled. **Recurrence:** No recurrence / Independent / Sequential
  (milestone re-fires when criteria match again — the reopen case). [SalesforceBen: recurring milestones](https://www.salesforceben.com/using-recurring-milestones-in-salesforce/)
- `CaseMilestone.IsViolated` is sticky; `IsCompleted` with violation = "completed late". **[K]**

### Cross-vendor summary

| Concern | Industry norm | Our spec |
|---|---|---|
| Calendar | Named schedules with TZ + holidays + breaks | Same (IST only) |
| Calendar attaches to | Group / SLA policy / record — **rarely per agent** | Per user (D5, F1) |
| Pause | Admin-defined statuses, reason implied by status | On hold + reason (D3) — stricter, good |
| Warning | Before-breach reminder (Freshdesk 5m–4h, SN 50/75%) | One warn at 80% |
| Escalation | 2–4 levels after breach, at offsets, up the chain | One: breach → `ReportsTo` |
| Breach | Sticky | Sticky (D4) |
| Reassignment | Ticket SLA continues; OLA per group restarts | Per-assignee clock closes, new opens (D6) |
| Reopen | Continues (Zendesk) or new cycle (Jira/SF recurrence) | Reopens clocks, keeps breach |
| Target change mid-flight | Recomputed live (Zendesk) | Not specified |
| Report | Achieved / breached / % achieved; cancelled excluded | "on-time %" — denominator unspecified |

---

## 2. Presence and attendance tools

| Tool | Active → away/idle | Mobile | Notes |
|---|---|---|---|
| Microsoft Teams | **Away after ~5 min** no input on desktop | Away the moment the app is backgrounded; Offline after 24 h | [UC Today](https://www.uctoday.com/unified-communications/how-to-keep-your-teams-presence-as-active/), [Android Authority](https://androidauthority.com/microsoft-teams-keep-status-active-3147225) |
| Slack | **Away after 10 min** no input on desktop | Active while app is open, away when backgrounded | [Slack API: presence](https://docs.slack.dev/apis/web-api/user-presence-and-status) |
| Hubstaff | Idle timeout default **5 min** (5/10/20/custom/never); user is **asked** keep/discard/reassign idle time | — | [Hubstaff support](https://support.hubstaff.com/how-does-the-inactivity-warning-work/), [idle settings](https://hubstaff.com/time-tracking/customize-idle-time-settings) |
| Time Doctor | "Timeout after" default **15 min** (3 min–6 h), 60 s countdown, user can claim "Yes, I was working" → logged as manual time "Away from computer" | — | [Time Doctor: timeout](https://support.timedoctor.com/knowledge/how-to-configure-and-use-timeout-after-settings) |
| Zoho People | Check-in/out; **grace per shift** for first-in, last-out and hours, with **N deviations allowed per week/month/pay period**; **regularization** request (date, time range, reason, description) → approval; IP/geo restrictions on check-in | Mobile check-in | [Zoho People: grace](https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/specific-policies), [user/shift settings](https://prezohoweb.zoho.com/people/help/adminguide/user-shiftsettings.html) |
| Keka | Grace for late arrival; penalisation policy; **regularization** (employee and on-behalf-of by admin), can exempt the day from penalisation; **partial-day** requests (late arrival / early exit / short absence, with monthly allowance); remote clock-in allowed or blocked | Mobile + web clock-in | [Keka: regularize](https://help.keka.com/hc/en-us/articles/39946614770321-How-can-an-employee-Regularize-his-attendance), [on behalf](https://help.keka.com/admin/admin-help/how-to-regularize-attendance-on-behalf-of-employees) |
| greytHR | Cross-midnight shifts, auto shift, split shifts; elapsed timer from earliest IN across mobile/web/kiosk/biometric | — | [greytHR elapsed timer](https://www.greythr.com/help-ess-mobile/attendance-updates/track-work-time-duration) |
| Darwinbox | Shift roster, regularization, leave-linked attendance, geo-fenced check-in **[K]** | | not verified |

Common patterns (**[K]** unless linked above):
- **Attendance day is keyed to the shift's start date**, not the calendar date, so a
  21:00–06:00 shift is one attendance day (greytHR/Keka "cross midnight").
- **Auto check-out** at shift end + N h, or "missed check-out" flagged for regularization —
  they do **not** log the user out of the app.
- **Leave integration:** an approved leave / half-day / WFH / on-duty request suppresses the
  late/absent mark for that day (or half). Holidays and weekly offs never produce absent.
- **Late marks are softened by allowances** ("3 late marks/month free", "3 lates = ½ day")
  rather than every minute counting.
- **Anti-gaming:** Hubstaff sells "unusual activity" detection for jigglers
  ([Hubstaff idle](https://hubstaff.com/idle-time-tracking-software)). Input-based "active"
  is trivially faked by a USB jiggler; nobody solves this with presence alone. The honest
  defence is outcome metrics (TAT) next to presence.

---

## 3. Indian legal / privacy constraints

### DPDP Act 2023 + DPDP Rules 2025
- **Rules notified 13 Nov 2025.** Phased: Rules 1–2, 17–21 in force 13 Nov 2025; Rule 4
  (consent managers) 13 Nov 2026; **Rules 3, 5–16, 22–23 (notice, security, breach,
  retention, rights) from 13 May 2027**. Until then, IT Act 2000 + SPDI Rules 2011 apply.
  [SCC Online](https://www.scconline.com/blog/post/2025/11/14/meity-notified-digital-personal-data-protection-rules-2025/), [Mondaq](https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified), [KS&K](https://ksandk.com/md/data-protection-and-data-privacy/can-employers-monitor-employees-dpdp-act/)
- **Section 7(i) legitimate use:** employers may process employee data "for the purposes of
  employment or those related to safeguarding the employer from loss or liability" **without
  consent**. Commentators stress it is not a blanket licence for unrestricted surveillance;
  purpose limitation still applies. [KS&K](https://ksandk.com/md/data-protection-and-data-privacy/can-employers-monitor-employees-dpdp-act/), [Mondaq: consent for employees](https://webiis10.mondaq.com/india/data-protection/1755320/is-consent-required-to-process-employees-personal-data-under-the-dpdp-act)
- The **Section 5 notice** is tied to consent requests, so 7(i) processing is arguably not
  strictly notice-bound — but every commentator recommends a written monitoring policy, and
  the client company is the Data Fiduciary (we are its Processor). **[K]** on the strict
  reading.
- Obligations that **do** apply under legitimate use **[K]** (Act §8):
  - §8(3) **accuracy/completeness** when data is used to make a decision affecting the
    person (late marks, breach counts used in appraisals) → a correction / regularization
    path is how you meet this.
  - §8(5) reasonable security safeguards; Rule 6: access control, encryption/masking,
    monitoring, **keep logs one year**. [SCC Online](https://www.scconline.com/blog/post/2025/11/14/meity-notified-digital-personal-data-protection-rules-2025/)
  - §8(7) + Rule 8: **erase when the purpose is served**, but Rule 8 / Seventh Schedule
    sets a **minimum one-year retention** of personal data and associated logs; 48 h notice
    before erasure applies to the Third Schedule classes (e-commerce/gaming/social media),
    not to us. [techjockey](https://www.techjockey.com/blog/?p=61431), [lawrbit](https://www.lawrbit.com/article/digital-personal-data-protection-rules-2025)
  - §8(6) + Rule 7: breach notice to affected people and the Board (detailed report within 72 h).
  - §8(10) grievance redressal; §11–13 right to access a summary, correction, erasure.
- Data minimisation is a purpose test, not a numeric rule: collect what the stated purpose
  needs. Our D8 (heartbeat only, no screenshots/keys/camera) is squarely on the safe side.

### CERT-In directions (28 Apr 2022, in force 27 Jun 2022)
- "All service providers, intermediaries, data centres, **body corporate** and Government
  organisations shall … enable logs of all their ICT systems and maintain them securely for
  a rolling period of **180 days** … **within the Indian jurisdiction**."
  [taxguru](https://taxguru.in/corporate-law/cert-in-issues-directions-relating-information-security-practices.html), [PSA Legal](https://psalegal.com/new-cert-in-directions-overview-and-implications/)
- Practical reading: session logs with IP + user agent are exactly these logs. Keeping them
  is not optional, and their location matters (server must be in India — confirm where
  `myserver` / shadowcodes.in sits).
- IP address on its own is personal data under DPDP if it can identify a person (with the
  user id beside it, it does). No India-specific rule forbids logging it for security.

### Working-hours law (affects shift definitions)
- **OSH Code 2020 (in force 21 Nov 2025):** 8 h/day, 48 h/week, **spread-over ≤ 12 h**;
  women may work 19:00/20:30–06:00 only **with written consent** and safety provisions.
  [KS&K: OSH Code](https://ksandk.com/employment-law/guides/osh-code/), [Khaitan Nov 2025 bulletin](https://www.khaitanco.com/sites/default/files/2025-12/ELB%20Bulletin-November%202025.pdf)
- **State Shops & Establishments Acts still govern shops/offices** and vary. Example,
  Maharashtra 2017: **9 h/day, 48 h/week, rest ≥ 30 min after 5 h continuous work,
  spread-over ≤ 10.5 h**, women 21:30–07:00 only with consent + transport/safety.
  [India Briefing](https://www.india-briefing.com/news/maharashtra-shops-and-establishment-act-of-2017-15439.html/), [Nishith Desai](https://www.nishithdesai.com/default.aspx?id=5907)
- Implication: a calendar editor should **warn** (not block) on day > 9 h, no break after
  5 h, spread-over > 10.5 h, or a women-only night window; the CRM is not the payroll
  system and the spec already keeps payroll out of scope.

---

## 4. UX patterns that read as fair rather than surveillance

Evidence for the stakes: Microsoft's 2022 Work Trend Index — 87% of employees say they're
productive, 12% of leaders are confident they are ("productivity paranoia"); tracking
activity rather than impact erodes trust and produces "productivity theatre".
[GeekWire](https://www.geekwire.com/2022/productivity-paranoia-microsoft-study-of-corporate-workplaces-finds-big-disconnect-in-hybrid-work/), [Fortune](https://fortune.com/2022/09/22/microsoft-technology-surveillance-employee-work-jared-spataro)

Patterns (**[K]**, distilled from Zendesk/Jira badges, Slack/Teams presence, Keka/Zoho flows):
1. **Same data, same words, both sides.** The employee's Today page shows exactly the row
   their manager sees about them ("This is what your manager sees"). No manager-only fields.
2. **Explain a stopped clock.** Jira/Zendesk show a pause glyph; add the *why*:
   "Paused — outside working hours, resumes Mon 10:00" / "On hold: waiting on client".
   A clock that silently does not move reads as broken; one that silently moves overnight reads as unfair.
3. **Neutral copy.** "Over by 25 m" beats "BREACHED"; "Away" (Teams/Slack word) beats
   "Idle"; "Not signed in yet" beats "Absent". Red only for over-time; amber for at-risk; grey for paused.
4. **Coarse presence for managers.** Teams/Slack use 5–10 min windows and show only
   Available/Away/Offline. Don't show "Idle 37 min" to a manager; show "Away since 14:32"
   or just Away. A minute counter invites micro-management.
5. **Outcome before activity.** Manager row leads with tasks (open / at risk / over) and
   sign-in time; presence dot is secondary.
6. **A contest button next to every mark.** Late, Not signed in, Breached → "Request
   correction" / "Give reason", one tap, with approver and outcome visible. Keka and Zoho
   People treat regularization as a first-class flow, not an exception.
7. **Allowances over zero-tolerance.** "3 grace lates per month" (Zoho People deviations)
   reads as human; per-minute late marks every day do not.
8. **Telling users what is *not* collected.** A one-line "We record sign-in time and whether
   the app is open and in use. We never record screens, keystrokes, camera or location."
   in the sign-in screen footer / profile. This is the cheapest trust win available.
9. **Field staff reality.** A sales rep on a phone call, at a client, or reading the app
   with the phone backgrounded shows Away/Offline on Teams too; label it "Not in app", not
   "Offline", and never derive "not working" from it.

---

## What our spec gets right

- **D1 clock starts at assignment, two clocks** (response + resolution) — matches every
  vendor; ServiceNow's `task_sla` is nearly the same row shape as `tblTaskTat`.
- **D3 pause only via a reasoned On hold** — stricter and more auditable than Zendesk/Freshdesk
  "pending" statuses; Salesforce's "Stopped" is the same idea.
- **D4 sticky breach** — ServiceNow `has_breached`, Salesforce `IsViolated`, Jira cycles all keep it.
- **F5 reason + manager excuse without blocking completion** — better than most vendors,
  who only have breach notes in comments.
- **Frozen shift on the presence day** — avoids the "admin edited the calendar, history
  changed" class of bug that Zendesk users hit with live recomputation.
- **D8 heartbeat-only presence** — the minimum that answers the question; well inside
  DPDP purpose limitation; avoids the jiggler arms race by not pretending to measure effort.
- **D10 one pure calendar module with table tests** — the right place for the risk.
- **Idempotent sweep stamps** — correct pattern; SN/SF fire actions from persisted state too.
- **Scope via `req.scope` over users** — matches the access model and DPDP access control.

## What our spec is missing vs industry (ranked)

1. **No regularization / correction flow for attendance.** Every Indian HRMS (Keka, Zoho
   People, greytHR, Darwinbox) has "I forgot / app failed / was at a client" → request →
   approve → mark cleared. Without it, a wrong "Late" or "Not signed in" is permanent and
   un-contestable, which also fails DPDP §8(3) accuracy once those marks feed decisions.
   Add `tblPresenceCorrection` (day, kind, reason, remarks, status, approver) mirroring F5.
2. **No leave / off-day input.** Not-signed-in on an approved leave, half-day, comp-off or
   on-duty (client visit) day will notify the manager and count as absent; task clocks keep
   running on a day the assignee is legitimately away, and "Unplanned leave" becomes a
   breach *reason* after the fact. Minimum: a per-user "day off / half day" marker (even
   manager-entered) that `shiftFor()` treats as non-working, so both presence and clocks honour it.
   (The separate Attendance product may already hold leave — reuse it if it exposes an API.)
3. **Night / cross-midnight shifts are broken by F2.** "Never past 23:59" expiry and a
   presence row keyed by calendar date cannot represent a 20:00–05:00 shift. Industry keys
   the attendance day to **shift start date** and expires at shift end + buffer even if that
   is tomorrow. Either support it (key by shift-start date, cap expiry at shift end + buffer)
   or validate calendars to same-day shifts and say so explicitly.
4. **Reassignment resets the target → a gaming path.** D6 gives the new assignee a fresh
   full target; a manager or a creator can "fix" a near-breach by reassigning, and the task
   as a whole has no end-to-end number. Industry keeps both: ticket SLA (continues) +
   OLA per owner (restarts). Add a task-level "assigned → completed" figure in F8 and count
   reassign-before-breach in the report; consider excluding `unassigned` clocks only when
   they closed un-breached.
5. **Report denominator undefined.** Define on-time % = completed-without-breach /
   (completed + breached), excluding `unassigned`/`deleted` clocks that never breached
   ("cancelled" in SN/Zendesk), and still-open un-breached clocks. Otherwise numbers shift
   with reassignment volume.
6. **Target or priority change on an open clock is unspecified.** Zendesk recomputes;
   pick one rule (recompute due times from `AssignedAt` with the new target, keep any
   existing breach stamp) and test it.
7. **Only one escalation level.** Freshdesk has 4 levels, ServiceNow 50/75/100, Salesforce
   multiple violation actions. A second step (e.g. breach + one shift → skip-level `ReportsTo`
   of the manager) is cheap with the existing sweep. Optional, but SMEs owners ask for it.
8. **Hold has no visibility or cap.** Anyone who can edit can hold indefinitely; the only
   check is the reason lookup. Show held time per person in F8 and flag holds longer than
   N working hours on the manager's Today board (no approval workflow needed).
9. **Daily forced logout vs late work.** Expiry at shift end + 2 h kicks someone mid-edit
   who stays late; HRMS products auto-check-out the *attendance* record and leave the app
   session alone. If the requirement stands, at least warn 10 min before expiry and let a
   re-sign-in after expiry attach to the same presence day (not a new "late" day).
10. **Presence thresholds tighter than the norm.** 2-min heartbeat with "Offline after 5 min"
    and an "Idle *n* min" counter is stricter than Teams (5 min) / Slack (10 min) and shows
    managers a minute counter. Use Active / Away (≥10 min no input) / Not in app, and show
    "since HH:MM" instead of a running count.
11. **Late allowance per period.** Zoho People / Keka count N grace deviations per month;
    the spec has only per-day grace minutes. Cheap to add as a report column ("late days
    beyond allowance") without changing the mark itself.
12. **Retention and notice are not in the spec at all** — see Legal must-dos.
13. **Timezone is hard-coded IST.** Fine for an Indian SME, but every vendor puts TZ on the
    schedule. Low priority: add a `TimeZone` column defaulting to `Asia/Kolkata` only if a
    client with staff abroad appears (YAGNI otherwise).

## Legal must-dos (practical)

1. **Notice (do it now, mandatory from 13 May 2027 in effect).** Ship a one-screen,
   versioned notice shown once per user (store `AcceptedNoticeVersion` + timestamp; it is
   acknowledgement, not consent — processing rests on §7(i)). Draft text:

   > **How this app records your work time**
   > [Company] uses this CRM to see when you start your working day and how quickly assigned
   > tasks are picked up and finished. We record: when you sign in and out, the device type,
   > IP address and browser/app version of each sign-in; every 2 minutes while the app is
   > open, whether it is in use; and the timestamps of task assignment, start, hold and
   > completion with any reasons you give.
   > We do **not** record your screen, keystrokes, camera, microphone or location.
   > This is used for work allocation, attendance and performance discussions. You can see
   > everything your manager sees on your **Today** page and ask for any mark to be
   > corrected there. Sign-in records are kept for 1 year; attendance and task-time records
   > for [N] years after you leave. Questions or complaints: [grievance officer name, email].

2. **Grievance contact** per company (DPDP §8(10)) — a field in company settings shown in the
   notice and on the Today page.
3. **Retention (implement as a purge in the same sweep, daily):**
   - Session rows with IP + user agent: keep **≥ 180 days (CERT-In)** and **≥ 1 year (DPDP
     Rule 6/8 minimum)** → **purge or null IP/UA at 1 year**.
   - Heartbeats: never store per-beat rows (the spec already only updates `LastSeenAt` —
     keep it that way).
   - `tblPresenceDay`, `tblTaskTat`, reasons, corrections: employment purpose — keep for
     employment + a fixed tail (suggest **3 years**, aligned to typical labour-record
     limitation **[K]**; client policy may override), then delete or anonymise.
4. **Data location:** CERT-In wants these logs in India. Confirm the server (shadowcodes.in /
   aaPanel host) is in India; if not, raise it with the user.
5. **Access control (Rule 6):** presence and attendance only through `req.scope`; no
   company-wide export to non-admins; log who viewed/exported attendance reports
   (one `tblActivityLog` row per report run is enough).
6. **Accuracy & correction (§8(3), §12):** the regularization flow (gap #1) plus the
   existing breach-reason/excuse flow is the correction mechanism; reports must show the
   corrected value and keep the original + who changed it.
7. **Breach readiness (Rule 7):** the session table holds IPs — include it in whatever
   incident runbook exists (72 h report to the Board, notice to affected people).
8. **Role:** in this product we are the **Data Processor**; each client company is the
   **Data Fiduciary**. Put a DPA clause in client contracts (Rule 6 requires fiduciaries to
   bind processors contractually). **[K]** on the contract specifics.
9. **Labour-law guardrails in the calendar editor:** warn on > 9 h day, missing break after
   5 h, spread-over > 10.5 h (Maharashtra S&E) / > 12 h (OSH Code), and on night windows
   (women need written consent + safety measures). Warn, never block.
