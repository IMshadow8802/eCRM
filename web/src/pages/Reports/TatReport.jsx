// src/pages/Reports/TatReport.jsx
//
// Reports → Task deadlines (spec 2026-10-10 §2.3). Built for the owner's glance
// (2026-10-11 ruling): four small numbers, then one row per person that says in
// words and colour whether they need action. Every count opens the timers
// behind it (ClocksDrawer).
import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { AlertTriangle, CircleCheck, Download, Gavel, ShieldAlert, Users } from "lucide-react";
import dayjs from "dayjs";

import { Button, Card, Chip, IconBadge, Skeleton } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import { useApiQuery } from "../../hooks/useApiQuery";
import { TEAM_REPORT_ENDPOINTS } from "../../api/reportQueries";
import { overByLong, parseIst } from "../../utils/tatChip";
import ReportFilters, { useReportFilters } from "./ReportFilters";
import { ReportTable } from "./ReportShell";
import ClocksDrawer from "./ClocksDrawer";
import { toBody, toCsv } from "./reportUtils";

const GROUP_BYS = [
  { value: "person", label: "Person" },
  { value: "priority", label: "Priority" },
  { value: "workspace", label: "Board" },
];
// The server's only basis; the page counts by finish day (spec §2.3) whatever it is called.
const DATE_BASES = [{ value: "assigned", label: "Assigned" }];
const PICKERS = ["branch", "owner"];
const ON_TIME_GOAL = 85; // an on-time share below this is amber

const METRIC = {
  finished: "Finished",
  ontime: "On time",
  missed: "Missed deadline",
  not_excused: "Not excused",
  excused: "Excused",
  no_decision: "No decision yet",
  reason_pending: "Reason pending",
  overdue_now: "Overdue right now",
};

const CSV_COLUMNS = [
  ["GroupLabel", null],
  ["Finished", "Finished"],
  ["OnTime", "On time"],
  ["OnTimePct", "On time %"],
  ["Missed", "Missed"],
  ["NotExcused", "Not excused"],
  ["Excused", "Excused"],
  ["NoDecision", "No decision"],
  ["ReasonPending", "Reason pending"],
  ["OverdueNow", "Overdue now"],
  ["MedianUsedPct", "Time used % (median)"],
];

const pct = (v) => (v == null ? "—" : `${Math.round(v)}%`);
const share = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

/**
 * A count that opens its timers. Zero (or nothing) is grey and inert: there is
 * no list behind it. `name` is the accessible name ("Not excused: 3").
 */
function Num({ count, name, color, onOpen, children, sx }) {
  const p = useTheme().tokens;
  const shown = children ?? count ?? "—";
  if (!count) return <Box component="span" sx={{ color: p.text.tertiary, fontWeight: 500, ...sx }}>{shown}</Box>;
  return (
    <Box
      component="button"
      type="button"
      aria-label={name}
      onClick={onOpen}
      sx={{
        all: "unset",
        cursor: "pointer",
        fontWeight: 700,
        color: color ?? p.text.primary,
        borderRadius: "calc(4rem / 15)",
        "&:hover": { textDecoration: "underline" },
        "&:focus-visible": { outline: `2px solid ${p.border.focus}`, outlineOffset: "calc(2rem / 15)" },
        ...sx,
      }}
    >
      {shown}
    </Box>
  );
}

// Neutral card; the alarming number is red itself (data-alert marks it for tests).
/**
 * One small KPI: icon badge, a one-line value, a one-line label. The whole
 * card opens its timers when there is something behind it.
 */
function Kpi({ label, sub, icon, tone, value, valueColor, count, name, onOpen, testId, loading, title }) {
  const p = useTheme().tokens;
  const live = Boolean(count) && !loading;
  return (
    <Card
      padding="sm"
      data-testid={testId}
      title={title}
      onClick={live ? onOpen : undefined}
      aria-label={live ? name : undefined}
      sx={{ display: "flex", alignItems: "center", gap: "calc(12rem / 15)", minWidth: 0 }}
    >
      <IconBadge icon={icon} tone={tone} size="lg" />
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: "calc(6rem / 15)", flexWrap: "wrap" }}>
          <Box component="span" sx={{ fontSize: "calc(22rem / 15)", fontWeight: 700, lineHeight: 1.15, fontVariantNumeric: "tabular-nums", color: loading ? undefined : valueColor ?? p.text.primary }}>
            {loading ? <Skeleton width={48} height={24} /> : value}
          </Box>
          {!loading && sub && <Box component="span" sx={{ fontSize: "calc(12rem / 15)", color: p.text.secondary, fontWeight: 500 }}>{sub}</Box>}
        </Box>
        <Typography noWrap sx={{ fontSize: "calc(13rem / 15)", fontWeight: 600, color: p.text.secondary }}>{label}</Typography>
      </Box>
    </Card>
  );
}

