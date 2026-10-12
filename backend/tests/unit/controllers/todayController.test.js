jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(), settings: jest.fn() }));
jest.mock("../../../src/controllers/workSettingsController", () => ({ visibleUserIds: jest.fn() }));

const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const { visibleUserIds } = require("../../../src/controllers/workSettingsController");
const c = require("../../../src/controllers/todayController");
const { mockRes } = require("../../helpers/mockRes");
const { DEFAULT_DAYS, dateKey, addDays, at } = require("../../../src/utils/workCalendar");

const ME = 7;
const TODAY = dateKey(new Date());
const PAST = "2026-01-05";
const ctx = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };

const req = (body = {}, over = {}) => ({ user: { UserId: ME, CompId: 1, BranchId: 2 }, scope: { isAdmin: false }, body, ...over });
const calls = (n) => database.executeStoredProcedure.mock.calls.filter((x) => x[0] === n).map((x) => x[1]);
const run = async (fn, body, over) => { const res = mockRes(); await c[fn](req(body, over), res); return res; };
const status = (res) => res.status.mock.calls[0][0];
const body = (res) => res.json.mock.calls[0][0];
const data = (res) => body(res).data;

const PEOPLE = {
  7: { UserId: 7, FullName: "Me" },
  8: { UserId: 8, FullName: "Zed" },
  9: { UserId: 9, FullName: "Amy" },
  10: { UserId: 10, FullName: "Exempt", PresenceExempt: true },
};
const yesterday = at(addDays(TODAY, -1), 0);
const task = (UserId, TaskId, extra = {}) => ({
  UserId, TaskId, Title: `T${TaskId}`, WorkspaceId: 1, WorkspaceName: "Board", WorkspaceType: "shared",
  IsCompleted: false, StepsTotal: 0, StepsDone: 0, ...extra,
});
const TODAY_TASKS = [
  task(7, 1, { WorkspaceType: "personal", DueDate: yesterday }), // overdue, personal
  task(7, 2, { AssignedAt: new Date() }), // given today, open
  task(7, 3, { IsCompleted: true, CompletedDate: new Date() }), // done today
  task(8, 4, { DueDate: yesterday }), // Zed overdue
  task(9, 5), // Amy clean
];

let dayTasks = TODAY_TASKS;
let sessions = [];
const stub = () => database.executeStoredProcedure.mockImplementation(async (name, p) => {
  if (name === "sp_FetchUser") return { recordsets: [Object.keys(PEOPLE).map((id) => ({ Id: Number(id) }))] };
  if (name === "sp_FetchPresence") return { recordsets: [JSON.parse(p.UserIdsJson).map((id) => PEOPLE[id]).filter(Boolean)] };
  if (name === "sp_FetchDayTasks") {
    const ids = JSON.parse(p.UserIdsJson);
    return { recordsets: [dayTasks.filter((t) => ids.includes(t.UserId))] };
  }
  if (name === "sp_FetchSessionsRange") return { recordsets: [sessions] };
  return { recordsets: [[]] };
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  dayTasks = TODAY_TASKS;
  sessions = [];
  stub();
  cc.load.mockImplementation(async (_c, ids) => new Map(ids.map((id) => [id, { ctx, presenceExempt: id === 10 }])));
  cc.settings.mockResolvedValue({ lateGraceMin: 10 });
  visibleUserIds.mockResolvedValue([7, 8, 9]);
});

