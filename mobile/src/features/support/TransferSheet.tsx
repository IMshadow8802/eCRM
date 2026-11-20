import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Clock, Search, type LucideIcon } from "lucide-react-native";

import { colors, metrics, spacing, type BadgeTone } from "../../theme";
import type { Lookup } from "../../types/api";
import { Avatar, Button, ChoiceList, FieldHelp, FieldLabel, FilterPills, Input, Sheet, Text, type SheetRef } from "../../ui";
import { RemarksInput } from "./RemarksInput";

export interface Person {
  Id: number;
  FullName: string;
  /** "Support Head · Head Office" (G14: no open count). */
  note?: string;
}

export interface TransferSheetProps {
  title: string;
  subtitle?: string;
  badge: { tone: BadgeTone; icon: LucideIcon };
  /** "Transfer to", "Escalate to". */
  pickLabel: string;
  people: Person[];
  /** A client filter over `people` (E 23). */
  searchable?: boolean;
  /** `transfer_reason` lookups; omit for no reason row. */
  reasons?: Lookup[];
  remarksPlaceholder: (name: string | null) => string;
  remarksError: string;
  /** The muted line above the button ("Due stays 12:40 pm…"). */
  footnote?: string;
  /** "Transfer to Neha Kapoor". */
  submitLabel: (name: string | null) => string;
  emptyMessage: string;
  busy?: boolean;
  onSubmit: (values: { userId: number; reasonId: number | null; remarks: string }) => void;
  /** Prefix for the inputs' test ids ("transfer" → "transfer-remarks"). */
  testID: string;
}

/**
 * Hand a complaint to a person (E 23): pick them (radio), a reason (pills),
 * required remarks shown failing inline after a submit. Transfer and Escalate
 * are both this sheet — the escalation has no reason row and no search.
 */
export const TransferSheet = forwardRef<SheetRef, TransferSheetProps>(function TransferSheet(
  {
    title, subtitle, badge, pickLabel, people, searchable = false, reasons, remarksPlaceholder, remarksError,
    footnote, submitLabel, emptyMessage, busy = false, onSubmit, testID,
  },
  ref,
) {
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<number | null>(null);
  /** "Change" pressed: the full list again, with the pick still marked. */
  const [changing, setChanging] = useState(false);
  const [reason, setReason] = useState<number | null>(null);
  const [remarks, setRemarks] = useState("");
  const [tried, setTried] = useState(false);

  const reset = () => {
    setQuery("");
    setPerson(null);
    setChanging(false);
    setReason(null);
    setRemarks("");
    setTried(false);
  };

  // Once someone is picked the list folds to them, so Reason and Remarks sit
  // right below instead of under ~75 names (device check 2026-11-20).
  const collapsed = person != null && !changing;
  const q = query.trim().toLowerCase();
  const shown = collapsed
    ? people.filter((p) => p.Id === person)
    : q ? people.filter((p) => `${p.FullName} ${p.note ?? ""}`.toLowerCase().includes(q)) : people;
  const pick = (id: number) => {
    setPerson(id);
    setChanging(false);
    setQuery("");
  };
  const name = people.find((p) => p.Id === person)?.FullName ?? null;
  const needsReason = !!reasons;
  const noReasons = !!reasons && !reasons.length;

  const submit = () => {
    setTried(true);
    if (person == null || (needsReason && reason == null) || !remarks.trim()) return;
    onSubmit({ userId: person, reasonId: reason, remarks: remarks.trim() });
  };

  return (
    <Sheet
      ref={ref}
      title={title}
      subtitle={subtitle}
      badge={badge}
      keyboardAware
      padded
      snapPoints={searchable ? ["90%"] : undefined}
      onDismiss={reset}
    >
      <View style={styles.pickHead}>
        <View style={styles.flex}>
          <FieldLabel label={pickLabel} required />
        </View>
        {collapsed ? <Button title="Change" variant="ghost" size="xs" onPress={() => setChanging(true)} /> : null}
      </View>
      {searchable && !collapsed ? (
        <Input
          testID={`${testID}-search`}
          accessibilityLabel="Search people in your reach"
          value={query}
          onChangeText={setQuery}
          placeholder="Search people in your reach"
          leftIcon={Search}
          autoCorrect={false}
          fieldHeight={metrics.searchHeight}
        />
      ) : null}
      {/* A plain View: the sheet body is the scrollable (see ui/Sheet). An RN
          ScrollView here never scrolled on Android under the sheet's pan. */}
      <View style={styles.people}>
        <ChoiceList
          value={person}
          onChange={pick}
          emptyMessage={q ? "Nobody matches." : emptyMessage}
          choices={shown.map((p) => ({
            value: p.Id,
            label: p.FullName,
            note: p.note,
            lead: <Avatar name={p.FullName} userId={p.Id} size={36} />,
          }))}
        />
      </View>
      <FieldHelp error={tried && person == null ? `Pick who it goes to.` : null} />

      {reasons ? (
        <View style={styles.block}>
          <FieldLabel label="Reason" required />
          {noReasons ? (
            // The SP demands a reason; with none set up a transfer cannot be sent.
            <FieldHelp error="No transfer reasons are set up. Add them on the web first." />
          ) : (
            <>
              <FilterPills
                tone="inSheet"
                wrap
                label="Reason"
                value={reason}
                options={reasons.map((r) => ({ value: r.Id, label: r.Value }))}
                onChange={setReason}
              />
              <FieldHelp error={tried && reason == null ? "Pick a reason." : null} />
            </>
          )}
        </View>
      ) : null}

      <View style={styles.block}>
        <RemarksInput
          testID={`${testID}-remarks`}
          value={remarks}
          onChangeText={setRemarks}
          placeholder={remarksPlaceholder(name)}
          error={tried && !remarks.trim() ? remarksError : null}
        />
      </View>

      {footnote ? (
        <View style={styles.foot}>
          <Clock size={14} color={colors.textMuted} />
          <Text variant="small" tabular style={styles.flex}>{footnote}</Text>
        </View>
      ) : null}
      <Button title={submitLabel(name)} onPress={submit} loading={busy} disabled={noReasons} fullWidth />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  pickHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  people: { marginTop: metrics.inlineGap },
  block: { marginTop: spacing[3] },
  foot: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginBottom: spacing[3] },
  flex: { flex: 1 },
});
