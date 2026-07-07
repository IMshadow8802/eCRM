import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Modal, Button, TextInput, TextArea, Combobox } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
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
  const [pipeline, setPipeline] = useState(null);
  const [stage, setStage] = useState(null);
  const [assignee, setAssignee] = useState(null);
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState({});

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
  const { data: pipelinesData } = useApiQuery({
    queryKey: ["support-pipelines", "ticket"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchPipelines,
    params: { Entity: "ticket" },
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
  const pipelines = pipelinesData?.pipelines || [];
  const allStages = pipelinesData?.stages || [];
  const pipelineOpts = pipelines.map((p) => ({ value: p.Id, label: p.Name }));
  const stageOpts = useMemo(
    () =>
      allStages
        .filter((s) => s.PipelineId === pipeline?.value)
        .sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0))
        .map((s) => ({ value: s.Id, label: s.Name })),
    [allStages, pipeline]
  );
  const assigneeOpts = users.map((u) => ({ value: u.Id, label: getUserName(u) || u.Username }));
  const defs = defsData?.customFields || [];

  // Default to the company's default pipeline (or the first) once loaded.
  useEffect(() => {
    if (!open || pipeline || pipelines.length === 0) return;
    const def = pipelines.find((p) => p.IsDefault) || pipelines[0];
    setPipeline({ value: def.Id, label: def.Name });
  }, [open, pipeline, pipelines]);

  // Default the stage to the first stage of the selected pipeline.
  useEffect(() => {
    if (!pipeline || stageOpts.length === 0) return;
    setStage((cur) => cur ?? stageOpts[0]);
  }, [pipeline, stageOpts]);

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
    setPipeline(null);
    setStage(null);
    setAssignee(null);
    setDescription("");
    setDraft({});
  };

  const handleClose = () => {
    if (saveMutation.isPending) return;
    reset();
    onClose?.();
  };

  const canSubmit = customerName.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    const customJson = defs.map((d) => ({ fieldId: d.Id, type: d.Type, value: draft[d.Id] }));
    try {
      const res = await saveMutation.mutateAsync({
        Id: 0,
        CustomerName: customerName.trim(),
        Contact: contact.trim() || null,
        Channel: channel?.value ?? null,
        CategoryId: category?.value ?? null,
        Priority: priority?.value ?? null,
        PipelineId: pipeline?.value ?? null,
        StageId: stage?.value ?? null,
        AssignedTo: assignee?.value ?? null,
        LinkedLeadId: null,
        Description: description.trim() || null,
        CustomJSON: JSON.stringify(customJson),
      });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      reset();
      onClose?.();
      onCreated?.(res);
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="md" data-testid="create-ticket-modal">
      <Modal.Header
        title="New ticket"
        subtitle="Log a support request. It enters the pipeline at the first stage."
        icon={<Plus size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TextInput
            label="Customer"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            required
            autoFocus
            placeholder="e.g. Acme Corp"
            data-testid="ticket-customer"
          />
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <TextInput
                label="Contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Phone or email"
                data-testid="ticket-contact"
              />
            </div>
            <div style={{ flex: 1 }}>
              <Combobox
                label="Channel"
                options={CHANNEL_OPTIONS}
                value={channel}
                onChange={setChannel}
                placeholder="How it came in"
                data-testid="ticket-channel"
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Combobox
                label="Category"
                options={categoryOpts}
                value={category}
                onChange={setCategory}
                placeholder="Pick a category"
                data-testid="ticket-category"
              />
            </div>
            <div style={{ flex: 1 }}>
              <Combobox
                label="Priority"
                options={priorityOpts}
                value={priority}
                onChange={setPriority}
                placeholder="Pick a priority"
                data-testid="ticket-priority"
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Combobox
                label="Pipeline"
                options={pipelineOpts}
                value={pipeline}
                onChange={(opt) => {
                  setPipeline(opt);
                  setStage(null);
                }}
                placeholder="Pick a pipeline"
                data-testid="ticket-pipeline"
              />
            </div>
            <div style={{ flex: 1 }}>
              <Combobox
                label="Stage"
                options={stageOpts}
                value={stage}
                onChange={setStage}
                placeholder="Pick a stage"
                data-testid="ticket-stage"
              />
            </div>
          </div>
          <Combobox
            label="Assignee"
            options={assigneeOpts}
            value={assignee}
            onChange={setAssignee}
            placeholder="Unassigned"
            data-testid="ticket-assignee"
          />
          <TextArea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is the customer reporting?"
            data-testid="ticket-description"
          />
          {defs.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 16,
              }}
            >
              {defs.map((def) => (
                <DynamicField
                  key={def.Id}
                  field={def}
                  value={draft[def.Id]}
                  onChange={(v) => setDraft((d) => ({ ...d, [def.Id]: v }))}
                />
              ))}
            </div>
          )}
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
