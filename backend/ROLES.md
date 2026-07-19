# Roles, Permissions & Data Scope

Who sees what, who can change what, and why it is built this way.

---

## The core idea: two independent axes

Access is a **matrix**, not a ladder. Both axes hang off the user's group —
**the group *is* the role**.

| Axis | Table | Answers |
|------|-------|---------|
| **Data scope** | `tblUserGroups.DataScope` | *Whose rows* do you see? |
| **Department** | `tblGroupAccess` (per menu) | *Which screens* can you open, and can you Add/Edit/Delete? |

**Why two axes and not one seniority number:** an HR Manager is senior, but must
see **zero** sales leads and **zero** support tickets — while a junior Sales
Executive sees leads the HR Manager never can. Seniority alone cannot express
that. HR is the proof case: wide scope, narrow modules.

`DataScope` resolves **relative to the user's own branch**, so a single
"Branch Manager" role serves every branch — no per-branch duplicates.

---

## Stock roles

| Role | Level | DataScope | Modules | IsAdmin |
|------|-------|-----------|---------|:---:|
| **Owner** | 1 | All | Everything | ✅ |
| **Admin** | 2 | Company | Everything + Settings | ✅ |
| **Sales Head** | 2 | Company | Sales + Sales Reports | — |
| **Support Head** | 2 | Company | Support + Support Reports | — |
| **HR Manager** | 2 | Company | Users/Teams/Projects only | — |
| **Regional Manager** | 3 | MultiBranch | Sales + Support | — |
| **Branch Manager** | 3 | Branch | Sales + Support | — |
| **Support Manager** | 3 | Branch | Support | — |
| **Sales Team Lead** | 3 | Team | Sales | — |
| **Sales Executive** | 4 | Self | Sales | — |
| **Support Agent** | 4 | Self | Support | — |

Everyone gets Dashboard + Tasks (tasks are membership-gated separately — see
below — so the menu grant is safe for every role).

A user in several groups gets their **strongest**: lowest `HierarchyLevel` wins.

---

## What each DataScope resolves to

`loadScope` middleware → `sp_FetchAccessibleBranchIds` → `req.scope`:

| DataScope | branchIds | ownerIds |
|-----------|-----------|----------|
| All / Company | every branch | *none* (no ownership filter) |
| MultiBranch | own + `tblUserBranchAccess` grants | *none* |
| Branch | own branch | *none* |
| Team | own branch | members of teams they lead, + self |
| Self | own branch | `[self]` |

---

## The rule that overrides everything

```sql
WHERE (
     ( BranchId IN @branchIds AND (@ownerIds IS NULL OR OwnerId IN @ownerIds) )
  OR AssignedTo = @UserId      -- assigned to me   -> always visible
  OR CreatedBy  = @UserId      -- I made it        -> always visible
)
```

**`OR`, not `AND`.** Assignment is an explicit act of sharing — it must beat
scope in every model. This is not a nicety: it is the bug that had Raaj holding
3 assigned tickets he could not see, because they lived in another branch.

Optional UI filters (`@BranchId`, `@OwnerId`, `@AssignedTo`) **narrow within**
what scope already allows. A filter never widens visibility.

---

## Cross-branch visibility — the design question

**Should a Mumbai admin see Delhi's tickets?**

**Where someone sits is irrelevant.** Permission comes from their *scope*, not
their desk:

- A **Company Admin** who happens to sit in Mumbai → **sees Delhi**. They are above both branches.
- A **Branch Admin** assigned to Mumbai → **does not see Delhi**. They are a peer.

Same chair, opposite answers. Visibility flows **up** the hierarchy, never
sideways. This matches how Salesforce (role hierarchy grants upward; sideways
needs an explicit sharing rule) and Zoho (records visible to owners and
superiors *in the same branch*; cross-branch is deliberate opt-in) both work.

---

## Tasks use a different model — on purpose

Tasks are **not** governed by `DataScope` or branch. They are governed by
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

**Never merge these two models.** Branch scope answers a question tasks do not
ask — that is why `sp_FetchTask` takes `@BranchId` as an optional *filter* and
ignores `@AccessibleBranchIdsJson`. It previously `AND`-ed branch scope with
membership, which meant a cross-branch workspace member saw **nothing**.

---

## `IsAdmin` is a role property, not a level

`IsAdmin` lives on `tblUserGroups`, and **only Owner and Admin have it**.

It must **never** be derived from `HierarchyLevel <= 2`. Sales Head, Support
Head and HR Manager are all level 2 — deriving the bit from level would hand
them the `sp_CheckTaskPermission` admin bypass, i.e. read/write on **every task
in every project workspace**. HR editing the sales team's sprint board.

`tblUser.IsAdmin` is derived from the user's group at login.

---

## Known-open

Tracked, deliberately not built yet:

- **Write path is ungated.** `moveLeadStage`, `transferLead`, `deleteLeads`,
  `moveTicketStage`, `resolveTicket`, `closeTicket`, `reopenTicket`,
  `deleteTicket` do not check ownership — a `Self`-scoped user can still mutate
  another user's record by posting its Id. Needs ownership checks inside the
  mutation SPs.
- **Menu rights are not enforced server-side.** No route checks
  `tblGroupAccess`; menu rights only drive sidebar visibility. The API serves
  any authenticated caller. The department axis is therefore advisory until this
  lands.
- **Login/logout are not audited.**

---

## Where things live

| Thing | Location |
|-------|----------|
| Role definitions | `tblUserGroups` (`HierarchyLevel`, `DataScope`, `IsAdmin`) |
| Menu grants | `tblGroupAccess` (`CanView/Add/Edit/Delete` per `MenuId`) |
| User → role | `tblUserGroupMap` |
| Extra branch grants | `tblUserBranchAccess` (MultiBranch only) |
| Scope resolution | `sp_FetchAccessibleBranchIds` → `middleware/permission.js` → `req.scope` |
| Task permissions | `sp_CheckTaskPermission` |
