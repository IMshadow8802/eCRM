# Sales reports system — design (spec 4a)

**Date:** 2026-09-10 · **Status:** approved by owner (2026-09-10) · **Builds on:** spec 1 (`2026-09-08-sales-foundation-hierarchy-design.md`, shipped `eec3a36`).

## 0. Why
Today's four report pages are single numbers with a bar: no date range, no filters, no trend, no drill-down, no "why". The owner's words: "a few numbers floating around". A report *system*: one frame, one filter set, one SP shape, eight reports, seeded data that makes the charts real.

## 1. Decisions
| # | Decision | Why |
|---|---|---|
| 1 | One SP per report, three result sets (KPIs · rows · trend), same params everywhere | independent, testable; a report = SP + column spec |
| 2 | Shared `ReportPage` frame: filter bar → KPI strip → trend chart → breakdown table → drill-down | consistency; adding a report costs one page file |
| 3 | Every report SP applies **branch AND owner scope** (`@AccessibleBranchIdsJson`, `@OwnerIdsJson`) exactly like `sp_FetchLeads` | fixes the live-test finding: Team/Self callers saw branch totals |
| 4 | New `tblLeadStatusHistory`, written on insert and on every status change | funnel over time and "days per step" need it |
| 5 | Drill-down = Leads list pre-filtered via URL params | the number is always inspectable |
| 6 | Sales Executives get no Reports menu; their numbers come from the phase-2 "My Day" dashboard | a rep needs today's list, not eight pages |
| 7 | Demo data is a **backdated, deterministic SQL seed** (`076`), prefixed `DEMO`, removable by `077` | the API stamps "now"; trends need 180 days of history |
| 8 | Revenue / won value / margin realised / source ROI wait for spec 3 | they need conversion + invoice |
| 9 | Dashboards by role are phase 2 of this spec (separate plan, same SPs) | keep 4a shippable |

## 2. Data model (SQL, `075_sales_reports.sql`)
```sql
CREATE TABLE dbo.tblLeadStatusHistory (
  Id INT IDENTITY PRIMARY KEY, CompId INT NOT NULL, LeadId INT NOT NULL,
  FromStatusId INT NULL, ToStatusId INT NOT NULL, ChangedBy INT NULL,
  ChangedAt DATETIME NOT NULL DEFAULT GETDATE());
-- index (CompId, LeadId, ChangedAt); index (CompId, ToStatusId, ChangedAt)
```
- `sp_SaveLead` (insert path) writes `(NULL → @StatusId)`; `sp_SetLeadStatus` writes `(old → new)` in the same transaction. Backfill: one row per existing lead `(NULL → StatusId, CreatedAt)`.
- Derived, no schema: first contact = `MIN(DoneAt)` of the lead's done follow-ups; last touch = `MAX(COALESCE(DoneAt, CreatedAt))` over follow-ups/activity; "nothing scheduled" = no open follow-up.
- Menu: `tblMenu` rows under parent 11 (`Sales Reports`) for the 8 routes below; grants cloned from row 20 (Leads by Status) — i.e. groups 2, 9/18, 12/21, 13/22, 15/24 (no executives). Retire rows 20/21/22 by re-pointing their `Route` to the new pages (`/reports/funnel`, `/reports/activity`, `/reports/funnel?groupBy=source`) rather than deleting — their grants carry over.

## 3. Report SP contract (all eight)
**Params** (identical): `@CompId INT, @FromDate DATE, @ToDate DATE, @DateBasis VARCHAR(10) = 'created' | 'closed' | 'activity', @BranchId INT = NULL, @OwnerId INT = NULL, @SourceId INT = NULL, @ProductId INT = NULL, @GroupBy VARCHAR(20), @UserId INT, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL`.
Scope predicate (copy from `sp_FetchLeads` 071:1200-1210): `(branch in scope OR OwnerId = @UserId OR CreatedBy = @UserId) AND (@UseOwnerScope = 0 OR OwnerId IN owners)`; filters narrow inside it. `@ToDate` inclusive (compare `< DATEADD(day,1,@ToDate)`).
**Result sets**: RS1 one row of KPIs (`Label`-less: named columns); RS2 breakdown rows with `GroupKey INT NULL, GroupLabel NVARCHAR(200)` first, then measures; RS3 trend rows `Bucket DATE, <measures>` weekly (`DATEADD(week, DATEDIFF(week, 0, x), 0)`) when the range > 31 days else daily. No `ResponseCode` columns in report SPs (read-only, controller wraps).

