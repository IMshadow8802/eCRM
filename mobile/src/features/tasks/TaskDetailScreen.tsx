import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { colors, radius, spacing } from "../../theme";
import {
  Avatar,
  Input,
  Screen,
  ScreenHeader,
  Segmented,
  Text,
} from "../../ui";
import AttachmentList from "../attachments/AttachmentList";
import { abilitiesFor, assigneesOf, dueBucket, dueLabel } from "./taskHelpers";

type Props = StackScreenProps<RootStackParamList, "TaskDetail">;
type Tab = "steps" | "files" | "chat";

export default function TaskDetailScreen({ route, navigation }: Props) {
  const { taskId, workspaceId } = route.params;
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.UserId);
  const isAdmin = useAuthStore((s) => Boolean(s.user?.IsAdmin));

  const [tab, setTab] = useState<Tab>("steps");
  const [draft, setDraft] = useState("");

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
  // Authority comes from the caller's role in THIS task's workspace, which the
  // task row does not carry. Already cached by Boards, so this costs nothing.
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const toggleItem = useMutation({
    mutationFn: saveTaskChecklist,
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: deleteTaskChecklist,
    onSuccess: invalidate,
  });
  const addItem = useMutation({
    mutationFn: saveTaskChecklist,
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
  });
  const addComment = useMutation({
    mutationFn: addTaskComment,
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["task", taskId, "comments"] });
    },
  });

  const checklist = checklistQuery.data ?? [];
  const comments = commentsQuery.data ?? [];
  const assignees = task ? assigneesOf(task) : [];
  const done = checklist.filter((i) => i.IsCompleted).length;

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
        <ScreenHeader title="Task" onBack={navigation.goBack} />
        <View style={styles.centre}>
          <MaterialIcons name="lock" size={30} color={colors.textMuted} />
          <Text variant="h3">Task not available</Text>
          <Text variant="secondary" align="center">
            It may have been deleted, or you no longer have access to its board.
          </Text>
        </View>
      </Screen>
    );
  }

  const overdue = dueBucket(task.DueDate) === "overdue";
  const due = dueLabel(task.DueDate);
  const showComposer =
    (tab === "steps" && can.manageArtifacts) || (tab === "chat" && can.comment);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (tab === "steps") {
      addItem.mutate({
        TaskId: taskId,
        ItemText: text,
        SortOrder: checklist.length,
        WorkspaceId: task.WorkspaceId,
      });
    } else {
      addComment.mutate({
        TaskId: taskId,
        Comment: text,
        WorkspaceId: task.WorkspaceId,
      });
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title={task.WorkspaceName ?? "Task"}
        subtitle={task.ColumnTitle ?? undefined}
        onBack={navigation.goBack}
      />

      {/* One KeyboardAvoidingView around everything, offset 0. The previous
          version offset by insets.top + 40, which left ~100px of empty grey
          screen sitting above the keyboard. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.summary}>
          <Text variant="h2">{task.Title}</Text>

          {task.Description ? (
            <Text variant="secondary" numberOfLines={3}>
              {task.Description}
            </Text>
          ) : null}

          {/* One dense row instead of a four-row fact card — same information,
              a fifth of the height. */}
          <View style={styles.metaRow}>
            {task.Priority ? (
              <Meta icon="flag" text={task.Priority} tone="priorityHigh" />
            ) : null}
            {due ? (
              <Meta
                icon={overdue ? "error-outline" : "event"}
                text={due}
                tone={overdue ? "danger" : "textSecondary"}
              />
            ) : null}
            {assignees.length ? (
              <View style={styles.avatars}>
                {assignees.slice(0, 3).map((a, i) => (
                  <View key={a.UserId} style={i > 0 ? styles.overlap : undefined}>
                    <Avatar name={a.FullName} uri={a.Avatar} size={24} />
                  </View>
                ))}
              </View>
            ) : (
              <Meta icon="person-off" text="Unassigned" tone="textMuted" />
            )}
          </View>

          <Segmented
            value={tab}
            onChange={(next) => {
              setTab(next);
              setDraft("");
            }}
            options={[
              { value: "steps", label: "Steps", count: checklist.length },
              { value: "files", label: "Files" },
              { value: "chat", label: "Comments", count: comments.length },
            ]}
          />
        </View>

        {tab === "steps" ? (
          <FlatList
            data={checklist}
            keyExtractor={(i) => String(i.Id)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              checklist.length ? (
                <Text variant="caption" color="textMuted">
                  {done} of {checklist.length} done · completion follows this list
                </Text>
              ) : null
            }
            ListEmptyComponent={
              <Text variant="secondary">
                No steps yet. Completion is driven by this list.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
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
                style={styles.stepRow}
              >
                <MaterialIcons
                  name={
                    item.IsCompleted ? "check-circle" : "radio-button-unchecked"
                  }
                  size={22}
                  color={item.IsCompleted ? colors.success : colors.borderStrong}
                />
                <Text
                  variant="body"
                  style={[styles.flex, item.IsCompleted && styles.struck]}
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
                    <MaterialIcons
                      name="close"
                      size={18}
                      color={colors.textMuted}
                    />
                  </Pressable>
                ) : null}
              </Pressable>
            )}
          />
        ) : null}

        {tab === "files" ? (
          <AttachmentList
            entity="task"
            entityId={taskId}
            canManage={can.manageArtifacts}
          />
        ) : null}

        {tab === "chat" ? (
          <FlatList
            data={comments}
            keyExtractor={(c) => String(c.Id)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text variant="secondary">No comments yet.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.comment}>
                <Avatar name={item.UserName} uri={item.Avatar} size={30} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{item.UserName ?? "Someone"}</Text>
                  <Text variant="body" color="textSecondary">
                    {item.Comment}
                  </Text>
                </View>
              </View>
            )}
          />
        ) : null}

        {showComposer ? (
          <View
            style={[
              styles.composer,
              { paddingBottom: insets.bottom + spacing[2] },
            ]}
          >
            <Input
              bare
              containerStyle={styles.flex}
              value={draft}
              onChangeText={setDraft}
              placeholder={tab === "steps" ? "Add a step" : "Write a comment"}
              multiline={tab === "chat"}
              onSubmitEditing={tab === "steps" ? submit : undefined}
            />
            <Pressable
              hitSlop={spacing[2]}
              disabled={!draft.trim()}
              onPress={submit}
              style={[styles.send, !draft.trim() && styles.sendIdle]}
            >
              <MaterialIcons
                name="arrow-upward"
                size={20}
                color={draft.trim() ? colors.textOnBrand : colors.textMuted}
              />
            </Pressable>
          </View>
        ) : null}

        {!can.changeStatus ? (
          <View
            style={[
              styles.readOnly,
              { paddingBottom: insets.bottom + spacing[2] },
            ]}
          >
            <MaterialIcons name="visibility" size={15} color={colors.textMuted} />
            <Text variant="caption" color="textMuted" style={styles.flex}>
              View only — ask an owner to assign you this task to work on it.
            </Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Meta({
  icon,
  text,
  tone,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  text: string;
  tone: keyof typeof colors;
}) {
  return (
    <View style={styles.meta}>
      <MaterialIcons name={icon} size={14} color={colors[tone]} />
      <Text variant="caption" color={tone}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    padding: spacing[6],
  },
  summary: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[4] },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  avatars: { flexDirection: "row", alignItems: "center" },
  overlap: { marginLeft: -spacing[2] },
  list: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    gap: spacing[3],
  },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  struck: { textDecorationLine: "line-through", color: colors.textMuted },
  comment: { flexDirection: "row", gap: spacing[3] },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendIdle: { backgroundColor: colors.surfaceSunken },
  readOnly: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
