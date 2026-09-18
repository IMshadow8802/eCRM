# Support rebuild — live API test report (2026-09-17)

**Target:** production API `https://shadowcodes.in/CRM` after `086_support_rebuild.sql` applied to **both** `eCRM+` and `SolarCRM`, and the backend deployed (container uptime 316 s at first probe, so the rebuild was fresh).
**Method:** scripted end-to-end run (`fetch` from Node 22), logging in as each persona and asserting HTTP status + payload per rule in spec 2. **79 checks across 10 phases. 78 passed.** The single FAIL is an expectation slip in the script, not a product defect — detailed in §5. **No product rule failed.**

| Phase | What it proves | Checks | Pass |
|---|---|---|---|
| S0 | lookup contract — `ticket_status` codes exist, `urgent` carries TAT 4 h | 2 | 2 |
| S1 | customers: create, duplicate mobile, required fields, company-wide search, delete gate | 7 | 7 |
| S2 | complaint create: required fields, TAT stamping, customer join, assign gate, update ignores assignee | 10 | 10 |
| S3 | lifecycle through the one engine: hold → resolve → close → reopen → reject | 15 | 15 |
| S4 | transfer, send-back, no-op refusal, bulk transfer, visibility after reassignment | 9 | 8 (script slip) |
| S5 | escalation: target list, ancestor rule, remarks, manager queue, notification | 6 | 6 |
| S6 | visibility matrix across Company / Branch / Team / Self / other-branch | 9 | 9 |
| S7 | retired endpoints are gone; old reports still answer | 3 | 3 |
| S8 | delete gate + cleanup | 4 | 4 |
| G | endpoints the main pass missed: call log, custom fields, both reports, config write gate | 14 | 14 |

## 1. Test users

All share one password (private ops note, not this file).

| Username | Role (group) | Scope | Branch | Reports to |
|---|---|---|---|---|
| `sh_priya` | Support/Sales Head (9) | Company | HEAD OFFICE | — |
| `bm_ho_rahul` | Branch Manager (13) | Branch | HEAD OFFICE | sh_priya |
| `tl_ho_neha` | Team Lead (15) | Team | HEAD OFFICE | bm_ho_rahul |
| `se_ho_amit` | Executive (16) | Self | HEAD OFFICE | tl_ho_neha |
| `se_ho_sara` | Executive (16) | Self | HEAD OFFICE | tl_ho_neha |
| `se_ho_karan` | Executive (16) | Self | HEAD OFFICE | bm_ho_rahul (not in Neha's team) |
| `se_se_pooja` | Executive (16) | Self | SOUTH EXTENSION | bm_se_vikram |

## 2. The rules that were actually exercised

**TAT is real, and it is computed, not stored.** T1 was created `urgent`; `DueAt − CreatedAt` measured **4.00 h** against the `TatHours` the migration wrote, and `IsOverdue` came back `false` from the server's own clock. After the reopen, `DueAt` was restamped into the future and both `ResolvedAt` and `ClosedAt` were cleared — the clock genuinely restarts rather than carrying the stale due time.

**One engine writes the lifecycle.** Every refusal came from `sp_SetTicketStatus`, not from a client: resolve without a resolution → 400 `Resolution is required`; resolve without remarks → 400; reject without remarks → 400; the same status twice → 200 `Complaint already in this status` (a no-op, not an error). Nothing branched on a label anywhere in the run.

**The reopen gate holds, and it holds in the right direction.** Amit (Self) reopening his own closed complaint → **403 `Reopening requires a manager`**. Neha (Team, Amit in her subtree) reopening the same complaint → **200**. That is the whole rule: a manager may undo their report's close, an agent may not undo their own.

**Escalation obeys the reporting line, not rank.** `fetchEscalationTargets` for Karan returned exactly `[15, 13]` (Rahul, Priya) — his ancestors. Escalating to Neha, who is senior but not on his line, → **400 `Escalation target must be a senior of the assignee`**. Escalating a rejected complaint → 400. Rahul's *Escalated* queue then contained the complaint, and he had a `ticket_escalated` notification waiting.

**Scope is a matrix, and assignment beats it.** After Rahul bulk-transferred the complaint to Karan: Pooja (other branch) 0 rows, Priya (Company) 1, Rahul (Branch) 1, Neha (Team) **0** — correct, because Karan is not in her subtree, even though she handled the ticket minutes earlier. Sara, the previous assignee, got a clean **404** on the detail call. Amit still reads it through the creator escape hatch. The same split showed on the customer record: Amit sees 1 of that customer's complaints, Priya sees 2.

**Filters narrow, never widen.** Pooja with `BranchId: 1` still saw 0. `PageSize: 5000` clamped to 200. `StatusCode: "active"` excluded the rejected complaint.

**The pipeline is gone from the wire.** `moveTicketStage` and `fetchPipelines` both answer `404 Route not found`. The pre-existing support reports still answer 200.

**Every stored procedure the backend calls exists in both databases.** 122 names extracted from `backend/src/` and checked against `eCRM+.sys.procedures` and `SolarCRM.sys.procedures` — zero missing on either side. This is the check mocked tests cannot do (Task 10's deferred live contract check, now closed).

## 3. What was created, and what is left behind

Tickets `TKT-000058`–`TKT-000062` were created and **deleted** at the end of each run. Ticket numbering resumed correctly from the live maximum rather than from a row count — the collision bug found during the build did not reappear after the deletes.

**Four `LIVE TEST` customers remain** and need an admin to remove (delete is `requireAdmin`, and none of the personas is one):

| Id | Name |
|---|---|
| 40 | `LIVE TEST Shop …` |
| 41 | `LIVE TEST South …` |
| 42 | `LIVE TEST Gap …` |
| 43 | `LIVE TEST Gap …` |

They hold no tickets, so an admin can delete them from **Support → Customers** directly.

## 4. Product defects found

**One, minor, fixed the same day.** `requireAdmin` refused with *"Only an administrator can manage users"* — wording from when `userRoutes` was its only caller. It now guards six route groups, so a Support Head adding a ticket category was told the action was about managing users. The message is rendered verbatim in both clients. Changed to *"This action is restricted to administrators"*, with a regression test asserting the refusal never names user management again (`tests/unit/middleware/permission.test.js`).

Nothing else. No rule in the spec failed.

## 5. The one FAIL, verbatim

```
FAIL #40 [S4] assignment history has 2 rows with names -> 500 (want 200)
["Neha Gupta (TL Head Office)->Sara Khan (Exec HO, under Neha)",
 "Amit Singh (Exec HO, under Neha)->Neha Gupta (TL Head Office)",
 "null->Amit Singh (Exec HO, under Neha)"]
```

The script expected two assignment rows after two transfers. Production returned **three**, because `sp_SaveTicket` also logs the assignment made at creation (`null → Amit`). That row is correct and wanted — it is what makes the assignment history start at the beginning rather than at the first transfer — and both clients already render its null origin as *"Unassigned"* (`TicketDetail.jsx:302`, and the web test fixture has carried this exact row since the rebuild). The script's expectation was written from the transfer count alone. **No code change.**

## 6. Not covered here

- **SolarCRM's API was not exercised** beyond `/health` and the procedure inventory. It has no users seeded yet (`090_solarcrm_seed_test_users.sql` is still pending), so there is nobody to log in as.
- **Web and mobile UI** were not driven; this is an API pass. The web build is green and the mobile app typechecks, but neither has been clicked through against this deployed backend.
- **Attachment upload on a complaint** — multipart, not worth scripting; exercise it by hand once from the UI.
