import { forwardRef, useCallback, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetModal as BottomSheetModalType,
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
  { title, children, snapPoints, onDismiss },
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
