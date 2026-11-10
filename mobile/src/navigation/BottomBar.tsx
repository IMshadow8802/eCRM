import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { badgeTones, colors, metrics, moduleTones, radius, spacing } from "../theme";
import { CountBadge, Text } from "../ui";
import { NAV_ITEMS, type RailItem } from "./tabs";

export interface BottomBarProps<T extends RailItem = RailItem> {
  tabs: T[];
  active: T | null;
  onPress: (tab: T) => void;
  badges: Partial<Record<RailItem, number>>;
}

/**
 * The docked navy bar (E `.tb`, 3.3): 58 + the home-indicator inset. The
 * active item is white over a 3 px indicator, its icon in a pill of the
 * module's tone. Replaces FloatingTabBar.
 */
export function BottomBar<T extends RailItem>({ tabs, active, onPress, badges }: BottomBarProps<T>) {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="bottom-bar"
      accessibilityRole="tablist"
      style={[styles.bar, { height: metrics.bottomBarContent + insets.bottom, paddingBottom: insets.bottom }]}
    >
      {tabs.map((tab) => (
        <NavItem key={tab} item={tab} on={tab === active} badge={badges[tab]} onPress={() => onPress(tab)} layout="bar" />
      ))}
    </View>
  );
}

/** One bar or rail item: pill + label, indicator and badge when due. */
export function NavItem({
  item, on, badge, onPress, layout,
}: { item: RailItem; on: boolean; badge?: number; onPress: () => void; layout: "bar" | "rail" }) {
  const { label, module, icon: Icon } = NAV_ITEMS[item];
  const tone = badgeTones[moduleTones[module].badge];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      accessibilityValue={badge ? { text: `${badge} new` } : undefined}
      style={({ pressed }) => [layout === "bar" ? styles.barItem : styles.railItem, pressed && styles.sink]}
    >
      {on ? <View testID={`indicator-${item}`} style={layout === "bar" ? styles.barMark : styles.railMark} /> : null}
      <View testID={`pill-${item}`} style={[styles.pill, on && { backgroundColor: tone.fill }]}>
        <Icon size={22} strokeWidth={2} color={on ? tone.ink : colors.onBandMuted} />
        {badge ? <CountBadge count={badge} style={styles.badge} /> : null}
      </View>
      <Text variant={on ? "navLabelActive" : "navLabel"} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: colors.band, paddingHorizontal: spacing[1] },
  barItem: { flex: 1, alignItems: "center", paddingTop: 9, gap: 3 },
  railItem: { width: metrics.railWidth, height: metrics.railItem, alignItems: "center", justifyContent: "center", gap: 3 },
  pill: {
    width: metrics.navPill.width,
    height: metrics.navPill.height,
    borderRadius: radius.bar,
    alignItems: "center",
    justifyContent: "center",
  },
  // Pill centre + 6: the pill is 48 wide, so its left edge + 30.
  badge: { position: "absolute", top: -4, left: metrics.navPill.width / 2 + 6 },
  barMark: {
    position: "absolute",
    top: 0,
    alignSelf: "center",
    width: metrics.navIndicator.length,
    height: metrics.navIndicator.thickness,
    backgroundColor: colors.bandMark,
    borderBottomLeftRadius: radius.mark,
    borderBottomRightRadius: radius.mark,
  },
  railMark: {
    position: "absolute",
    left: 0,
    top: 14,
    bottom: 14,
    width: metrics.navIndicator.thickness,
    backgroundColor: colors.bandMark,
    borderTopRightRadius: radius.mark,
    borderBottomRightRadius: radius.mark,
  },
  sink: { transform: [{ scale: 0.97 }] },
});
