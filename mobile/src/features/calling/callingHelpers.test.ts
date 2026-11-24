import type { CallContact, MyCallList } from "../../types/api";
import {
  RESULT_LABELS, callbackChoices, emptyCopy, historyLine, isOverdue, localDateTime, titleOf,
} from "./callingHelpers";

const contact = (p: Partial<CallContact> = {}): CallContact => ({
  Id: 9, CallListId: 1, ListName: "MLSS Delhi", Name: "First Trader", Company: null, City: null, State: null,
  Mobile: "9825012345", AltMobile: null, extras: [], Attempts: 0, LastResult: null, LastCalledAt: null,
  CallbackAt: null, PhoneMark: null, PhoneMarkNote: null, ...p,
});
const head = (EmptyReason: MyCallList["head"]["EmptyReason"]): MyCallList["head"] => ({
  ToCall: 0, Callbacks: 0, CalledToday: 0, Given: 0, OutsideHours: false, Active: true, EmptyReason, CallbackCap: 20,
});

it("labels every result", () => {
  expect(RESULT_LABELS).toEqual({
    no_answer: "No answer", busy: "Busy", not_interested: "Not interested", wrong_number: "Wrong number",
    callback: "Call back", dnc: "Do not call", interested: "Interested",
  });
});

it("writes local date-time, not UTC", () => {
  expect(localDateTime(new Date(2026, 10, 17, 16, 5))).toBe("2026-11-17T16:05");
  expect(localDateTime(new Date(2026, 0, 2, 0, 0))).toBe("2026-01-02T00:00");
});

it("offers this evening only before 5:30 pm", () => {
  expect(callbackChoices(new Date(2026, 10, 16, 14, 0)).map((c) => c.key)).toEqual(["none", "evening", "tomorrow", "pick"]);
  expect(callbackChoices(new Date(2026, 10, 16, 17, 30)).map((c) => c.key)).toEqual(["none", "tomorrow", "pick"]);
  expect(callbackChoices(new Date(2026, 10, 16, 14, 0))[1]!.at).toBe("2026-11-16T18:00");
  expect(callbackChoices(new Date(2026, 10, 30, 23, 50))[1]!.at).toBe("2026-12-01T11:00"); // month rolls
  const [none, , , pick] = callbackChoices(new Date(2026, 10, 16, 9, 0));
  expect(none).toMatchObject({ label: "No time", at: null });
  expect(pick).toMatchObject({ label: "Pick date & time", at: null });
});

it("titles a contact by name, then company, then number", () => {
  expect(titleOf(contact())).toBe("First Trader");
  expect(titleOf(contact({ Name: null, Company: "Kaur Stores" }))).toBe("Kaur Stores");
  expect(titleOf(contact({ Name: "  ", Company: null }))).toBe("9825012345");
});

it("describes earlier tries", () => {
  const now = new Date(2026, 10, 16, 9, 0);
  expect(historyLine(contact({ Attempts: 2, LastResult: "no_answer", LastCalledAt: "2026-11-15T16:10:00" }), now))
    .toBe("3rd try · no answer yesterday 4:10 pm");
  expect(historyLine(contact({ Attempts: 0, LastResult: "callback", LastCalledAt: "2026-11-16T08:05:00" }), now))
    .toBe("1st try · call back today 8:05 am");
  expect(historyLine(contact({ Attempts: 1, LastResult: "busy", LastCalledAt: "2026-11-02T11:00:00" }), now))
    .toBe("2nd try · busy 2 Nov 11:00 am");
  expect(historyLine(contact({ Attempts: 10, LastResult: null, LastCalledAt: null }), now)).toBe("11th try");
  expect(historyLine(contact({ Attempts: 20, LastResult: "busy" }), now)).toBe("21st try · busy");
  expect(historyLine(contact({ Attempts: 0, LastResult: null }), new Date())).toBeNull();
});

it.each([
  ["hours", "Outside calling hours", "New contacts arrive during calling hours."],
  ["paused", "Calling is paused", "Your manager has paused this list."],
  ["finished", "This list is finished", "Every contact has been called."],
  ["manual", "All called", "Ask your manager for more."],
  [null, "All called", "Ask your manager for more."],
] as const)("picks the empty-state copy for %s", (reason, title, body) => {
  expect(emptyCopy(head(reason))).toEqual({ title, body });
});

it("a callback is overdue once its time has passed", () => {
  const now = new Date(2026, 10, 16, 16, 22);
  expect(isOverdue(contact({ CallbackAt: "2026-11-16T16:00:00" }), now)).toBe(true);
  expect(isOverdue(contact({ CallbackAt: "2026-11-17T11:00:00" }), now)).toBe(false);
  expect(isOverdue(contact({ CallbackAt: null }), now)).toBe(false);
});
