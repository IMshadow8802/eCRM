import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { ReportPage, ReportBarChart, ReportTable } from "./ReportShell";

const ConversionBySource = () => {
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-conversion-by-source"],
    endpoint: SALES_ENDPOINTS.reports.conversionBySource,
    params: {},
    retry: false,
  });

  const rows = data?.conversion ?? [];

  return (
    <ReportPage
      title="CONVERSION BY SOURCE REPORT"
      subtitle="Total leads vs won, per lead source."
      documentTitle="Conversion By Source Report"
      testId="conversion-by-source"
      isLoading={isLoading}
      error={error}
      isEmpty={rows.length === 0}
      errorText="Failed to load conversion by source."
      emptyText="No conversion data yet."
    >
      <ReportBarChart
        data={rows}
        xKey="SourceName"
        bars={[
          { key: "TotalLeads", name: "Total" },
          { key: "WonCount", name: "Won", tone: "success" },
        ]}
      />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.SourceId}
        testId="conversion-by-source-table"
        columns={[
          { header: "Source", cell: (r) => r.SourceName },
          { header: "Total", align: "right", cell: (r) => r.TotalLeads },
          { header: "Won", align: "right", cell: (r) => r.WonCount },
          {
            header: "Win Rate",
            align: "right",
            // Guarded because a source with no leads would divide by zero and
            // render "NaN%".
            cell: (r) =>
              r.TotalLeads ? `${Math.round((r.WonCount / r.TotalLeads) * 100)}%` : "—",
          },
        ]}
      />
    </ReportPage>
  );
};

export default ConversionBySource;
