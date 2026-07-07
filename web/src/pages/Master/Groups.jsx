// src/pages/Master/Groups.jsx
//
// Roles & Permissions admin: left panel lists user groups (roles) with
// create/edit/delete; right panel edits the selected group's menu-access
// matrix (View / Add / Edit / Delete per menu). Backend contract:
//   fetchUserGroups / saveUserGroup / deleteUserGroup
//   fetchGroupAccess { GroupId } -> { access: [...] }
//   saveGroupAccess  { GroupId, Access: [{ MenuId, CanView, CanAdd, CanEdit, CanDelete }] }
import React, { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { Pencil, Trash2 } from "lucide-react";
import { useTheme } from "@mui/material/styles";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/PageHeader";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import {
  Button,
  IconButton,
  Checkbox,
  Modal,
  TextInput,
  TextArea,
  EmptyState,
} from "../../components/ui";

import useApi from "../../hooks/useApi";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useConfirmation } from "../../hooks";

const emptyForm = { Id: 0, Name: "", Description: "", IsActive: true };

const PERMS = [
  { field: "CanView", label: "View" },
  { field: "CanAdd", label: "Add" },
  { field: "CanEdit", label: "Edit" },
  { field: "CanDelete", label: "Delete" },
];

const Groups = () => {
  const theme = useTheme();
  const p = theme.tokens;
  const apiClient = useApi();
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();

  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [access, setAccess] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  const groupsQuery = useApiQuery({
    queryKey: ["userGroups"],
    endpoint: "/api/user-groups/fetchUserGroups",
    params: {},
  });
  const groups = groupsQuery.data?.userGroups || [];

  const accessQuery = useApiQuery({
    queryKey: ["groupAccess", selectedGroupId],
    endpoint: "/api/user-groups/fetchGroupAccess",
    params: { GroupId: selectedGroupId },
    enabled: !!selectedGroupId,
  });

  // Seed local editable matrix whenever a fresh matrix loads.
  useEffect(() => {
    const rows = accessQuery.data?.access;
    if (rows) setAccess(rows.map((r) => ({ ...r })));
  }, [accessQuery.data]);

  const selectedGroup = groups.find((g) => g.Id === selectedGroupId) || null;

  const openCreate = () => {
    setForm(emptyForm);
    setFormError("");
    setIsModalOpen(true);
  };

  const openEdit = (group) => {
    setForm({
      Id: group.Id,
      Name: group.Name || "",
      Description: group.Description || "",
      IsActive: group.IsActive ?? true,
    });
    setFormError("");
    setIsModalOpen(true);
  };

  const submitGroup = async () => {
    if (!form.Name.trim()) {
      setFormError("Name is required");
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiClient.post("/api/user-groups/saveUserGroup", {
        Id: form.Id || 0,
        Name: form.Name.trim(),
        Description: form.Description?.trim() || "",
        IsActive: form.IsActive,
      });
      if (res.data.success) {
        enqueueSnackbar(`Group ${form.Id ? "updated" : "created"} successfully!`, {
          variant: "success",
        });
        setIsModalOpen(false);
        groupsQuery.refetch();
      } else {
        enqueueSnackbar(res.data.message || "Failed to save group", { variant: "error" });
      }
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to save group", {
        variant: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (group) => {
    confirmation.confirmDelete({
      title: "Delete Group",
      message: `Are you sure you want to delete "${group.Name}"? This action cannot be undone.`,
      confirmText: "Delete Group",
      onConfirm: async () => {
        const res = await apiClient.post("/api/user-groups/deleteUserGroup", { Id: group.Id });
        if (res.data.success) {
          enqueueSnackbar("Group deleted successfully!", { variant: "success" });
          if (selectedGroupId === group.Id) setSelectedGroupId(null);
          groupsQuery.refetch();
        } else {
          enqueueSnackbar(res.data.message || "Failed to delete group", { variant: "error" });
        }
      },
    });
  };

  // Toggle one cell. Toggling a parent's View cascades to its children.
  const toggleCell = (menuId, field) => {
    setAccess((prev) => {
      const target = prev.find((r) => r.MenuId === menuId);
      if (!target) return prev;
      const newVal = !target[field];
      return prev.map((r) => {
        if (r.MenuId === menuId) return { ...r, [field]: newVal };
        if (field === "CanView" && r.ParentId === menuId) return { ...r, CanView: newVal };
        return r;
      });
    });
  };

  const savePermissions = async () => {
    setIsSaving(true);
    try {
      const res = await apiClient.post("/api/user-groups/saveGroupAccess", {
        GroupId: selectedGroupId,
        Access: access.map((r) => ({
          MenuId: r.MenuId,
          CanView: !!r.CanView,
          CanAdd: !!r.CanAdd,
          CanEdit: !!r.CanEdit,
          CanDelete: !!r.CanDelete,
        })),
      });
      if (res.data.success) {
        enqueueSnackbar("Permissions saved successfully!", { variant: "success" });
      } else {
        enqueueSnackbar(res.data.message || "Failed to save permissions", { variant: "error" });
      }
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to save permissions", {
        variant: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Create roles and choose which menus each role can access."
      />
      <Helmet>
        <title>PRD Infotech | Roles & Permissions</title>
      </Helmet>

      <Box sx={{ mt: 2, display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Left: groups list */}
        <Box
          sx={{
            width: 280,
            flexShrink: 0,
            border: `1px solid ${p.border.default}`,
            borderRadius: `${theme.radii.lg}px`,
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              p: 1.5,
              borderBottom: `1px solid ${p.border.subtle}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 600, color: p.text.primary }}>Roles</span>
            <Button size="sm" onClick={openCreate} data-testid="new-group-btn">
              New Group
            </Button>
          </Box>
          {groups.length === 0 ? (
            <Box sx={{ p: 2, fontSize: 13, color: p.text.tertiary }}>No roles yet.</Box>
          ) : (
            groups.map((g) => {
              const active = g.Id === selectedGroupId;
              return (
                <Box
                  key={g.Id}
                  data-testid={`group-item-${g.Id}`}
                  onClick={() => setSelectedGroupId(g.Id)}
                  sx={{
                    px: 1.5,
                    py: 1.25,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    cursor: "pointer",
                    borderBottom: `1px solid ${p.border.subtle}`,
                    backgroundColor: active ? p.primary.subtle : "transparent",
                    "&:hover": { backgroundColor: active ? p.primary.subtle : p.surface.subtle },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: p.text.primary, fontSize: 14 }}>
                      {g.Name}
                    </div>
                    {g.Description && (
                      <div style={{ fontSize: 12, color: p.text.tertiary }}>{g.Description}</div>
                    )}
                  </Box>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Edit ${g.Name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(g);
                    }}
                  >
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${g.Name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(g);
                    }}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </Box>
              );
            })
          )}
        </Box>

        {/* Right: permission matrix */}
        <Box sx={{ flex: 1, minWidth: 320 }}>
          {!selectedGroup ? (
            <EmptyState
              title="Select a role"
              description="Pick a role on the left to manage which menus it can access."
            />
          ) : (
            <Box>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1.5,
                  flexWrap: "wrap",
                  gap: 1,
                }}
              >
                <Box>
                  <div style={{ fontWeight: 700, fontSize: 16, color: p.text.primary }}>
                    {selectedGroup.Name} — Permissions
                  </div>
                  <div style={{ fontSize: 12, color: p.text.tertiary }}>
                    Users re-login to pick up permission changes.
                  </div>
                </Box>
                <Button
                  size="sm"
                  onClick={savePermissions}
                  loading={isSaving}
                  data-testid="save-permissions-btn"
                >
                  Save Permissions
                </Button>
              </Box>

              <Box sx={{ overflowX: "auto", border: `1px solid ${p.border.default}`, borderRadius: `${theme.radii.lg}px` }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ backgroundColor: p.surface.subtle }}>
                      <th style={{ textAlign: "left", padding: "10px 14px", color: p.text.secondary }}>
                        Menu
                      </th>
                      {PERMS.map((perm) => (
                        <th
                          key={perm.field}
                          style={{ padding: "10px 14px", width: 72, color: p.text.secondary }}
                        >
                          {perm.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {access.map((row) => {
                      const isParent = row.ParentId === 0;
                      return (
                        <tr key={row.MenuId} style={{ borderTop: `1px solid ${p.border.subtle}` }}>
                          <td
                            style={{
                              padding: "8px 14px",
                              paddingLeft: isParent ? 14 : 34,
                              fontWeight: isParent ? 600 : 500,
                              color: p.text.primary,
                            }}
                          >
                            {row.Title}
                          </td>
                          {PERMS.map((perm) => (
                            <td key={perm.field} style={{ textAlign: "center", padding: "8px 14px" }}>
                              <Checkbox
                                checked={!!row[perm.field]}
                                onChange={() => toggleCell(row.MenuId, perm.field)}
                                data-testid={`perm-${row.MenuId}-${perm.field}`}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Create / edit group modal */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} size="sm">
        <Modal.Header
          title={form.Id ? "Edit Group" : "New Group"}
          onClose={() => setIsModalOpen(false)}
        />
        <Modal.Body>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextInput
              label="Name"
              value={form.Name}
              onChange={(e) => setForm((f) => ({ ...f, Name: e.target.value }))}
              placeholder="e.g. Salesperson"
              error={formError}
              required
            />
            <TextArea
              label="Description"
              value={form.Description}
              onChange={(e) => setForm((f) => ({ ...f, Description: e.target.value }))}
              placeholder="Optional"
            />
            <Checkbox
              label="Active"
              checked={form.IsActive}
              onChange={(e) => setForm((f) => ({ ...f, IsActive: e.target.checked }))}
              data-testid="group-active"
            />
          </Box>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => setIsModalOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submitGroup}
            loading={isSaving}
            data-testid="save-group-btn"
          >
            {form.Id ? "Update Group" : "Create Group"}
          </Button>
        </Modal.Footer>
      </Modal>

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

export default Groups;
