import type { FollowUp, Lookup } from "../../types/api";
import {
  dayLabel,
  defaultStatus,
  dueFromChoice,
  FOLLOWUP_TYPES,
  FOLLOWUP_VIEWS,
  followUpTypeLabel,
  followUpViewParams,
  isActiveLead,
  LEAD_QUEUES,
  leadQueueParams,
  leadTone,
  localDay,
  nextOpen,
  rupees,
  WHEN_CHOICES,
} from "./leadHelpers";

// 23:30 IST is already 18:00 UTC — still 2 Nov either way, but 3 Nov's "tomorrow"
// must come from local getters too.
const now = new Date(2026, 10, 2, 23, 30);
const status = (Id: number, Code: string | null) => ({ Id, Code }) as Lookup;

describe("lifecycle", () => {
  it("open, qualified and a code-less legacy row are still being worked; the closed three are not", () => {
    expect(["open", "qualified", null, undefined].map(isActiveLead)).toEqual([true, true, true, true]);
    expect(["converted", "lost", "junk"].map(isActiveLead)).toEqual([false, false, false]);
  });

  it("gives every code its tone, primary when there is none", () => {
    expect(["open", "qualified", "converted", "lost", "junk", null].map(leadTone)).toEqual([
      "primary",
      "info",
      "success",
      "danger",
      "neutral",
      "primary",
    ]);
  });

  it("starts a new lead in the first open status, else the first status, else none", () => {
    expect(defaultStatus([status(4, "qualified"), status(9, "open")])).toBe(9);
    expect(defaultStatus([status(4, "qualified"), status(5, "lost")])).toBe(4);
    expect(defaultStatus([])).toBeNull();
  });
});

describe("leadQueueParams", () => {
  it("lists the four queues in order", () => {
    expect(LEAD_QUEUES.map((q) => q.label)).toEqual(["Mine", "All", "Overdue", "Unassigned"]);
  });

  it("mine narrows to the caller, a status number to that status, an empty term to none", () => {
    expect(leadQueueParams("mine", 7, 42, "")).toEqual({
      OwnerId: 42,
      StatusId: 7,
      SearchTerm: null,
      Overdue: false,
      Unassigned: false,
      PageSize: 100,
    });
  });

  it("all/overdue/unassigned never filter by owner; 'all' status sends none", () => {
    expect(leadQueueParams("all", "all", 42, "acme")).toEqual({
      OwnerId: null,
      StatusId: null,
      SearchTerm: "acme",
      Overdue: false,
      Unassigned: false,
      PageSize: 100,
    });
    expect(leadQueueParams("overdue", "all", 42, "")).toMatchObject({ OwnerId: null, Overdue: true, Unassigned: false });
    expect(leadQueueParams("unassigned", "all", 42, "")).toMatchObject({
      OwnerId: null,
      Overdue: false,
      Unassigned: true,
    });
  });
});

describe("followUpViewParams", () => {
  it("lists the four views in order", () => {
    expect(FOLLOWUP_VIEWS.map((v) => v.label)).toEqual(["Today", "Overdue", "Upcoming", "All"]);
  });

  it("matches the web queue's views, on the local day", () => {
    expect(followUpViewParams("today", now)).toEqual({ Status: "open", DueFrom: "2026-11-02", DueTo: "2026-11-02" });
    expect(followUpViewParams("overdue", now)).toEqual({ Overdue: true });
    expect(followUpViewParams("upcoming", now)).toEqual({ Status: "open", DueFrom: "2026-11-03" });
    expect(followUpViewParams("all", now)).toEqual({});
  });

  it("defaults to the current day", () => {
    expect(followUpViewParams("today").DueFrom).toBe(localDay(new Date()));
  });
});

describe("follow-ups", () => {
  it("labels each type, 'Follow-up' for anything else", () => {
    expect(FOLLOWUP_TYPES.map((t) => followUpTypeLabel(t.value))).toEqual(["Call", "Visit", "Meeting", "Other"]);
    expect(followUpTypeLabel(null)).toBe("Follow-up");
    expect(followUpTypeLabel("fax")).toBe("Follow-up");
  });

  it("books the four when-choices on local days, across a year end", () => {
    expect(WHEN_CHOICES.map((c) => c.label)).toEqual(["Today", "Tomorrow", "In 3 days", "Next week"]);
    expect(WHEN_CHOICES.map((c) => dueFromChoice(c.value, now))).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-05",
      "2026-11-09",
    ]);
    expect(dueFromChoice("week", now)).toBe("2026-11-09");
    expect(dueFromChoice("tomorrow", new Date(2026, 11, 31))).toBe("2027-01-01");
    expect(dueFromChoice("today")).toBe(localDay(new Date()));
  });

  it("finds the first open follow-up", () => {
    const f = (Id: number, Status: FollowUp["Status"]) => ({ Id, Status }) as FollowUp;
    expect(nextOpen([f(1, "done"), f(2, "open"), f(3, "open")])?.Id).toBe(2);
    expect(nextOpen([f(1, "skipped")])).toBeUndefined();
  });
});

describe("dates and money", () => {
  it("formats a local Y-M-D with padding", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDay(now)).toBe("2026-11-02");
  });

  it("names the day of an instant relative to now", () => {
    expect(dayLabel(new Date(2026, 10, 2, 9).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 3, 9).toISOString(), now)).toBe("Tomorrow");
    expect(dayLabel(new Date(2026, 10, 1, 9).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 12, 9).toISOString(), now)).toBe("12 Nov");
    expect(dayLabel(new Date(2025, 10, 12, 9).toISOString(), now)).toBe("12 Nov 2025");
    expect(dayLabel(null, now)).toBeNull();
    expect(dayLabel("not a date", now)).toBeNull();
    expect(dayLabel(new Date().toISOString())).toBe("Today");
  });

  it("writes rupees with Indian grouping and no paise", () => {
    expect(rupees(150000)).toBe("₹1,50,000");
    expect(rupees(999.6)).toBe("₹1,000");
    expect(rupees(0)).toBe("₹0");
    expect(rupees(null)).toBeNull();
    expect(rupees(undefined)).toBeNull();
  });
});
