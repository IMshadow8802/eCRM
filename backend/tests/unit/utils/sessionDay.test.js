const { sessionDay, sessionsByUserDay } = require("../../../src/utils/sessionDay");
const { at } = require("../../../src/utils/workCalendar");
const key = "2026-10-08";
const s = (from, to, extra = {}) => ({ UserId: 78, Device: "web", StartedAt: at(key, from), LastSeenAt: at(key, to), EndedAt: at(key, to), ...extra });

describe("sessionDay", () => {
  it("a logout session runs to EndedAt even without heartbeats (person clicked sign out)", () => {
    const r = sessionDay([s(600, 600, { EndedAt: at(key, 608), EndReason: "logout" })], key, at(key, 1200));
    expect(r.onlineMinutes).toBe(8);
  });
  it("an expired (or forced) session counts only to its last heartbeat", () => {
    expect(sessionDay([s(600, 640, { EndedAt: at(key, 940), EndReason: "expired" })], key, at(key, 1200)).onlineMinutes).toBe(40);
    expect(sessionDay([s(600, 640, { EndedAt: at(key, 700), EndReason: "forced" })], key, at(key, 1200)).onlineMinutes).toBe(40);
  });
  it("sums separate sessions", () => {
    expect(sessionDay([s(600, 630), s(700, 730)], key, at(key, 1200)).onlineMinutes).toBe(60);
  });
  it("counts overlap once (web + mobile together)", () => {
    const r = sessionDay([s(600, 660), s(630, 690, { Device: "mobile" })], key, at(key, 1200));
    expect(r.onlineMinutes).toBe(90);
    expect(r.devices.sort()).toEqual(["mobile", "web"]);
    expect(r.signIns).toBe(2);
  });
  it("clips a session that started yesterday; it is not a sign-in today", () => {
    const r = sessionDay([{ UserId: 78, Device: "web", StartedAt: at("2026-10-07", 1380), LastSeenAt: at(key, 30), EndedAt: at(key, 30) }], key, at(key, 1200));
    expect(r).toMatchObject({ onlineMinutes: 30, signIns: 0 });
  });
  it("an open session runs to its last heartbeat, not to now", () => {
    const r = sessionDay([s(600, 640, { EndedAt: null })], key, at(key, 900));
    expect(r).toMatchObject({ onlineMinutes: 40, open: true });
  });
  it("an open session never counts past now", () => {
    expect(sessionDay([s(600, 700, { EndedAt: null })], key, at(key, 630)).onlineMinutes).toBe(30);
  });
  it("a session ending before the day or starting after it is ignored", () => {
    const other = [s(600, 630, { StartedAt: at("2026-10-07", 600), LastSeenAt: at("2026-10-07", 630), EndedAt: at("2026-10-07", 630) }),
      s(600, 630, { StartedAt: at("2026-10-09", 600), LastSeenAt: at("2026-10-09", 630), EndedAt: at("2026-10-09", 630) })];
    expect(sessionDay(other, key, at("2026-10-10", 0))).toMatchObject({ onlineMinutes: 0, signIns: 0 });
  });
  it("a session crossing midnight and still open: the first day is not open and shows no later time", () => {
    const sess = [{ UserId: 78, Device: "web", StartedAt: at(key, 1380), LastSeenAt: at("2026-10-09", 120), EndedAt: null }];
    const d0 = sessionDay(sess, key, at("2026-10-09", 600));
    expect(d0.open).toBe(false);
    expect(d0.lastSeenAt.getTime()).toBeLessThanOrEqual(at("2026-10-09", 0).getTime());
    expect(d0.onlineMinutes).toBe(60);
    const d1 = sessionDay(sess, "2026-10-09", at("2026-10-09", 600));
    expect(d1.lastSeenAt.getTime()).toBe(at("2026-10-09", 120).getTime());
    expect(d1).toMatchObject({ open: true, onlineMinutes: 120, signIns: 0 });
  });
  it("EndedAt earlier than LastSeenAt wins", () => {
    expect(sessionDay([s(600, 700, { EndedAt: at(key, 630) })], key, at(key, 1200)).onlineMinutes).toBe(30);
  });
  it("null LastSeenAt counts nothing, no NaN", () => {
    const r = sessionDay([s(600, 700, { LastSeenAt: null, EndedAt: null })], key, at(key, 1200));
    expect(r).toMatchObject({ onlineMinutes: 0, lastSeenAt: null });
  });
  it("nothing → zeros", () => {
    expect(sessionDay([], key, at(key, 600))).toEqual({ onlineMinutes: 0, signIns: 0, devices: [], lastSeenAt: null, open: false });
  });
});

describe("sessionsByUserDay", () => {
  it("groups by user and day across a range", () => {
    const m = sessionsByUserDay([s(600, 630), { ...s(600, 620), StartedAt: at("2026-10-09", 600), LastSeenAt: at("2026-10-09", 620), EndedAt: at("2026-10-09", 620) }], key, "2026-10-09", at("2026-10-09", 1200));
    expect(m.get("78|2026-10-08").onlineMinutes).toBe(30);
    expect(m.get("78|2026-10-09").onlineMinutes).toBe(20);
  });
});
