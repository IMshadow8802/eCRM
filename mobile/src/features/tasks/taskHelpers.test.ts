import { assigneesJson, makeComment, makeTask } from "../../test/fixtures";
import type { WorkspaceRole, WorkspaceType } from "../../types/api";
import {
  abilitiesFor,
  assigneesOf,
  checklistProgress,
  dueBucket,
  dueLabel,
  formatHours,
  groupByDue,
  isAssignee,
  isUnassigned,
  relativeTime,
  threadComments,
  workspaceAbilities,
} from "./taskHelpers";

// Local wall-clock times: the helpers compare local calendar days.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe("assigneesOf", () => {
  it("reads every assignee from AssigneesJson, never only the mirror", () => {
    const task = makeTask({
      AssigneesJson: assigneesJson([5, "Asha"], [6, "Ravi"]),
      AssignedToUserId: 5,
      AssigneeName: "Asha",
    });
    expect(assigneesOf(task).map((a) => a.UserId)).toEqual([5, 6]);
  });

  it("falls back to the scalar mirror when the JSON is malformed or not a list", () => {
    const mirror = { AssignedToUserId: 5, AssigneeName: "Asha" };
    expect(assigneesOf(makeTask({ ...mirror, AssigneesJson: "{oops" }))).toEqual([
      { UserId: 5, FullName: "Asha", Avatar: null },
    ]);
    expect(assigneesOf(makeTask({ ...mirror, AssigneesJson: '{"UserId":5}' }))).toHaveLength(1);
    expect(assigneesOf(makeTask({ AssignedToUserId: 5, AssigneeName: null }))[0]!.FullName).toBe("");
  });

  it("is empty when nobody is on the task", () => {
    expect(assigneesOf(makeTask())).toEqual([]);
    expect(isUnassigned(makeTask())).toBe(true);
    expect(isUnassigned(makeTask({ AssigneesJson: assigneesJson([5, "Asha"]) }))).toBe(false);
  });

  it("isAssignee matches a co-assignee and never a signed-out caller", () => {
    const task = makeTask({ AssigneesJson: assigneesJson([5, "Asha"], [6, "Ravi"]) });
    expect(isAssignee(task, 6)).toBe(true);
    expect(isAssignee(task, 7)).toBe(false);
    expect(isAssignee(task, null)).toBe(false);
  });
});

describe("dueBucket", () => {
  const now = at(2026, 11, 2);

  it("buckets by local calendar day", () => {
    expect(dueBucket(null, now)).toBe("noDate");
    expect(dueBucket("garbage", now)).toBe("noDate");
    expect(dueBucket("2026-11-01", now)).toBe("overdue");
    expect(dueBucket("2026-11-02", now)).toBe("today");
    expect(dueBucket("2026-11-03", now)).toBe("tomorrow");
    expect(dueBucket("2026-11-09", now)).toBe("thisWeek");
    expect(dueBucket("2026-11-10", now)).toBe("later");
  });

  it("reads a SQL datetime string by its date part", () => {
    expect(dueBucket("2026-11-02T00:00:00.000Z", now)).toBe("today");
  });

  it("flips at local midnight, not at UTC midnight", () => {
    expect(dueBucket("2026-11-02", at(2026, 11, 2, 23, 59))).toBe("today");
    expect(dueBucket("2026-11-03", at(2026, 11, 2, 23, 59))).toBe("tomorrow");
    expect(dueBucket("2026-11-03", at(2026, 11, 3, 0, 1))).toBe("today");
    expect(dueBucket("2026-11-02", at(2026, 11, 3, 0, 1))).toBe("overdue");
    // Just after midnight IST is still the previous day in UTC — must not matter.
    expect(dueBucket("2026-11-03", at(2026, 11, 3, 0, 30))).toBe("today");
  });
});

