# E · Midnight Sorbet — implementation spec and work breakdown

**Source of truth:** `direction-e-blend.html` in this folder (approved 2026-11-02: "make sure we don't stray away from E, I need all as I see"). Every number below is read from that file. Anything E leaves open is marked **proposed**. Where E and the current app disagree, E wins unless the row says **flag**, meaning the user decides at review.

**Scope:** `mobile/` only. No SQL, no backend, no web. Where E shows data the API does not have, §4.0 lists the gap and the proposal.

**Conventions in this doc**
- `tok.x` = a key in `theme/tokens.ts`; `type.x` = a variant in `theme/typography.ts`.
- Sizes are dp (RN units), and they equal E's CSS px 1:1, because E draws a 390 × 844 phone and a 1194 × 834 tablet.
- Icon names are lucide (kebab-case here; PascalCase in code). All icons have stroke 2 and round caps, which is the lucide default.

## 0. Frame index (34)

| Frame | Name | Frame | Name |
|---|---|---|---|
| 01 | Company code | 17 | Follow-ups queue |
| 02 | Sign in | 18 | Inbox |
| 03 | Sign-in error | 19 | More / Profile |
| 04 | Home "Today" | 20a | State · Empty |
| 04b | Create sheet | 20b | State · Loading |
| 05 | Tasks / My Work | 20c | State · Error |
| 06 | Workspaces | 21 | Confirm dialog |
| 07 | Board | 22 | Complaint row mid-swipe |
| 08 | Task detail · Checklist | 23 | Transfer sheet |
| 09 | Task · Deadline (TAT) | 24 | Log call sheet |
| 10 | Complaints list | 25 | Lead status sheet |
| 11 | Complaint detail | 26 | More · complaints-only user |
| 12 | New complaint | 27 | Home · leads-only user |
| 13 | Sheet · Resolve complaint | T1 | Tablet Home |
| 14 | Leads list | T2 | Tablet Complaints (list + detail) |
| 15 | Lead detail · Follow-ups | T3 | Tablet Lead detail (list + detail) |
| 16 | Lead form | T4 | Tablet Lead form (centred 640) |

---

## 1. Tokens

### 1.0 How the change lands without breaking un-migrated screens

Phase 1 (Task 33) **retunes the existing semantic keys to E's values** and **adds** the new keys. The existing `chipTones` names stay as aliases of the new hue tones. As a result, every screen still compiles and already moves toward E before Phase 2 rewrites it. Phase 3 (Task 40) deletes the aliases and retired keys once nothing reads them. **No colour exists outside `theme/tokens.ts`**; `designRules.test.ts` already enforces this for hex and rgba.

### 1.1 Palette (raw) — `palette` is replaced by E's ramps

| Key | Hex | E source | Status |
|---|---|---|---|
| `navy[900]` | `#171D47` | `--nv9` band, bottom bar, rail | new |
| `navy[800]` | `#20285A` | `--nv8` icon buttons, ghost header button, tablet detail band | new |
| `navy[700]` | `#2C3570` | `--nv7` search field, count pill, avatar ring, ghost button on Navy 800 | new |
| `navy.muted` | `#A9B0D6` | `--nvm` text/icons on navy | new |
| `navy.soft` | `#D3D7EE` | `--nvt` count text on navy | new |
| `indigo[300]` | `#8592F0` | `--ind3` 3 px indicator and band underline (5.65 : 1 on Navy 900) | new |
| `indigo[500]` | `#3F4FAF` | `--pri` brand | was `brand.base` (same value) |
| `indigo[600]` | `#34429A` | `--pri-p` pressed; TAT figure box | was `brand.dark` `#1E34AE` |
| `indigo[50]` | `#E6E8F6` | `--pri-s` soft; selected row on tablet | was `#EEF0FA` |
| `auth` | `#4B5BC0`, `#3F4FAF`, `#27317A` | 160° gradient, auth only | replaces `gradients.brand` |
| `sheet` | `#EEF0F8` | `--bg` | was gray 50 `#F9FAFB` |
| `white` | `#FFFFFF` | `--sf` card | same |
| `line` | `#ECEEF5` | `--ln` row separator | new |
| `line2` | `#D3D8E6` | `--ln2` field border, prefix divider | new |
| `skeleton` | `#DFE3EF` | `--sk` | new |
| `skeleton2` | `#E8EBF4` | `--sk2` | new |
| `ink[900]` | `#141936` | `--ink` | was `#111827` |
| `ink[700]` | `#4A5072` | `--ink2` (6.88 : 1 on sheet) | was `#6B7280` |
| `ink[500]` | `#5F6687` | `--ink3` (4.94 : 1 on sheet) | was `#9CA3AF` (failed AA) |
| `coral` | `#D23F2A` | badge (white text 4.68 : 1) | new |
| `danger` | `#C42D1B` | `--dng` (white 5.62 : 1) | was `#DC2626` |
| `ok` | `#1F7A3E` | `--ok` call, done (white 5.37 : 1) | was `#059669` |
| `avatar.*` | unchanged | user data `color:<name>` presets | keep; see §3.17 |

Retired in Task 40, once they are unused: `brand.light`, `accent.*`, `gray.*`, `red.*`, `green.*`, `amber.*`, `blue.*`, `purple.*`, `teal.*`, `shadow`.

### 1.2 Semantic colours — `colors`

**Retuned keys.** They keep their names and take E's values.

| Key | New | Was | Where in E |
|---|---|---|---|
| `background` | `#EEF0F8` | `#F9FAFB` | the sheet |
| `surface` | `#FFFFFF` | same | card, list group |
| `surfaceMuted` | `#F5F6FB` | `#F3F4F6` | Create-sheet rows, Lost reason panel (04b, 25) |
| `surfaceSunken` | `#E2E5F1` | `#E5E7EB` | board column (07) |
| `overlay` | `rgba(9, 12, 34, 0.56)` | `rgba(17,24,39,.55)` | scrim, the one alpha |
| `text` | `#141936` | `#111827` | ink |
| `textSecondary` | `#4A5072` | `#6B7280` | ink 2: meta, labels |
| `textMuted` | `#5F6687` | `#9CA3AF` | ink 3: numbers, help, footers |
| `textInverse`, `textOnBrand` | `#FFFFFF` | same | |
| `border` | `#D3D8E6` | `#E5E7EB` | field border |
| `borderStrong` | `#A3AAC6` | `#D1D5DB` | idle radio and checkbox ring |
| `divider` | `#ECEEF5` | `#F3F4F6` | row separator |
| `primary` | `#3F4FAF` | same | |
| `primaryPressed` | `#34429A` | `#1E34AE` | |
| `primarySoft` | `#E6E8F6` | `#EEF0FA` | add-file tile, tablet selected row, info note |
| `success` | `#1F7A3E` | `#059669` | call button, ticked step |
| `successSoft` | `#D3F2CB` | green 50 | |
| `warning` | `#745400` | `#D97706` | amber text |
| `warningSoft` | `#FFF1C2` | amber 50 | |
| `danger` | `#C42D1B` | `#DC2626` | |
| `dangerSoft` | `#FFDCD7` | red 50 | sign-in error box (03) |
| `info` | `#1E4C96` | `#2563EB` | |
| `infoSoft` | `#DDEBFF` | blue 50 | |
| `surfacePressed` | `#F1F2FA` | `#F3F4F6` | **proposed:** pressed row = `fieldTint` |
| `disabledBg` | `#D6DAE8` | `#E5E7EB` | `.btn.off` |
| `disabledText` | `#5F6687` | `#6B7280` | `.btn.off` |

**New keys**

| Key | Hex | Where in E |
|---|---|---|
| `band` | `#171D47` | band, status bar, bottom bar, rail, list-pane band |
| `bandRaised` | `#20285A` | `.ib` icon button, `.hbtn.gh`, tablet detail band |
| `bandField` | `#2C3570` | search, `.ct` count, profile avatar ring 4 px, ghost button on `bandRaised` |
| `onBandMuted` | `#A9B0D6` | subtitles, idle tab labels/icons, search placeholder (7.57 : 1 on band, 5.33 : 1 on field) |
| `onBandSoft` | `#D3D7EE` | idle count text |
| `bandMark` | `#8592F0` | 3 px indicators (bar, rail, band tabs) |
| `coral` | `#D23F2A` | notification badge, Overdue `.ct.red` |
| `onBrandMuted` | `#DDE1F7` | labels on the indigo hero (5.49 : 1), auth tagline |
| `onBrandWarn` | `#FFD27A` | overdue figure on indigo (5.00 : 1) |
| `onBrandOverrun` | `#FFB3A6` | overrun segment of the TAT bar (09) |
| `onBrandDivider` | `#5A68C2` | 1 px divider in the TAT figure box |
| `dangerText` | `#A8200F` | `.rt.red`, error help, Lost label, Sign out label, Breached |
| `successText` | `#1D6312` | `.rt.grn` "Done 1:10 pm" |
| `warningText` | `#745400` | `.rt.amb`, follow-up card subline |
| `fieldTint` | `#F1F2FA` | "Add new customer" row, selected person row, sheet segmented and pills, stepper |
| `unreadTint` | `#F4F5FC` | unread Inbox row (18) |
| `followUpTint` | `#FFF8DD` | next follow-up card (15, T3) |
| `dangerCardTint` | `#FFEDEA` | comment pending delete (21) |
| `dangerRowTint` | `#FFF0ED` | selected Lost row (25) |
| `secondaryFill` | `#E3E6F3` | `.btn.sec` |
| `track` | `#DDE1EE` | progress track, timeline line |
| `iconFaint` | `#B9C0D6` | grip handle, idle page dot |
| `grabber` | `#C9CEDF` | sheet handle |
| `skeleton` | `#DFE3EF` | skeleton block (strong) |
| `skeletonSoft` | `#E8EBF4` | skeleton block (soft) |
| `swipeHold` | `#8A5A00` | swipe "On hold" block |
| `escalate` | `#5B2D9E` | swipe "Escalate", escalated corner dot |
| `greetIcon` | `#FFE48C` | Hand icon on navy (= butter badge fill) |
| `shadowWhisper` | `#DCE0EC` | `--whisper` shadow, tablet pane edge |
| `shadowPopover` | `#D2D6E5` | customer search dropdown (12) |
| `footerLine` | `#E4E7F1` | top hairline of the fixed form footer (12) |

Retired in Task 40: `accent*`, `priority*`, `neutralIcon`, `surfaceOnBrand`, `frostOnBrand`, `textOnBrandMuted`, `veilOnBrand*`, `primaryDim`, `dangerDim`, `transparentBorder`. In Phase 1 they stay as aliases (for example `accent` → `primary`) so the build stays green.

**Pressed states (proposed; E draws none):**

| Control | Pressed fill |
|---|---|
| primary | `primaryPressed` |
| secondary | `#D9DEEE` (slate badge fill) |
| danger | `dangerText` |
| `.ib` and ghost header button | `bandField` |
| row | `fieldTint` |
| pill and segment | `transform: scale(0.97)` |

All pressed states are solid; none uses opacity.

### 1.3 Module identity — `moduleTones` (new)

| Module | Tile / badge fill | Ink (icon, tile text) | Chip fill / text | Icon | Ratio |
|---|---|---|---|---|---|
| home | `#D5D9F5` | `#2E3A8C` | `#E6E8F6` / `#3F4FAF` | house | 7.18 |
| inbox | `#D5D9F5` | `#2E3A8C` | `#E6E8F6` / `#3F4FAF` | inbox | 7.18 |
| tasks | `#D9C8FA` | `#3B1C6B` | `#ECE3FC` / `#5B2D9E` | square-check-big (bar), list-checks (tile) | 8.69 |
| complaints | `#FFCCB8` | `#6E1F0E` | `#FFE3D9` / `#A3321B` | headset | 7.82 |
| leads | `#BCEBD5` | `#0D4A33` | `#D6F3E6` / `#146345` | target | 7.82 |
| followups | `#FFE48C` | `#574000` | `#FFF1C2` / `#745400` | calendar-clock (bar, rail), calendar-check (tile) | 7.82 |
| more | `#D9DEEE` | `#2E3760` | — | ellipsis | 8.54 |

Shape: `moduleTones[m] = { badge: BadgeTone, chip: ChipTone, icon: LucideIcon name }`. The fill and ink values come from §1.5, so no hex is repeated.

### 1.4 Chip tones — `chipTones` (re-keyed by hue)

Chips are pills with radius 11 and 12/600 text.

| Tone | Fill | Text | Ratio | Used for (E) | Old alias kept until Task 40 |
|---|---|---|---|---|---|
| `sky` | `#DDEBFF` | `#1E4C96` | 6.88 | open, new | `info` |
| `butter` | `#FFF1C2` | `#745400` | 6.18 | on hold, medium, proposal | `warning` |
| `green` | `#D3F2CB` | `#1D6312` | 6.09 | resolved, won, done | `success` |
| `red` | `#FFDCD7` | `#A8200F` | 5.72 | overdue, high, lost, rejected, missed | `danger`, `urgent` |
| `lilac` | `#ECE3FC` | `#5B2D9E` | 7.33 | escalated, qualified, project, Admin | `purple` |
| `teal` | `#D2F1F0` | `#0D5C5A` | 6.52 | contacted, in progress, shared | `teal` |
| `slate` | `#E4E8F4` | `#39436B` | 7.83 | closed, low, to do, personal, date chips, Custom field | `neutral` |
| `peach` | `#FFE3D9` | `#A3321B` | 5.69 | Complaints module, complaints-only role | — |
| `mint` | `#D6F3E6` | `#146345` | 6.14 | Leads module | — |
| `indigo` | `#E6E8F6` | `#3F4FAF` | 5.85 | assigned, Home, Inbox, step assignee | `primary` |
| `brand` | `#3F4FAF` | `#FFFFFF` | 7.12 | "Next" chip (15) | — |

**Change:** task priority `low` goes from success (green) to `slate`. `urgent` has no tone in E, so it is **proposed** to use `red` with the label "Urgent", and the separate deeper-red tone is retired.

### 1.5 Status badge tones — `badgeTones` (new)

Badges are solid rounded squares.

| Tone | Fill | Icon | Ratio |
|---|---|---|---|
| `sky` | `#CFE0FF` | `#1E4C96` | 6.23 |
| `butter` | `#FFE48C` | `#574000` | 7.82 |
| `green` | `#C2EBB8` | `#1D6312` | 5.58 |
| `red` | `#FFCFC8` | `#8F1B0D` | 6.44 |
| `lilac` | `#D9C8FA` | `#3B1C6B` | 8.69 |
| `teal` | `#BDEBE8` | `#0D5C5A` | 6.01 |
| `slate` | `#D9DEEE` | `#2E3760` | 8.54 |
| `peach` | `#FFCCB8` | `#6E1F0E` | 7.82 |
| `mint` | `#BCEBD5` | `#0D4A33` | 7.82 |
| `indigo` | `#D5D9F5` | `#2E3A8C` | 7.18 |

### 1.6 Status → badge (tone + icon) — `theme/statusBadges.ts` (new; pure data, no colours)

| Domain | Key | Badge tone | Icon | Chip tone |
|---|---|---|---|---|
| Complaint `StatusCode` | open | sky | circle-dot | sky |
| | onhold | butter | circle-pause | butter |
| | resolved | green | circle-check | green |
| | closed | slate | archive | slate |
| | rejected | red | circle-x | red |
| Escalated (any) | `EscalatedTo != null` | 20 px corner dot `escalate`, chevrons-up 12 / stroke 2.5 | | lilac "Escalated to {name}" |
| Lead (see gap G1) | new | sky | sparkles | sky |
| | contacted | teal | phone | teal |
| | qualified | lilac | badge-check | lilac |
| | proposal | butter | file-text | butter |
| | won (`converted`) | green | trophy | green |
| | lost | red | circle-x | red |
| | junk (**proposed**) | slate | circle-x | slate |
| Task stage (see G8) | to do | slate | circle | slate |
| | in progress | teal | circle-play | teal |
| | done | green | circle-check | green |
| Priority (complaint flag, task chip) | high, urgent | — | flag | red |
| | medium | — | flag | butter |
| | low | — | flag | slate |
| Workspace type | personal | slate | lock | slate |
| | shared | teal | users | teal |
| | project | lilac | layout-dashboard | lilac |
| Follow-up type | call | sky | phone | — |
| | visit | teal | map-pin | — |
| | meeting (**proposed**) | lilac | users | — |
| | other (**proposed**) | slate | calendar-clock | — |
| | done row | green | check | — |
| | overdue (Home 27) | red | phone (by type) | — |
| Notification (G26) | escalation | lilac | chevrons-up | — |
| | TAT warn | butter | timer | — |
| | assigned | indigo | user-check | — |
| | comment, reply | teal | message-square | — |
| | breach, missed | red | octagon-alert | — |
| | added to workspace | indigo | user-plus | — |
| | other (**proposed**) | slate | bell | — |
| Complaint activity `Type` | escalated | lilac | chevrons-up | — |
| | call | sky | phone-call | — |
| | assigned | teal | user-check | — |
| | created | slate | plus | — |
| | resolved (**proposed**) | green | circle-check | — |
| | onhold/status (**proposed**) | butter | circle-pause | — |
| | reopened (**proposed**) | sky | circle-dot | — |
| | closed (**proposed**) | slate | archive | — |
| | rejected (**proposed**) | red | circle-x | — |
| | updated (**proposed**) | slate | pencil | — |
| TAT timeline | Started | sky | circle-play | — |
| | Held | butter | circle-pause | — |
| | Due | slate | clock | — |
| | Breached | red | octagon-alert | — |

