const { termsError } = require("../../../src/utils/commission");

describe("termsError", () => {
  it("allows no terms and valid terms", () => {
    expect(termsError(null, null)).toBeNull();
    expect(termsError("fixed", 500)).toBeNull();
    expect(termsError("pct", 100)).toBeNull();
  });
  it.each([["pct", -1], ["pct", 101], ["pct", null], ["fixed", NaN], [null, 5], ["x", 5]])("rejects %p %p", (t, v) => {
    expect(termsError(t, v)).not.toBeNull();
  });
});
