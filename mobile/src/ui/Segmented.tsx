import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { Text } from "./Text";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /**
   * Rendered as a small pill after the label. Displayed as "99+" past 99 —
   * a raw 4-digit count would grow the badge and squeeze the label out.
   */
  count?: number;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/**
 * Tab strip for switching between sections of the SAME record — checklist,
 * files, comments on one task.
 *
 * Every segment is its own pill. An earlier version drew a sunken grey track
 * and left the inactive segments unfilled, so they disappeared into it and only
 * the selected one looked like a control — the other two read as background.
 *
 * Stacking these sections as separate cards down one page instead would put the
 * last one out of reach once the keyboard is up.
 *
 * Up to three segments split the width evenly. Past that they take their
 * natural width and the strip scrolls — four equal segments on a 360px screen
 * leaves no room for a label plus its badge, so they truncate instead.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const scrolls = options.length > 3;

  const segments = options.map((option) => {
    const active = option.value === value;
    return (
      <Pressable
        key={option.value}
        onPress={() => onChange(option.value)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          styles.segment,
          scrolls ? styles.segmentAuto : styles.segmentEven,
          active ? styles.segmentActive : styles.segmentIdle,
          pressed && !active && styles.segmentPressed,
        ]}
      >
        <Text
          variant="label"
          color={active ? "textOnBrand" : "textSecondary"}
          numberOfLines={1}
          style={styles.label}
        >
          {option.label}
        </Text>
        {option.count ? (
          <View
            style={[styles.count, active ? styles.countActive : styles.countIdle]}
          >
            <Text
              variant="caption"
              color={active ? "primary" : "textSecondary"}
              numberOfLines={1}
            >
              {option.count > 99 ? "99+" : option.count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  });

  if (!scrolls) return <View style={styles.bar}>{segments}</View>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.bar}
    >
      {segments}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", gap: spacing[2] },
  // Lets a long label shrink rather than push the badge past the border.
  label: { flexShrink: 1 },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    paddingVertical: spacing[3],
    // Tight, because the longest label ("Comments") plus a badge has to fit an
    // equal third of a 360px screen without touching the border.
    paddingHorizontal: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  segmentEven: { flex: 1 },
  // Scrolling strip: natural width, but wide enough that a one-word label is
  // still a comfortable target rather than a thin sliver.
  segmentAuto: { minWidth: 96, paddingHorizontal: spacing[3] },
  // Inactive segments are surfaces in their own right, so all three read as
  // controls rather than only the selected one.
  segmentIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    ...shadows.sm,
  },
  segmentPressed: { backgroundColor: colors.surfacePressed },
  segmentActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadows.md,
  },
  count: {
    minWidth: 20,
    paddingHorizontal: spacing[1],
    paddingVertical: 1,
    borderRadius: radius.full,
    alignItems: "center",
    flexShrink: 0,
  },
  countIdle: { backgroundColor: colors.surfaceSunken },
  countActive: { backgroundColor: colors.surface },
});

export default Segmented;
