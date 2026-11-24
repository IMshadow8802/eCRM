import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import renderWithProviders from "../../../test/renderWithProviders";
import { mockReportEndpoints } from "../../../test/reportMocks";
import SalesReport from "./SalesReport";
import { REPORTS } from "./reports";
import { KEY_LEGEND } from "./columns";
import { exportName, summaryCsv } from "./salesReportUtils";

const line = (o) => ({ GroupKey: 1, GroupLabel: "A", LineKind: "person", TeamSize: 1, IsActive: true, NoManager: false, Ord: 1, ...o });
const data = (over = {}) => ({ rows: [], totals: {}, previous: null, path: [], nodeOk: true, range: { from: "2026-11-17", to: "2026-11-17" }, asOf: "2026-11-18 09:40:00", ...over });

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

const renderReport = (report, route = REPORTS[report].path) =>
  renderWithProviders(<><SalesReport report={report} /><Where /></>, { route });

const TEAM = data({
  rows: [
    line({ GroupKey: 9, GroupLabel: "Neha Kulkarni", LineKind: "team", TeamSize: 4, New: 3 }),
    line({ GroupKey: 5, GroupLabel: "Old Hand", IsActive: false }),
    line({ GroupKey: 3, GroupLabel: "Rajesh Mehta", LineKind: "own", TeamSize: 7, New: 2 }),
    line({ GroupKey: 21, GroupLabel: "Priya Sharma", LineKind: "team", TeamSize: 13, NoManager: true }),
    line({ GroupKey: 22, GroupLabel: "Aman", NoManager: true }),
    line({ GroupKey: null, GroupLabel: "Unassigned", LineKind: "unassigned", New: 6 }),
  ],
  totals: { New: 11 },
  previous: { range: { from: "2026-11-16", to: "2026-11-16" }, totals: { New: 4 } },
});

