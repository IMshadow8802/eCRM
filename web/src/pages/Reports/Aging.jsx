// src/pages/Reports/Aging.jsx
//
// Config only — the frame is ReportPage. Every key below is a column name
// sp_RptAging actually returns (075_sales_reports.sql): RS1 the seven KPIs,
// RS2 GroupKey/GroupLabel + the same seven, RS3 Bucket/Open.
// The arrays are module-level constants: ReportPage feeds `groupBys` to a
// useMemo, so a fresh array each render would re-read the filters every time.
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { GROUP_PARAM, idFilters, leadsUrl } from "./reportUtils";

const GROUP_BYS = [
  { value: "owner", label: "Owner" },
  { value: "branch", label: "Branch" },
  { value: "team", label: "Team" },
];

// The tiles and table are a snapshot of what is open now; the range only
// drives the "open as of" trend, so there is no basis to choose.
const DATE_BASES = [{ value: "created", label: "Created" }];

const KPIS = [
  { key: "Open", label: "Open", format: "int" },
  { key: "Age0_7", label: "0–7 days", format: "int", tone: "success" },
  { key: "Age8_30", label: "8–30 days", format: "int", tone: "info" },
  { key: "Age31_90", label: "31–90 days", format: "int", tone: "warning" },
  { key: "Age90Plus", label: "90+ days", format: "int", tone: "error" },
  { key: "NoNextFollowUp", label: "Nothing scheduled", format: "int", tone: "error" },
  { key: "AvgDaysSinceTouch", label: "Days since touch", format: "days", tone: "warning" },
];

// GroupLabel carries no header: it inherits the active GroupBy's label.
// AvgDaysSinceTouch is NULL when a group has nothing open — it renders "—",
// never 0.0 d, which would read as "touched today".
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Open", header: "Open", format: "int", align: "right" },
  { key: "Age0_7", header: "0–7 d", format: "int", align: "right" },
  { key: "Age8_30", header: "8–30 d", format: "int", align: "right" },
  { key: "Age31_90", header: "31–90 d", format: "int", align: "right" },
  { key: "Age90Plus", header: "90+ d", format: "int", align: "right" },
  { key: "NoNextFollowUp", header: "No next follow-up", format: "int", align: "right" },
  { key: "AvgDaysSinceTouch", header: "Days since touch", format: "days", align: "right" },
];

const TREND = { series: [{ key: "Open", label: "Open", tone: "primary" }] };

// A snapshot is not a cohort: the drill shows the group's leads, no range.
// `team` has no Leads filter, so it drills to the whole list — unnarrowed, but
// still the right list.
const drill = (row, f) => {
  const key = GROUP_PARAM[f.groupBy];
  // The filter ids come along, or the drilled list is wider than the row said.
  return leadsUrl({ ...idFilters(f), ...(key ? { [key]: row.GroupKey } : {}) });
};

export default function Aging() {
  return (
    <ReportPage
      reportKey="aging"
      title="Aging"
      // The date chips stay on screen (they drive the chart), so the copy has
      // to say they do not touch the tiles or the table. A filter that looks
      // live and is not is worse than no filter.
      subtitle="Everything open as of today — how old it is, and what has nothing scheduled next. The date range does not change these tiles or the table; it only drives the chart, which replays the open count across that range."
      endpoint={SALES_ENDPOINTS.reports.aging}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
