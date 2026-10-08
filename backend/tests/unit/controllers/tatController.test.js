jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(), settings: jest.fn() }));
jest.mock("../../../src/services/tatService", () => ({ afterTaskWrite: jest.fn() }));
jest.mock("../../../src/controllers/workSettingsController", () => ({ visibleUserIds: jest.fn() }));
jest.mock("../../../src/realtime/events", () => ({ emitToUser: jest.fn() }));
jest.mock("../../../src/middleware/permission", () => ({
  ...jest.requireActual("../../../src/middleware/permission"),
  taskAllowed: jest.fn(),
}));

const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const tatService = require("../../../src/services/tatService");
const { visibleUserIds } = require("../../../src/controllers/workSettingsController");
const { emitToUser } = require("../../../src/realtime/events");
const { SCOPES } = require("../../../src/realtime/contract");
const { taskAllowed } = require("../../../src/middleware/permission");
const c = require("../../../src/controllers/tatController");
const { mockRes } = require("../../helpers/mockRes");
const { DEFAULT_DAYS, dateKey, at } = require("../../../src/utils/workCalendar");

const req = (body = {}, over = {}) => ({ user: { UserId: 7, CompId: 1, BranchId: 2 }, scope: { isAdmin: false }, body, ...over });
const ok = (extra = {}, ...more) => ({ recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", ...extra }], ...more] });
const calls = (n) => database.executeStoredProcedure.mock.calls.filter((x) => x[0] === n).map((x) => x[1]);
const run = async (fn, body, over) => { const res = mockRes(); await c[fn](req(body, over), res); return res; };
const status = (res) => res.status.mock.calls[0][0];
const data = (res) => res.json.mock.calls[0][0].data;
const ctx = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };

// action -> allowed
const allow = (map) => taskAllowed.mockImplementation(async (_r, _t, action) => !!map[action]);
// The live sp_CheckTaskPermission rules for a workspace role (manage_members is owner-only).
const asRole = (role) => allow({
  view_task: true,
  pin_comment: ["owner", "manager"].includes(role),
  manage_members: role === "owner",
  reassign: ["owner", "manager"].includes(role),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  allow({ view_task: true });
});

describe("task gate", () => {
  it.each(["fetchTaskTat", "acknowledge", "hold", "release", "myPartDone", "saveVerdict"])("%s: 400 without TaskId, 404 without view_task", async (fn) => {
    expect(status(await run(fn, {}))).toBe(400);
    allow({});
    expect(status(await run(fn, { TaskId: 5 }))).toBe(404);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

describe("policy", () => {
  it("fetches", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Priority: "high", Minutes: 240 }]] });
    const res = await run("fetchTatPolicy");
    expect(data(res)).toEqual({ policy: [{ Priority: "high", Minutes: 240 }] });
    expect(calls("sp_FetchTatPolicy")[0]).toEqual({ CompId: 1 });
  });

  it("saves Items as ItemsJson, then marks every clock stale", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    const res = await run("saveTatPolicy", { Items: [{ Priority: "high", Minutes: 240, Junk: 1 }] });
    expect(status(res)).toBe(200);
    expect(calls("sp_SaveTatPolicy")[0]).toEqual({ CompId: 1, ItemsJson: '[{"Priority":"high","Minutes":240}]' });
    expect(calls("sp_TatMarkStale")[0]).toEqual({ CompId: 1, TaskId: null, UserId: null, Kind: "change" });
  });

  it("a failing mark-stale does not fail the save", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(ok()).mockRejectedValueOnce(new Error("x"));
    expect(status(await run("saveTatPolicy", { Items: [{ Priority: "low", Minutes: 60 }] }))).toBe(200);
  });

  it("400 without items; SP 400 passes through without marking", async () => {
    expect(status(await run("saveTatPolicy", { Items: [] }))).toBe(400);
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 400, ResponseMess: "Minutes must be 1 to 100000" }]] });
    expect(status(await run("saveTatPolicy", { Items: [{ Priority: "low", Minutes: 0 }] }))).toBe(400);
    expect(calls("sp_TatMarkStale")).toHaveLength(0);
  });
});

