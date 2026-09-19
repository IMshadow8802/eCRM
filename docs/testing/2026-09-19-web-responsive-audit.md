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
