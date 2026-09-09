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
- **`mobile/` is exempt** (decided 2026-08-02) — no test suite there. Its gate is `pnpm typecheck` + `pnpm lint`, both of which must be clean. See §9.6.
- New behaviour → happy path + ≥1 failure/edge. Bug fix → a regression test that would have failed before the fix (flag it when reporting).
- Files you modify must reach **≥80% line/branch coverage**. Global floor 60%.
- Never silence tests (`.only`, `.skip`, `xit`, exclude patterns). Fix the code or the test.
- Before claiming done: run the suite with coverage and confirm green + ≥80% on touched files.

### 0.5 Log shipped work to Notion
After each shipped fix/feature/decision, append a dated entry to the project's
Notion page ("🎯 Nexus CRM") — under **✅ Done**, **🐛 Bug Fix Log**, and/or
**📅 Change Log** as appropriate. Use absolute dates (`2026-07-03`, never
"today"). Fetch the page first, then `notion-update-page` with `content_updates`.

### 0.6 Server / deploy — read-only, commands only
**Never connect to the production server or run a deploy yourself.** Only the
user runs `ssh myserver`, `rsync`, `docker …`, or anything that touches the box.
- Claude's job: **write the exact commands** and hand them over. Claude never executes `ssh`/`rsync`/remote `docker` — not via Bash, not any other way.
- Deploy transport is **always `rsync`, never `scp`** (idempotent; `-c` checksum skips unchanged; add `-n` for a dry-run preview).
- Everything the server needs is rsync'd, **including the env file**: the prod client env is `backend/.env.prd` (the local prod env, copied up). It is git-ignored and `.dockerignore`d (never baked into the image); Compose loads it at runtime via `env_file`.
- Full deploy recipe in §8.

### 0.7 Other standing rules
- **MUI v9**: this repo is on `@mui/material@9` — use `slotProps` (not `InputProps`/`inputProps`/`renderTags`). Reuse the shared `ui/` components (`Combobox`, `TextInput`, `DateField`, `Modal`, `PageHeader`, …) and `FormSelect`/`FormInput` (which wrap them) instead of raw MUI selects.
- **Multi-tenancy**: every DB query and SP is filtered by `CompId` (+ `BranchId` where relevant). Never leak across companies.
- **Build phasing for big features**: all SQL first (one batch, user-applied), then backend controllers/routes, then web (fan out to parallel agents by page). Verify page↔SP contracts against the live DB, not just mocked tests.
- **Audit-style feedback**: when the user asks "is X production-ready / right / dumb", lead with UX/architecture critique, not a feature checklist.

---

## 1. Repository overview

**Multi-platform CRM.** Monorepo with three apps sharing one backend API + auth:

- **`web/`** — React 19 + Vite SPA, deployed under `/CRM/`.
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
pnpm start                    # Expo dev server (dev-client)
pnpm typecheck                # tsc --noEmit — must be clean before any commit
pnpm lint                     # eslint — enforces the design-system rules (§9.3, §9.4)
pnpm exec expo prebuild --clean   # regenerate android/ + ios/ from app.config.ts
pnpm ios --device             # run on a connected iPhone
pnpm android                  # run on a connected Android device/emulator
pnpm apk                      # cd android && ./gradlew assembleRelease
```
Mobile is **TypeScript**, has **no test suite** (see §0.4), and does **not use
EAS**. Full detail in §9.

---

## 3. Architecture

### Data flow & stack
- **Request path (backend):** route → controller → `database.executeStoredProcedure(name, params)` → SQL Server → `responseHelper` → client.
- **State:** Zustand + persistence (web: `localStorage`, mobile: `AsyncStorage`). Key stores: `useAuthStore` (auth, user, permissions, menuRights, API base URL), `useWorkspaceStore`, `useTaskStore`, `useKanbanStore`.
- **API:** Axios instance with interceptors — injects the JWT, handles 401 (redirect via `utils/redirectToLogin.js`; auth-endpoint 401s skipped via `utils/authRedirectGuard.js`).
- **API base URL:** prod `https://shadowcodes.in/CRM` (`prdinfotech.in` is dead — do not reintroduce it); web dev proxies `/api/*` → `http://localhost:5001`, mobile overrides via `EXPO_PUBLIC_API_BASE_URL`.

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

