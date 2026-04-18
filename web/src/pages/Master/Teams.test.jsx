import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: {} },
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    totalRecords: 0,
  })),
}));

vi.mock("../../hooks", () => ({
  useUsers: vi.fn(() => ({ data: { users: [] } })),
  useConfirmation: () => ({
    isOpen: false,
    confirmDelete: vi.fn(),
    confirmationState: {},
    hideConfirmation: vi.fn(),
    handleConfirm: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("../../hooks/useApi", () => ({
  __esModule: true,
  default: () => ({ post: vi.fn() }),
}));

vi.mock("material-react-table", () => ({
  MaterialReactTable: () => <div data-testid="mrt-root" />,
}));

vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar: vi.fn() }) };
});

import Teams from "./Teams";
import useServerTable from "../../hooks/useServerTable";
import { useUsers } from "../../hooks";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Teams />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("Teams page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useUsers.mockClear();
  });

  it("wires useServerTable to /api/teams/fetchTeams", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/teams/fetchTeams");
    expect(cfg.dataKey).toBe("teams");
  });

  it("bulk-loads users for the team form dropdown", () => {
    renderPage();
    expect(useUsers).toHaveBeenCalledWith({ PageSize: 1000 });
  });
});