| SP | RS1 KPIs | RS2 measures (per GroupBy) | RS3 trend |
|---|---|---|---|
| `sp_RptFunnel` | Created, Contacted, Qualified, Lost, Junk, QualifiedPct, LostPct, AvgDaysToContact, AvgDaysToQualify | same counts + pcts per group | Created, Qualified, Lost |
| `sp_RptFollowUpCompliance` | Due, DoneOnTime, DoneLate, Skipped, Missed (open & past due), OnTimePct, AvgDelayHours | per rep/team/branch | Due, DoneOnTime, DoneLate, Missed |
| `sp_RptActivity` | Calls, Visits, Meetings, Other, TalkMinutes, Inbound, Outbound, Connected (outcome=Connected) | per rep or per day (`@GroupBy='day'`) | Calls, Visits, Meetings |
| `sp_RptLost` | Lost, LostPct, TopReason | reason rows; `@GroupBy` in source/product/owner/branch adds a second key `SubKey/SubLabel` | Lost |
| `sp_RptAging` | Open, Age0_7, Age8_30, Age31_90, Age90Plus, NoNextFollowUp, AvgDaysSinceTouch | per owner/branch: the same buckets | Open (as of bucket end) |
| `sp_RptTransfers` | Transfers, CrossBranch, SendBacks (reason 'Sent back to manager'), Unassigns | per reason / per from→to pair (`GroupLabel` "Amit → Sara") / per branch | Transfers |
| `sp_RptPipelineValue` | OpenValue, QualifiedValue, LostValue, OpenCount, AvgValue | per status/owner/product/branch: Count, Value | OpenValue |
| `sp_RptLeaderboard` | (none — RS1 empty) | per rep: Created, Qualified, Activities, OnTimePct, AvgResponseHours, Rank | — |

