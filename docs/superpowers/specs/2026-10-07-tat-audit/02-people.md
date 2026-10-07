# Audit 02: people and org structure (users, groups, ReportsTo, teams, projects)

**Date:** 2026-10-07. Read-only. **DB:** `eCRM+` via MCP (SolarCRM not inspected; its SP bodies are assumed identical because the same scripts are applied to both, but this is **unverified**).
**Bottom line:** the org model has **three hierarchies that never meet**: groups (role/DataScope), `ReportsTo` (who manages whom) and Teams (project rosters). The TAT/presence spec should use **ReportsTo only** for "my team" and for "who gets told". Teams cannot do that job. Today the app has no answer for someone leaving, going on leave or changing branch, and the spec inherits all three gaps unless it plans for them.

---

## 1. How it works today (verified)

### Users
| Act | Path | Behaviour |
|---|---|---|
| Create / edit | `POST /api/users/saveUser` (`requireAdmin`) → `sp_SaveUser` | One form for everything. Password is bcrypt-hashed in Node; blank on edit keeps the old one. `GroupId` **replaces** the mapping (`DELETE` then `INSERT` into `tblUserGroupMap`), so in practice a user has **one group**. `ReportsTo` is checked: not self, must be in the same `CompId`, and a 20-hop walk refuses loops. |
| Branch | `userController.js:59` sends `req.user.BranchId` | **A new user is always created in the admin's own branch. Edit never touches `BranchId`** (the `sp_SaveUser` UPDATE has no BranchId). The UI has no branch field. **Moving someone to another branch is impossible inside the app** and needs hand-written SQL. |
| Deactivate | the same form, `UserActive=false` → `tblUser.IsActive=0` | That one bit is all that changes (§3). |
| Delete | `POST deleteUser` (`requireAdmin`) → `sp_DeleteUser` | Refused if the user is a task assignee, a project manager or a team lead. Otherwise it **hard-deletes** their group map, team memberships, **time entries and task comments**, then the user row. |
| Password reset | admin types a new password in the edit form; self-service `me/changePassword` | No reset link and no forced change on next login. |
| Directory | `sp_FetchUserDirectory` | Active users only. It feeds the "Reports To" picker. |

### Role and scope
- `sp_FetchAccessibleBranchIds` is called on **every request** by `loadScope`. It reads `DataScope`, `IsAdmin` and `IsActive` live from the DB, so a role change works on the next request. **Team = ReportsTo subtree** (a recursive CTE). Inactive subordinates stay in it on purpose. Branch rows for All/Company come from `tblBranch`, which is company-blind (a known issue).
- `backend/ROLES.md:81` still says Team means "members of teams they lead". **That is wrong.** The SP uses the ReportsTo subtree, and so does ROLES.md's own bottom table. This is a doc bug.
- When a user is in several groups, the lowest `HierarchyLevel` wins. Live data has 0 multi-group users.
- Menu rights are loaded only at login (`sp_ValidateUser` RS2) and are not enforced server-side (a known gap).

### Teams and projects
- `tblTeams` (+ `tblTeamMembers`, `LeadUserId`) is a **project roster**. It has **no relation to `ReportsTo`**. On live data the single team has 2 members and **neither reports to the team lead**. The lead is also **not a member** of their own team.
- `tblProjects` has `ManagerUserId`, `TeamId` and a legacy `Members` JSON column.
- Project workspace members: `sp_SaveWorkspace` copies team members + the project manager **at creation**. CLAUDE.md §6 says "snapshotted", but the code is **not** a snapshot:
  - `sp_SaveTeam` **pushes every roster save** into all linked project workspaces: it adds newcomers and soft-removes anyone dropped from the roster.
  - `sp_RemoveWorkspaceMember` on a project workspace also **sets the user inactive in `tblTeamMembers`**. That is a back-propagation: leaving one project's workspace takes you off the team, and therefore off every other project workspace on that team the next time the team is saved or synced.
  - `sp_SyncProjectWorkspaceMembers` is a manual "sync from team" button. Its header comment says "team changes never flow in automatically", which `sp_SaveTeam` contradicts.
- **Answer to "which hierarchy is a manager's team":** `ReportsTo`. Teams are per-project rosters with no management meaning.

