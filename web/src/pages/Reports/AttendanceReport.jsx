// Config only — the frame is ReportPage. One row per person.
import ReportPage from "./ReportPage";
import { HELP_GUIDES } from "../../data/helpGuides";
import { TEAM_REPORT_ENDPOINTS } from "../../api/reportQueries";

const GROUP_BYS = [{ value: "person", label: "Person" }];
const DATE_BASES = [{ value: "created", label: "Date" }];

const KPIS = [
  { key: "People", label: "People", format: "int" },
  { key: "WorkingDays", label: "Working days", format: "int", hint: "Days the person was expected to work on their shift. Holidays and marked leave are not counted." },
  { key: "PresentDays", label: "Present", format: "int", tone: "success", hint: "Days the person signed in. Days marked On duty count as present." },
  { key: "LateDays", label: "Late days", format: "int", tone: "warning", hint: "Days the person signed in after the 'count as late after' time." },
  { key: "MedianLateMin", label: "Typically late by", format: "minutes", tone: "warning", hint: "On late days, the middle value of how late they were." },
  { key: "NotSignedInDays", label: "Not signed in", format: "int", tone: "error", hint: "Working days when the person did not sign in." },
];

const COLUMNS = [
  { key: "GroupLabel" },
  { key: "WorkingDays", header: "Working days", format: "int", align: "right", hint: "Days expected to work. Holidays and leave excluded." },
  { key: "PresentDays", header: "Present", format: "int", align: "right", hint: "Days signed in. On duty counts as present." },
  { key: "LateDays", header: "Late", format: "int", align: "right", hint: "Days signed in after the 'count as late after' time." },
  { key: "MedianLateMin", header: "Typically late by", format: "minutes", align: "right", hint: "On late days, the middle value of how late they were." },
  { key: "NotSignedInDays", header: "Not signed in", format: "int", align: "right", hint: "Working days with no sign-in." },
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
      guide={HELP_GUIDES.attendanceReport}
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
