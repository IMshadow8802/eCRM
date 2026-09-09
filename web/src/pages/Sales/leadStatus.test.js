import { describe, it, expect } from "vitest";
import { isActiveCode, LEAD_PRESETS, presetParams } from "./leadStatus";

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
    expect(presetParams("lost")).toEqual({ StatusCode: "lost" });
    expect(presetParams("all")).toEqual({});
    expect(LEAD_PRESETS.map((p) => p.value)).toEqual(["all", "mine", "overdue", "unassigned", "lost"]);
  });
});
