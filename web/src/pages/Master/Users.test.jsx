import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the composition hook. Users.jsx's job is to wire the right config
// into useServerTable; testing that wiring is the point.
vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: {} },
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    totalRecords: 0,
  })),
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({ data: { userGroups: [] } })),
}));

vi.mock("../../hooks/useApi", () => ({
  __esModule: true,
  default: () => ({ post: vi.fn() }),
}));

vi.mock("../../hooks", () => ({
  useConfirmation: () => ({
    isOpen: false,
    confirmDelete: vi.fn(),
    confirmationState: {},
    hideConfirmation: vi.fn(),
    handleConfirm: vi.fn(),
    isLoading: false,
  }),
}));

// Don't try to render the real MRT shell in jsdom.
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root" data-row-count={table?.__options?.rowCount ?? 0} />
  ),
}));

vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar: vi.fn() }) };
});

import Users from "./Users";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("Users page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useApiQuery.mockClear();
  });

  it("renders the page header", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /users/i })).toBeInTheDocument();
  });

  it("wires useServerTable to /api/users/fetchUsers with dataKey=users", () => {
    renderPage();
    expect(useServerTable).toHaveBeenCalled();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/users/fetchUsers");
    expect(cfg.dataKey).toBe("users");
    expect(cfg.queryKey).toBe("users");
  });

  it("defines the expected columns in the expected order", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const headers = cfg.columns.map((c) => c.accessorKey);
    expect(headers).toEqual([
      "Username",
      "FullName",
      "Email",
      "JobTitle",
      "GroupName",
      "HourlyRate",
      "IsActive",
      "IsAdmin",
      "CreatedDate",
    ]);
  });

  it("passes a bulk PageSize when populating the user-groups dropdown", () => {
    renderPage();
    const call = useApiQuery.mock.calls.find(
      ([cfg]) => cfg.endpoint === "/api/user-groups/fetchUserGroups"
    );
    expect(call).toBeTruthy();
    expect(call[0].params).toMatchObject({ PageSize: 1000, SearchTerm: null });
  });
});
