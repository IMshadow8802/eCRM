# Visiting Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CRM becomes VisiScan's server: signed-in CRM users sync visiting cards to it, each sees cards by `cards` module reach, and the web gets a read-only Visiting Cards screen.

**Architecture:** One table + three SPs (script 114). The JRS card controller (`Nexus/JRS/backend/src/controllers/cardController.js`) is ported into the CRM with CompId/BranchId/OwnerId and the standard `verifyToken → loadScope → requireModule("cards", …)` guards. One endpoint set serves both the app and the web; a guarded GET serves photos at the path the app already builds. VisiScan gains a CRM sign-in and an auth header.

**Tech Stack:** SQL Server SPs · Node/Express 5, zod, Jest + Supertest · React 19, TanStack Query, material-react-table, Vitest + MSW · Expo (VisiScan, TypeScript).

**Spec:** `docs/superpowers/specs/2026-10-22-visiting-cards-design.md`

## Global Constraints

- SQL is written to `backend/sql/114_visiting_cards.sql` and **never applied by Claude**; the user applies it to TestCRM, then eCRM+ and SolarCRM. Any sqlcmd command given to the user includes `-I`.
- pnpm only. No git action except read unless the user orders it in that message.
- Backend/web: test-first; ≥ 80 % line/branch coverage on every touched file. VisiScan: `pnpm typecheck` + `pnpm lint` clean (no tests).
- Every route declares access (`routeAccess.test.js`). Visibility only through `scopeParams(req, "cards")`; never `req.user.BranchId` as a filter. A card whose `OwnerId` = caller is always visible.
- App contract is byte-for-byte JRS: paths `/api/Card/saveCard|fetchCard|deleteCard`; list reply `data: { rows, totalCount, pageNumber, pageSize, totalPages }`; success = 2xx with `success !== false`; repeats and stale/deleted saves answer **200**.
- Text is Unicode; blank = `''`, never NULL. Lists stored as JSON arrays (≤ 50 strings, each ≤ 500 chars). Photos: JPEG (`FF D8 FF`), ≤ 5 MB each, stored as `cards/<id>/<side>-<uuid>.jpg` under `uploads/`.
- Web: shared `ui/` components, solid colours only, MUI v9 `slotProps`.
- Existing JRS cards are not migrated.

## Review Focus

1. Two identical uploads at the same moment → one row, both answer 200, no orphan photo files on disk.
2. A photo URL with `..`, an encoded slash, another card's file name, or another person's card → 404, never a file.
3. App token expires mid-queue → 401 → sign-in screen; queued cards survive and sync after sign-in.
4. Search text containing `%`, `_` or `[` → matched literally, not as LIKE wildcards.
5. A Card-scanner user (Own reach) opening the web → sees only own cards; manager (Company) sees all.

---

### Task 1: SQL script 114

**Files:**
- Create: `backend/sql/114_visiting_cards.sql`

