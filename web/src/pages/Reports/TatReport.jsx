// Config only — the frame is ReportPage. Keys are sp_RptTat's columns.
import ReportPage from "./ReportPage";
import { HELP_GUIDES } from "../../data/helpGuides";
import { TEAM_REPORT_ENDPOINTS } from "../../api/reportQueries";

const GROUP_BYS = [
  { value: "person", label: "Person" },
  { value: "priority", label: "Priority" },
  { value: "workspace", label: "Workspace" },
  { value: "verdict_by", label: "Decided by" },
];
const DATE_BASES = [{ value: "assigned", label: "Assigned" }];
const PICKERS = ["branch", "owner"];

const KPIS = [
  { key: "Clocks", label: "Tasks", format: "int", hint: "How many tasks were started in this period. Each person on a task counts separately." },
  { key: "Closed", label: "Finished", format: "int", hint: "Tasks whose work is done." },
  { key: "OnTimePct", label: "On time (of finished)", format: "pct", tone: "success", hint: "Out of the finished work, the share that was done before the deadline." },
  { key: "RanOver", label: "Missed deadline", format: "int", tone: "warning", hint: "Tasks that went past the deadline." },
  { key: "RanOverNotExcused", label: "Missed, delay rejected", format: "int", tone: "error", hint: "Went past the deadline and the delay was rejected (or no decision yet)." },
  { key: "MedianWorkMin", label: "Typical working time", format: "minutes", tone: "info", hint: "The middle value: half the tasks took less working time than this. Breaks, weekends and holidays are not counted." },
  { key: "P90WorkMin", label: "Slowest 10% took", format: "minutes", tone: "info", hint: "9 out of 10 tasks took less working time than this. It shows the slow ones." },
];

const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Clocks", header: "Tasks", format: "int", align: "right", hint: "Tasks started in this period." },
  { key: "Closed", header: "Finished", format: "int", align: "right", hint: "Tasks whose work is done." },
  { key: "OnTime", header: "On time", format: "int", align: "right", hint: "Done before the deadline." },
  { key: "OnTimePct", header: "On time %", format: "pct", align: "right", hint: "Share of finished work done before the deadline." },
  { key: "RanOver", header: "Missed deadline", format: "int", align: "right", hint: "Tasks that went past the deadline." },
  { key: "RanOverNotExcused", header: "Missed, delay rejected", format: "int", align: "right", hint: "Late, and the delay was rejected (or no decision yet)." },
  { key: "Excused", header: "Delay accepted", format: "int", align: "right", hint: "Late, but a manager accepted the delay." },
  { key: "MedianWorkMin", header: "Typical time", format: "minutes", align: "right", hint: "Middle working time: half the tasks took less." },
  { key: "P90WorkMin", header: "Slowest 10%", format: "minutes", align: "right", hint: "9 out of 10 tasks took less working time than this." },
];

const TREND = {
  series: [
    { key: "Closed", label: "Finished", tone: "primary", hint: "Tasks whose work is done." },
    { key: "OnTime", label: "On time", tone: "success", hint: "Done before the deadline." },
    { key: "RanOver", label: "Missed deadline", tone: "warning", hint: "Tasks that went past the deadline." },
  ],
};

export default function TatReport() {
  return (
    <ReportPage
      guide={HELP_GUIDES.tatReport}
      reportKey="tat"
      title="Task deadlines"
      subtitle="Tasks assigned in the range: how many finished on time, and how long the working time took."
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
