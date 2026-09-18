# Support / Complaints Rebuild (spec 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stage-board ticketing module with a flat-status complaints module that has a real customer, a due date per priority, transfer/escalate/reopen with history, list views on web and mobile, and the pipeline engine deleted.

**Architecture:** One SQL script the owner applies by hand (`086`: `tblCustomer`, ticket columns, `ticket_status`/`ticket_channel` lookups with `Code`, `TatHours` on priority, assignment + status-history tables, one lifecycle engine `sp_SetTicketStatus`, transfer/escalate SPs, pipeline engine dropped, menu + duplicate-group cleanup). Backend gains a `customers` router and a rewritten `ticketController` that mirrors `leadController` (status / transfer / bulk / escalate) with a `canReopen` gate in `permission.js`. Web replaces the board with a preset-driven Tickets list (like Leads), a Customers page, a customer picker in the create modal, and a status-dropdown detail; mobile Phase B becomes a list with status/transfer/escalate sheets. Everything is code-driven (`StatusCode`), never label-driven.

**Tech Stack:** SQL Server (T-SQL, `CREATE OR ALTER`), Node 22 + Express 5 + mssql (Jest + Supertest), React 19 + Vite + MUI 9 + TanStack Query 5 + react-router 7 (Vitest + RTL + MSW), React Native + Expo SDK 57 + TypeScript (typecheck + eslint only).

**Spec:** `docs/superpowers/specs/2026-09-16-support-rebuild-design.md` (binding). Builds on `docs/superpowers/specs/2026-09-08-sales-foundation-hierarchy-design.md` (shipped; SQL `071`–`085` applied) and `docs/superpowers/specs/2026-09-10-sales-reports-design.md` (shipped `30626c0`).

## Global Constraints

- **pnpm only.** Never npm.
- **Git is read-only for the implementer.** Every task ends with "Stop and report" — the owner commits. Never `git add`/`commit`/`push`/`stash`/`checkout`/`rm`.
- **SQL is never applied by the implementer.** `086_support_rebuild.sql` is written to `backend/sql/` and the owner runs it by hand. Live DB reads through `mcp__sqlserver-ecrm__read_query` / `describe_table` are allowed for verification; never `write_query`/`create_table`/`alter_table`/`drop_table`/`sqlcmd`/`dbq`.
- **Test-first, ≥ 80 % line/branch on every touched file** in `backend/src/` and `web/src/`. Global floor 60 %. Never `.only`/`.skip`/`xit`. `mobile/` is exempt from tests; its gate is `pnpm typecheck` + `pnpm lint` clean.
- **Transcripts go to the session scratchpad, never `/tmp`.** Where a step redirects output, `SCRATCH` is the scratchpad directory named in your environment (`export SCRATCH=<that path>` once per shell).
- **MEMORY-SAFE test rules (verbatim, every task):** one test file per run; Bash timeout ≤ 300000; never `pnpm test`; never bare `vitest`/`jest`; never a full-suite run except Task 18 (web) and Task 10 (backend); never `pnpm build` except Task 18; max 3 attempts on a failing test then report BLOCKED.
- **Jest command shape:** `cd backend && pnpm exec jest <file> --maxWorkers=2 --silent` (add `--coverage --collectCoverageFrom='<src file>'` on the GREEN run). **Vitest command shape:** `cd web && pnpm exec vitest run <file>` (add `--coverage --coverage.include=<src file>` on the GREEN run). **Mobile:** `cd mobile && pnpm typecheck` then `pnpm lint`.
- **MUI v9**: `slotProps`, never `InputProps`/`inputProps`/`renderTags`. Use `components/ui/*` primitives (`Combobox`, `TextInput`, `DateField`, `Tabs`, `Chip`, `Button`, `Modal`, `PageHeader`, `EmptyState`) and `FormSelect`/`FormInput` — never raw MUI selects.
- **Mobile design system (CLAUDE.md §9.3–9.5):** tokens only (no colour/size literals), `Text` variants, lucide icons only, `src/ui/*` components only (`Sheet`/`ActionSheet`/`ComposeSheet`/`Select`/`Segmented`/`ChipGroup`/`Card`/`Dialog`), never RN `Alert`, solid colours only, `DateField` never `toISOString()`. `pnpm lint` enforces most of it.
- **Every route is `POST`**; every SP call carries `CompId` from `req.user` and visibility from `scopeParams(req)` (`UserId`, `AccessibleBranchIdsJson`, `OwnerIdsJson`). Never `req.user.BranchId` as a visibility filter. Write actions go through `assertRecordAccess` / `assertCanAssign` / `canReopen`.
- **Scope predicate (verbatim in every ticket fetch SP, unchanged from `080`):** `( ((@UseBranchScope = 0 OR t.BranchId IN (SELECT BranchId FROM @BranchIds)) AND (@UseOwnerScope = 0 OR t.AssignedTo IN (SELECT OwnerId FROM @OwnerIds))) OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId)) )`. Optional filters narrow inside it, never widen. `scopeJson([])` = match nothing; `null` = no filter.
- **Status codes are the only branching key.** `ticket_status.Code ∈ {open, onhold, resolved, closed, rejected}`. Active = `open|onhold`. Terminal = `resolved|closed|rejected`. Labels are the company's and editable; nothing in web/mobile/SQL matches on a label.
- **Lifecycle writes only through `sp_SetTicketStatus`** (and the `sp_SaveTicket` insert). `ResolvedAt`/`ClosedAt`/`ResolutionId`/`DueAt`-on-reopen are never written elsewhere. `tblTicketStatusHistory` is written only there.
- **Overdue is computed, never stored:** `IsOverdue = Code IN ('open','onhold') AND DueAt < GETDATE()`.
- **Live reference ids (company 1):** `priority` 1 low · 2 medium · 3 high · 4 urgent (TAT after `086`: 168 · 72 · 24 · 4); `ticket_category` 5 General · 6 Billing · 7 Technical; `resolution` 8 Fixed · 9 Won't Fix · 27 Workaround provided · 28 Not reproducible · 10 Duplicate; `transfer_reason` 36 Absent · 37 Overloaded · 38 Wrong branch · 39 Sent back to manager (`sent_back`) · 40 Reassigned by manager · 41 Other. `ticket_status` and `ticket_channel` ids are created by `086` — read them from the live DB after apply (Task 10), never hardcode in tests (tests use their own fixture ids). Branches 1 HEAD OFFICE · 2 SOUTH EXTENSION · 3 INDIRAPURAM · 4 SADHNA · 5 GOLDEN I. Groups: Owner 1 · Admin 2 · Sales Head 9 · Regional Manager 12 · Branch Manager 13 · Sales Team Lead 15 · Sales Executive 16 · Support Head 10 · Support Manager 14 · Support Agent 17; duplicate zero-member clones 18–26 are deleted by `086`. Test users: 13 sh_priya · 14 rm_arjun · 15 bm_ho_rahul · 16 tl_ho_neha · 17 se_ho_amit · 18 se_ho_sara · 19 se_ho_karan · 20 bm_se_vikram · 21 se_se_pooja · 22 se_se_dev. Menu: 17 Support (parent) · 18 Ticket Board (deleted by `086`) · 19 Tickets · 28 Pipelines (deleted) · 30 Ticket Categories · 31 Priorities · 34 Support Reports (24 / 25 children). `tblMenu` columns are `Id, ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route` (no Title/SortOrder/IsActive). `tblUser` has no `GroupId`; membership is `tblUserGroupMap`. Live data today: 57 tickets, all company 1, 38 distinct contacts, 3 tickets with NULL `Contact`, 0 ticket custom fields, 4 ticket attachments, 1 ticket call.
- **Rollout order (spec §7):** `086` → backend deploy immediately (the old backend breaks on the dropped `StageId`) → web deploy → mobile release build. `077_remove_sales_demo.sql` stays pending and independent.
- **No new dependencies** in any package.

**Spec ambiguities resolved in this plan** (each is called out again in the task that implements it):
1. `assertRecordAccess` today returns `true`; it will return the fetched record object (truthy). No caller compares with `=== true` (grep confirmed).
2. The controller always passes `AllowReopen = canReopen(req, ticket) ? 1 : 0` to `sp_SetTicketStatus` / `sp_ReopenTicket`; the SP alone decides whether the requested move *is* a reopen. Node never inspects status codes.
3. `Priority` stays an `INT` column holding the `priority` lookup `Id` (as today). The body key stays `Priority` (not `PriorityId`) so the existing web/mobile payloads keep their name.
4. Ticket `Contact` is `VARCHAR(50)` and holds phone or email; on backfill a value is a mobile when it matches `NOT LIKE '%[^0-9+ -]%'` after `LTRIM/RTRIM`, otherwise an email when it contains `@`, otherwise copied into `Remarks`.
5. `@StatusCode = 'active'` in `sp_FetchTickets` means `open` + `onhold`; every other value is matched exactly against `Code`.
6. `sp_FetchCustomerDetail` RS2 applies the ticket scope predicate, so a Self agent sees only their own complaints of that customer; the customer row itself (RS1) is company-wide.
7. `Timeline.jsx` (shared with Sales) gets the four new activity types by extending its existing type→icon map; no fork of the component.
8. Mobile has no Customers screen; `ComplaintFormScreen` embeds the search-or-create picker. `bulkTransferTickets` is web-only.
9. `BoardColumn` in `components/ui/` is exported from `components/ui/index.js`; both the file and the export line go (tickets were the last user — grep confirmed 2026-09-16). `mobile/src/ui/BoardColumns.tsx` stays (tasks use it).
10. `TicketCreateModal.jsx` becomes create **and** edit (prop `ticket` = edit) so `TicketDetail` no longer re-sends fixed columns to save custom fields; custom-field saving moves into the same modal's edit path.

---

## Contracts (every task obeys these names exactly)

### SQL — `backend/sql/086_support_rebuild.sql`, section order
```
-- ===== 1. tblCustomer + backfill
-- ===== 2. tblTicket columns + backfill (CustomerId, Subject, ChannelId, DueAt, AssignedAt, EscalatedTo/At)
-- ===== 3. tblLookup.TatHours + seeds (priority TAT, ticket_status, ticket_channel) + status/channel/due backfill
-- ===== 4. NOT NULL + FKs + indexes; tblTicketAssignment; tblTicketStatusHistory + seed
-- ===== 5. Procedures — customers (sp_SaveCustomer, sp_FetchCustomers, sp_FetchCustomerDetail, sp_DeleteCustomer)
-- ===== 6. Procedures — tickets read/write (sp_SaveTicket, sp_FetchTickets, sp_FetchTicketDetail, sp_DeleteTicket, sp_SaveLookup, sp_FetchLookups)
-- ===== 7. Procedures — lifecycle (sp_SetTicketStatus, sp_ResolveTicket, sp_CloseTicket, sp_RejectTicket, sp_ReopenTicket, sp_TransferTicket, sp_BulkTransferTickets, sp_EscalateTicket, sp_FetchEscalationTargets)
-- ===== 8. Drop pipeline engine (5 procs, 4 ticket columns, 2 tables), duplicate groups, menu rows 18 + 28, add Customers menu + grants
-- ===== 9. Verify
```
Every SP: `CREATE OR ALTER PROC dbo.<name>`, `SET NOCOUNT ON`, `GO` between batches, mutating SPs return one row `Id, ResponseCode, ResponseMess` (bulk: `Transferred, Skipped, ResponseCode, ResponseMess`; save ticket adds `TicketNo`).

**SP signatures (verbatim):**
```
sp_SaveCustomer        @Id INT = 0, @CompId INT, @BranchId INT, @UserId INT, @Name NVARCHAR(200), @ContactPerson NVARCHAR(200) = NULL, @Mobile VARCHAR(20) = NULL, @AltMobile VARCHAR(20) = NULL, @Email NVARCHAR(200) = NULL, @Address NVARCHAR(500) = NULL, @City NVARCHAR(100) = NULL, @State NVARCHAR(100) = NULL, @Pincode VARCHAR(10) = NULL, @Remarks NVARCHAR(MAX) = NULL
sp_FetchCustomers      @CompId INT, @PageNumber INT = 1, @PageSize INT = 25, @SearchTerm NVARCHAR(200) = NULL, @BranchId INT = NULL, @IsActive BIT = 1
                       RS1: Id, CompId, BranchId, BranchName, Name, ContactPerson, Mobile, AltMobile, Email, Address, City, State, Pincode, Remarks, IsActive, OpenTickets, TotalTickets, LastTicketAt, CreatedAt, UpdatedAt
                       RS2: CurrentPage, PageSize, TotalRecords, TotalPages
sp_FetchCustomerDetail @CompId INT, @CustomerId INT, @UserId INT = NULL, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL
                       RS1: customer row (same columns as sp_FetchCustomers RS1)
                       RS2: Id, TicketNo, Subject, StatusId, StatusName, StatusCode, Priority, PriorityName, AssignedTo, AssigneeName, DueAt, IsOverdue, CreatedAt, ResolvedAt, ClosedAt
sp_DeleteCustomer      @Id INT, @CompId INT                      (soft; 409 while tickets reference it)
sp_SaveTicket          @Id INT = 0, @CompId INT, @BranchId INT, @UserId INT, @CustomerId INT = NULL, @Subject NVARCHAR(200) = NULL, @ContactPerson NVARCHAR(200) = NULL, @Contact VARCHAR(100) = NULL, @ChannelId INT = NULL, @CategoryId INT = NULL, @Priority INT = NULL, @ProductId INT = NULL, @AssignedTo INT = NULL, @LinkedLeadId INT = NULL, @Description NVARCHAR(MAX) = NULL, @CustomJSON NVARCHAR(MAX) = NULL
sp_FetchTickets        @CompId INT, @BranchId INT = NULL, @PageNumber INT = 1, @PageSize INT = 25, @SearchTerm NVARCHAR(200) = NULL, @StatusId INT = NULL, @StatusCode VARCHAR(30) = NULL, @Priority INT = NULL, @CategoryId INT = NULL, @ChannelId INT = NULL, @ProductId INT = NULL, @CustomerId INT = NULL, @AssignedTo INT = NULL, @Overdue BIT = 0, @Escalated BIT = 0, @Unassigned BIT = 0, @FromDate DATE = NULL, @ToDate DATE = NULL, @UserId INT = NULL, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL
                       RS1: Id, CompId, BranchId, BranchName, TicketNo, Subject, CustomerId, CustomerName, CustomerMobile, ContactPerson, Contact, ChannelId, ChannelName, CategoryId, CategoryName, Priority, PriorityName, ProductId, ProductName, StatusId, StatusName, StatusCode, AssignedTo, AssigneeName, AssigneeAvatar, AssignedAt, DueAt, IsOverdue, AgeHours, EscalatedTo, EscalatedToName, EscalatedAt, LinkedLeadId, ResolvedAt, ClosedAt, ResolutionId, ResolutionName, Description, CreatedBy, CreatedAt, UpdatedAt
                       RS2: CurrentPage, PageSize, TotalRecords, TotalPages
sp_FetchTicketDetail   @CompId INT, @TicketId INT
                       RS1: every sp_FetchTickets RS1 column + EditBy, CustomerContactPerson, CustomerEmail, CustomerCity, CustomerAddress, PreviousTickets
                       RS2: FieldId, FieldKey, Label, Type, ValueText, ValueNumber, ValueDate
                       RS3: Id, TicketId, UserId, UserName, UserAvatar, Type, Summary, MetaJSON, CreatedAt
                       RS4: Id, FromUserId, FromUserName, ToUserId, ToUserName, FromBranchId, FromBranchName, ToBranchId, ToBranchName, ReasonId, Reason, Remarks, AssignedBy, AssignedByName, AssignedAt
                       RS5: Id, Name, MobileNo, Email, StatusId   (linked lead, empty when none)
sp_DeleteTicket        @Id INT, @CompId INT
sp_SaveLookup          @Id INT, @CompId INT, @Kind VARCHAR(30), @Value NVARCHAR(200), @SortOrder INT = 0, @Code VARCHAR(30) = NULL, @TatHours INT = NULL
sp_FetchLookups        @CompId INT, @Kind VARCHAR(30)             (+TatHours column)
sp_SetTicketStatus     @CompId INT, @TicketId INT, @StatusId INT, @UserId INT, @ResolutionId INT = NULL, @Remarks NVARCHAR(1000) = NULL, @AllowReopen BIT = 0
sp_ResolveTicket       @CompId INT, @TicketId INT, @ResolutionId INT, @Remarks NVARCHAR(1000), @UserId INT
sp_CloseTicket         @CompId INT, @TicketId INT, @UserId INT, @ResolutionId INT = NULL, @Remarks NVARCHAR(1000) = NULL
sp_RejectTicket        @CompId INT, @TicketId INT, @Remarks NVARCHAR(1000), @UserId INT
sp_ReopenTicket        @CompId INT, @TicketId INT, @Remarks NVARCHAR(1000), @UserId INT, @AllowReopen BIT = 0
sp_TransferTicket      @CompId INT, @TicketId INT, @ToUserId INT = NULL, @ToBranchId INT = NULL, @ReasonId INT, @Remarks NVARCHAR(500), @UserId INT
sp_BulkTransferTickets @CompId INT, @TicketIdsJson NVARCHAR(MAX), @ToUserId INT = NULL, @ToBranchId INT = NULL, @ReasonId INT, @Remarks NVARCHAR(500), @UserId INT
sp_EscalateTicket      @CompId INT, @TicketId INT, @ToUserId INT, @Remarks NVARCHAR(1000), @UserId INT
sp_FetchEscalationTargets @CompId INT, @UserId INT              RS1: Id, FullName, JobTitle, BranchId, BranchName, Depth (1 = direct manager)
```
Activity `Type` values written: `created · updated · status · resolved · closed · rejected · reopened · assigned · escalated · call` (last one by `sp_LogCall`, untouched).

### Backend
| Route (all POST) | Controller | Body keys read | Response `data` |
|---|---|---|---|
| `/api/customers/saveCustomer` | `customerController.save` | `Id, Name, ContactPerson, Mobile, AltMobile, Email, Address, City, State, Pincode, Remarks` | status row |
| `/api/customers/fetchCustomers` | `customerController.fetch` | `PageNumber, PageSize (≤200), SearchTerm, BranchId, IsActive` | `{ customers, pagination }` |
| `/api/customers/fetchCustomerDetail` | `customerController.detail` | `CustomerId` | `{ customer, tickets }` |
| `/api/customers/deleteCustomer` (`requireAdmin`) | `customerController.delete` | `Id` | status row |
| `/api/tickets/saveTicket` | `ticketController.save` | `Id, CustomerId, Subject, ContactPerson, Contact, ChannelId, CategoryId, Priority, ProductId, AssignedTo (create only), LinkedLeadId, Description, CustomJSON` | status row `+TicketNo` |
| `/api/tickets/fetchTickets` | `ticketController.fetch` | `BranchId, PageNumber, PageSize (≤200), SearchTerm, StatusId, StatusCode, Priority, CategoryId, ChannelId, ProductId, CustomerId, AssignedTo, Overdue, Escalated, Unassigned, FromDate, ToDate` | `{ tickets, pagination }` |
| `/api/tickets/fetchTicketDetail` | `ticketController.detail` | `TicketId` | `{ ticket, fields, activity, assignments, linkedLead }` |
| `/api/tickets/setTicketStatus` | `ticketController.setStatus` | `TicketId, StatusId, ResolutionId, Remarks` | status row |
| `/api/tickets/resolveTicket` · `closeTicket` · `rejectTicket` · `reopenTicket` | `resolve` · `close` · `reject` · `reopen` | `TicketId, ResolutionId, Remarks` (as each SP takes) | status row |
| `/api/tickets/transferTicket` | `ticketController.transfer` | `TicketId, ToUserId, ToBranchId, ReasonId, Remarks` | status row |
| `/api/tickets/bulkTransferTickets` | `ticketController.bulkTransfer` | `TicketIds[], ToUserId, ToBranchId, ReasonId, Remarks` | `{ Transferred, Skipped }` row |
| `/api/tickets/escalateTicket` | `ticketController.escalate` | `TicketId, ToUserId, Remarks` | status row |
| `/api/tickets/fetchEscalationTargets` | `ticketController.escalationTargets` | `ForUserId` (default caller) | `{ users }` |
| `/api/tickets/deleteTicket` | `ticketController.delete` | `Id` | status row |
| removed | `/api/tickets/moveTicketStage`, `/api/config/fetchPipelines`, `savePipeline`, `saveStage`, `deleteStage` | | |

`permission.js` exports gain `canReopen(req, record)`; `assertRecordAccess` resolves to the record object; `assertCanAssign` messages read "record", not "lead". `responseHelper.success(res, message, data)` / `.error(res, message, code, httpStatus)` unchanged.

### Web
| File | Exports / role |
|---|---|
| `web/src/api/supportQueries.js` | `SUPPORT_ENDPOINTS.tickets.{saveTicket, fetchTickets, fetchTicketDetail, setTicketStatus, resolveTicket, closeTicket, rejectTicket, reopenTicket, transferTicket, bulkTransferTickets, escalateTicket, fetchEscalationTargets, deleteTicket}`, `SUPPORT_ENDPOINTS.customers.{saveCustomer, fetchCustomers, fetchCustomerDetail, deleteCustomer}`, `SUPPORT_ENDPOINTS.reports` unchanged, `config` re-export (lookups + custom fields only), `calls` re-export |
| `web/src/pages/Support/ticketStatus.js` | `TICKET_PRESETS` (`[{value,label}]`: `mine, team, unassigned, overdue, escalated, onhold, closed, all`), `presetParams(preset, userId)`, `ticketsParamsToState(searchParams)`, `isActiveCode(code)`, `isTerminalCode(code)`, `statusTone(code)` (`open→info, onhold→warning, resolved→success, closed→default, rejected→error`), `dueLabel(dueAt, isOverdue, now)` |
| `web/src/pages/Support/Tickets.jsx` | default export page |
| `web/src/pages/Support/TicketCreateModal.jsx` | `TicketCreateModal({ open, onClose, ticket = null, onSaved })` — create + edit |
| `web/src/pages/Support/TicketDetail.jsx` · `TicketDetailModal.jsx` | as today, rewritten |
| `web/src/pages/Support/ResolveTicketModal.jsx` | `ResolveTicketModal({ open, onClose, ticket, status, onDone })` — resolution + remarks. `status` is the picked `{value,label,code}`: a company may configure two `resolved`-coded statuses, so the modal is told which one was chosen rather than guessing |
| `web/src/pages/Support/RemarksModal.jsx` | `RemarksModal({ open, onClose, title, subtitle, submitLabel = "Save", required = true, onSubmit(remarks), busy = false })` — used for reject / reopen / close / on-hold; owns no endpoint |
| `web/src/pages/Support/TransferTicketModal.jsx` | `TransferTicketModal({ open, onClose, ticketIds, onDone })` — person + reason + remarks; `ticketIds.length > 1` → bulk |
| `web/src/pages/Support/EscalateTicketModal.jsx` | `EscalateTicketModal({ open, onClose, ticket, onDone })` |
| `web/src/pages/Support/CustomerPicker.jsx` | `CustomerPicker({ value, onChange, error })` — async `Combobox` on `fetchCustomers {SearchTerm}` + "+ New customer" → `CustomerFormModal` |
| `web/src/pages/Support/CustomerFormModal.jsx` | `CustomerFormModal({ open, onClose, customer = null, onSaved(customerRow) })` |
| `web/src/pages/Support/Customers.jsx` · `CustomerDetailModal.jsx` | page + modal |
| deleted | `TicketBoard.jsx`, `TicketCard.jsx`, `TicketColumn.jsx`, `hooks/useStageBoard.jsx`, `components/ui/BoardColumn.jsx`, `pages/Settings/Pipelines.jsx` (+ all their tests) |

Routes in `App.jsx`: `/support` → `/support/tickets`; `/support/board` → `<Navigate to="/support/tickets" replace />`; `/support/tickets`, `/support/tickets/:ticketId`, `/support/customers`; `/settings/pipelines` removed.

### Mobile
| File | Exports / role |
|---|---|
| `mobile/src/api/ticketQueries.ts` | `TICKET_ENDPOINTS` per Backend table; `fetchTickets(params)`, `fetchTicketDetail(id)`, `saveTicket(payload)`, `setTicketStatus({TicketId, StatusId, ResolutionId?, Remarks?})`, `resolveTicket`, `closeTicket`, `rejectTicket`, `reopenTicket`, `transferTicket`, `escalateTicket`, `fetchEscalationTargets(forUserId?)`, `deleteTicket` |
| `mobile/src/api/customerQueries.ts` | `fetchCustomers({SearchTerm, PageSize})`, `saveCustomer(payload)` |
| `mobile/src/types/api.ts` | `Ticket`, `TicketDetail`, `TicketAssignment`, `Customer`, `TicketStatusCode = "open" \| "onhold" \| "resolved" \| "closed" \| "rejected"`, `Lookup` gains `TatHours?: number \| null` |
| `mobile/src/features/support/ticketHelpers.ts` | `lifecycleOf(ticket)`, `isActive(code)`, `isTerminal(code)`, `statusTone(code)`, `priorityTone(name)`, `dueLabel(ticket, now)`, custom-field helpers unchanged |
| `mobile/src/features/support/useTicketRefData.ts` | statuses, categories, priorities, channels, resolutions, transferReasons, callOutcomes, users |
| screens | `ComplaintsScreen`, `ComplaintDetailScreen`, `ComplaintFormScreen`, `ComplaintCard` rewritten |

---

## File structure

**SQL — create (`backend/sql/`, user-applied, deleted after apply)**
| File | Responsibility |
|---|---|
| `086_support_rebuild.sql` | everything in spec §1–§2 + §7 step 1, in the section order above |

**Backend — create**
| File | Responsibility |
|---|---|
| `backend/src/controllers/customerController.js` | `save`, `fetch`, `detail`, `delete` |
| `backend/src/routes/customerRoutes.js` | 4 routes; `verifyToken, loadScope`; `requireAdmin` on delete |
| `backend/tests/unit/controllers/customerController.test.js` | |
| `backend/tests/unit/routes/customerRoutes.test.js` | |

**Backend — modify**
| File | Change |
|---|---|
| `backend/src/middleware/permission.js` | `+canReopen`; `assertRecordAccess` returns record; neutral `assertCanAssign` strings |
| `backend/src/controllers/ticketController.js` | rewritten: `save, fetch, detail, setStatus, resolve, close, reject, reopen, transfer, bulkTransfer, escalate, escalationTargets, delete` |
| `backend/src/routes/ticketRoutes.js` | routes per Contracts |
| `backend/src/controllers/configController.js` · `routes/configRoutes.js` | pipeline methods/routes removed; `saveLookup` forwards `TatHours` |
| `backend/src/config/routes.js` | `+ /api/customers` |
| `backend/tests/unit/middleware/permission.test.js` · `controllers/ticketController.test.js` · `controllers/configController.test.js` · `routes/ticketRoutes.test.js` (if present) | updated |

**Web — create / modify / delete:** per Contracts table. Plus `web/src/App.jsx`, `web/src/utils/menuBuilder.js` (`customer` icon), `web/src/data/helpGuides.js` (tickets guide), `web/src/pages/Sales/Timeline.jsx` (4 activity types), `web/src/pages/Settings/LookupMaster.jsx` (`TatHours` field for `priority`), `web/src/pages/Settings/Lookups.jsx` (`ticket_status` with Code, `ticket_channel`), `web/src/components/ui/index.js` (drop `BoardColumn`), MSW handlers in the test setup.

**Mobile — modify:** per Contracts table, plus `mobile/src/api/configQueries.ts` (`fetchPipelines` removed), `mobile/src/navigation/RootNavigator.tsx` (unchanged routes, verify types).

**Docs:** `CLAUDE.md` §3/§6/§9, `backend/ROLES.md`, Notion.

---

## Task index

| # | Task | Layer |
|---|---|---|
| 1 | `086` part A — customers, ticket columns, lookups + seeds, backfills, constraints, history/assignment tables, drops, menu + group cleanup, verify (sections 1–4, 8, 9) | SQL |
| 2 | `086` part B — customer + ticket read/write SPs (sections 5–6) | SQL |
| 3 | `086` part C — lifecycle SPs (section 7) | SQL |
| 4 | `permission.js`: `canReopen`, `assertRecordAccess` returns record, neutral strings | Backend |
| 5 | `customerController` + routes + registration | Backend |
| 6 | `ticketController.save / fetch / detail` | Backend |
| 7 | `ticketController.setStatus / resolve / close / reject / reopen` | Backend |
| 8 | `ticketController.transfer / bulkTransfer / escalate / escalationTargets / delete` + routes | Backend |
| 9 | `configController`: pipelines out, `TatHours` in | Backend |
| 10 | Backend whole suite + **live contract check after the owner applies `086`** | Backend |
| 11 | `supportQueries.js`, `ticketStatus.js`, MSW handlers | Web |
| 12 | Board + pipelines deletion, routes/redirects, menu icon, help guide | Web |
| 13 | Customers: `CustomerFormModal`, `CustomerPicker`, `Customers` page, `CustomerDetailModal` | Web |
| 14 | `Tickets.jsx` list + `TransferTicketModal` | Web |
| 15 | `TicketCreateModal` (create + edit, customer picker) | Web |
| 16 | `TicketDetail` + `ResolveTicketModal` + `RemarksModal` + `EscalateTicketModal` + `Timeline` types | Web |
| 17 | Settings: `LookupMaster` TAT hours, `Lookups` kinds | Web |
| 18 | Web whole suite, lint, build | Web |
| 19 | Mobile API layer + types | Mobile |
| 20 | `ticketHelpers` + `useTicketRefData` | Mobile |
| 21 | `ComplaintsScreen` list + `ComplaintCard` | Mobile |
| 22 | `ComplaintDetailScreen` | Mobile |
| 23 | `ComplaintFormScreen` | Mobile |
| 24 | Mobile typecheck + lint gate | Mobile |
| 25 | Docs: `CLAUDE.md`, `ROLES.md`, Notion, deploy commands | Docs |
| 26 | Live verification pass after deploy → `docs/testing/2026-09-XX-support-live-test-report.md` | Verify |

---

### Task 1: `086` part A — customers, ticket columns, lookups + seeds, backfills, constraints, history/assignment tables, drops, menu + group cleanup, verify (sections 1–4, 8, 9)

**Files:**
- Create: `backend/sql/086_support_rebuild.sql` (this task writes the header, §1–§4, the bare `-- ===== 5.` / `-- ===== 6.` / `-- ===== 7.` marker lines, §8 and §9; **Task 2 inserts its procs directly under the §5 and §6 markers, Task 3 under the §7 marker** — the markers are written here so the three tasks never fight over position)
- Test: no local SQL execution exists. The gate is (a) read-only MCP checks of the objects this script changes (Step 1), (b) `grep -n` read-back of markers + `GO` batching (Step 3), (c) the §9 verify block the owner runs after apply (Step 4).

**Interfaces:**
- Consumes (live, verified 2026-09-16 on `eCRM+`, SQL Server 2019 **Express** 15.0.2000.5, collation `SQL_Latin1_General_CP1_CI_AS`): `dbo.tblTicket (Id, CompId, BranchId, TicketNo VARCHAR(30), CustomerName NVARCHAR(300), Contact VARCHAR(50), Channel VARCHAR(20), CategoryId, Priority, PipelineId, StageId, AssignedTo, LinkedLeadId, ResolvedAt, ClosedAt, ResolutionId, Description, CreatedBy, EditBy, CreatedAt, UpdatedAt, ContactPerson NVARCHAR(400))` with index `IX_tblTicket_CompId_StageId`; `dbo.tblLookup (Id PK, CompId, Kind VARCHAR(30), Value NVARCHAR(400), SortOrder, IsActive, Code VARCHAR(30))` with `UQ_tblLookup_CompId_Kind_Value`; `dbo.tblPipelineStage (Id, CompId, PipelineId, Name, SortOrder, StageType, Color, IsActive)`; `dbo.tblPipeline`; `dbo.tblGroupAccess (Id, GroupId, MenuId, CanAdd, CanEdit, CanDelete, CanView)`; `dbo.tblUserGroups (Id, Name, Description, IsActive, CompId BIGINT, BranchId, CreatedDate, HierarchyLevel, DataScope, IsAdmin)`; `dbo.tblUserGroupMap (Id, UserId, GroupId)`; `dbo.tblMenu (Id IDENTITY, ParentId, Description VARCHAR(200), Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route NVARCHAR(400))`. **No table in this DB carries a foreign key today** (`sys.foreign_keys` is empty for every table touched here); `GroupId` appears only in `tblGroupAccess` and `tblUserGroupMap`.
- Produces: `dbo.tblCustomer`; `dbo.tblTicket` + `CustomerId INT NOT NULL`, `Subject NVARCHAR(200) NOT NULL`, `StatusId INT NOT NULL`, `ProductId INT NULL`, `ChannelId INT NULL`, `DueAt DATETIME NULL`, `AssignedAt DATETIME NULL`, `EscalatedTo INT NULL`, `EscalatedAt DATETIME NULL`, `Contact` widened to `VARCHAR(100)`; `dbo.tblLookup.TatHours INT NULL`; lookups `ticket_status` (New/open · In Progress/open · On Hold/onhold · Resolved/resolved · Closed/closed · Rejected/rejected) and `ticket_channel` (Phone · WhatsApp · Email · Web · Chat · Walk-in) for **every** `CompId`; `dbo.tblTicketAssignment`; `dbo.tblTicketStatusHistory` (seeded); FKs `FK_tblTicket_CustomerId`, `FK_tblTicket_StatusId`; indexes `IX_tblTicket_CompId_StatusId / _AssignedTo / _CustomerId / _DueAt`; dropped: 5 pipeline procs, `IX_tblTicket_CompId_StageId`, columns `PipelineId/StageId/CustomerName/Channel`, tables `tblPipelineStage/tblPipeline`, duplicate zero-member groups, menu rows `/support/board` + `/settings/pipelines`; added menu row `/support/customers` under `/support` with the `/support/tickets` grants. Tasks 2–3 write procs against exactly these columns; Task 10 reads the new lookup ids from the live DB.

**Decisions taken in this task (spec silent or open):**
1. **FKs: two, not four.** `sp_DeleteLookup` and `sp_DeleteProduct` are both **soft** deletes (`IsActive = 0`, read live), so a hard FK cannot be tripped by the app. FKs go on the two `NOT NULL` columns whose dangling value would break every fetch's `JOIN`: `CustomerId → tblCustomer(Id)` and `StatusId → tblLookup(Id)`. `ProductId` / `ChannelId` are nullable, `LEFT JOIN`ed, and stay FK-less like every other optional id in this DB (house style: "integrity lives in SPs", `sp_DeleteLead`). `sp_DeleteCustomer` is soft + 409-guarded (Task 2), so `FK_tblTicket_CustomerId` is never hit either.
2. **Customer dedupe key is the normalised value, not the raw string.** Two `Contact` spellings that normalise to the same mobile (`'+91 93105 00657'` and `'+919310500657'`) must become one customer, or the filtered unique index `UX_tblCustomer_CompId_Mobile` fails on insert. Key = `M:<digits>` · `E:<lower email>` · `R:<raw>` (copied to `Remarks`) · `N:<CustomerName>` when `Contact` is NULL. Name/ContactPerson/Branch/CreatedBy/CreatedAt come from the earliest ticket of the key.
3. **`tblTicket.CustomerId` is added in §1, not §2**, because §1's backfill sets it in the same transaction that creates the customers (the spec lists "then tblTicket.CustomerId set by the same key" under the customer backfill). §2 adds the remaining columns.
4. **`Contact` widened `VARCHAR(50) → VARCHAR(100)`** to match the SP contract (`@Contact VARCHAR(100)`, which the current `sp_SaveTicket` already declares — a 60-char value would truncate-error today).
5. **History seed gets two extra best-effort rows** beyond the spec's four: a Closed ticket that was never Resolved gets `New → Closed` (not `Resolved → Closed`, which would name a status it never held); an active ticket sitting in In Progress / On Hold gets `New → <current>` at `UpdatedAt`, so the last history row always equals the ticket's status (the funnel report family relies on that invariant).
6. **Menu rows are matched by `Route`, never by `Id`** (`/support/board`, `/settings/pipelines`, `/support`, `/support/tickets`) — the script also runs on SolarCRM.
7. **Halting.** Every backfill batch is `TRY / TRANSACTION / assert / COMMIT`; the `CATCH` rolls back, re-raises with the section number and `SET NOEXEC ON`, so nothing below runs. The last batch is `SET NOEXEC OFF`. §8 additionally refuses to drop columns while any module still references `StageId` / `PipelineId` / `tblPipeline` — applying the file before Tasks 2–3 filled §5–§7 stops there, harmlessly.
8. **Full re-run caveat.** §3.4 / §3.5 read `StageId` / `Channel` / `tblPipelineStage`; after §8 drops them a *complete* re-run makes those two batches fail to compile (skipped, nothing left to backfill). A *partial* re-run — the stated requirement — is safe everywhere.
9. **Duplicate-group rule is data-driven**: zero `tblUserGroupMap` members **and** same `Name` + `CompId` as a lower-`Id` row. On eCRM+ that is exactly ids 18–26 (184 grant rows); on SolarCRM it is whatever the clone carries.

- [ ] **Step 1: Read-only pre-checks against the live DB (the "before" state — every line must come back as shown, or the script's assumptions are wrong)**

Run each with `mcp__sqlserver-ecrm__read_query`:

```sql
-- (1) nothing this script creates exists yet: expect three NULLs
SELECT OBJECT_ID('dbo.tblCustomer') AS Cust, OBJECT_ID('dbo.tblTicketAssignment') AS TA, OBJECT_ID('dbo.tblTicketStatusHistory') AS TSH;

-- (2) the stage index exists and no FK exists anywhere near tblTicket: expect 1 row / 0 rows
SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'IX_tblTicket_CompId_StageId';
SELECT COUNT(*) AS Fks FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.tblTicket') OR referenced_object_id IN (OBJECT_ID('dbo.tblLookup'), OBJECT_ID('dbo.tblPipelineStage'), OBJECT_ID('dbo.tblPipeline'));

-- (3) the lookups the seeds match on: priority values are lowercase low/medium/high/urgent, no ticket_status / ticket_channel yet
SELECT Kind, Value, Code, SortOrder FROM dbo.tblLookup WHERE Kind IN ('priority','ticket_status','ticket_channel') ORDER BY Kind, SortOrder;

-- (4) the channel strings the backfill maps: expect chat/email/phone/whatsapp
SELECT Channel, COUNT(*) N FROM dbo.tblTicket GROUP BY Channel;

-- (5) the stages the status backfill maps: expect New/Assigned/In-Progress (open), Resolved/Closed (won), Rejected (lost)
SELECT Id, Name, StageType, SortOrder FROM dbo.tblPipelineStage ORDER BY CompId, SortOrder;

-- (6) the ticket population: expect 57 tickets, 3 NULL Contact, 3 NULL Priority, 8 empty Description
SELECT COUNT(*) Tickets, SUM(CASE WHEN Contact IS NULL THEN 1 ELSE 0 END) NullContact,
       SUM(CASE WHEN Priority IS NULL THEN 1 ELSE 0 END) NullPriority,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(Description)),'') IS NULL THEN 1 ELSE 0 END) EmptyDesc
FROM dbo.tblTicket;

-- (7) the duplicate groups: expect ids 18..26, all Members = 0
SELECT g.Id, g.Name, (SELECT COUNT(*) FROM dbo.tblUserGroupMap m WHERE m.GroupId = g.Id) Members
FROM dbo.tblUserGroups g
WHERE EXISTS (SELECT 1 FROM dbo.tblUserGroups o WHERE o.Name = g.Name AND ISNULL(o.CompId,-1) = ISNULL(g.CompId,-1) AND o.Id < g.Id)
ORDER BY g.Id;

-- (8) the menu rows: expect 17 /support (ParentId 0), 18 /support/board, 19 /support/tickets, 28 /settings/pipelines
SELECT Id, ParentId, Description, Route FROM dbo.tblMenu WHERE Route IN ('/support','/support/board','/support/tickets','/settings/pipelines','/support/customers') ORDER BY Id;

-- (9) every module that reads what §8 drops — expect exactly these 11:
--     sp_CloseTicket, sp_DeleteStage, sp_FetchPipelines, sp_FetchTicketDetail, sp_FetchTickets,
--     sp_MoveTicketStage, sp_ReopenTicket, sp_ResolveTicket, sp_SavePipeline, sp_SaveStage, sp_SaveTicket
SELECT o.name FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%tblPipeline%' OR m.definition LIKE '%StageId%' OR m.definition LIKE '%PipelineId%'
ORDER BY o.name;

-- (10) the delete mode of the FK targets: both bodies must contain "IsActive = 0", neither a DELETE
SELECT o.name, CASE WHEN m.definition LIKE '%DELETE FROM%' THEN 'HARD' ELSE 'soft' END AS mode
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE o.name IN ('sp_DeleteLookup','sp_DeleteProduct');
```

Expected: (1) three `null`; (2) `IX_tblTicket_CompId_StageId` / `Fks = 0`; (3) four `priority` rows `low medium high urgent`, no other kinds; (4) `chat 1, email 1, phone 54, whatsapp 1`; (5) six stages as listed; (6) `57 / 3 / 3 / 8`; (7) ids 18–26 with `Members 0`; (8) rows 17, 18, 19, 28 and **no** `/support/customers`; (9) the 11 names; (10) both `soft`. If (9) lists anything else, that module must be rewritten before §8 runs — report it and stop.

- [ ] **Step 2: Write the file — header, §1–§4, bare §5–§7 markers, §8, §9**

```sql
-- ============================================================================
-- 086_support_rebuild.sql
--
-- Spec 2 — the support / complaints rebuild.
-- Design: docs/superpowers/specs/2026-09-16-support-rebuild-design.md
--
-- What changes and why:
--   * tblCustomer — a complaint finally belongs to someone. One row per
--     distinct contact (mobile / email), backfilled from the loose strings on
--     tblTicket; tblTicket.CustomerId is NOT NULL after the backfill.
--   * tblTicket — Subject, StatusId (flat ticket_status lookup with Code),
--     ProductId, ChannelId (ticket_channel lookup), DueAt (TAT per priority),
--     AssignedAt, EscalatedTo/At. PipelineId, StageId, CustomerName, Channel
--     are dropped once every proc that read them is rewritten (§5–§7).
--   * tblLookup.TatHours — hours to due date per priority (urgent 4 · high 24
--     · medium 72 · low 168, editable per company in Settings › Priorities).
--   * tblTicketAssignment / tblTicketStatusHistory — transfer and status
--     history, same shape as the lead tables; history seeded from timestamps.
--   * One lifecycle engine, sp_SetTicketStatus, plus transfer / bulk /
--     escalate procs mirroring the lead ones. The pipeline engine (5 procs,
--     2 tables) is gone — tickets were its last user.
--   * Cleanup: zero-member duplicate role rows, the Ticket Board and
--     Pipelines menu rows; a Customers menu row cloned from Tickets' grants.
--
-- Runs on BOTH databases (eCRM+ and its clone SolarCRM): nothing hardcodes a
-- company id or a menu id — seeds fan out over every CompId present, menu
-- rows are matched by Route.
--
-- APPLY BY HAND, top to bottom, in one go. Idempotent for a PARTIAL re-run:
-- every ALTER/DROP is guarded, backfills touch NULL columns only, seeds use
-- NOT EXISTS, procs are CREATE OR ALTER. Each backfill runs in a transaction
-- and asserts; on failure it rolls back, re-raises, and SET NOEXEC ON stops
-- everything below it (the last batch turns NOEXEC OFF). A FULL re-run after
-- §8 has dropped StageId/Channel/tblPipelineStage makes §3.4 / §3.5 fail to
-- compile — nothing is left to backfill by then; the assertions still hold.
--
-- Sections: 1 tblCustomer + backfill · 2 tblTicket columns + backfill ·
-- 3 TatHours + seeds + status/channel/due backfill · 4 NOT NULL + FKs +
-- indexes + assignment/history tables + seed · 5 customer procs · 6 ticket
-- read/write procs · 7 lifecycle procs · 8 drop pipeline engine + cleanup +
-- menu · 9 verify.
--
-- §8 drops columns the OLD procs read. It refuses to run while any module
-- still references StageId / PipelineId / tblPipeline — so applying this file
-- before §5–§7 are filled in stops safely there.
--
-- The old backend breaks the moment §8 runs (StageId gone) — deploy the new
-- backend immediately after, as with 071.
--
-- Author: Claude  Date: 2026-09-16
-- ============================================================================
SET NOEXEC OFF;
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO


-- ===== 1. tblCustomer + backfill
-- ---------------------------------------------------------------------------
-- 1.1 table
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblCustomer') IS NULL
BEGIN
    CREATE TABLE dbo.tblCustomer (
        Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblCustomer PRIMARY KEY,
        CompId        INT           NOT NULL,
        BranchId      INT           NOT NULL,                 -- the creating user's branch
        Name          NVARCHAR(200) NOT NULL,                 -- the business, or the person
        ContactPerson NVARCHAR(200) NULL,                     -- who to speak to when Name is a business
        Mobile        VARCHAR(20)   NULL,                     -- digits and + only (sp_SaveCustomer normalises)
        AltMobile     VARCHAR(20)   NULL,
        Email         NVARCHAR(200) NULL,
        Address       NVARCHAR(500) NULL,
        City          NVARCHAR(100) NULL,
        State         NVARCHAR(100) NULL,
        Pincode       VARCHAR(10)   NULL,
        Remarks       NVARCHAR(MAX) NULL,
        IsActive      BIT           NOT NULL CONSTRAINT DF_tblCustomer_IsActive DEFAULT 1,   -- soft delete
        CreatedBy     INT           NULL,
        CreatedAt     DATETIME      NOT NULL CONSTRAINT DF_tblCustomer_CreatedAt DEFAULT GETDATE(),
        EditBy        INT           NULL,
        UpdatedAt     DATETIME      NULL
    );
    -- One live customer per mobile per company. Filtered, so a soft-deleted
    -- row does not block re-creating the same number.
    CREATE UNIQUE NONCLUSTERED INDEX UX_tblCustomer_CompId_Mobile
        ON dbo.tblCustomer (CompId, Mobile) WHERE IsActive = 1 AND Mobile IS NOT NULL;
    CREATE INDEX IX_tblCustomer_CompId_Name ON dbo.tblCustomer (CompId, Name);
END
GO

-- The backfill below sets this column, so it is added here rather than in §2.
IF COL_LENGTH('dbo.tblTicket', 'CustomerId') IS NULL
    ALTER TABLE dbo.tblTicket ADD CustomerId INT NULL;
GO

-- ---------------------------------------------------------------------------
-- 1.2 backfill — one customer per distinct real-world key, not per spelling
--
--   Contact is a free VARCHAR(50) holding a phone, an email, or a name. It is
--   classed (spec ambiguity 4):
--     mobile  : no character outside 0-9 + space -   -> 'M:' + digits ('+' kept, spaces/dashes stripped)
--     email   : contains @                           -> 'E:' + lower(contact)
--     other   : anything else                        -> 'R:' + contact   (copied to Remarks)
--     NULL    : no contact at all                    -> 'N:' + CustomerName
--   Keying on the NORMALISED mobile is what lets UX_tblCustomer_CompId_Mobile
--   hold: '+91 93105 00657' and '+919310500657' are one customer.
--   Name / ContactPerson / Branch / CreatedBy / CreatedAt come from the
--   EARLIEST ticket of the key. Only tickets with CustomerId IS NULL take
--   part, so a re-run after success does nothing. One transaction: either
--   every ticket has a customer at the end or nothing changed.
-- ---------------------------------------------------------------------------
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('tempdb..#TicketKey') IS NOT NULL DROP TABLE #TicketKey;

    SELECT t.Id AS TicketId, t.CompId, t.BranchId, t.CreatedBy, t.CreatedAt,
           LEFT(NULLIF(LTRIM(RTRIM(t.CustomerName)),  N''), 200) AS CustomerName,
           LEFT(NULLIF(LTRIM(RTRIM(t.ContactPerson)), N''), 200) AS ContactPerson,
           c.Contact,
           CASE WHEN c.Contact IS NULL                       THEN 'N'
                WHEN c.Contact NOT LIKE '%[^0-9+ -]%'        THEN 'M'   -- '-' last in the class = literal
                WHEN c.Contact LIKE '%@%'                    THEN 'E'
                ELSE 'R' END AS Kind,
           CAST(CASE WHEN c.Contact IS NULL                THEN N'N:' + ISNULL(LTRIM(RTRIM(t.CustomerName)), N'')
                     WHEN c.Contact NOT LIKE '%[^0-9+ -]%' THEN N'M:' + REPLACE(REPLACE(c.Contact, ' ', ''), '-', '')
                     WHEN c.Contact LIKE '%@%'             THEN N'E:' + LOWER(c.Contact)
                     ELSE N'R:' + c.Contact END AS NVARCHAR(400)) AS CustKey
    INTO #TicketKey
    FROM dbo.tblTicket t
    CROSS APPLY (SELECT NULLIF(LTRIM(RTRIM(t.Contact)), '') AS Contact) c
    WHERE t.CustomerId IS NULL;

    DECLARE @Map TABLE (CustomerId INT NOT NULL, CompId INT NOT NULL, CustKey NVARCHAR(400) NOT NULL);

    -- MERGE, not INSERT: only MERGE's OUTPUT may carry a SOURCE column, and
    -- the key is needed back to point the tickets at their new customer.
    ;WITH first_ticket AS (
        SELECT k.*, ROW_NUMBER() OVER (PARTITION BY k.CompId, k.CustKey ORDER BY k.CreatedAt, k.TicketId) AS rn
        FROM #TicketKey k
    )
    MERGE dbo.tblCustomer AS tgt
    USING (SELECT * FROM first_ticket WHERE rn = 1) AS src
       ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (CompId, BranchId, Name, ContactPerson, Mobile, Email, Remarks, IsActive, CreatedBy, CreatedAt)
        VALUES (src.CompId, src.BranchId,
                ISNULL(src.CustomerName, N'Unknown customer'),
                src.ContactPerson,
                CASE WHEN src.Kind = 'M' THEN LEFT(SUBSTRING(src.CustKey, 3, 400), 20) END,
                CASE WHEN src.Kind = 'E' THEN LEFT(src.Contact, 200) END,
                CASE WHEN src.Kind = 'R' THEN N'Contact on legacy complaints: ' + src.Contact END,
                1, src.CreatedBy, src.CreatedAt)
    OUTPUT inserted.Id, src.CompId, src.CustKey INTO @Map (CustomerId, CompId, CustKey);

    UPDATE t SET CustomerId = m.CustomerId
    FROM dbo.tblTicket t
    JOIN #TicketKey k ON k.TicketId = t.Id
    JOIN @Map m ON m.CompId = k.CompId AND m.CustKey = k.CustKey;

    IF EXISTS (SELECT 1 FROM dbo.tblTicket WHERE CustomerId IS NULL)
        RAISERROR('tickets without a customer remain after the backfill', 16, 1);

    DROP TABLE #TicketKey;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m1 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('086 §1 ABORTED — %s', 16, 1, @m1);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 2. tblTicket columns + backfill (CustomerId, Subject, ChannelId, DueAt, AssignedAt, EscalatedTo/At)
-- CustomerId was added and filled in §1. StatusId / ChannelId / DueAt are
-- added here and filled in §3 once their lookups exist.
IF COL_LENGTH('dbo.tblTicket', 'Subject')     IS NULL ALTER TABLE dbo.tblTicket ADD Subject     NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.tblTicket', 'StatusId')    IS NULL ALTER TABLE dbo.tblTicket ADD StatusId    INT           NULL;
IF COL_LENGTH('dbo.tblTicket', 'ProductId')   IS NULL ALTER TABLE dbo.tblTicket ADD ProductId   INT           NULL;
IF COL_LENGTH('dbo.tblTicket', 'ChannelId')   IS NULL ALTER TABLE dbo.tblTicket ADD ChannelId   INT           NULL;
IF COL_LENGTH('dbo.tblTicket', 'DueAt')       IS NULL ALTER TABLE dbo.tblTicket ADD DueAt       DATETIME      NULL;
IF COL_LENGTH('dbo.tblTicket', 'AssignedAt')  IS NULL ALTER TABLE dbo.tblTicket ADD AssignedAt  DATETIME      NULL;
IF COL_LENGTH('dbo.tblTicket', 'EscalatedTo') IS NULL ALTER TABLE dbo.tblTicket ADD EscalatedTo INT           NULL;
IF COL_LENGTH('dbo.tblTicket', 'EscalatedAt') IS NULL ALTER TABLE dbo.tblTicket ADD EscalatedAt DATETIME      NULL;
-- The proc contract takes @Contact VARCHAR(100); the column was VARCHAR(50).
IF COL_LENGTH('dbo.tblTicket', 'Contact') < 100 ALTER TABLE dbo.tblTicket ALTER COLUMN Contact VARCHAR(100) NULL;
GO

-- 2.1 Subject from the description (first 200 chars), else 'Complaint <TicketNo>';
--     AssignedAt = CreatedAt wherever someone is assigned (best effort).
BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE dbo.tblTicket
    SET Subject = CASE WHEN NULLIF(LTRIM(RTRIM(Description)), N'') IS NULL
                       THEN N'Complaint ' + TicketNo
                       ELSE LEFT(LTRIM(RTRIM(Description)), 200) END
    WHERE Subject IS NULL;

    UPDATE dbo.tblTicket SET AssignedAt = CreatedAt
    WHERE AssignedTo IS NOT NULL AND AssignedAt IS NULL;

    IF EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Subject IS NULL)
        RAISERROR('tickets without a Subject remain after the backfill', 16, 1);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m2 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('086 §2 ABORTED — %s', 16, 1, @m2);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 3. tblLookup.TatHours + seeds (priority TAT, ticket_status, ticket_channel) + status/channel/due backfill
IF COL_LENGTH('dbo.tblLookup', 'TatHours') IS NULL
    ALTER TABLE dbo.tblLookup ADD TatHours INT NULL;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    -- 3.1 TAT per priority, matched on the label case-insensitively. Only
    --     where nothing is set yet — a company's own edit survives a re-run.
    UPDATE l SET TatHours = v.Hours
    FROM dbo.tblLookup l
    JOIN (VALUES ('urgent', 4), ('high', 24), ('medium', 72), ('low', 168)) v(Name, Hours)
      ON LOWER(LTRIM(RTRIM(l.Value))) = v.Name
    WHERE l.Kind = 'priority' AND l.TatHours IS NULL;

    -- Every company that has lookups or tickets gets the two new lookup sets.
    DECLARE @Comp TABLE (CompId INT PRIMARY KEY);
    INSERT INTO @Comp (CompId)
    SELECT DISTINCT CompId FROM dbo.tblLookup
    UNION SELECT DISTINCT CompId FROM dbo.tblTicket;

    -- 3.2 ticket_status — labels are the company's, codes are ours
    INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive, Code)
    SELECT c.CompId, 'ticket_status', v.Value, v.SortOrder, 1, v.Code
    FROM @Comp c
    CROSS JOIN (VALUES (N'New',         1, 'open'),
                       (N'In Progress', 2, 'open'),
                       (N'On Hold',     3, 'onhold'),
                       (N'Resolved',    4, 'resolved'),
                       (N'Closed',      5, 'closed'),
                       (N'Rejected',    6, 'rejected')) v(Value, SortOrder, Code)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup x
                      WHERE x.CompId = c.CompId AND x.Kind = 'ticket_status' AND x.Value = v.Value);

    -- 3.3 ticket_channel
    INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive, Code)
    SELECT c.CompId, 'ticket_channel', v.Value, v.SortOrder, 1, NULL
    FROM @Comp c
    CROSS JOIN (VALUES (N'Phone', 1), (N'WhatsApp', 2), (N'Email', 3),
                       (N'Web', 4), (N'Chat', 5), (N'Walk-in', 6)) v(Value, SortOrder)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup x
                      WHERE x.CompId = c.CompId AND x.Kind = 'ticket_channel' AND x.Value = v.Value);

    IF EXISTS (SELECT 1 FROM @Comp c
               WHERE (SELECT COUNT(*) FROM dbo.tblLookup x WHERE x.CompId = c.CompId AND x.Kind = 'ticket_status' AND x.Code = 'open') = 0)
        RAISERROR('a company has no open ticket_status after seeding', 16, 1);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m3a NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('086 §3 seeds ABORTED — %s', 16, 1, @m3a);
    SET NOEXEC ON;
END CATCH
GO

-- 3.4 status from the stage, 3.5 channel from the text, 3.6 due from the TAT.
--     Reads StageId / Channel / tblPipelineStage (dropped in §8) — see header.
BEGIN TRY
    BEGIN TRANSACTION;

    -- 3.4 stage NAME first (trimmed, case-insensitive under the CI collation),
    --     then StageType, then the timestamps for a ticket with no stage.
    ;WITH map AS (
        SELECT t.Id AS TicketId, t.CompId,
               CASE LOWER(LTRIM(RTRIM(s.Name)))
                    WHEN 'new'         THEN N'New'
                    WHEN 'assigned'    THEN N'In Progress'
                    WHEN 'in-progress' THEN N'In Progress'
                    WHEN 'in progress' THEN N'In Progress'
                    WHEN 'resolved'    THEN N'Resolved'
                    WHEN 'closed'      THEN N'Closed'
                    WHEN 'rejected'    THEN N'Rejected'
                    ELSE CASE s.StageType
                             WHEN 'open' THEN N'New'
                             WHEN 'won'  THEN CASE WHEN t.ClosedAt IS NOT NULL THEN N'Closed' ELSE N'Resolved' END
                             WHEN 'lost' THEN N'Rejected'
                             ELSE CASE WHEN t.ClosedAt   IS NOT NULL THEN N'Closed'
                                       WHEN t.ResolvedAt IS NOT NULL THEN N'Resolved'
                                       ELSE N'New' END
                         END
               END AS StatusValue
        FROM dbo.tblTicket t
        LEFT JOIN dbo.tblPipelineStage s ON s.Id = t.StageId
        WHERE t.StatusId IS NULL
    )
    UPDATE t SET StatusId = st.Id
    FROM dbo.tblTicket t
    JOIN map m ON m.TicketId = t.Id
    JOIN dbo.tblLookup st ON st.CompId = m.CompId AND st.Kind = 'ticket_status' AND st.Value = m.StatusValue;

    -- Anything still NULL (a company whose seeded labels were renamed before
    -- this ran): the first open status by SortOrder.
    UPDATE t SET StatusId = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = t.CompId AND Kind = 'ticket_status' AND Code = 'open' AND IsActive = 1
                             ORDER BY SortOrder, Id)
    FROM dbo.tblTicket t
    WHERE t.StatusId IS NULL;

    -- 3.5 channel text -> lookup, ignoring case, spaces and dashes
    UPDATE t SET ChannelId = ch.Id
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup ch
      ON ch.CompId = t.CompId AND ch.Kind = 'ticket_channel'
     AND LOWER(REPLACE(REPLACE(ch.Value, '-', ''), ' ', '')) = LOWER(REPLACE(REPLACE(LTRIM(RTRIM(t.Channel)), '-', ''), ' ', ''))
    WHERE t.ChannelId IS NULL AND NULLIF(LTRIM(RTRIM(t.Channel)), '') IS NOT NULL;

    -- 3.6 DueAt = CreatedAt + TAT of the priority; stays NULL when the
    --     priority has none (never overdue).
    UPDATE t SET DueAt = DATEADD(HOUR, p.TatHours, t.CreatedAt)
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup p ON p.Id = t.Priority AND p.Kind = 'priority'
    WHERE t.DueAt IS NULL AND p.TatHours IS NOT NULL;

    IF EXISTS (SELECT 1 FROM dbo.tblTicket WHERE StatusId IS NULL)
        RAISERROR('tickets with NULL StatusId remain after the backfill', 16, 1);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m3b NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('086 §3 backfill ABORTED — %s', 16, 1, @m3b);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 4. NOT NULL + FKs + indexes; tblTicketAssignment; tblTicketStatusHistory + seed
-- 4.1 NOT NULL — the §1–§3 assertions guarantee no NULL is left.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'CustomerId' AND is_nullable = 1)
    ALTER TABLE dbo.tblTicket ALTER COLUMN CustomerId INT NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'Subject' AND is_nullable = 1)
    ALTER TABLE dbo.tblTicket ALTER COLUMN Subject NVARCHAR(200) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'StatusId' AND is_nullable = 1)
    ALTER TABLE dbo.tblTicket ALTER COLUMN StatusId INT NOT NULL;
GO

-- 4.2 FKs on the two NOT NULL references. Both targets are soft-deleted by
--     their procs (sp_DeleteCustomer 409s while referenced; sp_DeleteLookup
--     flips IsActive), so the FK is a backstop the app never trips.
--     ProductId / ChannelId are nullable LEFT JOINs and stay FK-less, like
--     every other optional id in this schema.
IF OBJECT_ID('dbo.FK_tblTicket_CustomerId', 'F') IS NULL
    ALTER TABLE dbo.tblTicket WITH CHECK
        ADD CONSTRAINT FK_tblTicket_CustomerId FOREIGN KEY (CustomerId) REFERENCES dbo.tblCustomer (Id);
IF OBJECT_ID('dbo.FK_tblTicket_StatusId', 'F') IS NULL
    ALTER TABLE dbo.tblTicket WITH CHECK
        ADD CONSTRAINT FK_tblTicket_StatusId FOREIGN KEY (StatusId) REFERENCES dbo.tblLookup (Id);
GO

-- 4.3 indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'IX_tblTicket_CompId_StatusId')
    CREATE INDEX IX_tblTicket_CompId_StatusId   ON dbo.tblTicket (CompId, StatusId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'IX_tblTicket_CompId_AssignedTo')
    CREATE INDEX IX_tblTicket_CompId_AssignedTo ON dbo.tblTicket (CompId, AssignedTo);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'IX_tblTicket_CompId_CustomerId')
    CREATE INDEX IX_tblTicket_CompId_CustomerId ON dbo.tblTicket (CompId, CustomerId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'IX_tblTicket_CompId_DueAt')
    CREATE INDEX IX_tblTicket_CompId_DueAt      ON dbo.tblTicket (CompId, DueAt);
GO

-- 4.4 tblTicketAssignment — same shape as tblLeadAssignment
IF OBJECT_ID('dbo.tblTicketAssignment') IS NULL
BEGIN
    CREATE TABLE dbo.tblTicketAssignment (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblTicketAssignment PRIMARY KEY,
        CompId       INT           NOT NULL,
        TicketId     INT           NOT NULL,
        FromUserId   INT           NULL,
        ToUserId     INT           NULL,                      -- NULL = unassigned
        FromBranchId INT           NULL,
        ToBranchId   INT           NULL,
        ReasonId     INT           NULL,                      -- NULL only on the creation row
        Remarks      NVARCHAR(500) NOT NULL,
        AssignedBy   INT           NOT NULL,
        AssignedAt   DATETIME      NOT NULL CONSTRAINT DF_tblTicketAssignment_AssignedAt DEFAULT GETDATE()
    );
    CREATE INDEX IX_tblTicketAssignment_CompId_TicketId ON dbo.tblTicketAssignment (CompId, TicketId);
END
GO

-- 4.5 tblTicketStatusHistory — written only by sp_SetTicketStatus and the
--     sp_SaveTicket insert row (§6/§7). Same shape as tblLeadStatusHistory.
IF OBJECT_ID('dbo.tblTicketStatusHistory') IS NULL
BEGIN
    CREATE TABLE dbo.tblTicketStatusHistory (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblTicketStatusHistory PRIMARY KEY,
        CompId       INT      NOT NULL,
        TicketId     INT      NOT NULL,
        FromStatusId INT      NULL,
        ToStatusId   INT      NOT NULL,
        ChangedBy    INT      NULL,
        ChangedAt    DATETIME NOT NULL CONSTRAINT DF_tblTicketStatusHistory_ChangedAt DEFAULT GETDATE()
    );
    CREATE INDEX IX_tblTicketStatusHistory_CompId_TicketId             ON dbo.tblTicketStatusHistory (CompId, TicketId);
    CREATE INDEX IX_tblTicketStatusHistory_CompId_ToStatusId_ChangedAt ON dbo.tblTicketStatusHistory (CompId, ToStatusId, ChangedAt);
END
GO

-- 4.6 history seed — best effort from the timestamps, only for tickets that
--     have no history yet (re-run safe). Per ticket:
--       NULL -> New                      at CreatedAt                          (everyone)
--       New  -> Resolved                 at ResolvedAt                         (ResolvedAt set, or sitting in Resolved)
--       Resolved|New -> Closed           at ClosedAt                           (sitting in Closed; From = New when never resolved)
--       New  -> Rejected                 at ClosedAt                           (sitting in Rejected)
--       New  -> In Progress / On Hold    at UpdatedAt                          (active but not New)
--     so the LAST row always equals the ticket's StatusId.
BEGIN TRY
    BEGIN TRANSACTION;

    ;WITH st AS (
        SELECT CompId,
               MAX(CASE WHEN Value = N'New'      THEN Id END) AS NewId,
               MAX(CASE WHEN Value = N'Resolved' THEN Id END) AS ResolvedId
        FROM dbo.tblLookup WHERE Kind = 'ticket_status'
        GROUP BY CompId
    ),
    tk AS (
        SELECT t.Id, t.CompId, t.StatusId, t.CreatedBy, ISNULL(t.EditBy, t.CreatedBy) AS EditBy,
               t.CreatedAt, t.UpdatedAt, t.ResolvedAt, t.ClosedAt, s.Code,
               -- a company that renamed 'New' before this ran: its first open status
               ISNULL(st.NewId, (SELECT TOP 1 Id FROM dbo.tblLookup
                                 WHERE CompId = t.CompId AND Kind = 'ticket_status' AND Code = 'open'
                                 ORDER BY SortOrder, Id)) AS NewId,
               st.ResolvedId
        FROM dbo.tblTicket t
        JOIN dbo.tblLookup s ON s.Id = t.StatusId
        LEFT JOIN st ON st.CompId = t.CompId
        WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTicketStatusHistory h WHERE h.TicketId = t.Id)
    )
    INSERT INTO dbo.tblTicketStatusHistory (CompId, TicketId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
    SELECT CompId, Id, FromStatusId, ToStatusId, ChangedBy, ChangedAt
    FROM (
        SELECT CompId, Id, CAST(NULL AS INT) AS FromStatusId, NewId AS ToStatusId, CreatedBy AS ChangedBy, CreatedAt AS ChangedAt, 1 AS seq
        FROM tk
        UNION ALL
        SELECT CompId, Id, NewId, CASE WHEN Code = 'resolved' THEN StatusId ELSE ResolvedId END, EditBy,
               COALESCE(ResolvedAt, UpdatedAt, CreatedAt), 2
        FROM tk
        WHERE Code <> 'rejected' AND (ResolvedAt IS NOT NULL OR Code = 'resolved')
        UNION ALL
        SELECT CompId, Id, CASE WHEN ResolvedAt IS NOT NULL THEN ResolvedId ELSE NewId END, StatusId, EditBy,
               COALESCE(ClosedAt, ResolvedAt, UpdatedAt, CreatedAt), 3
        FROM tk
        WHERE Code = 'closed'
        UNION ALL
        SELECT CompId, Id, NewId, StatusId, EditBy, COALESCE(ClosedAt, UpdatedAt, CreatedAt), 4
        FROM tk
        WHERE Code = 'rejected'
        UNION ALL
        SELECT CompId, Id, NewId, StatusId, EditBy, COALESCE(UpdatedAt, CreatedAt), 5
        FROM tk
        WHERE Code IN ('open', 'onhold') AND StatusId <> NewId
    ) x
    WHERE ToStatusId IS NOT NULL
    ORDER BY Id, seq;

    IF EXISTS (SELECT 1 FROM dbo.tblTicket t
               WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTicketStatusHistory h WHERE h.TicketId = t.Id))
        RAISERROR('tickets without a history row remain after the seed', 16, 1);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m4 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('086 §4 history seed ABORTED — %s', 16, 1, @m4);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 5. Procedures — customers (sp_SaveCustomer, sp_FetchCustomers, sp_FetchCustomerDetail, sp_DeleteCustomer)


-- ===== 6. Procedures — tickets read/write (sp_SaveTicket, sp_FetchTickets, sp_FetchTicketDetail, sp_DeleteTicket, sp_SaveLookup, sp_FetchLookups)


-- ===== 7. Procedures — lifecycle (sp_SetTicketStatus, sp_ResolveTicket, sp_CloseTicket, sp_RejectTicket, sp_ReopenTicket, sp_TransferTicket, sp_BulkTransferTickets, sp_EscalateTicket, sp_FetchEscalationTargets)


-- ===== 8. Drop pipeline engine (5 procs, 4 ticket columns, 2 tables), duplicate groups, menu rows 18 + 28, add Customers menu + grants
-- 8.1 the five pipeline procs
DROP PROCEDURE IF EXISTS dbo.sp_MoveTicketStage, dbo.sp_FetchPipelines, dbo.sp_SavePipeline, dbo.sp_SaveStage, dbo.sp_DeleteStage;
GO

-- 8.2 guard: nothing may still read what is about to go. The old
--     sp_SaveTicket / sp_FetchTickets / sp_FetchTicketDetail / sp_ResolveTicket
--     / sp_CloseTicket / sp_ReopenTicket all do until §6–§7 replace them, so
--     applying this file with §5–§7 empty stops here — by design.
IF EXISTS (SELECT 1 FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
           WHERE m.definition LIKE '%tblPipeline%' OR m.definition LIKE '%StageId%' OR m.definition LIKE '%PipelineId%')
BEGIN
    DECLARE @left NVARCHAR(2000) = (SELECT STRING_AGG(o.name, ', ')
                                    FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
                                    WHERE m.definition LIKE '%tblPipeline%' OR m.definition LIKE '%StageId%' OR m.definition LIKE '%PipelineId%');
    RAISERROR('086 §8 ABORTED — these modules still reference the pipeline engine: %s', 16, 1, @left);
    SET NOEXEC ON;
END
GO

-- 8.3 the four ticket columns (their index first)
DROP INDEX IF EXISTS IX_tblTicket_CompId_StageId ON dbo.tblTicket;
IF COL_LENGTH('dbo.tblTicket', 'PipelineId')   IS NOT NULL ALTER TABLE dbo.tblTicket DROP COLUMN PipelineId;
IF COL_LENGTH('dbo.tblTicket', 'StageId')      IS NOT NULL ALTER TABLE dbo.tblTicket DROP COLUMN StageId;
IF COL_LENGTH('dbo.tblTicket', 'CustomerName') IS NOT NULL ALTER TABLE dbo.tblTicket DROP COLUMN CustomerName;
IF COL_LENGTH('dbo.tblTicket', 'Channel')      IS NOT NULL ALTER TABLE dbo.tblTicket DROP COLUMN Channel;
GO

-- 8.4 the two tables (stage before pipeline)
DROP TABLE IF EXISTS dbo.tblPipelineStage;
DROP TABLE IF EXISTS dbo.tblPipeline;
GO

-- 8.5 duplicate role rows: zero members AND same Name + CompId as a lower Id.
--     GroupId lives in tblGroupAccess and tblUserGroupMap only (checked).
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @Dup TABLE (Id INT PRIMARY KEY);
    INSERT INTO @Dup (Id)
    SELECT g.Id
    FROM dbo.tblUserGroups g
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m WHERE m.GroupId = g.Id)
      AND EXISTS (SELECT 1 FROM dbo.tblUserGroups o
                  WHERE o.Name = g.Name AND ISNULL(o.CompId, -1) = ISNULL(g.CompId, -1) AND o.Id < g.Id);

    DELETE FROM dbo.tblGroupAccess WHERE GroupId IN (SELECT Id FROM @Dup);
    DELETE FROM dbo.tblUserGroups  WHERE Id      IN (SELECT Id FROM @Dup);

    -- 8.6 menu rows Ticket Board + Pipelines (matched by Route), with their grants
    DECLARE @Gone TABLE (Id INT PRIMARY KEY);
    INSERT INTO @Gone (Id) SELECT Id FROM dbo.tblMenu WHERE Route IN (N'/support/board', N'/settings/pipelines');
    DELETE FROM dbo.tblGroupAccess WHERE MenuId IN (SELECT Id FROM @Gone);
    DELETE FROM dbo.tblMenu        WHERE Id     IN (SELECT Id FROM @Gone);

    -- 8.7 Customers menu under Support, grants cloned from Tickets.
    --     DISTINCT because tblGroupAccess carries duplicate (GroupId, MenuId)
    --     rows today. Menu rights load at LOGIN — re-login to see it.
    DECLARE @Support INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/support'         ORDER BY Id);
    DECLARE @Tickets INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/support/tickets' ORDER BY Id);
    IF @Support IS NULL OR @Tickets IS NULL
        RAISERROR('menu rows /support or /support/tickets not found', 16, 1);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = N'/support/customers')
        INSERT INTO dbo.tblMenu (ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route)
        VALUES (@Support, 'Customers', NULL, 0, 1, 0, 1, NULL, NULL, 1, N'/support/customers');

    DECLARE @Customers INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/support/customers' ORDER BY Id);

    INSERT INTO dbo.tblGroupAccess (GroupId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
    SELECT DISTINCT src.GroupId, @Customers, src.CanView, src.CanAdd, src.CanEdit, src.CanDelete
    FROM dbo.tblGroupAccess src
    WHERE src.MenuId = @Tickets
      AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupAccess ga WHERE ga.GroupId = src.GroupId AND ga.MenuId = @Customers);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m8 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('086 §8 cleanup ABORTED — %s', 16, 1, @m8);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 9. Verify
SET NOCOUNT ON;

-- 9.1 shape — every row 'ok'
SELECT 'tblCustomer'                    AS what, CASE WHEN OBJECT_ID('dbo.tblCustomer')             IS NOT NULL THEN 'ok' ELSE 'MISSING'     END AS state
UNION ALL SELECT 'tblTicketAssignment',          CASE WHEN OBJECT_ID('dbo.tblTicketAssignment')     IS NOT NULL THEN 'ok' ELSE 'MISSING'     END
UNION ALL SELECT 'tblTicketStatusHistory',       CASE WHEN OBJECT_ID('dbo.tblTicketStatusHistory')  IS NOT NULL THEN 'ok' ELSE 'MISSING'     END
UNION ALL SELECT 'tblPipelineStage gone',        CASE WHEN OBJECT_ID('dbo.tblPipelineStage')        IS NULL     THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'tblPipeline gone',             CASE WHEN OBJECT_ID('dbo.tblPipeline')             IS NULL     THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'tblTicket.PipelineId gone',    CASE WHEN COL_LENGTH('dbo.tblTicket','PipelineId')   IS NULL THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'tblTicket.StageId gone',       CASE WHEN COL_LENGTH('dbo.tblTicket','StageId')      IS NULL THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'tblTicket.CustomerName gone',  CASE WHEN COL_LENGTH('dbo.tblTicket','CustomerName') IS NULL THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'tblTicket.Channel gone',       CASE WHEN COL_LENGTH('dbo.tblTicket','Channel')      IS NULL THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'IX_tblTicket_CompId_StageId gone', CASE WHEN NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'IX_tblTicket_CompId_StageId') THEN 'ok' ELSE 'STILL THERE' END
UNION ALL SELECT 'tblTicket.CustomerId NOT NULL', CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'CustomerId' AND is_nullable = 0) THEN 'ok' ELSE 'WRONG' END
UNION ALL SELECT 'tblTicket.Subject NOT NULL',    CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'Subject'    AND is_nullable = 0) THEN 'ok' ELSE 'WRONG' END
UNION ALL SELECT 'tblTicket.StatusId NOT NULL',   CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name = 'StatusId'   AND is_nullable = 0) THEN 'ok' ELSE 'WRONG' END
UNION ALL SELECT 'tblTicket.Contact VARCHAR(100)', CASE WHEN COL_LENGTH('dbo.tblTicket','Contact') = 100 THEN 'ok' ELSE 'WRONG' END
UNION ALL SELECT 'tblLookup.TatHours',           CASE WHEN COL_LENGTH('dbo.tblLookup','TatHours') IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'FK_tblTicket_CustomerId',      CASE WHEN OBJECT_ID('dbo.FK_tblTicket_CustomerId','F') IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'FK_tblTicket_StatusId',        CASE WHEN OBJECT_ID('dbo.FK_tblTicket_StatusId','F')   IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'UX_tblCustomer_CompId_Mobile', CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblCustomer') AND name = 'UX_tblCustomer_CompId_Mobile' AND has_filter = 1) THEN 'ok' ELSE 'MISSING' END;

-- 9.2 data — N must match expect
SELECT 'customers' AS what, COUNT(*) AS N, '>= 36 on eCRM+ (36 distinct contacts + the no-contact names)' AS expect FROM dbo.tblCustomer
UNION ALL SELECT 'tickets whose customer row is missing',      COUNT(*), '0' FROM dbo.tblTicket t WHERE NOT EXISTS (SELECT 1 FROM dbo.tblCustomer c WHERE c.Id = t.CustomerId AND c.CompId = t.CompId)
UNION ALL SELECT 'tickets whose status is not a ticket_status of their company', COUNT(*), '0'
          FROM dbo.tblTicket t WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup s WHERE s.Id = t.StatusId AND s.CompId = t.CompId AND s.Kind = 'ticket_status')
UNION ALL SELECT 'tickets with a TAT priority but no DueAt',   COUNT(*), '0'
          FROM dbo.tblTicket t JOIN dbo.tblLookup p ON p.Id = t.Priority WHERE p.TatHours IS NOT NULL AND t.DueAt IS NULL
UNION ALL SELECT 'assigned tickets without AssignedAt',        COUNT(*), '0' FROM dbo.tblTicket WHERE AssignedTo IS NOT NULL AND AssignedAt IS NULL
UNION ALL SELECT 'tickets without history',                    COUNT(*), '0'
          FROM dbo.tblTicket t WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTicketStatusHistory h WHERE h.TicketId = t.Id)
UNION ALL SELECT 'tickets whose last history row <> status',   COUNT(*), '0'
          FROM dbo.tblTicket t
          WHERE t.StatusId <> (SELECT TOP 1 h.ToStatusId FROM dbo.tblTicketStatusHistory h WHERE h.TicketId = t.Id ORDER BY h.ChangedAt DESC, h.Id DESC)
UNION ALL SELECT 'companies missing an open ticket_status',    COUNT(*), '0'
          FROM (SELECT DISTINCT CompId FROM dbo.tblLookup) c
          WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup s WHERE s.CompId = c.CompId AND s.Kind = 'ticket_status' AND s.Code = 'open')
UNION ALL SELECT 'ticket_status rows per company',             COUNT(*), '6 x companies' FROM dbo.tblLookup WHERE Kind = 'ticket_status'
UNION ALL SELECT 'ticket_channel rows per company',            COUNT(*), '6 x companies' FROM dbo.tblLookup WHERE Kind = 'ticket_channel'
UNION ALL SELECT 'priorities without TatHours',                COUNT(*), '0 (only labels outside urgent/high/medium/low stay NULL)' FROM dbo.tblLookup WHERE Kind = 'priority' AND TatHours IS NULL
UNION ALL SELECT 'zero-member duplicate groups',               COUNT(*), '0'
          FROM dbo.tblUserGroups g
          WHERE NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m WHERE m.GroupId = g.Id)
            AND EXISTS (SELECT 1 FROM dbo.tblUserGroups o WHERE o.Name = g.Name AND ISNULL(o.CompId,-1) = ISNULL(g.CompId,-1) AND o.Id < g.Id)
UNION ALL SELECT 'grants pointing at a deleted group',         COUNT(*), '0' FROM dbo.tblGroupAccess ga WHERE NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups g WHERE g.Id = ga.GroupId)
UNION ALL SELECT 'menu rows /support/board + /settings/pipelines', COUNT(*), '0' FROM dbo.tblMenu WHERE Route IN (N'/support/board', N'/settings/pipelines')
UNION ALL SELECT 'grants pointing at a deleted menu',          COUNT(*), '0' FROM dbo.tblGroupAccess ga WHERE NOT EXISTS (SELECT 1 FROM dbo.tblMenu m WHERE m.Id = ga.MenuId)
UNION ALL SELECT 'menu row /support/customers',                COUNT(*), '1' FROM dbo.tblMenu WHERE Route = N'/support/customers'
UNION ALL SELECT 'groups granted Customers',                   COUNT(DISTINCT ga.GroupId), 'same as the next row' FROM dbo.tblGroupAccess ga JOIN dbo.tblMenu m ON m.Id = ga.MenuId WHERE m.Route = N'/support/customers'
UNION ALL SELECT 'groups granted Tickets',                     COUNT(DISTINCT ga.GroupId), '7 on eCRM+ after the duplicate groups go' FROM dbo.tblGroupAccess ga JOIN dbo.tblMenu m ON m.Id = ga.MenuId WHERE m.Route = N'/support/tickets';

-- 9.3 procs — expect 19 rows, then 0 rows, then 0 rows
SELECT name FROM sys.procedures
WHERE name IN ('sp_SaveCustomer','sp_FetchCustomers','sp_FetchCustomerDetail','sp_DeleteCustomer',
               'sp_SaveTicket','sp_FetchTickets','sp_FetchTicketDetail','sp_DeleteTicket','sp_SaveLookup','sp_FetchLookups',
               'sp_SetTicketStatus','sp_ResolveTicket','sp_CloseTicket','sp_RejectTicket','sp_ReopenTicket',
               'sp_TransferTicket','sp_BulkTransferTickets','sp_EscalateTicket','sp_FetchEscalationTargets')
ORDER BY name;
SELECT name AS should_be_gone FROM sys.procedures
WHERE name IN ('sp_MoveTicketStage','sp_FetchPipelines','sp_SavePipeline','sp_SaveStage','sp_DeleteStage');
SELECT o.name AS still_references_pipeline_engine
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%tblPipeline%' OR m.definition LIKE '%StageId%' OR m.definition LIKE '%PipelineId%';

-- 9.4 the lookup ids Task 10's live check reads — one grid per company
SELECT CompId, Kind, Id, Value, Code, SortOrder, TatHours
FROM dbo.tblLookup
WHERE Kind IN ('ticket_status', 'ticket_channel', 'priority') AND IsActive = 1
ORDER BY CompId, Kind, SortOrder, Id;

-- 9.5 write paths — dry run, rolled back. Plain EXEC throughout: the procs
--     INSERT…EXEC their loggers, and INSERT…EXEC cannot be nested. Read the
--     ResponseCode in each grid against the 'expect' label above it.
DECLARE @cid  INT = (SELECT TOP 1 CompId FROM dbo.tblLookup WHERE Kind = 'ticket_status' ORDER BY CompId);
DECLARE @uid  INT, @bid INT;
SELECT TOP 1 @uid = Id, @bid = BranchId FROM dbo.tblUser WHERE CompId = @cid AND IsActive = 1 ORDER BY Id;
DECLARE @res  INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @cid AND Kind = 'resolution' AND IsActive = 1 ORDER BY SortOrder, Id);
DECLARE @prio INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @cid AND Kind = 'priority'   AND IsActive = 1 AND TatHours IS NOT NULL ORDER BY SortOrder, Id);
BEGIN TRY
BEGIN TRANSACTION;
    SELECT '(a) create customer — expect 200' AS step;
    EXEC dbo.sp_SaveCustomer @Id = 0, @CompId = @cid, @BranchId = @bid, @UserId = @uid, @Name = N'verify-086', @Mobile = '99999 00086';
    DECLARE @cust INT = (SELECT TOP 1 Id FROM dbo.tblCustomer WHERE CompId = @cid AND Name = N'verify-086' ORDER BY Id DESC);
    SELECT '(a) mobile normalised' AS step, Mobile, CASE WHEN Mobile = '9999900086' THEN 'ok' ELSE 'WRONG' END AS state FROM dbo.tblCustomer WHERE Id = @cust;

    SELECT '(b) same mobile again — expect 409' AS step;
    EXEC dbo.sp_SaveCustomer @Id = 0, @CompId = @cid, @BranchId = @bid, @UserId = @uid, @Name = N'verify-086 dup', @Mobile = '9999900086';

    SELECT '(c) neither mobile nor email — expect 400' AS step;
    EXEC dbo.sp_SaveCustomer @Id = 0, @CompId = @cid, @BranchId = @bid, @UserId = @uid, @Name = N'verify-086 empty';

    SELECT '(d) create ticket — expect 200 with a TicketNo' AS step;
    EXEC dbo.sp_SaveTicket @Id = 0, @CompId = @cid, @BranchId = @bid, @UserId = @uid,
         @CustomerId = @cust, @Subject = N'verify-086', @Priority = @prio, @AssignedTo = @uid, @Description = N'dry run';
    DECLARE @tid INT = (SELECT TOP 1 Id FROM dbo.tblTicket WHERE CompId = @cid AND Subject = N'verify-086' ORDER BY Id DESC);
    SELECT '(d) new row' AS step, StatusId, DueAt, AssignedAt,
           CASE WHEN DueAt IS NOT NULL AND AssignedAt IS NOT NULL THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;
    SELECT '(d) history rows' AS step, COUNT(*) AS N, 1 AS expect FROM dbo.tblTicketStatusHistory WHERE TicketId = @tid;

    SELECT '(e) ticket without customer — expect 400' AS step;
    EXEC dbo.sp_SaveTicket @Id = 0, @CompId = @cid, @BranchId = @bid, @UserId = @uid, @Subject = N'verify-086 no customer';

    SELECT '(f) resolve without a resolution — expect 400' AS step;
    EXEC dbo.sp_ResolveTicket @CompId = @cid, @TicketId = @tid, @ResolutionId = NULL, @Remarks = N'x', @UserId = @uid;

    SELECT '(g) resolve — expect 200' AS step;
    EXEC dbo.sp_ResolveTicket @CompId = @cid, @TicketId = @tid, @ResolutionId = @res, @Remarks = N'verify resolve', @UserId = @uid;
    SELECT '(g) resolved row' AS step, ResolvedAt, ResolutionId,
           CASE WHEN ResolvedAt IS NOT NULL AND ResolutionId = @res AND ClosedAt IS NULL THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;

    SELECT '(h) reopen with AllowReopen = 0 — expect 403' AS step;
    EXEC dbo.sp_ReopenTicket @CompId = @cid, @TicketId = @tid, @Remarks = N'verify reopen', @UserId = @uid, @AllowReopen = 0;

    SELECT '(i) reopen with AllowReopen = 1 — expect 200' AS step;
    EXEC dbo.sp_ReopenTicket @CompId = @cid, @TicketId = @tid, @Remarks = N'verify reopen', @UserId = @uid, @AllowReopen = 1;
    SELECT '(i) reopened row' AS step, ResolvedAt, ResolutionId, DueAt,
           CASE WHEN ResolvedAt IS NULL AND ResolutionId IS NULL AND ClosedAt IS NULL AND DueAt > GETDATE() THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;
    SELECT '(i) history rows' AS step, COUNT(*) AS N, 3 AS expect FROM dbo.tblTicketStatusHistory WHERE TicketId = @tid;

    SELECT '(j) reject without remarks — expect 400' AS step;
    EXEC dbo.sp_RejectTicket @CompId = @cid, @TicketId = @tid, @Remarks = NULL, @UserId = @uid;

    SELECT '(k) escalate to self — expect 400 (not a senior)' AS step;
    EXEC dbo.sp_EscalateTicket @CompId = @cid, @TicketId = @tid, @ToUserId = @uid, @Remarks = N'x', @UserId = @uid;

    SELECT '(l) delete customer with a complaint — expect 409' AS step;
    EXEC dbo.sp_DeleteCustomer @Id = @cust, @CompId = @cid;

    SELECT '(m) timeline' AS step, STRING_AGG(Type, ',') WITHIN GROUP (ORDER BY Id) AS types,
           'created,assigned,resolved,reopened' AS expect
    FROM dbo.tblTicketActivity WHERE TicketId = @tid;

    SELECT '(n) fetch as the creator — expect 1 row with StatusCode open, IsOverdue 0' AS step;
    EXEC dbo.sp_FetchTickets @CompId = @cid, @SearchTerm = N'verify-086', @UserId = @uid, @OwnerIdsJson = '[]', @AccessibleBranchIdsJson = '[]';

    SELECT '(o) rolling back — nothing above is kept' AS step;
ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'VERIFY FAILED (rolled back)' AS step, ERROR_NUMBER() AS ErrNo, ERROR_PROCEDURE() AS Proc_, ERROR_LINE() AS Line_, ERROR_MESSAGE() AS Msg_;
END CATCH
GO

SET NOEXEC OFF;
GO
```

- [ ] **Step 3: Read the file back — markers and batching**

Run: `cd backend && grep -n "^-- ===== " sql/086_support_rebuild.sql`
Expected: nine lines, in order `1.` … `9.`, each exactly as in the Contracts block (the §5/§6/§7 lines are followed only by blank lines until Tasks 2–3 run).

Run: `cd backend && grep -c "^GO$" sql/086_support_rebuild.sql && grep -c "SET NOEXEC ON" sql/086_support_rebuild.sql && grep -n "SET NOEXEC OFF" sql/086_support_rebuild.sql`
Expected: `22` (one `GO` per batch: header · §1 table · §1 CustomerId · §1 backfill · §2 columns · §2 backfill · §3 TatHours · §3 seeds · §3 backfill · §4.1 · §4.2 · §4.3 · §4.4 · §4.5 · §4.6 · §8.1 · §8.2 · §8.3 · §8.4 · §8.5–8.7 · §9 · NOEXEC OFF — Tasks 2–3 add one per proc), `7` `SET NOEXEC ON` (the six CATCH blocks in §1, §2, §3 seeds, §3 backfill, §4, §8 cleanup, plus the §8.2 guard), and `SET NOEXEC OFF` on two lines (the first statement of the file and the last batch).

Run: `cd backend && grep -n "BEGIN TRY\|BEGIN CATCH\|RAISERROR('086" sql/086_support_rebuild.sql`
Expected: `7` `BEGIN TRY` and `7` `BEGIN CATCH` (six backfill/cleanup pairs before §9 plus the §9 dry-run pair); `7` `RAISERROR('086 …` lines (`§1 ABORTED`, `§2 ABORTED`, `§3 seeds ABORTED`, `§3 backfill ABORTED`, `§4 history seed ABORTED`, `§8 ABORTED` (the guard), `§8 cleanup ABORTED`).

Read the whole file once top to bottom and check by eye: every `ALTER TABLE … ADD` sits in its own batch **before** the batch that reads the new column (SQL Server binds existing-table columns at batch compile); `CustomerId` is added in §1 before the MERGE batch; `TatHours` is added before the seed batch; §8.2's guard precedes §8.3's column drops.

- [ ] **Step 4: Hand the owner the apply + verify instructions**

The file is **not appliable until Tasks 2 and 3 have filled §5–§7** — §8.2 will stop it with `086 §8 ABORTED — these modules still reference the pipeline engine: sp_CloseTicket, sp_FetchTicketDetail, sp_FetchTickets, sp_ReopenTicket, sp_ResolveTicket, sp_SaveTicket` if applied early, and nothing after §4 will have run (§1–§4 are then already applied and stay; re-running the finished file later is safe — §1–§4 are no-ops).

After Task 3, the owner runs the whole file in SSMS / Azure Data Studio against `eCRM+`, then against `SolarCRM`, top to bottom in one go, and reads §9: every 9.1 row `ok`; every 9.2 `N` equal to its `expect`; 9.3 lists 19 names, then two empty grids; 9.4 is the id sheet Task 10 copies from; 9.5's grids show the ResponseCodes named in each `expect` label and end with `(o) rolling back`. Any `VERIFY FAILED` row or a `086 §N ABORTED` message in the Messages pane = stop, report the text verbatim. Deploy the backend **immediately** after a clean apply (§7 of the spec).

- [ ] **Step 5: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: the file path; the three `grep` result lines from Step 3; that §5–§7 are bare markers awaiting Tasks 2–3 and the file must not be applied before then; the nine decisions listed at the top of this task (FK choice, dedupe key, CustomerId in §1, Contact widened, extra history rows, Route-matched menus, NOEXEC halting, full-re-run caveat, data-driven duplicate rule); anything Step 1 returned that differed from the expected values.

---

### Task 2: `086` part B — customer + ticket read/write SPs (sections 5–6)

**Files:**
- Modify: `backend/sql/086_support_rebuild.sql` — insert the four customer procs directly under the line `-- ===== 5. Procedures — customers (…)` and the six ticket read/write procs directly under `-- ===== 6. Procedures — tickets read/write (…)`. Task 1 wrote both marker lines with nothing beneath them; nothing else in the file moves. Task 3 fills `-- ===== 7.` the same way.
- Test: no local SQL execution. Gate = read-only MCP checks of the current procs being replaced (Step 1), `grep -n` read-back (Step 3), and the §9 verify block Task 1 already wrote (its 9.5 dry run exercises `sp_SaveCustomer` 200/409/400, `sp_SaveTicket` 200/400, `sp_DeleteCustomer` 409, `sp_FetchTickets`).

**Interfaces:**
- Consumes (Task 1): `dbo.tblCustomer (Id, CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email, Address, City, State, Pincode, Remarks, IsActive, CreatedBy, CreatedAt, EditBy, UpdatedAt)`; `dbo.tblTicket` with `CustomerId, Subject, StatusId, ProductId, ChannelId, DueAt, AssignedAt, EscalatedTo, EscalatedAt` and `Contact VARCHAR(100)`; `dbo.tblLookup.TatHours`; lookups `ticket_status` (Code ∈ open/onhold/resolved/closed/rejected) and `ticket_channel`; `dbo.tblTicketAssignment`; `dbo.tblTicketStatusHistory`. Live, unchanged: `dbo.sp_LogTicketActivity (@CompId, @TicketId, @UserId, @Type VARCHAR(30), @Summary NVARCHAR(500) = NULL, @MetaJSON NVARCHAR(MAX) = NULL)` returning one row `Id, ResponseCode, ResponseMess`; `dbo.sp_CreateNotification (@UserId INT, @Type VARCHAR(40), @EntityType VARCHAR(20), @EntityId BIGINT, @ActorUserId INT = NULL, @Title VARCHAR(200), @Body NVARCHAR(1000) = NULL, @CompId BIGINT, @BranchId BIGINT, @SkipSelf BIT = 1)` returning one row `ResponseCode, ResponseMess, NotificationId, UserId, Type`; `dbo.tblCustomFieldDef (Id, CompId, Entity, FieldKey, Label, Type, Options, IsRequired, SortOrder, IsActive, …)`, `dbo.tblCustomFieldValue (Id, CompId, Entity, EntityId, FieldId, ValueText, ValueNumber DECIMAL(18,2), ValueDate)`; `dbo.tblTicketActivity (Id, CompId, TicketId, UserId, Type, Summary, MetaJSON, CreatedBy, EditBy, CreatedAt, UpdatedAt)`; `dbo.tblCall.TicketId`; `dbo.tblUser (Id, FullName, Avatar, JobTitle, BranchId, ReportsTo, IsActive, CompId)`; `dbo.tblBranch (Id, BranchName)`; `dbo.tblProduct (Id, CompId, Name, IsActive)`; `dbo.tblLeads (Id, CompId, Name, MobileNo, Email, StatusId)`.
- Produces (signatures **verbatim from the Contracts block**; Tasks 5–7 call these, Task 10 verifies them against `sys.parameters`):
  - `sp_SaveCustomer @Id INT = 0, @CompId INT, @BranchId INT, @UserId INT, @Name NVARCHAR(200), @ContactPerson NVARCHAR(200) = NULL, @Mobile VARCHAR(20) = NULL, @AltMobile VARCHAR(20) = NULL, @Email NVARCHAR(200) = NULL, @Address NVARCHAR(500) = NULL, @City NVARCHAR(100) = NULL, @State NVARCHAR(100) = NULL, @Pincode VARCHAR(10) = NULL, @Remarks NVARCHAR(MAX) = NULL` → `Id, ResponseCode, ResponseMess` (400 name / mobile-or-email / bad mobile / bad email · 404 · 409 duplicate live mobile · 200)
  - `sp_FetchCustomers @CompId INT, @PageNumber INT = 1, @PageSize INT = 25, @SearchTerm NVARCHAR(200) = NULL, @BranchId INT = NULL, @IsActive BIT = 1` → RS1 `Id, CompId, BranchId, BranchName, Name, ContactPerson, Mobile, AltMobile, Email, Address, City, State, Pincode, Remarks, IsActive, OpenTickets, TotalTickets, LastTicketAt, CreatedAt, UpdatedAt` · RS2 `CurrentPage, PageSize, TotalRecords, TotalPages`
  - `sp_FetchCustomerDetail @CompId INT, @CustomerId INT, @UserId INT = NULL, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL` → RS1 customer row (RS1 columns of `sp_FetchCustomers`) · RS2 `Id, TicketNo, Subject, StatusId, StatusName, StatusCode, Priority, PriorityName, AssignedTo, AssigneeName, DueAt, IsOverdue, CreatedAt, ResolvedAt, ClosedAt` under the caller's scope predicate
  - `sp_DeleteCustomer @Id INT, @CompId INT` → `Id, ResponseCode, ResponseMess` (soft; 409 while any ticket references it)
  - `sp_SaveTicket @Id INT = 0, @CompId INT, @BranchId INT, @UserId INT, @CustomerId INT = NULL, @Subject NVARCHAR(200) = NULL, @ContactPerson NVARCHAR(200) = NULL, @Contact VARCHAR(100) = NULL, @ChannelId INT = NULL, @CategoryId INT = NULL, @Priority INT = NULL, @ProductId INT = NULL, @AssignedTo INT = NULL, @LinkedLeadId INT = NULL, @Description NVARCHAR(MAX) = NULL, @CustomJSON NVARCHAR(MAX) = NULL` → `Id, TicketNo, ResponseCode, ResponseMess`
  - `sp_FetchTickets` (21 params, verbatim below) → RS1 the 41 contract columns (+ `ResponseCode, ResponseMess`, house style) · RS2 `CurrentPage, PageSize, TotalRecords, TotalPages`
  - `sp_FetchTicketDetail @CompId INT, @TicketId INT` → RS1 = `sp_FetchTickets` RS1 + `EditBy, CustomerContactPerson, CustomerEmail, CustomerCity, CustomerAddress, PreviousTickets` · RS2 `FieldId, FieldKey, Label, Type, ValueText, ValueNumber, ValueDate` · RS3 `Id, TicketId, UserId, UserName, UserAvatar, Type, Summary, MetaJSON, CreatedAt` · RS4 `Id, FromUserId, FromUserName, ToUserId, ToUserName, FromBranchId, FromBranchName, ToBranchId, ToBranchName, ReasonId, Reason, Remarks, AssignedBy, AssignedByName, AssignedAt` · RS5 `Id, Name, MobileNo, Email, StatusId`. `permission.js` reads `RS1[0].AssignedTo / CreatedBy / BranchId` — all three kept.
  - `sp_DeleteTicket @Id INT, @CompId INT` → `Id, ResponseCode, ResponseMess`
  - `sp_SaveLookup @Id INT, @CompId INT, @Kind VARCHAR(30), @Value NVARCHAR(200), @SortOrder INT = 0, @Code VARCHAR(30) = NULL, @TatHours INT = NULL` → `Id, ResponseCode, ResponseMess`
  - `sp_FetchLookups @CompId INT, @Kind VARCHAR(30)` → `Id, CompId, Kind, Value, SortOrder, IsActive, Code, TatHours, ResponseCode, ResponseMess`
  - Activity types written here: `created`, `updated`, `assigned` (the creation row) — `sp_LogTicketActivity`. Notification type written here: `ticket_assigned` (`EntityType = 'ticket'`).

**Decisions taken in this task (spec silent or open):**
1. **Paging = one predicate, not two.** `sp_FetchTickets` / `sp_FetchCustomers` collect the matching ids once into a table variable (`@F`), take `COUNT(*)` from it and page from it. `sp_FetchLeads` duplicates its 30-line predicate for a past-the-end recount; a ticket table is small and one copy of the predicate is one fewer place to get scope wrong. Scope predicate text itself is verbatim from the Global Constraints.
2. **`DueAt` sorts NULL last.** The contract's `ORDER BY IsOverdue DESC, DueAt, CreatedAt DESC` puts a no-TAT ticket (`DueAt NULL`) first under T-SQL's NULLs-first ascending rule; `ISNULL(DueAt, '9999-12-31')` keeps the contract's intent (nearest due first) and pushes the undated to the end. `Id DESC` is appended as the tiebreaker, as every fetch here does.
3. **A digits-only search term matches mobiles typed with spaces or dashes**: `'99999 00086'` finds `9999900086` (`@Digits` = the term with spaces/dashes stripped, used for the `Mobile` columns only). One extra `DECLARE`, and "type the mobile" is the primary support flow.
4. **`sp_SaveTicket` validates every foreign id it is given** (customer active in company → 404; priority / category / channel → 400 with the kind named; product → 400; assignee active in company → 400; linked lead in company → 400). The old proc validated nothing; these are one line each and the priority one is load-bearing for `DueAt`.
5. **Creation writes an opening `tblTicketAssignment` row** (`FromUserId NULL, ReasonId NULL, Remarks 'Assigned on creation'`) when `@AssignedTo` is set — mirrors `sp_SaveLead`, so RS4 shows who a complaint landed on first. Report-style consumers treat `ReasonId IS NULL` as "not a transfer", as they do for leads.
6. **`sp_SaveTicket` update keeps the `LinkedLeadId = ISNULL(@LinkedLeadId, LinkedLeadId)` guard** from the current proc (a client that does not know about the link must not sever it), and **never touches `AssignedTo`, `StatusId`, `AssignedAt`, `EscalatedTo`** — assignment moves only through `sp_TransferTicket`, status only through `sp_SetTicketStatus`.
7. **`AgeHours` = `DATEDIFF(HOUR, CreatedAt, COALESCE(ClosedAt, ResolvedAt, GETDATE()))`** — the engine clears both timestamps on reopen, so an active ticket ages to now and a finished one froze when it finished.
8. **`sp_SaveLookup` treats `TatHours <= 0` as NULL** (no TAT — never overdue); a negative or zero TAT would make every ticket overdue at creation.
9. **`sp_DeleteTicket` removes assignment, history and `tblCall` rows** (spec) — not `tblAttachment` rows or their files, exactly as today.

- [ ] **Step 1: Read-only pre-checks — the procs about to be replaced, as they are now**

Run with `mcp__sqlserver-ecrm__read_query`:

```sql
-- (1) current parameter lists of the six procs §6 replaces — expect the OLD shapes:
--     sp_SaveTicket has @CustomerName/@Channel/@PipelineId/@StageId (no @CustomerId/@Subject);
--     sp_FetchTickets has @StageId (no @StatusId/@StatusCode/@Overdue/...);
--     sp_SaveLookup has no @TatHours; sp_FetchTicketDetail/sp_DeleteTicket take (@CompId|@Id, @TicketId|@CompId)
SELECT o.name, STRING_AGG(p.name + ' ' + TYPE_NAME(p.user_type_id), ', ') WITHIN GROUP (ORDER BY p.parameter_id) AS params
FROM sys.procedures o JOIN sys.parameters p ON p.object_id = o.object_id
WHERE o.name IN ('sp_SaveTicket','sp_FetchTickets','sp_FetchTicketDetail','sp_DeleteTicket','sp_SaveLookup','sp_FetchLookups')
GROUP BY o.name ORDER BY o.name;

-- (2) the four customer procs do not exist yet — expect 0 rows
SELECT name FROM sys.procedures WHERE name IN ('sp_SaveCustomer','sp_FetchCustomers','sp_FetchCustomerDetail','sp_DeleteCustomer');

-- (3) the logger and notifier signatures these procs call — expect exactly:
--     sp_LogTicketActivity: @CompId int, @TicketId int, @UserId int, @Type varchar, @Summary nvarchar, @MetaJSON nvarchar
--     sp_CreateNotification: @UserId int, @Type varchar, @EntityType varchar, @EntityId bigint, @ActorUserId int, @Title varchar, @Body nvarchar, @CompId bigint, @BranchId bigint, @SkipSelf bit
SELECT o.name, STRING_AGG(p.name + ' ' + TYPE_NAME(p.user_type_id), ', ') WITHIN GROUP (ORDER BY p.parameter_id) AS params
FROM sys.procedures o JOIN sys.parameters p ON p.object_id = o.object_id
WHERE o.name IN ('sp_LogTicketActivity','sp_CreateNotification')
GROUP BY o.name ORDER BY o.name;

-- (4) the TicketNo generator + CustomJSON MERGE that must be kept verbatim — expect both fragments present in the live body
SELECT CASE WHEN m.definition LIKE '%RIGHT(''000000'' + CAST(@Seq AS VARCHAR(10)), 6)%' THEN 'ok' ELSE 'CHANGED' END AS ticketno,
       CASE WHEN m.definition LIKE '%MERGE dbo.tblCustomFieldValue AS tgt%' THEN 'ok' ELSE 'CHANGED' END AS custom_merge
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id WHERE o.name = 'sp_SaveTicket';

-- (5) the columns the detail RS2/RS3/RS5 read — expect FieldKey, Label, Type, SortOrder on the def; Name, MobileNo, Email, StatusId on leads; Avatar on users
SELECT t.name tbl, c.name col FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
WHERE (t.name = 'tblCustomFieldDef' AND c.name IN ('FieldKey','Label','Type','SortOrder'))
   OR (t.name = 'tblLeads' AND c.name IN ('Name','MobileNo','Email','StatusId'))
   OR (t.name = 'tblUser' AND c.name IN ('Avatar','FullName','JobTitle'))
ORDER BY t.name, c.name;
```

Expected: (1) the old shapes as annotated; (2) empty; (3) the two lines as annotated; (4) `ok ok`; (5) eleven rows. If (3) differs, the `INSERT INTO @… EXEC` table-variable shapes below must change to match — report and stop.

- [ ] **Step 2: Insert §5 and §6 into the file**

Everything below goes **between** the `-- ===== 5.` marker line and the `-- ===== 6.` marker line (§5), and between the `-- ===== 6.` marker line and the `-- ===== 7.` marker line (§6). Keep the marker lines exactly as Task 1 wrote them.

Under `-- ===== 5. Procedures — customers (sp_SaveCustomer, sp_FetchCustomers, sp_FetchCustomerDetail, sp_DeleteCustomer)`:

```sql
-- ---------------------------------------------------------------------------
-- 5.1 sp_SaveCustomer — Name required; mobile OR email required; mobile
--     normalised (spaces/dashes stripped, then digits and + only); one live
--     customer per mobile per company (409). Insert takes the caller's
--     branch; update never moves the branch.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveCustomer
    @Id            INT            = 0,
    @CompId        INT,
    @BranchId      INT,
    @UserId        INT,
    @Name          NVARCHAR(200),
    @ContactPerson NVARCHAR(200)  = NULL,
    @Mobile        VARCHAR(20)    = NULL,
    @AltMobile     VARCHAR(20)    = NULL,
    @Email         NVARCHAR(200)  = NULL,
    @Address       NVARCHAR(500)  = NULL,
    @City          NVARCHAR(100)  = NULL,
    @State         NVARCHAR(100)  = NULL,
    @Pincode       VARCHAR(10)    = NULL,
    @Remarks       NVARCHAR(MAX)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Id = 0 AND (@BranchId IS NULL OR @BranchId <= 0)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'BranchId is required' AS ResponseMess; RETURN; END

    SET @Name          = NULLIF(LTRIM(RTRIM(@Name)), N'');
    SET @ContactPerson = NULLIF(LTRIM(RTRIM(@ContactPerson)), N'');
    SET @Email         = NULLIF(LTRIM(RTRIM(@Email)), N'');
    SET @Mobile        = NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(@Mobile)),    ' ', ''), '-', ''), '');
    SET @AltMobile     = NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(@AltMobile)), ' ', ''), '-', ''), '');

    IF @Name IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NULL AND @Email IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'A mobile number or an email is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NOT NULL AND @Mobile LIKE '%[^0-9+]%'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Mobile may contain digits and + only' AS ResponseMess; RETURN; END
    IF @AltMobile IS NOT NULL AND @AltMobile LIKE '%[^0-9+]%'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Alternate mobile may contain digits and + only' AS ResponseMess; RETURN; END
    IF @Email IS NOT NULL AND @Email NOT LIKE '%_@_%'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid email' AS ResponseMess; RETURN; END

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Customer not found' AS ResponseMess; RETURN; END

    -- One live customer per mobile per company; UX_tblCustomer_CompId_Mobile
    -- is the backstop for the race this check cannot see.
    IF @Mobile IS NOT NULL
       AND EXISTS (SELECT 1 FROM dbo.tblCustomer
                   WHERE CompId = @CompId AND Mobile = @Mobile AND IsActive = 1 AND Id <> @Id)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Another customer already has this mobile number' AS ResponseMess; RETURN; END

    BEGIN TRY
        IF @Id > 0
        BEGIN
            UPDATE dbo.tblCustomer
            SET Name = @Name, ContactPerson = @ContactPerson,
                Mobile = @Mobile, AltMobile = @AltMobile, Email = @Email,
                Address = @Address, City = @City, State = @State, Pincode = @Pincode,
                Remarks = @Remarks,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

            SELECT @Id AS Id, 200 AS ResponseCode, 'Customer updated successfully' AS ResponseMess;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @Name, @ContactPerson, @Mobile, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @Remarks, 1, @UserId, @UserId, GETDATE());

            SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id, 200 AS ResponseCode, 'Customer created successfully' AS ResponseMess;
        END
    END TRY
    BEGIN CATCH
        -- 2601 / 2627: the unique index caught a concurrent insert of the same mobile.
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @Id AS Id, 409 AS ResponseCode, 'Another customer already has this mobile number' AS ResponseMess;
        ELSE
            SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 5.2 sp_FetchCustomers — company-wide (the dedupe picker needs it), paged.
--     Search: Name / ContactPerson / Mobile / AltMobile / Email / City. A
--     digits-only term also matches a mobile typed with spaces or dashes.
--     @IsActive NULL = both live and soft-deleted rows.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchCustomers
    @CompId     INT,
    @PageNumber INT           = 1,
    @PageSize   INT           = 25,
    @SearchTerm NVARCHAR(200) = NULL,
    @BranchId   INT           = NULL,
    @IsActive   BIT           = 1
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1)  < 1 THEN 1  ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,  25)  < 1 THEN 25 ELSE @PageSize   END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    DECLARE @Digits VARCHAR(50) = CASE WHEN @SearchTerm IS NOT NULL
                                        AND REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') NOT LIKE '%[^0-9+]%'
                                       THEN REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') END;

    -- One predicate, one scan: the matching ids, then count and page from them.
    DECLARE @F TABLE (Id INT PRIMARY KEY, Name NVARCHAR(200));
    INSERT INTO @F (Id, Name)
    SELECT c.Id, c.Name
    FROM dbo.tblCustomer c
    WHERE c.CompId = @CompId
      AND (@IsActive IS NULL OR c.IsActive = @IsActive)
      AND (@BranchId IS NULL OR c.BranchId = @BranchId)
      AND (@SearchTerm IS NULL
           OR c.Name          LIKE '%' + @SearchTerm + '%'
           OR c.ContactPerson LIKE '%' + @SearchTerm + '%'
           OR c.Mobile        LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR c.AltMobile     LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR c.Email         LIKE '%' + @SearchTerm + '%'
           OR c.City          LIKE '%' + @SearchTerm + '%');

    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- RS1: the page, with complaint counts (company-wide — a customer is one record)
    SELECT c.Id, c.CompId, c.BranchId, b.BranchName,
           c.Name, c.ContactPerson, c.Mobile, c.AltMobile, c.Email,
           c.Address, c.City, c.State, c.Pincode, c.Remarks, c.IsActive,
           ISNULL(tk.OpenTickets, 0) AS OpenTickets,
           ISNULL(tk.TotalTickets, 0) AS TotalTickets,
           tk.LastTicketAt,
           c.CreatedAt, c.UpdatedAt,
           200 AS ResponseCode, 'Customers retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblCustomer c ON c.Id = f.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = c.BranchId
    OUTER APPLY (
        SELECT COUNT(*) AS TotalTickets,
               SUM(CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END) AS OpenTickets,
               MAX(t.CreatedAt) AS LastTicketAt
        FROM dbo.tblTicket t
        JOIN dbo.tblLookup st ON st.Id = t.StatusId
        WHERE t.CompId = c.CompId AND t.CustomerId = c.Id
    ) tk
    ORDER BY f.Name, f.Id
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- RS2: pagination
    SELECT @PageNumber AS CurrentPage,
           @PageSize   AS PageSize,
           @Total      AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages;
END
GO


-- ---------------------------------------------------------------------------
-- 5.3 sp_FetchCustomerDetail — RS1 the customer (company-wide, same columns
--     as sp_FetchCustomers); RS2 that customer's complaints UNDER THE
--     CALLER'S SCOPE (branch AND owner, OR assignee/creator) — a Self agent
--     sees only their own complaints of this customer.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchCustomerDetail
    @CompId                  INT,
    @CustomerId              INT,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    -- RS1: the customer
    SELECT c.Id, c.CompId, c.BranchId, b.BranchName,
           c.Name, c.ContactPerson, c.Mobile, c.AltMobile, c.Email,
           c.Address, c.City, c.State, c.Pincode, c.Remarks, c.IsActive,
           ISNULL(tk.OpenTickets, 0) AS OpenTickets,
           ISNULL(tk.TotalTickets, 0) AS TotalTickets,
           tk.LastTicketAt,
           c.CreatedAt, c.UpdatedAt,
           200 AS ResponseCode, 'Customer detail retrieved successfully' AS ResponseMess
    FROM dbo.tblCustomer c
    LEFT JOIN dbo.tblBranch b ON b.Id = c.BranchId
    OUTER APPLY (
        SELECT COUNT(*) AS TotalTickets,
               SUM(CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END) AS OpenTickets,
               MAX(t.CreatedAt) AS LastTicketAt
        FROM dbo.tblTicket t
        JOIN dbo.tblLookup st ON st.Id = t.StatusId
        WHERE t.CompId = c.CompId AND t.CustomerId = c.Id
    ) tk
    WHERE c.Id = @CustomerId AND c.CompId = @CompId;

    -- RS2: their complaints, scoped
    SELECT t.Id, t.TicketNo, t.Subject,
           t.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           t.Priority, p.Value AS PriorityName,
           t.AssignedTo, a.FullName AS AssigneeName,
           t.DueAt,
           CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           t.CreatedAt, t.ResolvedAt, t.ClosedAt
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st     ON st.Id = t.StatusId
    LEFT JOIN dbo.tblLookup p ON p.Id  = t.Priority
    LEFT JOIN dbo.tblUser a   ON a.Id  = t.AssignedTo
    WHERE t.CompId = @CompId AND t.CustomerId = @CustomerId
      AND (
            (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
          )
    ORDER BY t.CreatedAt DESC, t.Id DESC;
END
GO


-- ---------------------------------------------------------------------------
-- 5.4 sp_DeleteCustomer — soft. 409 while any complaint references it: the
--     FK would refuse anyway, but the message should say why.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_DeleteCustomer
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN SELECT ISNULL(@Id, 0) AS Id, 400 AS ResponseCode, 'Id is required' AS ResponseMess; RETURN; END
    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Customer not found' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblTicket WHERE CustomerId = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Customer has complaints and cannot be deleted' AS ResponseMess; RETURN; END

    UPDATE dbo.tblCustomer SET IsActive = 0, UpdatedAt = GETDATE() WHERE Id = @Id AND CompId = @CompId;

    SELECT @Id AS Id, 200 AS ResponseCode, 'Customer deleted successfully' AS ResponseMess;
END
GO

```

Under `-- ===== 6. Procedures — tickets read/write (sp_SaveTicket, sp_FetchTickets, sp_FetchTicketDetail, sp_DeleteTicket, sp_SaveLookup, sp_FetchLookups)`:

```sql
-- ---------------------------------------------------------------------------
-- 6.1 sp_SaveTicket
--   Insert : CustomerId (active, same company) + Subject required; status =
--            first 'open' by SortOrder; DueAt = now + TatHours(priority);
--            AssignedAt when assigned; history opening row; assignment
--            opening row; activity 'created'; ticket_assigned notification.
--   Update : IGNORES @AssignedTo (sp_TransferTicket only) and never touches
--            StatusId / ResolvedAt / ClosedAt (sp_SetTicketStatus only).
--            CustomerId may change. A priority change re-stamps DueAt from
--            the same anchor the old due date was computed from, so a
--            reopened clock is not reset to creation.
--   TicketNo generation and the CustomJSON MERGE are verbatim from the
--   previous body (050 / 067).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveTicket
    @Id            INT           = 0,
    @CompId        INT,
    @BranchId      INT,
    @UserId        INT,
    @CustomerId    INT           = NULL,
    @Subject       NVARCHAR(200) = NULL,
    @ContactPerson NVARCHAR(200) = NULL,
    @Contact       VARCHAR(100)  = NULL,
    @ChannelId     INT           = NULL,
    @CategoryId    INT           = NULL,
    @Priority      INT           = NULL,
    @ProductId     INT           = NULL,
    @AssignedTo    INT           = NULL,
    @LinkedLeadId  INT           = NULL,
    @Description   NVARCHAR(MAX) = NULL,
    @CustomJSON    NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Id = 0 AND (@BranchId IS NULL OR @BranchId <= 0)
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'BranchId is required' AS ResponseMess; RETURN; END

    -- 0 / negative ids mean "none"
    IF @CustomerId   <= 0 SET @CustomerId   = NULL;
    IF @ChannelId    <= 0 SET @ChannelId    = NULL;
    IF @CategoryId   <= 0 SET @CategoryId   = NULL;
    IF @Priority     <= 0 SET @Priority     = NULL;
    IF @ProductId    <= 0 SET @ProductId    = NULL;
    IF @AssignedTo   <= 0 SET @AssignedTo   = NULL;
    IF @LinkedLeadId <= 0 SET @LinkedLeadId = NULL;
    SET @Subject       = NULLIF(LTRIM(RTRIM(@Subject)), N'');
    SET @ContactPerson = NULLIF(LTRIM(RTRIM(@ContactPerson)), N'');
    SET @Contact       = NULLIF(LTRIM(RTRIM(@Contact)), '');

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    IF @CustomerId IS NULL
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'CustomerId is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @CustomerId AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 404 AS ResponseCode, 'Customer not found' AS ResponseMess; RETURN; END
    IF @Subject IS NULL
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Subject is required' AS ResponseMess; RETURN; END
    IF @Priority IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @Priority AND CompId = @CompId AND Kind = 'priority')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid priority' AS ResponseMess; RETURN; END
    IF @CategoryId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @CategoryId AND CompId = @CompId AND Kind = 'ticket_category')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid category' AS ResponseMess; RETURN; END
    IF @ChannelId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ChannelId AND CompId = @CompId AND Kind = 'ticket_channel')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid channel' AS ResponseMess; RETURN; END
    IF @ProductId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id = @ProductId AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid product' AS ResponseMess; RETURN; END
    IF @Id = 0 AND @AssignedTo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @AssignedTo AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid assignee' AS ResponseMess; RETURN; END
    IF @LinkedLeadId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id = @LinkedLeadId AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid linked lead' AS ResponseMess; RETURN; END

    DECLARE @Now DATETIME = GETDATE();
    DECLARE @Tat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @Priority);

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @TicketId INT = @Id;
        DECLARE @TicketNo VARCHAR(30);
        DECLARE @ActType VARCHAR(30), @ActSummary NVARCHAR(500);

        IF @Id > 0
        BEGIN
            DECLARE @OldPriority INT, @OldDueAt DATETIME, @CreatedAt DATETIME;
            SELECT @OldPriority = Priority, @OldDueAt = DueAt, @CreatedAt = CreatedAt, @TicketNo = TicketNo
            FROM dbo.tblTicket WHERE Id = @Id AND CompId = @CompId;

            -- Priority change: anchor = when the current clock started
            -- (DueAt - OldTat when both are known, else CreatedAt), so a
            -- reopened ticket keeps its reopen anchor.
            DECLARE @NewDueAt DATETIME = @OldDueAt;
            IF ISNULL(@OldPriority, -1) <> ISNULL(@Priority, -1)
            BEGIN
                DECLARE @OldTat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @OldPriority);
                DECLARE @Anchor DATETIME = CASE WHEN @OldTat IS NOT NULL AND @OldDueAt IS NOT NULL
                                                THEN DATEADD(HOUR, -@OldTat, @OldDueAt)
                                                ELSE @CreatedAt END;
                SET @NewDueAt = CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Anchor) END;
            END

            UPDATE dbo.tblTicket
            SET CustomerId = @CustomerId, Subject = @Subject,
                ContactPerson = @ContactPerson, Contact = @Contact,
                ChannelId = @ChannelId, CategoryId = @CategoryId,
                Priority = @Priority, ProductId = @ProductId,
                -- Guarded: a client that does not know about the lead link
                -- must not be able to sever it by omitting the field.
                LinkedLeadId = ISNULL(@LinkedLeadId, LinkedLeadId),
                DueAt = @NewDueAt,
                Description = @Description,
                EditBy = @UserId, UpdatedAt = @Now
            WHERE Id = @Id AND CompId = @CompId;

            SET @ActType = 'updated';
            SET @ActSummary = N'Complaint details updated';
        END
        ELSE
        BEGIN
            DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                                     WHERE CompId = @CompId AND Kind = 'ticket_status' AND Code = 'open' AND IsActive = 1
                                     ORDER BY SortOrder, Id);
            IF @StatusId IS NULL
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 500 AS ResponseCode, 'No ticket_status lookups configured for this company' AS ResponseMess;
                RETURN;
            END

            -- TicketNo: per-company sequence. ponytail: COUNT+1 inside the tran
            -- is fine at expected volume; swap to a sequence table if two
            -- concurrent inserts ever collide on the unique TicketNo.
            DECLARE @Seq INT = (SELECT COUNT(*) + 1 FROM dbo.tblTicket WHERE CompId=@CompId);
            SET @TicketNo = 'TKT-' + RIGHT('000000' + CAST(@Seq AS VARCHAR(10)), 6);

            INSERT INTO dbo.tblTicket
                (CompId, BranchId, TicketNo, CustomerId, Subject, ContactPerson, Contact,
                 ChannelId, CategoryId, Priority, ProductId, StatusId,
                 AssignedTo, AssignedAt, LinkedLeadId, DueAt,
                 Description, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @TicketNo, @CustomerId, @Subject, @ContactPerson, @Contact,
                 @ChannelId, @CategoryId, @Priority, @ProductId, @StatusId,
                 @AssignedTo, CASE WHEN @AssignedTo IS NULL THEN NULL ELSE @Now END, @LinkedLeadId,
                 CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Now) END,
                 @Description, @UserId, @UserId, @Now);

            SET @TicketId = CAST(SCOPE_IDENTITY() AS INT);

            -- Opening row of the status history (NULL -> first status).
            INSERT INTO dbo.tblTicketStatusHistory (CompId, TicketId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
            VALUES (@CompId, @TicketId, NULL, @StatusId, @UserId, @Now);

            -- Opening assignment, so RS4 shows who it landed on first.
            IF @AssignedTo IS NOT NULL
                INSERT INTO dbo.tblTicketAssignment
                    (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
                VALUES
                    (@CompId, @TicketId, NULL, @AssignedTo, NULL, @BranchId, NULL, N'Assigned on creation', @UserId, @Now);

            SET @ActType = 'created';
            SET @ActSummary = N'Complaint created';
        END

        -- custom-field values (shared engine, Entity='ticket')
        IF @CustomJSON IS NOT NULL AND LTRIM(RTRIM(@CustomJSON)) NOT IN ('', '[]')
        BEGIN
            ;WITH src AS (
                SELECT j.fieldId,
                       CASE WHEN j.type IN ('dropdown','text') THEN j.val END AS ValueText,
                       CASE WHEN j.type = 'number'  THEN TRY_CONVERT(DECIMAL(18,2), j.val)
                            WHEN j.type = 'checkbox' THEN CASE WHEN j.val='true' THEN 1 ELSE 0 END END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CONVERT(DATETIME, j.val) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                     WITH (fieldId INT '$.fieldId', type VARCHAR(20) '$.type', val NVARCHAR(MAX) '$.value') j
                WHERE j.fieldId IS NOT NULL
            )
            MERGE dbo.tblCustomFieldValue AS tgt
            USING src ON tgt.CompId=@CompId AND tgt.Entity='ticket'
                      AND tgt.EntityId=@TicketId AND tgt.FieldId=src.fieldId
            WHEN MATCHED THEN UPDATE SET ValueText=src.ValueText, ValueNumber=src.ValueNumber, ValueDate=src.ValueDate
            WHEN NOT MATCHED THEN INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                 VALUES (@CompId, 'ticket', @TicketId, src.fieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = @ActType, @Summary = @ActSummary, @MetaJSON = NULL;

        IF @Id = 0 AND @AssignedTo IS NOT NULL
        BEGIN
            -- The creation assignment on the timeline, then the in-app ping
            -- (sp_CreateNotification skips the actor assigning to themself).
            DECLARE @AssigneeName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @AssignedTo), N'');
            DECLARE @AssignSummary NVARCHAR(500) = N'Assigned to ' + @AssigneeName + N' on creation';
            DECLARE @AssignMeta NVARCHAR(MAX) = (SELECT CAST(NULL AS INT) AS fromUserId, @AssignedTo AS toUserId,
                                                        CAST(NULL AS INT) AS fromBranchId, @BranchId AS toBranchId,
                                                        CAST(NULL AS INT) AS reasonId, N'Assigned on creation' AS remarks
                                                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
            INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
                @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
                @Type = 'assigned', @Summary = @AssignSummary, @MetaJSON = @AssignMeta;

            DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
            DECLARE @NtfBody NVARCHAR(1000) = LEFT(@TicketNo + N' — ' + @Subject, 1000);
            INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                @UserId = @AssignedTo, @Type = 'ticket_assigned', @EntityType = 'ticket', @EntityId = @TicketId,
                @ActorUserId = @UserId, @Title = 'Complaint assigned to you', @Body = @NtfBody,
                @CompId = @CompId, @BranchId = @BranchId;
        END

        COMMIT TRANSACTION;
        SELECT @TicketId AS Id, @TicketNo AS TicketNo, 200 AS ResponseCode, 'Ticket saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 6.2 sp_FetchTickets — the list. Scope predicate verbatim from 080 (branch
--     AND owner, OR assignee/creator); every filter narrows inside it.
--       @StatusCode  : a code, or 'active' = open + onhold
--       @Overdue     : Code IN (open, onhold) AND DueAt < now
--       @Escalated   : non-terminal AND (EscalatedTo = @UserId OR overdue)
--       @Unassigned  : AssignedTo IS NULL
--       @FromDate/@ToDate : CreatedAt window, @ToDate inclusive
--     Search: TicketNo / Subject / customer Name / customer Mobile /
--     ContactPerson / Contact. Order: overdue first, nearest due (undated
--     last), newest.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTickets
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL,
    @StatusId                INT           = NULL,
    @StatusCode              VARCHAR(30)   = NULL,
    @Priority                INT           = NULL,
    @CategoryId              INT           = NULL,
    @ChannelId               INT           = NULL,
    @ProductId               INT           = NULL,
    @CustomerId              INT           = NULL,
    @AssignedTo              INT           = NULL,
    @Overdue                 BIT           = 0,
    @Escalated               BIT           = 0,
    @Unassigned              BIT           = 0,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1)  < 1 THEN 1  ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,  25)  < 1 THEN 25 ELSE @PageSize   END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    SET @StatusCode = NULLIF(LTRIM(RTRIM(@StatusCode)), '');
    SET @Overdue    = ISNULL(@Overdue, 0);
    SET @Escalated  = ISNULL(@Escalated, 0);
    SET @Unassigned = ISNULL(@Unassigned, 0);
    DECLARE @ToEx   DATETIME = CASE WHEN @ToDate IS NULL THEN NULL ELSE DATEADD(DAY, 1, CAST(@ToDate AS DATETIME)) END;
    DECLARE @Now    DATETIME = GETDATE();
    DECLARE @Digits VARCHAR(50) = CASE WHEN @SearchTerm IS NOT NULL
                                        AND REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') NOT LIKE '%[^0-9+]%'
                                       THEN REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') END;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    -- One predicate, one scan: the matching ids with their sort keys.
    DECLARE @F TABLE (Id INT PRIMARY KEY, IsOverdue BIT, DueSort DATETIME, CreatedAt DATETIME);
    INSERT INTO @F (Id, IsOverdue, DueSort, CreatedAt)
    SELECT t.Id, o.IsOverdue, ISNULL(t.DueAt, '9999-12-31'), t.CreatedAt
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st   ON st.Id = t.StatusId
    JOIN dbo.tblCustomer c  ON c.Id  = t.CustomerId
    CROSS APPLY (SELECT CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue) o
    WHERE t.CompId = @CompId
      AND (@BranchId   IS NULL OR t.BranchId   = @BranchId)
      AND (@StatusId   IS NULL OR t.StatusId   = @StatusId)
      AND (@StatusCode IS NULL OR st.Code = @StatusCode
                              OR (@StatusCode = 'active' AND st.Code IN ('open', 'onhold')))
      AND (@Priority   IS NULL OR t.Priority   = @Priority)
      AND (@CategoryId IS NULL OR t.CategoryId = @CategoryId)
      AND (@ChannelId  IS NULL OR t.ChannelId  = @ChannelId)
      AND (@ProductId  IS NULL OR t.ProductId  = @ProductId)
      AND (@CustomerId IS NULL OR t.CustomerId = @CustomerId)
      AND (@AssignedTo IS NULL OR t.AssignedTo = @AssignedTo)
      AND (@Unassigned = 0 OR t.AssignedTo IS NULL)
      AND (@Overdue    = 0 OR o.IsOverdue = 1)
      AND (@Escalated  = 0 OR (st.Code IN ('open', 'onhold') AND (t.EscalatedTo = @UserId OR o.IsOverdue = 1)))
      AND (@FromDate IS NULL OR t.CreatedAt >= @FromDate)
      AND (@ToEx     IS NULL OR t.CreatedAt <  @ToEx)
      AND (@SearchTerm IS NULL
           OR t.TicketNo      LIKE '%' + @SearchTerm + '%'
           OR t.Subject       LIKE '%' + @SearchTerm + '%'
           OR c.Name          LIKE '%' + @SearchTerm + '%'
           OR c.Mobile        LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR t.ContactPerson LIKE '%' + @SearchTerm + '%'
           OR t.Contact       LIKE '%' + @SearchTerm + '%')
      AND (
            (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
          );

    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- RS1: the page, every column + labels
    SELECT t.Id, t.CompId, t.BranchId, b.BranchName,
           t.TicketNo, t.Subject,
           t.CustomerId, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
           t.ContactPerson, t.Contact,
           t.ChannelId,  ch.Value AS ChannelName,
           t.CategoryId, cat.Value AS CategoryName,
           t.Priority,   pr.Value AS PriorityName,
           t.ProductId,  p.Name AS ProductName,
           t.StatusId,   st.Value AS StatusName, st.Code AS StatusCode,
           t.AssignedTo, a.FullName AS AssigneeName, a.Avatar AS AssigneeAvatar, t.AssignedAt,
           t.DueAt, f.IsOverdue,
           DATEDIFF(HOUR, t.CreatedAt, COALESCE(t.ClosedAt, t.ResolvedAt, @Now)) AS AgeHours,
           t.EscalatedTo, e.FullName AS EscalatedToName, t.EscalatedAt,
           t.LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, r.Value AS ResolutionName,
           t.Description,
           t.CreatedBy, t.CreatedAt, t.UpdatedAt,
           200 AS ResponseCode, 'Tickets retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblTicket t        ON t.Id   = f.Id
    JOIN dbo.tblLookup st       ON st.Id  = t.StatusId
    JOIN dbo.tblCustomer c      ON c.Id   = t.CustomerId
    LEFT JOIN dbo.tblLookup ch  ON ch.Id  = t.ChannelId
    LEFT JOIN dbo.tblLookup cat ON cat.Id = t.CategoryId
    LEFT JOIN dbo.tblLookup pr  ON pr.Id  = t.Priority
    LEFT JOIN dbo.tblLookup r   ON r.Id   = t.ResolutionId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = t.ProductId
    LEFT JOIN dbo.tblUser a     ON a.Id   = t.AssignedTo
    LEFT JOIN dbo.tblUser e     ON e.Id   = t.EscalatedTo
    LEFT JOIN dbo.tblBranch b   ON b.Id   = t.BranchId
    ORDER BY f.IsOverdue DESC, f.DueSort ASC, f.CreatedAt DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- RS2: pagination
    SELECT @PageNumber AS CurrentPage,
           @PageSize   AS PageSize,
           @Total      AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages;
END
GO


-- ---------------------------------------------------------------------------
-- 6.3 sp_FetchTicketDetail — 5 result sets
--   1 core (+labels, customer card, PreviousTickets)   2 custom values
--   3 timeline (+UserName/UserAvatar)                  4 assignment history
--   5 linked lead (empty when none)
--   permission.js reads RS1[0].AssignedTo / CreatedBy / BranchId — kept.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTicketDetail
    @CompId   INT,
    @TicketId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();

    -- 1) core
    SELECT t.Id, t.CompId, t.BranchId, b.BranchName,
           t.TicketNo, t.Subject,
           t.CustomerId, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
           t.ContactPerson, t.Contact,
           t.ChannelId,  ch.Value AS ChannelName,
           t.CategoryId, cat.Value AS CategoryName,
           t.Priority,   pr.Value AS PriorityName,
           t.ProductId,  p.Name AS ProductName,
           t.StatusId,   st.Value AS StatusName, st.Code AS StatusCode,
           t.AssignedTo, a.FullName AS AssigneeName, a.Avatar AS AssigneeAvatar, t.AssignedAt,
           t.DueAt,
           CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           DATEDIFF(HOUR, t.CreatedAt, COALESCE(t.ClosedAt, t.ResolvedAt, @Now)) AS AgeHours,
           t.EscalatedTo, e.FullName AS EscalatedToName, t.EscalatedAt,
           t.LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, r.Value AS ResolutionName,
           t.Description,
           t.CreatedBy, t.CreatedAt, t.UpdatedAt,
           t.EditBy,
           c.ContactPerson AS CustomerContactPerson, c.Email AS CustomerEmail,
           c.City AS CustomerCity, c.Address AS CustomerAddress,
           (SELECT COUNT(*) FROM dbo.tblTicket x
             WHERE x.CompId = t.CompId AND x.CustomerId = t.CustomerId AND x.Id <> t.Id) AS PreviousTickets,
           200 AS ResponseCode, 'Ticket detail retrieved successfully' AS ResponseMess
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st       ON st.Id  = t.StatusId
    JOIN dbo.tblCustomer c      ON c.Id   = t.CustomerId
    LEFT JOIN dbo.tblLookup ch  ON ch.Id  = t.ChannelId
    LEFT JOIN dbo.tblLookup cat ON cat.Id = t.CategoryId
    LEFT JOIN dbo.tblLookup pr  ON pr.Id  = t.Priority
    LEFT JOIN dbo.tblLookup r   ON r.Id   = t.ResolutionId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = t.ProductId
    LEFT JOIN dbo.tblUser a     ON a.Id   = t.AssignedTo
    LEFT JOIN dbo.tblUser e     ON e.Id   = t.EscalatedTo
    LEFT JOIN dbo.tblBranch b   ON b.Id   = t.BranchId
    WHERE t.Id = @TicketId AND t.CompId = @CompId;

    -- 2) custom values
    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type, v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId = @CompId AND v.Entity = 'ticket' AND v.EntityId = @TicketId
    ORDER BY d.SortOrder;

    -- 3) timeline
    SELECT a.Id, a.TicketId, a.UserId, u.FullName AS UserName, u.Avatar AS UserAvatar,
           a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblTicketActivity a
    LEFT JOIN dbo.tblUser u ON u.Id = a.UserId
    WHERE a.CompId = @CompId AND a.TicketId = @TicketId
    ORDER BY a.CreatedAt DESC, a.Id DESC;

    -- 4) assignment history, newest first
    SELECT a.Id,
           a.FromUserId, fu.FullName AS FromUserName,
           a.ToUserId,   tu.FullName AS ToUserName,
           a.FromBranchId, fb.BranchName AS FromBranchName,
           a.ToBranchId,   tb.BranchName AS ToBranchName,
           a.ReasonId, rs.Value AS Reason, a.Remarks,
           a.AssignedBy, ab.FullName AS AssignedByName, a.AssignedAt
    FROM dbo.tblTicketAssignment a
    LEFT JOIN dbo.tblUser fu   ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu   ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblUser ab   ON ab.Id = a.AssignedBy
    LEFT JOIN dbo.tblBranch fb ON fb.Id = a.FromBranchId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    LEFT JOIN dbo.tblLookup rs ON rs.Id = a.ReasonId
    WHERE a.CompId = @CompId AND a.TicketId = @TicketId
    ORDER BY a.AssignedAt DESC, a.Id DESC;

    -- 5) linked-lead summary (empty set when no link). Leads are flat: StatusId.
    SELECT l.Id, l.Name, l.MobileNo, l.Email, l.StatusId
    FROM dbo.tblLeads l
    INNER JOIN dbo.tblTicket t ON t.LinkedLeadId = l.Id
    WHERE t.Id = @TicketId AND t.CompId = @CompId AND l.CompId = @CompId;
END
GO


-- ---------------------------------------------------------------------------
-- 6.4 sp_DeleteTicket — + assignment, history and call rows. No DB-level FKs
--     on these children: clear them explicitly, children before parent.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_DeleteTicket
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN SELECT ISNULL(@Id, 0) AS Id, 400 AS ResponseCode, 'Id is required' AS ResponseMess; RETURN; END
    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DELETE FROM dbo.tblCustomFieldValue     WHERE CompId = @CompId AND Entity = 'ticket' AND EntityId = @Id;
        DELETE FROM dbo.tblTicketActivity       WHERE CompId = @CompId AND TicketId = @Id;
        DELETE FROM dbo.tblTicketAssignment     WHERE CompId = @CompId AND TicketId = @Id;
        DELETE FROM dbo.tblTicketStatusHistory  WHERE CompId = @CompId AND TicketId = @Id;
        DELETE FROM dbo.tblCall                 WHERE CompId = @CompId AND TicketId = @Id;
        DELETE FROM dbo.tblTicket               WHERE Id = @Id AND CompId = @CompId;

        COMMIT TRANSACTION;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Ticket deleted successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 6.5 sp_SaveLookup — + @TatHours (stored for any kind, meaningful on
--     'priority'; <= 0 means none). ticket_status rows carry a code the app
--     branches on: default 'open', anything outside the set is refused —
--     same rule lead_status has had since 071.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveLookup
    @Id        INT,
    @CompId    INT,
    @Kind      VARCHAR(30),
    @Value     NVARCHAR(200),
    @SortOrder INT         = 0,
    @Code      VARCHAR(30) = NULL,
    @TatHours  INT         = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @Kind IS NULL OR LTRIM(RTRIM(@Kind)) = ''
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Kind is required' AS ResponseMess; RETURN; END
    IF @Value IS NULL OR LTRIM(RTRIM(@Value)) = ''
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Value is required' AS ResponseMess; RETURN; END

    IF (@Code IS NOT NULL AND LTRIM(RTRIM(@Code)) = '') SET @Code = NULL;
    IF @TatHours IS NOT NULL AND @TatHours <= 0 SET @TatHours = NULL;   -- no TAT = never overdue

    -- A lead status always carries a state. Labels are the company's; codes
    -- are ours, and the app branches on them.
    IF @Kind = 'lead_status'
    BEGIN
        IF @Code IS NULL SET @Code = 'open';
        IF @Code NOT IN ('open','qualified','lost','junk','converted')
        BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Code must be one of open, qualified, lost, junk, converted' AS ResponseMess; RETURN; END
    END

    -- Same for a complaint status. active = open + onhold; terminal = the rest.
    IF @Kind = 'ticket_status'
    BEGIN
        IF @Code IS NULL SET @Code = 'open';
        IF @Code NOT IN ('open','onhold','resolved','closed','rejected')
        BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Code must be one of open, onhold, resolved, closed, rejected' AS ResponseMess; RETURN; END
    END

    IF @Id = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.tblLookup WHERE CompId=@CompId AND Kind=@Kind AND Value=@Value AND IsActive=1)
        BEGIN SELECT 0 AS Id, 409 AS ResponseCode, 'A lookup with this value already exists' AS ResponseMess; RETURN; END

        INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, Code, TatHours)
        VALUES (@CompId, @Kind, @Value, ISNULL(@SortOrder,0), @Code, @TatHours);

        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Lookup created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId)
        BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Lookup not found' AS ResponseMess; RETURN; END

        UPDATE dbo.tblLookup
        SET Kind = @Kind, Value = @Value, SortOrder = ISNULL(@SortOrder,0), Code = @Code, TatHours = @TatHours
        WHERE Id=@Id AND CompId=@CompId;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Lookup updated successfully' AS ResponseMess;
    END
END
GO


-- ---------------------------------------------------------------------------
-- 6.6 sp_FetchLookups — + TatHours
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLookups
    @CompId INT,
    @Kind   VARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, CompId, Kind, Value, SortOrder, IsActive, Code, TatHours,
           200 AS ResponseCode, 'Lookups retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup
    WHERE CompId = @CompId AND Kind = @Kind AND IsActive = 1
    ORDER BY SortOrder, Id;
END
GO

```

- [ ] **Step 3: Read the file back**

Run: `cd backend && grep -n "^-- ===== \|^CREATE OR ALTER PROC" sql/086_support_rebuild.sql`
Expected: the nine `-- =====` markers still in order; between `5.` and `6.` exactly `sp_SaveCustomer, sp_FetchCustomers, sp_FetchCustomerDetail, sp_DeleteCustomer`; between `6.` and `7.` exactly `sp_SaveTicket, sp_FetchTickets, sp_FetchTicketDetail, sp_DeleteTicket, sp_SaveLookup, sp_FetchLookups`; nothing yet between `7.` and `8.`.

Run: `cd backend && grep -c "^GO$" sql/086_support_rebuild.sql && grep -c "^CREATE OR ALTER PROC dbo\." sql/086_support_rebuild.sql`
Expected: `32` (Task 1's 22 + 10) and `10`.

Run: `cd backend && grep -n "StageId\|PipelineId\|CustomerName\b" sql/086_support_rebuild.sql | grep -v "^\S*:\s*--" | grep -n "CREATE OR ALTER" ; grep -c "RIGHT('000000' + CAST(@Seq AS VARCHAR(10)), 6)" sql/086_support_rebuild.sql; grep -c "MERGE dbo.tblCustomFieldValue AS tgt" sql/086_support_rebuild.sql`
Expected: the first prints nothing (no new proc body references a dropped column — `CustomerName` appears in the new procs only as an alias, `c.Name AS CustomerName`, which is fine and is what the §8.2 guard tolerates; the guard greps `StageId` / `PipelineId` / `tblPipeline` only); then `1` and `1` (the TicketNo generator and the custom-field MERGE, verbatim, once each).

Read §6.1 once against the contract and confirm by eye: the `UPDATE` sets no `AssignedTo`, no `StatusId`, no `AssignedAt`; the `INSERT` column list and `VALUES` list have the same 20 entries; every early `RETURN` row carries the four columns `Id, TicketNo, ResponseCode, ResponseMess`.

- [ ] **Step 4: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: the file path and the three `grep` result lines from Step 3; the nine decisions at the top of this task (single-predicate paging, NULL-last `DueAt`, digits search, id validation set, opening assignment row, update never touches assignment/status, `AgeHours` rule, `TatHours <= 0` = none, delete scope); that §7 is still a bare marker (Task 3) and the file is not appliable until then; anything Step 1 returned that differed from the annotated expectations.

---


### Task 3: `086` part C — lifecycle SPs (section 7)

**Files:**
- Modify: `backend/sql/086_support_rebuild.sql` — insert the nine lifecycle procs directly under the line `-- ===== 7. Procedures — lifecycle (…)` and above the line `-- ===== 8. Drop pipeline engine (…)`. Task 1 wrote both marker lines with nothing between them; Task 2 filled §5 and §6 the same way. Nothing else in the file moves — no marker is edited, §8 and §9 are Task 1's and stay byte-for-byte as they are.
- Test: no local SQL execution exists. The gate is (a) read-only MCP checks of the procs being replaced and the two loggers being called (Step 1), (b) `grep`/`awk` read-back of the section range, its `GO` batching and the forbidden-string rule (Step 3), (c) the §9.5 dry run Task 1 already wrote — which calls `sp_ResolveTicket` (400 + 200), `sp_ReopenTicket` (403 + 200), `sp_RejectTicket` (400), `sp_EscalateTicket` (400) and asserts the timeline and history counts — plus (d) the standalone post-apply lifecycle block in Step 4, which exercises the paths §9.5 does not.

**Interfaces:**

- Consumes — **from Task 1** (same file, §1–§4, applied before these procs run): `dbo.tblTicket (Id, CompId INT NOT NULL, BranchId INT NOT NULL, TicketNo VARCHAR(30) NOT NULL, CustomerId INT NOT NULL, Subject NVARCHAR(200) NOT NULL, ContactPerson, Contact VARCHAR(100), ChannelId, CategoryId, Priority, ProductId, StatusId INT NOT NULL, AssignedTo, AssignedAt, LinkedLeadId, DueAt, ResolvedAt, ClosedAt, ResolutionId, EscalatedTo, EscalatedAt, Description, CreatedBy, EditBy, CreatedAt, UpdatedAt)`; `dbo.tblTicketStatusHistory (Id, CompId, TicketId, FromStatusId NULL, ToStatusId, ChangedBy, ChangedAt)`; `dbo.tblTicketAssignment (Id, CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks NVARCHAR(500) NOT NULL, AssignedBy, AssignedAt)`; `dbo.tblLookup (Id, CompId, Kind VARCHAR(30), Value NVARCHAR(200), SortOrder, IsActive, Code VARCHAR(30), TatHours INT NULL)` with `Kind = 'ticket_status'` carrying `Code ∈ {open, onhold, resolved, closed, rejected}`, and the live kinds `priority` (`TatHours` after §3), `resolution`, `transfer_reason`.
- Consumes — **live, unchanged** (verified 2026-09-16 on `eCRM+`): `dbo.sp_LogTicketActivity (@CompId INT, @TicketId INT, @UserId INT, @Type VARCHAR(30), @Summary NVARCHAR(500) = NULL, @MetaJSON NVARCHAR(MAX) = NULL)` → one row `Id, ResponseCode, ResponseMess`; `dbo.sp_CreateNotification (@UserId INT, @Type VARCHAR(40), @EntityType VARCHAR(20), @EntityId BIGINT, @ActorUserId INT = NULL, @Title VARCHAR(200), @Body NVARCHAR(1000) = NULL, @CompId BIGINT, @BranchId BIGINT, @SkipSelf BIT = 1)` → one row `ResponseCode, ResponseMess, NotificationId, UserId, Type` (skip-self is built in); `dbo.tblUser (Id INT, FullName VARCHAR(200), JobTitle VARCHAR(100), BranchId BIGINT, ReportsTo INT, IsActive BIT, CompId BIGINT)`; `dbo.tblBranch (Id BIGINT, BranchName VARCHAR(50))`; `dbo.tblTicketActivity (…, Type VARCHAR(30), Summary NVARCHAR(500), MetaJSON NVARCHAR(MAX))`.
- Produces (signatures **verbatim from the plan's Contracts block**; Tasks 7–8 call these, Task 10 verifies them against `sys.parameters`):
  - `sp_SetTicketStatus @CompId INT, @TicketId INT, @StatusId INT, @UserId INT, @ResolutionId INT = NULL, @Remarks NVARCHAR(1000) = NULL, @AllowReopen BIT = 0` → `Id, ResponseCode, ResponseMess` (400 missing arg / missing resolution / missing remarks / invalid resolution · 403 reopen without the gate · 404 ticket or status · 200 changed · 200 no-op)
  - `sp_ResolveTicket @CompId INT, @TicketId INT, @ResolutionId INT, @Remarks NVARCHAR(1000), @UserId INT` → engine row
  - `sp_CloseTicket @CompId INT, @TicketId INT, @UserId INT, @ResolutionId INT = NULL, @Remarks NVARCHAR(1000) = NULL` → engine row
  - `sp_RejectTicket @CompId INT, @TicketId INT, @Remarks NVARCHAR(1000), @UserId INT` → engine row
  - `sp_ReopenTicket @CompId INT, @TicketId INT, @Remarks NVARCHAR(1000), @UserId INT, @AllowReopen BIT = 0` → engine row
  - `sp_TransferTicket @CompId INT, @TicketId INT, @ToUserId INT = NULL, @ToBranchId INT = NULL, @ReasonId INT, @Remarks NVARCHAR(500), @UserId INT` → `Id, ResponseCode, ResponseMess`
  - `sp_BulkTransferTickets @CompId INT, @TicketIdsJson NVARCHAR(MAX), @ToUserId INT = NULL, @ToBranchId INT = NULL, @ReasonId INT, @Remarks NVARCHAR(500), @UserId INT` → `Transferred, Skipped, ResponseCode, ResponseMess`
  - `sp_EscalateTicket @CompId INT, @TicketId INT, @ToUserId INT, @Remarks NVARCHAR(1000), @UserId INT` → `Id, ResponseCode, ResponseMess`
  - `sp_FetchEscalationTargets @CompId INT, @UserId INT` → RS1 `Id, FullName, JobTitle, BranchId, BranchName, Depth, ResponseCode, ResponseMess` (nearest first, `Depth = 1` is the direct manager)
  - Rows written here: `dbo.tblTicketStatusHistory` (every status change), `dbo.tblTicketAssignment` (every transfer), `dbo.tblTicket.EscalatedTo/EscalatedAt`. Activity `Type` values written: `status`, `resolved`, `closed`, `rejected`, `reopened`, `assigned`, `escalated`. Notification types written: `ticket_assigned` (single transfer only), `ticket_escalated`.

**Dependency — section 7 must sit BEFORE section 8, and the file must not be applied until it does.**
§8.3 drops `tblTicket.PipelineId / StageId / CustomerName / Channel` and §8.4 drops `tblPipelineStage` / `tblPipeline`. T-SQL resolves names in a procedure body lazily, so a proc whose body still reads a dropped column compiles fine and fails only when someone calls it. §8.2 is the guard against exactly that: it halts the script while **any** module still matches `%tblPipeline%` / `%StageId%` / `%PipelineId%`. Today eleven modules do (Step 1 of Task 1 listed them): five are dropped by §8.1, three are rewritten by Task 2's §6 (`sp_SaveTicket`, `sp_FetchTickets`, `sp_FetchTicketDetail`), and **three are rewritten here** — `sp_ResolveTicket`, `sp_CloseTicket`, `sp_ReopenTicket`, whose current bodies read `PipelineId` and call `sp_MoveTicketStage`. Apply the file with §7 still empty and it stops at §8.2 with those three named. §1–§4 will already have applied and stay; nothing after §4 runs.

**Decisions taken in this task (spec silent or open):**
1. **A reopen is a terminal → `open`/`onhold` move, and only that.** The spec's table names the reopen row exactly that way, so terminal → terminal is an ordinary transition: `rejected → closed` takes the straight-to-closed path (resolution + remarks required) and `closed → resolved` un-closes without `@AllowReopen`. The gate protects "put it back on the queue", not "correct the terminal label".
2. **`ResolvedAt = ISNULL(ResolvedAt, @Now)` on both `resolved` and `closed`.** The spec writes `ResolvedAt = GETDATE()` for resolve; from a non-terminal state `ResolvedAt` is always NULL by then (reopen cleared it), so the two agree — and the `ISNULL` form additionally keeps the original resolve time when a Closed complaint is moved back to Resolved. One `CASE` covers both rows of the table.
3. **Remarks are required to resolve** (the spec's table says so for `resolved`, `rejected` and reopen; only `closed`-from-`resolved` is optional). Each 400 names the action, so the web can show the message unchanged.
4. **`@ResolutionId` is validated** against `Kind = 'resolution'` of the company (400 `Invalid resolution`), and `<= 0` is read as NULL, as every other id in this script is. The parameter wins over the stored value; the stored value carries over when the parameter is absent (that is what "param or existing" means).
5. **`MetaJSON` uses `INCLUDE_NULL_VALUES`**, so all six keys are always present and the web can read `meta.remarks` without a guard. `sp_SetLeadStatus` omits it; the ticket timeline renders more of the payload than the lead one does.
6. **One `@Now` per proc.** The ticket row, the history row, the assignment row and the activity row all carry the same instant, so "last history row" and "UpdatedAt" never disagree by a tick.
7. **Bulk transfer sends no notifications.** `sp_BulkTransferLeads` sends none either; "move all of Ravi's complaints to Priya" would otherwise fire thirty pings for one action. The single transfer notifies, per the spec.
8. **Escalation walks up from the assignee** (from the caller when the complaint is unassigned), excludes self (`Depth > 0`) and stops after 20 hops. `sp_FetchEscalationTargets` walks *through* an inactive manager but does not list them, so their own manager stays reachable.
9. **`sp_FetchEscalationTargets` takes `MIN(Depth)` per user**, so a `ReportsTo` cycle in bad data lists each senior once instead of repeating them down the page.
10. **The shortcuts 400 when the company has no active status of their code** (`This company has no Resolved status configured`) instead of passing a NULL `@StatusId` into the engine, which would answer the unhelpful `StatusId is required`.
11. **Not one of these nine bodies may contain the text `StageId`, `PipelineId` or `tblPipeline` — comments included.** `sys.sql_modules.definition` keeps the comment block that precedes `CREATE PROC` in the same batch (verified: the live `sp_SetLeadStatus` definition starts with its own banner), and §8.2 greps that text. A comment such as "replaces the old StageId engine" would halt the script. Naming `sp_MoveTicketStage` is safe — it contains none of the three strings.

- [ ] **Step 1: Read-only pre-checks against the live DB (the "before" state — every line must come back as shown, or these bodies are built on a wrong assumption)**

Run each with `mcp__sqlserver-ecrm__read_query`:

```sql
-- (1) what exists today of the nine: expect ONLY sp_CloseTicket, sp_ReopenTicket,
--     sp_ResolveTicket (the pipeline-era shortcuts this section replaces)
SELECT name FROM sys.procedures
WHERE name IN ('sp_SetTicketStatus','sp_ResolveTicket','sp_CloseTicket','sp_RejectTicket','sp_ReopenTicket',
               'sp_TransferTicket','sp_BulkTransferTickets','sp_EscalateTicket','sp_FetchEscalationTargets')
ORDER BY name;

-- (2) those three still read the pipeline engine — expect three rows, all 'reads the engine'
SELECT o.name,
       CASE WHEN m.definition LIKE '%sp_MoveTicketStage%' THEN 'reads the engine' ELSE 'ALREADY REWRITTEN' END AS state
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE o.name IN ('sp_ResolveTicket','sp_CloseTicket','sp_ReopenTicket')
ORDER BY o.name;

-- (3) the two procs these bodies call with INSERT … EXEC — the table-variable
--     shapes below must match these column lists exactly. Expect:
--     sp_LogTicketActivity: @CompId int, @TicketId int, @UserId int, @Type varchar, @Summary nvarchar, @MetaJSON nvarchar
--     sp_CreateNotification: @UserId int, @Type varchar, @EntityType varchar, @EntityId bigint, @ActorUserId int,
--                            @Title varchar, @Body nvarchar, @CompId bigint, @BranchId bigint, @SkipSelf bit
SELECT o.name, STRING_AGG(p.name + ' ' + TYPE_NAME(p.user_type_id), ', ') WITHIN GROUP (ORDER BY p.parameter_id) AS params
FROM sys.procedures o JOIN sys.parameters p ON p.object_id = o.object_id
WHERE o.name IN ('sp_LogTicketActivity','sp_CreateNotification')
GROUP BY o.name ORDER BY o.name;

-- (4) the three lead procs whose shape is copied verbatim — expect 'ok' on all three
SELECT o.name,
       CASE WHEN m.definition LIKE '%OUTPUT deleted.StatusId INTO @hist%' THEN 'ok'
            WHEN o.name <> 'sp_SetLeadStatus' AND m.definition LIKE '%INSERT INTO dbo.tblLeadAssignment%' THEN 'ok'
            ELSE 'CHANGED' END AS shape
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE o.name IN ('sp_SetLeadStatus','sp_TransferLead','sp_BulkTransferLeads')
ORDER BY o.name;

-- (5) the recursive-CTE source (sp_FetchAssignableUsers) — expect 'ok'
SELECT CASE WHEN m.definition LIKE '%OPTION (MAXRECURSION 32)%' THEN 'ok' ELSE 'CHANGED' END AS cte_shape
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id WHERE o.name = 'sp_FetchAssignableUsers';

-- (6) tblTicket.BranchId must be NOT NULL — sp_TransferTicket copies
--     sp_TransferLead's "@FromBranchId IS NULL means not found" sentinel
SELECT name, is_nullable FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.tblTicket') AND name IN ('BranchId','AssignedTo','Priority');

-- (7) the lookup kinds these procs validate against — expect resolution 5, transfer_reason 6, priority 4
SELECT Kind, COUNT(*) AS N FROM dbo.tblLookup
WHERE Kind IN ('resolution','transfer_reason','priority') GROUP BY Kind ORDER BY Kind;

-- (8) the ReportsTo chain the escalation walks — expect 17 → 16 → 15 → 13 → (null)
SELECT u.Id, u.FullName, u.JobTitle, u.ReportsTo, u.IsActive
FROM dbo.tblUser u WHERE u.CompId = 1 AND u.Id IN (13,14,15,16,17,18) ORDER BY u.Id;
```

Expected: (1) exactly `sp_CloseTicket`, `sp_ReopenTicket`, `sp_ResolveTicket`; (2) three rows, all `reads the engine` — if any says `ALREADY REWRITTEN`, someone has been in the DB and §8.2's guard list has changed, report it; (3) the two parameter lists exactly as annotated — if either differs, the `DECLARE @actLog` / `DECLARE @ntf` table shapes below must change to match, report and stop; (4) three `ok`; (5) `ok`; (6) `BranchId is_nullable 0`, `AssignedTo 1`, `Priority 1`; (7) `priority 4`, `resolution 5`, `transfer_reason 6`; (8) `13 Priya (ReportsTo null) · 14 Arjun → 13 · 15 Rahul → 13 · 16 Neha → 15 · 17 Amit → 16 · 18 Sara → 16`, every `IsActive` true.

- [ ] **Step 2: Insert §7 into the file**

Everything below goes **between** the line `-- ===== 7. Procedures — lifecycle (sp_SetTicketStatus, sp_ResolveTicket, sp_CloseTicket, sp_RejectTicket, sp_ReopenTicket, sp_TransferTicket, sp_BulkTransferTickets, sp_EscalateTicket, sp_FetchEscalationTargets)` and the line `-- ===== 8. Drop pipeline engine (5 procs, 4 ticket columns, 2 tables), duplicate groups, menu rows 18 + 28, add Customers menu + grants`. Keep both marker lines exactly as Task 1 wrote them, and do not touch anything else in the file.

Reminder before typing a single comment: **no `StageId`, `PipelineId` or `tblPipeline` anywhere in this block** — §8.2 greps `sys.sql_modules.definition`, which includes the banner comments that sit in the same batch as `CREATE PROC`.

```sql
-- ---------------------------------------------------------------------------
-- 7.1 sp_SetTicketStatus — the one lifecycle engine
--
--   Everything about a complaint's lifecycle is written here and nowhere else:
--   StatusId, ResolvedAt, ClosedAt, ResolutionId, the reopen DueAt, and the
--   tblTicketStatusHistory row. sp_SaveTicket writes the opening history row
--   on insert; nothing else touches these columns.
--
--   Rules, by the TARGET status's Code (labels are the company's, codes are
--   ours — never match on a label):
--     open / onhold  from open / onhold      free, remarks optional
--     open / onhold  from a terminal status  REOPEN: needs @AllowReopen = 1
--                                            (Node's canReopen gate) else 403,
--                                            remarks required; clears
--                                            ResolvedAt / ClosedAt /
--                                            ResolutionId and re-stamps DueAt
--                                            from the priority's TatHours
--     resolved       resolution (parameter or the stored one) + remarks
--     closed         from resolved: remarks optional
--                    otherwise: resolution + remarks (straight to closed),
--                    and ResolvedAt is stamped if it was never set
--     rejected       remarks required; ResolvedAt / ResolutionId cleared —
--                    rejected means never solved
--     same status    200, nothing written
--
--   The history row's FROM comes from the UPDATE's own OUTPUT, not the value
--   read before the transaction: two concurrent changes would otherwise both
--   record the same source (the 075 pattern, copied from sp_SetLeadStatus).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SetTicketStatus
    @CompId       INT,
    @TicketId     INT,
    @StatusId     INT,
    @UserId       INT,
    @ResolutionId INT            = NULL,
    @Remarks      NVARCHAR(1000) = NULL,
    @AllowReopen  BIT            = 0
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @TicketId IS NULL OR @TicketId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'TicketId is required' AS ResponseMess; RETURN; END
    IF @StatusId IS NULL OR @StatusId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'StatusId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');
    IF @ResolutionId IS NOT NULL AND @ResolutionId <= 0 SET @ResolutionId = NULL;

    -- where it is now (the join doubles as the tenancy check)
    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200),
            @StoredResolution INT, @Priority INT;
    SELECT @FromStatusId    = t.StatusId,
           @FromCode        = st.Code,
           @FromName        = st.Value,
           @StoredResolution = t.ResolutionId,
           @Priority        = t.Priority
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st ON st.Id = t.StatusId
    WHERE t.Id = @TicketId AND t.CompId = @CompId;
    IF @FromStatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END

    -- where it is being sent (must be a live ticket_status of this company)
    DECLARE @ToCode VARCHAR(30), @ToName NVARCHAR(200);
    SELECT @ToCode = Code, @ToName = Value
    FROM dbo.tblLookup
    WHERE Id = @StatusId AND CompId = @CompId AND Kind = 'ticket_status' AND IsActive = 1;
    IF @ToCode IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Status not found' AS ResponseMess; RETURN; END

    IF @FromStatusId = @StatusId
    BEGIN SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint already in this status' AS ResponseMess; RETURN; END

    DECLARE @WasTerminal BIT = CASE WHEN @FromCode IN ('resolved', 'closed', 'rejected') THEN 1 ELSE 0 END;
    DECLARE @IsReopen   BIT = CASE WHEN @WasTerminal = 1 AND @ToCode IN ('open', 'onhold') THEN 1 ELSE 0 END;
    -- "resolution (param or existing)": the parameter wins, the stored one carries over
    DECLARE @EffResolution INT = COALESCE(@ResolutionId, @StoredResolution);

    IF @ResolutionId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup
                       WHERE Id = @ResolutionId AND CompId = @CompId AND Kind = 'resolution')
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Invalid resolution' AS ResponseMess; RETURN; END

    IF @IsReopen = 1
    BEGIN
        -- Node passes @AllowReopen = 1 only when canReopen() passed; the SP
        -- alone decides whether the requested move IS a reopen.
        IF ISNULL(@AllowReopen, 0) <> 1
        BEGIN SELECT @TicketId AS Id, 403 AS ResponseCode, 'Reopening requires a manager' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to reopen a complaint' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'resolved'
    BEGIN
        IF @EffResolution IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Resolution is required' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to resolve a complaint' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'closed' AND @FromCode <> 'resolved'
    BEGIN
        -- Straight to closed: nobody ever recorded how it was fixed.
        IF @EffResolution IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Resolution is required' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to close a complaint that was never resolved' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'rejected'
    BEGIN
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to reject a complaint' AS ResponseMess; RETURN; END
    END

    DECLARE @Now DATETIME = GETDATE();
    -- The reopened clock starts now, not at creation.
    DECLARE @Tat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @Priority);
    DECLARE @ActType VARCHAR(30) =
        CASE WHEN @IsReopen = 1        THEN 'reopened'
             WHEN @ToCode = 'resolved' THEN 'resolved'
             WHEN @ToCode = 'closed'   THEN 'closed'
             WHEN @ToCode = 'rejected' THEN 'rejected'
             ELSE 'status' END;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @hist   TABLE (FromStatusId INT);

        UPDATE dbo.tblTicket
        SET StatusId     = @StatusId,
            ResolvedAt   = CASE WHEN @ToCode IN ('resolved', 'closed') THEN ISNULL(ResolvedAt, @Now) ELSE NULL END,
            ClosedAt     = CASE WHEN @ToCode IN ('closed', 'rejected') THEN ISNULL(ClosedAt, @Now)   ELSE NULL END,
            ResolutionId = CASE WHEN @ToCode IN ('resolved', 'closed') THEN @EffResolution           ELSE NULL END,
            DueAt        = CASE WHEN @IsReopen = 1
                                THEN CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Now) END
                                ELSE DueAt END,
            EditBy = @UserId, UpdatedAt = @Now
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @TicketId AND CompId = @CompId;

        INSERT INTO dbo.tblTicketStatusHistory (CompId, TicketId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @TicketId, h.FromStatusId, @StatusId, @UserId, @Now FROM @hist h;

        DECLARE @Summary NVARCHAR(500) = LEFT(N'Status: ' + @FromName + N' → ' + @ToName
                                              + CASE WHEN @Remarks IS NULL THEN N'' ELSE N' — ' + @Remarks END, 500);
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @StatusId AS toStatusId,
                                              @FromCode AS fromCode, @ToCode AS toCode,
                                              CASE WHEN @ToCode IN ('resolved', 'closed') THEN @EffResolution END AS resolutionId,
                                              @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
        INSERT INTO @actLog
        EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = @ActType, @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;

        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint status updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 7.2–7.5 The buttons — each resolves the first active status of its Code by
--   SortOrder and hands over to the engine. None of them writes a timestamp,
--   a history row or an activity row: that is the engine's job, and keeping it
--   there is what makes "Resolved" mean one thing everywhere. Mobile calls
--   these; the web can call either these or sp_SetTicketStatus directly.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ResolveTicket
    @CompId       INT,
    @TicketId     INT,
    @ResolutionId INT,
    @Remarks      NVARCHAR(1000),
    @UserId       INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'resolved' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no Resolved status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = @ResolutionId, @Remarks = @Remarks, @AllowReopen = 0;
END
GO

CREATE OR ALTER PROC dbo.sp_CloseTicket
    @CompId       INT,
    @TicketId     INT,
    @UserId       INT,
    @ResolutionId INT            = NULL,
    @Remarks      NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'closed' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no Closed status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = @ResolutionId, @Remarks = @Remarks, @AllowReopen = 0;
END
GO

CREATE OR ALTER PROC dbo.sp_RejectTicket
    @CompId   INT,
    @TicketId INT,
    @Remarks  NVARCHAR(1000),
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'rejected' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no Rejected status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = NULL, @Remarks = @Remarks, @AllowReopen = 0;
END
GO

CREATE OR ALTER PROC dbo.sp_ReopenTicket
    @CompId      INT,
    @TicketId    INT,
    @Remarks     NVARCHAR(1000),
    @UserId      INT,
    @AllowReopen BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    -- The first OPEN status by SortOrder — 'New' on a seeded company.
    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'open' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no open status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = NULL, @Remarks = @Remarks, @AllowReopen = @AllowReopen;
END
GO


-- ---------------------------------------------------------------------------
-- 7.6 sp_TransferTicket — reason + remarks always, assignment row always
--
--   Body of sp_TransferLead, minus the follow-up re-point (complaints have no
--   follow-ups) and plus the in-app notification.
--     @ToUserId NULL   -> unassign (Node allows this for wide scopes only)
--     @ToBranchId NULL -> branch stays where it is
--   Whether the CALLER may hand it to this target is checked in Node against
--   sp_FetchAssignableUsers. This SP checks the target is real and the move is
--   not a no-op, then records it.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_TransferTicket
    @CompId     INT,
    @TicketId   INT,
    @ToUserId   INT           = NULL,
    @ToBranchId INT           = NULL,
    @ReasonId   INT,
    @Remarks    NVARCHAR(500),
    @UserId     INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @TicketId IS NULL OR @TicketId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'TicketId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = ''
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required for a transfer' AS ResponseMess; RETURN; END
    IF @ReasonId IS NULL OR @ReasonId <= 0
       OR NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'transfer_reason')
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'A transfer reason is required' AS ResponseMess; RETURN; END
    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;
    IF @ToUserId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @ToUserId AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Target user not found or inactive' AS ResponseMess; RETURN; END
    IF @ToBranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @ToBranchId)
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Target branch not found' AS ResponseMess; RETURN; END

    -- BranchId is NOT NULL on tblTicket, so a NULL here means "no such row in
    -- this company" — the same sentinel sp_TransferLead uses.
    DECLARE @FromUserId INT, @FromBranchId INT, @TicketNo VARCHAR(30), @Subject NVARCHAR(200);
    SELECT @FromUserId = AssignedTo, @FromBranchId = BranchId, @TicketNo = TicketNo, @Subject = Subject
    FROM dbo.tblTicket WHERE Id = @TicketId AND CompId = @CompId;
    IF @FromBranchId IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END

    SET @ToBranchId = ISNULL(@ToBranchId, @FromBranchId);
    IF ISNULL(@FromUserId, -1) = ISNULL(@ToUserId, -1) AND @FromBranchId = @ToBranchId
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Complaint is already assigned there' AS ResponseMess; RETURN; END

    DECLARE @Now DATETIME = GETDATE();

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblTicket
        SET AssignedTo = @ToUserId, BranchId = @ToBranchId,
            AssignedAt = CASE WHEN @ToUserId IS NULL THEN NULL ELSE @Now END,
            EditBy = @UserId, UpdatedAt = @Now
        WHERE Id = @TicketId AND CompId = @CompId;

        INSERT INTO dbo.tblTicketAssignment
            (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
        VALUES
            (@CompId, @TicketId, @FromUserId, @ToUserId, @FromBranchId, @ToBranchId, @ReasonId, @Remarks, @UserId, @Now);

        DECLARE @ToName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @ToUserId), N'Unassigned');
        DECLARE @Reason NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id = @ReasonId);
        DECLARE @Summary NVARCHAR(500) =
            CASE WHEN @ToUserId IS NULL THEN N'Unassigned' ELSE N'Transferred to ' + @ToName END
            + CASE WHEN @FromBranchId <> @ToBranchId
                   THEN N' (' + ISNULL((SELECT BranchName FROM dbo.tblBranch WHERE Id = @ToBranchId), N'') + N')'
                   ELSE N'' END
            + N' — ' + ISNULL(@Reason, N'');
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromUserId AS fromUserId, @ToUserId AS toUserId,
                                              @FromBranchId AS fromBranchId, @ToBranchId AS toBranchId,
                                              @ReasonId AS reasonId, @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
        INSERT INTO @actLog
        EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = 'assigned', @Summary = @Summary, @MetaJSON = @Meta;

        -- The in-app ping; sp_CreateNotification skips an actor assigning to
        -- themselves. Nothing to ping on an unassign.
        IF @ToUserId IS NOT NULL
        BEGIN
            DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
            DECLARE @NtfBody NVARCHAR(1000) = LEFT(@TicketNo + N' — ' + @Subject, 1000);
            INSERT INTO @ntf
            EXEC dbo.sp_CreateNotification
                @UserId = @ToUserId, @Type = 'ticket_assigned', @EntityType = 'ticket', @EntityId = @TicketId,
                @ActorUserId = @UserId, @Title = 'Complaint assigned to you', @Body = @NtfBody,
                @CompId = @CompId, @BranchId = @ToBranchId;
        END

        COMMIT TRANSACTION;

        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint transferred successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 7.7 sp_BulkTransferTickets — "move all of Ravi's complaints to Priya"
--
--   Body of sp_BulkTransferLeads: every id validated up front, one
--   transaction, complaints already with the target are skipped rather than
--   failed. The per-complaint work is inlined rather than EXEC'ing
--   sp_TransferTicket, because that proc uses INSERT … EXEC for its logger and
--   INSERT … EXEC cannot nest. No notifications here: thirty pings for one
--   action is noise, and the assignee sees the list.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_BulkTransferTickets
    @CompId        INT,
    @TicketIdsJson NVARCHAR(MAX),
    @ToUserId      INT           = NULL,
    @ToBranchId    INT           = NULL,
    @ReasonId      INT,
    @Remarks       NVARCHAR(500),
    @UserId        INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = ''
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'Remarks are required for a transfer' AS ResponseMess; RETURN; END
    IF @ReasonId IS NULL OR @ReasonId <= 0
       OR NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'transfer_reason')
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'A transfer reason is required' AS ResponseMess; RETURN; END
    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;
    IF @ToUserId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @ToUserId AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'Target user not found or inactive' AS ResponseMess; RETURN; END
    IF @ToBranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @ToBranchId)
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'Target branch not found' AS ResponseMess; RETURN; END

    DECLARE @Ids TABLE (TicketId INT PRIMARY KEY, AssignedTo INT NULL, BranchId INT NULL, Done BIT DEFAULT 0);
    INSERT INTO @Ids (TicketId)
    SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(ISNULL(@TicketIdsJson, '[]'));
    IF NOT EXISTS (SELECT 1 FROM @Ids)
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 400 AS ResponseCode, 'No complaints supplied' AS ResponseMess; RETURN; END

    UPDATE i SET AssignedTo = t.AssignedTo, BranchId = t.BranchId
    FROM @Ids i JOIN dbo.tblTicket t ON t.Id = i.TicketId AND t.CompId = @CompId;
    IF EXISTS (SELECT 1 FROM @Ids WHERE BranchId IS NULL)
    BEGIN SELECT 0 AS Transferred, 0 AS Skipped, 404 AS ResponseCode, 'One or more complaints not found' AS ResponseMess; RETURN; END

    DECLARE @Transferred INT = 0, @Skipped INT = 0;
    DECLARE @TicketId INT, @FromUserId INT, @FromBranchId INT, @TargetBranch INT;
    DECLARE @Reason NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id = @ReasonId);
    DECLARE @ToName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @ToUserId), N'Unassigned');
    DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
    DECLARE @Now DATETIME = GETDATE();

    BEGIN TRY
        BEGIN TRANSACTION;

        WHILE EXISTS (SELECT 1 FROM @Ids WHERE Done = 0)
        BEGIN
            SELECT TOP 1 @TicketId = TicketId, @FromUserId = AssignedTo, @FromBranchId = BranchId
            FROM @Ids WHERE Done = 0 ORDER BY TicketId;
            SET @TargetBranch = ISNULL(@ToBranchId, @FromBranchId);

            IF ISNULL(@FromUserId, -1) = ISNULL(@ToUserId, -1) AND @FromBranchId = @TargetBranch
                SET @Skipped += 1;
            ELSE
            BEGIN
                UPDATE dbo.tblTicket
                SET AssignedTo = @ToUserId, BranchId = @TargetBranch,
                    AssignedAt = CASE WHEN @ToUserId IS NULL THEN NULL ELSE @Now END,
                    EditBy = @UserId, UpdatedAt = @Now
                WHERE Id = @TicketId AND CompId = @CompId;

                INSERT INTO dbo.tblTicketAssignment
                    (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
                VALUES
                    (@CompId, @TicketId, @FromUserId, @ToUserId, @FromBranchId, @TargetBranch, @ReasonId, @Remarks, @UserId, @Now);

                DECLARE @Summary NVARCHAR(500) =
                    CASE WHEN @ToUserId IS NULL THEN N'Unassigned' ELSE N'Transferred to ' + @ToName END
                    + N' — ' + ISNULL(@Reason, N'') + N' (bulk)';
                DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromUserId AS fromUserId, @ToUserId AS toUserId,
                                                      @FromBranchId AS fromBranchId, @TargetBranch AS toBranchId,
                                                      @ReasonId AS reasonId, @Remarks AS remarks, 1 AS isBulk
                                               FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
                INSERT INTO @actLog
                EXEC dbo.sp_LogTicketActivity
                    @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
                    @Type = 'assigned', @Summary = @Summary, @MetaJSON = @Meta;

                SET @Transferred += 1;
            END

            UPDATE @Ids SET Done = 1 WHERE TicketId = @TicketId;
        END

        COMMIT TRANSACTION;

        SELECT @Transferred AS Transferred, @Skipped AS Skipped,
               200 AS ResponseCode,
               CAST(@Transferred AS VARCHAR(10)) + ' complaint(s) transferred' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 0 AS Transferred, 0 AS Skipped, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 7.8 sp_EscalateTicket — raise it to a senior of whoever holds it
--
--   Escalation is not assignment: the complaint stays with its assignee, and
--   EscalatedTo/At mark that someone above has been pulled in. Re-escalating
--   overwrites (a higher senior); nothing clears it, and the Escalated queue
--   filters non-terminal complaints only.
--
--   The target must be an ANCESTOR of the assignee (of the caller when the
--   complaint is unassigned) up the ReportsTo chain, at most 20 hops. Without
--   that, "escalate" is just a second assignment field pointing anywhere.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_EscalateTicket
    @CompId   INT,
    @TicketId INT,
    @ToUserId INT,
    @Remarks  NVARCHAR(1000),
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @TicketId IS NULL OR @TicketId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'TicketId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @ToUserId IS NULL OR @ToUserId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'An escalation target is required' AS ResponseMess; RETURN; END

    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');
    IF @Remarks IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to escalate a complaint' AS ResponseMess; RETURN; END

    DECLARE @Code VARCHAR(30), @AssignedTo INT, @BranchId INT, @TicketNo VARCHAR(30), @Subject NVARCHAR(200);
    SELECT @Code = st.Code, @AssignedTo = t.AssignedTo, @BranchId = t.BranchId,
           @TicketNo = t.TicketNo, @Subject = t.Subject
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st ON st.Id = t.StatusId
    WHERE t.Id = @TicketId AND t.CompId = @CompId;
    IF @Code IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    IF @Code NOT IN ('open', 'onhold')
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Only open complaints can be escalated' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @ToUserId AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Target user not found or inactive' AS ResponseMess; RETURN; END

    -- Walk up from whoever holds it. Depth > 0 excludes self; Depth < 20 caps
    -- the walk (and breaks a ReportsTo cycle in bad data).
    DECLARE @Base INT = ISNULL(@AssignedTo, @UserId);
    DECLARE @IsSenior BIT = 0;
    ;WITH chain AS (
        SELECT u.Id, u.ReportsTo, 0 AS Depth
        FROM dbo.tblUser u WHERE u.Id = @Base AND u.CompId = @CompId
        UNION ALL
        SELECT m.Id, m.ReportsTo, c.Depth + 1
        FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
        WHERE m.CompId = @CompId AND c.Depth < 20
    )
    SELECT @IsSenior = 1 FROM chain WHERE Id = @ToUserId AND Depth > 0
    OPTION (MAXRECURSION 32);

    IF @IsSenior = 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Escalation target must be a senior of the assignee' AS ResponseMess; RETURN; END

    DECLARE @Now DATETIME = GETDATE();

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblTicket
        SET EscalatedTo = @ToUserId, EscalatedAt = @Now,
            EditBy = @UserId, UpdatedAt = @Now
        WHERE Id = @TicketId AND CompId = @CompId;

        DECLARE @ToName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @ToUserId), N'');
        DECLARE @Summary NVARCHAR(500) = LEFT(N'Escalated to ' + @ToName + N' — ' + @Remarks, 500);
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @ToUserId AS toUserId, @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
        INSERT INTO @actLog
        EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = 'escalated', @Summary = @Summary, @MetaJSON = @Meta;

        DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
        DECLARE @NtfBody NVARCHAR(1000) = LEFT(@TicketNo + N' — ' + @Subject + N': ' + @Remarks, 1000);
        INSERT INTO @ntf
        EXEC dbo.sp_CreateNotification
            @UserId = @ToUserId, @Type = 'ticket_escalated', @EntityType = 'ticket', @EntityId = @TicketId,
            @ActorUserId = @UserId, @Title = 'Complaint escalated', @Body = @NtfBody,
            @CompId = @CompId, @BranchId = @BranchId;

        COMMIT TRANSACTION;

        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint escalated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 7.9 sp_FetchEscalationTargets — the ReportsTo chain above a user, nearest
--   first (Depth 1 = their direct manager). Feeds the escalate picker, and is
--   exactly the set sp_EscalateTicket accepts.
--
--   An inactive manager is walked THROUGH but not listed, so their own
--   manager stays reachable. MIN(Depth) per user, so a ReportsTo cycle in bad
--   data lists each senior once instead of repeating them down the page.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchEscalationTargets
    @CompId INT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH chain AS (
        SELECT u.Id, u.ReportsTo, 0 AS Depth
        FROM dbo.tblUser u WHERE u.Id = @UserId AND u.CompId = @CompId
        UNION ALL
        SELECT m.Id, m.ReportsTo, c.Depth + 1
        FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
        WHERE m.CompId = @CompId AND c.Depth < 20
    )
    SELECT u.Id, u.FullName, u.JobTitle, u.BranchId, b.BranchName,
           MIN(c.Depth) AS Depth,
           200 AS ResponseCode, 'Escalation targets retrieved successfully' AS ResponseMess
    FROM chain c
    JOIN dbo.tblUser u        ON u.Id = c.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = u.BranchId
    WHERE c.Depth > 0 AND u.IsActive = 1
    GROUP BY u.Id, u.FullName, u.JobTitle, u.BranchId, b.BranchName
    ORDER BY Depth
    OPTION (MAXRECURSION 32);
END
GO

```

- [ ] **Step 3: Read the file back — the section range, its batching, and the forbidden strings**

Run: `cd backend && grep -n "^-- ===== \|^CREATE OR ALTER PROC" sql/086_support_rebuild.sql`
Expected: the nine `-- =====` markers still in order `1.` … `9.`; between `7.` and `8.` exactly nine `CREATE OR ALTER PROC` lines, in this order — `sp_SetTicketStatus, sp_ResolveTicket, sp_CloseTicket, sp_RejectTicket, sp_ReopenTicket, sp_TransferTicket, sp_BulkTransferTickets, sp_EscalateTicket, sp_FetchEscalationTargets`; §5 and §6 untouched (four then six procs).

Run: `cd backend && grep -c "^GO$" sql/086_support_rebuild.sql && grep -c "^CREATE OR ALTER PROC dbo\." sql/086_support_rebuild.sql`
Expected: `41` (Task 1's 22 + Task 2's 10 + 9 here) and `19`.

Run: `cd backend && awk '/^-- ===== 7\./,/^-- ===== 8\./' sql/086_support_rebuild.sql | grep -c "^GO$"`
Expected: `9` — one batch per proc, so a syntax error in one body cannot swallow the next `CREATE`.

Run: `cd backend && awk '/^-- ===== 7\./,/^-- ===== 8\./' sql/086_support_rebuild.sql | grep -n "StageId\|PipelineId\|tblPipeline"`
Expected: **nothing**. This is the §8.2 guard's grep, and the module definition includes the banner comments — a single mention in a comment halts the whole script at §8.

Run: `cd backend && awk '/^-- ===== 7\./,/^-- ===== 8\./' sql/086_support_rebuild.sql | grep -c "ResolvedAt\s*=\s*CASE\|ClosedAt\s*=\s*CASE\|ResolutionId\s*=\s*CASE"`
Expected: `3` — the three lifecycle columns are written in exactly one place, the engine's single `UPDATE`. If a shortcut grew a timestamp write, this count goes up and the "one engine" rule is already broken.

Read §7.1 once against the rules table and confirm by eye: the same-status check returns **before** the transaction (nothing written on a no-op); every `RETURN` before `BEGIN TRANSACTION` carries the three columns `Id, ResponseCode, ResponseMess`; `OUTPUT deleted.StatusId INTO @hist` is on the `UPDATE` itself; `@Now` is declared once and used for the ticket row, the history row and (through `sp_LogTicketActivity`) the activity row; the reopen branch is the only place `DueAt` is written.

- [ ] **Step 4: Hand the owner the apply note and the post-apply lifecycle check**

With §7 filled, the file is complete: §1–§4 (Task 1), §5–§6 (Task 2), §7 (here), §8–§9 (Task 1). The owner applies it by hand in SSMS / Azure Data Studio against `eCRM+`, then against `SolarCRM`, top to bottom in one go, and reads §9 as Task 1 describes. §8.2 will now pass, because the three pipeline-era shortcuts have been replaced above it and the other eight modules are dropped or rewritten. Deploy the backend **immediately** after a clean apply (spec §7) — the old backend breaks the moment the columns go.

§9.5 already dry-runs resolve (400 + 200), reopen (403 + 200), reject (400) and escalate (400). Paste this **after** the file has applied cleanly, to cover the rest. It creates its own scratch customer and complaint, exercises every lifecycle path end to end, prints the new history and assignment rows, and rolls the whole thing back — nothing is kept:

```sql
SET NOCOUNT ON;
DECLARE @cid INT = (SELECT TOP 1 CompId FROM dbo.tblLookup WHERE Kind = 'ticket_status' ORDER BY CompId);
-- a user who HAS a manager, so escalation and transfer have somewhere to go
DECLARE @uid INT, @mgr INT, @bid INT;
SELECT TOP 1 @uid = Id, @mgr = ReportsTo, @bid = BranchId
FROM dbo.tblUser WHERE CompId = @cid AND IsActive = 1 AND ReportsTo IS NOT NULL ORDER BY Id;
DECLARE @peer INT = (SELECT TOP 1 Id FROM dbo.tblUser
                     WHERE CompId = @cid AND IsActive = 1 AND ReportsTo = @mgr AND Id <> @uid ORDER BY Id);
DECLARE @res    INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='resolution'      AND IsActive=1 ORDER BY SortOrder, Id);
DECLARE @reason INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='transfer_reason' AND IsActive=1 ORDER BY SortOrder, Id);
DECLARE @prio   INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='priority'        AND IsActive=1 AND TatHours IS NOT NULL ORDER BY SortOrder, Id);
DECLARE @inprog INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId=@cid AND Kind='ticket_status' AND Code='open' AND IsActive=1 ORDER BY SortOrder DESC, Id DESC);
SELECT 'fixtures' AS step, @cid AS CompId, @uid AS Agent, @mgr AS Manager, @peer AS Peer,
       @res AS Resolution, @reason AS Reason, @prio AS Priority, @inprog AS SecondOpenStatus;

BEGIN TRY
BEGIN TRANSACTION;
    EXEC dbo.sp_SaveCustomer @Id=0, @CompId=@cid, @BranchId=@bid, @UserId=@uid, @Name=N'verify-086c', @Mobile='99999 00087';
    DECLARE @cust INT = (SELECT TOP 1 Id FROM dbo.tblCustomer WHERE CompId=@cid AND Name=N'verify-086c' ORDER BY Id DESC);
    EXEC dbo.sp_SaveTicket @Id=0, @CompId=@cid, @BranchId=@bid, @UserId=@uid,
         @CustomerId=@cust, @Subject=N'verify-086c', @Priority=@prio, @AssignedTo=@uid, @Description=N'lifecycle dry run';
    DECLARE @tid INT = (SELECT TOP 1 Id FROM dbo.tblTicket WHERE CompId=@cid AND Subject=N'verify-086c' ORDER BY Id DESC);
    DECLARE @json NVARCHAR(50) = '[' + CAST(@tid AS VARCHAR(10)) + ']';

    SELECT '(1) free move New -> second open status — expect 200' AS step;
    EXEC dbo.sp_SetTicketStatus @CompId=@cid, @TicketId=@tid, @StatusId=@inprog, @UserId=@uid;

    SELECT '(2) escalate to the manager — expect 200' AS step;
    EXEC dbo.sp_EscalateTicket @CompId=@cid, @TicketId=@tid, @ToUserId=@mgr, @Remarks=N'customer called twice', @UserId=@uid;
    SELECT '(2) escalated row' AS step, EscalatedTo, EscalatedAt,
           CASE WHEN EscalatedTo = @mgr AND EscalatedAt IS NOT NULL THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;

    SELECT '(3) escalate to a peer — expect 400 (not a senior)' AS step;
    IF @peer IS NOT NULL
        EXEC dbo.sp_EscalateTicket @CompId=@cid, @TicketId=@tid, @ToUserId=@peer, @Remarks=N'x', @UserId=@uid;
    ELSE SELECT 'skipped — this company has no sibling under the manager' AS note;

    SELECT '(4) transfer to the manager — expect 200' AS step;
    EXEC dbo.sp_TransferTicket @CompId=@cid, @TicketId=@tid, @ToUserId=@mgr, @ReasonId=@reason, @Remarks=N'needs a senior', @UserId=@uid;

    SELECT '(5) same target again — expect 400 (already assigned there)' AS step;
    EXEC dbo.sp_TransferTicket @CompId=@cid, @TicketId=@tid, @ToUserId=@mgr, @ReasonId=@reason, @Remarks=N'again', @UserId=@uid;

    SELECT '(6) bulk transfer back — expect Transferred 1, Skipped 0' AS step;
    EXEC dbo.sp_BulkTransferTickets @CompId=@cid, @TicketIdsJson=@json, @ToUserId=@uid, @ReasonId=@reason, @Remarks=N'back to the agent', @UserId=@mgr;

    SELECT '(7) the same bulk again — expect Transferred 0, Skipped 1' AS step;
    EXEC dbo.sp_BulkTransferTickets @CompId=@cid, @TicketIdsJson=@json, @ToUserId=@uid, @ReasonId=@reason, @Remarks=N'noop', @UserId=@mgr;

    SELECT '(8) resolve without a resolution — expect 400' AS step;
    EXEC dbo.sp_ResolveTicket @CompId=@cid, @TicketId=@tid, @ResolutionId=NULL, @Remarks=N'x', @UserId=@uid;

    SELECT '(9) resolve — expect 200' AS step;
    EXEC dbo.sp_ResolveTicket @CompId=@cid, @TicketId=@tid, @ResolutionId=@res, @Remarks=N'replaced the part', @UserId=@uid;
    SELECT '(9) resolved row' AS step, ResolvedAt, ClosedAt, ResolutionId,
           CASE WHEN ResolvedAt IS NOT NULL AND ClosedAt IS NULL AND ResolutionId = @res THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;

    SELECT '(10) close from resolved, no remarks — expect 200' AS step;
    DECLARE @ResolvedWas DATETIME = (SELECT ResolvedAt FROM dbo.tblTicket WHERE Id = @tid);
    EXEC dbo.sp_CloseTicket @CompId=@cid, @TicketId=@tid, @UserId=@uid;
    SELECT '(10) closed row — ResolvedAt kept, ResolutionId kept' AS step, ResolvedAt, ClosedAt, ResolutionId,
           CASE WHEN ClosedAt IS NOT NULL AND ResolvedAt = @ResolvedWas AND ResolutionId = @res THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;

    SELECT '(11) reopen without the gate — expect 403' AS step;
    EXEC dbo.sp_ReopenTicket @CompId=@cid, @TicketId=@tid, @Remarks=N'still broken', @UserId=@uid, @AllowReopen=0;

    SELECT '(12) reopen with the gate — expect 200' AS step;
    EXEC dbo.sp_ReopenTicket @CompId=@cid, @TicketId=@tid, @Remarks=N'still broken', @UserId=@uid, @AllowReopen=1;
    SELECT '(12) reopened row — everything cleared, clock restarted' AS step, ResolvedAt, ClosedAt, ResolutionId, DueAt,
           CASE WHEN ResolvedAt IS NULL AND ClosedAt IS NULL AND ResolutionId IS NULL AND DueAt > GETDATE() THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;

    SELECT '(13) straight to closed without a resolution — expect 400' AS step;
    EXEC dbo.sp_CloseTicket @CompId=@cid, @TicketId=@tid, @UserId=@uid, @ResolutionId=NULL, @Remarks=N'done';

    SELECT '(14) straight to closed with one — expect 200, ResolvedAt stamped' AS step;
    EXEC dbo.sp_CloseTicket @CompId=@cid, @TicketId=@tid, @UserId=@uid, @ResolutionId=@res, @Remarks=N'fixed and confirmed';
    SELECT '(14) closed row' AS step, ResolvedAt, ClosedAt,
           CASE WHEN ResolvedAt IS NOT NULL AND ClosedAt IS NOT NULL THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;

    SELECT '(15) reject — expect 200, resolution wiped' AS step;
    EXEC dbo.sp_RejectTicket @CompId=@cid, @TicketId=@tid, @Remarks=N'not our product after all', @UserId=@uid;
    SELECT '(15) rejected row' AS step, ResolvedAt, ClosedAt, ResolutionId,
           CASE WHEN ResolvedAt IS NULL AND ResolutionId IS NULL AND ClosedAt IS NOT NULL THEN 'ok' ELSE 'WRONG' END AS state
    FROM dbo.tblTicket WHERE Id = @tid;

    SELECT '(16) status history — 7 rows, last row = the ticket status, no gaps' AS step;
    SELECT h.Id, h.FromStatusId, f.Value AS FromStatus, h.ToStatusId, t2.Value AS ToStatus, h.ChangedBy, h.ChangedAt
    FROM dbo.tblTicketStatusHistory h
    LEFT JOIN dbo.tblLookup f  ON f.Id  = h.FromStatusId
    LEFT JOIN dbo.tblLookup t2 ON t2.Id = h.ToStatusId
    WHERE h.TicketId = @tid ORDER BY h.Id;
    SELECT '(16) counts' AS step,
           (SELECT COUNT(*) FROM dbo.tblTicketStatusHistory WHERE TicketId = @tid) AS HistoryRows, 7 AS expect_history,
           (SELECT COUNT(*) FROM dbo.tblTicketAssignment    WHERE TicketId = @tid) AS AssignmentRows, 3 AS expect_assignment;

    SELECT '(17) assignment rows — creation, transfer, bulk' AS step;
    SELECT Id, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt
    FROM dbo.tblTicketAssignment WHERE TicketId = @tid ORDER BY Id;

    SELECT '(18) timeline' AS step, STRING_AGG(Type, ',') WITHIN GROUP (ORDER BY Id) AS types,
           'created,assigned,status,escalated,assigned,assigned,resolved,closed,reopened,closed,rejected' AS expect
    FROM dbo.tblTicketActivity WHERE TicketId = @tid;

    SELECT '(19) escalation targets for the agent — Depth 1 is their manager' AS step;
    EXEC dbo.sp_FetchEscalationTargets @CompId = @cid, @UserId = @uid;

    SELECT '(20) rolling back — nothing above is kept' AS step;
ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'LIFECYCLE CHECK FAILED (rolled back)' AS step, ERROR_NUMBER() AS ErrNo, ERROR_PROCEDURE() AS Proc_,
           ERROR_LINE() AS Line_, ERROR_MESSAGE() AS Msg_;
END CATCH
```

Read it as: every `expect 200 / 400 / 403` label followed by a grid whose `ResponseCode` matches; every `state` column `ok`; `(6)` `Transferred 1 / Skipped 0` and `(7)` `Transferred 0 / Skipped 1`; `(16)` seven history rows whose `ToStatus` chain has no gap and whose last row equals the complaint's status; `(17)` three assignment rows (the first with `ReasonId NULL` — the creation row is not a transfer); `(18)` the eleven types in that order; `(19)` the manager at `Depth 1`, then their manager at `2`, and so on. Anything else, or a `LIFECYCLE CHECK FAILED` grid: stop and report the text verbatim — the block has rolled itself back, so the database is untouched either way.

- [ ] **Step 5: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: the file path; the five `grep` / `awk` result lines from Step 3 (marker + proc order, `41` / `19`, the `9` batches in §7, the empty forbidden-string grep, the `3` lifecycle-column writes); that the file is now complete (§1–§9) and ready for the owner to apply, and that the backend must be deployed immediately after a clean apply; the eleven decisions listed at the top of this task — in particular that terminal → terminal is not a reopen, that bulk transfer sends no notifications, and that no §7 comment may mention the dropped columns because `sys.sql_modules` keeps the banner; anything Step 1 returned that differed from the annotated expectations.

### Task 4: `permission.js`: `canReopen`, `assertRecordAccess` returns record, neutral strings

**Files:**
- Modify: `backend/src/middleware/permission.js:236-276` (`assertRecordAccess`), `:289-326` (`WIDE_SCOPES` + `assertCanAssign` — three message strings), `:328-343` (`module.exports`)
- Modify: `backend/tests/unit/middleware/permission.test.js:6-16` (import list), `:359-370` and `:389-400` (the two `resolves.toBe(true)` assertions become `resolves.toEqual(record)`), append two `it`s + one `describe("canReopen")`
- Modify: `backend/tests/unit/middleware/assertCanAssign.test.js` (append one `describe`)

**Interfaces:**
- Consumes: `database.executeStoredProcedure(name, params)`; `responseHelper.error(res, message, code, status)`; `canSeeRecord(req, record, ownerField)` (same file).
- Produces:
  - `assertRecordAccess(req, res, entity, entityId, level = "view")` → resolves to the **first row of the detail SP** (`{ Id, BranchId, AssignedTo | OwnerId, CreatedBy, … }`) for `lead` / `ticket` when the caller may see it; `true` for `task` (the permission SP answers yes/no, there is no row); `false` after it has sent the 403 (or 500 on a lookup failure). Truthiness is unchanged, so every existing `if (!(await assertRecordAccess(...))) return;` keeps working (grep 2026-09-16: no caller compares with `=== true`).
  - `canReopen(req, record)` → `boolean`, pure (no DB). `true` when `req.scope.dataScope ∈ {All, Company, MultiBranch, Branch}`; otherwise `true` only when `record.AssignedTo` is set, is **not** the caller, and is in `req.scope.ownerIds`. Unassigned or own tickets: wide scopes only. Task 7 passes it as `AllowReopen: canReopen(req, ticket) ? 1 : 0`.
  - `assertCanAssign` 403 messages become entity-neutral: `"Only a manager can leave a record unassigned"`, `"Only a branch manager or above can move a record to another branch"`, `"You cannot assign records to that user"`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/middleware/permission.test.js` replace the import block (lines 6–16) with:

```js
const {
  HIERARCHY,
  loadScope,
  requireMinLevel,
  requireAdmin,
  scopeParams,
  canSeeRecord,
  canWriteBranch,
  canReadBranch,
  assertRecordAccess,
  canReopen,
} = require("../../../src/middleware/permission");
```

Replace the test `"allows a lead the caller owns and fetches it via sp_FetchLeadDetail"` (lines 359–370) with:

```js
    // Spec 2 §3: the guard hands back the row it fetched, so a controller
    // that needs the assignee (the reopen gate) has it without a second
    // sp_Fetch*Detail round-trip. Truthiness is what every caller tests.
    it("allows a lead the caller owns and resolves to the fetched record", async () => {
      const lead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 3 };
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[lead], [], []],
      });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "lead", 9)).resolves.toEqual(lead);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith(
        "sp_FetchLeadDetail",
        { CompId: 5, LeadId: 9 },
      );
      expect(res.status).not.toHaveBeenCalled();
    });
```

Replace the test `"reads tickets via sp_FetchTicketDetail using AssignedTo as the owner field"` (lines 389–400) with:

```js
    it("reads tickets via sp_FetchTicketDetail using AssignedTo as the owner field, and resolves to the ticket", async () => {
      const ticket = { Id: 4, BranchId: 9, AssignedTo: 7, CreatedBy: 3 };
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[ticket], [], [], [], []],
      });
      const res = mockRes();
      // Assigned to caller from an out-of-scope branch: assignment beats scope.
      await expect(assertRecordAccess(selfReq, res, "ticket", 4)).resolves.toEqual(ticket);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith(
        "sp_FetchTicketDetail",
        { CompId: 5, TicketId: 4 },
      );
    });

    // Tasks have no row to hand back — sp_CheckTaskPermission answers yes/no —
    // so the task branch keeps resolving to a plain true.
    it("still resolves to true (not a record) for tasks", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Allowed: true, Reason: "role=owner" }]],
      });
      await expect(assertRecordAccess(selfReq, mockRes(), "task", 12)).resolves.toBe(true);
    });
```

Append, inside the outer `describe("permission middleware", …)` and after the `describe("assertRecordAccess", …)` block (before the final `});`):

```js
  // Spec 2 §3 Rules — Reopen: a manager's act. Wide scopes always; a Team
  // lead only for a ticket assigned to someone in their subtree — never their
  // own, never an unassigned one. Self agents never. Pure: the controller
  // already fetched the ticket through assertRecordAccess.
  describe("canReopen", () => {
    const req = (dataScope, ownerIds, UserId = 16) => ({
      user: { UserId, CompId: 1 },
      scope: { dataScope, branchIds: [1], ownerIds },
    });
    const ticket = (AssignedTo) => ({ Id: 1, BranchId: 1, AssignedTo, CreatedBy: 16 });

    it.each(["All", "Company", "MultiBranch", "Branch"])(
      "%s scope may reopen anything — own, unassigned, a stranger's",
      (scope) => {
        expect(canReopen(req(scope, null), ticket(16))).toBe(true);
        expect(canReopen(req(scope, null), ticket(null))).toBe(true);
        expect(canReopen(req(scope, null), ticket(99))).toBe(true);
      },
    );

    it("lets a Team lead reopen a subordinate's ticket", () => {
      expect(canReopen(req("Team", [16, 17, 18]), ticket(17))).toBe(true);
    });

    it("refuses a Team lead their own, an unassigned, or an outsider's ticket", () => {
      const r = req("Team", [16, 17, 18]);
      expect(canReopen(r, ticket(16))).toBe(false);
      expect(canReopen(r, ticket(null))).toBe(false);
      expect(canReopen(r, ticket(21))).toBe(false);
    });

    it("never lets a Self agent reopen — not even a colleague's ticket they created", () => {
      expect(canReopen(req("Self", [17], 17), ticket(17))).toBe(false);
      expect(canReopen(req("Self", [17], 17), { ...ticket(18), CreatedBy: 17 })).toBe(false);
    });

    it("coerces ids (the driver hands BIGINTs back as strings) and fails closed on a missing scope or record", () => {
      expect(canReopen(req("Team", [17]), ticket("17"))).toBe(true);
      expect(canReopen({ user: { UserId: 16 } }, ticket(17))).toBe(false);
      expect(canReopen(req("Team", [17]), null)).toBe(false);
    });
  });
```

Append to `backend/tests/unit/middleware/assertCanAssign.test.js` (after the existing `describe`):

```js
// The guard is shared by leads and tickets (spec 2 §3); the copy must not
// name either. The web shows these strings verbatim in a toast.
describe("assertCanAssign messages are entity-neutral", () => {
  it("unassign below Branch scope", async () => {
    const res = mockRes();
    await assertCanAssign(req("Self"), res, { toUserId: null });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Only a manager can leave a record unassigned" }),
    );
  });

  it("cross-branch below Branch scope", async () => {
    const res = mockRes();
    await assertCanAssign(req("Team"), res, { toUserId: 9, toBranchId: 4 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Only a branch manager or above can move a record to another branch" }),
    );
  });

  it("target outside the roster", async () => {
    roster([3]);
    const res = mockRes();
    await assertCanAssign(req("Team"), res, { toUserId: 9 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "You cannot assign records to that user" }),
    );
  });
});
```

- [ ] **Step 2: Run both files to verify they fail**

Run: `cd backend && pnpm exec jest tests/unit/middleware/permission.test.js --maxWorkers=2 --silent`
Expected: FAIL — the two `resolves.toEqual` tests report `Received: true`; every `canReopen` test throws `TypeError: canReopen is not a function`.
Run: `cd backend && pnpm exec jest tests/unit/middleware/assertCanAssign.test.js --maxWorkers=2 --silent`
Expected: FAIL — 3 tests, each `Expected: … "…a record…"` vs `Received: … "…a lead…"`.

- [ ] **Step 3: Implement**

In `backend/src/middleware/permission.js` replace `assertRecordAccess` (lines 236–276) with:

```js
async function assertRecordAccess(req, res, entity, entityId, level = "view") {
  try {
    // What the caller gets on success: the record itself for lead/ticket, so
    // a controller that needs the assignee (the reopen gate, spec 2 §3) has it
    // without a second round-trip; a plain true for tasks, where the
    // permission SP answers yes/no and there is no row to hand over. Callers
    // only ever test truthiness.
    let granted = false;

    if (entity === "task") {
      const result = await database.executeStoredProcedure(
        "sp_CheckTaskPermission",
        {
          TaskId: Number(entityId) || 0,
          UserId: req.user.UserId,
          Action: TASK_ACTION[level] ?? level,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );
      const row = result.recordsets?.[0]?.[0] ?? result.recordset?.[0];
      granted = row?.Allowed === true || row?.Allowed === 1;
    } else if (ENTITY_LOOKUP[entity]) {
      const { sp, idParam, ownerField } = ENTITY_LOOKUP[entity];
      const result = await database.executeStoredProcedure(sp, {
        CompId: req.user.CompId,
        [idParam]: Number(entityId) || 0,
      });
      const record = result.recordsets?.[0]?.[0] || null;
      granted = canSeeRecord(req, record, ownerField) ? record : false;
    }

    if (granted) return granted;
    responseHelper.error(
      res,
      `You do not have access to this ${entity}`,
      "FORBIDDEN",
      403,
    );
    return false;
  } catch (err) {
    console.error("assertRecordAccess failed:", entity, entityId, err.message);
    responseHelper.error(res, "Failed to verify record access");
    return false;
  }
}
```

In `assertCanAssign` (lines 291–326) change the three messages:

```js
  if (!target && !wide) {
    responseHelper.error(res, "Only a manager can leave a record unassigned", "FORBIDDEN", 403);
    return false;
  }
  if (branch && !wide) {
    responseHelper.error(
      res,
      "Only a branch manager or above can move a record to another branch",
      "FORBIDDEN",
      403,
    );
    return false;
  }
```

```js
    if (rows.some((r) => Number(r.Id) === target)) return true;
    responseHelper.error(res, "You cannot assign records to that user", "FORBIDDEN", 403);
    return false;
```

Insert after the closing `}` of `assertCanAssign` (after line 326) and before `module.exports`:

```js
// Reopen gate (spec 2 §3 Rules). Reopening a resolved / closed / rejected
// complaint is a manager's act: the wide scopes always may; a Team lead only
// for a ticket assigned to someone in their subtree — never their own, never
// an unassigned one; a Self agent never. Pure: the controller already fetched
// the ticket through assertRecordAccess, so this is a lookup on req.scope.
//
// The controller passes the answer as @AllowReopen on EVERY status call and
// sp_SetTicketStatus alone decides whether the requested move IS a reopen —
// Node never inspects status codes.
const canReopen = (req, record) => {
  if (WIDE_SCOPES.has(req.scope?.dataScope)) return true;
  const assignee = Number(record?.AssignedTo) || null;
  if (!assignee || assignee === Number(req.user?.UserId)) return false;
  const { ownerIds } = req.scope || {};
  return Array.isArray(ownerIds) && ownerIds.includes(assignee);
};
```

Replace `module.exports` (lines 328–343) with:

```js
module.exports = {
  HIERARCHY,
  loadScope,
  requireMinLevel,
  requireAdmin,
  scopeParams,
  // Exported for the SPs that declare AccessibleBranchIdsJson but not UserId or
  // OwnerIdsJson — spreading the whole of scopeParams into those makes node-mssql
  // reject the call for passing parameters the procedure never declared.
  scopeJson,
  canSeeRecord,
  canWriteBranch,
  canReadBranch,
  assertRecordAccess,
  assertCanAssign,
  canReopen,
};
```

- [ ] **Step 4: Run both files to verify they pass, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/middleware/permission.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/middleware/permission.js'`
Expected: all passed (the file had 40; now 47 — the `it.each` counts 4); `permission.js` ≥ 80 % lines and branches. (`assertCanAssign`'s branches are exercised by the second file; the merged figure is Task 10's.)
Run: `cd backend && pnpm exec jest tests/unit/middleware/assertCanAssign.test.js --maxWorkers=2 --silent`
Expected: 10 passed.

Sanity — the callers that already consume the guard must be unaffected. Run each on its own:
`cd backend && pnpm exec jest tests/unit/controllers/leadController.test.js --maxWorkers=2 --silent` → all passed.
`cd backend && pnpm exec jest tests/unit/controllers/callController.test.js --maxWorkers=2 --silent` → all passed.
`cd backend && pnpm exec jest tests/unit/controllers/attachmentController.test.js --maxWorkers=2 --silent` → all passed.
(`ticketController.test.js` still passes too until Task 6 rewrites it.)

- [ ] **Step 5: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 5: `customerController` + routes + registration

**Files:**
- Create: `backend/src/controllers/customerController.js`
- Create: `backend/src/routes/customerRoutes.js`
- Modify: `backend/src/config/routes.js:14` (add the require after `ticketRoutes`), `:36` (mount after `/api/tickets`)
- Create: `backend/tests/unit/controllers/customerController.test.js`
- Create: `backend/tests/unit/routes/customerRoutes.test.js`

**Interfaces:**
- Consumes: `database.executeStoredProcedure`; `responseHelper.{success,error,validationError}`; `scopeParams(req)` from `src/middleware/permission.js` (`{ UserId, AccessibleBranchIdsJson, OwnerIdsJson }`); `positiveInt`, `pageParams(body, defaultSize)` from `src/utils/controllerKit.js`; `verifyToken` (`src/middleware/auth.js`), `loadScope`, `requireAdmin` (`src/middleware/permission.js`), `requirePayload`, `allowEmptyPayload` (`src/middleware/payloadValidation.js`). SPs from `086` §5: `sp_SaveCustomer`, `sp_FetchCustomers`, `sp_FetchCustomerDetail`, `sp_DeleteCustomer` (signatures in the Contracts block).
- Produces (web Task 13, mobile Task 19 rely on these):
  - `POST /api/customers/saveCustomer` body `{ Id, Name, ContactPerson, Mobile, AltMobile, Email, Address, City, State, Pincode, Remarks }` → `data` = the SP status row (`Id, ResponseCode, ResponseMess`). 400 `"Name is required"`, 400 `"Mobile or Email is required"`; the SP's 409 (duplicate mobile) is surfaced as-is.
  - `POST /api/customers/fetchCustomers` body `{ PageNumber, PageSize (≤200, default 25), SearchTerm, BranchId, IsActive }` → `data: { customers, pagination: { currentPage, pageSize, totalRecords, totalPages } }`.
  - `POST /api/customers/fetchCustomerDetail` body `{ CustomerId }` → `data: { customer, tickets }`; 400 when `CustomerId` is missing; 404 when RS1 is empty.
  - `POST /api/customers/deleteCustomer` (`requireAdmin`) body `{ Id }` → status row; the SP's 409 (tickets still reference it) is surfaced.

Decisions (spec silent): `IsActive` defaults to `1` and is sent as a bit (`0` only for an explicit `false`/`0`/`"false"`/`"0"`) — never `null`, since `086` gives the SP a `= 1` default and does not define `NULL`. Customer **read/write has no record gate** (spec §3: "any authenticated user of the company") — the SP's `CompId` filter is the tenancy boundary; `BranchId` on save is the creating user's (`req.user.BranchId`).

- [ ] **Step 1: Write the failing controller tests**

```js
// backend/tests/unit/controllers/customerController.test.js
jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const customerController = require("../../../src/controllers/customerController");
const { mockRes } = require("../../helpers/mockRes");

// Routes always run loadScope, so req.scope is present on every real request.
function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: {
      hierarchyLevel: 3,
      dataScope: "Branch",
      primaryBranchId: 2,
      branchIds: [2],
      ownerIds: null,
      canWriteBranchIds: [2],
      isAdmin: false,
    },
    body: {},
    ...overrides,
  };
}

const okRow = (extra = {}) => ({
  recordset: [{ Id: 31, ResponseCode: 200, ResponseMess: "Customer saved successfully", ...extra }],
});

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

const FULL = {
  Name: "Sharma Traders", ContactPerson: "Rakesh Sharma", Mobile: "98765 43210", AltMobile: null,
  Email: "rakesh@sharma.in", Address: "12 MG Road", City: "Ghaziabad", State: "UP", Pincode: "201010",
  Remarks: "Walk-in regular",
};

describe("customerController.save", () => {
  it("creates: injects Id=0, CompId, the caller's BranchId and UserId, and forwards exactly the SP's columns", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await customerController.save(baseReq({ body: { ...FULL, CompId: 999, IsActive: 0, Junk: "x" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveCustomer", {
      Id: 0, CompId: 5, BranchId: 2, UserId: 7,
      Name: "Sharma Traders", ContactPerson: "Rakesh Sharma", Mobile: "98765 43210", AltMobile: null,
      Email: "rakesh@sharma.in", Address: "12 MG Road", City: "Ghaziabad", State: "UP", Pincode: "201010",
      Remarks: "Walk-in regular",
    });
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).not.toHaveProperty("IsActive");
    expect(params).not.toHaveProperty("Junk");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.Id).toBe(31);
  });

  it("updates when Id > 0 (no record gate — customers are company-wide, spec §3)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 31 }));
    await customerController.save(baseReq({ body: { ...FULL, Id: "31" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ Id: 31, CompId: 5 });
  });

  it("400s without a Name before touching the DB", async () => {
    const res = mockRes();
    await customerController.save(baseReq({ body: { ...FULL, Name: "   " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR", message: "Name is required" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Spec §1: sp_SaveCustomer requires mobile OR email. Refusing here names the
  // rule; the SP enforces it too.
  it("400s when neither Mobile nor Email is given", async () => {
    const res = mockRes();
    await customerController.save(baseReq({ body: { Name: "Nobody", Mobile: "", Email: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Mobile or Email is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("accepts email-only and mobile-only customers", async () => {
    database.executeStoredProcedure.mockResolvedValue(okRow());
    await customerController.save(baseReq({ body: { Name: "A", Email: "a@x.in" } }), mockRes());
    await customerController.save(baseReq({ body: { Name: "B", Mobile: "9" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
  });

  // Spec §1: unique filtered index on (CompId, Mobile) WHERE IsActive = 1 —
  // the SP answers 409 and the controller must not flatten it into a 500.
  it("surfaces the SP's 409 on a duplicate mobile", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 0, ResponseCode: 409, ResponseMess: "A customer with this mobile already exists" }],
    });
    const res = mockRes();
    await customerController.save(baseReq({ body: FULL }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR", message: "A customer with this mobile already exists" });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.save(baseReq({ body: FULL }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("customerController.fetch", () => {
  it("forwards CompId + filters, defaults paging to 1/25 and IsActive to 1, maps two recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 31, Name: "Sharma Traders", OpenTickets: 2, TotalTickets: 5 }],
        [{ CurrentPage: 1, PageSize: 25, TotalRecords: 1, TotalPages: 1 }],
      ],
    });
    const res = mockRes();
    await customerController.fetch(baseReq({ body: { SearchTerm: "  sharma ", BranchId: "3" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCustomers", {
      CompId: 5, PageNumber: 1, PageSize: 25, SearchTerm: "sharma", BranchId: 3, IsActive: 1,
    });
    const { data } = res.json.mock.calls[0][0];
    expect(data.customers).toHaveLength(1);
    expect(data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });

  // REGRESSION guard (controllerKit): PageSize must never reach SQL Server raw.
  it("clamps PageSize to 200 and echoes the clamped value when the SP returns no pagination row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await customerController.fetch(baseReq({ body: { PageNumber: 3, PageSize: 99999 } }), res);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ PageNumber: 3, PageSize: 200 });
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 3, pageSize: 200, totalRecords: 0, totalPages: 1 });
  });

  it("sends IsActive 0 for an explicit false and nulls a junk BranchId / blank search", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await customerController.fetch(baseReq({ body: { IsActive: false, BranchId: "abc", SearchTerm: "  " } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ IsActive: 0, BranchId: null, SearchTerm: null });
  });

  // Customers are company-wide by design (dedupe needs it, spec §3) — the SP
  // declares no scope params, so none are sent (node-mssql rejects extras).
  it("does not send scope params — sp_FetchCustomers declares none", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await customerController.fetch(baseReq({ scope: { branchIds: [2], ownerIds: [7] } }), mockRes());
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).not.toHaveProperty("AccessibleBranchIdsJson");
    expect(params).not.toHaveProperty("OwnerIdsJson");
    expect(params).not.toHaveProperty("UserId");
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("customerController.detail", () => {
  it("passes CompId, CustomerId and the caller's scope; maps customer + tickets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 31, Name: "Sharma Traders", Mobile: "9876543210" }],
        [{ Id: 4, TicketNo: "TKT-000004", StatusCode: "open", IsOverdue: true }],
      ],
    });
    const res = mockRes();
    await customerController.detail(
      baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { CustomerId: "31" } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCustomerDetail", {
      CompId: 5, CustomerId: 31, UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]",
    });
    const { data } = res.json.mock.calls[0][0];
    expect(data.customer.Id).toBe(31);
    expect(data.tickets).toEqual([{ Id: 4, TicketNo: "TKT-000004", StatusCode: "open", IsOverdue: true }]);
  });

  it("sends null scope json for a wide scope (no owner filter on RS2)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 31 }], []] });
    await customerController.detail(baseReq({ scope: { branchIds: [1, 2, 3], ownerIds: null }, body: { CustomerId: 31 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ AccessibleBranchIdsJson: "[1,2,3]", OwnerIdsJson: null });
  });

  it("400s without a CustomerId before touching the DB", async () => {
    const res = mockRes();
    await customerController.detail(baseReq({ body: { CustomerId: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("CustomerId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("404s when the customer does not exist in this company", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const res = mockRes();
    await customerController.detail(baseReq({ body: { CustomerId: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "NOT_FOUND" });
  });

  it("tolerates a missing recordsets array (404, not a TypeError)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({});
    const res = mockRes();
    await customerController.detail(baseReq({ body: { CustomerId: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.detail(baseReq({ body: { CustomerId: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("customerController.delete", () => {
  it("calls sp_DeleteCustomer with Id then CompId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 31, ResponseCode: 200, ResponseMess: "Customer deleted successfully" }],
    });
    const res = mockRes();
    await customerController.delete(baseReq({ body: { Id: 31 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteCustomer", { Id: 31, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §3: soft delete, 409 while any ticket references the customer.
  it("surfaces the SP's 409 when tickets still reference the customer", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 31, ResponseCode: 409, ResponseMess: "Customer has 3 complaint(s) and cannot be deleted" }],
    });
    const res = mockRes();
    await customerController.delete(baseReq({ body: { Id: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toMatch(/cannot be deleted/);
  });

  it("400s without an Id", async () => {
    const res = mockRes();
    await customerController.delete(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("falls back to ResponseMessage when ResponseMess is absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMessage: "Deleted via ResponseMessage" }],
    });
    const res = mockRes();
    await customerController.delete(baseReq({ body: { Id: 31 } }), res);
    expect(res.json.mock.calls[0][0].message).toBe("Deleted via ResponseMessage");
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await customerController.delete(baseReq({ body: { Id: 31 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: Write the failing route test**

```js
// backend/tests/unit/routes/customerRoutes.test.js
//
// Customers are read and written by anyone in the company (spec 2 §3); only
// delete is an admin act. The controller suite tests the handlers, this tests
// that they are reachable, that delete is gated, and that requirePayload sits
// on every route but the list.

let mockScope;

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    req.user = { UserId: 7, CompId: 5, BranchId: 2 };
    next();
  },
}));

jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return {
    ...actual,
    loadScope: (req, res, next) => {
      req.scope = mockScope;
      next();
    },
  };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/customerController", () => ({
  save: hit("save"),
  fetch: hit("fetch"),
  detail: hit("detail"),
  delete: hit("delete"),
}));

const express = require("express");
const request = require("supertest");
const customerRoutes = require("../../../src/routes/customerRoutes");
const customerController = require("../../../src/controllers/customerController");

const app = express();
app.use(express.json());
app.use("/api/customers", customerRoutes);

const asAdmin = () => { mockScope = { isAdmin: true, hierarchyLevel: 1, dataScope: "All", branchIds: [2] }; };
const asAgent = () => { mockScope = { isAdmin: false, hierarchyLevel: 4, dataScope: "Self", branchIds: [2], ownerIds: [7] }; };

beforeEach(() => {
  jest.clearAllMocks();
  asAgent();
});

describe("customerRoutes", () => {
  it.each([
    ["/api/customers/saveCustomer", { Name: "Acme", Mobile: "9" }, "save"],
    ["/api/customers/fetchCustomers", {}, "fetch"],
    ["/api/customers/fetchCustomerDetail", { CustomerId: 31 }, "detail"],
  ])("routes %s to the %s handler for any authenticated user", async (path, body, handler) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  it("403s deleteCustomer for a non-admin without reaching the controller", async () => {
    const r = await request(app).post("/api/customers/deleteCustomer").send({ Id: 31 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("INSUFFICIENT_ROLE");
    expect(customerController.delete).not.toHaveBeenCalled();
  });

  it("lets an admin through to deleteCustomer", async () => {
    asAdmin();
    const r = await request(app).post("/api/customers/deleteCustomer").send({ Id: 31 });
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe("delete");
  });

  it("requires a payload on every route but fetchCustomers", async () => {
    expect((await request(app).post("/api/customers/saveCustomer").send({})).status).toBe(400);
    expect((await request(app).post("/api/customers/fetchCustomerDetail").send({})).status).toBe(400);
    asAdmin();
    expect((await request(app).post("/api/customers/deleteCustomer").send({})).status).toBe(400);
    expect((await request(app).post("/api/customers/fetchCustomers").send({})).status).toBe(200);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd backend && pnpm exec jest tests/unit/controllers/customerController.test.js --maxWorkers=2 --silent`
Expected: FAIL — `Cannot find module '../../../src/controllers/customerController'`.
Run: `cd backend && pnpm exec jest tests/unit/routes/customerRoutes.test.js --maxWorkers=2 --silent`
Expected: FAIL — `Cannot find module '../../../src/routes/customerRoutes'`.

- [ ] **Step 4: Implement the controller**

```js
// backend/src/controllers/customerController.js
//
// Spec 2 §1/§3: the light customer record a complaint hangs off. Company-wide
// on purpose — deduping "three spellings of one mobile" needs every agent to
// find the same row — so reads and writes carry no record gate; the SP's
// CompId filter is the tenancy boundary. Delete alone is admin-only (route).
const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { scopeParams } = require("../middleware/permission");
const { positiveInt, pageParams } = require("../utils/controllerKit");

// Mutating SPs return exactly one status row: Id + ResponseCode + ResponseMess.
// A non-200 code (400 validation, 409 duplicate mobile / tickets attached) is
// passed through with its message, never flattened into a 500.
async function runSp(res, spName, params, failMessage) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;
    if (spResponse.ResponseCode === 200) return responseHelper.success(res, message, spResponse);
    return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, failMessage);
  }
}

// Exactly the columns sp_SaveCustomer accepts. Anything else in the body is
// dropped — node-mssql sends every key it is given, and SQL Server rejects an
// undeclared parameter outright.
const CUSTOMER_FIELDS = [
  "Name", "ContactPerson", "Mobile", "AltMobile", "Email",
  "Address", "City", "State", "Pincode", "Remarks",
];
const pick = (body, keys) => Object.fromEntries(keys.map((k) => [k, body[k] ?? null]));
const blank = (s) => !s || !String(s).trim();
const trimmed = (s) => (blank(s) ? null : String(s).trim());
// Default 1, never null: sp_FetchCustomers declares @IsActive BIT = 1 and 086
// defines no meaning for NULL. Only an explicit false / 0 / "false" / "0" is 0.
const activeBit = (v) => (v === false || v === 0 || v === "false" || v === "0" ? 0 : 1);

const customerController = {
  async save(req, res) {
    const { CompId, BranchId, UserId } = req.user;
    const Id = positiveInt(req.body.Id) ?? 0;
    const fields = pick(req.body, CUSTOMER_FIELDS);
    // The SP enforces both rules too (spec §1); refusing here names the field
    // and saves the round-trip.
    if (blank(fields.Name)) return responseHelper.validationError(res, "Name is required");
    if (blank(fields.Mobile) && blank(fields.Email)) {
      return responseHelper.validationError(res, "Mobile or Email is required");
    }
    return runSp(
      res,
      "sp_SaveCustomer",
      { Id, CompId, BranchId, UserId, ...fields },
      "Failed to save customer",
    );
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const { SearchTerm = null, BranchId = null, IsActive = 1 } = req.body;
      // Clamped, not taken raw: PageSize goes straight to the SP, which has no
      // ceiling of its own. Default 25 matches the SP's own default.
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      // No scopeParams: the SP declares none (company-wide by design, spec §3),
      // and node-mssql rejects a call that passes an undeclared parameter.
      const result = await database.executeStoredProcedure("sp_FetchCustomers", {
        CompId,
        PageNumber,
        PageSize,
        SearchTerm: trimmed(SearchTerm),
        BranchId: positiveInt(BranchId),
        IsActive: activeBit(IsActive),
      });

      const customers = result.recordsets?.[0] ?? [];
      const pagination = result.recordsets?.[1]?.[0] ?? {};
      return responseHelper.success(res, "Customers fetched successfully", {
        customers,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? customers.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchCustomers error:", err);
      return responseHelper.error(res, "Failed to fetch customers");
    }
  },

  async detail(req, res) {
    const { CompId } = req.user;
    const CustomerId = positiveInt(req.body.CustomerId);
    if (!CustomerId) return responseHelper.validationError(res, "CustomerId is required");
    try {
      // RS1 is the company-wide customer row; RS2 is that customer's complaints
      // under the CALLER's scope predicate (plan ambiguity 6) — a Self agent
      // sees the customer but only their own tickets for them.
      const result = await database.executeStoredProcedure("sp_FetchCustomerDetail", {
        CompId,
        CustomerId,
        ...scopeParams(req),
      });
      const rs = result.recordsets ?? [];
      const customer = rs[0]?.[0] || null;
      if (!customer) return responseHelper.error(res, "Customer not found", "NOT_FOUND", 404);
      return responseHelper.success(res, "Customer detail fetched successfully", {
        customer,
        tickets: rs[1] || [],
      });
    } catch (err) {
      console.error("sp_FetchCustomerDetail error:", err);
      return responseHelper.error(res, "Failed to fetch customer detail");
    }
  },

  // requireAdmin sits on the route. The SP soft-deletes and answers 409 while
  // any ticket still references the customer — surfaced as-is.
  async delete(req, res) {
    const { CompId } = req.user;
    const Id = positiveInt(req.body.Id);
    if (!Id) return responseHelper.validationError(res, "Id is required");
    return runSp(res, "sp_DeleteCustomer", { Id, CompId }, "Failed to delete customer");
  },
};

module.exports = customerController;
```

- [ ] **Step 5: Add the router and mount it**

```js
// backend/src/routes/customerRoutes.js
const express = require("express");
const customerController = require("../controllers/customerController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// loadScope populates req.scope; fetchCustomerDetail passes it on so RS2 (the
// customer's complaints) is narrowed to what the caller may see.
router.use(verifyToken, loadScope);

// Read + write open to every authenticated user of the company (spec 2 §3):
// the agent typing a mobile at the counter is the one who creates the row.
router.post("/saveCustomer", requirePayload, customerController.save);
router.post("/fetchCustomers", allowEmptyPayload, customerController.fetch);
router.post("/fetchCustomerDetail", requirePayload, customerController.detail);
// Delete is an admin act — it soft-deletes a row other agents' complaints hang off.
router.post("/deleteCustomer", requireAdmin, requirePayload, customerController.delete);

module.exports = router;
```

In `backend/src/config/routes.js`, after line 14 (`const ticketRoutes = require("../routes/ticketRoutes");`) add:

```js
const customerRoutes = require("../routes/customerRoutes");
```

and after line 36 (`app.use("/api/tickets", ticketRoutes);`) add:

```js
  app.use("/api/customers", customerRoutes);
```

- [ ] **Step 6: Run both to verify they pass, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/controllers/customerController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/customerController.js'`
Expected: 23 passed; `customerController.js` ≥ 80 % lines and branches (every early return and both `recordset`/`recordsets` shapes have a case above).
Run: `cd backend && pnpm exec jest tests/unit/routes/customerRoutes.test.js --maxWorkers=2 --silent`
Expected: 6 passed.
Run: `cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent`
Expected: all passed — the new file's two direct `executeStoredProcedure` calls carry `CompId` inside the multi-line param block the contract test greps for.

- [ ] **Step 7: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 6: `ticketController.save / fetch / detail`

**Files:**
- Modify: `backend/src/controllers/ticketController.js:1-150` (imports, `runSp`, `TICKET_FIELDS`, helpers, `save`, `fetch`, `detail` — replaced), `:152-164` (`moveStage` — deleted; `sp_MoveTicketStage` is dropped by `086`), `:166-209` (`resolve`, `close`, `reopen`, `delete` — **left untouched**; Task 7 and Task 8 rewrite them)
- Modify: `backend/src/routes/ticketRoutes.js:14` (delete the `moveTicketStage` line — the handler no longer exists and Express throws on an undefined callback at require time)
- Modify: `backend/tests/unit/controllers/ticketController.test.js` (whole file replaced)

**Interfaces:**
- Consumes: `assertRecordAccess` / `assertCanAssign` / `canSeeRecord` / `scopeParams` from `src/middleware/permission.js` (Task 4 shape — truthiness unchanged); `positiveInt`, `pageParams` from `src/utils/controllerKit.js`; `parseDay` from `src/utils/reportKit.js` (returns a `Date` for a real `YYYY-MM-DD`, `null` otherwise — `2026-02-30` is null); `attachmentController.cascadeDelete` (still used by the untouched `delete`). SPs from `086` §6: `sp_SaveTicket`, `sp_FetchTickets`, `sp_FetchTicketDetail` (Contracts block).
- Produces (web Tasks 14–16, mobile Task 19):
  - `POST /api/tickets/saveTicket` body `{ Id, CustomerId, Subject, ContactPerson, Contact, ChannelId, CategoryId, Priority, ProductId, AssignedTo, LinkedLeadId, Description, CustomJSON }` → status row `+TicketNo`. Create (`Id` absent/0): 400 `"CustomerId is required"`, 400 `"Subject is required"`; `AssignedTo` set → `assertCanAssign({ toUserId, toBranchId: null })`. Update: `assertRecordAccess` first, then `AssignedTo` forced `null` (transfer is the only path).
  - `POST /api/tickets/fetchTickets` body `{ BranchId, PageNumber, PageSize (≤200, default 25), SearchTerm, StatusId, StatusCode, Priority, CategoryId, ChannelId, ProductId, CustomerId, AssignedTo, Overdue, Escalated, Unassigned, FromDate, ToDate }` → `data: { tickets, pagination: { currentPage, pageSize, totalRecords, totalPages } }`. Bits are `1|0`, ids via `positiveInt`, dates ISO-or-null, `StatusCode` trimmed + lower-cased (`'active'` or a code; a bogus code matches nothing — never widened to null).
  - `POST /api/tickets/fetchTicketDetail` body `{ TicketId }` → `data: { ticket, fields, activity, assignments, linkedLead }` (RS1–RS5); 400 without `TicketId`; 404 when missing **or** out of scope.

Decisions (spec silent): default `PageSize` is **25** (the SP's own default; the old controller said 10). Id-typed body fields go through `positiveInt` on save so a select's `""` becomes `null` instead of failing an INT parameter. `Subject` is trimmed. On update the controller does **not** re-require `CustomerId`/`Subject` (the SP keeps existing values for NULL; the web edit modal sends both anyway).

- [ ] **Step 1: Replace the test file**

Write `backend/tests/unit/controllers/ticketController.test.js` in full:

```js
jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const ticketController = require("../../../src/controllers/ticketController");
const { mockRes } = require("../../helpers/mockRes");

// Routes always run loadScope, so req.scope is present on every real request.
// Default here mirrors a Branch-scoped user (sees their branch, no ownership
// filter, and wide enough for assertCanAssign's manager-only checks).
function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: {
      hierarchyLevel: 3,
      dataScope: "Branch",
      primaryBranchId: 2,
      branchIds: [2],
      ownerIds: null,
      canWriteBranchIds: [2],
      isAdmin: false,
    },
    body: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

// Guard lookup: mutations fetch the ticket (sp_FetchTicketDetail — five
// recordsets since 086: core, custom values, timeline, assignments, linked
// lead) and apply canSeeRecord before running the mutating SP.
function mockTicketLookup(ticket) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ticket ? [ticket] : [], [], [], [], []],
  });
}
const visibleTicket = { Id: 1, BranchId: 2, AssignedTo: 7, CreatedBy: 7 };

// assertCanAssign's roster lookup (sp_FetchAssignableUsers).
function mockRoster(...ids) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ids.map((Id) => ({ Id }))],
  });
}

const okRow = (extra = {}) => ({
  recordset: [{ Id: 1, ResponseCode: 200, ResponseMess: "ok", ...extra }],
});

const CREATE_BODY = {
  CustomerId: 31, Subject: "  Inverter trips at noon ", ContactPerson: "Rakesh", Contact: "9876543210",
  ChannelId: 51, CategoryId: 7, Priority: 3, ProductId: 2, AssignedTo: 18, LinkedLeadId: 9,
  Description: "Trips daily around 12:30", CustomJSON: '[{"fieldId":1,"type":"text","value":"x"}]',
};

describe("ticketController.save — create", () => {
  it("injects Id=0/CompId/BranchId/UserId, trims Subject, forwards exactly sp_SaveTicket's columns, echoes TicketNo", async () => {
    mockRoster(18); // AssignedTo 18 is assignable by the caller
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 12, TicketNo: "TKT-000012" }));
    const res = mockRes();
    await ticketController.save(baseReq({ body: CREATE_BODY }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SaveTicket", {
      Id: 0, CompId: 5, BranchId: 2, UserId: 7,
      CustomerId: 31, Subject: "Inverter trips at noon", ContactPerson: "Rakesh", Contact: "9876543210",
      ChannelId: 51, CategoryId: 7, Priority: 3, ProductId: 2, AssignedTo: 18, LinkedLeadId: 9,
      Description: "Trips daily around 12:30", CustomJSON: '[{"fieldId":1,"type":"text","value":"x"}]',
    });
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data.TicketNo).toBe("TKT-000012");
  });

  // 086 drops CustomerName / Channel / PipelineId / StageId. A stale client
  // still sending them must not blow up the call — node-mssql rejects an
  // undeclared parameter outright — and the body never names its own tenant.
  it("drops the retired columns and unknown keys; the body cannot override CompId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(
      baseReq({ body: { ...CREATE_BODY, AssignedTo: null, CustomerName: "Acme", Channel: "Phone", PipelineId: 1, StageId: 2, CompId: 999, CreatedBy: 1, Nonsense: "x" } }),
      mockRes(),
    );
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.CompId).toBe(5);
    for (const k of ["CustomerName", "Channel", "PipelineId", "StageId", "CreatedBy", "Nonsense"]) {
      expect(params).not.toHaveProperty(k);
    }
  });

  // Spec §3: the two things a complaint cannot exist without.
  it("400s without a CustomerId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, CustomerId: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR", message: "CustomerId is required" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a Subject (blank counts as missing)", async () => {
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, Subject: "   " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Subject is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("normalises id fields: a select's empty string and junk become null, numeric strings become ints", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(
      baseReq({ body: { CustomerId: "31", Subject: "x", CategoryId: "", Priority: "3", ProductId: "abc", ChannelId: 0 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // no roster call: AssignedTo is null
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      CustomerId: 31, CategoryId: null, Priority: 3, ProductId: null, ChannelId: null, AssignedTo: null, LinkedLeadId: null,
    });
  });

  // Assigning on create is an assignment: same roster rule as transfer.
  it("403s a create assigned to someone outside the caller's roster, never calling sp_SaveTicket", async () => {
    mockRoster(4); // not 18
    const res = mockRes();
    await ticketController.save(baseReq({ body: CREATE_BODY }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // roster only
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_SaveTicket", expect.anything());
  });

  it("skips the roster check for an unassigned create", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure.mock.calls[0][0]).toBe("sp_SaveTicket");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // The SP checks the customer is active and in this company (spec §3: 404).
  it("surfaces the SP's 404 for a customer outside the company", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 0, ResponseCode: 404, ResponseMess: "Customer not found" }],
    });
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null, CustomerId: 999 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR" });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.save(baseReq({ body: { ...CREATE_BODY, AssignedTo: null } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.save — update", () => {
  // Ownership moves through transfer (history + notification), status through
  // setStatus (guards). An edit must not be a side door for either.
  it("gates on the ticket, then saves with AssignedTo dropped and no status key", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.save(baseReq({ body: { Id: "1", ...CREATE_BODY, AssignedTo: 18, StatusId: 99 } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // lookup + save; no roster
    const [sp, params] = database.executeStoredProcedure.mock.calls[1];
    expect(sp).toBe("sp_SaveTicket");
    expect(params).toMatchObject({ Id: 1, CompId: 5, AssignedTo: null, CustomerId: 31, Subject: "Inverter trips at noon" });
    expect(params).not.toHaveProperty("StatusId");
  });

  // REGRESSION: save was once the one mutating endpoint with no guard — any
  // authenticated user could POST {Id} and rewrite a ticket they cannot read.
  it("403s an update on a ticket the caller cannot see, without running the SP", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.save(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Id: 1, Subject: "hijacked" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // the lookup only
  });

  it("allows an update on a ticket assigned to the caller from an out-of-scope branch", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 7, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.save(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Id: 1, Description: "more detail" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("ticketController.fetch", () => {
  // REGRESSION: fetch used to pass req.user.BranchId as the visibility filter,
  // so every ticket raised in another branch vanished. Visibility comes from
  // req.scope; BranchId in the body is a filter that narrows within it.
  it("passes scope (not the caller's own BranchId); defaults paging to 1/25 and every filter to null / 0 — the full sp_FetchTickets contract", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(baseReq({ scope: { branchIds: [1, 2, 3, 4, 5], ownerIds: null } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchTickets", {
      CompId: 5, BranchId: null, PageNumber: 1, PageSize: 25, SearchTerm: null,
      StatusId: null, StatusCode: null, Priority: null, CategoryId: null, ChannelId: null, ProductId: null,
      CustomerId: null, AssignedTo: null, Overdue: 0, Escalated: 0, Unassigned: 0, FromDate: null, ToDate: null,
      UserId: 7, AccessibleBranchIdsJson: "[1,2,3,4,5]", OwnerIdsJson: null,
    });
  });

  it("sends an ownership filter for a Self-scoped agent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(baseReq({ scope: { branchIds: [2], ownerIds: [7] } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]" });
  });

  // The web presets (spec §4) arrive as these params: My queue = AssignedTo,
  // Unassigned / Overdue / Escalated = bits, On hold / Closed = StatusCode.
  it("maps the preset params: bits to 1, codes lower-cased, ids to ints, ISO dates through, search trimmed", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(
      baseReq({
        body: {
          StatusCode: " Active ", StatusId: "61", Overdue: true, Escalated: 1, Unassigned: "true",
          AssignedTo: "18", CustomerId: 31, ChannelId: 51, ProductId: 2, CategoryId: 7, Priority: "4",
          FromDate: "2026-09-01", ToDate: "2026-09-16", BranchId: 3, SearchTerm: " inverter ",
        },
      }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      StatusCode: "active", StatusId: 61, Overdue: 1, Escalated: 1, Unassigned: 1,
      AssignedTo: 18, CustomerId: 31, ChannelId: 51, ProductId: 2, CategoryId: 7, Priority: 4,
      FromDate: "2026-09-01", ToDate: "2026-09-16", BranchId: 3, SearchTerm: "inverter",
    });
  });

  it("treats 'false' / '0' as 0 and nulls a non-ISO or impossible date", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await ticketController.fetch(
      baseReq({ body: { Overdue: "false", Escalated: "0", Unassigned: 0, FromDate: "01/09/2026", ToDate: "2026-02-30", StatusCode: "" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      Overdue: 0, Escalated: 0, Unassigned: 0, FromDate: null, ToDate: null, StatusCode: null,
    });
  });

  // REGRESSION (controllerKit): PageSize went straight to the SP, so one
  // request could ask SQL Server for every row the scope allows.
  it("clamps PageSize to 200 and echoes the clamped value", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const res = mockRes();
    await ticketController.fetch(baseReq({ body: { PageNumber: 2, PageSize: 99999 } }), res);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ PageNumber: 2, PageSize: 200 });
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 2, pageSize: 200, totalRecords: 0, totalPages: 1 });
  });

  it("maps rows + the pagination recordset", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, TicketNo: "TKT-000001", StatusCode: "open", IsOverdue: true }],
        [{ CurrentPage: 1, PageSize: 25, TotalRecords: 1, TotalPages: 1 }],
      ],
    });
    const res = mockRes();
    await ticketController.fetch(baseReq(), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.tickets).toHaveLength(1);
    expect(data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });

  it("falls back to defaults when the pagination recordset is missing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [undefined] });
    const res = mockRes();
    await ticketController.fetch(baseReq(), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.tickets).toEqual([]);
    expect(data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 0, totalPages: 1 });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.detail", () => {
  it("maps the five recordsets to ticket / fields / activity / assignments / linkedLead", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, TicketNo: "TKT-000001", BranchId: 2, AssignedTo: 4, CreatedBy: 4, CustomerName: "Sharma Traders", PreviousTickets: 2 }],
        [{ FieldId: 2, Type: "text", ValueText: "x" }],
        [{ Id: 9, Type: "created", Summary: "created" }],
        [{ Id: 3, FromUserId: null, ToUserId: 4, Reason: "Absent" }],
        [{ Id: 9, Name: "Acme Corp" }],
      ],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: "1" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchTicketDetail", { CompId: 5, TicketId: 1 });
    const { data } = res.json.mock.calls[0][0];
    expect(data.ticket.TicketNo).toBe("TKT-000001");
    expect(data.fields).toHaveLength(1);
    expect(data.activity).toHaveLength(1);
    expect(data.assignments).toEqual([{ Id: 3, FromUserId: null, ToUserId: 4, Reason: "Absent" }]);
    expect(data.linkedLead).toEqual({ Id: 9, Name: "Acme Corp" });
  });

  it("returns linkedLead null and empty lists when the tail recordsets are absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, BranchId: 2, AssignedTo: 7, CreatedBy: 7 }]],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.fields).toEqual([]);
    expect(data.assignments).toEqual([]);
    expect(data.linkedLead).toBeNull();
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.detail(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // A missing ticket and a forbidden one give the same answer, so the endpoint
  // cannot be used to probe which ids exist.
  it("404s when the ticket does not exist", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [], [], [], []] });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s when the recordsets array is empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s a ticket outside the caller's scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, BranchId: 9, AssignedTo: 4, CreatedBy: 4 }], [], [], [], []],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ scope: { branchIds: [2], ownerIds: null }, body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // Assignment is an explicit act of sharing and must beat scope.
  it("shows a ticket assigned to the caller even from an out-of-scope branch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, BranchId: 9, AssignedTo: 7, CreatedBy: 4 }], [], [], [], []],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.ticket.Id).toBe(1);
  });

  it("shows a ticket the caller created but assigned to someone else", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, BranchId: 9, AssignedTo: 4, CreatedBy: 7 }], [], [], [], []],
    });
    const res = mockRes();
    await ticketController.detail(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.detail(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// Carried forward from the pre-086 suite. resolve / close / reopen / delete are
// untouched by Task 6; Task 7 (lifecycle) and Task 8 (delete) rewrite them and
// REPLACE this block.
describe("ticketController resolve/close/reopen/delete — carried forward, rewritten in Tasks 7–8", () => {
  it("403s a mutation on a ticket the caller cannot see, without running the SP", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.resolve(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { TicketId: 1, ResolutionId: 8 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("close/reopen/delete map to their SPs", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_CloseTicket", { CompId: 5, TicketId: 1, UserId: 7 });

    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.reopen(baseReq({ body: { TicketId: 1 } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ReopenTicket", { CompId: 5, TicketId: 1, UserId: 7 });

    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValue(okRow()); // delete + attachment cascade
    await ticketController.delete(baseReq({ body: { Id: 1 } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteTicket", { Id: 1, CompId: 5 });
  });

  it("handles DB error as 500 on a mutating call", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// 086 drops the pipeline engine: sp_MoveTicketStage is gone, so is the handler.
describe("ticketController pipeline removal", () => {
  it("no longer exposes moveStage", () => {
    expect(ticketController.moveStage).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/controllers/ticketController.test.js --maxWorkers=2 --silent`
Expected: FAIL — the create test receives `CustomerName: null, Channel: null, PipelineId: null, StageId: null` in the params and no `CustomerId`; the 400 tests get 200; `moveStage` is still defined; fetch expects `PageSize: 25` and `Overdue: 0` and receives `10` / no key; detail expects `assignments` and receives `linkedLead` from RS4.

- [ ] **Step 3: Replace the top of the controller**

In `backend/src/controllers/ticketController.js` replace lines 1–150 (everything from the first `require` through the closing `},` of `detail`) with:

```js
const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const attachmentController = require("./attachmentController");
const {
  scopeParams,
  canSeeRecord,
  assertRecordAccess,
  assertCanAssign,
} = require("../middleware/permission");
const { positiveInt, pageParams } = require("../utils/controllerKit");
const { parseDay } = require("../utils/reportKit");

// Mutating SPs log their own activity server-side and return exactly one
// status row: Id + ResponseCode + ResponseMess (+ TicketNo from sp_SaveTicket).
// A non-200 code (400 validation, 403 reopen gate, 404 customer) is passed
// through with its message, never flattened into a 500.
async function runSp(res, spName, params, failMessage) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;
    if (spResponse.ResponseCode === 200) return responseHelper.success(res, message, spResponse);
    return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, failMessage);
  }
}

// Exactly the columns sp_SaveTicket accepts (086). Anything else in the body is
// dropped — the retired CustomerName / Channel / PipelineId / StageId included;
// node-mssql sends every key it is given and SQL Server rejects an undeclared
// parameter outright.
const TICKET_FIELDS = [
  "CustomerId", "Subject", "ContactPerson", "Contact", "ChannelId",
  "CategoryId", "Priority", "ProductId", "AssignedTo", "LinkedLeadId",
  "Description", "CustomJSON",
];
// The INT columns among them: a select's "" or a junk string becomes null
// rather than reaching an INT parameter and failing the whole save.
const TICKET_ID_FIELDS = [
  "CustomerId", "ChannelId", "CategoryId", "Priority", "ProductId", "AssignedTo", "LinkedLeadId",
];
const pick = (body, keys) => Object.fromEntries(keys.map((k) => [k, body[k] ?? null]));
const blank = (s) => !s || !String(s).trim();
const trimmed = (s) => (blank(s) ? null : String(s).trim());
// BIT params want 1/0. Presets are URL-driven on the web, so "false" / "0" are 0.
const bit = (v) => (v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);
// A date filter carries an ISO day. Anything else is dropped rather than handed
// to @FromDate DATE as-is — reportKit's round-trip parse also rejects
// 2026-02-30, which the shape alone would pass.
const isoDay = (s) => (typeof s === "string" && parseDay(s) ? s : null);

const ticketController = {
  async save(req, res) {
    const { CompId, BranchId, UserId } = req.user;
    const Id = positiveInt(req.body.Id) ?? 0;
    const fields = pick(req.body, TICKET_FIELDS);
    for (const k of TICKET_ID_FIELDS) fields[k] = positiveInt(fields[k]);
    fields.Subject = trimmed(fields.Subject);

    if (Id === 0) {
      // The two things a complaint cannot exist without (spec §3). The SP
      // checks too; refusing here names the field and saves the round-trip.
      if (!fields.CustomerId) return responseHelper.validationError(res, "CustomerId is required");
      if (!fields.Subject) return responseHelper.validationError(res, "Subject is required");
      // Assigning on create is an assignment: same roster rule as transfer.
      // Only when a target is named — an unassigned create is legal for
      // everyone, while assertCanAssign 403s a null target below Branch scope.
      if (fields.AssignedTo
          && !(await assertCanAssign(req, res, { toUserId: fields.AssignedTo, toBranchId: null }))) return;
    } else {
      if (!(await assertRecordAccess(req, res, "ticket", Id))) return;
      // Ownership moves through transfer (history + notification), status
      // through setStatus (the reopen gate). The SP ignores AssignedTo on
      // update; not sending it keeps that fact visible here, not in T-SQL.
      fields.AssignedTo = null;
    }
    return runSp(res, "sp_SaveTicket", { Id, CompId, BranchId, UserId, ...fields }, "Failed to save ticket");
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const b = req.body;
      // Clamped, not taken raw: PageSize goes straight to the SP, which has no
      // ceiling of its own. Default 25 matches the SP's own default.
      const { PageNumber, PageSize } = pageParams(b, 25);

      const result = await database.executeStoredProcedure("sp_FetchTickets", {
        CompId,
        // An optional UI filter: narrows within scope, never widens it.
        // Visibility comes from scopeParams — passing req.user.BranchId here
        // is what once hid every out-of-branch ticket.
        BranchId: positiveInt(b.BranchId),
        PageNumber,
        PageSize,
        SearchTerm: trimmed(b.SearchTerm),
        StatusId: positiveInt(b.StatusId),
        // 'active' (open + onhold) or one code. A bogus value matches nothing;
        // it is never nulled, since null would WIDEN the list to every status.
        StatusCode: trimmed(b.StatusCode)?.toLowerCase() ?? null,
        Priority: positiveInt(b.Priority),
        CategoryId: positiveInt(b.CategoryId),
        ChannelId: positiveInt(b.ChannelId),
        ProductId: positiveInt(b.ProductId),
        CustomerId: positiveInt(b.CustomerId),
        AssignedTo: positiveInt(b.AssignedTo),
        Overdue: bit(b.Overdue),
        Escalated: bit(b.Escalated),
        Unassigned: bit(b.Unassigned),
        FromDate: isoDay(b.FromDate),
        ToDate: isoDay(b.ToDate),
        ...scopeParams(req),
      });

      const tickets = result.recordsets?.[0] ?? [];
      const pagination = result.recordsets?.[1]?.[0] ?? {};
      return responseHelper.success(res, "Tickets fetched successfully", {
        tickets,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? tickets.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchTickets error:", err);
      return responseHelper.error(res, "Failed to fetch tickets");
    }
  },

  async detail(req, res) {
    const { CompId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    if (!TicketId) return responseHelper.validationError(res, "TicketId is required");
    try {
      const result = await database.executeStoredProcedure("sp_FetchTicketDetail", {
        CompId,
        TicketId,
      });
      const rs = result.recordsets ?? [];
      const ticket = rs[0]?.[0] || null;
      // The detail SP is CompId-scoped only, so gate the row here. 404 rather
      // than 403: a user who cannot see a ticket should not learn it exists.
      if (!canSeeRecord(req, ticket, "AssignedTo")) {
        return responseHelper.error(res, "Ticket not found", "NOT_FOUND", 404);
      }
      // 086: RS1 core + customer columns, RS2 custom values, RS3 timeline,
      // RS4 assignment history, RS5 linked lead (empty when none).
      return responseHelper.success(res, "Ticket detail fetched successfully", {
        ticket,
        fields: rs[1] || [],
        activity: rs[2] || [],
        assignments: rs[3] || [],
        linkedLead: rs[4]?.[0] || null,
      });
    } catch (err) {
      console.error("sp_FetchTicketDetail error:", err);
      return responseHelper.error(res, "Failed to fetch ticket detail");
    }
  },
```

Then **delete** the whole `moveStage` method (old lines 152–164, from `async moveStage(req, res) {` through its closing `},`). Leave `resolve`, `close`, `reopen`, `delete` and the trailing `};` / `module.exports` exactly as they are.

- [ ] **Step 4: Drop the dead route**

In `backend/src/routes/ticketRoutes.js` delete line 14:

```js
router.post("/moveTicketStage", requirePayload, ticketController.moveStage);
```

(Express 5 throws `Route.post() requires a callback function but got a [object Undefined]` at require time otherwise — the server would not boot.)

- [ ] **Step 5: Run to verify it passes, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/controllers/ticketController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/ticketController.js'`
Expected: 33 passed; `ticketController.js` ≥ 80 % lines and branches (the untouched tail is exercised by the carried-forward block).
Run: `cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent`
Expected: all passed (`sp_FetchTickets` and `sp_FetchTicketDetail` calls carry `CompId` in a multi-line param block).

- [ ] **Step 6: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---


### Task 7: `ticketController.setStatus / resolve / close / reject / reopen`

**Files:**
- Modify: `backend/src/controllers/ticketController.js` — the `require("../middleware/permission")` destructure at the top (add `canReopen`); insert `gateTicket` after the `isoDay` helper (Task 6) and before `const ticketController = {`; replace the three methods `resolve`, `close`, `reopen` (after Task 6 they sit between `detail` and `delete`) with `setStatus`, `resolve`, `close`, `reject`, `reopen`. `delete` stays untouched until Task 8.
- Modify: `backend/tests/unit/controllers/ticketController.test.js` — replace the describe block `"ticketController resolve/close/reopen/delete — carried forward, rewritten in Tasks 7–8"` (Task 6) with the six describes below; keep `"ticketController pipeline removal"`.

**Interfaces:**
- Consumes: `assertRecordAccess(req, res, "ticket", id)` → the ticket row (`{ Id, BranchId, AssignedTo, CreatedBy, … }`) or `false` after it has sent the 403/500 (Task 4); `canReopen(req, record)` → `boolean`, pure (Task 4); `runSp(res, spName, params, failMessage)`, `trimmed(s)`, `positiveInt(v)` already in the file since Task 6. SPs from the Contracts block: `sp_SetTicketStatus @CompId, @TicketId, @StatusId, @UserId, @ResolutionId = NULL, @Remarks = NULL, @AllowReopen BIT = 0` · `sp_ResolveTicket @CompId, @TicketId, @ResolutionId, @Remarks, @UserId` · `sp_CloseTicket @CompId, @TicketId, @UserId, @ResolutionId = NULL, @Remarks = NULL` · `sp_RejectTicket @CompId, @TicketId, @Remarks, @UserId` · `sp_ReopenTicket @CompId, @TicketId, @Remarks, @UserId, @AllowReopen BIT = 0`.
- Produces (Task 8 wires the routes; web Task 16, mobile Tasks 19 + 22 call them):
  - `POST /api/tickets/setTicketStatus` body `{ TicketId, StatusId, ResolutionId, Remarks }` → `sp_SetTicketStatus { CompId, TicketId, StatusId, UserId, ResolutionId, Remarks, AllowReopen }` → status row. 400 `"TicketId is required"` / `"StatusId is required"` before any DB call; 403 from the guard; the SP's 400 (remarks / resolution missing), 403 (`Reopening requires a manager`) and 404 (unknown status) surfaced as `code: "SP_ERROR"` with the SP's message.
  - `POST /api/tickets/resolveTicket` `{ TicketId, ResolutionId, Remarks }` → `sp_ResolveTicket { CompId, TicketId, ResolutionId, Remarks, UserId }`.
  - `POST /api/tickets/closeTicket` `{ TicketId, ResolutionId, Remarks }` → `sp_CloseTicket { CompId, TicketId, UserId, ResolutionId, Remarks }`.
  - `POST /api/tickets/rejectTicket` `{ TicketId, Remarks }` → `sp_RejectTicket { CompId, TicketId, Remarks, UserId }`.
  - `POST /api/tickets/reopenTicket` `{ TicketId, Remarks }` → `sp_ReopenTicket { CompId, TicketId, Remarks, UserId, AllowReopen }`.
  - Module-private `gateTicket(req, res, TicketId)` → ticket row | `null` (after sending 400 or 403). Task 8's `transfer` and `escalate` reuse it.

Decisions (spec silent): **Node validates shape, the SP validates lifecycle.** Ids (`TicketId`, `StatusId`) are checked in Node and 400 before any round-trip; "remarks required", "resolution required" and "is this move a reopen" live in `sp_SetTicketStatus` (spec §2 table) and are surfaced as the SP's 400/403 — duplicating them here would put the lifecycle table in two places. `Remarks` is trimmed and becomes `null` when blank (so the SP's NULL check fires); `ResolutionId` goes through `positiveInt` (a select's `""` becomes `null`). `AllowReopen` is passed on **every** `setStatus` and `reopen` call as `canReopen(req, ticket) ? 1 : 0` (plan ambiguity 2); `resolve`/`close`/`reject` do not declare it and node-mssql rejects an undeclared parameter, so it is not sent there. An unknown `TicketId` gets the guard's 403 (no row = no access — the endpoint cannot be used to probe ids).

- [ ] **Step 1: Replace the carried-forward block in the test file**

The file already has these helpers from Task 6 (do not redeclare them):

```js
function mockTicketLookup(ticket) {           // sp_FetchTicketDetail: 5 recordsets since 086
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ticket ? [ticket] : [], [], [], [], []],
  });
}
const visibleTicket = { Id: 1, BranchId: 2, AssignedTo: 7, CreatedBy: 7 };
const okRow = (extra = {}) => ({
  recordset: [{ Id: 1, ResponseCode: 200, ResponseMess: "ok", ...extra }],
});
```

In `backend/tests/unit/controllers/ticketController.test.js` delete the whole block from
`describe("ticketController resolve/close/reopen/delete — carried forward, rewritten in Tasks 7–8", () => {` through its closing `});` and put this in its place (before `describe("ticketController pipeline removal", …)`):

```js
// ---- Lifecycle (spec 2 §2): one engine, sp_SetTicketStatus, plus four
// shortcuts that delegate to it inside SQL. Node validates SHAPE (ids) and
// answers the reopen gate; every lifecycle rule — remarks required, resolution
// required, "is this move a reopen" — is the SP's, and its 400 / 403 comes
// back untouched. Node never inspects a status code.

// A Team lead over users 17 and 18, and a Self agent (user 7 in both cases).
const teamLeadReq = (body) =>
  baseReq({ scope: { dataScope: "Team", branchIds: [2], ownerIds: [7, 17, 18] }, body });
const selfReq = (body) =>
  baseReq({ scope: { dataScope: "Self", branchIds: [2], ownerIds: [7] }, body });
const subordinatesTicket = { Id: 1, BranchId: 2, AssignedTo: 17, CreatedBy: 17 };
const unassignedOwnTicket = { Id: 1, BranchId: 2, AssignedTo: null, CreatedBy: 7 };
const strangersTicket = { Id: 1, BranchId: 2, AssignedTo: 3, CreatedBy: 3 };

describe("ticketController.setStatus", () => {
  it("gates on the ticket, then calls sp_SetTicketStatus with exactly its params — AllowReopen 1 for a Branch manager", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Status: New → Resolved" }));
    const res = mockRes();
    await ticketController.setStatus(
      baseReq({ body: { TicketId: "1", StatusId: "64", ResolutionId: 8, Remarks: "  Replaced the fuse " } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SetTicketStatus", {
      CompId: 5, TicketId: 1, StatusId: 64, UserId: 7, ResolutionId: 8, Remarks: "Replaced the fuse", AllowReopen: 1,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // lookup + status
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Status: New → Resolved");
  });

  it("nulls a blank Remarks and a junk ResolutionId rather than sending '' / NaN", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(
      baseReq({ body: { TicketId: 1, StatusId: 62, ResolutionId: "", Remarks: "   " } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ ResolutionId: null, Remarks: null });
  });

  // Spec §3 Rules — Reopen. canReopen answers on every call; the SP applies it
  // only when the requested move IS a reopen. Node never reads the status code.
  it("passes AllowReopen 0 for a Self agent on their own ticket", async () => {
    mockTicketLookup(visibleTicket); // assigned to 7 = the caller
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(selfReq({ TicketId: 1, StatusId: 62 }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 0 });
  });

  it("passes AllowReopen 1 for a Team lead on a subordinate's ticket", async () => {
    mockTicketLookup(subordinatesTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(teamLeadReq({ TicketId: 1, StatusId: 62 }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 1 });
  });

  it("passes AllowReopen 0 for a Team lead on an unassigned ticket they created", async () => {
    mockTicketLookup(unassignedOwnTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.setStatus(teamLeadReq({ TicketId: 1, StatusId: 62 }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 0 });
  });

  // The SP owns the rule table (spec §2). Its answers must reach the client
  // with their message — the web shows them in a toast.
  it("surfaces the SP's 403 when a non-manager's move turns out to be a reopen", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 403, ResponseMess: "Reopening requires a manager" }],
    });
    const res = mockRes();
    await ticketController.setStatus(selfReq({ TicketId: 1, StatusId: 61, Remarks: "please" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR", message: "Reopening requires a manager" });
  });

  it("surfaces the SP's 400 when remarks are missing on a terminal move", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Remarks are required" }],
    });
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 66 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Remarks are required");
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { StatusId: 62 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR", message: "TicketId is required" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a StatusId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: "abc" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("StatusId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // REGRESSION: the write path once trusted the client-supplied TicketId — a
  // Self agent could restatus any colleague's complaint by posting its Id.
  it("403s a ticket the caller cannot see, without running the mutation", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.setStatus(selfReq({ TicketId: 1, StatusId: 62 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });

  it("403s an unknown ticket id from the guard (no row = no access, so ids cannot be probed)", async () => {
    mockTicketLookup(null);
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 999, StatusId: 62 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_SetTicketStatus", expect.anything());
  });

  it("handles a DB error on the mutation as 500", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.setStatus(baseReq({ body: { TicketId: 1, StatusId: 62 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// Shortcuts: each is "first status of that code by SortOrder" inside SQL and
// delegates to sp_SetTicketStatus. Mobile uses them; the web uses setStatus.
describe("ticketController.resolve", () => {
  it("gates, then calls sp_ResolveTicket with exactly its params — no AllowReopen (the SP does not declare it)", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.resolve(baseReq({ body: { TicketId: 1, ResolutionId: "8", Remarks: "Fixed" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ResolveTicket", {
      CompId: 5, TicketId: 1, ResolutionId: 8, Remarks: "Fixed", UserId: 7,
    });
    expect(database.executeStoredProcedure.mock.calls[1][1]).not.toHaveProperty("AllowReopen");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §6: resolve without resolution → 400. It is the SP's 400, not Node's:
  // sp_SetTicketStatus may also take the ticket's EXISTING ResolutionId, so the
  // controller cannot know the answer.
  it("surfaces the SP's 400 when no resolution is given", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "A resolution is required to resolve a complaint" }],
    });
    const res = mockRes();
    await ticketController.resolve(baseReq({ body: { TicketId: 1, Remarks: "done" } }), res);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ ResolutionId: null });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/resolution is required/);
  });

  it("403s a ticket outside the caller's scope, lookup only", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.resolve(baseReq({ body: { TicketId: 1, ResolutionId: 8, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("ticketController.close", () => {
  it("calls sp_CloseTicket with nulls for the optional resolution + remarks", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_CloseTicket", {
      CompId: 5, TicketId: 1, UserId: 7, ResolutionId: null, Remarks: null,
    });
  });

  it("forwards ResolutionId + Remarks for a straight-to-closed move", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.close(
      baseReq({ body: { TicketId: 1, ResolutionId: 8, Remarks: "Customer confirmed on call" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ ResolutionId: 8, Remarks: "Customer confirmed on call" });
  });

  // Assignment is an explicit act of sharing and beats scope.
  it("allows a close on a ticket assigned to the caller from an out-of-scope branch", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 7, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.close(selfReq({ TicketId: 1 }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("handles a DB error on the guard lookup as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.close(baseReq({ body: { TicketId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("ticketController.reject", () => {
  it("calls sp_RejectTicket with exactly its params", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.reject(baseReq({ body: { TicketId: 1, Remarks: " Out of warranty " } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_RejectTicket", {
      CompId: 5, TicketId: 1, Remarks: "Out of warranty", UserId: 7,
    });
    expect(database.executeStoredProcedure.mock.calls[1][1]).not.toHaveProperty("AllowReopen");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §6: reject without remarks → 400, from the SP (remarks required on `rejected`).
  it("surfaces the SP's 400 when remarks are missing", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Remarks are required to reject a complaint" }],
    });
    const res = mockRes();
    await ticketController.reject(baseReq({ body: { TicketId: 1 } }), res);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ Remarks: null });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("403s a ticket outside the caller's scope, lookup only", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.reject(selfReq({ TicketId: 1, Remarks: "no" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("ticketController.reopen", () => {
  it("manager: sp_ReopenTicket gets AllowReopen 1 with exactly its params", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { TicketId: 1, Remarks: "Customer called back" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ReopenTicket", {
      CompId: 5, TicketId: 1, Remarks: "Customer called back", UserId: 7, AllowReopen: 1,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §6: reopen by a Self agent → AllowReopen 0 → the SP's 403 surfaced.
  it("Self agent on their own ticket: AllowReopen 0, and the SP's 403 comes back as-is", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 403, ResponseMess: "Reopening requires a manager" }],
    });
    const res = mockRes();
    await ticketController.reopen(selfReq({ TicketId: 1, Remarks: "not fixed" }), res);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 0 });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "SP_ERROR", message: "Reopening requires a manager" });
  });

  it("Team lead on a subordinate's ticket: AllowReopen 1", async () => {
    mockTicketLookup(subordinatesTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.reopen(teamLeadReq({ TicketId: 1, Remarks: "Recurred" }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 1 });
  });

  it("Team lead on their own ticket: AllowReopen 0", async () => {
    mockTicketLookup(visibleTicket); // assigned to 7 = the lead themself
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.reopen(teamLeadReq({ TicketId: 1, Remarks: "Recurred" }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ AllowReopen: 0 });
  });

  it("403s an unknown ticket from the guard", async () => {
    mockTicketLookup(null);
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { TicketId: 999, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_ReopenTicket", expect.anything());
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.reopen(baseReq({ body: { Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

// delete is untouched by Task 7; Task 8 rewrites it and REPLACES this block.
describe("ticketController.delete — carried forward, rewritten in Task 8", () => {
  it("gates then maps to sp_DeleteTicket", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValue(okRow()); // delete + attachment cascade
    await ticketController.delete(baseReq({ body: { Id: 1 } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteTicket", { Id: 1, CompId: 5 });
  });

  it("403s a ticket outside the caller's scope", async () => {
    mockTicketLookup({ Id: 1, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pnpm exec jest tests/unit/controllers/ticketController.test.js --maxWorkers=2 --silent`
Expected: FAIL — every `setStatus` and `reject` test: `TypeError: ticketController.setStatus is not a function` / `ticketController.reject is not a function`; `resolve` receives `{ CompId, TicketId, ResolutionId, UserId }` (no `Remarks`); `close` receives `{ CompId, TicketId, UserId }` (no `ResolutionId`/`Remarks`); `reopen` receives no `AllowReopen`; the two 400 tests receive 500 with one DB call (the old code hands `undefined` to the guard). The two `delete` tests and everything above the block still pass.

- [ ] **Step 3: Implement**

In `backend/src/controllers/ticketController.js` replace the permission destructure at the top of the file with:

```js
const {
  scopeParams,
  canSeeRecord,
  assertRecordAccess,
  assertCanAssign,
  canReopen,
} = require("../middleware/permission");
```

Insert after the `isoDay` line (the last helper Task 6 added) and before `const ticketController = {`:

```js
// Every write that names a ticket starts the same way: a real TicketId, then
// the record gate. Resolves to the fetched row (assertRecordAccess hands it
// back since spec 2 — the reopen gate needs AssignedTo) or null once the 400 /
// 403 has gone out. Node validates SHAPE here; the lifecycle rules — remarks
// required, resolution required, whether a move is a reopen — are
// sp_SetTicketStatus's (spec 2 §2), and runSp surfaces its 400 / 403 untouched.
async function gateTicket(req, res, TicketId) {
  if (!TicketId) {
    responseHelper.validationError(res, "TicketId is required");
    return null;
  }
  return (await assertRecordAccess(req, res, "ticket", TicketId)) || null;
}
```

Replace the three methods `resolve`, `close`, `reopen` (from `async resolve(req, res) {` through the closing `},` of `reopen`; `delete` follows and stays) with:

```js
  // Spec 2 §2: the one lifecycle engine. Node answers the reopen gate on EVERY
  // call (plan ambiguity 2) and sp_SetTicketStatus alone decides whether the
  // requested move is a reopen — a Self agent moving New → In Progress passes
  // AllowReopen 0 and the SP never consults it.
  async setStatus(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    const StatusId = positiveInt(req.body.StatusId);
    // Both shape checks before the round-trip; gateTicket answers for TicketId.
    if (TicketId && !StatusId) return responseHelper.validationError(res, "StatusId is required");
    const ticket = await gateTicket(req, res, TicketId);
    if (!ticket) return;
    return runSp(
      res,
      "sp_SetTicketStatus",
      {
        CompId,
        TicketId,
        StatusId,
        UserId,
        ResolutionId: positiveInt(req.body.ResolutionId),
        Remarks: trimmed(req.body.Remarks),
        AllowReopen: canReopen(req, ticket) ? 1 : 0,
      },
      "Failed to update ticket status",
    );
  },

  // Shortcuts (spec §2): "first status of that code by SortOrder", delegating
  // to sp_SetTicketStatus inside SQL. Only reopen declares @AllowReopen —
  // node-mssql rejects a parameter the procedure does not declare, so it is
  // sent only where it exists.
  async resolve(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_ResolveTicket",
      { CompId, TicketId, ResolutionId: positiveInt(req.body.ResolutionId), Remarks: trimmed(req.body.Remarks), UserId },
      "Failed to resolve ticket",
    );
  },

  async close(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_CloseTicket",
      { CompId, TicketId, UserId, ResolutionId: positiveInt(req.body.ResolutionId), Remarks: trimmed(req.body.Remarks) },
      "Failed to close ticket",
    );
  },

  async reject(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_RejectTicket",
      { CompId, TicketId, Remarks: trimmed(req.body.Remarks), UserId },
      "Failed to reject ticket",
    );
  },

  async reopen(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    const ticket = await gateTicket(req, res, TicketId);
    if (!ticket) return;
    return runSp(
      res,
      "sp_ReopenTicket",
      { CompId, TicketId, Remarks: trimmed(req.body.Remarks), UserId, AllowReopen: canReopen(req, ticket) ? 1 : 0 },
      "Failed to reopen ticket",
    );
  },
```

Leave `delete` and the trailing `};` / `module.exports = ticketController;` exactly as they are.

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/controllers/ticketController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/ticketController.js'`
Expected: 60 passed (Task 6's 33, minus the 3 carried-forward, plus 30); `ticketController.js` ≥ 80 % lines and branches — both `gateTicket` exits, both `canReopen` answers and both `runSp` outcomes have a case above.
Run: `cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent`
Expected: all passed — the new methods call the DB only through `runSp` and `assertRecordAccess`, neither of which the contract's source grep examines; the file's direct calls are unchanged from Task 6.

- [ ] **Step 5: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 8: `ticketController.transfer / bulkTransfer / escalate / escalationTargets / delete` + routes

**Files:**
- Modify: `backend/src/controllers/ticketController.js` — insert `transferArgs` after `gateTicket` (Task 7) and before `const ticketController = {`; replace the `delete` method (the last one before `};`) with `transfer`, `bulkTransfer`, `escalate`, `escalationTargets`, `delete`.
- Modify: `backend/src/routes/ticketRoutes.js` (whole file replaced — the 13 routes of the Contracts table; the `moveTicketStage` line went in Task 6).
- Modify: `backend/tests/unit/controllers/ticketController.test.js` — replace the describe block `"ticketController.delete — carried forward, rewritten in Task 8"` (Task 7) with the five describes below.
- Create: `backend/tests/unit/routes/ticketRoutes.test.js`.

**Interfaces:**
- Consumes: `gateTicket(req, res, TicketId)` (Task 7); `assertRecordAccess(req, res, "ticket", id)` (Task 4 — row or `false`); `assertCanAssign(req, res, { toUserId, toBranchId })` → `true` | `false` after its own 403, messages entity-neutral since Task 4 (`"Only a manager can leave a record unassigned"` · `"Only a branch manager or above can move a record to another branch"` · `"You cannot assign records to that user"`; roster via `sp_FetchAssignableUsers { UserId, CompId, BranchId }`); `runSp`, `trimmed`, `positiveInt` (Task 6); `attachmentController.cascadeDelete(compId, "ticket", id)` (`src/controllers/attachmentController.js:266` — calls `sp_DeleteAttachmentsByEntity { CompId, Entity, EntityId }` and unlinks the files, never throws). SPs from the Contracts block: `sp_TransferTicket @CompId, @TicketId, @ToUserId = NULL, @ToBranchId = NULL, @ReasonId, @Remarks NVARCHAR(500), @UserId` · `sp_BulkTransferTickets @CompId, @TicketIdsJson, @ToUserId = NULL, @ToBranchId = NULL, @ReasonId, @Remarks, @UserId` · `sp_EscalateTicket @CompId, @TicketId, @ToUserId, @Remarks NVARCHAR(1000), @UserId` · `sp_FetchEscalationTargets @CompId, @UserId` (RS1 `Id, FullName, JobTitle, BranchId, BranchName, Depth`) · `sp_DeleteTicket @Id, @CompId`.
- Produces (web Tasks 14 + 16, mobile Tasks 19 + 22):
  - `POST /api/tickets/transferTicket` body `{ TicketId, ToUserId, ToBranchId, ReasonId, Remarks }` → `sp_TransferTicket { CompId, TicketId, ToUserId, ToBranchId, ReasonId, Remarks, UserId }` → status row. 400 `"A reason and remarks are required for a transfer"` before any DB call; 403 from the record gate; 403 from `assertCanAssign`; the SP's 400 (no-op, unknown reason) surfaced.
  - `POST /api/tickets/bulkTransferTickets` body `{ TicketIds: [], ToUserId, ToBranchId, ReasonId, Remarks }` → `sp_BulkTransferTickets { CompId, TicketIdsJson, ToUserId, ToBranchId, ReasonId, Remarks, UserId }` → `data: { Transferred, Skipped, ResponseCode, ResponseMess }`. 400 `"Pick between 1 and 200 tickets"`; one invisible id → 403 for the whole call, nothing written; the target is checked once.
  - `POST /api/tickets/escalateTicket` body `{ TicketId, ToUserId, Remarks }` → `sp_EscalateTicket { CompId, TicketId, ToUserId, Remarks, UserId }`. 400 `"ToUserId is required"` / `"TicketId is required"`; 403 record gate; the SP's 400s surfaced (`Only open complaints can be escalated`, `Escalation target must be a senior of the assignee`, remarks required).
  - `POST /api/tickets/fetchEscalationTargets` body `{ ForUserId }` (optional, default = caller) → `sp_FetchEscalationTargets { CompId, UserId: ForUserId }` → `data: { users: [...] }`.
  - `POST /api/tickets/deleteTicket` body `{ Id }` → 400 `"Id is required"`; record gate; `sp_DeleteTicket { Id, CompId }`; on 200 `cascadeDelete(CompId, "ticket", Id)` then the status row; a non-200 is surfaced and nothing is cascaded.
  - `ticketRoutes` path list, exact and in order: `/saveTicket, /fetchTickets, /fetchTicketDetail, /setTicketStatus, /resolveTicket, /closeTicket, /rejectTicket, /reopenTicket, /transferTicket, /bulkTransferTickets, /escalateTicket, /fetchEscalationTargets, /deleteTicket`. `fetchTickets` and `fetchEscalationTargets` take `allowEmptyPayload`; every other route `requirePayload`. `config/routes.js` already mounts `/api/tickets` — unchanged.

Decisions (spec silent): controller strings say **"tickets"** (the API's noun — `"Failed to save ticket"` already exists); the SPs say "complaint(s)" and are surfaced verbatim. `fetchEscalationTargets` takes `ForUserId` so the web's Escalate modal can list the **assignee's** chain (spec §2: the target must be an ancestor of the assignee, or of the caller when unassigned); it is org-chart data already open through the user directory, so no gate beyond auth. `ToUserId` on escalate is a shape check (the SP declares it without a default); remarks stay the SP's rule, as in Task 7. Spec §2 says delete "gains the missing `assertRecordAccess`" — the guard has been in place since `576f3e1` (`ticketController.js:195` today); this task keeps it, adds the `Id` shape check, and the regression test locks it in. The lead controller's `ponytail:` note on bulk visibility (N sequential detail reads, ≤ 200) carries over unchanged.

- [ ] **Step 1: Replace the carried-forward delete block in the controller test**

In `backend/tests/unit/controllers/ticketController.test.js` delete the block from `describe("ticketController.delete — carried forward, rewritten in Task 8", () => {` through its closing `});` and put this in its place (still before `describe("ticketController pipeline removal", …)`; `teamLeadReq`, `selfReq`, `strangersTicket`, `mockRoster`, `mockTicketLookup`, `visibleTicket`, `okRow` are already defined above it):

```js
// ---- Transfer / escalate / delete (spec 2 §2). The lead playbook: validation
// that needs no DB first, then the record gate, then the target gate, then
// the SP. The SP owns the domain rules (no-op, ancestor, non-terminal) and its
// 400 is surfaced as-is.

describe("ticketController.transfer", () => {
  const body = { TicketId: 1, ToUserId: 18, ReasonId: 36, Remarks: "Absent today" };

  it("gates on the ticket, then the target, then calls sp_TransferTicket with exactly its params", async () => {
    mockTicketLookup(visibleTicket); // sp_FetchTicketDetail
    mockRoster(18);                  // sp_FetchAssignableUsers
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Complaint transferred" }));
    const res = mockRes();
    await ticketController.transfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_TransferTicket", {
      CompId: 5, TicketId: 1, ToUserId: 18, ToBranchId: null, ReasonId: 36, Remarks: "Absent today", UserId: 7,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Complaint transferred");
  });

  it("forwards ToBranchId for a cross-branch move by a Branch manager, checking that branch's roster", async () => {
    mockTicketLookup(visibleTicket);
    mockRoster(21);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.transfer(baseReq({ body: { ...body, ToUserId: "21", ToBranchId: "4" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(2, "sp_FetchAssignableUsers", {
      UserId: 7, CompId: 5, BranchId: 4,
    });
    expect(database.executeStoredProcedure.mock.calls[2][1]).toMatchObject({ ToUserId: 21, ToBranchId: 4 });
  });

  // Spec §6: missing remarks → 400, before any round-trip.
  it("400s without remarks before touching the DB", async () => {
    const res = mockRes();
    await ticketController.transfer(baseReq({ body: { ...body, Remarks: "   " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("A reason and remarks are required for a transfer");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a reason before touching the DB", async () => {
    const res = mockRes();
    await ticketController.transfer(baseReq({ body: { ...body, ReasonId: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Spec §6: target outside the subtree → 403 (the roster is the gate; the
  // dropdown is a convenience).
  it("403s a target outside the caller's roster and never calls the SP", async () => {
    mockTicketLookup(visibleTicket);
    mockRoster(4); // not 18
    const res = mockRes();
    await ticketController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You cannot assign records to that user");
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_TransferTicket", expect.anything());
  });

  // Spec §6: cross-branch by Team scope → 403, decided before any roster call.
  it("403s a cross-branch move from a Team lead without a roster call", async () => {
    mockTicketLookup(visibleTicket);
    const res = mockRes();
    await ticketController.transfer(teamLeadReq({ ...body, ToUserId: 17, ToBranchId: 4 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("Only a branch manager or above can move a record to another branch");
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });

  // Spec §6: unassign by an executive → 403.
  it("403s an unassign from a Self agent", async () => {
    mockTicketLookup(visibleTicket);
    const res = mockRes();
    await ticketController.transfer(selfReq({ ...body, ToUserId: null }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("Only a manager can leave a record unassigned");
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("lets a Branch manager unassign, with no roster call", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await ticketController.transfer(baseReq({ body: { ...body, ToUserId: null } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual([
      "sp_TransferTicket",
      { CompId: 5, TicketId: 1, ToUserId: null, ToBranchId: null, ReasonId: 36, Remarks: "Absent today", UserId: 7 },
    ]);
  });

  it("403s transferring a ticket the caller cannot see, lookup only", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.transfer(selfReq(body), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("surfaces the SP's 400 on a no-op transfer", async () => {
    mockTicketLookup(visibleTicket);
    mockRoster(18);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Complaint is already assigned to that user in that branch" }],
    });
    const res = mockRes();
    await ticketController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "SP_ERROR" });
  });
});

describe("ticketController.bulkTransfer", () => {
  const body = { TicketIds: [1, 2, "2", "x"], ToUserId: 18, ReasonId: 37, Remarks: "Rebalancing the queue" };

  it("dedupes and cleans the ids, checks every ticket, the target once, then calls the bulk SP with JSON ids", async () => {
    mockTicketLookup(visibleTicket);
    mockTicketLookup({ ...visibleTicket, Id: 2 });
    mockRoster(18);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Transferred: 2, Skipped: 0, ResponseCode: 200, ResponseMess: "2 complaint(s) transferred" }],
    });
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_BulkTransferTickets", {
      CompId: 5, TicketIdsJson: "[1,2]", ToUserId: 18, ToBranchId: null, ReasonId: 37, Remarks: "Rebalancing the queue", UserId: 7,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(4); // 2 lookups + roster + SP
    expect(res.json.mock.calls[0][0].data).toMatchObject({ Transferred: 2, Skipped: 0 });
  });

  it("400s on an empty id list or a non-array, before touching the DB", async () => {
    const res1 = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, TicketIds: [] } }), res1);
    expect(res1.status).toHaveBeenCalledWith(400);
    expect(res1.json.mock.calls[0][0].message).toBe("Pick between 1 and 200 tickets");
    const res2 = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, TicketIds: "1,2" } }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s on more than 200 ids", async () => {
    const TicketIds = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, TicketIds } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a reason or remarks", async () => {
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body: { ...body, Remarks: "" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Spec §6: one invisible id fails the batch — before the roster, before the SP.
  it("403s the whole batch when any one ticket is out of scope, without reaching the roster or the SP", async () => {
    mockTicketLookup(visibleTicket);
    mockTicketLookup({ Id: 2, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_BulkTransferTickets", expect.anything());
  });

  it("403s when the target is not assignable, after the lookups", async () => {
    mockTicketLookup(visibleTicket);
    mockTicketLookup({ ...visibleTicket, Id: 2 });
    mockRoster(4);
    const res = mockRes();
    await ticketController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(3);
  });
});

describe("ticketController.escalate", () => {
  const body = { TicketId: 1, ToUserId: 16, Remarks: "Customer threatening to cancel" };

  it("gates on the ticket, then calls sp_EscalateTicket with exactly its params — no roster check, the SP validates the ancestor rule", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Escalated to Neha" }));
    const res = mockRes();
    await ticketController.escalate(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_EscalateTicket", {
      CompId: 5, TicketId: 1, ToUserId: 16, Remarks: "Customer threatening to cancel", UserId: 7,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Spec §6: a non-ancestor → 400 from the SP.
  it("surfaces the SP's 400 for a target who is not a senior of the assignee", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Escalation target must be a senior of the assignee" }],
    });
    const res = mockRes();
    await ticketController.escalate(baseReq({ body: { ...body, ToUserId: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Escalation target must be a senior of the assignee");
  });

  // Spec §6: on a closed ticket → 400 from the SP.
  it("surfaces the SP's 400 on a closed complaint", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Only open complaints can be escalated" }],
    });
    const res = mockRes();
    await ticketController.escalate(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Only open complaints can be escalated");
  });

  it("sends Remarks null when blank and surfaces the SP's 400 for it", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 400, ResponseMess: "Remarks are required to escalate" }],
    });
    const res = mockRes();
    await ticketController.escalate(baseReq({ body: { TicketId: 1, ToUserId: 16, Remarks: "  " } }), res);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ Remarks: null });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400s without a ToUserId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.escalate(baseReq({ body: { TicketId: 1, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("ToUserId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a TicketId before touching the DB", async () => {
    const res = mockRes();
    await ticketController.escalate(baseReq({ body: { ToUserId: 16, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("TicketId is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("403s a ticket the caller cannot see, lookup only", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.escalate(selfReq(body), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("ticketController.escalationTargets", () => {
  const chain = [
    { Id: 16, FullName: "Neha", JobTitle: "Team Lead", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 1 },
    { Id: 15, FullName: "Rahul", JobTitle: "Branch Manager", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 2 },
  ];

  it("defaults to the caller's own chain and maps RS1 to users", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [chain] });
    const res = mockRes();
    await ticketController.escalationTargets(baseReq(), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchEscalationTargets", { CompId: 5, UserId: 7 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.users).toEqual(chain);
  });

  // The SP's rule is "a senior of the ASSIGNEE"; the Escalate modal asks for
  // that user's chain, not the caller's.
  it("walks the chain of ForUserId when given", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [chain] });
    await ticketController.escalationTargets(baseReq({ body: { ForUserId: "18" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchEscalationTargets", { CompId: 5, UserId: 18 });
  });

  it("falls back to the caller for a junk ForUserId and to [] when the SP returns nothing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await ticketController.escalationTargets(baseReq({ body: { ForUserId: "abc" } }), res);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toEqual({ CompId: 5, UserId: 7 });
    expect(res.json.mock.calls[0][0].data.users).toEqual([]);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.escalationTargets(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ticketController.delete", () => {
  it("gates, calls sp_DeleteTicket with Id then CompId, then cascades the attachments", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ ResponseMess: "Complaint deleted" }));
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] }); // sp_DeleteAttachmentsByEntity
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: "1" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(2, "sp_DeleteTicket", { Id: 1, CompId: 5 });
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(3, "sp_DeleteAttachmentsByEntity", {
      CompId: 5, Entity: "ticket", EntityId: 1,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Complaint deleted");
  });

  // REGRESSION (spec §2 Delete): the guard is what stops any authenticated
  // user deleting any ticket in the company by id. Spec §6: delete by a
  // non-viewer → 403.
  it("403s deleting a ticket the caller cannot see, without running the SP", async () => {
    mockTicketLookup(strangersTicket);
    const res = mockRes();
    await ticketController.delete(selfReq({ Id: 1 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_DeleteTicket", expect.anything());
  });

  it("400s without an Id before touching the DB", async () => {
    const res = mockRes();
    await ticketController.delete(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Id is required");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("surfaces the SP's error and does not cascade attachments when it refuses", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, ResponseCode: 404, ResponseMess: "Complaint not found" }],
    });
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // lookup + delete, no cascade
  });

  it("falls back to ResponseMessage when ResponseMess is absent", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMessage: "Deleted via ResponseMessage" }],
    });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.json.mock.calls[0][0].message).toBe("Deleted via ResponseMessage");
  });

  it("handles a failing sp_DeleteTicket as 500", async () => {
    mockTicketLookup(visibleTicket);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await ticketController.delete(baseReq({ body: { Id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: Write the failing route test**

```js
// backend/tests/unit/routes/ticketRoutes.test.js
//
// The ticket route table after 086: the stage move is gone with the pipeline
// engine, status changes go through setTicketStatus (+ four shortcuts), and
// transfer / bulk transfer / escalate arrive from the lead playbook. The
// controller suite tests the handlers; this locks the table down — every
// route reachable, the retired one not, the exact list in order, and which
// routes tolerate an empty body.

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    req.user = { UserId: 7, CompId: 5, BranchId: 2 };
    next();
  },
}));

jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return {
    ...actual,
    loadScope: (req, res, next) => {
      req.scope = { isAdmin: false, hierarchyLevel: 3, dataScope: "Branch", branchIds: [2] };
      next();
    },
  };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/ticketController", () => ({
  save: hit("save"),
  fetch: hit("fetch"),
  detail: hit("detail"),
  setStatus: hit("setStatus"),
  resolve: hit("resolve"),
  close: hit("close"),
  reject: hit("reject"),
  reopen: hit("reopen"),
  transfer: hit("transfer"),
  bulkTransfer: hit("bulkTransfer"),
  escalate: hit("escalate"),
  escalationTargets: hit("escalationTargets"),
  delete: hit("delete"),
}));

const express = require("express");
const request = require("supertest");
const ticketRoutes = require("../../../src/routes/ticketRoutes");

const app = express();
app.use(express.json());
app.use("/api/tickets", ticketRoutes);

describe("ticketRoutes", () => {
  // The Contracts table, verbatim and in order. A route added or dropped
  // anywhere in this file has to come through here.
  it("exposes exactly the contracted routes, in order", () => {
    const paths = ticketRoutes.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(paths).toEqual([
      "/saveTicket",
      "/fetchTickets",
      "/fetchTicketDetail",
      "/setTicketStatus",
      "/resolveTicket",
      "/closeTicket",
      "/rejectTicket",
      "/reopenTicket",
      "/transferTicket",
      "/bulkTransferTickets",
      "/escalateTicket",
      "/fetchEscalationTargets",
      "/deleteTicket",
    ]);
  });

  it.each([
    ["/api/tickets/saveTicket", { CustomerId: 31, Subject: "x" }, "save"],
    ["/api/tickets/fetchTickets", { PageNumber: 1 }, "fetch"],
    ["/api/tickets/fetchTicketDetail", { TicketId: 1 }, "detail"],
    ["/api/tickets/setTicketStatus", { TicketId: 1, StatusId: 62 }, "setStatus"],
    ["/api/tickets/resolveTicket", { TicketId: 1, ResolutionId: 8, Remarks: "x" }, "resolve"],
    ["/api/tickets/closeTicket", { TicketId: 1 }, "close"],
    ["/api/tickets/rejectTicket", { TicketId: 1, Remarks: "x" }, "reject"],
    ["/api/tickets/reopenTicket", { TicketId: 1, Remarks: "x" }, "reopen"],
    ["/api/tickets/transferTicket", { TicketId: 1, ToUserId: 18, ReasonId: 36, Remarks: "x" }, "transfer"],
    ["/api/tickets/bulkTransferTickets", { TicketIds: [1], ToUserId: 18, ReasonId: 36, Remarks: "x" }, "bulkTransfer"],
    ["/api/tickets/escalateTicket", { TicketId: 1, ToUserId: 16, Remarks: "x" }, "escalate"],
    ["/api/tickets/fetchEscalationTargets", { ForUserId: 18 }, "escalationTargets"],
    ["/api/tickets/deleteTicket", { Id: 1 }, "delete"],
  ])("routes %s to the %s handler", async (path, body, handler) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  // 086 drops sp_MoveTicketStage with the pipeline engine.
  it("no longer exposes moveTicketStage", async () => {
    const r = await request(app).post("/api/tickets/moveTicketStage").send({ TicketId: 1, StageId: 3 });
    expect(r.status).toBe(404);
  });

  it("requires a payload on every route but the two reads that may ask for everything", async () => {
    for (const path of [
      "/api/tickets/saveTicket", "/api/tickets/fetchTicketDetail", "/api/tickets/setTicketStatus",
      "/api/tickets/resolveTicket", "/api/tickets/closeTicket", "/api/tickets/rejectTicket",
      "/api/tickets/reopenTicket", "/api/tickets/transferTicket", "/api/tickets/bulkTransferTickets",
      "/api/tickets/escalateTicket", "/api/tickets/deleteTicket",
    ]) {
      expect((await request(app).post(path).send({})).status).toBe(400);
    }
    // "Everything I can see" and "my own chain" are legitimate empty asks.
    expect((await request(app).post("/api/tickets/fetchTickets").send({})).status).toBe(200);
    expect((await request(app).post("/api/tickets/fetchEscalationTargets").send({})).status).toBe(200);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd backend && pnpm exec jest tests/unit/controllers/ticketController.test.js --maxWorkers=2 --silent`
Expected: FAIL — every `transfer`, `bulkTransfer`, `escalate`, `escalationTargets` test: `TypeError: ticketController.<name> is not a function`; in `delete`, "400s without an Id" receives 500 with one DB call (the old code hands `undefined` to the guard) and "gates, calls sp_DeleteTicket…" fails on `toHaveBeenNthCalledWith(2, "sp_DeleteTicket", { Id: 1, CompId: 5 })` — it received `Id: "1"` (the string from the body). The other delete tests pass already.
Run: `cd backend && pnpm exec jest tests/unit/routes/ticketRoutes.test.js --maxWorkers=2 --silent`
Expected: FAIL — "exposes exactly" receives the 7-entry list (`/saveTicket … /deleteTicket` without the six new routes); the six new `it.each` rows get 404; the payload test gets 404 for `fetchEscalationTargets`.

- [ ] **Step 4: Implement the controller methods**

In `backend/src/controllers/ticketController.js` insert after `gateTicket` (Task 7) and before `const ticketController = {`:

```js
// Shared by transfer and bulkTransfer: the SP requires a reason and remarks,
// and refusing here saves the lookup round-trips. Blank remarks become null.
const transferArgs = (body) => ({
  ToUserId: positiveInt(body.ToUserId),
  ToBranchId: positiveInt(body.ToBranchId),
  ReasonId: positiveInt(body.ReasonId),
  Remarks: trimmed(body.Remarks),
});
```

Replace the `delete` method (from `async delete(req, res) {` through its closing `},` — the last method before `};`) with:

```js
  // Spec 2 §2 Transfer — the lead playbook: validation that needs no DB first,
  // then the record gate, then the target gate, then the SP. Ownership only
  // ever moves through here (history row + notification live in the SP).
  async transfer(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    const args = transferArgs(req.body);
    if (!args.Remarks || !args.ReasonId) {
      return responseHelper.validationError(res, "A reason and remarks are required for a transfer");
    }
    if (!(await gateTicket(req, res, TicketId))) return;
    if (!(await assertCanAssign(req, res, { toUserId: args.ToUserId, toBranchId: args.ToBranchId }))) return;
    return runSp(res, "sp_TransferTicket", { CompId, TicketId, ...args, UserId }, "Failed to transfer ticket");
  },

  async bulkTransfer(req, res) {
    const { CompId, UserId } = req.user;
    const ids = Array.isArray(req.body.TicketIds)
      ? [...new Set(req.body.TicketIds.map(positiveInt).filter(Boolean))]
      : [];
    const args = transferArgs(req.body);
    if (ids.length === 0 || ids.length > 200) {
      return responseHelper.validationError(res, "Pick between 1 and 200 tickets");
    }
    if (!args.Remarks || !args.ReasonId) {
      return responseHelper.validationError(res, "A reason and remarks are required for a transfer");
    }
    // Every ticket must be visible to the caller; the SP is tenant-scoped only,
    // and one invisible id fails the whole call before anything is written.
    // ponytail: N sequential sp_FetchTicketDetail reads (5 recordsets each), ≤200 ids;
    // upgrade path = one sp_FetchTicketsVisibility(@TicketIdsJson) returning
    // Id/BranchId/AssignedTo/CreatedBy + canSeeRecord per row.
    for (const id of ids) {
      if (!(await assertRecordAccess(req, res, "ticket", id))) return;
    }
    if (!(await assertCanAssign(req, res, { toUserId: args.ToUserId, toBranchId: args.ToBranchId }))) return;
    return runSp(
      res,
      "sp_BulkTransferTickets",
      { CompId, TicketIdsJson: JSON.stringify(ids), ...args, UserId },
      "Failed to transfer tickets",
    );
  },

  // Spec 2 §2 Escalation: flag a senior; the ticket stays with the agent. The
  // caller must see the ticket; the SP validates the rest — target is an
  // ancestor of the assignee (ReportsTo, ≤ 20 hops), ticket non-terminal,
  // remarks given — and notifies the senior. No roster check: the target is
  // by definition above the caller's subtree, so assertCanAssign would refuse.
  async escalate(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    const ToUserId = positiveInt(req.body.ToUserId);
    // Shape checks before the round-trip; gateTicket answers for TicketId.
    if (TicketId && !ToUserId) return responseHelper.validationError(res, "ToUserId is required");
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_EscalateTicket",
      { CompId, TicketId, ToUserId, Remarks: trimmed(req.body.Remarks), UserId },
      "Failed to escalate ticket",
    );
  },

  // The ancestor chain the Escalate picker offers, nearest first. ForUserId
  // lets the client ask for the ASSIGNEE's chain — the SP's rule is "a senior
  // of the assignee" — and defaults to the caller's own.
  async escalationTargets(req, res) {
    const { CompId, UserId } = req.user;
    const ForUserId = positiveInt(req.body.ForUserId) ?? UserId;
    try {
      const result = await database.executeStoredProcedure("sp_FetchEscalationTargets", {
        CompId,
        UserId: ForUserId,
      });
      return responseHelper.success(res, "Escalation targets fetched successfully", {
        users: result.recordsets?.[0] ?? result.recordset ?? [],
      });
    } catch (err) {
      console.error("sp_FetchEscalationTargets error:", err);
      return responseHelper.error(res, "Failed to fetch escalation targets");
    }
  },

  async delete(req, res) {
    const { CompId } = req.user;
    const Id = positiveInt(req.body.Id);
    if (!Id) return responseHelper.validationError(res, "Id is required");
    // Spec 2 §2 Delete: the record gate. Without it any authenticated user
    // could delete any ticket in the company by id.
    if (!(await assertRecordAccess(req, res, "ticket", Id))) return;
    try {
      const result = await database.executeStoredProcedure("sp_DeleteTicket", { Id, CompId });
      const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
      const message = spResponse.ResponseMess || spResponse.ResponseMessage;
      if (spResponse.ResponseCode === 200) {
        // 086's sp_DeleteTicket removes the assignment, history and call rows;
        // the attachment rows and the files on disk are Node's to remove.
        await attachmentController.cascadeDelete(CompId, "ticket", Id);
        return responseHelper.success(res, message, spResponse);
      }
      return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
    } catch (err) {
      console.error("sp_DeleteTicket error:", err);
      return responseHelper.error(res, "Failed to delete ticket");
    }
  },
```

The method order in the file is now `save, fetch, detail, setStatus, resolve, close, reject, reopen, transfer, bulkTransfer, escalate, escalationTargets, delete` — the File-structure line of the plan, verbatim.

- [ ] **Step 5: Replace the router**

Write `backend/src/routes/ticketRoutes.js` in full:

```js
const express = require("express");
const ticketController = require("../controllers/ticketController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// loadScope populates req.scope: the fetch SPs filter on it, the write actions
// gate on it (assertRecordAccess / assertCanAssign / canReopen). No
// requireAdmin here — complaints are worked by agents; the record and target
// gates in the controller do the authorising.
router.use(verifyToken, loadScope);

router.post("/saveTicket", requirePayload, ticketController.save);
router.post("/fetchTickets", allowEmptyPayload, ticketController.fetch);
router.post("/fetchTicketDetail", requirePayload, ticketController.detail);
// Lifecycle (spec 2 §2): one engine and four shortcuts into it.
router.post("/setTicketStatus", requirePayload, ticketController.setStatus);
router.post("/resolveTicket", requirePayload, ticketController.resolve);
router.post("/closeTicket", requirePayload, ticketController.close);
router.post("/rejectTicket", requirePayload, ticketController.reject);
router.post("/reopenTicket", requirePayload, ticketController.reopen);
// Ownership and escalation.
router.post("/transferTicket", requirePayload, ticketController.transfer);
router.post("/bulkTransferTickets", requirePayload, ticketController.bulkTransfer);
router.post("/escalateTicket", requirePayload, ticketController.escalate);
// ForUserId is optional (defaults to the caller), so an empty body is legal.
router.post("/fetchEscalationTargets", allowEmptyPayload, ticketController.escalationTargets);
router.post("/deleteTicket", requirePayload, ticketController.delete);

module.exports = router;
```

- [ ] **Step 6: Run both to verify they pass, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/controllers/ticketController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/ticketController.js'`
Expected: 91 passed (Task 7's 60, minus the 2 carried-forward, plus 33); `ticketController.js` ≥ 80 % lines and branches — every early return, both `assertCanAssign` refusals, the cascade / no-cascade split and both `escalationTargets` fallbacks have a case above.
Run: `cd backend && pnpm exec jest tests/unit/routes/ticketRoutes.test.js --maxWorkers=2 --silent`
Expected: 16 passed (1 list + 13 routes + 1 retired + 1 payload).
Run: `cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent`
Expected: all passed — the new direct call `sp_FetchEscalationTargets` carries `CompId` in a multi-line param block (the contract's regex only sees multi-line blocks; `sp_DeleteTicket`'s inline `{ Id, CompId }` is unchanged from today).

- [ ] **Step 7: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 9: `configController`: pipelines out, `TatHours` in

**Files:**
- Modify: `backend/src/controllers/configController.js:3` (add the `controllerKit` import after `activityLogger`), `:5-6` (audit comment no longer names pipelines), `:79-111` (delete `savePipeline`, `fetchPipelines`, `saveStage`, `deleteStage`), `:113-127` (`saveLookup` forwards `TatHours`)
- Modify: `backend/src/routes/configRoutes.js` (whole file replaced — the four pipeline routes and the comment that describes them go)
- Modify: `backend/tests/unit/controllers/configController.test.js:107-186` (delete the four pipeline describes), `:188-212` (`saveLookup` describe replaced), append one describe
- Create: `backend/tests/unit/routes/configRoutes.test.js`

**Interfaces:**
- Consumes: `positiveInt` from `src/utils/controllerKit.js`; `runSp(res, spName, params, failMessage, req, log)` and `saveLog(req, entityType, label)` already in the file; `sp_SaveLookup @Id, @CompId, @Kind, @Value, @SortOrder = 0, @Code = NULL, @TatHours INT = NULL` and `sp_FetchLookups @CompId, @Kind` (+ `TatHours` column, which `fetchRows` passes through untouched) — Contracts block.
- Produces: `POST /api/config/saveLookup` body `{ Id, Kind, Value, SortOrder, Code, TatHours }` → `sp_SaveLookup { Id, CompId, Kind, Value, SortOrder, Code, TatHours }` with `TatHours` a positive int or `null`. `POST /api/config/fetchLookups` rows now carry `TatHours` (web Task 17 `LookupMaster` shows it for `Kind='priority'`; mobile Task 19 adds `Lookup.TatHours?: number | null`). **Removed:** `configController.savePipeline / fetchPipelines / saveStage / deleteStage` and the routes `/api/config/savePipeline | fetchPipelines | saveStage | deleteStage` (404). Remaining route list, in order: `/saveCustomField, /fetchCustomFields, /deleteCustomField, /saveLookup, /fetchLookups, /deleteLookup` — writes `requireAdmin + requirePayload`, reads `allowEmptyPayload`, unchanged.

Decisions (spec silent): `TatHours` `0` / `""` / junk → `null` — spec §1: "`DueAt` NULL when the priority has no TAT (never overdue)", so a zero-hour TAT cannot be stored and that is the intent. The client files that still call the removed endpoints (`web/src/api/supportQueries.js`, `web/src/api/salesQueries.js`, `web/src/hooks/useStageBoard.jsx`, `web/src/pages/Settings/Pipelines.jsx`, `mobile/src/api/configQueries.ts`, `mobile/src/features/support/useTicketRefData.ts`) are deleted or rewritten in web Tasks 11–12 and mobile Tasks 19–20; the backend deploys together with `086` (spec §7), so there is no window in which a live client calls a route whose SP has already gone that would not have broken anyway.

- [ ] **Step 1: Update the controller test**

In `backend/tests/unit/controllers/configController.test.js` delete everything from `describe("configController.savePipeline", () => {` (line 107) through the closing `});` of `describe("configController.deleteStage", …)` (line 186). Then replace the `describe("configController.saveLookup", …)` block (old lines 188–212) with:

```js
describe("configController.saveLookup", () => {
  const okRow = (extra = {}) => ({
    recordset: [{ Id: 11, ResponseCode: 200, ResponseMess: "Saved", ...extra }],
  });

  it("calls sp_SaveLookup with CompId, defaulting SortOrder, Code and TatHours (no CreatedBy — the SP doesn't declare it)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const req = baseReq({ body: { Id: 0, Kind: "industry", Value: "Retail" } });
    const res = mockRes();
    await configController.saveLookup(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveLookup", {
      Id: 0, CompId: 5, Kind: "industry", Value: "Retail", SortOrder: 0, Code: null, TatHours: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("sends exactly the SP's parameters, Code included, and drops unknown keys", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 3, ResponseMess: "Lookup created successfully" }));
    const req = baseReq({ body: { Id: 0, Kind: "lead_status", Value: "Warm", SortOrder: 3, Code: "open", Junk: 1 } });
    await configController.saveLookup(req, mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveLookup", {
      Id: 0, CompId: 5, Kind: "lead_status", Value: "Warm", SortOrder: 3, Code: "open", TatHours: null,
    });
  });

  // Spec 2 §1: TAT = hours per priority, stored on the lookup row. The web
  // sends it from a number field, so it may arrive as a string.
  it("forwards TatHours as an int for a priority", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 3 }));
    const req = baseReq({ body: { Id: "3", Kind: "priority", Value: "High", SortOrder: 3, TatHours: "24" } });
    await configController.saveLookup(req, mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveLookup", {
      Id: 3, CompId: 5, Kind: "priority", Value: "High", SortOrder: 3, Code: null, TatHours: 24,
    });
  });

  // No TAT = DueAt NULL = never overdue (spec §1). A zero-hour TAT is not a thing.
  it("nulls a 0 / blank / junk TatHours", async () => {
    database.executeStoredProcedure.mockResolvedValue(okRow());
    for (const TatHours of [0, "", "abc", -4]) {
      await configController.saveLookup(baseReq({ body: { Kind: "priority", Value: "Low", TatHours } }), mockRes());
    }
    for (const [, params] of database.executeStoredProcedure.mock.calls) expect(params.TatHours).toBeNull();
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(4);
  });

  // ticket_status rows carry a Code like lead_status (spec §1). The SP owns the
  // allowed set and answers 400 — surfaced with its message, not flattened.
  it("surfaces the SP's 400 for a ticket_status code outside the allowed set", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 0, ResponseCode: 400, ResponseMess: "Code must be one of open, onhold, resolved, closed, rejected" }],
    });
    const res = mockRes();
    await configController.saveLookup(baseReq({ body: { Kind: "ticket_status", Value: "Parked", Code: "paused" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: "SP_ERROR", message: expect.stringMatching(/open, onhold/) });
  });
});
```

Append at the end of the file:

```js
// 086 drops the pipeline engine: sp_SavePipeline / sp_FetchPipelines /
// sp_SaveStage / sp_DeleteStage and the two tables. The handlers go with them.
describe("configController pipeline removal", () => {
  it("no longer exposes the pipeline handlers", () => {
    for (const m of ["savePipeline", "fetchPipelines", "saveStage", "deleteStage"]) {
      expect(configController[m]).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Write the failing route test**

```js
// backend/tests/unit/routes/configRoutes.test.js
//
// The config route table after 086: the pipeline engine is gone and its four
// routes with it. Writes stay admin-only (they rewrite company-wide
// vocabularies), reads stay open (every form needs its lookups). The
// controller suite tests the handlers; this tests reachability, the gate, the
// exact list, and that the retired routes answer 404.

let mockScope;

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    req.user = { UserId: 7, CompId: 5, BranchId: 2 };
    next();
  },
}));

jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return {
    ...actual,
    loadScope: (req, res, next) => {
      req.scope = mockScope;
      next();
    },
  };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/configController", () => ({
  configController: {
    saveCustomField: hit("saveCustomField"),
    fetchCustomFields: hit("fetchCustomFields"),
    deleteCustomField: hit("deleteCustomField"),
    saveLookup: hit("saveLookup"),
    fetchLookups: hit("fetchLookups"),
    deleteLookup: hit("deleteLookup"),
  },
}));

const express = require("express");
const request = require("supertest");
const configRoutes = require("../../../src/routes/configRoutes");
const { configController } = require("../../../src/controllers/configController");

const app = express();
app.use(express.json());
app.use("/api/config", configRoutes);

const asAdmin = () => { mockScope = { isAdmin: true, hierarchyLevel: 1, dataScope: "All", branchIds: [2] }; };
const asAgent = () => { mockScope = { isAdmin: false, hierarchyLevel: 4, dataScope: "Self", branchIds: [2], ownerIds: [7] }; };

beforeEach(() => {
  jest.clearAllMocks();
  asAgent();
});

describe("configRoutes", () => {
  it("exposes exactly the remaining routes, in order", () => {
    const paths = configRoutes.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(paths).toEqual([
      "/saveCustomField",
      "/fetchCustomFields",
      "/deleteCustomField",
      "/saveLookup",
      "/fetchLookups",
      "/deleteLookup",
    ]);
  });

  it.each([
    ["/api/config/fetchCustomFields", { Entity: "ticket" }, "fetchCustomFields"],
    ["/api/config/fetchLookups", { Kind: "ticket_status" }, "fetchLookups"],
  ])("routes the read %s to %s for any authenticated user", async (path, body, handler) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  it.each([
    ["/api/config/saveCustomField", { Entity: "ticket", Label: "Serial no." }, "saveCustomField"],
    ["/api/config/deleteCustomField", { Id: 3 }, "deleteCustomField"],
    ["/api/config/saveLookup", { Kind: "priority", Value: "High", TatHours: 24 }, "saveLookup"],
    ["/api/config/deleteLookup", { Id: 11 }, "deleteLookup"],
  ])("403s a non-admin on the write %s, then lets an admin through to %s", async (path, body, handler) => {
    const denied = await request(app).post(path).send(body);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("INSUFFICIENT_ROLE");
    expect(configController[handler]).not.toHaveBeenCalled();
    asAdmin();
    const ok = await request(app).post(path).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.hit).toBe(handler);
  });

  // 086 drops the pipeline engine and its five SPs; a stale client gets a 404,
  // not a 500 from a procedure that no longer exists.
  it.each([
    "/api/config/savePipeline",
    "/api/config/fetchPipelines",
    "/api/config/saveStage",
    "/api/config/deleteStage",
  ])("no longer serves %s", async (path) => {
    asAdmin();
    const r = await request(app).post(path).send({ Entity: "ticket", Id: 1 });
    expect(r.status).toBe(404);
  });

  it("requires a payload on the writes but not on the reads", async () => {
    asAdmin();
    expect((await request(app).post("/api/config/saveLookup").send({})).status).toBe(400);
    expect((await request(app).post("/api/config/fetchLookups").send({})).status).toBe(200);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd backend && pnpm exec jest tests/unit/controllers/configController.test.js --maxWorkers=2 --silent`
Expected: FAIL — the three exact-object `saveLookup` tests: received params have no `TatHours` key; "nulls a 0 / blank / junk" fails on `expect(undefined).toBeNull()`; "no longer exposes the pipeline handlers" fails on `savePipeline` being a function. The rest pass.
Run: `cd backend && pnpm exec jest tests/unit/routes/configRoutes.test.js --maxWorkers=2 --silent`
Expected: FAIL at module load — `TypeError: Route.post() requires a callback function but got a [object Undefined]` (the router still wires `configController.savePipeline`, which the mock does not define). The whole file fails; that is the expected shape.

- [ ] **Step 4: Implement**

In `backend/src/controllers/configController.js`:

After line 3 (`const { logActivity, ACTIONS } = require("../utils/activityLogger");`) add:

```js
const { positiveInt } = require("../utils/controllerKit");
```

Replace the comment on lines 5–6 with:

```js
// Audit descriptors for config-engine mutations (who changed the custom
// fields / lookups, when). save = Created/Updated by Id; delete = Deleted.
```

Delete lines 79–111 — from `  savePipeline(req, res) {` through the closing `  },` of `deleteStage` (the block includes the two-line comment above `fetchPipelines`). `deleteCustomField` is then followed directly by the `saveLookup` comment.

Replace the `saveLookup` method and its comment (old lines 113–127) with:

```js
  // Explicit list, not `...req.body`: sp_SaveLookup declares exactly these, and
  // node-mssql sends every key it is given — a stray one is a hard error from
  // SQL Server, not an ignored extra. TatHours (spec 2 §1) is hours-per-priority
  // on Kind='priority'; 0 / blank / junk → NULL, which the SP reads as "no TAT,
  // never overdue". The Code rule for ticket_status lives in the SP.
  saveLookup(req, res) {
    const { CompId } = req.user;
    const { Id = 0, Kind, Value, SortOrder = 0, Code = null, TatHours = null } = req.body;
    return runSp(
      res,
      "sp_SaveLookup",
      {
        Id: Number(Id) || 0,
        CompId,
        Kind,
        Value,
        SortOrder: Number(SortOrder) || 0,
        Code: Code || null,
        TatHours: positiveInt(TatHours),
      },
      "Failed to save lookup",
      req,
      saveLog(req, "Lookup", "Lookup"),
    );
  },
```

Write `backend/src/routes/configRoutes.js` in full:

```js
const express = require("express");
const { configController } = require("../controllers/configController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

/**
 * Writes are admin-only; reads are not.
 *
 * These endpoints rewrite company-wide configuration — the custom fields every
 * form renders and the lookup vocabularies (statuses, priorities and their TAT,
 * channels, reasons). None of it was guarded once, so any authenticated
 * employee could do all of it.
 *
 * Admin is the right gate rather than a guess: in tblGroupAccess only Owner and
 * Admin hold any /settings/* grant, and both carry IsAdmin. This matches the
 * access model that already exists in the data; it does not invent a new one.
 *
 * The fetches stay open because every screen reads them — a complaint form
 * needs its statuses and channels, a lead form its sources.
 *
 * The pipeline routes (savePipeline / fetchPipelines / saveStage / deleteStage)
 * went with the pipeline engine in 086; tickets were its last user.
 */
router.post("/saveCustomField", requireAdmin, requirePayload, configController.saveCustomField);
router.post("/fetchCustomFields", allowEmptyPayload, configController.fetchCustomFields);
router.post("/deleteCustomField", requireAdmin, requirePayload, configController.deleteCustomField);
router.post("/saveLookup", requireAdmin, requirePayload, configController.saveLookup);
router.post("/fetchLookups", allowEmptyPayload, configController.fetchLookups);
router.post("/deleteLookup", requireAdmin, requirePayload, configController.deleteLookup);

module.exports = router;
```

- [ ] **Step 5: Run both to verify they pass, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/controllers/configController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/configController.js'`
Expected: 17 passed (18 before, minus 5 pipeline, minus the 2 old `saveLookup`, plus 5 new + 1 removal); `configController.js` ≥ 80 % lines and branches — the file lost its least-tested third and every remaining branch (`runSp` with and without a log, the `ResponseMessage` fallback, `fetchRows` with a missing recordset) has a case.
Run: `cd backend && pnpm exec jest tests/unit/routes/configRoutes.test.js --maxWorkers=2 --silent`
Expected: 12 passed (1 list + 2 reads + 4 gated writes + 4 retired + 1 payload).
Run: `cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent`
Expected: all passed — the multi-line `sp_FetchPipelines` call is gone (one fewer call counted; Task 8 added one, the `> 50` floor is untouched) and every remaining `configController` call carries `CompId`.

- [ ] **Step 6: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 10: Backend whole suite + live contract check after the owner applies `086`

**Files:**
- Modify: none — this task verifies Tasks 4–9 and reads the live database; it changes no source. Coverage output lands under `backend/coverage/` (build output, never committed).

**Interfaces:**
- Consumes: every controller/route/test from Tasks 4–9; `backend/sql/086_support_rebuild.sql` (Tasks 1–3) **applied by the owner**; `mcp__sqlserver-ecrm__read_query` (SELECT only — Global Constraints).
- Produces: the go/no-go for web Task 11 and mobile Task 19 (the SP contracts they code against are confirmed live), the coverage figures for the report, and the **real `ticket_status` / `ticket_channel` / `priority` ids of company 1**, recorded in the report for Task 26's live pass and the owner's smoke test. Tests never hardcode them.

This is the **only** task allowed a full backend run, and it runs it **once**, with coverage folded into that one run. A failing suite is re-run **alone** (`pnpm exec jest <file> --maxWorkers=2 --silent`), max 3 attempts, then BLOCKED — never a second full run.

- [ ] **Step 1: Whole suite, once, with coverage**

Run (timeout 300000):
`cd backend && pnpm exec jest --maxWorkers=2 --silent --coverage --coverageReporters=json-summary --coverageReporters=text-summary 2>&1 | tail -40`

Expected, in the tail:
```
=============================== Coverage summary ===============================
Statements   : NN.N% ( … )
Branches     : NN.N% ( … )
Functions    : NN.N% ( … )
Lines        : NN.N% ( … )
================================================================================

Test Suites: 45 passed, 45 total
Tests:       NNN passed, NNN total
Snapshots:   0 total
Time:        …
```
45 suites = the 41 present today + `customerController`, `customerRoutes` (Task 5), `ticketRoutes` (Task 8), `configRoutes` (Task 9). The words `failed` and `skipped` must not appear; every summary percentage must be ≥ 60 (below that Jest exits 1 and the last line reads `Jest: "global" coverage threshold for <metric> (60%) not met` — report that verbatim). `text-summary` prints only the global block, so the per-file table does not flood the terminal; the per-file numbers come from the JSON in Step 2. If a suite fails, copy its name from the `FAIL` line, run that one file alone, fix, and do **not** repeat this step — the single-file green run is the evidence.

- [ ] **Step 2: Per-file coverage for every src file Tasks 4–9 touched**

Run:
```bash
cd backend && node -e '
const s = require("./coverage/coverage-summary.json");
const files = [
  "src/middleware/permission.js",
  "src/controllers/customerController.js",
  "src/controllers/ticketController.js",
  "src/controllers/configController.js",
  "src/routes/customerRoutes.js",
  "src/routes/ticketRoutes.js",
  "src/routes/configRoutes.js",
];
for (const f of files) {
  const k = Object.keys(s).find((p) => p.endsWith("/" + f));
  const r = k && s[k];
  console.log(f.padEnd(44), r ? `lines ${r.lines.pct}%  branches ${r.branches.pct}%  functions ${r.functions.pct}%` : "NOT IN REPORT");
}
console.log("global".padEnd(44), `lines ${s.total.lines.pct}%  branches ${s.total.branches.pct}%`);
'
```
Expected: eight lines; every file ≥ 80 % lines **and** branches (the three route files have no branches and report 100); no `NOT IN REPORT` (that means the path is wrong or the file was never loaded — both are findings). Paste all eight lines into the report verbatim. A file under 80 % gets its missing case added to **its own** test file and that file re-run alone with `--coverage --collectCoverageFrom='<src file>'`; never lower a threshold, never re-run the whole suite.

- [ ] **Step 3: STOP — ask the owner to apply `086` before this step**

Everything below reads the live database and is meaningless against the pre-086 schema: today `sp_SaveTicket` still declares `@CustomerName / @Channel / @PipelineId / @StageId`, `sp_ResolveTicket` has four parameters, `sp_SetTicketStatus` / `sp_RejectTicket` / `sp_TransferTicket` / `sp_BulkTransferTickets` / `sp_EscalateTicket` / `sp_FetchEscalationTargets` and `tblCustomer` do not exist, and `sp_MoveTicketStage` + `tblPipeline` still do (all verified 2026-09-16). Every comparison would fail for the wrong reason.

Ask, verbatim: **"Has `backend/sql/086_support_rebuild.sql` been applied? Its section-9 verify block should have printed: customers ≈ 41, tickets without a customer = 0, NULL StatusId = 0, 19 procedures present, 5 absent."** Wait for a yes. Never apply it yourself (§0.2) and never touch the server (§0.6). If the answer is no, stop here and report Steps 1–2 with "Steps 4–5 pending `086`".

- [ ] **Step 4: Live contract check (read-only, `mcp__sqlserver-ecrm__read_query`)**

**(a) Parameter lists vs the controllers' param objects.** Run:
```sql
SELECT SPECIFIC_NAME AS SP, ORDINAL_POSITION AS Ord, PARAMETER_NAME AS Param, DATA_TYPE AS Type
FROM INFORMATION_SCHEMA.PARAMETERS
WHERE SPECIFIC_SCHEMA = 'dbo'
  AND SPECIFIC_NAME IN (
    'sp_SaveCustomer','sp_FetchCustomers','sp_FetchCustomerDetail','sp_DeleteCustomer',
    'sp_SaveTicket','sp_FetchTickets','sp_FetchTicketDetail','sp_DeleteTicket',
    'sp_SaveLookup','sp_FetchLookups',
    'sp_SetTicketStatus','sp_ResolveTicket','sp_CloseTicket','sp_RejectTicket','sp_ReopenTicket',
    'sp_TransferTicket','sp_BulkTransferTickets','sp_EscalateTicket','sp_FetchEscalationTargets')
ORDER BY SPECIFIC_NAME, ORDINAL_POSITION;
```
Expected: all 19 procedures present. For each, the key set the controller sends (table below) must be a **subset** of the `PARAMETER_NAME`s (without `@`) — an SP may declare a defaulted parameter Node does not send; Node may **never** send a key the SP does not declare (node-mssql → `Procedure or function … has too many arguments specified` → a 500 on every call). SQL Server does not expose T-SQL defaults in metadata (`sys.parameters.has_default_value` is populated for CLR objects only — every row reads `false` today), so defaults are not checked here; when one matters, read the SP source with `SELECT m.definition FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id WHERE o.name = 'sp_X'`. Types: every `*Id`, `Priority`, `SortOrder`, `TatHours`, `PageNumber`, `PageSize` → `int`; `Overdue`/`Escalated`/`Unassigned`/`AllowReopen`/`IsActive` → `bit`; `FromDate`/`ToDate` → `date`; the `*Json` params → `nvarchar`.

| SP | Sent by | Keys the controller sends |
|---|---|---|
| `sp_SaveCustomer` | `customerController.save` | Id, CompId, BranchId, UserId, Name, ContactPerson, Mobile, AltMobile, Email, Address, City, State, Pincode, Remarks |
| `sp_FetchCustomers` | `customerController.fetch` | CompId, PageNumber, PageSize, SearchTerm, BranchId, IsActive |
| `sp_FetchCustomerDetail` | `customerController.detail` | CompId, CustomerId, UserId, AccessibleBranchIdsJson, OwnerIdsJson |
| `sp_DeleteCustomer` | `customerController.delete` | Id, CompId |
| `sp_SaveTicket` | `ticketController.save` | Id, CompId, BranchId, UserId, CustomerId, Subject, ContactPerson, Contact, ChannelId, CategoryId, Priority, ProductId, AssignedTo, LinkedLeadId, Description, CustomJSON |
| `sp_FetchTickets` | `ticketController.fetch` | CompId, BranchId, PageNumber, PageSize, SearchTerm, StatusId, StatusCode, Priority, CategoryId, ChannelId, ProductId, CustomerId, AssignedTo, Overdue, Escalated, Unassigned, FromDate, ToDate, UserId, AccessibleBranchIdsJson, OwnerIdsJson |
| `sp_FetchTicketDetail` | `ticketController.detail`, `assertRecordAccess` | CompId, TicketId |
| `sp_SetTicketStatus` | `ticketController.setStatus` | CompId, TicketId, StatusId, UserId, ResolutionId, Remarks, AllowReopen |
| `sp_ResolveTicket` | `ticketController.resolve` | CompId, TicketId, ResolutionId, Remarks, UserId |
| `sp_CloseTicket` | `ticketController.close` | CompId, TicketId, UserId, ResolutionId, Remarks |
| `sp_RejectTicket` | `ticketController.reject` | CompId, TicketId, Remarks, UserId |
| `sp_ReopenTicket` | `ticketController.reopen` | CompId, TicketId, Remarks, UserId, AllowReopen |
| `sp_TransferTicket` | `ticketController.transfer` | CompId, TicketId, ToUserId, ToBranchId, ReasonId, Remarks, UserId |
| `sp_BulkTransferTickets` | `ticketController.bulkTransfer` | CompId, TicketIdsJson, ToUserId, ToBranchId, ReasonId, Remarks, UserId |
| `sp_EscalateTicket` | `ticketController.escalate` | CompId, TicketId, ToUserId, Remarks, UserId |
| `sp_FetchEscalationTargets` | `ticketController.escalationTargets` | CompId, UserId |
| `sp_DeleteTicket` | `ticketController.delete` | Id, CompId |
| `sp_SaveLookup` | `configController.saveLookup` | Id, CompId, Kind, Value, SortOrder, Code, TatHours |
| `sp_FetchLookups` | `configController.fetchLookups` | CompId, Kind |

Also the guards' SPs, unchanged by `086` but load-bearing: `sp_FetchAssignableUsers` (UserId, CompId, BranchId) and `sp_FetchAccessibleBranchIds` (UserId, CompId) — confirm both still exist with those three / two parameters (add them to the `IN` list if in doubt).

**(a2) Result-set order the controllers index positionally.** Metadata cannot count result sets, so read the two SP bodies and check the order of their top-level `SELECT`s by eye:
```sql
SELECT o.name, m.definition FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE o.name IN ('sp_FetchTicketDetail','sp_FetchCustomerDetail');
```
Expected: `sp_FetchTicketDetail` — five: ticket core (+ `CustomerName, CustomerMobile, CustomerContactPerson, CustomerEmail, CustomerCity, CustomerAddress, PreviousTickets`) → custom values → timeline → assignment history → linked lead. `ticketController.detail` maps `rs[3]` to `assignments` and `rs[4]` to `linkedLead`; a swap here is silent in Node and wrong on every screen. `sp_FetchCustomerDetail` — two: customer row → that customer's tickets with the scope predicate (`@UseBranchScope` / `@UseOwnerScope` / `@UserId` — the verbatim Global-Constraints predicate must appear).

**(b) The pipeline engine is gone.** Run:
```sql
SELECT name, type_desc FROM sys.objects
WHERE name IN ('sp_MoveTicketStage','sp_FetchPipelines','sp_SavePipeline','sp_SaveStage','sp_DeleteStage','tblPipeline','tblPipelineStage')
ORDER BY name;
```
Expected: **0 rows** (7 today). Then the ticket columns:
```sql
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'tblTicket'
  AND COLUMN_NAME IN ('PipelineId','StageId','CustomerName','Channel',
                      'CustomerId','Subject','StatusId','ProductId','ChannelId','DueAt','AssignedAt','EscalatedTo','EscalatedAt')
ORDER BY ORDINAL_POSITION;
```
Expected: exactly **9 rows** — `PipelineId`, `StageId`, `CustomerName`, `Channel` absent; `CustomerId` (int), `Subject` (nvarchar), `StatusId` (int) with `IS_NULLABLE = NO`; `ProductId`, `ChannelId` (int), `DueAt`, `AssignedAt`, `EscalatedAt` (datetime), `EscalatedTo` (int) with `YES`.

**(c) The seeded ids — record them.** Run:
```sql
SELECT Id, Kind, Value, Code, SortOrder, TatHours
FROM tblLookup
WHERE CompId = 1 AND Kind IN ('ticket_status','ticket_channel','priority')
ORDER BY Kind, SortOrder, Id;
```
Expected: `priority` 4 rows — `1 Low 168 · 2 Medium 72 · 3 High 24 · 4 Urgent 4` (Global Constraints; matched on `Value` case-insensitively, so the labels may be cased differently); `ticket_status` **6 rows** in `SortOrder`: `New open · In Progress open · On Hold onhold · Resolved resolved · Closed closed · Rejected rejected`; `ticket_channel` **6 rows**: `Phone · WhatsApp · Email · Web · Chat · Walk-in`, `Code` NULL. **Copy every `Id` into the report** as `ticket_status: New=<id> InProgress=<id> OnHold=<id> Resolved=<id> Closed=<id> Rejected=<id>` and `ticket_channel: Phone=<id> …` — Task 26 and the owner's smoke test use them; the web/mobile tests keep their own fixture ids. Then confirm every company got the seed:
```sql
SELECT CompId, Kind, COUNT(*) AS Rows_ FROM tblLookup
WHERE Kind IN ('ticket_status','ticket_channel') GROUP BY CompId, Kind ORDER BY CompId, Kind;
```
Expected: 6 + 6 for every `CompId` that has any row in `tblLookup` (company 1 today; more if the owner has added tenants).

**(d) No ticket without a customer or a status.** Run:
```sql
SELECT COUNT(*) AS Tickets,
       SUM(CASE WHEN CustomerId IS NULL THEN 1 ELSE 0 END) AS NullCustomer,
       SUM(CASE WHEN StatusId   IS NULL THEN 1 ELSE 0 END) AS NullStatus,
       SUM(CASE WHEN Subject IS NULL OR LTRIM(RTRIM(Subject)) = '' THEN 1 ELSE 0 END) AS BlankSubject,
       SUM(CASE WHEN DueAt IS NULL THEN 1 ELSE 0 END) AS NullDue,
       (SELECT COUNT(*) FROM tblCustomer WHERE CompId = 1) AS Customers,
       (SELECT COUNT(*) FROM tblTicketStatusHistory WHERE CompId = 1) AS HistoryRows
FROM tblTicket WHERE CompId = 1;
```
Expected: `NullCustomer = 0`, `NullStatus = 0`, `BlankSubject = 0` — the first two are structural once the `NOT NULL` constraints are on, so a non-zero means `086` stopped before section 4 and must be reported as BLOCKED. `Tickets` = 57 today (higher if any were raised since). `Customers` ≈ 39–41 (38 distinct `Contact` values + one per distinct `CustomerName` among the 3 NULL-contact tickets). `NullDue` = the number of tickets whose priority is NULL or carries no TAT (legal; report the figure). `HistoryRows ≥ Tickets` (one `NULL → New` seed row each, plus the resolved / closed / rejected rows).

Any mismatch in (a), (a2), (b) or (d) is **BLOCKED**, and the fix is the owner's SQL — a missing or misnamed SP parameter is corrected in `086` (Tasks 1–3), never by renaming or dropping the key in a controller: the Contracts block is the spec, the controller already matches it, and the tests prove that. Do not edit `086` yourself if it has already been applied; write the correction as `backend/sql/087_<short_name>.sql` per §0.2 and report it.

- [ ] **Step 5: Stop and report** — Leave nothing uncommitted from this task (it changes no source; any single-file fix from Step 1 or 2 is reported as a change under the task that owns the file). Report: the `Test Suites:` / `Tests:` lines from Step 1, the eight coverage lines from Step 2 verbatim, the outcome of (a)–(d) as "match" or the exact mismatch (SP · missing/extra parameter · type), the recorded `ticket_status` / `ticket_channel` / `priority` ids, the four counts from (d), and whether web Task 11 / mobile Task 19 may start (yes only when (a) and (a2) match). Anything ambiguous.

---

### Task 11: `supportQueries.js`, `ticketStatus.js`, MSW handlers

**Files:**
- Modify: `web/src/api/supportQueries.js` (whole file — 43 lines today)
- Create: `web/src/api/supportQueries.test.js`
- Create: `web/src/pages/Support/ticketStatus.js`
- Create: `web/src/pages/Support/ticketStatus.test.js`
- Create: `web/src/test/supportMocks.js` (MSW handlers + fixtures; `src/test/**` is excluded from coverage)

**Interfaces:**
- Consumes: `apiClient` (`web/src/utils/axiosConfig.js`), `SALES_ENDPOINTS.config` / `.calls` (`web/src/api/salesQueries.js`), `formatDate` (`web/src/utils/format.js`), `server` (`web/src/test/mocks/server.js`), `dayjs`.
- Produces (Tasks 13–17 import these by name):
  - `SUPPORT_ENDPOINTS.tickets.{saveTicket, fetchTickets, fetchTicketDetail, setTicketStatus, resolveTicket, closeTicket, rejectTicket, reopenTicket, transferTicket, bulkTransferTickets, escalateTicket, fetchEscalationTargets, deleteTicket}`, `SUPPORT_ENDPOINTS.customers.{saveCustomer, fetchCustomers, fetchCustomerDetail, deleteCustomer}`, `SUPPORT_ENDPOINTS.reports` (unchanged), `SUPPORT_ENDPOINTS.config` (=== `SALES_ENDPOINTS.config`), `SUPPORT_ENDPOINTS.calls`; one `post(endpoint)` fetcher per key with the same name. `moveTicketStage` is gone.
  - `ticketStatus.js`: `TICKET_PRESETS` (`mine · team · unassigned · overdue · escalated · onhold · closed · all`), `presetParams(preset, userId)`, `ticketsParamsToState(searchParams)` → `{ preset, filters: { StatusId, Priority, CategoryId, ChannelId, ProductId, AssignedTo, BranchId } ("" when absent), range: { from, to } ("" when absent) }`, `isActiveCode(code)`, `isTerminalCode(code)`, `statusTone(code)`, `dueLabel(dueAt, isOverdue, now = dayjs())`.
  - `supportMocks.js`: `json(data)`, `refuse(message, status)`, fixtures `LOOKUPS` (keyed by Kind: `ticket_status` ids 61–66 with codes, `priority` 1 Low/168h · 3 High/24h, `ticket_category` 5 General · 6 Billing, `ticket_channel` 71 Phone · 72 WhatsApp, `resolution` 8 Fixed · 9 Won't Fix, `transfer_reason` 36 Absent · 38 Wrong branch, `call_outcome` 50 Answered), `USERS` (17 Amit Singh · 18 Sara Khan, branch 1), `BRANCHES` (1 HEAD OFFICE · 2 SOUTH EXTENSION), `PRODUCTS` (1 Gold Chain 22K), `SENIORS` (16 Neha TL depth 1 · 15 Rahul BM depth 2), `ticketRow(over)`, `customerRow(over)`, `ticketDetail(over)`; handlers `mockSupportRefData()`, `mockTicketEndpoints(cap, { tickets, detail })`, `mockCustomerEndpoints(cap, { customers, detail })` — each stores the last posted body on `cap.list / cap.detail / cap.save / cap.status / cap.transfer / cap.bulk / cap.escalate / cap.delete`.

Decisions stated here (the spec is silent): the default preset when the URL names none is **`team`** (every active complaint in the caller's scope — the same rows as `mine` for a Self agent, everything for a manager; landing a Support Head on an empty "My queue" is worse). Boolean preset flags post as `1`, not `true` (the brief's contract). `dueLabel` shows a plain date for a past due date that is not overdue (a resolved/closed complaint), never "overdue".

- [ ] **Step 1: Write the failing tests**

```js
// web/src/api/supportQueries.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn(() => Promise.resolve({ data: { success: true } })) },
}));

import { apiClient } from "../utils/axiosConfig";
import * as supportQueries from "./supportQueries";
import { SUPPORT_ENDPOINTS } from "./supportQueries";
import { SALES_ENDPOINTS } from "./salesQueries";

describe("SUPPORT_ENDPOINTS", () => {
  it("exposes the spec-2 ticket + customer contract and nothing from the stage era", () => {
    expect(SUPPORT_ENDPOINTS.tickets).toEqual({
      saveTicket: "/api/tickets/saveTicket",
      fetchTickets: "/api/tickets/fetchTickets",
      fetchTicketDetail: "/api/tickets/fetchTicketDetail",
      setTicketStatus: "/api/tickets/setTicketStatus",
      resolveTicket: "/api/tickets/resolveTicket",
      closeTicket: "/api/tickets/closeTicket",
      rejectTicket: "/api/tickets/rejectTicket",
      reopenTicket: "/api/tickets/reopenTicket",
      transferTicket: "/api/tickets/transferTicket",
      bulkTransferTickets: "/api/tickets/bulkTransferTickets",
      escalateTicket: "/api/tickets/escalateTicket",
      fetchEscalationTargets: "/api/tickets/fetchEscalationTargets",
      deleteTicket: "/api/tickets/deleteTicket",
    });
    expect(SUPPORT_ENDPOINTS.customers).toEqual({
      saveCustomer: "/api/customers/saveCustomer",
      fetchCustomers: "/api/customers/fetchCustomers",
      fetchCustomerDetail: "/api/customers/fetchCustomerDetail",
      deleteCustomer: "/api/customers/deleteCustomer",
    });
    expect(SUPPORT_ENDPOINTS.reports).toEqual({
      ticketsByCategory: "/api/reports/ticketsByCategory",
      resolutionSummary: "/api/reports/resolutionSummary",
    });
    expect(SUPPORT_ENDPOINTS.tickets).not.toHaveProperty("moveTicketStage");
  });

  it("re-exports the shared config engine and call log", () => {
    expect(SUPPORT_ENDPOINTS.config).toBe(SALES_ENDPOINTS.config);
    expect(SUPPORT_ENDPOINTS.calls).toBe(SALES_ENDPOINTS.calls);
  });
});

// Every fetcher is the same `post(endpoint)` factory — one table proves them all.
const FETCHERS = {
  saveTicket: SUPPORT_ENDPOINTS.tickets.saveTicket,
  fetchTickets: SUPPORT_ENDPOINTS.tickets.fetchTickets,
  fetchTicketDetail: SUPPORT_ENDPOINTS.tickets.fetchTicketDetail,
  setTicketStatus: SUPPORT_ENDPOINTS.tickets.setTicketStatus,
  resolveTicket: SUPPORT_ENDPOINTS.tickets.resolveTicket,
  closeTicket: SUPPORT_ENDPOINTS.tickets.closeTicket,
  rejectTicket: SUPPORT_ENDPOINTS.tickets.rejectTicket,
  reopenTicket: SUPPORT_ENDPOINTS.tickets.reopenTicket,
  transferTicket: SUPPORT_ENDPOINTS.tickets.transferTicket,
  bulkTransferTickets: SUPPORT_ENDPOINTS.tickets.bulkTransferTickets,
  escalateTicket: SUPPORT_ENDPOINTS.tickets.escalateTicket,
  fetchEscalationTargets: SUPPORT_ENDPOINTS.tickets.fetchEscalationTargets,
  deleteTicket: SUPPORT_ENDPOINTS.tickets.deleteTicket,
  saveCustomer: SUPPORT_ENDPOINTS.customers.saveCustomer,
  fetchCustomers: SUPPORT_ENDPOINTS.customers.fetchCustomers,
  fetchCustomerDetail: SUPPORT_ENDPOINTS.customers.fetchCustomerDetail,
  deleteCustomer: SUPPORT_ENDPOINTS.customers.deleteCustomer,
  ticketsByCategory: SUPPORT_ENDPOINTS.reports.ticketsByCategory,
  resolutionSummary: SUPPORT_ENDPOINTS.reports.resolutionSummary,
};

describe("supportQueries", () => {
  beforeEach(() => apiClient.post.mockClear());

  it.each(Object.entries(FETCHERS))("%s posts to its endpoint with the given params", async (name, endpoint) => {
    const params = { foo: "bar" };
    await supportQueries[name](params);
    expect(apiClient.post).toHaveBeenCalledWith(endpoint, params);
  });

  it("defaults params to {} when called with no arguments", async () => {
    await supportQueries.fetchTickets();
    expect(apiClient.post).toHaveBeenCalledWith(SUPPORT_ENDPOINTS.tickets.fetchTickets, {});
  });

  it("no longer exports the stage-era fetcher", () => {
    expect(supportQueries.moveTicketStage).toBeUndefined();
  });
});
```

```js
// web/src/pages/Support/ticketStatus.test.js
import { describe, it, expect } from "vitest";
import dayjs from "dayjs";

import {
  TICKET_PRESETS, presetParams, ticketsParamsToState,
  isActiveCode, isTerminalCode, statusTone, dueLabel,
} from "./ticketStatus";

const p = (s) => new URLSearchParams(s);

describe("status codes", () => {
  it("open + onhold are active; resolved, closed, rejected are terminal", () => {
    expect(isActiveCode("open")).toBe(true);
    expect(isActiveCode("onhold")).toBe(true);
    expect(isActiveCode("resolved")).toBe(false);
    expect(isTerminalCode("resolved")).toBe(true);
    expect(isTerminalCode("closed")).toBe(true);
    expect(isTerminalCode("rejected")).toBe(true);
    expect(isTerminalCode("open")).toBe(false);
    expect(isActiveCode(undefined)).toBe(false);
    expect(isTerminalCode(null)).toBe(false);
  });

  it("tones every code and falls back to default", () => {
    expect(statusTone("open")).toBe("info");
    expect(statusTone("onhold")).toBe("warning");
    expect(statusTone("resolved")).toBe("success");
    expect(statusTone("closed")).toBe("default");
    expect(statusTone("rejected")).toBe("error");
    expect(statusTone("anything")).toBe("default");
    expect(statusTone(undefined)).toBe("default");
  });
});

describe("presets", () => {
  it("lists the eight presets in order", () => {
    expect(TICKET_PRESETS.map((x) => x.value)).toEqual(["mine", "team", "unassigned", "overdue", "escalated", "onhold", "closed", "all"]);
  });

  // spec §4: presets map to fetchTickets params; "active" = open + onhold.
  it("maps every preset onto fetchTickets params", () => {
    expect(presetParams("mine", 7)).toEqual({ AssignedTo: 7, StatusCode: "active" });
    expect(presetParams("team")).toEqual({ StatusCode: "active" });
    expect(presetParams("unassigned")).toEqual({ Unassigned: 1, StatusCode: "active" });
    expect(presetParams("overdue")).toEqual({ Overdue: 1 });
    expect(presetParams("escalated")).toEqual({ Escalated: 1 });
    expect(presetParams("onhold")).toEqual({ StatusCode: "onhold" });
    expect(presetParams("closed")).toEqual({ StatusCode: "closed" });
    expect(presetParams("all")).toEqual({});
    expect(presetParams("nonsense")).toEqual({});
  });
});

describe("ticketsParamsToState", () => {
  it("seeds every id filter and the date range from the URL", () => {
    expect(ticketsParamsToState(p("StatusId=62&Priority=3&CategoryId=6&ChannelId=71&ProductId=1&AssignedTo=17&BranchId=2&from=2026-09-01&to=2026-09-16"))).toEqual({
      preset: "team",
      filters: { StatusId: 62, Priority: 3, CategoryId: 6, ChannelId: 71, ProductId: 1, AssignedTo: 17, BranchId: 2 },
      range: { from: "2026-09-01", to: "2026-09-16" },
    });
  });

  it("maps preset flags onto the tabs, a named preset winning", () => {
    expect(ticketsParamsToState(p("Overdue=1")).preset).toBe("overdue");
    expect(ticketsParamsToState(p("Escalated=true")).preset).toBe("escalated");
    expect(ticketsParamsToState(p("Unassigned=1")).preset).toBe("unassigned");
    expect(ticketsParamsToState(p("StatusCode=onhold")).preset).toBe("onhold");
    expect(ticketsParamsToState(p("StatusCode=closed")).preset).toBe("closed");
    expect(ticketsParamsToState(p("preset=mine&Overdue=1")).preset).toBe("mine");
    expect(ticketsParamsToState(p("preset=all")).preset).toBe("all");
    expect(ticketsParamsToState(p("preset=bogus")).preset).toBe("team");
    expect(ticketsParamsToState(p("")).preset).toBe("team");
  });

  it("drops anything that is not a positive integer or an ISO day", () => {
    expect(ticketsParamsToState(p("StatusId=abc&AssignedTo=-3&from=01/09/2026&to=2026-09-16"))).toEqual({
      preset: "team",
      filters: { StatusId: "", Priority: "", CategoryId: "", ChannelId: "", ProductId: "", AssignedTo: "", BranchId: "" },
      range: { from: "", to: "2026-09-16" },
    });
  });
});

describe("dueLabel", () => {
  const now = dayjs("2026-09-16T10:00:00");

  it.each([
    ["2026-09-16T13:00:00", 0, "in 3h"],
    ["2026-09-16T10:20:00", 0, "in 20m"],
    ["2026-09-18T09:00:00", 0, "in 47h"],
    ["2026-09-18T10:00:00", 0, "in 2d"],
    ["2026-09-14T10:00:00", 1, "2d overdue"],
    ["2026-09-16T07:00:00", true, "3h overdue"],
    ["2026-09-16T09:45:00", 1, "15m overdue"],
  ])("%s (overdue=%s) reads %s", (dueAt, isOverdue, out) => {
    expect(dueLabel(dueAt, isOverdue, now)).toBe(out);
  });

  it("shows the date for a past due date that is not overdue (a closed complaint)", () => {
    expect(dueLabel("2026-09-14T10:00:00", 0, now)).toBe("14-09-2026");
  });

  it("renders an em dash with no due date", () => {
    expect(dueLabel(null, 0, now)).toBe("—");
    expect(dueLabel(undefined, 1, now)).toBe("—");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm exec vitest run src/api/supportQueries.test.js`
Expected: FAIL — `SUPPORT_ENDPOINTS.tickets` still has `moveTicketStage` and lacks `setTicketStatus`; `supportQueries.saveCustomer is not a function`.
Run: `cd web && pnpm exec vitest run src/pages/Support/ticketStatus.test.js`
Expected: FAIL — `Failed to resolve import "./ticketStatus"`.

- [ ] **Step 3: Implement**

Replace the whole of `web/src/api/supportQueries.js`:

```js
// src/api/supportQueries.js
// Endpoint constants + thin POST fetchers for the Support / complaints module
// (spec 2, 2026-09-16). Tickets are a flat status list now — the pipeline
// engine is gone. Lookups + custom fields still come from the shared config
// engine (Kind/Entity='ticket'); calls from the sales call log.
import { apiClient } from "../utils/axiosConfig";
import { SALES_ENDPOINTS } from "./salesQueries";

export const SUPPORT_ENDPOINTS = {
  tickets: {
    saveTicket: "/api/tickets/saveTicket",
    fetchTickets: "/api/tickets/fetchTickets",
    fetchTicketDetail: "/api/tickets/fetchTicketDetail",
    setTicketStatus: "/api/tickets/setTicketStatus",
    resolveTicket: "/api/tickets/resolveTicket",
    closeTicket: "/api/tickets/closeTicket",
    rejectTicket: "/api/tickets/rejectTicket",
    reopenTicket: "/api/tickets/reopenTicket",
    transferTicket: "/api/tickets/transferTicket",
    bulkTransferTickets: "/api/tickets/bulkTransferTickets",
    escalateTicket: "/api/tickets/escalateTicket",
    fetchEscalationTargets: "/api/tickets/fetchEscalationTargets",
    deleteTicket: "/api/tickets/deleteTicket",
  },
  customers: {
    saveCustomer: "/api/customers/saveCustomer",
    fetchCustomers: "/api/customers/fetchCustomers",
    fetchCustomerDetail: "/api/customers/fetchCustomerDetail",
    deleteCustomer: "/api/customers/deleteCustomer",
  },
  reports: {
    ticketsByCategory: "/api/reports/ticketsByCategory",
    resolutionSummary: "/api/reports/resolutionSummary",
  },
  // Shared engine (same SPs as sales) — lookups + custom fields, Kind/Entity='ticket'.
  config: SALES_ENDPOINTS.config,
  calls: SALES_ENDPOINTS.calls,
};

const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

// Tickets
export const saveTicket = post(SUPPORT_ENDPOINTS.tickets.saveTicket);
export const fetchTickets = post(SUPPORT_ENDPOINTS.tickets.fetchTickets);
export const fetchTicketDetail = post(SUPPORT_ENDPOINTS.tickets.fetchTicketDetail);
export const setTicketStatus = post(SUPPORT_ENDPOINTS.tickets.setTicketStatus);
export const resolveTicket = post(SUPPORT_ENDPOINTS.tickets.resolveTicket);
export const closeTicket = post(SUPPORT_ENDPOINTS.tickets.closeTicket);
export const rejectTicket = post(SUPPORT_ENDPOINTS.tickets.rejectTicket);
export const reopenTicket = post(SUPPORT_ENDPOINTS.tickets.reopenTicket);
export const transferTicket = post(SUPPORT_ENDPOINTS.tickets.transferTicket);
export const bulkTransferTickets = post(SUPPORT_ENDPOINTS.tickets.bulkTransferTickets);
export const escalateTicket = post(SUPPORT_ENDPOINTS.tickets.escalateTicket);
export const fetchEscalationTargets = post(SUPPORT_ENDPOINTS.tickets.fetchEscalationTargets);
export const deleteTicket = post(SUPPORT_ENDPOINTS.tickets.deleteTicket);

// Customers
export const saveCustomer = post(SUPPORT_ENDPOINTS.customers.saveCustomer);
export const fetchCustomers = post(SUPPORT_ENDPOINTS.customers.fetchCustomers);
export const fetchCustomerDetail = post(SUPPORT_ENDPOINTS.customers.fetchCustomerDetail);
export const deleteCustomer = post(SUPPORT_ENDPOINTS.customers.deleteCustomer);

// Reports
export const ticketsByCategory = post(SUPPORT_ENDPOINTS.reports.ticketsByCategory);
export const resolutionSummary = post(SUPPORT_ENDPOINTS.reports.resolutionSummary);
```

Create `web/src/pages/Support/ticketStatus.js`:

```js
// src/pages/Support/ticketStatus.js
//
// The lookup's Code is the machine meaning behind an editable label (spec 2
// §1): open | onhold = active, resolved | closed | rejected = terminal. Nothing
// in the UI matches on a status *name* — companies rename them.
import dayjs from "dayjs";

import { formatDate } from "../../utils/format";

export const isActiveCode = (code) => code === "open" || code === "onhold";
export const isTerminalCode = (code) => code === "resolved" || code === "closed" || code === "rejected";

export const TICKET_PRESETS = [
  { value: "mine", label: "My queue" },
  { value: "team", label: "My team" },
  { value: "unassigned", label: "Unassigned" },
  { value: "overdue", label: "Overdue" },
  { value: "escalated", label: "Escalated" },
  { value: "onhold", label: "On hold" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/** Preset -> fetchTickets params. `active` = open + onhold (sp_FetchTickets @StatusCode). */
export const presetParams = (preset, userId) => {
  switch (preset) {
    case "mine": return { AssignedTo: userId, StatusCode: "active" };
    case "team": return { StatusCode: "active" };
    case "unassigned": return { Unassigned: 1, StatusCode: "active" };
    case "overdue": return { Overdue: 1 };
    case "escalated": return { Escalated: 1 };
    case "onhold": return { StatusCode: "onhold" };
    case "closed": return { StatusCode: "closed" };
    default: return {};
  }
};

const TONES = { open: "info", onhold: "warning", resolved: "success", closed: "default", rejected: "error" };
/** Chip tone for a status code — the same colour language on the list, the detail and the customer page. */
export const statusTone = (code) => TONES[code] ?? "default";

// "20m" under an hour, "47h" under two days, "2d" after that.
const span = (mins) =>
  mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;

/**
 * Relative due label. `isOverdue` is the server's word (IsOverdue = active AND
 * DueAt < now); a past due date that is NOT overdue belongs to a resolved /
 * closed complaint and reads as a plain date.
 */
export function dueLabel(dueAt, isOverdue, now = dayjs()) {
  if (!dueAt) return "—";
  const mins = dayjs(dueAt).diff(now, "minute");
  if (isOverdue) return `${span(Math.abs(mins))} overdue`;
  if (mins >= 0) return `in ${span(mins)}`;
  return formatDate(dueAt);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const idParam = (v) => (v && /^\d+$/.test(v) ? Number(v) : "");
const isOn = (v) => v === "1" || v === "true";
const FILTER_KEYS = ["StatusId", "Priority", "CategoryId", "ChannelId", "ProductId", "AssignedTo", "BranchId"];

/**
 * Tickets-list state from URL search params, mirroring leadsParamsToState:
 * a named `preset` wins, else the flag params pick a tab, else "team". "" is
 * the filters' own empty value so the Comboboxes stay controlled.
 */
export function ticketsParamsToState(params) {
  const get = (k) => params.get(k) ?? "";
  const named = get("preset");
  const preset = TICKET_PRESETS.some((x) => x.value === named) ? named
    : isOn(get("Overdue")) ? "overdue"
      : isOn(get("Escalated")) ? "escalated"
        : isOn(get("Unassigned")) ? "unassigned"
          : get("StatusCode") === "onhold" ? "onhold"
            : get("StatusCode") === "closed" ? "closed"
              : "team";
  return {
    preset,
    filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, idParam(get(k))])),
    range: { from: ISO_DAY.test(get("from")) ? get("from") : "", to: ISO_DAY.test(get("to")) ? get("to") : "" },
  };
}
```

Create `web/src/test/supportMocks.js`:

```js
// MSW handlers + fixtures for the Support / complaints screens (spec 2). One
// place for the pick-lists every ticket screen loads on mount, the ticket and
// customer endpoints, and a row factory per entity. `cap.<name>` receives the
// last posted body so a test can assert what the page asked for.
import { http, HttpResponse } from "msw";

import { server } from "./mocks/server";

export const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
export const refuse = (message, status = 400) =>
  HttpResponse.json({ success: false, message, responseCode: status }, { status });

const page = (rows) => ({ currentPage: 1, pageSize: 25, totalRecords: rows.length, totalPages: 1 });

// Ids are fixtures, not live ids — 086 creates the real ticket_status rows.
export const LOOKUPS = {
  ticket_status: [
    { Id: 61, Kind: "ticket_status", Value: "New", Code: "open", SortOrder: 1 },
    { Id: 62, Kind: "ticket_status", Value: "In Progress", Code: "open", SortOrder: 2 },
    { Id: 63, Kind: "ticket_status", Value: "On Hold", Code: "onhold", SortOrder: 3 },
    { Id: 64, Kind: "ticket_status", Value: "Resolved", Code: "resolved", SortOrder: 4 },
    { Id: 65, Kind: "ticket_status", Value: "Closed", Code: "closed", SortOrder: 5 },
    { Id: 66, Kind: "ticket_status", Value: "Rejected", Code: "rejected", SortOrder: 6 },
  ],
  priority: [
    { Id: 1, Kind: "priority", Value: "Low", SortOrder: 1, TatHours: 168 },
    { Id: 3, Kind: "priority", Value: "High", SortOrder: 3, TatHours: 24 },
  ],
  ticket_category: [{ Id: 5, Value: "General" }, { Id: 6, Value: "Billing" }],
  ticket_channel: [{ Id: 71, Value: "Phone" }, { Id: 72, Value: "WhatsApp" }],
  resolution: [{ Id: 8, Value: "Fixed" }, { Id: 9, Value: "Won't Fix" }],
  transfer_reason: [{ Id: 36, Value: "Absent" }, { Id: 38, Value: "Wrong branch" }],
  call_outcome: [{ Id: 50, Value: "Answered" }],
};
export const USERS = [
  { Id: 17, Username: "se_ho_amit", FullName: "Amit Singh", BranchId: 1, BranchName: "HEAD OFFICE" },
  { Id: 18, Username: "se_ho_sara", FullName: "Sara Khan", BranchId: 1, BranchName: "HEAD OFFICE" },
];
export const BRANCHES = [{ Id: 1, BranchName: "HEAD OFFICE" }, { Id: 2, BranchName: "SOUTH EXTENSION" }];
export const PRODUCTS = [{ Id: 1, Name: "Gold Chain 22K" }];
export const SENIORS = [
  { Id: 16, FullName: "Neha Verma", JobTitle: "Team Lead", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 1 },
  { Id: 15, FullName: "Rahul Mehta", JobTitle: "Branch Manager", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 2 },
];

export const ticketRow = (over = {}) => ({
  Id: 7, CompId: 1, BranchId: 1, BranchName: "HEAD OFFICE", TicketNo: "TKT-0007", Subject: "Screen flickers on boot",
  CustomerId: 3, CustomerName: "Acme Corp", CustomerMobile: "9990001111", ContactPerson: "Gurpreet", Contact: "9990001111",
  ChannelId: 71, ChannelName: "Phone", CategoryId: 6, CategoryName: "Billing", Priority: 3, PriorityName: "High",
  ProductId: null, ProductName: null, StatusId: 62, StatusName: "In Progress", StatusCode: "open",
  AssignedTo: 17, AssigneeName: "Amit Singh", AssigneeAvatar: null, AssignedAt: "2026-09-15T10:00:00Z",
  DueAt: "2026-09-16T10:00:00Z", IsOverdue: 0, AgeHours: 5, EscalatedTo: null, EscalatedToName: null, EscalatedAt: null,
  LinkedLeadId: null, ResolvedAt: null, ClosedAt: null, ResolutionId: null, ResolutionName: null,
  Description: "Flickers for a minute after power-on.", CreatedBy: 17, CreatedAt: "2026-09-15T10:00:00Z", UpdatedAt: null,
  ...over,
});

export const customerRow = (over = {}) => ({
  Id: 3, CompId: 1, BranchId: 1, BranchName: "HEAD OFFICE", Name: "Acme Corp", ContactPerson: "Gurpreet",
  Mobile: "9990001111", AltMobile: null, Email: "acme@example.com", Address: "12 MG Road", City: "Pune", State: "MH",
  Pincode: "411001", Remarks: null, IsActive: 1, OpenTickets: 1, TotalTickets: 3, LastTicketAt: "2026-09-15T10:00:00Z",
  CreatedAt: "2026-08-01T10:00:00Z", UpdatedAt: null,
  ...over,
});

export const ticketDetail = (over = {}) => ({
  ticket: ticketRow({
    EditBy: null, CustomerContactPerson: "Gurpreet", CustomerEmail: "acme@example.com",
    CustomerCity: "Pune", CustomerAddress: "12 MG Road", PreviousTickets: 2,
  }),
  fields: [],
  activity: [
    { Id: 1, TicketId: 7, UserId: 17, UserName: "Amit Singh", UserAvatar: null, Type: "created", Summary: "Complaint created", MetaJSON: null, CreatedAt: "2026-09-15T10:00:00Z" },
    { Id: 2, TicketId: 7, UserId: 17, UserName: "Amit Singh", UserAvatar: null, Type: "status", Summary: "Status: New → In Progress", MetaJSON: null, CreatedAt: "2026-09-15T11:00:00Z" },
  ],
  assignments: [
    { Id: 31, FromUserId: null, FromUserName: null, ToUserId: 17, ToUserName: "Amit Singh", FromBranchId: 1, FromBranchName: "HEAD OFFICE", ToBranchId: 1, ToBranchName: "HEAD OFFICE", ReasonId: null, Reason: null, Remarks: "Assigned on creation", AssignedBy: 17, AssignedByName: "Amit Singh", AssignedAt: "2026-09-15T10:00:00Z" },
  ],
  linkedLead: null,
  ...over,
});

/** The pick-lists every ticket screen loads on mount, keyed by Kind. */
export function mockSupportRefData() {
  server.use(
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const { Kind } = await request.json();
      return json({ lookups: LOOKUPS[Kind] ?? [] });
    }),
    http.post("*/api/config/fetchCustomFields", () => json({ customFields: [] })),
    http.post("*/api/users/fetchUsers", () => json({ users: USERS, pagination: page(USERS) })),
    http.post("*/api/users/fetchAssignableUsers", async ({ request }) => {
      const body = await request.json().catch(() => ({}));
      return json({ users: body?.BranchId === 2 ? [{ Id: 20, FullName: "Vikram Rao", BranchId: 2, BranchName: "SOUTH EXTENSION" }] : USERS });
    }),
    http.post("*/api/users/fetchBranches", () => json({ branches: BRANCHES })),
    http.post("*/api/products/fetchProducts", () => json({ products: PRODUCTS, pagination: page(PRODUCTS) })),
    http.post("*/api/tickets/fetchEscalationTargets", () => json({ users: SENIORS })),
    http.post("*/api/calls/fetchCalls", () => json({ calls: [] })),
  );
}

export function mockTicketEndpoints(cap = {}, { tickets = [ticketRow()], detail = ticketDetail() } = {}) {
  const status = (name) => async ({ request }) => {
    cap[name] = await request.json();
    return json({ Id: cap[name].TicketId ?? cap[name].Id ?? 7, ResponseCode: 200, ResponseMess: "ok" });
  };
  server.use(
    http.post("*/api/tickets/fetchTickets", async ({ request }) => {
      cap.list = await request.json();
      return json({ tickets, pagination: page(tickets) });
    }),
    http.post("*/api/tickets/fetchTicketDetail", async ({ request }) => {
      cap.detail = await request.json();
      return json(typeof detail === "function" ? detail(cap.detail) : detail);
    }),
    http.post("*/api/tickets/saveTicket", async ({ request }) => {
      cap.save = await request.json();
      return json({ Id: cap.save.Id || 909, TicketNo: cap.save.Id ? "TKT-0007" : "TKT-0909", ResponseCode: 200, ResponseMess: "Saved" });
    }),
    http.post("*/api/tickets/setTicketStatus", status("status")),
    http.post("*/api/tickets/transferTicket", status("transfer")),
    http.post("*/api/tickets/bulkTransferTickets", async ({ request }) => {
      cap.bulk = await request.json();
      return json({ Transferred: cap.bulk.TicketIds?.length ?? 0, Skipped: 0, ResponseCode: 200, ResponseMess: "ok" });
    }),
    http.post("*/api/tickets/escalateTicket", status("escalate")),
    http.post("*/api/tickets/deleteTicket", status("delete")),
  );
  return cap;
}

export function mockCustomerEndpoints(cap = {}, { customers = [customerRow()], detail = null } = {}) {
  server.use(
    http.post("*/api/customers/fetchCustomers", async ({ request }) => {
      cap.list = await request.json();
      const term = String(cap.list?.SearchTerm ?? "").toLowerCase();
      const rows = term
        ? customers.filter((c) => [c.Name, c.ContactPerson, c.Mobile, c.Email, c.City].some((v) => String(v ?? "").toLowerCase().includes(term)))
        : customers;
      return json({ customers: rows, pagination: page(rows) });
    }),
    http.post("*/api/customers/saveCustomer", async ({ request }) => {
      cap.save = await request.json();
      return json({ Id: cap.save.Id || 44, ResponseCode: 200, ResponseMess: "Saved" });
    }),
    http.post("*/api/customers/fetchCustomerDetail", async ({ request }) => {
      cap.detail = await request.json();
      return json(detail ?? { customer: customers[0], tickets: [] });
    }),
    http.post("*/api/customers/deleteCustomer", async ({ request }) => {
      cap.delete = await request.json();
      return json({ Id: cap.delete.Id, ResponseCode: 200, ResponseMess: "Deleted" });
    }),
  );
  return cap;
}
```

- [ ] **Step 4: Run to verify they pass, with coverage**

Run: `cd web && pnpm exec vitest run src/api/supportQueries.test.js --coverage --coverage.include=src/api/supportQueries.js`
Expected: 24 passed; `supportQueries.js` 100 %.
Run: `cd web && pnpm exec vitest run src/pages/Support/ticketStatus.test.js --coverage --coverage.include=src/pages/Support/ticketStatus.js`
Expected: 14 passed; `ticketStatus.js` ≥ 95 % lines / branches.

- [ ] **Step 5: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 12: Board + pipelines deletion, routes/redirects, menu icon, help guide

**Files:**
- Delete: `web/src/pages/Support/TicketBoard.jsx`, `TicketBoard.test.jsx`, `TicketCard.jsx`, `TicketCard.test.jsx`, `TicketColumn.jsx`, `TicketColumn.test.jsx`, `web/src/hooks/useStageBoard.jsx`, `web/src/components/ui/BoardColumn.jsx`, `web/src/pages/Settings/Pipelines.jsx`, `Pipelines.test.jsx`
- Modify: `web/src/App.jsx:37` (`PipelineSettings` import), `:52` (`TicketBoard` import), `:72` (`/support` redirect), `:91` (`/settings/pipelines` route), `:108` (`/support/board` route)
- Modify: `web/src/App.routes.test.jsx:36-59` (section-redirect rows + child-route list), append a describe
- Modify: `web/src/components/ui/index.js:12` (drop the `BoardColumn` export)
- Modify: `web/src/utils/menuBuilder.js:1-36` (import), `:44-84` (keyword map), `:126-128` (comment)
- Modify: `web/src/utils/menuBuilder.test.js:1-36` (import), `:40-82` (table), `:145-158` (route test)
- Modify: `web/src/api/salesQueries.js:9-20` (config block), `:65-76` (config fetchers)
- Modify: `web/src/api/salesQueries.test.js:51-55`, `:60-98`, `:119-126`
- Modify: `web/src/data/helpGuides.js:139-166` (the `tickets` guide)
- Modify: `web/src/components/TopNav.jsx:143-159` (notification routing)
- Modify: `web/src/components/TopNav.test.jsx:196-232` (append one case)

**Interfaces:**
- Consumes: `SectionRedirect` (`web/src/components/SectionRedirect.jsx`), `Navigate` (react-router-dom), `PeopleOutlined` (`@mui/icons-material`).
- Produces: routes `/support` → `SectionRedirect` falling back to `/support/tickets`; `/support/board` → `<Navigate to="/support/tickets" replace />`; `/settings/pipelines` gone (404 catch-all); `/support/customers` is added in **Task 13** (its page does not exist yet — a `lazy(() => import(...))` of a missing file fails Vite's import analysis, so the route waits for the file). `getMenuIcon("Customers") === PeopleOutlined`. `SALES_ENDPOINTS.config` = `{ saveCustomField, fetchCustomFields, deleteCustomField, saveLookup, fetchLookups, deleteLookup }` — so `SUPPORT_ENDPOINTS.config` (Task 11) is now lookups + custom fields only. A `ticket` notification opens `/support/tickets/:id`. `HELP_GUIDES.tickets` rewritten (EN + हिंदी).

**Known residue until Tasks 14 and 16:** `pages/Support/Tickets.jsx`, `TicketDetail.jsx` and their tests still read `SUPPORT_ENDPOINTS.config.fetchPipelines` (now `undefined`). Do not run those two test files in this task — they are rewritten in Tasks 14 and 16. Nothing else imports the deleted modules (grep in Step 5 proves it). `@dnd-kit/*` and `realtime/dragGuard` stay: `components/Kanban/*` and `pages/Task/TaskBoard.jsx` use them.

- [ ] **Step 1: Write the failing tests**

In `web/src/App.routes.test.jsx`, change the section-redirect row `["/support", "/support/board"]` to `["/support", "/support/tickets"]`, and in `"keeps the concrete child routes reachable"` replace the `arrayContaining` list with:

```jsx
      expect.arrayContaining([
        "/support/tickets",
        "/support/tickets/:ticketId",
        "/settings/ticket-categories",
        "/settings/priorities",
      ]),
```

Append at the end of the file:

```jsx
// Spec 2 retired the ticket stage board and the pipeline engine. The board
// path survives as a redirect (bookmarks, the one-release-old sidebar row);
// the pipelines settings page has no successor and is simply gone.
describe("retired support routes", () => {
  const paths = routesConfig.map((r) => r.path);

  it("redirects /support/board to the tickets list", () => {
    const route = routesConfig.find((r) => r.path === "/support/board");
    expect(route.element.type.name).toBe("Navigate");
    expect(route.element.props.to).toBe("/support/tickets");
    expect(route.element.props.replace).toBe(true);
  });

  it("has no pipelines settings route", () => {
    expect(paths).not.toContain("/settings/pipelines");
  });
});
```

In `web/src/utils/menuBuilder.test.js` add `PeopleOutlined,` to the `@mui/icons-material` import list, add the row `["Customers", PeopleOutlined],` to the `it.each` table directly after `["Tickets", ConfirmationNumberOutlined],`, and replace the last test (`"uses a row's Route for the path …"`) with:

```js
  it("uses a row's Route for the path (nested SPA routes) over the title slug", () => {
    const rights = [
      { menuid: 17, parentid: 0, description: "Support", route: "/support", permissions: { canView: true } },
      { menuid: 47, parentid: 17, description: "Customers", route: "/support/customers", permissions: { canView: true } },
      // no route -> falls back to the title slug
      { menuid: 19, parentid: 17, description: "Tickets", permissions: { canView: true } },
    ];
    const support = buildDynamicMenu(rights).find((m) => m.title === "Support");
    expect(support.path).toBe("/support");
    expect(support.submenus.find((s) => s.title === "Customers").path).toBe("/support/customers");
    expect(support.submenus.find((s) => s.title === "Customers").icon).toBe(PeopleOutlined);
    expect(support.submenus.find((s) => s.title === "Tickets").path).toBe("/tickets");
  });
```

In `web/src/api/salesQueries.test.js` replace the `"keeps the config + calls endpoints Support still reads"` test with:

```js
  it("keeps lookups + custom fields for Support and drops the pipeline engine", () => {
    expect(SALES_ENDPOINTS.config).toEqual({
      saveCustomField: "/api/config/saveCustomField",
      fetchCustomFields: "/api/config/fetchCustomFields",
      deleteCustomField: "/api/config/deleteCustomField",
      saveLookup: "/api/config/saveLookup",
      fetchLookups: "/api/config/fetchLookups",
      deleteLookup: "/api/config/deleteLookup",
    });
    expect(SALES_ENDPOINTS.calls.logCall).toBe("/api/calls/logCall");
  });
```

delete the four `FETCHERS` lines `savePipeline`, `fetchPipelines`, `saveStage`, `deleteStage`, and extend the last test:

```js
  it("no longer exports the retired pipeline-era or spec-1 report fetchers", () => {
    expect(salesQueries.moveLeadStage).toBeUndefined();
    expect(salesQueries.saveFollowup).toBeUndefined();
    expect(salesQueries.pipelineFunnel).toBeUndefined();
    expect(salesQueries.leadsByStatus).toBeUndefined();
    expect(salesQueries.callsPerUser).toBeUndefined();
    expect(salesQueries.conversionBySource).toBeUndefined();
    // spec 2: the pipeline engine is dropped in 086.
    expect(salesQueries.savePipeline).toBeUndefined();
    expect(salesQueries.fetchPipelines).toBeUndefined();
    expect(salesQueries.saveStage).toBeUndefined();
    expect(salesQueries.deleteStage).toBeUndefined();
  });
```

In `web/src/components/TopNav.test.jsx`, inside `describe("TopNav notification routing")`, add after the comment-notification test:

```jsx
  // Spec 2: escalation + assignment notifications carry EntityType 'ticket'.
  it("opens a ticket notification on the complaint's page", () => {
    renderTopNav();
    capturedOnOpenEntity({ EntityType: "ticket", EntityId: 7 });
    expect(mockNavigate).toHaveBeenCalledWith("/support/tickets/7");
  });
```

- [ ] **Step 2: Run each to verify it fails**

Run: `cd web && pnpm exec vitest run src/App.routes.test.jsx`
Expected: FAIL — `/support` falls back to `/support/board`; `/support/board` element type is `ProtectedRoute`, not `Navigate`; `/settings/pipelines` is present.
Run: `cd web && pnpm exec vitest run src/utils/menuBuilder.test.js`
Expected: FAIL — `Customers` maps to `CircleOutlined`.
Run: `cd web && pnpm exec vitest run src/api/salesQueries.test.js`
Expected: FAIL — `SALES_ENDPOINTS.config` still has `fetchPipelines`; `salesQueries.savePipeline` is defined.
Run: `cd web && pnpm exec vitest run src/components/TopNav.test.jsx`
Expected: FAIL — `mockNavigate` not called for the ticket notification.

- [ ] **Step 3: Delete the board, the pipelines page and their tests**

Run:
```bash
cd web && rm src/pages/Support/TicketBoard.jsx src/pages/Support/TicketBoard.test.jsx \
  src/pages/Support/TicketCard.jsx src/pages/Support/TicketCard.test.jsx \
  src/pages/Support/TicketColumn.jsx src/pages/Support/TicketColumn.test.jsx \
  src/hooks/useStageBoard.jsx src/components/ui/BoardColumn.jsx \
  src/pages/Settings/Pipelines.jsx src/pages/Settings/Pipelines.test.jsx
```

In `web/src/components/ui/index.js` delete the line:

```js
export { default as BoardColumn } from "./BoardColumn";
```

- [ ] **Step 4: Wire routes, icon, endpoints, notification, help guide**

`web/src/App.jsx` — delete these two lazy imports:

```jsx
const PipelineSettings = lazy(() => import("./pages/Settings/Pipelines"));
```
```jsx
const TicketBoard = lazy(() => import("./pages/Support/TicketBoard"));
```

change the Support comment + section redirect:

```jsx
  { path: "/support", element: <SectionRedirect prefix="/support" fallback="/support/tickets" /> },
```

delete the row:

```jsx
  { path: "/settings/pipelines", element: <ProtectedRoute element={<PipelineSettings />} /> },
```

and replace the `/support/board` row:

```jsx
  // Support / complaints module (spec 2). The stage board is gone; its path
  // redirects so bookmarks and a stale sidebar row land on the list.
  { path: "/support/board", element: <Navigate to="/support/tickets" replace /> },
```

`web/src/utils/menuBuilder.js` — add `PeopleOutlined,` to the `@mui/icons-material` import (after `PersonSearchOutlined,`), and insert directly before the line `if (title.includes("funnel")) return FilterAltOutlined;`:

```js
  // spec 2: the Customers row under Support (086 adds tblMenu row + grants).
  if (title.includes("customer")) return PeopleOutlined;
```

and change the comment above the `return parentMenus.map(...)` to read `routes like /support/customers work; legacy rows without a Route fall back to`.

`web/src/api/salesQueries.js` — replace the `config` block with:

```js
  config: {
    saveCustomField: "/api/config/saveCustomField",
    fetchCustomFields: "/api/config/fetchCustomFields",
    deleteCustomField: "/api/config/deleteCustomField",
    saveLookup: "/api/config/saveLookup",
    fetchLookups: "/api/config/fetchLookups",
    deleteLookup: "/api/config/deleteLookup",
  },
```

and replace the `// Config (custom fields, pipelines, stages, lookups)` fetcher block with:

```js
// Config (custom fields, lookups) — the pipeline engine was dropped in 086 (spec 2).
export const saveCustomField = post(SALES_ENDPOINTS.config.saveCustomField);
export const fetchCustomFields = post(SALES_ENDPOINTS.config.fetchCustomFields);
export const deleteCustomField = post(SALES_ENDPOINTS.config.deleteCustomField);
export const saveLookup = post(SALES_ENDPOINTS.config.saveLookup);
export const fetchLookups = post(SALES_ENDPOINTS.config.fetchLookups);
export const deleteLookup = post(SALES_ENDPOINTS.config.deleteLookup);
```

`web/src/components/TopNav.jsx` — in the `onOpenEntity` handler add a branch after the `comment` one:

```jsx
            } else if (entity === "ticket" && n?.EntityId) {
              // ticket_assigned / ticket_escalated (spec 2) — open the complaint.
              navigate(`/support/tickets/${n.EntityId}`);
            } else if (entity === "workspace") {
```

`web/src/data/helpGuides.js` — replace the whole `tickets:` entry with:

```js
  tickets: {
    titleHi: "शिकायतें (Tickets) कैसे संभालें",
    titleEn: "How to handle complaints (Tickets)",
    steps: [
      {
        hi: "ऊपर के टैब से अपनी सूची चुनें — My queue (मुझे सौंपी गई), My team, Unassigned, Overdue (समय सीमा पार), Escalated, On hold, Closed, All। Status / Priority / Category / Channel / Product / Assignee / Branch फ़िल्टर और तारीख सीमा से और छाँटें।",
        en: "Pick a list from the tabs — My queue (assigned to me), My team, Unassigned, Overdue (past due), Escalated, On hold, Closed, All. Narrow further with the Status / Priority / Category / Channel / Product / Assignee / Branch filters and the date range.",
      },
      {
        hi: "'New ticket' में ग्राहक का मोबाइल या नाम टाइप करें — मौजूदा ग्राहक चुनें या '+ New customer' से तुरंत बनाएं। विषय, category, priority (priority से due date तय होती है), channel, product, विवरण और फ़ोटो जोड़ें।",
        en: "In 'New ticket' type the customer's mobile or name — pick an existing customer or create one inline with '+ New customer'. Add the subject, category, priority (the priority sets the due date), channel, product, description and photos.",
      },
      {
        hi: "समय सीमा पार होने पर शिकायत हर सूची में लाल 'overdue' दिखती है और मैनेजर को Escalated में मिलती है। किसी वरिष्ठ को सीधे भेजने के लिए 'Escalate' दबाएं (remarks ज़रूरी) — शिकायत आपके पास ही रहती है, वरिष्ठ को सूचना जाती है।",
        en: "Past its due date a complaint shows a red 'overdue' on every list and appears in the manager's Escalated tab. To flag a senior directly press 'Escalate' (remarks required) — the complaint stays with you, the senior is notified.",
      },
      {
        hi: "'Transfer' से शिकायत किसी और को दें — कारण और remarks ज़रूरी हैं और इतिहास में दर्ज होते हैं। सूची में कई शिकायतें चुनकर एक साथ 'Reassign' करें।",
        en: "Use 'Transfer' to hand a complaint to someone else — a reason and remarks are required and go into its history. Select several rows in the list to 'Reassign' them together.",
      },
      {
        hi: "शीर्षक के status ड्रॉपडाउन से जीवनचक्र चलाएं: Resolved के लिए resolution + remarks, Rejected के लिए remarks, Closed = ग्राहक ने पुष्टि की। बंद शिकायत को Reopen सिर्फ़ मैनेजर कर सकता है (remarks के साथ) — due date फिर से शुरू होती है।",
        en: "Drive the lifecycle from the status dropdown in the header: Resolved needs a resolution + remarks, Rejected needs remarks, Closed = the customer confirmed. Only a manager can Reopen a closed complaint (with remarks) — the due date restarts.",
      },
      {
        hi: "Customers पेज पर हर ग्राहक की प्रोफ़ाइल और उसकी सारी शिकायतें देखें; शिकायत के ग्राहक कार्ड से 'N previous complaints' पर क्लिक करके वहीं पहुँचें।",
        en: "The Customers page shows every customer's profile and all their complaints; click 'N previous complaints' on a complaint's customer card to get there.",
      },
    ],
  },
```

- [ ] **Step 5: Prove nothing imports the deleted modules**

Run: `cd web && grep -rn "BoardColumn\|useStageBoard\|TicketBoard\|TicketCard\|TicketColumn\|Settings/Pipelines\|savePipeline\|saveStage\|deleteStage\|moveTicketStage\|support/board" src`
Expected — exactly these hits and no others:
- `src/App.jsx` (the `/support/board` redirect row + its comment)
- `src/App.routes.test.jsx` (the retired-route test)
- `src/pages/Support/Tickets.jsx`, `Tickets.test.jsx`, `TicketDetail.jsx`, `TicketDetail.test.jsx` — `moveTicketStage`/stage references, rewritten in Tasks 14 / 16.

Run: `cd web && grep -rn "fetchPipelines" src`
Expected: only `src/pages/Support/Tickets.jsx`, `Tickets.test.jsx`, `TicketDetail.jsx`, `TicketDetail.test.jsx` (Tasks 14 / 16).

- [ ] **Step 6: Run each to verify it passes**

Run: `cd web && pnpm exec vitest run src/App.routes.test.jsx`
Expected: all passed (`App.jsx` is excluded from coverage by config; the routes test is its gate).
Run: `cd web && pnpm exec vitest run src/utils/menuBuilder.test.js --coverage --coverage.include=src/utils/menuBuilder.js`
Expected: all passed; `menuBuilder.js` ≥ 95 %.
Run: `cd web && pnpm exec vitest run src/api/salesQueries.test.js --coverage --coverage.include=src/api/salesQueries.js`
Expected: all passed; `salesQueries.js` 100 %.
Run: `cd web && pnpm exec vitest run src/components/TopNav.test.jsx --coverage --coverage.include=src/components/TopNav.jsx`
Expected: all passed; `TopNav.jsx` ≥ 80 %.
Run: `cd web && pnpm exec vitest run src/components/HelpGuide.test.jsx`
Expected: all passed (the guide shape is unchanged: flat `steps` with `{ hi, en }`).

- [ ] **Step 7: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, files deleted, the grep residue from Step 5, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 13: Customers: `CustomerFormModal`, `CustomerPicker`, `Customers` page, `CustomerDetailModal`

**Files:**
- Create: `web/src/pages/Support/CustomerFormModal.jsx`, `web/src/pages/Support/CustomerFormModal.test.jsx`
- Create: `web/src/pages/Support/CustomerPicker.jsx`, `web/src/pages/Support/CustomerPicker.test.jsx`
- Create: `web/src/pages/Support/CustomerDetailModal.jsx`, `web/src/pages/Support/CustomerDetailModal.test.jsx`
- Create: `web/src/pages/Support/Customers.jsx`, `web/src/pages/Support/Customers.test.jsx`
- Modify: `web/src/App.jsx` (one lazy import after `const Tickets = lazy(...)`, one route row after `/support/tickets/:ticketId`)
- Modify: `web/src/App.routes.test.jsx` (`"keeps the concrete child routes reachable"` list)

**Interfaces:**
- Consumes: `SUPPORT_ENDPOINTS.customers.{saveCustomer, fetchCustomers, fetchCustomerDetail}` (Task 11); `statusTone`, `dueLabel` (`./ticketStatus`, Task 11); test helpers `json`, `refuse`, `customerRow`, `ticketRow`, `mockCustomerEndpoints`, `mockSupportRefData` (`web/src/test/supportMocks.js`, Task 11); `useServerTable` (`web/src/hooks/useServerTable.jsx` — MRT search box is the page search, `getRowId`/`renderRowActions`/`muiTableBodyRowProps` pass straight through to `useAppTable`); `useApiQuery` / `useApiMutation`; `Modal`, `Button`, `TextInput`, `TextArea`, `Combobox`, `Chip`, `IconButton`, `Tooltip`, `EmptyState`, `Skeleton`, `Card` from `components/ui`; `PageHeader`; `formatDate`, `formatDateTime` (`utils/format.js`); `react-hook-form` + `zod` (the LeadCreateModal pattern).
- Produces (Tasks 15 and 16 import these by name):
  - `CustomerFormModal({ open, onClose, customer = null, onSaved(customerRow) })` — `customerRow = { Id, Name, ContactPerson, Mobile, AltMobile, Email, Address, City, State, Pincode, Remarks }` (the posted body with the saved `Id`; strings are trimmed, blanks are `null`). Test ids: `customer-form-modal`, `customer-<Field>` per input (`customer-Name`, `customer-Mobile`, …), `customer-form-submit`.
  - `CustomerPicker({ value, onChange, error })` — `value` is a customer-ish row `{ Id, Name, Mobile?, Email? } | null`; `onChange(row | null)`. Option label `${Name} · ${Mobile ?? Email}`; a trailing `+ New customer` option opens `CustomerFormModal` and selects the saved row. Test id `customer-picker` (input: `customer-picker-input`). Also exports `customerLabel(row)`.
  - `CustomerDetailModal({ customerId, open, onClose, onEdit(customerRow) })` — profile + that customer's complaints (`fetchCustomerDetail` RS2, already scoped by the server). Test ids: `customer-detail-modal`, `customer-detail-loading`, `customer-ticket-<Id>`, `customer-tickets-empty`, `customer-detail-edit`.
  - `Customers` (default export) at `/support/customers`; opens the detail modal when `?customerId=<id>` is in the URL.

Decisions stated here (the spec is silent): **no delete affordance on the web** — `sp_DeleteCustomer` 409s while any ticket references the customer, and every backfilled customer has one; add a row action when a clean-up need appears. `?customerId=` is read **once on mount** (the Leads pattern — a search-string-only change does not remount, and nothing in-page links to `/support/customers?…`). The mobile fields accept `0-9 + space -` only (the SP strips space/dash and stores digits/`+`); mobile **or** email is required, shown under Mobile. The picker fetches with `SearchTerm: null` on mount so the first 20 customers appear before the agent types — a mobile is faster to recognise than to type. The picker debounces 300 ms inline (`useServerTable` does the same; there is no `useDebounce` hook in the repo — grep confirmed).

- [ ] **Step 1: Write the failing tests**

```jsx
// web/src/pages/Support/CustomerFormModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import CustomerFormModal from "./CustomerFormModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { mockCustomerEndpoints, customerRow, refuse } from "../../test/supportMocks";

const renderModal = (props = {}) =>
  renderWithProviders(<CustomerFormModal open onClose={vi.fn()} onSaved={vi.fn()} {...props} />, { router: false });

describe("CustomerFormModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
  });

  it("creates a customer: trims strings, nulls blanks, hands the saved row back", async () => {
    const cap = mockCustomerEndpoints();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSaved, onClose });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("customer-Name"), "  Beta Ltd ");
    await user.type(screen.getByTestId("customer-ContactPerson"), "Rohan");
    await user.type(screen.getByTestId("customer-Mobile"), "8880001111");
    await user.type(screen.getByTestId("customer-City"), "Pune");
    await user.click(screen.getByTestId("customer-form-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toEqual({
      Id: 0, Name: "Beta Ltd", ContactPerson: "Rohan", Mobile: "8880001111", AltMobile: null, Email: null,
      Address: null, City: "Pune", State: null, Pincode: null, Remarks: null,
    });
    // The mock answers Id 44 — the picker needs the row with its new id, not a refetch.
    expect(onSaved).toHaveBeenCalledWith({ ...cap.save, Id: 44 });
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses without a name, then without a mobile or an email", async () => {
    const cap = mockCustomerEndpoints();
    renderModal();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("customer-form-submit"));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();

    await user.type(screen.getByTestId("customer-Name"), "Nameless Shop");
    await user.click(screen.getByTestId("customer-form-submit"));
    expect(await screen.findByText("A mobile number or an email is required")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();

    // Email alone satisfies the rule.
    await user.type(screen.getByTestId("customer-Email"), "shop@example.com");
    await user.click(screen.getByTestId("customer-form-submit"));
    await waitFor(() => expect(cap.save).toMatchObject({ Name: "Nameless Shop", Mobile: null, Email: "shop@example.com" }));
  });

  it("rejects letters in a mobile and a malformed email", async () => {
    const cap = mockCustomerEndpoints();
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("customer-Name"), "Acme");
    await user.type(screen.getByTestId("customer-Mobile"), "98abc");
    await user.type(screen.getByTestId("customer-Email"), "not-an-email");
    await user.click(screen.getByTestId("customer-form-submit"));
    expect(await screen.findByText("Digits only")).toBeInTheDocument();
    expect(screen.getByText("Invalid email")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();
  });

  it("edit mode prefills every field and posts the customer's Id", async () => {
    const cap = mockCustomerEndpoints();
    const onSaved = vi.fn();
    renderModal({ customer: customerRow({ Remarks: "Prefers WhatsApp" }), onSaved });
    const user = userEvent.setup();

    expect(screen.getByText("Edit Customer")).toBeInTheDocument();
    expect(screen.getByTestId("customer-Name")).toHaveValue("Acme Corp");
    expect(screen.getByTestId("customer-ContactPerson")).toHaveValue("Gurpreet");
    expect(screen.getByTestId("customer-Mobile")).toHaveValue("9990001111");
    expect(screen.getByTestId("customer-Email")).toHaveValue("acme@example.com");
    expect(screen.getByTestId("customer-Address")).toHaveValue("12 MG Road");
    expect(screen.getByTestId("customer-City")).toHaveValue("Pune");
    expect(screen.getByTestId("customer-State")).toHaveValue("MH");
    expect(screen.getByTestId("customer-Pincode")).toHaveValue("411001");
    expect(screen.getByTestId("customer-Remarks")).toHaveValue("Prefers WhatsApp");

    await user.clear(screen.getByTestId("customer-City"));
    await user.type(screen.getByTestId("customer-City"), "Mumbai");
    await user.click(screen.getByTestId("customer-form-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({ Id: 3, Name: "Acme Corp", Mobile: "9990001111", City: "Mumbai", Remarks: "Prefers WhatsApp" });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ Id: 3, City: "Mumbai" }));
  });

  it("surfaces the server's 409 and keeps the modal open", async () => {
    mockCustomerEndpoints();
    server.use(http.post("*/api/customers/saveCustomer", () => refuse("A customer with this mobile already exists", 409)));
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();
    await user.type(screen.getByTestId("customer-Name"), "Acme Two");
    await user.type(screen.getByTestId("customer-Mobile"), "9990001111");
    await user.click(screen.getByTestId("customer-form-submit"));
    expect(await screen.findByText("A customer with this mobile already exists")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("customer-form-modal")).toBeInTheDocument();
  });

  it("Cancel closes without posting", async () => {
    const cap = mockCustomerEndpoints();
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(cap.save).toBeUndefined();
  });
});
```

```jsx
// web/src/pages/Support/CustomerPicker.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CustomerPicker from "./CustomerPicker";
import useAuthStore from "../../stores/useAuthStore";
import renderWithProviders from "../../test/renderWithProviders";
import { mockCustomerEndpoints, customerRow } from "../../test/supportMocks";

const CUSTOMERS = [customerRow(), customerRow({ Id: 4, Name: "Zenith Traders", Mobile: null, Email: "zen@example.com" })];

describe("CustomerPicker", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
  });

  it("lists customers as 'Name · Mobile' (email when no mobile) and hands the picked row back", async () => {
    const cap = mockCustomerEndpoints({}, { customers: CUSTOMERS });
    const onChange = vi.fn();
    renderWithProviders(<CustomerPicker value={null} onChange={onChange} />, { router: false });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("customer-picker-input"));
    expect(await screen.findByRole("option", { name: "Acme Corp · 9990001111" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Zenith Traders · zen@example.com" })).toBeInTheDocument();
    // Mount fetch: no term yet, first page of 20.
    expect(cap.list).toEqual({ SearchTerm: null, PageSize: 20 });

    await user.click(screen.getByRole("option", { name: "Acme Corp · 9990001111" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ Id: 3, Name: "Acme Corp", Mobile: "9990001111" }));
  });

  it("debounces typing into one search request and never filters client-side", async () => {
    const cap = mockCustomerEndpoints({}, { customers: CUSTOMERS });
    renderWithProviders(<CustomerPicker value={null} onChange={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("customer-picker-input"), "zen");
    await waitFor(() => expect(cap.list).toEqual({ SearchTerm: "zen", PageSize: 20 }));
    expect(await screen.findByRole("option", { name: "Zenith Traders · zen@example.com" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Acme Corp · 9990001111" })).toBeNull();
  });

  // Spec §6 regression: create inline and select the new id.
  it("'+ New customer' opens the form and selects what it saves", async () => {
    const cap = mockCustomerEndpoints({}, { customers: CUSTOMERS });
    const onChange = vi.fn();
    renderWithProviders(<CustomerPicker value={null} onChange={onChange} />, { router: false });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("customer-picker-input"));
    await user.click(await screen.findByRole("option", { name: "+ New customer" }));
    // The sentinel is never a value.
    expect(onChange).not.toHaveBeenCalled();

    const modal = await screen.findByTestId("customer-form-modal");
    expect(modal).toBeInTheDocument();
    await user.type(screen.getByTestId("customer-Name"), "Beta Ltd");
    await user.type(screen.getByTestId("customer-Mobile"), "8880001111");
    await user.click(screen.getByTestId("customer-form-submit"));

    await waitFor(() => expect(cap.save).toMatchObject({ Id: 0, Name: "Beta Ltd" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ Id: 44, Name: "Beta Ltd", Mobile: "8880001111" })));
    await waitFor(() => expect(screen.queryByTestId("customer-form-modal")).not.toBeInTheDocument());
  });

  it("shows the given value even when the search did not return it, and clears to null", async () => {
    mockCustomerEndpoints({}, { customers: CUSTOMERS });
    const onChange = vi.fn();
    renderWithProviders(
      <CustomerPicker value={{ Id: 99, Name: "Offline Shop", Mobile: "7770001111" }} onChange={onChange} error="Pick a customer" />,
      { router: false },
    );
    expect(screen.getByTestId("customer-picker-input")).toHaveValue("Offline Shop · 7770001111");
    expect(screen.getByText("Pick a customer")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByTitle("Clear"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

```jsx
// web/src/pages/Support/CustomerDetailModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import CustomerDetailModal from "./CustomerDetailModal";
import useAuthStore from "../../stores/useAuthStore";
import renderWithProviders from "../../test/renderWithProviders";
import { mockCustomerEndpoints, customerRow } from "../../test/supportMocks";

// fetchCustomerDetail RS2 shape (plan Contracts), not the fetchTickets row.
const TICKETS = [
  { Id: 7, TicketNo: "TKT-0007", Subject: "Screen flickers on boot", StatusId: 62, StatusName: "In Progress", StatusCode: "open",
    Priority: 3, PriorityName: "High", AssignedTo: 17, AssigneeName: "Amit Singh", DueAt: "2020-01-01T10:00:00Z", IsOverdue: 1,
    CreatedAt: "2026-09-15T10:00:00Z", ResolvedAt: null, ClosedAt: null },
  { Id: 5, TicketNo: "TKT-0005", Subject: "Invoice mismatch", StatusId: 65, StatusName: "Closed", StatusCode: "closed",
    Priority: 1, PriorityName: "Low", AssignedTo: null, AssigneeName: null, DueAt: "2026-08-08T10:00:00Z", IsOverdue: 0,
    CreatedAt: "2026-08-01T10:00:00Z", ResolvedAt: "2026-08-03T10:00:00Z", ClosedAt: "2026-08-04T10:00:00Z" },
];

const renderModal = (props = {}) =>
  renderWithProviders(<CustomerDetailModal customerId={3} open onClose={vi.fn()} onEdit={vi.fn()} {...props} />);

describe("CustomerDetailModal", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
  });

  it("shows the profile and every complaint with its status, due and assignee", async () => {
    const cap = mockCustomerEndpoints({}, { detail: { customer: customerRow(), tickets: TICKETS } });
    renderModal();
    expect(screen.getByTestId("customer-detail-loading")).toBeInTheDocument();

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(cap.detail).toEqual({ CustomerId: 3 });
    expect(screen.getByText("acme@example.com")).toBeInTheDocument();
    expect(screen.getByText(/12 MG Road/)).toBeInTheDocument();

    const open = screen.getByTestId("customer-ticket-7");
    expect(open).toHaveTextContent("TKT-0007");
    expect(open).toHaveTextContent("Screen flickers on boot");
    expect(open).toHaveTextContent("In Progress");
    expect(open).toHaveTextContent("overdue");
    expect(open).toHaveTextContent("Amit Singh");
    const closed = screen.getByTestId("customer-ticket-5");
    expect(closed).toHaveTextContent("Closed");
    expect(closed).toHaveTextContent("Unassigned");
    // A past due date on a closed complaint is a date, never "overdue".
    expect(closed).toHaveTextContent("08-08-2026");
  });

  it("clicking a complaint opens it", async () => {
    mockCustomerEndpoints({}, { detail: { customer: customerRow(), tickets: TICKETS } });
    renderModal();
    await userEvent.setup().click(await screen.findByTestId("customer-ticket-7"));
    expect(mockNavigate).toHaveBeenCalledWith("/support/tickets/7");
  });

  it("says so when the customer has no complaints in the caller's scope", async () => {
    mockCustomerEndpoints({}, { detail: { customer: customerRow({ TotalTickets: 0, OpenTickets: 0 }), tickets: [] } });
    renderModal();
    expect(await screen.findByTestId("customer-tickets-empty")).toBeInTheDocument();
  });

  it("Edit hands the customer row to the caller", async () => {
    mockCustomerEndpoints({}, { detail: { customer: customerRow(), tickets: [] } });
    const onEdit = vi.fn();
    renderModal({ onEdit });
    await userEvent.setup().click(await screen.findByTestId("customer-detail-edit"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ Id: 3, Name: "Acme Corp" }));
  });

  it("renders nothing and fetches nothing while closed", () => {
    const cap = mockCustomerEndpoints();
    renderModal({ open: false });
    expect(screen.queryByTestId("customer-detail-modal")).toBeNull();
    expect(cap.detail).toBeUndefined();
  });
});
```

```jsx
// web/src/pages/Support/Customers.test.jsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

const FIXTURE_CUSTOMERS = [
  { Id: 3, Name: "Acme Corp", ContactPerson: "Gurpreet", Mobile: "9990001111", City: "Pune", OpenTickets: 1, TotalTickets: 3, LastTicketAt: "2026-09-15T10:00:00Z" },
];
vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: { data: FIXTURE_CUSTOMERS } },
    data: FIXTURE_CUSTOMERS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: 1,
  })),
}));
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => <div key={row.Id} data-testid={`customer-row-${row.Id}`}>{row.Name}</div>)}
    </div>
  ),
}));
vi.mock("./CustomerFormModal", () => ({
  __esModule: true,
  default: ({ open, customer }) => (open ? <div data-testid="customer-form-modal">{customer?.Id ?? "new"}</div> : null),
}));
vi.mock("./CustomerDetailModal", () => ({
  __esModule: true,
  default: ({ open, customerId, onEdit }) =>
    open ? (
      <div data-testid="customer-detail-modal">
        <span>customer:{customerId}</span>
        <button type="button" onClick={() => onEdit({ Id: customerId, Name: "Acme Corp" })}>edit-from-detail</button>
      </div>
    ) : null,
}));

import Customers from "./Customers";
import useServerTable from "../../hooks/useServerTable";

const renderPage = (route) => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={route ? [route] : undefined}><Customers /></MemoryRouter></QueryClientProvider></ThemeProvider>,
);
const lastCfg = () => useServerTable.mock.calls.at(-1)[0];
const cellOf = (key) => lastCfg().columns.find((c) => c.accessorKey === key).Cell;
const withTheme = (node) => render(<ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>);

describe("Customers page", () => {
  beforeEach(() => { useServerTable.mockClear(); });

  it("wires useServerTable to fetchCustomers with the spec columns, keyed by Id", () => {
    renderPage();
    const cfg = lastCfg();
    expect(cfg.endpoint).toBe("/api/customers/fetchCustomers");
    expect(cfg.dataKey).toBe("customers");
    expect(cfg.queryKey).toBe("customers");
    expect(cfg.getRowId({ Id: 3 })).toBe(3);
    expect(cfg.columns.map((c) => c.accessorKey)).toEqual([
      "Name", "ContactPerson", "Mobile", "City", "OpenTickets", "TotalTickets", "LastTicketAt",
    ]);
    expect(screen.getByTestId("customer-row-3")).toHaveTextContent("Acme Corp");
  });

  it("renders the cells with readable fallbacks", () => {
    renderPage();
    expect(cellOf("ContactPerson")({ cell: { getValue: () => null } })).toBe("—");
    expect(cellOf("Mobile")({ cell: { getValue: () => "9990001111" } })).toBe("9990001111");
    expect(cellOf("City")({ cell: { getValue: () => null } })).toBe("—");
    expect(cellOf("TotalTickets")({ cell: { getValue: () => null } })).toBe(0);
    expect(cellOf("LastTicketAt")({ cell: { getValue: () => "2026-09-15T10:00:00Z" } })).toBe("15-09-2026");
    expect(cellOf("LastTicketAt")({ cell: { getValue: () => null } })).toBe("—");

    withTheme(cellOf("OpenTickets")({ cell: { getValue: () => 2 } }));
    expect(screen.getByTestId("open-count-chip")).toHaveTextContent("2");
    withTheme(cellOf("OpenTickets")({ cell: { getValue: () => 0 } }));
    expect(screen.getAllByTestId("open-count-chip")[1]).toHaveTextContent("0");
  });

  it("New Customer opens the form; a row click opens the detail modal", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-customer-btn"));
    expect(screen.getByTestId("customer-form-modal")).toHaveTextContent("new");

    lastCfg().muiTableBodyRowProps({ row: { original: { Id: 3 } } }).onClick();
    expect(await screen.findByTestId("customer-detail-modal")).toHaveTextContent("customer:3");
  });

  it("row actions: the eye opens the detail, the pencil opens the editor with the row", async () => {
    renderPage();
    withTheme(lastCfg().renderRowActions({ row: { original: FIXTURE_CUSTOMERS[0] } }));
    const user = userEvent.setup();
    expect(screen.getByTestId("view-customer-3")).toHaveAttribute("data-tone", "primary");
    await user.click(screen.getByTestId("view-customer-3"));
    expect(await screen.findByTestId("customer-detail-modal")).toHaveTextContent("customer:3");
    await user.click(screen.getByTestId("edit-customer-3"));
    expect(await screen.findByTestId("customer-form-modal")).toHaveTextContent("3");
  });

  // TicketDetail's "N previous complaints" link lands here with the id in the URL.
  it("?customerId= opens that customer's detail on mount, and Edit from there swaps to the form", async () => {
    renderPage("/support/customers?customerId=3");
    expect(screen.getByTestId("customer-detail-modal")).toHaveTextContent("customer:3");
    await userEvent.setup().click(screen.getByText("edit-from-detail"));
    expect(screen.queryByTestId("customer-detail-modal")).toBeNull();
    expect(screen.getByTestId("customer-form-modal")).toHaveTextContent("3");
  });

  it("ignores a non-numeric customerId", () => {
    renderPage("/support/customers?customerId=abc");
    expect(screen.queryByTestId("customer-detail-modal")).toBeNull();
  });
});
```

In `web/src/App.routes.test.jsx`, inside `"keeps the concrete child routes reachable"`, add `"/support/customers",` directly after `"/support/tickets/:ticketId",`.

- [ ] **Step 2: Run each to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Support/CustomerFormModal.test.jsx`
Expected: FAIL — `Failed to resolve import "./CustomerFormModal"`.
Run: `cd web && pnpm exec vitest run src/pages/Support/CustomerPicker.test.jsx`
Expected: FAIL — `Failed to resolve import "./CustomerPicker"`.
Run: `cd web && pnpm exec vitest run src/pages/Support/CustomerDetailModal.test.jsx`
Expected: FAIL — `Failed to resolve import "./CustomerDetailModal"`.
Run: `cd web && pnpm exec vitest run src/pages/Support/Customers.test.jsx`
Expected: FAIL — `Failed to resolve import "./Customers"`.
Run: `cd web && pnpm exec vitest run src/App.routes.test.jsx`
Expected: FAIL — `/support/customers` missing from `routesConfig`.

- [ ] **Step 3: Implement the form modal and the picker**

Create `web/src/pages/Support/CustomerFormModal.jsx`:

```jsx
// src/pages/Support/CustomerFormModal.jsx
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Pencil, UserPlus } from "lucide-react";

import { Modal, Button, TextInput, TextArea } from "../../components/ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

// Only the columns sp_SaveCustomer takes (spec 2 §1). CompId/BranchId/UserId
// are injected server-side — never sent from here. The SP normalises the
// mobile (strips space/dash) and 409s on a duplicate; the shape check here
// only saves a round-trip.
const phone = z.string().trim().regex(/^[0-9+ -]*$/, "Digits only").optional();
const schema = z
  .object({
    Name: z.string().trim().min(1, "Name is required"),
    ContactPerson: z.string().optional(),
    Mobile: phone,
    AltMobile: phone,
    Email: z.string().trim().email("Invalid email").or(z.literal("")).optional(),
    Address: z.string().optional(),
    City: z.string().optional(),
    State: z.string().optional(),
    Pincode: z.string().optional(),
    Remarks: z.string().optional(),
  })
  .refine((v) => Boolean(v.Mobile?.trim() || v.Email?.trim()), {
    message: "A mobile number or an email is required",
    path: ["Mobile"],
  });

const EMPTY = {
  Name: "", ContactPerson: "", Mobile: "", AltMobile: "", Email: "",
  Address: "", City: "", State: "", Pincode: "", Remarks: "",
};

const toForm = (c) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, c[k] ?? ""]));
const clean = (s) => (s?.trim() ? s.trim() : null);

// One Controller-wrapped input; defined at module level so the component type
// is stable across renders (an inline component would remount — and drop
// focus — on every keystroke).
function Field({ control, errors, name, label, required = false, multiline = false, ...rest }) {
  const Input = multiline ? TextArea : TextInput;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Input
          label={label}
          required={required}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          error={errors[name]?.message}
          data-testid={`customer-${name}`}
          {...rest}
        />
      )}
    />
  );
}

/**
 * Creates or edits a customer via sp_SaveCustomer (@Id=0 insert, @Id>0
 * update). Pass a `customer` row to edit it. `onSaved` receives the posted
 * body with the saved Id, so a caller (the picker in a ticket form) can select
 * the new customer without a second fetch.
 */
export default function CustomerFormModal({ open, onClose, customer = null, onSaved }) {
  const isEdit = Boolean(customer?.Id);
  const { control, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(isEdit ? toForm(customer) : EMPTY);
  }, [open, isEdit, customer, reset]);

  const saveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.customers.saveCustomer,
    successMessage: isEdit ? "Customer updated" : "Customer created",
    invalidateQueries: [["customers"], ["customer-detail"]],
  });

  const handleClose = () => {
    if (saveMutation.isPending) return;
    reset(EMPTY);
    onClose?.();
  };

  const onSubmit = async (v) => {
    const body = {
      Id: customer?.Id ?? 0,
      Name: v.Name.trim(),
      ContactPerson: clean(v.ContactPerson),
      Mobile: clean(v.Mobile),
      AltMobile: clean(v.AltMobile),
      Email: clean(v.Email),
      Address: clean(v.Address),
      City: clean(v.City),
      State: clean(v.State),
      Pincode: clean(v.Pincode),
      Remarks: clean(v.Remarks),
    };
    try {
      const saved = await saveMutation.mutateAsync(body);
      reset(EMPTY);
      onSaved?.({ ...body, Id: saved?.Id ?? body.Id });
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message (409 on a duplicate mobile).
    }
  };

  const f = { control, errors };

  return (
    <Modal open={open} onClose={handleClose} size="lg" data-testid="customer-form-modal">
      <Modal.Header
        title={isEdit ? "Edit Customer" : "New Customer"}
        subtitle={isEdit ? undefined : "The business or person raising complaints. A mobile or an email is enough."}
        icon={isEdit ? <Pencil size={18} /> : <UserPlus size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <form
          id="customer-form"
          onSubmit={handleSubmit(onSubmit)}
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}
        >
          <Field {...f} name="Name" label="Name" required placeholder="Shop, company or person" autoFocus />
          <Field {...f} name="ContactPerson" label="Contact person" placeholder="Who to speak to" />
          <Field {...f} name="Mobile" label="Mobile" inputMode="tel" />
          <Field {...f} name="AltMobile" label="Alternate mobile" inputMode="tel" />
          <Field {...f} name="Email" label="Email" inputMode="email" />
          <Field {...f} name="Address" label="Address" />
          <Field {...f} name="City" label="City" />
          <Field {...f} name="State" label="State" />
          <Field {...f} name="Pincode" label="Pincode" inputMode="numeric" />
          <div style={{ gridColumn: "1 / -1" }}>
            <Field {...f} name="Remarks" label="Remarks" multiline rows={3} placeholder="Anything the next agent should know" />
          </div>
        </form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={saveMutation.isPending}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleSubmit(onSubmit)}
          loading={saveMutation.isPending}
          data-testid="customer-form-submit"
        >
          {isEdit ? "Save Changes" : "Create Customer"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

Create `web/src/pages/Support/CustomerPicker.jsx`:

```jsx
// src/pages/Support/CustomerPicker.jsx
import { useEffect, useState } from "react";

import { Combobox } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import CustomerFormModal from "./CustomerFormModal";

const NEW = "__new__";
const NEW_OPTION = { value: NEW, label: "+ New customer" };

/** "Acme Corp · 9990001111" — the mobile is what an agent recognises; email when there is none. */
export const customerLabel = (c) => `${c.Name} · ${c.Mobile ?? c.Email ?? "—"}`;
const toOption = (c) => ({ value: c.Id, label: customerLabel(c), row: c });

/**
 * Search-or-create customer picker for the complaint form (spec 2 §4). Types a
 * mobile or a name → sp_FetchCustomers does the matching (Name / ContactPerson /
 * Mobile / Email / City), so client-side filtering is switched off. The last
 * option is always "+ New customer": it opens CustomerFormModal and the saved
 * row becomes the value — the agent never leaves the complaint they are logging.
 *
 * `value` is any row with { Id, Name, Mobile?, Email? } (a customer row, or the
 * CustomerId/CustomerName/CustomerMobile trio off a ticket); `onChange` gets
 * the picked row or null.
 */
export default function CustomerPicker({ value, onChange, error }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // 300 ms, like useServerTable's search box — one request per pause, not per key.
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const { data, isFetching } = useApiQuery({
    queryKey: ["customers", "search", term],
    endpoint: SUPPORT_ENDPOINTS.customers.fetchCustomers,
    params: { SearchTerm: term || null, PageSize: 20 },
    showErrorMessage: false,
  });
  const rows = data?.customers ?? [];

  const selected = value ? toOption(value) : null;
  // Keep the current value listed even when the search did not return it, so
  // MUI does not log "value not in options" and the input keeps its label.
  const options = [
    ...(selected && !rows.some((r) => r.Id === selected.value) ? [selected] : []),
    ...rows.map(toOption),
    NEW_OPTION,
  ];

  return (
    <>
      <Combobox
        label="Customer"
        required
        error={error}
        options={options}
        value={selected}
        filterOptions={(x) => x}
        onInputChange={(_, v, reason) => {
          if (reason === "input" || reason === "clear") setText(v);
        }}
        onChange={(opt) => {
          if (opt?.value === NEW) {
            setCreateOpen(true);
            return;
          }
          onChange?.(opt?.row ?? null);
        }}
        // blurOnSelect: picking "+ New customer" must not leave its label in
        // the input — blurring resyncs the text to the controlled value.
        blurOnSelect
        loading={isFetching}
        placeholder="Type a mobile or a name"
        noOptionsText="No customer found"
        data-testid="customer-picker"
      />
      <CustomerFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(row) => {
          setCreateOpen(false);
          onChange?.(row);
        }}
      />
    </>
  );
}
```

- [ ] **Step 4: Implement the detail modal and the page, register the route**

Create `web/src/pages/Support/CustomerDetailModal.jsx`:

```jsx
// src/pages/Support/CustomerDetailModal.jsx
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { Inbox, Pencil } from "lucide-react";

import { Modal, Button, Card, Chip, EmptyState, Skeleton } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { formatDate } from "../../utils/format";
import { statusTone, dueLabel } from "./ticketStatus";

function Fact({ label, value }) {
  const p = useTheme().tokens;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: p.text.primary }}>{value || "—"}</div>
    </div>
  );
}

/**
 * A customer's profile and every complaint they raised that the caller may
 * see (sp_FetchCustomerDetail RS2 applies the ticket scope predicate — a Self
 * agent sees only their own). Rows open the complaint; Edit hands the row to
 * the page, which swaps this modal for the form.
 */
export default function CustomerDetailModal({ customerId, open, onClose, onEdit }) {
  const navigate = useNavigate();
  const p = useTheme().tokens;

  const { data, isLoading } = useApiQuery({
    queryKey: ["customer-detail", customerId],
    endpoint: SUPPORT_ENDPOINTS.customers.fetchCustomerDetail,
    params: { CustomerId: customerId },
    enabled: open && Boolean(customerId),
    showErrorMessage: false,
  });
  const customer = data?.customer ?? null;
  const tickets = data?.tickets ?? [];
  const address = customer ? [customer.Address, customer.City, customer.State, customer.Pincode].filter(Boolean).join(", ") : "";

  return (
    <Modal open={open} onClose={onClose} size="lg" data-testid="customer-detail-modal">
      <Modal.Header
        title={customer?.Name ?? "Customer"}
        subtitle={customer ? [customer.ContactPerson, customer.Mobile, customer.Email].filter(Boolean).join(" · ") : undefined}
        onClose={onClose}
      />
      <Modal.Body>
        {isLoading || !customer ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="customer-detail-loading">
            <Skeleton variant="text" height={24} width={240} />
            <Skeleton variant="rect" height={120} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card data-testid="customer-profile">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
                <Fact label="Mobile" value={customer.Mobile} />
                <Fact label="Alternate" value={customer.AltMobile} />
                <Fact label="Email" value={customer.Email} />
                <Fact label="Branch" value={customer.BranchName} />
                <Fact label="Customer since" value={formatDate(customer.CreatedAt)} />
                <Fact label="Open / total" value={`${customer.OpenTickets ?? 0} / ${customer.TotalTickets ?? 0}`} />
              </div>
              {(address || customer.Remarks) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
                  <Fact label="Address" value={address} />
                  <Fact label="Remarks" value={customer.Remarks} />
                </div>
              )}
            </Card>

            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>Complaints ({tickets.length})</h3>
              {tickets.length === 0 ? (
                <EmptyState
                  icon={<Inbox size={24} />}
                  title="No complaints"
                  description="Nothing raised by this customer that you can see."
                  size="sm"
                  data-testid="customer-tickets-empty"
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {tickets.map((t) => (
                    <Card
                      key={t.Id}
                      padding="sm"
                      onClick={() => navigate(`/support/tickets/${t.Id}`)}
                      data-testid={`customer-ticket-${t.Id}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: p.text.tertiary }}>{t.TicketNo}</span>
                        <span style={{ flex: 1, minWidth: 160, fontSize: 14, fontWeight: 600 }}>{t.Subject}</span>
                        <Chip label={t.StatusName || "—"} size="sm" tone={statusTone(t.StatusCode)} />
                        {t.PriorityName && <Chip label={t.PriorityName} size="sm" tone="accent" />}
                        <span style={{ fontSize: 12, color: t.IsOverdue ? p.error.main : p.text.secondary, fontWeight: t.IsOverdue ? 600 : 500 }}>
                          {dueLabel(t.DueAt, t.IsOverdue)}
                        </span>
                        <span style={{ fontSize: 12, color: p.text.secondary }}>{t.AssigneeName || "Unassigned"}</span>
                        <span style={{ fontSize: 12, color: p.text.tertiary }}>{formatDate(t.CreatedAt)}</span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {customer && onEdit && (
          <Button variant="tonal" leftIcon={<Pencil size={14} />} onClick={() => onEdit(customer)} data-testid="customer-detail-edit">
            Edit
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
```

Create `web/src/pages/Support/Customers.jsx`:

```jsx
// src/pages/Support/Customers.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useSearchParams } from "react-router-dom";
import { Eye, Pencil, Plus } from "lucide-react";

import { Button, Chip, IconButton, Tooltip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import useServerTable from "../../hooks/useServerTable";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { formatDate } from "../../utils/format";
import CustomerFormModal from "./CustomerFormModal";
import CustomerDetailModal from "./CustomerDetailModal";

const idParam = (v) => (v && /^\d+$/.test(v) ? Number(v) : null);

/**
 * Everyone who has raised a complaint (spec 2 §4). Company-wide on purpose:
 * de-duplicating three spellings of one mobile needs the whole list. The
 * table's own search box drives sp_FetchCustomers @SearchTerm (name, contact,
 * mobile, email, city).
 */
const Customers = () => {
  // TicketDetail's "N previous complaints" link lands here with the id in the
  // URL. Read once on mount; from then on the page owns its state.
  const [searchParams] = useSearchParams();
  const [detailId, setDetailId] = useState(() => idParam(searchParams.get("customerId")));
  const [createOpen, setCreateOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);

  const columns = useMemo(() => [
    { accessorKey: "Name", header: "Name", enableSorting: true },
    { accessorKey: "ContactPerson", header: "Contact", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "Mobile", header: "Mobile", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "City", header: "City", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "OpenTickets", header: "Open", enableSorting: false, size: 80,
      Cell: ({ cell }) => <Chip label={String(cell.getValue() ?? 0)} size="sm" tone={cell.getValue() > 0 ? "warning" : "default"} data-testid="open-count-chip" /> },
    { accessorKey: "TotalTickets", header: "Total", enableSorting: false, size: 80, Cell: ({ cell }) => cell.getValue() ?? 0 },
    { accessorKey: "LastTicketAt", header: "Last complaint", enableSorting: true, Cell: ({ cell }) => formatDate(cell.getValue(), { empty: "—" }) },
  ], []);

  const { table } = useServerTable({
    columns, queryKey: "customers", endpoint: SUPPORT_ENDPOINTS.customers.fetchCustomers, dataKey: "customers",
    initialPageSize: 25, getRowId: (row) => row.Id,
    enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => setDetailId(row.original.Id) }),
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="View customer & complaints"><IconButton size="sm" variant="ghost" tone="primary" aria-label="View customer" data-testid={`view-customer-${row.original.Id}`} onClick={() => setDetailId(row.original.Id)}><Eye size={16} /></IconButton></Tooltip>
        <Tooltip title="Edit details"><IconButton size="sm" variant="ghost" tone="info" aria-label="Edit customer" data-testid={`edit-customer-${row.original.Id}`} onClick={() => setEditCustomer(row.original)}><Pencil size={16} /></IconButton></Tooltip>
      </Box>
    ),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Customers"
        subtitle="Everyone who has raised a complaint, and how many are still open."
        actions={
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)} data-testid="new-customer-btn">
            New Customer
          </Button>
        }
      />
      <Helmet><title>PRD Infotech | Customers</title></Helmet>

      <Box sx={{ width: "100%", overflowX: "auto", mt: 1 }}><MaterialReactTable table={table} /></Box>

      {/* Saving invalidates ["customers"] (the table) and ["customer-detail"] (the modal). */}
      <CustomerFormModal
        open={createOpen || Boolean(editCustomer)}
        customer={editCustomer}
        onClose={() => { setCreateOpen(false); setEditCustomer(null); }}
      />
      <CustomerDetailModal
        customerId={detailId}
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        onEdit={(c) => { setDetailId(null); setEditCustomer(c); }}
      />
    </Box>
  );
};

export default Customers;
```

`web/src/App.jsx` — directly after the line `const Tickets = lazy(() => import("./pages/Support/Tickets"));` add:

```jsx
const Customers = lazy(() => import("./pages/Support/Customers"));
```

and directly after the row `{ path: "/support/tickets/:ticketId", element: <ProtectedRoute element={<TicketDetail />} /> },` add:

```jsx
  { path: "/support/customers", element: <ProtectedRoute element={<Customers />} /> },
```

- [ ] **Step 5: Run each to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Support/CustomerFormModal.test.jsx --coverage --coverage.include=src/pages/Support/CustomerFormModal.jsx`
Expected: 6 passed; `CustomerFormModal.jsx` ≥ 90 % lines / branches.
Run: `cd web && pnpm exec vitest run src/pages/Support/CustomerPicker.test.jsx --coverage --coverage.include=src/pages/Support/CustomerPicker.jsx`
Expected: 4 passed; `CustomerPicker.jsx` ≥ 90 %.
Run: `cd web && pnpm exec vitest run src/pages/Support/CustomerDetailModal.test.jsx --coverage --coverage.include=src/pages/Support/CustomerDetailModal.jsx`
Expected: 5 passed; `CustomerDetailModal.jsx` ≥ 85 %.
Run: `cd web && pnpm exec vitest run src/pages/Support/Customers.test.jsx --coverage --coverage.include=src/pages/Support/Customers.jsx`
Expected: 6 passed; `Customers.jsx` ≥ 85 %.
Run: `cd web && pnpm exec vitest run src/App.routes.test.jsx`
Expected: all passed (`App.jsx` is excluded from coverage by config).

- [ ] **Step 6: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 14: `Tickets.jsx` list + `TransferTicketModal`

**Files:**
- Create: `web/src/pages/Support/TransferTicketModal.jsx`
- Create: `web/src/pages/Support/TransferTicketModal.test.jsx`
- Modify: `web/src/pages/Support/Tickets.jsx` (whole file — 293 lines today: `:30-39` stage/priority/category/assignee filter state, `:44-82` the client-side id→name maps built from `fetchPipelines`, `:84-172` columns, `:174-199` `extraParams` + `useServerTable`, `:244-285` the four filter Comboboxes)
- Modify: `web/src/pages/Support/Tickets.test.jsx` (whole file — 315 lines today; it mocks `/api/config/fetchPipelines`, which Task 12 deleted)

**Interfaces:**
- Consumes: `SUPPORT_ENDPOINTS.tickets.{fetchTickets, transferTicket, bulkTransferTickets}` (Task 11); `TICKET_PRESETS`, `presetParams(preset, userId)`, `ticketsParamsToState(searchParams)`, `statusTone(code)`, `dueLabel(dueAt, isOverdue)` (`./ticketStatus`, Task 11); `SALES_ENDPOINTS.products.fetchProducts` / `SALES_ENDPOINTS.users.fetchBranches` / `SALES_ENDPOINTS.users.fetchAssignableUsers` (via `useAssignableUsers`) — `supportQueries` deliberately re-exports only `config` + `calls` (Task 11's contract), so the shared org/product endpoints come from `salesQueries`, exactly as `TransferLeadModal` already does; `useServerTable` (`web/src/hooks/useServerTable.jsx` — `getRowId`/`enableRowSelection`/`renderRowActions`/`muiTableBodyRowProps` pass straight through to `useAppTable`); `useLookups(kind, { enabled, showErrorMessage })`; `useAssignableUsers({ branchId, enabled })`; `useUsers({ PageSize })` (`web/src/hooks` barrel); `useApiQuery`; `useApiMutation`; `Tabs`, `Combobox`, `DateField`, `Chip`, `Button`, `IconButton`, `Tooltip`, `TextArea`, `Modal` from `components/ui`; `PageHeader`; `HelpGuide` + `HELP_GUIDES.tickets` (rewritten in Task 12); `getUserName` (`utils/userShape.js`); `TicketDetailModal`, `TicketCreateModal` (Task 15 gives it the `ticket` edit prop), `DeleteTicketModal` (unchanged, `web/src/pages/Support/DeleteTicketModal.jsx:12`).
- Produces (Task 16 imports the modal by name):
  - `TransferTicketModal({ open, onClose, ticketIds = [], onDone })` — assignee (`useAssignableUsers`) + branch + reason (`transfer_reason`) + remarks. `ticketIds.length > 1` → `bulkTransferTickets` with `{ TicketIds, ToUserId, ToBranchId, ReasonId, Remarks }`, else `transferTicket` with `{ TicketId, ToUserId, ToBranchId, ReasonId, Remarks }`. Test ids: `transfer-ticket-modal`, `ticket-transfer-branch`, `ticket-transfer-assignee`, `ticket-transfer-reason`, `ticket-transfer-remarks`, `ticket-transfer-submit`.
  - `Tickets` (default export) at `/support/tickets` — presets as `Tabs`, seven id filters + a date range, columns `TicketNo · Subject · Customer · Status · Priority · Due · Assignee · ⚑ · Age`, bulk **Reassign**, row click → `TicketDetailModal`. Test ids: `ticket-presets`, `filter-status|priority|category|channel|product|assignee|branch`, `tickets-from`, `tickets-to`, `new-ticket-btn`, `bulk-reassign-btn`, `view-ticket-<Id>`, `edit-ticket-<Id>`, `transfer-ticket-<Id>`, `delete-ticket-<Id>`, `ticket-due-<Id>`, `ticket-escalated-<Id>`.

Decisions stated here (the spec is silent):
1. **The branch picker is always shown** in `TransferTicketModal` — no `canCrossBranch` prop. `TransferLeadModal` has one and every call site passes `canCrossBranch`, so the prop only ever had one value; `assertCanAssign` is the real gate and answers a Team/Self caller with a clear 403 (Task 8). One prop fewer.
2. **The date range is two `DateField`s**, not the removable chip Leads uses. Leads' chip exists because a report drill-down is the only way a range gets set there; spec §4 lists "date range" as a *filter* on this screen, so it needs inputs. `ticketsParamsToState` still seeds them from the URL, so a future support report can drill in the same way.
3. **The preset wins over the assignee filter.** `presetParams` is spread last, so on *My queue* the `AssignedTo` filter is overwritten with the caller's id — "My queue" *means* assigned to me. Same shape as `Leads.jsx:83-89`.
4. **Row actions mirror Leads**: eye (open) · pencil (edit) · transfer · delete. The eye leads, and each icon is toned by consequence. `DeleteTicketModal` keeps its only caller this way.

- [ ] **Step 1: Write the failing tests**

```jsx
// web/src/pages/Support/TransferTicketModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import TransferTicketModal from "./TransferTicketModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { mockSupportRefData, mockTicketEndpoints, refuse } from "../../test/supportMocks";

const pick = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name }));
};

describe("TransferTicketModal", () => {
  beforeEach(() => {
    // Braces, not a bare arrow: vitest treats a hook's RETURN value as its
    // cleanup function, and setState returns undefined — but mockReset()
    // returns the mock, which vitest would then call after every test.
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
  });

  it("posts transferTicket with the person, the reason and the remarks", async () => {
    mockSupportRefData();
    const cap = mockTicketEndpoints();
    const onDone = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={onClose} onDone={onDone} />, { router: false });
    const user = userEvent.setup();

    expect(screen.getByText("Transfer complaint")).toBeInTheDocument();
    await pick(user, "ticket-transfer-assignee", "Sara Khan");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "On leave this week");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    await waitFor(() => expect(cap.transfer).toBeTruthy());
    expect(cap.transfer).toEqual({ TicketId: 7, ToUserId: 18, ToBranchId: null, ReasonId: 36, Remarks: "On leave this week" });
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // Spec §6 regression: the assignment history is only readable by whoever
  // inherits the complaint if BOTH are there. The SP refuses too; this saves
  // the round-trip and says so before the click.
  it("refuses to submit without a reason and without remarks", async () => {
    mockSupportRefData();
    const cap = mockTicketEndpoints();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-assignee", "Amit Singh");
    expect(screen.getByTestId("ticket-transfer-submit")).toBeDisabled();

    await pick(user, "ticket-transfer-reason", "Absent");
    expect(screen.getByTestId("ticket-transfer-submit")).toBeDisabled();   // remarks still missing

    await user.type(screen.getByTestId("ticket-transfer-remarks"), "   ");
    expect(screen.getByTestId("ticket-transfer-submit")).toBeDisabled();   // whitespace is not remarks

    await user.click(screen.getByTestId("ticket-transfer-submit"));
    expect(cap.transfer).toBeUndefined();
  });

  it("cross-branch: picking a branch reloads that branch's roster and sends ToBranchId", async () => {
    mockSupportRefData();
    const cap = mockTicketEndpoints();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-branch", "SOUTH EXTENSION");
    await pick(user, "ticket-transfer-assignee", "Vikram Rao");
    await pick(user, "ticket-transfer-reason", "Wrong branch");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Customer is in Kalkaji");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    await waitFor(() => expect(cap.transfer).toBeTruthy());
    expect(cap.transfer).toMatchObject({ TicketId: 7, ToUserId: 20, ToBranchId: 2, ReasonId: 38 });
  });

  it("several ids → bulkTransferTickets with the id list", async () => {
    mockSupportRefData();
    const cap = mockTicketEndpoints();
    const onDone = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7, 8]} onClose={vi.fn()} onDone={onDone} />, { router: false });
    const user = userEvent.setup();

    expect(screen.getByText("Reassign 2 complaints")).toBeInTheDocument();
    await pick(user, "ticket-transfer-assignee", "Amit Singh");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Covering");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    await waitFor(() => expect(cap.bulk).toBeTruthy());
    expect(cap.bulk).toEqual({ TicketIds: [7, 8], ToUserId: 17, ToBranchId: null, ReasonId: 36, Remarks: "Covering" });
    expect(cap.transfer).toBeUndefined();
    expect(onDone).toHaveBeenCalled();
  });

  it("keeps the modal open and shows the server's refusal", async () => {
    mockSupportRefData();
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/transferTicket", () => refuse("You cannot assign records to that user", 403)));
    const onClose = vi.fn();
    renderWithProviders(<TransferTicketModal open ticketIds={[7]} onClose={onClose} onDone={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await pick(user, "ticket-transfer-assignee", "Sara Khan");
    await pick(user, "ticket-transfer-reason", "Absent");
    await user.type(screen.getByTestId("ticket-transfer-remarks"), "Please take this");
    await user.click(screen.getByTestId("ticket-transfer-submit"));

    expect(await screen.findByText("You cannot assign records to that user")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("transfer-ticket-modal")).toBeInTheDocument();
  });
});
```

```jsx
// web/src/pages/Support/Tickets.test.jsx   (replaces the whole file)
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";

// MUI X 9's date field renders contenteditable sections jsdom cannot type
// into; the range filter needs real dates, so swap in the native stub. The
// path is the module the ui barrel itself imports, so mocking it catches the
// `from "../../components/ui"` import too.
vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

const FIXTURE_TICKETS = [
  {
    Id: 7, TicketNo: "TKT-0007", Subject: "Screen flickers on boot",
    CustomerId: 3, CustomerName: "Acme Corp", CustomerMobile: "9990001111",
    StatusId: 62, StatusName: "In Progress", StatusCode: "open",
    Priority: 3, PriorityName: "High", CategoryName: "Billing", ChannelName: "Phone",
    AssignedTo: 17, AssigneeName: "Amit Singh", DueAt: "2026-09-16T10:00:00Z", IsOverdue: 1,
    AgeHours: 30, EscalatedTo: 16, EscalatedToName: "Neha Verma",
  },
];
let rowSelection = {};

vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: { data: FIXTURE_TICKETS }, getState: () => ({ rowSelection }), resetRowSelection: vi.fn() },
    data: FIXTURE_TICKETS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: 1,
  })),
}));
vi.mock("../../hooks", () => ({
  useUsers: vi.fn(() => ({ data: { users: [{ Id: 17, Username: "se_ho_amit", FullName: "Amit Singh" }] } })),
  useConfirmation: vi.fn(() => ({ confirmationState: { open: false }, showConfirmation: vi.fn(), hideConfirmation: vi.fn(), handleConfirm: vi.fn(), confirmDelete: vi.fn() })),
}));
vi.mock("../../hooks/useLookups", () => ({
  useLookups: vi.fn((kind) => ({
    lookups: {
      ticket_status: [{ Id: 62, Value: "In Progress", Code: "open" }, { Id: 65, Value: "Closed", Code: "closed" }],
      priority: [{ Id: 3, Value: "High", TatHours: 24 }],
      ticket_category: [{ Id: 6, Value: "Billing" }],
      ticket_channel: [{ Id: 71, Value: "Phone" }],
    }[kind] ?? [],
  })),
}));
vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn((cfg) => {
    if (cfg?.endpoint === "/api/products/fetchProducts") return { data: { products: [{ Id: 1, Name: "Gold Chain 22K" }] } };
    if (cfg?.endpoint === "/api/users/fetchBranches") return { data: { branches: [{ Id: 2, BranchName: "SOUTH EXTENSION" }] } };
    return { data: {} };
  }),
}));
vi.mock("../../stores/useAuthStore", () => ({ __esModule: true, default: (sel) => sel({ user: { UserId: 17 }, UserId: 17 }) }));
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => <div key={row.Id} data-testid={`ticket-row-${row.Id}`}>{row.TicketNo}</div>)}
    </div>
  ),
}));
vi.mock("./TicketDetailModal", () => ({ __esModule: true, default: ({ open, ticketId }) => (open ? <div data-testid="ticket-detail-modal">ticket:{ticketId}</div> : null) }));
vi.mock("./TicketCreateModal", () => ({ __esModule: true, default: ({ open, ticket }) => (open ? <div data-testid="ticket-form-modal">{ticket?.Id ?? "new"}</div> : null) }));
vi.mock("./TransferTicketModal", () => ({ __esModule: true, default: ({ open, ticketIds }) => (open ? <div data-testid="transfer-ticket-modal">{ticketIds.join(",")}</div> : null) }));
vi.mock("./DeleteTicketModal", () => ({ __esModule: true, default: ({ open, ticketId }) => (open ? <div data-testid="delete-ticket-modal">delete:{ticketId}</div> : null) }));

import Tickets from "./Tickets";
import useServerTable from "../../hooks/useServerTable";

const renderPage = (route) => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={route ? [route] : undefined}><Tickets /></MemoryRouter></QueryClientProvider></ThemeProvider>,
);
const lastCfg = () => useServerTable.mock.calls.at(-1)[0];
const lastParams = () => lastCfg().extraParams;
const columnOf = (key) => lastCfg().columns.find((c) => c.accessorKey === key || c.id === key);
const withTheme = (node) => render(<ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>);
const EMPTY_FILTERS = {
  StatusId: null, Priority: null, CategoryId: null, ChannelId: null, ProductId: null, AssignedTo: null, BranchId: null,
};

describe("Tickets list (spec 2)", () => {
  beforeEach(() => {
    rowSelection = {};
    useServerTable.mockClear();
  });

  it("renders the eight presets, the seven filters and the range, and lands on My team", () => {
    renderPage();
    for (const label of ["My queue", "My team", "Unassigned", "Overdue", "Escalated", "On hold", "Closed", "All"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    for (const id of ["filter-status", "filter-priority", "filter-category", "filter-channel", "filter-product", "filter-assignee", "filter-branch"]) {
      expect(screen.getByTestId(`${id}-input`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("tickets-from")).toBeInTheDocument();
    expect(screen.getByTestId("tickets-to")).toBeInTheDocument();
    // Default tab = My team: every active complaint in the caller's scope.
    expect(screen.getByRole("tab", { name: "My team" })).toHaveAttribute("aria-selected", "true");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, StatusCode: "active" });
    expect(lastCfg().endpoint).toBe("/api/tickets/fetchTickets");
    expect(lastCfg().dataKey).toBe("tickets");
    expect(lastCfg().getRowId({ Id: 7 })).toBe(7);
    expect(screen.getByTestId("ticket-row-7")).toHaveTextContent("TKT-0007");
  });

  // Spec §4 + §6: the presets ARE the query — each one maps onto
  // sp_FetchTickets params, and nothing else on the page changes.
  it("maps every preset onto the fetchTickets params", async () => {
    renderPage();
    const user = userEvent.setup();
    const tab = (name) => user.click(screen.getByRole("tab", { name }));

    await tab("My queue");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, AssignedTo: 17, StatusCode: "active" });
    await tab("Unassigned");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, Unassigned: 1, StatusCode: "active" });
    await tab("Overdue");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, Overdue: 1 });
    await tab("Escalated");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, Escalated: 1 });
    await tab("On hold");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, StatusCode: "onhold" });
    await tab("Closed");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, StatusCode: "closed" });
    await tab("All");
    expect(lastParams()).toEqual(EMPTY_FILTERS);
  });

  it("narrows on a filter and a date without losing the preset or the other filters", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("filter-priority-input"));
    await user.click(await screen.findByRole("option", { name: "High" }));
    await user.click(screen.getByTestId("filter-branch-input"));
    await user.click(await screen.findByRole("option", { name: "SOUTH EXTENSION" }));
    fireEvent.change(screen.getByTestId("tickets-from"), { target: { value: "2026-09-01" } });

    expect(lastParams()).toEqual({
      ...EMPTY_FILTERS, Priority: 3, BranchId: 2, FromDate: "2026-09-01", StatusCode: "active",
    });
  });

  it("seeds the preset, the filters and the range from the URL", () => {
    renderPage("/support/tickets?Escalated=1&Priority=3&CategoryId=6&from=2026-09-01&to=2026-09-16");
    expect(screen.getByRole("tab", { name: "Escalated" })).toHaveAttribute("aria-selected", "true");
    expect(lastParams()).toEqual({
      ...EMPTY_FILTERS, Priority: 3, CategoryId: 6, FromDate: "2026-09-01", ToDate: "2026-09-16", Escalated: 1,
    });
    // Numeric ids, not strings: the Combobox compares options with ===, so a
    // string would post the filter while the input showed its placeholder.
    expect(screen.getByTestId("filter-priority-input")).toHaveValue("High");
    expect(screen.getByTestId("tickets-from")).toHaveValue("2026-09-01");
  });

  it("renders the spec's columns, with the customer's mobile under their name", () => {
    renderPage();
    expect(lastCfg().columns.map((c) => c.accessorKey ?? c.id)).toEqual([
      "TicketNo", "Subject", "CustomerName", "StatusName", "PriorityName", "DueAt", "AssigneeName", "escalated", "AgeHours",
    ]);
    const row = { original: FIXTURE_TICKETS[0] };
    const { container } = withTheme(columnOf("CustomerName").Cell({ row }));
    expect(container).toHaveTextContent("Acme Corp");
    expect(container).toHaveTextContent("9990001111");
  });

  // Spec §2: overdue is computed on read and must be visible at a glance —
  // this is the whole reason the column is relative rather than a date.
  it("an overdue row reads 'overdue' in the error tone; an on-time one does not", () => {
    renderPage();
    const Cell = columnOf("DueAt").Cell;
    const over = withTheme(Cell({ row: { original: FIXTURE_TICKETS[0] } }));
    const overSpan = over.container.querySelector("span");
    expect(overSpan).toHaveTextContent("overdue");
    // fontWeight, not colour: jsdom normalises an inline hex to rgb(), so
    // comparing with the raw token fails (Leads.test.jsx does the same).
    expect(overSpan.style.fontWeight).toBe("600");

    const onTime = withTheme(Cell({ row: { original: { Id: 8, DueAt: "2099-01-01T10:00:00Z", IsOverdue: 0 } } }));
    expect(onTime.container.querySelector("span").style.fontWeight).toBe("");
    const none = withTheme(Cell({ row: { original: { Id: 9, DueAt: null, IsOverdue: 0 } } }));
    expect(none.container).toHaveTextContent("—");
  });

  it("tones the status chip by its code and falls back readably everywhere else", () => {
    renderPage();
    withTheme(columnOf("StatusName").Cell({ row: { original: FIXTURE_TICKETS[0] } }));
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    withTheme(columnOf("StatusName").Cell({ row: { original: { StatusName: null, StatusCode: null } } }));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    expect(columnOf("Subject").Cell({ cell: { getValue: () => null } })).toBe("—");
    expect(columnOf("AssigneeName").Cell({ cell: { getValue: () => null } })).toBe("Unassigned");
    expect(columnOf("AgeHours").Cell({ cell: { getValue: () => 5 } })).toBe("5h");
    expect(columnOf("AgeHours").Cell({ cell: { getValue: () => 30 } })).toBe("1d");
    expect(columnOf("AgeHours").Cell({ cell: { getValue: () => null } })).toBe("—");

    withTheme(columnOf("escalated").Cell({ row: { original: FIXTURE_TICKETS[0] } }));
    expect(screen.getByTestId("ticket-escalated-7")).toBeInTheDocument();
    const plain = withTheme(columnOf("escalated").Cell({ row: { original: { Id: 8, EscalatedTo: null } } }));
    expect(plain.container).toHaveTextContent("—");
  });

  it("shows Reassign only with a selection and hands the ids to the transfer modal", async () => {
    rowSelection = { 7: true, 8: true };
    renderPage();
    const btn = screen.getByTestId("bulk-reassign-btn");
    expect(btn).toHaveTextContent("Reassign 2");
    await userEvent.setup().click(btn);
    expect(screen.getByTestId("transfer-ticket-modal")).toHaveTextContent("7,8");
    // Only ticket ids because the table is keyed by Id — without getRowId MRT
    // keys selection by row index and this would post [0,1].
    expect(lastCfg().enableRowSelection).toBe(true);
  });

  it("hides Reassign with nothing selected", () => {
    renderPage();
    expect(screen.queryByTestId("bulk-reassign-btn")).toBeNull();
  });

  it("a row click opens the detail modal; the row actions open the rest", async () => {
    renderPage();
    lastCfg().muiTableBodyRowProps({ row: { original: { Id: 7 } } }).onClick();
    expect(await screen.findByTestId("ticket-detail-modal")).toHaveTextContent("ticket:7");

    withTheme(lastCfg().renderRowActions({ row: { original: FIXTURE_TICKETS[0] } }));
    const user = userEvent.setup();
    expect(screen.getByTestId("view-ticket-7")).toHaveAttribute("data-tone", "primary");
    expect(screen.getByTestId("edit-ticket-7")).toHaveAttribute("data-tone", "info");
    expect(screen.getByTestId("transfer-ticket-7")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("delete-ticket-7")).toHaveAttribute("data-tone", "error");

    await user.click(screen.getByTestId("edit-ticket-7"));
    expect(await screen.findByTestId("ticket-form-modal")).toHaveTextContent("7");
    await user.click(screen.getByTestId("transfer-ticket-7"));
    expect(screen.getByTestId("transfer-ticket-modal")).toHaveTextContent("7");
    await user.click(screen.getByTestId("delete-ticket-7"));
    expect(screen.getByTestId("delete-ticket-modal")).toHaveTextContent("delete:7");
  });

  it("New Ticket opens the blank form", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByTestId("new-ticket-btn"));
    expect(await screen.findByTestId("ticket-form-modal")).toHaveTextContent("new");
  });

  it("asks the server for nothing about stages any more", () => {
    renderPage();
    expect(JSON.stringify(lastCfg())).not.toContain("Stage");
  });
});
```

- [ ] **Step 2: Run each to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Support/TransferTicketModal.test.jsx`
Expected: FAIL — `Failed to resolve import "./TransferTicketModal"`.
Run: `cd web && pnpm exec vitest run src/pages/Support/Tickets.test.jsx`
Expected: FAIL — `SUPPORT_ENDPOINTS.config.fetchPipelines` is `undefined` (Task 12 dropped it), so `useApiQuery` is called with `endpoint: undefined`; no tab has the name "My queue".

- [ ] **Step 3: Implement `TransferTicketModal`**

Create `web/src/pages/Support/TransferTicketModal.jsx`:

```jsx
// src/pages/Support/TransferTicketModal.jsx
import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

/**
 * Hand one complaint, or many, to someone else — always with a reason and
 * remarks (spec 2 §2). Those two are what make the assignment history readable
 * by whoever inherits the complaint, so the button stays disabled until both
 * are there; sp_TransferTicket refuses without them too.
 *
 * The branch picker is always offered: assertCanAssign is the real gate and
 * answers a Team/Self caller with a clear 403. Picking a branch reloads that
 * branch's roster and sends ToBranchId.
 */
export default function TransferTicketModal({ open, onClose, ticketIds = [], onDone }) {
  const [branch, setBranch] = useState(null);
  const [assignee, setAssignee] = useState(null);
  const [reason, setReason] = useState(null);
  const [remarks, setRemarks] = useState("");

  const bulk = ticketIds.length > 1;

  const { users } = useAssignableUsers({ branchId: branch?.value ?? null, enabled: open });
  const { lookups: reasons } = useLookups("transfer_reason", { enabled: open, showErrorMessage: false });
  const { data: branchData } = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    enabled: open,
    showErrorMessage: false,
  });

  const assigneeOptions = users.map((u) => ({ value: u.Id, label: u.FullName }));
  const reasonOptions = reasons.map((r) => ({ value: r.Id, label: r.Value }));
  const branchOptions = (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName }));

  // A new branch means a new roster — the old pick no longer exists in it.
  useEffect(() => setAssignee(null), [branch?.value]);

  const mutation = useApiMutation({
    endpoint: bulk ? SUPPORT_ENDPOINTS.tickets.bulkTransferTickets : SUPPORT_ENDPOINTS.tickets.transferTicket,
    successMessage: bulk ? "Complaints transferred" : "Complaint transferred",
    invalidateQueries: [["tickets"], ["ticket-detail"], ["customer-detail"]],
  });

  const reset = () => { setBranch(null); setAssignee(null); setReason(null); setRemarks(""); };
  const handleClose = () => { if (mutation.isPending) return; reset(); onClose?.(); };
  const ready = Boolean(assignee && reason && remarks.trim());

  const submit = async () => {
    if (!ready) return;
    const common = { ToUserId: assignee.value, ToBranchId: branch?.value ?? null, ReasonId: reason.value, Remarks: remarks.trim() };
    try {
      await mutation.mutateAsync(bulk ? { TicketIds: ticketIds, ...common } : { TicketId: ticketIds[0], ...common });
      reset();
      onDone?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message (a 403 from
      // assertCanAssign, a 400 from the SP's no-op check).
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="transfer-ticket-modal">
      <Modal.Header
        title={bulk ? `Reassign ${ticketIds.length} complaints` : "Transfer complaint"}
        icon={<ArrowRightLeft size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Combobox
            label="Branch"
            options={branchOptions}
            value={branch}
            onChange={setBranch}
            placeholder="Keep current branch"
            data-testid="ticket-transfer-branch"
          />
          <Combobox
            label="New assignee"
            required
            options={assigneeOptions}
            value={assignee}
            onChange={setAssignee}
            placeholder="Who takes it over?"
            data-testid="ticket-transfer-assignee"
          />
          <Combobox
            label="Reason"
            required
            options={reasonOptions}
            value={reason}
            onChange={setReason}
            placeholder="Why is this moving?"
            data-testid="ticket-transfer-reason"
          />
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What the next person needs to know"
            data-testid="ticket-transfer-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!ready}
          loading={mutation.isPending}
          data-testid="ticket-transfer-submit"
        >
          {bulk ? "Reassign" : "Transfer"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

- [ ] **Step 4: Rewrite `Tickets.jsx`**

Replace the whole of `web/src/pages/Support/Tickets.jsx`:

```jsx
// src/pages/Support/Tickets.jsx
//
// The complaints list (spec 2 §4). The stage board is gone; this is the
// landing page. Presets are the query — each tab maps onto sp_FetchTickets
// params via presetParams — and every label (status, priority, category,
// channel, product, assignee, branch) is joined by the SP, so nothing is
// resolved client-side any more.
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { useSearchParams } from "react-router-dom";
import { ArrowRightLeft, Eye, Flag, Pencil, Plus, Trash2, Users } from "lucide-react";

import { Button, Chip, Combobox, DateField, IconButton, Tabs, Tooltip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUsers } from "../../hooks";
import { useLookups } from "../../hooks/useLookups";
import useAuthStore from "../../stores/useAuthStore";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { getUserName } from "../../utils/userShape";
import { TICKET_PRESETS, presetParams, ticketsParamsToState, statusTone, dueLabel } from "./ticketStatus";
import TicketCreateModal from "./TicketCreateModal";
import TicketDetailModal from "./TicketDetailModal";
import TransferTicketModal from "./TransferTicketModal";
import DeleteTicketModal from "./DeleteTicketModal";

const num = (v) => (v === "" ? null : Number(v));
// Hours since it was raised: "5h" under a day, "2d" after that.
const ageLabel = (h) => (h == null ? "—" : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);

const Tickets = () => {
  const theme = useTheme();
  const userId = useAuthStore((s) => s.user?.UserId ?? s.UserId);

  // The URL can arrive pre-filtered (a bookmark, a notification, a future
  // support report drilling in). Read once on mount; from then on the page
  // owns its state, so a stray URL change cannot wipe what the user typed.
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => ticketsParamsToState(searchParams));
  const [preset, setPreset] = useState(initial.preset);
  const [filters, setFilters] = useState(initial.filters);
  const [range, setRange] = useState(initial.range);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTicket, setEditTicket] = useState(null);
  const [detailTicketId, setDetailTicketId] = useState(null);
  const [transferIds, setTransferIds] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const setFilterValue = (key) => (opt) => setFilters((prev) => ({ ...prev, [key]: opt?.value ?? "" }));

  const quiet = { showErrorMessage: false };
  const { lookups: statuses } = useLookups("ticket_status", quiet);
  const { lookups: priorities } = useLookups("priority", quiet);
  const { lookups: categories } = useLookups("ticket_category", quiet);
  const { lookups: channels } = useLookups("ticket_channel", quiet);
  const { data: usersData } = useUsers({ PageSize: 1000 });
  const { data: productsData } = useApiQuery({ queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, showErrorMessage: false });
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });

  const opts = {
    status: useMemo(() => statuses.map((s) => ({ value: s.Id, label: s.Value })), [statuses]),
    priority: useMemo(() => priorities.map((p) => ({ value: p.Id, label: p.Value })), [priorities]),
    category: useMemo(() => categories.map((c) => ({ value: c.Id, label: c.Value })), [categories]),
    channel: useMemo(() => channels.map((c) => ({ value: c.Id, label: c.Value })), [channels]),
    product: useMemo(() => (productsData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })), [productsData]),
    assignee: useMemo(() => (usersData?.users ?? []).map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })), [usersData]),
    branch: useMemo(() => (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })), [branchData]),
  };
  const optById = (list, v) => list.find((o) => o.value === v) ?? null;

  const overdueSx = { color: theme.tokens.error.main, fontWeight: 600 };
  const columns = useMemo(() => [
    { accessorKey: "TicketNo", header: "No.", enableSorting: true, size: 110 },
    { accessorKey: "Subject", header: "Subject", enableSorting: true, Cell: ({ cell }) => cell.getValue() || "—" },
    {
      accessorKey: "CustomerName", header: "Customer", enableSorting: true,
      // Name and mobile together: three spellings of one shop is exactly what
      // tblCustomer exists to fix, and the mobile is what tells them apart.
      Cell: ({ row }) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.original.CustomerName || "—"}</div>
          <div style={{ fontSize: 12, color: theme.tokens.text.secondary }}>{row.original.CustomerMobile || "—"}</div>
        </div>
      ),
    },
    {
      accessorKey: "StatusName", header: "Status", enableSorting: false,
      Cell: ({ row }) => <Chip label={row.original.StatusName || "—"} size="sm" tone={statusTone(row.original.StatusCode)} />,
    },
    {
      accessorKey: "PriorityName", header: "Priority", enableSorting: false,
      Cell: ({ cell }) => (cell.getValue() ? <Chip label={cell.getValue()} size="sm" tone="accent" variant="tonal" /> : "—"),
    },
    {
      accessorKey: "DueAt", header: "Due", enableSorting: true,
      Cell: ({ row }) => (
        <span data-testid={`ticket-due-${row.original.Id}`} style={row.original.IsOverdue ? overdueSx : undefined}>
          {dueLabel(row.original.DueAt, row.original.IsOverdue)}
        </span>
      ),
    },
    { accessorKey: "AssigneeName", header: "Assignee", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "Unassigned" },
    {
      id: "escalated", header: "", enableSorting: false, size: 52,
      Cell: ({ row }) => (row.original.EscalatedTo ? (
        <Tooltip title={`Escalated to ${row.original.EscalatedToName ?? "a senior"}`}>
          <span data-testid={`ticket-escalated-${row.original.Id}`} style={{ display: "inline-flex", color: theme.tokens.warning.main }}>
            <Flag size={15} />
          </span>
        </Tooltip>
      ) : "—"),
    },
    { accessorKey: "AgeHours", header: "Age", enableSorting: false, size: 70, Cell: ({ cell }) => ageLabel(cell.getValue()) },
  ], [theme, overdueSx.color]);

  // presetParams is spread LAST: on "My queue" it overwrites the assignee
  // filter with the caller's id, because that is what the tab means.
  const extraParams = useMemo(() => ({
    StatusId: num(filters.StatusId), Priority: num(filters.Priority), CategoryId: num(filters.CategoryId),
    ChannelId: num(filters.ChannelId), ProductId: num(filters.ProductId), AssignedTo: num(filters.AssignedTo),
    BranchId: num(filters.BranchId),
    ...(range.from ? { FromDate: range.from } : {}),
    ...(range.to ? { ToDate: range.to } : {}),
    ...presetParams(preset, userId),
  }), [filters, range, preset, userId]);

  const { table } = useServerTable({
    columns, queryKey: "tickets", endpoint: SUPPORT_ENDPOINTS.tickets.fetchTickets, dataKey: "tickets", extraParams,
    initialPageSize: 25, getRowId: (row) => row.Id,
    enableRowSelection: true, enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => setDetailTicketId(row.original.Id) }),
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="Open the complaint"><IconButton size="sm" variant="ghost" tone="primary" aria-label="View complaint" data-testid={`view-ticket-${row.original.Id}`} onClick={() => setDetailTicketId(row.original.Id)}><Eye size={16} /></IconButton></Tooltip>
        <Tooltip title="Edit details"><IconButton size="sm" variant="ghost" tone="info" aria-label="Edit complaint" data-testid={`edit-ticket-${row.original.Id}`} onClick={() => setEditTicket(row.original)}><Pencil size={16} /></IconButton></Tooltip>
        <Tooltip title="Transfer / reassign"><IconButton size="sm" variant="ghost" tone="warning" aria-label="Transfer complaint" data-testid={`transfer-ticket-${row.original.Id}`} onClick={() => setTransferIds([row.original.Id])}><ArrowRightLeft size={16} /></IconButton></Tooltip>
        <Tooltip title="Delete"><IconButton size="sm" variant="ghost" tone="error" aria-label="Delete complaint" data-testid={`delete-ticket-${row.original.Id}`} onClick={() => setDeleteTarget(row.original)}><Trash2 size={16} /></IconButton></Tooltip>
      </Box>
    ),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  const selectedIds = Object.keys(table.getState?.()?.rowSelection ?? {}).map(Number);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Complaints"
        subtitle="Every complaint, who holds it, and when it is due."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {selectedIds.length > 0 && (
              <Button variant="tonal" size="sm" leftIcon={<Users size={14} />} onClick={() => setTransferIds(selectedIds)} data-testid="bulk-reassign-btn">
                Reassign {selectedIds.length}
              </Button>
            )}
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)} data-testid="new-ticket-btn">New Ticket</Button>
            <HelpGuide guide={HELP_GUIDES.tickets} />
          </Box>
        }
      />
      <Helmet><title>PRD Infotech | Complaints</title></Helmet>

      <Box sx={{ mt: 1 }}><Tabs value={preset} onChange={setPreset} items={TICKET_PRESETS} data-testid="ticket-presets" /></Box>

      <Box sx={{ display: "flex", gap: 1, mt: 1, mb: 0.5, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Box sx={{ width: 160 }}><Combobox size="sm" placeholder="All statuses" options={opts.status} value={optById(opts.status, filters.StatusId)} onChange={setFilterValue("StatusId")} data-testid="filter-status" /></Box>
        <Box sx={{ width: 150 }}><Combobox size="sm" placeholder="All priorities" options={opts.priority} value={optById(opts.priority, filters.Priority)} onChange={setFilterValue("Priority")} data-testid="filter-priority" /></Box>
        <Box sx={{ width: 160 }}><Combobox size="sm" placeholder="All categories" options={opts.category} value={optById(opts.category, filters.CategoryId)} onChange={setFilterValue("CategoryId")} data-testid="filter-category" /></Box>
        <Box sx={{ width: 150 }}><Combobox size="sm" placeholder="All channels" options={opts.channel} value={optById(opts.channel, filters.ChannelId)} onChange={setFilterValue("ChannelId")} data-testid="filter-channel" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All products" options={opts.product} value={optById(opts.product, filters.ProductId)} onChange={setFilterValue("ProductId")} data-testid="filter-product" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All assignees" options={opts.assignee} value={optById(opts.assignee, filters.AssignedTo)} onChange={setFilterValue("AssignedTo")} data-testid="filter-assignee" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All branches" options={opts.branch} value={optById(opts.branch, filters.BranchId)} onChange={setFilterValue("BranchId")} data-testid="filter-branch" /></Box>
        <Box sx={{ width: 150 }}><DateField size="sm" label="Raised from" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} data-testid="tickets-from" /></Box>
        <Box sx={{ width: 150 }}><DateField size="sm" label="Raised to" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} data-testid="tickets-to" /></Box>
      </Box>

      <Box sx={{ width: "100%", overflowX: "auto" }}><MaterialReactTable table={table} /></Box>

      <TicketCreateModal
        open={createOpen || Boolean(editTicket)}
        ticket={editTicket}
        onClose={() => { setCreateOpen(false); setEditTicket(null); }}
        onSaved={(res) => { if (createOpen && res?.Id) setDetailTicketId(res.Id); }}
      />
      <TicketDetailModal ticketId={detailTicketId} open={Boolean(detailTicketId)} onClose={() => setDetailTicketId(null)} />
      <TransferTicketModal open={transferIds.length > 0} ticketIds={transferIds} onClose={() => setTransferIds([])} onDone={() => table.resetRowSelection?.()} />
      <DeleteTicketModal open={Boolean(deleteTarget)} ticketId={deleteTarget?.Id} ticketNo={deleteTarget?.TicketNo} onClose={() => setDeleteTarget(null)} />
    </Box>
  );
};

export default Tickets;
```

The `refetch()` the old page ran on modal close is gone: every mutation in the
module invalidates `["tickets"]` (`TransferTicketModal` above, `DeleteTicketModal.jsx:16`,
`TicketCreateModal` in Task 15, `TicketDetail` in Task 16), so React Query
refreshes the table on its own.

- [ ] **Step 5: Run each to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Support/TransferTicketModal.test.jsx --coverage --coverage.include=src/pages/Support/TransferTicketModal.jsx`
Expected: 5 passed; `TransferTicketModal.jsx` ≥ 90 % lines / branches.
Run: `cd web && pnpm exec vitest run src/pages/Support/Tickets.test.jsx --coverage --coverage.include=src/pages/Support/Tickets.jsx`
Expected: 12 passed; `Tickets.jsx` ≥ 85 % lines / branches.

- [ ] **Step 6: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 15: `TicketCreateModal` (create + edit, customer picker)

**Files:**
- Modify: `web/src/pages/Support/TicketCreateModal.jsx` (whole file — 269 lines today: `:16-24` the hardcoded `CHANNEL_OPTIONS`, `:36-47` the loose `customerName`/`contact` state, `:104-111` `canSubmit`, `:113-147` the `PipelineId`/`StageId`/`CustomerName` payload, `:167-226` the form fields)
- Modify: `web/src/pages/Support/TicketCreateModal.test.jsx` (whole file — 188 lines today; it asserts `Channel: "email"`, `PipelineId: null`, `StageId: null`)

**Interfaces:**
- Consumes: `SUPPORT_ENDPOINTS.tickets.{saveTicket, fetchTicketDetail}` (Task 11); `SUPPORT_ENDPOINTS.config.fetchCustomFields` (= `SALES_ENDPOINTS.config.fetchCustomFields` after Task 12); `SALES_ENDPOINTS.products.fetchProducts`; `CustomerPicker({ value, onChange, error })` (Task 13 — `value` is any row with `{ Id, Name, Mobile?, Email? }`, `onChange(row | null)`, and it keeps a value that the search did not return); `useLookups`, `useAssignableUsers`, `useApiQuery`, `useApiMutation`; `DynamicField` (`components/DynamicField.jsx` — `{ field: {Id,Label,Type,Options,IsRequired}, value, onChange }`); `Attachments` (`components/Attachments.jsx`, staged mode when `entityId` is null; imperative `uploadStaged(newId)` → `{ uploaded, failed }`); `Modal`, `Button`, `TextInput`, `TextArea`, `Combobox`; `formatDateTime` (`utils/format.js`); `react-hook-form` + `zod` + `@hookform/resolvers/zod` (the `LeadCreateModal.jsx:28-45` pattern).
- Produces (Tasks 14 and 16 already render it):
  - `TicketCreateModal({ open, onClose, ticket = null, onSaved })` — `ticket` (any `sp_FetchTickets` / `sp_FetchTicketDetail` row) switches it to edit. `onSaved(res)` gets the save response (`{ Id, TicketNo, ResponseCode, ResponseMess }`).
  - Create body: `{ Id: 0, CustomerId, Subject, ContactPerson, Contact, ChannelId, CategoryId, Priority, ProductId, AssignedTo, LinkedLeadId, Description, CustomJSON }`. Edit body: the same **without `AssignedTo`** and with `Id: ticket.Id`. Neither ever carries `StatusId`, `PipelineId`, `StageId`, `CustomerName` or `Channel`.
  - Test ids: `create-ticket-modal`, `customer-picker` (from Task 13), `ticket-subject`, `ticket-category`, `ticket-priority`, `ticket-channel`, `ticket-product`, `ticket-contact-person`, `ticket-contact`, `ticket-assignee`, `ticket-description`, `ticket-attachments`, `create-ticket-submit`.

Decisions stated here (the spec is silent):
1. **Validation is RHF + Zod, and the submit button is never disabled.** The old modal disabled the button until seven fields were filled, which says "no" without saying why. `CustomerPicker` takes an `error` prop precisely so the refusal can be shown on the control. Only `Customer` and `Subject` are required — everything else is optional, as `sp_SaveTicket` has it.
2. **Custom fields are edited here, on both paths** (plan ambiguity 10). That is what lets Task 16 delete `TicketDetail`'s "re-send every fixed column to save a custom field" block. The stored values come from the modal's own `fetchTicketDetail` query under the key `["ticket-detail", id]` — **the same key `TicketDetail` uses**, so opening the editor from the detail page is a cache hit, not a second round-trip.
3. **Attachments only on create** (staged, uploaded after the insert). On edit they live on the detail page's own Attachments card; two upload surfaces for one record is how you get two half-lists.
4. **Picking a customer overwrites "Reported by".** A fresh customer means a fresh person; the two fields exist to be corrected afterwards, and silently keeping the previous customer's contact person is worse than re-typing.
5. **The priority hint tells the truth on both paths**: on create it is the due date that will be stamped, on edit it either shows the current `DueAt` (priority unchanged) or says the date will be re-stamped (`sp_SaveTicket` re-anchors from `CreatedAt`, so the modal cannot compute it).

Two repo facts these tests rely on: (a) `beforeEach(() => { mock.mockReset(); })` **needs the braces** — vitest treats a hook's return value as its cleanup function and `mockReset()` returns the mock, which vitest would then call after every test; (b) there is no Vite proxy any more — `apiClient` sets `baseURL` from `useAuthStore.API_BASE_URL`, and MSW matches on `*/api/…` either way, so the `useAuthStore.setState` in `beforeEach` is there only because `Attachments` and the axios interceptors read the store, not to make the request match.

- [ ] **Step 1: Write the failing tests**

```jsx
// web/src/pages/Support/TicketCreateModal.test.jsx   (replaces the whole file)
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import dayjs from "dayjs";

import TicketCreateModal from "./TicketCreateModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import {
  json, refuse, ticketRow, ticketDetail, customerRow,
  mockSupportRefData, mockTicketEndpoints, mockCustomerEndpoints,
} from "../../test/supportMocks";

const DEFS = [
  { Id: 55, Label: "Account #", Type: "text", Options: null, IsRequired: false, SortOrder: 1 },
  { Id: 56, Label: "VIP", Type: "checkbox", Options: null, IsRequired: false, SortOrder: 2 },
  { Id: 57, Label: "Tier", Type: "dropdown", Options: '["A","B"]', IsRequired: false, SortOrder: 3 },
];
const mockDefs = (defs = DEFS) =>
  server.use(http.post("*/api/config/fetchCustomFields", () => json({ customFields: defs })));

const renderModal = (props = {}) =>
  renderWithProviders(<TicketCreateModal open onClose={vi.fn()} onSaved={vi.fn()} {...props} />, { router: false });

const pick = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name }));
};

describe("TicketCreateModal — create", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
    mockCustomerEndpoints({}, { customers: [customerRow()] });
  });

  it("posts the whole sp_SaveTicket shape with Id 0 and nothing from the stage era", async () => {
    const cap = mockTicketEndpoints();
    mockDefs();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSaved, onClose });
    const user = userEvent.setup();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    await user.type(screen.getByTestId("ticket-subject"), "  Screen flickers on boot ");
    await pick(user, "ticket-category", "Billing");
    await pick(user, "ticket-priority", "High");
    await pick(user, "ticket-channel", "Phone");
    await pick(user, "ticket-product", "Gold Chain 22K");
    await pick(user, "ticket-assignee", "Sara Khan");
    await user.type(screen.getByTestId("ticket-description"), "Flickers for a minute after power-on.");
    await user.click(screen.getByTestId("create-ticket-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toEqual({
      Id: 0, CustomerId: 3, Subject: "Screen flickers on boot",
      ContactPerson: "Gurpreet", Contact: "9990001111",
      ChannelId: 71, CategoryId: 6, Priority: 3, ProductId: 1,
      AssignedTo: 18, LinkedLeadId: null,
      Description: "Flickers for a minute after power-on.",
      CustomJSON: JSON.stringify([
        { fieldId: 55, type: "text", value: "" },
        { fieldId: 56, type: "checkbox", value: false },
        { fieldId: 57, type: "dropdown", value: null },
      ]),
    });
    // CompId/BranchId/UserId are injected server-side; the lifecycle is the
    // SP's (first 'open' status) and the pipeline engine is gone.
    for (const key of ["CompId", "UserId", "StatusId", "PipelineId", "StageId", "CustomerName", "Channel"]) {
      expect(cap.save).not.toHaveProperty(key);
    }
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ Id: 909, TicketNo: "TKT-0909" }));
    expect(onClose).toHaveBeenCalled();
  }, 20000);

  it("refuses without a customer, then without a subject", async () => {
    const cap = mockTicketEndpoints();
    renderModal();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("create-ticket-submit"));
    expect(await screen.findByText("Pick a customer")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    await user.click(screen.getByTestId("create-ticket-submit"));
    expect(await screen.findByText("Subject is required")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();

    await user.type(screen.getByTestId("ticket-subject"), "Invoice mismatch");
    await user.click(screen.getByTestId("create-ticket-submit"));
    await waitFor(() => expect(cap.save).toMatchObject({ Id: 0, CustomerId: 3, Subject: "Invoice mismatch" }));
    // Everything else is optional — sp_SaveTicket takes NULL for all of it.
    expect(cap.save).toMatchObject({ CategoryId: null, Priority: null, ChannelId: null, ProductId: null, AssignedTo: null, Description: null });
  }, 20000);

  // Spec §4: "Reported by (prefilled from the customer)". The agent should not
  // retype what tblCustomer already knows.
  it("picking a customer prefills Reported by from that customer", async () => {
    mockTicketEndpoints();
    mockCustomerEndpoints({}, { customers: [customerRow(), customerRow({ Id: 4, Name: "Zenith Traders", ContactPerson: "Meera", Mobile: null, Email: "zen@example.com" })] });
    renderModal();
    const user = userEvent.setup();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    expect(screen.getByTestId("ticket-contact-person")).toHaveValue("Gurpreet");
    expect(screen.getByTestId("ticket-contact")).toHaveValue("9990001111");

    // A different customer means a different person — the old values go.
    await pick(user, "customer-picker", "Zenith Traders · zen@example.com");
    expect(screen.getByTestId("ticket-contact-person")).toHaveValue("Meera");
    expect(screen.getByTestId("ticket-contact")).toHaveValue("zen@example.com");
  }, 20000);

  // Spec §4: "Priority (shows 'due by')" — the priority IS the due date, and
  // an agent picking one should see what they just promised.
  it("shows the due date the picked priority will stamp", async () => {
    mockTicketEndpoints();
    renderModal();
    const user = userEvent.setup();

    expect(screen.getByText("The priority sets the due date")).toBeInTheDocument();
    await pick(user, "ticket-priority", "High");              // TatHours 24
    expect(await screen.findByText(new RegExp(`Due by ${dayjs().add(24, "hour").format("DD-MM-YYYY")}`))).toBeInTheDocument();
    await pick(user, "ticket-priority", "Low");               // TatHours 168
    expect(await screen.findByText(new RegExp(`Due by ${dayjs().add(168, "hour").format("DD-MM-YYYY")}`))).toBeInTheDocument();
  });

  it("keeps the modal open and shows the server's refusal", async () => {
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/saveTicket", () => refuse("Customer not found", 404)));
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    await user.type(screen.getByTestId("ticket-subject"), "Invoice mismatch");
    await user.click(screen.getByTestId("create-ticket-submit"));

    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-ticket-modal")).toBeInTheDocument();
  }, 20000);
});

describe("TicketCreateModal — edit", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
    mockCustomerEndpoints({}, { customers: [customerRow()] });
  });

  it("prefills every field, posts the Id, and never sends AssignedTo or a status", async () => {
    const cap = mockTicketEndpoints({}, {
      detail: ticketDetail({ fields: [{ FieldId: 55, FieldKey: "acct", Label: "Account #", Type: "text", ValueText: "ACC-1", ValueNumber: null, ValueDate: null }] }),
    });
    mockDefs();
    const onSaved = vi.fn();
    renderModal({ ticket: ticketRow({ LinkedLeadId: 11 }), onSaved });
    const user = userEvent.setup();

    expect(screen.getByText("Edit complaint")).toBeInTheDocument();
    expect(screen.getByTestId("customer-picker-input")).toHaveValue("Acme Corp · 9990001111");
    expect(screen.getByTestId("ticket-subject")).toHaveValue("Screen flickers on boot");
    expect(screen.getByTestId("ticket-category-input")).toHaveValue("Billing");
    expect(screen.getByTestId("ticket-priority-input")).toHaveValue("High");
    expect(screen.getByTestId("ticket-channel-input")).toHaveValue("Phone");
    expect(screen.getByTestId("ticket-contact-person")).toHaveValue("Gurpreet");
    expect(screen.getByTestId("ticket-description")).toHaveValue("Flickers for a minute after power-on.");
    // The stored custom value arrives with the detail, not with the row.
    expect(await screen.findByLabelText("Account #")).toHaveValue("ACC-1");

    await user.clear(screen.getByTestId("ticket-subject"));
    await user.type(screen.getByTestId("ticket-subject"), "Screen flickers and clicks");
    await user.click(screen.getByTestId("create-ticket-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({
      Id: 7, CustomerId: 3, Subject: "Screen flickers and clicks",
      CategoryId: 6, Priority: 3, ChannelId: 71, LinkedLeadId: 11,
    });
    // Transfer is the only way to move a complaint; the status dropdown is the
    // only way to move its lifecycle. Neither belongs in a save.
    expect(cap.save).not.toHaveProperty("AssignedTo");
    expect(cap.save).not.toHaveProperty("StatusId");
    expect(JSON.parse(cap.save.CustomJSON)).toEqual([
      { fieldId: 55, type: "text", value: "ACC-1" },
      { fieldId: 56, type: "checkbox", value: false },
      { fieldId: 57, type: "dropdown", value: null },
    ]);
    expect(onSaved).toHaveBeenCalled();
  }, 20000);

  it("hides the assignee picker and the attachments panel", async () => {
    mockTicketEndpoints();
    renderModal({ ticket: ticketRow() });
    expect(await screen.findByTestId("ticket-subject")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-assignee-input")).toBeNull();
    expect(screen.queryByTestId("ticket-attachments")).toBeNull();
  });

  it("says what changing the priority does to the due date", async () => {
    mockTicketEndpoints();
    renderModal({ ticket: ticketRow() });   // Priority 3 (High), DueAt 2026-09-16
    const user = userEvent.setup();

    expect(await screen.findByText(/^Due 16-09-2026/)).toBeInTheDocument();
    await pick(user, "ticket-priority", "Low");
    expect(await screen.findByText("Due date re-stamped to 168h from when it was raised")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Support/TicketCreateModal.test.jsx`
Expected: FAIL — `Unable to find an element by: [data-testid="customer-picker-input"]` on the first test (the modal still renders a free-text `ticket-customer` TextInput), and `cap.save` carries `CustomerName`/`Channel`/`PipelineId`/`StageId`.

- [ ] **Step 3: Implement**

Replace the whole of `web/src/pages/Support/TicketCreateModal.jsx`:

```jsx
// src/pages/Support/TicketCreateModal.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { enqueueSnackbar } from "notistack";
import { Pencil, Plus } from "lucide-react";
import dayjs from "dayjs";

import { Modal, Button, TextInput, TextArea, Combobox } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatDateTime } from "../../utils/format";
import CustomerPicker from "./CustomerPicker";

// Only the columns sp_SaveTicket takes (spec 2 §3). CompId/BranchId/UserId are
// injected server-side; the status is the SP's (first 'open' on insert, never
// touched on update) and the assignee moves only through a transfer.
const schema = z.object({
  Customer: z.any().refine((v) => Boolean(v?.Id), { message: "Pick a customer" }),
  Subject: z.string().trim().min(1, "Subject is required"),
  ContactPerson: z.string().optional(),
  Contact: z.string().optional(),
  ChannelId: z.number().nullable().optional(),
  CategoryId: z.number().nullable().optional(),
  Priority: z.number().nullable().optional(),
  ProductId: z.number().nullable().optional(),
  AssignedTo: z.number().nullable().optional(),
  Description: z.string().optional(),
});

const EMPTY = {
  Customer: null, Subject: "", ContactPerson: "", Contact: "",
  ChannelId: null, CategoryId: null, Priority: null, ProductId: null,
  AssignedTo: null, Description: "",
};

// A ticket row (sp_FetchTickets or sp_FetchTicketDetail) onto the form shape.
// The customer trio is enough for CustomerPicker to render its own label.
const ticketToForm = (t) => ({
  Customer: t.CustomerId ? { Id: t.CustomerId, Name: t.CustomerName, Mobile: t.CustomerMobile, Email: t.CustomerEmail } : null,
  Subject: t.Subject ?? "",
  ContactPerson: t.ContactPerson ?? "",
  Contact: t.Contact ?? "",
  ChannelId: t.ChannelId ?? null,
  CategoryId: t.CategoryId ?? null,
  Priority: t.Priority ?? null,
  ProductId: t.ProductId ?? null,
  AssignedTo: null,
  Description: t.Description ?? "",
});

// fetchTicketDetail's RS2 carries the stored value columns only; the field's
// own Type comes with it, so this maps a row onto DynamicField's value shape.
const fieldValue = (def, valueRow) => {
  if (!valueRow) return def.Type === "checkbox" ? false : def.Type === "dropdown" ? null : "";
  switch (def.Type) {
    case "number": return valueRow.ValueNumber ?? "";
    case "date": return valueRow.ValueDate ?? "";
    case "checkbox": return Boolean(valueRow.ValueNumber);
    case "dropdown": return valueRow.ValueText ?? null;
    default: return valueRow.ValueText ?? "";
  }
};

const clean = (s) => (s?.trim() ? s.trim() : null);

/**
 * Creates or edits a complaint via sp_SaveTicket (@Id=0 insert, @Id>0 update).
 * Pass a `ticket` row to edit it.
 *
 * Custom fields are edited here on BOTH paths — that is what lets the detail
 * page stop re-sending every fixed column just to save one custom value (the
 * SP's UPDATE writes all of them, so a partial body blanked whatever it left
 * out). The stored values come from this modal's own fetchTicketDetail query,
 * under the same ["ticket-detail", id] key the detail page uses, so opening
 * the editor from there is a cache hit rather than a second round-trip.
 */
export default function TicketCreateModal({ open, onClose, ticket = null, onSaved }) {
  const isEdit = Boolean(ticket?.Id);
  const { control, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const [custom, setCustom] = useState({});
  const attachmentsRef = useRef(null);

  const whileOpen = { enabled: open, showErrorMessage: false };
  const { lookups: categories } = useLookups("ticket_category", whileOpen);
  const { lookups: priorities } = useLookups("priority", whileOpen);
  const { lookups: channels } = useLookups("ticket_channel", whileOpen);
  const { users } = useAssignableUsers({ enabled: open && !isEdit });

  const { data: productsData } = useApiQuery({
    queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts,
    params: { PageSize: 200, IsActive: true }, enabled: open, showErrorMessage: false,
  });
  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "ticket"], endpoint: SUPPORT_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "ticket" }, enabled: open, showErrorMessage: false,
  });
  const { data: detailData } = useApiQuery({
    queryKey: ["ticket-detail", ticket?.Id], endpoint: SUPPORT_ENDPOINTS.tickets.fetchTicketDetail,
    params: { TicketId: ticket?.Id }, enabled: open && isEdit, showErrorMessage: false,
  });

  const opts = {
    category: useMemo(() => categories.map((c) => ({ value: c.Id, label: c.Value })), [categories]),
    priority: useMemo(() => priorities.map((p) => ({ value: p.Id, label: p.Value })), [priorities]),
    channel: useMemo(() => channels.map((c) => ({ value: c.Id, label: c.Value })), [channels]),
    product: useMemo(() => (productsData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })), [productsData]),
    assignee: useMemo(() => users.map((u) => ({ value: u.Id, label: u.FullName })), [users]),
  };
  const byId = (list, v) => list.find((o) => o.value === v) ?? null;

  // Definitions drive rendering (order, Options, blank fields still show);
  // the detail's values just seed the draft.
  const fieldRows = useMemo(() => {
    const defs = defsData?.customFields ?? [];
    const valueByFieldId = new Map((detailData?.fields ?? []).map((v) => [v.FieldId, v]));
    return defs.map((def) => ({ def, valueRow: valueByFieldId.get(def.Id) }));
  }, [defsData, detailData]);

  useEffect(() => {
    if (!open) return;
    reset(isEdit ? ticketToForm(ticket) : EMPTY);
  }, [open, isEdit, ticket, reset]);

  useEffect(() => {
    if (!open) return;
    const seeded = {};
    fieldRows.forEach(({ def, valueRow }) => { seeded[def.Id] = fieldValue(def, valueRow); });
    setCustom(seeded);
  }, [open, fieldRows]);

  // The priority IS the due date (spec §2 TAT). Say what the pick does — on
  // create the modal can compute it, on edit sp_SaveTicket re-anchors from the
  // original CreatedAt, so it says so rather than guessing.
  const priorityId = watch("Priority");
  const tat = priorities.find((p) => p.Id === priorityId)?.TatHours ?? null;
  const dueHint =
    !priorityId ? "The priority sets the due date"
      : tat == null ? "This priority has no due date"
        : !isEdit ? `Due by ${dayjs().add(tat, "hour").format("DD-MM-YYYY HH:mm")}`
          : priorityId === ticket?.Priority ? `Due ${formatDateTime(ticket?.DueAt, { empty: "—" })}`
            : `Due date re-stamped to ${tat}h from when it was raised`;

  const saveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.saveTicket,
    successMessage: isEdit ? "Complaint updated" : "Complaint created",
    invalidateQueries: [["tickets"], ["ticket-detail"], ["customer-detail"]],
  });

  const handleClose = () => {
    if (saveMutation.isPending) return;
    reset(EMPTY);
    setCustom({});
    onClose?.();
  };

  const onSubmit = async (v) => {
    const body = {
      Id: ticket?.Id ?? 0,
      CustomerId: v.Customer.Id,
      Subject: v.Subject.trim(),
      ContactPerson: clean(v.ContactPerson),
      Contact: clean(v.Contact),
      ChannelId: v.ChannelId ?? null,
      CategoryId: v.CategoryId ?? null,
      Priority: v.Priority ?? null,
      ProductId: v.ProductId ?? null,
      // Assignment moves only through a transfer; the SP ignores @AssignedTo
      // on update, and sending it would still be a lie about intent.
      ...(isEdit ? {} : { AssignedTo: v.AssignedTo ?? null }),
      LinkedLeadId: ticket?.LinkedLeadId ?? null,
      Description: clean(v.Description),
      CustomJSON: JSON.stringify(fieldRows.map(({ def }) => ({ fieldId: def.Id, type: def.Type, value: custom[def.Id] }))),
    };
    try {
      const saved = await saveMutation.mutateAsync(body);
      if (!isEdit && saved?.Id && attachmentsRef.current?.stagedCount) {
        const { failed } = await attachmentsRef.current.uploadStaged(saved.Id);
        if (failed) enqueueSnackbar(`${failed} file(s) failed to upload — add them from the complaint`, { variant: "warning" });
      }
      reset(EMPTY);
      setCustom({});
      onSaved?.(saved);
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="lg" data-testid="create-ticket-modal">
      <Modal.Header
        title={isEdit ? "Edit complaint" : "New complaint"}
        subtitle={isEdit ? undefined : "Find the customer by mobile or name — or create them here."}
        icon={isEdit ? <Pencil size={18} /> : <Plus size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <form
          id="ticket-form"
          onSubmit={handleSubmit(onSubmit)}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, rowGap: 14 }}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <Controller
              control={control}
              name="Customer"
              render={({ field }) => (
                <CustomerPicker
                  value={field.value}
                  error={errors.Customer?.message}
                  onChange={(row) => {
                    field.onChange(row);
                    // A fresh customer means a fresh person to call back.
                    setValue("ContactPerson", row?.ContactPerson ?? "");
                    setValue("Contact", row?.Mobile ?? row?.Email ?? "");
                  }}
                />
              )}
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <Controller
              control={control}
              name="Subject"
              render={({ field }) => (
                <TextInput
                  label="Subject" required value={field.value} onChange={field.onChange} onBlur={field.onBlur}
                  error={errors.Subject?.message} placeholder="One line — what is wrong" data-testid="ticket-subject"
                />
              )}
            />
          </div>

          <Controller control={control} name="CategoryId" render={({ field }) => (
            <Combobox label="Category" options={opts.category} value={byId(opts.category, field.value)}
              onChange={(o) => field.onChange(o?.value ?? null)} placeholder="Pick a category" data-testid="ticket-category" />
          )} />
          <Controller control={control} name="Priority" render={({ field }) => (
            <Combobox label="Priority" options={opts.priority} value={byId(opts.priority, field.value)}
              onChange={(o) => field.onChange(o?.value ?? null)} placeholder="Pick a priority" hint={dueHint} data-testid="ticket-priority" />
          )} />
          <Controller control={control} name="ChannelId" render={({ field }) => (
            <Combobox label="Channel" options={opts.channel} value={byId(opts.channel, field.value)}
              onChange={(o) => field.onChange(o?.value ?? null)} placeholder="How it came in" data-testid="ticket-channel" />
          )} />
          <Controller control={control} name="ProductId" render={({ field }) => (
            <Combobox label="Product" options={opts.product} value={byId(opts.product, field.value)}
              onChange={(o) => field.onChange(o?.value ?? null)} placeholder="Which product" data-testid="ticket-product" />
          )} />
          <Controller control={control} name="ContactPerson" render={({ field }) => (
            <TextInput label="Reported by" value={field.value} onChange={field.onChange} onBlur={field.onBlur}
              placeholder="Who called" data-testid="ticket-contact-person" />
          )} />
          <Controller control={control} name="Contact" render={({ field }) => (
            <TextInput label="Their number / email" value={field.value} onChange={field.onChange} onBlur={field.onBlur}
              placeholder="If different from the customer's" data-testid="ticket-contact" />
          )} />
          {/* Assignment on create only — afterwards it moves through Transfer,
              which writes a reason and remarks into the history. */}
          {!isEdit && (
            <Controller control={control} name="AssignedTo" render={({ field }) => (
              <Combobox label="Assign to" options={opts.assignee} value={byId(opts.assignee, field.value)}
                onChange={(o) => field.onChange(o?.value ?? null)} placeholder="Leave blank for the queue" data-testid="ticket-assignee" />
            )} />
          )}

          <div style={{ gridColumn: "1 / -1" }}>
            <Controller control={control} name="Description" render={({ field }) => (
              <TextArea label="Description" value={field.value} onChange={field.onChange} onBlur={field.onBlur}
                rows={4} placeholder="What is the customer reporting?" data-testid="ticket-description" />
            )} />
          </div>

          {fieldRows.map(({ def }) => (
            <DynamicField key={def.Id} field={def} value={custom[def.Id]} onChange={(v) => setCustom((c) => ({ ...c, [def.Id]: v }))} />
          ))}

          {/* Staged on create, uploaded once the complaint has an id. On edit
              they live on the detail page — one upload surface per record. */}
          {!isEdit && (
            <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 10 }} data-testid="ticket-attachments">
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Attachments</h3>
              <Attachments ref={attachmentsRef} entity="ticket" entityId={null} />
            </div>
          )}
        </form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={saveMutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit(onSubmit)} loading={saveMutation.isPending} data-testid="create-ticket-submit">
          {isEdit ? "Save changes" : "Create complaint"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

- [ ] **Step 4: Run to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Support/TicketCreateModal.test.jsx --coverage --coverage.include=src/pages/Support/TicketCreateModal.jsx`
Expected: 8 passed; `TicketCreateModal.jsx` ≥ 85 % lines / branches.

- [ ] **Step 5: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 16: `TicketDetail` + `ResolveTicketModal` + `RemarksModal` + `EscalateTicketModal` + `Timeline` types

**Files:**
- Create: `web/src/pages/Support/RemarksModal.jsx`, `web/src/pages/Support/RemarksModal.test.jsx`
- Create: `web/src/pages/Support/ResolveTicketModal.jsx`, `web/src/pages/Support/ResolveTicketModal.test.jsx`
- Create: `web/src/pages/Support/EscalateTicketModal.jsx`, `web/src/pages/Support/EscalateTicketModal.test.jsx`
- Modify: `web/src/pages/Support/TicketDetail.jsx` (whole file — 454 lines today: `:90-104` the client-side id→name resolution and the `fetchPipelines` query, `:122-130` `stageName` / `isResolved` / `isClosed`, `:150-165` four one-shot mutations, `:167-195` `saveCustomFields` re-sending every fixed column, `:236-281` the Resolve / Close / Reopen button set, `:308-354` the facts card, `:356-398` the editable custom-field card, `:424-451` the resolve modal)
- Modify: `web/src/pages/Support/TicketDetail.test.jsx` (whole file — 392 lines today; it mocks `/api/config/fetchPipelines` and asserts on `ticket-stage-chip`)
- Modify: `web/src/pages/Sales/Timeline.jsx:1-18` (imports + the type map), `:38-55` (item building), `:79-118` (the item render)
- Modify: `web/src/pages/Sales/Timeline.test.jsx` (append one describe)

**Interfaces:**
- Consumes: `SUPPORT_ENDPOINTS.tickets.{fetchTicketDetail, setTicketStatus, escalateTicket, fetchEscalationTargets}` and `SUPPORT_ENDPOINTS.calls.fetchCalls` (Task 11); `statusTone`, `dueLabel`, `isActiveCode`, `isTerminalCode` (`./ticketStatus`, Task 11); `TransferTicketModal({ open, onClose, ticketIds, onDone })` (Task 14); `TicketCreateModal({ open, onClose, ticket, onSaved })` (Task 15); `useLookups`, `useApiQuery`, `useApiMutation`; `PageHeader`, `Card`, `Chip`, `Button`, `Tabs`, `Skeleton`, `Combobox`, `TextArea`, `Modal` from `components/ui`; `Attachments`; `Timeline` and `LogCallModal` from `pages/Sales/`; `formatDate`, `formatDateTime`.
- Produces:
  - `RemarksModal({ open, onClose, title, subtitle, submitLabel = "Save", required = true, onSubmit, busy = false })` — `onSubmit(trimmedRemarks)`. It owns no endpoint. Test ids: `remarks-modal`, `remarks-input`, `remarks-submit`.
  - `ResolveTicketModal({ open, onClose, ticket, status, onDone })` — resolution (`resolution` lookup) + remarks; posts `setTicketStatus { TicketId, StatusId: status.value, ResolutionId, Remarks }`. Test ids: `resolve-ticket-modal`, `resolution-combobox`, `resolve-remarks`, `resolve-submit`.
  - `EscalateTicketModal({ open, onClose, ticket, onDone })` — senior (`fetchEscalationTargets { ForUserId: ticket.AssignedTo ?? null }`) + remarks; posts `escalateTicket { TicketId, ToUserId, Remarks }`. Test ids: `escalate-ticket-modal`, `escalate-target`, `escalate-remarks`, `escalate-submit`.
  - `TicketDetail({ ticketId })` — header with the status `Combobox`, four buttons, the customer card, Details / Timeline tabs. Test ids: `ticket-detail`, `ticket-detail-loading`, `ticket-status-select`, `ticket-status-chip`, `ticket-priority-chip`, `ticket-due-chip`, `ticket-escalated-chip`, `ticket-customer-card`, `ticket-previous-complaints`, `log-call-btn`, `transfer-ticket-btn`, `escalate-ticket-btn`, `edit-ticket-btn`, `ticket-detail-tabs`, `ticket-core-info`, `ticket-custom-fields`, `assignment-item`.
  - `Timeline` gains a type → `{ label, Icon, tone }` map covering `created · updated · status · assigned · resolved · closed · rejected · reopened · escalated · call`, and each item carries `data-type`.

**Deviation from the plan's Contracts, stated once:** `ResolveTicketModal` takes one extra prop, `status` (the picked `{ value, label, code }`). The Contracts line reads `({ open, onClose, ticket, onDone })`, which would force the modal to guess which `resolved`-coded status the user picked — a company may define two, and `sp_ResolveTicket`'s "first `resolved` by SortOrder" would silently move the complaint to the wrong one. Passing the picked status keeps the brief's rule that **every** move goes through `setTicketStatus` with the id the user actually chose. `RemarksModal` also takes an optional `subtitle`; everything else matches.

Decisions stated here (the spec is silent):
1. **Straight-to-closed reuses `ResolveTicketModal`.** Spec §2 requires `ResolutionId` + remarks when moving to `closed` from an active status — exactly what that modal collects. Moving `resolved → closed` needs neither, so it posts directly.
2. **Custom fields are read-only here.** `sp_FetchTicketDetail` RS2 already carries `Label` and `Type` next to the value, so the page needs no `fetchCustomFields` round-trip and no draft state at all — editing them is Task 15's modal (plan ambiguity 10). That deletes the `saveCustomFields` block that re-sent eleven fixed columns to save one custom value.
3. **`AgeHours`, `DueAt`, `IsOverdue`, and every label come from the SP.** The page resolves nothing client-side; `useLookups` is used only for the status dropdown's options and the call outcomes the timeline needs.
4. **The 403 from the reopen gate surfaces twice** — `useApiMutation`'s `onError` shows the server's own message ("Reopening requires a manager") and the axios response interceptor (`utils/axiosConfig.js:82-87`) adds its generic "Access denied…" toast for every 403 in the app. The tests assert on the specific message and do not assert that only one toast appears; changing the global interceptor is out of scope for this spec.

- [ ] **Step 1: Write the failing tests for the three modals**

```jsx
// web/src/pages/Support/RemarksModal.test.jsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RemarksModal from "./RemarksModal";
import renderWithProviders from "../../test/renderWithProviders";

const renderModal = (props = {}) =>
  renderWithProviders(
    <RemarksModal open onClose={vi.fn()} title="Reject complaint" submitLabel="Reject" onSubmit={vi.fn()} {...props} />,
    { router: false },
  );

describe("RemarksModal", () => {
  it("refuses to submit without remarks and hands back the trimmed text", async () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    const user = userEvent.setup();

    expect(screen.getByText("Reject complaint")).toBeInTheDocument();
    expect(screen.getByTestId("remarks-submit")).toBeDisabled();
    await user.type(screen.getByTestId("remarks-input"), "   ");
    expect(screen.getByTestId("remarks-submit")).toBeDisabled();   // whitespace is not a remark

    await user.type(screen.getByTestId("remarks-input"), "  Never reproducible  ");
    await user.click(screen.getByTestId("remarks-submit"));
    expect(onSubmit).toHaveBeenCalledWith("Never reproducible");
  });

  it("allows an empty submit when the caller says remarks are optional", async () => {
    const onSubmit = vi.fn();
    renderModal({ required: false, submitLabel: "Close", onSubmit });
    await userEvent.setup().click(screen.getByTestId("remarks-submit"));
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("Cancel closes without submitting, and busy locks both buttons", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = renderModal({ onClose, onSubmit });
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<RemarksModal open busy onClose={onClose} title="Reject complaint" submitLabel="Reject" onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("renders nothing while closed", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("remarks-modal")).toBeNull();
  });
});
```

```jsx
// web/src/pages/Support/ResolveTicketModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import ResolveTicketModal from "./ResolveTicketModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { mockSupportRefData, mockTicketEndpoints, ticketRow, refuse } from "../../test/supportMocks";

const RESOLVED = { value: 64, label: "Resolved", code: "resolved" };

const renderModal = (props = {}) =>
  renderWithProviders(
    <ResolveTicketModal open onClose={vi.fn()} ticket={ticketRow()} status={RESOLVED} onDone={vi.fn()} {...props} />,
    { router: false },
  );

describe("ResolveTicketModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
  });

  // Spec §2: 'resolved' requires a ResolutionId AND remarks. The SP refuses
  // without them; refusing here says why before the round-trip.
  it("refuses without a resolution and without remarks, then posts the picked status", async () => {
    const cap = mockTicketEndpoints();
    const onDone = vi.fn();
    const onClose = vi.fn();
    renderModal({ onDone, onClose });
    const user = userEvent.setup();

    expect(screen.getByTestId("resolve-submit")).toBeDisabled();
    await user.click(screen.getByTestId("resolution-combobox-input"));
    await user.click(await screen.findByRole("option", { name: "Fixed" }));
    expect(screen.getByTestId("resolve-submit")).toBeDisabled();   // remarks still missing

    await user.type(screen.getByTestId("resolve-remarks"), "Replaced the panel connector");
    await user.click(screen.getByTestId("resolve-submit"));

    await waitFor(() => expect(cap.status).toBeTruthy());
    // The status the user picked — not "the first resolved one", which is what
    // sp_ResolveTicket would have chosen for a company with two of them.
    expect(cap.status).toEqual({ TicketId: 7, StatusId: 64, ResolutionId: 8, Remarks: "Replaced the panel connector" });
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("titles itself by the move it is fronting", async () => {
    mockTicketEndpoints();
    const { rerender } = renderModal();
    expect(await screen.findByText("Resolve complaint")).toBeInTheDocument();
    rerender(<ResolveTicketModal open onClose={vi.fn()} ticket={ticketRow()} status={{ value: 65, label: "Closed", code: "closed" }} onDone={vi.fn()} />);
    expect(screen.getByText("Close complaint")).toBeInTheDocument();
  });

  it("keeps the modal open and shows the server's refusal", async () => {
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/setTicketStatus", () => refuse("A resolution is required", 400)));
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("resolution-combobox-input"));
    await user.click(await screen.findByRole("option", { name: "Fixed" }));
    await user.type(screen.getByTestId("resolve-remarks"), "Done");
    await user.click(screen.getByTestId("resolve-submit"));

    expect(await screen.findByText("A resolution is required")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

```jsx
// web/src/pages/Support/EscalateTicketModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import EscalateTicketModal from "./EscalateTicketModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { json, refuse, mockSupportRefData, mockTicketEndpoints, ticketRow } from "../../test/supportMocks";

const renderModal = (props = {}) =>
  renderWithProviders(
    <EscalateTicketModal open onClose={vi.fn()} ticket={ticketRow()} onDone={vi.fn()} {...props} />,
    { router: false },
  );

describe("EscalateTicketModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
  });

  // Spec §2: the target must be an ancestor of the ASSIGNEE, not of the
  // caller — so the chain is fetched for the assignee.
  it("lists the assignee's chain, nearest first, and posts the escalation", async () => {
    const cap = mockTicketEndpoints();
    let askedFor;
    server.use(http.post("*/api/tickets/fetchEscalationTargets", async ({ request }) => {
      askedFor = await request.json();
      return json({ users: [
        { Id: 16, FullName: "Neha Verma", JobTitle: "Team Lead", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 1 },
        { Id: 15, FullName: "Rahul Mehta", JobTitle: "Branch Manager", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 2 },
      ] });
    }));
    const onDone = vi.fn();
    renderModal({ onDone });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("escalate-target-input"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Neha Verma · Team Lead", "Rahul Mehta · Branch Manager"]);
    expect(askedFor).toEqual({ ForUserId: 17 });

    await user.click(options[0]);
    await user.type(screen.getByTestId("escalate-remarks"), "Customer is threatening to cancel");
    await user.click(screen.getByTestId("escalate-submit"));

    await waitFor(() => expect(cap.escalate).toBeTruthy());
    expect(cap.escalate).toEqual({ TicketId: 7, ToUserId: 16, Remarks: "Customer is threatening to cancel" });
    expect(onDone).toHaveBeenCalled();
  });

  it("asks for the caller's own chain when nobody holds the complaint", async () => {
    mockTicketEndpoints();
    let askedFor;
    server.use(http.post("*/api/tickets/fetchEscalationTargets", async ({ request }) => {
      askedFor = await request.json();
      return json({ users: [] });
    }));
    renderModal({ ticket: ticketRow({ AssignedTo: null, AssigneeName: null }) });
    await waitFor(() => expect(askedFor).toEqual({ ForUserId: null }));
  });

  it("refuses without a target and without remarks, and surfaces the SP's refusal", async () => {
    const cap = mockTicketEndpoints();
    renderModal();
    const user = userEvent.setup();

    expect(screen.getByTestId("escalate-submit")).toBeDisabled();
    await user.click(screen.getByTestId("escalate-target-input"));
    await user.click(await screen.findByRole("option", { name: /Neha Verma/ }));
    expect(screen.getByTestId("escalate-submit")).toBeDisabled();   // remarks still missing
    expect(cap.escalate).toBeUndefined();

    server.use(http.post("*/api/tickets/escalateTicket", () => refuse("Only open complaints can be escalated", 400)));
    await user.type(screen.getByTestId("escalate-remarks"), "Please look at this");
    await user.click(screen.getByTestId("escalate-submit"));
    expect(await screen.findByText("Only open complaints can be escalated")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing `TicketDetail` + `Timeline` tests**

```jsx
// web/src/pages/Support/TicketDetail.test.jsx   (replaces the whole file)
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

// The four modals have their own test files; here they are stubs that report
// what TicketDetail handed them and let a test fire their callbacks.
vi.mock("./ResolveTicketModal", () => ({
  __esModule: true,
  default: ({ open, status }) => (open ? <div data-testid="resolve-modal">status:{status?.value}</div> : null),
}));
vi.mock("./RemarksModal", () => ({
  __esModule: true,
  default: ({ open, title, submitLabel, onSubmit, busy }) =>
    (open ? (
      <div data-testid="remarks-modal">
        <span>{title}</span><span>{submitLabel}</span>{busy ? <span>busy</span> : null}
        <button type="button" onClick={() => onSubmit("Customer called back")}>remarks-submit</button>
      </div>
    ) : null),
}));
vi.mock("./TransferTicketModal", () => ({ __esModule: true, default: ({ open, ticketIds }) => (open ? <div data-testid="transfer-modal">{ticketIds.join(",")}</div> : null) }));
vi.mock("./EscalateTicketModal", () => ({ __esModule: true, default: ({ open, ticket }) => (open ? <div data-testid="escalate-modal">ticket:{ticket?.Id}</div> : null) }));
vi.mock("./TicketCreateModal", () => ({ __esModule: true, default: ({ open, ticket }) => (open ? <div data-testid="ticket-form-modal">{ticket?.Id}</div> : null) }));
vi.mock("../Sales/LogCallModal", () => ({ __esModule: true, default: ({ open, ticketId }) => (open ? <div data-testid="log-call-modal">ticket:{ticketId}</div> : null) }));

import TicketDetail from "./TicketDetail";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { json, refuse, ticketRow, ticketDetail, mockSupportRefData, mockTicketEndpoints } from "../../test/supportMocks";

const renderDetail = () => renderWithProviders(<TicketDetail ticketId={7} />);
const pickStatus = async (user, name) => {
  await user.click(screen.getByTestId("ticket-status-select-input"));
  await user.click(await screen.findByRole("option", { name }));
};

describe("TicketDetail (spec 2)", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
  });

  it("shows the labels the SP returned — number, subject, status, priority, due", async () => {
    mockTicketEndpoints();
    renderDetail();
    expect(screen.getByTestId("ticket-detail-loading")).toBeInTheDocument();

    expect(await screen.findByText("TKT-0007")).toBeInTheDocument();
    expect(screen.getByText("Screen flickers on boot")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-status-chip")).toHaveTextContent("In Progress");
    expect(screen.getByTestId("ticket-priority-chip")).toHaveTextContent("High");
    expect(screen.getByTestId("ticket-due-chip")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-escalated-chip")).toBeNull();
    // Nothing on this page resolves an id into a name any more.
    expect(screen.getByTestId("ticket-core-info")).toHaveTextContent("Billing");
    expect(screen.getByTestId("ticket-core-info")).toHaveTextContent("Phone");
    expect(screen.getByTestId("ticket-core-info")).toHaveTextContent("Amit Singh");
  });

  it("an overdue, escalated complaint says so in the header", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({ ticket: ticketRow({ IsOverdue: 1, EscalatedTo: 16, EscalatedToName: "Neha Verma", PreviousTickets: 2 }) }),
    });
    renderDetail();
    expect(await screen.findByTestId("ticket-due-chip")).toHaveTextContent("overdue");
    expect(screen.getByTestId("ticket-escalated-chip")).toHaveTextContent("Neha Verma");
  });

  it("the customer card links to that customer's other complaints", async () => {
    mockTicketEndpoints({}, { detail: ticketDetail({ ticket: ticketRow({ PreviousTickets: 2, CustomerEmail: "acme@example.com", CustomerCity: "Pune" }) }) });
    renderDetail();
    const card = await screen.findByTestId("ticket-customer-card");
    expect(card).toHaveTextContent("Acme Corp");
    expect(card).toHaveTextContent("9990001111");
    expect(card).toHaveTextContent("acme@example.com");

    await userEvent.setup().click(screen.getByTestId("ticket-previous-complaints"));
    expect(mockNavigate).toHaveBeenCalledWith("/support/customers?customerId=3");
  });

  // Spec §2: open/onhold moves are free. One endpoint, always.
  it("moving between active statuses posts setTicketStatus straight away", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "On Hold");
    await waitFor(() => expect(cap.status).toEqual({ TicketId: 7, StatusId: 63, Remarks: null }));
  });

  it("re-picking the status it already has does nothing", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "In Progress");
    expect(cap.status).toBeUndefined();
  });

  it("a resolved status opens the resolve prompt with THAT status id", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "Resolved");
    expect(await screen.findByTestId("resolve-modal")).toHaveTextContent("status:64");
    expect(cap.status).toBeUndefined();
  });

  // Straight-to-closed needs a resolution too (spec §2), so it reuses the
  // same prompt; resolved -> closed needs neither and posts directly.
  it("closing an ACTIVE complaint asks for a resolution first", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "Closed");
    expect(await screen.findByTestId("resolve-modal")).toHaveTextContent("status:65");
    expect(cap.status).toBeUndefined();
  });

  it("closing a RESOLVED complaint posts straight away — the customer confirmed", async () => {
    const cap = mockTicketEndpoints({}, {
      detail: ticketDetail({ ticket: ticketRow({ StatusId: 64, StatusName: "Resolved", StatusCode: "resolved", ResolvedAt: "2026-09-16T09:00:00Z", ResolutionId: 8, ResolutionName: "Fixed" }) }),
    });
    renderDetail();
    await screen.findByTestId("ticket-detail");
    await pickStatus(userEvent.setup(), "Closed");
    await waitFor(() => expect(cap.status).toEqual({ TicketId: 7, StatusId: 65, Remarks: null }));
    expect(screen.queryByTestId("resolve-modal")).toBeNull();
  });

  it("a rejected status asks for remarks and posts them with the move", async () => {
    const cap = mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();
    await pickStatus(user, "Rejected");

    const modal = await screen.findByTestId("remarks-modal");
    expect(modal).toHaveTextContent("Reject complaint");
    expect(cap.status).toBeUndefined();

    await user.click(screen.getByText("remarks-submit"));
    await waitFor(() => expect(cap.status).toEqual({ TicketId: 7, StatusId: 66, Remarks: "Customer called back" }));
  });

  // Spec §2 + §6: reopening is a manager's act. The client always asks for
  // remarks; the server decides whether the caller may.
  it("reopening a closed complaint asks for remarks, and a 403 keeps the prompt open with the server's words", async () => {
    mockTicketEndpoints({}, { detail: ticketDetail({ ticket: ticketRow({ StatusId: 65, StatusName: "Closed", StatusCode: "closed", ClosedAt: "2026-09-16T12:00:00Z" }) }) });
    server.use(http.post("*/api/tickets/setTicketStatus", () => refuse("Reopening requires a manager", 403)));
    renderDetail();
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();

    await pickStatus(user, "In Progress");
    const modal = await screen.findByTestId("remarks-modal");
    expect(modal).toHaveTextContent("Reopen complaint");

    await user.click(screen.getByText("remarks-submit"));
    // The axios interceptor also toasts a generic "Access denied" for every
    // 403; what matters is that the SP's own sentence reaches the user.
    expect(await screen.findByText("Reopening requires a manager")).toBeInTheDocument();
    expect(screen.getByTestId("remarks-modal")).toBeInTheDocument();
  });

  it("the buttons open the call log, the transfer, the escalation and the editor", async () => {
    mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("log-call-btn"));
    expect(screen.getByTestId("log-call-modal")).toHaveTextContent("ticket:7");
    await user.click(screen.getByTestId("transfer-ticket-btn"));
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("7");
    await user.click(screen.getByTestId("escalate-ticket-btn"));
    expect(screen.getByTestId("escalate-modal")).toHaveTextContent("ticket:7");
    await user.click(screen.getByTestId("edit-ticket-btn"));
    expect(screen.getByTestId("ticket-form-modal")).toHaveTextContent("7");
  });

  it("the timeline tab shows the activity, the call and the assignment trail", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({
        activity: [
          { Id: 1, Type: "created", Summary: "Complaint created", CreatedAt: "2026-09-15T10:00:00Z", UserName: "Amit Singh" },
          { Id: 2, Type: "escalated", Summary: "Escalated to Neha Verma — customer is angry", CreatedAt: "2026-09-16T09:00:00Z", UserName: "Amit Singh" },
          { Id: 3, Type: "call", Summary: "Outbound call logged", CreatedAt: "2026-09-16T11:00:00Z", UserName: "Amit Singh" },
        ],
      }),
    });
    server.use(http.post("*/api/calls/fetchCalls", () => json({ calls: [{ Id: 31, Direction: "out", Notes: "Promised a visit Friday", OutcomeId: 50, Duration: 4, CalledAt: "2026-09-16T11:00:00Z" }] })));
    renderDetail();
    await screen.findByTestId("ticket-detail");

    await userEvent.setup().click(screen.getByRole("tab", { name: /Timeline/ }));
    const items = await screen.findAllByTestId("timeline-item");
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveTextContent("Escalated");
    // The thin "a call happened" row is replaced by what was actually said.
    expect(screen.getByText("Outgoing call")).toBeInTheDocument();
    expect(screen.getByText(/Promised a visit Friday/)).toBeInTheDocument();
    expect(screen.getByText(/Answered/)).toBeInTheDocument();
    expect(screen.getByTestId("assignment-item")).toHaveTextContent("Amit Singh");
    expect(screen.getByTestId("assignment-item")).toHaveTextContent("Assigned on creation");
  });

  it("renders the stored custom fields read-only, from the detail's own recordset", async () => {
    mockTicketEndpoints({}, {
      detail: ticketDetail({ fields: [
        { FieldId: 1, FieldKey: "sev", Label: "Severity", Type: "number", ValueText: null, ValueNumber: 3, ValueDate: null },
        { FieldId: 2, FieldKey: "mod", Label: "Module", Type: "text", ValueText: "Auth", ValueNumber: null, ValueDate: null },
      ] }),
    });
    renderDetail();
    expect(await screen.findByTestId("ticket-custom-fields")).toHaveTextContent("Severity");
    expect(screen.getByTestId("ticket-custom-fields")).toHaveTextContent("Module");
    expect(screen.getByTestId("ticket-custom-fields")).toHaveTextContent("Auth");
    // Editing moved into the create/edit modal — no draft, no save button here.
    expect(screen.queryByTestId("save-custom-fields-btn")).toBeNull();
  });

  it("hides the custom-field card when the company has configured none", async () => {
    mockTicketEndpoints();
    renderDetail();
    await screen.findByTestId("ticket-detail");
    expect(screen.queryByTestId("ticket-custom-fields")).toBeNull();
  });
});
```

Append to `web/src/pages/Sales/Timeline.test.jsx`:

```jsx
// Spec 2 gave complaints four activity types sales never wrote. The map is
// the label AND the icon; anything unmapped keeps the old de-underscored type,
// which is what the legacy `stage_changed` rows still need.
describe("Timeline activity types", () => {
  it.each([
    ["created", "Created"],
    ["updated", "Updated"],
    ["status", "Status changed"],
    ["assigned", "Assigned"],
    ["resolved", "Resolved"],
    ["closed", "Closed"],
    ["rejected", "Rejected"],
    ["reopened", "Reopened"],
    ["escalated", "Escalated"],
  ])("labels %s as %s and gives it an icon", (type, label) => {
    wrap(<Timeline activity={[{ Id: 1, Type: type, CreatedAt: "2026-09-16T10:00:00Z" }]} />);
    const item = screen.getByTestId("timeline-item");
    expect(item).toHaveTextContent(label);
    expect(item).toHaveAttribute("data-type", type);
    expect(item.querySelector("svg")).toBeTruthy();
  });

  it("keeps an unmapped legacy type readable", () => {
    wrap(<Timeline activity={[{ Id: 1, Type: "stage_changed", CreatedAt: "2026-09-16T10:00:00Z" }]} />);
    const item = screen.getByTestId("timeline-item");
    expect(item).toHaveTextContent("Stage changed");
    expect(item.querySelector("svg")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run each to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Support/RemarksModal.test.jsx`
Expected: FAIL — `Failed to resolve import "./RemarksModal"`.
Run: `cd web && pnpm exec vitest run src/pages/Support/ResolveTicketModal.test.jsx`
Expected: FAIL — `Failed to resolve import "./ResolveTicketModal"`.
Run: `cd web && pnpm exec vitest run src/pages/Support/EscalateTicketModal.test.jsx`
Expected: FAIL — `Failed to resolve import "./EscalateTicketModal"`.
Run: `cd web && pnpm exec vitest run src/pages/Sales/Timeline.test.jsx`
Expected: FAIL — `expect(element).toHaveAttribute("data-type", "created")` (the item has no `data-type`), and "Updated"/"Escalated" render as "Updated"/"Escalated" only by accident of `formatType` while `status` renders as "Status" rather than "Status changed".
Run: `cd web && pnpm exec vitest run src/pages/Support/TicketDetail.test.jsx`
Expected: FAIL — `Failed to resolve import "./ResolveTicketModal"` from the `vi.mock` factory; once the modals exist, `ticket-status-select-input` is not found (the page still renders Resolve/Close/Reopen buttons).

- [ ] **Step 4: Implement the three modals**

Create `web/src/pages/Support/RemarksModal.jsx`:

```jsx
// src/pages/Support/RemarksModal.jsx
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";

import { Modal, Button, TextArea } from "../../components/ui";

/**
 * One remarks prompt for every lifecycle move that needs a sentence: Reject
 * ("never solved" — the record has to say why) and Reopen (a manager's act,
 * spec 2 §2), both of which sp_SetTicketStatus refuses without remarks.
 *
 * It owns no endpoint. The caller submits, so the same prompt fronts a status
 * move, a close or an on-hold without learning three payload shapes — and the
 * caller keeps it open when the server says no.
 */
export default function RemarksModal({
  open, onClose, title, subtitle, submitLabel = "Save", required = true, onSubmit, busy = false,
}) {
  const [remarks, setRemarks] = useState("");

  // Clear on each open: the previous refusal is not a draft for the next one.
  useEffect(() => { if (open) setRemarks(""); }, [open]);

  const ready = !required || Boolean(remarks.trim());
  const handleClose = () => { if (busy) return; onClose?.(); };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="remarks-modal">
      <Modal.Header title={title} subtitle={subtitle} icon={<MessageSquare size={18} />} onClose={handleClose} />
      <Modal.Body>
        <TextArea
          label="Remarks"
          required={required}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={4}
          placeholder="What happened, in a line or two"
          data-testid="remarks-input"
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => ready && onSubmit?.(remarks.trim())}
          disabled={!ready}
          loading={busy}
          data-testid="remarks-submit"
        >
          {submitLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

Create `web/src/pages/Support/ResolveTicketModal.jsx`:

```jsx
// src/pages/Support/ResolveTicketModal.jsx
import { useEffect, useState } from "react";
import { CheckCircle } from "lucide-react";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

/**
 * The resolution + remarks a complaint needs before it can leave the active
 * statuses (spec 2 §2): 'resolved' always, and 'closed' when it is moving
 * straight there from open/onhold. sp_SetTicketStatus refuses without either.
 *
 * `status` is the option the user actually picked, not "the first resolved
 * one" — a company may define two resolved-coded statuses, and this is the
 * whole reason every move goes through sp_SetTicketStatus rather than the
 * sp_ResolveTicket shortcut.
 */
export default function ResolveTicketModal({ open, onClose, ticket, status, onDone }) {
  const [resolution, setResolution] = useState(null);
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open) return;
    setResolution(null);
    setRemarks("");
  }, [open]);

  const { lookups: resolutions } = useLookups("resolution", { enabled: open, showErrorMessage: false });
  const options = resolutions.map((r) => ({ value: r.Id, label: r.Value }));

  const mutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.setTicketStatus,
    successMessage: status?.code === "closed" ? "Complaint closed" : "Complaint resolved",
    invalidateQueries: [["tickets"], ["ticket-detail"], ["customer-detail"]],
  });

  const ready = Boolean(resolution && remarks.trim());
  const handleClose = () => { if (mutation.isPending) return; onClose?.(); };

  const submit = async () => {
    if (!ready) return;
    try {
      await mutation.mutateAsync({
        TicketId: ticket?.Id,
        StatusId: status?.value,
        ResolutionId: resolution.value,
        Remarks: remarks.trim(),
      });
      onDone?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message.
    }
  };

  const closing = status?.code === "closed";

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="resolve-ticket-modal">
      <Modal.Header
        title={closing ? "Close complaint" : "Resolve complaint"}
        subtitle={closing
          ? "Closing straight from open needs the resolution the customer accepted."
          : "Say what fixed it — the customer confirms before it is closed."}
        icon={<CheckCircle size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Combobox
            label="Resolution"
            required
            options={options}
            value={resolution}
            onChange={setResolution}
            placeholder="Pick a resolution"
            data-testid="resolution-combobox"
          />
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={4}
            placeholder="What you did, in the customer's words if possible"
            data-testid="resolve-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="resolve-submit">
          {closing ? "Close" : "Resolve"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

Create `web/src/pages/Support/EscalateTicketModal.jsx`:

```jsx
// src/pages/Support/EscalateTicketModal.jsx
import { useEffect, useState } from "react";
import { Flag } from "lucide-react";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

/**
 * Flag a senior (spec 2 §2). The complaint stays with its assignee — this is
 * a shout for help, not a reassignment — and the senior gets an in-app
 * notification.
 *
 * The chain is the ASSIGNEE's, not the caller's: sp_EscalateTicket requires
 * the target to be an ancestor of whoever holds the complaint (of the caller
 * when nobody does, which is what ForUserId = null asks the controller for).
 */
export default function EscalateTicketModal({ open, onClose, ticket, onDone }) {
  const [target, setTarget] = useState(null);
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open) return;
    setTarget(null);
    setRemarks("");
  }, [open]);

  const forUserId = ticket?.AssignedTo ?? null;
  const { data } = useApiQuery({
    queryKey: ["escalation-targets", forUserId],
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchEscalationTargets,
    params: { ForUserId: forUserId },
    enabled: open,
    showErrorMessage: false,
  });
  // Nearest first — the SP orders by Depth, so the list is already the chain.
  const options = (data?.users ?? []).map((u) => ({
    value: u.Id,
    label: u.JobTitle ? `${u.FullName} · ${u.JobTitle}` : u.FullName,
  }));

  const mutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.escalateTicket,
    successMessage: "Complaint escalated",
    invalidateQueries: [["tickets"], ["ticket-detail"]],
  });

  const ready = Boolean(target && remarks.trim());
  const handleClose = () => { if (mutation.isPending) return; onClose?.(); };

  const submit = async () => {
    if (!ready) return;
    try {
      await mutation.mutateAsync({ TicketId: ticket?.Id, ToUserId: target.value, Remarks: remarks.trim() });
      onDone?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the SP's message (closed complaint,
      // target not a senior of the assignee).
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="escalate-ticket-modal">
      <Modal.Header
        title="Escalate complaint"
        subtitle="It stays with you — the senior is notified and sees it in their Escalated tab."
        icon={<Flag size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Combobox
            label="Escalate to"
            required
            options={options}
            value={target}
            onChange={setTarget}
            placeholder="Someone above the assignee"
            noOptionsText="Nobody senior to escalate to"
            data-testid="escalate-target"
          />
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={4}
            placeholder="Why this needs them"
            data-testid="escalate-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="escalate-submit">
          Escalate
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
```

- [ ] **Step 5: Give `Timeline` its type map**

Replace the whole of `web/src/pages/Sales/Timeline.jsx`:

```jsx
import { useMemo } from "react";
import { useTheme } from "@mui/material/styles";
import {
  CheckCircle2, CircleDot, Clock, Flag, Pencil, PhoneCall, PlusCircle, RotateCcw, UserCheck, XCircle,
} from "lucide-react";
import dayjs from "dayjs";

import { EmptyState } from "../../components/ui";

// tblLeadActivity / tblTicketActivity rows expose `Type` and a human-readable
// `Summary`; there is no separate Action/Details column. Spec 2 added
// escalated / rejected / reopened / updated on the complaint side — the map is
// the label AND the icon, so a glance down the rail reads as a story rather
// than as ten identical dots.
const TYPE_META = {
  created: { label: "Created", Icon: PlusCircle, tone: "primary" },
  updated: { label: "Updated", Icon: Pencil, tone: "primary" },
  status: { label: "Status changed", Icon: CircleDot, tone: "info" },
  assigned: { label: "Assigned", Icon: UserCheck, tone: "info" },
  resolved: { label: "Resolved", Icon: CheckCircle2, tone: "success" },
  closed: { label: "Closed", Icon: CheckCircle2, tone: "success" },
  rejected: { label: "Rejected", Icon: XCircle, tone: "error" },
  reopened: { label: "Reopened", Icon: RotateCcw, tone: "warning" },
  escalated: { label: "Escalated", Icon: Flag, tone: "warning" },
  call: { label: "Call", Icon: PhoneCall, tone: "primary" },
};

const formatType = (type) =>
  String(type || "activity")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

// Anything unmapped keeps the old behaviour — the de-underscored type — which
// is what the legacy `stage_changed` / `field_changed` rows still need.
const metaFor = (type) =>
  TYPE_META[String(type || "").toLowerCase()] ?? { label: formatType(type), Icon: Clock, tone: "primary" };

const activityDate = (item) => item.CreatedAt ?? item.CreatedDate ?? null;

const isCall = (item) => String(item?.Type || "").toLowerCase().includes("call");

/**
 * Renders a record's activity trail as a chronological list, oldest first.
 *
 * `calls` is optional and, when given, REPLACES the activity rows of type
 * 'call' rather than adding to them. The two describe the same event at
 * different depths: sp_LogCall writes an activity row saying a call happened
 * ("Outbound call logged"), while tblCall holds what was actually said. Showing
 * both lists every call twice; showing only the activity row loses the notes
 * the user typed.
 */
export default function Timeline({ activity = [], calls = [], outcomes = [] }) {
  const theme = useTheme();
  const p = theme.tokens;

  const sorted = useMemo(() => {
    const outcomeName = (id) => outcomes.find((o) => o.Id === id)?.Value ?? null;

    const fromActivity = activity
      .filter((item) => !(calls.length && isCall(item)))
      .map((item, i) => {
        const meta = metaFor(item.Type);
        return {
          key: `a-${item.Id ?? i}`,
          type: String(item.Type || "activity").toLowerCase(),
          title: meta.label,
          Icon: meta.Icon,
          tone: meta.tone,
          detail: item.Summary,
          at: activityDate(item),
        };
      });

    const fromCalls = calls.map((call) => ({
      key: `c-${call.Id}`,
      type: "call",
      title: call.Direction === "in" ? "Incoming call" : "Outgoing call",
      Icon: PhoneCall,
      tone: "primary",
      detail:
        [call.Notes, outcomeName(call.OutcomeId), call.Duration ? `${call.Duration} min` : null]
          .filter(Boolean)
          .join(" · ") || null,
      at: call.CalledAt ?? call.CreatedAt ?? null,
    }));

    return [...fromActivity, ...fromCalls].sort(
      (a, b) => new Date(a.at ?? 0) - new Date(b.at ?? 0),
    );
  }, [activity, calls, outcomes]);

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={28} />}
        title="No activity yet"
        description="Calls, status moves, transfers and field changes on this record will show up here."
        size="sm"
        data-testid="timeline-empty"
      />
    );
  }

  const toneOf = (tone) =>
    tone === "default"
      ? { main: p.text.secondary, subtle: p.surface.subtle }
      : { main: p[tone]?.main ?? p.primary.main, subtle: p[tone]?.subtle ?? p.primary.subtle };

  return (
    <div
      data-testid="lead-timeline"
      style={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      {sorted.map((item) => {
        const t = toneOf(item.tone);
        return (
          <div
            key={item.key}
            data-testid="timeline-item"
            data-type={item.type}
            style={{
              position: "relative",
              display: "flex",
              gap: 12,
              padding: "10px 4px 10px 20px",
              marginLeft: 10,
              borderLeft: `2px solid ${p.border.default}`,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: -11,
                top: 10,
                width: 20,
                height: 20,
                borderRadius: theme.radii.full,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.subtle,
                color: t.main,
              }}
            >
              <item.Icon size={11} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: p.text.primary }}>
                {item.title}
              </div>
              {item.detail && (
                <div style={{ fontSize: 13, color: p.text.secondary, marginTop: 2 }}>
                  {item.detail}
                </div>
              )}
              <div style={{ fontSize: 11, color: p.text.tertiary, marginTop: 4 }}>
                {item.at ? dayjs(item.at).format("DD-MM-YYYY HH:mm") : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Rewrite `TicketDetail.jsx`**

Replace the whole of `web/src/pages/Support/TicketDetail.jsx`:

```jsx
// src/pages/Support/TicketDetail.jsx
//
// One complaint (spec 2 §4). The lifecycle is driven entirely from the status
// dropdown: every move posts sp_SetTicketStatus, and the moves that need a
// sentence or a resolution prompt for it first. Nothing here matches on a
// status NAME — companies rename them — and nothing resolves an id into a
// label: sp_FetchTicketDetail joins every one of them, custom fields included.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { ArrowRightLeft, Flag, Pencil, PhoneCall } from "lucide-react";

import { PageHeader, Card, Chip, Button, Tabs, Skeleton, Combobox } from "../../components/ui";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { formatDate, formatDateTime } from "../../utils/format";
import { statusTone, dueLabel, isActiveCode, isTerminalCode } from "./ticketStatus";
import Timeline from "../Sales/Timeline";
import LogCallModal from "../Sales/LogCallModal";
import TicketCreateModal from "./TicketCreateModal";
import TransferTicketModal from "./TransferTicketModal";
import EscalateTicketModal from "./EscalateTicketModal";
import ResolveTicketModal from "./ResolveTicketModal";
import RemarksModal from "./RemarksModal";

function InfoItem({ label, value }) {
  const p = useTheme().tokens;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: p.text.primary }}>{value || "—"}</div>
    </div>
  );
}

// RS2 carries Label and Type beside the stored value, so a custom field needs
// no definition fetch to be READ. Editing them is the create/edit modal's job.
const customValue = (f) => {
  switch (f.Type) {
    case "number": return f.ValueNumber ?? "—";
    case "date": return formatDate(f.ValueDate, { empty: "—" });
    case "checkbox": return f.ValueNumber ? "Yes" : "No";
    default: return f.ValueText || "—";
  }
};

export default function TicketDetail({ ticketId: ticketIdProp }) {
  const { ticketId: ticketIdParam } = useParams();
  const ticketId = Number(ticketIdProp ?? ticketIdParam);
  const navigate = useNavigate();
  const p = useTheme().tokens;

  const [tab, setTab] = useState("details");
  const [callOpen, setCallOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [resolvePick, setResolvePick] = useState(null);   // status awaiting a resolution
  const [remarksPick, setRemarksPick] = useState(null);   // { status, title, submitLabel }

  const { data, isLoading, refetch } = useApiQuery({
    queryKey: ["ticket-detail", ticketId],
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchTicketDetail,
    params: { TicketId: ticketId },
    enabled: Boolean(ticketId),
    showErrorMessage: false,
  });

  const quiet = { showErrorMessage: false };
  const { lookups: statuses } = useLookups("ticket_status", quiet);
  const { lookups: outcomes } = useLookups("call_outcome", quiet);
  // The activity row for a call only records that one happened; tblCall holds
  // the notes and the outcome (reachable for tickets since SQL 067).
  const { data: callsData, refetch: refetchCalls } = useApiQuery({
    queryKey: ["ticket-calls", ticketId],
    endpoint: SUPPORT_ENDPOINTS.calls.fetchCalls,
    params: { TicketId: ticketId },
    enabled: Boolean(ticketId),
    showErrorMessage: false,
  });

  const ticket = data?.ticket ?? null;
  const fields = data?.fields ?? [];
  const activity = data?.activity ?? [];
  const assignments = data?.assignments ?? [];
  const linkedLead = data?.linkedLead ?? null;
  const calls = callsData?.calls ?? [];

  const statusOpts = useMemo(
    () => statuses.map((s) => ({ value: s.Id, label: s.Value, code: s.Code })),
    [statuses],
  );

  const statusMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.setTicketStatus,
    successMessage: "Status updated",
    invalidateQueries: [["tickets"], ["ticket-detail", ticketId], ["customer-detail"]],
  });

  /**
   * One endpoint, three prompts:
   *  - resolved, or closed straight from an active status → resolution + remarks
   *  - rejected → remarks ("never solved" has to say why)
   *  - terminal → active → remarks, and the server decides whether the caller
   *    is allowed to reopen at all (AllowReopen; a 403 comes back as-is)
   */
  const onStatusPick = (opt) => {
    if (!opt || opt.value === ticket?.StatusId) return;
    const from = ticket?.StatusCode;
    if (opt.code === "resolved" || (opt.code === "closed" && !isTerminalCode(from))) {
      setResolvePick(opt);
      return;
    }
    if (opt.code === "rejected") {
      setRemarksPick({ status: opt, title: "Reject complaint", subtitle: "It was never solved — say why, for the record.", submitLabel: "Reject" });
      return;
    }
    if (isTerminalCode(from) && isActiveCode(opt.code)) {
      setRemarksPick({ status: opt, title: "Reopen complaint", subtitle: "The due date restarts from now. Only a manager may do this.", submitLabel: "Reopen" });
      return;
    }
    statusMutation.mutate({ TicketId: ticketId, StatusId: opt.value, Remarks: null });
  };

  const submitRemarks = async (remarks) => {
    try {
      await statusMutation.mutateAsync({ TicketId: ticketId, StatusId: remarksPick.status.value, Remarks: remarks });
      setRemarksPick(null);
    } catch {
      // The server's own words are already on screen (the reopen gate's 403);
      // the prompt stays open so the move is not silently lost.
    }
  };

  if (isLoading || !ticket) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="ticket-detail-loading">
        <Skeleton variant="text" height={28} width={240} />
        <Skeleton variant="rect" height={160} />
      </div>
    );
  }

  const address = [ticket.CustomerAddress, ticket.CustomerCity].filter(Boolean).join(", ");

  return (
    <div data-testid="ticket-detail">
      <PageHeader
        title={ticket.TicketNo}
        subtitle={ticket.Subject}
        titleSuffix={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Chip label={ticket.StatusName || "—"} tone={statusTone(ticket.StatusCode)} size="sm" data-testid="ticket-status-chip" />
            {ticket.PriorityName && <Chip label={ticket.PriorityName} tone="accent" size="sm" data-testid="ticket-priority-chip" />}
            <Chip
              label={dueLabel(ticket.DueAt, ticket.IsOverdue)}
              tone={ticket.IsOverdue ? "error" : "default"}
              size="sm"
              data-testid="ticket-due-chip"
            />
            {ticket.EscalatedTo && (
              <Chip
                icon={<Flag size={12} />}
                label={`Escalated to ${ticket.EscalatedToName ?? "a senior"}`}
                tone="warning"
                size="sm"
                data-testid="ticket-escalated-chip"
              />
            )}
          </div>
        }
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 190 }}>
              {/* blurOnSelect: a pick that opens a prompt instead of moving the
                  status must not linger in the input, or the header contradicts
                  the chip beside it. Blurring resyncs to the controlled value. */}
              <Combobox
                size="sm"
                blurOnSelect
                options={statusOpts}
                value={statusOpts.find((o) => o.value === ticket.StatusId) ?? null}
                onChange={onStatusPick}
                placeholder="Status"
                data-testid="ticket-status-select"
              />
            </div>
            <Button variant="ghost" leftIcon={<PhoneCall size={14} />} onClick={() => setCallOpen(true)} data-testid="log-call-btn">Log call</Button>
            <Button variant="tonal" leftIcon={<ArrowRightLeft size={14} />} onClick={() => setTransferOpen(true)} data-testid="transfer-ticket-btn">Transfer</Button>
            <Button variant="tonal" leftIcon={<Flag size={14} />} onClick={() => setEscalateOpen(true)} data-testid="escalate-ticket-btn">Escalate</Button>
            <Button variant="tonal" leftIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)} data-testid="edit-ticket-btn">Edit</Button>
          </div>
        }
      />

      <Card data-testid="ticket-customer-card" padding="md" sx={{ marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 16 }}>
          <InfoItem label="Customer" value={ticket.CustomerName} />
          <InfoItem label="Contact person" value={ticket.CustomerContactPerson} />
          <InfoItem label="Mobile" value={ticket.CustomerMobile} />
          <InfoItem label="Email" value={ticket.CustomerEmail} />
          <InfoItem label="Where" value={address} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>History</div>
            <button
              type="button"
              onClick={() => navigate(`/support/customers?customerId=${ticket.CustomerId}`)}
              data-testid="ticket-previous-complaints"
              style={{
                marginTop: 2, padding: 0, border: "none", background: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 600, fontFamily: "inherit", color: p.primary.main,
              }}
            >
              {ticket.PreviousTickets ?? 0} previous complaints
            </button>
          </div>
        </div>
      </Card>

      {linkedLead && (
        <div style={{ margin: "8px 0" }}>
          <a href={`/sales/leads/${linkedLead.Id}`} data-testid="linked-lead-link" style={{ fontSize: 13, fontWeight: 600 }}>
            Linked lead: {linkedLead.Name}
          </a>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          data-testid="ticket-detail-tabs"
          items={[
            { value: "details", label: "Details" },
            { value: "timeline", label: "Timeline", badge: activity.length + calls.length },
          ]}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        {tab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card data-testid="ticket-core-info">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                <InfoItem label="Status" value={ticket.StatusName} />
                <InfoItem label="Priority" value={ticket.PriorityName} />
                <InfoItem label="Due" value={formatDateTime(ticket.DueAt, { empty: "—" })} />
                <InfoItem label="Category" value={ticket.CategoryName} />
                <InfoItem label="Channel" value={ticket.ChannelName} />
                <InfoItem label="Product" value={ticket.ProductName} />
                <InfoItem label="Assignee" value={ticket.AssigneeName || "Unassigned"} />
                <InfoItem label="Assigned since" value={formatDate(ticket.AssignedAt, { empty: "—" })} />
                <InfoItem label="Branch" value={ticket.BranchName} />
                <InfoItem label="Reported by" value={[ticket.ContactPerson, ticket.Contact].filter(Boolean).join(" · ")} />
                <InfoItem label="Raised" value={formatDateTime(ticket.CreatedAt, { empty: "—" })} />
                <InfoItem label="Resolution" value={ticket.ResolutionName} />
                <InfoItem label="Resolved" value={formatDateTime(ticket.ResolvedAt, { empty: "—" })} />
                <InfoItem label="Closed" value={formatDateTime(ticket.ClosedAt, { empty: "—" })} />
              </div>
              {ticket.Description && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>Description</div>
                  <div
                    data-testid="ticket-description-block"
                    style={{ fontSize: 14, lineHeight: 1.6, marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {ticket.Description}
                  </div>
                </div>
              )}
            </Card>

            {/* An unconfigured optional feature earns no screen space. */}
            {fields.length > 0 && (
              <Card data-testid="ticket-custom-fields">
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Custom fields</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                  {fields.map((f) => <InfoItem key={f.FieldId} label={f.Label} value={customValue(f)} />)}
                </div>
              </Card>
            )}

            <Card>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Attachments</h3>
              <Attachments entity="ticket" entityId={ticket.Id} />
            </Card>
          </div>
        )}

        {tab === "timeline" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Assignments</h3>
              {assignments.length === 0 ? (
                <div style={{ fontSize: 13 }}>Never assigned.</div>
              ) : assignments.map((a) => (
                <div key={a.Id} data-testid="assignment-item" style={{ fontSize: 13, padding: "6px 0" }}>
                  <strong>{formatDateTime(a.AssignedAt)}</strong> · {a.FromUserName ?? "Unassigned"} → {a.ToUserName ?? "Unassigned"}
                  {a.ToBranchName && a.FromBranchName !== a.ToBranchName ? ` (${a.ToBranchName})` : ""}
                  {a.Reason ? ` · ${a.Reason}` : ""} — {a.Remarks} <em>by {a.AssignedByName}</em>
                </div>
              ))}
            </Card>
            <Timeline activity={activity} calls={calls} outcomes={outcomes} />
          </div>
        )}
      </div>

      <LogCallModal
        open={callOpen}
        onClose={() => setCallOpen(false)}
        ticketId={ticketId}
        onLogged={() => { refetch(); refetchCalls(); }}
      />
      <TicketCreateModal open={editOpen} ticket={ticket} onClose={() => setEditOpen(false)} onSaved={refetch} />
      <TransferTicketModal open={transferOpen} ticketIds={[ticketId]} onClose={() => setTransferOpen(false)} onDone={refetch} />
      <EscalateTicketModal open={escalateOpen} ticket={ticket} onClose={() => setEscalateOpen(false)} onDone={refetch} />
      <ResolveTicketModal
        open={Boolean(resolvePick)}
        ticket={ticket}
        status={resolvePick}
        onClose={() => setResolvePick(null)}
        onDone={refetch}
      />
      <RemarksModal
        open={Boolean(remarksPick)}
        title={remarksPick?.title}
        subtitle={remarksPick?.subtitle}
        submitLabel={remarksPick?.submitLabel}
        required
        busy={statusMutation.isPending}
        onClose={() => setRemarksPick(null)}
        onSubmit={submitRemarks}
      />
    </div>
  );
}
```

- [ ] **Step 7: Run each to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Support/RemarksModal.test.jsx --coverage --coverage.include=src/pages/Support/RemarksModal.jsx`
Expected: 4 passed; `RemarksModal.jsx` ≥ 90 % lines / branches.
Run: `cd web && pnpm exec vitest run src/pages/Support/ResolveTicketModal.test.jsx --coverage --coverage.include=src/pages/Support/ResolveTicketModal.jsx`
Expected: 3 passed; `ResolveTicketModal.jsx` ≥ 90 %.
Run: `cd web && pnpm exec vitest run src/pages/Support/EscalateTicketModal.test.jsx --coverage --coverage.include=src/pages/Support/EscalateTicketModal.jsx`
Expected: 3 passed; `EscalateTicketModal.jsx` ≥ 90 %.
Run: `cd web && pnpm exec vitest run src/pages/Sales/Timeline.test.jsx --coverage --coverage.include=src/pages/Sales/Timeline.jsx`
Expected: 24 passed (13 existing + 11 new); `Timeline.jsx` ≥ 95 %.
Run: `cd web && pnpm exec vitest run src/pages/Support/TicketDetail.test.jsx --coverage --coverage.include=src/pages/Support/TicketDetail.jsx`
Expected: 14 passed; `TicketDetail.jsx` ≥ 85 % lines / branches.

- [ ] **Step 8: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous (including the extra `status` prop on `ResolveTicketModal`, which deviates from the plan's Contracts line by one argument).

---

### Task 17: Settings: `LookupMaster` TAT hours, `Lookups` kinds

**Files:**
- Modify: `web/src/pages/Settings/LookupMaster.jsx:47-58` (the `STATUS_CODES` const + `emptyForm`), `:86-98` (the edit-seeding effect), `:153-162` (`handleSubmit`), `:236-246` (the conditional `Code` row)
- Modify: `web/src/pages/Settings/LookupMaster.test.jsx` (append one describe)
- Modify: `web/src/pages/Settings/Lookups.jsx:8-25` (`KIND_OPTIONS` + the subtitle)
- Modify: `web/src/pages/Settings/Lookups.test.jsx:115-130` (the `it.each` kind table), append one case
- Modify: `web/src/pages/Settings/Priorities.test.jsx` (append two cases)

**Interfaces:**
- Consumes: `sp_SaveLookup @Id, @CompId, @Kind, @Value, @SortOrder, @Code = NULL, @TatHours = NULL` and `sp_FetchLookups` (+`TatHours`) — `086` §6, forwarded by `configController.saveLookup` (backend Task 9); `useLookups`; `FormInput`, `FormNumberInput`, `FormSelect`, `FormRow`, `FormModal`, `FormButtons` (`components/Design/FormComponents.jsx:66`, `:99`, `:168` — `FormSelect` hands back `{ target: { value } }`, `FormNumberInput` strips anything but `0-9.-`).
- Produces: `LookupMaster` sends `Code` for **any** kind that has a code set (`lead_status`, `ticket_status`) and `TatHours` for `priority`; every other kind's payload is unchanged (`{ Id, Kind, Value, SortOrder }`). `Lookups` offers nine kinds, `ticket_status` → "Complaint Statuses" and `ticket_channel` → "Complaint Channels" among them.

Decisions stated here (the spec is silent):
1. **The Code field is table-driven, not a second `if`.** `activeKind === "lead_status"` becomes a lookup in a `CODE_OPTIONS` map. Two special cases written twice is how the third one gets forgotten; and `sp_SaveLookup` validates the set per kind, so the UI's list and the SP's list stay side by side in one place.
2. **A blank TAT sends `null`, not `0`.** `TatHours IS NULL` means "this priority has no due date" (spec §2 — `DueAt` NULL, never overdue); `0` would mean "due the moment it is raised".
3. **The tile grid is not touched.** `MasterChipGrid` shows one label and `#id`; squeezing "24h" in would change every master screen in the app to serve one. The TAT is visible on the tile you open, which is where you change it.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/pages/Settings/LookupMaster.test.jsx`:

```jsx
// Spec 2: ticket_status carries a Code exactly as lead_status does (the
// complaint lifecycle branches on it, never on the renameable label), and
// priority carries the TAT hours that stamp a complaint's due date.
describe("LookupMaster — ticket_status Code and priority TAT", () => {
  const TICKET_STATUS = [{ value: "ticket_status", label: "Complaint Statuses" }];
  const PRIORITY = [{ value: "priority", label: "Priorities" }];

  beforeEach(() => {
    lastSaveBody = undefined;
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://shadowcodes.in/CRM",
    });
    seed({
      ticket_status: [{ Id: 62, Kind: "ticket_status", Value: "In Progress", SortOrder: 2, Code: "open" }],
      priority: [{ Id: 3, Kind: "priority", Value: "High", SortOrder: 3, TatHours: 24 }],
    });
  });

  it("offers the five complaint codes and sends the picked one", async () => {
    renderMaster(TICKET_STATUS, "Status");
    await screen.findByText("In Progress");

    const user = userEvent.setup();
    await user.click(screen.getByText("New Status"));
    await user.type(await screen.findByLabelText(/Value/), "Waiting on parts");
    await user.click(screen.getByLabelText(/Code/));
    expect(await screen.findByRole("option", { name: /Resolved/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Rejected/ })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /On hold/ }));
    await user.click(screen.getByRole("button", { name: "Create Status" }));

    await waitFor(() =>
      expect(lastSaveBody).toEqual({
        Id: 0, Kind: "ticket_status", Value: "Waiting on parts", SortOrder: 0, Code: "onhold",
      })
    );
  });

  // A status edited without its Code re-sent would be re-coded "open", and the
  // complaint lifecycle would silently lose its Resolved/Closed buckets.
  it("seeds the editing row's Code and sends it back unchanged", async () => {
    renderMaster(TICKET_STATUS, "Status");
    await screen.findByText("In Progress");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-62"));
    expect(await screen.findByLabelText(/Code/)).toHaveValue("Open — being worked");

    await user.click(screen.getByRole("button", { name: "Update Status" }));
    await waitFor(() => expect(lastSaveBody).toMatchObject({ Id: 62, Value: "In Progress", Code: "open" }));
  });

  it("shows TAT hours for priorities and sends them", async () => {
    renderMaster(PRIORITY, "Priority");
    await screen.findByText("High");

    const user = userEvent.setup();
    await user.click(screen.getByText("New Priority"));
    await user.type(await screen.findByLabelText(/Value/), "Urgent");
    await user.type(screen.getByLabelText(/TAT hours/), "4");
    // A priority has no Code — sp_SaveLookup validates codes per Kind.
    expect(screen.queryByLabelText(/Code/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create Priority" }));

    await waitFor(() =>
      expect(lastSaveBody).toEqual({
        Id: 0, Kind: "priority", Value: "Urgent", SortOrder: 0, TatHours: 4,
      })
    );
  });

  it("seeds an existing TAT on edit, and a blank one means no due date at all", async () => {
    renderMaster(PRIORITY, "Priority");
    await screen.findByText("High");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-3"));
    expect(await screen.findByLabelText(/TAT hours/)).toHaveValue("24");

    await user.clear(screen.getByLabelText(/TAT hours/));
    await user.click(screen.getByRole("button", { name: "Update Priority" }));
    // null, not 0 — 0 would mean "due the moment it is raised".
    await waitFor(() => expect(lastSaveBody).toMatchObject({ Id: 3, Kind: "priority", TatHours: null }));
  });

  it("sends neither Code nor TatHours for a plain kind", async () => {
    seed({ lead_source: [{ Id: 1, Kind: "lead_source", Value: "Website", SortOrder: 1 }] });
    renderMaster(LEAD_SOURCE, "Source");
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByText("New Source"));
    await user.type(await screen.findByLabelText(/Value/), "Referral");
    expect(screen.queryByLabelText(/Code/)).toBeNull();
    expect(screen.queryByLabelText(/TAT hours/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create Source" }));

    await waitFor(() => expect(lastSaveBody).toEqual({ Id: 0, Kind: "lead_source", Value: "Referral", SortOrder: 0 }));
  });
});
```

In `web/src/pages/Settings/Lookups.test.jsx`, extend the `it.each` table so it reads:

```jsx
  it.each([
    ["lead_status", "Lead Statuses"],
    ["product_category", "Product Categories"],
    ["transfer_reason", "Transfer Reasons"],
    // Spec 2: complaints get a flat status list with a Code, and the channel
    // stops being a string hardcoded in two clients.
    ["ticket_status", "Complaint Statuses"],
    ["ticket_channel", "Complaint Channels"],
  ])("offers a %s tab that fetches that Kind", async (kind, label) => {
```

and append inside `describe("Lookups page")`:

```jsx
  it("creates a complaint status with its Code", async () => {
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("lookup-kind-tabs-ticket_status"));
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Value/), "Waiting on parts");
    await user.click(screen.getByLabelText(/Code/));
    await user.click(await screen.findByRole("option", { name: /On hold/ }));
    await user.click(screen.getByRole("button", { name: /create lookup/i }));

    await waitFor(() =>
      expect(lastSaveBody).toMatchObject({ Id: 0, Kind: "ticket_status", Value: "Waiting on parts", Code: "onhold" })
    );
  });
```

Append inside `describe("Priorities page")` in `web/src/pages/Settings/Priorities.test.jsx`:

```jsx
  // Spec 2 §2: the priority's TAT is what stamps a complaint's due date.
  it("creates a priority with its TAT hours", async () => {
    renderPage();
    await screen.findByText("High");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Value/), "Urgent");
    await user.type(screen.getByLabelText(/TAT hours/), "4");
    await user.click(screen.getByRole("button", { name: /create priority/i }));

    await waitFor(() => expect(lastSaveBody).toMatchObject({ Id: 0, Kind: "priority", Value: "Urgent", TatHours: 4 }));
  });

  it("carries an existing TAT through an edit", async () => {
    seedLookups({ priority: [{ Id: 1, Kind: "priority", Value: "High", SortOrder: 1, TatHours: 24 }] });
    renderPage();
    await screen.findByText("High");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-1"));
    expect(await screen.findByLabelText(/TAT hours/)).toHaveValue("24");
    await user.click(screen.getByRole("button", { name: /update priority/i }));

    await waitFor(() => expect(lastSaveBody).toMatchObject({ Id: 1, Kind: "priority", TatHours: 24 }));
  });
```

- [ ] **Step 2: Run each to verify it fails**

Run: `cd web && pnpm exec vitest run src/pages/Settings/LookupMaster.test.jsx`
Expected: FAIL — `Unable to find a label with the text of: /Code/` for `ticket_status` (only `lead_status` renders it) and `/TAT hours/` for `priority`.
Run: `cd web && pnpm exec vitest run src/pages/Settings/Lookups.test.jsx`
Expected: FAIL — `Unable to find an element by: [data-testid="lookup-kind-tabs-ticket_status"]`.
Run: `cd web && pnpm exec vitest run src/pages/Settings/Priorities.test.jsx`
Expected: FAIL — `Unable to find a label with the text of: /TAT hours/`.

- [ ] **Step 3: Implement**

In `web/src/pages/Settings/LookupMaster.jsx` replace the `STATUS_CODES` const and `emptyForm` (lines 47-58) with:

```js
// Some kinds carry a machine Code behind an editable, per-company label, and
// sp_SaveLookup validates the set per Kind. Table, not a chain of ifs: the
// lifecycle that branches on these codes lives in one place on each side.
// lead_status omits "converted" on purpose — it is stamped by the convert
// action, not handed out by an admin.
const CODE_OPTIONS = {
  lead_status: [
    { value: "open", label: "Open — still being worked" },
    { value: "qualified", label: "Qualified — ready to convert" },
    { value: "lost", label: "Lost — needs a reason" },
    { value: "junk", label: "Junk" },
  ],
  ticket_status: [
    { value: "open", label: "Open — being worked" },
    { value: "onhold", label: "On hold — waiting on the customer" },
    { value: "resolved", label: "Resolved — needs a resolution" },
    { value: "closed", label: "Closed — the customer confirmed" },
    { value: "rejected", label: "Rejected — never solved" },
  ],
};

// Kind='priority' carries the TAT hours that stamp a complaint's DueAt.
const TAT_KIND = "priority";

const emptyForm = { Value: "", SortOrder: "0", Code: "open", TatHours: "" };
```

In the edit-seeding effect (lines 86-98) replace the `setFormData({...})` call with:

```js
      setFormData({
        Value: editingLookup.Value || "",
        SortOrder: String(editingLookup.SortOrder ?? 0),
        Code: editingLookup.Code || "open",
        TatHours: editingLookup.TatHours == null ? "" : String(editingLookup.TatHours),
      });
```

Directly above `const lower = noun.toLowerCase();` add:

```js
  const codeOptions = CODE_OPTIONS[activeKind] ?? null;
  const hasTat = activeKind === TAT_KIND;
```

Replace `handleSubmit` (lines 153-162) with:

```js
  const handleSubmit = () => {
    if (!validate()) return;
    saveMutation.mutate({
      Id: editingLookup?.Id || 0,
      Kind: activeKind,
      Value: formData.Value.trim(),
      SortOrder: Number(formData.SortOrder) || 0,
      ...(codeOptions ? { Code: formData.Code } : {}),
      // NULL, not 0: "no TAT" means this priority never makes a complaint
      // overdue (spec 2 §2), while 0 would mean "due on arrival".
      ...(hasTat ? { TatHours: formData.TatHours === "" ? null : Number(formData.TatHours) } : {}),
    });
  };
```

Replace the conditional `Code` row (lines 236-246) with:

```jsx
            {codeOptions && (
              <FormRow columns={1}>
                <FormSelect
                  label="Code"
                  value={formData.Code}
                  onChange={(e) => handleChange("Code", e.target.value)}
                  options={codeOptions}
                  required
                />
              </FormRow>
            )}
            {hasTat && (
              <FormRow columns={1}>
                <FormNumberInput
                  label="TAT hours"
                  value={formData.TatHours}
                  onChange={(e) => handleChange("TatHours", e.target.value)}
                  helperText="Hours from when a complaint is raised to its due date. Leave blank for no due date."
                  maxLength={5}
                />
              </FormRow>
            )}
```

Replace `KIND_OPTIONS` and the subtitle in `web/src/pages/Settings/Lookups.jsx`:

```jsx
const KIND_OPTIONS = [
  { value: "lead_source", label: "Lead Sources" },
  // Spec 1: the lead lifecycle is a status list, not a pipeline; products and
  // transfers get their own lists too.
  { value: "lead_status", label: "Lead Statuses" },
  { value: "product_category", label: "Product Categories" },
  { value: "transfer_reason", label: "Transfer Reasons" },
  { value: "call_outcome", label: "Call Outcomes" },
  { value: "lost_reason", label: "Lost Reasons" },
  // tblTicket.ResolutionId points at Kind='resolution' (required to resolve a
  // complaint — sp_SetTicketStatus rejects without one).
  { value: "resolution", label: "Ticket Resolutions" },
  // Spec 2: the complaint lifecycle is a flat status list with a Code, and the
  // channel stops being a string hardcoded in the web and mobile clients.
  { value: "ticket_status", label: "Complaint Statuses" },
  { value: "ticket_channel", label: "Complaint Channels" },
];

const Lookups = () => (
  <LookupMaster
    title="Lookups"
    subtitle="Manage the lead and complaint status lists, sources, product categories, transfer reasons, call outcomes, lost reasons, resolutions and complaint channels."
    documentTitle="Lookups"
    noun="Lookup"
    kinds={KIND_OPTIONS}
    placeholder="e.g. Website"
  />
);
```

`Priorities.jsx` needs no change — it already pins `LookupMaster` to `kinds={[{ value: "priority", … }]}`, and the TAT field follows from the kind.

- [ ] **Step 4: Run each to verify it passes, with coverage**

Run: `cd web && pnpm exec vitest run src/pages/Settings/LookupMaster.test.jsx --coverage --coverage.include=src/pages/Settings/LookupMaster.jsx`
Expected: 14 passed (9 existing + 5 new); `LookupMaster.jsx` ≥ 90 % lines / branches.
Run: `cd web && pnpm exec vitest run src/pages/Settings/Lookups.test.jsx --coverage --coverage.include=src/pages/Settings/Lookups.jsx`
Expected: 16 passed; `Lookups.jsx` 100 %.
Run: `cd web && pnpm exec vitest run src/pages/Settings/Priorities.test.jsx --coverage --coverage.include=src/pages/Settings/Priorities.jsx`
Expected: 6 passed; `Priorities.jsx` 100 %.

- [ ] **Step 5: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched, test command + result line, coverage % for each touched src file, anything ambiguous.

---

### Task 18: Web whole suite, lint, build

**Files:** none — this task changes nothing. It is the only place in the web layer where a full-suite run, a coverage run, a lint and a build are allowed (Global Constraints). Any failure is fixed in the task that owns the file, and this task is re-run.

**Interfaces:** consumes everything Tasks 11–17 produced. Produces the numbers the owner needs before deploying: a green suite, the per-file coverage of every file this spec touched, a clean lint and a successful production build.

- [ ] **Step 1: The whole suite, once, redirected**

Run (Bash timeout 300000 — and **never run it twice in one command**, that is what blew the tool timeout the first time):
```bash
cd web && pnpm exec vitest run > "$SCRATCH/web-full.txt" 2>&1; tail -8 "$SCRATCH/web-full.txt"
```
The redirect is the point: ~130 files of reporter output is not something to pour into a context window, and `tail` is the only part anyone reads. `/tmp` rather than the repo because the transcript is not an artifact of the change.

Expected — the last lines of the tail:
```
 Test Files  129 passed (129)
      Tests  <n> passed (<n>)
   Start at  ...
   Duration  ...
```
129 = 123 files today − 4 deleted in Task 12 (`TicketBoard.test.jsx`, `TicketCard.test.jsx`, `TicketColumn.test.jsx`, `Settings/Pipelines.test.jsx`) + 10 created (Task 11: `supportQueries.test.js`, `ticketStatus.test.js`; Task 13: `CustomerFormModal`, `CustomerPicker`, `CustomerDetailModal`, `Customers`; Task 14: `TransferTicketModal`; Task 16: `RemarksModal`, `ResolveTicketModal`, `EscalateTicketModal`).
**If anything failed:** `grep -n "FAIL\|×" "$SCRATCH/web-full.txt" | head -20` names the files; fix them in their own task (max 3 attempts, then report BLOCKED) and re-run this step.

- [ ] **Step 2: Coverage of everything this spec touched**

Run (Bash timeout 300000):
```bash
cd web && pnpm exec vitest run --coverage 2>&1 | grep -E "All files|Support/|supportQueries|Settings/Lookup|Sales/Timeline"
```
Expected — one `All files` row and one row per file, each `% Stmts | % Branch | % Funcs | % Lines`:
- `All files` ≥ 60 on all four columns (the global floor in `vitest.config.js:61-66`; it is ~75 today, and this spec adds well-covered files).
- Every row under `src/pages/Support/` ≥ 80 stmts **and** ≥ 80 branch: `Tickets.jsx`, `TicketDetail.jsx`, `TicketCreateModal.jsx`, `TicketDetailModal.jsx`, `TransferTicketModal.jsx`, `ResolveTicketModal.jsx`, `RemarksModal.jsx`, `EscalateTicketModal.jsx`, `DeleteTicketModal.jsx`, `Customers.jsx`, `CustomerFormModal.jsx`, `CustomerPicker.jsx`, `CustomerDetailModal.jsx`, `ticketStatus.js`.
- `supportQueries.js` 100 %.
- `Settings/LookupMaster.jsx` ≥ 90 %, `Settings/Lookups.jsx` and `Settings/Priorities.jsx` 100 %.
- `Sales/Timeline.jsx` ≥ 95 %.
No row for `TicketBoard.jsx`, `TicketCard.jsx`, `TicketColumn.jsx`, `useStageBoard.jsx`, `BoardColumn.jsx` or `Settings/Pipelines.jsx` — they no longer exist.

- [ ] **Step 3: Lint**

Run: `cd web && pnpm lint`
Expected: exits 0, prints nothing. A likely first failure is an unused import left behind by a rewrite (`findUserById`/`getUserName` in `Tickets.jsx`, `DynamicField`/`dayjs` in `TicketDetail.jsx`) — `no-unused-vars` is an error here; delete the import rather than silencing it.

- [ ] **Step 4: Production build**

Run (Bash timeout 300000): `cd web && pnpm build`
Expected: `vite v8.x building for production...`, then `✓ built in <n>s` and a `dist-web/` listing with `dist-web/index.html` and hashed `assets/*.js` / `*.css`. **A build error here that the tests did not catch means a deleted module is still imported somewhere** — Vite's import analysis resolves the whole graph, Vitest only the files a test reaches. `grep -rn "TicketBoard\|TicketCard\|TicketColumn\|useStageBoard\|BoardColumn\|Settings/Pipelines\|fetchPipelines\|moveTicketStage" web/src` must come back empty.

- [ ] **Step 5: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report, verbatim where possible: the `Test Files` / `Tests` lines from Step 1; the `All files` row and every row Step 2 printed, flagging any file under 80 %; the lint exit status; the build's `✓ built in` line. Then the spec's own regression list, each with the test that proves it: Resolve refuses without a resolution + remarks · Reject and Reopen refuse without remarks · Transfer refuses without a reason + remarks · the presets map onto the right query params · the customer picker creates inline and selects the new id · `/support/board` redirects. Anything still red is named with the task that owns it.

### Task 19: Mobile API layer + types

**Files:**
- Modify: `mobile/src/types/api.ts:52-60` (drop `StageType`), `:326-362` (`Lookup` gains `Code`/`TatHours`; `Pipeline`/`PipelineStage` deleted), `:395-484` (ticket section rewritten), `:513-520` (append `AssignableUser`, `Product`)
- Modify: `mobile/src/api/ticketQueries.ts` (whole file, 162 lines today)
- Modify: `mobile/src/api/configQueries.ts:1-59` (`fetchPipelines` + its types out; three lookup kinds in)
- Modify: `mobile/src/api/userQueries.ts:7-11, 24` (`fetchAssignableUsers`)
- Create: `mobile/src/api/customerQueries.ts`, `mobile/src/api/productQueries.ts`
- Test: none — mobile is exempt (CLAUDE.md §0.4). Gate is `pnpm exec tsc --noEmit` + `pnpm lint`.

**Interfaces:**
- Consumes: `post` / `postData` from `mobile/src/api/client.ts:82-103` (unchanged — keep the per-request `baseURL` and `setApiBaseUrl`/`getApiBaseUrl`); the backend routes in the plan's **Contracts › Backend** table; SP `SELECT` lists from **Contracts › SQL** (`sp_FetchTickets` RS1, `sp_FetchTicketDetail` RS1–RS5, `sp_FetchCustomers` RS1, `sp_FetchEscalationTargets`), plus the live `sp_FetchAssignableUsers` (`Id, FullName, Avatar, JobTitle, BranchId, BranchName, ReportsTo`) and `sp_FetchProducts` (`Id, CompId, Name, Code, CategoryId, CategoryName, UnitPrice, MarginPct, IsActive, …`) — both read from `sys.sql_modules` 2026-09-16 and untouched by `086`.
- Produces (Tasks 20–23 import exactly these):
  - `types/api.ts`: `TicketStatusCode = "open" | "onhold" | "resolved" | "closed" | "rejected"`, `Ticket`, `TicketActivityEntry` (+`UserName`, `UserAvatar`), `TicketAssignment`, `LinkedLead` (`StatusId`, not `StageId`), `TicketDetail = { ticket, fields, activity, assignments, linkedLead }`, `Customer`, `EscalationTarget`, `AssignableUser`, `Product`, `Lookup` (+`Code: string | null`, `TatHours?: number | null`). `Pipeline`, `PipelineStage`, `StageType` no longer exist.
  - `api/ticketQueries.ts`: `TICKET_ENDPOINTS`, `FetchTicketsParams`, `TicketsPayload`, `fetchTickets(params)`, `fetchTicketDetail({ TicketId })`, `SaveTicketPayload`, `saveTicket(payload)`, `setTicketStatus({ TicketId, StatusId, ResolutionId?, Remarks? })`, `resolveTicket`, `closeTicket`, `rejectTicket`, `reopenTicket`, `transferTicket({ TicketId, ToUserId, ToBranchId?, ReasonId, Remarks })`, `escalateTicket({ TicketId, ToUserId, Remarks })`, `fetchEscalationTargets(forUserId?)`, `deleteTicket({ Id })`.
  - `api/customerQueries.ts`: `fetchCustomers({ SearchTerm, PageSize })`, `SaveCustomerPayload`, `saveCustomer(payload)`.
  - `api/productQueries.ts`: `fetchProducts()`.
  - `api/userQueries.ts`: `fetchAssignableUsers({ BranchId? })`.
  - `api/configQueries.ts`: `LOOKUP_KIND.ticketStatus | ticketChannel | transferReason` added; `fetchPipelines` gone.

Decisions taken here (spec silent): `Overdue`/`Escalated`/`Unassigned` are typed `boolean` on the phone and sent as `1 | 0` (what the SP's `BIT` parameters take, and what the brief's `{Overdue:1}` preset spells). `bulkTransferTickets` is not wired on mobile (plan ambiguity 8). `fetchCustomers` always sends `PageNumber: 1, BranchId: null, IsActive: true` — the picker only ever wants the first page of active customers company-wide.

- [ ] **Step 1: Write the types first**

In `mobile/src/types/api.ts` make four edits.

(a) Replace lines 52–60 (`ConfigEntity` + the `StageType` block) with:

```ts
/** The config engine's discriminator. One set of tables serves both modules. */
export type ConfigEntity = "lead" | "ticket";
```

(b) Replace lines 326–362 (the `Lookup` doc + interface, `Pipeline`, `PipelineStage`) with:

```ts
/**
 * A row of tblLookup. `Kind` is the list it belongs to — `ticket_category`,
 * `ticket_status`, `ticket_channel`, `priority`, `resolution`, `call_outcome`,
 * `transfer_reason`, `lead_source`, `lost_reason`.
 *
 * `Code` is the stable key on the kinds that branch on one (`lead_status`,
 * `ticket_status`). Labels are the company's and editable, so nothing in this
 * app matches on `Value`. `TatHours` is meaningful on `priority` only — hours
 * from logging to a complaint's due time; NULL means "no clock".
 *
 * Note that a ticket's Priority is a lookup **Id**, not the string enum tasks
 * use. The two modules genuinely differ here; do not unify them.
 */
export interface Lookup {
  Id: number;
  CompId: number;
  Kind: string;
  Value: string;
  SortOrder: number | null;
  IsActive: boolean;
  Code: string | null;
  TatHours?: number | null;
}
```

(c) Replace lines 395–484 (from `// ------- ticket` through the `TicketDetail` interface) with:

```ts
// ----------------------------------------------------------------- ticket

/**
 * tblLookup Kind='ticket_status' codes — the ONLY key the lifecycle branches
 * on. Active = open | onhold. Terminal = resolved | closed | rejected.
 */
export type TicketStatusCode = "open" | "onhold" | "resolved" | "closed" | "rejected";

/**
 * A row of sp_FetchTickets RS1 — wider than tblTicket. Since 086 the SP joins
 * every name a screen shows (status, priority, category, channel, product,
 * customer, assignee, escalation target, branch), so a row renders on its own;
 * the lookups are fetched only to fill pickers.
 *
 * `IsOverdue` is computed by the SP (`Code IN ('open','onhold') AND DueAt <
 * GETDATE()`) and never stored. `ResolvedAt` / `ClosedAt` / `ResolutionId` and
 * the reopen `DueAt` are written only by sp_SetTicketStatus — the client never
 * sends them, and `saveTicket` is never used to change a status.
 */
export interface Ticket {
  Id: number;
  CompId: number;
  BranchId: number;
  BranchName: string | null;
  TicketNo: string;
  Subject: string;
  CustomerId: number;
  CustomerName: string | null;
  CustomerMobile: string | null;
  /** "Reported by" — optional, prefilled from the customer on create. */
  ContactPerson: string | null;
  Contact: string | null;
  ChannelId: number | null;
  ChannelName: string | null;
  CategoryId: number | null;
  CategoryName: string | null;
  /** A tblLookup id (Kind = 'priority'). */
  Priority: number | null;
  PriorityName: string | null;
  ProductId: number | null;
  ProductName: string | null;
  StatusId: number;
  StatusName: string | null;
  StatusCode: TicketStatusCode;
  AssignedTo: number | null;
  AssigneeName: string | null;
  AssigneeAvatar: string | null;
  AssignedAt: string | null;
  /** NULL when the priority carries no TAT — such a ticket is never overdue. */
  DueAt: string | null;
  IsOverdue: boolean;
  AgeHours: number | null;
  EscalatedTo: number | null;
  EscalatedToName: string | null;
  EscalatedAt: string | null;
  LinkedLeadId: number | null;
  ResolvedAt: string | null;
  ClosedAt: string | null;
  ResolutionId: number | null;
  ResolutionName: string | null;
  Description: string | null;
  CreatedBy: number | null;
  CreatedAt: string;
  UpdatedAt: string | null;
  /** Detail only — sp_FetchTicketDetail RS1 adds these; the list SP does not. */
  EditBy?: number | null;
  CustomerContactPerson?: string | null;
  CustomerEmail?: string | null;
  CustomerCity?: string | null;
  CustomerAddress?: string | null;
  /** How many other complaints this customer has raised. */
  PreviousTickets?: number | null;
}

/** A row of tblTicketActivity (sp_FetchTicketDetail RS3), author joined. */
export interface TicketActivityEntry {
  Id: number;
  TicketId: number;
  UserId: number | null;
  UserName: string | null;
  UserAvatar: string | null;
  /** created · updated · status · resolved · closed · rejected · reopened · assigned · escalated · call */
  Type: string;
  Summary: string | null;
  MetaJSON: string | null;
  CreatedAt: string;
}

/** A row of tblTicketAssignment (RS4) — one per transfer, names joined. */
export interface TicketAssignment {
  Id: number;
  FromUserId: number | null;
  FromUserName: string | null;
  ToUserId: number | null;
  ToUserName: string | null;
  FromBranchId: number | null;
  FromBranchName: string | null;
  ToBranchId: number | null;
  ToBranchName: string | null;
  ReasonId: number | null;
  Reason: string | null;
  Remarks: string;
  AssignedBy: number | null;
  AssignedByName: string | null;
  AssignedAt: string;
}

/**
 * A row of tblCall. Exactly one of LeadId / TicketId is set.
 *
 * `Direction` is the SP's own two-value vocabulary — 'in' or 'out'. It rejects
 * anything else, so do not send "Inbound".
 */
export interface Call {
  Id: number;
  CompId: number;
  LeadId: number | null;
  TicketId: number | null;
  UserId: number;
  Direction: "in" | "out";
  OutcomeId: number | null;
  Notes: string | null;
  /** Minutes. */
  Duration: number | null;
  CalledAt: string;
  CreatedBy: number | null;
  CreatedAt: string;
}

/** The lead a ticket was raised from, when there is one (RS5). */
export interface LinkedLead {
  Id: number;
  Name: string | null;
  MobileNo: string | null;
  Email: string | null;
  StatusId: number | null;
}

/** sp_FetchTicketDetail returns five result sets; the controller names them. */
export interface TicketDetail {
  ticket: Ticket | null;
  fields: CustomFieldValue[];
  activity: TicketActivityEntry[];
  assignments: TicketAssignment[];
  linkedLead: LinkedLead | null;
}

/** A row of sp_FetchCustomers RS1 — tblCustomer plus branch name and counts. */
export interface Customer {
  Id: number;
  CompId: number;
  BranchId: number;
  BranchName: string | null;
  /** The business or the person. */
  Name: string;
  ContactPerson: string | null;
  Mobile: string | null;
  AltMobile: string | null;
  Email: string | null;
  Address: string | null;
  City: string | null;
  State: string | null;
  Pincode: string | null;
  Remarks: string | null;
  IsActive: boolean;
  OpenTickets: number;
  TotalTickets: number;
  LastTicketAt: string | null;
  CreatedAt: string;
  UpdatedAt: string | null;
}

/** sp_FetchEscalationTargets — the chain of command above a user, nearest first. */
export interface EscalationTarget {
  Id: number;
  FullName: string;
  JobTitle: string | null;
  BranchId: number | null;
  BranchName: string | null;
  /** 1 = direct manager. */
  Depth: number;
}
```

(d) After the `DirectoryUser` interface (the end of the file) append:

```ts

/** /api/users/fetchAssignableUsers — who the caller may hand a record to. */
export interface AssignableUser {
  Id: number;
  FullName: string;
  Avatar: string | null;
  JobTitle: string | null;
  BranchId: number | null;
  BranchName: string | null;
  ReportsTo: number | null;
}

/** A row of sp_FetchProducts RS1 (tblProduct + category name). */
export interface Product {
  Id: number;
  CompId: number;
  Name: string;
  Code: string | null;
  CategoryId: number | null;
  CategoryName: string | null;
  UnitPrice: number | null;
  MarginPct: number | null;
  IsActive: boolean;
}
```

- [ ] **Step 2: Typecheck to see the consumers break**

Run: `cd mobile && pnpm exec tsc --noEmit`
Expected: errors in `src/api/configQueries.ts` (`Pipeline`, `PipelineStage` not exported), `src/api/ticketQueries.ts` (nothing yet — its own `StageId`/`PipelineId` keys are local), `src/features/support/ticketHelpers.ts` (`PipelineStage`, `StageType`, `Pick<Ticket, "StageId">`), `src/features/support/useTicketRefData.ts`, `ComplaintCard.tsx` (`ticket.Channel`, `ticket.CustomerName`), `ComplaintsScreen.tsx`, `ComplaintDetailScreen.tsx`, `ComplaintFormScreen.tsx`. Nothing outside `src/api/` and `src/features/support/`.

- [ ] **Step 3: Rewrite `ticketQueries.ts`**

Replace the whole of `mobile/src/api/ticketQueries.ts` with:

```ts
// src/api/ticketQueries.ts
// Support / complaints. Payloads taken from
// backend/src/controllers/ticketController.js, not guessed.
//
// The lifecycle rule this file exists to protect: **one engine writes status**.
// `sp_SetTicketStatus` stamps ResolvedAt, ClosedAt, ResolutionId and the reopen
// DueAt; resolve / close / reject / reopen are shortcuts into it. Nothing here
// writes those columns, and `saveTicket` never carries a status — the SP seeds
// the first `open` status on insert and ignores any on update.
import { post, postData } from "./client";
import type {
  ApiEnvelope,
  EscalationTarget,
  Pagination,
  Ticket,
  TicketDetail,
  TicketStatusCode,
} from "../types/api";

export const TICKET_ENDPOINTS = {
  saveTicket: "/api/tickets/saveTicket",
  fetchTickets: "/api/tickets/fetchTickets",
  fetchTicketDetail: "/api/tickets/fetchTicketDetail",
  setTicketStatus: "/api/tickets/setTicketStatus",
  resolveTicket: "/api/tickets/resolveTicket",
  closeTicket: "/api/tickets/closeTicket",
  rejectTicket: "/api/tickets/rejectTicket",
  reopenTicket: "/api/tickets/reopenTicket",
  transferTicket: "/api/tickets/transferTicket",
  escalateTicket: "/api/tickets/escalateTicket",
  fetchEscalationTargets: "/api/tickets/fetchEscalationTargets",
  deleteTicket: "/api/tickets/deleteTicket",
} as const;

// bulkTransferTickets is deliberately absent: multi-select is desk work and
// stays on the web.

export interface FetchTicketsParams {
  /** Narrows within the caller's scope. It can never widen visibility. */
  BranchId?: number | null;
  PageNumber?: number;
  PageSize?: number;
  SearchTerm?: string | null;
  StatusId?: number | null;
  /** One ticket_status code, or `"active"` = open + onhold. */
  StatusCode?: TicketStatusCode | "active" | null;
  Priority?: number | null;
  CategoryId?: number | null;
  ChannelId?: number | null;
  ProductId?: number | null;
  CustomerId?: number | null;
  AssignedTo?: number | null;
  /** Non-terminal and past DueAt. */
  Overdue?: boolean;
  /** Non-terminal and (escalated to the caller OR overdue) — a manager's queue. */
  Escalated?: boolean;
  Unassigned?: boolean;
  /** Window on CreatedAt; `ToDate` inclusive. Local Y-M-D strings. */
  FromDate?: string | null;
  ToDate?: string | null;
}

export interface TicketsPayload {
  tickets: Ticket[];
  pagination: Pagination;
}

/**
 * A record assigned to — or created by — the caller is always visible,
 * OR-ed against branch scope. That rule lives in the SP; the client just asks.
 * Rows come back `ORDER BY IsOverdue DESC, DueAt, CreatedAt DESC` — the list
 * must not re-sort them.
 */
export const fetchTickets = ({
  BranchId = null,
  PageNumber = 1,
  PageSize = 50,
  SearchTerm = null,
  StatusId = null,
  StatusCode = null,
  Priority = null,
  CategoryId = null,
  ChannelId = null,
  ProductId = null,
  CustomerId = null,
  AssignedTo = null,
  Overdue = false,
  Escalated = false,
  Unassigned = false,
  FromDate = null,
  ToDate = null,
}: FetchTicketsParams = {}): Promise<ApiEnvelope<TicketsPayload>> =>
  post<TicketsPayload>(TICKET_ENDPOINTS.fetchTickets, {
    BranchId,
    PageNumber,
    PageSize,
    SearchTerm,
    StatusId,
    StatusCode,
    Priority,
    CategoryId,
    ChannelId,
    ProductId,
    CustomerId,
    AssignedTo,
    // BIT parameters on the SP; 1/0 is the form the controller forwards.
    Overdue: Overdue ? 1 : 0,
    Escalated: Escalated ? 1 : 0,
    Unassigned: Unassigned ? 1 : 0,
    FromDate,
    ToDate,
  });

/**
 * Ticket, custom-field values, timeline, assignment history and the linked
 * lead in one call. Returns a null ticket when the row exists but the caller
 * cannot see it — the controller answers 404 rather than 403 so nobody learns
 * it exists.
 */
export const fetchTicketDetail = (params: {
  TicketId: number;
}): Promise<TicketDetail> =>
  post<TicketDetail>(TICKET_ENDPOINTS.fetchTicketDetail, params).then(
    (response) => ({
      ticket: response.data?.ticket ?? null,
      fields: response.data?.fields ?? [],
      activity: response.data?.activity ?? [],
      assignments: response.data?.assignments ?? [],
      linkedLead: response.data?.linkedLead ?? null,
    }),
  );

export interface SaveTicketPayload {
  /** 0 inserts, > 0 updates. */
  Id?: number;
  /** An active tblCustomer of the company — the SP answers 404 otherwise. */
  CustomerId: number;
  Subject: string;
  /** "Reported by": who called, and how to reach them back. Both optional. */
  ContactPerson?: string | null;
  Contact?: string | null;
  /** tblLookup id, Kind = 'ticket_channel' (a lookup since 086, not a string). */
  ChannelId?: number | null;
  CategoryId: number | null;
  /** tblLookup id, Kind = 'priority'. Its TatHours sets DueAt. */
  Priority: number | null;
  ProductId?: number | null;
  /** Create only — the SP ignores it on update. Reassigning is transferTicket. */
  AssignedTo?: number | null;
  LinkedLeadId?: number | null;
  Description: string;
  /** `[{fieldId, type, value}]`, serialised. Null when the company has none. */
  CustomJSON?: string | null;
}

/** The status row sp_SaveTicket returns, plus the generated number on insert. */
export interface SaveTicketResult {
  Id: number;
  TicketNo?: string | null;
}

export const saveTicket = ({
  Id = 0,
  ContactPerson = null,
  Contact = null,
  ChannelId = null,
  ProductId = null,
  AssignedTo = null,
  LinkedLeadId = null,
  CustomJSON = null,
  ...rest
}: SaveTicketPayload): Promise<ApiEnvelope<SaveTicketResult>> =>
  post(TICKET_ENDPOINTS.saveTicket, {
    Id,
    ContactPerson,
    Contact,
    ChannelId,
    ProductId,
    AssignedTo,
    LinkedLeadId,
    CustomJSON,
    ...rest,
  });

/**
 * The one transition endpoint — every status move goes through it.
 *
 * What the SP requires depends on where the ticket is and where it is going
 * (spec §2): a `ResolutionId` and remarks into Resolved (or straight into
 * Closed from an active status); remarks into Rejected; remarks to reopen a
 * terminal ticket — and reopening is a manager's act. The controller passes
 * its gate result down and the SP answers 403 "Reopening requires a manager"
 * otherwise. Surface that message; do not second-guess it on the client.
 */
export const setTicketStatus = (params: {
  TicketId: number;
  StatusId: number;
  ResolutionId?: number | null;
  Remarks?: string | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.setTicketStatus, {
    ResolutionId: null,
    Remarks: null,
    ...params,
  });

/** Shortcut into setTicketStatus — the company's first `resolved` status. */
export const resolveTicket = (params: {
  TicketId: number;
  ResolutionId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.resolveTicket, params);

/** Shortcut — the first `closed` status. Resolution only when coming from active. */
export const closeTicket = (params: {
  TicketId: number;
  ResolutionId?: number | null;
  Remarks?: string | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.closeTicket, {
    ResolutionId: null,
    Remarks: null,
    ...params,
  });

/** Shortcut — the first `rejected` status. Never solved; remarks required. */
export const rejectTicket = (params: {
  TicketId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.rejectTicket, params);

/** Shortcut — back to the first `open` status. Manager-gated server-side. */
export const reopenTicket = (params: {
  TicketId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.reopenTicket, params);

/**
 * Hands the complaint to someone in the caller's assignable list, with a
 * reason (`transfer_reason` lookup) and remarks — both required. The SP writes
 * the assignment row, stamps AssignedAt and notifies the new assignee.
 * `ToBranchId` only when the target sits in another branch; whether the caller
 * MAY do that is decided server-side (wide scopes only).
 */
export const transferTicket = (params: {
  TicketId: number;
  ToUserId: number;
  ToBranchId?: number | null;
  ReasonId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.transferTicket, { ToBranchId: null, ...params });

/**
 * Flags a senior; the ticket stays with its assignee. The target must be an
 * ancestor (ReportsTo chain) of the assignee — offer only what
 * fetchEscalationTargets returned and let the SP's 400 explain anything else.
 */
export const escalateTicket = (params: {
  TicketId: number;
  ToUserId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.escalateTicket, params);

/**
 * The chain of command above `forUserId` (default: the caller), nearest first.
 * Pass the ticket's assignee — an escalation is about who is *working* it.
 */
export const fetchEscalationTargets = (
  forUserId: number | null = null,
): Promise<EscalationTarget[]> =>
  postData<EscalationTarget>(
    TICKET_ENDPOINTS.fetchEscalationTargets,
    { ForUserId: forUserId },
    "users",
  );

export const deleteTicket = (params: {
  Id: number;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.deleteTicket, params);
```

- [ ] **Step 4: Take the pipeline engine out of `configQueries.ts`**

Replace lines 1–59 of `mobile/src/api/configQueries.ts` (everything before `fetchCustomFields`) with:

```ts
// src/api/configQueries.ts
// The per-company config engine, shared by Support and Sales. One set of
// tables — tblLookup, tblCustomFieldDef — discriminated by `Entity`/`Kind`, so
// a ticket category and a lead source are the same row shape in the same
// table. The pipeline engine (tblPipeline/tblPipelineStage) was dropped in 086;
// tickets carry a flat `ticket_status` lookup with a Code, like leads.
//
// Payloads taken from backend/src/controllers/configController.js.
import { postData } from "./client";
import type { ConfigEntity, CustomFieldDef, Lookup } from "../types/api";

export const CONFIG_ENDPOINTS = {
  fetchLookups: "/api/config/fetchLookups",
  fetchCustomFields: "/api/config/fetchCustomFields",
} as const;

// Writes (saveLookup, saveCustomField and their deletes) are deliberately
// absent: configuring a company's lists and field definitions is admin desk
// work and stays on the web.

/**
 * The lists a phone actually needs. `Kind` is free text in the DB, so these
 * constants exist to stop a typo becoming an empty picker with no error.
 */
export const LOOKUP_KIND = {
  ticketCategory: "ticket_category",
  ticketStatus: "ticket_status",
  ticketChannel: "ticket_channel",
  priority: "priority",
  resolution: "resolution",
  callOutcome: "call_outcome",
  transferReason: "transfer_reason",
  leadSource: "lead_source",
  lostReason: "lost_reason",
} as const;

export type LookupKind = (typeof LOOKUP_KIND)[keyof typeof LOOKUP_KIND];

/** Active rows of one kind, in SortOrder. `Code` and `TatHours` travel with the row. */
export const fetchLookups = (params: { Kind: LookupKind | string }): Promise<Lookup[]> =>
  postData<Lookup>(CONFIG_ENDPOINTS.fetchLookups, params, "lookups");

```

`fetchCustomFields` (the old lines 61–68) stays exactly as it is.

- [ ] **Step 5: Add `fetchAssignableUsers` to `userQueries.ts`**

In `mobile/src/api/userQueries.ts` change the import on line 5 to:

```ts
import type { ApiEnvelope, AssignableUser, DirectoryUser } from "../types/api";
```

Add the endpoint inside `USER_ENDPOINTS` (after line 8):

```ts
  fetchAssignableUsers: "/api/users/fetchAssignableUsers",
```

And after `fetchUserDirectory` (after line 24) add:

```ts

/**
 * Who the caller may hand a record to. sp_FetchAssignableUsers scopes it
 * (own subtree + own manager for Team/Self; readable branches for wide
 * scopes) and `assertCanAssign` re-checks membership on every save and
 * transfer — this is the pick-list, not the gate. `BranchId` lists another
 * branch's roster for a cross-branch move; mobile never passes it.
 */
export const fetchAssignableUsers = (
  params: { BranchId?: number | null } = {},
): Promise<AssignableUser[]> =>
  postData<AssignableUser>(
    USER_ENDPOINTS.fetchAssignableUsers,
    { BranchId: null, ...params },
    "users",
  );
```

- [ ] **Step 6: Create `customerQueries.ts` and `productQueries.ts`**

`mobile/src/api/customerQueries.ts`:

```ts
// src/api/customerQueries.ts
// The customer behind a complaint. Payloads taken from
// backend/src/controllers/customerController.js.
//
// Mobile has no Customers screen — the complaint form embeds a search-or-create
// picker, so only the two calls it needs live here. Customer detail and delete
// are desk work and stay on the web.
import { post, postData } from "./client";
import type { ApiEnvelope, Customer } from "../types/api";

export const CUSTOMER_ENDPOINTS = {
  fetchCustomers: "/api/customers/fetchCustomers",
  saveCustomer: "/api/customers/saveCustomer",
} as const;

/**
 * Company-wide on purpose: a customer is one record however many branches they
 * have complained to, and the picker has to find the existing row before
 * someone creates a fourth spelling of the same mobile. The SP searches
 * Name / ContactPerson / Mobile / Email / City.
 */
export const fetchCustomers = ({
  SearchTerm = null,
  PageSize = 10,
}: { SearchTerm?: string | null; PageSize?: number } = {}): Promise<Customer[]> =>
  postData<Customer>(
    CUSTOMER_ENDPOINTS.fetchCustomers,
    { PageNumber: 1, PageSize, SearchTerm, BranchId: null, IsActive: true },
    "customers",
  );

export interface SaveCustomerPayload {
  /** 0 inserts, > 0 updates. */
  Id?: number;
  /** The business or the person. Required. */
  Name: string;
  ContactPerson?: string | null;
  /**
   * Digits and `+` only. The SP strips spaces/dashes and answers 409 when
   * another active customer in the company already has that mobile.
   */
  Mobile?: string | null;
  AltMobile?: string | null;
  Email?: string | null;
  Address?: string | null;
  City?: string | null;
  State?: string | null;
  Pincode?: string | null;
  Remarks?: string | null;
}

/** Mobile OR email is required — the SP answers 400 with neither. `data.Id` is the row. */
export const saveCustomer = ({
  Id = 0,
  Name,
  ContactPerson = null,
  Mobile = null,
  AltMobile = null,
  Email = null,
  Address = null,
  City = null,
  State = null,
  Pincode = null,
  Remarks = null,
}: SaveCustomerPayload): Promise<ApiEnvelope<{ Id: number }>> =>
  post(CUSTOMER_ENDPOINTS.saveCustomer, {
    Id,
    Name,
    ContactPerson,
    Mobile,
    AltMobile,
    Email,
    Address,
    City,
    State,
    Pincode,
    Remarks,
  });
```

`mobile/src/api/productQueries.ts`:

```ts
// src/api/productQueries.ts
// Read-only product pick-list. Payload taken from
// backend/src/controllers/productController.js. Maintaining the master
// (saveProduct / deleteProduct) is admin desk work and stays on the web.
import { postData } from "./client";
import type { Product } from "../types/api";

export const PRODUCT_ENDPOINTS = {
  fetchProducts: "/api/products/fetchProducts",
} as const;

/** Every active product, name order. 200 is the controller's page ceiling. */
export const fetchProducts = (): Promise<Product[]> =>
  postData<Product>(
    PRODUCT_ENDPOINTS.fetchProducts,
    { PageNumber: 1, PageSize: 200, SearchTerm: null, CategoryId: null, IsActive: true },
    "products",
  );
```

- [ ] **Step 7: Typecheck — the API layer is clean, the feature is not yet**

Run: `cd mobile && pnpm exec tsc --noEmit`
Expected: **no** error in `src/api/**`, `src/types/**`, `src/features/hub/**`, `src/ui/**`. Errors remain only in the five files under `src/features/support/` (`ticketHelpers.ts`, `useTicketRefData.ts`, `ComplaintCard.tsx`, `ComplaintsScreen.tsx`, `ComplaintDetailScreen.tsx`, `ComplaintFormScreen.tsx`) — they reference `fetchPipelines`, `moveTicketStage`, `PipelineStage`, `StageType`, `ticket.StageId`, `ticket.Channel`, `ticket.CustomerName`, and the old `SaveTicketPayload` keys. Tasks 20–23 rewrite every one of them; Task 24 is the clean gate. Any error outside that folder is a defect in this task.

- [ ] **Step 8: Lint**

Run: `cd mobile && pnpm lint`
Expected: 0 errors. One pre-existing warning about `axios.create` in `src/api/client.ts` is fine. No `no-unused-vars` on the new files (every import is used).

- [ ] **Step 9: Stop and report**

Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched (2 created, 4 modified), the `tsc` result line and the list of files still erroring (must be exactly the six `src/features/support/*` files), the `pnpm lint` result line, anything ambiguous.

---

### Task 20: `ticketHelpers` + `useTicketRefData`

**Files:**
- Modify: `mobile/src/features/support/ticketHelpers.ts` (whole file, 244 lines today — lifecycle section rewritten on `StatusCode`; `CHANNELS`/`channelLabel`/`stageRoles`/`stageOf`/`needsResolution`/`STAGE_TONE`/`groupByLifecycle`/`LIFECYCLE_*` deleted; custom-field helpers kept verbatim)
- Modify: `mobile/src/features/support/useTicketRefData.ts` (whole file, 106 lines today)
- Modify: `mobile/src/features/hub/WorkHubScreen.tsx:16-19, 76-102, 133` (the open-complaints count no longer needs stages)
- Test: none — mobile is exempt. Gate is `pnpm exec tsc --noEmit` + `pnpm lint`.

**Interfaces:**
- Consumes (Task 19): `Ticket`, `TicketStatusCode`, `Lookup`, `AssignableUser` from `types/api.ts`; `fetchLookups`, `LOOKUP_KIND` from `api/configQueries.ts`; `fetchAssignableUsers` from `api/userQueries.ts`; `fetchTickets` from `api/ticketQueries.ts`; `ChipTone` from `src/ui/index.ts:43`.
- Produces (Tasks 21–23 import exactly these from `./ticketHelpers`): `lookupMap(lookups)`, `asOptions(lookups)`, `asStatusCode(code)`, `lifecycleOf(ticket): TicketStatusCode`, `isActive(code)`, `isTerminal(code)`, `STATUS_TONE`, `statusTone(code): ChipTone`, `priorityTone(name): ChipTone`, `dueLabel(ticket, now?): { label: string; overdue: boolean } | null`, `tatLabel(hours)`, and the unchanged `draftFromValues`, `blankDraft`, `serialiseCustomFields`, `missingRequired`. From `./useTicketRefData`: `useTicketRefData(): TicketRefData` with `statuses, categories, priorities, channels, resolutions, transferReasons, callOutcomes, users` — **no argument any more** (there is no pipeline to scope to).

Decisions taken here: `dueLabel` returns `{ label, overdue }` rather than a bare string so the card can pick its tone from the same call (`overdue` mirrors the row's SP-computed `IsOverdue`; the phone clock only phrases the gap). `users` in the ref data = **assignable** users (what the form's Assign-to and the detail's Transfer must offer, or `assertCanAssign` answers 403) — not the directory. The hub counts active complaints with `PageSize: 1` and reads `pagination.totalRecords` under its own key, instead of sharing the list's key and parameters.

- [ ] **Step 1: Rewrite `ticketHelpers.ts`**

Replace the whole of `mobile/src/features/support/ticketHelpers.ts` with:

```ts
import type {
  CustomFieldDef,
  CustomFieldValue,
  Lookup,
  Ticket,
  TicketStatusCode,
} from "../../types/api";
import type { ChipTone } from "../../ui";

// ---------------------------------------------------------------- lookups

/** `{Id: Value}` for the few ids a row does not carry a name for. */
export const lookupMap = (lookups: Lookup[] | undefined): Map<number, string> =>
  new Map((lookups ?? []).map((l) => [l.Id, l.Value]));

export const asOptions = (lookups: Lookup[] | undefined) =>
  (lookups ?? []).map((l) => ({ value: l.Id, label: l.Value }));

// --------------------------------------------------------------- lifecycle

const CODES: ReadonlySet<string> = new Set<TicketStatusCode>([
  "open",
  "onhold",
  "resolved",
  "closed",
  "rejected",
]);

/**
 * Normalises whatever the API sent to one of the five codes. sp_SaveLookup
 * rejects anything else for `ticket_status`, so the fallback only ever meets a
 * NULL — read as open, the one reading that cannot hide work.
 */
export const asStatusCode = (
  code: string | null | undefined,
): TicketStatusCode =>
  code && CODES.has(code) ? (code as TicketStatusCode) : "open";

/**
 * Where a ticket sits, read from its status CODE — never from its label
 * (per-company, editable) and never from its timestamps.
 */
export const lifecycleOf = (
  ticket: Pick<Ticket, "StatusCode">,
): TicketStatusCode => asStatusCode(ticket.StatusCode);

/** Still being worked: open or on hold. */
export const isActive = (code: TicketStatusCode): boolean =>
  code === "open" || code === "onhold";

/** Resolved, closed or rejected — nothing left to do unless it is reopened. */
export const isTerminal = (code: TicketStatusCode): boolean => !isActive(code);

export const STATUS_TONE: Record<TicketStatusCode, ChipTone> = {
  open: "info",
  onhold: "warning",
  resolved: "success",
  closed: "neutral",
  rejected: "danger",
};

export const statusTone = (code: TicketStatusCode): ChipTone =>
  STATUS_TONE[code];

/**
 * Priority is a per-company lookup row, so its *name* is the only thing that
 * can be matched on — there is no enum and ids differ between companies.
 * Anything unrecognised falls back to neutral rather than guessing.
 */
export function priorityTone(name: string | null | undefined): ChipTone {
  const key = (name ?? "").toLowerCase();
  if (key.includes("urgent") || key.includes("critical")) return "danger";
  if (key.includes("high")) return "danger";
  if (key.includes("medium") || key.includes("normal")) return "warning";
  if (key.includes("low")) return "success";
  return "neutral";
}

// --------------------------------------------------------------------- TAT

/** "45m" / "4h" / "3d" — whole units, never "1.5h". */
const span = (ms: number): string => {
  const mins = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
};

/**
 * "Due in 4h" / "Overdue by 2d", or null.
 *
 * Null for a terminal ticket (the clock has stopped) and when the priority has
 * no TAT (`DueAt` NULL — such a ticket is never overdue). `overdue` mirrors the
 * row's `IsOverdue`, which the SP computes; the phone's clock only phrases the
 * gap. `DueAt` is a datetime instant (the backend runs `useUTC: false`, pinned
 * to Asia/Kolkata), so plain `new Date()` parsing is right here — unlike a
 * task's date-only DueDate.
 */
export function dueLabel(
  ticket: Pick<Ticket, "DueAt" | "IsOverdue" | "StatusCode">,
  now = new Date(),
): { label: string; overdue: boolean } | null {
  if (!ticket.DueAt || isTerminal(lifecycleOf(ticket))) return null;
  const due = new Date(ticket.DueAt).getTime();
  if (Number.isNaN(due)) return null;
  const gap = due - now.getTime();
  const overdue = Boolean(ticket.IsOverdue) || gap < 0;
  return {
    label: overdue ? `Overdue by ${span(gap)}` : `Due in ${span(gap)}`,
    overdue,
  };
}

/** "4h" / "3 days" for a priority's TatHours — the form's hint. Null = no clock. */
export const tatLabel = (hours: number | null | undefined): string | null =>
  hours == null
    ? null
    : hours < 48
      ? `${hours}h`
      : `${Math.round(hours / 24)} days`;

// ------------------------------------------------------------ custom fields

/**
 * A stored value, back in the shape the form edits. The EAV row splits by type
 * across three columns and only one of them is populated.
 */
export function draftFromValues(
  values: CustomFieldValue[],
): Record<number, string | boolean> {
  const draft: Record<number, string | boolean> = {};
  for (const value of values) {
    if (value.Type === "checkbox") {
      draft[value.FieldId] = value.ValueText === "true" || value.ValueNumber === 1;
    } else if (value.Type === "number") {
      draft[value.FieldId] = value.ValueNumber == null ? "" : String(value.ValueNumber);
    } else if (value.Type === "date") {
      draft[value.FieldId] = value.ValueDate ? value.ValueDate.slice(0, 10) : "";
    } else {
      draft[value.FieldId] = value.ValueText ?? "";
    }
  }
  return draft;
}

/** Seed a blank entry per definition so every field is controlled from render one. */
export function blankDraft(
  defs: CustomFieldDef[],
): Record<number, string | boolean> {
  const draft: Record<number, string | boolean> = {};
  for (const def of defs) draft[def.Id] = def.Type === "checkbox" ? false : "";
  return draft;
}

/** The `CustomJSON` payload sp_SaveTicket expects. */
export const serialiseCustomFields = (
  defs: CustomFieldDef[],
  draft: Record<number, string | boolean>,
): string | null =>
  defs.length
    ? JSON.stringify(
        defs.map((def) => ({
          fieldId: def.Id,
          type: def.Type,
          value: draft[def.Id] ?? (def.Type === "checkbox" ? false : ""),
        })),
      )
    : null;

/** Which required custom fields are still empty. Empty array = good to submit. */
export const missingRequired = (
  defs: CustomFieldDef[],
  draft: Record<number, string | boolean>,
): CustomFieldDef[] =>
  defs.filter((def) => {
    if (!def.IsRequired) return false;
    const value = draft[def.Id];
    // An unticked required checkbox is a genuine "you must agree" — treat
    // false as missing, the same way the web does.
    if (def.Type === "checkbox") return value !== true;
    return !String(value ?? "").trim();
  });
```

- [ ] **Step 2: Typecheck to see who still calls the old shapes**

Run: `cd mobile && pnpm exec tsc --noEmit`
Expected: `useTicketRefData.ts` — `stageRoles`/`StageRoles` not exported, `fetchPipelines` not exported; `WorkHubScreen.tsx:99` — `lifecycleOf` expected 1 argument, got 2, and `useTicketRefData("all")` expected 0 arguments; the four screens — `channelLabel`, `needsResolution`, `stageOf`, `LIFECYCLE_LABEL`, `CHANNELS`, `StageRoles` not exported. Nothing in `src/api/`, `src/types/`, `src/ui/`.

- [ ] **Step 3: Rewrite `useTicketRefData.ts`**

Replace the whole of `mobile/src/features/support/useTicketRefData.ts` with:

```ts
import { useQueries } from "@tanstack/react-query";

import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { AssignableUser, Lookup } from "../../types/api";

/**
 * The reference data every complaint screen needs — for PICKERS only.
 *
 * Since 086 sp_FetchTickets joins every name a row displays (StatusName,
 * PriorityName, AssigneeName, …), so nothing here is needed to render a card
 * or a fact. What remains is the set of lists a screen offers as choices: the
 * status sheet and filter chips, the resolve / transfer / call sheets, and the
 * form's selects.
 *
 * The query keys stay per-kind (`["lookups", kind]`), so this shares React
 * Query's cache with anything already fetching them rather than introducing a
 * second copy — moving between the three screens still costs nothing.
 *
 * `useQueries` rather than a stack of `useQuery` calls: the set is fixed, and
 * one array keeps the screens from drifting apart again over which lists they
 * happen to ask for.
 */
export interface TicketRefData {
  /** ticket_status rows in SortOrder — each carries its Code. */
  statuses: Lookup[];
  categories: Lookup[];
  /** Each carries TatHours; the form shows "due in Nh" off it. */
  priorities: Lookup[];
  channels: Lookup[];
  resolutions: Lookup[];
  transferReasons: Lookup[];
  callOutcomes: Lookup[];
  /**
   * Who the caller may assign or transfer to. Server-scoped: own subtree plus
   * own manager for Team/Self, readable branches for wide scopes. Offering
   * anyone else earns a 403 from assertCanAssign at save time.
   */
  users: AssignableUser[];
}

const lookup = (kind: string) => ({
  queryKey: ["lookups", kind],
  queryFn: () => fetchLookups({ Kind: kind }),
});

export function useTicketRefData(): TicketRefData {
  return useQueries({
    queries: [
      lookup(LOOKUP_KIND.ticketStatus),
      lookup(LOOKUP_KIND.ticketCategory),
      lookup(LOOKUP_KIND.priority),
      lookup(LOOKUP_KIND.ticketChannel),
      lookup(LOOKUP_KIND.resolution),
      lookup(LOOKUP_KIND.transferReason),
      lookup(LOOKUP_KIND.callOutcome),
      {
        queryKey: ["users", "assignable"],
        queryFn: () => fetchAssignableUsers(),
      },
    ],
    // Derived here rather than in each screen's own useMemo — useQueries only
    // re-runs this when a result actually changes.
    combine: (r) => ({
      statuses: r[0]?.data ?? [],
      categories: r[1]?.data ?? [],
      priorities: r[2]?.data ?? [],
      channels: r[3]?.data ?? [],
      resolutions: r[4]?.data ?? [],
      transferReasons: r[5]?.data ?? [],
      callOutcomes: r[6]?.data ?? [],
      users: r[7]?.data ?? [],
    }),
  });
}

export default useTicketRefData;
```

- [ ] **Step 4: Fix the hub's open-complaints count**

In `mobile/src/features/hub/WorkHubScreen.tsx`:

Delete lines 18–19:

```ts
import { lifecycleOf } from "../support/ticketHelpers";
import { useTicketRefData } from "../support/useTicketRefData";
```

Replace lines 76–86 (the comment block + the `tickets` query) with:

```ts
  // A count, not a list: PageSize 1 and read the total. Under its OWN key —
  // this used to share the Complaints list's key, which meant sharing its
  // parameters too, and the two disagreed once (hub 100 rows, screen 200;
  // whichever mounted first won). "active" = open + onhold, company-scoped by
  // the SP exactly as the list is.
  const { data: activeTickets } = useQuery({
    queryKey: ["tickets", "active-count"],
    queryFn: () => fetchTickets({ StatusCode: "active", PageSize: 1 }),
  });
  const openComplaints = activeTickets?.data?.pagination.totalRecords ?? 0;
```

Delete lines 92–102 (the `"all" on purpose…` comment, `const { roles } = useTicketRefData("all");` and the `openComplaints` `useMemo`). `useMemo` stays imported — `routes` still uses it.

On line 133 replace the Support row's menu routes:

```ts
          routes: ["/support", "/support/tickets", "/support/customers"],
```

(`/support/board` is deleted from `tblMenu` by `086`; `/support/customers` is the row it adds under the same parent.)

- [ ] **Step 5: Typecheck — only the four screens remain**

Run: `cd mobile && pnpm exec tsc --noEmit`
Expected: errors only in `src/features/support/ComplaintCard.tsx`, `ComplaintsScreen.tsx`, `ComplaintDetailScreen.tsx`, `ComplaintFormScreen.tsx` (rewritten by Tasks 21–23). `ticketHelpers.ts`, `useTicketRefData.ts` and `WorkHubScreen.tsx` must be clean. In particular no error on `r[7]?.data` — `useQueries` infers the tuple from the array literal, as the previous version relied on.

- [ ] **Step 6: Lint**

Run: `cd mobile && pnpm lint`
Expected: 0 errors. `WorkHubScreen.tsx` must not report `no-unused-vars` for `useMemo` (still used by `routes`).

- [ ] **Step 7: Stop and report**

Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched (3), the `tsc` result line with the remaining erroring files (must be exactly the four screens), the `pnpm lint` result line, anything ambiguous.

---

### Task 21: `ComplaintsScreen` list + `ComplaintCard`

**Files:**
- Modify: `mobile/src/features/support/ComplaintCard.tsx` (whole file, 174 lines today)
- Modify: `mobile/src/features/support/ComplaintsScreen.tsx` (whole file, 365 lines today — the stage board becomes a list; `BoardColumns` stays for tasks, `mobile/src/ui/BoardColumns.tsx` is not touched)
- Test: none — mobile is exempt. Gate is `pnpm exec tsc --noEmit` + `pnpm lint`.

**Interfaces:**
- Consumes: `fetchTickets`, `FetchTicketsParams` (Task 19); `Ticket` (Task 19); `lifecycleOf`, `statusTone`, `priorityTone`, `dueLabel` (Task 20); `useTicketRefData().statuses` (Task 20); `relativeTime` from `mobile/src/features/tasks/taskHelpers.ts:123`; `useAuthStore((s) => s.UserId)`; `src/ui`: `Card`, `Chip`, `ChipGroup`, `Segmented`, `Input`, `Refresher`, `Fab`, `EmptyState`, `Screen`, `ScreenHeader`, `Text`.
- Produces: `ComplaintCard({ ticket, onPress })` — no lookup maps any more, every name is on the row; `ComplaintsScreen` default export (route `Complaints`, unchanged in `RootNavigator.tsx:41`).

Decisions taken here: the four queues map to server filters exactly as the brief lists — *Mine* `{ AssignedTo: me, StatusCode: "active" }`, *Team* `{ StatusCode: "active" }`, *Overdue* `{ Overdue: 1 }`, *Escalated* `{ Escalated: 1 }`. The status chip row is "Active" + every `ticket_status` row; picking a specific status sends `StatusId` and drops `StatusCode` (ANDing "active" with "Resolved" is the empty set). The query key is `["tickets", params]` — the whole parameter object — so two queues never share a cache entry; every mutation elsewhere invalidates the `["tickets"]` prefix as before. Rows keep the SP's order (`IsOverdue DESC, DueAt, CreatedAt DESC`); the list does not re-sort.

- [ ] **Step 1: Rewrite `ComplaintCard.tsx`**

Replace the whole of `mobile/src/features/support/ComplaintCard.tsx` with:

```tsx
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { ArrowUpRight, Clock, Flag, Hash, User } from "lucide-react-native";

import type { Ticket } from "../../types/api";
import { colors, spacing } from "../../theme";
import { Card, Chip, Text } from "../../ui";
import { relativeTime } from "../tasks/taskHelpers";
import { dueLabel, lifecycleOf, priorityTone, statusTone } from "./ticketHelpers";

interface ComplaintCardProps {
  ticket: Ticket;
  onPress: (ticket: Ticket) => void;
}

/**
 * One complaint in the list. Everything on it comes off the row — since 086
 * sp_FetchTickets joins the names — so the card takes no lookup maps.
 *
 * Reads top-down the way a queue is scanned: what is wrong (Subject), whose
 * it is (number + customer), then the chips that say how urgent it is —
 * status, priority, the TAT clock (red once it has run out) and a flag when a
 * senior has been pulled in. Who holds it and how old it is close the card.
 */
function ComplaintCardBase({ ticket, onPress }: ComplaintCardProps) {
  const code = lifecycleOf(ticket);
  const due = dueLabel(ticket);

  return (
    <Card onPress={() => onPress(ticket)}>
      <Text variant="h3" numberOfLines={2}>
        {ticket.Subject}
      </Text>

      <View style={styles.row}>
        <Hash size={13} color={colors.textMuted} />
        <Text variant="caption" color="textMuted">
          {ticket.TicketNo}
        </Text>
        <Text variant="caption" color="textMuted">
          ·
        </Text>
        <Text
          variant="caption"
          color="textSecondary"
          numberOfLines={1}
          style={styles.grow}
        >
          {ticket.CustomerName || "Unnamed customer"}
        </Text>
      </View>

      <View style={styles.chips}>
        <Chip label={ticket.StatusName ?? code} tone={statusTone(code)} />
        {ticket.PriorityName ? (
          <Chip
            label={ticket.PriorityName}
            icon={Flag}
            tone={priorityTone(ticket.PriorityName)}
          />
        ) : null}
        {due ? (
          <Chip
            label={due.label}
            icon={Clock}
            tone={due.overdue ? "danger" : "neutral"}
          />
        ) : null}
        {ticket.EscalatedTo ? (
          <Chip label="Escalated" icon={ArrowUpRight} tone="primary" />
        ) : null}
      </View>

      <View style={styles.row}>
        <User size={13} color={colors.textMuted} />
        <Text
          variant="caption"
          color={ticket.AssigneeName ? "textSecondary" : "textMuted"}
          numberOfLines={1}
          style={styles.grow}
        >
          {ticket.AssigneeName ?? "Unassigned"}
        </Text>
        <Text variant="caption" color="textMuted">
          {relativeTime(ticket.CreatedAt)}
        </Text>
      </View>
    </Card>
  );
}

export const ComplaintCard = memo(ComplaintCardBase);
export default ComplaintCard;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  grow: { flex: 1 },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
  },
});
```

- [ ] **Step 2: Typecheck to see the list break against the new card**

Run: `cd mobile && pnpm exec tsc --noEmit`
Expected: `ComplaintCard.tsx` clean. `ComplaintsScreen.tsx` errors — `roles`, `categories`, `priorities`, `people`, `onLongPress`, `showStage` are not props of `ComplaintCard`; plus its existing `moveTicketStage` / `PipelineStage` / `needsResolution` errors. `ComplaintDetailScreen.tsx` and `ComplaintFormScreen.tsx` still error (Tasks 22–23).

- [ ] **Step 3: Rewrite `ComplaintsScreen.tsx` as a list**

Replace the whole of `mobile/src/features/support/ComplaintsScreen.tsx` with:

```tsx
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CloudOff, Headset, Plus, Search } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchTickets, type FetchTicketsParams } from "../../api/ticketQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { Ticket } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  ChipGroup,
  EmptyState,
  Fab,
  Input,
  Refresher,
  Screen,
  ScreenHeader,
  Segmented,
} from "../../ui";
import { ComplaintCard } from "./ComplaintCard";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "Complaints">;

/** The four queues — WHICH rows. A status chip then narrows within one. */
type Queue = "mine" | "team" | "overdue" | "escalated";

const QUEUES: { value: Queue; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "team", label: "Team" },
  { value: "overdue", label: "Overdue" },
  { value: "escalated", label: "Escalated" },
];

const SUBTITLE: Record<Queue, string> = {
  mine: "assigned to you",
  team: "in your team",
  overdue: "overdue",
  escalated: "escalated",
};

const EMPTY: Record<Queue, { title: string; message: string }> = {
  mine: {
    title: "Nothing on your plate",
    message: "Complaints assigned to you that are still open show up here.",
  },
  team: {
    title: "No open complaints",
    message: "Everything you can see is resolved, closed or rejected.",
  },
  overdue: {
    title: "Nothing overdue",
    message: "Every open complaint is inside its due time.",
  },
  escalated: {
    title: "Nothing escalated",
    message: "Complaints escalated to you, or overdue under you, land here.",
  },
};

/** "active" = every open/onhold status; a number = one ticket_status id. */
type StatusFilter = "active" | number;

/**
 * Which server-side filters each queue is, in one place, so the header count
 * and the list cannot disagree about what "Mine" means.
 *
 *   mine       assigned to me, still active
 *   team       everything I can see, still active — scope is the SP's
 *   overdue    non-terminal and past DueAt (the SP computes it; never stored)
 *   escalated  non-terminal and (escalated to me OR overdue) — a manager's queue
 *
 * A status chip other than "Active" replaces StatusCode with StatusId: sending
 * both would AND them, and "Resolved" within "active" is the empty set.
 */
function queueParams(
  queue: Queue,
  status: StatusFilter,
  userId: number | null,
  term: string,
): FetchTicketsParams {
  return {
    PageSize: 200,
    SearchTerm: term || null,
    AssignedTo: queue === "mine" ? userId : null,
    StatusCode: status === "active" ? "active" : null,
    StatusId: status === "active" ? null : status,
    Overdue: queue === "overdue",
    Escalated: queue === "escalated",
  };
}

/**
 * The complaints queue — a list, not a board.
 *
 * The board went with the pipeline engine (086). A stage column answered
 * "what is where"; a flat status with a due date answers the question a phone
 * is actually asked — what is mine, what is late, what has been pushed up to
 * me — and those are the four segments. Sorting is the server's:
 * overdue first, then by due time.
 */
export default function ComplaintsScreen({ navigation }: Props) {
  const userId = useAuthStore((s) => s.UserId);

  const [queue, setQueue] = useState<Queue>("mine");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");

  // Deferred rather than debounced with a timer: React keeps the old list on
  // screen while the new query resolves, so typing never blanks it and there
  // is no timeout to clean up.
  const term = useDeferredValue(search.trim());

  const params = useMemo(
    () => queueParams(queue, status, userId, term),
    [queue, status, userId, term],
  );

  const ticketsQuery = useQuery({
    queryKey: ["tickets", params],
    queryFn: () => fetchTickets(params),
  });

  // Only the status list is needed here — every name on a card is on the row.
  const { statuses } = useTicketRefData();

  const statusOptions = useMemo(
    () => [
      { value: "active" as StatusFilter, label: "Active" },
      ...statuses.map((s) => ({ value: s.Id as StatusFilter, label: s.Value })),
    ],
    [statuses],
  );

  const tickets = ticketsQuery.data?.data?.tickets ?? [];
  const total = ticketsQuery.data?.data?.pagination.totalRecords ?? tickets.length;
  const narrowed = status !== "active" || term.length > 0;

  const openTicket = useCallback(
    (ticket: Ticket) =>
      navigation.navigate("ComplaintDetail", { ticketId: ticket.Id }),
    [navigation],
  );

  return (
    <Screen>
      <ScreenHeader
        title="Complaints"
        subtitle={`${total} ${SUBTITLE[queue]}`}
        tint="danger"
        onBack={navigation.goBack}
      />

      <View style={styles.controls}>
        <Segmented value={queue} options={QUEUES} onChange={setQueue} />
        <ChipGroup
          label="Filter by status"
          value={status}
          options={statusOptions}
          onChange={setStatus}
        />
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Ticket no., subject, customer or mobile"
          leftIcon={Search}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={tickets}
        keyExtractor={(ticket) => String(ticket.Id)}
        contentContainerStyle={[styles.list, !tickets.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <Refresher
            refreshing={ticketsQuery.isRefetching && !ticketsQuery.isLoading}
            onRefresh={ticketsQuery.refetch}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ComplaintCard ticket={item} onPress={openTicket} />
          </View>
        )}
        ListEmptyComponent={
          ticketsQuery.isLoading ? null : (
            <EmptyState
              icon={ticketsQuery.isError ? CloudOff : Headset}
              title={
                ticketsQuery.isError
                  ? "Couldn't load complaints"
                  : narrowed
                    ? "Nothing matches"
                    : EMPTY[queue].title
              }
              message={
                ticketsQuery.isError
                  ? "Pull down to try again."
                  : narrowed
                    ? "Try another status, or clear the search."
                    : EMPTY[queue].message
              }
            />
          )
        }
      />

      <Fab
        icon={Plus}
        accessibilityLabel="Log a complaint"
        onPress={() => navigation.navigate("ComplaintForm", {})}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // Clears the FAB so the last card stays reachable.
  list: { paddingTop: spacing[4], paddingBottom: spacing[20] },
  listEmpty: { flexGrow: 1 },
  // 20 between cards: the gap has to out-reach the card shadow, or stacked
  // shadows meet and the list reads as one grey slab (My Work does the same).
  cardWrap: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[5] },
});
```

- [ ] **Step 4: Typecheck — only detail and form remain**

Run: `cd mobile && pnpm exec tsc --noEmit`
Expected: `ComplaintCard.tsx` and `ComplaintsScreen.tsx` clean. Errors remain only in `ComplaintDetailScreen.tsx` and `ComplaintFormScreen.tsx` (Tasks 22–23). Two things worth confirming in the output: `Segmented` accepts `onChange={setQueue}` (a `Dispatch<SetStateAction<Queue>>` is assignable to `(value: Queue) => void`), and `ChipGroup` infers `T = StatusFilter` from `statusOptions`.

- [ ] **Step 5: Lint**

Run: `cd mobile && pnpm lint`
Expected: 0 errors; no `react-native/no-unused-styles` warning on either file (every style key is referenced).

- [ ] **Step 6: Stop and report**

Leave the changes uncommitted (CLAUDE.md §0.1). Report: files touched (2), the `tsc` result line with the remaining erroring files (must be exactly `ComplaintDetailScreen.tsx` and `ComplaintFormScreen.tsx`), the `pnpm lint` result line, anything ambiguous.

---

### Task 22: `ComplaintDetailScreen`

**Files:**
- Modify: `mobile/src/features/support/ComplaintDetailScreen.tsx` (whole file, 655 lines today)
- Test: none — mobile is exempt. Gate is `pnpm exec tsc --noEmit` + `pnpm lint`.

**Interfaces:**
- Consumes: `fetchTicketDetail`, `setTicketStatus`, `transferTicket`, `escalateTicket`, `fetchEscalationTargets`, `deleteTicket` (Task 19); `fetchCalls`, `logCall`, `CallDirection` from `api/callQueries.ts` (unchanged); `fetchUserDirectory` from `api/userQueries.ts:17`; `AssignableUser`, `EscalationTarget`, `Lookup`, `TicketStatusCode`, `CustomFieldValue` (Task 19); `asStatusCode`, `lifecycleOf`, `isActive`, `isTerminal`, `statusTone`, `priorityTone`, `dueLabel`, `lookupMap` and `useTicketRefData()` → `statuses, resolutions, transferReasons, callOutcomes, users` (Task 20); `AttachmentList({ entity, entityId, canManage })` from `features/attachments/AttachmentList.tsx:45-49`; `src/ui`: `ActionSheet` (`SheetAction`), `ComposeSheet` (`fields`, `choices`, `busy`, `onSubmit(values, picked)`), `Dialog`, `Chip` (`ChipTone`), `Card`, `Segmented`, `Timeline` (`TimelineEntry`), `ScreenHeader`, `ScreenLoader`, `Screen`, `Text`, `useToast`.
- Produces: `ComplaintDetailScreen` default export (route `ComplaintDetail: { ticketId }`, unchanged).

Decisions taken here (spec silent or brief under-specified):
1. **A person is picked in an `ActionSheet`, then the details go in a `ComposeSheet`.** `ComposeSheet` has no `Select` slot and its own header (ComposeSheet.tsx:22-27) says stacking two bottom sheets is fragile, while `ActionSheet` dismisses itself before running a row's handler precisely so that handler can present another sheet (ActionSheet.tsx:36-37). So Transfer = "Transfer to…" list → `{ reason chips, remarks }`; Escalate = "Escalate to…" list → `{ remarks }`; Change status = status list → `{ resolution chips?, remarks }`. Same two-sheet shape the old stage → resolution flow used.
2. **One `ComposeSheet` serves every status move**; its `choices`/`fields` are computed from the pending target per spec §2: resolution + required remarks into Resolved (or straight into Closed from an active status); required remarks into Rejected; required remarks to reopen; optional remarks from Resolved into Closed; open ↔ on hold fires with no sheet at all.
3. **Every status write goes through `setTicketStatus`** (the shortcuts stay in the API file, unused by this screen). The client never pre-empts the reopen gate — a Self agent gets the SP's 403 "Reopening requires a manager" in a toast.
4. **Errors go to the toast, not into the sheet.** The direct path has no sheet; on the sheet path the sheet stays open with the typed remarks (its own contract: callers dismiss in `onSuccess`), and the toast draws above sheets (Toast.tsx:200-201).
5. `ToBranchId` is sent only when the chosen person's branch differs from the ticket's; the server decides whether the caller may (wide scopes only). Mobile never offers a branch picker.
6. RS4 `assignments` is fetched and typed but **not rendered** — the `assigned` activity row already carries each transfer on the timeline; a second list of the same events is noise.
7. Call authors come from `fetchUserDirectory` (one extra cached query under the existing `["users","directory"]` key) because `tblCall` rows carry only a `UserId`; activity rows carry `UserName` since 086 and need no map.

- [ ] **Step 1: Rewrite the screen**

Replace the whole of `mobile/src/features/support/ComplaintDetailScreen.tsx` with:

```tsx
import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Ban,
  Building2,
  CircleCheck,
  CircleCheckBig,
  CircleDot,
  CirclePause,
  Clock,
  EllipsisVertical,
  Flag,
  History,
  Link2,
  Lock,
  MessageSquare,
  Package,
  Pencil,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  User,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import {
  deleteTicket,
  escalateTicket,
  fetchEscalationTargets,
  fetchTicketDetail,
  setTicketStatus,
  transferTicket,
} from "../../api/ticketQueries";
import { fetchCalls, logCall, type CallDirection } from "../../api/callQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type {
  AssignableUser,
  CustomFieldValue,
  EscalationTarget,
  Lookup,
  TicketStatusCode,
} from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Card,
  Chip,
  ComposeSheet,
  Dialog,
  Screen,
  ScreenHeader,
  ScreenLoader,
  Segmented,
  Text,
  Timeline,
  type ChipTone,
  type SheetAction,
  type SheetRef,
  type TimelineEntry,
  useToast,
} from "../../ui";
import AttachmentList from "../attachments/AttachmentList";
import { relativeTime } from "../tasks/taskHelpers";
import {
  asStatusCode,
  dueLabel,
  isActive,
  isTerminal,
  lifecycleOf,
  lookupMap,
  priorityTone,
  statusTone,
} from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "ComplaintDetail">;
type Tab = "details" | "files" | "history";

/** What a move into `target` needs before the SP will take it (spec §2). */
interface PendingMove {
  target: Lookup;
  reopen: boolean;
  needsResolution: boolean;
  needsRemarks: boolean;
}

const STATUS_ICON: Record<TicketStatusCode, LucideIcon> = {
  open: CircleDot,
  onhold: CirclePause,
  resolved: CircleCheck,
  closed: CircleCheckBig,
  rejected: Ban,
};

const STATUS_HINT: Record<TicketStatusCode, string | undefined> = {
  open: undefined,
  onhold: "Waiting on the customer or on parts",
  resolved: "Fixed — needs a resolution and remarks",
  closed: "Customer confirmed",
  rejected: "Closed without a fix — remarks required",
};

/**
 * Timeline node per tblTicketActivity.Type — the vocabulary the SPs write
 * since 086. Anything unmapped still gets a node rather than being dropped, so
 * a type added later shows up without a release here.
 */
const ACTIVITY_NODE: Record<string, { Icon: LucideIcon; tone: keyof typeof colors }> = {
  created: { Icon: Plus, tone: "success" },
  updated: { Icon: Pencil, tone: "textSecondary" },
  status: { Icon: ArrowRightLeft, tone: "primary" },
  resolved: { Icon: CircleCheck, tone: "success" },
  closed: { Icon: CircleCheckBig, tone: "success" },
  rejected: { Icon: Ban, tone: "danger" },
  reopened: { Icon: RotateCcw, tone: "warning" },
  assigned: { Icon: UserPlus, tone: "info" },
  escalated: { Icon: ArrowUpRight, tone: "danger" },
};

export default function ComplaintDetailScreen({ route, navigation }: Props) {
  const { ticketId } = route.params;
  const queryClient = useQueryClient();
  const toast = useToast();
  const userId = useAuthStore((s) => s.UserId);

  const [tab, setTab] = useState<Tab>("details");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  // Held between the first sheet (pick) and the second (details) of each flow.
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [transferTo, setTransferTo] = useState<AssignableUser | null>(null);
  const [escalateTo, setEscalateTo] = useState<EscalationTarget | null>(null);

  const menuRef = useRef<SheetRef>(null);
  const statusRef = useRef<SheetRef>(null);
  const moveRef = useRef<SheetRef>(null);
  const transferPickRef = useRef<SheetRef>(null);
  const transferRef = useRef<SheetRef>(null);
  const escalatePickRef = useRef<SheetRef>(null);
  const escalateRef = useRef<SheetRef>(null);
  const callRef = useRef<SheetRef>(null);

  const detailQuery = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => fetchTicketDetail({ TicketId: ticketId }),
  });
  const ticket = detailQuery.data?.ticket;

  // Pickers only — every name shown on this screen is on the row itself.
  const { statuses, resolutions, transferReasons, callOutcomes, users } =
    useTicketRefData();

  // tblCall rows carry only a UserId; the directory turns it into a name.
  // Activity rows carry UserName since 086 and need no map.
  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
  });
  // sp_LogCall's activity row only says "Outbound call logged" — the notes and
  // outcome live on tblCall. Fetching them is what makes a logged call
  // readable rather than just countable.
  const { data: calls } = useQuery({
    queryKey: ["calls", "ticket", ticketId],
    queryFn: () => fetchCalls({ TicketId: ticketId }),
  });

  // The chain above whoever is WORKING it — the assignee, else me. Only while
  // the complaint can still be escalated; the SP refuses on a terminal one.
  const forUserId = ticket?.AssignedTo ?? userId;
  const { data: seniors } = useQuery({
    queryKey: ["escalation-targets", forUserId],
    queryFn: () => fetchEscalationTargets(forUserId),
    enabled: !!ticket && isActive(lifecycleOf(ticket)),
  });

  const outcomeNames = useMemo(() => lookupMap(callOutcomes), [callOutcomes]);
  const people = useMemo(
    () => new Map((directory ?? []).map((u) => [u.Id, u.FullName])),
    [directory],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  /**
   * One mutation for every status move. Failures surface through the toast,
   * not an inline line: the direct path (open ↔ on hold) has no sheet to draw
   * on, and on the sheet path the sheet stays OPEN with what was typed. The
   * SP's own words — "Reopening requires a manager", "Resolution is required"
   * — arrive via apiErrorMessage and are the whole explanation.
   */
  const move = useMutation({
    mutationFn: setTicketStatus,
    onError: (err) =>
      toast.error(apiErrorMessage(err, "Could not change the status.")),
    onSuccess: () => {
      moveRef.current?.dismiss();
      setPending(null);
      invalidate();
    },
  });

  const transfer = useMutation({
    mutationFn: transferTicket,
    onError: (err) =>
      toast.error(apiErrorMessage(err, "Could not transfer this complaint.")),
    onSuccess: () => {
      transferRef.current?.dismiss();
      setTransferTo(null);
      invalidate();
    },
  });

  const escalate = useMutation({
    mutationFn: escalateTicket,
    onError: (err) =>
      toast.error(apiErrorMessage(err, "Could not escalate this complaint.")),
    onSuccess: () => {
      escalateRef.current?.dismiss();
      setEscalateTo(null);
      invalidate();
    },
  });

  const logTheCall = useMutation({
    mutationFn: logCall,
    onError: (err) => setCallError(apiErrorMessage(err, "Could not log that call.")),
    onSuccess: () => {
      callRef.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["calls", "ticket", ticketId] });
      // sp_LogCall writes a ticket-activity row (SQL 067), so the call appears
      // on the History tab without a second request.
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: deleteTicket,
    onError: (err) =>
      toast.error(apiErrorMessage(err, "Could not delete this complaint.")),
    onSuccess: () => {
      setConfirmingDelete(false);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      navigation.goBack();
    },
  });

  // The header renders here too — a loading screen with no back button is a
  // dead end (see TaskDetailScreen).
  if (detailQuery.isLoading || detailQuery.isError) {
    return (
      <Screen>
        <ScreenHeader title="Complaint" onBack={navigation.goBack} />
        <ScreenLoader
          failed={detailQuery.isError}
          onRetry={detailQuery.refetch}
          message={
            detailQuery.isError
              ? "The complaint could not be loaded. Check your connection and try again."
              : undefined
          }
        />
      </Screen>
    );
  }

  if (!ticket) {
    return (
      <Screen>
        <ScreenHeader title="Complaint" onBack={navigation.goBack} />
        <View style={styles.centre}>
          <Lock size={30} color={colors.textMuted} />
          <Text variant="h3">Complaint not available</Text>
          <Text variant="secondary" align="center">
            It may have been deleted, or it belongs to a branch you cannot see.
          </Text>
        </View>
      </Screen>
    );
  }

  const code = lifecycleOf(ticket);
  const active = isActive(code);
  const due = dueLabel(ticket);
  const fields = detailQuery.data?.fields ?? [];
  const activity = detailQuery.data?.activity ?? [];
  const linkedLead = detailQuery.data?.linkedLead ?? null;

  const who = (id: number | null) => people.get(id ?? -1) ?? "System";

  /**
   * The history is two sources woven together.
   *
   * `tblTicketActivity` records that a call happened; `tblCall` records what
   * was said. Showing both would list every call twice, so the activity rows
   * of type 'call' are dropped and the richer call rows take their place.
   */
  const timeline: TimelineEntry[] = [
    ...activity
      .filter((entry) => (entry.Type ?? "").toLowerCase() !== "call")
      .map((entry) => {
        const node = ACTIVITY_NODE[(entry.Type ?? "").toLowerCase()] ?? {
          Icon: History,
          tone: "textSecondary" as const,
        };
        return {
          key: `a-${entry.Id}`,
          at: entry.CreatedAt,
          title: entry.Summary ?? entry.Type,
          meta: `${entry.UserName ?? "System"} · ${relativeTime(entry.CreatedAt)}`,
          icon: node.Icon,
          tone: node.tone,
        };
      }),
    ...(calls ?? []).map((call) => {
      const outcome = call.OutcomeId ? outcomeNames.get(call.OutcomeId) : undefined;
      const bits = [
        who(call.UserId),
        outcome,
        call.Duration ? `${call.Duration} min` : undefined,
        relativeTime(call.CalledAt),
      ].filter(Boolean);

      return {
        key: `c-${call.Id}`,
        at: call.CalledAt,
        title:
          call.Notes ||
          (call.Direction === "in" ? "Incoming call" : "Outgoing call"),
        meta: bits.join(" · "),
        icon: call.Direction === "in" ? PhoneIncoming : PhoneOutgoing,
        tone: "info" as const,
      };
    }),
  ]
    // Newest first, matching what sp_FetchTicketDetail already returns.
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map(({ at, ...entry }) => {
      void at;
      return entry;
    });

  /**
   * What the SP will demand for this move (spec §2), decided here so the sheet
   * asks for exactly that and nothing more:
   *
   *   active → active              free — fires straight away, no sheet
   *   → resolved                   resolution + remarks
   *   active → closed              resolution + remarks (straight to closed)
   *   resolved → closed            remarks optional
   *   → rejected                   remarks
   *   terminal → active  (reopen)  remarks; manager-only — the SERVER decides
   *
   * The client never pre-empts the reopen gate. A Self agent gets the SP's
   * 403 in a toast, which is the truthful answer, not a hidden row.
   */
  const pickStatus = (target: Lookup) => {
    const to = asStatusCode(target.Code);
    if (active && isActive(to)) {
      move.mutate({ TicketId: ticketId, StatusId: target.Id });
      return;
    }
    const reopen = isTerminal(code) && isActive(to);
    const straightToClosed = to === "closed" && active;
    setPending({
      target,
      reopen,
      needsResolution: to === "resolved" || straightToClosed,
      needsRemarks:
        reopen || to === "resolved" || to === "rejected" || straightToClosed,
    });
    moveRef.current?.present();
  };

  const statusActions: SheetAction[] = statuses
    .filter((s) => s.Id !== ticket.StatusId)
    .map((s) => {
      const to = asStatusCode(s.Code);
      const reopen = isTerminal(code) && isActive(to);
      return {
        key: String(s.Id),
        label: s.Value,
        sublabel: reopen
          ? "Reopens the complaint — remarks required"
          : STATUS_HINT[to],
        icon: reopen ? RotateCcw : STATUS_ICON[to],
        tone: to === "rejected" ? "danger" : undefined,
        onPress: () => pickStatus(s),
      };
    });

  const transferActions: SheetAction[] = users
    .filter((u) => u.Id !== ticket.AssignedTo)
    .map((u) => ({
      key: String(u.Id),
      label: u.FullName,
      sublabel: [u.JobTitle, u.BranchName].filter(Boolean).join(" · ") || undefined,
      icon: User,
      onPress: () => {
        setTransferTo(u);
        transferRef.current?.present();
      },
    }));

  const escalateActions: SheetAction[] = (seniors ?? []).map((s) => ({
    key: String(s.Id),
    label: s.FullName,
    sublabel: [s.Depth === 1 ? "Direct manager" : `${s.Depth} levels up`, s.JobTitle]
      .filter(Boolean)
      .join(" · "),
    icon: ArrowUpRight,
    selected: s.Id === ticket.EscalatedTo,
    onPress: () => {
      setEscalateTo(s);
      escalateRef.current?.present();
    },
  }));

  // Built as a literal with a conditional spread, never `.push()` — see
  // CLAUDE.md §9.5 on `react-hooks/refs`.
  const escalateEntry: SheetAction[] = active
    ? [
        {
          key: "escalate",
          label: "Escalate",
          sublabel: ticket.EscalatedToName
            ? `Escalated to ${ticket.EscalatedToName}`
            : "Flag a senior — it stays with the assignee",
          icon: ArrowUpRight,
          onPress: () => escalatePickRef.current?.present(),
        },
      ]
    : [];

  const menuActions: SheetAction[] = [
    {
      key: "status",
      label: "Change status",
      sublabel: ticket.StatusName ?? undefined,
      icon: ArrowRightLeft,
      onPress: () => statusRef.current?.present(),
    },
    {
      key: "transfer",
      label: "Transfer",
      sublabel: ticket.AssigneeName ? `Now with ${ticket.AssigneeName}` : "Unassigned",
      icon: UserPlus,
      onPress: () => transferPickRef.current?.present(),
    },
    ...escalateEntry,
    {
      key: "call",
      label: "Log a call",
      sublabel: "Goes straight onto the history",
      icon: PhoneCall,
      onPress: () => {
        setCallError(null);
        callRef.current?.present();
      },
    },
    {
      key: "edit",
      label: "Edit complaint",
      icon: Pencil,
      onPress: () => navigation.navigate("ComplaintForm", { ticketId }),
    },
    {
      key: "delete",
      label: "Delete complaint",
      icon: Trash2,
      tone: "danger",
      onPress: () => setConfirmingDelete(true),
    },
  ];

  const customerSub = [
    ticket.CustomerMobile,
    ticket.PreviousTickets ? `${ticket.PreviousTickets} previous` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen>
      <ScreenHeader
        title={ticket.Subject}
        subtitle={`${ticket.TicketNo} · ${ticket.StatusName ?? code}`}
        tint="danger"
        onBack={navigation.goBack}
        actions={[
          {
            icon: EllipsisVertical,
            label: "Complaint actions",
            onPress: () => menuRef.current?.present(),
          },
        ]}
      />

      <View style={styles.summary}>
        {/* The chips are the one line worth reading from across a room: where
            it stands, how urgent, whether the clock has run out, who else is
            watching. Same four the list card shows, so nothing changes shape
            between the two screens. */}
        <View style={styles.chips}>
          <Chip label={ticket.StatusName ?? code} tone={statusTone(code)} />
          {ticket.PriorityName ? (
            <Chip
              label={ticket.PriorityName}
              icon={Flag}
              tone={priorityTone(ticket.PriorityName)}
            />
          ) : null}
          {due ? (
            <Chip
              label={due.label}
              icon={Clock}
              tone={due.overdue ? "danger" : "neutral"}
            />
          ) : null}
          {ticket.EscalatedTo ? (
            <Chip
              label={`Escalated to ${ticket.EscalatedToName ?? "a senior"}`}
              icon={ArrowUpRight}
              tone="primary"
              maxWidth={220}
            />
          ) : null}
        </View>

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "details", label: "Details" },
            { value: "files", label: "Files" },
            { value: "history", label: "History", count: activity.length },
          ]}
        />
      </View>

      {tab === "details" ? (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          <Card padded={false} gap={0} style={styles.factCard}>
            <Fact
              Icon={Building2}
              label="Customer"
              value={ticket.CustomerName ?? "—"}
              sub={customerSub || undefined}
            />
            <Fact
              Icon={User}
              label="Reported by"
              value={
                [ticket.ContactPerson, ticket.Contact].filter(Boolean).join(" · ") || "—"
              }
            />
            <Fact Icon={STATUS_ICON[code]} label="Status" value={ticket.StatusName ?? code} />
            <Fact
              Icon={Flag}
              label="Priority"
              value={ticket.PriorityName ?? "—"}
              tone={priorityTone(ticket.PriorityName)}
            />
            <Fact
              Icon={Clock}
              label="Due"
              value={due?.label ?? "—"}
              tone={due?.overdue ? "danger" : undefined}
            />
            <Fact
              Icon={ArrowUpRight}
              label="Escalated to"
              value={ticket.EscalatedToName ?? "—"}
            />
            <Fact
              Icon={UserPlus}
              label="Assigned to"
              value={ticket.AssigneeName ?? "Unassigned"}
            />
            <Fact Icon={Tag} label="Category" value={ticket.CategoryName ?? "—"} />
            <Fact
              Icon={MessageSquare}
              label="Channel"
              value={ticket.ChannelName ?? "—"}
            />
            <Fact Icon={Package} label="Product" value={ticket.ProductName ?? "—"} />
            {ticket.ResolutionName ? (
              <Fact Icon={CircleCheck} label="Resolution" value={ticket.ResolutionName} />
            ) : null}
            <Fact
              Icon={History}
              label="Logged"
              value={relativeTime(ticket.CreatedAt)}
              last
            />
          </Card>

          {ticket.Description ? (
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Complaint
              </Text>
              <Text variant="body">{ticket.Description}</Text>
            </View>
          ) : null}

          {fields.length ? (
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Extra details
              </Text>
              {fields.map((field) => (
                <View key={field.FieldId} style={styles.fieldRow}>
                  <Text variant="caption" color="textMuted">
                    {field.Label}
                  </Text>
                  <Text variant="body">{customValue(field)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {linkedLead ? (
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Raised from
              </Text>
              <View style={styles.leadRow}>
                <Link2 size={18} color={colors.info} />
                <View style={styles.leadText}>
                  <Text variant="bodyStrong">{linkedLead.Name ?? "Lead"}</Text>
                  <Text variant="caption" color="textMuted">
                    {linkedLead.MobileNo || linkedLead.Email || "No contact"}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {tab === "files" ? (
        <AttachmentList entity="ticket" entityId={ticketId} canManage />
      ) : null}

      {tab === "history" ? (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {timeline.length ? (
            <>
              <Timeline entries={timeline} />
              <Text variant="caption" color="textMuted" style={styles.end}>
                Complaint logged
              </Text>
            </>
          ) : (
            <Text variant="secondary">Nothing has happened yet.</Text>
          )}
        </ScrollView>
      ) : null}

      <ActionSheet ref={menuRef} title="Complaint actions" actions={menuActions} />

      <ActionSheet
        ref={statusRef}
        title="Change status"
        actions={statusActions}
        emptyMessage="No other statuses are configured. Add them on the web first."
      />

      {/* One sheet for every move that needs more than a tap. Its fields are
          computed from `pending`: Resolve shows resolution chips + remarks,
          Reject / Reopen show required remarks, Close from Resolved shows
          optional remarks — so the SP is asked for exactly what it needs. */}
      <ComposeSheet
        ref={moveRef}
        title={
          pending
            ? pending.reopen
              ? `Reopen as ${pending.target.Value}`
              : `Mark as ${pending.target.Value}`
            : "Change status"
        }
        submitLabel={pending?.reopen ? "Reopen" : "Update status"}
        busy={move.isPending}
        choices={
          pending?.needsResolution
            ? [
                {
                  key: "resolution",
                  label: "Resolution",
                  required: true,
                  options: resolutions.map((r) => ({ value: r.Id, label: r.Value })),
                },
              ]
            : []
        }
        fields={[
          {
            key: "remarks",
            label: "Remarks",
            placeholder: pending?.needsRemarks
              ? "Why — this goes on the history"
              : "Optional note for the history",
            multiline: true,
            required: pending?.needsRemarks ?? false,
          },
        ]}
        onSubmit={(values, picked) => {
          if (!pending) return;
          move.mutate({
            TicketId: ticketId,
            StatusId: pending.target.Id,
            ResolutionId: (picked.resolution as number | undefined) ?? null,
            Remarks: values.remarks || null,
          });
        }}
      />

      <ActionSheet
        ref={transferPickRef}
        title="Transfer to…"
        actions={transferActions}
        emptyMessage="There is nobody else you can hand this to."
      />
      <ComposeSheet
        ref={transferRef}
        title={transferTo ? `Transfer to ${transferTo.FullName}` : "Transfer"}
        submitLabel="Transfer"
        busy={transfer.isPending}
        choices={[
          {
            key: "reason",
            label: "Reason",
            required: true,
            options: transferReasons.map((r) => ({ value: r.Id, label: r.Value })),
          },
        ]}
        fields={[
          {
            key: "remarks",
            label: "Remarks",
            placeholder: "Anything the next person should know",
            multiline: true,
            required: true,
          },
        ]}
        onSubmit={(values, picked) => {
          if (!transferTo) return;
          transfer.mutate({
            TicketId: ticketId,
            ToUserId: transferTo.Id,
            // Only when the target sits in another branch. Whether the caller
            // MAY move it there is the server's call (wide scopes only).
            ToBranchId:
              transferTo.BranchId != null && transferTo.BranchId !== ticket.BranchId
                ? transferTo.BranchId
                : null,
            ReasonId: picked.reason as number,
            Remarks: values.remarks ?? "",
          });
        }}
      />

      <ActionSheet
        ref={escalatePickRef}
        title="Escalate to…"
        actions={escalateActions}
        emptyMessage={
          ticket.AssignedTo
            ? "The assignee has nobody above them in the reporting chain."
            : "You have nobody above you in the reporting chain."
        }
      />
      <ComposeSheet
        ref={escalateRef}
        title={escalateTo ? `Escalate to ${escalateTo.FullName}` : "Escalate"}
        submitLabel="Escalate"
        busy={escalate.isPending}
        fields={[
          {
            key: "remarks",
            label: "Why",
            placeholder: "What they need to know — they get a notification",
            multiline: true,
            required: true,
          },
        ]}
        onSubmit={(values) => {
          if (!escalateTo) return;
          escalate.mutate({
            TicketId: ticketId,
            ToUserId: escalateTo.Id,
            Remarks: values.remarks ?? "",
          });
        }}
      />

      {/* One sheet, not a chain of them: direction and outcome are chips so
          the whole call fits on screen with the keyboard up. NextFollowupDate
          is absent on purpose — tblFollowUp hangs off LeadId, so a ticket
          cannot carry one; its next step is its status. */}
      <ComposeSheet
        ref={callRef}
        title="Log a call"
        submitLabel="Log call"
        busy={logTheCall.isPending}
        error={callError}
        choices={[
          {
            key: "direction",
            label: "Direction",
            required: true,
            options: [
              { value: "in", label: "Incoming" },
              { value: "out", label: "Outgoing" },
            ],
          },
          ...(callOutcomes.length
            ? [
                {
                  key: "outcome",
                  label: "Outcome",
                  options: callOutcomes.map((o) => ({ value: o.Id, label: o.Value })),
                },
              ]
            : []),
        ]}
        fields={[
          { key: "notes", label: "Notes", placeholder: "What was said", multiline: true },
          { key: "minutes", label: "Minutes", placeholder: "0", numeric: true },
        ]}
        onSubmit={(values, picked) => {
          const minutes = Number(values.minutes);
          logTheCall.mutate({
            TicketId: ticketId,
            Direction: (picked.direction as CallDirection) ?? "out",
            OutcomeId: (picked.outcome as number) ?? null,
            Notes: values.notes || null,
            Duration: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
          });
        }}
      />

      <Dialog
        visible={confirmingDelete}
        title="Delete this complaint?"
        message="Its history, calls and attachments go with it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate({ Id: ticketId })}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  );
}

/** The EAV row splits by type; exactly one column is populated. */
function customValue(field: CustomFieldValue): string {
  if (field.Type === "checkbox") {
    return field.ValueText === "true" || field.ValueNumber === 1 ? "Yes" : "No";
  }
  if (field.Type === "number") return field.ValueNumber?.toString() ?? "—";
  if (field.Type === "date") {
    return field.ValueDate ? field.ValueDate.slice(0, 10) : "—";
  }
  return field.ValueText || "—";
}

function Fact({
  Icon,
  label,
  value,
  sub,
  tone,
  last = false,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  /** A quieter second line under the value — the customer's mobile, say. */
  sub?: string;
  /** A chip tone; "neutral" means plain ink. */
  tone?: ChipTone;
  last?: boolean;
}) {
  const ink = tone && tone !== "neutral" ? tone : undefined;
  return (
    <View style={[styles.fact, !last && styles.factDivider]}>
      <Icon size={16} color={colors.textMuted} />
      <Text variant="caption" color="textMuted" style={styles.factLabel}>
        {label}
      </Text>
      <View style={styles.factValue}>
        <Text variant="body" color={ink} numberOfLines={1} align="right">
          {value}
        </Text>
        {sub ? (
          <Text variant="caption" color="textMuted" numberOfLines={1} align="right">
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    padding: spacing[6],
  },
  summary: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  list: {
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[4],
  },
  factCard: { paddingHorizontal: spacing[4] },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  factDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  factLabel: { width: 96 },
  factValue: { flex: 1, alignItems: "flex-end" },
  block: { gap: spacing[2] },
  fieldRow: { gap: spacing[1] },
  leadRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  leadText: { flex: 1, gap: spacing[1] },
  // Lines up under the entry text, not under the rail.
  end: { paddingLeft: spacing[10] },
});
```

- [ ] **Step 2: Typecheck — only the form remains**

Run: `cd mobile && pnpm exec tsc --noEmit`
Expected: `ComplaintDetailScreen.tsx` clean. The only file still erroring is `ComplaintFormScreen.tsx` (Task 23). Three spots worth confirming in the output: `picked.resolution as number | undefined` and `picked.reason as number` compile under `noUncheckedIndexedAccess` (the index type is `string | number | undefined`, and `number` is a constituent); `Fact`'s `color={ink}` accepts `Exclude<ChipTone, "neutral">` — every one of `primary | success | warning | danger | info` is a key of `colors`; and `ACTIVITY_NODE[...] ?? {...}` narrows to a defined node.

- [ ] **Step 3: Lint**

Run: `cd mobile && pnpm lint`
Expected: 0 errors. No `react-hooks/refs` error — the menu is a literal with a conditional spread, not `.push()`. No `no-unused-styles` warning (the old `stageBar` style is gone with the stage band).

- [ ] **Step 4: Stop and report**

Leave the changes uncommitted (CLAUDE.md §0.1). Report: the one file touched, the `tsc` result line (only `ComplaintFormScreen.tsx` may still error), the `pnpm lint` result line, and any of the seven decisions above the implementer disagrees with.

---


### Task 23: `ComplaintFormScreen`

**Files:**
- Modify: `mobile/src/features/support/ComplaintFormScreen.tsx` (whole file, 318 lines today — the `CustomerName` free-text box becomes a search-or-create customer picker; `CHANNELS` and the `Channel` string go; Subject, Product and the TAT hint arrive)
- Test: none — mobile is exempt (CLAUDE.md §0.4/§9.7). Gate is `pnpm exec tsc --noEmit` + `pnpm lint`.

**Interfaces:**
- Consumes (Task 19): `fetchCustomers`, `saveCustomer` from `mobile/src/api/customerQueries.ts`; `fetchProducts` from `mobile/src/api/productQueries.ts`; `fetchTicketDetail`, `saveTicket` from `mobile/src/api/ticketQueries.ts`; `Customer`, `CustomFieldDef`, `Ticket`, `TicketDetail` from `mobile/src/types/api.ts`. Unchanged: `fetchCustomFields` from `mobile/src/api/configQueries.ts`, `apiErrorMessage` from `mobile/src/api/errors.ts`, the route `ComplaintForm: { ticketId?: number }` at `mobile/src/navigation/RootNavigator.tsx:44`.
- Consumes (Task 20): `asOptions`, `blankDraft`, `draftFromValues`, `missingRequired`, `serialiseCustomFields`, `tatLabel` from `./ticketHelpers`; `useTicketRefData()` → `categories, priorities, channels, users` from `./useTicketRefData` (**no argument**).
- Consumes (`src/ui`, unchanged): `Button` (`variant`, `size`, `icon`, `loading`, `fullWidth`, `style`), `Card` (`onPress`, `gap`), `DynamicField` (`field`, `value`, `onChange`), `Input` (`label`, `required`, `hint`, `leftIcon`, `multiline`), `Screen`, `ScreenHeader` (`tint="danger"`), `ScreenLoader` (`failed`, `onRetry`), `Select` (`options[].sublabel`, `sheetTitle`), `Text` (`variant`, `color`).
- Produces: `ComplaintFormScreen` default export. Nothing imports anything else from this file — it is a leaf.

Decisions taken here (the spec lists the fields but not their strictness):

1. **Required on the phone: Customer · Subject · Category · Priority · Description.** Channel and Product are optional. `sp_SaveTicket` only rejects a missing `@CustomerId` / `@Subject`; `@ChannelId` and `@ProductId` are nullable and both lists are now *company data* — a company that has configured no `ticket_channel` rows, or sells no products, would otherwise hit a field it cannot satisfy. The old form's `required` on Channel came from a hardcoded four-value const that could never be empty.
2. **`PickedCustomer = Pick<Customer, "Id" | "Name" | "ContactPerson" | "Mobile" | "Email">`**, not `Customer`. After `saveCustomer` the client holds the four fields it typed plus the returned `Id` — never `OpenTickets`, `BranchName` or `CreatedAt` — and a state type that lies about that would need a cast at exactly the point the data is thinnest.
3. **Search is `useDeferredValue` + `enabled: term.length >= 2`**, the same shape `ComplaintsScreen` uses (Task 21): React keeps the previous results on screen while the next request resolves, there is no timer to clean up, and a single stray character never triggers a company-wide search.
4. **Two writes, in order, and the first one sticks.** A new customer is saved first because a ticket needs a row to point at. If `saveTicket` then fails, the customer is *not* rolled back — it is a real record in `tblCustomer`, not part of the ticket draft — so the block collapses onto it and the button retries the ticket alone.
5. **The typed search carries into the "New customer" form**: digits/`+`/spaces/dashes land in Mobile, anything else in Name. Spec §1 step 1 is "agent types the customer's mobile"; re-typing it into the create form is the friction that flow exists to remove.
6. **"Reported by" is prefilled from the customer, never overwritten.** Picking a customer fills `ContactPerson`/`Contact` only while they are blank, so a second pick cannot wipe what the agent typed.
7. **`LinkedLeadId` is never sent.** The update guards it (`LinkedLeadId = ISNULL(@LinkedLeadId, LinkedLeadId)`) precisely so a client that cannot see the link cannot sever it.
8. **Edit mode: no assignee, no status, customer changeable.** `sp_SaveTicket`'s UPDATE writes `ContactPerson, Contact, ChannelId, CategoryId, Priority, ProductId, Description` **raw** (no `ISNULL` guard), so the edit form seeds every one of them from the row and re-sends all of them; it never touches `AssignedTo`, `StatusId`, `AssignedAt` or `EscalatedTo`.

---

- [ ] **Step 1: Rewrite `ComplaintFormScreen.tsx`**

Replace the whole of `mobile/src/features/support/ComplaintFormScreen.tsx` with:

```tsx
import { useDeferredValue, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Lock, Search, UserPlus } from "lucide-react-native";
import type {
  StackNavigationProp,
  StackScreenProps,
} from "@react-navigation/stack";

import { fetchCustomFields } from "../../api/configQueries";
import { fetchCustomers, saveCustomer } from "../../api/customerQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchTicketDetail, saveTicket } from "../../api/ticketQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type {
  Customer,
  CustomFieldDef,
  Ticket,
  TicketDetail,
} from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  Button,
  Card,
  DynamicField,
  Input,
  Screen,
  ScreenHeader,
  ScreenLoader,
  Select,
  Text,
} from "../../ui";
import {
  asOptions,
  blankDraft,
  draftFromValues,
  missingRequired,
  serialiseCustomFields,
  tatLabel,
} from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "ComplaintForm">;
type Nav = StackNavigationProp<RootStackParamList, "ComplaintForm">;

/**
 * What the form needs to know about the chosen customer — and all it CAN know
 * about a just-created one, where the client holds the four fields it typed
 * plus the returned Id and nothing else. A full `Customer` here would be a
 * type that lies at exactly the moment the data is thinnest.
 */
type PickedCustomer = Pick<
  Customer,
  "Id" | "Name" | "ContactPerson" | "Mobile" | "Email"
>;

/** A mobile number as typed: digits, a leading +, and the separators people use. */
const LOOKS_LIKE_A_NUMBER = /^[0-9+\s-]+$/;

/**
 * Log or edit a complaint.
 *
 * The outer component only waits for the row; the fields live in a child that
 * seeds its state from props, so no effect copies server data into local state
 * and a background refetch cannot overwrite what someone is typing. Same shape
 * as TaskFormScreen.
 */
export default function ComplaintFormScreen({ route, navigation }: Props) {
  const ticketId = route.params?.ticketId;
  const editing = ticketId != null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => fetchTicketDetail({ TicketId: ticketId! }),
    enabled: editing,
  });

  if (editing && (isLoading || isError)) {
    return (
      <Screen>
        <ScreenHeader title="Edit complaint" onBack={navigation.goBack} />
        <ScreenLoader failed={isError} onRetry={refetch} />
      </Screen>
    );
  }

  if (editing && !data?.ticket) {
    return (
      <Screen>
        <ScreenHeader title="Edit complaint" onBack={navigation.goBack} />
        <View style={styles.centre}>
          <Lock size={30} color={colors.textMuted} />
          <Text variant="h3">Complaint not available</Text>
          <Text variant="secondary" align="center">
            It may have been deleted, or it belongs to a branch you cannot see.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <ComplaintForm
      navigation={navigation}
      ticket={data?.ticket ?? null}
      detail={data ?? null}
    />
  );
}

interface ComplaintFormProps {
  navigation: Nav;
  ticket: Ticket | null;
  detail: TicketDetail | null;
}

function ComplaintForm({ navigation, ticket, detail }: ComplaintFormProps) {
  const queryClient = useQueryClient();
  const editing = ticket != null;

  // --- the customer -------------------------------------------------------
  // On edit this is seeded from the ticket row: sp_FetchTicketDetail RS1
  // carries the customer's own columns, so the block opens collapsed on the
  // right customer without a second request.
  const [customer, setCustomer] = useState<PickedCustomer | null>(() =>
    ticket
      ? {
          Id: ticket.CustomerId,
          Name: ticket.CustomerName ?? "",
          ContactPerson: ticket.CustomerContactPerson ?? null,
          Mobile: ticket.CustomerMobile ?? null,
          Email: ticket.CustomerEmail ?? null,
        }
      : null,
  );
  const [search, setSearch] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  // One object rather than four useStates — four setters that always move
  // together are one piece of state wearing a disguise.
  const [newCustomer, setNewCustomer] = useState({
    Name: "",
    ContactPerson: "",
    Mobile: "",
    Email: "",
  });

  // --- the complaint ------------------------------------------------------
  const [subject, setSubject] = useState(ticket?.Subject ?? "");
  const [contactPerson, setContactPerson] = useState(ticket?.ContactPerson ?? "");
  const [contact, setContact] = useState(ticket?.Contact ?? "");
  const [channel, setChannel] = useState<number | null>(ticket?.ChannelId ?? null);
  const [category, setCategory] = useState<number | null>(ticket?.CategoryId ?? null);
  const [priority, setPriority] = useState<number | null>(ticket?.Priority ?? null);
  const [product, setProduct] = useState<number | null>(ticket?.ProductId ?? null);
  // Create-only, so it is never seeded from the ticket: sp_SaveTicket does not
  // touch AssignedTo on update, and reassigning is transferTicket's job.
  const [assignee, setAssignee] = useState<number | null>(null);
  const [description, setDescription] = useState(ticket?.Description ?? "");
  const [draft, setDraft] = useState<Record<number, string | boolean>>(() =>
    detail?.fields.length ? draftFromValues(detail.fields) : {},
  );
  const [error, setError] = useState<string | null>(null);

  // Pickers. No statuses: a complaint's status is never set from this form —
  // it is seeded `open` on insert and moved only by sp_SetTicketStatus.
  const { categories, priorities, channels, users } = useTicketRefData();

  const { data: defs } = useQuery({
    queryKey: ["custom-fields", "ticket"],
    queryFn: () => fetchCustomFields({ Entity: "ticket" }),
  });
  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  // Deferred rather than debounced with a timer: React keeps the previous
  // results on screen while the next request resolves, and there is no timeout
  // to clean up. Two characters minimum — one letter would ask the server for
  // most of the company.
  const term = useDeferredValue(search.trim());
  const matches = useQuery({
    queryKey: ["customers", term],
    queryFn: () => fetchCustomers({ SearchTerm: term, PageSize: 8 }),
    enabled: !customer && !creatingCustomer && term.length >= 2,
  });
  const rows = matches.data ?? [];

  const fieldDefs: CustomFieldDef[] = useMemo(() => defs ?? [], [defs]);

  // A definition the ticket has no stored value for still needs a controlled
  // entry, or its input flips from uncontrolled on first keystroke.
  const values = useMemo(
    () => ({ ...blankDraft(fieldDefs), ...draft }),
    [fieldDefs, draft],
  );

  const setField = (fieldId: number, value: string | boolean) =>
    setDraft((prev) => ({ ...prev, [fieldId]: value }));

  const setNewField = (key: keyof typeof newCustomer, value: string) =>
    setNewCustomer((prev) => ({ ...prev, [key]: value }));

  // The TAT is the whole reason priority matters here — it is what sets DueAt,
  // and therefore what puts the complaint at the top of somebody's Overdue
  // queue. Showing it at the point of choosing is the difference between
  // picking a word and picking a deadline.
  const priorityOptions = useMemo(
    () =>
      priorities.map((p) => {
        const tat = tatLabel(p.TatHours);
        return {
          value: p.Id,
          label: p.Value,
          sublabel: tat ? `Due in ${tat}` : "No due time",
        };
      }),
    [priorities],
  );

  const productOptions = useMemo(
    () =>
      (products ?? []).map((p) => ({
        value: p.Id,
        label: p.Name,
        sublabel: p.Code ?? undefined,
      })),
    [products],
  );

  const assigneeOptions = useMemo(
    () =>
      users.map((u) => ({
        value: u.Id,
        label: u.FullName,
        sublabel: [u.JobTitle, u.BranchName].filter(Boolean).join(" · ") || undefined,
      })),
    [users],
  );

  /**
   * Choosing a customer also answers "reported by" — for most complaints the
   * caller IS the contact on the customer record. Prefilled, never
   * overwritten: whatever has already been typed is the agent's, and a second
   * pick must not wipe it.
   */
  const pick = (row: PickedCustomer) => {
    setCustomer(row);
    setSearch("");
    setCreatingCustomer(false);
    setContactPerson((prev) => prev.trim() || row.ContactPerson || row.Name);
    setContact((prev) => prev.trim() || row.Mobile || row.Email || "");
  };

  const changeCustomer = () => {
    setCustomer(null);
    setSearch("");
    setCreatingCustomer(false);
  };

  /**
   * Carry the typed search into the create form. Spec §1 opens with "agent
   * types the customer's mobile"; making them type it a second time is the
   * friction this flow exists to remove. Digits go to Mobile, words to Name.
   */
  const startNewCustomer = () => {
    const typed = search.trim();
    const isNumber = LOOKS_LIKE_A_NUMBER.test(typed);
    setNewCustomer((prev) => ({
      ...prev,
      Name: prev.Name || (isNumber ? "" : typed),
      Mobile: prev.Mobile || (isNumber ? typed : ""),
    }));
    setCreatingCustomer(true);
  };

  const createCustomer = useMutation({ mutationFn: saveCustomer });

  const save = useMutation({
    mutationFn: saveTicket,
    onSuccess: (response) => {
      if (!response.success) {
        setError(response.message || "Could not save this complaint.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      if (ticket) queryClient.invalidateQueries({ queryKey: ["ticket", ticket.Id] });
      navigation.goBack();
    },
    onError: (err) =>
      setError(
        apiErrorMessage(err, "Could not save this complaint. Check your connection."),
      ),
  });

  /**
   * Saves the typed-in customer and returns it, or null after saying why.
   *
   * It is deliberately NOT rolled back if the ticket then fails: tblCustomer is
   * a real record, not part of this draft. `pick` collapses the block onto it,
   * so the retry sends the ticket alone against a customer that already exists.
   *
   * The 409 "Another customer already has this mobile number" arrives here as a
   * rejection, and the SP's own sentence is the right answer — it tells the
   * agent to go back and search rather than to try a different spelling.
   */
  const createTypedCustomer = async (): Promise<PickedCustomer | null> => {
    const fields = {
      Name: newCustomer.Name.trim(),
      ContactPerson: newCustomer.ContactPerson.trim() || null,
      Mobile: newCustomer.Mobile.trim() || null,
      Email: newCustomer.Email.trim() || null,
    };
    try {
      const response = await createCustomer.mutateAsync(fields);
      const id = response.data?.Id;
      if (!response.success || !id) {
        setError(response.message || "Could not save that customer.");
        return null;
      }
      const row: PickedCustomer = { Id: id, ...fields };
      pick(row);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      return row;
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save that customer."));
      return null;
    }
  };

  const submit = async () => {
    const subjectText = subject.trim();
    const descriptionText = description.trim();

    if (!customer && !creatingCustomer) {
      return setError("Pick the customer, or add a new one.");
    }
    if (!customer && creatingCustomer) {
      if (!newCustomer.Name.trim()) return setError("The new customer needs a name.");
      if (!newCustomer.Mobile.trim() && !newCustomer.Email.trim()) {
        return setError("A mobile number or an email is required for a new customer.");
      }
    }
    if (!subjectText) return setError("What is the complaint about?");
    if (!category) return setError("Pick a category.");
    if (!priority) return setError("Pick a priority.");
    if (!descriptionText) return setError("Describe the complaint.");

    const missing = missingRequired(fieldDefs, values);
    if (missing.length) return setError(`${missing[0]!.Label} is required.`);

    setError(null);

    // Customer first — a ticket needs a row to point at.
    const chosen = customer ?? (await createTypedCustomer());
    if (!chosen) return;

    save.mutate({
      Id: ticket?.Id ?? 0,
      CustomerId: chosen.Id,
      Subject: subjectText,
      // Read off `chosen`, not out of state: on the create path the prefill
      // that `pick` just queued has not rendered yet.
      ContactPerson: contactPerson.trim() || chosen.ContactPerson || chosen.Name || null,
      Contact: contact.trim() || chosen.Mobile || chosen.Email || null,
      ChannelId: channel,
      CategoryId: category,
      Priority: priority,
      ProductId: product,
      AssignedTo: assignee,
      Description: descriptionText,
      CustomJSON: serialiseCustomFields(fieldDefs, values),
      // LinkedLeadId stays out. The SP updates it as
      // ISNULL(@LinkedLeadId, LinkedLeadId) precisely so a client that cannot
      // see the lead link cannot sever it.
    });
  };

  const busy = save.isPending || createCustomer.isPending;

  return (
    <Screen>
      <ScreenHeader
        title={editing ? "Edit complaint" : "Log a complaint"}
        subtitle={ticket?.TicketNo}
        tint="danger"
        onBack={navigation.goBack}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ---------------------------------------------------- customer --
            Three states, one at a time: picked (collapsed), creating, or
            searching. A complaint without a customer row cannot be saved at
            all now, so this is the first thing the screen asks for. */}
        <View style={styles.block}>
          <Text variant="overline" color="textMuted">
            Customer
          </Text>

          {customer ? (
            <Card>
              <View style={styles.pickedRow}>
                <Building2 size={18} color={colors.textMuted} />
                <View style={styles.pickedText}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {customer.Name || "Unnamed customer"}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {[customer.Mobile, customer.Email].filter(Boolean).join(" · ") ||
                      "No contact details"}
                  </Text>
                </View>
                <Button
                  title="Change"
                  variant="ghost"
                  size="sm"
                  onPress={changeCustomer}
                />
              </View>
            </Card>
          ) : creatingCustomer ? (
            <>
              <Input
                label="Name"
                required
                value={newCustomer.Name}
                onChangeText={(v) => setNewField("Name", v)}
                placeholder="Shop, company or person"
                autoFocus
              />
              <Input
                label="Contact person"
                value={newCustomer.ContactPerson}
                onChangeText={(v) => setNewField("ContactPerson", v)}
                placeholder="Who to ask for"
              />
              <Input
                label="Mobile"
                value={newCustomer.Mobile}
                onChangeText={(v) => setNewField("Mobile", v)}
                placeholder="10-digit number"
                keyboardType="phone-pad"
                hint="A mobile number or an email is required."
              />
              <Input
                label="Email"
                value={newCustomer.Email}
                onChangeText={(v) => setNewField("Email", v)}
                placeholder="name@company.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <Button
                title="Search instead"
                variant="ghost"
                size="sm"
                icon={Search}
                onPress={() => setCreatingCustomer(false)}
                style={styles.link}
              />
            </>
          ) : (
            <>
              <Input
                value={search}
                onChangeText={setSearch}
                placeholder="Search customer (mobile or name)"
                leftIcon={Search}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                autoFocus={!editing}
              />

              {rows.map((row) => (
                <Card key={row.Id} onPress={() => pick(row)} gap={1}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {row.Name}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {[
                      row.Mobile,
                      row.City,
                      row.OpenTickets ? `${row.OpenTickets} open` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No contact details"}
                  </Text>
                </Card>
              ))}

              {term.length >= 2 && !matches.isFetching && !rows.length ? (
                <Text variant="caption" color="textMuted">
                  Nobody matches “{term}”. Add them as a new customer.
                </Text>
              ) : null}

              <Button
                title="New customer"
                variant="ghost"
                size="sm"
                icon={UserPlus}
                onPress={startNewCustomer}
                style={styles.link}
              />
            </>
          )}
        </View>

        {/* --------------------------------------------------- complaint -- */}
        <View style={styles.block}>
          <Text variant="overline" color="textMuted">
            Complaint
          </Text>

          <Input
            label="Subject"
            required
            value={subject}
            onChangeText={setSubject}
            placeholder="One line — what is wrong"
          />

          <Select
            label="Category"
            required
            value={category}
            options={asOptions(categories)}
            onChange={(v) => setCategory(v as number)}
            sheetTitle="What kind of complaint?"
          />

          <Select
            label="Priority"
            required
            value={priority}
            options={priorityOptions}
            onChange={(v) => setPriority(v as number)}
            sheetTitle="How urgent is it?"
          />

          {/* Optional: the channel list is company data now and can be empty,
              and @ChannelId is nullable. Same for Product. */}
          <Select
            label="Channel"
            value={channel}
            options={asOptions(channels)}
            onChange={(v) => setChannel(v as number)}
            placeholder="Not recorded"
            sheetTitle="How did it come in?"
          />

          <Select
            label="Product"
            value={product}
            options={productOptions}
            onChange={(v) => setProduct(v as number)}
            placeholder="None"
            sheetTitle="Which product?"
          />

          <Input
            label="Reported by"
            value={contactPerson}
            onChangeText={setContactPerson}
            placeholder="Who called or wrote in"
          />

          <Input
            label="Phone or email"
            value={contact}
            onChangeText={setContact}
            placeholder="How to reach them back"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />

          {/* Create only. On update the SP ignores AssignedTo entirely, so an
              assignee picker here would be a control that silently does
              nothing — handing it on is Transfer's job, on the detail screen. */}
          {editing ? null : (
            <Select
              label="Assign to"
              value={assignee}
              options={assigneeOptions}
              onChange={(v) => setAssignee(v as number)}
              placeholder="Nobody yet"
              sheetTitle="Who picks this up?"
            />
          )}

          <Input
            label="What happened"
            required
            value={description}
            onChangeText={setDescription}
            placeholder="The complaint in the customer's words"
            multiline
            numberOfLines={4}
          />
        </View>

        {fieldDefs.length ? (
          <View style={styles.block}>
            <Text variant="overline" color="textMuted">
              Extra details
            </Text>
            {fieldDefs.map((def) => (
              <DynamicField
                key={def.Id}
                field={def}
                value={values[def.Id] ?? ""}
                onChange={(next) => setField(def.Id, next)}
              />
            ))}
          </View>
        ) : null}

        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={editing ? "Save changes" : "Log complaint"}
            // `submit` is async (it may have to create the customer first) and
            // handles its own failures, so the promise is deliberately dropped.
            onPress={() => void submit()}
            loading={busy}
            fullWidth
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    padding: spacing[6],
  },
  content: {
    padding: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[6],
  },
  block: { gap: spacing[4] },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  pickedText: { flex: 1, gap: spacing[1] },
  // A ghost button in a column stretches to the full width by default, which
  // reads as a second primary action. These are links.
  link: { alignSelf: "flex-start" },
  actions: { paddingTop: spacing[2] },
});
```

- [ ] **Step 2: Typecheck — the whole app should compile for the first time since Task 19**

Run: `cd mobile && pnpm exec tsc --noEmit`

(That exact command. `pnpm typecheck` trips a pnpm build-approval prompt in a non-interactive shell.)

Expected: **no output at all, exit 0.** Tasks 19–22 each left `ComplaintFormScreen.tsx` erroring on `CHANNELS`, `ticket.Channel`, `ticket.CustomerName` as a writable field, `useTicketRefData("all")` and the old `SaveTicketPayload` keys; this task is what clears the last of them.

Five spots worth confirming in the output if it is *not* clean:
- `pick(row)` inside `rows.map` — `Customer` is structurally assignable to `PickedCustomer`; a failure here means Task 19's `Customer` is missing one of `ContactPerson` / `Mobile` / `Email`.
- `const row: PickedCustomer = { Id: id, ...fields }` — `fields` types each optional column as `string | null`, matching `Customer`.
- `values[def.Id] ?? ""` under `noUncheckedIndexedAccess` — the index type is `string | boolean | undefined`, so the `??` is load-bearing, not decoration.
- `asOptions(categories)` gives `{ value: number; label: string }[]`, so `Select` infers `T = number` and `onChange` is `(value: number | number[]) => void` — hence the `as number` casts, which are the existing house pattern.
- `response.data?.Id` — `saveCustomer` is typed `Promise<ApiEnvelope<{ Id: number }>>`, so `id` is `number | undefined` and the `!id` guard narrows it.

Any error in a file other than this one is a defect in Task 19–22, not here; report it rather than patching around it.

- [ ] **Step 3: Lint**

Run: `cd mobile && pnpm lint`

Expected: **0 errors.** One pre-existing warning about `axios.create` in `src/api/client.ts` is expected and is not this task's.

Specifically none of:
- `react-native/no-color-literals` — every colour on this screen is a token (`colors.textMuted` on the two lucide icons; everything else is a `Text` `color` name or a `ui/` component's own).
- `react-native/no-unused-styles` — all six keys (`centre`, `content`, `block`, `pickedRow`, `pickedText`, `link`, `actions`) are referenced.
- `no-restricted-imports` — `Text`, `Input`, `Button` come from `../../ui`; only `ScrollView`, `StyleSheet` and `View` come from `react-native`. There is no `Alert` anywhere.
- `react-hooks/refs` — this screen holds no refs at all.

- [ ] **Step 4: Stop and report**

Leave the changes uncommitted (CLAUDE.md §0.1). Report: the one file touched, the `pnpm exec tsc --noEmit` result line (it must now be clean **app-wide** — say so explicitly, since Task 24 is the formal gate and a dirty typecheck here means Task 24 will fail), the `pnpm lint` result line and its warning count, and any of the eight decisions above the implementer disagrees with.

---

### Task 24: Mobile typecheck + lint gate

**Files:**
- Modify: none. This task writes no code — it is the gate that says Tasks 19–23 landed as one coherent change. Any failure below is fixed in the task that owns the file, not here.
- Test: none — mobile has no test suite (CLAUDE.md §0.4, §9.7). `pnpm exec tsc --noEmit` + `pnpm lint` **are** the gate, which is exactly why this task exists as its own step.

**Interfaces:**
- Consumes: everything Tasks 19–23 produced — `mobile/src/types/api.ts`, `mobile/src/api/{ticketQueries,customerQueries,productQueries,configQueries,userQueries}.ts`, `mobile/src/features/support/{ticketHelpers.ts,useTicketRefData.ts,ComplaintCard.tsx,ComplaintsScreen.tsx,ComplaintDetailScreen.tsx,ComplaintFormScreen.tsx}`, `mobile/src/features/hub/WorkHubScreen.tsx`.
- Produces: no code. A pass/fail verdict plus the file inventory the owner reviews before committing.

This is the only mobile task that runs anything whole-app, and the commands are cheap (`tsc` once, `eslint` once) — there is no memory-safety reason to split them.

- [ ] **Step 1: Whole-app typecheck**

Run: `cd mobile && pnpm exec tsc --noEmit`

(That exact command. `pnpm typecheck` runs the same `tsc --noEmit` but goes through a package script, which trips a pnpm build-approval prompt in a non-interactive shell and hangs.)

Expected: **no output, exit 0.**

If anything prints, it belongs to whichever task owns the file — report it and stop rather than patching here:

| Error mentions | Owner |
|---|---|
| `src/types/api.ts`, `src/api/*` | Task 19 |
| `ticketHelpers.ts`, `useTicketRefData.ts`, `WorkHubScreen.tsx` | Task 20 |
| `ComplaintCard.tsx`, `ComplaintsScreen.tsx` | Task 21 |
| `ComplaintDetailScreen.tsx` | Task 22 |
| `ComplaintFormScreen.tsx` | Task 23 |

Note the project is `strict` **and** `noUncheckedIndexedAccess` (`mobile/tsconfig.json`), so an unguarded `array[0]` or `record[key]` is an error, not a warning — that is the rule most of the rewritten files lean on.

- [ ] **Step 2: Whole-app lint**

Run: `cd mobile && pnpm lint`

Expected: **0 errors**, and exactly **one warning** — the pre-existing `react-hooks/…` warning about `axios.create` in `src/api/client.ts`, which predates this plan and is untouched by it. eslint exits 0 on warnings, so a non-zero exit means a real error.

The four design-system rules from `mobile/eslint.config.js` that this rebuild could plausibly have broken, and where each would surface:

- `react-native/no-color-literals` (**error**) — a hex or `rgba()` outside `src/theme/` and `src/ui/`. The status/priority/due tones all route through `ChipTone` and `colors[...]`, so a literal here would mean someone hardcoded a stage colour the way the old board did.
- `no-restricted-imports` (**error**) — `Text` / `TextInput` / `Button` / `Alert` imported from `react-native`, or any `@expo/vector-icons` / `react-native-vector-icons` import. Every screen in this rebuild imports those four from `../../ui` and its icons from `lucide-react-native`.
- `react-native/no-unused-styles` (warning) — a `StyleSheet` key left behind by a deleted element. The likely leftovers are the board-era keys in `ComplaintsScreen` and `ComplaintDetailScreen`; both files were replaced whole, so there should be none.
- `react-native/no-inline-styles` (warning) — a `style={{ … }}` object. `Chip`'s `maxWidth` prop exists so the detail screen's "Escalated to …" chip does not need one.

If a warning count other than 1 comes back, name each extra warning in the report; do not silence any of them.

- [ ] **Step 3: Prove the pipeline vocabulary is gone**

Run: `cd /Users/ayushmishra/Developer/Nexus/CRM && grep -rn 'fetchPipelines\|stageRoles\|moveTicketStage\|StageId\|PipelineId' mobile/src`

Expected: **no output** (grep exits 1 — that is the pass). Today the same grep returns **57 hits across 8 files** (`src/types/api.ts`, `src/api/configQueries.ts`, `src/api/ticketQueries.ts`, `src/features/support/ticketHelpers.ts`, `useTicketRefData.ts`, `ComplaintCard.tsx`, `ComplaintsScreen.tsx`, `ComplaintDetailScreen.tsx`, `ComplaintFormScreen.tsx`), so a clean run is a real signal, not a vacuous one.

Why this grep and not just the typecheck: `086` drops `tblPipeline`/`tblPipelineStage` and the five pipeline procs, and the backend deploys **before** the mobile release (spec §7). A leftover `moveTicketStage` call would compile perfectly and fail only in a customer's hand, against a proc that no longer exists.

**`mobile/src/ui/BoardColumns.tsx` stays** — the task boards still use it (plan ambiguity 9: only the *web's* `components/ui/BoardColumn.jsx` is deleted). It must not match this grep, and today it does not: `grep -rn 'fetchPipelines\|stageRoles\|moveTicketStage\|StageId\|PipelineId' mobile/src/ui` returns 0 hits, because the component is generic over columns and knows nothing about stages. If a future edit does make it match, narrow the gate to the folders this spec owns rather than weakening the pattern:

```bash
cd /Users/ayushmishra/Developer/Nexus/CRM && grep -rn 'fetchPipelines\|stageRoles\|moveTicketStage\|StageId\|PipelineId' mobile/src/features/support mobile/src/api
```

(Both forms are BRE with `\|` alternation, which the system `grep` on this machine accepts — verified 2026-09-16. `-E` with plain `|` is the equivalent if a different grep ever complains.)

- [ ] **Step 4: Inventory what the mobile tasks touched**

Run: `cd /Users/ayushmishra/Developer/Nexus/CRM && git status --short mobile/`

Read-only inspection, which §0.1 allows; nothing here stages or commits.

Expected — 16 modified, 3 untracked:

```
 M mobile/src/api/attachmentQueries.ts
 M mobile/src/api/client.ts
 M mobile/src/api/configQueries.ts
 M mobile/src/api/ticketQueries.ts
 M mobile/src/api/userQueries.ts
 M mobile/src/config/env.ts
 M mobile/src/features/auth/LoginScreen.tsx
 M mobile/src/features/hub/WorkHubScreen.tsx
 M mobile/src/features/support/ComplaintCard.tsx
 M mobile/src/features/support/ComplaintDetailScreen.tsx
 M mobile/src/features/support/ComplaintFormScreen.tsx
 M mobile/src/features/support/ComplaintsScreen.tsx
 M mobile/src/features/support/ticketHelpers.ts
 M mobile/src/features/support/useTicketRefData.ts
 M mobile/src/stores/useAuthStore.ts
 M mobile/src/types/api.ts
?? mobile/src/api/centralQueries.ts
?? mobile/src/api/customerQueries.ts
?? mobile/src/api/productQueries.ts
```

Which line belongs to whom:

| File | Task |
|---|---|
| `src/types/api.ts`, `src/api/ticketQueries.ts`, `src/api/configQueries.ts`, `src/api/userQueries.ts`, `?? src/api/customerQueries.ts`, `?? src/api/productQueries.ts` | 19 |
| `src/features/support/ticketHelpers.ts`, `useTicketRefData.ts`, `src/features/hub/WorkHubScreen.tsx` | 20 |
| `src/features/support/ComplaintCard.tsx`, `ComplaintsScreen.tsx` | 21 |
| `src/features/support/ComplaintDetailScreen.tsx` | 22 |
| `src/features/support/ComplaintFormScreen.tsx` | 23 |
| `src/api/attachmentQueries.ts`, `src/api/client.ts`, `src/config/env.ts`, `src/features/auth/LoginScreen.tsx`, `src/stores/useAuthStore.ts`, `?? src/api/centralQueries.ts` | **none — pre-existing uncommitted work** (the central-config / API-base change already in the tree at the start of this plan). Leave them alone. |

`src/types/api.ts` is the one line in both columns: it was already modified before this plan and Task 19 modifies it again. That is expected, not a conflict.

Anything else under `mobile/` — `app.config.ts`, `package.json`, `pnpm-lock.yaml`, `android/`, `ios/`, a new file in `src/ui/` — means a task exceeded its brief. Report it; do not revert it yourself.

- [ ] **Step 5: Stop and report**

Leave the changes uncommitted (CLAUDE.md §0.1). Report:

- the `pnpm exec tsc --noEmit` result line (must be clean, exit 0);
- the `pnpm lint` result line with its exact warning count (expected: 0 errors, 1 warning — `axios.create` in `src/api/client.ts`);
- the grep result (must be empty) and confirmation that `mobile/src/ui/BoardColumns.tsx` is untouched and still used by the task boards;
- the `git status --short mobile/` listing, split into "this plan" and "pre-existing", exactly as tabled above;
- anything ambiguous.

Also state in the report, for the owner's release step (spec §7, rollout order — mobile ships **last**, after `086` is applied and the backend is deployed, because the app now calls `setTicketStatus` / `transferTicket` / `escalateTicket` / `fetchCustomers` and no longer calls `moveTicketStage`):

```bash
# from mobile/ — release builds, run by the owner
pnpm ios:release        # expo run:ios --device --configuration Release
pnpm apk                # cd android && ./gradlew assembleRelease
```

**No `expo prebuild` is needed.** This spec adds no native module, no permission, no config plugin and no dependency — `app.config.ts`, `package.json` and `pnpm-lock.yaml` are all untouched, so `android/` and `ios/` regenerate to exactly what is already there. Running `expo prebuild --clean` anyway is harmless but wastes several minutes and is not part of this release (CLAUDE.md §9.1: there is no EAS and no OTA here, so the phone gets the new JS only by reinstalling the build).

---

### Task 25: Docs: `CLAUDE.md`, `ROLES.md`, Notion, deploy commands

**Files:**
- Modify (line numbers verified 2026-09-17, after the multi-client edits shifted §9): `CLAUDE.md:213-214` (§6 Sales config-engine bullets), `CLAUDE.md:218-220` (§6 Support), `CLAUDE.md:285-301` (§9 config engine on mobile, ticket lifecycle, known gap), `CLAUDE.md:487-497` (§9.6 boards)
- Modify: `backend/ROLES.md` — after the roles matrix (line ~45) add a "Complaints — write rules" block; Known-open unchanged
- No code. No tests. Run this task only after Tasks 1–24 are reviewed.

**Interfaces:**
- Consumes: the shipped names from the Contracts block (`sp_SetTicketStatus`, `canReopen`, `ticket_status` codes, `TatHours`).
- Produces: documentation only.

- [ ] **Step 1: `CLAUDE.md` §6 Sales — two bullets lose the pipeline engine**

Replace line 213:

```
- Per-company **config engine**: typed-EAV custom fields (`tblCustomFieldDef`/`tblCustomFieldValue`), configurable pipelines/stages (`tblPipeline`/`tblPipelineStage`), generic lookups (`tblLookup`) — all keyed by an `Entity` discriminator (`'lead'` / `'ticket'`).
```
with:
```
- Per-company **config engine**: typed-EAV custom fields (`tblCustomFieldDef`/`tblCustomFieldValue`) and generic lookups (`tblLookup`, with a machine `Code` and, for `priority`, `TatHours`) — keyed by an `Entity`/`Kind` discriminator (`'lead'` / `'ticket'`). The pipeline/stage engine (`tblPipeline`/`tblPipelineStage`) was deleted 2026-09-16 (`086`); nothing has stages any more.
```
In line 214 replace `(no pipeline since 2026-09-08; the pipeline engine now serves tickets only)` with `(no pipeline since 2026-09-08)`.

- [ ] **Step 2: `CLAUDE.md` §6 Support — replace the three bullets (lines 218–220) verbatim**

```
### Support (complaints)
- **Customer is a record** (`tblCustomer`, spec 2, 2026-09-16): name / contact person / mobile (unique per company while active) / email / address. A ticket has `CustomerId NOT NULL`; `ContactPerson`/`Contact` on the ticket are an optional "reported by" override. Customers are company-wide readable (dedupe), writable by any user, soft-deleted by admins only, never while a ticket references them. Lead → customer conversion is spec 3.
- **Tickets are flat** (`tblTicket.StatusId` → `tblLookup` `Kind='ticket_status'`), no board, no pipeline. **`Code` is the only branching key**: `open` / `onhold` (active) · `resolved` / `closed` / `rejected` (terminal). Labels are the company's and editable; never match on a label. **One engine writes the lifecycle: `sp_SetTicketStatus`** — `resolved` needs `ResolutionId` + remarks, `rejected` needs remarks, terminal → active is a **reopen** (remarks required, `@AllowReopen` must be 1, TAT clock restarts). `sp_Resolve/Close/Reject/ReopenTicket` are shortcuts into it. `ResolvedAt`/`ClosedAt`/`ResolutionId`/`DueAt` are never written elsewhere; `tblTicketStatusHistory` is written only there (plus the create row). Assignment moves only through `sp_TransferTicket`/`sp_BulkTransferTickets` (reason + remarks → `tblTicketAssignment`); `sp_SaveTicket` ignores `AssignedTo` on update.
- **TAT and escalation.** `priority.TatHours` → `tblTicket.DueAt` at create (anchor-preserving re-stamp on priority change, restart on reopen). **Overdue is computed on read** (`Code IN ('open','onhold') AND DueAt < GETDATE()`), never stored, no scheduler. `sp_EscalateTicket` flags a senior (`EscalatedTo` must be a `ReportsTo` ancestor of the assignee; ticket stays with the agent; `ticket_escalated` in-app notification). A manager's *Escalated* queue = non-terminal AND (`EscalatedTo = me` OR overdue in my subtree). **Reopen gate** lives in `permission.canReopen`: wide scope, or the assignee is in the caller's subtree and is not the caller. The 2026-07-16 SLA-engine removal stands: no `tblSLARule`, no business hours, no breach report — `TatHours` is the whole of it.
```

- [ ] **Step 3: `CLAUDE.md` §9 mobile — three paragraphs (lines 282–299)**

Replace the "Config engine on mobile" paragraph with:
```
**Config engine on mobile** (`src/api/configQueries.ts`): lookups and
custom-field definitions are read-only here — configuring them is admin desk
work and stays on the web. `Entity`/`Kind` discriminate, so Phase C reuses the
same fetchers with `Entity: 'lead'`.
```
Replace the "Ticket lifecycle is derived, never hardcoded" paragraph with:
```
**Ticket lifecycle keys on `StatusCode`, never on a label**
(`features/support/ticketHelpers.ts`). Status names are per-company and
editable; `lifecycleOf(ticket)` reads `ticket.StatusCode` (`open` / `onhold`
active, `resolved` / `closed` / `rejected` terminal). Every move calls
`setTicketStatus` — one endpoint — and the server answers 403 when the move is
a reopen the caller may not make; show that message, do not pre-empt it.
`saveTicket` never sends a status or, on edit, an assignee.
```
Delete the whole "**Known gap — do not build call logging on a ticket.**" paragraph (call logging on tickets shipped in `067`; web and mobile both have it).

- [ ] **Step 4: `CLAUDE.md` §9.6 boards (lines 484–495)**

- In the "Between kanban columns" bullet replace `` `moveTaskColumn` / `moveTicketStage` `` with `` `moveTaskColumn` ``.
- Replace `- **Both boards share `ui/BoardColumns`** — the horizontal snapping strip.` with `- **The task board uses `ui/BoardColumns`** — the horizontal snapping strip.`
- Replace the "**Mobile has no table view.**" bullet with:
```
- **Complaints are a list on both clients** (spec 2, 2026-09-16): presets
  (Mine · Team · Overdue · Escalated) + status chips + search. There is no
  ticket board anywhere any more; `BoardColumns` serves tasks only.
```

- [ ] **Step 5: `backend/ROLES.md` — add the complaints write rules after the matrix note ("Everyone gets Dashboard + Tasks …")**

```
### Complaints — write rules (spec 2, 2026-09-16)

| Action | Who |
|---|---|
| Read / edit / set status / log call | in scope, **or** assignee, **or** creator (`assertRecordAccess`) |
| Assign on create · Transfer | target ∈ `sp_FetchAssignableUsers(caller)` (`assertCanAssign`); cross-branch and unassign: wide scopes only |
| **Reopen** a resolved / closed / rejected complaint | `canReopen`: DataScope ∈ {All, Company, MultiBranch, Branch}, **or** the assignee is in the caller's `ReportsTo` subtree and is not the caller. Remarks required. An agent never reopens their own. |
| Escalate | must see the ticket; the target must be a `ReportsTo` ancestor of the assignee (SP-enforced) |
| Delete ticket | `assertRecordAccess` |
| Customers read / write | any authenticated user of the company |
| Customer delete | `requireAdmin`, and never while a ticket references it |
```

- [ ] **Step 6: Deploy commands — hand to the owner (user-run only, §0.6)**

Order is fixed by `086` dropping `StageId`: apply, then deploy the backend at once.

```bash
# 1. apply backend/sql/086_support_rebuild.sql by hand (SSMS / Azure Data Studio); read the verify block output
# 2. backend
cd ~/Developer/Nexus/CRM/backend
REMOTE=/www/wwwroot/shadowcodes.in/CRM
rsync -avzc src/ myserver:$REMOTE/src/
rsync -avzc package.json pnpm-lock.yaml pnpm-workspace.yaml Dockerfile docker-compose.yml .dockerignore .env.prd myserver:$REMOTE/
ssh myserver "cd $REMOTE && docker compose up -d --build crm && docker compose logs crm --tail=50"
sleep 10; curl -s https://shadowcodes.in/CRM/health   # 502 for a few seconds during the recreate is normal; expect 200 JSON
# 3. web
cd ~/Developer/Nexus/CRM/web && pnpm build
# upload the CONTENTS of web/dist-web/ to the IIS server's /CRM/ folder (usual upload); public/web.config travels with it
# 4. mobile — no native change, no prebuild
cd ~/Developer/Nexus/CRM/mobile && pnpm ios:release      # or: pnpm apk
```

Post-deploy checks in the browser after re-login (menu rights reload): Support shows **Tickets · Customers** (no Ticket Board); Settings has no Pipelines; `/support/board` bookmark lands on Tickets; create a complaint by typing a mobile → pick or create the customer → priority Urgent shows "due in 4h"; Resolve asks for resolution + remarks; as `se_ho_amit` Reopen on a closed ticket is refused with the server message; as `bm_ho_rahul` it works; Transfer needs reason + remarks; Escalate lists only seniors; Customers page shows the count of complaints per customer; dark mode readable.

- [ ] **Step 7: Notion (§0.5) — fetch the page, then `notion-update-page` with `content_updates`**

Page: "🎯 Nexus CRM" (`34871e5d-dab3-817d-b3da-fe181c615dc7`). Use the actual ship date, not "today".

- **✅ Done** — `- **<ship date>** — Complaints rebuild (spec 2): tblCustomer, flat ticket_status with Code, TatHours → DueAt, sp_SetTicketStatus engine, transfer/bulk/escalate with history, pipeline engine + boards deleted (web + mobile), Customers page, mobile complaints list. SQL 086.`
- **🐛 Bug Fix Log** — `- **<ship date>** — **deleteTicket had no record-access check** (any user could delete any ticket in the company by id). Fix: assertRecordAccess in ticketController.delete (spec 2).`
- **📅 Change Log** — `- **<ship date>** — /support/board removed (redirects to /support/tickets); /settings/pipelines removed; moveTicketStage + config pipeline endpoints removed; new /api/customers router; ticket_status / ticket_channel lookups; duplicate zero-member role rows 18–26 deleted.`
- **🔧 To Do** — `- Support report system (spec 4b) on the ReportPage frame: TAT compliance, aging, by customer, by agent.` and `- Run 077_remove_sales_demo.sql when the DEMO data is no longer wanted.` (keep if already present).

- [ ] **Step 8: Stop and report** — Leave the changes uncommitted (CLAUDE.md §0.1). Report: the four `CLAUDE.md` hunks, the `ROLES.md` block, the Notion blocks appended (with the dates used), and that the deploy commands were handed over.

---

### Task 26: Live verification pass after deploy → `docs/testing/<date>-support-live-test-report.md`

**Files:**
- Create (scratchpad only, never in the repo): `<scratchpad>/livetest/lib.mjs`, `<scratchpad>/livetest/support.mjs`
- Create: `docs/testing/<YYYY-MM-DD>-support-live-test-report.md` (date = run day)

**Interfaces:**
- Consumes: production API `https://shadowcodes.in/CRM` after `086` applied **and** backend + web deployed (the owner confirms both first — STOP until they do). `CRM_TEST_PWD` in the environment (the shared test password; never written to any file). Test users from Global Constraints. Lookup ids for company 1 read live in Task 10 (`ticket_status` codes → ids; `resolution` 8; `transfer_reason` 37 Overloaded, 39 sent_back).
- Produces: the report file; nothing else changes in the repo.

Every check is read-only against production except the rows this script itself creates (two customers, three tickets), all prefixed `LIVE TEST` so they are findable; tickets are deleted at the end, customers are left for the owner (delete is admin-only) and listed in the report.

- [ ] **Step 1: Recreate the runner**

```js
// <scratchpad>/livetest/lib.mjs
import fs from "node:fs";
export const BASE = "https://shadowcodes.in/CRM";
export const PWD = process.env.CRM_TEST_PWD; // never hard-code a live credential
const LOG = new URL("./test-log.jsonl", import.meta.url).pathname;
export const state = (() => { try { return JSON.parse(fs.readFileSync(new URL("./state.json", import.meta.url).pathname)); } catch { return { users: {}, tokens: {}, customers: {}, tickets: {} }; } })();
export const saveState = () => fs.writeFileSync(new URL("./state.json", import.meta.url).pathname, JSON.stringify(state, null, 2));
export function log(entry) { fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n"); }
export async function login(username, password = PWD) {
  const r = await fetch(`${BASE}/api/auth/loginUser`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(`login ${username}: ${r.status} ${j.message}`);
  state.tokens[username] = j.data.token; state.users[username] = state.users[username] || {}; Object.assign(state.users[username], { Id: j.data.user.Id, BranchId: Number(j.data.user.BranchId), IsAdmin: j.data.user.IsAdmin });
  return j.data;
}
export async function post(as, path, body = {}) {
  const token = state.tokens[as]; if (!token) throw new Error(`no token for ${as}`);
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ raw: true }));
  return { status: r.status, ok: j.success === true, message: j.message, data: j.data, code: j.code };
}
let n = 0; export const results = [];
export function check(phase, name, res, expectStatus, detail = (r) => r.message) {
  const pass = Array.isArray(expectStatus) ? expectStatus.includes(res.status) : res.status === expectStatus;
  const row = { n: ++n, phase, name, expect: expectStatus, got: res.status, pass, detail: typeof detail === "function" ? detail(res) : detail };
  results.push(row); log(row);
  console.log(`${pass ? "PASS" : "FAIL"} #${row.n} [${phase}] ${name} → ${res.status} (want ${expectStatus}) ${row.detail ?? ""}`);
  return res;
}
export function summary(phase) {
  const rows = results.filter((r) => r.phase === phase); const f = rows.filter((r) => !r.pass);
  console.log(`\n== ${phase}: ${rows.length - f.length}/${rows.length} passed`);
  for (const r of f) console.log(`   FAIL #${r.n} ${r.name}: got ${r.got}, want ${r.expect}`);
  return f.length === 0;
}
```

- [ ] **Step 2: The support script**

```js
// <scratchpad>/livetest/support.mjs — spec 2 §6 live pass. Personas: Company → Branch → Team → Self, plus another branch.
import { login, post, check, summary, state, saveState } from "./lib.mjs";

const P = { priya: "sh_priya", rahul: "bm_ho_rahul", neha: "tl_ho_neha", amit: "se_ho_amit", sara: "se_ho_sara", karan: "se_ho_karan", pooja: "se_se_pooja" };
for (const u of Object.values(P)) await login(u);
const id = (u) => state.users[u].Id;
const stamp = Date.now().toString().slice(-6);
const ok200 = (r) => `${r.message} ${r.data?.Id ?? ""}`;

// ---- lookups (company 1) — read once, key on Code, never on label
const statuses = (await post(P.priya, "/api/config/fetchLookups", { Kind: "ticket_status" })).data?.lookups ?? [];
const byCode = (c) => statuses.find((s) => s.Code === c)?.Id;
const S = { open: byCode("open"), onhold: byCode("onhold"), resolved: byCode("resolved"), closed: byCode("closed"), rejected: byCode("rejected") };
check("S0", `ticket_status codes present ${JSON.stringify(S)}`, { status: Object.values(S).every(Boolean) ? 200 : 500, message: "" }, 200);
const priorities = (await post(P.priya, "/api/config/fetchLookups", { Kind: "priority" })).data?.lookups ?? [];
const urgent = priorities.find((p) => p.Value.toLowerCase() === "urgent");
check("S0", `priority urgent has TatHours=4`, { status: urgent?.TatHours === 4 ? 200 : 500, message: JSON.stringify(urgent) }, 200);

// ---- S1 customers
let r = check("S1", "amit creates customer", await post(P.amit, "/api/customers/saveCustomer", { Id: 0, Name: `LIVE TEST Shop ${stamp}`, ContactPerson: "Test Person", Mobile: `9${stamp}001`, City: "Delhi" }), 200, ok200);
const custA = r.data?.Id; state.customers.A = custA;
check("S1", "duplicate mobile → 409", await post(P.amit, "/api/customers/saveCustomer", { Id: 0, Name: "LIVE TEST dup", Mobile: `9${stamp}001` }), 409);
check("S1", "neither mobile nor email → 400", await post(P.amit, "/api/customers/saveCustomer", { Id: 0, Name: "LIVE TEST none" }), 400);
check("S1", "missing name → 400", await post(P.amit, "/api/customers/saveCustomer", { Id: 0, Mobile: `9${stamp}002` }), 400);
r = check("S1", "pooja (other branch) creates customer", await post(P.pooja, "/api/customers/saveCustomer", { Id: 0, Name: `LIVE TEST South ${stamp}`, Email: `live${stamp}@example.com` }), 200, ok200);
const custB = r.data?.Id; state.customers.B = custB;
check("S1", "search finds it company-wide (amit sees pooja's)", await post(P.amit, "/api/customers/fetchCustomers", { SearchTerm: `LIVE TEST South ${stamp}` }), 200, (x) => `rows=${x.data?.customers?.length}`);
check("S1", "deleteCustomer by non-admin → 403", await post(P.amit, "/api/customers/deleteCustomer", { Id: custB }), 403);

// ---- S2 create tickets
check("S2", "create without CustomerId → 400", await post(P.amit, "/api/tickets/saveTicket", { Id: 0, Subject: "x", Priority: urgent.Id }), 400);
check("S2", "create without Subject → 400", await post(P.amit, "/api/tickets/saveTicket", { Id: 0, CustomerId: custA, Priority: urgent.Id }), 400);
r = check("S2", "amit creates T1 (urgent)", await post(P.amit, "/api/tickets/saveTicket", { Id: 0, CustomerId: custA, Subject: `LIVE TEST T1 ${stamp}`, Priority: urgent.Id, Description: "live test", AssignedTo: id(P.amit) }), 200, (x) => `${x.data?.TicketNo}`);
const T1 = r.data?.Id; state.tickets.T1 = T1;
let d = await post(P.amit, "/api/tickets/fetchTicketDetail", { TicketId: T1 });
const dueHours = d.data ? (new Date(d.data.ticket.DueAt) - new Date(d.data.ticket.CreatedAt)) / 36e5 : -1;
check("S2", `T1 detail: StatusCode=open, DueAt = CreatedAt + 4h (got ${dueHours.toFixed(2)})`, { status: d.data?.ticket?.StatusCode === "open" && Math.abs(dueHours - 4) < 0.05 && d.data.ticket.IsOverdue === false ? 200 : 500, message: d.message }, 200);
check("S2", "T1 detail carries the customer + PreviousTickets=0", { status: d.data?.ticket?.CustomerName?.startsWith("LIVE TEST Shop") && d.data.ticket.PreviousTickets === 0 ? 200 : 500, message: "" }, 200);
check("S2", "amit assigns to sara on create → 403 (not in his subtree)", await post(P.amit, "/api/tickets/saveTicket", { Id: 0, CustomerId: custA, Subject: "LIVE TEST bad assign", Priority: urgent.Id, AssignedTo: id(P.sara) }), 403);
r = check("S2", "neha creates T2 assigned to sara", await post(P.neha, "/api/tickets/saveTicket", { Id: 0, CustomerId: custA, Subject: `LIVE TEST T2 ${stamp}`, Priority: urgent.Id, AssignedTo: id(P.sara) }), 200);
const T2 = r.data?.Id; state.tickets.T2 = T2;
d = await post(P.amit, "/api/tickets/fetchTicketDetail", { TicketId: T1 });
check("S2", "T1 now shows PreviousTickets=1 (T2 same customer)", { status: d.data?.ticket?.PreviousTickets === 1 ? 200 : 500, message: "" }, 200);
check("S2", "update ignores AssignedTo (T1 stays with amit)", await post(P.amit, "/api/tickets/saveTicket", { Id: T1, CustomerId: custA, Subject: `LIVE TEST T1 ${stamp} edited`, Priority: urgent.Id, AssignedTo: id(P.sara) }), 200);
d = await post(P.amit, "/api/tickets/fetchTicketDetail", { TicketId: T1 });
check("S2", "  …verified", { status: d.data?.ticket?.AssignedTo === id(P.amit) && d.data.ticket.Subject.endsWith("edited") ? 200 : 500, message: "" }, 200);
saveState();

// ---- S3 lifecycle
check("S3", "resolve without resolution → 400", await post(P.amit, "/api/tickets/setTicketStatus", { TicketId: T1, StatusId: S.resolved, Remarks: "done" }), 400);
check("S3", "resolve without remarks → 400", await post(P.amit, "/api/tickets/setTicketStatus", { TicketId: T1, StatusId: S.resolved, ResolutionId: 8 }), 400);
check("S3", "on hold (free)", await post(P.amit, "/api/tickets/setTicketStatus", { TicketId: T1, StatusId: S.onhold }), 200);
check("S3", "resolve ok", await post(P.amit, "/api/tickets/resolveTicket", { TicketId: T1, ResolutionId: 8, Remarks: "fixed live" }), 200);
check("S3", "close ok", await post(P.amit, "/api/tickets/closeTicket", { TicketId: T1 }), 200);
d = await post(P.amit, "/api/tickets/fetchTicketDetail", { TicketId: T1 });
check("S3", "T1 closed with both timestamps", { status: d.data?.ticket?.StatusCode === "closed" && d.data.ticket.ResolvedAt && d.data.ticket.ClosedAt ? 200 : 500, message: "" }, 200);
check("S3", "amit (Self) reopens own → 403", await post(P.amit, "/api/tickets/reopenTicket", { TicketId: T1, Remarks: "not fixed" }), 403);
check("S3", "neha reopen without remarks → 400", await post(P.neha, "/api/tickets/reopenTicket", { TicketId: T1 }), 400);
check("S3", "neha (Team, amit in subtree) reopens → 200", await post(P.neha, "/api/tickets/setTicketStatus", { TicketId: T1, StatusId: S.open, Remarks: "customer says not fixed" }), 200);
d = await post(P.amit, "/api/tickets/fetchTicketDetail", { TicketId: T1 });
check("S3", "T1 open again, timestamps cleared, DueAt reset to future", { status: d.data?.ticket?.StatusCode === "open" && !d.data.ticket.ResolvedAt && !d.data.ticket.ClosedAt && new Date(d.data.ticket.DueAt) > new Date() ? 200 : 500, message: "" }, 200);
check("S3", "timeline has reopened + resolved + closed + status rows", { status: ["reopened", "resolved", "closed", "status"].every((t) => d.data.activity.some((a) => a.Type === t)) ? 200 : 500, message: JSON.stringify(d.data.activity.map((a) => a.Type)) }, 200);
check("S3", "reject without remarks → 400", await post(P.sara, "/api/tickets/rejectTicket", { TicketId: T2 }), 400);
check("S3", "sara rejects T2", await post(P.sara, "/api/tickets/rejectTicket", { TicketId: T2, Remarks: "duplicate of T1" }), 200);
check("S3", "same status again → 200 no-op", await post(P.sara, "/api/tickets/setTicketStatus", { TicketId: T2, StatusId: S.rejected, Remarks: "again" }), 200);
check("S3", "escalate a rejected ticket → 400", await post(P.neha, "/api/tickets/escalateTicket", { TicketId: T2, ToUserId: id(P.rahul), Remarks: "x" }), 400);

// ---- S4 transfer
check("S4", "transfer without remarks → 400", await post(P.neha, "/api/tickets/transferTicket", { TicketId: T1, ToUserId: id(P.sara), ReasonId: 37 }), 400);
check("S4", "amit transfers to karan (outside his roster) → 403", await post(P.amit, "/api/tickets/transferTicket", { TicketId: T1, ToUserId: id(P.karan), ReasonId: 37, Remarks: "x" }), 403);
check("S4", "amit sends back to neha (his manager) → 200", await post(P.amit, "/api/tickets/transferTicket", { TicketId: T1, ToUserId: id(P.neha), ReasonId: 39, Remarks: "need help" }), 200);
check("S4", "neha transfers to sara → 200", await post(P.neha, "/api/tickets/transferTicket", { TicketId: T1, ToUserId: id(P.sara), ReasonId: 37, Remarks: "balance load" }), 200);
check("S4", "no-op transfer → 400", await post(P.neha, "/api/tickets/transferTicket", { TicketId: T1, ToUserId: id(P.sara), ReasonId: 37, Remarks: "again" }), 400);
d = await post(P.sara, "/api/tickets/fetchTicketDetail", { TicketId: T1 });
check("S4", "assignment history has 2 rows with names", { status: d.data?.assignments?.length === 2 && d.data.assignments[0].ToUserName ? 200 : 500, message: JSON.stringify(d.data?.assignments?.map((a) => `${a.FromUserName}→${a.ToUserName}`)) }, 200);
check("S4", "rahul (Branch) bulk-transfers T1,T2 to karan", await post(P.rahul, "/api/tickets/bulkTransferTickets", { TicketIds: [T1, T2], ToUserId: id(P.karan), ReasonId: 40, Remarks: "bulk live" }), 200, (x) => `Transferred=${x.data?.Transferred} Skipped=${x.data?.Skipped}`);
check("S4", "amit (Self) can no longer open T1 (creator escape hatch still lets him read)", await post(P.amit, "/api/tickets/fetchTicketDetail", { TicketId: T1 }), 200);
check("S4", "sara can no longer open T1 → 404", await post(P.sara, "/api/tickets/fetchTicketDetail", { TicketId: T1 }), 404);

// ---- S5 escalation (T1 assigned to karan, who reports to rahul)
check("S5", "targets for karan = [rahul, priya]", await post(P.karan, "/api/tickets/fetchEscalationTargets", {}), 200, (x) => JSON.stringify(x.data?.users?.map((u) => u.Id)));
check("S5", "escalate to neha (not karan's senior) → 400", await post(P.karan, "/api/tickets/escalateTicket", { TicketId: T1, ToUserId: id(P.neha), Remarks: "x" }), 400);
check("S5", "escalate without remarks → 400", await post(P.karan, "/api/tickets/escalateTicket", { TicketId: T1, ToUserId: id(P.rahul) }), 400);
check("S5", "escalate to rahul → 200", await post(P.karan, "/api/tickets/escalateTicket", { TicketId: T1, ToUserId: id(P.rahul), Remarks: "customer furious" }), 200);
check("S5", "rahul's Escalated preset contains T1", await post(P.rahul, "/api/tickets/fetchTickets", { Escalated: 1, SearchTerm: `LIVE TEST T1 ${stamp}` }), 200, (x) => `rows=${x.data?.tickets?.length} escalatedTo=${x.data?.tickets?.[0]?.EscalatedToName}`);
check("S5", "rahul has a ticket_escalated notification", await post(P.rahul, "/api/notifications/fetchNotifications", { PageSize: 5 }), 200, (x) => JSON.stringify((x.data?.notifications ?? x.data ?? []).slice(0, 3).map((nn) => nn.Type)));

// ---- S6 visibility
const find = async (u, extra = {}) => post(u, "/api/tickets/fetchTickets", { SearchTerm: `LIVE TEST T1 ${stamp}`, ...extra });
check("S6", "pooja (other branch, Self) sees 0", await find(P.pooja), 200, (x) => `rows=${x.data?.tickets?.length}`);
check("S6", "priya (Company) sees 1", await find(P.priya), 200, (x) => `rows=${x.data?.tickets?.length}`);
check("S6", "rahul (Branch HO) sees 1", await find(P.rahul), 200, (x) => `rows=${x.data?.tickets?.length}`);
check("S6", "neha (Team) sees 0 now (karan not in her subtree)", await find(P.neha), 200, (x) => `rows=${x.data?.tickets?.length}`);
check("S6", "StatusCode=active excludes rejected T2", await post(P.priya, "/api/tickets/fetchTickets", { StatusCode: "active", SearchTerm: `LIVE TEST T2 ${stamp}` }), 200, (x) => `rows=${x.data?.tickets?.length}`);
check("S6", "BranchId filter narrows, never widens (pooja + BranchId 1 → 0)", await find(P.pooja, { BranchId: 1 }), 200, (x) => `rows=${x.data?.tickets?.length}`);
check("S6", "PageSize 5000 clamps to 200", await post(P.priya, "/api/tickets/fetchTickets", { PageSize: 5000 }), 200, (x) => `pageSize=${x.data?.pagination?.pageSize}`);
check("S6", "customer detail as amit (Self): RS2 only his visible complaints", await post(P.amit, "/api/customers/fetchCustomerDetail", { CustomerId: custA }), 200, (x) => `tickets=${x.data?.tickets?.length}`);
check("S6", "customer detail as priya: both", await post(P.priya, "/api/customers/fetchCustomerDetail", { CustomerId: custA }), 200, (x) => `tickets=${x.data?.tickets?.length}`);

// ---- S7 retired endpoints
check("S7", "moveTicketStage → 404", await post(P.priya, "/api/tickets/moveTicketStage", { TicketId: T1, StageId: 1 }), 404);
check("S7", "fetchPipelines → 404", await post(P.priya, "/api/config/fetchPipelines", { Entity: "ticket" }), 404);
check("S7", "old reports still answer", await post(P.priya, "/api/reports/ticketsByCategory", {}), 200);

// ---- cleanup (tickets only; customers need an admin — listed in the report)
check("S8", "pooja cannot delete T1 → 403", await post(P.pooja, "/api/tickets/deleteTicket", { Id: T1 }), 403);
check("S8", "priya deletes T1", await post(P.priya, "/api/tickets/deleteTicket", { Id: T1 }), 200);
check("S8", "priya deletes T2", await post(P.priya, "/api/tickets/deleteTicket", { Id: T2 }), 200);
check("S8", "deleteCustomer with no tickets now possible for an admin (skipped: no admin persona) — customer ids", { status: 200, message: `${custA}, ${custB}` }, 200);

let all = true; for (const ph of ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]) all = summary(ph) && all;
process.exit(all ? 0 : 1);
```

Run: `cd <scratchpad>/livetest && CRM_TEST_PWD='<owner supplies>' node support.mjs` (timeout 180000)
Expected: every `PASS`; exit 0. Expected counts in the detail column: S6 rows 0 / 1 / 1 / 0, active excludes T2 (rows=0), pageSize=200, customer detail tickets 1 (amit — T1 by creator escape hatch only while it exists) vs 2 (priya). On a FAIL, report the row verbatim — do not change SQL yourself.

- [ ] **Step 3: Write the report**

`docs/testing/<YYYY-MM-DD>-support-live-test-report.md`, same shape as `docs/testing/2026-09-09-sales-live-test-report.md`: target + method line, a phase table (S0–S8, checks, pass), the persona table (reuse the sales one — same users), what was created and what was left behind (the two `LIVE TEST` customers with ids, for the owner to delete), every FAIL verbatim with the request and response, and a "product defects found" section (empty if none). **Never include the password.**

- [ ] **Step 4: Stop and report** — Leave the report uncommitted (CLAUDE.md §0.1). Report: pass counts per phase, the customer ids left behind, any FAIL rows.

---