describe("mine", () => {
  it("today: live, counts from described rows, personal tasks included", async () => {
    sessions = [{ UserId: 7, Device: "web", StartedAt: new Date(Date.now() - 30 * 60000), LastSeenAt: new Date(), EndedAt: null }];
    const res = await run("mine");
    expect(status(res)).toBe(200);
    expect(body(res).message).toBe("Your day fetched");
    const { day, me } = data(res);
    expect(day).toEqual({ key: TODAY, live: true });
    expect(me.tasks.map((t) => t.TaskId)).toEqual([1, 2, 3]);
    expect(me.counts.open).toBe(me.tasks.filter((t) => t.flags.open).length);
    expect(me.counts).toMatchObject({ open: 2, overdue: 1, given: 1, done: 1 });
    expect(me.session).toMatchObject({ signIns: 1, devices: ["web"], open: true });
    expect(me.session.onlineMinutes).toBeGreaterThanOrEqual(29);
    expect(calls("sp_FetchDayTasks")[0]).toEqual({
      CompId: 1, WorkDate: at(TODAY, 0), UserIdsJson: "[7]", ViewerId: 7, IncludePersonal: 1, ViewerIsAdmin: 0,
    });
    expect(calls("sp_FetchSessionsRange")[0]).toEqual({ CompId: 1, FromDate: at(TODAY, 0), ToDate: at(TODAY, 0), UserIdsJson: "[7]" });
    expect(cc.load).toHaveBeenCalledTimes(1); // presence reuses the same calendar load
  });

  it("past day: given/done are numbers, live keys are null", async () => {
    dayTasks = [
      task(7, 1, { AssignedAt: at(PAST, 600) }),
      task(7, 2, { IsCompleted: true, AssignedAt: at(PAST, 610), CompletedDate: at(PAST, 900) }),
    ];
    const { day, me } = data(await run("mine", { WorkDate: PAST }));
    expect(day).toEqual({ key: PAST, live: false });
    expect(me.counts.given).toBe(2);
    expect(me.counts.done).toBe(1);
    expect(me.counts.overdue).toBeNull();
    expect(me.counts.open).toBeNull();
    expect(calls("sp_FetchDayTasks")[0].WorkDate).toEqual(at(PAST, 0));
  });

  it("ViewerIsAdmin comes from req.scope, not the token", async () => {
    await run("mine", {}, { scope: { isAdmin: true }, user: { UserId: ME, CompId: 1, IsAdmin: false } });
    expect(calls("sp_FetchDayTasks")[0].ViewerIsAdmin).toBe(1);
    database.executeStoredProcedure.mockClear();
    await run("mine", {}, { scope: { isAdmin: false }, user: { UserId: ME, CompId: 1, IsAdmin: true } });
    expect(calls("sp_FetchDayTasks")[0].ViewerIsAdmin).toBe(0);
  });

  it("an inactive caller (no presence row) is null", async () => {
    database.executeStoredProcedure.mockImplementation(async () => ({ recordsets: [[]] }));
    expect(data(await run("mine")).me).toBeNull();
  });
});

describe("team", () => {
  it("caller first with isMe, others ranked, no personal, no task rows", async () => {
    const res = await run("team");
    expect(body(res).message).toBe("Team day fetched");
    const { day, people } = data(res);
    expect(day).toEqual({ key: TODAY, live: true });
    expect(people.map((p) => [p.UserId, p.isMe])).toEqual([[7, true], [8, false], [9, false]]);
    expect(people.every((p) => !("tasks" in p))).toBe(true);
    expect(people[1].counts.overdue).toBe(1);
    expect(calls("sp_FetchDayTasks")[0]).toMatchObject({ IncludePersonal: 0, ViewerId: 7 });
    expect(JSON.parse(calls("sp_FetchDayTasks")[0].UserIdsJson)).toEqual([7, 8, 9]);
    expect(visibleUserIds).toHaveBeenCalledWith(expect.anything(), [8, 9, 10]);
  });

  it("nobody in reach: only the caller", async () => {
    visibleUserIds.mockResolvedValue([7]);
    const { people } = data(await run("team"));
    expect(people.map((p) => p.UserId)).toEqual([7]);
    expect(people[0].isMe).toBe(true);
  });

  it("company-wide reach (null) takes everyone; exempt person is Not tracked", async () => {
    visibleUserIds.mockResolvedValue(null);
    const { people } = data(await run("team"));
    expect(people.map((p) => p.UserId).sort()).toEqual([10, 7, 8, 9].sort());
    expect(people.find((p) => p.UserId === 10).status).toEqual({ code: "not_tracked", label: "Not tracked", online: false });
    expect(people.find((p) => p.UserId === 8).status.code).not.toBe("not_tracked");
  });
});

