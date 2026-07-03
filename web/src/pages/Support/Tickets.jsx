// src/pages/Support/Tickets.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, Chip } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";

import { Combobox } from "../../components/ui";
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
  // Combobox hands back the selected option (or null when cleared); store its
  // value ("" = no filter, matching extraParams below).
  const setFilterValue = (key) => (opt) =>
    setFilters((prev) => ({ ...prev, [key]: opt?.value ?? "" }));

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

  // Filter option lists ({value,label}) for the Combobox filters.
  const stageOpts = useMemo(() => stages.map((s) => ({ value: s.Id, label: s.Name })), [stages]);
  const priorityOpts = useMemo(() => priorities.map((p) => ({ value: p.Id, label: p.Value })), [priorities]);
  const categoryOpts = useMemo(() => categories.map((c) => ({ value: c.Id, label: c.Value })), [categories]);
  const assigneeOpts = useMemo(
    () => users.map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })),
    [users]
  );
  const breachedOpts = [{ value: "1", label: "Breached only" }];
  const optById = (opts, v) => opts.find((o) => o.value === v) ?? null;

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
      <Box sx={{ display: "flex", gap: 1, mt: 1, mb: 0.5, flexWrap: "wrap" }}>
        <Box sx={{ width: 160 }}>
          <Combobox
            size="sm"
            placeholder="All stages"
            options={stageOpts}
            value={optById(stageOpts, filters.StageId)}
            onChange={setFilterValue("StageId")}
            data-testid="filter-stage"
          />
        </Box>
        <Box sx={{ width: 160 }}>
          <Combobox
            size="sm"
            placeholder="All priorities"
            options={priorityOpts}
            value={optById(priorityOpts, filters.Priority)}
            onChange={setFilterValue("Priority")}
            data-testid="filter-priority"
          />
        </Box>
        <Box sx={{ width: 160 }}>
          <Combobox
            size="sm"
            placeholder="All categories"
            options={categoryOpts}
            value={optById(categoryOpts, filters.CategoryId)}
            onChange={setFilterValue("CategoryId")}
            data-testid="filter-category"
          />
        </Box>
        <Box sx={{ width: 180 }}>
          <Combobox
            size="sm"
            placeholder="All assignees"
            options={assigneeOpts}
            value={optById(assigneeOpts, filters.AssignedTo)}
            onChange={setFilterValue("AssignedTo")}
            data-testid="filter-assignee"
          />
        </Box>
        <Box sx={{ width: 160 }}>
          <Combobox
            size="sm"
            placeholder="All tickets"
            options={breachedOpts}
            value={filters.BreachedOnly ? breachedOpts[0] : null}
            onChange={(opt) =>
              setFilters((prev) => ({ ...prev, BreachedOnly: opt?.value === "1" }))
            }
            data-testid="filter-sla"
          />
        </Box>
      </Box>
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>
    </Box>
  );
};

export default Tickets;
