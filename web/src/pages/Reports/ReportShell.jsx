import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { MaterialReactTable } from "material-react-table";
import useAppTable from "../../components/table/useAppTable";
import PageHeader from "../../components/ui/PageHeader";
import Tooltip from "../../components/ui/Tooltip";
import {
  Box,
  CircularProgress,
  Typography,
} from "@mui/material";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import useUiScale from "../../hooks/useUiScale";
import { truncTick } from "./reportUtils";

/**
 * The three pieces every report page was copying: the page shell (header,
 * document title, loading/error/empty switch), the bar chart, and the summary
 * table. Five pages carried all of it inline — the chart's axis/grid/tooltip
 * styling alone was ~55 identical lines repeated four times, so retuning a
 * chart colour meant four edits and there was no way to tell from one file
 * whether the others had drifted.
 *
 * The `testId` prefix stays a prop rather than being derived from the title:
 * the existing tests query `<prefix>-loading` / `-error` / `-empty` / `-table`,
 * and those ids are the contract.
 */

export function ReportShellPage({
  title,
  subtitle,
  documentTitle,
  testId,
  actions,
  isLoading,
  error,
  isEmpty,
  errorText,
  emptyText,
  children,
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <Helmet>
        <title>PRD Infotech | {documentTitle}</title>
      </Helmet>
      <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 2 }}>
        {isLoading ? (
          <Box
            sx={{ display: "flex", justifyContent: "center", py: 4 }}
            data-testid={`${testId}-loading`}
          >
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Typography color="error" data-testid={`${testId}-error`}>
            {errorText}
          </Typography>
        ) : isEmpty ? (
          <Typography
            data-testid={`${testId}-empty`}
            sx={{ color: "text.secondary", py: 4, textAlign: "center" }}
          >
            {emptyText}
          </Typography>
        ) : (
          children
        )}
      </Box>
    </Box>
  );
}

/**
 * The shared recharts bar chart.
 *
 * `bars` is a list of `{ key, name, tone }`; tone picks a semantic token
 * ("primary" by default, "success" for the second series on Conversion by
 * Source) so no page writes a colour.
 *
 * `legend` is a prop rather than being inferred from `bars.length` because
 * the pages genuinely differ: Calls per User draws one bar with no legend
 * while Tickets by Category draws one bar with a legend. Inferring it would
 * silently restyle one of them.
 */
export function ReportBarChart({ data, xKey, bars, legend = true, height = 260 }) {
  const theme = useTheme();
  const k = useUiScale();
  // Only narrow axes need shortening. Applied unconditionally it cut every
  // category name on a 1920px desktop too, which is a worse outcome than the
  // overlap it was written for.
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const p = theme.tokens;
  const axis = {
    tick: { fill: p.text.tertiary, fontSize: 11 * k },
    stroke: p.border.default,
    tickLine: false,
    axisLine: false,
  };

  return (
    <ResponsiveContainer width="100%" height={height * k}>
      <BarChart data={data} margin={{ top: 6 * k, right: 8 * k, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={p.border.subtle} strokeDasharray="3 3" vertical={false} />
        {/* A resolution or category name is free text the company writes in
            Settings — "Replaced under warranty" is a normal one. Left whole,
            recharts either overlaps them or silently drops every other tick on
            a phone, and the reader can no longer tell which bar is which.
            Truncating fits more of them; the Tooltip still carries the full
            name, because it reads the raw datum rather than the tick. */}
        <XAxis dataKey={xKey} {...axis} tickFormatter={narrow ? truncTick : undefined} />
        <YAxis {...axis} width={32 * k} allowDecimals={false} />
        <ChartTooltip
          contentStyle={{
            background: p.surface.card,
            border: `1px solid ${p.border.default}`,
            borderRadius: 8,
            fontSize: "calc(12rem / 15)",
            color: p.text.primary,
          }}
          cursor={{ fill: p.surface.subtle }}
        />
        {legend && (
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: "calc(11rem / 15)", color: p.text.secondary }}
          />
        )}
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={p[b.tone ?? "primary"].main}
            radius={[8 * k, 8 * k, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * The summary table under each chart — a Material React Table on the app's
 * shared defaults (`useAppTable`), so reports scroll sideways inside the card
 * like every list page instead of pushing past the screen, with search,
 * sorting and show/hide columns. The first column is pinned so the row's name
 * stays visible while scrolling.
 *
 * `columns` is `{ key?, header, align?, hint?, cell(row) }`. `key` names the
 * row field (sorting and search use it) and keeps two columns with one header
 * apart (the Lost report heads two "Reason"). A column without a usable field
 * sorts on what `cell` returns, unless that is an element.
 *
 * `onRowClick` (spec 4a drill-down) makes rows hoverable, clickable and
 * keyboard-activatable. Without it rows carry no handler, cursor or tab stop.
 */
export function ReportTable({ rows, columns, rowKey, testId, onRowClick, rowTestId }) {
  const mrtColumns = useMemo(
    () =>
      columns.map((c, i) => {
        const id = String(c.key ?? (typeof c.header === "string" ? c.header : `col${i}`));
        const value = (r) => (c.key != null && c.key in r ? r[c.key] : c.cell(r));
        const sample = rows.length ? value(rows[0]) : null;
        const plain = sample == null || typeof sample !== "object";
        return {
          id,
          header: typeof c.header === "string" ? c.header : id,
          accessorFn: value,
          enableSorting: plain,
          enableGlobalFilter: plain,
          Header: () =>
            c.hint ? (
              <Tooltip title={c.hint}>
                <span tabIndex={0} style={{ cursor: "help", textDecoration: "underline dotted" }}>{c.header}</span>
              </Tooltip>
            ) : (c.header ?? ""),
          Cell: ({ row }) => c.cell(row.original),
          muiTableHeadCellProps: { align: c.align },
          muiTableBodyCellProps: { align: c.align },
        };
      }),
    [columns, rows],
  );

  const table = useAppTable({
    columns: mrtColumns,
    data: rows,
    getRowId: (r) => String(rowKey(r)),
    enableColumnPinning: true,
    enablePagination: rows.length > 25,
    enableBottomToolbar: rows.length > 25,
    initialState: { columnPinning: { left: mrtColumns[0] ? [mrtColumns[0].id] : [] } },
    muiTablePaperProps: { "data-testid": testId },
    muiTableBodyRowProps: ({ row }) => ({
      "data-testid": rowTestId?.(row.original) ?? (onRowClick && testId ? `${testId}-row` : undefined),
      ...(onRowClick && {
        onClick: () => onRowClick(row.original),
        // A pointer row only the mouse can reach is a dead end for keyboard
        // users, so the row is a real tab stop with Enter/Space on it. It keeps
        // the implicit role="row": role="button" would collapse the line into
        // one control and lose the header-to-value association.
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onRowClick(row.original);
        },
        style: { cursor: "pointer" },
      }),
    }),
  });

  return <MaterialReactTable table={table} />;
}
