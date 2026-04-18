import React, { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import dayjs from "dayjs";

import PageHeader from "../../components/PageHeader";
import AppDatePicker from "../../components/Design/AppDatePicker";
import useServerTable from "../../hooks/useServerTable";

const UserFollowups = () => {
  const [dateFilters, setDateFilters] = useState({
    StartDate: dayjs().startOf("month").format("YYYY-MM-DD"),
    EndDate: dayjs().format("YYYY-MM-DD"),
  });

  const columns = useMemo(
    () => [
      { accessorKey: "UserName", header: "User Name", size: 200, enableSorting: true },
      { accessorKey: "BranchName", header: "Branch Name", size: 200, enableSorting: true },
      { accessorKey: "TodayFollowups", header: "Today's Followups", size: 150, enableSorting: true },
    ],
    []
  );

  const { table } = useServerTable({
    columns,
    queryKey: ["reports-followups-userwise", dateFilters],
    endpoint: "/api/reports/getFollowupsUserWise",
    dataKey: "followups",
    extraParams: {
      StartDate: dateFilters.StartDate,
      EndDate: dateFilters.EndDate,
    },
    initialPageSize: 25,
    getRowId: (row) => row.UserName,
    enableRowActions: false,
    muiTableBodyRowProps: { sx: { height: "40px" } },
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
  });

  const dateFilterActions = (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
      <Box sx={{ width: 170 }}>
        <AppDatePicker
          label="Start Date"
          value={dateFilters.StartDate}
          onChange={(e) =>
            setDateFilters((prev) => ({ ...prev, StartDate: e.target.value }))
          }
        />
      </Box>
      <Box sx={{ width: 170 }}>
        <AppDatePicker
          label="End Date"
          value={dateFilters.EndDate}
          onChange={(e) =>
            setDateFilters((prev) => ({ ...prev, EndDate: e.target.value }))
          }
        />
      </Box>
    </Box>
  );

  return (
    <Box display="flex" flexDirection="column" flexGrow={1}>
      <PageHeader title="FOLLOWUPS USER-WISE REPORT" actions={dateFilterActions} />
      <Helmet>
        <title>PRD Infotech | Followups User-wise Report</title>
      </Helmet>
      <MaterialReactTable table={table} />
    </Box>
  );
};

export default UserFollowups;
