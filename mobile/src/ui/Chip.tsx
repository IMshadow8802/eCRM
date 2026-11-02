import { Pressable, StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { chipTones, HIT_TARGET, type ChipTone, type TypographyVariant } from "../theme";
import { Text } from "./Text";

export type { ChipTone };
export type ChipSize = "xs" | "sm" | "md" | "lg";

export interface ChipProps {
  label?: string;
  /** Sorbet pair from `chipTones` (E §1.4): soft solid fill, dark ink of the same hue. */
  tone?: ChipTone;
  icon?: LucideIcon;
  size?: ChipSize;
  /** A 22 × 22 icon-only chip — the complaint priority flag. Needs an accessibilityLabel. */
  iconOnly?: boolean;
  accessibilityLabel?: string;
  /** Caps the width and truncates — for labels a company can type freely. */
  maxWidth?: number;
  onPress?: () => void;
}

/** size → height, horizontal padding, text variant, icon (E §3.7). */
export const CHIP_SIZES: Record<ChipSize, { height: number; padH: number; variant: TypographyVariant; icon: number }> = {
  xs: { height: 18, padH: 9, variant: "label", icon: 12 },
  sm: { height: 22, padH: 9, variant: "label", icon: 12 },
  md: { height: 28, padH: 12, variant: "metaStrong", icon: 14 },
  lg: { height: 32, padH: 12, variant: "metaStrong", icon: 14 },
};

/**
 * The pill — status, priority, due state, TAT, roles. A screen picks a tone,
 * never a colour. A pressable chip sinks (scale 0.97) and reaches the 44 dp
 * target through hitSlop.
 */
export function Chip({
  label, tone = "slate", icon: Icon, size = "sm", iconOnly = false, accessibilityLabel, maxWidth, onPress,
}: ChipProps) {
  const { fill, text } = chipTones[tone];
  const s = CHIP_SIZES[size];
  const shape = {
    height: s.height,
    borderRadius: s.height / 2,
    backgroundColor: fill,
    ...(iconOnly ? { width: s.height } : { paddingHorizontal: s.padH }),
    ...(maxWidth != null ? { maxWidth } : null),
  };
  const body = (
    <>
      {Icon ? <Icon size={s.icon} color={text} /> : null}
      {!iconOnly && label ? (
        <Text
          variant={s.variant}
          scaleCap="chrome"
          numberOfLines={1}
          // xs is 11/600 (E's "Custom" tag); the variant is 12.
          style={[styles.label, { color: text }, size === "xs" && styles.xs]}
        >
          {label}
        </Text>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel} style={[styles.chip, shape]}>
        {body}
      </View>
    );
  }
  const slop = Math.max(0, (HIT_TARGET - s.height) / 2);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={slop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.chip, shape, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, alignSelf: "flex-start" },
  // Without flexShrink a long label overflows a maxWidth pill instead of truncating.
  label: { flexShrink: 1 },
  xs: { fontSize: 11, lineHeight: 14 },
  pressed: { transform: [{ scale: 0.97 }] },
});

export default Chip;
