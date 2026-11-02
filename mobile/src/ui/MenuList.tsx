import { Pressable, StyleSheet, View } from "react-native";
import { ChevronRight, type LucideIcon } from "lucide-react-native";

import { colors, spacing } from "../theme";
import { Card } from "./Card";
import { Glyph } from "./Glyph";
import { Text } from "./Text";

export interface MenuListRow {
  key: string;
  icon: LucideIcon;
  /** Semantic colour of the glyph. */
  tint: keyof typeof colors;
  label: string;
  detail: string;
  onPress: () => void;
}

/**
 * One card of tappable rows — glyph, label, one-line detail, chevron. Home's
 * Today numbers and the More menu are both this.
 */
export default function MenuList({ rows }: { rows: MenuListRow[] }) {
  return (
    <Card padded={false} gap={0}>
      {rows.map((row, i) => (
        <Pressable
          key={row.key}
          onPress={row.onPress}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.row,
            i < rows.length - 1 && styles.rowDivider,
            pressed && styles.rowPressed,
          ]}
        >
          <Glyph icon={row.icon} tint={colors[row.tint]} size="md" />
          <View style={styles.rowText}>
            <Text variant="h3">{row.label}</Text>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {row.detail}
            </Text>
          </View>
          <ChevronRight size={22} color={colors.textMuted} />
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], padding: spacing[4] },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowText: { flex: 1, gap: spacing[1] },
});
