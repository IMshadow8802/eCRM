// src/pages/Reports/Transfers.jsx
//
// Config only — the frame is ReportPage. Every key below is a column name
// sp_RptTransfers actually returns (075_sales_reports.sql): RS1 Transfers/
// CrossBranch/SendBacks/Unassigns, RS2 GroupKey/GroupLabel/SubKey/SubLabel +
// the same four, RS3 Bucket/Transfers.
// The arrays are module-level constants: ReportPage feeds `groupBys` to a
// useMemo, so a fresh array each render would re-read the filters every time.
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { idFilters, leadsUrl } from "./reportUtils";

// `pair` is bespoke to this report — it is not in the spec's §3 GroupBy list,
// and the SP whitelists exactly reason | pair | branch (anything else
// RAISERRORs), so this array must not grow without the SP growing first.
const GROUP_BYS = [
  { value: "reason", label: "Reason" },
  { value: "pair", label: "From → To" },
  { value: "branch", label: "Branch" },
];

// A transfer has one date — when it happened. The SP ignores @DateBasis, so
// this stays a single entry and the frame hides the picker: a control that
// changes nothing is a lie about what the report can do.
const DATE_BASES = [{ value: "created", label: "Transferred" }];

// SendBacks counts transfer_reason rows whose immutable Code is 'sent_back',
// not the editable label — renaming the reason in Settings must not zero it.
const KPIS = [
  { key: "Transfers", label: "Transfers", format: "int" },
  { key: "CrossBranch", label: "Cross-branch", format: "int", tone: "warning" },
  { key: "SendBacks", label: "Sent back", format: "int", tone: "error" },
  { key: "Unassigns", label: "Unassigned", format: "int", tone: "info" },
];

// GroupLabel carries no header: it inherits the active GroupBy's label.
const COLUMNS = [
  { key: "GroupLabel" },
  { key: "Transfers", header: "Transfers", format: "int", align: "right" },
  { key: "CrossBranch", header: "Cross-branch", format: "int", align: "right" },
  { key: "SendBacks", header: "Send-backs", format: "int", align: "right" },
  { key: "Unassigns", header: "Unassigns", format: "int", align: "right" },
];

const TREND = { series: [{ key: "Transfers", label: "Transfers", tone: "primary" }] };

// Who holds the lead now is what a manager wants to inspect: the receiving rep
// for a pair (SubKey — GroupKey is the sender), the receiving branch for a
// branch. A reason has no owner, so it drills to the plain list. Never a date
// range: an assignment date is not a lead-created date, which is what the
// Leads list filters on.
const drill = (row, f) => {
  // The filter ids come along, or the drilled list is wider than the row said;
  // the row's own key is spread last so it wins over a filter on the same id.
  if (f.groupBy === "pair") return leadsUrl({ ...idFilters(f), OwnerId: row.SubKey });
  if (f.groupBy === "branch") return leadsUrl({ ...idFilters(f), BranchId: row.GroupKey });
  return leadsUrl(idFilters(f));
};

export default function Transfers() {
  return (
    <ReportPage
      reportKey="transfers"
      title="Transfers"
      subtitle="Leads changing hands: why, between whom, and across which branches. Click a row to see who holds them now."
      endpoint={SALES_ENDPOINTS.reports.transfers}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
    />
  );
}
