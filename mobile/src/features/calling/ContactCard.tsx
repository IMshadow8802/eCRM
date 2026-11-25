import { Pressable, StyleSheet, View } from "react-native";
import { History, List, MapPin, Phone, StickyNote, UserRound } from "lucide-react-native";

import { colors, spacing } from "../../theme";
import type { CallContact } from "../../types/api";
import { Button, Card, Chip, Facts, MarkBanner, StatusBadge, Text, type ChipProps } from "../../ui";
import { historyLine, titleOf } from "./callingHelpers";

export interface ContactCardProps {
  contact: CallContact;
  scriptAvailable: boolean;
  onCall: () => void;
  /** Save a result without dialling (a desk phone). */
  onResult: () => void;
  onScript: () => void;
  /** Callbacks: the booked time. */
  timeChip?: ChipProps;
  now?: Date;
}

/** The contact the caller works next (mockup P2): who, the number, the sheet's lines, Call. */
export function ContactCard({ contact: c, scriptAvailable, onCall, onResult, onScript, timeChip, now = new Date() }: ContactCardProps) {
  const title = titleOf(c);
  const history = historyLine(c, now);
  return (
    <Card testID={`contact-${c.Id}`}>
      <View style={styles.row}>
        <List size={14} color={colors.textMuted} />
        <Text variant="small" numberOfLines={1} style={styles.flex}>{c.ListName}</Text>
        {scriptAvailable ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Script" hitSlop={spacing[2]} onPress={onScript}>
            <Text variant="metaStrong" color="primary">Script</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.who}>
        <StatusBadge size={48} tone="teal" icon={UserRound} />
        <View style={styles.flex}>
          <Text variant="cardTitle" numberOfLines={2}>{title}</Text>
          <Text variant="bodyLg" tabular>
            {c.Mobile}
            {c.AltMobile ? <Text variant="meta">{` · alt ${c.AltMobile}`}</Text> : null}
          </Text>
          {c.Company && c.Name?.trim() ? <Text variant="meta" numberOfLines={1}>{c.Company}</Text> : null}
        </View>
      </View>
      {c.City || timeChip ? (
        <View style={styles.chips}>
          {timeChip ? <Chip size="sm" {...timeChip} /> : null}
          {c.City ? <Chip size="sm" icon={MapPin} label={c.City} /> : null}
        </View>
      ) : null}
      {history ? (
        <View style={styles.row}>
          <History size={16} color={colors.textMuted} />
          <Text variant="meta" style={styles.flex}>{history}</Text>
        </View>
      ) : null}
      <MarkBanner mark={c.PhoneMark} note={c.PhoneMarkNote} />
      {c.extras.length ? <Facts layout="list" items={c.extras.map((e) => ({ label: e.label, value: e.value }))} /> : null}
      <View style={styles.row}>
        <Button title="Call" icon={Phone} onPress={onCall} style={styles.flex} accessibilityLabel={`Call ${title}`} />
        <Button title="Save result" icon={StickyNote} variant="ghost" onPress={onResult} accessibilityLabel={`Save result for ${title}`} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  who: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
});
