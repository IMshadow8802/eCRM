import { StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

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
  icon?: keyof typeof MaterialIcons.glyphMap;
}

/** Small status pill — priority, due state, counts, member roles. */
export function Chip({ label, tone = "neutral", icon }: ChipProps) {
  return (
    <View style={[styles.chip, { backgroundColor: BG[tone] }]}>
      {icon ? <MaterialIcons name={icon} size={12} color={colors[FG[tone]]} /> : null}
      <Text variant="caption" color={FG[tone]}>
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
