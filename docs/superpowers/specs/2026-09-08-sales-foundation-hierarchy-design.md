# Sales foundation + hierarchy — design

**Date:** 2026-09-08 · **Status:** approved in conversation, awaiting implementation plan
**Spec 1 of 4** in the Sales/Support rebuild. SQL: `backend/sql/071_sales_foundation.sql`.

## Why

The client's list (2026-09-08) asked for remarks, products, lead value, a real
reporting hierarchy with assign / transfer / transfer-back, mandatory remarks
on every follow-up, TAT with escalation, quotations → invoice → commission,
ROI reports by source, and an owner dashboard — plus the same hierarchy, TAT
and history on complaints, with strict branch separation.

Two things drove the shape of this spec:

1. **"Why do we need boards and pipelines?"** Research into Zoho CRM / Zoho
   Desk / Salesforce: Leads have **no stages** — a flat `Lead Status`
   picklist, a list view, and follow-ups as *Activities* (open / closed).
   Stages live on **Deals**, after conversion. Kanban is an optional view,
   never the model. We had built the model *as* a pipeline and put it on
   leads. That is the noise.
2. **Nobody has a manager.** Groups give rank, teams give a lead, but "flag it
   to his senior" has nobody to flag to. Zoho and Salesforce both use an
   explicit *Reports To*. So do we.

## Decisions (in the order they were made)

