// src/pages/Support/Tickets.jsx
//
// The complaints list (spec 2 §4). The stage board is gone; this is the
// landing page. Presets are the query — each tab maps onto presetParams
// params via presetParams — and every label (status, priority, category,
// channel, product, assignee, branch) is joined by the SP, so nothing is
// resolved client-side any more.
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { useSearchParams } from "react-router-dom";
import { ArrowRightLeft, Eye, Flag, Pencil, Plus, Trash2, Users } from "lucide-react";

import { Button, Chip, Combobox, DateField, IconButton, Tabs, Tooltip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUsers } from "../../hooks";
import { useLookups } from "../../hooks/useLookups";
import useAuthStore from "../../stores/useAuthStore";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { getUserName } from "../../utils/userShape";
import { TICKET_PRESETS, presetParams, ticketsParamsToState, statusTone, dueLabel } from "./ticketStatus";
import TicketCreateModal from "./TicketCreateModal";
import TicketDetailModal from "./TicketDetailModal";
import TransferTicketModal from "./TransferTicketModal";
import DeleteTicketModal from "./DeleteTicketModal";

const num = (v) => (v === "" ? null : Number(v));
// Hours since it was raised: "5h" under a day, "2d" after that.
const ageLabel = (h) => (h == null ? "—" : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);

