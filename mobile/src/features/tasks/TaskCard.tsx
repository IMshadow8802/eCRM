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
  task: "check-circle-outline",
  bug: "bug-report",
  feature: "auto-awesome",
  improvement: "trending-up",
  research: "search",
};

const PRIORITY_INK: Record<TaskPriority, keyof typeof colors> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

const PRIORITY_WASH: Record<TaskPriority, keyof typeof colors> = {
  low: "priorityLowSoft",
  medium: "priorityMediumSoft",
  high: "priorityHighSoft",
  urgent: "priorityUrgentSoft",
};

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
  const wash = task.IsCompleted
    ? colors.successSoft
    : priority
      ? colors[PRIORITY_WASH[priority]]
      : colors.neutralSoft;

  const icon = task.IsCompleted
    ? "check-circle"
    : (TYPE_ICON[task.Type ?? "task"] ?? TYPE_ICON.task!);

  return (
    <Pressable
      onPress={() => onPress(task)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {/* Priority stripe down the edge — colour reads before any text does. */}
      <View style={[styles.stripe, { backgroundColor: ink }]} />

      <View style={styles.body}>
        <View style={styles.top}>
          <View style={[styles.iconTile, { backgroundColor: wash }]}>
            <MaterialIcons name={icon} size={20} color={ink} />
          </View>

          <View style={styles.titleBlock}>
            <Text
              variant="h3"
              numberOfLines={2}
              style={task.IsCompleted ? styles.doneText : undefined}
            >
              {task.Title}
            </Text>
            {showWorkspace && task.WorkspaceName ? (
              <View style={styles.workspace}>
                <MaterialIcons
                  name="folder-open"
                  size={12}
                  color={colors.textMuted}
                />
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {task.WorkspaceName}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Checklist is the completion model, so this bar is real progress —
            not a Progress field somebody has to remember to update. */}
        {total > 0 ? (
          <View style={styles.progressRow}>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.round(pct * 100)}%`, backgroundColor: ink },
                ]}
              />
            </View>
            <Text variant="caption" color="textSecondary">
              {done}/{total}
            </Text>
          </View>
        ) : null}

        <View style={styles.meta}>
          {due ? (
            <View
              style={[
                styles.pill,
                { backgroundColor: overdue ? colors.dangerSoft : colors.surfaceSunken },
              ]}
            >
              <MaterialIcons
                name={overdue ? "error-outline" : "schedule"}
                size={13}
                color={overdue ? colors.danger : colors.textSecondary}
              />
              <Text
                variant="caption"
                color={overdue ? "danger" : "textSecondary"}
              >
                {due}
              </Text>
            </View>
          ) : null}

          {task.IsBlocked ? (
            <View style={[styles.pill, { backgroundColor: colors.dangerSoft }]}>
              <MaterialIcons name="block" size={13} color={colors.danger} />
              <Text variant="caption" color="danger">
                Blocked
              </Text>
            </View>
          ) : null}

          <View style={styles.spacer} />

          {/* Stacked and overlapping — four separate avatars would eat the row. */}
          <View style={styles.assignees}>
            {assignees.slice(0, 3).map((a, i) => (
              <View
                key={a.UserId}
                style={[styles.avatarSlot, i > 0 && styles.avatarOverlap]}
              >
                <Avatar name={a.FullName} uri={a.Avatar} size={26} />
              </View>
            ))}
            {assignees.length > 3 ? (
              <View style={[styles.avatarSlot, styles.avatarOverlap, styles.more]}>
                <Text variant="caption" color="textSecondary">
                  +{assignees.length - 3}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Lists re-render on every refetch; the card only changes when the task does. */
export const TaskCard = memo(TaskCardBase);
export default TaskCard;

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.md,
  },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
  stripe: { width: 4 },
  body: { flex: 1, padding: spacing[4], gap: spacing[3] },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: { flex: 1, gap: spacing[1] },
  doneText: { textDecorationLine: "line-through", color: colors.textMuted },
  workspace: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  track: {
    flex: 1,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.full },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexWrap: "wrap",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
  },
  spacer: { flex: 1 },
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
});