### 1.7 Type ramp — `typography`

All text is Inter. Weight is the family: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold. `tabular` means `fontVariant: ["tabular-nums"]`.

| Variant | Size / line height | Weight | Tracking | Tabular | E use |
|---|---|---|---|---|---|
| `display` | 28/34 | 700 | -0.3 | | "Nexus CRM" (01) |
| `statLg` | 40/46 | 700 | -0.5 | yes | tablet hero numbers (T1) |
| `stat` | 32/38 | 700 | -0.5 | yes | hero numbers (04, 27) |
| `tileValue` | 28/32 | 700 | | yes | tile number; tablet lead value 28/34 is `statValue` below |
| `statValue` | 28/34 | 700 | | yes | tablet est. value (T3) |
| `titleXl` | 26/32 | 700 | | | tablet lead name (T3) |
| `figure` | 24/30 | 700 | | yes | TAT Target / Over by (09); tablet detail title 24/30 (T2) uses `titleLg` |
| `titleLg` | 24/30 | 700 | | | tablet complaint title |
| `h1` | 22/28 | 700 | -0.2 | | band title, auth panel title, lead est. value, "3 of 5" (`tabular` prop) |
| `recordTitle` | 20/26 | 700 | | | detail titles, profile name, empty title |
| `sheetTitle` | 18/24 | 700 | | | sheet, dialog, error card |
| `h2` | 17/22 | 600 | | | band record id "C-1042", greeting, form titles |
| `cardTitle` | 16/22 | 600 | | | hero title, Create-sheet row title |
| `groupTitle` | 16/22 | 700 | | | "Needs you" heading |
| `bodyLg` | 15/22 | 400 | | | auth tagline |
| `body` | 15/20 | 400 | | | input text, reason text |
| `bodyStrong` | 15/20 | 600 | | | workspace name, More row label, customer name, mobile, status-sheet label, button label |
| `rowTitle` | 14/20 | 600 | | | list row title, card title, step text (open) |
| `text` | 14/20 | 400 | | | descriptions, dialog body, comment text, auth sub |
| `amount` | 14/20 | 700 | | yes | ₹ in rows |
| `meta` | 13/18 | 400 | | | row metadata, band subtitle `hsub` |
| `metaStrong` | 13/18 | 600 | | | pill label, gh link, tile "Open", band tab (13) |
| `tab` (band) | 14/20 | 600 | | | band preset tabs (05, 07, 14); 13 in 10 → `metaStrong` |
| `label` | 12/16 | 600 | | | form label, fact label, chip, `.rt`, `.no` |
| `small` | 12/16 | 400 | | | help, footnotes, sublines, date over greeting |
| `smallMedium` | 12/16 | 500 | | | hero stat label, tile subtitle |
| `overline` | 12/16 | 600 | 0.6, uppercase | | gh-row label "SORTED BY DEADLINE" |
| `navLabel` | 11/14 | 500 (active 600) | | | bottom bar, rail |
| `count` | 11/18 | 700 | | yes | `.ct` count pill |
| `badge` | 10/14 | 700 | | yes | coral `.bdg` |
| `avatar` | sizes per §3.17 | 700 | | | initials |

**Mapping of old names in Phase 1** (they are retuned so un-migrated screens still render; deleted in Task 40):

| Old name | Becomes |
|---|---|
| `h1` | `h1` (as above) |
| `h2` | `h2` |
| `h3` | `rowTitle` |
| `body` | `text` (14/20, **now Regular 400, was Medium 500**) |
| `bodyStrong` | `rowTitle` |
| `secondary` | `meta` |
| `label` | `label` |
| `button` | `bodyStrong` |
| `caption` | `label` |
| `overline` | `overline` |

`Text` gains a `tabular?: boolean` prop. `fontWeight` is never written (guarded, §5.3).

### 1.8 Spacing and metrics

`spacing` (4 px grid) stays as is. E also uses exact off-grid values inside components. These go in a new frozen `metrics` object in `tokens.ts`, so no component writes a raw number:

| Key | Value | E |
|---|---|---|
| `gutter` | 16 | sheet and band horizontal padding (phone); `SCREEN_PADDING` stays 16 |
| `bandRow` | 52 | `.hrow` |
| `bandRowHome` | 56 | Home greeting row |
| `bandRowTablet` | 60 | T1, T4 |
| `bandPadBottom.tabs` | 16 | band followed by tabs or search |
| `bandPadBottom.home` | 28 | 04, 27 |
| `bandPadBottom.record` | 30 | details, forms, Inbox, Follow-ups, Workspaces |
| `bandPadBottom.profile` | 36 | 19, 26; tablet bands 36 |
| `sheetOverlap` | 16 (tablet Home/form 20) | `.sheet` margin-top -16 |
| `sheetPadTop` | 16 | `.sheet` padding-top (tablet 20–24) |
| `rowPadV` / `rowPadH` | 11 / 14 | `.rw` |
| `rowGap` | 12 | `.rw` gap |
| `rowLineGap` | 3 | `.l2`, `.l3` margin-top |
| `inlineGap` | 6 | `.l1` gap, chip rows |
| `sepInset` | 66 / 48 / 14 | separator left inset: badge row / checklist / no badge |
| `controlHeight` | 44 | `.in` field (was `CONTROL_HEIGHT` 50) |
| `buttonHeight` | 48 / sm 36 / xs 32 | `.btn` / `.btn.sm` / Accept (06) |
| `headerButtonHeight` | 36 | `.hbtn` |
| `iconButton` | 40 | `.ib` |
| `searchHeight` | 40 | `.srch` |
| `pillHeight` | 32 (sheet pills 34) | `.pl` |
| `segmentHeight` | 34 (outer padding 4) | `.sgp span` |
| `bandTabHeight` | 44 | `.seg` |
| `bottomBarContent` | 58 | 88 - 30 home-indicator inset |
| `railWidth` / `railItem` | 92 / 62 | `.nr` |
| `listPaneWidth` | 420 | T2, T3 |
| `formMaxWidth` | 640 | T4 |
| `factsColumn` | 300 | T3 |
| `boardColumn` | window − 80, capped at `boardColumnMax` 360 (phone 390 → 310, E; tablet → several columns + peek, Task 33 review) | 07 |
| `fieldGap` | 12 | `.fl` margin-bottom |
| `pairGap` | 10 | `.two` |
| `bentoGap` | 10 (tablet 16) | `.bento` |
| `tileHeight` | 112 (tablet 128) | `.tile` |
| `nudge` | 2 | title/shift nudges (`margin-top:2px`; 04 shift row, 08 title, 15 next-card line) — Task 37b |
| `stackGap` | 10 | card/figure gap inside a card (08 comments, 09, checklist bar, 15) — Task 37b |
| `iconSm` | 14 | `.i14` inline row icon (14 / T3 line 3) — Task 37b |
| `cardPad` | 14 | card padding `14px` (08, 09, 15) — Task 37b |
| `sheetActionGap` | 14 | space above a sheet's action button (25) — Task 37b |
| `errorTop` | 72 | 20c error card top — Task 37b |
| `pane.listBand` / `pane.listSheet` | 20 / 16 | T2/T3 list pane band / sheet side padding — Task 37b |
| `pane.detailBand` / `pane.detailSheet` | 28 / 24 | T2/T3 record pane band / sheet side padding — Task 37b |

`HIT_TARGET` stays 44. Tappables that are smaller (pill 32, chip-button 28, Done 32, Button sm 36 / xs 32, CircleAction 40, search clear 18) get `hitSlop` to reach 44; sheet rows without a badge get `minHeight` 44 (Task 33 review). `TAB_BAR_HEIGHT` and `TAB_BAR_CLEARANCE` are no longer needed, because the bar is docked rather than floating. In Phase 1 `TAB_BAR_CLEARANCE` becomes 0; it is deleted in Task 40.

### 1.9 Radius

Rename to E's uses; old keys are kept as aliases until Task 40.

| Key | Value | Use |
|---|---|---|
| `mark` | 3 | indicators, grabber |
| `check` | 7 | checkbox 22 |
| `badgeXs` | 9 | 28 badge, `.ct` |
| `badgeSm` | 10 | 32 badge |
| `chip` | 11 | chip 22 |
| `badge` | 12 | 40 / 36 badge, field |
| `badgeLg` | 14 | 48 badge, chip lg, attachment tiles, TAT figure box, selected sheet row |
| `bar` | 15 | nav pill 48 × 30 |
| `card` | 16 | card, list group, pill 32, Rail New 52, empty 52 badge |
| `segment` | 17 | segment 34 |
| `column` | 18 | board column, header button 36, sm button |
| `sheet` | 20 | band-overlap sheet top, hero, tile, segmented outer, `.ib` |
| `modal` | 24 | bottom sheet, dialog, auth panel, button 48, tablet sheet |
| `xl` | 22 / 40 / 44 | error badge 72 / empty art 132 / avatar 88 |
| `full` | 9999 | circles |

### 1.10 Elevation

E draws shadows as a solid colour, not with opacity. RN 0.86 `boxShadow` takes a CSS string and works on both platforms under the new architecture. The value **must be verified on the Android AVD in Task 33**; if it does not render, the fallback is `shadowColor` set to the token with `shadowOpacity: 1` plus `elevation: 1`.

| Token | Value | Use |
|---|---|---|
| `elevation.whisper` | `0 1px 2px #DCE0EC` | card, list group, idle pill, segmented outer |
| `elevation.popover` | `0 4px 12px #D2D6E5` | customer search dropdown (12) |
| `elevation.footer` | `0 -1px 0 #E4E7F1` | fixed form footer (12) |
| `elevation.none` | — | tinted cards (Create rows, follow-up card, pills with a tone) |
| pane edge | 1 px `View` in `shadowWhisper` | tablet detail pane left edge (`inset 1px 0 0`), drawn as a View and never as a row border |

Retired: `shadows.sm/base/md/lg/floating`. In Phase 1 `shadows.md` is aliased to whisper.

### 1.11 Gradient and scrim

- `gradients.auth = ["#4B5BC0", "#3F4FAF", "#27317A"]` at 160°. In `expo-linear-gradient` that is `start {x:0.33, y:0}` and `end {x:0.67, y:1}`.
- The gradient is allowed only in `features/auth/` (guarded, §5.3).
- `colors.overlay` remains the one translucent value.

### 1.12 `maxFontSizeMultiplier` (proposed; E does not specify)

| Key | Cap | Applies to |
|---|---|---|
| `fontScaleCap.body` | 1.3 | default on `Text` |
| `fontScaleCap.chrome` | 1.15 | bottom bar and rail labels, chips, `.ct`, `.bdg`, band tabs, StatusBadge glyph size |
| `fontScaleCap.figure` | 1.2 | stat, tileValue, figure |

`Text` takes its cap from the variant's group; a `scaleCap` prop overrides it.

---

## 2. Responsive

### 2.1 `useLayout()` — `mobile/src/ui/useLayout.ts` (new)

```ts
export type SizeClass = "compact" | "medium" | "expanded";
export interface Layout {
  sizeClass: SizeClass;
  width: number; height: number; isLandscape: boolean;
  nav: "bar" | "rail";
  isTwoPane: boolean;                 // list | detail side by side
  contentMaxWidth: number;            // forms (and medium lists)
  columns: 1 | 2 | 3;                 // Home grid columns
  gutter: number;                     // band/sheet horizontal padding
}
export function layoutFor(width: number, height: number): Layout;   // pure, unit-tested
export function useLayout(): Layout;                                 // useWindowDimensions → layoutFor
```

| | compact (< 600) | medium (600–839) | expanded (≥ 840) |
|---|---|---|---|
| `nav` | bar | rail | rail |
| `isTwoPane` | false | false (**proposed**) | true |
| `contentMaxWidth` | width | 640 forms; 720 lists (**proposed**) | 640 forms; list pane 420 |
| `columns` (Home) | 2 (bento; hero full width) | 2, hero spans 2 (**proposed**) | 3, hero spans 2 (T1) |
| `gutter` | 16 (`metrics.gutter`) | 24 (`metrics.gutterMedium`, **proposed**) | 32 (`metrics.gutterExpanded`); Home 32 · list pane 20 · detail 28 (T1–T3) |

**Landscape phone guard (proposed).** If `height < 480`, the size class is capped at `medium`. A phone at 844 × 390 then gets the rail and a single pane, never two panes squeezed into 390 dp of height.

`app.config.ts` `orientation` changes from `"portrait"` to `"default"`, so tablets can rotate as T1–T4 require. This needs `expo prebuild --clean`; it is done in Task 33.

### 2.2 Rules from T1–T4

1. **Rail vs bottom bar.**
   - At `nav === "rail"` the bottom bar is never rendered. The rail sits outside the stack (see Shell, §3.4), so pushed screens and forms keep it (T4 shows the rail beside the form).
   - Rail items, in order:
     1. Today
     2. Tasks
     3. Complaints
     4. Leads
     5. Follow-ups (if leads)
     6. Inbox (always)
     7. spacer
     8. avatar "More"
   - `railTabsFor(can)` lives in `navigation/tabs.ts`.
   - The rail's "+" opens the Create sheet. The logo tile is not tappable (**proposed**).
2. **List / detail.**
   - At `isTwoPane`, Complaints and Leads render list (420) + detail (flex) inside the tab. A tapped row sets `selectedId` (route param) instead of pushing. With nothing selected, the detail pane shows EmptyState "Pick a complaint" / "Pick a lead" (**proposed**).
   - The selected row is tinted `primarySoft`, and the corner-dot border becomes `primarySoft` (T2).
   - List band: `band`, padding 4 20 16.
   - Detail band: `bandRaised`, padding 4 28 36. It holds the actions as header buttons (ghost on `bandField`; the main action filled `primary`), and there is **no action bar**.
   - The detail sheet has padding 20 24 0 and the pane edge from §1.10.
   - Tasks has no two-pane frame in E. **Proposed:** My Work + Task detail use the same split; Board stays full width.
3. **Centred 640 form.** At ≥ medium, every form renders inside one Card of `maxWidth: 640`, centred, padding 20 20 8. The band spans the pane and holds `Cancel` (ghost) + `Save …` (filled) (T4). Pairs (`two`) stay paired. "Roof type" pairs with Owner in T4 (it is alone on the phone).
4. **Home grid.** At expanded:
   - Grid of 3 columns, gap 16. Hero spans 2 (padding 18 20 16, title 17/22, stat `statLg`, margin-top 16).
   - Tiles: height auto for the first tile, 128 for the rest; padding 16; `wc` 40.
   - Then a 2fr / 1fr row: "Needs you" list + "Follow-ups today" list (rows padding 9 14, 36 badges).
   - Band padding 8 32 36; greeting 22/28 700 with hand icon 22; inline search 340 wide; bell; New.
   - Sheet padding 24 32 0, overlap 20, radius 24.
5. **Landscape.** Covered by the guard in 2.1.
   - Tablet portrait (834 wide) is `expanded` → two-pane at 834. The list pane stays 420, so the detail gets 322 after the 92 rail — too narrow. **Proposed:** two-pane needs `width - 92 - 420 >= 480`; otherwise single pane with rail.

### 2.3 Not magnified

No `scale` and no dp-based font scaling. Larger screens get more columns and panes, never bigger type, except the tablet-only variants that E draws: `statLg`, `titleLg`, `titleXl`, `statValue`.

---

## 3. Components

Every component lives in `src/ui/` (or `src/navigation/` for shell parts), reads tokens only, and has solid states. "Replaces" names the existing file that is deleted in Task 40 or restyled in place.

### 3.1 `Band` (navy header) — replaces `ui/ScreenHeader.tsx`

