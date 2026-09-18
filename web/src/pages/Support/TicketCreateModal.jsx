// src/pages/Support/TicketCreateModal.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { enqueueSnackbar } from "notistack";
import { Pencil, Plus } from "lucide-react";
import dayjs from "dayjs";
import { Box } from "@mui/material";

import { Modal, Button, TextInput, TextArea, Combobox } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatDateTime } from "../../utils/format";
import CustomerPicker from "./CustomerPicker";

// Only the columns sp_SaveTicket takes (spec 2 §3). CompId/BranchId/UserId are
// injected server-side; the status is the SP's (first 'open' on insert, never
// touched on update) and the assignee moves only through a transfer.
const schema = z.object({
  Customer: z.any().refine((v) => Boolean(v?.Id), { message: "Pick a customer" }),
  Subject: z.string().trim().min(1, "Subject is required"),
  ContactPerson: z.string().optional(),
  Contact: z.string().optional(),
  ChannelId: z.number().nullable().optional(),
  CategoryId: z.number().nullable().optional(),
  Priority: z.number().nullable().optional(),
  ProductId: z.number().nullable().optional(),
  AssignedTo: z.number().nullable().optional(),
  Description: z.string().optional(),
});

const EMPTY = {
  Customer: null, Subject: "", ContactPerson: "", Contact: "",
  ChannelId: null, CategoryId: null, Priority: null, ProductId: null,
  AssignedTo: null, Description: "",
};

// A ticket row (sp_FetchTickets or sp_FetchTicketDetail) onto the form shape.
// The customer trio is enough for CustomerPicker to render its own label.
const ticketToForm = (t) => ({
  Customer: t.CustomerId ? { Id: t.CustomerId, Name: t.CustomerName, Mobile: t.CustomerMobile, Email: t.CustomerEmail } : null,
  Subject: t.Subject ?? "",
  ContactPerson: t.ContactPerson ?? "",
  Contact: t.Contact ?? "",
  ChannelId: t.ChannelId ?? null,
  CategoryId: t.CategoryId ?? null,
  Priority: t.Priority ?? null,
  ProductId: t.ProductId ?? null,
  AssignedTo: null,
  Description: t.Description ?? "",
});

// fetchTicketDetail's RS2 carries the stored value columns only; the field's
// own Type comes with it, so this maps a row onto DynamicField's value shape.
const fieldValue = (def, valueRow) => {
  if (!valueRow) return def.Type === "checkbox" ? false : def.Type === "dropdown" ? null : "";
  switch (def.Type) {
    case "number": return valueRow.ValueNumber ?? "";
    case "date": return valueRow.ValueDate ?? "";
    case "checkbox": return Boolean(valueRow.ValueNumber);
    case "dropdown": return valueRow.ValueText ?? null;
    default: return valueRow.ValueText ?? "";
  }
};

const clean = (s) => (s?.trim() ? s.trim() : null);

/**
 * Creates or edits a complaint via sp_SaveTicket (@Id=0 insert, @Id>0 update).
 * Pass a `ticket` row to edit it.
 *
 * Custom fields are edited here on BOTH paths — that is what lets the detail
 * page stop re-sending every fixed column just to save one custom value (the
 * SP's UPDATE writes all of them, so a partial body blanked whatever it left
 * out). The stored values come from this modal's own fetchTicketDetail query,
 * under the same ["ticket-detail", id] key the detail page uses, so opening
 * the editor from there is a cache hit rather than a second round-trip.
 */
