// src/pages/Master/Teams.jsx
import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Box, IconButton, Tooltip, Chip } from "@mui/material";
import { EditRounded, DeleteRounded } from "@mui/icons-material";
import { MaterialReactTable } from "material-react-table";
import { useSnackbar } from "notistack";
import dayjs from "dayjs";

// Import components
import PageHeader from "../../components/PageHeader";
import TeamForm from "./components/TeamForm";
import ActionButton from "../../components/Design/ActionButton";
import ConfirmationDialog from "../../components/ConfirmationDialog";

// Import hooks
import useApi from "../../hooks/useApi";
import useServerTable from "../../hooks/useServerTable";
import { useUsers, useConfirmation } from "../../hooks";
import { useQueryClient } from "@tanstack/react-query";

const Teams = () => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const confirmation = useConfirmation();
  const queryClient = useQueryClient();

  // Users dropdown — bulk fetch for form select.
  const { data: usersData } = useUsers({ PageSize: 1000 });
  const users = usersData?.users || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);

  // Format date
  const formatDate = (date) => {
    if (!date) return "";
    try {
      return dayjs(date).format("DD-MM-YYYY");
    } catch (error) {
      console.error("Error formatting date:", error);
      return "";
    }
  };

  // Table columns definition
  const columns = useMemo(
    () => [
      {
        accessorKey: "Name",
        header: "Team Name",
      },
      {
        accessorKey: "Description",
        header: "Description",
      },
      {
        accessorKey: "LeadName",
        header: "Team Lead",
      },
      {
        accessorKey: "Members",
        header: "Members",
        Cell: ({ row }) => {
          const members = row.original.Members || [];
          const memberCount = members.length;
          
          return (
            <Chip
              label={`${memberCount} member${memberCount > 1 ? 's' : ''}`}
              size="small"
              variant="outlined"
              color="primary"
              sx={{ margin: 0, height: '24px' }}
            />
          );
        },
      },
      {
        accessorKey: "Color",
        header: "Color",
        Cell: ({ cell }) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box
              sx={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                backgroundColor: cell.getValue() || "#gray",
                border: "1px solid #ddd",
              }}
            />
            <span>{cell.getValue()}</span>
          </Box>
        ),
      },
      {
        accessorKey: "IsActive",
        header: "Status",
        Cell: ({ cell }) => (
          <Chip
            label={cell.getValue() ? "Active" : "Inactive"}
            color={cell.getValue() ? "success" : "error"}
            size="small"
            variant="outlined"
            sx={{ margin: 0, height: '24px' }}
          />
        ),
      },
    ],
    []
  );

  // Handle deleting a team
  const handleDeleteRow = useCallback(
    (row) => {
      confirmation.confirmDelete({
        title: "Delete Team",
        message: `Are you sure you want to delete "${row.original.Name}"? This action cannot be undone and will remove all team data including member assignments.`,
        confirmText: "Delete Team",
        onConfirm: async () => {
          try {
            const response = await apiClient.post("/api/teams/deleteTeam", {
              Id: row.original.Id,
            });

            if (response.data.success) {
              enqueueSnackbar("Team deleted successfully!", {
                variant: "success",
              });
              // Invalidate related caches
              queryClient.invalidateQueries({ queryKey: ["teams"] });
              queryClient.invalidateQueries({ queryKey: ["users"] });
              queryClient.invalidateQueries({ queryKey: ["tasks"] });
              queryClient.invalidateQueries({ queryKey: ["projects"] });
            } else {
              enqueueSnackbar(
                response.data.message || "Failed to delete team!",
                {
                  variant: "error",
                }
              );
            }
          } catch (error) {
            console.error("Error deleting team:", error);
            enqueueSnackbar("Failed to delete team!", {
              variant: "error",
            });
            throw error; // Re-throw to keep dialog open on error
          }
        },
      });
    },
    [apiClient, enqueueSnackbar, confirmation]
  );

  // Handle edit
  const handleEdit = (row) => {
    setEditingTeam(row.original);
    setIsModalOpen(true);
  };

  // Server-paginated + server-searched table
  const { table, error: teamsError } = useServerTable({
    columns,
    queryKey: "teams",
    endpoint: "/api/teams/fetchTeams",
    dataKey: "teams",
    enableRowActions: true,
    enableExpanding: true,
    getRowId: (row) => row.Id,
    renderDetailPanel: ({ row }) => {
      const members = row.original.Members || [];
      
      if (members.length === 0) {
        return (
          <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
            No members in this team
          </Box>
        );
      }

      return (
        <Box sx={{ p: 2 }}>
          <Box sx={{ mb: 1, fontWeight: 'bold', fontSize: '0.9rem' }}>
            Team Members ({members.length}):
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {members.map((member, index) => (
              <Chip
                key={index}
                label={`${member.FullName} - ${member.JobTitle}`}
                size="small"
                variant="outlined"
                color="primary"
                sx={{ fontSize: '0.75rem' }}
              />
            ))}
          </Box>
        </Box>
      );
    },
    renderRowActions: ({ row, table }) => (
      <Box sx={{ display: "flex", gap: "0.5rem" }}>
        <Tooltip title="Edit">
          <IconButton
            onClick={() => handleEdit(row)}
            size="small"
            sx={{
              color: '#059669',
              '&:hover': {
                backgroundColor: '#f9fafb'
              },
              padding: '4px'
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
              color: '#dc2626',
              '&:hover': {
                backgroundColor: '#f9fafb'
              },
              padding: '4px'
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
            setEditingTeam(null);
            setIsModalOpen(true);
          }}
          label="Create Team"
          size="sm"
        />
      </Box>
    ),
  });

  useEffect(() => {
    if (teamsError) {
      console.error("Failed to fetch teams:", teamsError);
      enqueueSnackbar("Failed to load teams", { variant: "error" });
    }
  }, [teamsError, enqueueSnackbar]);

  // Close modal handler
  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTeam(null);
  };

  return (
    <Box display="flex" flexDirection="column" flexGrow={1}>
      <PageHeader
        title="Teams"
        subtitle="Group people into teams for project and task ownership."
      />
      <Helmet>
        <title>PRD Infotech | Teams</title>
      </Helmet>

      <Box sx={{ mt: 2, width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>

      {/* Team creation/edit modal */}
      <TeamForm
        open={isModalOpen}
        onClose={closeModal}
        editingTeam={editingTeam}
        users={users}
        onTeamSaved={() => {/* React Query will auto-invalidate */}}
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

export default Teams;
