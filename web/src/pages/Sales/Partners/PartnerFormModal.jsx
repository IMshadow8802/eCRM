import { useEffect, useState } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTheme } from "@mui/material/styles";
import { Handshake, Pencil } from "lucide-react";

import { Modal, Button, TextInput, TextArea, MobileInput, Combobox } from "../../../components/ui";
import FormGrid, { FormGridSpan } from "../../../components/ui/FormGrid";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { PARTNER_ENDPOINTS } from "../../../api/partnerQueries";
import { mobileSchema } from "../../../utils/mobile";

export const COMM_OPTIONS = [
  { value: "", label: "None" },
  { value: "pct", label: "Percent of deal" },
  { value: "fixed", label: "Fixed amount" },
];

const schema = z
  .object({
    Name: z.string().trim().min(1, "Name is required"),
    ContactPerson: z.string().optional(),
    Mobile: mobileSchema(),
    Email: z.string().trim().email("Invalid email").or(z.literal("")).optional(),
    City: z.string().optional(),
    Notes: z.string().optional(),
    CommType: z.string(),
    CommValue: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.CommType) return;
    const n = Number(v.CommValue);
    if (v.CommValue.trim() === "" || !Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", path: ["CommValue"], message: v.CommType === "pct" ? "Enter the commission percent" : "Enter the commission amount" });
    } else if (v.CommType === "pct" && n > 100) {
      ctx.addIssue({ code: "custom", path: ["CommValue"], message: "Percent cannot be more than 100" });
    }
  });

const EMPTY = { Name: "", ContactPerson: "", Mobile: "", Email: "", City: "", Notes: "", CommType: "", CommValue: "" };
const toForm = (p) => ({
  ...Object.fromEntries(["Name", "ContactPerson", "Mobile", "Email", "City", "Notes"].map((k) => [k, p[k] ?? ""])),
  CommType: p.CommType ?? "",
  CommValue: p.CommValue == null ? "" : String(p.CommValue),
});
const clean = (s) => (s?.trim() ? s.trim() : null);

function Field({ control, errors, name, label, required = false, multiline = false, mobile = false, ...rest }) {
  const Input = mobile ? MobileInput : multiline ? TextArea : TextInput;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Input label={label} required={required} value={field.value} onChange={field.onChange} onBlur={field.onBlur}
          error={errors[name]?.message} data-testid={`partner-${name}`} {...rest} />
      )}
    />
  );
}

/** Adds or edits a partner (sp_SavePartner: Id 0 inserts). Server refusals (duplicate mobile) show in the form. */
export default function PartnerFormModal({ open, onClose, partner = null }) {
  const isEdit = Boolean(partner?.Id);
  const errorColor = useTheme().tokens.error.main;
  const [serverError, setServerError] = useState("");
  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const { control, handleSubmit, reset, formState: { errors } } = form;
  const commType = useWatch({ control, name: "CommType" });

  useEffect(() => {
    if (!open) return;
    setServerError("");
    reset(isEdit ? toForm(partner) : EMPTY);
  }, [open, isEdit, partner, reset]);

  // Any edit clears the server's last refusal (e.g. duplicate mobile).
  const { watch } = form;
  useEffect(() => {
    const sub = watch(() => setServerError(""));
    return () => sub.unsubscribe();
  }, [watch]);

  const save = useApiMutation({
    endpoint: PARTNER_ENDPOINTS.savePartner,
    successMessage: isEdit ? "Partner updated" : "Partner added",
    invalidateQueries: [["partners"]],
    showErrorMessage: false,
  });

  const handleClose = () => { if (!save.isPending) onClose?.(); };

  const onSubmit = async (v) => {
    setServerError("");
    const body = {
      Id: partner?.Id ?? 0,
      Name: v.Name.trim(),
      ContactPerson: clean(v.ContactPerson),
      Mobile: clean(v.Mobile),
      Email: clean(v.Email),
      City: clean(v.City),
      Notes: clean(v.Notes),
      CommType: v.CommType || null,
      CommValue: v.CommType ? Number(v.CommValue) : null,
      // An edit keeps the partner active or inactive as it was; the server treats a missing value as active.
      IsActive: isEdit ? Boolean(partner.IsActive) : true,
    };
    try {
      await save.mutateAsync(body);
      onClose?.();
    } catch (e) {
      setServerError(e.response?.data?.message || e.message || "Could not save the partner");
    }
  };

  const f = { control, errors };

  return (
    <Modal open={open} onClose={handleClose} size="lg" data-testid="partner-form-modal">
      <Modal.Header
        title={isEdit ? "Edit partner" : "Add partner"}
        subtitle={isEdit ? undefined : "Someone who sends you leads. Commission can be set now or later."}
        icon={isEdit ? <Pencil size={18} /> : <Handshake size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <FormGrid component="form" id="partner-form" onSubmit={handleSubmit(onSubmit)}>
          <Field {...f} name="Name" label="Name" required placeholder="Firm or person" autoFocus />
          <Field {...f} name="ContactPerson" label="Contact person" />
          <Field {...f} name="Mobile" label="Mobile" mobile />
          <Field {...f} name="Email" label="Email" inputMode="email" />
          <Field {...f} name="City" label="City" />
          <Controller control={control} name="CommType" render={({ field }) => (
            <Combobox label="Usual commission" options={COMM_OPTIONS}
              value={COMM_OPTIONS.find((o) => o.value === field.value) ?? COMM_OPTIONS[0]}
              onChange={(o) => field.onChange(o?.value ?? "")} data-testid="partner-CommType" />
          )} />
          {commType && (
            <Field {...f} name="CommValue" label={commType === "pct" ? "Percent of deal" : "Amount per deal"} type="number" inputMode="decimal"
              {...(commType === "pct" ? { rightAdornment: "%" } : { leftAdornment: "₹" })} />
          )}
          <FormGridSpan>
            <Field {...f} name="Notes" label="Notes" multiline rows={3} />
          </FormGridSpan>
        </FormGrid>
        {serverError && <div role="alert" style={{ color: errorColor, marginTop: "calc(12rem / 15)", fontSize: "calc(13rem / 15)" }} data-testid="partner-server-error">{serverError}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit(onSubmit)} loading={save.isPending} data-testid="partner-form-submit">
          {isEdit ? "Save changes" : "Add partner"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