| # | Decision | Alternative rejected |
|---|---|---|
| 1 | Explicit `tblUser.ReportsTo`, one manager per user | Derive from teams + groups (breaks with two branch managers or a user in no team — today's data) |
| 2 | Leads: flat status dropdown + list views. Pipeline + board removed. | Keep pipeline as a "view" |
| 3 | **Deals stay** (spec 3): Lead → convert → Deal (stage dropdown, no board) → Quotation → Invoice | No Deal module |
| 4 | **No pincode → branch mapping.** Capture full address; a Branch Manager (or above) *chooses* to transfer. | Territory-style auto-routing |
| 5 | **Customer record is born at conversion** (Zoho model). A lead is a prospect; converting creates the Customer + Deal. Complaints and later deals attach to the Customer. | Customer at first contact (extra step on every lead form); or no customer record (reports by client impossible) |
| 6 | Spec 1 flattens **leads only**; tickets keep their pipeline until spec 2 | Flatten both now (doubles spec 1, delays the sales work) |
| 7 | **Visibility follows `ReportsTo`.** `Team` scope = self + every descendant. Wide scopes (Branch / MultiBranch / Company / All) unchanged. | Keep `tblTeams.LeadUserId` as the visibility source |
| 8 | Mobile untouched in spec 1. Backend + web first. | — |

## The four specs

| # | Spec | Depends on |
|---|---|---|
| **1** | **Sales foundation + hierarchy** (this) | — |
| 2 | TAT, escalation + complaints: ticket Status→State, ticket board removed (web + mobile list), SLA per priority, lead follow-up TAT, Overdue/Escalated queues walking `ReportsTo`, reopen gated to managers with reason. Pipeline engine deleted. | 1 |
| 3 | Deals → Customers → Quotation → Invoice → Commission | 1 |
| 4 | Reports + owner dashboard: source budgets + ROI on margin, top products/branches/people, complaints by customer | 2, 3 |

## How a lead lives (plain language, agreed with the client)

1. Lead created with as much as we can get: name, company, mobile, alt mobile,
   email, full address, source, product of interest, expected value, remarks.
   Owner = creator, branch = creator's. Status **New**. One follow-up
   auto-scheduled for **today**.
2. Every contact is a follow-up: type (call / visit / meeting), outcome,
   **remarks — mandatory**, next date. Stamped who / when. Whole history on
   the lead page; whoever inherits the lead reads every call.
3. Status is one dropdown: New → Contacted → Follow-up → Qualified, or Lost
   (reason required) / Junk. Leads screen = list with presets and filters.
4. Every user has a **Reports To**. Managers see everything under them.
   Assignment flows down; transfer flows any direction, **always with a
   reason and remarks**, written to history.
5. Bulk reassign: pick a person, move some or all of their open leads.
6. Cross-branch transfer is a Branch Manager's judgement from the address —
   no automatic routing.
7. TAT (spec 2): computed when a manager opens the CRM — no scheduler.
8. Qualified → convert → Deal (spec 3). Then quotation, invoice, commission.

## 1. Data model

### Users
| Change | Detail |
|---|---|
| `tblUser.ReportsTo INT NULL` | FK → `tblUser.Id`, same `CompId`. Top roles NULL. |
| `sp_SaveUser` | `+@ReportsTo`. Rejects self and any cycle (walks up ≤ 20 hops). Admin-only, as user management already is. |
| `sp_FetchAccessibleBranchIds` | `Team` → recursive CTE on `ReportsTo`: self + descendants. Branch set for `Team` = primary branch ∪ subtree members' branches, so a cross-branch subordinate's leads are not hidden by the branch filter. `Self` and wide scopes unchanged. Inactive subordinates stay in the subtree so their leads remain visible for reassignment. |

### Leads
| Column | Change |
|---|---|
| `PipelineId`, `StageId` | **Dropped.** Backfill by `StageType`: open→New, won→Qualified, lost→Lost. Index `IX_tblLeads_new_CompId_StageId` dropped. |
| `StatusId INT NOT NULL` | → `tblLookup` `Kind='lead_status'` |
| `Company NVARCHAR(200)`, `Address NVARCHAR(500)`, `City`, `State NVARCHAR(100)`, `Pincode VARCHAR(10)` | New. Free text. |
| `ProductId INT NULL` | → `tblProduct` |
| `Remarks NVARCHAR(MAX)` | New — lead-level notes (Zoho "Description") |
| `AssignedAt DATETIME` | New — when the current owner got it. Spec 2's TAT clock. Backfilled from `UpdatedAt`/`CreatedAt`. |
| `OwnerId` | Nullable = **unassigned**. Visible only to wide scopes (the branch manager's "Unassigned" list); the owner-scope filter hides NULL owners from Team/Self. |
| `EstValue`, `SourceId`, `LostReasonId`, `LostAt`, `WonAt` | Kept. `WonAt` unused until spec 3. |
| `NextFollowupDate` | Kept as a **cache** = earliest open follow-up, refreshed by `sp_RefreshLeadNextFollowup`. Lists sort on it. |

New indexes: `(CompId, StatusId)`, `(CompId, OwnerId)`, `(CompId, NextFollowupDate)`.

### `tblLookup.Code VARCHAR(30) NULL`
Machine meaning behind an editable label. Seeds for `lead_status`, per company:

| Label | Code | |
|---|---|---|
| New | `open` | default on create (lowest `SortOrder` with `Code='open'`) |
| Contacted | `open` | |
| Follow-up | `open` | |
| Qualified | `qualified` | still an active lead; the interim "conversion" measure until spec 3 |
| Lost | `lost` | requires `LostReasonId` |
| Junk | `junk` | |

"Active" = `Code IN ('open','qualified')`. Spec 3 adds `Converted` /
`converted`. Spec 2 reuses `Code` for ticket State (`open` / `onhold` /
`closed`). `sp_SaveLookup` defaults `lead_status` rows to `open` and rejects
codes outside the known set.

New kinds seeded: `product_category` (General), `transfer_reason` (Absent ·
Overloaded · Wrong branch · Sent back to manager · Reassigned by manager ·
Other).

### Follow-ups — rebuilt as activities (`tblFollowUp`, 0 rows today)
| Column | |
|---|---|
| `Id, CompId, BranchId, LeadId` | |
| `Type VARCHAR(20)` | `call` · `visit` · `meeting` · `other` (CHECK) |
| `DueAt DATETIME NOT NULL` | |
| `AssignedTo INT NULL` | lead owner at scheduling time; re-pointed on transfer |
| `Status VARCHAR(20)` | `open` · `done` · `skipped` (CHECK) |
| `DoneAt`, `DoneBy` | |
| `OutcomeId INT NULL` | `Kind='call_outcome'`, reused |
| `Remarks NVARCHAR(1000)` | **CHECK: NOT NULL/blank unless `Status='open'`** — the mandatory-remarks rule lives in the table, not only the SP |
| `Direction VARCHAR(5)`, `Duration INT` | for `Type='call'` |
| audit columns | |

Flow: create lead → one open follow-up due today. **Log follow-up** =
complete it (outcome + remarks) and optionally schedule the next. Zoho's
Open / Closed Activities = `Status`.

**Absorbs lead calls.** `tblCall` stays for tickets; `sp_LogCall` no longer
writes a follow-up. `LogCallModal` goes; calls-per-user counts follow-ups with
`Type='call'` plus ticket calls.

### Products (light)
`tblProduct`: `Id, CompId, Name, Code, CategoryId, UnitPrice DECIMAL(18,2),
MarginPct DECIMAL(5,2) (0–100), IsActive`, audit. Filtered unique
`(CompId, Name) WHERE IsActive = 1`. Spec 3 adds tax and quotation needs.

### Assignment history
`tblLeadAssignment`: `Id, CompId, LeadId, FromUserId NULL, ToUserId NULL,
FromBranchId, ToBranchId, ReasonId, Remarks NVARCHAR(500) NOT NULL,
AssignedBy, AssignedAt`. Its own table — spec 2 and 4 report on it ("how long
did each person hold it"). `sp_TransferLead` also logs to `tblLeadActivity`
so the lead timeline still shows the move.

### Removed
- `tblPipeline` / `tblPipelineStage` rows for `Entity='lead'` (tables stay
  for tickets).
- `sp_MoveLeadStage`, `sp_SaveFollowUp`, `sp_FetchFollowUp`,
  `sp_PipelineFunnel` dropped.

## 2. Backend

### SPs
| SP | |
|---|---|
| `sp_SaveUser` | `+@ReportsTo` (default NULL — old callers unaffected) |
| `sp_FetchUser` | `+ReportsTo, ReportsToName` |
| `sp_FetchUserDirectory` | `+BranchId, ReportsTo, JobTitle` (feeds the Reports To picker) |
| `sp_FetchAccessibleBranchIds` | `Team` via subtree |
| **`sp_FetchAssignableUsers`** `@UserId, @CompId, @BranchId=NULL` | Who can I hand a lead to. Wide scopes: everyone in readable branches. Team/Self: my subtree + my manager. `@BranchId` set: that branch's roster (for cross-branch; the *right* to do it is decided in Node). |
| `sp_FetchLookups` / `sp_SaveLookup` | carry `Code` |
| `sp_SaveProduct` · `sp_FetchProducts` · `sp_DeleteProduct` | paged fetch with search/category/active; soft delete; 409 on duplicate active name |
| `sp_SaveLead` | new fields; insert defaults status and auto-creates the first follow-up (`@FirstFollowupAt`, default today); **update ignores `OwnerId` and `StatusId`** — those move only through transfer / set-status |
| `sp_FetchLeads` | `−Stage/Pipeline`, `+@StatusId, @StatusCode, @ProductId, @OwnerId, @BranchId, @Overdue, @Unassigned`; returns labels (status, product, owner, source, branch) + `IsOverdue`; `@Overdue` sorts by due date |
| `sp_FetchLeadDetail` | RS1 core (+labels) · RS2 custom values · RS3 timeline · RS4 follow-ups · RS5 assignment history |
| **`sp_SetLeadStatus`** | `lost` ⇒ reason required + `LostAt`; otherwise clears both; logs `status` with `{from,to}` |
| `sp_TransferLead` | `@ToUserId (NULL=unassign), @ToBranchId (NULL=keep), @ReasonId, @Remarks` required; 400 on no-op; writes assignment + activity; re-points open follow-ups |
| **`sp_BulkTransferLeads`** | `@LeadIdsJson`; validates every id first; one transaction; skips leads already with the target; returns `Transferred, Skipped` |
| `sp_DeleteLead` | `+` assignment rows |
| **`sp_ScheduleFollowUp`** · **`sp_CompleteFollowUp`** · **`sp_SkipFollowUp`** · **`sp_FetchFollowUps`** · `sp_DeleteFollowUp` (open only) | see data model; `sp_RefreshLeadNextFollowup` keeps the cache |
| `sp_LogCall` | follow-up block removed |
| **`sp_LeadsByStatus`** (replaces funnel) · `sp_CallsPerUser` · `sp_ConversionBySource` (`+QualifiedCount`; `WonCount` stays, 0 until spec 3) · `sp_Dashboard` (funnel → by status; calls → follow-ups + ticket calls; active = `open`/`qualified`) | |

### Endpoints (POST-per-action, existing routers)
- `users`: `saveUser` (+ReportsTo), `fetchUsers`, `fetchUserDirectory`, **`fetchAssignableUsers`**
- **`products`**: `saveProduct`, `fetchProducts`, `deleteProduct` — new router, registered in `config/routes.js`
- `leads`: `saveLeads`, `fetchLeads`, `fetchLeadDetail`, **`setLeadStatus`**, `transferLead`, **`bulkTransferLeads`**, `deleteLeads`. `moveLeadStage` removed.
- `followups`: **`scheduleFollowUp`**, **`completeFollowUp`**, **`skipFollowUp`**, `fetchFollowups` (new shape: rows + pagination, like leads), `deleteFollowup`
- `config`: `fetchLookups` / `saveLookup` with `Code`. `fetchPipelines` stays for tickets.
- `reports`: `pipelineFunnel` → **`leadsByStatus`**; `callsPerUser`, `conversionBySource` relabelled

### Rules (controllers on `req.scope`; tenancy in SPs — the existing split)
| Action | Who |
|---|---|
| Read / edit / set status | in scope, **or** owner, **or** creator (`assertRecordAccess`) |
| Transfer to a person | must see the lead **and** target ∈ `sp_FetchAssignableUsers(caller)` — the server re-runs the check; the dropdown is not the gate |
| Transfer to another branch | `DataScope` ∈ Branch · MultiBranch · Company · All. Any branch. A Branch Manager may push to a branch they can't read and then lose sight of it — that is the ask. |
| Unassign | wide scopes only |
| Bulk | per-lead rule; batch atomic |
| Products write | `requireMinLevel(2)` |
| `ReportsTo` | `requireAdmin` |

## 3. Web

| Screen | Change |
|---|---|
| **Leads** | Main screen. Presets: *My leads · My team · Unassigned · Overdue · Lost*. Filters: status, product, source, owner, branch. Bulk-select → **Reassign** (person + reason + remarks). |
| **Pipeline** | Deleted. `/sales/pipeline` → redirect to `/sales/leads`. `PipelineCard`, `PipelineColumn`, `Pipeline.jsx` removed. `BoardColumn` / `useStageBoard` stay for `TicketBoard` until spec 2. |
| **Lead create/edit** | Company, address block, product, remarks, expected value, first follow-up date (default today). No owner on edit. No stage/pipeline. |
| **Lead detail** | Status dropdown (Lost prompts reason). Tabs: *Follow-ups* (open above, done below) · *History* (timeline + assignments). Buttons: **Log follow-up**, **Transfer**. `LogCallModal` removed. |
| **Follow-ups** | *Today · Overdue · Upcoming* across visible leads; complete in place. |
| **Settings › Products** | New page via `LookupMaster`-style CRUD (fields differ, so its own page). |
| **Settings › Pipelines** | Tickets only (hide the entity switch). |
| **Settings › Lookups** | `lead_status` (with Code), `product_category`, `transfer_reason` added. |
| **Users** | `Reports To` picker (directory minus self). |
| **Reports** | `PipelineFunnel` → `LeadsByStatus`; `ConversionBySource` shows Qualified with a note; `CallsPerUser` unchanged UI. |
| `salesQueries.js` | endpoints updated; `moveLeadStage`, `logCall`, `fetchCalls`, `saveFollowup`, `pipelineFunnel` removed |

## 4. Testing

- Backend: suites for every touched controller (mocked DB). Transfer gets the
  failure cases: target outside subtree, cross-branch by a Team Lead, unassign
  by an executive, missing remarks, no-op transfer. Follow-ups: complete
  without remarks (400), complete already-done (409), delete a done row (409).
  Products: duplicate name (409), margin out of range (400). Contracts
  verified against the live DB after `071` is applied.
- Web: each screen ≥ 80 %, MSW. Regression tests: Transfer modal and
  Log-follow-up modal refuse to submit without remarks; Lost prompts for
  reason; Leads presets map to the right query params.

## 5. Rollout

1. `backend/sql/071_sales_foundation.sql` — user applies. Ticket side keeps
   working throughout (its pipeline is untouched).
2. Backend deploy. (Old follow-up / stage SPs are dropped by `071`, so the
   backend must follow the script, not precede it.)
3. Web deploy.

## Out of scope / known

- **Mobile**: nothing. No lead screens exist; ticket board stays until spec 2.
- `sp_ConvertedSummary` (reports → `getConvertedSummary`) references columns
  that do not exist (`LeadStatus`, `InvoiceDate`) — already broken before this
  spec; spec 3 rewrites it against Deals. `sp_LeadsUserWise` is an orphan.
- `Converted` status and the convert action: spec 3.
- Duplicate role rows in `tblUserGroups` (every stock role exists twice, 0
  members on the copies) — hygiene, not blocking; fold into spec 2's SQL.
- `ROLES.md` "write path is ungated" is stale — `assertRecordAccess` already
  gates lead/ticket writes. Update the doc with this spec's rules.