**Visual**
- Container: background `band`, horizontal padding `gutter`. It extends under the status bar; `StatusBar` is `light-content`. Padding-bottom is `bandPadBottom[variant]`.
- Row (`.hrow`): height 52 (Home 56, tablet 60), gap 10, aligned centre.
- Title variants:
  - `h1` title, flex 1, ellipsis.
  - `h2` title with an optional `meta` subtitle in `onBandMuted` below it ("C-1042" / "Opened Mon, 2 Nov · 10:30 am").
  - Title + baseline count (`h1` + `meta` "12 yours", gap 10, aligned baseline) (14).
  - Subtitle-only lead (`meta`, flex 1: "Sales Ops · In Progress") (08).
- Leading back: `IconButton variant="ghost"` 36 wide, margin-left -8, chevron-left 24, or x 24 on forms.
- Trailing: `IconButton` items (40, `bandRaised`, icon 20 white) and/or a `HeaderButton`.
- Below the row (optional, in order):
  1. `SearchField` (margin-top 0–4)
  2. `BandTabs` (margin-top 4–6)
  3. extra content (`children`: record title 20/26 margin-top 2–4, chip row margin-top 10–12, Home shift row)

**Props**
```ts
interface BandProps {
  title?: string; titleVariant?: "h1" | "h2"; subtitle?: string; count?: string; // "12 yours"
  onBack?: () => void; backIcon?: "back" | "close";
  actions?: ReactNode;              // IconButton / HeaderButton
  search?: SearchFieldProps; tabs?: BandTabsProps<string>;
  variant?: "tabs" | "home" | "record" | "profile";   // picks padding-bottom
  tone?: "band" | "raised";         // raised = tablet detail pane (Navy 800)
  align?: "start" | "center";       // profile = center
  children?: ReactNode;
  leading?: ReactNode;              // Task 37b: leads the row after back (04: avatar + date/greeting); replaces the title block when there is no title
  gutter?: number;                  // Task 37b: side padding override (T2/T3 panes: metrics.pane.*Band); BandSheet takes the same prop (*Sheet)
}
// Task 37b: a centred band (align="center") with no title, subtitle, back, actions or leading draws NO row (19: avatar 16 under the status bar).
```

### 3.2 `BandSheet` (sheet over the band) — new; works with `Screen`

**Visual**
- Background `background`, radius 20 20 0 0, margin-top -16 (tablet -20 / radius 24), padding 16 16 0.
- Does not clip. Scroll content goes inside it; the sheet itself is static.
- `Screen` gets `background` = `band` at the top edge, so the corners show navy behind them.

**Props:** `{ children; scroll?: boolean; refresh?: RefresherProps; padded?: boolean; bleedRight?: boolean /* board: padding 16 0 0 16 */; center?: boolean /* empty state */ }`

### 3.3 `BottomBar` + action-bar variant — replaces `navigation/FloatingTabBar.tsx`

**Visual**
- Docked bar, not floating. Background `band`; height `58 + insets.bottom`; padding 0 4, bottom inset as padding.
- No border, no shadow.
- **Item:**
  - flex 1; column; centred; padding-top 9; gap 3.
  - Label `navLabel` in `onBandMuted`; active label white 600.
  - Icon pill 48 × 30, radius 15. Icon 22, colour `onBandMuted`, stroke 2.
- **Active item:**
  - The pill fill is `moduleTones[m].badge` fill and the icon is its ink: home indigo, tasks lilac, complaints peach, leads mint, follow-ups butter, more slate.
  - Indicator: 3 × 32 bar in `bandMark` at top 0, centred, radius 0 0 3 3.
- **Badge `.bdg`** (`CountBadge`):
  - Absolute: top -4, left = pill centre + 6.
  - min-width 20, height 18, padding 0 5, radius 9, `coral`, `badge` text white, 2 px border `band`. Shows "99+" over 99.
- **Badge sources:**

  | Tab | Count | Query |
  |---|---|---|
  | Tasks | `needsYou(myDay).length` | `MY_DAY_QUERY` |
  | Complaints | Overdue preset count | Home |
  | Follow-ups | overdue follow-ups | Home |
  | Leads, Home, More | none | — |

  All counts reuse Home's queries (same keys), so no extra requests are made.
- Icons:

  | Tab | Icon |
  |---|---|
  | Home | house |
  | Tasks | square-check-big |
  | Complaints | headset |
  | Leads | target |
  | Follow-ups | calendar-clock |
  | More | ellipsis |

  Changed from ClipboardCheck / TrendingUp / Menu.
- **ActionBar** (`ui/ActionBar.tsx`, record screens 11 and 15):
  - Same bar. Items: padding-top 10, gap 4, icon 22 (E `.tb .i`; was 20 here — E wins), label 11 in `onBandMuted`.
  - The one `main` item: padding-top 6; a `primary` pill 56 × 30, radius 15, white icon 22 (E `.tb .i`); label white 600.
  - Max 5 items. Disabled item: icon and label `bandField` (**proposed**).

**Props**
```ts
// navigation/BottomBar.tsx
interface BottomBarProps { tabs: TabName[]; active: TabName | null; onPress: (t: TabName) => void; badges: Partial<Record<TabName, number>> }
// ui/ActionBar.tsx
interface BarAction { key: string; label: string; icon: LucideIcon; onPress: () => void; main?: boolean; disabled?: boolean }
interface ActionBarProps { actions: BarAction[] }
```

### 3.4 `Rail` + `Shell` — new: `navigation/Rail.tsx`, `navigation/Shell.tsx`

**Rail visual** (T1–T4)
- Width 92, background `band`, padding-top 8, column, items centred.
- Logo: 44 × 44, radius 14, `primary`, white hexagon 24, margin-bottom 10.
- New: 52 × 52, radius 16, `primary`, white plus 24, margin-bottom 8.
- Item: 92 × 62, column, gap 3, `navLabel` in `onBandMuted`; pill 48 × 30, radius 15, icon 22.
- Active item: white 600; pill in its module tone; indicator 3 wide at left 0, top 14, bottom 14, `bandMark`, radius 0 3 3 0.
- Badge as in §3.3.
- Spacer, then the "More" item: avatar 36 with a 2 px `bandField` border, label "More".

