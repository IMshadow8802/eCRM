import { fetchTickets } from "../../api/ticketQueries";
import type { CustomFieldDef, CustomFieldValue, Lookup, Ticket } from "../../types/api";
import { envelope, pagination, ticket } from "../../test/fixtures";
import {
  asOptions,
  asStatusCode,
  blankDraft,
  complaintCountQuery,
  complaintQueueParams,
  customValue,
  draftFromValues,
  dueFact,
  dueWhen,
  isActive,
  isTerminal,
  lifecycleOf,
  lookupMap,
  missingRequired,
  openedText,
  rowDue,
  serialiseCustomFields,
  span,
  statusFor,
  tatLabel,
  whenText,
} from "./ticketHelpers";

jest.mock("../../api/ticketQueries");

const def = (over: Partial<CustomFieldDef>): CustomFieldDef =>
  ({ Id: 1, Type: "text", IsRequired: true, ...over }) as CustomFieldDef;

describe("lookups", () => {
  const rows = [{ Id: 3, Value: "Billing" }] as Lookup[];
  it("maps ids to names and to picker options, tolerating undefined", () => {
    expect(lookupMap(rows).get(3)).toBe("Billing");
    expect(lookupMap(undefined).size).toBe(0);
    expect(asOptions(rows)).toEqual([{ value: 3, label: "Billing" }]);
    expect(asOptions(undefined)).toEqual([]);
  });
  it("finds a status by its code, never its label", () => {
    const statuses = [
      { Id: 1, Value: "Waiting", Code: "onhold" },
      { Id: 2, Value: "On hold", Code: "open" },
    ] as Lookup[];
    expect(statusFor(statuses, "onhold")?.Id).toBe(1);
    expect(statusFor(statuses, "closed")).toBeUndefined();
  });
});

describe("queues", () => {
  it("All is no status filter; Active is the code; a number is the id", () => {
    const all = complaintQueueParams("mine", "all", 42, "");
    expect(all).toMatchObject({ AssignedTo: 42, StatusCode: null, StatusId: null, SearchTerm: null });
    expect(complaintQueueParams("team", "active", 42, "x")).toMatchObject({
      AssignedTo: null, StatusCode: "active", StatusId: null, SearchTerm: "x",
    });
    expect(complaintQueueParams("overdue", 5, 42, "")).toMatchObject({ StatusCode: null, StatusId: 5, Overdue: true });
    expect(complaintQueueParams("unassigned", "all", 42, "")).toMatchObject({ Unassigned: true, Escalated: false });
    expect(complaintQueueParams("escalated", "all", 42, "")).toMatchObject({ Escalated: true, Unassigned: false });
  });
  it("a count asks for one row under Home's key", async () => {
    const params = complaintQueueParams("mine", "active", 42, "");
    jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: [], pagination: pagination(7) }));
    const q = complaintCountQuery(params);
    expect(q.queryKey).toEqual(["tickets", "count", params]);
    await q.queryFn();
    expect(fetchTickets).toHaveBeenCalledWith({ ...params, PageSize: 1 });
  });
});

describe("lifecycle", () => {
  it("reads a null code as open and keeps known codes", () => {
    expect(asStatusCode(null)).toBe("open");
    expect(asStatusCode("bogus")).toBe("open");
    expect(asStatusCode("closed")).toBe("closed");
  });
  it("splits active from terminal", () => {
    expect(isActive("onhold")).toBe(true);
    expect(isTerminal("closed")).toBe(true);
    expect(isTerminal("open")).toBe(false);
    expect(lifecycleOf({ StatusCode: "rejected" })).toBe("rejected");
  });
});

// Mon, 2 Nov 2026, 2:41 pm — E's clock. Local strings: the zone is IST.
const NOW = new Date("2026-11-02T14:41:00");
const row = (over: Partial<Ticket>) => ticket(over);

describe("E's wording", () => {
  it("spans in whole minutes, hours and days", () => {
    expect(span(40 * 60_000)).toBe("40 m");
    expect(span(10_000)).toBe("1 m");
    expect(span(-2 * 3_600_000)).toBe("2 h");
    expect(span(72 * 3_600_000)).toBe("3 d");
  });
  it("a time today is the clock, another day the date", () => {
    expect(whenText("2026-11-02T00:05:00", NOW)).toBe("12:05 am");
    expect(whenText("2026-10-31T13:10:00", NOW)).toBe("Sat, 31 Oct");
    expect(whenText(null, NOW)).toBe("");
    expect(whenText("garbage", NOW)).toBe("");
  });
  it("Opened {day} · {time}", () => {
    expect(openedText("2026-11-02T10:30:00")).toBe("Opened Mon, 2 Nov · 10:30 am");
    expect(openedText("nope")).toBe("");
  });
  it("due when: today the clock, later the day and the clock", () => {
    expect(dueWhen("2026-11-02T12:40:00", NOW)).toBe("12:40 pm");
    expect(dueWhen("2026-11-03T17:30:00", NOW)).toBe("Tue, 3 Nov, 5:30 pm");
    expect(dueWhen(null, NOW)).toBeNull();
  });
});

