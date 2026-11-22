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
const PENDING = ["ticket", "lead", "followup", "quotation"];
const DONE = ["ticket", "lead", "followup", "quotation"].filter((n) => !PENDING.includes(n));

const breaks = (src) => LIST_PARAMS.test(src) || PERSON_FROM_REQUEST.test(src);

describe("actor contract — converted controllers", () => {
  const files = DONE.map(file);
  it.each(files.length ? files : ["(none yet)"])("%s never names a list parameter", (f) => {
    if (f === "(none yet)") return expect(PENDING).toHaveLength(4);
    expect(read(f)).not.toMatch(LIST_PARAMS);
  });
  it.each(files.length ? files : ["(none yet)"])("%s never takes the person or company from the request", (f) => {
    if (f === "(none yet)") return expect(PENDING).toHaveLength(4);
    expect(read(f)).not.toMatch(PERSON_FROM_REQUEST);
  });
});

describe("actor contract — pending list stays honest", () => {
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
