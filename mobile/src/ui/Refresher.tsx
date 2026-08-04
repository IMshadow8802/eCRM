import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, type StyleProp, type ViewStyle } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { colors } from "../theme";

export interface RefresherProps {
  /** Usually `query.isRefetching && !query.isLoading`. */
  refreshing: boolean;
  onRefresh: () => void;
  /**
   * Android only, and supplied by ScrollView — it clones this element and
   * hands it the list's style plus the scroll view itself as children. Both
   * have to reach RefreshControl or the list stops rendering on Android.
   */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * Pull-to-refresh. Every list uses this rather than `RefreshControl` directly.
 *
 * ## Why it exists
 *
 * `RefreshControl` is controlled by a one-shot prop change: RN's
 * `componentDidUpdate` reacts to `refreshing` differing from its previous
 * value, and that is the ONLY moment the spinner is told to stop. If that
 * moment is missed, it is missed forever — nothing re-asserts the value.
 *
 * It gets missed constantly, because a blurred screen is not just hidden. Both
 * navigators default `detachInactiveScreens` to true on iOS, and
 * `react-native-screens` implements that by removing the screen's entire view
 * tree from the window (`RNSScreenContainer.mm`, `[screen removeFromSuperview]`).
 * So:
 *
 *   1. Pull. `refreshing` -> true; iOS shifts the scroll view down by the
 *      control's height and spins.
 *   2. Switch tab, or open a task off the board. The scroll view and its
 *      `UIRefreshControl` leave the window mid-refresh.
 *   3. The query resolves while you are away — `freezeOnBlur` is off, so JS
 *      keeps running. `refreshing` -> false is delivered to a detached view and
 *      dropped; RN's own `RCTRefreshControl` is explicit about this, guarding
 *      its teardown with `if (!_hasMovedToWindow) { return; }`.
 *   4. Come back. The view re-attaches, but React already sent `false` and only
 *      sends props on CHANGE, so nothing is sent again. The spinner and the
 *      offset stay exactly where they were, and the list sits pushed down the
 *      screen until you leave and re-enter.
 *
 * ## The fix
 *
 * Hold the reported value while the screen is blurred, so the native side only
 * ever sees a transition while it is actually on screen. `useFocusEffect` re-runs
 * on focus and on any change to `refreshing` WHILE focused, but not while
 * blurred — which is exactly the latch, with no extra bookkeeping.
 *
 * The ordering is safe: React Navigation emits `focus` in an effect after the
 * commit that re-attaches the screen, so `setReported(false)` lands a render
 * later, with the view back in the window.
 */
export function Refresher({
  refreshing,
  onRefresh,
  style,
  children,
}: RefresherProps) {
  const [reported, setReported] = useState(refreshing);

  useFocusEffect(
    useCallback(() => {
      setReported(refreshing);
    }, [refreshing]),
  );

  return (
    <RefreshControl
      refreshing={reported}
      onRefresh={onRefresh}
      tintColor={colors.primary}
      style={style}
    >
      {children}
    </RefreshControl>
  );
}

export default Refresher;
