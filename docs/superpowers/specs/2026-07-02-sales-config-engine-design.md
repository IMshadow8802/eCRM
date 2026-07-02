# Spec 1 — Sales Management + Shared Config Engine

**Date:** 2026-07-02
**Status:** Design approved, pending spec review
**Sub-project:** 1 of 2 (Spec 2 = Complaints/Ticketing, reuses this engine)
**Applies to:** `backend/` + `web/` (mobile deferred)

---

## 1. Purpose & context

The CRM already has product-sales Leads, Follow-ups, Source/Status lookups, and two
reports — all end-to-end (stored procedure → controller → React), multi-tenant
(`CompId`/`BranchId`) with activity logging. The current Lead is hardwired for one
vertical: `ProductCategory/Brand/Model/Budget/InvoiceNo`.

**Goal:** make sales usable by clients in *any* industry (real-estate, clinic,
insurance, product retail, …) by moving industry-specific fields into a
**per-company configuration engine**, while adding **manual call logging** and a
**visual pipeline** on top of the existing leads/follow-ups.

This spec covers Sales; it also builds the **shared config engine** that Spec 2
(Complaints) reuses via an `Entity` discriminator.

## 2. Scope

**In scope**
- Shared config engine (only as sales needs it): custom-field defs + typed-EAV
  values, configurable pipelines/stages, generic lookups. All keyed by `Entity`
  (`'lead'` now, `'ticket'` in Spec 2).
- Generalized `tblLeads` (neutral core columns + custom fields), with a migration
  that turns today's product columns into seeded custom fields and backfills data.
- Manual **call logging** (`tblCall`) with telephony seams (nullable
  `ExternalCallId`/`RecordingUrl`/`Provider`) but no telephony code.
- Follow-ups extended so a call can spawn its follow-up in one action.
- Unified **lead activity timeline** (`tblLeadActivity`) via a single logger SP.
- **Pipeline board** (Kanban of configurable stages) + leads table + lead detail.
- Company **Settings** pages: Custom Fields, Pipelines/Stages, Lookups.
- Sales reports: keep the 2 existing; add pipeline funnel, calls-per-user,
  conversion-by-source.

**Deferred / non-goals**
- Complaints/ticketing → Spec 2.
- Telephony integration (design leaves seams only).
- Automations, lead scoring, email/SMS, dedupe/import wizards, mobile parity.
- Per-field-level permissions (config is company-admin-level only).
- Cross-company field sharing.

## 3. Data model

`Entity` discriminator values: `'lead'` (this spec), `'ticket'` (Spec 2).

### 3.1 Config engine (shared)

**`tblCustomFieldDef`** — definition of a configurable field for an entity.
```
Id, CompId, Entity, FieldKey, Label,
Type            -- text | number | date | dropdown | checkbox
Options         -- JSON array of choices (dropdown only)
IsRequired, SortOrder, IsActive, CreatedBy, CreatedAt
```
Unique: `(CompId, Entity, FieldKey)`.

**`tblCustomFieldValue`** — typed value per (entity row, field).
```
Id, CompId, Entity, EntityId, FieldId,
ValueText, ValueNumber, ValueDate
```
Exactly one Value* column is populated per row, chosen by the field `Type`
(checkbox → ValueNumber 0/1; dropdown → ValueText). Typed columns keep
sort/filter/report correct. Unique: `(EntityId, FieldId)`.

**`tblPipeline`** — a named stage sequence for an entity.
```
Id, CompId, Entity, Name, IsDefault, IsActive, CreatedAt
```

**`tblPipelineStage`**
```
Id, PipelineId, Name, SortOrder,
StageType       -- open | won | lost
Color, IsActive
```

**`tblLookup`** — generic per-company lookup, replaces standalone Source/Status.
```
Id, CompId, Kind, Value, SortOrder, IsActive
-- Kind: lead_source | call_outcome | lost_reason | (Spec 2: ticket_category | priority | resolution)
```

### 3.2 Sales core

