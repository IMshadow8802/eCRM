// src/pages/Sales/Leads.jsx
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";

import { Combobox } from "../../components/ui";
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
  // Combobox hands back the selected option (or null when cleared).
  const setFilterValue = (key) => (opt) =>
    setFilters((prev) => ({ ...prev, [key]: opt?.value ?? "" }));

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

  // Filter option lists ({value,label}) for the Combobox filters.
  const stageOpts = useMemo(() => stages.map((s) => ({ value: s.Id, label: s.Name })), [stages]);
  const sourceOpts = useMemo(() => sources.map((s) => ({ value: s.Id, label: s.Value })), [sources]);
  const ownerOpts = useMemo(
    () => users.map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })),
    [users]
  );
  const optById = (opts, v) => opts.find((o) => o.value === v) ?? null;

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
      <Box sx={{ display: "flex", gap: 1, mt: 1, mb: 0.5, flexWrap: "wrap" }}>
        <Box sx={{ width: 170 }}>
          <Combobox
            size="sm"
            placeholder="All stages"
            options={stageOpts}
            value={optById(stageOpts, filters.StageId)}
            onChange={setFilterValue("StageId")}
            data-testid="filter-stage"
          />
        </Box>
        <Box sx={{ width: 180 }}>
          <Combobox
            size="sm"
            placeholder="All owners"
            options={ownerOpts}
            value={optById(ownerOpts, filters.OwnerId)}
            onChange={setFilterValue("OwnerId")}
            data-testid="filter-owner"
          />
        </Box>
        <Box sx={{ width: 180 }}>
          <Combobox
            size="sm"
            placeholder="All sources"
            options={sourceOpts}
            value={optById(sourceOpts, filters.SourceId)}
            onChange={setFilterValue("SourceId")}
            data-testid="filter-source"
          />
        </Box>
      </Box>
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>
    </Box>
  );
};

export default Leads;
