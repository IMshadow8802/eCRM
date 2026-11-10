import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef, type ComponentType } from "react";
import { Keyboard, ScrollView, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps, type View } from "react-native";

import { spacing } from "../theme";

/** An Input reports the field it is (label to help line) while focused, null on blur. */
const KeyboardRevealContext = createContext<((field: View | null) => void) | null>(null);
export const useKeyboardReveal = () => useContext(KeyboardRevealContext);

/** Room kept between the field's foot and the keyboard. */
const GAP = spacing[4];

/**
 * A ScrollView that, with the keyboard up, scrolls the focused field — the
 * whole box and its help or error line — into view. Android only brings the
 * caret's line into view, which leaves the box cut by the keyboard.
 * The app-level KeyboardAvoidingView (App.tsx) has already shrunk this view to
 * end at the keyboard, so "in view" is simply "inside the viewport".
 */
export interface KeyboardScrollViewProps extends ScrollViewProps {
  /** The scroll component to render (a sheet passes gorhom's BottomSheetScrollView). */
  as?: ComponentType<ScrollViewProps & { ref?: unknown }>;
  /**
   * A sheet: when the field and everything after it fit, show the foot too —
   * the sheet's submit button is its last child.
   */
  revealToEnd?: boolean;
}

export const KeyboardScrollView = forwardRef<ScrollView, KeyboardScrollViewProps>(function KeyboardScrollView(
  { children, onLayout, onScroll, onContentSizeChange, scrollEventThrottle, as: Scroll = ScrollView, revealToEnd = false, ...rest },
  ref,
) {
  const scroller = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => scroller.current as ScrollView);
  const focused = useRef<View | null>(null);
  const offset = useRef(0);
  const viewport = useRef(0);
  const content = useRef(0);

  const reveal = useCallback(() => {
    const field = focused.current;
    const scroll = scroller.current;
    // Typed as getInnerViewNode only; the ref form is what measureLayout takes.
    const inner = (scroll as unknown as { getInnerViewRef?: () => View | null } | null)?.getInnerViewRef?.();
    if (!field || !scroll || !inner || !Keyboard.isVisible()) return;
    field.measureLayout(inner, (_x, y, _w, h) => {
      if (revealToEnd && content.current - y + GAP <= viewport.current) {
        scroll.scrollToEnd({ animated: true });
        return;
      }
      const top = offset.current;
      const bottom = top + viewport.current;
      if (y + h + GAP > bottom) scroll.scrollTo({ y: Math.min(y - GAP, y + h + GAP - viewport.current), animated: true });
      else if (y < top) scroll.scrollTo({ y: Math.max(0, y - GAP), animated: true });
    });
  }, [revealToEnd]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", reveal);
    return () => show.remove();
  }, [reveal]);

  const report = useCallback(
    (field: View | null) => {
      focused.current = field;
      reveal();
    },
    [reveal],
  );

  return (
    <KeyboardRevealContext.Provider value={report}>
      <Scroll
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={scrollEventThrottle ?? 16}
        onLayout={(e: LayoutChangeEvent) => {
          viewport.current = e.nativeEvent.layout.height;
          // The keyboard shrinking this view is what hid the field: reveal now.
          reveal();
          onLayout?.(e);
        }}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          offset.current = e.nativeEvent.contentOffset.y;
          onScroll?.(e);
        }}
        onContentSizeChange={(w: number, h: number) => {
          content.current = h;
          onContentSizeChange?.(w, h);
        }}
        {...rest}
      >
        {children}
      </Scroll>
    </KeyboardRevealContext.Provider>
  );
});
