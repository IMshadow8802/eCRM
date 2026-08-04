import { Fragment } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ListChecks, Trash2 } from "lucide-react-native";

import type { TaskChecklistItem } from "../../types/api";
import { colors, radius, spacing, SCREEN_PADDING } from "../../theme";
import { Card, Checkbox, Divider, EmptyState, Text } from "../../ui";

export interface ChecklistProps {
  items: TaskChecklistItem[];
  onToggle: (item: TaskChecklistItem) => void;
  onDelete: (item: TaskChecklistItem) => void;
  /** Workspace role allows ticking items off. */
  canToggle: boolean;
  /** Workspace role allows adding and removing them. */
  canManage: boolean;
}

const BAR_HEIGHT = 6;

/**
 * The task's checklist — one card holding every item, not one card per item.
 *
 * A card means "here is a thing you can act on", and twelve of them stacked for
 * what is a single list turns a checklist into a stack of buttons — the same
 * mistake `Timeline` exists to avoid for history. The list is one object: it
 * owns the task's completion, so it gets one surface, and the items are rows
 * inside it separated by a hairline.
 *
 * **Nothing is struck through.** A line through the text is a word-processor
 * artifact: React Native has no `textDecorationThickness`, `textDecorationColor`
 * is iOS-only, and at 15px the result is a hairline that reads as damage rather
 * than as completion. The filled checkbox and the muted label already say done,
 * and they say it identically on both platforms.
 *
 * The progress bar is not decoration. Task completion is DERIVED from this list
 * (`tblTaskChecklist`; the `IsDone` column was retired), so the bar is the
 * task's actual state — which is why it replaced the sentence that used to
 * explain that in words.
 */
export function Checklist({
  items,
  onToggle,
  onDelete,
  canToggle,
  canManage,
}: ChecklistProps) {
  const total = items.length;
  const done = items.filter((i) => i.IsCompleted).length;
  const complete = total > 0 && done === total;

  if (!total) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Nothing to do yet"
        message={
          canManage
            ? "Add the steps this task needs. Ticking them all off is what marks it complete."
            : "This task has no checklist. Completion is driven by that list."
        }
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Unpadded: the rows pad themselves, so a divider can run the full width
          of the card instead of stopping short at a gutter. */}
      <Card padded={false} gap={0}>
        <View style={styles.progress}>
          <View style={styles.progressText}>
            <Text variant="label" color={complete ? "success" : "textSecondary"}>
              {done} of {total} done
            </Text>
            <Text variant="label" color={complete ? "success" : "textSecondary"}>
              {Math.round((done / total) * 100)}%
            </Text>
          </View>
          {/* Track and fill are siblings, not parent/child with overflow —
              clipping a rounded fill inside a rounded track needs
              `overflow: hidden`, which on iOS would take the card's shadow with
              it. The fill just rounds its own corners. */}
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${(done / total) * 100}%` },
                complete && styles.fillComplete,
              ]}
            />
          </View>
        </View>

        {items.map((item) => (
          // A divider above every row, none below the last — a line sitting on
          // the card's rounded bottom edge reads as a crack in it.
          <Fragment key={item.Id}>
            <Divider />
            <View style={styles.row}>
              <Checkbox
                checked={item.IsCompleted}
                accessibilityLabel={item.ItemText}
                onPress={canToggle ? () => onToggle(item) : undefined}
              />
              {/* The whole label is the target too — a 22px box is a mean
                  thing to ask someone to hit on a moving train. */}
              <Pressable
                style={styles.label}
                disabled={!canToggle}
                onPress={() => onToggle(item)}
              >
                <Text
                  variant="body"
                  color={item.IsCompleted ? "textMuted" : "text"}
                  style={item.IsCompleted ? styles.struck : undefined}
                >
                  {item.ItemText}
                </Text>
              </Pressable>
              {canManage ? (
                <Pressable
                  hitSlop={spacing[2]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.ItemText}`}
                  onPress={() => onDelete(item)}
                  style={({ pressed }) => [
                    styles.remove,
                    pressed && styles.removePressed,
                  ]}
                >
                  {/* A bin, because it destroys the item — a cross would mean
                      dismiss. Muted at rest and red only under the finger: one
                      red glyph per row down a list of twelve is the loudest
                      thing on screen for the least-used action on it. */}
                  <Trash2 size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </Fragment>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: SCREEN_PADDING,
    // Clears the FAB so the last row is never hidden behind it.
    paddingBottom: spacing[20],
  },
  progress: { padding: spacing[4], gap: spacing[2] },
  progressText: { flexDirection: "row", justifyContent: "space-between" },
  track: {
    height: BAR_HEIGHT,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  fillComplete: { backgroundColor: colors.success },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  label: { flex: 1 },
  /**
   * A struck item, and ONLY here.
   *
   * A checklist is the one place the line is literally what the gesture means —
   * you tick a thing off and cross it out. On a task card the same line reads as
   * damage to a title you still have to read, which is why the completed card
   * mutes its title instead.
   *
   * No `textDecorationColor`: it is iOS-only, so setting it would give the two
   * platforms different-coloured lines. Left to inherit, the line comes through
   * muted alongside the text on both.
   */
  struck: { textDecorationLine: "line-through" },
  remove: {
    width: spacing[7],
    height: spacing[7],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  removePressed: { backgroundColor: colors.dangerSoft },
});

export default Checklist;
