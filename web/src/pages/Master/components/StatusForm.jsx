// src/pages/Master/components/StatusForm.jsx
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
const statusSchema = z.object({
  StatusName: z
    .string()
    .min(3, "Status name must be at least 3 characters")
    .max(50, "Status name must not exceed 50 characters")
    .nonempty("Status name is required"),
});

const StatusForm = ({
  open,
  onClose,
  editingStatus = null,
  onStatusSaved,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { CompId, BranchId } = useAuthStore();

  const [formData, setFormData] = useState({
    StatusName: "",
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Set form data when editing status changes
  useEffect(() => {
    if (editingStatus) {
      setFormData({
        StatusName: editingStatus.StatusName || "",
      });
    } else {
      // Reset form for new status
      setFormData({
        StatusName: "",
      });
    }
  }, [editingStatus]);

  const validateForm = () => {
    try {
      statusSchema.parse(formData);
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
      const statusData = {
        StatusId: editingStatus?.StatusId || 0,
        StatusName: formData.StatusName.trim(),
      };

      const response = await apiClient.post(
        "/api/status/saveStatus",
        statusData
      );

      if (response.data.success) {
        enqueueSnackbar(
          `Status ${editingStatus ? "updated" : "created"} successfully!`,
          { variant: "success" }
        );

        // Invalidate related caches
        queryClient.invalidateQueries({ queryKey: ["statuses"] });

        handleClose();
        if (onStatusSaved) {
          onStatusSaved(); // Refresh the statuses list
        }
      } else {
        enqueueSnackbar(
          `Failed to ${editingStatus ? "update" : "create"} status: ${
            response.data.message
          }`,
          { variant: "error" }
        );
      }
    } catch (error) {
      console.error("Error saving status:", error);
      enqueueSnackbar(
        `Error ${editingStatus ? "updating" : "creating"} status: ${
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
      StatusName: "",
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
      title={editingStatus ? "Edit Status" : "Create Status"}
      maxWidth="max-w-2xl"
    >
      {/* Content */}
      <div className="p-6">
        <FormContainer spacing="space-y-4">
          {/* Status Name Field */}
          <FormRow columns={1}>
            <FormInput
              label="Status Name"
              value={formData.StatusName}
              onChange={(e) => handleInputChange("StatusName", e.target.value)}
              placeholder="Enter status name (e.g., New Lead, Contacted)"
              error={errors.StatusName}
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
        submitText={editingStatus ? "Update Status" : "Create Status"}
        isLoading={isLoading}
      />
    </FormModal>
  );
};

export default StatusForm;
