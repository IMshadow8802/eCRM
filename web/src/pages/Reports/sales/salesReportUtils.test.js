import { describe, it, expect } from "vitest";
import dayjs from "dayjs";

import { COLUMNS } from "./columns";
import { REPORTS } from "./reports";
import {
  readFilters, writeFilters, toBody, drillUrl, leadsOfUrl, readDrill, drillBody, whyParts, drillTitle,
  previousLabel, diffOf, exportName, summaryCsv, rowsCsv, slug,
} from "./salesReportUtils";

const F = { preset: "custom", from: "2026-09-01", to: "2026-09-30", at: null, BranchId: 2, SourceId: null, ProductId: null };
const team = REPORTS.team;
const TODAY = dayjs("2026-11-18");

describe("drillUrl", () => {
  it("a team line drills with rollup, a person line without, unassigned with its own flag", () => {
    expect(drillUrl(team, F, { GroupKey: 9, LineKind: "team", FuMissed: 5 }, COLUMNS.missed))
      .toBe("/reports/sales/team/rows?metric=fu_missed&shape=events&person=9&rollup=1&preset=custom&from=2026-09-01&to=2026-09-30&BranchId=2");
    expect(drillUrl(team, F, { GroupKey: 9, LineKind: "own", Calls: 4 }, COLUMNS.calls)).toContain("person=9&preset");
    expect(drillUrl(team, F, { GroupKey: null, LineKind: "unassigned", New: 6 }, COLUMNS.new)).toContain("unassigned=1");
  });
  it("zero and a column with no drill give no link", () => {
    expect(drillUrl(team, F, { GroupKey: 9, LineKind: "person", Lost: 0 }, COLUMNS.lost)).toBeNull();
    expect(drillUrl(team, F, { GroupKey: 9, LineKind: "person" }, COLUMNS.lost)).toBeNull();
    expect(drillUrl(REPORTS.sources, F, { GroupKey: 4, LineKind: "group", New: 10, CohortWon: 2 }, COLUMNS.conversion)).toBeNull();
  });
  it("a group line carries its key, a null key says so, and the cohort state rides along", () => {
    expect(drillUrl(REPORTS.sources, F, { GroupKey: 4, LineKind: "group", CohortWon: 2 }, COLUMNS.cohortWon)).toContain("metric=new&shape=events&key=4&state=won");
    expect(drillUrl(REPORTS.lost, F, { GroupKey: null, LineKind: "group", Lost: 3 }, COLUMNS.lostN)).toContain("keynull=1");
  });
  it("age and flag columns ride along", () => {
    const f = { ...F, preset: "any", from: null, to: null };
    expect(drillUrl(REPORTS.open, f, { GroupKey: 3, LineKind: "person", Age8_30: 2 }, COLUMNS.age8))
      .toBe("/reports/sales/open/rows?metric=open&shape=events&person=3&age=8_30&BranchId=2");
    expect(drillUrl(team, F, { GroupKey: 3, LineKind: "person", OverdueNow: 1 }, COLUMNS.overdueNow)).toContain("metric=open&shape=events&person=3&flag=overdue");
  });
  it("the total row drills the node when one is open, everything at the start", () => {
    expect(drillUrl(team, { ...F, at: 9 }, { LineKind: "total", New: 5 }, COLUMNS.new)).toContain("person=9&rollup=1");
    expect(drillUrl(team, { ...F, at: 9 }, { LineKind: "total", New: 5 }, COLUMNS.new)).not.toContain("at=");
    expect(drillUrl(team, F, { LineKind: "total", New: 5 }, COLUMNS.new)).not.toContain("person=");
    expect(drillUrl(REPORTS.sources, F, { LineKind: "total", New: 5 }, COLUMNS.new)).toBe(
      "/reports/sales/sources/rows?metric=new&shape=events&preset=custom&from=2026-09-01&to=2026-09-30&BranchId=2");
  });
  it("leadsOfUrl is the per-lead view of one person", () => {
    expect(leadsOfUrl(team, F, { GroupKey: 17, LineKind: "own" }))
      .toBe("/reports/sales/team/rows?shape=leads&metric=all&person=17&preset=custom&from=2026-09-01&to=2026-09-30&BranchId=2");
  });
});

