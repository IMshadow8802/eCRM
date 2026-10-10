jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(), clearSettingsCache: jest.fn() }));

const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const c = require("../../../src/controllers/workSettingsController");
const { visibleUserIds } = c;
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");
const { DEFAULT_DAYS } = require("../../../src/utils/workCalendar");

const ok = (extra = {}) => ({ recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", Id: 4, ...extra }]] });
const fail = (code, msg) => ({ recordsets: [[{ ResponseCode: code, ResponseMess: msg }]] });
const req = (body, over = {}) => ({ user: { UserId: 7, CompId: 1, BranchId: 2 }, body, access: mockAccess({ admin: true }, 7), scope: { isAdmin: true }, ...over });
const calls = (name) => database.executeStoredProcedure.mock.calls.filter((x) => x[0] === name).map((x) => x[1]);
const week = JSON.stringify(DEFAULT_DAYS);

beforeEach(() => { database.executeStoredProcedure.mockReset(); cc.load.mockReset(); cc.clearSettingsCache.mockReset(); jest.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => console.error.mockRestore());

describe("fetchWorkSettings", () => {
  it("returns settings, parsed calendars, holidays and policy (RS4 missing = [])", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ LateGraceMin: 5 }],
      [{ Id: 1, Name: "A", DaysJson: week }, { Id: 2, Name: "B", DaysJson: "bad" }], [{ Id: 1 }]] });
    const res = mockRes();
    await c.fetchWorkSettings(req({}), res);
    const d = res.json.mock.calls[0][0].data;
    expect(d.settings.LateGraceMin).toBe(5);
    expect(d.calendars[0].DaysJson).toHaveLength(7);
    expect(d.calendars[1].DaysJson).toBe(DEFAULT_DAYS);
    expect(d.holidays).toEqual([{ Id: 1 }]);
    expect(d.tatPolicy).toEqual([]);
  });
  it("handles an empty result", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [] });
    const res = mockRes();
    await c.fetchWorkSettings(req({}), res);
    expect(res.json.mock.calls[0][0].data.settings).toBeNull();
  });
});

