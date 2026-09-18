// src/pages/Support/Customers.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useSearchParams } from "react-router-dom";
import { Eye, Pencil, Plus } from "lucide-react";

import { Button, Chip, IconButton, Tooltip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import useServerTable from "../../hooks/useServerTable";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { formatDate } from "../../utils/format";
import CustomerFormModal from "./CustomerFormModal";
import CustomerDetailModal from "./CustomerDetailModal";

const idParam = (v) => (v && /^\d+$/.test(v) ? Number(v) : null);

/**
 * Everyone who has raised a complaint (spec 2 §4). Company-wide on purpose:
 * de-duplicating three spellings of one mobile needs the whole list. The
 * table's own search box drives sp_FetchCustomers @SearchTerm (name, contact,
 * mobile, email, city).
 */
const Customers = () => {
  // TicketDetail's "N previous complaints" link lands here with the id in the
  // URL. Read once on mount; from then on the page owns its state.
  const [searchParams] = useSearchParams();
  const [detailId, setDetailId] = useState(() => idParam(searchParams.get("customerId")));
  const [createOpen, setCreateOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);

  const columns = useMemo(() => [
    { accessorKey: "Name", header: "Name", enableSorting: true },
    { accessorKey: "ContactPerson", header: "Contact", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "Mobile", header: "Mobile", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "City", header: "City", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "OpenTickets", header: "Open", enableSorting: false, size: 80,
      Cell: ({ cell }) => <Chip label={String(cell.getValue() ?? 0)} size="sm" tone={cell.getValue() > 0 ? "warning" : "default"} data-testid="open-count-chip" /> },
    { accessorKey: "TotalTickets", header: "Total", enableSorting: false, size: 80, Cell: ({ cell }) => cell.getValue() ?? 0 },
    { accessorKey: "LastTicketAt", header: "Last complaint", enableSorting: true, Cell: ({ cell }) => formatDate(cell.getValue(), { empty: "—" }) },
  ], []);

  const { table } = useServerTable({
    columns, queryKey: "customers", endpoint: SUPPORT_ENDPOINTS.customers.fetchCustomers, dataKey: "customers",
    initialPageSize: 25, getRowId: (row) => row.Id,
    enableRowActions: true,
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "Actions" } },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => setDetailId(row.original.Id) }),
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="View customer & complaints"><IconButton size="sm" variant="ghost" tone="primary" aria-label="View customer" data-testid={`view-customer-${row.original.Id}`} onClick={() => setDetailId(row.original.Id)}><Eye size={16} /></IconButton></Tooltip>
        <Tooltip title="Edit details"><IconButton size="sm" variant="ghost" tone="info" aria-label="Edit customer" data-testid={`edit-customer-${row.original.Id}`} onClick={() => setEditCustomer(row.original)}><Pencil size={16} /></IconButton></Tooltip>
      </Box>
    ),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Customers"
        subtitle="Everyone who has raised a complaint, and how many are still open."
        actions={
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)} data-testid="new-customer-btn">
            New Customer
          </Button>
        }
      />
      <Helmet><title>PRD Infotech | Customers</title></Helmet>

      <MaterialReactTable table={table} />

      {/* Saving invalidates ["customers"] (the table) and ["customer-detail"] (the modal). */}
      <CustomerFormModal
        open={createOpen || Boolean(editCustomer)}
        customer={editCustomer}
        onClose={() => { setCreateOpen(false); setEditCustomer(null); }}
      />
      <CustomerDetailModal
        customerId={detailId}
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        onEdit={(c) => { setDetailId(null); setEditCustomer(c); }}
      />
    </Box>
  );
};

export default Customers;
