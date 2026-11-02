import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Tag } from "lucide-react-native";

import type { Lead, Lookup } from "../../types/api";
import { colors, metrics, radius, spacing } from "../../theme";
import { Button, ChoiceList, FieldHelp, FieldLabel, Input, Select, Sheet, Text, type SheetRef } from "../../ui";
import { leadStatusBadge } from "./leadHelpers";

/** What a save sends: `converted` only ever through convertLead (CLAUDE.md §6). */
export type StatusChange =
  | { kind: "status"; StatusId: number; LostReasonId: number | null }
  | { kind: "won"; WonValue: number; Remarks: string | null };

export interface StatusSheetProps {
  lead: Pick<Lead, "Name" | "StatusId" | "StatusName">;
  statuses: Lookup[];
  lostReasons: Lookup[];
  /** False until the lost_reason lookup has arrived — empty then means "loading". */
  lostReasonsLoaded: boolean;
  busy?: boolean;
  error?: string | null;
  onSubmit: (change: StatusChange) => void;
}

const NO_LOST_REASONS = "No lost reasons are set up. Add them on the web first.";

/**
 * Change status (E 25): every lead_status row with its badge, the current one
 * marked. Lost asks for a reason in place (required; G16 drops remarks, the
 * API has none); Won asks for the final ₹ value and goes to convertLead,
 * never setLeadStatus. Statuses key on Code, never on a label.
 */
export const StatusSheet = forwardRef<SheetRef, StatusSheetProps>(function StatusSheet(
  { lead, statuses, lostReasons, lostReasonsLoaded, busy = false, error, onSubmit },
  ref,
) {
  const [pick, setPick] = useState<number | null>(null);
  const [reason, setReason] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [remarks, setRemarks] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  const reset = () => {
    setPick(null);
    setReason(null);
    setValue("");
    setRemarks("");
    setInvalid(null);
  };

  const chosen = statuses.find((s) => s.Id === pick) ?? null;
  const lost = chosen?.Code === "lost";
  const won = chosen?.Code === "converted";
  const amount = Number(value.replace(/,/g, ""));
  const ready =
    !!chosen && chosen.Id !== lead.StatusId && (!lost || reason != null) && (!won || value.trim().length > 0);

  const submit = () => {
    if (!chosen || !ready) return;
    if (won) {
      if (!Number.isFinite(amount) || amount < 0) return setInvalid("Enter the value this lead was won for.");
      setInvalid(null);
      return onSubmit({ kind: "won", WonValue: amount, Remarks: remarks.trim() || null });
    }
    setInvalid(null);
    onSubmit({ kind: "status", StatusId: chosen.Id, LostReasonId: lost ? reason : null });
  };

  return (
    <Sheet
      ref={ref}
      title="Change status"
      subtitle={`${lead.Name} · now ${lead.StatusName ?? "—"}`}
      badge={{ tone: "mint", icon: Tag }}
      keyboardAware
      padded
      onDismiss={reset}
    >
      <ChoiceList
        value={pick}
        onChange={setPick}
        emptyMessage="No statuses are configured. Add them on the web first."
        choices={statuses.map((s) => {
          const badge = leadStatusBadge(statuses, s.Code, s.Id);
          return {
            value: s.Id,
            label: s.Value,
            badge: { tone: badge.tone, icon: badge.icon },
            chip: s.Id === lead.StatusId ? { label: "Current", tone: "lilac" as const } : undefined,
            note: s.Code === "converted" ? "asks final value" : undefined,
            danger: s.Code === "lost",
          };
        })}
      />

      {lost ? (
        <View style={styles.panel} testID="lost-panel">
          {lostReasonsLoaded && !lostReasons.length ? (
            <>
              <FieldLabel label="Why was it lost?" required />
              <Text variant="label" color="dangerText">{NO_LOST_REASONS}</Text>
            </>
          ) : (
            // E 25: a Select whose value is a red chip. A sheet opened from this
            // sheet is checked on a device in Task 39; a fix belongs in ui/Select.
            <Select
              label="Why was it lost?"
              required
              value={reason}
              onChange={(v) => setReason(v as number)}
              placeholder="Choose a reason"
              sheetTitle="Why was it lost?"
              options={lostReasons.map((r) => ({ value: r.Id, label: r.Value, chip: { tone: "red" as const } }))}
            />
          )}
          <FieldHelp hint="A reason is required for Lost." />
        </View>
      ) : null}

      {won ? (
        <View style={styles.panel} testID="won-panel">
          <Input
            label="Final value"
            required
            prefix="₹"
            tabular
            value={value}
            onChangeText={setValue}
            placeholder="Amount in rupees"
            keyboardType="number-pad"
          />
          <Input
            label="Remarks"
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Optional note for the history"
            multiline
            containerStyle={styles.gap}
          />
        </View>
      ) : null}

      {invalid || error ? (
        <Text variant="label" color="dangerText" style={styles.error}>{invalid ?? error}</Text>
      ) : null}
      <Button
        title={chosen ? `Save · mark ${chosen.Value.toLowerCase()}` : "Save"}
        onPress={submit}
        loading={busy}
        disabled={!ready}
        fullWidth
        style={styles.save}
      />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  panel: { marginTop: spacing[3], padding: spacing[3], borderRadius: radius.card, backgroundColor: colors.surfaceMuted },
  gap: { marginTop: spacing[3] },
  error: { marginTop: spacing[2] },
  // E's 14 above the button; nearest token (central pass: a sheetActionGap metric).
  save: { marginTop: metrics.rowPadH },
});

export default StatusSheet;
