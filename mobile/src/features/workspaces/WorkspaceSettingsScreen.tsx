import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Crown,
  Eye,
  Lock,
  LogOut,
  Pencil,
  RefreshCw,
  Shield,
  Star,
  Trash2,
  RotateCcw,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchUserDirectory } from "../../api/userQueries";
import {
  addWorkspaceMember,
  archiveWorkspace,
  deleteWorkspace,
  fetchWorkspaceMembers,
  fetchWorkspaces,
  removeWorkspaceMember,
  setWorkspaceMemberRole,
  syncProjectWorkspaceMembers,
  transferWorkspaceOwnership,
} from "../../api/workspaceQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { WorkspaceMember, WorkspaceRole } from "../../types/api";
import type { ChipTone } from "../../theme";
import {
  ActionSheet,
  Avatar,
  Band,
  BandSheet,
  Dialog,
  GroupHeader,
  IconButton,
  InfoNote,
  ListGroup,
  ListRow,
  Screen,
  type SheetAction,
  type SheetRef,
  useToast,
} from "../../ui";

type Props = StackScreenProps<RootStackParamList, "WorkspaceSettings">;

const ROLE_TONE: Record<WorkspaceRole, ChipTone> = { owner: "lilac", manager: "indigo", member: "slate", viewer: "slate" };
const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: "Owner", manager: "Manager", member: "Member", viewer: "Viewer" };

const ROLE_META: Record<WorkspaceRole, { Icon: LucideIcon; blurb: string }> = {
  owner: { Icon: Star, blurb: "Full control, including deleting the board" },
  manager: { Icon: Shield, blurb: "Everything except deleting the board" },
  member: { Icon: Pencil, blurb: "Creates tasks and fully edits their own" },
  viewer: { Icon: Eye, blurb: "Reads and comments only" },
};

/** Owner is granted by transfer, never by picking it from a list. */
const ASSIGNABLE: WorkspaceRole[] = ["manager", "member", "viewer"];

