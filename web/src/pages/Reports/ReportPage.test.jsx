import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import dayjs from "dayjs";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import ReportPage from "./ReportPage";
import renderWithProviders from "../../test/renderWithProviders";
import { server } from "../../test/mocks/server";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

const GROUP_BYS = [{ value: "source", label: "Source" }, { value: "owner", label: "Owner" }];
const KPIS = [{ key: "Created", label: "Created", format: "int" }, { key: "QualifiedPct", label: "Qualified %", format: "pct" }];
const COLUMNS = [{ key: "GroupLabel" }, { key: "Created", header: "Created", format: "int", align: "right" }];
const TREND = { series: [{ key: "Created", label: "Created", tone: "primary" }] };
const DATA = reportData({
  kpis: { Created: 1234, QualifiedPct: 12.5 },
  rows: [{ GroupKey: 11, GroupLabel: "Website", Created: 700 }, { GroupKey: 12, GroupLabel: "Referral", Created: 534 }],
  trend: [{ Bucket: "2026-09-01", Created: 40 }, { Bucket: "2026-09-08", Created: 52 }],
});
// jsdom's Blob implements no .text(), so read it the long way.
const readBlob = (blob) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsText(blob);
  });

const today = dayjs().format("YYYY-MM-DD");
const daysAgo = (n) => dayjs().subtract(n, "day").format("YYYY-MM-DD");

const renderPage = (route = "/reports/funnel", over = {}) =>
  renderWithProviders(
    <ReportPage reportKey="funnel" title="Funnel" subtitle="s" endpoint="/api/reports/funnel" groupBys={GROUP_BYS} kpis={KPIS} columns={COLUMNS} trend={TREND} {...over} />,
    { route },
  );

