import { Pressable, StyleSheet, View } from "react-native";
import { ChevronDown, type LucideIcon } from "lucide-react-native";

import { colors, HIT_TARGET, metrics, spacing, type ColorKey } from "../theme";
import { CountBadge } from "./CountBadge";
import { Text } from "./Text";

export interface IconButtonProps {
  icon: LucideIcon;
  /** Required: an icon alone says nothing to a screen reader. */
  accessibilityLabel: string;
  onPress: () => void;
  /** `ghost` is the band's back/close: transparent, 36 wide, pulled 8 into the gutter. */
  variant?: "filled" | "ghost";
  /** A coral count at the corner (the bell). */
  badge?: number;
  disabled?: boolean;
  testID?: string;
}

/** The round band button (E `.ib`): 40, `bandRaised`, white icon 20. Pressed: `bandField`. */
export function IconButton({
  icon: Icon, accessibilityLabel, onPress, variant = "filled", badge, disabled, testID,
}: IconButtonProps) {
  const ghost = variant === "ghost";
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={ghost ? spacing[1] : 2}
      style={({ pressed }) => [
        styles.ib,
        ghost ? styles.ghost : styles.filled,
        pressed && styles.pressed,
      ]}
    >
      <Icon size={ghost ? 24 : 20} color={colors.textOnBrand} />
      {badge ? <CountBadge count={badge} style={styles.badge} /> : null}
    </Pressable>
  );
}

export interface HeaderButtonProps {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  /** `ghost` = Navy 800 (or Navy 700 on a raised band); default is filled primary. */
  variant?: "primary" | "ghost";
  /** The band it sits on, so a ghost button stays one step lighter. */
  on?: "band" | "raised";
  /** 28 tall with a trailing chevron ("Change status", 15). */
  small?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/** The pill button in the band (E `.hbtn`): "+ New", "Save lead", "Mark all read". */
export function HeaderButton({
  label, icon: Icon, onPress, variant = "primary", on = "band", small = false, disabled, accessibilityLabel,
}: HeaderButtonProps) {
  const fill: ColorKey = variant === "primary" ? "primary" : on === "raised" ? "bandField" : "bandRaised";
  const pressedFill: ColorKey = variant === "primary" ? "primaryPressed" : on === "raised" ? "bandRaised" : "bandField";
  const height = small ? metrics.headerButtonSmall : metrics.headerButtonHeight;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={(HIT_TARGET - height) / 2}
      style={({ pressed }) => [
        styles.hbtn,
        small ? styles.hbtnSmall : variant === "ghost" ? styles.hbtnGhost : null,
        { height, borderRadius: height / 2, backgroundColor: colors[pressed ? pressedFill : fill] },
        disabled && styles.disabled,
      ]}
    >
      {Icon ? <Icon size={small ? 16 : 18} color={colors.textOnBrand} /> : null}
      <Text variant={small ? "metaStrong" : "rowTitle"} color={disabled ? "disabledText" : "textOnBrand"} numberOfLines={1}>
        {label}
      </Text>
      {small ? <ChevronDown size={16} color={colors.textOnBrand} /> : null}
    </Pressable>
  );
}

export interface CircleActionProps {
  icon: LucideIcon;
  accessibilityLabel: string;
  onPress: () => void;
  tone?: "success" | "primary";
  /** 44 (complaint, 11) or 40 (lead, 15 / T3). */
  size?: 40 | 44;
}

/** The round call/message action on a contact card. */
export function CircleAction({ icon: Icon, accessibilityLabel, onPress, tone = "success", size = 44 }: CircleActionProps) {
  const pressed: ColorKey = tone === "success" ? "successText" : "primaryPressed";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={(HIT_TARGET - size) / 2}
      style={({ pressed: p }) => [
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors[p ? pressed : tone] },
      ]}
    >
      <View>
        <Icon size={size === 44 ? 20 : 18} color={colors.textOnBrand} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ib: { alignItems: "center", justifyContent: "center", height: metrics.iconButton, borderRadius: metrics.iconButton / 2 },
  filled: { width: metrics.iconButton, backgroundColor: colors.bandRaised },
  ghost: { width: metrics.iconButtonGhost, marginLeft: -8, backgroundColor: colors.transparentBorder },
  pressed: { backgroundColor: colors.bandField },
  badge: { position: "absolute", top: -5, right: -8 },
  hbtn: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap, paddingLeft: spacing[3], paddingRight: 14 },
  hbtnGhost: { paddingLeft: 14 },
  hbtnSmall: { paddingLeft: spacing[3], paddingRight: 10 },
  disabled: { backgroundColor: colors.disabledBg },
  circle: { alignItems: "center", justifyContent: "center" },
});
