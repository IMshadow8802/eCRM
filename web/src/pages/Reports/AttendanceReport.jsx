// Config only — the frame is ReportPage. One row per person.
import ReportPage from "./ReportPage";
import { TEAM_REPORT_ENDPOINTS } from "../../api/reportQueries";

const GROUP_BYS = [{ value: "person", label: "Person" }];
const DATE_BASES = [{ value: "created", label: "Date" }];

const KPIS = [
  { key: "People", label: "People", format: "int" },
  { key: "WorkingDays", label: "Working days", format: "int" },
  { key: "PresentDays", label: "Present", format: "int", tone: "success" },
  { key: "LateDays", label: "Late days", format: "int", tone: "warning" },
  { key: "MedianLateMin", label: "Median late", format: "minutes", tone: "warning" },
  { key: "NotSignedInDays", label: "Not signed in", format: "int", tone: "error" },
];

const COLUMNS = [
  { key: "GroupLabel" },
  { key: "WorkingDays", header: "Working days", format: "int", align: "right" },
  { key: "PresentDays", header: "Present", format: "int", align: "right" },
  { key: "LateDays", header: "Late", format: "int", align: "right" },
  { key: "MedianLateMin", header: "Median late", format: "minutes", align: "right" },
  { key: "NotSignedInDays", header: "Not signed in", format: "int", align: "right" },
];

const TREND = {
  series: [
    { key: "Present", label: "Present", tone: "success" },
    { key: "Late", label: "Late", tone: "warning" },
    { key: "NotSignedIn", label: "Not signed in", tone: "error" },
  ],
};

export default function AttendanceReport() {
  return (
    <ReportPage
      reportKey="attendance"
      title="Attendance"
      subtitle="Sign-ins against working days: present, late and not signed in, per person."
      endpoint={TEAM_REPORT_ENDPOINTS.attendance}
      groupBys={GROUP_BYS}
      dateBases={DATE_BASES}
      pickers={["branch", "owner"]}
      ownerPlaceholder="All people"
      kpis={KPIS}
      columns={COLUMNS}
      trend={TREND}
      drill={null}
    />
  );
}
