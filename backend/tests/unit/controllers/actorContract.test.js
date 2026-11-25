// Static guard over the source text (plan constraint "Identity", spec C1): the lead,
// complaint, follow-up and quotation controllers take the person from actor(req) and let
// SQL decide visibility. They never build office/owner lists, never re-check access in
// Node, and never read UserId/CompId from the request.
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "../../..", f), "utf8");
const file = (n) => `src/controllers/${n}Controller.js`;

const LIST_PARAMS = /AccessibleBranchIdsJson|OwnerIdsJson|BranchIdsJson|EscalatedSubtreeJson|AllowReopen|scopeParams|scopeJson|canSeeRecord|assertCanAssign|canReopen/;
// req.body.UserId, req.query?.CompId, and `const { UserId } = req.body`
const PERSON_FROM_REQUEST = /req\.(body|query|params)\??\.(UserId|CompId)\b|\{[^}]*\b(UserId|CompId)\b[^}]*\}\s*=\s*req\.(body|query|params)\b/;

// Not converted yet. Each entry must STILL break the rule (so the list cannot rot):
// the task that converts a controller (11 ticket, 12 lead, 13 followup + quotation)
// removes it here, and this list is empty when Task 13 lands.
const PENDING = [];
const DONE = ["ticket", "lead", "followup", "quotation"].filter((n) => !PENDING.includes(n));

const breaks = (src) => LIST_PARAMS.test(src) || PERSON_FROM_REQUEST.test(src);

// Final review m6: the person comes from actor(req) only — never read straight off
// req.user (same values today, but outside this guard). Call and customer
// controllers write on leads / complaints / their customers, so they are held to it.
const PERSON_FROM_SESSION_RAW = /=\s*req\.user\b|req\.user\??\.(UserId|CompId)\b/;
const ACTOR_ONLY = [...DONE, "call", "customer"];

describe("actor contract — converted controllers", () => {
  const files = DONE.map(file);
  if (!files.length) {
    it("no controller converted yet", () => expect(DONE).toEqual([]));
    return;
  }
  it.each(files)("%s never names a list parameter", (f) => {
    expect(read(f)).not.toMatch(LIST_PARAMS);
  });
  it.each(files)("%s never takes the person or company from the request", (f) => {
    expect(read(f)).not.toMatch(PERSON_FROM_REQUEST);
  });
});

describe("actor contract — the person only through actor(req)", () => {
  it.each(ACTOR_ONLY.map(file))("%s never reads UserId/CompId off req.user", (f) => {
    expect(read(f)).not.toMatch(PERSON_FROM_SESSION_RAW);
  });
  it("the pattern catches the forms and leaves actor(req) alone", () => {
    for (const s of ["const { CompId, UserId } = req.user", "const { CompId } = req.user;", "req.user.UserId", "req.user?.CompId"])
      expect(s).toMatch(PERSON_FROM_SESSION_RAW);
    for (const s of ["const { CompId, UserId } = actor(req)", "req.user.BranchId", "// req.user.BranchId"])
      expect(s).not.toMatch(PERSON_FROM_SESSION_RAW);
  });
});

// Calling lists (149): held to all three patterns. A file not written yet is skipped,
// so each controller is caught the moment it appears.
const CALLING = ["calling", "callingCaller", "phoneMark"];
describe("actor contract — calling controllers", () => {
  const present = CALLING.map(file).filter((f) => fs.existsSync(path.join(__dirname, "../../..", f)));
  if (!present.length) {
    it("no calling controller yet", () => expect(present).toEqual([]));
    return;
  }
  it.each(present)("%s never names a list parameter", (f) => expect(read(f)).not.toMatch(LIST_PARAMS));
  it.each(present)("%s never takes the person or company from the request", (f) => expect(read(f)).not.toMatch(PERSON_FROM_REQUEST));
  it.each(present)("%s never reads UserId/CompId off req.user", (f) => expect(read(f)).not.toMatch(PERSON_FROM_SESSION_RAW));
});

describe("actor contract — pending list stays honest", () => {
  if (PENDING.length === 0) {
    it("every controller is converted", () => expect(DONE).toHaveLength(4));
    return;
  }
  it.each(PENDING.map(file))("%s still breaks the rule (remove it from PENDING once converted)", (f) => {
    expect(breaks(read(f))).toBe(true);
  });
});

describe("actor contract — the patterns themselves", () => {
  it("catch every forbidden form", () => {
    for (const s of ["AccessibleBranchIdsJson", "...scopeParams(req)", "scopeJson(x)", "canSeeRecord(", "assertCanAssign(", "canReopen(", "@AllowReopen"])
      expect(s).toMatch(LIST_PARAMS);
    for (const s of ["req.body.UserId", "req.query?.CompId", "req.params.UserId", "const { UserId, Name } = req.body", "const { CompId } = req.query"])
      expect(s).toMatch(PERSON_FROM_REQUEST);
  });
  it("leave legal code alone", () => {
    for (const s of ["const { CompId, UserId } = actor(req)", "const { CompId, UserId } = req.user", "req.body.ForUserId", "scopeFor(req, 'customers')", "const { TicketId } = req.body"]) {
      expect(s).not.toMatch(LIST_PARAMS);
      expect(s).not.toMatch(PERSON_FROM_REQUEST);
    }
  });
});