export default function WorkspaceSettingsScreen({ route, navigation }: Props) {
  const { workspaceId } = route.params;
  const queryClient = useQueryClient();
  const toast = useToast();
  const userId = useAuthStore((s) => s.UserId);
  // A role property from `access`, never the login-time user.IsAdmin.
  const isAdmin = useAuthStore((s) => Boolean(s.access?.isAdmin));

  const [selected, setSelected] = useState<WorkspaceMember | null>(null);
  // Set while the role sheet is choosing the role of a new invite rather than
  // changing an existing member's.
  const [invitee, setInvitee] = useState<{ Id: number; FullName: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [blastRadius, setBlastRadius] = useState<string | null>(null);

  const memberRef = useRef<SheetRef>(null);
  const roleRef = useRef<SheetRef>(null);
  const addRef = useRef<SheetRef>(null);

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces", true],
    queryFn: () => fetchWorkspaces({ PageSize: 100, IncludeArchived: true }),
  });

  const { data: members } = useQuery({
    queryKey: ["workspace", workspaceId, "members"],
    queryFn: () => fetchWorkspaceMembers({ WorkspaceId: workspaceId }),
  });

  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
  });

  const workspace = workspaces?.find((w) => w.Id === workspaceId);
  const myRole = workspace?.MyRole ?? null;
  const personal = workspace?.Type === "personal";
  const isOwner = myRole === "owner";
  const manages = isOwner || myRole === "manager";
  // The web's gates (WorkspaceSettingsModal). The admin bypass never reaches a
  // personal board — those are private even from administrators.
  const admin = isAdmin && workspace != null && !personal;
  const manageMembers = manages || admin;
  const canArchive = isOwner || admin;
  const canTransfer = !personal && (isOwner || admin);
  const canSync = workspace?.Type === "project" && manageMembers;
  const canLeave = !personal && myRole != null && !isOwner;

  const refreshMembers = () => {
    queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId, "members"] });
    queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  };

  const addMember = useMutation({
    mutationFn: addWorkspaceMember,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not add that member.")),
    onSuccess: refreshMembers,
  });
  const setRole = useMutation({
    mutationFn: setWorkspaceMemberRole,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not change that role.")),
    onSuccess: refreshMembers,
  });
  const removeMember = useMutation({
    mutationFn: removeWorkspaceMember,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not remove that member.")),
    onSuccess: refreshMembers,
  });
  const transfer = useMutation({
    mutationFn: transferWorkspaceOwnership,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not transfer ownership.")),
    onSuccess: refreshMembers,
  });

  const leave = useMutation({
    mutationFn: () => removeWorkspaceMember({ WorkspaceId: workspaceId, UserId: userId ?? 0 }),
    onError: (err) => {
      setConfirmLeave(false);
      toast.error(apiErrorMessage(err, "Could not leave this board."));
    },
    onSuccess: () => {
      setConfirmLeave(false);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigation.navigate("Boards");
    },
  });

  const sync = useMutation({
    mutationFn: () => syncProjectWorkspaceMembers({ WorkspaceId: workspaceId }),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not sync members from the team.")),
    onSuccess: (response) => {
      toast.success(
        `${response.data?.membersAddedOrRestored ?? 0} added, ${response.data?.membersDeactivated ?? 0} removed`,
      );
      refreshMembers();
    },
  });

  const archive = useMutation({
    mutationFn: archiveWorkspace,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not archive this workspace.")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  // Ask the server what deleting would destroy before showing a confirmation.
  // A count of what is about to go is the difference between an informed yes
  // and a guess.
  const dryRun = useMutation({
    mutationFn: () => deleteWorkspace({ WorkspaceId: workspaceId, DryRun: true }),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not check what deleting would remove.")),
    onSuccess: (response) => {
      const tasks = response.data?.taskCount ?? 0;
      const comments = response.data?.commentCount ?? 0;
      const files = response.data?.attachmentCount ?? 0;
      const n = (count: number, word: string) =>
        `${count} ${word}${count === 1 ? "" : "s"}`;
      setBlastRadius(
        tasks || comments || files
          ? `${n(tasks, "task")}, ${n(comments, "comment")} and ${n(files, "file")} will be destroyed.`
          : "It is empty — nothing else goes with it.",
      );
      setConfirmDelete(true);
    },
  });

  const destroy = useMutation({
    mutationFn: () => deleteWorkspace({ WorkspaceId: workspaceId }),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete this workspace.")),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      // The board this screen belongs to is gone; going back once would land on
      // it. Pop to the boards list instead.
      navigation.navigate("Boards");
    },
  });

  // Declined (and removed) rows stay listed, greyed, so they can be re-invited.
  const roster = useMemo(() => members ?? [], [members]);
  const isGone = (m: WorkspaceMember) =>
    m.InviteStatus !== "active" && m.InviteStatus !== "pending";

  const addable = useMemo(
    () =>
      (directory ?? []).filter(
        (user) => !roster.some((m) => m.UserId === user.Id),
      ),
    [directory, roster],
  );

  const openMember = (member: WorkspaceMember) => {
    setSelected(member);
    memberRef.current?.present();
  };

  const memberActions: SheetAction[] = !selected
    ? []
    : isGone(selected)
      ? [
          {
            key: "reinvite",
            label: "Re-invite",
            sublabel: "Sends them a fresh invite",
            icon: RotateCcw,
            onPress: () =>
              addMember.mutate({
                WorkspaceId: workspaceId,
                UserId: selected.UserId,
                Role: "member",
              }),
          },
        ]
      : [
          {
            key: "role",
            label: "Change role",
            sublabel: selected.Role,
            icon: Shield,
            disabled: selected.Role === "owner",
            onPress: () => {
              setInvitee(null);
              roleRef.current?.present();
            },
          },
          ...(canTransfer && selected.UserId !== userId && selected.InviteStatus === "active"
            ? [
                {
                  key: "transfer",
                  label: "Make owner",
                  sublabel: isOwner ? "You become a manager" : undefined,
                  icon: Crown,
                  onPress: () =>
                    transfer.mutate({
                      WorkspaceId: workspaceId,
                      NewOwnerUserId: selected.UserId,
                    }),
                } satisfies SheetAction,
              ]
            : []),
          // A pending invite has nobody to remove yet, and you leave rather
          // than remove yourself.
          ...(selected.InviteStatus === "active" && selected.UserId !== userId
            ? [
                {
                  key: "remove",
                  label: "Remove from board",
                  icon: UserMinus,
                  tone: "danger",
                  disabled: selected.Role === "owner",
                  onPress: () =>
                    removeMember.mutate({
                      WorkspaceId: workspaceId,
                      UserId: selected.UserId,
                    }),
                } satisfies SheetAction,
              ]
            : []),
        ];

  const roleActions: SheetAction[] = ASSIGNABLE.map((role) => ({
    key: role,
    label: role[0]!.toUpperCase() + role.slice(1),
    sublabel: ROLE_META[role].blurb,
    icon: ROLE_META[role].Icon,
    selected: invitee ? role === "member" : selected?.Role === role,
    onPress: () => {
      if (invitee) {
        addMember.mutate({ WorkspaceId: workspaceId, UserId: invitee.Id, Role: role });
        setInvitee(null);
      } else if (selected) {
        setRole.mutate({ WorkspaceId: workspaceId, UserId: selected.UserId, Role: role });
      }
    },
  }));

  const addActions: SheetAction[] = addable.map((user) => ({
    key: String(user.Id),
    label: user.FullName,
    sublabel: user.JobTitle ?? user.Username ?? undefined,
    icon: UserPlus,
    onPress: () => {
      setInvitee({ Id: user.Id, FullName: user.FullName });
      roleRef.current?.present();
    },
  }));

  const typeLabel = workspace?.Type ? workspace.Type[0]!.toUpperCase() + workspace.Type.slice(1) : undefined;

  return (
    <Screen band>
      <Band
        variant="record"
        titleVariant="h2"
        title={workspace?.Name ?? "Board settings"}
        subtitle={typeLabel}
        onBack={navigation.goBack}
        actions={
          manages ? (
            <IconButton icon={Pencil} accessibilityLabel="Rename this board" onPress={() => navigation.navigate("WorkspaceForm", { workspaceId })} />
          ) : undefined
        }
      />

      <BandSheet scroll>
        <GroupHeader
          label="Members"
          first
          link={manageMembers && !personal ? { label: "Add", onPress: () => addRef.current?.present() } : undefined}
        />
        {/* A personal board has exactly one member by definition, and
            converting it to shared is a web action. */}
        {personal ? (
          <InfoNote icon={Lock}>
            Personal boards are yours alone — private even from administrators. Create a shared board to work with anyone else.
          </InfoNote>
        ) : (
          <ListGroup>
            {roster.map((member, i) => {
              const meta = ROLE_META[member.Role] ?? ROLE_META.member;
              const gone = isGone(member);
              const pending = member.InviteStatus === "pending";
              const tappable = manageMembers && !pending;
              return (
                <ListRow
                  key={member.UserId}
                  noSeparator={i === 0}
                  badge={<Avatar name={member.FullName} uri={member.Avatar} userId={member.UserId} size={36} />}
                  title={`${member.FullName ?? member.Username ?? "Someone"}${member.UserId === userId ? " (you)" : ""}`}
                  titleTone={gone ? "muted" : "default"}
                  meta={pending ? "Waiting for reply" : gone ? (member.InviteStatus === "declined" ? "Declined" : "Removed") : meta.blurb}
                  chips={gone || pending ? undefined : [{ label: ROLE_LABEL[member.Role] ?? "Member", tone: ROLE_TONE[member.Role] ?? "slate" }]}
                  chevron={tappable}
                  accessibilityLabel={member.FullName ?? member.Username ?? "Someone"}
                  onPress={tappable ? () => openMember(member) : undefined}
                />
              );
            })}
            {!roster.length ? <ListRow noSeparator title="Nobody on this board yet." titleTone="muted" /> : null}
          </ListGroup>
        )}

        {canSync || canLeave || canArchive ? (
          <>
            <GroupHeader label="Board" />
            <ListGroup>
              {canSync ? (
                <ListRow
                  noSeparator
                  badge={{ tone: "teal", icon: RefreshCw }}
                  title="Sync members from team"
                  meta="Adds the project team, removes who left it"
                  onPress={sync.isPending ? undefined : () => sync.mutate()}
                />
              ) : null}
              {canLeave ? (
                <ListRow
                  noSeparator={!canSync}
                  badge={{ tone: "red", icon: LogOut }}
                  title="Leave board"
                  titleTone="danger"
                  meta="You lose access until someone invites you again"
                  onPress={() => setConfirmLeave(true)}
                />
              ) : null}
              {canArchive ? (
                <ListRow
                  noSeparator={!canSync && !canLeave}
                  badge={{ tone: "slate", icon: workspace?.IsArchived ? ArchiveRestore : Archive }}
                  title={workspace?.IsArchived ? "Restore board" : "Archive board"}
                  meta={workspace?.IsArchived ? "Puts it back in the active list" : "Archive the board first to delete it."}
                  onPress={() => archive.mutate({ WorkspaceId: workspaceId, IsArchived: !workspace?.IsArchived })}
                />
              ) : null}
              {/* sp_DeleteWorkspace refuses an active board, so Delete only
                  exists once it is archived. */}
              {canArchive && workspace?.IsArchived ? (
                <ListRow
                  badge={{ tone: "red", icon: Trash2 }}
                  title="Delete board"
                  titleTone="danger"
                  meta="Destroys every task and file on it"
                  onPress={dryRun.isPending ? undefined : () => dryRun.mutate()}
                />
              ) : null}
            </ListGroup>
          </>
        ) : null}
      </BandSheet>

      <ActionSheet
        ref={memberRef}
        title={selected?.FullName ?? "Member"}
        actions={memberActions}
      />
      <ActionSheet
        ref={roleRef}
        title={invitee ? `Invite ${invitee.FullName} as` : "Role on this board"}
        actions={roleActions}
      />
      <ActionSheet
        ref={addRef}
        title="Add someone"
        actions={addActions}
        emptyMessage="Everyone in the directory is already on this board."
      />

      <Dialog
        visible={confirmDelete}
        badge={{ tone: "red", icon: Trash2 }}
        title={`Delete "${workspace?.Name ?? ""}"?`}
        message={`${blastRadius ?? ""} This cannot be undone — archive it instead if you might want it back.`}
        confirmLabel="Delete"
        destructive
        loading={destroy.isPending}
        onConfirm={() => destroy.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />

      <Dialog
        visible={confirmLeave}
        badge={{ tone: "red", icon: LogOut }}
        title={`Leave "${workspace?.Name ?? ""}"?`}
        message="You stop seeing its tasks. Someone on the board can invite you back."
        confirmLabel="Leave"
        destructive
        loading={leave.isPending}
        onConfirm={() => leave.mutate()}
        onCancel={() => setConfirmLeave(false)}
      />
    </Screen>
  );
}
