import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Crown,
  Eye,
  Pencil,
  Shield,
  Star,
  Trash2,
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
  transferWorkspaceOwnership,
} from "../../api/workspaceQueries";
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
  const userId = useAuthStore((s) => s.UserId);

  const [selected, setSelected] = useState<WorkspaceMember | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blastRadius, setBlastRadius] = useState<string | null>(null);

  const memberRef = useRef<SheetRef>(null);
  const roleRef = useRef<SheetRef>(null);
  const addRef = useRef<SheetRef>(null);

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
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
  const isOwner = myRole === "owner";
  const manages = isOwner || myRole === "manager";

  const refreshMembers = () => {
    queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId, "members"] });
    queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  };

  const addMember = useMutation({
    mutationFn: addWorkspaceMember,
    onSuccess: refreshMembers,
  });
  const setRole = useMutation({
    mutationFn: setWorkspaceMemberRole,
    onSuccess: refreshMembers,
  });
  const removeMember = useMutation({
    mutationFn: removeWorkspaceMember,
    onSuccess: refreshMembers,
  });
  const transfer = useMutation({
    mutationFn: transferWorkspaceOwnership,
    onSuccess: refreshMembers,
  });

  const archive = useMutation({
    mutationFn: archiveWorkspace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  // Ask the server what deleting would destroy before showing a confirmation.
  // A count of what is about to go is the difference between an informed yes
  // and a guess.
  const dryRun = useMutation({
    mutationFn: () => deleteWorkspace({ WorkspaceId: workspaceId, DryRun: true }),
    onSuccess: (response) => {
      const tasks = response.data?.taskCount ?? 0;
      const files = response.data?.attachmentCount ?? 0;
      setBlastRadius(
        tasks || files
          ? `${tasks} task${tasks === 1 ? "" : "s"} and ${files} file${files === 1 ? "" : "s"} will be destroyed.`
          : "It is empty — nothing else goes with it.",
      );
      setConfirmDelete(true);
    },
  });

  const destroy = useMutation({
    mutationFn: () => deleteWorkspace({ WorkspaceId: workspaceId }),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      // The board this screen belongs to is gone; going back once would land on
      // it. Pop to the boards list instead.
      navigation.navigate("Boards");
    },
  });

  const active = useMemo(
    () => (members ?? []).filter((m) => m.InviteStatus !== "declined"),
    [members],
  );

  const addable = useMemo(
    () =>
      (directory ?? []).filter(
        (user) => !active.some((m) => m.UserId === user.Id),
      ),
    [directory, active],
  );

  const openMember = (member: WorkspaceMember) => {
    setSelected(member);
    memberRef.current?.present();
  };

  const memberActions: SheetAction[] = selected
    ? [
        {
          key: "role",
          label: "Change role",
          sublabel: selected.Role,
          icon: Shield,
          disabled: selected.Role === "owner",
          onPress: () => roleRef.current?.present(),
        },
        ...(isOwner && selected.UserId !== userId && selected.InviteStatus === "active"
          ? [
              {
                key: "transfer",
                label: "Make owner",
                sublabel: "You become a manager",
                icon: Crown,
                onPress: () =>
                  transfer.mutate({
                    WorkspaceId: workspaceId,
                    NewOwnerUserId: selected.UserId,
                  }),
              } satisfies SheetAction,
            ]
          : []),
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
        },
      ]
    : [];

  const roleActions: SheetAction[] = ASSIGNABLE.map((role) => ({
    key: role,
    label: role[0]!.toUpperCase() + role.slice(1),
    sublabel: ROLE_META[role].blurb,
    icon: ROLE_META[role].Icon,
    selected: selected?.Role === role,
    onPress: () =>
      selected &&
      setRole.mutate({
        WorkspaceId: workspaceId,
        UserId: selected.UserId,
        Role: role,
      }),
  }));

  const addActions: SheetAction[] = addable.map((user) => ({
    key: String(user.Id),
    label: user.FullName,
    sublabel: user.JobTitle ?? user.Username ?? undefined,
    icon: UserPlus,
    onPress: () =>
      addMember.mutate({
        WorkspaceId: workspaceId,
        UserId: user.Id,
        Role: "member",
      }),
  }));

  const personal = workspace?.Type === "personal";

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
            {manages && !personal ? (
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
              {active.map((member, i) => {
                const meta = ROLE_META[member.Role] ?? ROLE_META.member;
                return (
                  <Pressable
                    key={member.UserId}
                    disabled={!manages}
                    onPress={() => openMember(member)}
                    style={({ pressed }) => [
                      styles.row,
                      i < active.length - 1 && styles.rowDivider,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Avatar
                      name={member.FullName}
                      uri={member.Avatar}
                      size={38}
                    />
                    <View style={styles.rowText}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {member.FullName ?? member.Username ?? "Someone"}
                        {member.UserId === userId ? " (you)" : ""}
                      </Text>
                      <Text variant="caption" color="textMuted">
                        {member.InviteStatus === "pending"
                          ? "Invite pending"
                          : meta.blurb}
                      </Text>
                    </View>
                    <meta.Icon size={18} color={colors.textSecondary} />
                  </Pressable>
                );
              })}

              {!active.length ? (
                <View style={styles.row}>
                  <Text variant="secondary">Nobody on this board yet.</Text>
                </View>
              ) : null}
            </Card>
          )}
        </View>

        {manages ? (
          <View style={styles.section}>
            <Text variant="overline" color="textMuted">
              Board
            </Text>

            <Card padded={false} gap={0}>
              <Pressable
                onPress={() =>
                  archive.mutate({
                    WorkspaceId: workspaceId,
                    IsArchived: !workspace?.IsArchived,
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  styles.rowDivider,
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
                      : "Hides it without deleting anything"}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                disabled={!isOwner || dryRun.isPending}
                onPress={() => dryRun.mutate()}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.glyph, styles.glyphDanger]}>
                  <Trash2 size={18} color={colors.textOnBrand} />
                </View>
                <View style={styles.rowText}>
                  <Text variant="bodyStrong" color={isOwner ? "danger" : "textMuted"}>
                    Delete board
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {isOwner
                      ? "Destroys every task and file on it"
                      : "Only the owner can delete a board"}
                  </Text>
                </View>
              </Pressable>
            </Card>
          </View>
        ) : null}
      </ScrollView>

      <ActionSheet
        ref={memberRef}
        title={selected?.FullName ?? "Member"}
        actions={memberActions}
      />
      <ActionSheet ref={roleRef} title="Role on this board" actions={roleActions} />
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
