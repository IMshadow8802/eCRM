// src/pages/Settings/TicketCategories.jsx
// Company-admin CRUD master for ticket categories — a Lookups page pinned to
// Kind="ticket_category" (no Kind tab strip). Same shared /api/config lookup
// SPs as Lookups.jsx.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/ui/PageHeader";
import MasterChipGrid from "../../components/MasterChipGrid";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import {
  FormModal,
  FormContainer,
  FormRow,
  FormInput,
  FormNumberInput,
  FormButtons,
} from "../../components/Design/FormComponents";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useConfirmation } from "../../hooks";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

const KIND = "ticket_category";
const emptyForm = { Value: "", SortOrder: "0" };

// useApiMutation rejects with the API's own message when the server refuses
// the write; a transport failure arrives as an axios error whose message
// ("Network Error") is no use to anyone, so that keeps the generic fallback.
const errorText = (error, fallback) =>
  error.isAxiosError ? error.response?.data?.message || fallback : error.message;

const TicketCategories = () => {
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();

  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLookup, setEditingLookup] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});

  const query = useApiQuery({
    queryKey: ["lookups", KIND],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: KIND },
  });

  const allLookups = query.data?.lookups || [];
  const items = useMemo(() => {
    if (!search.trim()) return allLookups;
    const term = search.trim().toLowerCase();
    return allLookups.filter((l) => (l.Value || "").toLowerCase().includes(term));
  }, [allLookups, search]);

  useEffect(() => {
    if (!isModalOpen) return;
    if (editingLookup) {
      setFormData({
        Value: editingLookup.Value || "",
        SortOrder: String(editingLookup.SortOrder ?? 0),
      });
    } else {
      setFormData(emptyForm);
    }
    setErrors({});
  }, [editingLookup, isModalOpen]);

  const handleCreate = () => {
    setEditingLookup(null);
    setIsModalOpen(true);
  };

  const handleEdit = (lookup) => {
    setEditingLookup(lookup);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingLookup(null);
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!formData.Value.trim()) next.Value = "Value is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const saveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.config.saveLookup,
    successMessage: `Category ${editingLookup ? "updated" : "created"} successfully!`,
    invalidateQueries: [["lookups", KIND]],
    onSuccess: closeModal,
    showErrorMessage: false,
    onError: (error) =>
      enqueueSnackbar(errorText(error, "Failed to save category"), { variant: "error" }),
  });

  const deleteMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.config.deleteLookup,
    successMessage: "Category deleted successfully!",
    invalidateQueries: [["lookups", KIND]],
    showErrorMessage: false,
    onError: (error) =>
      enqueueSnackbar(errorText(error, "Failed to delete category!"), { variant: "error" }),
  });

  const handleSubmit = () => {
    if (!validate()) return;
    saveMutation.mutate({
      Id: editingLookup?.Id || 0,
      Kind: KIND,
      Value: formData.Value.trim(),
      SortOrder: Number(formData.SortOrder) || 0,
    });
  };

  const handleDelete = useCallback(
    (lookup) => {
      confirmation.confirmDelete({
        title: "Delete Category",
        message: `Are you sure you want to delete "${lookup.Value}"? This action cannot be undone.`,
        confirmText: "Delete Category",
        onConfirm: () => deleteMutation.mutateAsync({ Id: lookup.Id }),
      });
    },
    [confirmation, deleteMutation]
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Ticket Categories" subtitle="Manage the categories tickets can be filed under." />
      <Helmet>
        <title>PRD Infotech | Ticket Categories</title>
      </Helmet>
      <Box sx={{ mt: 1.5 }}>
        <MasterChipGrid
          items={items}
          nameKey="Value"
          idKey="Id"
          isLoading={query.isLoading}
          search={search}
          onSearchChange={setSearch}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          createLabel="New Category"
          emptyLabel="No ticket categories yet — create the first one."
          totalCount={items.length}
        />
      </Box>

      <FormModal
        open={isModalOpen}
        title={editingLookup ? "Edit Category" : "Create Category"}
        maxWidth="max-w-2xl"
        onClose={closeModal}
      >
        <div className="p-6">
          <FormContainer spacing="space-y-4">
            <FormRow columns={1}>
              <FormInput
                label="Value"
                value={formData.Value}
                onChange={(e) => handleChange("Value", e.target.value)}
                placeholder="e.g. Billing"
                error={errors.Value}
                required
              />
            </FormRow>
            <FormRow columns={1}>
              <FormNumberInput
                label="Sort Order"
                value={formData.SortOrder}
                onChange={(e) => handleChange("SortOrder", e.target.value)}
              />
            </FormRow>
          </FormContainer>
        </div>

        <FormButtons
          onCancel={closeModal}
          onSubmit={handleSubmit}
          submitText={editingLookup ? "Update Category" : "Create Category"}
          isLoading={saveMutation.isPending}
        />
      </FormModal>

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

export default TicketCategories;
