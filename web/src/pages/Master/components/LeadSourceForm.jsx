// src/pages/Master/components/LeadSourceForm.jsx
import React, { useState, useEffect } from "react";
import { z } from "zod";
import { useSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import useAuthStore from "../../../stores/useAuthStore";
import useApi from "../../../hooks/useApi";
import {
  FormModal,
  FormContainer,
  FormRow,
  FormInput,
  FormButtons,
} from "../../../components/Design/FormComponents";

// Zod validation schema
const leadSourceSchema = z.object({
  SourceName: z
    .string()
    .min(3, "Source name must be at least 3 characters")
    .max(50, "Source name must not exceed 50 characters")
    .nonempty("Source name is required"),
});

const LeadSourceForm = ({
  open,
  onClose,
  editingSource = null,
  onSourceSaved,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { CompId, BranchId } = useAuthStore();

  const [formData, setFormData] = useState({
    SourceName: "",
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Set form data when editing source changes
  useEffect(() => {
    if (editingSource) {
      setFormData({
        SourceName: editingSource.SourceName || "",
      });
    } else {
      // Reset form for new source
      setFormData({
        SourceName: "",
      });
    }
  }, [editingSource]);

  const validateForm = () => {
    try {
      leadSourceSchema.parse(formData);
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors = {};
        error.errors.forEach((err) => {
          newErrors[err.path[0]] = err.message;
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const sourceData = {
        SourceId: editingSource?.SourceId || 0,
        SourceName: formData.SourceName.trim(),
      };

      const response = await apiClient.post(
        "/api/sources/saveSources",
        sourceData
      );

      if (response.data.success) {
        enqueueSnackbar(
          `Lead source ${editingSource ? "updated" : "created"} successfully!`,
          { variant: "success" }
        );

        // Invalidate related caches
        queryClient.invalidateQueries({ queryKey: ["leadSources"] });

        handleClose();
        if (onSourceSaved) {
          onSourceSaved(); // Refresh the sources list
        }
      } else {
        enqueueSnackbar(
          `Failed to ${editingSource ? "update" : "create"} lead source: ${
            response.data.message
          }`,
          { variant: "error" }
        );
      }
    } catch (error) {
      console.error("Error saving lead source:", error);
      enqueueSnackbar(
        `Error ${editingSource ? "updating" : "creating"} lead source: ${
          error.message
        }`,
        { variant: "error" }
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      SourceName: "",
    });
    setErrors({});
    onClose();
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  return (
    <FormModal
      open={open}
      title={editingSource ? "Edit Lead Source" : "Create Lead Source"}
      maxWidth="max-w-2xl"
    >
      {/* Content */}
      <div className="p-6">
        <FormContainer spacing="space-y-4">
          {/* Source Name Field */}
          <FormRow columns={1}>
            <FormInput
              label="Source Name"
              value={formData.SourceName}
              onChange={(e) => handleInputChange("SourceName", e.target.value)}
              placeholder="Enter lead source name (e.g., Website, Referral)"
              error={errors.SourceName}
              required
              maxLength={50}
            />
          </FormRow>
        </FormContainer>
      </div>

      {/* Footer */}
      <FormButtons
        onCancel={handleClose}
        onSubmit={handleSubmit}
        submitText={editingSource ? "Update Source" : "Create Source"}
        isLoading={isLoading}
      />
    </FormModal>
  );
};

export default LeadSourceForm;
