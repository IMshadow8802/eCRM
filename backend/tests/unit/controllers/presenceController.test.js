jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(), settings: jest.fn() }));
jest.mock("../../../src/services/sessionService", () => ({ touch: jest.fn(), endUser: jest.fn() }));
jest.mock("../../../src/controllers/workSettingsController", () => ({ visibleUserIds: jest.fn() }));
jest.mock("../../../src/realtime/events", () => ({ emitToUser: jest.fn() }));
jest.mock("../../../src/realtime/socket", () => ({ getIo: jest.fn() }));

const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const sessionService = require("../../../src/services/sessionService");
const { visibleUserIds } = require("../../../src/controllers/workSettingsController");
const { emitToUser } = require("../../../src/realtime/events");
const { getIo } = require("../../../src/realtime/socket");
const c = require("../../../src/controllers/presenceController");
const { presenceStatus } = c;
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");
const { mockRes } = require("../../helpers/mockRes");

const ist = (key, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return at(key, h * 60 + m); };
const DAY = "2026-10-07";
const NOW = ist(DAY, "10:00");
const S = { lateGraceMin: 10 };
const req = (body = {}, over = {}) => ({ user: { UserId: 7, CompId: 1, BranchId: 2, Sid: "sid-7" }, body, access: { teamOwners: [7, 8] }, ...over });
const calls = (name) => database.executeStoredProcedure.mock.calls.filter((x) => x[0] === name).map((x) => x[1]);
const out = (res) => res.json.mock.calls[0][0];
const ctxInfo = (over = {}) => ({ ctx: { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() }, branchId: 2, ...over });

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  database.executeStoredProcedure.mockReset();
  cc.load.mockReset();
  cc.settings.mockReset().mockResolvedValue(S);
  sessionService.touch.mockReset();
  sessionService.endUser.mockReset();
  visibleUserIds.mockReset();
  emitToUser.mockReset();
  getIo.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.useRealTimers());

describe("presenceStatus", () => {
  const seen = (min) => new Date(NOW.getTime() - min * 60000);
  const base = { ShiftStart: ist(DAY, "09:00"), FirstSignInAt: null, LastSeenAt: null, HasOpenSession: false, SignedOutAt: null, LateMinutes: null, MarkKind: null, MarkPart: null };
  it.each([
    ["holiday wins over everything", { ...base, HasOpenSession: true, LastSeenAt: seen(1) }, true, { code: "holiday", label: "Holiday" }],
    ["full-day leave", { ...base, MarkKind: "leave", MarkPart: "full" }, false, { code: "leave", label: "On leave" }],
    ["on duty", { ...base, MarkKind: "on_duty", MarkPart: "full" }, false, { code: "on_duty", label: "On duty" }],
    ["online, on time", { ...base, FirstSignInAt: seen(60), LateMinutes: 10, HasOpenSession: 1, LastSeenAt: seen(4) }, false, { code: "online", label: "Online" }],
    ["online, late past grace", { ...base, FirstSignInAt: seen(30), LateMinutes: 30, HasOpenSession: true, LastSeenAt: seen(0) }, false,
      { code: "online", label: "Online", late: "Late by 30 min" }],
    ["open session but quiet for > 5 min", { ...base, FirstSignInAt: seen(60), HasOpenSession: true, LastSeenAt: seen(6) }, false, { code: "offline", label: "Offline" }],
    ["signed out", { ...base, FirstSignInAt: seen(60), SignedOutAt: seen(5) }, false, { code: "signed_out", label: "Signed out" }],
    ["re-signed in after a sign-out, heartbeat fresh (regression)", { ...base, FirstSignInAt: seen(120), SignedOutAt: seen(22), HasOpenSession: true, LastSeenAt: seen(1) }, false, { code: "online", label: "Online" }],
    ["re-signed in after a sign-out, heartbeat stale (regression)", { ...base, FirstSignInAt: seen(120), SignedOutAt: seen(22), HasOpenSession: true, LastSeenAt: seen(11) }, false, { code: "offline", label: "Offline" }],
    ["signed in earlier, no session now", { ...base, FirstSignInAt: seen(60) }, false, { code: "offline", label: "Offline" }],
    ["inside grace", { ...base, ShiftStart: ist(DAY, "09:55") }, false, { code: "not_signed_in_yet", label: "Not signed in yet" }],
    ["past grace", base, false, { code: "not_signed_in", label: "Not signed in" }],
    ["no shift today, never signed in", { ...base, ShiftStart: null }, false, { code: "offline", label: "Offline" }],
    ["half-day leave keeps the session status", { ...base, MarkKind: "leave", MarkPart: "first_half", FirstSignInAt: seen(5), HasOpenSession: true, LastSeenAt: seen(1) }, false,
      { code: "online", label: "Online", half: "first_half" }],
    ["half-day leave, not signed in", { ...base, MarkKind: "leave", MarkPart: "second_half" }, false,
      { code: "not_signed_in", label: "Not signed in", half: "second_half" }],
  ])("%s", (_l, row, holiday, want) => {
    expect(presenceStatus(row, NOW, S, holiday)).toEqual(want);
  });

  it("N9: lateness shows on Signed out and Offline too, not only Online (regression)", () => {
    const late = { ...base, FirstSignInAt: seen(60), LateMinutes: 194 };
    expect(presenceStatus({ ...late, SignedOutAt: seen(5) }, NOW, S, false)).toEqual({ code: "signed_out", label: "Signed out", late: "Late by 194 min" });
    expect(presenceStatus(late, NOW, S, false)).toEqual({ code: "offline", label: "Offline", late: "Late by 194 min" });
    expect(presenceStatus({ ...late, MarkKind: "on_duty", MarkPart: "full" }, NOW, S, false)).toEqual({ code: "on_duty", label: "On duty" });
  });

  it("grace defaults to 0 when settings are missing", () => {
    expect(presenceStatus({ ...base, ShiftStart: ist(DAY, "10:00") }, NOW, {}, false).code).toBe("not_signed_in");
  });
});

