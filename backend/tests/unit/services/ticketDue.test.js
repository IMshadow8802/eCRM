jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn() }));

const database = require("../../../src/config/database");
const calendarContext = require("../../../src/services/calendarContext");
const { compute, priorityTatHours, forReopen } = require("../../../src/services/ticketDue");
const { toSqlIst } = require("../../../src/utils/workCalendar");

// 2026-10-10 is a Saturday. 17:00 IST = 11:30 UTC.
const SAT_17 = new Date("2026-10-10T11:30:00Z");

beforeEach(() => { database.executeStoredProcedure.mockReset(); calendarContext.load.mockReset(); });

describe("compute", () => {
  it("is null without TatHours (no calendar lookup)", async () => {
    expect(await compute(5, { assigneeId: 3, tatHours: null, anchorAt: SAT_17 })).toBeNull();
    expect(calendarContext.load).not.toHaveBeenCalled();
  });

  const defaultCal = (cal, hol = []) => database.executeStoredProcedure.mockResolvedValue({ recordsets: [cal ? [cal] : [], hol] });

  it("unassigned, no default calendar row: default week, Sat 17:00 + 4h = Mon 12:00", async () => {
    defaultCal(null);
    expect(toSqlIst(await compute(5, { assigneeId: null, tatHours: 4, anchorAt: SAT_17 }))).toBe("2026-10-12 12:00:00");
    expect(calendarContext.load).not.toHaveBeenCalled();
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchDefaultCalendar", { CompId: 5 });
  });

  it("unassigned uses the company default calendar and its holidays", async () => {
    // Mon-Fri 10-14 only, Monday 2026-10-12 a holiday: Sat is off, so Tue 10:00 + 4h = 14:00
    const days = [0, 1, 2, 3, 4, 5, 6].map((d) => (d >= 1 && d <= 5 ? { d, on: true, start: "10:00", end: "14:00" } : { d, on: false }));
    defaultCal({ CalendarId: 1, DaysJson: JSON.stringify(days) }, [{ HolidayDate: "2026-10-12" }]);
    expect(toSqlIst(await compute(5, { assigneeId: null, tatHours: 4, anchorAt: SAT_17 }))).toBe("2026-10-13 14:00:00");
  });

  it("unassigned with bad calendar JSON falls back to the default week", async () => {
    defaultCal({ CalendarId: 1, DaysJson: "not json" });
    expect(toSqlIst(await compute(5, { assigneeId: null, tatHours: 4, anchorAt: SAT_17 }))).toBe("2026-10-12 12:00:00");
  });

  it("assigned uses the assignee's calendar context (a holiday on Monday pushes it to Tuesday)", async () => {
    const days = require("../../../src/utils/workCalendar").DEFAULT_DAYS;
    calendarContext.load.mockResolvedValue(new Map([[3, { ctx: { days, holidays: new Set(["2026-10-12"]), marks: new Map() } }]]));
    const due = await compute(5, { assigneeId: 3, tatHours: 4, anchorAt: SAT_17 });
    expect(toSqlIst(due)).toBe("2026-10-13 12:00:00");
  });

  it("a user missing from the context falls back to the default week", async () => {
    calendarContext.load.mockResolvedValue(new Map());
    expect(toSqlIst(await compute(5, { assigneeId: 3, tatHours: 4, anchorAt: SAT_17 }))).toBe("2026-10-12 12:00:00");
  });

  it("returns null (never throws) when the calendar load fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    calendarContext.load.mockRejectedValue(new Error("db down"));
    expect(await compute(5, { assigneeId: 3, tatHours: 4, anchorAt: SAT_17 })).toBeNull();
    spy.mockRestore();
  });
});

describe("priorityTatHours", () => {
  it("finds the priority's TatHours; null for no priority, unknown priority or a failed lookup", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordset: [{ Id: 3, TatHours: 4 }, { Id: 4, TatHours: null }] });
    expect(await priorityTatHours(5, 3)).toBe(4);
    expect(await priorityTatHours(5, 4)).toBeNull();
    expect(await priorityTatHours(5, 99)).toBeNull();
    expect(await priorityTatHours(5, null)).toBeNull();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    database.executeStoredProcedure.mockRejectedValue(new Error("x"));
    expect(await priorityTatHours(5, 3)).toBeNull();
    spy.mockRestore();
  });
});

describe("forReopen", () => {
  it("stamps from now on the ticket's assignee with its current TatHours", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordset: [{ AssignedTo: null, TatHours: 2 }] });
    jest.useFakeTimers({ now: SAT_17, doNotFake: ["nextTick", "setImmediate"] });
    let due;
    try { due = await forReopen(5, 9); } finally { jest.useRealTimers(); }
    // Sat 17:00 + 2h = 1h left on Saturday + 1h from Mon 09:00
    expect(toSqlIst(due)).toBe("2026-10-12 10:00:00");
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchTicketDue", { CompId: 5, TicketId: 9 });
  });

  it("null when the ticket is missing or the fetch fails", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [] });
    expect(await forReopen(5, 9)).toBeNull();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    expect(await forReopen(5, 9)).toBeNull();
    spy.mockRestore();
  });
});
