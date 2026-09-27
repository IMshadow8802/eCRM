# Web responsive / UI audit — 2026-09-19

Eight review agents read every non-test file in `web/src`, one area each,
against a shared rubric: seven target viewports from 360x740 to 1920x1080,
with a defect only counted when it could be named at a viewport with a visible
symptom. **~84 findings, 18 of them BREAKS** (content clipped, unreachable, or
unusable).

## The number that frames it

| Measure | Count |
|---|---|
| non-test `.jsx` under `web/src` | 169 |
| files containing ANY MUI breakpoint | **9** |
| files calling `useMediaQuery` | **3** (RootLayout, Sidebar, TopNav) |
| `@media` written inside `sx` | 0 |

The shell and the login screen were built responsive. Almost nothing else was.
Where a page did survive a narrow screen it was by accident — someone reached
for `repeat(auto-fill, minmax(Npx, 1fr))`, which collapses on its own.

**`<main>` has `overflowX: hidden`** (`RootLayout.jsx`), so content that is too
wide is *clipped, not scrollable*. That is why so many of these are BREAKS
rather than cosmetic: the button is not off to the side, it is gone.

## What was fixed

### The primitives — one edit each, every page repaired
| File | Was | Now |
|---|---|---|
| `ui/Tabs.jsx` | `inline-flex`, no wrap, no scroll | scrolling strip, `flexShrink: 0` on tabs |
| `ui/PageHeader.jsx` | actions `inline-flex; flexShrink: 0` | wraps |
| `ui/Modal.jsx` | inline `calc(100vh - 48px)` | `.ui-modal-dialog` class, `vh`→`dvh` fallback; footer wraps |
| `ui/IconButton.jsx` | `sm` = 28px | 32px |
| `ui/Chip.jsx` | `nowrap`, uncapped | capped + ellipsis |
| `ui/Menu.jsx` | `flex: 1`, no `minWidth: 0` | truncates properly |
| `ui/Drawer.jsx` | `maxWidth: 100vw` | `100%` |
| `ui/NumberInput.jsx` | `type="number"` + custom ± = two steppers | `type="text"` + `inputMode="decimal"` |
| `ui/RichTextEditor.jsx` | 356px link row in a 328px popover | wraps; fluid input |
| `table/tableDefaults.js` | search `minWidth: 260` pinned the toolbar | responsive floor, toolbar wraps, table `minWidth`, `dvh` cap |

`ui/Tabs` alone was reported independently by **five** areas — Reports,
Support, Tasks, Settings and Quotations. On Complaints, a phone user could
never reach *On hold*, *Closed* or *All*.

### App-wide
- **iOS focus-zoom on every input.** Controls are 13-15px; iOS Safari zooms
  below 16px. One `@media (pointer: coarse) and (max-width: 767.98px)` rule.
- **`100vh` → `100dvh`** in seven places.
- **Poppins deleted** from `index.html` — render-blocking, and unused since
  the Inter switch.
- **`resolve.dedupe`** for react / react-dom / emotion in `vite.config.js`.

### Individually
Offline banner no longer covers the TopNav (it was `position: fixed;
z-index: 9999` over the hamburger — going offline locked a phone user out of
navigating, permanently if the network merely blocks google.com) ·
notification panel no longer clipped 32px · 404 page rebuilt on `EmptyState`
(it was the one page in raw Tailwind: a white slab in dark mode, plus a
`<style jsx>` block leaking keyframes into every other page) · kanban drag
works on touch · quotation draft can be downloaded and opened full size ·
sidebar drawer corners squared · lines editor, template picker, sample chip,
sticky preview, KPI cards, dashboard tablet layout, bar-chart labels, filter
rows on Leads and Quotations, Groups permission matrix, avatar pickers,
sidebar label truncation, rich text in dark mode, attachment filenames.

**53 files changed. 1,748 tests pass. 0 lint errors.** Every fix carries a
regression test naming the viewport and the symptom.

## What is NOT fixed

| # | Where | Why it is still open |
|---|---|---|
| 1 | `ui/RichTextEditor` toolbar | 841px of buttons wraps to 4 rows above a 120px editor on a phone. The fix is an overflow menu under `sm` — a redesign, not a property. |
| 2 | `TaskDetailModal` column select | `canDragCard` lets an **assignee** move a card; the modal's Column select is gated to creator/owner/manager. So an assignee can move a task by drag on a desktop and by nothing at all on a phone. This is a **permission** change, not a layout one — it needs your call. |
| 3 | Ticket reports vs sales reports | `ResolutionSummary` and `TicketsByCategory` use an older frame: no date range, no filters, no CSV, ALL-CAPS title. Product decision, not a bug. |
| 4 | `ui/DateField` `placeholder` | Accepted and silently dropped — x-date-pickers v9 draws its own mask. Changing the API risks churn across callers. |
| 5 | Tailwind + MUI token duplication | `index.css` `@theme` block restates `styles/tokens.js` with a "keep in sync" comment and nothing enforcing it. Tailwind is used 64 times in 15 files. Worth its own cleanup. |
| 6 | Hardcoded rem sizes in the shell | `TopNav`/`Sidebar` write `0.9333rem`/`0.8667rem` where `theme.typography` has the same values. Cosmetic drift risk. |
| 7 | Remaining lint warnings | 10, all pre-existing `react-refresh/only-export-components` plus one unused eslint-disable in `TaskBoard`. |

