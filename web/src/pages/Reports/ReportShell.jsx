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

export function ReportPage({
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
        <XAxis dataKey={xKey} {...axis} />
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
 * every page took from its own id column.
 */
export function ReportTable({ rows, columns, rowKey, testId }) {
  return (
    <TableContainer component={Paper} variant="outlined" data-testid={testId}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.header} align={c.align}>
                {c.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((c) => (
                <TableCell key={c.header} align={c.align}>
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
