import { StyleSheet } from "react-native";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";

import { colors } from "../theme";

/**
 * Spacing of the ruling, in points. Wide enough that the lines never read as a
 * texture pattern on a phone held at arm's length, tight enough that a card
 * always sits on several of them rather than between two.
 */
const PITCH = 14;

/**
 * The page texture — fine diagonal ruling behind every screen.
 *
 * A flat warm field is fine on one card but reads as empty on a board, where
 * most of the screen is background. Ruling gives the eye something to register
 * the surface by, so the cards read as sitting ON something rather than
 * floating in a void.
 *
 * Drawn in SVG rather than shipped as an image: it scales to any screen, costs
 * nothing to change, and the colour comes from the same token file as
 * everything else. `react-native-svg` is already a dependency (lucide needs
 * it), so this adds no native module.
 *
 * Diagonal, not horizontal or vertical: at 45° the ruling never lines up with
 * a card edge, a divider or a row of text, so it cannot be mistaken for one.
 */
export function BackgroundPattern() {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      // Purely decorative — it must never intercept a touch or be announced.
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <Pattern
          id="ruling"
          width={PITCH}
          height={PITCH}
          patternUnits="userSpaceOnUse"
        >
          {/* Two strokes per tile: the diagonal, plus the corner piece that
              continues it into the next tile. Without the second the line
              breaks at every tile boundary. */}
          <Path
            d={`M0 ${PITCH} L${PITCH} 0`}
            stroke={colors.patternLine}
            strokeWidth={1}
          />
          <Path
            d={`M-1 1 L1 -1 M${PITCH - 1} ${PITCH + 1} L${PITCH + 1} ${PITCH - 1}`}
            stroke={colors.patternLine}
            strokeWidth={1}
          />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#ruling)" />
    </Svg>
  );
}

export default BackgroundPattern;
