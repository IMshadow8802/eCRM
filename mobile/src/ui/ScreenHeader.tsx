import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "../theme";
import { Text } from "./Text";

export interface ScreenHeaderAction {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  label: string;
}

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ScreenHeaderAction[];
}

/**
 * The bar on a PUSHED screen — task detail, a board. Tabs use their own big
 * in-page title instead (see the greeting header on My Work).
 *
 * Its padding is deliberately tight at the bottom: the screen's own content
 * padding sits directly under it, and the two stack. Header bottom + content
 * top used to add to 32px, which read as a gap rather than as spacing.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  actions,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={spacing[2]}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
      ) : null}

      <View style={styles.titleBlock}>
        <Text variant="h3" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {actions?.map((action) => (
        <Pressable
          key={action.label}
          onPress={action.onPress}
          accessibilityLabel={action.label}
          accessibilityRole="button"
          hitSlop={spacing[2]}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <MaterialIcons name={action.icon} size={22} color={colors.text} />
        </Pressable>
      ))}
    </View>
  );
}

const BUTTON = 42;

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  back: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  backPressed: { backgroundColor: colors.surfacePressed },
  titleBlock: { flex: 1 },
});

export default ScreenHeader;
