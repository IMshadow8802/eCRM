import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import type { Task, TaskPriority } from "../../types/api";
import { colors, radius, shadows, spacing } from "../../theme";
import { Avatar, Text } from "../../ui";
import {
  assigneesOf,
  checklistProgress,
  dueBucket,
  dueLabel,
} from "./taskHelpers";

interface TaskCardProps {
  task: Task;
  onPress: (task: Task) => void;
  /** Hide the workspace name when the list is already scoped to one board. */
  showWorkspace?: boolean;
}

/** Icon comes from the task's type, colour from its priority. */
const TYPE_ICON: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  task: "layers",
  bug: "bug-report",
  feature: "auto-awesome",
  improvement: "trending-up",
  research: "travel-explore",
};

const PRIORITY_INK: Record<TaskPriority, keyof typeof colors> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

/** One icon + value pair. Reads faster than a labelled row and packs tighter. */
function Stat({
  icon,
  value,
  tone = "textSecondary",
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  value: string;
  tone?: keyof typeof colors;
}) {
  return (
    <View style={styles.stat}>
      <MaterialIcons name={icon} size={14} color={colors[tone]} />
      <Text variant="caption" color={tone}>
        {value}
      </Text>
    </View>
  );
}

/** "4h" / "1.5h" — hours are decimals in the DB and 1.5 must not print as 2. */
const hours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

function TaskCardBase({ task, onPress, showWorkspace = true }: TaskCardProps) {
  const { done, total } = checklistProgress(task);
  const pct = total > 0 ? done / total : 0;
  const overdue = dueBucket(task.DueDate) === "overdue";
  const due = dueLabel(task.DueDate);
  const assignees = assigneesOf(task);

  const priority = task.Priority ?? null;
  const ink = task.IsCompleted
    ? colors.success
    : priority
      ? colors[PRIORITY_INK[priority]]
      : colors.neutralIcon;

  const icon = task.IsCompleted
    ? "check"
    : (TYPE_ICON[task.Type ?? "task"] ?? TYPE_ICON.task!);

  const logged = task.LoggedHours ?? 0;
  const estimated = task.EstimatedHours ?? 0;
  const subTasks = task.SubTaskCount ?? 0;
  const blockers = task.BlockerCount ?? 0;

  return (
    <Pressable
      onPress={() => onPress(task)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        {/* Solid fill, white glyph — the colour encodes priority at full strength. */}
        <View style={[styles.glyph, { backgroundColor: ink }]}>
          <MaterialIcons name={icon} size={20} color={colors.textOnBrand} />
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
              <Stat
                icon="folder-open"
                value={task.WorkspaceName}
                tone="textMuted"
              />
            ) : null}
            {task.ColumnTitle ? (
              <Stat icon="view-week" value={task.ColumnTitle} tone="textMuted" />
            ) : null}
          </View>
        </View>

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

      {total > 0 && !task.IsCompleted ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(pct * 100)}%`, backgroundColor: ink },
            ]}
          />
        </View>
      ) : null}

      {/* Everything here comes from columns sp_FetchTask already returns —
          none of it costs an extra request. */}
      <View style={styles.stats}>
        {total > 0 ? (
          <Stat
            icon="checklist"
            value={`${done} of ${total}`}
            tone={done === total ? "success" : "textSecondary"}
          />
        ) : null}
        {logged > 0 ? (
          <Stat
            icon="timer"
            value={
              estimated > 0
                ? `${hours(logged)} / ${hours(estimated)}`
                : hours(logged)
            }
            tone={estimated > 0 && logged > estimated ? "danger" : "textSecondary"}
          />
        ) : null}
        {subTasks > 0 ? (
          <Stat icon="account-tree" value={String(subTasks)} />
        ) : null}
        {blockers > 0 ? (
          <Stat icon="block" value={String(blockers)} tone="danger" />
        ) : null}
        {priority ? (
          <Stat icon="flag" value={priority} tone={PRIORITY_INK[priority]} />
        ) : null}

        <View style={styles.spacer} />

        {due ? (
          <Stat
            icon={overdue ? "error-outline" : "schedule"}
            value={due}
            tone={overdue ? "danger" : "textSecondary"}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/** Lists re-render on every refetch; the card only changes when the task does. */
export const TaskCard = memo(TaskCardBase);
export default TaskCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[4],
    gap: spacing[3],
    ...shadows.md,
  },
  // Scale only — no dimming. Solid surfaces stay solid.
  pressed: { transform: [{ scale: 0.985 }] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  glyph: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  main: { flex: 1, gap: spacing[1] },
  subRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  doneText: {
    textDecorationLine: "line-through",
    // Brand-coloured strike, muted text. textDecorationColor is iOS-only; on
    // Android the line takes the text colour and renders muted.
    textDecorationColor: colors.primary,
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
  track: {
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.full },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    flexWrap: "wrap",
  },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  spacer: { flex: 1 },
});
