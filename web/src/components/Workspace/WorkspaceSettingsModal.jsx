import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { enqueueSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2, Archive } from "lucide-react";

import { Modal, Button, TextInput, Combobox } from "../ui";
import { useApiMutation } from "../../hooks/useApiMutation";

const COLOR_OPTIONS = [
  { value: "#6366F1", label: "Indigo" },
  { value: "#10B981", label: "Emerald" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#EF4444", label: "Red" },
  { value: "#8B5CF6", label: "Violet" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#EC4899", label: "Pink" },
  { value: "#94A3B8", label: "Slate" },
];

/**
 * Inline settings for a single workspace: rename, pick a color, archive.
 * Archive is soft (sp_ArchiveWorkspace); the workspace stays in DB but
 * drops off the switcher for everyone.
 */
export default function WorkspaceSettingsModal({
  workspace,
  onClose,
  onChanged,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const queryClient = useQueryClient();
  const [name, setName] = useState(workspace?.Name ?? "");
  const [color, setColor] = useState(
    COLOR_OPTIONS.find((c) => c.value === workspace?.Color) ?? COLOR_OPTIONS[0],
  );

  useEffect(() => {
    setName(workspace?.Name ?? "");
    setColor(
      COLOR_OPTIONS.find((c) => c.value === workspace?.Color) ?? COLOR_OPTIONS[0],
    );
  }, [workspace?.Id]);

  const saveMutation = useApiMutation({
    endpoint: "/api/workspaces/saveWorkspace",
    showSuccessMessage: false,
  });
  const archiveMutation = useApiMutation({
    endpoint: "/api/workspaces/archiveWorkspace",
    showSuccessMessage: false,
  });

  const isOwner = workspace?.MyRole === "owner";
  const canEdit = isOwner;

  const saveChanges = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      enqueueSnackbar("Name can't be empty", { variant: "warning" });
      return;
    }
    try {
      await saveMutation.mutateAsync({
        Id: workspace.Id,
        Name: trimmed,
        Type: workspace.Type,
        Color: color.value,
        TeamId: workspace.TeamId ?? null,
        ProjectId: workspace.ProjectId ?? null,
      });
      enqueueSnackbar("Workspace updated", { variant: "success" });
      queryClient.invalidateQueries({
        queryKey: ["workspaces", "list"],
        refetchType: "all",
      });
      // Rename/color: same Id, keep it active. Parent just syncs fresh fields.
      onChanged?.({
        kind: "edit",
        workspace: { ...workspace, Name: trimmed, Color: color.value },
      });
      onClose?.();
    } catch {
      // hook toasts
    }
  };

  const archive = async () => {
    try {
      await archiveMutation.mutateAsync({
        WorkspaceId: workspace.Id,
        IsArchived: true,
      });
      enqueueSnackbar("Workspace archived", { variant: "success" });
      queryClient.invalidateQueries({
        queryKey: ["workspaces", "list"],
        refetchType: "all",
      });
      // Archive: active workspace is now gone, tell parent to clear it.
      onChanged?.({ kind: "archive", workspace });
      onClose?.();
    } catch {
      // hook toasts
    }
  };

  return (
    <Modal
      open={Boolean(workspace)}
      onClose={onClose}
      size="sm"
      data-testid="workspace-settings-modal"
    >
      <Modal.Header
        title="Workspace settings"
        subtitle={workspace?.Name}
        icon={<Settings2 size={18} />}
        onClose={onClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            autoFocus
            required
            data-testid="workspace-settings-name"
          />
          <Combobox
            label="Color"
            options={COLOR_OPTIONS}
            value={color}
            onChange={(v) => setColor(v ?? COLOR_OPTIONS[0])}
            disabled={!canEdit}
          />
          {!canEdit && (
            <div
              style={{
                fontSize: 12,
                color: p.text.tertiary,
                fontStyle: "italic",
              }}
            >
              Only the workspace owner can edit settings.
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer align="between">
        {canEdit ? (
          <Button
            variant="ghost"
            leftIcon={<Archive size={14} />}
            onClick={archive}
            loading={archiveMutation.isPending}
            data-testid="workspace-settings-archive"
          >
            Archive
          </Button>
        ) : (
          <span />
        )}
        <div style={{ display: "inline-flex", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {canEdit && (
            <Button
              variant="primary"
              onClick={saveChanges}
              loading={saveMutation.isPending}
              data-testid="workspace-settings-save"
            >
              Save changes
            </Button>
          )}
        </div>
      </Modal.Footer>
    </Modal>
  );
}
