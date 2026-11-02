import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Ban,
  Calendar,
  CircleAlert,
  Eye,
  Flag,
  GitBranch,
  Link2,
  Lock,
  MessageCircle,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  Timer,
  Trash2,
  UserCheck,
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
  deleteTaskComment,
  fetchTaskById,
  fetchTaskDependencies,
  getTaskChecklist,
  getTaskComments,
  logTaskTime,
  moveTaskColumn,
  pinTaskComment,
  saveTaskChecklist,
  claimTask,
} from "../../api/taskQueries";
import { apiErrorMessage } from "../../api/errors";
import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { TaskComment } from "../../types/api";
import useAuthStore from "../../stores/useAuthStore";
import { colors, radius, shadows, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Avatar,
  Chip,
  ComposeSheet,
  Dialog,
  Fab,
  Screen,
  ScreenHeader,
  ScreenLoader,
  Segmented,
  Text,
  Timeline,
  type ComposeField,
  type SheetAction,
  type SheetRef,
  toISODate,
  useToast,
} from "../../ui";
import AttachmentList from "../attachments/AttachmentList";
import { priorityTone } from "../support/ticketHelpers";
import ActivityTab from "./ActivityTab";
import { Checklist } from "./Checklist";
import { DependencySheet } from "./DependencySheet";
import { TatTab } from "./TatTab";
import { TimeSheet } from "./TimeSheet";
import { istDay } from "./tatChip";
import {
  abilitiesFor,
  assigneesOf,
  boardQuery,
  dueBucket,
  dueLabel,
  formatHours,
  relativeTime,
  threadComments,
} from "./taskHelpers";

type Props = StackScreenProps<RootStackParamList, "TaskDetail">;
type Tab = "checklist" | "files" | "chat" | "tat" | "activity";
/** Which form the one compose sheet is currently showing. */
type Compose = "checklist" | "comment" | "reply" | "edit" | "time";

const COMMENT_FIELDS: ComposeField[] = [
  { key: "text", placeholder: "Share an update…", multiline: true, required: true },
];

const COMPOSE_FORM: Record<
  Compose,
  { title: string; submitLabel: string; fields: ComposeField[] }
