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
const UTILS = path.join(__dirname, "../../../src/utils");
const MIDDLEWARE = path.join(__dirname, "../../../src/middleware");

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
 *   sp_FetchBranches             (none)                    — tblBranch has no CompId column; SP declares no params (backend/sql/072_menu_pipeline_row.sql)
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
  "sp_FetchBranches",
]);

/** `executeStoredProcedure("sp_Name", { ...params })` — name plus param block. */
const CALL = /executeStoredProcedure\(\s*"([^"]+)"\s*,\s*\{(.*?)\n\s*\}\s*[,)]/gs;

/**
 * `runSp(res, "sp_Name", { ...params }, ...)` / `fetchRows(res, "sp_Name",
 * { ...params }, dataKey)` — the per-controller write/read wrappers (ticket/
 * customer/config/lead/call controllers use runSp; configController also has
 * fetchRows for sp_FetchCustomFields / sp_FetchLookups) that themselves call
 * executeStoredProcedure(spName, params) with spName as a variable, which is
 * exactly why CALL above never sees these: there is no string literal at
 * that call site for it to match. This is what let sp_SaveTicket,
 * sp_SaveCustomer, sp_DeleteCustomer, sp_ResolveTicket, sp_CloseTicket,
 * sp_ReopenTicket, sp_FetchCustomFields, sp_FetchLookups and the rest of the
 * lead/call/config controllers' calls go unchecked while the suite stayed
 * green. None of the params objects below nest a `{`, so stopping at the
 * first `}` captures the object exactly (no overshoot).
 *
 * This alternation is the "known wrapper names" half of the fix; the guard
 * test below is the other half — it fails the moment a *new*, unlisted
 * wrapper name shows up, so this list can't go stale unnoticed the way CALL
 * alone did.
 */
const WRAPPER_CALL = /\b(?:runSp|fetchRows)\(\s*res\s*,\s*"([^"]+)"\s*,\s*\{([^{}]*)\}/gs;

function callsIn(file) {
  const source = fs.readFileSync(path.join(CONTROLLERS, file), "utf8");
  const found = [];
  for (const [, sp, params] of source.matchAll(CALL)) found.push({ sp, params });
  for (const [, sp, params] of source.matchAll(WRAPPER_CALL)) found.push({ sp, params });
  return found;
}

/**
 * What this guard does NOT catch, written down so a later reader sees the
 * net's actual shape instead of assuming it catches everything. A known,
 * listed hole is fine; an unlisted one is the whole problem this file exists
 * to close.
 *
 * 1. A procedure name built by concatenation or a template literal —
 *    `executeStoredProcedure("sp_" + name, …)` or `` `sp_${name}` `` — escapes
 *    VARIABLE_SP_CALL below: it matches a bare identifier only, not an
 *    expression. Nobody writes that shape in this codebase today (confirmed
 *    by direct probe); if someone starts, this comment is the reminder to
 *    widen the pattern, not proof the gap already doesn't exist.
 *
 * 2. Literal-name calls outside src/controllers/ are checked by nothing in
 *    this file. Two exist today: `utils/activityLogger.js`
 *    (`sp_SaveActivityLog`) and `realtime/socket.js`
 *    (`sp_FetchWorkspaceMembers`) — both hand-verified to carry CompId.
 *    Relatedly: the it.each(FILES) literal-call sweep further down runs over
 *    CONTROLLERS only, so `permission.js`'s three literal-name calls
 *    (`sp_FetchAccessibleBranchIds`, `sp_CheckTaskPermission`,
 *    `sp_FetchAssignableUsers`) are unchecked by *that* sweep even though
 *    permission.js is now in this guard's own scan for the variable-name
 *    shape. All three hand-verified to carry CompId.
 *
 * 3. A wrapper written as object-method shorthand (`{ foo(req, res) {…} }`),
 *    a class method, or a `var`-declared arrow still trips VARIABLE_SP_CALL —
 *    detection does not depend on FUNC_DEF recognising the definition — but
 *    functionSpansIn has no span for it, so enclosingFunction returns null
 *    and wrapperFunctionsIn labels it `<top-level>` instead of its real name.
 *    The guard still fails (the entry is still absent from KNOWN_WRAPPERS),
 *    so nothing escapes silently; only the failure message names the wrong
 *    thing. Detection is intact — the diagnostic is poor.
 *
 * Any function whose body calls `database.executeStoredProcedure` with an
 * *identifier* (not a string literal) as the SP-name argument is a wrapper —
 * the exact shape that hides its calls from CALL and WRAPPER_CALL above,
 * which both key off a literal `"sp_Name"` at the call site. Finding these
 * by brace-matching function bodies, instead of hand-listing the wrappers we
 * already know about, is what makes the guard test below fail on a *new*
 * wrapper nobody has taught this file about yet.
 */
const FUNC_DEF =
  /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
