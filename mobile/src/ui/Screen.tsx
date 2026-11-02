import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";

export interface ScreenProps {
  children: ReactNode;
  /** Apply bottom safe-area inset. Off inside the Shell — the bar pays it. */
  edgeBottom?: boolean;
  edgeTop?: boolean;
  padded?: boolean;
  /**
   * A Band screen: the page behind is navy, so the BandSheet's rounded top
   * corners show the band behind them (E). The Band pays the top inset.
   */
  band?: boolean;
  style?: ViewStyle;
}

/** Screen shell: background, safe-area insets and the standard gutter. */
export function Screen({ children, edgeBottom = false, edgeTop = false, padded = false, band = false, style }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        band && styles.band,
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
  band: { backgroundColor: colors.band },
  padded: { paddingHorizontal: spacing[4] },
});

export default Screen;
