// src/pages/Master/Projects.jsx
import { EditRounded, DeleteRounded } from "@mui/icons-material";
import {
  Box,
  Chip,
  IconButton,
  LinearProgress,
  Tooltip,
  useTheme,
} from "@mui/material";
import dayjs from "dayjs";
import { MaterialReactTable } from "material-react-table";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";

// Import components
import ActionButton from "../../components/Design/ActionButton";
import PageHeader from "../../components/PageHeader";
import ProjectForm from "./components/ProjectForm";
import ConfirmationDialog from "../../components/ConfirmationDialog";

// Import hooks
import { useTeams, useUsers, useConfirmation } from "../../hooks";
import useApi from "../../hooks/useApi";
import useServerTable from "../../hooks/useServerTable";
import { useQueryClient } from "@tanstack/react-query";

const Projects = () => {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const confirmation = useConfirmation();
  const queryClient = useQueryClient();

  // Dropdown feeders — bulk fetch for the form's select boxes.
  const { data: teamsData } = useTeams({ PageSize: 1000 });
  const { data: usersData } = useUsers({ PageSize: 1000 });
  const teams = teamsData?.teams || [];
  const users = usersData?.users || [];

  // State management
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  // Status options
  const statusOptions = [
    { value: "active", label: "Active", color: "success" },
    { value: "completed", label: "Completed", color: "primary" },
    { value: "on_hold", label: "On Hold", color: "warning" },
    { value: "cancelled", label: "Cancelled", color: "error" },
  ];

  // Priority options
  const priorityOptions = [
    { value: "low", label: "Low", color: "success" },
    { value: "medium", label: "Medium", color: "warning" },
    { value: "high", label: "High", color: "error" },
  ];

  // Validation functions
  const validateRequired = (value) => (value ? "" : "This field is required");

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
    }).format(amount || 0);
  };

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

  // Get status chip color
  const getStatusColor = (status) => {
    const statusOption = statusOptions.find(
      (s) => s.value === (status || '').toLowerCase()
    );
    return statusOption?.color || "default";
  };

  // Get priority chip color
  const getPriorityColor = (priority) => {
    const priorityOption = priorityOptions.find(
      (p) => p.value === (priority || '').toLowerCase()
    );
    return priorityOption?.color || "default";
  };

  // Table columns definition
  const columns = useMemo(
    () => [
      {
        accessorKey: "Name",
        header: "Project Name",
      },
      {
        accessorKey: "ManagerName",
        header: "Manager",
      },
      {
        accessorKey: "Status",
        header: "Status",
        Cell: ({ cell }) => (
          <Chip
            label={cell.getValue()}
            color={getStatusColor(cell.getValue())}
            size="small"
            variant="outlined"
          />
        ),
      },
      {
        accessorKey: "Priority",
        header: "Priority",
        Cell: ({ cell }) => (
          <Chip
            label={cell.getValue()}
            color={getPriorityColor(cell.getValue())}
            size="small"
          />
        ),
      },
      {
        accessorKey: "Progress",
        header: "Progress",
        Cell: ({ cell }) => (
          <Box sx={{ width: "100%" }}>
            <Box
              sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}
            >
              <span>{cell.getValue() || 0}%</span>
            </Box>
            <LinearProgress
              variant="determinate"
              value={cell.getValue() || 0}
              sx={{
                height: 6,
                borderRadius: 3,
                backgroundColor: "grey.200",
              }}
            />
          </Box>
        ),
      },
      {
        accessorKey: "Budget",
        header: "Budget",
        Cell: ({ cell }) => formatCurrency(cell.getValue()),
      },
      {
        accessorKey: "StartDate",
        header: "Start Date",
        Cell: ({ cell }) => formatDate(cell.getValue()),
      },
      {
        accessorKey: "EndDate",
        header: "End Date",
        Cell: ({ cell }) => formatDate(cell.getValue()),
      },
    ],
    []
  );

  // Handle deleting a project
  const handleDeleteRow = useCallback(
    (row) => {
      confirmation.confirmDelete({
        title: "Delete Project",
        message: `Are you sure you want to delete "${row.original.Name}"? This action cannot be undone and will remove all project data.`,
        confirmText: "Delete Project",
        onConfirm: async () => {
          try {
            const response = await apiClient.post("/api/projects/deleteProject", {
              Id: row.original.Id,
            });

            if (response.data.success) {
              enqueueSnackbar("Project deleted successfully!", {
                variant: "success",
              });
              // Invalidate related caches
              queryClient.invalidateQueries({ queryKey: ["projects"] });
              queryClient.invalidateQueries({ queryKey: ["tasks"] });
              queryClient.invalidateQueries({ queryKey: ["teams"] });
              queryClient.invalidateQueries({ queryKey: ["users"] });
            } else {
              enqueueSnackbar(
                response.data.message || "Failed to delete project!",
                {
                  variant: "error",
                }
              );
            }
          } catch (error) {
            console.error("Error deleting project:", error);
            enqueueSnackbar("Failed to delete project!", {
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
    setEditingProject(row.original);
    setIsModalOpen(true);
  };

  // Server-paginated + server-searched table
  const { table, error: projectsError } = useServerTable({
    columns,
    queryKey: "projects",
    endpoint: "/api/projects/fetchProjects",
    dataKey: "projects",
    enableRowActions: true,
    getRowId: (row) => row.Id,
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
            setEditingProject(null);
            setIsModalOpen(true);
          }}
          label="Create Project"
          size="sm"
        />
      </Box>
    ),
  });

  useEffect(() => {
    if (projectsError) {
      console.error("Failed to fetch projects:", projectsError);
      enqueueSnackbar("Failed to load projects", { variant: "error" });
    }
  }, [projectsError, enqueueSnackbar]);

  // Close modal handler
  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProject(null);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1
      }}>
      <PageHeader
        title="Projects"
        subtitle="Track delivery, budget, and team assignments per project."
      />
      <Helmet>
        <title>PRD Infotech | Projects</title>
      </Helmet>
      <Box sx={{ mt: 2, width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>
      {/* Project creation/edit modal */}
      <ProjectForm
        open={isModalOpen}
        onClose={closeModal}
        editingProject={editingProject}
        teams={teams}
        users={users}
        onProjectSaved={() => {
          /* React Query will auto-invalidate */
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

export default Projects;
