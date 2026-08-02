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

import { colors, radius, spacing, typography, HIT_TARGET } from "../theme";
import { Text } from "./Text";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  leftIcon?: keyof typeof MaterialIcons.glyphMap;
  /** Renders the show/hide eye and manages secureTextEntry internally. */
  password?: boolean;
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
    containerStyle,
    editable = true,
    multiline,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text variant="label" style={styles.label}>
          {label}
          {required ? <Text variant="label" color="danger"> *</Text> : null}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          multiline && styles.fieldMultiline,
          focused && styles.fieldFocused,
          !!error && styles.fieldError,
          !editable && styles.fieldDisabled,
        ]}
      >
        {leftIcon ? (
          <MaterialIcons
            name={leftIcon}
            size={18}
            color={colors.textMuted}
            style={styles.leftIcon}
          />
        ) : null}

        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={colors.textMuted}
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
              color={colors.textSecondary}
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
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.surface,
  },
  fieldMultiline: { alignItems: "flex-start", paddingVertical: spacing[3] },
  fieldFocused: { borderColor: colors.primary },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { backgroundColor: colors.disabledBg },
  leftIcon: {},
  input: {
    flex: 1,
    paddingVertical: spacing[3],
    ...typography.body,
  },
  helper: {},
});

export default Input;
