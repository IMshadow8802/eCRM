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

vi.mock("./components/LeadSourceForm", () => ({
  __esModule: true,
  default: ({ open }) =>
    open ? <div data-testid="lead-source-form" /> : null,
}));

import LeadSource from "./LeadSource";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LeadSource />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("LeadSource page", () => {
  beforeEach(() => {
    mockUseApiQuery.mockReset();
    mockConfirmDelete.mockReset();
    mockUseApiQuery.mockReturnValue({
      data: {
        sources: [
          { SourceId: 1, SourceName: "Website" },
          { SourceId: 2, SourceName: "Referral" },
        ],
        pagination: { totalRecords: 2 },
      },
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  it("queries /api/sources/fetchSources with SourceId param", () => {
    renderPage();
    const cfg = mockUseApiQuery.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/sources/fetchSources");
    expect(cfg.params.SourceId).toBe(0);
  });

  it("renders a tile per source with the name", () => {
    renderPage();
    expect(screen.getByTestId("master-grid-tile-1")).toBeInTheDocument();
    expect(screen.getByTestId("master-grid-tile-2")).toBeInTheDocument();
    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.getByText("Referral")).toBeInTheDocument();
  });

  it("opens the form when the create button is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("master-grid-create"));
    expect(screen.getByTestId("lead-source-form")).toBeInTheDocument();
  });

  it("opens the form in edit mode when a tile edit icon is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("master-grid-edit-1"));
    expect(screen.getByTestId("lead-source-form")).toBeInTheDocument();
  });

  it("asks for confirmation when a tile delete icon is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("master-grid-delete-2"));
    expect(mockConfirmDelete).toHaveBeenCalledTimes(1);
    const call = mockConfirmDelete.mock.calls[0][0];
    expect(call.title).toBe("Delete Lead Source");
    expect(call.message).toContain("Referral");
  });

  it("shows an empty state when there are no sources", () => {
    mockUseApiQuery.mockReturnValue({
      data: { sources: [], pagination: { totalRecords: 0 } },
      isLoading: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("master-grid-empty")).toBeInTheDocument();
  });

  it("shows loading skeletons while fetching", () => {
    mockUseApiQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("master-grid-loading")).toBeInTheDocument();
  });
});
