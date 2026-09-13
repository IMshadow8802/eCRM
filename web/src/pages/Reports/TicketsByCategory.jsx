import { useApiQuery } from "../../hooks/useApiQuery";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { ReportShellPage, ReportBarChart, ReportTable } from "./ReportShell";

const TicketsByCategory = () => {
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-tickets-by-category"],
    endpoint: SUPPORT_ENDPOINTS.reports.ticketsByCategory,
    params: {},
    retry: false,
  });

  const rows = data?.categories ?? [];

  return (
    <ReportShellPage
      title="TICKETS BY CATEGORY REPORT"
      subtitle="Ticket count per category."
      documentTitle="Tickets By Category Report"
      testId="tickets-by-category"
      isLoading={isLoading}
      error={error}
      isEmpty={rows.length === 0}
      errorText="Failed to load tickets by category."
      emptyText="No category data yet."
    >
      <ReportBarChart
        data={rows}
        xKey="CategoryName"
        bars={[{ key: "TicketCount", name: "Tickets" }]}
      />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.CategoryId}
        testId="tickets-by-category-table"
        columns={[
          { header: "Category", cell: (r) => r.CategoryName },
          { header: "Tickets", align: "right", cell: (r) => r.TicketCount },
        ]}
      />
    </ReportShellPage>
  );
};

export default TicketsByCategory;
