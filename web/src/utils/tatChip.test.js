import { describe, it, expect } from "vitest";
import { tatChip, istShort, istStamp, overBy, parseIst, TAT_ICON } from "./tatChip";

// Fixed instants, asserted through Intl in Asia/Kolkata - so these hold
// whatever TZ the test runner has.
const NOW = new Date("2026-10-08T06:00:00Z"); // Thu 08 Oct 11:30 IST

describe("tatChip", () => {
  it.each([
    ["no clock at all", {}, null],
    ["no task", null, null],
  ])("%s -> null", (_n, task, out) => {
    expect(tatChip(task, NOW)).toBe(out);
  });

  it("held wins and names the reason", () => {
    const c = tatChip({ TatDueAt: "2026-10-08T05:00:00Z", TatHeldSince: "2026-10-08T04:00:00Z", TatHoldReason: "Waiting on client" }, NOW);
    expect(c).toEqual({ tone: "held", text: "On hold: Waiting on client", icon: TAT_ICON.held });
  });

  it("a held clock without a reason is Blocked (dependency hold)", () => {
    expect(tatChip({ TatHeldSince: "2026-10-08T04:00:00Z" }, NOW).text).toBe("On hold: Blocked");
  });

  it.each([
    ["25 minutes", "2026-10-08T05:35:00Z", "Over by 25m"],
    ["3h 10m", "2026-10-08T02:50:00Z", "Over by 3h 10m"],
    ["whole hours", "2026-10-08T03:00:00Z", "Over by 3h"],
    ["2d 4h", "2026-10-06T02:00:00Z", "Over by 2d 4h"],
    ["whole days", "2026-10-06T06:00:00Z", "Over by 2d"],
  ])("past due by %s", (_n, due, text) => {
    const c = tatChip({ TatDueAt: due }, NOW);
    expect(c.tone).toBe("over");
    expect(c.text).toBe(text);
  });

  // Regression (final review I2): reopen keeps BreachedAt but sets a fresh due; the chip
  // read "Over by 1m" for the whole reopened clock. The breach stays on record server-side.
  it("a reopened clock that ran over before reads its new due, not 'Over by'", () => {
    const c = tatChip({ TatDueAt: "2026-10-08T12:00:00Z", TatBreachedAt: "2026-10-07T06:00:00Z" }, NOW);
    expect(c).toEqual({ tone: "ok", text: "Due 17:30 IST", icon: TAT_ICON.ok });
  });

  it("a breached clock past its due still reads over", () => {
    const c = tatChip({ TatDueAt: "2026-10-08T05:35:00Z", TatBreachedAt: "2026-10-08T05:35:00Z" }, NOW);
    expect(c.text).toBe("Over by 25m");
  });

  it("before warn -> ok, same IST day -> time only", () => {
    const c = tatChip({ TatDueAt: "2026-10-08T12:00:00Z", TatWarnAt: "2026-10-08T10:00:00Z" }, NOW);
    expect(c).toEqual({ tone: "ok", text: "Due 17:30 IST", icon: TAT_ICON.ok });
  });

  it("at warn -> warn", () => {
    const c = tatChip({ TatDueAt: "2026-10-08T12:00:00Z", TatWarnAt: "2026-10-08T06:00:00Z" }, NOW);
    expect(c.tone).toBe("warn");
  });

  it("another IST day carries the weekday", () => {
    expect(tatChip({ TatDueAt: "2026-10-13T05:30:00Z" }, NOW).text).toBe("Due Tue 11:00 IST");
  });

  it("same UTC date but the next IST day still carries the weekday", () => {
    const now = new Date("2026-10-08T17:00:00Z"); // 22:30 IST Thu
    expect(tatChip({ TatDueAt: "2026-10-08T19:00:00Z" }, now).text).toBe("Due Fri 00:30 IST");
  });
});

describe("IST helpers", () => {
  it("parseIst reads a DB wall-clock string as IST", () => {
    expect(parseIst("2026-10-08 17:00:00").toISOString()).toBe("2026-10-08T11:30:00.000Z");
    expect(parseIst("2026-10-08 17:00").toISOString()).toBe("2026-10-08T11:30:00.000Z");
    expect(parseIst(null)).toBeNull();
  });
  it("istStamp / istShort format in IST and tolerate junk", () => {
    expect(istStamp("2026-10-08T11:30:00Z")).toBe("08 Oct 2026, 17:00 IST");
    expect(istStamp(null)).toBe("");
    expect(istShort("nope", NOW)).toBe("");
    expect(istShort(new Date("2026-10-08T11:30:00Z"), NOW)).toBe("17:00 IST");
  });
  it("overBy never says 0m", () => {
    expect(overBy(10)).toBe("1m");
  });
});