// Health, in one word and one colour. Red: something is late or was late
// without excuse. Amber: a reason or a decision is owed. Green: on track.
// Grey: nothing in the range at all.
const HEALTH = {
  red: { rank: 0, label: "Needs action", tone: "error" },
  amber: { rank: 1, label: "Waiting", tone: "warning" },
  green: { rank: 2, label: "On track", tone: "success" },
  grey: { rank: 3, label: "No tasks", tone: "default" },
};
function healthOf(r) {
  if (r.OverdueNow > 0 || r.NotExcused > 0) return "red";
  if (r.ReasonPending > 0 || r.NoDecision > 0) return "amber";
  if (r.Finished > 0 || r.Missed > 0) return "green";
  return "grey";
}
// Worst first: red by overdue (then not excused), then amber, green, grey; server order within ties.
const worstFirst = (a, b) =>
  HEALTH[healthOf(a)].rank - HEALTH[healthOf(b)].rank ||
  (healthOf(a) === "red" ? b.OverdueNow - a.OverdueNow || b.NotExcused - a.NotExcused : 0);

/** "a · b" from the parts that are not zero; "—" when all are. */
function Parts({ children }) {
  const p = useTheme().tokens;
  const shown = children.filter(Boolean);
  if (!shown.length) return <Box component="span" sx={{ color: p.text.tertiary }}>—</Box>;
  return (
    <Box component="span" sx={{ display: "inline-flex", gap: "calc(6rem / 15)", flexWrap: "wrap", alignItems: "baseline" }}>
      {shown.flatMap((el, i) => (i ? [<Box component="span" key={`s${i}`} aria-hidden sx={{ color: p.text.tertiary }}>·</Box>, el] : [el]))}
    </Box>
  );
}

