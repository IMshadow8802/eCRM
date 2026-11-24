// src/pages/Reports/sales/SalesRows.jsx
//
// The rows behind a number (/reports/sales/<report>/rows?metric=…), a
// person's leads for these days (shape=leads, one line per lead with "Why it
// is here"), and Won deals (/reports/sales/won, every won lead in reach).
// Same filter row and colour key as the summaries; the drill half of the
// address is kept when a filter changes. Order is the server's.
import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarX, ExternalLink } from "lucide-react";
import dayjs from "dayjs";

import { Button, Card, Chip, EmptyState, PageHeader, Skeleton } from "../../../components/ui";
import HelpGuide from "../../../components/HelpGuide";
import { HELP_GUIDES } from "../../../data/helpGuides";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { CALL_RESULT, CONTACT_STATUS } from "../../../api/callingQueries";
import { keyInk, reportKey } from "../../../styles/tokens";
import { formatDate, formatDue } from "../../../utils/format";
import { FOLLOWUP_TYPES, isActiveCode, statusChipColors } from "../../Sales/leadStatus";
import { ReportTable } from "../ReportShell";
import { REPORTS } from "./reports";
import { ReportFilterRow } from "./SalesReport";
import {
  diffOf, drillBody, drillTitle, exportName, leadsOfUrl, previousLabel, readDrill, readFilters, rowsCsv, whyParts, writeFilters,
} from "./salesReportUtils";

const fs = (px) => `calc(${px}rem / 15)`;
const int = (n) => Number(n || 0).toLocaleString("en-IN");
const count = (n, one, many) => `${int(n)} ${Number(n) === 1 ? one : many}`;
const rupees = (n) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const FILTER_KEYS = ["preset", "from", "to", "at", "line", "BranchId", "SourceId", "ProductId"];
const CALLING = ["dial", "dial_first", "contact"];
const DONE = ["call", "visit", "meeting", "other", "visits"];
const typeLabel = (v) => FOLLOWUP_TYPES.find((t) => t.value === v)?.label ?? v ?? null;
const day = (v) => (v ? dayjs(v).format("YYYY-MM-DD") : null);
const moment = (v) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : null);

const familyOf = (d) => {
  if (d.Shape === "leads") return "leads";
  if (!d.Metric || d.Metric === "all") return null;
  if (d.Metric.startsWith("fu_")) return "fu";
  if (CALLING.includes(d.Metric)) return "calling";
  return DONE.includes(d.Metric) ? "done" : d.Metric; // new, won, lost, open
};

// A column: `value` is the plain text (search, sort, CSV); `cell` draws it. Both read the server row.
const text = (key, header, value, extra = {}) => ({ key, header, value, ...extra });
const dateCol = (key, header, field, { time = false, ink } = {}) => ({
  key, header,
  value: (r) => (time ? moment(r[field]) : day(r[field])),
  cell: (r, p) => {
    const s = time ? formatDue(r[field]) : formatDate(r[field]);
    if (!s) return "—";
    const k = ink?.(r);
    return k ? <span style={{ color: keyInk(p, k), fontWeight: 600 }}>{s}</span> : s;
  },
});
const money = (key, header, field, k) => ({
  key, header, align: "right",
  value: (r) => (r[field] == null ? null : Number(r[field])),
  cell: (r, p) => (r[field] == null ? "—" : <span style={k ? { color: keyInk(p, k), fontWeight: 600 } : undefined}>{rupees(r[field])}</span>),
});
const status = (header) => ({
  key: "status", header, value: (r) => r.StatusName ?? null,
  cell: (r) => <Chip label={r.StatusName || "—"} size="sm" tone={isActiveCode(r.StatusCode) ? "primary" : "default"} colors={statusChipColors(r.StatusCode)} />,
});
const owner = (key, header) => ({
  key, header, value: (r) => r.OwnerName ?? "Unassigned",
  cell: (r) => r.OwnerName ?? <span style={{ color: reportKey.zero }}>Unassigned</span>,
});

const LEAD = text("lead", "Lead", (r) => r.LeadName);
const CREATED = dateCol("created", "Created", "CreatedAt");
const MOBILE = text("mobile", "Mobile", (r) => r.MobileNo ?? null);
const LAST = dateCol("lastActivity", "Last activity", "LastActivityAt", { ink: (r) => (r.IsStale ? "idle" : null) });

