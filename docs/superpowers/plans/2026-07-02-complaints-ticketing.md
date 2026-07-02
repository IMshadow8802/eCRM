# Complaints / Ticketing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship industry-agnostic complaint/ticketing (tickets, SLA, resolution, lead link) reusing the config engine from Spec 1.

**Architecture:** Same SP-per-action stack. **All ticket SQL was already created in `backend/sql/032_sales_config_engine.sql` (Phase 0 of the Sales plan)** — this plan adds the ticket **SPs**, backend, and web. Depends on Spec 1 being applied (config engine live).

**Tech Stack:** identical to Spec 1.

**Spec:** `docs/superpowers/specs/2026-07-02-complaints-ticketing-design.md`.

## Global Constraints

Same as Spec 1 (pnpm-only; SQL manual to `backend/sql/`; multi-tenant; test-first ≥80%; standard response; MUI v9 slotProps; shared config via `Entity='ticket'`). New ticket SPs, if not already in 032, go in a follow-on `backend/sql/033_ticket_sps.sql`.

---

## File Structure

- SQL: `backend/sql/033_ticket_sps.sql` (ticket + SLA SPs, + seed ticket pipeline/lookups/SLA rules) — **only if not folded into 032**.
- Backend: `controllers/ticketController.js`, `routes/ticketRoutes.js`; extend `callController` for `TicketId`; extend `reportController`; register routes.
- Web (parallel): `pages/Support/TicketBoard.jsx`, `Tickets.jsx`, `TicketDetail.jsx`; `pages/Settings/TicketCategories.jsx`, `Priorities.jsx`, `SLA.jsx`; reports. Reuse Spec-1 `DynamicField`, board component (parameterized by `Entity`), `salesQueries`→ add `supportQueries.js`.

---

## PHASE 0 — TICKET SQL (SPs + seed)

### Task 0.1: Ticket SPs + SLA + activity logger

**Files:** Create/append `backend/sql/033_ticket_sps.sql`.

**Interfaces (exact — backend depends on these):**
- `sp_LogTicketActivity(@CompId,@TicketId,@UserId,@Type,@Summary,@MetaJSON)`.
- `sp_SaveTicket(@Id,@CompId,@BranchId,@CustomerName,@Contact,@Channel,@CategoryId,@Priority,@PipelineId,@StageId,@AssignedTo,@LinkedLeadId,@Description,@CustomJSON,@UserId)` — on insert: auto `TicketNo` (`TKT-` + zero-padded per-company sequence), compute `SLADueAt` from `tblSLARule` for `@Priority` (fallback company default), upsert custom values, log `created`. Returns ticket `Id` + `TicketNo`.
- `sp_FetchTickets(@CompId,@BranchId,@PageNumber,@PageSize,@SearchTerm,@StageId,@Priority,@CategoryId,@AssignedTo,@BreachedOnly)` — paged; `IsBreached` computed column (`SLADueAt < GETDATE() AND ResolvedAt IS NULL`).
- `sp_FetchTicketDetail(@CompId,@TicketId)` — 4 result sets: core, custom values, activity, linked-lead summary (null-safe).
- `sp_MoveTicketStage(@CompId,@TicketId,@StageId,@UserId)`.
- `sp_ResolveTicket(@CompId,@TicketId,@ResolutionId,@UserId)` — stamp `ResolvedAt`, log `resolved`; `sp_CloseTicket` (stamp `ClosedAt`); `sp_ReopenTicket` (clear `ResolvedAt`, log `reopened`).
- `sp_SaveSLARule`, `sp_FetchSLARules(@CompId)`.
- Reports: `sp_SLABreachSummary`, `sp_TicketsByCategory`, `sp_ResolutionSummary`.

