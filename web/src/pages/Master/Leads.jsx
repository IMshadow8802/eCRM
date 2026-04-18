// src/pages/Master/Leads.jsx
import React, { useState, useCallback, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Box, IconButton, Tooltip, Chip } from "@mui/material";
import { EditRounded, DeleteRounded } from "@mui/icons-material";
import { MaterialReactTable } from "material-react-table";
import { useSnackbar } from "notistack";
import dayjs from "dayjs";

// Import components
import PageHeader from "../../components/PageHeader";
import LeadsForm from "./components/LeadsForm";
import ActionButton from "../../components/Design/ActionButton";
import ConfirmationDialog from "../../components/ConfirmationDialog";

// Import hooks
import useApi from "../../hooks/useApi";
import { useApiQuery } from "../../hooks/useApiQuery";
import useServerTable from "../../hooks/useServerTable";
import { useConfirmation } from "../../hooks";
import { useQueryClient } from "@tanstack/react-query";
import { findUserById, getUserName } from "../../utils/userShape";

const Leads = () => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const confirmation = useConfirmation();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState(null);

  // Users lookup for the AssignTo column display — bulk fetch for form dropdown.
  const { data: usersData } = useApiQuery({
    queryKey: ["users-all"],
    endpoint: "/api/users/fetchUsers",
    params: { Id: 0, PageNumber: 1, PageSize: 1000, SearchTerm: null },
  });
  const users = usersData?.users || [];

  // Status color mapping
  const getStatusColor = (status) => {
    const statusMap = {
      "New Lead": "info",
      "Contacted": "primary",
      "Qualified": "success",
      "Proposal Sent": "warning",
      "Negotiation": "secondary",
      "Won": "success",
      "Lost": "error",
      "On Hold": "default",
    };
    return statusMap[status] || "default";
  };

  // Table columns definition
  const columns = useMemo(
    () => [
      {
        accessorKey: "LeadDate",
        header: "Lead Date",
        enableSorting: true,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return value ? dayjs(value).format("DD-MMM-YYYY") : "";
        },
      },
      {
        accessorKey: "CustomerName",
        header: "Customer Name",
        enableSorting: true,
      },
      {
        accessorKey: "MobileNo",
        header: "Mobile",
        enableSorting: false,
      },
      {
        accessorKey: "Email",
        header: "Email",
        enableSorting: false,
      },
      {
        accessorKey: "LeadSource",
        header: "Source",
        enableSorting: true,
      },
      {
        accessorKey: "ProductInfo",
        header: "Product",
        enableSorting: false,
        Cell: ({ row }) => {
          const { ProductBrand, ProductModel, ProductCategory } = row.original;
          const parts = [ProductBrand, ProductModel, ProductCategory].filter(
            Boolean
          );
          return parts.join(" - ") || "—";
        },
      },
      {
        accessorKey: "Budget",
        header: "Budget",
        enableSorting: true,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return value
            ? new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(value)
            : "—";
        },
      },
      {
        accessorKey: "LeadStatus",
        header: "Status",
        enableSorting: true,
        Cell: ({ cell }) => {
          const status = cell.getValue();
          return (
            <Chip
              label={status}
              color={getStatusColor(status)}
              size="small"
              sx={{ fontWeight: 500 }}
            />
          );
        },
      },
      {
        accessorKey: "AssignTo",
        header: "Assigned To",
        enableSorting: true,
        Cell: ({ cell }) => {
          const userId = cell.getValue();
          if (!userId) return "—";
          const user = findUserById(users, userId);
          return user ? getUserName(user) || "—" : "—";
        },
      },
      {
        accessorKey: "FollowupDate",
        header: "Follow-up Date",
        enableSorting: true,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return value ? dayjs(value).format("DD-MMM-YYYY") : "—";
        },
      },
    ],
    [users]
  );

  // Handle deleting a lead
  const handleDeleteRow = useCallback(
    (row) => {
      confirmation.confirmDelete({
        title: "Delete Lead",
        message: `Are you sure you want to delete lead for "${row.original.CustomerName}"? This action cannot be undone.`,
        confirmText: "Delete Lead",
        onConfirm: async () => {
          try {
            const response = await apiClient.post("/api/leads/deleteLeads", {
              Id: row.original.Id,
            });

            if (response.data.success) {
              enqueueSnackbar("Lead deleted successfully!", {
                variant: "success",
              });
              // Invalidate cache to refresh data
              queryClient.invalidateQueries({ queryKey: ["leads"] });
            } else {
              enqueueSnackbar(
                response.data.message || "Failed to delete lead!",
                {
                  variant: "error",
                }
              );
            }
          } catch (error) {
            console.error("Error deleting lead:", error);
            enqueueSnackbar("Failed to delete lead!", {
              variant: "error",
            });
            throw error; // Re-throw to keep dialog open on error
          }
        },
      });
    },
    [apiClient, enqueueSnackbar, confirmation, queryClient]
  );

  // Handle edit
  const handleEdit = (row) => {
    setEditingLead(row.original);
    setIsModalOpen(true);
  };

  // Server-paginated + server-searched table
  const { table, error: leadsError, refetch } = useServerTable({
    columns,
    queryKey: "leads",
    endpoint: "/api/leads/fetchLeads",
    dataKey: "leads",
    enableRowActions: true,
    initialPageSize: 25,
    getRowId: (row) => row.Id,
    displayColumnDefOptions: {
      "mrt-row-actions": { grow: false, header: "Actions" },
    },
    muiTableBodyRowProps: { sx: { height: "40px" } },
    muiTableContainerProps: { sx: { maxHeight: "500px" } },
    renderRowActions: ({ row }) => (
      <Box sx={{ display: "flex", gap: "0.5rem" }}>
        <Tooltip title="Edit">
          <IconButton
            onClick={() => handleEdit(row)}
            size="small"
            sx={{
              color: "#059669",
              "&:hover": {
                backgroundColor: "#f9fafb",
              },
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
              "&:hover": {
                backgroundColor: "#f9fafb",
              },
              padding: "4px",
            }}
          >
            <DeleteRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    ),
    renderTopToolbarCustomActions: () => (
      <Box sx={{ display: "flex", gap: "1rem", p: "0.5rem" }}>
        <ActionButton
          actionType="create"
          onClick={() => {
            setEditingLead(null);
            setIsModalOpen(true);
          }}
          label="Create Lead"
          size="sm"
        />
      </Box>
    ),
  });

  // Close modal handler
  const closeModal = () => {
    setIsModalOpen(false);
    setEditingLead(null);
  };

  return (
    <Box display="flex" flexDirection="column" flexGrow={1}>
      <PageHeader
        title="Leads"
        subtitle="Prospective customers moving through your pipeline."
      />
      <Helmet>
        <title>PRD Infotech | Leads</title>
      </Helmet>

      <Box sx={{ mt: 2, width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>

      {/* Lead creation/edit modal */}
      <LeadsForm
        open={isModalOpen}
        onClose={closeModal}
        editingLead={editingLead}
        onLeadSaved={() => {
          refetch(); // Refresh table data
        }}
      />

      {/* Confirmation Dialog */}
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

export default Leads;
