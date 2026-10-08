# Org hierarchy & access — design

Status: approved in chat 2026-10-07, spec awaiting review.
Research: [research.md](research.md) (Salesforce, Dynamics 365, Zoho, Odoo,
Freshsales, HubSpot, LeadSquared).
Branch: `feat/org-hierarchy`, cut from `feat/task-tat-presence`.
Comes before TAT/presence P2. The P2 Today board takes its "who can see whom"
from the People reach defined here.

## 1. Why

The 2026-10-07 matrix test (357 of 381 passed) found three gaps that come from
the access model itself, not from one bug each:

1. **HR sees sales and support data.** HR Manager has `DataScope = Company`,
   so it sees every lead, complaint and the funnel. The department axis
   (`tblGroupAccess`) is enforced server-side only on Teams and Projects.
2. **Staff see colleagues' salary and contact details.** `fetchUsers`
   returns `HourlyRate`, `Email` and `Mobile` of colleagues in the same
   branch to Self and Team users.
3. **Editing a user without `ReportsTo` clears the manager.**

There was also no way to model head offices with sub-offices. Branches are a
flat list, and MultiBranch is a hand-kept list of extra branches per user.

**Goal:** one model that fits a 5-person client with one office and a client
with head offices and sub-offices. It is enforced on the server so that no
client, curl call or forgotten route can get around it.

## 2. The model

### 2.1 Offices form a tree
- `tblBranch` gains `ParentId` (null = top level) and `IsActive`.
- A head office, region or sub-office is just an office at some depth. There
  is no type column, and depth is unlimited (recursion capped at 32).
- **Saving refuses:**
  - a loop (the parent is the office itself or one of its descendants);
  - deactivating an office that still has active people.
- An office is never hard-deleted once people or records reference it.
- **A tiny client** has one office, created with the database, and never needs
  the Offices screen.
- Each client has its own database, so `tblBranch` has no `CompId`. That stays
  as it is.

### 2.2 People
- **Home office:** `tblUser.BranchId`, required. Unchanged.
- **Manager:** `tblUser.ReportsTo` is the only chain between people. It drives
  Team reach and escalation. There is no second hierarchy (no positions, no
  territories).
- **Extra offices:** `tblUserBranchAccess`, as today.
  - Each extra office now counts wherever the role's reach is Office or
    Office + below. With Office + below, the offices beneath it count too.
  - This replaces the MultiBranch scope.
  - `CanWrite = 0` keeps that office read-only for the person, as today.
- **Moving a person never moves their records.** Each record keeps the
  `BranchId` it was created with.

### 2.3 Roles are module grants
A role (group) holds one row per module:

| Field | Meaning |
|---|---|
| `CanView` / `CanAdd` / `CanEdit` / `CanDelete` | What the role may do in the module |
| `Reach` | `Own` · `Team` · `Office` · `OfficeTree` · `Company` |

**No row, or `CanView = 0`, means no module.** The server returns 403 and
nothing from that module, including report data and dashboard figures built
from it.

**Modules** (a fixed list, defined in code and seeded in SQL):

| Module | Covers | Reach applies? |
|---|---|---|
| `leads` | leads, follow-ups, calls, quotations, lead attachments | yes |
| `sales_reports` | the eight sales reports | uses `leads` reach |
| `complaints` | tickets, ticket attachments, escalations | yes |
| `support_reports` | ticket reports | uses `complaints` reach |
| `customers` | customer records | yes |
| `people` | managing users, viewing salary and contact details | yes |
| `tasks` | the Tasks and My Work menus | no — membership rules (§2.6) |
| `teams` | Teams admin | no |
| `projects` | Projects admin | no |
| `roles` | Roles & Permissions | no — admin only |
| `offices` | the Offices screen | no — admin only |
| `settings` | custom fields, lookups, categories, priorities, products | no |
| `dashboard` | the Dashboard menu | figures use each source module's reach |

**Menus:** `tblMenu` gains a `Module` column. A menu shows when the role can
view its module. `sp_ValidateUser` still returns menu rights in today's shape
(`MenuId`, `CanView/Add/Edit/Delete`), now built from the module grants, so
`menuBuilder` and mobile `menuAccess` keep working.

**Sensitive data:** `tblUserGroups` gains `CanSeeSensitive BIT`, true for
Owner, Admin and HR Manager. Without it, other people's `HourlyRate`, `Mobile`
and `Email` are removed before any response is sent. Your own details are
always shown.

**Admin:** `IsAdmin` stays a role property, as in 093.
- An admin is treated as `Company` reach with every action on every module,
  plus sensitive data.
- Personal workspaces stay private even from admins.

### 2.4 Reach
Reach is measured from the user's home office (plus extra offices) and their
`ReportsTo` subtree:

| Reach | Offices in scope | Owner filter |
|---|---|---|
| `Own` | home office | the user |
| `Team` | home office plus the offices of everyone below them | the user plus everyone below them in `ReportsTo` |
| `Office` | home office plus extra offices | none |
| `OfficeTree` | the above plus every office below each of them | none |
| `Company` | every office | none |

