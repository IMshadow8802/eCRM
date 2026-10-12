import { describe, it, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import dayjs from "dayjs";

import TatReport from "./TatReport";
import renderWithProviders from "../../test/renderWithProviders";
import { server } from "../../test/mocks/server";
import { mockReportEndpoints } from "../../test/reportMocks";
import { palettes } from "../../styles/tokens";

const KPIS = {
  Finished: 46, OnTime: 40, OnTimePct: 86.96, Missed: 6, NotExcused: 3, Excused: 2, NoDecision: 1,
  ReasonPending: 1, OverdueNow: 5, OldestOverdueAt: dayjs().subtract(2, "day").subtract(5, "minute").toISOString(),
  MedianUsedPct: 72, P90UsedPct: 140,
};
const ROW = (over) => ({
  GroupKey: "80", GroupLabel: "Kavya Nair", Finished: 6, OnTime: 3, OnTimePct: 50, Missed: 3, NotExcused: 2,
  Excused: 0, NoDecision: 0, ReasonPending: 1, OverdueNow: 3, MedianUsedPct: 118, ...over,
});
const DATA = {
  kpis: KPIS,
  rows: [
    ROW(),
    ROW({ GroupKey: "78", GroupLabel: "Priya Singh", Finished: 9, OnTime: 9, OnTimePct: 100, Missed: 0, NotExcused: 0, ReasonPending: 0, OverdueNow: 0, MedianUsedPct: 81 }),
    ROW({ GroupKey: "", GroupLabel: "No priority", Finished: 0, OnTime: 0, OnTimePct: null, Missed: 1, NotExcused: 1, ReasonPending: 0, OverdueNow: 0, MedianUsedPct: null }),
  ],
  trend: [
    { Bucket: "2026-09-14", Finished: 10, OnTime: 7 },
    { Bucket: "2026-09-21", Finished: 0, OnTime: 0 },
    { Bucket: "2026-09-28", Finished: 8, OnTime: 8 },
  ],
  previous: { Finished: 39, OnTime: 31 },
};

const CLOCK = {
  TatId: 11, TaskId: 501, TaskTitle: "Fix the invoice export", UserId: 80, FullName: "Kavya Nair", WorkspaceName: "Ops",
  AssignedAt: "2026-10-01 10:00:00", DueAt: "2026-10-02 10:00:00", ClosedAt: null, BreachedAt: "2026-10-02 10:00:00",
  Reason: "Waiting on client", BreachRemarks: "Client sent files late", Verdict: "not_excused", VerdictByName: "Ayush Mishra",
  VerdictRemarks: "Should have flagged it", WorkMinutes: null, TargetMinutes: 480,
};

const mockClocks = (clocks = [CLOCK]) => {
  const cap = { bodies: [] };
  server.use(http.post("*/api/reports/tatClocks", async ({ request }) => {
    cap.bodies.push(await request.json());
    return HttpResponse.json({ success: true, data: { clocks } });
  }));
  return cap;
};

const render = (route = "/reports/tat") => renderWithProviders(<TatReport />, { route });

describe("TatReport", () => {
  it("four small KPIs: on time, missed not excused, overdue now, waiting for your decision", async () => {
    const cap = mockReportEndpoints("/api/reports/tat", DATA);
    render();
    await screen.findByTestId("tat-table");
    expect(cap.body).toMatchObject({ GroupBy: "person", DateBasis: "assigned" });
    const ontime = screen.getByTestId("tat-kpi-ontime");
    expect(ontime).toHaveTextContent("87%");
    expect(ontime).toHaveTextContent("40 of 46");
    expect(ontime).toHaveAttribute("title", "Previous 30 days: 79% (31 of 39) — up 8 points");
    expect(screen.getByTestId("tat-kpi-missed")).toHaveTextContent("3of 6 missedMissed, not excused");
    expect(screen.getByTestId("tat-kpi-overdue")).toHaveTextContent("oldest 2 days");
    expect(screen.getByTestId("tat-kpi-decision")).toHaveTextContent("1Waiting for your decision");
    // the chart and the time-used card are gone
    expect(screen.queryByTestId("tat-bars")).toBeNull();
    expect(screen.queryByTestId("tat-kpi-used")).toBeNull();
  });

  it("each KPI names its hue with an icon badge on a neutral card", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    render();
    const missed = await screen.findByTestId("tat-kpi-missed");
    expect(missed.querySelector("[data-tone]").dataset.tone).toBe("error");
    expect(screen.getByTestId("tat-kpi-ontime").querySelector("[data-tone]").dataset.tone).toBe("success");
    expect(screen.getByTestId("tat-kpi-decision").querySelector("[data-tone]").dataset.tone).toBe("warning");
    expect(missed.style.border).toContain("1px solid");
  });

  it("nothing finished reads — and 0 finished; a zero KPI is not a button", async () => {
    mockReportEndpoints("/api/reports/tat", { kpis: { ...KPIS, Finished: 0, OnTime: 0, OnTimePct: null, OldestOverdueAt: null, OverdueNow: 0, NotExcused: 0, NoDecision: 0, Missed: 0 }, rows: [], previous: { Finished: 0, OnTime: 0 } });
    render();
    const card = await screen.findByTestId("tat-kpi-ontime");
    await waitFor(() => expect(card).toHaveTextContent("—"));
    expect(card).toHaveTextContent("0 finished");
    expect(card).toHaveAttribute("title", "Previous 30 days: nothing finished");
    for (const id of ["tat-kpi-ontime", "tat-kpi-missed", "tat-kpi-overdue", "tat-kpi-decision"]) {
      expect(screen.getByTestId(id)).not.toHaveAttribute("role", "button");
    }
    expect(screen.getByTestId("tat-empty")).toBeInTheDocument();
  });

  it("previous period lower and equal say down / same", async () => {
    mockReportEndpoints("/api/reports/tat", { ...DATA, previous: { Finished: 10, OnTime: 10 } });
    const { unmount } = render();
    await screen.findByTestId("tat-table");
    expect(screen.getByTestId("tat-kpi-ontime")).toHaveAttribute("title", "Previous 30 days: 100% (10 of 10) — down 13 points");
    unmount();
    mockReportEndpoints("/api/reports/tat", { ...DATA, kpis: { ...KPIS, OnTimePct: 80 }, previous: { Finished: 5, OnTime: 4 } });
    render();
    await screen.findByTestId("tat-table");
    expect(screen.getByTestId("tat-kpi-ontime")).toHaveAttribute("title", "Previous 30 days: 80% (4 of 5) — same");
  });

  it("shows no numbers while the report is loading", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    server.use(http.post("*/api/reports/tat", () => new Promise(() => {})));
    render();
    await screen.findByTestId("tat-kpi-ontime");
    await new Promise((r) => setTimeout(r, 30));
    for (const id of ["tat-kpi-ontime", "tat-kpi-missed", "tat-kpi-overdue", "tat-kpi-decision"]) {
      const t = screen.getByTestId(id).textContent;
      expect(t).not.toMatch(/\d|—|finished|missed|oldest/);
    }
  });

  it("each KPI opens its timers for everyone (no GroupKey)", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    const cap = mockClocks([]);
    const user = userEvent.setup();
    render();
    await screen.findByTestId("tat-table");
    const kpis = [["On time: 40 of 46", "ontime"], ["Not excused: 3", "not_excused"], ["Overdue now: 5", "overdue_now"], ["No decision yet: 1", "no_decision"]];
    for (const [name, metric] of kpis) {
      await user.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(cap.bodies.at(-1)?.Metric).toBe(metric));
      expect(cap.bodies.at(-1).GroupKey).toBeUndefined();
      await user.click(screen.getByRole("button", { name: "Close" }));
    }
  });

  it("people worst first, with a health word and a light wash on red and amber rows", async () => {
    const rows = [
      ROW({ GroupKey: "1", GroupLabel: "Green Gita", Finished: 5, OnTime: 5, OnTimePct: 100, Missed: 0, NotExcused: 0, ReasonPending: 0, NoDecision: 0, OverdueNow: 0 }),
      ROW({ GroupKey: "2", GroupLabel: "Grey Gopal", Finished: 0, OnTime: 0, OnTimePct: null, Missed: 0, NotExcused: 0, Excused: 0, ReasonPending: 0, NoDecision: 0, OverdueNow: 0 }),
      ROW({ GroupKey: "3", GroupLabel: "Amber Anu", Finished: 2, OnTime: 1, OnTimePct: 50, Missed: 1, NotExcused: 0, ReasonPending: 1, NoDecision: 0, OverdueNow: 0 }),
      ROW({ GroupKey: "4", GroupLabel: "Red One", OverdueNow: 1, NotExcused: 0 }),
      ROW({ GroupKey: "5", GroupLabel: "Red Four", OverdueNow: 4 }),
      ROW({ GroupKey: "6", GroupLabel: "Red Excuse", OverdueNow: 0, NotExcused: 2, ReasonPending: 0 }),
    ];
    mockReportEndpoints("/api/reports/tat", { ...DATA, rows });
    render();
    const table = await screen.findByTestId("tat-table");
    expect(within(table).getAllByTestId("tat-row-label").map((n) => n.textContent)).toEqual(["Red Four", "Red One", "Red Excuse", "Amber Anu", "Green Gita", "Grey Gopal"]);
    expect(within(table).getAllByTestId("tat-health").map((n) => n.textContent)).toEqual(["Needs action", "Needs action", "Needs action", "Waiting", "On track", "No tasks"]);
    const tints = within(table).getAllByRole("row").slice(1).map((tr) => tr.getAttribute("data-tint"));
    expect(tints.slice(0, 3)).toEqual(Array(3).fill(palettes.light.error.subtle));
    expect(tints[3]).toBe(palettes.light.warning.subtle);
    expect(tints.slice(4)).toEqual([null, null]);
  });

  it("says each number in words: missed by ruling, on time as x of y, waiting for whom", async () => {
    mockReportEndpoints("/api/reports/tat", { ...DATA, rows: [ROW({ Excused: 2, NoDecision: 2 })] });
    render();
    const table = await screen.findByTestId("tat-table");
    const kavya = within(table).getAllByRole("row")[1];
    expect(kavya).toHaveTextContent("3·2 not excused·2 excused·2 undecided");
    expect(kavya).toHaveTextContent("3 of 650%");
    expect(kavya).toHaveTextContent("1 reason·2 your decision");
    // dropped columns
    expect(table).not.toHaveTextContent("Time used");
    expect(table).not.toHaveTextContent("Reason pending");
  });

  it("zeros are dashes and not buttons", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    render();
    const table = await screen.findByTestId("tat-table");
    const priya = within(table).getAllByRole("row").find((r) => r.textContent.includes("Priya Singh"));
    expect(within(priya).queryByRole("button", { name: /Not excused|Overdue|Reason|decision/ })).toBeNull();
    expect(within(priya).getByRole("button", { name: "On time: 9 of 9" })).toHaveTextContent("9 of 9");
    expect(priya).toHaveTextContent("—");
  });

  it("every number in a row opens its metric for that row", async () => {
    mockReportEndpoints("/api/reports/tat", { ...DATA, rows: [ROW({ Excused: 1, NoDecision: 1 })] });
    const cap = mockClocks([]);
    const user = userEvent.setup();
    render();
    const table = await screen.findByTestId("tat-table");
    const kavya = within(table).getAllByRole("row")[1];
    const clicks = [
      ["Overdue now: 3", "overdue_now"], ["Missed: 3", "missed"], ["Not excused: 2", "not_excused"], ["Excused: 1", "excused"], ["Undecided: 1", "no_decision"],
      ["On time: 3 of 6", "ontime"], ["Reason pending: 1", "reason_pending"], ["Your decision: 1", "no_decision"],
    ];
    for (const [name, metric] of clicks) {
      await user.click(within(kavya).getByRole("button", { name }));
      await waitFor(() => expect(cap.bodies.at(-1)?.Metric).toBe(metric));
      expect(cap.bodies.at(-1).GroupKey).toBe("80");
      await user.click(screen.getByRole("button", { name: "Close" }));
    }
  });

  it("clicking Not excused on a row loads that row's clocks with reason and decision", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    const cap = mockClocks();
    const user = userEvent.setup();
    render();
    const table = await screen.findByTestId("tat-table");
    const kavya = within(table).getAllByRole("row").find((r) => r.textContent.includes("Kavya Nair"));
    await user.click(within(kavya).getByRole("button", { name: "Not excused: 2" }));
    const drawer = await screen.findByTestId("clocks-drawer");
    await within(drawer).findByText("Fix the invoice export");
    expect(cap.bodies[0]).toMatchObject({ Metric: "not_excused", GroupKey: "80", GroupBy: "person" });
    expect(drawer).toHaveTextContent("Kavya Nair · Not excused");
    expect(drawer).toHaveTextContent("Waiting on client");
  });

  it("the 'No priority' row drills with GroupKey ''", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    const cap = mockClocks([]);
    const user = userEvent.setup();
    render("/reports/tat?groupBy=priority");
    const table = await screen.findByTestId("tat-table");
    const none = within(table).getAllByRole("row").find((r) => r.textContent.includes("No priority"));
    await user.click(within(none).getByRole("button", { name: "Not excused: 1" }));
    await waitFor(() => expect(cap.bodies).toHaveLength(1));
    expect(cap.bodies[0]).toMatchObject({ Metric: "not_excused", GroupKey: "", GroupBy: "priority" });
  });

  it("group by Board posts workspace and heads the table Board", async () => {
    const cap = mockReportEndpoints("/api/reports/tat", DATA);
    const user = userEvent.setup();
    render();
    await screen.findByTestId("tat-table");
    await user.click(screen.getByRole("tab", { name: "Board" }));
    await waitFor(() => expect(cap.body.GroupBy).toBe("workspace"));
    expect(screen.getByTestId("tat-table")).toHaveTextContent("Board");
  });

  it("exports the table as CSV", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    const createObjectURL = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    render();
    await screen.findByTestId("tat-table");
    await user.click(screen.getByTestId("report-export"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("shows an error when the report fails", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    server.use(http.post("*/api/reports/tat", () => HttpResponse.json({ success: false }, { status: 500 })));
    render();
    expect(await screen.findByTestId("tat-error")).toBeInTheDocument();
  });

  it("a custom range with To before From says so and does not fetch", async () => {
    const cap = mockReportEndpoints("/api/reports/tat", DATA);
    render("/reports/tat?preset=custom&from=2026-08-31&to=2026-08-01");
    expect(await screen.findByRole("alert")).toHaveTextContent("To is before From");
    await screen.findByTestId("report-BranchId");
    await new Promise((r) => setTimeout(r, 50));
    expect(cap.body).toBeUndefined();
    // regression: no fake report (zeros, "Previous −N days") under the message
    expect(screen.queryByTestId("tat-kpi-ontime")).toBeNull();
    expect(screen.queryByTestId("tat-empty")).toBeNull();
  });

  it("does not fetch sources or products", async () => {
    mockReportEndpoints("/api/reports/tat", DATA);
    const hits = [];
    for (const p of ["config/fetchLookups", "products/fetchProducts"]) {
      server.use(http.post(`*/api/${p}`, () => { hits.push(p); return HttpResponse.json({ success: true, data: {} }); }));
    }
    render();
    await screen.findByTestId("tat-table");
    expect(hits).toEqual([]);
    expect(screen.getByTestId("report-OwnerId-input")).toHaveAttribute("placeholder", "All people");
  });

});
