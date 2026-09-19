const { normalizeMobile, applyMobiles, MOBILE_MESSAGE } = require("../../../src/utils/mobile");

describe("normalizeMobile", () => {
  it.each([
    ["9825012345", "9825012345"],
    ["98250 12345", "9825012345"],
    ["98250-12345", "9825012345"],
    ["(98250) 12345", "9825012345"],
    ["+91 98250 12345", "9825012345"],
    ["+919825012345", "9825012345"],
    ["919825012345", "9825012345"],
    ["09825012345", "9825012345"],
    [9825012345, "9825012345"],
  ])("%p → %p", (raw, out) => expect(normalizeMobile(raw)).toBe(out));

  // The live rows that prompted this: '111', '44774445555', two 9-digit typos.
  it.each([["111"], ["44774445555"], ["903315499"], ["98250123456"], ["abcdefghij"], [""], ["   "], [null], [undefined]])(
    "%p is not a mobile",
    (raw) => expect(normalizeMobile(raw)).toBeNull(),
  );

  // 12 digits only lose their prefix when the prefix is 91 — an arbitrary
  // 12-digit string is junk, not a number with a country code.
  it("drops a leading 91 or 0 only at exactly 12 / 11 digits", () => {
    expect(normalizeMobile("449825012345")).toBeNull();
    expect(normalizeMobile("19825012345")).toBeNull();
    expect(normalizeMobile("9198250123")).toBe("9198250123"); // ten digits that happen to start 91
  });
});

describe("applyMobiles", () => {
  it("rewrites each field in place and returns null when all are fine", () => {
    const f = { MobileNo: "+91 98250 12345", AltMobile: "" };
    expect(applyMobiles(f, [["MobileNo", "Mobile number"], ["AltMobile", "Alternate mobile"]])).toBeNull();
    expect(f).toEqual({ MobileNo: "9825012345", AltMobile: null });
  });

  it("names the field that is wrong, and stops there", () => {
    const f = { MobileNo: "9825012345", AltMobile: "123" };
    expect(applyMobiles(f, [["MobileNo", "Mobile number"], ["AltMobile", "Alternate mobile"]]))
      .toBe("Alternate mobile must be 10 digits");
  });

  it("treats a missing key as blank", () => {
    const f = {};
    expect(applyMobiles(f, [["Mobile", "Mobile number"]])).toBeNull();
    expect(f.Mobile).toBeNull();
  });

  it("exports the default sentence both clients render", () => {
    expect(MOBILE_MESSAGE).toBe("Mobile number must be 10 digits");
  });
});
