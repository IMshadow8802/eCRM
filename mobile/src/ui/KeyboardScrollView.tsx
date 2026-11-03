import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef } from "react";
import { Keyboard, ScrollView, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps, type View } from "react-native";

import { spacing } from "../theme";

/** An Input reports the field it is (label to help line) while focused, null on blur. */
export const KeyboardRevealContext = createContext<((field: View | null) => void) | null>(null);
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
export const KeyboardScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardScrollView(
  { children, onLayout, onScroll, scrollEventThrottle, ...rest },
  ref,
) {
  const scroller = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => scroller.current as ScrollView);
  const focused = useRef<View | null>(null);
  const offset = useRef(0);
  const viewport = useRef(0);

  const reveal = useCallback(() => {
    const field = focused.current;
    const scroll = scroller.current;
    // Typed as getInnerViewNode only; the ref form is what measureLayout takes.
    const inner = (scroll as unknown as { getInnerViewRef?: () => View | null } | null)?.getInnerViewRef?.();
    if (!field || !scroll || !inner || !Keyboard.isVisible()) return;
    field.measureLayout(inner, (_x, y, _w, h) => {
      const top = offset.current;
      const bottom = top + viewport.current;
      if (y + h + GAP > bottom) scroll.scrollTo({ y: Math.min(y - GAP, y + h + GAP - viewport.current), animated: true });
      else if (y < top) scroll.scrollTo({ y: Math.max(0, y - GAP), animated: true });
    });
  }, []);

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
      <ScrollView
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
        {...rest}
      >
        {children}
      </ScrollView>
    </KeyboardRevealContext.Provider>
  );
});

export default KeyboardScrollView;
