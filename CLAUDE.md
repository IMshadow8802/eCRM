# CLAUDE.md

Guidance for Claude Code working in this repository. This is the single source
of truth for the whole monorepo — there are no per-folder `CLAUDE.md` files.

---

## 0. Hard rules — non-negotiable

These override any default behaviour. Follow them exactly.

### 0.1 Git — read-only unless ordered
**Never perform any git action other than read, without an explicit order from
the user in that message.**
- **Allowed, always:** `git status`, `git log`, `git diff`, `git show`, `git blame` (read-only inspection).
- **Forbidden without an explicit user instruction:** `git add`, `git commit`, `git push`, `git pull`, `git branch`, `git checkout`/`switch`, `git merge`, `git rebase`, `git reset`, `git restore`, `git rm`, `git stash`, `git tag`, `git cherry-pick`, `gh pr`, and every other mutating git/GitHub action.
- Make all code changes in the working tree and **leave them uncommitted** for the user to review. When work is ready, say so and wait — do **not** stage or commit on your own initiative.
- "Explicit order" means the user tells you to commit/push/branch in this conversation. Prior approval does not carry over to later actions.

### 0.2 SQL — write files, never apply
- Database schema/procedures are **applied by hand by the user**. Never run DDL/DML: no `sqlcmd`, no `dbq`, no MCP write tools (`write_query`, `create_table`, `alter_table`, `drop_table`) for schema/data changes. MCP **read** queries (`read_query`, `describe_table`, `list_tables`, `sys.sql_modules`) are fine for inspection.
- Put every script in `backend/sql/` named `NNN_short_name.sql` (incrementing prefix). Include a header comment and a "verify after apply" snippet.
- A script stays in `backend/sql/` until the **user confirms it is applied**, then it is deleted (the folder holds only not-yet-applied scripts). Merge closely-related fixes into one script where it eases a single manual apply.

### 0.3 Package manager — pnpm only
Always `pnpm`, never `npm`. npm corrupts the lockfile. Applies to `web/`, `backend/`, `mobile/`.

### 0.4 Test-first — every code change ships with tests
- No change in `backend/src/` or `web/src/` ships without tests proving the changed behaviour (features, bug fixes, refactors).
- New behaviour → happy path + ≥1 failure/edge. Bug fix → a regression test that would have failed before the fix (flag it when reporting).
- Files you modify must reach **≥80% line/branch coverage**. Global floor 60%.
- Never silence tests (`.only`, `.skip`, `xit`, exclude patterns). Fix the code or the test.
- Before claiming done: run the suite with coverage and confirm green + ≥80% on touched files.

### 0.5 Log shipped work to Notion
After each shipped fix/feature/decision, append a dated entry to the project's
Notion page ("🎯 Nexus CRM") — under **✅ Done**, **🐛 Bug Fix Log**, and/or
**📅 Change Log** as appropriate. Use absolute dates (`2026-07-03`, never
"today"). Fetch the page first, then `notion-update-page` with `content_updates`.

### 0.6 Other standing rules
- **MUI v9**: this repo is on `@mui/material@9` — use `slotProps` (not `InputProps`/`inputProps`/`renderTags`). Reuse the shared `ui/` components (`Combobox`, `TextInput`, `DateField`, `Modal`, `PageHeader`, …) and `FormSelect`/`FormInput` (which wrap them) instead of raw MUI selects.
- **Multi-tenancy**: every DB query and SP is filtered by `CompId` (+ `BranchId` where relevant). Never leak across companies.
- **Build phasing for big features**: all SQL first (one batch, user-applied), then backend controllers/routes, then web (fan out to parallel agents by page). Verify page↔SP contracts against the live DB, not just mocked tests.
- **Audit-style feedback**: when the user asks "is X production-ready / right / dumb", lead with UX/architecture critique, not a feature checklist.

---

## 1. Repository overview

**Multi-platform CRM.** Monorepo with three apps sharing one backend API + auth:

- **`web/`** — React 19 + Vite SPA, deployed under `/eStockCRM/`.
- **`backend/`** — Node.js + Express 5 REST API over SQL Server (all CRUD via stored procedures).
- **`mobile/`** — React Native + Expo app (feature parity in progress).

```
Mobile ─┐
        ├──> Backend API (Express) ──> SQL Server (stored procedures)
Web ────┘
```