### Tasks vs people
- Task access is workspace membership (`sp_CheckTaskPermission`). **`ReportsTo` gives no access to tasks.** A manager who is not a member of the workspace (and not `IsAdmin`) cannot open a subordinate's task. **Personal workspaces are private even from admins.** Live data: personal workspaces hold 12 tasks, 5 of them open.

---

## 2. Bugs

| # | Where | Bug | Repro | Severity |
|---|---|---|---|---|
| B1 | `routes/teamRoutes.js:12-14`, `routes/projectRoutes.js:12,24`; `sp_SaveTeam` takes no caller | **Any authenticated user can rewrite any team in the company**, and through the `sp_SaveTeam` cascade **add themselves to every linked project workspace** as `member` (create, edit and comment on tasks) or remove others. The menu restricts Teams/Projects to Owner, Admin and HR, but the API does not. `saveProject` is also open: anyone can change a project's manager or team. `deleteProject` lets any team member delete it. | As a Sales Executive: `POST /api/teams/fetchTeams`, then `saveTeam {Id:X, Name, Members:[...existing, myId]}` → you become an active member of X's project workspaces. | **High** (privilege escalation inside the company) |
| B2 | `authController.js:92` (JWT `IsAdmin` = `tblUser.IsAdmin` **column**) vs `tblUserGroups.IsAdmin` | There are **two admin flags**. `requireAdmin` and `sp_CheckTaskPermission` use the group flag. The JWT/column flag still drives `sp_FetchUser` (unscoped fallback), `sp_DeleteUser` (cross-branch delete), `sp_FetchTeam`/`sp_DeleteTeam`, `sp_FetchProject`/`sp_DeleteProject` (`projectController.js:93,136`), kanban, and **socket room joins** (`realtime/socket.js:36`). The Users form has an **"Is Admin" checkbox** that sets only the column. Live: 1 user is in the Admin group with column `IsAdmin=0`. ROLES.md says "tblUser.IsAdmin is derived from the group at login"; **it is not**. | Tick "Is Admin" on a Sales Executive. They can now delete any team or project in any branch and join any shared workspace's socket room, while `requireAdmin` still refuses them. | Medium |
| B3 | `sp_FetchAccessibleBranchIds` vs `sp_ValidateUser` / `sp_FetchUser` | The scope SP **ignores `ug.IsActive`**, while menus and `sp_FetchUser` filter on it. A **deactivated group still grants its DataScope and IsAdmin**, yet its menus vanish. | Set Admin group `IsActive=0`: members lose the sidebar but keep admin API rights. | Medium |
| B4 | `userController.js:34` default `GroupId = 8`; `sp_SaveUser` `ELSE SET @GroupId = 8` | **Group 8 does not exist** (live check), and `tblUserGroupMap.GroupId` has no FK. A save with GroupId 0 or null maps the user to a phantom group: no menus, Self scope. The web edit path reaches this too: `Users.jsx:119` sends `GroupId: row.GroupId \|\| 0`, and `sp_FetchUser` returns NULL GroupId when the user's group is inactive, so **editing anything on such a user silently strips their role**. | Deactivate a group, then edit one of its users. | Low-Med |
| B5 | `sp_SaveUser` (UPDATE without BranchId) + `userController.js:59` | Branch can never change, and new users always land in the **admin's** branch. A Delhi hire created by a Mumbai admin is a Mumbai user (wrong scope and wrong holidays later). | Admin in branch 1 creates a user for branch 2. | Medium (correctness and data) |
| B6 | `sp_DeleteUser` | It hard-deletes the user's **task comments and time entries**, which destroys history other people need. It **does not check** leads (`OwnerId`), tickets (`AssignedTo`), workspace ownership, or people who `ReportsTo` this user, and none of these have FKs. A Sales Executive with leads but no tasks can be deleted: the leads are orphaned and disappear from the Team lead's subtree scope, and subordinates point at a deleted id. Live orphan counts are 0 today. | Delete a user who owns leads and has no tasks. | Medium |
| B7 | `middleware/permission.js:96-110` (loadScope `catch`) | The fail-closed fallback scope has **no `isActive`**, so if `sp_FetchAccessibleBranchIds` throws, a deactivated user passes with Self scope. | Transient DB error during a deactivated user's request. | Low |
| B8 | `realtime/socket.js:27-41` | The socket handshake only checks the JWT. A **deactivated user keeps their socket and room joins** until the token expires (≤24 h). It carries invalidations only, not data. | Deactivate a user with an open tab. | Low |
| B9 | `sp_SaveWorkspace` (project branch) | The creation snapshot reads `tblTeamMembers` **without `tm.IsActive = 1`**. Someone who left an earlier project workspace (and so went inactive on the team, see §1) is re-added to the next project workspace for that team. | Remove member from project ws A, then create project ws B on the same team. | Low |
| B10 | `sp_SaveProject` | Changing a project's `TeamId` or `ManagerUserId` does not update the linked workspace's `TeamId` or manager role, so "Sync from team" syncs the **old** team. | Edit a project's team, then press Sync. | Low |
| B11 | `tblGroupAccess` | Live data has duplicate grant rows (HR Manager and Sales Head appear twice per menu). HR Manager has Users CanAdd/CanEdit, but `saveUser` is `requireAdmin`, so HR gets a **dead Users screen** where every save returns 403. | Log in as HR Manager and save a user. | Low (UX) |
| B12 | `sp_FetchUser` | Team and Self callers get the **whole branch roster**, including Email, Mobile and HourlyRate, because it ignores `ownerIds` and `fetchUsers` is not admin-gated. Not a cross-company leak. Matters because a presence board must **not** reuse it. | A Sales Executive posts to `fetchUsers`. | Low-Med (privacy) |
| B13 | `ROLES.md:81` | The doc says Team = "members of teams they lead". The code says ReportsTo subtree. | n/a | Doc |

