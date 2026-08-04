import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { Text } from "./Text";

export interface ChipOption<T> {
  value: T;
  label: string;
}

export interface ChipGroupProps<T> {
  value: T | null;
  options: ChipOption<T>[];
  onChange: (value: T) => void;
  /** Announced by screen readers as the name of the choice. */
  label?: string;
}

/**
 * A row of pills, one of which is selected — list filters, a direction picker,
 * an outcome picker.
 *
 * Distinct from the two neighbours it is easy to confuse with:
 *   `Segmented` switches between VIEWS of one record and always has a
 *   selection; this narrows a set and may start with none.
 *   `Select` opens a sheet, so it scales to any number of options; this shows
 *   them all at once and only works for a handful.
 *
 * Same surface rules as `Card`: no outline, lift from the page contrast, and a
 * press that sinks rather than tints.
 */
export function ChipGroup<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: ChipGroupProps<T>) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.chip,
              active ? styles.chipActive : styles.chipIdle,
              // Sinks whether or not it is the selected one — pressing the
              // active chip used to do nothing, which reads as a dead control.
              pressed && styles.chipPressed,
            ]}
          >
            <Text
              variant="label"
              color={active ? "textOnBrand" : "textSecondary"}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
  },
  chipIdle: { backgroundColor: colors.surface, ...shadows.md },
  chipActive: { backgroundColor: colors.primary, ...shadows.md },
  chipPressed: {
    transform: [{ translateY: 1 }],
    ...shadows.sm,
  },
});

export default ChipGroup;