describe("ReportPage", () => {
  beforeEach(() => mockNavigate.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("posts the defaults (last 30 days, created, first GroupBy) and renders KPIs, trend and rows", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage();
    expect(screen.getByTestId("funnel-loading")).toBeInTheDocument();
    const table = await screen.findByTestId("funnel-table");
    expect(cap.body).toEqual({ FromDate: daysAgo(29), ToDate: today, DateBasis: "created", GroupBy: "source", BranchId: null, OwnerId: null, SourceId: null, ProductId: null });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("Created");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("1,234");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("12.5%");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Source", "Created"]);
    expect(within(table).getByText("Website")).toBeInTheDocument();
    expect(screen.getByTestId("trend-area-legend-Created")).toBeInTheDocument();
  });

  it("reads filters from the URL and reposts on a preset / GroupBy change", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage("/reports/funnel?groupBy=owner&basis=closed&BranchId=2");
    const table = await screen.findByTestId("funnel-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner", DateBasis: "closed", BranchId: 2 });
    // optById compares with ===, so a string id off the URL would post correctly
    // and still leave the picker reading "All branches" — invisible otherwise.
    expect(screen.getByTestId("report-BranchId-input")).toHaveValue("SOUTH EXTENSION");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Owner");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("report-preset-7d"));
    await waitFor(() => expect(cap.body).toMatchObject({ FromDate: daysAgo(6), ToDate: today, GroupBy: "owner" }));
    await user.click(screen.getByTestId("report-groupby-source"));
    await waitFor(() => expect(cap.body).toMatchObject({ GroupBy: "source", DateBasis: "closed" }));
  });

  it("custom preset shows two date fields and posts what is entered", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage();
    await screen.findByTestId("funnel-table");
    await userEvent.setup().click(screen.getByTestId("report-preset-custom"));
    fireEvent.change(screen.getByTestId("report-from"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByTestId("report-to"), { target: { value: "2026-08-31" } });
    await waitFor(() => expect(cap.body).toMatchObject({ FromDate: "2026-08-01", ToDate: "2026-08-31" }));
  });

  it("narrows on an owner from the assignable roster and on a basis", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage();
    await screen.findByTestId("funnel-table");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("report-OwnerId-input"));
    await user.click(await screen.findByRole("option", { name: "Amit Singh" }));
    await waitFor(() => expect(cap.body).toMatchObject({ OwnerId: 17 }));
    await user.click(screen.getByTestId("report-basis-input"));
    await user.click(await screen.findByRole("option", { name: "Activity" }));
    await waitFor(() => expect(cap.body).toMatchObject({ OwnerId: 17, DateBasis: "activity" }));
  });

  it("row click navigates to the Leads list pre-filtered by the row's group and the range", async () => {
    mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage("/reports/funnel?preset=custom&from=2026-08-01&to=2026-08-31");
    const table = await screen.findByTestId("funnel-table");
    await userEvent.setup().click(within(table).getByText("Website"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?from=2026-08-01&to=2026-08-31&SourceId=11");
  });

  it("honours a custom drill and a disabled one", async () => {
    mockReportEndpoints("/api/reports/funnel", DATA);
    const { unmount } = renderPage("/reports/funnel", { drill: (row, f) => `/custom/${row.GroupKey}/${f.groupBy}` });
    let table = await screen.findByTestId("funnel-table");
    await userEvent.setup().click(within(table).getByText("Website"));
    expect(mockNavigate).toHaveBeenCalledWith("/custom/11/source");
    unmount();

    mockNavigate.mockClear();
    renderPage("/reports/funnel", { drill: null });
    table = await screen.findByTestId("funnel-table");
    expect(within(table).queryAllByTestId("funnel-table-row")).toHaveLength(0);
  });

  it("exports the table as a CSV blob", async () => {
    mockReportEndpoints("/api/reports/funnel", DATA);
    const createURL = vi.fn(() => "blob:report");
    const revoke = vi.fn();
    const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createURL;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      renderPage();
      await screen.findByTestId("funnel-table");
      await userEvent.setup().click(screen.getByTestId("report-export"));
      expect(createURL).toHaveBeenCalledTimes(1);
      const blob = createURL.mock.calls[0][0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("text/csv;charset=utf-8");
      // Pins both the GroupBy-label header rule and the raw-not-formatted choice
      // (Excel gets a summable 700, not "₹700").
      expect(await readBlob(blob)).toBe("Source,Created\nWebsite,700\nReferral,534");
      expect(click).toHaveBeenCalledTimes(1);
      // Revoke is deferred a tick so Firefox/Safari do not cancel the download.
      await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:report"));
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it("hides the basis picker, GroupBy tabs and KPI strip when a report has none", async () => {
    mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage("/reports/funnel", { dateBases: [{ value: "created", label: "Created" }], groupBys: [GROUP_BYS[0]], kpis: [], trend: null });
    await screen.findByTestId("funnel-table");
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(screen.queryByTestId("report-groupby")).toBeNull();
    expect(screen.queryByTestId("report-kpis")).toBeNull();
    expect(screen.queryByTestId("trend-area")).toBeNull();
  });

  it("uses the page's own default basis and refuses one its picker does not offer", async () => {
    const BASES = [{ value: "closed", label: "Closed" }];
    // No basis in the URL -> the page's default, not the module's "created".
    const cap = mockReportEndpoints("/api/reports/funnel", DATA);
    const { unmount } = renderPage("/reports/funnel", { dateBases: BASES });
    await screen.findByTestId("funnel-table");
    expect(cap.body).toMatchObject({ DateBasis: "closed" });
    unmount();

    // A hand-typed basis the picker cannot produce would change the numbers
    // while hiding the control that shows why, so it falls back.
    const cap2 = mockReportEndpoints("/api/reports/funnel", DATA);
    renderPage("/reports/funnel?basis=activity", { dateBases: BASES });
    await screen.findByTestId("funnel-table");
    expect(cap2.body).toMatchObject({ DateBasis: "closed" });
  });

  it("shows the empty state with no rows and disables export", async () => {
    mockReportEndpoints("/api/reports/funnel", reportData());
    renderPage();
    expect(await screen.findByTestId("funnel-empty")).toBeInTheDocument();
    expect(screen.getByTestId("report-export")).toBeDisabled();
  });

  it("shows the error state on a failed request", async () => {
    mockReportEndpoints("/api/reports/funnel", reportData());
    server.use(http.post("*/api/reports/funnel", () => HttpResponse.json({ success: false, message: "boom" }, { status: 500 })));
    renderPage();
    expect(await screen.findByTestId("funnel-error")).toBeInTheDocument();
  });
});