Checked and **not** bugs: `ReportsTo` cycles cannot survive `sp_SaveUser` (live: 0 cycles, max depth 3, 0 self-reports). The recursive CTEs are cycle-safe through `u.Id <> @UserId`: in a one-parent graph, any cycle reachable downward must pass through the root. `sp_FetchEscalationTargets` already walks *through* inactive managers to the next active one.

---

## 3. What happens when someone leaves, goes on leave, or changes manager (today)

| Event | Today | Effect |
|---|---|---|
| **Deactivated** | Only `IsActive=0`. The API blocks them on the next request (loadScope). Their open tasks stay assigned, leads/tickets stay owned, shared workspaces they own keep them as owner, their personal workspace and its tasks become invisible to everyone, and people who `ReportsTo` them still point at them. There is no handover step. | Their work stalls silently. Their reports' escalations skip over them correctly (`sp_FetchEscalationTargets`), but nothing else does. The `Reports To` picker drops inactive users, so editing a subordinate shows an empty manager field (**unverified** whether saving then clears it; the form keeps the number in state, so it probably survives). |
| **On leave** | No concept exists. | Under the spec: marked "Not signed in", manager pinged daily, task clocks keep running, and breaches pile up with "Unplanned leave" as an after-the-fact excuse. |
| **Manager change** | One edit of `ReportsTo`, applied on the next request. | All history follows the person: the new manager sees the old breaches and the old manager loses them. There is no record of who managed whom, and when. |
| **Branch change** | Not possible in the app (B5). | n/a |
| **Removed from a workspace** | The member row is soft-removed, but **`tblTaskAssignee` rows remain**. | The person stays assignee on tasks they can no longer open. Under the spec their clocks would keep running and breach. |

**Live sanity (eCRM+, 20 users, all active, 1 company, 3 branches):** active users with no `ReportsTo` = **7** (2 Owner, 2 Admin, 1 Sales Head, **2 Task Collaborator**, which is a Self role with no manager). ReportsTo → inactive/missing = 0; cycles = 0; self-report = 0; cross-branch manager = 2; users with no group = 0; multi-group = 0; maps to a missing group = 0; inactive users holding tasks/leads/tickets/workspace ownership/memberships = 0 (no inactive users exist); teams with inactive members = 0; team members reporting to their lead = **0 of 2**; project workspaces out of sync with their team = 0. DataScope distribution of active users: All 2 · Company 3 · MultiBranch 1 · Branch 3 · Team 1 · Self 10. Group `IsAdmin` vs column `IsAdmin` mismatch = 1.

