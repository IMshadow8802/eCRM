import { StyleSheet, View } from "react-native";

import type { LucideIcon } from "lucide-react-native";

import { chipTones, radius, spacing, type ChipTone } from "../theme";
import { Text } from "./Text";

export type { ChipTone };

export interface ChipProps {
  label: string;
  /** "Sorbet" pair from `chipTones`: soft solid fill, dark ink of the same hue. */
  tone?: ChipTone;
  icon?: LucideIcon;
  /** Caps the width and truncates — for labels a company can type freely. */
  maxWidth?: number;
}

/**
 * Small status pill — status, priority, due state, TAT, roles. The only chip in
 * the app: a screen picks a tone, never a colour.
 */
export function Chip({ label, tone = "neutral", icon: Icon, maxWidth }: ChipProps) {
  const { fill, text } = chipTones[tone];

  return (
    <View style={[styles.chip, { backgroundColor: fill }, maxWidth != null && { maxWidth }]}>
      {Icon ? <Icon size={12} color={text} /> : null}
      <Text
        variant="caption"
        numberOfLines={1}
        // Without flexShrink a long label overflows a maxWidth pill instead of truncating.
        style={[styles.label, { color: text }]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    alignSelf: "flex-start",
  },
  label: { flexShrink: 1 },
});

export default Chip;
