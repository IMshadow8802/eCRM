import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { useOnBoard } from "./boardSurface";

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Off when the card lays out its own sections and pads them itself. */
  padded?: boolean;
  /** Vertical rhythm between children. */
  gap?: keyof typeof spacing;
  style?: ViewStyle;
}

/**
 * THE card. Every raised white surface in the app is this one — task cards,
 * complaint cards, boards, hub rows, settings panels.
 *
 * It exists because the shell was hand-rolled in nine files, so every change
 * to it had to be made nine times: dropping the border, retuning the shadow,
 * the press physics. A clipping bug lived in exactly one of those copies and
 * flattened that screen while the other eight looked fine — which is the whole
 * argument for this file in one sentence.
 *
 * Content stays per-domain. A task and a complaint genuinely show different
 * things, and one component rendering both becomes a soup of `showX` props —
 * the opposite failure, and harder to unpick than duplication. This owns the
 * surface; the feature owns what sits on it.
 *
 * Three rules are load-bearing:
 *
 *   NO border. On a white page an outline draws a box around every card; the
 *   shadow alone is what reads as lift.
 *
 *   NO `overflow: hidden`, ever. On iOS it sets `masksToBounds`, which clips
 *   the layer's OWN shadow along with its children, and the card renders
 *   completely flat. Anything that needs clipping does it on a child.
 *
 *   Press SINKS it. Translating down while the shadow tightens is what a
 *   raised object does when pushed. A colour tint or a bare scale is not.
 */
export function Card({
  children,
  onPress,
  onLongPress,
  padded = true,
  gap = 3,
  style,
}: CardProps) {
  // Inside a board column the shadow is dropped — see ui/boardSurface for why
  // a narrow repeated column cannot carry one.
  const onBoard = useOnBoard();

  const shell = [
    styles.card,
    !onBoard && shadows.md,
    padded && styles.padded,
    { gap: spacing[gap] },
    style,
  ];

  if (!onPress && !onLongPress) {
    return <View style={shell}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => [...shell, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * The shadow is applied inline, not here, because it depends on where the
   * card is: on a board column it is dropped entirely. Contrast — a white card
   * on a page one step darker — is what separates a card either way.
   */
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
  },
  padded: { padding: spacing[4] },
  pressed: { transform: [{ scale: 0.985 }, { translateY: 1 }] },
});

export default Card;
