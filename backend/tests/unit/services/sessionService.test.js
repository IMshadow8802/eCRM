jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(), settings: jest.fn() }));

const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const svc = require("../../../src/services/sessionService");
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");

// 2026-10-07 is a Wednesday; DEFAULT_DAYS = Mon–Sat 09:00–18:00 IST, break 13–14.
const ist = (key, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return at(key, h * 60 + m); };
const DAY = "2026-10-07";
const ctxOf = (over = {}) => ({ days: DEFAULT_DAYS, holidays: new Set(), marks: new Map(), ...over });
const info = (over = {}) => new Map([[7, { ctx: ctxOf(), days: DEFAULT_DAYS, branchId: 2, presenceExempt: false, reportsTo: 3, calendarId: 1, ...over }]]);
const SETTINGS = { lateGraceMin: 10, sessionBufferMin: 120, warnPct: 80, notifyNotSignedIn: true, goLiveDate: "2026-10-01" };
const user = { UserId: 7, CompId: 1, BranchId: 2 };
const req = (body = {}, headers = {}) => ({ body, headers, ip: "10.0.0.9" });
const calls = (name) => database.executeStoredProcedure.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const started = (showNotice = 1) => ({ recordsets: [[{ ResponseCode: 200, ResponseMess: "Session started", ShowNotice: showNotice }]] });
const managers = (rows) => ({ recordsets: [rows] });

