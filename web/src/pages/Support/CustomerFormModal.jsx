// src/pages/Support/CustomerFormModal.jsx
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Pencil, UserPlus } from "lucide-react";

import { Modal, Button, TextInput, TextArea, MobileInput } from "../../components/ui";
import FormGrid from "../../components/ui/FormGrid";
import { isValidGstin } from "../Sales/Quotations/gst";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { mobileSchema } from "../../utils/mobile";

// Only the columns sp_SaveCustomer takes (spec 2 §1). CompId/BranchId/UserId
// are injected server-side — never sent from here.
const schema = z
  .object({
    Name: z.string().trim().min(1, "Name is required"),
    ContactPerson: z.string().optional(),
    Mobile: mobileSchema(),
    AltMobile: mobileSchema({ label: "Alternate mobile" }),
    Email: z.string().trim().email("Invalid email").or(z.literal("")).optional(),
    Address: z.string().optional(),
    City: z.string().optional(),
    State: z.string().optional(),
    Pincode: z.string().optional(),
    // One GSTIN rule, defined once in gst.js. A second copy here would be a
    // regex two files have to agree on forever — the same trap the mobile rule
    // was pulled out of.
    GSTIN: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || isValidGstin(v), "GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5")
      .optional(),
    Remarks: z.string().optional(),
  })
  .refine((v) => Boolean(v.Mobile?.trim() || v.Email?.trim()), {
    message: "A mobile number or an email is required",
    path: ["Mobile"],
  });

const EMPTY = {
  Name: "", ContactPerson: "", Mobile: "", AltMobile: "", Email: "",
  Address: "", City: "", State: "", Pincode: "", GSTIN: "", Remarks: "",
};

const toForm = (c) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, c[k] ?? ""]));
const clean = (s) => (s?.trim() ? s.trim() : null);

// One Controller-wrapped input; defined at module level so the component type
// is stable across renders (an inline component would remount — and drop
// focus — on every keystroke).
function Field({ control, errors, name, label, required = false, multiline = false, mobile = false, ...rest }) {
  const Input = mobile ? MobileInput : multiline ? TextArea : TextInput;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Input
          label={label}
          required={required}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          error={errors[name]?.message}
          data-testid={`customer-${name}`}
          {...rest}
        />
      )}
    />
  );
}

/**
 * Creates or edits a customer via sp_SaveCustomer (@Id=0 insert, @Id>0
 * update). Pass a `customer` row to edit it. `onSaved` receives the posted
 * body with the saved Id, so a caller (the picker in a ticket form) can select
 * the new customer without a second fetch.
 */
export default function CustomerFormModal({ open, onClose, customer = null, onSaved }) {
  const isEdit = Boolean(customer?.Id);
  const { control, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(isEdit ? toForm(customer) : EMPTY);
  }, [open, isEdit, customer, reset]);

  const saveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.customers.saveCustomer,
    successMessage: isEdit ? "Customer updated" : "Customer created",
    invalidateQueries: [["customers"], ["customer-detail"]],
  });

  const handleClose = () => {
    if (saveMutation.isPending) return;
    reset(EMPTY);
    onClose?.();
  };

  const onSubmit = async (v) => {
    const body = {
      Id: customer?.Id ?? 0,
      Name: v.Name.trim(),
      ContactPerson: clean(v.ContactPerson),
      Mobile: clean(v.Mobile),
      AltMobile: clean(v.AltMobile),
      Email: clean(v.Email),
      Address: clean(v.Address),
      City: clean(v.City),
      State: clean(v.State),
      Pincode: clean(v.Pincode),
      GSTIN: clean(v.GSTIN),
      Remarks: clean(v.Remarks),
    };
    try {
      const saved = await saveMutation.mutateAsync(body);
      reset(EMPTY);
      onSaved?.({ ...body, Id: saved?.Id ?? body.Id });
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message (409 on a duplicate mobile).
    }
  };

  const f = { control, errors };

  return (
    <Modal open={open} onClose={handleClose} size="xl" data-testid="customer-form-modal">
      <Modal.Header
        title={isEdit ? "Edit Customer" : "New Customer"}
        subtitle={isEdit ? undefined : "The business or person raising complaints. A mobile or an email is enough."}
        icon={isEdit ? <Pencil size={18} /> : <UserPlus size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <FormGrid component="form" id="customer-form" onSubmit={handleSubmit(onSubmit)}>
          <Field {...f} name="Name" label="Name" required placeholder="Shop, company or person" autoFocus />
          <Field {...f} name="ContactPerson" label="Contact person" placeholder="Who to speak to" />
          <Field {...f} name="Mobile" label="Mobile" mobile />
          <Field {...f} name="AltMobile" label="Alternate mobile" mobile />
          <Field {...f} name="Email" label="Email" inputMode="email" />
          <Field {...f} name="Address" label="Address" />
          <Field {...f} name="City" label="City" />
          <Field {...f} name="State" label="State" />
          <Field {...f} name="Pincode" label="Pincode" inputMode="numeric" />
          <Field {...f} name="GSTIN" label="GSTIN" placeholder="15 characters, if registered" />
          <div style={{ gridColumn: "1 / -1" }}>
            <Field {...f} name="Remarks" label="Remarks" multiline rows={3} placeholder="Anything the next agent should know" />
          </div>
        </FormGrid>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={saveMutation.isPending}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleSubmit(onSubmit)}
          loading={saveMutation.isPending}
          data-testid="customer-form-submit"
        >
          {isEdit ? "Save Changes" : "Create Customer"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
