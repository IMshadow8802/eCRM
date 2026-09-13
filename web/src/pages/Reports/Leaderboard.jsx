// src/pages/Reports/Leaderboard.jsx
//
// Config only — the frame is ReportPage. Every key below is a column
// sp_RptLeaderboard actually returns (075_sales_reports.sql): RS2 is
// GroupKey/GroupLabel/Created/Qualified/Activities/OnTimePct/
// AvgResponseHours/Rank, and RS1 and RS3 are deliberately empty — a
// leaderboard is its table, so there is no KPI strip and no trend to draw.
// The arrays are module-level constants: ReportPage feeds `groupBys` to a
// useMemo, so a fresh array each render would re-read the filters every time.
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

// Matches the SP's @GroupBy whitelist exactly — it takes 'owner' and nothing
// else, and anything else RAISERRORs. One entry also hides the tabs: ranking
// reps is the whole report, so there is no second view to switch to.
const GROUP_BYS = [{ value: "owner", label: "Rep" }];

// A lead is dated on CreatedAt and an activity on DoneAt; the SP takes
// @DateBasis for the shared contract and ignores it. One entry hides the
// picker — offering a control that changes nothing would be a lie.
const DATE_BASES = [{ value: "created", label: "Created date" }];

// GroupLabel carries no header: it inherits the active GroupBy's label ("Rep").
// On-time % is OnTime / (OnTime + Late + Skipped + Missed) — of everything that
// came due, not of what got done, which is the same formula the Follow-up
// Compliance report uses, so the column means one thing across both. The number
// comes out lower than "% of completed" would; that is the honest figure.
// OnTimePct and AvgResponseHours are NULL for a rep with no follow-ups / no
// first touch and render "—"; never coerce them to 0, which would rank a rep
// who did nothing as the slowest rather than the unmeasured.
const COLUMNS = [
  { key: "Rank", header: "#", format: "int" },
  { key: "GroupLabel" },
  // "Leads", not "Created": the SP counts leads created in the range that the
  // rep owns NOW, so a transferred lead is credited to whoever holds it today.
  // Heading it "Created" reads as "this rep created them", which is not true.
  { key: "Created", header: "Leads", format: "int", align: "right" },
  { key: "Qualified", header: "Qualified", format: "int", align: "right" },
  { key: "Activities", header: "Activities", format: "int", align: "right" },
  { key: "OnTimePct", header: "On-time %", format: "pct", align: "right" },
  { key: "AvgResponseHours", header: "Avg response", format: "hours", align: "right" },
];

export default function Leaderboard() {
  return (
    <ReportPage
      reportKey="leaderboard"
      title="Leaderboard"
      subtitle="Reps ranked by qualified leads, then activity. Leads counts what a rep holds now, so a transferred lead moves with it. Click a rep for their leads in this range."
      endpoint={SALES_ENDPOINTS.reports.leaderboard}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      columns={COLUMNS}
    />
  );
}
