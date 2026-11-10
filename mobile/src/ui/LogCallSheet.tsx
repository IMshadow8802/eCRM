import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, type LucideIcon } from "lucide-react-native";

import { metrics, spacing, type ChipTone } from "../theme";
import type { Lookup } from "../types/api";
import { Button } from "./Button";
import { Stepper } from "./ChoiceList";
import { FieldLabel } from "./Field";
import { Input } from "./Input";
import { Sheet, type SheetRef } from "./Sheet";
import { FilterPills, SegmentedTabs } from "./Tabs";
import { Text } from "./Text";

export type CallDirection = "out" | "in" | "noAnswer";

export interface LogCallThen {
  value: string;
  label: string;
  tone?: ChipTone;
  icon?: LucideIcon;
}

export interface LogCallValues {
  /** What the API takes: `noAnswer` is sent as `out` + the matching outcome (G15). */
  direction: "out" | "in";
  minutes: number;
  notes: string;
  outcomeId: number | null;
  /** The chosen "Then" value, or null when no options were given. */
  then: string | null;
}

export interface LogCallSheetProps {
  title?: string;
  /** "{contact} · {mobile}" */
  subtitle?: string;
  /** `call_outcome` lookups. One whose Value says "no answer" enables that segment. */
  outcomes?: Lookup[];
  /** Complaints only: Keep open · Put on hold · Resolve. The first is the default. */
  then?: LogCallThen[];
  busy?: boolean;
  error?: string | null;
  onSubmit: (values: LogCallValues) => void;
}

const QUICK = [2, 5, 10, 15];
const isNoAnswer = (l: Lookup) => /no\s*answer/i.test(l.Value);

/**
 * Log a call (E 24), generic for complaints and leads: direction, duration
 * (stepper + quick minutes), required notes, and for complaints a "Then" step.
 * The sheet keeps what was typed on a failed submit; the caller dismisses on success.
 */
export const LogCallSheet = forwardRef<SheetRef, LogCallSheetProps>(function LogCallSheet(
  { title = "Log call", subtitle, outcomes = [], then, busy = false, error, onSubmit },
  ref,
) {
  const noAnswer = outcomes.find(isNoAnswer);
  const [direction, setDirection] = useState<CallDirection>("out");
  const [minutes, setMinutes] = useState(1);
  const [notes, setNotes] = useState("");
  // null = not picked: the first option, even when the options arrive after mount
  // (the complaint detail mounts this sheet before its ticket loads).
  const [picked, setNext] = useState<string | null>(null);
  const next = picked ?? then?.[0]?.value ?? null;

  const reset = () => {
    setDirection("out");
    setMinutes(1);
    setNotes("");
    setNext(null);
  };

  const directions = [
    { value: "out" as const, label: "Outgoing", icon: PhoneOutgoing },
    { value: "in" as const, label: "Incoming", icon: PhoneIncoming },
    ...(noAnswer ? [{ value: "noAnswer" as const, label: "No answer", icon: PhoneMissed }] : []),
  ];
  const missed = direction === "noAnswer";
  const complete = !!notes.trim();

  const submit = () => {
    if (!complete) return;
    onSubmit({
      direction: direction === "in" ? "in" : "out",
      minutes: missed ? 0 : minutes,
      notes: notes.trim(),
      outcomeId: missed ? noAnswer!.Id : null,
      then: then?.length ? next : null,
    });
  };

  return (
    <Sheet ref={ref} title={title} subtitle={subtitle} badge={{ tone: "sky", icon: PhoneCall }} keyboardAware padded onDismiss={reset}>
      <FieldLabel label="Direction" />
      <SegmentedTabs tone="inSheet" value={direction} options={directions} onChange={setDirection} />

      {missed ? null : (
        <View style={styles.block}>
          <FieldLabel label="Duration" />
          <View style={styles.duration}>
            <Stepper label="Duration" value={minutes} onChange={setMinutes} min={0} format={(m) => `${m} min`} />
            <FilterPills
              tone="inSheet"
              label="Quick minutes"
              value={QUICK.includes(minutes) ? minutes : null}
              options={QUICK.map((m) => ({ value: m, label: String(m) }))}
              onChange={setMinutes}
            />
          </View>
        </View>
      )}

      <Input
        testID="logcall-notes"
        label="What was said"
        required
        accessibilityLabel="What was said"
        value={notes}
        onChangeText={setNotes}
        placeholder="What was said"
        multiline
        fieldHeight={76}
        containerStyle={styles.notes}
      />

      {then?.length ? (
        <View style={styles.thenBlock}>
          <FieldLabel label="Then" />
          <FilterPills tone="sheet" label="Then" value={next} options={then} onChange={setNext} />
        </View>
      ) : null}

      {error ? <Text variant="label" color="dangerText" style={styles.error}>{error}</Text> : null}
      <Button title="Save call" onPress={submit} loading={busy} disabled={!complete} fullWidth style={styles.save} />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  block: { marginTop: 14 },
  thenBlock: { marginTop: spacing[1] },
  duration: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  // The block above it (14) and E .fl 12 below.
  notes: { marginTop: 14, marginBottom: metrics.fieldGap },
  error: { marginTop: spacing[2] },
  save: { marginTop: spacing[4] },
});
