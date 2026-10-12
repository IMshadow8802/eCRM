// src/pages/Reports/ReportFilters.jsx
import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { useSearchParams } from "react-router-dom";

import { Chip, Combobox, Tabs } from "../../components/ui";
import DateField from "../../components/ui/DateField";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useLookups } from "../../hooks/useLookups";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { PRESETS, DATE_BASES, readFilters, writeFilters, rangeError } from "./reportUtils";

const PICKERS = [
  ["branch", "BranchId", "All branches", "Branch"],
  ["owner", "OwnerId", "All owners", "Owner"],
  ["source", "SourceId", "All sources", "Source"],
  ["product", "ProductId", "All products", "Product"],
];

/**
 * Report filter state, kept in the URL so a report is a link: paste it and a
 * colleague sees the same numbers. Returns `{ filters, update(patch), rangeError }`;
 * a page fetches only while `rangeError` is null.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the hook and the bar are one unit
export function useReportFilters({ groupBys, dateBases = DATE_BASES, defaultBasis = dateBases[0]?.value ?? "created", presets = PRESETS, defaultPreset = "30d" }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => {
    const f = readFilters(searchParams, { groupBys, defaultBasis, presets, defaultPreset });
    // readFilters validates against every known basis; a page may offer fewer.
    // Without this, /reports/aging?basis=activity is accepted, changes the
    // numbers, and hides the control that would let you see or undo it.
    return dateBases.some((b) => b.value === f.basis) ? f : { ...f, basis: defaultBasis };
  }, [searchParams, groupBys, dateBases, defaultBasis, presets, defaultPreset]);
  const update = (patch) =>
    setSearchParams(writeFilters({ ...filters, ...patch }, defaultBasis, defaultPreset), { replace: true });
  return { filters, update, rangeError: rangeError(filters) };
}

/**
 * The filter bar every report shares: range presets (+ custom dates), date
 * basis (only when a page offers more than one), pick-lists, and group-by tabs.
 * `children` render at the end of the bar (a page's own note).
 */
export default function ReportFilters({
  filters,
  update,
  groupBys,
  dateBases = DATE_BASES,
  // The range chips. A page with its own (Attendance: months) passes the same list to useReportFilters.
  presets = PRESETS,
  // Which filter pickers to show, and what the owner one is called.
  pickers = ["branch", "owner", "source", "product"],
  ownerPlaceholder = "All owners",
  ownerLabel = "Owner",
  children,
}) {
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

  return (
    <>
      {/* Every control carries a label above it (the date picker ignores placeholders), so the row aligns on the inputs. */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end", flexWrap: "wrap" }}>
        {presets.map((p) => (
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
            <Box sx={{ width: "calc(160rem / 15)" }}>
              <DateField size="sm" label="From" value={filters.from} onChange={(v) => v && update({ from: v })} data-testid="report-from" />
            </Box>
            <Box sx={{ width: "calc(160rem / 15)" }}>
              <DateField size="sm" label="To" value={filters.to} onChange={(v) => v && update({ to: v })} data-testid="report-to" />
            </Box>
            {rangeError(filters) && (
              <Typography role="alert" sx={{ color: "error.main", fontWeight: 600, fontSize: "calc(13rem / 15)", pb: 1 }}>
                {rangeError(filters)}
              </Typography>
            )}
          </>
        )}
        {dateBases.length > 1 && (
          <Box sx={{ width: "calc(150rem / 15)" }}>
            <Combobox
              size="sm"
              label="Date basis"
              options={dateBases}
              value={dateBases.find((b) => b.value === filters.basis) ?? null}
              onChange={(o) => o && update({ basis: o.value })}
              data-testid="report-basis"
            />
          </Box>
        )}
        {PICKERS.filter(([name]) => has(name)).map(([name, key, placeholder, label]) => (
          <Box key={key} sx={{ width: "calc(170rem / 15)" }}>
            <Combobox
              size="sm"
              label={name === "owner" ? ownerLabel : label}
              placeholder={name === "owner" ? ownerPlaceholder : placeholder}
              options={opts[key]}
              value={optById(opts[key], filters[key])}
              onChange={(o) => update({ [key]: o?.value ?? null })}
              data-testid={`report-${key}`}
            />
          </Box>
        ))}
        {children}
      </Box>
      {groupBys.length > 1 && (
        <Tabs size="sm" value={filters.groupBy} onChange={(v) => update({ groupBy: v })} items={groupBys} data-testid="report-groupby" />
      )}
    </>
  );
}
