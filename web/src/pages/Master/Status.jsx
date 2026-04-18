import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";

import PageHeader from "../../components/PageHeader";
import StatusForm from "./components/StatusForm";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import MasterChipGrid from "../../components/MasterChipGrid";

import useApi from "../../hooks/useApi";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useConfirmation } from "../../hooks";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 100;

const Status = () => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const confirmation = useConfirmation();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo(
    () => ({
      Id: 0,
      StatusId: 0,
      PageNumber: 1,
      PageSize: PAGE_SIZE,
      SearchTerm: debouncedSearch ? debouncedSearch : null,
    }),
    [debouncedSearch]
  );

  const query = useApiQuery({
    queryKey: ["statuses", params],
    endpoint: "/api/status/fetchStatus",
    params,
  });

  const items = query.data?.statuses || [];
  const totalCount = query.data?.pagination?.totalRecords ?? items.length;

  const handleDelete = useCallback(
    (status) => {
      confirmation.confirmDelete({
        title: "Delete Status",
        message: `Are you sure you want to delete "${status.StatusName}"? This action cannot be undone.`,
        confirmText: "Delete Status",
        onConfirm: async () => {
          try {
            const response = await apiClient.post("/api/status/deleteStatus", {
              StatusId: status.StatusId,
            });
            if (response.data.success) {
              enqueueSnackbar("Status deleted successfully!", {
                variant: "success",
              });
              queryClient.invalidateQueries({ queryKey: ["statuses"] });
            } else {
              enqueueSnackbar(
                response.data.message || "Failed to delete status!",
                { variant: "error" }
              );
            }
          } catch (error) {
            console.error("Error deleting status:", error);
            enqueueSnackbar("Failed to delete status!", { variant: "error" });
            throw error;
          }
        },
      });
    },
    [apiClient, enqueueSnackbar, confirmation, queryClient]
  );

  const handleEdit = (status) => {
    setEditingStatus(status);
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    setEditingStatus(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingStatus(null);
  };

  return (
    <Box display="flex" flexDirection="column" flexGrow={1}>
      <PageHeader title="Status" subtitle="Pipeline statuses available across the workspace." />
      <Helmet>
        <title>PRD Infotech | Status</title>
      </Helmet>
      <Box sx={{ mt: 1.5 }}>
        <MasterChipGrid
          items={items}
          nameKey="StatusName"
          idKey="StatusId"
          isLoading={query.isLoading}
          search={search}
          onSearchChange={setSearch}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          createLabel="New Status"
          emptyLabel="No statuses yet — create the first one."
          totalCount={totalCount}
        />
      </Box>
      <StatusForm
        open={isModalOpen}
        onClose={closeModal}
        editingStatus={editingStatus}
        onStatusSaved={query.refetch}
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

export default Status;
