# Sales Management + Shared Config Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship industry-agnostic sales management — a per-company config engine (custom fields, pipelines, lookups), generalized leads, manual call logging, and a pipeline board — on top of the existing CRM.

**Architecture:** SP-per-action over SQL Server; Express controllers call `database.executeStoredProcedure`; React (Vite/MUI v9) consumes via `useApiQuery`/`useApiMutation`. Build is phased by layer: **Phase 0 = one SQL batch** (schema + SPs + migration for BOTH this spec and Spec 2, applied manually), **Phase 1 = backend**, **Phase 2 = web** (fanned out to parallel agents by page).

**Tech Stack:** SQL Server (mssql), Express 5, Jest+Supertest (backend), React 19 + Vite + MUI v9 + `@dnd-kit/react` + `@tanstack/react-query`, Vitest + RTL + MSW (web).

**Specs:** `docs/superpowers/specs/2026-07-02-sales-config-engine-design.md` (this) and `2026-07-02-complaints-ticketing-design.md` (Spec 2 — its tables are created in Phase 0 here; its app layers are a separate plan).

## Global Constraints

- **pnpm only** — never npm (corrupts lockfile).
- **Never auto-apply SQL** — all DDL/DML goes to `backend/sql/NNN_*.sql`; the user runs it by hand. Do NOT call sqlcmd/mcp SQL write tools for schema. Next number is **032**.
- **Multi-tenant** — every table has `CompId` (+ `BranchId` where a lead/ticket); every SP filters by them; controllers inject `CompId`/`BranchId`/`CreatedBy` from `req.user`.
- **Test-first** — no backend/web change ships without tests proving it; files touched must reach **≥80%** line/branch coverage. Reuse `jest.mock("../../../src/config/database")` (backend) and MSW handlers (web).
- **Standard response** — SPs return `ResponseCode`, `ResponseMess` + data columns; controllers wrap via `utils/responseHelper.js`.
- **Activity logging** — every lead mutator writes `tblLeadActivity` through `sp_LogLeadActivity` (single logger), mirroring the task-activity pattern.
- **MUI v9** — use `slotProps` (not `InputProps`); `<Stack>`/`<Box>` layout via `sx`.
- **CompId/Entity discriminator** — config tables are shared; `Entity` is `'lead'` here, `'ticket'` in Spec 2. Do not fork per-entity config tables.

---

## File Structure

**Phase 0 — SQL (one file, manual apply)**
- Create: `backend/sql/032_sales_config_engine.sql` — all tables (config engine + sales + **Spec 2 ticket tables**), all SPs for sales+config, and the leads migration/seed/backfill. One transaction-guarded batch.

**Phase 1 — Backend**
- Create: `backend/src/controllers/configController.js` — custom fields, pipelines, stages, lookups.
- Create: `backend/src/routes/configRoutes.js`
- Modify: `backend/src/controllers/leadController.js` — rewrite for new schema (core + custom values + activity, detail, move-stage).
- Create: `backend/src/controllers/callController.js` — `logCall`, `fetchCalls`.
- Create: `backend/src/routes/callRoutes.js`
- Modify: `backend/src/controllers/followupController.js` — accept `SourceCallId`.
- Modify: `backend/src/controllers/reportController.js` — add funnel/calls/conversion.
- Modify: `backend/src/config/routes.js` — register config + calls routes.
- Tests under `backend/tests/unit/controllers/`.

**Phase 2 — Web (parallel agents; each page independent)**
- Create: `web/src/api/salesQueries.js` — endpoint constants + fetchers.
- Create: `web/src/pages/Sales/Pipeline.jsx` (+ board components) — Kanban.
- Create: `web/src/pages/Sales/Leads.jsx` — `useServerTable`.
- Create: `web/src/pages/Sales/LeadDetail.jsx` (+ Timeline, CustomFields, LogCallModal, FollowUps).
- Create: `web/src/pages/Settings/CustomFields.jsx`, `Pipelines.jsx`, `Lookups.jsx`.
- Create: `web/src/components/DynamicField.jsx` — renders a custom field from its def.
- Modify: `web/src/App.jsx` (routes), `web/src/components/Sidebar.jsx` (menu).
- Co-located `.test.jsx` per page/component.

---

## PHASE 0 — SQL BATCH (one file, manual apply)

> All of Phase 0 lands in `backend/sql/032_sales_config_engine.sql`. It is NOT unit-tested (manual apply per policy); each task's "test" is a verification query the user runs after applying. Build the file incrementally, committing after each task. The user applies the finished file once, by hand.

