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
  Work: { on: "grid-view", off: "grid-view" },
  Me: { on: "person", off: "person-outline" },
};

/**
 * Floating tab bar, in the same visual language as the rest of the app.
 *
 * An earlier version was a solid brand slab. It was the only large saturated
 * surface in an app built from white cards where colour appears as small solid
 * glyphs — so it read as imported from somewhere else.
 *
 * This is a white card like every other surface, lifted on the same shadow, and
 * the selected tab is marked by a solid brand glyph — exactly the treatment a
 * task card gives its type icon. It separates from the page by elevation and a
 * hairline, not by being loud.
 */
export default function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Explicit equal share. Flex will not do it here: React Native defaults
  // flexShrink to 0 (the web defaults to 1), so an item can never shrink below
  // its own content — and "My Work" is wider than "Boards" or "Profile", so it
  // kept claiming the extra space whatever flexBasis said.
  const itemWidth = `${100 / state.routes.length}%` as const;

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
            style={[styles.item, { width: itemWidth }]}
          >
            <View style={styles.stack}>
              <View style={[styles.glyph, focused && styles.glyphActive]}>
                <MaterialIcons
                  name={
                    focused ? (icons?.on ?? "circle") : (icons?.off ?? "circle")
                  }
                  size={focused ? 20 : 22}
                  color={focused ? colors.textOnBrand : colors.textMuted}
                />
              </View>
              <Text
                variant="caption"
                color={focused ? "primary" : "textMuted"}
                numberOfLines={1}
                style={styles.label}
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

const TAB_BAR_INSET = spacing[2];
/**
 * Half the height — a full stadium. Not radius.full: a huge value would clamp
 * per element, so the bar and the pill would each round to their own half-height
 * and stop being concentric. Deriving it keeps `BAR_RADIUS - INSET` exactly
 * equal to half the pill's height, which is the pill's own stadium radius.
 */
const BAR_RADIUS = TAB_BAR_HEIGHT / 2;
/**
 * Derived, not chosen. Letting the pill stretch inside a padded row left its
 * final height negotiated between padding, alignItems and flex — and it settled
 * a couple of pixels low, so the gap under it read thinner than the one above.
 * An explicit height makes the inset arithmetic: (bar - 2 x inset).
 */
const PILL_HEIGHT = TAB_BAR_HEIGHT - TAB_BAR_INSET * 2;

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing[4],
    right: spacing[4],
    height: TAB_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    // Inset on all sides so the active highlight reads as a pill sitting INSIDE
    // the bar rather than as a block the same height as it.
    padding: TAB_BAR_INSET,
    borderRadius: BAR_RADIUS,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.floating,
  },
  // Width is set inline from the route count — see itemWidth above.
  item: { height: PILL_HEIGHT, alignItems: "center", justifyContent: "center" },
  stack: {
    height: PILL_HEIGHT,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[1],
  },
  // Same treatment a task card gives its type icon: a solid colour circle with
  // a white glyph. Selection therefore looks native to this app rather than
  // like a control borrowed from another one.
  glyph: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphActive: { backgroundColor: colors.primary },
  // The caption's 16px line box leaves dead space under an 11px glyph, which
  // pushes the visual centre upward. Tightening it re-centres the pair.
  label: { maxWidth: "100%", lineHeight: 13 },
});
