# P1 — Task & People Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the task and people lifecycle so P2/P3 clocks measure people, not bugs — spec §4 items 1–20.

**Architecture:** One user-applied SQL script (`backend/sql/094_task_people_foundation.sql`) changes the stored procedures; the backend controllers pass the new parameters and fan out notifications; web and mobile follow one permission table mirrored from `sp_CheckTaskPermission`. Detailed task text — exact before→after SQL hunks against the live procedures, code and tests — lives in four part files; this file fixes the order, the merges and the rulings.

**Tech Stack:** SQL Server stored procedures · Express 5 + Jest/Supertest (DB mocked) · React 19 + Vitest/RTL/MSW · Expo RN TypeScript (typecheck + lint gate).

**Spec:** `docs/superpowers/specs/2026-10-07-task-tat-presence-design.md` §4 (P1). Evidence: `docs/superpowers/specs/2026-10-07-tat-audit/`.

**Parts** (read the part for every task you execute):
- **A** `2026-10-07-p1/p1-A-tasks.md` — items 1, 2, 3, 4, 5, 8, 10, 11, 15
- **B** `2026-10-07-p1/p1-B-notify.md` — items 6, 7, 9, 12
- **C** `2026-10-07-p1/p1-C-columns.md` — items 13, 14
- **D** `2026-10-07-p1/p1-D-people.md` — items 16–20

## Global Constraints

