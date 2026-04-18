import { useEffect, useMemo, useState } from "react";
import { useApiQuery } from "./useApiQuery";
import useAppTable from "../components/table/useAppTable";

/**
 * Server-paginated + server-filtered Material React Table.
 *
 * Use this for every list view in the app. It:
 *   - Tracks pagination / globalFilter / sorting state.
 *   - Debounces the search box (default 300ms) so typing doesn't spam the API.
 *   - Fires the API with `{ Id:0, PageNumber, PageSize, SearchTerm, ...extraParams }`.
 *   - Tells MRT the server is authoritative via `manualPagination/Filtering/Sorting`
 *     and passes `rowCount` from the response so the pager shows real totals.
 *
 * Usage:
 *   const { table, isLoading, refetch, data, totalRecords } = useServerTable({
 *     columns,
 *     queryKey: "users",
 *     endpoint: "/api/users/fetchUsers",
 *     dataKey: "users",        // response.data[dataKey] → row array
 *     extraParams: {},          // optional; merged into body on every call
 *     initialPageSize: 25,
 *     enableRowActions: true,
 *     renderRowActions: ({ row }) => …,
 *     renderTopToolbarCustomActions: ({ table }) => …,
 *   });
 *   return <MaterialReactTable table={table} />;
 */
const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 25;

export default function useServerTable({
  columns,
  queryKey,
  endpoint,
  dataKey,
  extraParams = {},
  initialPageSize = DEFAULT_PAGE_SIZE,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  enabled = true,
  ...tableOptions
}) {
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const [globalFilter, setGlobalFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [sorting, setSorting] = useState([]);

  // Debounce the search term so each keystroke doesn't trigger a fetch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(globalFilter), debounceMs);
    return () => clearTimeout(t);
  }, [globalFilter, debounceMs]);

  // Reset to first page whenever the search text changes.
  useEffect(() => {
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    );
  }, [debouncedFilter]);

  const requestParams = useMemo(
    () => ({
      Id: 0,
      PageNumber: pagination.pageIndex + 1,
      PageSize: pagination.pageSize,
      SearchTerm: debouncedFilter ? debouncedFilter : null,
      ...extraParams,
    }),
    [pagination.pageIndex, pagination.pageSize, debouncedFilter, extraParams]
  );

  const query = useApiQuery({
    queryKey: [queryKey, requestParams],
    endpoint,
    params: requestParams,
    enabled,
  });

  const rows = query.data?.[dataKey] || [];
  const totalRecords = query.data?.pagination?.totalRecords ?? rows.length;

  const table = useAppTable({
    columns,
    data: rows,
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    rowCount: totalRecords,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    enablePagination: true,
    enableGlobalFilter: true,
    enableSorting: true,
    initialState: {
      ...(tableOptions.initialState || {}),
      pagination,
    },
    state: {
      ...(tableOptions.state || {}),
      pagination,
      globalFilter,
      sorting,
      isLoading: query.isLoading,
      showProgressBars: query.isFetching && !query.isLoading,
      showSkeletons: query.isLoading,
    },
    ...tableOptions,
  });

  return {
    table,
    data: rows,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    totalRecords,
    pagination,
    globalFilter,
    debouncedFilter,
  };
}