describe("heartbeat", () => {
  it("touches the caller's session and returns the new expiry", async () => {
    sessionService.touch.mockResolvedValue({ expiresAt: ist(DAY, "20:00") });
    const res = mockRes();
    await c.heartbeat(req(), res);
    expect(sessionService.touch).toHaveBeenCalledWith("sid-7", expect.objectContaining({ UserId: 7, CompId: 1 }));
    expect(out(res).data).toEqual({ expiresAt: ist(DAY, "20:00").toISOString() });
  });
  it("returns null when nothing was touched", async () => {
    sessionService.touch.mockResolvedValue({ expiresAt: null });
    const res = mockRes();
    await c.heartbeat(req(), res);
    expect(out(res).data).toEqual({ expiresAt: null });
  });
  it("500s when the touch throws", async () => {
    sessionService.touch.mockRejectedValue(new Error("db"));
    const res = mockRes();
    await c.heartbeat(req(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("ackNotice", () => {
  it("stamps the notice for the caller", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200, ResponseMess: "Notice acknowledged" }]] });
    const res = mockRes();
    await c.ackNotice(req({ UserId: 99 }), res);
    expect(calls("sp_AckPresenceNotice")).toEqual([{ UserId: 7, CompId: 1 }]);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("passes an SP failure through", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 500, ResponseMess: "x" }]] });
    const res = mockRes();
    await c.ackNotice(req(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("fetchPresence", () => {
  const row = (UserId, over = {}) => ({ UserId, ShiftStart: null, FirstSignInAt: null, HasOpenSession: false, ...over });
  beforeEach(() => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[row(8), row(9, { FirstSignInAt: ist(DAY, "09:01") })]] });
    cc.load.mockResolvedValue(new Map([[8, ctxInfo()], [9, ctxInfo({ ctx: { days: DEFAULT_DAYS, holidays: new Set([DAY]), marks: new Map() } })]]));
  });

  it("filters the asked ids through visibleUserIds and computes each status", async () => {
    visibleUserIds.mockResolvedValue([7, 8, 9]);
    const res = mockRes();
    await c.fetchPresence(req({ WorkDate: DAY, UserIds: [8, 9, 10, "x"] }), res);
    expect(visibleUserIds).toHaveBeenCalledWith(expect.anything(), [8, 9, 10]);
    const [p] = calls("sp_FetchPresence");
    expect(p).toEqual({ CompId: 1, WorkDate: at(DAY, 0), UserIdsJson: "[8,9]" });
    const rows = out(res).data.presence;
    // 8: no presence row, shift start taken from the calendar (09:00), past grace
    expect(rows[0].status).toEqual({ code: "not_signed_in", label: "Not signed in" });
    // 9: holiday today
    expect(rows[1].status).toEqual({ code: "holiday", label: "Holiday" });
  });

  it("a past date never reports Online: the stored row decides (Signed out / Offline)", async () => {
    visibleUserIds.mockResolvedValue(null);
    const live = { HasOpenSession: true, LastSeenAt: new Date(NOW.getTime() - 60000) };
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[
      row(8, { ...live, FirstSignInAt: ist("2026-10-06", "09:00"), SignedOutAt: ist("2026-10-06", "18:00") }),
      row(9, { ...live, FirstSignInAt: ist("2026-10-06", "09:00") }),
    ]] });
    cc.load.mockResolvedValue(new Map([[8, ctxInfo()], [9, ctxInfo()]]));
    const res = mockRes();
    await c.fetchPresence(req({ WorkDate: "2026-10-06", UserIds: [8, 9] }), res);
    const rows = out(res).data.presence;
    expect(rows.map((r) => r.status.code)).toEqual(["signed_out", "offline"]);
  });

  it("today still reports Online from an open, recent session", async () => {
    visibleUserIds.mockResolvedValue(null);
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[
      row(8, { HasOpenSession: true, LastSeenAt: new Date(NOW.getTime() - 60000), FirstSignInAt: ist(DAY, "09:00") }),
    ]] });
    cc.load.mockResolvedValue(new Map([[8, ctxInfo()]]));
    const res = mockRes();
    await c.fetchPresence(req({ WorkDate: DAY, UserIds: [8] }), res);
    expect(out(res).data.presence[0].status.code).toBe("online");
  });

  it("N2/N9: late is re-derived from the current marks — a first-half leave clears a 12:14 sign-in (regression)", async () => {
    visibleUserIds.mockResolvedValue(null);
    jest.setSystemTime(ist(DAY, "15:00"));
    const signedOut = { FirstSignInAt: ist(DAY, "12:14"), SignedOutAt: ist(DAY, "14:30"), LateMinutes: 194, MarkKind: "leave", MarkPart: "first_half" };
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[
      row(8, signedOut),
      row(9, { ...signedOut, FirstSignInAt: ist(DAY, "14:05"), LateMinutes: 305 }), // inside the 10 min grace after the 14:00 break end
      row(10, { FirstSignInAt: ist(DAY, "12:14"), SignedOutAt: ist(DAY, "14:30"), LateMinutes: 0 }), // stored 0, really 194 late
      row(11, { FirstSignInAt: ist(DAY, "12:14"), SignedOutAt: ist(DAY, "14:30"), LateMinutes: 50 }), // no ctx: stored value is used
    ]] });
    const half = ctxInfo({ ctx: { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map([[DAY, { kind: "leave", part: "first_half" }]]) } });
    cc.load.mockResolvedValue(new Map([[8, half], [9, half], [10, ctxInfo()]]));
    const res = mockRes();
    await c.fetchPresence(req({ WorkDate: DAY, UserIds: [8, 9, 10, 11] }), res);
    const rows = out(res).data.presence;
    expect(rows[0]).toMatchObject({ LateMinutes: 0, status: { code: "signed_out", half: "first_half" } });
    expect(rows[0].status.late).toBeUndefined();
    expect(rows[1].status.late).toBeUndefined();
    expect(rows[2]).toMatchObject({ LateMinutes: 194, status: { late: "Late by 194 min" } });
    expect(rows[3].status.late).toBe("Late by 50 min");
  });

  it("admin (null) keeps every asked id; no WorkDate means today", async () => {
    visibleUserIds.mockResolvedValue(null);
    const res = mockRes();
    await c.fetchPresence(req({ UserIds: [8, 9] }), res);
    expect(calls("sp_FetchPresence")[0]).toMatchObject({ WorkDate: at(DAY, 0), UserIdsJson: "[8,9]" });
  });

  it("no ids asked = the caller and their team", async () => {
    visibleUserIds.mockResolvedValue(null);
    const res = mockRes();
    await c.fetchPresence(req({}, { access: undefined }), res);
    expect(calls("sp_FetchPresence")[0].UserIdsJson).toBe("[7]");
  });

  it("no ids asked uses teamOwners when present", async () => {
    visibleUserIds.mockResolvedValue(null);
    await c.fetchPresence(req({}), mockRes());
    expect(calls("sp_FetchPresence")[0].UserIdsJson).toBe("[7,8]");
  });

  it("nothing visible = empty list, no SP call", async () => {
    visibleUserIds.mockResolvedValue([7]);
    const res = mockRes();
    await c.fetchPresence(req({ UserIds: [99] }), res);
    expect(out(res).data).toEqual({ presence: [] });
    expect(calls("sp_FetchPresence")).toHaveLength(0);
  });

  it("400s a malformed date", async () => {
    const res = mockRes();
    await c.fetchPresence(req({ WorkDate: "07/10/2026" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("a user missing from the calendar context gets no derived shift", async () => {
    visibleUserIds.mockResolvedValue(null);
    cc.load.mockResolvedValue(new Map());
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [] });
    const res = mockRes();
    await c.fetchPresence(req({ UserIds: [8] }), res);
    expect(out(res).data).toEqual({ presence: [] });
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[row(8)]] });
    const res2 = mockRes();
    await c.fetchPresence(req({ UserIds: [8] }), res2);
    expect(out(res2).data.presence[0].status.code).toBe("offline");
  });
});

