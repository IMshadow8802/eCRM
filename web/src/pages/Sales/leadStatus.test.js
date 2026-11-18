import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import {
  isActiveCode, LEAD_PRESETS, presetParams, leadsParamsToState, leadsStateToParams,
  isStale, STALE_DAYS, LEAD_SORTS, statusChipColors,
} from "./leadStatus";

describe("leadStatus helpers", () => {
  it("treats open and qualified as active, the rest as closed", () => {
    expect(isActiveCode("open")).toBe(true);
    expect(isActiveCode("qualified")).toBe(true);
    expect(isActiveCode("lost")).toBe(false);
    expect(isActiveCode("junk")).toBe(false);
    expect(isActiveCode(undefined)).toBe(false);
  });

  it("maps presets onto fetchLeads params", () => {
    expect(presetParams("mine", 7)).toEqual({ OwnerId: 7 });
    expect(presetParams("overdue")).toEqual({ Overdue: true });
    expect(presetParams("unassigned")).toEqual({ Unassigned: true });
    expect(presetParams("won")).toEqual({ StatusCode: "converted" });
    expect(presetParams("lost")).toEqual({ StatusCode: "lost" });
    expect(presetParams("all")).toEqual({});
    expect(LEAD_PRESETS.map((p) => p.value)).toEqual(["all", "mine", "overdue", "unassigned", "won", "lost"]);
  });
});

const NOW = new Date(2026, 10, 18, 9, 40);

describe("isStale", () => {
  it("is seven days", () => expect(STALE_DAYS).toBe(7));
  it.each([
    [{ StatusCode: "open", CreatedAt: "2026-11-01T10:00:00", LastActivityAt: "2026-11-10T10:00:00" }, true],
    [{ StatusCode: "open", CreatedAt: "2026-11-01T10:00:00", LastActivityAt: "2026-11-12T10:00:00" }, false],
    [{ StatusCode: "qualified", CreatedAt: "2026-10-10T15:05:00", LastActivityAt: null }, true], // never touched, old
    [{ StatusCode: "open", CreatedAt: "2026-11-17T10:00:00", LastActivityAt: null }, false], // never touched, new
    [{ StatusCode: "converted", CreatedAt: "2026-01-01T10:00:00", LastActivityAt: null }, false], // closed is never stale
  ])("isStale %j -> %s", (lead, out) => expect(isStale(lead, NOW)).toBe(out));
  it("defaults now to the clock and survives a lead with no dates", () => {
    expect(isStale({ StatusCode: "open", CreatedAt: "2000-01-01T00:00:00" })).toBe(true);
    expect(isStale({ StatusCode: "open" }, NOW)).toBe(false);
  });
});

describe("leadsParamsToState / leadsStateToParams", () => {
  it("lists the server's sort names", () => {
    expect(LEAD_SORTS).toEqual(["name", "created", "lastActivity", "value", "nextFollowUp"]);
  });

  it("reads ids, created and sort; garbage falls back", () => {
    const s = leadsParamsToState(new URLSearchParams("OwnerId=17&created=lastMonth&sort=lastActivity&dir=asc"), dayjs(NOW));
    expect(s.filters.OwnerId).toBe(17);
    expect(s.created).toMatchObject({ preset: "lastMonth", from: "2026-10-01", to: "2026-10-31" });
    expect(s.sorting).toEqual([{ id: "lastActivity", desc: false }]);
    const bad = leadsParamsToState(new URLSearchParams("OwnerId=abc&created=nonsense&sort=;drop&dir=sideways"), dayjs(NOW));
    expect(bad.filters.OwnerId).toBe("");
    expect(bad.created.preset).toBe("any");
    expect(bad.sorting).toEqual([{ id: "created", desc: true }]);
  });

  it("reads every id filter and a backwards custom range as an error", () => {
    const s = leadsParamsToState(new URLSearchParams("StatusId=32&ProductId=2&SourceId=11&BranchId=1&PartnerId=3&OwnerId=-3&created=custom&from=2026-09-30&to=2026-09-01&sort=value"), dayjs(NOW));
    expect(s.filters).toEqual({ StatusId: 32, ProductId: 2, OwnerId: "", SourceId: 11, BranchId: 1, PartnerId: 3 });
    expect(s.created).toEqual({ preset: "custom", from: "2026-09-30", to: "2026-09-01", error: "To is before From" });
    expect(s.sorting).toEqual([{ id: "value", desc: true }]);
  });

  it("no longer reads the old report keys", () => {
    const s = leadsParamsToState(new URLSearchParams("StatusCode=lost&Overdue=1&Unassigned=1"), dayjs(NOW));
    expect(s).not.toHaveProperty("preset");
    expect(leadsStateToParams(s)).toEqual({});
  });

  it("writes only what differs from the defaults", () => {
    expect(leadsStateToParams({ filters: { OwnerId: 17, StatusId: "" }, created: { preset: "any" }, sorting: [{ id: "created", desc: true }] }))
      .toEqual({ OwnerId: "17" });
    expect(leadsStateToParams({ filters: {}, created: { preset: "custom", from: "2026-09-01", to: "2026-09-30" }, sorting: [{ id: "value", desc: false }] }))
      .toEqual({ created: "custom", from: "2026-09-01", to: "2026-09-30", sort: "value", dir: "asc" });
    expect(leadsStateToParams({ filters: {}, created: { preset: "yesterday" }, sorting: [{ id: "created", desc: false }] }))
      .toEqual({ created: "yesterday", sort: "created", dir: "asc" });
    expect(leadsStateToParams({ filters: {}, created: { preset: "any" }, sorting: [] })).toEqual({});
  });
});

describe("statusChipColors", () => {
  it("colours won and lost from the report key, leaves the rest alone", () => {
    expect(statusChipColors("converted")).toEqual({ bg: "#ECFDF5", text: "#047857" });
    expect(statusChipColors("lost")).toEqual({ bg: "#FEF2F2", text: "#DC2626" });
    expect(statusChipColors("open")).toBeUndefined();
    expect(statusChipColors("junk")).toBeUndefined();
  });
});
