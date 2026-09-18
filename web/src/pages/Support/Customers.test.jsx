// web/src/pages/Support/Customers.test.jsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

const FIXTURE_CUSTOMERS = [
  { Id: 3, Name: "Acme Corp", ContactPerson: "Gurpreet", Mobile: "9990001111", City: "Pune", OpenTickets: 1, TotalTickets: 3, LastTicketAt: "2026-09-15T10:00:00Z" },
];
vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: { data: FIXTURE_CUSTOMERS } },
    data: FIXTURE_CUSTOMERS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: 1,
  })),
}));
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => <div key={row.Id} data-testid={`customer-row-${row.Id}`}>{row.Name}</div>)}
    </div>
  ),
}));
vi.mock("./CustomerFormModal", () => ({
  __esModule: true,
  default: ({ open, customer }) => (open ? <div data-testid="customer-form-modal">{customer?.Id ?? "new"}</div> : null),
}));
vi.mock("./CustomerDetailModal", () => ({
  __esModule: true,
  default: ({ open, customerId, onEdit }) =>
    open ? (
      <div data-testid="customer-detail-modal">
        <span>customer:{customerId}</span>
        <button type="button" onClick={() => onEdit({ Id: customerId, Name: "Acme Corp" })}>edit-from-detail</button>
      </div>
    ) : null,
}));

import Customers from "./Customers";
import useServerTable from "../../hooks/useServerTable";

const renderPage = (route) => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={route ? [route] : undefined}><Customers /></MemoryRouter></QueryClientProvider></ThemeProvider>,
);
const lastCfg = () => useServerTable.mock.calls.at(-1)[0];
const cellOf = (key) => lastCfg().columns.find((c) => c.accessorKey === key).Cell;
const withTheme = (node) => render(<ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>);

describe("Customers page", () => {
  beforeEach(() => { useServerTable.mockClear(); });

  it("wires useServerTable to fetchCustomers with the spec columns, keyed by Id", () => {
    renderPage();
    const cfg = lastCfg();
    expect(cfg.endpoint).toBe("/api/customers/fetchCustomers");
    expect(cfg.dataKey).toBe("customers");
    expect(cfg.queryKey).toBe("customers");
    expect(cfg.getRowId({ Id: 3 })).toBe(3);
    expect(cfg.columns.map((c) => c.accessorKey)).toEqual([
      "Name", "ContactPerson", "Mobile", "City", "OpenTickets", "TotalTickets", "LastTicketAt",
    ]);
    expect(screen.getByTestId("customer-row-3")).toHaveTextContent("Acme Corp");
  });

  it("renders the cells with readable fallbacks", () => {
    renderPage();
    expect(cellOf("ContactPerson")({ cell: { getValue: () => null } })).toBe("—");
    expect(cellOf("Mobile")({ cell: { getValue: () => "9990001111" } })).toBe("9990001111");
    expect(cellOf("City")({ cell: { getValue: () => null } })).toBe("—");
    expect(cellOf("TotalTickets")({ cell: { getValue: () => null } })).toBe(0);
    expect(cellOf("LastTicketAt")({ cell: { getValue: () => "2026-09-15T10:00:00Z" } })).toBe("15-09-2026");
    expect(cellOf("LastTicketAt")({ cell: { getValue: () => null } })).toBe("—");

    withTheme(cellOf("OpenTickets")({ cell: { getValue: () => 2 } }));
    expect(screen.getByTestId("open-count-chip")).toHaveTextContent("2");
    withTheme(cellOf("OpenTickets")({ cell: { getValue: () => 0 } }));
    expect(screen.getAllByTestId("open-count-chip")[1]).toHaveTextContent("0");
  });

  it("New Customer opens the form; a row click opens the detail modal", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-customer-btn"));
    expect(screen.getByTestId("customer-form-modal")).toHaveTextContent("new");

    lastCfg().muiTableBodyRowProps({ row: { original: { Id: 3 } } }).onClick();
    expect(await screen.findByTestId("customer-detail-modal")).toHaveTextContent("customer:3");
  });

  it("row actions: the eye opens the detail, the pencil opens the editor with the row", async () => {
    renderPage();
    withTheme(lastCfg().renderRowActions({ row: { original: FIXTURE_CUSTOMERS[0] } }));
    const user = userEvent.setup();
    expect(screen.getByTestId("view-customer-3")).toHaveAttribute("data-tone", "primary");
    await user.click(screen.getByTestId("view-customer-3"));
    expect(await screen.findByTestId("customer-detail-modal")).toHaveTextContent("customer:3");
    await user.click(screen.getByTestId("edit-customer-3"));
    expect(await screen.findByTestId("customer-form-modal")).toHaveTextContent("3");
  });

  // TicketDetail's "N previous complaints" link lands here with the id in the URL.
  it("?customerId= opens that customer's detail on mount, and Edit from there swaps to the form", async () => {
    renderPage("/support/customers?customerId=3");
    expect(screen.getByTestId("customer-detail-modal")).toHaveTextContent("customer:3");
    await userEvent.setup().click(screen.getByText("edit-from-detail"));
    expect(screen.queryByTestId("customer-detail-modal")).toBeNull();
    expect(screen.getByTestId("customer-form-modal")).toHaveTextContent("3");
  });

  it("ignores a non-numeric customerId", () => {
    renderPage("/support/customers?customerId=abc");
    expect(screen.queryByTestId("customer-detail-modal")).toBeNull();
  });
});
