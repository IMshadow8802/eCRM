// src/pages/Settings/CustomFields.jsx
//
// Company-admin page to manage lead custom-field definitions
// (tblCustomFieldDef, Entity='lead'). Reuses the LeadSource/Status
// CRUD-master pattern (MasterChipGrid + Design/FormComponents) — see
// pages/Master/LeadSource.jsx.
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
  FormSelect,
  FormNumberInput,
  FormCheckbox,
  FormButtons,
} from "../../components/Design/FormComponents";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useConfirmation } from "../../hooks";
import { SALES_ENDPOINTS, saveCustomField, deleteCustomField } from "../../api/salesQueries";

const ENTITY = "lead";

const TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "dropdown", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

// FieldKey isn't a user-facing field (brief's field list is Label/Type/
// Options/IsRequired/SortOrder only) — derive a stable slug from the label
// on create; preserve the original on edit.
const slugify = (label) => {
  const slug = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `field_${Date.now()}`;
};

// Options round-trips as a JSON string (or already-parsed array) of strings
// or {value,label} objects — same shape DynamicField.jsx consumes. The form
// edits it as a plain comma-separated string for simplicity.
const optionsToText = (options) => {
  if (!options) return "";
  let raw = options;
  if (typeof options === "string") {
    try {
      raw = JSON.parse(options);
    } catch {
      return "";
    }
  }
  if (!Array.isArray(raw)) return "";
  return raw.map((o) => (typeof o === "string" ? o : (o?.label ?? o?.value ?? ""))).join(", ");
};

const emptyForm = { Label: "", Type: "text", Options: "", IsRequired: false, SortOrder: "0" };

const CustomFields = () => {
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();

  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const query = useApiQuery({
    queryKey: ["customFields", ENTITY],
    endpoint: SALES_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: ENTITY },
  });

  const allFields = query.data?.customFields || [];
  const items = useMemo(() => {
    if (!search.trim()) return allFields;
    const term = search.trim().toLowerCase();
    return allFields.filter((f) => (f.Label || "").toLowerCase().includes(term));
  }, [allFields, search]);

  useEffect(() => {
    if (!isModalOpen) return;
    if (editingField) {
      setFormData({
        Label: editingField.Label || "",
        Type: editingField.Type || "text",
        Options: optionsToText(editingField.Options),
        IsRequired: Boolean(editingField.IsRequired),
        SortOrder: String(editingField.SortOrder ?? 0),
      });
    } else {
      setFormData(emptyForm);
    }
    setErrors({});
  }, [editingField, isModalOpen]);

  const handleCreate = () => {
    setEditingField(null);
    setIsModalOpen(true);
  };

  const handleEdit = (field) => {
    setEditingField(field);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingField(null);
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!formData.Label.trim()) next.Label = "Label is required";
    if (formData.Type === "dropdown" && !formData.Options.trim()) {
      next.Options = "Add at least one option";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSaving(true);
    try {
      const payload = {
        Id: editingField?.Id || 0,
        Entity: ENTITY,
        FieldKey: editingField?.FieldKey || slugify(formData.Label),
        Label: formData.Label.trim(),
        Type: formData.Type,
        Options:
          formData.Type === "dropdown"
            ? JSON.stringify(
                formData.Options.split(",").map((s) => s.trim()).filter(Boolean)
              )
            : null,
        IsRequired: Boolean(formData.IsRequired),
        SortOrder: Number(formData.SortOrder) || 0,
      };

      const response = await saveCustomField(payload);
      if (response.data.success) {
        enqueueSnackbar(`Field ${editingField ? "updated" : "created"} successfully!`, {
          variant: "success",
        });
        closeModal();
        query.refetch();
      } else {
        enqueueSnackbar(response.data.message || "Failed to save field", { variant: "error" });
      }
    } catch (error) {
      console.error("Error saving custom field:", error);
      enqueueSnackbar(
        error.response?.data?.message || "Failed to save field",
        { variant: "error" }
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = useCallback(
    (field) => {
      confirmation.confirmDelete({
        title: "Delete Custom Field",
        message: `Are you sure you want to delete "${field.Label}"? This action cannot be undone.`,
        confirmText: "Delete Field",
        onConfirm: async () => {
          try {
            const response = await deleteCustomField({ Id: field.Id });
            if (response.data.success) {
              enqueueSnackbar("Field deleted successfully!", { variant: "success" });
              query.refetch();
            } else {
              enqueueSnackbar(response.data.message || "Failed to delete field", {
                variant: "error",
              });
            }
          } catch (error) {
            console.error("Error deleting custom field:", error);
            enqueueSnackbar("Failed to delete field!", { variant: "error" });
            throw error;
          }
        },
      });
    },
    [confirmation, enqueueSnackbar, query]
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Custom Fields"
        subtitle="Configure extra fields captured on every lead."
      />
      <Helmet>
        <title>PRD Infotech | Custom Fields</title>
      </Helmet>
      <Box sx={{ mt: 1.5 }}>
        <MasterChipGrid
          items={items}
          nameKey="Label"
          idKey="Id"
          isLoading={query.isLoading}
          search={search}
          onSearchChange={setSearch}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          createLabel="New Field"
          emptyLabel="No custom fields yet — create the first one."
          totalCount={items.length}
        />
      </Box>

      <FormModal
        open={isModalOpen}
        title={editingField ? "Edit Field" : "Create Field"}
        maxWidth="max-w-2xl"
        onClose={closeModal}
      >
        <div className="p-6">
          <FormContainer spacing="space-y-4">
            <FormRow columns={1}>
              <FormInput
                label="Label"
                value={formData.Label}
                onChange={(e) => handleChange("Label", e.target.value)}
                placeholder="e.g. Budget"
                error={errors.Label}
                required
              />
            </FormRow>
            <FormRow columns={2}>
              <FormSelect
                label="Type"
                value={formData.Type}
                onChange={(e) => handleChange("Type", e.target.value)}
                options={TYPE_OPTIONS}
                required
              />
              <FormNumberInput
                label="Sort Order"
                value={formData.SortOrder}
                onChange={(e) => handleChange("SortOrder", e.target.value)}
              />
            </FormRow>
            {formData.Type === "dropdown" && (
              <FormRow columns={1}>
                <FormInput
                  label="Options"
                  value={formData.Options}
                  onChange={(e) => handleChange("Options", e.target.value)}
                  placeholder="Comma-separated, e.g. Web, Referral, Walk-in"
                  helperText="Comma-separated list of choices"
                  error={errors.Options}
                />
              </FormRow>
            )}
            <FormRow columns={1}>
              <FormCheckbox
                label="Required"
                checked={formData.IsRequired}
                onChange={(e) => handleChange("IsRequired", e.target.checked)}
              />
            </FormRow>
          </FormContainer>
        </div>

        <FormButtons
          onCancel={closeModal}
          onSubmit={handleSubmit}
          submitText={editingField ? "Update Field" : "Create Field"}
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

export default CustomFields;
