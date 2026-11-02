# Mobile Sales (Phase C) + Complaints hardening — Implementation Plan (TDD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (chosen by the user 2026-11-02) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task is test-first (superpowers:test-driven-development): write the test, run it, watch it FAIL for the right reason, then write the code.

**Goal:** Lead management on the mobile app (list, detail, follow-ups, calls, status, transfer, create/edit) plus a hardened Complaints module, both built test-first with a Jest + React Native Testing Library suite, then proven end to end with Maestro on the Android emulator.

**Architecture:** Mobile only — zero backend, SQL or web changes. Sales mirrors the Complaints feature shape (`mobile/src/features/support/`) in `mobile/src/features/sales/`: one fetcher file per domain in `src/api/`, a ref-data hook, list → detail → form screens on the root stack, actions through `ActionSheet` / `ComposeSheet` / `Dialog`. Unit/screen tests live beside the code as `*.test.ts(x)`; Maestro flows in `mobile/.maestro/`.

**Tech Stack:** Expo SDK 57 (RN 0.86.3, React 19.2), TypeScript strict, TanStack Query, React Navigation stack, lucide-react-native, @gorhom/bottom-sheet, Jest via `jest-expo`, `@testing-library/react-native`, Maestro 2.12.

**Spec:** No separate spec document. Authority, in order: the user's instructions (2026-11-01/02: sales + complaints on mobile asap; subagent-driven; proper TDD on mobile; Maestro on the emulator, fix in a loop until every flow passes), CLAUDE.md (§0, §3, §6 Sales/Support, §9), and the live contracts in this plan (backend controllers + `TestCRM` SPs read 2026-11-01).

**Reference code (not the implementation):** an untested first draft of Tasks 20–26 is parked in `docs/superpowers/plans/2026-11-01-mobile-sales-reference/` (`leadQueries.ts`, `followupQueries.ts`, `sales/*.tsx|ts`, `tracked-changes.patch` for `types/api.ts`, `configQueries.ts`, `RootNavigator.tsx`, `WorkHubScreen.tsx`). An implementer MAY read it for layout/wording, but must write the failing test first and must not copy a file wholesale before its tests exist and fail. The reference is deleted in Task 31.

## Global Constraints

- **Test-first, every task.** New behaviour → happy path + ≥1 failure/edge. Files created or modified reach **≥80% line and branch coverage** (`pnpm test --coverage --collectCoverageFrom=<files>`). Never `.only`, `.skip`, `xit`, or excluded paths.
- **Gate per task:** `pnpm test` green, `pnpm typecheck` clean, `pnpm lint` clean (0 errors), run from `mobile/`.
- **pnpm only.** Native-aware deps via `pnpm exec expo install <pkg>`; never `npm`.
- **Commits:** on branch `feat/mobile-sales` only, one or more per task, Conventional Commit messages; never push, never touch `main`.
- No screen calls `apiClient`; every request is a named fetcher in `src/api/` (CLAUDE.md §9.2). Payloads copied from `backend/src/controllers/leadController.js`, `followupController.js`, `callController.js`.
- Tokens only (no literal colours/sizes), solid colours only, lucide icons only, `Card` is the only raised surface, no RN `Alert`, menus built as literals with conditional spreads, never `.push()` (CLAUDE.md §9.3–9.5). No `setState` inside `useEffect` (the lint rule `react-hooks/set-state-in-effect` is an error) — derive state, or key a child component to seed it.
- Status logic keys on lookup `Code`, never a label. Lead codes: `open`, `qualified` (active) · `converted`, `lost`, `junk` (closed).
- `converted` is written only via `POST /api/leads/convertLead`; `setLeadStatus` is never called with it. `lost` needs `LostReasonId`.
- Lead edit (`saveLeads`, `Id > 0`) resends every base field, does **not** send `PartnerId`, `CommType`, `CommValue`, `StatusId`, `OwnerId`, `FirstFollowupAt`, and sends `CustomJSON: null`.
- Mobile number = ten digits; the server 400s anything else — show its message in the form.
- Dates sent as local `YYYY-MM-DD` built from local Y/M/D getters; never `toISOString()`.
- Web-only, not on mobile: partners/commission, quotations, lead delete, bulk transfer, reports.
- Never type a password anywhere (tests, flows, scripts). Test data on `TestCRM` only; Maestro-created records start `MAESTRO `.

