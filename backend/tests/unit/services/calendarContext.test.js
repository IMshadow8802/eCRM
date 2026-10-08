jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const { DEFAULT_DAYS } = require("../../../src/utils/workCalendar");

const week = (start) => JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => (d === 0 ? { d, on: false } : { d, on: true, start, end: "17:00" })));
beforeEach(() => { database.executeStoredProcedure.mockReset(); cc.clearSettingsCache(); jest.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => console.error.mockRestore());

describe("load", () => {
  it("returns an empty map without calling the DB for no users", async () => {
    expect((await cc.load(1, [], "2026-10-01", "2026-10-07")).size).toBe(0);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("builds ctx per user: company + own-branch holidays, own marks, own calendar", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [
      [{ UserId: 5, CalendarId: 1, BranchId: 2, PresenceExempt: 0, ReportsTo: 9 }, { UserId: 6, CalendarId: 2, BranchId: 3, PresenceExempt: 1, ReportsTo: null }],
      [{ Id: 1, DaysJson: week("09:00") }, { Id: 2, DaysJson: "not json" }],
      [{ HolidayDate: "2026-10-02", BranchId: null }, { HolidayDate: new Date("2026-10-03T00:00:00+05:30"), BranchId: 2 }, { HolidayDate: "2026-10-04", BranchId: 3 }],
      [{ UserId: 5, WorkDate: "2026-10-05", Part: "full", Kind: "leave" }],
    ] });
    const m = await cc.load(1, [5, 6], "2026-10-01", "2026-10-07");
    const a = m.get(5);
    expect([...a.ctx.holidays].sort()).toEqual(["2026-10-02", "2026-10-03"]);
    expect(a.ctx.marks.get("2026-10-05")).toEqual({ part: "full", kind: "leave" });
    expect(a).toMatchObject({ branchId: 2, presenceExempt: false, reportsTo: 9, calendarId: 1 });
    expect(a.days[1].start).toBe("09:00");
    const b = m.get(6);
    expect([...b.ctx.holidays].sort()).toEqual(["2026-10-02", "2026-10-04"]);
    expect(b.ctx.marks.size).toBe(0);
    expect(b).toMatchObject({ presenceExempt: true, reportsTo: null });
    expect(b.days).toBe(DEFAULT_DAYS); // bad JSON falls back
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure.mock.calls[0][1].UserIdsJson).toBe("[5,6]");
  });

  it("uses the default week when the calendar row is missing, and logs a bad calendar once", async () => {
    const rs = { recordsets: [[{ UserId: 5, CalendarId: 9, BranchId: null }], [], [], []] };
    database.executeStoredProcedure.mockResolvedValue(rs);
    const m = await cc.load(1, [5], "2026-10-01", "2026-10-01");
    expect(m.get(5).days).toBe(DEFAULT_DAYS);
    expect(m.get(5)).toMatchObject({ branchId: null, reportsTo: null });
  });

  it("tolerates a missing recordset list", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(undefined);
    expect((await cc.load(1, [5], "2026-10-01", "2026-10-01")).size).toBe(0);
  });
});

describe("settings", () => {
  const row = { LateGraceMin: 10, SessionBufferMin: 30, WarnPct: 75, NotifyNotSignedIn: 1, GoLiveDate: "2026-10-10" };
  it("maps RS1 and caches per company", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[row]] });
    const a = await cc.settings(1);
    await cc.settings(1);
    expect(a).toEqual({ lateGraceMin: 10, sessionBufferMin: 30, warnPct: 75, notifyNotSignedIn: true, goLiveDate: "2026-10-10" });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    await cc.settings(2);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    cc.clearSettingsCache();
    await cc.settings(1);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(3);
  });

  it("reloads after 60 s and falls back to safe defaults for an empty row", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1000);
    expect(await cc.settings(1)).toEqual({ lateGraceMin: 0, sessionBufferMin: 0, warnPct: 80, notifyNotSignedIn: false, goLiveDate: null });
    now.mockReturnValue(1000 + 61000);
    await cc.settings(1);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});
