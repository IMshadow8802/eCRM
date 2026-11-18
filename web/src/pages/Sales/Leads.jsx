// src/pages/Sales/Leads.jsx
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRightLeft, Eye, Pencil, Plus, Trash2, Users } from "lucide-react";

import { Button, Combobox, IconButton, Tooltip, Tabs, Chip } from "../../components/ui";
import DateRangeField from "../../components/ui/DateRangeField";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUsers } from "../../hooks";
import { useLookups } from "../../hooks/useLookups";
import { useAccess } from "../../hooks/useAccess";
import useAuthStore from "../../stores/useAuthStore";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { PARTNER_ENDPOINTS } from "../../api/partnerQueries";
import { formatCurrency, formatDate, formatDateTime, formatDue } from "../../utils/format";
import { keyInk } from "../../styles/tokens";
import { getUserName } from "../../utils/userShape";
import { LEAD_PRESETS, presetParams, isActiveCode, isStale, statusChipColors, leadsParamsToState, leadsStateToParams } from "./leadStatus";
import LeadCreateModal from "./LeadCreateModal";
import TransferLeadModal from "./TransferLeadModal";
import DeleteLeadModal from "./DeleteLeadModal";

// Name, Owner and Partner wrap so the list fits without sideways scroll.
const wrap = { sx: { whiteSpace: "normal", overflowWrap: "anywhere" } };
const num = (v) => (v === "" ? null : Number(v));

