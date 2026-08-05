import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, formatCurrency } from "./format";

describe("formatDate", () => {
  it("renders DD-MM-YYYY", () => {
    expect(formatDate("2026-08-05")).toBe("05-08-2026");
  });

  it("accepts a full timestamp and drops the time", () => {
    expect(formatDate("2026-08-05T14:30:00Z")).toBe("05-08-2026");
  });

  it("accepts a Date object", () => {
    expect(formatDate(new Date(2026, 7, 5))).toBe("05-08-2026");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("returns the empty value for %s", (_label, value) => {
    expect(formatDate(value)).toBe("");
  });

  it("returns the empty value for an unparseable date rather than 'Invalid Date'", () => {
    // The Master implementations caught a throw and returned ""; dayjs does not
    // throw, it yields an invalid instance whose .format() is the literal string
    // "Invalid Date". Rendering that into a table cell is worse than a blank.
    expect(formatDate("not a date")).toBe("");
  });

  it("honours a custom empty placeholder", () => {
    expect(formatDate(null, { empty: "—" })).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("renders DD-MM-YYYY HH:mm", () => {
    expect(formatDateTime("2026-08-05T14:30:00")).toBe("05-08-2026 14:30");
  });

  it("returns the empty value for a missing input", () => {
    expect(formatDateTime(null)).toBe("");
  });
});

describe("formatCurrency", () => {
  /**
   * The grouping is the reason this delegates to Intl: en-IN groups in
   * lakhs (1,23,456) not thousands (123,456).
   */
  it("uses lakh grouping and two decimals", () => {
    expect(formatCurrency(123456)).toBe("₹1,23,456.00");
  });

  it("keeps paisa when present", () => {
    expect(formatCurrency(123456.5)).toBe("₹1,23,456.50");
  });

  it("formats zero rather than treating it as absent", () => {
    // 0 is a real budget; only null/undefined/"" mean "not set".
    expect(formatCurrency(0)).toBe("₹0.00");
  });

  it("accepts a numeric string, which is what the API sends for decimals", () => {
    expect(formatCurrency("123456")).toBe("₹1,23,456.00");
  });

  it("handles a crore without losing the grouping", () => {
    expect(formatCurrency(12345678)).toBe("₹1,23,45,678.00");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["non-numeric", "abc"],
  ])("returns the empty value for %s", (_label, value) => {
    expect(formatCurrency(value)).toBe("");
  });

  it("honours a custom empty placeholder", () => {
    expect(formatCurrency(null, { empty: "—" })).toBe("—");
  });
});
