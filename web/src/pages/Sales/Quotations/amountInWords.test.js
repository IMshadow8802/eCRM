import { describe, it, expect } from "vitest";
import { amountInWords } from "./amountInWords";

describe("amountInWords", () => {
  it.each([
    [0, "Rupees Zero Only"],
    [7, "Rupees Seven Only"],
    [19, "Rupees Nineteen Only"],
    [40, "Rupees Forty Only"],
    [99, "Rupees Ninety Nine Only"],
    [100, "Rupees One Hundred Only"],
    [4000, "Rupees Four Thousand Only"],
    [302400, "Rupees Three Lakh Two Thousand Four Hundred Only"],
    [1000000, "Rupees Ten Lakh Only"],
    [10000000, "Rupees One Crore Only"],
    [123456789, "Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only"],
    [1200000000, "Rupees One Hundred Twenty Crore Only"],
    [10005, "Rupees Ten Thousand Five Only"],
  ])("%s → %s", (n, text) => expect(amountInWords(n)).toBe(text));

  it("names paise when there are any", () => {
    expect(amountInWords(1250.5)).toBe("Rupees One Thousand Two Hundred Fifty and Paise Fifty Only");
    expect(amountInWords(0.07)).toBe("Rupees Zero and Paise Seven Only");
  });

  it("rounds the exact halfway paisa away from zero, not down the way n*100 would", () => {
    // 1.005 * 100 is 100.49999999999999 in a double, which Math.round takes
    // down to 100 paise (zero paise). Half away from zero must land on 101.
    expect(amountInWords(1.005)).toBe("Rupees One and Paise One Only");
    expect(amountInWords(0.005)).toBe("Rupees Zero and Paise One Only");
  });

  it("is empty for anything that is not an amount", () => {
    expect(amountInWords(-5)).toBe("");
    expect(amountInWords("abc")).toBe("");
    expect(amountInWords(undefined)).toBe("");
  });

  // The decimal shift is a string operation, so a value JavaScript prints in
  // exponential notation would parse back as NaN rather than a number.
  it.each([[1e21], [1e-7]])("is empty for %p, which has no sane rupee reading", (n) =>
    expect(amountInWords(n)).toBe(""));
});
