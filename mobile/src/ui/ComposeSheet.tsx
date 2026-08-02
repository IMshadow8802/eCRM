import { forwardRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import { colors, radius, spacing, typography } from "../theme";
import { Button } from "./Button";
import { Sheet, type SheetRef } from "./Sheet";

export interface ComposeSheetProps {
  title: string;
  placeholder: string;
  submitLabel: string;
  multiline?: boolean;
  busy?: boolean;
  onSubmit: (text: string) => void;
}

/**
 * A bottom sheet holding one text field and a submit button — "add a checklist
 * item", "write a comment".
 *
 * Uses @gorhom's BottomSheetTextInput rather than the design system's Input:
 * a plain RN TextInput inside a bottom sheet loses focus and sits under the
 * keyboard, because the sheet needs to know about the input to pan with it.
 * This file is inside src/ui, which is where raw inputs are allowed to live.
 */
export const ComposeSheet = forwardRef<SheetRef, ComposeSheetProps>(
  function ComposeSheet(
    { title, placeholder, submitLabel, multiline = false, busy = false, onSubmit },
    ref,
  ) {
    const [text, setText] = useState("");

    const submit = () => {
      const value = text.trim();
      if (!value) return;
      onSubmit(value);
      setText("");
    };

    return (
      <Sheet ref={ref} title={title} keyboardAware onDismiss={() => setText("")}>
        <View style={styles.body}>
          <BottomSheetTextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, multiline && styles.inputMultiline]}
            multiline={multiline}
            autoFocus
            returnKeyType={multiline ? undefined : "done"}
            onSubmitEditing={multiline ? undefined : submit}
          />
          <Button
            title={submitLabel}
            onPress={submit}
            loading={busy}
            disabled={!text.trim()}
            fullWidth
          />
        </View>
      </Sheet>
    );
  },
);

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing[4], gap: spacing[3] },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    backgroundColor: colors.surface,
  },
  inputMultiline: { minHeight: 110, textAlignVertical: "top" },
});

export default ComposeSheet;