**Interfaces — Produces (exact contracts used by Task 3):**
- `tblVisitingCard` — columns exactly as the spec table (incl. `CompId, BranchId, OwnerId`), PK `Id UNIQUEIDENTIFIER`, `CHECK (ISJSON(col)=1)` on the four list columns, index `IX_tblVisitingCard_List (CompId, IsDeleted, ReceivedAt DESC)`.
- `sp_SaveVisitingCard @Id UNIQUEIDENTIFIER, @CompId INT, @UserId INT, @BranchId INT, @BusinessName NVARCHAR(200), @ContactPerson NVARCHAR(150), @Designation NVARCHAR(150), @Website NVARCHAR(300), @Gstin NVARCHAR(50), @Description NVARCHAR(MAX), @Other NVARCHAR(MAX), @Notes NVARCHAR(MAX), @Mobiles NVARCHAR(MAX), @Landlines NVARCHAR(MAX), @Emails NVARCHAR(MAX), @Addresses NVARCHAR(MAX), @FrontPath NVARCHAR(400), @BackPath NVARCHAR(400) = NULL, @AppCreatedAt DATETIMEOFFSET, @AppUpdatedAt DATETIMEOFFSET, @CanEditOthers BIT, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL` → one row `Saved BIT, ResponseCode INT, ResponseMess NVARCHAR(200), OldFront NVARCHAR(400), OldBack NVARCHAR(400)`.
  - Inside `BEGIN TRAN`, read the row `WITH (UPDLOCK, HOLDLOCK)` by `Id AND CompId`.
  - Missing → insert (OwnerId = @UserId, BranchId = @BranchId) → `Saved 1, 200`.
  - Exists, `IsDeleted = 1` or `@AppUpdatedAt <= AppUpdatedAt` → `Saved 0, 200, 'Already up to date'`.
  - Exists, `OwnerId <> @UserId` and not (`@CanEditOthers = 1` and row passes the scope predicate below) → `Saved 0, 403, 'Not your card'`.
  - Else update every content column + paths + `AppUpdatedAt`, `ModifiedAt = GETDATE()`; return old paths → `Saved 1, 200`. Owner/office/`AppCreatedAt` never change.
  - TRY/CATCH: 2627 (concurrent insert of same Id) → `Saved 0, 200, 'Already saved'`; other errors → `Saved 0, 500, ERROR_MESSAGE()`.
- `sp_FetchVisitingCards @CompId INT, @Id UNIQUEIDENTIFIER = NULL, @Search NVARCHAR(100) = NULL, @PageNumber INT = 1, @PageSize INT = 50, @UserId INT, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL` → RS1 one row `TotalCount`; RS2 rows: `Id, BusinessName, ContactPerson, Designation, Website, Gstin, Description, Other, Notes, Mobiles, Landlines, Emails, Addresses, FrontPath, BackPath, AppCreatedAt, AppUpdatedAt, ReceivedAt, OwnerId, OwnerName` (from `tblUser.FullName`), `IsDeleted = 0` only, newest `ReceivedAt` first, `OFFSET/FETCH`.
  - Scope predicate (copy of `sp_FetchLeads`; `'[]'` = nobody, NULL = no filter): `c.OwnerId = @UserId OR ((@UseBranchScope = 0 OR c.BranchId IN @BranchIds) AND (@UseOwnerScope = 0 OR c.OwnerId IN @OwnerIds))`.
  - Search: `@Search` escaped for `[`, `%`, `_` (`REPLACE` to `[[]`, `[%]`, `[_]`) then `LIKE N'%' + @s + N'%'` over BusinessName, ContactPerson, Gstin, Mobiles, Landlines, Emails.
- `sp_DeleteVisitingCard @Id UNIQUEIDENTIFIER, @CompId INT, @UserId INT, @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL, @OwnerIdsJson NVARCHAR(MAX) = NULL` → `ResponseCode 200` (sets `IsDeleted = 1, DeletedAt = GETDATE()`) or `404` (missing, deleted, or fails the scope predicate).
- `CK_tblGroupModule_Module` and `CK_tblGroupModule_Reach` rebuilt with `'cards'` added (current live lists are in the 2026-10-22 TestCRM definitions: Module list = leads, sales_reports, complaints, support_reports, customers, people, tasks, teams, projects, settings, dashboard, attendance, partners; Reach modules = leads, complaints, customers, people, attendance). Same guarded drop/add as 107 §5.
- `tblMenu` row: `'Visiting Cards'`, Route `/sales/visiting-cards`, Module `cards`, parent = the `/sales` root — same INSERT shape as 107 §6. No `tblGroupModule` rows (admins get every module).

