import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Crown,
  Eye,
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
import { colors, radius, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Avatar,
  Button,
  Card,
  Dialog,
  Screen,
  ScreenHeader,
  Text,
  type SheetAction,
  type SheetRef,
  useToast,
} from "../../ui";

type Props = StackScreenProps<RootStackParamList, "WorkspaceSettings">;

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

  return (
    <Screen>
      <ScreenHeader
        title={workspace?.Name ?? "Board settings"}
        subtitle={workspace?.Type}
        onBack={navigation.goBack}
        actions={
          manages
            ? [
                {
                  icon: Pencil,
                  label: "Rename this board",
                  onPress: () =>
                    navigation.navigate("WorkspaceForm", { workspaceId }),
                },
              ]
            : undefined
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text variant="overline" color="textMuted">
              Members
            </Text>
            {manageMembers && !personal ? (
              <Button
                title="Add"
                variant="ghost"
                size="sm"
                icon={UserPlus}
                onPress={() => addRef.current?.present()}
              />
            ) : null}
          </View>

          {/* A personal board has exactly one member by definition, and
              converting it to shared is a web action. */}
          {personal ? (
            <Card>
              <Text variant="secondary">
                Personal boards are yours alone — private even from
                administrators. Create a shared board to work with anyone else.
              </Text>
            </Card>
          ) : (
            <Card padded={false} gap={0}>
              {roster.map((member, i) => {
                const meta = ROLE_META[member.Role] ?? ROLE_META.member;
                const gone = isGone(member);
                return (
                  <Pressable
                    key={member.UserId}
                    disabled={!manageMembers || member.InviteStatus === "pending"}
                    onPress={() => openMember(member)}
                    style={({ pressed }) => [
                      styles.row,
                      i < roster.length - 1 && styles.rowDivider,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Avatar
                      name={member.FullName}
                      uri={member.Avatar}
                      size={38}
                    />
                    <View style={styles.rowText}>
                      <Text
                        variant="bodyStrong"
                        color={gone ? "textMuted" : undefined}
                        numberOfLines={1}
                      >
                        {member.FullName ?? member.Username ?? "Someone"}
                        {member.UserId === userId ? " (you)" : ""}
                      </Text>
                      <Text variant="caption" color="textMuted">
                        {member.InviteStatus === "pending"
                          ? "Waiting for reply"
                          : gone
                            ? member.InviteStatus === "declined" ? "Declined" : "Removed"
                            : meta.blurb}
                      </Text>
                    </View>
                    <meta.Icon size={18} color={colors.textSecondary} />
                  </Pressable>
                );
              })}

              {!roster.length ? (
                <View style={styles.row}>
                  <Text variant="secondary">Nobody on this board yet.</Text>
                </View>
              ) : null}
            </Card>
          )}
        </View>

        {canSync || canLeave || canArchive ? (
          <View style={styles.section}>
            <Text variant="overline" color="textMuted">
              Board
            </Text>

            <Card padded={false} gap={0}>
              {canSync ? (
                <Pressable
                  disabled={sync.isPending}
                  onPress={() => sync.mutate()}
                  style={({ pressed }) => [
                    styles.row,
                    styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.glyph}>
                    <RefreshCw size={18} color={colors.textOnBrand} />
                  </View>
                  <View style={styles.rowText}>
                    <Text variant="bodyStrong">Sync members from team</Text>
                    <Text variant="caption" color="textMuted">
                      Adds the project team, removes who left it
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {canLeave ? (
                <Pressable
                  onPress={() => setConfirmLeave(true)}
                  style={({ pressed }) => [
                    styles.row,
                    canArchive && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={[styles.glyph, styles.glyphDanger]}>
                    <LogOut size={18} color={colors.textOnBrand} />
                  </View>
                  <View style={styles.rowText}>
                    <Text variant="bodyStrong" color="danger">
                      Leave board
                    </Text>
                    <Text variant="caption" color="textMuted">
                      You lose access until someone invites you again
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {canArchive ? (
              <Pressable
                onPress={() =>
                  archive.mutate({
                    WorkspaceId: workspaceId,
                    IsArchived: !workspace?.IsArchived,
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  workspace?.IsArchived && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={styles.glyph}>
                  {workspace?.IsArchived ? (
                    <ArchiveRestore size={18} color={colors.textOnBrand} />
                  ) : (
                    <Archive size={18} color={colors.textOnBrand} />
                  )}
                </View>
                <View style={styles.rowText}>
                  <Text variant="bodyStrong">
                    {workspace?.IsArchived ? "Restore board" : "Archive board"}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {workspace?.IsArchived
                      ? "Puts it back in the active list"
                      : "Archive the board first to delete it."}
                  </Text>
                </View>
              </Pressable>
              ) : null}

              {/* sp_DeleteWorkspace refuses an active board, so Delete only
                  exists once it is archived. */}
              {canArchive && workspace?.IsArchived ? (
                <Pressable
                  disabled={dryRun.isPending}
                  onPress={() => dryRun.mutate()}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <View style={[styles.glyph, styles.glyphDanger]}>
                    <Trash2 size={18} color={colors.textOnBrand} />
                  </View>
                  <View style={styles.rowText}>
                    <Text variant="bodyStrong" color="danger">
                      Delete board
                    </Text>
                    <Text variant="caption" color="textMuted">
                      Destroys every task and file on it
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </Card>
          </View>
        ) : null}
      </ScrollView>

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

const styles = StyleSheet.create({
  content: { padding: SCREEN_PADDING, paddingBottom: spacing[20], gap: spacing[5] },
  section: { gap: spacing[2] },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowText: { flex: 1, gap: spacing[1] },
  glyph: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphDanger: { backgroundColor: colors.danger },
});
