import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { Eye, EyeOff, type LucideIcon } from "lucide-react-native";

import { colors, fontScaleCap, spacing } from "../theme";
import { FieldHelp, FieldLabel, FieldPrefix, fieldBox } from "./Field";
import { Text } from "./Text";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  /** An xs chip after the label ("Custom", T4). */
  labelTag?: string;
  leftIcon?: LucideIcon;
  /** "+91", "₹" — inside the field, before the text, with a divider. */
  prefix?: string;
  /** Renders the show/hide eye and manages secureTextEntry internally. */
  password?: boolean;
  /**
   * retired (Task 40): E puts the auth form on white, so this only keeps the
   * label and help legible on the gradient until LoginScreen is restyled.
   */
  tone?: "default" | "onBrand";
  /** No border, background or fixed height — an inline composer inside a card. */
  bare?: boolean;
  containerStyle?: ViewStyle;
}

/**
 * The single text input (E `.in`): label, field, help. Focus is a 2 px primary
 * ring, an error a 2 px danger ring with the leading icon turned danger.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label, error, hint, required, labelTag, leftIcon: LeftIcon, prefix, password = false, tone = "default",
    bare = false, containerStyle, editable = true, multiline,
    // Pulled out of `rest`: spread after the wrappers, a caller's onFocus would switch the ring off.
    onFocus, onBlur,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const onBrand = tone === "onBrand";

  return (
    <View style={containerStyle}>
      {label ? (
        onBrand ? (
          <Text variant="label" color="textOnBrandMuted" style={styles.legacyLabel}>
            {label}
            {required ? <Text variant="label" color="danger"> *</Text> : null}
          </Text>
        ) : (
          <FieldLabel label={label} required={required} tag={labelTag} />
        )
      ) : null}

      <View
        style={[
          fieldBox.box,
          multiline && fieldBox.multiline,
          focused && fieldBox.focused,
          !!error && fieldBox.error,
          !editable && fieldBox.disabled,
          bare && styles.bare,
        ]}
      >
        {LeftIcon ? <LeftIcon size={18} color={error ? colors.danger : colors.textMuted} /> : null}
        {prefix ? <FieldPrefix text={prefix} /> : null}
        <TextInput
          ref={ref}
          style={[fieldBox.input, multiline && fieldBox.inputMultiline]}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={password && !reveal}
          editable={editable}
          multiline={multiline}
          maxFontSizeMultiplier={fontScaleCap.body}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {password ? (
          <Pressable
            onPress={() => setReveal((v) => !v)}
            hitSlop={spacing[3]}
            accessibilityLabel={reveal ? "Hide password" : "Show password"}
          >
            {reveal ? <EyeOff size={18} color={colors.textSecondary} /> : <Eye size={18} color={colors.textSecondary} />}
          </Pressable>
        ) : null}
      </View>

      {onBrand && (error || hint) ? (
        <Text variant="label" color={error ? "textOnBrand" : "textOnBrandMuted"} style={styles.legacyHelp}>{error || hint}</Text>
      ) : (
        <FieldHelp error={error} hint={hint} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  bare: { height: undefined, minHeight: undefined, borderWidth: 0, paddingHorizontal: 0, backgroundColor: colors.transparentBorder },
  legacyLabel: { marginBottom: 6 },
  legacyHelp: { marginTop: 6 },
});

export default Input;
