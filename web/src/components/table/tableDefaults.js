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

  // The table is a card sitting ON the page, not a region cut out of it.
  //
  // This used to force `background.default` — the page colour — with a 1px
  // border and no shadow, which is why every table in the app read as flat and
  // embedded. `backgroundImage: none` still matters: it kills MRT's internal
  // `lighten(background.default, 0.05)`, which in dark mode synthesises a
  // blue-biased navy that matches nothing else on the page.
  //
  // Depth is the surface step first (page is one shade darker than card) and
  // the shadow second. Getting that order wrong is how a card ends up with a
  // heavy shadow and still looks flat.
  muiTablePaperProps: {
    elevation: 0,
    sx: {
      // The gap above the card lives here, not on each page. Six pages had six
      // different margins (0, 1, 1.5, 2) between their filters and their table.
      mt: 2,
      borderRadius: (theme) => `${theme.radii.xl}px`,
      border: "1px solid",
      borderColor: "divider",
      overflow: "hidden",
      backgroundColor: "background.paper",
      backgroundImage: "none",
      boxShadow: (theme) => theme.tokens.shadow.md,
    },
  },

  muiTableContainerProps: {
    sx: {
      maxHeight: "calc(100vh - 220px)",
    },
  },

  muiTableHeadCellProps: {
    sx: {
      backgroundColor: "background.paper",
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

  // Both toolbars are square boxes sitting inside the Paper's rounded corners,
  // and MRT gives the bottom one a shadow of its own — a hard grey
  // `0 1px 2px -1px rgba(97,97,97,0.5)` that drew straight across the arc and
  // made the card's corners read as sharp rectangles. Drop that shadow, and
  // round each toolbar's outer corners to the same token the Paper uses so no
  // square child is left sitting in the curve.
  muiTopToolbarProps: {
    sx: {
      backgroundColor: "background.paper",
      borderBottom: "1px solid",
      borderColor: "divider",
      boxShadow: "none",
      borderRadius: (theme) => `${theme.radii.xl}px ${theme.radii.xl}px 0 0`,
    },
  },

  muiBottomToolbarProps: {
    sx: {
      backgroundColor: "background.paper",
      borderTop: "1px solid",
      borderColor: "divider",
      boxShadow: "none",
      borderRadius: (theme) => `0 0 ${theme.radii.xl}px ${theme.radii.xl}px`,
    },
  },
};
