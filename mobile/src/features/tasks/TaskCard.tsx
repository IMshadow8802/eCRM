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
    ? "check"
    : (TYPE_ICON[task.Type ?? "task"] ?? TYPE_ICON.task!);

  // One quiet line instead of a row of boxes. Chips everywhere is what makes a
  // card look busy; muted text with a leading glyph carries the same
  // information and lets the title stay the loudest thing on the card.
  const metaParts: string[] = [];
  if (showWorkspace && task.WorkspaceName) metaParts.push(task.WorkspaceName);
  if (total > 0) metaParts.push(`${done} of ${total}`);

  return (
    <Pressable
      onPress={() => onPress(task)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <View style={[styles.glyph, { backgroundColor: wash }]}>
          <MaterialIcons name={icon} size={20} color={ink} />
        </View>

        <View style={styles.main}>
          <Text
            variant="h3"
            numberOfLines={2}
            style={task.IsCompleted ? styles.doneText : undefined}
          >
            {task.Title}
          </Text>

          {metaParts.length ? (
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {metaParts.join("  ·  ")}
            </Text>
          ) : null}
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

      {/* Hairline progress, flush to the card's lower edge — reads as a state
          indicator rather than as another widget competing for attention. */}
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

      {due || task.IsBlocked ? (
        <View style={styles.footer}>
          {due ? (
            <View style={styles.footerItem}>
              <MaterialIcons
                name={overdue ? "error-outline" : "schedule"}
                size={13}
                color={overdue ? colors.danger : colors.textMuted}
              />
              <Text
                variant="caption"
                color={overdue ? "danger" : "textMuted"}
              >
                {due}
              </Text>
            </View>
          ) : null}
          {task.IsBlocked ? (
            <View style={styles.footerItem}>
              <MaterialIcons name="block" size={13} color={colors.danger} />
              <Text variant="caption" color="danger">
                Blocked
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
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
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.96 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  glyph: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  main: { flex: 1, gap: spacing[1] },
  doneText: { textDecorationLine: "line-through", color: colors.textMuted },
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
  footer: { flexDirection: "row", alignItems: "center", gap: spacing[4] },
  footerItem: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
});
