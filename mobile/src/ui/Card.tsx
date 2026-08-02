import { Pressable, StyleSheet, View, type ViewProps, type ViewStyle } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";

export interface CardProps extends ViewProps {
  onPress?: () => void;
  onLongPress?: () => void;
  padded?: boolean;
  elevated?: boolean;
  style?: ViewStyle;
}

/** Surface container for list rows and panels. Tappable when given onPress. */
export function Card({
  onPress,
  onLongPress,
  padded = true,
  elevated = false,
  style,
  children,
  ...rest
}: CardProps) {
  const content = [
    styles.card,
    padded && styles.padded,
    elevated ? shadows.base : styles.bordered,
    style,
  ];

  if (!onPress && !onLongPress) {
    return (
      <View style={content} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [...content, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md },
  bordered: { borderWidth: 1, borderColor: colors.border },
  padded: { padding: spacing[4] },
  pressed: { opacity: 0.7 },
});

export default Card;