Shared conventions: JWT auth + role/permission model, Zustand state, Axios with
interceptors, standardized JSON responses, `CompId`/`BranchId` multi-tenancy.

---

## 2. Commands

### web/ (port 8080)
```bash
pnpm dev                      # dev server (Vite, HMR)
pnpm build                    # production build → dist-web/
pnpm exec vitest run          # run tests once (exits) — preferred in CI/agents
pnpm test                     # vitest watch
pnpm exec vitest run <file>   # run a single test file
```
Tests: Vitest + React Testing Library + MSW. After changing a shared component,
run the full suite (`pnpm exec vitest run`) — many pages import it.

### backend/
```bash
pnpm dev                      # nodemon dev server (port 5001)
pnpm prod                     # production
pnpm pm2:start | pm2:logs     # PM2 cluster
pnpm exec jest --silent       # run tests
pnpm exec jest <name>         # single suite
pnpm exec jest <name> --coverage --collectCoverageFrom='src/controllers/<f>.js'
```
Tests: Jest + Supertest. DB is mocked via `jest.mock("../../../src/config/database")`;
`tests/helpers/mockRes.js` provides a `res` double. **Note:** mocked DB tests
cannot catch a missing/renamed stored procedure — verify SP contracts against
the live DB (`mcp__sqlserver-ecrm__read_query` on `sys.sql_modules`).

### mobile/
```bash
pnpm start                    # Expo dev server
pnpm android | pnpm ios       # run on device/simulator
```

---

## 3. Architecture

### Data flow & stack
- **Request path (backend):** route → controller → `database.executeStoredProcedure(name, params)` → SQL Server → `responseHelper` → client.
- **State:** Zustand + persistence (web: `localStorage`, mobile: `AsyncStorage`). Key stores: `useAuthStore` (auth, user, permissions, menuRights, API base URL), `useWorkspaceStore`, `useTaskStore`, `useKanbanStore`.
- **API:** Axios instance with interceptors — injects the JWT, handles 401 (redirect via `utils/redirectToLogin.js`; auth-endpoint 401s skipped via `utils/authRedirectGuard.js`).
- **API base URL:** prod `https://prdinfotech.in/CRM`; dev proxies `/api/*` → `http://localhost:5001`.

### Standard API response
```json
{
  "success": true,
  "message": "...",
  "responseCode": 200,
  "data": { "resourceName": [ ... ], "pagination": { ... } },
  "timestamp": "..."
}
```
On the web, extract `data?.resourceName` (key matches the endpoint).

### Auth & permissions
1. `POST /api/auth/loginUser` → `sp_ValidateUser` returns JWT + user + **menu rights** (from `tblMenu` ⋈ `tblGroupAccess` ⋈ `tblUserGroupMap`). Menu rights load at **login** — re-login to pick up menu/permission changes.
2. Token stored in `useAuthStore` (persisted); interceptors attach it.
3. **Menus are DB-driven**: `tblMenu.Route` gives each row its SPA path (legacy rows fall back to a title-slug). `menuBuilder.buildDynamicMenu(menuRights)` builds the sidebar tree; there are no hardcoded menus. Sidebar visibility = the group's `CanView` grant in `tblGroupAccess`.
4. **Task/workspace permissions** are a separate model from menu rights — see §6.

### Database conventions (SQL Server)
- All CRUD via stored procedures. Naming: `sp_[Action][Entity]` (`sp_SaveLead`, `sp_FetchTickets`, `sp_DeleteTask`).
- CRUD pattern: `@Id = 0` → insert, `@Id > 0` → update.
- Every SP filters by `@CompId` (+ `@BranchId`); paged fetches use `@PageNumber`/`@PageSize`/`@SearchTerm` and return a second result set with pagination.
- Mutating SPs return one status row: `Id`, `ResponseCode`, `ResponseMess`. They wrap writes in `BEGIN TRAN`/`TRY-CATCH` and log activity via a single logger SP (`sp_LogLeadActivity` / `sp_LogTicketActivity`) captured with `INSERT INTO @tbl EXEC ...`.
- Schema is managed externally — no migration files in-repo beyond the pending `backend/sql/` scripts.

---

## 4. Web (`web/`)

