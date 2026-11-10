import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Hexagon, Plus } from "lucide-react-native";

import useAuthStore from "../stores/useAuthStore";
import { colors, metrics, radius, spacing } from "../theme";
import { Avatar, Text } from "../ui";
import { NavItem } from "./BottomBar";
import type { RailItem } from "./tabs";

export interface RailProps {
  items: RailItem[];
  active: RailItem | null;
  onPress: (item: RailItem) => void;
  badges: Partial<Record<RailItem, number>>;
  /** The "+" tile: the Create sheet (or the one module's form). */
  /** Omitted when the role can add to nothing: no "+" at all. */
  onCreate?: () => void;
  createLabel: string;
}

/**
 * The tablet rail (E `.nr`, T1–T4): logo, "+", the items, a spacer, then
 * More as the user's avatar. It sits outside the stack, so forms keep it.
 */
export function Rail({ items, active, onPress, badges, onCreate, createLabel }: RailProps) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const main = items.filter((i) => i !== "More");
  return (
    <View testID="rail" accessibilityRole="tablist" style={[styles.rail, { paddingTop: insets.top + spacing[2] }]}>
      {/* Not tappable (proposed): it is the brand, not a destination. */}
      <View style={styles.logo}>
        <Hexagon size={24} color={colors.textOnBrand} />
      </View>
      {onCreate ? (
        <Pressable
          onPress={onCreate}
          accessibilityRole="button"
          accessibilityLabel={createLabel}
          style={({ pressed }) => [styles.create, pressed && styles.createPressed]}
        >
          <Plus size={24} color={colors.textOnBrand} />
        </Pressable>
      ) : null}
      {main.map((item) => (
        <NavItem key={item} item={item} layout="rail" on={item === active} badge={badges[item]} onPress={() => onPress(item)} />
      ))}
      <View style={styles.spacer} />
      {items.includes("More") ? (
        <Pressable
          onPress={() => onPress("More")}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === "More" }}
          accessibilityLabel="More"
          style={[styles.more, { marginBottom: insets.bottom + spacing[2] }]}
        >
          {active === "More" ? <View style={styles.mark} /> : null}
          <Avatar name={user?.FullName} uri={user?.Avatar} userId={user?.Id} size={36} ring="bandField" />
          <Text variant={active === "More" ? "navLabelActive" : "navLabel"}>More</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: metrics.railWidth, backgroundColor: colors.band, alignItems: "center" },
  logo: {
    width: metrics.railLogo,
    height: metrics.railLogo,
    borderRadius: radius.badgeLg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  create: {
    width: metrics.railNew,
    height: metrics.railNew,
    borderRadius: radius.card,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[2],
  },
  createPressed: { backgroundColor: colors.primaryPressed },
  spacer: { flex: 1 },
  more: { width: metrics.railWidth, height: metrics.railItem, alignItems: "center", justifyContent: "center", gap: 3 },
  mark: {
    position: "absolute",
    left: 0,
    top: 14,
    bottom: 14,
    width: metrics.navIndicator.thickness,
    backgroundColor: colors.bandMark,
    borderTopRightRadius: radius.mark,
    borderBottomRightRadius: radius.mark,
  },
});