describe("saveCompanySetting", () => {
  const good = { LateGraceMin: 10, SessionBufferMin: 30, WarnPct: 80, NotifyNotSignedIn: true, GoLiveDate: "2026-10-10" };
  it("saves and clears the settings cache", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(ok());
    const res = mockRes();
    await c.saveCompanySetting(req(good), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(calls("sp_SaveCompanySetting")[0]).toMatchObject({ CompId: 1, LateGraceMin: 10, WarnPct: 80, NotifyNotSignedIn: 1 });
    expect(cc.clearSettingsCache).toHaveBeenCalled();
  });
  it("accepts a null go-live date (feature off)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(ok());
    await c.saveCompanySetting(req({ ...good, GoLiveDate: null, NotifyNotSignedIn: false }), mockRes());
    expect(calls("sp_SaveCompanySetting")[0]).toMatchObject({ GoLiveDate: null, NotifyNotSignedIn: 0 });
  });
  it.each([[{ LateGraceMin: 121 }], [{ SessionBufferMin: -1 }], [{ WarnPct: 49 }], [{ WarnPct: "" }], [{ GoLiveDate: "10/10/2026" }]])("400s %j", async (bad) => {
    const res = mockRes();
    await c.saveCompanySetting(req({ ...good, ...bad }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("passes CommissionDueOn through; omitted is null (keep)", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    await c.saveCompanySetting(req({ ...good, CommissionDueOn: "convert" }), mockRes());
    expect(calls("sp_SaveCompanySetting")[0]).toMatchObject({ CommissionDueOn: "convert" });
    await c.saveCompanySetting(req(good), mockRes());
    expect(calls("sp_SaveCompanySetting")[1]).toMatchObject({ CommissionDueOn: null });
  });
  it("treats an empty CommissionDueOn as omitted", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    await c.saveCompanySetting(req({ ...good, CommissionDueOn: "" }), mockRes());
    expect(calls("sp_SaveCompanySetting")[0]).toMatchObject({ CommissionDueOn: null });
  });
  it("400s an unknown CommissionDueOn before the DB", async () => {
    const res = mockRes();
    await c.saveCompanySetting(req({ ...good, CommissionDueOn: "later" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("passes an SP refusal through", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(fail(400, "nope"));
    const res = mockRes();
    await c.saveCompanySetting(req(good), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("work calendars", () => {
  it("normalises DaysJson through parseDays and returns the id", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(ok());
    const res = mockRes();
    await c.saveWorkCalendar(req({ Name: " Day ", DaysJson: week, IsDefault: true }), res);
    expect(calls("sp_SaveWorkCalendar")[0]).toMatchObject({ Id: 0, CompId: 1, Name: "Day", IsDefault: 1 });
    expect(res.json.mock.calls[0][0].data).toEqual({ id: 4 });
  });
  it("400s bad days with parseDays' message, and a blank name", async () => {
    const res = mockRes();
    await c.saveWorkCalendar(req({ Name: "X", DaysJson: "[]" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("A shift needs all seven weekdays");
    const res2 = mockRes();
    await c.saveWorkCalendar(req({ Name: " ", DaysJson: week }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  // Regression (final review I3): a shift change left every open clock on the old hours.
  it("a saved or deleted calendar marks the company's open clocks stale", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    await c.saveWorkCalendar(req({ Id: 4, Name: "Day", DaysJson: week }), mockRes());
    await c.deleteWorkCalendar(req({ Id: 4 }), mockRes());
    expect(calls("sp_TatMarkStale")).toEqual([
      { CompId: 1, TaskId: null, UserId: null, Kind: "change" },
      { CompId: 1, TaskId: null, UserId: null, Kind: "change" },
    ]);
  });
  it("a refused calendar save/delete marks nothing; a mark-stale failure still answers 200", async () => {
    database.executeStoredProcedure.mockResolvedValue(fail(409, "in use"));
    await c.saveWorkCalendar(req({ Name: "Day", DaysJson: week }), mockRes());
    await c.deleteWorkCalendar(req({ Id: 4 }), mockRes());
    expect(calls("sp_TatMarkStale")).toHaveLength(0);
    database.executeStoredProcedure.mockReset().mockImplementation(async (n) => {
      if (n === "sp_TatMarkStale") throw new Error("no 100");
      return ok();
    });
    const res = mockRes();
    await c.saveWorkCalendar(req({ Name: "Day", DaysJson: week }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("delete: 409 passes through; missing id is 400", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(fail(409, "in use"));
    const res = mockRes();
    await c.deleteWorkCalendar(req({ Id: 3 }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    const res2 = mockRes();
    await c.deleteWorkCalendar(req({}), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });
});

describe("holidays", () => {
  it("save: marks clocks stale and excuses that day's breaches", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    await c.saveHoliday(req({ HolidayDate: "2026-10-02", Name: "Gandhi Jayanti", BranchId: 0 }), mockRes());
    expect(calls("sp_SaveHoliday")[0]).toMatchObject({ BranchId: null, Name: "Gandhi Jayanti" });
    expect(calls("sp_TatMarkStale")[0]).toEqual({ CompId: 1, TaskId: null, UserId: null, Kind: "change" });
    const ex = calls("sp_TatExcuseForDays")[0];
    expect(ex).toMatchObject({ CompId: 1, UserId: null, Why: "Holiday", BranchId: null });
    expect(ex.ToAt.getTime() - ex.FromAt.getTime()).toBe(86400000);
  });
  it("save: swallows a missing 100 script", async () => {
    database.executeStoredProcedure.mockImplementation(async (name) => {
      if (name.startsWith("sp_Tat")) throw new Error("Could not find stored procedure");
      return ok();
    });
    const res = mockRes();
    await c.saveHoliday(req({ HolidayDate: "2026-10-02", Name: "H", BranchId: 3 }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(calls("sp_SaveHoliday")[0].BranchId).toBe(3);
  });
  it("save: a one-office holiday excuses only that office", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    await c.saveHoliday(req({ HolidayDate: "2026-10-02", Name: "H", BranchId: 3 }), mockRes());
    expect(calls("sp_TatExcuseForDays")[0]).toMatchObject({ UserId: null, BranchId: 3 });
  });
  it("save: SP 409 does no recompute; bad input is 400", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(fail(409, "dup"));
    const res = mockRes();
    await c.saveHoliday(req({ HolidayDate: "2026-10-02", Name: "H" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(calls("sp_TatMarkStale")).toHaveLength(0);
    for (const body of [{ HolidayDate: "x", Name: "H" }, { HolidayDate: "2026-10-02", Name: "" }]) {
      const r = mockRes();
      await c.saveHoliday(req(body), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
  });
  it("delete: marks stale only", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    await c.deleteHoliday(req({ Id: 5 }), mockRes());
    expect(calls("sp_TatMarkStale")).toHaveLength(1);
    expect(calls("sp_TatExcuseForDays")).toHaveLength(0);
    const r = mockRes();
    await c.deleteHoliday(req({}), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
  it("delete: SP failure passes through", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(fail(404, "gone"));
    const r = mockRes();
    await c.deleteHoliday(req({ Id: 5 }), r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(calls("sp_TatMarkStale")).toHaveLength(0);
  });
});

describe("day marks", () => {
  const body = { UserId: 9, WorkDate: "2026-10-05", Part: "full", Kind: "leave", Remarks: "fever" };
  const loadFor = (days, marks = []) => cc.load.mockResolvedValue(new Map([[9, { ctx: { days, holidays: new Set(), marks: new Map(marks) } }]]));
  it("save: passes actor admin flag; a full-day leave excuses that date's shift span, ignoring the new mark", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    loadFor(DEFAULT_DAYS, [["2026-10-05", { part: "full", kind: "leave" }]]);
    await c.saveDayMark(req(body), mockRes());
    expect(calls("sp_SaveDayMark")[0]).toMatchObject({ UserId: 9, ActorUserId: 7, ActorIsAdmin: 1, Part: "full" });
    expect(calls("sp_TatMarkStale")[0]).toMatchObject({ UserId: 9 });
    const ex = calls("sp_TatExcuseForDays")[0];
    expect(ex).toMatchObject({ UserId: 9, Why: "On leave", BranchId: null });
    expect(ex.FromAt.toISOString()).toBe("2026-10-05T03:30:00.000Z"); // 09:00 IST
    expect(ex.ToAt.toISOString()).toBe("2026-10-05T12:30:00.000Z"); // 18:00 IST
  });
  it("save: a full leave on a night shift runs past midnight; no shift that date = no excuse", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    const night = DEFAULT_DAYS.map((d) => (d.on ? { d: d.d, on: true, start: "21:00", end: "06:00" } : d));
    loadFor(night);
    await c.saveDayMark(req(body), mockRes());
    const ex = calls("sp_TatExcuseForDays")[0];
    expect(ex.FromAt.toISOString()).toBe("2026-10-05T15:30:00.000Z"); // 21:00 IST Mon
    expect(ex.ToAt.toISOString()).toBe("2026-10-06T00:30:00.000Z"); // 06:00 IST Tue
    database.executeStoredProcedure.mockClear();
    await c.saveDayMark(req({ ...body, WorkDate: "2026-10-04" }), mockRes()); // Sunday off
    expect(calls("sp_TatExcuseForDays")).toHaveLength(0);
  });
  it("save: a half-day leave excuses only the marked half's working span", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    const days = DEFAULT_DAYS;
    // 2026-10-05 is a Monday: 09:00-13:00 | 14:00-18:00
    cc.load.mockResolvedValue(new Map([[9, { ctx: { days, holidays: new Set(), marks: new Map([["2026-10-05", { part: "first_half", kind: "leave" }]]) } }]]));
    await c.saveDayMark(req({ ...body, Part: "first_half" }), mockRes());
    let ex = calls("sp_TatExcuseForDays")[0];
    expect(ex.ToAt.getTime() - ex.FromAt.getTime()).toBe(4 * 3600000);
    expect(ex.FromAt.toISOString()).toBe("2026-10-05T03:30:00.000Z");
    database.executeStoredProcedure.mockClear();
    await c.saveDayMark(req({ ...body, Part: "second_half" }), mockRes());
    ex = calls("sp_TatExcuseForDays")[0];
    expect(ex.FromAt.toISOString()).toBe("2026-10-05T08:30:00.000Z");
    expect(ex.ToAt.toISOString()).toBe("2026-10-05T12:30:00.000Z");
  });
  it("save: a half on a non-working day, or an unknown user, excuses nothing", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    cc.load.mockResolvedValueOnce(new Map());
    await c.saveDayMark(req({ ...body, Part: "first_half" }), mockRes());
    cc.load.mockResolvedValueOnce(new Map([[9, { ctx: { days: DEFAULT_DAYS, holidays: new Set(["2026-10-05"]), marks: new Map() } }]]));
    await c.saveDayMark(req({ ...body, Part: "first_half" }), mockRes());
    expect(calls("sp_TatExcuseForDays")).toHaveLength(0);
  });
  it("save: an excuse failure does not fail the request; non-leave kinds skip it", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    cc.load.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await c.saveDayMark(req({ ...body, Part: "first_half" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    await c.saveDayMark(req({ ...body, Kind: "onduty" }), mockRes());
    expect(calls("sp_TatExcuseForDays")).toHaveLength(0);
  });
  it("save: SP 403 passes through for a non-admin, and does no recompute", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(fail(403, "Not your report"));
    const res = mockRes();
    await c.saveDayMark(req(body, { scope: { isAdmin: false } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(calls("sp_SaveDayMark")[0].ActorIsAdmin).toBe(0);
    expect(calls("sp_TatMarkStale")).toHaveLength(0);
  });
  it("save/delete: 400 on bad user or date", async () => {
    for (const fn of [c.saveDayMark, c.deleteDayMark]) {
      for (const b of [{ WorkDate: "2026-10-05" }, { UserId: 9, WorkDate: "nope" }]) {
        const r = mockRes();
        await fn(req(b), r);
        expect(r.status).toHaveBeenCalledWith(400);
      }
    }
  });
  it("delete: marks the user stale on success only", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(ok());
    await c.deleteDayMark(req({ UserId: 9, WorkDate: "2026-10-05" }), mockRes());
    expect(calls("sp_DeleteDayMark")[0]).toMatchObject({ UserId: 9, ActorIsAdmin: 1 });
    expect(calls("sp_TatMarkStale")).toHaveLength(1);
    database.executeStoredProcedure.mockClear();
    database.executeStoredProcedure.mockResolvedValueOnce(fail(403, "no"));
    await c.deleteDayMark(req({ UserId: 9, WorkDate: "2026-10-05" }), mockRes());
    expect(calls("sp_TatMarkStale")).toHaveLength(0);
  });
});

describe("visibleUserIds", () => {
  const nonAdmin = (modules, team = [7, 8]) => {
    const access = mockAccess({ modules }, 7);
    access.teamOwners = team;
    return { user: { UserId: 7, CompId: 1 }, access };
  };
  it("admin sees everyone", async () => expect(await visibleUserIds(req({}), [1])).toBeNull());
  it("Company reach on attendance sees everyone", async () =>
    expect(await visibleUserIds(nonAdmin([["attendance", "v", "Company"]]), [1])).toBeNull());
  it("Office reach adds users in the caller's offices to the team", async () => {
    cc.load.mockResolvedValueOnce(new Map([[20, { branchId: 2 }], [21, { branchId: 99 }]]));
    const ids = await visibleUserIds(nonAdmin([["attendance", "v", "Office"]]), [20, 21, 22]);
    expect([...ids].sort((a, b) => a - b)).toEqual([7, 8, 20]);
  });
  // REGRESSION (final review Important 1): with no candidates (presence / day-marks default path,
  // whose result is thrown away) it loaded the whole company — two wasted queries per fetch.
  it("Office reach with no candidates makes no query and returns the team", async () => {
    expect(await visibleUserIds(nonAdmin([["attendance", "v", "Office"]]), [])).toEqual([7, 8]);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(cc.load).not.toHaveBeenCalled();
  });
  it("no grant and Team reach fall back to the team", async () => {
    expect(await visibleUserIds(nonAdmin([]), [20])).toEqual([7, 8]);
    expect(await visibleUserIds(nonAdmin([["attendance", "v", "Team"]]), [20])).toEqual([7, 8]);
    expect(cc.load).not.toHaveBeenCalled();
  });
});

describe("DATE columns reach the client as IST YYYY-MM-DD (local-midnight Dates)", () => {
  it("settings, holidays and day marks", async () => {
    const d = new Date(2026, 9, 9); // what mssql (useUTC:false) returns for a DATE
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ GoLiveDate: d }], [], [{ Id: 1, HolidayDate: d }]] });
    const r1 = mockRes();
    await c.fetchWorkSettings(req({}), r1);
    const data = r1.json.mock.calls[0][0].data;
    expect(data.settings.GoLiveDate).toBe("2026-10-09");
    expect(data.holidays[0].HolidayDate).toBe("2026-10-09");
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ UserId: 9, WorkDate: d }]] });
    const r2 = mockRes();
    await c.fetchDayMarks(req({ FromDate: "2026-10-01", ToDate: "2026-10-31", UserIds: [9] }), r2);
    expect(r2.json.mock.calls[0][0].data.marks[0].WorkDate).toBe("2026-10-09");
  });
});

describe("fetchDayMarks", () => {
  const b = { FromDate: "2026-10-01", ToDate: "2026-10-07" };
  it("admin: fetches the asked users", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ UserId: 9 }]] });
    const res = mockRes();
    await c.fetchDayMarks(req({ ...b, UserIds: [9, "x"] }), res);
    expect(calls("sp_FetchDayMarks")[0].UserIdsJson).toBe("[9]");
    expect(res.json.mock.calls[0][0].data.marks).toEqual([{ UserId: 9 }]);
  });
  it("non-admin: drops users outside team; no ids asked = own team", async () => {
    const access = mockAccess({ modules: [] }, 7); access.teamOwners = [7, 8];
    const r = { user: { UserId: 7, CompId: 1 }, access, scope: { isAdmin: false } };
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
    await c.fetchDayMarks({ ...r, body: { ...b, UserIds: [8, 50] } }, mockRes());
    expect(calls("sp_FetchDayMarks")[0].UserIdsJson).toBe("[8]");
    await c.fetchDayMarks({ ...r, body: b }, mockRes());
    expect(calls("sp_FetchDayMarks")[1].UserIdsJson).toBe("[7,8]");
  });
  it("returns empty without a query when nothing is visible; 400 on bad dates", async () => {
    const access = mockAccess({ modules: [] }, 7); access.teamOwners = [7];
    const res = mockRes();
    await c.fetchDayMarks({ user: { UserId: 7, CompId: 1 }, access, body: { ...b, UserIds: [50] } }, res);
    expect(res.json.mock.calls[0][0].data.marks).toEqual([]);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    const r2 = mockRes();
    await c.fetchDayMarks(req({}), r2);
    expect(r2.status).toHaveBeenCalledWith(400);
  });
  it("handles a result with no recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(undefined);
    const res = mockRes();
    await c.fetchDayMarks(req({ ...b, UserIds: [9] }), res);
    expect(res.json.mock.calls[0][0].data.marks).toEqual([]);
  });
});
