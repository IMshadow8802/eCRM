# Support / complaints rebuild — design

**Date:** 2026-09-16 · **Status:** approved in conversation, awaiting implementation plan
**Spec 2 of 4** in the Sales/Support rebuild (roadmap in
`2026-09-08-sales-foundation-hierarchy-design.md`). SQL: `backend/sql/086_support_rebuild.sql`.

## Why

The client asked (2026-09-08) for "the same hierarchy, TAT and history on
complaints, with strict branch separation", and for a product that works for
any industry. What exists today:

- Tickets run on the **pipeline engine** — the only thing left using it since
  leads went flat. A kanban board is the landing page (`/support` → board),
  and mobile Phase B is a stage board too. Same noise the foundation spec
  removed from sales.
- **No customer.** A ticket carries three loose strings (`CustomerName`,
  `ContactPerson`, `Contact`). Live data: one shop has 12 complaints under
  three spellings of one mobile number; 38 distinct contacts across 57
  tickets. "Complaints by customer" is impossible.
- No subject, no product, no due date, no escalation, no transfer history.
  Channel is a hardcoded list copied in web and mobile.

Decisions taken in conversation (2026-09-16):

| # | Decision | Alternative rejected |
|---|---|---|
| 1 | **Light `tblCustomer` now.** Complaints come from people who were never leads. Spec 3 links lead conversion to the same table. | Free text + address on the ticket, customer deferred to spec 3 |
| 2 | **Mobile rebuilt in this spec.** Deleting the pipeline engine breaks Phase B the day the backend deploys; a shim would keep two lifecycles alive. | Mobile later, compatibility shim |
| 3 | Flat `ticket_status` lookup with `Code`, mirroring `lead_status`. Pipeline engine deleted. | Keep stages as the status model, drop only the boards |
| 4 | **TAT = hours per priority** on the lookup. The 2026-07-16 SLA removal stands for the rules engine (no `tblSLARule`, no business hours, no breach report); a due date per priority is the minimum the client asked for. | Full SLA policies |
| 5 | **Escalate = flag a senior**, ticket stays with the agent. Overdue is computed on read — no scheduler. | Auto-reassign; scheduled jobs |
| 6 | **Reopen is a manager's act**, remarks required. Agent cannot reopen own. | Anyone reopens |
| 7 | Resolved → Closed two-step kept (customer confirmation). | Single terminal |
| 8 | Channel becomes a lookup (`ticket_channel`). | Keep hardcoded |
| 9 | No customer merge tool. Three spellings stay three customers until edited. | Merge UI |

## How a complaint lives (plain language)

1. Agent types the customer's mobile. Existing customer → picked; else
   created inline (name, company contact, mobile, email, address). Subject,
   category, priority, channel, product, description, photos. Priority sets
   the **due date** (urgent 4h · high 24h · medium 72h · low 168h — editable
   per company). Status **New**.
2. Assign or transfer — always with a reason and remarks, written to history.
   Managers see everything under them (`ReportsTo`), branch separation as
   for leads.
3. Work it: In Progress / On Hold. Log calls. Everything on the timeline.
4. Not fixed by the due date → **Overdue** on every list; the assignee's
   manager finds it in **Escalated**. Anyone can also **Escalate** it
   explicitly to a senior in the chain, with remarks — the senior gets an
   in-app notification.
5. **Resolve** = resolution + remarks. **Close** = customer confirmed.
   **Reject** = remarks, never solved. **Reopen** = a manager, with remarks;
   the TAT clock restarts.
6. Customer page: profile + every complaint they ever raised.

## 1. Data model

