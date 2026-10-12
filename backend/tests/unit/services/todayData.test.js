jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(), settings: jest.fn() }));
jest.mock("../../../src/controllers/workSettingsController", () => ({ visibleUserIds: jest.fn() }));

const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const { visibleUserIds } = require("../../../src/controllers/workSettingsController");
const { presenceFor, teamIds, loadDay } = require("../../../src/services/todayData");
const { DEFAULT_DAYS, dateKey, addDays, at } = require("../../../src/utils/workCalendar");

const TODAY = dateKey(new Date());
const req = { user: { UserId: 7, CompId: 1, BranchId: 2 }, scope: { isAdmin: false } };

beforeEach(() => {
  jest.clearAllMocks();
  cc.settings.mockResolvedValue({});
});

describe("presenceFor", () => {
  it("loads the calendar itself when none is given", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ UserId: 8 }]] });
    cc.load.mockResolvedValue(new Map());
    const rows = await presenceFor(1, [8], TODAY, new Date());
    expect(cc.load).toHaveBeenCalledWith(1, [8], TODAY, TODAY);
    expect(rows[0]).toMatchObject({ UserId: 8, status: { code: "offline" } });
  });

  it("uses a given calendar (Map or promise) without loading", async () => {
    database.executeStoredProcedure.mockResolvedValue({});
    expect(await presenceFor(1, [8], TODAY, new Date(), Promise.resolve(new Map()))).toEqual([]);
    expect(cc.load).not.toHaveBeenCalled();
  });

  // Carried over from the retired tat/fetchToday tests: the status rules live here now.
  const ctx = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
  const one = async (row, info, settings = {}) => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[row]] });
    cc.settings.mockResolvedValue(settings);
    return (await presenceFor(1, [7], TODAY, new Date(), info))[0];
  };

  it("late inside the grace is not late; an open fresh session is Online", async () => {
    const p = await one({ UserId: 7, FirstSignInAt: "x", LateMinutes: 5, HasOpenSession: true, LastSeenAt: new Date().toISOString() },
      new Map([[7, { ctx }]]), { lateGraceMin: 10 });
    expect(p.status).toMatchObject({ code: "online", label: "Online" });
    expect(p.status.late).toBeUndefined();
  });

  it("re-derives late from the current marks (a half-day leave after sign-in clears it)", async () => {
    const signIn = at(TODAY, 12 * 60 + 14);
    const p = await one({ UserId: 7, FirstSignInAt: signIn, SignedOutAt: signIn, LateMinutes: 194, MarkKind: "leave", MarkPart: "first_half" },
      new Map([[7, { ctx: { ...ctx, marks: new Map([[TODAY, { kind: "leave", part: "first_half" }]]) } }]]), { lateGraceMin: 10 });
    expect(p.LateMinutes).toBe(0);
    expect(p.status.late).toBeUndefined();
  });

  it("no sign-in still has a status: holiday, leave", async () => {
    expect((await one({ UserId: 7 }, new Map([[7, { ctx: { ...ctx, holidays: new Set([TODAY]) } }]]))).status)
      .toEqual({ code: "holiday", label: "Holiday" });
    expect((await one({ UserId: 7, MarkKind: "leave", MarkPart: "full" }, new Map())).status)
      .toEqual({ code: "leave", label: "On leave" });
  });
});

describe("teamIds", () => {
  it("company users in reach, never the caller, no duplicates or blanks", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 7 }, { Id: 8 }, { Id: 8 }, { Id: null }, { Id: 9 }]] });
    visibleUserIds.mockResolvedValue([7, 9]);
    expect(await teamIds(req)).toEqual([9]);
    expect(visibleUserIds).toHaveBeenCalledWith(req, [8, 9]);
    visibleUserIds.mockResolvedValue(null);
    expect(await teamIds(req)).toEqual([8, 9]);
  });

  it("no users at all", async () => {
    database.executeStoredProcedure.mockResolvedValue({});
    visibleUserIds.mockResolvedValue(null);
    expect(await teamIds(req)).toEqual([]);
  });
});

describe("loadDay", () => {
  it("no ids: no calls, empty day", async () => {
    expect(await loadDay({ CompId: 1, ids: [], key: TODAY, now: new Date(), viewerId: 7 })).toEqual({ live: true, people: [] });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("a person with no calendar or sessions gets the default week and a zero session", async () => {
    database.executeStoredProcedure.mockImplementation(async (name) => {
      if (name === "sp_FetchPresence") return { recordsets: [[{ UserId: 8, FullName: "A" }]] };
      if (name === "sp_FetchDayTasks") return { recordsets: [[{ UserId: 8, TaskId: 1, IsCompleted: false, DueDate: at(addDays(TODAY, -1), 0) }]] };
      return {};
    });
    cc.load.mockResolvedValue(new Map());
    const { live, people } = await loadDay({ CompId: 1, ids: [8], key: TODAY, now: new Date(), viewerId: 7 });
    expect(live).toBe(true);
    expect(people[0].session).toEqual({ onlineMinutes: 0, signIns: 0, devices: [], lastSeenAt: null, open: false });
    expect(people[0].counts.overdue).toBe(1);
    expect(people[0].tasks).toHaveLength(1);
    const p = database.executeStoredProcedure.mock.calls.find((x) => x[0] === "sp_FetchDayTasks")[1];
    expect(p).toMatchObject({ IncludePersonal: 0, ViewerIsAdmin: 0 });
  });
});
