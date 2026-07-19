import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { Plus } from "lucide-react";

import { Modal, Button, TextInput, TextArea, Combobox } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useUsers } from "../../hooks";
import { getUserName } from "../../utils/userShape";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

// sp_SaveTicket has a fixed Channel varchar(20); no lookup drives it, so the
// UI offers the standard support channels as a small fixed list.
const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "web", label: "Web" },
  { value: "chat", label: "Chat" },
  { value: "whatsapp", label: "WhatsApp" },
];

// Seed a blank draft value per custom-field definition (mirrors TicketDetail).
const blankFieldValue = (type) =>
  type === "checkbox" ? false : type === "dropdown" ? null : "";

/**
 * Creates a ticket via sp_SaveTicket (Id=0). Mirrors TicketDetail's edit
 * payload exactly: the fixed columns plus config-engine custom fields
 * (Entity='ticket') serialized into CustomJSON. CompId/BranchId/UserId are
 * injected server-side — never sent from here.
 */
export default function TicketCreateModal({ open, onClose, onCreated }) {
  const [customerName, setCustomerName] = useState("");
  const [contact, setContact] = useState("");
  const [channel, setChannel] = useState(null);
  const [category, setCategory] = useState(null);
  const [priority, setPriority] = useState(null);
  const [assignee, setAssignee] = useState(null);
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState({});
  const attachmentsRef = useRef(null);

  const queryClient = useQueryClient();

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const users = usersData?.users || [];

  const { data: categoriesData } = useApiQuery({
    queryKey: ["ticket-lookups", "ticket_category"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "ticket_category" },
    enabled: open,
    showErrorMessage: false,
  });
  const { data: prioritiesData } = useApiQuery({
    queryKey: ["ticket-lookups", "priority"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "priority" },
    enabled: open,
    showErrorMessage: false,
  });
  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "ticket"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "ticket" },
    enabled: open,
    showErrorMessage: false,
  });

  const categoryOpts = (categoriesData?.lookups || []).map((l) => ({ value: l.Id, label: l.Value }));
  const priorityOpts = (prioritiesData?.lookups || []).map((l) => ({ value: l.Id, label: l.Value }));
  const assigneeOpts = users.map((u) => ({ value: u.Id, label: getUserName(u) || u.Username }));
  const defs = defsData?.customFields || [];

  // Seed a blank draft entry per custom-field definition.
  useEffect(() => {
    if (defs.length === 0) return;
    setDraft((cur) => {
      const seeded = { ...cur };
      defs.forEach((d) => {
        if (!(d.Id in seeded)) seeded[d.Id] = blankFieldValue(d.Type);
      });
      return seeded;
    });
  }, [defs]);

  const saveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.saveTicket,
    successMessage: "Ticket created",
  });

  const reset = () => {
    setCustomerName("");
    setContact("");
    setChannel(null);
    setCategory(null);
    setPriority(null);
    setAssignee(null);
    setDescription("");
    setDraft({});
  };

  const handleClose = () => {
    if (saveMutation.isPending) return;
    reset();
    onClose?.();
  };

  const canSubmit =
    customerName.trim().length > 0 &&
    contact.trim().length > 0 &&
    Boolean(channel) &&
    Boolean(category) &&
    Boolean(priority) &&
    description.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    const customJson = defs.map((d) => ({ fieldId: d.Id, type: d.Type, value: draft[d.Id] }));
    try {
      const res = await saveMutation.mutateAsync({
        Id: 0,
        CustomerName: customerName.trim(),
        Contact: contact.trim(),
        Channel: channel.value,
        CategoryId: category.value,
        Priority: priority.value,
        PipelineId: null,
        StageId: null,
        AssignedTo: assignee?.value ?? null,
        LinkedLeadId: null,
        Description: description.trim(),
        CustomJSON: JSON.stringify(customJson),
      });
      const newId = res?.Id;
      if (newId && attachmentsRef.current?.stagedCount) {
        const { failed } = await attachmentsRef.current.uploadStaged(newId);
        if (failed)
          enqueueSnackbar(`${failed} file(s) failed to upload — add them from the record`, {
            variant: "warning",
          });
      }
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      reset();
      onClose?.();
      onCreated?.(res);
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="lg" data-testid="create-ticket-modal">
      <Modal.Header
        title="New ticket"
        subtitle="Log a customer complaint — it starts in the first column of the board."
        icon={<Plus size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        {/* Wide 2-column grid: 3 input rows instead of a 6-row tower. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            columnGap: 16,
            rowGap: 14,
          }}
        >
          <TextInput
            label="Customer"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            required
            autoFocus
            placeholder="e.g. Acme Corp"
            data-testid="ticket-customer"
          />
          <TextInput
            label="Contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            required
            placeholder="Phone or email"
            data-testid="ticket-contact"
          />
          <Combobox
            label="Channel"
            options={CHANNEL_OPTIONS}
            value={channel}
            onChange={setChannel}
            required
            placeholder="How it came in"
            data-testid="ticket-channel"
          />
          <Combobox
            label="Category"
            options={categoryOpts}
            value={category}
            onChange={setCategory}
            required
            placeholder="Pick a category"
            data-testid="ticket-category"
          />
          <Combobox
            label="Priority"
            options={priorityOpts}
            value={priority}
            onChange={setPriority}
            required
            placeholder="Pick a priority"
            data-testid="ticket-priority"
          />
          <Combobox
            label="Assignee"
            options={assigneeOpts}
            value={assignee}
            onChange={setAssignee}
            placeholder="Unassigned"
            data-testid="ticket-assignee"
          />
          <div style={{ gridColumn: "1 / -1" }}>
            <TextArea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              placeholder="What is the customer reporting?"
              data-testid="ticket-description"
            />
          </div>
          {defs.length > 0 &&
            defs.map((def) => (
              <DynamicField
                key={def.Id}
                field={def}
                value={draft[def.Id]}
                onChange={(v) => setDraft((d) => ({ ...d, [def.Id]: v }))}
              />
            ))}
          <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Attachments</h3>
            <Attachments ref={attachmentsRef} entity="ticket" entityId={null} />
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={saveMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          loading={saveMutation.isPending}
          disabled={!canSubmit}
          data-testid="create-ticket-submit"
        >
          Create ticket
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
