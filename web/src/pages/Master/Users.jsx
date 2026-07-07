// src/pages/Master/Users.jsx
import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Box, IconButton, Tooltip, Chip } from "@mui/material";
import { EditRounded, DeleteRounded } from "@mui/icons-material";
import { MaterialReactTable } from "material-react-table";
import { useSnackbar } from "notistack";
import dayjs from "dayjs";

import PageHeader from "../../components/PageHeader";
import UserForm from "./components/UserForm";
import ActionButton from "../../components/Design/ActionButton";
import ConfirmationDialog from "../../components/ConfirmationDialog";

import useApi from "../../hooks/useApi";
import { useApiQuery } from "../../hooks/useApiQuery";
import useServerTable from "../../hooks/useServerTable";
import { useConfirmation } from "../../hooks";
import { useQueryClient } from "@tanstack/react-query";

const Users = () => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const confirmation = useConfirmation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  // User groups is a dropdown feeder — pull a big page at once (same unified
  // API shape as everywhere else, just with a large PageSize).
  const { data: userGroupsData } = useApiQuery({
    queryKey: ["userGroups-all"],
    endpoint: "/api/user-groups/fetchUserGroups",
    params: { Id: 0, PageNumber: 1, PageSize: 1000, SearchTerm: null },
  });
  const userGroups = userGroupsData?.userGroups || [];

  const formatDate = (date) => {
    if (!date) return "";
    try {
      return dayjs(date).format("DD-MM-YYYY");
    } catch (error) {
      console.error("Error formatting date:", error);
      return "";
    }
  };

  const columns = useMemo(
    () => [
      { accessorKey: "Username", header: "Username", size: 120 },
      { accessorKey: "FullName", header: "Full Name", size: 150 },
      { accessorKey: "Email", header: "Email", size: 180 },
      { accessorKey: "JobTitle", header: "Job Title", size: 150 },
      { accessorKey: "GroupName", header: "User Group", size: 120 },
      {
        accessorKey: "HourlyRate",
        header: "Hourly Rate",
        size: 100,
        Cell: ({ cell }) => `₹${cell.getValue() || 0}`,
      },
      {
        accessorKey: "IsActive",
        header: "Status",
        size: 80,
        Cell: ({ cell }) => (
          <Chip
            label={cell.getValue() ? "Active" : "Inactive"}
            color={cell.getValue() ? "success" : "error"}
            size="small"
            variant="outlined"
          />
        ),
      },
      {
        accessorKey: "IsAdmin",
        header: "Admin",
        size: 80,
        Cell: ({ cell }) => (
          <Chip
            label={cell.getValue() ? "Yes" : "No"}
            color={cell.getValue() ? "primary" : "default"}
            size="small"
            variant="outlined"
          />
        ),
      },
      {
        accessorKey: "CreatedDate",
        header: "Created Date",
        size: 120,
        Cell: ({ cell }) => formatDate(cell.getValue()),
      },
    ],
    []
  );

  const handleDeleteRow = useCallback(
    (row) => {
      confirmation.confirmDelete({
        title: "Delete User",
        message: `Are you sure you want to delete "${row.original.FullName || row.original.Username}"? This action cannot be undone.`,
        confirmText: "Delete User",
        onConfirm: async () => {
          try {
            const response = await apiClient.post("/api/users/deleteUser", {
              Id: row.original.Id,
            });

            if (response.data.success) {
              enqueueSnackbar("User deleted successfully!", { variant: "success" });
              queryClient.invalidateQueries({ queryKey: ["users"] });
              queryClient.invalidateQueries({ queryKey: ["teams"] });
              queryClient.invalidateQueries({ queryKey: ["tasks"] });
              queryClient.invalidateQueries({ queryKey: ["projects"] });
            } else {
              enqueueSnackbar(
                response.data.message || "Failed to delete user!",
                { variant: "error" }
              );
            }
          } catch (error) {
            console.error("Error deleting user:", error);
            enqueueSnackbar("Failed to delete user!", { variant: "error" });
            throw error;
          }
        },
      });
    },
    [apiClient, enqueueSnackbar, queryClient, confirmation]
  );

  const handleEdit = (row) => {
    const userData = {
      Id: row.original.Id,
      Username: row.original.Username,
      FullName: row.original.FullName,
      Email: row.original.Email,
      JobTitle: row.original.JobTitle,
      HourlyRate: row.original.HourlyRate,
      GroupId: row.original.GroupId || 0,
      UserActive: row.original.IsActive,
      IsAdmin: row.original.IsAdmin,
      AllowDay: row.original.AllowDay || 0,
      UserIp: row.original.UserIp || "",
    };
    setEditingUser(userData);
    setIsModalOpen(true);
  };

  const {
    table,
    isLoading,
    error: usersError,
    refetch: refetchUsers,
  } = useServerTable({
    columns,
    queryKey: "users",
    endpoint: "/api/users/fetchUsers",
    dataKey: "users",
    enableRowActions: true,
    getRowId: (row) => row.Id,
    displayColumnDefOptions: {
      "mrt-row-actions": { size: 80, grow: false, header: "Actions" },
    },
    muiTableProps: { sx: { tableLayout: "fixed" } },
    muiTableBodyRowProps: { sx: { height: "40px" } },
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
    renderTopToolbarCustomActions: () => (
      <Box sx={{ display: "flex", gap: "1rem", p: "0.5rem" }}>
        <ActionButton
          actionType="create"
          onClick={() => {
            setEditingUser(null);
            setIsModalOpen(true);
          }}
          label="Create User"
          size="sm"
        />
      </Box>
    ),
  });

  useEffect(() => {
    if (usersError) {
      console.error("Failed to fetch users:", usersError);
      enqueueSnackbar("Failed to load users", { variant: "error" });
    }
  }, [usersError, enqueueSnackbar]);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1
      }}>
      <PageHeader
        title="Users"
        subtitle="Manage accounts, roles, and access for your organization."
      />
      <Helmet>
        <title>PRD Infotech | Users</title>
      </Helmet>
      <Box sx={{ mt: 2, width: "100%", overflowX: "auto" }}>
        <MaterialReactTable table={table} />
      </Box>
      <UserForm
        open={isModalOpen}
        onClose={closeModal}
        editingUser={editingUser}
        userGroups={userGroups}
        onUserSaved={refetchUsers}
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

export default Users;
