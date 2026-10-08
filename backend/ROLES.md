# Roles, Permissions & Reach

Who sees what, who can change what. Spec: `docs/superpowers/specs/2026-10-07-org-hierarchy/design.md`.
The group **is** the role. Everything below is enforced on the server.

---

## Offices

`tblBranch` is a tree (`ParentId`, `IsActive`; null parent = top level). Head
office, region and sub-office are just depth; there is no type column. Saving
refuses a loop and deactivating an office with active people. Managed by admins
at `/api/branches/saveBranch`.

- **Home office:** `tblUser.BranchId`. **Extra offices:** `tblUserBranchAccess` (`CanWrite = 0` = read-only there).
- **Manager:** `tblUser.ReportsTo` is the only chain between people (Team reach, escalation).
- Moving a person never moves their records; a record keeps its `BranchId`.

## Module grants

`tblGroupModule`: one row per (role, module) with `CanView/CanAdd/CanEdit/CanDelete` and `Reach`.
No row or `CanView = 0` = no module: 403 and no data, reports and dashboard figures included.

Modules: `leads` (leads, follow-ups, calls, quotations) · `sales_reports` (uses `leads` reach) ·
`complaints` (tickets, escalations) · `support_reports` (uses `complaints` reach) · `customers` ·
`people` · `attendance` · `tasks` · `teams` · `projects` · `roles` (admin) · `offices` (admin) · `settings` · `dashboard`.
Only `leads`, `complaints`, `customers`, `people`, `attendance` take a reach.

| Reach | Offices | Owner filter |
|---|---|---|
| `Own` | home | the user |
| `Team` | home + offices of everyone below | the user + the `ReportsTo` subtree |
| `Office` | home + extra offices | none |
| `OfficeTree` | the above + every office below each | none |
| `Company` | all | none |

Several roles: per module the union of actions and the widest reach. `IsAdmin` comes from any active group.
`tblUserGroups.CanSeeSensitive` (Owner, Admin, HR Manager) lets a caller see others' `HourlyRate`, `Mobile`, `Email`.
Menus show when the role can view the menu's module (`tblMenu.Module`); `sp_ValidateUser` still returns menu rights in the old shape.

## The one visibility rule

Every list, detail, report and dashboard figure of a reach module:

```sql
WHERE (
     ( BranchId IN @branchIds AND (@ownerIds IS NULL OR OwnerId IN @ownerIds) )
  OR AssignedTo = @UserId OR OwnerId = @UserId OR CreatedBy = @UserId   -- mine -> always visible
)
```

**`OR`, not `AND`**: assignment is an explicit act of sharing. `@ownerIds` NULL means no owner filter;
an empty list `[]` means nobody (fail closed). Optional filters (`@BranchId`, `@OwnerId`, `@AssignedTo`)
only narrow within reach.

## Enforcement

1. `loadScope` loads `req.access` on every request from `sp_FetchUserAccess` (role changes apply on the next request; a load failure means no modules).
2. Every route declares `requireModule(module, action)`, `open()` or `requireAdmin`.
   `tests/unit/routes/routeAccess.test.js` walks every router and fails on an undeclared route.
3. `requireModule` re-binds `req.scope` to that module's office and owner lists. Controllers use `scopeParams(req, module?)`,
   `scopeFor(req, module)` and `canSeeRecord`. The scoped SPs take the same lists (second lock).
4. Writes: `assertRecordAccess(..., "write")` checks visibility and the module's edit right. A new record needs an office the caller can write to;
   moving a record to another office needs the target in the caller's write offices.
5. `stripSensitive` removes others' `HourlyRate/Mobile/Email` unless the caller has `CanSeeSensitive` and `people` reach covers the row.
6. The people picker (`fetchUsers`) is company-wide with basic fields only. `fetchAssignableUsers` takes `Module: "leads" | "complaints"` (default leads).
7. Login and `POST /api/auth/fetchMyAccess` return `access = {isAdmin, canSeeSensitive, primaryBranchId, modules:{<module>:{view,add,edit,delete,reach}}}`; clients use it to hide controls only.

## Customers belong to an office

Visible by the `customers` reach of the customer's `BranchId`. Mobile is unique per office while active (`CompId, BranchId, Mobile`);
the same person at two offices is two records. A lead converted to a customer creates it in the lead's office.
A complaint, lead or quotation can only reference a customer the caller can see.

