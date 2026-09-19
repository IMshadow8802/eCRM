import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Chip, Combobox, DateField } from "../../../components/ui";
import PageHeader from "../../../components/ui/PageHeader";
import useServerTable from "../../../hooks/useServerTable";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useUsers } from "../../../hooks";
import { QUOTATION_ENDPOINTS } from "../../../api/quotationQueries";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { formatDate } from "../../../utils/format";
import { getUserName } from "../../../utils/userShape";
import { money } from "./buildQuoteDoc";
import { QUOTE_STATUS } from "./quoteStatus";

// `superseded` is deliberately first-class here: the list hides replaced
// revisions by default (one row per live quotation), and this is how you ask
// for them.
const STATUS_OPTS = Object.entries(QUOTE_STATUS).map(([value, s]) => ({ value, label: s.label }));

// searchParams.get() only ever returns a string or null.
const numOrNull = (s) => (s === null || s === "" ? null : Number(s));

/**
 * Every quotation the caller's scope reaches — sp_FetchQuotations applies the
 * LEAD's visibility, so this list and the leads list always agree on who can
 * see what. Creating one happens from a lead, where the customer and product
 * already are; this page only finds and opens.
 */
export default function QuotationList() {
  const navigate = useNavigate();
  const theme = useTheme();

  // Filters live in the URL, not component memory: read straight off
  // searchParams every render (not seeded once into local state), so a
  // pasted /sales/quotations?Status=... link — or a reload of one — shows
  // the same filtered view instead of reverting to the defaults. Same
  // round-trip ReportPage.jsx uses (readFilters/writeFilters); this page's
  // filter set is small enough not to need a shared parser module for it.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => ({
    Status: searchParams.get("Status") || null,
    OwnerId: numOrNull(searchParams.get("OwnerId")),
    BranchId: numOrNull(searchParams.get("BranchId")),
    FromDate: searchParams.get("FromDate") || "",
    ToDate: searchParams.get("ToDate") || "",
  }), [searchParams]);
  const set = (k) => (v) => {
    const next = new URLSearchParams(searchParams);
    if (v === null || v === "" || v === undefined) next.delete(k);
    else next.set(k, v);
    setSearchParams(next, { replace: true });
  };

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });
  const ownerOpts = useMemo(() => (usersData?.users ?? []).map((u) => ({ value: u.Id, label: getUserName(u) })), [usersData]);
  const branchOpts = useMemo(() => (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })), [branchData]);
  const pick = (opts, v) => opts.find((o) => o.value === v) ?? null;

  // The colour, not an object: an object literal is new on every render, so
  // depending on it would defeat the memo — and depending on one of its fields
  // is the dishonest dependency react-hooks/exhaustive-deps warns about.
  const expiredColor = theme.tokens.error.main;
  const columns = useMemo(() => [
    { accessorKey: "QuoteNo", header: "Quotation", enableSorting: false, Cell: ({ row }) => row.original.QuoteNo || `Draft · revision ${row.original.Revision}` },
    { accessorKey: "LeadName", header: "Lead", enableSorting: false, Cell: ({ row }) => row.original.ToCompany || row.original.LeadName || "—" },
    { accessorKey: "OwnerName", header: "Owner", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "Unassigned" },
    { accessorKey: "QuoteDate", header: "Date", enableSorting: false, Cell: ({ cell }) => formatDate(cell.getValue(), { empty: "—" }) },
    { accessorKey: "ValidTill", header: "Valid till", enableSorting: false,
      Cell: ({ row, cell }) => <span style={row.original.IsExpired ? { color: expiredColor, fontWeight: 600 } : undefined}>{formatDate(cell.getValue(), { empty: "—" })}{row.original.IsExpired ? " · expired" : ""}</span> },
    { accessorKey: "GrandTotal", header: "Total", enableSorting: false, Cell: ({ cell }) => money(cell.getValue()) },
    { accessorKey: "Status", header: "Status", enableSorting: false,
      Cell: ({ cell }) => <Chip size="sm" label={QUOTE_STATUS[cell.getValue()]?.label ?? cell.getValue()} tone={QUOTE_STATUS[cell.getValue()]?.tone ?? "default"} /> },
  ], [expiredColor]);

  const extraParams = useMemo(() => ({
    Status: filters.Status, OwnerId: filters.OwnerId, BranchId: filters.BranchId,
    ...(filters.FromDate ? { FromDate: filters.FromDate } : {}),
    ...(filters.ToDate ? { ToDate: filters.ToDate } : {}),
  }), [filters]);

  const { table } = useServerTable({
    columns, queryKey: "quotations", endpoint: QUOTATION_ENDPOINTS.fetchQuotations, dataKey: "quotations", extraParams,
    initialPageSize: 25, getRowId: (row) => row.Id,
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => navigate(`/sales/quotations/${row.original.Id}`) }),
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Quotations" subtitle="Every quotation on the leads you can see. Create one from a lead." />
      <Helmet><title>PRD Infotech | Quotations</title></Helmet>

      <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Box sx={{ flex: "1 1 150px", maxWidth: 220 }}><Combobox size="sm" label="Status" placeholder="All live" options={STATUS_OPTS} value={pick(STATUS_OPTS, filters.Status)} onChange={(o) => set("Status")(o?.value ?? null)} data-testid="filter-status" /></Box>
        <Box sx={{ flex: "1 1 150px", maxWidth: 220 }}><Combobox size="sm" label="Owner" placeholder="Anyone" options={ownerOpts} value={pick(ownerOpts, filters.OwnerId)} onChange={(o) => set("OwnerId")(o?.value ?? null)} data-testid="filter-owner" /></Box>
        <Box sx={{ flex: "1 1 150px", maxWidth: 220 }}><Combobox size="sm" label="Branch" placeholder="All branches" options={branchOpts} value={pick(branchOpts, filters.BranchId)} onChange={(o) => set("BranchId")(o?.value ?? null)} data-testid="filter-branch" /></Box>
        <Box sx={{ flex: "1 1 150px", maxWidth: 220 }}><DateField size="sm" label="From" value={filters.FromDate} onChange={set("FromDate")} data-testid="filter-from" /></Box>
        <Box sx={{ flex: "1 1 150px", maxWidth: 220 }}><DateField size="sm" label="To" value={filters.ToDate} onChange={set("ToDate")} data-testid="filter-to" /></Box>
      </Box>

      <MaterialReactTable table={table} />
    </Box>
  );
}
