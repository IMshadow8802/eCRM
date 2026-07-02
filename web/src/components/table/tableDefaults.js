import { createElement } from "react";
import { Inbox } from "lucide-react";
import EmptyState from "../ui/EmptyState";

/**
 * Centralized Material React Table configuration.
 *
 * All MRT usages across the app spread this object so a change here
 * (density, border, header color, pagination shape, etc.) propagates
 * to every table. Per-table overrides still work — callers pass options
 * to useAppTable() and they win via object spread precedence.
 */
export const tableDefaults = {
  renderEmptyRowsFallback: () =>
    createElement(EmptyState, {
      icon: createElement(Inbox, { size: 28 }),
      title: "Nothing here yet",
      description:
        "No records match your filters. Try widening the search or creating one.",
      size: "md",
    }),
  enableColumnResizing: false,    // off by default so MRT uses semantic table layout; columns stretch to fill container
  enableStickyHeader: true,
  enableDensityToggle: false,
  enableFullScreenToggle: false,
  enableHiding: true,
  enableColumnActions: false,     // hide the per-column "⋮" header menu globally
  paginationDisplayMode: "pages",
  positionToolbarAlertBanner: "bottom",

  initialState: {
    density: "compact",
    showGlobalFilter: true,
    pagination: { pageSize: 25, pageIndex: 0 },
  },

  muiTableProps: {
    sx: { tableLayout: "auto", width: "100%" },
  },

  muiTablePaperProps: {
    elevation: 0,
    // Kill MRT's internal `lighten(background.default, 0.05)` which in dark
    // mode synthesizes a blue-biased navy that clashes with the rest of the
    // page. Force the page background so the table Paper blends into the
    // content area.
    sx: {
      borderRadius: 2,
      border: "1px solid",
      borderColor: "divider",
      overflow: "hidden",
      backgroundColor: "background.default",
      backgroundImage: "none",
    },
  },

  muiTableContainerProps: {
    sx: {
      maxHeight: "calc(100vh - 220px)",
    },
  },

  muiTableHeadCellProps: {
    sx: {
      backgroundColor: "background.default",
      fontWeight: 600,
      fontSize: "0.8rem",
      color: "text.secondary",
      textTransform: "uppercase",
      letterSpacing: "0.03em",
      borderBottom: "1px solid",
      borderColor: "divider",
    },
  },

  muiTableBodyCellProps: {
    sx: {
      fontSize: "0.9333rem",
      fontWeight: 500,
      py: 1,
    },
  },

  muiTableBodyRowProps: {
    hover: true,
    sx: {
      "&:hover td": {
        backgroundColor: "action.hover",
      },
    },
  },

  muiSearchTextFieldProps: {
    size: "small",
    variant: "outlined",
    placeholder: "Search…",
    sx: { minWidth: 260 },
  },

  muiPaginationProps: {
    color: "primary",
    shape: "rounded",
    showRowsPerPage: true,
    rowsPerPageOptions: [10, 25, 50, 100],
  },

  muiTopToolbarProps: {
    sx: {
      backgroundColor: "background.default",
      borderBottom: "1px solid",
      borderColor: "divider",
    },
  },

  muiBottomToolbarProps: {
    sx: {
      backgroundColor: "background.default",
      borderTop: "1px solid",
      borderColor: "divider",
    },
  },
};
