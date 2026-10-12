// src/pages/Reports/AttendanceReport.jsx
//
// Reports → Attendance (spec 2026-10-10 §2.4). Who came in, when, how late,
// who was absent or on leave, and how long they were online — a person × day
// month grid on the shared filter bar, with totals that say what they count.
import { Children, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { CalendarDays, Download, Timer, UserCheck, UserX, Wifi } from "lucide-react";
import dayjs from "dayjs";

import { Button, Card, IconBadge, Skeleton } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useIsAdmin } from "../../hooks/useAccess";
import { TEAM_REPORT_ENDPOINTS } from "../../api/reportQueries";
import SessionsDialog from "../Today/SessionsDialog";
import ReportFilters, { useReportFilters } from "./ReportFilters";
import AttendanceGrid, { LEGEND, Swatch, cellLabel, halves } from "./AttendanceGrid";
import { formatValue, toCsv } from "./reportUtils";

const ISO = "YYYY-MM-DD";
const MAX_DAYS = 62; // the server's limit too
const GROUP_BYS = [{ value: "person", label: "Person" }];
const DATE_BASES = [{ value: "created", label: "Date" }];
const PICKERS = ["branch", "owner"];
const month = (t) => ({ from: t.startOf("month").format(ISO), to: t.endOf("month").format(ISO) });
// Whole calendar months: future days of this month show blank, so the grid is the month.
const PRESETS = [
  { value: "month", label: "This month", range: month },
  { value: "lastmonth", label: "Last month", range: (t) => month(t.subtract(1, "month")) },
  { value: "custom", label: "Custom" },
];

// Three names fit one line; the rest go behind "+N more" (the full list is its tooltip).
const ABSENT_SHOWN = 3;
function AbsentNames({ list }) {
  const all = [...list].sort((a, b) => b.days - a.days).map((a) => `${a.FullName} ${a.days}`);
  const rest = all.length - ABSENT_SHOWN;
  return (
    <span data-testid="att-absent-names" title={rest > 0 ? all.join(" · ") : undefined}>
      {all.slice(0, ABSENT_SHOWN).join(" · ")}
      {rest > 0 && ` · +${rest} more`}
    </span>
  );
}

const mins = (v) => (v == null ? "—" : formatValue("minutes", v));

// Small, like Task deadlines' KPIs: icon badge | value, label, one detail line.
// Neutral card; an alarming number carries the colour itself.
function KpiCard({ label, icon, tone = "primary", testId, children }) {
  const p = useTheme().tokens;
  const [value, detail] = Children.toArray(children);
  return (
    <Card padding="sm" data-testid={testId} sx={{ display: "flex", alignItems: "center", gap: "calc(12rem / 15)", minWidth: 0 }}>
      <IconBadge icon={icon} tone={tone} size="lg" />
      <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {value}
        <Typography noWrap sx={{ fontSize: "calc(13rem / 15)", fontWeight: 600, color: p.text.secondary }}>{label}</Typography>
        {detail}
      </Box>
    </Card>
  );
}

