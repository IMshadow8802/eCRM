import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import { colors, radius, spacing, CONTROL_HEIGHT } from "../theme";
import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "style" | "children"> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: keyof typeof MaterialIcons.glyphMap;
  fullWidth?: boolean;
  style?: ViewStyle;
}

const BG: Record<ButtonVariant, string> = {
  primary: colors.primary,
  secondary: colors.surfaceMuted,
  ghost: "transparent",
  danger: colors.danger,
};

const FG: Record<ButtonVariant, keyof typeof colors> = {
  primary: "textOnBrand",
  secondary: "text",
  ghost: "primary",
  danger: "textOnBrand",
};

// md matches CONTROL_HEIGHT exactly so a button lines up with an Input beside it.
const HEIGHT: Record<ButtonSize, number> = {
  sm: 38,
  md: CONTROL_HEIGHT,
  lg: 56,
};

export function Button({
  title,
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  fullWidth = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const fg = FG[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          backgroundColor: BG[variant],
        },
        isDisabled && styles.disabled,
        variant === "ghost" && styles.ghost,
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "secondary" ? colors.text : colors.textOnBrand}
        />
      ) : (
        <View style={styles.content}>
          {icon ? (
            <MaterialIcons
              name={icon}
              size={size === "sm" ? 16 : 18}
              color={colors[fg]}
            />
          ) : null}
          <Text variant="button" color={fg} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[5],
  },
  ghost: { paddingHorizontal: spacing[2] },
  // Dim the whole control instead of recolouring it: the label stays legible
  // and it still reads as a button.
  disabled: { opacity: 0.45 },
  fullWidth: { alignSelf: "stretch" },
  pressed: { opacity: 0.75 },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
});

export default Button;
