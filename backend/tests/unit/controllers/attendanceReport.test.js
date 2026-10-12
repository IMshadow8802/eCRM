jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));

const database = require("../../../src/config/database");
const { attendance, summarise, dayValue } = require("../../../src/controllers/attendanceReport");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");

// Default week: Mon–Sat 09:00–18:00 (break 13–14), Sunday off. 2026-10-05 is a Monday.
const base = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
const signIn = (key, LateMinutes = 0, min = 9 * 60) => ({ FirstSignInAt: at(key, min + LateMinutes), LateMinutes });
const sess = (UserId, key, a, b, extra = {}) => ({ UserId, Device: "web", StartedAt: at(key, a), LastSeenAt: at(key, b), EndedAt: at(key, b), ...extra });

describe("dayValue", () => {
  it.each([
    ["working day", "2026-10-07", base, 1],
    ["Sunday", "2026-10-11", base, 0],
    ["holiday", "2026-10-07", { ...base, holidays: new Set(["2026-10-07"]) }, 0],
    ["full leave", "2026-10-07", { ...base, marks: new Map([["2026-10-07", { kind: "leave", part: "full" }]]) }, 0],
    ["half leave", "2026-10-07", { ...base, marks: new Map([["2026-10-07", { kind: "leave", part: "second_half" }]]) }, 0.5],
    ["on duty", "2026-10-07", { ...base, marks: new Map([["2026-10-07", { kind: "on_duty", part: "full" }]]) }, 1],
  ])("%s", (_, key, ctx, want) => expect(dayValue(key, ctx)).toBe(want));
});

