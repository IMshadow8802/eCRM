import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import renderWithProviders from "../../../test/renderWithProviders";
import { mockReportEndpoints } from "../../../test/reportMocks";
import { reportKey } from "../../../styles/tokens";
import { statusChipColors } from "../../Sales/leadStatus";
import SalesRows from "./SalesRows";
import { REPORTS } from "./reports";
import { exportName, readFilters } from "./salesReportUtils";

const ev = (o) => ({ EventAt: "2026-09-30T14:00:00", Metric: "fu_missed", Src: "F", RefId: 1, LeadId: 505, LeadName: "DEMO Vihaan Nair",
  CreatedAt: "2026-09-10T09:00:00", MobileNo: "9000000505", Company: null, PersonId: 17, PersonName: "Amit Singh", OwnerName: "Amit Singh",
  StatusName: "Qualified", StatusCode: "qualified", Amount: null, Detail1: "visit", Detail2: null, CanOpen: true, ...o });
const data = (over = {}) => ({ rows: [], total: 0, amountTotal: 0, sums: {}, truncated: false, path: [], previous: null, range: { from: "2026-09-01", to: "2026-09-30" }, ...over });
const SEP = "preset=custom&from=2026-09-01&to=2026-09-30";

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
// jsdom's Blob implements no .text(), so read it the long way.
const readBlob = (blob) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsText(blob);
  });

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
const where = () => screen.getByTestId("where").textContent;

const renderRows = (report, route) => renderWithProviders(<><SalesRows report={report} /><Where /></>, { route });
const headers = () =>
  within(screen.getByTestId("sales-rows-table")).getAllByRole("columnheader")
    .map((h) => h.querySelector(".Mui-TableHeadCell-Content-Wrapper").textContent);
const bodyRows = () => screen.getByTestId("sales-rows-table").querySelectorAll("tbody tr");

