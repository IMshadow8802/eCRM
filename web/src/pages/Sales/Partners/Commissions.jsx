import { useMemo, useState } from "react";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { Link } from "react-router-dom";

import { Button, Chip, Combobox, DateField, Tabs } from "../../../components/ui";
import useAppTable from "../../../components/table/useAppTable";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { useAccess } from "../../../hooks/useAccess";
import { PARTNER_ENDPOINTS, COMMISSION_STATUS as STATUS, formatCommission } from "../../../api/partnerQueries";
import { formatCurrency, formatDate } from "../../../utils/format";
import MarkPaidModal from "./MarkPaidModal";

const TABS = [
  { value: "all", label: "All" },
  { value: "earned", label: "Earned" },
  { value: "due", label: "Ready to pay" },
  { value: "paid", label: "Paid" },
];

export default function Commissions() {
  const { edit: canEdit } = useAccess("partners");
  const [tab, setTab] = useState("all");
  const [partner, setPartner] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selection, setSelection] = useState({});
  const [payOpen, setPayOpen] = useState(false);

  const params = {
    ...(tab !== "all" && { Status: tab }),
    ...(partner && { PartnerId: partner.value }),
    ...(from && { FromDate: from }),
    ...(to && { ToDate: to }),
  };
  const { data, isLoading } = useApiQuery({
    queryKey: ["commissions", params], endpoint: PARTNER_ENDPOINTS.fetchCommissions, params,
  });
  const { data: partnerData } = useApiQuery({
    queryKey: ["partners", { IncludeInactive: true }], endpoint: PARTNER_ENDPOINTS.fetchPartners,
    params: { IncludeInactive: true }, showErrorMessage: false,
  });
  const partnerOptions = (partnerData?.partners ?? []).map((p) => ({ value: p.Id, label: p.Name }));
  const rows = useMemo(() => data?.commissions ?? [], [data]);

  const markDue = useApiMutation({
    endpoint: PARTNER_ENDPOINTS.setCommissionStatus,
    successMessage: "Marked ready to pay",
    invalidateQueries: [["commissions"], ["partners"]],
  });

  const selected = rows.filter((r) => selection[r.Id]);
  const allIn = (status) => selected.length > 0 && selected.every((r) => r.Status === status);
  const total = selected.reduce((s, r) => s + Number(r.Amount || 0), 0);

  const columns = useMemo(() => [
    { accessorKey: "PartnerName", header: "Partner" },
    {
      accessorKey: "LeadName", header: "Lead",
      Cell: ({ row }) => <Link to={`/sales/leads/${row.original.LeadId}`}>{row.original.LeadName}</Link>,
    },
    { accessorKey: "BaseValue", header: "Won value", Cell: ({ cell }) => formatCurrency(cell.getValue(), { empty: "—" }) },
    { id: "terms", header: "Terms", accessorFn: (r) => formatCommission(r.CommType, r.CommValue) },
    { accessorKey: "Amount", header: "Amount", Cell: ({ cell }) => formatCurrency(cell.getValue(), { empty: "—" }) },
    {
      accessorKey: "Status", header: "Status",
      Cell: ({ row }) => {
        const s = STATUS[row.original.Status] ?? STATUS.cancelled;
        return (
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            <Chip size="sm" tone={s.tone} label={s.label} />
            {row.original.Reverted && <Chip size="sm" tone="warning" label="Lead no longer converted" />}
          </Box>
        );
      },
    },
    {
      id: "paid", header: "Paid on",
      accessorFn: (r) => (r.PaidAt ? `${formatDate(r.PaidAt)}${r.PaidRef ? ` · ${r.PaidRef}` : ""}` : "—"),
    },
  ], []);

  const table = useAppTable({
    columns, data: rows, getRowId: (r) => String(r.Id),
    state: { rowSelection: selection, isLoading },
    enableRowSelection: canEdit,
    onRowSelectionChange: (u) => setSelection((prev) => (typeof u === "function" ? u(prev) : u)),
    enableColumnFilters: false,
  });

  return (
    <Box>
      <Tabs value={tab} onChange={(v) => { setTab(v); setSelection({}); }} items={TABS} data-testid="commission-tabs" />
      <Box sx={{ display: "flex", gap: 1, my: 1.5, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Box sx={{ flex: "1 1 200px", maxWidth: 260 }}>
          <Combobox size="sm" label="Partner" placeholder="All partners" options={partnerOptions} value={partner}
            onChange={setPartner} data-testid="commission-partner" />
        </Box>
        <Box sx={{ flex: "0 1 170px" }}><DateField size="sm" label="From" value={from} onChange={(v) => setFrom(v || "")} /></Box>
        <Box sx={{ flex: "0 1 170px" }}><DateField size="sm" label="To" value={to} onChange={(v) => setTo(v || "")} /></Box>
        {canEdit && (
          <Box sx={{ display: "flex", gap: 1, ml: "auto" }}>
            <Button size="sm" variant="tonal" disabled={!allIn("earned")} loading={markDue.isPending}
              onClick={() => markDue.mutate({ Ids: selected.map((r) => r.Id), ToStatus: "due" }, { onSuccess: () => setSelection({}) })}
              data-testid="bulk-due-btn">Ready to pay ({selected.length})</Button>
            <Button size="sm" variant="primary" disabled={!allIn("due")} onClick={() => setPayOpen(true)} data-testid="bulk-paid-btn">Mark paid ({selected.length})</Button>
          </Box>
        )}
      </Box>
      <MaterialReactTable table={table} />
      {selected.length > 0 && (
        <Box data-testid="selected-total" sx={{ mt: 1, fontSize: 14, fontWeight: 600 }}>Selected: {formatCurrency(total)}</Box>
      )}
      <MarkPaidModal open={payOpen} onClose={() => setPayOpen(false)} ids={selected.map((r) => r.Id)} total={total}
        onDone={() => setSelection({})} />
    </Box>
  );
}
