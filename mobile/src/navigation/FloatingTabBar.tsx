import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { colors, radius, shadows, spacing, TAB_BAR_HEIGHT } from "../theme";
import { Text } from "../ui";

/**
 * Icons live here rather than in each screen's options: with a custom tab bar
 * React Navigation has no per-route icon option, and augmenting its options
 * type is not possible (it is a type alias, not an interface).
 *
 * Filled when selected, outlined when not, so the state reads through weight
 * as well as colour.
 */
const TAB_ICONS: Record<
  string,
  { on: keyof typeof MaterialIcons.glyphMap; off: keyof typeof MaterialIcons.glyphMap }
> = {
  MyWork: { on: "check-circle", off: "check-circle-outline" },
  Boards: { on: "dashboard", off: "dashboard-customize" },
  Me: { on: "person", off: "person-outline" },
};

/**
 * Floating tab bar, built on the Apple Music shape: a detached, heavily rounded
 * bar; every tab shows its icon above its label in an equal-width column; the
 * selected tab sits inside its own rounded highlight.
 *
 * Inverted from Apple's, though. Theirs is a pale bar with a pale highlight and
 * a coloured selection; ours is a SOLID BRAND bar with a white highlight,
 * because the page behind it is warm off-white and white cards — a pale bar
 * disappears into both. Solid also keeps the labels readable over whatever is
 * scrolling underneath, which a translucent one would not.
 */
export default function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.bar, { bottom: insets.bottom + spacing[2] }]}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]!;
        const focused = state.index === index;
        const label = options.title ?? route.name;
        const icons = TAB_ICONS[route.name];

        const onPress = () => {
          // Emit first: a screen may cancel navigation (scroll-to-top etc).
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={styles.item}
          >
            <View style={[styles.pill, focused && styles.pillActive]}>
              <MaterialIcons
                name={
                  focused ? (icons?.on ?? "circle") : (icons?.off ?? "circle")
                }
                size={22}
                color={focused ? colors.primary : colors.textOnBrand}
              />
              <Text
                variant="caption"
                color={focused ? "primary" : "textOnBrand"}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing[4],
    right: spacing[4],
    height: TAB_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[2],
    borderRadius: radius["2xl"],
    backgroundColor: colors.primary,
    ...shadows.lg,
  },
  // Equal-width columns, so the row stays symmetric whatever the labels say.
  item: { flex: 1, alignItems: "center", justifyContent: "center" },
  pill: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.lg,
    alignSelf: "stretch",
  },
  pillActive: { backgroundColor: colors.surface },
});
