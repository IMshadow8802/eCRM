import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import { PRESETS, ANY, presetRange, rangeLabel, shortRangeLabel, readRange, writeRange } from "./datePresets";

// Wednesday 18 Nov 2026
const W = dayjs("2026-11-18T00:30:00"); // just past midnight, local

describe("presets", () => {
  it("lists the six presets and Any time", () => {
    expect(PRESETS.map((p) => [p.value, p.label])).toEqual([
      ["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"],
      ["month", "This month"], ["lastMonth", "Last month"], ["custom", "Custom"],
    ]);
    expect(ANY).toEqual({ value: "any", label: "Any time" });
  });
});

describe("presetRange", () => {
  it.each([
    ["today", "2026-11-18", "2026-11-18"],
    ["yesterday", "2026-11-17", "2026-11-17"],
    ["week", "2026-11-16", "2026-11-22"], // Monday to Sunday
    ["month", "2026-11-01", "2026-11-30"],
    ["lastMonth", "2026-10-01", "2026-10-31"],
  ])("%s", (p, from, to) => expect(presetRange(p, W)).toEqual({ from, to }));
  it("a Sunday belongs to the week that started on Monday", () =>
    expect(presetRange("week", dayjs("2026-11-22T10:00:00"))).toEqual({ from: "2026-11-16", to: "2026-11-22" }));
  it("last month in January is December of the year before", () =>
    expect(presetRange("lastMonth", dayjs("2027-01-01T09:00:00"))).toEqual({ from: "2026-12-01", to: "2026-12-31" }));
  it("any, custom and unknown have no range of their own", () => {
    for (const p of ["any", "custom", "nope"]) expect(presetRange(p, W)).toBeNull();
  });
  it("defaults today to now", () => expect(presetRange("today")).toEqual({ from: dayjs().format("YYYY-MM-DD"), to: dayjs().format("YYYY-MM-DD") }));
});

describe("labels", () => {
  it.each([
    [{ from: "2026-11-17", to: "2026-11-17" }, "17 Nov 2026"],
    [{ from: "2026-11-01", to: "2026-11-30" }, "1 – 30 Nov 2026"],
    [{ from: "2026-10-28", to: "2026-11-03" }, "28 Oct – 3 Nov 2026"],
    [{ from: "2025-12-30", to: "2026-01-05" }, "30 Dec 2025 – 5 Jan 2026"],
  ])("rangeLabel %j", (r, text) => expect(rangeLabel(r)).toBe(text));

  it.each([
    [{ from: "2026-11-17", to: "2026-11-17" }, "17-11-2026"],
    [{ from: "2026-11-16", to: "2026-11-22" }, "16 – 22 Nov"],
    [{ from: "2026-10-28", to: "2026-11-03" }, "28 Oct – 3 Nov"],
    [{ from: "2025-09-01", to: "2025-09-30" }, "1 – 30 Sep 2025"],
    [{ from: "2025-12-30", to: "2026-01-05" }, "30 Dec 2025 – 5 Jan 2026"],
  ])("shortRangeLabel %j drops this year only", (r, text) => expect(shortRangeLabel(r, W)).toBe(text));
});

const q = (s) => new URLSearchParams(s);
describe("readRange / writeRange", () => {
  it("readRange: default, a named preset, custom, any", () => {
    expect(readRange(q(""), { defaultPreset: "yesterday", today: W })).toEqual({ preset: "yesterday", from: "2026-11-17", to: "2026-11-17", error: null });
    expect(readRange(q("preset=month"), { defaultPreset: "yesterday", today: W })).toMatchObject({ preset: "month", from: "2026-11-01" });
    expect(readRange(q("preset=custom&from=2026-09-01&to=2026-09-30"), { defaultPreset: "yesterday", today: W })).toMatchObject({ preset: "custom", from: "2026-09-01", to: "2026-09-30", error: null });
    expect(readRange(q("created=any"), { key: "created", defaultPreset: "any", allowAny: true, today: W })).toEqual({ preset: "any", from: null, to: null, error: null });
    expect(readRange(q(""), { key: "created", defaultPreset: "any", allowAny: true, today: W })).toEqual({ preset: "any", from: null, to: null, error: null });
  });
  it("readRange: garbage falls back to the default; a backwards custom range is an error", () => {
    expect(readRange(q("preset=nonsense"), { defaultPreset: "yesterday", today: W }).preset).toBe("yesterday");
    expect(readRange(q("preset=any"), { defaultPreset: "yesterday", today: W }).preset).toBe("yesterday"); // any not allowed here
    expect(readRange(q("preset=custom&from=2026-02-30&to=2026-03-01"), { defaultPreset: "yesterday", today: W }).preset).toBe("yesterday");
    expect(readRange(q("preset=custom&from=2026-09-01"), { defaultPreset: "yesterday", today: W }).preset).toBe("yesterday");
    expect(readRange(q("preset=custom&from=2026-09-30&to=2026-09-01"), { defaultPreset: "yesterday", today: W }).error).toBe("To is before From");
  });
  it("writeRange leaves the default out and writes from/to only for custom", () => {
    expect(writeRange({ preset: "yesterday" }, { defaultPreset: "yesterday" })).toEqual({});
    expect(writeRange({ preset: "month" }, { defaultPreset: "yesterday" })).toEqual({ preset: "month" });
    expect(writeRange({ preset: "custom", from: "2026-09-01", to: "2026-09-30" }, { key: "created", defaultPreset: "any" }))
      .toEqual({ created: "custom", from: "2026-09-01", to: "2026-09-30" });
  });
});
