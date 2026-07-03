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
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

const TicketsByCategory = () => {
  const theme = useTheme();
  const p = theme.tokens;

  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-tickets-by-category"],
    endpoint: SUPPORT_ENDPOINTS.reports.ticketsByCategory,
    params: {},
    retry: false,
  });

  const rows = data?.categories ?? [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="TICKETS BY CATEGORY REPORT"
        subtitle="Ticket count per category."
      />
      <Helmet>
        <title>PRD Infotech | Tickets By Category Report</title>
      </Helmet>
      <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 2 }}>
        {isLoading ? (
          <Box
            sx={{ display: "flex", justifyContent: "center", py: 4 }}
            data-testid="tickets-by-category-loading"
          >
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Typography color="error" data-testid="tickets-by-category-error">
            Failed to load tickets by category.
          </Typography>
        ) : rows.length === 0 ? (
          <Typography
            data-testid="tickets-by-category-empty"
            sx={{ color: "text.secondary", py: 4, textAlign: "center" }}
          >
            No category data yet.
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
                  dataKey="CategoryName"
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
                <Bar dataKey="TicketCount" name="Tickets" fill={p.primary.main} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <TableContainer
              component={Paper}
              variant="outlined"
              data-testid="tickets-by-category-table"
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell align="right">Tickets</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.CategoryId}>
                      <TableCell>{r.CategoryName}</TableCell>
                      <TableCell align="right">{r.TicketCount}</TableCell>
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

export default TicketsByCategory;