**The one visibility rule**, used by every list, detail, report and dashboard
figure of a reach module:

> The user can view the module, **and** either:
> - the record is theirs: owner, assignee, creator, or escalated to them; **or**
> - the record's office is in their offices **and** (there is no owner
>   filter, or the record's owner is in the owner filter).

**Further rules:**
- **Filters only narrow.** `@BranchId`, `@OwnerId` and `@AssignedTo` filter
  inside the reach and never widen it.
- **Several roles:** a user with several groups gets, per module, the union of
  the actions and the widest reach. `IsAdmin` comes from any active group (as
  in 093).
- **Writes** need the action right, plus:
  - for a new record, an office the user can write to;
  - for an existing record, the visibility rule.
- Lead and complaint writes keep their existing checks (`assertRecordAccess`,
  `assertCanAssign`, `canReopen`), now fed by the module's reach.

### 2.5 Customers belong to an office
This changes the earlier design, where customers were company-wide.

- **Visibility:** a customer is visible by the `customers` reach of its
  `BranchId`. A North Delhi customer does not exist for East Delhi. A head
  office with Office + below sees both.
- **Duplicates:** the mobile number is unique per office while the customer is
  active. The unique index changes from `(CompId, Mobile)` to
  `(CompId, BranchId, Mobile)`.
  - The same person at two offices means two records.
  - Neither office is told about the other's record.
- **Office of a new customer:** chosen at creation from the offices the user
  can write to. It defaults to the home office and is hidden when there is
  only one choice.
  - Changing it later needs `customers.edit` and reach over both the old and
    the new office.
- **Links:** a complaint, lead or quotation can only reference a customer the
  caller can see. A lead converted to a customer creates the customer in the
  lead's office and checks for duplicates there.
- **Deleting** stays admin-only soft delete, and is refused while a complaint
  references the customer.
- **Migration:** all 59 existing customers already have a `BranchId`, and the
  per-office rule is looser than the per-company one, so nothing clashes.

### 2.6 Unchanged on purpose
- **Tasks** stay membership-governed (`sp_CheckTaskPermission`). An office is
  a filter on tasks, never a gate. Personal workspaces stay private.
- **The people picker** (name, avatar, office, role, active) stays readable to
  every signed-in user. Cross-office workspaces and transfers need it. Basic
  fields only, never salary or contact details.
- **Lookups, custom fields and products** stay readable by every signed-in
  user; forms need them. Only writing them needs `settings`.
- **Left out:** sharing rules, territories, a position hierarchy, a per-field
  permission matrix, and per-record sharing.

## 3. Enforcement — nothing gets around it

1. **Access is loaded fresh on every request.**
   - `sp_FetchUserAccess` replaces `sp_FetchAccessibleBranchIds`. It returns,
     per module: the actions, the reach, the office list (tree already
     expanded) and the owner list.
   - Middleware `loadAccess` puts it on `req.access` and keeps
     `req.scope.isAdmin` / `isActive` and the inactive-user 403.
   - A role change applies on the next request; nobody has to sign in again.
   - If loading fails, the request gets no modules: everything 403s except
     routes that need no module (fail closed).
2. **Every route declares what it needs:** `requireModule(module, action)`.
   - `action` is `view`, `add`, `edit` or `delete`, or a function of the
     request, e.g. a save with `Id > 0` counts as `edit`.
   - Routes that need no module (auth, own profile, notifications, tasks,
     lookups for reading) declare `open()`.
   - **A test walks every router in `config/routes.js` and fails if any route
     has neither.** A new endpoint cannot ship unguarded.
3. **The database is the second lock.** Scoped SPs keep taking
   `@AccessibleBranchIdsJson` and `@OwnerIdsJson`, now for the module in
   question (`scopeParams(req, module)`). A request that somehow passed the
   route check still gets only rows within reach.
4. **One single-record check:** `canSeeRecord(req, module, record, ownerField)`
   is used for every detail and every write on an existing record.
5. **One place strips people data:** `stripSensitive(req, user)` runs on every
   endpoint that returns user rows: users, detail, assignable users, team
   members, presence later.
6. **Old guards removed:**
   - `requireMinLevel` and `requireMenuRight` go away; `requireModule`
     replaces them.
   - `HierarchyLevel` stays only for ordering roles on screen.
   - `tblGroupAccess` is no longer read. It is dropped by a later cleanup
     script once this has been live for a while.

## 4. Stock roles after migration

