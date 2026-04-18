import { useState } from "react";
import { Plus } from "lucide-react";

import {
  Modal,
  Button,
  TextInput,
  TextArea,
  Combobox,
  DateField,
  RadioGroup,
} from "../../../components/ui";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { useApiQuery } from "../../../hooks/useApiQuery";
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
  const [assignee, setAssignee] = useState(null);
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: usersPayload } = useApiQuery({
    queryKey: ["users", "pick-list"],
    endpoint: "/api/users/fetchUsers",
    params: { PageNumber: 1, PageSize: 200 },
    enabled: open,
    showErrorMessage: false,
  });
  const userOptions = (usersPayload?.users ?? []).map((u) => ({
    value: u.Id,
    label: u.FullName || u.Username,
  }));

  const saveMutation = useApiMutation({
    endpoint: "/api/tasks/saveTask",
    showSuccessMessage: false,
  });

  const reset = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAssignee(null);
    setDueDate("");
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose?.();
  };

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await saveMutation.mutateAsync({
        Id: 0,
        Title: title.trim(),
        Description: description,
        WorkspaceId: workspaceId,
        ColumnId: columnId,
        Priority: priority,
        AssignedToUserId: isPersonal
          ? currentUserId
          : assignee?.value || null,
        DueDate: dueDate || null,
      });
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
            : "Capture something to do. Add details later."
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
            rows={4}
            autoGrow
            placeholder="Optional context, links, acceptance criteria…"
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--color-surface-600, #475569)" }}>
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
                  label="Assignee"
                  options={userOptions}
                  value={assignee}
                  onChange={setAssignee}
                  placeholder="Unassigned"
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
          disabled={!title.trim()}
          data-testid="create-task-submit"
        >
          Create task
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