describe("dueLabel", () => {
  const now = at(2026, 11, 2);

  it("phrases each bucket the way a card reads", () => {
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel("2026-11-02", now)).toBe("Due today");
    expect(dueLabel("2026-11-03", now)).toBe("Due tomorrow");
    expect(dueLabel("2026-11-01", now)).toBe("1 day overdue");
    expect(dueLabel("2026-10-30", now)).toBe("3 days overdue");
    expect(dueLabel("2026-11-09", now)).toBe("Due 9 Nov");
  });

  it("counts overdue days across midnight", () => {
    expect(dueLabel("2026-11-02", at(2026, 11, 3, 0, 1))).toBe("1 day overdue");
  });

  it("gives up on an unparseable date instead of printing NaN", () => {
    expect(dueLabel("not-a-date", now)).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = at(2026, 11, 2, 12, 0);
  const ago = (mins: number) => new Date(now.getTime() - mins * 60_000).toISOString();

  it("steps from minutes to hours to days to a date", () => {
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("nonsense", now)).toBe("");
    expect(relativeTime(ago(0), now)).toBe("just now");
    expect(relativeTime(ago(4), now)).toBe("4m ago");
    expect(relativeTime(ago(180), now)).toBe("3h ago");
    expect(relativeTime(ago(3 * 24 * 60), now)).toBe("3d ago");
    expect(relativeTime(at(2026, 7, 12).toISOString(), now)).toBe("12 Jul");
  });
});

it("formatHours keeps a half hour", () => {
  expect(formatHours(4)).toBe("4h");
  expect(formatHours(1.5)).toBe("1.5h");
});

it("checklistProgress reads the checklist counts, zero when absent", () => {
  expect(checklistProgress(makeTask({ ChecklistDone: 2, ChecklistTotal: 5 }))).toEqual({ done: 2, total: 5 });
  expect(checklistProgress(makeTask())).toEqual({ done: 0, total: 0 });
});

it("groupByDue orders overdue first, undated last, server order kept inside a group", () => {
  const now = at(2026, 11, 2);
  const tasks = [
    makeTask({ Id: 1, DueDate: null }),
    makeTask({ Id: 2, DueDate: "2026-11-02" }),
    makeTask({ Id: 3, DueDate: "2026-10-01" }),
    makeTask({ Id: 4, DueDate: "2026-11-02" }),
    makeTask({ Id: 5, DueDate: "2026-12-25" }),
  ];
  expect(groupByDue(tasks, now).map((g) => [g.bucket, g.tasks.map((t) => t.Id)])).toEqual([
    ["overdue", [3]],
    ["today", [2, 4]],
    ["later", [5]],
    ["noDate", [1]],
  ]);
  expect(groupByDue([], now)).toEqual([]);
});

describe("workspaceAbilities (mirrors sp_CheckTaskPermission)", () => {
  const cases: [WorkspaceRole | null, boolean, WorkspaceType | null, string][] = [
    // role, isAdmin, type, expected flags full/member/viewer/createTask
    ["owner", false, "shared", "full,view,createTask,manageColumns,pinComment"],
    ["manager", false, "project", "full,view,createTask,manageColumns,pinComment"],
    ["member", false, "shared", "member,view,createTask"],
    ["viewer", false, "shared", "viewer,view"],
    [null, false, "shared", ""],
    [null, true, "shared", "full,view,createTask,manageColumns,pinComment"],
    [null, true, "project", "full,view,createTask,manageColumns,pinComment"],
    // Personal boards are the owner's alone — the admin bypass never applies.
    ["owner", false, "personal", "full,view,createTask,manageColumns,pinComment"],
    [null, true, "personal", ""],
    ["member", true, "personal", ""],
    // No board type known yet: an admin gets nothing until it is.
    [null, true, null, ""],
  ];

  it.each(cases)("role %s, admin %s, %s board", (role, isAdmin, type, expected) => {
    const can = workspaceAbilities(role, isAdmin, type);
    const granted = Object.entries(can)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort();
    expect(granted).toEqual(expected ? expected.split(",").sort() : []);
  });
});

