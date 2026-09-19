# Quotations + lead conversion — design

**Date:** 2026-09-18 · **Status:** approved in conversation, awaiting implementation plan
**Spec 3 of 4** in the Sales/Support rebuild (roadmap in
`2026-09-08-sales-foundation-hierarchy-design.md`), narrowed: the roadmap's
"Deals → Customers → Quotation → Invoice → Commission" becomes
**Convert + Quotation**. Deal is dropped; Invoice and Commission are not in
this spec. SQL: `backend/sql/091_quotations.sql`.

## Why

The client wants sales staff to produce a good-looking quotation from a lead:
pick a prebuilt template, swap in their own logo and images, type their
content, download a PDF, send it however they like. It was always part of the
lead flow ("Qualified → convert → … quotation") but nothing was ever designed
or built — no table, no proc, no screen (verified against the live DB
2026-09-18).

What the engine already holds, waiting for this (all verified live):

- `sp_SaveLookup` whitelists a fifth lead-status code, **`converted`**, that no
  company has a row for.
- `sp_SetLeadStatus` **refuses** it: *"Use convert to move a lead to
  Converted"*. That convert proc was never written.
- `tblLeads.WonAt` exists; `sp_Dashboard`, `sp_ConversionBySource`,
  `sp_FetchLeads` and `sp_FetchLeadDetail` read it; nothing writes it.
  `sp_ConversionBySource` says so in a comment: *"WonCount stays in the
  contract (0 until spec 3 sets WonAt on conversion)"*.
- Every overdue / open-list predicate is `Code IN ('open','qualified')`, so a
  `converted` lead leaves those lists with no change to them.
