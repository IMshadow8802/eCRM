//src/pages/Master/components/UserForm.jsx
import React, { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import useAuthStore from "../../../stores/useAuthStore";
import useApi from "../../../hooks/useApi";
import {
  FormModal,
  FormContainer,
  FormInput,
  FormSelect,
  FormNumberInput,
  FormCheckbox,
  FormButtons,
} from "../../../components/Design/FormComponents";

// Define validation schema with Zod
const userFormSchema = z.object({
  Username: z.string().min(1, "Username is required"),
  Password: z.string().min(6, "Password must be at least 6 characters"),
  FullName: z.string().min(1, "Full Name is required"),
  Email: z
    .string()
    .email("Please enter a valid email address")
    .optional()
    .or(z.literal("")),
  JobTitle: z.string().optional().or(z.literal("")),
  Mobile: z.string().optional().or(z.literal("")),
  HourlyRate: z.coerce.number().min(0, "Hourly rate must be positive").optional(),
  GroupId: z.number().optional(),
  UserActive: z.boolean().optional(),
  IsAdmin: z.boolean().optional(),
  AllowDay: z.coerce.number().optional(),
  UserIp: z.string().optional().or(z.literal("")),
});

const UserForm = ({
  open,
  onClose,
  editingUser = null,
  userGroups = [],
  onUserSaved,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const apiClient = useApi();
  const { CompId, BranchId, UserId } = useAuthStore();

  // Initialize default values
  const getDefaultValues = () => {
    if (editingUser) {
      return {
        ...editingUser,
        Password: "", // Don't populate password for editing
      };
    }

    return {
      Id: 0,
      Username: "",
      Password: "",
      FullName: "",
      Email: "",
      JobTitle: "",
      Mobile: "",
      HourlyRate: 0,
      GroupId: Array.isArray(userGroups) && userGroups.length > 0 && userGroups[0]?.Id ? userGroups[0].Id : 0,
      UserActive: true,
      IsAdmin: false,
      AllowDay: 0,
      UserIp: "",
    };
  };

  // Initialize React Hook Form
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
  } = useForm({
    resolver: zodResolver(userFormSchema),
    defaultValues: getDefaultValues(),
    mode: "onBlur",
  });

  // Set default values when data is available
  useEffect(() => {
    if (Array.isArray(userGroups) && userGroups.length > 0 && userGroups[0]?.Id && !editingUser) {
      setValue("GroupId", userGroups[0].Id);
    }
  }, [userGroups, editingUser, setValue]);

  // Reset form when editing user changes
  useEffect(() => {
    reset(getDefaultValues());
  }, [editingUser, userGroups]);

  // Form submission handler
  const onSubmit = async (data) => {
    try {
      const payload = {
        ...data,
        Id: editingUser ? editingUser.Id : 0,
        CompId: CompId,
        BranchId: BranchId,
        // Don't send password if editing and it's empty
        ...(editingUser && !data.Password && { Password: undefined }),
      };

      const response = await apiClient.post("/api/users/saveUser", payload);

      if (response.data.success) {
        enqueueSnackbar(
          `User ${editingUser ? "updated" : "created"} successfully!`,
          { variant: "success" }
        );
        
        // Invalidate related caches
        queryClient.invalidateQueries({ queryKey: ["users"] });
        queryClient.invalidateQueries({ queryKey: ["teams"] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        
        handleClose();
        if (onUserSaved) onUserSaved();
      } else {
        enqueueSnackbar(
          response.data.message || `Failed to ${editingUser ? "update" : "create"} user!`,
          { variant: "error" }
        );
      }
    } catch (error) {
      console.error("Error saving user:", error);
      enqueueSnackbar(
        `Failed to ${editingUser ? "update" : "create"} user: ${error.message || "Unknown error"}`,
        { variant: "error" }
      );
    }
  };

  const handleClose = () => {
    reset(getDefaultValues());
    onClose();
  };

  // Helper to get user group options
  const getUserGroupOptions = () => {
    if (!Array.isArray(userGroups) || userGroups.length === 0) return [];
    return userGroups.map((group) => {
      if (!group || group.Id === undefined || !group.Name) {
        return { value: "", label: "Invalid Group" };
      }
      return {
        value: group.Id.toString(),
        label: group.Name,
      };
    });
  };

  return (
    <FormModal open={open} title={`${editingUser ? "Edit" : "Create"} User`} maxWidth="max-w-4xl">
      {/* Content */}
      <div className="p-6">
        <FormContainer spacing="space-y-4">
          {/* Row 1: Username, Full Name */}
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="Username"
              render={({ field }) => (
                <FormInput
                  label="Username"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Enter username"
                  error={errors.Username?.message}
                  required
                />
              )}
            />
            <Controller
              control={control}
              name="FullName"
              render={({ field }) => (
                <FormInput
                  label="Full Name"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Enter full name"
                  error={errors.FullName?.message}
                  required
                />
              )}
            />
          </div>

          {/* Row 2: Password, Email */}
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="Password"
              render={({ field }) => (
                <FormInput
                  label={`Password ${editingUser ? "(leave empty to keep current)" : ""}`}
                  type="password"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={editingUser ? "Enter new password" : "Enter password"}
                  error={errors.Password?.message}
                  required={!editingUser}
                />
              )}
            />
            <Controller
              control={control}
              name="Email"
              render={({ field }) => (
                <FormInput
                  label="Email"
                  type="email"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Enter email address"
                  error={errors.Email?.message}
                />
              )}
            />
          </div>

          {/* Row: Mobile (a login identifier) */}
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="Mobile"
              render={({ field }) => (
                <FormInput
                  label="Mobile"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Enter mobile number"
                  error={errors.Mobile?.message}
                />
              )}
            />
          </div>

          {/* Row 3: Job Title, User Group */}
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="JobTitle"
              render={({ field }) => (
                <FormInput
                  label="Job Title"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Enter job title"
                  error={errors.JobTitle?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="GroupId"
              render={({ field }) => (
                <FormSelect
                  label="User Group"
                  value={field.value?.toString() || ""}
                  onChange={(e) => field.onChange(parseInt(e.target.value))}
                  onBlur={field.onBlur}
                  options={getUserGroupOptions()}
                  placeholder="Select user group"
                  error={errors.GroupId?.message}
                  required
                />
              )}
            />
          </div>

          {/* Row 4: Hourly Rate, Allow Days */}
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="HourlyRate"
              render={({ field }) => (
                <FormNumberInput
                  label="Hourly Rate"
                  value={field.value}
                  onChange={(e) => {
                    const value = e.target.value === "" ? 0 : e.target.value;
                    field.onChange(value);
                  }}
                  onBlur={field.onBlur}
                  placeholder="Enter hourly rate"
                  error={errors.HourlyRate?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="AllowDay"
              render={({ field }) => (
                <FormNumberInput
                  label="Allow Days"
                  value={field.value}
                  onChange={(e) => {
                    const value = e.target.value === "" ? 0 : e.target.value;
                    field.onChange(value);
                  }}
                  onBlur={field.onBlur}
                  placeholder="Enter allowed days"
                  error={errors.AllowDay?.message}
                />
              )}
            />
          </div>

          {/* Row 5: IP Address */}
          <div className="grid grid-cols-1 gap-4">
            <Controller
              control={control}
              name="UserIp"
              render={({ field }) => (
                <FormInput
                  label="User IP Address"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Enter IP address (optional)"
                  error={errors.UserIp?.message}
                />
              )}
            />
          </div>

          {/* Row 6: Checkboxes */}
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="UserActive"
              render={({ field }) => (
                <FormCheckbox
                  label="User Active"
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={control}
              name="IsAdmin"
              render={({ field }) => (
                <FormCheckbox
                  label="Is Admin"
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
        </FormContainer>
      </div>

      {/* Footer */}
      <FormButtons
        onCancel={handleClose}
        onSubmit={handleSubmit(onSubmit)}
        submitText={editingUser ? "Update User" : "Create User"}
        isLoading={isSubmitting}
      />
    </FormModal>
  );
};

export default UserForm;