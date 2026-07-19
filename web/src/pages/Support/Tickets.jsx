// src/pages/Support/Tickets.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, IconButton } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { Plus, Eye } from "lucide-react";

import { Combobox, Button, Chip } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import TicketCreateModal from "./TicketCreateModal";
import TicketDetailModal from "./TicketDetailModal";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUsers } from "../../hooks";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { findUserById, getUserName } from "../../utils/userShape";

const Tickets = () => {
  const [createOpen, setCreateOpen] = useState(false);
  // Row click opens the detail in a modal so the table position is preserved.
  const [detailTicketId, setDetailTicketId] = useState(null);

  // Filters forwarded verbatim as exact-match params (null = no filter).
  const [filters, setFilters] = useState({
    StageId: "",
    Priority: "",
    CategoryId: "",
    AssignedTo: "",
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
  // Keep the whole stage row: the column pill colors by StageType.
  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.Id, s])),
    [stages]
  );

  // Lifecycle color language: open = blue, won (resolved/closed) = green,
  // lost (rejected) = red — same meaning everywhere in the app.
  const stageTone = { open: "info", won: "success", lost: "error" };

  // Filter option lists ({value,label}) for the Combobox filters.
  const stageOpts = useMemo(() => stages.map((s) => ({ value: s.Id, label: s.Name })), [stages]);
  const priorityOpts = useMemo(() => priorities.map((p) => ({ value: p.Id, label: p.Value })), [priorities]);
  const categoryOpts = useMemo(() => categories.map((c) => ({ value: c.Id, label: c.Value })), [categories]);
  const assigneeOpts = useMemo(
    () => users.map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })),
    [users]
  );
  const optById = (opts, v) => opts.find((o) => o.value === v) ?? null;

  const columns = useMemo(
    () => [
      {
        // First column: explicit open affordance. The row is clickable too,
        // but a visible eye says so — users shouldn't discover it by accident.
        id: "open",
        header: "",
        size: 48,
        enableSorting: false,
        Cell: ({ row }) => (
          <IconButton
            size="small"
            aria-label={`Open ${row.original.TicketNo}`}
            data-testid={`ticket-open-${row.original.Id}`}
            onClick={(e) => {
              e.stopPropagation();
              setDetailTicketId(row.original.Id);
            }}
          >
            <Eye size={15} />
          </IconButton>
        ),
      },
      { accessorKey: "TicketNo", header: "Ticket #", enableSorting: true },
      { accessorKey: "CustomerName", header: "Customer", enableSorting: true },
      { accessorKey: "Contact", header: "Contact", enableSorting: false },
      {
        accessorKey: "Priority",
        header: "Priority",
        enableSorting: false,
        Cell: ({ cell }) => {
          const name = priorityById.get(cell.getValue());
          return name ? <Chip label={name} tone="warning" size="sm" variant="tonal" /> : "—";
        },
      },
      {
        accessorKey: "CategoryId",
        header: "Category",
        enableSorting: false,
        Cell: ({ cell }) => {
          const name = categoryById.get(cell.getValue());
          return name ? <Chip label={name} tone="primary" size="sm" variant="tonal" /> : "—";
        },
      },
      {
        accessorKey: "StageId",
        header: "Status",
        enableSorting: false,
        Cell: ({ cell }) => {
          const stage = stageById.get(cell.getValue());
          if (!stage) return "—";
          return (
            <Chip
              label={stage.Name}
              tone={stageTone[stage.StageType] ?? "default"}
              size="sm"
              variant="tonal"
            />
          );
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
    ],
    [users, priorityById, categoryById, stageById]
  );

  const extraParams = useMemo(
    () => ({
      StageId: filters.StageId === "" ? null : Number(filters.StageId),
      Priority: filters.Priority === "" ? null : Number(filters.Priority),
      CategoryId: filters.CategoryId === "" ? null : Number(filters.CategoryId),
      AssignedTo: filters.AssignedTo === "" ? null : Number(filters.AssignedTo),
    }),
    [filters]
  );

  const { table, refetch } = useServerTable({
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
      onClick: () => setDetailTicketId(row.original.Id),
    }),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Tickets"
        subtitle="Support requests moving through resolution."
        actions={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setCreateOpen(true)}
              data-testid="new-ticket-btn"
            >
              New Ticket
            </Button>
            <HelpGuide guide={HELP_GUIDES.tickets} />
          </div>
        }
      />
      <TicketCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(res) => res?.Id && setDetailTicketId(res.Id)}
      />
      <TicketDetailModal
        ticketId={detailTicketId}
        open={Boolean(detailTicketId)}
        onClose={() => {
          setDetailTicketId(null);
          refetch(); // resolve/close in the modal must reflect in the table
        }}
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
      </Box>
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>
    </Box>
  );
};

export default Tickets;
