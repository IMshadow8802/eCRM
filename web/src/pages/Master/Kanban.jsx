// src/pages/Master/Kanban.jsx
import React, { useState, useCallback, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import {
  Box,
  IconButton,
  Tooltip,
  useTheme,
  ThemeProvider,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import { EditRounded, DeleteRounded } from "@mui/icons-material";
import { MaterialReactTable } from "material-react-table";
import { useSnackbar } from "notistack";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import PageHeader from "../../components/PageHeader";
import ActionButton from "../../components/Design/ActionButton";
import KanbanForm from "./components/KanbanForm";
import ConfirmationDialog from "../../components/ConfirmationDialog";

import useApi from "../../hooks/useApi";
import { useApiQuery } from "../../hooks/useApiQuery";
import useServerTable from "../../hooks/useServerTable";
import { useConfirmation } from "../../hooks";

const Kanban = () => {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const confirmation = useConfirmation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [selectedProjectId, setSelectedProjectId] = useState(null);

  // Bulk-fetch the project dropdown (same unified API shape, big PageSize).
  const { data: projectsData } = useApiQuery({
    queryKey: ["projects-all"],
    endpoint: "/api/projects/fetchProjects",
    params: { Id: 0, PageNumber: 1, PageSize: 1000, SearchTerm: null },
  });
  const projects = projectsData?.projects || [];

  React.useEffect(() => {
    if (selectedProjectId) return;
    const firstWithId = projects.find((p) => p?.Id != null);
    if (firstWithId) setSelectedProjectId(firstWithId.Id);
  }, [projects, selectedProjectId]);

  // Create/Update mutation
  const saveColumnMutation = useMutation({
    mutationFn: async (columnData) => {
      const response = await apiClient.post("/api/kanban/saveKanbanColumn", columnData);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["kanbanColumns"] });
      enqueueSnackbar(
        data.responseCode === 201 
          ? "Kanban column created successfully!" 
          : "Kanban column updated successfully!",
        { variant: "success" }
      );
      setIsModalOpen(false);
      setEditingColumn(null);
    },
    onError: (error) => {
      console.error("Error saving kanban column:", error);
      enqueueSnackbar("Failed to save kanban column!", { variant: "error" });
    },
  });

  // Delete mutation
  const deleteColumnMutation = useMutation({
    mutationFn: async (columnId) => {
      const response = await apiClient.post("/api/kanban/deleteKanbanColumn", { Id: columnId });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanbanColumns"] });
      enqueueSnackbar("Kanban column deleted successfully!", { variant: "success" });
    },
    onError: (error) => {
      console.error("Error deleting kanban column:", error);
      const errorMessage = error.response?.data?.message || "Failed to delete kanban column!";
      enqueueSnackbar(errorMessage, { variant: "error" });
    },
  });

  // Table columns definition
  const columns = useMemo(
    () => [
      {
        accessorKey: "Title",
        header: "Title",
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
                backgroundColor: cell.getValue(),
                borderRadius: 1,
                border: "1px solid #ddd",
              }}
            />
            <span>{cell.getValue()}</span>
          </Box>
        ),
      },
      {
        accessorKey: "SortOrder",
        header: "Sort Order",
      },
      {
        accessorKey: "MaxTasks",
        header: "Max Tasks",
      },
      {
        accessorKey: "IsActive",
        header: "Status",
        Cell: ({ cell }) => (
          <Chip
            label={cell.getValue() ? "Active" : "Inactive"}
            color={cell.getValue() ? "success" : "default"}
            size="small"
            variant="outlined"
          />
        ),
      },
    ],
    []
  );


  // Handle deleting a column
  const handleDeleteRow = useCallback(
    (row) => {
      confirmation.confirmDelete({
        title: "Delete Kanban Column",
        message: `Are you sure you want to delete the "${row.original.Title}" column? This action cannot be undone.`,
        confirmText: "Delete Column",
        onConfirm: async () => {
          deleteColumnMutation.mutate(row.original.Id);
        },
      });
    },
    [deleteColumnMutation, confirmation]
  );

  // Handle edit
  const handleEdit = (row) => {
    setEditingColumn(row.original);
    setIsModalOpen(true);
  };

  // Server-paginated + server-searched table, scoped to the selected project.
  const { table, error: columnsError } = useServerTable({
    columns,
    queryKey: ["kanbanColumns", selectedProjectId],
    endpoint: "/api/kanban/fetchKanbanColumns",
    dataKey: "columns",
    extraParams: { ProjectId: selectedProjectId },
    enabled: !!selectedProjectId,
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
    renderTopToolbarCustomActions: ({ table }) => (
      <Box sx={{ display: "flex", gap: "1rem", p: "0.5rem", alignItems: "center" }}>
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel size="small">Select Project</InputLabel>
          <Select
            value={selectedProjectId || ""}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            label="Select Project"
            size="small"
            sx={{
              borderRadius: "8px",
              backgroundColor: "white",
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#d1d5db',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#1976d2',
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: '#1976d2',
              },
            }}
          >
            {projects.map((project) => (
              <MenuItem key={project.Id} value={project.Id}>
                {project.Name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        
        <ActionButton
          actionType="create"
          onClick={() => {
            if (!selectedProjectId) {
              enqueueSnackbar("Please select a project first", { variant: "warning" });
              return;
            }
            setEditingColumn(null);
            setIsModalOpen(true);
          }}
          label="Create Column"
          size="sm"
        />
      </Box>
    ),
  });

  React.useEffect(() => {
    if (columnsError) {
      console.error("Failed to fetch kanban columns:", columnsError);
      enqueueSnackbar("Failed to load kanban columns", { variant: "error" });
    }
  }, [columnsError, enqueueSnackbar]);

  // Close modal handler
  const closeModal = () => {
    setIsModalOpen(false);
    setEditingColumn(null);
    setValidationErrors({});
  };

  // Handle form submit
  const handleFormSubmit = (columnData) => {
    saveColumnMutation.mutate(columnData);
  };

  return (
    <ThemeProvider theme={theme}>
      <Box display="flex" flexDirection="column" flexGrow={1}>
        <PageHeader
          title="Kanban columns"
          subtitle="Board columns that drive task status per project."
        />
        <Helmet>
          <title>PRD Infotech | Kanban Columns</title>
        </Helmet>

        <Box sx={{ mt: 2, width: "100%", overflowX: "auto" }}>
          <MaterialReactTable table={table} />
        </Box>

        {/* Kanban Column creation/edit modal */}
        <KanbanForm
          open={isModalOpen}
          onClose={closeModal}
          editingColumn={editingColumn}
          onSubmit={handleFormSubmit}
          isLoading={saveColumnMutation.isPending}
          selectedProjectId={selectedProjectId}
          projects={projects}
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
    </ThemeProvider>
  );
};

export default Kanban;