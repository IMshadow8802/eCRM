import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { enqueueSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import {
  Settings2,
  Archive,
  Handshake,
  Trash2,
  LogOut,
  Crown,
  RefreshCw,
  AlertTriangle,
  UserPlus,
  X,
} from "lucide-react";

import { Modal, Button, TextInput, Combobox, Chip, IconButton } from "../ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useApiQuery } from "../../hooks/useApiQuery";
import { apiClient } from "../../utils/axiosConfig";
import { toUserOptions } from "../../utils/userShape";
import useAuthStore from "../../stores/useAuthStore";

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

// Backend may return counts PascalCase (contract) or camelCase (controller).
const pick = (d, ...keys) => {
  for (const k of keys) if (d?.[k] != null) return d[k];
  return 0;
};

/** Small reusable confirm dialog rendered on top of the settings modal. */
function ConfirmModal({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  confirmVariant = "primary",
  confirmDisabled = false,
  loading = false,
  onConfirm,
  testId,
  children,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid={testId}>
      <Modal.Header
        title={title}
        icon={<AlertTriangle size={18} />}
        onClose={onClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 14, color: p.text.secondary, lineHeight: 1.5 }}>
            {body}
          </div>
          {children}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} data-testid={testId ? `${testId}-cancel` : undefined}>
          Cancel
        </Button>
        <Button
          variant={confirmVariant}
          onClick={onConfirm}
          disabled={confirmDisabled}
          loading={loading}
          data-testid={testId ? `${testId}-confirm` : undefined}
        >
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function SectionTitle({ children }) {
  const theme = useTheme();
  const p = theme.tokens;
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: p.text.tertiary,
        borderTop: `1px solid ${p.border.default}`,
        paddingTop: 12,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Settings for a single workspace: rename, color, and the full lifecycle —
 * share a personal board, archive/delete, leave, hand over ownership, and
 * (project boards) sync members from the team.
 */
export default function WorkspaceSettingsModal({
  workspace,
  onClose,
  onChanged,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.Id ?? s.user?.UserId);
  const isAdmin = useAuthStore((s) => Boolean(s.user?.IsAdmin));

  const [name, setName] = useState(workspace?.Name ?? "");
  const [color, setColor] = useState(
    COLOR_OPTIONS.find((c) => c.value === workspace?.Color) ?? COLOR_OPTIONS[0],
  );
  const [confirming, setConfirming] = useState(null); // 'archive'|'share'|'leave'|'delete'
  const [shareMembers, setShareMembers] = useState([]);
  const [newOwner, setNewOwner] = useState(null);
  const [deleteInfo, setDeleteInfo] = useState(null); // blast radius from dry run
  const [deleteName, setDeleteName] = useState("");
  const [invitee, setInvitee] = useState(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    setName(workspace?.Name ?? "");
    setColor(
      COLOR_OPTIONS.find((c) => c.value === workspace?.Color) ?? COLOR_OPTIONS[0],
    );
    setConfirming(null);
    setShareMembers([]);
    setNewOwner(null);
    setDeleteInfo(null);
    setDeleteName("");
    setInvitee(null);
  }, [workspace?.Id]);

  const isOwner =
    workspace?.MyRole === "owner" ||
    Number(workspace?.OwnerUserId) === Number(currentUserId);
  const type = workspace?.Type;
  const isArchived = Boolean(workspace?.IsArchived);
  const canEdit = workspace?.MyRole === "owner";
  const canShare = type === "personal" && isOwner && !isArchived;
  const canTransfer =
    (type === "shared" || type === "project") && (isOwner || isAdmin);
  const canSync =
    type === "project" &&
    (isOwner || workspace?.MyRole === "manager" || isAdmin);
  const canLeave =
    (type === "shared" || type === "project") &&
    Boolean(workspace?.MyRole) &&
    workspace?.MyRole !== "owner";
  const canArchiveOrDelete = isOwner || isAdmin;
  const isMemberBoard = type === "shared" || type === "project";
  const canManageMembers =
    isOwner || workspace?.MyRole === "manager" || isAdmin;

  // Users pick-list, reused for share invites, the new-owner picker and the
  // invite-people picker. ponytail: the new-owner picker offers all company
  // users; the SP rejects non-members with a clear message.
  const { data: usersPayload } = useApiQuery({
    queryKey: ["users", "pick-list"],
    endpoint: "/api/users/fetchUsers",
    params: { PageNumber: 1, PageSize: 200 },
    enabled: Boolean(workspace) && (canShare || canTransfer || canManageMembers),
    showErrorMessage: false,
  });
  const userOptions = toUserOptions(usersPayload?.users, { withJobTitle: true })
    .filter((o) => Number(o.value) !== Number(currentUserId))
    .map((o) => ({ value: Number(o.value), label: o.label }));

  const { data: membersPayload } = useApiQuery({
    queryKey: ["workspace-members", workspace?.Id],
    endpoint: "/api/workspaces/fetchWorkspaceMembers",
    params: { WorkspaceId: workspace?.Id },
    enabled: Boolean(workspace?.Id) && isMemberBoard,
    showErrorMessage: false,
  });
  const members = membersPayload?.members ?? [];
  // Users already on the board (active or pending) can't be invited again.
  const inviteOptions = userOptions.filter(
    (o) =>
      !members.some(
        (m) =>
          Number(m.UserId) === o.value &&
          (m.InviteStatus === "active" || m.InviteStatus === "pending"),
      ),
  );

  const quiet = { showSuccessMessage: false };
  const saveMutation = useApiMutation({
    endpoint: "/api/workspaces/saveWorkspace",
    ...quiet,
  });
  const archiveMutation = useApiMutation({
    endpoint: "/api/workspaces/archiveWorkspace",
    ...quiet,
  });
  const convertMutation = useApiMutation({
    endpoint: "/api/workspaces/convertWorkspaceToShared",
    ...quiet,
  });
  const deleteMutation = useApiMutation({
    endpoint: "/api/workspaces/deleteWorkspace",
    ...quiet,
  });
  const transferMutation = useApiMutation({
    endpoint: "/api/workspaces/transferWorkspaceOwnership",
    ...quiet,
  });
  const syncMutation = useApiMutation({
    endpoint: "/api/workspaces/syncProjectWorkspaceMembers",
    ...quiet,
  });
  const leaveMutation = useApiMutation({
    endpoint: "/api/workspaces/removeWorkspaceMember",
    ...quiet,
  });

  // One sweep for every lifecycle mutation: the workspace list (so the
  // switcher's role/ownership reconciliation fires) and the member roster.
  const refreshList = () => {
    queryClient.invalidateQueries({
      queryKey: ["workspaces", "list"],
      refetchType: "all",
    });
    queryClient.invalidateQueries({
      queryKey: ["workspace-members"],
      refetchType: "all",
    });
  };

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
      refreshList();
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
      refreshList();
      onChanged?.({ kind: "archive", workspace });
      onClose?.();
    } catch {
      setConfirming(null);
    }
  };

  const share = async () => {
    try {
      await convertMutation.mutateAsync({
        WorkspaceId: workspace.Id,
        MemberIds: shareMembers.map((m) => m.value),
      });
      enqueueSnackbar(
        `Workspace shared. ${shareMembers.length} invite${shareMembers.length === 1 ? "" : "s"} sent.`,
        { variant: "success" },
      );
      refreshList();
      onChanged?.({ kind: "edit", workspace: { ...workspace, Type: "shared" } });
      onClose?.();
    } catch {
      setConfirming(null);
    }
  };

  const startDelete = async () => {
    try {
      const data = await deleteMutation.mutateAsync({
        WorkspaceId: workspace.Id,
        DryRun: true,
      });
      setDeleteInfo({
        tasks: pick(data, "TaskCount", "taskCount"),
        comments: pick(data, "CommentCount", "commentCount"),
        files: pick(data, "AttachmentCount", "attachmentCount"),
      });
      setDeleteName("");
      setConfirming("delete");
    } catch {
      // hook toasts (e.g. "archive first" from the server)
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteMutation.mutateAsync({
        WorkspaceId: workspace.Id,
        DryRun: false,
      });
      enqueueSnackbar("Workspace deleted", { variant: "success" });
      refreshList();
      onChanged?.({ kind: "delete", workspace });
      onClose?.();
    } catch {
      setConfirming(null);
    }
  };

  const transfer = async () => {
    if (!newOwner) return;
    try {
      await transferMutation.mutateAsync({
        WorkspaceId: workspace.Id,
        NewOwnerUserId: newOwner.value,
      });
      enqueueSnackbar(`${newOwner.label} is now the owner`, {
        variant: "success",
      });
      refreshList();
      onChanged?.({
        kind: "edit",
        workspace: {
          ...workspace,
          OwnerUserId: newOwner.value,
          MyRole: isOwner ? "manager" : workspace.MyRole,
        },
      });
      onClose?.();
    } catch {
      // hook toasts
    }
  };

  const syncFromTeam = async () => {
    try {
      const data = await syncMutation.mutateAsync({
        WorkspaceId: workspace.Id,
      });
      const added = pick(data, "MembersAddedOrRestored", "membersAddedOrRestored");
      const removed = pick(data, "MembersDeactivated", "membersDeactivated");
      enqueueSnackbar(`${added} added, ${removed} removed`, {
        variant: "success",
      });
      refreshList();
    } catch {
      // hook toasts
    }
  };

  // Invite / re-invite. The server upserts (a removed/declined row goes back
  // to pending) and its message says which happened — surface it verbatim.
  const inviteUser = async (userId) => {
    setInviting(true);
    try {
      const res = await apiClient.post("/api/workspaces/addWorkspaceMember", {
        WorkspaceId: workspace.Id,
        UserId: userId,
        Role: "member",
      });
      if (!res.data.success) throw new Error(res.data.message);
      enqueueSnackbar(res.data.message || "Invite sent", { variant: "success" });
      setInvitee(null);
      refreshList();
    } catch (err) {
      enqueueSnackbar(
        err.response?.data?.message || err.message || "Could not send invite",
        { variant: "error" },
      );
    } finally {
      setInviting(false);
    }
  };

  const removeMember = async (userId) => {
    try {
      await leaveMutation.mutateAsync({
        WorkspaceId: workspace.Id,
        UserId: userId,
      });
      enqueueSnackbar("Member removed", { variant: "success" });
      refreshList();
    } catch {
      // hook toasts
    }
  };

  const leave = async () => {
    try {
      await leaveMutation.mutateAsync({
        WorkspaceId: workspace.Id,
        UserId: currentUserId,
      });
      enqueueSnackbar("You left the workspace", { variant: "success" });
      refreshList();
      onChanged?.({ kind: "leave", workspace });
      onClose?.();
    } catch {
      setConfirming(null);
    }
  };

  const hintStyle = {
    fontSize: 12,
    color: p.text.tertiary,
    fontStyle: "italic",
  };
  const deleteNameOk =
    !deleteInfo ||
    deleteInfo.tasks === 0 ||
    deleteName.trim() === (workspace?.Name ?? "").trim();

  return (
    <>
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
              <div style={hintStyle}>
                Only the workspace owner can edit settings.
              </div>
            )}

            {canShare && (
              <>
                <SectionTitle>Share this workspace</SectionTitle>
                <Combobox
                  label="Invite people"
                  hint="They'll get an invite and must accept before they see the board."
                  options={userOptions}
                  value={shareMembers}
                  onChange={(arr) => setShareMembers(arr || [])}
                  multiple
                  placeholder="Pick teammates to invite"
                  data-testid="workspace-share-members"
                />
                <div>
                  <Button
                    variant="secondary"
                    leftIcon={<Handshake size={14} />}
                    disabled={shareMembers.length === 0}
                    onClick={() => setConfirming("share")}
                    data-testid="workspace-share-button"
                  >
                    Share this workspace
                  </Button>
                </div>
              </>
            )}

            {isMemberBoard && members.length > 0 && (
              <>
                <SectionTitle>Members</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {members.map((m) => {
                    const gone =
                      m.InviteStatus === "removed" ||
                      m.InviteStatus === "declined";
                    return (
                      <div
                        key={m.UserId}
                        data-testid={`member-row-${m.UserId}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          opacity: gone ? 0.55 : 1,
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            fontWeight: 500,
                            color: p.text.primary,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.FullName || m.Username}
                        </span>
                        {m.InviteStatus === "pending" ? (
                          <span style={hintStyle}>Waiting for reply</span>
                        ) : (
                          !gone && (
                            <Chip
                              label={m.IsOwner ? "owner" : m.Role}
                              tone={m.IsOwner ? "primary" : "default"}
                              variant="tonal"
                              size="sm"
                            />
                          )
                        )}
                        {gone && canManageMembers && (
                          <Button
                            size="sm"
                            variant="tonal"
                            loading={inviting}
                            onClick={() => inviteUser(m.UserId)}
                            data-testid={`member-reinvite-${m.UserId}`}
                          >
                            Re-invite
                          </Button>
                        )}
                        {canManageMembers &&
                          !m.IsOwner &&
                          m.InviteStatus === "active" &&
                          Number(m.UserId) !== Number(currentUserId) && (
                            <IconButton
                              size="sm"
                              variant="ghost"
                              aria-label="Remove member"
                              onClick={() => removeMember(m.UserId)}
                              data-testid={`member-remove-${m.UserId}`}
                            >
                              <X size={14} />
                            </IconButton>
                          )}
                      </div>
                    );
                  })}
                </div>
                {canManageMembers && (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <Combobox
                      label="Invite people"
                      options={inviteOptions}
                      value={invitee}
                      onChange={setInvitee}
                      placeholder="Pick a teammate"
                      data-testid="member-invite-select"
                    />
                    <Button
                      variant="secondary"
                      leftIcon={<UserPlus size={14} />}
                      disabled={!invitee}
                      loading={inviting}
                      onClick={() => inviteUser(invitee.value)}
                      data-testid="member-invite-button"
                    >
                      Invite
                    </Button>
                  </div>
                )}
              </>
            )}

            {canSync && (
              <>
                <SectionTitle>Team members</SectionTitle>
                <div>
                  <Button
                    variant="secondary"
                    leftIcon={<RefreshCw size={14} />}
                    onClick={syncFromTeam}
                    loading={syncMutation.isPending}
                    data-testid="workspace-sync-button"
                  >
                    Sync members from team
                  </Button>
                </div>
              </>
            )}

            {canTransfer && (
              <>
                <SectionTitle>Change owner</SectionTitle>
                <Combobox
                  label="New owner"
                  options={userOptions}
                  value={newOwner}
                  onChange={setNewOwner}
                  placeholder="Pick the new owner"
                  data-testid="workspace-transfer-select"
                />
                <div style={hintStyle}>
                  You will stay in the workspace as a manager.
                </div>
                <div>
                  <Button
                    variant="secondary"
                    leftIcon={<Crown size={14} />}
                    disabled={!newOwner}
                    onClick={transfer}
                    loading={transferMutation.isPending}
                    data-testid="workspace-transfer-button"
                  >
                    Make owner
                  </Button>
                </div>
              </>
            )}

            {canLeave && (
              <>
                <SectionTitle>Leave</SectionTitle>
                <div>
                  <Button
                    variant="secondary"
                    leftIcon={<LogOut size={14} />}
                    onClick={() => setConfirming("leave")}
                    data-testid="workspace-leave-button"
                  >
                    Leave workspace
                  </Button>
                </div>
              </>
            )}

            {canArchiveOrDelete && (
              <>
                <SectionTitle>Archive &amp; delete</SectionTitle>
                {!isArchived ? (
                  <>
                    <div>
                      <Button
                        variant="ghost"
                        leftIcon={<Archive size={14} />}
                        onClick={() => setConfirming("archive")}
                        data-testid="workspace-settings-archive"
                      >
                        Archive
                      </Button>
                    </div>
                    <div style={hintStyle}>
                      Archive the workspace first to delete it.
                    </div>
                  </>
                ) : (
                  <div>
                    <Button
                      variant="destructive"
                      leftIcon={<Trash2 size={14} />}
                      onClick={startDelete}
                      loading={deleteMutation.isPending && confirming !== "delete"}
                      data-testid="workspace-delete-button"
                    >
                      Delete workspace
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
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
        </Modal.Footer>
      </Modal>

      <ConfirmModal
        open={confirming === "archive"}
        onClose={() => setConfirming(null)}
        title="Archive workspace?"
        body="It will be hidden, not deleted. You can restore it any time from the Archived section."
        confirmLabel="Archive"
        loading={archiveMutation.isPending}
        onConfirm={archive}
        testId="workspace-archive-confirm"
      />

      <ConfirmModal
        open={confirming === "share"}
        onClose={() => setConfirming(null)}
        title="Share this workspace?"
        body="Everything in this workspace — all tasks, comments and files — will become visible to the people you invite AND to company admins. This cannot be undone."
        confirmLabel="Share"
        loading={convertMutation.isPending}
        onConfirm={share}
        testId="workspace-share-confirm"
      />

      <ConfirmModal
        open={confirming === "leave"}
        onClose={() => setConfirming(null)}
        title="Leave workspace?"
        body="You will no longer see this workspace or its tasks."
        confirmLabel="Leave"
        confirmVariant="destructive"
        loading={leaveMutation.isPending}
        onConfirm={leave}
        testId="workspace-leave-confirm"
      />

      <ConfirmModal
        open={confirming === "delete"}
        onClose={() => setConfirming(null)}
        title="Delete workspace?"
        body={
          deleteInfo
            ? `This will permanently delete ${deleteInfo.tasks} tasks, ${deleteInfo.comments} comments, ${deleteInfo.files} files. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        confirmDisabled={!deleteNameOk}
        loading={deleteMutation.isPending}
        onConfirm={confirmDelete}
        testId="workspace-delete-confirm"
      >
        {deleteInfo && deleteInfo.tasks > 0 && (
          <TextInput
            label={`Type "${workspace?.Name}" to confirm`}
            value={deleteName}
            onChange={(e) => setDeleteName(e.target.value)}
            placeholder={workspace?.Name}
            data-testid="workspace-delete-name"
          />
        )}
      </ConfirmModal>
    </>
  );
}
