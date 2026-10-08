// backend/tests/unit/utils/workCalendar.test.js
const wc = require("../../../src/utils/workCalendar");

// IST wall clock → instant, independent of process TZ.
const ist = (s) => new Date(s.replace(" ", "T") + ":00+05:30");
const ctx = (over = {}) => ({ days: wc.DEFAULT_DAYS, holidays: new Set(), marks: new Map(), ...over });
// 2026-10-05 is a Monday, 2026-10-11 a Sunday.

describe("ist helpers", () => {
  test("dateKey/at/toSqlIst round-trip in IST", () => {
    const d = ist("2026-10-05 23:30");
    expect(wc.dateKey(d)).toBe("2026-10-05");
    expect(wc.at("2026-10-05", 23 * 60 + 30).getTime()).toBe(d.getTime());
    expect(wc.toSqlIst(d)).toBe("2026-10-05 23:30:00");
    expect(wc.addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("parseDays", () => {
  test("accepts the default", () => expect(wc.parseDays(JSON.stringify(wc.DEFAULT_DAYS))).toHaveLength(7));
  test.each([
    ["not json", "{"],
    ["not 7 days", "[]"],
    ["no working day", JSON.stringify([0,1,2,3,4,5,6].map((d) => ({ d, on: false })))],
    ["bad time", JSON.stringify(wc.DEFAULT_DAYS.map((x) => (x.on ? { ...x, start: "9am" } : x)))],
    ["break outside shift", JSON.stringify(wc.DEFAULT_DAYS.map((x) => (x.on ? { ...x, breakStart: "19:00", breakEnd: "19:30" } : x)))],
    ["start equals end", JSON.stringify(wc.DEFAULT_DAYS.map((x) => (x.on ? { ...x, start: "09:00", end: "09:00" } : x)))],
  ])("rejects %s", (_n, json) => expect(() => wc.parseDays(json)).toThrow());
});

describe("working minutes", () => {
  test("break is not working time", () => {
    expect(wc.workingMinutesBetween(ist("2026-10-05 12:00"), ist("2026-10-05 15:00"), ctx())).toBe(120);
  });
  test("one standard day is 480", () => {
    expect(wc.workingMinutesBetween(ist("2026-10-05 00:00"), ist("2026-10-06 00:00"), ctx())).toBe(480);
  });
  test("Sunday adds nothing; Saturday 17:00 + 120 lands Monday 10:00", () => {
    expect(wc.addWorkingMinutes(ist("2026-10-10 17:00"), 120, ctx()).getTime()).toBe(ist("2026-10-12 10:00").getTime());
  });
  test("holiday is skipped", () => {
    const c = ctx({ holidays: new Set(["2026-10-06"]) });
    expect(wc.addWorkingMinutes(ist("2026-10-05 17:00"), 120, c).getTime()).toBe(ist("2026-10-07 10:00").getTime());
  });
  test("first-half leave starts the day after the break", () => {
    const c = ctx({ marks: new Map([["2026-10-06", { part: "first_half", kind: "leave" }]]) });
    expect(wc.addWorkingMinutes(ist("2026-10-05 17:30"), 60, c).getTime()).toBe(ist("2026-10-06 14:30").getTime());
  });
  test("second-half leave ends the day at the break", () => {
    const c = ctx({ marks: new Map([["2026-10-05", { part: "second_half", kind: "leave" }]]) });
    expect(wc.workingMinutesBetween(ist("2026-10-05 09:00"), ist("2026-10-05 18:00"), c)).toBe(240);
  });
  test("half leave without a break splits at the midpoint", () => {
    const days = wc.DEFAULT_DAYS.map((x) => (x.on ? { d: x.d, on: true, start: "10:00", end: "14:00" } : x));
    const c = ctx({ days, marks: new Map([["2026-10-05", { part: "first_half", kind: "leave" }]]) });
    expect(wc.effectiveStart("2026-10-05", c).getTime()).toBe(ist("2026-10-05 12:00").getTime());
  });
  test("on-duty mark changes nothing", () => {
    const c = ctx({ marks: new Map([["2026-10-05", { part: "full", kind: "on_duty" }]]) });
    expect(wc.workingMinutesBetween(ist("2026-10-05 09:00"), ist("2026-10-05 18:00"), c)).toBe(480);
  });
  test("full leave: no working time, effectiveStart null", () => {
    const c = ctx({ marks: new Map([["2026-10-05", { part: "full", kind: "leave" }]]) });
    expect(wc.workingMinutesBetween(ist("2026-10-05 00:00"), ist("2026-10-06 00:00"), c)).toBe(0);
    expect(wc.effectiveStart("2026-10-05", c)).toBeNull();
  });
  test("reversed or equal range is 0; adding 0 returns start", () => {
    expect(wc.workingMinutesBetween(ist("2026-10-05 12:00"), ist("2026-10-05 11:00"), ctx())).toBe(0);
    const s = ist("2026-10-11 10:00");
    expect(wc.addWorkingMinutes(s, 0, ctx()).getTime()).toBe(s.getTime());
  });
  test("a calendar with no working time throws instead of looping", () => {
    const days = wc.DEFAULT_DAYS.map((x) => ({ d: x.d, on: false }));
    expect(() => wc.addWorkingMinutes(ist("2026-10-05 09:00"), 60, ctx({ days }))).toThrow();
  });
});

describe("night shift (21:00–06:00, break 01:00–01:30, Mon–Fri)", () => {
  const days = [0,1,2,3,4,5,6].map((d) => (d >= 1 && d <= 5
    ? { d, on: true, start: "21:00", end: "06:00", breakStart: "01:00", breakEnd: "01:30" } : { d, on: false }));
  test("00:30 belongs to the previous evening's shift", () => {
    const s = wc.currentShift(ist("2026-10-06 00:30"), days);
    expect(s.workDate).toBe("2026-10-05");
    expect(s.end.getTime()).toBe(ist("2026-10-06 06:00").getTime());
  });
  test("a night is 510 working minutes", () => {
    expect(wc.workingMinutesBetween(ist("2026-10-05 12:00"), ist("2026-10-06 12:00"), ctx({ days }))).toBe(510);
  });
});

describe("endOfShift", () => {
  test("working day → its end", () => {
    expect(wc.endOfShift("2026-10-05", ctx()).getTime()).toBe(ist("2026-10-05 18:00").getTime());
  });
  test("Sunday → Saturday's end", () => {
    expect(wc.endOfShift("2026-10-11", ctx()).getTime()).toBe(ist("2026-10-10 18:00").getTime());
  });
  test("no shift in the 14 days before → 23:59 that day", () => {
    const days = wc.DEFAULT_DAYS.map((x) => ({ d: x.d, on: false }));
    expect(wc.endOfShift("2026-10-11", ctx({ days })).getTime()).toBe(ist("2026-10-11 23:59").getTime());
  });
});

describe("sessions", () => {
  const D = wc.DEFAULT_DAYS;
  test("inside a shift: end + buffer", () => {
    expect(wc.sessionExpiry(ist("2026-10-05 10:00"), D, 120).getTime()).toBe(ist("2026-10-05 20:00").getTime());
  });
  test("before the shift: today's end + buffer", () => {
    expect(wc.sessionExpiry(ist("2026-10-05 07:00"), D, 120).getTime()).toBe(ist("2026-10-05 20:00").getTime());
  });
  test("after the shift: until the next one starts", () => {
    expect(wc.sessionExpiry(ist("2026-10-05 22:00"), D, 120).getTime()).toBe(ist("2026-10-06 09:00").getTime());
    expect(wc.sessionExpiry(ist("2026-10-10 21:00"), D, 120).getTime()).toBe(ist("2026-10-12 09:00").getTime());
  });
  test("buffer never reaches into the next shift", () => {
    const days = D.map((x) => (x.on ? { d: x.d, on: true, start: "09:00", end: "23:00" } : x));
    expect(wc.sessionExpiry(ist("2026-10-05 10:00"), days, 720).getTime()).toBe(ist("2026-10-06 09:00").getTime());
  });
  test("extendExpiry keeps the later of current and now+buffer, capped at next shift", () => {
    const cur = ist("2026-10-05 20:00");
    expect(wc.extendExpiry(cur, ist("2026-10-05 19:30"), D, 120).getTime()).toBe(ist("2026-10-05 21:30").getTime());
    expect(wc.extendExpiry(cur, ist("2026-10-05 19:30"), D, 900).getTime()).toBe(ist("2026-10-06 09:00").getTime());
    expect(wc.extendExpiry(ist("2026-10-05 23:00"), ist("2026-10-05 10:00"), D, 120).getTime()).toBe(ist("2026-10-05 23:00").getTime());
  });
});

describe("fix round 1", () => {
  const D = wc.DEFAULT_DAYS;
  test("extendExpiry before a not-yet-started shift stays within that shift's start", () => {
    expect(wc.extendExpiry(ist("2026-10-06 09:00"), ist("2026-10-06 07:30"), D, 120).getTime()).toBe(ist("2026-10-06 09:00").getTime());
  });
  test("night shift: heartbeat before tonight's start cannot cross it", () => {
    const days = [0,1,2,3,4,5,6].map((d) => (d >= 1 && d <= 5 ? { d, on: true, start: "21:00", end: "06:00" } : { d, on: false }));
    expect(wc.extendExpiry(ist("2026-10-06 20:00"), ist("2026-10-06 20:30"), days, 120).getTime()).toBe(ist("2026-10-06 21:00").getTime());
  });
  test("parseDays rejects a shift that runs into the next day's", () => {
    const mk = (a, b) => JSON.stringify([0,1,2,3,4,5,6].map((d) => (d === a ? { d, on: true, start: "22:00", end: "07:00" } : d === b ? { d, on: true, start: "06:00", end: "15:00" } : { d, on: false })));
    expect(() => wc.parseDays(mk(1, 2))).toThrow(/Monday.*Tuesday/);
    expect(() => wc.parseDays(mk(6, 0))).toThrow(/Saturday.*Sunday/);
  });
});

describe("warnAt", () => {
  test("80% of working time", () => {
    expect(wc.warnAt(ist("2026-10-05 09:00"), ist("2026-10-05 11:00"), 80, ctx()).getTime()).toBe(ist("2026-10-05 10:36").getTime());
  });
});

describe("fix wave 2", () => {
  const night = [0, 1, 2, 3, 4, 5, 6].map((d) => (d >= 1 && d <= 5 ? { d, on: true, start: "21:00", end: "06:00" } : { d, on: false }));
  test("N4: a sign-in well before tonight's shift expires at that shift's start (regression: was 06:00+buffer)", () => {
    expect(wc.sessionExpiry(ist("2026-10-06 10:00"), night, 120).getTime()).toBe(ist("2026-10-06 21:00").getTime());
  });
  test("N4: a sign-in within the buffer before the shift runs to its end + buffer", () => {
    expect(wc.sessionExpiry(ist("2026-10-06 19:30"), night, 120).getTime()).toBe(ist("2026-10-07 08:00").getTime());
  });
  test("lateMinutes: from the effective start under the current marks; 0 when early or no work that day", () => {
    const signIn = ist("2026-10-05 12:14");
    expect(wc.lateMinutes(signIn, "2026-10-05", ctx())).toBe(194);
    const half = ctx({ marks: new Map([["2026-10-05", { kind: "leave", part: "first_half" }]]) });
    expect(wc.lateMinutes(signIn, "2026-10-05", half)).toBe(0);
    const full = ctx({ marks: new Map([["2026-10-05", { kind: "leave", part: "full" }]]) });
    expect(wc.lateMinutes(signIn, "2026-10-05", full)).toBe(0);
    expect(wc.lateMinutes(ist("2026-10-05 14:30"), "2026-10-05", half)).toBe(30);
  });
});
