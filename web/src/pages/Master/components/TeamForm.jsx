// src/pages/Master/components/TeamForm.jsx
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
  FormMultiSelect,
  FormButtons,
} from "../../../components/Design/FormComponents";
import { toUserOptions, getUserId } from "../../../utils/userShape";

// Zod validation schema
const teamSchema = z.object({
  Name: z.string().min(1, "Team name is required"),
  Description: z.string().optional(),
  LeadUserId: z.string().optional(),
  Color: z.string().min(1, "Color is required"),
  Members: z.array(z.number()).optional(),
  IsActive: z.boolean(),
});

const TeamForm = ({
  open,
  onClose,
  editingTeam = null,
  users = [],
  onTeamSaved,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { CompId, BranchId, UserId } = useAuthStore();

  const [formData, setFormData] = useState({
    Name: "",
    Description: "",
    LeadUserId: "",
    Color: "#3B82F6",
    Members: [],
    IsActive: true,
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Color options
  const colorOptions = [
    { value: "#3B82F6", label: "Blue" },
    { value: "#10B981", label: "Green" },
    { value: "#F59E0B", label: "Orange" },
    { value: "#EF4444", label: "Red" },
    { value: "#8B5CF6", label: "Purple" },
    { value: "#06B6D4", label: "Cyan" },
    { value: "#84CC16", label: "Lime" },
    { value: "#F97316", label: "Orange" },
    { value: "#EC4899", label: "Pink" },
    { value: "#6B7280", label: "Gray" },
  ];

  // Set form data when editing team changes
  useEffect(() => {
    if (editingTeam) {
      // Parse existing members if they exist
      let members = [];
      try {
        if (editingTeam.Members && typeof editingTeam.Members === 'string') {
          members = JSON.parse(editingTeam.Members);
        } else if (Array.isArray(editingTeam.Members)) {
          members = editingTeam.Members;
        }
      } catch (error) {
        console.warn("Error parsing team members:", error);
        members = [];
      }

      setFormData({
        Name: editingTeam.Name || "",
        Description: editingTeam.Description || "",
        LeadUserId: editingTeam.LeadUserId?.toString() || "",
        Color: editingTeam.Color || "#3B82F6",
        Members: members.map((m) => (typeof m === "object" ? getUserId(m) : m)),
        IsActive:
          editingTeam.IsActive !== undefined ? editingTeam.IsActive : true,
      });
    } else {
      // Reset form for new team
      setFormData({
        Name: "",
        Description: "",
        LeadUserId: "",
        Color: "#3B82F6",
        Members: [],
        IsActive: true,
      });
    }
  }, [editingTeam]);

  const validateForm = () => {
    try {
      teamSchema.parse({
        ...formData,
        Members: formData.Members.map(m => parseInt(m)),
        IsActive: Boolean(formData.IsActive),
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

    setIsLoading(true);
    try {
      const teamData = {
        Id: editingTeam?.Id || 0,
        Name: formData.Name,
        Description: formData.Description,
        LeadUserId: formData.LeadUserId ? parseInt(formData.LeadUserId) : null,
        Color: formData.Color,
        Members: formData.Members.map(m => parseInt(m)),
        IsActive: Boolean(formData.IsActive),
        BranchId: BranchId,
        CompId: CompId,
      };

      const response = await apiClient.post("/api/teams/saveTeam", teamData);

      if (response.data.success) {
        enqueueSnackbar(
          `Team ${editingTeam ? "updated" : "created"} successfully!`,
          { variant: "success" }
        );
        
        // Invalidate related caches
        queryClient.invalidateQueries({ queryKey: ["teams"] });
        queryClient.invalidateQueries({ queryKey: ["users"] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        
        handleClose();
        if (onTeamSaved) {
          onTeamSaved(); // Refresh the teams list
        }
      } else {
        enqueueSnackbar(
          `Failed to ${editingTeam ? "update" : "create"} team: ${
            response.data.message
          }`,
          { variant: "error" }
        );
      }
    } catch (error) {
      console.error("Error saving team:", error);
      enqueueSnackbar(
        `Error ${editingTeam ? "updating" : "creating"} team: ${error.message}`,
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
      LeadUserId: "",
      Color: "#3B82F6",
      Members: [],
      IsActive: true,
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

  const userOptions = toUserOptions(users);

  const statusOptions = [
    { value: true, label: "Active" },
    { value: false, label: "Inactive" },
  ];

  return (
    <FormModal
      open={open}
      title={editingTeam ? "Edit Team" : "Create Team"}
      maxWidth="max-w-4xl"
    >
      {/* Content */}
      <div className="p-6">
        <FormContainer spacing="space-y-3">
          {/* First Row - Team Name, Team Lead */}
          <FormRow columns={2}>
            <FormInput
              label="Team Name"
              value={formData.Name}
              onChange={(e) => handleInputChange("Name", e.target.value)}
              placeholder="Enter team name"
              error={errors.Name}
              required
            />

            <FormSelect
              label="Team Lead"
              value={formData.LeadUserId}
              onChange={(e) => handleInputChange("LeadUserId", e.target.value)}
              options={userOptions}
              placeholder="Select team lead (optional)"
              error={errors.LeadUserId}
            />
          </FormRow>

          {/* Second Row - Color, Status */}
          <FormRow columns={2}>
            <FormSelect
              label="Team Color"
              value={formData.Color}
              onChange={(e) => handleInputChange("Color", e.target.value)}
              options={colorOptions}
              placeholder="Select team color"
              error={errors.Color}
              required
            />

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

          {/* Third Row - Team Members */}
          <FormRow columns={1}>
            <FormMultiSelect
              label="Team Members"
              value={formData.Members}
              onChange={(value) => handleInputChange("Members", value)}
              options={userOptions}
              placeholder="Select team members (optional)"
              error={errors.Members}
              maxHeight="max-h-48"
            />
          </FormRow>

          {/* Fourth Row - Description */}
          <FormRow columns={1}>
            <FormTextarea
              label="Team Description"
              value={formData.Description}
              onChange={(e) => handleInputChange("Description", e.target.value)}
              placeholder="Enter team description"
              rows={3}
              error={errors.Description}
            />
          </FormRow>

          {/* Additional Information Row */}
          {editingTeam && (
            <FormRow columns={3}>
              <div className="bg-gray-50 p-3 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Team ID
                </label>
                <div className="text-sm text-gray-600">#{editingTeam.Id}</div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Member Count
                </label>
                <div className="text-sm text-gray-600">
                  {editingTeam.MemberCount || 0} members
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
                    {formData.Color}
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
        submitText={editingTeam ? "Update Team" : "Create Team"}
        isLoading={isLoading}
      />
    </FormModal>
  );
};

export default TeamForm;
