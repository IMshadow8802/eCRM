import { useLayoutEffect, useState } from "react";
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
    muiTableProps,
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

  // The scrolling body ends at the bottom of the window, wherever the table
  // starts: under a one-line header or under KPI cards and a chart, on a 720p
  // laptop or a 4K screen. Measured, not guessed — the old fixed
  // `100dvh - 220px` assumed one header row and ran reports off the screen.
  const [fit, setFit] = useState(null);

  const table = useMaterialReactTable({
    ...tableDefaults,
    ...rest,
    initialState: { ...tableDefaults.initialState, ...(initialState || {}) },
    muiTableProps: mergeSxProps(tableDefaults.muiTableProps, muiTableProps),
    muiTablePaperProps: mergeSxProps(tableDefaults.muiTablePaperProps, muiTablePaperProps),
    muiTableContainerProps: mergeSxProps(
      fit ? mergeSxProps(tableDefaults.muiTableContainerProps, { sx: { maxHeight: { xs: "none", sm: fit } } }) : tableDefaults.muiTableContainerProps,
      muiTableContainerProps,
    ),
    muiTableHeadCellProps: mergeSxProps(tableDefaults.muiTableHeadCellProps, muiTableHeadCellProps),
    muiTableBodyCellProps: mergeSxProps(tableDefaults.muiTableBodyCellProps, muiTableBodyCellProps),
    muiTableBodyRowProps: mergeSxProps(tableDefaults.muiTableBodyRowProps, muiTableBodyRowProps),
    muiSearchTextFieldProps: { ...tableDefaults.muiSearchTextFieldProps, ...(muiSearchTextFieldProps || {}) },
    muiPaginationProps: { ...tableDefaults.muiPaginationProps, ...(muiPaginationProps || {}) },
    muiTopToolbarProps: mergeSxProps(tableDefaults.muiTopToolbarProps, muiTopToolbarProps),
    muiBottomToolbarProps: mergeSxProps(tableDefaults.muiBottomToolbarProps, muiBottomToolbarProps),
  });

  const { tableContainerRef, tablePaperRef } = table.refs;
  useLayoutEffect(() => {
    const measure = () => {
      const box = tableContainerRef.current;
      const card = tablePaperRef.current;
      if (!box || !card) return;
      const boxRect = box.getBoundingClientRect();
      setFit(
        fitHeight({
          viewport: window.innerHeight,
          top: boxRect.top + window.scrollY,
          below: card.getBoundingClientRect().bottom - boxRect.bottom,
        }),
      );
    };
    measure();
    // Content above the table (a chart, KPI cards, a wrapped filter row)
    // settles after first paint. Watch everything that sits above it — its
    // earlier siblings and its ancestors' — not the page: the layout is at
    // least one window tall, so content above *shrinking* never resizes the
    // page and the table stayed stuck at its first, too-short height.
    const ro = new ResizeObserver(measure);
    for (let el = tablePaperRef.current; el && el !== document.body; el = el.parentElement) {
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) ro.observe(s);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [tableContainerRef, tablePaperRef]);

  return table;
}

/**
 * Pixel height for the table's scrolling body so the card ends `gap` above
 * the window's bottom edge. `top` is the body's offset from the top of the
 * document, `below` what the card draws under the body (pagination bar,
 * border). Never under `min`: with a tall chart on a short screen the page
 * scrolls a little rather than leaving a table of two rows.
 */
export function fitHeight({ viewport, top, below, gap = 16, min = 280 }) {
  return Math.max(min, Math.floor(viewport - top - below - gap));
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
