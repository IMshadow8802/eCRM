import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import dayjs from "dayjs";

import AttendanceReport from "./AttendanceReport";
import renderWithProviders from "../../test/renderWithProviders";
import { server } from "../../test/mocks/server";
import { mockReportEndpoints } from "../../test/reportMocks";
import useAuthStore from "../../stores/useAuthStore";

const KPIS = {
  PresentPct: 94.3, PresentDays: 45.5, WorkingDays: 48, LateCount: 9, LateMinutesTotal: 185, LateMinutesMedian: 14,
  Absent: 3, AbsentTop: [{ FullName: "Kavya Nair", days: 2 }, { FullName: "Rohit Verma", days: 1 }],
  OnlineMedianMin: 470, ShiftMedianMin: 540,
};
const DAYS = ["2026-10-01", "2026-10-02", "2026-10-03"];
const ROW = {
  UserId: 80, FullName: "Kavya Nair", Present: 1.5, WorkingDays: 2, Late: 1, LateMinutes: 14, Absent: 0, Leave: 0.5,
  LeftEarly: 0, OnlineMedianMin: 370, ShiftMedianMin: 540, LateStreak: true,
  cells: [
    { date: "2026-10-01", code: "late", lateMin: 14, onlineMin: 400 },
    { date: "2026-10-02", code: "half", lateMin: 0, onlineMin: 200 },
    { date: "2026-10-03", code: "future", lateMin: 0, onlineMin: 0 },
  ],
};
const DATA = { kpis: KPIS, days: DAYS, rows: [ROW], range: { from: DAYS[0], to: DAYS[2] } };

const signIn = (admin) =>
  useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://x/CRM", access: { isAdmin: admin, modules: {} } });

const render = (route = "/reports/attendance") => renderWithProviders(<AttendanceReport />, { route });

