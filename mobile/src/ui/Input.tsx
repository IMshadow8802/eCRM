import { forwardRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Eye, EyeOff, type LucideIcon } from "lucide-react-native";

import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
  CONTROL_HEIGHT,
} from "../theme";
import { Text } from "./Text";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  leftIcon?: LucideIcon;
  /** Renders the show/hide eye and manages secureTextEntry internally. */
  password?: boolean;
  /**
   * "onBrand" is for a field sitting directly on the brand gradient. The field
   * itself stays SOLID WHITE — a translucent one reads as icy and washes out
   * the text. Only the label, helper and elevation change.
   */
  tone?: "default" | "onBrand";
  /**
   * Strips the border, background and fixed height — for an inline composer
   * sitting inside a card that already provides the surface. Exists so screens
   * never reach for a raw RN TextInput to get one.
   */
  bare?: boolean;
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
    leftIcon: LeftIcon,
    password = false,
    tone = "default",
    bare = false,
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
          bare && styles.fieldBare,
          onBrand && styles.fieldOnBrand,
          multiline && styles.fieldMultiline,
          focused && styles.fieldFocused,
          !!error && styles.fieldError,
          !editable && !onBrand && styles.fieldDisabled,
        ]}
      >
        {LeftIcon ? <LeftIcon size={18} color={colors.textMuted} /> : null}

        <TextInput
          ref={ref}
          style={[styles.input, multiline && styles.inputMultiline]}
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
            {reveal ? <EyeOff size={20} color={colors.textSecondary} /> : <Eye size={20} color={colors.textSecondary} />}
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text
          variant="caption"
          color={onBrand ? "textOnBrand" : "danger"}
          style={styles.helper}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text
          variant="caption"
          color={onBrand ? "textOnBrandMuted" : "textSecondary"}
          style={styles.helper}
        >
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
  fieldBare: {
    height: undefined,
    minHeight: undefined,
    borderWidth: 0,
    paddingHorizontal: 0,
    backgroundColor: colors.transparentBorder,
  },
  fieldMultiline: {
    height: undefined,
    minHeight: CONTROL_HEIGHT * 2,
    alignItems: "flex-start",
    paddingVertical: spacing[3],
  },
  fieldFocused: { borderColor: colors.primary },
  // Solid white, borderless, lifted off the gradient by a shadow rather than
  // by a stroke — a border on white over a gradient just looks like a seam.
  fieldOnBrand: {
    borderColor: colors.transparentBorder,
    ...shadows.base,
  },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { backgroundColor: colors.disabledBg },
  input: {
    flex: 1,
    // No vertical padding — the parent's fixed height centres it. Padding here
    // is what made inputs render taller than buttons beside them.
    paddingVertical: 0,
    maxHeight: 96,
    ...typography.body,
    // Three things that all shift text off the row's centre line, so the
    // placeholder never lines up with the leading icon beside it:
    //
    // 1. lineHeight. A single-line TextInput lays its text out inside a
    //    lineHeight box and does not centre the glyphs within it. body's 22px
    //    box around 14px type leaves the text riding high.
    // 2. includeFontPadding (Android). Reserves room above the ascender and
    //    below the descender for accents the string does not contain.
    // 3. textAlignVertical (Android). Defaults to top on a bare TextInput.
    //
    // Dropped here and restored for multiline below, where a line box is
    // exactly what wrapped text needs.
    lineHeight: undefined,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  inputMultiline: {
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
  helper: {},
});

export default Input;
