// src/pages/Sales/FollowUps.jsx
// Standalone work-queue of ALL follow-ups across leads. sp_FetchFollowUp with
// LeadId:0 returns every follow-up (paged); row-click opens the lead's detail.
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";

import { Combobox } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const formatDate = (value) => (value ? dayjs(value).format("DD-MMM-YYYY") : "—");

// sp_FetchFollowUp filters only via SearchTerm (LIKE on Status/Type/Remarks),
// so the status filter piggybacks on it. Options match the app's Pending/Done
// vocabulary (see helpGuides.followups).
const STATUS_OPTS = [
  { value: "Pending", label: "Pending" },
  { value: "Done", label: "Done" },
];

const FollowUps = () => {
  const navigate = useNavigate();

  // ponytail: SP has no StatusId param — the Status filter drives SearchTerm.
  // Upgrade path: add a real @Status filter to sp_FetchFollowUp + controller.
  const [status, setStatus] = useState("");

  // sp_FetchFollowUp returns LeadId but no lead name, so resolve names from a
  // bulk lead load (same pattern Leads.jsx uses for owners/stages).
  const { data: leadsData } = useApiQuery({
    queryKey: ["followup-leads"],
    endpoint: SALES_ENDPOINTS.leads.fetchLeads,
    params: { PageNumber: 1, PageSize: 1000 },
  });
  const leadNameById = useMemo(
    () => new Map((leadsData?.leads || []).map((l) => [l.Id, l.Name])),
    [leadsData]
  );

  const columns = useMemo(
    () => [
      {
        accessorKey: "LeadId",
        header: "Lead",
        enableSorting: false,
        Cell: ({ cell }) => {
          const id = cell.getValue();
          return leadNameById.get(id) || (id ? `Lead #${id}` : "—");
        },
      },
      {
        accessorKey: "NextFollowupDate",
        header: "Next Follow-up",
        enableSorting: true,
        Cell: ({ cell }) => formatDate(cell.getValue()),
      },
      {
        accessorKey: "FollowupType",
        header: "Type",
        enableSorting: false,
        Cell: ({ cell }) => cell.getValue() || "—",
      },
      {
        accessorKey: "Status",
        header: "Status",
        enableSorting: false,
        Cell: ({ cell }) => cell.getValue() || "Pending",
      },
      {
        accessorKey: "Remarks",
        header: "Remarks",
        enableSorting: false,
        Cell: ({ cell }) => cell.getValue() || "—",
      },
    ],
    [leadNameById]
  );

  const extraParams = useMemo(
    () => (status ? { LeadId: 0, SearchTerm: status } : { LeadId: 0 }),
    [status]
  );

  const { table } = useServerTable({
    columns,
    queryKey: "followups",
    endpoint: SALES_ENDPOINTS.followups.fetchFollowups,
    dataKey: "followups",
    extraParams,
    initialPageSize: 25,
    getRowId: (row) => row.Id,
    enableRowActions: false,
    muiTableBodyRowProps: ({ row }) => ({
      hover: true,
      sx: { cursor: "pointer" },
      onClick: () => navigate(`/sales/leads/${row.original.LeadId}`),
    }),
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Follow-ups"
        subtitle="Every scheduled follow-up across your leads, in one work queue."
        actions={<HelpGuide guide={HELP_GUIDES.followups} />}
      />
      <Helmet>
        <title>PRD Infotech | Follow-ups</title>
      </Helmet>
      <Box sx={{ display: "flex", gap: 1, mt: 1, mb: 0.5, flexWrap: "wrap" }}>
        <Box sx={{ width: 180 }}>
          <Combobox
            size="sm"
            placeholder="All statuses"
            options={STATUS_OPTS}
            value={STATUS_OPTS.find((o) => o.value === status) ?? null}
            onChange={(opt) => setStatus(opt?.value ?? "")}
            data-testid="filter-status"
          />
        </Box>
      </Box>
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>
    </Box>
  );
};

export default FollowUps;
