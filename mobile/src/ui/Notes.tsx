import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { badgeTones, colors, metrics, radius, spacing } from "../theme";
import { Text } from "./Text";

/** The primary-soft hint card (E 22): icon 18 primary, 13/18 text in the inbox ink. No shadow. */
export function InfoNote({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <View style={styles.info}>
      <Icon size={18} color={colors.primary} />
      <Text variant="meta" style={styles.infoText}>{children}</Text>
    </View>
  );
}

/** A small icon + muted line under a list (E 06, 17, 26). */
export function Footnote({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <View style={styles.foot}>
      <Icon size={16} color={colors.textMuted} />
      <Text variant="small" style={styles.flex}>{children}</Text>
    </View>
  );
}

/** The board's page dots (E 07): the active one is an 18 × 6 pill. */
export function PageDots({ count, index }: { count: number; index: number }) {
  return (
    <View style={styles.dots} accessibilityLabel={`Page ${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          testID={i === index ? "page-dot-active" : "page-dot"}
          style={[styles.dot, i === index ? styles.dotOn : styles.dotOff]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  info: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: metrics.rowPadH,
    borderRadius: radius.card,
    backgroundColor: colors.primarySoft,
  },
  infoText: { flex: 1, color: badgeTones.indigo.ink },
  foot: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 14, paddingHorizontal: 2 },
  flex: { flex: 1 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: metrics.inlineGap },
  dot: { height: metrics.pageDot.idle, borderRadius: radius.mark },
  dotOn: { width: metrics.pageDot.active, backgroundColor: colors.primary },
  dotOff: { width: metrics.pageDot.idle, backgroundColor: colors.iconFaint },
});
