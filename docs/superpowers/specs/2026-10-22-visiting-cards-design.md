# Visiting Cards (VisiScan on the CRM) — design

Date: 2026-10-22 · Status: draft for review

## Why

VisiScan (`Nexus/VisiScan`, Expo) photographs a visiting card, reads it with an
AI model, and syncs it to a server. Today that server is the standalone card
API inside `Nexus/JRS/backend` (`cardRoutes.js` / `cardController.js`), open
with no sign-in. Cards are company data and need per-person ownership, so the
CRM becomes VisiScan's server: CRM users sign in on the app, each sees their own
cards, the boss sees everyone's.

VisiScan stays a **separate app** — it is neatly built and useful beyond the
CRM. It moves into the CRM mobile app slowly, later, not in this work.

## Who uses what

- **Staff** — app only. Two things: scan a card, see the cards they scanned.
- **Client's manager** — web only. Create users, see every card.
- **Us** — Admin login as today.

A client who buys only VisiScan is an ordinary new CRM company (new-client
checklist, CLAUDE.md §8). What they see is set by roles, no special code:

| Role | IsAdmin | Grants | Result |
|---|---|---|---|
| Manager | **no** | `people` edit, Company · `cards` view, Company | Web sidebar shows Users + Visiting Cards only |
| Card scanner | no | `cards` view/add/delete, Own | App: own cards only |

The manager must **not** be an admin: an admin gets every module
(`access.js`), so would see the whole CRM. Roles are created by us in the Roles
page per client; script 114 seeds nothing beyond Owner/Admin grants.

## Goals (v1)

1. CRM serves VisiScan's three card endpoints and its photo URLs with the
   **same request and response shapes** the app already uses (below), so the
   app's sync code changes only in base URL, sign-in, and one auth header.
2. Cards carry their scanner (`OwnerId`) and office (`BranchId`); every read
   and write is scoped by the `cards` module reach like leads.
3. Web "Visiting Cards" screen: searchable list + detail with both photos.

## Non-goals (v1)

- Turning a card into a lead/customer; dedupe against leads/customers.
- Editing cards on the web (the app owns the card). Web is read-only.
- Moving scanning into the CRM mobile app.
- Changes to the JRS standalone server.
- Moving cards already saved on the JRS server — they stay there (user,
  2026-10-22).

## Anti-goals

- Any card or photo reachable without a signed-in user.
- A reply shape the app does not expect — the app treats anything except
  2xx with `success !== false` as a failure and retries it forever.

## Auth

- App sign-in = the CRM's: company code → Central
  (`/Central/api/clients/<CODE>?appType=ECRM_EMP`, existing rows, *Claude's
  call*) → `BaseURL` → `POST /api/auth/loginUser` → JWT. App sends
  `Authorization: Bearer <token>` on card calls **and photo loads**.
- Card routes run `verifyToken, loadScope, requireModule("cards", …)` —
  standard guards, so `routeAccess.test.js` passes unchanged.
- On 401 (`SESSION_*` codes, CLAUDE.md §3 Auth step 5) the app shows its
  sign-in screen and holds sync until signed in; pending cards stay queued.
- **Side effects to verify while building** (read from code, not tested):
  an app sign-in is a real session — it counts for presence/attendance, and it
  expires at the user's shift end + buffer. A user with no work calendar must
  still get a usable session; if not, fix in `sessionService`.

## Data — `tblVisitingCard` (script `114_visiting_cards.sql`)

| Column | Type | Notes |
|---|---|---|
| Id | UNIQUEIDENTIFIER PK | made by the app |
| CompId | INT NOT NULL | from the token |
| BranchId | INT NOT NULL | scanner's home office at insert |
| OwnerId | INT NOT NULL | scanner (`req.user.UserId`) at insert; never changes |
| BusinessName | NVARCHAR(200) NOT NULL DEFAULT '' | |
| ContactPerson, Designation | NVARCHAR(150) NOT NULL DEFAULT '' | |
| Website | NVARCHAR(300) NOT NULL DEFAULT '' | |
| Gstin | NVARCHAR(50) NOT NULL DEFAULT '' | |
| Description, Other, Notes | NVARCHAR(MAX) NOT NULL DEFAULT '' | |
| Mobiles, Landlines, Emails, Addresses | NVARCHAR(MAX) NOT NULL DEFAULT '[]' | JSON array of strings, `CHECK (ISJSON(x)=1)` |
| FrontPath | NVARCHAR(400) NOT NULL | `cards/<id>/front-<random>.jpg` |
| BackPath | NVARCHAR(400) NULL | |
| AppCreatedAt, AppUpdatedAt | DATETIMEOFFSET NOT NULL | from the app |
| ReceivedAt | DATETIME NOT NULL DEFAULT GETDATE() | |
| ModifiedAt | DATETIME NULL | |
| IsDeleted | BIT NOT NULL DEFAULT 0 | |
| DeletedAt | DATETIME NULL | |

All text Unicode (Hindi). Blank = `''`, never NULL. Index
`(CompId, IsDeleted, ReceivedAt DESC)`.

