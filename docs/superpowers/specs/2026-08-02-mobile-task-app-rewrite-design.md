# Mobile app rewrite — task management

**Date:** 2026-08-02
**Status:** Approved, not started
**Branch:** `feat/mobile-rewrite` (off `main`)

---

## 1. Why

`mobile/` has not been touched since before the backend/web rewrite. The last
commit that changed it was `09a551f` (2026-07-03), and even that was a docs
cleanup — the real code predates it. **31 backend/web commits** have landed
since.

The app does not work. Not "works badly" — does not work at all.

### 1.1 Evidence

**It points at a dead host.** `mobile/src/services/api.js:4`:

```js
const BASE_URL = 'https://prdinfotech.in/CRM';
```

The live API is `https://shadowcodes.in/CRM`. Every request fails.

**The domain model changed underneath it.** The task rewrite made *workspaces*
the container for everything. Mobile has no concept of a workspace.

| Mobile sends today | Backend requires now |
|---|---|
| `saveKanbanColumn { ProjectId }` | **`WorkspaceId` required** → hard 400 (`kanbanController.save`) |
| `fetchTasks { ProjectId, TeamId }` | `WorkspaceId`; membership-governed, not project-governed |
| `saveTask { Status, Progress, IsBlocked, Watchers, AssignedToUserId }` | `WorkspaceId`, `ColumnId`, `AssigneeIdsJson`; completion derived from checklist; `IsDone` retired |
| — | members, invites, roles (`owner`/`manager`/`member`/`viewer`) |

**Two endpoints it calls no longer exist:** `/api/dashboard/stats` (now
`/api/reports/getDashboard`) and `/api/projects/deleteProject`.

**No tests, no test runner, no `eas.json`** — a release build cannot be
produced today even if the app worked.

### 1.2 What is *not* wrong

The tooling. Expo 55, RN 0.83.4, React 19.2, Zustand 5, TanStack Query 5 — all
modern. Two SDK majors behind latest (57.0.9), not five.

The backend. It is complete and proven by the web client. **This rewrite
requires zero SQL changes and zero backend changes.** See §5.1.

---

## 2. Scope

### 2.1 This spec — Phase A: task management

Full parity with the web Task module. Workspaces, boards, tasks, checklists,
comments, attachments, time entries, activity, dependencies, members, invites,
roles, columns.

### 2.2 Explicitly later, but designed for now

- **Phase B — Support/complaints.** Field staff logging complaints quickly from
  a phone. Highest-value follow-on.
- **Phase C — Sales leads.** Leads, calls, follow-ups, pipeline.

Phase A must not make B and C expensive. The folder layout (§4.1) is chosen
so each is a new feature folder and a new tab, not a restructure.

### 2.3 Out of scope, permanently

Admin CRUD on a phone: Users, Teams, Projects, Groups, Settings, Master data,
Reports. These are desk work; they stay on web. The existing
`UsersScreen`/`TeamsScreen`/`ProjectsScreen` are deleted, not ported.

---

## 3. Screens

Three tabs: **My Work** (default) · **Boards** · **Me**.

```
MY WORK                 [search]

  OVERDUE  (2)
  +---------------------------+
  | Fix login crash           |
  | Nexus App . 2/5 done      |
  | (!) Due yesterday         |
  +---------------------------+

  TODAY  (3)
  +---------------------------+
  | Build APK for client      |
  | Nexus App . 0/3 done      |
  +---------------------------+

 [My Work]   Boards      Me
```

**My Work** is the landing screen. Tasks assigned to me across every
workspace, grouped `Overdue` / `Today` / `This week` / `Later` / `No due date`.
The web has no equivalent screen — this is the one thing mobile adds, and it is
the reason a phone app is worth building at all.

**Boards** — workspace picker → that board's columns, swiped sideways. Column
moves happen through a menu, not drag: a 4-column kanban does not survive a
360px screen, and `moveTaskColumn` is a single call either way.

**Me** — profile, change password, workspace invites awaiting response, logout.

**Task detail** (pushed from either tab) — the full web `TaskDetailModal`
surface: fields, checklist, comments, attachments, time entries, activity,
dependencies, assignees.

---

## 4. Architecture

### 4.1 Folder layout

```
mobile/src/
  api/            taskQueries.js, workspaceQueries.js, attachmentQueries.js,
                  authQueries.js, notificationQueries.js, userQueries.js
                  axios.js  (interceptors, token, 401)
  features/
    tasks/        screens/ components/ hooks/
    workspaces/   screens/ components/ hooks/
    _support/     (empty — Phase B)
    _sales/       (empty — Phase C)
  components/     design system (reused, see §4.4)
  navigation/
  stores/         useAuthStore.js, useWorkspaceStore.js
  theme/
  utils/          taskAssignees.js (ported), dates.js
```

Feature folders, not type folders. Phase B adds `features/support/` and one
tab; nothing else moves.

### 4.2 The API layer is the deliverable that matters most

