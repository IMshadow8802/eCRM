import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { chipTones, colors, metrics, spacing } from "../theme";
import { Button } from "./Button";
import { toISODate } from "./CalendarSheet";
import { Stepper } from "./ChoiceList";
import { SegmentedTabs } from "./Tabs";
import { Text } from "./Text";

export type DayPart = "morning" | "afternoon" | "evening";

const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number, m: number) => `${pad2(h)}:${pad2(m)}`;

/** First and last slot of each tab, in minutes after midnight. */
const PARTS: { value: DayPart; label: string; from: number; to: number }[] = [
  { value: "morning", label: "Morning", from: 8 * 60, to: 11 * 60 + 30 },
  { value: "afternoon", label: "Afternoon", from: 12 * 60, to: 16 * 60 + 30 },
  { value: "evening", label: "Evening", from: 17 * 60, to: 21 * 60 },
];

/** The tab's 30-minute slots, "HH:mm". */
export function slotsFor(part: DayPart): string[] {
  const { from, to } = PARTS.find((p) => p.value === part)!;
  const out: string[] = [];
  for (let t = from; t <= to; t += 30) out.push(hhmm(Math.floor(t / 60), t % 60));
  return out;
}

/** The tab a time belongs to: before noon, before 5 pm, after. */
export const partAt = (time: string): DayPart => (time < "12:00" ? "morning" : time < "17:00" ? "afternoon" : "evening");

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

/** "12:30 pm". */
export function slotLabel(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${pad2(m)} ${h < 12 ? "am" : "pm"}`;
}

/** Past only when the day is today and the time is before the current minute. */
export function isPastSlot(time: string, day: string | null | undefined, now: Date): boolean {
  return !!day && day === toISODate(now) && time < hhmm(now.getHours(), now.getMinutes());
}

export interface TimeSheetProps {
  /** "HH:mm" or null. */
  value: string | null;
  /** The day the time is on (yyyy-MM-dd); past times are off when it is today. */
  day?: string | null;
  now?: Date;
  clearable: boolean;
  onPick: (value: string | null) => void;
}

/** The in-app time picker shown in DateField's sheet: part-of-day slots + an exact custom time. */
export function TimeSheet({ value, day, now = new Date(), clearable, onPick }: TimeSheetProps) {
  const [part, setPart] = useState<DayPart>(partAt(value ?? hhmm(now.getHours(), now.getMinutes())));
  const [vh, vm] = (value ?? "09:00").split(":").map(Number) as [number, number];
  const [hour, setHour] = useState(vh);
  // The minute stepper counts 5-minute steps.
  const [step, setStep] = useState(Math.floor(vm / 5));
  const custom = hhmm(hour, step * 5);
  const customPast = isPastSlot(custom, day, now);

  return (
    <View style={styles.col}>
      <SegmentedTabs<DayPart> tone="inSheet" value={part} onChange={setPart} options={PARTS} />

      <View style={styles.grid}>
        {slotsFor(part).map((t) => {
          const off = isPastSlot(t, day, now);
          const on = t === value;
          return (
            <Pressable
              key={t}
              testID={`time-slot-${t}`}
              onPress={() => onPick(t)}
              disabled={off}
              accessibilityRole="button"
              accessibilityLabel={slotLabel(t)}
              accessibilityState={{ selected: on, disabled: off }}
              style={({ pressed }) => [styles.slot, on ? styles.on : off ? styles.off : styles.idle, pressed && styles.sink]}
            >
              <Text
                variant="metaStrong"
                tabular
                scaleCap="chrome"
                style={on ? styles.onText : off ? styles.offText : styles.idleText}
              >
                {slotLabel(t)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text variant="label">Custom time</Text>
      <View style={styles.custom}>
        <Stepper label="Hour" value={hour} min={0} max={23} onChange={setHour} format={hourLabel} />
        <Stepper label="Minute" value={step} min={0} max={11} onChange={setStep} format={(s) => `:${pad2(s * 5)}`} />
      </View>
      <Button
        testID="time-custom-set"
        title={`Set ${slotLabel(custom)}`}
        variant="secondary"
        size="sm"
        disabled={customPast}
        onPress={() => onPick(custom)}
      />
      {clearable && value ? <Button title="No time" variant="ghost" size="sm" onPress={() => onPick(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: spacing[3] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  slot: {
    width: "23%",
    height: metrics.buttonHeight.sm,
    borderRadius: metrics.buttonHeight.sm / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  idle: { backgroundColor: chipTones.indigo.fill },
  on: { backgroundColor: chipTones.brand.fill },
  off: { backgroundColor: colors.disabledBg },
  idleText: { color: chipTones.indigo.text },
  onText: { color: chipTones.brand.text },
  offText: { color: colors.disabledText },
  sink: { transform: [{ scale: 0.97 }] },
  custom: { flexDirection: "row", gap: spacing[2], flexWrap: "wrap" },
});
