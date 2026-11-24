import { describe, it, expect } from "vitest";

import { COLUMNS } from "./columns";
import { REPORTS } from "./reports";

describe("REPORTS", () => {
  it("six reports, in menu order, with their own paths and defaults", () => {
    expect(Object.keys(REPORTS)).toEqual(["team", "sources", "open", "lost", "won", "calling"]);
    expect(Object.values(REPORTS).map((r) => r.defaultPreset)).toEqual(["yesterday", "month", "any", "month", "month", "yesterday"]);
    for (const [slug, r] of Object.entries(REPORTS)) {
      expect(r.slug).toBe(slug);
      expect(r.path).toBe(`/reports/sales/${slug}`);
    }
  });
  it("every column a report names exists, and every hint is filled", () => {
    for (const r of Object.values(REPORTS)) for (const k of [...(r.columns ?? []), ...(r.exportOnly ?? [])]) expect(COLUMNS[k]?.hint).toBeTruthy();
  });
  it("every column a line names exists; Calling has both lines and Lead sources offers Calling list", () => {
    for (const r of Object.values(REPORTS)) for (const l of r.lines ?? []) for (const k of l.columns) expect(COLUMNS[k]?.hint).toBeTruthy();
    expect(REPORTS.calling.lines.map((l) => l.value)).toEqual(["caller", "calllist"]);
    expect(REPORTS.sources.lines.map((l) => l.label)).toEqual(["Source", "Calling list"]);
  });
  it("calling ratios guard their divisions", () => {
    expect(COLUMNS.reachPct.value({ DialReached: 1, Dials: 4 })).toBe(25);
    expect(COLUMNS.reachPct.value({ DialReached: 1, Dials: 0 })).toBeNull();
    expect(COLUMNS.avgDialSec.value({ DialSecSum: 90, DialSecN: 3 })).toBe(30);
    expect(COLUMNS.costPerLead.value({ ListCost: 42000, New: 78 })).toBeCloseTo(538.46);
    expect(COLUMNS.returnPerRupee.value({ CohortWonValue: 100, ListCost: null })).toBeNull();
    expect(COLUMNS.costPerWon.value({ ListCost: 100, CohortWon: 0 })).toBeNull();
    expect(COLUMNS.sheetBadPct.value({ SkippedDup: 1, SkippedBad: 1, SheetRows: 8 })).toBe(25);
    expect(COLUMNS.usedPct.value({ ListUsed: 1, ListContacts: 2 })).toBe(50);
    expect(COLUMNS.leadPct.value({ New: 2, DialReached: 8 })).toBe(25);
    expect(Object.values(COLUMNS).filter((c) => c.cost).map((c) => c.key)).toEqual(["listCost", "costPerLead", "costPerWon", "returnPerRupee"]);
  });
  it("every column knows its own key", () => {
    for (const [k, c] of Object.entries(COLUMNS)) expect(c.key).toBe(k);
  });
  it("no retired word reaches a screen", () => {
    const words = JSON.stringify([REPORTS, Object.values(COLUMNS).map(({ header, hint }) => [header, hint])]).toLowerCase();
    for (const w of ["pipeline", "funnel", "leaderboard", "compliance", "aging"]) expect(words).not.toContain(w);
  });
  it("derived values guard their divisions", () => {
    expect(COLUMNS.visits.value({ Visits: 2, Meetings: 3 })).toBe(5);
    expect(COLUMNS.visits.value({})).toBe(0);
    expect(COLUMNS.due.value({ FuOnTime: 1, FuLate: 2, FuSkipped: 3, FuMissed: 4, FuOpen: 5 })).toBe(15);
    expect(COLUMNS.conversion.value({ New: 4, CohortWon: 1 })).toBe(25);
    expect(COLUMNS.conversion.value({ New: 0 })).toBeNull();
    expect(COLUMNS.share.value({ Lost: 1 }, { Lost: 4 })).toBe(25);
    expect(COLUMNS.share.value({ Lost: 1 }, {})).toBeNull();
    expect(COLUMNS.avgDays.value({ DaysOpenSum: 9, DaysOpenN: 3 })).toBe(3);
    expect(COLUMNS.avgDays.value({})).toBeNull();
    expect(COLUMNS.new.value({})).toBeNull();
  });
});