describe("summarise", () => {
  // Mon on time · Tue late 14 · Wed absent · Thu first-half leave, in at 14:00 · Fri holiday.
  const ctx = { ...base, holidays: new Set(["2026-10-09"]), marks: new Map([["2026-10-08", { kind: "leave", part: "first_half" }]]) };
  const presence = [
    { UserId: 7, WorkDate: "2026-10-05", ...signIn("2026-10-05") },
    { UserId: 7, WorkDate: "2026-10-06", ...signIn("2026-10-06", 14) },
    { UserId: 7, WorkDate: "2026-10-08", ...signIn("2026-10-08", 0, 14 * 60) },
  ];
  const run = (over = {}) => summarise({
    users: [{ UserId: 7, FullName: "Asha" }], presence, sessions: [], goLive: null, lateGraceMin: 10,
    ctxOf: () => ctx, from: "2026-10-05", to: "2026-10-09", now: at("2026-10-20", 600), ...over,
  });

  it("five days: on time, late 14, absent, half, holiday — ½ counts ½", () => {
    const { rows, days, kpis } = run();
    expect(days).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(rows[0].cells.map((c) => c.code)).toEqual(["on_time", "late", "absent", "half", "holiday"]);
    expect(rows[0].cells[1]).toEqual({ date: "2026-10-06", code: "late", lateMin: 14, onlineMin: 0 });
    expect(rows[0]).toMatchObject({ UserId: 7, FullName: "Asha", Present: 2.5, WorkingDays: 3.5, Late: 1, LateMinutes: 14, Absent: 1, Leave: 0.5, LeftEarly: 0, LateStreak: false });
    expect(kpis).toMatchObject({ PresentDays: 2.5, WorkingDays: 3.5, LateCount: 1, LateMinutesTotal: 14, LateMinutesMedian: 14, Absent: 1, AbsentTop: [{ FullName: "Asha", days: 1 }] });
    expect(kpis.PresentPct).toBeCloseTo(2.5 / 3.5 * 100);
  });

  it("a late sign-in on a half day is 1 late with its minutes, never absent; an empty half is not absent", () => {
    const p = [{ UserId: 7, WorkDate: "2026-10-08", ...signIn("2026-10-08", 30, 14 * 60) }];
    const { rows } = run({ presence: p, from: "2026-10-08", to: "2026-10-08" });
    expect(rows[0]).toMatchObject({ Present: 0.5, WorkingDays: 0.5, Late: 1, LateMinutes: 30, Absent: 0 });
    expect(rows[0].cells[0]).toMatchObject({ code: "half", lateMin: 30 });
    const empty = run({ presence: [], from: "2026-10-08", to: "2026-10-08" }).rows[0];
    expect(empty).toMatchObject({ Present: 0, WorkingDays: 0.5, Absent: 0 });
  });

  it("full leave is excused (0 working), on duty is present, Sunday off, before go-live / joining", () => {
    const c2 = { ...base, marks: new Map([["2026-10-06", { kind: "leave", part: "full" }], ["2026-10-07", { kind: "on_duty", part: "full" }]]) };
    const { rows, kpis } = run({ presence: [], ctxOf: () => c2, goLive: "2026-10-06", from: "2026-10-05", to: "2026-10-11",
      users: [{ UserId: 7, FullName: "Asha" }, { UserId: 8, FullName: "Ravi", CreatedDate: new Date(2026, 9, 10, 12) }] });
    expect(rows[0].cells.map((c) => c.code)).toEqual(["before_start", "leave", "on_duty", "absent", "absent", "absent", "off"]);
    expect(rows[0]).toMatchObject({ Present: 1, WorkingDays: 4, Absent: 3, Leave: 1 });
    expect(rows[1].cells.map((c) => c.code)).toEqual(["before_start", "before_start", "before_start", "before_start", "before_start", "absent", "off"]);
    expect(kpis.AbsentTop).toEqual([{ FullName: "Asha", days: 3 }, { FullName: "Ravi", days: 1 }]);
  });

  it("today is future before its shift end, counts once signed in or after shift end; later days are future", () => {
    const users = [{ UserId: 7, FullName: "Asha" }, { UserId: 8, FullName: "Ravi" }];
    const p = [{ UserId: 8, WorkDate: "2026-10-07", ...signIn("2026-10-07", 0) }];
    const noon = run({ users, presence: p, ctxOf: () => base, from: "2026-10-07", to: "2026-10-08", now: at("2026-10-07", 12 * 60) });
    expect(noon.rows[0].cells.map((c) => c.code)).toEqual(["future", "future"]);
    expect(noon.rows[0]).toMatchObject({ WorkingDays: 0, Absent: 0 });
    expect(noon.rows[1].cells.map((c) => c.code)).toEqual(["on_time", "future"]);
    const evening = run({ users, presence: p, ctxOf: () => base, from: "2026-10-07", to: "2026-10-07", now: at("2026-10-07", 18 * 60 + 1) });
    expect(evening.rows[0].cells[0].code).toBe("absent");
  });

  it("online minutes merge overlapping sessions; medians over present days vs shift length", () => {
    const sessions = [sess(7, "2026-10-05", 540, 660), sess(7, "2026-10-05", 600, 720, { Device: "mobile" }), sess(7, "2026-10-06", 560, 600)];
    const { rows, kpis } = run({ sessions });
    expect(rows[0].cells[0].onlineMin).toBe(180); // 09:00–12:00 merged
    expect(rows[0].cells[1].onlineMin).toBe(40);
    expect(rows[0].OnlineMedianMin).toBe(40); // [180, 40, 0]
    expect(rows[0].ShiftMedianMin).toBe(480); // [480, 480, 240]
    expect(kpis).toMatchObject({ OnlineMedianMin: 40, ShiftMedianMin: 480 });
  });

  it("left early: signed out before shift end with no open session that day", () => {
    const p = [
      { UserId: 7, WorkDate: "2026-10-05", ...signIn("2026-10-05"), SignedOutAt: at("2026-10-05", 16 * 60) },
      { UserId: 7, WorkDate: "2026-10-06", ...signIn("2026-10-06"), SignedOutAt: at("2026-10-06", 16 * 60) }, // back online later
      { UserId: 7, WorkDate: "2026-10-07", ...signIn("2026-10-07"), SignedOutAt: at("2026-10-07", 18 * 60 + 5) },
    ];
    const sessions = [{ UserId: 7, Device: "web", StartedAt: at("2026-10-06", 16 * 60 + 30), LastSeenAt: at("2026-10-06", 17 * 60), EndedAt: null }];
    expect(run({ presence: p, sessions, ctxOf: () => base }).rows[0].LeftEarly).toBe(1);
  });

  it("LateStreak: three late working days in a row; leave / holiday / Sunday do not break it", () => {
    const c3 = { ...base, marks: new Map([["2026-10-07", { kind: "leave", part: "full" }]]) };
    const late = (k) => ({ UserId: 7, WorkDate: k, ...signIn(k, 20) });
    const p = ["2026-10-09", "2026-10-10", "2026-10-12"].map(late); // Fri, Sat, (Sun off), Mon
    expect(run({ presence: p, ctxOf: () => c3, from: "2026-10-05", to: "2026-10-12" }).rows[0].LateStreak).toBe(true);
    const acrossLeave = [late("2026-10-05"), late("2026-10-06"), late("2026-10-08")]; // 07 full leave neither counts nor breaks
    expect(run({ presence: acrossLeave, ctxOf: () => c3, from: "2026-10-05", to: "2026-10-09" }).rows[0].LateStreak).toBe(true);
    const gap = [late("2026-10-05"), late("2026-10-06"), late("2026-10-09")]; // 08 absent breaks it
    expect(run({ presence: gap, ctxOf: () => c3, from: "2026-10-05", to: "2026-10-09" }).rows[0].LateStreak).toBe(false);
  });

  it("late is judged on the current marks and the grace (regression)", () => {
    const halfAfter = { ...base, marks: new Map([["2026-10-08", { kind: "leave", part: "first_half" }]]) };
    const p = [{ UserId: 7, WorkDate: "2026-10-08", FirstSignInAt: at("2026-10-08", 12 * 60 + 14), LateMinutes: 194 },
      { UserId: 7, WorkDate: "2026-10-09", FirstSignInAt: at("2026-10-09", 9 * 60 + 5), LateMinutes: 0 }];
    const { rows } = run({ presence: p, ctxOf: () => halfAfter, from: "2026-10-08", to: "2026-10-09" });
    expect(rows[0]).toMatchObject({ Late: 0, Present: 1.5 });
    expect(rows[0].cells.map((c) => c.lateMin)).toEqual([0, 0]);
  });

  it("no working days → PresentPct and medians are null, never 0 or 100", () => {
    const { kpis, rows } = run({ goLive: "2026-12-01" });
    expect(kpis).toMatchObject({ PresentPct: null, WorkingDays: 0, LateMinutesMedian: null, OnlineMedianMin: null, ShiftMedianMin: null, AbsentTop: [] });
    expect(rows[0]).toMatchObject({ OnlineMedianMin: null, ShiftMedianMin: null });
  });
});