### `tblCustomer` (new)
| Column | |
|---|---|
| `Id INT IDENTITY PK`, `CompId INT NOT NULL`, `BranchId INT NOT NULL` | branch = creating user's |
| `Name NVARCHAR(200) NOT NULL` | the business or the person |
| `ContactPerson NVARCHAR(200) NULL` | who to speak to, when `Name` is a business |
| `Mobile VARCHAR(20) NULL`, `AltMobile VARCHAR(20) NULL`, `Email NVARCHAR(200) NULL` | `sp_SaveCustomer` requires mobile **or** email; digits/`+` only in mobile |
| `Address NVARCHAR(500)`, `City NVARCHAR(100)`, `State NVARCHAR(100)`, `Pincode VARCHAR(10)` | all NULL |
| `Remarks NVARCHAR(MAX) NULL`, `IsActive BIT NOT NULL DEFAULT 1` | soft delete |
| `CreatedBy, CreatedAt DEFAULT GETDATE(), EditBy, UpdatedAt` | |

Unique filtered index `UX_tblCustomer_CompId_Mobile (CompId, Mobile) WHERE IsActive = 1 AND Mobile IS NOT NULL`.
Index `(CompId, Name)`.

**Backfill** from `tblTicket`: one customer per distinct `(CompId, Contact)`
where `Contact IS NOT NULL` — `Name` = `CustomerName` of the earliest ticket,
`ContactPerson` likewise, `Mobile` = `Contact` when it has no character
outside `0-9 + space -` (spaces/dashes stripped), else `Email` = `Contact`
when it contains `@`, else both NULL and `Contact` copied to `Remarks`.
`BranchId`/`CreatedBy`/`CreatedAt` from the earliest ticket. Tickets with
`Contact IS NULL` (3 today): one customer per distinct `CustomerName`. Then
`tblTicket.CustomerId` set by the same key. Script asserts zero tickets
without a customer before the `NOT NULL`.

### `tblTicket`
| Column | Change |
|---|---|
| `CustomerId INT NOT NULL` | **new**, FK → `tblCustomer` (backfilled first) |
| `Subject NVARCHAR(200) NOT NULL` | **new**; backfill `LEFT(LTRIM(Description),200)`, else `'Complaint ' + TicketNo` |
| `StatusId INT NOT NULL` | **new** → `tblLookup` `Kind='ticket_status'` |
| `ProductId INT NULL` | **new** → `tblProduct` |
| `ChannelId INT NULL` | **new** → `tblLookup` `Kind='ticket_channel'`; backfilled from `Channel` text (case-insensitive) |
| `DueAt DATETIME NULL` | **new**. `CreatedAt + TatHours(priority)`; NULL when the priority has no TAT (never overdue). Backfilled for every ticket. |
| `AssignedAt DATETIME NULL` | **new**; backfill `CreatedAt` where `AssignedTo IS NOT NULL` |
| `EscalatedTo INT NULL`, `EscalatedAt DATETIME NULL` | **new** |
| `ContactPerson`, `Contact` | **kept**, now optional "reported by" (prefilled from the customer on create) |
| `PipelineId`, `StageId`, `CustomerName`, `Channel` | **dropped** (after backfill; any index on `StageId` dropped) |

Indexes: `(CompId, StatusId)`, `(CompId, AssignedTo)`, `(CompId, CustomerId)`, `(CompId, DueAt)`.

### `tblLookup`
- `+TatHours INT NULL`. Meaningful on `Kind='priority'`. Seeds per company,
  matched on `Value` case-insensitively: `urgent 4 · high 24 · medium 72 · low 168`.
- **`ticket_status`** seeded for every `CompId` present in `tblLookup`:

| Label | Code | |
|---|---|---|
| New | `open` | default on create (lowest `SortOrder` with `Code='open'`) |
| In Progress | `open` | |
| On Hold | `onhold` | waiting on customer / parts |
| Resolved | `resolved` | requires `ResolutionId` |
| Closed | `closed` | customer confirmed |
| Rejected | `rejected` | never solved, remarks required |

`sp_SaveLookup` defaults `ticket_status` rows to `open` and rejects codes
outside that set. "Active" = `Code IN ('open','onhold')`. Terminal =
`resolved/closed/rejected`.