### Task 0.1: Config-engine tables

**Files:**
- Create/append: `backend/sql/032_sales_config_engine.sql`

**Interfaces:**
- Produces tables: `tblCustomFieldDef`, `tblCustomFieldValue`, `tblPipeline`, `tblPipelineStage`, `tblLookup` — columns exactly as in spec §3.1.

- [ ] **Step 1: Write DDL** for the five config tables with the columns from spec §3.1. Guard each with `IF OBJECT_ID(N'dbo.tblX') IS NULL`. Add unique indexes: `tblCustomFieldDef(CompId,Entity,FieldKey)`, `tblCustomFieldValue(EntityId,FieldId)`, and non-unique `tblCustomFieldValue(CompId,Entity,FieldId)` for filter joins. `Entity` and `Kind` are `VARCHAR(20)`/`VARCHAR(30)`. `Options` is `NVARCHAR(MAX)` (JSON).

- [ ] **Step 2: Verification query** (append as a comment block the user runs):
```sql
-- After apply: expect 5 rows
SELECT name FROM sys.tables WHERE name IN
 ('tblCustomFieldDef','tblCustomFieldValue','tblPipeline','tblPipelineStage','tblLookup');
```

- [ ] **Step 3: Commit**
```bash
git add backend/sql/032_sales_config_engine.sql
git commit -m "sql(032): config-engine tables"
```

### Task 0.2: Sales core + ticket tables (all schema at once)

**Files:**
- Append: `backend/sql/032_sales_config_engine.sql`

**Interfaces:**
- Produces: `tblLeads` (new core, spec §3.2), `tblCall` (with `TicketId` nullable added for Spec 2), `tblLeadActivity`, `tblFollowUp +SourceCallId`; and Spec 2 tables `tblTicket`, `tblTicketActivity`, `tblSLARule` (spec 2 §4).

- [ ] **Step 1: Write DDL** for `tblLeads` as a NEW table `tblLeads_new` (columns per spec §3.2) — do not drop the old `tblLeads` yet (migration Task 0.4 backfills then renames). Create `tblCall` (spec §3.2 + nullable `TicketId INT`), `tblLeadActivity` (spec §3.2), `tblTicket`/`tblTicketActivity`/`tblSLARule` (spec 2 §4). Add `SourceCallId INT NULL` to `tblFollowUp` via `IF COL_LENGTH('tblFollowUp','SourceCallId') IS NULL ALTER TABLE ...`.

- [ ] **Step 2: Verification query**:
```sql
SELECT name FROM sys.tables WHERE name IN
 ('tblLeads_new','tblCall','tblLeadActivity','tblTicket','tblTicketActivity','tblSLARule');
SELECT COL_LENGTH('tblFollowUp','SourceCallId'); -- non-null
```

- [ ] **Step 3: Commit** `git commit -am "sql(032): sales core + ticket tables"`

### Task 0.3: Activity logger + config SPs

**Files:**
- Append: `backend/sql/032_sales_config_engine.sql`

**Interfaces:**
- Produces SPs: `sp_LogLeadActivity(@CompId,@LeadId,@UserId,@Type,@Summary,@MetaJSON)`; `sp_SaveCustomField`, `sp_FetchCustomFields(@CompId,@Entity)`, `sp_DeleteCustomField`; `sp_SavePipeline`, `sp_FetchPipelines(@CompId,@Entity)`; `sp_SaveStage`, `sp_DeleteStage`; `sp_SaveLookup`, `sp_FetchLookups(@CompId,@Kind)`, `sp_DeleteLookup`. All follow `@Id=0` insert / `@Id>0` update, return `ResponseCode/ResponseMess`.

- [ ] **Step 1: Write** `sp_LogLeadActivity` (INSERT into `tblLeadActivity`, return new id) and the config CRUD SPs. Fetch SPs return rows ordered by `SortOrder`. `sp_SaveCustomField` upserts a def; `sp_DeleteCustomField` soft-deletes (`IsActive=0`) if values exist, else hard-delete.

- [ ] **Step 2: Verification** (sample calls in a comment):
```sql
EXEC sp_SaveLookup @Id=0,@CompId=1,@Kind='lead_source',@Value='Website',@SortOrder=1;
EXEC sp_FetchLookups @CompId=1,@Kind='lead_source'; -- expect the row + ResponseCode 200
```

