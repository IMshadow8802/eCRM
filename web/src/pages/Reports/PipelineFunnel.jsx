import { useMemo } from "react";

import Funnel from "../../components/Charts/Funnel";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { ReportPage, ReportTable } from "./ReportShell";

const PipelineFunnel = () => {
  // sp_PipelineFunnel requires a PipelineId (no default) — resolve the
  // company's default lead pipeline and funnel that one.
  const { data: pipelinesData } = useApiQuery({
    queryKey: ["sales-pipelines", "lead"],
    endpoint: SALES_ENDPOINTS.config.fetchPipelines,
    params: { Entity: "lead" },
  });
  const pipelines = pipelinesData?.pipelines ?? [];
  const activePipeline = pipelines.find((p) => p.IsDefault) ?? pipelines[0] ?? null;
  const pipelineId = activePipeline?.Id ?? null;

  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-pipeline-funnel", pipelineId],
    endpoint: SALES_ENDPOINTS.reports.pipelineFunnel,
    params: { PipelineId: pipelineId },
    enabled: Boolean(pipelineId),
    retry: false,
  });

  const rows = data?.funnel ?? [];
  const chartData = useMemo(
    () => rows.map((r) => ({ name: r.StageName, value: r.LeadCount })),
    [rows]
  );

  return (
    <ReportPage
      title="PIPELINE FUNNEL REPORT"
      subtitle="Lead count per pipeline stage."
      documentTitle="Pipeline Funnel Report"
      testId="pipeline-funnel"
      isLoading={isLoading}
      error={error}
      isEmpty={rows.length === 0}
      errorText="Failed to load pipeline funnel."
      emptyText="No pipeline data yet."
    >
      {/* The one report that is not a bar chart — stage drop-off reads as a
          funnel, so it keeps the dedicated Charts/Funnel component. */}
      <Funnel data={chartData} height={280} />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.StageId}
        testId="pipeline-funnel-table"
        columns={[
          { header: "Stage", cell: (r) => r.StageName },
          { header: "Leads", align: "right", cell: (r) => r.LeadCount },
        ]}
      />
    </ReportPage>
  );
};

export default PipelineFunnel;
