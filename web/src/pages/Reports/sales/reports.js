// src/pages/Reports/sales/reports.js
//
// The five sales reports, in menu order. `groupBy` is what sp_RptSales groups
// on; `dateMeans` is the wording inside the date field; `columns` are shown,
// `exportOnly` are added to the CSV. Won deals is a list, not a summary: it is
// drilled with no person and no key, so it has no columns here.

export const REPORTS = {
  team: {
    slug: "team", title: "Team report", subtitle: "your people, added up per team", path: "/reports/sales/team",
    groupBy: "team", dateMeans: "Work done in", defaultPreset: "yesterday", allowAny: false, previous: true,
    firstHeader: "Person",
    columns: ["new", "calls", "visits", "due", "missed", "won", "wonValue", "lost", "openNow", "overdueNow"],
    exportOnly: ["other", "onTime", "late", "skipped"],
    fileKey: "team-report", guide: "salesTeam",
  },
  sources: {
    slug: "sources", title: "Lead sources", subtitle: "where leads came from, and what became of them", path: "/reports/sales/sources",
    groupBy: "source", dateMeans: "Leads created in", defaultPreset: "month", allowAny: false, previous: true,
    firstHeader: "Source",
    columns: ["new", "cohortOpen", "cohortWon", "cohortWonValue", "cohortLost", "cohortJunk", "conversion", "untouched"],
    exportOnly: [],
    fileKey: "lead-sources", guide: "salesSources",
  },
  open: {
    slug: "open", title: "Open leads", subtitle: "What is open right now, per person", path: "/reports/sales/open",
    groupBy: "person", dateMeans: "Leads created in", defaultPreset: "any", allowAny: true, previous: false,
    firstHeader: "Person",
    columns: ["open", "age0", "age8", "age31", "age90", "openValue", "overdue", "noNext", "stale"],
    exportOnly: [],
    fileKey: "open-leads", guide: "salesOpen",
  },
  lost: {
    slug: "lost", title: "Lost leads", subtitle: "why leads were lost", path: "/reports/sales/lost",
    groupBy: "reason", dateMeans: "Lost in", defaultPreset: "month", allowAny: false, previous: true,
    firstHeader: "Reason",
    columns: ["lostN", "share", "lostValue", "avgDays"],
    exportOnly: [],
    fileKey: "lost-leads", guide: "salesLost",
  },
  won: {
    slug: "won", title: "Won deals", subtitle: "Every lead won in these days", path: "/reports/sales/won",
    groupBy: "source", dateMeans: "Won in", defaultPreset: "month", allowAny: false, previous: true,
    firstHeader: null, columns: null, exportOnly: null,
    fileKey: "won-deals", guide: "salesWon",
  },
};
