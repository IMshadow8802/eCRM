// src/pages/Reports/PipelineValue.jsx
//
// Config only — the frame is ReportPage. Every key below is a column
// sp_RptPipelineValue actually returns (075_sales_reports.sql): RS1
// OpenValue/QualifiedValue/LostValue/OpenCount/AvgValue, RS2 GroupKey/
// GroupLabel/Count/Value, RS3 Bucket/OpenValue. The arrays are module-level
// constants: ReportPage feeds `groupBys` to a useMemo, so a fresh array each
// render would re-read the filters every time.
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

// Matches the SP's @GroupBy whitelist exactly — anything else RAISERRORs.
const GROUP_BYS = [
  { value: "status", label: "Status" },
  { value: "owner", label: "Owner" },
  { value: "product", label: "Product" },
  { value: "branch", label: "Branch" },
];

// AvgValue is AVG over the leads still in play and is NULL on an empty set —
// formatValue renders that as "—". It must never be coerced to 0: "₹0.00 per
// lead" is a claim about the pipeline's worth, "—" is the absence of one.
const KPIS = [
  { key: "OpenValue", label: "Open value", format: "money" },
  { key: "QualifiedValue", label: "Qualified value", format: "money", tone: "success" },
  { key: "LostValue", label: "Lost value", format: "money", tone: "error" },
  { key: "OpenCount", label: "Open leads", format: "int", tone: "info" },
  { key: "AvgValue", label: "Avg per lead", format: "money", tone: "info" },
];

// GroupLabel carries no header: it inherits the active GroupBy's label.
// Count and Value do not move together — the SP keeps EstValue raw and applies
// ISNULL only inside the SUMs, so a lead with no estimate is counted here and
// adds nothing to Value. No page-side arithmetic assumes otherwise.
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Count", header: "Leads", format: "int", align: "right" },
  { key: "Value", header: "Value", format: "money", align: "right" },
];

const TREND = { series: [{ key: "OpenValue", label: "Open value", tone: "success" }] };

export default function PipelineValue() {
  return (
    <ReportPage
      reportKey="pipelineValue"
      title="Pipeline Value"
      subtitle="Estimated value in play, qualified, and lost — by status, owner, product or branch. Click a row to see those leads."
      endpoint={SALES_ENDPOINTS.reports.pipelineValue}
      groupBys={GROUP_BYS}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
    />
  );
}