**`tblLeads`** (rebuilt — product columns removed)
```
Id, CompId, BranchId,
Name, MobileNo, AltMobile, Email,
SourceId          -> tblLookup (Kind=lead_source)
PipelineId, StageId,
OwnerId           -- assigned user (was AssignTo)
EstValue          -- money (neutral 'Budget')
NextFollowupDate,
LostReasonId      -> tblLookup (Kind=lost_reason), null unless lost
WonAt, LostAt,
CreatedBy, EditBy, CreatedAt, UpdatedAt
```
Industry-specific data (Category/Brand/Model/Budget/etc.) lives in
`tblCustomFieldValue` with `Entity='lead'`.

**`tblCall`** — a logged call. Telephony-ready seams are nullable.
```
Id, CompId, LeadId, UserId,
Direction         -- out | in
OutcomeId         -> tblLookup (Kind=call_outcome)
Notes, Duration (null),
CalledAt,
ExternalCallId (null), RecordingUrl (null), Provider (null)
```

**`tblFollowUp`** (extended — keep existing shape, add link)
```
... existing (Id, LeadId, NextFollowupDate, FollowupType, Remarks, Status, CompId, BranchId, CreatedBy, EditBy) ...
+ SourceCallId (null)   -- the call that scheduled this follow-up, if any
```

**`tblLeadActivity`** — unified chronological timeline.
```
Id, CompId, LeadId, UserId,
Type       -- created | stage_changed | call | followup | note | field_changed | assigned | won | lost
Summary    -- human-readable one-liner
MetaJSON   -- structured detail (old/new stage, callId, fieldKey, etc.)
CreatedAt
```

## 4. Config & pipeline behavior

- Company admin manages fields, pipelines/stages, and lookups from **Settings**.
- Each company is seeded one **default pipeline** (`IsDefault=1`); leads reference
  `PipelineId/StageId` instead of the old free-text `LeadStatus`.
- Stage `StageType`:
  - moving a lead into a `won` stage stamps `WonAt` and logs a `won` activity;
  - moving into a `lost` stage requires `LostReasonId`, stamps `LostAt`, logs `lost`.
- Custom fields render dynamically on the lead form/detail from
  `tblCustomFieldDef` (ordered by `SortOrder`, required enforced server-side).

## 5. Sales workflow + timeline

1. Lead created (manual/web) in the default pipeline's first `open` stage.
2. Rep **logs calls**: outcome + notes, optionally schedules the next follow-up in
   the same action (`sp_LogCall` writes call + follow-up + activity in one tx).
3. Rep drags the lead across pipeline stages (board) or edits fields (detail).
4. Lead reaches a `won` or `lost` stage → stamped + logged.

**Every** state-changing action funnels through `sp_LogLeadActivity`, so the lead
detail shows one chronological timeline (calls, follow-ups, stage moves, field
edits, assignment, won/lost) — mirroring the existing task-activity pattern.

## 6. API / stored-procedure surface

All endpoints POST, SP-per-action, standardized response
(`ResponseCode`/`ResponseMess` + data), `CompId`/`BranchId`/`CreatedBy` injected
from `req.user`.

**Config** (`/api/config/*`)
- `sp_SaveCustomField`, `sp_FetchCustomFields` (by Entity), `sp_DeleteCustomField`
- `sp_SavePipeline`, `sp_FetchPipelines` (by Entity)
- `sp_SaveStage`, `sp_DeleteStage`
- `sp_SaveLookup`, `sp_FetchLookups` (by Kind), `sp_DeleteLookup`

**Leads** (`/api/leads/*`)
- `sp_SaveLead` — upsert core + custom values + activity, one tx
- `sp_FetchLeads` — paged; filter by stage/owner/source + custom fields
- `sp_FetchLeadDetail` — core + custom values + timeline
- `sp_MoveLeadStage` — stage change with won/lost rules + activity
- `sp_TransferLead` — reassign owner + activity (keep existing behavior)
- `sp_DeleteLead`

