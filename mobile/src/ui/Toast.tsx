import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CircleAlert, CircleCheck } from "lucide-react-native";

import { colors, radius, shadows, spacing, SCREEN_PADDING } from "../theme";
import { Text } from "./Text";

/**
 * The app's one transient message.
 *
 * Until this existed there was no way to tell someone a write had failed. Every
 * mutation either invented its own `useState<string | null>` and a danger-
 * coloured line — 44 of those had accumulated — or, more often, said nothing at
 * all: a refused delete left the row sitting there and a rejected board move
 * left the card in a column the server had turned down.
 *
 * Inline text cannot cover those cases. A delete fired from an ActionSheet or a
 * Dialog closes the very surface the message would render on, so the message is
 * painted behind a sheet on its way out. A toast sits above everything and
 * outlives whatever triggered it.
 *
 * It is NOT a replacement for a form's inline error. A field-level complaint
 * belongs beside the field, where the fix is. A toast is for the outcome of an
 * action whose surface has already gone.
 */

type ToastTone = "danger" | "success";

interface ToastState {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  /** A write was refused. Pass the server's own words — see apiErrorMessage. */
  error: (message: string) => void;
  /** Confirmation for something with no visible result of its own. */
  success: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Errors linger; confirmations do not. Someone who just watched a row vanish
 * does not need four seconds to be told it worked, but a refusal has to survive
 * a glance away from the phone.
 */
const DURATION: Record<ToastTone, number> = { danger: 5000, success: 2500 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const seq = useRef(0);

  const show = useCallback((tone: ToastTone, message: string) => {
    const trimmed = message?.trim();
    if (!trimmed) return;
    seq.current += 1;
    // Replace rather than queue. Two failures in a row almost always share a
    // cause, and making someone read a backlog to get to the current state is
    // worse than showing them the latest one.
    setToast({ id: seq.current, tone, message: trimmed });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      error: (message) => show("danger", message),
      success: (message) => show("success", message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <ToastBar
          // Keyed by id so a replacement remounts and replays its entrance
          // rather than sitting there mid-fade with new text.
          key={toast.id}
          tone={toast.tone}
          message={toast.message}
          onDone={() => setToast((cur) => (cur?.id === toast.id ? null : cur))}
        />
      ) : null}
    </ToastContext.Provider>
  );
}

/**
 * Throws rather than no-opping when the provider is missing. A toast that
 * silently does nothing is the exact failure this component was built to end.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

function ToastBar({
  tone,
  message,
  onDone,
}: {
  tone: ToastTone;
  message: string;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  // useState, not the usual `useRef(new Animated.Value(0)).current`. The value
  // is read during render to build the style, and `react-hooks/refs` fails the
  // build on that (see CLAUDE.md §9.5). A lazy useState initialiser gives the
  // same create-once instance without it being a ref at all.
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let cancelled = false;
    const leave = () =>
      Animated.timing(anim, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start(() => {
        if (!cancelled) onDone();
      });

    Animated.timing(anim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(leave, DURATION[tone]);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Mounted per toast id by the provider, so this runs exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icon = tone === "danger" ? CircleAlert : CircleCheck;

  return (
    <Animated.View
      // Only transform and the container's own opacity animate. The background
      // stays a SOLID token throughout (§9.3) — a translucent bar takes on
      // whatever screen is behind it and reads as washed out.
      style={[
        styles.wrap,
        {
          top: insets.top + spacing[2],
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-16, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onDone}
        accessibilityRole="alert"
        accessibilityLabel={message}
        style={[
          styles.bar,
          { backgroundColor: tone === "danger" ? colors.danger : colors.success },
        ]}
      >
        <Icon size={18} color={colors.textOnBrand} />
        <Text variant="label" color="textOnBrand" style={styles.message}>
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: SCREEN_PADDING,
    // Above the bottom sheets and modals it exists to outlive.
    zIndex: 1000,
    elevation: 1000,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    ...shadows.lg,
  },
  message: { flex: 1 },
});

export default ToastProvider;
