import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

import dayjs from "dayjs";

const daysAgo = (n) => dayjs().subtract(n, "day").format("YYYY-MM-DDTHH:mm:ss");
const FIXTURE_LEADS = [
  { Id: 101, Name: "Acme Corp", MobileNo: "9990001111", StatusName: "Contacted", StatusCode: "open",
    ProductName: "TV 43in", OwnerName: "Bob", EstValue: 50000, NextFollowupDate: "2026-07-10", IsOverdue: true,
    CreatedAt: daysAgo(20), LastActivityAt: daysAgo(8) },
  { Id: 102, Name: "Zen Ltd", MobileNo: "9990002222", StatusName: "Won", StatusCode: "converted",
    EstValue: 9000, WonValue: 9000, CreatedAt: daysAgo(30), LastActivityAt: null },
];
let rowSelection = {};
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));
// The real hook, spied: its config is inspected, and the request it builds
// (sort keys included) reaches useApiQuery below.
vi.mock("../../hooks/useServerTable", async (importOriginal) => {
  const real = (await importOriginal()).default;
  return {
    __esModule: true,
    default: vi.fn((cfg) => {
      const out = real(cfg);
      return { ...out, table: { ...out.table, getState: () => ({ ...out.table.getState(), rowSelection }) } };
    }),
  };
});
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
    if (cfg?.endpoint === "/api/leads/fetchLeads") return { data: { leads: FIXTURE_LEADS, pagination: { totalRecords: 2 } }, isLoading: false, isFetching: false };
    if (cfg?.endpoint === "/api/products/fetchProducts") return { data: { products: [{ Id: 2, Name: "TV 43in" }] } };
    if (cfg?.endpoint === "/api/partners/fetchPartners") return { data: { partners: [{ Id: 3, Name: "Sharma Traders" }] } };
    if (cfg?.endpoint === "/api/users/fetchBranches") return { data: { branches: [{ Id: 2, BranchName: "Pune" }] } };
    return { data: {} };
  }),
}));
let mockAccess = null;
vi.mock("../../stores/useAuthStore", () => ({ __esModule: true, default: (sel) => sel({ user: { UserId: 7 }, UserId: 7, access: mockAccess }) }));
vi.mock("./TransferLeadModal", () => ({ __esModule: true, default: vi.fn(({ open, leadIds }) => (open ? <div data-testid="transfer-modal">{leadIds.join(",")}</div> : null)) }));

import Leads from "./Leads";
import TransferLeadModal from "./TransferLeadModal";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useLocation } from "react-router-dom";

const LocationProbe = () => <div data-testid="location">{useLocation().search}</div>;

const renderPage = (route) => render(
  <ThemeProvider theme={buildTheme("light")}><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={route ? [route] : undefined}><Leads /><LocationProbe /></MemoryRouter></QueryClientProvider></ThemeProvider>,
);
const lastCfg = () => useServerTable.mock.calls.at(-1)[0];
const lastExtraParams = () => lastCfg().extraParams;
const lastLeadsBody = () => useApiQuery.mock.calls.filter(([c]) => c?.endpoint === "/api/leads/fetchLeads").at(-1)[0].params;
const search = () => new URLSearchParams(screen.getByTestId("location").textContent);
const cellOf = (key) => lastCfg().columns.find((c) => c.accessorKey === key).Cell;

