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
import { useApiQuery } from "../../hooks/useApiQuery";
import { toUserOptions } from "../../utils/userShape";
import useAuthStore from "../../stores/useAuthStore";

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
  const currentUserId = useAuthStore((s) => s.user?.Id ?? s.UserId);
  const [type, setType] = useState("shared");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(TEMPLATES[0]);
  const [members, setMembers] = useState([]); // [{value, label}] for shared
  const [project, setProject] = useState(null); // {value, label} for project
  const [submitting, setSubmitting] = useState(false);

  const saveMutation = useApiMutation({
    endpoint: "/api/workspaces/saveWorkspace",
    showSuccessMessage: false,
  });

  // Users list — only needed for shared type, but fetch opportunistically
  // when the modal opens so switching to shared feels instant.
  const { data: usersPayload } = useApiQuery({
    queryKey: ["users", "pick-list"],
    endpoint: "/api/users/fetchUsers",
    params: { PageNumber: 1, PageSize: 200 },
    enabled: open,
    showErrorMessage: false,
  });
  const userOptions = toUserOptions(usersPayload?.users, { withJobTitle: true })
    .filter((o) => Number(o.value) !== Number(currentUserId))
    .map((o) => ({ value: Number(o.value), label: o.label }));

  // Projects list — only needed for project type.
  const { data: projectsPayload } = useApiQuery({
    queryKey: ["projects", "pick-list"],
    endpoint: "/api/projects/fetchProjects",
    params: { PageNumber: 1, PageSize: 200 },
    enabled: open && type === "project",
    showErrorMessage: false,
  });
  const projectOptions = (projectsPayload?.projects ?? [])
    .filter((pr) => pr?.TeamId)
    .map((pr) => ({
      value: pr.Id,
      label: pr.TeamName ? `${pr.Name} — ${pr.TeamName}` : pr.Name,
      teamId: pr.TeamId,
    }));

  const reset = () => {
    setType("shared");
    setName("");
    setTemplate(TEMPLATES[0]);
    setMembers([]);
    setProject(null);
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
    if (type === "project" && !project?.value) {
      enqueueSnackbar("Pick a project to link this workspace to", { variant: "warning" });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        Id: 0,
        Name: trimmed,
        Type: type,
        TemplateKey: template?.value ?? "basic",
      };
      if (type === "shared") {
        payload.Members = members.map((m) => m.value);
      }
      if (type === "project") {
        payload.ProjectId = project.value;
      }

      const saved = await saveMutation.mutateAsync(payload);
      const workspaceId = saved?.workspaceId;
      if (!workspaceId) throw new Error("missing workspaceId");

      const summary =
        type === "shared" && members.length
          ? `Workspace created. ${members.length} invite${members.length === 1 ? "" : "s"} sent.`
          : "Workspace created";
      enqueueSnackbar(summary, { variant: "success" });
      onCreated?.({ Id: workspaceId, Name: trimmed, Type: type, MyRole: "owner" });
      reset();
      onClose?.();
    } catch {
      // mutation hook surfaces error toast
    } finally {
      setSubmitting(false);
    }
  };

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
            placeholder={
              type === "personal"
                ? "e.g. My Tasks"
                : type === "shared"
                  ? "e.g. Marketing Q4"
                  : "e.g. Website Redesign"
            }
            autoFocus
            required
          />

          {type === "shared" && (
            <Combobox
              label="Invite members"
              hint="They'll get a pending invite and have to accept before they can see the board."
              options={userOptions}
              value={members}
              onChange={(arr) => setMembers(arr || [])}
              multiple
              placeholder="Pick teammates to invite"
              data-testid="workspace-members-select"
            />
          )}

          {type === "project" && (
            <Combobox
              label="Project"
              hint="Members are pulled from the project's team."
              options={projectOptions}
              value={project}
              onChange={setProject}
              placeholder="Pick a project"
              required
              data-testid="workspace-project-select"
            />
          )}

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
