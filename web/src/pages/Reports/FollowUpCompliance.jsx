// src/pages/Reports/FollowUpCompliance.jsx
//
// Config only — the frame is ReportPage. Every key below is a column
// sp_RptFollowUpCompliance actually returns (075_sales_reports.sql): RS1 the
// seven KPIs, RS2 GroupKey/GroupLabel + the same seven, RS3 Due/DoneOnTime/
// DoneLate/Missed (no Skipped — the trend leaves it out too).
// The arrays are module-level constants: ReportPage feeds `groupBys` to a
// useMemo, so a fresh array each render would re-read the filters every time.
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { GROUP_PARAM, idFilters, leadsUrl } from "./reportUtils";

const GROUP_BYS = [
  { value: "owner", label: "Owner" },
  { value: "team", label: "Team" },
  { value: "branch", label: "Branch" },
];

// The SP dates a follow-up on DueAt for 'created' and on COALESCE(DoneAt, DueAt)
// for 'activity'. 'closed' is the same expression as 'activity', so offering it
// would put two labels on one number.
const DATE_BASES = [
  { value: "created", label: "Due date" },
  { value: "activity", label: "Done date" },
];

// Missed counts follow-ups still open past their due date on a live lead
// (the SP gates it on the lead's status Code being open/qualified — a miss on a
// lost lead is not a miss anyone can act on). The drill lists LEADS, so a rep
// with two missed follow-ups on one lead shows 2 here and 1 there: the label
// says "follow-ups" so the two numbers are not read as the same count.
const KPIS = [
  { key: "Due", label: "Due", format: "int" },
  { key: "DoneOnTime", label: "On time", format: "int", tone: "success" },
  { key: "DoneLate", label: "Late", format: "int", tone: "warning" },
  { key: "Skipped", label: "Skipped", format: "int" },
  { key: "Missed", label: "Missed follow-ups", format: "int", tone: "error" },
  { key: "OnTimePct", label: "On-time %", format: "pct", tone: "success" },
  { key: "AvgDelayHours", label: "Avg delay", format: "hours", tone: "warning" },
];

// GroupLabel carries no header: it inherits the active GroupBy's label.
// On-time % is OnTime / (OnTime + Late + Skipped + Missed) — of everything that
// came due, not of what got done. Same formula as the Leaderboard, so the
// column means one thing across both reports. Avg delay is over the late ones
// only, and is NULL (renders "—") when nothing was late.
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Due", header: "Due", format: "int", align: "right" },
  { key: "DoneOnTime", header: "On time", format: "int", align: "right" },
  { key: "DoneLate", header: "Late", format: "int", align: "right" },
  { key: "Skipped", header: "Skipped", format: "int", align: "right" },
  { key: "Missed", header: "Missed", format: "int", align: "right" },
  { key: "OnTimePct", header: "On-time %", format: "pct", align: "right" },
  { key: "AvgDelayHours", header: "Avg delay", format: "hours", align: "right" },
];

const TREND = {
  series: [
    { key: "Due", label: "Due", tone: "primary" },
    { key: "DoneOnTime", label: "On time", tone: "success" },
    { key: "DoneLate", label: "Late", tone: "warning" },
    { key: "Missed", label: "Missed", tone: "error" },
  ],
};

// Missed is the actionable number, so the drill lands on that group's overdue
// leads rather than the default range-and-filters list. `team` has no Leads
// filter, so it drills to the whole overdue list — the right list, unnarrowed.
const drill = (row, f) => {
  const key = GROUP_PARAM[f.groupBy];
  // The filter ids come along, or the drilled list is wider than the row said.
  return leadsUrl({ ...idFilters(f), ...(key ? { [key]: row.GroupKey } : {}), Overdue: 1 });
};

export default function FollowUpCompliance() {
  return (
    <ReportPage
      reportKey="followUpCompliance"
      title="Follow-up Compliance"
      subtitle="Were follow-ups done when they were due? Late, skipped and missed, per rep. Click a row for their overdue leads."
      endpoint={SALES_ENDPOINTS.reports.followUpCompliance}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
