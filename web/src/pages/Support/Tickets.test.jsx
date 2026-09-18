import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";

// MUI X 9's date field renders contenteditable sections jsdom cannot type
// into; the range filter needs real dates, so swap in the native stub. The
// path is the module the ui barrel itself imports, so mocking it catches the
// `from "../../components/ui"` import too.
vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

const FIXTURE_TICKETS = [
  {
    Id: 7, TicketNo: "TKT-0007", Subject: "Screen flickers on boot",
    CustomerId: 3, CustomerName: "Acme Corp", CustomerMobile: "9990001111",
    StatusId: 62, StatusName: "In Progress", StatusCode: "open",
    Priority: 3, PriorityName: "High", CategoryName: "Billing", ChannelName: "Phone",
    AssignedTo: 17, AssigneeName: "Amit Singh", DueAt: "2026-09-16T10:00:00Z", IsOverdue: 1,
    AgeHours: 30, EscalatedTo: 16, EscalatedToName: "Neha Verma",
  },
];
let rowSelection = {};

vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: { data: FIXTURE_TICKETS }, getState: () => ({ rowSelection }), resetRowSelection: vi.fn() },
    data: FIXTURE_TICKETS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: 1,
  })),
}));
vi.mock("../../hooks", () => ({
  useUsers: vi.fn(() => ({ data: { users: [{ Id: 17, Username: "se_ho_amit", FullName: "Amit Singh" }] } })),
  useConfirmation: vi.fn(() => ({ confirmationState: { open: false }, showConfirmation: vi.fn(), hideConfirmation: vi.fn(), handleConfirm: vi.fn(), confirmDelete: vi.fn() })),
}));
vi.mock("../../hooks/useLookups", () => ({
  useLookups: vi.fn((kind) => ({
    lookups: {
      ticket_status: [{ Id: 62, Value: "In Progress", Code: "open" }, { Id: 65, Value: "Closed", Code: "closed" }],
      priority: [{ Id: 3, Value: "High", TatHours: 24 }],
      ticket_category: [{ Id: 6, Value: "Billing" }],
      ticket_channel: [{ Id: 71, Value: "Phone" }],
    }[kind] ?? [],
  })),
}));
vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn((cfg) => {
    if (cfg?.endpoint === "/api/products/fetchProducts") return { data: { products: [{ Id: 1, Name: "Gold Chain 22K" }] } };
    if (cfg?.endpoint === "/api/users/fetchBranches") return { data: { branches: [{ Id: 2, BranchName: "SOUTH EXTENSION" }] } };
    return { data: {} };
  }),
}));
vi.mock("../../stores/useAuthStore", () => ({ __esModule: true, default: (sel) => sel({ user: { UserId: 17 }, UserId: 17 }) }));
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => <div key={row.Id} data-testid={`ticket-row-${row.Id}`}>{row.TicketNo}</div>)}
    </div>
  ),
}));
vi.mock("./TicketDetailModal", () => ({ __esModule: true, default: ({ open, ticketId }) => (open ? <div data-testid="ticket-detail-modal">ticket:{ticketId}</div> : null) }));
vi.mock("./TicketCreateModal", () => ({ __esModule: true, default: ({ open, ticket }) => (open ? <div data-testid="ticket-form-modal">{ticket?.Id ?? "new"}</div> : null) }));
vi.mock("./TransferTicketModal", () => ({ __esModule: true, default: ({ open, ticketIds }) => (open ? <div data-testid="transfer-ticket-modal">{ticketIds.join(",")}</div> : null) }));
vi.mock("./DeleteTicketModal", () => ({ __esModule: true, default: ({ open, ticketId }) => (open ? <div data-testid="delete-ticket-modal">delete:{ticketId}</div> : null) }));

import Tickets from "./Tickets";
import useServerTable from "../../hooks/useServerTable";

const renderPage = (route) => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={route ? [route] : undefined}><Tickets /></MemoryRouter></QueryClientProvider></ThemeProvider>,
);
const lastCfg = () => useServerTable.mock.calls.at(-1)[0];
const lastParams = () => lastCfg().extraParams;
const columnOf = (key) => lastCfg().columns.find((c) => c.accessorKey === key || c.id === key);
const withTheme = (node) => render(<ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>);
const EMPTY_FILTERS = {
  StatusId: null, Priority: null, CategoryId: null, ChannelId: null, ProductId: null, AssignedTo: null, BranchId: null,
};