describe("SalesReport", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 18, 9, 40));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Team report opens on Yesterday: body, date field words, no chart, no Group by", async () => {
    const cap = mockReportEndpoints("/api/reports/sales", data());
    renderReport("team");
    await waitFor(() => expect(cap.body).toEqual({ GroupBy: "team", FromDate: "2026-11-17", ToDate: "2026-11-17", NodeId: null, BranchId: null, SourceId: null, ProductId: null }));
    const field = screen.getByTestId("date-range-button");
    expect(field).toHaveTextContent("Work done in");
    expect(field).toHaveTextContent("Yesterday · 17 Nov 2026");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Group by/i)).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Team report" })).toBeInTheDocument();
  });

  it("draws team, own, unassigned, inactive and no-manager lines", async () => {
    mockReportEndpoints("/api/reports/sales", TEAM);
    renderReport("team");
    const neha = await screen.findByRole("link", { name: /Neha Kulkarni/ });
    expect(neha.getAttribute("href")).toMatch(/\?at=9$/);
    expect(neha.querySelector("svg")).toBeInTheDocument();
    const nehaRow = neha.closest("tr");
    expect(nehaRow).toHaveTextContent("· team of 4");

    const own = screen.getByRole("link", { name: "Rajesh Mehta" });
    expect(own.closest("td")).toHaveTextContent("Rajesh Mehta — own leads");
    expect(own.closest("td")).not.toHaveTextContent("team of");
    expect(own.getAttribute("href")).toContain("/reports/sales/team/rows?shape=leads&metric=all&person=3");

    const un = screen.getByText("Unassigned leads");
    expect(un.closest("a")).toBeNull();
    expect(within(un.closest("tr")).getByRole("link", { name: "6" }).getAttribute("href")).toContain("unassigned=1");

    expect(screen.getByRole("link", { name: "Old Hand" }).closest("td")).toHaveTextContent("inactive");

    expect(screen.getAllByText("No manager set")).toHaveLength(2);
    const section = screen.getByText("Not under anyone — set “Reports to” in Users");
    expect(section.closest("tr").nextElementSibling).toHaveTextContent("Priya Sharma");
    expect(screen.getAllByText(/Not under anyone/)).toHaveLength(1);

    expect(screen.getByText(/Starts at you/).closest("div")).toHaveTextContent("Starts at you · 6 lines · a manager's line is their whole team, themselves included");
    expect(screen.getByText("Previous period · 16 Nov 2026")).toBeInTheDocument();
  });

  // REGRESSION (e2e 2026-11-18): the API sends IsActive/NoManager as 1/0 (the
  // controller's numRow), so `{l.NoManager && …}` printed a stray "0" after
  // every name and `IsActive === false` never showed "inactive".
  it("flags as 1/0 numbers: no stray 0 after a name, inactive and no-manager still drawn", async () => {
    mockReportEndpoints("/api/reports/sales", data({
      rows: [
        line({ GroupKey: 9, GroupLabel: "Neha Kapoor", LineKind: "team", TeamSize: 4, IsActive: 1, NoManager: 0, New: 3 }),
        line({ GroupKey: 5, GroupLabel: "Old Hand", IsActive: 0, NoManager: 0 }),
        line({ GroupKey: 21, GroupLabel: "Priya Sharma", LineKind: "team", TeamSize: 13, IsActive: 1, NoManager: 1 }),
      ],
      totals: { New: 3 },
    }));
    renderReport("team");
    const neha = await screen.findByRole("link", { name: /Neha Kapoor/ });
    expect(neha.closest("td").textContent).toBe("Neha Kapoor· team of 4");
    expect(screen.getByRole("link", { name: "Old Hand" }).closest("td").textContent).toBe("Old Hand inactive");
    expect(screen.getByRole("link", { name: /Priya Sharma/ }).closest("td").textContent).toBe("Priya Sharma· team of 13No manager set");
  });

  it("a lost reason line (flags 0) prints only its name", async () => {
    mockReportEndpoints("/api/reports/sales", data({
      rows: [line({ GroupKey: 4, GroupLabel: "Price", LineKind: "reason", IsActive: 1, NoManager: 0, Lost: 1 })],
      totals: { Lost: 1 },
    }));
    renderReport("lost");
    const price = await screen.findByText("Price");
    expect(price.closest("td").textContent).toBe("Price");
  });

  it("clicking a team walks down: NodeId posted, filters kept, breadcrumb back to the start", async () => {
    const cap = mockReportEndpoints("/api/reports/sales", (body) =>
      body.NodeId === 9
        ? data({ rows: [line({ GroupKey: 4, GroupLabel: "Kiran" })], path: [{ Id: 9, Name: "Neha Kulkarni" }] })
        : TEAM,
    );
    renderReport("team", "/reports/sales/team?preset=week&BranchId=2");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: /Neha Kulkarni/ }));
    await waitFor(() => expect(cap.body).toMatchObject({ NodeId: 9, BranchId: 2, FromDate: "2026-11-16", ToDate: "2026-11-22" }));
    expect(where()).toBe("/reports/sales/team?preset=week&at=9&BranchId=2");
    expect(await screen.findByRole("heading", { level: 1, name: "Neha Kulkarni" })).toBeInTheDocument();
    expect(screen.getByText("their team, added up per person")).toBeInTheDocument();
    const crumb = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Team report" });
    expect(crumb.getAttribute("href")).toBe("/reports/sales/team?preset=week&BranchId=2");
    expect(await screen.findByText("1 line")).toBeInTheDocument();
    await user.click(crumb);
    expect(where()).toBe("/reports/sales/team?preset=week&BranchId=2");
  });

  it("deeper path: earlier names are crumbs too; export is named after the person", async () => {
    mockReportEndpoints("/api/reports/sales", data({
      rows: [line({ GroupKey: 4, GroupLabel: "Kiran", New: 1 })], totals: { New: 1 },
      path: [{ Id: 9, Name: "Neha Kulkarni" }, { Id: 4, Name: "Kiran Rao" }],
    }));
    const create = vi.fn(() => "blob:x");
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderReport("team", "/reports/sales/team?at=4");
    const nav = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(await within(nav).findByRole("link", { name: "Neha Kulkarni" })).toHaveAttribute("href", "/reports/sales/team?at=9");
    expect(screen.getByRole("heading", { level: 1, name: "Kiran Rao" })).toBeInTheDocument();
    await screen.findByText("Kiran");
    await userEvent.setup().click(screen.getByRole("button", { name: /Export/ }));
    expect(click.mock.instances[0].download).toBe("team-report_kiran-rao_2026-11-17.csv");
    expect(create).toHaveBeenCalled();
  });

  it("a team the caller cannot see says so and offers the way back", async () => {
    mockReportEndpoints("/api/reports/sales", data({ nodeOk: false }));
    renderReport("team", "/reports/sales/team?at=77&SourceId=11");
    expect(await screen.findByText("You cannot see this person's team")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Team report" })).toHaveAttribute("href", "/reports/sales/team?SourceId=11");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("an empty period offers This month, unless that is already the period", async () => {
    mockReportEndpoints("/api/reports/sales", data({ range: { from: "2026-11-01", to: "2026-11-30" } }));
    const { unmount } = renderReport("sources", "/reports/sales/sources?preset=week");
    expect(await screen.findByText("Nothing in this period")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try This month" }));
    expect(where()).toBe("/reports/sales/sources");
    unmount();
    renderReport("sources");
    expect(await screen.findByText("Nothing in this period")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try This month" })).toBeNull();
  });

  it("a backwards custom range says so and never asks the server", async () => {
    const cap = mockReportEndpoints("/api/reports/sales", data());
    renderReport("team", "/reports/sales/team?preset=custom&from=2026-09-30&to=2026-09-01");
    expect(await screen.findByText("To is before From")).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(cap.body).toBeUndefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("Open leads: no dates, Any time, no previous row, person names drill to their open leads", async () => {
    const cap = mockReportEndpoints("/api/reports/sales", data({
      rows: [line({ GroupKey: 17, GroupLabel: "Amit Singh", OpenNow: 4 }), line({ GroupKey: 18, GroupLabel: "Sara Khan", OpenNow: 0 }), line({ GroupKey: null, GroupLabel: "Unassigned", LineKind: "unassigned", OpenNow: 2 })],
      totals: { OpenNow: 626 },
      previous: { range: { from: "2026-10-01", to: "2026-10-31" }, totals: { OpenNow: 1 } },
    }));
    renderReport("open");
    await waitFor(() => expect(cap.body).toBeDefined());
    expect(cap.body).toMatchObject({ GroupBy: "person" });
    expect(cap.body).not.toHaveProperty("FromDate");
    expect(cap.body).not.toHaveProperty("ToDate");
    expect(screen.getByTestId("date-range-button")).toHaveTextContent("Any time");
    const amit = await screen.findByRole("link", { name: "Amit Singh" });
    expect(amit.getAttribute("href")).toContain("/reports/sales/open/rows?metric=open&shape=events&person=17");
    expect(screen.getByText("Sara Khan").closest("a")).toBeNull();
    expect(screen.getByText("Unassigned leads").closest("a")).toBeNull();
    expect(screen.queryByText(/Previous period/)).toBeNull();
    expect(screen.getByText(/open leads · as of/)).toHaveTextContent("626 open leads · as of 18-11-2026 09:40 · ages count from the Created date");
  });

  it("Lost leads: a reason with no key keeps the server's label and drills with keynull", async () => {
    mockReportEndpoints("/api/reports/sales", data({
      rows: [line({ GroupKey: null, GroupLabel: "No reason given", LineKind: "group", Lost: 3 }), line({ GroupKey: 8, GroupLabel: "Price", LineKind: "group", Lost: 1 })],
      totals: { Lost: 4 },
    }));
    renderReport("lost");
    const label = await screen.findByText("No reason given");
    expect(label.closest("a")).toBeNull();
    expect(within(label.closest("tr")).getByRole("link", { name: "3" }).getAttribute("href")).toContain("keynull=1");
    expect(screen.getByText("2 reasons")).toBeInTheDocument();
  });

  it("Lead sources: plain names and a sources count", async () => {
    mockReportEndpoints("/api/reports/sales", data({ rows: [line({ GroupKey: 11, GroupLabel: "Website", LineKind: "group", New: 1 })], totals: { New: 1 } }));
    renderReport("sources");
    expect((await screen.findByText("Website")).closest("a")).toBeNull();
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  it("Office narrows: posts BranchId and writes it to the address bar; clearing removes it", async () => {
    const cap = mockReportEndpoints("/api/reports/sales", TEAM);
    renderReport("team");
    await screen.findByRole("link", { name: /Neha Kulkarni/ });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("filter-branch-input"));
    await user.click(await screen.findByRole("option", { name: "SOUTH EXTENSION" }));
    await waitFor(() => expect(cap.body).toMatchObject({ BranchId: 2 }));
    expect(where()).toBe("/reports/sales/team?BranchId=2");
    await user.click(screen.getByTestId("filter-branch").querySelector(".MuiAutocomplete-clearIndicator"));
    await waitFor(() => expect(where()).toBe("/reports/sales/team"));
    // back to the first answer (cached: same body as on open)
    expect(await screen.findByRole("link", { name: /Neha Kulkarni/ })).toBeInTheDocument();
  });

  it("Source and product narrow too", async () => {
    const cap = mockReportEndpoints("/api/reports/sales", TEAM);
    renderReport("team", "/reports/sales/team?SourceId=12&ProductId=99");
    await waitFor(() => expect(cap.body).toMatchObject({ SourceId: 12, ProductId: 99 }));
    await waitFor(() => expect(screen.getByTestId("filter-source-input")).toHaveValue("Referral"));
    await waitFor(() => expect(screen.getByTestId("filter-product-input")).toHaveValue("Unknown (#99)"));
    const user = userEvent.setup();
    await user.click(screen.getByTestId("filter-product-input"));
    await user.click(await screen.findByRole("option", { name: "Gold Chain 22K" }));
    await waitFor(() => expect(where()).toBe("/reports/sales/team?SourceId=12&ProductId=1"));
  });

  it("picking a date preset writes it and asks again", async () => {
    const cap = mockReportEndpoints("/api/reports/sales", TEAM);
    renderReport("team");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("date-range-button"));
    await user.click(await screen.findByTestId("date-range-option-month"));
    await waitFor(() => expect(cap.body).toMatchObject({ FromDate: "2026-11-01", ToDate: "2026-11-30" }));
    expect(where()).toBe("/reports/sales/team?preset=month");
  });

  it("while pending: date field, pickers and headings drawn, six skeleton rows", async () => {
    mockReportEndpoints("/api/reports/sales", () => new Promise(() => {}));
    renderReport("team");
    expect(screen.getByTestId("date-range-button")).toBeInTheDocument();
    expect(screen.getByTestId("filter-branch")).toBeInTheDocument();
    expect(screen.getByTestId("filter-source")).toBeInTheDocument();
    expect(screen.getByTestId("filter-product")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /New leads/ })).toBeInTheDocument();
    expect(screen.getAllByTestId("summary-skeleton-row")).toHaveLength(6);
  });

  it("a failed request says so", async () => {
    const { server } = await import("../../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    mockReportEndpoints("/api/reports/sales", data());
    server.use(http.post("*/api/reports/sales", () => HttpResponse.json({ success: false, message: "no" }, { status: 500 })));
    renderReport("lost");
    expect(await screen.findByText("Failed to load this report.", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("Export downloads summaryCsv under exportName", async () => {
    mockReportEndpoints("/api/reports/sales", TEAM);
    const create = vi.fn(() => "blob:x");
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderReport("team");
    await screen.findByRole("link", { name: /Neha Kulkarni/ });
    await userEvent.setup().click(screen.getByRole("button", { name: /Export/ }));
    const filters = { preset: "yesterday", from: "2026-11-17", to: "2026-11-17" };
    expect(click.mock.instances[0].download).toBe(exportName(REPORTS.team, filters));
    const text = await readBlob(create.mock.calls[0][0]);
    // FileReader.readAsText swallows the BOM, so compare past it.
    expect(text).toBe(summaryCsv(REPORTS.team, TEAM.rows, TEAM.totals, TEAM.previous).replace(/^\uFEFF/, ""));
  });

  it("the colour key lists every key, better / worse and 0 = none", async () => {
    mockReportEndpoints("/api/reports/sales", data());
    renderReport("team");
    const legend = screen.getByTestId("report-legend");
    for (const { label } of KEY_LEGEND) expect(legend).toHaveTextContent(label);
    expect(legend).toHaveTextContent("▲ better ▼ worse than before");
    expect(legend).toHaveTextContent("0 = none");
    expect(KEY_LEGEND.map((x) => x.k)).toEqual(["new", "call", "visit", "won", "lost", "late", "idle", "stock"]);
  });

  describe("Calling (149)", () => {
    const CALLER = line({ GroupKey: 17, GroupLabel: "Rohit Sharma", LineKind: "group", Dials: 34, DialContacts: 30, DialReached: 17, CbBooked: 3, CbKept: 2, CbMissed: 1, DialNoDial: 4, DialSecSum: 300, DialSecN: 10 });
    const LIST = line({ GroupKey: 5, GroupLabel: "MLSS Delhi", LineKind: "group", ListContacts: 4186, ListUsed: 784, Dials: 744, DialReached: 402, New: 78, CohortWon: 6, CohortWonValue: 1140000, ListCost: 42000, SheetRows: 5000, SkippedDup: 365, SkippedBad: 151 });

    it("opens on the Caller line: posts GroupBy caller with its columns", async () => {
      const cap = mockReportEndpoints("/api/reports/sales", data({ rows: [CALLER], totals: { Dials: 34 } }));
      renderReport("calling");
      await waitFor(() => expect(cap.body).toMatchObject({ GroupBy: "caller", FromDate: "2026-11-17", ToDate: "2026-11-17" }));
      const row = (await screen.findByText("Rohit Sharma")).closest("tr");
      expect(within(row).getByRole("link", { name: "17" }).getAttribute("href")).toBe("/reports/sales/calling/rows?metric=dial&shape=events&key=17&flag=reached");
      expect(within(row).getByText("50.0%")).toBeInTheDocument();
      expect(within(row).getAllByText("30")).toHaveLength(2); // contacts called, and 300 s over 10 dials
      expect(screen.getByText("1 caller")).toBeInTheDocument();
      expect(screen.getByText("Caller")).toBeInTheDocument();
    });

    it("Calling list line swaps the columns; cost columns only when a line carries a cost", async () => {
      const cap = mockReportEndpoints("/api/reports/sales", (b) => data({ rows: b.GroupBy === "calllist" ? [LIST, line({ GroupKey: 6, GroupLabel: "Free list", LineKind: "group", ListContacts: 10, ListCost: null })] : [CALLER] }));
      renderReport("calling");
      await screen.findByText("Rohit Sharma");
      const user = userEvent.setup();
      await user.click(screen.getByTestId("filter-line-input"));
      await user.click(await screen.findByRole("option", { name: "Calling list" }));
      await waitFor(() => expect(cap.body.GroupBy).toBe("calllist"));
      expect(where()).toContain("line=calllist");
      const row = (await screen.findByText("MLSS Delhi")).closest("tr");
      for (const t of ["₹42,000.00", "₹538.46", "27.1", "10.3%"]) expect(within(row).getByText(t)).toBeInTheDocument();
      const free = screen.getByText("Free list").closest("tr");
      expect(within(free).getAllByText("—").length).toBeGreaterThan(3);
      expect(screen.getByText("2 calling lists")).toBeInTheDocument();
    });

    it("no cost columns when no line carries a cost (not an admin)", async () => {
      mockReportEndpoints("/api/reports/sales", data({ rows: [{ ...LIST, ListCost: null }] }));
      renderReport("calling", "/reports/sales/calling?line=calllist");
      await screen.findByText("MLSS Delhi");
      expect(screen.queryByText("Cost ₹")).toBeNull();
      expect(screen.queryByText("₹ won per ₹ spent")).toBeNull();
      expect(screen.getByText("Used %")).toBeInTheDocument();
    });

    it("Lead sources by calling list posts calllist; a report without lines has no Lines control", async () => {
      const cap = mockReportEndpoints("/api/reports/sales", data({ rows: [LIST] }));
      renderReport("sources", "/reports/sales/sources?line=calllist");
      await waitFor(() => expect(cap.body.GroupBy).toBe("calllist"));
      expect(await screen.findByText("1 calling list")).toBeInTheDocument();
      expect(screen.getByText("Calling list")).toBeInTheDocument();
    });

    it("the team report has no Lines control", async () => {
      mockReportEndpoints("/api/reports/sales", data());
      renderReport("team");
      await screen.findByTestId("report-legend");
      expect(screen.queryByTestId("filter-line-input")).toBeNull();
    });
  });
});

