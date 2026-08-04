import { useRef, useState } from "react";
import { enqueueSnackbar } from "notistack";
import { Plus, Trash2 } from "lucide-react";

import {
  Modal,
  Button,
  TextInput,
  TextArea,
  Combobox,
  DateField,
  RadioGroup,
} from "../../../components/ui";
import Attachments from "../../../components/Attachments";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { TASK_ENDPOINTS } from "../../../api/taskQueries";
import useWorkspaceMemberOptions from "../../../hooks/useWorkspaceMemberOptions";
import useWorkspaceStore from "../../../stores/useWorkspaceStore";
import useAuthStore from "../../../stores/useAuthStore";

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export default function TaskCreateModal({
  open,
  onClose,
  workspaceId,
  columnId = null,
  columnTitle = null,
  onCreated,
}) {
  const workspaceType = useWorkspaceStore((s) => s.activeWorkspaceType);
  const currentUserId = useAuthStore((s) => s.user?.Id ?? s.UserId);
  const isPersonal = workspaceType === "personal";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignees, setAssignees] = useState([]);
  const [dueDate, setDueDate] = useState("");
  const [steps, setSteps] = useState([""]);
  const [submitting, setSubmitting] = useState(false);
  const attachmentsRef = useRef(null);

  // Only workspace members can be assigned — the server rejects anyone else, so
  // offering the whole company would just produce a confusing 400.
  const { options: memberOptions } = useWorkspaceMemberOptions(workspaceId, {
    enabled: open && !isPersonal,
  });

  const saveMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.tasks.saveTask,
    showSuccessMessage: false,
  });

  const reset = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAssignees([]);
    setDueDate("");
    setSteps([""]);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose?.();
  };

  const trimmedSteps = steps.map((s) => s.trim()).filter(Boolean);
  const canSubmit = title.trim().length > 0 && trimmedSteps.length > 0;

  const updateStep = (idx, val) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? val : s)));
  };
  const addStep = () => setSteps((prev) => [...prev, ""]);
  const removeStep = (idx) => {
    setSteps((prev) => (prev.length === 1 ? [""] : prev.filter((_, i) => i !== idx)));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await saveMutation.mutateAsync({
        Id: 0,
        Title: title.trim(),
        Description: description,
        WorkspaceId: workspaceId,
        ColumnId: columnId,
        Priority: priority,
        // Personal workspaces have no member rows — the owner is the only
        // possible assignee, so assign them implicitly instead of asking.
        AssigneeIds: isPersonal
          ? [currentUserId].filter(Boolean)
          : assignees.map((a) => a.value),
        DueDate: dueDate || null,
        ChecklistItems: trimmedSteps,
      });
      const newId = res?.taskId;
      if (newId && attachmentsRef.current?.stagedCount) {
        const { failed } = await attachmentsRef.current.uploadStaged(newId);
        if (failed)
          enqueueSnackbar(`${failed} file(s) failed to upload — add them from the record`, {
            variant: "warning",
          });
      }
      onCreated?.(res);
      reset();
      onClose?.();
    } catch {
      // handled
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="md" data-testid="create-task-modal">
      <Modal.Header
        title="New task"
        subtitle={
          columnTitle
            ? `Lands in “${columnTitle}” column.`
            : "Break the work into steps. The task completes when every step is ticked."
        }
        icon={<Plus size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TextInput
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            placeholder="e.g. Prepare sprint demo"
          />
          <TextArea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            autoGrow
            placeholder="Optional context, links, acceptance criteria…"
          />
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 6,
                color: "var(--color-surface-600, #475569)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>
                Checklist <span style={{ color: "var(--color-danger, #dc2626)" }}>*</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-surface-500, #64748b)" }}>
                At least one. Task auto-completes when all ticked.
              </span>
            </div>
            <div
              data-testid="create-task-steps"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <TextInput
                    size="sm"
                    value={step}
                    onChange={(e) => updateStep(idx, e.target.value)}
                    placeholder={idx === 0 ? "e.g. Draft outline" : "Another item…"}
                    data-testid={`create-task-step-${idx}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeStep(idx)}
                    disabled={steps.length === 1 && !step}
                    aria-label="Remove checklist item"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={addStep}
                type="button"
                data-testid="create-task-add-step"
                style={{ alignSelf: "flex-start" }}
              >
                <Plus size={14} style={{ marginRight: 4 }} /> Add item
              </Button>
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 6,
                color: "var(--color-surface-600, #475569)",
              }}
            >
              Priority
            </div>
            <RadioGroup
              value={priority}
              onChange={setPriority}
              options={PRIORITIES}
              size="sm"
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {!isPersonal && (
              <div style={{ flex: 1 }}>
                <Combobox
                  label="Assignees"
                  options={memberOptions}
                  value={assignees}
                  onChange={(arr) => setAssignees(arr || [])}
                  multiple
                  placeholder={assignees.length ? "" : "Unassigned"}
                  data-testid="create-task-assignees"
                />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <DateField
                label="Due date"
                value={dueDate || null}
                onChange={setDueDate}
              />
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 6,
                color: "var(--color-surface-600, #475569)",
              }}
            >
              Attachments
            </div>
            <Attachments ref={attachmentsRef} entity="task" entityId={null} />
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          loading={submitting}
          disabled={!canSubmit}
          data-testid="create-task-submit"
        >
          Create task
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
