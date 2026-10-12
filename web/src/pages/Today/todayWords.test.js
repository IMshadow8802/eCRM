import { describe, it, expect } from "vitest";
import { timeLeftText, durationText, taskChip, presenceLine, BUCKET_LABELS, TILES } from "./todayWords";

const flags = (o = {}) => ({ given: false, done: false, doneLate: false, open: true, working: false, notStarted: true, dueToday: false, overdue: false, atRisk: false, onHold: false, reasonOwed: false, toRule: false, ...o });
const task = (o = {}, f = {}) => ({ timer: "clock", timeLeftMin: 80, HoldReason: null, CompletedDate: null, BreachedAt: null, flags: flags(f), ...o });

describe("durationText / timeLeftText", () => {
  it("formats minutes", () => {
    expect(durationText(250)).toBe("4h 10m");
    expect(durationText(25)).toBe("25m");
    expect(durationText(0)).toBe("0m");
  });
  it("formats time left", () => {
    expect(timeLeftText(80)).toBe("1h 20m left");
    expect(timeLeftText(-130)).toBe("Overdue 2h 10m");
    expect(timeLeftText(0)).toBe("Due now");
    expect(timeLeftText(null)).toBe("No timer");
    expect(timeLeftText(undefined)).toBe("No timer");
  });
});

describe("taskChip", () => {
  it("missed with reason owed is red with the date", () => {
    expect(taskChip(task({ BreachedAt: "2026-10-08T06:00:00.000Z" }, { reasonOwed: true, overdue: true }))).toEqual({ label: "Missed · 8 Oct", tone: "red" });
  });
  it("overdue red, at risk amber, on hold blue, plain grey", () => {
    expect(taskChip(task({ timeLeftMin: -130 }, { overdue: true }))).toEqual({ label: "Overdue 2h 10m", tone: "red" });
    expect(taskChip(task({}, { atRisk: true }))).toEqual({ label: "1h 20m left", tone: "amber" });
    expect(taskChip(task({ HoldReason: "Waiting on client" }, { onHold: true }))).toEqual({ label: "On hold · Waiting on client", tone: "blue" });
    expect(taskChip(task({ HoldReason: null }, { onHold: true })).label).toBe("On hold");
    expect(taskChip(task())).toEqual({ label: "1h 20m left", tone: "grey" });
    expect(taskChip(task({ timer: "none", timeLeftMin: null }))).toEqual({ label: "No timer", tone: "grey" });
  });
  it("done is green on time, amber late, green without timer", () => {
    const d = { CompletedDate: "2026-10-08T04:30:00.000Z" }; // 10:00 IST
    expect(taskChip(task(d, { done: true, open: false }))).toEqual({ label: "On time · 10:00", tone: "green" });
    expect(taskChip(task(d, { done: true, doneLate: true, open: false }))).toEqual({ label: "Late · 10:00", tone: "amber" });
    expect(taskChip(task({ ...d, timer: "none" }, { done: true, open: false }))).toEqual({ label: "Done · 10:00", tone: "green" });
  });
  it("done without a completed time (my part done) shows no time", () => {
    expect(taskChip(task({ CompletedDate: null }, { done: true, open: false }))).toEqual({ label: "On time", tone: "green" });
    expect(taskChip(task({ CompletedDate: null }, { done: true, doneLate: true, open: false }))).toEqual({ label: "Late", tone: "amber" });
    expect(taskChip(task({ CompletedDate: null, timer: "none" }, { done: true, open: false }))).toEqual({ label: "Done", tone: "green" });
  });
  it("past day: no live time left shows the due date, not No timer", () => {
    expect(taskChip(task({ timeLeftMin: null, due: "2026-10-08T12:00:00.000Z" }))).toEqual({ label: "Due 8 Oct", tone: "grey" });
    expect(taskChip(task({ timeLeftMin: null, due: null, timer: "none" }))).toEqual({ label: "No timer", tone: "grey" });
  });
});

const p = (o = {}) => ({ status: { code: "online", label: "Online" }, FirstSignInAt: "2026-10-08T04:12:00.000Z", ShiftStart: "2026-10-08T04:00:00.000Z", ShiftEnd: "2026-10-08T13:00:00.000Z", LastSeenAt: null, session: { onlineMinutes: 250, signIns: 2, devices: ["web", "mobile"] }, ...o });