export default function TatReport() {
  const p = useTheme().tokens;
  const { filters, update, rangeError } = useReportFilters({ groupBys: GROUP_BYS, dateBases: DATE_BASES });
  const body = toBody(filters);
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["report", "tat", body],
    endpoint: TEAM_REPORT_ENDPOINTS.tat,
    params: body,
    enabled: !rangeError,
    retry: false,
    showErrorMessage: false,
  });
  const k = data?.kpis ?? {};
  const rows = [...(data?.rows ?? [])].sort(worstFirst);
  const prev = data?.previous ?? { Finished: 0, OnTime: 0 };

  // One drawer; `drill` says which number it shows. GroupKey absent = every group.
  const [drill, setDrill] = useState(null);
  const open = (metric, row) =>
    setDrill({
      title: `${row ? row.GroupLabel : "Everyone"} · ${METRIC[metric]}`,
      body: { ...body, Metric: metric, ...(row && { GroupKey: row.GroupKey }) },
    });

  const days = dayjs(filters.to).diff(dayjs(filters.from), "day") + 1;
  const groupLabel = GROUP_BYS.find((g) => g.value === filters.groupBy).label;
  const red = p.error.hover;
  const amber = p.warning.text;
  const pctTone = (v) => (v == null ? p.text.tertiary : v >= ON_TIME_GOAL ? p.success.hover : amber);

  // Previous same-length period, compared on the rounded numbers the user sees (the card's tooltip).
  const nowPct = k.OnTimePct == null ? null : Math.round(k.OnTimePct);
  const prevPct = share(prev.OnTime, prev.Finished);
  let prevLine = `Previous ${days} days: nothing finished`;
  if (prevPct != null) {
    prevLine = `Previous ${days} days: ${prevPct}% (${prev.OnTime} of ${prev.Finished})`;
    if (nowPct != null) {
      const d = nowPct - prevPct;
      prevLine += d === 0 ? " — same" : ` — ${d > 0 ? "up" : "down"} ${Math.abs(d)} points`;
    }
  }
  const oldest = parseIst(k.OldestOverdueAt);

  const tableColumns = [
    { key: "GroupLabel", header: groupLabel, cell: (r) => <span data-testid="tat-row-label" style={{ fontWeight: 600 }}>{r.GroupLabel}</span> },
    {
      key: "health",
      header: "Health",
      hint: "Red: late now or late without excuse. Amber: a reason or your decision is owed. Green: on track.",
      size: 130,
      cell: (r) => {
        const h = HEALTH[healthOf(r)];
        // Solid on red/amber: a tonal chip vanished into the row's own wash.
        const solid = h.rank < 2;
        return <span data-testid="tat-health" data-health={healthOf(r)}><Chip size="sm" tone={h.tone} variant={solid ? "solid" : "tonal"} label={h.label} /></span>;
      },
    },
    { key: "OverdueNow", header: "Overdue now", hint: "Tasks still open and already past their deadline.", cell: (r) => <Num count={r.OverdueNow} name={`Overdue now: ${r.OverdueNow}`} color={red} onOpen={() => open("overdue_now", r)} /> },
    {
      key: "Missed",
      header: "Missed",
      hint: "Deadlines missed in this range: the total, then how many are not excused, excused, or still undecided.",
      size: 200,
      cell: (r) => (
        <Parts>
          {[
            r.Missed > 0 && <Num key="m" count={r.Missed} name={`Missed: ${r.Missed}`} onOpen={() => open("missed", r)}>{r.Missed}</Num>,
            r.NotExcused > 0 && <Num key="ne" count={r.NotExcused} name={`Not excused: ${r.NotExcused}`} color={red} onOpen={() => open("not_excused", r)}>{`${r.NotExcused} not excused`}</Num>,
            r.Excused > 0 && <Num key="ex" count={r.Excused} name={`Excused: ${r.Excused}`} color={p.text.secondary} onOpen={() => open("excused", r)} sx={{ fontWeight: 500 }}>{`${r.Excused} excused`}</Num>,
            r.NoDecision > 0 && <Num key="un" count={r.NoDecision} name={`Undecided: ${r.NoDecision}`} color={amber} onOpen={() => open("no_decision", r)}>{`${r.NoDecision} undecided`}</Num>,
          ]}
        </Parts>
      ),
    },
    {
      key: "OnTimePct",
      header: "On time",
      hint: "Finished tasks done before their deadline.",
      size: 150,
      cell: (r) =>
        r.Finished ? (
          <Box component="span" sx={{ display: "inline-flex", alignItems: "baseline", gap: "calc(6rem / 15)" }}>
            <Num count={r.OnTime} name={`On time: ${r.OnTime} of ${r.Finished}`} onOpen={() => open("ontime", r)} sx={{ fontWeight: 600 }}>{`${r.OnTime} of ${r.Finished}`}</Num>
            <Box component="span" sx={{ fontSize: "calc(12rem / 15)", fontWeight: 600, color: pctTone(r.OnTimePct) }}>{pct(r.OnTimePct)}</Box>
          </Box>
        ) : (
          <Box component="span" sx={{ color: p.text.tertiary }}>—</Box>
        ),
    },
    {
      key: "waiting",
      header: "Waiting for",
      hint: "What is owed on missed deadlines: the person's reason, or your decision on it.",
      size: 200,
      cell: (r) => (
        <Parts>
          {[
            r.ReasonPending > 0 && <Num key="rp" count={r.ReasonPending} name={`Reason pending: ${r.ReasonPending}`} color={amber} onOpen={() => open("reason_pending", r)}>{`${r.ReasonPending} reason`}</Num>,
            r.NoDecision > 0 && <Num key="nd" count={r.NoDecision} name={`Your decision: ${r.NoDecision}`} color={amber} onOpen={() => open("no_decision", r)}>{`${r.NoDecision} your decision`}</Num>,
          ]}
        </Parts>
      ),
    },
  ];
  const tint = (r) => ({ red: p.error.subtle, amber: p.warning.subtle })[healthOf(r)] ?? null;

  const exportCsv = () => {
    const cols = CSV_COLUMNS.map(([key, header]) => ({ key, header: header ?? groupLabel }));
    const blob = new Blob([toCsv(cols, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tat-${filters.from}-${filters.to}.csv`;
    a.click();
    // Revoking synchronously cancels the download in Firefox/Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 1.5 }}>
      <PageHeader
        title="Task deadlines"
        subtitle="Who is late, who is waiting on whom — per person, in working hours."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Button variant="tonal" size="sm" leftIcon={<Download size={14} />} onClick={exportCsv} disabled={rows.length === 0} data-testid="report-export">
              Export CSV
            </Button>
            <HelpGuide guide={HELP_GUIDES.tatReport} />
          </Box>
        }
      />
      <Helmet>
        <title>PRD Infotech | Task deadlines</title>
      </Helmet>

      <ReportFilters filters={filters} update={update} groupBys={GROUP_BYS} dateBases={DATE_BASES} pickers={PICKERS} ownerPlaceholder="All people" ownerLabel="Person">
        <Typography sx={{ ml: "auto", fontSize: "calc(12rem / 15)", color: p.text.secondary }}>
          Counted by the day a task was finished · {dayjs(filters.from).format("D MMM")} – {dayjs(filters.to).format("D MMM")}
        </Typography>
      </ReportFilters>

      {rangeError ? null : error ? (
        <Typography color="error" data-testid="tat-error">Failed to load this report.</Typography>
      ) : (
        <>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" } }}>
            <Kpi testId="tat-kpi-ontime" icon={CircleCheck} tone="success" loading={isLoading} title={isLoading ? undefined : prevLine}
                value={pct(k.OnTimePct)} valueColor={pctTone(k.OnTimePct)}
                sub={k.Finished ? `${k.OnTime} of ${k.Finished}` : "0 finished"}
                label="Finished on time" count={k.OnTime} name={`On time: ${k.OnTime} of ${k.Finished}`} onOpen={() => open("ontime")} />
            <Kpi testId="tat-kpi-missed" icon={ShieldAlert} tone="error" loading={isLoading}
              value={k.NotExcused ?? 0} valueColor={k.NotExcused ? red : p.text.tertiary}
              sub={k.Missed ? `of ${k.Missed} missed` : null}
              label="Missed, not excused" count={k.NotExcused} name={`Not excused: ${k.NotExcused}`} onOpen={() => open("not_excused")} />
            <Kpi testId="tat-kpi-overdue" icon={AlertTriangle} tone="error" loading={isLoading}
              value={k.OverdueNow ?? 0} valueColor={k.OverdueNow ? red : p.text.tertiary}
              sub={k.OverdueNow && oldest ? `oldest ${overByLong(Date.now() - oldest.getTime())}` : null}
              label="Overdue right now" count={k.OverdueNow} name={`Overdue now: ${k.OverdueNow}`} onOpen={() => open("overdue_now")} />
            <Kpi testId="tat-kpi-decision" icon={Gavel} tone="warning" loading={isLoading}
              value={k.NoDecision ?? 0} valueColor={k.NoDecision ? amber : p.text.tertiary}
              label="Waiting for your decision" count={k.NoDecision} name={`No decision yet: ${k.NoDecision}`} onOpen={() => open("no_decision")} />
          </Box>

          {/* People, worst first. */}
          {isLoading ? (
            <Skeleton width="100%" height={120} />
          ) : rows.length === 0 ? (
            <Typography data-testid="tat-empty" sx={{ color: "text.secondary", py: 2, textAlign: "center" }}>Nothing in this range.</Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <IconBadge icon={Users} tone="primary" size="sm" />
                <Typography component="h2" sx={{ fontSize: "calc(16rem / 15)", fontWeight: 700 }}>By {groupLabel.toLowerCase()}</Typography>
                <Typography sx={{ fontSize: "calc(12rem / 15)", color: p.text.secondary }}>
                  Needs action first · click any number to see the tasks
                </Typography>
              </Box>
              <ReportTable rows={rows} columns={tableColumns} testId="tat-table" rowKey={(r) => `${r.GroupKey}-${r.GroupLabel}`} rowTint={tint} />
            </Box>
          )}
        </>
      )}

      <ClocksDrawer open={Boolean(drill)} title={drill?.title} body={drill?.body} onClose={() => setDrill(null)} />
    </Box>
  );
}
