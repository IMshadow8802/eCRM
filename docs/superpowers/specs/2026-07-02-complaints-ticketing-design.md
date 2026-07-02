# Spec 2 — Complaints / Ticketing

**Date:** 2026-07-02
**Status:** Design approved, pending spec review
**Sub-project:** 2 of 2 (depends on Spec 1's shared config engine)
**Applies to:** `backend/` + `web/` (mobile deferred)

---

## 1. Purpose & context

Add an industry-agnostic complaint/ticketing system so any client can raise and
resolve support tickets. It **reuses the shared config engine built in Spec 1**
(custom fields, pipelines/stages, lookups) via the `Entity='ticket'` discriminator,
plus the activity-timeline and call-logging patterns. This spec adds only what is
ticket-specific: the ticket entity, SLA, resolution flow, and a lead↔ticket link.

Depends on Spec 1 being built first (the config engine tables/SPs must exist).

## 2. Scope

**In scope**
- `tblTicket` + `tblTicketActivity` (same timeline pattern as leads).
- Ticket workflow via a `ticket` pipeline (New → Assigned → In-Progress → Resolved →
  Closed), configurable per company.
- Ticket-specific lookups (category, priority, resolution) via the shared
  `tblLookup` (new `Kind` values).
- Custom fields for tickets via the shared engine (`Entity='ticket'`).
- **SLA**: priority → response/resolution target; `SLADueAt` computed on create;
  breach surfaced on board + report.
- **Lead link**: a ticket may reference the customer's lead (`LinkedLeadId`).
- Call logging attachable to a ticket (reuses `tblCall`, add nullable `TicketId`).
- Ticket board (Kanban), table, detail (timeline + custom fields + log-call +
  resolve), Settings (categories/priorities/SLA), SLA-breach + resolution reports.

**Deferred / non-goals**
- Telephony (seams only, shared with Spec 1).
- Customer-facing portal / email-to-ticket ingestion.
- Automations/escalation workflows beyond the SLA breach flag.
- Per-field permissions; mobile parity.

## 3. Reuse from Spec 1 (no duplication)

- **Custom fields** — `tblCustomFieldDef`/`tblCustomFieldValue` with `Entity='ticket'`.
- **Pipeline/stages** — `tblPipeline`/`tblPipelineStage` with `Entity='ticket'`;
  `StageType` reused as `open|won|lost` where `won`≈Resolved/Closed terminal,
  `lost`≈Rejected/Duplicate (terminal-negative). (Naming stays generic in the
  engine; ticket UI labels the stages.)
- **Lookups** — shared `tblLookup`, new `Kind`: `ticket_category`, `priority`,
  `resolution`.
- **Activity logger** — same pattern; `sp_LogTicketActivity` writing
  `tblTicketActivity`.
- **Calls** — shared `tblCall`; add nullable `TicketId` (a call links to a lead OR a
  ticket).
- **Config SPs** — the Spec 1 config SPs already take `Entity`; no new config SPs.

## 4. Data model (new / changed)

**`tblTicket`**
```
Id, CompId, BranchId,
TicketNo          -- auto-generated per company (e.g. TKT-000123)
CustomerName, Contact, Channel,   -- Channel: phone|email|walk-in|web|other
CategoryId        -> tblLookup (Kind=ticket_category)
Priority          -> tblLookup (Kind=priority)   (low|medium|high|urgent seeded)
PipelineId, StageId,
AssignedTo        -- user
LinkedLeadId (null) -> tblLeads.Id
SLADueAt,         -- computed on create from priority
ResolvedAt, ClosedAt,
ResolutionId (null) -> tblLookup (Kind=resolution)
Description,
CreatedBy, EditBy, CreatedAt, UpdatedAt
```

**`tblTicketActivity`** — same shape as `tblLeadActivity`.
```
Id, CompId, TicketId, UserId,
Type    -- created | stage_changed | assigned | call | note | field_changed | resolved | reopened | closed
Summary, MetaJSON, CreatedAt
```

**`tblSLARule`** — per-company priority → targets.
```
Id, CompId, Priority (lookup id), ResponseMins, ResolutionMins, IsActive
```

**`tblCall`** (from Spec 1) — add `TicketId (null)`; exactly one of
`LeadId`/`TicketId` set.

## 5. SLA behavior

- On ticket create, `SLADueAt = CreatedAt + SLARule.ResolutionMins` for its
  priority (falls back to a company default if unset).
- A ticket past `SLADueAt` and not resolved is **breached** — computed flag
  (`SLADueAt < now AND ResolvedAt IS NULL`), shown as a red chip on the board and
  counted in the SLA report. No background job needed (evaluated on read).

## 6. Workflow

1. Raise ticket (manual/web) → auto `TicketNo` + `SLADueAt` + `created` activity.
2. Assign to a user (`assigned` activity).
3. Work: log calls/notes/updates, move stages, edit custom fields — all logged.
4. **Resolve**: pick `ResolutionId`, stamp `ResolvedAt`, move to Resolved stage.
5. **Close**: stamp `ClosedAt`. **Reopen** allowed → clears ResolvedAt, logs
   `reopened` (audit preserved in activity).

## 7. API / stored-procedure surface

All POST, SP-per-action, `CompId`/`BranchId`/`CreatedBy` injected.

**Tickets** (`/api/tickets/*`)
- `sp_SaveTicket` — upsert; on insert auto-number + compute SLA + custom values +
  activity (one tx)
- `sp_FetchTickets` — paged; filter by stage/priority/category/assignee/breach +
  custom fields
- `sp_FetchTicketDetail` — core + custom values + timeline + linked lead summary
- `sp_MoveTicketStage` — stage change + activity
- `sp_ResolveTicket` — resolution + stamps + activity
- `sp_ReopenTicket`, `sp_CloseTicket`
- `sp_DeleteTicket`

**SLA config** (`/api/config/*`, shared namespace)
- `sp_SaveSLARule`, `sp_FetchSLARules`

**Calls** — reuse `sp_LogCall` (accepts `TicketId` or `LeadId`).

**Timeline** — `sp_FetchTicketActivity`; internal `sp_LogTicketActivity`.

**Reports** — `sp_SLABreachSummary`, `sp_TicketsByCategory`,
`sp_ResolutionSummary`.

## 8. Web UI surface

- **Ticket board** (`pages/Support/TicketBoard.jsx`) — Kanban of ticket stages;
  cards show TicketNo, customer, priority chip, SLA-breach chip, assignee. Reuses
  the pipeline-board component from Spec 1 parameterized by `Entity`.
- **Tickets table** (`pages/Support/Tickets.jsx`) — `useServerTable`; filters incl.
  breach + custom fields.
- **Ticket detail** (`pages/Support/TicketDetail.jsx`) — header (core + SLA + linked
  lead), Timeline tab, custom fields, Log Call, Resolve/Close/Reopen actions.
- **Settings** — `TicketCategories.jsx`, `Priorities.jsx`, `SLA.jsx` (reuses the
  Spec-1 Lookups/CustomFields/Pipelines admin, filtered to `Entity='ticket'`).
- **Reports** — SLA breach, tickets by category, resolution summary.

## 9. Testing

Same standard as Spec 1: Jest per controller (happy + failure, ≥80% touched),
Vitest + MSW per page. SLA computation gets explicit unit tests (breach boundary,
missing rule fallback). Migration reviewed against snapshot before manual apply.

## 10. Build phasing

1. **SQL** — `tblTicket`, `tblTicketActivity`, `tblSLARule`, `tblCall +TicketId`,
   seed ticket pipeline + priority/category/resolution lookups + default SLA rules.
   (Bundled with Spec 1's SQL batch if built together, else a follow-on script.)
2. **Backend** — ticket + SLA controllers/routes; extend calls controller for
   `TicketId`.
3. **Web** — parallel agents: Ticket board, Tickets table/detail, Settings,
   Reports. The board/detail reuse Spec-1 components parameterized by `Entity`.

## 11. Interfaces recap (isolation check)

- **Depends on Spec 1** only through the shared config SPs (`Entity` param), the
  `tblCall` table, and the activity-logger pattern. No duplication of field/pipeline
  logic.
- **SLA** is a self-contained module (`tblSLARule` + read-time breach computation);
  removable/replaceable without touching ticket CRUD.
- **Lead link** is a nullable FK only; tickets function fully standalone when
  `LinkedLeadId` is null.