describe("AttendanceReport", () => {
  beforeEach(() => signIn(false));

  it("defaults to this whole month and posts only the range and filters", async () => {
    const cap = mockReportEndpoints("/api/reports/attendance", DATA);
    render();
    await screen.findByTestId("attendance-grid");
    expect(cap.body).toEqual({
      FromDate: dayjs().startOf("month").format("YYYY-MM-DD"),
      ToDate: dayjs().endOf("month").format("YYYY-MM-DD"),
      BranchId: null,
      OwnerId: null,
    });
    expect(screen.getByTestId("report-preset-month")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("report-preset-7d")).toBeNull();
    expect(screen.queryByTestId("report-groupby")).toBeNull();
    expect(screen.getByTestId("att-legend")).toHaveTextContent("Late (minutes)");
    expect(screen.getByTestId("att-legend")).toHaveTextContent("Half-day leave");
  });

  it("last month asks for the whole previous month", async () => {
    const cap = mockReportEndpoints("/api/reports/attendance", DATA);
    render("/reports/attendance?preset=lastmonth");
    await screen.findByTestId("attendance-grid");
    const last = dayjs().subtract(1, "month");
    expect(cap.body).toMatchObject({ FromDate: last.startOf("month").format("YYYY-MM-DD"), ToDate: last.endOf("month").format("YYYY-MM-DD") });
  });

  it("shows the four KPI cards with halves, totals and top absentees", async () => {
    mockReportEndpoints("/api/reports/attendance", DATA);
    render();
    const present = await screen.findByTestId("att-kpi-present");
    await waitFor(() => expect(present).toHaveTextContent("94%"));
    expect(present).toHaveTextContent("45½ of 48 person-days");
    const late = screen.getByTestId("att-kpi-late");
    expect(late).toHaveTextContent("9");
    expect(late).toHaveTextContent("total 3h 5m · median 14 min");
    const absent = screen.getByTestId("att-kpi-absent");
    expect(absent).toHaveTextContent("3");
    expect(absent).toHaveTextContent("Kavya Nair 2 · Rohit Verma 1");
    const hours = screen.getByTestId("att-kpi-hours");
    expect(hours).toHaveTextContent("7h 50m");
    expect(hours).toHaveTextContent("median per day signed in · shift is 9h 0m");
  });

  it("an empty range reads — and nobody, never 0% or 100%", async () => {
    mockReportEndpoints("/api/reports/attendance", {
      kpis: { PresentPct: null, PresentDays: 0, WorkingDays: 0, LateCount: 0, LateMinutesTotal: 0, LateMinutesMedian: null, Absent: 0, AbsentTop: [], OnlineMedianMin: null, ShiftMedianMin: null },
      days: DAYS, rows: [],
    });
    render();
    const present = await screen.findByTestId("att-kpi-present");
    await waitFor(() => expect(present).toHaveTextContent("—"));
    expect(present).not.toHaveTextContent("%");
    expect(screen.getByTestId("att-kpi-late")).toHaveTextContent("Nobody was late");
    expect(screen.getByTestId("att-kpi-absent")).toHaveTextContent("Nobody was absent");
    expect(screen.getByTestId("att-kpi-hours")).toHaveTextContent("—");
    expect(screen.getByTestId("att-empty")).toBeInTheDocument();
  });

  it("a custom range over 62 days says so and does not fetch", async () => {
    const cap = mockReportEndpoints("/api/reports/attendance", DATA);
    render("/reports/attendance?preset=custom&from=2026-08-01&to=2026-10-02");
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick 62 days or fewer");
    // the pick-lists load, so the page has settled; the report itself was never asked for
    await screen.findByTestId("report-BranchId");
    await new Promise((r) => setTimeout(r, 50));
    expect(cap.body).toBeUndefined();
    expect(screen.queryByTestId("attendance-grid")).toBeNull();
  });

  it("a custom range with To before From says so and does not fetch", async () => {
    const cap = mockReportEndpoints("/api/reports/attendance", DATA);
    render("/reports/attendance?preset=custom&from=2026-08-31&to=2026-08-01");
    expect(await screen.findByRole("alert")).toHaveTextContent("To is before From");
    await screen.findByTestId("report-BranchId");
    await new Promise((r) => setTimeout(r, 50));
    expect(cap.body).toBeUndefined();
    // regression: no fake report ("Nobody was late") under the message
    expect(screen.queryByTestId("att-kpi-late")).toBeNull();
    expect(screen.queryByText("Nobody was late")).toBeNull();
  });

  it("exactly 62 days fetches", async () => {
    const cap = mockReportEndpoints("/api/reports/attendance", DATA);
    render("/reports/attendance?preset=custom&from=2026-08-01&to=2026-10-01");
    await screen.findByTestId("attendance-grid");
    expect(cap.body).toMatchObject({ FromDate: "2026-08-01", ToDate: "2026-10-01" });
  });

  it("a server error shows its message", async () => {
    mockReportEndpoints("/api/reports/attendance", DATA);
    server.use(http.post("*/api/reports/attendance", () => HttpResponse.json({ success: false, message: "Pick 62 days or fewer" }, { status: 400 })));
    render();
    expect(await screen.findByTestId("att-error")).toHaveTextContent("Pick 62 days or fewer");
  });

  it("does not fetch sources or products", async () => {
    mockReportEndpoints("/api/reports/attendance", DATA);
    const hits = [];
    for (const p of ["config/fetchLookups", "products/fetchProducts"]) {
      server.use(http.post(`*/api/${p}`, () => { hits.push(p); return HttpResponse.json({ success: true, data: {} }); }));
    }
    render();
    await screen.findByTestId("attendance-grid");
    expect(hits).toEqual([]);
  });

  it("non-admins see the grid but cannot open sign-ins", async () => {
    mockReportEndpoints("/api/reports/attendance", DATA);
    render();
    const grid = await screen.findByTestId("attendance-grid");
    expect(within(grid).getByLabelText(/^Late 14 minutes, /)).toBeInTheDocument();
    expect(within(grid).queryAllByRole("button")).toHaveLength(0);
  });

  it("an admin's cell click opens that person's sign-ins for that day", async () => {
    signIn(true);
    mockReportEndpoints("/api/reports/attendance", DATA);
    const asked = [];
    server.use(http.post("*/api/presence/fetchSessions", async ({ request }) => {
      asked.push(await request.json());
      return HttpResponse.json({ success: true, data: { sessions: [
        { SessionId: 1, Device: "Chrome on Mac", StartedAt: "2026-10-01 09:14:00", LastSeenAt: "2026-10-01 18:00:00" },
        { SessionId: 2, Device: "Android phone", StartedAt: "2026-10-02 09:00:00", LastSeenAt: "2026-10-02 13:00:00" },
      ] } });
    }));
    render();
    await userEvent.click(await screen.findByRole("button", { name: /^Late 14 minutes, / }));
    const dialog = await screen.findByTestId("sessions-dialog");
    expect(await within(dialog).findByTestId("session-1")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("session-2")).toBeNull();
    expect(dialog).toHaveTextContent("Kavya Nair");
    expect(asked[0]).toEqual({ UserId: 80 });
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("sessions-dialog")).toBeNull());
  });

  it("clicking This month after Last month refetches this month", async () => {
    const cap = mockReportEndpoints("/api/reports/attendance", DATA);
    render("/reports/attendance?preset=lastmonth");
    await screen.findByTestId("attendance-grid");
    await userEvent.click(screen.getByTestId("report-preset-month"));
    await waitFor(() => expect(cap.body.FromDate).toBe(dayjs().startOf("month").format("YYYY-MM-DD")));
  });

  it("exports a CSV with the totals and a column per day", async () => {
    mockReportEndpoints("/api/reports/attendance", DATA);
    const created = vi.fn(() => "blob:x");
    const orig = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render();
    await screen.findByTestId("attendance-grid");
    await userEvent.click(screen.getByTestId("report-export"));
    const text = await new Promise((done) => {
      const r = new FileReader();
      r.onload = () => done(r.result);
      r.readAsText(created.mock.calls[0][0]);
    });
    const [head, line] = text.split("\n");
    expect(head).toBe("Person,Present,Working days,Late,Late minutes,Absent,Leave,Left early,Online (median min),Shift (median min),2026-10-01,2026-10-02,2026-10-03");
    expect(line).toBe("Kavya Nair,1.5,2,1,14,0,0.5,0,370,540,Late 14 minutes,Half-day leave,");
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    Object.assign(URL, orig);
  });

  it("names the top three absentees, most days first, and folds the rest into +N more", async () => {
    const top = [["Asha", 1], ["Kavya Nair", 4], ["Rohit", 2], ["Meera", 3], ["Dev", 1]].map(([FullName, days]) => ({ FullName, days }));
    mockReportEndpoints("/api/reports/attendance", { ...DATA, kpis: { ...KPIS, Absent: 11, AbsentTop: top } });
    render();
    const names = await screen.findByTestId("att-absent-names");
    expect(names).toHaveTextContent("Kavya Nair 4 · Meera 3 · Rohit 2 · +2 more");
    expect(names).toHaveAttribute("title", "Kavya Nair 4 · Meera 3 · Rohit 2 · Asha 1 · Dev 1");
  });
});
