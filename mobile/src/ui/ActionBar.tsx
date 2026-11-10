import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LucideIcon } from "lucide-react-native";

import { colors, metrics, radius, spacing } from "../theme";
import { Text } from "./Text";

export interface BarAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  /** The one filled action (Resolve, Log follow-up). */
  main?: boolean;
  disabled?: boolean;
}

export interface ActionBarProps {
  actions: BarAction[];
}

/** E caps a record's bar at five actions; extras belong in the ⋮ menu. */
const MAX_BAR_ACTIONS = 5;

/**
 * The record's action bar (E 11, 15): the bottom bar's navy, with the record's
 * actions in place of the tabs. The main action is a primary pill. Rendered by
 * the Shell from what the screen publishes with `useActionBar`.
 */
export function ActionBar({ actions }: ActionBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="action-bar"
      accessibilityRole="toolbar"
      style={[styles.bar, { height: metrics.bottomBarContent + insets.bottom, paddingBottom: insets.bottom }]}
    >
      {actions.slice(0, MAX_BAR_ACTIONS).map((a) => {
        const ink = a.disabled ? colors.bandField : a.main ? colors.textOnBrand : colors.onBandMuted;
        return (
          <Pressable
            key={a.key}
            onPress={a.onPress}
            disabled={a.disabled}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityState={{ disabled: !!a.disabled }}
            style={({ pressed }) => [styles.item, a.main && styles.mainItem, pressed && styles.sink]}
          >
            {a.main ? (
              <View testID="action-main" style={styles.mainPill}>
                <a.icon size={22} color={colors.textOnBrand} />
              </View>
            ) : (
              <a.icon size={22} color={ink} />
            )}
            <Text
              variant={a.main ? "navLabelActive" : "navLabel"}
              numberOfLines={1}
              style={{ color: ink }}
            >
              {a.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: colors.band, paddingHorizontal: spacing[1] },
  item: { flex: 1, alignItems: "center", paddingTop: 10, gap: spacing[1] },
  mainItem: { paddingTop: metrics.inlineGap },
  mainPill: {
    width: metrics.navMain.width,
    height: metrics.navMain.height,
    borderRadius: radius.bar,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sink: { transform: [{ scale: 0.97 }] },
});

export default ActionBar;
