import { StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { colors, radius } from "../theme";

/**
 * A solid circular tile with an icon in it — the leading mark on task cards,
 * complaint cards, workspace cards, attachment rows and the hub's menu rows.
 *
 * All five hand-rolled the identical View: a fixed square, `radius.full`,
 * centred both ways, a tint passed inline and `textOnBrand` on the icon. The
 * only real variation was size, and even that was three values pretending to
 * be five (36/18, 38/19 and 42/20 box/icon pairs, with one row using a 38 box
 * around a 20 icon — see below).
 *
 * `icon` is a component, not a name: lucide icons are components and a prop
 * that takes one is typed LucideIcon (§9.4).
 *
 * `tint` is a semantic colour token, never a literal — the call sites pass
 * `colors.primary`, `colors[entry.tint]` and so on, and eslint rejects a hex.
 */

const SIZES = {
  sm: { box: 36, icon: 18 },
  md: { box: 38, icon: 19 },
  lg: { box: 42, icon: 20 },
} as const;

export type GlyphSize = keyof typeof SIZES;

export interface GlyphProps {
  icon: LucideIcon;
  /** A semantic colour from the theme — the tile is SOLID, never translucent. */
  tint: string;
  size?: GlyphSize;
}

export function Glyph({ icon: Icon, tint, size = "lg" }: GlyphProps) {
  const { box, icon } = SIZES[size];
  return (
    <View
      style={[styles.tile, { width: box, height: box, backgroundColor: tint }]}
    >
      <Icon size={icon} color={colors.textOnBrand} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default Glyph;