## Contracts (live, TestCRM)

| Endpoint | Body | Reply `data` |
|---|---|---|
| `/api/leads/fetchLeads` | `PageNumber, PageSize, SearchTerm, StatusId, StatusCode, OwnerId, Overdue, Unassigned` | `{ leads: Lead[], pagination }` |
| `/api/leads/fetchLeadDetail` | `LeadId` | `{ lead, fields, activity, followups, assignments, commissions }`; 404 when not visible |
| `/api/leads/saveLeads` | `Id`, `Name`, `Company`, `MobileNo`, `AltMobile`, `Email`, `Address`, `City`, `State`, `Pincode`, `SourceId`, `ProductId`, `EstValue`, `Remarks`; create-only `StatusId`, `OwnerId`, `FirstFollowupAt`; `CustomJSON` | status row `{ Id }` |
| `/api/leads/setLeadStatus` | `LeadId, StatusId, LostReasonId` | status row |
| `/api/leads/convertLead` | `LeadId, WonValue, Remarks` | status row |
| `/api/leads/transferLead` | `LeadId, ToUserId, ToBranchId, ReasonId, Remarks` (reason + remarks required) | status row |
| `/api/followups/fetchFollowups` | queue: `LeadId: 0, Status, DueFrom, DueTo, Overdue, SearchTerm, PageSize` | `{ followups, pagination }` |
| `/api/followups/scheduleFollowUp` | `LeadId, Type, DueAt, AssignedTo` | `{ Id }` |
| `/api/followups/completeFollowUp` | `Id, OutcomeId, Remarks (required), Direction, Duration, NextType, NextDueAt` | `{ Id, NextId }` |
| `/api/followups/skipFollowUp` | `Id, Remarks (required)` | `{ Id }` |
| `/api/calls/logCall`, `fetchCalls` | already in `src/api/callQueries.ts` (`LeadId`) | — |

`Lead` row (sp_FetchLeads; detail RS1): `Id, BranchId, BranchName, Name, Company, MobileNo, AltMobile, Email, Address, City, State, Pincode, SourceId, SourceName, PartnerId, PartnerName, ProductId, ProductName, StatusId, StatusName, StatusCode, OwnerId, OwnerName, OwnerAvatar, EstValue, Remarks, NextFollowupDate, IsOverdue, LostReasonId, WonAt, WonValue, CustomerId, LostAt, AssignedAt, CreatedBy, CreatedAt, UpdatedAt`; detail adds `LostReason, CustomerName`.
`FollowUp` row: `Id, LeadId, Type ('call'|'visit'|'meeting'|'other'), DueAt, Status ('open'|'done'|'skipped'), AssignedTo, AssignedToName, DoneAt, DoneBy, DoneByName, OutcomeId, Outcome, Remarks, Direction, Duration, IsOverdue, CreatedBy, CreatedAt`; queue rows add `LeadName, LeadCompany, LeadMobile, OwnerName, LeadStatus, LeadStatusCode`.
Activity row: `Id, LeadId, UserId, UserName, Type, Summary, CreatedAt`. Assignment row = `TicketAssignment` shape.

## Review Focus

1. Editing a lead that has a partner or custom fields → both survive (Task 25 payload test + Maestro `leads-edit`).
2. Picking Won or Lost → never posts `setLeadStatus` with `converted`; Lost cannot submit without a reason (Task 24 tests + Maestro `leads-status`).
3. A lead the user cannot see (404) → "Lead not available" with a back button, never an endless spinner (Task 24 test).
4. Empty lookups (no `lost_reason` / `call_outcome` configured) → the sheet says so rather than offering an unsubmittable form (Task 24 test).
5. A server refusal (`success:false`, 400 on a bad mobile, 403 on transfer) → the server's own sentence is shown, typed input is kept (Task 25 + Task 24 tests).

