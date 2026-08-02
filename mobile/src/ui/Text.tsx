import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { colors, typography, type TypographyVariant } from "../theme";

export interface TextProps extends RNTextProps {
  /** Picks size, weight, line-height and default colour from the type scale. */
  variant?: TypographyVariant;
  /** Semantic colour override. Use a token name, never a hex string. */
  color?: keyof typeof colors;
  align?: "auto" | "left" | "right" | "center";
}

/**
 * The ONLY way to render text in this app. Never import Text from react-native
 * in a screen — that is how font sizes and colours end up scattered.
 *
 * Weight comes from the variant's fontFamily, because React Native cannot
 * synthesise weights for a custom font: `fontWeight: "600"` on Poppins renders
 * as regular on Android.
 */
export function Text({
  variant = "body",
  color,
  align,
  style,
  ...rest
}: TextProps) {
  return (
    <RNText
      style={[
        typography[variant],
        color ? { color: colors[color] } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}

export default Text;