---

## 4. Gaps, ranked by value for a 15-person company (WFH staff, 2 managers, owner)

1. **"Who is Rahul's manager" has no fallback.** 7 of 20 have no `ReportsTo`, including a Self role. The spec's "notify the ReportsTo manager" sends nothing for them. Needs: first **active** ancestor (reuse `sp_FetchEscalationTargets`), then the company's admins (or a configured "people owner").
2. **No leave.** Without it, presence and TAT punish people for approved absence. That is the fastest way to make staff distrust the feature.
3. **No offboarding or handover.** Deactivation should close clocks, end sessions, and offer reassignment of open tasks, leads and tickets plus `ReportsTo` children.
4. **Department-blind wide scopes.** DataScope "Company" makes the Sales Head see **every** person's sign-in time and lateness, Support and HR included. For sales leads that is the accepted model. For attendance, people expect "my reports" (plus HR/Owner seeing everyone).
5. **Teams vs ReportsTo confusion.** The UI has both "Team" (roster) and "Reports To", and nothing tells an admin which one drives visibility. A presence board labelled "My team" will be read as the Teams screen.
6. **Branch transfer and correct branch on create** (B5). Branch holidays (F1) depend on it.
7. **Admin flag dualism** (B2). The spec gives "calendar admin and force-end: IsAdmin only", which must mean the **group** flag.
8. **Team/Project writes are open** (B1). Not a TAT issue, but TAT makes workspace membership decide who gets judged, so a self-service path into membership matters more.

---

## 5. What the TAT/presence spec must account for (concrete changes)

1. **Define "my team" as the ReportsTo subtree, always.** Today board rows for any user = `{self} ∪ ReportsTo subtree`. Add the whole company only when the user has **group `IsAdmin`** or a new menu grant `Attendance` (`tblGroupAccess`, giving HR and Owner the company view). **Do not use raw DataScope for people**: Company/All would show the Sales Head everyone's attendance, and Branch would show a Branch Manager the people of another department at their desk. Spec §5 "Branch/Company by branch" should be replaced with this. Add the universal "OR" rule: anyone whose `ReportsTo` is me is always visible, even in another branch (2 live cross-branch managers).
2. **Write a new `sp_FetchTeamPresence`; do not reuse `sp_FetchUser`** (B12: it ignores `ownerIds` and returns PII).
3. **Notification target = first active ancestor** (`sp_FetchEscalationTargets`, Depth MIN). If there is none, notify the company's group-`IsAdmin` users. Store `NotifiedUserId` on `tblTaskTat` and `tblPresenceDay`, so "who was told" survives a later manager change.
4. **Freeze org context on history rows.** Add `ManagerId` and `BranchId` at write time to `tblPresenceDay` and `tblTaskTat` (opened row). Reports may still scope by the current subtree, but a breach verdict (F5: "by the assignee's ReportsTo chain") should be judged by the current chain **or** the frozen manager, so a breach is never left with no one entitled to give a verdict.
5. **Verdict and visibility vs `sp_CheckTaskPermission`.** A manager who is not a workspace member cannot open the task, so they cannot see the TAT tab or give a verdict. Pick one:
   - (a) the verdict and TAT-tab endpoints authorise "ancestor of the assignee OR workspace owner/manager", and show TAT data without opening the task body; or
   - (b) document that managers must be workspace members.

   (a) is the right call. **Personal workspaces:** either **no clocks** (recommended: nobody can assign there except the owner, and live data has 0 non-owner assignees), or clocks counted but never shown to the manager in detail. Otherwise managers get breach alerts for tasks they are forbidden to see.
