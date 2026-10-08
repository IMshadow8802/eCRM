jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));

const database = require("../../../src/config/database");
const { attendance, summarise, dayValue } = require("../../../src/controllers/attendanceReport");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");

// Default week: Mon–Sat 09:00–18:00, Sunday off. 2026-10-05 is a Monday.
const base = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
const signIn = (key, LateMinutes = 0) => ({ FirstSignInAt: at(key, 9 * 60 + LateMinutes), LateMinutes });

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
  const ctx7 = {
    ...base,
    holidays: new Set(["2026-10-05"]),
    marks: new Map([["2026-10-06", { kind: "leave", part: "full" }], ["2026-10-07", { kind: "leave", part: "first_half" }]]),
  };
  const presence = [
    { UserId: 7, WorkDate: "2026-10-01", ...signIn("2026-10-01", 99) }, // before go-live: excluded
    { UserId: 7, WorkDate: "2026-10-03", ...signIn("2026-10-03", 5) },  // within grace: not late
    { UserId: 7, WorkDate: "2026-10-07", ...signIn("2026-10-07", 20) }, // first-half leave: 09:20 is before the 14:00 start, not late
    { UserId: 7, WorkDate: "2026-10-09", ...signIn("2026-10-09", 40) },
    { UserId: 7, WorkDate: "2026-10-10", FirstSignInAt: null, LateMinutes: null, NotSignedInAt: at("2026-10-10", 600) },
  ];
  // Asha's one late: 40 (the 10-07 sign-in is early for her afternoon half).
  const run = (over = {}) => summarise({
    users: [{ UserId: 7, FullName: "Asha" }, { UserId: 8, FullName: "Ravi" }],
    presence, goLive: "2026-10-03", lateGraceMin: 10,
    ctxOf: (id) => (id === 7 ? ctx7 : base),
    from: "2026-10-01", to: "2026-10-11", today: "2026-10-20", ...over,
  });

  it("half leave 0.5, holiday / full leave / Sunday 0, go-live cut-off, late vs grace, not signed in", () => {
    const { rows, kpis } = run();
    expect(rows).toEqual([
      { GroupKey: 7, GroupLabel: "Asha", WorkingDays: 4.5, PresentDays: 2.5, LateDays: 1, MedianLateMin: 40, NotSignedInDays: 2 },
      { GroupKey: 8, GroupLabel: "Ravi", WorkingDays: 7, PresentDays: 0, LateDays: 0, MedianLateMin: null, NotSignedInDays: 7 },
    ]);
    expect(kpis).toEqual({ People: 2, WorkingDays: 11.5, PresentDays: 2.5, LateDays: 1, MedianLateMin: 40, NotSignedInDays: 9 });
  });

  it("daily trend from go-live to the end of the range", () => {
    const { trend } = run();
    expect(trend.map((t) => t.Bucket)).toEqual([
      "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11",
    ]);
    expect(trend[4]).toEqual({ Bucket: "2026-10-07", Present: 0.5, Late: 0, NotSignedIn: 1 }); // half leave: same 0.5 as the totals
    expect(trend[1]).toEqual({ Bucket: "2026-10-04", Present: 0, Late: 0, NotSignedIn: 0 });
  });

  it("stops at today, and counts today as not signed in only once the sweep raised it", () => {
    const { rows } = run({ today: "2026-10-10", users: [{ UserId: 7, FullName: "Asha" }, { UserId: 8, FullName: "Ravi" }] });
    expect(rows[0].NotSignedInDays).toBe(2); // 10-08 + today's raised 10-10
    expect(rows[1].NotSignedInDays).toBe(6); // 03, 05..09; today not yet raised
    expect(rows[1].WorkingDays).toBe(7); // Sat 03, Mon–Sat 05..10
  });

  it("weekly buckets (Monday starts) when the range is over 31 days", () => {
    const { trend } = run({ from: "2026-08-01", goLive: null, to: "2026-10-11" });
    expect(trend[0].Bucket).toBe("2026-07-27");
    expect(trend[trend.length - 1].Bucket).toBe("2026-10-05");
    expect(trend).toHaveLength(11);
    expect(trend[trend.length - 1]).toEqual({ Bucket: "2026-10-05", Present: 1.5, Late: 1, NotSignedIn: 8 });
  });

  it("skips days before the user's CreatedDate (Date or string)", () => {
    const users = [{ UserId: 7, FullName: "Asha", CreatedDate: "2026-10-09T10:00:00" }, { UserId: 8, FullName: "Ravi", CreatedDate: new Date(2026, 9, 8) }];
    const { rows } = run({ users });
    expect(rows[0]).toMatchObject({ WorkingDays: 2, PresentDays: 1, LateDays: 1, NotSignedInDays: 1 }); // 09 present, 10 not signed in
    expect(rows[1]).toMatchObject({ WorkingDays: 3, NotSignedInDays: 3 }); // 08, 09, 10
  });

  it("a late sign-in on a day worth 0 (Sunday, holiday, full leave) is not Late", () => {
    const sunday = [{ UserId: 8, WorkDate: "2026-10-11", ...signIn("2026-10-11", 45) }];
    const { rows, trend } = run({ presence: sunday });
    expect(rows[1]).toMatchObject({ LateDays: 0, PresentDays: 0, MedianLateMin: null });
    expect(trend[8]).toEqual({ Bucket: "2026-10-11", Present: 0, Late: 0, NotSignedIn: 0 });
  });

  it("N2: late is judged on the current marks, not the stored LateMinutes (regression)", () => {
    const halfAfter = { ...base, marks: new Map([["2026-10-08", { kind: "leave", part: "first_half" }]]) };
    const p = [{ UserId: 8, WorkDate: "2026-10-08", FirstSignInAt: at("2026-10-08", 12 * 60 + 14), LateMinutes: 194 },
      { UserId: 8, WorkDate: "2026-10-09", FirstSignInAt: at("2026-10-09", 9 * 60 + 30), LateMinutes: 0 }]; // stored 0, really 30
    const { rows } = run({ presence: p, ctxOf: () => halfAfter });
    expect(rows[1]).toMatchObject({ LateDays: 1, MedianLateMin: 30 });
  });

  it("N1: an on-duty day counts as present at its normal value, never Late or Not signed in (regression)", () => {
    const duty = { ...base, marks: new Map([["2026-10-08", { kind: "on_duty", part: "full" }], ["2026-10-09", { kind: "on_duty", part: "full" }]]) };
    const p = [{ UserId: 8, WorkDate: "2026-10-08", ...signIn("2026-10-08", 194) }]; // 10-09: on duty, no sign-in
    const { rows, trend } = run({ presence: p, ctxOf: () => duty, from: "2026-10-08", to: "2026-10-09", goLive: null });
    expect(rows[1]).toEqual({ GroupKey: 8, GroupLabel: "Ravi", WorkingDays: 2, PresentDays: 2, LateDays: 0, MedianLateMin: null, NotSignedInDays: 0 });
    expect(trend[1]).toEqual({ Bucket: "2026-10-09", Present: 2, Late: 0, NotSignedIn: 0 });
  });

  it("N8: weekly from a 31-day span, matching sp_RptTat (>= 31)", () => {
    expect(run({ from: "2026-08-01", to: "2026-09-01", goLive: null }).trend[0].Bucket).toBe("2026-07-27");
    expect(run({ from: "2026-08-01", to: "2026-08-31", goLive: null }).trend[0].Bucket).toBe("2026-08-01");
  });

  it("nothing counted when go-live is after the range", () => {
    expect(run({ goLive: "2026-12-01" }).kpis).toMatchObject({ WorkingDays: 0, MedianLateMin: null });
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

  it("an employee sees their own row only", async () => {
    const res = await call(req(RANGE));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(data(res).rows).toEqual([
      { GroupKey: 7, GroupLabel: "Asha", WorkingDays: 6, PresentDays: 1, LateDays: 1, MedianLateMin: 30, NotSignedInDays: 5 },
    ]);
    expect(data(res).range).toEqual({ from: "2026-01-05", to: "2026-01-11", groupBy: "person" });
    expect(database.executeStoredProcedure.mock.calls[0]).toEqual(["sp_FetchAttendanceRange",
      { CompId: 5, FromDate: "2026-01-05", ToDate: "2026-01-11", UserIdsJson: null }]);
  });

  it("an OwnerId outside scope yields no rows", async () => {
    const res = await call(req({ ...RANGE, OwnerId: 8 }));
    expect(database.executeStoredProcedure.mock.calls[0][1].UserIdsJson).toBe("[8]");
    expect(data(res).rows).toEqual([]);
    expect(data(res).kpis.People).toBe(0);
  });

  it("an admin sees everyone; BranchId narrows within", async () => {
    expect(data(await call(req(RANGE, { admin: true }))).rows.map((r) => r.GroupKey)).toEqual([7, 8, 9]);
    expect(data(await call(req({ ...RANGE, BranchId: 2 }, { admin: true }))).rows.map((r) => r.GroupKey)).toEqual([7, 9]);
  });

  it("Office attendance reach adds the caller's office", async () => {
    const res = await call(req(RANGE, { modules: [["attendance", "v", "Office"]] }));
    expect(data(res).rows.map((r) => r.GroupKey)).toEqual([7, 9]);
  });

  it.each([
    [{ GroupBy: "branch" }, /GroupBy/],
    [{ FromDate: "2026-02-30" }, /YYYY-MM-DD/],
    [{ FromDate: "2023-01-01", ToDate: "2026-01-01" }, /731/],
  ])("400s %j without the DB", async (body, msg) => {
    const res = await call(req(body));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(msg);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("500s when the SP throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = await call(req({ body: undefined }));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
