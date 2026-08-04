import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";

export interface ScreenProps {
  children: ReactNode;
  /** Apply bottom safe-area inset. Off inside tabs — the tab bar covers it. */
  edgeBottom?: boolean;
  edgeTop?: boolean;
  padded?: boolean;
  style?: ViewStyle;
}

/** Screen shell: background, safe-area insets and the standard gutter. */
export function Screen({
  children,
  edgeBottom = false,
  edgeTop = false,
  padded = false,
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
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { paddingHorizontal: spacing[4] },
});

export default Screen;
