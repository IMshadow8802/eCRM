import React from "react";
import { Helmet } from "react-helmet-async";
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

import PageHeader from "../../components/PageHeader";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const ConversionBySource = () => {
  const theme = useTheme();
  const p = theme.tokens;

  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-conversion-by-source"],
    endpoint: SALES_ENDPOINTS.reports.conversionBySource,
    params: {},
    retry: false,
  });

  const rows = data?.conversion ?? [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="CONVERSION BY SOURCE REPORT"
        subtitle="Total leads vs won, per lead source."
      />
      <Helmet>
        <title>PRD Infotech | Conversion By Source Report</title>
      </Helmet>
      <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 2 }}>
        {isLoading ? (
          <Box
            sx={{ display: "flex", justifyContent: "center", py: 4 }}
            data-testid="conversion-by-source-loading"
          >
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Typography color="error" data-testid="conversion-by-source-error">
            Failed to load conversion by source.
          </Typography>
        ) : rows.length === 0 ? (
          <Typography
            data-testid="conversion-by-source-empty"
            sx={{ color: "text.secondary", py: 4, textAlign: "center" }}
          >
            No conversion data yet.
          </Typography>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid
                  stroke={p.border.subtle}
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="SourceName"
                  tick={{ fill: p.text.tertiary, fontSize: 11 }}
                  stroke={p.border.default}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: p.text.tertiary, fontSize: 11 }}
                  stroke={p.border.default}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  allowDecimals={false}
                />
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
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 11, color: p.text.secondary }}
                />
                <Bar dataKey="TotalLeads" name="Total" fill={p.primary.main} radius={[8, 8, 0, 0]} />
                <Bar dataKey="WonCount" name="Won" fill={p.success.main} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <TableContainer
              component={Paper}
              variant="outlined"
              data-testid="conversion-by-source-table"
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Source</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Won</TableCell>
                    <TableCell align="right">Win Rate</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.SourceId}>
                      <TableCell>{r.SourceName}</TableCell>
                      <TableCell align="right">{r.TotalLeads}</TableCell>
                      <TableCell align="right">{r.WonCount}</TableCell>
                      <TableCell align="right">
                        {r.TotalLeads ? `${Math.round((r.WonCount / r.TotalLeads) * 100)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Box>
    </Box>
  );
};

export default ConversionBySource;
