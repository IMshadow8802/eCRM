import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { metrics, spacing } from "../theme";
import { Card } from "./Card";
import { Text } from "./Text";

export interface Fact {
  label: string;
  value?: string;
  /** A Chip, or an Avatar 22 + name, in place of plain text. */
  node?: ReactNode;
  tone?: "danger";
}

export interface FactsProps {
  items: Fact[];
  /** `grid` = 2 columns in a card (11); `list` = label left, value right (T2, T3). */
  layout?: "grid" | "list";
}

const value = (f: Fact, align?: "right") =>
  f.node ?? (
    <Text variant="rowTitle" color={f.tone === "danger" ? "dangerText" : "text"} numberOfLines={2} align={align}>
      {f.value ?? "—"}
    </Text>
  );

/**
 * Facts on spacing, not on lines (E 11, T2, T3): no grid rules, no
 * separators. An empty value reads "—".
 */
export function Facts({ items, layout = "grid" }: FactsProps) {
  if (layout === "list") {
    return (
      <View>
        {items.map((f) => (
          <View key={f.label} style={styles.listRow}>
            <Text variant="metaStrong" color="textMuted" style={styles.label}>{f.label}</Text>
            {/* The value takes what is left and wraps there; the label never squeezes. */}
            <View testID="fact-value" style={styles.listValue}>{value(f, "right")}</View>
          </View>
        ))}
      </View>
    );
  }
  return (
    <Card padded={false} gap={0} style={styles.grid}>
      {items.map((f) => (
        <View key={f.label} style={styles.cell}>
          <Text variant="label" color="textMuted">{f.label}</Text>
          <View style={styles.cellValue}>{value(f)}</View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 14, paddingVertical: spacing[3], paddingHorizontal: metrics.rowPadH },
  cell: { width: "50%", paddingRight: spacing[2] },
  cellValue: { marginTop: spacing[1], alignItems: "flex-start" },
  listRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: 10 },
  label: { flexShrink: 0 },
  listValue: { flex: 1, alignItems: "flex-end" },
});

export default Facts;
