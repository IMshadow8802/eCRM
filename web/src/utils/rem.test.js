import { describe, expect, it } from "vitest";
import { rem } from "./rem";

describe("rem", () => {
  it("turns design px into rem against the 15px root", () => {
    expect(rem(15)).toBe("1rem");
    expect(rem(30)).toBe("2rem");
    expect(rem(-6)).toBe("-0.4rem");
  });
});
