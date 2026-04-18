import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

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

vi.mock("material-react-table", () => ({
  MaterialReactTable: () => <div data-testid="mrt-root" />,
}));

import BranchLeadSummary from "./BranchLeadSummary";
import useServerTable from "../../hooks/useServerTable";

const renderWithProviders = (ui) =>
  render(
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <MemoryRouter>{ui}</MemoryRouter>
    </LocalizationProvider>
  );

describe("BranchLeadSummary report", () => {
  beforeEach(() => {
    useServerTable.mockClear();
  });

  it("wires useServerTable to /api/reports/getLeadSummaryBranchWise", () => {
    renderWithProviders(<BranchLeadSummary />);
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/reports/getLeadSummaryBranchWise");
    expect(cfg.dataKey).toBe("summary");
    expect(cfg.extraParams).toHaveProperty("StartDate");
  });
});
