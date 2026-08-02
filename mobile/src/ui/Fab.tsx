import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, shadows, spacing } from "../theme";
import { Text } from "./Text";

export interface FabProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  label?: string;
  /** Accessible name. Required when there is no visible label. */
  accessibilityLabel: string;
  loading?: boolean;
  /** Extra bottom offset — use when a composer or tab bar sits underneath. */
  offsetBottom?: number;
}

/**
 * Floating action button for the primary "add" on a screen.
 *
 * A full-width bar pinned to the bottom reads as chrome and steals a row from
 * the content; a FAB is one thumb-reachable target that stays out of the way.
 *
 * Pays its own safe-area inset — it sits at the bottom edge, where Android
 * draws its nav buttons.
 */
export function Fab({
  icon,
  onPress,
  label,
  accessibilityLabel,
  loading = false,
  offsetBottom = 0,
}: FabProps) {
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.fab,
        label ? styles.extended : styles.round,
        { bottom: insets.bottom + spacing[4] + offsetBottom },
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.textOnBrand} />
      ) : (
        <MaterialIcons name={icon} size={24} color={colors.textOnBrand} />
      )}
      {label ? (
        <Text variant="button" color="textOnBrand">
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: spacing[5],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    backgroundColor: colors.primary,
    ...shadows.lg,
  },
  round: { width: 56, height: 56, borderRadius: radius.full },
  extended: {
    height: 52,
    paddingHorizontal: spacing[5],
    borderRadius: radius.full,
  },
  pressed: { backgroundColor: colors.primaryPressed },
});

export default Fab;