- [ ] **Step 1:** Write the script: header comment (what/why/order TestCRM → eCRM+ → SolarCRM), idempotent `IF NOT EXISTS` / `CREATE OR ALTER`, `GO`-separated, `SET QUOTED_IDENTIFIER ON`.
- [ ] **Step 2:** Append a "verify after apply" block: `EXEC sp_SaveVisitingCard` with a fixed GUID and Hindi text (`N'राम ट्रेडर्स'`) twice (first `Saved 1`, second `Saved 0, 200`); `EXEC sp_FetchVisitingCards @Id = …` returns the Hindi unchanged; `@Search = N'50%'` returns no row for a card named `500 Traders`; `sp_DeleteVisitingCard` then fetch → no row; cleanup `DELETE` of the test row.
- [ ] **Step 3:** Check the script compiles without applying it: for each SP body, read the live definitions of referenced tables via MCP (`INFORMATION_SCHEMA.COLUMNS` for `tblUser`, `tblMenu`) and confirm every column name used exists.
- [ ] **Step 4:** Hand the user the apply command for TestCRM: `sqlcmd -S prdinfotech.in -d TestCRM -U <user> -I -i backend/sql/114_visiting_cards.sql`. **Stop until the user confirms it is applied**, then verify with MCP read queries (`OBJECT_ID` of the table and three SPs; constraint definitions contain `cards`).

---

### Task 2: `cards` module + photo helpers

**Files:**
- Modify: `backend/src/middleware/access.js:7-9` (add `"cards"` to `MODULES` and `REACH_MODULES`)
- Create: `backend/src/utils/cardPhotos.js`
- Test: `backend/tests/unit/utils/cardPhotos.test.js`, `backend/tests/unit/middleware/access.test.js` (add cases)

**Interfaces — Produces:**
- `readForm(req): Promise<FormData>` — port of JRS `readForm` (Content-Length and streamed total ≤ `2*5MB + 1MB`, else `HttpError(413)`; unparsable → `HttpError(400)`).
- `readPhoto(form, name, required): Promise<Buffer|null>` — port of JRS: missing+required → 400 `"The front photo is missing."`; > 5 MB → 413; not `FF D8 FF` → 415 `"The front photo must be a JPEG."`.
- `writePhoto(id, side): (bytes) => Promise<string>` returns the stored relative path `cards/<id>/<side>-<uuid>.jpg` (flag `wx`).
- `removePhoto(relPath): Promise<void>` — ignores ENOENT.
- `photoFile(relPath): string|null` — absolute path under `uploads/` or `null` if it would escape `uploads/cards/` (traversal guard).
- `class HttpError extends Error { constructor(status, message) }`.
- `UPLOAD_ROOT = path.join(process.cwd(), "uploads")` — same root as `middleware/upload.js`.

- [ ] **Step 1: Write failing tests** — `readPhoto` returns the bytes of a 3-byte `FF D8 FF` blob; throws 415 for a PNG header; 413 for 5 MB + 1; 400 for missing required; `null` for missing optional. `readForm` throws 413 when `content-length` exceeds the cap. `writePhoto` then `removePhoto` leaves no file (tmp cwd via `jest.spyOn(process, "cwd")`). `photoFile("cards/x/../../etc/passwd")` → `null`; `photoFile("cards/<id>/front-a.jpg")` → absolute path inside `uploads/cards`. `buildAccess` with a `cards` grant reach `Own` yields `scopeFor(...).ownerIds = [userId]`.
- [ ] **Step 2:** Run `pnpm exec jest cardPhotos access` — FAIL (module missing).
- [ ] **Step 3:** Implement `cardPhotos.js` (port JRS bodies; replace `AppError`/`badRequest` with `HttpError`) and the two-word change in `access.js`.
- [ ] **Step 4:** Run the same command — PASS.
- [ ] **Step 5:** Commit only if the user ordered commits.

---

### Task 3: Card controller and routes

**Files:**
- Create: `backend/src/controllers/cardController.js`, `backend/src/routes/cardRoutes.js`, `backend/src/routes/cardPhotoRoutes.js`
- Modify: `backend/src/config/routes.js` (mount `/api/Card` → cardRoutes, `/uploads/cards` → cardPhotoRoutes)
- Test: `backend/tests/unit/controllers/cardController.test.js`, `backend/tests/unit/routes/cardRoutes.test.js`

