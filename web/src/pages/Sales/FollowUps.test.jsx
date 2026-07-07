import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";

const FIXTURE_LEADS = [
  { Id: 101, Name: "Acme Corp" },
  { Id: 102, Name: "Globex" },
];

const FIXTURE_FOLLOWUPS = [
  {
    Id: 11,
    LeadId: 101,
    NextFollowupDate: "2026-07-10",
    FollowupType: "Call",
    Status: "Pending",
    Remarks: "Send quote",
  },
  {
    Id: 12,
    LeadId: 999,
    NextFollowupDate: null,
    FollowupType: null,
    Status: null,
    Remarks: null,
  },
];

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: { data: FIXTURE_FOLLOWUPS } },
    data: FIXTURE_FOLLOWUPS,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    totalRecords: FIXTURE_FOLLOWUPS.length,
  })),
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({ data: { leads: FIXTURE_LEADS } })),
}));

vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => (
        <div key={row.Id} data-testid={`followup-row-${row.Id}`}>
          {row.Remarks}
        </div>
      ))}
    </div>
  ),
}));

import FollowUps from "./FollowUps";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";

const renderPage = () =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FollowUps />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );

const pickOption = async (testId, optionName) => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name: optionName }));
};

describe("Sales Follow-ups page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useApiQuery.mockClear();
    mockNavigate.mockClear();
  });

  it("wires useServerTable to fetchFollowups with dataKey=followups and LeadId:0", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/followups/fetchFollowups");
    expect(cfg.dataKey).toBe("followups");
    expect(cfg.extraParams).toEqual({ LeadId: 0 });
  });

  it("defines the follow-up columns in order", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const keys = cfg.columns.map((c) => c.accessorKey);
    expect(keys).toEqual([
      "LeadId",
      "NextFollowupDate",
      "FollowupType",
      "Status",
      "Remarks",
    ]);
  });

  it("renders rows from the server table", () => {
    renderPage();
    expect(screen.getByTestId("followup-row-11")).toBeInTheDocument();
    expect(screen.getByText("Send quote")).toBeInTheDocument();
  });

  it("resolves the Lead column to its name and falls back to Lead #id", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const leadCol = cfg.columns.find((c) => c.accessorKey === "LeadId");
    expect(leadCol.Cell({ cell: { getValue: () => 101 } })).toBe("Acme Corp");
    expect(leadCol.Cell({ cell: { getValue: () => 999 } })).toBe("Lead #999");
    expect(leadCol.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("formats NextFollowupDate and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const dateCol = cfg.columns.find((c) => c.accessorKey === "NextFollowupDate");
    expect(dateCol.Cell({ cell: { getValue: () => "2026-07-10" } })).toBe("10-Jul-2026");
    expect(dateCol.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("defaults an empty Status to Pending", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const statusCol = cfg.columns.find((c) => c.accessorKey === "Status");
    expect(statusCol.Cell({ cell: { getValue: () => "Done" } })).toBe("Done");
    expect(statusCol.Cell({ cell: { getValue: () => null } })).toBe("Pending");
  });

  it("bulk-loads leads to resolve names", () => {
    renderPage();
    const call = useApiQuery.mock.calls.find(
      ([cfg]) => cfg.endpoint === "/api/leads/fetchLeads"
    );
    expect(call[0].params).toEqual({ PageNumber: 1, PageSize: 1000 });
  });

  it("drives SearchTerm from the status filter", async () => {
    renderPage();
    await pickOption("filter-status", "Done");
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({ LeadId: 0, SearchTerm: "Done" });
  });

  it("navigates to the lead detail route when a row is clicked", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const rowProps = cfg.muiTableBodyRowProps({ row: { original: { LeadId: 42 } } });
    rowProps.onClick();
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/42");
  });
});