describe("SalesRows", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 18, 9, 40));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("follow-ups missed: body, title, columns with Created second, missed ink", async () => {
    const cap = mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev()], total: 93, path: [{ Id: 3, Name: "Priya Sharma" }, { Id: 17, Name: "Amit Singh" }] }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&shape=events&person=17&${SEP}`);
    expect(await screen.findByRole("heading", { level: 1, name: "93 follow-ups missed" })).toBeInTheDocument();
    expect(cap.body).toMatchObject({ GroupBy: "team", Metric: "fu_missed", Shape: "events", PersonId: 17, Rollup: false, FromDate: "2026-09-01", ToDate: "2026-09-30" });
    expect(cap.body).not.toHaveProperty("WithPrevious");
    expect(headers()).toEqual(["Lead", "Created", "Was due", "Follow-up", "Mobile", "Status now", "Due with", ""]);
    const row = bodyRows()[0];
    expect(row).toHaveTextContent("10-09-2026");
    expect(row).toHaveTextContent("Visit");
    expect(row).toHaveTextContent("9000000505");
    expect(within(row).getByText("30-09-2026 14:00").style.color).toBe(rgb(reportKey.late.text));
  });

  it("breadcrumb walks the chain, each crumb a link carrying the dates", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev()], total: 93, path: [{ Id: 3, Name: "Priya Sharma" }, { Id: 17, Name: "Amit Singh" }] }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&shape=events&person=17&${SEP}`);
    await screen.findByRole("heading", { level: 1, name: "93 follow-ups missed" });
    const nav = screen.getByRole("link", { name: "Team report" });
    expect(nav.getAttribute("href")).toBe(`/reports/sales/team?${SEP}`);
    expect(screen.getByRole("link", { name: "Priya Sharma" }).getAttribute("href")).toBe(`/reports/sales/team?${SEP}&at=3`);
    expect(screen.getByRole("link", { name: "Amit Singh" }).getAttribute("href")).toBe(`/reports/sales/team/rows?shape=leads&metric=all&person=17&${SEP}`);
  });

  it("a rolled-up person's crumb opens their team", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev()], total: 1, path: [{ Id: 3, Name: "Priya Sharma" }] }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&person=3&rollup=1&${SEP}`);
    await screen.findByRole("heading", { level: 1, name: "1 follow-up missed" });
    expect(screen.getByRole("link", { name: "Priya Sharma" }).getAttribute("href")).toBe(`/reports/sales/team?${SEP}&at=3`);
  });

  it("the lead opens its page from the name, the icon and the row", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev()], total: 1 }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&person=17&${SEP}`);
    const link = await screen.findByRole("link", { name: "DEMO Vihaan Nair" });
    expect(link.getAttribute("href")).toBe("/sales/leads/505");
    const [mine] = bodyRows();
    expect(within(mine).getByRole("link", { name: "Open lead" }).getAttribute("href")).toBe("/sales/leads/505");
    await userEvent.click(mine);
    expect(where()).toBe("/sales/leads/505");
  });

  // F2: a row for a lead out of view used to be drawn with its name and "now with <owner>".
  it("F2 regression: no row is rendered for a lead out of view", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({
      rows: [ev(), ev({ RefId: 2, LeadId: 506, LeadName: "DEMO Far Away", CanOpen: false, MobileNo: null, OwnerName: "Sara Khan" })], total: 2,
    }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&person=17&${SEP}`);
    await screen.findByRole("link", { name: "DEMO Vihaan Nair" });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.queryByText(/DEMO Far Away/)).toBeNull();
    expect(screen.queryByText(/now with/)).toBeNull();
  });

  it("hidden line shows with the count and correct singular", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev()], total: 13, hiddenCount: 12 }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&person=17&${SEP}`);
    // the title is the summary cell: listed rows + hidden ones
    expect(await screen.findByRole("heading", { level: 1, name: "13 follow-ups missed" })).toBeInTheDocument();
    expect(screen.getByTestId("sales-rows-hidden")).toHaveTextContent("12 activities on leads no longer in your view");
  });

  it("hidden line in the singular, also when nothing is listed", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [], total: 1, hiddenCount: 1 }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&person=17&${SEP}`);
    expect(await screen.findByTestId("sales-rows-hidden")).toHaveTextContent("1 activity on a lead no longer in your view");
    expect(screen.getByText("Nothing in this period")).toBeInTheDocument();
  });

  it.each([
    [3, "3 leads no longer in your view"],
    [1, "1 lead no longer in your view"],
  ])("a person's leads: hidden line counts leads (%i)", async (n, line) => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev({ NNew: 1 })], total: 1 + n, hiddenCount: n, path: [{ Id: 17, Name: "Amit Singh" }] }));
    renderRows("team", `/reports/sales/team/rows?shape=leads&metric=all&person=17&${SEP}`);
    expect(await screen.findByTestId("sales-rows-hidden")).toHaveTextContent(line);
    expect(screen.getByTestId("sales-rows-hidden")).not.toHaveTextContent("activit");
  });

  it("no hidden line at 0", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev()], total: 1, hiddenCount: 0 }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&person=17&${SEP}`);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    expect(screen.queryByTestId("sales-rows-hidden")).toBeNull();
  });

  it("states the true listable total when capped at 2,000", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ev({ RefId: i + 1 }));
    mockReportEndpoints("/api/reports/salesRows", data({ rows, total: 6412, hiddenCount: 12, truncated: true }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&person=17&${SEP}`);
    expect(await screen.findByText("Showing the first 2,000 of 6,400 — narrow the dates")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "6,412 follow-ups missed" })).toBeInTheDocument();
  });

  it("a person's leads: one line each, why it is here, footer from the sums", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({
      rows: [ev({ Metric: undefined, Src: undefined, RefId: undefined, EventAt: undefined, EstValue: 1000, NNew: 1, NMissed: 1, StatusCode: "converted", StatusName: "Won", LastActivityAt: "2026-09-19T18:46:00", IsStale: 1 })],
      total: 95,
      sums: { NNew: 74, NCalls: 47, NVisits: 11, NDue: 164, NMissed: 93, NWon: 6, WonValue: 17000, NLost: 11 },
      path: [{ Id: 3, Name: "Priya Sharma" }, { Id: 17, Name: "Amit Singh" }],
    }));
    renderRows("team", `/reports/sales/team/rows?shape=leads&metric=all&person=17&${SEP}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Amit Singh" })).toBeInTheDocument();
    expect(screen.getByText("their leads for these days, one line each")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Amit Singh" })).toBeNull();
    expect(screen.getByRole("link", { name: "Priya Sharma" })).toBeInTheDocument();
    expect(headers()).toEqual(["Lead", "Created", "Mobile", "Status", "Value ₹", "Last activity", "Why it is here", ""]);
    const row = bodyRows()[0];
    expect(row).toHaveTextContent("New · 1 follow-up missed");
    expect(within(row).getByText("New").style.color).toBe(rgb(reportKey.new.text));
    expect(within(row).getByText("1 follow-up missed").style.color).toBe(rgb(reportKey.late.text));
    expect(within(row).getByText("19-09-2026").style.color).toBe(rgb(reportKey.idle.text));
    expect(row).toHaveTextContent("₹1,000");
    const tfoot = screen.getByTestId("sales-rows-table").querySelector("tfoot");
    expect(tfoot).toHaveTextContent("95 leads");
    expect(tfoot).toHaveTextContent("74 new · 47 calls · 11 visits & meetings · 164 follow-ups due · 93 missed · 6 won (₹17,000) · 11 lost");
  });

  it("a person's leads with nothing: empty state with Try This month", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ path: [{ Id: 17, Name: "Amit Singh" }] }));
    renderRows("team", `/reports/sales/team/rows?shape=leads&metric=all&person=17&${SEP}`);
    expect(await screen.findByText("No work recorded in this period")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try This month" }));
    expect(where()).toContain("preset=month");
    expect(where()).toContain("shape=leads");
    expect(where()).toContain("person=17");
  });

  it("an empty events drill says so", async () => {
    mockReportEndpoints("/api/reports/salesRows", data());
    renderRows("lost", "/reports/sales/lost/rows?metric=lost&preset=month");
    expect(await screen.findByText("Nothing in this period")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try This month" })).toBeNull();
  });

  it.each([
    ["no metric", "/reports/sales/team/rows?person=17"],
    ["an unknown metric", "/reports/sales/team/rows?metric=bogus&person=17"],
  ])("%s: the link is not complete and the endpoint is not called", async (_, route) => {
    const cap = mockReportEndpoints("/api/reports/salesRows", data());
    renderRows("team", route);
    expect(await screen.findByText("This link is not complete")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Team report" }).getAttribute("href")).toBe("/reports/sales/team");
    await new Promise((r) => setTimeout(r, 30));
    expect(cap.body).toBeUndefined();
  });

  it("a bad custom range shows the error and asks nothing", async () => {
    const cap = mockReportEndpoints("/api/reports/salesRows", data());
    renderRows("team", "/reports/sales/team/rows?metric=call&preset=custom&from=2026-09-30&to=2026-09-01");
    expect(await screen.findByRole("alert")).toHaveTextContent("To is before From");
    expect(cap.body).toBeUndefined();
  });

  it("a failed load says so", async () => {
    const { server } = await import("../../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    mockReportEndpoints("/api/reports/salesRows", data());
    server.use(http.post("*/api/reports/salesRows", () => HttpResponse.json({ success: false }, { status: 500 })));
    renderRows("team", `/reports/sales/team/rows?metric=call&${SEP}`);
    expect(await screen.findByText("Failed to load these rows.")).toBeInTheDocument();
  });

  it.each([
    ["call", ["Lead", "Created", "Done on", "What", "Notes", "Mobile", "Status now", "Done by", ""]],
    ["new", ["Lead", "Created", "Mobile", "Company", "Status now", "Value ₹", "Assigned to", ""]],
    ["lost", ["Lead", "Created", "Lost on", "Reason", "Remarks", "Value ₹", "Assigned to", ""]],
    ["open", ["Lead", "Created", "Age", "Status now", "Value ₹", "Last activity", "Next follow-up", "Assigned to", ""]],
  ])("metric=%s has its own columns", async (metric, cols) => {
    mockReportEndpoints("/api/reports/salesRows", data({
      rows: [ev({ Metric: metric, Detail1: "call", Detail2: "rang twice", Amount: 5000, LostReason: "Price", Remarks: "too high", Company: "Acme",
        AgeDays: 12, IsOverdue: 1, NextFollowupDate: "2026-11-10T00:00:00", LastActivityAt: "2026-11-01T10:00:00", OwnerName: null })],
      total: 1,
    }));
    renderRows("team", `/reports/sales/team/rows?metric=${metric}&${SEP}`);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    expect(headers()).toEqual(cols);
    const row = bodyRows()[0];
    if (metric === "call") {
      expect(row).toHaveTextContent("Call");
      expect(row).toHaveTextContent("rang twice");
      expect(row).toHaveTextContent("30-09-2026 14:00");
    }
    if (metric === "new") expect(row).toHaveTextContent("Acme");
    if (metric === "lost") {
      expect(row).toHaveTextContent("Price");
      expect(row).toHaveTextContent("too high");
      expect(row).toHaveTextContent("Unassigned");
    }
    if (metric === "open") {
      expect(row).toHaveTextContent("12 days");
      expect(within(row).getByText("10-11-2026").style.color).toBe(rgb(reportKey.late.text));
    }
  });

  it("other reports: one crumb back to the report", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev({ Metric: "new" })], total: 1 }));
    renderRows("sources", "/reports/sales/sources/rows?metric=new&state=untouched&key=11");
    expect(await screen.findByRole("heading", { level: 1, name: "1 lead not contacted yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lead sources" }).getAttribute("href")).toBe("/reports/sales/sources");
  });

  it("Won deals: every won lead, columns, footer, previous period, pickers", async () => {
    const cap = mockReportEndpoints("/api/reports/salesRows", data({
      rows: [
        ev({ Metric: "won", Src: "L", EventAt: "2026-11-10T12:00:00", CreatedAt: "2026-11-10T09:00:00", Company: "Gupta Traders", OwnerName: "Rohit Gupta", SourceName: "Walk-in", Amount: 55100, QuoteNo: "QT-2627-0032" }),
        ev({ Metric: "won", Src: "L", RefId: 2, LeadId: 600, LeadName: "TEST Lead Bina", EventAt: "2026-11-12T12:00:00", CreatedAt: "2026-11-02T09:00:00", OwnerName: null, SourceName: null, Amount: 80000, QuoteNo: null }),
      ],
      total: 15, amountTotal: 2430100,
      previous: { total: 6, amountTotal: 17000, range: { from: "2026-10-01", to: "2026-10-31" } },
      range: { from: "2026-11-01", to: "2026-11-30" },
    }));
    renderRows("won", "/reports/sales/won");
    expect(await screen.findByRole("heading", { level: 1, name: "Won deals" })).toBeInTheDocument();
    await waitFor(() => expect(cap.body).toMatchObject({ GroupBy: "source", Metric: "won", Shape: "events", WithPrevious: true, PersonId: null, GroupKey: null, FromDate: "2026-11-01", ToDate: "2026-11-30" }));
    await waitFor(() => expect(bodyRows().length).toBe(2));
    expect(headers()).toEqual(["Lead", "Created", "Won on", "Company", "Person", "Source", "Won ₹", "Quotation no.", "Days to win", ""]);
    const [a, b] = bodyRows();
    expect(a).toHaveTextContent("same day");
    expect(a).toHaveTextContent("QT-2627-0032");
    expect(a).toHaveTextContent("Rohit Gupta");
    expect(b).toHaveTextContent("10 days");
    expect(b).toHaveTextContent("Unassigned");
    const tfoot = screen.getByTestId("sales-rows-table").querySelector("tfoot");
    expect(tfoot).toHaveTextContent("Total · 15 deals");
    expect(tfoot).toHaveTextContent("₹24,30,100");
    expect(tfoot).toHaveTextContent("Previous period · Oct 2026 · 6 deals ▲ +9");
    expect(tfoot).toHaveTextContent("▲ +₹24,13,100");
    expect(screen.getByTestId("date-range-button")).toHaveTextContent("Won in");
    for (const t of ["filter-branch", "filter-source", "filter-product"]) expect(screen.getByTestId(t)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).toBeNull();
  });

  it("a worse previous period shows ▼", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({
      rows: [ev({ Metric: "won", Amount: 100 })], total: 1, amountTotal: 100,
      previous: { total: 6, amountTotal: 17000, range: { from: "2026-10-01", to: "2026-10-31" } },
    }));
    renderRows("won", "/reports/sales/won");
    await waitFor(() => expect(bodyRows().length).toBe(1));
    const tfoot = screen.getByTestId("sales-rows-table").querySelector("tfoot");
    expect(tfoot).toHaveTextContent("6 deals ▼ −5");
    expect(within(tfoot).getByText("▼ −5").style.color).toBe(rgb(reportKey.worse));
  });

  it("Export: the file name and the text are the page's rows", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({
      rows: [ev({ Detail2: "said call back" })], total: 1, path: [{ Id: 17, Name: "Amit Singh" }],
    }));
    let blob;
    URL.createObjectURL = vi.fn((b) => { blob = b; return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    let downloaded;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() { downloaded = this.download; });
    const route = `/reports/sales/team/rows?metric=fu_missed&person=17&${SEP}`;
    renderRows("team", route);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    const filters = readFilters(new URLSearchParams(route.split("?")[1]), REPORTS.team);
    expect(downloaded).toBe(exportName(REPORTS.team, filters, "Amit Singh"));
    // FileReader drops the BOM, so the text is rowsCsv's after it
    const text = await readBlob(blob);
    expect(text.split("\n")[0]).toBe("Lead,Created,Was due,Follow-up,Mobile,Status now,Due with");
    expect(text.split("\n")[1]).toBe("DEMO Vihaan Nair,2026-09-10,2026-09-30 14:00,Visit,9000000505,Qualified,Amit Singh");
  });

  it("Export of a person's leads ends with the footer line", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({
      rows: [ev({ NNew: 1, EstValue: 1000 })], total: 1, sums: { NNew: 1 }, path: [{ Id: 17, Name: "Amit Singh" }],
    }));
    let blob;
    URL.createObjectURL = vi.fn((b) => { blob = b; return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderRows("team", `/reports/sales/team/rows?shape=leads&metric=all&person=17&${SEP}`);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    const lines = (await readBlob(blob)).split("\n");
    expect(lines[1]).toBe("DEMO Vihaan Nair,2026-09-10,9000000505,Qualified,1000,,New");
    expect(lines[2]).toBe("1 lead,,,,,,1 new");
  });

  it("status chips: converted takes the won pair, lost the lost pair", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({
      rows: [ev({ StatusCode: "converted", StatusName: "Won" }), ev({ RefId: 2, StatusCode: "lost", StatusName: "Lost" })], total: 2,
    }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&${SEP}`);
    await waitFor(() => expect(bodyRows().length).toBe(2));
    // the label sits in an inner span; the chip is its parent
    const chip = (name) => within(screen.getByTestId("sales-rows-table")).getByText(name).parentElement;
    expect(chip("Won").style.backgroundColor).toBe(rgb(statusChipColors("converted").bg));
    expect(chip("Won").style.color).toBe(rgb(statusChipColors("converted").text));
    expect(chip("Lost").style.backgroundColor).toBe(rgb(statusChipColors("lost").bg));
  });

  it("changing a filter keeps the drill and replaces the dates", async () => {
    mockReportEndpoints("/api/reports/salesRows", data({ rows: [ev()], total: 1 }));
    renderRows("team", `/reports/sales/team/rows?metric=fu_missed&person=17&${SEP}`);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    await userEvent.click(screen.getByTestId("filter-branch-input"));
    await userEvent.click(await screen.findByRole("option", { name: "HEAD OFFICE" }));
    expect(where()).toContain("metric=fu_missed");
    expect(where()).toContain("person=17");
    expect(where()).toContain("BranchId=1");
    expect(where()).toContain("from=2026-09-01");
  });

  describe("calling rows (149)", () => {
    const k = (o) => ev({ Metric: "dial", Src: "K", RefId: 70, LeadId: null, LeadName: "Mrs. HARJEET KAUR", MobileNo: "9810823710", PersonName: "Rohit Sharma",
      Detail1: "not_interested", Detail2: null, CallListId: 5, CallListName: "MLSS Delhi", CanOpen: 1, EventAt: "2026-11-17T11:05:00", ...o });

    it("posts the calling drill and shows When · Contact · Mobile · Caller · Result · List, linking to the list's contacts", async () => {
      const cap = mockReportEndpoints("/api/reports/salesRows", data({
        rows: [k(), k({ RefId: 71, LeadName: null, MobileNo: null, CanOpen: 0, Detail1: "callback" })], total: 2,
      }));
      renderRows("calling", "/reports/sales/calling/rows?metric=dial&shape=events&key=5&line=calllist&preset=any");
      await waitFor(() => expect(bodyRows().length).toBe(2));
      expect(cap.body).toMatchObject({ GroupBy: "calllist", Metric: "dial", GroupKey: 5 });
      expect(headers()).toEqual(["When", "Contact", "Mobile", "Caller", "Result", "List", ""]);
      const [open, closed] = bodyRows();
      expect(within(open).getByRole("link", { name: "Mrs. HARJEET KAUR" })).toHaveAttribute("href", "/sales/calling-lists/5?tab=contacts");
      expect(within(open).getByText("Not interested")).toBeInTheDocument();
      expect(within(closed).queryByRole("link")).toBeNull();
      expect(within(closed).getByText("Call back")).toBeInTheDocument();
      expect(closed).not.toHaveTextContent("9810823710");
      expect(screen.getByText("2 calls")).toBeInTheDocument();
      await userEvent.click(within(open).getByText("MLSS Delhi"));
      expect(where()).toBe("/sales/calling-lists/5?tab=contacts");
    });

    it("a contact row shows its status; the hidden line still adds up", async () => {
      mockReportEndpoints("/api/reports/salesRows", data({ rows: [k({ Metric: "contact", Detail1: "held", EventAt: null })], total: 3, hiddenCount: 2 }));
      renderRows("calling", "/reports/sales/calling/rows?metric=contact&shape=events&key=5&line=calllist&preset=any");
      await waitFor(() => expect(bodyRows().length).toBe(1));
      expect(within(bodyRows()[0]).getByText("With caller")).toBeInTheDocument();
      expect(screen.getByTestId("sales-rows-hidden")).toHaveTextContent("2 activities");
    });
  });
});

