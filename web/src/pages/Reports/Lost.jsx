// src/pages/Reports/Lost.jsx
//
// Config only — the frame is ReportPage. Every key below is a column
// sp_RptLost actually returns (075_sales_reports.sql): RS1 Lost/LostPct/
// TopReason, RS2 GroupKey/GroupLabel (the reason) + SubKey/SubLabel (the
// second grouping) + Lost/LostPct, RS3 Bucket/Lost. The arrays are
// module-level constants: ReportPage feeds `groupBys` to a useMemo, so a
// fresh array each render would re-read the filters every time.
//
// Note the deliberate disagreement with the Funnel report: sp_RptFunnel
// counts Lost from the status history, this counts the lead's current
// status, so a lead lost and later reopened is in Funnel's Lost and not
// here. Ruled at the Task 2 review — do not "reconcile" the two numbers.
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { GROUP_PARAM, drillRange, idFilters, leadsUrl } from "./reportUtils";

const GROUP_BYS = [
  { value: "reason", label: "Reason" },
  { value: "source", label: "Source" },
  { value: "product", label: "Product" },
  { value: "owner", label: "Owner" },
  { value: "branch", label: "Branch" },
];

const KPIS = [
  { key: "Lost", label: "Lost", format: "int", tone: "error" },
  { key: "LostPct", label: "Lost %", format: "pct", tone: "error" },
  { key: "TopReason", label: "Top reason", format: "text", tone: "warning" },
];

// GroupLabel is always the reason (the SP's first key); SubLabel is the
// second key and carries no header, so it inherits the active GroupBy's
// label — and reads "—" when that grouping is the reason itself. Both keys
// are explicit because ReportTable keys columns on `key ?? header` and both
// of these render under "Reason".
const COLUMNS = [
  { key: "GroupLabel", header: "Reason" },
  { key: "SubLabel" },
  { key: "Lost", header: "Lost", format: "int", align: "right" },
  { key: "LostPct", header: "Share %", format: "pct", align: "right" },
];

const TREND = { series: [{ key: "Lost", label: "Lost", tone: "error" }] };

// The group's lost leads. StatusCode=lost is the one code leadsParamsToState
// parses; the sub-group's id narrows it further where the Leads list has a
// filter for it. leadsUrl drops a null SubKey, which is what the SP returns
// when the grouping is the reason.
const drill = (row, f) => {
  const key = GROUP_PARAM[f.groupBy];
  return leadsUrl({
    StatusCode: "lost",
    // Only when the range means CreatedAt on both sides: this page defaults to
    // the `closed` basis, and sp_FetchLeads narrows on CreatedAt.
    ...drillRange(f),
    ...idFilters(f),
    ...(key ? { [key]: row.SubKey } : {}),
  });
};

export default function Lost() {
  return (
    <ReportPage
      reportKey="lost"
      title="Lost Analysis"
      subtitle="Why leads are lost, and where. Group by source, product, owner or branch to see which reason hits which. Click a row for the leads."
      endpoint={SALES_ENDPOINTS.reports.lost}
      groupBys={GROUP_BYS}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={drill}
      // Lost keyed on when the lead was CREATED answers a question nobody asked;
      // the SP resolves `closed` to MAX(ChangedAt) over qualified|lost|junk.
      defaultBasis="closed"
    />
  );
}
