import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import {
  colors,
  radius,
  shadows,
  spacing,
  TAB_BAR_HEIGHT,
} from "../theme";
import { Text } from "../ui";

/**
 * Icons live here rather than in each screen's options: with a custom tab bar
 * React Navigation has no per-route icon option, and augmenting its options
 * type is not possible (it is a type alias, not an interface).
 */
const TAB_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  MyWork: "check-circle-outline",
  Boards: "view-column",
  Me: "person-outline",
};

/**
 * Custom floating tab bar.
 *
 * React Navigation's default stacks an icon over a label in every item, which
 * inside a rounded pill gives three columns of different widths, text crowding
 * the rounded ends, and no vertical rhythm.
 *
 * Instead: inactive tabs are icon-only and identically sized, and only the
 * ACTIVE tab expands into a white pill with its label. The row stays balanced
 * whatever the labels are, and the selected tab is unmistakable — which is the
 * label's only real job here.
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
        const icon = TAB_ICONS[route.name] ?? "circle";

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
            style={({ pressed }) => [
              styles.item,
              focused && styles.itemActive,
              pressed && !focused && styles.itemPressed,
            ]}
          >
            <MaterialIcons
              name={icon}
              size={22}
              color={focused ? colors.primary : colors.textOnBrandMuted}
            />
            {focused ? (
              <Text variant="label" color="primary" numberOfLines={1}>
                {label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing[5],
    right: spacing[5],
    height: TAB_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    ...shadows.lg,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    height: 44,
    // Inactive items are square, so the row reads as evenly spaced regardless
    // of how long the labels are.
    width: 44,
    borderRadius: radius.full,
  },
  itemActive: {
    width: "auto",
    paddingHorizontal: spacing[4],
    backgroundColor: colors.surface,
  },
  itemPressed: { backgroundColor: colors.primaryPressed },
});