const FAMILIES = {
  fu: [LEAD, CREATED, dateCol("due", "Was due", "EventAt", { time: true, ink: (r) => (r.Metric === "fu_missed" ? "late" : null) }),
    text("type", "Follow-up", (r) => typeLabel(r.Detail1)), MOBILE, status("Status now"), text("person", "Due with", (r) => r.PersonName ?? null)],
  done: [LEAD, CREATED, dateCol("done", "Done on", "EventAt", { time: true }), text("type", "What", (r) => typeLabel(r.Detail1)),
    text("notes", "Notes", (r) => r.Detail2 ?? null), MOBILE, status("Status now"), text("person", "Done by", (r) => r.PersonName ?? null)],
  new: [LEAD, CREATED, MOBILE, text("company", "Company", (r) => r.Company ?? null), status("Status now"), money("value", "Value ₹", "Amount"), owner("owner", "Assigned to")],
  won: [LEAD, CREATED, dateCol("won", "Won on", "EventAt"), text("company", "Company", (r) => r.Company ?? null), owner("person", "Person"),
    text("source", "Source", (r) => r.SourceName ?? null), money("amount", "Won ₹", "Amount", "won"), text("quote", "Quotation no.", (r) => r.QuoteNo ?? null),
    text("days", "Days to win", (r) => dayjs(r.EventAt).startOf("day").diff(dayjs(r.CreatedAt).startOf("day"), "day"), {
      align: "right", cell: (r, p, v) => (v === 0 ? "same day" : count(v, "day", "days")),
    })],
  lost: [LEAD, CREATED, dateCol("lostOn", "Lost on", "EventAt"), text("reason", "Reason", (r) => r.LostReason ?? null),
    text("remarks", "Remarks", (r) => r.Remarks ?? null), money("value", "Value ₹", "Amount"), owner("owner", "Assigned to")],
  open: [LEAD, CREATED, text("age", "Age", (r) => (r.AgeDays == null ? null : Number(r.AgeDays)), { align: "right", cell: (r, p, v) => count(v, "day", "days") }),
    status("Status now"), money("value", "Value ₹", "Amount"), LAST,
    dateCol("next", "Next follow-up", "NextFollowupDate", { time: true, ink: (r) => (r.IsOverdue ? "late" : null) }), owner("owner", "Assigned to")],
  // 149: a calling row is a call (or a contact); its name and number only reach a manager of the list.
  calling: [dateCol("when", "When", "EventAt", { time: true }), text("lead", "Contact", (r) => r.LeadName ?? null), MOBILE,
    text("person", "Caller", (r) => r.PersonName ?? null),
    text("result", "Result", (r) => (r.Metric === "contact" ? CONTACT_STATUS[r.Detail1]?.label : CALL_RESULT[r.Detail1]) ?? r.Detail1 ?? null),
    text("list", "List", (r) => r.CallListName ?? null)],
  leads: [LEAD, CREATED, MOBILE, status("Status"), money("value", "Value ₹", "EstValue"), LAST,
    text("why", "Why it is here", (r) => whyParts(r).map((x) => x.text).join(" · "), {
      cell: (r, p) => whyParts(r).map((x, i) => (
        <span key={x.text}>{i > 0 && " · "}<span style={{ color: keyInk(p, x.k), fontWeight: 600 }}>{x.text}</span></span>
      )),
    })],
};

// "74 new · 47 calls · …" under a person's leads; zeros left out.
function sumsParts(s) {
  return [
    [s.NNew, `${int(s.NNew)} new`, "new"],
    [s.NCalls, count(s.NCalls, "call", "calls"), "call"],
    [s.NVisits, count(s.NVisits, "visit or meeting", "visits & meetings"), "visit"],
    [s.NDue, count(s.NDue, "follow-up due", "follow-ups due"), null],
    [s.NMissed, `${int(s.NMissed)} missed`, "late"],
    [s.NWon, `${int(s.NWon)} won (${rupees(s.WonValue ?? 0)})`, "won"],
    [s.NLost, `${int(s.NLost)} lost`, "lost"],
  ].filter(([n]) => Number(n)).map(([, t, k]) => ({ text: t, k }));
}

function Diff({ d, money: isMoney }) {
  if (!d.text) return null;
  const t = isMoney ? `${d.text[0]}₹${d.text.slice(1)}` : d.text;
  const [arrow, color] = d.tone === "better" ? ["▲ ", reportKey.better] : ["▼ ", reportKey.worse];
  return <span style={{ color, fontWeight: 600 }}>{arrow + t}</span>;
}

