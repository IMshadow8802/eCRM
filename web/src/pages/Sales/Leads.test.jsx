import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

const FIXTURE_LEADS = [
  { Id: 101, Name: "Acme Corp", MobileNo: "9990001111", City: "Pune", StatusName: "Contacted", StatusCode: "open",
    ProductName: "TV 43in", OwnerName: "Bob", EstValue: 50000, NextFollowupDate: "2026-07-10", IsOverdue: true },
];
let rowSelection = {};
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));
vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: { data: FIXTURE_LEADS }, getState: () => ({ rowSelection }), resetRowSelection: vi.fn() },
    data: FIXTURE_LEADS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: 1,
  })),
}));
vi.mock("../../hooks", () => ({
  useUsers: vi.fn(() => ({ data: { users: [{ Id: 2, Username: "bob", FullName: "Bob" }] } })),
  useConfirmation: vi.fn(() => ({ confirmationState: { open: false }, showConfirmation: vi.fn(), hideConfirmation: vi.fn(), handleConfirm: vi.fn(), confirmDelete: vi.fn() })),
}));
vi.mock("../../hooks/useLookups", () => ({
  useLookups: vi.fn((kind) => ({
    lookups: kind === "lead_status"
      ? [{ Id: 11, Value: "New", Code: "open" }, { Id: 15, Value: "Lost", Code: "lost" }]
      : [{ Id: 5, Value: "Website" }],
  })),
}));
vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn((cfg) => {
    if (cfg?.endpoint === "/api/products/fetchProducts") return { data: { products: [{ Id: 2, Name: "TV 43in" }] } };
    if (cfg?.endpoint === "/api/users/fetchBranches") return { data: { branches: [{ Id: 2, BranchName: "Pune" }] } };
    return { data: {} };
  }),
}));
vi.mock("../../stores/useAuthStore", () => ({ __esModule: true, default: (sel) => sel({ user: { UserId: 7 }, UserId: 7 }) }));
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => <div key={row.Id} data-testid={`lead-row-${row.Id}`}>{row.Name}</div>)}
    </div>
  ),
}));
vi.mock("./TransferLeadModal", () => ({ __esModule: true, default: vi.fn(({ open, leadIds }) => (open ? <div data-testid="transfer-modal">{leadIds.join(",")}</div> : null)) }));

import Leads from "./Leads";
import useServerTable from "../../hooks/useServerTable";

const renderPage = () => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}><MemoryRouter><Leads /></MemoryRouter></QueryClientProvider></ThemeProvider>,
);
const lastCfg = () => useServerTable.mock.calls.at(-1)[0];
const lastExtraParams = () => lastCfg().extraParams;
const cellOf = (key) => lastCfg().columns.find((c) => c.accessorKey === key).Cell;

describe("Leads page (spec 1)", () => {
  beforeEach(() => { rowSelection = {}; useServerTable.mockClear(); mockNavigate.mockClear(); });

  it("renders presets and the five filters", () => {
    renderPage();
    for (const p of ["All", "My leads", "Overdue", "Unassigned", "Lost"]) expect(screen.getByRole("tab", { name: p })).toBeInTheDocument();
    for (const id of ["filter-status", "filter-product", "filter-owner", "filter-source", "filter-branch"]) expect(screen.getByTestId(`${id}-input`)).toBeInTheDocument();
    expect(lastExtraParams()).toEqual({ StatusId: null, ProductId: null, OwnerId: null, SourceId: null, BranchId: null });
  });

  it("Overdue preset sends Overdue:true; My leads sends the caller's OwnerId", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Overdue" }));
    expect(lastExtraParams()).toMatchObject({ Overdue: true });
    await user.click(screen.getByRole("tab", { name: "My leads" }));
    expect(lastExtraParams()).toMatchObject({ OwnerId: 7 });
  });

  it("status column shows the label the SP returned", () => {
    renderPage();
    const col = useServerTable.mock.calls.at(-1)[0].columns.find((c) => c.accessorKey === "StatusName");
    expect(col).toBeTruthy();
    expect(useServerTable.mock.calls.at(-1)[0].columns.some((c) => c.accessorKey === "StageId")).toBe(false);
  });

  it("shows Reassign only with a selection and hands the ids to the modal", async () => {
    rowSelection = { 101: true, 102: true };
    renderPage();
    const btn = screen.getByTestId("bulk-reassign-btn");
    expect(btn).toHaveTextContent("Reassign 2");
    await userEvent.setup().click(btn);
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("101,102");

    // The ids above are only lead ids because the table is keyed by Id. Drop
    // getRowId and MRT keys selection by row index, so this would post [0,1].
    expect(lastCfg().getRowId({ Id: 101 })).toBe(101);
    expect(lastCfg().enableRowSelection).toBe(true);
  });

  it("hides Reassign with nothing selected", () => {
    renderPage();
    expect(screen.queryByTestId("bulk-reassign-btn")).toBeNull();
  });

  // --- coverage of the cell renderers + row wiring (MRT itself is mocked) ---

  it("narrows on a filter without losing the other four", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("filter-product-input"));
    await user.click(await screen.findByRole("option", { name: "TV 43in" }));
    expect(lastExtraParams()).toEqual({ StatusId: null, ProductId: 2, OwnerId: null, SourceId: null, BranchId: null });
  });

  it("renders the server labels and their empty fallbacks", () => {
    renderPage();
    const theme = buildTheme("light");
    const withTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

    expect(cellOf("Company")({ cell: { getValue: () => null } })).toBe("—");
    expect(cellOf("City")({ cell: { getValue: () => "Pune" } })).toBe("Pune");
    expect(cellOf("ProductName")({ cell: { getValue: () => null } })).toBe("—");
    expect(cellOf("OwnerName")({ cell: { getValue: () => null } })).toBe("Unassigned");
    expect(cellOf("EstValue")({ cell: { getValue: () => 50000 } })).toContain("50,000");

    withTheme(cellOf("StatusName")({ row: { original: { StatusName: "New", StatusCode: "open" } } }));
    expect(screen.getByText("New")).toBeInTheDocument();
    withTheme(cellOf("StatusName")({ row: { original: {} } }));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    const { container } = withTheme(
      cellOf("NextFollowupDate")({ row: { original: { IsOverdue: true } }, cell: { getValue: () => "2026-07-10" } })
    );
    expect(container.querySelector("span")).toHaveTextContent("10-07-2026");
    expect(container.querySelector("span").style.fontWeight).toBe("600");
    const onTime = withTheme(
      cellOf("NextFollowupDate")({ row: { original: { IsOverdue: false } }, cell: { getValue: () => null } })
    );
    expect(onTime.container.querySelector("span").style.fontWeight).toBe("");
  });

  it("row click navigates to the lead detail and row actions open the modals", async () => {
    renderPage();
    const cfg = lastCfg();
    cfg.muiTableBodyRowProps({ row: { original: { Id: 42 } } }).onClick();
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/42");

    render(
      <ThemeProvider theme={buildTheme("light")}>
        {cfg.renderRowActions({ row: { original: FIXTURE_LEADS[0] } })}
      </ThemeProvider>
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("transfer-lead-101"));
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("101");
    await user.click(screen.getByTestId("delete-lead-101"));
    expect(await screen.findByTestId("delete-lead-modal")).toBeInTheDocument();
    await user.click(screen.getByTestId("edit-lead-101"));
    expect(await screen.findByTestId("lead-create-modal")).toBeInTheDocument();
  });

  it("New Lead opens the create modal", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByTestId("new-lead-btn"));
    expect(await screen.findByTestId("lead-create-modal")).toBeInTheDocument();
  });
});