describe("presenceLine", () => {
  it("signed in", () => {
    expect(presenceLine(p())).toBe("In 09:42 · online 4h 10m · 2 sign-ins (web, mobile)");
    expect(presenceLine(p({ session: { onlineMinutes: 5, signIns: 1, devices: [] } }))).toBe("In 09:42 · online 5m · 1 sign-in");
    expect(presenceLine(p({ session: null }))).toBe("In 09:42");
  });
  it("no sign-in", () => {
    expect(presenceLine(p({ FirstSignInAt: null, status: { code: "not_signed_in", label: "Not signed in" }, LastSeenAt: "2026-10-08T06:59:00.000Z" })))
      .toBe("Shift 09:30–18:30 · no sign-in today · last seen Thu 12:29");
    expect(presenceLine(p({ FirstSignInAt: null, status: { code: "not_signed_in_yet", label: "Not signed in yet" } }))).toBe("Shift starts 09:30");
    expect(presenceLine(p({ FirstSignInAt: null, status: { code: "not_signed_in_yet", label: "Not signed in yet" }, LastSeenAt: "2026-10-08T02:00:00.000Z" }))).toBe("Shift starts 09:30 · last seen Thu 07:30");
    expect(presenceLine(p({ FirstSignInAt: null, ShiftStart: null, ShiftEnd: null, status: { code: "offline", label: "Offline" } }))).toBe("Day off");
  });
  it("leave, duty, half, not tracked", () => {
    expect(presenceLine(p({ status: { code: "leave", label: "On leave" } }))).toBe("On leave");
    expect(presenceLine(p({ SignedOutAt: "2026-10-08 17:05:00", status: { code: "signed_out", label: "Signed out" } }))).toBe("In 09:42 · online 4h 10m · 2 sign-ins (web, mobile) · signed out 17:05");
    expect(presenceLine(p({ FirstSignInAt: null, ShiftStart: "2026-10-08 09:30:00", ShiftEnd: null, status: { code: "offline", label: "Offline" } }))).toBe("No sign-in today");
    expect(presenceLine(p({ status: { code: "online", label: "Online", half: "first_half" } }))).toBe("In 09:42 · online 4h 10m · 2 sign-ins (web, mobile) · Leave · first half");
    expect(presenceLine(p({ FirstSignInAt: null, status: { code: "not_signed_in", label: "Not signed in", half: "second_half" } }))).toBe("Shift 09:30–18:30 · no sign-in today · Leave · second half");
    expect(presenceLine(p({ status: { code: "on_duty", label: "On duty" } }))).toBe("On duty");
    expect(presenceLine(p({ status: { code: "holiday", label: "Holiday" } }))).toBe("Holiday");
    expect(presenceLine(p({ status: { code: "not_tracked", label: "Not tracked" } }))).toBe("Not tracked");
  });

  // Regression: a past day said "no sign-in today".
  it("a past day never says today", () => {
    expect(presenceLine(p({ FirstSignInAt: null, status: { code: "not_signed_in", label: "Not signed in" } }), false)).toBe("Shift 09:30–18:30 · no sign-in");
    expect(presenceLine(p({ FirstSignInAt: null, ShiftStart: "2026-10-08 09:30:00", ShiftEnd: null, status: { code: "offline", label: "Offline" } }), false)).toBe("No sign-in");
  });
});

describe("BUCKET_LABELS / TILES", () => {
  it("labels", () => {
    expect(BUCKET_LABELS.toRule).toBe("Waiting for your ruling");
    expect(BUCKET_LABELS.atRisk).toBe("Close to deadline");
    expect(Object.keys(BUCKET_LABELS)).toHaveLength(11);
  });
  it("7 tiles with tests", () => {
    expect(TILES.map((t) => t.key)).toEqual(["in", "notIn", "late", "away", "overdue", "atRisk", "toRule"]);
    const by = Object.fromEntries(TILES.map((t) => [t.key, t.test]));
    const c = (o) => ({ status: { code: "offline" }, counts: {}, ...o });
    expect(by.in(c({ status: { code: "online" } }))).toBe(true);
    expect(by.in(c({ status: { code: "signed_out" } }))).toBe(false);
    expect(by.notIn(c({ status: { code: "not_signed_in" } }))).toBe(true);
    expect(by.late(c({ status: { code: "online", late: "Late by 3 min" } }))).toBe(true);
    expect(by.late(c())).toBe(false);
    expect(by.away(c({ status: { code: "leave" } }))).toBe(true);
    expect(by.away(c({ status: { code: "on_duty" } }))).toBe(true);
    expect(by.away(c())).toBe(false);
    expect(by.overdue(c({ counts: { overdue: 2 } }))).toBe(true);
    expect(by.overdue(c({ counts: { overdue: null } }))).toBe(false);
    expect(by.overdue({ status: {} })).toBe(false);
    expect(by.atRisk(c({ counts: { atRisk: 1 } }))).toBe(true);
    expect(by.toRule(c({ counts: { toRule: 1 } }))).toBe(true);
    expect(by.toRule(c({ counts: { toRule: 0 } }))).toBe(false);
  });
});
