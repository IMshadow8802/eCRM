import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the data-fetching hook so we can inspect the params it's called with
// and control what it returns. useServerTable is a composition of state +
// debouncing + useApiQuery — testing that composition is the goal.
vi.mock("./useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({
    data: { items: [], pagination: { totalRecords: 0 } },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

// Avoid rendering a real Material React Table in these hook-level tests;
// stub it to just echo whatever config it was given.
vi.mock("../components/table/useAppTable", () => ({
  __esModule: true,
  default: vi.fn((opts) => ({ __options: opts })),
}));

import useServerTable from "./useServerTable";
import { useApiQuery } from "./useApiQuery";
import useAppTable from "../components/table/useAppTable";

const baseConfig = {
  columns: [],
  queryKey: "leads",
  endpoint: "/api/leads/fetchLeads",
  dataKey: "leads",
};

describe("useServerTable", () => {
  beforeEach(() => {
    useApiQuery.mockClear();
    useAppTable.mockClear();
  });

  it("calls useApiQuery with default pagination on first render", () => {
    renderHook(() => useServerTable(baseConfig));
    expect(useApiQuery).toHaveBeenCalled();
    const args = useApiQuery.mock.calls.at(-1)[0];
    expect(args.endpoint).toBe("/api/leads/fetchLeads");
    expect(args.params).toMatchObject({
      Id: 0,
      PageNumber: 1,
      PageSize: 25,
      SearchTerm: null,
    });
  });

  it("merges extraParams into every request", () => {
    renderHook(() =>
      useServerTable({ ...baseConfig, extraParams: { OwnerUserId: 5 } })
    );
    const args = useApiQuery.mock.calls.at(-1)[0];
    expect(args.params).toMatchObject({ OwnerUserId: 5, PageNumber: 1 });
  });

  it("honours initialPageSize", () => {
    renderHook(() => useServerTable({ ...baseConfig, initialPageSize: 100 }));
    const args = useApiQuery.mock.calls.at(-1)[0];
    expect(args.params.PageSize).toBe(100);
  });

  it("configures MRT for server-side pagination + filtering + sorting", () => {
    renderHook(() => useServerTable(baseConfig));
    const tableOpts = useAppTable.mock.calls.at(-1)[0];
    expect(tableOpts.manualPagination).toBe(true);
    expect(tableOpts.manualFiltering).toBe(true);
    expect(tableOpts.manualSorting).toBe(true);
    expect(tableOpts.rowCount).toBe(0);
  });

  it("surfaces rowCount from the server response", () => {
    useApiQuery.mockReturnValueOnce({
      data: {
        items: [{ Id: 1 }, { Id: 2 }],
        pagination: { totalRecords: 347 },
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() =>
      useServerTable({ ...baseConfig, dataKey: "items" })
    );
    expect(result.current.totalRecords).toBe(347);
    expect(result.current.data).toHaveLength(2);
  });

  it("debounces the search input before refetching", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useServerTable(baseConfig));

      act(() => {
        result.current.table.__options.onGlobalFilterChange("priya");
      });
      // React re-renders on every state change, so useApiQuery is *called*
      // immediately — but with the old debouncedFilter, so SearchTerm is
      // still null. The real assertion is: no call yet carries "priya".
      const firedBeforeDebounce = useApiQuery.mock.calls.some(
        ([cfg]) => cfg.params?.SearchTerm === "priya"
      );
      expect(firedBeforeDebounce).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      const firedAfterDebounce = useApiQuery.mock.calls.some(
        ([cfg]) => cfg.params?.SearchTerm === "priya"
      );
      expect(firedAfterDebounce).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets to page 1 when the search term changes", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useServerTable(baseConfig));

      // Jump to page 3 first
      act(() => {
        result.current.table.__options.onPaginationChange({
          pageIndex: 2,
          pageSize: 25,
        });
      });

      // Then type a search — this should reset pageIndex back to 0
      act(() => {
        result.current.table.__options.onGlobalFilterChange("alpha");
      });
      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      const last = useApiQuery.mock.calls.at(-1)[0];
      expect(last.params.PageNumber).toBe(1);
      expect(last.params.SearchTerm).toBe("alpha");
    } finally {
      vi.useRealTimers();
    }
  });
});
