import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Search, X } from "lucide-react-native";

import { colors, fontScaleCap, HIT_TARGET, metrics, spacing, typography } from "../theme";
import { Text } from "./Text";

export interface SearchFieldProps {
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder: string;
  /** Fixed width (tablet Home: 340); omit to fill the band. */
  width?: number;
  /** Home: a tap opens Search instead of typing in place. */
  onPress?: () => void;
  autoFocus?: boolean;
  testID?: string;
}

/**
 * The search pill on the navy band (E `.srch`): 40 tall, Navy 700, a muted
 * search icon, white text. A clear button appears once there is text.
 */
export function SearchField({ value = "", onChangeText, placeholder, width, onPress, autoFocus, testID }: SearchFieldProps) {
  const sized = width != null ? { width } : null;
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        style={[styles.field, sized]}
      >
        <Search size={18} color={colors.onBandMuted} />
        <Text variant="body" color="onBandMuted" numberOfLines={1} style={styles.flex}>{placeholder}</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.field, sized]}>
      <Search size={18} color={colors.onBandMuted} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.onBandMuted}
        accessibilityLabel={placeholder}
        autoFocus={autoFocus}
        autoCorrect={false}
        returnKeyType="search"
        maxFontSizeMultiplier={fontScaleCap.body}
        style={styles.input}
      />
      {value ? (
        <Pressable onPress={() => onChangeText?.("")} hitSlop={(HIT_TARGET - 18) / 2} accessibilityRole="button" accessibilityLabel="Clear search">
          <X size={18} color={colors.onBandMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    height: metrics.searchHeight,
    borderRadius: metrics.searchHeight / 2,
    backgroundColor: colors.bandField,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  flex: { flex: 1 },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textOnBrand,
    paddingVertical: 0,
    lineHeight: undefined,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