describe("fetchTaskTat", () => {
  const tatResult = { recordsets: [[{ Id: 1, UserId: 7 }, { Id: 2, UserId: 8 }, { Id: 3, UserId: 9 }], [{ HoldId: 1 }], [{ Id: 1, Kind: "assign" }]] };

  it("CanJudge for clocks whose person reports up to the caller, never their own", async () => {
    database.executeStoredProcedure.mockImplementation(async (name, p) => {
      if (name === "sp_FetchTaskTat") return tatResult;
      if (name === "sp_FetchEscalationTargets") return { recordsets: [p.UserId === 8 ? [{ Id: 7 }] : [{ Id: 99 }]] };
      return { recordsets: [[]] };
    });
    const res = await run("fetchTaskTat", { TaskId: 5 });
    expect(data(res).clocks.map((x) => x.CanJudge)).toEqual([false, true, false]);
    expect(data(res).holds).toEqual([{ HoldId: 1 }]);
    expect(data(res).events).toHaveLength(1);
    expect(calls("sp_FetchEscalationTargets")).toEqual([{ CompId: 1, UserId: 8 }, { CompId: 1, UserId: 9 }]);
  });

  it("a workspace manager (or admin) judges every other clock without the chain lookup", async () => {
    asRole("manager");
    database.executeStoredProcedure.mockResolvedValue(tatResult);
    const res = await run("fetchTaskTat", { TaskId: 5 });
    expect(data(res).clocks.map((x) => x.CanJudge)).toEqual([false, true, true]);
    expect(calls("sp_FetchEscalationTargets")).toHaveLength(0);

    allow({ view_task: true });
    database.executeStoredProcedure.mockClear();
    const admin = mockRes();
    await c.fetchTaskTat(req({ TaskId: 5 }, { scope: { isAdmin: true } }), admin);
    expect(data(admin).clocks.map((x) => x.CanJudge)).toEqual([false, true, true]);
  });
});

describe("who may judge (spec §6: workspace owner or manager, never own clock)", () => {
  const clocks = { recordsets: [[{ Id: 1, UserId: 7 }, { Id: 2, UserId: 8 }]] };
  it.each([["owner", true], ["manager", true], ["member", false]])("%s: CanJudge=%s, ActorManagesWorkspace follows", async (role, can) => {
    asRole(role);
    database.executeStoredProcedure.mockImplementation(async (name) => {
      if (name === "sp_FetchTaskTat") return clocks;
      if (name === "sp_FetchEscalationTargets") return { recordsets: [[]] };
      return ok();
    });
    const res = await run("fetchTaskTat", { TaskId: 5 });
    expect(data(res).clocks.map((x) => x.CanJudge)).toEqual([false, can]);
    await run("saveVerdict", { TaskId: 5, TatId: 2, Verdict: "not_excused" });
    expect(calls("sp_TatSaveVerdict")[0].ActorManagesWorkspace).toBe(can ? 1 : 0);
  });
});