### Roles, permissions & data scope
Full reference: **`backend/ROLES.md`**. The essentials — do not violate these:
- **Group = role.** Access is a **matrix of two independent axes**, both keyed to the group: `tblUserGroups.DataScope` decides *which rows*; `tblGroupAccess` (per menu) decides *which screens* + Add/Edit/Delete. Never collapse them into one seniority number — an HR Manager is senior but must see zero Sales/Support rows, which one ladder cannot express.
- **Stock roles**: Owner (All) · Admin (Company) · Sales Head / Support Head / HR Manager (Company) · Regional Manager (MultiBranch) · Branch Manager / Support Manager (Branch) · Sales Team Lead (Team) · Sales Executive / Support Agent (Self). `DataScope` resolves **relative to the user's own branch**, so one role row serves every branch.
- **`DataScope` → `req.scope`** via `loadScope` → `sp_FetchAccessibleBranchIds`, which returns `branchIds` **and** `ownerIds` (`ownerIds` only for `Self`/`Team`; empty = no ownership filter). **Controllers must read `req.scope` — never pass `req.user.BranchId` as a visibility filter.** That bug hid every Sales/Support row from users outside the creator's branch.
- **Universal rule, every fetch:** a record `AssignedTo`/`OwnerId`/`CreatedBy` = the caller is **always visible**, `OR`-ed against scope (never `AND`). Assignment is an explicit act of sharing and outranks scope.
- Optional filters (`@BranchId`, `@OwnerId`, `@AssignedTo`) **narrow within** scope; a filter must never widen visibility.
- **`IsAdmin` is a role property, not a level** — it lives on `tblUserGroups` and only Owner + Admin have it. **Never derive it from `HierarchyLevel <= 2`**: the level-2 heads (Sales/Support/HR) would gain the `sp_CheckTaskPermission` admin bypass, i.e. read/write on every task in every workspace.
- **Tasks are membership-governed, not scope-governed** (see §6) — branch is an optional *filter* there, never a *gate*. `sp_FetchTask` once `AND`-ed branch scope with membership, which blinded cross-branch workspace members. Don't reintroduce it.
- **Known-open** (tracked in `ROLES.md`): the write path (`moveStage`/`transfer`/`delete`/`resolve`/`close`/`reopen`) does not check ownership; menu rights are **not enforced server-side** (sidebar-only) — the department axis is advisory until that lands.

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
  App.jsx         # routes (BrowserRouter, basename="/CRM/")
