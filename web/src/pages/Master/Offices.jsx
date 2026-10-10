// src/pages/Master/Offices.jsx
//
// Offices admin: tblBranch drawn as a tree through ParentId, with add-under,
// edit/move and deactivate. Backend contract (admin only for the write):
//   fetchBranches -> { branches: [{ Id, BranchName, ParentId, IsActive, Address, PeopleCount }] }
//   saveBranch { Id, BranchName, ParentId, Address, IsActive } -> { id }
// The server refuses loops, duplicate names and deactivating an office with
// people in it; that message is shown in the modal as-is.
import React, { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Pencil, Plus } from "lucide-react";
import { useSnackbar } from "notistack";
import {
  Button,
  Checkbox,
  Chip,
  Combobox,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  TextInput,
} from "../../components/ui";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { saveBranch } from "../../api/masterQueries";
import { useApiQuery } from "../../hooks/useApiQuery";
import { toTree, descendantsOf } from "../../utils/officeTree";
import { rem } from "../../utils/rem";

const TOP = { value: 0, label: "Top level" };

const Offices = () => {
  const theme = useTheme();
  const p = theme.tokens;
  const { enqueueSnackbar } = useSnackbar();

  const [form, setForm] = useState(null); // null = modal closed
  const [nameError, setNameError] = useState("");
  const [serverError, setServerError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const branchesQuery = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    params: {},
  });
  const rows = branchesQuery.data?.branches ?? [];
  const tree = toTree(rows);

  const open = (next) => {
    setForm(next);
    setNameError("");
    setServerError("");
  };
  const openAdd = (parentId = null) =>
    open({ Id: 0, BranchName: "", ParentId: parentId, Address: "", IsActive: true });
  const openEdit = (r) =>
    open({
      Id: r.Id,
      BranchName: r.BranchName,
      ParentId: r.ParentId ?? null,
      Address: r.Address || "",
      IsActive: r.IsActive !== false && r.IsActive !== 0,
    });

  // An office cannot move under itself or anything below it. Inactive offices
  // are not offered as a new parent, but the current parent always shows.
  const blocked = form?.Id ? descendantsOf(rows, form.Id) : new Set();
  const isActive = (r) => r.IsActive !== false && r.IsActive !== 0;
  const parentOptions = [
    TOP,
    ...tree
      .filter((r) => !blocked.has(r.Id) && (isActive(r) || r.Id === form?.ParentId))
      .map((r) => ({ value: r.Id, label: `${"— ".repeat(r.depth)}${r.BranchName}` })),
  ];

  const save = async () => {
    const name = form.BranchName.trim();
    if (!name) {
      setNameError("Name is required");
      return;
    }
    setIsSaving(true);
    setServerError("");
    try {
      const res = await saveBranch({
        Id: form.Id,
        BranchName: name,
        ParentId: form.ParentId,
        Address: form.Address.trim(),
        IsActive: form.IsActive,
      });
      if (res.data?.success) {
        enqueueSnackbar(`Office ${form.Id ? "updated" : "added"}`, { variant: "success" });
        setForm(null);
        branchesQuery.refetch();
      } else {
        setServerError(res.data?.message || "Could not save the office");
      }
    } catch (err) {
      setServerError(err.response?.data?.message || "Could not save the office");
    } finally {
      setIsSaving(false);
    }
  };

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <Helmet>
        <title>PRD Infotech | Offices</title>
      </Helmet>
      <PageHeader
        title="Offices"
        subtitle="Your offices and which office each one sits under."
        actions={
          <Button size="sm" onClick={() => openAdd()} leftIcon={<Plus size={15} />}>
            New office
          </Button>
        }
      />

      <Box
        sx={{
          mt: 2,
          border: `1px solid ${p.border.default}`,
          borderRadius: `${theme.radii.lg}px`,
          overflow: "hidden",
        }}
      >
        {tree.length === 0 ? (
          <EmptyState title="No offices yet" description="Add your first office to start." />
        ) : (
          tree.map((r) => {
            const inactive = !isActive(r);
            const people = r.PeopleCount ?? 0;
            return (
              <Box
                key={r.Id}
                data-testid={`office-row-${r.Id}`}
                sx={{
                  px: 1.5,
                  py: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  borderBottom: `1px solid ${p.border.subtle}`,
                  "&:last-of-type": { borderBottom: "none" },
                }}
              >
                <Box
                  data-testid={`office-name-${r.Id}`}
                  style={{ paddingLeft: rem(r.depth * 24) }}
                  sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1 }}
                >
                  <span
                    style={{
                      fontWeight: r.depth === 0 ? 600 : 500,
                      fontSize: "calc(14rem / 15)",
                      color: inactive ? p.text.tertiary : p.text.primary,
                    }}
                  >
                    {r.BranchName}
                  </span>
                  {inactive && <Chip size="sm" label="Inactive" />}
                </Box>
                <span style={{ fontSize: "calc(12rem / 15)", color: p.text.tertiary, whiteSpace: "nowrap" }}>
                  {people} {people === 1 ? "person" : "people"}
                </span>
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={`Add under ${r.BranchName}`}
                  onClick={() => openAdd(r.Id)}
                >
                  <Plus size={15} />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit ${r.BranchName}`}
                  onClick={() => openEdit(r)}
                >
                  <Pencil size={15} />
                </IconButton>
              </Box>
            );
          })
        )}
      </Box>

      <Modal open={!!form} onClose={() => setForm(null)} size="sm">
        <Modal.Header title={form?.Id ? "Edit office" : "New office"} onClose={() => setForm(null)} />
        {form && (
          <Modal.Body>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextInput
                label="Name"
                value={form.BranchName}
                onChange={(e) => set("BranchName")(e.target.value)}
                error={nameError}
                required
              />
              <Combobox
                label="Parent office"
                value={parentOptions.find((o) => o.value === (form.ParentId ?? 0)) ?? TOP}
                onChange={(opt) => set("ParentId")(opt?.value || null)}
                options={parentOptions}
                disableClearable
              />
              <TextInput
                label="Address"
                value={form.Address}
                onChange={(e) => set("Address")(e.target.value)}
              />
              {form.Id > 0 && (
                <Checkbox
                  label="Active"
                  checked={form.IsActive}
                  onChange={(e) => set("IsActive")(e.target.checked)}
                />
              )}
              {serverError && (
                <div role="alert" style={{ color: p.error.main, fontSize: "calc(13rem / 15)" }}>
                  {serverError}
                </div>
              )}
            </Box>
          </Modal.Body>
        )}
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} loading={isSaving}>
            Save
          </Button>
        </Modal.Footer>
      </Modal>
    </Box>
  );
};

export default Offices;
