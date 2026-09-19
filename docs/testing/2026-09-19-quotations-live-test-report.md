# Quotations + lead conversion — live verification pass

**Date:** 2026-09-19
**Environment:** `eCRM+` (company PRD, CompId 1) through the deployed API at
`https://shadowcodes.in/CRM`. `091_quotations.sql` applied to both client
databases by the owner; backend deployed to both containers and confirmed running
the new code (file sizes inside `nexus_crm` and `nexus_crm_solar` matched local).
**Method:** scripted end-to-end runs (`fetch`, Node 22) logging in as each
persona, plus 27 PDFs rendered from the shipped template code and read by eye.
Credentials were supplied at run time through an environment variable and appear
in no file, no command history entry that survives, and nowhere in this report.

**Result: 231 API checks, 27 PDFs. Two real defects found, both fixed and
re-verified live. Complaints regression-tested and unaffected. An adversarial
pass — races, the exhaustive state machine, money boundaries, hostile input and
cross-account access — found one further, low-severity behaviour, recorded in
§3b and deliberately not fixed.**

---

## 1. What was exercised

| # | Area | Checks | Outcome |
|---|---|---|---|
| 1 | Personas sign in (5 roles across 2 branches) | 5 | pass |
| 2 | Lead creation, lookups, the Won status row | 8 | pass |
| 3 | Quote profile — created empty, filled, branch-scoped | 5 | pass |
| 4 | Draft quotation and its arithmetic | 7 | pass |
| 5 | Finalise, numbering, immutability | 6 | pass |
| 6 | Revise, supersede, list filtering | 7 | pass |
| 7 | **Won with a quotation** | 8 | pass |
| 8 | **Won with no quotation at all** | 4 | pass |
| 9 | Customer matching on the mobile | 2 | pass |
| 10 | The status engine still refuses `converted` | 3 | pass |
| 11 | **Lost / junk / rejected** | 8 | pass |
| 12 | Delete guards | 2 | pass |
| 13 | Scope across roles and branches | 5 | pass |
| 14 | Profile: open until set, admin after | 2 | pass |
| 15 | The ten-digit mobile rule | 4 | pass |
| 16 | Reports and dashboard read the win | 9 | pass |
| 17 | Transfer moves visibility | 4 | pass |
| 18 | Attachment guards | 5 | **1 defect** |
| 19 | Cross-branch letterhead | 2 | pass |
| 20 | PDF matrix, 3 templates × 3 tax cases × 3 layouts | 27 files | **1 defect** |

## 2. The two defects

### 2.1 A WebP logo was accepted and then silently vanished from the PDF — **fixed and live**

`image/webp` is in the upload allow-list, shared with tasks and complaints where a
browser renders it perfectly well. But `@react-pdf/renderer` draws only PNG and
JPEG: handed a WebP it logs `Not valid image extension` and renders the page
**without the image, without throwing**. Proved by rendering two PDFs from the
same source image — the PNG produced one embedded image, the WebP produced zero.

A user uploads a WebP logo (what most websites now serve), the upload succeeds,
and their quotations go out with a hole where the letterhead should be. Nothing
tells them why.

**Fix:** `quotation` and `quoteprofile` uploads now accept only `.png`, `.jpg` and
`.jpeg`, refused with *"A quotation picture must be a PNG or a JPEG — a PDF cannot
draw anything else"*. WebP remains legal for every other entity. Covered by nine
new tests; `upload.js` is at 100 % on every metric.

**Re-verified on the redeployed server (2026-09-19):** a `.webp` letterhead is
refused 400 with that sentence, a `.gif` likewise, a `.png` still uploads — and a
WebP on a *complaint* is still accepted, because a browser draws it perfectly
well. The rule is scoped to the two entities whose images end up in a PDF.

### 2.2 The line table's header did not repeat across pages — **fixed**

A 34-line quotation runs to three pages. Page 2 opened straight into numbers with
no column labels, and Rate, Disc. and Amount are all currency — a customer cannot
tell which is which. Found by looking at the rendered pages, not by any assertion.

**Fix:** the header row is now `fixed`, so it repeats on every page the table
spans. Verified both directions: it appears on page 2, and does **not** bleed onto
page 3 where the table has ended. Pinned by a test.

## 3. Things worth knowing that are working as designed

- **GST is not revenue.** Winning a lead against a ₹3,02,400 quotation recorded
  `WonValue` = **₹2,70,000**, the before-tax total, and ignored the ₹9,99,999 the
  client sent alongside it.
