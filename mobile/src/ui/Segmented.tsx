import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { Text } from "./Text";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rendered as a small pill after the label — counts, unread badges. */
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
 * Stacking those as separate cards down one long page means the last section is
 * unreachable once the keyboard is up. Segments keep every section one tap away
 * and the composer pinned in view.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <View style={styles.bar}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text
              variant="label"
              color={active ? "text" : "textMuted"}
              numberOfLines={1}
            >
              {option.label}
            </Text>
            {option.count ? (
              <View style={[styles.count, active && styles.countActive]}>
                <Text
                  variant="caption"
                  color={active ? "textOnBrand" : "textMuted"}
                >
                  {option.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    padding: spacing[1],
    gap: spacing[1],
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    paddingVertical: spacing[2],
    borderRadius: radius.base,
  },
  segmentActive: { backgroundColor: colors.surface },
  count: {
    minWidth: 18,
    paddingHorizontal: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
  },
  countActive: { backgroundColor: colors.primary },
});

export default Segmented;
