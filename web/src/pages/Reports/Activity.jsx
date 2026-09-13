// src/pages/Reports/Activity.jsx
//
// Config only — the frame is ReportPage. Every key below is a column
// sp_RptActivity actually returns (075_sales_reports.sql): RS1 the eight
// KPIs, RS2 GroupKey/GroupLabel + the same measures, RS3 Calls/Visits/
// Meetings per bucket. The arrays are module-level constants: ReportPage
// feeds `groupBys` to a useMemo, so a fresh array each render would re-read
// the filters every time.
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { GROUP_PARAM, idFilters, leadsUrl } from "./reportUtils";

const GROUP_BYS = [
  { value: "owner", label: "Owner" },
  { value: "day", label: "Day" },
  { value: "team", label: "Team" },
  { value: "branch", label: "Branch" },
];

// An activity has one date — when it was done. The SP takes @DateBasis for
// the shared contract and ignores it, so a single entry hides the picker:
// offering a control that changes nothing would be a lie.
const DATE_BASES = [{ value: "activity", label: "Done date" }];

const KPIS = [
  { key: "Calls", label: "Calls", format: "int" },
  { key: "Visits", label: "Visits", format: "int", tone: "accent" },
  { key: "Meetings", label: "Meetings", format: "int", tone: "info" },
  { key: "Other", label: "Other", format: "int" },
  { key: "TalkMinutes", label: "Talk minutes", format: "int" },
  { key: "Inbound", label: "Inbound", format: "int" },
  { key: "Outbound", label: "Outbound", format: "int" },
  { key: "Connected", label: "Connected", format: "int", tone: "success" },
];

// GroupLabel carries no header: it inherits the active GroupBy's label.
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Calls", header: "Calls", format: "int", align: "right" },
  { key: "Visits", header: "Visits", format: "int", align: "right" },
  { key: "Meetings", header: "Meetings", format: "int", align: "right" },
  { key: "Other", header: "Other", format: "int", align: "right" },
  { key: "TalkMinutes", header: "Talk min", format: "int", align: "right" },
  { key: "Inbound", header: "Inbound", format: "int", align: "right" },
  { key: "Outbound", header: "Outbound", format: "int", align: "right" },
  { key: "Connected", header: "Connected", format: "int", align: "right" },
];

const TREND = {
  series: [
    { key: "Calls", label: "Calls", tone: "primary" },
    { key: "Visits", label: "Visits", tone: "accent" },
    { key: "Meetings", label: "Meetings", tone: "info" },
  ],
};

// Activity dates are DoneAt, not lead CreatedAt, so the drill carries no
// range — the default drill's from/to would filter the Leads list on the
// wrong date and hand back a shorter list than the row counted.
const drill = (row, f) => {
  const key = GROUP_PARAM[f.groupBy];
  // The filter ids come along, or the drilled list is wider than the row said.
  return leadsUrl({ ...idFilters(f), ...(key ? { [key]: row.GroupKey } : {}) });
};

export default function Activity() {
  return (
    <ReportPage
      reportKey="activity"
      title="Activity"
      subtitle="Calls, visits and meetings logged — per rep or per day. Click a row for that rep's leads."
      endpoint={SALES_ENDPOINTS.reports.activity}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
