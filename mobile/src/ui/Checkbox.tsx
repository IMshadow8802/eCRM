import { Pressable, StyleSheet, View } from "react-native";
import { Check } from "lucide-react-native";

import { colors, radius, spacing } from "../theme";

export interface CheckboxProps {
  checked: boolean;
  onPress?: () => void;
  /** Announced by screen readers — the thing being ticked, not "checkbox". */
  accessibilityLabel?: string;
}

const BOX = 22;

/**
 * A real checkbox: an empty rounded square that fills solid when ticked.
 *
 * Not a lucide `Circle` / `CircleCheck` pair, which is what this replaced. Those
 * are STATUS icons — they say "this is done", the same way the green check on a
 * task card does. A checkbox says "you can change this", and the difference
 * matters on a screen where every row is tappable: an outline square reads as an
 * empty slot waiting to be filled, where an outline circle reads as a bullet.
 *
 * The fill is what carries "done", which is why the label beside it needs no
 * strikethrough.
 *
 * Rendered without a Pressable when `onPress` is absent — a viewer gets the
 * state without a control that does nothing.
 */
export function Checkbox({ checked, onPress, accessibilityLabel }: CheckboxProps) {
  const box = (
    <View style={[styles.box, checked ? styles.checked : styles.idle]}>
      {checked ? <Check size={14} color={colors.textOnBrand} strokeWidth={3} /> : null}
    </View>
  );

  if (!onPress) return box;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={spacing[2]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      // Sinks into the press rather than tinting — the same physics as every
      // other control here, and a tint would fight the fill that means "done".
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {box}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: BOX,
    height: BOX,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  idle: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  checked: { backgroundColor: colors.success },
  pressed: { transform: [{ scale: 0.9 }] },
});

export default Checkbox;
