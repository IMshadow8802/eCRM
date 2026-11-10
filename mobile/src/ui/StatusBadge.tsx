import { StyleSheet, View } from "react-native";
import { ChevronsUp, type LucideIcon } from "lucide-react-native";

import { badgeTones, colors, metrics, radius, type BadgeTone, type ColorKey } from "../theme";

export type StatusBadgeSize = 28 | 32 | 36 | 40 | 44 | 48 | 52 | 56 | 72;

export interface StatusBadgeProps {
  tone: BadgeTone;
  icon: LucideIcon;
  /** Box size in dp (E §3.6). 40 is the row badge. */
  size?: StatusBadgeSize;
  /** The violet corner dot: this record is escalated. */
  escalated?: boolean;
  /** The dot's 2 px ring takes the colour of what the badge sits on. */
  ringColor?: ColorKey;
  /** A 4 px `background` ring — the empty-state accent badges. */
  ring?: boolean;
  /** Overrides the icon size (empty-state art draws larger glyphs). */
  iconSize?: number;
  testID?: string;
}

/** size → [radius, icon] (E §3.6). */
const BADGE_GEOMETRY: Record<StatusBadgeSize, [number, number]> = {
  28: [radius.badgeXs, 14],
  32: [radius.badgeSm, 16],
  36: [radius.badge, 18],
  40: [radius.badge, 20],
  // The lilac accent on the empty art (20a).
  44: [radius.badge, 18],
  48: [radius.badgeLg, 22],
  52: [radius.card, 22],
  // The tenant placeholder on sign-in (E 02).
  56: [radius.badgeLg, 28],
  72: [radius.errorBadge, 32],
};

const RING = 4;

/**
 * The solid rounded square that leads every row: status, module, kind. Fill
 * and icon ink come from `badgeTones` — a screen names a tone, never a colour.
 */
export function StatusBadge({
  tone, icon: Icon, size = 40, escalated = false, ringColor = "surface", ring = false, iconSize, testID,
}: StatusBadgeProps) {
  const [r, glyph] = BADGE_GEOMETRY[size];
  const { fill, ink } = badgeTones[tone];
  return (
    <View
      testID={testID}
      style={[
        styles.box,
        { width: size, height: size, borderRadius: r, backgroundColor: fill },
        ring && styles.ring,
      ]}
    >
      <Icon size={iconSize ?? glyph} color={ink} />
      {escalated ? (
        <View testID="escalated-dot" style={[styles.dot, { borderColor: colors[ringColor] }]}>
          <ChevronsUp size={12} strokeWidth={2.5} color={colors.textOnBrand} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  ring: { borderWidth: RING, borderColor: colors.background },
  dot: {
    position: "absolute",
    right: -5,
    bottom: -5,
    width: metrics.escalatedDot,
    height: metrics.escalatedDot,
    borderRadius: metrics.escalatedDot / 2,
    borderWidth: 2,
    backgroundColor: colors.escalate,
    alignItems: "center",
    justifyContent: "center",
  },
});
