import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { ListChecks } from "lucide-react-native";

import { colors, metrics, priorityChip } from "../../theme";
import type { Task } from "../../types/api";
import { AvatarStack, Card, Chip, Text } from "../../ui";
import { assigneesOf, checklistProgress, taskDueChip } from "./taskHelpers";

export interface TaskCardProps {
  task: Task;
  onPress: (task: Task) => void;
  /** "Move to…" — there is no drag between columns on a phone. */
  onLongPress?: (task: Task) => void;
}

const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

/**
 * A card on a board column (E 07): title, then priority chip (no icon) · due
 * chip · steps "0/3" · assignees. Cards on a board carry no shadow (Card reads
 * the board surface). A board is never personal, so no "Personal" chip here.
 */
function TaskCardBase({ task, onPress, onLongPress }: TaskCardProps) {
  const { done, total } = checklistProgress(task);
  const due = taskDueChip(task, false);
  const people = assigneesOf(task).map((a) => ({ name: a.FullName, uri: a.Avatar, userId: a.UserId }));
  return (
    <Card
      onPress={() => onPress(task)}
      onLongPress={onLongPress ? () => onLongPress(task) : undefined}
      gap={0}
      style={styles.card}
      testID={`task-card-${task.Id}`}
    >
      <Text variant="rowTitle" numberOfLines={2}>{task.Title}</Text>
      <View style={styles.meta}>
        {task.Priority ? (
          <Chip label={PRIORITY_LABEL[task.Priority] ?? task.Priority} tone={priorityChip(task.Priority).tone} />
        ) : null}
        {due ? <Chip label={due.label} tone={due.tone} icon={due.icon} /> : null}
        <View style={styles.flex} />
        {total > 0 ? (
          <View style={styles.steps} accessibilityLabel={`${done} of ${total} steps`}>
            <ListChecks size={14} color={colors.textSecondary} />
            <Text variant="label" tabular>{`${done}/${total}`}</Text>
          </View>
        ) : null}
        {people.length ? <AvatarStack people={people} size={24} max={2} /> : null}
      </View>
    </Card>
  );
}

export const TaskCard = memo(TaskCardBase);
export default TaskCard;

const styles = StyleSheet.create({
  card: { padding: 12, marginBottom: 8 },
  meta: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap, marginTop: 8 },
  steps: { flexDirection: "row", alignItems: "center", gap: 4 },
  flex: { flex: 1 },
});
