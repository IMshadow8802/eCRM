// src/pages/Reports/sales/SalesReport.jsx
//
// The frame of the four summary reports (Team report, Lead sources, Open
// leads, Lost leads): the date field with its meaning, three pickers, Export,
// the colour key, then one card with a context line and the SummaryTable.
// All state is in the address bar, so a copied link opens the same report;
// walking down the Team report pushes `at`, so Back walks up the chain.
import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarX, ChevronRight, Download } from "lucide-react";
import dayjs from "dayjs";

import { Button, Card, Chip, Combobox, DateRangeField, EmptyState, PageHeader, Skeleton } from "../../../components/ui";
import HelpGuide from "../../../components/HelpGuide";
import { HELP_GUIDES } from "../../../data/helpGuides";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useLookups } from "../../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { reportKey } from "../../../styles/tokens";
import { COLUMNS, KEY_LEGEND } from "./columns";
import { REPORTS } from "./reports";
import SummaryTable from "./SummaryTable";
import { drillUrl, exportName, leadsOfUrl, readFilters, summaryCsv, toBody, writeFilters } from "./salesReportUtils";

const fs = (px) => `calc(${px}rem / 15)`;
const NO_MANAGER_SECTION = "Not under anyone — set “Reports to” in Users";
const count = (n, one, many) => `${Number(n || 0).toLocaleString("en-IN")} ${Number(n) === 1 ? one : many}`;

function Legend({ p }) {
  const dot = (k) => (
    <span aria-hidden style={{ display: "inline-block", width: fs(7), height: fs(7), borderRadius: "50%", marginRight: fs(5), background: reportKey[k].dot ?? reportKey[k].text }} />
  );
  return (
    <Box data-testid="report-legend" sx={{ display: "flex", alignItems: "center", columnGap: fs(16), rowGap: fs(4), flexWrap: "wrap", fontSize: fs(12), color: p.text.secondary }}>
      <b style={{ fontWeight: 600 }}>Colour key</b>
      {KEY_LEGEND.map(({ k, label }) => <span key={k}>{dot(k)}{label}</span>)}
      <span>
        <span style={{ color: reportKey.better, fontWeight: 600 }}>▲</span> better{" "}
        <span style={{ color: reportKey.worse, fontWeight: 600 }}>▼</span> worse than before
      </span>
      <span style={{ color: p.text.tertiary }}>0 = none</span>
    </Box>
  );
}

/**
 * The line under every sales report title: the date field with its meaning,
 * office / source / product, Export, then the colour key. Shared by the
 * summaries and the drill pages so the two never drift apart.
 */
export function ReportFilterRow({ report, filters, onChange, onExport, canExport }) {
  const p = useTheme().tokens;
  // Pick-lists: the same queries the Leads list uses.
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });
  const { lookups: sources } = useLookups("lead_source", { showErrorMessage: false });
  const { data: productData } = useApiQuery({
    queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, showErrorMessage: false,
  });
  const pickers = [
    ["BranchId", "branch", "All offices", (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName }))],
    ["SourceId", "source", "All sources", sources.map((s) => ({ value: s.Id, label: s.Value }))],
    ["ProductId", "product", "All products", (productData?.products ?? []).map((x) => ({ value: x.Id, label: x.Name }))],
  ];
  // An id in the address that the list does not hold is still applied: name it, never show the placeholder.
  const optById = (list, v) => (v == null ? null : list.find((o) => o.value === v) ?? (list.length ? { value: v, label: `Unknown (#${v})` } : null));

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: fs(8), flexWrap: "wrap" }}>
        <DateRangeField
          value={filters}
          onChange={(v) => onChange(v)}
          means={report.dateMeans}
          heading={`${report.dateMeans}…`}
          allowAny={report.allowAny}
        />
        {pickers.map(([key, name, placeholder, options]) => (
          <Box key={key} sx={{ width: fs(170) }}>
            <Combobox
              size="sm"
              fullWidth
              placeholder={placeholder}
              options={options}
              value={optById(options, filters[key])}
              onChange={(opt) => onChange({ [key]: opt?.value ?? null })}
              data-testid={`filter-${name}`}
            />
          </Box>
        ))}
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" size="sm" leftIcon={<Download size={14} />} onClick={onExport} disabled={!canExport}>
          Export
        </Button>
      </Box>
      <Legend p={p} />
    </>
  );
}

