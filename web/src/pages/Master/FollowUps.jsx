import React, { useState, useCallback, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Box, IconButton, Tooltip } from "@mui/material";
import { EditRounded, DeleteRounded } from "@mui/icons-material";
import { MaterialReactTable } from "material-react-table";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/PageHeader";
import FollowUpForm from "./components/FollowUpForm";
import ActionButton from "../../components/Design/ActionButton";
import ConfirmationDialog from "../../components/ConfirmationDialog";

import useApi from "../../hooks/useApi";
import { useApiQuery } from "../../hooks/useApiQuery";
import useServerTable from "../../hooks/useServerTable";
import { useConfirmation } from "../../hooks/useConfirmation";
import { useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

const FollowUps = () => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const confirmation = useConfirmation();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState(null);

  // Lead lookup for the LeadId column display — bulk fetch.
  const { data: leadsData } = useApiQuery({
    queryKey: ["leads-lookup"],
    endpoint: "/api/leads/fetchLeads",
    params: { Id: 0, PageNumber: 1, PageSize: 1000, SearchTerm: null },
  });
  const leads = leadsData?.leads || [];

  // Create lookup map for lead names
  const leadsMap = useMemo(() => {
    const map = {};
    leads.forEach((lead) => {
      map[lead.Id] = lead.CustomerName;
    });
    return map;
  }, [leads]);

  const columns = useMemo(
    () => [
      {
        accessorKey: "LeadId",
        header: "Leads",
        size: 150,
        enableSorting: true,
        Cell: ({ cell, row }) => {
          const leadId = cell.getValue();
          const leadName = leads.find((lead) => lead.Id === leadId)?.CustomerName;
          return leadName || `Lead Not Found (${leadId})` || "-";
        },
      },
      {
        accessorKey: "NextFollowupDate",
        header: "Next Followup Date",
        size: 150,
        enableSorting: true,
        Cell: ({ cell }) => {
          const date = cell.getValue();
          return date ? dayjs(date).format("DD-MM-YYYY") : "-";
        },
      },
      {
        accessorKey: "FollowupType",
        header: "Followup Type",
        size: 130,
        enableSorting: true,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return value || "-";
        },
      },
      {
        accessorKey: "Remarks",
        header: "Remarks",
        size: 250,
        enableSorting: true,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return (
            <div
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={value}
            >
              {value || "-"}
            </div>
          );
        },
      },
      {
        accessorKey: "Status",
        header: "Status",
        size: 120,
        enableSorting: true,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return value || "-";
        },
      },
    ],
    [leads]
  );

  const handleDeleteRow = useCallback(
    (row) => {
      confirmation.confirmDelete({
        title: "Delete Follow-Up",
        message: `Are you sure you want to delete this follow-up? This action cannot be undone.`,
        confirmText: "Delete Follow-Up",
        onConfirm: async () => {
          try {
            const response = await apiClient.post(
              "/api/followups/deleteFollowup",
              {
                Id: row.original.Id,
              }
            );

            if (response.data.success) {
              enqueueSnackbar("Follow-up deleted successfully!", {
                variant: "success",
              });
              queryClient.invalidateQueries({ queryKey: ["followups"] });
            } else {
              enqueueSnackbar(
                response.data.message || "Failed to delete follow-up!",
                { variant: "error" }
              );
            }
          } catch (error) {
            console.error("Error deleting follow-up:", error);
            enqueueSnackbar("Failed to delete follow-up!", {
              variant: "error",
            });
            throw error;
          }
        },
      });
    },
    [apiClient, enqueueSnackbar, confirmation, queryClient]
  );

  const handleEdit = (row) => {
    setEditingFollowUp(row.original);
    setIsModalOpen(true);
  };

  const { table, refetch } = useServerTable({
    columns,
    queryKey: "followups",
    endpoint: "/api/followups/fetchFollowups",
    dataKey: "followups",
    enableRowActions: true,
    initialPageSize: 25,
    getRowId: (row) => row.Id,
    displayColumnDefOptions: {
      "mrt-row-actions": {
        size: 80,
        grow: false,
        header: "Actions",
      },
    },
    muiTableProps: {
      sx: { tableLayout: "fixed" },
    },
    muiTableBodyRowProps: {
      sx: { height: "40px" },
    },
    muiTableContainerProps: {
      sx: { maxHeight: "500px" },
    },
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: "0.5rem" }}>
        <Tooltip title="Edit">
          <IconButton
            onClick={() => handleEdit(row)}
            size="small"
            sx={{
              color: "#059669",
              "&:hover": { backgroundColor: "#f9fafb" },
              padding: "4px",
            }}
          >
            <EditRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            onClick={() => handleDeleteRow(row)}
            size="small"
            sx={{
              color: "#dc2626",
              "&:hover": { backgroundColor: "#f9fafb" },
              padding: "4px",
            }}
          >
            <DeleteRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    ),
    renderTopToolbarCustomActions: ({ table }) => (
      <Box sx={{ display: "flex", gap: "1rem", p: "0.5rem" }}>
        <ActionButton
          actionType="create"
          onClick={() => {
            setEditingFollowUp(null);
            setIsModalOpen(true);
          }}
          label="Create Follow-Up"
          size="sm"
        />
      </Box>
    ),
  });

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingFollowUp(null);
  };

  return (
    <Box display="flex" flexDirection="column" flexGrow={1}>
      <PageHeader
        title="Follow-ups"
        subtitle="Scheduled touchpoints with leads and prospects."
      />
      <Helmet>
        <title>PRD Infotech | Follow-Ups</title>
      </Helmet>

      <Box sx={{ mt: 2, width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>

      <FollowUpForm
        open={isModalOpen}
        onClose={closeModal}
        editingFollowUp={editingFollowUp}
        onFollowUpSaved={() => refetch()}
      />

      <ConfirmationDialog
        open={confirmation.isOpen}
        onClose={confirmation.hideConfirmation}
        onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title}
        message={confirmation.confirmationState.message}
        confirmText={confirmation.confirmationState.confirmText}
        cancelText={confirmation.confirmationState.cancelText}
        type={confirmation.confirmationState.type}
        icon={confirmation.confirmationState.icon}
        isLoading={confirmation.isLoading}
        maxWidth={confirmation.confirmationState.maxWidth}
      />
    </Box>
  );
};

export default FollowUps;