---

### Task 0: Mobile test harness

**Files:** Modify `mobile/package.json` (devDeps + `"test": "jest"`), create `mobile/jest.config.js`, `mobile/jest.setup.ts`, `mobile/src/test/renderWithProviders.tsx`, `mobile/src/features/support/ticketHelpers.test.ts`, `mobile/src/features/support/ComplaintsScreen.test.tsx`. Modify `CLAUDE.md` §0.4 and §9.7.

**Produces:**
- `pnpm test` (jest, preset `jest-expo`), with `@testing-library/react-native` and its jest matchers.
- `renderWithProviders(ui: ReactElement, opts?: { queryClient?: QueryClient }): RenderResult & { queryClient: QueryClient }` — wraps in a fresh `QueryClient` (`retry: false`, `gcTime: 0`), `SafeAreaProvider` with initial metrics, `BottomSheetModalProvider`, the app's toast provider, and `NavigationContainer`.
- `makeNavigation()` helper returning jest-fn `navigate`, `goBack`, `replace`, `push` typed as the stack navigation prop, plus `makeRoute(name, params)`.
- jest.setup mocks: `react-native-reanimated` (official mock), `@gorhom/bottom-sheet` (its `mock` entry), `react-native-gesture-handler/jestSetup`, `expo-font`/icon loading if needed, `@react-native-async-storage/async-storage` mock.

- [ ] Install: `pnpm exec expo install jest-expo jest @types/jest @testing-library/react-native` (plus `react-test-renderer` only if RNTL requires it at this React version).
- [ ] Write `ticketHelpers.test.ts` first — real assertions on existing helpers: `asStatusCode(null) === "open"`, `isActive("onhold") === true`, `isTerminal("closed") === true`, `dueLabel({DueAt: <2h ahead>, IsOverdue: false, StatusCode: "open"}).label` starts with `"Due in"`, `dueLabel({… IsOverdue: true})?.overdue === true`, `dueLabel` returns null for a terminal ticket, `serialiseCustomFields([], {}) === null`, `missingRequired` flags an empty required text field and an unticked required checkbox. Run → fails (no runner). Add config → passes.
- [ ] Write `ComplaintsScreen.test.tsx` with `jest.mock("../../api/ticketQueries")` and `jest.mock("../../api/configQueries")`/`userQueries`: renders a ticket's Subject from a mocked `fetchTickets`; tapping "Team" re-calls `fetchTickets` with `AssignedTo: null`; a rejected `fetchTickets` shows "Couldn't load complaints"; tapping the FAB (`accessibilityLabel "Log a complaint"`) calls `navigation.navigate("ComplaintForm", {})`.
- [ ] CLAUDE.md: §0.4 — mobile is no longer exempt: mobile follows the same test-first rule (≥80% on touched files) with `pnpm test`, in addition to typecheck + lint. §9.7 — replace "No test suite on mobile" with the jest-expo + RNTL setup and `renderWithProviders`; §2 mobile commands gain `pnpm test`.
- [ ] Gate: `pnpm test`, `pnpm typecheck`, `pnpm lint` clean. Commit.


## Phase A — tests for every existing mobile screen (user order 2026-11-02)

Characterization tests for code that already exists. TDD discipline for these: each test must be shown able to fail — after it passes, temporarily break the behaviour it asserts (or invert the assertion), watch it fail for the right reason, restore; record that RED evidence per test file in the report. A test exposing a real bug → keep the failing test, fix the code, flag it in the report as "regression found". Coverage ≥80% lines + branches on every file the task lists. Mock API modules, never the code under test.

### Task 1: API layer tests

**Files:** tests for every module in `mobile/src/api/` (`client.ts`, `errors.ts`, `queryClient.ts`, `authQueries`, `centralQueries`, `taskQueries`, `workspaceQueries`, `kanbanQueries`, `tatQueries`, `ticketQueries`, `callQueries`, `customerQueries`, `configQueries`, `productQueries`, `userQueries`, `notificationQueries`, `attachmentQueries`, `presenceQueries`).

