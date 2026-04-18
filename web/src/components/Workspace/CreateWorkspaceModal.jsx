import { useState } from "react";
import { useTheme } from "@mui/material/styles";
import { enqueueSnackbar } from "notistack";
import { FolderKanban, Inbox, Users, Sparkles } from "lucide-react";

import {
  Modal,
  Button,
  TextInput,
  Combobox,
  RadioGroup,
} from "../ui";
import { useApiMutation } from "../../hooks/useApiMutation";

const TEMPLATES = [
  { value: "basic", label: "Basic", desc: "To Do / In Progress / Done" },
  { value: "scrum", label: "Scrum", desc: "Backlog / Sprint / In Progress / Review / Done" },
  { value: "bug", label: "Bug Triage", desc: "New / Triaged / In Progress / Fixed / Verified" },
  { value: "content", label: "Content", desc: "Idea / Draft / Review / Published" },
];

const TYPE_OPTIONS = [
  { value: "personal", label: "Personal", icon: <Inbox size={14} /> },
  { value: "shared", label: "Shared", icon: <Users size={14} /> },
  { value: "project", label: "Project", icon: <FolderKanban size={14} /> },
];

export default function CreateWorkspaceModal({
  open,
  onClose,
  onCreated,
  hasPersonal = false,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const [type, setType] = useState("shared");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(TEMPLATES[0]);
  const [submitting, setSubmitting] = useState(false);

  const saveMutation = useApiMutation({
    endpoint: "/api/workspaces/saveWorkspace",
    showSuccessMessage: false,
  });

  const reset = () => {
    setType("shared");
    setName("");
    setTemplate(TEMPLATES[0]);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose?.();
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      enqueueSnackbar("Workspace name is required", { variant: "warning" });
      return;
    }
    if (type === "personal" && hasPersonal) {
      enqueueSnackbar("You already have a personal workspace", { variant: "warning" });
      return;
    }

    setSubmitting(true);
    try {
      const saved = await saveMutation.mutateAsync({
        Id: 0,
        Name: trimmed,
        Type: type,
        TemplateKey: template?.value ?? "basic",
      });
      const workspaceId = saved?.workspaceId;
      if (!workspaceId) throw new Error("missing workspaceId");

      enqueueSnackbar("Workspace created", { variant: "success" });
      onCreated?.({ Id: workspaceId, Name: trimmed, Type: type, MyRole: "owner" });
      reset();
      onClose?.();
    } catch {
      // error fired
    } finally {
      setSubmitting(false);
    }
  };

  // Filter out Personal if already present
  const typeOptions = TYPE_OPTIONS.map((o) =>
    o.value === "personal" && hasPersonal ? { ...o, disabled: true } : o,
  );

  return (
    <Modal open={open} onClose={handleClose} size="md" data-testid="create-workspace-modal">
      <Modal.Header
        title="Create workspace"
        subtitle="Pick the kind of board that fits how you work."
        icon={<Sparkles size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 6,
                color: p.text.secondary,
              }}
            >
              Type
            </div>
            <RadioGroup
              value={type}
              onChange={setType}
              options={typeOptions}
              size="md"
            />
          </div>

          <TextInput
            label="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Marketing Q4"
            autoFocus
            required
          />

          <Combobox
            label="Kanban template"
            options={TEMPLATES}
            value={template}
            onChange={setTemplate}
            getOptionLabel={(o) => o?.label ?? ""}
            renderOption={(props, option) => (
              <li {...props} key={option.value}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{option.label}</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: p.text.tertiary,
                      marginTop: 2,
                    }}
                  >
                    {option.desc}
                  </div>
                </div>
              </li>
            )}
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={submitting}
          data-testid="workspace-create-submit"
        >
          Create workspace
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
