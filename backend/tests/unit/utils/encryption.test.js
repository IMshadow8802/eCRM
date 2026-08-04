const {
  hashPassword,
  comparePassword,
} = require("../../../src/utils/encryption");

// bcrypt at 12 rounds costs ~250ms a call — hash once and reuse.
let hash;
beforeAll(async () => {
  hash = await hashPassword("correct horse battery staple");
}, 20000);

describe("hashPassword", () => {
  it("produces a 60-char bcrypt hash, not the plaintext", async () => {
    expect(hash).toMatch(/^\$2[aby]\$12\$/); // cost factor 12
    expect(hash).toHaveLength(60);
    expect(hash).not.toContain("correct horse");
  });

  // Salted, not deterministic: the same password hashes differently every
  // time, so hashes can never be compared with === (or looked up by value).
  it("is salted — two hashes of the same password differ but both verify", async () => {
    const again = await hashPassword("correct horse battery staple");
    expect(again).not.toBe(hash);
    await expect(
      comparePassword("correct horse battery staple", again),
    ).resolves.toBe(true);
  });

  it("hashes an empty string rather than rejecting it", async () => {
    // hashPassword still accepts "" — but comparePassword refuses to match on
    // it, so an account somehow stored with an empty password cannot be logged
    // into by sending an empty one.
    const empty = await hashPassword("");
    expect(empty).toHaveLength(60);
    await expect(comparePassword("", empty)).resolves.toBe(false);
    await expect(comparePassword("x", empty)).resolves.toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 12345],
  ])("rejects %s with a wrapped 'Password hashing failed' error", async (_l, input) => {
    await expect(hashPassword(input)).rejects.toThrow(/^Password hashing failed: /);
  });
});

describe("comparePassword", () => {
  it("round-trips the correct password", async () => {
    await expect(
      comparePassword("correct horse battery staple", hash),
    ).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    await expect(comparePassword("wrong password", hash)).resolves.toBe(false);
  });

  it("is case- and whitespace-sensitive", async () => {
    await expect(
      comparePassword("Correct Horse Battery Staple", hash),
    ).resolves.toBe(false);
    await expect(
      comparePassword("correct horse battery staple ", hash),
    ).resolves.toBe(false);
  });

  it("rejects an empty password against a real hash", async () => {
    await expect(comparePassword("", hash)).resolves.toBe(false);
  });

  it("returns false (no throw) for a hash-shaped string that isn't a bcrypt hash", async () => {
    await expect(comparePassword("anything", "plaintext-in-db")).resolves.toBe(
      false,
    );
  });

  /**
   * FIXED 2026-08-04. A null or undefined stored hash used to throw, and the
   * combination was reachable in production: userController.save writes
   * `Password ? await hashPassword(Password) : null`, so a user created without
   * a password has Password = NULL, and authController.login called straight
   * into here. bcrypt rejects with "Illegal arguments", which surfaced as a
   * 500 "Password comparison failed" on what is simply a failed login.
   *
   * A missing hash means "this account has no password to log in with" — a
   * false, not an error.
   */
  it.each([
    ["a null stored hash", "pw", null],
    ["an undefined stored hash", "pw", undefined],
    ["an empty stored hash", "pw", ""],
  ])("returns false for %s instead of throwing", async (_l, plain, stored) => {
    await expect(comparePassword(plain, stored)).resolves.toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("returns false when the supplied password is %s", async (_l, plain) => {
    await expect(comparePassword(plain, hash)).resolves.toBe(false);
  });

  it("still throws, without leaking material, if bcrypt itself fails", async () => {
    // Both arguments present but the stored value is not a bcrypt hash of any
    // recognisable form — bcrypt's own error path, which stays a throw.
    await expect(
      comparePassword("hunter2", { not: "a hash" }),
    ).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("hunter2") }),
    );
  });
});
