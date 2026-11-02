import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { colors, fontScaleCap, typography, variantScaleGroup, type FontScaleGroup, type TypographyVariant } from "../theme";

export interface TextProps extends RNTextProps {
  /** Picks size, weight, line-height and default colour from the type scale. */
  variant?: TypographyVariant;
  /** Semantic colour override. Use a token name, never a hex string. */
  color?: keyof typeof colors;
  align?: "auto" | "left" | "right" | "center";
  /** Tabular figures, so counts and times line up in columns. */
  tabular?: boolean;
  /** Overrides the variant's font-scale cap group (chrome for chips and counts). */
  scaleCap?: FontScaleGroup;
}

/**
 * The ONLY way to render text in this app. Never import Text from react-native
 * in a screen. Weight comes from the variant's fontFamily: React Native cannot
 * synthesise weights for a custom font.
 *
 * Accessibility text sizes still apply, up to a cap per group (body 1.3,
 * chrome 1.15, figures 1.2) — past it a bar label or chip cannot reflow.
 */
export function Text({
  variant = "text",
  color,
  align,
  tabular,
  scaleCap,
  style,
  maxFontSizeMultiplier,
  ...rest
}: TextProps) {
  const group = scaleCap ?? variantScaleGroup[variant] ?? "body";
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? fontScaleCap[group]}
      style={[
        typography[variant],
        tabular ? { fontVariant: ["tabular-nums"] } : null,
        color ? { color: colors[color] } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}

export default Text;
