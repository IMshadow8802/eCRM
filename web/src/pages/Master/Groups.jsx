// src/pages/Master/Groups.jsx
//
// Roles & Permissions admin: left panel lists user groups (roles) with
// create/edit/delete; right panel edits the selected role's module grid
// (View / Add / Edit / Delete per module, plus a reach on record modules) and
// its "can see salary & contact details" flag. Backend contract:
//   fetchUserGroups / saveUserGroup / deleteUserGroup
//   fetchGroupModules { GroupId }
//     -> { modules: [{ Module, CanView, CanAdd, CanEdit, CanDelete, Reach }], canSeeSensitive, isAdmin }
//   saveGroupModules { GroupId, Modules: [...viewed rows only], CanSeeSensitive }
// An admin role has every right; the server ignores its grid, so none is shown.
import React, { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { Pencil, Trash2 } from "lucide-react";
import { useTheme } from "@mui/material/styles";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/ui/PageHeader";
import Tooltip from "../../components/ui/Tooltip";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import {
  Button,
  IconButton,
  Checkbox,
  Modal,
  TextInput,
  Combobox,
  TextArea,
  EmptyState,
} from "../../components/ui";

import {
  MASTER_ENDPOINTS,
  saveUserGroup,
  deleteUserGroup,
  saveGroupModules,
} from "../../api/masterQueries";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useConfirmation } from "../../hooks";

const emptyForm = { Id: 0, Name: "", Description: "", IsActive: true };

const PERMS = [
  { field: "CanView", label: "View" },
  { field: "CanAdd", label: "Add" },
  { field: "CanEdit", label: "Edit" },
  { field: "CanDelete", label: "Delete" },
];

// Roles and Offices are admin-only and never granted, so they have no row.
const MODULE_ROWS = [
  { key: "leads", label: "Leads, follow-ups, quotations", reach: true },
  { key: "sales_reports", label: "Sales reports" },
  { key: "partners", label: "Partners & commission" },
  { key: "complaints", label: "Complaints", reach: true },
  { key: "support_reports", label: "Support reports" },
  { key: "customers", label: "Customers", reach: true },
  { key: "people", label: "People", reach: true },
  { key: "tasks", label: "Tasks & My Work" },
  { key: "teams", label: "Teams" },
  { key: "projects", label: "Projects" },
  { key: "attendance", label: "Attendance (team presence)", reach: true },
  { key: "settings", label: "Settings & products" },
  { key: "dashboard", label: "Dashboard" },
];
// Plain-words help for modules whose name alone does not say what they grant.
const ROW_HINT = {
  partners: "View: see partners, commission terms and amounts. Add/Edit: add or change partners, mark commission ready to pay or paid. Salespeople pick a partner on a lead without this.",
  attendance: "Attendance: see who is signed in, late or on leave (Today > My team), mark leave or on duty, and open the Attendance report. "
    + "Reach decides whose attendance this role can see on the Today page and in the Attendance report. Own: only themselves. Their team: people who report to them. Their office: everyone in their office. Their office + offices below: also the offices under it. Whole company: everyone.",
};
const REACH_OPTIONS = [
  { value: "Own", label: "Own records" },
  { value: "Team", label: "Their team" },
  { value: "Office", label: "Their office" },
  { value: "OfficeTree", label: "Their office + offices below" },
  { value: "Company", label: "Whole company" },
];
const REACH_ROW = new Set(MODULE_ROWS.filter((m) => m.reach).map((m) => m.key));
const EMPTY_ROW = { CanView: false, CanAdd: false, CanEdit: false, CanDelete: false, Reach: null };

// One editable row per grantable module, seeded from what the server holds.
const seedRows = (modules = []) =>
  MODULE_ROWS.map(({ key }) => {
    const m = modules.find((x) => x.Module === key);
    if (!m) return { Module: key, ...EMPTY_ROW };
    return {
      Module: key,
      CanView: !!m.CanView,
      CanAdd: !!m.CanAdd,
      CanEdit: !!m.CanEdit,
      CanDelete: !!m.CanDelete,
      Reach: REACH_ROW.has(key) ? m.Reach || "Own" : null,
    };
  });

