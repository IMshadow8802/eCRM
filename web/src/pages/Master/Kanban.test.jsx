import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
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

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({ data: { projects: [] } })),
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

import Kanban from "./Kanban";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Kanban />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("Kanban columns page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useApiQuery.mockClear();
  });

  it("wires useServerTable to /api/kanban/fetchKanbanColumns", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/kanban/fetchKanbanColumns");
    expect(cfg.dataKey).toBe("columns");
    // Fetch must stay disabled until a project is picked — extraParams carry ProjectId.
    expect(cfg.extraParams).toHaveProperty("ProjectId");
  });

  it("bulk-loads projects for the selector dropdown", () => {
    renderPage();
    const call = useApiQuery.mock.calls.find(
      ([cfg]) => cfg.endpoint === "/api/projects/fetchProjects"
    );
    expect(call[0].params).toMatchObject({ PageSize: 1000 });
  });
});