export default function AttendanceReport() {
  const p = useTheme().tokens;
  const isAdmin = useIsAdmin();
  const { filters, update, rangeError } = useReportFilters({ groupBys: GROUP_BYS, dateBases: DATE_BASES, presets: PRESETS, defaultPreset: "month" });
  const span = dayjs(filters.to).diff(dayjs(filters.from), "day") + 1;
  const tooLong = span > MAX_DAYS;
  const body = { FromDate: filters.from, ToDate: filters.to, BranchId: filters.BranchId, OwnerId: filters.OwnerId };
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["report", "attendance", body],
    endpoint: TEAM_REPORT_ENDPOINTS.attendance,
    params: body,
    enabled: !tooLong && !rangeError,
    retry: false,
    showErrorMessage: false,
  });
  const k = data?.kpis ?? {};
  const days = data?.days ?? [];
  const rows = data?.rows ?? [];
  // Sign-ins are admin-only on the server (presence/fetchSessions is requireAdmin).
  const [sessions, setSessions] = useState(null);

  const big = { fontSize: "calc(22rem / 15)", fontWeight: 700, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" };
  const line = { fontSize: "calc(12rem / 15)", fontWeight: 500, color: p.text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const loading = (v) => (isLoading ? <Skeleton width={60} height={28} /> : v);

  const exportCsv = () => {
    const cols = [
      { key: "FullName", header: "Person" },
      { key: "Present", header: "Present" },
      { key: "WorkingDays", header: "Working days" },
      { key: "Late", header: "Late" },
      { key: "LateMinutes", header: "Late minutes" },
      { key: "Absent", header: "Absent" },
      { key: "Leave", header: "Leave" },
      { key: "LeftEarly", header: "Left early" },
      { key: "OnlineMedianMin", header: "Online (median min)" },
      { key: "ShiftMedianMin", header: "Shift (median min)" },
      ...days.map((d) => ({ key: d, header: d })),
    ];
    const flat = rows.map((r) => ({
      ...r,
      ...Object.fromEntries(r.cells.map((c) => [c.date, c.code === "future" || c.code === "before_start" ? "" : cellLabel(c)])),
    }));
    const blob = new Blob([toCsv(cols, flat)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${filters.from}-${filters.to}.csv`;
    a.click();
    // Revoking synchronously cancels the download in Firefox/Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 1.5, minWidth: 0 }}>
      <PageHeader
        title="Attendance"
        subtitle="Who came in, when, and for how long. Sign-in is the check-in."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Button variant="tonal" size="sm" leftIcon={<Download size={14} />} onClick={exportCsv} disabled={rows.length === 0} data-testid="report-export">
              Export CSV
            </Button>
            <HelpGuide guide={HELP_GUIDES.attendanceReport} />
          </Box>
        }
      />
      <Helmet>
        <title>PRD Infotech | Attendance</title>
      </Helmet>

      <ReportFilters filters={filters} update={update} groupBys={GROUP_BYS} dateBases={DATE_BASES} presets={PRESETS} pickers={PICKERS} ownerPlaceholder="All people" ownerLabel="Person">
        <Typography sx={{ ml: "auto", fontSize: "calc(12rem / 15)", color: p.text.secondary }}>
          {dayjs(filters.from).format("D MMM YYYY")} – {dayjs(filters.to).format("D MMM YYYY")}
        </Typography>
      </ReportFilters>

      {tooLong ? (
        <Typography role="alert" sx={{ color: p.error.hover, fontWeight: 600 }}>
          Pick {MAX_DAYS} days or fewer. This range has {span} days.
        </Typography>
      ) : rangeError ? null : error ? (
        <Typography role="alert" data-testid="att-error" sx={{ color: p.error.hover, fontWeight: 600 }}>
          {error?.response?.data?.message || error?.message || "Failed to load this report."}
        </Typography>
      ) : (
        <>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" } }}>
            <KpiCard label="Present" icon={UserCheck} tone="success" testId="att-kpi-present">
              <Box sx={big}>{loading(k.PresentPct == null ? "—" : `${Math.round(k.PresentPct)}%`)}</Box>
              <Typography sx={line}>{isLoading ? null : `${halves(k.PresentDays ?? 0)} of ${halves(k.WorkingDays ?? 0)} person-days`}</Typography>
            </KpiCard>
            <KpiCard label="Late arrivals" icon={Timer} tone="warning" testId="att-kpi-late">
              <Box sx={{ ...big, color: k.LateCount > 0 ? p.warning.text : p.text.primary }}>{loading(k.LateCount ?? 0)}</Box>
              <Typography sx={line}>
                {isLoading ? null : k.LateCount ? `total ${mins(k.LateMinutesTotal)} · median ${Math.round(k.LateMinutesMedian)} min` : "Nobody was late"}
              </Typography>
            </KpiCard>
            <KpiCard label="Absent (no sign-in)" icon={UserX} tone="error" testId="att-kpi-absent">
              <Box sx={{ ...big, color: k.Absent > 0 ? p.error.hover : p.text.primary }}>{loading(k.Absent ?? 0)}</Box>
              <Typography sx={line}>
                {isLoading ? null : k.Absent ? <AbsentNames list={k.AbsentTop ?? []} /> : "Nobody was absent"}
              </Typography>
            </KpiCard>
            <KpiCard label="Hours online" icon={Wifi} tone="info" testId="att-kpi-hours">
              <Box sx={big}>{loading(mins(k.OnlineMedianMin))}</Box>
              <Typography sx={line}>
                {isLoading || k.OnlineMedianMin == null ? null : `median per day signed in · shift is ${mins(k.ShiftMedianMin)}`}
              </Typography>
            </KpiCard>
          </Box>

          <Card padding="md" sx={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)", minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <IconBadge icon={CalendarDays} tone="primary" size="sm" />
                <Typography component="h2" sx={{ fontSize: "calc(16rem / 15)", fontWeight: 700 }}>
                  {span > 31 ? "At a glance" : "Month at a glance"}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: "calc(12rem / 15)", flexWrap: "wrap", color: p.text.secondary }} data-testid="att-legend">
                {LEGEND.map((code) => <Swatch key={code} code={code} />)}
              </Box>
            </Box>
            {isLoading ? (
              <Skeleton width="100%" height={120} />
            ) : rows.length === 0 ? (
              <Typography data-testid="att-empty" sx={{ color: p.text.secondary, py: 2, textAlign: "center" }}>Nobody to show in this range.</Typography>
            ) : (
              <AttendanceGrid days={days} rows={rows} onCellClick={isAdmin ? (r, date) => setSessions({ person: r, date }) : undefined} />
            )}
            <Typography sx={{ fontSize: "calc(12rem / 15)", color: p.text.secondary }}>
              {isAdmin ? "Click a day to see that person's sign-ins. " : ""}A ½ day counts as half a working day. Online is approximate and is not hours worked.
              A red dot on a name means late 3 working days in a row.
            </Typography>
          </Card>
        </>
      )}

      {sessions && <SessionsDialog open person={sessions.person} date={sessions.date} onClose={() => setSessions(null)} />}
    </Box>
  );
}
