import { forwardRef, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetModal as BottomSheetModalType,
  useBottomSheetModal,
} from "@gorhom/bottom-sheet";

import { colors, radius, spacing } from "../theme";
import { Text } from "./Text";

export type SheetRef = BottomSheetModalType;

export interface SheetProps {
  title?: string;
  children: ReactNode;
  /** Percentages or pixel heights, e.g. ["50%"]. Omit to size to content. */
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
  /** Set when the sheet contains a text input so it lifts with the keyboard. */
  keyboardAware?: boolean;
}

/**
 * The ONE bottom sheet. Every picker, action menu and "move to…" list uses it —
 * screens must not hand-roll modals.
 *
 * Imperative by design: `const ref = useRef<SheetRef>(null)` then
 * `ref.current?.present()`. That keeps the sheet out of render state, so a
 * parent re-render cannot reopen or close it by accident.
 */
export const Sheet = forwardRef<SheetRef, SheetProps>(function Sheet(
  { title, children, snapPoints, onDismiss, keyboardAware = false },
  ref,
) {
  const points = useMemo(() => snapPoints, [snapPoints]);
  // A sheet is flush to the bottom edge, so it MUST pay the inset itself —
  // on Android with on-screen nav buttons the last row is otherwise unreachable.
  const insets = useSafeAreaInsets();

  // Tap-outside-to-close. Without appearsOnIndex/disappearsOnIndex the backdrop
  // renders opaque at rest and swallows every touch on the screen behind it.
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={points}
      enableDynamicSizing={!points}
      backdropComponent={renderBackdrop}
      onDismiss={onDismiss}
      // Without these an input inside the sheet is hidden by the keyboard.
      // No android_keyboardInputMode="adjustResize": in that mode gorhom waits
      // for the window to resize, which edge-to-edge Android never does, so the
      // keyboard covered the form. The default (pan) makes the sheet lift itself.
      keyboardBehavior={keyboardAware ? "interactive" : undefined}
      keyboardBlurBehavior={keyboardAware ? "restore" : undefined}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.background}
    >
      <BottomSheetView
        style={[styles.content, { paddingBottom: insets.bottom + spacing[4] }]}
      >
        {title ? (
          <View style={styles.header}>
            <Text variant="h2">{title}</Text>
          </View>
        ) : null}
        {children}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

/**
 * Android Back closes the top open sheet instead of leaving the screen behind
 * it. gorhom does not do this itself; one listener here covers every sheet.
 * Mount it once inside BottomSheetModalProvider, AFTER the navigator: the last
 * listener added runs first, so it gets Back before navigation does.
 */
export function SheetBackHandler() {
  const { dismiss } = useBottomSheetModal();
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => dismiss());
    return () => sub.remove();
  }, [dismiss]);
  return null;
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  handle: { backgroundColor: colors.borderStrong, width: spacing[10] },
  content: {},
  header: { paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
});

export default Sheet;
