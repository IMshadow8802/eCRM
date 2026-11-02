import type { TaskTatEvent } from "../../types/api";
import {
  eventText,
  isWallClock,
  istDay,
  istShort,
  istStamp,
  dayIst,
  hm,
  parseIst,
  VERDICT_LABEL,
  whenIst,
} from "./tatChip";

// 2026-10-08 12:00 IST.
const NOW = new Date("2026-10-08T06:30:00Z");

describe("parseIst", () => {
  it("reads a DB wall-clock string as IST, anything else as an instant", () => {
    expect(parseIst("2026-10-08 17:00:00")!.toISOString()).toBe("2026-10-08T11:30:00.000Z");
    expect(parseIst("2026-10-08 17:00")!.toISOString()).toBe("2026-10-08T11:30:00.000Z");
    expect(parseIst("2026-10-08T11:30:00Z")!.toISOString()).toBe("2026-10-08T11:30:00.000Z");
    expect(parseIst(NOW)).toBe(NOW);
  });

  it("is null for nothing or nonsense", () => {
    expect(parseIst(null)).toBeNull();
    expect(parseIst(undefined)).toBeNull();
    expect(parseIst("")).toBeNull();
    expect(parseIst("soon")).toBeNull();
  });
});

it("istShort drops the weekday on the same IST day only", () => {
  expect(istShort("2026-10-08 17:30:00", NOW)).toBe("17:30 IST");
  expect(istShort("2026-10-13 11:00:00", NOW)).toBe("Tue 11:00 IST");
  // 23:30 UTC on the 8th is already the 9th in IST.
  expect(istShort("2026-10-08T23:30:00Z", NOW)).toBe("Fri 05:00 IST");
  expect(istShort(null, NOW)).toBe("");
});

it("istDay prints the IST day, and nothing for a missing or unparseable date", () => {
  // 19:00Z on 2 Nov is 00:30 IST on 3 Nov.
  expect(istDay("2026-11-02T19:00:00.000Z")).toBe("03 Nov 2026");
  expect(istDay(null)).toBe("");
  expect(istDay("not a date")).toBe("");
});

it("istStamp prints the full IST stamp", () => {
  expect(istStamp("2026-10-08 17:30:00")).toBe("08 Oct 2026, 17:30 IST");
  expect(istStamp(null)).toBe("");
});

describe("hm", () => {
  it("'8 h 00 m' — hours and zero-padded minutes, never below a minute", () => {
    const m = 60_000;
    expect(hm(480 * m)).toBe("8 h 00 m");
    expect(hm(221 * m)).toBe("3 h 41 m");
    expect(hm(5 * m)).toBe("0 h 05 m");
    expect(hm(27 * 60 * m)).toBe("27 h 00 m");
    expect(hm(-5)).toBe("0 h 00 m");
  });
});

describe("whenIst", () => {
  it("'Mon, 2 Nov · 11:00 am' in IST; '' for nothing", () => {
    expect(whenIst("2026-11-02 11:00:00")).toBe("Mon, 2 Nov · 11:00 am");
    expect(whenIst("2026-10-30T18:30:00Z")).toBe("Sat, 31 Oct · 12:00 am");
    expect(whenIst("2026-10-31 15:05:00")).toBe("Sat, 31 Oct · 3:05 pm");
    expect(whenIst(null)).toBe("");
  });
  it("the day alone", () => {
    expect(dayIst("2026-10-31 15:05:00")).toBe("Sat, 31 Oct");
    expect(dayIst(undefined)).toBe("");
  });
});

// parity: TAT-04 — port of web/src/utils/tatChip.js eventText/isWallClock.
describe("isWallClock", () => {
  it("is true only for a DB wall-clock string", () => {
    expect(isWallClock("2026-10-08 17:00:00")).toBe(true);
    expect(isWallClock("2026-10-08T11:30:00Z")).toBe(false);
    expect(isWallClock("blocked")).toBe(false);
    expect(isWallClock(null)).toBe(false);
  });
});

describe("eventText", () => {
  const ev = (Kind: string, NewValue: string | null = null, OldValue: string | null = null): TaskTatEvent => ({
    Id: 1, Kind, OldValue, NewValue, At: "2026-10-08 10:00:00", ActorName: null,
  });

  it("reads a due move as a deadline change, whatever its kind", () => {
    // Old is read against the new due's day: Thu 17:00 → (Fri) 11:00.
    expect(eventText(ev("recompute", "2026-10-09 11:00:00", "2026-10-08 17:00:00"))).toBe(
      "Deadline changed Thu 17:00 → 11:00 IST",
    );
    expect(eventText(ev("assign", "2026-10-08 17:00:00"))).toBe("Due set to 17:00 IST");
  });

  it("names every plain fact in words", () => {
    expect(eventText(ev("assign"))).toBe("Assigned");
    expect(eventText(ev("reopen"))).toBe("Reopened");
    expect(eventText(ev("resume"))).toBe("Timer restarted");
    expect(eventText(ev("hold", "blocked"))).toBe("On hold: blocked by a dependency");
    expect(eventText(ev("hold", "Waiting on client"))).toBe("Put on hold: Waiting on client");
    expect(eventText(ev("hold"))).toBe("Put on hold:");
    expect(eventText(ev("release", "auto"))).toBe("Resumed automatically");
    expect(eventText(ev("release", "blocked"))).toBe("Dependency done, timer running");
    expect(eventText(ev("release"))).toBe("Resumed");
    expect(eventText(ev("acknowledge"))).toBe("Accepted");
    expect(eventText(ev("my_part_done"))).toBe("Marked their part done");
    expect(eventText(ev("reason", "Parts late"))).toBe("Reason given: Parts late");
    expect(eventText(ev("reason"))).toBe("Reason given:");
    expect(eventText(ev("verdict", "excused"))).toBe("Decision: Delay accepted");
    expect(eventText(ev("verdict", "not_excused"))).toBe("Decision: Delay rejected");
    expect(eventText(ev("verdict", "odd"))).toBe("Decision: odd");
    expect(eventText(ev("verdict"))).toBe("Decision:");
    expect(eventText(ev("something_new"))).toBe("something_new");
  });

  it("labels both verdicts", () => {
    expect(VERDICT_LABEL).toEqual({ excused: "Delay accepted", not_excused: "Delay rejected" });
  });
});
