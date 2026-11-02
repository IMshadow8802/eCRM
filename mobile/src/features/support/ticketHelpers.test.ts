import type { CustomFieldDef, CustomFieldValue, Lookup } from "../../types/api";
import {
  asOptions,
  asStatusCode,
  blankDraft,
  dateTime,
  draftFromValues,
  dueLabel,
  isActive,
  isTerminal,
  lifecycleOf,
  lookupMap,
  missingRequired,
  priorityTone,
  serialiseCustomFields,
  statusTone,
  tatLabel,
} from "./ticketHelpers";

const HOUR = 3_600_000;
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
  it("tones by code, and priority by name with a neutral fallback", () => {
    expect(statusTone("resolved")).toBe("success");
    expect(priorityTone("Critical")).toBe("danger");
    expect(priorityTone("HIGH")).toBe("danger");
    expect(priorityTone("Normal")).toBe("warning");
    expect(priorityTone("low")).toBe("success");
    expect(priorityTone(null)).toBe("neutral");
  });
});

describe("dueLabel", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();

  it("phrases a future due date", () => {
    const r = dueLabel({ DueAt: at(2 * HOUR), IsOverdue: false, StatusCode: "open" }, now);
    expect(r?.label).toMatch(/^Due in/);
    expect(r?.overdue).toBe(false);
  });
  it("trusts the row's IsOverdue", () => {
    const r = dueLabel({ DueAt: at(-2 * HOUR), IsOverdue: true, StatusCode: "open" }, now);
    expect(r?.overdue).toBe(true);
    expect(r?.label).toMatch(/^Overdue by/);
  });
  it("rounds to whole minutes and days", () => {
    const due = (ms: number) =>
      dueLabel({ DueAt: at(ms), IsOverdue: false, StatusCode: "onhold" }, now)?.label;
    expect(due(10 * 60_000)).toBe("Due in 10m");
    expect(due(72 * HOUR)).toBe("Due in 3d");
  });
  it("labels a priority's TAT as working hours, never calendar days", () => {
    expect(tatLabel(null)).toBeNull();
    expect(tatLabel(1)).toBe("1 working hour");
    expect(tatLabel(72)).toBe("72 working hours");
  });
  it("prints a timestamp DD-MM-YYYY HH:mm, or null", () => {
    expect(dateTime("2026-01-05T09:07:00")).toBe("05-01-2026 09:07");
    expect(dateTime(null)).toBeNull();
    expect(dateTime("garbage")).toBeNull();
  });
  it("is null for a terminal ticket, no DueAt, or a bad date", () => {
    expect(dueLabel({ DueAt: at(HOUR), IsOverdue: false, StatusCode: "closed" }, now)).toBeNull();
    expect(dueLabel({ DueAt: null, IsOverdue: false, StatusCode: "open" }, now)).toBeNull();
    expect(dueLabel({ DueAt: "nope", IsOverdue: false, StatusCode: "open" }, now)).toBeNull();
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
