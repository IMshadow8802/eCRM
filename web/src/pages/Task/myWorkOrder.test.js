import { describe, it, expect } from "vitest";
import { orderMyWork, isOverdue } from "./myWorkOrder";

const today = new Date(2026, 9, 7, 15);
const ids = (l) => orderMyWork(l, today).map((t) => t.Id);

describe("orderMyWork", () => {
  it("overdue first, oldest due first", () => {
    expect(ids([{ Id: 1, DueDate: "2026-10-05" }, { Id: 2, DueDate: "2026-10-01" }])).toEqual([2, 1]);
  });
  it("overdue before today before upcoming before undated", () => {
    expect(
      ids([{ Id: 4 }, { Id: 3, DueDate: "2026-10-09" }, { Id: 2, DueDate: "2026-10-07" }, { Id: 1, DueDate: "2026-10-06" }]),
    ).toEqual([1, 2, 3, 4]);
  });
  it("upcoming soonest first", () => {
    expect(ids([{ Id: 1, DueDate: "2026-10-20" }, { Id: 2, DueDate: "2026-10-10" }])).toEqual([2, 1]);
  });
  it("same day ties break by priority; undated by priority too", () => {
    expect(
      ids([
        { Id: 1, DueDate: "2026-10-07", Priority: "low" },
        { Id: 2, DueDate: "2026-10-07", Priority: "critical" },
        { Id: 3, Priority: "medium" },
        { Id: 4, Priority: "high" },
      ]),
    ).toEqual([2, 1, 4, 3]);
  });
  it("isOverdue is date-only", () => {
    expect(isOverdue({ DueDate: "2026-10-07" }, today)).toBe(false);
    expect(isOverdue({ DueDate: "2026-10-06" }, today)).toBe(true);
    expect(isOverdue({}, today)).toBe(false);
  });
});
