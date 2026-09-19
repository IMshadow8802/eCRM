# Quotations + Lead Conversion (spec 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sales staff build a good-looking quotation from a lead — prebuilt template, their own logo and images, a full rich-text editor, GST split, a downloadable PDF — and give the sales engine the convert step it has been refusing to perform without, so a lead can finally be **Won**, with or without a quotation.

**Architecture:** One SQL script the owner applies by hand to each client DB (`091`: four new tables, `WonValue`/`CustomerId` on leads, tax fields on products, `GSTIN` on customers, a "Won" status row under the already-whitelisted `converted` code, the missing `sp_ConvertLead`, seven quotation procs, mobile-number enforcement, five report procs taught that success has two codes). Backend gains a `quotations` router whose every endpoint is gated through the **parent lead** (`assertRecordAccess`), plus `leads/convertLead`. Web gains a full-page builder whose right half **is** the PDF (`@react-pdf/renderer`, lazy-loaded), a Tiptap editor in `ui/`, three templates on shared parts, a quotations list, and a Won dialog on the lead page. Arithmetic is exact (BigInt paise on the client, DECIMAL in the SP) and pinned to one fixture table on both sides; the SP's numbers are the truth.

**Tech Stack:** SQL Server (T-SQL, `CREATE OR ALTER`), Node 22 + Express 5 + mssql (Jest + Supertest), React 19 + Vite + MUI 9 + TanStack Query 5 + react-router 7 (Vitest + RTL + MSW), **new:** Tiptap 3.31.3, `@react-pdf/renderer` 4.9.0, `react-pdf-html` 2.1.5. React Native + Expo SDK 57 (one two-line change; typecheck + eslint only).

**Spec:** `docs/superpowers/specs/2026-09-18-quotations-design.md` (binding). Builds on `2026-09-08-sales-foundation-hierarchy-design.md`, `2026-09-10-sales-reports-design.md` and `2026-09-16-support-rebuild-design.md` (all shipped; `tblCustomer` comes from the last).

## Global Constraints

- **pnpm only.** Never npm.
- **Git is read-only for the implementer.** Every task ends with "Stop and report" — the owner commits. Never `git add`/`commit`/`push`/`stash`/`checkout`/`rm`.
- **SQL is never applied by the implementer.** `091_quotations.sql` is written to `backend/sql/` and the owner runs it by hand, **once per client database** (`eCRM+`, `SolarCRM`). Live reads through `mcp__sqlserver-ecrm__read_query` / `describe_table` are allowed; never `write_query`/`create_table`/`alter_table`/`drop_table`/`sqlcmd`/`dbq`. The script has **no `USE`** and resolves menu / lookup rows by `Route` / `Kind`+`Code`, never by Id — Ids differ per DB.
- **Test-first, ≥ 80 % line/branch on every touched file** in `backend/src/` and `web/src/`. Global floor 60 %. Never `.only`/`.skip`/`xit`. `mobile/` is exempt; its gate is `pnpm typecheck` + `pnpm lint` clean.
- **Transcripts go to the session scratchpad, never `/tmp`.** Where a step redirects output, `SCRATCH` is the scratchpad directory named in your environment (`export SCRATCH=<that path>` once per shell).
- **MEMORY-SAFE test rules (verbatim, every task):** one test file per run; Bash timeout ≤ 300000; never `pnpm test`; never bare `vitest`/`jest`; never a full-suite run except Task 9 (backend) and Task 19 (web); never `pnpm build` except Task 19; max 3 attempts on a failing test then report BLOCKED.
- **Jest command shape:** `cd backend && pnpm exec jest <file> --maxWorkers=2 --silent` (add `--coverage --collectCoverageFrom='<src file>'` on the GREEN run). **Vitest command shape:** `cd web && pnpm exec vitest run <file>` (add `--coverage --coverage.include=<src file>` on the GREEN run). **Mobile:** `cd mobile && pnpm typecheck` then `pnpm lint`.
- **MUI v9**: `slotProps`, never `InputProps`/`inputProps`/`renderTags`. Use `components/ui/*` primitives (`Combobox`, `TextInput`, `TextArea`, `NumberInput`, `DateField`, `Tabs`, `Chip`, `Button`, `IconButton`, `Modal`, `Card`, `PageHeader`, `EmptyState`, `FormGrid`) — never raw MUI selects. A page never wraps `<MaterialReactTable` in an `overflow` container (`components/table/tableSurface.test.js` fails the build if it does).
- **Every route is `POST`**; every SP call carries `CompId` from `req.user`; list visibility comes from `scopeParams(req)` (`UserId`, `AccessibleBranchIdsJson`, `OwnerIdsJson`). Never `req.user.BranchId` as a visibility filter.
- **A quotation has no permission model of its own.** Every quotation endpoint resolves the parent lead and is gated by the lead's visibility. `tblQuotation` carries no `BranchId`/`OwnerId`.
- **Lead scope predicate (verbatim in `sp_FetchQuotations`, on the joined lead `l`):** `( ((@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds)) AND (@UseOwnerScope = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds))) OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId)) )`. Optional filters narrow inside it, never widen.
- **Codes are the only branching key.** Lead `Code ∈ {open, qualified, lost, junk, converted}`; active = `open|qualified`. Quotation `Status ∈ {draft, final, accepted, rejected, superseded, unused}`. Nothing matches on a label.
- **`converted` is written by exactly one proc, `sp_ConvertLead`.** `sp_SetLeadStatus` keeps refusing it. `WonAt` / `WonValue` / `tblLeads.CustomerId` are written nowhere else (cleared only by `sp_SetLeadStatus` when a lead leaves `converted`). `tblLeadStatusHistory` has three writers: `sp_SaveLead` (insert), `sp_SetLeadStatus`, `sp_ConvertLead`.
- **Quotation totals are written only by `sp_SaveQuotation`** (and copied by `sp_ReviseQuotation`). The web never sends a total.
- **A mobile number is exactly 10 digits** after normalisation (strip non-digits; drop a leading `91` from 12 digits or a leading `0` from 11). Backend normalises; the DB `CHECK`s.
- **English only.** No locale work, no non-Latin fonts.
- **New dependencies — exactly these, `web/` only, exact versions:** `@tiptap/react` `@tiptap/pm` `@tiptap/starter-kit` `@tiptap/extension-text-style` `@tiptap/extension-text-align` `@tiptap/extension-table` (all `3.31.3`), `@react-pdf/renderer` `4.9.0`, `react-pdf-html` `2.1.5`. **Removed:** `jspdf`, `jspdf-autotable` (imported by nothing — grep confirmed 2026-09-18). Nothing else, nowhere else.
- **The toolbar is a closed list.** `react-pdf-html` drops any tag it has no renderer for **together with its text** (proved 2026-09-18: Tiptap's `Highlight` emits `<mark>` and the sentence vanished). Highlight therefore uses `BackgroundColor` from `TextStyleKit`; `Highlight`, `code`, `codeBlock` and table column resizing are never enabled; no inline images in rich text.
- **A template is never redesigned in place.** A final quote re-renders from its `TemplateCode` forever; a breaking redesign ships under a new code.
- **Live reference (company 1, `eCRM+`, 2026-09-18):** `lead_status` 29 New · 30 Contacted · 31 Follow-up (all `open`) · 32 Qualified (`qualified`) · 33 Lost (`lost`) · 34 Junk (`junk`); no `converted` row yet. `lost_reason` 22–26. Menu: 14 Sales (`/sales`) · 16 Leads (`/sales/leads`) · 33 Follow-ups · 40 Products (`/settings/products`, parent 26). `tblMenu` columns are `Id, ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route`. `tblAttachment.Entity` is `VARCHAR(20)`. `tblLeads`: 619 rows, every `MobileNo` already 10 digits. `tblCustomer`: 42 rows, 5 bad mobiles — Id 1 `+919310500657` (fixable), Ids 2 `111`, 3 `44774445555`, 19 `903315499`, 28 `975300081` (not fixable; each has tickets). Test users and branches as in the spec-2 plan. Tests use their own fixture ids — never hardcode live ids.
- **Rollout order (spec §7):** `091` on both DBs → backend deploy (both services) → web build → re-login. The gap between the first two is safe: every new proc parameter defaults to NULL and every endpoint is additive.

**Spec ambiguities resolved in this plan** (each is called out again in the task that implements it):
1. **Endpoint names follow the house style**, not the spec's shorthand: `/api/quotations/saveQuotation`, `fetchQuotations`, `fetchQuotationDetail`, `finaliseQuotation`, `reviseQuotation`, `rejectQuotation`, `deleteQuotation`, `ensureQuoteProfile`, `saveQuoteProfile`; `/api/leads/convertLead`.
2. **The profile is fetched by `sp_EnsureQuoteProfile`, which creates the branch's row when it is missing** (seeded from another branch of the same company). A fetch that writes, deliberately: a logo upload needs an `EntityId` before the user has saved anything.
3. **The profile's branch is the *lead's* branch**, not the caller's — a regional manager quoting for a Mumbai lead gets Mumbai's letterhead and GSTIN.
4. **Five report procs change, not six.** `sp_RptFollowUpCompliance` only uses the *active* set `('open','qualified')`, which is already right. The five: `sp_RptFunnel`, `sp_RptLeaderboard`, `sp_RptPipelineValue`, `sp_RptLost`, `sp_RptAging`.
5. **`sp_FetchQuotations` hides `superseded` rows unless asked for them** (`@Status = 'superseded'`), so the list shows one row per live quote rather than every revision.
6. **The seller's state is always `LEFT(SellerGSTIN, 2)`.** The SP derives it and ignores whatever the client sent; with no GSTIN there is no tax and the state is whatever the profile holds.
7. **Won is offered *in the status dropdown*** (what the owner asked for) **and still never goes through `setLeadStatus`** (what the engine requires): picking it opens `WonDialog`, which posts to `convertLead`. `LeadDetail.jsx`'s filter that hides `converted` is removed and its comment rewritten.
8. **Lead quotations are a fourth tab on the lead page** (`Details · Follow-ups · Quotations · History`), not a card inside Details — the page is already tabbed and the tab badge shows the count.
9. **`sp_SaveCustomer`'s two `LIKE '%[^0-9+]%'` checks become the 10-digit rule**, so a bad number is a 400 with a sentence, not a constraint violation. `sp_SaveLead` is untouched — the backend normalises before it and the `CHECK` stands behind it.
10. **Quote activity rows use `Type = 'quotation'`**; `Timeline.jsx` gains one icon-map entry. The conversion itself logs as `Type = 'status'` like every other status move.
11. **A lead that has any quotation cannot be deleted** (`sp_DeleteLead` → 409). The house rule is *no DB-level FKs on leads — integrity lives in SPs*, and `sp_DeleteLead` clears children by hand; an issued quotation is a business record, and silently deleting drafts would orphan their uploaded images. The user deletes the drafts first.
12. **Highlighting a whole paragraph paints the full line width in the PDF** (the converter renders a lone styled `<span>` as a block). Cosmetic; recorded as a check in the live pass (Task 22), not fixed here.

---

## Contracts (every task obeys these names exactly)

### SQL — `backend/sql/091_quotations.sql`, section order
```
-- ===== 1. Mobile numbers: data fix + CHECK constraints
-- ===== 2. New columns (tblLeads, tblProduct, tblCustomer) + 'Won' lookup seed
-- ===== 3. New tables (tblQuotation, tblQuotationLine, tblQuotationCounter, tblQuoteProfile)
-- ===== 4. Attachments: sp_SaveAttachment entity whitelist
-- ===== 5. Procedures — quote profile (sp_EnsureQuoteProfile, sp_FetchQuoteProfileById, sp_SaveQuoteProfile)
-- ===== 6. Procedures — quotations (sp_SaveQuotation, sp_FinaliseQuotation, sp_ReviseQuotation, sp_RejectQuotation, sp_DeleteQuotation, sp_FetchQuotations, sp_FetchQuotationDetail)
-- ===== 7. Procedures — convert engine (sp_ConvertLead, sp_SetLeadStatus)
-- ===== 8. Procedures — altered reads/writes (sp_FetchLeads, sp_FetchLeadDetail, sp_DeleteLead, sp_SaveCustomer, sp_FetchCustomers, sp_FetchCustomerDetail, sp_SaveProduct, sp_FetchProducts, sp_SaveLookup, sp_DeleteLookup)
-- ===== 9. Reports + dashboard (sp_RptFunnel, sp_RptLeaderboard, sp_RptPipelineValue, sp_RptLost, sp_RptAging, sp_Dashboard)
-- ===== 10. Menu: Quotations under Sales, grants cloned from Leads
-- ===== 11. Verify
```
Task 1 writes the file with **all eleven marker lines** and fills 1–4, 10, 11. Task 2 fills 5–6. Task 3 fills 7–9 and appends the fixture block to 11. A later task never touches an earlier task's section.

Every SP: `CREATE OR ALTER PROC dbo.<name>`, `SET NOCOUNT ON`, `GO` between batches. Mutating SPs return exactly one row `Id, ResponseCode, ResponseMess` (`sp_FinaliseQuotation` adds `QuoteNo`; `sp_ConvertLead` adds `CustomerId, WonValue`).

### SP signatures
```
sp_EnsureQuoteProfile     @CompId INT, @BranchId INT, @UserId INT                         → RS1 one profile row
sp_FetchQuoteProfileById  @CompId INT, @ProfileId INT                                     → RS1 one profile row | none
sp_SaveQuoteProfile       @CompId, @BranchId, @UserId INT, @IsAdmin BIT,
                          @CompanyName NVARCHAR(200), @Address NVARCHAR(500), @City NVARCHAR(100),
                          @StateCode CHAR(2), @Pincode VARCHAR(10), @GSTIN VARCHAR(15), @Phone VARCHAR(30),
                          @Email NVARCHAR(200), @Website NVARCHAR(200), @BankDetails NVARCHAR(1000),
                          @DefaultIntro NVARCHAR(MAX), @DefaultTerms NVARCHAR(MAX), @SignatoryName NVARCHAR(200),
                          @LogoAttachmentId BIGINT, @HeaderAttachmentId BIGINT, @AccentColor VARCHAR(7),
                          @DefaultTemplate VARCHAR(30)                                    → status row (403 when IsSet=1 and @IsAdmin=0)
sp_SaveQuotation          @Id INT=0, @CompId, @UserId, @LeadId INT, @TemplateCode VARCHAR(30),
                          @QuoteDate DATE, @ValidTill DATE, @Subject NVARCHAR(300),
                          @ToName NVARCHAR(200), @ToCompany NVARCHAR(200), @ToMobile VARCHAR(20), @ToEmail NVARCHAR(200),
                          @ToAddress NVARCHAR(500), @ToCity NVARCHAR(100), @ToStateCode CHAR(2), @ToPincode VARCHAR(10),
                          @ToGSTIN VARCHAR(15), @SellerGSTIN VARCHAR(15), @SellerStateCode CHAR(2),
                          @CompanyJSON NVARCHAR(MAX), @ContentJSON NVARCHAR(MAX), @LinesJSON NVARCHAR(MAX) → status row
sp_FinaliseQuotation      @CompId, @QuotationId, @UserId                                  → status row + QuoteNo
sp_ReviseQuotation        @CompId, @QuotationId, @UserId                                  → status row (Id = the new or the existing draft)
sp_RejectQuotation        @CompId, @QuotationId, @UserId, @Remarks NVARCHAR(500)=NULL      → status row
sp_DeleteQuotation        @CompId, @QuotationId                                           → status row
sp_FetchQuotations        @CompId, @PageNumber=1, @PageSize=25, @SearchTerm, @Status VARCHAR(20), @OwnerId, @BranchId,
                          @LeadId, @FromDate DATE, @ToDate DATE, @UserId, @AccessibleBranchIdsJson, @OwnerIdsJson → RS1 page · RS2 pagination
sp_FetchQuotationDetail   @CompId, @QuotationId                                           → RS1 header · RS2 lines · RS3 revisions
sp_ConvertLead            @CompId, @LeadId, @UserId, @WonValue DECIMAL(18,2)=NULL,
                          @Remarks NVARCHAR(500)=NULL, @QuotationId INT=NULL              → status row + CustomerId, WonValue
```
`sp_FetchQuotationDetail` RS1 **must** expose the *lead's* `OwnerId`, `BranchId`, `CreatedBy` under exactly those names (`permission.canSeeRecord` reads them); the quote's own creator is `QuoteCreatedBy`.

`@LinesJSON` element (camelCase, the web's shape): `{ "productId": 7|null, "description": "…", "hsn": "8541", "qty": 1, "unit": "Nos", "rate": 280000, "discountType": "pct"|"amt", "discountValue": 0, "taxPct": 12 }`.

`CompanyJSON`: `{ "name", "address", "city", "stateCode", "pincode", "gstin", "phone", "email", "website", "bank", "signatory", "logoAttachmentId": 12|null, "headerAttachmentId": 13|null, "showLogo": true, "showHeader": true, "accent": "#1e3a8a" }`.

`ContentJSON`: `{ "intro": "<p>…</p>", "terms": "<p>…</p>", "notes": "<p>…</p>", "sections": [ { "type": "text", "title": "…", "body": "<p>…</p>" } | { "type": "images", "title": "…", "items": [ { "attachmentId": 21, "caption": "…" } ] } ] }`.

### The fixture table (web `quoteMath.test.js` ⇄ `091` §11)
Seller GSTIN `24ABCDE1234F1Z5` unless stated.

| # | Lines (qty × rate, discount, GST %) | Buyer | Taxable | CGST | SGST | IGST | Round-off | Grand |
|---|---|---|---|---|---|---|---|---|
| F1 | 1 × 280000, ₹10000 off, 12 % | 24 | 270000.00 | 16200.00 | 16200.00 | 0 | 0.00 | 302400 |
| F2 | same | 27 | 270000.00 | 0 | 0 | 32400.00 | 0.00 | 302400 |
| F3 | 2 × 1500, none, 18 % — **seller has no GSTIN** | 24 | 3000.00 | 0 | 0 | 0 | 0.00 | 3000 |
| F4 | 1 × 100.10, none, 5 % | 24 | 100.10 | 2.51 | 2.50 | 0 | −0.11 | 105 |
| F5 | 2.5 × 1234.56, 7.5 % off, 18 % **+** 3 × 99.99, none, 28 % | 24 | 3154.89 | 298.95 | 298.93 | 0 | 0.23 | 3753 |

Rounding is half away from zero at every step: `Gross = ROUND(Qty×Rate, 2)` · `Discount = pct ? ROUND(Gross×v/100, 2) : MIN(v, Gross)` · `Tax = ROUND(Taxable×TaxPct/100, 2)` · `CGST = ROUND(Tax/2, 2)`, `SGST = Tax − CGST` (the odd paisa always lands on CGST) · `Grand = ROUND(Σ LineTotal, 0)`.

### Backend
- Routers: `/api/quotations` (new, `routes/quotationRoutes.js`), `/api/leads/convertLead` (added to `leadRoutes.js`).
- `utils/mobile.js` exports `normalizeMobile(raw) → "9825012345" | null` and `MOBILE_MESSAGE = "Mobile number must be 10 digits"`.
- `permission.ENTITY_LOOKUP` gains `quotation: { sp: "sp_FetchQuotationDetail", idParam: "QuotationId", ownerField: "OwnerId" }` and `quoteprofile: { sp: "sp_FetchQuoteProfileById", idParam: "ProfileId", companyWide: true }`.
- `TEMPLATE_CODES = ["classic", "modern", "minimal"]`; `MAX_HTML = 200 * 1024` per rich-text block; `MAX_LINES = 200`.

### Web — request bodies (keys exact)
```
saveQuotation      { Id, LeadId, TemplateCode, QuoteDate, ValidTill, Subject,
                     ToName, ToCompany, ToMobile, ToEmail, ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN,
                     Company: {…CompanyJSON}, Content: {…ContentJSON}, Lines: [ …LinesJSON elements ] }
fetchQuotations    { PageNumber, PageSize, SearchTerm, Status, OwnerId, BranchId, LeadId, FromDate, ToDate }
fetchQuotationDetail / finaliseQuotation / reviseQuotation / deleteQuotation   { QuotationId }
rejectQuotation    { QuotationId, Remarks }
ensureQuoteProfile { LeadId }
saveQuoteProfile   { LeadId, …the sp_SaveQuoteProfile fields (no CompId/BranchId/UserId/IsAdmin) }
convertLead        { LeadId, WonValue, Remarks, QuotationId }
```
Responses: `fetchQuotations → { quotations, pagination }` · `fetchQuotationDetail → { quotation, lines, revisions }` · `ensureQuoteProfile → { profile }`.

---

## File structure

```
backend/sql/091_quotations.sql                                  NEW   Tasks 1–3
backend/src/utils/mobile.js                                     NEW   Task 4
backend/src/controllers/leadController.js                       EDIT  Tasks 4, 8
backend/src/controllers/customerController.js                   EDIT  Tasks 4, 8
backend/src/controllers/productController.js                    EDIT  Task 8
backend/src/middleware/permission.js                            EDIT  Task 5
backend/src/middleware/upload.js                                EDIT  Task 5
backend/src/controllers/attachmentController.js                 EDIT  Task 5
backend/src/controllers/quotationController.js                  NEW   Tasks 6, 7
backend/src/routes/quotationRoutes.js                           NEW   Tasks 6, 7
backend/src/routes/leadRoutes.js                                EDIT  Task 8
backend/src/config/routes.js                                    EDIT  Task 6
backend/tests/unit/…                                            mirrors the above

web/package.json                                                EDIT  Task 10
web/src/assets/fonts/{Inter,NotoSerif}-{Regular,Italic,Bold,BoldItalic}.ttf   NEW   Task 10
web/src/assets/quote/{sample-logo.png,sample-header.png}        NEW   Task 10
web/src/utils/mobile.js                                         NEW   Task 10
web/src/components/ui/MobileInput.jsx                           NEW   Task 10
web/src/components/ui/RichTextEditor.jsx                        NEW   Task 12
web/src/components/ui/richTextExtensions.js                     NEW   Task 12
web/src/components/ui/richTextHtml.js                            NEW   Task 12
web/src/components/ui/index.js                                  EDIT  Tasks 10, 12
web/src/index.css                                               EDIT  Task 12  (editor content styles)
web/src/api/quotationQueries.js                                 NEW   Task 13
web/src/test/reactPdfMock.jsx                                   NEW   Task 13
web/src/test/mocks/handlers.js                                  EDIT  Task 13  (default fetchQuotations)
web/src/pages/Sales/Quotations/
  gst.js · quoteMath.js · amountInWords.js · finYear.js         NEW   Task 11
  buildQuoteDoc.js                                              NEW   Task 13
  pdf/fonts.js · fontSources.js · RichHtml.jsx · parts.jsx      NEW   Task 13
  templates/classic.jsx · modern.jsx · minimal.jsx · index.js   NEW   Task 14
  usePdfPreview.js                                              NEW   Task 14
  quoteForm.js · useQuoteImages.js                              NEW   Task 15A
  builder/ImageSlot · LinesEditor · SectionsEditor              NEW   Task 15A
  builder/PdfPreview · LookSection · PartySections              NEW   Task 15B
  QuotationBuilder.jsx                                          NEW   Task 15B
  WonDialog.jsx · LeadQuotations.jsx                            NEW   Task 16
  QuotationList.jsx                                             NEW   Task 17
web/src/pages/Sales/LeadCreateModal.jsx                         EDIT  Task 10
web/src/pages/Sales/LeadDetail.jsx · leadStatus.js · Leads.jsx · Timeline.jsx   EDIT  Task 16
web/src/pages/Support/CustomerFormModal.jsx                     EDIT  Task 10
web/src/pages/Settings/Products.jsx · LookupMaster.jsx          EDIT  Task 18
web/src/components/Dashboard.jsx                                EDIT  Task 18
web/src/App.jsx · App.routes.test.jsx                            EDIT  Tasks 15B, 17
web/src/utils/menuBuilder.js                                     EDIT  Task 17  (menu icon)

mobile/src/features/support/ComplaintFormScreen.tsx             EDIT  Task 20
CLAUDE.md · backend/ROLES.md                                    EDIT  Task 21
docs/testing/<date>-quotations-live-test-report.md              NEW   Task 22
```

## Task index

| # | Task | Model tier |
|---|---|---|
| 1 | `091` part A — mobiles, columns, Won seed, tables, attachment whitelist, menu, verify shell | capable |
| 2 | `091` part B — profile + quotation procs | capable |
| 3 | `091` part C — convert engine, altered procs, reports, dashboard, fixture verify | most capable |
| 4 | Backend `utils/mobile.js`; lead + customer saves normalise | cheap |
| 5 | `permission.js` entities · `upload.js` · attachment guards | standard |
| 6 | `quotationController` save / fetch / detail + routes + registration | standard |
| 7 | `quotationController` finalise / revise / reject / delete + profile | standard |
| 8 | `leadController.convert` · product tax fields · customer GSTIN | cheap |
| 9 | **Gate:** backend whole suite + live contract check after the owner applies `091` | standard |
| 10 | Web deps, fonts, sample art, `utils/mobile` + `ui/MobileInput`, wired into lead + customer forms | standard |
| 11 | Pure modules: `gst` · `quoteMath` · `amountInWords` · `finYear` | cheap (code is complete below) |
| 12 | `ui/RichTextEditor` + the closed-toolbar guard | capable |
| 13 | `quotationQueries` · `buildQuoteDoc` · PDF fonts / `RichHtml` / parts · `reactPdfMock` | capable |
| 14 | Three templates + registry + `usePdfPreview` | capable |
| 15A | Builder blocks: `quoteForm` · `useQuoteImages` · `ImageSlot` · `LinesEditor` · `SectionsEditor` | capable |
| 15B | `QuotationBuilder` page + route | most capable |
| 16 | `WonDialog` · lead page (Won in dropdown, Quotations tab, won banner) · Won preset · timeline icon | capable |
| 17 | `QuotationList` page + route | standard |
| 18 | Products tax fields · `LookupMaster` Won lock · dashboard "Won this month" | standard |
| 19 | **Gate:** web whole suite, lint, build | standard |
| 20 | Mobile: 10-digit mobile field; typecheck + lint | cheap |
| 21 | Docs: `CLAUDE.md`, `ROLES.md`, Notion, deploy commands | standard |
| 22 | Live verification pass → `docs/testing/` report | most capable |

---

### Task 1: `091` part A — mobiles, columns, Won seed, tables, attachment whitelist, menu, verify shell (sections 1–4, 10, 11)

**Files:**
- Create: `backend/sql/091_quotations.sql`

**Interfaces:**
- Consumes: the live schema (`tblLeads`, `tblCustomer`, `tblProduct`, `tblLookup`, `tblMenu`, `tblGroupAccess`, `tblAttachment`, `sp_SaveAttachment`).
- Produces: tables `tblQuotation`, `tblQuotationLine`, `tblQuotationCounter`, `tblQuoteProfile`; columns `tblLeads.WonValue`, `tblLeads.CustomerId`, `tblProduct.HSNCode/TaxPct/Unit/Description`, `tblCustomer.GSTIN`; a `lead_status` row `Value='Won'`, `Code='converted'` per company; menu `Route='/sales/quotations'`; the eleven section marker lines Tasks 2 and 3 fill.

There is no test runner for SQL and you must not apply it. Your proof is: (a) the pre-flight reads below return what this task says they return, and (b) the file is internally consistent. Read every statement once more before reporting.

- [ ] **Step 1: Pre-flight — confirm the live facts this script depends on**

Run each with `mcp__sqlserver-ecrm__read_query`. If any differs, **stop and report BLOCKED** — do not adapt the script on your own.

```sql
-- 1. none of the new objects exist yet                       → expect 0 rows
SELECT name FROM sys.tables WHERE name IN ('tblQuotation','tblQuotationLine','tblQuotationCounter','tblQuoteProfile');
-- 2. none of the new columns exist yet                       → expect 0 rows
SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME='tblLeads' AND COLUMN_NAME IN ('WonValue','CustomerId'))
   OR (TABLE_NAME='tblProduct' AND COLUMN_NAME IN ('HSNCode','TaxPct','Unit','Description'))
   OR (TABLE_NAME='tblCustomer' AND COLUMN_NAME='GSTIN');
-- 3. no company has a converted status yet                    → expect 0 rows
SELECT CompId, Id, Value FROM dbo.tblLookup WHERE Kind='lead_status' AND Code='converted';
-- 4. the attachment SP still hard-codes three entities       → expect 1 row
SELECT 1 AS found FROM sys.sql_modules WHERE object_id = OBJECT_ID('dbo.sp_SaveAttachment')
  AND definition LIKE '%@Entity NOT IN (''task'',''ticket'',''lead'')%';
-- 5. the menu anchors exist                                  → expect 2 rows
SELECT Id, Route FROM dbo.tblMenu WHERE Route IN (N'/sales', N'/sales/leads');
-- 6. the bad mobiles are the ones this plan knows about      → expect 5 rows: Ids 1, 2, 3, 19, 28
SELECT Id, Mobile FROM dbo.tblCustomer WHERE Mobile IS NOT NULL AND Mobile <> ''
  AND Mobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';
```

- [ ] **Step 2: Write the file**

Create `backend/sql/091_quotations.sql` with exactly this content. Sections 5–9 are marker lines only; Tasks 2 and 3 fill them.

```sql
-- =============================================================================
-- 091_quotations.sql
--
-- Purpose : Spec 3 — quotations and the lead convert engine.
--           docs/superpowers/specs/2026-09-18-quotations-design.md
--
--             * A mobile number becomes exactly 10 digits, everywhere:
--               existing rows are repaired (or parked in Remarks when they
--               cannot be), then CHECK constraints hold the line.
--             * tblQuotation / tblQuotationLine / tblQuotationCounter /
--               tblQuoteProfile; WonValue + CustomerId on leads; HSN / GST % /
--               unit / description on products; GSTIN on customers.
--             * A "Won" lead status under the `converted` code the engine has
--               whitelisted since 071 and never had a row for.
--             * sp_ConvertLead — the proc sp_SetLeadStatus has been telling
--               callers to use ("Use convert to move a lead to Converted")
--               and which did not exist.
--             * Seven quotation procs, three profile procs.
--             * Five report procs learn that success has two codes.
--
-- Target  : EVERY client database, one at a time — today [eCRM+] and
--           [SolarCRM]. There is deliberately NO `USE` here: select the
--           database in your client, run, then repeat for the next one.
--           Menu and lookup rows are found by Route / Kind + Code, never by
--           Id, because Ids differ between the two.
--
-- Safe to re-run: every ALTER is guarded, every proc is CREATE OR ALTER, every
--           seed is IF NOT EXISTS, and the mobile repair only touches rows
--           that still need it.
--
-- After   : deploy the backend (both services), then the web build. Users must
--           log in again to see the Quotations menu row — menu rights load at
--           login.
-- =============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO


-- ===== 1. Mobile numbers: data fix + CHECK constraints
-- ---------------------------------------------------------------------------
-- Nothing has ever enforced a shape. sp_SaveLead stores what it is given;
-- sp_SaveCustomer strips spaces and dashes but accepts '+' and any length. The
-- convert engine (§7) is about to de-duplicate customers on this column, so it
-- has to mean one thing: ten digits.
--
--   normalise = strip + space - ( ) .   →   drop a leading 91 from 12 digits,
--               or a leading 0 from 11   →   must now be exactly 10 digits
--
-- A row that normalises is rewritten. A row that cannot be (or that would
-- collide with another live customer) keeps its record: the old value moves
-- into Remarks and the column becomes NULL, which both tables already allow.
-- Nothing is deleted and nothing is guessed.
-- ---------------------------------------------------------------------------
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @Ten VARCHAR(60) = REPLICATE('[0-9]', 10);

    -- Blank strings are not mobiles.
    UPDATE dbo.tblCustomer SET Mobile    = NULL WHERE Mobile    IS NOT NULL AND LTRIM(RTRIM(Mobile))    = '';
    UPDATE dbo.tblCustomer SET AltMobile = NULL WHERE AltMobile IS NOT NULL AND LTRIM(RTRIM(AltMobile)) = '';
    UPDATE dbo.tblLeads    SET MobileNo  = NULL WHERE MobileNo  IS NOT NULL AND LTRIM(RTRIM(MobileNo))  = '';
    UPDATE dbo.tblLeads    SET AltMobile = NULL WHERE AltMobile IS NOT NULL AND LTRIM(RTRIM(AltMobile)) = '';

    -- 1.1 tblCustomer.Mobile — the only one of the four with a uniqueness rule.
    IF OBJECT_ID('tempdb..#cm') IS NOT NULL DROP TABLE #cm;
    SELECT c.Id, c.CompId, c.IsActive, c.Mobile AS OldVal, n.d AS NewVal,
           CAST(CASE WHEN n.d LIKE @Ten THEN 1 ELSE 0 END AS BIT) AS Fixable
    INTO #cm
    FROM dbo.tblCustomer c
    CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        LTRIM(RTRIM(c.Mobile)), '+',''), ' ',''), '-',''), '(',''), ')',''), '.','') AS d0) s
    CROSS APPLY (SELECT CASE WHEN LEN(s.d0) = 12 AND LEFT(s.d0, 2) = '91' THEN RIGHT(s.d0, 10)
                             WHEN LEN(s.d0) = 11 AND LEFT(s.d0, 1) = '0'  THEN RIGHT(s.d0, 10)
                             ELSE s.d0 END AS d) n
    WHERE c.Mobile IS NOT NULL;

    -- A rewrite collides when another LIVE customer of the same company already
    -- holds (or, with a lower Id, is about to hold) the normalised number.
    IF OBJECT_ID('tempdb..#cmCollide') IS NOT NULL DROP TABLE #cmCollide;
    SELECT x.Id,
           (SELECT MIN(y.Id) FROM #cm y
             WHERE y.CompId = x.CompId AND y.IsActive = 1 AND y.Id <> x.Id AND y.Fixable = 1
               AND y.NewVal = x.NewVal AND (y.OldVal = y.NewVal OR y.Id < x.Id)) AS KeeperId
    INTO #cmCollide
    FROM #cm x
    WHERE x.IsActive = 1 AND x.Fixable = 1 AND x.OldVal <> x.NewVal;
    DELETE FROM #cmCollide WHERE KeeperId IS NULL;

    -- Rewrite the clean ones.
    UPDATE c SET c.Mobile = m.NewVal
    FROM dbo.tblCustomer c
    JOIN #cm m ON m.Id = c.Id
    WHERE m.Fixable = 1 AND m.OldVal <> m.NewVal
      AND NOT EXISTS (SELECT 1 FROM #cmCollide k WHERE k.Id = c.Id);

    -- Park the rest: unfixable, or a duplicate of another customer.
    UPDATE c
    SET c.Remarks = LTRIM(ISNULL(c.Remarks + CHAR(13) + CHAR(10), N'')
                  + CASE WHEN k.Id IS NOT NULL
                         THEN N'Mobile on record was ' + m.OldVal + N' — the same number as customer #' + CAST(k.KeeperId AS NVARCHAR(12)) + N'; please merge.'
                         ELSE N'Mobile on record was ' + m.OldVal + N' — invalid, please correct.' END),
        c.Mobile = NULL
    FROM dbo.tblCustomer c
    JOIN #cm m ON m.Id = c.Id
    LEFT JOIN #cmCollide k ON k.Id = c.Id
    WHERE m.Fixable = 0 OR k.Id IS NOT NULL;

    -- 1.2 The three columns with no uniqueness rule: rewrite or park, one pass each.
    UPDATE c SET
        c.Remarks   = CASE WHEN n.d LIKE @Ten THEN c.Remarks
                           ELSE LTRIM(ISNULL(c.Remarks + CHAR(13) + CHAR(10), N'') + N'Alternate mobile on record was ' + c.AltMobile + N' — invalid, please correct.') END,
        c.AltMobile = CASE WHEN n.d LIKE @Ten THEN n.d ELSE NULL END
    FROM dbo.tblCustomer c
    CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        LTRIM(RTRIM(c.AltMobile)), '+',''), ' ',''), '-',''), '(',''), ')',''), '.','') AS d0) s
    CROSS APPLY (SELECT CASE WHEN LEN(s.d0) = 12 AND LEFT(s.d0, 2) = '91' THEN RIGHT(s.d0, 10)
                             WHEN LEN(s.d0) = 11 AND LEFT(s.d0, 1) = '0'  THEN RIGHT(s.d0, 10)
                             ELSE s.d0 END AS d) n
    WHERE c.AltMobile IS NOT NULL AND c.AltMobile NOT LIKE @Ten;

    UPDATE l SET
        l.Remarks  = CASE WHEN n.d LIKE @Ten THEN l.Remarks
                          ELSE LTRIM(ISNULL(l.Remarks + CHAR(13) + CHAR(10), N'') + N'Mobile on record was ' + l.MobileNo + N' — invalid, please correct.') END,
        l.MobileNo = CASE WHEN n.d LIKE @Ten THEN n.d ELSE NULL END
    FROM dbo.tblLeads l
    CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        LTRIM(RTRIM(l.MobileNo)), '+',''), ' ',''), '-',''), '(',''), ')',''), '.','') AS d0) s
    CROSS APPLY (SELECT CASE WHEN LEN(s.d0) = 12 AND LEFT(s.d0, 2) = '91' THEN RIGHT(s.d0, 10)
                             WHEN LEN(s.d0) = 11 AND LEFT(s.d0, 1) = '0'  THEN RIGHT(s.d0, 10)
                             ELSE s.d0 END AS d) n
    WHERE l.MobileNo IS NOT NULL AND l.MobileNo NOT LIKE @Ten;

    UPDATE l SET
        l.Remarks   = CASE WHEN n.d LIKE @Ten THEN l.Remarks
                           ELSE LTRIM(ISNULL(l.Remarks + CHAR(13) + CHAR(10), N'') + N'Alternate mobile on record was ' + l.AltMobile + N' — invalid, please correct.') END,
        l.AltMobile = CASE WHEN n.d LIKE @Ten THEN n.d ELSE NULL END
    FROM dbo.tblLeads l
    CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        LTRIM(RTRIM(l.AltMobile)), '+',''), ' ',''), '-',''), '(',''), ')',''), '.','') AS d0) s
    CROSS APPLY (SELECT CASE WHEN LEN(s.d0) = 12 AND LEFT(s.d0, 2) = '91' THEN RIGHT(s.d0, 10)
                             WHEN LEN(s.d0) = 11 AND LEFT(s.d0, 1) = '0'  THEN RIGHT(s.d0, 10)
                             ELSE s.d0 END AS d) n
    WHERE l.AltMobile IS NOT NULL AND l.AltMobile NOT LIKE @Ten;

    -- What was parked, for whoever runs this: fix these by hand in the app.
    SELECT 'customer mobile parked' AS what, m.Id, m.OldVal, k.KeeperId AS DuplicateOfCustomer
    FROM #cm m LEFT JOIN #cmCollide k ON k.Id = m.Id
    WHERE m.Fixable = 0 OR k.Id IS NOT NULL;

    -- 1.3 Hold the line.
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblCustomer_Mobile')
        ALTER TABLE dbo.tblCustomer WITH CHECK ADD CONSTRAINT CK_tblCustomer_Mobile
            CHECK (Mobile IS NULL OR Mobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblCustomer_AltMobile')
        ALTER TABLE dbo.tblCustomer WITH CHECK ADD CONSTRAINT CK_tblCustomer_AltMobile
            CHECK (AltMobile IS NULL OR AltMobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblLeads_MobileNo')
        ALTER TABLE dbo.tblLeads WITH CHECK ADD CONSTRAINT CK_tblLeads_MobileNo
            CHECK (MobileNo IS NULL OR MobileNo LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblLeads_AltMobile')
        ALTER TABLE dbo.tblLeads WITH CHECK ADD CONSTRAINT CK_tblLeads_AltMobile
            CHECK (AltMobile IS NULL OR AltMobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m1 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('091 §1 mobile repair ABORTED — %s', 16, 1, @m1);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 2. New columns (tblLeads, tblProduct, tblCustomer) + 'Won' lookup seed
-- ---------------------------------------------------------------------------
-- WonValue is what reports read for revenue. An accepted quotation fills it
-- with its before-tax total; a lead won without a quotation gets what the
-- agent typed. Reports never need to know which.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblLeads', 'WonValue')   IS NULL ALTER TABLE dbo.tblLeads ADD WonValue   DECIMAL(18,2) NULL;
IF COL_LENGTH('dbo.tblLeads', 'CustomerId') IS NULL ALTER TABLE dbo.tblLeads ADD CustomerId INT           NULL;

IF COL_LENGTH('dbo.tblProduct', 'HSNCode')     IS NULL ALTER TABLE dbo.tblProduct ADD HSNCode     VARCHAR(10)   NULL;
IF COL_LENGTH('dbo.tblProduct', 'TaxPct')      IS NULL ALTER TABLE dbo.tblProduct ADD TaxPct      DECIMAL(5,2)  NULL;
IF COL_LENGTH('dbo.tblProduct', 'Unit')        IS NULL ALTER TABLE dbo.tblProduct ADD Unit        VARCHAR(20)   NULL;
IF COL_LENGTH('dbo.tblProduct', 'Description') IS NULL ALTER TABLE dbo.tblProduct ADD Description NVARCHAR(500) NULL;

IF COL_LENGTH('dbo.tblCustomer', 'GSTIN') IS NULL ALTER TABLE dbo.tblCustomer ADD GSTIN VARCHAR(15) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_CompId_CustomerId' AND object_id = OBJECT_ID('dbo.tblLeads'))
    CREATE INDEX IX_tblLeads_CompId_CustomerId ON dbo.tblLeads (CompId, CustomerId) WHERE CustomerId IS NOT NULL;
GO

-- 2.1 "Won", under the code sp_SaveLookup has whitelisted since 071. It sorts
--     directly after the company's Qualified row; everything after it moves
--     down one. Companies that already have a live `converted` row are skipped.
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('tempdb..#won') IS NOT NULL DROP TABLE #won;
    SELECT CompId,
           ISNULL(MAX(CASE WHEN Code = 'qualified' THEN SortOrder END), MAX(SortOrder)) AS AfterSort
    INTO #won
    FROM dbo.tblLookup
    WHERE Kind = 'lead_status' AND IsActive = 1
    GROUP BY CompId
    HAVING SUM(CASE WHEN Code = 'converted' THEN 1 ELSE 0 END) = 0;

    UPDATE lk SET lk.SortOrder = lk.SortOrder + 1
    FROM dbo.tblLookup lk JOIN #won w ON w.CompId = lk.CompId
    WHERE lk.Kind = 'lead_status' AND lk.SortOrder > w.AfterSort;

    INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive, Code, TatHours)
    SELECT w.CompId, 'lead_status', N'Won', w.AfterSort + 1, 1, 'converted', NULL FROM #won w;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m2 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('091 §2 Won seed ABORTED — %s', 16, 1, @m2);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 3. New tables (tblQuotation, tblQuotationLine, tblQuotationCounter, tblQuoteProfile)
-- ---------------------------------------------------------------------------
-- tblQuotation has NO BranchId and NO OwnerId on purpose. A quotation is part
-- of its lead: visibility is read through the join, so a transferred lead
-- carries its quotations with it and there is no second copy to go stale.
--
-- No FK to tblLeads either — leads carry no DB-level FKs (integrity lives in
-- the SPs; see sp_DeleteLead, which §8 teaches to refuse a lead that has
-- quotations). Lines DO cascade from their quotation: they have no life
-- outside it.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblQuotation') IS NULL
BEGIN
    CREATE TABLE dbo.tblQuotation (
        Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblQuotation PRIMARY KEY,
        CompId          INT            NOT NULL,
        LeadId          INT            NOT NULL,
        CustomerId      INT            NULL,           -- stamped when accepted
        RootId          INT            NOT NULL,       -- Id of revision 1 (its own Id for R1)
        Revision        INT            NOT NULL CONSTRAINT DF_tblQuotation_Revision DEFAULT (1),
        FinYear         CHAR(4)        NULL,           -- NULL while draft
        SeqNo           INT            NULL,
        QuoteNo         VARCHAR(30)    NULL,
        TemplateCode    VARCHAR(30)    NOT NULL,
        Status          VARCHAR(20)    NOT NULL CONSTRAINT DF_tblQuotation_Status DEFAULT ('draft'),
        QuoteDate       DATE           NOT NULL,
        ValidTill       DATE           NULL,
        Subject         NVARCHAR(300)  NULL,
        ToName          NVARCHAR(200)  NOT NULL,
        ToCompany       NVARCHAR(200)  NULL,
        ToMobile        VARCHAR(20)    NULL,
        ToEmail         NVARCHAR(200)  NULL,
        ToAddress       NVARCHAR(500)  NULL,
        ToCity          NVARCHAR(100)  NULL,
        ToStateCode     CHAR(2)        NULL,           -- place of supply
        ToPincode       VARCHAR(10)    NULL,
        ToGSTIN         VARCHAR(15)    NULL,
        SellerGSTIN     VARCHAR(15)    NULL,           -- NULL = unregistered = no tax
        SellerStateCode CHAR(2)        NULL,
        CompanyJSON     NVARCHAR(MAX)  NULL,
        ContentJSON     NVARCHAR(MAX)  NULL,
        SubTotal        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_SubTotal      DEFAULT (0),
        DiscountTotal   DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_DiscountTotal DEFAULT (0),
        TaxableTotal    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_TaxableTotal  DEFAULT (0),
        CgstTotal       DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_CgstTotal     DEFAULT (0),
        SgstTotal       DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_SgstTotal     DEFAULT (0),
        IgstTotal       DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_IgstTotal     DEFAULT (0),
        RoundOff        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_RoundOff      DEFAULT (0),
        GrandTotal      DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_GrandTotal    DEFAULT (0),
        FinalisedAt     DATETIME       NULL,
        FinalisedBy     INT            NULL,
        ClosedAt        DATETIME       NULL,           -- accepted / rejected / unused / superseded
        ClosedBy        INT            NULL,
        CloseRemarks    NVARCHAR(500)  NULL,
        CreatedBy       INT            NULL,
        CreatedAt       DATETIME       NOT NULL CONSTRAINT DF_tblQuotation_CreatedAt DEFAULT (GETDATE()),
        EditBy          INT            NULL,
        UpdatedAt       DATETIME       NULL,
        CONSTRAINT CK_tblQuotation_Status CHECK (Status IN ('draft','final','accepted','rejected','superseded','unused'))
    );
    CREATE INDEX IX_tblQuotation_CompId_LeadId ON dbo.tblQuotation (CompId, LeadId);
    CREATE UNIQUE INDEX UX_tblQuotation_Root_Revision ON dbo.tblQuotation (CompId, RootId, Revision);
    CREATE UNIQUE INDEX UX_tblQuotation_Number ON dbo.tblQuotation (CompId, FinYear, SeqNo, Revision) WHERE SeqNo IS NOT NULL;
END
GO

IF OBJECT_ID('dbo.tblQuotationLine') IS NULL
BEGIN
    CREATE TABLE dbo.tblQuotationLine (
        Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblQuotationLine PRIMARY KEY,
        CompId        INT             NOT NULL,
        QuotationId   INT             NOT NULL
            CONSTRAINT FK_tblQuotationLine_Quotation REFERENCES dbo.tblQuotation (Id) ON DELETE CASCADE,
        SortOrder     INT             NOT NULL,
        ProductId     INT             NULL,            -- where the line was seeded from; the line itself is free text
        Description   NVARCHAR(1000)  NOT NULL,
        HSNCode       VARCHAR(10)     NULL,
        Qty           DECIMAL(18,3)   NOT NULL,
        Unit          VARCHAR(20)     NULL,
        Rate          DECIMAL(18,2)   NOT NULL,
        DiscountType  VARCHAR(3)      NOT NULL CONSTRAINT DF_tblQuotationLine_DiscountType DEFAULT ('pct'),
        DiscountValue DECIMAL(18,2)   NOT NULL CONSTRAINT DF_tblQuotationLine_DiscountValue DEFAULT (0),
        TaxPct        DECIMAL(5,2)    NOT NULL CONSTRAINT DF_tblQuotationLine_TaxPct DEFAULT (0),
        GrossAmt      DECIMAL(18,2)   NOT NULL,
        DiscountAmt   DECIMAL(18,2)   NOT NULL,
        TaxableAmt    DECIMAL(18,2)   NOT NULL,
        CgstAmt       DECIMAL(18,2)   NOT NULL,
        SgstAmt       DECIMAL(18,2)   NOT NULL,
        IgstAmt       DECIMAL(18,2)   NOT NULL,
        LineTotal     DECIMAL(18,2)   NOT NULL,
        CONSTRAINT CK_tblQuotationLine_DiscountType CHECK (DiscountType IN ('pct','amt'))
    );
    CREATE INDEX IX_tblQuotationLine_QuotationId ON dbo.tblQuotationLine (QuotationId, SortOrder);
END
GO

-- One counter per company per Indian financial year. Read WITH (UPDLOCK,
-- HOLDLOCK) inside sp_FinaliseQuotation's transaction.
IF OBJECT_ID('dbo.tblQuotationCounter') IS NULL
    CREATE TABLE dbo.tblQuotationCounter (
        CompId  INT     NOT NULL,
        FinYear CHAR(4) NOT NULL,
        LastNo  INT     NOT NULL CONSTRAINT DF_tblQuotationCounter_LastNo DEFAULT (0),
        CONSTRAINT PK_tblQuotationCounter PRIMARY KEY (CompId, FinYear)
    );
GO

-- "The template remembers." Per BRANCH, not per company: a Gujarat branch and a
-- Mumbai branch have different GSTINs, and one shared row would flip-flop with
-- every quotation. IsSet = 0 means nobody has filled it in yet — the first
-- person may; after that only an admin can change the default (spec §3).
IF OBJECT_ID('dbo.tblQuoteProfile') IS NULL
    CREATE TABLE dbo.tblQuoteProfile (
        Id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblQuoteProfile PRIMARY KEY,
        CompId             INT             NOT NULL,
        BranchId           INT             NOT NULL,
        CompanyName        NVARCHAR(200)   NULL,
        Address            NVARCHAR(500)   NULL,
        City               NVARCHAR(100)   NULL,
        StateCode          CHAR(2)         NULL,
        Pincode            VARCHAR(10)     NULL,
        GSTIN              VARCHAR(15)     NULL,
        Phone              VARCHAR(30)     NULL,
        Email              NVARCHAR(200)   NULL,
        Website            NVARCHAR(200)   NULL,
        BankDetails        NVARCHAR(1000)  NULL,
        DefaultIntro       NVARCHAR(MAX)   NULL,
        DefaultTerms       NVARCHAR(MAX)   NULL,
        SignatoryName      NVARCHAR(200)   NULL,
        LogoAttachmentId   BIGINT          NULL,
        HeaderAttachmentId BIGINT          NULL,
        AccentColor        VARCHAR(7)      NULL,
        DefaultTemplate    VARCHAR(30)     NULL,
        IsSet              BIT             NOT NULL CONSTRAINT DF_tblQuoteProfile_IsSet DEFAULT (0),
        CreatedBy          INT             NULL,
        CreatedAt          DATETIME        NOT NULL CONSTRAINT DF_tblQuoteProfile_CreatedAt DEFAULT (GETDATE()),
        EditBy             INT             NULL,
        UpdatedAt          DATETIME        NULL,
        CONSTRAINT UX_tblQuoteProfile_Comp_Branch UNIQUE (CompId, BranchId)
    );
GO


-- ===== 4. Attachments: sp_SaveAttachment entity whitelist
-- ---------------------------------------------------------------------------
-- The SP hard-coded ('task','ticket','lead') and would refuse every quotation
-- image with 'Invalid entity'. Two more: a quotation's own pictures, and the
-- branch letterhead (logo + header) the profile points at.
-- Keep in step with ENTITIES in backend/src/middleware/upload.js.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveAttachment
    @Id         BIGINT = 0,
    @CompId     BIGINT,
    @Entity     VARCHAR(20),
    @EntityId   BIGINT,
    @FileName   NVARCHAR(400),
    @StoredName VARCHAR(200),
    @FileSize   BIGINT,
    @MimeType   VARCHAR(150) = NULL,
    @UploadedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Entity NOT IN ('task','ticket','lead','quotation','quoteprofile'))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid entity';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblAttachment (CompId, Entity, EntityId, FileName, StoredName, FileSize, MimeType, UploadedBy)
    VALUES (@CompId, @Entity, @EntityId, @FileName, @StoredName, @FileSize, @MimeType, @UploadedBy);

    SET @ResponseCode = 201; SET @ResponseMess = 'Attachment saved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           SCOPE_IDENTITY() AS AttachmentId;
END
GO


-- ===== 5. Procedures — quote profile (sp_EnsureQuoteProfile, sp_FetchQuoteProfileById, sp_SaveQuoteProfile)

-- ===== 6. Procedures — quotations (sp_SaveQuotation, sp_FinaliseQuotation, sp_ReviseQuotation, sp_RejectQuotation, sp_DeleteQuotation, sp_FetchQuotations, sp_FetchQuotationDetail)

-- ===== 7. Procedures — convert engine (sp_ConvertLead, sp_SetLeadStatus)

-- ===== 8. Procedures — altered reads/writes (sp_FetchLeads, sp_FetchLeadDetail, sp_DeleteLead, sp_SaveCustomer, sp_FetchCustomers, sp_FetchCustomerDetail, sp_SaveProduct, sp_FetchProducts, sp_SaveLookup, sp_DeleteLookup)

-- ===== 9. Reports + dashboard (sp_RptFunnel, sp_RptLeaderboard, sp_RptPipelineValue, sp_RptLost, sp_RptAging, sp_Dashboard)


-- ===== 10. Menu: Quotations under Sales, grants cloned from Leads
-- ---------------------------------------------------------------------------
-- DISTINCT because tblGroupAccess carries duplicate (GroupId, MenuId) rows.
-- Menu rights load at LOGIN — users re-login to see the row.
-- ---------------------------------------------------------------------------
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @Sales INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/sales'       ORDER BY Id);
    DECLARE @Leads INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/sales/leads' ORDER BY Id);
    IF @Sales IS NULL OR @Leads IS NULL
        RAISERROR('menu rows /sales or /sales/leads not found', 16, 1);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = N'/sales/quotations')
        INSERT INTO dbo.tblMenu (ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route)
        VALUES (@Sales, 'Quotations', NULL, 0, 1, 0, 1, NULL, NULL, 1, N'/sales/quotations');

    DECLARE @Quotes INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/sales/quotations' ORDER BY Id);

    INSERT INTO dbo.tblGroupAccess (GroupId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
    SELECT DISTINCT src.GroupId, @Quotes, src.CanView, src.CanAdd, src.CanEdit, src.CanDelete
    FROM dbo.tblGroupAccess src
    WHERE src.MenuId = @Leads
      AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupAccess ga WHERE ga.GroupId = src.GroupId AND ga.MenuId = @Quotes);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m10 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('091 §10 menu ABORTED — %s', 16, 1, @m10);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 11. Verify
SET NOCOUNT ON;

-- 11.1 shape — every row 'ok'
SELECT 'tblQuotation'            AS what, CASE WHEN OBJECT_ID('dbo.tblQuotation')        IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS state
UNION ALL SELECT 'tblQuotationLine',      CASE WHEN OBJECT_ID('dbo.tblQuotationLine')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblQuotationCounter',   CASE WHEN OBJECT_ID('dbo.tblQuotationCounter') IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblQuoteProfile',       CASE WHEN OBJECT_ID('dbo.tblQuoteProfile')     IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblLeads.WonValue',     CASE WHEN COL_LENGTH('dbo.tblLeads','WonValue')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblLeads.CustomerId',   CASE WHEN COL_LENGTH('dbo.tblLeads','CustomerId')  IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblProduct.TaxPct',     CASE WHEN COL_LENGTH('dbo.tblProduct','TaxPct')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblProduct.HSNCode',    CASE WHEN COL_LENGTH('dbo.tblProduct','HSNCode')   IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblCustomer.GSTIN',     CASE WHEN COL_LENGTH('dbo.tblCustomer','GSTIN')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'menu /sales/quotations',CASE WHEN EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = N'/sales/quotations') THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'mobile constraints (4)',CASE WHEN (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN
                    ('CK_tblCustomer_Mobile','CK_tblCustomer_AltMobile','CK_tblLeads_MobileNo','CK_tblLeads_AltMobile')) = 4 THEN 'ok' ELSE 'MISSING' END;

-- 11.2 every company with lead statuses has exactly one live Won — expect 0 rows
SELECT CompId, SUM(CASE WHEN Code = 'converted' THEN 1 ELSE 0 END) AS WonRows
FROM dbo.tblLookup WHERE Kind = 'lead_status' AND IsActive = 1
GROUP BY CompId HAVING SUM(CASE WHEN Code = 'converted' THEN 1 ELSE 0 END) <> 1;

-- 11.3 no mobile anywhere that is not ten digits — expect 0 rows
SELECT 'tblCustomer.Mobile' AS col, Id FROM dbo.tblCustomer WHERE Mobile    IS NOT NULL AND Mobile    NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
UNION ALL SELECT 'tblCustomer.AltMobile', Id FROM dbo.tblCustomer WHERE AltMobile IS NOT NULL AND AltMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
UNION ALL SELECT 'tblLeads.MobileNo',     Id FROM dbo.tblLeads    WHERE MobileNo  IS NOT NULL AND MobileNo  NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
UNION ALL SELECT 'tblLeads.AltMobile',    Id FROM dbo.tblLeads    WHERE AltMobile IS NOT NULL AND AltMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';

-- 11.4 procs — Tasks 2 and 3 extend this list; every row 'ok'
-- (appended by Task 3)

SET NOEXEC OFF;
GO
```

- [ ] **Step 3: Self-check the file**

Run and confirm each:

```bash
cd backend/sql
grep -c '^-- ===== ' 091_quotations.sql            # expect 11
grep -n '^USE \|^use ' 091_quotations.sql          # expect no output
grep -c 'SET NOEXEC ON' 091_quotations.sql         # expect 3  (one per TRY/CATCH section: 1, 2, 10)
grep -c '^GO$' 091_quotations.sql                  # expect 12
```

Then re-read §1 against this checklist: the customer-mobile collision temp table is built **before** the rewrite; the parking `UPDATE` runs for `Fixable = 0 OR collided`; the four constraints are added **after** all four columns were repaired; nothing in the file deletes a row.

- [ ] **Step 4: Stop and report**

Report: file path, line count, the six pre-flight results, the four self-check numbers. Do not apply the script. Do not stage or commit.

---

### Task 2: `091` part B — profile + quotation procs (sections 5–6)

**Files:**
- Modify: `backend/sql/091_quotations.sql` (fill the two empty sections 5 and 6 — nothing else)

**Interfaces:**
- Consumes: Task 1's four tables and `sp_LogLeadActivity (@CompId, @LeadId, @UserId, @Type VARCHAR(30), @Summary NVARCHAR(1000), @MetaJSON NVARCHAR(MAX))`, which returns one row `(Id, ResponseCode, ResponseMess)` and is always captured with `INSERT INTO @actLog EXEC …`.
- Produces: the ten procs in the Contracts block, signatures exact. `sp_FetchQuotationDetail` RS1 exposes the **lead's** `OwnerId`, `BranchId`, `CreatedBy`.

Everything below goes **between** the marker line `-- ===== 5. Procedures — quote profile (…)` and the marker line `-- ===== 7. Procedures — convert engine (…)`, replacing the empty gap and keeping the section-6 marker where shown. Keep all marker lines exactly as Task 1 wrote them and touch nothing else in the file.

- [ ] **Step 1: Pre-flight**

```sql
-- sp_LogLeadActivity has the six parameters this task passes  → expect 6 rows
SELECT name FROM sys.parameters WHERE object_id = OBJECT_ID('dbo.sp_LogLeadActivity') ORDER BY parameter_id;
-- none of the new procs exist yet                              → expect 0 rows
SELECT name FROM sys.procedures WHERE name IN ('sp_EnsureQuoteProfile','sp_FetchQuoteProfileById','sp_SaveQuoteProfile',
  'sp_SaveQuotation','sp_FinaliseQuotation','sp_ReviseQuotation','sp_RejectQuotation','sp_DeleteQuotation',
  'sp_FetchQuotations','sp_FetchQuotationDetail');
```

- [ ] **Step 2: Fill section 5 — quote profile**

```sql
-- ---------------------------------------------------------------------------
-- 5.1 sp_EnsureQuoteProfile — a fetch that creates, on purpose.
--     The builder needs the branch's profile row to EXIST before anyone has
--     saved anything, because a logo upload needs an EntityId to hang off.
--     A new branch is seeded from the company's most recently saved profile:
--     name, contact, bank, terms, logo, colours carry over; the address, state
--     and GSTIN do not — those are the reason a profile is per branch at all.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_EnsureQuoteProfile
    @CompId   INT,
    @BranchId INT,
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0 OR @BranchId IS NULL OR @BranchId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId and BranchId are required' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblQuoteProfile WHERE CompId = @CompId AND BranchId = @BranchId)
    BEGIN
        BEGIN TRY
            INSERT INTO dbo.tblQuoteProfile
                (CompId, BranchId, CompanyName, Phone, Email, Website, BankDetails, DefaultIntro, DefaultTerms,
                 SignatoryName, LogoAttachmentId, HeaderAttachmentId, AccentColor, DefaultTemplate, IsSet, CreatedBy)
            SELECT @CompId, @BranchId, src.CompanyName, src.Phone, src.Email, src.Website, src.BankDetails,
                   src.DefaultIntro, src.DefaultTerms, src.SignatoryName, src.LogoAttachmentId,
                   src.HeaderAttachmentId, src.AccentColor, src.DefaultTemplate, 0, @UserId
            FROM (SELECT 1 AS one) d
            LEFT JOIN (SELECT TOP 1 * FROM dbo.tblQuoteProfile
                       WHERE CompId = @CompId AND IsSet = 1
                       ORDER BY ISNULL(UpdatedAt, CreatedAt) DESC, Id DESC) src ON 1 = 1;
        END TRY
        BEGIN CATCH
            -- 2601 / 2627: a concurrent call won the race. The row exists; carry on.
            IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;
        END CATCH
    END

    SELECT p.Id, p.CompId, p.BranchId, b.BranchName,
           p.CompanyName, p.Address, p.City, p.StateCode, p.Pincode, p.GSTIN, p.Phone, p.Email, p.Website,
           p.BankDetails, p.DefaultIntro, p.DefaultTerms, p.SignatoryName,
           p.LogoAttachmentId, p.HeaderAttachmentId, p.AccentColor, p.DefaultTemplate, p.IsSet,
           p.CreatedBy, p.CreatedAt, p.EditBy, p.UpdatedAt,
           200 AS ResponseCode, 'Quote profile retrieved successfully' AS ResponseMess
    FROM dbo.tblQuoteProfile p
    LEFT JOIN dbo.tblBranch b ON b.Id = p.BranchId
    WHERE p.CompId = @CompId AND p.BranchId = @BranchId;
END
GO

-- ---------------------------------------------------------------------------
-- 5.2 sp_FetchQuoteProfileById — the attachment access gate's lookup
--     (permission.ENTITY_LOOKUP.quoteprofile). Company-wide by design: every
--     agent who can write a quotation must be able to draw the letterhead.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchQuoteProfileById
    @CompId    INT,
    @ProfileId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.Id, p.CompId, p.BranchId, p.IsSet, p.LogoAttachmentId, p.HeaderAttachmentId
    FROM dbo.tblQuoteProfile p
    WHERE p.Id = @ProfileId AND p.CompId = @CompId;
END
GO

-- ---------------------------------------------------------------------------
-- 5.3 sp_SaveQuoteProfile — the remembered default.
--     First fill (IsSet = 0) is open to anyone: there is nothing to lose.
--     After that only an admin may change it — one agent's GSTIN typo must not
--     become everybody's letterhead. Editing the company block ON a quotation
--     is always allowed and never reaches this proc.
--     With a GSTIN, the state IS its first two digits; what the caller sent is
--     ignored.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveQuoteProfile
    @CompId             INT,
    @BranchId           INT,
    @UserId             INT,
    @IsAdmin            BIT            = 0,
    @CompanyName        NVARCHAR(200)  = NULL,
    @Address            NVARCHAR(500)  = NULL,
    @City               NVARCHAR(100)  = NULL,
    @StateCode          CHAR(2)        = NULL,
    @Pincode            VARCHAR(10)    = NULL,
    @GSTIN              VARCHAR(15)    = NULL,
    @Phone              VARCHAR(30)    = NULL,
    @Email              NVARCHAR(200)  = NULL,
    @Website            NVARCHAR(200)  = NULL,
    @BankDetails        NVARCHAR(1000) = NULL,
    @DefaultIntro       NVARCHAR(MAX)  = NULL,
    @DefaultTerms       NVARCHAR(MAX)  = NULL,
    @SignatoryName      NVARCHAR(200)  = NULL,
    @LogoAttachmentId   BIGINT         = NULL,
    @HeaderAttachmentId BIGINT         = NULL,
    @AccentColor        VARCHAR(7)     = NULL,
    @DefaultTemplate    VARCHAR(30)    = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0 OR @BranchId IS NULL OR @BranchId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId and BranchId are required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    SET @CompanyName = NULLIF(LTRIM(RTRIM(@CompanyName)), N'');
    SET @GSTIN       = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@GSTIN)), ' ', '')), '');
    IF @CompanyName IS NULL
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Company name is required' AS ResponseMess; RETURN; END
    IF @GSTIN IS NOT NULL AND (LEN(@GSTIN) <> 15 OR @GSTIN NOT LIKE '[0-9][0-9]%' OR @GSTIN LIKE '%[^0-9A-Z]%')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'GSTIN must be 15 characters' AS ResponseMess; RETURN; END
    IF @GSTIN IS NOT NULL SET @StateCode = LEFT(@GSTIN, 2);
    IF @StateCode IS NOT NULL AND @StateCode NOT LIKE '[0-9][0-9]'
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid state code' AS ResponseMess; RETURN; END
    IF @DefaultTemplate IS NOT NULL AND @DefaultTemplate NOT IN ('classic','modern','minimal')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Unknown template' AS ResponseMess; RETURN; END
    IF @AccentColor IS NOT NULL AND @AccentColor NOT LIKE '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Accent colour must be #RRGGBB' AS ResponseMess; RETURN; END

    -- A letterhead image must be this company's, and must be a letterhead image.
    IF @LogoAttachmentId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblAttachment WHERE Id = @LogoAttachmentId AND CompId = @CompId AND Entity = 'quoteprofile')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid logo' AS ResponseMess; RETURN; END
    IF @HeaderAttachmentId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblAttachment WHERE Id = @HeaderAttachmentId AND CompId = @CompId AND Entity = 'quoteprofile')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid header image' AS ResponseMess; RETURN; END

    DECLARE @Id INT, @IsSet BIT;
    SELECT @Id = Id, @IsSet = IsSet FROM dbo.tblQuoteProfile WHERE CompId = @CompId AND BranchId = @BranchId;

    IF @Id IS NOT NULL AND @IsSet = 1 AND ISNULL(@IsAdmin, 0) = 0
    BEGIN SELECT @Id AS Id, 403 AS ResponseCode, 'Only an administrator can change the saved company details' AS ResponseMess; RETURN; END

    BEGIN TRY
        IF @Id IS NULL
        BEGIN
            INSERT INTO dbo.tblQuoteProfile
                (CompId, BranchId, CompanyName, Address, City, StateCode, Pincode, GSTIN, Phone, Email, Website,
                 BankDetails, DefaultIntro, DefaultTerms, SignatoryName, LogoAttachmentId, HeaderAttachmentId,
                 AccentColor, DefaultTemplate, IsSet, CreatedBy, EditBy)
            VALUES
                (@CompId, @BranchId, @CompanyName, @Address, @City, @StateCode, @Pincode, @GSTIN, @Phone, @Email, @Website,
                 @BankDetails, @DefaultIntro, @DefaultTerms, @SignatoryName, @LogoAttachmentId, @HeaderAttachmentId,
                 @AccentColor, @DefaultTemplate, 1, @UserId, @UserId);
            SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE
            UPDATE dbo.tblQuoteProfile
            SET CompanyName = @CompanyName, Address = @Address, City = @City, StateCode = @StateCode,
                Pincode = @Pincode, GSTIN = @GSTIN, Phone = @Phone, Email = @Email, Website = @Website,
                BankDetails = @BankDetails, DefaultIntro = @DefaultIntro, DefaultTerms = @DefaultTerms,
                SignatoryName = @SignatoryName, LogoAttachmentId = @LogoAttachmentId,
                HeaderAttachmentId = @HeaderAttachmentId, AccentColor = @AccentColor,
                DefaultTemplate = @DefaultTemplate, IsSet = 1, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Company details saved for future quotations' AS ResponseMess;
    END TRY
    BEGIN CATCH
        SELECT ISNULL(@Id, 0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO
```

- [ ] **Step 3: Fill section 6 — quotations**

```sql
-- ---------------------------------------------------------------------------
-- 6.1 sp_SaveQuotation — drafts only. Lines arrive as JSON and are replaced
--     wholesale; every amount is computed HERE and nowhere else.
--
--     Arithmetic (spec §2, fixture table in §11 and in the web's
--     quoteMath.test.js — change one, change both). Exact DECIMAL, ROUND half
--     away from zero at every step:
--        Gross    = ROUND(Qty × Rate, 2)
--        Discount = pct ? ROUND(Gross × v / 100, 2) : MIN(v, Gross)
--        Taxable  = Gross − Discount
--        Tax      = seller has a GSTIN ? ROUND(Taxable × TaxPct / 100, 2) : 0
--        intra    → CGST = ROUND(Tax / 2, 2), SGST = Tax − CGST   (odd paisa → CGST)
--        inter    → IGST = Tax
--        Grand    = ROUND(Σ LineTotal, 0); RoundOff = Grand − Σ
--
--     The seller's state is LEFT(SellerGSTIN, 2) — derived, never trusted.
--     A draft with no place of supply totals as intra-state; finalise is what
--     insists on one.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveQuotation
    @Id              INT            = 0,
    @CompId          INT,
    @UserId          INT,
    @LeadId          INT            = NULL,
    @TemplateCode    VARCHAR(30)    = 'classic',
    @QuoteDate       DATE           = NULL,
    @ValidTill       DATE           = NULL,
    @Subject         NVARCHAR(300)  = NULL,
    @ToName          NVARCHAR(200)  = NULL,
    @ToCompany       NVARCHAR(200)  = NULL,
    @ToMobile        VARCHAR(20)    = NULL,
    @ToEmail         NVARCHAR(200)  = NULL,
    @ToAddress       NVARCHAR(500)  = NULL,
    @ToCity          NVARCHAR(100)  = NULL,
    @ToStateCode     CHAR(2)        = NULL,
    @ToPincode       VARCHAR(10)    = NULL,
    @ToGSTIN         VARCHAR(15)    = NULL,
    @SellerGSTIN     VARCHAR(15)    = NULL,
    @SellerStateCode CHAR(2)        = NULL,
    @CompanyJSON     NVARCHAR(MAX)  = NULL,
    @ContentJSON     NVARCHAR(MAX)  = NULL,
    @LinesJSON       NVARCHAR(MAX)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    -- An update keeps the quotation on its own lead; the client cannot move it.
    IF @Id > 0
    BEGIN
        DECLARE @CurStatus VARCHAR(20);
        SELECT @LeadId = LeadId, @CurStatus = Status FROM dbo.tblQuotation WHERE Id = @Id AND CompId = @CompId;
        IF @CurStatus IS NULL
        BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess; RETURN; END
        IF @CurStatus <> 'draft'
        BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Only a draft can be edited — revise this quotation instead' AS ResponseMess; RETURN; END
    END

    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END

    DECLARE @LeadCode VARCHAR(30);
    SELECT @LeadCode = st.Code
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    IF @LeadCode IS NULL
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF @LeadCode NOT IN ('open','qualified')
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'This lead is closed — its quotations can no longer be edited' AS ResponseMess; RETURN; END

    SET @ToName   = NULLIF(LTRIM(RTRIM(@ToName)), N'');
    SET @ToGSTIN  = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@ToGSTIN)), ' ', '')), '');
    SET @SellerGSTIN = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@SellerGSTIN)), ' ', '')), '');
    SET @ToMobile = NULLIF(LTRIM(RTRIM(@ToMobile)), '');
    IF @QuoteDate IS NULL SET @QuoteDate = CAST(GETDATE() AS DATE);

    IF @ToName IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Customer name is required' AS ResponseMess; RETURN; END
    IF @TemplateCode NOT IN ('classic','modern','minimal')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Unknown template' AS ResponseMess; RETURN; END
    IF @ToMobile IS NOT NULL AND @ToMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Mobile number must be 10 digits' AS ResponseMess; RETURN; END
    IF @ToStateCode IS NOT NULL AND @ToStateCode NOT LIKE '[0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid place of supply' AS ResponseMess; RETURN; END
    IF @SellerGSTIN IS NOT NULL AND (LEN(@SellerGSTIN) <> 15 OR @SellerGSTIN NOT LIKE '[0-9][0-9]%')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Your GSTIN must be 15 characters' AS ResponseMess; RETURN; END
    IF @ToGSTIN IS NOT NULL AND (LEN(@ToGSTIN) <> 15 OR @ToGSTIN NOT LIKE '[0-9][0-9]%')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'The customer''s GSTIN must be 15 characters' AS ResponseMess; RETURN; END
    IF @ValidTill IS NOT NULL AND @ValidTill < @QuoteDate
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Valid-till cannot be before the quotation date' AS ResponseMess; RETURN; END
    IF @CompanyJSON IS NOT NULL AND ISJSON(@CompanyJSON) = 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompanyJSON is not valid JSON' AS ResponseMess; RETURN; END
    IF @ContentJSON IS NOT NULL AND ISJSON(@ContentJSON) = 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'ContentJSON is not valid JSON' AS ResponseMess; RETURN; END
    IF @LinesJSON IS NOT NULL AND LTRIM(RTRIM(@LinesJSON)) <> '' AND ISJSON(@LinesJSON) = 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'LinesJSON is not valid JSON' AS ResponseMess; RETURN; END

    IF @SellerGSTIN IS NOT NULL SET @SellerStateCode = LEFT(@SellerGSTIN, 2);
    DECLARE @Taxed BIT = CASE WHEN @SellerGSTIN IS NOT NULL THEN 1 ELSE 0 END;
    DECLARE @Inter BIT = CASE WHEN @SellerGSTIN IS NOT NULL AND @ToStateCode IS NOT NULL
                                   AND @ToStateCode <> @SellerStateCode THEN 1 ELSE 0 END;

    -- Parse. Negatives are clamped rather than refused: a draft is allowed to be
    -- half-typed, and finalise is where a line has to make sense.
    DECLARE @L TABLE (
        SortOrder INT, ProductId INT, Description NVARCHAR(1000), HSNCode VARCHAR(10),
        Qty DECIMAL(18,3), Unit VARCHAR(20), Rate DECIMAL(18,2),
        DiscountType VARCHAR(3), DiscountValue DECIMAL(18,2), TaxPct DECIMAL(5,2));

    IF @LinesJSON IS NOT NULL AND LTRIM(RTRIM(@LinesJSON)) <> ''
        INSERT INTO @L (SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate, DiscountType, DiscountValue, TaxPct)
        SELECT CAST(a.[key] AS INT) + 1,
               NULLIF(j.productId, 0),
               ISNULL(LTRIM(RTRIM(j.description)), N''),
               NULLIF(LTRIM(RTRIM(j.hsn)), ''),
               CASE WHEN ISNULL(j.qty, 0)  < 0 THEN 0 ELSE ISNULL(j.qty, 0)  END,
               NULLIF(LTRIM(RTRIM(j.unit)), ''),
               CASE WHEN ISNULL(j.rate, 0) < 0 THEN 0 ELSE ISNULL(j.rate, 0) END,
               CASE WHEN j.discountType = 'amt' THEN 'amt' ELSE 'pct' END,
               CASE WHEN ISNULL(j.discountValue, 0) < 0 THEN 0
                    WHEN ISNULL(j.discountType, 'pct') <> 'amt' AND j.discountValue > 100 THEN 100
                    ELSE ISNULL(j.discountValue, 0) END,
               CASE WHEN ISNULL(j.taxPct, 0) < 0 THEN 0 WHEN j.taxPct > 100 THEN 100 ELSE ISNULL(j.taxPct, 0) END
        FROM OPENJSON(@LinesJSON) a
        CROSS APPLY OPENJSON(a.value) WITH (
            productId     INT             '$.productId',
            description   NVARCHAR(1000)  '$.description',
            hsn           VARCHAR(10)     '$.hsn',
            qty           DECIMAL(18,3)   '$.qty',
            unit          VARCHAR(20)     '$.unit',
            rate          DECIMAL(18,2)   '$.rate',
            discountType  VARCHAR(3)      '$.discountType',
            discountValue DECIMAL(18,2)   '$.discountValue',
            taxPct        DECIMAL(5,2)    '$.taxPct') j;

    IF (SELECT COUNT(*) FROM @L) > 200
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'A quotation can hold at most 200 lines' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @IsNew BIT = CASE WHEN @Id = 0 THEN 1 ELSE 0 END;

        IF @Id = 0
        BEGIN
            INSERT INTO dbo.tblQuotation
                (CompId, LeadId, RootId, Revision, TemplateCode, Status, QuoteDate, ValidTill, Subject,
                 ToName, ToCompany, ToMobile, ToEmail, ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN,
                 SellerGSTIN, SellerStateCode, CompanyJSON, ContentJSON, CreatedBy, EditBy)
            VALUES
                (@CompId, @LeadId, 0, 1, @TemplateCode, 'draft', @QuoteDate, @ValidTill, @Subject,
                 @ToName, @ToCompany, @ToMobile, @ToEmail, @ToAddress, @ToCity, @ToStateCode, @ToPincode, @ToGSTIN,
                 @SellerGSTIN, @SellerStateCode, @CompanyJSON, @ContentJSON, @UserId, @UserId);
            SET @Id = CAST(SCOPE_IDENTITY() AS INT);
            UPDATE dbo.tblQuotation SET RootId = @Id WHERE Id = @Id;   -- revision 1 is its own root
        END
        ELSE
            UPDATE dbo.tblQuotation
            SET TemplateCode = @TemplateCode, QuoteDate = @QuoteDate, ValidTill = @ValidTill, Subject = @Subject,
                ToName = @ToName, ToCompany = @ToCompany, ToMobile = @ToMobile, ToEmail = @ToEmail,
                ToAddress = @ToAddress, ToCity = @ToCity, ToStateCode = @ToStateCode, ToPincode = @ToPincode,
                ToGSTIN = @ToGSTIN, SellerGSTIN = @SellerGSTIN, SellerStateCode = @SellerStateCode,
                CompanyJSON = @CompanyJSON, ContentJSON = @ContentJSON, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

        DELETE FROM dbo.tblQuotationLine WHERE QuotationId = @Id;

        ;WITH g AS (
            SELECT *, ROUND(CAST(Qty AS DECIMAL(18,3)) * CAST(Rate AS DECIMAL(18,2)), 2) AS Gross FROM @L
        ), d AS (
            SELECT *, CASE WHEN DiscountType = 'amt' THEN CAST(DiscountValue AS DECIMAL(38,6))
                           ELSE ROUND(CAST(Gross AS DECIMAL(20,2)) * CAST(DiscountValue AS DECIMAL(9,2)) / 100, 2) END AS Disc0
            FROM g
        ), t AS (
            SELECT *, CASE WHEN Disc0 > Gross THEN Gross ELSE Disc0 END AS Disc FROM d
        ), x AS (
            SELECT *, CAST(Gross - Disc AS DECIMAL(20,2)) AS Taxable FROM t
        ), y AS (
            SELECT *, CASE WHEN @Taxed = 1 THEN CAST(ROUND(Taxable * CAST(TaxPct AS DECIMAL(7,2)) / 100, 2) AS DECIMAL(20,2))
                           ELSE CAST(0 AS DECIMAL(20,2)) END AS Tax
            FROM x
        )
        INSERT INTO dbo.tblQuotationLine
            (CompId, QuotationId, SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate,
             DiscountType, DiscountValue, TaxPct, GrossAmt, DiscountAmt, TaxableAmt, CgstAmt, SgstAmt, IgstAmt, LineTotal)
        SELECT @CompId, @Id, SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate,
               DiscountType, DiscountValue, TaxPct, Gross, Disc, Taxable,
               CASE WHEN @Inter = 1 THEN 0 ELSE ROUND(Tax / 2, 2) END,
               CASE WHEN @Inter = 1 THEN 0 ELSE Tax - ROUND(Tax / 2, 2) END,
               CASE WHEN @Inter = 1 THEN Tax ELSE 0 END,
               Taxable + Tax
        FROM y;

        UPDATE q SET
            SubTotal      = ISNULL(s.SubTotal, 0),      DiscountTotal = ISNULL(s.DiscountTotal, 0),
            TaxableTotal  = ISNULL(s.TaxableTotal, 0),  CgstTotal     = ISNULL(s.CgstTotal, 0),
            SgstTotal     = ISNULL(s.SgstTotal, 0),     IgstTotal     = ISNULL(s.IgstTotal, 0),
            GrandTotal    = ROUND(ISNULL(s.Total, 0), 0),
            RoundOff      = ROUND(ISNULL(s.Total, 0), 0) - ISNULL(s.Total, 0)
        FROM dbo.tblQuotation q
        OUTER APPLY (SELECT SUM(GrossAmt) AS SubTotal, SUM(DiscountAmt) AS DiscountTotal, SUM(TaxableAmt) AS TaxableTotal,
                            SUM(CgstAmt) AS CgstTotal, SUM(SgstAmt) AS SgstTotal, SUM(IgstAmt) AS IgstTotal,
                            SUM(LineTotal) AS Total
                     FROM dbo.tblQuotationLine WHERE QuotationId = @Id) s
        WHERE q.Id = @Id;

        IF @IsNew = 1
        BEGIN
            DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
            DECLARE @Meta NVARCHAR(MAX) = (SELECT @Id AS quotationId, 'drafted' AS event FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
            INSERT INTO @actLog
            EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                 @Type = 'quotation', @Summary = N'Quotation drafted', @MetaJSON = @Meta;
        END

        COMMIT TRANSACTION;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Quotation saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.2 sp_FinaliseQuotation — locks the draft and gives it its number.
--     Numbered HERE, not at create, so abandoned drafts burn nothing.
--     QT-<FinYear>-<4-digit seq>[-R<n>]; the counter is per company per Indian
--     financial year (Apr–Mar). A revision reuses its root's number.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FinaliseQuotation
    @CompId      INT,
    @QuotationId INT,
    @UserId      INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status VARCHAR(20), @LeadId INT, @RootId INT, @Revision INT, @ToName NVARCHAR(200),
            @ToState CHAR(2), @SellerGstin VARCHAR(15), @CompanyJSON NVARCHAR(MAX);
    SELECT @Status = Status, @LeadId = LeadId, @RootId = RootId, @Revision = Revision, @ToName = ToName,
           @ToState = ToStateCode, @SellerGstin = SellerGSTIN, @CompanyJSON = CompanyJSON
    FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId;

    IF @Status IS NULL
    BEGIN SELECT @QuotationId AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF @Status <> 'draft'
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This quotation is already finalised' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
                   WHERE l.Id = @LeadId AND l.CompId = @CompId AND st.Code IN ('open','qualified'))
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This lead is closed — the quotation cannot be finalised' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblQuotationLine WHERE QuotationId = @QuotationId)
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'Add at least one line before finalising' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblQuotationLine WHERE QuotationId = @QuotationId AND (LTRIM(RTRIM(Description)) = N'' OR Qty <= 0))
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'Every line needs a description and a quantity' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    -- Spec §2: a rate of zero is legitimate (a free item in a package); a
    -- negative one is not — it would silently discount the whole quotation.
    IF EXISTS (SELECT 1 FROM dbo.tblQuotationLine WHERE QuotationId = @QuotationId AND Rate < 0)
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'A line cannot have a negative rate' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF NULLIF(LTRIM(RTRIM(ISNULL(JSON_VALUE(@CompanyJSON, '$.name'), N''))), N'') IS NULL
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'Your company name is missing' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF @SellerGstin IS NOT NULL AND @ToState IS NULL
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'Choose the customer''s state — GST depends on it' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END

    DECLARE @Today DATE = CAST(GETDATE() AS DATE);
    DECLARE @StartYear INT = CASE WHEN MONTH(@Today) >= 4 THEN YEAR(@Today) ELSE YEAR(@Today) - 1 END;
    DECLARE @FinYear CHAR(4) = RIGHT('0' + CAST(@StartYear % 100 AS VARCHAR(2)), 2)
                             + RIGHT('0' + CAST((@StartYear + 1) % 100 AS VARCHAR(2)), 2);
    DECLARE @Seq INT, @QuoteNo VARCHAR(30);

    BEGIN TRY
        BEGIN TRANSACTION;

        -- A revision carries its root's number; only a first issue draws a new one.
        IF @Revision > 1
            SELECT @Seq = SeqNo, @FinYear = ISNULL(FinYear, @FinYear)
            FROM dbo.tblQuotation WHERE CompId = @CompId AND RootId = @RootId AND SeqNo IS NOT NULL AND Revision = (
                SELECT MIN(Revision) FROM dbo.tblQuotation WHERE CompId = @CompId AND RootId = @RootId AND SeqNo IS NOT NULL);

        IF @Seq IS NULL
        BEGIN
            UPDATE dbo.tblQuotationCounter WITH (UPDLOCK, HOLDLOCK)
            SET LastNo = LastNo + 1, @Seq = LastNo + 1
            WHERE CompId = @CompId AND FinYear = @FinYear;
            IF @@ROWCOUNT = 0
            BEGIN
                INSERT INTO dbo.tblQuotationCounter (CompId, FinYear, LastNo) VALUES (@CompId, @FinYear, 1);
                SET @Seq = 1;
            END
        END

        SET @QuoteNo = 'QT-' + @FinYear + '-'
                     + CASE WHEN @Seq < 10000 THEN RIGHT('0000' + CAST(@Seq AS VARCHAR(10)), 4) ELSE CAST(@Seq AS VARCHAR(10)) END
                     + CASE WHEN @Revision > 1 THEN '-R' + CAST(@Revision AS VARCHAR(5)) ELSE '' END;

        UPDATE dbo.tblQuotation
        SET Status = 'final', FinYear = @FinYear, SeqNo = @Seq, QuoteNo = @QuoteNo,
            FinalisedAt = GETDATE(), FinalisedBy = @UserId, EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id = @QuotationId AND CompId = @CompId;

        -- The revision it replaces. A quotation the customer is holding never
        -- changes silently — it is superseded, and says by what.
        UPDATE dbo.tblQuotation
        SET Status = 'superseded', ClosedAt = GETDATE(), ClosedBy = @UserId,
            CloseRemarks = N'Replaced by ' + @QuoteNo
        WHERE CompId = @CompId AND RootId = @RootId AND Id <> @QuotationId AND Status = 'final';

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @Summary NVARCHAR(500) = N'Quotation ' + @QuoteNo + N' finalised';
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @QuotationId AS quotationId, @QuoteNo AS quoteNo, 'finalised' AS event
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'quotation', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @QuotationId AS Id, 200 AS ResponseCode, 'Quotation finalised' AS ResponseMess, @QuoteNo AS QuoteNo;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @QuotationId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.3 sp_ReviseQuotation — a copy, one revision up, as a new draft.
--     One draft revision per root: asking twice hands back the first.
--     Validity is carried over as a LENGTH (15 days stays 15 days), not a date.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ReviseQuotation
    @CompId      INT,
    @QuotationId INT,
    @UserId      INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status VARCHAR(20), @LeadId INT, @RootId INT, @SrcNo VARCHAR(30);
    SELECT @Status = Status, @LeadId = LeadId, @RootId = RootId, @SrcNo = QuoteNo
    FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId;

    IF @Status IS NULL
    BEGIN SELECT @QuotationId AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Status NOT IN ('final','rejected','unused')
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'Only a finalised, rejected or unused quotation can be revised' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
                   WHERE l.Id = @LeadId AND l.CompId = @CompId AND st.Code IN ('open','qualified'))
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This lead is closed — its quotations are history now' AS ResponseMess; RETURN; END

    DECLARE @Existing INT = (SELECT TOP 1 Id FROM dbo.tblQuotation
                             WHERE CompId = @CompId AND RootId = @RootId AND Status = 'draft' ORDER BY Id DESC);
    IF @Existing IS NOT NULL
    BEGIN SELECT @Existing AS Id, 200 AS ResponseCode, 'A draft revision already exists' AS ResponseMess; RETURN; END

    DECLARE @NewId INT, @NewRev INT;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @NewRev = MAX(Revision) + 1 FROM dbo.tblQuotation WITH (UPDLOCK, HOLDLOCK)
        WHERE CompId = @CompId AND RootId = @RootId;

        INSERT INTO dbo.tblQuotation
            (CompId, LeadId, RootId, Revision, TemplateCode, Status, QuoteDate, ValidTill, Subject,
             ToName, ToCompany, ToMobile, ToEmail, ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN,
             SellerGSTIN, SellerStateCode, CompanyJSON, ContentJSON,
             SubTotal, DiscountTotal, TaxableTotal, CgstTotal, SgstTotal, IgstTotal, RoundOff, GrandTotal,
             CreatedBy, EditBy)
        SELECT CompId, LeadId, RootId, @NewRev, TemplateCode, 'draft', CAST(GETDATE() AS DATE),
               DATEADD(DAY, DATEDIFF(DAY, QuoteDate, ValidTill), CAST(GETDATE() AS DATE)), Subject,
               ToName, ToCompany, ToMobile, ToEmail, ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN,
               SellerGSTIN, SellerStateCode, CompanyJSON, ContentJSON,
               SubTotal, DiscountTotal, TaxableTotal, CgstTotal, SgstTotal, IgstTotal, RoundOff, GrandTotal,
               @UserId, @UserId
        FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId;
        SET @NewId = CAST(SCOPE_IDENTITY() AS INT);

        INSERT INTO dbo.tblQuotationLine
            (CompId, QuotationId, SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate,
             DiscountType, DiscountValue, TaxPct, GrossAmt, DiscountAmt, TaxableAmt, CgstAmt, SgstAmt, IgstAmt, LineTotal)
        SELECT CompId, @NewId, SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate,
               DiscountType, DiscountValue, TaxPct, GrossAmt, DiscountAmt, TaxableAmt, CgstAmt, SgstAmt, IgstAmt, LineTotal
        FROM dbo.tblQuotationLine WHERE QuotationId = @QuotationId;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @Summary NVARCHAR(500) = N'Revision ' + CAST(@NewRev AS NVARCHAR(5)) + N' of ' + ISNULL(@SrcNo, N'the quotation') + N' started';
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @NewId AS quotationId, @QuotationId AS fromQuotationId, 'revised' AS event
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'quotation', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @NewId AS Id, 200 AS ResponseCode, 'Revision started' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @QuotationId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.4 sp_RejectQuotation — the customer said no. final → rejected.
--     Remarks are optional: "too expensive" is worth having, but a required
--     field here would just collect "." . The lead is NOT touched — it stays
--     active; the agent revises, or marks the lead Lost with a reason.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_RejectQuotation
    @CompId      INT,
    @QuotationId INT,
    @UserId      INT,
    @Remarks     NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status VARCHAR(20), @LeadId INT, @QuoteNo VARCHAR(30);
    SELECT @Status = Status, @LeadId = LeadId, @QuoteNo = QuoteNo
    FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId;

    IF @Status IS NULL
    BEGIN SELECT @QuotationId AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Status <> 'final'
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be marked rejected' AS ResponseMess; RETURN; END

    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.tblQuotation
        SET Status = 'rejected', ClosedAt = GETDATE(), ClosedBy = @UserId, CloseRemarks = @Remarks,
            EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id = @QuotationId AND CompId = @CompId;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @Summary NVARCHAR(1000) = N'Quotation ' + @QuoteNo + N' rejected' + ISNULL(N' — ' + @Remarks, N'');
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @QuotationId AS quotationId, @QuoteNo AS quoteNo, 'rejected' AS event
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'quotation', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @QuotationId AS Id, 200 AS ResponseCode, 'Quotation marked rejected' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @QuotationId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.5 sp_DeleteQuotation — drafts only. An issued quotation is a record.
--     Lines go with it (FK cascade). The controller removes the draft's own
--     uploaded images afterwards.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_DeleteQuotation
    @CompId      INT,
    @QuotationId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status VARCHAR(20) = (SELECT Status FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId);
    IF @Status IS NULL
    BEGIN SELECT @QuotationId AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess; RETURN; END
    IF @Status <> 'draft'
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'Only a draft can be deleted' AS ResponseMess; RETURN; END

    BEGIN TRY
        DELETE FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId AND Status = 'draft';
        SELECT @QuotationId AS Id, 200 AS ResponseCode, 'Draft deleted' AS ResponseMess;
    END TRY
    BEGIN CATCH
        SELECT @QuotationId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.6 sp_FetchQuotations — the list, and (with @LeadId) a lead's own tab.
--     Visibility is the LEAD's: sp_FetchLeads' scope predicate, verbatim, on
--     the joined lead. Filters narrow inside it and never widen.
--     Superseded revisions are hidden unless asked for by name, so the list is
--     one row per live quotation rather than every version ever issued.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchQuotations
    @CompId                  INT,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL,
    @Status                  VARCHAR(20)   = NULL,
    @OwnerId                 INT           = NULL,
    @BranchId                INT           = NULL,
    @LeadId                  INT           = NULL,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize, 25) < 1 THEN 25 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @Status     IS NOT NULL AND LTRIM(RTRIM(@Status))     = '' SET @Status = NULL;

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

    DECLARE @Today DATE = CAST(GETDATE() AS DATE);

    DECLARE @Page TABLE (Id INT, rn INT);
    DECLARE @Total INT;

    ;WITH f AS (
        SELECT q.Id, q.CreatedAt
        FROM dbo.tblQuotation q
        JOIN dbo.tblLeads l ON l.Id = q.LeadId AND l.CompId = q.CompId
        WHERE q.CompId = @CompId
          AND (@LeadId   IS NULL OR q.LeadId   = @LeadId)
          AND (@BranchId IS NULL OR l.BranchId = @BranchId)
          AND (@OwnerId  IS NULL OR l.OwnerId  = @OwnerId)
          AND (@FromDate IS NULL OR q.QuoteDate >= @FromDate)
          AND (@ToDate   IS NULL OR q.QuoteDate <= @ToDate)
          AND ( (@Status IS NULL AND q.Status <> 'superseded') OR q.Status = @Status )
          AND (@SearchTerm IS NULL OR q.QuoteNo   LIKE '%' + @SearchTerm + '%'
                                  OR q.ToName    LIKE '%' + @SearchTerm + '%'
                                  OR q.ToCompany LIKE '%' + @SearchTerm + '%'
                                  OR l.Name      LIKE '%' + @SearchTerm + '%')
          AND (
                (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
              )
    )
    SELECT * INTO #f FROM f;

    SET @Total = (SELECT COUNT(*) FROM #f);

    INSERT INTO @Page (Id, rn)
    SELECT Id, ROW_NUMBER() OVER (ORDER BY CreatedAt DESC, Id DESC)
    FROM #f
    ORDER BY CreatedAt DESC, Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1: the page
    SELECT q.Id, q.CompId, q.LeadId, l.Name AS LeadName, l.Company AS LeadCompany,
           q.RootId, q.Revision, q.QuoteNo, q.Status, q.TemplateCode, q.QuoteDate, q.ValidTill, q.Subject,
           q.ToName, q.ToCompany, q.TaxableTotal, q.GrandTotal,
           CAST(CASE WHEN q.Status = 'final' AND q.ValidTill IS NOT NULL AND q.ValidTill < @Today THEN 1 ELSE 0 END AS BIT) AS IsExpired,
           l.OwnerId, o.FullName AS OwnerName, l.BranchId, b.BranchName,
           q.CreatedBy, cu.FullName AS CreatedByName, q.CreatedAt, q.FinalisedAt, q.ClosedAt, q.CloseRemarks,
           200 AS ResponseCode, 'Quotations retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblQuotation q ON q.Id = x.Id
    JOIN dbo.tblLeads l     ON l.Id = q.LeadId
    LEFT JOIN dbo.tblUser o   ON o.Id  = l.OwnerId
    LEFT JOIN dbo.tblUser cu  ON cu.Id = q.CreatedBy
    LEFT JOIN dbo.tblBranch b ON b.Id  = l.BranchId
    ORDER BY x.rn;

    -- Result set 2: pagination
    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;

    DROP TABLE #f;
END
GO

-- ---------------------------------------------------------------------------
-- 6.7 sp_FetchQuotationDetail — 3 result sets
--       1 header   2 lines   3 every revision of the same root
--     RS1 carries the LEAD's OwnerId / BranchId / CreatedBy under exactly those
--     names: permission.canSeeRecord reads them, so a quotation is visible to
--     precisely the people its lead is visible to. The quotation's own creator
--     is QuoteCreatedBy.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchQuotationDetail
    @CompId      INT,
    @QuotationId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATE = CAST(GETDATE() AS DATE);

    -- 1) header
    SELECT q.Id, q.CompId, q.LeadId, q.CustomerId, q.RootId, q.Revision, q.FinYear, q.SeqNo, q.QuoteNo,
           q.TemplateCode, q.Status, q.QuoteDate, q.ValidTill, q.Subject,
           q.ToName, q.ToCompany, q.ToMobile, q.ToEmail, q.ToAddress, q.ToCity, q.ToStateCode, q.ToPincode, q.ToGSTIN,
           q.SellerGSTIN, q.SellerStateCode, q.CompanyJSON, q.ContentJSON,
           q.SubTotal, q.DiscountTotal, q.TaxableTotal, q.CgstTotal, q.SgstTotal, q.IgstTotal, q.RoundOff, q.GrandTotal,
           q.FinalisedAt, q.FinalisedBy, q.ClosedAt, q.ClosedBy, q.CloseRemarks,
           CAST(CASE WHEN q.Status = 'final' AND q.ValidTill IS NOT NULL AND q.ValidTill < @Today THEN 1 ELSE 0 END AS BIT) AS IsExpired,
           l.Name AS LeadName, l.Company AS LeadCompany, st.Code AS LeadStatusCode, l.EstValue AS LeadEstValue,
           l.ProductId AS LeadProductId,
           l.OwnerId, o.FullName AS OwnerName, l.BranchId, b.BranchName, l.CreatedBy,
           q.CreatedBy AS QuoteCreatedBy, cu.FullName AS QuoteCreatedByName, q.CreatedAt, q.UpdatedAt,
           200 AS ResponseCode, 'Quotation retrieved successfully' AS ResponseMess
    FROM dbo.tblQuotation q
    JOIN dbo.tblLeads l        ON l.Id = q.LeadId AND l.CompId = q.CompId
    JOIN dbo.tblLookup st      ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser o    ON o.Id  = l.OwnerId
    LEFT JOIN dbo.tblUser cu   ON cu.Id = q.CreatedBy
    LEFT JOIN dbo.tblBranch b  ON b.Id  = l.BranchId
    WHERE q.Id = @QuotationId AND q.CompId = @CompId;

    -- 2) lines
    SELECT ln.Id, ln.SortOrder, ln.ProductId, ln.Description, ln.HSNCode, ln.Qty, ln.Unit, ln.Rate,
           ln.DiscountType, ln.DiscountValue, ln.TaxPct,
           ln.GrossAmt, ln.DiscountAmt, ln.TaxableAmt, ln.CgstAmt, ln.SgstAmt, ln.IgstAmt, ln.LineTotal
    FROM dbo.tblQuotationLine ln
    WHERE ln.QuotationId = @QuotationId AND ln.CompId = @CompId
    ORDER BY ln.SortOrder, ln.Id;

    -- 3) revisions of the same root, newest first
    SELECT r.Id, r.Revision, r.QuoteNo, r.Status, r.GrandTotal, r.QuoteDate, r.FinalisedAt, r.ClosedAt, r.CloseRemarks
    FROM dbo.tblQuotation r
    WHERE r.CompId = @CompId
      AND r.RootId = (SELECT RootId FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId)
    ORDER BY r.Revision DESC;
END
GO
```

- [ ] **Step 4: Self-check**

```bash
cd backend/sql
grep -c '^CREATE OR ALTER PROC' 091_quotations.sql       # expect 11  (1 from Task 1 is PROCEDURE-spelled: sp_SaveAttachment → counted here too)
grep -c '^-- ===== ' 091_quotations.sql                  # still 11
grep -n "INSERT INTO @actLog" 091_quotations.sql | wc -l # expect 4  (save, finalise, revise, reject)
```

Then read the four mutating procs once more against this list: every early `RETURN` selects the **same column list** as the proc's success row (`sp_FinaliseQuotation` always includes `QuoteNo`); every `BEGIN TRANSACTION` has a `ROLLBACK` in its `CATCH`; `sp_SaveQuotation` ignores a client-sent `@LeadId` on update; no proc reads `BranchId`/`OwnerId` from `tblQuotation` (the columns do not exist).

- [ ] **Step 5: Stop and report**

Report the pre-flight results and the three self-check numbers. Do not apply the script. Do not stage or commit.

---

### Task 3: `091` part C — convert engine, altered procs, reports, dashboard, fixture verify (sections 7–9, 11)

**Files:**
- Modify: `backend/sql/091_quotations.sql` (fill sections 7, 8, 9; extend section 11)

**Interfaces:**
- Consumes: Task 1's columns (`tblLeads.WonValue`, `CustomerId`, `tblCustomer.GSTIN`, product fields), Task 2's `tblQuotation` procs.
- Produces: `sp_ConvertLead` (signature in Contracts); `sp_SetLeadStatus` that clears a win and closes quotations; `sp_FetchLeads` / `sp_FetchLeadDetail` returning `WonValue`, `CustomerId` (+ `CustomerName` on detail); `sp_DeleteLead` refusing a lead with quotations; `sp_SaveCustomer` with `@GSTIN` and the 10-digit rule; customer fetches returning `GSTIN`; `sp_SaveProduct` / `sp_FetchProducts` with the four tax fields; a `converted` row that cannot be re-coded, deactivated or duplicated; five reports that count `converted` as success; `sp_Dashboard` KPI rows `WonMonth`, `WonValueMonth`.

**Two ways of altering a proc are used here, deliberately:**
- **Full body** (`CREATE OR ALTER`) where this plan holds the whole current definition and the change is structural: `sp_SetLeadStatus`, `sp_DeleteLead`, `sp_SaveCustomer`, `sp_SaveProduct`, `sp_FetchProducts`, `sp_SaveLookup`, `sp_DeleteLookup`.
- **In-place patch** for long read procs where the change is one line: the script reads the live definition from `sys.sql_modules`, swaps one exact single-line fragment, and re-executes it as `ALTER`. This is safer than pasting an 8 KB report proc by hand, it behaves identically on both client DBs, it is idempotent (a *marker* string says "already done"), and it **fails loudly** if the expected line is not there instead of silently doing nothing.

- [ ] **Step 1: Pre-flight — every fragment the patches look for must exist exactly once-or-more, verbatim**

Run with `mcp__sqlserver-ecrm__read_query`. **Every row must show `hits >= 1`.** A `0` means the live definition has drifted from what this plan was written against — stop and report BLOCKED with the proc name.

```sql
SELECT v.sp, v.frag,
       (LEN(m.definition) - LEN(REPLACE(m.definition, v.frag, ''))) / LEN(v.frag) AS hits
FROM (VALUES
  ('sp_FetchLeads',          'l.LostReasonId, l.WonAt, l.LostAt, l.AssignedAt,'),
  ('sp_FetchLeadDetail',     'l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.LostAt, l.AssignedAt,'),
  ('sp_FetchLeadDetail',     'LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId'),
  ('sp_FetchCustomers',      'c.Address, c.City, c.State, c.Pincode, c.Remarks, c.IsActive,'),
  ('sp_FetchCustomerDetail', 'c.Address, c.City, c.State, c.Pincode, c.Remarks, c.IsActive,'),
  ('sp_RptFunnel',           'AND s.Code = ''qualified'') AS QualifiedAt,'),
  ('sp_RptFunnel',           's.Code IN (''qualified'',''lost'',''junk''))'),
  ('sp_RptLeaderboard',      'AND s.Code = ''qualified'') AS QualifiedAt,'),
  ('sp_RptPipelineValue',    's.Code IN (''qualified'',''lost'',''junk''))'),
  ('sp_RptLost',             's.Code IN (''qualified'',''lost'',''junk''))'),
  ('sp_RptAging',            's.Code IN (''lost'',''junk'')) END AS ClosedAt,'),
  ('sp_Dashboard',           'SELECT ''TotalLeads'' AS Type, COUNT(*) AS Number')
) v(sp, frag)
JOIN sys.sql_modules m ON m.object_id = OBJECT_ID('dbo.' + v.sp);
```

Also confirm the bodies this task replaces wholesale have not moved since the plan was written — each must return `1`:

```sql
SELECT 'sp_SetLeadStatus refuses converted' AS chk, COUNT(*) AS ok FROM sys.sql_modules
 WHERE object_id = OBJECT_ID('dbo.sp_SetLeadStatus') AND definition LIKE '%Use convert to move a lead to Converted%'
UNION ALL SELECT 'sp_DeleteLead clears 5 child tables', COUNT(*) FROM sys.sql_modules
 WHERE object_id = OBJECT_ID('dbo.sp_DeleteLead') AND definition LIKE '%tblLeadAssignment%' AND definition NOT LIKE '%tblQuotation%'
UNION ALL SELECT 'sp_SaveCustomer has 14 params', CASE WHEN (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('dbo.sp_SaveCustomer')) = 14 THEN 1 ELSE 0 END
UNION ALL SELECT 'sp_SaveProduct has 9 params',   CASE WHEN (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('dbo.sp_SaveProduct'))  = 9  THEN 1 ELSE 0 END
UNION ALL SELECT 'sp_SaveLookup has 7 params',    CASE WHEN (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('dbo.sp_SaveLookup'))   = 7  THEN 1 ELSE 0 END;
```

- [ ] **Step 2: Fill section 7 — the convert engine**

Goes between the section-7 marker and the section-8 marker.

```sql
-- ---------------------------------------------------------------------------
-- 7.1 sp_ConvertLead — the proc sp_SetLeadStatus has been pointing at since
--     071 ("Use convert to move a lead to Converted") and which never existed.
--
--     ONE engine writes a win. "Accepted" on a quotation and "Won" in the
--     lead's status dropdown both land here; the only difference is where the
--     value comes from:
--        with @QuotationId → the quotation's BEFORE-TAX total (GST is not
--                            revenue); any @WonValue passed is ignored
--        without           → @WonValue, typed by the agent (small leads are
--                            won without a quotation — spec decision 6)
--
--     It also does what "convert" has always meant in this product: the
--     prospect becomes a customer. An active tblCustomer with the lead's mobile
--     is LINKED (a repeat buyer must not become a duplicate); otherwise one is
--     created from the lead. Mobiles are 10 digits on both sides (§1), so the
--     match is reliable.
--
--     Idempotent: a lead that is already won answers 200 and changes nothing.
--     tblLeadStatusHistory now has three writers — sp_SaveLead (insert),
--     sp_SetLeadStatus, and this.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ConvertLead
    @CompId      INT,
    @LeadId      INT,
    @UserId      INT,
    @WonValue    DECIMAL(18,2) = NULL,
    @Remarks     NVARCHAR(500) = NULL,
    @QuotationId INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @QuotationId IS NOT NULL AND @QuotationId <= 0 SET @QuotationId = NULL;
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200),
            @BranchId INT, @CustomerId INT, @CurWon DECIMAL(18,2),
            @LName NVARCHAR(200), @LCompany NVARCHAR(200), @LMobile VARCHAR(20), @LAlt VARCHAR(20),
            @LEmail NVARCHAR(200), @LAddress NVARCHAR(500), @LCity NVARCHAR(100), @LState NVARCHAR(100), @LPin VARCHAR(10);

    SELECT @FromStatusId = l.StatusId, @FromCode = st.Code, @FromName = st.Value,
           @BranchId = l.BranchId, @CustomerId = l.CustomerId, @CurWon = l.WonValue,
           @LName = l.Name, @LCompany = NULLIF(LTRIM(RTRIM(l.Company)), N''), @LMobile = l.MobileNo, @LAlt = l.AltMobile,
           @LEmail = l.Email, @LAddress = l.Address, @LCity = l.City, @LState = l.State, @LPin = l.Pincode
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;

    IF @FromStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @FromCode = 'converted'
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead is already won' AS ResponseMess, @CustomerId AS CustomerId, @CurWon AS WonValue; RETURN; END
    IF @FromCode NOT IN ('open','qualified')
    BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only an active lead can be marked won — reopen it first' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    DECLARE @WonStatusId INT, @ToName NVARCHAR(200);
    SELECT TOP 1 @WonStatusId = Id, @ToName = Value FROM dbo.tblLookup
    WHERE CompId = @CompId AND Kind = 'lead_status' AND Code = 'converted' AND IsActive = 1
    ORDER BY SortOrder, Id;
    IF @WonStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'No Won status is configured for this company' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    DECLARE @QuoteNo VARCHAR(30), @QuoteGstin VARCHAR(15);
    IF @QuotationId IS NOT NULL
    BEGIN
        DECLARE @QStatus VARCHAR(20);
        SELECT @QStatus = Status, @QuoteNo = QuoteNo, @WonValue = TaxableTotal, @QuoteGstin = ToGSTIN
        FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId AND LeadId = @LeadId;
        IF @QStatus IS NULL
        BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'That quotation does not belong to this lead' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
        IF @QStatus <> 'final'
        BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    END
    ELSE IF @WonValue IS NULL OR @WonValue < 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Enter the value this lead was won for' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- The customer: keep the link the lead already has, else match on the
        -- mobile, else create.
        IF @CustomerId IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @CustomerId AND CompId = @CompId AND IsActive = 1)
            SET @CustomerId = NULL;

        IF @CustomerId IS NULL AND @LMobile IS NOT NULL
            SELECT TOP 1 @CustomerId = Id FROM dbo.tblCustomer WITH (UPDLOCK, HOLDLOCK)
            WHERE CompId = @CompId AND Mobile = @LMobile AND IsActive = 1 ORDER BY Id;

        IF @CustomerId IS NULL
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, GSTIN, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, ISNULL(@LCompany, @LName), CASE WHEN @LCompany IS NOT NULL THEN @LName END,
                 @LMobile, @LAlt, @LEmail, @LAddress, @LCity, @LState, @LPin, @QuoteGstin,
                 NULL, 1, @UserId, @UserId, GETDATE());
            SET @CustomerId = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE IF @QuoteGstin IS NOT NULL
            UPDATE dbo.tblCustomer SET GSTIN = @QuoteGstin, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @CustomerId AND CompId = @CompId AND GSTIN IS NULL;

        -- The win.
        DECLARE @hist TABLE (FromStatusId INT);
        UPDATE dbo.tblLeads
        SET StatusId = @WonStatusId, WonAt = GETDATE(), WonValue = @WonValue, CustomerId = @CustomerId,
            LostAt = NULL, LostReasonId = NULL, EditBy = @UserId, UpdatedAt = GETDATE()
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @LeadId AND CompId = @CompId;

        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @LeadId, h.FromStatusId, @WonStatusId, @UserId, GETDATE() FROM @hist h;

        -- Its quotations: the accepted one, and everything else on the lead.
        IF @QuotationId IS NOT NULL
            UPDATE dbo.tblQuotation
            SET Status = 'accepted', CustomerId = @CustomerId, ClosedAt = GETDATE(), ClosedBy = @UserId,
                CloseRemarks = @Remarks, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @QuotationId AND CompId = @CompId;

        UPDATE dbo.tblQuotation
        SET Status = 'unused', ClosedAt = GETDATE(), ClosedBy = @UserId,
            CloseRemarks = CASE WHEN @QuoteNo IS NOT NULL THEN N'Lead won on ' + @QuoteNo ELSE N'Lead won without a quotation' END
        WHERE CompId = @CompId AND LeadId = @LeadId AND Status IN ('draft','final')
          AND (@QuotationId IS NULL OR Id <> @QuotationId);

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @Summary NVARCHAR(1000) = N'Status: ' + @FromName + N' → ' + @ToName
                                        + N' · value ' + CAST(@WonValue AS NVARCHAR(30))
                                        + ISNULL(N' · ' + @QuoteNo, N'')
                                        + ISNULL(N' — ' + @Remarks, N'');
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @WonStatusId AS toStatusId,
                                              @FromCode AS fromCode, 'converted' AS toCode,
                                              @WonValue AS wonValue, @QuotationId AS quotationId,
                                              @CustomerId AS customerId, @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead marked won' AS ResponseMess, @CustomerId AS CustomerId, @WonValue AS WonValue;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        -- 2601 / 2627: someone created a customer with this mobile a moment ago.
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @LeadId AS Id, 409 AS ResponseCode, 'A customer with this mobile was just created — please try again' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue;
        ELSE
            SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 7.2 sp_SetLeadStatus — unchanged from 075 except three things. The refusal
--     of 'converted' STAYS: a win is written by sp_ConvertLead and nowhere else.
--       a. any move made here clears WonAt / WonValue. This proc can never set
--          them, so the only lead that has them is one LEAVING 'converted' —
--          an agent undoing a mistaken win.
--       b. …and that lead's accepted quotation goes back to 'final'. The
--          customer record and tblLeads.CustomerId stay: a complaint may
--          already hang off that customer.
--       c. → lost / junk closes the lead's open quotations as 'unused'.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SetLeadStatus
    @CompId       INT,
    @LeadId       INT,
    @StatusId     INT,
    @LostReasonId INT = NULL,
    @UserId       INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END
    IF @StatusId IS NULL OR @StatusId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'StatusId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200);
    SELECT @FromStatusId = l.StatusId, @FromCode = st.Code, @FromName = st.Value
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    IF @FromStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    DECLARE @ToCode VARCHAR(30), @ToName NVARCHAR(200);
    SELECT @ToCode = Code, @ToName = Value FROM dbo.tblLookup
    WHERE Id = @StatusId AND CompId = @CompId AND Kind = 'lead_status' AND IsActive = 1;
    IF @ToCode IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Status not found' AS ResponseMess; RETURN; END

    IF @ToCode = 'converted'
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Use convert to move a lead to Converted' AS ResponseMess; RETURN; END

    IF @ToCode = 'lost' AND (@LostReasonId IS NULL OR @LostReasonId <= 0)
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Lost reason required' AS ResponseMess; RETURN; END
    IF @ToCode = 'lost'
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@LostReasonId AND CompId=@CompId AND Kind='lost_reason')
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Invalid lost reason' AS ResponseMess; RETURN; END

    IF @FromStatusId = @StatusId
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead already in this status' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @hist   TABLE (FromStatusId INT);

        UPDATE dbo.tblLeads
        SET StatusId = @StatusId,
            LostAt       = CASE WHEN @ToCode = 'lost' THEN GETDATE() ELSE NULL END,
            LostReasonId = CASE WHEN @ToCode = 'lost' THEN @LostReasonId ELSE NULL END,
            WonAt = NULL, WonValue = NULL,                       -- (a)
            EditBy = @UserId, UpdatedAt = GETDATE()
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @LeadId AND CompId = @CompId;

        -- 075: the transition, in the same transaction as the update. The source
        -- status comes from the UPDATE's own OUTPUT, not the @FromStatusId read
        -- before the transaction — two concurrent changes would otherwise both
        -- record the same source.
        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @LeadId, h.FromStatusId, @StatusId, @UserId, GETDATE() FROM @hist h;

        -- (b) a win undone: its quotation is a live offer again.
        IF @FromCode = 'converted'
            UPDATE dbo.tblQuotation
            SET Status = 'final', CustomerId = NULL, ClosedAt = NULL, ClosedBy = NULL, CloseRemarks = NULL,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE CompId = @CompId AND LeadId = @LeadId AND Status = 'accepted';

        -- (c) a dead lead has no open offers.
        IF @ToCode IN ('lost','junk')
            UPDATE dbo.tblQuotation
            SET Status = 'unused', ClosedAt = GETDATE(), ClosedBy = @UserId,
                CloseRemarks = N'Lead marked ' + @ToName
            WHERE CompId = @CompId AND LeadId = @LeadId AND Status IN ('draft','final');

        DECLARE @Summary NVARCHAR(500) = N'Status: ' + @FromName + N' → ' + @ToName;
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @StatusId AS toStatusId,
                                              @FromCode AS fromCode, @ToCode AS toCode,
                                              @LostReasonId AS lostReasonId
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead status updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO
```

- [ ] **Step 3: Fill section 8 — altered reads/writes**

Goes between the section-8 marker and the section-9 marker. The `#Patch091` helper is created here and reused by section 9.

```sql
-- ---------------------------------------------------------------------------
-- 8.0 #Patch091 — swap ONE exact single-line fragment inside a live proc.
--     Used for long read procs whose change is one line: re-typing an 8 KB
--     report by hand is how a second, unrelated bug gets in.
--       @Marker  present  → already patched, do nothing (idempotent)
--       @Old     absent   → the definition has drifted: THROW, do not guess
--     The first CREATE that is followed by PROC becomes ALTER; any other
--     "CREATE" in a comment is left alone.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#Patch091') IS NOT NULL DROP PROC #Patch091;
GO
CREATE PROC #Patch091
    @Proc   SYSNAME,
    @Marker NVARCHAR(400),
    @Old    NVARCHAR(MAX),
    @New    NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @def NVARCHAR(MAX) = (SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID(@Proc));
    DECLARE @msg NVARCHAR(400);

    IF @def IS NULL
    BEGIN SET @msg = N'091: ' + @Proc + N' not found'; THROW 51091, @msg, 1; END
    IF CHARINDEX(@Marker, @def) > 0 RETURN;
    IF CHARINDEX(@Old, @def) = 0
    BEGIN SET @msg = N'091: expected text not found in ' + @Proc + N' — definition has drifted, patch by hand'; THROW 51092, @msg, 1; END

    SET @def = REPLACE(@def, @Old, @New);

    DECLARE @i INT = CHARINDEX('CREATE', @def);
    WHILE @i > 0 AND LTRIM(SUBSTRING(@def, @i + 6, 30)) NOT LIKE 'PROC%'
        SET @i = CHARINDEX('CREATE', @def, @i + 6);
    IF @i = 0
    BEGIN SET @msg = N'091: no CREATE PROC header found in ' + @Proc; THROW 51093, @msg, 1; END
    SET @def = STUFF(@def, @i, 6, 'ALTER');

    EXEC sys.sp_executesql @def;
END
GO

-- 8.1 / 8.2  Lead reads return the win. Detail also names the customer.
BEGIN TRY
    EXEC #Patch091 'dbo.sp_FetchLeads', 'l.WonValue',
        'l.LostReasonId, l.WonAt, l.LostAt, l.AssignedAt,',
        'l.LostReasonId, l.WonAt, l.WonValue, l.CustomerId, l.LostAt, l.AssignedAt,';

    EXEC #Patch091 'dbo.sp_FetchLeadDetail', 'l.WonValue',
        'l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.LostAt, l.AssignedAt,',
        'l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.WonValue, l.CustomerId, cust.Name AS CustomerName, l.LostAt, l.AssignedAt,';

    DECLARE @join NVARCHAR(400) = 'LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId' + CHAR(13) + CHAR(10)
                                + '    LEFT JOIN dbo.tblCustomer cust ON cust.Id = l.CustomerId AND cust.CompId = l.CompId';
    EXEC #Patch091 'dbo.sp_FetchLeadDetail', 'tblCustomer cust',
        'LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId', @join;

    -- 8.5 / 8.6  Customer reads return the GSTIN.
    EXEC #Patch091 'dbo.sp_FetchCustomers', 'c.GSTIN',
        'c.Address, c.City, c.State, c.Pincode, c.Remarks, c.IsActive,',
        'c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,';
    EXEC #Patch091 'dbo.sp_FetchCustomerDetail', 'c.GSTIN',
        'c.Address, c.City, c.State, c.Pincode, c.Remarks, c.IsActive,',
        'c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,';
END TRY
BEGIN CATCH
    DECLARE @m8 NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR('091 §8 read-proc patches ABORTED — %s', 16, 1, @m8);
    SET NOEXEC ON;
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 8.3 sp_DeleteLead — + a lead that has ANY quotation cannot be deleted.
--     Leads carry no DB-level FKs; this proc clears children by hand. An issued
--     quotation is a business record, and silently deleting drafts would orphan
--     the images uploaded to them. The user deletes the drafts first.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_DeleteLead
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess; RETURN; END
    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblQuotation WHERE LeadId=@Id AND CompId=@CompId)
    BEGIN SELECT 409 AS ResponseCode, 'This lead has quotations and cannot be deleted' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- No DB-level FKs (integrity lives in SPs): clear children explicitly.
        DELETE FROM dbo.tblCustomFieldValue WHERE Entity='lead' AND EntityId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblCall             WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeadActivity     WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblFollowUp         WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeadAssignment   WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeads            WHERE Id=@Id AND CompId=@CompId;

        COMMIT TRANSACTION;

        SELECT 200 AS ResponseCode, 'Lead deleted successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO
```

The body above is the live proc (verified 2026-09-18: no FK references `tblLeads`, so nothing else blocks the delete) plus exactly one guard — the `tblQuotation` check.

```sql
-- ---------------------------------------------------------------------------
-- 8.4 sp_SaveCustomer — + @GSTIN; and the mobile rule becomes TEN DIGITS.
--     The old checks allowed '+' and any length, which is how '+919310500657'
--     and '111' got in. The backend normalises before calling; this makes the
--     SP say the same thing in words instead of tripping the CHECK constraint.
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
    @Remarks       NVARCHAR(MAX)  = NULL,
    @GSTIN         VARCHAR(15)    = NULL
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
    SET @GSTIN         = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@GSTIN)), ' ', '')), '');

    IF @Name IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NULL AND @Email IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'A mobile number or an email is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NOT NULL AND @Mobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Mobile number must be 10 digits' AS ResponseMess; RETURN; END
    IF @AltMobile IS NOT NULL AND @AltMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Alternate mobile must be 10 digits' AS ResponseMess; RETURN; END
    IF @Email IS NOT NULL AND @Email NOT LIKE '%_@_%'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid email' AS ResponseMess; RETURN; END
    IF @GSTIN IS NOT NULL AND (LEN(@GSTIN) <> 15 OR @GSTIN NOT LIKE '[0-9][0-9]%' OR @GSTIN LIKE '%[^0-9A-Z]%')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'GSTIN must be 15 characters' AS ResponseMess; RETURN; END

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
                GSTIN = @GSTIN, Remarks = @Remarks,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

            SELECT @Id AS Id, 200 AS ResponseCode, 'Customer updated successfully' AS ResponseMess;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, GSTIN, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @Name, @ContactPerson, @Mobile, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @GSTIN, @Remarks, 1, @UserId, @UserId, GETDATE());

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
-- 8.7 / 8.8 Products — what a quotation line needs to seed itself:
--     HSN/SAC, GST %, unit, and a customer-facing description.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveProduct
    @Id          INT = 0,
    @CompId      INT,
    @UserId      INT,
    @Name        NVARCHAR(200),
    @Code        VARCHAR(50)   = NULL,
    @CategoryId  INT           = NULL,
    @UnitPrice   DECIMAL(18,2) = NULL,
    @MarginPct   DECIMAL(5,2)  = NULL,
    @IsActive    BIT           = 1,
    @HSNCode     VARCHAR(10)   = NULL,
    @TaxPct      DECIMAL(5,2)  = NULL,
    @Unit        VARCHAR(20)   = NULL,
    @Description NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @MarginPct IS NOT NULL AND (@MarginPct < 0 OR @MarginPct > 100)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Margin must be between 0 and 100' AS ResponseMess; RETURN; END
    IF @TaxPct IS NOT NULL AND (@TaxPct < 0 OR @TaxPct > 100)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'GST % must be between 0 and 100' AS ResponseMess; RETURN; END
    IF @UnitPrice IS NOT NULL AND @UnitPrice < 0
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Price cannot be negative' AS ResponseMess; RETURN; END
    IF (@Code IS NOT NULL AND LTRIM(RTRIM(@Code)) = '') SET @Code = NULL;
    SET @HSNCode     = NULLIF(LTRIM(RTRIM(@HSNCode)), '');
    SET @Unit        = NULLIF(LTRIM(RTRIM(@Unit)), '');
    SET @Description = NULLIF(LTRIM(RTRIM(@Description)), N'');
    IF @CategoryId IS NOT NULL AND @CategoryId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@CategoryId AND CompId=@CompId AND Kind='product_category')
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid category' AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblProduct WHERE CompId=@CompId AND Name=@Name AND IsActive=1 AND Id<>ISNULL(@Id,0))
    BEGIN SELECT ISNULL(@Id,0) AS Id, 409 AS ResponseCode, 'A product with this name already exists' AS ResponseMess; RETURN; END

    IF ISNULL(@Id,0) = 0
    BEGIN
        INSERT INTO dbo.tblProduct (CompId, Name, Code, CategoryId, UnitPrice, MarginPct, IsActive,
                                    HSNCode, TaxPct, Unit, Description, CreatedBy, EditBy)
        VALUES (@CompId, @Name, @Code, @CategoryId, @UnitPrice, @MarginPct, ISNULL(@IsActive,1),
                @HSNCode, @TaxPct, @Unit, @Description, @UserId, @UserId);
        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Product created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id=@Id AND CompId=@CompId)
        BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Product not found' AS ResponseMess; RETURN; END

        UPDATE dbo.tblProduct
        SET Name=@Name, Code=@Code, CategoryId=@CategoryId, UnitPrice=@UnitPrice,
            MarginPct=@MarginPct, IsActive=ISNULL(@IsActive,1),
            HSNCode=@HSNCode, TaxPct=@TaxPct, Unit=@Unit, Description=@Description,
            EditBy=@UserId, UpdatedAt=GETDATE()
        WHERE Id=@Id AND CompId=@CompId;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Product updated successfully' AS ResponseMess;
    END
END
GO

CREATE OR ALTER PROC dbo.sp_FetchProducts
    @CompId     INT,
    @PageNumber INT = 1,
    @PageSize   INT = 25,
    @SearchTerm NVARCHAR(200) = NULL,
    @CategoryId INT = NULL,
    @IsActive   BIT = 1          -- NULL = all
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,25) < 1 THEN 25 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;

    DECLARE @Page TABLE (Id INT, Total INT);
    INSERT INTO @Page (Id, Total)
    SELECT p.Id, COUNT(*) OVER ()
    FROM dbo.tblProduct p
    WHERE p.CompId = @CompId
      AND (@IsActive IS NULL OR p.IsActive = @IsActive)
      AND (@CategoryId IS NULL OR p.CategoryId = @CategoryId)
      AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Code LIKE '%' + @SearchTerm + '%')
    ORDER BY p.Name
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT p.Id, p.CompId, p.Name, p.Code, p.CategoryId, c.Value AS CategoryName,
           p.UnitPrice, p.MarginPct, p.IsActive,
           p.HSNCode, p.TaxPct, p.Unit, p.Description,
           p.CreatedBy, p.CreatedAt, p.EditBy, p.UpdatedAt,
           200 AS ResponseCode, 'Products retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblProduct p ON p.Id = x.Id
    LEFT JOIN dbo.tblLookup c ON c.Id = p.CategoryId
    ORDER BY p.Name;

    DECLARE @Total INT = ISNULL((SELECT MAX(Total) FROM @Page), 0);
    IF @Total = 0
        SELECT @Total = COUNT(*) FROM dbo.tblProduct p
        WHERE p.CompId = @CompId
          AND (@IsActive IS NULL OR p.IsActive = @IsActive)
          AND (@CategoryId IS NULL OR p.CategoryId = @CategoryId)
          AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Code LIKE '%' + @SearchTerm + '%');

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO

-- ---------------------------------------------------------------------------
-- 8.9 sp_SaveLookup — the Won row is ours to guard.
--     Its label and sort order are the company's; its CODE is not. Without
--     this, editing "Won" in Settings would quietly re-code it to 'open' (the
--     form's default) and sp_ConvertLead would stop finding it. And a company
--     gets exactly one converted status — a second would make "which Won?"
--     ambiguous.
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

    -- Whatever the form sent, an existing Won row stays Won.
    IF ISNULL(@Id, 0) > 0
       AND EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId AND Kind='lead_status' AND Code='converted')
    BEGIN
        SET @Kind = 'lead_status';
        SET @Code = 'converted';
    END

    -- A lead status always carries a state. Labels are the company's; codes
    -- are ours, and the app branches on them.
    IF @Kind = 'lead_status'
    BEGIN
        IF @Code IS NULL SET @Code = 'open';
        IF @Code NOT IN ('open','qualified','lost','junk','converted')
        BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Code must be one of open, qualified, lost, junk, converted' AS ResponseMess; RETURN; END
        IF @Code = 'converted'
           AND EXISTS (SELECT 1 FROM dbo.tblLookup WHERE CompId=@CompId AND Kind='lead_status' AND Code='converted' AND IsActive=1 AND Id<>ISNULL(@Id,0))
        BEGIN SELECT ISNULL(@Id,0) AS Id, 409 AS ResponseCode, 'This company already has a Won status' AS ResponseMess; RETURN; END
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

-- 8.10 sp_DeleteLookup — the Won status cannot be deactivated: sp_ConvertLead
--      would have nowhere to move a lead to, and every won lead would point at
--      a dead row.
CREATE OR ALTER PROC dbo.sp_DeleteLookup
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN
        SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId)
    BEGIN
        SELECT 404 AS ResponseCode, 'Lookup not found' AS ResponseMess;
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId AND Kind='lead_status' AND Code='converted')
    BEGIN
        SELECT 409 AS ResponseCode, 'The Won status cannot be deleted — rename it instead' AS ResponseMess;
        RETURN;
    END

    UPDATE dbo.tblLookup SET IsActive = 0 WHERE Id=@Id AND CompId=@CompId;

    SELECT 200 AS ResponseCode, 'Lookup deleted successfully' AS ResponseMess;
END
GO
```

- [ ] **Step 4: Fill section 9 — reports + dashboard**

Goes between the section-9 marker and the section-10 marker.

```sql
-- ---------------------------------------------------------------------------
-- 9. Success now has two codes.
--    Until today 'qualified' was the end of the road, so five reports treat it
--    as the success state / a terminal. A small lead goes open → converted
--    without ever being qualified (spec decision 6); unpatched, those wins
--    would vanish from the funnel and never get a closed date.
--      QualifiedAt   = first move into qualified OR converted
--      terminal set  = … + 'converted'
--      ClosedAt      = … + 'converted'
--    The ACTIVE set ('open','qualified') is already right everywhere and is not
--    touched — which is why sp_RptFollowUpCompliance and sp_FetchFollowUps are
--    not in this list. No report changes shape.
-- ---------------------------------------------------------------------------
BEGIN TRY
    EXEC #Patch091 'dbo.sp_RptFunnel', 'IN (''qualified'',''converted'')) AS QualifiedAt',
        'AND s.Code = ''qualified'') AS QualifiedAt,',
        'AND s.Code IN (''qualified'',''converted'')) AS QualifiedAt,';
    EXEC #Patch091 'dbo.sp_RptFunnel', '''qualified'',''converted'',''lost'',''junk''',
        's.Code IN (''qualified'',''lost'',''junk''))',
        's.Code IN (''qualified'',''converted'',''lost'',''junk''))';

    EXEC #Patch091 'dbo.sp_RptLeaderboard', 'IN (''qualified'',''converted'')) AS QualifiedAt',
        'AND s.Code = ''qualified'') AS QualifiedAt,',
        'AND s.Code IN (''qualified'',''converted'')) AS QualifiedAt,';

    EXEC #Patch091 'dbo.sp_RptPipelineValue', '''qualified'',''converted'',''lost'',''junk''',
        's.Code IN (''qualified'',''lost'',''junk''))',
        's.Code IN (''qualified'',''converted'',''lost'',''junk''))';

    EXEC #Patch091 'dbo.sp_RptLost', '''qualified'',''converted'',''lost'',''junk''',
        's.Code IN (''qualified'',''lost'',''junk''))',
        's.Code IN (''qualified'',''converted'',''lost'',''junk''))';

    EXEC #Patch091 'dbo.sp_RptAging', '''converted'',''lost'',''junk''',
        's.Code IN (''lost'',''junk'')) END AS ClosedAt,',
        's.Code IN (''converted'',''lost'',''junk'')) END AS ClosedAt,';

    -- 9.6 sp_Dashboard — two more KPI rows in RS0: leads won this calendar month
    --     and what they were won for. Prepended to the UNION so the first SELECT
    --     still names the columns (Type, Number). The web reads RS0 by Type, not
    --     by position. The leads-trend "Converted" series needs nothing: it has
    --     keyed on WonAt since it was written and starts drawing on its own.
    DECLARE @won NVARCHAR(MAX) =
          N'SELECT ''WonMonth'' AS Type, CAST(COUNT(*) AS DECIMAL(18,2)) AS Number' + CHAR(13) + CHAR(10)
        + N'    FROM tblLeads l' + CHAR(13) + CHAR(10)
        + N'    WHERE l.CompId = @CompId' + CHAR(13) + CHAR(10)
        + N'      AND l.WonAt >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)' + CHAR(13) + CHAR(10)
        + N'      AND (' + CHAR(13) + CHAR(10)
        + N'            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))' + CHAR(13) + CHAR(10)
        + N'             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )' + CHAR(13) + CHAR(10)
        + N'         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))' + CHAR(13) + CHAR(10)
        + N'          )' + CHAR(13) + CHAR(10)
        + N'    UNION ALL' + CHAR(13) + CHAR(10)
        + N'    SELECT ''WonValueMonth'', CAST(ISNULL(SUM(l.WonValue), 0) AS DECIMAL(18,2))' + CHAR(13) + CHAR(10)
        + N'    FROM tblLeads l' + CHAR(13) + CHAR(10)
        + N'    WHERE l.CompId = @CompId' + CHAR(13) + CHAR(10)
        + N'      AND l.WonAt >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)' + CHAR(13) + CHAR(10)
        + N'      AND (' + CHAR(13) + CHAR(10)
        + N'            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))' + CHAR(13) + CHAR(10)
        + N'             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )' + CHAR(13) + CHAR(10)
        + N'         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))' + CHAR(13) + CHAR(10)
        + N'          )' + CHAR(13) + CHAR(10)
        + N'    UNION ALL' + CHAR(13) + CHAR(10)
        + N'    SELECT ''TotalLeads'', COUNT(*)';
    EXEC #Patch091 'dbo.sp_Dashboard', '''WonValueMonth''',
        'SELECT ''TotalLeads'' AS Type, COUNT(*) AS Number', @won;
END TRY
BEGIN CATCH
    DECLARE @m9 NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR('091 §9 report patches ABORTED — %s', 16, 1, @m9);
    SET NOEXEC ON;
END CATCH
GO

IF OBJECT_ID('tempdb..#Patch091') IS NOT NULL DROP PROC #Patch091;
GO
```

- [ ] **Step 5: Extend section 11 — procs present, patches landed, and the fixture table**

In section 11, replace the two lines

```sql
-- 11.4 procs — Tasks 2 and 3 extend this list; every row 'ok'
-- (appended by Task 3)
```

with:

```sql
-- 11.4 procs — every row 'ok'
SELECT v.name AS what, CASE WHEN OBJECT_ID('dbo.' + v.name) IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS state
FROM (VALUES ('sp_EnsureQuoteProfile'),('sp_FetchQuoteProfileById'),('sp_SaveQuoteProfile'),
             ('sp_SaveQuotation'),('sp_FinaliseQuotation'),('sp_ReviseQuotation'),('sp_RejectQuotation'),
             ('sp_DeleteQuotation'),('sp_FetchQuotations'),('sp_FetchQuotationDetail'),('sp_ConvertLead')) v(name);

-- 11.5 patches landed — every row 'ok'
SELECT v.sp AS what, CASE WHEN m.definition LIKE '%' + v.marker + '%' THEN 'ok' ELSE 'NOT PATCHED' END AS state
FROM (VALUES
  ('sp_FetchLeads',          'l.WonValue'),
  ('sp_FetchLeadDetail',     'tblCustomer cust'),
  ('sp_FetchCustomers',      'c.GSTIN'),
  ('sp_FetchCustomerDetail', 'c.GSTIN'),
  ('sp_RptFunnel',           '''qualified'',''converted'',''lost'',''junk'''),
  ('sp_RptLeaderboard',      'IN (''qualified'',''converted'')) AS QualifiedAt'),
  ('sp_RptPipelineValue',    '''qualified'',''converted'',''lost'',''junk'''),
  ('sp_RptLost',             '''qualified'',''converted'',''lost'',''junk'''),
  ('sp_RptAging',            '''converted'',''lost'',''junk'''),
  ('sp_Dashboard',           '''WonValueMonth'''),
  ('sp_SetLeadStatus',       'WonAt = NULL, WonValue = NULL'),
  ('sp_DeleteLead',          'tblQuotation'),
  ('sp_SaveAttachment',      '''quoteprofile''')
) v(sp, marker)
JOIN sys.sql_modules m ON m.object_id = OBJECT_ID('dbo.' + v.sp);

-- 11.6 THE FIXTURE TABLE — the same five cases as web/src/pages/Sales/Quotations/
--      quoteMath.test.js. Runs sp_SaveQuotation for real, inside a transaction
--      that is ROLLED BACK: nothing is left behind but identity gaps. Every row
--      must say 'ok'. (The status rows the proc prints on the way are expected.)
BEGIN TRANSACTION;
    DECLARE @fxLead INT, @fxComp INT, @fxUser INT;
    SELECT TOP 1 @fxLead = l.Id, @fxComp = l.CompId, @fxUser = ISNULL(l.CreatedBy, 1)
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE st.Code IN ('open','qualified') ORDER BY l.Id;

    IF @fxLead IS NULL
        SELECT 'fixtures' AS what, 'SKIPPED — no active lead in this database to hang a test quotation on' AS state;
    ELSE
    BEGIN
        DECLARE @fx TABLE (F VARCHAR(2), Gstin VARCHAR(15), Buyer CHAR(2), Lines NVARCHAR(MAX),
                           Taxable DECIMAL(18,2), Cgst DECIMAL(18,2), Sgst DECIMAL(18,2), Igst DECIMAL(18,2),
                           RoundOff DECIMAL(18,2), Grand DECIMAL(18,2));
        INSERT INTO @fx VALUES
        ('F1','24ABCDE1234F1Z5','24', N'[{"description":"x","qty":1,"rate":280000,"discountType":"amt","discountValue":10000,"taxPct":12}]', 270000.00, 16200.00, 16200.00, 0, 0.00, 302400),
        ('F2','24ABCDE1234F1Z5','27', N'[{"description":"x","qty":1,"rate":280000,"discountType":"amt","discountValue":10000,"taxPct":12}]', 270000.00, 0, 0, 32400.00, 0.00, 302400),
        ('F3',NULL,             '24', N'[{"description":"x","qty":2,"rate":1500,"discountType":"pct","discountValue":0,"taxPct":18}]',        3000.00, 0, 0, 0, 0.00, 3000),
        ('F4','24ABCDE1234F1Z5','24', N'[{"description":"x","qty":1,"rate":100.10,"discountType":"pct","discountValue":0,"taxPct":5}]',        100.10, 2.51, 2.50, 0, -0.11, 105),
        ('F5','24ABCDE1234F1Z5','24', N'[{"description":"a","qty":2.5,"rate":1234.56,"discountType":"pct","discountValue":7.5,"taxPct":18},{"description":"b","qty":3,"rate":99.99,"discountType":"amt","discountValue":0,"taxPct":28}]', 3154.89, 298.95, 298.93, 0, 0.23, 3753);

        DECLARE @got TABLE (F VARCHAR(2), Taxable DECIMAL(18,2), Cgst DECIMAL(18,2), Sgst DECIMAL(18,2), Igst DECIMAL(18,2), RoundOff DECIMAL(18,2), Grand DECIMAL(18,2));
        DECLARE @F VARCHAR(2), @G VARCHAR(15), @B CHAR(2), @Ls NVARCHAR(MAX);
        DECLARE fx CURSOR LOCAL FAST_FORWARD FOR SELECT F, Gstin, Buyer, Lines FROM @fx ORDER BY F;
        OPEN fx; FETCH NEXT FROM fx INTO @F, @G, @B, @Ls;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC dbo.sp_SaveQuotation @Id = 0, @CompId = @fxComp, @UserId = @fxUser, @LeadId = @fxLead,
                 @TemplateCode = 'classic', @ToName = N'091 fixture', @ToStateCode = @B,
                 @SellerGSTIN = @G, @CompanyJSON = N'{"name":"fixture"}', @LinesJSON = @Ls;
            INSERT INTO @got
            SELECT TOP 1 @F, TaxableTotal, CgstTotal, SgstTotal, IgstTotal, RoundOff, GrandTotal
            FROM dbo.tblQuotation WHERE CompId = @fxComp AND LeadId = @fxLead AND ToName = N'091 fixture' ORDER BY Id DESC;
            FETCH NEXT FROM fx INTO @F, @G, @B, @Ls;
        END
        CLOSE fx; DEALLOCATE fx;

        SELECT 'fixture ' + e.F AS what,
               CASE WHEN g.F IS NOT NULL AND g.Taxable = e.Taxable AND g.Cgst = e.Cgst AND g.Sgst = e.Sgst
                         AND g.Igst = e.Igst AND g.RoundOff = e.RoundOff AND g.Grand = e.Grand
                    THEN 'ok' ELSE 'MISMATCH' END AS state,
               g.Taxable, g.Cgst, g.Sgst, g.Igst, g.RoundOff, g.Grand
        FROM @fx e LEFT JOIN @got g ON g.F = e.F ORDER BY e.F;
    END
-- Guarded: if sp_SaveQuotation itself failed, its CATCH already rolled everything back.
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
```

- [ ] **Step 6: Self-check**

```bash
cd backend/sql
grep -c '^CREATE OR ALTER PROC' 091_quotations.sql      # expect 19  (11 + sp_ConvertLead, sp_SetLeadStatus, sp_DeleteLead, sp_SaveCustomer, sp_SaveProduct, sp_FetchProducts, sp_SaveLookup, sp_DeleteLookup)
grep -c 'EXEC #Patch091' 091_quotations.sql             # expect 12
grep -c 'SET NOEXEC ON' 091_quotations.sql              # expect 5   (§1, §2, §8, §9, §10)
grep -n "Use convert to move a lead to Converted" 091_quotations.sql | wc -l   # expect 1 — the refusal stayed
```

Then check by eye: every `@Old` argument to `#Patch091` is a **single line** and is **character-for-character** one of the fragments Step 1 proved exists; no `@New` argument (other than the dashboard's and the join's, which are guarded by their own marker) contains its own `@Old`; the fixture block begins with `BEGIN TRANSACTION` and ends with `IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;` — it must never `COMMIT`.

- [ ] **Step 7: Stop and report**

Report: both pre-flight result sets and the four self-check numbers. Do not apply the script. Do not stage or commit.

---

### Task 4: Backend `utils/mobile.js`; lead + customer saves normalise

**Files:**
- Create: `backend/src/utils/mobile.js`
- Create: `backend/tests/unit/utils/mobile.test.js`
- Modify: `backend/src/controllers/leadController.js` (`save`)
- Modify: `backend/src/controllers/customerController.js` (`save`)
- Modify: `backend/tests/unit/controllers/leadController.test.js`, `backend/tests/unit/controllers/customerController.test.js`

**Interfaces:**
- Produces: `normalizeMobile(raw) → string|null`, `applyMobiles(fields, [[key, label], …]) → string|null` (mutates `fields`, returns an error message or `null`), `MOBILE_MESSAGE`. Task 6 uses `applyMobiles` for `ToMobile`.

The backend is the trust boundary: the web input (Task 10) is a convenience, the DB `CHECK` (Task 1) is a backstop, and this is the one place a mobile is *made* right. It runs **before** any DB call.

- [ ] **Step 1: Write the failing util test**

Create `backend/tests/unit/utils/mobile.test.js`:

```js
const { normalizeMobile, applyMobiles, MOBILE_MESSAGE } = require("../../../src/utils/mobile");

describe("normalizeMobile", () => {
  it.each([
    ["9825012345", "9825012345"],
    ["98250 12345", "9825012345"],
    ["98250-12345", "9825012345"],
    ["(98250) 12345", "9825012345"],
    ["+91 98250 12345", "9825012345"],
    ["+919825012345", "9825012345"],
    ["919825012345", "9825012345"],
    ["09825012345", "9825012345"],
    [9825012345, "9825012345"],
  ])("%p → %p", (raw, out) => expect(normalizeMobile(raw)).toBe(out));

  // The live rows that prompted this: '111', '44774445555', two 9-digit typos.
  it.each([["111"], ["44774445555"], ["903315499"], ["98250123456"], ["abcdefghij"], [""], ["   "], [null], [undefined]])(
    "%p is not a mobile",
    (raw) => expect(normalizeMobile(raw)).toBeNull(),
  );

  // 12 digits only lose their prefix when the prefix is 91 — an arbitrary
  // 12-digit string is junk, not a number with a country code.
  it("drops a leading 91 or 0 only at exactly 12 / 11 digits", () => {
    expect(normalizeMobile("449825012345")).toBeNull();
    expect(normalizeMobile("19825012345")).toBeNull();
    expect(normalizeMobile("9198250123")).toBe("9198250123"); // ten digits that happen to start 91
  });
});

describe("applyMobiles", () => {
  it("rewrites each field in place and returns null when all are fine", () => {
    const f = { MobileNo: "+91 98250 12345", AltMobile: "" };
    expect(applyMobiles(f, [["MobileNo", "Mobile number"], ["AltMobile", "Alternate mobile"]])).toBeNull();
    expect(f).toEqual({ MobileNo: "9825012345", AltMobile: null });
  });

  it("names the field that is wrong, and stops there", () => {
    const f = { MobileNo: "9825012345", AltMobile: "123" };
    expect(applyMobiles(f, [["MobileNo", "Mobile number"], ["AltMobile", "Alternate mobile"]]))
      .toBe("Alternate mobile must be 10 digits");
  });

  it("treats a missing key as blank", () => {
    const f = {};
    expect(applyMobiles(f, [["Mobile", "Mobile number"]])).toBeNull();
    expect(f.Mobile).toBeNull();
  });

  it("exports the default sentence both clients render", () => {
    expect(MOBILE_MESSAGE).toBe("Mobile number must be 10 digits");
  });
});
```

- [ ] **Step 2: Run it — it must fail**

Run: `cd backend && pnpm exec jest tests/unit/utils/mobile.test.js --maxWorkers=2 --silent`
Expected: FAIL — `Cannot find module '../../../src/utils/mobile'`.

- [ ] **Step 3: Write the util**

Create `backend/src/utils/mobile.js`:

```js
// src/utils/mobile.js
//
// A mobile number is ten digits. That was never written down anywhere, so
// nothing enforced it: the lead form checked "not empty", sp_SaveLead stored
// what it was given, and sp_SaveCustomer stripped spaces but still accepted
// '+' and any length. tblCustomer ended up holding '+919310500657', '111' and
// '44774445555' on the one column whose job is telling two customers apart —
// and sp_ConvertLead (091) matches on it.
//
// This is the one place a number is made right. The web's input is a
// convenience and the DB CHECK constraint is a backstop; the backend is the
// trust boundary, so the mobile app and any future caller get this for free.

const MOBILE_MESSAGE = "Mobile number must be 10 digits";

/** "+91 98250-12345" → "9825012345". Anything that is not ten digits afterwards → null. */
function normalizeMobile(raw) {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * Normalises the named fields in place. Blank stays null (a mobile is optional
 * wherever this is used); a value that cannot be made into ten digits returns
 * the sentence to 400 with, and leaves the rest untouched.
 *
 * @param {object} fields
 * @param {Array<[string, string]>} pairs  [key, human label]
 * @returns {string|null} error message, or null
 */
function applyMobiles(fields, pairs) {
  for (const [key, label] of pairs) {
    const raw = fields[key];
    if (raw == null || String(raw).trim() === "") {
      fields[key] = null;
      continue;
    }
    const value = normalizeMobile(raw);
    if (!value) return `${label} must be 10 digits`;
    fields[key] = value;
  }
  return null;
}

module.exports = { normalizeMobile, applyMobiles, MOBILE_MESSAGE };
```

- [ ] **Step 4: Run it — it must pass, with coverage**

Run: `cd backend && pnpm exec jest tests/unit/utils/mobile.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/utils/mobile.js'`
Expected: PASS, 100 % lines and branches.

- [ ] **Step 5: Controller tests first**

In `backend/tests/unit/controllers/leadController.test.js`:

1. In `EDIT_BODY`, change `MobileNo: "9"` to `MobileNo: "9825012345"` — `"9"` is not a mobile any more, and every test built on this fixture would otherwise 400 before reaching what it tests.
2. Inside `describe("leadController.save", …)`, add:

```js
  // REGRESSION (2026-09-18): nothing normalised a mobile, so '+91 98250 12345'
  // and '9825012345' were two different leads and, after conversion, two
  // different customers.
  it("normalises the mobiles to ten digits before the SP sees them", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 44 }],
    });
    await leadController.save(
      baseReq({ body: { ...EDIT_BODY, Id: 0, OwnerId: null, MobileNo: "+91 98250-12345", AltMobile: "098250 99999" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      MobileNo: "9825012345", AltMobile: "9825099999",
    });
  });

  it("400s a mobile that cannot be ten digits, before touching the DB", async () => {
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0, MobileNo: "12345" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR", message: "Mobile number must be 10 digits" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("names the alternate mobile when that is the bad one", async () => {
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0, AltMobile: "111" } }), res);
    expect(res.json.mock.calls[0][0].message).toBe("Alternate mobile must be 10 digits");
  });
```

In `backend/tests/unit/controllers/customerController.test.js`:

1. In the first test (`creates: injects Id=0 …`), the body still sends `FULL` with `Mobile: "98765 43210"`, but the **expected SP params** must now read `Mobile: "9876543210"` (line 48 — change only the expectation, that is the point of the test).
2. In `accepts email-only and mobile-only customers`, change `Mobile: "9"` to `Mobile: "9876500000"`.
3. Add after that test:

```js
  it("400s a mobile that cannot be ten digits, before touching the DB", async () => {
    const res = mockRes();
    await customerController.save(baseReq({ body: { Name: "B", Mobile: "111" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Mobile number must be 10 digits");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("forwards the GSTIN, upper-cased and unspaced", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await customerController.save(baseReq({ body: { ...FULL, GSTIN: " 24abcde1234f1z5 " } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].GSTIN).toBe("24ABCDE1234F1Z5");
  });
```

4. The first test asserts the **exact** param object with `toHaveBeenCalledWith` — add `GSTIN: null` to that expected object (the controller now always sends the key).

Run each file; both must FAIL on the new tests:
`cd backend && pnpm exec jest tests/unit/controllers/leadController.test.js --maxWorkers=2 --silent`
`cd backend && pnpm exec jest tests/unit/controllers/customerController.test.js --maxWorkers=2 --silent`

- [ ] **Step 6: Implement**

`backend/src/controllers/leadController.js` — add the import under the `controllerKit` require:

```js
const { applyMobiles } = require("../utils/mobile");
```

and in `save`, directly after `const fields = pick(req.body, LEAD_FIELDS);`:

```js
    // Before anything touches the DB. sp_ConvertLead matches a customer on this
    // column, so it has to mean one thing: ten digits (utils/mobile.js).
    const mobileError = applyMobiles(fields, [["MobileNo", "Mobile number"], ["AltMobile", "Alternate mobile"]]);
    if (mobileError) return responseHelper.validationError(res, mobileError);
```

`backend/src/controllers/customerController.js` — add the same import; add `"GSTIN"` to the end of `CUSTOMER_FIELDS`; and in `save`, directly after the `Mobile or Email is required` check:

```js
    const mobileError = applyMobiles(fields, [["Mobile", "Mobile number"], ["AltMobile", "Alternate mobile"]]);
    if (mobileError) return responseHelper.validationError(res, mobileError);
    // Stored the way it is printed on a registration: upper case, no spaces.
    fields.GSTIN = trimmed(fields.GSTIN)?.toUpperCase().replace(/\s+/g, "") ?? null;
```

- [ ] **Step 7: Green, with coverage**

```bash
cd backend && pnpm exec jest tests/unit/controllers/leadController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/leadController.js'
cd backend && pnpm exec jest tests/unit/controllers/customerController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/customerController.js'
```
Expected: PASS, both files ≥ 80 % lines and branches.

- [ ] **Step 8: Stop and report** — test counts, coverage numbers, the fixtures you changed and why. Do not stage or commit.

---

### Task 5: `permission.js` entities · `upload.js` · attachment guards

**Files:**
- Modify: `backend/src/middleware/permission.js` (`ENTITY_LOOKUP`, `assertRecordAccess`)
- Modify: `backend/src/middleware/upload.js` (`ENTITIES`)
- Modify: `backend/src/controllers/attachmentController.js` (`save`, `delete`)
- Modify: `backend/tests/unit/middleware/permission.test.js`, `upload.test.js`, `backend/tests/unit/controllers/attachmentController.test.js`

**Interfaces:**
- Consumes: `sp_FetchQuotationDetail` (RS1 carries the lead's `OwnerId`/`BranchId`/`CreatedBy` + `Status`), `sp_FetchQuoteProfileById`.
- Produces: `assertRecordAccess(req, res, "quotation", id)` → the quotation header row or `false`; `assertRecordAccess(req, res, "quoteprofile", id)` → the profile row for **any** user of the company. Attachment rules: upload to a `quotation` only while it is a `draft`; delete from a `quotation` only while `draft`; **never** delete from a `quoteprofile`.

Why the profile is company-wide: every agent who can write a quotation must be able to draw the letterhead, whatever their data scope. Why its images are never deleted: a finalised quotation re-renders from the attachment id it was issued with, forever.

- [ ] **Step 1: Failing tests**

`backend/tests/unit/middleware/permission.test.js` — inside `describe("assertRecordAccess", …)`, reusing that block's existing `selfReq` and `mockRes`:

```js
    // A quotation has no permission model of its own: sp_FetchQuotationDetail
    // returns the LEAD's OwnerId / BranchId / CreatedBy, so canSeeRecord
    // answers for the lead without knowing a quotation exists.
    it("gates a quotation on its parent lead's visibility", async () => {
      const quote = { Id: 4, LeadId: 9, Status: "draft", OwnerId: selfReq.user.UserId, BranchId: 2, CreatedBy: 99 };
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[quote], [], []] });
      await expect(assertRecordAccess(selfReq, mockRes(), "quotation", 4)).resolves.toEqual(quote);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchQuotationDetail", {
        CompId: selfReq.user.CompId, QuotationId: 4,
      });
    });

    it("403s a quotation whose lead the caller cannot see", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({
        recordsets: [[{ Id: 4, Status: "draft", OwnerId: 999, BranchId: 77, CreatedBy: 999 }], [], []],
      });
      const res = mockRes();
      await expect(assertRecordAccess(selfReq, res, "quotation", 4)).resolves.toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    // The letterhead is the company's. A Self-scoped agent in another branch
    // must still be able to draw the logo on a quotation.
    it("lets any user of the company read a quote profile, whatever their scope", async () => {
      const profile = { Id: 3, CompId: selfReq.user.CompId, BranchId: 77, IsSet: true };
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[profile]] });
      await expect(assertRecordAccess(selfReq, mockRes(), "quoteprofile", 3)).resolves.toEqual(profile);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchQuoteProfileById", {
        CompId: selfReq.user.CompId, ProfileId: 3,
      });
    });

    it("403s a quote profile that is not in the caller's company (the SP returns nothing)", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
      await expect(assertRecordAccess(selfReq, mockRes(), "quoteprofile", 3)).resolves.toBe(false);
    });
```

`backend/tests/unit/middleware/upload.test.js` — add:

```js
  // Keep in step with sp_SaveAttachment's whitelist (091 §4).
  it("accepts quotation and quoteprofile uploads", () => {
    expect([...ENTITIES].sort()).toEqual(["lead", "quotation", "quoteprofile", "task", "ticket"]);
  });
```

`backend/tests/unit/controllers/attachmentController.test.js` — add a lookup helper beside the others and two `describe` blocks at the end of the file:

```js
function mockQuotationLookup(quote) {
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [quote ? [quote] : [], [], []] });
}
const draftQuote = { Id: 4, LeadId: 9, Status: "draft", OwnerId: 7, BranchId: 2, CreatedBy: 7 };

describe("attachmentController — quotation images", () => {
  const file = { originalname: "site.jpg", filename: "q-1.jpg", size: 2048, mimetype: "image/jpeg", path: "/app/uploads/quotation/q-1.jpg" };

  it("accepts an upload to a draft quotation", async () => {
    mockQuotationLookup(draftQuote);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 201, ResponseMess: "Attachment saved", AttachmentId: 55 }]],
    });
    const res = mockRes();
    await attachmentController.save(baseReq({ body: { Entity: "quotation", EntityId: 4 }, file }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.attachmentId).toBe(55);
  });

  // An issued quotation is frozen — including its pictures.
  it("refuses an upload to a quotation that is no longer a draft", async () => {
    mockQuotationLookup({ ...draftQuote, Status: "final" });
    const res = mockRes();
    await attachmentController.save(baseReq({ body: { Entity: "quotation", EntityId: 4 }, file }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toMatch(/only a draft/i);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // the lookup; never sp_SaveAttachment
  });

  it("refuses to delete a picture from a finalised quotation", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 55, Entity: "quotation", EntityId: 4 }]] });
    mockQuotationLookup({ ...draftQuote, Status: "final" });
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: { Id: 55 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_DeleteAttachment", expect.anything());
  });

  it("deletes a picture from a draft quotation", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 55, Entity: "quotation", EntityId: 4 }]] });
    mockQuotationLookup(draftQuote);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Deleted", Entity: "quotation", StoredName: "q-1.jpg" }]],
    });
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: { Id: 55 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("attachmentController — letterhead images", () => {
  // A finalised quotation re-renders from the attachment id it was issued
  // with. Deleting a logo would blank every quotation that ever carried it.
  it("never deletes a quoteprofile image", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 60, Entity: "quoteprofile", EntityId: 3 }]] });
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: { Id: 60 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toMatch(/issued quotations/i);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // the row lookup only
  });
});
```

> The existing suite's `attachmentController.delete` tests mock `sp_FetchAttachments` rows through `cleanSpRows(lookup.recordsets[0], "Id")`. If a row in the new tests is dropped by `cleanSpRows` (open `src/utils/spHelpers.js` — it filters rows whose key column is null/0), the fixtures above already carry a real `Id`, so they survive.

Run each of the three files; the new tests must FAIL.

- [ ] **Step 2: Implement**

`backend/src/middleware/upload.js` — replace the `ENTITIES` line and the file's first comment line:

```js
// Multipart upload handling for attachments (tasks / tickets / leads /
// quotation pictures / branch letterheads).
```
```js
// Keep in step with sp_SaveAttachment's whitelist (backend/sql/091 §4).
const ENTITIES = new Set(["task", "ticket", "lead", "quotation", "quoteprofile"]);
```

`backend/src/middleware/permission.js` — replace `ENTITY_LOOKUP`:

```js
const ENTITY_LOOKUP = {
  lead: { sp: "sp_FetchLeadDetail", idParam: "LeadId", ownerField: "OwnerId" },
  ticket: { sp: "sp_FetchTicketDetail", idParam: "TicketId", ownerField: "AssignedTo" },
  // A quotation has no permission model of its own. sp_FetchQuotationDetail
  // returns its LEAD's OwnerId / BranchId / CreatedBy under those names, so
  // canSeeRecord answers for the lead: whoever can see the lead can see its
  // quotations, and a transferred lead carries them along.
  quotation: { sp: "sp_FetchQuotationDetail", idParam: "QuotationId", ownerField: "OwnerId" },
  // The branch letterhead (logo + header image). Company-wide on purpose:
  // every agent who may write a quotation must be able to draw it, whatever
  // their data scope. The SP's CompId filter is the whole gate.
  quoteprofile: { sp: "sp_FetchQuoteProfileById", idParam: "ProfileId", companyWide: true },
};
```

and inside `assertRecordAccess`, replace the two lines

```js
      const record = result.recordsets?.[0]?.[0] || null;
      granted = canSeeRecord(req, record, ownerField) ? record : false;
```
with
```js
      const record = result.recordsets?.[0]?.[0] || null;
      granted = companyWide
        ? record || false
        : canSeeRecord(req, record, ownerField) ? record : false;
```
and the destructure above it from `const { sp, idParam, ownerField } = ENTITY_LOOKUP[entity];` to `const { sp, idParam, ownerField, companyWide } = ENTITY_LOOKUP[entity];`.

`backend/src/controllers/attachmentController.js`:

Add, above the class:

```js
// An issued quotation is frozen, pictures included; and a letterhead image is
// never deleted, because every quotation issued with it re-renders from its id.
const refusal = (res, message) => res.status(409).json({
  success: false, message, code: "CONFLICT", responseCode: 409, timestamp: new Date().toISOString(),
});
const DRAFT_ONLY = "Only a draft quotation's pictures can be changed";
```

In `save`, find the access check (it reads `if (!(await assertRecordAccess(req, res, String(Entity), Number(EntityId), ATTACH_LEVEL(Entity)))) {` … `unlinkQuiet(file.path); return; }`). Change it to keep the returned record and refuse a non-draft quotation:

```js
      const parent = await assertRecordAccess(req, res, String(Entity), Number(EntityId), ATTACH_LEVEL(Entity));
      if (!parent) {
        unlinkQuiet(file.path); // 403 already sent → clean the just-written file
        return;
      }
      if (String(Entity) === "quotation" && parent.Status !== "draft") {
        unlinkQuiet(file.path);
        return refusal(res, DRAFT_ONLY);
      }
```

In `delete`, directly after the `if (!row) { … 404 … }` block and **before** the existing `assertRecordAccess` line:

```js
      if (row.Entity === "quoteprofile") {
        return refusal(res, "Letterhead images are kept — issued quotations still use them");
      }
```
and change the existing access line to keep the record:
```js
      const parent = await assertRecordAccess(req, res, row.Entity, row.EntityId, ATTACH_LEVEL(row.Entity));
      if (!parent) return;
      if (row.Entity === "quotation" && parent.Status !== "draft") return refusal(res, DRAFT_ONLY);
```

Finally update `tests/unit/controllers/tenancyContract.test.js` **only if it fails** after this task — `assertRecordAccess` is already a known wrapper and its one call site still passes `CompId`, so it should not.

- [ ] **Step 3: Green, with coverage — one file per run**

```bash
cd backend && pnpm exec jest tests/unit/middleware/permission.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/middleware/permission.js'
cd backend && pnpm exec jest tests/unit/middleware/upload.test.js --maxWorkers=2 --silent
cd backend && pnpm exec jest tests/unit/controllers/attachmentController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/attachmentController.js'
cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent
```
Expected: all PASS; the two source files ≥ 80 %.

- [ ] **Step 4: Stop and report.** Do not stage or commit.

---

### Task 6: `quotationController` save / fetch / detail + routes + registration

**Files:**
- Create: `backend/src/controllers/quotationController.js`
- Create: `backend/src/routes/quotationRoutes.js`
- Modify: `backend/src/config/routes.js` (register `/api/quotations`)
- Modify: `backend/tests/unit/controllers/tenancyContract.test.js` (`KNOWN_WRAPPERS`)
- Create: `backend/tests/unit/controllers/quotationController.test.js`
- Create: `backend/tests/unit/routes/quotationRoutes.test.js`

**Interfaces:**
- Consumes: `assertRecordAccess` for `"lead"` and `"quotation"` (Task 5), `applyMobiles` (Task 4), `scopeParams`, `canSeeRecord`, `positiveInt`, `pageParams`, `parseDay` (`utils/reportKit`).
- Produces: `save`, `fetch`, `detail` on the controller; `TEMPLATE_CODES`, `MAX_HTML`, `MAX_LINES` exported for Task 7. Response shapes: `fetch → { quotations, pagination }`, `detail → { quotation, lines, revisions }` where `quotation.Company` and `quotation.Content` are **parsed objects** (the raw `CompanyJSON` / `ContentJSON` strings are dropped, so the payload is not sent twice).

Two things the tenancy guard (`tenancyContract.test.js`) checks mechanically — write the calls so it can see them:
- every `runSp(res, "sp_…", { … })` params literal contains the text `CompId` and **nests no `{`**;
- every direct `executeStoredProcedure("sp_…", {` literal is **multi-line** (closing `}` on its own line) and contains `CompId`.

- [ ] **Step 1: Failing tests**

Create `backend/tests/unit/controllers/quotationController.test.js`:

```js
jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const quotationController = require("../../../src/controllers/quotationController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: {
      hierarchyLevel: 3, dataScope: "Branch", primaryBranchId: 2,
      branchIds: [2], ownerIds: null, canWriteBranchIds: [2], isAdmin: false,
    },
    body: {},
    ...overrides,
  };
}

beforeEach(() => database.executeStoredProcedure.mockReset());

// The two gate lookups. A quotation's header carries its LEAD's owner/branch.
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 };
const hiddenLead = { Id: 9, BranchId: 77, OwnerId: 999, CreatedBy: 999 };
const draft = { Id: 4, LeadId: 9, Status: "draft", OwnerId: 7, BranchId: 2, CreatedBy: 7 };
const mockLead = (lead) => database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [lead ? [lead] : [], [], [], [], []] });
const mockQuote = (q) => database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [q ? [q] : [], [], []] });
const okRow = (extra = {}) => ({ recordset: [{ Id: 4, ResponseCode: 200, ResponseMess: "Quotation saved", ...extra }] });

const BODY = {
  LeadId: 9, TemplateCode: "modern", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "5 kW rooftop",
  ToName: "Ramesh Patel", ToCompany: null, ToMobile: "+91 98250 12345", ToEmail: "r@p.in",
  ToAddress: "12 SG Road", ToCity: "Ahmedabad", ToStateCode: "24", ToPincode: "380015", ToGSTIN: " 24aaaaa0000a1z5 ",
  Company: { name: "Solar Care", gstin: "24abcde1234f1z5", stateCode: "99", accent: "#1e3a8a", logoAttachmentId: 12 },
  Content: { intro: "<p>Dear Ramesh ji</p>", terms: "<p>50% advance</p>", notes: "", sections: [{ type: "text", title: "Why us", body: "<p>x</p>" }] },
  Lines: [{ productId: 7, description: "5 kW Solar Rooftop", hsn: "8541", qty: "1", unit: "Nos", rate: "280000", discountType: "amt", discountValue: "10000", taxPct: "12", lineTotal: 999999 }],
};

describe("quotationController.save", () => {
  it("creates on a lead the caller can see, and sends the SP exactly its parameters", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await quotationController.save(baseReq({ body: { ...BODY, CompId: 999, GrandTotal: 1 } }), res);

    const [sp, p] = database.executeStoredProcedure.mock.calls[1];
    expect(sp).toBe("sp_SaveQuotation");
    expect(p).toMatchObject({
      Id: 0, CompId: 5, UserId: 7, LeadId: 9, TemplateCode: "modern",
      QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "5 kW rooftop",
      ToName: "Ramesh Patel", ToMobile: "9825012345", ToStateCode: "24", ToGSTIN: "24AAAAA0000A1Z5",
      SellerGSTIN: "24ABCDE1234F1Z5",
    });
    // The web never sends a total, and one that is sent goes nowhere.
    expect(p).not.toHaveProperty("GrandTotal");
    expect(JSON.parse(p.LinesJSON)).toEqual([{
      productId: 7, description: "5 kW Solar Rooftop", hsn: "8541", qty: 1, unit: "Nos",
      rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12,
    }]);
    expect(JSON.parse(p.CompanyJSON).name).toBe("Solar Care");
    expect(JSON.parse(p.ContentJSON).sections).toHaveLength(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // The seller's state is LEFT(GSTIN, 2) and the SP derives it. Whatever the
  // client claims travels along and is ignored — asserted here so nobody "fixes"
  // the controller into trusting it.
  it("passes the company block's state through without trusting it", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await quotationController.save(baseReq({ body: BODY }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1].SellerStateCode).toBe("99");
  });

  it("403s a create on a lead the caller cannot see, before the SP", async () => {
    mockLead(hiddenLead);
    const res = mockRes();
    await quotationController.save(baseReq({ body: BODY }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("on update gates on the QUOTATION and keeps it on its own lead, whatever the body says", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await quotationController.save(baseReq({ body: { ...BODY, Id: 4, LeadId: 12345 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0]).toEqual(["sp_FetchQuotationDetail", { CompId: 5, QuotationId: 4 }]);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ Id: 4, LeadId: 9 });
  });

  it.each([
    [{ LeadId: undefined }, "LeadId is required"],
    [{ TemplateCode: "fancy" }, "Unknown template"],
    [{ ToMobile: "12345" }, "Mobile number must be 10 digits"],
    [{ ToStateCode: "GJ" }, "Place of supply must be a 2-digit state code"],
    [{ QuoteDate: "2026-02-30" }, "QuoteDate must be YYYY-MM-DD"],
    [{ Lines: "nope" }, "Lines must be a list"],
    [{ Lines: Array.from({ length: 201 }, () => ({ description: "x" })) }, "A quotation can hold at most 200 lines"],
    [{ Content: { intro: "x".repeat(200 * 1024 + 1) } }, "The opening message is too long"],
    [{ Content: { sections: [{ type: "text", body: "x".repeat(200 * 1024 + 1) }] } }, "An extra section is too long"],
  ])("400s %p before touching the DB", async (patch, message) => {
    const res = mockRes();
    await quotationController.save(baseReq({ body: { ...BODY, ...patch } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe(message);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("turns junk numbers in a line into 0 rather than NaN — a draft may be half-typed", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await quotationController.save(baseReq({ body: { ...BODY, Lines: [{ description: "x", qty: "abc", rate: null }] } }), mockRes());
    expect(JSON.parse(database.executeStoredProcedure.mock.calls[1][1].LinesJSON)[0]).toMatchObject({
      qty: 0, rate: 0, discountType: "pct", discountValue: 0, taxPct: 0, productId: null,
    });
  });

  it("surfaces the SP's 409 (not a draft / lead closed) as-is", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 4, ResponseCode: 409, ResponseMess: "Only a draft can be edited — revise this quotation instead" }],
    });
    const res = mockRes();
    await quotationController.save(baseReq({ body: { ...BODY, Id: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toMatch(/revise/);
  });

  it("500s when the DB throws", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await quotationController.save(baseReq({ body: BODY }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("quotationController.fetch", () => {
  it("lists under the caller's scope, clamps paging, and drops filters it does not recognise", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 4, QuoteNo: "QT-2627-0042" }], [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 200 }]],
    });
    const res = mockRes();
    await quotationController.fetch(baseReq({ body: { PageSize: 99999, Status: "final", LeadId: "9", FromDate: "2026-09-01", ToDate: "junk", OwnerId: "x" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchQuotations", {
      CompId: 5, PageNumber: 1, PageSize: 200, SearchTerm: null, Status: "final",
      OwnerId: null, BranchId: null, LeadId: 9, FromDate: "2026-09-01", ToDate: null,
      UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: null,
    });
    expect(res.json.mock.calls[0][0].data).toEqual({
      quotations: [{ Id: 4, QuoteNo: "QT-2627-0042" }],
      pagination: { currentPage: 1, pageSize: 200, totalRecords: 1, totalPages: 1 },
    });
  });

  it("ignores a status that is not one of the six", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [{}]] });
    await quotationController.fetch(baseReq({ body: { Status: "'; DROP" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].Status).toBeNull();
  });

  it("500s when the DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await quotationController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("quotationController.detail", () => {
  const header = { ...draft, QuoteNo: null, CompanyJSON: '{"name":"Solar Care"}', ContentJSON: '{"intro":"<p>hi</p>"}' };

  it("returns header (JSON parsed, raw strings dropped), lines and revisions", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[header], [{ Id: 1 }], [{ Id: 4, Revision: 1 }]] });
    const res = mockRes();
    await quotationController.detail(baseReq({ body: { QuotationId: 4 } }), res);
    const { quotation, lines, revisions } = res.json.mock.calls[0][0].data;
    expect(quotation.Company).toEqual({ name: "Solar Care" });
    expect(quotation.Content).toEqual({ intro: "<p>hi</p>" });
    expect(quotation).not.toHaveProperty("CompanyJSON");
    expect(lines).toEqual([{ Id: 1 }]);
    expect(revisions).toEqual([{ Id: 4, Revision: 1 }]);
  });

  // 404 rather than 403: a user who cannot see a lead should not learn that it
  // has quotations. Same rule as leadController.detail.
  it("404s a quotation whose lead the caller cannot see", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ...header, OwnerId: 999, BranchId: 77, CreatedBy: 999 }], [], []] });
    const res = mockRes();
    await quotationController.detail(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("survives corrupt JSON in a row instead of 500ing the whole page", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ...header, CompanyJSON: "{oops", ContentJSON: null }], [], []] });
    const res = mockRes();
    await quotationController.detail(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.json.mock.calls[0][0].data.quotation).toMatchObject({ Company: {}, Content: {} });
  });

  it("400s without an id; 500s when the DB throws", async () => {
    const res = mockRes();
    await quotationController.detail(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res2 = mockRes();
    await quotationController.detail(baseReq({ body: { QuotationId: 4 } }), res2);
    expect(res2.status).toHaveBeenCalledWith(500);
  });
});
```

Run: `cd backend && pnpm exec jest tests/unit/controllers/quotationController.test.js --maxWorkers=2 --silent`
Expected: FAIL — module not found.

- [ ] **Step 2: Write the controller (this task's three methods)**

Create `backend/src/controllers/quotationController.js`:

```js
// Spec 3: quotations. A quotation has NO permission model of its own — it is
// part of its lead. Every method resolves the parent lead and is gated by the
// lead's visibility (permission.assertRecordAccess): whoever can see the lead
// can see, edit and issue its quotations, and a transferred lead carries them
// along. tblQuotation has no BranchId / OwnerId to go stale.
//
// Totals are never accepted from the client. sp_SaveQuotation computes every
// amount from the lines; anything total-shaped in a request body is dropped.
const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { scopeParams, canSeeRecord, assertRecordAccess } = require("../middleware/permission");
const { positiveInt, pageParams } = require("../utils/controllerKit");
const { applyMobiles } = require("../utils/mobile");
const { parseDay } = require("../utils/reportKit");

const TEMPLATE_CODES = ["classic", "modern", "minimal"];
const STATUSES = ["draft", "final", "accepted", "rejected", "superseded", "unused"];
// One rich-text block. Generous for prose, small enough that a pasted novel (or
// a base64 image someone smuggled into the HTML) is refused rather than stored.
const MAX_HTML = 200 * 1024;
const MAX_LINES = 200;

// Mutating SPs return exactly one status row: Id + ResponseCode + ResponseMess.
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

const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const number = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);
const gstin = (v) => text(v)?.toUpperCase().replace(/\s+/g, "") ?? null;
const isoDay = (s) => (typeof s === "string" && parseDay(s) ? s : null);
const plainObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const tooLong = (html) => typeof html === "string" && html.length > MAX_HTML;
const safeParse = (json) => {
  try { return plainObject(JSON.parse(json)); } catch { return {}; }
};

// Exactly the keys sp_SaveQuotation's OPENJSON reads. Anything else on a line
// — a total the client computed, a React key — is dropped here.
const toLine = (l) => ({
  productId: positiveInt(l?.productId),
  description: text(l?.description) ?? "",
  hsn: text(l?.hsn),
  qty: number(l?.qty),
  unit: text(l?.unit),
  rate: number(l?.rate),
  discountType: l?.discountType === "amt" ? "amt" : "pct",
  discountValue: number(l?.discountValue),
  taxPct: number(l?.taxPct),
});

/** Body → the SP's parameters, or `{ error }`. No DB access. */
function readQuotation(body) {
  if (!TEMPLATE_CODES.includes(body.TemplateCode ?? "classic")) return { error: "Unknown template" };
  if (body.QuoteDate != null && body.QuoteDate !== "" && !isoDay(body.QuoteDate)) return { error: "QuoteDate must be YYYY-MM-DD" };
  if (body.ValidTill != null && body.ValidTill !== "" && !isoDay(body.ValidTill)) return { error: "ValidTill must be YYYY-MM-DD" };

  const state = text(body.ToStateCode);
  if (state && !/^\d{2}$/.test(state)) return { error: "Place of supply must be a 2-digit state code" };

  if (body.Lines != null && !Array.isArray(body.Lines)) return { error: "Lines must be a list" };
  const lines = (body.Lines ?? []).map(toLine);
  if (lines.length > MAX_LINES) return { error: `A quotation can hold at most ${MAX_LINES} lines` };

  const content = plainObject(body.Content);
  if (tooLong(content.intro)) return { error: "The opening message is too long" };
  if (tooLong(content.terms)) return { error: "The terms are too long" };
  if (tooLong(content.notes)) return { error: "The notes are too long" };
  const sections = Array.isArray(content.sections) ? content.sections : [];
  if (sections.some((s) => tooLong(s?.body))) return { error: "An extra section is too long" };

  const to = { ToMobile: body.ToMobile };
  const mobileError = applyMobiles(to, [["ToMobile", "Mobile number"]]);
  if (mobileError) return { error: mobileError };

  const company = plainObject(body.Company);
  return {
    params: {
      TemplateCode: body.TemplateCode ?? "classic",
      QuoteDate: isoDay(body.QuoteDate),
      ValidTill: isoDay(body.ValidTill),
      Subject: text(body.Subject),
      ToName: text(body.ToName),
      ToCompany: text(body.ToCompany),
      ToMobile: to.ToMobile,
      ToEmail: text(body.ToEmail),
      ToAddress: text(body.ToAddress),
      ToCity: text(body.ToCity),
      ToStateCode: state,
      ToPincode: text(body.ToPincode),
      ToGSTIN: gstin(body.ToGSTIN),
      // The SP derives the seller's state from the GSTIN and ignores this when
      // there is one; it only matters for an unregistered seller.
      SellerGSTIN: gstin(company.gstin),
      SellerStateCode: text(company.stateCode),
      CompanyJSON: JSON.stringify(company),
      ContentJSON: JSON.stringify({ ...content, sections }),
      LinesJSON: JSON.stringify(lines),
    },
  };
}

const quotationController = {
  async save(req, res) {
    const { CompId, UserId } = req.user;
    const Id = positiveInt(req.body.Id) ?? 0;
    let LeadId = positiveInt(req.body.LeadId);

    if (Id === 0 && !LeadId) return responseHelper.validationError(res, "LeadId is required");
    const read = readQuotation(req.body);
    if (read.error) return responseHelper.validationError(res, read.error);

    if (Id > 0) {
      // Gate on the quotation itself, and keep it on ITS lead: the body cannot
      // move a quotation to a lead the caller happens to be able to see.
      const quote = await assertRecordAccess(req, res, "quotation", Id, "write");
      if (!quote) return;
      LeadId = quote.LeadId;
    } else if (!(await assertRecordAccess(req, res, "lead", LeadId, "write"))) return;

    return runSp(res, "sp_SaveQuotation", { Id, CompId, UserId, LeadId, ...read.params }, "Failed to save quotation");
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const { SearchTerm = null, Status = null, OwnerId = null, BranchId = null, LeadId = null, FromDate = null, ToDate = null } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      const result = await database.executeStoredProcedure("sp_FetchQuotations", {
        CompId,
        PageNumber,
        PageSize,
        SearchTerm: text(SearchTerm),
        Status: STATUSES.includes(Status) ? Status : null,
        OwnerId: positiveInt(OwnerId),
        BranchId: positiveInt(BranchId),
        LeadId: positiveInt(LeadId),
        FromDate: isoDay(FromDate),
        ToDate: isoDay(ToDate),
        ...scopeParams(req),
      });

      const quotations = result.recordsets?.[0] ?? [];
      const pagination = result.recordsets?.[1]?.[0] ?? {};
      return responseHelper.success(res, "Quotations fetched successfully", {
        quotations,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? quotations.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchQuotations error:", err);
      return responseHelper.error(res, "Failed to fetch quotations");
    }
  },

  async detail(req, res) {
    const { CompId } = req.user;
    const QuotationId = positiveInt(req.body.QuotationId);
    if (!QuotationId) return responseHelper.validationError(res, "QuotationId is required");
    try {
      const result = await database.executeStoredProcedure("sp_FetchQuotationDetail", {
        CompId,
        QuotationId,
      });
      const rs = result.recordsets ?? [];
      const row = rs[0]?.[0] || null;
      // RS1 carries the LEAD's OwnerId / BranchId / CreatedBy. 404 rather than
      // 403: a user who cannot see a lead should not learn it has quotations.
      if (!canSeeRecord(req, row, "OwnerId")) {
        return responseHelper.error(res, "Quotation not found", "NOT_FOUND", 404);
      }
      const { CompanyJSON, ContentJSON, ...quotation } = row;
      return responseHelper.success(res, "Quotation fetched successfully", {
        quotation: { ...quotation, Company: safeParse(CompanyJSON), Content: safeParse(ContentJSON) },
        lines: rs[1] || [],
        revisions: rs[2] || [],
      });
    } catch (err) {
      console.error("sp_FetchQuotationDetail error:", err);
      return responseHelper.error(res, "Failed to fetch quotation");
    }
  },
};

module.exports = quotationController;
module.exports.TEMPLATE_CODES = TEMPLATE_CODES;
module.exports.MAX_HTML = MAX_HTML;
module.exports.MAX_LINES = MAX_LINES;
```

- [ ] **Step 3: Routes + registration + tenancy registry**

Create `backend/src/routes/quotationRoutes.js`:

```js
const express = require("express");
const quotationController = require("../controllers/quotationController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// loadScope populates req.scope: the list is filtered by it, and every other
// endpoint is gated on the parent lead through assertRecordAccess. There is no
// requireAdmin here on purpose — a quotation is a salesperson's tool. The one
// admin rule (changing a branch's saved letterhead) is enforced where the
// IsSet flag lives: in sp_SaveQuoteProfile, fed req.scope.isAdmin.
router.use(verifyToken, loadScope);

router.post("/saveQuotation", requirePayload, quotationController.save);
router.post("/fetchQuotations", allowEmptyPayload, quotationController.fetch);
router.post("/fetchQuotationDetail", requirePayload, quotationController.detail);

module.exports = router;
```

In `backend/src/config/routes.js`: add `const quotationRoutes = require("../routes/quotationRoutes");` after the `leadRoutes` require, and `app.use("/api/quotations", quotationRoutes);` after the `/api/leads` line.

In `backend/tests/unit/controllers/tenancyContract.test.js`: add `"quotationController.js:runSp",` to `KNOWN_WRAPPERS` (after `"leadController.js:runSp"`), and add `quotation` to the comment listing the controllers that use `runSp`.

Create `backend/tests/unit/routes/quotationRoutes.test.js`:

```js
// The controller suite tests the handlers; this tests that they are reachable,
// that every route sits behind verifyToken + loadScope, and that requirePayload
// guards everything but the list.

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => { req.user = { UserId: 7, CompId: 5, BranchId: 2 }; next(); },
}));
jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return { ...actual, loadScope: (req, res, next) => { req.scope = { isAdmin: false, branchIds: [2], ownerIds: [7] }; next(); } };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name, scoped: Boolean(req.scope) }));
jest.mock("../../../src/controllers/quotationController", () => ({
  save: hit("save"), fetch: hit("fetch"), detail: hit("detail"),
  finalise: hit("finalise"), revise: hit("revise"), reject: hit("reject"), remove: hit("remove"),
  ensureProfile: hit("ensureProfile"), saveProfile: hit("saveProfile"),
}));

const express = require("express");
const request = require("supertest");
const quotationRoutes = require("../../../src/routes/quotationRoutes");

const app = express();
app.use(express.json());
app.use("/api/quotations", quotationRoutes);

const ROUTES = [
  ["saveQuotation", { LeadId: 9 }, "save"],
  ["fetchQuotations", {}, "fetch"],
  ["fetchQuotationDetail", { QuotationId: 4 }, "detail"],
];

describe("quotationRoutes", () => {
  it.each(ROUTES)("routes %s to its handler, scoped", async (path, body, handler) => {
    const r = await request(app).post(`/api/quotations/${path}`).send(body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ hit: handler, scoped: true });
  });

  it("requires a payload on every route but the list", async () => {
    for (const [path] of ROUTES.filter(([p]) => p !== "fetchQuotations")) {
      expect((await request(app).post(`/api/quotations/${path}`).send({})).status).toBe(400);
    }
    expect((await request(app).post("/api/quotations/fetchQuotations").send({})).status).toBe(200);
  });

  it("answers only POST", async () => {
    expect((await request(app).get("/api/quotations/fetchQuotations")).status).toBe(404);
  });
});
```

- [ ] **Step 4: Green, with coverage — one file per run**

```bash
cd backend && pnpm exec jest tests/unit/controllers/quotationController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/quotationController.js'
cd backend && pnpm exec jest tests/unit/routes/quotationRoutes.test.js --maxWorkers=2 --silent
cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent
```
Expected: all PASS; controller ≥ 80 % lines and branches.

- [ ] **Step 5: Stop and report.** Do not stage or commit.

---

### Task 7: `quotationController` finalise / revise / reject / delete + profile

**Files:**
- Modify: `backend/src/controllers/quotationController.js`
- Modify: `backend/src/routes/quotationRoutes.js`
- Modify: `backend/tests/unit/controllers/quotationController.test.js`, `backend/tests/unit/routes/quotationRoutes.test.js`

**Interfaces:**
- Consumes: Task 6's module-level helpers in the same file (`runSp`, `text`, `tooLong`, `gstin`). This task **adds** the `attachmentController` require (Task 6 does not have it — `remove` is the first use) and calls `attachmentController.cascadeDelete(compId, entity, entityId)`.
- Produces: `finalise`, `revise`, `reject`, `remove`, `ensureProfile`, `saveProfile`. (`remove`, not `delete` — a reserved word makes a poor method name to destructure.) `ensureProfile → { profile }`.

**The profile's branch is the lead's branch**, not the caller's: a regional manager quoting for a Mumbai lead gets Mumbai's letterhead and GSTIN. That is why both profile endpoints take a `LeadId` and nothing else identifies the branch.

- [ ] **Step 1: Failing tests**

Append to `backend/tests/unit/controllers/quotationController.test.js`:

```js
describe("quotationController lifecycle", () => {
  it.each([
    ["finalise", "sp_FinaliseQuotation", { QuotationId: 4 }, { CompId: 5, QuotationId: 4, UserId: 7 }],
    ["revise", "sp_ReviseQuotation", { QuotationId: 4 }, { CompId: 5, QuotationId: 4, UserId: 7 }],
    ["reject", "sp_RejectQuotation", { QuotationId: 4, Remarks: "  too expensive " }, { CompId: 5, QuotationId: 4, UserId: 7, Remarks: "too expensive" }],
  ])("%s gates on the quotation, then runs %s", async (method, sp, body, params) => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ QuoteNo: "QT-2627-0042" }));
    const res = mockRes();
    await quotationController[method](baseReq({ body }), res);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual([sp, params]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each(["finalise", "revise", "reject", "remove"])("%s 400s without an id and 403s a hidden lead", async (method) => {
    const res = mockRes();
    await quotationController[method](baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();

    mockQuote({ ...draft, OwnerId: 999, BranchId: 77, CreatedBy: 999 });
    const res2 = mockRes();
    await quotationController[method](baseReq({ body: { QuotationId: 4 } }), res2);
    expect(res2.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("finalise hands the quote number back", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ QuoteNo: "QT-2627-0042" }));
    const res = mockRes();
    await quotationController.finalise(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.json.mock.calls[0][0].data.QuoteNo).toBe("QT-2627-0042");
  });

  it("surfaces the SP's 400 (no lines / no place of supply) with its sentence", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 4, ResponseCode: 400, ResponseMess: "Choose the customer's state — GST depends on it", QuoteNo: null }],
    });
    const res = mockRes();
    await quotationController.finalise(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/GST depends on it/);
  });
});

describe("quotationController.remove", () => {
  it("deletes a draft, then clears the pictures uploaded to it", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ Id: 4, ResponseCode: 200, ResponseMess: "Draft deleted" }] });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] }); // cascade
    const res = mockRes();
    await quotationController.remove(baseReq({ body: { QuotationId: 4 } }), res);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_DeleteQuotation", { CompId: 5, QuotationId: 4 }]);
    expect(database.executeStoredProcedure.mock.calls[2]).toEqual([
      "sp_DeleteAttachmentsByEntity", { CompId: 5, Entity: "quotation", EntityId: 4 },
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // An issued quotation is a record. The SP says so; nothing is cleaned up.
  it("passes the SP's 409 through and leaves the attachments alone", async () => {
    mockQuote({ ...draft, Status: "final" });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ Id: 4, ResponseCode: 409, ResponseMess: "Only a draft can be deleted" }] });
    const res = mockRes();
    await quotationController.remove(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
  });

  it("500s when the DB throws", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await quotationController.remove(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("quotationController profile", () => {
  const PROFILE = {
    CompanyName: " Solar Care Pvt Ltd ", Address: "1 Ring Road", City: "Ahmedabad", StateCode: "24", Pincode: "380001",
    GSTIN: "24abcde1234f1z5", Phone: "079-2658", Email: "hi@solar.in", Website: "solar.in", BankDetails: "HDFC 123",
    DefaultIntro: "<p>Dear customer</p>", DefaultTerms: "<p>50% advance</p>", SignatoryName: "Amit",
    LogoAttachmentId: "12", HeaderAttachmentId: null, AccentColor: "#1e3a8a", DefaultTemplate: "modern",
  };

  // A regional manager (branch 2) quoting for a lead in branch 6 gets branch 6's
  // letterhead — the LEAD's branch, never req.user.BranchId.
  it("ensures the profile of the LEAD's branch", async () => {
    mockLead({ ...visibleLead, BranchId: 6 });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3, BranchId: 6, IsSet: false }]] });
    const res = mockRes();
    await quotationController.ensureProfile(baseReq({ body: { LeadId: 9 } }), res);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_EnsureQuoteProfile", { CompId: 5, BranchId: 6, UserId: 7 }]);
    expect(res.json.mock.calls[0][0].data.profile).toEqual({ Id: 3, BranchId: 6, IsSet: false });
  });

  it("ensureProfile 400s without a lead, 403s a hidden one, 500s on a DB error", async () => {
    const res = mockRes();
    await quotationController.ensureProfile(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    mockLead(hiddenLead);
    const res2 = mockRes();
    await quotationController.ensureProfile(baseReq({ body: { LeadId: 9 } }), res2);
    expect(res2.status).toHaveBeenCalledWith(403);

    mockLead(visibleLead);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res3 = mockRes();
    await quotationController.ensureProfile(baseReq({ body: { LeadId: 9 } }), res3);
    expect(res3.status).toHaveBeenCalledWith(500);
  });

  it("saves with the caller's admin bit and the lead's branch; the SP owns the IsSet rule", async () => {
    mockLead({ ...visibleLead, BranchId: 6 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 3 }));
    await quotationController.saveProfile(baseReq({ body: { LeadId: 9, ...PROFILE, CompId: 999, IsAdmin: 1, IsSet: 0 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_SaveQuoteProfile", {
      CompId: 5, BranchId: 6, UserId: 7, IsAdmin: 0,
      CompanyName: "Solar Care Pvt Ltd", Address: "1 Ring Road", City: "Ahmedabad", StateCode: "24", Pincode: "380001",
      GSTIN: "24ABCDE1234F1Z5", Phone: "079-2658", Email: "hi@solar.in", Website: "solar.in", BankDetails: "HDFC 123",
      DefaultIntro: "<p>Dear customer</p>", DefaultTerms: "<p>50% advance</p>", SignatoryName: "Amit",
      LogoAttachmentId: 12, HeaderAttachmentId: null, AccentColor: "#1e3a8a", DefaultTemplate: "modern",
    }]);
  });

  it("sends IsAdmin 1 for an admin — never read from the body", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 3 }));
    const req = baseReq({ body: { LeadId: 9, ...PROFILE, IsAdmin: 0 } });
    req.scope.isAdmin = true;
    await quotationController.saveProfile(req, mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1].IsAdmin).toBe(1);
  });

  it("passes the SP's 403 to a non-admin changing a saved letterhead", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 3, ResponseCode: 403, ResponseMess: "Only an administrator can change the saved company details" }],
    });
    const res = mockRes();
    await quotationController.saveProfile(baseReq({ body: { LeadId: 9, ...PROFILE } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it.each([
    [{ LeadId: undefined }, "LeadId is required"],
    [{ CompanyName: "  " }, "Company name is required"],
    [{ DefaultTemplate: "fancy" }, "Unknown template"],
    [{ DefaultTerms: "x".repeat(200 * 1024 + 1) }, "The default terms are too long"],
  ])("saveProfile 400s %p before touching the DB", async (patch, message) => {
    const res = mockRes();
    await quotationController.saveProfile(baseReq({ body: { LeadId: 9, ...PROFILE, ...patch } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe(message);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});
```

In `backend/tests/unit/routes/quotationRoutes.test.js`, extend `ROUTES`:

```js
  ["finaliseQuotation", { QuotationId: 4 }, "finalise"],
  ["reviseQuotation", { QuotationId: 4 }, "revise"],
  ["rejectQuotation", { QuotationId: 4 }, "reject"],
  ["deleteQuotation", { QuotationId: 4 }, "remove"],
  ["ensureQuoteProfile", { LeadId: 9 }, "ensureProfile"],
  ["saveQuoteProfile", { LeadId: 9, CompanyName: "x" }, "saveProfile"],
```

Run both files; the new tests must FAIL.

- [ ] **Step 2: Implement**

In `backend/src/controllers/quotationController.js`, add this require beside the
other requires at the top of the file (`remove` below is its first use — Task 6
deliberately left it out):

```js
const attachmentController = require("./attachmentController");
```

Then, above `const quotationController = {`:

```js
// Exactly the columns sp_SaveQuoteProfile accepts, in its order.
const PROFILE_TEXT = [
  "CompanyName", "Address", "City", "StateCode", "Pincode", "GSTIN", "Phone", "Email", "Website",
  "BankDetails", "DefaultIntro", "DefaultTerms", "SignatoryName",
];

// Every lifecycle move is the same two steps: gate on the quotation (which
// gates on its lead), then hand the SP the three ids it needs.
async function gateQuotation(req, res) {
  const QuotationId = positiveInt(req.body.QuotationId);
  if (!QuotationId) {
    responseHelper.validationError(res, "QuotationId is required");
    return null;
  }
  return (await assertRecordAccess(req, res, "quotation", QuotationId, "write")) ? QuotationId : null;
}

// Both profile endpoints name a LEAD, and the branch comes from it — never from
// req.user.BranchId. A regional manager quoting for a Mumbai lead must get
// Mumbai's letterhead and GSTIN, not their own office's.
async function gateLeadBranch(req, res) {
  const LeadId = positiveInt(req.body.LeadId);
  if (!LeadId) {
    responseHelper.validationError(res, "LeadId is required");
    return null;
  }
  const lead = await assertRecordAccess(req, res, "lead", LeadId, "write");
  return lead ? lead.BranchId : null;
}
```

and add these methods inside the object, after `detail`:

```js
  async finalise(req, res) {
    const QuotationId = await gateQuotation(req, res);
    if (!QuotationId) return;
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_FinaliseQuotation", { CompId, QuotationId, UserId }, "Failed to finalise quotation");
  },

  async revise(req, res) {
    const QuotationId = await gateQuotation(req, res);
    if (!QuotationId) return;
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_ReviseQuotation", { CompId, QuotationId, UserId }, "Failed to revise quotation");
  },

  async reject(req, res) {
    const QuotationId = await gateQuotation(req, res);
    if (!QuotationId) return;
    const { CompId, UserId } = req.user;
    const Remarks = text(req.body.Remarks);
    return runSp(res, "sp_RejectQuotation", { CompId, QuotationId, UserId, Remarks }, "Failed to reject quotation");
  },

  // Drafts only — the SP answers 409 for anything issued. On success the
  // pictures uploaded to the draft go too (they have no other owner).
  async remove(req, res) {
    const QuotationId = await gateQuotation(req, res);
    if (!QuotationId) return;
    const { CompId } = req.user;
    try {
      const result = await database.executeStoredProcedure("sp_DeleteQuotation", {
        CompId,
        QuotationId,
      });
      const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
      const message = spResponse.ResponseMess || spResponse.ResponseMessage;
      if (spResponse.ResponseCode !== 200) {
        return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
      }
      await attachmentController.cascadeDelete(CompId, "quotation", QuotationId);
      return responseHelper.success(res, message, spResponse);
    } catch (err) {
      console.error("sp_DeleteQuotation error:", err);
      return responseHelper.error(res, "Failed to delete quotation");
    }
  },

  // A fetch that creates (sp_EnsureQuoteProfile): the builder needs the branch's
  // row to exist before anyone has saved anything, because a logo upload needs
  // an EntityId to hang off.
  async ensureProfile(req, res) {
    const BranchId = await gateLeadBranch(req, res);
    if (!BranchId) return;
    const { CompId, UserId } = req.user;
    try {
      const result = await database.executeStoredProcedure("sp_EnsureQuoteProfile", {
        CompId,
        BranchId,
        UserId,
      });
      const profile = result.recordsets?.[0]?.[0] ?? null;
      return responseHelper.success(res, "Quote profile fetched successfully", { profile });
    } catch (err) {
      console.error("sp_EnsureQuoteProfile error:", err);
      return responseHelper.error(res, "Failed to fetch quote profile");
    }
  },

  // The remembered default. WHO may change it lives in the SP, next to the
  // IsSet flag it depends on: open while unset, admins only afterwards. IsAdmin
  // comes from the loaded scope — never from the body.
  async saveProfile(req, res) {
    const b = req.body;
    // Cheap checks first, in the order a user would hit them; the lead gate
    // (one DB round-trip) only runs once the body is worth saving.
    if (!positiveInt(b.LeadId)) return responseHelper.validationError(res, "LeadId is required");
    if (!text(b.CompanyName)) return responseHelper.validationError(res, "Company name is required");
    if (b.DefaultTemplate != null && b.DefaultTemplate !== "" && !TEMPLATE_CODES.includes(b.DefaultTemplate)) {
      return responseHelper.validationError(res, "Unknown template");
    }
    if (tooLong(b.DefaultIntro)) return responseHelper.validationError(res, "The default opening message is too long");
    if (tooLong(b.DefaultTerms)) return responseHelper.validationError(res, "The default terms are too long");

    const BranchId = await gateLeadBranch(req, res);
    if (!BranchId) return;
    const { CompId, UserId } = req.user;
    const fields = Object.fromEntries(PROFILE_TEXT.map((k) => [k, text(b[k])]));
    fields.GSTIN = gstin(b.GSTIN);
    const IsAdmin = req.scope?.isAdmin ? 1 : 0;
    const LogoAttachmentId = positiveInt(b.LogoAttachmentId);
    const HeaderAttachmentId = positiveInt(b.HeaderAttachmentId);
    const AccentColor = text(b.AccentColor);
    const DefaultTemplate = text(b.DefaultTemplate);
    return runSp(
      res,
      "sp_SaveQuoteProfile",
      { CompId, BranchId, UserId, IsAdmin, ...fields, LogoAttachmentId, HeaderAttachmentId, AccentColor, DefaultTemplate },
      "Failed to save company details",
    );
  },
```

In `backend/src/routes/quotationRoutes.js`, add after the three existing routes:

```js
router.post("/finaliseQuotation", requirePayload, quotationController.finalise);
router.post("/reviseQuotation", requirePayload, quotationController.revise);
router.post("/rejectQuotation", requirePayload, quotationController.reject);
router.post("/deleteQuotation", requirePayload, quotationController.remove);
router.post("/ensureQuoteProfile", requirePayload, quotationController.ensureProfile);
router.post("/saveQuoteProfile", requirePayload, quotationController.saveProfile);
```

- [ ] **Step 3: Green, with coverage**

```bash
cd backend && pnpm exec jest tests/unit/controllers/quotationController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/quotationController.js'
cd backend && pnpm exec jest tests/unit/routes/quotationRoutes.test.js --maxWorkers=2 --silent
cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent
```
Expected: all PASS; controller ≥ 80 % lines and branches.

- [ ] **Step 4: Stop and report.** Do not stage or commit.

---

### Task 8: `leadController.convert` · product tax fields · customer GSTIN

**Files:**
- Modify: `backend/src/controllers/leadController.js`, `backend/src/routes/leadRoutes.js`
- Modify: `backend/src/controllers/productController.js`
- Modify: `backend/tests/unit/controllers/leadController.test.js`, `backend/tests/unit/controllers/productController.test.js`
- Modify (if present): `backend/tests/unit/routes/leadRoutes.test.js`

**Interfaces:**
- Consumes: `sp_ConvertLead` (Task 3), `sp_SaveProduct` with four new parameters.
- Produces: `POST /api/leads/convertLead { LeadId, WonValue, Remarks, QuotationId }` → `{ Id, CustomerId, WonValue, … }`. (Customer `GSTIN` was wired in Task 4.)

- [ ] **Step 1: Failing tests**

Append to `backend/tests/unit/controllers/leadController.test.js`:

```js
describe("leadController.convert", () => {
  const wonRow = { recordset: [{ Id: 9, ResponseCode: 200, ResponseMess: "Lead marked won", CustomerId: 31, WonValue: 4000 }] };

  // Small leads are won with no quotation at all (spec decision 6).
  it("wins a lead without a quotation, on the typed value", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(wonRow);
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue: "4000", Remarks: " paid by UPI " } }), res);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_ConvertLead", {
      CompId: 5, LeadId: 9, UserId: 7, WonValue: 4000, Remarks: "paid by UPI", QuotationId: null,
    }]);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ CustomerId: 31, WonValue: 4000 });
  });

  // With a quotation the SP takes the value from it. The controller sends what
  // it was given and does not pre-empt that rule.
  it("accepts a quotation by id", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(wonRow);
    await leadController.convert(baseReq({ body: { LeadId: 9, QuotationId: "42" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ QuotationId: 42, WonValue: null });
  });

  it("400s without a quotation AND without a value, before the DB", async () => {
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Enter the value this lead was won for");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it.each([["-1"], ["abc"]])("400s a value of %p", async (WonValue) => {
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("accepts a value of zero — a free replacement is still a win", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(wonRow);
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue: 0 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1].WonValue).toBe(0);
  });

  it("403s a lead the caller cannot see", async () => {
    mockLeadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("surfaces the SP's 409 (lead is lost / quotation not final)", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 9, ResponseCode: 409, ResponseMess: "Only a finalised quotation can be accepted" }],
    });
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, QuotationId: 42 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
```

In `backend/tests/unit/controllers/productController.test.js`, add to the `save` describe (match that file's existing request/response helpers — read its first 40 lines first):

```js
  it("forwards HSN, GST %, unit and description; numbers arrive as strings from the web", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3, ResponseCode: 200, ResponseMess: "ok" }]] });
    await productController.save(
      baseReq({ body: { Name: "5 kW Rooftop", HSNCode: " 8541 ", TaxPct: "12", Unit: "Nos", Description: "Mono PERC" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      HSNCode: "8541", TaxPct: 12, Unit: "Nos", Description: "Mono PERC",
    });
  });

  it("sends null, not 0, for a GST % that was left empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3, ResponseCode: 200, ResponseMess: "ok" }]] });
    await productController.save(baseReq({ body: { Name: "x", TaxPct: "" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].TaxPct).toBeNull();
  });
```

If `backend/tests/unit/routes/leadRoutes.test.js` exists, add `convertLead` to its route table following that file's pattern (mock `convert: hit("convert")`).

Run the files; new tests must FAIL.

- [ ] **Step 2: Implement**

`backend/src/controllers/leadController.js` — add after `setStatus`:

```js
  // The move sp_SetLeadStatus refuses ("Use convert to move a lead to
  // Converted"). One engine writes a win: an accepted quotation and "Won" in
  // the status dropdown both land here. With a QuotationId the SP takes the
  // value from the quotation and ignores WonValue; without one the agent's
  // number is the value — small leads are won with no quotation at all.
  async convert(req, res) {
    const { CompId, UserId } = req.user;
    const LeadId = positiveInt(req.body.LeadId);
    const QuotationId = positiveInt(req.body.QuotationId);
    const raw = req.body.WonValue;
    const hasValue = !(raw === null || raw === undefined || raw === "");
    const WonValue = hasValue ? Number(raw) : null;
    if (!LeadId) return responseHelper.validationError(res, "LeadId is required");
    // A value, when given, must be a real amount (zero is one — a free
    // replacement is still a win). With none, only a quotation can supply it.
    if (hasValue ? !Number.isFinite(WonValue) || WonValue < 0 : !QuotationId) {
      return responseHelper.validationError(res, "Enter the value this lead was won for");
    }
    if (!(await assertRecordAccess(req, res, "lead", LeadId, "write"))) return;
    const Remarks = blank(req.body.Remarks) ? null : String(req.body.Remarks).trim();
    return runSp(
      res,
      "sp_ConvertLead",
      { CompId, LeadId, UserId, WonValue, Remarks, QuotationId },
      "Failed to mark the lead won",
    );
  },
```

`backend/src/routes/leadRoutes.js` — add after the `setLeadStatus` line:

```js
router.post("/convertLead", requirePayload, leadController.convert);
```

`backend/src/controllers/productController.js` — in `save`, extend the destructure with `HSNCode = null, TaxPct = null, Unit = null, Description = null` and add to the params object, after `IsActive`:

```js
        HSNCode: HSNCode == null || String(HSNCode).trim() === "" ? null : String(HSNCode).trim(),
        TaxPct: num(TaxPct),
        Unit: Unit == null || String(Unit).trim() === "" ? null : String(Unit).trim(),
        Description: Description == null || String(Description).trim() === "" ? null : String(Description).trim(),
```

- [ ] **Step 3: Green, with coverage**

```bash
cd backend && pnpm exec jest tests/unit/controllers/leadController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/leadController.js'
cd backend && pnpm exec jest tests/unit/controllers/productController.test.js --maxWorkers=2 --silent --coverage --collectCoverageFrom='src/controllers/productController.js'
cd backend && pnpm exec jest tests/unit/controllers/tenancyContract.test.js --maxWorkers=2 --silent
```
Expected: all PASS; both controllers ≥ 80 %.

- [ ] **Step 4: Stop and report.** Do not stage or commit.

---

### Task 9: **Gate** — backend whole suite + live contract check after the owner applies `091`

**Files:** none created. This task runs things and reports.

This is one of the two tasks allowed a full-suite run. It has two halves; the second **waits for the owner**.

- [ ] **Step 1: Whole backend suite, with coverage**

```bash
cd backend && pnpm exec jest --silent --maxWorkers=2 --coverage > "$SCRATCH/backend-suite.txt" 2>&1; tail -40 "$SCRATCH/backend-suite.txt"
```
Expected: every suite PASS; global coverage ≥ 60 %; each file touched in Tasks 4–8 ≥ 80 % lines and branches (`utils/mobile.js`, `controllers/quotationController.js`, `controllers/leadController.js`, `controllers/customerController.js`, `controllers/productController.js`, `controllers/attachmentController.js`, `middleware/permission.js`, `middleware/upload.js`). A failure here is fixed here — max 3 attempts, then BLOCKED with the output.

- [ ] **Step 2: Ask the owner to apply `091`**

Report exactly this and **stop until they answer**:

> `backend/sql/091_quotations.sql` is ready. Please run it against **`eCRM+`**, then against **`SolarCRM`** (no `USE` in the file — select the database first). It ends with a verify block: every row should read `ok`, the two "expect 0 rows" queries should be empty, and the five `fixture F1…F5` rows should read `ok`. Tell me what it printed for anything that is not `ok` — and the rows it lists under *customer mobile parked*, which need fixing by hand in the app.

- [ ] **Step 3: Live contract check (after the owner confirms) — mocked tests cannot see a missing proc or a renamed column**

Run with `mcp__sqlserver-ecrm__read_query` against whichever DB the MCP is connected to, and ask the owner to run the same three against the other:

```sql
-- 1. every proc the backend now calls exists, with the parameters the controllers send — expect 0 rows
SELECT v.sp, v.param FROM (VALUES
  ('sp_SaveQuotation','@LinesJSON'),('sp_SaveQuotation','@SellerGSTIN'),('sp_SaveQuotation','@CompanyJSON'),
  ('sp_FinaliseQuotation','@QuotationId'),('sp_ReviseQuotation','@QuotationId'),('sp_RejectQuotation','@Remarks'),
  ('sp_DeleteQuotation','@QuotationId'),('sp_FetchQuotations','@OwnerIdsJson'),('sp_FetchQuotations','@LeadId'),
  ('sp_FetchQuotationDetail','@QuotationId'),('sp_EnsureQuoteProfile','@BranchId'),('sp_FetchQuoteProfileById','@ProfileId'),
  ('sp_SaveQuoteProfile','@IsAdmin'),('sp_SaveQuoteProfile','@DefaultTemplate'),
  ('sp_ConvertLead','@QuotationId'),('sp_ConvertLead','@WonValue'),
  ('sp_SaveCustomer','@GSTIN'),('sp_SaveProduct','@TaxPct'),('sp_SaveProduct','@HSNCode'),('sp_SaveProduct','@Unit'),('sp_SaveProduct','@Description')
) v(sp, param)
WHERE NOT EXISTS (SELECT 1 FROM sys.parameters p WHERE p.object_id = OBJECT_ID('dbo.' + v.sp) AND p.name = v.param);

-- 2. sp_FetchQuotationDetail RS1 exposes what canSeeRecord reads — expect 3 rows
SELECT name FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.sp_FetchQuotationDetail @CompId = 1, @QuotationId = 1', NULL, 0)
WHERE name IN ('OwnerId','BranchId','CreatedBy');

-- 3. the Won status exists for the company the testers use — expect 1 row per company
SELECT CompId, Id, Value FROM dbo.tblLookup WHERE Kind = 'lead_status' AND Code = 'converted' AND IsActive = 1;
```

- [ ] **Step 4: Report** — suite totals, coverage table for the eight files, the three live results, and anything the owner reported from the verify block. Write the result table into the ledger. Do not stage or commit.

---

### Task 10: Web deps, fonts, sample art, `utils/mobile` + `ui/MobileInput`, wired into the lead + customer forms

**Files:**
- Modify: `web/package.json`, `web/pnpm-lock.yaml` (through pnpm only)
- Create: `web/src/assets/fonts/{Inter,NotoSerif}-{Regular,Italic,Bold,BoldItalic}.ttf` (8 files), `web/src/assets/quote/sample-logo.png`, `web/src/assets/quote/sample-header.png`
- Create: `web/src/utils/mobile.js`, `web/src/utils/mobile.test.js`
- Create: `web/src/components/ui/MobileInput.jsx`, `web/src/components/ui/MobileInput.test.jsx`
- Modify: `web/src/components/ui/index.js`
- Modify: `web/src/pages/Sales/LeadCreateModal.jsx`, `web/src/pages/Support/CustomerFormModal.jsx` (+ their tests)

**Interfaces:**
- Produces: `normalizeMobile(raw)`, `mobileSchema({ required, label })` (zod), `<MobileInput>` (same props as `TextInput`; `onChange` receives the **cleaned string**, not an event). Fonts and sample art on disk for Tasks 13–15.

The backend (Task 4) is what makes a mobile right; this is the courtesy that stops a user typing a wrong one in the first place. Same rule, same sentence.

- [ ] **Step 1: Dependencies — exact versions, pnpm only**

```bash
cd web
pnpm add @tiptap/react@3.31.3 @tiptap/pm@3.31.3 @tiptap/starter-kit@3.31.3 @tiptap/extension-text-style@3.31.3 @tiptap/extension-text-align@3.31.3 @tiptap/extension-table@3.31.3 @react-pdf/renderer@4.9.0 react-pdf-html@2.1.5
pnpm remove jspdf jspdf-autotable
grep -rn "jspdf\|autoTable" src vite.config.js ; echo "exit=$?"    # expect no matches, exit=1
```
If `pnpm add` stops on a build-script approval prompt, stop and report the package name — do not approve anything on your own.

- [ ] **Step 2: Fonts — mapped by their DECLARED style and weight, never by position**

Google's CSS lists the faces as *italic 400, italic 700, normal 400, normal 700* — not the order anyone would guess. Naming files by position silently swaps Regular and Italic (it happened while this plan was being written). The script reads each `@font-face` block's own `font-style` / `font-weight`.

```bash
mkdir -p web/src/assets/fonts && cd web/src/assets/fonts && python3 - <<'PYF'
import re, urllib.request
NAMES = {("normal","400"):"Regular", ("normal","700"):"Bold", ("italic","400"):"Italic", ("italic","700"):"BoldItalic"}
def fetch(family, out):
    url = f"https://fonts.googleapis.com/css2?family={family}:ital,wght@0,400;0,700;1,400;1,700"
    css = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "curl/8"}), timeout=30).read().decode()
    blocks = re.findall(r"@font-face\s*{(.*?)}", css, re.S)
    assert len(blocks) == 4, f"{family}: expected 4 faces, got {len(blocks)}"
    for b in blocks:
        key = (re.search(r"font-style:\s*(\w+)", b).group(1), re.search(r"font-weight:\s*(\d+)", b).group(1))
        data = urllib.request.urlopen(re.search(r"url\((https://[^)]+\.ttf)\)", b).group(1), timeout=60).read()
        open(f"{out}-{NAMES[key]}.ttf", "wb").write(data)
        print(f"{out}-{NAMES[key]}.ttf", len(data) // 1024, "KB")
fetch("Inter", "Inter"); fetch("Noto+Serif", "NotoSerif")
PYF
ls -1 *.ttf | wc -l      # expect 8
```
Both families are SIL OFL. Expected sizes: Inter ≈ 320 KB each, Noto Serif ≈ 430–470 KB each. They are fetched by the browser only when a quotation actually uses them.

- [ ] **Step 3: Sample art — what a template shows until the user replaces it**

Dependency-free PNGs, deliberately *obviously placeholders* (a flat slate tile with a ring; a plain slate band) so nobody mistakes them for branding. The builder refuses to finalise while the sample logo is still showing (Task 15A `finaliseBlockers`).

```bash
mkdir -p web/src/assets/quote && cd web/src/assets/quote && python3 - <<'PYA'
import struct, zlib, math
def png(path, w, h, paint):
    raw = b"".join(b"\x00" + bytes(c for x in range(w) for c in paint(x, y)) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
SLATE, LIGHT = (203, 213, 225), (241, 245, 249)
def logo(x, y):
    d = math.hypot(x - 120, y - 120)
    return LIGHT if 58 <= d <= 78 else SLATE
png("sample-logo.png", 240, 240, logo)
png("sample-header.png", 1200, 240, lambda x, y: tuple(int(a + (b - a) * x / 1200) for a, b in zip(SLATE, LIGHT)))
PYA
ls -la sample-logo.png sample-header.png
```

- [ ] **Step 4: Failing tests — util and input**

Create `web/src/utils/mobile.test.js`:
```js
import { describe, it, expect } from "vitest";
import { normalizeMobile, mobileSchema, MOBILE_MESSAGE } from "./mobile";

describe("normalizeMobile — the same rule as backend/src/utils/mobile.js", () => {
  it.each([
    ["9825012345", "9825012345"], ["98250 12345", "9825012345"], ["98250-12345", "9825012345"],
    ["+91 98250 12345", "9825012345"], ["919825012345", "9825012345"], ["09825012345", "9825012345"],
  ])("%p → %p", (raw, out) => expect(normalizeMobile(raw)).toBe(out));

  it.each([["111"], ["44774445555"], ["903315499"], ["abc"], [""], [null], [undefined], ["449825012345"]])(
    "%p is not a mobile", (raw) => expect(normalizeMobile(raw)).toBeNull(),
  );
});

describe("mobileSchema", () => {
  it("optional: blank passes as empty, a good number is normalised, a bad one is refused with the house sentence", () => {
    const s = mobileSchema();
    expect(s.parse("")).toBe("");
    expect(s.parse(undefined)).toBe("");
    expect(s.parse("+91 98250 12345")).toBe("9825012345");
    expect(s.safeParse("12345").error.issues[0].message).toBe(MOBILE_MESSAGE);
  });

  it("required: blank is refused", () => {
    const s = mobileSchema({ required: true });
    expect(s.safeParse("").error.issues[0].message).toBe("Mobile number is required");
    expect(s.parse("9825012345")).toBe("9825012345");
  });

  it("names the field it is for", () => {
    expect(mobileSchema({ label: "Alternate mobile" }).safeParse("1").error.issues[0].message).toBe("Alternate mobile must be 10 digits");
  });
});
```
Create `web/src/components/ui/MobileInput.test.jsx`:
```jsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import MobileInput from "./MobileInput";
import renderWithProviders from "../../test/renderWithProviders";

describe("MobileInput", () => {
  it("is a numeric field", () => {
    renderWithProviders(<MobileInput label="Mobile" value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Mobile");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "tel-national");
  });

  // No maxlength attribute, on purpose. A browser truncates a PASTE to
  // maxlength before any handler runs, so "+91 98250 12345" would arrive as
  // "+91 98250 " and clean down to a wrong number. The cap is applied in code,
  // after the prefix has been dropped.
  it("caps in code, not with a maxlength attribute", () => {
    renderWithProviders(<MobileInput label="Mobile" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Mobile")).not.toHaveAttribute("maxlength");
  });

  // onChange hands back the CLEANED STRING, not an event: every caller wants
  // the digits, and an event would make each of them strip it again.
  it("strips everything but digits as you type, and caps at ten", () => {
    const onChange = vi.fn();
    renderWithProviders(<MobileInput label="Mobile" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "98250-12 345xyz99" } });
    expect(onChange).toHaveBeenLastCalledWith("9825012345");
  });

  // A pasted "+91 98250 12345" is 12 digits. Cutting it to the FIRST ten would
  // keep the country code and drop the last two digits of the number.
  it("drops a pasted +91 or leading 0 instead of truncating the real number", () => {
    const onChange = vi.fn();
    renderWithProviders(<MobileInput label="Mobile" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "+91 98250 12345" } });
    expect(onChange).toHaveBeenLastCalledWith("9825012345");
    fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "098250 12345" } });
    expect(onChange).toHaveBeenLastCalledWith("9825012345");
  });

  it("shows an error and forwards the rest to TextInput", () => {
    renderWithProviders(<MobileInput label="Mobile" value="123" onChange={() => {}} error="Mobile number must be 10 digits" required data-testid="m" />);
    expect(screen.getByText("Mobile number must be 10 digits")).toBeInTheDocument();
    expect(screen.getByTestId("m")).toHaveValue("123");
  });
});
```
Run each; both must FAIL (module not found):
`cd web && pnpm exec vitest run src/utils/mobile.test.js` · `cd web && pnpm exec vitest run src/components/ui/MobileInput.test.jsx`

- [ ] **Step 5: Implement**

Create `web/src/utils/mobile.js`:
```js
// A mobile number is ten digits — the same rule, word for word, as
// backend/src/utils/mobile.js. The backend is what ENFORCES it (and the DB
// CHECK behind that); this only stops someone typing a wrong one in the first
// place, and lets a form say so before a round-trip.
import * as z from "zod";

export const MOBILE_MESSAGE = "Mobile number must be 10 digits";

/** "+91 98250-12345" → "9825012345". Anything that is not ten digits afterwards → null. */
export function normalizeMobile(raw) {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** A zod string that parses to the normalised ten digits, or "" when blank and optional. */
export const mobileSchema = ({ required = false, label = "Mobile number" } = {}) =>
  z.string().optional().transform((v) => (v ?? "").trim()).superRefine((v, ctx) => {
    if (v === "") {
      if (required) ctx.addIssue({ code: "custom", message: `${label} is required` });
      return;
    }
    if (!normalizeMobile(v)) ctx.addIssue({ code: "custom", message: `${label} must be 10 digits` });
  }).transform((v) => (v === "" ? "" : normalizeMobile(v) ?? v));
```
Create `web/src/components/ui/MobileInput.jsx`:
```jsx
import { forwardRef } from "react";
import TextInput from "./TextInput";
import { normalizeMobile } from "../../utils/mobile";

// Digits only, ten of them — capped HERE, not with a maxlength attribute: a
// browser truncates a paste to maxlength before any handler runs. A pasted "+91 98250 12345" or "098250 12345" loses
// its PREFIX, not its tail — naively cutting to the first ten characters keeps
// the country code and throws away the end of the number. Which prefixes come
// off is NOT decided here: normalizeMobile owns that rule, and there is no
// second copy of it. Anything it refuses is still being typed, so the digits so
// far are handed back, capped at ten.
const clean = (raw) => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return normalizeMobile(digits) ?? digits.slice(0, 10);
};

/**
 * The one mobile-number field. Same props as TextInput, except `onChange`
 * receives the CLEANED STRING rather than an event — every caller wants the
 * digits, and handing over an event would make each of them strip it again.
 * The rule itself (and its enforcement) lives in utils/mobile + the backend.
 */
const MobileInput = forwardRef(function MobileInput({ onChange, ...rest }, ref) {
  return (
    <TextInput
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="tel-national"
      placeholder="10-digit mobile"
      {...rest}
      onChange={(e) => onChange?.(clean(e.target.value))}
    />
  );
});

export default MobileInput;
```

Add to `web/src/components/ui/index.js`, after the `TextInput` line:

```js
export { default as MobileInput } from "./MobileInput";
```

- [ ] **Step 6: Wire it into the two forms that take a mobile**

`web/src/pages/Sales/LeadCreateModal.jsx`:
1. Imports: add `MobileInput` to the `components/ui` import; add `import { mobileSchema } from "../../utils/mobile";`.
2. Schema (lines 32–33): replace
   `MobileNo: z.string().trim().min(1, "Mobile number is required"),` with `MobileNo: mobileSchema({ required: true }),`
   and `AltMobile: z.string().optional(),` with `AltMobile: mobileSchema({ label: "Alternate mobile" }),`.
3. The two `Controller`s named `MobileNo` and `AltMobile` (around lines 287 and 302) render a `TextInput`/`FormInput`. Change each to render `<MobileInput … value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={errors.<name>?.message} />`, keeping the existing `label`, `required` and `data-testid`. `field.onChange` accepts a plain value, so nothing else changes.
4. In `onSubmit` (lines 215–216) the values are already normalised by the schema; leave `values.MobileNo.trim()` as is and keep `values.AltMobile?.trim() || null`.

`web/src/pages/Support/CustomerFormModal.jsx`:
1. Replace the local `phone` schema with `mobileSchema` — `Mobile: mobileSchema(),` and `AltMobile: mobileSchema({ label: "Alternate mobile" }),` — and delete the now-unused `const phone = …` line and the sentence in the comment above it that says the SP normalises the mobile.
2. Add `GSTIN: z.string().trim().toUpperCase().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5").optional(),` to the schema; `GSTIN: ""` to `EMPTY`; `GSTIN: clean(v.GSTIN),` to the body in `onSubmit`.
3. `Field` is generic over `TextInput`/`TextArea`. Add a third branch: give `Field` a `mobile = false` prop and pick `const Input = mobile ? MobileInput : multiline ? TextArea : TextInput;`. `MobileInput`'s `onChange` already hands back a string, and `field.onChange` takes one, so the `render` body is unchanged.
4. In the form: `<Field {...f} name="Mobile" label="Mobile" mobile />`, `<Field {...f} name="AltMobile" label="Alternate mobile" mobile />` (drop their `inputMode="tel"`), and add `<Field {...f} name="GSTIN" label="GSTIN" placeholder="15 characters, if registered" />` after `Pincode`.

Update the two test files: any test typing a mobile such as `"98765 43210"` or `"9"` must now type a valid ten-digit number and expect the normalised value in the posted body; add one test per form asserting that a bad mobile shows *"Mobile number must be 10 digits"* and posts nothing, and (customer form) that `GSTIN` is posted upper-cased.

- [ ] **Step 7: Green, with coverage — one file per run**

```bash
cd web && pnpm exec vitest run src/utils/mobile.test.js --coverage --coverage.include=src/utils/mobile.js
cd web && pnpm exec vitest run src/components/ui/MobileInput.test.jsx --coverage --coverage.include=src/components/ui/MobileInput.jsx
cd web && pnpm exec vitest run src/pages/Sales/LeadCreateModal.test.jsx --coverage --coverage.include=src/pages/Sales/LeadCreateModal.jsx
cd web && pnpm exec vitest run src/pages/Support/CustomerFormModal.test.jsx --coverage --coverage.include=src/pages/Support/CustomerFormModal.jsx
```
Expected: all PASS; each touched source file ≥ 80 %.

- [ ] **Step 8: Stop and report** — the eight font sizes, the two PNG sizes, test counts, coverage. Do not stage or commit.

---

### Task 11: Pure modules — `gst` · `quoteMath` · `amountInWords` · `finYear`

**Files (all under `web/src/pages/Sales/Quotations/`):**
- Create: `gst.js`, `quoteMath.js`, `amountInWords.js`, `finYear.js` and a `.test.js` beside each.

**Interfaces:**
- Produces: `computeQuote(lines, { sellerGstin, sellerState, buyerState })` → `{ taxed, inter, lines[], subTotal, discountTotal, taxableTotal, cgstTotal, sgstTotal, igstTotal, roundOff, grandTotal }`; `GST_STATES`, `STATE_OPTIONS`, `stateByCode`, `stateFromGstin`, `isValidGstin`, `cleanGstin`, `matchStateName`; `amountInWords(n)`; `finYear(d)`, `finYearLabel(d)`.

**The code below was written and run before this plan was finalised (40 tests, all green, 2026-09-18). Transcribe it exactly.** The five `F1…F5` cases in `quoteMath.test.js` are the same rows as the verify block of `091` §11.6 — that pairing is what stops the preview and the SP drifting apart. If you find yourself wanting to change a number in one, stop: the other has to change with it, and that is a finding to report, not a fix to make.

- [ ] **Step 1: Write the four test files**

`web/src/pages/Sales/Quotations/quoteMath.test.js`:
```js
import { describe, it, expect } from "vitest";
import { computeQuote } from "./quoteMath";

const GJ = { sellerGstin: "24ABCDE1234F1Z5", sellerState: "24" };

/**
 * THE FIXTURE TABLE. The same rows sit in the verify block of
 * backend/sql/091_quotations.sql, run against sp_SaveQuotation after apply.
 * If one side changes, the other must — that is the whole point of it.
 */
describe("computeQuote — fixtures shared with 091", () => {
  it("F1 intra-state: CGST + SGST, each half", () => {
    const q = computeQuote([{ qty: 1, rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 }], { ...GJ, buyerState: "24" });
    expect(q).toMatchObject({ inter: false, subTotal: 280000, discountTotal: 10000, taxableTotal: 270000,
      cgstTotal: 16200, sgstTotal: 16200, igstTotal: 0, roundOff: 0, grandTotal: 302400 });
  });

  it("F2 inter-state: the same line, all of it IGST", () => {
    const q = computeQuote([{ qty: 1, rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 }], { ...GJ, buyerState: "27" });
    expect(q).toMatchObject({ inter: true, cgstTotal: 0, sgstTotal: 0, igstTotal: 32400, grandTotal: 302400 });
  });

  it("F3 unregistered seller: no tax whatever the line says", () => {
    const q = computeQuote([{ qty: 2, rate: 1500, discountType: "pct", discountValue: 0, taxPct: 18 }], { sellerGstin: "", buyerState: "24" });
    expect(q).toMatchObject({ taxed: false, taxableTotal: 3000, cgstTotal: 0, sgstTotal: 0, igstTotal: 0, grandTotal: 3000 });
  });

  it("F4 the odd paisa goes to CGST, always", () => {
    // taxable 100.10 @ 5% = 5.005 → 5.01; half = 2.505 → CGST 2.51, SGST 2.50
    const q = computeQuote([{ qty: 1, rate: 100.10, discountType: "pct", discountValue: 0, taxPct: 5 }], { ...GJ, buyerState: "24" });
    expect(q.lines[0]).toMatchObject({ taxableAmt: 100.1, cgstAmt: 2.51, sgstAmt: 2.5 });
    expect(q).toMatchObject({ grandTotal: 105, roundOff: -0.11 });
  });

  it("F5 percentage discount, fractional quantity, mixed rates, round-off up", () => {
    const q = computeQuote([
      { qty: 2.5, rate: 1234.56, discountType: "pct", discountValue: 7.5, taxPct: 18 },
      { qty: 3, rate: 99.99, discountType: "amt", discountValue: 0, taxPct: 28 },
    ], { ...GJ, buyerState: "24" });
    expect(q.lines[0]).toMatchObject({ grossAmt: 3086.4, discountAmt: 231.48, taxableAmt: 2854.92, cgstAmt: 256.95, sgstAmt: 256.94, lineTotal: 3368.81 });
    expect(q.lines[1]).toMatchObject({ grossAmt: 299.97, taxableAmt: 299.97, cgstAmt: 42, sgstAmt: 41.99, lineTotal: 383.96 });
    expect(q).toMatchObject({ subTotal: 3386.37, discountTotal: 231.48, taxableTotal: 3154.89, cgstTotal: 298.95, sgstTotal: 298.93, grandTotal: 3753, roundOff: 0.23 });
  });
});

describe("computeQuote — edges", () => {
  // The float this file exists to avoid: 1234.565 is 1234.5649999999998 in a
  // double. SQL's exact DECIMAL rounds it up; a naive Math.round rounds down.
  it("rounds half away from zero the way SQL DECIMAL does, not the way a double does", () => {
    const q = computeQuote([{ qty: 1, rate: 8230.43, discountType: "pct", discountValue: 0, taxPct: 15 }], { ...GJ, buyerState: "27" });
    expect(q.lines[0].igstAmt).toBe(1234.56); // 1234.5645 → .56
    const half = computeQuote([{ qty: 1, rate: 24691.30, discountType: "pct", discountValue: 0, taxPct: 5 }], { ...GJ, buyerState: "27" });
    expect(half.lines[0].igstAmt).toBe(1234.57); // 1234.565 exactly → .57
  });

  it("caps an amount discount at the line's gross — a line cannot go negative", () => {
    const q = computeQuote([{ qty: 1, rate: 500, discountType: "amt", discountValue: 900, taxPct: 18 }], { ...GJ, buyerState: "24" });
    expect(q.lines[0]).toMatchObject({ discountAmt: 500, taxableAmt: 0, lineTotal: 0 });
  });

  it("treats a missing place of supply as the seller's own state, so a draft still totals", () => {
    expect(computeQuote([{ qty: 1, rate: 100, taxPct: 18 }], { ...GJ }).inter).toBe(false);
  });

  it("is zero, not NaN, for an empty quote and for junk in a field", () => {
    expect(computeQuote([], GJ)).toMatchObject({ grandTotal: 0, roundOff: 0, lines: [] });
    const q = computeQuote([{ qty: "abc", rate: null, discountType: "pct", discountValue: undefined, taxPct: "" }], { ...GJ, buyerState: "24" });
    expect(q.grandTotal).toBe(0);
    expect(Number.isNaN(q.lines[0].lineTotal)).toBe(false);
  });

  it("ignores negatives rather than subtracting them", () => {
    expect(computeQuote([{ qty: -2, rate: 100, taxPct: 18 }], { ...GJ, buyerState: "24" }).grandTotal).toBe(0);
  });
});
```
`web/src/pages/Sales/Quotations/gst.test.js`:
```js
import { describe, it, expect } from "vitest";
import { GST_STATES, STATE_OPTIONS, stateByCode, isValidGstin, stateFromGstin, matchStateName, cleanGstin } from "./gst";

describe("gst", () => {
  it("lists the 28 states and 8 union territories, codes unique", () => {
    expect(GST_STATES).toHaveLength(36);
    expect(new Set(GST_STATES.map((s) => s.code)).size).toBe(36);
    expect(STATE_OPTIONS.find((o) => o.value === "24").label).toBe("Gujarat (24)");
  });

  it("resolves a code, padding a bare digit", () => {
    expect(stateByCode("24").name).toBe("Gujarat");
    expect(stateByCode(7).name).toBe("Delhi");
    expect(stateByCode("99")).toBeNull();
    expect(stateByCode(null)).toBeNull();
  });

  // Registrations issued before Daman & Diu merged into 26, and before Andhra
  // was re-coded to 37, are still in force.
  it("resolves legacy codes without offering them in the picker", () => {
    expect(stateByCode("25").name).toBe("Daman and Diu");
    expect(STATE_OPTIONS.some((o) => o.value === "25" || o.value === "28")).toBe(false);
  });

  it("validates the shape of a GSTIN, tolerating case and spaces", () => {
    expect(isValidGstin("24ABCDE1234F1Z5")).toBe(true);
    expect(isValidGstin(" 24abcde1234f1z5 ")).toBe(true);
    expect(cleanGstin("24 abcde 1234 f1z5")).toBe("24ABCDE1234F1Z5");
    expect(isValidGstin("24ABCDE1234F1Y5")).toBe(false); // 14th char is always Z
    expect(isValidGstin("24ABCDE1234F1Z")).toBe(false);
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });

  it("reads the seller's state off the GSTIN", () => {
    expect(stateFromGstin("27ABCDE1234F1Z5")).toBe("27");
    expect(stateFromGstin("99ABCDE1234F1Z5")).toBeNull(); // well-formed, no such state
    expect(stateFromGstin("garbage")).toBeNull();
  });

  it("matches a typed state name exactly, and refuses to guess", () => {
    expect(matchStateName("gujarat")).toBe("24");
    expect(matchStateName("  Tamil Nadu ")).toBe("33");
    expect(matchStateName("Gujrat")).toBeNull();
    expect(matchStateName("MH")).toBeNull();
    expect(matchStateName("")).toBeNull();
    expect(matchStateName(undefined)).toBeNull();
  });
});
```
`web/src/pages/Sales/Quotations/amountInWords.test.js`:
```js
import { describe, it, expect } from "vitest";
import { amountInWords } from "./amountInWords";

describe("amountInWords", () => {
  it.each([
    [0, "Rupees Zero Only"],
    [7, "Rupees Seven Only"],
    [19, "Rupees Nineteen Only"],
    [40, "Rupees Forty Only"],
    [99, "Rupees Ninety Nine Only"],
    [100, "Rupees One Hundred Only"],
    [4000, "Rupees Four Thousand Only"],
    [302400, "Rupees Three Lakh Two Thousand Four Hundred Only"],
    [1000000, "Rupees Ten Lakh Only"],
    [10000000, "Rupees One Crore Only"],
    [123456789, "Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only"],
    [1200000000, "Rupees One Hundred Twenty Crore Only"],
    [10005, "Rupees Ten Thousand Five Only"],
  ])("%s → %s", (n, text) => expect(amountInWords(n)).toBe(text));

  it("names paise when there are any", () => {
    expect(amountInWords(1250.5)).toBe("Rupees One Thousand Two Hundred Fifty and Paise Fifty Only");
    expect(amountInWords(0.07)).toBe("Rupees Zero and Paise Seven Only");
  });

  it("is empty for anything that is not an amount", () => {
    expect(amountInWords(-5)).toBe("");
    expect(amountInWords("abc")).toBe("");
    expect(amountInWords(undefined)).toBe("");
  });
});
```
`web/src/pages/Sales/Quotations/finYear.test.js`:
```js
import { describe, it, expect } from "vitest";
import { finYear, finYearLabel } from "./finYear";

describe("finYear", () => {
  it.each([
    ["2026-09-18", "2627"],
    ["2026-04-01", "2627"], // first day of the year
    ["2026-03-31", "2526"], // last day of the one before
    ["2027-01-15", "2627"],
    ["2099-12-31", "9900"], // century roll
  ])("%s → %s", (d, fy) => expect(finYear(d)).toBe(fy));

  it("reads a date string as local, so 1 April is 1 April in IST", () => {
    expect(finYear("2026-04-01T00:00:00")).toBe("2627");
  });

  it("takes a Date, and defaults to today", () => {
    expect(finYear(new Date(2026, 3, 1))).toBe("2627");
    expect(finYear()).toMatch(/^\d{4}$/);
  });

  it("is empty for an unparseable date", () => {
    expect(finYear("not a date")).toBe("");
    expect(finYearLabel("not a date")).toBe("");
  });

  it("labels the year the way people say it", () => expect(finYearLabel("2026-09-18")).toBe("2026-27"));
});
```
- [ ] **Step 2: Run one — it must fail**

Run: `cd web && pnpm exec vitest run src/pages/Sales/Quotations/quoteMath.test.js`
Expected: FAIL — cannot resolve `./quoteMath`.

- [ ] **Step 3: Write the four modules**

`web/src/pages/Sales/Quotations/quoteMath.js`:
```js
// Quotation arithmetic — the preview's copy of what sp_SaveQuotation computes.
//
// The SP's numbers are the truth (spec §2): a final quote's PDF renders from
// the fetched row. This file exists so the preview can move while they type,
// and it must agree with the SP to the paisa or the total would visibly jump
// on save. Both are pinned to the same fixture table (quoteMath.test.js and
// the verify block in 091).
//
// BigInt paise, not floats. SQL Server does this in exact DECIMAL and rounds
// half away from zero; 1234.565 held in a double is 1234.5649999999998 and
// rounds the other way. One paisa, once a month, in front of a customer.

const int = (v, scale) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * scale)) : 0n;
};
// n / d rounded half away from zero; n, d >= 0.
const divRound = (n, d) => {
  const q = n / d;
  return (n % d) * 2n >= d ? q + 1n : q;
};
const rupees = (paise) => Number(paise) / 100;

/** One line, in paise. `inter`: IGST instead of CGST+SGST. `taxed`: seller has a GSTIN. */
function linePaise(line, { taxed, inter }) {
  const gross = divRound(int(line.qty, 1000) * int(line.rate, 100), 1000n);
  const rawDiscount = line.discountType === "amt"
    ? int(line.discountValue, 100)
    : divRound(gross * int(line.discountValue, 100), 10000n);
  const discount = rawDiscount > gross ? gross : rawDiscount;
  const taxable = gross - discount;
  const tax = taxed ? divRound(taxable * int(line.taxPct, 100), 10000n) : 0n;
  const cgst = inter ? 0n : divRound(tax, 2n);
  const sgst = inter ? 0n : tax - cgst;
  const igst = inter ? tax : 0n;
  return { gross, discount, taxable, cgst, sgst, igst, total: taxable + tax };
}

/**
 * @param lines      [{ qty, rate, discountType: 'pct'|'amt', discountValue, taxPct }]
 * @param sellerGstin  empty → unregistered seller → no tax at all
 * @param sellerState / buyerState  2-digit GST codes; a missing buyer state is
 *        treated as the seller's own (a draft has to total to something —
 *        finalise is what insists on a place of supply).
 */
export function computeQuote(lines = [], { sellerGstin, sellerState, buyerState } = {}) {
  const taxed = Boolean(sellerGstin && String(sellerGstin).trim());
  const inter = taxed && Boolean(buyerState) && Boolean(sellerState) && buyerState !== sellerState;
  const computed = lines.map((l) => linePaise(l, { taxed, inter }));
  const sum = (k) => computed.reduce((a, l) => a + l[k], 0n);
  const total = sum("total");
  const grand = divRound(total, 100n) * 100n;
  return {
    taxed,
    inter,
    lines: computed.map((l) => ({
      grossAmt: rupees(l.gross), discountAmt: rupees(l.discount), taxableAmt: rupees(l.taxable),
      cgstAmt: rupees(l.cgst), sgstAmt: rupees(l.sgst), igstAmt: rupees(l.igst), lineTotal: rupees(l.total),
    })),
    subTotal: rupees(sum("gross")),
    discountTotal: rupees(sum("discount")),
    taxableTotal: rupees(sum("taxable")),
    cgstTotal: rupees(sum("cgst")),
    sgstTotal: rupees(sum("sgst")),
    igstTotal: rupees(sum("igst")),
    roundOff: rupees(grand - total),
    grandTotal: rupees(grand),
  };
}
```
`web/src/pages/Sales/Quotations/gst.js`:
```js
// GST geography. The first two digits of a GSTIN are the state that issued it,
// which is the only reliable source of the SELLER's state — far better than a
// free-text "State" field someone typed as "Gujrat".

/** The 28 states and 8 union territories, by GST state code. */
export const GST_STATES = [
  { code: "01", name: "Jammu and Kashmir" }, { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" }, { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" }, { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" }, { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" }, { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" }, { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" }, { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

// Codes still printed on old registrations. Resolvable, so a seller holding one
// gets a state; not offered in the place-of-supply dropdown.
const LEGACY = [
  { code: "25", name: "Daman and Diu" },
  { code: "28", name: "Andhra Pradesh" },
];

const BY_CODE = new Map([...GST_STATES, ...LEGACY].map((s) => [s.code, s]));

export const stateByCode = (code) => BY_CODE.get(String(code ?? "").padStart(2, "0")) ?? null;

/** Combobox options for the place-of-supply picker. */
export const STATE_OPTIONS = GST_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));

// 2 digits state + 10 char PAN + entity digit + 'Z' + checksum.
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const cleanGstin = (v) => String(v ?? "").toUpperCase().replace(/\s+/g, "");
export const isValidGstin = (v) => GSTIN.test(cleanGstin(v));

/** The issuing state's code, or null when the GSTIN is missing or malformed. */
export const stateFromGstin = (v) => {
  const g = cleanGstin(v);
  return GSTIN.test(g) && BY_CODE.has(g.slice(0, 2)) ? g.slice(0, 2) : null;
};

/**
 * A lead's free-text State → a code, for pre-filling place of supply. Exact
 * name only, case-insensitive. No fuzzy matching on purpose: a wrong guess
 * silently flips CGST/SGST to IGST, where no guess just leaves the field for
 * the user to pick.
 */
export const matchStateName = (text) => {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  return GST_STATES.find((s) => s.name.toLowerCase() === t)?.code ?? null;
};
```
`web/src/pages/Sales/Quotations/amountInWords.js`:
```js
// "Rupees Three Lakh Two Thousand Four Hundred Only" — the line every Indian
// quotation carries under its total. Indian grouping: crore, lakh, thousand.

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const below100 = (n) => (n < 20 ? ONES[n] : [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" "));
const below1000 = (n) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", below100(n % 100)].filter(Boolean).join(" ");

function words(n) {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  return [
    // Above 99 crore the crore part is itself a number: "One Hundred Twenty Crore".
    crore ? `${words(crore)} Crore` : "",
    lakh ? `${below100(lakh)} Lakh` : "",
    thousand ? `${below100(thousand)} Thousand` : "",
    below1000(rest),
  ].filter(Boolean).join(" ");
}

export function amountInWords(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return "";
  const paise = Math.round(n * 100);
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${words(r)}${p ? ` and Paise ${below100(p)}` : ""} Only`;
}
```
`web/src/pages/Sales/Quotations/finYear.js`:
```js
// The Indian financial year runs 1 April → 31 March. Quotation numbers restart
// with it: QT-2627-0001 is the first quote finalised on or after 2026-04-01.
// The SP stamps the real number; this is only for labels and the preview.

const two = (y) => String(y % 100).padStart(2, "0");

/** "2627" for any date in FY 2026-27. Accepts a Date or a YYYY-MM-DD string. */
export function finYear(value = new Date()) {
  // A bare date string is read as local Y/M/D — `new Date("2026-04-01")` is UTC
  // midnight, which in IST is still 31 March for the first 5½ hours of the day.
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${two(start)}${two(start + 1)}`;
}

/** "2026-27" */
export const finYearLabel = (value) => {
  const fy = finYear(value);
  return fy ? `20${fy.slice(0, 2)}-${fy.slice(2)}` : "";
};
```
- [ ] **Step 4: Green, with coverage — one file per run**

```bash
cd web && pnpm exec vitest run src/pages/Sales/Quotations/quoteMath.test.js     --coverage --coverage.include=src/pages/Sales/Quotations/quoteMath.js
cd web && pnpm exec vitest run src/pages/Sales/Quotations/gst.test.js           --coverage --coverage.include=src/pages/Sales/Quotations/gst.js
cd web && pnpm exec vitest run src/pages/Sales/Quotations/amountInWords.test.js --coverage --coverage.include=src/pages/Sales/Quotations/amountInWords.js
cd web && pnpm exec vitest run src/pages/Sales/Quotations/finYear.test.js       --coverage --coverage.include=src/pages/Sales/Quotations/finYear.js
```
Expected: 10 + 6 + 15 + 9 tests PASS; every file ≥ 80 % lines and branches.

- [ ] **Step 5: Stop and report.** Do not stage or commit.

---

### Task 12: `ui/RichTextEditor` + the closed-toolbar guard

**Files (all under `web/src/components/ui/`):**
- Create: `richTextHtml.js` + `richTextHtml.test.js`
- Create: `richTextExtensions.js` + `richTextExtensions.test.js`
- Create: `RichTextEditor.jsx` + `RichTextEditor.test.jsx`
- Modify: `index.js`

**Interfaces:**
- Produces: `<RichTextEditor value onChange label hint minHeight disabled onEditorReady data-testid />` — `value`/`onChange` speak **HTML**, and an editor with nothing visible reports `""`, never `"<p></p>"`. `toPdfHtml(html)`, `isBlankHtml(html)`, `SUPPORTED_TAGS` (Task 13 consumes them). `buildExtensions()`, `COMMANDS`, `FONT_SIZES`, `LINE_HEIGHTS`, `SWATCHES`, `HIGHLIGHTS`.

It lives in `ui/` because the next feature that needs formatted text must not build a second editor.

**All six files below were written and run against the real libraries before this plan was finalised — Tiptap 3.31.3, `react-pdf-html` 2.1.5, React 19, jsdom: 42 guard tests + 21 component tests green.** Two things that work found, which the code and tests already carry — do not "simplify" them away:

1. **The converter drops a tag it cannot draw *together with its text*.** Tiptap's `Highlight` emits `<mark>`; the highlighted sentence was not in the PDF. Hence `BackgroundColor` instead, the closed `COMMANDS` map, `toPdfHtml`'s unwrap-never-drop rule, and the guard test that drives every command through the real converter.
2. **Tiptap emits an update on mount**, echoing the value it was just given. Reported naively, every quotation opens already "unsaved". Hence the `latest` ref in the component and the *"does not report a change just for being mounted"* test.

- [ ] **Step 1: Write the three test files**

`web/src/components/ui/richTextHtml.test.js`:
```js
import { describe, it, expect } from "vitest";
import { toPdfHtml, isBlankHtml, SUPPORTED_TAGS } from "./richTextHtml";

describe("toPdfHtml", () => {
  /**
   * REGRESSION, found by rendering a real PDF (2026-09-18). react-pdf-html
   * drops a tag it has no renderer for together with its text: Tiptap's
   * Highlight emits <mark>, and the highlighted sentence simply was not in the
   * PDF. No error, one console line. Unknown tags are unwrapped, never dropped.
   */
  it("keeps the words of a tag the PDF cannot draw", () => {
    expect(toPdfHtml("<p>Valid for <mark>15 days</mark> only</p>")).toBe("<p>Valid for 15 days only</p>");
  });

  it("unwraps nested unknowns and keeps the known formatting inside them", () => {
    expect(toPdfHtml("<div><section><p><strong>Bold</strong> <font>text</font></p></section></div>"))
      .toBe("<p><strong>Bold</strong> text</p>");
  });

  it("leaves everything the toolbar can produce untouched", () => {
    const html = '<h2 style="text-align: center;">T</h2><p><span style="color: rgb(185, 28, 28); font-size: 18px;">x</span> <u>u</u> <s>s</s> <em>e</em></p>'
      + "<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><blockquote><p>q</p></blockquote><hr>"
      + "<table><tbody><tr><th><p>h</p></th></tr><tr><td><p>d</p></td></tr></tbody></table>";
    expect(toPdfHtml(html)).toBe(html);
  });

  // Tiptap emits <colgroup><col> for every table; they carry no text and the
  // converter only logs about them.
  it("removes colgroup / col, script and style outright", () => {
    expect(toPdfHtml('<table><colgroup><col style="min-width: 25px;"></colgroup><tbody><tr><td><p>x</p></td></tr></tbody></table><script>alert(1)</script><style>p{}</style>'))
      .toBe("<table><tbody><tr><td><p>x</p></td></tr></tbody></table>");
  });

  it("keeps a safe link and unwraps an unsafe one", () => {
    expect(toPdfHtml('<p><a href="https://solarcare.in">site</a></p>')).toBe('<p><a href="https://solarcare.in">site</a></p>');
    expect(toPdfHtml('<p><a href="mailto:a@b.in">mail</a> <a href="tel:0792658">call</a></p>')).toContain('href="tel:0792658"');
    expect(toPdfHtml('<p><a href="javascript:alert(1)">click</a></p>')).toBe("<p>click</p>");
    expect(toPdfHtml("<p><a>bare</a></p>")).toBe("<p>bare</p>");
  });

  // A blank line in the editor is an empty <p>, which the PDF engine draws
  // zero-height — the spacing they typed would silently close up.
  it("gives an empty paragraph a non-breaking space so the blank line survives", () => {
    expect(toPdfHtml("<p>a</p><p></p><p>b</p>")).toBe("<p>a</p><p>&nbsp;</p><p>b</p>");
  });

  it("is an empty string for nothing", () => {
    expect(toPdfHtml("")).toBe("");
    expect(toPdfHtml(null)).toBe("");
    expect(toPdfHtml(42)).toBe("");
  });

  it("supports exactly the tags the renderer was seen drawing", () => {
    expect([...SUPPORTED_TAGS].sort()).toEqual(["a", "b", "blockquote", "br", "em", "h1", "h2", "h3", "hr", "i", "li", "ol", "p", "s", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"]);
  });
});

describe("isBlankHtml", () => {
  it.each([["", true], [null, true], ["<p></p>", true], ["<p>  </p><p><br></p>", true], ["<p>x</p>", false], ["<ul><li><p>a</p></li></ul>", false]])(
    "%p → %p", (html, blank) => expect(isBlankHtml(html)).toBe(blank),
  );
});
```
`web/src/components/ui/richTextExtensions.test.js`:
```js
import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { renderHtml } from "react-pdf-html";
import { buildExtensions, COMMANDS } from "./richTextExtensions";
import { toPdfHtml, SUPPORTED_TAGS } from "./richTextHtml";

const run = (name, arg) => {
  const editor = new Editor({ element: null, extensions: buildExtensions(), content: "<p>Sample quotation text</p>" });
  editor.commands.selectAll();
  COMMANDS[name](editor.chain(), arg).run();
  const html = editor.getHTML();
  editor.destroy();
  return html;
};
const tagsIn = (html) => [...new Set([...html.matchAll(/<([a-z0-9]+)[\s>]/g)].map((m) => m[1]))];

afterEach(() => vi.restoreAllMocks());

/**
 * THE CLOSED-TOOLBAR GUARD.
 *
 * react-pdf-html drops a tag it cannot draw together with its text. This runs
 * every command the toolbar can issue through the REAL editor, then through the
 * REAL converter, and fails if the converter says it excluded anything, or if
 * the editor emitted a tag richTextHtml does not list. Whoever adds a toolbar
 * button adds it to COMMANDS, and finds out here — not from a customer holding
 * a quotation with a sentence missing.
 */
describe("every toolbar command survives the trip to the PDF", () => {
  it.each(Object.keys(COMMANDS))("%s", (name) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = toPdfHtml(run(name));
    renderHtml(html);
    const excluded = [...log.mock.calls, ...warn.mock.calls].map((c) => c.join(" ")).filter((m) => /Excluding/i.test(m));
    expect(excluded).toEqual([]);
    expect(tagsIn(html).filter((t) => !SUPPORTED_TAGS.has(t))).toEqual([]);
  });

  it("actually formats — the guard above is not passing on unchanged text", () => {
    expect(run("bold")).toBe("<p><strong>Sample quotation text</strong></p>");
    expect(run("highlight")).toContain("background-color");
    expect(run("highlight")).not.toContain("<mark");
    expect(run("fontSize", "18px")).toContain("font-size: 18px");
    expect(run("alignCenter")).toContain("text-align: center");
    expect(run("insertTable")).toContain("<table");
  });
});

describe("what is deliberately not installed", () => {
  const names = new Editor({ element: null, extensions: buildExtensions() }).extensionManager.extensions.map((e) => e.name);

  it.each(["highlight", "code", "codeBlock", "image"])("%s", (name) => expect(names).not.toContain(name));

  it("refuses a javascript: link", () => {
    expect(run("link", "javascript:alert(1)")).not.toContain("<a");
    expect(run("link", "https://solarcare.in")).toContain('href="https://solarcare.in"');
  });

  // Resizing writes widths onto <col>, which the PDF ignores — the customer
  // would get different columns than the agent drew.
  it("does not let table columns be resized", () => {
    expect(run("insertTable")).not.toMatch(/<col[^>]*\swidth/);
  });
});
```
`web/src/components/ui/RichTextEditor.test.jsx`:
```jsx
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import RichTextEditor from "./RichTextEditor";

// The component reads theme.tokens; MUI's default theme has none.
const themed = (ui) => <ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>;

// jsdom cannot take keystrokes into a contenteditable, so tests select through
// the editor instance (onEditorReady) and then press the REAL toolbar buttons.
// Controlled, like every real caller: the editor only reports HTML that differs
// from the value it was last handed, so a harness that never feeds the value
// back would see "undo the colour" as no change at all.
function Controlled({ initial, onChange, ...rest }) {
  const [value, setValue] = useState(initial);
  return <RichTextEditor label="Message" value={value} onChange={(html) => { setValue(html); onChange(html); }} {...rest} />;
}

function setup({ value = "<p>Dear customer</p>", ...props } = {}) {
  let editor;
  const onChange = vi.fn();
  const utils = render(themed(<Controlled initial={value} onChange={onChange} onEditorReady={(e) => { editor = e; }} {...props} />));
  const selectAll = () => act(() => { editor.commands.selectAll(); });
  return { ...utils, onChange, selectAll, get editor() { return editor; } };
}
const last = (fn) => fn.mock.calls.at(-1)[0];

describe("RichTextEditor", () => {
  it("shows the value, labelled, with a formatting toolbar", () => {
    setup();
    expect(screen.getByText("Dear customer")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByRole("textbox").getAttribute("aria-labelledby")).toBe(screen.getByText("Message").id);
  });

  it.each([
    ["rich-text-bold", "<strong>"], ["rich-text-italic", "<em>"], ["rich-text-underline", "<u>"], ["rich-text-strike", "<s>"],
    ["rich-text-alignCenter", "text-align: center"], ["rich-text-bulletList", "<ul>"], ["rich-text-orderedList", "<ol>"], ["rich-text-blockquote", "<blockquote>"],
  ])("%s formats the selection and reports HTML", (testId, expected) => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId(testId));
    expect(last(t.onChange)).toContain(expected);
  });

  it("marks an active format as pressed", () => {
    const t = setup({ value: "<p><strong>Bold already</strong></p>" });
    t.selectAll();
    expect(screen.getByTestId("rich-text-bold").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("rich-text-italic").getAttribute("aria-pressed")).toBe("false");
  });

  it("changes block style, font and size from the selects", () => {
    const t = setup();
    t.selectAll();
    fireEvent.change(screen.getByTestId("rich-text-block"), { target: { value: "h2" } });
    expect(last(t.onChange)).toContain("<h2>");
    fireEvent.change(screen.getByTestId("rich-text-size"), { target: { value: "18px" } });
    expect(last(t.onChange)).toContain("font-size: 18px");
    fireEvent.change(screen.getByTestId("rich-text-font"), { target: { value: "Noto Serif" } });
    expect(last(t.onChange)).toContain("Noto Serif");
    fireEvent.change(screen.getByTestId("rich-text-leading"), { target: { value: "2" } });
    expect(last(t.onChange)).toContain("line-height: 2");
  });

  it("colours text from a swatch, and clears it with None", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-color"));
    fireEvent.click(screen.getByLabelText("#b91c1c"));
    expect(last(t.onChange)).toMatch(/color: (rgb\(185, 28, 28\)|#b91c1c)/);
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-color"));
    fireEvent.click(screen.getByText("None"));
    expect(last(t.onChange)).toBe("<p>Dear customer</p>");
  });

  // Highlight must be a styled <span>. Tiptap's own Highlight emits <mark>,
  // which the PDF converter drops together with the highlighted words.
  it("highlights with a background colour, never a <mark>", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-highlight"));
    fireEvent.click(screen.getByLabelText("#fde68a"));
    expect(last(t.onChange)).toContain("background-color");
    expect(last(t.onChange)).not.toContain("<mark");
  });

  it("takes any colour from the native picker", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-color"));
    fireEvent.change(screen.getByTestId("rich-text-custom-colour"), { target: { value: "#123456" } });
    expect(last(t.onChange)).toMatch(/color: (rgb\(18, 52, 86\)|#123456)/);
  });

  it("adds a link, refuses a javascript: one, and removes it", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-link"));
    fireEvent.change(screen.getByTestId("rich-text-href"), { target: { value: "https://solarcare.in" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(last(t.onChange)).toContain('href="https://solarcare.in"');

    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-link"));
    expect(screen.getByTestId("rich-text-href").value).toBe("https://solarcare.in"); // editing, not starting over
    fireEvent.click(screen.getByText("Remove"));
    expect(last(t.onChange)).not.toContain("<a");

    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-link"));
    fireEvent.change(screen.getByTestId("rich-text-href"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(last(t.onChange)).not.toContain("<a");
  });

  it("inserts a table; row and column actions wake up only inside one", () => {
    const t = setup();
    fireEvent.click(screen.getByTestId("rich-text-table"));
    expect(screen.getByTestId("rich-text-addRow").disabled).toBe(true);
    fireEvent.click(screen.getByTestId("rich-text-insertTable"));
    expect(last(t.onChange)).toContain("<table");
    expect((last(t.onChange).match(/<tr>/g) ?? []).length).toBe(3);
    fireEvent.click(screen.getByTestId("rich-text-table"));
    fireEvent.click(screen.getByTestId("rich-text-addRow"));
    expect((last(t.onChange).match(/<tr>/g) ?? []).length).toBe(4);
  });

  // "<p></p>" is what an emptied editor holds. Callers test `if (!html)`.
  it('reports "" — not "<p></p>" — when emptied', () => {
    const t = setup();
    act(() => { t.editor.commands.clearContent(true); });
    expect(last(t.onChange)).toBe("");
  });

  // REGRESSION (caught in the spike, 2026-09-18): Tiptap emits an update on
  // mount, echoing the value it was given. Every quotation would have opened
  // already marked "unsaved".
  it("does not report a change just for being mounted", () => {
    const t = setup();
    expect(t.onChange).not.toHaveBeenCalled();
  });

  it("takes a new value from the parent without echoing it back as a change", () => {
    const onChange = vi.fn();
    const { rerender } = render(themed(<RichTextEditor label="Message" value="<p>Dear customer</p>" onChange={onChange} />));
    rerender(themed(<RichTextEditor label="Message" value="<p>Revision 2</p>" onChange={onChange} />));
    expect(screen.getByText("Revision 2")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("locks the text and the toolbar when disabled", () => {
    setup({ disabled: true });
    expect(screen.getByRole("textbox").getAttribute("contenteditable")).toBe("false");
    expect(screen.getByTestId("rich-text-bold").disabled).toBe(true);
    expect(screen.getByTestId("rich-text-block").disabled).toBe(true);
  });

  it("shows a hint", () => {
    setup({ hint: "Shown above the price table" });
    expect(screen.getByText("Shown above the price table")).toBeTruthy();
  });
});
```
- [ ] **Step 2: Run one — it must fail**

Run: `cd web && pnpm exec vitest run src/components/ui/richTextHtml.test.js`
Expected: FAIL — cannot resolve `./richTextHtml`.

- [ ] **Step 3: Write the three modules**

`web/src/components/ui/richTextHtml.js`:
```js
// Editor HTML → HTML the PDF converter can draw.
//
// react-pdf-html drops any tag it has no renderer for TOGETHER WITH ITS TEXT —
// found the hard way (2026-09-18): Tiptap's Highlight emits <mark>, and the
// highlighted sentence simply vanished from the PDF, no error. The toolbar is a
// closed list so the editor never emits one, but stored HTML outlives the
// toolbar that made it, and a pasted document can carry anything. So before the
// converter sees it: an unknown element is UNWRAPPED (its children stay), never
// dropped. Worst case is lost formatting, never lost words.

export const SUPPORTED_TAGS = new Set([
  "p", "span", "strong", "em", "u", "s", "b", "i", "br", "hr",
  "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a",
  "table", "thead", "tbody", "tr", "th", "td",
]);
// Carry no text; the converter only logs about them.
const DROP_TAGS = new Set(["colgroup", "col", "script", "style"]);

const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

export function toPdfHtml(html) {
  if (!html || typeof html !== "string") return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  const walk = (node) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) { child.remove(); continue; }
      walk(child);
      if (!SUPPORTED_TAGS.has(tag)) { child.replaceWith(...child.childNodes); continue; }
      if (tag === "a" && !SAFE_HREF.test(child.getAttribute("href") ?? "")) child.replaceWith(...child.childNodes);
      // A blank line in the editor is an empty <p>, which the PDF engine draws
      // zero-height: the spacing they typed would silently close up.
      if (tag === "p" && !child.textContent && !child.children.length) child.textContent = "\u00a0";
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** True when the editor holds nothing a reader would see. */
export const isBlankHtml = (html) =>
  !html || !new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
```
`web/src/components/ui/richTextExtensions.js`:
```js
// What the editor can do — and therefore what the toolbar may offer.
//
// THE TOOLBAR IS A CLOSED LIST, and this file is the list. Rich text here ends
// up in a PDF through react-pdf-html, which drops any tag it has no renderer
// for TOGETHER WITH ITS TEXT (found 2026-09-18: Tiptap's Highlight emits
// <mark>, and the highlighted sentence was simply not in the PDF). So:
//   * highlight is BackgroundColor from TextStyleKit — a styled <span>, which
//     draws — and the Highlight extension is never installed;
//   * code / codeBlock are off (<code>, <pre>);
//   * tables are not resizable: resizing writes widths onto <col>, which the
//     PDF ignores, so the customer would get different columns than they drew;
//   * no image node: the attachment endpoint needs a JWT an <img src> cannot
//     send. Pictures live in the quotation's picture sections.
// richTextExtensions.test.js drives every command below through the real
// converter and fails on any tag it would drop. Add a feature there first.
import { StarterKit } from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";

export const FONT_SIZES = ["9px", "10px", "11px", "12px", "14px", "16px", "18px", "24px"];
export const LINE_HEIGHTS = ["1", "1.25", "1.5", "1.8", "2"];
export const SWATCHES = ["#0f172a", "#475569", "#b91c1c", "#c2410c", "#a16207", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9", "#be185d"];
export const HIGHLIGHTS = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#e2e8f0"];

export const buildExtensions = () => [
  StarterKit.configure({
    code: false,
    codeBlock: false,
    heading: { levels: [1, 2, 3] },
    // Tiptap itself refuses a javascript: href; this narrows it to what a
    // quotation can sensibly link to.
    link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto", "tel"] },
  }),
  TextStyleKit,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TableKit.configure({ table: { resizable: false } }),
];

/** Every toolbar action, by name → a chain step. The guard test walks this map. */
export const COMMANDS = {
  bold: (c) => c.toggleBold(),
  italic: (c) => c.toggleItalic(),
  underline: (c) => c.toggleUnderline(),
  strike: (c) => c.toggleStrike(),
  color: (c, v = "#b91c1c") => c.setColor(v),
  unsetColor: (c) => c.unsetColor(),
  highlight: (c, v = "#fde68a") => c.setBackgroundColor(v),
  unsetHighlight: (c) => c.unsetBackgroundColor(),
  fontSize: (c, v = "18px") => c.setFontSize(v),
  fontFamily: (c, v = "Noto Serif") => c.setFontFamily(v),
  lineHeight: (c, v = "1.8") => c.setLineHeight(v),
  alignLeft: (c) => c.setTextAlign("left"),
  alignCenter: (c) => c.setTextAlign("center"),
  alignRight: (c) => c.setTextAlign("right"),
  alignJustify: (c) => c.setTextAlign("justify"),
  paragraph: (c) => c.setParagraph(),
  h1: (c) => c.toggleHeading({ level: 1 }),
  h2: (c) => c.toggleHeading({ level: 2 }),
  h3: (c) => c.toggleHeading({ level: 3 }),
  bulletList: (c) => c.toggleBulletList(),
  orderedList: (c) => c.toggleOrderedList(),
  blockquote: (c) => c.toggleBlockquote(),
  divider: (c) => c.setHorizontalRule(),
  link: (c, v = "https://example.com") => c.extendMarkRange("link").setLink({ href: v }),
  unlink: (c) => c.unsetLink(),
  insertTable: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  addRow: (c) => c.addRowAfter(),
  addColumn: (c) => c.addColumnAfter(),
  deleteRow: (c) => c.deleteRow(),
  deleteColumn: (c) => c.deleteColumn(),
  toggleHeaderRow: (c) => c.toggleHeaderRow(),
  deleteTable: (c) => c.deleteTable(),
  clearFormatting: (c) => c.unsetAllMarks().clearNodes(),
  undo: (c) => c.undo(),
  redo: (c) => c.redo(),
};
```
`web/src/components/ui/RichTextEditor.jsx`:
```jsx
import { useEffect, useId, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useTheme } from "@mui/material/styles";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, Highlighter, Italic, Link2, List,
  ListOrdered, Minus, Quote, Redo2, RemoveFormatting, Strikethrough, Table2, Underline, Undo2,
} from "lucide-react";

import IconButton from "./IconButton";
import Popover from "./Popover";
import { buildExtensions, COMMANDS, FONT_SIZES, HIGHLIGHTS, LINE_HEIGHTS, SWATCHES } from "./richTextExtensions";

const FONTS = [{ value: "Inter", label: "Sans" }, { value: "Noto Serif", label: "Serif" }];
const BLOCKS = [{ value: "paragraph", label: "Text" }, { value: "h1", label: "Heading 1" }, { value: "h2", label: "Heading 2" }, { value: "h3", label: "Heading 3" }];
const TABLE_ACTIONS = [
  ["insertTable", "Insert 3 × 3 table"], ["addRow", "Add row below"], ["addColumn", "Add column right"],
  ["toggleHeaderRow", "Toggle header row"], ["deleteRow", "Delete row"], ["deleteColumn", "Delete column"], ["deleteTable", "Delete table"],
];

/**
 * The one rich-text editor (Tiptap 3, headless — the toolbar is ours).
 *
 * `value` / `onChange` speak HTML; an editor with nothing visible in it reports
 * "" rather than "<p></p>", so a caller's "is this empty?" is a plain falsy test.
 *
 * What the toolbar offers is decided in richTextExtensions.js, not here, and is
 * a CLOSED list: this HTML is printed to PDF, and the converter drops whatever
 * it cannot draw — text included. Do not add a button without adding its
 * command there, where the guard test will check it survives.
 */
export default function RichTextEditor({
  value = "",
  onChange,
  label,
  hint,
  minHeight = 120,
  disabled = false,
  onEditorReady,
  "data-testid": testId = "rich-text",
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const labelId = useId();
  const [pop, setPop] = useState(null); // { kind: 'color' | 'highlight' | 'link' | 'table', anchor }
  const [href, setHref] = useState("");

  // The editor emits an update on MOUNT (its plugins normalise the document),
  // echoing back the value it was just given. Reporting that as a change would
  // open every quotation already "unsaved". A change is only a change when the
  // HTML differs from what the parent last handed us.
  const latest = useRef(value || "");
  latest.current = value || "";

  const editor = useEditor({
    extensions: buildExtensions(),
    content: value || "",
    editable: !disabled,
    // v3 no longer re-renders React on every transaction; the toolbar's active
    // states need it. These editors hold a paragraph or two — it is cheap.
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { role: "textbox", "aria-multiline": "true", "aria-labelledby": labelId } },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? "" : ed.getHTML();
      if (html !== latest.current) onChange?.(html);
    },
  });

  useEffect(() => { if (editor) onEditorReady?.(editor); }, [editor, onEditorReady]);
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  // The parent owns the value (a revision loads, a template default is applied).
  // Only push it in when it genuinely differs, or every keystroke would reset
  // the caret to the end.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if ((value || "") !== current) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  const run = (name, arg) => COMMANDS[name](editor.chain().focus(), arg).run();
  const open = (kind) => (e) => {
    if (kind === "link") setHref(editor.getAttributes("link").href ?? "");
    setPop({ kind, anchor: e.currentTarget });
  };
  const close = () => setPop(null);

  const btn = (name, Icon, title, active = editor.isActive(name)) => (
    <IconButton key={name} size="sm" variant={active ? "tonal" : "ghost"} aria-label={title} aria-pressed={active}
      tooltip={title} disabled={disabled} onClick={() => run(name)} data-testid={`${testId}-${name}`}>
      <Icon size={15} />
    </IconButton>
  );
  const align = (name, Icon, title, dir) => btn(name, Icon, title, editor.isActive({ textAlign: dir }));

  // ponytail: native <select>s. A Combobox is an Autocomplete with a popper and
  // a text field; for "pick one of eight sizes" in a toolbar that is a lot of
  // machinery, and the native control is keyboard- and screen-reader-complete.
  const selectStyle = {
    height: 28, borderRadius: theme.radii.sm, border: `1px solid ${p.border.default}`, background: p.surface.card,
    color: p.text.primary, fontSize: 12, fontFamily: p.fontFamilies.sans, padding: "0 6px",
  };
  const block = BLOCKS.find((b) => (b.value === "paragraph" ? false : editor.isActive("heading", { level: Number(b.value[1]) })))?.value ?? "paragraph";
  const ts = editor.getAttributes("textStyle");
  const sep = <span aria-hidden style={{ width: 1, alignSelf: "stretch", background: p.border.default, margin: "2px 4px" }} />;

  const swatch = (color, onPick) => (
    <button key={color} type="button" aria-label={color} onClick={() => { onPick(color); close(); }}
      style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${p.border.strong}`, background: color, cursor: "pointer" }} />
  );

  return (
    <div data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: p.fontFamilies.sans }}>
      {label && <span id={labelId} style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary }}>{label}</span>}
      <div style={{ border: `1px solid ${p.border.default}`, borderRadius: theme.radii.md, background: p.surface.card, overflow: "hidden", opacity: disabled ? 0.7 : 1 }}>
        <div role="toolbar" aria-label="Formatting" data-testid={`${testId}-toolbar`}
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, padding: 4, borderBottom: `1px solid ${p.border.default}`, background: p.surface.subtle }}>
          <select aria-label="Block style" value={block} disabled={disabled} style={selectStyle} onChange={(e) => run(e.target.value)} data-testid={`${testId}-block`}>
            {BLOCKS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <select aria-label="Font" value={ts.fontFamily ?? "Inter"} disabled={disabled} style={selectStyle} onChange={(e) => run("fontFamily", e.target.value)} data-testid={`${testId}-font`}>
            {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select aria-label="Size" value={ts.fontSize ?? "10px"} disabled={disabled} style={selectStyle} onChange={(e) => run("fontSize", e.target.value)} data-testid={`${testId}-size`}>
            {FONT_SIZES.map((s) => <option key={s} value={s}>{parseInt(s, 10)}</option>)}
          </select>
          {sep}
          {btn("bold", Bold, "Bold")}{btn("italic", Italic, "Italic")}{btn("underline", Underline, "Underline")}{btn("strike", Strikethrough, "Strikethrough")}
          <IconButton size="sm" variant="ghost" aria-label="Text colour" tooltip="Text colour" disabled={disabled} onClick={open("color")} data-testid={`${testId}-color`}>
            <Baseline size={15} color={ts.color ?? undefined} />
          </IconButton>
          <IconButton size="sm" variant={ts.backgroundColor ? "tonal" : "ghost"} aria-label="Highlight" tooltip="Highlight" disabled={disabled} onClick={open("highlight")} data-testid={`${testId}-highlight`}>
            <Highlighter size={15} />
          </IconButton>
          {sep}
          {align("alignLeft", AlignLeft, "Align left", "left")}{align("alignCenter", AlignCenter, "Centre", "center")}
          {align("alignRight", AlignRight, "Align right", "right")}{align("alignJustify", AlignJustify, "Justify", "justify")}
          <select aria-label="Line spacing" value={ts.lineHeight ?? "1.5"} disabled={disabled} style={selectStyle} onChange={(e) => run("lineHeight", e.target.value)} data-testid={`${testId}-leading`}>
            {LINE_HEIGHTS.map((l) => <option key={l} value={l}>{l}×</option>)}
          </select>
          {sep}
          {btn("bulletList", List, "Bulleted list")}{btn("orderedList", ListOrdered, "Numbered list")}{btn("blockquote", Quote, "Quote")}
          {btn("divider", Minus, "Divider", false)}
          <IconButton size="sm" variant={editor.isActive("link") ? "tonal" : "ghost"} aria-label="Link" tooltip="Link" disabled={disabled} onClick={open("link")} data-testid={`${testId}-link`}><Link2 size={15} /></IconButton>
          <IconButton size="sm" variant={editor.isActive("table") ? "tonal" : "ghost"} aria-label="Table" tooltip="Table" disabled={disabled} onClick={open("table")} data-testid={`${testId}-table`}><Table2 size={15} /></IconButton>
          {sep}
          {btn("clearFormatting", RemoveFormatting, "Clear formatting", false)}{btn("undo", Undo2, "Undo", false)}{btn("redo", Redo2, "Redo", false)}
        </div>
        <EditorContent editor={editor} className="rte-content"
          style={{ minHeight, padding: "10px 12px", fontSize: 14, lineHeight: 1.5, color: p.text.primary, cursor: "text" }}
          onClick={() => editor.chain().focus().run()} />
      </div>
      {hint && <span style={{ fontSize: 12, color: p.text.tertiary }}>{hint}</span>}

      <Popover open={pop?.kind === "color" || pop?.kind === "highlight"} anchorEl={pop?.anchor} onClose={close} data-testid={`${testId}-swatches`}>
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, width: 176 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(pop?.kind === "highlight" ? HIGHLIGHTS : SWATCHES).map((c) => swatch(c, (v) => run(pop.kind, v)))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            {/* The platform's own picker — no colour-picker dependency for "any colour". */}
            <input type="color" aria-label="Custom colour" style={{ width: 36, height: 26, padding: 0, border: "none", background: "none" }}
              onChange={(e) => run(pop.kind, e.target.value)} data-testid={`${testId}-custom-colour`} />
            <button type="button" style={{ ...selectStyle, cursor: "pointer" }} onClick={() => { run(pop.kind === "highlight" ? "unsetHighlight" : "unsetColor"); close(); }}>None</button>
          </div>
        </div>
      </Popover>

      <Popover open={pop?.kind === "link"} anchorEl={pop?.anchor} onClose={close} data-testid={`${testId}-link-pop`}>
        <form style={{ padding: 10, display: "flex", gap: 6, alignItems: "center" }}
          onSubmit={(e) => { e.preventDefault(); if (href.trim()) run("link", href.trim()); else run("unlink"); close(); }}>
          <input aria-label="Link address" value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://" autoFocus
            style={{ ...selectStyle, width: 220, height: 30 }} data-testid={`${testId}-href`} />
          <button type="submit" style={{ ...selectStyle, cursor: "pointer" }}>Apply</button>
          <button type="button" style={{ ...selectStyle, cursor: "pointer" }} onClick={() => { run("unlink"); close(); }}>Remove</button>
        </form>
      </Popover>

      <Popover open={pop?.kind === "table"} anchorEl={pop?.anchor} onClose={close} data-testid={`${testId}-table-pop`}>
        <div style={{ padding: 6, display: "flex", flexDirection: "column", minWidth: 190 }}>
          {TABLE_ACTIONS.map(([name, text]) => (
            <button key={name} type="button" disabled={name !== "insertTable" && !editor.isActive("table")}
              style={{ ...selectStyle, border: "none", background: "none", textAlign: "left", height: 30, cursor: "pointer" }}
              onClick={() => { run(name); close(); }} data-testid={`${testId}-${name}`}>{text}</button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
```
The editor's own content needs a few styles Tiptap does not ship (it is headless). Add to the **end** of `web/src/index.css` (or whichever global stylesheet `main.jsx` imports — check, do not create a second one):

```css
/* ui/RichTextEditor — Tiptap is headless and ships no content styles. */
.rte-content .tiptap { outline: none; min-height: inherit; }
.rte-content .tiptap > * + * { margin-top: 0.4em; }
.rte-content .tiptap p { margin: 0; }
.rte-content .tiptap h1 { font-size: 1.5em; margin: 0.4em 0 0.2em; }
.rte-content .tiptap h2 { font-size: 1.25em; margin: 0.4em 0 0.2em; }
.rte-content .tiptap h3 { font-size: 1.1em; margin: 0.4em 0 0.2em; }
.rte-content .tiptap ul, .rte-content .tiptap ol { padding-left: 1.4em; margin: 0.2em 0; }
.rte-content .tiptap blockquote { margin: 0.4em 0; padding-left: 0.8em; border-left: 3px solid #cbd5e1; color: #64748b; }
.rte-content .tiptap hr { border: none; border-top: 1px solid #e2e8f0; margin: 0.8em 0; }
.rte-content .tiptap a { color: #4f46e5; text-decoration: underline; }
.rte-content .tiptap table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 0.5em 0; }
.rte-content .tiptap th, .rte-content .tiptap td { border: 1px solid #e2e8f0; padding: 4px 6px; vertical-align: top; }
.rte-content .tiptap th { background: #f8fafc; font-weight: 700; text-align: left; }
.rte-content .tiptap .selectedCell { background: #eef2ff; }
```

Add to `web/src/components/ui/index.js`:

```js
export { default as RichTextEditor } from "./RichTextEditor";
```

- [ ] **Step 4: Green, with coverage — one file per run**

```bash
cd web && pnpm exec vitest run src/components/ui/richTextHtml.test.js       --coverage --coverage.include=src/components/ui/richTextHtml.js
cd web && pnpm exec vitest run src/components/ui/richTextExtensions.test.js --coverage --coverage.include=src/components/ui/richTextExtensions.js
cd web && pnpm exec vitest run src/components/ui/RichTextEditor.test.jsx    --coverage --coverage.include=src/components/ui/RichTextEditor.jsx
```
Expected: 14 + 42 + 21 tests PASS; each file ≥ 80 %. If `RichTextEditor.test.jsx` fails on a missing DOM API (`getClientRects`, `elementFromPoint`) that the scratchpad run did not need, add the smallest possible stub to `src/test/setup.js` and say so in your report — do not mock Tiptap.

- [ ] **Step 5: Stop and report.** Do not stage or commit.

---

### Task 13: `quotationQueries` · `buildQuoteDoc` · PDF fonts / `RichHtml` / parts · `reactPdfMock`

**Files:**
- Create: `web/src/api/quotationQueries.js` + `quotationQueries.test.js`
- Create: `web/src/test/reactPdfMock.jsx`
- Create (under `web/src/pages/Sales/Quotations/`): `buildQuoteDoc.js` + `buildQuoteDoc.test.js`, `pdf/fonts.js` + `pdf/fonts.test.js`, `pdf/fontSources.js`, `pdf/RichHtml.jsx`, `pdf/parts.jsx`
- Modify: `web/src/test/mocks/handlers.js` (default handlers, so an unrelated page test never trips `onUnhandledRequest: "error"`)

**Interfaces:**
- Consumes: Task 11's `amountInWords`, `stateByCode`; Task 12's `toPdfHtml`, `isBlankHtml`.
- Produces: `QUOTATION_ENDPOINTS` + one fetcher per endpoint; `buildQuoteDoc({ header, company, content, items, amounts, images, samples })` → the view-model every template prints; `amountsFromServer(quotation, lines)`; `money`, `dmy`; `registerFonts(sources)`, `FONT_FAMILIES`, `FONT_SOURCES`; the shared parts (`PartyBlock`, `Subject`, `LineTable`, `TotalsBlock`, `RichSection`, `ExtraSections`, `BankAndSign`, `PageFooter`, `DraftWatermark`, `pageStyle`, colour constants).

**Templates are dumb on purpose.** They place strings. All arithmetic lives in `quoteMath` (draft) or came from the SP (final); **all formatting lives in `buildQuoteDoc`**, where it can be tested without a PDF engine. `buildQuoteDoc`, `parts`, `RichHtml` and `fonts` below were written and **rendered to real PDFs** before this plan was finalised (14 tests green; three layout defects found by looking at the output and fixed — list bullets colliding with their text, a table header stranded at a page foot, continuation pages starting at the paper's edge).

- [ ] **Step 1: The API module — test first**

`web/src/api/quotationQueries.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({ apiClient: { post: vi.fn() } }));

import { apiClient } from "../utils/axiosConfig";
import * as q from "./quotationQueries";

beforeEach(() => vi.clearAllMocks());

describe("quotationQueries", () => {
  it.each([
    ["saveQuotation", "/api/quotations/saveQuotation"],
    ["fetchQuotations", "/api/quotations/fetchQuotations"],
    ["fetchQuotationDetail", "/api/quotations/fetchQuotationDetail"],
    ["finaliseQuotation", "/api/quotations/finaliseQuotation"],
    ["reviseQuotation", "/api/quotations/reviseQuotation"],
    ["rejectQuotation", "/api/quotations/rejectQuotation"],
    ["deleteQuotation", "/api/quotations/deleteQuotation"],
    ["ensureQuoteProfile", "/api/quotations/ensureQuoteProfile"],
    ["saveQuoteProfile", "/api/quotations/saveQuoteProfile"],
    ["convertLead", "/api/leads/convertLead"],
  ])("%s posts to %s", (fn, url) => {
    q[fn]({ a: 1 });
    expect(apiClient.post).toHaveBeenCalledWith(url, { a: 1 });
  });

  it("defaults to an empty body", () => {
    q.fetchQuotations();
    expect(apiClient.post).toHaveBeenCalledWith("/api/quotations/fetchQuotations", {});
  });

  it("names every endpoint exactly once", () => {
    const urls = Object.values(q.QUOTATION_ENDPOINTS);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(10);
  });
});
```
`web/src/api/quotationQueries.js`:
```js
// src/api/quotationQueries.js
// Endpoint constants + thin POST fetchers for quotations and the lead convert
// engine (spec 3). Same shape as salesQueries.js. Nothing in a page inlines one
// of these URLs.
import { apiClient } from "../utils/axiosConfig";

export const QUOTATION_ENDPOINTS = {
  saveQuotation: "/api/quotations/saveQuotation",
  fetchQuotations: "/api/quotations/fetchQuotations",
  fetchQuotationDetail: "/api/quotations/fetchQuotationDetail",
  finaliseQuotation: "/api/quotations/finaliseQuotation",
  reviseQuotation: "/api/quotations/reviseQuotation",
  rejectQuotation: "/api/quotations/rejectQuotation",
  deleteQuotation: "/api/quotations/deleteQuotation",
  ensureQuoteProfile: "/api/quotations/ensureQuoteProfile",
  saveQuoteProfile: "/api/quotations/saveQuoteProfile",
  // Lives under /api/leads: winning a lead is a lead action, with or without a
  // quotation. Kept here because every caller is a quotation screen or WonDialog.
  convertLead: "/api/leads/convertLead",
};

const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

export const saveQuotation = post(QUOTATION_ENDPOINTS.saveQuotation);
export const fetchQuotations = post(QUOTATION_ENDPOINTS.fetchQuotations);
export const fetchQuotationDetail = post(QUOTATION_ENDPOINTS.fetchQuotationDetail);
export const finaliseQuotation = post(QUOTATION_ENDPOINTS.finaliseQuotation);
export const reviseQuotation = post(QUOTATION_ENDPOINTS.reviseQuotation);
export const rejectQuotation = post(QUOTATION_ENDPOINTS.rejectQuotation);
export const deleteQuotation = post(QUOTATION_ENDPOINTS.deleteQuotation);
export const ensureQuoteProfile = post(QUOTATION_ENDPOINTS.ensureQuoteProfile);
export const saveQuoteProfile = post(QUOTATION_ENDPOINTS.saveQuoteProfile);
export const convertLead = post(QUOTATION_ENDPOINTS.convertLead);
```
Run: `cd web && pnpm exec vitest run src/api/quotationQueries.test.js --coverage --coverage.include=src/api/quotationQueries.js` — FAIL before the module exists, PASS (12 tests, 100 %) after.

- [ ] **Step 2: Default MSW handlers**

`src/test/setup.js` starts MSW with `onUnhandledRequest: "error"`. `LeadDetail` (Task 16) will fetch a lead's quotations on mount, so **every existing `LeadDetail` test would start failing on an unhandled request**. Open `web/src/test/mocks/handlers.js`, follow the shape of the handlers already there, and add harmless defaults:

```js
  http.post("*/api/quotations/fetchQuotations", () => HttpResponse.json({
    success: true, message: "ok", responseCode: 200,
    data: { quotations: [], pagination: { currentPage: 1, pageSize: 25, totalRecords: 0, totalPages: 0 } },
  })),
```
(If `handlers.js` builds its responses through a local helper, use that helper instead of the literal.) A test that cares overrides it with `server.use(...)`.

- [ ] **Step 3: The react-pdf test double**

`web/src/test/reactPdfMock.jsx`:
```jsx
// A test double for @react-pdf/renderer (and react-pdf-html).
//
// jsdom cannot run the real renderer — it lays out and paints a PDF. What a
// unit test CAN check is what a template decided to print: is there an IGST
// row, is the GST column gone for an unregistered seller, is DRAFT stamped on
// a draft. So each primitive becomes a plain DOM element and RTL reads the text.
// What the PDF actually LOOKS like is checked by eye in the live pass.
//
//   vi.mock("@react-pdf/renderer", () => import("<rel>/test/reactPdfMock"));
//   vi.mock("react-pdf-html", async () => ({ default: (await import("<rel>/test/reactPdfMock")).Html }));
import { vi } from "vitest";

export const Document = ({ children, title }) => <div data-pdf="document" data-title={title}>{children}</div>;
export const Page = ({ children }) => <section data-pdf="page">{children}</section>;
export const View = ({ children, fixed, wrap }) => (
  <div data-pdf="view" data-fixed={fixed ? "" : undefined} data-wrap={wrap === false ? "false" : undefined}>{children}</div>
);
export const Text = ({ children, render }) => <span data-pdf="text">{render ? render({ pageNumber: 1, totalPages: 1 }) : children}</span>;
export const Image = ({ src }) => <img data-pdf="image" src={src} alt="" />;
export const StyleSheet = { create: (styles) => styles };
export const Font = { register: vi.fn(), registerHyphenationCallback: vi.fn() };

/** react-pdf-html's <Html>: the HTML string, as text. Enough to assert it was handed over. */
export const Html = ({ children }) => <div data-pdf="html">{children}</div>;

/** usePDF → [instance, update]. Tests reach the spies through `usePDF.update`. */
export const usePDF = vi.fn(() => [{ loading: false, url: "blob:preview", blob: new Blob(["pdf"]), error: null }, usePDF.update]);
usePDF.update = vi.fn();
```
- [ ] **Step 4: `buildQuoteDoc` — test first**

`web/src/pages/Sales/Quotations/buildQuoteDoc.test.js`:
```js
import { describe, it, expect } from "vitest";
import { buildQuoteDoc, amountsFromServer, money, dmy } from "./buildQuoteDoc";
import { computeQuote } from "./quoteMath";

const items = [
  { description: "5 kW Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 },
  { description: "Installation", hsn: "", qty: 2.5, unit: "", rate: 1000, discountType: "pct", discountValue: 10, taxPct: 18 },
];
const company = { name: "Solar Care", address: "402 Titanium", city: "Ahmedabad", stateCode: "24", pincode: "380054", gstin: "24ABCDE1234F1Z5", phone: "079", email: "s@s.in", accent: "#0f766e", logoAttachmentId: 9 };
const header = { Status: "final", QuoteNo: "QT-2627-0042", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", ToName: "Ramesh Patel", ToCity: "Ahmedabad", ToPincode: "380015", ToStateCode: "24", ToMobile: "9825012345" };
const build = (over = {}) => {
  const h = { ...header, ...(over.header ?? {}) };
  const c = { ...company, ...(over.company ?? {}) };
  return buildQuoteDoc({ header: h, company: c, content: over.content ?? {}, items, images: { 9: "data:logo", 21: "data:pic" }, samples: { logo: "sample:logo", header: "sample:header" },
    amounts: computeQuote(items, { sellerGstin: c.gstin, sellerState: c.stateCode, buyerState: h.ToStateCode }) });
};

describe("formatting", () => {
  it("prints money with Indian grouping and two decimals", () => {
    expect(money(341930)).toBe("₹3,41,930.00");
    expect(money(0)).toBe("₹0.00");
    expect(money(null)).toBe("₹0.00");
    expect(money(12345678.5)).toBe("₹1,23,45,678.50");
  });

  // toISOString() is UTC and rolls the date back a day for every user in IST.
  it("prints a date as DD-MM-YYYY from the string, never through a Date", () => {
    expect(dmy("2026-04-01")).toBe("01-04-2026");
    expect(dmy("2026-04-01T00:00:00.000Z")).toBe("01-04-2026");
    expect(dmy(null)).toBe("");
  });
});

describe("buildQuoteDoc", () => {
  it("numbers a final quote and marks a draft as DRAFT", () => {
    expect(build()).toMatchObject({ isDraft: false, quoteNo: "QT-2627-0042", quoteDate: "18-09-2026", validTill: "03-10-2026" });
    expect(build({ header: { Status: "draft", QuoteNo: null } })).toMatchObject({ isDraft: true, quoteNo: "DRAFT" });
  });

  it("formats each line; a discount shows as the user entered it", () => {
    const d = build();
    expect(d.rows[0]).toEqual({ sr: "1", description: "5 kW Rooftop", hsn: "8541", qtyText: "1 Set", rateText: "₹2,80,000.00", discountText: "₹10,000.00", taxPctText: "12%", amountText: "₹2,70,000.00" });
    expect(d.rows[1]).toMatchObject({ qtyText: "2.5", discountText: "10%", amountText: "₹2,250.00" });
    expect(d).toMatchObject({ showHsn: true, showDiscount: true });
  });

  it("intra-state: CGST + SGST rows and a two-column tax summary", () => {
    const d = build();
    expect(d.totals.map((t) => t.label)).toEqual(["Sub total", "Discount", "Taxable value", "CGST", "SGST"]);
    expect(d.gstSummary).toEqual([
      { rateText: "12%", taxableText: "₹2,70,000.00", cgstText: "₹16,200.00", sgstText: "₹16,200.00", igstText: "₹0.00" },
      { rateText: "18%", taxableText: "₹2,250.00", cgstText: "₹202.50", sgstText: "₹202.50", igstText: "₹0.00" },
    ]);
    expect(d.grandTotalText).toBe("₹3,05,055.00");
    expect(d.amountInWords).toBe("Rupees Three Lakh Five Thousand Fifty Five Only");
  });

  it("inter-state: one IGST row, and the place of supply is named", () => {
    const d = build({ header: { ToStateCode: "27" } });
    expect(d.inter).toBe(true);
    expect(d.totals.map((t) => t.label)).toEqual(["Sub total", "Discount", "Taxable value", "IGST"]);
    expect(d.to.placeOfSupply).toBe("Maharashtra (27)");
  });

  // An unregistered seller charges no GST: the template must not print a GST
  // column, a tax summary, or a GSTIN line at all.
  it("unregistered seller: no tax anywhere", () => {
    const d = build({ company: { gstin: "" } });
    expect(d.taxed).toBe(false);
    expect(d.gstSummary).toEqual([]);
    expect(d.rows[0].taxPctText).toBe("");
    expect(d.totals.map((t) => t.label)).toEqual(["Sub total", "Discount", "Taxable value"]);
    expect(d.company.gstin).toBe("");
  });

  it("shows a round-off row only when there is one, signed", () => {
    const one = [{ description: "x", qty: 1, rate: 100.1, discountType: "pct", discountValue: 0, taxPct: 5 }];
    const d = buildQuoteDoc({ header, company, items: one, amounts: computeQuote(one, { sellerGstin: company.gstin, sellerState: "24", buyerState: "24" }) });
    expect(d.totals.at(-1)).toEqual({ label: "Round off", value: "− ₹0.11" });
    expect(build().totals.some((t) => t.label === "Round off")).toBe(false);
  });

  it("uses the company's image, then the sample, and nothing when switched off", () => {
    expect(build().logoSrc).toBe("data:logo");
    expect(build().headerSrc).toBe("sample:header");                       // no id yet → sample art
    expect(build({ company: { showHeader: false } }).headerSrc).toBeNull(); // removed outright
    expect(build({ company: { logoAttachmentId: 77 } }).logoSrc).toBeNull(); // id set but blob not loaded: draw nothing, never the sample
  });

  it("falls back to the default accent for anything that is not #RRGGBB", () => {
    expect(build().accent).toBe("#0f766e");
    expect(build({ company: { accent: "red" } }).accent).toBe("#1e3a8a");
  });

  it("drops blank rich text and empty sections; keeps pictures whose blob loaded", () => {
    const d = build({ content: { intro: "<p></p>", terms: "<p>50% advance <mark>now</mark></p>", sections: [
      { type: "text", title: "", body: "<p> </p>" },
      { type: "text", title: "Scope", body: "<p>x</p>" },
      { type: "images", title: "Sites", items: [{ attachmentId: 21, caption: "Bopal" }, { attachmentId: 404, caption: "lost" }] },
      { type: "images", title: "None loaded", items: [{ attachmentId: 404 }] },
    ] } });
    expect(d.intro).toBe("");
    expect(d.terms).toBe("<p>50% advance now</p>");
    expect(d.sections).toEqual([
      { type: "text", title: "Scope", html: "<p>x</p>" },
      { type: "images", title: "Sites", items: [{ src: "data:pic", caption: "Bopal" }] },
    ]);
  });

  it("composes address and contact lines, skipping what is empty", () => {
    const d = build();
    expect(d.company.addressLines).toEqual(["402 Titanium", "Ahmedabad, Gujarat, 380054"]);
    expect(d.company.contactLine).toBe("079  ·  s@s.in");
    expect(d.to.addressLines).toEqual(["Ahmedabad 380015"]);
  });

  it("survives being handed nothing", () => {
    const d = buildQuoteDoc({});
    expect(d).toMatchObject({ isDraft: true, quoteNo: "DRAFT", rows: [], sections: [], grandTotalText: "₹0.00" });
  });
});

describe("amountsFromServer", () => {
  it("maps the SP's stored columns onto computeQuote's shape", () => {
    const a = amountsFromServer(
      { SellerGSTIN: "24ABCDE1234F1Z5", SellerStateCode: "24", ToStateCode: "27", SubTotal: 100, DiscountTotal: 0, TaxableTotal: 100, CgstTotal: 0, SgstTotal: 0, IgstTotal: 18, RoundOff: 0, GrandTotal: 118 },
      [{ GrossAmt: 100, DiscountAmt: 0, TaxableAmt: 100, CgstAmt: 0, SgstAmt: 0, IgstAmt: 18, LineTotal: 118 }],
    );
    expect(a).toMatchObject({ taxed: true, inter: true, igstTotal: 18, grandTotal: 118 });
    expect(a.lines[0]).toEqual({ grossAmt: 100, discountAmt: 0, taxableAmt: 100, cgstAmt: 0, sgstAmt: 0, igstAmt: 18, lineTotal: 118 });
    expect(amountsFromServer({ SellerGSTIN: null }).taxed).toBe(false);
  });
});
```
Run: `cd web && pnpm exec vitest run src/pages/Sales/Quotations/buildQuoteDoc.test.js` — expected FAIL (cannot resolve `./buildQuoteDoc`).

`web/src/pages/Sales/Quotations/buildQuoteDoc.js`:
```js
// Everything a template prints, already formatted. Templates are dumb on
// purpose: they place strings. All arithmetic lives in quoteMath (draft) or
// came from the SP (final); all formatting lives here, where it can be tested
// without a PDF engine.
import { amountInWords } from "./amountInWords";
import { stateByCode } from "./gst";
import { toPdfHtml, isBlankHtml } from "../../../components/ui/richTextHtml";

export const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const pct = (n) => `${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

// Local Y/M/D — never toISOString(), which is UTC and rolls the date back a day in IST.
export const dmy = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

const lines = (...parts) => parts.map((p) => String(p ?? "").trim()).filter(Boolean);

/** The SP's stored columns → the shape computeQuote returns, so one builder serves draft and final. */
export const amountsFromServer = (q, rows = []) => ({
  taxed: Boolean(q.SellerGSTIN),
  inter: Boolean(q.SellerGSTIN) && Boolean(q.ToStateCode) && q.ToStateCode !== q.SellerStateCode,
  lines: rows.map((r) => ({
    grossAmt: Number(r.GrossAmt), discountAmt: Number(r.DiscountAmt), taxableAmt: Number(r.TaxableAmt),
    cgstAmt: Number(r.CgstAmt), sgstAmt: Number(r.SgstAmt), igstAmt: Number(r.IgstAmt), lineTotal: Number(r.LineTotal),
  })),
  subTotal: Number(q.SubTotal), discountTotal: Number(q.DiscountTotal), taxableTotal: Number(q.TaxableTotal),
  cgstTotal: Number(q.CgstTotal), sgstTotal: Number(q.SgstTotal), igstTotal: Number(q.IgstTotal),
  roundOff: Number(q.RoundOff), grandTotal: Number(q.GrandTotal),
});

/**
 * @param header   { Status, QuoteNo, QuoteDate, ValidTill, Subject, ToName, ToCompany, ToMobile, ToEmail,
 *                   ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN }
 * @param company  CompanyJSON
 * @param content  ContentJSON
 * @param items    [{ description, hsn, qty, unit, rate, discountType, discountValue, taxPct }]
 * @param amounts  computeQuote(...) or amountsFromServer(...)
 * @param images   { [attachmentId]: dataUrl } — resolved by useQuoteImages; a missing id draws nothing
 * @param samples  { logo, header } — the sample art, shown while the id is null
 */
export function buildQuoteDoc({ header = {}, company = {}, content = {}, items = [], amounts, images = {}, samples = {} }) {
  const isDraft = (header.Status ?? "draft") === "draft";
  const taxed = Boolean(amounts?.taxed);
  const inter = Boolean(amounts?.inter);
  const a = amounts ?? { lines: [] };

  const rows = items.map((it, i) => {
    const amt = a.lines?.[i] ?? {};
    const discounted = Number(amt.discountAmt) > 0;
    return {
      sr: String(i + 1),
      description: String(it.description ?? ""),
      hsn: String(it.hsn ?? ""),
      qtyText: [qty(it.qty), it.unit].filter(Boolean).join(" "),
      rateText: money(it.rate),
      discountText: !discounted ? "" : it.discountType === "amt" ? money(amt.discountAmt) : pct(it.discountValue),
      taxPctText: taxed ? pct(it.taxPct) : "",
      amountText: money(amt.taxableAmt),
    };
  });

  // Tax by rate — what an accountant looks for first.
  const byRate = new Map();
  items.forEach((it, i) => {
    const amt = a.lines?.[i] ?? {};
    const key = Number(it.taxPct || 0);
    const g = byRate.get(key) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable += Number(amt.taxableAmt || 0); g.cgst += Number(amt.cgstAmt || 0);
    g.sgst += Number(amt.sgstAmt || 0); g.igst += Number(amt.igstAmt || 0);
    byRate.set(key, g);
  });
  const gstSummary = !taxed ? [] : [...byRate.entries()].sort((x, y) => x[0] - y[0]).map(([rate, g]) => ({
    rateText: pct(rate), taxableText: money(g.taxable), cgstText: money(g.cgst), sgstText: money(g.sgst), igstText: money(g.igst),
  }));

  const totals = [
    { label: "Sub total", value: money(a.subTotal) },
    ...(Number(a.discountTotal) > 0 ? [{ label: "Discount", value: `− ${money(a.discountTotal)}` }, { label: "Taxable value", value: money(a.taxableTotal) }] : []),
    ...(taxed && !inter ? [{ label: "CGST", value: money(a.cgstTotal) }, { label: "SGST", value: money(a.sgstTotal) }] : []),
    ...(taxed && inter ? [{ label: "IGST", value: money(a.igstTotal) }] : []),
    ...(Number(a.roundOff) !== 0 ? [{ label: "Round off", value: `${a.roundOff < 0 ? "− " : ""}${money(Math.abs(a.roundOff))}` }] : []),
  ];

  const pick = (id, sample, show) => (show === false ? null : id ? images[id] ?? null : sample ?? null);

  const sections = (Array.isArray(content.sections) ? content.sections : []).map((s) =>
    s?.type === "images"
      ? { type: "images", title: String(s.title ?? ""), items: (s.items ?? []).map((im) => ({ src: images[im.attachmentId] ?? null, caption: String(im.caption ?? "") })).filter((im) => im.src) }
      : { type: "text", title: String(s?.title ?? ""), html: toPdfHtml(s?.body) },
  ).filter((s) => (s.type === "images" ? s.items.length > 0 : !isBlankHtml(s.html) || s.title));

  return {
    isDraft,
    title: "Quotation",
    quoteNo: isDraft ? "DRAFT" : String(header.QuoteNo ?? ""),
    quoteDate: dmy(header.QuoteDate),
    validTill: dmy(header.ValidTill),
    subject: String(header.Subject ?? ""),
    accent: /^#[0-9a-f]{6}$/i.test(company.accent ?? "") ? company.accent : "#1e3a8a",
    logoSrc: pick(company.logoAttachmentId, samples.logo, company.showLogo),
    headerSrc: pick(company.headerAttachmentId, samples.header, company.showHeader),
    company: {
      name: String(company.name ?? ""),
      addressLines: lines(company.address, [company.city, stateByCode(company.stateCode)?.name, company.pincode].filter(Boolean).join(", ")),
      contactLine: lines(company.phone, company.email, company.website).join("  ·  "),
      gstin: String(company.gstin ?? ""),
      bank: String(company.bank ?? ""),
      signatory: String(company.signatory ?? ""),
    },
    to: {
      name: String(header.ToName ?? ""),
      company: String(header.ToCompany ?? ""),
      addressLines: lines(header.ToAddress, [header.ToCity, header.ToPincode].filter(Boolean).join(" ")),
      contactLine: lines(header.ToMobile, header.ToEmail).join("  ·  "),
      gstin: String(header.ToGSTIN ?? ""),
      placeOfSupply: stateByCode(header.ToStateCode) ? `${stateByCode(header.ToStateCode).name} (${header.ToStateCode})` : "",
    },
    taxed, inter,
    showHsn: rows.some((r) => r.hsn),
    showDiscount: rows.some((r) => r.discountText),
    rows, gstSummary, totals,
    grandTotalText: money(a.grandTotal),
    amountInWords: amountInWords(a.grandTotal),
    intro: isBlankHtml(content.intro) ? "" : toPdfHtml(content.intro),
    terms: isBlankHtml(content.terms) ? "" : toPdfHtml(content.terms),
    notes: isBlankHtml(content.notes) ? "" : toPdfHtml(content.notes),
    sections,
  };
}
```
Run again with coverage: `cd web && pnpm exec vitest run src/pages/Sales/Quotations/buildQuoteDoc.test.js --coverage --coverage.include=src/pages/Sales/Quotations/buildQuoteDoc.js` — expected 14 PASS, ≥ 80 %.

- [ ] **Step 5: `registerFonts` — test first**

`fonts.js` is not a react-pdf component; it is a registration table. A family
that registers three of its four faces fails at *render* time with "Could not
resolve font…", pages away from the mistake — so the registration is worth one
small test, and `fontSources.js` is pinned in the same file.

`web/src/pages/Sales/Quotations/pdf/fonts.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@react-pdf/renderer", () => import("../../../../test/reactPdfMock"));

const FACES = { regular: "r.ttf", italic: "i.ttf", bold: "b.ttf", boldItalic: "bi.ttf" };

// registerFonts guards itself with a module-level flag, so each test takes a
// fresh copy of the module (and of the mocked Font it registers against).
const load = async () => {
  vi.resetModules();
  const [fonts, pdf] = await Promise.all([import("./fonts"), import("@react-pdf/renderer")]);
  pdf.Font.register.mockClear();
  pdf.Font.registerHyphenationCallback.mockClear();
  return { ...fonts, Font: pdf.Font };
};

describe("registerFonts", () => {
  it("registers every family with all four faces", async () => {
    const { registerFonts, Font } = await load();
    registerFonts({ Inter: FACES, "Noto Serif": FACES });

    expect(Font.register).toHaveBeenCalledTimes(2);
    expect(Font.register.mock.calls.map(([a]) => a.family)).toEqual(["Inter", "Noto Serif"]);
    for (const [arg] of Font.register.mock.calls) {
      expect(arg.fonts).toEqual([
        { src: "r.ttf" },
        { src: "i.ttf", fontStyle: "italic" },
        { src: "b.ttf", fontWeight: 700 },
        { src: "bi.ttf", fontWeight: 700, fontStyle: "italic" },
      ]);
    }
    // Whole words only — the engine otherwise breaks "quo-tation" in a cell.
    const [hyphenate] = Font.registerHyphenationCallback.mock.calls[0];
    expect(hyphenate("quotation")).toEqual(["quotation"]);
  });

  it("registers once, however often it is called", async () => {
    const { registerFonts, Font } = await load();
    registerFonts({ Inter: FACES });
    registerFonts({ Inter: FACES });
    expect(Font.register).toHaveBeenCalledTimes(1);
  });

  /**
   * A missing face registers `src: undefined` and the renderer throws the first
   * time bold-italic text meets that family — far from the cause. Refuse the
   * whole call instead, before anything is registered.
   */
  it("rejects a family missing a face rather than half-registering it", async () => {
    const { registerFonts, Font } = await load();
    expect(() => registerFonts({ Inter: FACES, "Noto Serif": { regular: "r.ttf", bold: "b.ttf" } }))
      .toThrow(/Noto Serif.*italic/i);
    expect(Font.register).not.toHaveBeenCalled();
  });

  it("offers exactly the families it can register", async () => {
    const { FONT_FAMILIES } = await load();
    expect(FONT_FAMILIES.map((f) => f.value)).toEqual(["Inter", "Noto Serif"]);
  });

  it("ships all four faces for each family in FONT_SOURCES", async () => {
    const { FONT_SOURCES } = await import("./fontSources");
    expect(Object.keys(FONT_SOURCES)).toEqual(["Inter", "Noto Serif"]);
    for (const faces of Object.values(FONT_SOURCES)) {
      expect(Object.keys(faces)).toEqual(["regular", "italic", "bold", "boldItalic"]);
      for (const url of Object.values(faces)) expect(url).toBeTruthy();
    }
  });
});
```

Run: `cd web && pnpm exec vitest run src/pages/Sales/Quotations/pdf/fonts.test.js`
Expected: FAIL — the modules do not exist yet.

- [ ] **Step 6: Fonts, `RichHtml`, parts**

`RichHtml` and `parts` are react-pdf components: jsdom cannot paint them, and mocking them to test themselves proves nothing. They are covered by Task 14's template tests (which render them through `reactPdfMock`) and, for how they actually *look*, by Task 22. No test file of their own. `fonts.js` and `fontSources.js` are the exception — Step 5 tests them.

`web/src/pages/Sales/Quotations/pdf/fonts.js`:
```js
// Fonts the PDF can draw. Every family needs ALL FOUR faces: the renderer
// throws ("Could not resolve font…") the moment bold-italic text meets a family
// that registered no bold-italic. The 14 built-in PDF fonts are not offered at
// all — none of them has the rupee sign (U+20B9).
import { Font } from "@react-pdf/renderer";

export const FONT_FAMILIES = [
  { value: "Inter", label: "Inter (sans)" },
  { value: "Noto Serif", label: "Noto Serif" },
];

const FACES = ["regular", "italic", "bold", "boldItalic"];

let registered = false;

/** @param sources { Inter: { regular, italic, bold, boldItalic }, "Noto Serif": {…} } — URLs (app) or file paths (node) */
export function registerFonts(sources) {
  if (registered) return;
  // Check every family BEFORE registering any: a missing face would register as
  // `src: undefined` and only blow up when text of that weight is laid out.
  for (const [family, f] of Object.entries(sources)) {
    const missing = FACES.filter((face) => !f?.[face]);
    if (missing.length) throw new Error(`Font "${family}" is missing ${missing.join(", ")} — a family needs all four faces`);
  }
  for (const [family, f] of Object.entries(sources)) {
    Font.register({
      family,
      fonts: [
        { src: f.regular },
        { src: f.italic, fontStyle: "italic" },
        { src: f.bold, fontWeight: 700 },
        { src: f.boldItalic, fontWeight: 700, fontStyle: "italic" },
      ],
    });
  }
  // The engine hyphenates English by default and breaks "quo-tation" across
  // lines in a narrow table cell. Whole words only.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
```
`web/src/pages/Sales/Quotations/pdf/fontSources.js`:
```js
// The eight font files as URLs. `?url` makes Vite hand back the asset's URL
// instead of trying to inline ~3 MB of TTF into the bundle; the PDF engine then
// fetches a face only when a quotation actually uses it.
//
// Kept apart from fonts.js so that file stays importable from plain Node (the
// live pass renders PDFs from a script, where `?url` means nothing).
import interRegular from "../../../../assets/fonts/Inter-Regular.ttf?url";
import interItalic from "../../../../assets/fonts/Inter-Italic.ttf?url";
import interBold from "../../../../assets/fonts/Inter-Bold.ttf?url";
import interBoldItalic from "../../../../assets/fonts/Inter-BoldItalic.ttf?url";
import serifRegular from "../../../../assets/fonts/NotoSerif-Regular.ttf?url";
import serifItalic from "../../../../assets/fonts/NotoSerif-Italic.ttf?url";
import serifBold from "../../../../assets/fonts/NotoSerif-Bold.ttf?url";
import serifBoldItalic from "../../../../assets/fonts/NotoSerif-BoldItalic.ttf?url";

export const FONT_SOURCES = {
  Inter: { regular: interRegular, italic: interItalic, bold: interBold, boldItalic: interBoldItalic },
  "Noto Serif": { regular: serifRegular, italic: serifItalic, bold: serifBold, boldItalic: serifBoldItalic },
};
```
`web/src/pages/Sales/Quotations/pdf/RichHtml.jsx`:
```jsx
// Editor HTML → PDF. The HTML is already reduced to tags the converter can draw
// (richTextHtml.toPdfHtml, called in buildQuoteDoc), so nothing is dropped here.
import HtmlPkg from "react-pdf-html";
import { INK, MUTED, RULE, SOFT } from "./parts";

const Html = HtmlPkg.default ?? HtmlPkg.Html ?? HtmlPkg;

const sheet = (accent) => ({
  p: { margin: 0, marginBottom: 4, fontSize: 9.5, lineHeight: 1.45 },
  h1: { fontSize: 15, fontWeight: 700, margin: 0, marginTop: 6, marginBottom: 5, color: INK },
  h2: { fontSize: 12.5, fontWeight: 700, margin: 0, marginTop: 6, marginBottom: 4, color: INK },
  h3: { fontSize: 10.5, fontWeight: 700, margin: 0, marginTop: 5, marginBottom: 3, color: INK },
  // Lists keep the converter's own bullet/number layout — resetting it (tried)
  // collapses the marker onto the first letter of the text.
  ul: { marginTop: 0, marginBottom: 4 },
  ol: { marginTop: 0, marginBottom: 4 },
  a: { color: accent },
  hr: { marginVertical: 6, borderBottom: `1px solid ${RULE}` },
  blockquote: { margin: 0, marginVertical: 4, paddingLeft: 8, borderLeft: `2px solid ${RULE}`, color: MUTED },
  table: { marginVertical: 5 },
  th: { padding: 4, backgroundColor: SOFT, fontWeight: 700, borderBottom: `1px solid ${RULE}` },
  td: { padding: 4, borderBottom: `1px solid ${RULE}` },
});

export default function RichHtml({ html, accent }) {
  if (!html) return null;
  return <Html stylesheet={sheet(accent)} style={{ fontSize: 9.5, color: INK }}>{html}</Html>;
}
```
`web/src/pages/Sales/Quotations/pdf/parts.jsx`:
```jsx
// The pieces every template shares. A template decides the header and the mood;
// what a line table, a totals block or a terms section IS does not change
// between them — and a fix to page-breaking must not need making three times.
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import RichHtml from "./RichHtml";

export const INK = "#0f172a";
export const MUTED = "#64748b";
export const RULE = "#e2e8f0";
export const SOFT = "#f8fafc";

const s = StyleSheet.create({
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  strong: { fontSize: 10.5, fontWeight: 700, color: INK },
  small: { fontSize: 8.5, color: MUTED, lineHeight: 1.4 },
  row: { flexDirection: "row" },
  cell: { fontSize: 9, paddingVertical: 5, paddingHorizontal: 4, color: INK },
  num: { textAlign: "right" },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 4 },
});

/** "To" on the left, the quotation's own facts on the right. */
export function PartyBlock({ doc, boxed = false }) {
  const box = boxed ? { backgroundColor: SOFT, borderRadius: 4, padding: 10 } : {};
  const facts = [
    ["Quotation no.", doc.quoteNo], ["Date", doc.quoteDate],
    ...(doc.validTill ? [["Valid till", doc.validTill]] : []),
    ...(doc.to.placeOfSupply ? [["Place of supply", doc.to.placeOfSupply]] : []),
  ];
  return (
    <View style={[s.row, { gap: 14, marginBottom: 14 }]}>
      <View style={[{ flex: 1.25 }, box]}>
        <Text style={s.label}>Quotation for</Text>
        <Text style={s.strong}>{doc.to.company || doc.to.name}</Text>
        {doc.to.company ? <Text style={[s.small, { color: INK }]}>{doc.to.name}</Text> : null}
        {doc.to.addressLines.map((l) => <Text key={l} style={s.small}>{l}</Text>)}
        {doc.to.contactLine ? <Text style={s.small}>{doc.to.contactLine}</Text> : null}
        {doc.to.gstin ? <Text style={s.small}>GSTIN {doc.to.gstin}</Text> : null}
      </View>
      <View style={[{ flex: 1 }, box]}>
        {facts.map(([k, v]) => (
          <View key={k} style={[s.row, { justifyContent: "space-between", marginBottom: 3 }]}>
            <Text style={s.small}>{k}</Text>
            <Text style={{ fontSize: 9, fontWeight: 700, color: INK }}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Subject({ doc }) {
  if (!doc.subject) return null;
  return <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 8 }}>Subject: {doc.subject}</Text>;
}

/**
 * variant: "filled" (accent header, zebra rows) | "ruled" (grey header, row rules) | "bare" (hairlines only)
 * Each row is wrap={false}: a line item is never sliced across two pages.
 */
export function LineTable({ doc, variant = "ruled" }) {
  const cols = [
    { key: "sr", head: "#", w: 20 },
    { key: "description", head: "Description", flex: 1 },
    ...(doc.showHsn ? [{ key: "hsn", head: "HSN/SAC", w: 46 }] : []),
    { key: "qtyText", head: "Qty", w: 52, num: true },
    { key: "rateText", head: "Rate", w: 68, num: true },
    ...(doc.showDiscount ? [{ key: "discountText", head: "Disc.", w: 54, num: true }] : []),
    ...(doc.taxed ? [{ key: "taxPctText", head: "GST", w: 34, num: true }] : []),
    { key: "amountText", head: "Amount", w: 78, num: true },
  ];
  const size = (c) => (c.flex ? { flex: c.flex } : { width: c.w });
  const headStyle = variant === "filled"
    ? { backgroundColor: doc.accent, borderRadius: 3 }
    : variant === "ruled" ? { backgroundColor: SOFT, borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}` }
      : { borderBottom: `1px solid ${INK}` };
  const headText = { fontSize: 8, fontWeight: 700, color: variant === "filled" ? "#ffffff" : variant === "bare" ? INK : MUTED };

  return (
    <View style={{ marginBottom: 10 }}>
      <View style={[s.row, headStyle]} wrap={false}>
        {cols.map((c) => <Text key={c.key} style={[s.cell, headText, size(c), c.num && s.num]}>{c.head}</Text>)}
      </View>
      {doc.rows.map((r, i) => (
        <View key={r.sr} wrap={false}
          style={[s.row, variant === "filled" ? { backgroundColor: i % 2 ? SOFT : "#ffffff" } : { borderBottom: `1px solid ${RULE}` }]}>
          {cols.map((c) => <Text key={c.key} style={[s.cell, size(c), c.num && s.num]}>{r[c.key]}</Text>)}
        </View>
      ))}
    </View>
  );
}

/** Tax by rate on the left (only when there is tax to break down), the totals on the right. */
export function TotalsBlock({ doc, emphasis = "bar" }) {
  const grand = emphasis === "bar"
    ? { box: { backgroundColor: doc.accent, borderRadius: 3, paddingVertical: 6, paddingHorizontal: 8, marginTop: 4 }, text: "#ffffff" }
    : { box: { borderTop: `1px solid ${INK}`, paddingTop: 6, marginTop: 4 }, text: INK };
  return (
    <View wrap={false} style={{ marginBottom: 12 }}>
      <View style={[s.row, { gap: 16 }]}>
        <View style={{ flex: 1 }}>
          {doc.gstSummary.length > 0 && (
            <View>
              <Text style={s.label}>Tax summary</Text>
              <View style={[s.row, { borderBottom: `1px solid ${RULE}` }]}>
                {["GST", "Taxable", ...(doc.inter ? ["IGST"] : ["CGST", "SGST"])].map((h, i) => (
                  <Text key={h} style={[{ fontSize: 7.5, color: MUTED, paddingVertical: 3, flex: 1 }, i > 0 && s.num]}>{h}</Text>
                ))}
              </View>
              {doc.gstSummary.map((g) => (
                <View key={g.rateText} style={s.row}>
                  {[g.rateText, g.taxableText, ...(doc.inter ? [g.igstText] : [g.cgstText, g.sgstText])].map((v, i) => (
                    <Text key={i} style={[{ fontSize: 8, paddingVertical: 3, flex: 1, color: INK }, i > 0 && s.num]}>{v}</Text>
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={{ width: 210 }}>
          {doc.totals.map((t) => (
            <View key={t.label} style={[s.row, { justifyContent: "space-between", paddingVertical: 2.5 }]}>
              <Text style={{ fontSize: 9, color: MUTED }}>{t.label}</Text>
              <Text style={{ fontSize: 9, color: INK }}>{t.value}</Text>
            </View>
          ))}
          <View style={[s.row, { justifyContent: "space-between", alignItems: "center" }, grand.box]}>
            <Text style={{ fontSize: 10, fontWeight: 700, color: grand.text }}>Grand total</Text>
            <Text style={{ fontSize: 12, fontWeight: 700, color: grand.text }}>{doc.grandTotalText}</Text>
          </View>
        </View>
      </View>
      <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 6 }}>
        Amount in words: <Text style={{ color: INK, fontWeight: 700 }}>{doc.amountInWords}</Text>
      </Text>
    </View>
  );
}

// ponytail: a short section moves to the next page whole rather than leaving a
// table's header row stranded at the foot of one page and its body on the next.
// Length of the HTML is a crude proxy for height; a long section must be
// allowed to break or it would never fit any page.
const KEEP_TOGETHER_BELOW = 1200;

export function RichSection({ title, html, accent }) {
  if (!html) return null;
  return (
    <View wrap={html.length > KEEP_TOGETHER_BELOW} style={{ marginBottom: 10 }}>
      {title ? <Text style={[s.sectionTitle, { color: accent }]}>{title}</Text> : null}
      <RichHtml html={html} accent={accent} />
    </View>
  );
}

/** The user's own appended sections: formatted text, or a grid of captioned pictures. */
export function ExtraSections({ doc }) {
  return doc.sections.map((sec, i) =>
    sec.type === "images" ? (
      <View key={i} style={{ marginBottom: 10 }}>
        {sec.title ? <Text style={[s.sectionTitle, { color: doc.accent }]}>{sec.title}</Text> : null}
        <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
          {sec.items.map((im, j) => (
            <View key={j} wrap={false} style={{ width: 166 }}>
              <Image src={im.src} style={{ width: 166, height: 112, objectFit: "cover", borderRadius: 3 }} />
              {im.caption ? <Text style={[s.small, { marginTop: 3 }]}>{im.caption}</Text> : null}
            </View>
          ))}
        </View>
      </View>
    ) : <RichSection key={i} title={sec.title} html={sec.html} accent={doc.accent} />,
  );
}

export function BankAndSign({ doc }) {
  if (!doc.company.bank && !doc.company.signatory) return null;
  return (
    <View wrap={false} style={[s.row, { justifyContent: "space-between", marginTop: 8, gap: 20 }]}>
      <View style={{ flex: 1 }}>
        {doc.company.bank ? (<><Text style={s.label}>Bank details</Text><Text style={s.small}>{doc.company.bank}</Text></>) : null}
      </View>
      <View style={{ width: 190, alignItems: "flex-end" }}>
        <Text style={s.small}>For {doc.company.name}</Text>
        <View style={{ height: 34 }} />
        <Text style={{ fontSize: 9, fontWeight: 700, borderTop: `1px solid ${RULE}`, paddingTop: 3, width: 150, textAlign: "right" }}>
          {doc.company.signatory || "Authorised signatory"}
        </Text>
      </View>
    </View>
  );
}

/** Fixed on every page: the quote number, and page x of y. */
export function PageFooter({ doc, inset = 36 }) {
  return (
    <View fixed style={[s.row, { position: "absolute", bottom: 18, left: inset, right: inset, justifyContent: "space-between", borderTop: `1px solid ${RULE}`, paddingTop: 5 }]}>
      <Text style={{ fontSize: 7.5, color: MUTED }}>{doc.company.name}{doc.quoteNo ? `  ·  ${doc.quoteNo}` : ""}</Text>
      <Text style={{ fontSize: 7.5, color: MUTED }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

/** A draft must never be mistaken for an offer. */
export function DraftWatermark({ doc }) {
  if (!doc.isDraft) return null;
  return (
    <View fixed style={{ position: "absolute", top: 330, left: 0, right: 0, alignItems: "center" }}>
      <Text style={{ fontSize: 110, fontWeight: 700, color: "#f1f5f9", transform: "rotate(-28deg)", letterSpacing: 8 }}>DRAFT</Text>
    </View>
  );
}

export const pageStyle = { fontFamily: "Inter", fontSize: 9.5, color: INK, paddingTop: 36, paddingBottom: 46, paddingHorizontal: 36 };
```
> `parts.jsx` imports `RichHtml`, and `RichHtml` imports the colour constants back from `parts.jsx`. That cycle is safe — both sides only read the other's exports *inside function bodies*, after both modules have finished evaluating — and it rendered correctly. If a bundler ever complains, move the four colour constants into `pdf/colors.js` and import them from both; do not inline copies.

Run Step 5's test green, with coverage:

```bash
cd web && pnpm exec vitest run src/pages/Sales/Quotations/pdf/fonts.test.js --coverage --coverage.include=src/pages/Sales/Quotations/pdf/fonts.js --coverage.include=src/pages/Sales/Quotations/pdf/fontSources.js
```
Expected: 5 PASS; both files ≥ 80 % lines and branches.

- [ ] **Step 7: Lint the new files**

```bash
cd web && pnpm exec eslint src/api/quotationQueries.js src/test/reactPdfMock.jsx src/pages/Sales/Quotations
```
Expected: 0 errors.

- [ ] **Step 8: Stop and report.** Do not stage or commit.

---

### Task 14: Three templates + registry + `usePdfPreview`

**Files (under `web/src/pages/Sales/Quotations/`):**
- Create: `templates/classic.jsx`, `templates/modern.jsx`, `templates/minimal.jsx`, `templates/index.js`, `templates/templates.test.jsx`
- Create: `usePdfPreview.js`, `usePdfPreview.test.jsx`

**Interfaces:**
- Consumes: Task 13's parts and `buildQuoteDoc`'s view-model.
- Produces: `TEMPLATES` (`[{ code, name, blurb, Component }]`), `templateByCode(code)` (unknown → the first); each `Component` takes one prop, `doc`. `usePdfPreview(Component, doc, delay = 500)` → `{ url, blob, loading, error }`. **`doc` must be memoised by the caller.**

**All three templates were rendered to real PDFs and looked at before this plan was finalised** — intra-state, inter-state with a buyer GSTIN, an unregistered seller, a draft, and a 34-line quotation across three pages — and the 35 content tests below pass against them. What each is for:
- **Classic** — a formal letterhead: logo left, company right, one accent rule. The safe choice for a customer's accounts department.
- **Modern** — a full-bleed accent band; the logo sits on a white chip so *any* logo stays legible on *any* accent colour.
- **Minimal** — no fills, hairlines and air. The accent appears exactly twice.

They differ in header, colour use and mood **only**. What a line table or a totals block *is* lives in `pdf/parts.jsx`, so a page-break fix is made once.

- [ ] **Step 1: The content tests**

`web/src/pages/Sales/Quotations/templates/templates.test.jsx`:
```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@react-pdf/renderer", () => import("../../../../test/reactPdfMock"));
vi.mock("react-pdf-html", async () => ({ default: (await import("../../../../test/reactPdfMock")).Html }));

import { TEMPLATES, templateByCode } from "./index";
import { buildQuoteDoc } from "../buildQuoteDoc";
import { computeQuote } from "../quoteMath";

afterEach(cleanup);

const items = [
  { description: "5 kW Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 },
  { description: "Installation", hsn: "9954", qty: 1, unit: "Job", rate: 20000, discountType: "pct", discountValue: 0, taxPct: 18 },
];
const company = { name: "Solar Care Pvt Ltd", address: "402 Titanium", city: "Ahmedabad", stateCode: "24", gstin: "24ABCDE1234F1Z5", bank: "HDFC 123", signatory: "Amit Shah", logoAttachmentId: 9 };
const header = { Status: "final", QuoteNo: "QT-2627-0042", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "Rooftop solar", ToName: "Ramesh Patel", ToStateCode: "24" };
const content = { intro: "<p>Dear Ramesh ji</p>", terms: "<p>50% advance</p>", sections: [{ type: "images", title: "Sites", items: [{ attachmentId: 21, caption: "Bopal" }] }] };

const docFor = (over = {}) => {
  const h = { ...header, ...(over.header ?? {}) };
  const c = { ...company, ...(over.company ?? {}) };
  return buildQuoteDoc({ header: h, company: c, content, items, images: { 9: "data:logo", 21: "data:site" }, samples: { logo: "sample:logo", header: "sample:header" },
    amounts: computeQuote(items, { sellerGstin: c.gstin, sellerState: c.stateCode, buyerState: h.ToStateCode }) });
};
const draw = (Component, over) => render(<Component doc={docFor(over)} />);
const texts = () => screen.getAllByText((_, el) => el.dataset.pdf === "text").map((el) => el.textContent);

describe.each(TEMPLATES.map((t) => [t.code, t.Component]))("template %s", (_code, Component) => {
  it("prints the parties, every line, the grand total and its words", () => {
    draw(Component);
    const all = texts().join(" | ");
    for (const s of ["Solar Care Pvt Ltd", "Ramesh Patel", "QT-2627-0042", "18-09-2026", "5 kW Rooftop", "Installation", "₹3,26,000.00", "Rupees Three Lakh Twenty Six Thousand Only", "Amit Shah", "HDFC 123"]) {
      expect(all).toContain(s);
    }
  });

  it("intra-state: CGST and SGST, no IGST", () => {
    draw(Component);
    const all = texts();
    expect(all).toContain("CGST"); expect(all).toContain("SGST"); expect(all).not.toContain("IGST");
  });

  it("inter-state: IGST, no CGST or SGST", () => {
    draw(Component, { header: { ToStateCode: "27" } });
    const all = texts();
    expect(all).toContain("IGST"); expect(all).not.toContain("CGST"); expect(all).not.toContain("SGST");
    expect(all.join(" ")).toContain("Maharashtra (27)");
  });

  // An unregistered seller charges no GST. A "GST" column of blanks, a tax
  // summary of zeros, or a "GSTIN" label with nothing after it would all be wrong.
  it("unregistered seller: no GST column, no tax summary, no GSTIN line", () => {
    draw(Component, { company: { gstin: "" } });
    const all = texts();
    expect(all).not.toContain("GST"); expect(all).not.toContain("Tax summary"); expect(all).not.toContain("CGST");
    expect(all.some((t) => t.startsWith("GSTIN"))).toBe(false);
  });

  it("stamps DRAFT on a draft and only on a draft", () => {
    draw(Component, { header: { Status: "draft", QuoteNo: null } });
    expect(texts().filter((t) => t === "DRAFT").length).toBeGreaterThanOrEqual(1);
  });
  it("does not stamp a final quotation", () => {
    draw(Component);
    expect(texts()).not.toContain("DRAFT");
  });

  it("draws the company's logo, the sample banner until one is chosen, and the section pictures", () => {
    draw(Component);
    const srcs = [...document.querySelectorAll('img[data-pdf="image"]')].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(expect.arrayContaining(["data:logo", "sample:header", "data:site"]));
  });

  it("draws no image at all once both are switched off", () => {
    draw(Component, { company: { showLogo: false, showHeader: false } });
    const srcs = [...document.querySelectorAll('img[data-pdf="image"]')].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["data:site"]);
  });

  it("hands the rich text to the HTML renderer, already reduced to drawable tags", () => {
    draw(Component);
    const html = [...document.querySelectorAll('[data-pdf="html"]')].map((n) => n.textContent);
    expect(html).toEqual(expect.arrayContaining(["<p>Dear Ramesh ji</p>", "<p>50% advance</p>"]));
  });

  // A line item sliced across two pages is the classic PDF-table failure.
  it("never lets a line row break across pages, and repeats the footer on every page", () => {
    draw(Component);
    const row = screen.getByText("5 kW Rooftop").closest('[data-pdf="view"]');
    expect(row.dataset.wrap).toBe("false");
    const footer = screen.getByText("Page 1 of 1").closest('[data-pdf="view"]');
    expect(footer.dataset.fixed).toBe("");
  });

  it("titles the document for the PDF viewer's tab", () => {
    draw(Component);
    expect(document.querySelector('[data-pdf="document"]').dataset.title).toBe("Quotation QT-2627-0042");
  });
});

describe("template registry", () => {
  it("ships three, by stable code", () => expect(TEMPLATES.map((t) => t.code)).toEqual(["classic", "modern", "minimal"]));
  it("falls back to the first for a code it does not know", () => {
    expect(templateByCode("modern").name).toBe("Modern");
    expect(templateByCode("gone").code).toBe("classic");
    expect(templateByCode(undefined).code).toBe("classic");
  });
});
```
Run: `cd web && pnpm exec vitest run src/pages/Sales/Quotations/templates/templates.test.jsx` — expected FAIL (cannot resolve `./index`).

- [ ] **Step 2: The templates and the registry**

`web/src/pages/Sales/Quotations/templates/classic.jsx`:
```jsx
// Classic — a formal letterhead: logo left, company right, one accent rule.
// The safe choice for a customer's accounts department.
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { pageStyle, INK, MUTED, PartyBlock, Subject, LineTable, TotalsBlock, RichSection, ExtraSections, BankAndSign, PageFooter, DraftWatermark } from "../pdf/parts";

export default function Classic({ doc }) {
  return (
    <Document title={`${doc.title} ${doc.quoteNo}`} author={doc.company.name}>
      <Page size="A4" style={pageStyle}>
        <DraftWatermark doc={doc} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          {doc.logoSrc ? <Image src={doc.logoSrc} style={{ width: 64, height: 64, objectFit: "contain" }} /> : null}
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={{ fontSize: 16, fontWeight: 700, color: INK }}>{doc.company.name}</Text>
            {doc.company.addressLines.map((l) => <Text key={l} style={{ fontSize: 8.5, color: MUTED }}>{l}</Text>)}
            {doc.company.contactLine ? <Text style={{ fontSize: 8.5, color: MUTED }}>{doc.company.contactLine}</Text> : null}
            {doc.company.gstin ? <Text style={{ fontSize: 8.5, color: INK, fontWeight: 700 }}>GSTIN {doc.company.gstin}</Text> : null}
          </View>
        </View>
        <View style={{ height: 2, backgroundColor: doc.accent, marginTop: 10 }} />
        {doc.headerSrc ? <Image src={doc.headerSrc} style={{ height: 80, objectFit: "cover", marginTop: 10, borderRadius: 3 }} /> : null}
        <Text style={{ fontSize: 13, fontWeight: 700, textAlign: "center", letterSpacing: 3, color: doc.accent, marginVertical: 12 }}>QUOTATION</Text>

        <PartyBlock doc={doc} />
        <Subject doc={doc} />
        <RichSection html={doc.intro} accent={doc.accent} />
        <LineTable doc={doc} variant="ruled" />
        <TotalsBlock doc={doc} emphasis="bar" />
        <RichSection title="Notes" html={doc.notes} accent={doc.accent} />
        <ExtraSections doc={doc} />
        <RichSection title="Terms & conditions" html={doc.terms} accent={doc.accent} />
        <BankAndSign doc={doc} />
        <PageFooter doc={doc} />
      </Page>
    </Document>
  );
}
```
`web/src/pages/Sales/Quotations/templates/modern.jsx`:
```jsx
// Modern — a full-bleed accent band carries the name; the logo sits on a white
// chip so ANY logo (dark, light, transparent) stays legible on ANY accent.
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { pageStyle, PartyBlock, Subject, LineTable, TotalsBlock, RichSection, ExtraSections, BankAndSign, PageFooter, DraftWatermark } from "../pdf/parts";

export default function Modern({ doc }) {
  return (
    <Document title={`${doc.title} ${doc.quoteNo}`} author={doc.company.name}>
      <Page size="A4" style={pageStyle}>
        <DraftWatermark doc={doc} />
        {/* Negative margins, not a zero page padding: the band bleeds to the edge on
            page 1 while pages 2+ keep their top margin. */}
        <View style={{ backgroundColor: doc.accent, marginTop: -36, marginHorizontal: -36, paddingHorizontal: 36, paddingVertical: 20, flexDirection: "row", alignItems: "center", gap: 14 }}>
          {doc.logoSrc ? (
            <View style={{ backgroundColor: "#ffffff", borderRadius: 6, padding: 6 }}>
              <Image src={doc.logoSrc} style={{ width: 54, height: 54, objectFit: "contain" }} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: 700, color: "#ffffff" }}>{doc.company.name}</Text>
            {doc.company.addressLines.map((l) => <Text key={l} style={{ fontSize: 8.5, color: "#ffffff", opacity: 0.9 }}>{l}</Text>)}
            {doc.company.contactLine ? <Text style={{ fontSize: 8.5, color: "#ffffff", opacity: 0.9 }}>{doc.company.contactLine}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 20, fontWeight: 700, color: "#ffffff", letterSpacing: 1 }}>QUOTATION</Text>
            {doc.company.gstin ? <Text style={{ fontSize: 8.5, color: "#ffffff", opacity: 0.9 }}>GSTIN {doc.company.gstin}</Text> : null}
          </View>
        </View>
        {doc.headerSrc ? <Image src={doc.headerSrc} style={{ marginHorizontal: -36, height: 92, objectFit: "cover" }} /> : null}
        <View style={{ height: 16 }} />

        <PartyBlock doc={doc} boxed />
        <Subject doc={doc} />
        <RichSection html={doc.intro} accent={doc.accent} />
        <LineTable doc={doc} variant="filled" />
        <TotalsBlock doc={doc} emphasis="bar" />
        <RichSection title="Notes" html={doc.notes} accent={doc.accent} />
        <ExtraSections doc={doc} />
        <RichSection title="Terms & conditions" html={doc.terms} accent={doc.accent} />
        <BankAndSign doc={doc} />
        <PageFooter doc={doc} />
      </Page>
    </Document>
  );
}
```
`web/src/pages/Sales/Quotations/templates/minimal.jsx`:
```jsx
// Minimal — no fills, hairlines and air. The accent appears exactly twice: the
// word "Quotation" and the grand total.
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { pageStyle, INK, MUTED, RULE, PartyBlock, Subject, LineTable, TotalsBlock, RichSection, ExtraSections, BankAndSign, PageFooter, DraftWatermark } from "../pdf/parts";

export default function Minimal({ doc }) {
  return (
    <Document title={`${doc.title} ${doc.quoteNo}`} author={doc.company.name}>
      <Page size="A4" style={[pageStyle, { paddingTop: 44, paddingHorizontal: 44 }]}>
        <DraftWatermark doc={doc} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <Text style={{ fontSize: 26, fontWeight: 700, color: doc.accent, letterSpacing: -0.5 }}>Quotation</Text>
            <Text style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{doc.quoteNo}{doc.quoteDate ? `  ·  ${doc.quoteDate}` : ""}</Text>
          </View>
          <View style={{ alignItems: "flex-end", maxWidth: 260 }}>
            {doc.logoSrc ? <Image src={doc.logoSrc} style={{ width: 44, height: 44, objectFit: "contain", marginBottom: 5 }} /> : null}
            <Text style={{ fontSize: 11, fontWeight: 700, color: INK }}>{doc.company.name}</Text>
            {doc.company.addressLines.map((l) => <Text key={l} style={{ fontSize: 8, color: MUTED, textAlign: "right" }}>{l}</Text>)}
            {doc.company.contactLine ? <Text style={{ fontSize: 8, color: MUTED }}>{doc.company.contactLine}</Text> : null}
            {doc.company.gstin ? <Text style={{ fontSize: 8, color: MUTED }}>GSTIN {doc.company.gstin}</Text> : null}
          </View>
        </View>
        {doc.headerSrc ? <Image src={doc.headerSrc} style={{ height: 70, objectFit: "cover", marginTop: 14 }} /> : null}
        <View style={{ height: 1, backgroundColor: RULE, marginVertical: 16 }} />

        <PartyBlock doc={doc} />
        <Subject doc={doc} />
        <RichSection html={doc.intro} accent={INK} />
        <LineTable doc={doc} variant="bare" />
        <TotalsBlock doc={doc} emphasis="rule" />
        <RichSection title="Notes" html={doc.notes} accent={INK} />
        <ExtraSections doc={doc} />
        <RichSection title="Terms & conditions" html={doc.terms} accent={INK} />
        <BankAndSign doc={doc} />
        <PageFooter doc={doc} inset={44} />
      </Page>
    </Document>
  );
}
```
`web/src/pages/Sales/Quotations/templates/index.js`:
```js
// The three shipped templates. Adding one is a file plus a line here.
//
// A TEMPLATE IS NEVER REDESIGNED IN PLACE. A finalised quotation re-renders from
// its TemplateCode for as long as it exists, so changing `modern` changes every
// quotation ever issued on it — including ones a customer is holding. A breaking
// redesign ships under a new code; the old one stays, unlisted if need be.
import Classic from "./classic";
import Modern from "./modern";
import Minimal from "./minimal";

export const TEMPLATES = [
  { code: "classic", name: "Classic", blurb: "Formal letterhead. The safe choice for an accounts department.", Component: Classic },
  { code: "modern", name: "Modern", blurb: "A colour band, a banner image, bold totals.", Component: Modern },
  { code: "minimal", name: "Minimal", blurb: "Hairlines and air. The colour appears twice.", Component: Minimal },
];

export const templateByCode = (code) => TEMPLATES.find((t) => t.code === code) ?? TEMPLATES[0];
```
- [ ] **Step 3: `usePdfPreview` — test first**

`web/src/pages/Sales/Quotations/usePdfPreview.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@react-pdf/renderer", () => import("../../../test/reactPdfMock"));

import { usePDF } from "@react-pdf/renderer";
import { usePdfPreview } from "./usePdfPreview";

const A = () => null;
const B = () => null;

beforeEach(() => { vi.useFakeTimers(); usePDF.mockClear(); usePDF.update.mockClear(); });
afterEach(() => vi.useRealTimers());

describe("usePdfPreview", () => {
  it("renders the first document straight away and hands back the blob URL", () => {
    const doc = { quoteNo: "DRAFT" };
    const { result } = renderHook(() => usePdfPreview(A, doc));
    expect(usePDF.mock.calls[0][0].document.type).toBe(A);
    expect(usePDF.mock.calls[0][0].document.props.doc).toBe(doc);
    expect(result.current.url).toBe("blob:preview");
    vi.advanceTimersByTime(2000);
    expect(usePDF.update).not.toHaveBeenCalled(); // the initial render is not a "change"
  });

  it("debounces changes: three quick edits, one render, with the last document", () => {
    const { rerender } = renderHook(({ doc }) => usePdfPreview(A, doc), { initialProps: { doc: { n: 0 } } });
    rerender({ doc: { n: 1 } }); vi.advanceTimersByTime(200);
    rerender({ doc: { n: 2 } }); vi.advanceTimersByTime(200);
    const last = { n: 3 };
    rerender({ doc: last });
    expect(usePDF.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(usePDF.update).toHaveBeenCalledTimes(1);
    expect(usePDF.update.mock.calls[0][0].props.doc).toBe(last);
  });

  // The contract in the hook's comment: a memoised doc. Same identity → no work.
  it("does nothing when re-rendered with the same document", () => {
    const doc = { n: 1 };
    const { rerender } = renderHook(() => usePdfPreview(A, doc));
    rerender(); rerender();
    vi.advanceTimersByTime(2000);
    expect(usePDF.update).not.toHaveBeenCalled();
  });

  it("re-renders when the template changes", () => {
    const doc = { n: 1 };
    const { rerender } = renderHook(({ C }) => usePdfPreview(C, doc), { initialProps: { C: A } });
    rerender({ C: B });
    vi.advanceTimersByTime(500);
    expect(usePDF.update.mock.calls[0][0].type).toBe(B);
  });

  it("drops a pending render when unmounted", () => {
    const { rerender, unmount } = renderHook(({ doc }) => usePdfPreview(A, doc), { initialProps: { doc: { n: 0 } } });
    rerender({ doc: { n: 1 } });
    unmount();
    vi.advanceTimersByTime(2000);
    expect(usePDF.update).not.toHaveBeenCalled();
  });
});
```
`web/src/pages/Sales/Quotations/usePdfPreview.js`:
```js
import { createElement, useEffect, useRef } from "react";
import { usePDF } from "@react-pdf/renderer";

/**
 * The live preview: the template rendered to a real PDF blob, shown in an
 * <iframe>. There is no second, HTML "preview renderer" to drift away from the
 * file — what they see IS the file they download.
 *
 * Rendering is debounced: laying out a PDF on every keystroke is wasteful and
 * makes typing feel heavy.
 *
 * `doc` MUST be memoised by the caller (useMemo). The effect depends on its
 * identity; a fresh object every render would re-arm the timer forever, and —
 * because a finished render updates `instance`, which re-renders the caller —
 * would loop.
 *
 * @returns {{ url: string|null, blob: Blob|null, loading: boolean, error: any }}
 */
export function usePdfPreview(Component, doc, delay = 500) {
  const [instance, update] = usePDF({ document: createElement(Component, { doc }) });
  const first = useRef(true);

  useEffect(() => {
    // usePDF already rendered the initial document; only CHANGES are debounced.
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => update(createElement(Component, { doc })), delay);
    return () => clearTimeout(t);
  }, [Component, doc, delay, update]);

  return instance;
}
```
- [ ] **Step 4: Green, with coverage — one file per run**

```bash
cd web && pnpm exec vitest run src/pages/Sales/Quotations/templates/templates.test.jsx --coverage --coverage.include='src/pages/Sales/Quotations/templates/**' --coverage.include='src/pages/Sales/Quotations/pdf/parts.jsx' --coverage.include='src/pages/Sales/Quotations/pdf/RichHtml.jsx'
cd web && pnpm exec vitest run src/pages/Sales/Quotations/usePdfPreview.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/usePdfPreview.js
```
Expected: 35 + 5 tests PASS; templates, `parts.jsx`, `RichHtml.jsx` and the hook each ≥ 80 %.

- [ ] **Step 5: Stop and report.** Do not stage or commit.

---

### Task 15A: Builder building blocks — `quoteForm` · `useQuoteImages` · `ImageSlot` · `LinesEditor` · `SectionsEditor`

**Files (under `web/src/pages/Sales/Quotations/`):**
- Create: `quoteForm.js` + `quoteForm.test.js`
- Create: `useQuoteImages.js` + `useQuoteImages.test.jsx`
- Create: `builder/ImageSlot.jsx` + test, `builder/LinesEditor.jsx` + test, `builder/SectionsEditor.jsx` + test

**Interfaces:**
- Consumes: Task 11 (`computeQuote`, `gst`), Task 12 (`RichTextEditor`), Task 10 (sample art), `api/attachmentQueries` (`fetchAttachmentBlob`, `uploadAttachment`).
- Produces:
  - `quoteForm`: `toForm`, `toBody`, `amountsOf`, `finaliseBlockers`, `draftBodyFromLead`, `companyFromProfile`, `profileFromForm`, `emptyLine`, `lineFromProduct`, `addDays`, `todayIso`, `ACCENTS`, `DEFAULT_ACCENT`.
  - `useQuoteImages(ids) → { images: { [id]: dataUrl }, prime(id, dataUrl) }`; `uploadImage({ entity, entityId, file }) → { id, dataUrl }` (throws an `Error` whose message is user-ready); `imageIdsOf(form)`.
  - `<ImageSlot label src isSample hidden disabled busy wide onUpload(file) onRemove() onRestore() data-testid />` — `isSample`, `hidden`, `disabled`, `busy` and `wide` are all booleans defaulting to `false`; Task 15B passes `busy` while an upload is in flight and `wide` for the banner slot.
  - `<LinesEditor lines amounts products disabled onChange(lines) />`
  - `<SectionsEditor sections images disabled onChange(sections) onUploadPicture(file) → Promise<{ id }> />`

The page (Task 15B) is left with wiring. Everything that can be subtly wrong — dates in IST, what goes in the save body, when Finalise is allowed — is a pure function here with a test.

- [ ] **Step 1: `quoteForm` — verified before this plan was finalised (25 tests green). Transcribe exactly.**

`web/src/pages/Sales/Quotations/quoteForm.test.js`:
```js
import { describe, it, expect } from "vitest";
import {
  addDays, todayIso, emptyLine, lineFromProduct, companyFromProfile, profileFromForm, draftBodyFromLead,
  toForm, toBody, amountsOf, finaliseBlockers, DEFAULT_ACCENT,
} from "./quoteForm";

const LEAD = { Id: 9, Name: "Ramesh Patel", Company: "", MobileNo: "9825012345", Email: "r@p.in", Address: "14 Shanti", City: "Ahmedabad", State: "gujarat", Pincode: "380015", ProductId: 7 };
const PROFILE = { Id: 3, CompanyName: "Solar Care", Address: "402 Titanium", City: "Ahmedabad", StateCode: "24", Pincode: "380054", GSTIN: "24ABCDE1234F1Z5", Phone: "079", Email: "s@s.in", Website: "s.in", BankDetails: "HDFC", SignatoryName: "Amit", LogoAttachmentId: 12, HeaderAttachmentId: null, AccentColor: "#0f766e", DefaultTemplate: "modern", DefaultIntro: "<p>Dear customer</p>", DefaultTerms: "<p>50%</p>", IsSet: true };
const PRODUCT = { Id: 7, Name: "5 kW Rooftop", Description: "Mono PERC", HSNCode: "8541", Unit: "Set", UnitPrice: 280000, TaxPct: 12 };

describe("dates", () => {
  // toISOString() is UTC: at 02:00 IST on 1 April it still says 31 March.
  it("reads and writes local calendar days", () => {
    expect(todayIso(new Date(2026, 3, 1, 2, 0))).toBe("2026-04-01");
    expect(addDays("2026-09-18", 15)).toBe("2026-10-03");
    expect(addDays("2026-12-25", 15)).toBe("2027-01-09");
    expect(addDays("junk", 1)).toBe("");
  });
});

describe("lines", () => {
  it("starts a blank line at quantity 1, discount as a percentage, with its own key", () => {
    const a = emptyLine(); const b = emptyLine();
    expect(a).toMatchObject({ productId: null, description: "", qty: 1, discountType: "pct" });
    expect(a.key).not.toBe(b.key);
  });

  it("seeds a line from a product, and copes with a bare one", () => {
    expect(lineFromProduct(PRODUCT)).toMatchObject({ productId: 7, description: "5 kW Rooftop — Mono PERC", hsn: "8541", unit: "Set", rate: 280000, taxPct: 12 });
    expect(lineFromProduct({ Id: 8, Name: "Cable" })).toMatchObject({ description: "Cable", hsn: "", rate: "", taxPct: "" });
  });
});

describe("the remembered letterhead", () => {
  it("becomes the company block, images on", () => {
    expect(companyFromProfile(PROFILE)).toMatchObject({ name: "Solar Care", gstin: "24ABCDE1234F1Z5", bank: "HDFC", signatory: "Amit", logoAttachmentId: 12, headerAttachmentId: null, showLogo: true, showHeader: true, accent: "#0f766e" });
  });

  // A brand-new branch has an empty profile; Central's company name is a better
  // starting point than a blank field.
  it("falls back to the tenant's name and the default accent when nothing is saved yet", () => {
    expect(companyFromProfile({ Id: 3, IsSet: false }, "Solar Care")).toMatchObject({ name: "Solar Care", accent: DEFAULT_ACCENT, gstin: "" });
    expect(companyFromProfile(null).name).toBe("");
  });

  it("round-trips back into a saveQuoteProfile body", () => {
    const form = toForm({ quotation: { TemplateCode: "modern", Company: companyFromProfile(PROFILE), Content: { intro: "<p>i</p>", terms: "<p>t</p>" } } });
    expect(profileFromForm(form, 9)).toEqual({
      LeadId: 9, CompanyName: "Solar Care", Address: "402 Titanium", City: "Ahmedabad", StateCode: "24", Pincode: "380054",
      GSTIN: "24ABCDE1234F1Z5", Phone: "079", Email: "s@s.in", Website: "s.in", BankDetails: "HDFC", SignatoryName: "Amit",
      DefaultIntro: "<p>i</p>", DefaultTerms: "<p>t</p>", LogoAttachmentId: 12, HeaderAttachmentId: null, AccentColor: "#0f766e", DefaultTemplate: "modern",
    });
  });
});

describe("draftBodyFromLead", () => {
  const body = draftBodyFromLead({ lead: LEAD, profile: PROFILE, product: PRODUCT, templateCode: "minimal", now: new Date(2026, 8, 18) });

  it("opens the builder already filled in", () => {
    expect(body).toMatchObject({
      Id: 0, LeadId: 9, TemplateCode: "minimal", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "Quotation for 5 kW Rooftop",
      ToName: "Ramesh Patel", ToCompany: "", ToMobile: "9825012345", ToCity: "Ahmedabad", ToStateCode: "24", ToGSTIN: "",
    });
    expect(body.Company.name).toBe("Solar Care");
    expect(body.Content).toEqual({ intro: "<p>Dear customer</p>", terms: "<p>50%</p>", notes: "", sections: [] });
    expect(body.Lines).toEqual([{ productId: 7, description: "5 kW Rooftop — Mono PERC", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "pct", discountValue: "", taxPct: 12 }]);
  });

  it("uses the profile's template when none was picked, and classic when there is neither", () => {
    expect(draftBodyFromLead({ lead: LEAD, profile: PROFILE }).TemplateCode).toBe("modern");
    expect(draftBodyFromLead({ lead: LEAD, profile: null }).TemplateCode).toBe("classic");
  });

  // A wrong guess silently flips CGST/SGST to IGST. No guess leaves the field
  // for the user, and Finalise insists on it.
  it("pre-picks place of supply only on an exact state name", () => {
    expect(draftBodyFromLead({ lead: { ...LEAD, State: "Gujrat" }, profile: PROFILE }).ToStateCode).toBe("");
  });

  it("has no lines and no subject for a lead with no product; addresses a company lead to the company", () => {
    const b = draftBodyFromLead({ lead: { ...LEAD, Company: "Patel Textiles" }, profile: PROFILE });
    expect(b).toMatchObject({ Lines: [], Subject: "", ToCompany: "Patel Textiles", ToName: "Ramesh Patel" });
  });
});

describe("toForm / toBody", () => {
  const detail = {
    quotation: { Id: 4, LeadId: 9, TemplateCode: "modern", QuoteDate: "2026-09-18T00:00:00.000Z", ValidTill: null, Subject: null,
      ToName: "Ramesh", ToStateCode: "24", ToGSTIN: null, Company: { name: "Solar Care", gstin: "24abcde1234f1z5", showLogo: false }, Content: { intro: "<p>hi</p>", sections: [{ type: "text", title: "Scope", body: "<p>x</p>" }] } },
    lines: [{ Id: 1, ProductId: 7, Description: "Rooftop", HSNCode: "8541", Qty: 1, Unit: "Set", Rate: 280000, DiscountType: "amt", DiscountValue: 10000, TaxPct: 12, LineTotal: 302400 }],
  };

  it("maps the server's row into form state, nulls to empty strings", () => {
    const f = toForm(detail);
    expect(f).toMatchObject({ TemplateCode: "modern", QuoteDate: "2026-09-18", ValidTill: "", Subject: "" });
    expect(f.To).toMatchObject({ ToName: "Ramesh", ToGSTIN: "", ToStateCode: "24" });
    expect(f.Company).toMatchObject({ name: "Solar Care", showLogo: false, showHeader: true, accent: DEFAULT_ACCENT });
    expect(f.Lines[0]).toMatchObject({ productId: 7, description: "Rooftop", discountType: "amt", discountValue: 10000, taxPct: 12 });
    expect(f.Content.sections[0]).toMatchObject({ type: "text", title: "Scope" });
    expect(f.Content.sections[0].key).toBeTruthy();
  });

  it("survives a row with no JSON at all", () => {
    const f = toForm({ quotation: { ToName: "x" } });
    expect(f).toMatchObject({ TemplateCode: "classic", Lines: [], Content: { intro: "", terms: "", notes: "", sections: [] } });
  });

  // The web never sends a total, a React key, or a server-computed amount.
  it("builds the save body: no keys, no totals, GSTIN cleaned, seller state read off it", () => {
    const b = toBody(toForm(detail), { id: 4, leadId: 9 });
    expect(b).toMatchObject({ Id: 4, LeadId: 9, TemplateCode: "modern", QuoteDate: "2026-09-18", ValidTill: null, ToName: "Ramesh" });
    expect(b.Company).toMatchObject({ gstin: "24ABCDE1234F1Z5", stateCode: "24" });
    expect(b.Lines).toEqual([{ productId: 7, description: "Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 }]);
    expect(b.Content.sections).toEqual([{ type: "text", title: "Scope", body: "<p>x</p>" }]);
    expect(JSON.stringify(b)).not.toMatch(/"key"|LineTotal|GrandTotal/);
  });

  it("previews the same numbers the fixture table promises (F1)", () => {
    expect(amountsOf(toForm(detail))).toMatchObject({ inter: false, taxableTotal: 270000, cgstTotal: 16200, sgstTotal: 16200, grandTotal: 302400 });
  });
});

describe("finaliseBlockers", () => {
  const ready = () => {
    const f = toForm({ quotation: { ToName: "Ramesh", ToStateCode: "24", Company: { name: "Solar Care", gstin: "24ABCDE1234F1Z5", logoAttachmentId: 12, showHeader: false } },
      lines: [{ Description: "Rooftop", Qty: 1, Rate: 100 }] });
    return f;
  };
  const patch = (fn) => { const f = ready(); fn(f); return finaliseBlockers(f); };

  it("is empty when the quotation is ready", () => expect(finaliseBlockers(ready())).toEqual([]));

  // Only the builder knows the art on the page is OUR placeholder. Without this
  // a customer receives a quotation carrying a grey sample logo.
  it("refuses while our sample art is still showing — replace it or remove it", () => {
    expect(patch((f) => { f.Company.logoAttachmentId = null; })).toEqual(["Replace the sample logo, or remove it"]);
    expect(patch((f) => { f.Company.logoAttachmentId = null; f.Company.showLogo = false; })).toEqual([]);
    expect(patch((f) => { f.Company.showHeader = true; })).toEqual(["Replace the sample banner, or remove it"]);
  });

  it.each([
    [(f) => { f.Company.name = "  "; }, "Add your company name"],
    [(f) => { f.To.ToName = ""; }, "Add the customer's name"],
    [(f) => { f.Lines = []; }, "Add at least one line"],
    [(f) => { f.Lines[0].description = " "; }, "Every line needs a description and a quantity"],
    [(f) => { f.Lines[0].qty = 0; }, "Every line needs a description and a quantity"],
    [(f) => { f.Company.gstin = "24ABC"; }, "Your GSTIN does not look right"],
    [(f) => { f.To.ToGSTIN = "nope"; }, "The customer's GSTIN does not look right"],
    [(f) => { f.To.ToStateCode = ""; }, "Choose the customer's state — GST depends on it"],
  ])("names what is missing", (mutate, message) => expect(patch(mutate)).toEqual([message]));

  it("does not ask an unregistered seller for a place of supply", () => {
    expect(patch((f) => { f.Company.gstin = ""; f.To.ToStateCode = ""; })).toEqual([]);
  });
});
```
`web/src/pages/Sales/Quotations/quoteForm.js`:
```js
// The builder's state, and its two borders: the row the server returns → the
// form (toForm), and the form → the body the server accepts (toBody). Pure, so
// the page component is left with wiring and nothing to get subtly wrong.
import { computeQuote } from "./quoteMath";
import { cleanGstin, isValidGstin, matchStateName, stateFromGstin } from "./gst";

export const DEFAULT_VALID_DAYS = 15;
export const DEFAULT_ACCENT = "#1e3a8a";
export const ACCENTS = ["#1e3a8a", "#0f766e", "#b45309", "#9f1239", "#6d28d9", "#0f172a"];

// Local Y/M/D. toISOString() is UTC and would roll the date back a day in IST.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayIso = (now = new Date()) => iso(now);
export const addDays = (isoDay, days) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDay ?? ""));
  if (!m) return "";
  return iso(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
};
const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? "")) ? String(v).slice(0, 10) : "");

let seq = 0;
/** React list keys for rows the user adds and removes; never sent to the server. */
const nextKey = () => `k${++seq}`;
const str = (v) => (v == null ? "" : String(v));

export const emptyLine = () => ({
  key: nextKey(), productId: null, description: "", hsn: "", qty: 1, unit: "", rate: "", discountType: "pct", discountValue: "", taxPct: "",
});

/** A product from the master → a line. The line is free text from here on; the product only seeds it. */
export const lineFromProduct = (p) => ({
  ...emptyLine(),
  productId: p?.Id ?? null,
  description: [p?.Name, p?.Description].filter(Boolean).join(" — "),
  hsn: str(p?.HSNCode), unit: str(p?.Unit), rate: p?.UnitPrice ?? "", taxPct: p?.TaxPct ?? "",
});

/** The branch's remembered letterhead → a quotation's company block. */
export const companyFromProfile = (profile, fallbackName = "") => ({
  name: str(profile?.CompanyName) || fallbackName,
  address: str(profile?.Address), city: str(profile?.City), stateCode: str(profile?.StateCode), pincode: str(profile?.Pincode),
  gstin: str(profile?.GSTIN), phone: str(profile?.Phone), email: str(profile?.Email), website: str(profile?.Website),
  bank: str(profile?.BankDetails), signatory: str(profile?.SignatoryName),
  logoAttachmentId: profile?.LogoAttachmentId ?? null, headerAttachmentId: profile?.HeaderAttachmentId ?? null,
  showLogo: true, showHeader: true,
  accent: profile?.AccentColor || DEFAULT_ACCENT,
});

/** …and back: what "remember this for next time" sends to saveQuoteProfile. */
export const profileFromForm = (form, leadId) => ({
  LeadId: leadId,
  CompanyName: form.Company.name, Address: form.Company.address, City: form.Company.city, StateCode: form.Company.stateCode,
  Pincode: form.Company.pincode, GSTIN: form.Company.gstin, Phone: form.Company.phone, Email: form.Company.email,
  Website: form.Company.website, BankDetails: form.Company.bank, SignatoryName: form.Company.signatory,
  DefaultIntro: form.Content.intro, DefaultTerms: form.Content.terms,
  LogoAttachmentId: form.Company.logoAttachmentId, HeaderAttachmentId: form.Company.headerAttachmentId,
  AccentColor: form.Company.accent, DefaultTemplate: form.TemplateCode,
});

/**
 * "Create quotation" on a lead: everything the lead and the branch's profile
 * already know, so the builder opens filled in. The lead's one product seeds
 * line 1; its free-text State pre-picks the place of supply only on an exact
 * name match (a wrong guess would silently flip CGST/SGST to IGST).
 */
export function draftBodyFromLead({ lead, profile, product, templateCode, companyName, now = new Date() }) {
  const quoteDate = todayIso(now);
  const company = companyFromProfile(profile, companyName);
  const hasCompany = Boolean(str(lead.Company).trim());
  return {
    Id: 0,
    LeadId: lead.Id,
    TemplateCode: templateCode || profile?.DefaultTemplate || "classic",
    QuoteDate: quoteDate,
    ValidTill: addDays(quoteDate, DEFAULT_VALID_DAYS),
    Subject: product?.Name ? `Quotation for ${product.Name}` : "",
    ToName: lead.Name, ToCompany: hasCompany ? lead.Company : "",
    ToMobile: str(lead.MobileNo), ToEmail: str(lead.Email), ToAddress: str(lead.Address), ToCity: str(lead.City),
    ToStateCode: matchStateName(lead.State) ?? "", ToPincode: str(lead.Pincode), ToGSTIN: "",
    Company: company,
    Content: { intro: str(profile?.DefaultIntro), terms: str(profile?.DefaultTerms), notes: "", sections: [] },
    Lines: product ? [stripKey(lineFromProduct(product))] : [],
  };
}

const stripKey = ({ key, ...line }) => line; // eslint-disable-line no-unused-vars

/** fetchQuotationDetail's `{ quotation, lines }` → form state. */
export function toForm({ quotation: q, lines = [] }) {
  const c = q.Company ?? {};
  return {
    TemplateCode: q.TemplateCode || "classic",
    QuoteDate: day(q.QuoteDate), ValidTill: day(q.ValidTill), Subject: str(q.Subject),
    To: {
      ToName: str(q.ToName), ToCompany: str(q.ToCompany), ToMobile: str(q.ToMobile), ToEmail: str(q.ToEmail),
      ToAddress: str(q.ToAddress), ToCity: str(q.ToCity), ToStateCode: str(q.ToStateCode), ToPincode: str(q.ToPincode), ToGSTIN: str(q.ToGSTIN),
    },
    Company: { ...companyFromProfile(null), ...c, showLogo: c.showLogo !== false, showHeader: c.showHeader !== false, accent: c.accent || DEFAULT_ACCENT },
    Content: {
      intro: str(q.Content?.intro), terms: str(q.Content?.terms), notes: str(q.Content?.notes),
      sections: (Array.isArray(q.Content?.sections) ? q.Content.sections : []).map((s) => ({ ...s, key: nextKey() })),
    },
    Lines: lines.map((l) => ({
      key: nextKey(), productId: l.ProductId ?? null, description: str(l.Description), hsn: str(l.HSNCode), qty: Number(l.Qty),
      unit: str(l.Unit), rate: Number(l.Rate), discountType: l.DiscountType === "amt" ? "amt" : "pct",
      discountValue: Number(l.DiscountValue) || "", taxPct: Number(l.TaxPct) || "",
    })),
  };
}

/** Form state → the saveQuotation body. No totals: the server computes every amount. */
export function toBody(form, { id, leadId }) {
  return {
    Id: id, LeadId: leadId,
    TemplateCode: form.TemplateCode, QuoteDate: form.QuoteDate || null, ValidTill: form.ValidTill || null, Subject: form.Subject,
    ...form.To,
    Company: { ...form.Company, gstin: cleanGstin(form.Company.gstin), stateCode: stateFromGstin(form.Company.gstin) ?? form.Company.stateCode },
    Content: { ...form.Content, sections: form.Content.sections.map(stripKey) },
    Lines: form.Lines.map(stripKey),
  };
}

/** The live preview's numbers. The server's are the truth; these only have to agree with them. */
export const amountsOf = (form) => computeQuote(form.Lines, {
  sellerGstin: cleanGstin(form.Company.gstin),
  sellerState: stateFromGstin(form.Company.gstin) ?? form.Company.stateCode,
  buyerState: form.To.ToStateCode,
});

/**
 * Why Finalise is not available yet, in the user's words — an empty list means
 * go. The server checks the substantive ones again (sp_FinaliseQuotation); the
 * sample-art checks exist only here, because only the builder knows that what
 * is on the page is OUR placeholder and not their logo.
 */
export function finaliseBlockers(form) {
  const out = [];
  const c = form.Company;
  if (!str(c.name).trim()) out.push("Add your company name");
  if (c.showLogo !== false && !c.logoAttachmentId) out.push("Replace the sample logo, or remove it");
  if (c.showHeader !== false && !c.headerAttachmentId) out.push("Replace the sample banner, or remove it");
  if (!str(form.To.ToName).trim()) out.push("Add the customer's name");
  if (form.Lines.length === 0) out.push("Add at least one line");
  else if (form.Lines.some((l) => !str(l.description).trim() || !(Number(l.qty) > 0))) out.push("Every line needs a description and a quantity");
  const seller = cleanGstin(c.gstin);
  if (seller && !isValidGstin(seller)) out.push("Your GSTIN does not look right");
  if (str(form.To.ToGSTIN).trim() && !isValidGstin(form.To.ToGSTIN)) out.push("The customer's GSTIN does not look right");
  if (seller && isValidGstin(seller) && !form.To.ToStateCode) out.push("Choose the customer's state — GST depends on it");
  return out;
}
```
Run: `cd web && pnpm exec vitest run src/pages/Sales/Quotations/quoteForm.test.js --coverage --coverage.include=src/pages/Sales/Quotations/quoteForm.js` — FAIL before the module exists; 25 PASS, ≥ 80 % after.

- [ ] **Step 2: `useQuoteImages` — test first**

Attachments are JWT-gated, so an `<img src>` cannot load one and neither can the PDF engine. The hook downloads each id once through the authenticated client and hands the PDF a data URL.

`web/src/pages/Sales/Quotations/useQuoteImages.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../../api/attachmentQueries", () => ({ fetchAttachmentBlob: vi.fn(), uploadAttachment: vi.fn() }));

import { fetchAttachmentBlob, uploadAttachment } from "../../../api/attachmentQueries";
import { useQuoteImages, uploadImage, imageIdsOf, MAX_IMAGE_BYTES } from "./useQuoteImages";

const pngBlob = () => new Blob(["png-bytes"], { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  URL.revokeObjectURL = vi.fn();
  fetchAttachmentBlob.mockImplementation(async () => ({ blob: pngBlob(), url: "blob:tmp" }));
});

describe("useQuoteImages", () => {
  it("downloads each id once and exposes a data URL the PDF can draw", async () => {
    const { result, rerender } = renderHook(({ ids }) => useQuoteImages(ids), { initialProps: { ids: [12, 12, null, 21] } });
    await waitFor(() => expect(Object.keys(result.current.images)).toHaveLength(2));
    expect(result.current.images[12]).toMatch(/^data:image\/png;base64,/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tmp"); // the helper's object URL is not ours to keep
    rerender({ ids: [21, 12] });
    rerender({ ids: [12, 21, 33] });
    await waitFor(() => expect(result.current.images[33]).toBeTruthy());
    expect(fetchAttachmentBlob).toHaveBeenCalledTimes(3); // 12, 21, 33 — never twice
  });

  it("lets a failed download be retried on the next change, and draws nothing meanwhile", async () => {
    fetchAttachmentBlob.mockRejectedValueOnce(new Error("403"));
    const { result, rerender } = renderHook(({ ids }) => useQuoteImages(ids), { initialProps: { ids: [12] } });
    await waitFor(() => expect(fetchAttachmentBlob).toHaveBeenCalledTimes(1));
    expect(result.current.images[12]).toBeUndefined();
    rerender({ ids: [12, 21] });
    await waitFor(() => expect(result.current.images[12]).toBeTruthy());
  });

  it("takes a just-uploaded image without downloading it back", async () => {
    const { result, rerender } = renderHook(({ ids }) => useQuoteImages(ids), { initialProps: { ids: [] } });
    act(() => result.current.prime(55, "data:image/png;base64,AAA"));
    rerender({ ids: [55] });
    expect(result.current.images[55]).toBe("data:image/png;base64,AAA");
    expect(fetchAttachmentBlob).not.toHaveBeenCalled();
  });
});

describe("uploadImage", () => {
  const file = (name, type, size = 10) => { const f = new File(["x".repeat(size)], name, { type }); return f; };

  it("uploads a PNG/JPEG and returns the new id with a ready data URL", async () => {
    uploadAttachment.mockResolvedValue({ data: { data: { attachmentId: 77 } } });
    const out = await uploadImage({ entity: "quoteprofile", entityId: 3, file: file("logo.png", "image/png") });
    expect(uploadAttachment).toHaveBeenCalledWith({ Entity: "quoteprofile", EntityId: 3, file: expect.any(File) });
    expect(out.id).toBe(77);
    expect(out.dataUrl).toMatch(/^data:image\/png/);
  });

  // The PDF engine cannot draw WebP or GIF; the generic upload pipeline accepts
  // both. Refuse here, in words, rather than show a blank box in the quotation.
  it.each([["a.webp", "image/webp"], ["a.gif", "image/gif"], ["a.pdf", "application/pdf"]])("refuses %s", async (name, type) => {
    await expect(uploadImage({ entity: "quotation", entityId: 4, file: file(name, type) })).rejects.toThrow("Use a PNG or JPEG image");
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("refuses an image over 2 MB", async () => {
    const big = file("big.jpg", "image/jpeg"); Object.defineProperty(big, "size", { value: MAX_IMAGE_BYTES + 1 });
    await expect(uploadImage({ entity: "quotation", entityId: 4, file: big })).rejects.toThrow("Images must be 2 MB or smaller");
  });

  it("surfaces the server's own message when it refuses", async () => {
    uploadAttachment.mockRejectedValue({ response: { data: { message: "Only a draft quotation's pictures can be changed" } } });
    await expect(uploadImage({ entity: "quotation", entityId: 4, file: file("a.png", "image/png") })).rejects.toThrow("Only a draft quotation's pictures can be changed");
  });
});

describe("imageIdsOf", () => {
  it("collects the letterhead and every section picture, skipping what is switched off", () => {
    const form = { Company: { logoAttachmentId: 12, headerAttachmentId: 13, showHeader: false },
      Content: { sections: [{ type: "text" }, { type: "images", items: [{ attachmentId: 21 }, { attachmentId: null }] }] } };
    expect(imageIdsOf(form)).toEqual([12, 21]);
    expect(imageIdsOf(null)).toEqual([]);
  });
});
```

`web/src/pages/Sales/Quotations/useQuoteImages.js`:

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAttachmentBlob, uploadAttachment } from "../../../api/attachmentQueries";

// The PDF engine draws PNG and JPEG. The generic upload pipeline also accepts
// WebP and GIF, which would arrive in the quotation as an empty box.
const DRAWABLE = ["image/png", "image/jpeg"];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Every attachment id a quotation needs drawn. */
export function imageIdsOf(form) {
  if (!form) return [];
  const c = form.Company ?? {};
  return [
    c.showLogo !== false ? c.logoAttachmentId : null,
    c.showHeader !== false ? c.headerAttachmentId : null,
    ...(form.Content?.sections ?? []).flatMap((s) => (s.type === "images" ? (s.items ?? []).map((i) => i.attachmentId) : [])),
  ].filter(Boolean);
}

/**
 * Attachment ids → data URLs. Attachments are JWT-gated, so neither an
 * <img src> nor the PDF engine can fetch one; this downloads each id ONCE
 * through the authenticated client. An id that is not loaded yet is simply
 * absent — buildQuoteDoc then draws nothing, never the sample art.
 */
export function useQuoteImages(ids) {
  const [images, setImages] = useState({});
  const asked = useRef(new Set());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const key = [...new Set(ids.filter(Boolean))].sort((a, b) => a - b).join(",");

  useEffect(() => {
    for (const id of key ? key.split(",").map(Number) : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      fetchAttachmentBlob({ Id: id })
        .then(async ({ blob, url }) => {
          URL.revokeObjectURL(url); // the helper made an object URL we have no use for
          const dataUrl = await toDataUrl(blob);
          if (mounted.current) setImages((m) => ({ ...m, [id]: dataUrl }));
        })
        .catch(() => { asked.current.delete(id); }); // forgotten, so the next change retries it
    }
  }, [key]);

  /** A just-uploaded image is already in hand — do not download it back. */
  const prime = useCallback((id, dataUrl) => {
    asked.current.add(id);
    setImages((m) => ({ ...m, [id]: dataUrl }));
  }, []);

  return { images, prime };
}

/** Validates, uploads, and returns `{ id, dataUrl }`. Throws an Error whose message is ready to show. */
export async function uploadImage({ entity, entityId, file }) {
  if (!DRAWABLE.includes(file?.type)) throw new Error("Use a PNG or JPEG image");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be 2 MB or smaller");
  try {
    const res = await uploadAttachment({ Entity: entity, EntityId: entityId, file });
    return { id: res.data.data.attachmentId, dataUrl: await toDataUrl(file) };
  } catch (err) {
    throw new Error(err?.response?.data?.message || "The image could not be uploaded");
  }
}
```

- [ ] **Step 3: `builder/ImageSlot` — test first**

`web/src/pages/Sales/Quotations/builder/ImageSlot.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import ImageSlot from "./ImageSlot";
import renderWithProviders from "../../../../test/renderWithProviders";

const base = { label: "Logo", src: "data:logo", onUpload: vi.fn(), onRemove: vi.fn(), onRestore: vi.fn(), "data-testid": "logo" };

describe("ImageSlot", () => {
  it("shows the image and hands a chosen file to onUpload", () => {
    const onUpload = vi.fn();
    renderWithProviders(<ImageSlot {...base} onUpload={onUpload} />);
    expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute("src", "data:logo");
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("logo-file"), { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  // The whole point of shipping sample art: it must be obvious that it is ours,
  // not theirs — Finalise is blocked until it is replaced or removed.
  it("says so when what is showing is our sample", () => {
    renderWithProviders(<ImageSlot {...base} isSample />);
    expect(screen.getByText(/sample/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /replace/i })).toBeInTheDocument();
  });

  it("can be removed outright, and brought back", () => {
    const onRemove = vi.fn(); const onRestore = vi.fn();
    const { rerender } = renderWithProviders(<ImageSlot {...base} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
    rerender(<ImageSlot {...base} hidden onRestore={onRestore} />);
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(onRestore).toHaveBeenCalled();
  });

  it("offers nothing to press when disabled (an issued quotation)", () => {
    renderWithProviders(<ImageSlot {...base} disabled />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

> `rerender` from `renderWithProviders` re-renders **without** the providers. If `ImageSlot` reads the theme on the re-render and throws, wrap the rerendered element the way `RichTextEditor.test.jsx` does (`themed(...)`), or render twice with `cleanup()` between.

`web/src/pages/Sales/Quotations/builder/ImageSlot.jsx`:

```jsx
import { useRef } from "react";
import { useTheme } from "@mui/material/styles";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { Button, Chip } from "../../../../components/ui";

/**
 * One replaceable picture on the letterhead (logo, banner). Three states:
 * showing theirs · showing OUR sample (flagged — Finalise is blocked until it
 * is replaced or removed) · removed outright.
 */
export default function ImageSlot({ label, src, isSample = false, hidden = false, disabled = false, busy = false, wide = false, onUpload, onRemove, onRestore, "data-testid": testId }) {
  const theme = useTheme();
  const p = theme.tokens;
  const input = useRef(null);

  return (
    <div data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary }}>{label}</span>
        {isSample && !hidden && <Chip label="Sample — replace or remove" size="sm" tone="warning" />}
      </div>
      {!hidden && (
        <div style={{ height: wide ? 72 : 88, width: wide ? "100%" : 88, borderRadius: theme.radii.md, border: `1px dashed ${p.border.strong}`, background: p.surface.subtle, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {src && <img src={src} alt={label} style={{ width: "100%", height: "100%", objectFit: wide ? "cover" : "contain" }} />}
        </div>
      )}
      {!disabled && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {hidden ? (
            <Button size="sm" variant="ghost" leftIcon={<RotateCcw size={13} />} onClick={onRestore}>Show {label.toLowerCase()}</Button>
          ) : (
            <>
              <Button size="sm" variant="tonal" leftIcon={<ImagePlus size={13} />} loading={busy} onClick={() => input.current?.click()}>Replace</Button>
              <Button size="sm" variant="ghost" leftIcon={<Trash2 size={13} />} onClick={onRemove}>Remove</Button>
            </>
          )}
          <input ref={input} type="file" accept="image/png,image/jpeg" hidden data-testid={`${testId}-file`}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onUpload?.(f); }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `builder/LinesEditor` — test first**

`web/src/pages/Sales/Quotations/builder/LinesEditor.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import LinesEditor from "./LinesEditor";
import renderWithProviders from "../../../../test/renderWithProviders";
import { computeQuote } from "../quoteMath";

const LINES = [
  { key: "a", productId: 7, description: "5 kW Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 },
  { key: "b", productId: null, description: "Installation", hsn: "", qty: 1, unit: "", rate: 20000, discountType: "pct", discountValue: "", taxPct: 18 },
];
const PRODUCTS = [{ Id: 9, Name: "AMC", Description: "5 years", HSNCode: "9987", Unit: "Yr", UnitPrice: 3000, TaxPct: 18 }];
const amounts = (lines) => computeQuote(lines, { sellerGstin: "24ABCDE1234F1Z5", sellerState: "24", buyerState: "24" });
const draw = (props = {}) => {
  const onChange = vi.fn();
  renderWithProviders(<LinesEditor lines={LINES} amounts={amounts(LINES)} products={PRODUCTS} onChange={onChange} {...props} />);
  return onChange;
};
const row = (i) => screen.getAllByTestId("quote-line")[i];

describe("LinesEditor", () => {
  it("shows each line with its computed taxable amount", () => {
    draw();
    expect(within(row(0)).getByLabelText("Description")).toHaveValue("5 kW Rooftop");
    expect(within(row(0)).getByTestId("line-amount")).toHaveTextContent("₹2,70,000.00");
    expect(within(row(1)).getByTestId("line-amount")).toHaveTextContent("₹20,000.00");
  });

  it("edits a field and reports the whole new list", () => {
    const onChange = draw();
    fireEvent.change(within(row(1)).getByLabelText("Rate"), { target: { value: "25000" } });
    expect(onChange).toHaveBeenLastCalledWith([LINES[0], { ...LINES[1], rate: "25000" }]);
  });

  it("switches a discount between % and ₹", () => {
    const onChange = draw();
    fireEvent.click(within(row(1)).getByRole("button", { name: "Discount in rupees" }));
    expect(onChange.mock.calls.at(-1)[0][1].discountType).toBe("amt");
  });

  it("adds a blank line, and removes one", () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    expect(onChange.mock.calls.at(-1)[0]).toHaveLength(3);
    expect(onChange.mock.calls.at(-1)[0][2]).toMatchObject({ description: "", qty: 1 });
    fireEvent.click(within(row(0)).getByRole("button", { name: "Remove line" }));
    expect(onChange.mock.calls.at(-1)[0].map((l) => l.key)).toEqual(["b"]);
  });

  it("moves a line up and down", () => {
    const onChange = draw();
    fireEvent.click(within(row(1)).getByRole("button", { name: "Move up" }));
    expect(onChange.mock.calls.at(-1)[0].map((l) => l.key)).toEqual(["b", "a"]);
    expect(within(row(0)).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(row(1)).getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("is read-only when disabled: no add, no remove, inputs locked", () => {
    draw({ disabled: true });
    expect(screen.queryByRole("button", { name: /add line/i })).toBeNull();
    expect(within(row(0)).getByLabelText("Description")).toBeDisabled();
  });

  it("says so when there are no lines yet", () => {
    renderWithProviders(<LinesEditor lines={[]} amounts={amounts([])} products={[]} onChange={() => {}} />);
    expect(screen.getByText(/no lines yet/i)).toBeInTheDocument();
  });
});
```

`web/src/pages/Sales/Quotations/builder/LinesEditor.jsx`:

```jsx
import { useMemo } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Combobox, IconButton, TextInput } from "../../../../components/ui";
import { money } from "../buildQuoteDoc";
import { emptyLine, lineFromProduct } from "../quoteForm";

const num = { inputMode: "decimal" };

/**
 * The priced lines. Amounts shown here come from `amounts` (quoteMath), never
 * from this component doing its own multiplication — one definition of the
 * arithmetic, and it is not here.
 */
export default function LinesEditor({ lines, amounts, products = [], disabled = false, onChange }) {
  const theme = useTheme();
  const p = theme.tokens;
  const productOpts = useMemo(() => products.map((x) => ({ value: x.Id, label: x.Name, product: x })), [products]);

  const patch = (i, field) => (e) => onChange(lines.map((l, j) => (j === i ? { ...l, [field]: e.target.value } : l)));
  const setType = (i, discountType) => onChange(lines.map((l, j) => (j === i ? { ...l, discountType } : l)));
  const remove = (i) => onChange(lines.filter((_, j) => j !== i));
  const move = (i, d) => { const next = [...lines]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };

  const seg = (active) => ({
    height: 32, minWidth: 30, border: `1px solid ${active ? p.primary.main : p.border.default}`, background: active ? p.primary.subtle : p.surface.card,
    color: active ? p.primary.main : p.text.secondary, fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {lines.length === 0 && <Box sx={{ fontSize: 13, color: p.text.tertiary }}>No lines yet — add one, or pick a product.</Box>}
      {lines.map((l, i) => (
        <Box key={l.key} data-testid="quote-line" sx={{ border: `1px solid ${p.border.default}`, borderRadius: `${theme.radii.md}px`, p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
            <Box sx={{ flex: 1 }}><TextInput size="sm" label="Description" value={l.description} onChange={patch(i, "description")} disabled={disabled} /></Box>
            {!disabled && (
              <Box sx={{ display: "flex" }}>
                <IconButton size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></IconButton>
                <IconButton size="sm" aria-label="Move down" disabled={i === lines.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></IconButton>
                <IconButton size="sm" variant="destructive" aria-label="Remove line" onClick={() => remove(i)}><Trash2 size={14} /></IconButton>
              </Box>
            )}
          </Box>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(6, minmax(0, 1fr))" }, alignItems: "end" }}>
            <TextInput size="sm" label="HSN/SAC" value={l.hsn} onChange={patch(i, "hsn")} disabled={disabled} />
            <TextInput size="sm" label="Qty" value={l.qty} onChange={patch(i, "qty")} disabled={disabled} {...num} />
            <TextInput size="sm" label="Unit" value={l.unit} onChange={patch(i, "unit")} disabled={disabled} placeholder="Nos" />
            <TextInput size="sm" label="Rate" value={l.rate} onChange={patch(i, "rate")} disabled={disabled} {...num} />
            <Box sx={{ display: "flex", alignItems: "flex-end" }}>
              <Box sx={{ flex: 1 }}><TextInput size="sm" label="Discount" value={l.discountValue} onChange={patch(i, "discountValue")} disabled={disabled} {...num} /></Box>
              <button type="button" aria-label="Discount in percent" aria-pressed={l.discountType !== "amt"} disabled={disabled} onClick={() => setType(i, "pct")} style={{ ...seg(l.discountType !== "amt"), borderRadius: "0", marginLeft: 4 }}>%</button>
              <button type="button" aria-label="Discount in rupees" aria-pressed={l.discountType === "amt"} disabled={disabled} onClick={() => setType(i, "amt")} style={{ ...seg(l.discountType === "amt"), borderRadius: "0 8px 8px 0", borderLeft: "none" }}>₹</button>
            </Box>
            <TextInput size="sm" label="GST %" value={l.taxPct} onChange={patch(i, "taxPct")} disabled={disabled} {...num} />
          </Box>
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, fontSize: 13, color: p.text.secondary }}>
            Amount <strong data-testid="line-amount" style={{ color: p.text.primary }}>{money(amounts?.lines?.[i]?.taxableAmt)}</strong>
          </Box>
        </Box>
      ))}
      {!disabled && (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm" variant="tonal" leftIcon={<Plus size={14} />} onClick={() => onChange([...lines, emptyLine()])}>Add line</Button>
          {productOpts.length > 0 && (
            <Box sx={{ width: 260 }}>
              {/* value stays null: this is an action ("add this product"), not a field that holds a choice. */}
              <Combobox size="sm" placeholder="Add from products…" options={productOpts} value={null} blurOnSelect
                onChange={(opt) => opt && onChange([...lines, lineFromProduct(opt.product)])} data-testid="add-from-product" />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 5: `builder/SectionsEditor` — test first**

`web/src/pages/Sales/Quotations/builder/SectionsEditor.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import renderWithProviders from "../../../../test/renderWithProviders";

// The editor has its own suite (components/ui). Here it is a labelled textarea.
vi.mock("../../../../components/ui/RichTextEditor", () => ({
  __esModule: true,
  default: ({ label, value, onChange, disabled }) => <textarea aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />,
}));

import SectionsEditor from "./SectionsEditor";

const SECTIONS = [
  { key: "s1", type: "text", title: "Scope", body: "<p>x</p>" },
  { key: "s2", type: "images", title: "Sites", items: [{ attachmentId: 21, caption: "Bopal" }] },
];
const draw = (props = {}) => {
  const onChange = vi.fn();
  renderWithProviders(<SectionsEditor sections={SECTIONS} images={{ 21: "data:site" }} onChange={onChange} onUploadPicture={vi.fn()} {...props} />);
  return onChange;
};
const sec = (i) => screen.getAllByTestId("quote-section")[i];

describe("SectionsEditor", () => {
  it("adds a text section and a picture section", () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole("button", { name: /add text section/i }));
    expect(onChange.mock.calls.at(-1)[0][2]).toMatchObject({ type: "text", title: "", body: "" });
    fireEvent.click(screen.getByRole("button", { name: /add picture section/i }));
    expect(onChange.mock.calls.at(-1)[0][2]).toMatchObject({ type: "images", title: "", items: [] });
  });

  it("edits a title and a body", () => {
    const onChange = draw();
    fireEvent.change(within(sec(0)).getByLabelText("Section title"), { target: { value: "What is included" } });
    expect(onChange.mock.calls.at(-1)[0][0].title).toBe("What is included");
    fireEvent.change(within(sec(0)).getByLabelText("Section text"), { target: { value: "<p>y</p>" } });
    expect(onChange.mock.calls.at(-1)[0][0].body).toBe("<p>y</p>");
  });

  it("uploads a picture into its section, captions it, and removes it", async () => {
    const onUploadPicture = vi.fn().mockResolvedValue({ id: 33 });
    const onChange = draw({ onUploadPicture });
    const file = new File(["x"], "site.jpg", { type: "image/jpeg" });
    fireEvent.change(within(sec(1)).getByTestId("section-file"), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onUploadPicture).toHaveBeenCalledWith(file);
    expect(onChange.mock.calls.at(-1)[0][1].items).toEqual([{ attachmentId: 21, caption: "Bopal" }, { attachmentId: 33, caption: "" }]);

    fireEvent.change(within(sec(1)).getByLabelText("Caption 1"), { target: { value: "Bopal, 5 kW" } });
    expect(onChange.mock.calls.at(-1)[0][1].items[0].caption).toBe("Bopal, 5 kW");
    fireEvent.click(within(sec(1)).getByRole("button", { name: "Remove picture 1" }));
    expect(onChange.mock.calls.at(-1)[0][1].items).toEqual([]);
  });

  it("shows the upload's refusal next to the section, and changes nothing", async () => {
    const onUploadPicture = vi.fn().mockRejectedValue(new Error("Use a PNG or JPEG image"));
    const onChange = draw({ onUploadPicture });
    fireEvent.change(within(sec(1)).getByTestId("section-file"), { target: { files: [new File(["x"], "a.webp", { type: "image/webp" })] } });
    expect(await within(sec(1)).findByRole("alert")).toHaveTextContent("Use a PNG or JPEG image");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reorders and removes sections", () => {
    const onChange = draw();
    fireEvent.click(within(sec(1)).getByRole("button", { name: "Move section up" }));
    expect(onChange.mock.calls.at(-1)[0].map((s) => s.key)).toEqual(["s2", "s1"]);
    fireEvent.click(within(sec(0)).getByRole("button", { name: "Remove section" }));
    expect(onChange.mock.calls.at(-1)[0].map((s) => s.key)).toEqual(["s2"]);
  });

  it("is read-only when disabled", () => {
    draw({ disabled: true });
    expect(screen.queryByRole("button", { name: /add text section/i })).toBeNull();
    expect(within(sec(0)).getByLabelText("Section title")).toBeDisabled();
  });
});
```

`web/src/pages/Sales/Quotations/builder/SectionsEditor.jsx`:

```jsx
import { useRef, useState } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ArrowDown, ArrowUp, ImagePlus, Images, Trash2, Type } from "lucide-react";
import { Button, IconButton, TextInput } from "../../../../components/ui";
import RichTextEditor from "../../../../components/ui/RichTextEditor";

let seq = 0;
const key = () => `sec${++seq}`;

/**
 * The user's own appended sections (spec decision 5: a fixed layout, plus
 * sections they add at the end). Two kinds: formatted text, or a grid of
 * captioned pictures. Nothing can be moved around the page — only ordered
 * among themselves.
 */
export default function SectionsEditor({ sections, images = {}, disabled = false, onChange, onUploadPicture }) {
  const theme = useTheme();
  const p = theme.tokens;
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const inputs = useRef({}); // one hidden file input per picture section, by section key

  const patch = (i, next) => onChange(sections.map((s, j) => (j === i ? { ...s, ...next } : s)));
  const move = (i, d) => { const next = [...sections]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };

  const upload = async (i, file) => {
    setBusy(i); setErrors((e) => ({ ...e, [i]: null }));
    try {
      const { id } = await onUploadPicture(file);
      patch(i, { items: [...(sections[i].items ?? []), { attachmentId: id, caption: "" }] });
    } catch (err) {
      setErrors((e) => ({ ...e, [i]: err.message }));
    } finally { setBusy(null); }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {sections.map((s, i) => (
        <Box key={s.key} data-testid="quote-section" sx={{ border: `1px solid ${p.border.default}`, borderRadius: `${theme.radii.md}px`, p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
            <Box sx={{ flex: 1 }}><TextInput size="sm" label="Section title" value={s.title ?? ""} disabled={disabled} onChange={(e) => patch(i, { title: e.target.value })} /></Box>
            {!disabled && (
              <Box sx={{ display: "flex" }}>
                <IconButton size="sm" aria-label="Move section up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></IconButton>
                <IconButton size="sm" aria-label="Move section down" disabled={i === sections.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></IconButton>
                <IconButton size="sm" variant="destructive" aria-label="Remove section" onClick={() => onChange(sections.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>
              </Box>
            )}
          </Box>

          {s.type === "images" ? (
            <>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 1 }}>
                {(s.items ?? []).map((im, k) => (
                  <Box key={`${im.attachmentId}-${k}`} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    <Box sx={{ height: 90, borderRadius: `${theme.radii.sm}px`, overflow: "hidden", background: p.surface.subtle }}>
                      {images[im.attachmentId] && <img src={images[im.attachmentId]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                    </Box>
                    <TextInput size="sm" aria-label={`Caption ${k + 1}`} placeholder="Caption" value={im.caption ?? ""} disabled={disabled}
                      onChange={(e) => patch(i, { items: s.items.map((x, m) => (m === k ? { ...x, caption: e.target.value } : x)) })} />
                    {!disabled && <Button size="sm" variant="ghost" aria-label={`Remove picture ${k + 1}`} onClick={() => patch(i, { items: s.items.filter((_, m) => m !== k) })}>Remove</Button>}
                  </Box>
                ))}
              </Box>
              {!disabled && (
                <Box>
                  <input ref={(el) => { inputs.current[s.key] = el; }} type="file" accept="image/png,image/jpeg" hidden data-testid="section-file"
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(i, f); }} />
                  <Button size="sm" variant="tonal" leftIcon={<ImagePlus size={13} />} loading={busy === i}
                    onClick={() => inputs.current[s.key]?.click()}>Add picture</Button>
                </Box>
              )}
              {errors[i] && <Box role="alert" sx={{ fontSize: 12, color: p.error.main }}>{errors[i]}</Box>}
            </>
          ) : (
            <RichTextEditor label="Section text" value={s.body ?? ""} disabled={disabled} minHeight={90} onChange={(body) => patch(i, { body })} data-testid={`section-text-${i}`} />
          )}
        </Box>
      ))}
      {!disabled && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button size="sm" variant="tonal" leftIcon={<Type size={14} />} onClick={() => onChange([...sections, { key: key(), type: "text", title: "", body: "" }])}>Add text section</Button>
          <Button size="sm" variant="tonal" leftIcon={<Images size={14} />} onClick={() => onChange([...sections, { key: key(), type: "images", title: "", items: [] }])}>Add picture section</Button>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 6: Green, with coverage — one file per run**

```bash
cd web && pnpm exec vitest run src/pages/Sales/Quotations/quoteForm.test.js --coverage --coverage.include=src/pages/Sales/Quotations/quoteForm.js
cd web && pnpm exec vitest run src/pages/Sales/Quotations/useQuoteImages.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/useQuoteImages.js
cd web && pnpm exec vitest run src/pages/Sales/Quotations/builder/ImageSlot.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/builder/ImageSlot.jsx
cd web && pnpm exec vitest run src/pages/Sales/Quotations/builder/LinesEditor.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/builder/LinesEditor.jsx
cd web && pnpm exec vitest run src/pages/Sales/Quotations/builder/SectionsEditor.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/builder/SectionsEditor.jsx
```
Expected: all PASS; every source file ≥ 80 %. `quoteForm` is the verified one — if *its* tests fail, you mistyped something; the three components are new code written against the `ui/` props as read on 2026-09-18, so a prop-shape mismatch there is yours to fix (max 3 attempts, then BLOCKED with the error).

- [ ] **Step 7: Stop and report.** Do not stage or commit.

---

### Task 15B: `QuotationBuilder` page + route

**Files (under `web/src/pages/Sales/Quotations/`):**
- Create: `builder/PdfPreview.jsx` + `builder/PdfPreview.test.jsx`, `builder/LookSection.jsx`, `builder/PartySections.jsx`
- Create: `QuotationBuilder.jsx` + `QuotationBuilder.test.jsx`
- Modify: `web/src/App.jsx` (lazy import + route `/sales/quotations/:quotationId`)

**Interfaces:**
- Consumes: everything from Tasks 11–15A; `api/quotationQueries`; `useApiQuery` / `useApiMutation`; `useAuthStore` (`user.IsAdmin`, `companyName`); `pages/Support/RemarksModal` (generic remarks dialog — reused, not copied).
- Produces: the page at `/sales/quotations/:quotationId`. It is **lazy-loaded**, and it is the only importer of `@react-pdf/renderer`, so the PDF engine costs the rest of the app nothing.

**What the page does, by status** (the server enforces every one of these; the page only declines to offer what would be refused):

| Status | Editable | Header actions |
|---|---|---|
| `draft` on an active lead | yes | Save · Finalise (disabled with reasons while `finaliseBlockers` is non-empty) · Delete draft |
| `final` | no | Download PDF · Revise · Accepted · Rejected |
| `accepted` / `rejected` / `superseded` / `unused` | no | Download PDF · Revise (only `rejected` / `unused`, and only on an active lead) |

**The PDF a user downloads is the blob already on screen** — `usePdfPreview`'s `instance.blob` — not a second render. For a non-draft, the numbers inside it come from `amountsFromServer` (the SP's stored columns), never from `quoteMath`.

- [ ] **Step 1: The three small presentational pieces**

`web/src/pages/Sales/Quotations/builder/PdfPreview.jsx`:

```jsx
import { useTheme } from "@mui/material/styles";
import { usePdfPreview } from "../usePdfPreview";

/**
 * The right half of the builder: the real PDF, in an <iframe>. A component of
 * its own because usePdfPreview is a hook — the page can only call it once the
 * document exists, and a hook cannot be called conditionally.
 * `onReady(blob)` hands the current file up so Download saves exactly what is
 * on screen.
 */
export default function PdfPreview({ Component, doc, onReady }) {
  const theme = useTheme();
  const p = theme.tokens;
  const instance = usePdfPreview(Component, doc);
  if (instance.blob) onReady?.(instance.blob);

  return (
    <div data-testid="pdf-preview" style={{ position: "relative", height: "100%", borderRadius: theme.radii.md, overflow: "hidden", border: `1px solid ${p.border.default}`, background: p.surface.subtle }}>
      {instance.error ? (
        <div role="alert" style={{ padding: 16, fontSize: 13, color: p.error.main }}>The preview could not be drawn. Your changes are safe — try again in a moment.</div>
      ) : instance.url ? (
        <iframe title="Quotation preview" src={`${instance.url}#toolbar=0&navpanes=0`} style={{ width: "100%", height: "100%", border: "none" }} />
      ) : (
        <div style={{ padding: 16, fontSize: 13, color: p.text.tertiary }}>Drawing the preview…</div>
      )}
    </div>
  );
}
```

> `onReady` is called during render. That is deliberate and safe **only because** the page stores the blob in a `useRef` (no state update → no re-render loop). If you change the page to keep it in state, move this call into a `useEffect`.

The page test mocks this component away, so it gets one test of its own — the
real component over a stubbed hook, covering its three states:

`web/src/pages/Sales/Quotations/builder/PdfPreview.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

// The PDF engine cannot run in jsdom. The hook has its own tests (Task 14);
// here it is a dial, so each state this component draws can be rendered.
vi.mock("../usePdfPreview", () => ({ usePdfPreview: vi.fn() }));

import { usePdfPreview } from "../usePdfPreview";
import PdfPreview from "./PdfPreview";
import renderWithProviders from "../../../../test/renderWithProviders";

const Template = () => null;
const show = (instance) => {
  usePdfPreview.mockReturnValue({ url: null, blob: null, loading: false, error: null, ...instance });
  const onReady = vi.fn();
  renderWithProviders(<PdfPreview Component={Template} doc={{ quoteNo: "QT-2627-0042" }} onReady={onReady} />);
  return onReady;
};

beforeEach(() => vi.clearAllMocks());

describe("PdfPreview", () => {
  it("frames the drawn PDF and hands the blob up, so Download saves what is on screen", () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    const onReady = show({ url: "blob:preview", blob });
    expect(screen.getByTitle("Quotation preview")).toHaveAttribute("src", "blob:preview#toolbar=0&navpanes=0");
    expect(onReady).toHaveBeenCalledWith(blob);
  });

  it("says it is drawing while there is nothing to show yet", () => {
    const onReady = show({});
    expect(screen.queryByTitle("Quotation preview")).toBeNull();
    expect(screen.getByText(/drawing the preview/i)).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });

  // A failed preview must never read as "your work is gone".
  it("reassures instead of blaming when the draw fails, and shows no stale frame", () => {
    show({ error: new Error("boom"), url: "blob:stale" });
    expect(screen.getByRole("alert")).toHaveTextContent(/changes are safe/i);
    expect(screen.queryByTitle("Quotation preview")).toBeNull();
  });
});
```

`web/src/pages/Sales/Quotations/builder/LookSection.jsx`:

```jsx
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { TEMPLATES } from "../templates";
import { ACCENTS } from "../quoteForm";

/** Which template, and which accent colour. This is THEIR document, so it is THEIR colour — nothing to do with how our app is branded. */
export default function LookSection({ templateCode, accent, disabled = false, onTemplate, onAccent }) {
  const theme = useTheme();
  const p = theme.tokens;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box role="radiogroup" aria-label="Template" sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
        {TEMPLATES.map((t) => {
          const on = t.code === templateCode;
          return (
            <button key={t.code} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onTemplate(t.code)} data-testid={`template-${t.code}`}
              style={{ textAlign: "left", padding: 10, borderRadius: theme.radii.md, cursor: disabled ? "default" : "pointer", background: on ? p.primary.subtle : p.surface.card,
                border: `1.5px solid ${on ? p.primary.main : p.border.default}`, color: p.text.primary, fontFamily: p.fontFamilies.sans }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: p.text.tertiary, marginTop: 2 }}>{t.blurb}</div>
            </button>
          );
        })}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary, marginRight: 4 }}>Accent</span>
        {ACCENTS.map((c) => (
          <button key={c} type="button" aria-label={`Accent ${c}`} aria-pressed={accent === c} disabled={disabled} onClick={() => onAccent(c)}
            style={{ width: 24, height: 24, borderRadius: 999, background: c, cursor: disabled ? "default" : "pointer", border: accent === c ? `2px solid ${p.text.primary}` : `1px solid ${p.border.strong}` }} />
        ))}
        {/* The platform's own picker for "any colour" — no colour-picker dependency. */}
        <input type="color" aria-label="Custom accent" value={accent} disabled={disabled} onChange={(e) => onAccent(e.target.value)}
          style={{ width: 30, height: 26, padding: 0, border: "none", background: "none" }} />
      </Box>
    </Box>
  );
}
```

`web/src/pages/Sales/Quotations/builder/PartySections.jsx`:

```jsx
import { Box } from "@mui/material";
import { Combobox, FormGrid, FormGridSpan, MobileInput, TextArea, TextInput } from "../../../../components/ui";
import { STATE_OPTIONS, isValidGstin, stateFromGstin } from "../gst";

const byValue = (v) => STATE_OPTIONS.find((o) => o.value === v) ?? null;

/** The seller's block. With a valid GSTIN the state is read off it and the picker locks — it is not a second thing to get wrong. */
export function CompanySection({ value, disabled = false, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const derived = stateFromGstin(value.gstin);
  const gstinError = value.gstin && !isValidGstin(value.gstin) ? "15 characters, e.g. 24ABCDE1234F1Z5" : undefined;
  return (
    <FormGrid min={200} data-testid="company-section">
      <TextInput label="Company name" required value={value.name} onChange={set("name")} disabled={disabled} />
      <TextInput label="GSTIN" value={value.gstin} onChange={set("gstin")} disabled={disabled} error={gstinError}
        hint={value.gstin ? undefined : "Leave empty if you are not GST-registered — no tax will be charged"} />
      <Combobox label="State" options={STATE_OPTIONS} value={byValue(derived ?? value.stateCode)} disabled={disabled || Boolean(derived)}
        onChange={(o) => onChange({ ...value, stateCode: o?.value ?? "" })} data-testid="company-state" />
      <TextInput label="Phone" value={value.phone} onChange={set("phone")} disabled={disabled} />
      <TextInput label="Email" value={value.email} onChange={set("email")} disabled={disabled} inputMode="email" />
      <TextInput label="Website" value={value.website} onChange={set("website")} disabled={disabled} />
      <FormGridSpan><TextInput label="Address" value={value.address} onChange={set("address")} disabled={disabled} /></FormGridSpan>
      <TextInput label="City" value={value.city} onChange={set("city")} disabled={disabled} />
      <TextInput label="Pincode" value={value.pincode} onChange={set("pincode")} disabled={disabled} inputMode="numeric" />
      <TextInput label="Signatory" value={value.signatory} onChange={set("signatory")} disabled={disabled} placeholder="Who signs" />
      <FormGridSpan><TextArea label="Bank details" rows={2} value={value.bank} onChange={set("bank")} disabled={disabled} /></FormGridSpan>
    </FormGrid>
  );
}

/** Who the quotation is for. Place of supply decides CGST+SGST vs IGST. */
export function CustomerSection({ value, taxed, disabled = false, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const gstinError = value.ToGSTIN && !isValidGstin(value.ToGSTIN) ? "15 characters, e.g. 27AAAAA0000A1Z5" : undefined;
  return (
    <FormGrid min={200} data-testid="customer-section">
      <TextInput label="Customer name" required value={value.ToName} onChange={set("ToName")} disabled={disabled} />
      <TextInput label="Company" value={value.ToCompany} onChange={set("ToCompany")} disabled={disabled} />
      <MobileInput label="Mobile" value={value.ToMobile} onChange={(v) => onChange({ ...value, ToMobile: v })} disabled={disabled} />
      <TextInput label="Email" value={value.ToEmail} onChange={set("ToEmail")} disabled={disabled} inputMode="email" />
      <FormGridSpan><TextInput label="Address" value={value.ToAddress} onChange={set("ToAddress")} disabled={disabled} /></FormGridSpan>
      <TextInput label="City" value={value.ToCity} onChange={set("ToCity")} disabled={disabled} />
      <TextInput label="Pincode" value={value.ToPincode} onChange={set("ToPincode")} disabled={disabled} inputMode="numeric" />
      <Box>
        <Combobox label="Place of supply" required={taxed} options={STATE_OPTIONS} value={byValue(value.ToStateCode)} disabled={disabled}
          hint={taxed ? "Same state as yours → CGST + SGST. Another state → IGST." : undefined}
          onChange={(o) => onChange({ ...value, ToStateCode: o?.value ?? "" })} data-testid="place-of-supply" />
      </Box>
      <TextInput label="Customer GSTIN" value={value.ToGSTIN} onChange={set("ToGSTIN")} disabled={disabled} error={gstinError} />
    </FormGrid>
  );
}
```

- [ ] **Step 2: The page test**

`web/src/pages/Sales/Quotations/QuotationBuilder.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Routes, Route } from "react-router-dom";

// The PDF engine cannot run in jsdom; the preview has its own tests. Here it
// reports what it was handed, which is exactly what this page is responsible for.
vi.mock("./builder/PdfPreview", () => ({
  __esModule: true,
  default: ({ doc, onReady }) => { onReady?.(new Blob(["pdf"], { type: "application/pdf" })); return <div data-testid="pdf-preview">{doc.quoteNo}|{doc.grandTotalText}|{doc.company.name}</div>; },
}));
vi.mock("./pdf/fonts", () => ({ registerFonts: vi.fn(), FONT_FAMILIES: [] }));
vi.mock("./pdf/fontSources", () => ({ FONT_SOURCES: {} }));
vi.mock("../../../components/ui/RichTextEditor", () => ({
  __esModule: true,
  default: ({ label, value, onChange, disabled }) => <textarea aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("../../../api/attachmentQueries", () => ({ fetchAttachmentBlob: vi.fn(async () => ({ blob: new Blob(["x"], { type: "image/png" }), url: "blob:x" })), uploadAttachment: vi.fn() }));

import QuotationBuilder from "./QuotationBuilder";
import useAuthStore from "../../../stores/useAuthStore";
import { server } from "../../../test/mocks/server";
import renderWithProviders from "../../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const refuse = (code, message) => HttpResponse.json({ success: false, message, responseCode: code }, { status: code });

const COMPANY = { name: "Solar Care", gstin: "24ABCDE1234F1Z5", stateCode: "24", logoAttachmentId: 12, headerAttachmentId: null, showLogo: true, showHeader: false, accent: "#1e3a8a" };
const quotation = (over = {}) => ({
  Id: 4, LeadId: 9, LeadName: "Ramesh Patel", LeadStatusCode: "qualified", Status: "draft", QuoteNo: null, Revision: 1, RootId: 4, TemplateCode: "modern",
  QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "Rooftop", ToName: "Ramesh Patel", ToStateCode: "24", ToMobile: "9825012345",
  SellerGSTIN: "24ABCDE1234F1Z5", SellerStateCode: "24", Company: COMPANY, Content: { intro: "<p>Dear Ramesh ji</p>", terms: "", notes: "", sections: [] },
  SubTotal: 280000, DiscountTotal: 10000, TaxableTotal: 270000, CgstTotal: 16200, SgstTotal: 16200, IgstTotal: 0, RoundOff: 0, GrandTotal: 302400, ...over,
});
const LINES = [{ Id: 1, ProductId: 7, Description: "5 kW Rooftop", HSNCode: "8541", Qty: 1, Unit: "Set", Rate: 280000, DiscountType: "amt", DiscountValue: 10000, TaxPct: 12,
  GrossAmt: 280000, DiscountAmt: 10000, TaxableAmt: 270000, CgstAmt: 16200, SgstAmt: 16200, IgstAmt: 0, LineTotal: 302400 }];

function mocks({ q = quotation(), profile = { Id: 3, BranchId: 2, IsSet: true }, cap = {}, on = {} } = {}) {
  server.use(
    http.post("*/api/quotations/fetchQuotationDetail", () => json({ quotation: q, lines: LINES, revisions: [{ Id: 4, Revision: 1, QuoteNo: q.QuoteNo, Status: q.Status }] })),
    http.post("*/api/quotations/ensureQuoteProfile", () => json({ profile })),
    http.post("*/api/products/fetchProducts", () => json({ products: [], pagination: {} })),
    http.post("*/api/quotations/saveQuotation", async ({ request }) => { cap.save = await request.json(); return on.save?.() ?? json({ Id: 4, ResponseCode: 200 }); }),
    http.post("*/api/quotations/saveQuoteProfile", async ({ request }) => { cap.profile = await request.json(); return json({ Id: 3 }); }),
    http.post("*/api/quotations/finaliseQuotation", async ({ request }) => { cap.finalise = await request.json(); return on.finalise?.() ?? json({ Id: 4, QuoteNo: "QT-2627-0042" }); }),
    http.post("*/api/quotations/reviseQuotation", async ({ request }) => { cap.revise = await request.json(); return json({ Id: 5 }); }),
    http.post("*/api/quotations/rejectQuotation", async ({ request }) => { cap.reject = await request.json(); return json({ Id: 4 }); }),
    http.post("*/api/quotations/deleteQuotation", async ({ request }) => { cap.remove = await request.json(); return json({ Id: 4 }); }),
    http.post("*/api/leads/convertLead", async ({ request }) => { cap.convert = await request.json(); return json({ Id: 9, CustomerId: 31, WonValue: 270000 }); }),
  );
  return cap;
}

const open = () => renderWithProviders(
  <Routes>
    <Route path="/sales/quotations/:quotationId" element={<QuotationBuilder />} />
    <Route path="/sales/leads/:leadId" element={<div data-testid="lead-page" />} />
  </Routes>,
  { route: "/sales/quotations/4" },
);

beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1, IsAdmin: false }, UserId: 1, companyName: "Solar Care", API_BASE_URL: "https://shadowcodes.in/CRM" }));

describe("QuotationBuilder — a draft", () => {
  it("loads into the form and previews the live numbers", async () => {
    mocks();
    open();
    expect(await screen.findByDisplayValue("Ramesh Patel")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-preview")).toHaveTextContent("DRAFT|₹3,02,400.00|Solar Care");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled(); // nothing changed yet
  });

  it("recomputes the preview as a line changes, and saves the form — never a total", async () => {
    const cap = mocks();
    open();
    fireEvent.change(await screen.findByLabelText("Rate"), { target: { value: "300000" } });
    expect(screen.getByTestId("pdf-preview")).toHaveTextContent("₹3,24,800.00");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({ Id: 4, LeadId: 9, TemplateCode: "modern", ToName: "Ramesh Patel" });
    expect(cap.save.Lines[0]).toEqual({ productId: 7, description: "5 kW Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: "300000", discountType: "amt", discountValue: 10000, taxPct: 12 });
    expect(JSON.stringify(cap.save)).not.toMatch(/GrandTotal|LineTotal|"key"/);
  });

  // "The template remembers": the first person to fill a branch's letterhead
  // saves it for everyone after them, without being asked.
  it("remembers the company block the first time a branch fills it in", async () => {
    const cap = mocks({ profile: { Id: 3, BranchId: 2, IsSet: false } });
    open();
    fireEvent.change(await screen.findByLabelText("Phone"), { target: { value: "079 2658" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.profile).toBeTruthy());
    expect(cap.profile).toMatchObject({ LeadId: 9, CompanyName: "Solar Care", Phone: "079 2658", DefaultTemplate: "modern" });
  });

  it("does not touch a saved letterhead on an ordinary save, and hides the admin button from a non-admin", async () => {
    const cap = mocks();
    open();
    fireEvent.change(await screen.findByLabelText("Phone"), { target: { value: "079" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.profile).toBeUndefined();
    expect(screen.queryByRole("button", { name: /save as our default/i })).toBeNull();
  });

  it("lets an admin overwrite the saved letterhead, explicitly", async () => {
    useAuthStore.setState({ user: { UserId: 1, IsAdmin: true } });
    const cap = mocks();
    open();
    fireEvent.click(await screen.findByRole("button", { name: /save as our default/i }));
    await waitFor(() => expect(cap.profile).toMatchObject({ LeadId: 9, CompanyName: "Solar Care" }));
  });

  // Only the builder knows the art on the page is OUR placeholder.
  it("will not finalise while the sample logo is showing, and says why", async () => {
    mocks({ q: quotation({ Company: { ...COMPANY, logoAttachmentId: null } }) });
    open();
    const btn = await screen.findByRole("button", { name: /finalise/i });
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("finalise-blockers")).toHaveTextContent("Replace the sample logo, or remove it");
  });

  it("saves unsaved edits first, then finalises", async () => {
    const cap = mocks();
    open();
    fireEvent.change(await screen.findByLabelText("Rate"), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: /finalise/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, finalise/i }));
    await waitFor(() => expect(cap.finalise).toEqual({ QuotationId: 4 }));
    expect(cap.save.Lines[0].rate).toBe("300000");
  });

  it("shows the server's refusal and stays a draft", async () => {
    mocks({ on: { finalise: () => refuse(400, "Choose the customer's state — GST depends on it") } });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /finalise/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, finalise/i }));
    expect(await screen.findByText(/GST depends on it/)).toBeInTheDocument();
  });

  it("deletes the draft and goes back to the lead", async () => {
    const cap = mocks();
    open();
    fireEvent.click(await screen.findByRole("button", { name: /delete draft/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(cap.remove).toEqual({ QuotationId: 4 }));
    expect(await screen.findByTestId("lead-page")).toBeInTheDocument();
  });
});

describe("QuotationBuilder — issued", () => {
  const final = quotation({ Status: "final", QuoteNo: "QT-2627-0042" });

  it("is read-only and prints the SERVER's numbers", async () => {
    mocks({ q: quotation({ Status: "final", QuoteNo: "QT-2627-0042", GrandTotal: 302401 }) }); // deliberately not what quoteMath would give
    open();
    expect(await screen.findByDisplayValue("Ramesh Patel")).toBeDisabled();
    expect(screen.getByTestId("pdf-preview")).toHaveTextContent("QT-2627-0042|₹3,02,401.00");
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add line/i })).toBeNull();
  });

  it("downloads the PDF that is on screen, named for the customer", async () => {
    mocks({ q: final });
    URL.createObjectURL = vi.fn(() => "blob:dl"); URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { click.file = this.download; });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /download pdf/i }));
    expect(click.file).toBe("QT-2627-0042 - Ramesh Patel.pdf");
    click.mockRestore();
  });

  it("accepts: converts the lead through this quotation", async () => {
    const cap = mocks({ q: final });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /accepted/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, they accepted/i }));
    await waitFor(() => expect(cap.convert).toEqual({ LeadId: 9, QuotationId: 4 }));
  });

  it("rejects with optional remarks", async () => {
    const cap = mocks({ q: final });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /rejected/i }));
    const modal = await screen.findByTestId("remarks-modal");
    fireEvent.change(within(modal).getByLabelText(/remarks/i), { target: { value: "too expensive" } });
    fireEvent.click(within(modal).getByRole("button", { name: /mark rejected/i }));
    await waitFor(() => expect(cap.reject).toEqual({ QuotationId: 4, Remarks: "too expensive" }));
  });

  it("revises into a new draft and opens it", async () => {
    const cap = mocks({ q: final });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /revise/i }));
    await waitFor(() => expect(cap.revise).toEqual({ QuotationId: 4 }));
  });

  it("offers no Revise on a closed lead — its quotations are history", async () => {
    mocks({ q: quotation({ Status: "unused", QuoteNo: "QT-2627-0042", LeadStatusCode: "converted" }) });
    open();
    await screen.findByRole("button", { name: /download pdf/i });
    expect(screen.queryByRole("button", { name: /revise/i })).toBeNull();
  });
});

describe("QuotationBuilder — not there", () => {
  it("says so instead of spinning", async () => {
    server.use(http.post("*/api/quotations/fetchQuotationDetail", () => refuse(404, "Quotation not found")));
    open();
    expect(await screen.findByText(/quotation not found/i)).toBeInTheDocument();
  });
});
```

Run: `cd web && pnpm exec vitest run src/pages/Sales/Quotations/QuotationBuilder.test.jsx` — expected FAIL (module not found).

- [ ] **Step 3: The page**

`web/src/pages/Sales/Quotations/QuotationBuilder.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useParams } from "react-router-dom";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, CircleX, CopyPlus, Download, FileCheck2, Save, Trash2 } from "lucide-react";

import { Button, Card, Chip, DateField, EmptyState, Modal, PageHeader, Skeleton, TextInput } from "../../../components/ui";
import RichTextEditor from "../../../components/ui/RichTextEditor";
import RemarksModal from "../../Support/RemarksModal";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import useAuthStore from "../../../stores/useAuthStore";
import { QUOTATION_ENDPOINTS } from "../../../api/quotationQueries";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import sampleLogo from "../../../assets/quote/sample-logo.png";
import sampleHeader from "../../../assets/quote/sample-header.png";

import { isActiveCode } from "../leadStatus";
import { amountsFromServer, buildQuoteDoc, money } from "./buildQuoteDoc";
import { amountsOf, finaliseBlockers, profileFromForm, toBody, toForm } from "./quoteForm";
import { imageIdsOf, uploadImage, useQuoteImages } from "./useQuoteImages";
import { templateByCode } from "./templates";
import { registerFonts } from "./pdf/fonts";
import { FONT_SOURCES } from "./pdf/fontSources";
import ImageSlot from "./builder/ImageSlot";
import LinesEditor from "./builder/LinesEditor";
import LookSection from "./builder/LookSection";
import { CompanySection, CustomerSection } from "./builder/PartySections";
import PdfPreview from "./builder/PdfPreview";
import SectionsEditor from "./builder/SectionsEditor";

registerFonts(FONT_SOURCES); // idempotent; this lazy chunk is the only place the PDF engine loads

const SAMPLES = { logo: sampleLogo, header: sampleHeader };
const STATUS_TONE = { draft: "warning", final: "primary", accepted: "success", rejected: "error", superseded: "default", unused: "default" };
const STATUS_TEXT = { draft: "Draft", final: "Final", accepted: "Accepted", rejected: "Rejected", superseded: "Superseded", unused: "Not used" };

function Section({ title, hint, children, action }) {
  return (
    <Card padding="md">
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1, mb: 1.5 }}>
        <Box>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
          {hint && <Box sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>{hint}</Box>}
        </Box>
        {action}
      </Box>
      {children}
    </Card>
  );
}

function Confirm({ open, title, body, yes, busy, onYes, onClose }) {
  return (
    <Modal open={open} onClose={() => !busy && onClose()} size="sm">
      <Modal.Header title={title} onClose={() => !busy && onClose()} />
      <Modal.Body><Box sx={{ fontSize: 14 }}>{body}</Box></Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={onYes} loading={busy}>{yes}</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default function QuotationBuilder() {
  const id = Number(useParams().quotationId);
  const navigate = useNavigate();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.IsAdmin) || false;

  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [ask, setAsk] = useState(null);          // 'finalise' | 'delete' | 'accept' | 'reject'
  const [uploading, setUploading] = useState(null);
  const [imageError, setImageError] = useState("");
  const pdfBlob = useRef(null);                  // a ref, not state: PdfPreview reports it during render

  const { data, isLoading, error, refetch } = useApiQuery({
    queryKey: ["quotation", id], endpoint: QUOTATION_ENDPOINTS.fetchQuotationDetail, params: { QuotationId: id },
    enabled: Boolean(id), staleTime: 0, showErrorMessage: false,
  });
  const quotation = data?.quotation ?? null;
  const leadId = quotation?.LeadId;

  const { data: profileData, refetch: refetchProfile } = useApiQuery({
    queryKey: ["quote-profile", leadId], endpoint: QUOTATION_ENDPOINTS.ensureQuoteProfile, params: { LeadId: leadId },
    enabled: Boolean(leadId), showErrorMessage: false,
  });
  const profile = profileData?.profile ?? null;
  const { data: productsData } = useApiQuery({
    queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, showErrorMessage: false,
  });

  // The server's row is the form's starting point — on load, and again after
  // every save/finalise (refetch), so what is on screen is what is stored.
  useEffect(() => { if (data?.quotation) { setForm(toForm(data)); setDirty(false); } }, [data]);

  const editable = quotation?.Status === "draft" && isActiveCode(quotation?.LeadStatusCode);
  const leadActive = isActiveCode(quotation?.LeadStatusCode);
  const update = useCallback((patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); }, []);

  const ids = useMemo(() => imageIdsOf(form), [form]);
  const { images, prime } = useQuoteImages(ids);

  // A draft previews quoteMath's numbers as they type. Anything issued prints
  // the SP's stored numbers — the PDF of a final quotation never depends on
  // client arithmetic.
  const amounts = useMemo(() => (!form ? null : editable ? amountsOf(form) : amountsFromServer(quotation, data?.lines)), [form, editable, quotation, data]);
  const doc = useMemo(() => (!form ? null : buildQuoteDoc({
    header: { ...form.To, Status: quotation.Status, QuoteNo: quotation.QuoteNo, QuoteDate: form.QuoteDate, ValidTill: form.ValidTill, Subject: form.Subject },
    company: form.Company, content: form.Content, items: form.Lines, amounts, images, samples: SAMPLES,
  })), [form, quotation, amounts, images]);
  const blockers = useMemo(() => (form && editable ? finaliseBlockers(form) : []), [form, editable]);

  const invalidate = [["quotation", id], ["quotations"], ["lead-detail", leadId], ["leads"]];
  const save = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.saveQuotation, successMessage: "Quotation saved", invalidateQueries: [["quotations"]] });
  const saveProfile = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.saveQuoteProfile, successMessage: "Saved for future quotations", invalidateQueries: [["quote-profile", leadId]] });
  const rememberQuietly = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.saveQuoteProfile, showSuccessMessage: false, showErrorMessage: false });
  const finalise = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.finaliseQuotation, successMessage: "Quotation finalised", invalidateQueries: invalidate });
  const revise = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.reviseQuotation, successMessage: "Revision started", invalidateQueries: invalidate });
  const reject = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.rejectQuotation, successMessage: "Marked rejected", invalidateQueries: invalidate });
  const remove = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.deleteQuotation, successMessage: "Draft deleted", invalidateQueries: invalidate });
  const accept = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.convertLead, successMessage: "Accepted — the lead is won", invalidateQueries: invalidate });

  const doSave = async () => {
    await save.mutateAsync(toBody(form, { id, leadId }));
    // "The template remembers": the first fill of a branch's letterhead is saved
    // for everyone after, unasked. Once set, only an admin changes it — and only
    // by pressing the button that says so.
    if (profile && !profile.IsSet && form.Company.name.trim()) {
      await rememberQuietly.mutateAsync(profileFromForm(form, leadId)).then(() => refetchProfile()).catch(() => {});
    }
    await refetch();
  };

  const run = (fn) => async (...args) => { try { await fn(...args); } catch { /* useApiMutation already showed the server's message */ } };

  const onFinalise = run(async () => { if (dirty) await doSave(); await finalise.mutateAsync({ QuotationId: id }); setAsk(null); await refetch(); });
  const onDelete = run(async () => { await remove.mutateAsync({ QuotationId: id }); navigate(`/sales/leads/${leadId}`); });
  const onAccept = run(async () => { await accept.mutateAsync({ LeadId: leadId, QuotationId: id }); setAsk(null); await refetch(); });
  const onReject = run(async (remarks) => { await reject.mutateAsync({ QuotationId: id, Remarks: remarks || null }); setAsk(null); await refetch(); });
  const onRevise = run(async () => { const res = await revise.mutateAsync({ QuotationId: id }); queryClient.removeQueries({ queryKey: ["quotation", res.Id] }); navigate(`/sales/quotations/${res.Id}`); });

  const onDownload = () => {
    if (!pdfBlob.current) return;
    const url = URL.createObjectURL(pdfBlob.current);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${quotation.QuoteNo || "Quotation"} - ${form.To.ToName || "customer"}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // Letterhead pictures hang off the branch PROFILE (company-wide readable,
  // never deleted — issued quotations keep drawing them). A section's pictures
  // hang off THIS quotation.
  const uploadLetterhead = (slot) => async (file) => {
    setUploading(slot); setImageError("");
    try {
      const { id: attachmentId, dataUrl } = await uploadImage({ entity: "quoteprofile", entityId: profile.Id, file });
      prime(attachmentId, dataUrl);
      update({ Company: { ...form.Company, [`${slot}AttachmentId`]: attachmentId, [slot === "logo" ? "showLogo" : "showHeader"]: true } });
    } catch (err) { setImageError(err.message); } finally { setUploading(null); }
  };
  const uploadPicture = async (file) => {
    const { id: attachmentId, dataUrl } = await uploadImage({ entity: "quotation", entityId: id, file });
    prime(attachmentId, dataUrl);
    return { id: attachmentId };
  };

  if (error) return <EmptyState title="Quotation not found" description="It may have been deleted, or it belongs to a lead you cannot see." size="md" />;
  if (isLoading || !form || !doc) return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }} data-testid="quotation-loading">
      <Skeleton variant="text" height={28} width={260} /><Skeleton variant="rect" height={420} />
    </Box>
  );

  const c = form.Company;
  const setCompany = (Company) => update({ Company });
  const setContent = (k) => (v) => update({ Content: { ...form.Content, [k]: v } });
  const title = quotation.QuoteNo || `Draft quotation${quotation.Revision > 1 ? ` · revision ${quotation.Revision}` : ""}`;

  return (
    <Box data-testid="quotation-builder" sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <Helmet><title>PRD Infotech | {title}</title></Helmet>
      <PageHeader
        title={title}
        subtitle={`For ${quotation.LeadName}${quotation.LeadCompany ? ` · ${quotation.LeadCompany}` : ""}`}
        titleSuffix={<Chip label={STATUS_TEXT[quotation.Status] ?? quotation.Status} tone={STATUS_TONE[quotation.Status] ?? "default"} size="sm" data-testid="quote-status-chip" />}
        actions={
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            {/* Not PageHeader's breadcrumb: it renders plain <a href>, which is a full
                page load and ignores the router's /prdcrm/ basename. */}
            <Button variant="text" size="sm" leftIcon={<ArrowLeft size={14} />} onClick={() => navigate(`/sales/leads/${leadId}`)}>Back to lead</Button>
            {editable ? (
              <>
                <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} onClick={() => setAsk("delete")}>Delete draft</Button>
                <Button variant="tonal" size="sm" leftIcon={<Save size={14} />} onClick={run(doSave)} disabled={!dirty} loading={save.isPending}>Save</Button>
                <Button variant="primary" size="sm" leftIcon={<FileCheck2 size={14} />} onClick={() => setAsk("finalise")} disabled={blockers.length > 0}>Finalise</Button>
              </>
            ) : (
              <>
                <Button variant="tonal" size="sm" leftIcon={<Download size={14} />} onClick={onDownload}>Download PDF</Button>
                {leadActive && ["final", "rejected", "unused"].includes(quotation.Status) && (
                  <Button variant="tonal" size="sm" leftIcon={<CopyPlus size={14} />} onClick={onRevise} loading={revise.isPending}>Revise</Button>
                )}
                {quotation.Status === "final" && leadActive && (
                  <>
                    <Button variant="ghost" size="sm" leftIcon={<CircleX size={14} />} onClick={() => setAsk("reject")}>Rejected</Button>
                    <Button variant="primary" size="sm" leftIcon={<CircleCheck size={14} />} onClick={() => setAsk("accept")}>Accepted</Button>
                  </>
                )}
              </>
            )}
          </Box>
        }
      />

      {editable && blockers.length > 0 && (
        <Box data-testid="finalise-blockers" sx={{ mt: 1, fontSize: 13, color: theme.tokens.warning.hover }}>
          Before you can finalise: {blockers.join(" · ")}
        </Box>
      )}
      {!editable && quotation.CloseRemarks && <Box sx={{ mt: 1, fontSize: 13, color: "text.secondary" }}>{quotation.CloseRemarks}</Box>}

      <Box sx={{ mt: 2, display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 560px) minmax(0, 1fr)" } }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Section title="Look">
            <LookSection templateCode={form.TemplateCode} accent={c.accent} disabled={!editable}
              onTemplate={(TemplateCode) => update({ TemplateCode })} onAccent={(accent) => setCompany({ ...c, accent })} />
          </Section>

          <Section title="Your company" hint="Filled in once per branch — it is remembered for the next quotation."
            action={editable && isAdmin && profile?.IsSet ? (
              <Button size="sm" variant="ghost" loading={saveProfile.isPending} onClick={run(async () => { await saveProfile.mutateAsync(profileFromForm(form, leadId)); })}>Save as our default</Button>
            ) : null}>
            <Box sx={{ display: "grid", gridTemplateColumns: "88px minmax(0, 1fr)", gap: 2, mb: 2 }}>
              <ImageSlot label="Logo" data-testid="logo-slot" src={doc.logoSrc} isSample={!c.logoAttachmentId} hidden={c.showLogo === false} disabled={!editable} busy={uploading === "logo"}
                onUpload={uploadLetterhead("logo")} onRemove={() => setCompany({ ...c, showLogo: false })} onRestore={() => setCompany({ ...c, showLogo: true })} />
              <ImageSlot label="Banner" wide data-testid="header-slot" src={doc.headerSrc} isSample={!c.headerAttachmentId} hidden={c.showHeader === false} disabled={!editable} busy={uploading === "header"}
                onUpload={uploadLetterhead("header")} onRemove={() => setCompany({ ...c, showHeader: false })} onRestore={() => setCompany({ ...c, showHeader: true })} />
            </Box>
            {imageError && <Box role="alert" sx={{ fontSize: 12, color: theme.tokens.error.main, mb: 1 }}>{imageError}</Box>}
            <CompanySection value={c} disabled={!editable} onChange={setCompany} />
          </Section>

          <Section title="Customer">
            <CustomerSection value={form.To} taxed={Boolean(amounts?.taxed)} disabled={!editable} onChange={(To) => update({ To })} />
          </Section>

          <Section title="Details">
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
              <DateField label="Quotation date" value={form.QuoteDate} onChange={(QuoteDate) => update({ QuoteDate })} disabled={!editable} />
              <DateField label="Valid till" value={form.ValidTill} onChange={(ValidTill) => update({ ValidTill })} disabled={!editable} minDate={form.QuoteDate || undefined} />
              <Box sx={{ gridColumn: "1 / -1" }}><TextInput label="Subject" value={form.Subject} onChange={(e) => update({ Subject: e.target.value })} disabled={!editable} /></Box>
            </Box>
          </Section>

          <Section title="Lines" hint={`Grand total ${money(amounts?.grandTotal)}`}>
            <LinesEditor lines={form.Lines} amounts={amounts} products={productsData?.products ?? []} disabled={!editable} onChange={(Lines) => update({ Lines })} />
          </Section>

          <Section title="Message, notes & terms">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <RichTextEditor label="Opening message" hint="Printed above the price table" value={form.Content.intro} onChange={setContent("intro")} disabled={!editable} data-testid="rte-intro" />
              <RichTextEditor label="Notes" hint="Printed under the totals" value={form.Content.notes} onChange={setContent("notes")} disabled={!editable} minHeight={90} data-testid="rte-notes" />
              <RichTextEditor label="Terms & conditions" value={form.Content.terms} onChange={setContent("terms")} disabled={!editable} data-testid="rte-terms" />
            </Box>
          </Section>

          <Section title="Extra sections" hint="Appended after the notes: a scope table, product pictures, an introduction to your company.">
            <SectionsEditor sections={form.Content.sections} images={images} disabled={!editable} onChange={setContent("sections")} onUploadPicture={uploadPicture} />
          </Section>
        </Box>

        <Box sx={{ position: { lg: "sticky" }, top: 16, height: { xs: 560, lg: "calc(100vh - 150px)" } }}>
          <PdfPreview Component={templateByCode(form.TemplateCode).Component} doc={doc} onReady={(blob) => { pdfBlob.current = blob; }} />
        </Box>
      </Box>

      <Confirm open={ask === "finalise"} title="Finalise this quotation?" yes="Yes, finalise" busy={finalise.isPending || save.isPending} onYes={onFinalise} onClose={() => setAsk(null)}
        body="It gets its number and is locked. To change it afterwards you revise it — the customer's copy never changes silently." />
      <Confirm open={ask === "delete"} title="Delete this draft?" yes="Yes, delete" busy={remove.isPending} onYes={onDelete} onClose={() => setAsk(null)}
        body="The draft and any pictures uploaded to it are removed. This cannot be undone." />
      <Confirm open={ask === "accept"} title="The customer accepted?" yes="Yes, they accepted" busy={accept.isPending} onYes={onAccept} onClose={() => setAsk(null)}
        body={`The lead is marked won for ${money(quotation.TaxableTotal)} (before tax), and ${form.To.ToName} becomes a customer. Any other open quotation on this lead is closed.`} />
      <RemarksModal open={ask === "reject"} onClose={() => setAsk(null)} title="The customer said no" subtitle="Optional — why? It helps the next quotation."
        submitLabel="Mark rejected" required={false} busy={reject.isPending} onSubmit={onReject} />
    </Box>
  );
}
```

- [ ] **Step 4: Route**

In `web/src/App.jsx`: add, beside the other Sales lazies,

```jsx
const QuotationBuilder = lazy(() => import("./pages/Sales/Quotations/QuotationBuilder"));
```
and, after the `/sales/leads/:leadId` route,
```jsx
  // Spec 3. Lazy on purpose: this chunk is the only thing that imports the PDF
  // engine, so it costs the rest of the app nothing.
  { path: "/sales/quotations/:quotationId", element: <ProtectedRoute element={<QuotationBuilder />} /> },
```
Add the path to the expectations in `web/src/App.routes.test.jsx` following that file's pattern.

- [ ] **Step 5: Green, with coverage**

```bash
cd web && pnpm exec vitest run src/pages/Sales/Quotations/QuotationBuilder.test.jsx src/pages/Sales/Quotations/builder/PdfPreview.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/QuotationBuilder.jsx --coverage.include='src/pages/Sales/Quotations/builder/LookSection.jsx' --coverage.include='src/pages/Sales/Quotations/builder/PartySections.jsx' --coverage.include='src/pages/Sales/Quotations/builder/PdfPreview.jsx'
cd web && pnpm exec vitest run src/App.routes.test.jsx
cd web && pnpm exec eslint src/pages/Sales/Quotations src/App.jsx
```
Expected: PASS; the page, `LookSection`, `PartySections` and `PdfPreview` ≥ 80 %; lint 0 errors.

This page is new code written against the `ui/` props as read on 2026-09-18 (`DateField` takes an ISO string for `minDate`; `useApiMutation` shows the server's sentence through notistack, which `renderWithProviders` mounts, so the refusal test can see it). Fix what the tests show — max 3 attempts, then BLOCKED with the error.

- [ ] **Step 6: Stop and report.** Do not stage or commit.

---

### Task 16: `WonDialog` · lead page (Won in the dropdown, Quotations tab, won banner) · Won preset · timeline icon

**Files:**
- Create: `web/src/pages/Sales/Quotations/WonDialog.jsx` + `WonDialog.test.jsx`
- Create: `web/src/pages/Sales/Quotations/LeadQuotations.jsx` + `LeadQuotations.test.jsx`
- Modify: `web/src/pages/Sales/LeadDetail.jsx` + `LeadDetail.test.jsx`
- Modify: `web/src/pages/Sales/leadStatus.js` + `leadStatus.test.js` (create the test file if there is none), `web/src/pages/Sales/Leads.jsx` + its test
- Modify: `web/src/pages/Sales/Timeline.jsx` + `Timeline.test.jsx`

**Interfaces:**
- Consumes: `QUOTATION_ENDPOINTS`, `draftBodyFromLead`, `TEMPLATES`, `money`.
- Produces: `<WonDialog open lead onClose onWon />`; `<LeadQuotations lead />` (exposes its count through `onCount(n)`); a **Won** preset on the leads list.

**Won is offered in the status dropdown — and still never goes through `setLeadStatus`.** Both are true on purpose: the owner asked for Won to be an ordinary choice, and the engine requires that `converted` be written by `sp_ConvertLead` alone. Picking Won opens `WonDialog`, which posts to `convertLead`. `LeadCreateModal` and the *leads-list* status filter are not touched: a filter may list Won; only the *move* is special.

- [ ] **Step 1: `WonDialog` — test first**

`web/src/pages/Sales/Quotations/WonDialog.test.jsx`:

```jsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import WonDialog from "./WonDialog";
import useAuthStore from "../../../stores/useAuthStore";
import { server } from "../../../test/mocks/server";
import renderWithProviders from "../../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const LEAD = { Id: 9, Name: "Ramesh Patel", EstValue: 300000 };
const FINALS = [
  { Id: 4, QuoteNo: "QT-2627-0042-R2", TaxableTotal: 265000, GrandTotal: 296800 },
  { Id: 6, QuoteNo: "QT-2627-0051", TaxableTotal: 180000, GrandTotal: 201600 },
];
const mocks = (quotations, cap = {}) => {
  server.use(
    http.post("*/api/quotations/fetchQuotations", async ({ request }) => { cap.list = await request.json(); return json({ quotations, pagination: {} }); }),
    http.post("*/api/leads/convertLead", async ({ request }) => { cap.convert = await request.json(); return json({ Id: 9, CustomerId: 31, WonValue: 1 }); }),
  );
  return cap;
};
const draw = (props = {}) => renderWithProviders(<WonDialog open lead={LEAD} onClose={() => {}} {...props} />);

beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://shadowcodes.in/CRM" }));

describe("WonDialog", () => {
  // Spec decision 6: small leads are won with no quotation at all.
  it("with no quotation on the lead: asks for the value, pre-filled with the estimate", async () => {
    const cap = mocks([]);
    draw();
    const value = await screen.findByLabelText(/won for/i);
    expect(value).toHaveValue("300000");
    expect(cap.list).toMatchObject({ LeadId: 9, Status: "final" });
    fireEvent.change(value, { target: { value: "4000" } });
    fireEvent.change(screen.getByLabelText(/remarks/i), { target: { value: "paid by UPI" } });
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(cap.convert).toEqual({ LeadId: 9, WonValue: 4000, Remarks: "paid by UPI", QuotationId: null }));
  });

  it("with finalised quotations: asks which one they accepted, and takes the value from it", async () => {
    const cap = mocks(FINALS);
    draw();
    fireEvent.click(await screen.findByRole("radio", { name: /QT-2627-0042-R2/ }));
    expect(screen.queryByLabelText(/won for/i)).toBeNull(); // the quotation IS the value
    expect(screen.getByText("₹2,65,000.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(cap.convert).toEqual({ LeadId: 9, WonValue: null, Remarks: null, QuotationId: 4 }));
  });

  it("…or none of them — won without a quotation, on a typed value", async () => {
    const cap = mocks(FINALS);
    draw();
    fireEvent.click(await screen.findByRole("radio", { name: /none — won without a quotation/i }));
    fireEvent.change(screen.getByLabelText(/won for/i), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(cap.convert).toMatchObject({ WonValue: 250000, QuotationId: null }));
  });

  it("will not submit until a choice is made and a value is there", async () => {
    mocks(FINALS);
    draw();
    await screen.findByRole("radio", { name: /QT-2627-0051/ });
    expect(screen.getByRole("button", { name: /mark won/i })).toBeDisabled();
  });

  it("accepts zero — a free replacement is still a win — but not a blank or a negative", async () => {
    mocks([]);
    draw();
    const value = await screen.findByLabelText(/won for/i);
    fireEvent.change(value, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /mark won/i })).toBeDisabled();
    fireEvent.change(value, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /mark won/i })).toBeEnabled();
  });

  it("tells the parent, and closes", async () => {
    mocks([]);
    let won = 0; let closed = 0;
    draw({ onWon: () => { won += 1; }, onClose: () => { closed += 1; } });
    fireEvent.click(await screen.findByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(won).toBe(1));
    expect(closed).toBe(1);
  });
});
```

`web/src/pages/Sales/Quotations/WonDialog.jsx`:

```jsx
import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { Trophy } from "lucide-react";
import { Button, Modal, TextArea, TextInput } from "../../../components/ui";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { QUOTATION_ENDPOINTS } from "../../../api/quotationQueries";
import { money } from "./buildQuoteDoc";

/**
 * Marking a lead won. ONE engine writes a win (sp_ConvertLead); this is its
 * manual door — "Accepted" on a quotation is the other.
 *
 * A quotation is optional: small leads are won with none, on a typed value. But
 * if the lead HAS finalised quotations, the agent is asked which one the
 * customer accepted (or "none"), so a win is never recorded at a guessed value
 * while the real one is sitting in a quotation on the same lead.
 */
export default function WonDialog({ open, lead, onClose, onWon }) {
  const theme = useTheme();
  const p = theme.tokens;
  const [choice, setChoice] = useState(null);   // a quotation Id, "none", or null = not chosen yet
  const [value, setValue] = useState("");
  const [remarks, setRemarks] = useState("");

  const { data, isLoading } = useApiQuery({
    queryKey: ["quotations", "final", lead?.Id], endpoint: QUOTATION_ENDPOINTS.fetchQuotations,
    params: { LeadId: lead?.Id, Status: "final", PageSize: 50 }, enabled: open && Boolean(lead?.Id), staleTime: 0, showErrorMessage: false,
  });
  const finals = data?.quotations ?? [];

  useEffect(() => {
    if (!open) return;
    setChoice(null); setRemarks("");
    setValue(lead?.EstValue == null ? "" : String(lead.EstValue));
  }, [open, lead]);

  const convert = useApiMutation({
    endpoint: QUOTATION_ENDPOINTS.convertLead, successMessage: "Lead marked won",
    invalidateQueries: [["lead-detail", lead?.Id], ["leads"], ["quotations"], ["customers"]],
  });

  const needsChoice = finals.length > 0;
  const typed = !needsChoice || choice === "none";
  const amount = value === "" ? null : Number(value);
  const ready = !isLoading && (typed ? amount !== null && Number.isFinite(amount) && amount >= 0 : choice !== null);

  const submit = async () => {
    try {
      await convert.mutateAsync({
        LeadId: lead.Id, WonValue: typed ? amount : null, Remarks: remarks.trim() || null, QuotationId: typed ? null : choice,
      });
      onWon?.();
      onClose?.();
    } catch { /* useApiMutation already showed the server's message */ }
  };

  const option = (id, labelText, detail) => (
    <label key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: theme.radii.sm, cursor: "pointer",
      border: `1px solid ${choice === id ? p.primary.main : p.border.default}`, background: choice === id ? p.primary.subtle : p.surface.card }}>
      <input type="radio" name="won-quotation" checked={choice === id} onChange={() => setChoice(id)} aria-label={labelText} />
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{labelText}</span>
      {detail && <span style={{ fontSize: 13, color: p.text.secondary }}>{detail}</span>}
    </label>
  );

  return (
    <Modal open={open} onClose={() => !convert.isPending && onClose?.()} size="md" data-testid="won-dialog">
      <Modal.Header title="Mark this lead won" subtitle={lead?.Name} icon={<Trophy size={18} />} onClose={() => !convert.isPending && onClose?.()} />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {needsChoice && (
            <div role="radiogroup" aria-label="Which quotation did they accept?" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary }}>Which quotation did they accept?</span>
              {finals.map((q) => option(q.Id, q.QuoteNo, money(q.TaxableTotal)))}
              {option("none", "None — won without a quotation")}
            </div>
          )}
          {typed && (needsChoice ? choice === "none" : true) && (
            <TextInput label="Won for (₹, before tax)" required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-testid="won-value" />
          )}
          <TextArea label="Remarks" rows={2} placeholder="Optional — e.g. paid by UPI" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={convert.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={convert.isPending} data-testid="won-submit">Mark won</Button>
      </Modal.Footer>
    </Modal>
  );
}
```

- [ ] **Step 2: `LeadQuotations` — test first**

`web/src/pages/Sales/Quotations/LeadQuotations.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Routes, Route } from "react-router-dom";
import LeadQuotations from "./LeadQuotations";
import useAuthStore from "../../../stores/useAuthStore";
import { server } from "../../../test/mocks/server";
import renderWithProviders from "../../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const LEAD = { Id: 9, Name: "Ramesh Patel", Company: "", MobileNo: "9825012345", City: "Ahmedabad", State: "Gujarat", ProductId: 7, StatusCode: "qualified" };
const ROWS = [
  { Id: 4, QuoteNo: "QT-2627-0042", Revision: 1, Status: "final", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", GrandTotal: 302400, IsExpired: false },
  { Id: 5, QuoteNo: null, Revision: 2, Status: "draft", QuoteDate: "2026-09-19", ValidTill: null, GrandTotal: 296800, IsExpired: false },
];
const mocks = (rows = ROWS, cap = {}) => {
  server.use(
    http.post("*/api/quotations/fetchQuotations", () => json({ quotations: rows, pagination: {} })),
    http.post("*/api/quotations/ensureQuoteProfile", () => json({ profile: { Id: 3, CompanyName: "Solar Care", DefaultTemplate: "modern", IsSet: true } })),
    http.post("*/api/products/fetchProducts", () => json({ products: [{ Id: 7, Name: "5 kW Rooftop", UnitPrice: 280000, TaxPct: 12 }], pagination: {} })),
    http.post("*/api/quotations/saveQuotation", async ({ request }) => { cap.save = await request.json(); return json({ Id: 12, ResponseCode: 200 }); }),
  );
  return cap;
};
const draw = (lead = LEAD, onCount = vi.fn()) => {
  renderWithProviders(
    <Routes>
      <Route path="/sales/leads/9" element={<LeadQuotations lead={lead} onCount={onCount} />} />
      <Route path="/sales/quotations/:id" element={<div data-testid="builder" />} />
    </Routes>, { route: "/sales/leads/9" },
  );
  return onCount;
};

beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, companyName: "Solar Care", API_BASE_URL: "https://shadowcodes.in/CRM" }));

describe("LeadQuotations", () => {
  it("lists the lead's quotations and reports how many", async () => {
    mocks();
    const onCount = draw();
    expect(await screen.findByText("QT-2627-0042")).toBeInTheDocument();
    expect(screen.getByText(/draft · revision 2/i)).toBeInTheDocument();
    expect(screen.getByText("₹3,02,400.00")).toBeInTheDocument();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2));
  });

  it("opens a quotation in the builder", async () => {
    mocks();
    draw();
    fireEvent.click(await screen.findByText("QT-2627-0042"));
    expect(await screen.findByTestId("builder")).toBeInTheDocument();
  });

  // The builder must open already filled in — that is the whole pitch.
  it("creates a draft from the lead, the branch's letterhead and the lead's product, then opens it", async () => {
    const cap = mocks([]);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /create quotation/i }));
    fireEvent.click(await screen.findByTestId("template-minimal"));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({ Id: 0, LeadId: 9, TemplateCode: "minimal", ToName: "Ramesh Patel", ToMobile: "9825012345", ToStateCode: "24" });
    expect(cap.save.Company.name).toBe("Solar Care");
    expect(cap.save.Lines[0]).toMatchObject({ productId: 7, description: "5 kW Rooftop", rate: 280000, taxPct: 12 });
    expect(await screen.findByTestId("builder")).toBeInTheDocument();
  });

  it("pre-selects the branch's usual template", async () => {
    mocks([]);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /create quotation/i }));
    expect(await screen.findByTestId("template-modern")).toHaveAttribute("aria-checked", "true");
  });

  // A closed lead's quotations are history: readable, never extendable.
  it("offers no Create on a lead that is won, lost or junk", async () => {
    mocks();
    draw({ ...LEAD, StatusCode: "converted" });
    await screen.findByText("QT-2627-0042");
    expect(screen.queryByRole("button", { name: /create quotation/i })).toBeNull();
  });

  it("says so when there are none", async () => {
    mocks([]);
    draw();
    expect(await screen.findByText(/no quotations yet/i)).toBeInTheDocument();
  });
});
```

`web/src/pages/Sales/Quotations/LeadQuotations.jsx`:

```jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { FilePlus2 } from "lucide-react";
import { Button, Card, Chip, EmptyState, Modal, Skeleton } from "../../../components/ui";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import useAuthStore from "../../../stores/useAuthStore";
import { QUOTATION_ENDPOINTS } from "../../../api/quotationQueries";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { formatDate } from "../../../utils/format";
import { isActiveCode } from "../leadStatus";
import { money } from "./buildQuoteDoc";
import { draftBodyFromLead } from "./quoteForm";
import LookPicker from "./builder/LookSection";

export const QUOTE_STATUS = {
  draft: { label: "Draft", tone: "warning" }, final: { label: "Final", tone: "primary" }, accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "error" }, superseded: { label: "Superseded", tone: "default" }, unused: { label: "Not used", tone: "default" },
};

/**
 * The lead page's Quotations tab. Creating one needs no form of its own: pick a
 * template, and the draft is built from what the lead and the branch's saved
 * letterhead already know (quoteForm.draftBodyFromLead), then opened in the
 * builder — already filled in.
 */
export default function LeadQuotations({ lead, onCount }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const p = theme.tokens;
  const companyName = useAuthStore((s) => s.companyName);
  const [picking, setPicking] = useState(false);
  const [templateCode, setTemplateCode] = useState(null);

  const { data, isLoading } = useApiQuery({
    queryKey: ["quotations", "lead", lead.Id], endpoint: QUOTATION_ENDPOINTS.fetchQuotations,
    params: { LeadId: lead.Id, PageSize: 50 }, staleTime: 0, showErrorMessage: false,
  });
  const rows = data?.quotations ?? [];
  useEffect(() => { if (data) onCount?.(rows.length); }, [data, rows.length, onCount]);

  // Only fetched once the picker is open — a lead page that is merely being
  // read should not create a profile row for its branch.
  const { data: profileData } = useApiQuery({
    queryKey: ["quote-profile", lead.Id], endpoint: QUOTATION_ENDPOINTS.ensureQuoteProfile, params: { LeadId: lead.Id }, enabled: picking, showErrorMessage: false,
  });
  const { data: productsData } = useApiQuery({
    queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, enabled: picking, showErrorMessage: false,
  });
  const profile = profileData?.profile ?? null;
  const chosen = templateCode ?? profile?.DefaultTemplate ?? "classic";

  const create = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.saveQuotation, successMessage: "Draft created", invalidateQueries: [["quotations"]] });
  const onCreate = async () => {
    const product = (productsData?.products ?? []).find((x) => x.Id === lead.ProductId) ?? null;
    try {
      const saved = await create.mutateAsync(draftBodyFromLead({ lead, profile, product, templateCode: chosen, companyName }));
      navigate(`/sales/quotations/${saved.Id}`);
    } catch { /* useApiMutation already showed the server's message */ }
  };

  if (isLoading) return <Skeleton variant="rect" height={120} />;

  return (
    <div data-testid="lead-quotations" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {isActiveCode(lead.StatusCode) && (
        <div><Button variant="primary" size="sm" leftIcon={<FilePlus2 size={14} />} onClick={() => setPicking(true)} data-testid="create-quotation-btn">Create quotation</Button></div>
      )}
      {rows.length === 0 && <EmptyState title="No quotations yet" description="A quotation is optional — small leads are often won without one." size="sm" />}
      {rows.map((q) => (
        <Card key={q.Id} interactive padding="md" onClick={() => navigate(`/sales/quotations/${q.Id}`)} data-testid={`quotation-${q.Id}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{q.QuoteNo || `Draft · revision ${q.Revision}`}</div>
              <div style={{ fontSize: 12, color: p.text.tertiary, marginTop: 2 }}>
                {formatDate(q.QuoteDate, { empty: "—" })}{q.ValidTill ? ` · valid till ${formatDate(q.ValidTill)}` : ""}{q.IsExpired ? " · expired" : ""}
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{money(q.GrandTotal)}</div>
            <Chip size="sm" label={QUOTE_STATUS[q.Status]?.label ?? q.Status} tone={QUOTE_STATUS[q.Status]?.tone ?? "default"} />
          </div>
        </Card>
      ))}

      <Modal open={picking} onClose={() => !create.isPending && setPicking(false)} size="lg" data-testid="template-picker">
        <Modal.Header title="Pick a template" subtitle="You can change it later — nothing is lost." onClose={() => !create.isPending && setPicking(false)} />
        <Modal.Body>
          <LookPicker templateCode={chosen} accent={profile?.AccentColor || "#1e3a8a"} onTemplate={setTemplateCode} onAccent={() => {}} />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setPicking(false)} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={onCreate} loading={create.isPending} disabled={!profile}>Create</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
```

> `LookSection` is reused as the picker, so the template cards exist once. Its accent row is inert here (`onAccent` is a no-op). If that reads as confusing in review, give `LookSection` a `showAccent = true` prop and pass `false` — do **not** copy the cards into a second component.

- [ ] **Step 3: The lead page**

`web/src/pages/Sales/LeadDetail.jsx` — make exactly these changes:

1. Imports: add
   ```jsx
   import { Trophy } from "lucide-react";   // merge into the existing lucide import
   import WonDialog from "./Quotations/WonDialog";
   import LeadQuotations from "./Quotations/LeadQuotations";
   import { formatCurrency } from "../../utils/format";
   ```
2. State: add `const [wonOpen, setWonOpen] = useState(false);` and `const [quoteCount, setQuoteCount] = useState(0);`.
3. Replace the comment + `statusOpts` memo (lines ~91–97) with:
   ```jsx
   // `converted` (Won) IS offered — the owner asked for it to be an ordinary
   // choice — but it is the one status that never goes through setLeadStatus,
   // which refuses it ("Use convert…"). Picking it opens WonDialog, which posts
   // to convertLead: one engine writes a win, whether it arrives from here or
   // from "Accepted" on a quotation.
   const statusOpts = useMemo(
     () => statuses.map((s) => ({ value: s.Id, label: s.Value, code: s.Code })),
     [statuses],
   );
   ```
4. In `onStatusPick`, before the `lost` branch: `if (opt.code === "converted") { setWonOpen(true); return; }`.
5. Tabs: insert `{ value: "quotations", label: "Quotations", badge: quoteCount },` between `followups` and `history`.
6. In the Details tab, directly above `<Card data-testid="lead-core-info">`:
   ```jsx
   {lead.StatusCode === "converted" && (
     <Card variant="outlined" padding="md" data-testid="won-banner">
       <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
         <Trophy size={20} />
         <div style={{ flex: 1 }}>
           <div style={{ fontSize: 15, fontWeight: 700 }}>Won for {formatCurrency(lead.WonValue, { empty: "—" })}</div>
           <div style={{ fontSize: 13, marginTop: 2 }}>
             {fmt(lead.WonAt)}{lead.CustomerName ? ` · customer: ${lead.CustomerName}` : ""}
           </div>
         </div>
       </div>
     </Card>
   )}
   ```
   (If `Card` has no `outlined` variant, drop the prop — check `Card.jsx`'s variant list; it does list one.)
7. After the `followups` tab block, add:
   ```jsx
   {tab === "quotations" && <LeadQuotations lead={lead} onCount={setQuoteCount} />}
   ```
   The badge needs the count before the tab is opened, so **also** render it hidden while another tab is showing: replace the line above with
   ```jsx
   <div hidden={tab !== "quotations"}><LeadQuotations lead={lead} onCount={setQuoteCount} /></div>
   ```
8. Beside the other modals at the bottom: `<WonDialog open={wonOpen} lead={lead} onClose={() => setWonOpen(false)} onWon={refetch} />`.

`web/src/pages/Sales/LeadDetail.test.jsx` — add to `mocks()` a `convertLead` handler that captures its body into `cap.convert`, keep the lookup fixture's `{ Id: 16, Value: "Converted", Code: "converted" }` row, and add:

```jsx
  // REGRESSION GUARD for the rule, not a bug: Won is offered like any status,
  // and must NEVER reach setLeadStatus (which refuses it) — it goes to convert.
  it("offers Won in the dropdown, and routes it to convertLead instead of setLeadStatus", async () => {
    const cap = {};
    mocks(cap);
    renderDetail();
    await screen.findByTestId("lead-detail");
    const input = within(screen.getByTestId("lead-status-select-wrapper") ?? screen.getByTestId("lead-status-select")).getByRole("combobox");
    await userEvent.click(input);
    await userEvent.click(await screen.findByRole("option", { name: "Converted" }));
    expect(await screen.findByTestId("won-dialog")).toBeInTheDocument();
    expect(cap.status).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(cap.convert).toMatchObject({ LeadId: 9, WonValue: 50000, QuotationId: null }));
  });

  it("shows what a won lead was won for", async () => {
    server.use(http.post("*/api/leads/fetchLeadDetail", async () => json({ ...DETAIL, lead: { ...LEAD, StatusCode: "converted", StatusName: "Won", WonValue: 270000, WonAt: "2026-09-18T10:00:00Z", CustomerName: "Ramesh Patel" } })));
    renderDetail();
    expect(await screen.findByTestId("won-banner")).toHaveTextContent("270,000");
  });

  it("has a Quotations tab", async () => {
    mocks();
    renderDetail();
    await screen.findByTestId("lead-detail");
    fireEvent.click(screen.getByRole("tab", { name: /quotations/i }));
    expect(await screen.findByTestId("lead-quotations")).toBeVisible();
  });
```
Match how the file's **existing** status tests open the Combobox (copy their exact interaction — do not invent a second way), and how they find a tab. Any existing test asserting that *Converted is not offered* must be inverted, with its comment rewritten to say why.

- [ ] **Step 4: Won preset, won value, timeline icon**

`web/src/pages/Sales/leadStatus.js`:
- `LEAD_PRESETS`: add `{ value: "won", label: "Won" },` before `lost`.
- `presetParams`: add `case "won": return { StatusCode: "converted" };`.
- `leadsParamsToState`: the preset chain gains `: get("StatusCode") === "converted" ? "won"` before the `lost` check.
- Fix the file's second comment line to read `// open | qualified = still being worked; lost | junk | converted (won) = closed.`

`web/src/pages/Sales/Leads.jsx` — the value column shows what a won lead was actually won for:
```jsx
    { accessorKey: "EstValue", header: "Value", enableSorting: true,
      Cell: ({ row }) => (row.original.StatusCode === "converted"
        ? <strong>{formatCurrency(row.original.WonValue, { empty: "—" })}</strong>
        : formatCurrency(row.original.EstValue, { empty: "—" })) },
```
Update the leads test's column-header expectation from `"Est. Value"` to `"Value"` and add one cell test for a converted row.

`web/src/pages/Sales/Timeline.jsx` — add `FileText` to the lucide import and, in `TYPE_META`:
```jsx
  quotation: { label: "Quotation", Icon: FileText, tone: "primary" },
```
and one test in `Timeline.test.jsx` that an activity of `Type: "quotation"` renders its summary (copy the shape of the nearest existing type test).

Tests for `leadStatus.js`: assert `presetParams("won")` → `{ StatusCode: "converted" }`, and that `leadsParamsToState(new URLSearchParams("StatusCode=converted")).preset` is `"won"`.

- [ ] **Step 5: Green, with coverage — one file per run**

```bash
cd web && pnpm exec vitest run src/pages/Sales/Quotations/WonDialog.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/WonDialog.jsx
cd web && pnpm exec vitest run src/pages/Sales/Quotations/LeadQuotations.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/LeadQuotations.jsx
cd web && pnpm exec vitest run src/pages/Sales/LeadDetail.test.jsx --coverage --coverage.include=src/pages/Sales/LeadDetail.jsx
cd web && pnpm exec vitest run src/pages/Sales/leadStatus.test.js --coverage --coverage.include=src/pages/Sales/leadStatus.js
cd web && pnpm exec vitest run src/pages/Sales/Leads.test.jsx --coverage --coverage.include=src/pages/Sales/Leads.jsx
cd web && pnpm exec vitest run src/pages/Sales/Timeline.test.jsx --coverage --coverage.include=src/pages/Sales/Timeline.jsx
```
Expected: all PASS; every touched file ≥ 80 %.

- [ ] **Step 6: Stop and report.** Do not stage or commit.

---

### Task 17: `QuotationList` page + route

**Files:**
- Create: `web/src/pages/Sales/Quotations/QuotationList.jsx` + `QuotationList.test.jsx`
- Modify: `web/src/App.jsx`, `web/src/App.routes.test.jsx`

**Interfaces:**
- Consumes: `useServerTable`, `QUOTATION_ENDPOINTS.fetchQuotations`, `QUOTE_STATUS` (from `LeadQuotations`), `money`.
- Produces: the page at `/sales/quotations` (the menu row `091` §10 adds).

A list page like Leads and Customers: `useServerTable`, a labelled filter row, a row click that opens the record. **No `overflow` wrapper around the table** — `components/table/tableSurface.test.js` fails the build if one appears within four lines above `<MaterialReactTable`. Filters are labelled — every one or none (CLAUDE.md §0.7): the date pickers draw their own mask and ignore `placeholder`, so an unlabelled date filter is a mystery box.

- [ ] **Step 1: Test first**

`web/src/pages/Sales/Quotations/QuotationList.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../../theme";

vi.mock("../../../components/ui/DateField", () => import("../../../test/DateFieldStub"));

const ROWS = [{ Id: 4, QuoteNo: "QT-2627-0042", Revision: 1, Status: "final", LeadId: 9, LeadName: "Ramesh Patel", ToName: "Ramesh Patel", OwnerName: "Amit", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", GrandTotal: 302400, IsExpired: true }];
vi.mock("../../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({ table: { __options: { data: ROWS } }, data: ROWS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: 1 })),
}));
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => <div data-testid="mrt-root">{(table?.__options?.data ?? []).map((r) => <div key={r.Id}>{r.QuoteNo}</div>)}</div>,
}));
vi.mock("../../../hooks", () => ({ useUsers: () => ({ data: { users: [{ Id: 2, FullName: "Amit" }] } }) }));
vi.mock("../../../hooks/useApiQuery", () => ({ useApiQuery: () => ({ data: { branches: [{ Id: 1, BranchName: "HEAD OFFICE" }] } }) }));

import QuotationList from "./QuotationList";
import useServerTable from "../../../hooks/useServerTable";

const draw = () => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={["/sales/quotations"]}>
      <Routes><Route path="/sales/quotations" element={<QuotationList />} /><Route path="/sales/quotations/:id" element={<div data-testid="builder" />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider></ThemeProvider>,
);
const cfg = () => useServerTable.mock.calls.at(-1)[0];
const cell = (key, row = ROWS[0]) => render(<ThemeProvider theme={buildTheme("light")}>{cfg().columns.find((c) => c.accessorKey === key).Cell({ row: { original: row }, cell: { getValue: () => row[key] } })}</ThemeProvider>);

beforeEach(() => useServerTable.mockClear());

describe("QuotationList", () => {
  it("wires useServerTable to fetchQuotations with the list columns", () => {
    draw();
    expect(cfg()).toMatchObject({ endpoint: "/api/quotations/fetchQuotations", dataKey: "quotations", queryKey: "quotations" });
    expect(cfg().columns.map((c) => c.accessorKey)).toEqual(["QuoteNo", "LeadName", "OwnerName", "QuoteDate", "ValidTill", "GrandTotal", "Status"]);
    expect(cfg().getRowId({ Id: 4 })).toBe(4);
    expect(screen.getByText("QT-2627-0042")).toBeInTheDocument();
  });

  it("labels every filter — a date picker draws its own mask and ignores a placeholder", () => {
    draw();
    for (const label of ["Status", "Owner", "Branch", "From", "To"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it("sends the chosen filters, and nothing for the ones left alone", () => {
    draw();
    expect(cfg().extraParams).toEqual({ Status: null, OwnerId: null, BranchId: null });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    expect(cfg().extraParams).toMatchObject({ FromDate: "2026-09-01" });
  });

  it("opens the builder on a row click", () => {
    draw();
    cfg().muiTableBodyRowProps({ row: { original: ROWS[0] } }).onClick();
    expect(screen.getByTestId("builder")).toBeInTheDocument();
  });

  it("renders a draft's missing number, money, and an expired quotation readably", () => {
    draw();
    cell("QuoteNo", { ...ROWS[0], QuoteNo: null, Revision: 2 }); expect(screen.getByText(/draft · revision 2/i)).toBeInTheDocument();
    cell("GrandTotal"); expect(screen.getByText("₹3,02,400.00")).toBeInTheDocument();
    cell("ValidTill"); expect(screen.getByText(/expired/i)).toBeInTheDocument();
    cell("Status"); expect(screen.getByText("Final")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: The page**

`web/src/pages/Sales/Quotations/QuotationList.jsx`:

```jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";

import { Chip, Combobox, DateField } from "../../../components/ui";
import PageHeader from "../../../components/ui/PageHeader";
import useServerTable from "../../../hooks/useServerTable";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useUsers } from "../../../hooks";
import { QUOTATION_ENDPOINTS } from "../../../api/quotationQueries";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { formatDate } from "../../../utils/format";
import { getUserName } from "../../../utils/userShape";
import { money } from "./buildQuoteDoc";
import { QUOTE_STATUS } from "./LeadQuotations";

// `superseded` is deliberately first-class here: the list hides replaced
// revisions by default (one row per live quotation), and this is how you ask
// for them.
const STATUS_OPTS = Object.entries(QUOTE_STATUS).map(([value, s]) => ({ value, label: s.label }));

/**
 * Every quotation the caller's scope reaches — sp_FetchQuotations applies the
 * LEAD's visibility, so this list and the leads list always agree on who can
 * see what. Creating one happens from a lead, where the customer and product
 * already are; this page only finds and opens.
 */
export default function QuotationList() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [filters, setFilters] = useState({ Status: null, OwnerId: null, BranchId: null, FromDate: "", ToDate: "" });
  const set = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });
  const ownerOpts = useMemo(() => (usersData?.users ?? []).map((u) => ({ value: u.Id, label: getUserName(u) || u.FullName || u.Username })), [usersData]);
  const branchOpts = useMemo(() => (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })), [branchData]);
  const pick = (opts, v) => opts.find((o) => o.value === v) ?? null;

  // The colour, not an object: an object literal is new on every render, so
  // depending on it would defeat the memo — and depending on one of its fields
  // is the dishonest dependency react-hooks/exhaustive-deps warns about.
  const expiredColor = theme.tokens.error.main;
  const columns = useMemo(() => [
    { accessorKey: "QuoteNo", header: "Quotation", enableSorting: false, Cell: ({ row }) => row.original.QuoteNo || `Draft · revision ${row.original.Revision}` },
    { accessorKey: "LeadName", header: "Lead", enableSorting: false, Cell: ({ row }) => row.original.ToCompany || row.original.LeadName || "—" },
    { accessorKey: "OwnerName", header: "Owner", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "Unassigned" },
    { accessorKey: "QuoteDate", header: "Date", enableSorting: false, Cell: ({ cell }) => formatDate(cell.getValue(), { empty: "—" }) },
    { accessorKey: "ValidTill", header: "Valid till", enableSorting: false,
      Cell: ({ row, cell }) => <span style={row.original.IsExpired ? { color: expiredColor, fontWeight: 600 } : undefined}>{formatDate(cell.getValue(), { empty: "—" })}{row.original.IsExpired ? " · expired" : ""}</span> },
    { accessorKey: "GrandTotal", header: "Total", enableSorting: false, Cell: ({ cell }) => money(cell.getValue()) },
    { accessorKey: "Status", header: "Status", enableSorting: false,
      Cell: ({ cell }) => <Chip size="sm" label={QUOTE_STATUS[cell.getValue()]?.label ?? cell.getValue()} tone={QUOTE_STATUS[cell.getValue()]?.tone ?? "default"} /> },
  ], [expiredColor]);

  const extraParams = useMemo(() => ({
    Status: filters.Status, OwnerId: filters.OwnerId, BranchId: filters.BranchId,
    ...(filters.FromDate ? { FromDate: filters.FromDate } : {}),
    ...(filters.ToDate ? { ToDate: filters.ToDate } : {}),
  }), [filters]);

  const { table } = useServerTable({
    columns, queryKey: "quotations", endpoint: QUOTATION_ENDPOINTS.fetchQuotations, dataKey: "quotations", extraParams,
    initialPageSize: 25, getRowId: (row) => row.Id,
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => navigate(`/sales/quotations/${row.original.Id}`) }),
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Quotations" subtitle="Every quotation on the leads you can see. Create one from a lead." />
      <Helmet><title>PRD Infotech | Quotations</title></Helmet>

      <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Box sx={{ width: 170 }}><Combobox size="sm" label="Status" placeholder="All live" options={STATUS_OPTS} value={pick(STATUS_OPTS, filters.Status)} onChange={(o) => set("Status")(o?.value ?? null)} data-testid="filter-status" /></Box>
        <Box sx={{ width: 190 }}><Combobox size="sm" label="Owner" placeholder="Anyone" options={ownerOpts} value={pick(ownerOpts, filters.OwnerId)} onChange={(o) => set("OwnerId")(o?.value ?? null)} data-testid="filter-owner" /></Box>
        <Box sx={{ width: 180 }}><Combobox size="sm" label="Branch" placeholder="All branches" options={branchOpts} value={pick(branchOpts, filters.BranchId)} onChange={(o) => set("BranchId")(o?.value ?? null)} data-testid="filter-branch" /></Box>
        <Box sx={{ width: 160 }}><DateField size="sm" label="From" value={filters.FromDate} onChange={set("FromDate")} data-testid="filter-from" /></Box>
        <Box sx={{ width: 160 }}><DateField size="sm" label="To" value={filters.ToDate} onChange={set("ToDate")} data-testid="filter-to" /></Box>
      </Box>

      <MaterialReactTable table={table} />
    </Box>
  );
}
```

- [ ] **Step 3: Route**

`web/src/App.jsx`: `const QuotationList = lazy(() => import("./pages/Sales/Quotations/QuotationList"));` and, **before** the `/sales/quotations/:quotationId` route, `{ path: "/sales/quotations", element: <ProtectedRoute element={<QuotationList />} /> },`. Add it to `App.routes.test.jsx`. Check `web/src/utils/menuBuilder.js` for an icon map keyed by route or title (the Customers row got one in spec 2) and give `/sales/quotations` the lucide `FileText` the same way; update `menuBuilder.test.js` accordingly.

- [ ] **Step 4: Green**

```bash
cd web && pnpm exec vitest run src/pages/Sales/Quotations/QuotationList.test.jsx --coverage --coverage.include=src/pages/Sales/Quotations/QuotationList.jsx
cd web && pnpm exec vitest run src/App.routes.test.jsx
cd web && pnpm exec vitest run src/utils/menuBuilder.test.js
cd web && pnpm exec vitest run src/components/table/tableSurface.test.js
```
Expected: all PASS; page ≥ 80 %. If the labelled-filter test cannot find the `Combobox` inputs by label, read how `Tickets.test.jsx` finds its labelled filters (spec 2 labelled all nine) and do the same.

- [ ] **Step 5: Stop and report.** Do not stage or commit.

---

### Task 18: Products tax fields · `LookupMaster` Won lock · dashboard "Won this month"

**Files:**
- Modify: `web/src/pages/Settings/Products.jsx` + test
- Modify: `web/src/pages/Settings/LookupMaster.jsx` + test
- Modify: `web/src/components/Dashboard.jsx` + test

- [ ] **Step 1: Products — what a quotation line seeds itself from**

In `web/src/pages/Settings/Products.jsx`:
1. `EMPTY`: add `HSNCode: "", TaxPct: "", Unit: "", Description: ""`.
2. The row → form mapper (beside `UnitPrice: p.UnitPrice == null ? "" : String(p.UnitPrice)`): add `HSNCode: p.HSNCode ?? "", TaxPct: p.TaxPct == null ? "" : String(p.TaxPct), Unit: p.Unit ?? "", Description: p.Description ?? ""`.
3. Validation (beside the margin check): `if (form.TaxPct !== "" && (Number(form.TaxPct) < 0 || Number(form.TaxPct) > 100)) next.TaxPct = "GST % must be between 0 and 100";`
4. Save body (beside `MarginPct`): `HSNCode: form.HSNCode.trim() || null, TaxPct: form.TaxPct === "" ? null : Number(form.TaxPct), Unit: form.Unit.trim() || null, Description: form.Description.trim() || null,`
5. Form: after the *Margin %* input add inputs **HSN / SAC**, **GST %** (`error={errors.TaxPct}`), **Unit** (placeholder `Nos, Set, Kg…`) using the same input component and `set("…")` handler the neighbours use, and a full-width **Description** (hint: *Printed on quotations under the product name*).
6. Table: add a `TaxPct` column, header **GST %**, `Cell` → `${value}%` or `—`.

Tests: the save-body test gains the four fields (strings in → numbers/null out); one test that a GST % of `101` shows the error and posts nothing; the column list expectation gains `TaxPct`.

- [ ] **Step 2: `LookupMaster` — the Won row's code is ours**

`sp_SaveLookup` now ignores any attempt to re-code the `converted` row and `sp_DeleteLookup` refuses to remove it (Task 3). The screen should not offer what will be refused:

1. Rewrite the comment above `CODE_OPTIONS` (line ~50): *"lead_status omits "converted" on purpose: an admin cannot CREATE a Won status — every company has exactly one, seeded by 091 and written to only by the convert engine. The seeded row shows up in the list like any other; its label and order are the company's to change, its code is not."*
2. Where the Code `FormSelect` renders (`{codeOptions && (…)}`), when `editingLookup?.Code === "converted"` render it **disabled** with a single option `{ value: "converted", label: "Won — set when a lead is converted" }` instead of `codeOptions`.
3. In the row actions, hide (do not merely disable) the delete action for a row whose `Code === "converted"`.
4. On submit for that row, send `Code: "converted"` (it already does — `formData.Code` was seeded from the row).

Tests: editing the Won row shows a disabled Code field reading *Won —*; its row has no delete action; saving a rename posts `{ Value: "Closed-Won", Code: "converted" }`.

- [ ] **Step 3: Dashboard — what was actually won**

`sp_Dashboard` now returns two more KPI rows, `WonMonth` and `WonValueMonth` (Task 3). `statBy(type)` already reads RS0 by `Type`. In `web/src/components/Dashboard.jsx`, on the leads-trend `Tile` change the subtitle from the fixed string to:

```jsx
          subtitle={`New leads vs conversions — last 7 days · Won this month: ${statBy("WonMonth")} · ${formatCurrency(statBy("WonValueMonth"), { empty: "₹0" })}`}
```
importing `formatCurrency` from `../utils/format` if the file does not already. The `Converted` series on that chart needs nothing — it has keyed on `WonAt` since it was written and starts drawing on its own.

Test: with `dashboard: [{ Type: "WonMonth", Number: 3 }, { Type: "WonValueMonth", Number: 545000 }]` the tile subtitle contains `Won this month: 3` and `5,45,000`; with neither row present it reads `Won this month: 0` and does not crash.

- [ ] **Step 4: Green, with coverage — one file per run**

```bash
cd web && pnpm exec vitest run src/pages/Settings/Products.test.jsx --coverage --coverage.include=src/pages/Settings/Products.jsx
cd web && pnpm exec vitest run src/pages/Settings/LookupMaster.test.jsx --coverage --coverage.include=src/pages/Settings/LookupMaster.jsx
cd web && pnpm exec vitest run src/components/Dashboard.test.jsx --coverage --coverage.include=src/components/Dashboard.jsx
```
Expected: all PASS; each file ≥ 80 %.

- [ ] **Step 5: Stop and report.** Do not stage or commit.

---

### Task 19: **Gate** — web whole suite, lint, build

**Files:** none created. This is the only web task allowed a full-suite run and a build.

- [ ] **Step 1: Whole suite with coverage**

```bash
cd web && pnpm exec vitest run --coverage > "$SCRATCH/web-suite.txt" 2>&1; tail -60 "$SCRATCH/web-suite.txt"
```
Expected: every file PASS; global ≥ 60 %; every file created or modified in Tasks 10–18 ≥ 80 % lines and branches. `components/table/tableSurface.test.js` must still find ≥ 8 table pages and no overflow wrapper (the new list page is one more).

- [ ] **Step 2: Lint**

```bash
cd web && pnpm lint
```
Expected: 0 errors. (10 warnings pre-date this work; do not add to them.)

- [ ] **Step 3: Build, and look at what the PDF engine cost**

```bash
cd web && pnpm build 2>&1 | tail -40
```
Expected: success. In the chunk list, confirm **`@react-pdf` and `tiptap` are in the `QuotationBuilder` chunk(s) and NOT in the entry chunk** — that is the entire point of the lazy route. If either shows up in `index-*.js`, something outside `pages/Sales/Quotations/QuotationBuilder.jsx` is importing it statically: find it (`grep -rn "@react-pdf\|@tiptap" src --include=*.jsx --include=*.js | grep -v Quotations | grep -v "components/ui/RichText\|components/ui/richText" | grep -v test`) and report it rather than restructuring on your own. `ui/index.js` re-exports `RichTextEditor`; if that barrel drags Tiptap into the entry chunk, **remove that one re-export line** and import the editor by path everywhere (the plan already does) — report that you did.

- [ ] **Step 4: Report** — suite totals, the coverage rows for the touched files, lint result, the five largest chunks with sizes, and whether the entry chunk is clean. Do not stage or commit.

---

### Task 20: Mobile — a 10-digit mobile field; typecheck + lint

**Files:**
- Modify: `mobile/src/features/support/ComplaintFormScreen.tsx`

The backend (Task 4) already normalises and refuses; this is the same courtesy the web got. No test suite on mobile (CLAUDE.md §0.4) — the gate is `pnpm typecheck` + `pnpm lint`.

- [ ] **Step 1:** Around line 443 there is the `Input` labelled **Mobile** in the new-customer part of the form. Give it `keyboardType="number-pad"`, `maxLength={10}`, and strip non-digits in its change handler: `onChangeText={(t) => <existing setter>(t.replace(/\D/g, "").slice(0, 10))}`. (React Native's `maxLength` does not truncate a paste the way a browser's does before the handler runs, and the handler strips regardless — the web's reason for avoiding the attribute does not apply.) If the same screen has an alternate-mobile input, treat it identically. Use only `src/ui` components and tokens (§9.3–9.5) — this is a prop change, not new UI.
- [ ] **Step 2:** `cd mobile && pnpm typecheck` → clean. `cd mobile && pnpm lint` → clean.
- [ ] **Step 3: Stop and report.** Do not stage or commit.

---

### Task 21: Docs — `CLAUDE.md`, `ROLES.md`, Notion, deploy commands

**Files:**
- Modify: `CLAUDE.md`, `backend/ROLES.md`

- [ ] **Step 1: `CLAUDE.md`**
  - **§0.7** — add a standing rule: *"**A mobile number is ten digits.** `backend/src/utils/mobile.js` normalises (strips non-digits, drops a leading `91`/`0`) and 400s anything else before a DB call; `web/src/utils/mobile.js` + `ui/MobileInput` are the same rule as a courtesy; four `CHECK` constraints are the backstop. `MobileInput` has **no `maxLength`** on purpose — a browser truncates a paste to it before any handler runs, turning `+91 98250 12345` into a wrong number."*
  - **§0.7** — add: *"**Rich text is `ui/RichTextEditor` (Tiptap 3), and its toolbar is a closed list.** Its HTML is printed to PDF through `react-pdf-html`, which drops a tag it cannot draw **together with its text** (found 2026-09-18: Tiptap's `Highlight` emits `<mark>`; the sentence vanished). Highlight is `BackgroundColor`; `Highlight`/`code`/`codeBlock`/table resizing/inline images are never enabled; `richTextHtml.toPdfHtml` unwraps unknown tags rather than dropping them. A new toolbar button goes into `richTextExtensions.COMMANDS` first — the guard test drives every command through the real converter. Tiptap also emits an update **on mount**; the component suppresses it, or every record would open 'unsaved'."*
  - **§3 Database conventions / §6 Sales** — replace the sentence ending *"`tblLeadStatusHistory` is written only by `sp_SaveLead` (insert) and `sp_SetLeadStatus` — never elsewhere."* with the three-writer version, and add a **Quotations + convert (spec 3, 2026-09-18)** paragraph covering: `converted` is written only by `sp_ConvertLead` (`sp_SetLeadStatus` still refuses it; leaving `converted` clears `WonAt`/`WonValue` and returns the accepted quotation to `final`); a quotation is optional and **has no permission model of its own** (no `BranchId`/`OwnerId` on `tblQuotation`; everything gates on the parent lead); `WonValue` = the accepted quotation's **before-tax** total, or what the agent typed; totals are written only by `sp_SaveQuotation`, exact `DECIMAL`, and pinned to `quoteMath.test.js` by the F1–F5 fixture table in `091` §11.6; numbering is at finalise, per company per Indian FY, revisions reuse the root's number; the profile is per **branch** and images on it are never deleted; **a template is never redesigned in place**; five report procs count `converted` as success; a lead with quotations cannot be deleted.
  - **§4 Web** — add `Quotations/` under `pages/Sales/` in the tree, and one line: *"`pages/Sales/Quotations/QuotationBuilder.jsx` is lazy and is the only importer of `@react-pdf/renderer`; the preview **is** the PDF (`usePdfPreview`), so there is no second renderer to drift."*
- [ ] **Step 2: `backend/ROLES.md`** — in the write-path section add `leads/convertLead` and the quotation writes (`save`/`finalise`/`revise`/`reject`/`delete`) to the list gated by `assertRecordAccess`, noting that quotations gate on the **lead**; note `saveQuoteProfile` is open while a branch's profile is unset and admin-only afterwards, enforced in `sp_SaveQuoteProfile` from `req.scope.isAdmin`.
- [ ] **Step 3: Notion** — fetch the "🎯 Nexus CRM" page, then `notion-update-page` with `content_updates`: **✅ Done** and **📅 Change Log** entries dated `2026-09-18` (or the actual ship date — absolute, never "today") for quotations + convert, the mobile-number rule, and the removal of `jspdf`/`jspdf-autotable`.
- [ ] **Step 4: Hand the owner the deploy commands — do not run them** (§0.6):

```bash
# from backend/
REMOTE=/www/wwwroot/shadowcodes.in/CRM
rsync -avzcn src/ myserver:$REMOTE/src/        # -n = preview; drop it to copy
rsync -avzc  src/ myserver:$REMOTE/src/
ssh myserver "cd $REMOTE && docker compose up -d --build crm && docker compose logs crm --tail=50"
ssh myserver "cd $REMOTE && docker compose up -d --build crm_solar && docker compose logs crm_solar --tail=50"
curl -s https://shadowcodes.in/CRM/health ; curl -s https://shadowcodes.in/SolarCRM/health
# then web: cd web && pnpm build  → upload dist-web/ contents to the IIS /prdcrm/ folder
```
No new env vars, no new container, no `package.json` change on the backend — `src/` is the whole backend deploy. `091` must already be applied to both DBs (Task 9).
- [ ] **Step 5: Stop and report.** Do not stage or commit.

---

### Task 22: Live verification pass → `docs/testing/<date>-quotations-live-test-report.md`

**Files:**
- Create: `docs/testing/<YYYY-MM-DD>-quotations-live-test-report.md`

After the owner has applied `091` (both DBs), deployed the backend and the web. Same discipline as spec 2's pass: a script against the hosted API per persona, plus the things no test can see — **the PDFs, looked at.** Credentials come from the owner at run time through an environment variable; never write one into a file or a command line.

- [ ] **Step 1: API flow, per persona** (Owner · Branch Manager · Self-scoped Sales Executive · a user from another branch). Record PASS/FAIL per check:
  1. Create a draft on an `open` lead (not qualified) → 200; totals match `quoteMath` for the same lines.
  2. `saveQuotation` with a `GrandTotal` in the body → stored total is the SP's, not the body's.
  3. Finalise with no place of supply (seller has a GSTIN) → 400 *"…GST depends on it"*; with one → `QT-<FY>-NNNN`.
  4. Save on a `final` → 409. Upload a picture to a `final` → 409. Delete a letterhead image → 409.
  5. Revise → `-R2` draft; revise again → the **same** draft Id. Finalise R2 → R1 is `superseded` and the list hides it unless `Status: "superseded"`.
  6. `convertLead` with the quotation → lead `converted`, `WonValue` = the quotation's **before-tax** total, customer created; a second final quotation on the lead → `unused`. Call it again → 200 *already won*, nothing changes.
  7. `convertLead` with a value and no quotation on another lead (the ₹4,000 battery) → won, customer created. A third lead whose mobile matches an existing customer → **linked, not duplicated**.
  8. `setLeadStatus → converted` → still 400 *"Use convert…"*. `setLeadStatus` away from `converted` → `WonAt`/`WonValue` cleared, the accepted quotation back to `final`, customer still there.
  9. Mark a lead with a final quotation `lost` → quotation `unused`; `reviseQuotation` on it → 409 (lead closed).
  10. `deleteLeads` on a lead with a quotation → 409.
  11. Scope: the Self-scoped executive cannot `fetchQuotationDetail` a quotation on someone else's lead (404), cannot finalise it (403), and does not see it in `fetchQuotations`; the manager above them can. The other-branch user sees none of it. After `transferLead` to the other branch, that user sees the quotation and the first no longer does.
  12. `saveQuoteProfile` as a non-admin on a branch whose profile is set → 403; on an unset one → 200. `ensureQuoteProfile` for a lead in branch B called by a user from branch A → branch **B**'s profile.
  13. Mobile: `saveLeads` / `saveCustomer` with `+91 98250 12345` → stored `9825012345`; with `12345` → 400 *"Mobile number must be 10 digits"*.
  14. Reports: a lead that went `open → converted` (never qualified) is counted in the funnel's qualified-or-better step and has a closed date in Aging; the dashboard's `WonMonth` / `WonValueMonth` rows are present.

- [ ] **Step 2: The PDFs — open each and look.** Matrix: **3 templates × {intra-state, inter-state with buyer GSTIN, unregistered seller} × {one page, a 30+-line table that breaks across pages, a picture section + a rich-text table}**. For each, check and note: the right tax rows and columns (no GST column at all when unregistered); no line row split across a page break; "Page x of y" on every page; continuation pages keep their top margin (Modern's band must not push page 2 to the paper's edge); DRAFT watermark on drafts only; **₹** prints as ₹; bold / italic / underline / strike / colour / size / serif / alignment / bullets / numbering / link / divider / table each arrive in the PDF; **a highlighted phrase is present** (the bug this whole design is shaped around). Known and accepted — record, do not fix: highlighting an *entire* paragraph paints the full line width rather than hugging the text.
- [ ] **Step 3: In a real browser, not jsdom:** paste `+91 98250 12345` and `098250 12345` into a `MobileInput` → `9825012345` both times. Paste a formatted paragraph from Word into the editor → formatting reduced, **no words lost**, and the PDF shows it. Upload a WebP as a logo → refused in words. Replace the sample logo → Finalise unblocks. Download → the file is named `<QuoteNo> - <customer>.pdf` and is the file that was on screen.
- [ ] **Step 4: Write the report** — date, environment, personas, the check table with verbatim output for anything that failed, the PDF matrix with one line per cell, test data left behind (and how to remove it — quotations cannot be deleted once final, so name the leads). Send the three most representative PDFs to the owner.
- [ ] **Step 5: Stop and report.** Do not stage or commit.

---

## Self-review (run by the plan's author, 2026-09-18)

**Spec coverage** — every section of the spec maps to a task: §1 data model → T1 (+T2/T3 procs); mobile numbers → T1, T4, T10, T20; images → T1 §4, T5, T15A; §2 lifecycle + convert + `sp_SetLeadStatus` + GST arithmetic → T2, T3, T11; §3 backend (SPs, reports, endpoints, rules) → T2–T8; §4 web (builder, preview-is-the-PDF, templates, pure modules, fonts, rich text, finalise guard, lead page, list, leads preset, products, customer GSTIN, LookupMaster, dashboard, `jspdf` removal) → T10–T18; §5 mobile → T20 (the spec said "nothing"; the mobile-number decision added one input); §6 testing → every task + T9, T19, T22; §7 rollout → T9, T21; §8 docs → T21.

**Deviations from the spec, each deliberate and recorded under "Spec ambiguities resolved":** endpoint names; `sp_EnsureQuoteProfile` (a fetch that creates); the profile's branch is the lead's; five report procs, not six; superseded rows hidden by default; seller state derived from the GSTIN; Won in the dropdown *and* never through `setLeadStatus`; quotations as a fourth lead tab; `sp_SaveCustomer`'s own mobile rule tightened; `Type='quotation'` activity rows; a lead with quotations cannot be deleted; the full-width-highlight cosmetic. One more, from building it: **all letterhead uploads go to the `quoteprofile` entity**, including a one-quotation override — the spec's "override uploads to the quotation" would have made a revision's logo depend on an older quotation's attachment. The quotation's `CompanyJSON` holds the id either way, so "edit the company block for this quotation only" still holds.

**What was verified by running it before this plan was written** (scratchpad, real libraries): the whole rich-text → PDF chain with real Tiptap output; `quoteMath`, `gst`, `amountInWords`, `finYear`, `richTextHtml`, `buildQuoteDoc`, `quoteForm`, `utils/mobile` (web); `richTextExtensions` + its guard; `RichTextEditor` + tests; `reactPdfMock`; all three templates + their 35 content tests; `usePdfPreview`; and the templates **rendered to real PDFs and looked at** across five scenarios. **Not run** (no way to, from here): every line of SQL; the backend controllers and their Jest suites; the React pages and components that depend on the app's own `ui/` (`MobileInput`, `ImageSlot`, `LinesEditor`, `SectionsEditor`, `PartySections`, `LookSection`, `PdfPreview`, `QuotationBuilder`, `WonDialog`, `LeadQuotations`, `QuotationList`) — those were written against `ui/` props read from source on 2026-09-18, and their tasks say so.

**Type / name consistency** — checked across tasks: endpoint paths (T6/T7/T8 ⇄ T13 ⇄ page tests); body keys (`Company`/`Content`/`Lines`, camelCase line keys) (T6 ⇄ T15A `toBody` ⇄ `sp_SaveQuotation` `OPENJSON`); response keys (`quotation`/`lines`/`revisions`, `quotations`/`pagination`, `profile`); `quotation.Company`/`.Content` parsed by the controller (T6) and read by `toForm` (T15A); `LeadStatusCode` on the detail row (T2 §6.7) ⇄ the builder's `editable`; `remove` (not `delete`) on the controller ⇄ routes ⇄ route test; `QUOTE_STATUS` exported from `LeadQuotations` and imported by `QuotationList`; the F1–F5 numbers (Contracts ⇄ T3 §11.6 ⇄ T11).