- [ ] **Step 1: Write** all SPs. `sp_SaveTicket` and resolve/close wrap writes in `BEGIN TRAN`/`TRY-CATCH`. TicketNo sequence: `SELECT COUNT(*)+1 FROM tblTicket WHERE CompId=@CompId` inside the tran (acceptable for expected volume; `ponytail:` note the ceiling — swap to a sequence table if contention appears).
- [ ] **Step 2: Seed** (per company): ticket pipeline (`Entity='ticket'`, stages New/Assigned/In-Progress/Resolved(won)/Closed(won)/Rejected(lost)); lookups `priority`(low/medium/high/urgent), `ticket_category`(General/Billing/Technical), `resolution`(Fixed/Won't-fix/Duplicate); default `tblSLARule` per priority (e.g. urgent 240min, high 480, medium 1440, low 2880).
- [ ] **Step 3: Verification** (comment): `EXEC sp_SaveTicket ...` returns TicketNo `TKT-000001` + a non-null `SLADueAt`; `sp_FetchTickets @BreachedOnly=1` filters correctly.
- [ ] **Step 4:** Hand `033_ticket_sps.sql` to user to apply; wait for confirmation.
- [ ] **Step 5: Commit** `git commit -am "sql(033): ticket + SLA SPs + seed"`

---

## PHASE 1 — BACKEND

### Task 1.1: Ticket controller

**Files:** Create `backend/src/controllers/ticketController.js`, `routes/ticketRoutes.js`; register `/api/tickets`. Test: `backend/tests/unit/controllers/ticketController.test.js`.

**Interfaces:** `ticketController.save/fetch/detail/moveStage/resolve/close/reopen/delete(req,res)`.

- [ ] **Step 1: Failing tests** — `save` injects CompId/BranchId/UserId + passes CustomJSON + LinkedLeadId; `detail` maps 4 recordsets → `{ ticket, fields, activity, linkedLead }`; `resolve` requires `ResolutionId` (400 if SP rejects).
- [ ] **Step 2:** FAIL. **Step 3:** Implement handlers mapping to Phase-0 SPs; respect `ResponseCode` for status. **Step 4:** `cd backend && pnpm test -- ticketController --coverage` PASS ≥80%. **Step 5:** `git commit -am "feat(backend): ticket controller"`

### Task 1.2: Calls for tickets + ticket reports

**Files:** Modify `callController.js` (accept `TicketId`), `reportController.js` (+3 SLA/category/resolution handlers) + routes. Extend tests.

- [ ] **Step 1: Failing tests** — `logCall` with `TicketId` set, `LeadId` null; report handlers call their SPs. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS ≥80%. **Step 5:** `git commit -am "feat(backend): ticket calls + reports"`

### Task 1.3: Backend gate

- [ ] `cd backend && pnpm test -- --coverage` → green, ≥80% touched.

---

## PHASE 2 — WEB (parallelizable)

> Prerequisite Task 2.0 first; then 2.1–2.4 in parallel. Board/detail reuse Spec-1 components parameterized by `Entity='ticket'`.

### Task 2.0: Support scaffolding (prerequisite)

**Files:** Create `web/src/api/supportQueries.js`; modify `App.jsx` (`/support/*` routes), `Sidebar.jsx` (Support menu). Parameterize the Spec-1 pipeline board component to accept `entity`/endpoints if not already generic.

- [ ] **Step 1: Failing test** for a smoke render of a Support route. **Step 2:** FAIL. **Step 3:** Implement queries + routes + menu. **Step 4:** PASS. **Step 5:** `git commit -am "feat(web): support scaffolding"`

### Task 2.1: Ticket board (parallel)

**Files:** `web/src/pages/Support/TicketBoard.jsx` + test.
- [ ] **Step 1: Failing test** — renders ticket stages; cards show TicketNo, priority chip, SLA-breach chip, assignee; drag → `moveTicketStage`. MSW handlers. **Step 2:** FAIL. **Step 3:** Implement reusing the parameterized board. **Step 4:** PASS ≥80%. **Step 5:** commit.

### Task 2.2: Tickets table (parallel)

**Files:** `web/src/pages/Support/Tickets.jsx` + test.
- [ ] **Step 1: Failing test** — `useServerTable` → `/api/tickets/fetchTickets`; breach + category/priority/assignee filters. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS ≥80%. **Step 5:** commit.

### Task 2.3: Ticket detail + resolve/reopen (parallel)

**Files:** `web/src/pages/Support/TicketDetail.jsx` (+ reuse Timeline, LogCallModal) + test.
- [ ] **Step 1: Failing tests** — header (core + SLA chip + linked-lead link) from `fetchTicketDetail`; custom fields via `DynamicField`; Resolve modal submits `resolveTicket` with `ResolutionId`; Reopen visible when resolved. **Step 2:** FAIL. **Step 3:** Implement (reuse Spec-1 Timeline + LogCallModal). **Step 4:** PASS ≥80%. **Step 5:** commit.

### Task 2.4: Ticket settings + reports (parallel)

**Files:** `web/src/pages/Settings/TicketCategories.jsx`, `Priorities.jsx`, `SLA.jsx`; `pages/Reports/SLABreach.jsx`, `TicketsByCategory.jsx`, `ResolutionSummary.jsx` + tests.
- [ ] **Step 1: Failing tests** — settings CRUD via `/api/config/*` (Entity/Kind=ticket) + `/api/config/saveSLARule`; reports wire `useApiQuery`. **Step 2:** FAIL. **Step 3:** Implement reusing Spec-1 Settings + Reports patterns (SLA page edits `tblSLARule` per priority). **Step 4:** PASS ≥80%. **Step 5:** commit.

### Task 2.5: Web gate

- [ ] `cd web && pnpm test -- --run --coverage` → green, ≥80% touched.

---

## Self-review notes (coverage of Spec 2 §)

- Tables (§4) created in Sales Phase 0; SPs (§7) → Phase 0 here; SLA (§5) → `sp_SaveTicket` compute + `sp_FetchTickets` breach flag + `tblSLARule`. Workflow (§6) → resolve/close/reopen SPs + controller 1.1. UI (§8) → 2.0–2.4. Reuse (§3) → shared config SPs (Entity/Kind='ticket'), shared `tblCall`+`TicketId`, parameterized board, `DynamicField`. Lead link (§4) → `LinkedLeadId` in `sp_SaveTicket`/detail.