6. **Leave.** Add `tblUserLeave (CompId, UserId, FromDate, ToDate, HalfDay, Reason, ApprovedBy)`. `workCalendar.js` takes per-user non-working dates alongside holidays. Presence shows "On leave" and does not ping the manager. Open clocks: either stop counting working minutes on leave days (simplest: leave days are non-working on that user's calendar) or show "Assignee on leave" so the manager reassigns. The spec currently has holidays only; without leave, D2's fairness promise breaks.
7. **Deactivation hook** (in `userController.save` when `UserActive` flips to false):
   - end sessions (`EndReason='forced'`);
   - close open `tblTaskTat` rows with `CloseReason='deactivated'` (add the enum value);
   - the sweep and the not-signed-in check filter `u.IsActive=1`;
   - return the counts of open tasks, leads, tickets and direct reports so the UI can prompt for handover.

   Also add `isActive` to the loadScope fallback (B7) and check it at socket handshake (B8).
8. **Workspace removal = unassign.** When `sp_RemoveWorkspaceMember` (and the `sp_SaveTeam` cascade and `sp_SyncProjectWorkspaceMembers` deactivations) removes a member, remove them from that workspace's `tblTaskAssignee` and close their clocks `unassigned`. Otherwise the spec's D6 path never fires and a removed person breaches on tasks they cannot see.
9. **`sp_DeleteUser` must refuse when history exists** (any `tblTaskTat`, `tblPresenceDay`, `tblUserSession`, leads, tickets, or ReportsTo children), rather than cascading. Deactivation is the leave path. FKs on the new tables will otherwise make delete fail with a raw 500, or silently orphan rows if FKs are omitted.
10. **`PresenceExempt` is right for the Owner.** Admins with no manager should still be tracked but notify nobody, which is fine. Show "no manager set" on the Today board as a data-quality warning.
11. **Rollout check (pre-flight SELECT in `093` header):** list active non-exempt users with no active ancestor and no `IsAdmin` fallback. Today that is the 2 Task Collaborators.
12. **Menu rights staleness** becomes ≤1 working day under daily sessions, which is acceptable and no change is needed. `force-end` gives immediate effect. Note that the JWT `IsAdmin` claim is equally stale, another reason to read only `req.scope.isAdmin` in new code.

---

## 6. Recommended fixes

| Fix | Why | Size |
|---|---|---|
| `requireAdmin` (or menu-right check) on `saveTeam`/`deleteTeam`/`saveProject`/`deleteProject` | B1 privilege escalation into workspaces | **S** |
| New presence/Today SP scoped by ReportsTo subtree + IsAdmin/`Attendance` grant; never `sp_FetchUser` | §5.1–5.2; department-blind scope | M (part of spec) |
| Manager resolution = `sp_FetchEscalationTargets` first active ancestor → admins fallback; store `NotifiedUserId` | §4.1, §5.3 | S |
| Freeze `ManagerId`/`BranchId` on presence and TAT rows | §5.4, manager change mid-period | S |
| `tblUserLeave` + calendar input + "On leave" status | §5.6 | M |
| Deactivation hook (sessions, clocks, handover counts) + `isActive` in fallback + socket | §5.7, B7, B8 | M |
| Unassign on workspace removal (3 SPs) | §5.8 | S |
| `sp_DeleteUser` → refuse when history exists; stop deleting comments and time entries | B6, §5.9 | S |
| Verdict / TAT-tab auth = ancestor OR ws owner/manager; no clocks in personal workspaces | §5.5 | S–M |
| Kill the column-`IsAdmin` path: login reads the group `IsAdmin`; drop the Users-form checkbox; controllers pass `req.scope.isAdmin` | B2 | M (touches ~6 controllers + socket) |
| `sp_FetchAccessibleBranchIds` join `ug.IsActive = 1` | B3 | S |
| Remove the `GroupId=8` default; 400 when no valid group; FK `tblUserGroupMap.GroupId` | B4 | S |
| Branch field on user form + `sp_SaveUser` UPDATE BranchId (admin only) | B5, branch holidays | S |
| `sp_SaveWorkspace` snapshot `tm.IsActive=1`; stop `sp_RemoveWorkspaceMember` back-propagating to `tblTeamMembers`; `sp_SaveProject` updates the linked workspace's TeamId | B9, B10, team/workspace coupling | S |
| Fix ROLES.md line 81, CLAUDE.md §6 "snapshotted" wording, and the B11 duplicate grants / HR Users dead screen | Docs + UX | S |

**Unverified:** SolarCRM DB parity; whether the UserForm keeps an inactive `ReportsTo` value on save (Combobox behaviour with a value missing from options); live socket behaviour after deactivation (read from code only).