**Interfaces:**
- Consumes: Task 1 SP contracts; Task 2 helpers; `scopeParams`, `scopeFor` from `middleware/permission`; `success`, `error` from `utils/responseHelper`; `asyncRoute` from `utils/controllerKit`.
- Produces (routes):
  - `POST /api/Card/saveCard` — `requireModule("cards","add")`, then `saveCard` (no `requirePayload`; multipart is read by `readForm`).
  - `POST /api/Card/fetchCard` — `allowEmptyPayload, requireModule("cards","view")`.
  - `POST /api/Card/deleteCard` — `requirePayload, requireModule("cards","delete")`.
  - `GET /uploads/cards/:id/:file` — `verifyToken, loadScope, requireModule("cards","view")`.
- Produces (row shape, `toCard(row)`): `{ id, businessName, contactPerson, designation, mobiles[], landlines[], emails[], addresses[], website, gstin, description, other, notes, createdAt, updatedAt, frontImage, backImage, ownerName, receivedAt }` — `id` lower-case; `createdAt/updatedAt` = `AppCreatedAt/AppUpdatedAt` ISO; `frontImage = FrontPath`, `backImage = BackPath || ""`.
- Produces (list reply): `success(res, msg, { rows, totalCount, pageNumber, pageSize, totalPages, pagination: { currentPage, pageSize, totalRecords, totalPages } })`. Request accepts `search|SearchTerm`, `pageNumber|PageNumber`, `pageSize|PageSize` (camel wins), pageSize clamped 1..200, default 50; `{id}` invalid UUID → 400.

Behaviour notes for the implementer:
- `saveCard`: validate with the JRS zod `cardFields` schema (copy verbatim). Write photos → call SP with `CompId, UserId` from `req.user`, `BranchId = Number(req.scope.primaryBranchId)`, `CanEditOthers = scopeFor(req,"cards").can.edit ? 1 : 0`, `...scopeParams(req,"cards")` → in `finally` remove new photos unless `Saved`; on `Saved` remove `OldFront/OldBack`. Reply: `ResponseCode 200` → `success(res, mess, { id })`; else `error(res, mess, "CARD_SAVE_ERROR", code)`. `HttpError` → `error(res, msg, "CARD_INVALID", status)`.
- `fetchCard` with `id`: no row → 404 `"Card not found"`; reply uses the list shape with one row.
- Photo route: fetch the card by `:id` via `sp_FetchVisitingCards` (scoped); 404 unless found and `basename(FrontPath|BackPath) === req.params.file`; then `res.set("Cache-Control","private, max-age=300").type("image/jpeg").sendFile(photoFile(path))`; missing file on disk → 404.

- [ ] **Step 1: Write failing controller tests** (DB mocked like other suites; `tests/helpers/mockRes.js`):
  - save inserts: SP called with `CompId`, `UserId`, `BranchId`, JSON-stringified lists, `CanEditOthers 0` for an Own-reach caller; reply 200 `{ data: { id } }`; new files exist.
  - save stale (`Saved 0, 200`) → 200 and both new files removed.
  - save newer (`Saved 1` with `OldFront`) → old file removed, new kept.
  - save 403 from SP → 403 and new files removed.
  - SP throws → 500 and new files removed.
  - bad field (`mobiles` not JSON array) → 400 naming the field; PNG front → 415; 6 MB front → 413; missing front → 400.
  - **Review Focus 1:** two concurrent `saveCard` calls where the SP mock answers `Saved 1` then `Saved 0, 200, 'Already saved'` → both 200, exactly one pair of files left on disk.
  - fetch list: `rows` mapped (`mobiles` array, `frontImage` path, `backImage ""` when NULL), `totalPages = ceil(total/pageSize)`, `pageSize 500` → SP called with 200; `SearchTerm`/`PageNumber` aliases honoured; `pagination.totalRecords` present.
  - fetch `{id}` not found → 404; `{id:"x"}` → 400.
  - delete 200 / 404 pass-through.
