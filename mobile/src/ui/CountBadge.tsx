import { StyleSheet, View, type ViewStyle } from "react-native";

import { colors, metrics, radius, spacing, type ColorKey } from "../theme";
import { Text } from "./Text";

/** Over 99 a count reads "99+": the badge says "a lot", the list says how many. */
export const capCount = (n: number) => (n > 99 ? "99+" : String(n));

export interface CountBadgeProps {
  count: number;
  /** The 2 px ring takes the colour of what the badge sits on (`band` on the bar). */
  ringColor?: ColorKey;
  style?: ViewStyle;
}

/**
 * The coral notification badge (E `.bdg`): bell, bar and rail items. Renders
 * nothing at zero, so a caller never has to guard it.
 */
export function CountBadge({ count, ringColor = "band", style }: CountBadgeProps) {
  if (!(count > 0)) return null;
  return (
    <View
      accessibilityLabel={`${count} new`}
      style={[styles.badge, { borderColor: colors[ringColor] }, style]}
    >
      <Text variant="badge" scaleCap="chrome" align="center">{capCount(count)}</Text>
    </View>
  );
}

export interface CountPillProps {
  count: number;
  /** `active` on the selected tab; `danger` for an overdue count. */
  tone?: "default" | "active" | "danger";
}

const PILL: Record<NonNullable<CountPillProps["tone"]>, [ColorKey, ColorKey]> = {
  default: ["bandField", "onBandSoft"],
  active: ["primary", "textOnBrand"],
  danger: ["coral", "textOnBrand"],
};

/** The count after a band tab or segment label (E `.ct`). */
export function CountPill({ count, tone = "default" }: CountPillProps) {
  const [fill, text] = PILL[tone];
  return (
    <View style={[styles.pill, { backgroundColor: colors[fill] }]}>
      <Text variant="count" color={text} align="center">{capCount(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: metrics.countBadge.minWidth,
    height: metrics.countBadge.height,
    paddingHorizontal: 5,
    borderRadius: radius.badgeXs,
    borderWidth: metrics.countBadge.border,
    backgroundColor: colors.coral,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    minWidth: metrics.countPill.minWidth,
    height: metrics.countPill.height,
    paddingHorizontal: spacing[1] + 2,
    borderRadius: radius.badgeXs,
    alignItems: "center",
    justifyContent: "center",
  },
});
