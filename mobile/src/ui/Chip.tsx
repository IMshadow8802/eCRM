import { StyleSheet, View } from "react-native";

import type { LucideIcon } from "lucide-react-native";

import { colors, radius, spacing } from "../theme";
import { Text } from "./Text";

export type ChipTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const BG: Record<ChipTone, string> = {
  neutral: colors.surfaceSunken,
  primary: colors.primarySoft,
  success: colors.successSoft,
  warning: colors.warningSoft,
  danger: colors.dangerSoft,
  info: colors.infoSoft,
};

const FG: Record<ChipTone, keyof typeof colors> = {
  neutral: "textSecondary",
  primary: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

export interface ChipProps {
  label: string;
  tone?: ChipTone;
  icon?: LucideIcon;
  /**
   * A solid fill in an arbitrary colour, with white on it — overrides `tone`.
   *
   * For colours that come from DATA rather than from the palette: a pipeline
   * stage carries its own hex in `tblPipelineStage.Color`, so a company that
   * recolours its board on the web sees it here without a release. `tone`
   * cannot express that, because its six values are fixed at build time.
   */
  color?: string;
  /** Caps the width and truncates — for labels a company can type freely. */
  maxWidth?: number;
}

/** Small status pill — stage, priority, due state, member roles. */
export function Chip({
  label,
  tone = "neutral",
  icon: Icon,
  color,
  maxWidth,
}: ChipProps) {
  const ink = color ? colors.textOnBrand : colors[FG[tone]];

  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: color ?? BG[tone] },
        maxWidth != null && { maxWidth },
      ]}
    >
      {Icon ? <Icon size={12} color={ink} /> : null}
      <Text
        variant="caption"
        color={color ? "textOnBrand" : FG[tone]}
        numberOfLines={1}
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
});

export default Chip;