```
- Routing: `BrowserRouter` basename `/CRM/`. Section parents (`/sales`, `/support`, `/settings`, `/reports`) redirect to their first child so bare paths don't 404.
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
- Leads (`tblLeads`), manual call logging (`tblCall`), follow-ups (`tblFollowUp`), unified activity timeline (`tblLeadActivity`). Leads are a flat `lead_status` lookup (no pipeline since 2026-09-08; the pipeline engine now serves tickets only). Follow-ups are activities on `tblFollowUp`; ownership moves only through `sp_TransferLead` with a reason + remarks; `tblUser.ReportsTo` drives Team scope.

### Support (ticketing)
- Reuses the config engine via `Entity='ticket'`. `tblTicket` + `tblTicketActivity`. `tblCall.TicketId` links calls to tickets. Ticket board, table, detail, Settings, reports.
- **Stage is the single source of truth for the ticket lifecycle** (the lead equivalent, `sp_MoveLeadStage`, was retired 2026-09-08 when leads went flat). Two-step terminal flow: first `won` stage = **Resolved** (awaiting customer confirmation, requires a `ResolutionId`), final `won` stage (highest SortOrder) = **Closed**, `lost` = **Rejected** (`ClosedAt` stamped, no resolution — never solved). Moving back to an `open` stage clears `ResolvedAt`/`ClosedAt`/`ResolutionId` = reopen. All transitions go through `sp_MoveTicketStage`; `sp_ResolveTicket`/`sp_CloseTicket`/`sp_ReopenTicket` are shortcuts into it — **never write those timestamps directly**.
- **SLA was removed entirely** (2026-07-16): no `tblSLARule`, no `SLADueAt`, no breach chips/filters/report. Speed is measured instead via `sp_ResolutionSummary.AvgResolutionMins`. Do not reintroduce SLA plumbing.

---

## 7. Testing & debugging endpoints (backend)
- `GET /health` — uptime/memory. `GET /test-db` — DB connectivity. `GET /api` — HTML route docs.

## 8. Deployment
- **Backend**: **Docker Compose** (single `crm` service, `node:20-alpine`, `backend/Dockerfile` + `backend/docker-compose.yml`) on the aaPanel server (SSH alias **`myserver`**, host `prdinfotech`). App binds `0.0.0.0:$PORT` in-container (`HOST` env); nginx on the box reverse-proxies the public domain → host port `5001`. **Host-port convention: the CRM API always uses the 5000 range** (`5001`, then `5002`, … for further instances) — the `30xx`/`80xx` ranges on the server belong to the eStock docker cluster and PM2 apps; never collide with them.
  - **Deploy is user-run only** (per §0.6 — Claude gives commands, never runs `ssh`/`rsync`/`docker`). Transport is always `rsync` (add `-n` to preview). Remote dir: `REMOTE=/www/wwwroot/shadowcodes.in/CRM` on `myserver` (confirm once, then it's fixed).
  - **Recipe** (from `backend/`):
    ```bash
    REMOTE=/www/wwwroot/shadowcodes.in/CRM
    # 1. code + deploy config + prod env (env travels with the code)
    rsync -avzc src/ myserver:$REMOTE/src/
    rsync -avzc package.json pnpm-lock.yaml pnpm-workspace.yaml Dockerfile docker-compose.yml .dockerignore .env.prd myserver:$REMOTE/
    # 2. build + (re)start just the crm service, then tail
    ssh myserver "cd $REMOTE && docker compose up -d --build crm && docker compose logs crm --tail=50"
    ```
  - `.env.prd` = local prod env, rsync'd up; git-ignored + `.dockerignore`d, loaded at runtime via compose `env_file` (never baked into the image). SQL scripts are **never** shipped/applied by the container — run by hand per §0.2. The `pm2:*` npm scripts + `ecosystem.config.js` are **local-dev only** and `.dockerignore`d out of the image.
  - **Public HTTPS via nginx (aaPanel)** — the container only listens on `127.0.0.1:5001`; nginx maps `https://shadowcodes.in/CRM/` → it. aaPanel auto-includes `proxy/shadowcodes.in/*.conf` (line `include …/proxy/shadowcodes.in/*.conf;` in the site conf), so a proxy = **one file** in that dir. **This is already set up** (`CRM.conf`, path `/CRM/` → `:5001`). To recreate/replicate for a new instance, write the file, test, reload:
    ```bash
    cat > /www/server/panel/vhost/nginx/proxy/shadowcodes.in/CRM.conf << 'EOF'
    #PROXY-START/CRM/
    location ^~ /CRM/
    {
        proxy_pass http://127.0.0.1:5001/;   # trailing slash strips the /CRM prefix → backend sees /health, /api/...
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header REMOTE-HOST $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_http_version 1.1;
        add_header X-Cache $upstream_cache_status;
        set $static_fileCRM 0;
        if ( $uri ~* "\.(gif|png|jpg|css|js|woff|woff2)$" ) { set $static_fileCRM 1; expires 1m; }
        if ( $static_fileCRM = 0 ) { add_header Cache-Control no-cache; }
    }
    #PROXY-END/CRM/
    EOF
    nginx -t && nginx -s reload
    curl -s https://shadowcodes.in/CRM/health   # expect 200 JSON
    ```
    Gotchas: **`nginx -s reload` is mandatory** — editing the conf alone does nothing (a stale reload was the one 404 we hit). `location ^~ /CRM/` (prefix, high-priority) beats the SPA's `location /`. The deploy dir `…/shadowcodes.in/CRM` sits inside the web docroot but the `^~` proxy location overrides static file handling, so it's fine. Public API base for the **web frontend** = `https://shadowcodes.in/CRM` (not the dead `prdinfotech.in/CRM`).
- **Web**: Vite build (`pnpm build` → `dist-web/`), base + router basename `/CRM/`. Deployed on a **separate IIS server** under `/CRM/` — upload the contents of `dist-web/`; the bundled `public/web.config` does the SPA URL-rewrite (`→ /CRM/index.html`) so deep-link refreshes don't 404. API base is dynamic: dev → Vite proxy to `localhost:5001`; prod → `API_BASE_URL` in `useAuthStore` (`https://shadowcodes.in/CRM`, the Linux API box — separate from the IIS web host).
- **Mobile**: **no EAS, no OTA.** Local builds only — `expo prebuild` then Xcode
  / Gradle. See §9.