- Web already treats it as closed (`leadStatus.js`: *"lost | junk | converted
  = closed"*) and `LeadDetail.jsx` hides it from the dropdown because *"it is
  the outcome of the conversion flow"*.

So this spec writes the missing half: the **convert engine**, and quotations
as an optional tool that feeds it.

Decisions taken in conversation (2026-09-18):

| # | Decision | Alternative rejected |
|---|---|---|
| 1 | **No Deal module.** A quotation hangs straight off a lead; it carries the value, the status and the close. | Lead → Deal → Quotation (a whole module before the first quote) |
| 2 | **No direct send.** The user downloads a PDF and sends it themselves. | Email / WhatsApp from the backend (it has no mail capability at all) |
| 3 | **No settings page.** Templates ship with sample logo / header / company text; the user replaces them *in the builder* and the template remembers. | A company-profile settings screen |
| 4 | **GST split:** CGST + SGST when seller and buyer share a state, IGST otherwise. | One GST % per line with a single total; or no tax lines |
| 5 | **Fixed layout + extra sections.** We design the page; they replace images, type into blocks, edit lines, and may append picture / text sections. Nothing can be moved. | A free drag-and-drop designer; or fixed layout with no extras |
| 6 | **A quotation is optional.** Small leads are won with no quote. Won is reachable by hand, with a typed value. | Won only through an accepted quotation |
| 7 | Discount is **per line only** (% or amount). | An overall discount — spread over lines at mixed GST rates it produces tax figures people argue about |
| 8 | Web only. | Mobile (Phase C sales is not built yet) |
| 9 | **A full rich-text editor** for every typed block — bold, italic, underline, strike, text colour, highlight, size, font, alignment, headings, lists, tables, links. **Tiptap 3.** | Plain text with `- ` bullets (my first draft; rejected) |
| 10 | **English only.** | Gujarati / Hindi in the PDF |
| 11 | **A mobile number is 10 digits, joined, everywhere.** Normalised at the backend, enforced by the DB. | Comparing mobiles "as stored" (my first draft; rejected — `98250 12345` and `9825012345` are one person) |

## How it lives (plain language)

1. On any **active** lead (open or qualified) there is a **Create quotation**
   button. Nobody is forced through "Qualified" first — a shop that quotes on
   the first call can.
2. Pick one of three templates. The builder opens **already filled**: customer
   from the lead, first line from the lead's product and its price, today's
   date, a valid-till date. A sample logo and header image sit on the page with
   *Replace* on them.
3. They replace the logo, type their company details, add lines (qty, rate,
   discount, GST %), type the opening message and terms, optionally append
   picture / text sections. The right half of the screen is the live PDF.
4. **The template remembers.** The first time a branch fills its company block
   it is saved; every later quote in that branch opens with it in place.
5. **Draft → Final.** Finalise locks the quote, gives it its number
   (`QT-2627-0042`) and unlocks *Download PDF*. A draft has no number and a
   DRAFT watermark.
6. A change after Final is a **Revise**: a copy, `QT-2627-0042-R2`; the old one
   stays as history. A document the customer is holding never changes silently.
7. **Accepted** on a quote, or **Won** in the lead's status dropdown — both run
   the same convert engine: the lead becomes Won, a customer record is created
   (or matched by mobile), `WonAt` and `WonValue` are stamped.
   With a quote the value is the quote's before-tax total; without one the
   user types it (pre-filled with the estimate).
8. Picking **Won** by hand on a lead that *has* finalised quotes asks *"Which
   quotation did they accept?"* — the quotes, plus *"None — won without a
   quotation"*.
9. Everything lands on the lead's existing timeline.

**Example — with a quote.** Solar Care, lead *Ramesh Patel, 5 kW rooftop, est.
₹3,00,000*. Amit opens the lead → Create quotation → "Modern". It opens
addressed to Ramesh, line 1 *5 kW Solar Rooftop System ₹2,80,000*. First quote
ever for this branch, so he replaces the sample logo and types the GSTIN — once.
Adds *Installation ₹20,000* and *5-year AMC ₹15,000*, ₹10,000 off the rooftop
line. Same state, so the PDF shows CGST + SGST. Finalise → `QT-2627-0042` →
download → he WhatsApps it. Ramesh bargains → Revise → `-R2` with ₹15,000 off →
Finalise → download. Ramesh agrees → **Accepted** → lead Won, Ramesh is a
Customer, `WonValue` = the before-tax total. Three months on his inverter
fails; support types his mobile and the same customer comes up.

**Example — without.** Amit sells a ₹4,000 battery on the phone. Lead → status
**Won** → value ₹4,000, remarks "paid by UPI" → save. Won, customer created,
no quotation anywhere.

## 1. Data model

One script, `091_quotations.sql`, DB-agnostic (no `USE`) — **applied once per
client database** (`eCRM+`, `SolarCRM`). Menu and lookup rows are resolved by
`Route` / `Kind`+`Code`, never by Id (Ids differ per DB).

### `tblQuotation` (new) — one row per quote *revision*

| Column | Type | Notes |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `CompId` | INT NOT NULL | tenancy |
| `LeadId` | INT NOT NULL | parent. **No `BranchId`/`OwnerId` here** — visibility is the lead's, read through the join, so a transferred lead carries its quotes with it |
| `CustomerId` | INT NULL | stamped at accept |
| `RootId` | INT NOT NULL | Id of revision 1 (own Id for R1) |
| `Revision` | INT NOT NULL DEFAULT 1 | |
| `FinYear` / `SeqNo` / `QuoteNo` | CHAR(4) / INT / VARCHAR(30), all NULL | NULL while draft; assigned at finalise |
| `TemplateCode` | VARCHAR(30) NOT NULL | `classic` · `modern` · `minimal` |
| `Status` | VARCHAR(20) NOT NULL DEFAULT `'draft'` | see §2 |
| `QuoteDate` DATE NOT NULL · `ValidTill` DATE NULL · `Subject` NVARCHAR(300) NULL | | |
| Bill-to snapshot | `ToName` NVARCHAR(200) NOT NULL, `ToCompany`, `ToMobile`, `ToEmail`, `ToAddress`, `ToCity`, `ToStateCode` CHAR(2), `ToPincode`, `ToGSTIN` VARCHAR(15) | copied from the lead at create, then the quote's own. `ToStateCode` **is** the place of supply |
| `SellerGSTIN` VARCHAR(15) NULL · `SellerStateCode` CHAR(2) NULL | | real columns because the SP needs them for the split. Empty GSTIN = unregistered = no tax |
| `CompanyJSON` | NVARCHAR(MAX) | frozen copy of the seller block: name, address, phone, email, website, bank, signatory, `logoAttachmentId`, `headerAttachmentId`, `accent`. JSON because it is only ever read back whole by the renderer, never filtered on |
| `ContentJSON` | NVARCHAR(MAX) | `{ intro, terms, notes, sections: [{type:'text',title,body} \| {type:'images',title,items:[{attachmentId,caption}]}] }`. `intro`, `terms`, `notes` and every text `body` are **HTML strings from the editor** (§4). The backend treats them as opaque text and caps each at 200 KB |
| Totals | `SubTotal`, `DiscountTotal`, `TaxableTotal`, `CgstTotal`, `SgstTotal`, `IgstTotal`, `RoundOff`, `GrandTotal` — DECIMAL(18,2) | **written only by the SP**, recomputed from the lines on every save |
| `FinalisedAt/By`, `ClosedAt/By`, `CloseRemarks` NVARCHAR(500) | | close = accepted / rejected / unused |
| audit | `CreatedBy`, `CreatedAt`, `EditBy`, `UpdatedAt` | |

Indexes: `(CompId, LeadId)`, `(CompId, RootId, Revision)` unique,
`(CompId, FinYear, SeqNo, Revision)` unique filtered `WHERE SeqNo IS NOT NULL`.

### `tblQuotationLine` (new)

`Id, CompId, QuotationId, SortOrder, ProductId NULL, Description NVARCHAR(1000)
NOT NULL, HSNCode VARCHAR(10), Qty DECIMAL(18,3), Unit VARCHAR(20), Rate
DECIMAL(18,2), DiscountType VARCHAR(3) ('pct'|'amt'), DiscountValue
DECIMAL(18,2), TaxPct DECIMAL(5,2)` + SP-computed `GrossAmt, DiscountAmt,
TaxableAmt, CgstAmt, SgstAmt, IgstAmt, LineTotal`.
A line is free text; `ProductId` only records where it was seeded from.

### `tblQuotationCounter` (new)
`(CompId, FinYear) PK, LastNo INT`. Read `WITH (UPDLOCK, HOLDLOCK)` inside the
finalise transaction. Per company, per Indian financial year (Apr–Mar;
2026-09-18 → `2627`).

### `tblQuoteProfile` (new) — "the template remembers"

`Id, CompId, BranchId, CompanyName, Address, City, StateCode CHAR(2), Pincode,
GSTIN VARCHAR(15), Phone, Email, Website, BankDetails NVARCHAR(1000),
DefaultIntro NVARCHAR(MAX), DefaultTerms NVARCHAR(MAX), SignatoryName,
LogoAttachmentId BIGINT NULL, HeaderAttachmentId BIGINT NULL, AccentColor
VARCHAR(7), DefaultTemplate VARCHAR(30), IsSet BIT NOT NULL DEFAULT 0`, audit.
Unique `(CompId, BranchId)`.

**Per branch, not per company**: a Gujarat branch and a Mumbai branch have
different GSTINs; one shared row would flip-flop with every quote. A branch
with no row is offered another branch's row of the same company as a starting
point (logo carries over; they fix the address and GSTIN).

### Changed

- `tblLeads` + `WonValue DECIMAL(18,2) NULL`, `CustomerId INT NULL`.
- `tblProduct` + `HSNCode VARCHAR(10)`, `TaxPct DECIMAL(5,2)`, `Unit
  VARCHAR(20)`, `Description NVARCHAR(500)` — all NULL.
- `tblCustomer` + `GSTIN VARCHAR(15) NULL`.
- `tblLookup`: for every company that has `lead_status` rows and no
  `converted` row, insert **"Won"**, `Code='converted'`, sorted directly after
  that company's `qualified` row (later rows shift by one).
- `tblMenu`: **Quotations**, `Route='/sales/quotations'`, under the row whose
  `Route='/sales'`; `tblGroupAccess` grants copied from the group grants of
  `/sales/leads`.

### Mobile numbers — one shape

Verified 2026-09-18: **nothing enforces a shape.** The lead form checks "not
empty"; the backend checks nothing; `sp_SaveLead` stores what it is given;
`sp_SaveCustomer` strips spaces and dashes but still accepts `+` and any
length. `tblCustomer` already holds `+919310500657`, `111`, `44774445555` and two 9-digit numbers —
on a column whose whole job is de-duplicating customers, and which the convert
engine is about to match on.

- **Rule:** strip every non-digit; drop a leading `91` from 12 digits or a
  leading `0` from 11; the result must be exactly 10 digits. Otherwise 400
  *"Mobile number must be 10 digits"*.
- **Where:** one backend helper, `utils/mobile.js` → `normalizeMobile(raw)`,
  called by the lead and customer save paths for `MobileNo` / `Mobile` /
  `AltMobile`. The backend is the trust boundary — the mobile app and any
  future caller get it for free.
- **SP:** `sp_SaveCustomer`'s two `LIKE '%[^0-9+]%'` checks become the 10-digit
  rule, so a bad number is a 400 with a message, not a constraint violation.
- **DB backstop:** `CHECK (col IS NULL OR col LIKE '[0-9]…×10')` on
  `tblLeads.MobileNo`, `tblLeads.AltMobile`, `tblCustomer.Mobile`,
  `tblCustomer.AltMobile`. A constraint, because app code is not the only
  thing that writes a database.
- **Web:** one `ui/MobileInput` (numeric keypad, strips non-digits as typed,
  max 10) + one zod `mobileSchema`, used by the lead form, the customer form
  and the quote's bill-to block. Mobile app: `keyboardType="number-pad"`,
  `maxLength={10}` on its customer form.
- **Existing data (in `091`, before the constraints):** rows that normalise
  cleanly are rewritten (`+919310500657` → `9310500657`); a rewrite that would
  collide with another active customer is skipped and printed for a manual
  merge. Rows that cannot be fixed (`111`, 9-digit typos — real customers with
  tickets) keep their record: the bad value moves into `Remarks` (*"Mobile on
  record was 903315499 — invalid, please correct"*) and `Mobile` becomes NULL,
  which the table already allows. Nothing is deleted, nothing is guessed.
- Not touched: `tblUser` mobiles and the ticket's free-text *reported by*
  contact — neither is a dedupe key.

### Images

Through the existing attachment pipeline (JWT-gated, `assertRecordAccess`,
never public): `ENTITIES` gains `quotation` and `quoteprofile` — in
`middleware/upload.js` **and** in `sp_SaveAttachment`, which hard-codes
`IF (@Entity NOT IN ('task','ticket','lead'))` and would otherwise refuse
every quote image with *Invalid entity*.

- Profile logo / header → `Entity='quoteprofile'`. The profile row points at
  them by Id. **Never deleted** — finalised quotes keep pointing at the logo
  they were issued with. (`ponytail:` no GC of superseded logos; they are a
  few hundred KB per change.)
- A one-quote override, and extra-section pictures → `Entity='quotation'`.
  Deletable only while that quote is a draft. This is why the builder creates
  the draft row immediately: an upload needs an `EntityId`.
- The builder accepts **PNG / JPEG ≤ 2 MB** only (checked client-side — the
  renderer cannot draw WebP/GIF; the generic pipeline already enforces the
  mime+extension whitelist, JWT and record access, so a stray WebP is a
  rendering failure, not a security one).
- Sample logo / header ship as static web assets; a template shows them when
  the id is null.

## 2. Lifecycle

### Quotation status

`draft` → `final` → `accepted` | `rejected`; plus two system closes:
`superseded` (replaced by a newer revision) and `unused` (the lead was won on
another quote or without one, or went lost/junk).

| Move | Proc | Rules |
|---|---|---|
| create / edit | `sp_SaveQuotation` | `@Id=0` insert. Refuses any status but `draft`. Lead must be active (`open`/`qualified`). Lines arrive as `@LinesJSON`, replaced wholesale; totals recomputed |
| finalise | `sp_FinaliseQuotation` | Lead must be active. ≥ 1 line; each line has a description, `Qty > 0`, `Rate ≥ 0`; `ToName` and `CompanyJSON.name` present; if `SellerGSTIN` is set then `SellerStateCode = LEFT(SellerGSTIN,2)` and `ToStateCode` is required. R1 takes the next counter value; **R2+ reuses the root's `SeqNo`** and gets the `-R<n>` suffix. The root's previous `final` → `superseded` |
| revise | `sp_ReviseQuotation` | Lead must be active (a won or lost lead's quotes are history). From `final` / `rejected` / `unused`. Copies header + lines into a new `draft`, `Revision = max+1`. If the root already has a draft revision, returns that one instead of making a second |
| reject | `sp_RejectQuotation` | `final` → `rejected`; remarks optional |
| accept | `sp_ConvertLead` with `@QuotationId` | below |
| delete | `sp_DeleteQuotation` | `draft` only; returns its attachment rows for unlinking |

Number format is fixed in the SP: `QT-<FinYear>-<SeqNo 4-digit>[-R<n>]`.
Numbered at finalise, not at create, so abandoned drafts burn nothing.

### Convert — the missing engine: `sp_ConvertLead`

`@CompId, @LeadId, @UserId, @WonValue DECIMAL(18,2) = NULL, @Remarks
NVARCHAR(500) = NULL, @QuotationId INT = NULL`. One transaction:

1. Lead must be `open`/`qualified`. Already `converted` → 200 "already won"
   (idempotent). Company has no `converted` lookup row → 400.
2. With `@QuotationId`: it must belong to the lead and be `final`;
   **`WonValue` = its `TaxableTotal`** and the passed `@WonValue` is ignored —
   GST is not revenue. Without: `@WonValue` required, `≥ 0`.
3. Customer: an active `tblCustomer` with the same `CompId` + the lead's
   `MobileNo` is **linked**; otherwise one is inserted from the lead (`Name` =
   lead's `Company` when present, else the lead's name, which then becomes
   `ContactPerson`; branch, address fields; `GSTIN` from the quote's `ToGSTIN`
   if any). A lead with no mobile always gets a new customer. The match is
   reliable because both sides are already normalised to 10 digits (§1,
   *Mobile numbers*).
4. Lead: `StatusId` → the `converted` row, `WonAt`, `WonValue`, `CustomerId`.
   Row in `tblLeadStatusHistory`. Activity `status` with
   `{toCode:'converted', wonValue, quotationId, customerId}`.
5. The quote → `accepted` (+ `CustomerId`); **every other `draft`/`final`
   quote on the lead → `unused`**.

`tblLeadStatusHistory` therefore has **three** writers: `sp_SaveLead`
(insert), `sp_SetLeadStatus`, `sp_ConvertLead`. CLAUDE.md §6 is updated to say
so; the "never elsewhere" rule otherwise stands.

### `sp_SetLeadStatus` — two small additions, the refusal stays

- Still refuses `→ converted`.
- **Leaving** `converted` (undoing a mistaken win): clears `WonAt` and
  `WonValue`; the lead's `accepted` quote returns to `final`. `CustomerId` and
  the customer stay — a ticket may already reference them.
- `→ lost` / `→ junk`: the lead's `draft`/`final` quotes → `unused`.

### GST arithmetic — one definition, two implementations

Per line: `Gross = Qty × Rate` · `Discount = pct ? Gross × v / 100 : min(v,
Gross)` · `Taxable = Gross − Discount` · `Tax = ROUND(Taxable × TaxPct / 100,
2)`. Seller unregistered → `Tax = 0`. Same state → `CGST = ROUND(Tax / 2, 2)`,
`SGST = Tax − CGST` (the odd paisa lands in one place, always the same one).
Different state → `IGST = Tax`. Header totals are sums; `GrandTotal` is rounded
to the rupee and `RoundOff` carries the difference.

The builder computes this live in `quoteMath.js` for the preview; the SP
computes it again and **the SP's numbers are the truth** — the downloadable
PDF of a final quote renders from the fetched row, never from client state.
Both are pinned to one fixture table (in the web test and in the script's
"verify after apply" block) so they cannot drift apart silently.

## 3. Backend

### SPs
New: `sp_SaveQuotation`, `sp_FinaliseQuotation`, `sp_ReviseQuotation`,
`sp_RejectQuotation`, `sp_DeleteQuotation`, `sp_FetchQuotations`,
`sp_FetchQuotationDetail`, `sp_FetchQuoteProfile`, `sp_SaveQuoteProfile`,
`sp_ConvertLead`.
Changed: `sp_SetLeadStatus` (above) · `sp_SaveProduct` / product fetch (+4
fields) · `sp_SaveCustomer` / customer fetches (+`GSTIN`) · `sp_FetchLeads`,
`sp_FetchLeadDetail` (+`WonValue`, `CustomerId`, `CustomerName`).
New params on existing procs default to NULL, so the old backend keeps working
between SQL apply and deploy.

- `sp_FetchQuotations` — paged list. **Same scope predicate and scope
  parameters as `sp_FetchLeads`**, applied to the joined lead (branch **and**
  owner, with the always-visible rule). Filters narrow within scope: `Status`,
  `OwnerId`, `BranchId`, `from`/`to` on `QuoteDate`, `SearchTerm` (quote no,
  bill-to name, lead name), `LeadId` (the lead page's section).
- `sp_FetchQuotationDetail` — RS1 header **carrying the lead's `OwnerId`,
  `BranchId`, `CreatedBy`** under those exact names (the quote's own creator is
  `QuoteCreatedBy`), so `canSeeRecord` works on it unchanged · RS2 lines · RS3
  the root's revisions.

### Reports — success now has two codes
Small leads go `open → converted` without ever being `qualified`. Every report
proc that treats `qualified` as *success* or as a *terminal* must include
`converted`, or won-without-qualifying leads vanish from the funnel:
`sp_RptFunnel`, `sp_RptLeaderboard`, `sp_RptPipelineValue`, `sp_RptAging`,
`sp_RptLost` — the exact lines are in the plan. (`sp_RptFollowUpCompliance` was
audited and needs nothing: it only uses the *active* set, which is already right.) **No report changes shape** (the 12-param / 3-result-set contract
stands). `sp_Dashboard` adds two stat rows, `WonMonth` and `WonValueMonth`.
Won-value KPIs inside the report pages are a follow-up (see Out of scope).

### Endpoints (POST-per-action)
`/api/quotations`: `saveQuotation` · `fetchQuotations` · `fetchQuotationDetail` ·
`finaliseQuotation` · `reviseQuotation` · `rejectQuotation` · `deleteQuotation` ·
`ensureQuoteProfile` · `saveQuoteProfile`. `/api/leads/convertLead`.

### Rules
- Every quotation endpoint resolves the parent lead and runs
  `assertRecordAccess(req, res, 'lead', leadId, level)` — `view` for reads,
  `write` for the rest. `convert` likewise. A quote is part of its lead; there
  is no second permission model.
- `ENTITY_LOOKUP` gains `quotation` (`sp_FetchQuotationDetail`, `QuotationId`,
  `OwnerId`) for attachment access, and `quoteprofile`, which is
  **company-wide readable** (found under the caller's `CompId` = granted).
- Profile write: allowed to anyone while `IsSet = 0` (first fill — nothing to
  lose); afterwards **admins only** (`req.scope.isAdmin`). One agent's GSTIN
  typo must not become everyone's default. Editing the company block *on a
  quote* is always allowed and touches only that quote.
- Attachment delete: refused for `quoteprofile`; for `quotation` only while
  the quote is a draft.
- `sp_SaveLookup` / delete: the `converted` row's `Code` cannot be changed and
  the row cannot be deactivated or deleted. Label and sort stay editable.
- `sp_DeleteLead` refuses (409) while the lead has **any** quotation. Leads carry
  no DB-level FKs — `sp_DeleteLead` clears children by hand — and an issued
  quotation is a business record; deleting drafts silently would orphan their
  uploaded images. The user deletes the drafts first.

## 4. Web

`web/src/pages/Sales/Quotations/`

- **`QuotationBuilder.jsx`** — a full page, `/sales/quotations/:id` (a modal
  is too small for form + live PDF). Left: accordion form — Customer ·
  Company · Lines · Message & terms · Extra sections · Look (template, accent
  swatches). Right: the live preview. Header actions by status: draft → Save ·
  Finalise · Delete; final → Download · Revise · Accepted · Rejected; closed →
  Download · (Revise where allowed). Everything is read-only off `draft`.
- **Preview is the PDF.** `@react-pdf/renderer` 4.9 (peer range includes
  React 19), **lazy-loaded** with the builder route so it costs the rest of
  the app nothing. `usePDF` + a 500 ms debounced `update`; the blob URL goes in
  an `<iframe>`. What they see is the file they download — there is no second
  renderer to drift. Download name: `QT-2627-0042 - Ramesh Patel.pdf`.
- **Templates** — `templates/classic.jsx`, `modern.jsx`, `minimal.jsx`, one
  registry `templates/index.js` (`code, name, thumbnail, Component`). Shared
  parts in `pdf/parts.jsx` (`LineTable`, `TotalsBlock`, `GstSummary`,
  `ExtraSections`, `Footer` with page numbers, DRAFT watermark). Templates
  differ in header, colour use and typography only. **A template is never
  redesigned in place** — final quotes re-render from it forever; a breaking
  redesign ships under a new code.
- **Pure, heavily tested modules:** `quoteMath.js` · `gst.js` (36
  states/UTs with GST codes, seller state from GSTIN, split rule, GSTIN shape)
  · `amountInWords.js` (Indian lakh/crore) · `finYear.js` ·
  `buildQuoteDoc.js` (row + lines + image blobs → the view-model every
  template takes).
- **Fonts:** Inter and Noto Serif, each in Regular / Italic / Bold / Bold
  Italic (8 TTFs, OFL). All four are required per family — the renderer
  *throws* on bold-italic text if that variant is not registered. The renderer
  fetches a file only when a quote uses it; the editor loads the same files
  through `@font-face` so what is typed matches what prints. The 14 built-in
  PDF fonts are not offered: none of them has **₹** (U+20B9).
- **Rich text — `ui/RichTextEditor`** (Tiptap 3.31, MIT, React 19 in its peer
  range). Chosen on numbers, not taste: 17.2 M npm downloads a week against
  Quill 6.6 M, Lexical 5.1 M, Slate 2.5 M, TinyMCE 1.0 M, CKEditor 0.9 M
  (npm, 2026-09-18); colour / size / font / tables were moved from Pro to MIT
  in 2025; and it is headless, so **we build the toolbar** — which matters
  more than it sounds, see the next bullet. Used for the message, terms, notes
  and every extra text section. Lives in `ui/` because the next feature that
  needs formatted text must not build a second one.
  Toolbar: bold · italic · underline · strike · text colour · highlight ·
  size (9–24) · font (Inter / Noto Serif) · align left / centre / right /
  justify · line height · H1–H3 · bullet + numbered lists (nesting) · table
  (add / remove row + column, header row) · link · divider · quote · undo /
  redo. Colour pickers are a swatch row plus the native
  `<input type="color">`.
- **Rich text → PDF: `react-pdf-html`** turns the editor's HTML into react-pdf
  primitives inside the template. **Proved before it was specified**
  (throwaway spike, 2026-09-18, React 19 + renderer 4.9 + react-pdf-html
  2.1.5, real PDF, 130 ms): every toolbar item above drew correctly, ₹
  included.
- **The rule the spike found: a tag the converter does not know is dropped
  *with its words*.** Tiptap's `Highlight` emits `<mark>`; the highlighted
  sentence vanished from the PDF — no error, one console line. So:
  (a) highlight uses `BackgroundColor` from `TextStyleKit` (a styled `<span>`,
  which draws) and `Highlight` is not installed; (b) **the toolbar is a closed
  list** — nothing is offered that was not seen drawing; (c) the converter is
  given a fallback renderer that prints an unknown tag's children as plain
  text, so the worst case is lost *formatting*, never lost *words*; (d) a test
  walks every toolbar feature's HTML through the converter and fails on any
  "excluded" tag.
  Deliberately **not** offered because they do not survive: merged cells,
  column resizing (`<col>` is dropped → the PDF would ignore the widths they
  dragged), inline images (the attachment endpoint needs a JWT an `<img src>`
  cannot send — pictures go in picture sections, which fetch properly).
- Pasted Word / web content is reduced to the schema by Tiptap itself, so a
  paste cannot introduce an unknown tag. Links are limited to `http(s)`,
  `mailto`, `tel`. Stored HTML is only ever shown through a read-only editor
  or the PDF — never `dangerouslySetInnerHTML`.
- If `react-pdf-html` is ever abandoned (last release 2025-12, 150 k/week):
  the schema is closed, so the exit is our own Tiptap-JSON → react-pdf mapper,
  a few hundred lines. Not built now.
- **Finalise guard (web):** refuses while the sample logo is still showing or
  the company name is empty — *"Replace the sample logo or remove it."* A
  logo can be removed outright.
- **`LeadDetail.jsx`** — a Quotations section (list via `fetch` with
  `LeadId`; Create button on active leads). The status dropdown **now offers
  Won**; choosing it opens `WonDialog` (value pre-filled from `EstValue`,
  remarks, and — when the lead has final quotes — the "which quotation?"
  choice) and calls `convert`, never `setLeadStatus`. A won lead shows a Won
  banner: value, customer name, accepted quote. The comment at line 91
  explaining why `converted` is filtered out is rewritten, not just deleted.
- **`QuotationList.jsx`** — `/sales/quotations`, `useServerTable`, filters in
  the labelled-filter pattern (status · owner · branch · date range), row
  click → builder.
- **Leads list** — a **Won** preset (`StatusCode: 'converted'`); value column
  shows `WonValue` for won leads.
- **`Settings/Products.jsx`** — HSN, GST %, unit, description.
  **`CustomerFormModal`** — GSTIN. **`LookupMaster`** — the `converted` row is
  visible with its Code locked.
- **Dashboard** — the leads-trend tile subtitle gains *Won this month: N ·
  ₹X*. Its `Converted` series starts drawing on its own (`WonAt`).
- **Cleanup:** `jspdf` and `jspdf-autotable` are installed and imported by
  **nothing** in `web/src`. Removed.
- API: `web/src/api/quotationQueries.js`; nothing inlines an endpoint.

## 5. Mobile

Nothing. Sales is Phase C and unbuilt. The new lead/customer columns are
additive; `src/types/api.ts` picks up `GSTIN` when Phase C is written.

## 6. Testing

- **Backend (Jest):** `quotationController` — every endpoint: happy path, 403
  through the parent lead, draft-only refusals, profile first-fill vs admin
  rule. `leadController.convert` — with quote / without / value missing / not
  permitted. Attachment delete guards. `tenancyContract.test.js` covers the
  new controller. ≥ 80 % on touched files.
- **SP contracts against the live DB** — mocked tests cannot see a missing
  proc or a renamed column. After apply: `sys.sql_modules` check for all ten
  new procs **in both DBs**, and the fixture table in the script's verify
  block.
- **Web (Vitest):** the pure modules exhaustively — intra/inter-state,
  unregistered seller, pct vs amt discount, the odd-paisa split, round-off,
  FY boundary (31 Mar / 1 Apr), lakh/crore words. Templates render under a
  test double that maps react-pdf primitives to DOM (`test/reactPdfMock.jsx`)
  — jsdom cannot run the real renderer — asserting *content*: IGST column only
  inter-state, tax columns gone for an unregistered seller, DRAFT watermark
  only on drafts, sample logo only when the id is null. Builder, WonDialog,
  list, LeadDetail section as page tests.
- **Rich text:** the closed-toolbar guard above; link protocol allowlist;
  `normalizeMobile` table-tested (`+91…`, `0…`, spaces, dashes, 9 and 11
  digits, junk) on the backend and `mobileSchema` on the web.
- **What jsdom cannot see** — the actual PDF. A live verification pass like
  spec 2's: all three templates × (intra / inter / unregistered) × (1 page /
  line table that breaks across pages / extra picture section), opened and
  looked at, plus the full flow end to end on both clients' data. Written up
  in `docs/testing/`.

## 7. Rollout

1. `091_quotations.sql` on `eCRM+` **and** `SolarCRM` (user-applied, §0.2).
2. Backend deploy, both services (`crm`, `crm_solar`) — user-run (§0.6).
3. Web build → IIS.
4. Re-login to pick up the Quotations menu row (menu rights load at login).
The gap between steps 1 and 2 is safe: new proc params default NULL and the
new endpoints are additive, so the old backend runs unharmed on the new schema.

## 8. Docs

CLAUDE.md §6 Sales: the convert engine, the third status-history writer,
quotations, "a template is never redesigned in place". `backend/ROLES.md`:
`convert` and the quotation writes join the gated write-path list. Notion:
Done + Change Log, dated.

## Out of scope / known

- Direct send, e-sign, customer-facing accept link.
- Invoice, commission, payments — and therefore any tax-invoice compliance;
  this document is a quotation.
- Mobile.
- A free-form designer; user-authored templates.
- Any language but English (decided 2026-09-18).
- In rich text: inline images, merged table cells, column resizing — each
  fails to reach the PDF today (see §4).
- Won-value KPIs *inside* the sales report pages (a "Won" report, won value on
  the leaderboard) — spec 4b. This spec only keeps existing reports correct.
- Overall (header-level) discount; multi-currency; per-line tax-inclusive
  pricing.
- A customer's quotation history on the customer screen.
