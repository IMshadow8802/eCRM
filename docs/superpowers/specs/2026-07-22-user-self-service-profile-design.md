# User self-service profile + multi-identifier login — design

Date: 2026-07-22

## Goal
Let users manage their own account: **change password**, **edit display name**,
**pick an avatar**. Plus **log in with username OR email OR mobile**. Username
itself stays admin-controlled and globally unique.

## Decisions (settled with the user)
- **Username is fixed & final** — admin-only, never user-editable. A **duplicate
  guard blocks even admins** from creating one.
- **Display name = the existing `FullName`**, now user-editable. No new
  `DisplayName` column — `FullName` already propagates to every feed (comments,
  history, board) through the existing SPs, so editing it is the lazy-correct
  win. No SP sweep for names.
- **Avatar** = a preset chosen from **bundled** assets (lucide/heroicons icons +
  color, or emoji) — no new dependency, no image upload. Stored as one compact
  string in a new `Avatar` column (e.g. `"icon:rocket|violet"` or `"emoji:🚀"`).
- **Avatar shows everywhere** (feeds included) — but via **client-side lookup**,
  not an SP sweep: feed rows already carry `UserId`, so the web resolves avatar
  from a cached company user directory. One read SP + one hook instead of ~10 SP
  edits.
- **Login by username / email / mobile** — one identifier field. All three are
  unique, so at most one row matches.
- **One self-service write SP** (`sp_UpdateOwnProfile`) handles name + avatar +
  optional password — not three SPs.

## Schema (`tblUser`)
- **+`Mobile` varchar(20)** — does not exist today.
- **+`Avatar` varchar(60)** — the preset string.
- Filtered-unique indexes on **`Username`** (plain unique — NOT NULL, no dupes),
  **`Email`** (`WHERE Email IS NOT NULL`), **`Mobile`** (`WHERE Mobile IS NOT
  NULL`). Data is clean today (4 users, emails unique, mobile all-NULL).

## Stored procedures
- **`sp_ValidateUser`** — param `@identifier`; `WHERE Username=@identifier OR
  Email=@identifier OR Mobile=@identifier`. Add `Avatar`, `Mobile` to the user
  result set (and `NULL AS Avatar/Mobile` to the 404/403 branches — uniform
  shape). Menu result set unchanged.
- **`sp_SaveUser`** (admin) — add `@Mobile`; make the friendly username dup
  check **global** (drop `AND CompId=@CompId`); add friendly email/mobile dup
  checks. Insert/update `Mobile`.
- **`sp_FetchUser`** (admin) — project `Mobile`, `Avatar` in every SELECT branch
  (incl. empty/404); add `Mobile` to the search predicate.
- **`sp_UpdateOwnProfile(@UserId,@FullName,@Avatar,@NewPasswordHash=NULL)`** —
  NEW. Updates `FullName` (required, non-blank) + `Avatar` always; updates
  `Password` only when a hash is passed. Self-scoped by `@UserId`. One status
  row.
- **`sp_FetchUserDirectory(@CompId)`** — NEW, light. `SELECT Id, FullName,
  Avatar FROM tblUser WHERE CompId=@CompId AND IsActive=1`. Powers the client
  avatar cache; readable by any authenticated user (company-scoped).

## Backend
- **`/me` route group** — `verifyToken` only, operates **strictly on
  `req.user.UserId`** (never a body id). `updateMyProfile` (FullName, Avatar),
  `changeMyPassword` (bcrypt-verify current → `sp_UpdateOwnProfile` with the new
  hash). Both call the one SP.
- **`authController.login`** — accept `identifier` (fall back to `username` for
  back-compat); pass it to `sp_ValidateUser`. Add `Avatar`, `Mobile` to the
  token-adjacent user payload.
- **User directory endpoint** — `getUserDirectory` → `sp_FetchUserDirectory`,
  any authed user, CompId-scoped.
- **`sp_SaveUser` caller** — thread `Mobile` through the admin save.

## Web
- **Login form** — field relabelled "Username / Email / Mobile"; sends
  `identifier`.
- **"My Account" modal** — off the top-nav avatar: edit FullName, avatar picker
  (icon+color + emoji from bundled sets), change-password form (current / new /
  confirm, Zod). Saves via `/me/*`; updates `useAuthStore`.
- **`Avatar` component** — render the preset (icon/emoji on color), initials
  fallback. Accept an explicit preset or resolve by `UserId` from the directory
  cache.
- **Directory hook** — `useUserDirectory` (cached) mapping `UserId → {FullName,
  Avatar}`; feeds pass `UserId` to `Avatar`.
- **Admin user form** — add the Mobile field.

## Caveat
JWT has no revocation here, so a password change won't end existing sessions —
the user stays logged in elsewhere until the token expires. Acceptable for v1;
forced re-login would need token versioning.

## Testing
Each layer ships with tests (§0.4): SP verify blocks execute the write paths
(uniqueness 409s, self-scope, password-only vs profile-only update) under
`BEGIN TRAN … ROLLBACK`; backend jest for `/me` self-scope, identifier login,
directory; web vitest for the account modal, avatar picker, password form, and
avatar-by-UserId resolution.