- **A quotation is optional.** A ₹4,000 win with no quotation succeeded and
  created its customer. A win with neither a quotation nor a value was refused
  with *"Enter the value this lead was won for"*.
- **The mobile is the identity.** Two leads on the same number produced **one**
  customer (Id 46), not two.
- **One engine writes a win.** `setLeadStatus → converted` is still refused with
  *"Use convert to move a lead to Converted"*.
- **Undoing a win is clean.** Moving a won lead back to an open status cleared
  `WonValue`, returned the accepted quotation to `final`, and kept the customer.
  The dashboard's `WonMonth` dropped from 4 to 3 accordingly.
- **Closing a lead closes its quotations.** Lost and junk both turned the open
  quotation `unused`, and revising on a closed lead is refused with *"This lead is
  closed — its quotations are history now"*.
- **Numbering.** `QT-2627-0001` … `QT-2627-0008` — per company, per Indian
  financial year. A revision reuses its root's number: `QT-2627-0001-R2`.
- **Scope holds.** An executive in another branch saw none of it, got 404 opening
  a quotation directly and 403 acting on it. After a transfer she could see it —
  and so could the original creator, which is correct: this codebase's universal
  rule is that a record you created stays visible to you.
- **The letterhead follows the lead's branch**, not the caller's: a HEAD OFFICE
  lead returned profile 1, a SOUTH EXTENSION lead profile 2, for the same admin.
- **A letterhead image can never be deleted**, and a finalised quotation refuses a
  new picture with *"Only a draft quotation's pictures can be changed"*.
- **The funnel counts a converted lead as qualified-or-better.** Three leads went
  `open → converted` without ever being qualified; today's funnel counts 4
  qualified.

## 3a. Complaints — regression-tested, unaffected