**Finding:** the web has *no* task/workspace API layer. Its 42 task/workspace
endpoints are inlined across 10 files (`useTaskData.jsx`, `TaskBoard.jsx`,
`TaskDetailModal.jsx`, `useWorkspaceStore.js`, the four `Workspace/*Modal`
components, …). Only `attachmentQueries`, `salesQueries` and `supportQueries`
exist as proper fetchers.

So mobile cannot "port the web API layer" — there isn't one. It gets built
here, properly, as thin `apiClient.post` wrappers mirroring the
`salesQueries.js` style. Every payload is copied verbatim from the web call
site that already works in production.

This is where the last rewrite rotted: `services/api.js` hand-mapped payloads
(`Status`, `Progress`, `IsBlocked`, `Watchers`) that drifted from the backend
with nothing to catch it. The API layer is therefore the one part of this
build with mandatory test coverage (§5.4).

**Hard rule for this build:** no screen or component calls `apiClient`
directly. Every request goes through a named fetcher in `src/api/`. A screen
that needs a new endpoint gets a new fetcher, not an inline `post`. This is
the whole point — when a payload changes there is exactly one file to open,
not a grep across the feature tree.

**Follow-on, agreed 2026-08-02:** the web gets the same treatment once mobile
proves the shape — `web/src/api/taskQueries.js` + `workspaceQueries.js`
extracted from the 10 files that currently inline those calls, matching
`salesQueries.js`. Separate piece of work, not part of Phase A, and it is a
pure refactor with the existing web tests as the safety net.

Endpoints in scope — the 42 the web uses:

- `tasks/` — `fetchTasks`, `saveTask`, `moveTaskColumn`, `deleteTask`,
  `bulkDeleteTasks`, `addTaskComment`, `getTaskComments`, `deleteTaskComment`,
  `pinTaskComment`, `markTaskCommentRead`, `saveTaskChecklist`,
  `getTaskChecklist`, `deleteTaskChecklist`, `logTaskTime`,
  `getTaskTimeEntries`, `deleteTaskTimeEntry`, `getTaskActivity`,
  `addTaskDependency`, `removeTaskDependency`, `fetchTaskDependencies`
- `workspaces/` — `fetchWorkspaces`, `saveWorkspace`, `fetchWorkspaceMembers`,
  `addWorkspaceMember`, `setWorkspaceMemberRole`, `removeWorkspaceMember`,
  `respondInvite`, `archiveWorkspace`, `deleteWorkspace`,
  `convertWorkspaceToShared`, `transferWorkspaceOwnership`,
  `syncProjectWorkspaceMembers`, `ensurePersonalWorkspace`,
  `applyKanbanTemplate`
- `kanban/` — `fetchKanbanColumns`, `saveKanbanColumn`, `deleteKanbanColumn`
- `attachments/` — `save`, `fetch`, `download`, `delete`
- `notifications/` — `fetchNotifications`, `markNotificationRead`,
  `markAllNotificationsRead`
- `users/` — `directory`, `me/updateProfile`, `me/changePassword`
- `auth/` — `loginUser`, `logoutUser`

### 4.3 Stores

`useAuthStore` — mirrors the web store's shape (`token`, `user`, `company`,
`permissions`, `menuRights`, `CompId`, `BranchId`, `UserId`,
`isAuthenticated`), persisted to `AsyncStorage` instead of `localStorage`.

`useWorkspaceStore` — active workspace, workspace list, member cache.

Login sends `{ identifier, password }`. The backend still accepts `username`
for back-compat (`authController.login`), but new code uses `identifier` so
email and mobile login work.

### 4.4 Reuse

**Keep:** `src/components/` — `BottomSheetModal`, `Button`, `CheckboxField`,
`DateField`, `Dialog`, `FAB`, `FieldRow`, `FormField`, `FormModal`, `Header`,
`HeaderWithSearch`, `Icons`, `Logo`, `MultiSelectField`, `SearchBar`,
`SelectField`. Plus Poppins fonts and `constants/theme.js` (`colors`,
`typography`, `spacing`, `borderRadius`, `shadows`, `components`).

Refit as needed; do not rebuild. This is real work already done.

**Delete — gone for good** (out of scope per §2.3): `UsersScreen`,
`TeamsScreen`, `ProjectsScreen`, `PlaceholderScreen`, `DashboardScreen`,
`StatsCards`, `BigCard`, `ChartIcon`, and the empty `src/store/` dir.

**Delete — rebuilt under `features/`** (wrong domain model, not wrong idea):
`services/api.js`, `services/apiService.js`, all six hooks (`useAuth`,
`useKanban`, `useProjects`, `useTasks`, `useTeams`, `useUsers`),
`TasksScreen`, `KanbanScreen`, `LoginScreen`, `WelcomeScreen`, and the
task-specific components `TaskCard`, `TaskModal`, `AddTaskModal`,
`TaskFilters`, `HeaderFilters`, `FilterSelect`.

Nothing is deleted until its replacement exists — §6.2 order applies.

---

## 5. Decisions

### 5.1 My Work filters client-side — no backend change

