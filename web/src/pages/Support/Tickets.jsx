// src/pages/Support/Tickets.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Chip, TextField } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUsers } from "../../hooks";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { findUserById, getUserName } from "../../utils/userShape";

const Tickets = () => {
  const navigate = useNavigate();

  // Filters forwarded verbatim as exact-match params (null = no filter).
  // BreachedOnly is a toggle sent as 1/0. sp_FetchTickets accepts these names.
  const [filters, setFilters] = useState({
    StageId: "",
    Priority: "",
    CategoryId: "",
    AssignedTo: "",
    BreachedOnly: false,
  });
  const setFilter = (key) => (e) =>
    setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const users = usersData?.users || [];

  // sp_FetchTickets returns raw lookup/stage ids (no name join), so the
  // filters/columns resolve display names from lookups + pipeline stages.
  const { data: prioritiesData } = useApiQuery({
    queryKey: ["ticket-priorities"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "priority" },
  });
  const priorities = prioritiesData?.lookups || [];
  const priorityById = useMemo(
    () => new Map(priorities.map((p) => [p.Id, p.Value])),
    [priorities]
  );

  const { data: categoriesData } = useApiQuery({
    queryKey: ["ticket-categories"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "ticket_category" },
  });
  const categories = categoriesData?.lookups || [];
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.Id, c.Value])),
    [categories]
  );

  const { data: pipelinesData } = useApiQuery({
    queryKey: ["support-pipelines", "ticket"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchPipelines,
    params: { Entity: "ticket" },
  });
  const stages = pipelinesData?.stages || [];
  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.Id, s.Name])),
    [stages]
  );

  const columns = useMemo(
    () => [
      { accessorKey: "TicketNo", header: "Ticket #", enableSorting: true },
      { accessorKey: "CustomerName", header: "Customer", enableSorting: true },
      { accessorKey: "Contact", header: "Contact", enableSorting: false },
      {
        accessorKey: "Priority",
        header: "Priority",
        enableSorting: false,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return priorityById.get(value) || (value ? `Priority #${value}` : "—");
        },
      },
      {
        accessorKey: "CategoryId",
        header: "Category",
        enableSorting: false,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return categoryById.get(value) || (value ? `Category #${value}` : "—");
        },
      },
      {
        accessorKey: "StageId",
        header: "Stage",
        enableSorting: false,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return stageById.get(value) || (value ? `Stage #${value}` : "—");
        },
      },
      {
        accessorKey: "AssignedTo",
        header: "Assignee",
        enableSorting: false,
        Cell: ({ cell }) => {
          const user = findUserById(users, cell.getValue());
          return user ? getUserName(user) || "—" : "—";
        },
      },
      {
        accessorKey: "IsBreached",
        header: "SLA",
        enableSorting: false,
        Cell: ({ cell }) =>
          cell.getValue() ? (
            <Chip label="Breached" color="error" size="small" />
          ) : (
            "—"
          ),
      },
    ],
    [users, priorityById, categoryById, stageById]
  );

  const extraParams = useMemo(
    () => ({
      StageId: filters.StageId === "" ? null : Number(filters.StageId),
      Priority: filters.Priority === "" ? null : Number(filters.Priority),
      CategoryId: filters.CategoryId === "" ? null : Number(filters.CategoryId),
      AssignedTo: filters.AssignedTo === "" ? null : Number(filters.AssignedTo),
      BreachedOnly: filters.BreachedOnly ? 1 : 0,
    }),
    [filters]
  );

  const { table } = useServerTable({
    columns,
    queryKey: "tickets",
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchTickets,
    dataKey: "tickets",
    extraParams,
    initialPageSize: 25,
    getRowId: (row) => row.Id,
    enableRowActions: false,
    muiTableBodyRowProps: ({ row }) => ({
      hover: true,
      sx: { cursor: "pointer" },
      onClick: () => navigate(`/support/tickets/${row.original.Id}`),
    }),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Tickets"
        subtitle="Support requests moving through resolution."
      />
      <Helmet>
        <title>PRD Infotech | Tickets</title>
      </Helmet>
      <Box sx={{ display: "flex", gap: 2, my: 2, flexWrap: "wrap" }}>
        <TextField
          select
          label="Stage"
          size="small"
          value={filters.StageId}
          onChange={setFilter("StageId")}
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 160 }}
        >
          <option value="">All Stages</option>
          {stages.map((stage) => (
            <option key={stage.Id} value={stage.Id}>
              {stage.Name}
            </option>
          ))}
        </TextField>
        <TextField
          select
          label="Priority"
          size="small"
          value={filters.Priority}
          onChange={setFilter("Priority")}
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 160 }}
        >
          <option value="">All Priorities</option>
          {priorities.map((p) => (
            <option key={p.Id} value={p.Id}>
              {p.Value}
            </option>
          ))}
        </TextField>
        <TextField
          select
          label="Category"
          size="small"
          value={filters.CategoryId}
          onChange={setFilter("CategoryId")}
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 160 }}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.Id} value={c.Id}>
              {c.Value}
            </option>
          ))}
        </TextField>
        <TextField
          select
          label="Assignee"
          size="small"
          value={filters.AssignedTo}
          onChange={setFilter("AssignedTo")}
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 180 }}
        >
          <option value="">All Assignees</option>
          {users.map((user) => (
            <option key={user.Id} value={user.Id}>
              {getUserName(user) || user.Username}
            </option>
          ))}
        </TextField>
        <TextField
          select
          label="SLA"
          size="small"
          value={filters.BreachedOnly ? "1" : ""}
          onChange={(e) =>
            setFilters((prev) => ({
              ...prev,
              BreachedOnly: e.target.value === "1",
            }))
          }
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 160 }}
        >
          <option value="">All Tickets</option>
          <option value="1">Breached Only</option>
        </TextField>
      </Box>
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>
    </Box>
  );
};

export default Tickets;
