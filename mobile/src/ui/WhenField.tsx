import { StyleSheet, View } from "react-native";

import { spacing } from "../theme";
import { DateField, toISODate } from "./DateField";
import { FieldLabel } from "./Field";
import { FilterPills } from "./Tabs";

export type WhenChip = "today" | "tomorrow" | "3days" | "pick";
export interface WhenValue {
  chip: WhenChip | null;
  /** The picked day (chip "pick" only), yyyy-MM-dd. */
  day: string | null;
  /** Optional "HH:mm". */
  time: string | null;
}
export const EMPTY_WHEN: WhenValue = { chip: null, day: null, time: null };

const OFFSET = { today: 0, tomorrow: 1, "3days": 3 } as const;
const OPTIONS: { value: WhenChip; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "3days", label: "In 3 days" },
  { value: "pick", label: "Pick date" },
];

/** "yyyy-MM-dd", or "yyyy-MM-ddTHH:mm" with a time. Local, never UTC. */
export function dueAt(day: string, time: string | null): string {
  return time ? `${day}T${time}` : day;
}

/** The due value, or null until a day is known. */
export function whenDue(v: WhenValue, now: Date = new Date()): string | null {
  let day: string | null = null;
  if (v.chip === "pick") day = v.day;
  else if (v.chip) day = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + OFFSET[v.chip]));
  return day ? dueAt(day, v.time) : null;
}

/** Day-only: the day is before today. Timed: before the current minute. */
export function isPastDue(due: string | null, now: Date = new Date()): boolean {
  if (!due) return false;
  if (!due.includes("T")) return due < toISODate(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return due < `${toISODate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export interface WhenFieldProps {
  label: string;
  required?: boolean;
  value: WhenValue;
  onChange: (v: WhenValue) => void;
  now?: Date;
}

export function WhenField({ label, required, value, onChange, now = new Date() }: WhenFieldProps) {
  const past = isPastDue(whenDue(value, now), now);
  return (
    <View style={styles.col}>
      <FieldLabel label={label} required={required} />
      <FilterPills<WhenChip>
        tone="inSheet"
        wrap
        label={label}
        value={value.chip}
        options={OPTIONS}
        onChange={(chip) => onChange({ ...value, chip })}
      />
      {value.chip === "pick" ? (
        <DateField
          value={value.day}
          placeholder="Choose a day"
          minimumDate={now}
          now={now}
          clearable={false}
          onChange={(day) => onChange({ ...value, day })}
        />
      ) : null}
      {/* A prefilled time (Reschedule) shows before a day is chosen, or it looks lost. */}
      {value.chip || value.time ? (
        <DateField
          mode="time"
          value={value.time}
          placeholder="Add a time (optional)"
          day={whenDue({ ...value, time: null }, now)}
          now={now}
          error={past ? "Pick a time from now on" : null}
          onChange={(time) => onChange({ ...value, time })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ col: { gap: spacing[2] } });
