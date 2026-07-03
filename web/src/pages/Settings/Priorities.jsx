// src/pages/Settings/Priorities.jsx
// Company-admin CRUD master for ticket priorities — a Lookups page pinned to
// Kind="priority" (no Kind tab strip). Same shared /api/config lookup SPs as
// Lookups.jsx.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/PageHeader";
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
import { useConfirmation } from "../../hooks";
import { saveLookup, deleteLookup } from "../../api/salesQueries";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

const KIND = "priority";
const emptyForm = { Value: "", SortOrder: "0" };

const Priorities = () => {
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();

  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLookup, setEditingLookup] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);

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

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSaving(true);
    try {
      const payload = {
        Id: editingLookup?.Id || 0,
        Kind: KIND,
        Value: formData.Value.trim(),
        SortOrder: Number(formData.SortOrder) || 0,
      };

      const response = await saveLookup(payload);
      if (response.data.success) {
        enqueueSnackbar(`Priority ${editingLookup ? "updated" : "created"} successfully!`, {
          variant: "success",
        });
        closeModal();
        query.refetch();
      } else {
        enqueueSnackbar(response.data.message || "Failed to save priority", { variant: "error" });
      }
    } catch (error) {
      console.error("Error saving priority:", error);
      enqueueSnackbar(error.response?.data?.message || "Failed to save priority", {
        variant: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = useCallback(
    (lookup) => {
      confirmation.confirmDelete({
        title: "Delete Priority",
        message: `Are you sure you want to delete "${lookup.Value}"? This action cannot be undone.`,
        confirmText: "Delete Priority",
        onConfirm: async () => {
          try {
            const response = await deleteLookup({ Id: lookup.Id });
            if (response.data.success) {
              enqueueSnackbar("Priority deleted successfully!", { variant: "success" });
              query.refetch();
            } else {
              enqueueSnackbar(response.data.message || "Failed to delete priority", {
                variant: "error",
              });
            }
          } catch (error) {
            console.error("Error deleting priority:", error);
            enqueueSnackbar("Failed to delete priority!", { variant: "error" });
            throw error;
          }
        },
      });
    },
    [confirmation, enqueueSnackbar, query]
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Priorities" subtitle="Manage the priority levels tickets can be assigned." />
      <Helmet>
        <title>PRD Infotech | Priorities</title>
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
          createLabel="New Priority"
          emptyLabel="No priorities yet — create the first one."
          totalCount={items.length}
        />
      </Box>

      <FormModal
        open={isModalOpen}
        title={editingLookup ? "Edit Priority" : "Create Priority"}
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
                placeholder="e.g. High"
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
          submitText={editingLookup ? "Update Priority" : "Create Priority"}
          isLoading={isSaving}
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

export default Priorities;