- pnpm only, never npm.
- Never apply SQL. Write `backend/sql/094_task_people_foundation.sql`; the user applies it. It starts with `SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; GO`.
- Every procedure change is `CREATE OR ALTER` built from the **live** body (`OBJECT_DEFINITION`) with the part's hunks applied — never from a part's quoted excerpt alone.
- Multi-tenancy: every query filters by `CompId`; personal workspaces stay private even from admins.
- MUI v9 `slotProps`; reuse `ui/` components; mobile only `src/ui` + lucide + tokens.
- Tests: backend `cd backend && pnpm exec jest <file>`; web `cd web && pnpm exec vitest run <file>` (one file per run; full suite only at the gates); mobile `cd mobile && pnpm typecheck && pnpm lint`. Never `.only`/`.skip`. Touched files ≥ 80% line **and** branch.
- Git: no commit, push or merge without the user's explicit order.
- Deploy: apply 094 and deploy backend **and web** back to back (part C: columns empty for non-admins on the old backend; part D: the old web user form would move edited users to the admin's branch).

## Rulings on the parts' open decisions

| Part · # | Ruling | Why |
|---|---|---|
| A·D1 | **Archive does NOT unassign.** Drop A9. Archived boards are excluded from My Work (B5) and later from the TAT sweep. | It is the only destructive case and unarchive could not restore it. |
| A·D2 | Soft-deleted tasks keep their files. | History; reads are gated by the task. |
| A·D3 | Backfill both directions (8 done cards → last column; 10044 → first). | Board = completion. |
| A·D4 | A tick-only caller's text/order are ignored, not refused. | Old mobile builds resend text. |
| A·D5 | Demoting an assignee to viewer unassigns them. | Viewers can't be assignees (item 4). |
| A·D6 + D·D6 | **One rule, one procedure, one notification shape.** `sp_UnassignInvalidAssignees` (A4) is the only unassign procedure; it also drops **inactive users**, and D's deactivation calls it with `@UserId`. Drop D's `sp_UnassignUserFromOpenTasks` (D·S1). Owners get **one notification per (owner, workspace)** with a count (D's shape), tasks left with nobody only. | Two procedures for one rule would drift. |
| A·D7–D10 | As the part recommends. | |
| B·1–4, 6–9 | As the part recommends. | |
| B·5 | My Work as a top-level menu row now (renders after Admin). Ordering is cosmetic; a `SortOrder` column is out of scope. **Flagged to the user.** | |
| C·1–6 | As the part recommends. | |
| D·1–5, 7–9 | As the part recommends, **plus** D·7 "last active admin" guard (one `NOT EXISTS`). | Cheap lock-out protection. |

## Procedures touched by more than one part — merge order inside 094

Apply the hunks in this order to the live body, in **one** `CREATE OR ALTER` per procedure:

| Procedure | Hunks, in order |
|---|---|
| `sp_SaveTask` | A16 (viewers not assignees; parent/team/project checks) → B6 (3rd result set: field diffs) |
| `sp_FetchTask` | A12 (hide deleted; Seen stamp) → B5 (`@AssigneeUserId`, `@OnlyOpen`, `@Overdue`, archived excluded when `@WorkspaceId IS NULL`) |
| `sp_RecomputeTaskCompletion` | A13 (card follows completion) → B1 (`@Transition` OUTPUT) |
| `sp_SaveTaskChecklist` | A14 (tick never renames) → B2 (`CompletionChange`) |
| `sp_DeleteTaskChecklist` | A15 (never the last step) → B2 (`CompletionChange`) |
| `sp_FetchKanbanColumn` | C·S1 + count excludes `IsDeleted = 1` tasks |
| `sp_FetchAccessibleBranchIds` | D·S4 only (admin = any active admin group) |
| `sp_SaveUser` | D·S2, deactivation branch calling `sp_UnassignInvalidAssignees @UserId` (plain `EXEC`, never inside `INSERT…EXEC`) |

Script section order: A1 schema → A2 data → A3 … A19 (minus A9) → B1–B7 → C·S1–S4 → D·S2–S7 (minus S1) → verify blocks (A20, B, C, D) commented at the end.

## Review Focus

1. **A task that was soft-deleted must vanish everywhere** — board, My Work, dependencies picker, notifications deep link (opens "This task was deleted", not a crash). Test in A12/B5 and WEB-1: deep link to a deleted task shows the not-found state.
2. **Removing someone from a workspace while they hold its only open task** — the task shows unassigned and the owner gets one notification. Test in A5 + B6 (backend): one `task_unassigned` per owner-workspace.
3. **A viewer who is assigned ticks a step** — tick saves, text unchanged; a rename attempt keeps the old text. Test in B2 (backend, part A).
4. **Editing a user without touching their branch** keeps their branch (old form sends none). Test in D·B1: absent `BranchId` on edit → SP receives NULL → unchanged.
5. **Deactivating the last active admin is refused** with a clear message. Test in D·B1 (controller passes the SP's 409 through) + verify snippet.

---

## Tasks

Each task's full steps (failing test → run → implement → run) are in the named part section. Tick here as each lands.

### Task 1 — SQL script 094
- [ ] Build `backend/sql/094_task_people_foundation.sql` per the merge table, every procedure from its live body. Header lists sections; deploy note; verify blocks commented at the end.
- [ ] Self-check: for each procedure, diff the script body against `OBJECT_DEFINITION` — only the planned hunks differ.
- [ ] Hand to the user to apply with `sqlcmd … -C -b -I`; after apply, `SELECT COUNT(*) FROM sys.sql_modules WHERE uses_quoted_identifier = 0` returns 0, and every verify block gives its expected value.

### Task 2 — Backend: tasks (part A)
- [ ] A·B1 `taskAllowed` · A·B2 tick never renames · A·B3 soft delete · A·B4 claim + route · A·B5 time entries scoped · A·B6 membership refresh. Coverage run (A·B7).

### Task 3 — Backend: notifications, My Work, history (part B)
- [ ] BE-1 completion notifications · BE-2 fetch filters · BE-3 history diffs.

### Task 4 — Backend: columns (part C)
- [ ] B-1 fetch passes `UserId` · B-2 refuse `IsActive:false` · B-3 409 contract.

### Task 5 — Backend: people (part D)
- [ ] B1 save (group required, branch, no IsAdmin, unassign fan-out) · B2 admin from `req.scope` · B3 delete 409 · B4 handover endpoint · B5 docs (ROLES.md, CLAUDE.md).
- [ ] Gate: full backend suite with coverage on every touched file ≥ 80% line and branch.

### Task 6 — Web: permission mirror (part C)
- [ ] W-1 `utils/taskAbilities.js` + table test · W-2 store gates removed · W-3 TaskBoard · W-4 TaskDetailModal · W-5 last column · W-6 MSW.

### Task 7 — Web: tasks (part A)
- [ ] W1 endpoints + MSW · W2 delete in modal · W3 last step · W4 no viewer assignees · W5 column select moves · W6 take this task.

### Task 8 — Web: notifications, My Work (part B)
- [ ] WEB-1 deep link · WEB-2 completion feedback · WEB-3 My Work page.

### Task 9 — Web: people (part D)
- [ ] W1 queries · W2 UserForm · W3 Users list.
- [ ] Gate: full web suite with coverage; touched files ≥ 80%; `pnpm lint` 0 errors; `pnpm build` passes.

### Task 10 — Mobile (parts A, B, C)
- [ ] A·M1–M4 · B·MOB-1–6 · C·M-1–M-5.
- [ ] Gate: `pnpm typecheck` + `pnpm lint` clean.

### Task 11 — Live check
- [ ] After the user applies 094 and deploys: an API script like `093`'s (password from an env var, throwaway workspaces, cleaned up) covering every item 1–20, plus the Review Focus list. Report pass/fail; no leftovers.
