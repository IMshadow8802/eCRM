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

function mergeSxProps(base, override) {
  if (!override) return base;
  if (typeof override === "function" || typeof base === "function") {
    return override || base;
  }
  return {
    ...base,
    ...override,
    sx: { ...(base?.sx || {}), ...(override?.sx || {}) },
  };
}
