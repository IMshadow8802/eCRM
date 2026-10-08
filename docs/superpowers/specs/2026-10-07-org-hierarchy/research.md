# Organisation + access model — how the big CRMs do it, and a simple version for Nexus CRM

Researched 2026-10-07. Claims marked **[K]** are from prior knowledge and were not re-verified against a live page in this pass; everything else comes from the linked source.

---

## 0. TL;DR

Every serious CRM separates the same four things, and none of them collapses them into one "seniority level":

| Axis | Question it answers | Salesforce | Dynamics 365 | Zoho | Odoo | HubSpot / Freshsales / LeadSquared |
|---|---|---|---|---|---|---|
| **Structure** (org-unit tree) | Where does a record/user *live*? | (none native; roles + territories stand in) | **Business Units** (tree) | (none; roles + territories) | **Companies → Branches** (tree, multi-level) | Teams (HubSpot, nestable) · Territories (Freshsales) · Sales Groups (LSQ) |
| **Capability** (what you may do, per module) | Can I open Leads? Create? Delete? Export? | **Profile + Permission Sets** (object CRUD) | **Security role** privileges (Create/Read/Write/Delete/Assign/Share… per table) | **Profiles** (module CRUD) | **Groups** (ACLs per model) | Permission sets / roles / permission templates |
| **Reach** (which records) | Mine? My unit? My unit + below? Everything? | **OWD** (Private / Public Read Only / Public Read/Write) + sharing rules | **Access level per privilege**: User / Business Unit / Parent:Child BU / Organization | Default access (Private / Public…) + sharing rules | **Record rules** (domain filters) + allowed companies | HubSpot: Own / Team / All · Freshsales "Scope": Owned / Territory / Global |
| **People hierarchy** | Does my manager see my stuff? | **Role hierarchy** ("Grant Access Using Hierarchies") | **Hierarchy security** (Manager or Position, with Depth) | **Role hierarchy** (+ peer visibility toggle) | (none built-in; rules can reference it) | LSQ "Reporting Manager Hierarchy"; HubSpot via teams |
| **Field** | Can I see salary / rate? | **Field-Level Security** | **Field security profiles** | **Field permissions** per profile | field `groups=` attribute | Freshsales field permissions (Editable/Read-only/Hidden) |

**How they combine — universally: union of grants, most-permissive wins, but *capability* is a hard gate.**
You see a record if *any* path grants it (owner, hierarchy, unit scope, sharing rule, team, explicit share). But you can only act on a *module* if your role/profile grants that module at all. Reach widens, capability gates. Field security is applied last, on top of whatever records you got.

---

## 1. Salesforce

