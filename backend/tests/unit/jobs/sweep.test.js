jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/calendarContext", () => ({ load: jest.fn(), settings: jest.fn() }));
jest.mock("../../../src/services/sessionService", () => ({ forget: jest.fn() }));
jest.mock("../../../src/realtime/events", () => ({ emitToUser: jest.fn() }));
jest.mock("../../../src/services/tatService", () => ({ processPending: jest.fn(), processWork: jest.fn() }));

const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const sessions = require("../../../src/services/sessionService");
const { emitToUser } = require("../../../src/realtime/events");
const tatService = require("../../../src/services/tatService");
const sweep = require("../../../src/jobs/sweep");
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");

const DAY = "2026-10-07"; // Wednesday, shift 09:00-18:00 IST
const ist = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return at(DAY, h * 60 + m); };
const info = (ctx = {}, over = {}) => new Map([[7, {
  ctx: { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map(), ...ctx }, days: DEFAULT_DAYS, presenceExempt: false, ...over,
}]]);
const calls = (n) => database.executeStoredProcedure.mock.calls.filter((c) => c[0] === n).map((c) => c[1]);

function stub({ companies = [{ CompId: 1 }], ended = [], cands = [{ UserId: 7, BranchId: 2 }], failOn = null } = {}) {
  database.executeStoredProcedure.mockImplementation(async (name, p) => {
    if (failOn && name === "sp_PresenceSweep" && p.CompId === failOn) throw new Error("boom");
    if (name === "sp_FetchLiveCompanies") return { recordsets: [companies] };
    if (name === "sp_PresenceSweep") return { recordsets: [ended] };
    if (name === "sp_FetchPresenceCandidates") return { recordsets: [cands] };
    if (name === "sp_MarkNotSignedIn") return { recordsets: [[{ ResponseCode: 200, Inserted: true }], [{ UserId: 3 }, { UserId: 4 }]] };
    return { recordsets: [[]] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  cc.settings.mockResolvedValue({ lateGraceMin: 10 });
  cc.load.mockResolvedValue(info());
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("runOnce", () => {
  it("forgets expired sessions and skips candidates inside grace", async () => {
    stub({ ended: [{ SessionId: "A" }, { SessionId: "B" }] });
    const r = await sweep.runOnce(ist("09:05"));
    expect(sessions.forget.mock.calls).toEqual([["A"], ["B"]]);
    expect(calls("sp_MarkNotSignedIn")).toHaveLength(0);
    expect(r).toEqual({ companies: 1, expired: 2, notSignedIn: 0 });
  });

  it("marks after grace and emits to each notified user", async () => {
    stub();
    const r = await sweep.runOnce(ist("09:15"));
    expect(calls("sp_MarkNotSignedIn")[0]).toMatchObject({ CompId: 1, UserId: 7, WorkDate: DAY, BranchId: 2, ShiftStart: ist("09:00"), ShiftEnd: ist("18:00") });
    expect(emitToUser.mock.calls.map((c) => c[0])).toEqual([3, 4]);
    expect(r.notSignedIn).toBe(1);
  });

  it.each([
    ["holiday", info({ holidays: new Set([DAY]) })],
    ["full leave", info({ marks: new Map([[DAY, { part: "full", kind: "leave" }]]) })],
    ["on duty", info({ marks: new Map([[DAY, { part: "full", kind: "on_duty" }]]) })],
    ["exempt", info({}, { presenceExempt: true })],
    ["unknown user", new Map()],
    ["no shift", info({ days: DEFAULT_DAYS.map((d) => ({ ...d, on: false })) })],
  ])("skips %s", async (_n, ctx) => {
    stub();
    cc.load.mockResolvedValue(ctx);
    await sweep.runOnce(ist("10:00"));
    expect(calls("sp_MarkNotSignedIn")).toHaveLength(0);
  });

  it("N3: skips a person created on/after the day's effective start (regression), marks one created before", async () => {
    stub({ cands: [{ UserId: 7, BranchId: 2, CreatedDate: ist("12:10") }] });
    await sweep.runOnce(ist("12:30"));
    expect(calls("sp_MarkNotSignedIn")).toHaveLength(0);
    stub({ cands: [{ UserId: 7, BranchId: 2, CreatedDate: ist("08:59") }] });
    await sweep.runOnce(ist("12:30"));
    expect(calls("sp_MarkNotSignedIn")).toHaveLength(1);
  });

  it("ignores a shift that started yesterday", async () => {
    stub();
    const night = DEFAULT_DAYS.map((d) => ({ ...d, start: "22:00", end: "06:00", breakStart: null, breakEnd: null }));
    cc.load.mockResolvedValue(info({ days: night }, { days: night }));
    await sweep.runOnce(ist("02:00")); // yesterday's night shift is running
    expect(calls("sp_MarkNotSignedIn")).toHaveLength(0);
  });

  it("no candidates skips loading contexts", async () => {
    stub({ cands: [] });
    await sweep.runOnce(ist("10:00"));
    expect(cc.load).not.toHaveBeenCalled();
  });

  it("an error in one company does not stop the next", async () => {
    stub({ companies: [{ CompId: 1 }, { CompId: 2 }] });
    tatService.processPending.mockRejectedValueOnce(new Error("boom"));
    const r = await sweep.runOnce(ist("09:15"));
    expect(calls("sp_PresenceSweep").map((c) => c.CompId)).toEqual([1, 2]);
    expect(calls("sp_MarkNotSignedIn").map((c) => c.CompId)).toEqual([1, 2]);
    expect(calls("sp_TatSweep")).toEqual([{ CompId: 2 }]);
    expect(r.companies).toBe(2);
  });

  // Regression (final review I4 / T6): one shared try let a presence error skip the TAT step.
  it("a presence failure still runs that company's not-signed-in check and TAT step", async () => {
    stub({ failOn: 1 });
    const r = await sweep.runOnce(ist("09:15"));
    expect(calls("sp_MarkNotSignedIn")).toHaveLength(1);
    expect(tatService.processPending).toHaveBeenCalledWith(1, null, ist("09:15"));
    expect(calls("sp_TatSweep")).toEqual([{ CompId: 1 }]);
    expect(r).toEqual({ companies: 1, expired: 0, notSignedIn: 1 });
  });

  it("a not-signed-in failure still runs the TAT step", async () => {
    stub();
    cc.settings.mockRejectedValue(new Error("lock timeout"));
    await sweep.runOnce(ist("09:15"));
    expect(calls("sp_TatSweep")).toEqual([{ CompId: 1 }]);
    expect(console.error).toHaveBeenCalledWith("[sweep] company 1 notSignedIn failed:", "lock timeout");
  });

  it("a TAT failure is logged and does not undo the presence work", async () => {
    stub();
    tatService.processPending.mockRejectedValueOnce(new Error("tat down"));
    const r = await sweep.runOnce(ist("09:15"));
    expect(r.notSignedIn).toBe(1);
    expect(console.error).toHaveBeenCalledWith("[sweep] company 1 tat failed:", "tat down");
  });

  it("a throw for one user does not stop the rest of that company's users", async () => {
    stub({ cands: [{ UserId: 7, BranchId: 2 }, { UserId: 8, BranchId: 2 }] });
    const both = info();
    both.set(8, both.get(7));
    cc.load.mockResolvedValue(both);
    const base = database.executeStoredProcedure.getMockImplementation();
    database.executeStoredProcedure.mockImplementation(async (name, p) => {
      if (name === "sp_MarkNotSignedIn" && p.UserId === 7) throw new Error("deadlock");
      return base(name, p);
    });
    const r = await sweep.runOnce(ist("09:15"));
    expect(calls("sp_MarkNotSignedIn").map((c) => c.UserId)).toEqual([7, 8]);
    expect(r.notSignedIn).toBe(1);
    expect(console.error).toHaveBeenCalledWith("[sweep] company 1 user 7 not-signed-in failed:", "deadlock");
  });

  it("tatStep is an exported no-op", async () => {
    await expect(sweep.tatStep(1, new Date())).resolves.toBeUndefined();
  });
});

describe("start", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; jest.useRealTimers(); });

  it("is a no-op under test", () => {
    jest.useFakeTimers();
    sweep.start()();
    jest.advanceTimersByTime(120000);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("is a no-op when SWEEP_DISABLED", () => {
    process.env.NODE_ENV = "production";
    process.env.SWEEP_DISABLED = "1";
    jest.useFakeTimers();
    sweep.start()();
    jest.advanceTimersByTime(120000);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("skips a tick while the previous run is in flight, and stop cancels", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SWEEP_DISABLED;
    jest.useFakeTimers();
    let release;
    database.executeStoredProcedure.mockImplementation((name) =>
      name === "sp_FetchLiveCompanies" ? new Promise((r) => { release = () => r({ recordsets: [[]] }); }) : Promise.resolve({ recordsets: [[]] }));
    const stop = sweep.start();
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(60000);
    expect(calls("sp_FetchLiveCompanies")).toHaveLength(1);
    release();
    await jest.advanceTimersByTimeAsync(60000);
    expect(calls("sp_FetchLiveCompanies")).toHaveLength(2);
    stop();
    await jest.advanceTimersByTimeAsync(120000);
    expect(calls("sp_FetchLiveCompanies")).toHaveLength(2);
  });

  it("logs and survives a failing run", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SWEEP_DISABLED;
    jest.useFakeTimers();
    database.executeStoredProcedure.mockRejectedValue(new Error("db down"));
    const stop = sweep.start();
    await jest.advanceTimersByTimeAsync(5000);
    expect(console.error).toHaveBeenCalledWith("[sweep] run failed:", "db down");
    stop();
  });
});

describe("tatStep", () => {
  it("processes pending clocks, sweeps, and emits once per notified user", async () => {
    tatService.processPending.mockResolvedValue({ updated: 2 });
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ UserId: 3 }, { UserId: 4 }, { UserId: 3 }]] });
    const now = ist("10:00");
    await sweep.tatStep(1, now);
    expect(tatService.processPending).toHaveBeenCalledWith(1, null, now);
    expect(tatService.processWork).toHaveBeenCalledWith(1);
    expect(tatService.processPending.mock.invocationCallOrder[0]).toBeLessThan(tatService.processWork.mock.invocationCallOrder[0]);
    expect(calls("sp_TatSweep")).toEqual([{ CompId: 1 }]);
    const { SCOPES } = require("../../../src/realtime/contract");
    expect(emitToUser.mock.calls).toEqual([[3, SCOPES.NOTIFICATIONS], [4, SCOPES.NOTIFICATIONS]]);
  });

  it("runs per company inside runOnce", async () => {
    stub();
    await sweep.runOnce(ist("09:05"));
    expect(tatService.processPending).toHaveBeenCalledWith(1, null, ist("09:05"));
    expect(calls("sp_TatSweep")).toEqual([{ CompId: 1 }]);
  });
});
