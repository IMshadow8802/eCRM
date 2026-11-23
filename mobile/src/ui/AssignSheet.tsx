import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Clock, Search, type LucideIcon } from "lucide-react-native";

import { colors, metrics, spacing, type BadgeTone } from "../theme";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { ChoiceList, type Choice } from "./ChoiceList";
import { FieldHelp, FieldLabel } from "./Field";
import { Input } from "./Input";
import { GroupHeader } from "./List";
import { Sheet, type SheetRef } from "./Sheet";
import { FilterPills } from "./Tabs";
import { Text } from "./Text";

export interface AssignPerson {
  Id: number;
  FullName: string;
  /** "Support Head · Head Office" (G14: no open count). */
  note?: string;
  /** The server's GroupRank: 1 manager and team · 2 own offices · 3 other offices. */
  group?: 1 | 2 | 3;
  /** AwayToday: a full-day leave or a holiday today. Still pickable. */
  away?: boolean;
  /** IsGiver: the person who gave this record to the caller. */
  giver?: boolean;
}

export interface AssignSheetProps {
  title: string;
  subtitle?: string;
  badge: { tone: BadgeTone; icon: LucideIcon };
  /** "Reassign to", "Escalate to". */
  pickLabel: string;
  people: AssignPerson[];
  /** A filter over `people` on the device (E 23): name + `note`, so a caller
   *  whose note is "JobTitle · Office" gets search by job title and office. */
  searchable?: boolean;
  /** The chip on an `away` row ("Away today"); omit for none. */
  awayLabel?: string;
  /** The chip on the `giver` row ("Gave it to you"); omit for none. */
  giverLabel?: string;
  /** Reason lookups; omit for no reason row. `sent_back` is never offered. */
  reasons?: { Id: number; Value: string; Code?: string | null }[];
  remarksPlaceholder: (name: string | null) => string;
  remarksError: string;
  /** The muted line above the button ("Due stays 12:40 pm…"). */
  footnote?: string;
  /** "Reassign to Vivek". */
  submitLabel: (name: string | null) => string;
  emptyMessage: string;
  busy?: boolean;
  onSubmit: (values: { userId: number; reasonId: number | null; remarks: string }) => void;
  /** Prefix for the inputs' test ids ("reassign" → "reassign-remarks"). */
  testID: string;
}

/** §6 picker headings, by GroupRank. */
const GROUPS = [
  { rank: 1, heading: "Your manager and team" },
  { rank: 2, heading: "Your office" },
  { rank: 3, heading: "Other offices" },
] as const;

/**
 * Hand a record to a person (E 23): pick them (radio, grouped by GroupRank
 * when the list carries it), a reason (pills), required remarks shown failing
 * inline after a submit. Reassign and Escalate are both this sheet — the
 * escalation has no reason row and no search. Complaints and leads share it.
 */
export const AssignSheet = forwardRef<SheetRef, AssignSheetProps>(function AssignSheet(
  {
    title, subtitle, badge, pickLabel, people, searchable = false, awayLabel, giverLabel, reasons, remarksPlaceholder,
    remarksError, footnote, submitLabel, emptyMessage, busy = false, onSubmit, testID,
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
  const grouped = !collapsed && shown.some((p) => p.group != null);
  const sections = grouped
    ? GROUPS.map((g) => ({ heading: g.heading as string | null, rows: shown.filter((p) => (p.group ?? 3) === g.rank) })).filter((s) => s.rows.length)
    : [{ heading: null, rows: shown }];
  const pick = (id: number) => {
    setPerson(id);
    setChanging(false);
    setQuery("");
  };
  const choice = (p: AssignPerson): Choice<number> => ({
    value: p.Id,
    label: p.FullName,
    note: p.note,
    lead: <Avatar name={p.FullName} userId={p.Id} size={36} />,
    chip: p.away && awayLabel
      ? { label: awayLabel, tone: "butter" }
      : p.giver && giverLabel ? { label: giverLabel, tone: "lilac" } : undefined,
  });
  const name = people.find((p) => p.Id === person)?.FullName ?? null;
  // "Sent back" is written only by the Send back action. Picked by hand it would
  // hide the giver from the next person's Send back (fn_RecordGiver skips it);
  // the server refuses it too (143).
  const options = reasons?.filter((r) => r.Code !== "sent_back");
  const needsReason = !!options;
  const noReasons = !!options && !options.length;

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
          accessibilityLabel="Search people"
          value={query}
          onChangeText={setQuery}
          placeholder="Search people"
          leftIcon={Search}
          autoCorrect={false}
          fieldHeight={metrics.searchHeight}
        />
      ) : null}
      {/* A plain View: the sheet body is the scrollable (see ui/Sheet). An RN
          ScrollView here never scrolled on Android under the sheet's pan. */}
      <View style={styles.people}>
        {sections.map((s, i) => (
          <View key={s.heading ?? "all"}>
            {s.heading ? <GroupHeader label={s.heading} first={i === 0} /> : null}
            <ChoiceList
              value={person}
              onChange={pick}
              emptyMessage={q ? "Nobody matches." : emptyMessage}
              choices={s.rows.map(choice)}
            />
          </View>
        ))}
      </View>
      <FieldHelp error={tried && person == null ? `Pick who it goes to.` : null} />

      {options ? (
        <View style={styles.block}>
          <FieldLabel label="Reason" required />
          {noReasons ? (
            // The SP demands a reason; with none set up it cannot be sent.
            <FieldHelp error="No reasons are set up. Add them on the web first." />
          ) : (
            <>
              <FilterPills
                tone="inSheet"
                wrap
                label="Reason"
                value={reason}
                options={options.map((r) => ({ value: r.Id, label: r.Value }))}
                onChange={setReason}
              />
              <FieldHelp error={tried && reason == null ? "Pick a reason." : null} />
            </>
          )}
        </View>
      ) : null}

      <View style={styles.block}>
        <Input
          testID={`${testID}-remarks`}
          label="Remarks"
          required
          accessibilityLabel="Remarks"
          value={remarks}
          onChangeText={setRemarks}
          placeholder={remarksPlaceholder(name)}
          multiline
          fieldHeight={64}
          error={tried && !remarks.trim() ? remarksError : null}
          containerStyle={styles.remarks}
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
  remarks: { marginBottom: metrics.fieldGap },
  foot: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginBottom: spacing[3] },
  flex: { flex: 1 },
});