describe("filters", () => {
  it("reads the report's default, ids and the open node", () => {
    expect(readFilters(new URLSearchParams("at=9&BranchId=2&SourceId=x"), team, TODAY)).toEqual({
      preset: "yesterday", from: "2026-11-17", to: "2026-11-17", error: null, at: 9, BranchId: 2, SourceId: null, ProductId: null,
    });
    expect(readFilters(new URLSearchParams(""), REPORTS.open, TODAY)).toMatchObject({ preset: "any", from: null, to: null });
    expect(readFilters(new URLSearchParams("preset=any"), team, TODAY).preset).toBe("yesterday");
    expect(readFilters(new URLSearchParams("preset=custom&from=2026-09-30&to=2026-09-01"), team, TODAY).error).toBe("To is before From");
  });
  it("writes only what is not the default", () => {
    expect(writeFilters({ preset: "yesterday", from: "x", to: "x", at: null, BranchId: null }, team)).toEqual({});
    expect(writeFilters({ ...F, at: 9 }, team)).toEqual({ preset: "custom", from: "2026-09-01", to: "2026-09-30", at: "9", BranchId: "2" });
    expect(writeFilters({ preset: "month", at: null, SourceId: 4 }, REPORTS.open)).toEqual({ preset: "month", SourceId: "4" });
  });
  it("toBody carries the dates, the node and the ids, and no dates for Any time", () => {
    expect(toBody({ ...F, at: 9 }, team)).toEqual({
      GroupBy: "team", FromDate: "2026-09-01", ToDate: "2026-09-30", NodeId: 9, BranchId: 2, SourceId: null, ProductId: null,
    });
    expect(toBody({ preset: "any", from: null, to: null, at: null, BranchId: null, SourceId: null, ProductId: null }, REPORTS.open))
      .toEqual({ GroupBy: "person", NodeId: null, BranchId: null, SourceId: null, ProductId: null });
  });
});

describe("drill round trip", () => {
  it("round-trips a drill through the URL into the POST body", () => {
    const url = drillUrl(REPORTS.open, { ...F, preset: "any", from: null, to: null }, { GroupKey: 17, LineKind: "person", Stale: 3 }, COLUMNS.stale);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(drillBody(REPORTS.open, readFilters(params, REPORTS.open), readDrill(params))).toEqual({
      GroupBy: "person", Metric: "open", Shape: "events", PersonId: 17, Rollup: false, Unassigned: false,
      GroupKey: null, GroupKeyIsNull: false, State: null, AgeBucket: null, Flag: "stale",
      BranchId: 2, SourceId: null, ProductId: null });
  });
  it("a dated drill carries its dates, roll-up and key", () => {
    const url = drillUrl(REPORTS.sources, F, { GroupKey: 4, LineKind: "group", CohortWon: 2 }, COLUMNS.cohortWon);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(drillBody(REPORTS.sources, readFilters(params, REPORTS.sources, TODAY), readDrill(params))).toMatchObject({
      GroupBy: "source", FromDate: "2026-09-01", ToDate: "2026-09-30", Metric: "new", GroupKey: 4, State: "won" });
    expect(readDrill(new URLSearchParams("metric=call&person=9&rollup=1&unassigned=1&keynull=1")))
      .toMatchObject({ Rollup: true, Unassigned: true, GroupKeyIsNull: true });
  });
  it("readDrill drops anything outside the closed lists", () => {
    expect(readDrill(new URLSearchParams("metric=;drop&shape=grid&person=abc&state=x&age=y&flag=z")))
      .toMatchObject({ Metric: null, Shape: "events", PersonId: null, State: null, AgeBucket: null, Flag: null });
    expect(readDrill(new URLSearchParams("shape=leads&metric=all")).Shape).toBe("leads");
  });
});

