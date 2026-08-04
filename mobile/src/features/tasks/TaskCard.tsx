import { memo } from "react";
import {
  Ban,
  Bug,
  Check,
  CircleAlert,
  CircleCheckBig,
  Clock,
  Columns3,
  Flag,
  FolderOpen,
  GitBranch,
  Globe,
  Layers,
  ListChecks,
  Sparkles,
  Timer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import type { Task, TaskPriority } from "../../types/api";
import { colors, radius, spacing } from "../../theme";
import { Avatar, Card, Text } from "../../ui";
import {
  assigneesOf,
  checklistProgress,
  dueBucket,
  dueLabel,
  formatHours,
} from "./taskHelpers";

interface TaskCardProps {
  task: Task;
  onPress: (task: Task) => void;
  /** Board view uses this for "move to…" — there is no drag on a phone. */
  onLongPress?: (task: Task) => void;
  /** Hide the workspace name when the list is already scoped to one board. */
  showWorkspace?: boolean;
}

/** Icon comes from the task's type, colour from its priority. */
const TYPE_ICON: Record<string, LucideIcon> = {
  task: Layers,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  research: Globe,
};

const PRIORITY_INK: Record<TaskPriority, keyof typeof colors> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

/** One icon + value pair. Reads faster than a labelled row and packs tighter. */
function Stat({
  Icon,
  value,
  tone = "textSecondary",
}: {
  Icon: LucideIcon;
  value: string;
  tone?: keyof typeof colors;
}) {
  return (
    <View style={styles.stat}>
      <Icon size={14} color={colors[tone]} />
      <Text variant="caption" color={tone}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Laid out to match ComplaintCard exactly — glyph, title block, one thing in
 * the top-right slot, then description, then a stat row that ends in a time.
 *
 * The footer strip and progress bar it used to carry are gone. Both were
 * saying something the stat row already says ("3 of 3", the board name), and
 * a list of cards is read by scanning one column of titles, not by decoding
 * four zones per card.
 */
function TaskCardBase({
  task,
  onPress,
  onLongPress,
  showWorkspace = true,
}: TaskCardProps) {
  const { done, total } = checklistProgress(task);
  const overdue = dueBucket(task.DueDate) === "overdue";
  const due = dueLabel(task.DueDate);
  const assignees = assigneesOf(task);

  const priority = task.Priority ?? null;
  const ink = task.IsCompleted
    ? colors.success
    : priority
      ? colors[PRIORITY_INK[priority]]
      : colors.neutralIcon;

  const Icon = task.IsCompleted
    ? Check
    : (TYPE_ICON[task.Type ?? "task"] ?? TYPE_ICON.task!);

  const logged = task.LoggedHours ?? 0;
  const estimated = task.EstimatedHours ?? 0;
  const subTasks = task.SubTaskCount ?? 0;
  const blockers = task.BlockerCount ?? 0;

  return (
    <Card onPress={() => onPress(task)} onLongPress={onLongPress ? () => onLongPress(task) : undefined}>
      <View style={styles.row}>
        <View style={[styles.glyph, { backgroundColor: ink }]}>
          <Icon size={20} color={colors.textOnBrand} />
        </View>

        <View style={styles.main}>
          <Text
            variant="h3"
            numberOfLines={2}
            style={task.IsCompleted ? styles.doneText : undefined}
          >
            {task.Title}
          </Text>
          <View style={styles.subRow}>
            {showWorkspace && task.WorkspaceName ? (
              <Stat Icon={FolderOpen} value={task.WorkspaceName} />
            ) : null}
            {task.ColumnTitle ? (
              <Stat Icon={Columns3} value={task.ColumnTitle} />
            ) : null}
          </View>
        </View>

        {/* The complaint card's stage pill sits here; for a task the
            equivalent question is who is on it. */}
        <View style={styles.assignees}>
          {assignees.slice(0, 2).map((a, i) => (
            <View
              key={a.UserId}
              style={[styles.avatarSlot, i > 0 && styles.avatarOverlap]}
            >
              <Avatar name={a.FullName} uri={a.Avatar} size={26} />
            </View>
          ))}
          {assignees.length > 2 ? (
            <View style={[styles.avatarSlot, styles.avatarOverlap, styles.more]}>
              <Text variant="caption" color="textSecondary">
                +{assignees.length - 2}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {task.Description ? (
        <Text variant="secondary" numberOfLines={2}>
          {task.Description}
        </Text>
      ) : null}

      {/* Everything here comes from columns sp_FetchTask already returns —
          none of it costs an extra request. */}
      <View style={styles.stats}>
        {total > 0 ? (
          <Stat
            Icon={task.IsCompleted ? CircleCheckBig : ListChecks}
            value={`${done} of ${total}`}
            tone={task.IsCompleted ? "success" : "textSecondary"}
          />
        ) : null}
        {priority ? (
          <Stat Icon={Flag} value={priority} tone={PRIORITY_INK[priority]} />
        ) : null}
        {logged > 0 ? (
          <Stat
            Icon={Timer}
            value={
              estimated > 0
                ? `${formatHours(logged)} / ${formatHours(estimated)}`
                : formatHours(logged)
            }
            tone={estimated > 0 && logged > estimated ? "danger" : "textSecondary"}
          />
        ) : null}
        {subTasks > 0 ? <Stat Icon={GitBranch} value={String(subTasks)} /> : null}
        {blockers > 0 ? (
          <Stat Icon={Ban} value={String(blockers)} tone="danger" />
        ) : null}

        <View style={styles.spacer} />

        {due ? (
          <Stat
            Icon={overdue ? CircleAlert : Clock}
            value={due}
            tone={overdue ? "danger" : "textSecondary"}
          />
        ) : null}
      </View>
    </Card>
  );
}

/** Lists re-render on every refetch; the card only changes when the task does. */
export const TaskCard = memo(TaskCardBase);
export default TaskCard;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  glyph: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  main: { flex: 1, gap: spacing[1] },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    flexWrap: "wrap",
  },
  // Muted strike, muted line. The strikethrough is what actually reads as
  // "finished" at a glance, so it stays — but deliberately uncoloured: React
  // Native has no textDecorationThickness, and at 15px a 1px line is too thin
  // to carry a colour. Muted works because it matches the text either way,
  // including on Android where the line always inherits the text colour.
  doneText: {
    textDecorationLine: "line-through",
    color: colors.textMuted,
  },
  assignees: { flexDirection: "row", alignItems: "center" },
  avatarSlot: {
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  avatarOverlap: { marginLeft: -spacing[3] },
  more: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    flexWrap: "wrap",
  },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  spacer: { flex: 1 },
});