describe("exempt and online", () => {
  it("an exempt person who is online keeps online: true under Not tracked (regression: Mine showed Offline)", async () => {
    visibleUserIds.mockResolvedValue(null);
    const was = PEOPLE[10];
    PEOPLE[10] = { ...was, HasOpenSession: true, LastSeenAt: new Date(), FirstSignInAt: new Date() };
    try {
      const { people } = data(await run("team"));
      expect(people.find((p) => p.UserId === 10).status).toEqual({ code: "not_tracked", label: "Not tracked", online: true });
    } finally { PEOPLE[10] = was; }
  });
});

describe("teamSize", () => {
  it("counts the others in reach", async () => {
    const res = await run("teamSize");
    expect(body(res).message).toBe("Team size fetched");
    expect(data(res)).toEqual({ count: 2 });
  });
});

describe("personTasks", () => {
  it("bucket overdue returns only overdue rows of another person, without personal", async () => {
    const res = await run("personTasks", { UserId: 8, Bucket: "overdue" });
    expect(body(res).message).toBe("Tasks fetched");
    expect(data(res).tasks.map((t) => t.TaskId)).toEqual([4]);
    expect(calls("sp_FetchDayTasks")[0]).toMatchObject({ UserIdsJson: "[8]", IncludePersonal: 0, ViewerId: 7 });
  });

  it("the caller's own excludes personal, like their team card (regression: Given 3 opened 4)", async () => {
    const res = await run("personTasks", { UserId: 7, Bucket: "open" });
    expect(data(res).tasks.map((t) => t.TaskId)).toEqual([1, 2]);
    expect(calls("sp_FetchDayTasks")[0]).toMatchObject({ UserIdsJson: "[7]", IncludePersonal: 0 });
    expect(calls("sp_FetchUser")).toHaveLength(0); // self needs no reach lookup
  });

  it("unknown bucket 400, missing user 400, out of reach 403", async () => {
    expect(status(await run("personTasks", { UserId: 8, Bucket: "bogus" }))).toBe(400);
    expect(status(await run("personTasks", { Bucket: "open" }))).toBe(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    const res = await run("personTasks", { UserId: 10, Bucket: "open" });
    expect(status(res)).toBe(403);
    expect(calls("sp_FetchDayTasks")).toHaveLength(0);
  });

  it("an inactive person has no rows", async () => {
    visibleUserIds.mockResolvedValue(null);
    database.executeStoredProcedure.mockImplementation(async (name) => (name === "sp_FetchUser" ? { recordsets: [[{ Id: 8 }]] } : { recordsets: [[]] }));
    expect(data(await run("personTasks", { UserId: 8, Bucket: "open" })).tasks).toEqual([]);
  });
});

describe("WorkDate", () => {
  it.each(["mine", "team", "personTasks"])("%s: bad format and future are 400", async (fn) => {
    const bad = await run(fn, { WorkDate: "10-10-2026", UserId: 7, Bucket: "open" });
    expect(status(bad)).toBe(400);
    expect(body(bad).message).toBe("Date must be YYYY-MM-DD");
    const future = await run(fn, { WorkDate: addDays(TODAY, 1), UserId: 7, Bucket: "open" });
    expect(status(future)).toBe(400);
    expect(body(future).message).toBe("Pick today or an earlier day");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Regression: the format regex alone let 2026-13-45 through to a 500.
  it.each(["2026-13-45", "2026-02-30", "2025-02-29"])("an impossible date %s is 400, not 500", async (d) => {
    const res = await run("mine", { WorkDate: d });
    expect(status(res)).toBe(400);
    expect(body(res).message).toBe("Date must be YYYY-MM-DD");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it.each(["mine", "team", "teamSize", "personTasks"])("%s: a thrown SP is 500 TODAY_FETCH_ERROR", async (fn) => {
    database.executeStoredProcedure.mockRejectedValue(new Error("down"));
    const res = await run(fn, { UserId: 8, Bucket: "open" });
    expect(status(res)).toBe(500);
    expect(body(res).code).toBe("TODAY_FETCH_ERROR");
  });
});
