# Partner leads and commission — design

2026-10-10 · status: built (final shape below supersedes the first draft)

## Why

Companies like PRD get leads from market partners (people/firms who hear of a
need and pass it on by phone, WhatsApp, mail). Staff enter those leads. Today a
lead can only say Source = "Referral" — not *which* partner, and there is no
record of what the partner is owed. This adds partners as records, ties a lead
to the partner who sent it, and tracks the commission from earned to paid.

Out of scope (later): a lead-form link per partner, a partner login/portal,
mobile UI, auto-assigning a partner's leads to one person.

Bundled fix: a lead's creator stops seeing it once it is moved to someone else
(§6).

## 1. Partners

`tblPartner` — per company (not per office: a market partner feeds whichever
office is nearest).

| Column | Notes |
|---|---|
| Id, CompId | |
| Name | required |
| ContactPerson, Email, City, Notes | optional |
| Mobile | ten digits (`utils/mobile.js` rule), unique per company among active partners |
| CommType | `pct` / `fixed` / NULL — the partner's **usual** rule, a default only |
| CommValue | DECIMAL(12,2), NULL when CommType is NULL |
| IsActive | deactivate, never delete once a lead names the partner |
| CreatedBy, CreatedAt, UpdatedAt | |

Partners are listed by a single `fetchPartners` (the page and the lead-form
picker share it; the picker asks for active ones only). A partner is saved
by `sp_SavePartner`; an inactive one can be reactivated from the list.

Screen: **Sales → Partners**, tab *Partners* — MRT list (name, mobile, city,
usual rule, leads sent, converted, due), add/edit in a `Modal`, deactivate.

## 2. Partner on the lead

`tblLeads` gains `PartnerId` (NULL), `CommType`, `CommValue` — the commission
terms **for this lead**, decided lead by lead.

- Lead form: a **Partner** picker (active partners). Choosing one fills
  CommType/CommValue from the partner's usual rule (blank if none) and sets
  Source to the company's `lead_source` row with `Code = 'partner'` (seeded as
  "Partner" for every company that lacks one). Clearing the partner clears the
  terms; Source is left as it is.
- The partner and terms are saved inside `sp_SaveLead` (same transaction, which
  also runs the commission sync) — there is no separate set-partner proc.
- Terms are shown and editable only to callers with `partners` view; others see
  the partner's name and the terms default silently.
- On a **won** (`converted`) lead, changing the partner (or, for a viewer, the
  terms) needs `partners` **edit**; otherwise 403 "Only someone with commission
  rights can change the partner on a won lead". Re-sending the same values is
  not a change.
- Leads list: Partner column + filter (`PartnerId` in the URL, like `SourceId`).
- Existing leads untouched (`PartnerId` NULL).

## 3. Commission

`tblPartnerCommission` — one live row per converted partner lead.

| Column | Notes |
|---|---|
| Id, CompId, LeadId, PartnerId | |
| BaseValue | the lead's `WonValue` at conversion (before tax) |
| CommType, CommValue | copied from the lead at conversion |
| Amount | DECIMAL(14,2): `pct` → ROUND(BaseValue × CommValue / 100, 2); `fixed` → CommValue |
| Status | `earned` → `due` → `paid`; or `cancelled` |
| EarnedAt; DueAt, DueBy; PaidAt, PaidBy, PaidRef | |
| Reverted | bit — set when the lead leaves `converted` after it was paid |

Rules, all in SQL (one writer each, like the rest of the schema):

- **One sync, three callers** — `sp_SyncPartnerCommission` brings the lead's
  live row in line with the lead. `sp_SaveLead`, `sp_ConvertLead` and
  `sp_SetLeadStatus` call it inside their own transaction; it is idempotent.
- **Earned** — a converted lead with a partner and terms gets a row. No terms →
  no row (a partner lead with no commission is allowed).