- [ ] **Step 3: Commit** `git commit -am "sql(032): activity logger + config SPs"`

### Task 0.4: Leads migration/seed/backfill

**Files:**
- Append: `backend/sql/032_sales_config_engine.sql`

**Interfaces:**
- Produces: populated `tblLeads_new`, seeded product custom fields + backfilled values, seeded default pipeline from `tblStatus`, `tblLeadSource`→`tblLookup`. Ends by renaming `tblLeads`→`tblLeads_old`, `tblLeads_new`→`tblLeads`.

- [ ] **Step 1: Write migration** inside a `BEGIN TRAN ... COMMIT` with `TRY/CATCH ROLLBACK`:
  1. For each distinct `CompId` in `tblLeads`: insert default `tblPipeline`(`IsDefault=1`,`Entity='lead'`) and stages from that company's `tblStatus` rows (SortOrder by existing order; first→StageType `open`, and any status matching /won|convert/i → `won`, /lost|dead/i → `lost`, else `open`).
  2. Insert `tblLookup`(Kind=lead_source) from `tblLeadSource`; keep an id map (temp table) old→new.
  3. Seed `tblCustomFieldDef`(Entity='lead') for Category/Brand/Model/Budget per company (Types: dropdown/text/text/number). Seed `InvoiceNo`/`InvoiceDate` as text/date defs.
  4. Insert into `tblLeads_new` from `tblLeads` mapping columns: `CustomerName→Name`, `MobileNo→MobileNo`, `AlternateMobile→AltMobile`, `Email`, `LeadSource→SourceId` (via map), `LeadStatus→StageId` (match stage name), `AssignTo→OwnerId`, `Budget→EstValue`, `FollowupDate→NextFollowupDate`, plus `CompId/BranchId/CreatedBy/EditBy`.
  5. Backfill `tblCustomFieldValue` from old product columns (Category/Brand/Model→ValueText, Budget→ValueNumber, InvoiceNo→ValueText, InvoiceDate→ValueDate) keyed to each new lead id.
  6. Rename tables (`sp_rename 'tblLeads','tblLeads_old'`; `sp_rename 'tblLeads_new','tblLeads'`).

- [ ] **Step 2: Verification** (comment):
```sql
SELECT (SELECT COUNT(*) FROM tblLeads_old) AS old, (SELECT COUNT(*) FROM tblLeads) AS new; -- equal
SELECT TOP 5 l.Id,l.Name,l.StageId,l.SourceId FROM tblLeads l;
SELECT COUNT(*) FROM tblCustomFieldValue WHERE Entity='lead'; -- > 0
```

- [ ] **Step 3: Commit** `git commit -am "sql(032): leads migration + seed + backfill"`

### Task 0.5: Lead/call/followup/report SPs

**Files:**
- Append: `backend/sql/032_sales_config_engine.sql`

**Interfaces (exact — backend Phase 1 depends on these):**
- `sp_SaveLead(@Id,@CompId,@BranchId,@Name,@MobileNo,@AltMobile,@Email,@SourceId,@PipelineId,@StageId,@OwnerId,@EstValue,@NextFollowupDate,@CustomJSON,@UserId)` — upsert core, upsert `tblCustomFieldValue` from `@CustomJSON` (array of `{fieldId,type,value}`), log `created`/`field_changed`. Returns lead `Id`.
- `sp_FetchLeads(@CompId,@BranchId,@PageNumber,@PageSize,@SearchTerm,@StageId,@OwnerId,@SourceId)` — paged; returns leads + pagination columns.
- `sp_FetchLeadDetail(@CompId,@LeadId)` — returns 3 result sets: core row, custom values (with def label/type), activity timeline.
- `sp_MoveLeadStage(@CompId,@LeadId,@StageId,@LostReasonId,@UserId)` — enforces: `won` stage → stamp `WonAt`; `lost` stage → require `@LostReasonId`, stamp `LostAt`; logs `stage_changed`/`won`/`lost`. Returns ResponseCode (400 if lost without reason).
- `sp_TransferLead(@CompId,@LeadId,@OwnerId,@UserId)` — reassign + `assigned` activity.
- `sp_DeleteLead(@CompId,@LeadId)`.
- `sp_LogCall(@CompId,@LeadId,@TicketId,@UserId,@Direction,@OutcomeId,@Notes,@Duration,@NextFollowupDate,@FollowupRemarks)` — insert call; if `@NextFollowupDate` not null insert `tblFollowUp`(SourceCallId=new call id); log `call` activity; all in one tran. Returns call `Id`.
- `sp_FetchCalls(@CompId,@LeadId,@UserId)`.
- `sp_FetchLeadActivity(@CompId,@LeadId)`.
- Reports: `sp_PipelineFunnel(@CompId,@BranchId,@PipelineId)`, `sp_CallsPerUser(@CompId,@BranchId,@FromDate,@ToDate)`, `sp_ConversionBySource(@CompId,@BranchId)`.

