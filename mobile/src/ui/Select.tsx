import { useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ChevronDown, type LucideIcon } from "lucide-react-native";

import { colors, type BadgeTone, type ChipTone } from "../theme";
import { Avatar } from "./Avatar";
import { Chip } from "./Chip";
import { ChoiceList } from "./ChoiceList";
import { FieldHelp, FieldLabel, fieldBox } from "./Field";
import { Sheet, type SheetRef } from "./Sheet";
import { Text } from "./Text";

export interface SelectOption<T> {
  value: T;
  label: string;
  sublabel?: string;
  /** A plain leading icon in the list. */
  icon?: LucideIcon;
  /** A 36 badge leading the row in the list. */
  badge?: { tone: BadgeTone; icon: LucideIcon };
  /** Any leading node (an Avatar 36). */
  lead?: ReactNode;
  /** Chosen, the field shows this pill instead of plain text (status, priority, resolution). */
  chip?: { tone: ChipTone; icon?: LucideIcon };
  /** A person: the field shows Avatar 24 + name, the list an Avatar 36 (E §3.14, 23). */
  avatar?: { name?: string | null; uri?: string | null; userId?: number | null };
}

export interface SelectProps<T> {
  label?: string;
  placeholder?: string;
  value: T | T[] | null;
  options: SelectOption<T>[];
  onChange: (value: T | T[]) => void;
  multiple?: boolean;
  required?: boolean;
  /** An xs chip after the label ("Custom", T4). */
  labelTag?: string;
  error?: string | null;
  disabled?: boolean;
  sheetTitle?: string;
}

/**
 * The ONE picker — single and multi select (E §3.14). A field with a
 * chevron that opens the shared Sheet as a ChoiceList, so it looks identical
 * on both platforms. Single closes on a pick; multi commits every tap and
 * stays open.
 */
export function Select<T extends string | number>({
  label, placeholder = "Select…", value, options, onChange, multiple = false, required, labelTag, error, disabled, sheetTitle,
}: SelectProps<T>) {
  const sheetRef = useRef<SheetRef>(null);
  const [draft, setDraft] = useState<T[]>([]);
  const selected = useMemo(() => (Array.isArray(value) ? value : value == null ? [] : [value]), [value]);
  const chosen = options.filter((o) => selected.includes(o.value));

  const open = () => {
    if (disabled) return;
    // A sheet's autofocused remarks keep the keyboard up; the picker would open
    // under it, and the first tap on a choice only closed the keyboard.
    Keyboard.dismiss();
    setDraft(selected);
    sheetRef.current?.present();
  };

  const pick = (v: T) => {
    if (!multiple) {
      onChange(v);
      sheetRef.current?.dismiss();
      return;
    }
    const next = draft.includes(v) ? draft.filter((x) => x !== v) : [...draft, v];
    setDraft(next);
    onChange(next);
  };

  const single = chosen.length === 1 ? chosen[0]! : null;
  const summary = chosen.length > 1 ? `${chosen.length} selected` : single?.label ?? null;

  return (
    <View>
      {label ? <FieldLabel label={label} required={required} tag={labelTag} /> : null}
      <Pressable
        onPress={open}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${summary ?? placeholder}` : undefined}
        style={[fieldBox.box, !!error && fieldBox.error, disabled && fieldBox.disabled]}
      >
        <View style={styles.value}>
          {single?.chip ? (
            <Chip label={single.label} tone={single.chip.tone} icon={single.chip.icon} />
          ) : single?.avatar ? (
            <View style={styles.person}>
              <Avatar {...single.avatar} size={24} />
              <Text variant="body" numberOfLines={1} style={styles.flex}>{single.label}</Text>
            </View>
          ) : (
            <Text variant="body" color={summary ? "text" : "textMuted"} numberOfLines={1}>{summary ?? placeholder}</Text>
          )}
        </View>
        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>
      <FieldHelp error={error} />

      <Sheet ref={sheetRef} title={sheetTitle ?? label ?? "Select"} padded>
        <ScrollView testID="select-list" style={styles.list} bounces={false} keyboardShouldPersistTaps="handled">
          <ChoiceList
            value={multiple ? draft : value}
            multiple={multiple}
            onChange={pick}
            choices={options.map((o) => ({
              value: o.value,
              label: o.label,
              note: o.sublabel,
              badge: o.badge,
              lead: o.lead ?? (o.avatar ? <Avatar {...o.avatar} size={36} /> : o.icon ? <o.icon size={18} color={colors.textSecondary} /> : undefined),
            }))}
          />
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  value: { flex: 1, minWidth: 0 },
  person: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  list: { maxHeight: 380 },
});

export default Select;
