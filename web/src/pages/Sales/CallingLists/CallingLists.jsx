// src/pages/Sales/CallingLists/CallingLists.jsx — /sales/calling-lists (spec 13.1).
// One row per purchase. Managers (module `calling`) see the lists of the offices
// their leads access covers; cost is the admin's only (the server nulls it too).
import { lazy, Suspense, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";
import { Archive, FileSpreadsheet, Pause, Play, PhoneCall, Plus } from "lucide-react";

import { Button, Chip, Combobox, EmptyState, IconButton, Tooltip } from "../../../components/ui";
import PageHeader from "../../../components/ui/PageHeader";
import HelpGuide from "../../../components/HelpGuide";
import ConfirmationDialog from "../../../components/ConfirmationDialog";
import useServerTable from "../../../hooks/useServerTable";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { useConfirmation } from "../../../hooks/useConfirmation";
import { useAccess, useIsAdmin } from "../../../hooks/useAccess";
import { CALLING_ENDPOINTS, LIST_STATUS, listBody, usedUp } from "../../../api/callingQueries";
import { HELP_GUIDES } from "../../../data/helpGuides";
import { formatDate } from "../../../utils/format";

// The spreadsheet reader lives in the modal's chunk only.
const ListFormModal = lazy(() => import("./ListFormModal"));

export const num = (v) => Number(v ?? 0).toLocaleString("en-IN");
export const inr = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : `₹${Math.round(Number(v)).toLocaleString("en-IN")}`);
export const pct = (a, b) => (Number(b) ? `${((Number(a) / Number(b)) * 100).toFixed(1)}%` : "—");
const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...Object.entries(LIST_STATUS).map(([value, s]) => ({ value, label: s.label })),
];

export function ListStatusChip({ list }) {
  if (usedUp(list)) return <Chip size="sm" tone="warning" label="Contacts used up" />;
  const s = LIST_STATUS[list.Status] ?? LIST_STATUS.active;
  return <Chip size="sm" tone={s.tone} label={s.label} />;
}

