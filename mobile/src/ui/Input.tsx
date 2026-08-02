import { forwardRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import { colors, radius, spacing, typography, CONTROL_HEIGHT } from "../theme";
import { Text } from "./Text";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  leftIcon?: keyof typeof MaterialIcons.glyphMap;
  /** Renders the show/hide eye and manages secureTextEntry internally. */
  password?: boolean;
  /**
   * "onBrand" restyles the field for use directly on the brand gradient —
   * translucent fill, white text and border. Everything stays a token so the
   * two tones cannot drift apart.
   */
  tone?: "default" | "onBrand";
  containerStyle?: ViewStyle;
}

/**
 * The single text input. Handles label, error, hint, focus ring and the
 * password reveal so no screen re-implements them.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    hint,
    required,
    leftIcon,
    password = false,
    tone = "default",
    containerStyle,
    editable = true,
    multiline,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const onBrand = tone === "onBrand";

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text
          variant="label"
          color={onBrand ? "textOnBrandMuted" : "textSecondary"}
          style={styles.label}
        >
          {label}
          {required ? <Text variant="label" color="danger"> *</Text> : null}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          onBrand && styles.fieldOnBrand,
          multiline && styles.fieldMultiline,
          focused && (onBrand ? styles.fieldFocusedOnBrand : styles.fieldFocused),
          !!error && styles.fieldError,
          !editable && !onBrand && styles.fieldDisabled,
        ]}
      >
        {leftIcon ? (
          <MaterialIcons
            name={leftIcon}
            size={18}
            color={onBrand ? colors.textOnBrandMuted : colors.textMuted}
            style={styles.leftIcon}
          />
        ) : null}

        <TextInput
          ref={ref}
          style={[styles.input, onBrand && styles.inputOnBrand]}
          placeholderTextColor={
            onBrand ? colors.textOnBrandMuted : colors.textMuted
          }
          secureTextEntry={password && !reveal}
          editable={editable}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
        />

        {password ? (
          <Pressable
            onPress={() => setReveal((v) => !v)}
            hitSlop={spacing[2]}
            accessibilityLabel={reveal ? "Hide password" : "Show password"}
          >
            <MaterialIcons
              name={reveal ? "visibility-off" : "visibility"}
              size={20}
              color={onBrand ? colors.textOnBrandMuted : colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text variant="caption" color="danger" style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" style={styles.helper}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing[2] },
  label: {},
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    height: CONTROL_HEIGHT,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.surface,
  },
  // Multiline is the one case that grows past the fixed control height.
  fieldMultiline: {
    height: undefined,
    minHeight: CONTROL_HEIGHT * 2,
    alignItems: "flex-start",
    paddingVertical: spacing[3],
  },
  fieldFocused: { borderColor: colors.primary },
  fieldOnBrand: {
    backgroundColor: colors.fieldOnBrand,
    borderColor: colors.borderOnBrand,
  },
  fieldFocusedOnBrand: { borderColor: colors.borderOnBrandFocus },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { backgroundColor: colors.disabledBg },
  leftIcon: {},
  input: {
    flex: 1,
    // No vertical padding — the parent's fixed height centres it. Padding here
    // is what made inputs render taller than buttons beside them.
    paddingVertical: 0,
    ...typography.body,
  },
  inputOnBrand: { color: colors.textOnBrand },
  helper: {},
});

export default Input;
