import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, shadows, spacing } from "../theme";
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
  /** Context glyph beside the title — board type, record kind. */
  icon?: keyof typeof MaterialIcons.glyphMap;
  /** Semantic token for the glyph fill. Defaults to the brand colour. */
  tint?: keyof typeof colors;
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
  icon,
  tint = "primary",
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
          <MaterialIcons
            name="arrow-back"
            size={22}
            color={colors.textOnBrand}
          />
        </Pressable>
      ) : null}

      {icon ? (
        <View style={[styles.glyph, { backgroundColor: colors[tint] }]}>
          <MaterialIcons name={icon} size={18} color={colors.textOnBrand} />
        </View>
      ) : null}

      <View style={styles.titleBlock}>
        <Text variant="h3" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <View style={styles.subtitleRow}>
            <View style={[styles.dot, { backgroundColor: colors[tint] }]} />
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        ) : null}
      </View>

      {actions?.map((action) => (
        <Pressable
          key={action.label}
          onPress={action.onPress}
          accessibilityLabel={action.label}
          accessibilityRole="button"
          hitSlop={spacing[2]}
          style={({ pressed }) => [
            styles.action,
            pressed && styles.actionPressed,
          ]}
        >
          <MaterialIcons name={action.icon} size={20} color={colors.text} />
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
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Solid brand circle. A bordered white square on a white bar is invisible,
  // and back is the one control here the user always needs to find.
  back: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
  },
  backPressed: { backgroundColor: colors.primaryPressed },
  glyph: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  action: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPressed: { backgroundColor: colors.surfacePressed },
  titleBlock: { flex: 1 },
  subtitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  dot: { width: 6, height: 6, borderRadius: radius.full },
});

export default ScreenHeader;
