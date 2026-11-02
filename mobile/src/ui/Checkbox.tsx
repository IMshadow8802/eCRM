import { Pressable, StyleSheet, View } from "react-native";
import { Check } from "lucide-react-native";

import { colors, metrics, radius, spacing } from "../theme";

export interface CheckboxProps {
  checked: boolean;
  onPress?: () => void;
  /** Announced by screen readers — the thing being ticked, not "checkbox". */
  accessibilityLabel?: string;
}

/**
 * A real checkbox (E 08): 22 square, radius 7. Idle is a 2 px ring; done is a
 * solid green fill with a white check (stroke 3). The fill carries "done".
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
      hitSlop={spacing[3]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {box}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: metrics.checkbox,
    height: metrics.checkbox,
    borderRadius: radius.check,
    alignItems: "center",
    justifyContent: "center",
  },
  idle: { borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  checked: { backgroundColor: colors.success },
  pressed: { transform: [{ scale: 0.9 }] },
});

export default Checkbox;
