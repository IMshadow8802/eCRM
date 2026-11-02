import { StyleSheet, View } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import { colors, metrics, radius, spacing, typography } from "../../theme";
import { FieldHelp, FieldLabel } from "../../ui";

export interface RemarksInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder: string;
  required?: boolean;
  /** E 13: 84; E 23: 64. */
  minHeight?: number;
  hint?: string;
  error?: string | null;
  autoFocus?: boolean;
  testID?: string;
}

/**
 * A textarea inside a bottom sheet (E `.in.ta`). gorhom's input, not ui/Input:
 * a plain TextInput in a sheet sits under the keyboard because the sheet
 * cannot pan with it.
 */
export function RemarksInput({
  value, onChangeText, label = "Remarks", placeholder, required = true, minHeight = 64, hint, error, testID, autoFocus,
}: RemarksInputProps) {
  return (
    <View style={styles.block}>
      <FieldLabel label={label} required={required} />
      <BottomSheetTextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline
        autoFocus={autoFocus}
        style={[styles.input, { minHeight }, !!error && styles.error]}
      />
      <FieldHelp error={error} hint={hint} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: metrics.fieldGap },
  input: {
    ...typography.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.badge,
    paddingHorizontal: spacing[3],
    paddingTop: 11,
    paddingBottom: 11,
    backgroundColor: colors.surface,
    textAlignVertical: "top",
  },
  error: { borderWidth: 2, borderColor: colors.danger, paddingHorizontal: 11 },
});

export default RemarksInput;
