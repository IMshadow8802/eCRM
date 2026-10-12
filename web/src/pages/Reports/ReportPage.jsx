// src/pages/Reports/ReportPage.jsx
import { Helmet } from "react-helmet-async";
import { Box, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { Download } from "lucide-react";

import { Button, Skeleton } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import StatisticsCard from "../../components/StatCard";
import TrendArea from "../../components/Charts/TrendArea";
import { ReportTable } from "./ReportShell";
import ReportFilters, { useReportFilters } from "./ReportFilters";
import { useApiQuery } from "../../hooks/useApiQuery";
import {
  DATE_BASES,
  toBody,
  formatValue,
  toCsv,
  leadsUrl,
  drillParams,
} from "./reportUtils";

const defaultDrill = (row, filters) => leadsUrl(drillParams(filters, row));

/**
 * The one frame every sales report renders through (spec 4a §5):
 * filter bar → KPI strip → trend → breakdown table → drill-down.
 *
 * Filters live in the URL, so a report is a link: paste it and a colleague
 * sees the same numbers. A page file is a config object + this component.
 * A column with no `header` takes the active GroupBy's label.
 */
export default function ReportPage({
  reportKey,
  title,
  subtitle,
  endpoint,
  groupBys,
  dateBases = DATE_BASES,
  kpis = [],
  columns,
  trend = null,
  guide = HELP_GUIDES.reports,
  drill = defaultDrill,
  // A page's own default date basis. Falls back to the first offered basis, so
  // a single-basis page posts the basis it advertises instead of "created".
  defaultBasis = dateBases[0]?.value ?? "created",
  // Which filter pickers to show, and what the owner one is called.
  pickers = ["branch", "owner", "source", "product"],
  ownerPlaceholder = "All owners",
  // Drop a KPI / column whose key the response does not carry (the server omits
  // fields the caller may not see, e.g. partner money). Off: show everything.
  hideMissing = false,
}) {
  const navigate = useNavigate();
  const { filters, update, rangeError } = useReportFilters({ groupBys, dateBases, defaultBasis });

  const body = toBody(filters);
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["report", reportKey, body],
    endpoint,
    params: body,
    enabled: !rangeError,
    retry: false,
    showErrorMessage: false,
  });
  const kpiRow = data?.kpis ?? {};
  const rows = data?.rows ?? [];
  const trendRows = data?.trend ?? [];

  const groupLabel = groupBys.find((g) => g.value === filters.groupBy)?.label ?? "Group";
  const shown = (list, source) =>
    hideMissing && source ? list.filter((c) => c.key in source) : list;
  const shownKpis = shown(kpis, data?.kpis);
  const tableColumns = shown(columns, rows[0]).map((c) => ({
    key: c.key,
    header: c.header ?? groupLabel,
    align: c.align,
    hint: c.hint,
    cell: (r) => formatValue(c.format, r[c.key]),
  }));

  const exportCsv = () => {
    const blob = new Blob([toCsv(tableColumns, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportKey}-${filters.from}-${filters.to}.csv`;
    a.click();
    // Revoking synchronously cancels the download in Firefox/Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 1.5 }}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Button
              variant="tonal"
              size="sm"
              leftIcon={<Download size={14} />}
              onClick={exportCsv}
              disabled={rows.length === 0}
              data-testid="report-export"
            >
              Export CSV
            </Button>
            <HelpGuide guide={guide} />
          </Box>
        }
      />
      <Helmet>
        <title>PRD Infotech | {title}</title>
      </Helmet>

      <ReportFilters
        filters={filters}
        update={update}
        groupBys={groupBys}
        dateBases={dateBases}
        pickers={pickers}
        ownerPlaceholder={ownerPlaceholder}
      />

      {/* A backwards range shows only the filter bar's message, never a report of zeros. */}
      {!rangeError && (<>
      {/* KPI strip */}
      {shownKpis.length > 0 && (
        <Box
          sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, calc(150rem / 15)), 1fr))" }}
          data-testid="report-kpis"
        >
          {shownKpis.map((k) => (
            <StatisticsCard
              key={k.key}
              title={k.label}
              hint={k.hint}
              color={k.tone ?? "primary"}
              value={isLoading ? <Skeleton width={60} height={28} /> : formatValue(k.format, kpiRow[k.key])}
            />
          ))}
        </Box>
      )}

      {/* Trend */}
      {/* One point is a dot on an empty grid, not a trend: wait for two. */}
      {trend && trendRows.length > 1 && <TrendArea data={trendRows} xKey="Bucket" series={trend.series} />}

      {/* Breakdown */}
      {isLoading ? (
        <Box sx={{ py: 2 }} data-testid={`${reportKey}-loading`}>
          <Skeleton width="100%" height={120} />
        </Box>
      ) : error ? (
        <Typography color="error" data-testid={`${reportKey}-error`}>
          Failed to load this report.
        </Typography>
      ) : rows.length === 0 ? (
        <Typography
          data-testid={`${reportKey}-empty`}
          sx={{ color: "text.secondary", py: 4, textAlign: "center" }}
        >
          Nothing in this range.
        </Typography>
      ) : (
        <ReportTable
          rows={rows}
          columns={tableColumns}
          testId={`${reportKey}-table`}
          rowKey={(r) => `${r.GroupKey ?? "x"}-${r.SubKey ?? ""}-${r.GroupLabel}`}
          onRowClick={drill ? (row) => navigate(drill(row, filters)) : undefined}
        />
      )}
      </>)}
    </Box>
  );
}
