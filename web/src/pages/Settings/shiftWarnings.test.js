import { describe, it, expect } from "vitest";
import shiftWarnings from "./shiftWarnings";

const day = (d, start, end, extra = {}) => ({ d, on: true, start, end, ...extra });
const brk = { breakStart: "13:00", breakEnd: "14:00" };

describe("shiftWarnings", () => {
  it("is quiet for a normal day with a break", () => {
    expect(shiftWarnings([day(1, "09:30", "18:30", brk)])).toEqual([]);
  });
  it("flags > 9 hours worked", () => {
    expect(shiftWarnings([day(2, "08:00", "19:00", brk)])).toEqual(["> 9 hours on Tuesday"]);
  });
  it("flags no break after 5 hours", () => {
    expect(shiftWarnings([day(3, "10:00", "16:00")])).toEqual(["No break after 5 hours on Wednesday"]);
  });
  it("flags night hours, including a shift that crosses midnight and an early start", () => {
    const w = shiftWarnings([day(5, "22:00", "06:00", { breakStart: "01:00", breakEnd: "02:00" }), day(6, "05:00", "09:00")]);
    expect(w).toContain("Night hours (21:00–06:00) on Friday — check the rules for women staff");
    expect(w).toContain("Night hours (21:00–06:00) on Saturday — check the rules for women staff");
  });
  it("flags > 48 hours a week and skips off days", () => {
    const week = [1, 2, 3, 4, 5, 6].map((d) => day(d, "09:00", "18:30", brk)); // 8.5h x 6 = 51h
    week.push({ d: 0, on: false, start: "00:00", end: "23:00" });
    expect(shiftWarnings(week)).toEqual(["> 48 hours a week"]);
  });
  it("copes with no days", () => {
    expect(shiftWarnings()).toEqual([]);
  });
});
