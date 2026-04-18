import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";

import PageHeader from "../../components/PageHeader";
import LeadSourceForm from "./components/LeadSourceForm";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import MasterChipGrid from "../../components/MasterChipGrid";

import useApi from "../../hooks/useApi";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useConfirmation } from "../../hooks";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 100;

const LeadSource = () => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const confirmation = useConfirmation();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo(
    () => ({
      Id: 0,
      SourceId: 0,
      PageNumber: 1,
      PageSize: PAGE_SIZE,
      SearchTerm: debouncedSearch ? debouncedSearch : null,
    }),
    [debouncedSearch]
  );

  const query = useApiQuery({
    queryKey: ["leadSources", params],
    endpoint: "/api/sources/fetchSources",
    params,
  });

  const items = query.data?.sources || [];
  const totalCount = query.data?.pagination?.totalRecords ?? items.length;

  const handleDelete = useCallback(
    (source) => {
      confirmation.confirmDelete({
        title: "Delete Lead Source",
        message: `Are you sure you want to delete "${source.SourceName}"? This action cannot be undone.`,
        confirmText: "Delete Source",
        onConfirm: async () => {
          try {
            const response = await apiClient.post(
              "/api/sources/deleteSources",
              { SourceId: source.SourceId }
            );
            if (response.data.success) {
              enqueueSnackbar("Lead source deleted successfully!", {
                variant: "success",
              });
              queryClient.invalidateQueries({ queryKey: ["leadSources"] });
            } else {
              enqueueSnackbar(
                response.data.message || "Failed to delete lead source!",
                { variant: "error" }
              );
            }
          } catch (error) {
            console.error("Error deleting lead source:", error);
            enqueueSnackbar("Failed to delete lead source!", {
              variant: "error",
            });
            throw error;
          }
        },
      });
    },
    [apiClient, enqueueSnackbar, confirmation, queryClient]
  );

  const handleEdit = (source) => {
    setEditingSource(source);
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    setEditingSource(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSource(null);
  };

  return (
    <Box display="flex" flexDirection="column" flexGrow={1}>
      <PageHeader title="Lead Sources" subtitle="Channels where your leads originate." />
      <Helmet>
        <title>PRD Infotech | Lead Sources</title>
      </Helmet>
      <Box sx={{ mt: 1.5 }}>
        <MasterChipGrid
          items={items}
          nameKey="SourceName"
          idKey="SourceId"
          isLoading={query.isLoading}
          search={search}
          onSearchChange={setSearch}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          createLabel="New Source"
          emptyLabel="No lead sources yet — create the first one."
          totalCount={totalCount}
        />
      </Box>
      <LeadSourceForm
        open={isModalOpen}
        onClose={closeModal}
        editingSource={editingSource}
        onSourceSaved={query.refetch}
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

export default LeadSource;