- [ ] **Step 2: Write failing route tests** (Supertest on an app with `setupRoutes`, auth mocked as other route suites do):
  - no token on each `/api/Card/*` and on the photo route → 401.
  - **Review Focus 2:** photo GET with `..%2F..%2Fetc%2Fpasswd`, a file name that is not the card's, and a card the SP does not return → 404; correct name → 200 `image/jpeg`.
  - `routeAccess.test.js` still passes (run it).
- [ ] **Step 3:** Run `pnpm exec jest card routeAccess` — FAIL.
- [ ] **Step 4:** Implement controller, two routers, mounts.
- [ ] **Step 5:** Run `pnpm exec jest card routeAccess --coverage --collectCoverageFrom='src/controllers/cardController.js' --collectCoverageFrom='src/utils/cardPhotos.js' --collectCoverageFrom='src/routes/card*.js'` — PASS, ≥ 80 % lines and branches; then the full `pnpm exec jest --silent` — green.
- [ ] **Step 6:** Verify the SP contract against the applied TestCRM DB: MCP `read_query` on `sys.parameters` for the three SPs matches every parameter name the controller sends (node-mssql rejects unknown params).
- [ ] **Step 7:** Check `sessionService.start` for a user with no work calendar (read `userCalendar`, `start`): if the computed expiry is ≤ now, write a failing test in `sessionService.test.js` and fix so the session gets the company default calendar end (or now + 8 h when none). If it is fine, note it in the task report.
- [ ] **Step 8:** Commit only if ordered.

---

### Task 4: Web Visiting Cards screen

**Files:**
- Create: `web/src/api/cardQueries.js`, `web/src/pages/Sales/VisitingCards/VisitingCards.jsx`, `web/src/pages/Sales/VisitingCards/CardDetailModal.jsx`
- Modify: `web/src/App.jsx` (lazy route `/sales/visiting-cards`, next to `/sales/partners`), `web/src/pages/Master/Groups.jsx` (`MODULE_ROWS`: `{ key: "cards", label: "Visiting cards", reach: true }` after partners; `ROW_HINT.cards`: `"View: see scanned visiting cards within the reach. Add: scan cards in the VisiScan app. Delete: remove a card."`)
- Test: `VisitingCards.test.jsx`, `CardDetailModal.test.jsx`, `web/src/api/cardQueries.test.js`, `Groups.test.jsx` (one case)

**Interfaces:**
- Consumes: Task 3 `fetchCard` (dataKey `rows`, `pagination.totalRecords`) and photo route.
- Produces: `CARD_ENDPOINTS = { fetchCard: "/api/Card/fetchCard" }`; `fetchCardPhoto(path): Promise<{ url: string }>` — `apiClient.get("/uploads/" + path, { responseType: "blob" })` → object URL (caller revokes).

- [ ] **Step 1: Write failing tests** (MSW):
  - list renders business, contact person, first mobile, first email, scanned by (`ownerName`), received date; typing in search sends `SearchTerm`.
  - row click opens `CardDetailModal`: all fields, every mobile as a `tel:` link and email as `mailto:`, both photos `<img>` with blob URLs; no back photo → no second image; photo fetch failure → "Photo unavailable" text, rest still renders.
  - empty list → `EmptyState` "No visiting cards yet".
  - object URLs revoked on modal close.
  - Groups: the Visiting cards row shows a reach selector.
- [ ] **Step 2:** Run `pnpm exec vitest run src/pages/Sales/VisitingCards src/api/cardQueries src/pages/Master/Groups` — FAIL.
- [ ] **Step 3:** Implement: list with `useServerTable({ columns, queryKey: "cards", endpoint: CARD_ENDPOINTS.fetchCard, dataKey: "rows", getRowId: (r) => r.id })`, `PageHeader` "Visiting Cards"; modal via `ui/Modal` (`size="xl"`), photos side by side, click to open full size in a second `Modal`.
- [ ] **Step 4:** Run the same command with `--coverage` — PASS, ≥ 80 % on the new/changed files; then `pnpm exec vitest run` — green.
- [ ] **Step 5:** Commit only if ordered.