- **Org-wide defaults (OWD)** set the *baseline* per object: Private, Public Read Only, Public Read/Write (plus Controlled by Parent). Everything else can only **open up** from that baseline, never restrict. [Trailhead — record access](https://trailhead.salesforce.com/data_security/data_security_records), [Sharing cheat sheet](https://developer.salesforce.com/docs/atlas.en-us.194.0.salesforce_sharing_cheatsheet.meta/salesforce_sharing_cheatsheet/sharing_cheatsheet.htm)
- **Role hierarchy**: users above a record owner automatically get access. "Grant Access Using Hierarchies" is on by default and can only be turned off for custom objects; when off, only the owner and OWD grant access. [Trailhead — roles](https://trailhead.salesforce.com/modules/data_security/units/data_security_roles)
- **Sharing rules** (owner-based or criteria-based), manual sharing, teams — all additive. [K]
- **Profiles + Permission Sets** = capability (object CRUD, "View All/Modify All", system perms). Salesforce is moving all permissions to permission sets and treating profiles as minimal. [K]
- **Field-Level Security** is set per profile/permission set: visible / read-only / hidden; it applies regardless of record access. [K]
- **Enterprise Territory Management (ETM)**: a *second* hierarchy for accounts. A user has one role but can be in many territories; an account can be in many territories; access goes to all users in the territory and those above it in the *territory* hierarchy. Closed deals stay with the territory, not the person — helps historical reporting when people move. [Mastering Salesforce CRM Administration — role vs territory](https://oreilly.com/library/view/mastering-salesforce-crm/9781786463180/ch03s02.html), [Salesforce Admins — ETM](https://admin.salesforce.com/?p=186465)

**Documented pitfalls**
- "Role hierarchies don't have to match your org chart" — each role should represent a *level of data access*; creating a role per job title is the classic mistake. Keep it ≤ ~10 levels; delete sharing rules that duplicate what the hierarchy already grants. [Salesforce Admins — "Help! My Role Hierarchy is a Mess"](https://admin.salesforce.com/blog/2017/help-my-role-hierarchy-is-a-mess), [Sharing architecture guide](https://developer.salesforce.com/page/A_Guide_to_Sharing_Architecture), [Architect — platform sharing](https://architect.salesforce.com/fundamentals/platform-sharing-architecture)
- Role changes recalculate sharing for everything the user owns ("group membership locking", slow); test in sandbox.
- ETM is heavy (practitioner reports of 6–12 month projects; can't revert to plain role model) — confusion between "role = who you report to" and "territory = which customers" is the most common design error. [Clari community thread](https://community.clari.com/best-practices-learnings-wins-tips-70/when-to-move-to-enterprise-territory-management-511)

## 2. Microsoft Dynamics 365 / Dataverse

- **Business Units (BU)** form a tree; every user and every user-owned record belongs to exactly one BU. Roles defined at the root are inherited by all BUs. [Create/edit business units](https://learn.microsoft.com/power-platform/admin/create-edit-business-units)
- **Security role** = privileges (Create, Read, Write, Delete, Append, Append To, Assign, Share) × **access level** per table:
  - **User** — records I own, records shared with me or a team I'm on
  - **Business Unit** — records in my BU
  - **Parent: Child Business Units** — my BU and everything below it
  - **Organization** — everything
  - **None**
  [Security roles and privileges](https://learn.microsoft.com/en-us/previous-versions/dynamicscrm-2016/administering-dynamics-365/dn531090(v=crm.8)), [Role-based security](https://technet.microsoft.com/library/gg334717.aspx)
  This is the single cleanest model of the lot: **one enum, applied relative to the user's own place in the tree**, and it can differ per module (Read=Org on Accounts but Write=User; None on HR tables).
- **Teams**: owner teams (own records, carry roles) and access teams (record-level sharing lists). [K]
- **Hierarchy security**: optional overlay; **Manager hierarchy** (uses the user's Manager field) or **Position hierarchy** (crosses BUs). A **Depth** setting limits how many levels down a manager reaches; managers get read on reports' data (write within their own BU). [Hierarchy security](https://learn.microsoft.com/en-us/previous-versions/dynamicscrm-2015/deployment-administrators-guide/dn832142(v=crm.7)), [Carl de Souza explainer](https://carldesouza.com/dynamics-365-hierarchical-security/)
- **Field security profiles**: per-column Read/Create/Update, granted to users/teams; secured columns are hidden for everyone else, including admins unless added. [K]
- Combination: **union** of all roles a user holds (own + team roles); highest access level wins per privilege. [K]

**Documented pitfalls**
- Changing a user's BU historically **stripped all their security roles** and **moved their owned records to the new BU** — the classic "user transferred branch and everyone lost access to their old leads / the user lost all access" incident. Since 2021 wave 2 there are switches: `DoNotRemoveRolesOnChangeBusinessUnit` (default false → roles removed) and `AlwaysMoveRecordToOwnerBusinessUnit` (default true → records follow user), plus "record ownership across business units". [Nishant Rana — change BU without removing roles](https://nishantrana.me/2022/01/05/how-to-change-users-business-unit-without-removing-the-security-roles-in-dynamics-365-powerapps-enableownershipacrossbusinessunits-setting/), [Inogic — 2021 wave 2 changes](https://www.inogic.com/blog/2021/11/2021-release-wave-2-updates-to-business-units-security-roles-and-users-in-dynamics-365-crm-and-dataverse/)
  → **Lesson for us: a record's branch must be its own column, not derived from the owner, and moving a user must not silently move or orphan records.**
- Deep BU trees used as an org chart create role-maintenance overhead; Microsoft's guidance is to use BUs for *data segregation boundaries* only and use teams/hierarchy for the rest. [K]

## 3. Zoho CRM

- Three privacy controls: **Default (org-wide) access** per module, **Role hierarchy**, **Data sharing rules**. [Role management](https://help.zoho.com/portal/kb/articles/role-management-introduction), [Marks Group summary](https://marksgroup.net/?p=77111)
- Higher roles always see lower roles' records; **peers in the same role do NOT see each other's data by default** — "Share Data with Peers" is a per-role toggle. Sharing rules don't flow up to superiors unless "Superiors Allowed" is ticked. [Role management (NextGen)](https://help.zoho.com/portal/en/kb/crm-nextgen/security-control/role-management/articles/nextgen-role-management-introduction)
- **Profiles** = module CRUD + feature permissions; **field permissions** per profile (read/write/hidden). Zoho explicitly keeps roles (who sees) and profiles (what they can do) separate. [CodeStringers — data sharing vs FLS](https://www.codestringers.com/articles/zoho-crm-data-sharing-vs-field-level-security)
- **Territory management** (Enterprise+): territory tree, rule-based assignment of accounts/deals, managers of a parent territory see child territories. [K]

## 4. Odoo

- **Companies with branches**: a company can have branches, a branch can have branches → multi-level tree. Branches inherit accounting settings from the parent; a parent can never be converted into a branch later. [Odoo docs — Companies / Branches](https://www.odoo.com/documentation/19.0/applications/general/companies.html)
- Users get **allowed companies** (multi-select) + a current company switcher; records carry `company_id`; **record rules** (domain filters, e.g. `company_id in company_ids`) enforce it globally. [Multi-company guidelines](https://www.odoo.com/documentation/17.0/developer/howtos/company.html)
- **Groups** grant model ACLs (read/write/create/unlink) and are cumulative; record rules from groups are OR'ed together, global rules are AND'ed. Sales app ships three levels: "Own documents only", "All documents", "Administrator" — the canonical SME reach ladder. [K]
- Field-level: fields can be restricted with `groups="…"`. [K]
- Lesson: Odoo makes the *tree* and the *allowed-set* the same concept — a user is given a set of nodes; selecting a parent includes its branches.

## 5. Briefly: Freshsales, HubSpot, LeadSquared

- **Freshsales**: "**Roles**" = what you can do (5 stock roles: Restricted user, User, Manager, Admin, Account Admin); "**Scope**" = which records (owned / territory / global). **Territory hierarchy**: parent territory managers see child territories. Field permissions per role: Editable / Read-only / Hidden. [Manage permissions & data access](https://support.freshsales.io/support/solutions/articles/216843-how-to-manage-user-permission-and-data-access-in-freshsales), [Territory hierarchy](https://crmsupport.freshworks.com/support/solutions/articles/50000009235-what-is-territory-hierarchy-and-how-can-i-enable-it-), [Field permissions](https://support.freshsales.io/support/solutions/articles/50000000666-how-to-configure-field-permissions-for-roles-in-freshsales-)
- **HubSpot**: per object, access = **All records / Records their team owns / Records they own / None**, separately for View/Edit/Delete. Teams can be nested (parent/child teams); "team" access includes child teams. Field-level property permissions on Enterprise. [User permissions guide](https://knowledge.hubspot.com/settings/hubspot-user-permissions-guide)
- **LeadSquared** (Indian, closest to our market): **Sales Groups** segregate users by location/business unit with view/modify permissions inside the group; **permission templates** control what's visible including which users appear in owner drop-downs; an alternative **Reporting Manager Hierarchy** mode makes access follow the reporting chain instead of groups — the two are mutually exclusive, and the docs' own troubleshooting says "manager can't see subordinates' leads" is usually because the wrong one is on. [Sales Groups](https://help.leadsquared.com/access-control-sales-users-groups/), [Permission templates — user drop-downs](https://help.leadsquared.com/permission-templates-control-users-shown-user-owner-drop-fields/), [User management guide](https://help.leadsquared.com/user-management-feature-guide/)

---

## 6. Synthesis

### 6.1 The four axes, and how they combine

1. **Structure** — a tree of org units (Dynamics BU, Odoo company/branch, Freshsales territory, HubSpot nested teams). Every user has a *home* unit; every record carries a unit **stamped on the record**, not looked up through the owner.
2. **Capability** — per module × action (view/add/edit/delete/+assign/export). It is a **gate**: if HR has no Leads capability, no amount of reach shows them leads. *This is exactly the axis Nexus has but does not enforce server-side.*
3. **Reach** — an enum evaluated *relative to the user's home unit*: Own → Team → Unit → Unit+descendants → Organization. Dynamics stores it **per privilege per module**; HubSpot per object; Freshsales once per user; Odoo once per app.
4. **People hierarchy** — manager sees reports (Salesforce/Zoho always; Dynamics optional with depth; LSQ alternative mode). Usually **read-only** upward visibility.

**Combination rule (all vendors):** `canSee(record) = hasCapability(module, 'view') AND (isOwnerOrAssignee OR inReach OR inManagerChain OR explicitlyShared)`. Grants are OR'ed; most permissive wins; capability is AND'ed in front; field security filters the columns afterwards. Nobody lets a filter or a hierarchy *reduce* access below the baseline — restriction comes only from the baseline being low (Salesforce OWD Private; Dynamics User level).

### 6.2 Scenario table

| Scenario | Salesforce | Dynamics | Zoho | Odoo | Common answer |
|---|---|---|---|---|---|
| **Tiny single office, zero config** | One role tier, OWD Public R/W | Root BU only, stock roles at Org level | Default roles CEO/Manager | One company, Sales "All documents" | One root unit auto-created; stock roles; nothing to configure |
| **Deep tree HO → Region → Branch** | Role hierarchy or ETM | BU tree + Parent:Child level | Territories | Company → branch → branch | Unit tree with `ParentId`; "Unit+below" reach |
| **Cross-branch manager** (2 regions not under one parent) | Multiple territories / sharing rule | Position hierarchy or 2nd team/role | Sharing rule | Multi-select allowed companies | Extra **unit grants** on the user (a list), each expanding to its subtree |
| **Dept head must not see other depts** | Profile has no object access | Role privilege = None on that table | Profile module off | Not in group → no ACL | **Capability gate per module, enforced server-side** — not reach |
| **Salary / rate hidden** | FLS | Field security profile | Field permissions | `groups=` on field | A small "sensitive field" permission; API strips the column |
| **Admins** | "View All Data"/"Modify All Data" perm | System Administrator role (Org on everything) | Administrator profile | Settings group | A role flag; bypass reach, but still audited; personal workspaces stay private (our rule) |

### 6.3 Pitfalls worth copying the lessons from
- **Org chart ≠ access model** (Salesforce). Roles describe access, not job titles. Keep the tree shallow.
- **Moving a user moves/orphans records** (Dynamics). Stamp the unit on the record; moving a user changes their reach, not record ownership.
- **Two competing hierarchies** (Salesforce role vs territory; LSQ groups vs reporting manager). Pick one structure tree; the manager chain is a *small* overlay, not a second org model.
- **One seniority ladder can't express departments** (Nexus's own HR-Manager-with-Company-scope bug). Capability and reach must be independent.
- **Peer visibility surprises** (Zoho: same-role peers don't see each other by default). Make "Team" explicit.
- **Sidebar-only permissions** are not permissions. All five vendors enforce capability at the API/data layer.

---

## 7. Recommendation — the simple version for Nexus CRM

Fewest concepts that span a 5-person office to a multi-HO group: **Unit tree, Role, Reach, Manager chain, plus two always-on rules.** Essentially Dynamics' access levels on Odoo's branch tree, with HubSpot's per-module simplicity.

### 7.1 Concepts / tables

1. **Units = branches with a parent.** Add `tblBranch.ParentId NULL` (NULL = top). That's the whole structure axis — a head office is just a unit with children; a region is a unit with no address that has children. No separate "region" or "HO" type needed (optional `Kind` label for display only). Tiny client: one unit, auto-created, never shown.
   - Store a materialised path or closure (`tblBranchClosure(AncestorId, DescendantId)`) maintained by `sp_SaveBranch` so "unit + below" is one join. Forbid cycles.
2. **User home unit** = existing `tblUser.BranchId`. **Extra unit grants** = existing MultiBranch per-user list, but each grant now **means that unit and everything below it**. This replaces the separate `MultiBranch` enum value.
3. **Role (= group)** keeps two things, both per module (Leads, Customers, Complaints, Quotations, Tasks-admin, Users, Reports, Settings):
   - **Capability**: View / Add / Edit / Delete (existing `tblGroupAccess` rows) — **now enforced server-side** by a `requireMenu('leads','edit')` middleware on every route. No row / CanView=0 = the module does not exist for that user: 403 + empty lists. This alone fixes HR reading sales/support.
   - **Reach** (one enum per role *per module*, column on `tblGroupAccess`): `Own` · `Team` · `Unit` · `UnitTree` · `All`.
     - `Own` = owned/assigned/created by me
     - `Team` = Own + my `ReportsTo` subtree
     - `Unit` = records stamped with my home unit (+ extra grants, exact)
     - `UnitTree` = my home unit and all descendants (+ extra grants, each with descendants)
     - `All` = whole company
     Per-module reach lets a Support Head be `UnitTree` on Complaints but have no Leads capability at all, and lets a Branch Manager be `Unit` on leads but `All` on the Customer master (dedupe). If per-module is too much UI, default every module to the role's single reach and expose override only in an "advanced" panel.
4. **Manager chain** (`ReportsTo`) stays, used only by `Team` and by escalation. Read+act on subtree, as today. Optional Dynamics-style depth is YAGNI.
5. **Record unit** — every lead/complaint/customer carries `BranchId` stamped at create (already true for leads/tickets). Transferring a user never rewrites it; transferring a *record* (`sp_TransferLead`) may restamp to the new owner's unit — explicit, logged.
6. **Sensitive fields** — one capability, not a field-security engine: a pseudo-module `People.Sensitive` (View) in `tblGroupAccess`. Without it, the users API returns only name, avatar, unit, role for colleagues; `HourlyRate`, mobile, email, salary-ish columns are stripped **in the controller/SP**, not hidden in the UI. You always see your own. Add more pseudo-modules only when a second sensitive field appears.

### 7.2 Combination rule (one predicate, used by every fetch SP)

```
visible = hasCapability(module,'view')
      AND ( OwnerId = me OR AssignedTo = me OR CreatedBy = me     -- always wins (existing rule)
            OR EscalatedTo = me                                     -- complaints
            OR inReach(record.BranchId, record.OwnerId, myReach) )
```
- Capability is AND'ed in front — **including for the "assigned to me" path**? Recommend: yes for module access (an HR user with no Complaints module simply has no Complaints screen), but assignment implies the assignee had capability when assigned — `assertCanAssign` should refuse an assignee lacking the module.
- Grants OR'ed, most permissive wins; filters (`@BranchId`, `@OwnerId`) only narrow.
- Write actions: same predicate + `CanEdit`/`CanDelete`; ownership-moving actions additionally need reach over the *target* user (existing `assertCanAssign`).
- **Admin** = role flag `IsAdmin` (Owner/Admin only, unchanged): reach = All on everything, all capabilities, sees sensitive fields. Never bypasses personal workspaces. Never derived from a level.
- **Tasks/workspaces stay membership-governed**, outside this model (unchanged).

### 7.3 Defaults (zero-config tiny client)

- One unit ("Head Office"), created with the company. Units screen hidden until a second unit exists.
- Stock roles (seeded, editable):

| Role | Leads | Customers | Complaints | Quotes | Users | Reports | Sensitive |
|---|---|---|---|---|---|---|---|
| Owner / Admin | All, full | All | All | All | All, full | yes | yes |
| Sales Head | UnitTree | All (view) | — | UnitTree | view | Sales | no |
| Support Head | — | All (view) | UnitTree | — | view | Support | no |
| HR Manager | — | — | — | — | UnitTree, full | — | yes |
| Branch Manager | Unit | All (view) | Unit | Unit | view | yes | no |
| Team Lead | Team | All (view) | Team | Team | view | own team | no |
| Executive / Agent | Own | All (view) | Own | Own | — (name list only) | — | no |

  A regional manager is just "Branch Manager" with reach `UnitTree` homed on the region unit — **no MultiBranch role needed**; a cross-region manager gets extra unit grants.
- On a single-unit company `Unit`, `UnitTree` and `All` coincide, so the stock roles just work.

### 7.4 What this deliberately does NOT add (and when to)
- No sharing rules / manual record sharing → assignment + extra unit grants cover it. Add when a client asks for "share this one lead with X" repeatedly.
- No territories distinct from units → a unit *is* the territory. Add only if one customer must sit in two territories.
- No position hierarchy, no hierarchy depth, no per-field matrix, no access teams.
- No permission sets / multiple roles per user → one role per user; extra unit grants handle the "also covers Pune" case. Add multi-role only if role explosion appears (watch for >15 custom roles in one tenant).

### 7.5 Migration from today (sketch)
- `ParentId` NULL for every existing branch (flat tree = today's behaviour).
- DataScope → reach: Self→Own, Team→Team, Branch→Unit, MultiBranch→Unit (+ existing grants), Company→All, All→All; copy into every module row of the group.
- Turn on server-side capability enforcement module by module, behind the existing `tblGroupAccess` rows (they already exist for the sidebar), HR first.
- Strip sensitive columns from `sp_FetchUsers` output for callers without `People.Sensitive`.
