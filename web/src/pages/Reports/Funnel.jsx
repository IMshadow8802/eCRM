// src/pages/Reports/Funnel.jsx
//
// Config only — the frame is ReportPage. Every key below is a column name
// sp_RptFunnel actually returns (075_sales_reports.sql): RS1 the nine KPIs,
// RS2 GroupKey/GroupLabel + the same measures, RS3 Created/Qualified/Lost.
// The arrays are module-level constants: ReportPage feeds `groupBys` to a
// useMemo, so a fresh array each render would re-read the filters every time.
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const GROUP_BYS = [
  { value: "source", label: "Source" },
  { value: "owner", label: "Owner" },
  { value: "product", label: "Product" },
  { value: "branch", label: "Branch" },
  { value: "status", label: "Status" },
  { value: "team", label: "Team" },
];

const KPIS = [
  { key: "Created", label: "Created", format: "int" },
  { key: "Contacted", label: "Contacted", format: "int" },
  { key: "Qualified", label: "Qualified", format: "int", tone: "success" },
  { key: "Lost", label: "Lost", format: "int", tone: "error" },
  { key: "Junk", label: "Junk", format: "int" },
  { key: "QualifiedPct", label: "Qualified %", format: "pct", tone: "success" },
  { key: "LostPct", label: "Lost %", format: "pct", tone: "error" },
  { key: "AvgDaysToContact", label: "Days to contact", format: "days", tone: "info" },
  { key: "AvgDaysToQualify", label: "Days to qualify", format: "days", tone: "info" },
];

// GroupLabel carries no header: it inherits the active GroupBy's label.
// AvgDaysToContact is a KPI only — it is in RS2 too, but nine columns is
// already a wide table and the per-group speed that matters is to qualify.
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Created", header: "Created", format: "int", align: "right" },
  { key: "Contacted", header: "Contacted", format: "int", align: "right" },
  { key: "Qualified", header: "Qualified", format: "int", align: "right" },
  { key: "Lost", header: "Lost", format: "int", align: "right" },
  { key: "Junk", header: "Junk", format: "int", align: "right" },
  { key: "QualifiedPct", header: "Qualified %", format: "pct", align: "right" },
  { key: "LostPct", header: "Lost %", format: "pct", align: "right" },
  { key: "AvgDaysToQualify", header: "Days to qualify", format: "days", align: "right" },
];

const TREND = {
  series: [
    { key: "Created", label: "Created", tone: "primary" },
    { key: "Qualified", label: "Qualified", tone: "success" },
    { key: "Lost", label: "Lost", tone: "error" },
  ],
};

export default function Funnel() {
  return (
    <ReportPage
      reportKey="funnel"
      title="Funnel"
      subtitle="Created → contacted → qualified, and how long each step takes. Click a row to see those leads."
      endpoint={SALES_ENDPOINTS.reports.funnel}
      groupBys={GROUP_BYS}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
    />
  );
}
