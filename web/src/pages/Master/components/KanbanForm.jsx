// src/pages/Master/components/KanbanForm.jsx
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
  FormSelect,
  FormTextarea,
  FormNumberInput,
  FormButtons,
} from "../../../components/Design/FormComponents";
import { Autocomplete, TextField } from "@mui/material";

// Zod validation schema
const kanbanSchema = z.object({
  Title: z.string().min(1, "Title is required"),
  Color: z.string().min(1, "Color is required"),
  SortOrder: z.number().min(1, "Sort order must be positive"),
  MaxTasks: z.number().optional(),
  IsActive: z.boolean(),
  ProjectId: z.number().min(1, "Project is required"),
});

const KanbanForm = ({
  open,
  onClose,
  editingColumn = null,
  onSubmit,
  isLoading,
  selectedProjectId,
  projects = [],
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const apiClient = useApi();
  const { CompId, BranchId, UserId } = useAuthStore();

  const [formData, setFormData] = useState({
    Title: "",
    Color: "#3B82F6",
    SortOrder: 1,
    MaxTasks: "",
    IsActive: true,
    ProjectId: selectedProjectId || null,
  });

  const [errors, setErrors] = useState({});

  // Predefined color options
  const colorOptions = [
    { value: "#3B82F6", label: "Soft Blue", color: "#3B82F6" },
    { value: "#fb6f92", label: "Soft Pink", color: "#fb6f92" },
    { value: "#b388eb", label: "Soft Purple", color: "#b388eb" },
    { value: "#4ADE80", label: "Soft Green", color: "#4ADE80" },
    { value: "#FB923C", label: "Soft Orange", color: "#FB923C" },
    { value: "#EF4444", label: "Soft Red", color: "#EF4444" },
    { value: "#06B6D4", label: "Soft Teal", color: "#06B6D4" },
    { value: "#f7aef8", label: "Soft Lavender", color: "#f7aef8" },
    { value: "#8093f1", label: "Soft Indigo", color: "#8093f1" },
    { value: "#9381ff", label: "Soft Violet", color: "#9381ff" },
    { value: "#7fd8be", label: "Soft Mint", color: "#7fd8be" },
    { value: "#64748B", label: "Soft Slate", color: "#64748B" },
  ];

  // Status options
  const statusOptions = [
    { value: true, label: "Active" },
    { value: false, label: "Inactive" },
  ];

  // Set form data when editing column changes
  useEffect(() => {
    if (editingColumn) {
      setFormData({
        Title: editingColumn.Title || "",
        Color: editingColumn.Color || "#3B82F6",
        SortOrder: editingColumn.SortOrder || 1,
        MaxTasks: editingColumn.MaxTasks || "",
        IsActive: editingColumn.IsActive !== false,
        ProjectId: editingColumn.ProjectId || selectedProjectId,
      });
    } else {
      // Reset form for new column
      setFormData({
        Title: "",
        Color: "#3B82F6",
        SortOrder: 1,
        MaxTasks: "",
        IsActive: true,
        ProjectId: selectedProjectId,
      });
    }
    setErrors({});
  }, [editingColumn, open, selectedProjectId]);

  const validateForm = () => {
    try {
      kanbanSchema.parse({
        ...formData,
        SortOrder: parseInt(formData.SortOrder) || 0,
        MaxTasks: formData.MaxTasks ? parseInt(formData.MaxTasks) : undefined,
        IsActive: Boolean(formData.IsActive),
        ProjectId: formData.ProjectId,
      });
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

    try {
      const columnData = {
        Id: editingColumn ? editingColumn.Id : 0,  // 0 for create, existing ID for update
        ProjectId: formData.ProjectId,
        Title: formData.Title,
        Color: formData.Color,
        SortOrder: parseInt(formData.SortOrder),
        MaxTasks: formData.MaxTasks ? parseInt(formData.MaxTasks) : null,
        IsActive: Boolean(formData.IsActive),
      };

      await onSubmit(columnData);
      
      // Invalidate related caches
      queryClient.invalidateQueries({ queryKey: ["kanbanColumns"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      
    } catch (error) {
      console.error("Error saving kanban column:", error);
      enqueueSnackbar("Error saving kanban column", { variant: "error" });
    }
  };

  const handleClose = () => {
    setFormData({
      Title: "",
      Color: "#3B82F6",
      SortOrder: 1,
      MaxTasks: "",
      IsActive: true,
      ProjectId: selectedProjectId,
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
      title={editingColumn ? "Edit Kanban Column" : "Create Kanban Column"}
      maxWidth="max-w-3xl"
    >
      {/* Content */}
      <div className="p-6">
        <FormContainer spacing="space-y-3">
          {/* First Row - Project, Title */}
          <FormRow columns={2}>
            <div>
              <Autocomplete
                value={projects.find(project => project.Id === formData.ProjectId) || null}
                onChange={(event, newValue) => {
                  handleInputChange("ProjectId", newValue ? newValue.Id : null);
                }}
                options={projects}
                getOptionLabel={(option) => option.Name || ''}
                isOptionEqualToValue={(option, value) => option.Id === value?.Id}
                disabled={!!editingColumn}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Project"
                    placeholder="Select project"
                    required
                    error={!!errors.ProjectId}
                    helperText={errors.ProjectId || (editingColumn ? "Project cannot be changed" : "Select the project for this column")}
                    variant="outlined"
                    size="small"
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: '12px',
                        backgroundColor: 'white',
                        '& fieldset': {
                          borderColor: errors.ProjectId ? '#ef4444' : '#d1d5db',
                        },
                        '&:hover fieldset': {
                          borderColor: errors.ProjectId ? '#ef4444' : '#1976d2',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: errors.ProjectId ? '#ef4444' : '#1976d2',
                          borderWidth: '1px',
                        },
                      },
                    }}
                  />
                )}
              />
            </div>

            <FormInput
              label="Column Title"
              value={formData.Title}
              onChange={(e) => handleInputChange("Title", e.target.value)}
              placeholder="Enter column title"
              error={errors.Title}
              required
            />
          </FormRow>

          {/* Second Row - Color, Status */}
          <FormRow columns={2}>
            <div>
              <Autocomplete
                value={colorOptions.find(option => option.value === formData.Color) || null}
                onChange={(event, newValue) => {
                  handleInputChange("Color", newValue ? newValue.value : "");
                }}
                options={colorOptions}
                getOptionLabel={(option) => option.label || ''}
                isOptionEqualToValue={(option, value) => option.value === value?.value}
                renderOption={(props, option) => (
                  <li {...props} key={option.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        backgroundColor: option.color,
                        border: '2px solid #e5e7eb',
                        flexShrink: 0
                      }}
                    />
                    <span style={{ fontSize: '14px' }}>{option.label}</span>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Column Color"
                    placeholder="Select column color"
                    required
                    error={!!errors.Color}
                    helperText={errors.Color}
                    variant="outlined"
                    size="small"
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: '12px',
                        backgroundColor: 'white',
                        '& fieldset': {
                          borderColor: errors.Color ? '#ef4444' : '#d1d5db',
                        },
                        '&:hover fieldset': {
                          borderColor: errors.Color ? '#ef4444' : '#1976d2',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: errors.Color ? '#ef4444' : '#1976d2',
                          borderWidth: '1px',
                        },
                      },
                      '& .MuiInputLabel-root': {
                        fontSize: '14px',
                        '&.Mui-required::after': {
                          color: '#ef4444',
                        },
                      },
                    }}
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: formData.Color ? (
                        <div
                          style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            backgroundColor: formData.Color,
                            border: '2px solid #e5e7eb',
                            marginRight: '8px',
                            marginLeft: '4px'
                          }}
                        />
                      ) : null,
                    }}
                  />
                )}
              />
            </div>

            <FormSelect
              label="Status"
              value={formData.IsActive}
              onChange={(e) =>
                handleInputChange("IsActive", e.target.value === "true")
              }
              options={statusOptions}
              placeholder="Select status"
              error={errors.IsActive}
              required
            />
          </FormRow>

          {/* Third Row - Sort Order, Max Tasks */}
          <FormRow columns={2}>
            <FormNumberInput
              label="Sort Order"
              value={formData.SortOrder}
              onChange={(e) => handleInputChange("SortOrder", e.target.value)}
              placeholder="1"
              error={errors.SortOrder}
              min={1}
              step={1}
              required
              helperText="Order in which columns appear"
            />

            <FormNumberInput
              label="Max Tasks"
              value={formData.MaxTasks}
              onChange={(e) => handleInputChange("MaxTasks", e.target.value)}
              placeholder="Leave empty for unlimited"
              error={errors.MaxTasks}
              min={1}
              step={1}
              helperText="Maximum tasks allowed in this column"
            />
          </FormRow>

          {/* Additional Information Row */}
          {editingColumn && (
            <FormRow columns={2}>
              <div className="bg-gray-50 p-3 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project
                </label>
                <div className="text-sm text-gray-600">
                  {projects.find(p => p.Id === formData.ProjectId)?.Name || 'Unknown Project'}
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color Preview
                </label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full border"
                    style={{ backgroundColor: formData.Color }}
                  />
                  <span className="text-sm text-gray-600">
                    {colorOptions.find(c => c.value === formData.Color)?.label || formData.Color}
                  </span>
                </div>
              </div>
            </FormRow>
          )}
        </FormContainer>
      </div>

      {/* Footer */}
      <FormButtons
        onCancel={handleClose}
        onSubmit={handleSubmit}
        submitText={editingColumn ? "Update Column" : "Create Column"}
        isLoading={isLoading}
      />
    </FormModal>
  );
};

export default KanbanForm;