import { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Ban,
  EllipsisVertical,
  Eye,
  Flag,
  GitBranch,
  Link2,
  Lock,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Timer,
  Trash2,
  UserCheck,
} from "lucide-react-native";
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
import { fetchKanbanColumns } from "../../api/kanbanQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { TaskChecklistItem, TaskComment } from "../../types/api";
import useAuthStore from "../../stores/useAuthStore";
import { metrics, priorityChip, spacing } from "../../theme";
import {
  ActionSheet,
  Avatar,
  AvatarStack,
  Band,
  BandSheet,
  Button,
  Card,
  Chip,
  ComposeSheet,
  Dialog,
  EmptyState,
  ErrorCard,
  Facts,
  GroupHeader,
  IconButton,
  InfoNote,
  Screen,
  SegmentedTabs,
  SkeletonRows,
  Text,
  type ComposeField,
  type SheetAction,
  type SheetRef,
  toISODate,
  useToast,
} from "../../ui";
import AttachmentList from "../attachments/AttachmentList";
import ActivityTab from "./ActivityTab";
import { Checklist } from "./Checklist";
import { DependencySheet } from "./DependencySheet";
import { TatTab } from "./TatTab";
import { TimeSheet } from "./TimeSheet";
import { hm, istDay } from "./tatChip";
import {
  abilitiesFor,
  assigneesOf,
  boardQuery,
  formatHours,
  relativeTime,
  shortDay,
  taskDueChip,
  threadComments,
  WORKSPACES_QUERY,
} from "./taskHelpers";

