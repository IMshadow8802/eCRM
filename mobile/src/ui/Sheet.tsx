import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetModal as BottomSheetModalType,
  useBottomSheetModal,
} from "@gorhom/bottom-sheet";
import { X } from "lucide-react-native";

import { colors, metrics, radius, spacing } from "../theme";
import { KeyboardScrollView } from "./KeyboardScrollView";
import { InSheetContext, useInSheet } from "./sheetContext";
import { StatusBadge, type StatusBadgeProps } from "./StatusBadge";
import { Text } from "./Text";
import { useKeyboardHeight } from "./useKeyboardOpen";

/** The grabber row above the content: 8 + the grabber + 14 (styles.handleArea). */
const HANDLE_AREA = spacing[2] + metrics.grabber.height + 14;

export type SheetRef = BottomSheetModalType;

export interface SheetProps {
  title?: string;
  /** The line under the title ("C-1042 · AC not cooling"). */
  subtitle?: string;
  /** The 40 badge leading the header (Resolve: green circle-check). */
  badge?: Pick<StatusBadgeProps, "tone" | "icon">;
  /** The round close button. On by default whenever there is a subtitle or a badge (E's header). */
  closable?: boolean;
  children: ReactNode;
  /** Percentages or pixel heights, e.g. ["50%"]. Omit to size to content. */
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
  /** Set when the sheet contains a text input so it lifts with the keyboard. */
  keyboardAware?: boolean;
  /**
   * E's 16 side padding. Off by default only because pre-E sheets pad their
   * own rows; every E sheet passes it.
   */
  padded?: boolean;
}

interface SheetHeaderProps {
  title: string;
  subtitle?: string;
  badge?: Pick<StatusBadgeProps, "tone" | "icon">;
  onClose?: () => void;
}

/** Badge · title + subtitle · close (E `.shd`). */
function SheetHeader({ title, subtitle, badge, onClose }: SheetHeaderProps) {
  return (
    <View style={styles.header}>
      {badge ? <StatusBadge tone={badge.tone} icon={badge.icon} /> : null}
      <View style={styles.flex}>
        <Text variant="sheetTitle" accessibilityRole="header" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="meta" tabular numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={spacing[1]} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <X size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The ONE bottom sheet (E `.bsheet`): white, top corners 24, the grabber,
 * the scrim. Every picker, action menu and "move to…" list uses it.
 *
 * Imperative by design: `ref.current?.present()`. That keeps the sheet out of
 * render state, so a parent re-render cannot reopen or close it by accident.
 */
export const Sheet = forwardRef<SheetRef, SheetProps>(function Sheet(
  { title, subtitle, badge, closable, children, snapPoints, onDismiss, keyboardAware = false, padded = false },
  ref,
) {
  const inner = useRef<SheetRef>(null);
  useImperativeHandle(ref, () => inner.current as SheetRef, []);
  const points = useMemo(() => snapPoints, [snapPoints]);
  // A sheet is flush to the bottom edge, so it MUST pay the inset itself.
  const insets = useSafeAreaInsets();

  // Tap-outside-to-close. Without appearsOnIndex/disappearsOnIndex the backdrop
  // renders opaque at rest and swallows every touch on the screen behind it.
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" style={[props.style, styles.scrim]} opacity={1} />
    ),
    [],
  );
  const showClose = closable ?? !!(subtitle || badge);
  // A sheet opened from a sheet (a Select inside Resolve) lives in the parent's
  // content. gorhom's default "replace" closes the parent, which unmounts that
  // content — the picker with it, so both vanished. "push" stacks it on top.
  const nested = useInSheet();
  // With the keyboard up a keyboard-aware sheet is capped to the room above
  // it and its content scrolls: gorhom only lifts the sheet, so a tall one
  // (Status with Won's fields, Transfer's list) kept its submit button under
  // the keyboard. The focused field, and the foot when it fits, stay in view.
  const keyboard = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
  const room = keyboardAware && keyboard > 0 ? windowHeight - insets.top - keyboard - HANDLE_AREA : undefined;
  const bodyStyle = [padded && styles.padded, { paddingBottom: insets.bottom + spacing[4] }];
  const body = (
    <>
      {title ? (
        <View style={padded ? styles.headerGap : styles.headerLegacy}>
          <SheetHeader
            title={title}
            subtitle={subtitle}
            badge={badge}
            onClose={showClose ? () => inner.current?.dismiss() : undefined}
          />
        </View>
      ) : null}
      <InSheetContext.Provider value>{children}</InSheetContext.Provider>
    </>
  );

  return (
    <BottomSheetModal
      ref={inner}
      snapPoints={points}
      enableDynamicSizing={!points}
      maxDynamicContentSize={room}
      backdropComponent={renderBackdrop}
      onDismiss={onDismiss}
      stackBehavior={nested ? "push" : undefined}
      // No android_keyboardInputMode="adjustResize": edge-to-edge Android never
      // resizes, so gorhom would wait forever. The default (pan) lifts the sheet.
      keyboardBehavior={keyboardAware ? "interactive" : undefined}
      keyboardBlurBehavior={keyboardAware ? "restore" : undefined}
      handleStyle={styles.handleArea}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.background}
    >
      {keyboardAware ? (
        <KeyboardScrollView
          testID="sheet-scroll"
          as={BottomSheetScrollView as never}
          revealToEnd
          bounces={false}
          contentContainerStyle={bodyStyle}
        >
          {body}
        </KeyboardScrollView>
      ) : (
        <BottomSheetView style={bodyStyle}>{body}</BottomSheetView>
      )}
    </BottomSheetModal>
  );
});

/**
 * Android Back closes the top open sheet instead of leaving the screen behind
 * it. Mount it once inside BottomSheetModalProvider, AFTER the navigator.
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
  background: { backgroundColor: colors.surface, borderTopLeftRadius: radius.modal, borderTopRightRadius: radius.modal },
  // The scrim is the theme's one translucent colour; the backdrop's own
  // opacity animation is pinned to 1 so nothing is layered on top of it.
  scrim: { backgroundColor: colors.overlay },
  handleArea: { paddingTop: spacing[2], paddingBottom: 14 },
  handle: { backgroundColor: colors.grabber, width: metrics.grabber.width, height: metrics.grabber.height, borderRadius: radius.mark },
  padded: { paddingHorizontal: spacing[4] },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  headerGap: { marginBottom: spacing[4] },
  headerLegacy: { paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
});
