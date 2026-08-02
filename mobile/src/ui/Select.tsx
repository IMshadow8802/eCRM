import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Check, ChevronDown,
  type LucideIcon,
} from "lucide-react-native";

import { colors, radius, spacing, CONTROL_HEIGHT, HIT_TARGET } from "../theme";
import { Sheet, type SheetRef } from "./Sheet";
import { Text } from "./Text";

export interface SelectOption<T> {
  value: T;
  label: string;
  sublabel?: string;
  icon?: LucideIcon;
}

export interface SelectProps<T> {
  label?: string;
  placeholder?: string;
  value: T | T[] | null;
  options: SelectOption<T>[];
  onChange: (value: T | T[]) => void;
  multiple?: boolean;
  required?: boolean;
  error?: string | null;
  disabled?: boolean;
  sheetTitle?: string;
}

/**
 * The ONE picker — single and multi select. Opens the shared Sheet rather than
 * a platform picker, so it looks identical on both platforms and can show a
 * sublabel (used for "who is this person" in assignee lists).
 */
export function Select<T extends string | number>({
  label,
  placeholder = "Select…",
  value,
  options,
  onChange,
  multiple = false,
  required,
  error,
  disabled,
  sheetTitle,
}: SelectProps<T>) {
  const sheetRef = useRef<SheetRef>(null);
  const [draft, setDraft] = useState<T[]>([]);

  const selected = useMemo(
    () => (Array.isArray(value) ? value : value == null ? [] : [value]),
    [value],
  );

  const summary = useMemo(() => {
    const chosen = options.filter((o) => selected.includes(o.value));
    if (!chosen.length) return null;
    if (chosen.length === 1) return chosen[0]!.label;
    return `${chosen.length} selected`;
  }, [options, selected]);

  const open = () => {
    if (disabled) return;
    setDraft(selected);
    sheetRef.current?.present();
  };

  const pick = (option: SelectOption<T>) => {
    if (!multiple) {
      onChange(option.value);
      sheetRef.current?.dismiss();
      return;
    }
    // Multi-select edits a draft and commits on every tap, so the list stays
    // open for the next choice while the parent still sees each change.
    const next = draft.includes(option.value)
      ? draft.filter((v) => v !== option.value)
      : [...draft, option.value];
    setDraft(next);
    onChange(next);
  };

  const isChecked = (v: T) => (multiple ? draft.includes(v) : selected.includes(v));

  return (
    <View style={styles.container}>
      {label ? (
        <Text variant="label">
          {label}
          {required ? <Text variant="label" color="danger"> *</Text> : null}
        </Text>
      ) : null}

      <Pressable
        onPress={open}
        disabled={disabled}
        style={[
          styles.trigger,
          !!error && styles.triggerError,
          disabled && styles.triggerDisabled,
        ]}
      >
        <Text
          variant="body"
          color={summary ? "text" : "textMuted"}
          numberOfLines={1}
          style={styles.triggerText}
        >
          {summary ?? placeholder}
        </Text>
        <ChevronDown size={20} color={colors.textSecondary} />
      </Pressable>

      {error ? <Text variant="caption" color="danger">{error}</Text> : null}

      <Sheet ref={sheetRef} title={sheetTitle ?? label ?? "Select"}>
        <ScrollView style={styles.list} bounces={false}>
          {options.map((option) => {
            const checked = isChecked(option.value);
            return (
              <Pressable
                key={String(option.value)}
                style={styles.option}
                onPress={() => pick(option)}
              >
                {option.icon ? (
                  <option.icon size={18} color={colors.textSecondary} />
                ) : null}
                <View style={styles.optionText}>
                  <Text variant="body">{option.label}</Text>
                  {option.sublabel ? (
                    <Text variant="caption">{option.sublabel}</Text>
                  ) : null}
                </View>
                {checked ? (
                  <Check size={20} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
          {!options.length ? (
            <Text variant="secondary" style={styles.empty}>
              Nothing to choose from.
            </Text>
          ) : null}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[2] },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    height: CONTROL_HEIGHT,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.surface,
  },
  triggerError: { borderColor: colors.danger },
  triggerDisabled: { backgroundColor: colors.disabledBg },
  triggerText: { flex: 1 },
  list: { maxHeight: 380 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: HIT_TARGET + spacing[1],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  optionText: { flex: 1 },
  empty: { padding: spacing[4] },
});

export default Select;