- **`ticket_channel`** seeded: Phone · WhatsApp · Email · Web · Chat · Walk-in.

**Status backfill** from the stage name, trimmed, case-insensitive:
`New→New · Assigned→In Progress · In-Progress/In Progress→In Progress ·
Resolved→Resolved · Closed→Closed · Rejected→Rejected`; anything else by
`StageType`: `open→New`, `won` with `ClosedAt→Closed`, `won→Resolved`,
`lost→Rejected`. Script asserts zero NULL `StatusId` before `NOT NULL`.

### `tblTicketAssignment` (new)
`Id, CompId, TicketId, FromUserId NULL, ToUserId NULL, FromBranchId,
ToBranchId, ReasonId, Remarks NVARCHAR(500) NOT NULL, AssignedBy,
AssignedAt DEFAULT GETDATE()`. Index `(CompId, TicketId)`. Same shape as
`tblLeadAssignment`.

### `tblTicketStatusHistory` (new)
`Id, CompId, TicketId, FromStatusId NULL, ToStatusId, ChangedBy, ChangedAt`.
Indexes `(CompId, TicketId)`, `(CompId, ToStatusId, ChangedAt)`. Written
only by `sp_SetTicketStatus` (and the `sp_SaveTicket` insert row). Seed per
existing ticket, best effort from timestamps: `NULL→New` at `CreatedAt` by
`CreatedBy`; `New→Resolved` at `ResolvedAt` when set; `Resolved→Closed` at
`ClosedAt` when status is Closed; `New→Rejected` at `ClosedAt` when Rejected.

### Removed
The drop runs **after** every procedure that referenced the dropped columns has
been re-created — `sys.sql_modules.definition` keeps the banner comment above
`CREATE PROC`, so even a *comment* naming `StageId` / `PipelineId` /
`tblPipeline` in a rewritten procedure trips the script's own halt check.

- `sp_MoveTicketStage`, `sp_FetchPipelines`, `sp_SavePipeline`,
  `sp_SaveStage`, `sp_DeleteStage` dropped; then `tblPipelineStage`,
  `tblPipeline` dropped.
- Duplicate role rows: every `tblUserGroups` row with zero
  `tblUserGroupMap` members whose `Name` duplicates a lower-`Id` row in the
  same `CompId` (today ids 18–26), plus their `tblGroupAccess` rows (184).
- `tblMenu` row 18 "Ticket Board" and row 28 "Pipelines" with their
  `tblGroupAccess` rows.

### Added menu
`tblMenu` row: `ParentId=17` (Support), `Description='Customers'`,
`Route='/support/customers'`, `MenuType=1, IsAllowed=1, OpenStyle=1`.
`tblGroupAccess` rows copied from the Tickets row (19) for every group that
has one.

## 2. Lifecycle — one engine, code-driven

### `sp_SetTicketStatus`
`@CompId, @TicketId, @StatusId, @UserId, @ResolutionId INT = NULL,
@Remarks NVARCHAR(1000) = NULL, @AllowReopen BIT = 0`

| To code | From | Rule | Writes | Activity |
|---|---|---|---|---|
| `open` / `onhold` | open / onhold | free; remarks optional | `StatusId` | `status` |
| `open` / `onhold` | resolved / closed / rejected | **reopen**: `@AllowReopen=1` (Node passes it only when the gate passes) else 403 `Reopening requires a manager`; remarks required | clears `ResolvedAt, ClosedAt, ResolutionId`; `DueAt = GETDATE() + TatHours` | `reopened` |
| `resolved` | any non-terminal | `ResolutionId` (param or existing) required; remarks required | `ResolvedAt = GETDATE()`, `ClosedAt = NULL`, `ResolutionId` | `resolved` |
| `closed` | resolved | remarks optional | `ClosedAt = GETDATE()` | `closed` |
| `closed` | open / onhold | `ResolutionId` + remarks required (straight-to-closed) | `ResolvedAt = ISNULL(ResolvedAt, GETDATE())`, `ClosedAt`, `ResolutionId` | `closed` |
| `rejected` | any | remarks required | `ResolvedAt = NULL, ResolutionId = NULL, ClosedAt = GETDATE()` | `rejected` |
| same status | — | 200 no-op, nothing written | | |

