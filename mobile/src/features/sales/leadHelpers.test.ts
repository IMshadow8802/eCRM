import type { FollowUp, Lookup } from "../../types/api";
import {
  dayLabel,
  defaultStatus,
  dueFromChoice,
  FOLLOWUP_TYPES,
  FOLLOWUP_VIEWS,
  followUpTypeLabel,
  followUpViewParams,
  clock,
  doneTodayParams,
  dueTitle,
  FIRST_FOLLOWUPS,
  firstOpenStatus,
  followUpLine,
  followUpMeta,
  fromNow,
  isActiveLead,
  LEAD_QUEUES,
  leadQueueParams,
  leadStatusBadge,
  localDay,
  nextOpen,
  onDayAtTimeOf,
  openRank,
  openValue,
  rupees,
  shortDay,
  whenText,
  WHEN_CHOICES,
} from "./leadHelpers";
import { lead } from "../../test/fixtures";

// 23:30 IST is already 18:00 UTC — still 2 Nov either way, but 3 Nov's "tomorrow"
// must come from local getters too.
const now = new Date(2026, 10, 2, 23, 30);
/** Defaults read the clock; bracket the call so a run across midnight cannot flake. */
function expectToday(read: () => string | null | undefined) {
  const before = localDay(new Date());
  const value = read();
  const after = localDay(new Date());
  expect([before, after]).toContain(value);
}
const status = (Id: number, Code: string | null) => ({ Id, Code }) as Lookup;

describe("lifecycle", () => {
  it("only open and qualified are being worked — a code-less row is not, as on the web and the server", () => {
    expect(["open", "qualified"].map(isActiveLead)).toEqual([true, true]);
    expect(["converted", "lost", "junk", null, undefined].map(isActiveLead)).toEqual([false, false, false, false, false]);
  });

  it("G1: ranks open-coded statuses by SortOrder, so New / Contacted / Proposal get their own badge", () => {
    const rows = [
      { Id: 3, Code: "open", SortOrder: 3 },
      { Id: 1, Code: "open", SortOrder: 1 },
      { Id: 9, Code: "qualified", SortOrder: 2 },
      { Id: 2, Code: "open", SortOrder: 2 },
      { Id: 4, Code: "open", SortOrder: 4 },
    ] as Lookup[];
    expect([1, 2, 3, 4, 77].map((id) => openRank(rows, id))).toEqual([0, 1, 2, 3, 0]);
    expect(firstOpenStatus(rows)).toBe(1);
    expect(firstOpenStatus([status(9, "qualified")])).toBeNull();
    expect(leadStatusBadge(rows, "open", 1)).toMatchObject({ tone: "sky", chip: "sky" });
    expect(leadStatusBadge(rows, "open", 2)).toMatchObject({ tone: "teal" });
    expect(leadStatusBadge(rows, "open", 4)).toMatchObject({ tone: "butter" });
    expect(leadStatusBadge(rows, "lost", 8)).toMatchObject({ tone: "red", chip: "red" });
    expect(leadStatusBadge(rows, "qualified", 9)).toMatchObject({ tone: "lilac" });
  });

  it("starts a new lead in the first open status, else the first status, else none", () => {
    expect(defaultStatus([status(4, "qualified"), status(9, "open")])).toBe(9);
    expect(defaultStatus([status(4, "qualified"), status(5, "lost")])).toBe(4);
    expect(defaultStatus([])).toBeNull();
  });
});

