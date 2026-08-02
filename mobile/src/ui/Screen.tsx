import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";
import { BackgroundPattern } from "./BackgroundPattern";

export interface ScreenProps {
  children: ReactNode;
  /** Apply bottom safe-area inset. Off inside tabs — the tab bar covers it. */
  edgeBottom?: boolean;
  edgeTop?: boolean;
  padded?: boolean;
  /**
   * Off for screens that paint their own backdrop — the auth gradient covers
   * the ruling anyway, so drawing it there is wasted work.
   */
  pattern?: boolean;
  style?: ViewStyle;
}

/** Screen shell: background, page texture, safe-area insets and the gutter. */
export function Screen({
  children,
  edgeBottom = false,
  edgeTop = false,
  padded = false,
  pattern = true,
  style,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        padded && styles.padded,
        edgeTop && { paddingTop: insets.top },
        edgeBottom && { paddingBottom: insets.bottom },
        style,
      ]}
    >
      {/* Behind everything: children paint over it, and every card is opaque. */}
      {pattern ? <BackgroundPattern /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { paddingHorizontal: spacing[4] },
});

export default Screen;