type Props = StackScreenProps<RootStackParamList, "TaskDetail">;
/** E 08: four tabs; Files is a drill-in from Details, History lives in Details. */
type Tab = "details" | "checklist" | "chat" | "tat";
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
  const stepMenuRef = useRef<SheetRef>(null);
  // The step a long-press picked, and the comment waiting on the delete dialog (21).
  const [step, setStep] = useState<TaskChecklistItem | null>(null);
  const [deleting, setDeleting] = useState<TaskComment | null>(null);
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
  // Authority comes from the caller's role in THIS task's workspace, which the
  // task row does not carry. Already cached by Boards, so this costs nothing.
  const { data: workspaces } = useQuery(WORKSPACES_QUERY);

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
    onSuccess: () => {
      setDeleting(null);
      void refreshComments();
    },
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

  // The band renders in every one of these states on purpose: a loading or
  // failed screen with no back button is a dead end.
  if (taskQuery.isLoading || taskQuery.isError || !task) {
    return (
      <Screen band>
        <Band variant="record" title="Task" onBack={navigation.goBack} />
        <BandSheet scroll center={!taskQuery.isLoading && !taskQuery.isError}>
          {taskQuery.isLoading ? (
            <SkeletonRows rows={4} />
          ) : taskQuery.isError ? (
            <ErrorCard
              message="The task could not be loaded. Check your connection and try again."
              onRetry={() => void taskQuery.refetch()}
            />
          ) : (
            // Loaded fine, but no row — deleted, or access revoked. No retry.
            <EmptyState
              module="tasks"
              icon={Lock}
              title="Task not available"
              message="It may have been deleted, or you no longer have access to its board."
            />
          )}
        </BandSheet>
      </Screen>
    );
  }

  const doneOn = istDay(task.CompletedDate);
  const logged = task.LoggedHours ?? 0;
  const estimated = task.EstimatedHours ?? 0;
  const blockers = task.BlockerCount ?? 0;
  const columns = columnsQuery.data ?? [];
  // claim_task: an open task nobody is on, for someone who may hold one. A
  // viewer can't hold a task (094), so can.claim is false for them.
  const canClaim = can.claim && !task.IsCompleted;

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
                onPress: () => setDeleting(picked),
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

  const editTask = () =>
    task.WorkspaceId != null && navigation.navigate("TaskForm", { workspaceId: task.WorkspaceId, taskId: task.Id });

  // Long-press a step: remove it (the last step stays — 094). No reorder:
  // saveTaskChecklist has no reorder semantics (each save logs a tick).
  const stepActions: SheetAction[] =
    step && checklist.length > 1
      ? [{
          key: "remove",
          label: "Remove step",
          icon: Trash2,
          tone: "danger",
          onPress: () => removeItem.mutate({ Id: step.Id, TaskId: taskId, WorkspaceId: task.WorkspaceId }),
        }]
      : [];

  const dueChip = taskDueChip(task, false);
  const people = assignees.map((a) => ({ name: a.FullName, uri: a.Avatar, userId: a.UserId }));
  const personal = ws?.Type === "personal";

  const details = (
    <View>
      {task.Description ? (
        <Card gap={0}>
          <Text variant="text">{task.Description}</Text>
        </Card>
      ) : null}
      <Card style={task.Description ? styles.gapTop : undefined} gap={0}>
        <Facts
          items={[
            { label: "Workspace", value: task.WorkspaceName ?? undefined },
            { label: "Column", value: task.ColumnTitle ?? undefined },
            { label: "Due", value: task.DueDate ? `${shortDay(task.DueDate)}${task.DueTime ? ` · ${task.DueTime}` : ""}` : undefined },
            { label: "Time allowed", value: task.TatMinutes ? hm(task.TatMinutes * 60_000) : undefined },
            { label: "Logged time", value: logged > 0 ? (estimated > 0 ? `${formatHours(logged)} of ${formatHours(estimated)}` : formatHours(logged)) : undefined },
            {
              label: "Blocked by",
              value: blockers > 0 ? `${blockers} task${blockers === 1 ? "" : "s"}` : "Nothing",
              tone: blockers > 0 ? "danger" : undefined,
            },
          ]}
        />
      </Card>
      <GroupHeader label="Files" />
      <AttachmentList entity="task" entityId={taskId} canManage={can.manageArtifacts} embedded />
      <GroupHeader label="History" />
      <ActivityTab taskId={taskId} />
    </View>
  );

  const thread = (
    <View>
      {comments.length ? (
        threadComments(comments).map(({ comment: c, reply }) => {
          const allows = commentAllows(c);
          const tags = [
            ...(c.IsEdited && !c.IsDeleted ? ["edited"] : []),
            ...(c.IsPinned ? ["pinned"] : []),
          ];
          return (
            <Card
              key={c.Id}
              testID={`comment-${c.Id}`}
              tone={deleting?.Id === c.Id ? "danger" : "surface"}
              gap={0}
              style={reply ? styles.replyComment : styles.comment}
              onLongPress={
                allows.reply || allows.own || allows.pin
                  ? () => {
                      setPicked(c);
                      commentMenuRef.current?.present();
                    }
                  : undefined
              }
            >
              <View style={styles.commentHead}>
                <Avatar name={c.UserName} uri={c.Avatar} size={COMMENT_AVATAR} ring={null} />
                <Text variant="rowTitleBold" numberOfLines={1} style={styles.flex}>{c.UserName ?? "Someone"}</Text>
                <Text variant="label" tabular>{relativeTime(c.CreatedDate)}</Text>
              </View>
              <Text
                variant="text"
                color={c.IsDeleted ? "textMuted" : "text"}
                style={[styles.commentText, c.IsDeleted ? styles.deleted : null]}
              >
                {c.Comment}
              </Text>
              {tags.length ? <Text variant="small" style={styles.commentText}>{tags.join(" · ")}</Text> : null}
            </Card>
          );
        })
      ) : (
        <EmptyState module="tasks" icon={MessageCircle} title="No comments yet" message="Updates on this task, from anyone on the board." />
      )}
      {can.comment ? (
        <Button title="Write a comment" icon={MessageCircle} variant="secondary" fullWidth style={styles.gapTop} onPress={() => openCompose("comment")} />
      ) : null}
    </View>
  );

  return (
    <Screen band>
      <Band
        variant="record"
        onBack={navigation.goBack}
        subtitle={[task.WorkspaceName ?? "Task", task.ColumnTitle].filter(Boolean).join(" · ")}
        actions={
          <>
            {can.editFields ? <IconButton icon={Pencil} accessibilityLabel="Edit task" onPress={editTask} /> : null}
            <IconButton icon={EllipsisVertical} accessibilityLabel="Task actions" onPress={() => menuRef.current?.present()} />
          </>
        }
      >
        <Text variant="recordTitle" color="textOnBrand" accessibilityRole="header" style={styles.title}>{task.Title}</Text>
        <View style={styles.chips}>
          {people.length ? <AvatarStack people={people} ring="band" /> : <Chip label="Unassigned" tone="slate" />}
          {task.Priority ? <Chip label={task.Priority} icon={Flag} tone={priorityChip(task.Priority).tone} /> : null}
          {task.IsCompleted ? <Chip label={doneOn ? `Done ${doneOn}` : "Done"} tone="green" /> : null}
          {dueChip ? <Chip label={dueChip.label === "Missed" ? "Missed deadline" : dueChip.label} tone={dueChip.tone} icon={dueChip.icon} /> : null}
          {task.IsBlocked ? <Chip label="Blocked" tone="red" icon={Ban} /> : null}
        </View>
      </Band>

        <BandSheet scroll>
          {!can.changeStatus ? (
            <View style={styles.note}>
              <InfoNote icon={Eye}>View only — ask an owner to assign you this task to work on it.</InfoNote>
            </View>
          ) : null}
          <SegmentedTabs
            value={tab}
            onChange={switchTab}
            options={[
              { value: "details", label: "Details" },
              { value: "checklist", label: "Checklist" },
              { value: "chat", label: "Comments", count: comments.length },
              // Personal boards run no deadline clocks.
              ...(personal ? [] : [{ value: "tat" as const, label: "Deadline" }]),
            ]}
          />
          <View style={styles.panel}>
            {tab === "details" ? details : null}
            {tab === "checklist" ? (
              <Checklist
                items={checklist}
                canToggle={can.changeStatus && !toggleItem.isPending}
                canManage={can.manageArtifacts}
                onAdd={() => openCompose("checklist")}
                onLongPress={(item) => {
                  setStep(item);
                  stepMenuRef.current?.present();
                }}
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
              />
            ) : null}
            {tab === "chat" ? thread : null}
            {tab === "tat" ? (
              <TatTab taskId={taskId} userId={userId} tatMinutes={task.TatMinutes} explainTatId={explainTatId} />
            ) : null}
          </View>
        </BandSheet>

      <ComposeSheet
        ref={composeRef}
        title={compose === "reply" && picked ? `Reply to ${picked.UserName ?? "comment"}` : COMPOSE_FORM[compose].title}
        submitLabel={COMPOSE_FORM[compose].submitLabel}
        fields={COMPOSE_FORM[compose].fields}
        initialValues={composeSeed}
        busy={addItem.isPending || addComment.isPending || logTime.isPending}
        error={composeError}
        onSubmit={submit}
      />

      <ActionSheet ref={menuRef} title="Task actions" actions={menuActions} />
      <ActionSheet ref={commentMenuRef} title="Comment" actions={commentActions} />
      <ActionSheet ref={stepMenuRef} title={step?.ItemText ?? "Step"} actions={stepActions} />
      <ActionSheet ref={moveRef} title="Move to column" actions={moveActions} />
      <ActionSheet
        ref={blockerRef}
        title={asBlocker ? "Blocked by which task?" : "Which task waits on this one?"}
        actions={blockerActions}
        emptyMessage="This board has no other tasks to depend on."
      />

      <TimeSheet ref={timeRef} taskId={taskId} workspaceId={task.WorkspaceId} userId={userId} canManageAny={can.editFields} scopedToMe={!isAdmin} />
      <DependencySheet ref={dependencyRef} taskId={taskId} workspaceId={task.WorkspaceId} canEdit={can.editFields} />

      <Dialog
        visible={deleting != null}
        badge={{ tone: "red", icon: Trash2 }}
        title="Delete this comment?"
        message={`"${deleting?.Comment ?? ""}" is removed for everyone in ${task.WorkspaceName ?? "this workspace"}. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={removeComment.isPending}
        onConfirm={() =>
          deleting &&
          once(`delete-${deleting.Id}`, () =>
            removeComment.mutate({ Id: deleting.Id, TaskId: taskId, WorkspaceId: task.WorkspaceId }),
          )
        }
        onCancel={() => setDeleting(null)}
      />
      <Dialog
        visible={confirmingDelete}
        badge={{ tone: "red", icon: Trash2 }}
        title="Delete this task?"
        message="It disappears from every board and list. Its history is kept."
        confirmLabel="Delete"
        destructive
        loading={removeTask.isPending}
        onConfirm={() => removeTask.mutate({ Id: taskId, WorkspaceId: task.WorkspaceId })}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  );
}

/** The comment avatar and its gap: the text lines up under the name. */
const COMMENT_AVATAR = 28;

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  // ponytail: E's 2 has no token; rowLineGap (3) is the nearest.
  title: { marginTop: metrics.rowLineGap },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2], marginTop: spacing[3] },
  note: { marginBottom: spacing[3] },
  panel: { marginTop: spacing[3] },
  gapTop: { marginTop: spacing[3] },
  comment: { paddingVertical: spacing[3], paddingHorizontal: metrics.rowPadH, marginBottom: spacing[2] },
  replyComment: {
    paddingVertical: spacing[3],
    paddingHorizontal: metrics.rowPadH,
    marginBottom: spacing[2],
    marginLeft: spacing[6],
  },
  // ponytail: E's 10 has no spacing step; pairGap is the 10 in the scale.
  commentHead: { flexDirection: "row", alignItems: "center", gap: metrics.pairGap },
  commentText: { marginTop: metrics.rowLineGap, marginLeft: COMMENT_AVATAR + metrics.pairGap },
  deleted: { fontStyle: "italic" },
});