```
src/
  api/            # endpoint fetchers (salesQueries, supportQueries, masterQueries/)
  components/
    ui/           # design-system primitives (Combobox, TextInput, DateField,
                  #   Modal, PageHeader, Chip, Button, Tabs, EmptyState, ...)
    Design/       # legacy FormComponents (FormSelect/FormInput wrap ui/)
    Charts/       # recharts + ECharts wrappers
    HelpGuide.jsx # bilingual (EN default / हिंदी) "?" how-to popover
    Sidebar.jsx   # DB-driven nav via buildDynamicMenu
  pages/          # route components by feature
    Task/  Sales/  Support/  Settings/  Reports/  Master/  auth/
  stores/         # Zustand (useAuthStore, useWorkspaceStore, useTaskStore, ...)
  hooks/          # useApiQuery, useApiMutation, useServerTable, useUsers, ...
  utils/          # menuBuilder, userShape, axiosConfig, redirectToLogin, ...
  data/           # static data (helpGuides.js, ...)
  App.jsx         # routes (BrowserRouter, basename="/eStockCRM/")
```
- Routing: `BrowserRouter` basename `/eStockCRM/`. Section parents (`/sales`, `/support`, `/settings`, `/reports`) redirect to their first child so bare paths don't 404.
- Data fetching: `useApiQuery`/`useApiMutation` (TanStack Query); server tables via `useServerTable` + `material-react-table`.
- Charts: `recharts` (use numeric `height`, never `height="100%"`).
- Forms: React Hook Form + Zod; render via `ui/` components / `FormSelect`/`FormInput`.

## 5. Backend (`backend/`)

```
src/
  config/         # database.js (mssql pool), middleware.js, routes.js, errorHandlers.js
  routes/         # <feature>Routes.js — verifyToken + loadScope, POST-per-action
  controllers/    # <feature>Controller.js — inject CompId/BranchId/UserId from req.user
  middleware/     # auth.js (JWT), permission.js (loadScope), payloadValidation.js
  utils/          # responseHelper.js, encryption.js
tests/unit/       # jest suites mirroring controllers/middleware/utils
sql/              # NNN_*.sql — pending, user-applied scripts only (see §0.2)
```
- Add an endpoint: controller method → `database.executeStoredProcedure()` → `responseHelper` → route in `routes/<feature>Routes.js` → register in `config/routes.js`.
- All routes are `POST`; `verifyToken` + `loadScope` populate `req.user` (`UserId`, `CompId`, `BranchId`, `IsAdmin`) and `req.scope` (branch visibility).

## 6. Key domains

### Tasks & workspaces
- Workspaces are `personal | shared | project` (`tblWorkspaces`). Personal = owner-only, **private even from admins**. Shared = invite members (accept required). Project = members snapshotted from the linked project's team.
- Roles (`tblWorkspaceMembers`): `owner | manager | member | viewer`. Task authority is derived from workspace role + creator/assignee, enforced by `sp_CheckTaskPermission`: owner/manager do anything; member creates and fully edits only their own tasks; viewer views/comments. Assigning others' tasks needs owner/manager or being the creator. `IsAdmin` bypasses on shared/project only (never personal).
- Completion is **derived from the checklist** (`tblTaskChecklist`) — `IsDone` column retired; never reintroduce. Dependencies are hard blocks.

### Sales (config engine)
- Per-company **config engine**: typed-EAV custom fields (`tblCustomFieldDef`/`tblCustomFieldValue`), configurable pipelines/stages (`tblPipeline`/`tblPipelineStage`), generic lookups (`tblLookup`) — all keyed by an `Entity` discriminator (`'lead'` / `'ticket'`).
- Leads (`tblLeads`), manual call logging (`tblCall`), follow-ups (`tblFollowUp`), unified activity timeline (`tblLeadActivity`). Pipeline board, leads table, lead detail, Settings, reports.

### Support (ticketing)
- Reuses the config engine via `Entity='ticket'`. `tblTicket` + `tblTicketActivity` + SLA (`tblSLARule`, breach computed on read). `tblCall.TicketId` links calls to tickets. Ticket board, table, detail (resolve/close/reopen), Settings, reports.

---

## 7. Testing & debugging endpoints (backend)
- `GET /health` — uptime/memory. `GET /test-db` — DB connectivity. `GET /api` — HTML route docs.

## 8. Deployment
- **Backend**: PM2 cluster on `127.0.0.1` (IIS reverse proxy); logs in `logs/`.
- **Web**: Vite build deployed under `/eStockCRM/`.
- **Mobile**: EAS Build; OTA via Expo Updates.