describe("words", () => {
  it("why-sentence", () => {
    expect(whyParts({ NNew: 1, NCalls: 2, NMissed: 1 }).map((p) => p.text)).toEqual(["New", "2 calls", "1 follow-up missed"]);
    expect(whyParts({ NNew: 1, NWon: 1 })).toEqual([{ text: "New", k: "new" }, { text: "won", k: "won" }]);
    expect(whyParts({ NVisits: 1, NOther: 3, NLost: 1 }).map((p) => p.text)).toEqual(["1 visit or meeting", "3 other follow-ups", "lost"]);
    expect(whyParts({ NVisits: 2, NOther: 1, NMissed: 2, NCalls: 1 }).map((p) => p.text))
      .toEqual(["1 call", "2 visits or meetings", "1 other follow-up", "2 follow-ups missed"]);
    expect(whyParts({ NDue: 2 }).map((p) => p.text)).toEqual(["2 follow-ups due"]);
    expect(whyParts({ NDue: 1 }).map((p) => p.text)).toEqual(["1 follow-up due"]);
    expect(whyParts({ NCalls: 1, NDue: 1 }).map((p) => p.text)).toEqual(["1 call"]);
    expect(whyParts({})).toEqual([]);
  });
  it.each([
    [{ Metric: "fu_missed" }, 93, "93 follow-ups missed"], [{ Metric: "fu_missed" }, 1, "1 follow-up missed"],
    [{ Metric: "call" }, 31, "31 calls"], [{ Metric: "visits" }, 5, "5 visits & meetings"],
    [{ Metric: "new" }, 21, "21 new leads"], [{ Metric: "new", State: "untouched" }, 4, "4 leads not contacted yet"],
    [{ Metric: "open", Flag: "overdue" }, 12, "12 open leads overdue"], [{ Metric: "open" }, 148, "148 open leads"],
    [{ Metric: "won" }, 15, "15 deals won"], [{ Metric: "lost" }, 3, "3 leads lost"], [{ Metric: "fu_due" }, 74, "74 follow-ups due"],
    [{ Metric: "won" }, 6412, "6,412 deals won"], [{ Metric: "new", State: "won" }, 2, "2 new leads won by now"],
    [{ Metric: "open", AgeBucket: "90p" }, 7, "7 open leads 90+ days old"], [{ Metric: "open", Flag: "stale" }, 1, "1 open lead not touched 7+ days"],
    [{ Metric: "fu_ontime" }, 2, "2 follow-ups done on time"], [{ Metric: "other" }, 1, "1 other follow-up done"],
    [{ Metric: "all" }, 95, "95 leads"], [{ Metric: null }, 0, "0 rows"],
  ])("drillTitle %j %i", (d, n, t) => expect(drillTitle(d, n)).toBe(t));
  it("previous-period label and difference", () => {
    expect(previousLabel({ from: "2026-08-01", to: "2026-08-31" })).toBe("Previous period · Aug 2026");
    expect(previousLabel({ from: "2026-11-16", to: "2026-11-16" })).toBe("Previous period · 16 Nov 2026");
    expect(previousLabel({ from: "2026-11-09", to: "2026-11-15" })).toBe("Previous period · 9 – 15 Nov 2026");
    expect(previousLabel({ from: "2026-07-01", to: "2026-08-31" })).toBe("Previous period · 1 Jul – 31 Aug 2026");
    expect(diffOf(221, 142, true)).toEqual({ text: "+79", tone: "better" });
    expect(diffOf(349, 37, false)).toEqual({ text: "+312", tone: "worse" });
    expect(diffOf(686, 457, null)).toEqual({ text: "+229", tone: "flat" });
    expect(diffOf(5, 5, true)).toEqual({ text: "", tone: "flat" });
    expect(diffOf(30, 42, true)).toEqual({ text: "−12", tone: "worse" });
    expect(diffOf(2430100, 17000, true)).toEqual({ text: "+24,13,100", tone: "better" });
    expect(diffOf(null, 4, true)).toEqual({ text: "", tone: "flat" });
  });
  it("slug", () => {
    expect(slug("  Neha  Kulkarni! ")).toBe("neha-kulkarni");
    expect(slug(null)).toBe("");
  });
});

