import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import type { Task } from "../../types/api";
import { colors, radius, spacing } from "../../theme";
import { Avatar, Card, Chip, Text } from "../../ui";
import {
  assigneesOf,
  checklistProgress,
  dueBucket,
  dueLabel,
  PRIORITY_TONE,
} from "./taskHelpers";

interface TaskCardProps {
  task: Task;
  onPress: (task: Task) => void;
  /** Hide the workspace name when the list is already scoped to one board. */
  showWorkspace?: boolean;
}

function TaskCardBase({ task, onPress, showWorkspace = true }: TaskCardProps) {
  const { done, total } = checklistProgress(task);
  const pct = total > 0 ? done / total : 0;
  const overdue = dueBucket(task.DueDate) === "overdue";
  const due = dueLabel(task.DueDate);
  const assignees = assigneesOf(task);
  const priority = task.Priority ?? null;

  return (
    <Card onPress={() => onPress(task)} style={styles.card}>
      <View style={styles.top}>
        <View style={styles.titleBlock}>
          <Text
            variant="h3"
            numberOfLines={2}
            style={task.IsCompleted ? styles.done : undefined}
          >
            {task.Title}
          </Text>
          {showWorkspace && task.WorkspaceName ? (
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {task.WorkspaceName}
            </Text>
          ) : null}
        </View>

        {task.IsCompleted ? (
          <MaterialIcons
            name="check-circle"
            size={22}
            color={colors.success}
          />
        ) : null}
      </View>

      {/* Checklist is the completion model, so the bar is the real progress —
          not a separate Progress field someone has to remember to update. */}
      {total > 0 ? (
        <View style={styles.progressRow}>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(pct * 100)}%` },
                task.IsCompleted && styles.fillDone,
              ]}
            />
          </View>
          <Text variant="caption" color="textMuted">
            {done}/{total}
          </Text>
        </View>
      ) : null}

      <View style={styles.meta}>
        {due ? (
          <Chip
            label={due}
            tone={overdue ? "danger" : "neutral"}
            icon={overdue ? "error-outline" : "event"}
          />
        ) : null}
        {priority && priority !== "medium" ? (
          <Chip label={priority} tone={PRIORITY_TONE[priority]} />
        ) : null}
        {task.IsBlocked ? (
          <Chip label="Blocked" tone="danger" icon="block" />
        ) : null}

        <View style={styles.spacer} />

        {/* Stacked, overlapping — a row of four separate avatars eats the card. */}
        <View style={styles.assignees}>
          {assignees.slice(0, 3).map((a, i) => (
            <View
              key={a.UserId}
              style={[styles.avatarSlot, i > 0 && styles.avatarOverlap]}
            >
              <Avatar name={a.FullName} uri={a.Avatar} size={24} />
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
    </Card>
  );
}

/** Lists re-render on every refetch; the card only changes when the task does. */
export const TaskCard = memo(TaskCardBase);
export default TaskCard;

const styles = StyleSheet.create({
  card: { gap: spacing[3] },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  titleBlock: { flex: 1, gap: spacing[1] },
  done: { textDecorationLine: "line-through", color: colors.textMuted },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  track: {
    flex: 1,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  fillDone: { backgroundColor: colors.success },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexWrap: "wrap",
  },
  spacer: { flex: 1 },
  assignees: { flexDirection: "row", alignItems: "center" },
  avatarSlot: {
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  avatarOverlap: { marginLeft: -spacing[2] },
  more: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },
});