- [ ] **Step 1: Write** all SPs above. `sp_SaveLead` and `sp_LogCall` wrap their multi-table writes in `BEGIN TRAN`/`TRY-CATCH`. Custom-value upsert: for each element in `@CustomJSON`, MERGE into `tblCustomFieldValue` writing the correct typed column by `type`.

- [ ] **Step 2: Verification** (comment): sample `EXEC sp_SaveLead ...` then `EXEC sp_FetchLeadDetail` returns 3 result sets; `EXEC sp_MoveLeadStage` into a lost stage without reason returns ResponseCode 400.

- [ ] **Step 3: Commit** `git commit -am "sql(032): lead/call/followup/report SPs"`

### Task 0.6: Hand SQL to user for apply

- [ ] **Step 1:** Post the final file path and the concatenated verification queries; ask the user to apply `backend/sql/032_sales_config_engine.sql` by hand and run the verification block. **Do not proceed to Phase 1 until the user confirms it applied cleanly** (SPs depend on the live schema for any manual smoke test, though backend unit tests mock the DB).

---

## PHASE 1 — BACKEND

> Controllers mock the DB in tests (`jest.mock("../../../src/config/database")`), so Phase 1 tests do not require the SQL to be applied. Each controller task: write test → fail → implement → pass → commit. Reuse `tests/helpers/mockRes.js`.

### Task 1.1: Config controller — custom fields

**Files:**
- Create: `backend/src/controllers/configController.js`
- Create: `backend/src/routes/configRoutes.js`
- Modify: `backend/src/config/routes.js` (register `/api/config`)
- Test: `backend/tests/unit/controllers/configController.test.js`

**Interfaces:**
- Consumes: `database.executeStoredProcedure` (mocked); `responseHelper`.
- Produces: `configController.saveCustomField/fetchCustomFields/deleteCustomField/savePipeline/fetchPipelines/saveStage/deleteStage/saveLookup/fetchLookups/deleteLookup(req,res)`.

- [ ] **Step 1: Write failing test** for `fetchCustomFields`:
```js
const database = require("../../../src/config/database");
jest.mock("../../../src/config/database");
const { configController } = require("../../../src/controllers/configController");
const mockRes = require("../../helpers/mockRes");

test("fetchCustomFields calls sp_FetchCustomFields with CompId+Entity and returns rows", async () => {
  database.executeStoredProcedure.mockResolvedValue({ recordset: [{ Id: 1, Label: "Budget" }] });
  const req = { user: { CompId: 5 }, body: { Entity: "lead" } };
  const res = mockRes();
  await configController.fetchCustomFields(req, res);
  expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCustomFields",
    expect.objectContaining({ CompId: 5, Entity: "lead" }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});
```
- [ ] **Step 2: Run** `cd backend && pnpm test -- configController` → FAIL (module missing).
- [ ] **Step 3: Implement** all 10 handlers: read params from `req.body`, inject `CompId`(+`CreatedBy`=`req.user.UserId`), call the matching SP, return via `responseHelper.success`/`error`. Wire `configRoutes.js` (POST per handler) and register in `config/routes.js` at `/api/config`.
- [ ] **Step 4: Add tests** for save + delete + pipelines + lookups (happy + one failure where SP returns ResponseCode≠200). Reach ≥80%.
- [ ] **Step 5: Run** `pnpm test -- configController --coverage` → PASS, ≥80%.
- [ ] **Step 6: Commit** `git commit -am "feat(backend): config controller (fields/pipelines/lookups)"`

### Task 1.2: Lead controller rewrite

**Files:**
- Modify: `backend/src/controllers/leadController.js`
- Test: `backend/tests/unit/controllers/leadController.test.js`

**Interfaces:**
- Produces: `leadController.save/fetch/detail/moveStage/transfer/delete(req,res)` mapping to the Task 0.5 SPs.

