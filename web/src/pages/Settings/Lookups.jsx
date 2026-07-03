// src/pages/Settings/Lookups.jsx
//
// Company-admin page to manage generic per-company lookups (tblLookup),
// scoped by Kind (lead_source / call_outcome / lost_reason). Same
// CRUD-master pattern as CustomFields.jsx / pages/Master/LeadSource.jsx,
// with a Tabs strip to switch Kind.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/PageHeader";
import MasterChipGrid from "../../components/MasterChipGrid";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import Tabs from "../../components/ui/Tabs";
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
import { SALES_ENDPOINTS, saveLookup, deleteLookup } from "../../api/salesQueries";

const KIND_OPTIONS = [
  { value: "lead_source", label: "Lead Sources" },
  { value: "call_outcome", label: "Call Outcomes" },
  { value: "lost_reason", label: "Lost Reasons" },
];

const emptyForm = { Value: "", SortOrder: "0" };

const Lookups = () => {
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();

  const [activeKind, setActiveKind] = useState(KIND_OPTIONS[0].value);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLookup, setEditingLookup] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const query = useApiQuery({
    queryKey: ["lookups", activeKind],
    endpoint: SALES_ENDPOINTS.config.fetchLookups,
    params: { Kind: activeKind },
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

  const handleKindChange = (kind) => {
    setActiveKind(kind);
    setSearch("");
  };

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
        Kind: activeKind,
        Value: formData.Value.trim(),
        SortOrder: Number(formData.SortOrder) || 0,
      };

      const response = await saveLookup(payload);
      if (response.data.success) {
        enqueueSnackbar(`Lookup ${editingLookup ? "updated" : "created"} successfully!`, {
          variant: "success",
        });
        closeModal();
        query.refetch();
      } else {
        enqueueSnackbar(response.data.message || "Failed to save lookup", { variant: "error" });
      }
    } catch (error) {
      console.error("Error saving lookup:", error);
      enqueueSnackbar(
        error.response?.data?.message || "Failed to save lookup",
        { variant: "error" }
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = useCallback(
    (lookup) => {
      confirmation.confirmDelete({
        title: "Delete Lookup",
        message: `Are you sure you want to delete "${lookup.Value}"? This action cannot be undone.`,
        confirmText: "Delete Lookup",
        onConfirm: async () => {
          try {
            const response = await deleteLookup({ Id: lookup.Id });
            if (response.data.success) {
              enqueueSnackbar("Lookup deleted successfully!", { variant: "success" });
              query.refetch();
            } else {
              enqueueSnackbar(response.data.message || "Failed to delete lookup", {
                variant: "error",
              });
            }
          } catch (error) {
            console.error("Error deleting lookup:", error);
            enqueueSnackbar("Failed to delete lookup!", { variant: "error" });
            throw error;
          }
        },
      });
    },
    [confirmation, enqueueSnackbar, query]
  );

  const activeLabel = KIND_OPTIONS.find((k) => k.value === activeKind)?.label || "";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Lookups" subtitle="Manage lead source, call outcome and lost-reason lists." />
      <Helmet>
        <title>PRD Infotech | Lookups</title>
      </Helmet>
      <Box sx={{ mt: 1.5 }}>
        <Tabs
          value={activeKind}
          onChange={handleKindChange}
          items={KIND_OPTIONS}
          data-testid="lookup-kind-tabs"
        />
      </Box>
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
          createLabel="New Lookup"
          emptyLabel={`No ${activeLabel.toLowerCase()} yet — create the first one.`}
          totalCount={items.length}
        />
      </Box>

      <FormModal
        open={isModalOpen}
        title={editingLookup ? "Edit Lookup" : "Create Lookup"}
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
                placeholder="e.g. Website"
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
          submitText={editingLookup ? "Update Lookup" : "Create Lookup"}
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

export default Lookups;
