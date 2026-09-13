// src/pages/Sales/Leads.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRightLeft, Eye, Pencil, Plus, Trash2, Users } from "lucide-react";

import { Button, Combobox, IconButton, Tooltip, Tabs, Chip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUsers } from "../../hooks";
import { useLookups } from "../../hooks/useLookups";
import useAuthStore from "../../stores/useAuthStore";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatCurrency, formatDate } from "../../utils/format";
import { getUserName } from "../../utils/userShape";
import { LEAD_PRESETS, presetParams, isActiveCode, leadsParamsToState } from "./leadStatus";
import LeadCreateModal from "./LeadCreateModal";
import TransferLeadModal from "./TransferLeadModal";
import DeleteLeadModal from "./DeleteLeadModal";

const num = (v) => (v === "" ? null : Number(v));

const Leads = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const userId = useAuthStore((s) => s.user?.UserId ?? s.UserId);

  // A report drill-down lands here with its filters in the URL (spec 4a).
  // Read once on mount; from then on the page owns its state, so a stray URL
  // change cannot wipe what the user has typed. This holds only because every
  // drill arrives from a /reports/* path and so remounts this component —
  // React Router does NOT remount on a search-string-only change, so an
  // in-page link to /sales/leads?... would silently do nothing. Don't add one.
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => leadsParamsToState(searchParams));
  const [preset, setPreset] = useState(initial.preset);
  const [filters, setFilters] = useState(initial.filters);
  const [range, setRange] = useState(initial.range);
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

  const opts = {
    status: useMemo(() => statuses.map((s) => ({ value: s.Id, label: s.Value })), [statuses]),
    product: useMemo(() => (productsData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })), [productsData]),
    owner: useMemo(() => (usersData?.users ?? []).map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })), [usersData]),
    source: useMemo(() => sources.map((s) => ({ value: s.Id, label: s.Value })), [sources]),
    branch: useMemo(() => (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })), [branchData]),
  };
  const optById = (list, v) => list.find((o) => o.value === v) ?? null;

  // Every label comes from the SP now; no client-side id → name resolution.
  const overdueSx = { color: theme.tokens.error.main, fontWeight: 600 };
  const columns = useMemo(() => [
    { accessorKey: "Name", header: "Name", enableSorting: true },
    { accessorKey: "Company", header: "Company", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "MobileNo", header: "Mobile", enableSorting: false },
    { accessorKey: "City", header: "City", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "StatusName", header: "Status", enableSorting: false,
      Cell: ({ row }) => <Chip label={row.original.StatusName || "—"} size="sm" tone={isActiveCode(row.original.StatusCode) ? "primary" : "default"} /> },
    { accessorKey: "ProductName", header: "Product", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "OwnerName", header: "Owner", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "Unassigned" },
    { accessorKey: "EstValue", header: "Est. Value", enableSorting: true, Cell: ({ cell }) => formatCurrency(cell.getValue(), { empty: "—" }) },
    { accessorKey: "NextFollowupDate", header: "Next Follow-up", enableSorting: true,
      Cell: ({ row, cell }) => <span style={row.original.IsOverdue ? overdueSx : undefined}>{formatDate(cell.getValue(), { empty: "—" })}</span> },
  ], [overdueSx.color]);

  const extraParams = useMemo(() => ({
    StatusId: num(filters.StatusId), ProductId: num(filters.ProductId), OwnerId: num(filters.OwnerId),
    SourceId: num(filters.SourceId), BranchId: num(filters.BranchId),
    ...(range.from ? { FromDate: range.from } : {}),
    ...(range.to ? { ToDate: range.to } : {}),
    ...presetParams(preset, userId),
  }), [filters, range, preset, userId]);

  const { table } = useServerTable({
    columns, queryKey: "leads", endpoint: SALES_ENDPOINTS.leads.fetchLeads, dataKey: "leads", extraParams,
    initialPageSize: 25, getRowId: (row) => row.Id,
    enableRowSelection: true, enableRowActions: true,
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
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  const selectedIds = Object.keys(table.getState?.()?.rowSelection ?? {}).map(Number);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Leads"
        subtitle="Every prospect, who holds it, and what happens next."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All statuses" options={opts.status} value={optById(opts.status, filters.StatusId)} onChange={setFilterValue("StatusId")} data-testid="filter-status" /></Box>
        <Box sx={{ width: 180 }}><Combobox size="sm" placeholder="All products" options={opts.product} value={optById(opts.product, filters.ProductId)} onChange={setFilterValue("ProductId")} data-testid="filter-product" /></Box>
        <Box sx={{ width: 180 }}><Combobox size="sm" placeholder="All owners" options={opts.owner} value={optById(opts.owner, filters.OwnerId)} onChange={setFilterValue("OwnerId")} data-testid="filter-owner" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All sources" options={opts.source} value={optById(opts.source, filters.SourceId)} onChange={setFilterValue("SourceId")} data-testid="filter-source" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" placeholder="All branches" options={opts.branch} value={optById(opts.branch, filters.BranchId)} onChange={setFilterValue("BranchId")} data-testid="filter-branch" /></Box>
      </Box>

      {(range.from || range.to) && (
        <Box sx={{ mb: 0.5 }}>
          <Chip tone="info" label={`Created ${formatDate(range.from, { empty: "…" })} – ${formatDate(range.to, { empty: "…" })}`}
            onDelete={() => setRange({ from: "", to: "" })} data-testid="leads-range-chip" />
        </Box>
      )}

      <Box sx={{ width: "100%", overflowX: "auto" }}><MaterialReactTable table={table} /></Box>

      <LeadCreateModal open={createOpen || Boolean(editLead)} lead={editLead} onClose={() => { setCreateOpen(false); setEditLead(null); }} />
      {/* canCrossBranch is always on here: the server (assertCanAssign) is the
          gate and answers a Team/Self caller with a clear 403. The prop exists
          so spec 2 can hide the picker once DataScope reaches the client. */}
      <TransferLeadModal open={transferIds.length > 0} leadIds={transferIds} canCrossBranch onClose={() => setTransferIds([])} onTransferred={() => table.resetRowSelection?.()} />
      <DeleteLeadModal open={Boolean(deleteLead)} leadId={deleteLead?.Id} leadName={deleteLead?.Name} onClose={() => setDeleteLead(null)} />
    </Box>
  );
};

export default Leads;
