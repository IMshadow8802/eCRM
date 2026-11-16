import { useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, View } from "react-native";
import { Calendar, Clock, X } from "lucide-react-native";

import { colors, spacing } from "../theme";
import { CalendarSheet } from "./CalendarSheet";
import { FieldHelp, FieldLabel, fieldBox } from "./Field";
import { Sheet, type SheetRef } from "./Sheet";
import { Text } from "./Text";
import { slotLabel, TimeSheet } from "./TimeSheet";

export { toISODate } from "./CalendarSheet";

export interface DateFieldProps {
  label?: string;
  /** ISO date (yyyy-MM-dd), or "HH:mm" with mode="time", or null. Matches what the API sends. */
  value: string | null;
  /** A day (default) or a time of day; each opens its in-app sheet. */
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
  /** Time mode: the day the time is on (yyyy-MM-dd); when it is today, past times are off. */
  day?: string | null;
  /** The clock the pickers read (today's ring, past slots). Defaults to now. */
  now?: Date;
}

const format = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

/**
 * The ONE date / time picker. Both modes open the shared Sheet with our own
 * calendar or time slots, so it looks the same on iOS and Android (the native
 * dialogs did not match the app). A pick sends the value and closes the sheet.
 */
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
  day,
  now,
}: DateFieldProps) {
  const sheetRef = useRef<SheetRef>(null);
  // The picker mounts on open and unmounts once the sheet has closed, so it
  // starts on the current value (and month) every time.
  const [open, setOpen] = useState(false);
  const show = () => {
    // A focused text field keeps the keyboard up over the sheet (see Select).
    Keyboard.dismiss();
    setOpen(true);
    sheetRef.current?.present();
  };
  const pick = (v: string | null) => {
    onChange(v);
    sheetRef.current?.dismiss();
  };

  return (
    <View>
      {label ? <FieldLabel label={label} required={required} tag={labelTag} /> : null}

      <Pressable
        onPress={show}
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
          {value ? (mode === "time" ? slotLabel(value) : format(value)) : placeholder}
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

      <Sheet ref={sheetRef} title={mode === "time" ? "Pick a time" : undefined} padded onDismiss={() => setOpen(false)}>
        {!open ? null : mode === "time" ? (
          <TimeSheet value={value} day={day} now={now} clearable={clearable} onPick={pick} />
        ) : (
          <CalendarSheet value={value} minimumDate={minimumDate} now={now} onPick={pick} />
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  triggerText: { flex: 1 },
});