- [ ] Per fetcher: posts to its endpoint constant with the documented defaults (nulls, `0/1` bits, page defaults), unwraps the documented `data` key, and maps absent arrays to `[]`. `client.ts`: token header from `setAuthToken`, base URL from `setApiBaseUrl`, the 401 path calls the registered unauthorized handler and auth-endpoint 401s do not. `errors.ts`: `apiErrorMessage` prefers the server `message`, falls back to the given text, handles network errors.
- [ ] Gate. Commit.

### Task 2: Auth, session and store tests

**Files:** tests for `stores/useAuthStore.ts`, `features/auth/LoginScreen.tsx`, `PresenceNoticeDialog.tsx`, `useSignOut.ts`, `utils/menuAccess.ts`.

- [ ] Login two steps: company code → `fetchClientConfig` → stored config; unknown code shows the error in the form; credentials step posts `loginUser`; server message (e.g. "Incorrect username or password") renders in the form, not only a toast; "Switch company" clears config and session. Session 401 codes (`SESSION_ENDED`, `SESSION_EXPIRED`, `SESSION_FORCED`, `SESSION_REQUIRED`) log the user out with the right wording; presence notice shows once and `ackNotice` is called. `menuAccess` visibility rules.
- [ ] Gate. Commit.

### Task 3: Tasks feature tests

**Files:** tests for `features/tasks/*` (`MyWorkScreen`, `TaskDetailScreen`, `TaskFormScreen`, `TaskCard`, `Checklist`, `DependencySheet`, `TimeSheet`, `TatTab`, `ActivityTab`, `taskHelpers`, `tatChip`, `greeting`).

- [ ] Helpers: due buckets/labels across midnight, assignee parsing, abilities per workspace role (owner/manager/member/viewer, personal vs shared, `IsAdmin` bypass never on personal). Screens: My Work groups by due; detail shows checklist-derived completion; checklist toggle/add/delete call their fetchers; dependency block shown; time entry add; TAT tab actions (hold/release/acknowledge/my part done/reason) call `tatQueries`; form create vs edit payloads; errors show server text.
- [ ] Gate. Commit.

### Task 4: Workspaces / boards tests

**Files:** tests for `features/workspaces/*` (`BoardsScreen`, `BoardScreen`, `ColumnsScreen`, `WorkspaceFormScreen`, `WorkspaceSettingsScreen`, `WorkspaceCard`) and `ui/BoardColumns`.

- [ ] Boards list (pending invite accept/decline, archived hidden), board columns render + long-press "Move to…" calls `moveTaskColumn`, column add/rename/reorder/delete, workspace create/edit payloads, settings members (invite, role change, remove) gated by role.
- [ ] Gate. Commit.

### Task 5: Complaints tests

**Files:** Create tests for `mobile/src/api/ticketQueries.ts`, `mobile/src/api/callQueries.ts`, `features/support/ComplaintDetailScreen.tsx`, `features/support/ComplaintFormScreen.tsx`; fix any defect a test exposes.

- [ ] `ticketQueries.test.ts`: mock `./client` `post`; `fetchTickets({Overdue:true})` posts `Overdue: 1, Escalated: 0, Unassigned: 0`; `fetchTicketDetail` maps missing arrays to `[]` and `linkedLead` to null; `setTicketStatus`/`transferTicket`/`escalateTicket` post to their endpoint constants with the given body.
- [ ] `callQueries.test.ts`: `logCall({LeadId:5, Direction:"out"})` posts nulls for every unset key; `fetchCalls({TicketId:3})` reads the `calls` key.
- [ ] `ComplaintDetailScreen.test.tsx`: 404 rejection → "Complaint not available"; open ticket → status chips + facts render; picking an active status from the status sheet calls `setTicketStatus` straight away; picking Resolved opens the compose sheet and its submit sends `ResolutionId` + `Remarks`; a rejected mutation shows the server message via toast; Delete → Dialog → `deleteTicket({Id})` then `goBack`.
- [ ] `ComplaintFormScreen.test.tsx`: submit with no customer shows "Pick the customer, or add a new one."; a valid create posts `saveTicket` with `Id: 0` and the picked ids; `success:false` shows the server message and stays on screen.
- [ ] Any test that fails because the code is wrong (not the test): fix the code, note it in the report as a regression found. Gate. Commit.

