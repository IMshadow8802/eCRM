import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Minus, Plus, type LucideIcon } from "lucide-react-native";

import { colors, HIT_TARGET, metrics, radius, spacing, type BadgeTone } from "../theme";
import { Chip, type ChipProps } from "./Chip";
import { StatusBadge } from "./StatusBadge";
import { Text } from "./Text";

/** A 22 ring; on = a 7 px primary ring (E `.radio`). */
export function Radio({ on }: { on: boolean }) {
  return <View testID={on ? "radio-on" : "radio-off"} style={[styles.radio, on ? styles.radioOn : styles.radioOff]} />;
}

export interface Choice<T> {
  value: T;
  label: string;
  /** A 36 badge leading the row. */
  badge?: { tone: BadgeTone; icon: LucideIcon };
  /** Or any node (an Avatar 36 in the transfer list). */
  lead?: ReactNode;
  /** A `small` muted line under the label, or beside it. */
  note?: string;
  /** "Current" (lilac) and the like. */
  chip?: ChipProps;
  /** A destructive choice (Lost): selected row and label in the danger tint. */
  danger?: boolean;
  disabled?: boolean;
}

export interface ChoiceListProps<T> {
  value: T | T[] | null;
  choices: Choice<T>[];
  onChange: (v: T) => void;
  /** Ticks instead of radios: several may be on. */
  multiple?: boolean;
  emptyMessage?: string;
}

/**
 * The rows of a picking sheet (E 23, 25): no separators, a 36 badge, a
 * `bodyStrong` label, optional chip/note, then the radio. The selected row is
 * field-tinted (a destructive one danger-tinted), radius 14.
 */
export function ChoiceList<T extends string | number>({ value, choices, onChange, multiple = false, emptyMessage }: ChoiceListProps<T>) {
  const picked = Array.isArray(value) ? value : value == null ? [] : [value];
  if (!choices.length) {
    return <Text variant="meta" style={styles.empty}>{emptyMessage ?? "Nothing to choose from."}</Text>;
  }
  return (
    <View accessibilityRole={multiple ? undefined : "radiogroup"}>
      {choices.map((c) => {
        const on = picked.includes(c.value);
        return (
          <Pressable
            key={String(c.value)}
            onPress={() => onChange(c.value)}
            disabled={c.disabled}
            accessibilityRole={multiple ? "checkbox" : "radio"}
            accessibilityState={{ checked: on, selected: on, disabled: !!c.disabled }}
            accessibilityLabel={c.label}
            style={({ pressed }) => [
              styles.row,
              on && (c.danger ? styles.onDanger : styles.on),
              pressed && !on && styles.pressed,
              c.disabled && styles.disabled,
            ]}
          >
            {c.badge ? <StatusBadge size={36} tone={c.badge.tone} icon={c.badge.icon} /> : c.lead}
            <View style={styles.flex}>
              <Text variant="bodyStrong" color={on && c.danger ? "dangerText" : "text"} numberOfLines={1}>{c.label}</Text>
              {c.note ? <Text variant="small" numberOfLines={1}>{c.note}</Text> : null}
            </View>
            {c.chip ? <Chip {...c.chip} /> : null}
            <Radio on={on} />
          </Pressable>
        );
      })}
    </View>
  );
}

export interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** "4 min" */
  format?: (v: number) => string;
  /** Names the value for screen readers ("Duration"). */
  label: string;
}

/** − value + on a field-tinted pill (E 24). */
export function Stepper({ value, onChange, min = 0, max = 999, format = String, label }: StepperProps) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  return (
    <View style={styles.stepper} accessibilityLabel={`${label} ${format(value)}`}>
      <Pressable
        onPress={() => step(-1)}
        disabled={value <= min}
        hitSlop={(HIT_TARGET - 36) / 2}
        accessibilityRole="button"
        accessibilityLabel={`Less ${label.toLowerCase()}`}
        style={styles.stepButton}
      >
        <Minus size={18} color={colors.textSecondary} />
      </Pressable>
      <Text variant="stepper" align="center" style={styles.stepValue}>{format(value)}</Text>
      <Pressable
        onPress={() => step(1)}
        disabled={value >= max}
        hitSlop={(HIT_TARGET - 36) / 2}
        accessibilityRole="button"
        accessibilityLabel={`More ${label.toLowerCase()}`}
        style={styles.stepButton}
      >
        <Plus size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  radio: { width: metrics.radio, height: metrics.radio, borderRadius: metrics.radio / 2 },
  radioOff: { borderWidth: 2, borderColor: colors.borderStrong },
  radioOn: { borderWidth: metrics.radioOn, borderColor: colors.primary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: HIT_TARGET, paddingVertical: 7, paddingHorizontal: spacing[1], borderRadius: radius.badgeLg },
  on: { backgroundColor: colors.fieldTint },
  onDanger: { backgroundColor: colors.dangerRowTint },
  pressed: { backgroundColor: colors.fieldTint },
  disabled: { backgroundColor: colors.disabledBg },
  flex: { flex: 1, minWidth: 0 },
  empty: { padding: spacing[4] },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing[1],
    height: HIT_TARGET,
    paddingHorizontal: spacing[1],
    borderRadius: 22,
    backgroundColor: colors.fieldTint,
  },
  stepButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  stepValue: { width: metrics.stepperValue },
});
