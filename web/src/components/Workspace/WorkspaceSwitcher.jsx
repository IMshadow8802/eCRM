import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@mui/material/styles";
import {
  ChevronDown,
  Plus,
  BookOpen,
  Handshake,
  Rocket,
  Eye,
  MailCheck,
  Archive,
  ArchiveRestore,
  Settings,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import CreateWorkspaceModal from "./CreateWorkspaceModal";
import InviteResponseModal from "./InviteResponseModal";
import WorkspaceSettingsModal from "./WorkspaceSettingsModal";
import {
  Button,
  Menu,
  Chip,
  Skeleton,
} from "../ui";

const TYPE_ICON = {
  personal: <BookOpen size={14} />,
  shared: <Handshake size={14} />,
  project: <Rocket size={14} />,
};
const TYPE_LABEL = {
  personal: "Personal",
  shared: "Shared",
  project: "Projects",
};

export default function WorkspaceSwitcher() {
  const theme = useTheme();
  const p = theme.tokens;
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteTarget, setInviteTarget] = useState(null);
  const [settingsTarget, setSettingsTarget] = useState(null);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  const {
    data: payload,
    isLoading,
    refetch,
  } = useApiQuery({
    queryKey: ["workspaces", "list"],
    endpoint: "/api/workspaces/fetchWorkspaces",
    params: { PageNumber: 1, PageSize: 100, IncludeArchived: true },
    showErrorMessage: true,
  });

  const restoreMutation = useApiMutation({
    endpoint: "/api/workspaces/archiveWorkspace",
    showSuccessMessage: false,
  });

  const allRows = payload?.workspaces ?? [];
  const workspaces = allRows.filter((w) => !w.IsArchived);
  const archived = allRows.filter((w) => w.IsArchived);
  const active = workspaces.find((w) => w.Id === activeWorkspaceId) ?? null;

  // The store persists a copy of the active workspace (role, type, name,
  // color). After a transfer/leave/join those go stale — when a fresh list
  // lands, push the server's row back into the store, and clear the selection
  // when the workspace is gone (deleted, left, archived, lost access).
  // Keyed on payload only: reconciling when the *selection* changes would
  // compare a brand-new pick against a stale list and wrongly clear it.
  useEffect(() => {
    if (!payload) return;
    const s = useWorkspaceStore.getState();
    if (!s.activeWorkspaceId) return;
    const rows = payload.workspaces ?? [];
    // An empty list never clears the selection: every real user owns at
    // least their personal workspace, so success-with-nothing is a degenerate
    // state (cold start, flaky fetch) — not proof the active board is gone.
    if (rows.length === 0) return;
    const fresh = rows.find((w) => w.Id === s.activeWorkspaceId);
    if (!fresh || fresh.IsArchived) {
      setActiveWorkspace(null);
      return;
    }
    if (
      (fresh.MyRole ?? null) !== s.activeWorkspaceRole ||
      (fresh.Type ?? null) !== s.activeWorkspaceType ||
      (fresh.Name ?? null) !== s.activeWorkspaceName ||
      (fresh.Color ?? null) !== s.activeWorkspaceColor
    ) {
      setActiveWorkspace(fresh);
    }
  }, [payload, setActiveWorkspace]);

  // Buckets per type:
  //   mine        — active member (MyRole set, InviteStatus='active')
  //   adminView   — admin-override visibility only (no membership)
  // Pending invites are held separately so they don't get mixed in.
  const grouped = useMemo(() => {
    const out = {
      personal: { mine: [], adminView: [] },
      shared: { mine: [], adminView: [] },
      project: { mine: [], adminView: [] },
    };
    const pending = [];
    for (const w of workspaces) {
      if (w.MyInviteStatus === "pending") {
        pending.push(w);
        continue;
      }
      if (!out[w.Type]) continue;
      const bucket = w.MyRole ? "mine" : "adminView";
      out[w.Type][bucket].push(w);
    }
    return { ...out, pending };
  }, [workspaces]);

  // A pending invite confronts the user on arrival: auto-open the response
  // modal once per mount (so every visit to Tasks re-asks until they accept
  // or decline), and chain to the next invite after each response. A manual
  // dismiss is respected for the rest of the mount — no unclosable loop.
  const autoPromptedRef = useRef(false);
  useEffect(() => {
    if (autoPromptedRef.current) return;
    if (grouped.pending.length === 0) return;
    autoPromptedRef.current = true;
    setInviteTarget(grouped.pending[0]);
  }, [grouped.pending]);

  const open = (e) => setAnchorEl(e.currentTarget);
  const close = () => setAnchorEl(null);
  const pick = (w) => {
    setActiveWorkspace(w);
    close();
  };
  const openInvite = (w) => {
    close();
    setInviteTarget(w);
  };

  // Build menu items. Pending invites surface at the top so the user can't
  // miss them. Then "Your X" per type, then admin-visible (read-only).
  const menuItems = [];
  if (grouped.pending.length > 0) {
    menuItems.push({ header: `Pending invites · ${grouped.pending.length}` });
    for (const w of grouped.pending) {
      menuItems.push({
        id: `pending-${w.Id}`,
        label: w.Name,
        icon: <MailCheck size={14} />,
        onClick: () => openInvite(w),
        testId: `pending-workspace-${w.Id}`,
      });
    }
  }
  for (const type of ["personal", "shared", "project"]) {
    const mine = grouped[type].mine;
    if (mine.length > 0) {
      menuItems.push({ header: `Your ${TYPE_LABEL[type]}` });
      for (const w of mine) {
        menuItems.push({
          id: w.Id,
          label: w.Name,
          icon: (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: theme.radii.sm,
                backgroundColor: w.Color ? `${w.Color}22` : p.primary.subtle,
                color: w.Color || p.primary.main,
              }}
            >
              {TYPE_ICON[type]}
            </span>
          ),
          onClick: () => pick(w),
          // Every member gets the gear: owners/managers manage, members can
          // at least leave from inside the settings modal. An explicit gear —
          // the default three-dot glyph read as decoration, not as a door.
          onSecondary: () => setSettingsTarget(w),
          secondaryIcon: <Settings size={14} />,
          secondaryLabel: `Settings for ${w.Name}`,
        });
      }
    }
  }
  for (const type of ["shared", "project"]) {
    const adminView = grouped[type].adminView;
    if (adminView.length === 0) continue;
    menuItems.push({
      header: `Admin view — ${TYPE_LABEL[type]} (read-only)`,
    });
    for (const w of adminView) {
      menuItems.push({
        id: w.Id,
        label: w.Name,
        icon: <Eye size={14} />,
        onClick: () => pick(w),
        testId: `admin-workspace-${w.Id}`,
      });
    }
  }
  const restore = async (w) => {
    try {
      await restoreMutation.mutateAsync({
        WorkspaceId: w.Id,
        IsArchived: false,
      });
      enqueueSnackbar("Workspace restored", { variant: "success" });
      queryClient.invalidateQueries({
        queryKey: ["workspaces", "list"],
        refetchType: "all",
      });
    } catch {
      // hook toasts
    }
  };

  menuItems.push({ header: "Archived" });
  if (archived.length === 0) {
    menuItems.push({
      id: "archived-empty",
      label: "Nothing archived",
      muted: true,
      disabled: true,
    });
  } else {
    for (const w of archived) {
      menuItems.push({
        id: `archived-${w.Id}`,
        label: w.Name,
        muted: true,
        icon: <Archive size={14} />,
        // Row click opens settings (where Delete lives for archived boards).
        onClick: () => setSettingsTarget(w),
        onSecondary: () => restore(w),
        secondaryIcon: <ArchiveRestore size={14} />,
        secondaryLabel: "Restore",
        secondaryKey: "restore",
      });
    }
  }

  menuItems.push({
    id: "create",
    label: "Create workspace",
    icon: <Plus size={14} />,
    onClick: () => {
      close();
      setCreateOpen(true);
    },
  });

  return (
    <>
      <button
        type="button"
        data-testid="workspace-switcher-button"
        onClick={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          minWidth: 220,
          padding: "8px 12px",
          borderRadius: theme.radii.md,
          backgroundColor: p.surface.card,
          border: `1px solid ${p.border.default}`,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 14,
          color: p.text.primary,
          boxShadow: p.shadow.xs,
          textAlign: "left",
          transition:
            "border-color 240ms cubic-bezier(0.4,0,0.2,1), box-shadow 240ms cubic-bezier(0.4,0,0.2,1)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = p.border.strong;
          e.currentTarget.style.boxShadow = p.shadow.sm;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = p.border.default;
          e.currentTarget.style.boxShadow = p.shadow.xs;
        }}
      >
        {isLoading && !active ? (
          <Skeleton variant="text" width={140} />
        ) : active ? (
          <>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                borderRadius: theme.radii.sm,
                backgroundColor: active.Color
                  ? `${active.Color}22`
                  : p.primary.subtle,
                color: active.Color || p.primary.main,
              }}
            >
              {TYPE_ICON[active.Type]}
            </span>
            <span
              style={{
                flex: 1,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {active.Name}
            </span>
            <Chip
              label={active.MyRole ?? "admin view"}
              tone={active.MyRole ? "primary" : "warning"}
              variant="tonal"
              size="sm"
            />
          </>
        ) : (
          <span
            style={{
              flex: 1,
              fontStyle: "italic",
              color: p.text.secondary,
            }}
          >
            Pick a workspace
          </span>
        )}
        {grouped.pending.length > 0 && (
          <Chip
            label={grouped.pending.length}
            tone="warning"
            variant="tonal"
            size="sm"
            data-testid="pending-invites-badge"
          />
        )}
        <ChevronDown size={16} style={{ color: p.text.tertiary }} />
      </button>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        items={menuItems}
        data-testid="workspace-menu"
      />

      {workspaces.length === 0 && !isLoading && !anchorEl && null}

      <CreateWorkspaceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(w) => {
          setActiveWorkspace(w);
          refetch();
        }}
        hasPersonal={grouped.personal.mine.length > 0}
      />

      {inviteTarget && (
        <InviteResponseModal
          workspace={inviteTarget}
          onClose={() => setInviteTarget(null)}
          onResponded={(w, action) => {
            queryClient.invalidateQueries({
              queryKey: ["workspaces", "list"],
              refetchType: "all",
            });
            const next = grouped.pending.find((pw) => pw.Id !== w.Id);
            setInviteTarget(next ?? null);
            if (action === "accept") {
              setActiveWorkspace({ ...w, MyRole: "member" });
            }
          }}
        />
      )}

      {settingsTarget && (
        <WorkspaceSettingsModal
          workspace={settingsTarget}
          onClose={() => setSettingsTarget(null)}
          onChanged={({ kind, workspace: w }) => {
            // Edit keeps the same Id → update in place, stay on the board.
            // Archive/delete/leave remove it from view → clear active so the
            // user lands back on the workspace picker.
            if (kind === "edit") {
              if (activeWorkspaceId === w.Id) setActiveWorkspace(w);
            } else if (activeWorkspaceId === w.Id) {
              setActiveWorkspace(null);
            }
          }}
        />
      )}
    </>
  );
}