**Terminal → terminal is not a reopen.** The gate fires only on terminal →
`open`/`onhold`, so an agent may move `rejected → closed` (the straight-to-closed
path: resolution + remarks) or `closed → resolved` (un-closes, clears
`ClosedAt`) without a manager. Neither returns the complaint to anyone's active
queue, which is what the gate exists to prevent. Gating those too is one extra
predicate in `sp_SetTicketStatus` if it is ever wanted.

Every transition: history row from the `UPDATE ... OUTPUT deleted.StatusId`
(the 075 pattern), activity via `sp_LogTicketActivity` with
`Summary = 'Status: A → B' (+ ' — ' + remarks)` and
`MetaJSON {fromStatusId, toStatusId, fromCode, toCode, resolutionId, remarks}`.
`@StatusId` must be an active `ticket_status` row of the company (404).

### Shortcuts (kept — existing pattern, mobile uses them)
`sp_ResolveTicket(@CompId, @TicketId, @ResolutionId, @Remarks, @UserId)` →
first `resolved` by `SortOrder`. `sp_CloseTicket(@CompId, @TicketId, @UserId,
@ResolutionId = NULL, @Remarks = NULL)` → first `closed`.
`sp_RejectTicket(@CompId, @TicketId, @Remarks, @UserId)` → first `rejected`.
`sp_ReopenTicket(@CompId, @TicketId, @Remarks, @UserId, @AllowReopen = 0)` →
first `open`. Each delegates to `sp_SetTicketStatus`; none writes a timestamp.

### TAT
`DueAt` is set on insert from the priority's `TatHours`. On a priority change
in `sp_SaveTicket`: anchor = `DATEADD(HOUR, -OldTat, DueAt)` when both are
known, else `CreatedAt`; `DueAt = DATEADD(HOUR, NewTat, anchor)`, or NULL
when the new priority has no TAT. On reopen: `GETDATE() + TatHours`.
**Overdue** = `Code IN ('open','onhold') AND DueAt < GETDATE()`. Returned as
`IsOverdue BIT` by every fetch; never stored.

### Transfer
`sp_TransferTicket(@CompId, @TicketId, @ToUserId = NULL, @ToBranchId = NULL,
@ReasonId, @Remarks NVARCHAR(500), @UserId)` — body of `sp_TransferLead`
minus the follow-up re-point: reason from `transfer_reason`, remarks required,
400 on no-op, sets `AssignedTo, BranchId, AssignedAt`, assignment row,
activity `assigned`, and `sp_CreateNotification(@Type='ticket_assigned',
@EntityType='ticket')` to the new assignee (skip-self built in).
`sp_BulkTransferTickets(@CompId, @TicketIdsJson, ...)` — body of
`sp_BulkTransferLeads`, returns `Transferred, Skipped`.

### Escalation
`sp_EscalateTicket(@CompId, @TicketId, @ToUserId, @Remarks NVARCHAR(1000), @UserId)`:
- ticket must be non-terminal (400 `Only open complaints can be escalated`);
  remarks required; target active in company.
- target must be an **ancestor** (`ReportsTo`, ≤ 20 hops) of the assignee —
  of the caller when unassigned. 400 `Escalation target must be a senior of the assignee`.
- writes `EscalatedTo, EscalatedAt = GETDATE()`; activity `escalated`
  (`'Escalated to X — remarks'`, meta `{toUserId, remarks}`);
  `sp_CreateNotification(@UserId=@ToUserId, @Type='ticket_escalated',
  @EntityType='ticket', @EntityId, @ActorUserId=@UserId,
  @Title='Complaint escalated', @Body=TicketNo + ' — ' + Subject + ': ' + remarks)`.