---

### Task 5: VisiScan sign-in and auth header

**Files (all under `/Users/ayushmishra/Developer/Nexus/VisiScan`):**
- Create: `src/lib/auth.ts`, `src/app/sign-in.tsx`
- Modify: `src/lib/sync.ts` (base URL, headers, 401), `src/app/_layout.tsx` (gate + hold sync), the screens that render card photos (`<Image source>` → `{ uri, headers }`), `.env.example`

**Interfaces:**
- Produces `auth.ts` (persisted in the existing `src/lib/settings.ts` kv-store):
  - `getSession(): { apiBase: string; token: string; userName: string } | null`
  - `signIn(companyCode: string, username: string, password: string): Promise<void>` — `GET https://shadowcodes.in/Central/api/clients/<CODE>?appType=ECRM_EMP` → `BaseURL`; `POST ${BaseURL}/api/auth/loginUser` with the same body the CRM mobile app sends (copy from `CRM/mobile/src/api/` login fetcher) → store `token`, `apiBase = BaseURL`, user's name. Errors throw the server's `message`.
  - `signOut(): void`; `subscribe(fn): () => void` (for `useSyncExternalStore`).
  - `authHeaders(): Record<string, string>` → `{ Authorization: "Bearer <token>" }` or `{}`.
- `sync.ts`: `API_URL` becomes `${getSession().apiBase}/api/Card` (drop `EXPO_PUBLIC_API_URL` default to JRS); `post()`, `fetchCards`, `getCard`, `File.downloadFileAsync` send `authHeaders()`; `imageUrl` unchanged in shape (`${apiBase}/uploads/${path}`); any 401 → `signOut()` and stop the run (items stay pending).

- [ ] **Step 1:** Implement `auth.ts` and `sign-in.tsx` (company code, username, password, error under the form; reuse the app's existing components and theme).
- [ ] **Step 2:** `_layout.tsx`: no session → render `sign-in` instead of the Stack; `syncNow` effects run only with a session; add a sign-out action where the app keeps its settings/menu.
- [ ] **Step 3:** Wire headers and 401 handling in `sync.ts`; pass `headers: authHeaders()` on every remote `<Image>`.
- [ ] **Step 4:** `pnpm typecheck` and `pnpm lint` in VisiScan — both clean.
- [ ] **Step 5:** Manual check with the user against TestCRM (company code `TestCRM`, a test user with `cards` Own): sign in → scan → card appears on web for an admin; **Review Focus 3:** end that user's session from the admin web (`endSession`) → app returns to sign-in on next sync, card scanned meanwhile syncs after signing in again.
- [ ] **Step 6:** Commit only if ordered (VisiScan is its own repo).

---

### Task 6: Docs and deploy notes

**Files:**
- Modify: `CLAUDE.md` (§6 Key domains: a "Visiting cards" bullet — VisiScan is a separate app; `/api/Card/*` contract is JRS's and must not change shape; list reply is `rows/totalPages`; photos at `/uploads/cards/...` guarded; `cards` module), `backend/ROLES.md` (`cards` module, reach, the Manager/Card-scanner role recipe from the spec).

- [ ] **Step 1:** Write both doc changes.
- [ ] **Step 2:** Hand the user the deploy commands: apply 114 to eCRM+ and SolarCRM (with `-I`), backend rsync of `src/` + `docker compose up -d --build crm crm_solar crm_test`, web `pnpm build` + upload `dist-web/`, VisiScan release build.
- [ ] **Step 3:** After the user confirms 114 is applied everywhere and it is committed, delete `backend/sql/114_visiting_cards.sql`; log to Notion (Done + Change Log, dated).