const Tickets = () => {
  const theme = useTheme();
  const userId = useAuthStore((s) => s.user?.UserId ?? s.UserId);

  // The URL can arrive pre-filtered (a bookmark, a notification, a future
  // support report drilling in). Read once on mount; from then on the page
  // owns its state, so a stray URL change cannot wipe what the user typed.
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => ticketsParamsToState(searchParams));
  const [preset, setPreset] = useState(initial.preset);
  const [filters, setFilters] = useState(initial.filters);
  const [range, setRange] = useState(initial.range);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTicket, setEditTicket] = useState(null);
  const [detailTicketId, setDetailTicketId] = useState(null);
  const [transferIds, setTransferIds] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const setFilterValue = (key) => (opt) => setFilters((prev) => ({ ...prev, [key]: opt?.value ?? "" }));

  const quiet = { showErrorMessage: false };
  const { lookups: statuses } = useLookups("ticket_status", quiet);
  const { lookups: priorities } = useLookups("priority", quiet);
  const { lookups: categories } = useLookups("ticket_category", quiet);
  const { lookups: channels } = useLookups("ticket_channel", quiet);
  const { data: usersData } = useUsers({ PageSize: 1000 });
  const { data: productsData } = useApiQuery({ queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, showErrorMessage: false });
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });

  const opts = {
    status: useMemo(() => statuses.map((s) => ({ value: s.Id, label: s.Value })), [statuses]),
    priority: useMemo(() => priorities.map((p) => ({ value: p.Id, label: p.Value })), [priorities]),
    category: useMemo(() => categories.map((c) => ({ value: c.Id, label: c.Value })), [categories]),
    channel: useMemo(() => channels.map((c) => ({ value: c.Id, label: c.Value })), [channels]),
    product: useMemo(() => (productsData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })), [productsData]),
    assignee: useMemo(() => (usersData?.users ?? []).map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })), [usersData]),
    branch: useMemo(() => (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName })), [branchData]),
  };
  const optById = (list, v) => list.find((o) => o.value === v) ?? null;

  const overdueSx = { color: theme.tokens.error.main, fontWeight: 600 };
  const columns = useMemo(() => [
    { accessorKey: "TicketNo", header: "No.", enableSorting: true, size: 110 },
    { accessorKey: "Subject", header: "Subject", enableSorting: true, Cell: ({ cell }) => cell.getValue() || "—" },
    {
      accessorKey: "CustomerName", header: "Customer", enableSorting: true,
      // Name and mobile together: three spellings of one shop is exactly what
      // tblCustomer exists to fix, and the mobile is what tells them apart.
      Cell: ({ row }) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.original.CustomerName || "—"}</div>
          <div style={{ fontSize: 12, color: theme.tokens.text.secondary }}>{row.original.CustomerMobile || "—"}</div>
        </div>
      ),
    },
    {
      accessorKey: "StatusName", header: "Status", enableSorting: false,
      Cell: ({ row }) => <Chip label={row.original.StatusName || "—"} size="sm" tone={statusTone(row.original.StatusCode)} />,
    },
    {
      accessorKey: "PriorityName", header: "Priority", enableSorting: false,
      Cell: ({ cell }) => (cell.getValue() ? <Chip label={cell.getValue()} size="sm" tone="accent" variant="tonal" /> : "—"),
    },
    {
      accessorKey: "DueAt", header: "Due", enableSorting: true,
      Cell: ({ row }) => (
        <span data-testid={`ticket-due-${row.original.Id}`} style={row.original.IsOverdue ? overdueSx : undefined}>
          {dueLabel(row.original.DueAt, row.original.IsOverdue)}
        </span>
      ),
    },
    { accessorKey: "AssigneeName", header: "Assignee", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "Unassigned" },
    {
      id: "escalated", header: "", enableSorting: false, size: 52,
      Cell: ({ row }) => (row.original.EscalatedTo ? (
        <Tooltip title={`Escalated to ${row.original.EscalatedToName ?? "a senior"}`}>
          <span data-testid={`ticket-escalated-${row.original.Id}`} style={{ display: "inline-flex", color: theme.tokens.warning.main }}>
            <Flag size={15} />
          </span>
        </Tooltip>
      ) : "—"),
    },
    { accessorKey: "AgeHours", header: "Age", enableSorting: false, size: 70, Cell: ({ cell }) => ageLabel(cell.getValue()) },
  ], [theme, overdueSx.color]);

  // presetParams is spread LAST: on "My queue" it overwrites the assignee
  // filter with the caller's id, because that is what the tab means.
  const extraParams = useMemo(() => ({
    StatusId: num(filters.StatusId), Priority: num(filters.Priority), CategoryId: num(filters.CategoryId),
    ChannelId: num(filters.ChannelId), ProductId: num(filters.ProductId), AssignedTo: num(filters.AssignedTo),
    BranchId: num(filters.BranchId),
    ...(range.from ? { FromDate: range.from } : {}),
    ...(range.to ? { ToDate: range.to } : {}),
    ...presetParams(preset, userId),
  }), [filters, range, preset, userId]);

  const { table } = useServerTable({
    columns, queryKey: "tickets", endpoint: SUPPORT_ENDPOINTS.tickets.fetchTickets, dataKey: "tickets", extraParams,
    initialPageSize: 25, getRowId: (row) => row.Id,
    enableRowSelection: true, enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => setDetailTicketId(row.original.Id) }),
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="Open the complaint"><IconButton size="sm" variant="ghost" tone="primary" aria-label="View complaint" data-testid={`view-ticket-${row.original.Id}`} onClick={() => setDetailTicketId(row.original.Id)}><Eye size={16} /></IconButton></Tooltip>
        <Tooltip title="Edit details"><IconButton size="sm" variant="ghost" tone="info" aria-label="Edit complaint" data-testid={`edit-ticket-${row.original.Id}`} onClick={() => setEditTicket(row.original)}><Pencil size={16} /></IconButton></Tooltip>
        <Tooltip title="Transfer / reassign"><IconButton size="sm" variant="ghost" tone="warning" aria-label="Transfer complaint" data-testid={`transfer-ticket-${row.original.Id}`} onClick={() => setTransferIds([row.original.Id])}><ArrowRightLeft size={16} /></IconButton></Tooltip>
        <Tooltip title="Delete"><IconButton size="sm" variant="ghost" tone="error" aria-label="Delete complaint" data-testid={`delete-ticket-${row.original.Id}`} onClick={() => setDeleteTarget(row.original)}><Trash2 size={16} /></IconButton></Tooltip>
      </Box>
    ),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  const selectedIds = Object.keys(table.getState?.()?.rowSelection ?? {}).map(Number);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Complaints"
        subtitle="Every complaint, who holds it, and when it is due."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {selectedIds.length > 0 && (
              <Button variant="tonal" size="sm" leftIcon={<Users size={14} />} onClick={() => setTransferIds(selectedIds)} data-testid="bulk-reassign-btn">
                Reassign {selectedIds.length}
              </Button>
            )}
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)} data-testid="new-ticket-btn">New Ticket</Button>
            <HelpGuide guide={HELP_GUIDES.tickets} />
          </Box>
        }
      />
      <Helmet><title>PRD Infotech | Complaints</title></Helmet>

      <Box sx={{ mt: 1 }}><Tabs value={preset} onChange={setPreset} items={TICKET_PRESETS} data-testid="ticket-presets" /></Box>

      {/* Every control in this row carries a label, or none of them may.
          Two labelled dates beside seven unlabelled dropdowns sat half a
          control lower than the rest of the row — and the dates could not go
          label-less, because MUI's DatePicker renders its own DD-MM-YYYY mask
          and ignores a placeholder, so an unlabelled date filter says nothing
          about what it filters. `alignItems: flex-end` no longer has to rescue
          anything, but it stays for the wrapped case. */}
      <Box sx={{ display: "flex", gap: 1, mt: 1, mb: 0.5, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Box sx={{ width: 160 }}><Combobox size="sm" label="Status" placeholder="All statuses" options={opts.status} value={optById(opts.status, filters.StatusId)} onChange={setFilterValue("StatusId")} data-testid="filter-status" /></Box>
        <Box sx={{ width: 150 }}><Combobox size="sm" label="Priority" placeholder="All priorities" options={opts.priority} value={optById(opts.priority, filters.Priority)} onChange={setFilterValue("Priority")} data-testid="filter-priority" /></Box>
        <Box sx={{ width: 160 }}><Combobox size="sm" label="Category" placeholder="All categories" options={opts.category} value={optById(opts.category, filters.CategoryId)} onChange={setFilterValue("CategoryId")} data-testid="filter-category" /></Box>
        <Box sx={{ width: 150 }}><Combobox size="sm" label="Channel" placeholder="All channels" options={opts.channel} value={optById(opts.channel, filters.ChannelId)} onChange={setFilterValue("ChannelId")} data-testid="filter-channel" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" label="Product" placeholder="All products" options={opts.product} value={optById(opts.product, filters.ProductId)} onChange={setFilterValue("ProductId")} data-testid="filter-product" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" label="Assignee" placeholder="All assignees" options={opts.assignee} value={optById(opts.assignee, filters.AssignedTo)} onChange={setFilterValue("AssignedTo")} data-testid="filter-assignee" /></Box>
        <Box sx={{ width: 170 }}><Combobox size="sm" label="Branch" placeholder="All branches" options={opts.branch} value={optById(opts.branch, filters.BranchId)} onChange={setFilterValue("BranchId")} data-testid="filter-branch" /></Box>
        <Box sx={{ width: 160 }}><DateField size="sm" label="Raised from" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} data-testid="tickets-from" /></Box>
        <Box sx={{ width: 160 }}><DateField size="sm" label="Raised to" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} data-testid="tickets-to" /></Box>
      </Box>

      <MaterialReactTable table={table} />

      <TicketCreateModal
        open={createOpen || Boolean(editTicket)}
        ticket={editTicket}
        onClose={() => { setCreateOpen(false); setEditTicket(null); }}
        onSaved={(res) => { if (createOpen && res?.Id) setDetailTicketId(res.Id); }}
      />
      <TicketDetailModal ticketId={detailTicketId} open={Boolean(detailTicketId)} onClose={() => setDetailTicketId(null)} />
      <TransferTicketModal open={transferIds.length > 0} ticketIds={transferIds} onClose={() => setTransferIds([])} onDone={() => table.resetRowSelection?.()} />
      <DeleteTicketModal open={Boolean(deleteTarget)} ticketId={deleteTarget?.Id} ticketNo={deleteTarget?.TicketNo} onClose={() => setDeleteTarget(null)} />
    </Box>
  );
};

export default Tickets;
