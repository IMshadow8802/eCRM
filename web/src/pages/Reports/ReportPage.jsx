// src/pages/Reports/ReportPage.jsx
import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Typography } from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";

import { Button, Chip, Combobox, Skeleton, Tabs } from "../../components/ui";
import DateField from "../../components/ui/DateField";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import StatisticsCard from "../../components/StatCard";
import TrendArea from "../../components/Charts/TrendArea";
import { ReportTable } from "./ReportShell";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useLookups } from "../../hooks/useLookups";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import {
  PRESETS,
  DATE_BASES,
  readFilters,
  writeFilters,
  toBody,
  formatValue,
  toCsv,
  leadsUrl,
  drillParams,
} from "./reportUtils";

const defaultDrill = (row, filters) => leadsUrl(drillParams(filters, row));

const PICKERS = [
  ["branch", "BranchId", "All branches"],
  ["owner", "OwnerId", "All owners"],
  ["source", "SourceId", "All sources"],
  ["product", "ProductId", "All products"],
];

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
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => {
    const f = readFilters(searchParams, { groupBys, defaultBasis });
    // readFilters validates against every known basis; a page may offer fewer.
    // Without this, /reports/aging?basis=activity is accepted, changes the
    // numbers, and hides the control that would let you see or undo it.
    return dateBases.some((b) => b.value === f.basis) ? f : { ...f, basis: defaultBasis };
  }, [searchParams, groupBys, dateBases, defaultBasis]);
  const update = (patch) =>
    setSearchParams(writeFilters({ ...filters, ...patch }, defaultBasis), { replace: true });

  // Pick-lists. The owner roster is the caller's assignable set, so the filter
  // can never name someone the report would not show anyway.
  // A picker that is hidden fetches nothing.
  const has = (name) => pickers.includes(name);
  const { data: branchData } = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    enabled: has("branch"),
    showErrorMessage: false,
  });
  const { users } = useAssignableUsers({ enabled: has("owner") });
  const { lookups: sources } = useLookups("lead_source", { enabled: has("source"), showErrorMessage: false });
  const { data: productData } = useApiQuery({
    queryKey: ["products", "active"],
    endpoint: SALES_ENDPOINTS.products.fetchProducts,
    params: { PageSize: 200, IsActive: true },
    enabled: has("product"),
    showErrorMessage: false,
  });
  const opts = {
    BranchId: (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })),
    OwnerId: users.map((u) => ({ value: u.Id, label: u.FullName })),
    SourceId: sources.map((s) => ({ value: s.Id, label: s.Value })),
    ProductId: (productData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })),
  };
  // A URL can name an id that is not in the caller's pick-list (another
  // branch, a deleted product, a hand-typed number). The filter IS applied —
  // toBody posts it and the server ANDs it inside scope — so showing the
  // placeholder would have the control deny a filter that is demonstrably on,
  // and the user could neither see nor clear it. Name it instead. The
  // list.length guard keeps a valid id from flashing "Unknown" while the
  // pick-lists are still loading.
  const optById = (list, v) => {
    if (v === null || v === undefined) return null;
    return list.find((o) => o.value === v) ?? (list.length ? { value: v, label: `Unknown (#${v})` } : null);
  };

  const body = toBody(filters);
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["report", reportKey, body],
    endpoint,
    params: body,
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

      {/* Filter bar */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <Chip
            key={p.value}
            label={p.label}
            size="lg"
            tone="primary"
            variant={filters.preset === p.value ? "solid" : "tonal"}
            // Solid vs tonal is colour alone; aria-pressed is what tells a
            // screen reader which range is actually showing.
            aria-pressed={filters.preset === p.value}
            onClick={() => update({ preset: p.value })}
            data-testid={`report-preset-${p.value}`}
          />
        ))}
        {filters.preset === "custom" && (
          <>
            <Box sx={{ width: 160 }}>
              <DateField
                size="sm"
                value={filters.from}
                onChange={(v) => v && update({ from: v })}
                data-testid="report-from"
              />
            </Box>
            <Box sx={{ width: 160 }}>
              <DateField
                size="sm"
                value={filters.to}
                onChange={(v) => v && update({ to: v })}
                data-testid="report-to"
              />
            </Box>
          </>
        )}
        {dateBases.length > 1 && (
          <Box sx={{ width: 150 }}>
            <Combobox
              size="sm"
              options={dateBases}
              value={dateBases.find((b) => b.value === filters.basis) ?? null}
              onChange={(o) => o && update({ basis: o.value })}
              data-testid="report-basis"
            />
          </Box>
        )}
        {PICKERS.filter(([name]) => pickers.includes(name)).map(([name, key, placeholder]) => (
          <Box key={key} sx={{ width: 170 }}>
            <Combobox
              size="sm"
              placeholder={name === "owner" ? ownerPlaceholder : placeholder}
              options={opts[key]}
              value={optById(opts[key], filters[key])}
              onChange={(o) => update({ [key]: o?.value ?? null })}
              data-testid={`report-${key}`}
            />
          </Box>
        ))}
      </Box>
      {groupBys.length > 1 && (
        <Tabs
          size="sm"
          value={filters.groupBy}
          onChange={(v) => update({ groupBy: v })}
          items={groupBys}
          data-testid="report-groupby"
        />
      )}

      {/* KPI strip */}
      {shownKpis.length > 0 && (
        <Box
          sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}
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
    </Box>
  );
}
