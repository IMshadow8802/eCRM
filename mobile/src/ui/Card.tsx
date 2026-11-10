import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import { colors, elevation, radius, spacing } from "../theme";
import { useOnBoard } from "./boardSurface";

/** Tinted cards carry their colour and no shadow (E: Create rows, follow-up card, pending delete, info). */
export type CardTone = "surface" | "muted" | "followUp" | "danger" | "brandSoft";

const TONE_FILL: Record<CardTone, string> = {
  surface: colors.surface,
  muted: colors.surfaceMuted,
  followUp: colors.followUpTint,
  danger: colors.dangerCardTint,
  brandSoft: colors.primarySoft,
};

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Off when the card lays out its own sections and pads them itself. */
  padded?: boolean;
  /** Vertical rhythm between children. */
  gap?: keyof typeof spacing;
  tone?: CardTone;
  style?: ViewStyle;
  testID?: string;
}

/**
 * THE card (E `.card`): radius 16, white, the solid-colour whisper shadow.
 *
 * Three rules are load-bearing:
 *   NO border — the sheet being one step darker is what makes a card a card.
 *   NO `overflow: hidden` — on iOS it clips the card's own shadow. Clip a child.
 *   Press SINKS it (translate + scale), never tints it.
 */
export function Card({
  children, onPress, onLongPress, padded = true, gap = 3, tone = "surface", style, testID,
}: CardProps) {
  // Inside a board column the shadow is dropped — see ui/boardSurface.
  const onBoard = useOnBoard();
  const shell = [
    styles.card,
    { backgroundColor: TONE_FILL[tone] },
    !onBoard && tone === "surface" && elevation.whisper,
    padded && styles.padded,
    { gap: spacing[gap] },
    style,
  ];

  if (!onPress && !onLongPress) {
    return <View testID={testID} style={shell}>{children}</View>;
  }
  return (
    <Pressable
      testID={testID}
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
  card: { borderRadius: radius.card },
  padded: { padding: spacing[4] },
  pressed: { transform: [{ scale: 0.985 }, { translateY: 1 }] },
});
