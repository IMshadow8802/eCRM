import { describe, it, expect } from "vitest";
import { normalizeMobile, mobileSchema, MOBILE_MESSAGE } from "./mobile";

describe("normalizeMobile — the same rule as backend/src/utils/mobile.js", () => {
  it.each([
    ["9825012345", "9825012345"], ["98250 12345", "9825012345"], ["98250-12345", "9825012345"],
    ["+91 98250 12345", "9825012345"], ["919825012345", "9825012345"], ["09825012345", "9825012345"],
  ])("%p → %p", (raw, out) => expect(normalizeMobile(raw)).toBe(out));

  it.each([["111"], ["44774445555"], ["903315499"], ["abc"], [""], [null], [undefined], ["449825012345"]])(
    "%p is not a mobile", (raw) => expect(normalizeMobile(raw)).toBeNull(),
  );
});

describe("mobileSchema", () => {
  it("optional: blank passes as empty, a good number is normalised, a bad one is refused with the house sentence", () => {
    const s = mobileSchema();
    expect(s.parse("")).toBe("");
    expect(s.parse(undefined)).toBe("");
    expect(s.parse("+91 98250 12345")).toBe("9825012345");
    expect(s.safeParse("12345").error.issues[0].message).toBe(MOBILE_MESSAGE);
  });

  it("required: blank is refused", () => {
    const s = mobileSchema({ required: true });
    expect(s.safeParse("").error.issues[0].message).toBe("Mobile number is required");
    expect(s.parse("9825012345")).toBe("9825012345");
  });

  it("names the field it is for", () => {
    expect(mobileSchema({ label: "Alternate mobile" }).safeParse("1").error.issues[0].message).toBe("Alternate mobile must be 10 digits");
  });
});
