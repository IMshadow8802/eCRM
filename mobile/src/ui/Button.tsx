import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { colors, HIT_TARGET, metrics, spacing, type ColorKey, type TypographyVariant } from "../theme";
import { Text } from "./Text";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  /** White on the indigo hero ("Explain delay", 09). */
  | "onBrand"
  /** Green fill (the labelled "Call", T2). */
  | "success"
  /** Text-only, in brand indigo ("Decline" next to Accept). */
  | "ghost";
/** md 48 · sm 36 · xs 32 (E `.btn`, `.btn.sm`, Accept in 06). `lg` is retired and draws as md. */
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "style" | "children"> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  /** After the label ("Continue →", E 01). */
  trailingIcon?: LucideIcon;
  fullWidth?: boolean;
  style?: ViewStyle;
}

/** variant → [fill, pressed fill, text] — all solid (spec §1.2 pressed states). */
const PAINT: Record<ButtonVariant, [ColorKey, ColorKey, ColorKey]> = {
  primary: ["primary", "primaryPressed", "textOnBrand"],
  secondary: ["secondaryFill", "secondaryPressed", "text"],
  danger: ["danger", "dangerText", "textOnBrand"],
  onBrand: ["surface", "fieldTint", "primary"],
  success: ["success", "successText", "textOnBrand"],
  ghost: ["transparentBorder", "fieldTint", "primary"],
};

const SIZE: Record<ButtonSize, { height: number; padH: number; variant: TypographyVariant; icon: number }> = {
  md: { height: metrics.buttonHeight.md, padH: spacing[5], variant: "bodyStrong", icon: 18 },
  lg: { height: metrics.buttonHeight.md, padH: spacing[5], variant: "bodyStrong", icon: 18 },
  sm: { height: metrics.buttonHeight.sm, padH: spacing[4], variant: "rowTitle", icon: 16 },
  xs: { height: metrics.buttonHeight.xs, padH: 14, variant: "metaStrong", icon: 14 },
};

/**
 * The pill button (E `.btn`). Disabled is the solid `disabledBg` fill, never
 * an opacity; pressed is a solid darker fill.
 */
export function Button({
  title,
  variant = "primary",
  size = "md",
  loading = false,
  icon: Icon,
  trailingIcon: Trailing,
  fullWidth = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const [fill, pressedFill, ink] = PAINT[variant];
  const s = SIZE[size];
  const fg: ColorKey = isDisabled && !loading ? "disabledText" : ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      // sm 36 and xs 32 reach the 44 dp target without growing.
      hitSlop={Math.max(0, (HIT_TARGET - s.height) / 2)}
      style={({ pressed }) => [
        styles.base,
        { height: s.height, borderRadius: s.height / 2, paddingHorizontal: s.padH, backgroundColor: colors[fill] },
        isDisabled && !loading && styles.disabled,
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && { backgroundColor: colors[pressedFill] },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={colors[ink]} />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={s.icon} color={colors[fg]} /> : null}
          <Text variant={s.variant} color={fg} numberOfLines={1}>
            {title}
          </Text>
          {Trailing ? <Trailing size={s.icon} color={colors[fg]} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  disabled: { backgroundColor: colors.disabledBg },
  fullWidth: { alignSelf: "stretch" },
  content: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
});
