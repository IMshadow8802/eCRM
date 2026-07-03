import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const FIXTURE_USERS = [
  { Id: 1, Username: "alice", FullName: "Alice" },
  { Id: 2, Username: "bob", FullName: "Bob" },
];

const FIXTURE_LEADS = [
  {
    Id: 101,
    Name: "Acme Corp",
    MobileNo: "9990001111",
    Email: "acme@example.com",
    StageId: 3,
    OwnerId: 2,
    EstValue: 50000,
    NextFollowupDate: "2026-07-10",
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
    table: { __options: { data: FIXTURE_LEADS } },
    data: FIXTURE_LEADS,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    totalRecords: FIXTURE_LEADS.length,
  })),
}));

vi.mock("../../hooks", () => ({
  useUsers: vi.fn(() => ({ data: { users: FIXTURE_USERS } })),
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({
    data: {
      lookups: [
        { Id: 5, Value: "Website" },
        { Id: 6, Value: "Referral" },
      ],
    },
  })),
}));

vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => (
        <div key={row.Id} data-testid={`lead-row-${row.Id}`}>
          {row.Name}
        </div>
      ))}
    </div>
  ),
}));

import Leads from "./Leads";
import useServerTable from "../../hooks/useServerTable";
import { useUsers } from "../../hooks";
import { useApiQuery } from "../../hooks/useApiQuery";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Leads />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("Sales Leads page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useUsers.mockClear();
    useApiQuery.mockClear();
    mockNavigate.mockClear();
  });

  it("wires useServerTable to /api/leads/fetchLeads with dataKey=leads", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/leads/fetchLeads");
    expect(cfg.dataKey).toBe("leads");
  });

  it("defines the core lead columns in order", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const keys = cfg.columns.map((c) => c.accessorKey);
    expect(keys).toEqual([
      "Name",
      "MobileNo",
      "Email",
      "StageId",
      "OwnerId",
      "EstValue",
      "NextFollowupDate",
    ]);
  });

  it("renders rows from the server table", () => {
    renderPage();
    expect(screen.getByTestId("lead-row-101")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("formats the Stage column and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const stageCol = cfg.columns.find((c) => c.accessorKey === "StageId");
    expect(stageCol.Cell({ cell: { getValue: () => 3 } })).toBe("Stage #3");
    expect(stageCol.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("resolves the Owner column against the bulk-loaded users list", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const ownerCol = cfg.columns.find((c) => c.accessorKey === "OwnerId");
    expect(ownerCol.Cell({ cell: { getValue: () => 2 } })).toBe("Bob");
    expect(ownerCol.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("formats EstValue as INR currency and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const valueCol = cfg.columns.find((c) => c.accessorKey === "EstValue");
    expect(valueCol.Cell({ cell: { getValue: () => 50000 } })).toContain("50,000");
    expect(valueCol.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("formats NextFollowupDate and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const dateCol = cfg.columns.find((c) => c.accessorKey === "NextFollowupDate");
    expect(dateCol.Cell({ cell: { getValue: () => "2026-07-10" } })).toBe("10-Jul-2026");
    expect(dateCol.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("bulk-loads users and lead-source lookups for the filter bar", () => {
    renderPage();
    expect(useUsers).toHaveBeenCalledWith({ PageSize: 1000 });
    const call = useApiQuery.mock.calls.find(
      ([cfg]) => cfg.endpoint === "/api/config/fetchLookups"
    );
    expect(call[0].params).toEqual({ Kind: "lead_source" });
  });

  it("forwards OwnerId when the owner filter changes", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "2" } });
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({ StageId: null, OwnerId: 2, SourceId: null });
  });

  it("forwards SourceId when the source filter changes", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "6" } });
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({ StageId: null, OwnerId: null, SourceId: 6 });
  });

  it("forwards StageId when the stage filter changes", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Stage ID"), { target: { value: "3" } });
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({ StageId: 3, OwnerId: null, SourceId: null });
  });

  it("navigates to the lead detail route when a row is clicked", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const rowProps = cfg.muiTableBodyRowProps({ row: { original: { Id: 42 } } });
    rowProps.onClick();
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/42");
  });
});
