import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { enqueueSnackbar } from "notistack";
import { Pencil, UserPlus } from "lucide-react";
import dayjs from "dayjs";

import { Modal, Button, TextInput, NumberInput, DateField, Combobox } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useUsers } from "../../hooks";
import { getUserName } from "../../utils/userShape";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

// A required foreign-key selector: the Combobox stores the raw id (or null),
// so validation only needs to reject null.
const requiredId = (label) =>
  z
    .number()
    .nullable()
    .refine((v) => v != null, `${label} is required`);

// Only the columns sp_SaveLead accepts. CompId/BranchId/UserId are injected
// server-side by leadController.save — never sent from here.
const schema = z.object({
  Name: z.string().trim().min(1, "Name is required"),
  MobileNo: z.string().trim().min(1, "Mobile number is required"),
  AltMobile: z.string().optional(),
  Email: z.union([z.string().email("Invalid email"), z.literal("")]).optional(),
  SourceId: z.number().nullable().optional(),
  PipelineId: requiredId("Pipeline"),
  StageId: requiredId("Stage"),
  OwnerId: requiredId("Owner"),
  EstValue: z.string().optional(),
  NextFollowupDate: z.string().optional(),
});

const EMPTY = {
  Name: "",
  MobileNo: "",
  AltMobile: "",
  Email: "",
  SourceId: null,
  PipelineId: null,
  StageId: null,
  OwnerId: null,
  EstValue: "",
  NextFollowupDate: "",
};

// Map a fetched lead row (sp_FetchLeads / sp_FetchLeadDetail shape) onto the
// form's value shape.
const leadToForm = (lead) => ({
  Name: lead.Name ?? "",
  MobileNo: lead.MobileNo ?? "",
  AltMobile: lead.AltMobile ?? "",
  Email: lead.Email ?? "",
  SourceId: lead.SourceId ?? null,
  PipelineId: lead.PipelineId ?? null,
  StageId: lead.StageId ?? null,
  OwnerId: lead.OwnerId ?? null,
  EstValue: lead.EstValue == null ? "" : String(lead.EstValue),
  NextFollowupDate: lead.NextFollowupDate
    ? dayjs(lead.NextFollowupDate).format("YYYY-MM-DD")
    : "",
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
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const pipelineId = watch("PipelineId");

  // Custom-field values keyed by FieldId — mirrors LeadDetail's local draft.
  const [custom, setCustom] = useState({});
  const attachmentsRef = useRef(null);

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const users = usersData?.users || [];

  const { data: sourcesData } = useApiQuery({
    queryKey: ["lead-sources"],
    endpoint: SALES_ENDPOINTS.config.fetchLookups,
    params: { Kind: "lead_source" },
    enabled: Boolean(open),
    showErrorMessage: false,
  });
  const sources = sourcesData?.lookups || [];

  const { data: pipelinesData } = useApiQuery({
    queryKey: ["sales-pipelines", "lead"],
    endpoint: SALES_ENDPOINTS.config.fetchPipelines,
    params: { Entity: "lead" },
    enabled: Boolean(open),
    showErrorMessage: false,
  });
  const pipelines = pipelinesData?.pipelines || [];
  const stages = pipelinesData?.stages || [];

  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "lead"],
    endpoint: SALES_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "lead" },
    enabled: Boolean(open),
    showErrorMessage: false,
  });
  const fieldDefs = defsData?.customFields || [];

  const pipelineOpts = useMemo(
    () => pipelines.map((p) => ({ value: p.Id, label: p.Name })),
    [pipelines]
  );
  const stageOpts = useMemo(
    () =>
      stages
        .filter((s) => s.PipelineId === pipelineId)
        .map((s) => ({ value: s.Id, label: s.Name })),
    [stages, pipelineId]
  );
  const sourceOpts = useMemo(
    () => sources.map((s) => ({ value: s.Id, label: s.Value })),
    [sources]
  );
  const ownerOpts = useMemo(
    () => users.map((u) => ({ value: u.Id, label: getUserName(u) || u.Username })),
    [users]
  );

  // Prefill from the lead being edited (or clear back to blank for create).
  useEffect(() => {
    if (!open) return;
    reset(lead?.Id ? leadToForm(lead) : EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.Id, reset]);

  // Default to the company's default pipeline once pipelines load.
  useEffect(() => {
    if (!open || pipelineId != null || pipelines.length === 0) return;
    const def = pipelines.find((p) => p.IsDefault) ?? pipelines[0];
    if (def) setValue("PipelineId", def.Id);
  }, [open, pipelineId, pipelines, setValue]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        MobileNo: values.MobileNo.trim(),
        AltMobile: values.AltMobile?.trim() || null,
        Email: values.Email?.trim() || null,
        SourceId: values.SourceId ?? null,
        PipelineId: values.PipelineId,
        StageId: values.StageId,
        OwnerId: values.OwnerId,
        EstValue: values.EstValue === "" ? null : Number(values.EstValue),
        NextFollowupDate: values.NextFollowupDate || null,
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
              name="OwnerId"
              render={({ field }) => (
                <Combobox
                  label="Owner"
                  required
                  options={ownerOpts}
                  value={ownerOpts.find((o) => o.value === field.value) ?? null}
                  onChange={(opt) => field.onChange(opt?.value ?? null)}
                  placeholder="Assign an owner"
                  error={errors.OwnerId?.message}
                  data-testid="lead-owner"
                />
              )}
            />
            <Controller
              control={control}
              name="PipelineId"
              render={({ field }) => (
                <Combobox
                  label="Pipeline"
                  required
                  options={pipelineOpts}
                  value={pipelineOpts.find((o) => o.value === field.value) ?? null}
                  onChange={(opt) => {
                    field.onChange(opt?.value ?? null);
                    // Clear stage when pipeline changes — stages are pipeline-scoped.
                    setValue("StageId", null);
                  }}
                  placeholder="Pick a pipeline"
                  error={errors.PipelineId?.message}
                  data-testid="lead-pipeline"
                />
              )}
            />
            <Controller
              control={control}
              name="StageId"
              render={({ field }) => (
                <Combobox
                  label="Stage"
                  required
                  options={stageOpts}
                  value={stageOpts.find((o) => o.value === field.value) ?? null}
                  onChange={(opt) => field.onChange(opt?.value ?? null)}
                  placeholder="Pick a stage"
                  error={errors.StageId?.message}
                  data-testid="lead-stage"
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
            <Controller
              control={control}
              name="NextFollowupDate"
              render={({ field }) => (
                <DateField
                  label="Next follow-up"
                  value={field.value}
                  onChange={field.onChange}
                  data-testid="lead-followup-date"
                />
              )}
            />
          </div>

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
