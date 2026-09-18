// src/pages/Settings/LookupMaster.jsx
//
// The CRUD master behind every tblLookup screen. Lookups, Priorities and
// Ticket Categories were three 216-245 line files that a diff showed to be
// identical apart from ~20 string literals — the state, the search filter, the
// modal, the mutations and the confirm dialog were copied verbatim. A fix to
// any of them (the save-error fallback, say) had to be made three times.
//
// Every label derives from two inputs so nothing has to be passed twice:
//   `noun`  — "Priority" gives "New Priority", "Delete Priority",
//             "Priority deleted successfully!", "Failed to save priority".
//   the active kind's `label` — "Priorities" gives the empty state
//             "No priorities yet — create the first one."
//
// One `kinds` entry renders no tab strip, which is exactly what the pinned
// Priorities and Ticket Categories pages want.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useSnackbar } from "notistack";

import PageHeader from "../../components/ui/PageHeader";
import MasterChipGrid from "../../components/MasterChipGrid";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import Tabs from "../../components/ui/Tabs";
import {
  FormModal,
  FormContainer,
  FormRow,
  FormInput,
  FormNumberInput,
  FormSelect,
  FormButtons,
} from "../../components/Design/FormComponents";

import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { useConfirmation } from "../../hooks";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

// useApiMutation rejects with the API's own message when the server refuses
// the write; a transport failure arrives as an axios error whose message
// ("Network Error") is no use to anyone, so that keeps the generic fallback.
const errorText = (error, fallback) =>
  error.isAxiosError ? error.response?.data?.message || fallback : error.message;

// Some kinds carry a machine Code behind an editable, per-company label, and
// sp_SaveLookup validates the set per Kind. Table, not a chain of ifs: the
// lifecycle that branches on these codes lives in one place on each side.
// lead_status omits "converted" on purpose — it is stamped by the convert
// action, not handed out by an admin.
const CODE_OPTIONS = {
  lead_status: [
    { value: "open", label: "Open — still being worked" },
    { value: "qualified", label: "Qualified — ready to convert" },
    { value: "lost", label: "Lost — needs a reason" },
    { value: "junk", label: "Junk" },
  ],
  ticket_status: [
    { value: "open", label: "Open — being worked" },
    { value: "onhold", label: "On hold — waiting on the customer" },
    { value: "resolved", label: "Resolved — needs a resolution" },
    { value: "closed", label: "Closed — the customer confirmed" },
    { value: "rejected", label: "Rejected — never solved" },
  ],
};

// Kind='priority' carries the TAT hours that stamp a complaint's DueAt.
const TAT_KIND = "priority";

const emptyForm = { Value: "", SortOrder: "0", Code: "open", TatHours: "" };

