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
 * Filled when selected, outlined when not — the weight change is what carries
 * the state alongside the colour, so it still reads without relying on hue.
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
 * Floating tab bar in the Apple Music shape: a detached rounded bar where every
 * tab shows its icon above its label in an equal-width column, and the selected
 * one is marked by colour rather than by a pill behind it.
 *
 * Solid surface rather than glass — translucency is out per the design rules,
 * and a solid bar keeps the labels legible over whatever is scrolling beneath.
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
            <MaterialIcons
              name={focused ? (icons?.on ?? "circle") : (icons?.off ?? "circle")}
              size={24}
              color={focused ? colors.primary : colors.textMuted}
            />
            <Text
              variant="caption"
              color={focused ? "primary" : "textMuted"}
              numberOfLines={1}
            >
              {label}
            </Text>
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
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface,
    ...shadows.lg,
  },
  // Equal-width columns, so the row is symmetric whatever the labels say.
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    height: "100%",
  },
});
