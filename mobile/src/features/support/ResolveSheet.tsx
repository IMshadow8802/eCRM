import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { CircleCheck } from "lucide-react-native";

import { metrics } from "../../theme";
import type { Lookup, Ticket } from "../../types/api";
import { Button, Select, Sheet, type SheetRef } from "../../ui";
import { RemarksInput } from "./RemarksInput";

export interface ResolveSheetProps {
  ticket: Pick<Ticket, "TicketNo" | "Subject"> | null;
  /** `resolution` lookups. */
  resolutions: Lookup[];
  busy?: boolean;
  onSubmit: (values: { resolutionId: number; remarks: string }) => void;
}

/**
 * Resolve a complaint (E 13): a resolution (the value is a green chip) and
 * remarks, both required — what sp_SetTicketStatus demands to enter Resolved.
 * The sheet rides the keyboard and keeps what was typed when the save fails.
 */
export const ResolveSheet = forwardRef<SheetRef, ResolveSheetProps>(function ResolveSheet(
  { ticket, resolutions, busy = false, onSubmit },
  ref,
) {
  const [resolution, setResolution] = useState<number | null>(null);
  const [remarks, setRemarks] = useState("");
  const [tried, setTried] = useState(false);

  const reset = () => {
    setResolution(null);
    setRemarks("");
    setTried(false);
  };

  const submit = () => {
    setTried(true);
    if (resolution == null || !remarks.trim()) return;
    onSubmit({ resolutionId: resolution, remarks: remarks.trim() });
  };

  return (
    <Sheet
      ref={ref}
      title="Resolve complaint"
      subtitle={ticket ? `${ticket.TicketNo} · ${ticket.Subject}` : undefined}
      badge={{ tone: "green", icon: CircleCheck }}
      keyboardAware
      padded
      onDismiss={reset}
    >
      <View style={styles.field}>
        <Select
          label="Resolution"
          required
          value={resolution}
          options={resolutions.map((r) => ({ value: r.Id, label: r.Value, chip: { tone: "green", icon: CircleCheck } }))}
          onChange={(v) => setResolution(v as number)}
          placeholder="How was it fixed?"
          sheetTitle="Resolution"
          error={tried && resolution == null ? "Pick a resolution." : null}
        />
      </View>
      <RemarksInput
        testID="resolve-remarks"
        value={remarks}
        onChangeText={setRemarks}
        placeholder="What was done"
        minHeight={84}
        autoFocus
        hint="Required. Shows in the complaint history."
        error={tried && !remarks.trim() ? "Remarks are required to resolve." : null}
      />
      <Button title="Save · mark resolved" onPress={submit} loading={busy} fullWidth />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  field: { marginBottom: metrics.fieldGap },
});