export default function SalesReport({ report: slug }) {
  const report = REPORTS[slug];
  const theme = useTheme();
  const p = theme.tokens;
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams, report), [searchParams, report]);
  const qs = (f) => {
    const s = new URLSearchParams(writeFilters(f, report)).toString();
    return s ? `?${s}` : "";
  };
  // A filter change replaces the entry; walking down a team is a link (a push).
  const update = (patch) => setSearchParams(writeFilters({ ...filters, ...patch }, report), { replace: true });
  const atUrl = (at) => `${report.path}${qs({ ...filters, at })}`;

  const body = toBody(filters, report);
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["salesReport", report.slug, body],
    endpoint: SALES_ENDPOINTS.reports.sales,
    params: body,
    enabled: !filters.error,
    retry: false,
    showErrorMessage: false,
  });
  const lines = data?.rows ?? [];
  const totals = data?.totals ?? {};
  const previous = report.previous ? data?.previous ?? null : null;
  const path = data?.path ?? [];
  const person = filters.at ? path[path.length - 1] : null;

  const firstNoManager = lines.find((l) => l.NoManager);
  const nameCell = (l) => {
    const extra = (
      <>
        {l.IsActive === false && <span style={{ color: p.text.tertiary, fontSize: fs(13), fontWeight: 500 }}>inactive</span>}
        {l.NoManager && <Chip size="sm" tone="warning" label="No manager set" />}
      </>
    );
    const strong = { color: p.text.primary, fontWeight: 600, textDecoration: "none" };
    let who;
    if (l.LineKind === "unassigned") who = <span style={{ fontWeight: 600 }}>Unassigned leads</span>;
    else if (slug === "team" && l.LineKind === "team") {
      who = (
        <>
          <Link to={atUrl(l.GroupKey)} style={{ ...strong, display: "inline-flex", alignItems: "center", gap: fs(4) }}>
            {l.GroupLabel}
            <ChevronRight size={14} color={p.primary.main} aria-hidden />
          </Link>
          <span style={{ color: p.text.secondary, fontSize: fs(12), fontWeight: 500 }}>· team of {l.TeamSize}</span>
        </>
      );
    } else if (slug === "team") {
      // An own line's TeamSize is the whole team: never shown here.
      who = (
        <>
          <Link to={leadsOfUrl(report, filters, l)} style={strong}>{l.GroupLabel}</Link>{" "}
          {l.LineKind === "own" && <span style={{ color: p.text.secondary, fontWeight: 500 }}>— own leads</span>}
        </>
      );
    } else if (slug === "open") {
      const to = drillUrl(report, filters, l, COLUMNS.open);
      who = to ? <Link to={to} style={strong}>{l.GroupLabel}</Link> : <span style={{ fontWeight: 600 }}>{l.GroupLabel}</span>;
    } else who = <span style={{ fontWeight: 600 }}>{l.GroupLabel}</span>;
    return <Box sx={{ display: "flex", alignItems: "center", gap: fs(8), minWidth: 0 }}>{who}{extra}</Box>;
  };

  const context = (() => {
    if (slug === "team") {
      return filters.at ? count(lines.length, "line", "lines") : (
        <><b style={{ color: p.text.primary, fontWeight: 600 }}>Starts at you</b> · {count(lines.length, "line", "lines")} · a manager's line is their whole team, themselves included</>
      );
    }
    if (slug === "open") {
      const asOf = data?.asOf ? dayjs(data.asOf).format("DD-MM-YYYY HH:mm") : "";
      return `${count(totals.OpenNow, "open lead", "open leads")} · as of ${asOf} · ages count from the Created date`;
    }
    return slug === "sources" ? count(lines.length, "source", "sources") : count(lines.length, "reason", "reasons");
  })();

  const exportCsv = () => {
    const blob = new Blob([summaryCsv(report, lines, totals, previous)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportName(report, filters, person?.Name);
    a.click();
    // Revoking synchronously cancels the download in Firefox/Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const start = `${report.path}${qs({ ...filters, at: null })}`;
  const breadcrumb = filters.at
    ? [{ label: report.title, to: start }, ...path.slice(0, -1).map((x) => ({ label: x.Name, to: atUrl(x.Id) }))]
    : undefined;

  let content;
  if (filters.error) content = <Box role="alert" sx={{ color: p.error.main, fontSize: fs(14), p: fs(20) }}>{filters.error}</Box>;
  else if (error) content = <Box sx={{ color: p.error.main, fontSize: fs(14), p: fs(20) }}>Failed to load this report.</Box>;
  else if (data && data.nodeOk === false) {
    content = (
      <EmptyState
        icon={<CalendarX />}
        title="You cannot see this person's team"
        action={<Link to={start} style={{ color: p.primary.main, fontWeight: 600 }}>Back to {report.title}</Link>}
      />
    );
  } else if (data && !lines.length) {
    content = (
      <EmptyState
        icon={<CalendarX />}
        title="Nothing in this period"
        action={filters.preset !== "month" && <Button variant="tonal" size="sm" onClick={() => update({ preset: "month" })}>Try This month</Button>}
      />
    );
  } else {
    content = (
      <>
        <Box sx={{ px: fs(12), py: fs(8), minHeight: fs(44), display: "flex", alignItems: "center", fontSize: fs(13), color: p.text.secondary }}>
          {isLoading ? <Skeleton variant="text" width={180} /> : <div>{context}</div>}
        </Box>
        <SummaryTable
          firstHeader={report.firstHeader}
          columns={report.columns.map((k) => COLUMNS[k])}
          lines={lines}
          totals={totals}
          previous={previous}
          loading={isLoading}
          nameCell={nameCell}
          cellHref={(l, c) => drillUrl(report, filters, l, c)}
          sectionBefore={(l) => (slug === "team" && l === firstNoManager ? NO_MANAGER_SECTION : null)}
          data-testid={`sales-${slug}-table`}
        />
      </>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: fs(12), minHeight: 0 }}>
      <PageHeader
        title={person?.Name ?? report.title}
        subtitle={filters.at ? (person ? "their team, added up per person" : undefined) : report.subtitle}
        breadcrumb={breadcrumb}
        actions={<HelpGuide guide={HELP_GUIDES[report.guide]} />}
      />
      <Helmet>
        <title>PRD Infotech | {report.title}</title>
      </Helmet>

      <ReportFilterRow report={report} filters={filters} onChange={update} onExport={exportCsv} canExport={lines.length > 0} />

      <Card padding="none" sx={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        {content}
      </Card>
    </Box>
  );
}