| Role | leads | complaints | customers | people | other modules |
|---|---|---|---|---|---|
| Owner, Admin | Company, all actions | Company, all actions | Company, all actions | Company, all actions + sensitive | all |
| Sales Head | Company V/A/E | — | Company V/A/E | Team V | tasks, dashboard, sales_reports |
| Support Head | — | Company V/A/E | Company V/A/E | Team V | tasks, dashboard, support_reports |
| HR Manager | — | — | — | Company V/A/E + sensitive | tasks, dashboard |
| Regional Manager | OfficeTree V/A/E | OfficeTree V/A/E | OfficeTree V/A/E | OfficeTree V | tasks, dashboard, both report sets, teams, projects |
| Branch Manager | Office V/A/E | Office V/A/E | Office V/A/E | Office V | tasks, dashboard, both report sets, teams, projects |
| Support Manager | — | Office V/A/E | Office V/A/E | Office V | tasks, dashboard, support_reports |
| Sales Team Lead | Team V/A/E | — | Office V/A/E | Team V | tasks, dashboard, sales_reports |
| Sales Executive | Own V/A/E | — | Office V/A | Own V | tasks, dashboard |
| Support Agent | — | Own V/A/E | Office V/A | Own V | tasks, dashboard |
| Task Collaborator | — | — | — | Own V | tasks |

V/A/E = view, add, edit. Delete stays with admins unless a role is given it.

- **Customers sit at Office reach even for Own and Team roles.** An agent has
  to find the customer standing in front of them at their counter, inside
  their own office only.
- **The migration** fills `tblGroupModule` from today's `DataScope` and
  `tblGroupAccess`:
  - `Self` → `Own`, `Team` → `Team`, `Branch` → `Office`,
    `MultiBranch` → `Office` (the extra offices keep working),
    `Company` / `All` → `Company`;
  - a module gets `CanView` if the role could view any of its menus today;
  - the HR Manager, Sales Head and Support Head rows are then corrected to the
    table above.
- **Custom roles** a client created are migrated by the same rule. The script
  prints a before/after table to check.

## 5. Screens

**Offices** (Admin, new, `offices` module)
- A tree with add-under, rename, move (pick a new parent) and deactivate.
- Shows how many people are in each office.

**Roles & Permissions**
- One grid per role: a row per module, with View/Add/Edit/Delete ticks and a
  reach dropdown (shown only for reach modules).
- Plus a "Can see salary & contact details" tick.

**User form**
- Office picker shows the tree.
- Extra offices is a multi-pick, shown when the role's reach is Office or
  Office + below in some module.
- "Reports to" stays required for non-admins (P1).

**Customers**
- Office field on create (hidden when there is one choice).
- Office column in the list when the user can see more than one office.

**Sidebar, buttons, mobile**
- Read the module grants (`access` comes with login, and
  `POST /api/auth/fetchMyAccess` refreshes it when the window regains focus).
- Hiding a button is a courtesy; the server is what decides.

## 6. Fixes folded in
- **HR seeing sales and support:** fixed by HR having no `leads` or
  `complaints` module, enforced in middleware and SQL.
- **Colleagues' salary and contact details:** fixed by `CanSeeSensitive` and
  `stripSensitive`, server side.
- **`ReportsTo` cleared on edit:**
  - `sp_SaveUser` keeps the current value when `@ReportsTo` is not supplied
    (NULL). Clearing it needs an explicit `0`, which only admins may send.
  - Regression test in `userController`.

## 7. Verification

**Unit tests** (≥80% coverage on touched files):
- `loadAccess`, `requireModule`, the route walk, `scopeParams` per module,
  `canSeeRecord`, `stripSensitive`;
- every controller that switched from `req.scope` to a module;
- web: Roles grid, Offices tree, user form, customers office field.

**Live matrix (the extended `matrix.mjs`)**, against the local backend:
- **Setup:** two head offices, two offices under each, and every stock role in
  each.
- **Checks:**
  - every role × module × action;
  - no data leaks between sibling offices;
  - a head office sees all its descendants and nothing of the other head
    office;
  - HR gets 403 and no rows on leads, complaints and both report sets;
  - salary and contact details are stripped for non-sensitive callers;
  - customers stay inside their office, and the same mobile is allowed in two
    offices;
  - a route with no declaration does not exist (the route-walk test).

**Afterwards:**
- Browser pass through the local app as Owner, HR, a Branch Manager and an
  Executive.
- Test users and offices removed by a cleanup script the user applies.

## 8. Delivery
1. **SQL `096_org_hierarchy.sql`** (user applies with `sqlcmd -I`):
   - the `tblBranch` columns, `tblGroupModule`, `tblMenu.Module`,
     `tblUserGroups.CanSeeSensitive`;
   - the seed and migration;
   - `sp_FetchUserAccess`, `sp_ValidateUser`, the group and branch SPs, the
     customer index and SPs, the `sp_SaveUser` fix, and scoped SPs whose
     parameters change.
2. **Backend:** `loadAccess`, `requireModule`, the route map and walk test,
   controller switch-over, the Offices endpoints and `fetchMyAccess`.
3. **Web:** Offices, Roles grid, user form, customers, and access-driven
   sidebar and buttons.
4. **Mobile:** read `access`, hide what isn't allowed; `typecheck` and `lint`
   clean.
5. **Live matrix and browser pass**, then the Notion log.