describe("Tickets list (spec 2)", () => {
  beforeEach(() => {
    rowSelection = {};
    useServerTable.mockClear();
  });

  it("renders the eight presets, the seven filters and the range, and lands on My team", () => {
    renderPage();
    for (const label of ["My queue", "My team", "Unassigned", "Overdue", "Escalated", "On hold", "Closed", "All"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    for (const id of ["filter-status", "filter-priority", "filter-category", "filter-channel", "filter-product", "filter-assignee", "filter-branch"]) {
      expect(screen.getByTestId(`${id}-input`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("tickets-from")).toBeInTheDocument();
    expect(screen.getByTestId("tickets-to")).toBeInTheDocument();
    // Default tab = My team: every active complaint in the caller's scope.
    expect(screen.getByRole("tab", { name: "My team" })).toHaveAttribute("aria-selected", "true");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, StatusCode: "active" });
    expect(lastCfg().endpoint).toBe("/api/tickets/fetchTickets");
    expect(lastCfg().dataKey).toBe("tickets");
    expect(lastCfg().getRowId({ Id: 7 })).toBe(7);
    expect(screen.getByTestId("ticket-row-7")).toHaveTextContent("TKT-0007");
  });

  // Spec §4 + §6: the presets ARE the query — each one maps onto
  // sp_FetchTickets params, and nothing else on the page changes.
  it("maps every preset onto the fetchTickets params", async () => {
    renderPage();
    const user = userEvent.setup();
    const tab = (name) => user.click(screen.getByRole("tab", { name }));

    await tab("My queue");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, AssignedTo: 17, StatusCode: "active" });
    await tab("Unassigned");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, Unassigned: 1, StatusCode: "active" });
    await tab("Overdue");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, Overdue: 1 });
    await tab("Escalated");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, Escalated: 1 });
    await tab("On hold");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, StatusCode: "onhold" });
    await tab("Closed");
    expect(lastParams()).toEqual({ ...EMPTY_FILTERS, StatusCode: "closed" });
    await tab("All");
    expect(lastParams()).toEqual(EMPTY_FILTERS);
  });

  it("narrows on a filter and a date without losing the preset or the other filters", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("filter-priority-input"));
    await user.click(await screen.findByRole("option", { name: "High" }));
    await user.click(screen.getByTestId("filter-branch-input"));
    await user.click(await screen.findByRole("option", { name: "SOUTH EXTENSION" }));
    fireEvent.change(screen.getByTestId("tickets-from"), { target: { value: "2026-09-01" } });

    expect(lastParams()).toEqual({
      ...EMPTY_FILTERS, Priority: 3, BranchId: 2, FromDate: "2026-09-01", StatusCode: "active",
    });
  });

  it("seeds the preset, the filters and the range from the URL", () => {
    renderPage("/support/tickets?Escalated=1&Priority=3&CategoryId=6&from=2026-09-01&to=2026-09-16");
    expect(screen.getByRole("tab", { name: "Escalated" })).toHaveAttribute("aria-selected", "true");
    expect(lastParams()).toEqual({
      ...EMPTY_FILTERS, Priority: 3, CategoryId: 6, FromDate: "2026-09-01", ToDate: "2026-09-16", Escalated: 1,
    });
    // Numeric ids, not strings: the Combobox compares options with ===, so a
    // string would post the filter while the input showed its placeholder.
    expect(screen.getByTestId("filter-priority-input")).toHaveValue("High");
    expect(screen.getByTestId("tickets-from")).toHaveValue("2026-09-01");
  });

  it("renders the spec's columns, with the customer's mobile under their name", () => {
    renderPage();
    expect(lastCfg().columns.map((c) => c.accessorKey ?? c.id)).toEqual([
      "TicketNo", "Subject", "CustomerName", "StatusName", "PriorityName", "DueAt", "AssigneeName", "escalated", "AgeHours",
    ]);
    const row = { original: FIXTURE_TICKETS[0] };
    const { container } = withTheme(columnOf("CustomerName").Cell({ row }));
    expect(container).toHaveTextContent("Acme Corp");
    expect(container).toHaveTextContent("9990001111");
  });

  // Spec §2: overdue is computed on read and must be visible at a glance —
  // this is the whole reason the column is relative rather than a date.
  it("an overdue row reads 'overdue' in the error tone; an on-time one does not", () => {
    renderPage();
    const Cell = columnOf("DueAt").Cell;
    const over = withTheme(Cell({ row: { original: FIXTURE_TICKETS[0] } }));
    const overSpan = over.container.querySelector("span");
    expect(overSpan).toHaveTextContent("overdue");
    // fontWeight, not colour: jsdom normalises an inline hex to rgb(), so
    // comparing with the raw token fails (Leads.test.jsx does the same).
    expect(overSpan.style.fontWeight).toBe("600");

    const onTime = withTheme(Cell({ row: { original: { Id: 8, DueAt: "2099-01-01T10:00:00Z", IsOverdue: 0 } } }));
    expect(onTime.container.querySelector("span").style.fontWeight).toBe("");
    const none = withTheme(Cell({ row: { original: { Id: 9, DueAt: null, IsOverdue: 0 } } }));
    expect(none.container).toHaveTextContent("—");
  });

  it("tones the status chip by its code and falls back readably everywhere else", () => {
    renderPage();
    withTheme(columnOf("StatusName").Cell({ row: { original: FIXTURE_TICKETS[0] } }));
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    withTheme(columnOf("StatusName").Cell({ row: { original: { StatusName: null, StatusCode: null } } }));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    expect(columnOf("Subject").Cell({ cell: { getValue: () => null } })).toBe("—");
    expect(columnOf("AssigneeName").Cell({ cell: { getValue: () => null } })).toBe("Unassigned");
    expect(columnOf("AgeHours").Cell({ cell: { getValue: () => 5 } })).toBe("5h");
    expect(columnOf("AgeHours").Cell({ cell: { getValue: () => 30 } })).toBe("1d");
    expect(columnOf("AgeHours").Cell({ cell: { getValue: () => null } })).toBe("—");

    withTheme(columnOf("escalated").Cell({ row: { original: FIXTURE_TICKETS[0] } }));
    expect(screen.getByTestId("ticket-escalated-7")).toBeInTheDocument();
    const plain = withTheme(columnOf("escalated").Cell({ row: { original: { Id: 8, EscalatedTo: null } } }));
    expect(plain.container).toHaveTextContent("—");
  });

  it("shows Reassign only with a selection and hands the ids to the transfer modal", async () => {
    rowSelection = { 7: true, 8: true };
    renderPage();
    const btn = screen.getByTestId("bulk-reassign-btn");
    expect(btn).toHaveTextContent("Reassign 2");
    await userEvent.setup().click(btn);
    expect(screen.getByTestId("transfer-ticket-modal")).toHaveTextContent("7,8");
    // Only ticket ids because the table is keyed by Id — without getRowId MRT
    // keys selection by row index and this would post [0,1].
    expect(lastCfg().enableRowSelection).toBe(true);
  });

  it("hides Reassign with nothing selected", () => {
    renderPage();
    expect(screen.queryByTestId("bulk-reassign-btn")).toBeNull();
  });

  it("a row click opens the detail modal; the row actions open the rest", async () => {
    renderPage();
    lastCfg().muiTableBodyRowProps({ row: { original: { Id: 7 } } }).onClick();
    expect(await screen.findByTestId("ticket-detail-modal")).toHaveTextContent("ticket:7");

    withTheme(lastCfg().renderRowActions({ row: { original: FIXTURE_TICKETS[0] } }));
    const user = userEvent.setup();
    expect(screen.getByTestId("view-ticket-7")).toHaveAttribute("data-tone", "primary");
    expect(screen.getByTestId("edit-ticket-7")).toHaveAttribute("data-tone", "info");
    expect(screen.getByTestId("transfer-ticket-7")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("delete-ticket-7")).toHaveAttribute("data-tone", "error");

    await user.click(screen.getByTestId("edit-ticket-7"));
    expect(await screen.findByTestId("ticket-form-modal")).toHaveTextContent("7");
    await user.click(screen.getByTestId("transfer-ticket-7"));
    expect(screen.getByTestId("transfer-ticket-modal")).toHaveTextContent("7");
    await user.click(screen.getByTestId("delete-ticket-7"));
    expect(screen.getByTestId("delete-ticket-modal")).toHaveTextContent("delete:7");
  });

  it("New Ticket opens the blank form", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByTestId("new-ticket-btn"));
    expect(await screen.findByTestId("ticket-form-modal")).toHaveTextContent("new");
  });

  it("asks the server for nothing about stages any more", () => {
    renderPage();
    expect(JSON.stringify(lastCfg())).not.toContain("Stage");
  });
});