describe("assignee / manager actions", () => {
  it("acknowledge", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok({ Acknowledged: true }));
    const res = await run("acknowledge", { TaskId: 5 });
    expect(data(res)).toEqual({ acknowledged: true });
    expect(calls("sp_TatAcknowledge")[0]).toEqual({ CompId: 1, TaskId: 5, UserId: 7 });
  });

  it("hold Mine: own clock, auto-release 3 working days on, emits to the notified managers", async () => {
    cc.load.mockResolvedValue(new Map([[7, { ctx }]]));
    database.executeStoredProcedure.mockResolvedValue(ok({ Held: 1 }, [{ UserId: 3 }]));
    const res = await run("hold", { TaskId: 5, Mine: true, ReasonId: 4, Remarks: "client" });
    expect(status(res)).toBe(200);
    const p = calls("sp_TatHold")[0];
    expect(p).toMatchObject({ CompId: 1, TaskId: 5, UserId: 7, ReasonId: 4, Remarks: "client", ActorUserId: 7 });
    expect(p.AutoReleaseAt).toBeInstanceOf(Date);
    expect(p.AutoReleaseAt.getTime()).toBeGreaterThan(Date.now() + 3 * 86400000 - 1);
    expect(emitToUser).toHaveBeenCalledWith(3, SCOPES.NOTIFICATIONS);
  });

  it.each([[1], ["true"]])("hold Mine accepts %p", async (Mine) => {
    cc.load.mockResolvedValue(new Map());
    database.executeStoredProcedure.mockResolvedValue(ok({ Held: 1 }, []));
    await run("hold", { TaskId: 5, Mine, ReasonId: 4 });
    expect(calls("sp_TatHold")[0].UserId).toBe(7);
  });

  it.each([["false"], [0], ["yes"]])("hold Mine=%p is not a self-hold (needs reassign)", async (Mine) => {
    expect(status(await run("hold", { TaskId: 5, Mine, ReasonId: 4 }))).toBe(403);
    expect(calls("sp_TatHold")).toHaveLength(0);
  });

  it("hold Mine with no calendar row uses the default week", async () => {
    cc.load.mockResolvedValue(new Map());
    database.executeStoredProcedure.mockResolvedValue(ok({ Held: 1 }, []));
    expect(status(await run("hold", { TaskId: 5, Mine: true, ReasonId: 4 }))).toBe(200);
  });

  it("hold for everyone needs reassign (403), then holds every clock without auto-release", async () => {
    expect(status(await run("hold", { TaskId: 5, ReasonId: 4 }))).toBe(403);
    allow({ view_task: true, reassign: true });
    database.executeStoredProcedure.mockResolvedValue(ok({ Held: 2 }, []));
    const res = await run("hold", { TaskId: 5, ReasonId: 4 });
    expect(data(res)).toEqual({ held: 2 });
    expect(calls("sp_TatHold")[0]).toMatchObject({ UserId: null, AutoReleaseAt: null, Remarks: null });
  });

  it("hold 400 without a reason; SP 409 passes through without emits", async () => {
    expect(status(await run("hold", { TaskId: 5 }))).toBe(400);
    allow({ view_task: true, reassign: true });
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 409, ResponseMess: "Already on hold" }], [{ UserId: 3 }]] });
    expect(status(await run("hold", { TaskId: 5, ReasonId: 4 }))).toBe(409);
    expect(emitToUser).not.toHaveBeenCalled();
  });

  const holdsOf = (holds) => async (name) => (name === "sp_FetchTaskTat"
    ? { recordsets: [[], holds] }
    : ok({ Released: 1 }));

  it("release Mine: an assignee ends the manual hold they started on their own clock; minutes apply", async () => {
    database.executeStoredProcedure.mockImplementation(holdsOf([
      { HoldId: 1, UserId: 7, Kind: "manual", StartedBy: 7, EndedAt: null },
    ]));
    const res = await run("release", { TaskId: 5, Mine: true });
    expect(data(res)).toEqual({ released: 1 });
    expect(calls("sp_TatRelease")[0]).toEqual({ CompId: 1, TaskId: 5, UserId: 7, ActorUserId: 7 });
    expect(tatService.afterTaskWrite).toHaveBeenCalledWith(expect.anything(), 5);
  });

  it.each([
    ["started by someone else", [{ HoldId: 1, UserId: 7, Kind: "manual", StartedBy: 3, EndedAt: null }]],
    ["blocked hold", [{ HoldId: 1, UserId: 7, Kind: "blocked", StartedBy: null, EndedAt: null }]],
    ["ended hold", [{ HoldId: 1, UserId: 7, Kind: "manual", StartedBy: 7, EndedAt: "x" }]],
    ["someone else's clock", [{ HoldId: 1, UserId: 8, Kind: "manual", StartedBy: 7, EndedAt: null }]],
  ])("release Mine without reassign: 403 for a %s", async (_n, holds) => {
    database.executeStoredProcedure.mockImplementation(holdsOf(holds));
    expect(status(await run("release", { TaskId: 5, Mine: true }))).toBe(403);
    expect(calls("sp_TatRelease")).toHaveLength(0);
  });

  it("release Mine with reassign releases only the caller's own clock, whoever started the hold", async () => {
    asRole("manager");
    database.executeStoredProcedure.mockResolvedValue(ok({ Released: 1 }));
    expect(status(await run("release", { TaskId: 5, Mine: "true" }))).toBe(200);
    expect(calls("sp_FetchTaskTat")).toHaveLength(0);
    expect(calls("sp_TatRelease")[0].UserId).toBe(7);
  });

  it("release for everyone (not Mine) needs reassign: 403 for an assignee", async () => {
    database.executeStoredProcedure.mockImplementation(holdsOf([
      { HoldId: 1, UserId: 7, Kind: "manual", StartedBy: 7, EndedAt: null },
    ]));
    expect(status(await run("release", { TaskId: 5 }))).toBe(403);
    expect(calls("sp_TatRelease")).toHaveLength(0);
  });

  it("release for everyone with reassign ends every manual hold; SP 404 passes through without applying", async () => {
    asRole("manager");
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 404, ResponseMess: "Nothing on hold" }]] });
    expect(status(await run("release", { TaskId: 5 }))).toBe(404);
    expect(calls("sp_TatRelease")[0].UserId).toBeNull();
    expect(tatService.afterTaskWrite).not.toHaveBeenCalled();
  });

  it("myPartDone closes the caller's clock; 409 passes through", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    expect(status(await run("myPartDone", { TaskId: 5 }))).toBe(200);
    expect(calls("sp_TatMyPartDone")[0]).toEqual({ CompId: 1, TaskId: 5, UserId: 7 });
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 409, ResponseMess: "only clock" }]] });
    expect(status(await run("myPartDone", { TaskId: 5 }))).toBe(409);
  });

  it("saveReason: own clock via the SP; 400 without ids; 403 passes through", async () => {
    expect(status(await run("saveReason", { ReasonId: 2 }))).toBe(400);
    expect(status(await run("saveReason", { TatId: 3 }))).toBe(400);
    database.executeStoredProcedure.mockResolvedValue(ok());
    expect(status(await run("saveReason", { TatId: 3, ReasonId: 2, Remarks: "late" }))).toBe(200);
    expect(calls("sp_TatSaveReason")[0]).toEqual({ CompId: 1, TatId: 3, UserId: 7, ReasonId: 2, Remarks: "late" });
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 403, ResponseMess: "not yours" }]] });
    expect(status(await run("saveReason", { TatId: 3, ReasonId: 2 }))).toBe(403);
  });

  it("saveVerdict: clock must belong to the task; passes ActorManagesWorkspace", async () => {
    expect(status(await run("saveVerdict", { TaskId: 5 }))).toBe(400);
    database.executeStoredProcedure.mockImplementation(async (name) =>
      (name === "sp_FetchTaskTat" ? { recordsets: [[{ Id: 3, UserId: 8 }]] } : ok()));
    expect(status(await run("saveVerdict", { TaskId: 5, TatId: 4, Verdict: "excused" }))).toBe(404);
    expect(calls("sp_TatSaveVerdict")).toHaveLength(0);

    asRole("manager");
    expect(status(await run("saveVerdict", { TaskId: 5, TatId: 3, Verdict: "excused", Remarks: "sick" }))).toBe(200);
    expect(calls("sp_TatSaveVerdict")[0]).toEqual({
      CompId: 1, TatId: 3, ActorUserId: 7, Verdict: "excused", Remarks: "sick", ActorManagesWorkspace: 1,
    });

    allow({ view_task: true });
    database.executeStoredProcedure.mockImplementation(async (name) =>
      (name === "sp_FetchTaskTat" ? { recordsets: [[{ Id: 3, UserId: 8 }]] } : { recordsets: [[{ ResponseCode: 403, ResponseMess: "no" }]] }));
    expect(status(await run("saveVerdict", { TaskId: 5, TatId: 3 }))).toBe(403);
    expect(calls("sp_TatSaveVerdict")[1]).toMatchObject({ Verdict: null, Remarks: null, ActorManagesWorkspace: 0 });
  });
});

