import React, { useState } from "react";
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import dayjs from "dayjs";

import PageHeader from "../../components/PageHeader";
import DateField from "../../components/ui/DateField";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const CallsPerUser = () => {
  const theme = useTheme();
  const p = theme.tokens;

  const [dateFilters, setDateFilters] = useState({
    FromDate: dayjs().startOf("month").format("YYYY-MM-DD"),
    ToDate: dayjs().format("YYYY-MM-DD"),
  });

  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-calls-per-user", dateFilters],
    endpoint: SALES_ENDPOINTS.reports.callsPerUser,
    params: dateFilters,
    retry: false,
  });

  const rows = data?.calls ?? [];

  const dateFilterActions = (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
      <Box sx={{ width: 170 }}>
        <DateField
          label="From Date"
          value={dateFilters.FromDate}
          onChange={(next) =>
            setDateFilters((prev) => ({ ...prev, FromDate: next }))
          }
        />
      </Box>
      <Box sx={{ width: 170 }}>
        <DateField
          label="To Date"
          value={dateFilters.ToDate}
          onChange={(next) =>
            setDateFilters((prev) => ({ ...prev, ToDate: next }))
          }
        />
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="CALLS PER USER REPORT" actions={dateFilterActions} />
      <Helmet>
        <title>PRD Infotech | Calls Per User Report</title>
      </Helmet>
      <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 2 }}>
        {isLoading ? (
          <Box
            sx={{ display: "flex", justifyContent: "center", py: 4 }}
            data-testid="calls-per-user-loading"
          >
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Typography color="error" data-testid="calls-per-user-error">
            Failed to load calls per user.
          </Typography>
        ) : rows.length === 0 ? (
          <Typography
            data-testid="calls-per-user-empty"
            sx={{ color: "text.secondary", py: 4, textAlign: "center" }}
          >
            No calls logged in this range.
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
                  dataKey="FullName"
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
                <Bar dataKey="CallCount" name="Calls" fill={p.primary.main} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <TableContainer
              component={Paper}
              variant="outlined"
              data-testid="calls-per-user-table"
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>User</TableCell>
                    <TableCell align="right">Calls</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.UserId}>
                      <TableCell>{r.FullName}</TableCell>
                      <TableCell align="right">{r.CallCount}</TableCell>
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

export default CallsPerUser;