---

## 9. Mobile (`mobile/`)

React Native + Expo SDK 57, **TypeScript**, rebuilt from scratch on
`feat/mobile-rewrite` (2026-08-02). Spec:
`docs/superpowers/specs/2026-08-02-mobile-task-app-rewrite-design.md`.

Scope order: **Phase A** full task management ✅ → **Phase B** support/complaints
✅ → **Phase C** sales leads (next). Admin CRUD
(Users/Teams/Projects/Settings/Reports) is **permanently web-only**, not
deferred.

**Config engine on mobile** (`src/api/configQueries.ts`): lookups, pipelines +
stages, and custom-field definitions are read-only here — configuring them is
admin desk work and stays on the web. `Entity`/`Kind` discriminate, so Phase C
reuses the same fetchers with `Entity: 'lead'`.

**Ticket lifecycle is derived, never hardcoded** (`features/support/ticketHelpers.ts`).
Stage names are per-company and editable, so `stageRoles()` resolves Resolved /
Closed / Rejected from `StageType` + `SortOrder`: first `won` = Resolved
(requires a `ResolutionId`), last `won` = Closed, `lost` = Rejected. Matching on
the word "Resolved" breaks the moment someone renames a stage. Every transition
goes through `moveTicketStage`; `saveTicket` sends `StageId: null` so the SP's
`ISNULL(@StageId, StageId)` keeps the ticket where it is.

**Known gap — do not build call logging on a ticket.** `sp_LogCall` accepts a
`TicketId` but writes no ticket activity, and `sp_FetchCalls` filters by
`LeadId` only. A call logged against a complaint is invisible everywhere. Fix
the backend first, or the button is write-only.

### 9.1 Build & release — no EAS, no app.json

**Never use EAS. Never create `app.json` or `eas.json`.** Native config lives in
**`app.config.ts`** and nowhere else — TypeScript, so `ExpoConfig` catches a
mistyped key like `bundleIdentifer`, which as JSON would silently do nothing.

**Which config files are TypeScript, and why not all of them:**
`app.config.ts` is TS. `babel.config.js` and `metro.config.js` **must stay
`.js`** — Babel and Metro bootstrap the toolchain that compiles TypeScript, so
their own config is read before any TS transform exists. `eslint.config.js`
stays `.js` too: TS configs there need `jiti` as an extra dependency and buy
nothing, since the config has no meaningful types.

`android/` and `ios/` are **build output, not source** — gitignored and
regenerated. Anything hand-edited inside them is destroyed by the next
prebuild, so every native setting (permissions, plugins, icons, bundle ids,
`Info.plist` strings) must be expressed in `app.config.ts`.

```bash
pnpm exec expo prebuild --clean          # regenerate android/ + ios/
pnpm ios --device                        # Debug build on a connected iPhone
pnpm ios:release                         # Release build, installed + standalone
cd android && ./gradlew assembleRelease  # release APK  (or: pnpm apk)
```

**Debug vs Release on device.** `pnpm ios --device` installs a *Debug* build: it
loads JS from Metro over the network, so it dies the moment the laptop sleeps or
the phone leaves wifi. `pnpm ios:release`
(`expo run:ios --device --configuration Release`) bundles the JS into the app —
it launches from the home screen with no Metro, no laptop, and behaves like the
shipped app. Use it for anything you actually want to *use* rather than debug.

Signing: whatever team Xcode is set to. A paid Apple Developer account gives a
1-year provisioning profile; a free personal team expires after **7 days** and
the app then refuses to launch until reinstalled. There is no EAS and no OTA
here (§9.1), so a reinstall means re-running the command.

Adding a native library: `pnpm exec expo install <pkg>` (never plain `pnpm add`
for anything with native code — it skips the SDK version pin), add its config
plugin + permission strings to `app.config.ts`, then `expo prebuild --clean`.

### 9.2 API layer — one file per domain, no exceptions

**No screen or component may call `apiClient` directly.** Every request goes
through a named fetcher in `mobile/src/api/`. A screen needing a new endpoint
gets a new fetcher, not an inline `post`.