- re-escalating overwrites (a higher senior). Nothing clears it; the
  Escalated queue filters non-terminal only.

`sp_FetchEscalationTargets(@CompId, @UserId)` → the ancestor chain
(`Id, FullName, JobTitle, BranchId`) walking up from `@UserId`, nearest first.

### Delete
`sp_DeleteTicket` also removes `tblTicketAssignment`, `tblTicketStatusHistory`
and `tblCall` rows of the ticket. Controller gains the missing
`assertRecordAccess` (today any user can delete any ticket in the company by id).

## 3. Backend

### SPs
| SP | |
|---|---|
| **`sp_SaveCustomer`** `@Id, @CompId, @BranchId, @UserId, @Name, @ContactPerson, @Mobile, @AltMobile, @Email, @Address, @City, @State, @Pincode, @Remarks` | `Name` required; mobile or email required; mobile normalised (strip space/dash); 409 on another active customer with the same mobile in the company; returns `Id` |
| **`sp_FetchCustomers`** `@CompId, @PageNumber, @PageSize, @SearchTerm, @BranchId = NULL, @IsActive = 1` | company-wide (dedupe needs it). Search `Name/ContactPerson/Mobile/Email/City`. RS1 rows `+OpenTickets, TotalTickets, LastTicketAt`; RS2 pagination |
| **`sp_FetchCustomerDetail`** `@CompId, @CustomerId, @UserId, @AccessibleBranchIdsJson, @OwnerIdsJson` | RS1 customer; RS2 that customer's tickets **under the caller's scope predicate** (`Id, TicketNo, Subject, StatusName, StatusCode, PriorityName, AssigneeName, CreatedAt, ClosedAt, IsOverdue`) |
| **`sp_DeleteCustomer`** `@Id, @CompId` | soft; 409 while any ticket references it |
| `sp_SaveTicket` `@Id, @CompId, @BranchId, @UserId, @CustomerId, @Subject, @ContactPerson, @Contact, @ChannelId, @CategoryId, @Priority, @ProductId, @AssignedTo, @LinkedLeadId, @Description, @CustomJSON` | insert: `CustomerId` (active, same company — 404) + `Subject` required; status = first `open`; `DueAt`; `AssignedAt` when assigned; activity `created`; `ticket_assigned` notification when assigned to someone else. Update: **ignores `@AssignedTo`** (transfer only) and never touches status; `CustomerId` may change; priority change re-stamps `DueAt`; activity `updated`. `TicketNo` generation unchanged. |
| `sp_FetchTickets` `@CompId, @BranchId, @PageNumber, @PageSize, @SearchTerm, @StatusId, @StatusCode, @Priority, @CategoryId, @ChannelId, @ProductId, @CustomerId, @AssignedTo, @Overdue BIT = 0, @Escalated BIT = 0, @Unassigned BIT = 0, @FromDate DATE, @ToDate DATE, @UserId, @AccessibleBranchIdsJson, @OwnerIdsJson` | `@StatusCode` = a code, or `active` (open + onhold). `@Escalated` = non-terminal AND (`EscalatedTo = @UserId` OR overdue). Search `TicketNo/Subject/customer Name/Mobile/ContactPerson/Contact`. Date window on `CreatedAt`, `@ToDate` inclusive. Returns every column + `StatusName, StatusCode, PriorityName, CategoryName, ChannelName, ProductName, CustomerName, CustomerMobile, AssigneeName, AssigneeAvatar, EscalatedToName, BranchName, IsOverdue, AgeHours`. `ORDER BY IsOverdue DESC, DueAt, CreatedAt DESC`. **Scope predicate unchanged** (branch ∧ owner, OR assignee/creator). |
| `sp_FetchTicketDetail` `@CompId, @TicketId` | RS1 core + labels + `CustomerName, CustomerContactPerson, CustomerMobile, CustomerEmail, CustomerCity, PreviousTickets` (other tickets of the customer) · RS2 custom values · RS3 timeline (`+UserName, UserAvatar`) · RS4 assignment history (with names) · RS5 linked lead. `permission.js` reads `RS1[0].AssignedTo / CreatedBy / BranchId` — kept. |
| `sp_SetTicketStatus` · `sp_ResolveTicket` · `sp_CloseTicket` · **`sp_RejectTicket`** · `sp_ReopenTicket` · **`sp_TransferTicket`** · **`sp_BulkTransferTickets`** · **`sp_EscalateTicket`** · **`sp_FetchEscalationTargets`** | §2 |
| `sp_SaveLookup` `+@TatHours INT = NULL` | `ticket_status` code rule; `TatHours` stored for any kind |
| `sp_FetchLookups` | `+TatHours` |
| `sp_DeleteTicket` | §2 |
| untouched | `sp_Dashboard`, `sp_TicketsByCategory`, `sp_ResolutionSummary`, `sp_LogCall`, `sp_FetchCalls`, `sp_LogTicketActivity`, `sp_FetchAssignableUsers`, `sp_FetchAccessibleBranchIds` — none reads a stage |