const Leads = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const leadsAccess = useAccess("leads");
  const userId = useAuthStore((s) => s.user?.UserId ?? s.UserId);

  // The filters, the Created range and the sort live in the address bar, so a
  // reload or a shared link reopens the same list. The URL is read once, on
  // mount; after that the page owns the state and only writes it back.
  // React Router does not remount on a search-only change, which is fine
  // because nothing inside this page links to /sales/leads?… — keep it so.
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => leadsParamsToState(searchParams));
  const [preset, setPreset] = useState("all");
  const [filters, setFilters] = useState(initial.filters);
  const [created, setCreated] = useState(initial.created);
  const [createOpen, setCreateOpen] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [transferIds, setTransferIds] = useState([]);
  const [deleteLead, setDeleteLead] = useState(null);

  const setFilterValue = (key) => (opt) => setFilters((prev) => ({ ...prev, [key]: opt?.value ?? "" }));

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const { lookups: statuses } = useLookups("lead_status");
  const { lookups: sources } = useLookups("lead_source");
  const { data: productsData } = useApiQuery({ queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true } });
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });

  const { data: partnerData } = useApiQuery({ queryKey: ["partners", "picker"], endpoint: PARTNER_ENDPOINTS.fetchPartners, params: { Stats: false }, showErrorMessage: false });

  const opts = {
    status: useMemo(() => statuses.map((s) => ({ value: s.Id, label: s.Value })), [statuses]),
    product: useMemo(() => (productsData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })), [productsData]),
    owner: useMemo(() => (usersData?.users ?? []).map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })), [usersData]),
    source: useMemo(() => sources.map((s) => ({ value: s.Id, label: s.Value })), [sources]),
    partner: useMemo(() => (partnerData?.partners ?? []).map((p) => ({ value: p.Id, label: p.Name })), [partnerData]),
    branch: useMemo(() => (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })), [branchData]),
  };
  const optById = (list, v) => list.find((o) => o.value === v) ?? null;
  // An inactive partner is not in the picker; show its id, not a blank filter.
  const partnerOpt = optById(opts.partner, filters.PartnerId)
    ?? (filters.PartnerId !== "" && opts.partner.length ? { value: filters.PartnerId, label: `Unknown (#${filters.PartnerId})` } : null);

  // Every label comes from the SP now; no client-side id → name resolution.
  // Column ids are the server's sort names; only those five sort.
  const lateInk = keyInk(theme.tokens, "late");
  const idleInk = keyInk(theme.tokens, "idle");
  const columns = useMemo(() => [
    // Grid layout shares spare width: the name takes twice the share, the short ones less.
    { id: "name", accessorKey: "Name", header: "Name", enableSorting: true, size: 180, grow: 2, muiTableBodyCellProps: wrap },
    { id: "created", accessorKey: "CreatedAt", header: "Created", enableSorting: true, size: 110,
      Cell: ({ row }) => <span title={formatDateTime(row.original.CreatedAt)}>{formatDate(row.original.CreatedAt, { empty: "—" })}</span> },
    { id: "lastActivity", accessorKey: "LastActivityAt", header: "Last activity", enableSorting: true, size: 120,
      Cell: ({ row }) => {
        const stale = isStale(row.original);
        return <span data-stale={String(stale)} style={stale ? { color: idleInk, fontWeight: 600 } : undefined}>{formatDate(row.original.LastActivityAt, { empty: "—" })}</span>;
      } },
    { accessorKey: "Company", header: "Company", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "MobileNo", header: "Mobile", enableSorting: false, size: 120 },
    { accessorKey: "StatusName", header: "Status", enableSorting: false, size: 110,
      Cell: ({ row }) => <Chip label={row.original.StatusName || "—"} size="sm" tone={isActiveCode(row.original.StatusCode) ? "primary" : "default"} colors={statusChipColors(row.original.StatusCode)} /> },
    { accessorKey: "ProductName", header: "Product", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "OwnerName", header: "Owner", enableSorting: false, muiTableBodyCellProps: wrap, Cell: ({ cell }) => cell.getValue() || "Unassigned" },
    { accessorKey: "PartnerName", header: "Partner", enableSorting: false, muiTableBodyCellProps: wrap, Cell: ({ cell }) => cell.getValue() || "—" },
    { id: "value", accessorKey: "EstValue", header: "Value", enableSorting: true,
      Cell: ({ row }) => (row.original.StatusCode === "converted"
        ? <strong>{formatCurrency(row.original.WonValue, { empty: "—" })}</strong>
        : formatCurrency(row.original.EstValue, { empty: "—" })) },
    { id: "nextFollowUp", accessorKey: "NextFollowupDate", header: "Next Follow-up", enableSorting: true,
      Cell: ({ row, cell }) => <span style={row.original.IsOverdue ? { color: lateInk, fontWeight: 600 } : undefined}>{formatDue(cell.getValue(), { empty: "—" })}</span> },
  ], [lateInk, idleInk]);

  const extraParams = useMemo(() => ({
    StatusId: num(filters.StatusId), ProductId: num(filters.ProductId), OwnerId: num(filters.OwnerId),
    SourceId: num(filters.SourceId), BranchId: num(filters.BranchId), PartnerId: num(filters.PartnerId),
    ...(created.from && !created.error ? { FromDate: created.from, ToDate: created.to } : {}),
    ...presetParams(preset, userId),
  }), [filters, created, preset, userId]);

  const { table, sorting } = useServerTable({
    columns, queryKey: "leads", endpoint: SALES_ENDPOINTS.leads.fetchLeads, dataKey: "leads", extraParams,
    initialPageSize: 25, initialSorting: initial.sorting, enableSortingRemoval: false, getRowId: (row) => row.Id,
    enableRowSelection: true, enableRowActions: true,
    positionActionsColumn: "last",
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => navigate(`/sales/leads/${row.original.Id}`) }),
    renderRowActions: ({ row }) => (
      // The eye leads: the row already opens the lead, but nothing said so.
      <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="View lead & history"><IconButton size="sm" variant="ghost" tone="primary" aria-label="View lead" data-testid={`view-lead-${row.original.Id}`} onClick={() => navigate(`/sales/leads/${row.original.Id}`)}><Eye size={16} /></IconButton></Tooltip>
        <Tooltip title="Edit details"><IconButton size="sm" variant="ghost" tone="info" aria-label="Edit lead" data-testid={`edit-lead-${row.original.Id}`} onClick={() => setEditLead(row.original)}><Pencil size={16} /></IconButton></Tooltip>
        <Tooltip title="Transfer / reassign"><IconButton size="sm" variant="ghost" tone="warning" aria-label="Transfer lead" data-testid={`transfer-lead-${row.original.Id}`} onClick={() => setTransferIds([row.original.Id])}><ArrowRightLeft size={16} /></IconButton></Tooltip>
        <Tooltip title="Delete"><IconButton size="sm" variant="ghost" tone="error" aria-label="Delete lead" data-testid={`delete-lead-${row.original.Id}`} onClick={() => setDeleteLead(row.original)}><Trash2 size={16} /></IconButton></Tooltip>
      </Box>
    ),
  });

  // Compared as a string: setSearchParams changes identity on every navigation.
  const query = new URLSearchParams(leadsStateToParams({ filters, created, sorting })).toString();
  useEffect(() => {
    setSearchParams(query, { replace: true });
  }, [query]); // setSearchParams left out: see above

  const selectedIds = Object.keys(table.getState?.()?.rowSelection ?? {}).map(Number);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Leads"
        subtitle="Every prospect, who holds it, and what happens next."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            {selectedIds.length > 0 && (
              <Button variant="tonal" size="sm" leftIcon={<Users size={14} />} onClick={() => setTransferIds(selectedIds)} data-testid="bulk-reassign-btn">
                Reassign {selectedIds.length}
              </Button>
            )}
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)} data-testid="new-lead-btn">New Lead</Button>
            <HelpGuide guide={HELP_GUIDES.leads} />
          </Box>
        }
      />
      <Helmet><title>PRD Infotech | Leads</title></Helmet>

      <Box sx={{ mt: 1 }}><Tabs value={preset} onChange={setPreset} items={LEAD_PRESETS} data-testid="lead-presets" /></Box>

      <Box sx={{ display: "flex", gap: 1, mt: 1, mb: 0.5, flexWrap: "wrap" }}>
        <DateRangeField means="Created" heading="Show leads created…" allowAny value={created} onChange={(v) => setCreated({ ...v, error: null })} data-testid="filter-created" />
        <Box sx={{ flex: "1 1 calc(150rem / 15)", maxWidth: "calc(220rem / 15)" }}><Combobox size="sm" placeholder="All statuses" options={opts.status} value={optById(opts.status, filters.StatusId)} onChange={setFilterValue("StatusId")} data-testid="filter-status" /></Box>
        <Box sx={{ flex: "1 1 calc(150rem / 15)", maxWidth: "calc(220rem / 15)" }}><Combobox size="sm" placeholder="All products" options={opts.product} value={optById(opts.product, filters.ProductId)} onChange={setFilterValue("ProductId")} data-testid="filter-product" /></Box>
        <Box sx={{ flex: "1 1 calc(150rem / 15)", maxWidth: "calc(220rem / 15)" }}><Combobox size="sm" placeholder="All owners" options={opts.owner} value={optById(opts.owner, filters.OwnerId)} onChange={setFilterValue("OwnerId")} data-testid="filter-owner" /></Box>
        <Box sx={{ flex: "1 1 calc(150rem / 15)", maxWidth: "calc(220rem / 15)" }}><Combobox size="sm" placeholder="All sources" options={opts.source} value={optById(opts.source, filters.SourceId)} onChange={setFilterValue("SourceId")} data-testid="filter-source" /></Box>
        <Box sx={{ flex: "1 1 calc(150rem / 15)", maxWidth: "calc(220rem / 15)" }}><Combobox size="sm" placeholder="All partners" options={opts.partner} value={partnerOpt} onChange={setFilterValue("PartnerId")} data-testid="filter-partner" /></Box>
        <Box sx={{ flex: "1 1 calc(150rem / 15)", maxWidth: "calc(220rem / 15)" }}><Combobox size="sm" placeholder="All branches" options={opts.branch} value={optById(opts.branch, filters.BranchId)} onChange={setFilterValue("BranchId")} data-testid="filter-branch" /></Box>
      </Box>

      {created.error && (
        <Typography variant="caption" color="error" sx={{ mb: 0.5 }} data-testid="filter-created-error">{created.error}</Typography>
      )}

      <MaterialReactTable table={table} />

      <LeadCreateModal open={createOpen || Boolean(editLead)} lead={editLead} onClose={() => { setCreateOpen(false); setEditLead(null); }} />
      <TransferLeadModal open={transferIds.length > 0} leadIds={transferIds} canCrossBranch={leadsAccess.wide} onClose={() => setTransferIds([])} onTransferred={() => table.resetRowSelection?.()} />
      <DeleteLeadModal open={Boolean(deleteLead)} leadId={deleteLead?.Id} leadName={deleteLead?.Name} onClose={() => setDeleteLead(null)} />
    </Box>
  );
};

export default Leads;