### Task 6: Notifications, profile, hub, attachments, navigation tests

**Files:** tests for `features/notifications/NotificationsScreen`, `features/profile/MeScreen`, `features/hub/WorkHubScreen` (+ `ComingSoonScreen` while it exists), `features/attachments/*` (`AttachmentList`, `FileViewer`, `attachmentHelpers`, `useDownloadAttachment`), `navigation/FloatingTabBar`, `navigation/RootNavigator` (authenticated vs login tree).

- [ ] Inbox list/mark read/mark all; profile update + change password validation + sign out; hub rows filtered by menu rights with counts; attachment upload appends `Entity` before the file part, size/type guards, delete, view; tab bar navigation.
- [ ] Gate. Commit.

### Task 7: UI kit tests

**Files:** tests for `mobile/src/ui/*` components with behaviour (`Select`, `ComposeSheet`, `ActionSheet`, `Dialog`, `DateField`, `Input`, `Button`, `Chip`, `ChipGroup`, `Segmented`, `Checkbox`, `DynamicField`, `Toast`, `ScreenHeader`, `ScreenLoader`, `EmptyState`, `Fab`, `Card`, `Timeline`, `Avatar`/`avatarPresets`).

- [ ] Behaviour only (no snapshot tests): Select single/multi picks, ComposeSheet required fields/choices gate submit and keeps typed text on failure, Dialog confirm/cancel/loading, DateField formats local Y-M-D (never UTC shift — test with a date near midnight), Button disabled/loading blocks press, Segmented counts, DynamicField per type, Toast shows/dismisses, Avatar preset parsing.
- [ ] Gate. Commit.

## Phase B — catch up with the web (from the parity audit)

### Tasks 8–19: parity fixes

Filled from `.superpowers/sdd/2026-11-01-mobile-sales-and-complaints/parity-audit.md` once it lands: one task per coherent batch of gaps (same screen/domain), each test-first (failing test that shows the gap → fix → green).

## Phase C — Sales on mobile

### Task 20: Lead types and fetchers

**Files:** Modify `mobile/src/types/api.ts`, `mobile/src/api/configQueries.ts` (add `LOOKUP_KIND.leadStatus = "lead_status"`); create `mobile/src/api/leadQueries.ts`, `mobile/src/api/followupQueries.ts` and their tests.

**Produces:**
- Types: `LeadStatusCode`, `Lead`, `LeadActivityEntry`, `LeadAssignment = TicketAssignment`, `FollowUpType`, `FollowUpStatus`, `FollowUp`, `LeadDetail { lead: Lead | null; fields: CustomFieldValue[]; activity: LeadActivityEntry[]; followups: FollowUp[]; assignments: LeadAssignment[] }`.
- `LEAD_ENDPOINTS`; `fetchLeads(p?: FetchLeadsParams): Promise<ApiEnvelope<{ leads: Lead[]; pagination: Pagination }>>` (defaults PageNumber 1, PageSize 50, nulls, `Overdue`/`Unassigned` false); `fetchLeadDetail({ LeadId }): Promise<LeadDetail>`; `type LeadBaseFields`; `createLead(LeadBaseFields & { StatusId, OwnerId, FirstFollowupAt, CustomJSON })` → posts `Id: 0`; `updateLead(LeadBaseFields & { Id })` → posts `CustomJSON: null`; `setLeadStatus({ LeadId, StatusId, LostReasonId? })`; `convertLead({ LeadId, WonValue, Remarks? })`; `transferLead({ LeadId, ToUserId, ToBranchId, ReasonId, Remarks })`.
- `FOLLOWUP_ENDPOINTS`; `fetchFollowUps(p?)` posts `LeadId: 0` + defaults (PageSize 50); `scheduleFollowUp({ LeadId, Type, DueAt, AssignedTo? })`; `completeFollowUp({ Id, Remarks, OutcomeId?, Direction?, Duration?, NextType?, NextDueAt? })` nulls unset; `skipFollowUp({ Id, Remarks })`.

