/* eslint-disable react-native/no-unused-styles -- fieldBox is shared: Input, Select and DateField read it. */
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, metrics, radius, spacing, typography } from "../theme";
import { Chip } from "./Chip";
import { Text } from "./Text";

/** The label over a field (E `.lb`): 12/600 ink 2, a danger " *" when required, an optional xs chip. */
export function FieldLabel({ label, required, tag }: { label: string; required?: boolean; tag?: string }) {
  return (
    <View style={styles.labelRow}>
      <Text variant="label">
        {label}
        {required ? <Text variant="label" color="danger" style={styles.star}>{" *"}</Text> : null}
      </Text>
      {tag ? <Chip label={tag} size="xs" /> : null}
    </View>
  );
}

/** Help under a field, or the error in its place (E `.help`, `.help.er`). */
export function FieldHelp({ error, hint }: { error?: string | null; hint?: string }) {
  if (error) return <Text variant="label" color="dangerText" style={styles.help}>{error}</Text>;
  if (hint) return <Text variant="small" style={styles.help}>{hint}</Text>;
  return null;
}

/** Two fields side by side, 10 apart (E `.two`). */
export function FieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

/**
 * The field box every control shares (E `.in`): 44 tall, radius 12, white,
 * 1 px `border`. Focus and error swap to a 2 px ring with 1 less padding, so
 * the text does not move.
 */
export const fieldBox = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    height: metrics.controlHeight,
    borderRadius: radius.badge,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.surface,
  },
  focused: { borderWidth: 2, borderColor: colors.primary, paddingHorizontal: 11 },
  error: { borderWidth: 2, borderColor: colors.danger, paddingHorizontal: 11 },
  disabled: { backgroundColor: colors.disabledBg },
  multiline: { height: undefined, minHeight: 72, alignItems: "flex-start", paddingTop: 11, paddingBottom: 11 },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: 0,
    // A single-line TextInput does not centre glyphs inside a lineHeight box,
    // and Android reserves accent room; both push text off the icon's line.
    lineHeight: undefined,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  inputMultiline: { lineHeight: 20, textAlignVertical: "top" },
});

const styles = StyleSheet.create({
  labelRow: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap, marginBottom: metrics.inlineGap },
  star: { fontFamily: typography.groupTitle.fontFamily },
  help: { marginTop: metrics.inlineGap },
  row: { flexDirection: "row", gap: metrics.pairGap },
});

/**
 * The "+91" / "₹" prefix inside a field: ink 2 semibold, a 1 px divider on its
 * right. The divider is its own View — a right border on the prefix would be
 * an edge rail to the guard.
 */
export function FieldPrefix({ text }: { text: string }) {
  return (
    <View style={prefixStyles.wrap}>
      <Text variant="bodyStrong" color="textSecondary" tabular>{text}</Text>
      <View style={prefixStyles.divider} />
    </View>
  );
}

const prefixStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: spacing[2], height: 22 },
  divider: { width: 1, height: 22, backgroundColor: colors.border },
});
