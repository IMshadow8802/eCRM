// src/pages/Sales/Leads.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box, TextField } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";

import PageHeader from "../../components/ui/PageHeader";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUsers } from "../../hooks";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { findUserById, getUserName } from "../../utils/userShape";

const formatMoney = (value) =>
  value || value === 0
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";

const formatDate = (value) => (value ? dayjs(value).format("DD-MMM-YYYY") : "—");

const Leads = () => {
  const navigate = useNavigate();

  // Filter state forwarded verbatim as StageId/OwnerId/SourceId — sp_FetchLeads
  // treats each as an optional exact-match filter (null = no filter).
  const [filters, setFilters] = useState({ StageId: "", OwnerId: "", SourceId: "" });
  const setFilter = (key) => (e) =>
    setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const users = usersData?.users || [];

  // sp_FetchLeads returns raw SourceId/StageId (no name join), so the
  // filters/columns need their own display source: lookups (Kind=lead_source)
  // for Source, and fetchPipelines' stages recordset for Stage.
  const { data: sourcesData } = useApiQuery({
    queryKey: ["lead-sources"],
    endpoint: SALES_ENDPOINTS.config.fetchLookups,
    params: { Kind: "lead_source" },
  });
  const sources = sourcesData?.lookups || [];

  const { data: pipelinesData } = useApiQuery({
    queryKey: ["sales-pipelines", "lead"],
    endpoint: SALES_ENDPOINTS.config.fetchPipelines,
    params: { Entity: "lead" },
  });
  const stages = pipelinesData?.stages || [];
  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.Id, s.Name])),
    [stages]
  );

  const columns = useMemo(
    () => [
      { accessorKey: "Name", header: "Name", enableSorting: true },
      { accessorKey: "MobileNo", header: "Mobile", enableSorting: false },
      { accessorKey: "Email", header: "Email", enableSorting: false },
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
        accessorKey: "OwnerId",
        header: "Owner",
        enableSorting: false,
        Cell: ({ cell }) => {
          const user = findUserById(users, cell.getValue());
          return user ? getUserName(user) || "—" : "—";
        },
      },
      {
        accessorKey: "EstValue",
        header: "Est. Value",
        enableSorting: true,
        Cell: ({ cell }) => formatMoney(cell.getValue()),
      },
      {
        accessorKey: "NextFollowupDate",
        header: "Next Follow-up",
        enableSorting: true,
        Cell: ({ cell }) => formatDate(cell.getValue()),
      },
    ],
    [users, stageById]
  );

  const extraParams = useMemo(
    () => ({
      StageId: filters.StageId === "" ? null : Number(filters.StageId),
      OwnerId: filters.OwnerId === "" ? null : Number(filters.OwnerId),
      SourceId: filters.SourceId === "" ? null : Number(filters.SourceId),
    }),
    [filters]
  );

  const { table } = useServerTable({
    columns,
    queryKey: "leads",
    endpoint: SALES_ENDPOINTS.leads.fetchLeads,
    dataKey: "leads",
    extraParams,
    initialPageSize: 25,
    getRowId: (row) => row.Id,
    enableRowActions: false,
    muiTableBodyRowProps: ({ row }) => ({
      hover: true,
      sx: { cursor: "pointer" },
      onClick: () => navigate(`/sales/leads/${row.original.Id}`),
    }),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Leads"
        subtitle="Prospective customers moving through your pipeline."
      />
      <Helmet>
        <title>PRD Infotech | Leads</title>
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
          label="Owner"
          size="small"
          value={filters.OwnerId}
          onChange={setFilter("OwnerId")}
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 180 }}
        >
          <option value="">All Owners</option>
          {users.map((user) => (
            <option key={user.Id} value={user.Id}>
              {getUserName(user) || user.Username}
            </option>
          ))}
        </TextField>
        <TextField
          select
          label="Source"
          size="small"
          value={filters.SourceId}
          onChange={setFilter("SourceId")}
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 180 }}
        >
          <option value="">All Sources</option>
          {sources.map((source) => (
            <option key={source.Id} value={source.Id}>
              {source.Value}
            </option>
          ))}
        </TextField>
      </Box>
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>
    </Box>
  );
};

export default Leads;