- [ ] Tests first (mock `./client`): `updateLead` body has `CustomJSON: null` and **no** `PartnerId`/`CommType`/`CommValue`/`StatusId`/`OwnerId`/`FirstFollowupAt` keys (`expect(body).not.toHaveProperty(...)`); `createLead` body has `Id: 0`; `fetchLeadDetail` defaults missing arrays to `[]`, missing lead to null; `setLeadStatus` sends `LostReasonId: null` when omitted; `fetchFollowUps({Overdue:true})` sends `LeadId: 0, Overdue: true, PageSize: 50`; `completeFollowUp({Id:1, Remarks:"x"})` sends nulls for the five optionals. Run → fail. Implement → pass. Gate. Commit.

### Task 21: Sales helpers and reference data

**Files:** Create `features/sales/leadHelpers.ts`, `features/sales/useLeadRefData.ts` + tests.

**Produces:** `isActiveLead(code)`; `leadTone(code): ChipTone` (open→primary, qualified→info, converted→success, lost→danger, junk→neutral, null→primary); `defaultStatus(statuses: Lookup[]): number | null` (first `open`, else first, else null); `LEAD_QUEUES` (Mine/All/Overdue/Unassigned) and `leadQueueParams(queue, status: "all" | number, userId, term): FetchLeadsParams` (PageSize 100; mine → `OwnerId: userId`; overdue → `Overdue: true`; unassigned → `Unassigned: true`; status number → `StatusId`; empty term → `SearchTerm: null`); `FOLLOWUP_VIEWS` (Today/Overdue/Upcoming/All) and `followUpViewParams(view, now)` (today → `Status:"open", DueFrom=DueTo=today`; overdue → `Overdue:true`; upcoming → `Status:"open", DueFrom=tomorrow`; all → `{}`); `FOLLOWUP_TYPES` + `followUpTypeLabel(type)` ("Follow-up" fallback); `WHEN_CHOICES` (`today`, `tomorrow`, `3days`, `week` → Today / Tomorrow / In 3 days / Next week) + `dueFromChoice(choice, now)`; `nextOpen(followups)`; `localDay(d)`; `dayLabel(iso, now)` (Today / Tomorrow / Yesterday / `12 Nov` / `12 Nov 2025` for another year; null for null/invalid); `rupees(n)` (`₹1,50,000`, null for null). `useLeadRefData(): { statuses, sources, lostReasons, transferReasons, callOutcomes, users, products }` via `useQueries` with keys `["lookups", kind]`, `["users","assignable","leads"]` (`fetchAssignableUsers({ Module: "leads" })`), `["products"]`.

- [ ] Tests first with a fixed `now = new Date(2026, 10, 2, 23, 30)` (local): `dueFromChoice("week", now) === "2026-11-09"`; `localDay(new Date(2026,0,5)) === "2026-01-05"`; `dueFromChoice("tomorrow", new Date(2026, 11, 31)) === "2027-01-01"`; `dayLabel` four cases + null; `rupees(150000) === "₹1,50,000"`; `leadQueueParams("mine", 7, 42, "")` → `{ OwnerId: 42, StatusId: 7, SearchTerm: null, Overdue: false, Unassigned: false, PageSize: 100 }`; `followUpViewParams` all four; `defaultStatus` three cases; `useLeadRefData` with mocked fetchers returns each list under its name (renderHook). Run → fail. Implement → pass. Gate. Commit.

### Task 22: Leads list