- **Due** — company setting `CommissionDueOn` (`tblCompanySetting`):
  `manual` (default, PRD's choice): stays `earned` until someone marks it
  *Ready to pay*. `convert`: inserted straight as `due`.
- **Status changes** — one proc, `sp_SetCommissionStatus` (ids, target status,
  PaidAt, PaidRef), many ids at once: `earned → due → paid`. Paying twice is a
  409, never a second payment.
- **Lead leaves `converted`**: an unpaid row → `cancelled`; a paid row stays
  `paid` with `Reverted = 1` and shows flagged.
- **Converting again** restores the newest paid-and-reverted row
  (`Reverted = 0`) and inserts nothing — a settled commission is never
  recomputed and never paid twice. With no such row, a fresh one is inserted.
- **Lead edited after conversion** (partner, terms or WonValue): an `earned` /
  `due` row is recomputed in place; a `paid` row is never touched, and
  changing the partner on a paid lead is refused (409).
- **A lead that has commission rows cannot be deleted** (`sp_DeleteLead`, 409).

Screen: **Sales → Partners**, tab *Commissions* — MRT list (partner, lead,
won value, terms, amount, status, dates), filters (partner, status, date),
row select → *Ready to pay* / *Mark paid* (date + reference).

Setting: **Settings → Work settings** gains "Commission becomes payable:
when we mark it / as soon as the lead converts"; it travels with the other
work settings (`sp_FetchWorkSettings` / `sp_SaveCompanySetting`), not a proc of
its own.

## 4. Partner report

`sp_RptPartners` on the shared report contract (12 params, RS1 KPIs, RS2
`GroupKey/GroupLabel` = partner, RS3 trend), same lead-scope predicate as the
other `sp_Rpt*`. Columns: leads sent, converted, conversion %, won value,
earned, due, paid. Row click → `/sales/leads?PartnerId=…` (+ range when basis
is `created`). Menu: Reports → Sales → Partners.

## 5. Permissions

New module **`partners`** (Groups screen, View/Add/Edit/Delete, reach ignored —
partners are company-wide):

- View: Partners page, commission terms and amounts, Partner report amounts.
- Add/Edit: add/edit/deactivate/reactivate partners; mark *Ready to pay* / *Paid*;
  change the partner on a won lead.
- Seeded for Owner and Admin (`IsAdmin` groups) only; others get it in Groups.
- Picking a partner on a lead needs only the lead's own add/edit right (except
  on a won lead, above); the picker uses `fetchPartners`, which hides terms
  from callers without `partners` view.
- Commission rows are company-wide for holders of `partners` view (an accounts
  person must see every partner's dues regardless of lead reach).

## 6. Fix: moving a lead really moves it

Today a lead stays visible to whoever **created** it, even after an admin moves
it to someone else (`OwnerId = me OR CreatedBy = me` beats reach). New rule for
leads: always visible to the **current owner**, and to its creator **only while it
has no owner** (an "assign later" lead must not vanish from the person who made
it): `l.OwnerId = @UserId OR (l.OwnerId IS NULL AND l.CreatedBy = @UserId)`.
Once anyone owns it, the creator loses it; anyone else sees it through their
role's reach (managers still see their team's leads).

Touches: `sp_FetchLeads`, `sp_FetchFollowUps`, `sp_FetchQuotations`, the eight
`sp_Rpt*` sales procs and `sp_RptActivity`/`sp_RptTransfers` (the `CreatedBy`
arm becomes "creator while unowned" — 107 Step 7 strips it, Step 7b adds the new
predicate), and `permission.canSeeRecord` for `lead` / `quotation`
(tickets keep the creator rule — out of scope). `backend/ROLES.md` and
CLAUDE.md §3 "universal rule" updated to say *owner*, not *created by*, for
leads.

## 7. Delivery

Per CLAUDE.md phasing: one SQL script (tables, columns, `partner` source seed,
setting, module + menu rows, all SPs incl. the §6 edits) applied to **TestCRM
first**; backend (controllers, routes with declared access, tests); web
(Partners page, lead form/list, report, setting; tests). Mobile untouched.

## 8. Edge cases the tests must pin

- `pct` with WonValue NULL or 0 → Amount 0, row still created and visibly 0.
- Two staff mark the same row paid at once → second call is a no-op error,
  not a double pay.
- Deactivated partner: still shown on old leads and reports, not offered in
  the picker.
- Duplicate partner mobile → 400 with a plain message.
- Lead moved A → B: A gets 403 on detail and no row in list/reports; A's
  manager still sees it.