## A limitation worth stating

**No live pixel verification.** This machine has no Chrome (only Brave/Arc) and
both browser MCPs need Chrome stable, so every finding here is code-level:
measured from declared widths, breakpoints and the known clipping behaviour of
`<main>`, not from a screenshot. The defect classes are code-level too, but the
result should be eyeballed on localhost at 360px before it ships.

---

# Verification round — same day, after `57ed681`

Three agents re-read the commit adversarially ("assume it is wrong"), one swept
the repo for leftovers of the same defect classes, and one closed the coverage
gaps. **The commit had five regressions and four inert changes in it.** They are
fixed; this section records them so the same mistakes are recognisable later.

## Regressions the first pass shipped

| What | Why it was wrong |
|---|---|
| **Kanban touch drag** | `PointerSensor` binds `onPointerDown`, which fires *before* `onTouchStart` on every touch device, so it claimed the gesture and the delayed `TouchSensor` never ran. With `touch-action: none` on the card, any 8px swipe starting on a card began a drag instead of scrolling the column — the opposite of the commit message's claim. Now `MouseSensor` + `TouchSensor`, `touch-action` untouched: dnd-kit's documented pairing for a delay constraint. |
| **Offline banner** | Moving it in-flow put it *beside* the sidebar, and MUI renders a permanent Drawer as `position: fixed` for every variant — so on desktop the sidebar painted over the message. A desktop user saw a red bar with a lone Retry button and no text. Now rendered inside the content column, above TopNav. |
| **`ui/Chip` truncation** | `text-overflow` applies to block containers; a Chip is `inline-flex`, so the ellipsis never drew — but the `overflow: hidden` did, giving a hard mid-letter clip and cutting the delete button off. Truncation moved onto the flex item, as `ui/Menu` already did correctly. |
| **Table `minWidth`** | Bracketed at MUI `md` (900), so a 720px floor meant for phones was live across the whole tablet band: 768px portrait has 676px of content behind a rail sidebar. This is the *same* breakpoint error the commit fixed one file over. Rebracketed to `sm`. |
| **`truncTick`** | Shipped to every viewport, so a 1920px report axis read "Replaced un…" where it used to read the whole category name. Now guarded by `breakpoints.down("md")`. |

## Changes that did nothing

- **`PageHeader`'s wrap** was inert on the three pages it was written for —
  LeadDetail, Leads and ReportPage each hand the slot **one** non-wrapping row,
  so there was nothing to break. Fixed at each call site.
- **The iOS 16px rule** missed every date field (x-date-pickers v9 renders no
  `<input>` — the field is contenteditable `<span>`s) and every phone in
  landscape (667–932px). It also had to move out of `@layer base`: when two
  declarations are both `!important`, layer order reverses, so a layered rule
  loses to the unlayered one emotion injects.
- **`useAppTable` never merged `muiTableProps`**, so `Master/Users` — which
  passes its own — silently skipped the table fix entirely.
- **`FormRow` `md:` → `lg:`** was wrong-premise: all 24 call sites are inside
  fixed-width modals, so no viewport breakpoint is the right axis, and `lg`
  only lost the two-column layout across a wider band. Reverted.

## Also corrected

`NumberInput` lost arrow-key stepping and the `spinbutton` role with
`type="number"` — both re-implemented. Two grids were forced to one column on a
phone *after* `StatCard` was taught in the same commit to survive a narrow tile;
both reverted to two-up. The quotation preview's sticky offset was computed
against the viewport when `<main>` is the scroll container. `Groups`' permission
matrix got a `minWidth` so it scrolls instead of crushing. `ErrorBoundary`'s two
buttons had become visually identical. And an `ImageSlot` comment justified
itself with a hint that does not say what the comment claimed — the real
explanation lives in the finalise blockers.

## Gates, measured

| Gate | Result |
|---|---|
| Full suite | **167 files, 1,926 tests, 0 failures** |
| Coverage (global floor 60%) | **93.11% stmts · 89.32% branch · 82.55% funcs** |
| Every file touched by this work | ≥80% line **and** branch |
| `pnpm lint` | 0 errors (10 pre-existing warnings) |
| `pnpm build` | passes; no PDF engine or Tiptap in any eagerly-preloaded chunk |

`TaskBoard.jsx` is 88.49% statements / 90.78% branch but **47% functions** — the
uncovered block is the three drag handlers, which need a simulated drag. The
§0.4 gate is line and branch, both of which it clears; the function gap is
stated rather than hidden.

## Still not verified, and it cannot be from here

No live pixel verification: this machine has no Chrome, only Brave and Arc, and
both browser MCPs require Chrome stable. Everything above is measured from code
and from library sources in `node_modules`. **Open the built app at 360px, at
768px, and on a real iPhone before calling it done.**