Script 114 also adds: `cards` to the module list, a `tblMenu` row "Visiting
Cards" (Route `/sales/visiting-cards`, Module `cards`) — same pattern as
`partners` (commit b349524). No grant rows: Owner/Admin are admins and get
every module already; other roles are granted in Roles.

## Endpoints (app contract — match `JRS/backend` exactly)

Envelope is the CRM's `responseHelper`, which already matches the app:
`{ success, message, data, … }`, HTTP status = `responseCode`.

### `POST /api/Card/saveCard` — multipart, `requireModule("cards","add")`

- Fields: `id, businessName, contactPerson, designation, website, gstin,
  description, other, notes, createdAt, updatedAt` (blank sent as `''`);
  `mobiles, landlines, emails, addresses` as JSON-array strings (≤ 50 string
  items). Files `front` (required), `back` (optional): JPEG (`FF D8 FF`),
  ≤ 5 MB each. Errors 400 / 413 / 415.
- Upsert by `id` in one SP transaction, `UPDLOCK, HOLDLOCK` on the row.
- Existing row: the caller must be able to see it with `cards` edit-or-owner
  rights (owner always may); otherwise 403. Owner/office never change on update.
- Update only when incoming `updatedAt` > stored `AppUpdatedAt`; photos
  replaced, old files deleted after commit. Same/older `updatedAt`, or card
  soft-deleted → no change, still 200.
- Photos written first; if the SP does not insert/update, the new files are
  deleted.
- 200 `data: { id }`.

### `POST /api/Card/fetchCard` — JSON, `requireModule("cards","view")`

- `{ id }` → `data: { rows: [card], totalCount: 1, pageNumber: 1, pageSize: 1,
  totalPages: 1 }`; 404 if missing, deleted, or outside the caller's reach.
- `{ search, pageNumber (1-based), pageSize (≤ 200) }` → newest first,
  `data: { rows, totalCount, pageNumber, pageSize, totalPages }`.
  **Not** the CRM's usual `pagination` object — the app reads `data.rows` and
  `data.totalPages`.
- Search (LIKE) over business name, contact person, GSTIN and the mobiles,
  landlines, emails JSON text.
- Scope: `scopeParams(req, "cards")`; a card whose `OwnerId` = caller is always
  visible (universal rule, CLAUDE.md §3).
- Row: `id, businessName, contactPerson, designation, mobiles, landlines,
  emails, addresses` (real arrays), `website, gstin, description, other, notes,
  createdAt, updatedAt` (the app's times), `frontImage, backImage` (relative
  paths like `cards/<id>/front-x.jpg`, `""` if none — never full URLs).
  Web extra (harmless to the app): `ownerName, receivedAt`.

### `POST /api/Card/deleteCard` — JSON `{ id }`, `requireModule("cards","delete")`

Soft delete, scoped like fetch. 200 `data: { id }`; a repeat on an already-deleted card also answers 200 (the app retries anything non-2xx forever); 404 only if missing/out of reach.

### `GET /uploads/cards/:id/:file` — photos

The app builds `${API_ROOT}/uploads/${frontImage}`, so the CRM serves exactly
that path (`https://shadowcodes.in/CRM/uploads/cards/…`; the CRM serves no
static `uploads` today). Guards `verifyToken, loadScope,
requireModule("cards","view")`; the card must be visible to the caller and
`:file` must be its current front/back file name (no path traversal);
streams `image/jpeg`, `Cache-Control: private`. Deleted card → 404.

## Web screen

- Route `/sales/visiting-cards`, menu from DB.
- Uses the same `fetchCard` endpoint; photos fetched as blobs with the token
  (object URL, like attachments).
- List (`useServerTable` + material-react-table): business, contact person,
  first mobile, first email, scanned by, received date; search box.
- Row click → `Modal`: both photos side by side (click to enlarge), every
  field, lists one per line, `tel:` / `mailto:` links.
- Shared `ui/` components, solid colours only.

## App changes (VisiScan — done by us, minimal)

- `.env` / settings: company code instead of a fixed `EXPO_PUBLIC_API_URL`;
  Central lookup gives `BaseURL`; `API_URL = BaseURL + /api/Card`.
- A sign-in screen gating the Stack in `_layout.tsx`; hold `syncNow` until
  signed in; sign-out.
- `Authorization` header in `post()` and the two `axios.post` calls in
  `sync.ts`, on `<Image source={{ uri, headers }}>` and on
  `File.downloadFileAsync`.
- 401 → back to sign-in (cards stay queued).

## Testing

Backend (Jest): every guard; 400/413/415; insert; newer update deletes old
files; same/older and deleted → 200 no change, new files removed; 403 on
another person's card; fetch one/list/paging clamp/scope (Own sees only own,
Company sees all); 404s; delete; photo route (visible, wrong file name,
traversal, other person's card, deleted). Web (Vitest): list + search, detail
modal, photos, menu hidden without the module. App: `pnpm typecheck` + lint.

## Deploy

SQL 114 by hand: TestCRM → eCRM+ → SolarCRM. Backend rsync + rebuild. Web
build upload. App build with the new sign-in.

## Left to the builder

SP names, file layout, web column widths.
