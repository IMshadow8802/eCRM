// src/pages/Reports/sales/columns.js
//
// Every column the five sales reports can show or export: its heading, the
// hint under it, its colour-key hue `k` (reportKey in styles/tokens.js), how
// it formats, whether a rise is good (null = neither), how its number is read
// off an sp_RptSales line, and which sp_RptSalesRows drill lists exactly the
// rows it counted (null = a derived number with no rows of its own).

const n = (v) => (v === null || v === undefined ? null : Number(v));
const sum = (l, ...keys) => keys.reduce((s, k) => s + (Number(l[k]) || 0), 0);
// a / b, as a percent unless `scale` is given; null when either side is missing or b is 0.
const ratio = (a, b, scale = 100) => (a == null || !Number(b) ? null : (scale * Number(a)) / Number(b));

const col = (key, header, k, format, goodUp, value, drill, hint, extra = {}) =>
  ({ key, header, hint, k, format, goodUp, value, drill, ...extra });
const field = (f) => (l) => n(l[f]);

export const COLUMNS = Object.fromEntries([
  col("new", "New leads", "new", "int", true, field("New"), { Metric: "new" },
    "Leads created in these days, credited to the lead's current owner."),
  col("calls", "Calls", "call", "int", true, field("Calls"), { Metric: "call" },
    "Calls done in these days, credited to whoever made them."),
  col("visits", "Visits & meetings", "visit", "int", true, (l) => sum(l, "Visits", "Meetings"), { Metric: "visits" },
    "Visits and meetings done in these days, credited to whoever did them."),
  col("due", "Follow-ups due", "stock", "int", null, (l) => sum(l, "FuOnTime", "FuLate", "FuSkipped", "FuMissed", "FuOpen"), { Metric: "fu_due" },
    "Follow-ups that fell due in these days (cancelled ones left out)."),
  col("missed", "Missed", "late", "int", false, field("FuMissed"), { Metric: "fu_missed" },
    "Due in these days, not done, time passed, lead still open."),
  col("won", "Won", "won", "int", true, field("Won"), { Metric: "won" }, "Leads marked won in these days."),
  col("wonValue", "Won ₹", "won", "money", true, field("WonValue"), { Metric: "won" }, "Value of those wins (before tax)."),
  col("lost", "Lost", "lost", "int", false, field("Lost"), { Metric: "lost" }, "Leads marked lost in these days."),
  col("openNow", "Open leads", "stock", "int", null, field("OpenNow"), { Metric: "open" },
    "Open right now, whatever the dates.", { now: true }),
  col("overdueNow", "Overdue", "late", "int", null, field("OverdueNow"), { Metric: "open", Flag: "overdue" },
    "Open leads whose next follow-up time has passed, right now.", { now: true }),
  // Export only.
  col("other", "Other follow-ups done", "stock", "int", null, field("Other"), { Metric: "other" },
    "Follow-ups of other kinds done in these days."),
  col("onTime", "Done on time", "won", "int", true, field("FuOnTime"), { Metric: "fu_ontime" },
    "Done within 2 hours of a timed follow-up, or on the due day for one with no time."),
  col("late", "Done late", "late", "int", false, field("FuLate"), { Metric: "fu_late" },
    "Due in these days and done, but later than that."),
  col("skipped", "Skipped", "stock", "int", null, field("FuSkipped"), { Metric: "fu_skipped" },
    "Due in these days and skipped."),
  // Lead sources: the leads that came in these days, as they stand today.
  col("cohortOpen", "Still open", "stock", "int", null, field("CohortOpen"), { Metric: "new", State: "open" },
    "Of the leads that came in these days, how many are open today."),
  col("cohortWon", "Won", "won", "int", true, field("CohortWon"), { Metric: "new", State: "won" },
    "Of those leads, how many are won today."),
  col("cohortWonValue", "Won ₹", "won", "money", true, field("CohortWonValue"), { Metric: "new", State: "won" },
    "Value of those wins (before tax)."),
  col("cohortLost", "Lost", "lost", "int", false, field("CohortLost"), { Metric: "new", State: "lost" },
    "Of those leads, how many are lost today."),
  col("cohortJunk", "Junk", "stock", "int", null, field("CohortJunk"), { Metric: "new", State: "junk" },
    "Of those leads, how many were marked junk."),
  col("conversion", "Conversion %", "stock", "pct", true, (l) => (Number(l.New) ? (100 * (Number(l.CohortWon) || 0)) / Number(l.New) : null), null,
    "Of the leads that came in, how many are won by now."),
  col("untouched", "Not contacted yet", "idle", "int", false, field("CohortUntouched"), { Metric: "new", State: "untouched" },
    "Still open with no call, visit or meeting done."),
  // Open leads.
  col("open", "Open leads", "stock", "int", null, field("OpenNow"), { Metric: "open" }, "Open or qualified right now."),
  col("age0", "0–7 days", "stock", "int", null, field("Age0_7"), { Metric: "open", AgeBucket: "0_7" }, "Created 0 to 7 days ago."),
  col("age8", "8–30", "stock", "int", null, field("Age8_30"), { Metric: "open", AgeBucket: "8_30" }, "Created 8 to 30 days ago."),
  col("age31", "31–90", "stock", "int", null, field("Age31_90"), { Metric: "open", AgeBucket: "31_90" }, "Created 31 to 90 days ago."),
  col("age90", "90+", "stock", "int", null, field("Age90Plus"), { Metric: "open", AgeBucket: "90p" }, "Created more than 90 days ago."),
  col("openValue", "Value ₹", "stock", "money", null, field("OpenValue"), { Metric: "open" }, "Estimated value of these open leads."),
  col("overdue", "Overdue", "late", "int", null, field("OverdueNow"), { Metric: "open", Flag: "overdue" }, "Next follow-up time has passed."),
  col("noNext", "No next follow-up", "idle", "int", null, field("NoNext"), { Metric: "open", Flag: "nonext" }, "Open with no follow-up planned."),
  col("stale", "Not touched 7+ days", "idle", "int", null, field("Stale"), { Metric: "open", Flag: "stale" },
    "No call, visit, note or status change in the last 7 days."),
  // Lost leads.
  col("lostN", "Lost", "lost", "int", false, field("Lost"), { Metric: "lost" }, "Leads marked lost in these days."),
  col("share", "Share %", "stock", "pct", null, (l, t) => (Number(t?.Lost) ? (100 * (Number(l.Lost) || 0)) / Number(t.Lost) : null), null,
    "This reason's part of everything lost in these days."),
  col("lostValue", "Value lost ₹", "lost", "money", false, field("LostValue"), { Metric: "lost" }, "Estimated value of those leads."),
  col("avgDays", "Avg days open", "stock", "days", null, (l) => (Number(l.DaysOpenN) ? Number(l.DaysOpenSum) / Number(l.DaysOpenN) : null), null,
    "From created to lost, on average."),
  // Calling (149). A ratio with a zero or empty divisor is null ("—"); `cost` columns are the admin's only.
  col("dials", "Calls", "call", "int", true, field("Dials"), { Metric: "dial" }, "Calls saved in these days, credited to whoever rang."),
  col("dialContacts", "Contacts called", "call", "int", true, field("DialContacts"), { Metric: "dial_first" },
    "Different contacts called in these days."),
  col("reached", "Reached", "call", "int", true, field("DialReached"), { Metric: "dial", Flag: "reached" },
    "Calls that reached someone: interested, not interested, call back or do not call."),
  col("reachPct", "Reach %", "stock", "pct", true, (l) => ratio(l.DialReached, l.Dials), null, "Reached out of the calls."),
  col("cbBooked", "Callbacks booked", "stock", "int", null, field("CbBooked"), { Metric: "dial", Flag: "cbbooked" }, "Calls that booked a callback."),
  col("cbKept", "Callbacks kept", "won", "int", true, field("CbKept"), { Metric: "dial", Flag: "cbkept" }, "Booked callbacks that were made."),
  col("cbMissed", "Callbacks missed", "late", "int", false, field("CbMissed"), { Metric: "dial", Flag: "cbmissed" }, "Booked callbacks that were not made in time."),
  col("noDial", "Saved without dialling", "idle", "int", false, field("DialNoDial"), { Metric: "dial", Flag: "nodial" },
    "Results saved without tapping Call first."),
  col("avgDialSec", "Avg seconds dial → result", "stock", "int", null, (l) => ratio(l.DialSecSum, l.DialSecN, 1), null,
    "From tapping Call to saving the result, on average."),
  col("listContacts", "Contacts", "stock", "int", null, field("ListContacts"), { Metric: "contact" }, "Contacts on the list, as it stands now.", { now: true }),
  col("usedPct", "Used %", "stock", "pct", null, (l) => ratio(l.ListUsed, l.ListContacts), null, "Contacts handed out or called at least once."),
  col("listLeads", "Leads", "new", "int", true, field("New"), { Metric: "new" }, "Leads made from the list."),
  col("leadPct", "Lead % of reached", "stock", "pct", true, (l) => ratio(l.New, l.DialReached), null, "Leads out of the calls that reached someone."),
  col("listCost", "Cost ₹", "stock", "money", null, field("ListCost"), null, "What the list cost.", { cost: true }),
  col("costPerLead", "Cost per lead ₹", "stock", "money", false, (l) => ratio(l.ListCost, l.New, 1), null, "Cost divided by leads.", { cost: true }),
  col("costPerWon", "Cost per won ₹", "stock", "money", false, (l) => ratio(l.ListCost, l.CohortWon, 1), null, "Cost divided by deals won.", { cost: true }),
  col("returnPerRupee", "₹ won per ₹ spent", "won", "ratio", true, (l) => ratio(l.CohortWonValue, l.ListCost, 1), null,
    "Won value divided by cost.", { cost: true }),
  col("sheetBadPct", "Duplicate or bad in sheet %", "idle", "pct", false, (l) => ratio(sum(l, "SkippedDup", "SkippedBad"), l.SheetRows), null,
    "Sheet rows skipped as already known or a bad number."),
].map((c) => [c.key, c]));

// The colour-key line above every summary, in this order.
export const KEY_LEGEND = [
  { k: "new", label: "New" }, { k: "call", label: "Calls" }, { k: "visit", label: "Visits & meetings" },
  { k: "won", label: "Won" }, { k: "lost", label: "Lost" }, { k: "late", label: "Missed · overdue" },
  { k: "idle", label: "Not touched · no next follow-up" }, { k: "stock", label: "Open · due · value" },
];
