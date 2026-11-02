import { CirclePause, Clock, OctagonAlert, TriangleAlert } from "lucide-react-native";

import { istShort, istStamp, overBy, parseIst, tatChip } from "./tatChip";

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

it("istStamp prints the full IST stamp", () => {
  expect(istStamp("2026-10-08 17:30:00")).toBe("08 Oct 2026, 17:30 IST");
  expect(istStamp(null)).toBe("");
});

it("overBy rounds down to minutes, hours, days — never zero", () => {
  const m = 60_000;
  expect(overBy(0)).toBe("1m");
  expect(overBy(25 * m)).toBe("25m");
  expect(overBy(180 * m)).toBe("3h");
  expect(overBy(190 * m)).toBe("3h 10m");
  expect(overBy(48 * 60 * m)).toBe("2d");
  expect(overBy(52 * 60 * m)).toBe("2d 4h");
});

describe("tatChip", () => {
  it("no clock, no chip", () => {
    expect(tatChip(null, NOW)).toBeNull();
    expect(tatChip({}, NOW)).toBeNull();
    expect(tatChip({ TatDueAt: "whenever" }, NOW)).toBeNull();
  });

  it("a hold wins over the due time", () => {
    expect(tatChip({ TatHeldSince: "2026-10-08 09:00:00", TatHoldReason: "Waiting on client", TatDueAt: "2026-10-01 10:00:00" }, NOW))
      .toEqual({ tone: "neutral", text: "On hold: Waiting on client", icon: CirclePause });
    expect(tatChip({ TatHeldSince: "2026-10-08 09:00:00" }, NOW)!.text).toBe("On hold: Blocked");
  });

  it("past due reads late, in danger", () => {
    expect(tatChip({ TatDueAt: "2026-10-08 10:30:00" }, NOW)).toEqual({
      tone: "danger",
      text: "Late by 1h 30m",
      icon: OctagonAlert,
    });
  });

  it("warns once the warn time has passed, otherwise just shows the due time", () => {
    expect(tatChip({ TatDueAt: "2026-10-08 17:30:00", TatWarnAt: "2026-10-08 11:00:00" }, NOW)).toEqual({
      tone: "warning",
      text: "Due 17:30 IST",
      icon: TriangleAlert,
    });
    expect(tatChip({ TatDueAt: "2026-10-08 17:30:00", TatWarnAt: "2026-10-08 16:00:00" }, NOW)).toEqual({
      tone: "info",
      text: "Due 17:30 IST",
      icon: Clock,
    });
  });
});
