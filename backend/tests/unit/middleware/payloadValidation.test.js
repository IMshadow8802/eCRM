const {
  requirePayload,
  allowEmptyPayload,
} = require("../../../src/middleware/payloadValidation");
const { mockRes } = require("../../helpers/mockRes");

const body = (res) => res.json.mock.calls[0][0];

describe("requirePayload", () => {
  it.each([
    ["an empty object", {}],
    ["a missing body", undefined],
    ["a null body", null],
    ["an empty array", []],
    // Falsy or key-less primitives: Object.keys(true) and Object.keys(0) are
    // both [], so these are rejected too.
    ["the boolean true", true],
    ["the number 0", 0],
    ["an empty string", ""],
  ])("400s %s and does not call next", (_label, reqBody) => {
    const res = mockRes();
    const next = jest.fn();

    requirePayload({ body: reqBody }, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns the standard validation envelope", () => {
    const res = mockRes();
    requirePayload({ body: {} }, res, jest.fn());
    expect(body(res)).toEqual({
      success: false,
      message: "No payload found",
      code: "VALIDATION_ERROR",
      responseCode: 400,
      data: null,
      timestamp: expect.any(String),
    });
  });

  it("calls next for a body with keys", () => {
    const res = mockRes();
    const next = jest.fn();

    requirePayload({ body: { LeadId: 5 } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next for a body whose only value is null/undefined", () => {
    const res = mockRes();
    const next = jest.fn();
    requirePayload({ body: { LeadId: null } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // BUG: this gate only counts keys — it never looks at which keys. Every
  // route wired with requirePayload (deleteLead, saveGroupAccess, download …)
  // is satisfied by { junk: 1 }, so the "validation" it advertises is really
  // just "the body is non-empty". The endpoint's actual required fields are
  // unchecked here, and whatever the controller does with a missing LeadId
  // (usually a raw SP error) is the real failure mode.
  it("is satisfied by ANY key, including one the endpoint never asked for", () => {
    const res = mockRes();
    const next = jest.fn();

    requirePayload({ body: { totallyUnrelated: "junk" } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  // BUG: the same key-count check accepts non-objects. Object.keys("hi") is
  // ["0","1"], so a raw string body passes and the controller then reads
  // req.body.LeadId === undefined off a string. Same for a non-empty array.
  it.each([
    ["a non-empty string", "hi"],
    ["a non-empty array", [1, 2]],
  ])("lets %s through as if it were a valid payload", (_label, reqBody) => {
    const res = mockRes();
    const next = jest.fn();

    requirePayload({ body: reqBody }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("400s a single-character string body but passes a two-character one", () => {
    // Documenting the arbitrariness: length is what decides.
    const shortRes = mockRes();
    requirePayload({ body: "h" }, shortRes, jest.fn());
    expect(shortRes.status).not.toHaveBeenCalled(); // Object.keys("h") === ["0"]

    const emptyRes = mockRes();
    const next = jest.fn();
    requirePayload({ body: "" }, emptyRes, next);
    expect(emptyRes.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("allowEmptyPayload", () => {
  it("substitutes {} for a missing body and calls next", () => {
    const req = {};
    const next = jest.fn();

    allowEmptyPayload(req, mockRes(), next);

    expect(req.body).toEqual({});
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["the number 0", 0],
    ["false", false],
  ])("substitutes {} for %s", (_label, reqBody) => {
    const req = { body: reqBody };
    allowEmptyPayload(req, mockRes(), jest.fn());
    expect(req.body).toEqual({});
  });

  it("leaves an existing body untouched, by reference", () => {
    const original = { PageNumber: 2 };
    const req = { body: original };
    const next = jest.fn();

    allowEmptyPayload(req, mockRes(), next);

    expect(req.body).toBe(original);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves an empty object as-is", () => {
    const original = {};
    const req = { body: original };
    allowEmptyPayload(req, mockRes(), jest.fn());
    expect(req.body).toBe(original);
  });

  it("never responds — it only calls next", () => {
    const res = mockRes();
    allowEmptyPayload({}, res, jest.fn());
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  // BUG: the guard is `!req.body`, i.e. truthiness, not "is an object". A
  // truthy non-object body survives, so the middleware's promise — "req.body
  // exists" — does not amount to "req.body is safe to read fields from".
  it("leaves a truthy non-object body in place instead of normalising it", () => {
    const req = { body: "not-an-object" };
    allowEmptyPayload(req, mockRes(), jest.fn());
    expect(req.body).toBe("not-an-object");
  });
});