GroupBy values: `source | owner | product | branch | status | reason | day | team` (team = ReportsTo subtree root = the rep's manager). Unknown value → 400 from the SP (`RAISERROR` or a status row) — planner picks one and the controller maps it.

## 4. Backend
`reportController.js` gains `funnel, followUpCompliance, activity, lost, aging, transfers, pipelineValue, leaderboard` — one shared helper `runReport(spName, req, res, key)` that validates `FromDate/ToDate` (default: last 30 days), `GroupBy` (whitelist), narrows `BranchId/OwnerId/SourceId/ProductId` via `positiveInt`, passes `scopeParams(req)`, and returns `data: { kpis: RS1[0] ?? {}, rows: RS2, trend: RS3, range: {from,to,basis,groupBy} }`. Routes `POST /api/reports/<name>` (camelCase). Old `leadsByStatus/callsPerUser/conversionBySource/getConvertedSummary` stay one release for the redirects, then go. Tests: helper unit-tested once (validation, defaults, scope pass-through), each method a happy + a 400.

## 5. Web
- `pages/Reports/ReportPage.jsx` (new frame; `ReportShell.jsx` retired): props `{ title, subtitle, endpoint, groupBys:[{value,label}], kpis:[{key,label,format}], columns:[{key,header,format,align}], trend:{series:[{key,label,color}]}, drill:(row, filters)=>leadsUrl }`. Filter bar: date preset chips (7d / 30d / 90d / This month / Custom with two `DateField`s), `DateBasis` select, Branch (`fetchBranches`), Owner (`useAssignableUsers` — roster = scope), Source/Product (`useLookups`/`fetchProducts`), GroupBy segmented. Filters live in the URL (`useSearchParams`) so a report is linkable. KPI strip = `StatCard` tiles (new small ui component or reuse if one exists). Trend = `components/Charts/AreaTrend` (recharts). Table = `ReportTable` (kept from ReportShell) + CSV export button (client-side, `Blob`). Row click → `navigate(drill(row))`.
- `Leads.jsx` reads URL params `StatusCode, StatusId, SourceId, ProductId, OwnerId, BranchId, Overdue, Unassigned, from, to` into its filters on mount.
- 8 pages (`Reports/Funnel.jsx`, `FollowUpCompliance.jsx`, `Activity.jsx`, `Lost.jsx`, `Aging.jsx`, `Transfers.jsx`, `PipelineValue.jsx`, `Leaderboard.jsx`) — each ≤ 60 lines: a config object + `<ReportPage …/>`. Routes `/reports/funnel` etc.; `/reports/leads-by-status` → `/reports/funnel`, `/reports/calls-per-user` → `/reports/activity`, `/reports/conversion-by-source` → `/reports/funnel?groupBy=source`; `/reports` fallback → `/reports/funnel`. Delete `LeadsByStatus.jsx`, `CallsPerUser.jsx`, `ConversionBySource.jsx` (+tests) once redirects exist.
- Charts: recharts only, numeric heights; colours from theme tokens; dark mode aware.

## 6. Seed — `076_seed_sales_demo.sql` (+ `077_remove_sales_demo.sql`)
- Deterministic: a numbers table + `(n * 7919) % 1000` style hashing, **no `NEWID()`/`RAND()`**, so re-runs produce identical rows; idempotent by deleting `Name LIKE 'DEMO %'` first (and their follow-ups/assignments/history/activity).
- Users: reuse the 10 test users; insert 4 more reps directly (branch 3 INDIRAPURAM: 1 BM + 3 execs, `ReportsTo` set, group map rows, `Password` copied from `se_ho_amit`'s row so the shared test password works). Prefix `Username` `demo_`.
- Leads: 600 over the last 180 days (more recent = denser); branches 1/2/3 at 45/35/20 %; owners spread across execs with two "stars" and one "laggard"; sources weighted Website 30 / Referral 20 / Walk-in 15 / Phone 15 / Social 12 / Advertisement 8; products across the 4 (+2 seeded); `EstValue` = product price × 1–3 ± noise; cities/pincodes from a 12-row list. Status mix 55 % open (split New 20 / Contacted 20 / Follow-up 15) · 20 % Qualified · 18 % Lost (reasons weighted Price 35 / Competitor 25 / No budget 15 / Not interested 15 / No response 10) · 7 % Junk. `CreatedAt` backdated; `StatusHistory` rows backdated at plausible offsets (contact 0–3 d, qualify 5–25 d, lost 3–40 d).
- Follow-ups: 2–6 per lead; `DueAt` staggered; done rows 70 % on time (`DoneAt` ≤ DueAt+2h), 20 % late (1–5 d), 10 % left open past due (missed); open future ones on active leads; types call 65 / visit 20 / meeting 10 / other 5; outcomes weighted; `Duration` 2–25 min for calls; `Direction` 80 % out. Remarks from a 20-phrase list.
- Transfers: 12 % of leads get 1–2 `tblLeadAssignment` rows with weighted reasons; 3 % cross-branch (branch updated accordingly).
- Verify block prints counts per branch/status and the KPI rows of each report SP for the last 90 days.

## 7. Testing & rollout
- SQL: verify block in `075` runs each SP once with a wide range and asserts three result sets; `076` verify prints distributions.
- Backend: Jest as usual (mocked DB) + live contract check via the existing `livetest` runner extended with one call per report per persona (Priya, Rahul, Neha, Amit) asserting scope narrows.
- Web: frame tests (filters → posted body, drill URL, CSV blob), one page test per report (config renders KPIs/columns), Leads URL-param test.
- Rollout: `075` → backend deploy → `076` (seed) → web deploy → owner walkthrough → `077` when demo data is no longer wanted.

## 8. Out of scope
Revenue/margin/ROI (spec 3), targets, scheduled reports, PDF, mobile.
