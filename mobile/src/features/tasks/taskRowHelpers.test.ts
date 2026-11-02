import { fetchTasks } from "../../api/taskQueries";
import { makeTask } from "../../test/fixtures";
import { doneThisWeek, myDoneQuery, shortDay, shortSpan, taskDueChip, weekStart } from "./taskHelpers";

jest.mock("../../api/taskQueries");

describe("myDoneQuery (G10)", () => {
  it("asks for my tasks finished or not, one 200-row page", async () => {
    await myDoneQuery(7).queryFn();
    expect(fetchTasks).toHaveBeenCalledWith({ WorkspaceId: null, AssigneeUserId: 7, OnlyOpen: false, PageSize: 200 });
    expect(myDoneQuery(7).enabled).toBe(true);
    expect(myDoneQuery(null).enabled).toBe(false);
  });
});

describe("doneThisWeek", () => {
  // Wed 4 Nov 2026, 10:00 IST → the week starts Mon 2 Nov 00:00.
  const now = new Date(2026, 10, 4, 10, 0);
  it("keeps completed tasks finished on or after Monday 00:00", () => {
    const tasks = [
      makeTask({ Id: 1, IsCompleted: true, CompletedDate: "2026-11-02T00:00:00" }),
      makeTask({ Id: 2, IsCompleted: true, CompletedDate: "2026-11-01T23:59:00" }),
      makeTask({ Id: 3, IsCompleted: false, CompletedDate: null }),
      makeTask({ Id: 4, IsCompleted: true, CompletedDate: null }),
    ];
    expect(doneThisWeek(tasks, now).map((t) => t.Id)).toEqual([1]);
  });
  it("reads a DB wall-clock completion as IST", () => {
    const tasks = [
      makeTask({ Id: 7, IsCompleted: true, CompletedDate: "2026-11-02 00:30:00" }),
      makeTask({ Id: 8, IsCompleted: true, CompletedDate: "2026-11-01 23:30:00" }),
    ];
    expect(doneThisWeek(tasks, now).map((t) => t.Id)).toEqual([7]);
  });
  it("a Sunday belongs to the week that started six days before", () => {
    expect(weekStart(new Date(2026, 10, 8, 23, 0))).toEqual(new Date(2026, 10, 2));
  });
});

describe("shortSpan", () => {
  it.each([
    [30_000, "1 m"],
    [42 * 60_000, "42 m"],
    [3 * 3_600_000 + 10 * 60_000, "3 h"],
    [47 * 3_600_000, "47 h"],
    [50 * 3_600_000, "2 d"],
  ])("%i ms → %s", (ms, text) => expect(shortSpan(ms)).toBe(text));
});

describe("shortDay", () => {
  it("'Fri, 6 Nov' from a SQL date; '' for nothing", () => {
    expect(shortDay("2026-11-06")).toBe("Fri, 6 Nov");
    expect(shortDay("2026-11-06T00:00:00")).toBe("Fri, 6 Nov");
    expect(shortDay(null)).toBe("");
    expect(shortDay("junk")).toBe("");
  });
});

describe("taskDueChip (05 line 3)", () => {
  const now = new Date("2026-11-02T12:00:00+05:30");
  it("a personal workspace's task reads Personal, whatever its date", () => {
    expect(taskDueChip(makeTask({ DueDate: "2026-11-06" }), true, now)).toMatchObject({ label: "Personal", tone: "slate" });
  });
  it("an open clock is butter 'Due in …'; past it, red 'Missed'", () => {
    expect(taskDueChip(makeTask({ TatDueAt: "2026-11-02 15:00:00" }), false, now)).toMatchObject({ label: "Due in 3 h", tone: "butter" });
    expect(taskDueChip(makeTask({ TatDueAt: "2026-11-02 11:00:00" }), false, now)).toMatchObject({ label: "Missed", tone: "red" });
  });
  it("a held clock says so", () => {
    expect(taskDueChip(makeTask({ TatDueAt: "2026-11-02 11:00:00", TatHeldSince: "2026-11-02 10:00:00" }), false, now))
      .toMatchObject({ label: "On hold", tone: "slate" });
  });
  it("no clock: the due date, slate; red once the day is past; none without a date or when done", () => {
    expect(taskDueChip(makeTask({ DueDate: "2026-11-06" }), false, now)).toMatchObject({ label: "Fri, 6 Nov", tone: "slate" });
    expect(taskDueChip(makeTask({ DueDate: "2026-10-30" }), false, now)).toMatchObject({ label: "Fri, 30 Oct", tone: "red" });
    expect(taskDueChip(makeTask({ DueDate: null }), false, now)).toBeNull();
    expect(taskDueChip(makeTask({ DueDate: "2026-11-06", IsCompleted: true }), false, now)).toBeNull();
  });
});
