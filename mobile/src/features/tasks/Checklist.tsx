import { Pressable, StyleSheet, View } from "react-native";
import { Plus } from "lucide-react-native";

import { colors, metrics, spacing } from "../../theme";
import type { TaskChecklistItem } from "../../types/api";
import { Card, Checkbox, EmptyState, ListGroup, ProgressBar, Text } from "../../ui";

export interface ChecklistProps {
  items: TaskChecklistItem[];
  onToggle: (item: TaskChecklistItem) => void;
  /** Long-press a step: its actions (Remove step). Steps are not reordered on mobile. */
  onLongPress?: (item: TaskChecklistItem) => void;
  /** "Add a step" — the last row. */
  onAdd: () => void;
  /** Workspace role allows ticking items off. */
  canToggle: boolean;
  /** Workspace role allows adding, ordering and removing them. */
  canManage: boolean;
}

/**
 * The task's steps (E 08): a summary card ("3 of 5 steps done", the bar, and
 * why it matters), then one group of rows — done rows struck through and
 * muted — ending in "Add a step". No grip: saveTaskChecklist has no reorder
 * semantics, so steps keep the server's order. Completion is derived
 * from this list (the IsDone column is retired). Step meta (who ticked it,
 * when) is not on the API (G7), so a row is its text alone.
 */
export function Checklist({ items, onToggle, onLongPress, onAdd, canToggle, canManage }: ChecklistProps) {
  const total = items.length;
  const done = items.filter((i) => i.IsCompleted).length;

  if (!total) {
    return (
      <EmptyState
        module="tasks"
        title="Nothing to do yet"
        message={
          canManage
            ? "Add the steps this task needs. Ticking them all off is what marks it complete."
            : "This task has no checklist. Completion is driven by that list."
        }
        actionLabel={canManage ? "Add a step" : undefined}
        onAction={canManage ? onAdd : undefined}
      />
    );
  }

  return (
    <View>
      <Card gap={0} style={styles.summary}>
        <View style={styles.line}>
          <Text variant="h1" tabular>{`${done} of ${total}`}</Text>
          <Text variant="meta" style={styles.flex}>steps done</Text>
          <Text variant="metaStrong" color="primary" tabular>{`${Math.round((done / total) * 100)}%`}</Text>
        </View>
        <View style={styles.bar}>
          <ProgressBar value={done / total} size="lg" />
        </View>
        <Text variant="small" style={styles.why}>The task completes itself when every step is ticked.</Text>
      </Card>

      <ListGroup style={styles.group} testID="checklist">
        {items.map((item, i) => (
          <Pressable
            key={item.Id}
            disabled={!canToggle && !(canManage && onLongPress)}
            onPress={canToggle ? () => onToggle(item) : undefined}
            onLongPress={canManage && onLongPress ? () => onLongPress(item) : undefined}
            delayLongPress={300}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.IsCompleted, disabled: !canToggle }}
            accessibilityLabel={item.ItemText}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            {i > 0 ? <View style={styles.separator} /> : null}
            {/* Presentational: the whole row is the 44 dp target. */}
            <Checkbox checked={item.IsCompleted} />
            <Text
              variant={item.IsCompleted ? "text" : "rowTitle"}
              color={item.IsCompleted ? "textMuted" : "text"}
              style={[styles.flex, item.IsCompleted && styles.struck]}
            >
              {item.ItemText}
            </Text>
          </Pressable>
        ))}
        {canManage ? (
          <Pressable
            onPress={onAdd}
            accessibilityRole="button"
            accessibilityLabel="Add a step"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.separator} />
            <Plus size={22} color={colors.primary} />
            <Text variant="rowTitle" color="primary">Add a step</Text>
          </Pressable>
        ) : null}
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { padding: metrics.rowPadH },
  line: { flexDirection: "row", alignItems: "baseline", gap: metrics.inlineGap },
  flex: { flex: 1, minWidth: 0 },
  // ponytail: E's 10 has no spacing step; pairGap is the 10 in the scale.
  bar: { marginTop: metrics.pairGap },
  why: { marginTop: spacing[2] },
  group: { marginTop: spacing[3] },
  row: {
    flexDirection: "row",
    // A wrapping step starts at the top, beside its box.
    alignItems: "flex-start",
    gap: metrics.rowGap,
    paddingVertical: metrics.rowPadV,
    paddingHorizontal: metrics.rowPadH,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.fieldTint },
  separator: { position: "absolute", top: 0, right: 0, left: metrics.sepInset.check, height: 1, backgroundColor: colors.divider },
  struck: { textDecorationLine: "line-through" },
});
