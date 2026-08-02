import { Pressable, StyleSheet, View } from "react-native";
import { ArrowLeft, type LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, shadows, spacing, SCREEN_PADDING, HIT_TARGET } from "../theme";
import { Text } from "./Text";

export interface ScreenHeaderAction {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
}

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ScreenHeaderAction[];
  /**
   * Semantic token for the subtitle's leading dot. Defaults to the brand
   * colour; Support passes `danger` so its screens read as a different module
   * at a glance.
   *
   * There is deliberately NO context glyph here. A circular icon next to the
   * circular back button reads as two buttons, and the title already says what
   * the screen is — the glyph was decoration competing with the one control the
   * user actually needs to find.
   */
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
          <ArrowLeft size={23} strokeWidth={2.75} color={colors.textOnBrand} />
        </Pressable>
      ) : null}

      <View style={styles.titleBlock}>
        {/* h2, not h3. A pushed screen's title is the largest thing on it —
            at h3 it sat below the card titles further down the page, which
            made the header read as a toolbar rather than as the screen's
            name. */}
        <Text variant="h2" numberOfLines={1}>
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
          <action.icon size={21} strokeWidth={2.5} color={colors.text} />
        </Pressable>
      ))}
    </View>
  );
}

const BUTTON = HIT_TARGET;

/**
 * The extruded edge under each header button. A solid darker rim along the
 * bottom is what makes a circle read as a raised object rather than a coloured
 * dot — it is the shading you would see on the side of something standing off
 * the page. Solid colour, no alpha; the house rule holds here too.
 */
const BEVEL = 3;

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[3],
    // No fill. A solid bar cuts the page in two and stops the ruling dead at
    // its edge; the hairline below is enough to separate the header from the
    // content, and the texture then runs top to bottom as one sheet.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  /**
   * Solid brand circle — back is the one control the user always needs to
   * find, and a bordered white shape on a white bar is invisible.
   *
   * Raised, not flat: the bevel below plus a shadow lifts it, and pressing
   * translates it down by the bevel so the button visibly sinks onto the page
   * instead of merely changing colour. `paddingTop` cancels the border's bite
   * out of the content box, or the arrow rides high inside the circle.
   */
  back: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    borderBottomWidth: BEVEL,
    borderBottomColor: colors.primaryPressed,
    paddingTop: BEVEL,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.md,
  },
  backPressed: {
    backgroundColor: colors.primaryPressed,
    transform: [{ translateY: BEVEL - 1 }],
  },
  /** Same object, quieter material — a white cap with a stone rim. */
  action: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomWidth: BEVEL,
    borderBottomColor: colors.borderStrong,
    paddingTop: BEVEL - 1,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
  },
  actionPressed: {
    backgroundColor: colors.surfacePressed,
    transform: [{ translateY: BEVEL - 1 }],
  },
  titleBlock: { flex: 1, gap: spacing[1] },
  subtitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  dot: { width: 6, height: 6, borderRadius: radius.full },
});

export default ScreenHeader;