`sp_FetchTask` has no assignee parameter. It never needed one: the web has no
cross-workspace "My Tasks" screen, and that feature sits on the deferred list
in `backend/WORKSPACES.md:100`.

It does not need one now either. `@WorkspaceId IS NULL` already returns every
task the caller can see across all workspaces, and every row carries
`AssigneesJson`. So:

```js
fetchTasks({ WorkspaceId: null, PageSize: 200 })
  .then(rows => rows.filter(t => isAssignee(t, myUserId)))
```

**The database holds 23 tasks across 7 workspaces.** Server-side filtering for
that is not worth writing.

**Known ceiling, to be marked in code:** this downloads every visible task to
display a few, and makes server pagination meaningless. It stops being
sensible in the low thousands. Upgrade path — `@AssignedToUserId` on
`sp_FetchTask` filtering `tblTaskAssignee` (**not** the `AssignedToUserId`
mirror, or co-assignees vanish), plus two lines in `taskController.fetch`,
which builds an explicit parameter object and will otherwise ignore the new
parameter. Roughly half a day including the §0.4 regression test.

### 5.2 No realtime in Phase A

The backend runs Socket.IO (`backend/src/realtime/`, scopes `workspaces` and
`notifications`) and the web uses it. Mobile starts with refetch-on-app-focus
via TanStack Query. That covers the realistic case — you pocket the phone, come
back, see current data — without background reconnects, battery drain, or
socket lifecycle bugs across app suspension.

Sockets after the core is solid, if the lag is actually felt.

### 5.3 No push notifications, no offline mode in Phase A

Push means Expo push tokens, a live tokens table, and APNs/FCM credentials —
its own project. Phase A ships the in-app notification list only.

Offline means a mutation queue and conflict resolution. Out of scope. Query
cache only; no signal means no app.

### 5.4 Testing — none on mobile (decided 2026-08-02)

**No test suite in `mobile/`.** No Jest, no RNTL. CLAUDE.md §0.4 binds
`backend/src/` and `web/src/` only; mobile is outside it, and the backend and
web suites (549 + 918) already cover every endpoint this client calls.

The residual risk is stated plainly so nobody is surprised by it later: those
suites verify the *server* contract, not what the phone puts on the wire. The
old app died sending `ProjectId` where the controller wanted `WorkspaceId`, and
a green backend suite would not have caught it.

What stands in for tests:

- Every payload in `src/api/` is copied verbatim from the controller
  signature in `backend/src/controllers/`, not written from memory.
- Reactotron (`ReactotronConfig.js`, dev-only) shows every request and
  response live, so a drifted payload surfaces the first time the screen runs.
- The API layer is centralised (§4.2), so a contract change is one file to fix
  rather than a hunt across the feature tree.

If drift bites in practice, the cheapest fix is a thin suite over `src/api/`
alone — endpoint plus payload shape, no screens.

### 5.5 Board moves via menu, not drag

`@dnd-kit` does not exist on RN, and gesture-based kanban drag on a 360px
screen with 4+ columns is a support burden. Long-press → "Move to…" sheet →
`moveTaskColumn`. Same endpoint, same permission gate (`change_status`).

---

## 6. Build order

### 6.0 Branch + SDK upgrade

`feat/mobile-rewrite` off `main`. Expo 55 → 57.0.9, `npx expo install --fix`,
`npx expo-doctor` until clean, dependency refresh, `eas.json`.

**Boot the empty shell on a real device before writing any feature.** A
two-major SDK jump will break things; it should break against an app with
nothing in it.

### 6.1 Foundation

`src/api/` + `axios.js` (token injection, 401 → logout), `useAuthStore`,
navigation shell, theme wiring. **Done when:** login works end to end against
`https://shadowcodes.in/CRM` on a device, and the three tabs render.

### 6.2 Features, in order — each usable before the next starts

1. My Work list + grouping
2. Task detail — fields, checklist, comments
3. Attachments — camera, gallery, document picker, download
4. Time entries, activity, dependencies
5. Board view + column move
6. Task create/edit + assignees
7. Workspace management — list, create, members, invites, roles, columns,
   archive/delete

### 6.3 Release

EAS build, install on real devices, `expo-doctor` clean.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Expo 55→57 breaks reanimated/gesture-handler/screens | Upgrade against an empty shell first (§6.0), before feature work exists to confuse the diagnosis |
| Payload drift silently returns | Mandatory API-layer tests (§5.4); payloads copied verbatim from working web call sites |
| `My Work` client filter outgrows itself | Ceiling documented in code with the upgrade path (§5.1) |
| Scope creep into Sales/Support mid-build | Feature folders exist but stay empty; Phase A ships first |
| Attachment upload on mobile | `Entity` field must be appended to `FormData` **before** the file part — multer's `destination()` reads `req.body.Entity` as the stream is parsed |

---

## 8. Deferred

Realtime sockets · push notifications · offline mode · Sales (Phase C) ·
Support (Phase B) · admin CRUD · reports · the `sp_FetchTask` assignee
parameter (§5.1) · RNTL screen tests · iOS release (Android first).