This feature changed four things the complaints module depends on:
`middleware/permission.js` (shared entity gating), `middleware/upload.js`
(attachment rules), `customerController.js` (customers are the complaints
module's own records, and the mobile rule now applies to them) and
`sp_SaveCustomer` in `091`. Those were tested rather than complaints generally.

- **The customer record.** A formatted mobile (`+91 98250 12345`) stores as ten
  digits; an 11-digit number is refused; the same mobile twice is refused 409
  *"Another customer already has this mobile number"*; a customer with only an
  email still saves. The tightened `sp_SaveCustomer` rule did not break the
  email-only path.
- **The complaint lifecycle is untouched.** Resolve without a resolution → 400;
  without remarks → 400; properly → 200 with `ResolvedAt` stamped. The agent
  cannot reopen his own complaint (*"Reopening requires a manager"*); his team
  lead can, and the reopen cleared `ResolvedAt` and restarted the clock. Reject
  without remarks → 400, with remarks → 200.
- **TAT still computes.** A complaint on a 168-hour priority came back with
  `DueAt − CreatedAt` = **168.00 h**.
- **Scope still holds.** The other-branch agent saw none of it and got 404
  opening it directly.
- **Attachments stayed correct in both directions.** WebP still uploads to a
  complaint; the same file is refused on a quotation.
- **A complaint can be raised against a customer that a won lead created** — the
  two modules meet at `tblCustomer` and that join works.

## 3b. Adversarial pass — 98 further checks

Everything above tested that the feature works. This tested whether it can be
broken.

**Concurrency — the defect class that took three review rounds to close.**
- Two simultaneous finalises of one draft: exactly one wins, the other gets 409,
  and the number the winner was told is the number stored.
- **Eight** simultaneous finalises: one 200, seven 409, one number issued.
- Twelve save-versus-finalise interleavings: **six came back `409/200`** — the
  save refused *because* the finalise won the race. That is the guard firing
  under real concurrency against production. No stored row ever disagreed with
  its own lines, and no finalised row could be rewritten afterwards.
- Two simultaneous revises return the *same* draft; two simultaneous conversions
  create *one* customer and answer 200 twice.
- **Quote numbers: 28 issued, 28 distinct, consecutive with no gaps** — the
  losing racers burn nothing.

**The state machine, exhaustively.** Every one of finalise / revise / reject /
delete was attempted from every one of draft, final, rejected, accepted and
unused — 20 transitions. Every refusal was correct and every message named the
real reason (e.g. *"Only a finalised, rejected or unused quotation can be
revised"*, *"This lead is closed — its quotations are history now"*).

**Money.** The F1/F2/F4/F5 fixtures matched the SP to the paisa through the live
API, odd-paisa split included. Boundaries all behave: a discount larger than the
line caps at zero, 100 % and 150 % discounts land on zero, a zero-rate line is
legal, a fractional quantity (0.001) is exact, and 9,999 × ₹999,999.99 does not
overflow.

**Nothing can inflate a total.** A negative discount, a negative percentage
discount, a negative quantity, a negative tax rate and a 999 % tax rate were all
clamped toward zero or capped — in every case the grand total stayed at or above
the taxable value and never went negative.

**Hostile input.** Refused with a usable sentence: `Lines` as an object or a
string, 201 lines, an unknown template, a 2 MB rich-text body, a non-existent
lead, and a lead in someone else's branch. Accepted correctly: exactly 200 lines,
and a null template code (it defaults to `classic` by design).

**Access.** Another branch's executive was refused on every surface — reading a
quotation (404), finalising it (403), deleting it (403) and converting its lead
(403).

**Issuing an incomplete quotation is impossible.** An empty draft may be *saved*
— you are still building it — but finalise refuses with *"Add at least one line
before finalising"*, and a line with no description or a zero quantity is refused
with *"Every line needs a description and a quantity"*.

**The tax split cannot be forged.** The seller's state is taken from the GSTIN's
first two digits; a client claiming the seller sits in state 27 did not turn IGST
into CGST. No seller GSTIN means no tax of any kind. A nonsense place of supply
is refused: *"Place of supply must be a 2-digit state code"*.

**Deep revision chain.** `QT-2627-0031 → -R2 → -R3 → -R4`: every revision keeps
the root's number, the three older ones are `superseded`, and the list shows one
row for the chain.

**List filters narrow, never widen.** A status filter returned only that status
and a subset of the whole; an executive never saw more than the admin; pages do
not overlap; a future date range and a nonsense search both return nothing.

### The one finding — recorded, not fixed

**A negative line value is silently clamped to zero rather than refused.** Sending
`rate: -500` stores `Rate: 0`, and the quotation can then be issued with a ₹0
line where the caller meant −500. The same clamping applies to negative
quantities, discounts and tax rates.

It is **not** fixed, deliberately:
- it fails *safe* — everything clamps toward zero, and no hostile value can
  inflate a total;
- the builder blocks negative entry, so it is unreachable through the UI;
- fixing it means another hand-applied SQL script on two production databases.

One consequence worth knowing: because a negative can never be *stored*,
`sp_FinaliseQuotation`'s `Rate < 0` guard is dead code. It is not protecting
anything, and nobody should assume it is. If a direct API integration is ever
built against this, refusing rather than clamping becomes worth doing.

## 4. Not covered by this pass

- **Step 3, the browser checks** — pasting `+91 98250 12345` into the field,
  pasting formatted text from Word into the editor, the download filename. The
  underlying rules are covered by unit tests and by the API checks above; what is
  untested is the behaviour of a real browser's paste.
- **`SolarCRM`** — exercised only through `/health` and the contract queries. It
  has no users seeded (`090_solarcrm_seed_test_users.sql` is still pending), so
  there is nobody to log in as.
- **A quotation with a real uploaded logo end to end** — the attachment guards
  were tested, but no PDF was rendered from a user-uploaded image.

## 5. Test data left in `eCRM+` — needs removing

Everything is named `LIVE TEST Q …`.

- **Leads 623–677** (55). **Six are still `Won`**, carrying **₹17,000** between
  them — they are in this month's `WonMonth` / `WonValueMonth` and in the funnel,
  aging and leaderboard reports until removed.
- **Customers 44–52** (9). Customer deletion is admin-only.
- **Complaints 64, 65, 66** — raised during the regression check above.
- **Quotations 1–75 (67 rows, 36 of them issued).** Note: **a finalised quotation cannot be deleted** — by
  design. Ids 9, 10, 12, 20 are `final`, 8 is `superseded`, 11/16/17 `unused`,
  14 `rejected`. Only the drafts (13, 18, 19) can be removed through the app.
  Removing the rest means deleting rows directly, and the leads must go first
  (`sp_DeleteLead` refuses a lead that has quotations).

Suggested order: delete the three drafts in the app → delete the quotation rows
for these leads → delete the leads → delete customers 44–47.

## 6. Verdict

The engine is sound. Every rule the spec cares about — who may see what, who may
write what, what a win is worth, what happens to a quotation when the deal dies —
behaved correctly against live data on the first pass, and the two defects found
were both in the presentation layer rather than the money or the permissions.

**Ready for clients once:** the web build carrying the repeating-header fix is
uploaded, and the test data in §5 is removed so it stops appearing in reports.
The backend carrying the WebP fix is already deployed to both containers and
re-verified.
