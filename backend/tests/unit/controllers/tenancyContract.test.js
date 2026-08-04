const fs = require("fs");
const path = require("path");

/**
 * The test that would have caught the 2026-08-04 audit findings.
 *
 * Five separate cross-tenant holes shipped, and 558 passing tests said nothing,
 * because every one of them asserted what a controller does with the rows it
 * gets back — never which rows it is entitled to ask for. The database is
 * mocked, so a controller that omits CompId looks identical to one that does
 * not.
 *
 * So this asserts the one property no per-controller test covers: EVERY stored
 * procedure call from a controller carries a tenant filter. It reads source
 * rather than executing it, deliberately — the point is to catch a call that no
 * test exercises, which is exactly where the holes were.
 *
 * When this fails on a new endpoint, the fix is almost always to pass
 * `CompId: req.user.CompId`. Adding a name to EXEMPT is the rare case, and
 * needs the check below the list done first.
 */

const CONTROLLERS = path.join(__dirname, "../../../src/controllers");

/**
 * Procedures that legitimately take no @CompId.
 *
 * Verified against sys.parameters on 2026-08-04 — every one of these declares
 * no @CompId at all, so passing one makes node-mssql reject the call outright.
 * Each is keyed by @UserId, or by an entity id whose ownership has already been
 * established by the caller:
 *
 *   sp_ValidateUser              @identifier, @UserId      — login; no session yet
 *   sp_FetchMenu                 @Id, @UserId, @ParentId   — menu for one user
 *   sp_FetchNotifications        @UserId, ...              — one user's inbox
 *   sp_MarkNotificationRead      @Id, @UserId              — own row only
 *   sp_MarkAllNotificationsRead  @UserId                   — own rows only
 *   sp_MarkCommentRead           @CommentId, @UserId       — own receipt
 *   sp_NotifyCommentAdded        @CommentId, @ActorUserId  — fan-out, post-write
 *   sp_NotifyTaskAssigned        @TaskId, @ActorUserId, @AssigneeUserId
 *   sp_UpdateOwnProfile          @UserId, ...              — own row by definition
 *
 * Before adding to this list: confirm the procedure really has no @CompId
 * parameter, and that its remaining parameters bound the caller to their own
 * data. "It seemed fine" is how sp_DeleteUserBranchAccess spent months
 * deleting any row id it was handed.
 */
const EXEMPT = new Set([
  "sp_ValidateUser",
  "sp_FetchMenu",
  "sp_FetchNotifications",
  "sp_MarkNotificationRead",
  "sp_MarkAllNotificationsRead",
  "sp_MarkCommentRead",
  "sp_NotifyCommentAdded",
  "sp_NotifyTaskAssigned",
  "sp_UpdateOwnProfile",
]);

/** `executeStoredProcedure("sp_Name", { ...params })` — name plus param block. */
const CALL = /executeStoredProcedure\(\s*"([^"]+)"\s*,\s*\{(.*?)\n\s*\}\s*[,)]/gs;

function callsIn(file) {
  const source = fs.readFileSync(path.join(CONTROLLERS, file), "utf8");
  const found = [];
  for (const [, sp, params] of source.matchAll(CALL)) found.push({ sp, params });
  return found;
}

/**
 * Comments are stripped before the pattern checks below, or the tests fail on
 * the notes explaining the very bugs they guard against — which is a genuinely
 * annoying way to find out your matcher is naive.
 */
function code(file) {
  return fs
    .readFileSync(path.join(CONTROLLERS, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FILES = fs.readdirSync(CONTROLLERS).filter((f) => f.endsWith(".js"));

describe("tenancy contract: every SP call is company-scoped", () => {
  it("finds controllers to check (guards against the regex silently matching nothing)", () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.flatMap(callsIn).length).toBeGreaterThan(50);
  });

  it.each(FILES)("%s passes CompId to every non-exempt procedure", (file) => {
    const offenders = callsIn(file)
      .filter(({ sp, params }) => !EXEMPT.has(sp) && !params.includes("CompId"))
      .map(({ sp }) => sp);

    expect(offenders).toEqual([]);
  });

  it("does not read a tenant id from the request body", () => {
    // taskController.saveChecklist used `CompId: CompId || req.user.CompId`,
    // with CompId destructured from req.body — the only endpoint in the backend
    // that let the caller name its own tenant. The record-access check gates the
    // TaskId and says nothing about the company, so the write landed wherever
    // the body said.
    const offenders = FILES.filter((file) =>
      /CompId\s*\|\|\s*req\.user\.CompId|BranchId\s*\|\|\s*req\.user\.BranchId/.test(
        code(file),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("nobody hand-rolls the scope serialiser", () => {
    // `req.scope?.branchIds?.length ? JSON.stringify(...) : null` collapses an
    // empty scope to NULL, which every scoped SP reads as "no branch filter" —
    // the widest answer for the narrowest scope. scopeJson keeps `[]` as an
    // empty allow-list. Seven controllers had their own copy of the broken form.
    const offenders = FILES.filter((file) =>
      code(file).includes("branchIds?.length"),
    );

    expect(offenders).toEqual([]);
  });
});
