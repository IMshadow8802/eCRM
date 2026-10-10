import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useSearchParams } from "react-router-dom";
import { Pencil, Plus, Power, RotateCcw } from "lucide-react";

import { Button, Chip, IconButton, Switch, Tabs, Tooltip } from "../../../components/ui";
import PageHeader from "../../../components/ui/PageHeader";
import HelpGuide from "../../../components/HelpGuide";
import ConfirmationDialog from "../../../components/ConfirmationDialog";
import useAppTable from "../../../components/table/useAppTable";
import { useConfirmation } from "../../../hooks/useConfirmation";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { useAccess } from "../../../hooks/useAccess";
import { PARTNER_ENDPOINTS, formatCommission } from "../../../api/partnerQueries";
import { formatCurrency } from "../../../utils/format";
import { HELP_GUIDES } from "../../../data/helpGuides";
import PartnerFormModal from "./PartnerFormModal";
import Commissions from "./Commissions";

const TABS = [
  { value: "partners", label: "Partners" },
  { value: "commissions", label: "Commissions" },
];
const dash = ({ cell }) => cell.getValue() || "—";

function PartnersTab({ canEdit, onEdit }) {
  const [showInactive, setShowInactive] = useState(false);
  const confirmation = useConfirmation();

  const params = showInactive ? { IncludeInactive: true } : {};
  const { data, isLoading } = useApiQuery({ queryKey: ["partners", params], endpoint: PARTNER_ENDPOINTS.fetchPartners, params });
  const rows = useMemo(() => data?.partners ?? [], [data]);

  const save = useApiMutation({
    endpoint: PARTNER_ENDPOINTS.savePartner, successMessage: "Partner updated", invalidateQueries: [["partners"]],
  });
  const deactivate = (p) => confirmation.showConfirmation({
    title: "Deactivate partner", type: "warning", confirmText: "Deactivate",
    message: `${p.Name} will stop showing in the partner list on leads. Their past commissions stay as they are.`,
    onConfirm: () => save.mutateAsync({
      Id: p.Id, Name: p.Name, ContactPerson: p.ContactPerson, Mobile: p.Mobile, Email: p.Email, City: p.City, Notes: p.Notes,
      CommType: p.CommType, CommValue: p.CommValue, IsActive: false,
    }),
  });

  const reactivate = (p) => save.mutate({
    Id: p.Id, Name: p.Name, ContactPerson: p.ContactPerson, Mobile: p.Mobile, Email: p.Email, City: p.City, Notes: p.Notes,
    CommType: p.CommType, CommValue: p.CommValue, IsActive: true,
  });

  const columns = useMemo(() => [
    { accessorKey: "Name", header: "Name", Cell: ({ row }) => (
      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>{row.original.Name}{!row.original.IsActive && <Chip size="sm" label="Inactive" />}</Box>
    ) },
    { accessorKey: "Mobile", header: "Mobile", Cell: dash },
    { accessorKey: "City", header: "City", Cell: dash },
    { id: "terms", header: "Usual commission", accessorFn: (r) => formatCommission(r.CommType, r.CommValue) },
    { accessorKey: "LeadsSent", header: "Leads sent", Cell: ({ cell }) => cell.getValue() ?? 0 },
    { accessorKey: "Converted", header: "Converted", Cell: ({ cell }) => cell.getValue() ?? 0 },
    { accessorKey: "DueAmount", header: "Due (₹)", Cell: ({ cell }) => formatCurrency(cell.getValue() ?? 0) },
  ], []);

  const table = useAppTable({
    columns, data: rows, getRowId: (r) => String(r.Id), state: { isLoading },
    enableRowActions: canEdit,
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Tooltip title="Edit partner"><IconButton size="sm" variant="ghost" tone="info" aria-label="Edit partner" data-testid={`edit-partner-${row.original.Id}`} onClick={() => onEdit(row.original)}><Pencil size={16} /></IconButton></Tooltip>
        {row.original.IsActive ? (
          <Tooltip title="Deactivate"><IconButton size="sm" variant="ghost" tone="error" aria-label="Deactivate partner" data-testid={`deactivate-partner-${row.original.Id}`} onClick={() => deactivate(row.original)}><Power size={16} /></IconButton></Tooltip>
        ) : (
          <Tooltip title="Reactivate"><IconButton size="sm" variant="ghost" tone="success" aria-label="Reactivate partner" data-testid={`reactivate-partner-${row.original.Id}`} onClick={() => reactivate(row.original)}><RotateCcw size={16} /></IconButton></Tooltip>
        )}
      </Box>
    ),
    renderTopToolbarCustomActions: () => (
      <Switch size="sm" label="Show inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
    ),
  });

  return (
    <>
      <MaterialReactTable table={table} />
      <ConfirmationDialog
        open={confirmation.isOpen} onClose={confirmation.hideConfirmation} onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title} message={confirmation.confirmationState.message}
        confirmText={confirmation.confirmationState.confirmText} cancelText={confirmation.confirmationState.cancelText}
        type={confirmation.confirmationState.type} isLoading={confirmation.isLoading}
      />
    </>
  );
}

export default function Partners() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "commissions" ? "commissions" : "partners";
  const { add, edit } = useAccess("partners");
  const [form, setForm] = useState(null); // null = closed, {} = new partner, row = edit

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Partners"
        subtitle="People and firms who send you leads, and what you owe them."
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {add && <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setForm({})} data-testid="add-partner-btn">Add partner</Button>}
            <HelpGuide guide={HELP_GUIDES.partners} />
          </Box>
        }
      />
      <Helmet><title>PRD Infotech | Partners</title></Helmet>
      <Box sx={{ mt: 1, mb: 1.5 }}>
        <Tabs value={tab} onChange={(v) => setParams(v === "partners" ? {} : { tab: v })} items={TABS} data-testid="partner-tabs" />
      </Box>
      {tab === "partners" ? <PartnersTab canEdit={edit} onEdit={setForm} /> : <Commissions />}
      <PartnerFormModal open={form !== null} partner={form?.Id ? form : null} onClose={() => setForm(null)} />
    </Box>
  );
}
