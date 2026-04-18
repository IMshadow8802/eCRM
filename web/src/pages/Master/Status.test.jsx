import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUseApiQuery = vi.fn();
vi.mock("../../hooks/useApiQuery", () => ({
  __esModule: true,
  useApiQuery: (cfg) => mockUseApiQuery(cfg),
}));

const mockConfirmDelete = vi.fn();
vi.mock("../../hooks", () => ({
  useConfirmation: () => ({
    isOpen: false,
    confirmDelete: mockConfirmDelete,
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

vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar: vi.fn() }) };
});

vi.mock("./components/StatusForm", () => ({
  __esModule: true,
  default: ({ open }) => (open ? <div data-testid="status-form" /> : null),
}));

import Status from "./Status";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Status />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("Status page", () => {
  beforeEach(() => {
    mockUseApiQuery.mockReset();
    mockConfirmDelete.mockReset();
    mockUseApiQuery.mockReturnValue({
      data: {
        statuses: [
          { StatusId: 10, StatusName: "Open" },
          { StatusId: 11, StatusName: "Closed" },
        ],
        pagination: { totalRecords: 2 },
      },
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  it("queries /api/status/fetchStatus with StatusId param", () => {
    renderPage();
    const cfg = mockUseApiQuery.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/status/fetchStatus");
    expect(cfg.params.StatusId).toBe(0);
  });

  it("renders a tile per status with the name", () => {
    renderPage();
    expect(screen.getByTestId("master-grid-tile-10")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("opens the form when the create button is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("master-grid-create"));
    expect(screen.getByTestId("status-form")).toBeInTheDocument();
  });

  it("asks for confirmation when a tile delete icon is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("master-grid-delete-11"));
    expect(mockConfirmDelete).toHaveBeenCalledTimes(1);
    const call = mockConfirmDelete.mock.calls[0][0];
    expect(call.title).toBe("Delete Status");
    expect(call.message).toContain("Closed");
  });
});