### Endpoints (POST-per-action)
- **`customers`** (new router, `/api/customers`): `saveCustomer`, `fetchCustomers`, `fetchCustomerDetail`, `deleteCustomer` (`requireAdmin`).
- `tickets`: `saveTicket`, `fetchTickets`, `fetchTicketDetail`, **`setTicketStatus`**, `resolveTicket`, `closeTicket`, **`rejectTicket`**, `reopenTicket`, **`transferTicket`**, **`bulkTransferTickets`**, **`escalateTicket`**, **`fetchEscalationTargets`**, `deleteTicket`. `moveTicketStage` removed.
- `config`: `fetchPipelines`, `savePipeline`, `saveStage`, `deleteStage` removed. `saveLookup` carries `TatHours`.

### Rules (controllers on `req.scope`; tenancy in SPs)
| Action | Who |
|---|---|
| Read / edit / set status / log call | in scope, **or** assignee, **or** creator (`assertRecordAccess`) |
| Assign on create · Transfer | target ∈ `sp_FetchAssignableUsers(caller)` (`assertCanAssign`, error strings made entity-neutral); cross-branch and unassign: wide scopes only |
| Bulk transfer | per-ticket rule; batch atomic |
| **Reopen** | `canReopen(req, ticket)` = `DataScope ∈ {All, Company, MultiBranch, Branch}` **or** (`ticket.AssignedTo` ≠ caller **and** `ticket.AssignedTo ∈ req.scope.ownerIds`). Unassigned tickets: wide only. Controller passes `AllowReopen = canReopen ? 1 : 0` on every status call; the SP decides whether the move is a reopen. |
| Escalate | must see the ticket; SP validates the target is a senior |
| Delete ticket | `assertRecordAccess` (new) |
| Customers read / write | any authenticated user of the company |
| Customer delete | `requireAdmin` |

`assertRecordAccess` returns the fetched record (truthy) instead of `true`,
so `setStatus` gets the assignee without a second round-trip; existing
`if (!(await assertRecordAccess(...)))` callers are unaffected.

## 4. Web

