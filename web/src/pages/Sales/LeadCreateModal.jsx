import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { enqueueSnackbar } from "notistack";
import { Pencil, UserPlus } from "lucide-react";
import dayjs from "dayjs";

import {
  Modal,
  Button,
  TextInput,
  TextArea,
  NumberInput,
  DateField,
  Combobox,
} from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

// Only the columns sp_SaveLead accepts. CompId/BranchId/UserId are injected
// server-side by leadController.save — never sent from here.
const schema = z.object({
  Name: z.string().trim().min(1, "Name is required"),
  Company: z.string().optional(),
  MobileNo: z.string().trim().min(1, "Mobile number is required"),
  AltMobile: z.string().optional(),
  Email: z.union([z.string().email("Invalid email"), z.literal("")]).optional(),
  Address: z.string().optional(),
  City: z.string().optional(),
  State: z.string().optional(),
  Pincode: z.string().optional(),
  SourceId: z.number().nullable().optional(),
  ProductId: z.number().nullable().optional(),
  StatusId: z.number().nullable().optional(),
  OwnerId: z.number().nullable().optional(),
  EstValue: z.string().optional(),
  Remarks: z.string().optional(),
  FirstFollowupAt: z.string().optional(),
});

const today = () => dayjs().format("YYYY-MM-DD");

const EMPTY = {
  Name: "",
  Company: "",
  MobileNo: "",
  AltMobile: "",
  Email: "",
  Address: "",
  City: "",
  State: "",
  Pincode: "",
  SourceId: null,
  ProductId: null,
  StatusId: null,
  OwnerId: null,
  EstValue: "",
  Remarks: "",
  FirstFollowupAt: today(),
};

// Map a fetched lead row (sp_FetchLeads / sp_FetchLeadDetail shape) onto the
// form's value shape. Status/owner/first-follow-up are create-time only, so
// they stay blank here and are never sent on update.
const leadToForm = (lead) => ({
  Name: lead.Name ?? "",
  Company: lead.Company ?? "",
  MobileNo: lead.MobileNo ?? "",
  AltMobile: lead.AltMobile ?? "",
  Email: lead.Email ?? "",
  Address: lead.Address ?? "",
  City: lead.City ?? "",
  State: lead.State ?? "",
  Pincode: lead.Pincode ?? "",
  SourceId: lead.SourceId ?? null,
  ProductId: lead.ProductId ?? null,
  StatusId: null,
  OwnerId: null,
  EstValue: lead.EstValue == null ? "" : String(lead.EstValue),
  Remarks: lead.Remarks ?? "",
  FirstFollowupAt: "",
});

/**
 * Creates or edits a lead via the config-engine sp_SaveLead (@Id=0 insert,
 * @Id>0 update). Pass a `lead` row to edit it. Core lead fields go through
 * RHF + Zod; per-company custom fields (Entity='lead') render via DynamicField
 * and ship in CustomJSON on create only — in edit mode CustomJSON is null so
 * the SP leaves stored custom values untouched (they're edited on LeadDetail).
 */
