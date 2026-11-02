import { StyleSheet } from "react-native";

import { metrics } from "../../theme";
import { Input } from "../../ui";

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
 * A textarea inside a bottom sheet (E `.in.ta`): ui/Input, which turns into
 * gorhom's sheet input inside a Sheet, so it rides the keyboard.
 */
export function RemarksInput({
  value, onChangeText, label = "Remarks", placeholder, required = true, minHeight = 64, hint, error, testID, autoFocus,
}: RemarksInputProps) {
  return (
    <Input
      testID={testID}
      label={label}
      required={required}
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      multiline
      fieldHeight={minHeight}
      autoFocus={autoFocus}
      hint={hint}
      error={error}
      containerStyle={styles.block}
    />
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: metrics.fieldGap },
});

export default RemarksInput;
