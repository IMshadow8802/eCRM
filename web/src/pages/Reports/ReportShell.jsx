import { Helmet } from "react-helmet-async";
import PageHeader from "../../components/ui/PageHeader";
import {
  Box,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  const p = theme.tokens;
  const axis = {
    tick: { fill: p.text.tertiary, fontSize: 11 },
    stroke: p.border.default,
    tickLine: false,
    axisLine: false,
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={p.border.subtle} strokeDasharray="3 3" vertical={false} />
        {/* A resolution or category name is free text the company writes in
            Settings — "Replaced under warranty" is a normal one. Left whole,
            recharts either overlaps them or silently drops every other tick on
            a phone, and the reader can no longer tell which bar is which.
            Truncating fits more of them; the Tooltip still carries the full
            name, because it reads the raw datum rather than the tick. */}
        <XAxis dataKey={xKey} {...axis} tickFormatter={truncTick} />
        <YAxis {...axis} width={32} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: p.surface.card,
            border: `1px solid ${p.border.default}`,
            borderRadius: 8,
            fontSize: 12,
            color: p.text.primary,
          }}
          cursor={{ fill: p.surface.subtle }}
        />
        {legend && (
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: p.text.secondary }}
          />
        )}
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={p[b.tone ?? "primary"].main}
            radius={[8, 8, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * The summary table under each chart. `columns` is
 * `{ header, align, cell(row) }`; `rowKey(row)` supplies the React key, which
 * every page took from its own id column. Columns may carry a `key` — used for
 * the React key so two columns can share a header (the Lost report heads two
 * columns "Reason"); the existing pages pass none and keep header keys.
 *
 * `onRowClick` (spec 4a drill-down) makes rows hoverable, clickable and
 * keyboard-activatable. Without it the table renders exactly as before — no
 * handler, no cursor, no tab stop — so the ticket reports are untouched.
 */
export function ReportTable({ rows, columns, rowKey, testId, onRowClick }) {
  const clickProps = onRowClick
    ? (row) => ({
        hover: true,
        onClick: () => onRowClick(row),
        // A pointer row that only the mouse can reach is a dead end for
        // keyboard users, so the row is a real tab stop with Enter/Space on it.
        // It keeps the implicit role="row": role="button" would drop the row
        // out of the table for a screen reader and collapse the whole line
        // into one control named "Website 700", losing the header-to-value
        // association that is the point of a breakdown table.
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onRowClick(row);
        },
        style: { cursor: "pointer" },
        "data-testid": testId ? `${testId}-row` : undefined,
      })
    : () => ({});

  return (
    <TableContainer component={Paper} variant="outlined" data-testid={testId}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.key ?? c.header} align={c.align}>
                {c.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)} {...clickProps(row)}>
              {columns.map((c) => (
                <TableCell key={c.key ?? c.header} align={c.align}>
                  {c.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