export default function SalesRows({ report: slug }) {
  const report = REPORTS[slug];
  const isWon = slug === "won";
  const p = useTheme().tokens;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams, report), [searchParams, report]);
  // Won deals is every won lead in reach: no person, no key.
  const drill = useMemo(() => (isWon ? { ...readDrill(new URLSearchParams()), Metric: "won" } : readDrill(searchParams)), [isWon, searchParams]);
  const family = familyOf(drill);

  const update = (patch) => {
    const next = new URLSearchParams(searchParams);
    for (const k of FILTER_KEYS) next.delete(k);
    for (const [k, v] of Object.entries(writeFilters({ ...filters, ...patch }, report))) next.set(k, v);
    setSearchParams(next, { replace: true });
  };
  const qs = (f) => {
    const s = new URLSearchParams(writeFilters(f, report)).toString();
    return s ? `?${s}` : "";
  };
  const atUrl = (at) => `${report.path}${qs({ ...filters, at })}`;

  const body = { ...drillBody(report, filters, drill), ...(isWon && { WithPrevious: true }) };
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["salesRows", slug, body],
    endpoint: SALES_ENDPOINTS.reports.salesRows,
    params: body,
    enabled: Boolean(family) && !filters.error,
    retry: false,
    showErrorMessage: false,
  });
  // The server lists only leads the caller can open (D8); dropping a row marked
  // CanOpen = 0 is a backstop against an older server, never the rule itself.
  // A calling row is listed either way (149): without CanOpen it simply carries no name, number or link.
  const raw = (data?.rows ?? []).filter((r) => r.Src === "K" || r.CanOpen == null || Boolean(r.CanOpen));
  // total = the summary cell = listed rows + hiddenCount.
  const total = data?.total ?? 0;
  const hidden = Number(data?.hiddenCount ?? 0);
  const path = data?.path ?? [];
  const person = path[path.length - 1] ?? null;
  const previous = isWon ? data?.previous ?? null : null;

  // Where a row opens: its lead, or for a calling row its list's contacts (a manager of the list only).
  const hrefOf = (r) => (r.Src === "K" ? (Number(r.CanOpen) && r.CallListId ? `/sales/calling-lists/${r.CallListId}?tab=contacts` : null) : `/sales/leads/${r.LeadId}`);
  const leadCell = (r) => {
    const to = hrefOf(r);
    if (!to) return <span style={{ fontWeight: 600 }}>{r.LeadName ?? "—"}</span>;
    return <Link to={to} onClick={(e) => e.stopPropagation()} style={{ color: p.text.primary, fontWeight: 600 }}>{r.LeadName ?? "—"}</Link>;
  };
  const openCell = (r) => {
    const to = hrefOf(r);
    return to && (
      <Link to={to} onClick={(e) => e.stopPropagation()} aria-label={r.Src === "K" ? "Open calling list" : "Open lead"} style={{ color: p.text.tertiary, display: "inline-flex" }}>
        <ExternalLink size={14} />
      </Link>
    );
  };

  const specs = family ? FAMILIES[family] : [];
  const rows = raw.map((r) => ({ _r: r, ...Object.fromEntries(specs.map((c) => [c.key, c.value(r)])) }));

  // Footers: a person's leads add up their lines; Won deals has its total and the period before.
  const foot = {};
  let csvFooter = null;
  if (family === "leads" && data) {
    const parts = sumsParts(data.sums ?? {});
    foot.lead = count(total, "lead", "leads");
    foot.why = parts.map((x, i) => (
      <span key={x.text}>{i > 0 && " · "}<span style={x.k ? { color: keyInk(p, x.k) } : undefined}>{x.text}</span></span>
    ));
    csvFooter = { lead: foot.lead, why: parts.map((x) => x.text).join(" · ") };
  } else if (isWon && data) {
    foot.lead = (
      <>
        <div>Total · <span style={{ color: reportKey.won.text }}>{count(total, "deal", "deals")}</span></div>
        {previous && (
          <div style={{ color: p.text.secondary, fontWeight: 500 }}>
            {previousLabel(previous.range)} · {count(previous.total, "deal", "deals")}{" "}
            <Diff d={diffOf(total, previous.total, true)} />
          </div>
        )}
      </>
    );
    foot.amount = (
      <>
        <div style={{ color: reportKey.won.text }}>{rupees(data.amountTotal ?? 0)}</div>
        {previous && (
          <div style={{ color: p.text.secondary, fontWeight: 500 }}>
            {rupees(previous.amountTotal)} <Diff d={diffOf(data.amountTotal, previous.amountTotal, true)} money />
          </div>
        )}
      </>
    );
    csvFooter = { lead: `Total · ${count(total, "deal", "deals")}`, amount: Number(data.amountTotal ?? 0) };
  }

  const columns = [
    ...specs.map((c) => ({
      key: c.key, header: c.header, align: c.align,
      cell: (row) => (c.key === "lead" ? leadCell(row._r) : c.cell ? c.cell(row._r, p, row[c.key]) : row[c.key] ?? "—"),
      ...(foot[c.key] != null && { footer: foot[c.key] }),
    })),
    { header: "", cell: (row) => openCell(row._r) },
  ];

  const exportCsv = () => {
    const blob = new Blob([rowsCsv(columns.filter((c) => c.key), rows, csvFooter)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportName(report, filters, family === "won" ? null : person?.Name);
    a.click();
    // Revoking synchronously cancels the download in Firefox/Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // Title, subtitle and the way back up.
  const start = { label: report.title, to: `${report.path}${qs({ ...filters, at: null })}` };
  let title = report.title;
  let subtitle;
  let breadcrumb;
  if (isWon) subtitle = report.subtitle;
  else if (family === "leads") {
    title = person?.Name ?? report.title;
    subtitle = "their leads for these days, one line each";
    breadcrumb = [start, ...path.slice(0, -1).map((x) => ({ label: x.Name, to: atUrl(x.Id) }))];
  } else {
    if (data && family) title = drillTitle(drill, total);
    // The last crumb is the person: their team when the number was a team's, else their own leads.
    breadcrumb = [start, ...path.map((x, i) => ({
      label: x.Name,
      to: i < path.length - 1 || drill.Rollup ? atUrl(x.Id) : leadsOfUrl(report, filters, { GroupKey: x.Id }),
    }))];
  }

  const tryMonth = filters.preset !== "month" && (
    <Button variant="tonal" size="sm" onClick={() => update({ preset: "month" })}>Try This month</Button>
  );
  let content;
  if (!family) {
    content = (
      <EmptyState
        icon={<CalendarX />}
        title="This link is not complete"
        action={<Link to={report.path} style={{ color: p.primary.main, fontWeight: 600 }}>Back to {report.title}</Link>}
      />
    );
  } else if (filters.error) content = <Box role="alert" sx={{ color: p.error.main, fontSize: fs(14), p: fs(20) }}>{filters.error}</Box>;
  else if (error) content = <Box sx={{ color: p.error.main, fontSize: fs(14), p: fs(20) }}>Failed to load these rows.</Box>;
  else if (data && !raw.length) {
    content = <EmptyState icon={<CalendarX />} title={family === "leads" ? "No work recorded in this period" : "Nothing in this period"} action={tryMonth} />;
  } else {
    const context = data?.truncated
      ? `Showing the first ${int(raw.length)} of ${int(total - hidden)} — narrow the dates`
      : isWon
        ? `${count(total, "deal", "deals")} · Won ₹ is the before-tax value of the accepted quotation, or what the agent typed`
        : family === "leads" ? `${count(total, "lead", "leads")} touched in these days` : count(total, "row", "rows");
    content = (
      <>
        <Box sx={{ px: fs(12), py: fs(8), minHeight: fs(44), display: "flex", alignItems: "center", fontSize: fs(13), color: p.text.secondary }}>
          {isLoading ? <Skeleton variant="text" width={180} /> : <div role={data?.truncated ? "status" : undefined}>{context}</div>}
        </Box>
        <ReportTable
          rows={rows}
          columns={columns}
          rowKey={(row) => `${row._r.Metric ?? "lead"}-${row._r.Src ?? ""}-${row._r.RefId ?? row._r.LeadId}`}
          testId="sales-rows-table"
          loading={isLoading}
          onRowClick={(row) => { const to = hrefOf(row._r); if (to) navigate(to); }}
        />
      </>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: fs(12), minHeight: 0 }}>
      <PageHeader title={title} subtitle={subtitle} breadcrumb={breadcrumb} actions={<HelpGuide guide={HELP_GUIDES[report.guide]} />} />
      <Helmet>
        <title>PRD Infotech | {report.title}</title>
      </Helmet>
      <ReportFilterRow report={report} filters={filters} onChange={update} onExport={exportCsv} canExport={raw.length > 0} />
      <Card padding="none" sx={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        {content}
        {family && !filters.error && !error && hidden > 0 && (
          <Box data-testid="sales-rows-hidden" sx={{ px: fs(12), py: fs(10), fontSize: fs(13), color: p.text.secondary }}>
            {family === "leads" // there hiddenCount counts leads, elsewhere activities
              ? (hidden === 1 ? "1 lead no longer in your view" : `${int(hidden)} leads no longer in your view`)
              : (hidden === 1 ? "1 activity on a lead no longer in your view" : `${int(hidden)} activities on leads no longer in your view`)}
          </Box>
        )}
      </Card>
    </Box>
  );
}
