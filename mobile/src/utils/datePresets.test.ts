import { ANY, PRESETS, presetRange, rangeLabel, type DatePreset } from "./datePresets";

// Wednesday 18 Nov 2026, just past midnight, local
const W = new Date(2026, 10, 18, 0, 30);

it("lists the six presets and Any time, the web's labels", () => {
  expect(PRESETS.map((p) => [p.value, p.label])).toEqual([
    ["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"],
    ["month", "This month"], ["lastMonth", "Last month"], ["custom", "Custom"],
  ]);
  expect(ANY).toEqual({ value: "any", label: "Any time" });
});

describe("presetRange", () => {
  it.each([
    ["today", "2026-11-18", "2026-11-18"],
    ["yesterday", "2026-11-17", "2026-11-17"],
    ["week", "2026-11-16", "2026-11-22"], // Monday to Sunday
    ["month", "2026-11-01", "2026-11-30"],
    ["lastMonth", "2026-10-01", "2026-10-31"],
  ] as [DatePreset, string, string][])("%s", (p, from, to) => expect(presetRange(p, W)).toEqual({ from, to }));
  it("a Sunday belongs to the week that started on Monday", () =>
    expect(presetRange("week", new Date(2026, 10, 22, 10))).toEqual({ from: "2026-11-16", to: "2026-11-22" }));
  it("last month in January is December of the year before", () =>
    expect(presetRange("lastMonth", new Date(2027, 0, 1, 9))).toEqual({ from: "2026-12-01", to: "2026-12-31" }));
  it("yesterday on the 1st of March is the last day of February", () =>
    expect(presetRange("yesterday", new Date(2027, 2, 1, 9))).toEqual({ from: "2027-02-28", to: "2027-02-28" }));
  it("any and custom have no range of their own", () => {
    expect(presetRange("any", W)).toBeNull();
    expect(presetRange("custom", W)).toBeNull();
  });
  it("defaults today to now", () => {
    const n = new Date();
    const d = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    expect(presetRange("today")).toEqual({ from: d, to: d });
  });
});

it.each([
  [{ from: "2026-11-17", to: "2026-11-17" }, "17 Nov 2026"],
  [{ from: "2026-11-01", to: "2026-11-30" }, "1 – 30 Nov 2026"],
  [{ from: "2026-10-28", to: "2026-11-03" }, "28 Oct – 3 Nov 2026"],
  [{ from: "2025-12-30", to: "2026-01-05" }, "30 Dec 2025 – 5 Jan 2026"],
])("rangeLabel %j", (r, text) => expect(rangeLabel(r)).toBe(text));