export default function CallingLists() {
  const navigate = useNavigate();
  const p = useTheme().tokens;
  const access = useAccess("calling");
  const admin = useIsAdmin();
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(false);
  const confirmation = useConfirmation();

  const save = useApiMutation({ endpoint: CALLING_ENDPOINTS.saveList, successMessage: "List updated", invalidateQueries: [["calling-lists"]] });
  const setListStatus = (l, Status) => save.mutateAsync(listBody(l, { Status }));
  const archive = (l) => confirmation.showConfirmation({
    title: "Archive this list?", type: "warning", confirmText: "Archive",
    message: "Contacts with callers go back to the pool. The figures stay in reports.",
    onConfirm: () => setListStatus(l, "archived"),
  });

  const columns = useMemo(() => [
    { accessorKey: "Name", header: "Name", enableSorting: false, Cell: ({ row: { original: l } }) => (
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontWeight: 600 }}>{l.Name}</Box>
        <Box sx={{ fontSize: "calc(12rem / 15)", color: p.text.tertiary }}>
          {`${l.BranchName ?? "—"} office · ${l.AutoTopUp ? `Auto · holds ${l.HoldSize}` : "Manual"}`}
        </Box>
      </Box>
    ) },
    { accessorKey: "Vendor", header: "Vendor", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "PurchasedOn", header: "Bought", enableSorting: false, Cell: ({ cell }) => formatDate(cell.getValue(), { empty: "—" }) },
    ...(admin ? [{ accessorKey: "Cost", header: "Cost", enableSorting: false, Cell: ({ cell }) => inr(cell.getValue()) }] : []),
    ...[["Contacts", "Contacts"], ["InPool", "In pool"], ["Held", "With callers"], ["Callbacks", "Callbacks"], ["Closed", "Closed"], ["Leads", "Turned lead"]]
      .map(([k, header]) => ({ accessorKey: k, header, enableSorting: false, Cell: ({ cell }) => num(cell.getValue()) })),
    { id: "leadPct", header: "Lead %", enableSorting: false, accessorFn: (l) => pct(l.Leads, l.Contacts) },
    ...(admin ? [{ id: "costPerLead", header: "Cost / lead", enableSorting: false, accessorFn: (l) => (l.Cost != null && Number(l.Leads) ? inr(l.Cost / l.Leads) : "—") }] : []),
    { accessorKey: "Status", header: "Status", enableSorting: false, Cell: ({ row }) => <ListStatusChip list={row.original} /> },
  ], [admin, p]);

  const { table, data, isLoading, debouncedFilter } = useServerTable({
    columns, queryKey: "calling-lists", endpoint: CALLING_ENDPOINTS.fetchLists, dataKey: "lists",
    extraParams: status ? { Status: status } : {}, enabled: access.view,
    getRowId: (r) => String(r.Id),
    enableRowActions: access.edit,
    positionActionsColumn: "last",
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "" } },
    renderRowActions: ({ row: { original: l } }) => (l.Status === "archived" ? null : (
      <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={l.Status === "paused" ? "Resume" : "Pause"}>
          <IconButton size="sm" variant="ghost" aria-label={l.Status === "paused" ? "Resume list" : "Pause list"} data-testid={`pause-list-${l.Id}`}
            onClick={() => setListStatus(l, l.Status === "paused" ? "active" : "paused")}>
            {l.Status === "paused" ? <Play size={16} /> : <Pause size={16} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Archive">
          <IconButton size="sm" variant="ghost" aria-label="Archive list" data-testid={`archive-list-${l.Id}`} onClick={() => archive(l)}><Archive size={16} /></IconButton>
        </Tooltip>
      </Box>
    )),
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => navigate(`/sales/calling-lists/${row.original.Id}`) }),
    renderTopToolbarCustomActions: () => (
      <Box sx={{ width: "calc(180rem / 15)" }}>
        <Combobox size="sm" options={STATUS_OPTIONS} value={STATUS_OPTIONS.find((o) => o.value === status)} disableClearable
          onChange={(o) => setStatus(o?.value ?? "")} aria-label="Status" data-testid="list-status-filter" />
      </Box>
    ),
  });

  const header = (
    <PageHeader
      title="Calling Lists"
      subtitle="Bought data, handed out a few at a time. A contact becomes a lead only when they say yes."
      actions={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {access.add && <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setForm(true)} data-testid="new-list-btn">New list</Button>}
          <HelpGuide guide={HELP_GUIDES.callingLists} />
        </Box>
      }
    />
  );

  if (!access.view) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
        {header}
        <EmptyState icon={<PhoneCall size={32} />} title="Calling lists are managed by your manager"
          description="The contacts given to you are on the phone app, under Calling." />
      </Box>
    );
  }

  const empty = !isLoading && data.length === 0 && !debouncedFilter && !status;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
      {header}
      <Helmet><title>PRD Infotech | Calling Lists</title></Helmet>
      {empty ? (
        <EmptyState icon={<FileSpreadsheet size={32} />} title="No calling lists yet"
          description="Upload a sheet of bought contacts. Your team gets them on the phone a few at a time, and only the interested ones become leads." />
      ) : (
        <MaterialReactTable table={table} />
      )}
      {form && (
        <Suspense fallback={null}>
          <ListFormModal open onClose={() => setForm(false)} />
        </Suspense>
      )}
      <ConfirmationDialog
        open={confirmation.isOpen} onClose={confirmation.hideConfirmation} onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title} message={confirmation.confirmationState.message}
        confirmText={confirmation.confirmationState.confirmText} cancelText={confirmation.confirmationState.cancelText}
        type={confirmation.confirmationState.type} isLoading={confirmation.isLoading}
      />
    </Box>
  );
}
