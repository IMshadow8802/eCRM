import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from "@react-native-community/datetimepicker";
import { Calendar, Clock, X } from "lucide-react-native";

import { colors, spacing } from "../theme";
import { FieldHelp, FieldLabel, fieldBox } from "./Field";
import { Text } from "./Text";

export interface DateFieldProps {
  label?: string;
  /** ISO date (yyyy-MM-dd), or "HH:mm" with mode="time", or null. Matches what the API sends. */
  value: string | null;
  /** A day (default) or a time of day; both use the same native picker. */
  mode?: "date" | "time";
  onChange: (value: string | null) => void;
  placeholder?: string;
  required?: boolean;
  /** An xs chip after the label ("Custom", T4). */
  labelTag?: string;
  error?: string | null;
  disabled?: boolean;
  minimumDate?: Date;
  clearable?: boolean;
}

export const toISODate = (d: Date) => {
  // Local Y/M/D, NOT toISOString() — that converts to UTC and rolls the date
  // back a day for anyone east of Greenwich, which is every user here (IST).
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const toHHMM = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** The picker's starting Date for a stored "HH:mm": today at that time. */
const timeToDate = (hhmm: string | null) => {
  const d = new Date();
  const [h, m] = (hhmm ?? "").split(":").map(Number);
  if (Number.isFinite(h) && Number.isFinite(m)) d.setHours(h!, m!, 0, 0);
  return d;
};

const format = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

/** The ONE date picker. Handles the iOS/Android modal difference internally. */
export function DateField({
  label,
  value,
  onChange,
  mode = "date",
  placeholder = mode === "time" ? "Select a time" : "Select a date",
  required,
  labelTag,
  error,
  disabled,
  minimumDate,
  clearable = true,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);

  // datetimepicker 9.1 split the deprecated `onChange` into a pick and a
  // dismiss. Android's dialog closes itself either way; iOS keeps the inline
  // calendar mounted until Done.
  const handlePick = (_event: DateTimePickerChangeEvent, picked: Date) => {
    if (Platform.OS === "android") setOpen(false);
    onChange(mode === "time" ? toHHMM(picked) : toISODate(picked));
  };

  return (
    <View>
      {label ? <FieldLabel label={label} required={required} tag={labelTag} /> : null}

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        style={[fieldBox.box, !!error && fieldBox.error, disabled && fieldBox.disabled]}
      >
        {mode === "time" ? (
          <Clock size={18} color={colors.textMuted} />
        ) : (
          <Calendar size={18} color={colors.textMuted} />
        )}
        <Text
          variant="body"
          color={value ? "text" : "textMuted"}
          style={styles.triggerText}
        >
          {value ? (mode === "time" ? value : format(value)) : placeholder}
        </Text>
        {value && clearable ? (
          <Pressable
            onPress={() => onChange(null)}
            hitSlop={spacing[2]}
            accessibilityRole="button"
            accessibilityLabel={mode === "time" ? "Clear time" : "Clear date"}
          >
            <X size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </Pressable>

      <FieldHelp error={error} />

      {open ? (
        <DateTimePicker
          value={
            mode === "time"
              ? timeToDate(value)
              : value
                ? new Date(`${value}T00:00:00`)
                : new Date()
          }
          mode={mode}
          // iOS has no inline clock; the wheel is its time picker.
          display={Platform.OS === "ios" ? (mode === "time" ? "spinner" : "inline") : "default"}
          minimumDate={minimumDate}
          onValueChange={handlePick}
          onDismiss={() => setOpen(false)}
        />
      ) : null}

      {open && Platform.OS === "ios" ? (
        <Pressable onPress={() => setOpen(false)} style={styles.iosDone}>
          <Text variant="bodyStrong" color="primary">Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  triggerText: { flex: 1 },
  iosDone: { alignSelf: "flex-end", padding: spacing[2] },
});