## People — HR rules

A non-admin with `people` edit + `CanSeeSensitive` (HR Manager) may edit a user or reset a password only when that person's
**current** office is within the caller's write reach, and never for an admin. Password resets are audited separately.
Editing a user without `ReportsTo` keeps the current manager; clearing it needs an explicit `0`, admins only.

## Stock roles

| Role | leads | complaints | customers | people | other |
|---|---|---|---|---|---|
| Owner, Admin | Company, all | Company, all | Company, all | Company, all + sensitive | all |
| Sales Head | Company V/A/E | — | Company V/A/E | Team V | tasks, dashboard, sales_reports |
| Support Head | — | Company V/A/E | Company V/A/E | Team V | tasks, dashboard, support_reports |
| HR Manager | — | — | — | Company V/A/E + sensitive | tasks, dashboard, projects, teams |
| Regional Manager | OfficeTree V/A/E | OfficeTree V/A/E | OfficeTree V/A/E | OfficeTree V | tasks, dashboard, both reports, teams, projects |
| Branch Manager | Office V/A/E | Office V/A/E | Office V/A/E | Office V | as Regional |
| Support Manager | — | Office V/A/E | Office V/A/E | Office V | tasks, dashboard, support_reports |
| Sales Team Lead | Team V/A/E | — | Office V/A/E | Team V | tasks, dashboard, sales_reports |
| Sales Executive | Own V/A/E | — | Office V/A | Own V | tasks, dashboard |
| Support Agent | — | Own V/A/E | Office V/A | Own V | tasks, dashboard |
| Task Collaborator | — | — | — | Own V | tasks |

V/A/E = view, add, edit; delete stays with admins unless granted. Customers sit at Office reach even for Own/Team roles.
Tasks: V/A/E/D. Report and dashboard modules: V only. Leads, complaints and customers carry no delete on stock roles.

**Legacy:** `tblGroupAccess`, `tblUserGroups.DataScope` and `HierarchyLevel` are read by nothing, except `HierarchyLevel` for ordering roles on screen.
`tblUser.IsAdmin` is a mirror written by `sp_SaveUser`, read by nothing.

---

### Complaints — write rules (spec 2, 2026-09-16)

| Action | Who |
|---|---|
| Read / edit / set status / log call | visible, **or** assignee, **or** creator (`assertRecordAccess`), plus the module's edit right |
| Assign on create · Transfer | target ∈ `sp_FetchAssignableUsers(caller)` (`assertCanAssign`); cross-office and unassign: Office/OfficeTree/Company reach only |
| **Reopen** a resolved / closed / rejected complaint | `canReopen`: `complaints` reach ∈ {Office, OfficeTree, Company}, **or** the assignee is in the caller's `ReportsTo` subtree and is not the caller. Remarks required. An agent never reopens their own. |
| Escalate | must see the ticket; the target must be a `ReportsTo` ancestor of the assignee (SP-enforced) |
| Delete ticket | `assertRecordAccess` |
| Customers read / write | `customers` reach of the customer's office; the mobile number is unique per office |
| Customer office move on edit | separate `MoveToBranchId` param; needs `customers.edit` and write reach over the old and the new office |
| Customer delete | `requireAdmin`, and never while a ticket references it |

### Leads + quotations — write rules (spec 3, 2026-09-18)

| Action | Who |
|---|---|
| `leads/save` (edit) · `leads/setStatus` · `leads/convertLead` · `leads/transfer` · `leads/bulkTransfer` · `leads/delete` | visible (reach), **or** assignee, **or** creator (`assertRecordAccess`) |
| `quotations/save` (edit) · `finaliseQuotation` · `reviseQuotation` · `rejectQuotation` · `deleteQuotation` | `assertRecordAccess("quotation", …)`, which gates on the **parent lead** — a quotation carries no `BranchId`/`OwnerId` of its own, so its visibility is always its lead's |
| `saveQuoteProfile` | open (any authenticated user) while the branch's profile is unset (`IsSet = 0`); **admin-only** once set — `sp_SaveQuoteProfile` checks `@IsAdmin`, which the controller passes as `req.scope.isAdmin` |

---

## Tasks use a different model — on purpose

Tasks are **not** governed by reach or office. They are governed by
**workspace membership** (`tblWorkspaceMembers` + `sp_CheckTaskPermission`).