> = {
  checklist: {
    title: "Add checklist item",
    submitLabel: "Add item",
    fields: [{ key: "text", placeholder: "What needs doing?", required: true }],
  },
  comment: { title: "Write a comment", submitLabel: "Post comment", fields: COMMENT_FIELDS },
  // The reply title names who is being answered; see the ComposeSheet below.
  reply: { title: "Reply", submitLabel: "Post reply", fields: COMMENT_FIELDS },
  edit: { title: "Edit comment", submitLabel: "Save comment", fields: COMMENT_FIELDS },
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
  const toast = useToast();
  const userId = useAuthStore((s) => s.UserId);
  const isAdmin = useAuthStore((s) => Boolean(s.access?.isAdmin));

  const [tab, setTab] = useState<Tab>(route.params.tab ?? "checklist");
  const [compose, setCompose] = useState<Compose>("checklist");
  // Why the last compose submit failed. Cleared when the sheet is opened
  // again, so a stale reason never greets the next entry.
  const [composeError, setComposeError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The clock a just-finished tick owes a reason on. TatTab opens its sheet;
  // leaving the tab drops the request, so coming back does not pop it again.
  const [explainTatId, setExplainTatId] = useState<number | null>(route.params.explainTatId ?? null);
  const switchTab = (next: Tab) => {
    setTab(next);
    setExplainTatId(null);
  };

  const composeRef = useRef<SheetRef>(null);
  const menuRef = useRef<SheetRef>(null);
  const moveRef = useRef<SheetRef>(null);
  const blockerRef = useRef<SheetRef>(null);
  const timeRef = useRef<SheetRef>(null);
  const dependencyRef = useRef<SheetRef>(null);
  const commentMenuRef = useRef<SheetRef>(null);
  // The comment a long-press picked: its actions, then the reply/edit target.
  const [picked, setPicked] = useState<TaskComment | null>(null);
  // A new object per open, so the compose sheet reseeds (see ComposeSheet):
  // a half-typed comment must not turn up in a reply, or in an edit.
  const [composeSeed, setComposeSeed] = useState<Record<string, string>>({});
  // Comment deletes/pins in flight, keyed per comment. A ref, not state: a
  // double-tap lands before any re-render could show the first was pending.
  // Freed in the hooks' own onSettled — a callback passed to mutate() runs
  // only for the latest call, so tapping B would leave A locked for good.
  const inFlight = useRef(new Set<string>());
  const once = (key: string, run: () => void) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    run();
  };
  // One picker for both directions: "blocker" = a task this one waits on,
  // "dependent" = a task that waits on this one.
  const [linkDirection, setLinkDirection] = useState<"blocker" | "dependent">("blocker");

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
    queryKey: ["workspaces", false],
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
    ...boardQuery(boardId),
    enabled: boardId != null,
  });
  // Same key as DependencySheet, so one request serves both: the picker leaves
  // out a task already linked in the direction being added (web does the same).
  const depsQuery = useQuery({
    queryKey: ["task", taskId, "dependencies"],
    queryFn: () => fetchTaskDependencies({ TaskId: taskId }),
  });

  const ws = useMemo(() => workspaces?.find((w) => w.Id === boardId), [workspaces, boardId]);
  const role = ws?.MyRole ?? null;
  const can = abilitiesFor(task, userId, role, isAdmin, ws?.Type ?? null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  // Ticking a box and adding a step are the same endpoint but not the same
  // failure. A rejected tick un-ticks itself, which reads as the app ignoring
  // the tap — and the compose sheet is not even open to carry the reason. It
  // goes to a toast rather than a line under the list: by the time the request
  // comes back the finger has moved on, and a message at the bottom of a
  // scrolled list is one nobody sees.
  const toggleItem = useMutation({
    mutationFn: saveTaskChecklist,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update that step.")),
    onSuccess: (res) => {
      invalidate();
      if (res.data?.completionChange === "completed") {
        toast.success("Task completed — the creator has been told");
      }
      // Finishing a task you ran over on asks why, while it is fresh.
      if (res.data?.tatReasonNeeded) {
        setExplainTatId(res.data.tatReasonNeeded);
        setTab("tat");
      }
    },
  });
  const removeItem = useMutation({
    mutationFn: deleteTaskChecklist,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not remove that step.")),
    onSuccess: invalidate,
  });
  const addItem = useMutation({
    mutationFn: saveTaskChecklist,
    onError: (err) => setComposeError(apiErrorMessage(err, "Could not add that step.")),
    onSuccess: () => {
      composeRef.current?.dismiss();
      invalidate();
    },
  });
  const addComment = useMutation({
    mutationFn: addTaskComment,
    onError: (err) => setComposeError(apiErrorMessage(err, "Could not post that comment.")),
    onSuccess: () => {
      composeRef.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["task", taskId, "comments"] });
    },
  });
  const refreshComments = () =>
    queryClient.invalidateQueries({ queryKey: ["task", taskId, "comments"] });
  const removeComment = useMutation({
    mutationFn: deleteTaskComment,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete that comment.")),
    onSuccess: refreshComments,
    onSettled: (_data, _err, vars) => inFlight.current.delete(`delete-${vars.Id}`),
  });
  const pinComment = useMutation({
    mutationFn: pinTaskComment,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not pin that comment.")),
    onSuccess: refreshComments,
    onSettled: (_data, _err, vars) => inFlight.current.delete(`pin-${vars.CommentId}`),
  });
  const logTime = useMutation({
    mutationFn: logTaskTime,
    onError: (err) => setComposeError(apiErrorMessage(err, "Could not log that time.")),
    onSuccess: () => {
      composeRef.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["task", taskId, "time"] });
      invalidate();
    },
  });
  const move = useMutation({
    mutationFn: moveTaskColumn,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not move this task.")),
    onSuccess: invalidate,
  });
  const claim = useMutation({
    mutationFn: claimTask,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not take this task.")),
    onSuccess: invalidate,
  });
  const addBlocker = useMutation({
    mutationFn: addTaskDependency,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not link those tasks.")),
    onSuccess: (_res, vars) => {
      // ["task", taskId] covers this task's dependencies; the other end changed too.
      queryClient.invalidateQueries({ queryKey: ["task", vars.TaskId === taskId ? vars.DependsOnTaskId : vars.TaskId] });
      invalidate();
    },
  });
  const removeTask = useMutation({
    mutationFn: deleteTask,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete this task.")),
    onSuccess: () => {
      setConfirmingDelete(false);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigation.goBack();
    },
  });

  const checklist = checklistQuery.data ?? [];
  const comments = commentsQuery.data ?? [];
  const assignees = task ? assigneesOf(task) : [];

  // The header renders in every one of these states on purpose: a loading or
  // failed screen with no back button is a dead end, and force-quitting the app
  // was the only way out of it.
  if (taskQuery.isLoading || taskQuery.isError) {
    return (
      <Screen>
        <ScreenHeader title="Task" onBack={navigation.goBack} />
        <ScreenLoader
          failed={taskQuery.isError}
          onRetry={taskQuery.refetch}
          message={
            taskQuery.isError
              ? "The task could not be loaded. Check your connection and try again."
              : undefined
          }
        />
      </Screen>
    );
  }

  // Loaded fine, but there is no row — deleted, or access was revoked. That is
  // a different thing from a failed request and must not offer a retry.
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
  const doneOn = istDay(task.CompletedDate);
  const due = dueLabel(task.DueDate);
  const logged = task.LoggedHours ?? 0;
  const estimated = task.EstimatedHours ?? 0;
  const blockers = task.BlockerCount ?? 0;
  const columns = columnsQuery.data ?? [];
  // claim_task: an open task nobody is on, for someone who may hold one. A
  // viewer can't hold a task (094), so can.claim is false for them.
  const canClaim = can.claim && !task.IsCompleted;

  // Files brings its own FAB (it needs the camera/library/file picker sheet).
  const showFab =
    (tab === "checklist" && can.manageArtifacts) || (tab === "chat" && can.comment);

  const openCompose = (kind: Compose, seed: Record<string, string> = {}) => {
    setComposeSeed(seed);
    setCompose(kind);
    setComposeError(null);
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
    if (compose === "comment" || compose === "reply" || compose === "edit") {
      addComment.mutate({
        // Id > 0 edits (sp_SaveTaskComment); a reply names what it answers,
        // like the web, so its author is the one notified.
        ...(compose === "edit" && picked ? { Id: picked.Id } : {}),
        TaskId: taskId,
        Comment: values.text ?? "",
        ...(compose === "reply" && picked ? { ParentCommentId: picked.Id } : {}),
        WorkspaceId: task.WorkspaceId,
      });
      return;
    }
    const hours = Number(values.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      // Used to return silently. The sheet cleared itself on submit back then,
      // so it at least looked like something happened; now that it keeps the
      // text, saying nothing would read as a dead button.
      setComposeError("Enter how many hours, as a number above zero.");
      return;
    }
    logTime.mutate({
      TaskId: taskId,
      Hours: hours,
      Description: values.note ?? "",
      // The phone's own day: left to the server it was the UTC day, so time
      // logged 00:00–05:30 IST went under yesterday.
      WorkDate: toISODate(new Date()),
      WorkspaceId: task.WorkspaceId,
    });
  };

  // Actions the current role is allowed to take. Built as a literal with
  // conditional spreads rather than pushed into: showing a viewer a menu that
  // is mostly greyed out is worse than showing them a short one.
  const menuActions: SheetAction[] = [
    ...(canClaim
      ? [
          {
            key: "claim",
            label: "Take this task",
            icon: UserCheck,
            onPress: () => claim.mutate({ TaskId: taskId, WorkspaceId: task.WorkspaceId }),
          } satisfies SheetAction,
        ]
      : []),
    ...(can.logTime
      ? [
          {
            key: "log-time",
            label: "Log time",
            icon: Timer,
            onPress: () => openCompose("time"),
          } satisfies SheetAction,
        ]
      : []),
    // Always here: the meta chip only shows once something is logged.
    {
      key: "time-logged",
      label: "Time logged",
      icon: Timer,
      onPress: () => timeRef.current?.present(),
    },
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
            onPress: () => {
              setLinkDirection("blocker");
              blockerRef.current?.present();
            },
          } satisfies SheetAction,
          {
            key: "dependent",
            label: "Blocks another task",
            icon: GitBranch,
            onPress: () => {
              setLinkDirection("dependent");
              blockerRef.current?.present();
            },
          } satisfies SheetAction,
        ]
      : []),
    // Always here: the meta chip only shows while something blocks this task.
    {
      key: "dependencies",
      label: "Dependencies",
      accessibilityLabel: "Open dependencies",
      icon: Ban,
      onPress: () => dependencyRef.current?.present(),
    },
    ...(can.deleteTask
      ? [
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

  // What the long-pressed comment allows. The server guards each of these too
  // (edit_own_comment, pin) — hiding a row is a courtesy.
  const commentAllows = (c: TaskComment) => {
    const live = !c.IsDeleted;
    const mine = userId != null && Number(c.UserId) === Number(userId);
    return {
      reply: live && can.comment,
      own: live && mine,
      pin: live && can.pinComment,
    };
  };
  const pickedAllows = picked ? commentAllows(picked) : null;
  const commentActions: SheetAction[] = picked && pickedAllows
    ? [
        ...(pickedAllows.reply
          ? [
              {
                key: "reply",
                label: "Reply",
                icon: Reply,
                onPress: () => openCompose("reply"),
              } satisfies SheetAction,
            ]
          : []),
        ...(pickedAllows.own
          ? [
              {
                key: "edit",
                label: "Edit comment",
                icon: Pencil,
                onPress: () => openCompose("edit", { text: picked.Comment }),
              } satisfies SheetAction,
              {
                key: "delete",
                label: "Delete comment",
                icon: Trash2,
                tone: "danger",
                onPress: () =>
                  once(`delete-${picked.Id}`, () =>
                    removeComment.mutate({
                      Id: picked.Id,
                      TaskId: taskId,
                      WorkspaceId: task.WorkspaceId,
                    }),
                  ),
              } satisfies SheetAction,
            ]
          : []),
        ...(pickedAllows.pin
          ? [
              {
                key: "pin",
                label: picked.IsPinned ? "Unpin comment" : "Pin comment",
                icon: picked.IsPinned ? PinOff : Pin,
                onPress: () =>
                  once(`pin-${picked.Id}`, () =>
                    pinComment.mutate({
                      CommentId: picked.Id,
                      IsPinned: !picked.IsPinned,
                      TaskId: taskId,
                      WorkspaceId: task.WorkspaceId,
                    }),
                  ),
              } satisfies SheetAction,
            ]
          : []),
      ]
    : [];

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

  const asBlocker = linkDirection === "blocker";
  const linked = new Set(
    (asBlocker ? depsQuery.data?.blockers : depsQuery.data?.dependents)?.map((d) => d.TaskId),
  );
  const blockerActions: SheetAction[] = (siblingsQuery.data?.data?.tasks ?? [])
    .filter((candidate) => candidate.Id !== taskId && !linked.has(candidate.Id))
    .map((candidate) => ({
      key: String(candidate.Id),
      label: candidate.Title,
      sublabel: candidate.ColumnTitle ?? undefined,
      icon: asBlocker ? Ban : GitBranch,
      onPress: () =>
        addBlocker.mutate({
          // The edge lives on the waiting task.
          TaskId: asBlocker ? taskId : candidate.Id,
          DependsOnTaskId: asBlocker ? candidate.Id : taskId,
          WorkspaceId: task.WorkspaceId,
        }),
    }));

  return (
    <Screen>
      <ScreenHeader
        title={task.WorkspaceName ?? "Task"}
        subtitle={task.ColumnTitle ?? undefined}
        onBack={navigation.goBack}
        // Always shown: "Time logged" is on the menu for everyone.
        actions={[
          {
            icon: MoreVertical,
            label: "Task actions",
            onPress: () => menuRef.current?.present(),
          },
        ]}
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
          {task.IsCompleted ? (
            <Chip
              label={doneOn ? `Done ${doneOn}` : "Done"}
              tone="success"
            />
          ) : null}
          {task.IsBlocked ? <Chip label="Blocked" tone="danger" /> : null}
          {task.Priority ? (
            <Chip label={task.Priority} icon={Flag} tone={priorityTone(task.Priority)} />
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
          onChange={switchTab}
          options={[
            { value: "checklist", label: "Checklist", count: checklist.length },
            {
              value: "files",
              label: "Files",
              count: attachmentsQuery.data?.length ?? 0,
            },
            { value: "chat", label: "Comments", count: comments.length },
            // Personal boards run no deadline clocks.
            ...(ws?.Type === "personal" ? [] : [{ value: "tat" as const, label: "Deadline" }]),
            { value: "activity", label: "History" },
          ]}
        />
      </View>

      {tab === "checklist" ? (
        <Checklist
          items={checklist}
          canToggle={can.changeStatus && !toggleItem.isPending}
          canManage={can.manageArtifacts}
          onToggle={(item) =>
            toggleItem.mutate({
              Id: item.Id,
              TaskId: taskId,
              ItemText: item.ItemText,
              IsCompleted: !item.IsCompleted,
              SortOrder: item.SortOrder ?? 0,
              WorkspaceId: task.WorkspaceId,
            })
          }
          onDelete={(item) =>
            removeItem.mutate({
              Id: item.Id,
              TaskId: taskId,
              WorkspaceId: task.WorkspaceId,
            })
          }
        />
      ) : null}


      {tab === "files" ? (
        <AttachmentList
          entity="task"
          entityId={taskId}
          canManage={can.manageArtifacts}
        />
      ) : null}

      {/* Comments are a conversation in time, exactly like the history — so
          they use the same rail rather than a stack of cards. The avatar IS
          the node, which is why Timeline takes one. */}
      {tab === "chat" ? (
        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {comments.length ? (
            <Timeline
              entries={threadComments(comments).map(({ comment: c, reply }) => {
                const allows = commentAllows(c);
                return {
                  key: String(c.Id),
                  testID: `comment-${c.Id}`,
                  title: c.Comment,
                  meta: [
                    c.UserName ?? "Someone",
                    relativeTime(c.CreatedDate),
                    ...(c.IsEdited && !c.IsDeleted ? ["edited"] : []),
                    ...(c.IsPinned ? ["pinned"] : []),
                  ].join(" · "),
                  node: <Avatar name={c.UserName} uri={c.Avatar} size={24} />,
                  indent: reply,
                  muted: Boolean(c.IsDeleted),
                  onLongPress:
                    allows.reply || allows.own || allows.pin
                      ? () => {
                          setPicked(c);
                          commentMenuRef.current?.present();
                        }
                      : undefined,
                };
              })}
            />
          ) : (
            <Text variant="secondary">No comments yet.</Text>
          )}
        </ScrollView>
      ) : null}

      {tab === "tat" ? (
        <TatTab
          taskId={taskId}
          userId={userId}
          explainTatId={explainTatId}
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
        title={
          compose === "reply" && picked
            ? `Reply to ${picked.UserName ?? "comment"}`
            : COMPOSE_FORM[compose].title
        }
        submitLabel={COMPOSE_FORM[compose].submitLabel}
        fields={COMPOSE_FORM[compose].fields}
        initialValues={composeSeed}
        busy={addItem.isPending || addComment.isPending || logTime.isPending}
        error={composeError}
        onSubmit={submit}
      />

      <ActionSheet ref={menuRef} title="Task actions" actions={menuActions} />
      <ActionSheet ref={commentMenuRef} title="Comment" actions={commentActions} />
      <ActionSheet ref={moveRef} title="Move to column" actions={moveActions} />
      <ActionSheet
        ref={blockerRef}
        title={asBlocker ? "Blocked by which task?" : "Which task waits on this one?"}
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
        message="It disappears from every board and list. Its history is kept."
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
  metaPressed: { transform: [{ translateY: 1 }] },
  avatars: { flexDirection: "row", alignItems: "center" },
  overlap: { marginLeft: -spacing[2] },
  list: {
    paddingHorizontal: SCREEN_PADDING,
    // Clears the FAB so the last row is never hidden behind it.
    paddingBottom: spacing[20],
    gap: spacing[3],
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
});
