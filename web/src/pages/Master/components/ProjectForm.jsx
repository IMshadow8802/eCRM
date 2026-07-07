// src/pages/Master/components/ProjectForm.jsx
import React, { useState, useEffect } from "react";
import { z } from "zod";
import dayjs from "dayjs";
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
  FormDateInput,
  FormNumberInput,
  FormButtons,
  FormFieldGroup,
} from "../../../components/Design/FormComponents";
import { toUserOptions, getUserId } from "../../../utils/userShape";

// Zod validation schema
const projectSchema = z.object({
  Name: z.string().min(1, "Project name is required"),
  Description: z.string().optional(),
  ManagerUserId: z.string().min(1, "Project manager is required"),
  // A team is the only way to seed project-workspace membership,
  // so it's mandatory to pick one up-front.
  TeamId: z.string().min(1, "Team is required"),
  Status: z.string().min(1, "Status is required"),
  Priority: z.string().min(1, "Priority is required"),
  StartDate: z.string().optional(),
  EndDate: z.string().optional(),
  Budget: z.number().min(0, "Budget must be positive").optional(),
  Progress: z
    .number()
    .min(0)
    .max(100, "Progress must be between 0-100")
    .optional(),
});

const ProjectForm = ({
  open,
  onClose,
  editingProject = null,
  teams = [],
  users = [],
  onProjectSaved,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const apiClient = useApi();
  const { CompId, BranchId, UserId } = useAuthStore();

  const [formData, setFormData] = useState({
    Name: "",
    Description: "",
    ManagerUserId: "",
    TeamId: "",
    Status: "active",
    Priority: "medium",
    StartDate: "",
    EndDate: "",
    Budget: 0,
    Progress: 0,
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Status options
  const statusOptions = [
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
    { value: "on_hold", label: "On Hold" },
    { value: "cancelled", label: "Cancelled" },
  ];

  // Priority options
  const priorityOptions = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  // Set form data when editing project changes
  useEffect(() => {
    if (editingProject) {
      setFormData({
        Name: editingProject.Name || "",
        Description: editingProject.Description || "",
        ManagerUserId: editingProject.ManagerUserId?.toString() || "",
        TeamId: editingProject.TeamId?.toString() || "",
        Status: editingProject.Status || "active",
        Priority: editingProject.Priority || "medium",
        StartDate: editingProject.StartDate
          ? dayjs(editingProject.StartDate).format("YYYY-MM-DD")
          : "",
        EndDate: editingProject.EndDate
          ? dayjs(editingProject.EndDate).format("YYYY-MM-DD")
          : "",
        Budget: editingProject.Budget || 0,
        Progress: editingProject.Progress || 0,
      });
    } else {
      // Reset form for new project
      setFormData({
        Name: "",
        Description: "",
        ManagerUserId: getUserId(users[0])?.toString() || "",
        TeamId: teams[0]?.Id?.toString() || "",
        Status: "active",
        Priority: "medium",
        StartDate: "",
        EndDate: "",
        Budget: 0,
        Progress: 0,
      });
    }
  }, [editingProject, users, teams]);

  // Set default values when data loads
  useEffect(() => {
    if (!editingProject) {
      setFormData((prev) => ({
        ...prev,
        ManagerUserId: getUserId(users[0])?.toString() || "",
        TeamId: teams[0]?.Id?.toString() || "",
      }));
    }
  }, [users, teams, editingProject]);

  const validateForm = () => {
    try {
      // Convert string numbers back to numbers for validation
      const validationData = {
        ...formData,
        Budget: parseFloat(formData.Budget) || 0,
        Progress: parseFloat(formData.Progress) || 0,
      };

      projectSchema.parse(validationData);
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
      const currentDateTime = new Date().toISOString();

      const projectData = {
        Id: editingProject?.Id || 0,
        Name: formData.Name,
        Description: formData.Description,
        ManagerUserId: parseInt(formData.ManagerUserId),
        TeamId: formData.TeamId ? parseInt(formData.TeamId) : null,
        Members: editingProject?.Members || "[]", // Keep existing members or empty array
        Status: formData.Status,
        Priority: formData.Priority,
        StartDate: formData.StartDate || null,
        EndDate: formData.EndDate || null,
        Budget: parseFloat(formData.Budget) || 0,
        Progress: parseFloat(formData.Progress) || 0,
        BranchId: BranchId,
        CompId: CompId,
      };

      const response = await apiClient.post("/api/projects/saveProject", projectData);

      if (response.data.success) {
        enqueueSnackbar(
          `Project ${editingProject ? "updated" : "created"} successfully!`,
          { variant: "success" }
        );
        
        // Invalidate related caches
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["teams"] });
        queryClient.invalidateQueries({ queryKey: ["users"] });
        
        handleClose();
        if (onProjectSaved) {
          onProjectSaved(); // Refresh the projects list
        }
      } else {
        enqueueSnackbar(
          `Failed to ${editingProject ? "update" : "create"} project: ${
            response.data.message
          }`,
          { variant: "error" }
        );
      }
    } catch (error) {
      console.error("Error saving project:", error);
      enqueueSnackbar(
        `Error ${editingProject ? "updating" : "creating"} project: ${
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
      Name: "",
      Description: "",
      ManagerUserId: getUserId(users[0])?.toString() || "",
      TeamId: teams[0]?.Id?.toString() || "",
      Status: "active",
      Priority: "medium",
      StartDate: "",
      EndDate: "",
      Budget: 0,
      Progress: 0,
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

  // Role-based filtering moved to tblUserGroupMap — every active user
  // is a candidate manager; RBAC narrows later.
  const userOptions = toUserOptions(users, { withJobTitle: true });

  const teamOptions = teams.map((team) => ({
    value: team.Id?.toString(),
    label: team.Name,
  }));

  return (
    <FormModal
      open={open}
      title={editingProject ? "Edit Project" : "Create Project"}
      maxWidth="max-w-6xl"
    >
      {/* Content */}
      <div className="p-6">
        <FormContainer spacing="space-y-3">
          {/* First Row - Project Name, Manager, Team */}
          <FormRow columns={3}>
            <FormInput
              label="Project Name"
              value={formData.Name}
              onChange={(e) => handleInputChange("Name", e.target.value)}
              placeholder="Enter project name"
              error={errors.Name}
              required
            />

            <FormSelect
              label="Project Manager"
              value={formData.ManagerUserId}
              onChange={(e) =>
                handleInputChange("ManagerUserId", e.target.value)
              }
              options={userOptions}
              placeholder="Select project manager"
              error={errors.ManagerUserId}
              required
            />

            <FormSelect
              label="Team"
              value={formData.TeamId}
              onChange={(e) => handleInputChange("TeamId", e.target.value)}
              options={teamOptions}
              placeholder="Select team"
              error={errors.TeamId}
              required
            />
          </FormRow>

          {/* Second Row - Status, Priority, Description */}
          <FormRow columns={3}>
            <FormFieldGroup spacing="space-y-2">
              <FormSelect
                label="Status"
                value={formData.Status}
                onChange={(e) => handleInputChange("Status", e.target.value)}
                options={statusOptions}
                placeholder="Select status"
                error={errors.Status}
                required
              />

              <FormSelect
                label="Priority"
                value={formData.Priority}
                onChange={(e) => handleInputChange("Priority", e.target.value)}
                options={priorityOptions}
                placeholder="Select priority"
                error={errors.Priority}
                required
              />
            </FormFieldGroup>

            {/* Description spanning 2 columns */}
            <div className="col-span-2">
              <FormTextarea
                label="Project Description"
                value={formData.Description}
                onChange={(e) =>
                  handleInputChange("Description", e.target.value)
                }
                placeholder="Enter detailed project description"
                rows={4}
                error={errors.Description}
              />
            </div>
          </FormRow>

          {/* Third Row - Dates, Budget, Progress */}
          <FormRow columns={4}>
            <FormDateInput
              label="Start Date"
              value={formData.StartDate}
              onChange={(e) => handleInputChange("StartDate", e.target.value)}
              error={errors.StartDate}
            />

            <FormDateInput
              label="End Date"
              value={formData.EndDate}
              onChange={(e) => handleInputChange("EndDate", e.target.value)}
              error={errors.EndDate}
            />

            <FormNumberInput
              label="Budget (INR)"
              value={formData.Budget}
              onChange={(e) => handleInputChange("Budget", e.target.value)}
              placeholder="Enter budget amount"
              error={errors.Budget}
              min={0}
              step={1000}
            />

            <FormNumberInput
              label="Progress (%)"
              value={formData.Progress}
              onChange={(e) => handleInputChange("Progress", e.target.value)}
              placeholder="Enter progress percentage"
              error={errors.Progress}
              min={0}
              max={100}
              step={1}
            />
          </FormRow>

          {/* Additional Information Row */}
          {editingProject && (
            <FormRow columns={3}>
              <div className="bg-gray-50 p-3 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Created Date
                </label>
                <div className="text-sm text-gray-600">
                  {editingProject.CreatedDate
                    ? dayjs(editingProject.CreatedDate).format("DD-MM-YYYY")
                    : "N/A"}
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Task Count
                </label>
                <div className="text-sm text-gray-600">
                  {editingProject.TaskCount || 0} tasks
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project ID
                </label>
                <div className="text-sm text-gray-600">
                  #{editingProject.Id}
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
        submitText={editingProject ? "Update Project" : "Create Project"}
        isLoading={isLoading}
      />
    </FormModal>
  );
};

export default ProjectForm;
