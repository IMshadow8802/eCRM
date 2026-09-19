import { describe, it, expect } from "vitest";
import { isActiveCode, LEAD_PRESETS, presetParams, leadsParamsToState } from "./leadStatus";

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

describe("leadsParamsToState", () => {
  const p = (s) => new URLSearchParams(s);

  it("seeds ids and the date range from a report drill-down URL", () => {
    expect(leadsParamsToState(p("StatusId=32&OwnerId=17&SourceId=11&ProductId=2&BranchId=1&from=2026-08-01&to=2026-08-31"))).toEqual({
      preset: "all",
      filters: { StatusId: 32, ProductId: 2, OwnerId: 17, SourceId: 11, BranchId: 1 },
      range: { from: "2026-08-01", to: "2026-08-31" },
    });
  });

  it("maps Overdue / Unassigned / StatusCode=lost onto the presets", () => {
    expect(leadsParamsToState(p("Overdue=1")).preset).toBe("overdue");
    expect(leadsParamsToState(p("Unassigned=true")).preset).toBe("unassigned");
    expect(leadsParamsToState(p("StatusCode=converted")).preset).toBe("won");
    expect(leadsParamsToState(p("StatusCode=lost")).preset).toBe("lost");
    expect(leadsParamsToState(p("")).preset).toBe("all");
  });

  it("drops anything that is not a positive integer or an ISO day", () => {
    expect(leadsParamsToState(p("StatusId=abc&OwnerId=-3&from=01/08/2026&to=2026-08-31"))).toEqual({
      preset: "all",
      filters: { StatusId: "", ProductId: "", OwnerId: "", SourceId: "", BranchId: "" },
      range: { from: "", to: "2026-08-31" },
    });
  });
});