describe("export", () => {
  it("export name carries the context", () => {
    expect(exportName(team, { from: "2026-11-17", to: "2026-11-17" }, "Neha Kulkarni")).toBe("team-report_neha-kulkarni_2026-11-17.csv");
    expect(exportName(REPORTS.sources, { from: "2026-11-01", to: "2026-11-30" })).toBe("lead-sources_2026-11-01_2026-11-30.csv");
    expect(exportName(REPORTS.open, { from: null, to: null })).toBe("open-leads_any-time.csv");
    // A bracketed role in the name stays out of the file name (e2e 2026-11-18).
    expect(exportName(team, F, "Amit Singh (Exec HO, under Neha)")).toBe("team-report_amit-singh_2026-09-01_2026-09-30.csv");
  });
  it("the summary export is BOM-first, every catalogue column, Total and Previous last, formula-safe", () => {
    const lines = [{ GroupKey: 1, GroupLabel: "=HYPERLINK(\"x\")", LineKind: "person", New: 2, WonValue: 1000 },
                   { GroupKey: 2, GroupLabel: "नेहा ₹", LineKind: "person", New: 3, WonValue: 0 }];
    const csv = summaryCsv(team, lines, { New: 5, WonValue: 1000 }, { totals: { New: 4 }, range: { from: "2026-08-01", to: "2026-08-31" } });
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    const rows = csv.slice(1).split("\n");
    expect(rows[0]).toBe("Person,New leads,Calls,Visits & meetings,Follow-ups due,Missed,Won,Won ₹,Lost,Open leads,Overdue,Other follow-ups done,Done on time,Done late,Skipped");
    expect(rows[1].startsWith("\"'=HYPERLINK")).toBe(true);
    expect(rows[2].startsWith("नेहा ₹,3")).toBe(true);
    expect(rows.at(-2).startsWith("Total,5")).toBe(true);
    expect(rows.at(-1).startsWith("Previous period · Aug 2026,4")).toBe(true);
  });
  it("money is a plain number, pct and days one decimal, now columns blank on the previous line, own lines say so", () => {
    const lost = summaryCsv(REPORTS.lost, [{ GroupKey: 1, GroupLabel: "Price", LineKind: "group", Lost: 1, LostValue: 125000.5, DaysOpenSum: 10, DaysOpenN: 3 }],
      { Lost: 4, LostValue: 125000.5, DaysOpenSum: 10, DaysOpenN: 3 }, null);
    const rows = lost.slice(1).split("\n");
    expect(rows[0]).toBe("Reason,Lost,Share %,Value lost ₹,Avg days open");
    expect(rows[1]).toBe("Price,1,25.0,125000.5,3.3");
    expect(rows).toHaveLength(3);
    const t = summaryCsv(team, [{ GroupKey: 1, GroupLabel: "Rajesh", LineKind: "own", OpenNow: 3 }], { OpenNow: 3 },
      { totals: { OpenNow: 9 }, range: { from: "2026-11-16", to: "2026-11-16" } }).slice(1).split("\n");
    expect(t[1].startsWith("Rajesh — own leads,")).toBe(true);
    expect(t[3].split(",")[9]).toBe("");
  });
  it("rowsCsv is BOM-first with the footer last", () => {
    const cols = [{ key: "LeadName", header: "Lead" }, { key: "Amount", header: "Won ₹" }];
    expect(rowsCsv(cols, [{ LeadName: "A", Amount: 5 }], { LeadName: "Total", Amount: 5 })).toBe("﻿Lead,Won ₹\nA,5\nTotal,5");
    expect(rowsCsv(cols, [])).toBe("﻿Lead,Won ₹");
  });
});