function stubDb({ start = started(), mgr = [{ UserId: 3, Source: "manager" }], check = null } = {}) {
  database.executeStoredProcedure.mockImplementation(async (name) => {
    if (name === "sp_FetchPersonManagers") return managers(mgr);
    if (name === "sp_StartSession") return start;
    if (name === "sp_CheckSession") return { recordsets: [check ? [check] : []] };
    if (name === "sp_TouchSession") return { recordsets: [[{ ResponseCode: 200, Touched: 1 }]] };
    if (name === "sp_EndSession") return { recordsets: [[{ ResponseCode: 200, UserId: 7, Ended: 1 }]] };
    if (name === "sp_EndUserSessions") return { recordsets: [[{ SessionId: "AAAA-1" }, { SessionId: "BBBB-2" }]] };
    return { recordsets: [[]] };
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  database.executeStoredProcedure.mockReset();
  cc.load.mockReset().mockResolvedValue(info());
  cc.settings.mockReset().mockResolvedValue(SETTINGS);
  svc.clearCache();
  stubDb();
});
afterEach(() => jest.useRealTimers());

describe("start", () => {
  it("inside a shift: records presence with late minutes, manager and shift end + buffer", async () => {
    jest.setSystemTime(ist(DAY, "09:25"));
    const r = await svc.start({ req: req({ Device: "mobile" }, { "x-real-ip": "1.2.3.4", "user-agent": "x".repeat(400) }), user });
    const [p] = calls("sp_StartSession");
    expect(p).toMatchObject({ CompId: 1, UserId: 7, Device: "mobile", Ip: "1.2.3.4", LateMinutes: 25, BranchId: 2, ManagerId: 3 });
    expect(p.UserAgent).toHaveLength(300);
    expect(p.SessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.WorkDate).toEqual(at(DAY, 0));
    expect(p.ShiftStart).toEqual(ist(DAY, "09:00"));
    expect(p.ShiftEnd).toEqual(ist(DAY, "18:00"));
    expect(p.ExpiresAt).toEqual(ist(DAY, "20:00"));
    expect(r).toEqual({ sessionId: p.SessionId, expiresAt: ist(DAY, "20:00"), showNotice: true });
    expect(cc.load).toHaveBeenCalledWith(1, [7], "2026-10-06", DAY);
  });

  it("signs in before the shift: late 0, belongs to today's shift; web device, req.ip fallback", async () => {
    jest.setSystemTime(ist(DAY, "08:10"));
    const r = await svc.start({ req: req(), user });
    const [p] = calls("sp_StartSession");
    expect(p).toMatchObject({ Device: "web", Ip: "10.0.0.9", UserAgent: null, LateMinutes: 0, WorkDate: at(DAY, 0) });
    expect(r.showNotice).toBe(true);
  });

  it("late minutes are raw (grace is applied when shown), counted to the minute", async () => {
    jest.setSystemTime(new Date(ist(DAY, "09:05").getTime() + 59000));
    await svc.start({ req: req(), user });
    expect(calls("sp_StartSession")[0].LateMinutes).toBe(5);
  });

  it("on a full-day leave or holiday the shift has no start: late 0", async () => {
    cc.load.mockResolvedValue(info({ ctx: ctxOf({ holidays: new Set([DAY]) }) }));
    jest.setSystemTime(ist(DAY, "11:00"));
    await svc.start({ req: req(), user });
    expect(calls("sp_StartSession")[0]).toMatchObject({ WorkDate: at(DAY, 0), LateMinutes: 0 });
  });

  it.each([
    ["presence-exempt", () => cc.load.mockResolvedValue(info({ presenceExempt: true }))],
    ["before go-live", () => cc.settings.mockResolvedValue({ ...SETTINGS, goLiveDate: new Date(2026, 9, 8) })],
    ["feature off (no go-live)", () => cc.settings.mockResolvedValue({ ...SETTINGS, goLiveDate: null })],
    ["outside any shift (Sunday)", () => jest.setSystemTime(ist("2026-10-11", "10:00"))],
    ["user missing from the context", () => cc.load.mockResolvedValue(new Map())],
  ])("records no presence when %s", async (_l, arrange) => {
    jest.setSystemTime(ist(DAY, "10:00"));
    arrange();
    await svc.start({ req: req(), user });
    const [p] = calls("sp_StartSession");
    expect(p).toMatchObject({ WorkDate: null, ShiftStart: null, ShiftEnd: null, LateMinutes: null, ManagerId: null });
    expect(calls("sp_FetchPersonManagers")).toHaveLength(0);
  });

  it("outside a shift the session lasts until the next shift starts", async () => {
    jest.setSystemTime(ist("2026-10-11", "10:00"));
    const r = await svc.start({ req: req(), user });
    expect(r.expiresAt).toEqual(ist("2026-10-12", "09:00"));
  });

  it("an admin fallback is not stored as the manager", async () => {
    stubDb({ mgr: [{ UserId: 1, Source: "admin" }] });
    jest.setSystemTime(ist(DAY, "10:00"));
    await svc.start({ req: req(), user });
    expect(calls("sp_StartSession")[0].ManagerId).toBeNull();
  });

  it("throws when the SP refuses (login must fail)", async () => {
    stubDb({ start: { recordsets: [[{ ResponseCode: 500, ResponseMess: "boom", ShowNotice: 0 }]] } });
    jest.setSystemTime(ist(DAY, "10:00"));
    await expect(svc.start({ req: req(), user })).rejects.toThrow("boom");
  });

  it("throws on an empty SP answer", async () => {
    stubDb({ start: { recordsets: [] } });
    jest.setSystemTime(ist(DAY, "10:00"));
    await expect(svc.start({ req: req(), user })).rejects.toThrow("Session could not be started");
  });

  it("the new session is cached open, so the first request costs no check", async () => {
    jest.setSystemTime(ist(DAY, "10:00"));
    const { sessionId } = await svc.start({ req: req(), user });
    expect(await svc.check(sessionId)).toEqual({ ok: true, userId: 7 });
    expect(calls("sp_CheckSession")).toHaveLength(0);
  });
});

describe("check", () => {
  const SID = "11111111-2222-3333-4444-555555555555";
  const open = { UserId: 7, CompId: 1, ExpiresAt: ist(DAY, "20:00"), EndedAt: null, EndReason: null };
  beforeEach(() => jest.setSystemTime(ist(DAY, "10:00")));

  it("caches for 60 s: two checks, one SP call", async () => {
    stubDb({ check: open });
    expect(await svc.check(SID)).toEqual({ ok: true, userId: 7 });
    expect(await svc.check(SID.toUpperCase())).toEqual({ ok: true, userId: 7 });
    expect(calls("sp_CheckSession")).toEqual([{ SessionId: SID }]);
    jest.advanceTimersByTime(60001);
    await svc.check(SID);
    expect(calls("sp_CheckSession")).toHaveLength(2);
  });

  it("forget forces a fresh read", async () => {
    stubDb({ check: open });
    await svc.check(SID);
    svc.forget(SID);
    stubDb({ check: { ...open, EndedAt: new Date(), EndReason: "forced" } });
    expect(await svc.check(SID)).toEqual({ ok: false, code: "SESSION_FORCED" });
  });

  it.each([
    ["no row", null, "SESSION_ENDED"],
    ["forced", { ...open, EndedAt: new Date(), EndReason: "forced" }, "SESSION_FORCED"],
    ["logout", { ...open, EndedAt: new Date(), EndReason: "logout" }, "SESSION_ENDED"],
    ["expired by the sweep", { ...open, EndedAt: new Date(), EndReason: "expired" }, "SESSION_EXPIRED"],
    ["expired by the clock", { ...open, ExpiresAt: ist(DAY, "09:59") }, "SESSION_EXPIRED"],
    ["ended for an unknown reason", { ...open, EndedAt: new Date(), EndReason: "other" }, "SESSION_ENDED"],
  ])("%s -> %s", async (_l, row, code) => {
    stubDb({ check: row });
    expect(await svc.check(SID)).toEqual({ ok: false, code });
  });

  it("a cached open session expires by the clock without a new read", async () => {
    stubDb({ check: { ...open, ExpiresAt: new Date(Date.now() + 30000) } });
    expect((await svc.check(SID)).ok).toBe(true);
    jest.advanceTimersByTime(31000);
    expect(await svc.check(SID)).toEqual({ ok: false, code: "SESSION_EXPIRED" });
    expect(calls("sp_CheckSession")).toHaveLength(1);
  });

  it("prunes stale cache entries once the cache grows large", async () => {
    stubDb({ check: open });
    for (let i = 0; i < 5001; i++) await svc.check(`s-${i}`);
    jest.advanceTimersByTime(60001);
    await svc.check("fresh");
    expect(svc._cacheSize()).toBe(1);
  });
});

describe("touch / end / endUser", () => {
  const SID = "11111111-2222-3333-4444-555555555555";
  const open = { UserId: 7, CompId: 1, ExpiresAt: ist(DAY, "20:00"), EndedAt: null, EndReason: null };

  it("touch extends past shift end + buffer while in use and refreshes the cache", async () => {
    const t = new Date(ist(DAY, "19:59").getTime() + 30000); // 19:59:30
    jest.setSystemTime(t);
    stubDb({ check: open });
    const r = await svc.touch(SID, user);
    // now + 120 min, capped by tomorrow's 09:00 start -> 21:59:30
    const want = new Date(t.getTime() + 120 * 60000);
    expect(r.expiresAt).toEqual(want);
    expect(calls("sp_TouchSession")).toEqual([{ SessionId: SID, ExpiresAt: want }]);
    // 20:00:10: past the stored 20:00, but the cached row carries the extension
    jest.advanceTimersByTime(40000);
    expect(await svc.check(SID)).toEqual({ ok: true, userId: 7 });
    expect(calls("sp_CheckSession")).toHaveLength(1);
  });

  it("touch on a session the SP did not touch drops the cache entry", async () => {
    jest.setSystemTime(ist(DAY, "10:00"));
    stubDb({ check: open });
    database.executeStoredProcedure.mockImplementation(async (name) => (name === "sp_TouchSession"
      ? { recordsets: [[{ ResponseCode: 200, Touched: 0 }]] } : { recordsets: [[open]] }));
    await svc.touch(SID, user);
    await svc.check(SID);
    expect(calls("sp_CheckSession")).toHaveLength(2);
  });

  it("touch uses the default week when the user is not in the context", async () => {
    jest.setSystemTime(ist(DAY, "10:00"));
    cc.load.mockResolvedValue(new Map());
    stubDb({ check: open });
    expect((await svc.touch(SID, user)).expiresAt).toEqual(ist(DAY, "20:00"));
  });

  it("touch on a missing session returns null without calling the SP", async () => {
    jest.setSystemTime(ist(DAY, "10:00"));
    stubDb({ check: null });
    expect(await svc.touch(SID, user)).toEqual({ expiresAt: null });
    expect(calls("sp_TouchSession")).toHaveLength(0);
  });

  it("end calls sp_EndSession and forgets the session at once", async () => {
    jest.setSystemTime(ist(DAY, "10:00"));
    stubDb({ check: open });
    await svc.check(SID);
    const row = await svc.end(SID, "logout", 1);
    expect(row).toMatchObject({ Ended: 1 });
    expect(calls("sp_EndSession")).toEqual([{ SessionId: SID, Reason: "logout", CompId: 1 }]);
    await svc.check(SID);
    expect(calls("sp_CheckSession")).toHaveLength(2);
  });

  it("end throws when sp_EndSession answers a failure row, but still forgets the session", async () => {
    jest.setSystemTime(ist(DAY, "10:00"));
    stubDb({ check: open });
    await svc.check(SID);
    database.executeStoredProcedure.mockImplementation(async (name) => (name === "sp_EndSession"
      ? { recordsets: [[{ ResponseCode: 500, ResponseMess: "deadlock", Ended: 0 }]] } : { recordsets: [[open]] }));
    await expect(svc.end(SID, "logout", 1)).rejects.toThrow("deadlock");
    await svc.check(SID);
    expect(calls("sp_CheckSession")).toHaveLength(2);
  });

  it("end throws on an empty answer", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [] });
    await expect(svc.end(SID, "logout", 1)).rejects.toThrow("Session could not be ended");
  });

  it("endUser throws when the proc answers a failure row", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 500, ResponseMess: "boom" }]] });
    await expect(svc.endUser(7, 1, "forced")).rejects.toThrow("boom");
  });

  it("end without a company passes null", async () => {
    await svc.end(SID, "expired");
    expect(calls("sp_EndSession")[0].CompId).toBeNull();
  });

  it("endUser returns the ended ids and forgets each (case-insensitive)", async () => {
    jest.setSystemTime(ist(DAY, "10:00"));
    stubDb({ check: open });
    await svc.check("aaaa-1");
    const ids = await svc.endUser(7, 1, "forced");
    expect(ids).toEqual(["AAAA-1", "BBBB-2"]);
    expect(calls("sp_EndUserSessions")).toEqual([{ UserId: 7, CompId: 1, Reason: "forced" }]);
    await svc.check("aaaa-1");
    expect(calls("sp_CheckSession")).toHaveLength(2);
  });

  it("endUser with no open sessions returns []", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [] });
    expect(await svc.endUser(7, 1, "forced")).toEqual([]);
  });
});
