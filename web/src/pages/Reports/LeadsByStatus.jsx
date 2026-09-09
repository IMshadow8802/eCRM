import { useMemo } from "react";

import Funnel from "../../components/Charts/Funnel";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { ReportPage, ReportTable } from "./ReportShell";

// Replaces Pipeline Funnel. Same chart; the x-axis is now the status list the
// company edits in Settings › Lookups, not a pipeline's stages.
const LeadsByStatus = () => {
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-leads-by-status"],
    endpoint: SALES_ENDPOINTS.reports.leadsByStatus,
    params: {},
    retry: false,
  });
  const rows = data?.statuses ?? [];
  const chartData = useMemo(() => rows.map((r) => ({ name: r.StatusName, value: r.LeadCount })), [rows]);

  return (
    <ReportPage
      title="LEADS BY STATUS"
      subtitle="How many leads sit in each status right now."
      documentTitle="Leads by Status"
      testId="leads-by-status"
      isLoading={isLoading}
      error={error}
      isEmpty={rows.length === 0}
      errorText="Failed to load leads by status."
      emptyText="No leads yet."
    >
      <Funnel data={chartData} height={280} />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.StatusId}
        testId="leads-by-status-table"
        columns={[
          { header: "Status", cell: (r) => r.StatusName },
          { header: "Kind", cell: (r) => r.StatusCode },
          { header: "Leads", align: "right", cell: (r) => r.LeadCount },
        ]}
      />
    </ReportPage>
  );
};

export default LeadsByStatus;
