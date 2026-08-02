import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Ban,
  Calendar,
  CircleAlert,
  CircleCheck,
  Circle,
  Eye,
  Flag,
  Link2,
  Lock,
  MessageCircle,
  MoreVertical,
  Pencil,
  Plus,
  Timer,
  Trash2,
  UserX,
  type LucideIcon,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { StackScreenProps } from "@react-navigation/stack";

import {
  addTaskComment,
  addTaskDependency,
  deleteTask,
  deleteTaskChecklist,
  fetchTaskById,
  fetchTasks,
  getTaskChecklist,
  getTaskComments,
  logTaskTime,
  moveTaskColumn,
  saveTaskChecklist,
} from "../../api/taskQueries";
import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { colors, radius, shadows, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Avatar,
  ComposeSheet,
  Dialog,
  Fab,
  Screen,
  ScreenHeader,
  Segmented,
  Text,
  type ComposeField,
  type SheetAction,
  type SheetRef,
} from "../../ui";
import AttachmentList from "../attachments/AttachmentList";
import ActivityTab from "./ActivityTab";
import { DependencySheet } from "./DependencySheet";
import { TimeSheet } from "./TimeSheet";
import {
  abilitiesFor,
  assigneesOf,
  dueBucket,
  dueLabel,
  formatHours,
} from "./taskHelpers";

type Props = StackScreenProps<RootStackParamList, "TaskDetail">;
type Tab = "checklist" | "files" | "chat" | "activity";
/** Which form the one compose sheet is currently showing. */
type Compose = "checklist" | "comment" | "time";

const COMPOSE_FORM: Record<
  Compose,
  { title: string; submitLabel: string; fields: ComposeField[] }
> = {
  checklist: {
    title: "Add checklist item",
    submitLabel: "Add item",
    fields: [{ key: "text", placeholder: "What needs doing?", required: true }],
  },
  comment: {
    title: "Write a comment",
    submitLabel: "Post comment",
    fields: [
      { key: "text", placeholder: "Share an update…", multiline: true, required: true },
    ],
  },
  time: {
    title: "Log time",
    submitLabel: "Log time",
    fields: [
      { key: "hours", label: "Hours", placeholder: "1.5", numeric: true, required: true },
      { key: "note", label: "Note", placeholder: "What did you work on?" },
    ],
  },
};