- [ ] **Step 1: Write failing tests** — `save` passes `@CustomJSON` through and injects CompId/BranchId/UserId; `detail` returns the 3 recordsets shaped as `{ lead, fields, activity }`; `moveStage` surfaces a 400 when SP returns ResponseCode 400 (lost without reason).
```js
test("moveStage returns 400 when SP rejects lost-without-reason", async () => {
  database.executeStoredProcedure.mockResolvedValue({ recordset: [{ ResponseCode: 400, ResponseMess: "Lost reason required" }] });
  const res = mockRes();
  await leadController.moveStage({ user:{CompId:1,UserId:2}, body:{ LeadId:9, StageId:5 } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the 6 handlers. `detail` maps `result.recordsets[0..2]` → `{ lead: [0][0], fields: [1], activity: [2] }`. Respect SP `ResponseCode` for status.
- [ ] **Step 4: Run** `pnpm test -- leadController --coverage` → PASS ≥80%.
- [ ] **Step 5: Commit** `git commit -am "feat(backend): lead controller for config-driven schema"`

### Task 1.3: Call controller + follow-up extension

**Files:**
- Create: `backend/src/controllers/callController.js`; `backend/src/routes/callRoutes.js`; register in `config/routes.js`.
- Modify: `backend/src/controllers/followupController.js` (accept `SourceCallId`).
- Test: `backend/tests/unit/controllers/callController.test.js`; extend `followupController.test.js`.

**Interfaces:**
- Produces: `callController.logCall/fetchCalls(req,res)` → `sp_LogCall`/`sp_FetchCalls`.

- [ ] **Step 1: Write failing test** — `logCall` forwards `NextFollowupDate` and injects CompId/UserId; passes `TicketId:null` for lead calls.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `callController` + routes (`/api/calls/logCall`, `/fetchCalls`); extend `followupController.save` to pass `SourceCallId`.
- [ ] **Step 4: Run** `pnpm test -- callController followupController --coverage` → PASS ≥80%.
- [ ] **Step 5: Commit** `git commit -am "feat(backend): call logging + follow-up call link"`

### Task 1.4: Report controller additions

**Files:**
- Modify: `backend/src/controllers/reportController.js`; add routes in `reportRoutes.js`.
- Test: extend `backend/tests/unit/controllers/reportController.test.js`.

- [ ] **Step 1: Write failing tests** for `pipelineFunnel`, `callsPerUser`, `conversionBySource` (each calls its SP with CompId/BranchId + date filters).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** 3 handlers + routes. **Step 4:** `pnpm test -- reportController --coverage` → PASS ≥80%. **Step 5:** `git commit -am "feat(backend): sales reports (funnel/calls/conversion)"`

### Task 1.5: Backend green gate

- [ ] **Step 1: Run** `cd backend && pnpm test -- --coverage` → all pass, changed files ≥80%. **Step 2:** if red, fix before Phase 2.

---

## PHASE 2 — WEB (parallelizable)

> Each task below is an independent page/module and can be handed to a separate agent. Shared prerequisite: **Task 2.0** (queries + DynamicField + routes/menu) must land first; then 2.1–2.5 run in parallel. All use `useApiQuery`/`useApiMutation`, `ui/` components, MUI v9 `slotProps`, MSW handlers per endpoint.

### Task 2.0: Shared web scaffolding (prerequisite)

**Files:**
- Create: `web/src/api/salesQueries.js` (endpoint constants + fetchers for config/leads/calls/reports).
- Create: `web/src/components/DynamicField.jsx` (+ test) — renders one custom field from `{Id,Label,Type,Options,IsRequired}` using `ui/` inputs (`TextInput`/`NumberInput`/`DateField`/`Combobox`/`Switch`), controlled via `value`/`onChange`.
- Modify: `web/src/App.jsx` (add `/sales/*`, `/settings/*` routes, lazy-loaded), `web/src/components/Sidebar.jsx` (Sales + Settings menu items).
- Test: `web/src/components/DynamicField.test.jsx`.

- [ ] **Step 1: Write failing test** — `DynamicField` renders a dropdown from `Options` and calls `onChange` with the picked value; renders required marker.
- [ ] **Step 2: Run** `cd web && pnpm test -- DynamicField` → FAIL.
- [ ] **Step 3: Implement** `DynamicField` (switch on `Type`), `salesQueries.js`, and add routes/menu.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(web): sales scaffolding (queries, DynamicField, routes)"`

### Task 2.1: Pipeline board (parallel)

**Files:** Create `web/src/pages/Sales/Pipeline.jsx` (+ card/column components) + `.test.jsx`.
**Interfaces:** Consumes `salesQueries` (`fetchPipelines`, `fetchLeads`, `moveLeadStage`), `DynamicField` not needed here.

- [ ] **Step 1: Write failing test** — renders stage columns from a mocked pipeline; renders lead cards; dragging (simulate `moveLeadStage` call) invokes the mutation with `{LeadId,StageId}`. Use MSW handlers for `/api/config/fetchPipelines`, `/api/leads/fetchLeads`, `/api/leads/moveLeadStage`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** using the `@dnd-kit/react` + optimistic `queryClient.setQueryData` pattern from `pages/Task/TaskBoard.jsx`. Cards show Name, EstValue, next-follow-up chip, owner. **Step 4:** PASS ≥80%. **Step 5:** `git commit -am "feat(web): sales pipeline board"`

### Task 2.2: Leads table (parallel)

**Files:** Create `web/src/pages/Sales/Leads.jsx` + `.test.jsx`.

- [ ] **Step 1: Failing test** — wires `useServerTable` to `/api/leads/fetchLeads`; filter controls for stage/owner/source. **Step 2:** FAIL. **Step 3:** Implement (copy the Master table pattern; columns from core fields; row click → lead detail route). **Step 4:** PASS ≥80%. **Step 5:** `git commit -am "feat(web): leads table"`

### Task 2.3: Lead detail + Log Call (parallel)

**Files:** Create `web/src/pages/Sales/LeadDetail.jsx` + `Timeline.jsx` + `LogCallModal.jsx` + tests.
**Interfaces:** Consumes `fetchLeadDetail` (`{lead,fields,activity}`), `logCall`, `saveLead`, `DynamicField`.

- [ ] **Step 1: Failing tests** — renders core header + custom fields (via `DynamicField`) from `fetchLeadDetail`; Timeline lists activity; Log Call submits `logCall` with outcome + optional next follow-up. MSW handlers for detail/logCall.
- [ ] **Step 2:** FAIL. **Step 3:** Implement — header, Timeline tab, custom-fields section (map `fields` → `DynamicField`, save via `saveLead` with `CustomJSON`), `LogCallModal` (outcome `Combobox` from `call_outcome` lookup, notes, next-follow-up `DateField`). **Step 4:** PASS ≥80%. **Step 5:** `git commit -am "feat(web): lead detail + call logging"`

### Task 2.4: Settings — custom fields / pipelines / lookups (parallel)

**Files:** Create `web/src/pages/Settings/CustomFields.jsx`, `Pipelines.jsx`, `Lookups.jsx` + tests.

- [ ] **Step 1: Failing tests** — CustomFields lists defs for `Entity='lead'` and creates one (calls `saveCustomField`); Pipelines edits stages; Lookups CRUD by `Kind`. MSW handlers for `/api/config/*`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement three admin pages (reuse `MasterChipGrid`/table + form patterns). Pipelines page manages stages with `StageType` + reorder. **Step 4:** PASS ≥80%. **Step 5:** `git commit -am "feat(web): sales settings (fields/pipelines/lookups)"`

### Task 2.5: Sales reports (parallel)

**Files:** Create `web/src/pages/Reports/PipelineFunnel.jsx`, `CallsPerUser.jsx`, `ConversionBySource.jsx` + tests.

- [ ] **Step 1: Failing tests** — each wires `useApiQuery` to its report endpoint and renders a chart/table. **Step 2:** FAIL. **Step 3:** Implement using existing Reports + recharts patterns (numeric chart heights per the dogfood fix). **Step 4:** PASS ≥80%. **Step 5:** `git commit -am "feat(web): sales reports"`

### Task 2.6: Web green gate

- [ ] **Step 1: Run** `cd web && pnpm test -- --run --coverage` → all pass, changed files ≥80%. **Step 2:** fix any red before calling Spec 1 done.

---

## Self-review notes (coverage of spec §)

- §3.1 config tables → 0.1; §3.2 sales tables → 0.2; activity logger → 0.3; migration/seed/backfill (§7) → 0.4; lead/call/report SPs (§6) → 0.5.
- Backend §6 endpoints → 1.1–1.4. Web §8 surface → 2.0–2.5. Reports §8 → 1.4 + 2.5. Testing §9 → per-task test steps + gates 1.5/2.6.
- Spec 2 tables created in 0.2 (all-SQL-at-once) — Spec 2's app layers are a separate plan.
