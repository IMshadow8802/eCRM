import { createElement as h, Fragment, useEffect, useLayoutEffect, useState } from "react";
import {
  getIsRowSelected,
  getMRT_RowSelectionHandler,
  getMRT_SelectAllHandler,
  useMaterialReactTable,
  MRT_ShowHideColumnsButton,
  MRT_ToggleDensePaddingButton,
  MRT_ToggleFiltersButton,
  MRT_ToggleFullScreenButton,
} from "material-react-table";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import { Search, X } from "lucide-react";
import TextInput from "../ui/TextInput";
import IconButton from "../ui/IconButton";
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
    displayColumnDefOptions,
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
    // MRT 3's own search box passes MUI v9 the removed InputProps/inputProps,
    // which React logs as unknown DOM props. Draw ours in the same spot instead,
    // unless the page placed the search (or the toolbar buttons) itself.
    ...(rest.enableGlobalFilter !== false && !rest.positionGlobalFilter && !rest.renderToolbarInternalActions && {
      positionGlobalFilter: "none",
      renderToolbarInternalActions: toolbarWithSearch,
    }),
    displayColumnDefOptions: {
      ...tableDefaults.displayColumnDefOptions,
      ...displayColumnDefOptions,
      "mrt-row-actions": { ...tableDefaults.displayColumnDefOptions["mrt-row-actions"], ...displayColumnDefOptions?.["mrt-row-actions"] },
      "mrt-row-select": { Cell: SelectBox, Header: SelectBox, ...displayColumnDefOptions?.["mrt-row-select"] },
    },
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

  // Esc leaves full screen wherever focus is. MRT only listens on its own
  // Paper, so a click on the page behind first left Esc doing nothing.
  const isFullScreen = table.getState().isFullScreen;
  useEffect(() => {
    if (!isFullScreen) return undefined;
    const onKey = (e) => e.key === "Escape" && table.setIsFullScreen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullScreen, table]);

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
          // The page's bottom padding is 16 design px in rem, so it grows
          // with the root font size; a fixed 16 overflowed 4K by a few px.
          gap: (16 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 15)) / 15,
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
 * MRT 3's selection checkbox names its input through `inputProps`, which MUI
 * v9's Checkbox no longer takes: React logged an unknown DOM prop and the
 * input went unnamed. Same box, same MRT handlers, named through slotProps.
 * With no `row` it is the header's select-all.
 * ponytail: checkbox only; a page with enableMultiRowSelection: false (a radio)
 * or enableSelectAll: false needs those branches back from MRT_SelectCheckbox.
 */
function SelectBox({ row, staticRowIndex, table }) {
  const { localization, selectAllMode } = table.options;
  const all = !row;
  const checked = all
    ? selectAllMode === "page" ? table.getIsAllPageRowsSelected() : table.getIsAllRowsSelected()
    : getIsRowSelected({ row, table });
  const indeterminate = !checked && (all ? table.getIsSomeRowsSelected() : row.getIsSomeSelected() && row.getCanSelectSubRows());
  const onChange = all ? getMRT_SelectAllHandler({ table }) : getMRT_RowSelectionHandler({ row, staticRowIndex, table });
  const label = all ? localization.toggleSelectAll : localization.toggleSelectRow;
  return h(Checkbox, {
    size: "small",
    checked,
    indeterminate,
    disabled: table.getState().isLoading || (row && !row.getCanSelect()),
    onClick: (e) => e.stopPropagation(),
    onChange: (e) => {
      e.stopPropagation();
      onChange(e);
    },
    slotProps: { input: { "aria-label": label } },
    sx: { height: "1.75rem", width: "1.75rem" },
  });
}

/**
 * MRT's right-hand toolbar: our search field, then MRT's own buttons under the
 * same conditions MRT_ToolbarInternalButtons uses (minus the search toggle:
 * the field is always shown). Each keystroke sets the global filter directly;
 * useServerTable debounces its fetch.
 */
function toolbarWithSearch({ table }) {
  const o = table.options;
  const search = o.muiSearchTextFieldProps ?? {};
  const value = table.getState().globalFilter ?? "";
  return h(
    Fragment,
    null,
    // The page's search sx (tableDefaults: no 260px floor on a phone, or the toolbar clips).
    h(Box, { sx: { mr: "calc(4rem / 15)", ...search.sx } },
      h(TextInput, {
        size: "sm",
        placeholder: search.placeholder ?? "Search…",
        "aria-label": "Search",
        leftAdornment: h(Search, { size: 14 }),
        // Tucked into the field's right padding so the 32px button sits inside the box.
        rightAdornment: value
          ? h("span", { style: { display: "inline-flex", marginRight: "calc(-8rem / 15)" } }, h(IconButton, { size: "sm", "aria-label": "Clear search", onClick: () => table.setGlobalFilter(undefined) }, h(X, { size: 14 })))
          : null,
        value,
        onChange: (e) => table.setGlobalFilter(e.target.value || undefined),
      })),
    o.enableFilters && o.enableColumnFilters && o.columnFilterDisplayMode !== "popover" && h(MRT_ToggleFiltersButton, { table }),
    (o.enableHiding || o.enableColumnOrdering || o.enableColumnPinning) && h(MRT_ShowHideColumnsButton, { table }),
    o.enableDensityToggle && h(MRT_ToggleDensePaddingButton, { table }),
    o.enableFullScreenToggle && h(MRT_ToggleFullScreenButton, { table }),
  );
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