describe("abilitiesFor", () => {
  const ME = 7;
  const mine = makeTask({ CreatedByUserId: ME });
  const assignedToMe = makeTask({ CreatedByUserId: 1, AssigneesJson: assigneesJson([ME, "Me"]) });
  const someoneElses = makeTask({ CreatedByUserId: 1, AssigneesJson: assigneesJson([2, "Other"]) });

  it("a member fully edits only their own task", () => {
    const own = abilitiesFor(mine, ME, "member", false, "shared");
    expect(own).toMatchObject({ editFields: true, changeStatus: true, manageArtifacts: true, deleteTask: true });

    const assigned = abilitiesFor(assignedToMe, ME, "member", false, "shared");
    expect(assigned).toMatchObject({ editFields: false, changeStatus: true, logTime: true, manageArtifacts: true });

    const other = abilitiesFor(someoneElses, ME, "member", false, "shared");
    expect(other).toMatchObject({ editFields: false, changeStatus: false, manageArtifacts: false, deleteTask: false, comment: true });
  });

  it("a member cannot delete their own task once someone else is on it", () => {
    const shared = makeTask({ CreatedByUserId: ME, AssigneesJson: assigneesJson([ME, "Me"], [2, "Other"]) });
    expect(abilitiesFor(shared, ME, "member", false, "shared").deleteTask).toBe(false);
    expect(abilitiesFor(shared, ME, "owner", false, "shared").deleteTask).toBe(true);
  });

  it("a viewer comments, and works a task only when assigned to it", () => {
    expect(abilitiesFor(someoneElses, ME, "viewer", false, "shared")).toMatchObject({
      comment: true,
      changeStatus: false,
      manageArtifacts: false,
      editFields: false,
    });
    expect(abilitiesFor(assignedToMe, ME, "viewer", false, "shared")).toMatchObject({
      changeStatus: true,
      manageArtifacts: false,
    });
  });

  it("claim is for a real member on an unassigned task — never via the admin bypass", () => {
    const open = makeTask({ CreatedByUserId: 1 });
    expect(abilitiesFor(open, ME, "member", false, "shared").claim).toBe(true);
    expect(abilitiesFor(open, ME, "manager", false, "shared").claim).toBe(true);
    expect(abilitiesFor(open, ME, null, true, "shared").claim).toBe(false);
    expect(abilitiesFor(open, ME, "viewer", false, "shared").claim).toBe(false);
    expect(abilitiesFor(someoneElses, ME, "member", false, "shared").claim).toBe(false);
  });

  it("an admin gets everything on a shared board and nothing on someone's personal one", () => {
    expect(abilitiesFor(someoneElses, ME, null, true, "shared")).toMatchObject({
      editFields: true,
      deleteTask: true,
      changeStatus: true,
    });
    const personal = abilitiesFor(someoneElses, ME, null, true, "personal");
    expect(personal).toMatchObject({ view: false, comment: false, changeStatus: false, editFields: false, deleteTask: false });
  });

  it("no task loaded yet grants nothing task-bound", () => {
    expect(abilitiesFor(null, ME, "owner", false, "shared")).toMatchObject({
      claim: false,
      deleteTask: false,
      editFields: true,
    });
  });
});

// parity: TASK-04 — replies sit under their thread, not where their date puts them.
describe("threadComments", () => {
  const ids = (rows: ReturnType<typeof threadComments>) => rows.map((r) => [r.comment.Id, r.reply]);

  it("puts replies (and replies to replies) under the comment that started the thread", () => {
    const rows = threadComments([
      makeComment({ Id: 1 }),
      makeComment({ Id: 2 }),
      makeComment({ Id: 3, ParentCommentId: 1 }),
      makeComment({ Id: 4, ParentCommentId: 3 }),
    ]);
    expect(ids(rows)).toEqual([[1, false], [3, true], [4, true], [2, false]]);
  });

  it("a pinned reply stays at the top where the server put it, still indented (as the web)", () => {
    const rows = threadComments([
      makeComment({ Id: 3, ParentCommentId: 1, IsPinned: true }),
      makeComment({ Id: 1 }),
      makeComment({ Id: 2, ParentCommentId: 1 }),
    ]);
    expect(ids(rows)).toEqual([[3, true], [1, false], [2, true]]);
  });

  it("a reply whose parent is not in the list stands on its own", () => {
    expect(ids(threadComments([makeComment({ Id: 5, ParentCommentId: 99 })]))).toEqual([[5, false]]);
  });

  it("a parent loop cannot hang it", () => {
    const rows = threadComments([
      makeComment({ Id: 1, ParentCommentId: 2 }),
      makeComment({ Id: 2, ParentCommentId: 1 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});
