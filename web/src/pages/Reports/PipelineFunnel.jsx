import React, { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import {
  Box,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import PageHeader from "../../components/PageHeader";
import Funnel from "../../components/Charts/Funnel";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const PipelineFunnel = () => {
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["reports-pipeline-funnel"],
    endpoint: SALES_ENDPOINTS.reports.pipelineFunnel,
    params: {},
    retry: false,
  });

  const rows = data?.funnel ?? [];
  const chartData = useMemo(
    () => rows.map((r) => ({ name: r.StageName, value: r.LeadCount })),
    [rows]
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="PIPELINE FUNNEL REPORT"
        subtitle="Lead count per pipeline stage."
      />
      <Helmet>
        <title>PRD Infotech | Pipeline Funnel Report</title>
      </Helmet>
      <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 2 }}>
        {isLoading ? (
          <Box
            sx={{ display: "flex", justifyContent: "center", py: 4 }}
            data-testid="pipeline-funnel-loading"
          >
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Typography color="error" data-testid="pipeline-funnel-error">
            Failed to load pipeline funnel.
          </Typography>
        ) : rows.length === 0 ? (
          <Typography
            data-testid="pipeline-funnel-empty"
            sx={{ color: "text.secondary", py: 4, textAlign: "center" }}
          >
            No pipeline data yet.
          </Typography>
        ) : (
          <>
            <Funnel data={chartData} height={280} />
            <TableContainer
              component={Paper}
              variant="outlined"
              data-testid="pipeline-funnel-table"
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Stage</TableCell>
                    <TableCell align="right">Leads</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.StageId}>
                      <TableCell>{r.StageName}</TableCell>
                      <TableCell align="right">{r.LeadCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Box>
    </Box>
  );
};

export default PipelineFunnel;