export default function TicketCreateModal({ open, onClose, ticket = null, onSaved }) {
  const isEdit = Boolean(ticket?.Id);
  const { control, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const [custom, setCustom] = useState({});
  const attachmentsRef = useRef(null);

  const whileOpen = { enabled: open, showErrorMessage: false };
  const { lookups: categories } = useLookups("ticket_category", whileOpen);
  const { lookups: priorities } = useLookups("priority", whileOpen);
  const { lookups: channels } = useLookups("ticket_channel", whileOpen);
  const { users } = useAssignableUsers({ enabled: open && !isEdit });

  const { data: productsData } = useApiQuery({
    queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts,
    params: { PageSize: 200, IsActive: true }, enabled: open, showErrorMessage: false,
  });
  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "ticket"], endpoint: SUPPORT_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "ticket" }, enabled: open, showErrorMessage: false,
  });
  const { data: detailData } = useApiQuery({
    queryKey: ["ticket-detail", ticket?.Id], endpoint: SUPPORT_ENDPOINTS.tickets.fetchTicketDetail,
    params: { TicketId: ticket?.Id }, enabled: open && isEdit, showErrorMessage: false,
  });

  const opts = {
    category: useMemo(() => categories.map((c) => ({ value: c.Id, label: c.Value })), [categories]),
    priority: useMemo(() => priorities.map((p) => ({ value: p.Id, label: p.Value })), [priorities]),
    channel: useMemo(() => channels.map((c) => ({ value: c.Id, label: c.Value })), [channels]),
    product: useMemo(() => (productsData?.products ?? []).map((p) => ({ value: p.Id, label: p.Name })), [productsData]),
    assignee: useMemo(() => users.map((u) => ({ value: u.Id, label: u.FullName })), [users]),
  };
  // In edit mode the ticket row already carries the display name
  // (CategoryName/PriorityName/ChannelName) — used as a fallback so the field
  // shows a label on the very first paint, before the lookup list's own async
  // fetch resolves. Same race CustomerPicker solves by keeping the current
  // value listed even when the search has not returned it yet.
  const byId = (list, v, fallbackLabel) =>
    list.find((o) => o.value === v) ?? (v && fallbackLabel ? { value: v, label: fallbackLabel } : null);

  // Definitions drive rendering (order, Options, blank fields still show);
  // the detail's values just seed the draft.
  const fieldRows = useMemo(() => {
    const defs = defsData?.customFields ?? [];
    const valueByFieldId = new Map((detailData?.fields ?? []).map((v) => [v.FieldId, v]));
    return defs.map((def) => ({ def, valueRow: valueByFieldId.get(def.Id) }));
  }, [defsData, detailData]);

  useEffect(() => {
    if (!open) return;
    reset(isEdit ? ticketToForm(ticket) : EMPTY);
  }, [open, isEdit, ticket, reset]);

  useEffect(() => {
    if (!open) return;
    const seeded = {};
    fieldRows.forEach(({ def, valueRow }) => { seeded[def.Id] = fieldValue(def, valueRow); });
    setCustom(seeded);
  }, [open, fieldRows]);

  // The priority IS the due date (spec §2 TAT). Say what the pick does — on
  // create the modal can compute it, on edit sp_SaveTicket re-anchors from the
  // original CreatedAt, so it says so rather than guessing.
  const priorityId = watch("Priority");
  const tat = priorities.find((p) => p.Id === priorityId)?.TatHours ?? null;
  const dueHint =
    !priorityId ? "The priority sets the due date"
      : tat == null ? "This priority has no due date"
        : !isEdit ? `Due by ${dayjs().add(tat, "hour").format("DD-MM-YYYY HH:mm")}`
          : priorityId === ticket?.Priority ? `Due ${formatDateTime(ticket?.DueAt, { empty: "—" })}`
            : `Due date re-stamped to ${tat}h from when it was raised`;

  const saveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.saveTicket,
    successMessage: isEdit ? "Complaint updated" : "Complaint created",
    invalidateQueries: [["tickets"], ["ticket-detail"], ["customer-detail"]],
  });

  const handleClose = () => {
    if (saveMutation.isPending) return;
    reset(EMPTY);
    setCustom({});
    onClose?.();
  };

  const onSubmit = async (v) => {
    const body = {
      Id: ticket?.Id ?? 0,
      CustomerId: v.Customer.Id,
      Subject: v.Subject.trim(),
      ContactPerson: clean(v.ContactPerson),
      Contact: clean(v.Contact),
      ChannelId: v.ChannelId ?? null,
      CategoryId: v.CategoryId ?? null,
      Priority: v.Priority ?? null,
      ProductId: v.ProductId ?? null,
      // Assignment moves only through a transfer; the SP ignores @AssignedTo
      // on update, and sending it would still be a lie about intent.
      ...(isEdit ? {} : { AssignedTo: v.AssignedTo ?? null }),
      LinkedLeadId: ticket?.LinkedLeadId ?? null,
      Description: clean(v.Description),
      CustomJSON: JSON.stringify(fieldRows.map(({ def }) => ({ fieldId: def.Id, type: def.Type, value: custom[def.Id] }))),
    };
    try {
      const saved = await saveMutation.mutateAsync(body);
      if (!isEdit && saved?.Id && attachmentsRef.current?.stagedCount) {
        const { failed } = await attachmentsRef.current.uploadStaged(saved.Id);
        if (failed) enqueueSnackbar(`${failed} file(s) failed to upload — add them from the complaint`, { variant: "warning" });
      }
      reset(EMPTY);
      setCustom({});
      onSaved?.(saved);
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="xl" data-testid="create-ticket-modal">
      <Modal.Header
        title={isEdit ? "Edit complaint" : "New complaint"}
        subtitle={isEdit ? undefined : "Find the customer by mobile or name — or create them here."}
        icon={isEdit ? <Pencil size={18} /> : <Plus size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        {/* Wide, not tall. The fields used to run down a 720px column in two
            lanes, which put the description and the attachments below the fold
            on a laptop and made every complaint a scroll. Now the account of
            what happened sits on the left and the classification of it on the
            right, so the whole form fits without moving. Collapses to one lane
            under md, where a phone scrolls anyway. */}
        <Box
          component="form"
          id="ticket-form"
          onSubmit={handleSubmit(onSubmit)}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1.65fr) minmax(0, 1fr)" },
            alignItems: "start",
            columnGap: 2.5,
            rowGap: 1.75,
          }}
        >
          <Box sx={{ gridColumn: "1 / -1" }}>
            <Controller
              control={control}
              name="Customer"
              render={({ field }) => (
                <CustomerPicker
                  value={field.value}
                  error={errors.Customer?.message}
                  onChange={(row) => {
                    field.onChange(row);
                    // A fresh customer means a fresh person to call back.
                    setValue("ContactPerson", row?.ContactPerson ?? "");
                    setValue("Contact", row?.Mobile ?? row?.Email ?? "");
                  }}
                />
              )}
            />
          </Box>

          {/* Left lane: what the customer actually said. */}
          <Box sx={{ display: "grid", gap: 1.75, minWidth: 0 }}>
            <Controller
              control={control}
              name="Subject"
              render={({ field }) => (
                <TextInput
                  label="Subject" required value={field.value} onChange={field.onChange} onBlur={field.onBlur}
                  error={errors.Subject?.message} placeholder="One line — what is wrong" data-testid="ticket-subject"
                />
              )}
            />

            <Controller control={control} name="Description" render={({ field }) => (
              <TextArea label="Description" value={field.value} onChange={field.onChange} onBlur={field.onBlur}
                rows={6} placeholder="What is the customer reporting?" data-testid="ticket-description" />
            )} />

            {/* Who actually rang, when that is not the customer record itself. */}
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "1fr 1fr" }, gap: 1.75 }}>
              <Controller control={control} name="ContactPerson" render={({ field }) => (
                <TextInput label="Reported by" value={field.value} onChange={field.onChange} onBlur={field.onBlur}
                  placeholder="Who called" data-testid="ticket-contact-person" />
              )} />
              <Controller control={control} name="Contact" render={({ field }) => (
                <TextInput label="Their number / email" value={field.value} onChange={field.onChange} onBlur={field.onBlur}
                  placeholder="If different from the customer's" data-testid="ticket-contact" />
              )} />
            </Box>
          </Box>

          {/* Right lane: how the complaint is filed and who owns it. */}
          <Box sx={{ display: "grid", gap: 1.75, minWidth: 0 }}>
            <Controller control={control} name="CategoryId" render={({ field }) => (
              <Combobox label="Category" options={opts.category} value={byId(opts.category, field.value, ticket?.CategoryName)}
                onChange={(o) => field.onChange(o?.value ?? null)} placeholder="Pick a category" data-testid="ticket-category" />
            )} />
            <Controller control={control} name="Priority" render={({ field }) => (
              <Combobox label="Priority" options={opts.priority} value={byId(opts.priority, field.value, ticket?.PriorityName)}
                onChange={(o) => field.onChange(o?.value ?? null)} placeholder="Pick a priority" hint={dueHint} data-testid="ticket-priority" />
            )} />
            <Controller control={control} name="ChannelId" render={({ field }) => (
              <Combobox label="Channel" options={opts.channel} value={byId(opts.channel, field.value, ticket?.ChannelName)}
                onChange={(o) => field.onChange(o?.value ?? null)} placeholder="How it came in" data-testid="ticket-channel" />
            )} />
            <Controller control={control} name="ProductId" render={({ field }) => (
              <Combobox label="Product" options={opts.product} value={byId(opts.product, field.value, ticket?.ProductName)}
                onChange={(o) => field.onChange(o?.value ?? null)} placeholder="Which product" data-testid="ticket-product" />
            )} />
            {/* Assignment on create only — afterwards it moves through Transfer,
                which writes a reason and remarks into the history. */}
            {!isEdit && (
              <Controller control={control} name="AssignedTo" render={({ field }) => (
                <Combobox label="Assign to" options={opts.assignee} value={byId(opts.assignee, field.value)}
                  onChange={(o) => field.onChange(o?.value ?? null)} placeholder="Leave blank for the queue" data-testid="ticket-assignee" />
              )} />
            )}
          </Box>

          {/* Per-company custom fields: three across the full width rather than
              one per lane, so a company with six of them adds two rows, not six. */}
          {fieldRows.length > 0 && (
            <Box
              sx={{
                gridColumn: "1 / -1",
                display: "grid",
                gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
                gap: 1.75,
              }}
            >
              {fieldRows.map(({ def }) => (
                <DynamicField key={def.Id} field={def} value={custom[def.Id]} onChange={(v) => setCustom((c) => ({ ...c, [def.Id]: v }))} />
              ))}
            </Box>
          )}

          {/* Staged on create, uploaded once the complaint has an id. On edit
              they live on the detail page — one upload surface per record. */}
          {!isEdit && (
            <Box sx={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 1.25 }} data-testid="ticket-attachments">
              <Box component="h3" sx={{ m: 0, fontSize: 14, fontWeight: 700 }}>Attachments</Box>
              <Attachments ref={attachmentsRef} entity="ticket" entityId={null} />
            </Box>
          )}
        </Box>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={saveMutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit(onSubmit)} loading={saveMutation.isPending} data-testid="create-ticket-submit">
          {isEdit ? "Save changes" : "Create complaint"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