| Screen | Change |
|---|---|
| **Tickets** `/support/tickets` (main; `/support` → it; `/support/board` → redirect) | Presets (URL-driven, like Leads): *My queue · My team · Unassigned · Overdue · Escalated · On hold · Closed · All*. Filters: status, priority, category, channel, product, assignee, branch, date range, search. Columns: No · Subject · Customer (name + mobile) · Status · Priority · **Due** (relative; red when overdue) · Assignee · ⚑ when escalated · Age. Bulk-select → **Reassign** (person + reason + remarks). Row click → detail modal. |
| **Ticket create / edit** (one modal) | Customer picker (search by mobile/name → pick, or "+ New customer" inline) · Subject · Category · Priority (shows "due by") · Channel · Product · Reported by (prefilled from customer) · Assignee (create only) · Description · custom fields · attachments. Edit: no customer-less save, no status, no assignee. |
| **Ticket detail** | Header: TicketNo · Subject · **status dropdown** (Resolve → resolution + remarks modal; Reject / Reopen → remarks modal; Close → optional remarks) · Due chip · Escalated chip. Buttons: **Log call · Transfer · Escalate**. Customer card (name, contact, mobile, email, city, "N previous complaints" → customer page). Tabs: *Details* (facts, description, custom fields, attachments) · *Timeline* (activity + calls + assignments). |
| **Customers** `/support/customers` (new) | Server table: Name · Contact · Mobile · City · Open · Total · Last complaint; search; create / edit modal; row → customer detail modal (profile + complaints list). |
| **Settings › Priorities** | `LookupMaster` shows a **TAT hours** number field for `Kind='priority'` (as it shows Code for `lead_status`). |
| **Settings › Lookups** | `+ ticket_status` (Code select: open / onhold / resolved / closed / rejected) `+ ticket_channel`. |
| **Settings › Pipelines** | Deleted, route removed. |
| **Deleted** | `TicketBoard`, `TicketCard`, `TicketColumn`, `hooks/useStageBoard`, `components/ui/BoardColumn` + its `ui/index.js` export (tickets are its last user — grep confirmed 2026-09-16), their tests. |
| `supportQueries.js` | `tickets.*` per §3, `customers.*` new; `moveTicketStage` gone; `config` re-export keeps lookups + custom fields only. |
| Sidebar / menu | `menuBuilder` icon map `+ customer`. Help guide for tickets rewritten. |
| Reports | `TicketsByCategory`, `ResolutionSummary` untouched. Support report system = follow-on spec on the `ReportPage` frame. |

`Timeline` (shared with Sales) learns the activity types
`escalated · rejected · reopened · updated` (icon + label); `assigned`,
`status`, `resolved`, `closed`, `call`, `created` already render.

## 5. Mobile

| File | Change |
|---|---|
| `api/ticketQueries.ts` | endpoints per §3 (`setTicketStatus`, `rejectTicket`, `transferTicket`, `bulkTransferTickets` not needed on mobile, `escalateTicket`, `fetchEscalationTargets`); `moveTicketStage` gone. **`api/customerQueries.ts`** new: `fetchCustomers`, `saveCustomer`. `configQueries.ts`: `fetchPipelines` removed. `types/api.ts`: `Ticket`, `Customer`, `TicketStatus` from the SP `SELECT` lists. |
| `features/support/ticketHelpers.ts` | `stageRoles`/`lifecycleOf` on stages → `lifecycleOf(ticket)` on `StatusCode`; `CHANNELS` const removed (lookup); custom-field helpers stay. |
| `useTicketRefData.ts` | pipelines out; `ticket_status`, `ticket_channel`, `transfer_reason` in. |
| **`ComplaintsScreen`** | **List, not board.** `Segmented` *Mine · Team · Overdue · Escalated*; `ChipGroup` status filter (Active · each open/onhold status · Resolved · Closed); search; `FlatList` of `ComplaintCard` (Subject, TicketNo, customer, status chip, priority, due / overdue in danger, ⚑). `Fab` → form. Refresher. `BoardColumns` stays for tasks. |
| **`ComplaintDetailScreen`** | Menu: *Change status* (ActionSheet of statuses → resolution `ComposeSheet` for Resolved; remarks `ComposeSheet` for Reject / Reopen) · *Transfer* (`ComposeSheet`: assignable user `Select` + reason `Select` + remarks) · *Escalate* (`ComposeSheet`: senior `Select` + remarks) · Log a call · Edit · Delete. Facts: Customer (name, mobile), Subject, Status, Priority, Due, Escalated to, Assigned, Category, Channel, Product. Tabs details / files / history unchanged. |
| **`ComplaintFormScreen`** | Customer: search field (mobile / name) → result list → pick; "New customer" expands name / contact person / mobile / email. Subject · Category · Priority · Channel (lookup) · Product · Reported by · Assign to (create only) · Description · custom fields. |

