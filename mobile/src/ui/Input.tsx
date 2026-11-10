import { forwardRef, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Eye, EyeOff, type LucideIcon } from "lucide-react-native";

import { colors, fontScaleCap, spacing } from "../theme";
import { FieldHelp, FieldLabel, FieldPrefix, fieldBox } from "./Field";
import { useKeyboardReveal } from "./KeyboardScrollView";
import { useInSheet } from "./sheetContext";
import { Text } from "./Text";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
  /** The danger ring and a red leading icon with no help line (E 03: the box above says why). */
  invalid?: boolean;
  /** After the text, inside the field: a clear X, a spinner (E 12 customer search). */
  right?: ReactNode;
  hint?: string;
  required?: boolean;
  /** An xs chip after the label ("Custom", T4). */
  labelTag?: string;
  leftIcon?: LucideIcon;
  /** "+91", "₹" — inside the field, before the text, with a divider. */
  prefix?: string;
  /** Tabular figures (mobile numbers, amounts). */
  tabular?: boolean;
  /** Renders the show/hide eye and manages secureTextEntry internally. */
  password?: boolean;
  /**
   * retired (Task 40): E puts the auth form on white, so this only keeps the
   * label and help legible on the gradient until LoginScreen is restyled.
   */
  tone?: "default" | "onBrand";
  /** No border, background or fixed height — an inline composer inside a card. */
  bare?: boolean;
  /** Field height when not 44: a single line takes it as its height (E 23 search 40), a multiline as its minimum (E 13 84, E 23 64). */
  fieldHeight?: number;
  containerStyle?: ViewStyle;
  /**
   * `lg` is the sign-in form only: E's field scaled 52/44 (height, radius,
   * padding, text, icon), because E's 44 reads thin on a 448 dp phone there.
   */
  size?: "md" | "lg";
}

/**
 * The single text input (E `.in`): label, field, help. Focus is a 2 px primary
 * ring, an error a 2 px danger ring with the leading icon turned danger.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label, error, invalid = false, right, hint, required, labelTag, leftIcon: LeftIcon, prefix, tabular = false, password = false, tone = "default",
    bare = false, fieldHeight, containerStyle, size = "md", editable = true, multiline,
    // Pulled out of `rest`: spread after the wrappers, a caller's onFocus would switch the ring off.
    onFocus, onBlur,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  // Inside a KeyboardScrollView: the whole field (box and help line) is kept above the keyboard.
  const keepInView = useKeyboardReveal();
  const wrapper = useRef<View>(null);
  const [reveal, setReveal] = useState(false);
  const onBrand = tone === "onBrand";
  const lg = size === "lg";
  const iconSize = lg ? 20 : 18;
  const bad = !!error || invalid;
  // Inside a Sheet the field must be gorhom's, or it drops focus (sheetContext).
  // gorhom's is a TextInput (same props, same instance); only its ref type is wider.
  const Field = (useInSheet() ? BottomSheetTextInput : TextInput) as typeof TextInput;

  return (
    <View ref={wrapper} style={containerStyle}>
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
          bad && fieldBox.error,
          !editable && fieldBox.disabled,
          lg && styles.lgBox,
          lg && (focused || bad) && styles.lgRing,
          bare && styles.bare,
          fieldHeight != null && (multiline ? { minHeight: fieldHeight } : { height: fieldHeight }),
        ]}
      >
        {LeftIcon ? <LeftIcon size={iconSize} color={bad ? colors.danger : colors.textMuted} /> : null}
        {prefix ? <FieldPrefix text={prefix} /> : null}
        <Field
          ref={ref}
          style={[fieldBox.input, multiline && fieldBox.inputMultiline, lg && styles.lgText, tabular && styles.tabular]}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={password && !reveal}
          editable={editable}
          multiline={multiline}
          maxFontSizeMultiplier={fontScaleCap.body}
          onFocus={(e) => {
            setFocused(true);
            keepInView?.(wrapper.current);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            keepInView?.(null);
            onBlur?.(e);
          }}
          {...rest}
        />
        {right}
        {password ? (
          <Pressable
            onPress={() => setReveal((v) => !v)}
            hitSlop={spacing[3]}
            accessibilityLabel={reveal ? "Hide password" : "Show password"}
          >
            {reveal ? <EyeOff size={iconSize} color={colors.textSecondary} /> : <Eye size={iconSize} color={colors.textSecondary} />}
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
  tabular: { fontVariant: ["tabular-nums"] },
  lgBox: { height: 52, borderRadius: 14, paddingHorizontal: 14 },
  lgRing: { paddingHorizontal: 13 },
  lgText: { fontSize: 17 },
});
