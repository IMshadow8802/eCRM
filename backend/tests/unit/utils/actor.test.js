const { actor } = require("../../../src/utils/actor");

describe("actor", () => {
  it("takes the person from the verified session only", () => {
    expect(actor({ user: { CompId: 1, UserId: 7 }, body: { UserId: 99, CompId: 5 } })).toEqual({ CompId: 1, UserId: 7 });
  });
  it("coerces numeric strings from the token", () => {
    expect(actor({ user: { CompId: "1", UserId: "7" } })).toEqual({ CompId: 1, UserId: 7 });
  });
  it("throws without a session", () => {
    expect(() => actor({ body: { UserId: 7 } })).toThrow("NO_ACTOR");
    expect(() => actor(undefined)).toThrow("NO_ACTOR");
  });
  it("throws when either half is missing or not a number", () => {
    expect(() => actor({ user: { CompId: 1 } })).toThrow("NO_ACTOR");
    expect(() => actor({ user: { UserId: 7 } })).toThrow("NO_ACTOR");
    expect(() => actor({ user: { CompId: 1, UserId: "abc" } })).toThrow("NO_ACTOR");
  });
});