**Shell** wraps the authenticated stack in `RootNavigator`:
```tsx
<Shell>   // row: [Rail?] [Stack.Navigator] ; column: [Stack.Navigator] [BottomBar | ActionBar | nothing]
```
- `ROUTE_OWNER: Record<StackRoute, TabName | "action" | "none">` decides what the bottom chrome shows for the focused route:

  | Route | Bar shows |
  |---|---|
  | TaskDetail, Board, WorkspaceSettings, Columns | Tasks |
  | Boards, FollowUps (pushed), Me | More (at the rail a pushed FollowUps / Inbox lights its own rail item; the rail's Follow-ups uses `navigate("FollowUps")`, which lands on the tab when one exists) |
  | Inbox | Home (18) |
  | ComplaintDetail, LeadDetail | `action` |
  | TaskForm, ComplaintForm, LeadForm, WorkspaceForm | `none` (12, 16) |
  | Tabs | the focused tab |
  | Search | Home (**proposed**) |

- Record screens publish their actions with `useActionBar(actions)`, which writes to `ShellContext`.
- At the rail, `action` routes render their actions in the band (T2/T3) and `none` routes keep the rail (T4).
- Tab press: `navigation.dispatch(StackActions.popTo("Tabs", { screen }))`.
- The `Tab.Navigator` gets `tabBar={() => null}`, because the Shell owns the bar.

### 3.5 `ListGroup`, `ListRow`, `GroupHeader`, `SwipeRow` — replace `ui/MenuList.tsx` and the per-feature card rows

**ListGroup.** Outer `View`: `surface`, radius 16, `elevation.whisper`. Inner `View`: radius 16, `overflow: hidden`. The clip sits on the child, per the Card rule.

**ListGroupCell** (Task 37b). The same group cut per FlatList cell so a long list stays virtualised: `first` rounds the top corners, `last` the bottom; clip on the inner view (a SwipeRow's blocks stay inside the corners). The whisper is on the last cell only: per-cell shadows spill a seam onto the row above, and a box-shadow cannot be limited to the sides (device check in Task 39). Complaints, Leads, Follow-ups.

Activity titles (11, T2): the leading verb is bold only when it is in a closed list (Created, Escalated, Assigned, Transferred, Unassigned, Resolved, Reopened, Closed, Rejected, Called); "Complaint created" and "Status: Open → Resolved" read plain; legacy lowercase summaries are capitalised. Lead and task timelines stay plain (E has no sample).

**ListRow**
- Row: direction row, gap 12, aligned centre, padding 11 14, background `surface`.
- `align="top"` variant: aligned flex-start, padding 12 / 12 (05).
- Separator: a 1 px `divider` line at top, left = inset (66 with a 40 badge, 48 with a checkbox, 14 with none), right 0. It is absent on the first row and on `noSeparator`.
- `selected` → background `primarySoft`. `unread` → background `unreadTint`.
- Content column (flex 1, min-width 0):
  - Line 1: `rowTitle` title, ellipsis, flex 1, plus the trailing slot `right`: `label`-style text tinted `textSecondary` / `dangerText` / `successText` / `warningText` / `primary`, **or** `amount`.
  - Line 2 (margin-top 3, gap 6): `meta` in `textSecondary`, ellipsis, flex 1, + chips. The ticket number is prefixed in `label` `textMuted`, tabular.
  - Line 3 (margin-top 3, or 6 for task rows): icon 14 + text, or chips + spacer + AvatarStack.
- Title tones: `muted` (read Inbox row, closed complaint, lost lead, done follow-up) → `textSecondary`; Inbox read rows use weight 500 (**proposed** variant `rowTitleRead` 14/20 500).
- Trailing chevron-right 18 `textMuted` (06, 19); `trailing` slot for a button, chip, radio or count.
- Pressed: background `fieldTint`.

```ts
interface ListRowProps {
  badge?: StatusBadgeProps | ReactNode;   // 40 default
  title: string; titleTone?: "default" | "muted" | "danger"; titleWeight?: "strong" | "read";
  right?: { text: string; tone?: "default" | "danger" | "success" | "warning" | "brand" } | { amount: string; muted?: boolean };
  number?: string;            // "C-1042"
  meta?: string; chips?: ChipProps[];
  line3?: ReactNode; align?: "center" | "top";
  trailing?: ReactNode; chevron?: boolean;
  selected?: boolean; unread?: boolean; separatorInset?: 66 | 48 | 14; noSeparator?: boolean;
  onPress?: () => void; onLongPress?: () => void; testID?: string;
  // Task 37b
  titleVerb?: string;         // rich title: verb bodyStrong-weight, rest `text` 14 regular (11, T2 activity)
  unreadDot?: boolean;        // 8 primary dot at the end of line 2 (18)
  menu?: boolean;             // 19 menu rows: `bodyStrong` 15/600 title, padding 12 14
}
```

**GroupHeader** (`.gh-row`)
- Margin 16 2 8 (first one on a sheet: margin-top 0–4).
- Left: `overline` in `textMuted`, **or** `groupTitle` + a count chip (red).
- Right: link `metaStrong` in `primary`, or a meta string (`label` `textMuted` / `textSecondary`), or a chip.
- Props: `{ label?: string; title?: string; count?: number; right?: string; link?: { label; onPress } ; rightChip?: ChipProps }`.

**SwipeRow** (22, 17)
- Built on `react-native-gesture-handler` `ReanimatedSwipeable` (already installed).
- Action blocks are solid, width 72 (Escalate 88), full height; column: icon 20 + `label` text white, gap 4.
- Colours: Call `primary`, On hold `swipeHold`, Resolve `success`, Escalate `escalate`.
- The row slides; there is no fade. A swipe only **opens the sheet**; nothing changes on the swipe alone.
- Props: `{ left?: SwipeAction[]; right?: SwipeAction[]; children }` with `SwipeAction = { key; label; icon; color: "primary" | "swipeHold" | "success" | "escalate"; onPress }`.

### 3.6 `StatusBadge` — replaces `ui/Glyph.tsx`

| `size` | Box | Radius | Icon |
|---|---|---|---|
| 28 | 28 | 9 | 14 (timeline, board column) |
| 32 | 32 | 10 | 16 (activity rows) |
| 36 | 36 | 12 | 18 |
| 40 (default) | 40 | 12 | 20 |
| 48 | 48 | 14 | 22 |
| 52 | 52 | 16 | 22 |
| 56 | 56 | 14 | 28 (sign-in tenant placeholder, 02 — Task 37b) |
| 72 | 72 | 22 | 32 (error) |

- Fill and icon come from `badgeTones[tone]`.
- `escalated`: a 20 px circle in `escalate` at right -5, bottom -5, with a 2 px border in `ringColor` (default `surface`; `primarySoft` on a selected row). It holds chevrons-up 12, stroke 2.5, white.
- `ring?: number` adds a 4 px border in `background` (empty-state art).
- Props: `{ tone: BadgeTone; icon: LucideIcon; size?: 28|32|36|40|48|52|72; escalated?: boolean; ringColor?: ColorKey }`.

### 3.7 `Chip` (pill) — extends `ui/Chip.tsx`

| `size` | Height | Padding | Radius | Text | Icon |
|---|---|---|---|---|---|
| sm (default) | 22 | 0 9 | 11 | `label` | 12 |
| md | 28 | 0 12 | 14 | 13/600 (`metaStrong`) | 14 |
| lg | 32 | 0 12 | 16 | 13/600 | 14 (Follow-ups Done) |
| xs | 18 | 0 9 | 9 | 11/600 | — ("Custom" tag in T4 label) |

- `iconOnly`: 22 × 22, centred (complaint priority flag in rows).
- `tone` comes from §1.4. An `onPress` chip sinks with scale 0.97.
- Props: `{ label?: string; tone?: ChipTone; icon?: LucideIcon; size?: "xs"|"sm"|"md"|"lg"; iconOnly?: boolean; accessibilityLabel?: string; maxWidth?: number; onPress?: () => void }`.

### 3.8 `HeroCard` + `StatGrid` — new

**HeroCard visual** (04, 27, T1)
- Background `primary`, radius 20, padding 14 16 12, white content.
- Head row (gap 12):
  - `wc` circle: 40, `surface`, `primary` icon 20.
  - Title `cardTitle` white, with subtitle `meta` in `onBrandMuted` below.
  - "Open" link `metaStrong` white + arrow-right 16, gap 4.
- **StatGrid:** 4 equal columns, margin-top 12. Label `smallMedium` in `onBrandMuted`; value `stat` white. A `warn` value uses `onBrandWarn`.
- **Deadline hero** (09) is the same card with padding 14:
  - Head: `wc` 36 with timer 18, "Your clock" 15/600, flex, chip red.
  - `FigureBox`: `primaryPressed`, radius 14, margin-top 12, padding 10 0. Two centred columns: label 12/500 `onBrandMuted`, value `figure` (over-by in `onBrandWarn`); 1 px `onBrandDivider` between them.
  - Split bar: height 8, radius 4, margin-top 12, background `primaryPressed`, gap 2. Used segment is white; overrun is `onBrandOverrun`.
  - Footer (margin-top 10): two lines of `small` in `onBrandMuted` + a white pill button (36, radius 18, `primary` text 14/600, message-square 16).
- Tablet: padding 18 20 16, title 17/22, values `statLg`.

**Props**
```ts
interface HeroCardProps { icon: LucideIcon; title: string; subtitle?: string; onOpen?: () => void;
  stats?: { label: string; value: number | string; warn?: boolean; onPress?: () => void }[]; children?: ReactNode; size?: "phone" | "tablet" }
```
Each stat is tappable and opens exactly what it counts.

### 3.9 `ModuleTile` — new

**Visual** (04, 27, T1)
- Radius 20, padding 12 12 10 14, height 112 (tablet 128, padding 16). Fill and text are `moduleTones[m].badge`.
- Head: `tt` (`bodyStrong` 15/20) + `ts` (`smallMedium`), flex; `wc` 36 circle `surface` with an ink icon 18.
- Value row (margin-top auto, gap 6, baseline): `tileValue` + `metaStrong` 13/500 "assigned to you". **Proposed:** a `meta` 500 variant `metaMedium`.
- Foot (margin-top 2): "Open" 13/600 + arrow-right 16, space-between.

**Props:** `{ module: ModuleKey; title; subtitle?; value: number | undefined; unit: string; onPress }`. `undefined` renders a skeleton block 28 × 32 in `skeleton` (**proposed**).

### 3.10 `SegmentedTabs` (sheet pills) and `BandTabs` (text tabs) — replace `ui/Segmented.tsx`

**SegmentedTabs** (`.sgp`; 08, 09, 15, 17, 16, 24)
- Outer: `surface`, radius 20, padding 4, gap 4, whisper.
- Segment: flex 1, height 34, radius 17, `metaStrong` in `textSecondary`, gap 6; optional icon 14–16.
- Active segment: fill `primary`, text white.
- Count: bold `b` inline; a red count uses `CountPill tone="danger"`.
- `tone="inSheet"`: outer `fieldTint`, no shadow (24, T4). `compact`: padding 3, gap 2 (16). `tall`: segment 36 (T4).
- More than 4 segments: horizontal scroll, natural width (**proposed**).

**BandTabs** (`.seg`)
- Row height 44. Gap 22, or `spread` = space-between (10, 14, T2).
- Label `tab` (or `metaStrong` when `size="sm"`) in `onBandMuted`; active white.
- Indicator: 3 px `bandMark` under the active label, the label's full width, radius 3 3 0 0.
- Count `CountPill` after the label, gap 6.
- Board (07) uses BandTabs as the column switcher, synced with paging.

**CountPill** (`.ct`)
- min-width 20, height 18, padding 0 6, radius 9, `count` text.
- Default `bandField` / `onBandSoft`; `active` → `primary` / white; `danger` → `coral` / white.

**Props**
```ts
interface TabOption<T> { value: T; label: string; count?: number; countTone?: "danger"; icon?: LucideIcon }
interface SegmentedTabsProps<T> { value: T; options: TabOption<T>[]; onChange: (v: T) => void; tone?: "card" | "inSheet"; compact?: boolean; tall?: boolean }
interface BandTabsProps<T> { value: T; options: TabOption<T>[]; onChange: (v: T) => void; spread?: boolean; size?: "md" | "sm" }
```

### 3.11 `FilterPills` with counts — replaces `ui/ChipGroup.tsx`

**Visual** (05, 10, 22, T2; 23 and 24 in sheets)
- Row, gap 8, horizontal scroll, bleeding to the right edge (margin-right -16).
- Pill: height 32 (sheet 34), padding 0 12, radius 16, `metaStrong`, gap 6. Count bold.
- Idle: `surface` + whisper, `textSecondary`. With a `tone`: the chip tone's fill and text, no shadow.
- Active: `primary` fill, white, no shadow; optional check 14 (23).
- `tone="inSheet"` idle: `fieldTint`, no shadow.
- Skeleton: blocks 32 high in `skeleton`, widths 60/76/92/96 (20b).

**Props:** `{ value: T | null; options: { value: T; label: string; count?: number; tone?: ChipTone; icon?: LucideIcon }[]; onChange; tone?: "sheet" | "inSheet"; wrap?: boolean /* 23 reasons wrap */; label?: string }`

### 3.12 `SearchField` on navy — new

**Visual:** height 40, radius 20, `bandField`, padding 0 14, gap 8. Icon search 18 in `onBandMuted`. Text `body` white; placeholder `onBandMuted`. Clear x 18 appears when there is text (**proposed**). Tablet Home: width 340 inline.

**Props:** `{ value; onChangeText; placeholder; width?: number; onPress?: () => void /* Home: opens Search */ }`

### 3.13 Buttons — restyle `ui/Button.tsx`; new `IconButton`, `HeaderButton`, `CircleAction`

**Button** (`.btn`)
- Height 48, radius 24, `bodyStrong`, gap 8, icon 18.

| Variant | Fill | Text |
|---|---|---|
| `primary` | `primary` | white |
| `secondary` | `secondaryFill` | `text` |
| `danger` | `danger` | white |
| `onBrand` | `surface` | `primary` (Explain delay) |
| disabled | `disabledBg` | `disabledText` |

- Sizes: `sm` height 36, radius 18, 14/600, padding 0 16; `xs` height 32, padding 0 14, 13/600 (Accept, 06).
- Loading shows a spinner in the text colour. Pressed fills: §1.2.
- `trailingIcon` (Task 37b): the icon after the label, same size and ink ("Continue →", 01).

**IconButton** (`.ib`)
- 40, radius 20, `bandRaised`, white icon 20.
- `ghost`: transparent, width 36, margin-left -8, icon 24.
- Badge slot: `CountBadge` at top -5, right -8 (E `.ib .bdg`; was -4 here — E wins).

**HeaderButton** (`.hbtn`)
- Height 36, padding 0 14 0 12, radius 18, `primary`, 14/600, gap 6, icon 18.
- `ghost` → `bandRaised` (on `bandRaised` → `bandField`).
- `small`: height 28, padding 0 10 0 12, 13/600, trailing chevron-down 16 ("Change status", 15).

**CircleAction**
- 44 (11) or 40 (15, T3) circle, white icon (20 / 18).
- `tone`: `success` (call 11, message 15) or `primary` (call 15).
- `labelled` (T2): Button `sm` with fill `success`, phone 16, "Call".

### 3.14 Fields — restyle `ui/Input.tsx`, `Select.tsx`, `DateField.tsx`, `MobileInput.tsx`; new `FieldLabel`, `FieldRow`

- **Label:** `label` in `textSecondary`, margin-bottom 6. The required star is `danger` 700 " *". An xs chip may follow (T4 "Custom").
- **Field:**
  - Height 44, radius 12, `surface`, 1 px `border`, padding 0 12, gap 8, `body` `text`. Placeholder `textMuted`.
  - Leading icon 18 `textMuted` (lock and user on auth; search on customer).
  - Focused: 2 px `primary`, padding 0 11. Error: 2 px `danger`, padding 0 11, and the leading icon turns `danger`.
  - Disabled: `disabledBg`.
- **Prefix** ("+91", "₹"): `textSecondary` 600, padding-right 8, 1 px right border `border`, height 22.
- **Multiline:** min-height 72 (sheets 64–84), aligned top, padding-top 11, line-height 20.
- **Help:** `small` `textMuted`, margin-top 6. Error help: `label` `dangerText`.
- **Task 37b:** `invalid` = the error ring + red leading icon with no help line (03: the box above says why). `right` = a node inside the field after the text (12: clear X 18 `textMuted`). Inside any `Sheet` the field is gorhom's `BottomSheetTextInput` automatically (`ui/sheetContext`), so a sheet input keeps focus and rides the keyboard. `Select` and `DateField` take `labelTag` like `Input`; `DynamicField` passes its `tag` ("Custom", T4) to whichever it renders.
- **Select:**
  - Same field + chevron-down 18 `textMuted`. The value may render as a `Chip` (status, priority, resolution) or an Avatar 24 + name.
  - Opens a `Sheet` list using `ChoiceList` (§3.15).
- **DateField:** same field + calendar 18; keeps its local Y/M/D rule.
- **MobileInput:** prefix "+91", tabular digits; still no `maxLength`.
- **FieldRow** (`.two`): two fields, gap 10, each flex 1. Field block margin-bottom 12.
- `tone="onBrand"` is removed (the auth form now sits on white).

### 3.15 Sheets and dialog

**Sheet** (restyle `ui/Sheet.tsx`, `@gorhom/bottom-sheet`)
- Background `surface`, radius 24 24 0 0, padding 8 16 16 + bottom inset (34 on iOS frames).
- Handle: 40 × 5, radius 3, `grabber`, margin-bottom 14. Scrim `overlay`.
- **SheetHeader:** row, gap 12.
  - Optional `StatusBadge` 40.
  - Title `sheetTitle` + subtitle `meta` 13 `textSecondary`, ellipsis.
  - Close: 36 circle `background`, x 18 `textSecondary`.
- Keyboard: the sheet rides above the keyboard (13). Keep `keyboardAware`.

**ComposeSheet / ActionSheet:** same shell.
- ComposeSheet fields are `Input` (sheet-aware). `secure: true` masks a field with the show/hide eye and sends it untrimmed; `onDismiss` runs after the reset. Change password (19) is this sheet (Task 37b).
- ActionSheet rows become `ChoiceList` rows: padding 7 4, no separator, badge 36, `bodyStrong` label, flex; optional chip ("Current", lilac) or note (`small` `textMuted`); then the Radio.
- Selected row: background `fieldTint` (or `dangerRowTint` + `dangerText` label for a destructive choice, 25), radius 14.
- **Radio:** 22 circle, 2 px `borderStrong`; on = 7 px `primary` ring.

**CreateSheet** (`navigation/CreateSheet.tsx`, 04b)
- Header "Create" / "What do you want to start?" + close.
- Rows: gap 8, margin-top 16.
  - Card `surfaceMuted`, no shadow, padding 12 14, gap 14.
  - `StatusBadge` 48 in the module tone, icon 22.
  - `cardTitle` + `meta`.
  - chevron-right 18 `textMuted`.
- Footnote `small` `textMuted`, centred, margin-top 14: "Only the modules you can add to appear here."
- Rows come from `useAccess(m).add`: New task (lilac list-checks), New complaint (peach headset), New lead (mint target).
- With exactly one addable module, "+ New" skips the sheet and the label becomes "+ Lead" (27).
- New task → `TaskForm` with the personal workspace (**proposed**: last used workspace, else personal).

**Dialog** (restyle `ui/Dialog.tsx`, 21)
- Card margin 0 32, radius 24, padding 22 20 18.
- Optional `StatusBadge` 48 (destructive: red trash-2 22).
- Title `sheetTitle` margin-top 14; body `text` `textSecondary` margin-top 6.
- Buttons row gap 10, margin-top 20, flex 1 each: `secondary` Cancel + `primary` / `danger` confirm.

**Specific sheets** (built from the shell above, owned by the feature areas)
- Resolve (13): header green circle-check badge.
- Transfer (23): header indigo arrow-left-right.
- Log call (24): header sky phone-call.
- Lead status (25): header mint tag.
- Detail is in §4.

**Stepper** (24)
- Container: `fieldTint`, radius 22, height 44, padding 0 4, gap 4.
- Buttons: 36 circles `surface`, minus/plus 18 `textSecondary`.
- Value: 64 wide, 16/700 tabular (**proposed** variant `stepper` 16/22 700).
- Quick FilterPills inSheet: 2 · 5 · 10 · 15.

### 3.16 States — restyle `EmptyState`, new `SkeletonRows`, `ErrorCard`; `ScreenLoader` re-implemented on them

**EmptyState** (20a)
- The `BandSheet` content is centred with padding-top 96.
- Art: a 132 square, radius 40, filled with the module badge fill, icon 56 stroke 1.75 in the module ink.
- Accent badges with a 4 px `background` ring:
  - green check 52, radius 16, at right -12, bottom -4;
  - lilac chevrons-up 44, radius 12, at left -18, top 8.
- Title `recordTitle` margin-top 28; body `text` `textSecondary` margin-top 6, max-width 280; `Button secondary sm` margin-top 20.
- Props: `{ module: ModuleKey; icon?; accents?: ("done"|"escalated")[]; title; message?; actionLabel?; onAction? }`.

**SkeletonRows** (20b)
- No shimmer, no fade, solid blocks only. Exact ListRow geometry inside a ListGroup:
  - badge 40 square, radius 12, `skeleton`;
  - line 1: 14 high, radius 7, `skeleton`, width w1; right block 12 high, radius 6, `skeletonSoft`, width 56–72;
  - line 2 (margin-top 8): 12 high `skeletonSoft`, width w2; chip 46–56 × 22, radius 11; 22 circle.
- Widths cycle `[170,140,180,156,120,150]` / `[150,170,130,160,180,140]`.
- Props: `{ rows?: number; pills?: boolean }`.

**ErrorCard** (20c)
- Sheet padding-top 72.
- Card padding 28 20 20, centred: badge 72 red cloud-off 32; title `sheetTitle` margin-top 16 "Could not load. Try again"; body `text` `textSecondary` margin-top 6; full-width `primary` Button with refresh-cw 18 "Try again", margin-top 20.
- The band stays live (presets still switch).

### 3.17 `Avatar` initials on sorbet — restyle `ui/Avatar.tsx`; new `AvatarStack`

- 28 circle, `avatar` text 11/700, 2 px border `surface` by default at 28 (`ring={null}` removes it, as E's Home and comment avatars have none; on the band: border `band`).
- Sizes: 22 (9 px, no border), 24 (9), 36 (12), 40 (14), 44 (15), 88 (30, 4 px `bandField` border).
- Initials fill and ink come from `badgeTones`, cycling through indigo · butter · mint · lilac · peach · teal (a1–a6), picked by a stable hash of `UserId` (or name).
- Preset `color:<name>` maps to a sorbet tone (**proposed**):

  | Preset | Tone |
  |---|---|
  | violet | lilac |
  | blue | indigo |
  | cyan | teal |
  | green | mint |
  | amber | butter |
  | red | red |
  | pink | peach |
  | slate | slate |

- Image avatars unchanged. `icon:` presets: the icon in ink on the fill.
- **AvatarStack:** overlap -8; `+N` as a teal avatar with 10 px text.

### 3.18 `Timeline` — restyle `ui/Timeline.tsx`; activity list is `ListRow`

**TAT timeline** (09)
- Card padding 12 14 1.
- Entry: row, gap 12, padding-bottom 9 (last 11).
  - Node: StatusBadge 28.
  - Connector: 2 px `track` at left 13, from top 30 to bottom 2 (none after the last).
  - Head: `rowTitle` bold title (danger → `dangerText`) flex + time `label` `textSecondary` tabular (danger → `dangerText`).
  - Subline `small` `textMuted`.

**Activity rows** (11, T2)
- ListRow, align top, gap 10, separator inset 14 on the first group.
- Badge 32 (tablet 36).
- Text 14/18 with the verb bold 600 ("**Escalated** to Neha Kapoor"); sub `small` `textMuted` margin-top 2; right time.

### 3.19 `FactsGrid` / `FactsList` — new

- **FactsGrid** (11): Card, 2 columns, row-gap 14, padding 12 14.
  - Label `label` `textMuted`.
  - Value (margin-top 4): `rowTitle`, or a Chip, or Avatar 22 + name. Value tone `danger` → `dangerText`.
  - No grid lines.
- **FactsList** (T2, T3): rows padding 10 0 (T3 9 0), label 13/600 `textMuted` flex, value right `rowTitle` (or chip / avatar 22 + name, margin-right 6).
- **Lead contact card** (15): the contact row (mint smartphone badge, label "Mobile", mobile `bodyStrong` tabular, circle actions), then an inline 2-up facts row: padding 0 14 12 66, gap 16.
- Props: `{ items: { label: string; value?: string; node?: ReactNode; tone?: "danger" }[]; layout?: "grid" | "list" }`.

### 3.20 Small parts

- **Card** (keep): radius 16, whisper. `tone`: `surfaceMuted` / `followUpTint` / `dangerCardTint` / `primarySoft` set the fill with no shadow.
- **ProgressBar:** height 6, radius 3, `track`, fill `primary` (row; width 40). `lg` = height 8, radius 4 (08).
- **Checkbox:** 22, radius 7. Done: `success` fill, white check 14, stroke 3. Idle: 2 px `borderStrong`.
- **InfoNote** (22): Card `primarySoft`, no shadow, padding 12 14, gap 12, icon 18 `primary`, text 13/18 `moduleTones.inbox` ink.
- **Footnote** (06, 17, 26): row, gap 10, margin-top 14, padding 0 2, icon 16 + `small` `textMuted`.
- **PageDots** (07): bottom 10, centred, gap 6. Active 18 × 6, radius 3, `primary`; idle 6 × 6 `iconFaint`.
- **Toast** (no frame, **proposed**): `band` fill, radius 16, padding 12 14, white `text`; leading StatusBadge 32 (green check / red octagon-alert); slides in, no opacity.
- Retired: `Fab` (E uses "+ New" in the band), `Glyph`, `MenuList`, `ChipGroup`, `Segmented`, `ScreenHeader`, `navigation/FloatingTabBar`, `features/auth/FloatingShapes` (Task 40).

---

## 4. Screens

### 4.0 Data gaps: fields E shows that the app/API does not have

Every gap stays mobile-only: no SQL and no backend changes. "Real fix" names the server change for a later job.

| # | E shows | Gap | Proposal (mobile only) | Real fix (later) |
|---|---|---|---|---|
| G1 | Lead badges New / Contacted / Proposal | `lead_status` rows for all three share `Code = 'open'` (web tests: New/Contacted both `open`) | Rank `open`-coded rows by `SortOrder`: 1st → new (sky sparkles), 2nd → contacted (teal phone), 3rd+ → proposal (butter file-text). Other codes as in §1.6 | Icon/Tone column on `tblLookup` |
| G2 | Lead row "Call overdue · Sun, 1 Nov 5:00 pm" / "Visit today 4:30 pm" | `Lead` has only `NextFollowupDate`, no type | Generic "Follow-up {day} {time}" with a calendar-clock icon; red + "overdue" when `IsOverdue`; "No follow-up planned" when null | `sp_FetchLeads` returns `NextFollowupType` |
| G3 | "₹14,30,000 in play" (04), "Open value ₹11,23,000" (14), "₹11,23,000 open value" (27) | No aggregate | Sum `EstValue` over Mine leads with `StatusCode` open + qualified from one `PageSize: 200` fetch; hidden when `totalRecords > 200` | sum in pagination block |
| G4 | Workspace "4 open", "13 tasks", "9 tasks" | `sp_FetchWorkspaces` has no task count | Count from the existing all-workspaces open-tasks query, grouped by `WorkspaceId`; wording "N open" | count column |
| G5 | Member avatars on workspace rows | Only `MemberCount` | `fetchWorkspaceMembers` per shared/project row (cached, lazy); first 3 + "+N" | — |
| G6 | Invitation "invited by Neha Kapoor" | No inviter | Owner's name via `fetchUserDirectory` (cached): "Shared · from Neha Kapoor" | inviter column |
| G7 | Checklist step meta (ticked by · date; step assignee; step due) | `TaskChecklistItem` has none of it | Drop the meta lines; text only | — |
| G8 | Task stage To Do / In Progress / Done badges and pills | Columns are free text | `stage = IsCompleted ? done : (ChecklistDone > 0 ? inProgress : todo)`; meta still shows the real `ColumnTitle`. Board column badge: last column = done icon if every card in it is complete, first = to do, others = in progress | — |
| G9 | "Personal" chip on a task row | `Task` lacks the workspace type | Join on the cached `fetchWorkspaces` by `WorkspaceId` | — |
| G10 | "Completed this week 6" | My Work fetches open tasks only | `fetchTasks({AssigneeUserId: me, OnlyOpen: false, PageSize: 200})` filtered client-side by `CompletedDate >= Monday`; the same query feeds the Done pill | — |
| G11 | Hero "Resolved 12" "This week" | `FromDate` filters `CreatedAt`, not `ResolvedAt` | Count Mine + `StatusCode: resolved` + `FromDate` = Monday (created this week) — **flag** the meaning | `ResolvedFrom` param |
| G12 | Hero/preset "Escalated 1" | The escalated queue = escalated to me **or** overdue in my subtree | Use the queue as is (consistent with the list it opens) — **flag** | — |
| G13 | Preset counts (Mine 7 · Team 18 · Overdue 2 · Escalated 1) and pill counts (All 9 · Open 6 …) | No counts endpoint | One `PageSize: 1` query per count (Home's pattern), cached by params: complaints 4 presets + 5 statuses; leads 4; tasks client-side | counts endpoint |
| G14 | Transfer sheet "· 3 open" per person | `AssignableUser` has no load | Drop; show "JobTitle · BranchName" | — |
| G15 | Log call "No answer" | `Direction` is `in`/`out` only | "No answer" = `Direction: out` + the `call_outcome` lookup whose Value matches /no answer/i; hide the segment if the company has none | — |
| G16 | Lost status "Remarks" | `setLeadStatus` takes `LeadId, StatusId, LostReasonId` only | Drop the remarks field; keep the reason (required) | `Remarks` param |
| G17 | "Open follow-ups are cancelled" (25) | Not verified in `sp_SetLeadStatus` | Read the SP body before coding (`sys.sql_modules`, read-only); drop the sentence if untrue | — |
| G18 | "planned by Ayush Mishra" (15) | `FollowUp` has `CreatedBy` id only | Name via the cached `fetchUserDirectory` | — |
| G19 | Done row "next on Wed, 4 Nov" (17) | Not on the follow-up row | Drop | — |
| G20 | "Done today · 1" (17) | No `DoneAt` filter | `Status: done, DueFrom = DueTo = today` — **flag** (done today ≠ due today) | `DoneFrom` param |
| G21 | "On shift until 6:30 pm" (04, 27, T1) | `/api/today/mine` `me` carries the presence row, but `MyDay` types only `tasks` | Widen `MyDay.me` with `ShiftEnd` (verify the field name in `services/sessionService.js` / `presenceFor`); hide the row when null | — |
| G22 | "Signed in since 9:28 am · session ends 7:00 pm" | `loginTimestamp` is stored; `sessionExpiresAt` is not | Store `sessionExpiresAt` from login and every heartbeat (`expiresAt`) | — |
| G23 | Role chip "Admin" / "Support Agent" | No role (group) name in `AuthUser` | `JobTitle`; else "Admin" when `isAdmin`; else hidden. Tone: lilac if admin; else the tone of the single module the role has (peach complaints, mint leads, lilac tasks); else indigo | group name in login payload |
| G24 | Office "Head Office" | `AuthUser` has `BranchId` only | `fetchBranches` (cached) lookup | — |
| G25 | Global search (Home band; T1 "Search complaints, leads, tasks") | No search endpoint | New `SearchScreen`: debounced fan-out to `fetchTickets` / `fetchLeads` / `fetchTasks` with `SearchTerm`, `PageSize: 5` each, grouped by module, each group "See all" → the list with the term | search endpoint |
| G26 | Inbox badge per kind | `AppNotification.Type` strings live in `sp_Notify*` | Map by whole words of the snake_case type (Task 33 review: "dismissed" must not read as "miss"): `escalated`/`escalation` → lilac; `warn`/`due`/`overdue` → butter; `breach(ed)`/`miss(ed)` → red; `assign` → indigo user-check; `comment`/`reply` → teal; `workspace`/`added` → indigo user-plus; else slate bell. Verify the real strings (read-only) before coding | — |
| G27 | Inbox tile "1 escalation" | Counted only from the loaded page | Count unread escalations in the first page (50); hide the subtitle when 0 | — |
| G28 | TAT "Over by 3 h 41 m" | Working vs wall time | Wall-clock `now - DueAt` of the caller's open clock — **flag** | — |
| G29 | Swipe "Call" on a complaint row | — | `Linking.openURL("tel:" + CustomerMobile)`; hidden when no mobile | — |
| G30 | Lead "Message" (WhatsApp-style) | — | `whatsapp://send?phone=91{mobile}`, falling back to `sms:{mobile}` | — |

### 4.1 Frame → file map and layout

Notation: `Band{…}` = §3.1, `Sheet{…}` = §3.2, `Row` = ListRow, `Group` = ListGroup, `GH` = GroupHeader. "Diff" = what changes from the current screen.

#### 01 Company code — `features/auth/LoginScreen.tsx` (step "code")
- **Tree:**
  - `LinearGradient(gradients.auth)` + status bar light.
  - Brand block (padding 56 28 0): logo tile 56, radius 16, `surface`, hexagon 32 `primary`; "Nexus CRM" `display`, margin-top 24; tagline `bodyLg` `onBrandMuted`, max-width 280, margin-top 6.
  - White panel: absolute bottom, height 420, radius 24 24 0 0, padding 28 20 0.
    - Title `h1` "Enter your company code".
    - Sub `text` `textSecondary`, margin-top 6.
    - Field (margin-top 24): label "Company code", building-2 icon, autofocus; help "Not case-sensitive. Example: TestCRM".
    - Button "Continue" + arrow-right, margin-top 20.
    - Footer `small` `textMuted` "Nexus CRM · v{version}", absolute bottom 44, centred.
- **Data:** `fetchClientConfig`, unchanged.
- **Diff:**
  - `FloatingShapes` removed.
  - The form moves from onBrand fields onto a white panel.
  - The gradient changes to E's three stops.
  - The panel bottom rides the keyboard (**proposed**: `KeyboardAvoidingView`; the panel height becomes auto with min 420).

#### 02 Sign in — same file (step "login")
- **Tree:**
  - Centred brand block (padding 40 28 0): logo frame 72, radius 20, `surface`, holding the tenant `LogoURL` image, or the placeholder StatusBadge 56 (radius 14, slate building-2 28).
  - Tenant name `h1` white, margin-top 16 ("PRD Infotech (Test)" = `companyName`).
  - "Company code {compCode}" `text` `onBrandMuted`, margin-top 4.
  - Panel height 540: "Sign in" `h1`; sub "Use the username your admin set up for you." `text` margin-top 4.
  - Username field (user icon), margin-top 22. Password field (lock icon, eye toggle 18 `textSecondary`), focused.
  - Button "Sign in", margin-top 20.
  - "Not {company}? **Switch company**" `text` `textSecondary`, link `primary` 600, margin-top 20.
  - Footer version.
- **Data:** `login`, `clearClientConfig`.
- **Diff:** layout only; the copy matches E.

#### 03 Sign-in error — same file
- An error box replaces the sub line (margin-top 16):
  - `dangerSoft` fill, radius 16, padding 12, gap 12.
  - StatusBadge 36 red octagon-alert.
  - Title `rowTitle` `dangerText` "Wrong username or password"; body 13/18 `dangerText` "Check both and try again. Your admin can reset the password."
- Password field in the error state: lock icon `danger`. Button margin-top 16; switch line margin-top 18.
- **Data:** `authMessages.ts` maps codes to this title and body; other codes keep their own text in the same box.

#### 04 Home "Today" — `features/home/HomeScreen.tsx`
- **Tree:**
  - `Band variant=home`:
    - Row 56: Avatar 40 (no border, initials); column [date `small` 12/16 `onBandMuted` "Monday, 2 November"; greeting `h2` white "Good afternoon, {first}" + Hand 18 `greetIcon`]; IconButton search → Search; IconButton bell + CountBadge(unread) → Inbox.
    - Row h40, margin-top 2: clock 16 `onBandMuted` + `meta` "On shift until {ShiftEnd}" (G21) flex; HeaderButton "+ New" → CreateSheet.
  - `Sheet`:
    - HeroCard (complaints: headset, "My complaints", "This week · {overdue} past their TAT", stats Open (Mine) · Overdue (warn) · Escalated · Resolved (G11, G12)).
    - Bento 2 columns (`ModuleTile`): Tasks ("1 needs you", value Mine count "assigned to you") · Follow-ups ("Next at {first due time}", value due today "due today") · Leads ("{G3} in play", value Mine "yours") · Inbox ("{n} escalation", value unread "unread").
    - GH margin-top 14: title "Needs you" + red count chip, link "See all".
    - Group of ≤ 3 rows:
      - complaint row: peach headset badge, escalated dot if escalated; right "Overdue 2 h" danger; meta "C-1042 · Customer";
      - task row: lilac list-checks; right "Explain" `primary` when a reason is owed; meta "Workspace · Column" + chip red timer "Missed".
  - BottomBar.
- **Data:**
  - Existing queries (tickets mine/overdue, leads mine, follow-ups today, `myTasksQuery`, `MY_DAY_QUERY`, `useUnreadCount`).
  - New: tickets escalated count, resolved-this-week count, follow-ups today `PageSize: 1` with `first` time, the G3 sum, the top 3 overdue mine tickets, unread notifications page (G27).
- **Hero choice:** complaints if `complaints.view`, else leads (27), else tasks (**proposed**: "My tasks" · Assigned · Needs you · Overdue · Done this week).
- **Tiles:**
  - multi-module: [Tasks?, Follow-ups?, Leads?, Inbox], with Inbox dropped when that makes the count odd and > 2;
  - leads-only: [Leads, Follow-ups];
  - tasks-only: [Tasks, Inbox] (**proposed**);
  - complaints-only: [Inbox spanning 2] (**proposed**).
- **"See all"** → Tasks "mine" if tasks; else Complaints overdue; else Follow-ups today (**proposed**).
- Every number keeps the "opens exactly what it counts" rule (commit 941a834).
- **Diff:** MenuList rows → hero + tiles + Needs-you list; a white header → the navy band; the bell moves into the band.

#### 04b Create sheet — `navigation/CreateSheet.tsx` (Phase 1)
- §3.15. Opened from the band "+ New" (Home, T1 rail). Rows by `add` grants. The sheet sits over the bar; the home indicator turns dark.

#### 05 Tasks / My Work — `features/tasks/MyWorkScreen.tsx`, `TaskCard.tsx`
- **Tree:**
  - `Band variant=tabs`: title "My Work"; IconButton search (toggles a SearchField in the band, **proposed**); HeaderButton "+ New" → TaskForm (personal or last workspace); BandTabs Mine(3) · Unassigned(5) · All(29).
  - `Sheet`:
    - FilterPills: Any status (active) · To Do n (slate) · In Progress n (teal) · Done (green) (G8, G10).
    - GH "Sorted by deadline" + right `label` `textMuted` "Updated {time}" (`dataUpdatedAt`).
    - Group of `TaskRow`s (Row align top, padding 12):
      - badge by stage;
      - l1 title + priority chip (flag icon);
      - l2 meta "Workspace · Column" + `label` "11 of 12" + ProgressBar 40;
      - l3 (margin-top 6) due chip (TAT chip butter timer "Due in 3 h" / slate calendar "Fri, 6 Nov" / slate lock "Personal") + spacer + AvatarStack.
    - Card row "Completed this week" (green check-check 36, right count, chevron) → All + Done pill.
    - Card row "Open a board" (lilac layout-dashboard 36, "N workspaces") → Boards. Margin-top 12/8, padding 11 14.
  - BottomBar (Tasks active, badge).
- **Data:** `myTasksQuery`, all-workspaces open tasks, G9/G10 joins, `MY_DAY_QUERY`.
- **Diff:**
  - Greeting header → band.
  - ChipGroup → BandTabs + FilterPills.
  - TaskCard → TaskRow inside a Group (no card per task).
  - Fab → band "+ New".
  - The sign-out Dialog on My Work is removed (sign-out lives in More).
  - **flag:** E omits the "Needs you" section here (Home carries it). **Proposed:** keep it as a GH "Needs you · n" + Group above "Sorted by deadline", only when n > 0.

#### 06 Workspaces — `features/workspaces/BoardsScreen.tsx`, `WorkspaceCard.tsx`
- **Tree:**
  - `Band variant=record`: back; title "Workspaces"; HeaderButton "+ New" → WorkspaceForm; SearchField "Search workspaces" (client filter).
  - `Sheet`:
    - GH "{n} workspaces" (margin-top 4).
    - Group, rows padding 14:
      - badge by type (§1.6);
      - title 15 (`bodyStrong`) + AvatarStack (G5);
      - l2 chip type + meta ("Only you · 4 open" / "6 members · 13 tasks · manager" / "Team from project · 9 tasks", G4);
      - chevron.
    - GH "Invitations · n" + Group: teal user-plus; title; meta "Shared · from {owner}" (G6); Button xs "Accept".
      - **flag:** Decline moves to long-press → ActionSheet (E shows only Accept).
    - Footnote lock "Personal workspaces are private, even from admins. Shared ones need the invite accepted."
  - BottomBar (More active).
- **Diff:** cards → rows; Fab → band button; title "Boards" → "Workspaces".

#### 07 Board — `features/workspaces/BoardScreen.tsx`, `ui/BoardColumns.tsx`
- **Tree:**
  - `Band variant=tabs`: back; title block `h2` "Sales Ops" + `meta` "Shared · 6 members · you are manager" (ellipsis); IconButton search; IconButton ⋮ (settings, columns); BandTabs = columns with counts (synced to paging).
  - `Sheet bleedRight` (padding 16 0 0 16):
    - BoardColumns: column width `window - 80` (310 on 390), capped at 360 so a tablet shows several, gap 10, snap.
    - Column: `surfaceSunken`, radius 18, padding 10 8 8.
      - Head (padding 2 4 10, gap 8): badge 28 by G8 position; title `rowTitle` 700 (14/700 **proposed** `rowTitleBold`); count `label`; plus 18 `textSecondary` → TaskForm with `columnId`.
      - Cards: `Card` padding 12, margin-bottom 8, no shadow (`useOnBoard`). Title `rowTitle`; meta row margin-top 8 = priority chip (no icon), due chip slate calendar / red timer "Missed", spacer, list-checks 14 + "0/3" `label`, Avatar(s).
      - Footer "Add task" (40 high, `primary` 14/600, plus 18).
    - PageDots bottom 10.
  - Long-press a card → "Move to…" ActionSheet (unchanged behaviour).
- **Diff:** column width ratio 0.86 → `window - 80`; column header and dots added; column switcher in the band.

#### 08 Task detail · Checklist — `features/tasks/TaskDetailScreen.tsx`, `Checklist.tsx`
- **Tree:**
  - `Band variant=record`:
    - Row: back; `meta` flex "Workspace · Column"; IconButton pencil → TaskForm; IconButton ⋮ → task actions ActionSheet (claim, log time, move, dependencies, delete).
    - Title `recordTitle` white, margin-top 2.
    - Row margin-top 12, gap 8: AvatarStack (border `band`); priority chip; TAT chip.
  - `Sheet`:
    - SegmentedTabs: Details · Checklist · Comments n · Deadline (Deadline hidden on personal).
    - Checklist tab:
      - Card padding 14: "3 of 5" `h1` tabular + "steps done" `meta` `textSecondary` flex + "60%" `metaStrong` `primary`; ProgressBar lg margin-top 10; `small` `textMuted` "The task completes itself when every step is ticked." margin-top 8.
      - Group margin-top 12, separator 48:
        - done rows: Checkbox done + text `text` `textMuted` line-through;
        - open rows: Checkbox + `rowTitle` + grip-vertical 18 `iconFaint` (reorder via `react-native-reorderable-list`);
        - last row "Add a step" `primary` 14/600 plus 22 → ComposeSheet.
  - BottomBar (Tasks active).
- **Data:** `getTaskChecklist`, `saveTaskChecklist`. G7: meta lines dropped.
- **Diff:**
  - Tabs are cut from 6 to 4.
  - Files and History move into **Details** (**proposed** Details tab: description Card `text`, FactsGrid (Workspace, Column, Due, Time allowed, Logged time, Blocked by), AttachmentList, GH "History" + activity rows).
  - Fab removed.

#### 09 Task · Deadline — `features/tasks/TatTab.tsx`
- **Tree** (inside the 08 shell):
  - Deadline HeroCard (§3.8): "Your clock" + chip red "Missed deadline" / butter "Due in…" / green "On time".
    - Target = `TatMinutes` as "8 h 00 m"; Over by (G28).
    - Split bar: used = elapsed / target, capped at 100, then overrun.
    - Footer "Working time on your shift" / "Due {day} · {time}"; onBrand pill "Explain delay" (opens the existing reason sheet; hidden when no reason is owed).
  - Hold Card (padding 10 14, margin-top 10): butter circle-pause badge; label "Reason given for the hold"; reason `bodyStrong`; right date. Only when a hold exists.
  - Timeline Card (margin-top 10): Started (`AssignedAt`) · Held (each hold: reason · duration "added back") · Due · Breached (`BreachedAt`; sub "Stays on record, even if reopened").
- **Data:** `fetchTaskTat` (clocks, holds, events).
- **Diff:** the current chip/list TAT layout → hero + timeline. Verdict and other-assignee clocks stay below the timeline as Group rows (**proposed**, not drawn).

#### 21 Confirm dialog (Task comments) — `TaskDetailScreen.tsx` comments tab
- **Comments tab:**
  - Cards (padding 12 14, gap 10, margin-top 8): Avatar 28 no border; name `rowTitle` 700 flex + time `label`; text `text`, margin-top 2.
  - The comment being deleted gets `tone=dangerCardTint`.
  - Composer (**proposed**, not drawn): an Input row pinned above the bar with a send IconButton.
- **Dialog:** red trash badge 48; "Delete this comment?"; body quoting the comment + "is removed for everyone in {workspace}. This cannot be undone."; Cancel / Delete (danger).

#### 10 Complaints list — `features/support/ComplaintsScreen.tsx`, `ComplaintCard.tsx` → `ComplaintRow.tsx`
- **Tree:**
  - `Band variant=tabs`: title "Complaints"; HeaderButton "+ New" → ComplaintForm.
  - SearchField "Search number, customer, mobile".
  - BandTabs spread, sm: Mine · Team · Overdue (red count) · Escalated.
  - `Sheet`:
    - FilterPills: All n (active) · Open n (sky) · On hold n (butter) · Resolved n (green) · Closed n (slate) · Rejected (red).
    - Group margin-top 12 of `ComplaintRow`:
      - badge by StatusCode + escalated dot;
      - l1 Subject + right due ("Overdue 2 h" danger from `dueLabel` reworded to E's "Overdue 2 h" / "Due 5:30 pm" today / "Tue, 3 Nov" later / "Done 1:10 pm" success on resolved (`ResolvedAt`) / date on closed);
      - l2 `TicketNo` + " · " + CustomerName (ellipsis) + status chip + priority icon-only chip (flag, tone by priority);
      - closed rows: title `textSecondary`.
    - Each row is a SwipeRow (22).
  - States: SkeletonRows (20b), EmptyState (20a), ErrorCard (20c).
  - BottomBar (Complaints active, badge = Overdue count).
- **Data:** `fetchTickets` (infinite); counts per G13.
- **Diff:**
  - The Unassigned preset is dropped (**flag**).
  - Status default "Active" → "All" pill = no status filter within the preset. Preset counts stay active-only, to match Home.
  - Card → row.
  - Fab → band button.

#### 20a / 20b / 20c States — `ComplaintsScreen.tsx`
- **20a:** EmptyState module complaints, accents done + escalated.
  - Copy per preset; Escalated: "No complaints here" / "Nothing is escalated to you right now. New escalations appear here and in your Inbox." / "Show all of mine" → Mine.
  - Other presets (**proposed**): Mine "Nothing assigned to you"; Overdue "Nothing past its due time".
- **20b:** SkeletonRows `pills rows=6` under the live band.
- **20c:** ErrorCard; the band stays interactive.

#### 22 Complaint row mid-swipe — `ComplaintRow.tsx`
- Left actions (swipe left): Call (tel, G29) · On hold → status sheet with onhold preselected (hidden if terminal or already on hold) · Resolve → Resolve sheet.
- Right action (swipe right): Escalate → Escalate sheet (hidden if no targets or the row is terminal).
- InfoNote shown once (**proposed**: until the first successful swipe, kept in AsyncStorage): "Swipe left: Call · On hold · Resolve. Swipe right: Escalate. Each opens its sheet; nothing changes on the swipe alone."

#### 11 Complaint detail — `features/support/ComplaintDetailScreen.tsx` (split into `ComplaintDetailBody.tsx` for T2)
- **Tree:**
  - `Band variant=record`:
    - Row: back; title block `h2` TicketNo + `meta` "Opened {day} · {time}"; IconButton ⋮ → ActionSheet (Edit, Change status (close / reject / reopen), Files, Delete).
    - Title `recordTitle` margin-top 4.
    - Chips margin-top 10, gap 8: status chip with icon; lilac "Escalated to {EscalatedToName}" if escalated.
  - `Sheet`:
    - Customer Card (padding 12 14, gap 12): peach building-2 badge; name `bodyStrong` ellipsis; sub `meta` "{ContactPerson ?? CustomerContactPerson} · {mobile}"; CircleAction 44 success phone → tel.
    - FactsGrid margin-top 10: Category · Priority (chip) · Assigned to (Avatar 22 + name) · Due ("12:40 pm · 2 h over" danger when overdue).
    - GH "Activity" + link "All {n}" (expands; collapsed shows 4).
    - Group of activity rows (§3.18; G-mapping §1.6).
  - **ActionBar** (via `useActionBar`): Log call · On hold · **Resolve** (main) · Transfer · Escalate.
    - Variants (**proposed**): on hold → second item "Resume" (circle-play → `setTicketStatus` open); terminal → main item "Reopen" (when `canReopen`), and On hold / Resolve / Escalate hidden; no edit right → Log call only.
- **Data:** `fetchTicketDetail` (ticket, fields, activity, assignments, linkedLead); `logCall`, `setTicketStatus`, `resolveTicket`, `transferTicket`, `escalateTicket`.
- **Diff:**
  - Segmented Details/Files/History → a single scroll: customer, facts, activity.
  - Custom fields, linked lead, handovers and files move under Activity as GH "Details" (custom FactsGrid), GH "Files" (AttachmentList), GH "Handovers" (**proposed**, not drawn).

#### 13 Resolve sheet — inside `ComplaintDetailScreen.tsx` (`ResolveSheet.tsx`)
- SheetHeader: green circle-check badge, "Resolve complaint", "{TicketNo} · {Subject}".
- Select "Resolution *": the value renders as a green chip with circle-check (`resolution` lookups).
- Remarks * textarea, min-height 84, focused; help "Required. Shows in the complaint history."
- Button "Save · mark resolved". Keyboard-aware.

#### 23 Transfer sheet — `TransferSheet.tsx`
- Tall sheet (top 84 → snap 90%).
- SheetHeader: indigo arrow-left-right, "Transfer complaint", "{TicketNo} · now with {AssigneeName}".
- Label "Transfer to *".
- Search field (height 40) "Search people in your reach" (client filter over `fetchAssignableUsers`).
- ChoiceList of people (padding 9 4): Avatar 36; name `rowTitle`; `label` 500 "JobTitle · BranchName" (G14); Radio. The selected row is `fieldTint`, radius 14.
- Label "Reason *" → FilterPills inSheet wrap over `transfer_reason` lookups; the active pill gets a check.
- Remarks * textarea min-height 64; error state + help "Remarks are required for a transfer." shown after a submit attempt.
- Info line: clock 14 + `small` "Due stays {due}. A transfer never moves the TAT clock."
- Button "Transfer to {first name full}".

#### 24 Log call sheet — `ui/LogCallSheet.tsx` (built generic in Phase 1, Task 33; complaints and leads both use it)
- SheetHeader: sky phone-call, "Log call", "{contact} · {mobile}".
- Label "Direction" → SegmentedTabs inSheet with icons: Outgoing (phone-outgoing) · Incoming (phone-incoming) · No answer (phone-missed, G15).
- Label "Duration" → Stepper + quick pills 2 · 5 · 10 · 15.
- "What was said *" textarea min-height 76 (**change:** notes required).
- Label "Then" → pills inSheet: Keep open (active) · Put on hold (butter, circle-pause 14) · Resolve (green, circle-check 14). Complaints only; hidden on terminal.
- Button "Save call" → `logCall`, then `setTicketStatus(onhold)` or open the Resolve sheet.
- The outcome Select (lookups) moves under the Duration row (**proposed**, not drawn).
- Props: `{ title; subtitle; outcomes?: Lookup[]; then?: { value; label; tone?; icon? }[]; busy; onSubmit({ direction, minutes, notes, outcomeId, then }) }`. Leads pass no `then`; they get "Next follow-up" via the follow-up sheet instead.

#### 12 New complaint — `features/support/ComplaintFormScreen.tsx`
- **Tree:**
  - `Band variant=record`: close X; title `h2` "New complaint" / "Edit complaint"; right `meta` = branch name (G24).
  - `Sheet` (scroll):
    - Customer * field: search icon, clear x, focused.
      - Dropdown Group (margin-top 6, `elevation.popover`), rows padding 9 12: peach building-2 36; name `rowTitle`; `label` "Contact · mobile".
      - Last row `fieldTint`, `primary` 14/600, indigo user-plus 36: `Add new customer "{term}"` → the inline new-customer block (existing fields restyled).
    - Subject *.
    - Description (textarea min-height 64).
    - FieldRow Category | Priority (value = chip with flag).
    - Attachments block: label "Attachments · {n}"; row height 60, gap 8:
      - image thumb 60, radius 14, remove x on a 20 `text` circle;
      - file Card (padding 10, red file-text badge, name 13 `rowTitle`, `label` "PDF · 284 KB", x 16);
      - add tile 52 wide, radius 14, `primarySoft`, paperclip `primary`.
    - GH "More details" + **proposed** fields not in E: Channel, Product, Reported by, Phone or email, Assign to, custom fields.
  - Fixed footer: `surface`, padding 10 16 + inset, `elevation.footer`, Button "Submit complaint".
  - No bottom bar.
- **Data:** unchanged (`fetchCustomers`, `saveCustomer`, `saveTicket`, `uploadAttachment`, ref data).
- **Diff:** field order per E; the office picker moves to the band subtitle (tap → Select, **proposed**); "What happened" → "Description".

#### T2 Tablet Complaints — `ComplaintsScreen.tsx` + `ComplaintDetailBody.tsx`
- Rail · list pane 420 (band padding 4 20 16; pills; rows; selected `primarySoft`).
- Detail pane:
  - Band `bandRaised`, padding 4 28 36.
  - Row: `h2` TicketNo + HeaderButtons ghost (`bandField`) Log call · On hold · Transfer · Escalate + filled Resolve.
  - Title `titleLg` margin-top 4.
  - Chips: status, priority, escalated + `meta` "Opened …".
  - Sheet padding 20 24 0. Row gap 16 of two Cards:
    - customer: padding 16; badge + name + "Contact: …"; then smartphone 18 + mobile `bodyStrong` + Button sm success "Call";
    - FactsList padding 4 16.
  - Then GH Activity + rows (badge 36, padding 12 16).

#### 14 Leads list — `features/sales/LeadsScreen.tsx`, `LeadCard.tsx` → `LeadRow.tsx`
- **Tree:**
  - `Band variant=tabs`: title "Leads" + count `meta` "{n} yours" (baseline); HeaderButton "+ New" → LeadForm.
  - SearchField "Search name, company, mobile".
  - BandTabs spread: Mine · All · Overdue (red) · New.
  - `Sheet`:
    - GH (margin-top 0) "By next follow-up" + right `label` `textSecondary` "Open value ₹…" (G3).
    - Group of `LeadRow` (align top):
      - badge by status (G1);
      - l1 Name + `amount` `rupees(EstValue)`;
      - l2 meta "Company · Product" (ellipsis) + status chip;
      - l3 icon 14 + `label` follow-up text (G2): overdue in `dangerText` with the icon red; none → calendar-clock + "No follow-up planned" `textMuted`;
      - lost rows: name `textSecondary`, amount `textMuted`, l3 "{LostReason} · {date}" (T3).
  - BottomBar (Leads active).
- **Data:** `fetchLeads`; presets via `leadQueueParams`, where `New` = `StatusId` of the first `open`-coded row (G1). Counts per G13.
- **Diff:**
  - Unassigned preset → New (**flag**).
  - The status ChipGroup is removed (E has no status pills, **flag**).
  - Card → row; Fab → band.

#### 15 Lead detail · Follow-ups — `features/sales/LeadDetailScreen.tsx`, `LeadDetailParts.tsx` (split `LeadDetailBody.tsx` for T3)
- **Tree:**
  - `Band variant=record`:
    - Row: back, spacer, IconButton pencil → LeadForm, IconButton ⋮ (Convert / Lost via the status sheet, Files, Skip follow-up).
    - Row (align end, gap 12): [name `h1` + `meta` "Company · Product"] + right [`meta` "Est. value" + `h1` tabular ₹].
    - Row margin-top 12, gap 8: Chip md with the status tone and icon; HeaderButton small ghost "Change status ⌄" → StatusSheet (25).
  - `Sheet`:
    - Contact Card (§3.19):
      - mint smartphone badge; "Mobile" label + mobile;
      - CircleAction 40 primary phone (tel) + 40 success message-circle (G30);
      - facts row: Owner (Avatar 22 + name), Source (megaphone 16 + `SourceName`).
    - SegmentedTabs margin-top 12: Details · Follow-ups n · Activity.
    - Follow-ups tab:
      - next-follow-up Card (`followUpTint`, padding 14): butter calendar-clock badge; chip brand "Next" + `rowTitle` "Tue, 3 Nov · 11:00 am"; sub `small` `warningText` "Call · in 20 h · planned by {name}" (G18); Remarks `text`, margin-top 10.
      - Group margin-top 10 of the other follow-ups: open = badge by type + title (Remarks) + `label` "Visit · Sat, 7 Nov · 3:00 pm"; done = green check + `textSecondary` title + "… · done".
  - **ActionBar:** Call · Message · **Log follow-up** (main) · Status · Transfer.
- **Data:** `fetchLeadDetail`, `completeFollowUp`, `scheduleFollowUp`, `skipFollowUp`, `setLeadStatus`, `convertLead`, `transferLead`, `logCall`.
- **Diff:**
  - Header "Lead" → the navy band with name, value and status.
  - Buttons Call / Log follow-up / Schedule → the action bar.
  - Tabs Details/Follow-ups/Files/History → Details/Follow-ups/Activity. Files move into Details (**proposed**: Details = FactsGrid of Email, Alt mobile, Address, City, Branch, Created, custom fields + AttachmentList).
  - "Log follow-up" = complete the next open follow-up (the existing ComposeSheet, restyled), or schedule one when none is open.

#### 25 Lead status sheet — `StatusSheet.tsx` (sales)
- SheetHeader: mint tag, "Change status", "{Name} · now {StatusName}".
- ChoiceList of every `lead_status` row (badge 36 by G1; `bodyStrong` label; "Current" lilac chip on the current row; "asks final value" `small` on the converted row; Radio).
- A Lost choice tints the row `dangerRowTint` with a `dangerText` label and opens a panel (`surfaceMuted`, radius 16, padding 12, margin-top 12): Select "Why was it lost? *" (value as a red chip; `lost_reason`), help "A reason is required for Lost." (+ G17 sentence only if verified). Remarks dropped (G16).
- A Won choice opens the same panel with "Final value *" (₹ prefix) + Remarks → `convertLead`.
- Button "Save · mark {status lower-case}".

#### 16 Lead form — `features/sales/LeadFormScreen.tsx`
- `Band variant=record`: close X; `h2` "New lead" / "Edit lead"; HeaderButton "Save" (padding 0 16), with a loading state.
- `Sheet` (scroll), in order:
  1. Name *
  2. FieldRow Mobile * (+91) | Alternate mobile (+91, placeholder "Optional")
  3. Company
  4. FieldRow Source | Product
  5. FieldRow Estimated value (₹) | Status (chip value; create only)
  6. Owner (Avatar 24 + "{name} (you)"; create only)
  7. "First follow-up" SegmentedTabs compact: Tomorrow · In 3 days · Pick date (calendar 14) · None; help `small` tabular "Call on Tue, 3 Nov at 11:00 am"
  8. GH (margin 6 2 8) "More details" + slate chip "Custom field"
  9. the company's custom fields (DynamicField restyled)
  10. **proposed** below them: Email, City, State, Pincode, Address, Remarks
- No bottom bar; no footer (Save is in the band).
- **Diff:** Save moves to the band; pairs; the presets become segmented.

#### 17 Follow-ups queue — `features/sales/FollowUpsScreen.tsx`
- **Tree:**
  - `Band variant=record`: back (only when pushed); `h1` "Follow-ups"; IconButton search (toggles the band SearchField); IconButton calendar (Pick date → `DueFrom`/`DueTo` = that day, **proposed**).
  - `meta` "{Mon, 2 Nov} · {n} calls and visits left today".
  - `Sheet`:
    - SegmentedTabs: Today n · Overdue (red count) · Upcoming.
    - Group margin-top 12 of SwipeRows (right = Done, left = Reschedule):
      - badge by type;
      - l1 LeadName + right time `label`;
      - meta "{Type} · {LeadCompany} · {Remarks}";
      - trailing Chip lg green check "Done" (onPress → done sheet).
    - GH "Done today · n" + done rows (G20): green check badge, name `textSecondary`, meta "{Type} · {LeadCompany}" (G19).
    - Footnote arrow-right "Swipe a row right to mark it done, left to reschedule."
  - BottomBar (Follow-ups tab active for leads-only users; More when pushed).
- **Data:** `fetchFollowUps` (`followUpViewParams`), `completeFollowUp`, `scheduleFollowUp`.
- **Diff:** the All view is dropped (**flag**); the screen header becomes the band; cards → rows; Done inline.

#### T3 Tablet Lead detail — `LeadsScreen.tsx` + `LeadDetailBody.tsx`
- List pane as 14 (no GH; lost row variant).
- Detail band `bandRaised`:
  - Row: spacer + ghost HeaderButtons Transfer · Edit + filled "Log follow-up".
  - Name `titleXl` + `meta`; status chip md + "Change status" (ghost on `bandField`); right "Estimated value" + `statValue`.
- Sheet padding 20 24 0, row gap 16:
  - left column 300: Contact Card (padding 14 16) + FactsList Owner · Source · Product · custom fields · Created;
  - right column flex: SegmentedTabs + next Card (padding 16; + Button sm "Mark done" check 16 + Button sm secondary on `surface` "Reschedule") + Group.

#### T4 Tablet Lead form — `LeadFormScreen.tsx`
- The rail stays. Band padding 4 32 36, row 60: close X, `h1` "New lead", HeaderButton ghost "Cancel", HeaderButton "Save lead" (padding 0 18).
- Sheet padding 24 0 0, overlap 20, radius 24.
- Centred Card, width 640, padding 20 20 8. Same fields; Owner pairs with "Roof type" (label + xs chip "Custom"); the segmented control is inSheet + tall; help adds "· reminder in your Follow-ups queue".

#### 18 Inbox — `features/notifications/NotificationsScreen.tsx`
- `Band variant=record`: back; `h1` "Inbox"; HeaderButton ghost check-check 16 "Mark all read" (only when unread > 0); `meta` "{n} unread".
- `Sheet`: GH "Today" (margin-top 0) + Group; GH "Earlier" + Group.
  - Rows align top: badge per G26; l1 Title + right time ("2:05 pm" today / "Sun, 1 Nov" earlier); l2 meta Body + an 8 px `primary` dot when unread.
  - Unread rows: `unreadTint`, title 600 `text`. Read rows: title 500 `textSecondary`.
  - Tap → mark read + open the entity (existing routing).
- BottomBar: Today active (Inbox is owned by Home). Tablet: Inbox is a rail item.
- **Diff:** cards → grouped rows; the Day grouping is new.

#### 19 More / Profile — `features/home/MoreScreen.tsx` (+ `features/profile/MeScreen.tsx`, `AccountForms.tsx`)
- `Band variant=profile`, centred:
  - Avatar 88, margin-top 16.
  - Name `recordTitle`, margin-top 12.
  - Row margin-top 6, gap 8: role Chip (G23) + `meta` "{Branch} · {companyName}" (G24).
- `Sheet`:
  - Group 1 (rows padding 12 14, label `bodyStrong`, chevron):
    - Inbox (indigo inbox; CountBadge static with a `surface` border);
    - Workspaces (lilac layout-dashboard; right count) — when tasks;
    - Follow-ups (butter calendar-clock; chip butter "{n} today") — when leads and not a tab.
  - Group 2 (margin-top 12):
    - Profile (slate user) → Me;
    - Change password (slate key) → the password ComposeSheet (from AccountForms);
    - Sign out (red log-out; label `dangerText`; no chevron) → Dialog confirm.
  - Footer `small` `textMuted` centred, margin-top 20: "Nexus CRM · v{version}" / "Signed in since {loginTimestamp} · session ends {sessionExpiresAt}" (G22).
- BottomBar: More active.
- **MeScreen** (no frame, **proposed**): `Band variant=profile` with Avatar 88 + name; Sheet = a Card with editable fields (Full name, Email, Mobile, Avatar preset) + Save in the band (16's pattern). The stats tiles on Me are dropped.
- **Diff:** More becomes the profile hub; Sign out moves here from My Work / Me.

#### 26 More · complaints-only — same file
- Avatar uses the hash tone; the role chip is peach (G23).
- Group 1 = Inbox only; Group 2 the same.
- Footnote shield-check: "Your role covers {Complaints} only, so {Tasks, Leads, Workspaces and Follow-ups} do not appear. Ask your admin if that is wrong." Generated from the missing modules; shown only when ≥ 1 module is missing.
- BottomBar: Today · Complaints · More (3 equal tabs; already produced by `tabsFor`).

#### 27 Home · leads-only — `HomeScreen.tsx`
- Band as 04 with "+ Lead" (a single addable module → no Create sheet).
- Hero: target "My leads", "{G3} open value", stats Open · Overdue (warn) · New · Won.
- Tiles: Leads ("{n} overdue calls", "yours") · Follow-ups ("Next at {time}", "due today").
- Needs you: overdue + today's follow-ups (badge red phone when overdue, else by type; right "Overdue 21 h" danger or the time; meta "{Type} · {Company}").
- BottomBar: Today · Leads · Follow-ups (badge = overdue) · More.

#### T1 Tablet Home — `HomeScreen.tsx` (§2.2 rule 4)
- Rail (Today active, Inbox badge 63).
- Band row 60: Avatar 44; `small` "Monday, 2 November · On shift until 6:30 pm"; greeting 22/28 700 (`h1`) + Hand 22; SearchField width 340 (→ Search); bell; "+ New".
- Grid: Hero (span 2) · Tasks tile · Follow-ups ("Next at 3:00 pm · 2 overdue") · Leads · Inbox.
- Row 2fr/1fr: Needs you (rows padding 12 16 with inline status/priority chips and fixed 96-wide right text) | GH "Follow-ups today" + link "Queue" + compact rows (36 badges, padding 9 14).

#### Search (no frame; G25) — `features/search/SearchScreen.tsx` (Phase 1)
- `Band variant=tabs`: back + autofocused SearchField.
- `Sheet`: per module with access, GH "{Module} · n" + link "See all" + a Group of ≤ 5 rows (ComplaintRow / LeadRow / TaskRow as plain rows built from ListRow, so Phase 1 does not depend on feature files).
- Empty: EmptyState "No matches". The minimum term is 2 characters.

#### Screens without an E frame (restyled to the patterns above, **proposed**)
| Screen | Pattern |
|---|---|
| `TaskFormScreen` | 16's pattern (band Save; fields in E field style; pairs) |
| `WorkspaceFormScreen` | 16's pattern |
| `WorkspaceSettingsScreen` | Band record + Groups (members as rows with Avatar 36 + role chip + ⋮) |
| `ColumnsScreen` | Band record + Group of columns with grip-vertical + reorder |
| `ReauthDialog`, `PresenceNoticeDialog` | Dialog (§3.15) |
| `DependencySheet`, `TimeSheet` | Sheet + ChoiceList / ComposeSheet |
| `FileViewer` | Band record (title = file name) on `background` |

---

## 5. Fidelity checks

### 5.1 Per-screen checklist (measurable; each item is asserted in a test where marked [T], else checked on the screenshot [S])

| Frame | Checks |
|---|---|
| all | [T] no colour, size or weight literal (guard); [T] the bar/rail item for the route is active with its module pill tone; [S] status-bar area is navy (auth: gradient); [S] sheet top radius 20 overlaps the band by 16 |
| 01 | [T] copy "Enter your company code", "Your admin gives you this code. You only enter it once on this phone.", "Not case-sensitive. Example: TestCRM", "Continue", "Nexus CRM · v…"; [S] gradient 3 stops; panel radius 24; logo 56 |
| 02 | [T] tenant name, "Company code {code}", "Sign in", "Use the username your admin set up for you.", "Switch company"; [T] password masked + eye toggle; [S] logo frame 72 / inner 56 |
| 03 | [T] the error renders in the form (not only a toast) with "Wrong username or password" + body; [T] password field in the error style (`danger` border token) |
| 04 | [T] order: band greeting → shift row + New → hero → tiles → Needs you; [T] hero stat order Open, Overdue, Escalated, Resolved; Overdue uses `onBrandWarn`; [T] each stat/tile navigates with the params it counted; [T] bell badge = unread, "99+" cap; [S] tiles 112 high, radius 20, module fills |
| 04b | [T] rows only for `add` grants, order task, complaint, lead; footnote copy; [T] one addable module → no sheet, the band reads "+ Lead" |
| 05 | [T] BandTabs Mine/Unassigned/All with counts; pills Any status / To Do / In Progress / Done; [T] row: stage badge, priority chip, "x of y", progress width 40, due/personal chip, avatars; [T] "Completed this week", "Open a board" rows |
| 06 | [T] type badge + pill per type; meta strings per G4/G5; Accept button; footnote copy |
| 07 | [T] column width = window − 80; header badge 28 + count + plus; "Add task"; dots count = columns; [S] the next column peeks |
| 08 | [T] tabs Details · Checklist · Comments n · Deadline (no Deadline on personal); "x of y" + "%"; done rows struck through `textMuted`; "Add a step" |
| 09 | [T] Target / Over by formatting "8 h 00 m"; bar split proportions; "Explain delay" only when a reason is owed; timeline order Started, Held, Due, Breached |
| 10 | [T] presets Mine/Team/Overdue/Escalated (Overdue count coral); pills All/Open/On hold/Resolved/Closed/Rejected with counts; [T] row anatomy (badge+dot, title, due right, number · customer, status chip, priority flag); [T] the corner dot only when `EscalatedTo` |
| 11 | [T] the action bar has 5 items with Resolve main; variants on hold / terminal; [T] facts order Category, Priority, Assigned to, Due; Activity shows 4 + "All n" |
| 12 | [T] field order Customer, Subject, Description, Category/Priority, Attachments; "Add new customer \"{term}\""; the footer button "Submit complaint"; no bar |
| 13 | [T] Resolution and Remarks required; button "Save · mark resolved"; [S] the sheet sits above the keyboard |
| 14 | [T] "{n} yours"; presets Mine/All/Overdue/New; GH "By next follow-up" + open value (hidden >200); row anatomy; ₹ in en-IN (`₹1,20,000`) |
| 15 | [T] band: name, company · product, est. value, status chip, "Change status"; contact card call/message; tabs Details/Follow-ups n/Activity; the next card is tinted; the action bar has 5 items with Log follow-up main |
| 16 | [T] Save in the band; field order exactly E; pairs; follow-up presets + help sentence; custom fields under "More details" |
| 17 | [T] views Today/Overdue/Upcoming; Done chip per row; the "Done today" group; footnote copy; swipe right → done sheet, left → reschedule |
| 18 | [T] grouping Today / Earlier by local day; unread tint + dot + weight 600; "Mark all read" hidden at 0 |
| 19 | [T] avatar 88; role chip; rows by access in E order; Sign out → Dialog; footer two lines |
| 20a–c | [T] EmptyState copy per preset; skeleton row geometry (40 badge, chip 22); ErrorCard "Could not load. Try again" + "Try again" refetches; the band stays interactive |
| 21 | [T] Dialog copy quotes the comment + workspace; Delete uses `danger`; the comment card is tinted while the dialog is open |
| 22 | [T] left actions Call/On hold/Resolve, right Escalate; widths 72/88; a swipe never mutates (only opens a sheet) |
| 23 | [T] people list from `fetchAssignableUsers`; reason pills from lookups; remarks required error copy; the due-stays line; button "Transfer to {name}" |
| 24 | [T] direction segmented 3 (or 2 per G15); stepper ±1 and quick pills set minutes; notes required; "Then" options on complaints only |
| 25 | [T] every status row with badge; "Current" chip; Lost requires a reason; Won requires a value → `convertLead`; never `setLeadStatus(converted)` |
| 26 | [T] tabs Today · Complaints · More; More shows Inbox + account rows only; the footnote lists the missing modules |
| 27 | [T] tabs Today · Leads · Follow-ups · More; hero "My leads"; two tiles; "+ Lead" |
| T1–T4 | [T] `layoutFor(1194, 834)` → expanded, rail, two-pane, columns 3; [T] rail order; [T] two-pane: a row tap sets the selection, not a push; [T] detail actions are in the band, no ActionBar; [T] form maxWidth 640; [S] the rest |

### 5.2 Screenshot comparison (phone + tablet AVD)

1. **AVDs** (Android emulator, the new architecture as shipped):
   - Phone: any Pixel AVD, then `adb shell wm size 1170x2532 && adb shell wm density 480` → exactly 390 × 844 dp, matching E's phone.
   - Tablet: Pixel Tablet AVD, then `adb shell wm size 2388x1668 && adb shell wm density 320` → 1194 × 834 dp landscape.
   - Reset with `wm size reset; wm density reset`.
2. **E reference images:** a script `mobile/scripts/e-frames.mjs` (Playwright run through `pnpm dlx`, so nothing is added to `package.json`; **proposed**) opens `direction-e-blend.html`, hides the sticky `.spec` header, and screenshots each `figure .ph` / `.tab` at device scale 3 / 2 into `mobile/e2e-shots/e/{frame}.png`.
3. **App images:** Maestro flows under `mobile/.maestro/screens/` navigate on `TestCRM` to each frame's state and `takeScreenshot: e2e-shots/app/{frame}`. Sheets, dialog, swipe and error/empty/loading states use Maestro steps plus (for loading/error) the dev-only `EXPO_PUBLIC_FORCE_STATE` flag (**proposed**; read only in `__DEV__`, so it is stripped from release).
4. **Side by side:** `magick e/{f}.png app/{f}.png +append side/{f}.png` (ImageMagick on the dev Mac).
   - Data differs (TestCRM vs mock), so the comparison is structural: the §5.1 [S] items, order, sizes and colours.
   - Known accepted difference: Android status bar 24 dp vs iOS 54 in E; gesture inset vs E's 30.
5. `mobile/e2e-shots/` is git-ignored (screenshots are review material, not source).

### 5.3 `designRules.test.ts` extensions

New rules. Each gets a planted-violation case, like the existing ones.

| Rule | Pattern (after stripping comments) | Scope | Added in |
|---|---|---|---|
| No edge rails | `border(Left\|Right\|Start\|End)(Width\|Color)\s*:` | all of `src/` except `theme/` | Task 33 |
| No outlines in features | `border(Width\|Color)\s*:` | `features/**` | Task 40 (after Phase 2 removes them) |
| Weight is the family | `fontWeight\s*:` | all | Task 33 |
| Type comes from a variant | `fontSize\s*:\|lineHeight\s*:` | `features/**`, `navigation/**` | Task 40 |
| Depth only through `ui/` | `shadow(Color\|Offset\|Radius\|Opacity)\s*:\|elevation\s*:\|boxShadow\s*:` | `features/**`, `navigation/**` | Task 40 |
| Gradient only on auth | import of `expo-linear-gradient` | everywhere except `features/auth/` | Task 33 |
| Retired components gone | import of `Glyph`, `MenuList`, `Fab`, `ChipGroup`, `Segmented`, `ScreenHeader`, `FloatingTabBar` | all | Task 40 |

Also a new `theme/tokens.test.ts` (Task 33):
- asserts every hex in §1.1–1.5 equals E's value (a literal table copied from E, so drift fails);
- computes the WCAG contrast of every chip and badge pair and fails under 4.5;
- asserts `colors.overlay` is the only value matching `rgba(`.

---

## 6. Work breakdown (Tasks 33–40)

Format and global constraints are those of `docs/superpowers/plans/2026-11-01-mobile-sales-and-complaints.md`:
- Test-first. Touched files reach ≥ 80 % line and branch coverage. The gate per task is `pnpm test` + `pnpm typecheck` + `pnpm lint`, all clean, run from `mobile/`.
- pnpm only.
- Git per CLAUDE.md §0.1: commit only when the user has ordered it for the run; the branch is the user's call (**proposed** `feat/mobile-redesign-e` off `feat/mobile-sales`).
- Mobile only: no SQL, no backend, no web.

**Order:** Task 33 → Tasks 34–37 in parallel → Tasks 38 and 39 (with their fix loop) → Task 40.

### Task 33: Foundation — tokens, type, layout, ui kit, navigation shell (Phase 1)

Why: every Phase 2 task builds on these. Phase 2 tasks may **not** edit any file this task owns. If one needs a change here, it reports back and Task 33's owner makes it.

**Owns:**
- `mobile/src/theme/**`
- `mobile/src/ui/**`
- `mobile/src/navigation/**`
- `mobile/src/stores/useAuthStore.ts`
- `mobile/src/types/api.ts`
- `mobile/src/api/presenceQueries.ts` (only where the heartbeat feeds the store)
- `mobile/src/hooks/**`
- `mobile/src/test/**`
- `mobile/src/features/search/**` (new)
- `mobile/app.config.ts` (orientation)
- `mobile/.gitignore` (`e2e-shots/`)

**Steps**
- [ ] `theme/tokens.test.ts` first: E's hex table (§1.1–1.5), contrast ≥ 4.5 for every chip/badge pair, the single rgba. Watch it fail.
- [ ] Then `tokens.ts`:
  - retuned and new `colors` (§1.2);
  - `palette` ramps;
  - `chipTones` re-keyed with the old-name aliases;
  - `badgeTones`, `moduleTones`, `metrics`, `radius` (+ aliases), `elevation` (+ the `shadows.md` alias);
  - `gradients.auth`, `fontScaleCap`;
  - `CONTROL_HEIGHT` 44, `TAB_BAR_CLEARANCE` 0.
- [ ] `theme/statusBadges.ts` (§1.6): pure maps plus `leadBadge(status, openRank)` (G1), `taskStage(task)` (G8), `notificationBadge(type)` (G26). Tests cover every row of §1.6 and the fallbacks.
- [ ] `typography.ts` (§1.7): new variants, the old names retuned. `Text`: `tabular`, the `scaleCap` default by group. Tests: every variant names a loaded family; `Text` sets `fontVariant` and `maxFontSizeMultiplier`.
- [ ] `ui/useLayout.ts`: tests for `layoutFor` at 390 × 844, 700 × 1000, 1194 × 834, 834 × 1194 (single pane, rule 5), 844 × 390 (capped medium).
- [ ] UI kit per §3, each with a `*.test.tsx`: Band, BandSheet, Screen (navy top), BandTabs, CountPill, SegmentedTabs, FilterPills, SearchField, Button / IconButton / HeaderButton / CircleAction, CountBadge, StatusBadge, Chip (sizes, iconOnly), ListGroup / ListRow / GroupHeader / SwipeRow, HeroCard / StatGrid / FigureBox, ModuleTile, Fields (Input, Select, DateField, MobileInput, FieldLabel, FieldRow), Sheet / SheetHeader / ChoiceList / Radio / Stepper, ComposeSheet / ActionSheet restyle, LogCallSheet (§4 frame 24), Dialog, EmptyState / SkeletonRows / ErrorCard (ScreenLoader on them), Avatar / AvatarStack (preset → tone map), Timeline, FactsGrid / FactsList, Card tones, ProgressBar, Checkbox, InfoNote, Footnote, PageDots, Toast, BoardColumns width rule.
- [ ] Tests assert the load-bearing numbers from §3: badge sizes and radii, row separator insets, pill height, active states by token, the a11y role/state on tabs and radios, and that a swipe only calls `onPress` of the chosen action.
- [ ] Navigation:
  - `tabs.ts` `railTabsFor` + tests;
  - `BottomBar`, `ActionBar`, `Rail`, `Shell` (`ROUTE_OWNER`, `useActionBar`, rail at ≥ medium, `popTo` on press);
  - `CreateSheet` (add grants; single-module shortcut);
  - `RootNavigator` registers `Search` and wraps the stack in `Shell`; `FloatingTabBar` is no longer mounted.
  - Tests per role (all / complaints-only / leads-only / tasks-only): bar items, rail items, badges wired from the shared query keys, owner tab active on pushed routes, ActionBar on detail routes, none on forms.
- [ ] Store: `sessionExpiresAt` from login + heartbeat (G22). Types: `MyDay.me` shift fields (G21), field names verified in backend `services/` (read only). Tests.
- [ ] `features/search/SearchScreen.tsx` (G25) + tests: debounce, a group per module with access only, "See all" params, the 2-character minimum.
- [ ] `designRules.test.ts`: the Task 33 rows of §5.3, each with a planted case.
- [ ] `app.config.ts` `orientation: "default"`; `pnpm exec expo prebuild --clean`; verify `boxShadow` renders on the Android AVD (else the §1.10 fallback).
- [ ] Gate. Coverage ≥ 80 % on every file above.

**E frames this task must match:** 04b, the bottom bar and action bar in every phone frame, the rail in T1–T4, 20a–c (components), 21 (Dialog), 24 (LogCallSheet), plus the §3 visuals as they appear across all frames.

### Task 34: (a) Auth, More / Profile, Inbox (Phase 2)

**Owns:** `features/auth/**`, `features/home/MoreScreen.tsx` (+ test), `features/profile/**`, `features/notifications/**`.

**Steps**
- [ ] LoginScreen 01–03:
  - tests for the copy, the step switch, the inline error for each `authMessages` code, Switch company, the password eye, the version footer;
  - `FloatingShapes` deleted (with its test, if any).
- [ ] MoreScreen 19 + 26:
  - tests for rows by access, the role chip tone (G23), branch name (G24), the session footer (G22), the missing-modules footnote, Sign out → Dialog → `useSignOut`.
- [ ] MeScreen + AccountForms on the band/form pattern; tests keep existing behaviour (edit profile, change password; HR rules unchanged).
- [ ] NotificationsScreen 18:
  - tests for Today/Earlier grouping (IST local day), unread tint/weight/dot, badge mapping (G26), Mark all read hidden at 0, tap → read + navigate.
- [ ] ReauthDialog and PresenceNoticeDialog on the new Dialog.
- [ ] Gate. Coverage ≥ 80 % on touched files.

**E frames this task must match:** 01, 02, 03, 18, 19, 26.

### Task 35: (b) Home, Tasks / My Work, Workspaces, Board, Task detail + Deadline (Phase 2)

**Owns:** `features/home/HomeScreen.tsx` (+ test), `features/tasks/**`, `features/workspaces/**`.

**Steps**
- [ ] HomeScreen 04, 27, T1:
  - hero choice by access;
  - tile set rules;
  - stats/tiles navigate with the params they count (keep the existing guarantees);
  - G3 sum hidden > 200;
  - Needs-you merge (≤ 3) and "See all" target;
  - shift row (G21);
  - "+ New" vs "+ Lead";
  - expanded grid (3 columns, hero span 2, 2fr/1fr row).
  - Tests per role.
- [ ] MyWorkScreen + TaskRow 05:
  - BandTabs counts, stage pills (G8), Done pill and "Completed this week" (G10), personal chip (G9), "Updated" time, the Needs-you group (**flag** decision), band "+ New";
  - the sign-out dialog removed.
- [ ] BoardsScreen 06: rows, G4/G5/G6, Accept + long-press Decline, the client-side search, the footnote.
- [ ] BoardScreen 07: BandTabs ↔ paging sync, column header, Add task, PageDots, Move to… unchanged.
- [ ] TaskDetailScreen 08, 21 + Checklist + TatTab 09:
  - the 4 tabs (Details absorbs Files/History);
  - checklist summary, reorder, "Add a step";
  - comment cards, tint-on-delete + Dialog copy;
  - deadline hero maths (target, over-by G28, bar split);
  - hold card; timeline order;
  - Explain delay gating.
- [ ] TaskForm, WorkspaceForm, WorkspaceSettings, Columns, DependencySheet, TimeSheet on the form / Sheet patterns (§4 "no frame").
- [ ] Gate. Coverage ≥ 80 %.

**E frames this task must match:** 04, 05, 06, 07, 08, 09, 21, 27, T1.

### Task 36: (c) Complaints — list, detail, form, sheets, states (Phase 2)

**Owns:** `features/support/**`, `features/attachments/**`.

**Steps**
- [ ] `ticketHelpers`:
  - presets Mine/Team/Overdue/Escalated (Unassigned removed, **flag**);
  - status "All" = no filter;
  - E's due wording ("Overdue 2 h", "Due 5:30 pm", "Tue, 3 Nov", "Done 1:10 pm");
  - count params (G13).
  - Tests per wording branch.
- [ ] ComplaintsScreen + ComplaintRow 10, 20a–c, 22:
  - preset and pill counts, row anatomy, corner dot;
  - swipe actions open the right sheet and never mutate;
  - the one-time InfoNote;
  - empty copy per preset; skeleton; error + retry.
- [ ] ComplaintDetailScreen → `ComplaintDetailBody` 11, T2:
  - the action bar via `useActionBar` + variants (on hold / terminal / no edit);
  - customer card call; facts; activity mapping + "All n";
  - ⋮ menu (Edit, Close, Reject, Reopen, Files, Delete);
  - tablet band actions.
- [ ] Sheets 13, 23, 24 (LogCallSheet from `ui/` with complaint "Then" options; G15 outcome mapping), escalate:
  - tests for required fields, the payloads copied from the controllers, the chained status change after Log call.
- [ ] ComplaintFormScreen 12: field order, customer dropdown + "Add new customer", attachments block (AttachmentList restyle), fixed footer, "More details".
- [ ] Two-pane T2: selection param, the "Pick a complaint" empty pane, the selected tint.
- [ ] Gate. Coverage ≥ 80 %.

**E frames this task must match:** 10, 11, 12, 13, 20a, 20b, 20c, 22, 23, 24, T2.

### Task 37: (d) Leads, Lead detail / form, Follow-ups (Phase 2)

**Owns:** `features/sales/**`.

**Steps**
- [ ] `leadHelpers`:
  - presets Mine/All/Overdue/New (Unassigned removed, **flag**);
  - `openRank` for G1;
  - follow-up text (G2);
  - the G3 sum;
  - follow-up views Today/Overdue/Upcoming (All removed, **flag**).
  - Tests.
- [ ] LeadsScreen + LeadRow 14: GH + open value, row anatomy incl. lost, status pills removed (**flag**), counts.
- [ ] LeadDetailScreen → `LeadDetailBody` 15, T3:
  - band (name, value, status, Change status);
  - contact card actions (G30); tabs; next card (G18); action bar;
  - ⋮ menu; tablet layout (300 facts column).
- [ ] StatusSheet 25: every status, Lost reason required (G16/G17), Won → `convertLead`, never `setLeadStatus(converted)`.
- [ ] LeadFormScreen 16, T4: band Save, field order, follow-up presets + help, custom fields; the 640 card at ≥ medium.
- [ ] FollowUpsScreen 17: views, Done chip, swipe right/left → sheets, Done-today group (G20), the band calendar pick.
- [ ] Log call on a lead uses `ui/LogCallSheet` with no "Then".
- [ ] Gate. Coverage ≥ 80 %.

**E frames this task must match:** 14, 15, 16, 17, 25, T3, T4.

**(e) Tablet layouts:** folded into Tasks 35–37 (T1 → 35, T2 → 36, T3/T4 → 37). The shared tablet primitives (useLayout, Rail, Shell, two-pane rules, 640 card) are Task 33's. No separate task is needed.

### Task 38: Maestro flows updated and run twice (Phase 3)

**Owns:** `mobile/.maestro/**`.

**Steps**
- [ ] Update selectors for the changed copy and structure:
  - presets (Unassigned gone), "+ New" in the band (Fab gone), action-bar labels, the Create sheet;
  - the More hub (sign-out moved), "Save" in the band, the status sheet;
  - `common/open-work.yaml`, `new-complaint.yaml`, `new-lead.yaml`.
- [ ] Add `screens/*.yaml` that reach each frame state and `takeScreenshot` (feeds Task 39).
- [ ] Run the whole suite twice in a row on the phone AVD against TestCRM. Records created start `MAESTRO `. Fix in a loop (app bugs go back to the owning area's files) until both runs are green.

**E frames this task must match:** all phone frames reachable by flow (01–27).

### Task 39: Emulator screenshots vs E, phone + tablet, with a fix loop (Phase 3)

**Owns:** `mobile/scripts/e-frames.mjs`, `mobile/e2e-shots/` (git-ignored).

**Steps**
- [ ] Generate E references (§5.2 step 2) and app shots on the 390 × 844 phone and the 1194 × 834 tablet AVDs (§5.2 step 1).
- [ ] Build side-by-side images. Walk the §5.1 [S] items frame by frame and log each mismatch with: frame, element, expected token or size, actual.
- [ ] Fix each mismatch in the owning file, with a test where the item is testable. Re-shoot. Loop until the list is empty, or every remaining item is an accepted difference (status-bar height, data) written down in the report.
- [ ] Show the user the side-by-side set before Task 40.

**E frames this task must match:** all 34.

### Task 40: Retire the old kit, tighten the guard, docs (Phase 3)

**Owns:** everything left over (after 34–39 are merged).

**Steps**
- [ ] Delete:
  - `ui/Glyph`, `MenuList`, `Fab`, `ChipGroup`, `Segmented`, `ScreenHeader`;
  - `navigation/FloatingTabBar` (+ tests);
  - the token and typography aliases; retired colours; `shadows`; `TAB_BAR_*`.
- [ ] Add the Task 40 rows of §5.3 (no outlines, no type, no shadow in features; the retired imports) with planted cases. The scan must stay green.
- [ ] Update CLAUDE.md §9.3–9.5 to the new kit list and the E rules: navy band + sheet, the docked bar/rail, no Fab, `badgeTones` / `moduleTones`, `boxShadow` whisper. Docs only, and only with the user's go-ahead.
- [ ] Add a Notion entry (CLAUDE.md §0.5) after the user accepts.
- [ ] Gate. Full suite with coverage.

**E frames this task must match:** all (regression: re-run Task 39's shots once after the deletions).

## 7. User decisions (2026-11-02). These are binding and override any flag above.

1. **Unassigned** stays on Complaints and Leads. It is a fifth preset in the navy band's underline tabs, and the row scrolls sideways.
2. **Lead status pills** stay. They are the pill row under the presets, drawn the way E draws the complaints status pills.
3. **All** stays on Follow-ups, as a fourth pill after Today / Overdue / Upcoming.
4. **Needs you** stays on My Work.
5. **Declining an invite** is a visible "Decline" text button next to Accept, not a long-press.
6. **G11 "Resolved" on the Home hero** means resolved in the last 7 days.
   - The fix is server-side: SQL script `118` adds a `ResolvedFrom`/`ResolvedTo` filter, plus a controller param. The user applies the script by hand to TestCRM first.
   - Until it is applied, the app shows "—", never a wrong number.
7. **G12 "Escalated" on the Home hero** counts my complaints that are escalated (`EscalatedTo` set) and not terminal. The complaints list's **Escalated** preset keeps the server's wider meaning: escalated to me, or overdue in my subtree.
8. **G20 "Done today" on Follow-ups** uses the same server change (`118`), with a completed-date filter on follow-ups. It shows "—" until the script is applied.

All other G-items use the mobile-only workarounds in §4.0. Their server fixes are collected later as a separate backend list, outside this redesign.

9. **Home complaints: mine and team kept apart** (user, 2026-11-03).
   - **The "My complaints" hero counts mine only.** All four figures are mine: Open (assigned to me, active), Overdue (mine and overdue), Escalated (mine, escalated), Resolved (mine, last 7 days).
   - **Team figures sit in a separate "My team" card** directly under the hero. It shows only when the user can see a team, i.e. their complaints reach is wider than Own.
     - Figures: Open · Overdue · Escalated, each opening the Team / Overdue / Escalated presets.
     - Built from the same StatGrid/card pieces as the hero, as a lighter card (surface background, ink figures), so the hero stays the user's own work.
   - The same split applies to the leads hero (Mine vs Team) when leads reach is wider than Own.
   - **The bottom-bar Complaints badge** stays my own overdue count.