describe("fetchSessions", () => {
  it("returns the user's sessions in the caller's company", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ SessionId: "a" }]] });
    const res = mockRes();
    await c.fetchSessions(req({ UserId: 8 }), res);
    expect(calls("sp_FetchSessions")).toEqual([{ CompId: 1, UserId: 8 }]);
    expect(out(res).data).toEqual({ sessions: [{ SessionId: "a" }] });
  });
  it("tolerates an empty result", async () => {
    database.executeStoredProcedure.mockResolvedValue({});
    const res = mockRes();
    await c.fetchSessions(req({ UserId: 8 }), res);
    expect(out(res).data).toEqual({ sessions: [] });
  });
  it("400s without a user", async () => {
    const res = mockRes();
    await c.fetchSessions(req({ UserId: "x" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("endSession", () => {
  it("ends every session, tells the user's sockets, then disconnects them", async () => {
    sessionService.endUser.mockResolvedValue(["A", "B"]);
    const disconnectSockets = jest.fn();
    const io = { in: jest.fn(() => ({ disconnectSockets })) };
    getIo.mockReturnValue(io);
    const res = mockRes();
    await c.endSession(req({ UserId: 8 }), res);
    expect(sessionService.endUser).toHaveBeenCalledWith(8, 1, "forced");
    expect(emitToUser).toHaveBeenCalledWith(8, "session", { reason: "SESSION_FORCED" });
    expect(io.in).toHaveBeenCalledWith("user:8");
    expect(disconnectSockets).toHaveBeenCalledWith(true);
    expect(emitToUser.mock.invocationCallOrder[0]).toBeLessThan(disconnectSockets.mock.invocationCallOrder[0]);
    expect(out(res).data).toEqual({ ended: 2 });
  });
  it("works without a socket server", async () => {
    sessionService.endUser.mockResolvedValue([]);
    getIo.mockReturnValue(null);
    const res = mockRes();
    await c.endSession(req({ UserId: 8 }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("400s ending your own session", async () => {
    const res = mockRes();
    await c.endSession(req({ UserId: "7" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sessionService.endUser).not.toHaveBeenCalled();
  });
  it("400s without a user", async () => {
    const res = mockRes();
    await c.endSession(req({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