export default function LeadCreateModal({ open, onClose, onSaved, lead = null }) {
  const isEdit = Boolean(lead?.Id);
  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });

  // Custom-field values keyed by FieldId — mirrors LeadDetail's local draft.
  const [custom, setCustom] = useState({});
  const attachmentsRef = useRef(null);

  // Only owners the server will accept: sp_FetchAssignableUsers is the same
  // roster leadController.save re-checks, so a pick can't come back 403.
  const { users } = useAssignableUsers({ enabled: Boolean(open) && !isEdit });

  const { lookups: sources } = useLookups("lead_source", {
    enabled: Boolean(open),
    showErrorMessage: false,
  });

  const { lookups: statuses } = useLookups("lead_status", {
    enabled: Boolean(open) && !isEdit,
    showErrorMessage: false,
  });

  const { data: productsData } = useApiQuery({
    queryKey: ["products", "active"],
    endpoint: SALES_ENDPOINTS.products.fetchProducts,
    params: { PageSize: 200, IsActive: true },
    enabled: Boolean(open),
    showErrorMessage: false,
  });
  const products = productsData?.products ?? [];

  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "lead"],
    endpoint: SALES_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "lead" },
    enabled: Boolean(open),
    showErrorMessage: false,
  });
  const fieldDefs = defsData?.customFields || [];

  const sourceOpts = useMemo(
    () => sources.map((s) => ({ value: s.Id, label: s.Value })),
    [sources]
  );
  const statusOpts = useMemo(
    () => statuses.map((s) => ({ value: s.Id, label: s.Value })),
    [statuses]
  );
  const productOpts = useMemo(
    () => products.map((p) => ({ value: p.Id, label: p.Name })),
    [products]
  );
  const ownerOpts = useMemo(
    () => users.map((u) => ({ value: u.Id, label: u.FullName })),
    [users]
  );

  // Prefill from the lead being edited (or clear back to blank for create).
  useEffect(() => {
    if (!open) return;
    reset(lead?.Id ? leadToForm(lead) : EMPTY);
  }, [open, lead?.Id, reset]);

  // New leads start in the first 'open' status unless the user picks another.
  useEffect(() => {
    if (!open || isEdit || statuses.length === 0) return;
    const first =
      [...statuses]
        .filter((s) => s.Code === "open")
        .sort((a, b) => a.SortOrder - b.SortOrder)[0] ?? statuses[0];
    setValue("StatusId", first.Id);
  }, [open, isEdit, statuses, setValue]);

  // Seed blank custom-field draft when defs load / modal opens. Key the effect
  // on a stable primitive (the def-id signature), NOT the defsData object —
  // its ref is unstable (fresh each fetch/render), which would otherwise
  // re-seed every render and spin an infinite render loop.
  const defsKey = fieldDefs.map((d) => d.Id).join(",");
  useEffect(() => {
    if (!open) return;
    const seeded = {};
    fieldDefs.forEach((def) => {
      seeded[def.Id] =
        def.Type === "checkbox" ? false : def.Type === "dropdown" ? null : "";
    });
    setCustom(seeded);
  }, [open, defsKey]);

  const saveMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.leads.saveLeads,
    successMessage: isEdit ? "Lead updated" : "Lead created",
    invalidateQueries: [["leads"], ["sales-leads"], ["lead-detail"]],
  });

  const handleClose = () => {
    reset(EMPTY);
    setCustom({});
    onClose?.();
  };

  const onSubmit = async (values) => {
    const customJson = fieldDefs.map((def) => ({
      fieldId: def.Id,
      type: def.Type,
      value: custom[def.Id],
    }));
    try {
      const saved = await saveMutation.mutateAsync({
        Id: lead?.Id ?? 0,
        Name: values.Name.trim(),
        Company: values.Company?.trim() || null,
        MobileNo: values.MobileNo.trim(),
        AltMobile: values.AltMobile?.trim() || null,
        Email: values.Email?.trim() || null,
        Address: values.Address?.trim() || null,
        City: values.City?.trim() || null,
        State: values.State?.trim() || null,
        Pincode: values.Pincode?.trim() || null,
        SourceId: values.SourceId ?? null,
        ProductId: values.ProductId ?? null,
        EstValue: values.EstValue === "" ? null : Number(values.EstValue),
        Remarks: values.Remarks?.trim() || null,
        // Ownership and status are create-time only; edits move them through
        // Transfer and the status dropdown, never through this form.
        ...(isEdit
          ? {}
          : {
              StatusId: values.StatusId ?? null,
              OwnerId: values.OwnerId ?? null,
              FirstFollowupAt: values.FirstFollowupAt || null,
            }),
        // Edit touches base fields only — null CustomJSON makes sp_SaveLead
        // skip the custom-value merge, so stored custom fields survive.
        CustomJSON: isEdit ? null : JSON.stringify(customJson),
      });
      const newId = saved?.Id;
      if (!isEdit && newId && attachmentsRef.current?.stagedCount) {
        const { failed } = await attachmentsRef.current.uploadStaged(newId);
        if (failed)
          enqueueSnackbar(`${failed} file(s) failed to upload — add them from the record`, {
            variant: "warning",
          });
      }
      reset(EMPTY);
      setCustom({});
      onSaved?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="lg" data-testid="lead-create-modal">
      <Modal.Header
        title={isEdit ? "Edit Lead" : "New Lead"}
        icon={isEdit ? <Pencil size={18} /> : <UserPlus size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <form
          id="lead-create-form"
          onSubmit={handleSubmit(onSubmit)}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            <Controller
              control={control}
              name="Name"
              render={({ field }) => (
                <TextInput
                  label="Name"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.Name?.message}
                  data-testid="lead-name"
                />
              )}
            />
            <Controller
              control={control}
              name="MobileNo"
              render={({ field }) => (
                <TextInput
                  label="Mobile"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.MobileNo?.message}
                  data-testid="lead-mobile"
                />
              )}
            />
            <Controller
              control={control}
              name="AltMobile"
              render={({ field }) => (
                <TextInput
                  label="Alternate mobile"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  data-testid="lead-alt-mobile"
                />
              )}
            />
            <Controller
              control={control}
              name="Email"
              render={({ field }) => (
                <TextInput
                  label="Email"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.Email?.message}
                  data-testid="lead-email"
                />
              )}
            />
            <Controller
              control={control}
              name="Company"
              render={({ field }) => (
                <TextInput
                  label="Company"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  data-testid="lead-company"
                />
              )}
            />
            <Controller
              control={control}
              name="Address"
              render={({ field }) => (
                <TextInput
                  label="Address"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  data-testid="lead-address"
                />
              )}
            />
            <Controller
              control={control}
              name="City"
              render={({ field }) => (
                <TextInput
                  label="City"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  data-testid="lead-city"
                />
              )}
            />
            <Controller
              control={control}
              name="State"
              render={({ field }) => (
                <TextInput
                  label="State"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  data-testid="lead-state"
                />
              )}
            />
            <Controller
              control={control}
              name="Pincode"
              render={({ field }) => (
                <TextInput
                  label="Pincode"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  data-testid="lead-pincode"
                />
              )}
            />
            <Controller
              control={control}
              name="SourceId"
              render={({ field }) => (
                <Combobox
                  label="Source"
                  options={sourceOpts}
                  value={sourceOpts.find((o) => o.value === field.value) ?? null}
                  onChange={(opt) => field.onChange(opt?.value ?? null)}
                  placeholder="Pick a source"
                  data-testid="lead-source"
                />
              )}
            />
            <Controller
              control={control}
              name="ProductId"
              render={({ field }) => (
                <Combobox
                  label="Product"
                  options={productOpts}
                  value={productOpts.find((o) => o.value === field.value) ?? null}
                  onChange={(opt) => field.onChange(opt?.value ?? null)}
                  placeholder="Interested in…"
                  data-testid="lead-product"
                />
              )}
            />
            <Controller
              control={control}
              name="EstValue"
              render={({ field }) => (
                <NumberInput
                  label="Estimated value"
                  value={field.value}
                  onChange={field.onChange}
                  data-testid="lead-est-value"
                />
              )}
            />
            {!isEdit && (
              <>
                <Controller
                  control={control}
                  name="StatusId"
                  render={({ field }) => (
                    <Combobox
                      label="Status"
                      options={statusOpts}
                      value={statusOpts.find((o) => o.value === field.value) ?? null}
                      onChange={(opt) => field.onChange(opt?.value ?? null)}
                      data-testid="lead-status"
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="OwnerId"
                  render={({ field }) => (
                    <Combobox
                      label="Owner"
                      options={ownerOpts}
                      value={ownerOpts.find((o) => o.value === field.value) ?? null}
                      onChange={(opt) => field.onChange(opt?.value ?? null)}
                      placeholder="Leave blank to assign later"
                      data-testid="lead-owner"
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="FirstFollowupAt"
                  render={({ field }) => (
                    <DateField
                      label="First follow-up"
                      value={field.value}
                      onChange={field.onChange}
                      data-testid="lead-followup-date"
                    />
                  )}
                />
              </>
            )}
          </div>

          <Controller
            control={control}
            name="Remarks"
            render={({ field }) => (
              <TextArea
                label="Remarks"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                placeholder="Anything the next person should know"
                data-testid="lead-remarks"
              />
            )}
          />

          {!isEdit && fieldDefs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Custom fields</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 16,
                }}
              >
                {fieldDefs.map((def) => (
                  <DynamicField
                    key={def.Id}
                    field={def}
                    value={custom[def.Id]}
                    onChange={(v) => setCustom((c) => ({ ...c, [def.Id]: v }))}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom fields + attachments already live on the lead's detail
              page — the edit modal only handles the base fields. */}
          {!isEdit && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Attachments</h3>
              <Attachments ref={attachmentsRef} entity="lead" entityId={null} />
            </div>
          )}
        </form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={saveMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit(onSubmit)}
          loading={saveMutation.isPending}
          data-testid="lead-create-submit"
        >
          {isEdit ? "Save Changes" : "Create Lead"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