Payloads are copied **verbatim from the controller signature** in
`backend/src/controllers/`, never written from memory. Response types live in
`src/types/api.ts`, written from `INFORMATION_SCHEMA` + the SP `SELECT` lists.
They are a **copy** of the backend contract — if a controller changes shape,
this file must change with it; nothing enforces that automatically.

`src/api/` must stay free of store imports. The auth store pushes the token
down via `setAuthToken`; the client never reaches up. Otherwise the cycle
`store → client → store` breaks Metro.

**The web has the same problem in reverse** — its 42 task/workspace endpoints
are inlined across 10 files. Extracting `web/src/api/taskQueries.js` +
`workspaceQueries.js` to match is agreed follow-on work.

### 9.3 Theming & typography — the tokens are the only source

`src/theme/` holds every colour, size, space, radius and shadow.
**Nothing else may define one.** No component writes `fontSize: 14`,
`#3F4FAF`, or `padding: 12` — it reads a token.

- `tokens.ts` — `palette` (raw) → `colors` (semantic). Components use
  **semantic** names (`colors.danger`), never `palette.red[600]`, so a colour
  can be retuned in one line.
- `typography.ts` — the type scale. Text picks a **variant**
  (`<Text variant="h2">`), never a size + weight. Weight *is* the font family:
  React Native cannot synthesise weights for a custom font, so
  `fontWeight: "600"` on Inter silently renders regular on Android. The family
  is **Inter** (since 2026-08-02) — drawn for UI at small sizes, unlike the
  geometric Poppins it replaced. Its tall x-height is why the size scale sits a
  step below the old one; do not "restore" the larger numbers.
- `spacing` is a 4px grid — `spacing[3]` is 12.

**Solid colours only — no translucency.** No `rgba()` washes, no `opacity` to
dim a control, no frosted panels. A translucent surface changes colour
depending on what is behind it and reads as washed out; a pressed or disabled
state done with `opacity` looks faded rather than pressed. Use a solid token
for every state instead — `surfacePressed`, `primaryDim`, `dangerDim`,
`disabledBg`. Press feedback may also use `transform: scale`, which is not a
colour.

**The one exception is `colors.overlay`**, the modal scrim, because a dialog
backdrop has to show the screen behind it — an opaque one is a different
screen, not a dialog. Nothing else in `tokens.ts` carries alpha, and a new
`rgba()` there needs the same kind of justification.

**Enforced by eslint, not by good intentions** (`eslint.config.js`):
`react-native/no-color-literals` is an error, and importing
`Text`/`TextInput`/`Button`/`Alert` from `react-native` is banned outside
`src/ui/`. `pnpm lint` must pass. Only `src/theme/` and `src/ui/` are exempt.

### 9.4 Icons — lucide only

**`lucide-react-native` is the only icon library.** `@expo/vector-icons` and
`react-native-vector-icons` are removed and banned by eslint.

The web already uses `lucide-react`, so both clients share icon *names*. That
matters beyond consistency: `tblUser.Avatar` stores presets like
`icon:ghost|violet`, and with one shared set those render identically on web and
mobile with no translation table between them.

Icons are **components, not name strings**. A prop that takes an icon is typed
`LucideIcon` and rendered as a component:

```tsx
import { Trash2, type LucideIcon } from "lucide-react-native";

interface Props { icon: LucideIcon }
function Row({ icon: Icon }: Props) {   // capitalise it — JSX needs that
  return <Icon size={18} color={colors.danger} />;
}
```

lucide has one stroked icon per concept rather than filled/outlined pairs, so
selected states use colour plus `strokeWidth`, not a different glyph.

It depends on `react-native-svg` — a **native module**, so adding it needed a
rebuild, and any future icon work does not.

### 9.5 Shared components — build it once, in `src/ui/`

`ActionSheet · Avatar · Button · Card · Chip · ComposeSheet · DateField ·
Dialog · Divider · EmptyState · Fab · Input · Screen · ScreenHeader ·
Segmented · Select · Sheet · Text`

If a screen needs a widget that is not there, **add it there**. Two screens
building the same thing separately is the failure this prevents.

- **`ChipGroup` for a row of pills where one is selected** (list filters, a
  direction picker); **`Chip` for a static label** (a stage, a badge);
  **`Segmented` for switching between views of one record**. All three were
  hand-rolled ~20 times before this was written down.