const VARIABLE_SP_CALL = /executeStoredProcedure\(\s*([A-Za-z_$][\w$]*)\s*,/g;

function functionSpansIn(source) {
  const spans = [];
  for (const m of source.matchAll(FUNC_DEF)) {
    const name = m[1] || m[2];
    const braceStart = m.index + m[0].length - 1; // index of the opening '{'
    let depth = 1;
    let i = braceStart + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    spans.push({ name, start: m.index, end: i });
  }
  return spans;
}

// The innermost function enclosing a given source offset — inner arrow
// callbacks would otherwise shadow the wrapper's own name.
function enclosingFunction(spans, idx) {
  let best = null;
  for (const s of spans) {
    if (idx >= s.start && idx < s.end && (!best || s.end - s.start < best.end - best.start)) {
      best = s;
    }
  }
  return best;
}

function wrapperFunctionsIn(dir, file) {
  const source = fs.readFileSync(path.join(dir, file), "utf8");
  const spans = functionSpansIn(source);
  const found = new Set();
  for (const m of source.matchAll(VARIABLE_SP_CALL)) {
    const enclosing = enclosingFunction(spans, m.index);
    found.add(enclosing ? `${file}:${enclosing.name}` : `${file}:<top-level>`);
  }
  return [...found];
}

// Recursive on purpose: a plain readdirSync would silently stop at the first
// subdirectory, so grouping files into a folder later (e.g. src/controllers/
// support/) would hide their wrappers from the guard below entirely — a known
// hole becoming an unknown one the moment someone reorganises. The tree is
// flat today; this does not assume it stays that way. Returns paths relative
// to `dir`, which path.join(dir, file) below handles whether or not they
// contain a subdirectory segment.
function jsFilesIn(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const nested of jsFilesIn(path.join(dir, entry.name))) {
        out.push(path.join(entry.name, nested));
      }
    } else if (entry.name.endsWith(".js")) {
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * Every wrapper found today, verified by hand:
 *   runSp               (ticket/customer/lead/call/config controllers) —
 *                        checked by WRAPPER_CALL above, per call site.
 *   fetchRows           (configController)                             — same.
 *   runReport           (reportKit, every sp_Rpt* endpoint)             —
 *                        checked by its own dedicated test below: one call
 *                        site, CompId hardcoded.
 *   assertRecordAccess  (permission.js, the lead/ticket record-access gate)
 *                        — same treatment as runReport: one call site behind
 *                        an ENTITY_LOOKUP dispatch table, CompId hardcoded,
 *                        checked by its own dedicated test below.
 * The scan runs over src/controllers, src/utils AND src/middleware — a
 * variable-spName wrapper is exactly as dangerous wherever it lives; scoping
 * the guard to only two of the three directories a controller's call can
 * route through would leave a known hole of the same shape this guard exists
 * to catch.
 * Adding a name here is the rare case, and means its calls now need their
 * own coverage above (or below) — not just a quieter allow-list entry.
 */
const KNOWN_WRAPPERS = new Set([
  "ticketController.js:runSp",
  "customerController.js:runSp",
  "leadController.js:runSp",
  "callController.js:runSp",
  "configController.js:runSp",
  "configController.js:fetchRows",
  "reportKit.js:runReport",
  "permission.js:assertRecordAccess",
]);

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

  it("reportKit.runReport (every sp_Rpt* report endpoint) passes CompId", () => {
    // runReport's call site has no literal SP name or inline params object —
    // spName and the whole args bag are assembled elsewhere (REPORTS in this
    // same file, parseReportArgs) — so neither CALL nor WRAPPER_CALL can key
    // off it the way they do a runSp/fetchRows call. It has exactly one
    // executeStoredProcedure call, so it is checked directly here instead.
    const source = fs.readFileSync(path.join(UTILS, "reportKit.js"), "utf8");
    const call = /executeStoredProcedure\(\s*spName\s*,\s*\{([^{}]*)\}/s.exec(source);

    expect(call).not.toBeNull(); // guards against the regex silently matching nothing
    expect(call[1]).toContain("CompId");
  });

  it("permission.assertRecordAccess (lead/ticket record gate) passes CompId", () => {
    // Same shape as runReport: assertRecordAccess resolves its SP name from
    // ENTITY_LOOKUP[entity] (an identifier, not a literal) before calling
    // executeStoredProcedure, so it has no literal-name call site for CALL or
    // WRAPPER_CALL to key off. One call site, checked directly.
    const source = fs.readFileSync(path.join(MIDDLEWARE, "permission.js"), "utf8");
    const call = /executeStoredProcedure\(\s*sp\s*,\s*\{([^{}]*)\}/s.exec(source);

    expect(call).not.toBeNull(); // guards against the regex silently matching nothing
    expect(call[1]).toContain("CompId");
  });

  it("every function that hands a variable SP name to executeStoredProcedure is a known, checked wrapper", () => {
    // CALL and WRAPPER_CALL both key off a literal "sp_Name" string at the
    // call site. Any function that instead calls executeStoredProcedure with
    // an identifier is the same blind spot runSp/fetchRows were: invisible to
    // both patterns. This scans every controller, util AND middleware source
    // for that shape and requires each one to already be named in
    // KNOWN_WRAPPERS — whoever writes the next one gets a failing test naming
    // the function, not a silent gap the next audit has to rediscover.
    const found = new Set();
    for (const dir of [CONTROLLERS, UTILS, MIDDLEWARE]) {
      for (const file of jsFilesIn(dir)) {
        for (const w of wrapperFunctionsIn(dir, file)) found.add(w);
      }
    }

    expect([...found].sort()).toEqual([...KNOWN_WRAPPERS].sort());
  });
});