describe("Today", () => {
  const TODAY = dateKey(new Date());
  const stubToday = (presence = [], today = []) => database.executeStoredProcedure.mockImplementation(async (name) => {
    if (name === "sp_FetchToday") return { recordsets: [today, [{ TatId: 1 }], [{ TatId: 2 }]] };
    if (name === "sp_FetchPresence") return { recordsets: [presence] };
    return { recordsets: [[]] };
  });

  it("fetchToday: presence carries the same grace-aware status the team view shows", async () => {
    stubToday([{ UserId: 7, FirstSignInAt: "x", LateMinutes: 5, HasOpenSession: true, LastSeenAt: new Date().toISOString() }], [{ ShiftEnd: "y" }]);
    cc.load.mockResolvedValue(new Map([[7, { ctx }]]));
    cc.settings.mockResolvedValue({ lateGraceMin: 10 });
    const res = await run("fetchToday");
    expect(data(res).presence).toMatchObject({ UserId: 7, ShiftEnd: "y", status: { code: "online", label: "Online" } });
    expect(data(res).presence.status.late).toBeUndefined(); // 5 min is inside the 10 min grace
    expect(data(res)).toMatchObject({ clocks: [{ TatId: 1 }], reasonPending: [{ TatId: 2 }] });
    expect(calls("sp_FetchToday")[0]).toEqual({ CompId: 1, UserId: 7 });
    expect(calls("sp_FetchPresence")[0]).toEqual({ CompId: 1, WorkDate: at(TODAY, 0), UserIdsJson: "[7]" });
  });

  it("fetchToday with no presence row still has a status (holiday / leave)", async () => {
    stubToday([{ UserId: 7 }]);
    cc.load.mockResolvedValue(new Map([[7, { ctx: { ...ctx, holidays: new Set([TODAY]) } }]]));
    cc.settings.mockResolvedValue({});
    expect(data(await run("fetchToday")).presence.status).toEqual({ code: "holiday", label: "Holiday" });

    stubToday([{ UserId: 7, MarkKind: "leave", MarkPart: "full" }]);
    cc.load.mockResolvedValue(new Map());
    expect(data(await run("fetchToday")).presence.status).toEqual({ code: "leave", label: "On leave" });
  });

  it("fetchToday for an inactive caller (no presence row at all) is null", async () => {
    stubToday([]);
    cc.load.mockResolvedValue(new Map());
    cc.settings.mockResolvedValue({});
    expect(data(await run("fetchToday")).presence).toBeNull();
  });

  const stubTeam = () => database.executeStoredProcedure.mockImplementation(async (name) => {
    if (name === "sp_FetchUser") return { recordsets: [[{ Id: 7 }, { Id: 8 }, { Id: 9 }, { Id: 10 }]] };
    if (name === "sp_FetchPresence") return { recordsets: [[{ UserId: 8, FullName: "A" }, { UserId: 10, FullName: "C", ShiftStart: null }]] };
    if (name === "sp_FetchTeamToday") return { recordsets: [[{ UserId: 8, Open: 3, AtRisk: 1, Over: 1, ReasonPending: 1 }]] };
    return { recordsets: [[]] };
  });

  it("fetchTeamToday: only people in reach, never self, merged with counts and status", async () => {
    stubTeam();
    visibleUserIds.mockResolvedValue([7, 8, 10]);
    cc.load.mockResolvedValue(new Map([[8, { ctx }]]));
    cc.settings.mockResolvedValue({ lateGraceMin: 10 });
    const res = await run("fetchTeamToday");
    expect(visibleUserIds).toHaveBeenCalledWith(expect.anything(), [8, 9, 10]);
    expect(JSON.parse(calls("sp_FetchPresence")[0].UserIdsJson)).toEqual([8, 10]);
    expect(JSON.parse(calls("sp_FetchTeamToday")[0].UserIdsJson)).toEqual([8, 10]);
    const team = data(res).team;
    expect(team[0]).toMatchObject({ UserId: 8, Open: 3, AtRisk: 1, Over: 1, ReasonPending: 1 });
    expect(team[0].status.code).toBeDefined();
    expect(team[1]).toMatchObject({ UserId: 10, Open: 0, AtRisk: 0, Over: 0, ReasonPending: 0, status: { code: "offline" } });
  });

  it("fetchTeamToday honours WorkDate: passed to both procs; another day is never Online", async () => {
    database.executeStoredProcedure.mockImplementation(async (name) => {
      if (name === "sp_FetchUser") return { recordsets: [[{ Id: 8 }]] };
      if (name === "sp_FetchPresence") return { recordsets: [[{ UserId: 8, FirstSignInAt: "x", HasOpenSession: true, LastSeenAt: new Date().toISOString() }]] };
      return { recordsets: [[]] };
    });
    visibleUserIds.mockResolvedValue(null);
    cc.load.mockResolvedValue(new Map());
    cc.settings.mockResolvedValue({});
    const res = await run("fetchTeamToday", { WorkDate: "2026-01-05" });
    expect(calls("sp_FetchPresence")[0].WorkDate).toEqual(at("2026-01-05", 0));
    expect(calls("sp_FetchTeamToday")[0].WorkDate).toEqual(at("2026-01-05", 0));
    expect(cc.load).toHaveBeenCalledWith(1, [8], "2026-01-05", "2026-01-05");
    expect(data(res).team[0].status.code).toBe("offline");
  });

  it("fetchTeamToday 400s on a bad WorkDate", async () => {
    expect(status(await run("fetchTeamToday", { WorkDate: "05-01-2026" }))).toBe(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("fetchTeamToday: company-wide reach takes everyone else; nobody in reach is an empty team", async () => {
    stubTeam();
    visibleUserIds.mockResolvedValueOnce(null);
    cc.load.mockResolvedValue(new Map());
    cc.settings.mockResolvedValue({});
    await run("fetchTeamToday");
    expect(JSON.parse(calls("sp_FetchPresence")[0].UserIdsJson)).toEqual([8, 9, 10]);

    database.executeStoredProcedure.mockClear();
    visibleUserIds.mockResolvedValueOnce([7]);
    expect(data(await run("fetchTeamToday"))).toEqual({ team: [] });
    expect(calls("sp_FetchPresence")).toHaveLength(0);
  });
});

describe("errors", () => {
  it("a thrown SP becomes a 500", async () => {
    database.executeStoredProcedure.mockRejectedValue(new Error("down"));
    expect(status(await run("fetchToday"))).toBe(500);
  });
});