**Files:** Create `features/sales/LeadCard.tsx`, `features/sales/LeadsScreen.tsx` + tests. Add stack params (types only — screens are registered in Task 26) `Leads: undefined; LeadDetail: { leadId: number }; LeadForm: { leadId?: number }; FollowUps: undefined;` to `RootStackParamList` .

- [ ] Tests first: card shows Name, `"<mobile> · <company>"`, status chip, `"Overdue · <day>"` when `IsOverdue`, "Unassigned" when no owner, `₹` value; no next-date chip on a converted lead. Screen: default queue Mine calls `fetchLeads` with `OwnerId` = the store's `UserId`; tapping "Overdue" re-fetches with `Overdue: true`; status chip narrows by `StatusId`; typing a search term passes `SearchTerm`; rejected fetch → "Couldn't load leads"; empty Mine → "No leads yet"; tapping a card → `navigate("LeadDetail", { leadId })`; FAB "Add a lead" → `navigate("LeadForm", {})`. Header "Leads", subtitle `"<total> yours"` on Mine.
- [ ] Implement in the shape of `ComplaintsScreen` (tint `success`, Segmented, ChipGroup "All" + statuses, search placeholder "Name, company or mobile", FlatList + Refresher + EmptyState + Fab). Gate. Commit.

### Task 23: Follow-ups queue

**Files:** Create `features/sales/FollowUpsScreen.tsx` + test.

- [ ] Tests first: default view Today calls `fetchFollowUps` with today's `DueFrom/DueTo` and `PageSize: 100`; "Overdue" → `Overdue: true`; a row shows LeadName, `"<Type> · <day>"`, danger tone when overdue, "Done"/"Skipped" chip for closed rows; tapping a row → `navigate("LeadDetail", { leadId: row.LeadId })`; empty Today → "Nothing due today"; error → "Couldn't load follow-ups".
- [ ] Implement (header "Follow-ups", tint `success`, Segmented + search "Lead name, company or mobile"). Gate. Commit.

### Task 24: Lead detail

**Files:** Create `features/sales/LeadDetailScreen.tsx` (+ small presentational children in `features/sales/` if the file passes ~500 lines) + tests.

- [ ] Tests first (mock `leadQueries`, `followupQueries`, `callQueries`, `userQueries`, `configQueries`, `productQueries`; `Linking.openURL` spied):
  - 404 rejection → "Lead not available" + back works; other rejection → retry loader.
  - Details: Name in header, `"<Company> · <StatusName>"` subtitle, facts (Mobile, Email, Company, Product, Est. value as rupees, Source, Owner, Office); won banner `"Won for ₹…"` only when `StatusCode === "converted"`; lost reason fact when present.
  - "Call" quick button → `Linking.openURL("tel:<MobileNo>")`; hidden without a mobile.
  - Status sheet: picking a plain status calls `setLeadStatus({ LeadId, StatusId })`; picking `lost` opens "Mark as …" whose submit is disabled until a reason chip is picked, then sends `LostReasonId`; with no lost reasons configured it shows "No lost reasons are set up. Add them on the web first."; picking `converted` never calls `setLeadStatus` and the won sheet sends `convertLead({ LeadId, WonValue: 50000, Remarks: null })` for "50,000".
  - Schedule sheet (Type + When required) → `scheduleFollowUp({ LeadId, Type: "call", DueAt: <tomorrow local> })`.
  - Follow-ups tab: open row shows Log + Skip; Log sheet requires Remarks; for a `call` it sends `Direction` (default "out") and `Duration`; choosing Next "In 3 days" sends `NextType: "call"`, `NextDueAt`; Skip requires Remarks → `skipFollowUp`.
  - Log a call sheet → `logCall({ LeadId, Direction, OutcomeId, Notes, Duration })`.
  - Transfer: pick list excludes the current owner; compose requires reason + remarks; `ToBranchId` is null when the user's branch equals the lead's, the user's branch otherwise.
  - A rejected write shows the server sentence inside the open sheet (or a toast for a direct status pick) and does not dismiss.
  - "Edit lead" menu → `navigate("LeadForm", { leadId })`.
  - History tab merges activity (minus `Type === "call"`), calls and assignments newest first.
