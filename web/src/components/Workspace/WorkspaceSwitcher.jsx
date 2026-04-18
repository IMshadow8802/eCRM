import { useMemo, useState } from "react";
import { useTheme } from "@mui/material/styles";
import {
  ChevronDown,
  Plus,
  Inbox,
  Users,
  FolderKanban,
  Eye,
  MailCheck,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useApiQuery } from "../../hooks/useApiQuery";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import CreateWorkspaceModal from "./CreateWorkspaceModal";
import InviteResponseModal from "./InviteResponseModal";
import {
  Button,
  Menu,
  Chip,
  Skeleton,
} from "../ui";

const TYPE_ICON = {
  personal: <Inbox size={14} />,
  shared: <Users size={14} />,
  project: <FolderKanban size={14} />,
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
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  const {
    data: payload,
    isLoading,
    refetch,
  } = useApiQuery({
    queryKey: ["workspaces", "list"],
    endpoint: "/api/workspaces/fetchWorkspaces",
    params: { PageNumber: 1, PageSize: 100, IncludeArchived: false },
    showErrorMessage: true,
  });

  const workspaces = payload?.workspaces ?? [];
  const active = workspaces.find((w) => w.Id === activeWorkspaceId) ?? null;

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
          icon: TYPE_ICON[type],
          onClick: () => pick(w),
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
                backgroundColor: p.primary.subtle,
                color: p.primary.main,
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
            if (action === "accept") {
              setActiveWorkspace({ ...w, MyRole: "member" });
            }
          }}
        />
      )}
    </>
  );
}