describe("POST /api/reports/attendance", () => {
  const users = [{ UserId: 7, FullName: "Asha", BranchId: 2 }, { UserId: 8, FullName: "Ravi", BranchId: 3 }, { UserId: 9, FullName: "Mina", BranchId: 2 }];
  const stub = () => database.executeStoredProcedure.mockImplementation(async (name, p) => {
    if (name === "sp_FetchAttendanceRange") {
      const only = p.UserIdsJson ? JSON.parse(p.UserIdsJson) : null;
      return { recordsets: [users.filter((u) => !only || only.includes(u.UserId)),
        [{ UserId: 7, WorkDate: new Date(2026, 0, 5), ...signIn("2026-01-05", 30) }],
        [{ GoLiveDate: null, LateGraceMin: 10 }]] };
    }
    if (name === "sp_FetchSessionsRange") return { recordsets: [[sess(7, "2026-01-05", 570, 600)]] };
    if (name === "sp_FetchCalendarContext") {
      const ids = JSON.parse(p.UserIdsJson);
      return { recordsets: [users.filter((u) => ids.includes(u.UserId)).map((u) => ({ ...u, CalendarId: null })), [], [], []] };
    }
    throw new Error(`unexpected ${name}`);
  });
  const req = (body = {}, { admin = false, modules = [["tasks", "v"]], team = [] } = {}) => {
    const access = mockAccess({ admin, modules }, 7);
    access.teamOwners = team;
    return { user: { UserId: 7, CompId: 5, BranchId: 2 }, body, access };
  };
  const RANGE = { FromDate: "2026-01-05", ToDate: "2026-01-11" };
  const call = async (r) => { const res = mockRes(); await attendance(r, res); return res; };
  const data = (res) => res.json.mock.calls[0][0].data;

  beforeEach(() => { database.executeStoredProcedure.mockReset(); stub(); });

  it("an employee sees their own row only, with cells and online minutes", async () => {
    const res = await call(req(RANGE));
    expect(res.status).toHaveBeenCalledWith(200);
    const d = data(res);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ UserId: 7, FullName: "Asha", WorkingDays: 6, Present: 1, Late: 1, LateMinutes: 30, Absent: 5 });
    expect(d.rows[0].cells[0]).toEqual({ date: "2026-01-05", code: "late", lateMin: 30, onlineMin: 30 });
    expect(d.trend).toBeUndefined();
    expect(d.range).toEqual({ from: "2026-01-05", to: "2026-01-11" });
    expect(database.executeStoredProcedure.mock.calls[0]).toEqual(["sp_FetchAttendanceRange",
      { CompId: 5, FromDate: "2026-01-05", ToDate: "2026-01-11", UserIdsJson: null }]);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchSessionsRange",
      { CompId: 5, FromDate: "2026-01-05", ToDate: "2026-01-11", UserIdsJson: "[7]" });
  });

  it("an OwnerId outside scope yields no rows", async () => {
    const res = await call(req({ ...RANGE, OwnerId: 8 }));
    expect(database.executeStoredProcedure.mock.calls[0][1].UserIdsJson).toBe("[8]");
    expect(data(res).rows).toEqual([]);
    expect(data(res).kpis.PresentPct).toBeNull();
  });

  it("an admin sees everyone; BranchId narrows within", async () => {
    expect(data(await call(req(RANGE, { admin: true }))).rows.map((r) => r.UserId)).toEqual([7, 8, 9]);
    expect(data(await call(req({ ...RANGE, BranchId: 2 }, { admin: true }))).rows.map((r) => r.UserId)).toEqual([7, 9]);
  });

  it("Office attendance reach adds the caller's office", async () => {
    const res = await call(req(RANGE, { modules: [["attendance", "v", "Office"]] }));
    expect(data(res).rows.map((r) => r.UserId)).toEqual([7, 9]);
  });

  it.each([
    [{ FromDate: "2026-02-30" }, /YYYY-MM-DD/],
    [{ FromDate: "2026-01-01", ToDate: "2026-03-05" }, /Pick 62 days or fewer/], // 64 days
    [{ FromDate: "2026-01-01", ToDate: "2026-03-04" }, /Pick 62 days or fewer/], // 63 days
  ])("400s %j without the DB", async (body, msg) => {
    const res = await call(req(body));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(msg);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("62 days is allowed", async () => {
    const res = await call(req({ FromDate: "2026-01-01", ToDate: "2026-03-03" }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(data(res).days).toHaveLength(62);
  });

  it("500s when the SP throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = await call(req({ body: undefined }));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