describe("rowDue", () => {
  it("Overdue 2 h, in danger, from the row's flag", () => {
    expect(rowDue(row({ DueAt: "2026-11-02T12:41:00", IsOverdue: true }), NOW)).toEqual({ text: "Overdue 2 h", tone: "danger" });
    expect(rowDue(row({ DueAt: "2026-11-02T14:01:00", IsOverdue: true }), NOW)).toEqual({ text: "Overdue 40 m", tone: "danger" });
  });
  it("Due 5:30 pm today; the date for a later day", () => {
    expect(rowDue(row({ DueAt: "2026-11-02T17:30:00", StatusCode: "onhold" }), NOW)).toEqual({ text: "Due 5:30 pm", tone: "default" });
    expect(rowDue(row({ DueAt: "2026-11-03T09:00:00" }), NOW)).toEqual({ text: "Tue, 3 Nov", tone: "default" });
  });
  it("Done 1:10 pm on a resolved one, in success", () => {
    expect(rowDue(row({ StatusCode: "resolved", ResolvedAt: "2026-11-02T13:10:00" }), NOW)).toEqual({ text: "Done 1:10 pm", tone: "success" });
    expect(rowDue(row({ StatusCode: "resolved", ResolvedAt: null }), NOW)).toBeNull();
  });
  it("the day it closed on a closed or rejected one", () => {
    expect(rowDue(row({ StatusCode: "closed", ClosedAt: "2026-10-31T11:00:00" }), NOW)).toEqual({ text: "Sat, 31 Oct", tone: "default" });
    expect(rowDue(row({ StatusCode: "rejected", UpdatedAt: "2026-11-02T09:00:00" }), NOW)).toEqual({ text: "9:00 am", tone: "default" });
    expect(rowDue(row({ StatusCode: "closed" }), NOW)).toBeNull();
  });
  it("nothing when there is no clock", () => {
    expect(rowDue(row({ DueAt: null }), NOW)).toBeNull();
  });
});

describe("dueFact", () => {
  it("12:40 pm · 2 h over while overdue", () => {
    expect(dueFact(row({ DueAt: "2026-11-02T12:40:00", IsOverdue: true }), NOW)).toEqual({ text: "12:40 pm · 2 h over", overdue: true });
  });
  it("just the time when on time, or once the clock has stopped", () => {
    expect(dueFact(row({ DueAt: "2026-11-02T17:30:00" }), NOW)).toEqual({ text: "5:30 pm", overdue: false });
    expect(dueFact(row({ DueAt: "2026-11-02T12:40:00", IsOverdue: true, StatusCode: "resolved" }), NOW)).toEqual({
      text: "12:40 pm", overdue: false,
    });
    expect(dueFact(row({ DueAt: null }), NOW)).toBeNull();
  });
  it("labels a priority's TAT as working hours, never calendar days", () => {
    expect(tatLabel(null)).toBeNull();
    expect(tatLabel(1)).toBe("1 working hour");
    expect(tatLabel(72)).toBe("72 working hours");
  });
});

describe("custom fields", () => {
  const value = (over: Partial<CustomFieldValue>): CustomFieldValue =>
    ({ ValueText: null, ValueNumber: null, ValueDate: null, ...over }) as CustomFieldValue;

  it("reads each stored type back into its form shape", () => {
    expect(
      draftFromValues([
        value({ FieldId: 1, Type: "checkbox", ValueText: "true" }),
        value({ FieldId: 2, Type: "number", ValueNumber: 5 }),
        value({ FieldId: 3, Type: "number" }),
        value({ FieldId: 4, Type: "date", ValueDate: "2026-11-01T00:00:00" }),
        value({ FieldId: 5, Type: "text" }),
      ]),
    ).toEqual({ 1: true, 2: "5", 3: "", 4: "2026-11-01", 5: "" });
  });
  it("prints each stored type as one line", () => {
    expect(customValue(value({ Type: "checkbox", ValueNumber: 1 }))).toBe("Yes");
    expect(customValue(value({ Type: "checkbox" }))).toBe("No");
    expect(customValue(value({ Type: "number", ValueNumber: 4 }))).toBe("4");
    expect(customValue(value({ Type: "number" }))).toBe("—");
    expect(customValue(value({ Type: "date", ValueDate: "2026-11-01T00:00:00" }))).toBe("2026-11-01");
    expect(customValue(value({ Type: "date" }))).toBe("—");
    expect(customValue(value({ Type: "text", ValueText: "Tiled" }))).toBe("Tiled");
    expect(customValue(value({ Type: "text" }))).toBe("—");
  });
  it("seeds a blank draft and serialises it per definition", () => {
    const defs = [def({ Id: 1 }), def({ Id: 2, Type: "checkbox" })];
    expect(blankDraft(defs)).toEqual({ 1: "", 2: false });
    expect(JSON.parse(serialiseCustomFields(defs, { 1: "x" })!)).toEqual([
      { fieldId: 1, type: "text", value: "x" },
      { fieldId: 2, type: "checkbox", value: false },
    ]);
  });
  it("serialises nothing for no definitions", () => {
    expect(serialiseCustomFields([], {})).toBeNull();
  });
  it("flags an empty required text field and an unticked required checkbox", () => {
    const text = def({ Id: 1 });
    const box = def({ Id: 2, Type: "checkbox" });
    expect(missingRequired([text, box], { 1: "  ", 2: false })).toEqual([text, box]);
    expect(missingRequired([text, box], { 1: "x", 2: true })).toEqual([]);
  });
});
