import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, metrics, priorityChip, taskStage, taskStageBadge } from "../../theme";
import type { Task } from "../../types/api";
import { AvatarStack, Chip, ProgressBar, StatusBadge, Text } from "../../ui";
import { assigneesOf, checklistProgress, taskDueChip } from "./taskHelpers";

export interface TaskRowProps {
  task: Task;
  onPress: (task: Task) => void;
  /** G9: the task's workspace is personal (joined from the cached workspaces). */
  personal?: boolean;
  /** The first row of a group draws no separator. */
  first?: boolean;
}

const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

/**
 * A task in a list (E 05): stage badge (G8) · title + priority · "Workspace ·
 * Column" + "x of y" + a 40 bar · due/TAT/personal chip + assignees. A row in
 * a ListGroup, not a card per task. ListRow cannot hold the bar or a chip on
 * the title line, so the row is laid out here on the same metrics.
 */
function TaskRowBase({ task, onPress, personal = false, first = false }: TaskRowProps) {
  const stage = taskStageBadge(taskStage(task));
  const { done, total } = checklistProgress(task);
  const due = taskDueChip(task, personal);
  const people = assigneesOf(task).map((a) => ({ name: a.FullName, uri: a.Avatar, userId: a.UserId }));
  const meta = [task.WorkspaceName, task.ColumnTitle].filter(Boolean).join(" · ");

  return (
    <Pressable
      onPress={() => onPress(task)}
      accessibilityRole="button"
      accessibilityLabel={`${task.Title}, ${stage.label}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {first ? null : <View testID="row-separator" style={styles.separator} />}
      <StatusBadge tone={stage.tone} icon={stage.icon} testID={`stage-${taskStage(task)}`} />
      <View style={styles.content}>
        <View style={styles.line}>
          <Text variant="rowTitle" numberOfLines={1} style={styles.flex}>{task.Title}</Text>
          {task.Priority ? <Chip label={PRIORITY_LABEL[task.Priority] ?? task.Priority} {...priorityChip(task.Priority)} /> : null}
        </View>
        <View style={[styles.line, styles.gap]}>
          <Text variant="meta" numberOfLines={1} style={styles.flex}>{meta}</Text>
          {total > 0 ? (
            <>
              <Text variant="label" tabular color="text">{`${done} of ${total}`}</Text>
              <ProgressBar value={done / total} width={metrics.progress.rowWidth} />
            </>
          ) : null}
        </View>
        {due || people.length ? (
          <View style={[styles.line, styles.line3]}>
            {due ? <Chip label={due.label} tone={due.tone} icon={due.icon} /> : null}
            <View style={styles.flex} />
            {people.length ? <AvatarStack people={people} size={24} /> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export const TaskRow = memo(TaskRowBase);
export default TaskRow;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: metrics.rowGap,
    padding: 12,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.fieldTint },
  separator: { position: "absolute", top: 0, right: 0, left: metrics.sepInset.badge, height: 1, backgroundColor: colors.divider },
  content: { flex: 1, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap, minWidth: 0 },
  gap: { marginTop: metrics.rowLineGap },
  line3: { marginTop: 6 },
  flex: { flex: 1, minWidth: 0 },
});
