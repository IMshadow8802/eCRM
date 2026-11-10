import { useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { LucideIcon } from "lucide-react-native";

import { colors, metrics } from "../theme";
import { Text } from "./Text";

export interface SwipeAction {
  key: string;
  label: string;
  icon: LucideIcon;
  color: "primary" | "swipeHold" | "success" | "escalate";
  onPress: () => void;
  /** 88 instead of 72 (Escalate). */
  wide?: boolean;
}

export interface SwipeRowProps {
  /** Blocks on the LEFT edge, revealed by swiping right (Escalate). */
  left?: SwipeAction[];
  /** Blocks on the RIGHT edge, revealed by swiping left (Call · On hold · Resolve). */
  right?: SwipeAction[];
  children: ReactNode;
}

/**
 * A row that slides to reveal solid action blocks (E 22). A swipe only
 * REVEALS them: nothing changes until a block is tapped, and each block opens
 * its sheet — never a mutation on the gesture alone. The row slides; nothing
 * fades.
 */
export function SwipeRow({ left = [], right = [], children }: SwipeRowProps) {
  const ref = useRef<SwipeableMethods>(null);
  const blocks = (actions: SwipeAction[]) => (
    <View style={styles.actions}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          onPress={() => {
            ref.current?.close();
            a.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          style={[styles.block, { width: a.wide ? metrics.swipeActionWide : metrics.swipeAction, backgroundColor: colors[a.color] }]}
        >
          <a.icon size={20} color={colors.textOnBrand} />
          <Text variant="label" color="textOnBrand">{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  if (!left.length && !right.length) return <>{children}</>;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={left.length ? () => blocks(left) : undefined}
      renderRightActions={right.length ? () => blocks(right) : undefined}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row" },
  block: { alignItems: "center", justifyContent: "center", gap: 4 },
});