- [ ] Implement in the shape of `ComplaintDetailScreen` (tint `success`, tabs Details · Follow-ups (open count) · Files (`AttachmentList entity="lead"`) · History). Mutations through one named hook defined outside the component (no hooks inside callbacks). Gate. Commit.

### Task 25: Lead form

**Files:** Create `features/sales/LeadFormScreen.tsx` + test.

- [ ] Tests first:
  - Create: Name and Mobile required (client message "The lead needs a name." / "A mobile number is required."); Status defaults to the first `open` status (Won not offered); Owner defaults to the signed-in user when assignable, else none; First follow-up defaults to Tomorrow → `FirstFollowupAt` = tomorrow local, "None" → null; custom field defs render and a missing required one blocks submit with `"<Label> is required."`; success → `replace("LeadDetail", { leadId: <returned Id> })`.
  - Edit: seeds every field from `fetchLeadDetail`; hides Status/Owner/First follow-up/custom fields; submit calls `updateLead` (never `createLead`) with the full base record; success → `goBack()`.
  - `success:false` or a 400 (e.g. "Mobile number must be 10 digits") shows the server's message and keeps typed values.
  - Estimated value "abc" → "Estimated value must be a number."
- [ ] Implement: a loader shell that renders the form child keyed by record id (no `setState` in effects). Gate. Commit.

### Task 26: Wiring

**Files:** Modify `navigation/RootNavigator.tsx`, `features/hub/WorkHubScreen.tsx` (+ test); delete `features/hub/ComingSoonScreen.tsx` (and its route) once nothing references it; delete `features/_sales/`, `features/_support/`.

- [ ] Tests first (`WorkHubScreen.test.tsx`): with menu rights for `/support` and `/sales`, the hub shows Complaints, Leads, Follow-ups and no "Coming soon"; Leads detail shows `"<n> yours"` from `fetchLeads({ OwnerId: me, PageSize: 1 })`; Follow-ups detail `"<n> due today"` from the Today params with `PageSize: 1`; tapping Leads → `navigate("Leads")`; without `/sales` rights the Sales section is absent.
- [ ] Register `Leads`, `LeadDetail`, `LeadForm`, `FollowUps`. Gate. Commit.

### Task 30: Maestro end to end + fix loop

**Pre-req (user):** emulator booted, Debug build installed, Metro running with `adb reverse tcp:8081 tcp:8081`, app signed in to company `TestCRM` by the user. The controller arranges this before dispatch.

**Files:** `mobile/.maestro/config.yaml`, `common/open-work.yaml`, `company-code.yaml` (exists) and flows: `smoke-hub`, `complaints-list`, `complaints-create`, `complaints-lifecycle` (log call, On hold → Open → Resolved with resolution + remarks, history shows entries), `complaints-transfer-escalate`, `leads-list`, `leads-create` (mobile `+91 98250 12345` → detail shows `9825012345`), `leads-followup` (schedule Tomorrow, log with next In 3 days, skip), `leads-status` (Qualified; Lost blocked without reason; Won 50000 → banner), `leads-edit` (company change persists), `leads-call-transfer`, `followups-queue`.

- [ ] Write each flow against the real screen text; run `maestro test --test-output-dir <scratch> .maestro/<flow>.yaml`; on failure read screenshot + Metro log, fix the app code **with a unit/screen test that reproduces the bug first**, re-run. Also inspect every screenshot for clipped text, overlapping chips, keyboard covering a submit button; each such fix also gets a test where a test can express it.
- [ ] Done when the whole suite passes twice in a row. Report the `MAESTRO %` records created. Commit flows + fixes.

### Task 31: Docs and cleanup

- [ ] CLAUDE.md §9: Phase C status (what is on mobile, what stays web), `mobile/.maestro/` usage. Delete `docs/superpowers/plans/2026-11-01-mobile-sales-reference/`. Commit.
- [ ] Notion entry after the user accepts the branch (controller).
