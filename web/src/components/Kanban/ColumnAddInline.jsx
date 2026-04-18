import { useState } from "react";
import { useTheme } from "@mui/material/styles";
import { Plus } from "lucide-react";

import { TextInput } from "../ui";
import { useApiMutation } from "../../hooks/useApiMutation";

/**
 * Trailing "+ Add column" tile rendered at the end of the kanban strip.
 * Only managers/owners/admins see it (the caller gates rendering).
 * Writes via sp_SaveKanbanColumn; on success fires onCreated for the
 * parent to refetch the columns query.
 */
export default function ColumnAddInline({ workspaceId, onCreated }) {
  const theme = useTheme();
  const p = theme.tokens;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");

  const saveMutation = useApiMutation({
    endpoint: "/api/kanban/saveKanbanColumn",
    showSuccessMessage: false,
  });

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      setEditing(false);
      return;
    }
    try {
      await saveMutation.mutateAsync({
        Id: 0,
        WorkspaceId: workspaceId,
        Title: t,
        Color: "#94A3B8",
        SortOrder: 0, // SP auto-appends
        IsActive: true,
      });
      setTitle("");
      setEditing(false);
      onCreated?.();
    } catch {
      // error toast from hook; keep the editor open
    }
  };

  if (editing) {
    return (
      <div
        data-testid="column-add-editor"
        style={{
          flex: "0 0 280px",
          minWidth: 280,
          backgroundColor: p.surface.subtle,
          borderRadius: theme.radii.lg,
          border: `1px solid ${p.primary.border}`,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <TextInput
          size="sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Column title, Enter to save"
          autoFocus
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              setEditing(false);
              setTitle("");
            }
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="column-add-button"
      onClick={() => setEditing(true)}
      style={{
        flex: "0 0 220px",
        minWidth: 220,
        padding: "16px 14px",
        border: `1.5px dashed ${p.border.default}`,
        borderRadius: theme.radii.lg,
        backgroundColor: "transparent",
        color: p.text.secondary,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        transition:
          "background-color 240ms cubic-bezier(0.4,0,0.2,1), border-color 240ms cubic-bezier(0.4,0,0.2,1)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = p.primary.border;
        e.currentTarget.style.color = p.primary.main;
        e.currentTarget.style.backgroundColor = p.surface.card;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = p.border.default;
        e.currentTarget.style.color = p.text.secondary;
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <Plus size={14} />
      Add column
    </button>
  );
}
