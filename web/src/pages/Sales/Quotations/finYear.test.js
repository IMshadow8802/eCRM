import { describe, it, expect } from "vitest";
import { finYear, finYearLabel } from "./finYear";

describe("finYear", () => {
  it.each([
    ["2026-09-18", "2627"],
    ["2026-04-01", "2627"], // first day of the year
    ["2026-03-31", "2526"], // last day of the one before
    ["2027-01-15", "2627"],
    ["2099-12-31", "9900"], // century roll
  ])("%s → %s", (d, fy) => expect(finYear(d)).toBe(fy));

  it("reads a date string as local, so 1 April is 1 April in IST", () => {
    expect(finYear("2026-04-01T00:00:00")).toBe("2627");
  });

  it("takes a Date, and defaults to today", () => {
    expect(finYear(new Date(2026, 3, 1))).toBe("2627");
    expect(finYear()).toMatch(/^\d{4}$/);
  });

  it("is empty for an unparseable date", () => {
    expect(finYear("not a date")).toBe("");
    expect(finYearLabel("not a date")).toBe("");
  });

  it("labels the year the way people say it", () => expect(finYearLabel("2026-09-18")).toBe("2026-27"));
});
