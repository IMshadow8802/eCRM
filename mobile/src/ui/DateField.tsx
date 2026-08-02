import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { MaterialIcons } from "@expo/vector-icons";

import { colors, radius, spacing, CONTROL_HEIGHT } from "../theme";
import { Text } from "./Text";

export interface DateFieldProps {
  label?: string;
  /** ISO date string (yyyy-MM-dd) or null. Matches what the API sends. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  disabled?: boolean;
  minimumDate?: Date;
  clearable?: boolean;
}

const toISODate = (d: Date) => {
  // Local Y/M/D, NOT toISOString() — that converts to UTC and rolls the date
  // back a day for anyone east of Greenwich, which is every user here (IST).
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  placeholder = "Select a date",
  required,
  error,
  disabled,
  minimumDate,
  clearable = true,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, picked?: Date) => {
    // Android fires "dismissed" for cancel; iOS keeps the spinner mounted.
    if (Platform.OS === "android") setOpen(false);
    if (event.type === "dismissed") return;
    if (picked) onChange(toISODate(picked));
  };

  return (
    <View style={styles.container}>
      {label ? (
        <Text variant="label">
          {label}
          {required ? <Text variant="label" color="danger"> *</Text> : null}
        </Text>
      ) : null}

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        style={[
          styles.trigger,
          !!error && styles.triggerError,
          disabled && styles.triggerDisabled,
        ]}
      >
        <MaterialIcons name="event" size={18} color={colors.textMuted} />
        <Text
          variant="body"
          color={value ? "text" : "textMuted"}
          style={styles.triggerText}
        >
          {value ? format(value) : placeholder}
        </Text>
        {value && clearable ? (
          <Pressable onPress={() => onChange(null)} hitSlop={spacing[2]}>
            <MaterialIcons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </Pressable>

      {error ? <Text variant="caption" color="danger">{error}</Text> : null}

      {open ? (
        <DateTimePicker
          value={value ? new Date(`${value}T00:00:00`) : new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          minimumDate={minimumDate}
          onChange={handleChange}
        />
      ) : null}

      {open && Platform.OS === "ios" ? (
        <Pressable onPress={() => setOpen(false)} style={styles.iosDone}>
          <Text variant="button" color="primary">Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[2] },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
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
  iosDone: { alignSelf: "flex-end", padding: spacing[2] },
});

export default DateField;