| Action | owner | manager | member | viewer |
|--------|:---:|:---:|:---:|:---:|
| view / comment / reply | ✅ | ✅ | ✅ | ✅ |
| create_task / log_time | ✅ | ✅ | ✅ | ❌ |
| edit_fields / reassign / add_dependency | ✅ | ✅ | own only | ❌ |
| change_status | ✅ | ✅ | own or assigned | ❌ |
| delete_task | ✅ | ✅ | own only | ❌ |
| delete_others_comment / pin_comment | ✅ | ✅ | ❌ | ❌ |
| manage_members | ✅ | ❌ | ❌ | ❌ |

Plus: **personal workspaces are private even from admins**; non-personal
workspaces have an `IsAdmin` bypass; a non-member is denied outright.

**Why separate:** Sales/Support ask *"whose customer records can you see?"* →
org hierarchy. Tasks ask *"are you in this workspace, and as what?"* →
membership. A project deliberately spans branches and departments; company rank
is irrelevant to editing a task. Jira and Salesforce split it the same way.

**Never merge these two models.** Office reach answers a question tasks do not
ask — that is why `sp_FetchTask` takes `@BranchId` as an optional *filter* and
ignores `@AccessibleBranchIdsJson`. It previously `AND`-ed branch scope with
membership, which meant a cross-branch workspace member saw **nothing**.

---

## `IsAdmin` is a role property, not a level

`IsAdmin` lives on `tblUserGroups`; only Owner and Admin have it. Never derive it from `HierarchyLevel <= 2`:
Sales Head, Support Head and HR Manager are level 2 and would gain the `sp_CheckTaskPermission` admin bypass
(read/write on every task in every project workspace). An admin counts as Company reach with every action plus sensitive data.
Controllers read `req.scope.isAdmin`, not the JWT claim.

---

## Known-open

- **Login/logout are not audited.**
- **The three spec-1 report SPs** (`sp_LeadsByStatus`, `sp_CallsPerUser`, `sp_ConversionBySource`) scope by branch only; they go with the `/reports/*` redirects.
- **The leaderboard ranks only reps the caller sees in full** (`sp_RptLeaderboard` restricts the rep list to `@OwnerIds`; `079` adds the branch half, pending apply). The caller is always listed.
- **Team reach is not a superset of a member's Own reach in the follow-up list** (`sp_FetchFollowUps` matches `AssignedTo` only in the `@UserId` escape hatch). The three people reports carry `AssignedTo/DoneBy IN @OwnerIds` on purpose and count more than the page shows; read `sp_RptFollowUpCompliance`'s header before changing.
- **`tblBranch` has no `CompId`** (one database per client), so `sp_FetchBranches` is company-blind.

---

## Where things live

| Thing | Location |
|---|---|
| Module grants | `tblGroupModule`; role flags `tblUserGroups` (`IsAdmin`, `CanSeeSensitive`) |
| User → role | `tblUserGroupMap` |
| Offices / extra offices | `tblBranch` (`ParentId`) / `tblUserBranchAccess` |
| Access loading | `sp_FetchUserAccess` → `middleware/access.js` + `permission.js` → `req.access`, `req.scope` |
| Route guards | `requireModule` / `open()` / `requireAdmin`; `routeAccess.test.js` |
| Task permissions | `sp_CheckTaskPermission` |
| Transfer targets | `assertCanAssign` (roster via `sp_FetchAssignableUsers`) |
| Reporting line | `tblUser.ReportsTo` |

## Attendance, day marks and TAT verdicts

- **`attendance` module reach** decides whose presence, day marks and Today row a caller sees (`workSettingsController.visibleUserIds`): everyone sees self + their `ReportsTo` subtree; `Office`/`OfficeTree` add people whose home office is in reach; `Company` (or admin) sees all. Rows outside reach are dropped, not 403.
- **Day marks** (leave, on duty): saved or deleted by someone above the person on the `ReportsTo` chain, or an admin; anyone else gets 403. Never your own.
- **TAT verdict** on a breached task clock: a `ReportsTo` ancestor of the assignee, or the task's workspace owner/manager (`tblWorkspaceMembers`), or an admin; **never the assignee on their own clock**. Personal workspaces have no TAT. Hold-everyone needs workspace owner/manager or the task's creator; an assignee may hold or release only their own.
- **Sessions:** an admin may end any user's sessions (`/api/presence/endSession`); nobody ends their own that way (they sign out).
