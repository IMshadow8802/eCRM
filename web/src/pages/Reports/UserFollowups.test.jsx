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

const renderWithProviders = (ui) =>
  render(
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <MemoryRouter>{ui}</MemoryRouter>
    </LocalizationProvider>
  );

import UserFollowups from "./UserFollowups";
import useServerTable from "../../hooks/useServerTable";

describe("UserFollowups report", () => {
  beforeEach(() => {
    useServerTable.mockClear();
  });

  it("wires useServerTable to /api/reports/getFollowupsUserWise", () => {
    renderWithProviders(<UserFollowups />);
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/reports/getFollowupsUserWise");
    expect(cfg.dataKey).toBe("followups");
    expect(cfg.extraParams).toHaveProperty("StartDate");
    expect(cfg.extraParams).toHaveProperty("EndDate");
  });
});

