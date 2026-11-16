import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import { dueAt, isPastDue } from "./followUpDue";

describe("dueAt", () => {
  it("joins date and time", () => expect(dueAt("2026-11-17", "12:30")).toBe("2026-11-17T12:30"));
  it("day only", () => expect(dueAt("2026-11-17", "")).toBe("2026-11-17"));
  it("no date, no value", () => expect(dueAt("", "12:30")).toBe(""));
});

describe("isPastDue", () => {
  const now = dayjs("2026-11-16T14:00");
  it("today day-only is not past", () => expect(isPastDue("2026-11-16", "", now)).toBe(false));
  it("earlier time today is past", () => expect(isPastDue("2026-11-16", "09:00", now)).toBe(true));
  it("the current minute is not past", () => expect(isPastDue("2026-11-16", "14:00", dayjs("2026-11-16T14:00:30"))).toBe(false));
  it("yesterday is past", () => expect(isPastDue("2026-11-15", "", now)).toBe(true));
  it("no date is not past", () => expect(isPastDue("", "09:00", now)).toBe(false));
  it("defaults now to the clock", () => expect(isPastDue("2000-01-01")).toBe(true));
});
