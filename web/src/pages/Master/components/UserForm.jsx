//src/pages/Master/components/UserForm.jsx
import React, { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import useAuthStore from "../../../stores/useAuthStore";
import { Link } from "react-router-dom";
import {
  saveUser,
  fetchUserHandover,
  saveUserBranchAccess,
  deleteUserBranchAccess,
  MASTER_ENDPOINTS,
} from "../../../api/masterQueries";
import { useIsAdmin, useCanSeeSensitive } from "../../../hooks/useAccess";
import { toTree } from "../../../utils/officeTree";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { useConfirmation } from "../../../hooks/useConfirmation";
import ConfirmationDialog from "../../../components/ConfirmationDialog";
import { useApiQuery } from "../../../hooks/useApiQuery";
import {
  FormModal,
  FormContainer,
  FormInput,
  FormSelect,
  FormMultiSelect,
  FormNumberInput,
  FormCheckbox,
  FormButtons,
} from "../../../components/Design/FormComponents";

// Define validation schema with Zod.
//
// Password is required only when creating. On edit a blank field means "keep
// the current password" — the label has always promised that, but the rule was
// unconditional, so editing anything about a user was impossible without also
// retyping their password.
const buildUserFormSchema = (isEditing) =>
  z.object({
  Username: z.string().min(1, "Username is required"),
  Password: isEditing
    ? z
        .string()
        .min(6, "Password must be at least 6 characters")
        .optional()
        .or(z.literal(""))
    : z.string().min(6, "Password must be at least 6 characters"),
  FullName: z.string().min(1, "Full Name is required"),
  Email: z
    .string()
    .email("Please enter a valid email address")
    .optional()
    .or(z.literal("")),
  JobTitle: z.string().optional().or(z.literal("")),
  Mobile: z.string().optional().or(z.literal("")),
  HourlyRate: z.coerce.number().min(0, "Hourly rate must be positive").optional(),
  GroupId: z.number({ error: "Pick a role" }).int().positive("Pick a role"),
  BranchId: z.number({ error: "Pick an office" }).int().positive("Pick an office"),
  UserActive: z.boolean().optional(),
  AllowDay: z.coerce.number().optional(),
  UserIp: z.string().optional().or(z.literal("")),
  ReportsTo: z.number().nullable().optional(),
  });

// What the user still holds, shown before an admin confirms deactivation.
// handover === null means the lookup failed: say so, never block the admin.
const HandoverSummary = ({ userId, handover }) => {
  if (!handover) return <p>Couldn't load what this user holds.</p>;
  const { OpenTasks, OpenLeads, OpenTickets, OwnedWorkspaces, DirectReports, workspaces = [], reports = [] } = handover;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const lines = [
    OpenTasks > 0 && (
      <li key="t">{plural(OpenTasks, "open task", "open tasks")} will be unassigned. Their workspace owners are told.</li>
    ),
    OpenLeads > 0 && (
      <li key="l">{plural(OpenLeads, "open lead", "open leads")} <Link to={`/sales/leads?OwnerId=${userId}`}>Transfer</Link></li>
    ),
    OpenTickets > 0 && (
      <li key="c">{plural(OpenTickets, "open complaint", "open complaints")} <Link to={`/support/tickets?AssignedTo=${userId}`}>Transfer</Link></li>
    ),
    OwnedWorkspaces > 0 && (
      <li key="w">{plural(OwnedWorkspaces, "workspace", "workspaces")} they own: {workspaces.map((w) => w.Name).join(", ")}</li>
    ),
    DirectReports > 0 && (
      <li key="r">{plural(DirectReports, "person reports", "people report")} to them: {reports.map((r) => r.FullName).join(", ")}</li>
    ),
  ].filter(Boolean);
  if (!lines.length) return <p>Nothing assigned.</p>;
  return (
    <div>
      <ul className="list-disc pl-5">{lines}</ul>
      <p className="mt-2">They keep ownership of leads, complaints and workspaces until you transfer them.</p>
    </div>
  );
};

const UserForm = ({
  open,
  onClose,
  editingUser = null,
  userGroups = [],
  onUserSaved,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const { BranchId } = useAuthStore();
  const confirmation = useConfirmation();
  const isAdmin = useIsAdmin();
  const canSeeSensitive = useCanSeeSensitive();

  // The reporting line: one manager per user (Zoho / Salesforce "Reports To").
  // Drives Team-scope visibility and, in spec 2, escalation. A user cannot
  // report to themselves; the SP also refuses any loop further up.
  const { data: directoryData } = useApiQuery({
    queryKey: ["userDirectory"],
    endpoint: MASTER_ENDPOINTS.users.directory,
    params: {},
    staleTime: 10 * 60 * 1000,
    showErrorMessage: false,
  });
  const reportsToOptions = (directoryData?.users ?? [])
    .filter((u) => u.Id !== editingUser?.Id)
    .map((u) => ({ value: String(u.Id), label: u.FullName }));

  const { data: branchData } = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    params: {},
    showErrorMessage: false,
  });
  // Offices in tree order, indented by depth. Inactive ones are not offered,
  // except the one the edited user already sits in (else the field blanks).
  const offices = toTree(branchData?.branches ?? []).filter(
    (b) => (b.IsActive !== false && b.IsActive !== 0) || b.Id === editingUser?.BranchId
  );
  const branchOptions = offices.map((b) => ({
    value: String(b.Id),
    label: `${"— ".repeat(b.depth)}${b.BranchName}`,
  }));

  // Extra offices (admin only): tblUserBranchAccess rows beyond the user's own
  // office. Loaded for an edit; diffed against on save.
  const { data: grantData } = useApiQuery({
    queryKey: ["userBranchAccess", editingUser?.Id],
    endpoint: MASTER_ENDPOINTS.userBranchAccess.fetchUserBranchAccess,
    params: { UserId: editingUser?.Id, PageSize: 200 },
    enabled: isAdmin && Boolean(editingUser?.Id),
    showErrorMessage: false,
  });
  const loadedGrants = editingUser ? grantData?.branchAccess ?? [] : [];
  // Until the grants arrive the picker is locked, so a late response cannot
  // overwrite what the admin has already picked.
  const grantsLoading = isAdmin && Boolean(editingUser?.Id) && !grantData;
  // Keyed on the ids, not the array: a refetch that returns the same grants
  // must not wipe what the admin has picked so far.
  const grantKey = loadedGrants.map((g) => g.BranchId).join(",");
  const [extraOffices, setExtraOffices] = useState([]);
  const seedExtraOffices = () => setExtraOffices(grantKey ? grantKey.split(",") : []);
  useEffect(seedExtraOffices, [grantKey]);

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
      BranchId: BranchId,
      AllowDay: 0,
      UserIp: "",
      ReportsTo: null,
    };
  };

  // Initialize React Hook Form
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    watch,
  } = useForm({
    resolver: zodResolver(buildUserFormSchema(Boolean(editingUser))),
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

  // Grant the added extra offices and revoke the removed ones. The user's own
  // (home) office is implied, so it is never granted and never revoked here.
  const syncExtraOffices = async (userId, ownBranchId) => {
    const wanted = new Set(extraOffices.map(Number).filter((id) => id !== ownBranchId));
    const had = new Set(loadedGrants.map((g) => g.BranchId));
    const calls = [
      ...[...wanted]
        .filter((id) => !had.has(id))
        .map((BranchId) => saveUserBranchAccess({ UserId: userId, BranchId, CanRead: 1, CanWrite: 1 })),
      ...loadedGrants
        .filter((g) => !wanted.has(g.BranchId) && g.BranchId !== ownBranchId)
        .map((g) => deleteUserBranchAccess({ Id: g.Id })),
    ];
    try {
      await Promise.all(calls);
    } catch (err) {
      enqueueSnackbar(
        `User saved, but extra offices were not updated: ${err.response?.data?.message || err.message}`,
        { variant: "warning" }
      );
    }
    queryClient.invalidateQueries({ queryKey: ["userBranchAccess"] });
  };

  // Save + toast. Throws on failure when `rethrow` so a confirm dialog stays open.
  const doSave = async (payload) => {
    try {
      const response = await saveUser(payload);

      if (response.data.success) {
        if (isAdmin) {
          await syncExtraOffices(editingUser?.Id ?? response.data.data?.userId, payload.BranchId);
        }
        const n = response.data.data?.unassignedTasks;
        enqueueSnackbar(
          `User ${editingUser ? "updated" : "created"} successfully!` +
            (n > 0 ? ` ${n} open task${n === 1 ? " was" : "s were"} unassigned.` : ""),
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
      // The SP refuses with a real 4xx + message (loop, last admin, ...).
      // Axios rejects with it under error.response.data.message.
      const reason =
        error.response?.data?.message || error.message || "Unknown error";
      enqueueSnackbar(
        `Failed to ${editingUser ? "update" : "create"} user: ${reason}`,
        { variant: "error" }
      );
    }
  };

  const onSubmit = async (data) => {
    // BranchId comes from the form (the user's own on edit), never the auth store.
    const payload = {
      ...data,
      Id: editingUser ? editingUser.Id : 0,
      // On edit, null means "keep the manager", so a cleared field must send 0.
      ReportsTo: data.ReportsTo ?? (editingUser ? 0 : null),
      // Don't send password if editing and it's empty
      ...(editingUser && !data.Password && { Password: undefined }),
    };
    // Salary and contact fields are not shown without the permission, so they
    // are not sent either (the server refuses such a save for a non-admin).
    if (!canSeeSensitive) {
      delete payload.Email;
      delete payload.Mobile;
      delete payload.HourlyRate;
    }
    const deactivating = Boolean(editingUser?.UserActive) && data.UserActive === false;
    if (!deactivating) return doSave(payload);

    let handover = null;
    try {
      handover = (await fetchUserHandover({ Id: editingUser.Id })).data?.data?.handover ?? null;
    } catch {
      // shown as "couldn't load"; a lookup must not block the admin
    }
    confirmation.confirmAction({
      title: "Deactivate user",
      message: <HandoverSummary userId={editingUser.Id} handover={handover} />,
      confirmText: "Deactivate",
      onConfirm: () => doSave(payload),
    });
  };

  const handleClose = () => {
    reset(getDefaultValues());
    seedExtraOffices(); // the modal stays mounted; a later open must not inherit picks
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
    <FormModal
      open={open}
      onClose={handleClose}
      title={`${editingUser ? "Edit" : "Create"} User`}
      maxWidth="max-w-4xl"
    >
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
            {canSeeSensitive && (
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
            )}
          </div>

          {/* Row: Mobile (a login identifier) */}
          {canSeeSensitive && (
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
          )}

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

          {/* Row: Reports To */}
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="BranchId"
              render={({ field }) => (
                <FormSelect
                  label="Office"
                  value={field.value ? String(field.value) : ""}
                  onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                  onBlur={field.onBlur}
                  options={branchOptions}
                  placeholder="Select office"
                  error={errors.BranchId?.message}
                  required
                />
              )}
            />
            <Controller
              control={control}
              name="ReportsTo"
              render={({ field }) => (
                <FormSelect
                  label="Reports To"
                  value={field.value == null ? "" : String(field.value)}
                  onChange={(e) => field.onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
                  onBlur={field.onBlur}
                  options={reportsToOptions}
                  placeholder="No manager (top of the chain)"
                  error={errors.ReportsTo?.message}
                />
              )}
            />
          </div>

          {/* Extra offices: admin only, widens what an Office-reach role sees */}
          {isAdmin && (
            <div className="grid grid-cols-1 gap-4">
              <FormMultiSelect
                label="Extra offices"
                value={extraOffices}
                onChange={setExtraOffices}
                options={branchOptions.filter((o) => Number(o.value) !== watch("BranchId"))}
                placeholder="Other offices this person also works in"
                disabled={grantsLoading}
              />
            </div>
          )}

          {/* Row 4: Hourly Rate, Allow Days */}
          <div className="grid grid-cols-2 gap-4">
            {canSeeSensitive && (
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
            )}
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
    </FormModal>
  );
};

export default UserForm;