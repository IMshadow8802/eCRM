// src/pages/Reports/Partners.jsx
//
// Config only — the frame is ReportPage. A caller without partners view gets
// no money keys back, so `hideMissing` drops those cards and columns rather
// than showing "₹0". Row drill is ReportPage's default (PartnerId + range).
import ReportPage from "./ReportPage";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const GROUP_BYS = [{ value: "partner", label: "Partner" }];

const KPIS = [
  { key: "LeadsSent", label: "Leads sent", format: "int", tone: "info" },
  { key: "Converted", label: "Converted", format: "int", tone: "success" },
  { key: "ConversionPct", label: "Conversion %", format: "pct", tone: "success" },
  { key: "WonValue", label: "Won value", format: "money" },
  { key: "Earned", label: "Earned", format: "money", tone: "info" },
  { key: "Due", label: "Due", format: "money", tone: "warning" },
  { key: "Paid", label: "Paid", format: "money", tone: "success" },
];

const COLUMNS = [
  { key: "GroupLabel" },
  { key: "LeadsSent", header: "Leads sent", format: "int", align: "right" },
  { key: "Converted", header: "Converted", format: "int", align: "right" },
  { key: "ConversionPct", header: "Conversion %", format: "pct", align: "right" },
  { key: "WonValue", header: "Won value", format: "money", align: "right" },
  { key: "Earned", header: "Earned", format: "money", align: "right" },
  { key: "Due", header: "Due", format: "money", align: "right" },
  { key: "Paid", header: "Paid", format: "money", align: "right" },
];

const TREND = {
  series: [
    { key: "LeadsSent", label: "Leads sent", tone: "info" },
    { key: "Converted", label: "Converted", tone: "success" },
  ],
};

export default function Partners() {
  return (
    <ReportPage
      reportKey="partners"
      title="Partners"
      subtitle="Leads each partner sent, how many converted, and the commission earned, due and paid."
      endpoint={SALES_ENDPOINTS.reports.partners}
      groupBys={GROUP_BYS}
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      hideMissing
    />
  );
}
