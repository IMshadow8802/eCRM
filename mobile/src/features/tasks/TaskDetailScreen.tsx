import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { StackScreenProps } from "@react-navigation/stack";

import {
  addTaskComment,
  deleteTaskChecklist,
  fetchTaskById,
  getTaskChecklist,
  getTaskComments,
  saveTaskChecklist,
} from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { colors, radius, shadows, spacing } from "../../theme";
import { Avatar, Button, Input, Screen, Text } from "../../ui";
import { abilitiesFor, assigneesOf, dueLabel } from "./taskHelpers";

type Props = StackScreenProps<RootStackParamList, "TaskDetail">;

export default function TaskDetailScreen({ route, navigation }: Props) {
  const { taskId, workspaceId } = route.params;
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.UserId);
  const isAdmin = useAuthStore((s) => Boolean(s.user?.IsAdmin));

  const [newItem, setNewItem] = useState("");
  const [newComment, setNewComment] = useState("");

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTaskById(taskId),
  });
  const checklistQuery = useQuery({
    queryKey: ["task", taskId, "checklist"],
    queryFn: () => getTaskChecklist({ TaskId: taskId }),
  });
  const commentsQuery = useQuery({
    queryKey: ["task", taskId, "comments"],
    queryFn: () => getTaskComments({ TaskId: taskId }),
  });
  // Needed for permissions: authority comes from the caller's role in THIS
  // task's workspace, which the task row itself does not carry.
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetchWorkspaces({ PageSize: 100 }),
  });

  const task = taskQuery.data;
  const role = useMemo(
    () =>
      workspaces?.find((w) => w.Id === (task?.WorkspaceId ?? workspaceId))
        ?.MyRole ?? null,
    [workspaces, task, workspaceId],
  );
  const can = abilitiesFor(task, userId, role, isAdmin);

  // Ticking an item changes IsCompleted on the task, so the lists that show
  // progress have to be refetched too.
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const toggleItem = useMutation({
    mutationFn: saveTaskChecklist,
    onSuccess: invalidateAll,
  });
  const removeItem = useMutation({
    mutationFn: deleteTaskChecklist,
    onSuccess: invalidateAll,
  });
  const addItem = useMutation({
    mutationFn: saveTaskChecklist,
    onSuccess: () => {
      setNewItem("");
      invalidateAll();
    },
  });
  const addComment = useMutation({
    mutationFn: addTaskComment,
    onSuccess: () => {
      setNewComment("");
      queryClient.invalidateQueries({ queryKey: ["task", taskId, "comments"] });
    },
  });

  const checklist = checklistQuery.data ?? [];
  const comments = commentsQuery.data ?? [];
  const assignees = task ? assigneesOf(task) : [];
  const due = task ? dueLabel(task.DueDate) : null;

  if (taskQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.centre}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!task) {
    return (
      <Screen>
        <View style={[styles.centre, styles.gap]}>
          <MaterialIcons name="lock" size={32} color={colors.textMuted} />
          <Text variant="h3">Task not available</Text>
          <Text variant="secondary" align="center">
            It may have been deleted, or you no longer have access to its board.
          </Text>
          <Button title="Go back" variant="secondary" onPress={navigation.goBack} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}>
        <Pressable
          onPress={navigation.goBack}
          style={styles.back}
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text variant="label" numberOfLines={1} style={styles.headerTitle}>
          {task.WorkspaceName ?? "Task"}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + spacing[10]}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={taskQuery.isRefetching}
              onRefresh={taskQuery.refetch}
              tintColor={colors.primary}
            />
          }
        >
          <Text variant="h1">{task.Title}</Text>

          {task.Description ? (
            <Text variant="body" color="textSecondary">
              {task.Description}
            </Text>
          ) : null}

          <View style={styles.factCard}>
            <Fact icon="flag" tint="priorityHigh" label="Priority" value={task.Priority ?? "—"} />
            <Fact icon="event" tint="info" label="Due" value={due ?? "No due date"} />
            <Fact icon="view-week" tint="primary" label="Column" value={task.ColumnTitle ?? "—"} />
            <Fact
              icon="person-outline"
              tint="neutralIcon"
              label="Created by"
              value={task.CreatorName ?? "—"}
              last
            />
          </View>

          <Section title="Assignees" icon="group">
            {assignees.length ? (
              <View style={styles.assigneeList}>
                {assignees.map((a) => (
                  <View key={a.UserId} style={styles.assigneeRow}>
                    <Avatar name={a.FullName} uri={a.Avatar} size={30} />
                    <Text variant="body">{a.FullName}</Text>
                    {a.UserId === userId ? (
                      <Text variant="caption" color="primary">
                        you
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text variant="secondary">Nobody is assigned yet.</Text>
            )}
          </Section>

          <Section
            title="Checklist"
            icon="checklist"
            trailing={
              checklist.length
                ? `${checklist.filter((i) => i.IsCompleted).length}/${checklist.length}`
                : undefined
            }
          >
            {checklist.map((item) => (
              <Pressable
                key={item.Id}
                disabled={!can.changeStatus || toggleItem.isPending}
                onPress={() =>
                  toggleItem.mutate({
                    Id: item.Id,
                    TaskId: taskId,
                    ItemText: item.ItemText,
                    IsCompleted: !item.IsCompleted,
                    SortOrder: item.SortOrder ?? 0,
                    WorkspaceId: task.WorkspaceId,
                  })
                }
                style={styles.checkRow}
              >
                <MaterialIcons
                  name={item.IsCompleted ? "check-box" : "check-box-outline-blank"}
                  size={22}
                  color={item.IsCompleted ? colors.success : colors.textMuted}
                />
                <Text
                  variant="body"
                  style={[styles.checkText, item.IsCompleted && styles.checkDone]}
                >
                  {item.ItemText}
                </Text>
                {can.manageArtifacts ? (
                  <Pressable
                    hitSlop={spacing[2]}
                    onPress={() =>
                      removeItem.mutate({
                        Id: item.Id,
                        TaskId: taskId,
                        WorkspaceId: task.WorkspaceId,
                      })
                    }
                  >
                    <MaterialIcons name="close" size={18} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))}

            {!checklist.length ? (
              <Text variant="secondary">
                No steps yet. Completion is driven by this list.
              </Text>
            ) : null}

            {can.manageArtifacts ? (
              <View style={styles.composer}>
                <Input
                  bare
                  containerStyle={styles.composerInput}
                  value={newItem}
                  onChangeText={setNewItem}
                  placeholder="Add a step"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    const text = newItem.trim();
                    if (!text) return;
                    addItem.mutate({
                      TaskId: taskId,
                      ItemText: text,
                      SortOrder: checklist.length,
                      WorkspaceId: task.WorkspaceId,
                    });
                  }}
                />
                <MaterialIcons name="add" size={20} color={colors.primary} />
              </View>
            ) : null}
          </Section>

          <Section title="Comments" icon="chat-bubble-outline">
            {comments.map((c) => (
              <View key={c.Id} style={styles.comment}>
                <Avatar name={c.UserName} uri={c.Avatar} size={30} />
                <View style={styles.commentBody}>
                  <Text variant="bodyStrong">{c.UserName ?? "Someone"}</Text>
                  <Text variant="body" color="textSecondary">
                    {c.Comment}
                  </Text>
                </View>
              </View>
            ))}
            {!comments.length ? (
              <Text variant="secondary">No comments yet.</Text>
            ) : null}

            {can.comment ? (
              <View style={styles.composer}>
                <Input
                  bare
                  containerStyle={styles.composerInput}
                  value={newComment}
                  onChangeText={setNewComment}
                  placeholder="Write a comment"
                  multiline
                />
                <Pressable
                  hitSlop={spacing[2]}
                  disabled={!newComment.trim() || addComment.isPending}
                  onPress={() =>
                    addComment.mutate({
                      TaskId: taskId,
                      Comment: newComment.trim(),
                      WorkspaceId: task.WorkspaceId,
                    })
                  }
                >
                  <MaterialIcons
                    name="send"
                    size={20}
                    color={newComment.trim() ? colors.primary : colors.textMuted}
                  />
                </Pressable>
              </View>
            ) : null}
          </Section>

          {/* Says why a control is missing instead of leaving a dead screen. */}
          {!can.changeStatus ? (
            <View style={styles.readOnly}>
              <MaterialIcons name="visibility" size={16} color={colors.textMuted} />
              <Text variant="caption" color="textMuted" style={styles.flex}>
                You have view access to this board. Ask an owner to assign you
                the task to work on it.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Section({
  title,
  icon,
  trailing,
  children,
}: {
  title: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  trailing?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <MaterialIcons name={icon} size={16} color={colors.textSecondary} />
        <Text variant="overline" color="textSecondary" style={styles.flex}>
          {title}
        </Text>
        {trailing ? (
          <Text variant="caption" color="textMuted">
            {trailing}
          </Text>
        ) : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Fact({
  icon,
  tint,
  label,
  value,
  last = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  tint: keyof typeof colors;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.fact, !last && styles.factDivider]}>
      <View style={[styles.factGlyph, { backgroundColor: colors[tint] }]}>
        <MaterialIcons name={icon} size={15} color={colors.textOnBrand} />
      </View>
      <Text variant="caption" color="textMuted" style={styles.flex}>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing[6] },
  gap: { gap: spacing[3] },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1 },
  content: { padding: spacing[5], gap: spacing[5], paddingBottom: spacing[16] },
  factCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadows.md,
  },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
  },
  factDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  factGlyph: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { gap: spacing[2] },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  sectionBody: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[4],
    gap: spacing[3],
    ...shadows.md,
  },
  assigneeList: { gap: spacing[3] },
  assigneeRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  checkText: { flex: 1 },
  checkDone: { textDecorationLine: "line-through", color: colors.textMuted },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing[3],
  },
  composerInput: { flex: 1 },
  comment: { flexDirection: "row", gap: spacing[3] },
  commentBody: { flex: 1, gap: spacing[1] },
  readOnly: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    padding: spacing[3],
  },
});