export default function TaskDetailScreen({ route, navigation }: Props) {
  const { taskId, workspaceId } = route.params;
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.UserId);
  const isAdmin = useAuthStore((s) => Boolean(s.user?.IsAdmin));

  const [tab, setTab] = useState<Tab>("checklist");
  const [compose, setCompose] = useState<Compose>("checklist");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const composeRef = useRef<SheetRef>(null);
  const menuRef = useRef<SheetRef>(null);
  const moveRef = useRef<SheetRef>(null);
  const blockerRef = useRef<SheetRef>(null);
  const timeRef = useRef<SheetRef>(null);
  const dependencyRef = useRef<SheetRef>(null);

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
  const attachmentsQuery = useQuery({
    queryKey: ["attachments", "task", taskId],
    queryFn: () => fetchAttachments({ Entity: "task", EntityId: taskId }),
  });
  // Authority comes from the caller's role in THIS task's workspace, which the
  // task row does not carry. Already cached by Boards, so this costs nothing.
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetchWorkspaces({ PageSize: 100 }),
  });

  const task = taskQuery.data;
  const boardId = task?.WorkspaceId ?? workspaceId;

  const columnsQuery = useQuery({
    queryKey: ["columns", boardId],
    queryFn: () => fetchKanbanColumns({ WorkspaceId: boardId }),
    enabled: boardId != null,
  });

  // Candidate blockers. Shares its key with BoardScreen, so arriving here from
  // a board costs nothing — the board already loaded exactly this list.
  const siblingsQuery = useQuery({
    queryKey: ["tasks", "board", boardId],
    queryFn: () => fetchTasks({ WorkspaceId: boardId, PageSize: 200 }),
    enabled: boardId != null,
  });

  const role = useMemo(
    () => workspaces?.find((w) => w.Id === boardId)?.MyRole ?? null,
    [workspaces, boardId],
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
      composeRef.current?.dismiss();
      invalidate();
    },
  });
  const addComment = useMutation({
    mutationFn: addTaskComment,
    onSuccess: () => {
      composeRef.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["task", taskId, "comments"] });
    },
  });
  const logTime = useMutation({
    mutationFn: logTaskTime,
    onSuccess: () => {
      composeRef.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["task", taskId, "time"] });
      invalidate();
    },
  });
  const move = useMutation({ mutationFn: moveTaskColumn, onSuccess: invalidate });
  const addBlocker = useMutation({
    mutationFn: addTaskDependency,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId, "dependencies"] });
      invalidate();
    },
  });
  const removeTask = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      setConfirmingDelete(false);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigation.goBack();
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
          <Lock size={30} color={colors.textMuted} />
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
  const logged = task.LoggedHours ?? 0;
  const estimated = task.EstimatedHours ?? 0;
  const blockers = task.BlockerCount ?? 0;
  const columns = columnsQuery.data ?? [];

  // Files brings its own FAB (it needs the camera/library/file picker sheet).
  const showFab =
    (tab === "checklist" && can.manageArtifacts) || (tab === "chat" && can.comment);

  const openCompose = (kind: Compose) => {
    setCompose(kind);
    composeRef.current?.present();
  };

  const submit = (values: Record<string, string>) => {
    if (compose === "checklist") {
      addItem.mutate({
        TaskId: taskId,
        ItemText: values.text ?? "",
        SortOrder: checklist.length,
        WorkspaceId: task.WorkspaceId,
      });
      return;
    }
    if (compose === "comment") {
      addComment.mutate({
        TaskId: taskId,
        Comment: values.text ?? "",
        WorkspaceId: task.WorkspaceId,
      });
      return;
    }
    const hours = Number(values.hours);
    if (!Number.isFinite(hours) || hours <= 0) return;
    logTime.mutate({
      TaskId: taskId,
      Hours: hours,
      Description: values.note ?? "",
      WorkspaceId: task.WorkspaceId,
    });
  };

  // Actions the current role is allowed to take. Built as a literal with
  // conditional spreads rather than pushed into: showing a viewer a menu that
  // is mostly greyed out is worse than showing them a short one.
  const menuActions: SheetAction[] = [
    ...(can.changeStatus
      ? [
          {
            key: "log-time",
            label: "Log time",
            icon: Timer,
            onPress: () => openCompose("time"),
          } satisfies SheetAction,
        ]
      : []),
    ...(can.changeStatus && columns.length
      ? [
          {
            key: "move",
            label: "Move to column",
            sublabel: task.ColumnTitle ?? undefined,
            icon: ArrowRightLeft,
            onPress: () => moveRef.current?.present(),
          } satisfies SheetAction,
        ]
      : []),
    ...(can.editFields
      ? [
          {
            key: "edit",
            label: "Edit task",
            icon: Pencil,
            onPress: () =>
              task.WorkspaceId != null &&
              navigation.navigate("TaskForm", {
                workspaceId: task.WorkspaceId,
                taskId: task.Id,
              }),
          } satisfies SheetAction,
          {
            key: "blocker",
            label: "Add a blocker",
            icon: Link2,
            onPress: () => blockerRef.current?.present(),
          } satisfies SheetAction,
          {
            key: "delete",
            label: "Delete task",
            icon: Trash2,
            tone: "danger",
            onPress: () => setConfirmingDelete(true),
          } satisfies SheetAction,
        ]
      : []),
  ];

  const moveActions: SheetAction[] = columns.map((column) => ({
    key: String(column.Id),
    label: column.Title,
    icon: ArrowRightLeft,
    selected: column.Id === task.ColumnId,
    onPress: () =>
      move.mutate({
        TaskId: taskId,
        ColumnId: column.Id,
        WorkspaceId: task.WorkspaceId,
      }),
  }));

  const blockerActions: SheetAction[] = (siblingsQuery.data?.data?.tasks ?? [])
    .filter((candidate) => candidate.Id !== taskId)
    .map((candidate) => ({
      key: String(candidate.Id),
      label: candidate.Title,
      sublabel: candidate.ColumnTitle ?? undefined,
      icon: Ban,
      onPress: () =>
        addBlocker.mutate({
          TaskId: taskId,
          DependsOnTaskId: candidate.Id,
          WorkspaceId: task.WorkspaceId,
        }),
    }));

  return (
    <Screen>
      <ScreenHeader
        title={task.WorkspaceName ?? "Task"}
        subtitle={task.ColumnTitle ?? undefined}
        onBack={navigation.goBack}
        actions={
          // Derived from the abilities, not from menuActions.length: reading
          // that array during render counts as reading the refs its handlers
          // close over.
          can.changeStatus || can.editFields
            ? [
                {
                  icon: MoreVertical,
                  label: "Task actions",
                  onPress: () => menuRef.current?.present(),
                },
              ]
            : undefined
        }
      />

      <View style={styles.summary}>
        <Text variant="h2">{task.Title}</Text>

        {task.Description ? (
          <Text variant="secondary" numberOfLines={3}>
            {task.Description}
          </Text>
        ) : null}

        {/* One dense row instead of a four-row fact card — same information,
            a fifth of the height. The time and blocker entries are tappable;
            they open the only two panels that have nowhere else to live. */}
        <View style={styles.metaRow}>
          {task.Priority ? (
            <Meta Icon={Flag} text={task.Priority} tone="priorityHigh" />
          ) : null}
          {due ? (
            <Meta
              Icon={overdue ? CircleAlert : Calendar}
              text={due}
              tone={overdue ? "danger" : "textSecondary"}
            />
          ) : null}
          {logged > 0 ? (
            <Meta
              Icon={Timer}
              text={
                estimated > 0
                  ? `${formatHours(logged)} / ${formatHours(estimated)}`
                  : formatHours(logged)
              }
              tone={
                estimated > 0 && logged > estimated ? "danger" : "textSecondary"
              }
              onPress={() => timeRef.current?.present()}
            />
          ) : null}
          {blockers > 0 ? (
            <Meta
              Icon={Ban}
              text={`${blockers} blocker${blockers === 1 ? "" : "s"}`}
              tone="danger"
              onPress={() => dependencyRef.current?.present()}
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
            <Meta Icon={UserX} text="Unassigned" tone="textMuted" />
          )}
        </View>

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "checklist", label: "Checklist", count: checklist.length },
            {
              value: "files",
              label: "Files",
              count: attachmentsQuery.data?.length ?? 0,
            },
            { value: "chat", label: "Comments", count: comments.length },
            { value: "activity", label: "History" },
          ]}
        />
      </View>

      {tab === "checklist" ? (
        <FlatList
          data={checklist}
          keyExtractor={(i) => String(i.Id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            checklist.length ? (
              <Text variant="caption" color="textMuted">
                {done} of {checklist.length} done · completion follows this checklist
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <Text variant="secondary">
              No checklist items yet. Completion is driven by this list.
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
              style={({ pressed }) => [
                styles.itemRow,
                pressed && styles.itemRowPressed,
              ]}
            >
              {item.IsCompleted ? (
                <CircleCheck size={22} color={colors.success} />
              ) : (
                <Circle size={22} color={colors.borderStrong} />
              )}
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
                  {/* A cross means dismiss; this destroys the item. */}
                  <Trash2 size={19} color={colors.danger} />
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
          ListEmptyComponent={<Text variant="secondary">No comments yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.commentCard}>
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

      {tab === "activity" ? <ActivityTab taskId={taskId} /> : null}

      {showFab ? (
        <Fab
          icon={tab === "checklist" ? Plus : MessageCircle}
          accessibilityLabel={
            tab === "checklist" ? "Add a checklist item" : "Write a comment"
          }
          onPress={() => openCompose(tab === "checklist" ? "checklist" : "comment")}
        />
      ) : null}

      {!can.changeStatus ? (
        <View
          style={[styles.readOnly, { paddingBottom: insets.bottom + spacing[2] }]}
        >
          <Eye size={15} color={colors.textMuted} />
          <Text variant="caption" color="textMuted" style={styles.flex}>
            View only — ask an owner to assign you this task to work on it.
          </Text>
        </View>
      ) : null}

      <ComposeSheet
        ref={composeRef}
        title={COMPOSE_FORM[compose].title}
        submitLabel={COMPOSE_FORM[compose].submitLabel}
        fields={COMPOSE_FORM[compose].fields}
        busy={addItem.isPending || addComment.isPending || logTime.isPending}
        onSubmit={submit}
      />

      <ActionSheet ref={menuRef} title="Task actions" actions={menuActions} />
      <ActionSheet ref={moveRef} title="Move to column" actions={moveActions} />
      <ActionSheet
        ref={blockerRef}
        title="Blocked by which task?"
        actions={blockerActions}
        emptyMessage="This board has no other tasks to depend on."
      />

      <TimeSheet
        ref={timeRef}
        taskId={taskId}
        workspaceId={task.WorkspaceId}
        userId={userId}
        canManageAny={can.editFields}
        scopedToMe={!isAdmin}
      />
      <DependencySheet
        ref={dependencyRef}
        taskId={taskId}
        workspaceId={task.WorkspaceId}
        canEdit={can.editFields}
      />

      <Dialog
        visible={confirmingDelete}
        title="Delete this task?"
        message="Its checklist, comments and attachments go with it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={removeTask.isPending}
        onConfirm={() =>
          removeTask.mutate({ Id: taskId, WorkspaceId: task.WorkspaceId })
        }
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  );
}

function Meta({
  Icon,
  text,
  tone,
  onPress,
}: {
  Icon: LucideIcon;
  text: string;
  tone: keyof typeof colors;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Icon size={14} color={colors[tone]} />
      <Text variant="caption" color={tone}>
        {text}
      </Text>
    </>
  );

  if (!onPress) return <View style={styles.meta}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={spacing[2]}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.meta,
        styles.metaTappable,
        pressed && styles.metaPressed,
      ]}
    >
      {body}
    </Pressable>
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
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    flexWrap: "wrap",
  },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  // A tappable fact needs to look like a control, or nobody finds the panel
  // behind it.
  metaTappable: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  metaPressed: { backgroundColor: colors.surfacePressed },
  avatars: { flexDirection: "row", alignItems: "center" },
  overlap: { marginLeft: -spacing[2] },
  list: {
    paddingHorizontal: SCREEN_PADDING,
    // Clears the FAB so the last row is never hidden behind it.
    paddingBottom: spacing[20],
    gap: spacing[3],
  },
  // Rows are surfaces, not bare text on the page — without a card they read as
  // pen on paper against the tinted background.
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    ...shadows.sm,
  },
  itemRowPressed: { backgroundColor: colors.surfacePressed },
  struck: {
    textDecorationLine: "line-through",
    // Only the LINE is coloured — the text stays muted so a done item recedes.
    // textDecorationColor is iOS-only; on Android the line inherits the text
    // colour, so there it renders muted rather than brand. Accepted: the strike
    // itself still reads as done on both.
    textDecorationColor: colors.primary,
    color: colors.textMuted,
  },
  readOnly: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  commentCard: {
    flexDirection: "row",
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing[4],
    ...shadows.sm,
  },
});