**Calls** (`/api/calls/*`)
- `sp_LogCall` — insert call, optional follow-up, activity — atomic
- `sp_FetchCalls` — by lead / by user (reporting)

**Follow-ups** (`/api/followups/*`) — keep `sp_SaveFollowUp`/`sp_FetchFollowUp`,
extend for `SourceCallId`.

**Timeline** — `sp_FetchLeadActivity`; internal `sp_LogLeadActivity` (called by the
others, not exposed as its own route).

**Reports** (`/api/reports/*`) — keep existing; add `sp_PipelineFunnel`,
`sp_CallsPerUser`, `sp_ConversionBySource`.

## 7. Migration (one manual-applied script)

`backend/sql/032_sales_config_engine.sql` (single batch, user runs by hand;
Spec 2's ticket tables bundle into the same batch per the "all SQL at once" build
order):
1. Create config tables (`tblCustomFieldDef`, `tblCustomFieldValue`, `tblPipeline`,
   `tblPipelineStage`, `tblLookup`), `tblCall`, `tblLeadActivity`.
2. Alter `tblFollowUp` (+`SourceCallId`).
3. Rebuild `tblLeads`: add neutral core columns; migrate old data:
   - seed product custom-field defs (Category, Brand, Model, Budget) for existing
     companies and backfill their column values into `tblCustomFieldValue`;
   - `tblLeadSource` rows → `tblLookup` (Kind=lead_source); repoint `SourceId`;
   - `tblStatus` values → default pipeline stages; map each lead's old status →
     `StageId`;
   - Invoice fields (`InvoiceNo/InvoiceDate`) → won-stage custom fields.
4. Drop the retired product columns after backfill verification.

Migration is idempotent-guarded (existence checks) and wrapped in a transaction.

## 8. Web UI surface

- **Pipeline board** (`pages/Sales/Pipeline.jsx`) — Kanban of stages; lead cards
  show name, EstValue, next-follow-up chip, owner avatar; drag to move stage.
  Reuses the `@dnd-kit/react` + optimistic-cache pattern from the task board.
- **Leads table** (`pages/Sales/Leads.jsx`) — `useServerTable`; filters for
  stage/owner/source + custom fields.
- **Lead detail** (`pages/Sales/LeadDetail.jsx`) — header (core + stage), Timeline
  tab, Custom-fields section (rendered from defs), **Log Call** action, Follow-ups
  list.
- **Settings** — `CustomFields.jsx`, `Pipelines.jsx`, `Lookups.jsx`.
- **Reports** — keep 2 existing; add Pipeline funnel, Calls-per-user, Conversion
  by source.

All use existing patterns: `useApiQuery`/`useApiMutation`, `ui/` components,
MUI v9 `slotProps`, dark/light.

## 9. Testing

- **Backend:** Jest per controller — happy path + ≥1 failure/edge; mock DB per the
  established `jest.mock("config/database")` pattern; ≥80% line/branch on touched
  files.
- **Web:** Vitest + React Testing Library + MSW; a handler per new endpoint; render
  + interaction tests per page.
- **Migration:** not unit-tested (manual), but the seed/backfill logic is reviewed
  against a data snapshot before apply.

## 10. Build phasing

1. **SQL** — all tables + SPs + migration/seed in one batch (`backend/sql/`), user
   applies by hand.
2. **Backend** — config, leads, calls, follow-ups, reports controllers/routes.
3. **Web** — fanned out to parallel agents by independent page (Pipeline board,
   Leads table/detail, Settings, Reports).

## 11. Interfaces recap (isolation check)

- **Config engine** — owns field defs/values, pipelines, lookups. Consumed by Sales
  (and Spec 2) only through the config SPs + `Entity` param. Internals (EAV shape)
  can change without touching consumers.
- **Activity logger** — single `sp_LogLeadActivity`; all mutators call it. Timeline
  readers depend only on `tblLeadActivity`.
- **Call logging** — `sp_LogCall` is the one entry point; telephony later becomes an
  adapter that fills the nullable seam columns, no schema change.