describe("leadQueueParams", () => {
  it("lists the five presets in order: E's four plus Unassigned (7.1)", () => {
    expect(LEAD_QUEUES.map((q) => q.label)).toEqual(["Mine", "All", "Overdue", "New", "Unassigned"]);
  });

  it("New is every lead you can see in the first open status; a status pill does not override it", () => {
    expect(leadQueueParams("new", 7, 42, "", 1)).toMatchObject({ OwnerId: null, StatusId: 1, Overdue: false, Unassigned: false });
    expect(leadQueueParams("mine", 7, 42, "", 1).StatusId).toBe(7);
  });

  it("mine narrows to the caller, a status number to that status, an empty term to none", () => {
    expect(leadQueueParams("mine", 7, 42, "")).toEqual({
      OwnerId: 42,
      StatusId: 7,
      SearchTerm: null,
      Overdue: false,
      Unassigned: false,
      PageSize: 50,
    });
  });

  it("mine needs a signed-in user id — null is a type error, not a silent widen to the whole reach", () => {
    // @ts-expect-error screens must not build a queue before auth has loaded
    leadQueueParams("mine", "all", null, "");
    expect(leadQueueParams("mine", "all", 0, "").OwnerId).toBe(0);
  });

  it("all/overdue/unassigned never filter by owner; 'all' status sends none", () => {
    expect(leadQueueParams("all", "all", 42, "acme")).toEqual({
      OwnerId: null,
      StatusId: null,
      SearchTerm: "acme",
      Overdue: false,
      Unassigned: false,
      PageSize: 50,
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
  it("Done today (G20, 118): done follow-ups whose DoneAt falls today, an exclusive end at tomorrow 00:00", () => {
    // Mine only (§7.9 ruling): the caller's own follow-ups.
    expect(doneTodayParams(7, now)).toEqual({ Status: "done", DoneFrom: "2026-11-02", DoneTo: "2026-11-03", AssignedTo: 7 });
    expect(doneTodayParams(7, new Date(2026, 11, 31, 9))).toEqual({ Status: "done", DoneFrom: "2026-12-31", DoneTo: "2027-01-01", AssignedTo: 7 });
    expectToday(() => doneTodayParams(7).DoneFrom);
  });

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
    expectToday(() => followUpViewParams("today").DueFrom);
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
    expectToday(() => dueFromChoice("today"));
  });

  it("finds the first open follow-up", () => {
    const f = (Id: number, Status: FollowUp["Status"]) => ({ Id, Status }) as FollowUp;
    expect(nextOpen([f(1, "done"), f(2, "open"), f(3, "open")])?.Id).toBe(2);
    expect(nextOpen([f(1, "skipped")])).toBeUndefined();
  });
});

describe("the lead row's follow-up line (G2)", () => {
  const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  it("planned: the day in words and the time when there is one", () => {
    expect(followUpLine(lead({ NextFollowupDate: at(2, 16, 30) }), now)).toEqual({ text: "Follow-up today 4:30 pm", tone: "default" });
    expect(followUpLine(lead({ NextFollowupDate: at(3, 11) }), now)).toEqual({ text: "Follow-up tomorrow 11:00 am", tone: "default" });
    expect(followUpLine(lead({ NextFollowupDate: at(4) }), now)).toEqual({ text: "Follow-up Wed, 4 Nov", tone: "default" });
  });
  it("overdue is red with the full date; none is muted; a closed lead owes nothing", () => {
    expect(followUpLine(lead({ NextFollowupDate: at(1, 17), IsOverdue: true }), now)).toEqual({
      text: "Follow-up overdue · Sun, 1 Nov 5:00 pm",
      tone: "danger",
    });
    expect(followUpLine(lead({ NextFollowupDate: "2026-11-01", IsOverdue: true }), now).text).toBe("Follow-up overdue · Sun, 1 Nov");
    expect(followUpLine(lead(), now)).toEqual({ text: "No follow-up planned", tone: "muted" });
    expect(followUpLine(lead({ StatusCode: "converted", NextFollowupDate: at(3) }), now).text).toBe("No follow-up planned");
  });
  it("names the type when sp_FetchLeads sends it (119); other / none read Follow-up", () => {
    expect(followUpLine(lead({ NextFollowupDate: at(3, 11), NextFollowupType: "call" }), now).text).toBe("Call tomorrow 11:00 am");
    expect(followUpLine(lead({ NextFollowupDate: at(1, 17), IsOverdue: true, NextFollowupType: "visit" }), now).text).toBe(
      "Visit overdue · Sun, 1 Nov 5:00 pm",
    );
    expect(followUpLine(lead({ NextFollowupDate: at(4), NextFollowupType: "meeting" }), now).text).toBe("Meeting Wed, 4 Nov");
    expect(followUpLine(lead({ NextFollowupDate: at(4), NextFollowupType: "other" }), now).text).toBe("Follow-up Wed, 4 Nov");
    expect(followUpLine(lead({ NextFollowupDate: at(4), NextFollowupType: null }), now).text).toBe("Follow-up Wed, 4 Nov");
  });
});

describe("open value (G3)", () => {
  it("sums EstValue over open and qualified leads only", () => {
    const rows = [
      lead({ EstValue: 100000 }),
      lead({ StatusCode: "qualified", EstValue: 23000 }),
      lead({ StatusCode: "converted", EstValue: 5 }),
      lead({ EstValue: null }),
    ];
    expect(openValue(rows, 4)).toBe(123000);
  });
  it("is unknown when the list holds more than one 200-row page", () => {
    expect(openValue([lead({ EstValue: 1 })], 201)).toBeNull();
    expect(openValue([], 0)).toBe(0);
  });
});

describe("dates and money", () => {
  it("writes E's day and clock", () => {
    expect(shortDay(new Date(2026, 10, 3, 11))).toBe("Tue, 3 Nov");
    expect([[11, 0], [17, 5], [12, 30], [0, 15]].map(([h, m]) => clock(new Date(2026, 10, 3, h!, m!)))).toEqual([
      "11:00 am",
      "5:05 pm",
      "12:30 pm",
      "12:15 am",
    ]);
    expect(whenText(new Date(2026, 10, 9, 10, 30).toISOString(), now)).toBe("Mon, 9 Nov 10:30 am");
    expect(whenText(null, now)).toBeNull();
    expect(whenText("nope", now)).toBeNull();
    expect(dueTitle(new Date(2026, 10, 3, 11).toISOString())).toBe("Tue, 3 Nov · 11:00 am");
    expect(dueTitle("2026-11-03")).toBe("Tue, 3 Nov");
    expect(dueTitle(null)).toBe("—");
  });

  it("says how far away an instant is", () => {
    expect(fromNow(new Date(2026, 10, 3, 19, 30).toISOString(), now)).toBe("in 20 h");
    expect(fromNow(new Date(2026, 10, 2, 23, 50).toISOString(), now)).toBe("in 20 min");
    expect(fromNow(new Date(2026, 10, 6, 23, 30).toISOString(), now)).toBe("in 4 d");
    expect(fromNow(new Date(2026, 10, 2, 21, 30).toISOString(), now)).toBe("2 h ago");
    expect(fromNow(null, now)).toBeNull();
  });

  it("a follow-up row reads type · day · time, or · done", () => {
    const f = (patch: Partial<FollowUp>) =>
      ({ Type: "visit", Status: "open", DueAt: new Date(2026, 10, 7, 15).toISOString(), DoneAt: null, ...patch }) as FollowUp;
    expect(followUpMeta(f({}))).toBe("Visit · Sat, 7 Nov · 3:00 pm");
    expect(followUpMeta(f({ DueAt: "2026-11-07" }))).toBe("Visit · Sat, 7 Nov");
    expect(followUpMeta(f({ Type: "call", Status: "done", DoneAt: new Date(2026, 9, 29, 9).toISOString() }))).toBe("Call · Thu, 29 Oct · done");
    expect(followUpMeta(f({ Status: "skipped" }))).toBe("Visit · Sat, 7 Nov · skipped");
    // 119: closed by a won/lost lead; dated when it was cancelled.
    expect(followUpMeta(f({ Status: "cancelled", DoneAt: new Date(2026, 10, 3, 10).toISOString() }))).toBe("Visit · Tue, 3 Nov · Cancelled");
  });

  it("a re-booking keeps the old follow-up's time of day on the new day", () => {
    expect(onDayAtTimeOf("2026-11-02T15:30:00", "2026-11-05")).toBe("2026-11-05T15:30");
    expect(onDayAtTimeOf("2026-11-02", "2026-11-05")).toBe("2026-11-05");
    expect(onDayAtTimeOf(null, "2026-11-05")).toBe("2026-11-05");
  });

  it("the form's first follow-up: Tomorrow, In 3 days, Pick date, None", () => {
    expect(FIRST_FOLLOWUPS.map((c) => c.label)).toEqual(["Tomorrow", "In 3 days", "Pick date", "None"]);
  });

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
    const taken = new Date();
    const label = dayLabel(taken.toISOString());
    // Across midnight the instant becomes "Yesterday" by the time dayLabel reads the clock.
    expect(["Today", "Yesterday"]).toContain(label);
    expect(dayLabel(taken.toISOString(), taken)).toBe("Today");
  });

  it("writes rupees with Indian grouping and no paise", () => {
    expect(rupees(150000)).toBe("₹1,50,000");
    expect(rupees(999.6)).toBe("₹1,000");
    expect(rupees(0)).toBe("₹0");
    expect(rupees(null)).toBeNull();
    expect(rupees(undefined)).toBeNull();
  });
});
