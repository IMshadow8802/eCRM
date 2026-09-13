# Sales foundation — live API test report (2026-09-09)

**Target:** production API `https://shadowcodes.in/CRM` after `071`–`074` applied and backend `eec3a36` deployed.
**Method:** scripted end-to-end run (`fetch` from Node 22) logging in as each persona and asserting HTTP status + payload per rule in the spec. 194 checks across 5 phases; every request/response is in the run log. Three "fails" were expectation slips in the script, not product defects (listed below). **No product rule failed.**

| Phase | Checks | Pass |
|---|---|---|
| P1 users, hierarchy rules, products | 31 | 30 (1 script bug — see notes) |
| P1b reporting chain, loop refusal, rosters | 18 | 18 |
| P2 branch-1 leads, follow-ups, statuses, transfers, negatives | 52 | 51 (404 vs 400 nuance) |
| P3 visibility matrix, presets, queues, reports | 53 | 52 (pre-existing lead in Overdue — correct) |
| P4 cross-branch, MultiBranch grant, per-branch reports | 40 | 40 |

## 1. Test users (all share one password — see the private ops note, not this file)

| Username | Role (group) | Scope | Branch | Reports to |
|---|---|---|---|---|
| `sh_priya` | Sales Head (9) | Company | HEAD OFFICE | — |
| `rm_arjun` | Regional Manager (12) | MultiBranch | HEAD OFFICE (+ SOUTH EXT granted) | sh_priya |
| `bm_ho_rahul` | Branch Manager (13) | Branch | HEAD OFFICE | sh_priya |
| `tl_ho_neha` | Sales Team Lead (15) | Team | HEAD OFFICE | bm_ho_rahul |
| `se_ho_amit` | Sales Executive (16) | Self | HEAD OFFICE | tl_ho_neha |
| `se_ho_sara` | Sales Executive (16) | Self | HEAD OFFICE | tl_ho_neha |
| `se_ho_karan` | Sales Executive (16) | Self | HEAD OFFICE | bm_ho_rahul (not in Neha's team) |
| `bm_se_vikram` | Branch Manager (13) | Branch | SOUTH EXTENSION | sh_priya |
| `se_se_pooja` | Sales Executive (16) | Self | SOUTH EXTENSION | bm_se_vikram |
| `se_se_dev` | Sales Executive (16) | Self | SOUTH EXTENSION | bm_se_vikram |

Existing: `Ayush` (Owner, All). Products created: Gold Chain 22K (₹85,000, 12 %), Diamond Ring Solitaire (₹150,000, 25 %), Silver Anklet (₹4,500, 30 %), Platinum Band (₹60,000, 18 %, created by Sales Head).

## 2. Seeded leads — final state

| Lead | Branch | Status | Owner | Creator | History |
|---|---|---|---|---|---|
| A1 | HO | Qualified | amit | amit | follow-up done (call, connected, 7 min) → visit scheduled +3d |
| A2 | HO | Follow-up | neha | amit | first follow-up skipped w/ remarks; extra meeting deleted; sent back to manager |
| A3 | HO | New | sara | amit | Neha transferred Amit → Sara (Overloaded) |
| A4 | SOUTH EXT | New | dev | amit | Priya bulk-moved cross-branch (Reassigned by manager) |
| S1 | HO | Lost (Price) | sara | sara | Neha logged Sara's follow-up, next call +1d |
| S2 | HO | New | karan | sara | overdue (first follow-up 2 days ago); Rahul bulk → Karan (Absent) |
| K1 | SOUTH EXT | New | pooja | karan | Rahul unassigned it, then cross-branch → Pooja (Wrong branch) |
| K2 | SOUTH EXT | Junk | — (unassigned) | karan | Rahul moved to branch 2 leaving it unassigned |
| N1 | HO | New | amit | neha | TL assigned to Amit on create |
| N2 | SOUTH EXT | New | dev | neha | Priya bulk cross-branch |
| R1 | HO | New | rahul | rahul | created unassigned → Vikram @ SE (Wrong branch) → back to Rahul @ HO |
| R2, R3 | HO | New | karan | rahul | R3 bulk → Karan (Absent) |
| P1 | HO | New | rahul | sh_priya | Sales Head assigned to BM |
| SE1, SE2, SE4 | SOUTH EXT | New | pooja | pooja / vikram | — |
| SE3 | SOUTH EXT | New | dev | dev | — |

19 leads, 22 follow-ups (16 open), 30 assignment rows.

## 3. What each persona sees (verified by `fetchLeads` + detail 404s)

- **Owner / Sales Head / Admin** (All/Company): every lead, every branch.
- **Regional Manager** (MultiBranch): own branch only until Ayush granted branch-2 access; then both (15 → 19 rows).
- **Branch Manager HO** (Branch): every HO lead incl. unassigned; **no** SOUTH EXT lead (404 on detail). Keeps a lead he *created* even after it moved branches (R1).
- **Branch Manager SE** (Branch): SE leads + the four moved in; cannot open A1 (404).
- **Team Lead Neha** (Team = self + Amit + Sara): 7 leads — theirs plus her own creations. Cannot open Karan's leads (404) or an unassigned HO lead (404). Still opens N2 after it moved to SE (creator rule).
- **Executives** (Self): only owned or created. Amit: 5; Sara: 3; Karan: 5 (incl. K1/K2 now in SE — creator rule); Pooja: 4; Dev: 3. Filters never widen (Amit + `OwnerId=Karan` → 0 rows).
- **Presets**: Unassigned (Rahul: K1,R1 → later Vikram: K2), Overdue (S2 + pre-existing lead 1), Lost (S1), Mine (Neha: A2,A4,N2), Qualified filter (A1), Product filter (A2,K2), search.
- **Follow-up queues** (Today/Overdue/Upcoming/All) respect the same scope; assignee-of-follow-up can act even outside owner scope.

## 4. Rules exercised — all enforced server-side

- Reports-To: self-report 400; loop 400 (`amit→neha→rahul→priya→amit`); non-admin `saveUser` 403.
- Products: write needs level ≤ 2 (exec 403, Sales Head 200); margin > 100 → 400; duplicate name → 409; read open to all.
- Lead create: owner must be in caller's roster (exec → Karan 403; exec → own manager 200; BM SE → Amit 403); Name/Mobile required; auto first follow-up due on `FirstFollowupAt`.
- Follow-ups: complete/skip without remarks 400; complete twice 409; delete done 409; bad Type 400; other exec's follow-up 403; team lead over the assignee 200; `AssignedTo` outside roster 403.
- Status: Lost without reason 400; Lost with reason 200; Junk 200; invisible lead 403; wrong lookup kind 404.
- Transfer: reason + remarks mandatory (400 ×2); target outside roster 403; Self cannot unassign 403 ("Only a manager…"); send-back-to-manager 200; Branch unassign 200; bulk all-or-nothing 403 when one lead is out of scope; bulk empty 400; bulk 2/2 transferred.
- Cross-branch: Team/Self 403 ("Only a branch manager or above…"); cross-branch target must be in the *target* branch roster (Karan @ branch 2 → 403); BM → other branch 200 (assigned or unassigned); Sales Head bulk cross-branch 2/2; send back 200; branch label updates; assignment history records reason names.
- Reports: `leadsByStatus` per branch (Vikram: 8 leads, Priya: 19, Priya+`BranchId=2`: 8); `conversionBySource`, `callsPerUser`, dashboard all scope by branch.

## 5. Findings

**Defects / gaps**
1. **Owner cannot create a user in another branch.** `userController.save` and `sp_SaveUser` stamp the *caller's* `BranchId`; `UserForm` has no branch field. `074` (test-data SQL) was needed to place Vikram/Pooja/Dev in SOUTH EXTENSION. Fix: accept `BranchId` in `saveUser` for admins + a Branch select in `UserForm` (edit path already leaves branch untouched).
2. **Report endpoints scope by branch only.** A Team lead or Self exec calling `leadsByStatus` / `callsPerUser` / `conversionBySource` / `getDashboard` gets whole-branch numbers (Amit saw New=11 like Rahul). Executives have no Reports menu, but Team Leads and Branch Managers do — a TL sees her branch's totals, not her team's. Fix in spec 4: pass `OwnerIdsJson` to the report SPs (same predicate `sp_FetchLeads` uses).

**Observations (not defects)**
3. Assignable rosters are scope-based, not department-based: Admin `Aman`, `Super`, `Raaj`, and Task Collaborators appear as transfer targets. Consider limiting to sales groups.
4. `setLeadStatus` with a lookup id of another kind returns 404 "Status not found" (400 would read better).
5. Unassigning a lead clears `AssignedTo` on its open follow-ups (K1 now carries two unassigned open follow-ups); the queue has no "Unassigned" view, so only managers see them via lead detail.
6. Creating an unassigned lead writes no assignment row — history starts at the first assignment (R1 shows 2 rows after 2 moves).
7. Pre-existing lead `Test` (Id 1, pre-`071`) shows in the Overdue preset with no follow-up to log — stale `NextFollowupDate`; safe to delete or give it a follow-up.
8. Script slips (not product): create response key is `userId` (lowercase) — first pass sent `ReportsTo` null; fixed and re-run (P1b).

## 6. Post-test state / next steps
- `backend/sql/071`–`074` are all applied and verified. Delete on your word (§0.2).
- Test data stays in prod for your UI walkthrough: log in as any user above with the shared test password.
- Findings 1–2 are small backend changes; say the word and they go on the queue.