describe("Leads page (spec 1)", () => {
  beforeEach(() => { rowSelection = {}; useServerTable.mockClear(); useApiQuery.mockClear(); mockNavigate.mockClear(); });

  it("renders presets and the five filters", () => {
    renderPage();
    for (const p of ["All", "My leads", "Overdue", "Unassigned", "Lost"]) expect(screen.getByRole("tab", { name: p })).toBeInTheDocument();
    for (const id of ["filter-status", "filter-product", "filter-owner", "filter-source", "filter-partner", "filter-branch"]) expect(screen.getByTestId(`${id}-input`)).toBeInTheDocument();
    expect(lastExtraParams()).toEqual({ StatusId: null, ProductId: null, OwnerId: null, SourceId: null, BranchId: null, PartnerId: null });
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

  it("canCrossBranch follows the leads reach: Own is false, Office is true", () => {
    mockAccess = { isAdmin: false, modules: { leads: { view: true, reach: "Own" } } };
    renderPage();
    expect(TransferLeadModal.mock.calls.at(-1)[0].canCrossBranch).toBe(false);
    mockAccess = { isAdmin: false, modules: { leads: { view: true, reach: "Office" } } };
    renderPage();
    expect(TransferLeadModal.mock.calls.at(-1)[0].canCrossBranch).toBe(true);
    mockAccess = null;
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
    expect(lastExtraParams()).toEqual({ StatusId: null, ProductId: 2, OwnerId: null, SourceId: null, BranchId: null, PartnerId: null });
  });

  it("Partner filter posts PartnerId; the URL pre-selects it", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("filter-partner-input"));
    await user.click(await screen.findByRole("option", { name: "Sharma Traders" }));
    expect(lastExtraParams()).toMatchObject({ PartnerId: 3 });
    renderPage("/sales/leads?PartnerId=3");
    expect(lastExtraParams()).toMatchObject({ PartnerId: 3 });
  });

  it("an inactive partner id in the URL shows a fallback label, not a blank filter", () => {
    renderPage("/sales/leads?PartnerId=77");
    expect(screen.getByTestId("filter-partner-input")).toHaveValue("Unknown (#77)");
    expect(lastExtraParams()).toMatchObject({ PartnerId: 77 });
  });

  it("Partner column shows PartnerName or a dash", () => {
    renderPage();
    expect(cellOf("PartnerName")({ cell: { getValue: () => "Sharma Traders" } })).toBe("Sharma Traders");
    expect(cellOf("PartnerName")({ cell: { getValue: () => null } })).toBe("—");
  });

  it("renders the server labels and their empty fallbacks", () => {
    renderPage();
    const theme = buildTheme("light");
    const withTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

    expect(cellOf("Company")({ cell: { getValue: () => null } })).toBe("—");
    expect(cellOf("ProductName")({ cell: { getValue: () => null } })).toBe("—");
    expect(cellOf("OwnerName")({ cell: { getValue: () => null } })).toBe("Unassigned");
    expect(cellOf("EstValue")({ row: { original: { StatusCode: "open", EstValue: 50000 } } })).toContain("50,000");

    withTheme(cellOf("StatusName")({ row: { original: { StatusName: "New", StatusCode: "open" } } }));
    expect(screen.getByText("New")).toBeInTheDocument();
    withTheme(cellOf("StatusName")({ row: { original: {} } }));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    const { container } = withTheme(
      cellOf("NextFollowupDate")({ row: { original: { IsOverdue: true } }, cell: { getValue: () => "2026-09-01T11:00:00" } })
    );
    expect(container.querySelector("span")).toHaveTextContent("01-09-2026 11:00");
    expect(container.querySelector("span").style.fontWeight).toBe("600");
    const onTime = withTheme(
      cellOf("NextFollowupDate")({ row: { original: { IsOverdue: false } }, cell: { getValue: () => null } })
    );
    expect(onTime.container.querySelector("span").style.fontWeight).toBe("");
  });

  // A won lead's "Value" column shows what it actually closed for, not the
  // estimate that was on it before the deal was struck.
  it("shows a converted row's WonValue instead of its EstValue", () => {
    renderPage();
    const theme = buildTheme("light");
    const { container } = render(
      <ThemeProvider theme={theme}>
        {cellOf("EstValue")({ row: { original: { StatusCode: "converted", EstValue: 50000, WonValue: 47500 } } })}
      </ThemeProvider>,
    );
    expect(container).toHaveTextContent("₹47,500.00");
    expect(container).not.toHaveTextContent(/50,000/);
  });

  it("row click navigates to the lead detail and row actions open the modals", async () => {
    renderPage();
    const cfg = lastCfg();
    cfg.muiTableBodyRowProps({ row: { original: { Id: 42 } } }).onClick();
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/42");

    // The real table draws the row actions.
    const user = userEvent.setup();
    await user.click(screen.getByTestId("transfer-lead-101"));
    expect(screen.getByTestId("transfer-modal")).toHaveTextContent("101");
    await user.click(screen.getByTestId("delete-lead-101"));
    expect(await screen.findByTestId("delete-lead-modal")).toBeInTheDocument();
    await user.click(screen.getByTestId("edit-lead-101"));
    expect(await screen.findByTestId("lead-create-modal")).toBeInTheDocument();
  });

  // Owner feedback: the row icons were four identical grey glyphs and none of
  // them said "this opens the lead". The eye leads the row; the rest are toned
  // by consequence.
  it("row actions lead with an eye into the lead and are toned by what they do", async () => {
    renderPage();
    const eye = screen.getByTestId("view-lead-101");
    expect(eye).toHaveAttribute("data-tone", "primary");
    await userEvent.setup().click(eye);
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/101");

    expect(screen.getByTestId("edit-lead-101")).toHaveAttribute("data-tone", "info");
    expect(screen.getByTestId("transfer-lead-101")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("delete-lead-101")).toHaveAttribute("data-tone", "error");
  });

  it("New Lead opens the create modal", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByTestId("new-lead-btn"));
    expect(await screen.findByTestId("lead-create-modal")).toBeInTheDocument();
  });

  it("columns: Created and Last activity right after the name, no City", () => {
    renderPage();
    const headers = screen.getAllByRole("columnheader").map((h) => h.querySelector(".Mui-TableHeadCell-Content-Wrapper")?.textContent).filter(Boolean);
    expect(headers).toEqual(["Name", "Created", "Last activity", "Company", "Mobile", "Status", "Product", "Owner", "Partner", "Value", "Next Follow-up", "Actions"]);
    expect(lastCfg().columns.filter((c) => c.enableSorting).map((c) => c.id)).toEqual(["name", "created", "lastActivity", "value", "nextFollowUp"]);
  });

  // The proc's own order applies until the user picks a sort: newest first,
  // or most overdue first on the Overdue tab (sp_FetchLeads, @SortBy NULL).
  it("first request sends no sort and no date range", () => {
    renderPage();
    expect(lastLeadsBody()).not.toHaveProperty("SortBy");
    expect(lastLeadsBody()).not.toHaveProperty("SortDir");
    expect(lastLeadsBody()).not.toHaveProperty("FromDate");
    expect(screen.getByTestId("location").textContent).toBe("");
  });

  it("Last activity shows a dash when empty and marks an active lead untouched for 8 days", () => {
    renderPage();
    const stale = document.querySelector('[data-stale="true"]');
    expect(stale).toHaveTextContent(dayjs(FIXTURE_LEADS[0].LastActivityAt).format("DD-MM-YYYY"));
    expect(stale.style.color).toBe("rgb(120, 53, 15)");
    expect(stale.style.fontWeight).toBe("600");
    expect(document.querySelectorAll('[data-stale="true"]')).toHaveLength(1);
    const theme = buildTheme("light");
    const { container } = render(<ThemeProvider theme={theme}>{cellOf("LastActivityAt")({ row: { original: FIXTURE_LEADS[1] } })}</ThemeProvider>);
    expect(container).toHaveTextContent("—");
    expect(container.querySelector("span")).toHaveAttribute("data-stale", "false");
    const created = render(<ThemeProvider theme={theme}>{cellOf("CreatedAt")({ row: { original: { CreatedAt: "2026-10-10T15:05:00" } } })}</ThemeProvider>);
    expect(created.container.querySelector("span")).toHaveTextContent("10-10-2026");
    expect(created.container.querySelector("span")).toHaveAttribute("title", "10-10-2026 15:05");
  });

  it("Created filter: Yesterday sends that day and writes the address bar; Any time removes it", async () => {
    renderPage();
    const user = userEvent.setup();
    const y = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    await user.click(screen.getByTestId("filter-created-button"));
    await user.click(screen.getByTestId("filter-created-option-yesterday"));
    expect(lastLeadsBody()).toMatchObject({ FromDate: y, ToDate: y });
    expect(search().get("created")).toBe("yesterday");
    await user.click(screen.getByTestId("filter-created-button"));
    await user.click(screen.getByTestId("filter-created-option-any"));
    expect(lastLeadsBody()).not.toHaveProperty("FromDate");
    expect(lastLeadsBody()).not.toHaveProperty("ToDate");
    expect(search().has("created")).toBe(false);
  });

  // Regression: SortBy="created" was always sent, which overrode the proc's
  // most-overdue-first order on the Overdue tab.
  it("Overdue preset with the default sort sends no SortBy", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Overdue" }));
    expect(lastLeadsBody()).toMatchObject({ Overdue: true });
    expect(lastLeadsBody()).not.toHaveProperty("SortBy");
    expect(lastLeadsBody()).not.toHaveProperty("SortDir");
  });

  it("clicking the Last activity header sorts by it and writes it to the address bar", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByText("Last activity"));
    expect(lastLeadsBody()).toMatchObject({ SortBy: "lastActivity" });
    expect(search().get("sort")).toBe("lastActivity");
  });

  it("a filter choice lands in the address bar", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("filter-owner-input"));
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    expect(search().get("OwnerId")).toBe("2");
  });

  it("mounting with filters, a preset and a sort in the URL sends them all", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 18, 9, 40));
    try {
      renderPage("/sales/leads?OwnerId=17&created=lastMonth&sort=value&dir=asc");
      expect(lastLeadsBody()).toMatchObject({ OwnerId: 17, FromDate: "2026-10-01", ToDate: "2026-10-31", SortBy: "value", SortDir: "asc" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a backwards custom range in the URL sends no dates and says why", () => {
    renderPage("/sales/leads?created=custom&from=2026-09-30&to=2026-09-01");
    expect(lastLeadsBody()).not.toHaveProperty("FromDate");
    expect(lastLeadsBody()).not.toHaveProperty("ToDate");
    expect(screen.getByText("To is before From")).toBeInTheDocument();
  });

  it("seeds the id filters from the URL as numbers", () => {
    renderPage("/sales/leads?StatusId=15&OwnerId=2");
    expect(lastExtraParams()).toEqual({ StatusId: 15, ProductId: null, OwnerId: 2, SourceId: null, BranchId: null, PartnerId: null });
    // Numeric ids, not strings: optById compares with ===, so a string would
    // still post the filter while every Combobox showed its placeholder.
    expect(screen.getByTestId("filter-status-input")).toHaveValue("Lost");
    expect(screen.getByTestId("filter-owner-input")).toHaveValue("Bob");
  });

  it("won and lost status chips take the report colours; overdue follow-up is late amber", () => {
    renderPage();
    const theme = buildTheme("light");
    const chip = (code) => render(<ThemeProvider theme={theme}>{cellOf("StatusName")({ row: { original: { StatusName: code, StatusCode: code } } })}</ThemeProvider>).container.querySelector("span");
    expect(chip("converted").style.backgroundColor).toBe("rgb(236, 253, 245)"); // #ECFDF5
    expect(chip("lost").style.backgroundColor).toBe("rgb(254, 242, 242)"); // #FEF2F2
    const due = render(<ThemeProvider theme={theme}>{cellOf("NextFollowupDate")({ row: { original: { IsOverdue: true } }, cell: { getValue: () => "2026-09-01" } })}</ThemeProvider>);
    expect(due.container.querySelector("span").style.color).toBe("rgb(180, 83, 9)"); // #B45309
  });
});
