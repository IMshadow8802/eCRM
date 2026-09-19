import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../../theme";

// Reads the router's own location.search, not the component's props/state —
// proof that a filter change actually lands in the URL rather than staying
// in memory only the component can see.
const LocationProbe = () => <div data-testid="probe">{useLocation().search}</div>;

vi.mock("../../../components/ui/DateField", () => import("../../../test/DateFieldStub"));

const ROWS = [{ Id: 4, QuoteNo: "QT-2627-0042", Revision: 1, Status: "final", LeadId: 9, LeadName: "Ramesh Patel", ToName: "Ramesh Patel", OwnerName: "Amit", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", GrandTotal: 302400, IsExpired: true }];
vi.mock("../../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({ table: { __options: { data: ROWS } }, data: ROWS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: 1 })),
}));
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => <div data-testid="mrt-root">{(table?.__options?.data ?? []).map((r) => <div key={r.Id}>{r.QuoteNo}</div>)}</div>,
}));
vi.mock("../../../hooks", () => ({ useUsers: vi.fn(() => ({ data: { users: [{ Id: 2, FullName: "Amit" }] } })) }));
vi.mock("../../../hooks/useApiQuery", () => ({ useApiQuery: vi.fn(() => ({ data: { branches: [{ Id: 1, BranchName: "HEAD OFFICE" }] } })) }));

import QuotationList from "./QuotationList";
import useServerTable from "../../../hooks/useServerTable";
import { useUsers } from "../../../hooks";
import { useApiQuery } from "../../../hooks/useApiQuery";

const draw = (path = "/sales/quotations") => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes><Route path="/sales/quotations" element={<QuotationList />} /><Route path="/sales/quotations/:id" element={<div data-testid="builder" />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider></ThemeProvider>,
);
const cfg = () => useServerTable.mock.calls.at(-1)[0];
const cell = (key, row = ROWS[0]) => render(<ThemeProvider theme={buildTheme("light")}>{cfg().columns.find((c) => c.accessorKey === key).Cell({ row: { original: row }, cell: { getValue: () => row[key] } })}</ThemeProvider>);

beforeEach(() => useServerTable.mockClear());

describe("QuotationList", () => {
  it("wires useServerTable to fetchQuotations with the list columns", () => {
    draw();
    expect(cfg()).toMatchObject({ endpoint: "/api/quotations/fetchQuotations", dataKey: "quotations", queryKey: "quotations" });
    expect(cfg().columns.map((c) => c.accessorKey)).toEqual(["QuoteNo", "LeadName", "OwnerName", "QuoteDate", "ValidTill", "GrandTotal", "Status"]);
    expect(cfg().getRowId({ Id: 4 })).toBe(4);
    expect(screen.getByText("QT-2627-0042")).toBeInTheDocument();
  });

  it("labels every filter — a date picker draws its own mask and ignores a placeholder", () => {
    draw();
    for (const label of ["Status", "Owner", "Branch", "From", "To"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it("sends the chosen filters, and nothing for the ones left alone — and writes them into the URL, not just memory", () => {
    draw();
    expect(cfg().extraParams).toEqual({ Status: null, OwnerId: null, BranchId: null });
    expect(screen.getByTestId("probe")).toHaveTextContent("");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    expect(cfg().extraParams).toMatchObject({ FromDate: "2026-09-01" });
    expect(screen.getByTestId("probe")).toHaveTextContent("FromDate=2026-09-01");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-30" } });
    expect(cfg().extraParams).toMatchObject({ FromDate: "2026-09-01", ToDate: "2026-09-30" });
    expect(screen.getByTestId("probe")).toHaveTextContent("ToDate=2026-09-30");
    // Clearing a filter removes it from the URL too — not just from what gets sent.
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    expect(cfg().extraParams).not.toHaveProperty("FromDate");
    expect(screen.getByTestId("probe")).not.toHaveTextContent("FromDate");
  });

  // A shared link and a reload are the same case from the component's point
  // of view: a fresh mount whose URL already carries filters. Nothing here
  // interacts with a control — if this passes, the filters came from the URL
  // on the very first render, not from state the component remembered.
  it("reads filters straight off the URL on mount, so a shared link or a reload reproduces the same filtered view", () => {
    draw("/sales/quotations?Status=final&OwnerId=2&BranchId=1&FromDate=2026-09-01&ToDate=2026-09-30");
    expect(cfg().extraParams).toEqual({
      Status: "final", OwnerId: 2, BranchId: 1, FromDate: "2026-09-01", ToDate: "2026-09-30",
    });
  });

  it("opens the builder on a row click", () => {
    draw();
    // muiTableBodyRowProps().onClick() is called directly here, as a plain
    // function — not through a fired DOM event — so it bypasses React's
    // synthetic event system and the auto-act-wrapping that gives it.
    // LeadQuotations.test.jsx drives the equivalent navigation with
    // fireEvent.click on a real element, which IS auto-wrapped; the fix here
    // is the same wrapping, done explicitly, not a switch to an async query
    // that merely outlasts the unflushed update.
    act(() => { cfg().muiTableBodyRowProps({ row: { original: ROWS[0] } }).onClick(); });
    expect(screen.getByTestId("builder")).toBeInTheDocument();
  });

  it("renders a draft's missing number, money, and an expired quotation readably", () => {
    draw();
    cell("QuoteNo", { ...ROWS[0], QuoteNo: null, Revision: 2 }); expect(screen.getByText(/draft · revision 2/i)).toBeInTheDocument();
    cell("GrandTotal"); expect(screen.getByText("₹3,02,400.00")).toBeInTheDocument();
    cell("ValidTill"); expect(screen.getByText(/expired/i)).toBeInTheDocument();
    cell("Status"); expect(screen.getByText("Final")).toBeInTheDocument();
  });

  it("falls back cleanly on the other side of every ternary: no company name, no owner, an unrecognised status, and a valid-till that isn't expired", () => {
    draw();
    cell("LeadName", { ...ROWS[0], ToCompany: null, LeadName: null }); expect(screen.getByText("—")).toBeInTheDocument();
    cell("OwnerName", { ...ROWS[0], OwnerName: null }); expect(screen.getByText("Unassigned")).toBeInTheDocument();
    cell("Status", { ...ROWS[0], Status: "weird_code" }); expect(screen.getByText("weird_code")).toBeInTheDocument();
    const { container } = cell("ValidTill", { ...ROWS[0], IsExpired: false });
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
    expect(container.querySelector("span").style.color).toBe("");
  });

  it("still renders the owner/branch filters when their option data hasn't loaded", () => {
    useUsers.mockReturnValueOnce({ data: undefined });
    useApiQuery.mockReturnValueOnce({ data: undefined });
    draw();
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Branch")).toBeInTheDocument();
  });
});