Gate: `pnpm typecheck` + `pnpm lint` clean. No tests (mobile exempt).

## 6. Testing

- **Backend** (mocked DB, Jest): `ticketController` rewritten — status: resolve
  without resolution (400), reject without remarks (400), reopen by a Self
  agent (`AllowReopen=0` → SP 403 surfaced), reopen by manager passes
  `AllowReopen=1`; transfer: missing remarks (400), target outside subtree
  (403), cross-branch by Team scope (403), unassign by executive (403); bulk:
  one invisible id fails the batch; escalate: non-ancestor (400 from SP), on
  a closed ticket (400); save: missing `CustomerId`/`Subject` (400), update
  drops `AssignedTo`; delete by non-viewer (403); fetch: `PageSize` ceiling
  200, preset params mapped. `customerController` new — duplicate mobile
  (409), neither mobile nor email (400), delete with tickets (409), delete
  by non-admin (403). `configController` pipeline tests removed.
  `permission.test.js` — `canReopen` matrix, `assertRecordAccess` returns
  the record. Contracts verified against the live DB after `086`.
- **Web**: every new / rewritten file ≥ 80 %, MSW. Regression tests:
  Resolve modal refuses without resolution + remarks; Reject / Reopen modal
  refuses without remarks; Transfer modal refuses without reason + remarks;
  presets map to the right query params; customer picker creates inline and
  selects the new id; `/support/board` redirects.
- **Live verification** after apply + deploy: scope matrix (Self / Team /
  Branch / Company) on `fetchTickets`, `fetchCustomerDetail` RS2, reopen
  gate, escalation ancestor rule, overdue computation — the 4a-style
  scripted pass, reported under `docs/testing/`.

## 7. Rollout

1. `backend/sql/086_support_rebuild.sql` — user applies. One script, in this
   order: `tblCustomer` + backfill → `tblTicket` columns + backfill →
   `TatHours` + seeds (`priority` TAT, `ticket_status`, `ticket_channel`) →
   status / channel / due backfill → `NOT NULL` + FKs + indexes →
   assignment + history tables + seed → new / rewritten SPs → drop pipeline
   SPs, old columns, pipeline tables → menu + duplicate-group cleanup →
   verify block (counts: customers, tickets without customer = 0, NULL status
   = 0, procs present / absent).
   **The old backend breaks at this point** (`StageId` gone) — apply and
   deploy back-to-back, as with `071`.
2. Backend deploy (user, §8 recipe).
3. Web build + deploy (user).
4. Mobile: `pnpm ios:release` / `pnpm apk` — no native change, no prebuild.
5. `077_remove_sales_demo.sql` stays pending and independent.

## 8. Docs

- `CLAUDE.md` §6 Support rewritten (status codes, TAT, escalation, reopen
  gate, customer, board gone); §3 config engine no longer mentions pipelines;
  §9 mobile: ticket-lifecycle paragraph rewritten, the stale "do not build
  call logging on a ticket" gap deleted (shipped in `067`).
- `backend/ROLES.md`: reopen / escalate rules added to the matrix.
- Notion: Done + Change Log entries with absolute dates.

## Out of scope / known

- CSAT / customer feedback · email-to-ticket · business-hours TAT ·
  scheduled jobs and overdue push notifications · customer merge ·
  a standalone Customers screen on mobile (picker only) · **lead follow-up
  TAT** (sales is in testing; not churned) · support reports (follow-on
  spec, `ReportPage` frame) · lead → customer conversion (spec 3).
- `sp_LogCall` on a ticket writes a `call` activity (since `067`); untouched.
- Attachments already support `Entity='ticket'`; untouched.
