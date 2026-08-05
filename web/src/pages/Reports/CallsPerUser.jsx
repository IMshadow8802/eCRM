import { useState } from "react";
import { Box } from "@mui/material";
import dayjs from "dayjs";

import DateField from "../../components/ui/DateField";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { ReportPage, ReportBarChart, ReportTable } from "./ReportShell";

const CallsPerUser = () => {
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

  const setDate = (key) => (next) =>
    setDateFilters((prev) => ({ ...prev, [key]: next }));

  const dateFilterActions = (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
      <Box sx={{ width: 170 }}>
        <DateField label="From Date" value={dateFilters.FromDate} onChange={setDate("FromDate")} />
      </Box>
      <Box sx={{ width: 170 }}>
        <DateField label="To Date" value={dateFilters.ToDate} onChange={setDate("ToDate")} />
      </Box>
    </Box>
  );

  return (
    <ReportPage
      title="CALLS PER USER REPORT"
      documentTitle="Calls Per User Report"
      testId="calls-per-user"
      actions={dateFilterActions}
      isLoading={isLoading}
      error={error}
      isEmpty={rows.length === 0}
      errorText="Failed to load calls per user."
      emptyText="No calls logged in this range."
    >
      {/* No legend: a single series named by the column header already. */}
      <ReportBarChart
        data={rows}
        xKey="FullName"
        legend={false}
        bars={[{ key: "CallCount", name: "Calls" }]}
      />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.UserId}
        testId="calls-per-user-table"
        columns={[
          { header: "User", cell: (r) => r.FullName },
          { header: "Calls", align: "right", cell: (r) => r.CallCount },
        ]}
      />
    </ReportPage>
  );
};

export default CallsPerUser;
