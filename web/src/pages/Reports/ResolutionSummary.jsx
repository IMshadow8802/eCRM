import { useApiQuery } from "../../hooks/useApiQuery";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { ReportShellPage, ReportBarChart, ReportTable } from "./ReportShell";

const ResolutionSummary = () => {
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-resolution-summary"],
    endpoint: SUPPORT_ENDPOINTS.reports.resolutionSummary,
    params: {},
    retry: false,
  });

  const rows = data?.resolutions ?? [];

  return (
    <ReportShellPage
      title="RESOLUTION SUMMARY REPORT"
      subtitle="Ticket count per resolution type."
      documentTitle="Resolution Summary Report"
      testId="resolution-summary"
      isLoading={isLoading}
      error={error}
      isEmpty={rows.length === 0}
      errorText="Failed to load resolution summary."
      emptyText="No resolution data yet."
    >
      <ReportBarChart
        data={rows}
        xKey="ResolutionName"
        bars={[{ key: "TicketCount", name: "Tickets" }]}
      />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.ResolutionId}
        testId="resolution-summary-table"
        columns={[
          { header: "Resolution", cell: (r) => r.ResolutionName },
          { header: "Tickets", align: "right", cell: (r) => r.TicketCount },
        ]}
      />
    </ReportShellPage>
  );
};

export default ResolutionSummary;
