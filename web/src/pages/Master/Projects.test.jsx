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
  useTeams: vi.fn(() => ({ data: { teams: [] } })),
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

import Projects from "./Projects";
import useServerTable from "../../hooks/useServerTable";
import { useTeams, useUsers } from "../../hooks";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("Projects page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useTeams.mockClear();
    useUsers.mockClear();
  });

  it("renders the page header", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /projects/i })).toBeInTheDocument();
  });

  it("wires useServerTable to /api/projects/fetchProjects", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/projects/fetchProjects");
    expect(cfg.dataKey).toBe("projects");
    expect(cfg.queryKey).toBe("projects");
  });

  it("bulk-loads teams and users for form dropdowns", () => {
    renderPage();
    expect(useTeams).toHaveBeenCalledWith({ PageSize: 1000 });
    expect(useUsers).toHaveBeenCalledWith({ PageSize: 1000 });
  });
});
