// Config only — the frame is ReportPage. Keys are sp_RptTat's columns.
import ReportPage from "./ReportPage";
import { TEAM_REPORT_ENDPOINTS } from "../../api/reportQueries";

const GROUP_BYS = [
  { value: "person", label: "Person" },
  { value: "priority", label: "Priority" },
  { value: "workspace", label: "Workspace" },
  { value: "verdict_by", label: "Verdict given by" },
];
const DATE_BASES = [{ value: "assigned", label: "Assigned" }];
const PICKERS = ["branch", "owner"];

const KPIS = [
  { key: "Clocks", label: "Clocks", format: "int" },
  { key: "Closed", label: "Finished", format: "int" },
  { key: "OnTimePct", label: "On time (of finished)", format: "pct", tone: "success" },
  { key: "RanOver", label: "Ran over", format: "int", tone: "warning" },
  { key: "RanOverNotExcused", label: "Ran over, not excused", format: "int", tone: "error" },
  { key: "MedianWorkMin", label: "Median working time", format: "minutes", tone: "info" },
  { key: "P90WorkMin", label: "P90 working time", format: "minutes", tone: "info" },
];

const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Clocks", header: "Clocks", format: "int", align: "right" },
  { key: "Closed", header: "Closed", format: "int", align: "right" },
  { key: "OnTime", header: "On time", format: "int", align: "right" },
  { key: "OnTimePct", header: "On time %", format: "pct", align: "right" },
  { key: "RanOver", header: "Ran over", format: "int", align: "right" },
  { key: "RanOverNotExcused", header: "Ran over, not excused", format: "int", align: "right" },
  { key: "Excused", header: "Excused", format: "int", align: "right" },
  { key: "MedianWorkMin", header: "Median", format: "minutes", align: "right" },
  { key: "P90WorkMin", header: "P90", format: "minutes", align: "right" },
];

const TREND = {
  series: [
    { key: "Closed", label: "Closed", tone: "primary" },
    { key: "OnTime", label: "On time", tone: "success" },
    { key: "RanOver", label: "Ran over", tone: "warning" },
  ],
};

export default function TatReport() {
  return (
    <ReportPage
      reportKey="tat"
      title="TAT"
      subtitle="Task clocks assigned in the range: how many finished on time, and how long the working time took."
      endpoint={TEAM_REPORT_ENDPOINTS.tat}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      pickers={PICKERS}
      ownerPlaceholder="All people"
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={null}
    />
  );
}