- **`Card` is the only raised surface.** Never hand-roll
  `backgroundColor + borderRadius + shadows.md` in a screen. That happened in
  nine files, and every change to the shell then had to be made nine times —
  a clipping bug that flattened one screen lived in exactly one of the copies.
  Content stays per-domain (a task and a complaint show different things); the
  surface is decided in `ui/Card` and nowhere else.
- Three rules inside it are load-bearing: **no border**, **never
  `overflow: hidden`** (on iOS it sets `masksToBounds`, which clips the layer's
  own shadow and renders the card perfectly flat — this cost an afternoon), and
  **press sinks** via `translateY` rather than a colour tint.
- **Depth comes from contrast, not shadow.** The page (`background`) is one
  step darker than a card (`surface`); that is what makes a card read as a
  card. A shadow is a whisper on top and nothing more. Do not reach for
  shadow opacity when something looks flat — check the contrast first.
- **A blur spreads sideways as well as down.** A column of same-width cards
  therefore draws two continuous grey lines down its edges, and inside a board
  the neighbouring column paints over the spill and slices them. Cards on a
  board drop the shadow entirely, via the `useOnBoard` context in
  `ui/boardSurface` — a context, not a prop, because it is a fact about where
  the card is and the call site that forgets to pass `flat` is the one that
  will look wrong.

- **One** bottom sheet (`Sheet`, `@gorhom/bottom-sheet`) — every picker, action
  menu and "move to…" list uses it. Presented imperatively via a ref so a
  parent re-render cannot reopen it. `ActionSheet` (a list of actions) and
  `ComposeSheet` (a one-to-three-field form) are the two shapes built on it;
  reach for those before writing a bare `Sheet`.
- **Never build a menu with `.push()`.** `react-hooks/refs` fails the build
  when a handler closing over a ref is passed into a function call during
  render — build the array as a literal with conditional spreads, and gate its
  visibility on a boolean, not on `list.length`.
- **One** confirm dialog (`Dialog`). **Never use RN's `Alert`** — it cannot be
  styled, cannot show a loading state, and blocks the JS thread on Android.
- **One** picker (`Select`, single + multi) and **one** date picker
  (`DateField`, handles the iOS/Android modal difference internally).
- `DateField` formats local Y/M/D, **never `toISOString()`** — that converts to
  UTC and rolls the date back a day for every user in IST.

### 9.6 Drag and drop

There is no `@dnd-kit` on React Native; gestures go through
`react-native-gesture-handler` + `react-native-reanimated`.

- **Within a list** (checklist items, column order): use
  `react-native-reorderable-list`. Actively maintained, works with Reanimated 4.
  Avoid `react-native-draggable-flatlist` — stale, and it breaks on Reanimated 4.
- **Between kanban columns**: **do not build drag.** Four columns on a 360px
  screen makes a drop target a few pixels wide. Use long-press → "Move to…"
  `Sheet` → `moveTaskColumn` / `moveTicketStage`. Same endpoint, same gate, far
  better on a phone.
- **Both boards share `ui/BoardColumns`** — the horizontal snapping strip.
  Column width and gap must agree exactly or every swipe lands a few pixels off
  and the drift compounds; that arithmetic lives there and nowhere else.
- **Mobile has no table view.** The web splits Support into a Tickets table and
  a TicketBoard; mobile ships only the board. A table on 360px is a worse list,
  and the board already answers what a phone gets asked — what is where, and
  move this one along.

### 9.7 Standing constraints

- **No test suite on mobile** (decided 2026-08-02). §0.4 binds `backend/src`
  and `web/src` only. `pnpm typecheck` + `pnpm lint` are the gate instead.
  Reactotron (dev-only, stripped from release bundles) shows every API call
  live — that is how payload drift is caught.
- **No realtime, no push, no offline** in Phase A. Freshness comes from
  refetch-on-app-focus, wired via `AppState` → React Query's `focusManager`
  (its default is browser-only and does nothing on native).
- API base is `https://shadowcodes.in/CRM`, overridable via
  `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env.local` for pointing at a local
  backend — use the LAN IP, not `localhost` (on a phone that is the phone).
- Attachments: `Entity` must be appended to `FormData` **before** the file part
  — multer reads `req.body.Entity` while the stream is parsed, so file-first
  lands the upload in `uploads/misc/`.
