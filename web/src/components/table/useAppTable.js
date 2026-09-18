import { useMaterialReactTable } from "material-react-table";
import { tableDefaults } from "./tableDefaults";

/**
 * Thin wrapper around useMaterialReactTable that applies the app-wide
 * default config from tableDefaults.js. Per-table overrides (columns,
 * data, custom render props, state) are spread last so they win.
 *
 * Usage:
 *   const table = useAppTable({ columns, data, enableRowActions: true, ... });
 *   return <MaterialReactTable table={table} />;
 */
export default function useAppTable(options = {}) {
  const {
    muiTablePaperProps,
    muiTableContainerProps,
    muiTableHeadCellProps,
    muiTableBodyCellProps,
    muiTableBodyRowProps,
    muiSearchTextFieldProps,
    muiPaginationProps,
    muiTopToolbarProps,
    muiBottomToolbarProps,
    initialState,
    ...rest
  } = options;

  return useMaterialReactTable({
    ...tableDefaults,
    ...rest,
    initialState: { ...tableDefaults.initialState, ...(initialState || {}) },
    muiTablePaperProps: mergeSxProps(tableDefaults.muiTablePaperProps, muiTablePaperProps),
    muiTableContainerProps: mergeSxProps(tableDefaults.muiTableContainerProps, muiTableContainerProps),
    muiTableHeadCellProps: mergeSxProps(tableDefaults.muiTableHeadCellProps, muiTableHeadCellProps),
    muiTableBodyCellProps: mergeSxProps(tableDefaults.muiTableBodyCellProps, muiTableBodyCellProps),
    muiTableBodyRowProps: mergeSxProps(tableDefaults.muiTableBodyRowProps, muiTableBodyRowProps),
    muiSearchTextFieldProps: { ...tableDefaults.muiSearchTextFieldProps, ...(muiSearchTextFieldProps || {}) },
    muiPaginationProps: { ...tableDefaults.muiPaginationProps, ...(muiPaginationProps || {}) },
    muiTopToolbarProps: mergeSxProps(tableDefaults.muiTopToolbarProps, muiTopToolbarProps),
    muiBottomToolbarProps: mergeSxProps(tableDefaults.muiBottomToolbarProps, muiBottomToolbarProps),
  });
}

/**
 * Merge one MRT `mui*Props` value onto the shared default.
 *
 * Exported for its own tests: the function-override branch is the whole reason
 * this exists, and proving it merges is far cheaper than rendering MRT.
 *
 * MRT allows these props to be a function of the row/cell, which is how the
 * "click a row to open it" pages wire themselves up. This used to return the
 * override as-is in that case, throwing the shared config away — so on exactly
 * the pages with clickable rows, the default hover tint silently vanished.
 * Now a function override is wrapped, so the base still applies underneath.
 */
export function mergeSxProps(base, override) {
  if (!override) return base;

  // The common case: two plain objects.
  if (typeof base !== "function" && typeof override !== "function") {
    return { ...base, ...override, sx: { ...base?.sx, ...override?.sx } };
  }

  // Either side may be a function of the row, so the merged value has to be one
  // too — resolve whichever sides need the row, then merge the results.
  const resolve = (v, args) => (typeof v === "function" ? v(...args) : v) || {};
  return (...args) => {
    const under = resolve(base, args);
    const over = resolve(override, args);
    return { ...under, ...over, sx: { ...under.sx, ...over.sx } };
  };
}