export default function LookupMaster({
  title,
  subtitle,
  documentTitle,
  noun,
  kinds,
  placeholder,
}) {
  const { enqueueSnackbar } = useSnackbar();
  const confirmation = useConfirmation();

  const [activeKind, setActiveKind] = useState(kinds[0].value);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLookup, setEditingLookup] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});

  const query = useLookups(activeKind);
  const allLookups = query.lookups;
  const items = useMemo(() => {
    if (!search.trim()) return allLookups;
    const term = search.trim().toLowerCase();
    return allLookups.filter((l) => (l.Value || "").toLowerCase().includes(term));
  }, [allLookups, search]);

  useEffect(() => {
    if (!isModalOpen) return;
    if (editingLookup) {
      setFormData({
        Value: editingLookup.Value || "",
        SortOrder: String(editingLookup.SortOrder ?? 0),
        Code: editingLookup.Code || "open",
        TatHours: editingLookup.TatHours == null ? "" : String(editingLookup.TatHours),
      });
    } else {
      setFormData(emptyForm);
    }
    setErrors({});
  }, [editingLookup, isModalOpen]);

  const handleKindChange = (kind) => {
    setActiveKind(kind);
    setSearch("");
  };

  const handleCreate = () => {
    setEditingLookup(null);
    setIsModalOpen(true);
  };

  const handleEdit = (lookup) => {
    setEditingLookup(lookup);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingLookup(null);
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!formData.Value.trim()) next.Value = "Value is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const codeOptions = CODE_OPTIONS[activeKind] ?? null;
  const hasTat = activeKind === TAT_KIND;

  const lower = noun.toLowerCase();

  const saveMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.config.saveLookup,
    successMessage: `${noun} ${editingLookup ? "updated" : "created"} successfully!`,
    invalidateQueries: [["lookups", activeKind]],
    onSuccess: closeModal,
    showErrorMessage: false,
    onError: (error) =>
      enqueueSnackbar(errorText(error, `Failed to save ${lower}`), { variant: "error" }),
  });

  const deleteMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.config.deleteLookup,
    successMessage: `${noun} deleted successfully!`,
    invalidateQueries: [["lookups", activeKind]],
    showErrorMessage: false,
    onError: (error) =>
      enqueueSnackbar(errorText(error, `Failed to delete ${lower}!`), { variant: "error" }),
  });

  const handleSubmit = () => {
    if (!validate()) return;
    saveMutation.mutate({
      Id: editingLookup?.Id || 0,
      Kind: activeKind,
      Value: formData.Value.trim(),
      SortOrder: Number(formData.SortOrder) || 0,
      ...(codeOptions ? { Code: formData.Code } : {}),
      // NULL, not 0: "no TAT" means this priority never makes a complaint
      // overdue (spec 2 §2), while 0 would mean "due on arrival".
      ...(hasTat ? { TatHours: formData.TatHours === "" ? null : Number(formData.TatHours) } : {}),
    });
  };

  const handleDelete = useCallback(
    (lookup) => {
      confirmation.confirmDelete({
        title: `Delete ${noun}`,
        message: `Are you sure you want to delete "${lookup.Value}"? This action cannot be undone.`,
        confirmText: `Delete ${noun}`,
        onConfirm: () => deleteMutation.mutateAsync({ Id: lookup.Id }),
      });
    },
    [confirmation, deleteMutation, noun]
  );

  const activeLabel = kinds.find((k) => k.value === activeKind)?.label || "";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title={title} subtitle={subtitle} />
      <Helmet>
        <title>PRD Infotech | {documentTitle}</title>
      </Helmet>
      {kinds.length > 1 && (
        <Box sx={{ mt: 1.5 }}>
          <Tabs
            value={activeKind}
            onChange={handleKindChange}
            items={kinds}
            data-testid="lookup-kind-tabs"
          />
        </Box>
      )}
      <Box sx={{ mt: 1.5 }}>
        <MasterChipGrid
          items={items}
          nameKey="Value"
          idKey="Id"
          isLoading={query.isLoading}
          search={search}
          onSearchChange={setSearch}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          createLabel={`New ${noun}`}
          emptyLabel={`No ${activeLabel.toLowerCase()} yet — create the first one.`}
          totalCount={items.length}
        />
      </Box>

      <FormModal
        open={isModalOpen}
        title={`${editingLookup ? "Edit" : "Create"} ${noun}`}
        maxWidth="max-w-2xl"
        onClose={closeModal}
      >
        <div className="p-6">
          <FormContainer spacing="space-y-4">
            <FormRow columns={1}>
              <FormInput
                label="Value"
                value={formData.Value}
                onChange={(e) => handleChange("Value", e.target.value)}
                placeholder={placeholder}
                error={errors.Value}
                required
              />
            </FormRow>
            <FormRow columns={1}>
              <FormNumberInput
                label="Sort Order"
                value={formData.SortOrder}
                onChange={(e) => handleChange("SortOrder", e.target.value)}
              />
            </FormRow>
            {codeOptions && (
              <FormRow columns={1}>
                <FormSelect
                  label="Code"
                  value={formData.Code}
                  onChange={(e) => handleChange("Code", e.target.value)}
                  options={codeOptions}
                  required
                />
              </FormRow>
            )}
            {hasTat && (
              <FormRow columns={1}>
                <FormNumberInput
                  label="TAT hours"
                  value={formData.TatHours}
                  onChange={(e) => handleChange("TatHours", e.target.value)}
                  helperText="Hours from when a complaint is raised to its due date. Leave blank for no due date."
                  maxLength={5}
                />
              </FormRow>
            )}
          </FormContainer>
        </div>

        <FormButtons
          onCancel={closeModal}
          onSubmit={handleSubmit}
          submitText={`${editingLookup ? "Update" : "Create"} ${noun}`}
          isLoading={saveMutation.isPending}
        />
      </FormModal>

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
}
