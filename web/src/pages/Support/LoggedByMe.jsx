// src/pages/Support/LoggedByMe.jsx
//
// "Logged by me": every complaint the caller logged, wherever it went since.
// Exactly eight columns (spec §2.5). A row the caller can no longer open
// (CanOpen 0, the server sends Id null) is plain text — no link, no pointer.
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MaterialReactTable } from "material-react-table";

import { Chip } from "../../components/ui";
import useServerTable from "../../hooks/useServerTable";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { formatDate, formatDateTime } from "../../utils/format";
import { statusTone } from "./ticketStatus";

const canOpen = (r) => Boolean(r.CanOpen && r.Id);

export default function LoggedByMe() {
  const navigate = useNavigate();

  const columns = useMemo(() => [
    {
      accessorKey: "TicketNo", header: "Number", enableSorting: false,
      Cell: ({ row }) => (canOpen(row.original)
        ? <Link to={`/support/tickets/${row.original.Id}`} onClick={(e) => e.stopPropagation()}>{row.original.TicketNo}</Link>
        : row.original.TicketNo),
    },
    { accessorKey: "CreatedAt", header: "Logged on", enableSorting: false, Cell: ({ cell }) => formatDate(cell.getValue(), { empty: "—" }) },
    { accessorKey: "CustomerName", header: "Customer", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "Subject", header: "Subject", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    {
      accessorKey: "StatusName", header: "Status", enableSorting: false,
      Cell: ({ row }) => <Chip label={row.original.StatusName || "—"} size="sm" tone={statusTone(row.original.StatusCode)} />,
    },
    { accessorKey: "AssignedToName", header: "Assigned to", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "Unassigned" },
    {
      accessorKey: "DueAt", header: "Due", enableSorting: false,
      Cell: ({ row }) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "calc(6rem / 15)" }}>
          {formatDateTime(row.original.DueAt, { empty: "—" })}
          {Boolean(row.original.IsOverdue) && <Chip label="Overdue" size="sm" tone="error" />}
        </span>
      ),
    },
    { accessorKey: "ClosedOn", header: "Resolved / closed", enableSorting: false, Cell: ({ cell }) => formatDate(cell.getValue(), { empty: "—" }) },
  ], []);

  const { table } = useServerTable({
    columns,
    queryKey: "logged-by-me",
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchLoggedByMe,
    dataKey: "rows",
    initialPageSize: 25,
    getRowId: (row, i) => String(row.Id ?? `n${i}`),
    muiSearchTextFieldProps: { placeholder: "Search number, subject or customer" },
    muiTableBodyRowProps: ({ row }) => (canOpen(row.original)
      ? { hover: true, sx: { cursor: "pointer" }, onClick: () => navigate(`/support/tickets/${row.original.Id}`) }
      : { hover: false, sx: { cursor: "default" } }),
  });

  return <div data-testid="logged-by-me"><MaterialReactTable table={table} /></div>;
}