// Add/Edit/Delete imply View; dropping View drops the whole row.
const toggle = (row, field) => {
  const on = !row[field];
  if (field === "CanView" && !on) return { ...row, ...EMPTY_ROW };
  const next = { ...row, [field]: on, CanView: row.CanView || on };
  if (next.CanView && REACH_ROW.has(row.Module) && !next.Reach) next.Reach = "Own";
  return next;
};

const Groups = () => {
  const theme = useTheme();
  const p = theme.tokens;
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();

  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [rows, setRows] = useState(seedRows());
  const [canSeeSensitive, setCanSeeSensitive] = useState(false);
  // Which role `rows` belong to. The grid renders only when this matches the
  // selected role, so another role's rows (or edits) are never shown or saved.
  const [seededFor, setSeededFor] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const groupsQuery = useApiQuery({
    queryKey: ["userGroups"],
    endpoint: MASTER_ENDPOINTS.userGroups.fetchUserGroups,
    params: {},
  });
  const groups = groupsQuery.data?.userGroups || [];

  const modulesQuery = useApiQuery({
    queryKey: ["groupModules", selectedGroupId],
    endpoint: MASTER_ENDPOINTS.userGroups.fetchGroupModules,
    params: { GroupId: selectedGroupId },
    enabled: !!selectedGroupId,
    refetchOnWindowFocus: false,
  });
  const modulesData = modulesQuery.isLoading ? undefined : modulesQuery.data;
  const ready = !!modulesData && seededFor === selectedGroupId;
  const roleIsAdmin = ready && !!modulesData.isAdmin;

  // Seed once per role selection. A background refetch of the same role must
  // not wipe unsaved edits; choosing a role again re-seeds from the cache.
  useEffect(() => {
    if (!modulesData || seededFor === selectedGroupId) return;
    setRows(seedRows(modulesData.modules));
    setCanSeeSensitive(!!modulesData.canSeeSensitive);
    setSeededFor(selectedGroupId);
  }, [modulesData, selectedGroupId, seededFor]);

  const selectGroup = (id) => {
    setSelectedGroupId(id);
    setSeededFor(null);
  };

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
      const res = await saveUserGroup({
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
        const res = await deleteUserGroup({ Id: group.Id });
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

  const toggleCell = (module, field) =>
    setRows((prev) => prev.map((r) => (r.Module === module ? toggle(r, field) : r)));
  const setReach = (module, opt) =>
    setRows((prev) =>
      prev.map((r) => (r.Module === module ? { ...r, Reach: opt.value } : r))
    );

  const savePermissions = async () => {
    setIsSaving(true);
    try {
      const res = await saveGroupModules({
        GroupId: selectedGroupId,
        Modules: rows.filter((r) => r.CanView),
        CanSeeSensitive: canSeeSensitive,
      });
      if (res.data.success) {
        enqueueSnackbar("Permissions saved successfully!", { variant: "success" });
        // Refresh the cache so coming back to this role shows what was saved.
        modulesQuery.refetch();
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
        subtitle="Create roles and choose what each role can see and do."
      />
      <Helmet>
        <title>PRD Infotech | Roles & Permissions</title>
      </Helmet>

      <Box sx={{ mt: 2, display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Left: groups list */}
        <Box
          sx={{
            width: { xs: "100%", sm: 280 },
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
          {groupsQuery.isError ? (
            <EmptyState
              title="Couldn't load roles"
              action={
                <Button size="sm" variant="ghost" onClick={() => groupsQuery.refetch()} data-testid="roles-retry">
                  Retry
                </Button>
              }
            />
          ) : groups.length === 0 ? (
            <Box sx={{ p: 2, fontSize: 13, color: p.text.tertiary }}>No roles yet.</Box>
          ) : (
            groups.map((g) => {
              const active = g.Id === selectedGroupId;
              return (
                <Box
                  key={g.Id}
                  data-testid={`group-item-${g.Id}`}
                  onClick={() => selectGroup(g.Id)}
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
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!selectedGroup ? (
            <EmptyState
              title="Select a role"
              description="Pick a role on the left to set what it can see and do."
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
                    Changes apply on the user's next action.
                  </div>
                </Box>
                {ready && !roleIsAdmin && (
                  <Button
                    size="sm"
                    onClick={savePermissions}
                    loading={isSaving}
                    data-testid="save-permissions-btn"
                  >
                    Save Permissions
                  </Button>
                )}
              </Box>

              {modulesQuery.isError ? (
                <EmptyState
                  title="Couldn't load this role's permissions"
                  action={
                    <Button size="sm" variant="ghost" onClick={() => modulesQuery.refetch()}>
                      Try again
                    </Button>
                  }
                />
              ) : !ready ? (
                <Box sx={{ p: 2, fontSize: 13, color: p.text.tertiary }}>Loading permissions…</Box>
              ) : roleIsAdmin ? (
                <EmptyState
                  title="Administrators can do everything; there is nothing to set."
                />
              ) : (
                <>
                  <Box sx={{ overflowX: "auto", border: `1px solid ${p.border.default}`, borderRadius: `${theme.radii.lg}px` }}>
                    {/* A grid of a module name, four checkboxes and a reach select
                        cannot usefully shrink; give it a floor so the pane scrolls. */}
                    <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr style={{ backgroundColor: p.surface.subtle }}>
                          <th style={{ textAlign: "left", padding: "10px 14px", color: p.text.secondary }}>
                            Module
                          </th>
                          {PERMS.map((perm) => (
                            <th
                              key={perm.field}
                              style={{ padding: "10px 14px", width: 72, color: p.text.secondary }}
                            >
                              {perm.label}
                            </th>
                          ))}
                          <th style={{ textAlign: "left", padding: "10px 14px", width: 240, color: p.text.secondary }}>
                            Reach
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {MODULE_ROWS.map(({ key, label, reach }) => {
                          const row = rows.find((r) => r.Module === key);
                          return (
                            <tr
                              key={key}
                              data-testid={`module-row-${key}`}
                              style={{ borderTop: `1px solid ${p.border.subtle}` }}
                            >
                              <td style={{ padding: "8px 14px", fontWeight: 500, color: p.text.primary }}>
                                <Tooltip title={ROW_HINT[key]}>
                                  <span tabIndex={ROW_HINT[key] ? 0 : undefined}>
                                    {reach && row.CanView ? <label htmlFor={`reach-${key}`}>{label}</label> : label}
                                  </span>
                                </Tooltip>
                              </td>
                              {PERMS.map((perm) => (
                                <td key={perm.field} style={{ textAlign: "center", padding: "8px 14px" }}>
                                  <Checkbox
                                    checked={!!row[perm.field]}
                                    onChange={() => toggleCell(key, perm.field)}
                                    data-testid={`perm-${key}-${perm.field}`}
                                    aria-label={`${label} ${perm.label}`}
                                  />
                                </td>
                              ))}
                              <td style={{ padding: "6px 14px" }}>
                                {/* No View, no reach: an empty select read as a broken control. */}
                                {reach && !row.CanView && (
                                  <span data-testid={`reach-${key}-none`} style={{ color: p.text.tertiary }}>—</span>
                                )}
                                {reach && !!row.CanView && (
                                  <Tooltip title={key === "attendance" ? "Reach decides whose attendance this role can see on the Today page and in the Attendance report. Own: only themselves. Their team: people who report to them. Their office: everyone in their office. Their office + offices below: also the offices under it. Whole company: everyone." : undefined}>
                                    <div>
                                      <Combobox
                                        id={`reach-${key}`}
                                        size="sm"
                                        value={REACH_OPTIONS.find((o) => o.value === row.Reach) ?? null}
                                        onChange={(opt) => setReach(key, opt)}
                                        options={REACH_OPTIONS}
                                        disableClearable
                                        data-testid={`reach-${key}`}
                                      />
                                    </div>
                                  </Tooltip>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Box>
                  <Box sx={{ mt: 1.5 }}>
                    <Checkbox
                      label="Can see salary & contact details"
                      checked={canSeeSensitive}
                      onChange={(e) => setCanSeeSensitive(e.target.checked)}
                      data-testid="can-see-sensitive"
                    />
                  </Box>
                </>
              )}
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
