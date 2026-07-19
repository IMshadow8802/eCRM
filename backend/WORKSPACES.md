# Tasks & Workspaces — Model, Gaps, Roadmap

How the task/workspace module works, what's broken or missing (researched
2026-07-19 against Notion / Asana / Trello / ClickUp), and the agreed build
order. Permission details live in `ROLES.md`.

---

## 1. The model today

| Type | Membership | Privacy |
|------|-----------|---------|
| **personal** | owner only, auto-seeded at first login (`sp_SeedDefaultWorkspace`) | private **even from admins** |
| **shared** | owner invites users; invite must be accepted (`pending` → `active`) | members only, admin bypass |
| **project** | snapshot of the linked project's team at creation | members only, admin bypass |

- Roles per member: `owner / manager / member / viewer` — per-action matrix in
  `sp_CheckTaskPermission` (see ROLES.md).
- Tasks are **membership-governed, never branch/scope-governed**. Branch is an
  optional narrowing filter in `sp_FetchTask` — never pass the caller's own
  BranchId as a visibility gate (that bug hid cross-branch workspaces from
  their own members twice).
- Completion is derived from the checklist; `IsDone` is retired.
- **Archive** = `IsArchived = 1` flag only. Nothing is deleted; the workspace
  just drops out of `sp_FetchWorkspaces` (web always sends
  `IncludeArchived: false`).

## 2. Workspace lifecycle — decisions from research

### Personal → shared conversion (MISSING, agreed direction)
`sp_SaveWorkspace`'s update path never touches `Type` — conversion is
impossible today. Industry: Notion/Asana have no "convert" button; **sharing
is the conversion** (invite someone → page becomes shared; privacy is a dial).

Build as: **"Share this workspace"** on a personal workspace → pick colleagues
→ flips `Type='shared'` + writes pending invites. Must warn loudly: *every*
existing task becomes visible to invitees. Reverse direction (shared →
personal) is deliberately out of scope — kicking members who own tasks is a
mess; Notion allows it, we don't need it.

### Deletion (MISSING, agreed direction)
No delete SP/endpoint/UI exists — archive is the only removal. Industry:
Trello = **two-step** (close/archive first; only a closed board can be
permanently deleted, with an irreversible warning). ClickUp = 30-day trash.

Build as Trello: **delete only from the archived state**, confirm shows the
blast radius ("14 tasks, 32 comments, 6 attachments — cannot be undone"),
typed name for non-empty workspaces. Cascade: tasks → checklists, comments,
dependencies, time entries, reads, attachments (**files on disk via the
attachment cascade**), members, kanban columns. Owner-or-admin, with the
personal-workspace carve-out (nobody deletes someone else's personal
workspace, admin included). Skip a trash window — archive-first already
provides the "oops" recovery at our scale.

### Archive UX (half-built)
- No confirm dialog (users think archive = delete; it isn't).
- **No Archived section / unarchive UI anywhere** — archive is currently a
  one-way door; recovery is SQL by hand.
- `sp_ArchiveWorkspace` allows unarchive for **admins only** — the owner who
  archived can't undo themselves. Loosen to owner-or-admin when the UI lands.

## 3. Known bugs (2026-07-19)

| Bug | Root cause | Status |
|-----|-----------|--------|
| **Duplicate personal workspace after unarchive** | `sp_SeedDefaultWorkspace` checked `IsArchived = 0`, so login while your personal workspace was archived seeded an empty twin | **Fix in `sql/047`** (seed check ignores archive + deletes the dup) |
| **Image upload fails in prod** | nginx `CRM.conf` has no `client_max_body_size` → default 1 MB cap → 413 on anything bigger, long before multer's 50 MB limit | User-run nginx fix (below) |
| **Toasts hidden behind modals** | notistack container defaults to z-index 1400 = our modal layer; the `zIndex` set via SnackbarProvider's `style` prop only styles items *inside* the container | **Fixed**: `.notistack-SnackbarContainer { z-index: 1700 }` in `index.css` (tokens.zIndex.toast) |
| Workspace update has **no permission check** | `sp_SaveWorkspace` update path takes no acting user; controller doesn't gate — any logged-in user can rename any workspace by Id | Open — part of write-path gating |
| Project workspace members are a snapshot | team changes after creation never sync | Open (design decision needed: sync vs snapshot) |

### nginx upload fix (user-run, on `myserver`)

```bash
# add inside the location block of the CRM proxy conf
sed -i 's|proxy_pass http://127.0.0.1:5001/;|proxy_pass http://127.0.0.1:5001/;\n    client_max_body_size 50m;|' \
  /www/server/panel/vhost/nginx/proxy/shadowcodes.in/CRM.conf
nginx -t && nginx -s reload
```

Verify: upload an image > 1 MB from the app. If *small* images also fail, the
cause is something else — check the browser devtools response code.

## 4. Build order (agreed)

1. **Share-a-personal-workspace** (conversion via invite + loud confirm)
2. **Archive UX**: confirm dialog, Archived section, unarchive (owner-or-admin)
3. **Delete**: archived-only, blast-radius confirm, full cascade
4. **Workspace-update permission gating** rides with whichever lands first

## 5. Deferred / nice-to-have

Notifications & due-date reminders (long-deferred), recurring tasks, calendar
view, cross-workspace "My Tasks" view, task-board branch filter dropdown.
